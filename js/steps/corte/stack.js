// Corte · la pila de piezas cortadas. Cada pieza, al levantarse, se dobla como en el taller:
// al medio por la línea de hilo y, si es larga, otra vez a lo ancho. Las piezas dobladas se
// apilan en un lugar libre que se elige mirando la distribución del tizado:
//   1) sobre la tela que sobra (lejos de todos los moldes, cortados o no), si entra;
//   2) si no, sobre la base de corte, adentro del hueco que deja la primera pieza (el frente).
// Así la pila nunca tapa una pieza que todavía hay que cortar ni queda "flotando" sobre un hueco.

import * as THREE from 'three';
import { rasterRuns } from '../tizado/raster.js';

export const SQUASH = 0.5; // las capas apiladas se aplastan (la tela de la mesa tiene 3,5 mm de "espesor")

// ¿Cómo se dobla una pieza? (coords locales de la pieza: centrada en su caja, x a lo ancho, y = hilo)
export function foldPlan(piece) {
  const w = piece.width;
  const h = piece.height;
  const a = w >= 0.12; // al medio por la línea de hilo (eje y de la pieza)
  const b = h > 0.45; // otra vez a lo ancho, si queda larga
  return {
    a,
    b,
    fw: a ? w / 2 : w,
    fh: b ? h / 2 : h,
    layers: (a ? 2 : 1) * (b ? 2 : 1),
    // huella de la pieza doblada, en coords locales de la pieza
    x0: a ? 0 : -w / 2,
    x1: w / 2,
    y0: b ? 0 : -h / 2,
    y1: h / 2,
  };
}

// Recorte de un polígono {x, y} por el semiplano sign·(p[axis] − v) ≥ 0 (Sutherland–Hodgman).
export function clipHalf(pts, axis, v, sign) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const da = sign * (a[axis] - v);
    const db = sign * (b[axis] - v);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  // sin puntos repetidos
  const clean = [];
  for (const p of out) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) clean.push(p);
  }
  while (clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) <= 1e-6) clean.pop();
  return clean;
}

const areaOf = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return Math.abs(a / 2);
};

// Partes que se doblan por separado: [{ pts, xneg, yneg }] (pts en coords locales de la pieza).
export function foldParts(localOutline, plan) {
  let parts = [{ pts: localOutline, xneg: false, yneg: false }];
  if (plan.a) parts = parts.flatMap((p) => [
    { pts: clipHalf(p.pts, 'x', 0, 1), xneg: false, yneg: p.yneg },
    { pts: clipHalf(p.pts, 'x', 0, -1), xneg: true, yneg: p.yneg },
  ]);
  if (plan.b) parts = parts.flatMap((p) => [
    { pts: clipHalf(p.pts, 'y', 0, 1), xneg: p.xneg, yneg: false },
    { pts: clipHalf(p.pts, 'y', 0, -1), xneg: p.xneg, yneg: true },
  ]);
  return parts.filter((p) => p.pts.length >= 3 && areaOf(p.pts) > 1e-5);
}

// Matriz de una parte con los dobleces a medio hacer (ta, tb: 0..π), en el espacio de la malla
// de createPieceMesh (x = x de la pieza, y = arriba, z = −y de la pieza). th = espesor de una capa.
const _t = new THREE.Matrix4();
const _r = new THREE.Matrix4();
export function foldMatrix(out, part, plan, th, ta, tb) {
  out.identity();
  if (part.xneg && plan.a && ta > 0) {
    // bisagra sobre la línea de hilo (x = 0), a la altura de la cara de arriba
    out.premultiply(_t.makeTranslation(0, -th, 0));
    out.premultiply(_r.makeRotationZ(-ta));
    out.premultiply(_t.makeTranslation(0, th, 0));
  }
  if (part.yneg && plan.b && tb > 0) {
    const yb = (plan.a ? 2 : 1) * th;
    out.premultiply(_t.makeTranslation(0, -yb, 0));
    out.premultiply(_r.makeRotationX(-tb));
    out.premultiply(_t.makeTranslation(0, yb, 0));
  }
  return out;
}

// Contorno de la pieza ya doblada (para su sombra): la parte que queda quieta.
export function foldedOutline(localOutline, plan) {
  let p = localOutline;
  if (plan.a) p = clipHalf(p, 'x', 0, 1);
  if (plan.b) p = clipHalf(p, 'y', 0, 1);
  return p;
}

// ---------------------------------------------------------------------------
// Lugar de la pila
// ---------------------------------------------------------------------------

function dilate(mask, cols, rows, rad) {
  if (rad <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c]) continue;
      const a = Math.max(0, c - rad);
      const b = Math.min(cols - 1, c + rad);
      for (let k = a; k <= b; k++) tmp[r * cols + k] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!tmp[r * cols + c]) continue;
      const a = Math.max(0, r - rad);
      const b = Math.min(rows - 1, r + rad);
      for (let k = a; k <= b; k++) out[k * cols + c] = 1;
    }
  }
  return out;
}

function summed(mask, cols, rows) {
  const S = new Int32Array((cols + 1) * (rows + 1));
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    for (let c = 0; c < cols; c++) {
      acc += mask[r * cols + c];
      S[(r + 1) * (cols + 1) + c + 1] = S[r * (cols + 1) + c + 1] + acc;
    }
  }
  return (c0, r0, c1, r1) => S[r1 * (cols + 1) + c1] - S[r0 * (cols + 1) + c1] - S[r1 * (cols + 1) + c0] + S[r0 * (cols + 1) + c0];
}

// Mejor rectángulo libre de `blocked` (dimX × dimZ en m, en las dos orientaciones) según score(cx, cz).
function bestRect(blocked, cols, rows, cell, short, long, score) {
  const sum = summed(blocked, cols, rows);
  let best = null;
  for (const longAxis of ['z', 'x']) {
    const ax = Math.ceil((longAxis === 'z' ? short : long) / cell);
    const az = Math.ceil((longAxis === 'z' ? long : short) / cell);
    if (ax > cols || az > rows) continue;
    for (let r = 0; r + az <= rows; r++) {
      for (let c = 0; c + ax <= cols; c++) {
        if (sum(c, r, c + ax, r + az)) continue;
        const cx = (c + ax / 2) * cell;
        const cz = (r + az / 2) * cell;
        const s = score(cx, cz, longAxis);
        if (!best || s > best.s) best = { s, x: cx, z: cz, longAxis };
      }
    }
  }
  return best;
}

// outlines: [{ id, pts: [{x, z}] }] contornos de corte de TODAS las piezas (coords de tela).
// host: contorno de la primera pieza (hueco de respaldo). foot: { short, long } de la pila (m).
export function findStackSpot({ outlines, host, foot, L, W, cell = 0.01, margin = 0.03, edge = 0.035, endPad = 0.075, hostMargin = 0.03 }) {
  const cols = Math.ceil(L / cell);
  const rows = Math.ceil(W / cell);
  // 1) tela libre: ni moldes (con margen) ni orillos ni el rollo
  let blocked = new Uint8Array(cols * rows);
  for (const o of outlines) for (const run of rasterRuns(o.pts, cell, cols, rows)) for (let c = run.c0; c < run.c1; c++) blocked[run.r * cols + c] = 1;
  blocked = dilate(blocked, cols, rows, Math.ceil(margin / cell));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cell;
      const z = (r + 0.5) * cell;
      if (x < edge || x > L - endPad || z < edge || z > W - edge) blocked[r * cols + c] = 1;
    }
  }
  // preferido: lo más cerca posible del final de la tela (el sobrante), centrado a lo ancho
  const free = bestRect(blocked, cols, rows, cell, foot.short, foot.long, (cx, cz, ax) => cx - 0.35 * Math.abs(cz - W / 2) + (ax === 'z' ? 0.02 : 0));
  if (free) return { x: free.x, z: free.z, longAxis: free.longAxis, inHole: false };
  // 2) adentro del hueco de la primera pieza (sobre la base de corte)
  if (host) {
    let inside = new Uint8Array(cols * rows);
    for (const run of rasterRuns(host.pts, cell, cols, rows)) for (let c = run.c0; c < run.c1; c++) inside[run.r * cols + c] = 1;
    let out = new Uint8Array(cols * rows);
    for (let i = 0; i < out.length; i++) out[i] = inside[i] ? 0 : 1;
    out = dilate(out, cols, rows, Math.ceil(hostMargin / cell));
    let mx = 0;
    let mz = 0;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!inside[r * cols + c]) continue;
        mx += (c + 0.5) * cell;
        mz += (r + 0.5) * cell;
        n++;
      }
    }
    mx /= n || 1;
    mz /= n || 1;
    const fit = bestRect(out, cols, rows, cell, foot.short, foot.long, (cx, cz) => -Math.hypot(cx - mx, cz - mz));
    if (fit) return { x: fit.x, z: fit.z, longAxis: fit.longAxis, inHole: true, hostId: host.id };
    // no debería pasar (el frente siempre es más grande que cualquier pieza doblada)
    return { x: mx, z: mz, longAxis: 'x', inHole: true, hostId: host.id, tight: true };
  }
  return { x: L - endPad - foot.short / 2, z: W / 2, longAxis: 'z', inHole: false, tight: true };
}

// Rotación (alrededor de Y) para que el lado largo de la pieza doblada quede a lo largo de longAxis,
// la más cercana a `from` (así no da media vuelta de más).
export function stackRotation(plan, longAxis, from = 0) {
  // con rot = 0 la y de la pieza va a lo largo de z
  let base = longAxis === 'z' ? 0 : Math.PI / 2;
  if (plan.fw > plan.fh) base += Math.PI / 2;
  let best = base;
  let bd = Infinity;
  for (const k of [-2, -1, 0, 1, 2]) {
    const r = base + k * Math.PI;
    const d = Math.abs(Math.atan2(Math.sin(r - from), Math.cos(r - from)));
    if (d < bd) {
      bd = d;
      best = from + Math.atan2(Math.sin(r - from), Math.cos(r - from));
    }
  }
  return best;
}

// Centro de la huella doblada en el espacio de la malla (x, z), para ubicarla en la pila.
export function foldedCenter(plan) {
  return { x: (plan.x0 + plan.x1) / 2, z: -(plan.y0 + plan.y1) / 2 };
}

// Tamaño de la pila: la huella más grande de las piezas dobladas (lado corto, lado largo) + juego.
export function stackFoot(pieces, slack = 0.024) {
  let short = 0;
  let long = 0;
  for (const p of pieces) {
    const f = foldPlan(p);
    short = Math.max(short, Math.min(f.fw, f.fh));
    long = Math.max(long, Math.max(f.fw, f.fh));
  }
  return { short: short + slack, long: long + slack };
}

// desorden prolijo de la pila (m, m, rad): ninguna pieza queda exactamente sobre la otra
const JITTER = [
  [-0.004, -0.003, -0.03],
  [0.004, 0.005, 0.035],
  [0.001, -0.005, -0.012],
  [-0.005, 0.004, 0.026],
  [0.005, -0.002, -0.022],
  [-0.002, 0.005, 0.015],
  [0.003, 0.002, -0.034],
];

// Pose final de la k-ésima pieza de la pila: posición del origen de la malla (coords de tela) y rotación Y.
export function stackPose(plan, spot, k, fromRot = 0) {
  const [jx, jz, jr] = JITTER[k % JITTER.length];
  const rot = stackRotation(plan, spot.longAxis, fromRot) + jr;
  const c = foldedCenter(plan);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  return { x: spot.x + jx - (c.x * cs + c.z * sn), z: spot.z + jz - (-c.x * sn + c.z * cs), rot };
}

// Esquinas de la huella doblada en esa pose (coords de tela), para chequeos.
export function footprintAt(plan, pose) {
  const cs = Math.cos(pose.rot);
  const sn = Math.sin(pose.rot);
  return [
    [plan.x0, -plan.y1],
    [plan.x1, -plan.y1],
    [plan.x1, -plan.y0],
    [plan.x0, -plan.y0],
  ].map(([X, Z]) => ({ x: pose.x + X * cs + Z * sn, z: pose.z - X * sn + Z * cs }));
}
