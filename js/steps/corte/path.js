// Corte · geometría del recorrido de corte: el contorno de un molde (en coords de tela {x, z})
// remuestreado cada pocos milímetros como un lazo cerrado que arranca en un punto y va en un
// sentido, con normales hacia afuera, curvatura, búsqueda del punto más cercano y cintas con
// desplazamiento variable por vértice (para la tiza partida por el corte y la ranura del corte).

import * as THREE from 'three';
import { resamplePolyline } from '../../core/utils.js';

export const STEP = 0.004; // separación de muestras (m)

function signedAreaXZ(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

// Contorno cerrado en coords de tela → muestras parejas (sin repetir el primer punto al final).
export function resampleLoop(outline, step = STEP) {
  const pts = resamplePolyline(outline.map((p) => ({ x: p.x, y: p.z })), step, true).map((p) => ({ x: p.x, z: p.y }));
  // resamplePolyline con closed=true puede repetir el arranque al final
  while (pts.length > 3) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < step * 0.5) pts.pop();
    else break;
  }
  return pts;
}

// Índice del punto del lazo más cercano a (x, z).
export function nearestIndex(pts, x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// Arma el recorrido: arranca en `start` (índice del lazo) y va en sentido `dir` (1 | -1).
export function buildPath(loop, start = 0, dir = 1) {
  const n = loop.length;
  const pts = new Array(n);
  for (let k = 0; k < n; k++) pts[k] = loop[(((start + dir * k) % n) + n) % n];
  const outward = signedAreaXZ(pts) > 0 ? 1 : -1;
  const cum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  const ang = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p2 = pts[(i + 1) % n];
    let dx = p2.x - p0.x;
    let dz = p2.z - p0.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    tx[i] = dx;
    tz[i] = dz;
    nx[i] = outward * dz;
    nz[i] = -outward * dx;
    ang[i] = Math.atan2(dz, dx);
  }
  // curvatura (1/m) suavizada: cambio de dirección por unidad de largo
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = ang[(i + 1) % n] - ang[i];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    raw[i] = Math.abs(d) / Math.max(1e-6, cum[i + 1] - cum[i]);
  }
  const curv = new Float32Array(n);
  const W = 4;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -W; k <= W; k++) s += raw[(((i + k) % n) + n) % n];
    curv[i] = s / (2 * W + 1);
  }
  return { pts, cum, total: cum[n], count: n, tx, tz, nx, nz, curv, dir, start };
}

// Índice del tramo que contiene el largo s (0 ≤ s ≤ total).
export function segAt(path, s) {
  const { cum, count } = path;
  if (s <= 0) return 0;
  if (s >= path.total) return count - 1;
  let lo = 0;
  let hi = count;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Punto, tangente y normal (hacia afuera) a lo largo s.
export function pointAt(path, s, out = {}) {
  const i = segAt(path, s);
  const j = (i + 1) % path.count;
  const len = path.cum[i + 1] - path.cum[i] || 1e-9;
  const f = Math.min(1, Math.max(0, (s - path.cum[i]) / len));
  const a = path.pts[i];
  const b = path.pts[j];
  out.x = a.x + (b.x - a.x) * f;
  out.z = a.z + (b.z - a.z) * f;
  let tx = path.tx[i] + (path.tx[j] - path.tx[i]) * f;
  let tz = path.tz[i] + (path.tz[j] - path.tz[i]) * f;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  out.tx = tx;
  out.tz = tz;
  let nx = path.nx[i] + (path.nx[j] - path.nx[i]) * f;
  let nz = path.nz[i] + (path.nz[j] - path.nz[i]) * f;
  const nl = Math.hypot(nx, nz) || 1;
  out.nx = nx / nl;
  out.nz = nz / nl;
  out.curv = path.curv[i] + (path.curv[j] - path.curv[i]) * f;
  out.i = i;
  out.f = f;
  return out;
}

// Curvatura máxima en [s0, s1] (para frenar antes de una curva).
export function maxCurv(path, s0, s1) {
  const i0 = segAt(path, Math.max(0, s0));
  const i1 = segAt(path, Math.min(path.total, s1));
  let m = 0;
  for (let i = i0; i <= i1; i++) m = Math.max(m, path.curv[i]);
  return m;
}

// Punto del recorrido más cercano a (x, z) con s en [s0, s1].
// Devuelve { s, d (distancia), side (distancia con signo: + afuera), x, z }.
export function closest(path, x, z, s0, s1, out = {}) {
  const lo = Math.max(0, s0);
  const hi = Math.min(path.total, s1);
  const i0 = segAt(path, lo);
  const i1 = segAt(path, hi);
  let bestD = Infinity;
  let bestS = lo;
  let bx = 0;
  let bz = 0;
  for (let i = i0; i <= i1; i++) {
    const a = path.pts[i];
    const b = path.pts[(i + 1) % path.count];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1e-12;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let s = path.cum[i] + t * (path.cum[i + 1] - path.cum[i]);
    if (s < lo) s = lo;
    if (s > hi) s = hi;
    const qx = a.x + dx * t;
    const qz = a.z + dz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < bestD) {
      bestD = d;
      bestS = s;
      bx = qx;
      bz = qz;
    }
  }
  const p = pointAt(path, bestS);
  out.s = bestS;
  out.d = bestD;
  out.x = bx;
  out.z = bz;
  out.side = (x - bx) * p.nx + (z - bz) * p.nz;
  out.nx = p.nx;
  out.nz = p.nz;
  return out;
}

// ---------------------------------------------------------------------------
// Cintas sobre la tela (plano XZ, cara hacia +Y) con desplazamientos por vértice.
// pts/normales en coords de tela; d0[i], d1[i] = desplazamientos (m) sobre la normal.
// ---------------------------------------------------------------------------

export function offsetRibbon(pts, nrm, d0, d1, { closed = true, y = 0 } = {}) {
  const n = pts.length;
  const m = closed ? n + 1 : n;
  const pos = new Float32Array(m * 2 * 3);
  const uv = new Float32Array(m * 2 * 2);
  let len = 0;
  for (let k = 0; k < m; k++) {
    const i = k % n;
    if (k > 0) {
      const a = pts[(k - 1) % n];
      len += Math.hypot(pts[i].x - a.x, pts[i].z - a.z);
    }
    const p = pts[i];
    const q = nrm[i];
    let a0 = typeof d0 === 'number' ? d0 : d0[i];
    let a1 = typeof d1 === 'number' ? d1 : d1[i];
    if (a1 < a0) a1 = a0; // cinta vacía en este tramo
    pos.set([p.x + q.x * a0, y, p.z + q.z * a0, p.x + q.x * a1, y, p.z + q.z * a1], k * 6);
    uv.set([len, 0, len, 1], k * 4);
  }
  const idx = [];
  for (let k = 0; k < m - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  faceUp(g);
  g.computeVertexNormals();
  g.userData.length = len;
  return g;
}

// Da vuelta los triángulos que miran hacia abajo (así todas las caras quedan hacia +Y).
export function faceUp(g) {
  const pos = g.attributes.position.array;
  const ia = g.index.array;
  for (let t = 0; t < ia.length; t += 3) {
    const a = ia[t] * 3;
    const b = ia[t + 1] * 3;
    const c = ia[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vz = pos[c + 2] - pos[a + 2];
    if (uz * vx - ux * vz < 0) {
      const tmp = ia[t + 1];
      ia[t + 1] = ia[t + 2];
      ia[t + 2] = tmp;
    }
  }
  return g;
}

// Cinta dinámica (ranura del corte, guía): se reescribe cada frame. Capacidad fija de vértices.
export function dynamicRibbon(capacity) {
  const pos = new Float32Array((capacity + 1) * 2 * 3);
  const uv = new Float32Array((capacity + 1) * 2 * 2);
  const idx = new Uint32Array(capacity * 6);
  for (let k = 0; k < capacity; k++) {
    const a = k * 2;
    idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], k * 6);
  }
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3);
  pa.setUsage(THREE.DynamicDrawUsage);
  const ua = new THREE.BufferAttribute(uv, 2);
  ua.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('uv', ua);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  let count = 0;
  let len = 0;
  let last = null;
  let tipOn = false;
  const write = (k, x, z, nx, nz, w0, w1, y, l) => {
    pos[k * 6] = x + nx * w0;
    pos[k * 6 + 1] = y;
    pos[k * 6 + 2] = z + nz * w0;
    pos[k * 6 + 3] = x + nx * w1;
    pos[k * 6 + 4] = y;
    pos[k * 6 + 5] = z + nz * w1;
    uv[k * 4] = l;
    uv[k * 4 + 1] = 0;
    uv[k * 4 + 2] = l;
    uv[k * 4 + 3] = 1;
    pa.needsUpdate = true;
    ua.needsUpdate = true;
  };
  const range = () => g.setDrawRange(0, Math.max(0, count - 1 + (tipOn && count > 0 ? 1 : 0)) * 6);
  return {
    geometry: g,
    get count() {
      return count;
    },
    get length() {
      return len;
    },
    reset() {
      count = 0;
      len = 0;
      last = null;
      tipOn = false;
      g.setDrawRange(0, 0);
    },
    // agrega un vértice fijo: centro (x, z), normal (nx, nz) y desplazamientos w0..w1 sobre la normal
    push(x, z, nx, nz, w0, w1, y = 0) {
      if (count >= capacity) return;
      if (last) len += Math.hypot(x - last.x, z - last.z);
      last = { x, z };
      write(count, x, z, nx, nz, w0, w1, y, len);
      count++;
      tipOn = false;
      range();
    },
    // punta provisoria (después del último vértice fijo), para que siga a la herramienta
    tip(x, z, nx, nz, w0, w1, y = 0) {
      if (count === 0 || count >= capacity) return;
      const l = len + (last ? Math.hypot(x - last.x, z - last.z) : 0);
      write(count, x, z, nx, nz, w0, w1, y, l);
      tipOn = true;
      range();
    },
  };
}

// Normales {x, z} (de un buildPath) como lista de objetos, para offsetRibbon.
export function normalsOf(path) {
  const out = new Array(path.count);
  for (let i = 0; i < path.count; i++) out[i] = { x: path.nx[i], z: path.nz[i] };
  return out;
}
