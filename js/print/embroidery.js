// Bordado: convierte el diseño en puntadas.
// - Columnas angostas → puntada satinada (hilos paralelos que cruzan la columna de borde a borde,
//   siguiendo el gradiente de la distancia al borde). Las rayas salen de un "phasor noise" con
//   fase propagada, así quedan prolijas y continuas aunque la dirección gire.
// - Zonas anchas → relleno tatami (filas a ángulo fijo por zona, penetraciones escalonadas)
//   con un pespunte de contorno más oscuro.
// Altura: almohadilla redondeada por distancia al borde (~1.1 mm) + surco entre colores.

import { clamp } from '../core/utils.js';
import { blur, insideDistance, regionDistance, smoothLabelEdges, smoothMask, cleanMask, fbmNoise, hash2, components } from './raster.js';
import { posterize, px } from './techniques.js';

const TAU = Math.PI * 2;
const FILL_ANGLES = [45, -45, 30, -60, 15, 75, -20, 60];

export function bordado(job) {
  const { w, h, n, pxMm } = job;
  const maxC = job.tech.maxColors || 6;
  const k = clamp(Math.round(job.opts.colors != null ? job.opts.colors : maxC), 1, maxC);

  // 1) máscara: la bordadora no resuelve detalle menor a ~0.8 mm
  let alpha = smoothMask(job.alpha, w, h, Math.max(1, Math.round(px(job, 0.4))), 0.5);
  const area = 1 / (pxMm * pxMm);
  cleanMask(alpha, w, h, 3 * area, 1.5 * area);
  alpha = smoothMask(alpha, w, h, 1, 0.5);

  // 2) hilos: ≤ 6 colores, regiones limpias
  const { labels, palette, used } = posterize(job, alpha, k, { modeIters: 3 });

  // 3) distancias: a cualquier borde (incluye límites entre colores) y al fondo
  const D = regionDistance(labels, w, h);
  const Dbg = insideDistance(alpha, w, h);

  // 4) cada zona: satinado si es angosta, tatami si es ancha
  const { comp, count } = components(labels, w, h);
  const maxD = new Float32Array(count);
  for (let i = 0; i < n; i++) if (comp[i] >= 0 && D[i] > maxD[comp[i]]) maxD[comp[i]] = D[i];
  const SATIN_MAX = 4.2; // mm de media columna (≈ 8 mm de ancho)
  const isFill = new Uint8Array(count);
  const fillDir = new Float32Array(count * 2);
  for (let c = 0; c < count; c++) {
    isFill[c] = maxD[c] * pxMm > SATIN_MAX ? 1 : 0;
    const ang = ((FILL_ANGLES[c % FILL_ANGLES.length] + (hash2(c, 5, job.seed) - 0.5) * 10) * Math.PI) / 180;
    fillDir[c * 2] = Math.cos(ang);
    fillDir[c * 2 + 1] = Math.sin(ang);
  }

  // 5) campo de dirección de la puntada satinada: gradiente de la distancia (ángulo doble suavizado)
  const Ds = blur(D, w, h, 1, 1);
  let c2 = new Float32Array(n);
  let s2 = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = Ds[i + 1] - Ds[i - 1];
      const gy = Ds[i + w] - Ds[i - w];
      const m = gx * gx + gy * gy;
      if (m < 1e-8) continue;
      c2[i] = (gx * gx - gy * gy) / m;
      s2[i] = (2 * gx * gy) / m;
    }
  }
  const rd = Math.max(2, Math.round(px(job, 0.55)));
  c2 = blur(c2, w, h, rd, 2);
  s2 = blur(s2, w, h, rd, 2);
  // p = vector perpendicular a la puntada (las rayas corren a lo largo de la puntada)
  const pX = new Float32Array(n);
  const pY = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = 0.5 * Math.atan2(s2[i], c2[i]);
    pX[i] = -Math.sin(th);
    pY[i] = Math.cos(th);
  }

  // 6) píxeles que necesitan fase satinada (zonas satinadas + banda del contorno)
  const OUT_W = 0.6; // ancho del pespunte de contorno (mm)
  const need = new Uint8Array(n);
  let needCount = 0;
  for (let i = 0; i < n; i++) {
    if (!labels[i]) continue;
    const c = comp[i];
    if (c < 0) continue;
    if (!isFill[c]) {
      need[i] = 1;
      needCount++;
    } else if (D[i] * pxMm < OUT_W + 0.15) {
      need[i] = 2; // banda del pespunte: necesita también la fase larga
      needCount++;
    }
  }
  const lambda = Math.max(2.6, px(job, 0.62)); // separación entre hilos (px)
  const phase = needCount ? phasorField(w, h, need, pX, pY, lambda, job.seed) : null;
  const ph1 = phase ? phase.p1 : null;
  const ph2 = phase ? phase.p2 : null;

  // 7) componer: color, alturas, rugosidad
  const out = {
    color: new Uint8ClampedArray(n * 4),
    alpha: new Float32Array(n),
    Hmm: new Float32Array(n),
    Dmm: new Float32Array(n),
    rough: new Float32Array(n),
    metal: new Float32Array(n),
    tilt: null,
  };
  const tone = fbmNoise(w, h, px(job, 3), 2, job.seed + 21);
  const fuzz = fbmNoise(w, h, Math.max(1.5, px(job, 0.3)), 2, job.seed + 22);
  const lamF = lambda * 0.85; // filas del tatami
  const stitchL = Math.max(8, px(job, 3.2)); // largo de puntada del tatami
  const relief = job.tech.relief;
  const threads = palette.map((p) => {
    // hilo de rayón: un poquito más saturado que el original
    const l = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
    return { r: clamp(l + (p.r - l) * 1.08, 0, 255), g: clamp(l + (p.g - l) * 1.08, 0, 255), b: clamp(l + (p.b - l) * 1.08, 0, 255) };
  });
  // hilo del pespunte de contorno: el más oscuro de la paleta (o un tono más oscuro del propio)
  const lumT = (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  let darkest = threads[0];
  for (let t = 0; t < threads.length; t++) if (used[t + 1] > 0 && lumT(threads[t]) < lumT(darkest)) darkest = threads[t];
  const outlineOf = threads.map((t) => {
    if (lumT(t) - lumT(darkest) > 0.18) return { r: darkest.r * 0.9, g: darkest.g * 0.9, b: darkest.b * 0.9 };
    return { r: t.r * 0.55, g: t.g * 0.55, b: t.b * 0.55 };
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i];
      let a = alpha[i];
      if (!l || a <= 0) {
        out.alpha[i] = a;
        continue;
      }
      const c = comp[i];
      const fill = c >= 0 && isFill[c];
      const dmm = D[i] * pxMm;
      const dbg = Dbg[i] * pxMm;
      // almohadilla: cuarto de círculo hacia el fondo, surco suave entre colores
      const tb = Math.min(1, dbg / 0.95);
      const pillow = Math.sqrt(1 - (1 - tb) * (1 - tb));
      let col;
      let prof;
      let detail;
      let rough;
      if (!fill) {
        const t2 = Math.min(1, dmm / 0.85);
        col = 0.6 + 0.4 * Math.sqrt(1 - (1 - t2) * (1 - t2));
        const u = ph1[i] / Math.PI; // -1..1 a través de cada hilo
        prof = Math.sqrt(Math.max(0, 1 - u * u));
        detail = prof * 0.16;
        rough = 0.3 + (1 - prof) * 0.34;
        // las puntadas terminan redondeadas en el borde: festón leve
        const eb = clamp(1 - (Dbg[i] - 0.5) / 1.3, 0, 1);
        a *= 1 - (1 - prof) * eb * 0.75;
      } else {
        const t2 = Math.min(1, dmm / 0.45);
        col = 0.62 + 0.26 * Math.sqrt(1 - (1 - t2) * (1 - t2));
        const dx = fillDir[c * 2];
        const dy = fillDir[c * 2 + 1];
        const v = (-dy * x + dx * y) / lamF;
        const row = Math.floor(v);
        const fr = v - row;
        prof = Math.sqrt(Math.max(0, 1 - (2 * fr - 1) * (2 * fr - 1)));
        // penetraciones de aguja escalonadas fila a fila (el dibujito típico del tatami)
        const uu = (dx * x + dy * y) / stitchL + row * 0.37 + hash2(row, c, job.seed) * 0.04;
        const fu = uu - Math.floor(uu);
        const dd = Math.min(fu, 1 - fu) * stitchL;
        const dip = dd < 1.2 ? 1 - dd / 1.2 : 0;
        prof *= 1 - dip * 0.55;
        detail = prof * 0.11 - dip * 0.03;
        rough = 0.36 + (1 - prof) * 0.3;
      }
      let base = threads[l - 1];
      let H = pillow * col;
      // pespunte de contorno (más oscuro) sobre los rellenos
      if (fill && dmm < OUT_W + 0.15 && ph2) {
        const q = clamp((dmm - 0.05) / OUT_W, 0, 1);
        const across = Math.sqrt(Math.max(0, 1 - (2 * q - 1) * (2 * q - 1)));
        const v2 = ph2[i] / TAU + 0.5; // 0..1 a lo largo de cada puntada del pespunte
        const gap = v2 < 0.1 ? 1 - v2 / 0.1 : v2 > 0.95 ? (v2 - 0.95) / 0.05 : 0;
        const on = across * (1 - gap);
        if (on > 0.05) {
          const twist = 0.82 + 0.18 * Math.cos(ph1[i] + q * TAU);
          const darker = outlineOf[l - 1];
          base = { r: base.r + (darker.r - base.r) * Math.min(1, on * 1.6), g: base.g + (darker.g - base.g) * Math.min(1, on * 1.6), b: base.b + (darker.b - base.b) * Math.min(1, on * 1.6) };
          H = Math.min(1, H + 0.14 * on);
          prof = Math.max(prof * (1 - on), on * twist);
          detail = detail * (1 - on) + on * twist * 0.12;
          rough = rough * (1 - on) + on * 0.4;
        }
      }
      // sombreado de cada hilo (cilindro) + oclusión de la almohadilla y de las juntas entre
      // colores + variación del hilo
      const seam = Math.min(1, dmm / 0.7);
      const shade = (0.6 + 0.4 * prof) * (0.74 + 0.26 * pillow) * (0.84 + 0.16 * seam) * (1 + (tone[i] - 0.5) * 0.06) * (1 + (fuzz[i] - 0.5) * 0.05);
      const hi = prof > 0.8 ? (prof - 0.8) * 0.18 : 0; // brillo del rayón en la cresta
      const o = i * 4;
      out.color[o] = Math.min(255, base.r * shade + (255 - base.r) * hi);
      out.color[o + 1] = Math.min(255, base.g * shade + (255 - base.g) * hi);
      out.color[o + 2] = Math.min(255, base.b * shade + (255 - base.b) * hi);
      out.color[o + 3] = 255;
      out.alpha[i] = a;
      out.Hmm[i] = relief * H;
      out.Dmm[i] = detail + (fuzz[i] - 0.5) * 0.012;
      out.rough[i] = rough;
    }
  }
  smoothLabelEdges(out.color, labels, w, h);
  out.Hmm = blur(out.Hmm, w, h, 1, 1);
  out.gain = 1.05;
  out.macroW = 1.15;
  out.params = { roughness: 0.38, metalness: 0, clearcoat: 0, normalScale: 1, sheen: 0.4, sheenRoughness: 0.32, sheenColor: '#c9c4bb' };
  out.palette = threads.filter((_, i) => used[i + 1] > 0);
  out.labels = labels;
  out.stitch = { satin: [...isFill].filter((f) => !f).length, fill: [...isFill].filter((f) => f).length, spacingMm: lambda * pxMm };
  return out;
}

// "Phasor noise" con fase propagada: devuelve la fase (−π..π) de rayas de período `lambda`
// perpendiculares a p (es decir, que corren a lo largo de la puntada) para los píxeles `need`.
// p2 = mismas rayas con período ×3 (para las puntadas del pespunte).
function phasorField(w, h, need, pX, pY, lambda, seed) {
  const G = Math.max(6, Math.round(lambda * 2.4));
  const gw = Math.ceil(w / G) + 1;
  const gh = Math.ceil(h / G) + 1;
  const K = gw * gh;
  const kx = new Float32Array(K);
  const ky = new Float32Array(K);
  const kpx = new Float32Array(K);
  const kpy = new Float32Array(K);
  const psi1 = new Float32Array(K);
  const psi2 = new Float32Array(K);
  const f1 = TAU / lambda;
  const f2 = f1 / 3;
  const sigma = 0.55 * G;
  const inv2s2 = 1 / (2 * sigma * sigma);
  // núcleos activos: celdas cercanas a píxeles que lo necesitan
  const active = new Uint8Array(K);
  for (let y = 0; y < h; y++) {
    const cj = Math.floor(y / G);
    for (let x = 0; x < w; x++) {
      if (!need[y * w + x]) continue;
      const ci = Math.floor(x / G);
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        if (jj < 0 || jj >= gh) continue;
        for (let ii = ci - 1; ii <= ci + 1; ii++) if (ii >= 0 && ii < gw) active[jj * gw + ii] = 1;
      }
    }
  }
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = j * gw + i;
      const x = Math.min(w - 1, (i + 0.5) * G);
      const y = Math.min(h - 1, (j + 0.5) * G);
      kx[c] = (i + 0.5) * G;
      ky[c] = (j + 0.5) * G;
      const pi = Math.floor(y) * w + Math.floor(x);
      kpx[c] = pX[pi];
      kpy[c] = pY[pi];
    }
  }
  // propagación de fase en orden de barrido: cada núcleo se alinea con los ya ubicados
  const placed = new Uint8Array(K);
  const NB = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [-2, 0],
    [0, -2],
  ];
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = j * gw + i;
      if (!active[c]) continue;
      let r1 = 0;
      let i1 = 0;
      let r2 = 0;
      let i2 = 0;
      for (const [di, dj] of NB) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        const q = jj * gw + ii;
        if (!placed[q]) continue;
        const dx = kx[c] - kx[q];
        const dy = ky[c] - ky[q];
        const wgt = Math.exp(-(dx * dx + dy * dy) * inv2s2);
        const s = kpx[q] * kpx[c] + kpy[q] * kpy[c] < 0 ? -1 : 1;
        const proj = kpx[q] * dx + kpy[q] * dy;
        const t1 = s * (f1 * proj + psi1[q]);
        const t2 = s * (f2 * proj + psi2[q]);
        r1 += wgt * Math.cos(t1);
        i1 += wgt * Math.sin(t1);
        r2 += wgt * Math.cos(t2);
        i2 += wgt * Math.sin(t2);
      }
      psi1[c] = r1 * r1 + i1 * i1 > 1e-6 ? Math.atan2(i1, r1) : hash2(i, j, seed) * TAU;
      psi2[c] = r2 * r2 + i2 * i2 > 1e-6 ? Math.atan2(i2, r2) : hash2(i, j, seed + 1) * TAU;
      placed[c] = 1;
    }
  }
  // tabla de pesos gaussianos por desplazamiento entero
  const R = Math.ceil(G * 2) + 1;
  const S = 2 * R + 1;
  const wl = new Float32Array(S * S);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) wl[(dy + R) * S + dx + R] = Math.exp(-(dx * dx + dy * dy) * inv2s2);
  const p1 = new Float32Array(w * h);
  const p2 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const cj = Math.floor(y / G);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!need[i]) continue;
      const ci = Math.floor(x / G);
      const ox = pX[i];
      const oy = pY[i];
      const both = need[i] === 2;
      let r1 = 0;
      let m1 = 0;
      let r2 = 0;
      let m2 = 0;
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        if (jj < 0 || jj >= gh) continue;
        for (let ii = ci - 1; ii <= ci + 1; ii++) {
          if (ii < 0 || ii >= gw) continue;
          const q = jj * gw + ii;
          const dx = x - kx[q];
          const dy = y - ky[q];
          const idx = (Math.round(dy) + R) * S + Math.round(dx) + R;
          const wgt = wl[idx];
          if (wgt < 1e-4) continue;
          const s = kpx[q] * ox + kpy[q] * oy < 0 ? -1 : 1;
          const proj = kpx[q] * dx + kpy[q] * dy;
          const t1 = s * (f1 * proj + psi1[q]);
          r1 += wgt * Math.cos(t1);
          m1 += wgt * Math.sin(t1);
          if (both) {
            const t2 = s * (f2 * proj + psi2[q]);
            r2 += wgt * Math.cos(t2);
            m2 += wgt * Math.sin(t2);
          }
        }
      }
      p1[i] = Math.atan2(m1, r1);
      if (both) p2[i] = Math.atan2(m2, r2);
    }
  }
  return { p1, p2 };
}
