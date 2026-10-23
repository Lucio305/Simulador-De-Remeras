// Defectos de estampado (calidad del proceso) y desgaste por lavados.
// applyDefects trabaja sobre los datos crudos de una técnica (antes de armar los canvases);
// applyWear trabaja sobre un PrintResult terminado (lee y reescribe sus canvases).

import { clamp, hexToRgb } from '../core/utils.js';
import { blur, distanceTo, insideDistance, fbmNoise, hash2, readRGBA, rgbaToCanvas, bleedEdges } from './raster.js';

const sstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function normalizeDefects(d = {}) {
  const v = (x) => (x === true ? 0.7 : typeof x === 'number' && isFinite(x) ? clamp(x, 0, 1) : 0);
  d = d || {};
  return { patchy: v(d.patchy), lift: v(d.lift), scorch: v(d.scorch), ghost: v(d.ghost), under: v(d.under) };
}

// Degrada `out` (datos crudos) según calidad 0..1 y defectos. Modifica en el lugar.
export function applyDefects(job, out, quality, defects) {
  const { w, h, n, pxMm } = job;
  const tid = job.tech.id;
  const imp = clamp(1 - quality, 0, 1);
  const d = {
    patchy: Math.max(defects.patchy, imp * 0.32),
    lift: defects.lift,
    scorch: defects.scorch,
    ghost: defects.ghost,
    under: defects.under,
  };
  const mm = (v) => v / pxMm;
  const seed = job.seed * 7 + 101;
  const A = out.alpha;
  const C = out.color;
  const fab = job.fabricRgb;
  const thread = tid === 'bordado';

  // --- doble imagen corrida (se movió el transfer / el shablón) ---
  if (d.ghost > 0.01) {
    const ang = hash2(3, 9, seed) * Math.PI * 2;
    const dist = mm(0.8 + 1.6 * d.ghost);
    const sx = Math.round(Math.cos(ang) * dist);
    const sy = Math.round(Math.sin(ang) * dist);
    const ga = 0.28 + 0.3 * d.ghost;
    const srcA = new Float32Array(A);
    const srcC = new Uint8ClampedArray(C);
    const srcH = new Float32Array(out.Hmm);
    for (let y = 0; y < h; y++) {
      const yy = y - sy;
      if (yy < 0 || yy >= h) continue;
      for (let x = 0; x < w; x++) {
        const xx = x - sx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        const ag = srcA[j] * ga;
        if (ag <= 0.002) continue;
        const i = y * w + x;
        const a = srcA[i];
        const na = a + ag * (1 - a);
        const o = i * 4;
        const q = j * 4;
        const t = (ag * (1 - a)) / na;
        C[o] = srcC[o] + (srcC[q] - srcC[o]) * t;
        C[o + 1] = srcC[o + 1] + (srcC[q + 1] - srcC[o + 1]) * t;
        C[o + 2] = srcC[o + 2] + (srcC[q + 2] - srcC[o + 2]) * t;
        C[o + 3] = 255;
        if (a <= 0.002) {
          C[o] = srcC[q];
          C[o + 1] = srcC[q + 1];
          C[o + 2] = srcC[q + 2];
        }
        A[i] = na;
        out.Hmm[i] = Math.max(srcH[i], srcH[j] * 0.35);
        if (a < 0.5 && out.rough) out.rough[i] = out.rough[i] || out.rough[j];
        if (a < 0.5 && out.metal) out.metal[i] = out.metal[i] || out.metal[j];
      }
    }
  }

  // --- zonas sin transferir / tinta insuficiente ---
  // tintas (serigrafía, puff, pintura, sublimación): manchas suaves donde la capa queda fina;
  // transfers y láminas (vinilo, DTF, foil, glitter): partes que no se pegaron, de borde neto.
  if (d.patchy > 0.01) {
    const soft = tid === 'serigrafia' || tid === 'puff' || tid === 'pintura' || tid === 'sublimacion' || thread;
    const big = fbmNoise(w, h, mm(soft ? 5 : 6), 2, seed + 1, 0.42);
    const speck = fbmNoise(w, h, Math.max(1.5, mm(0.7)), 2, seed + 2);
    const thr = d.patchy * (soft ? 0.56 : 0.5);
    const lo = soft ? 0.14 : 0.05;
    const hi = soft ? 0.1 : 0.03;
    const residual = soft ? (thread ? 0.55 : 0.25) : 0.04;
    for (let i = 0; i < n; i++) {
      if (A[i] <= 0) continue;
      let cov = sstep(thr - lo, thr + hi, big[i]);
      if (speck[i] < d.patchy * (soft ? 0.16 : 0.22)) cov *= soft ? 0.5 : 0.15;
      if (cov >= 0.999) continue;
      const k = residual + (1 - residual) * cov;
      A[i] *= k;
      out.Hmm[i] *= 0.3 + 0.7 * cov;
      if (out.Dmm) out.Dmm[i] *= cov;
      // donde falta tinta se ve más la tela
      const o = i * 4;
      const t = (1 - cov) * (soft ? 0.45 : 0.2);
      C[o] += (fab.r - C[o]) * t;
      C[o + 1] += (fab.g - C[o + 1]) * t;
      C[o + 2] += (fab.b - C[o + 2]) * t;
    }
  }

  // --- curado / transferencia insuficiente: translúcido y con menos relieve ---
  if (d.under > 0.01 && !thread) {
    const u = d.under;
    for (let i = 0; i < n; i++) {
      if (A[i] <= 0) continue;
      A[i] *= 1 - 0.38 * u;
      out.Hmm[i] *= 1 - (tid === 'puff' ? 0.72 : 0.5) * u;
      if (out.Dmm) out.Dmm[i] *= 1 - 0.4 * u;
      out.rough[i] = Math.min(1, out.rough[i] + 0.12 * u);
      const o = i * 4;
      const t = 0.22 * u;
      C[o] += (fab.r - C[o]) * t;
      C[o + 1] += (fab.g - C[o + 1]) * t;
      C[o + 2] += (fab.b - C[o + 2]) * t;
    }
  }

  // --- bordes levantados / despegados ---
  if (d.lift > 0.01) {
    const Dbg = insideDistance(A, w, h);
    const sect = fbmNoise(w, h, mm(9), 2, seed + 3);
    const rag = fbmNoise(w, h, Math.max(1.5, mm(0.5)), 2, seed + 4);
    const L = 1.0 + 2.4 * d.lift; // mm
    const amp = (thread ? 0.25 : 0.2 + 0.55 * d.lift) * (job.tech.relief > 0 ? 1 : 0.4);
    for (let i = 0; i < n; i++) {
      if (A[i] <= 0) continue;
      const dm = Dbg[i] * pxMm;
      if (dm > L) continue;
      const m = sstep(0.6 - d.lift * 0.3, 0.72 - d.lift * 0.3, sect[i]);
      if (m <= 0) continue;
      const curl = m * (1 - dm / L) * (1 - dm / L);
      out.Hmm[i] += curl * amp;
      if (out.Dmm) out.Dmm[i] *= 1 - curl * 0.5;
      const o = i * 4;
      // la parte levantada brilla un poco más y en el filo se rompe
      const t = curl * 0.12;
      C[o] += (255 - C[o]) * t;
      C[o + 1] += (255 - C[o + 1]) * t;
      C[o + 2] += (255 - C[o + 2]) * t;
      if (!thread && dm < 0.45 && curl > 0.45 && rag[i] < 0.55) A[i] *= 0.15;
    }
  }

  // --- tostado por exceso de temperatura ---
  if (d.scorch > 0.01) {
    const s = d.scorch;
    const blob = fbmNoise(w, h, mm(12), 3, seed + 5);
    const tone = { r: 0.74, g: 0.56, b: 0.36 };
    for (let i = 0; i < n; i++) {
      if (A[i] <= 0) continue;
      const k = s * (0.45 + 0.75 * blob[i]);
      const o = i * 4;
      const kk = Math.min(1, k);
      C[o] *= 1 - kk + kk * tone.r;
      C[o + 1] *= 1 - kk + kk * tone.g;
      C[o + 2] *= 1 - kk + kk * tone.b;
      out.rough[i] = Math.min(1, out.rough[i] + 0.1 * s);
    }
    // aureola tostada sobre la tela alrededor del diseño (desvanece antes del borde del canvas)
    const seedMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) seedMask[i] = A[i] > 0.5 ? 1 : 0;
    const Dout = distanceTo(seedMask, w, h);
    const maxR = Math.max(2, mm(4));
    const edgeFade = Math.max(2, maxR * 0.5);
    {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (A[i] >= 0.5) continue;
          const dd = Dout[i];
          if (dd > maxR) continue;
          const f = 1 - dd / maxR;
          // se apaga antes del borde del canvas para no dejar un corte recto
          const fb = Math.min(1, Math.min(x, y, w - 1 - x, h - 1 - y) / edgeFade);
          const ha = s * 0.32 * f * f * (0.6 + 0.6 * blob[i]) * fb;
          if (ha <= A[i]) continue;
          const o = i * 4;
          const t = A[i] > 0.01 ? clamp((ha - A[i]) / ha, 0, 1) : 1;
          C[o] += (136 - C[o]) * t;
          C[o + 1] += (92 - C[o + 1]) * t;
          C[o + 2] += (48 - C[o + 2]) * t;
          C[o + 3] = 255;
          A[i] = ha;
          out.rough[i] = Math.max(out.rough[i], 0.9);
        }
      }
    }
  }

  // --- calidad general baja: bordes menos prolijos ---
  if (imp > 0.15 && !thread) {
    const Dbg = insideDistance(A, w, h);
    const en = fbmNoise(w, h, Math.max(1.5, mm(0.8)), 2, seed + 6);
    for (let i = 0; i < n; i++) {
      if (A[i] <= 0) continue;
      const dm = Dbg[i] * pxMm;
      if (dm > 0.5) continue;
      if (en[i] < imp * 0.55) A[i] *= 0.2 + 0.8 * (dm / 0.5);
    }
  }
  return { ...d, quality };
}

// ---------------------------------------------------------------------------
// Desgaste por lavados
// ---------------------------------------------------------------------------

export function applyWear(result, { fade = 0, crack = 0 } = {}) {
  if (!result || !result.color) return result;
  fade = clamp(fade || 0, 0, 1);
  crack = clamp(crack || 0, 0, 1);
  if (fade <= 0 && crack <= 0) return result;
  const tid = result.technique;
  const w = result.color.width;
  const h = result.color.height;
  const n = w * h;
  const meta = result.meta || {};
  const pxMm = meta.pxMm || 260 / w;
  const mm = (v) => v / pxMm;
  const fab = hexToRgb(meta.fabricColor || '#f3f1ea');
  const C = new Uint8ClampedArray(readRGBA(result.color).data);
  const hc = result.height && result.height.getContext ? result.height : result.heightMap;
  const H = hc ? new Uint8ClampedArray(readRGBA(hc).data) : null;
  const N = result.normal ? new Uint8ClampedArray(readRGBA(result.normal).data) : null;
  const O = result.orm ? new Uint8ClampedArray(readRGBA(result.orm).data) : null;
  const seed = 977 + (meta.seed || 0);
  const thread = tid === 'bordado';
  const dye = tid === 'sublimacion';

  // color medio (para bajar contraste)
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let ma = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = C[o + 3];
    if (a < 128) continue;
    mr += C[o];
    mg += C[o + 1];
    mb += C[o + 2];
    ma++;
  }
  if (ma) {
    mr /= ma;
    mg /= ma;
    mb /= ma;
  }

  if (fade > 0) {
    const nz = fbmNoise(w, h, mm(6), 3, seed);
    const pill = thread ? fbmNoise(w, h, Math.max(1.5, mm(0.35)), 2, seed + 1) : null;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (C[o + 3] <= 4) continue;
      const f = clamp(fade * (0.75 + 0.5 * nz[i]), 0, 1);
      let r = C[o];
      let g = C[o + 1];
      let b = C[o + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const ds = thread ? 0.25 : 0.55;
      r += (l - r) * f * ds;
      g += (l - g) * f * ds;
      b += (l - b) * f * ds;
      r += (mr - r) * f * 0.16;
      g += (mg - g) * f * 0.16;
      b += (mb - b) * f * 0.16;
      const tf = dye ? 0.45 : thread ? 0.08 : 0.28;
      r += (fab.r - r) * f * tf;
      g += (fab.g - g) * f * tf;
      b += (fab.b - b) * f * tf;
      r += (236 - r) * f * (thread ? 0.05 : 0.12);
      g += (234 - g) * f * (thread ? 0.05 : 0.12);
      b += (228 - b) * f * (thread ? 0.05 : 0.12);
      // pelusa (pilling) en el bordado
      if (pill && pill[i] > 1 - f * 0.25) {
        r += (255 - r) * 0.18;
        g += (255 - g) * 0.18;
        b += (255 - b) * 0.18;
      }
      C[o] = r;
      C[o + 1] = g;
      C[o + 2] = b;
      if (C[o + 3] > 4) C[o + 3] *= 1 - f * (dye || tid === 'dtf' ? 0.22 : 0.07);
      if (H) H[o] = H[o + 1] = H[o + 2] = H[o] * (1 - f * 0.22);
      if (N) {
        N[o] += (128 - N[o]) * f * 0.3;
        N[o + 1] += (128 - N[o + 1]) * f * 0.3;
        N[o + 2] += (255 - N[o + 2]) * f * 0.3;
      }
      if (O) O[o + 1] = Math.min(255, O[o + 1] + f * 40);
    }
  }

  if (crack > 0 && !thread && !dye) {
    const cm = crackNetwork(w, h, pxMm, crack, seed, tid === 'foil' || tid === 'glitter' || tid === 'vinilo');
    // inclinación de las normales en el filo de cada grieta
    const cb = blur(cm, w, h, 1, 1);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const k = cm[i];
        const o = i * 4;
        if (C[o + 3] <= 4) continue;
        if (k > 0) {
          C[o + 3] *= 1 - k;
          if (H) H[o] = H[o + 1] = H[o + 2] = H[o] * (1 - k);
        }
        const gx = cb[i + 1] - cb[i - 1];
        const gy = cb[i + w] - cb[i - w];
        if (N && (gx || gy)) {
          let nx = (N[o] / 255) * 2 - 1 + gx * 1.4;
          let ny = (N[o + 1] / 255) * 2 - 1 - gy * 1.4;
          let nz = (N[o + 2] / 255) * 2 - 1;
          const l = Math.hypot(nx, ny, nz) || 1;
          N[o] = (nx / l) * 127.5 + 127.5;
          N[o + 1] = (ny / l) * 127.5 + 127.5;
          N[o + 2] = (nz / l) * 127.5 + 127.5;
          // sombra en el filo
          const sh = 1 - Math.min(0.35, Math.hypot(gx, gy) * 0.8);
          C[o] *= sh;
          C[o + 1] *= sh;
          C[o + 2] *= sh;
        }
      }
    }
  }

  bleedEdges(C, w, h, 2, 4);
  const color = rgbaToCanvas(C, w, h);
  const height = H ? rgbaToCanvas(H, w, h) : result.height;
  const normal = N ? rgbaToCanvas(N, w, h) : result.normal;
  const orm = O ? rgbaToCanvas(O, w, h) : result.orm;
  return { ...result, color, height, heightMap: height, normal, orm, wear: { fade, crack } };
}

// Red de grietas: bordes de celdas de Voronoi deformadas; con `flakes` también se caen trocitos enteros.
function crackNetwork(w, h, pxMm, amount, seed, flakes) {
  const cellMm = 10.5 - 4.5 * amount;
  const cell = Math.max(6, cellMm / pxMm);
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const fx = new Float32Array(gw * gh);
  const fy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = j * gw + i;
      fx[c] = (i - 1 + 0.1 + hash2(i, j, seed) * 0.8) * cell;
      fy[c] = (j - 1 + 0.1 + hash2(i, j, seed + 1) * 0.8) * cell;
    }
  }
  const warpX = fbmNoise(w, h, cell * 0.6, 2, seed + 2);
  const warpY = fbmNoise(w, h, cell * 0.6, 2, seed + 3);
  const widthPx = Math.max(0.8, (0.1 + 0.28 * amount) / pxMm);
  const prob = 0.25 + 0.6 * amount;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ux = x + (warpX[i] - 0.5) * cell * 0.45;
      const uy = y + (warpY[i] - 0.5) * cell * 0.45;
      const ci = Math.floor(ux / cell) + 1;
      const cj = Math.floor(uy / cell) + 1;
      let d1 = 1e9;
      let d2 = 1e9;
      let b1 = 0;
      let b2 = 0;
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        if (jj < 0 || jj >= gh) continue;
        for (let ii = ci - 1; ii <= ci + 1; ii++) {
          if (ii < 0 || ii >= gw) continue;
          const c = jj * gw + ii;
          const dx = fx[c] - ux;
          const dy = fy[c] - uy;
          const dd = dx * dx + dy * dy;
          if (dd < d1) {
            d2 = d1;
            b2 = b1;
            d1 = dd;
            b1 = c;
          } else if (dd < d2) {
            d2 = dd;
            b2 = c;
          }
        }
      }
      if (flakes && hash2(b1, 77, seed) < amount * 0.22) {
        out[i] = 1;
        continue;
      }
      const e = (Math.sqrt(d2) - Math.sqrt(d1)) * 0.5;
      if (e > widthPx) continue;
      const lo = Math.min(b1, b2);
      const hi = Math.max(b1, b2);
      if (hash2(lo, hi, seed + 9) > prob) continue;
      out[i] = clamp(1 - e / widthPx, 0, 1) ** 0.5;
    }
  }
  return out;
}
