// Superficie de la remera: malla de cada panel (frente/espalda) por parches de Coons,
// campos de "inflado" (distancia a las costuras) y el mapeo 2D → 3D tipo maniquí invisible.
// Los dos paneles comparten topología: los vértices de las costuras coinciden índice a índice.

import { resampleN } from './pattern.js';
import { clamp, lerp, smoothstep, polylineLength } from '../core/utils.js';

export const SPACING = 0.0065; // ~6.5 mm entre vértices

// ---------- tablas del "envoltorio" elíptico ----------
// Para una costura, el paño se envuelve como un cuarto de elipse de semiejes (1, Zn) (normalizado).
// PHI[σ, Zn] = ángulo φ en el que la longitud de arco recorrida es la fracción σ del total.
const NZ = 64;
const NS = 128;
const ZN_MAX = 2.5;
const PHI = new Float32Array((NZ + 1) * (NS + 1));
(() => {
  const M = 512;
  const cum = new Float64Array(M + 1);
  for (let iz = 0; iz <= NZ; iz++) {
    const zn = (iz / NZ) * ZN_MAX;
    cum[0] = 0;
    for (let m = 1; m <= M; m++) {
      const th = ((m - 0.5) / M) * (Math.PI / 2);
      const s = Math.sin(th);
      const c = Math.cos(th);
      cum[m] = cum[m - 1] + Math.sqrt(s * s + zn * zn * c * c) * (Math.PI / 2 / M);
    }
    const T = cum[M];
    let m = 1;
    for (let is = 0; is <= NS; is++) {
      const target = (is / NS) * T;
      while (m < M && cum[m] < target) m++;
      const t = cum[m] - cum[m - 1] > 1e-12 ? (target - cum[m - 1]) / (cum[m] - cum[m - 1]) : 0;
      PHI[iz * (NS + 1) + is] = ((m - 1 + clamp(t)) / M) * (Math.PI / 2);
    }
    PHI[iz * (NS + 1) + NS] = Math.PI / 2;
  }
})();
function phiOf(sigma, zn) {
  const fs = clamp(sigma) * NS;
  const fz = clamp(zn / ZN_MAX) * NZ;
  const is = Math.min(NS - 1, Math.floor(fs));
  const iz = Math.min(NZ - 1, Math.floor(fz));
  const ts = fs - is;
  const tz = fz - iz;
  const a = PHI[iz * (NS + 1) + is];
  const b = PHI[iz * (NS + 1) + is + 1];
  const c = PHI[(iz + 1) * (NS + 1) + is];
  const d = PHI[(iz + 1) * (NS + 1) + is + 1];
  return lerp(lerp(a, b, ts), lerp(c, d, ts), tz);
}
// g(s) = s + s² − s³ (rampa que satura con pendiente 0 en s = 1) y su inversa tabulada.
const gRamp = (s) => (s >= 1 ? 1 : s + s * s - s * s * s);
const gRampD = (s) => (s >= 1 ? 0 : 1 + 2 * s - 3 * s * s);
const GINV = new Float32Array(257);
for (let i = 0; i <= 256; i++) {
  const target = i / 256;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (gRamp(mid) < target) lo = mid;
    else hi = mid;
  }
  GINV[i] = (lo + hi) / 2;
}
function gInv(v) {
  const f = clamp(v) * 256;
  const i = Math.min(255, Math.floor(f));
  return lerp(GINV[i], GINV[i + 1], f - i);
}

// ---------- distancias a polilíneas ----------
function toFlat(pts) {
  const a = new Float64Array(pts.length * 2);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  pts.forEach((p, i) => {
    a[i * 2] = p.x;
    a[i * 2 + 1] = p.y;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  });
  a.bb = [x0, y0, x1, y1];
  return a;
}
// Distancia de (x,y) a la caja de una polilínea (cota inferior de la distancia real).
function bbDist(P, x, y) {
  const b = P.bb;
  const dx = x < b[0] ? b[0] - x : x > b[2] ? x - b[2] : 0;
  const dy = y < b[1] ? b[1] - y : y > b[3] ? y - b[3] : 0;
  return Math.sqrt(dx * dx + dy * dy);
}
const NEAR = new Float64Array(3); // [d, nx, ny] punto más cercano
// Distancia de (x,y) a la polilínea; deja en NEAR el punto más cercano. `sign` (opcional) = lado (producto cruz).
function polyNearest(P, x, y) {
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let cross = 0;
  for (let i = 0; i < P.length - 2; i += 2) {
    const ax = P[i];
    const ay = P[i + 1];
    const dx = P[i + 2] - ax;
    const dy = P[i + 3] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < best) {
      best = d2;
      bx = px;
      by = py;
      cross = dx * (y - ay) - dy * (x - ax);
    }
  }
  NEAR[0] = Math.sqrt(best);
  NEAR[1] = bx;
  NEAR[2] = by;
  return cross;
}

// ---------- utilidades de mallado ----------
function arcParams(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const t = s[s.length - 1] || 1;
  return s.map((v) => v / t);
}
// Parche de Coons discreto. C0/C1: bordes inferior/superior (nu+1), D0/D1: izquierdo/derecho (nv+1).
function coons(C0, C1, D0, D1) {
  const nu = C0.length - 1;
  const nv = D0.length - 1;
  const sC0 = arcParams(C0);
  const sC1 = arcParams(C1);
  const sD0 = arcParams(D0);
  const sD1 = arcParams(D1);
  const P00 = C0[0];
  const P10 = C0[nu];
  const P01 = C1[0];
  const P11 = C1[nu];
  const out = new Float64Array((nu + 1) * (nv + 1) * 2);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      // parámetros que dependen de ambos bordes (mejor reparto en bordes desparejos)
      let u = (sC0[i] + sC1[i]) / 2;
      let v = (sD0[j] + sD1[j]) / 2;
      for (let k = 0; k < 2; k++) {
        u = lerp(sC0[i], sC1[i], v);
        v = lerp(sD0[j], sD1[j], u);
      }
      if (i === 0) u = 0;
      if (i === nu) u = 1;
      if (j === 0) v = 0;
      if (j === nv) v = 1;
      const o = (j * (nu + 1) + i) * 2;
      const w00 = (1 - u) * (1 - v);
      const w10 = u * (1 - v);
      const w01 = (1 - u) * v;
      const w11 = u * v;
      out[o] = (1 - v) * C0[i].x + v * C1[i].x + (1 - u) * D0[j].x + u * D1[j].x - (w00 * P00.x + w10 * P10.x + w01 * P01.x + w11 * P11.x);
      out[o + 1] = (1 - v) * C0[i].y + v * C1[i].y + (1 - u) * D0[j].y + u * D1[j].y - (w00 * P00.y + w10 * P10.y + w01 * P01.y + w11 * P11.y);
    }
  }
  return out;
}

// Grilla de manga "por peldaños": cada fila a lo largo es un segmento recto entre la costura de abajo
// y la de arriba (no se cruzan aunque la manga se doble); una corrección que se desvanece ajusta
// exacto la curva de la sisa (a = 0) y el puño (a = nu). Misma salida que coons().
function loftSleeve(bot, top, arm, cuff) {
  const nu = bot.length - 1;
  const nv = arm.length - 1;
  const sB = arcParams(bot);
  const sT = arcParams(top);
  // parámetro de la sisa = su proyección sobre la cuerda axila→hombro (la corrección queda ⟂ a la cuerda)
  const cx = top[0].x - bot[0].x;
  const cy = top[0].y - bot[0].y;
  const c2 = cx * cx + cy * cy || 1;
  const vArm = arm.map((p) => clamp(((p.x - bot[0].x) * cx + (p.y - bot[0].y) * cy) / c2));
  for (let b = 1; b <= nv; b++) vArm[b] = Math.max(vArm[b], vArm[b - 1] + 1e-6);
  vArm[nv] = 1;
  const out = new Float64Array((nu + 1) * (nv + 1) * 2);
  for (let a = 0; a <= nu; a++) {
    const sa = (sB[a] + sT[a]) / 2;
    const wArm = a === 0 ? 1 : 1 - smoothstep(0, 0.3, sa);
    const wCuff = a === nu ? 1 : smoothstep(0.8, 1, sa);
    const B = bot[a];
    const T = top[a];
    for (let b = 0; b <= nv; b++) {
      const va = vArm[b];
      const v = lerp(b / nv, va, wArm);
      let x = B.x + (T.x - B.x) * v;
      let y = B.y + (T.y - B.y) * v;
      x += wArm * (arm[b].x - (bot[0].x + cx * va));
      y += wArm * (arm[b].y - (bot[0].y + cy * va));
      x += wCuff * (cuff[b].x - (bot[nu].x + (top[nu].x - bot[nu].x) * v));
      y += wCuff * (cuff[b].y - (bot[nu].y + (top[nu].y - bot[nu].y) * v));
      const o = (b * (nu + 1) + a) * 2;
      out[o] = x;
      out[o + 1] = y;
    }
  }
  return out;
}

const segMap = (panel) => Object.fromEntries(panel.segments.map((s) => [s.name, s.points]));
const rev = (a) => a.slice().reverse();
const cat = (a, b) => a.concat(b.slice(1));

// ---------- topología de un panel ----------
// Devuelve la malla 2D (coords planas de prenda) con vértices compartidos entre cuerpo y mangas.
function buildPanelMesh(panel, counts, hasSleeves) {
  const seg = segMap(panel);
  const { nSh, nNk, nSide, nArm, nSl } = counts;
  const armL = hasSleeves ? panel.armholes[0] : seg.sisaIzq; // hombro → axila
  const armR = hasSleeves ? panel.armholes[1] : rev(seg.sisaDer);
  const topRaw = [resampleN(rev(seg.hombroIzq), nSh), resampleN(rev(seg.cuello), nNk), resampleN(rev(seg.hombroDer), nSh)];
  const C1 = cat(cat(topRaw[0], topRaw[1]), topRaw[2]);
  const nu = C1.length - 1;
  const C0 = resampleN(seg.ruedo, nu);
  const armLs = resampleN(rev(armL), nArm); // axila → hombro
  const armRs = resampleN(rev(armR), nArm);
  const D0 = cat(resampleN(rev(seg.costadoIzq), nSide), armLs);
  const D1 = cat(resampleN(seg.costadoDer, nSide), armRs);
  const nv = D0.length - 1;
  const body = coons(C0, C1, D0, D1);

  const nBody = (nu + 1) * (nv + 1);
  let nSleeveV = 0;
  let sleeveL = null;
  let sleeveR = null;
  if (hasSleeves) {
    // u a lo largo de la manga (0 = sisa), v de la costura de abajo (0) a la de arriba (1)
    const mk = (bot, top, cuff, arm) => loftSleeve(resampleN(bot, nSl), resampleN(top, nSl), arm, resampleN(cuff, nArm));
    sleeveL = mk(rev(seg.mangaAbajoIzq), seg.mangaArribaIzq, rev(seg.punoIzq), armLs);
    sleeveR = mk(seg.mangaAbajoDer, rev(seg.mangaArribaDer), seg.punoDer, armRs);
    nSleeveV = nSl * (nArm + 1); // sin la columna de la sisa (compartida)
  }
  const n = nBody + 2 * nSleeveV;
  const flat = new Float32Array(n * 2);
  const region = new Uint8Array(n);
  for (let k = 0; k < nBody * 2; k++) flat[k] = body[k];
  const bodyIdx = (i, j) => j * (nu + 1) + i;
  const sleeveIdx = (which, a, b) => {
    if (a === 0) return bodyIdx(which === 0 ? 0 : nu, nSide + b);
    return nBody + which * nSleeveV + (a - 1) * (nArm + 1) + b;
  };
  if (hasSleeves) {
    [sleeveL, sleeveR].forEach((sg, which) => {
      for (let b = 0; b <= nArm; b++) {
        for (let a = 1; a <= nSl; a++) {
          const v = sleeveIdx(which, a, b);
          const o = (b * (nSl + 1) + a) * 2;
          flat[v * 2] = sg[o];
          flat[v * 2 + 1] = sg[o + 1];
          region[v] = which + 1;
        }
      }
    });
  }

  // triángulos: diagonal más corta de cada cuadrilátero, orientados antihorario en 2D
  const nTri = 2 * (nu * nv + (hasSleeves ? 2 * nSl * nArm : 0));
  const index = new Uint32Array(nTri * 3);
  let ti = 0;
  const quad = (a, b, c, d) => {
    // a(i,j) b(i+1,j) c(i+1,j+1) d(i,j+1)
    const ex = flat[a * 2] - flat[c * 2];
    const ey = flat[a * 2 + 1] - flat[c * 2 + 1];
    const fx = flat[b * 2] - flat[d * 2];
    const fy = flat[b * 2 + 1] - flat[d * 2 + 1];
    if (ex * ex + ey * ey <= fx * fx + fy * fy) {
      index[ti++] = a; index[ti++] = b; index[ti++] = c;
      index[ti++] = a; index[ti++] = c; index[ti++] = d;
    } else {
      index[ti++] = a; index[ti++] = b; index[ti++] = d;
      index[ti++] = b; index[ti++] = c; index[ti++] = d;
    }
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) quad(bodyIdx(i, j), bodyIdx(i + 1, j), bodyIdx(i + 1, j + 1), bodyIdx(i, j + 1));
  const bodyTriCount = ti / 3;
  const sleeveStart = [];
  if (hasSleeves) {
    for (let which = 0; which < 2; which++) {
      sleeveStart.push(ti / 3);
      for (let b = 0; b < nArm; b++) for (let a = 0; a < nSl; a++) quad(sleeveIdx(which, a, b), sleeveIdx(which, a + 1, b), sleeveIdx(which, a + 1, b + 1), sleeveIdx(which, a, b + 1));
    }
  }
  let flipped = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const area = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1]);
    if (area < 0) {
      index[t + 1] = c;
      index[t + 2] = b;
      flipped++;
    }
  }

  // bordes con nombre (cadenas de índices en orden)
  const edges = {};
  edges.ruedo = Array.from({ length: nu + 1 }, (_, i) => bodyIdx(i, 0)); // izq → der
  edges.ruedoIn = Array.from({ length: nu + 1 }, (_, i) => bodyIdx(i, 1));
  edges.cuello = Array.from({ length: nu + 1 - 2 * nSh }, (_, k) => bodyIdx(nSh + k, nv)); // HPS izq → HPS der
  edges.cuelloIn = Array.from({ length: nu + 1 - 2 * nSh }, (_, k) => bodyIdx(nSh + k, nv - 1));
  edges.hombroIzq = Array.from({ length: nSh + 1 }, (_, k) => bodyIdx(nSh - k, nv)); // HPS → SP
  edges.hombroDer = Array.from({ length: nSh + 1 }, (_, k) => bodyIdx(nu - nSh + k, nv));
  edges.costadoIzq = Array.from({ length: nSide + 1 }, (_, j) => bodyIdx(0, nSide - j)); // axila → ruedo
  edges.costadoDer = Array.from({ length: nSide + 1 }, (_, j) => bodyIdx(nu, nSide - j));
  edges.sisaIzq = Array.from({ length: nArm + 1 }, (_, b) => bodyIdx(0, nv - b)); // hombro → axila
  edges.sisaDer = Array.from({ length: nArm + 1 }, (_, b) => bodyIdx(nu, nv - b));
  edges.sisaIzqIn = Array.from({ length: nArm + 1 }, (_, b) => bodyIdx(1, nv - b));
  edges.sisaDerIn = Array.from({ length: nArm + 1 }, (_, b) => bodyIdx(nu - 1, nv - b));
  if (hasSleeves) {
    for (const [which, nm] of [
      [0, 'Izq'],
      [1, 'Der'],
    ]) {
      edges['puno' + nm] = Array.from({ length: nArm + 1 }, (_, b) => sleeveIdx(which, nSl, b)); // abajo → arriba
      edges['puno' + nm + 'In'] = Array.from({ length: nArm + 1 }, (_, b) => sleeveIdx(which, nSl - 1, b));
      edges['mangaArriba' + nm] = Array.from({ length: nSl + 1 }, (_, a) => sleeveIdx(which, a, nArm)); // hombro → puño
      edges['mangaAbajo' + nm] = Array.from({ length: nSl + 1 }, (_, a) => sleeveIdx(which, a, 0)); // axila → puño
    }
  }
  // filas sucesivas hacia adentro de cada borde abierto (para dobladillos que siguen la superficie)
  const ROWS = 6;
  edges.ruedoRows = Array.from({ length: ROWS }, (_, r) => Array.from({ length: nu + 1 }, (_, i) => bodyIdx(i, Math.min(r, nv))));
  edges.sisaIzqRows = Array.from({ length: ROWS }, (_, r) => Array.from({ length: nArm + 1 }, (_, b) => bodyIdx(Math.min(r, nu), nv - b)));
  edges.sisaDerRows = Array.from({ length: ROWS }, (_, r) => Array.from({ length: nArm + 1 }, (_, b) => bodyIdx(Math.max(0, nu - r), nv - b)));
  if (hasSleeves) {
    for (const [which, nm] of [
      [0, 'Izq'],
      [1, 'Der'],
    ]) {
      edges['puno' + nm + 'Rows'] = Array.from({ length: ROWS }, (_, r) => Array.from({ length: nArm + 1 }, (_, b) => sleeveIdx(which, Math.max(0, nSl - r), b)));
    }
  }
  const seam = new Uint8Array(n);
  const seamEdges = ['hombroIzq', 'hombroDer', 'costadoIzq', 'costadoDer'];
  if (hasSleeves) seamEdges.push('mangaArribaIzq', 'mangaArribaDer', 'mangaAbajoIzq', 'mangaAbajoDer');
  for (const e of seamEdges) for (const v of edges[e]) seam[v] = 1;

  return { n, flat, index, region, bodyTriCount, sleeveStart, sleeveTriCount: hasSleeves ? nSl * nArm * 2 : 0, edges, seam, flipped, grid: { nu, nv, nSh, nSide, nArm, nSl } };
}

// Cantidades de muestras (iguales para frente y espalda).
function computeCounts(pattern) {
  const f = segMap(pattern.silhouette.front);
  const b = segMap(pattern.silhouette.back);
  const hasSleeves = pattern.construction.hasSleeves;
  const h = SPACING;
  const nSh = Math.max(4, Math.ceil(polylineLength(f.hombroDer) / h));
  let nNk = Math.max(16, Math.ceil(Math.max(polylineLength(f.cuello), polylineLength(b.cuello)) / h));
  const hemN = Math.ceil(polylineLength(f.ruedo) / (h * 1.2));
  if (2 * nSh + nNk < hemN) nNk = hemN - 2 * nSh;
  if (nNk % 2) nNk++; // el centro del escote cae en un vértice
  const nSide = Math.max(8, Math.ceil(polylineLength(f.costadoDer) / h));
  const arm = hasSleeves ? pattern.silhouette.front.armholes[1] : f.sisaDer;
  const nArm = Math.max(10, Math.ceil(polylineLength(arm) / h));
  const nSl = hasSleeves ? Math.max(6, Math.ceil(Math.max(polylineLength(f.mangaArribaDer), polylineLength(f.mangaAbajoDer)) / h)) : 0;
  return { nSh, nNk, nSide, nArm, nSl };
}

// ---------- campos de inflado ----------
function makeFieldContext(pattern) {
  const c = pattern.construction;
  const f = segMap(pattern.silhouette.front);
  const hasSleeves = c.hasSleeves;
  const seams = [];
  const Rsh = 0.075;
  seams.push({ P: toFlat(f.hombroIzq), kind: 'shoulder', R: Rsh, w: 1 });
  seams.push({ P: toFlat(f.hombroDer), kind: 'shoulder', R: Rsh, w: 1 });
  seams.push({ P: toFlat(f.costadoIzq), kind: 'side', w: 1 });
  seams.push({ P: toFlat(f.costadoDer), kind: 'side', w: 1 });
  const ctx = { seams, hasSleeves, c, sideR: toFlat(rev(f.costadoDer)) };
  if (hasSleeves) {
    const top = [toFlat(f.mangaArribaIzq), toFlat(rev(f.mangaArribaDer))];
    const bot = [toFlat(rev(f.mangaAbajoIzq)), toFlat(f.mangaAbajoDer)];
    ctx.sleeveTop = top;
    ctx.sleeveBot = bot;
    ctx.arm = [toFlat(pattern.silhouette.front.armholes[0]), toFlat(pattern.silhouette.front.armholes[1])];
    for (let s = 0; s < 2; s++) {
      seams.push({ P: top[s], kind: 'sleeve', sleeve: s, w: 1 });
      seams.push({ P: bot[s], kind: 'sleeve', sleeve: s, w: 1 });
    }
  } else {
    // sisa abierta: pellizco parcial para que la boca de la sisa no quede enorme
    ctx.arm = [toFlat(f.sisaIzq), toFlat(rev(f.sisaDer))];
    seams.push({ P: ctx.arm[0], kind: 'arm', R: 0.06, w: 0.55 });
    seams.push({ P: ctx.arm[1], kind: 'arm', R: 0.06, w: 0.55 });
  }
  return ctx;
}

// Medio ancho del cuerpo a la altura y (x del costado derecho).
function bodyHalfWidth(ctx, y) {
  const P = ctx.sideR; // ruedo → axila
  if (y >= P[P.length - 1]) return P[P.length - 2];
  if (y <= P[1]) return P[0];
  for (let i = 2; i < P.length; i += 2) {
    const y0 = P[i - 1];
    const y1 = P[i + 1];
    if ((y0 - y) * (y1 - y) <= 0) return lerp(P[i - 2], P[i], (y - y0) / (y1 - y0 || 1));
  }
  return P[P.length - 2];
}

const NSEAM_MAX = 12;
const _g = new Float64Array(NSEAM_MAX);
const _gp = new Float64Array(NSEAM_MAX);
const _dx = new Float64Array(NSEAM_MAX);
const _dy = new Float64Array(NSEAM_MAX);
const _R = new Float64Array(NSEAM_MAX);
const _pre = new Float64Array(NSEAM_MAX + 1);
const _suf = new Float64Array(NSEAM_MAX + 1);

// Evalúa los campos estáticos en un punto plano. out = { H, gx, gy, R, dmin, sw, Rs }
// `inSleeve`: el punto pertenece a una manga (true) o al cuerpo (false); define el signo de la distancia a la sisa.
export function evalField(ctx, x, y, out, inSleeve = false) {
  let sw = 0;
  let Rs = 0.08;
  if (ctx.hasSleeves) {
    const s = x < 0 ? 0 : 1;
    const A = ctx.arm[s];
    let da = bbDist(A, x, y);
    if (da < 0.05) {
      polyNearest(A, x, y);
      da = NEAR[0];
    }
    sw = smoothstep(-0.02, 0.045, da * (inSleeve ? 1 : -1));
    if (sw > 0) {
      polyNearest(ctx.sleeveTop[s], x, y);
      const dT = NEAR[0];
      polyNearest(ctx.sleeveBot[s], x, y);
      const dB = NEAR[0];
      Rs = clamp(0.5 * (dT + dB), 0.03, 0.2);
    }
  }
  const Wy = Math.max(0.05, bodyHalfWidth(ctx, y));
  const seams = ctx.seams;
  const m = seams.length;
  let dmin = Infinity;
  let pinch = 1;
  for (let i = 0; i < m; i++) {
    const sm = seams[i];
    let R;
    if (sm.kind === 'side') R = lerp(Wy, Rs, sw);
    else if (sm.kind === 'sleeve') R = lerp(0.045, Rs, sw); // en el cuerpo solo pellizca la esquina
    else R = sm.R;
    _R[i] = R;
    const db = bbDist(sm.P, x, y);
    if (db >= R) {
      // lejos: no influye (la caja ya está más lejos que el radio)
      _g[i] = 1;
      _gp[i] = 0;
      _dx[i] = _dy[i] = 0;
      if (sm.w >= 1 && db < dmin) dmin = db;
      continue;
    }
    polyNearest(sm.P, x, y);
    const d = NEAR[0];
    if (d > 1e-9) {
      _dx[i] = (x - NEAR[1]) / d;
      _dy[i] = (y - NEAR[2]) / d;
    } else {
      _dx[i] = 0;
      _dy[i] = 0;
    }
    const s = d / R;
    if (sm.w < 1) {
      // borde abierto con pellizco parcial: solo baja la altura, no "envuelve" ni retrae
      pinch *= 1 - sm.w * (1 - gRamp(s));
      _g[i] = 1;
      _gp[i] = 0;
      continue;
    }
    if (d < dmin) dmin = d;
    _g[i] = gRamp(s);
    _gp[i] = gRampD(s) / R;
  }
  _pre[0] = 1;
  for (let i = 0; i < m; i++) _pre[i + 1] = _pre[i] * _g[i];
  _suf[m] = 1;
  for (let i = m - 1; i >= 0; i--) _suf[i] = _suf[i + 1] * _g[i];
  const H = _pre[m];
  let gx = 0;
  let gy = 0;
  let cs = 0;
  let cr = 0;
  for (let i = 0; i < m; i++) {
    const others = _pre[i] * _suf[i + 1];
    const c = others * _gp[i];
    gx += c * _dx[i];
    gy += c * _dy[i];
    cs += c;
    cr += c * _R[i];
  }
  const gl = Math.hypot(gx, gy);
  out.H = H;
  out.gx = gl > 1e-9 ? gx / gl : 0;
  out.gy = gl > 1e-9 ? gy / gl : 0;
  out.R = cs > 1e-9 ? cr / cs : Wy;
  out.dmin = dmin;
  out.pinch = pinch;
  out.sw = sw;
  out.Rs = Rs;
  out.Wy = Wy;
  return out;
}

// Pliegues de caída (metros, con inflado 1). Distintos para frente y espalda.
function drapeAt(ctx, x, y, isBack, sw) {
  const c = ctx.c;
  const L = c.L;
  const ph = isBack ? 1.7 : 0;
  // pliegues verticales suaves que crecen hacia el ruedo (con leve ondulación y asimetría)
  const grow = smoothstep(-0.2, -L * 0.98, y);
  let v =
    grow *
    (0.0036 * Math.sin((x / 0.12) * Math.PI * 2 + ph + 0.9 * Math.sin(y * 4.1 + ph)) +
      0.0022 * Math.sin((x / 0.074) * Math.PI * 2 + 2.1 + ph + 0.7 * Math.sin(y * 6.3)) +
      0.0011 * Math.sin((x / 0.045) * Math.PI * 2 + 0.4 - ph) +
      0.0024 * Math.sin(x * 5.3 + y * 2.7 + ph * 2.3));
  // el ruedo cuelga con una onda propia
  const hemW = smoothstep(-L + 0.1, -L, y);
  v += hemW * 0.0024 * Math.sin((x / 0.085) * Math.PI * 2 + 1.3 + ph);
  // líneas de tensión desde las axilas hacia el centro del pecho
  for (const sgn of [-1, 1]) {
    const ax = sgn * c.UA.x;
    const ay = c.UA.y + 0.01;
    const dx = -sgn * 0.6;
    const dy = -0.8;
    const px = x - ax;
    const py = y - ay;
    const t = px * dx + py * dy;
    if (t > 0 && t < 0.26) {
      const d = px * dy - py * dx;
      const taper = Math.sin((t / 0.26) * Math.PI) ** 0.8;
      v -= (isBack ? 0.0026 : 0.0042) * taper * Math.exp(-((d / 0.03) ** 2)) * (1 - sw);
      v += (isBack ? 0.0012 : 0.0018) * taper * Math.exp(-(((d - sgn * 0.035) / 0.022) ** 2)) * (1 - sw);
    }
  }
  // en las mangas: pliegues suaves a lo largo, cerca de la axila
  if (sw > 0 && ctx.hasSleeves) {
    const s = x < 0 ? 0 : 1;
    polyNearest(ctx.sleeveBot[s], x, y);
    const d = NEAR[0];
    v += sw * 0.0034 * Math.sin(d / 0.017 + ph + x * 9) * Math.exp(-d / 0.07);
  }
  return v;
}

// ---------- panel 3D ----------
export class PanelSurface {
  constructor(mesh, side, ctx, pattern) {
    this.side = side;
    this.sign = side === 'frente' ? 1 : -1;
    Object.assign(this, mesh);
    const n = this.n;
    this.H = new Float32Array(n);
    this.gx = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.Reff = new Float32Array(n);
    this.dmin = new Float32Array(n);
    this.Zb = new Float32Array(n);
    this.drape = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.baseN = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.ao = new Float32Array(n);
    this.wSoft = new Float32Array(n);
    this.wSharp = new Float32Array(n);
    this.wGain = new Float32Array(n);
    this.wDisp = new Float32Array(n);
    const c = pattern.construction;
    const Zc = 0.42 * c.UA.x;
    const back = side === 'espalda';
    const F = {};
    for (let v = 0; v < n; v++) {
      const x = this.flat[v * 2];
      const y = this.flat[v * 2 + 1];
      evalField(ctx, x, y, F, this.region[v] > 0);
      let H = F.H;
      if (this.seam[v]) H = 0;
      this.H[v] = H;
      this.gx[v] = F.gx;
      this.gy[v] = F.gy;
      this.Reff[v] = F.R;
      this.dmin[v] = F.dmin;
      const bodyY = (0.6 + 0.4 * smoothstep(-0.005, -0.2, y)) * (1 - 0.05 * smoothstep(-0.3, -c.L, y));
      const zBody = Zc * bodyY * (back ? 0.9 : 1);
      const zSleeve = 0.7 * F.Rs;
      this.Zb[v] = lerp(zBody, zSleeve, F.sw) * F.pinch;
      this.drape[v] = drapeAt(ctx, x, y, back, F.sw) * smoothstep(0.12, 0.55, H);
      this.wGain[v] = smoothstep(0.0, 0.28, H);
      this.ao[v] = 0.76 + 0.24 * smoothstep(0.0, 0.5, H);
    }
  }

  // Posiciones base (inflado k, sin arrugas).
  computeBase(k) {
    const n = this.n;
    const ke = Math.max(k, 0.035);
    const B = this.base;
    for (let v = 0; v < n; v++) {
      const x = this.flat[v * 2];
      const y = this.flat[v * 2 + 1];
      const Zm = ke * this.Zb[v];
      const R = this.Reff[v];
      const sigma = this.H[v];
      const zn = Zm / R;
      const phi = phiOf(sigma, zn);
      const p = 1 - Math.cos(phi);
      let r = R * (gInv(sigma) - p);
      if (r < 0) r = 0;
      const rmax = 0.95 * this.dmin[v];
      if (r > rmax) r = rmax;
      B[v * 3] = x - this.gx[v] * r;
      B[v * 3 + 1] = y - this.gy[v] * r;
      B[v * 3 + 2] = this.sign * (Zm * Math.sin(phi) + k * this.drape[v]);
    }
  }
}

// Normales ponderadas por área.
export function computeNormals(pos, index, out) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const e1x = pos[b] - pos[a];
    const e1y = pos[b + 1] - pos[a + 1];
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a];
    const e2y = pos[c + 1] - pos[a + 1];
    const e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    out[a] += nx;
    out[a + 1] += ny;
    out[a + 2] += nz;
    out[b] += nx;
    out[b + 1] += ny;
    out[b + 2] += nz;
    out[c] += nx;
    out[c + 1] += ny;
    out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l;
    out[i + 1] /= l;
    out[i + 2] /= l;
  }
}

// Promedia las normales de las costuras entre frente y espalda (unión sin quiebre).
export function blendSeamNormals(front, back, nf, nb) {
  const s = front.seam;
  for (let v = 0; v < front.n; v++) {
    if (!s[v]) continue;
    const i = v * 3;
    let x = nf[i] + nb[i];
    let y = nf[i + 1] + nb[i + 1];
    let z = nf[i + 2] + nb[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    nf[i] = nb[i] = x;
    nf[i + 1] = nb[i + 1] = y;
    nf[i + 2] = nb[i + 2] = z;
  }
}

// Arma frente y espalda para un molde.
export function buildSurfaces(pattern) {
  const counts = computeCounts(pattern);
  const hasSleeves = pattern.construction.hasSleeves;
  const ctx = makeFieldContext(pattern);
  const fm = buildPanelMesh(pattern.silhouette.front, counts, hasSleeves);
  const bm = buildPanelMesh(pattern.silhouette.back, counts, hasSleeves);
  // la espalda mira a −Z: invertir el orden de los triángulos
  for (let t = 0; t < bm.index.length; t += 3) {
    const b = bm.index[t + 1];
    bm.index[t + 1] = bm.index[t + 2];
    bm.index[t + 2] = b;
  }
  const front = new PanelSurface(fm, 'frente', ctx, pattern);
  const back = new PanelSurface(bm, 'espalda', ctx, pattern);
  return { front, back, ctx, counts };
}

// ---------- índice espacial de triángulos (coordenadas planas) ----------
export class TriIndex {
  constructor(flat, index, cell = 0.02) {
    this.flat = flat;
    this.index = index;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
      minX = Math.min(minX, flat[i]);
      maxX = Math.max(maxX, flat[i]);
      minY = Math.min(minY, flat[i + 1]);
      maxY = Math.max(maxY, flat[i + 1]);
    }
    this.x0 = minX - 1e-4;
    this.y0 = minY - 1e-4;
    this.cell = cell;
    this.nx = Math.ceil((maxX - minX) / cell) + 1;
    this.ny = Math.ceil((maxY - minY) / cell) + 1;
    const lists = Array.from({ length: this.nx * this.ny }, () => []);
    for (let t = 0; t < index.length; t += 3) {
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = index[t + k];
        a0 = Math.min(a0, flat[v * 2]);
        a1 = Math.max(a1, flat[v * 2]);
        b0 = Math.min(b0, flat[v * 2 + 1]);
        b1 = Math.max(b1, flat[v * 2 + 1]);
      }
      const i0 = Math.floor((a0 - this.x0) / cell);
      const i1 = Math.floor((a1 - this.x0) / cell);
      const j0 = Math.floor((b0 - this.y0) / cell);
      const j1 = Math.floor((b1 - this.y0) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * this.nx + i].push(t / 3);
    }
    this.lists = lists.map((l) => Int32Array.from(l));
  }
  // Devuelve {a,b,c,w0,w1,w2,inside} (baricéntricas) o null si queda lejos de la malla.
  query(x, y, maxDist = 0.03) {
    const { flat, index, cell } = this;
    const ci = Math.floor((x - this.x0) / cell);
    const cj = Math.floor((y - this.y0) / cell);
    let best = null;
    let bestD = Infinity;
    const rings = Math.ceil(maxDist / cell) + 1;
    for (let ring = 0; ring <= rings; ring++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        for (let i = ci - ring; i <= ci + ring; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
          const list = this.lists[j * this.nx + i];
          for (let k = 0; k < list.length; k++) {
            const t = list[k] * 3;
            const a = index[t];
            const b = index[t + 1];
            const c = index[t + 2];
            const ax = flat[a * 2];
            const ay = flat[a * 2 + 1];
            const v0x = flat[b * 2] - ax;
            const v0y = flat[b * 2 + 1] - ay;
            const v1x = flat[c * 2] - ax;
            const v1y = flat[c * 2 + 1] - ay;
            const v2x = x - ax;
            const v2y = y - ay;
            const den = v0x * v1y - v1x * v0y;
            if (Math.abs(den) < 1e-14) continue;
            let w1 = (v2x * v1y - v1x * v2y) / den;
            let w2 = (v0x * v2y - v2x * v0y) / den;
            let w0 = 1 - w1 - w2;
            if (w0 >= -1e-7 && w1 >= -1e-7 && w2 >= -1e-7) return { a, b, c, w0, w1, w2, inside: true };
            // distancia aproximada al triángulo (baricéntricas recortadas)
            w0 = Math.max(0, w0);
            w1 = Math.max(0, w1);
            w2 = Math.max(0, w2);
            const s = w0 + w1 + w2;
            w0 /= s;
            w1 /= s;
            w2 /= s;
            const px = ax + v0x * w1 + v1x * w2;
            const py = ay + v0y * w1 + v1y * w2;
            const d = Math.hypot(px - x, py - y);
            if (d < bestD) {
              bestD = d;
              best = { a, b, c, w0, w1, w2, inside: false };
            }
          }
        }
      }
      if (best && bestD < (ring - 1) * cell) break;
    }
    return best && bestD <= maxDist ? best : null;
  }
}
