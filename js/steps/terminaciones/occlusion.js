// Oclusión rápida para la lupa de hilos: grilla uniforme 3D con los triángulos de los paneles
// de la remera. three r170 no trae BVH y un rayo contra los ~24 k triángulos de cada panel
// cuesta milisegundos; con la grilla cada rayo prueba unas decenas de triángulos y se puede
// consultar varias veces por cuadro sin tirones.
//
// createOccluder(meshes) → { blocked(fromWorld, toWorld, margin) → bool }
// "blocked" = algún triángulo corta el segmento antes de llegar a `margin` metros del destino.
// Respeta material.side (FrontSide / BackSide / DoubleSide) igual que Mesh.raycast.

import * as THREE from 'three';

const CELL = 0.024; // m

function buildGrid(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position.array;
  const index = geo.index ? geo.index.array : null;
  const nTri = index ? index.length / 3 : pos.length / 9;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const pad = 1e-4;
  x0 -= pad;
  y0 -= pad;
  z0 -= pad;
  x1 += pad;
  y1 += pad;
  z1 += pad;
  const nx = Math.max(1, Math.ceil((x1 - x0) / CELL));
  const ny = Math.max(1, Math.ceil((y1 - y0) / CELL));
  const nz = Math.max(1, Math.ceil((z1 - z0) / CELL));
  const nCells = nx * ny * nz;
  const vi = (t, k) => (index ? index[t * 3 + k] : t * 3 + k);
  const cellRange = (t, out) => {
    let ax = Infinity;
    let ay = Infinity;
    let az = Infinity;
    let bx = -Infinity;
    let by = -Infinity;
    let bz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const o = vi(t, k) * 3;
      const x = pos[o];
      const y = pos[o + 1];
      const z = pos[o + 2];
      if (x < ax) ax = x;
      if (x > bx) bx = x;
      if (y < ay) ay = y;
      if (y > by) by = y;
      if (z < az) az = z;
      if (z > bz) bz = z;
    }
    out[0] = Math.max(0, Math.min(nx - 1, Math.floor((ax - x0) / CELL)));
    out[1] = Math.max(0, Math.min(nx - 1, Math.floor((bx - x0) / CELL)));
    out[2] = Math.max(0, Math.min(ny - 1, Math.floor((ay - y0) / CELL)));
    out[3] = Math.max(0, Math.min(ny - 1, Math.floor((by - y0) / CELL)));
    out[4] = Math.max(0, Math.min(nz - 1, Math.floor((az - z0) / CELL)));
    out[5] = Math.max(0, Math.min(nz - 1, Math.floor((bz - z0) / CELL)));
  };
  const rg = new Int32Array(6);
  const start = new Uint32Array(nCells + 1);
  for (let t = 0; t < nTri; t++) {
    cellRange(t, rg);
    for (let k = rg[4]; k <= rg[5]; k++) for (let j = rg[2]; j <= rg[3]; j++) for (let i = rg[0]; i <= rg[1]; i++) start[(k * ny + j) * nx + i + 1]++;
  }
  for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nCells);
  const tris = new Uint32Array(start[nCells]);
  for (let t = 0; t < nTri; t++) {
    cellRange(t, rg);
    for (let k = rg[4]; k <= rg[5]; k++) for (let j = rg[2]; j <= rg[3]; j++) for (let i = rg[0]; i <= rg[1]; i++) tris[fill[(k * ny + j) * nx + i]++] = t;
  }
  return { mesh, pos, vi, nTri, x0, y0, z0, x1, y1, z1, nx, ny, nz, start, tris, stamp: new Uint32Array(nTri), mark: 1, version: geo.attributes.position.version, count: pos.length };
}

// Möller–Trumbore. Devuelve t (> 0) o -1. side: 0 = Front, 1 = Back, 2 = Double.
function triHit(G, t, ox, oy, oz, dx, dy, dz, side) {
  const p = G.pos;
  const a = G.vi(t, 0) * 3;
  const b = G.vi(t, 1) * 3;
  const c = G.vi(t, 2) * 3;
  const e1x = p[b] - p[a];
  const e1y = p[b + 1] - p[a + 1];
  const e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a];
  const e2y = p[c + 1] - p[a + 1];
  const e2z = p[c + 2] - p[a + 2];
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (side === 0 ? det < 1e-12 : side === 1 ? det > -1e-12 : Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const sx = ox - p[a];
  const sy = oy - p[a + 1];
  const sz = oz - p[a + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// ¿Algún triángulo corta el rayo (o + d·t, d unitario) con 1e-5 < t < tMax?
function gridBlocked(G, ox, oy, oz, dx, dy, dz, tMax, side) {
  let t0 = 0;
  let t1 = tMax;
  const lo = [G.x0, G.y0, G.z0];
  const hi = [G.x1, G.y1, G.z1];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo[k] || o[k] > hi[k]) return false;
    } else {
      let ta = (lo[k] - o[k]) / d[k];
      let tb = (hi[k] - o[k]) / d[k];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
  }
  const { nx, ny, nz } = G;
  const px = ox + dx * t0;
  const py = oy + dy * t0;
  const pz = oz + dz * t0;
  let ix = Math.max(0, Math.min(nx - 1, Math.floor((px - G.x0) / CELL)));
  let iy = Math.max(0, Math.min(ny - 1, Math.floor((py - G.y0) / CELL)));
  let iz = Math.max(0, Math.min(nz - 1, Math.floor((pz - G.z0) / CELL)));
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const sz = dz > 0 ? 1 : -1;
  const ddx = Math.abs(dx) > 1e-12 ? Math.abs(CELL / dx) : Infinity;
  const ddy = Math.abs(dy) > 1e-12 ? Math.abs(CELL / dy) : Infinity;
  const ddz = Math.abs(dz) > 1e-12 ? Math.abs(CELL / dz) : Infinity;
  let nxT = Math.abs(dx) > 1e-12 ? t0 + (G.x0 + (ix + (dx > 0 ? 1 : 0)) * CELL - px) / dx : Infinity;
  let nyT = Math.abs(dy) > 1e-12 ? t0 + (G.y0 + (iy + (dy > 0 ? 1 : 0)) * CELL - py) / dy : Infinity;
  let nzT = Math.abs(dz) > 1e-12 ? t0 + (G.z0 + (iz + (dz > 0 ? 1 : 0)) * CELL - pz) / dz : Infinity;
  if (++G.mark >= 0xfffffff0) {
    G.stamp.fill(0);
    G.mark = 1;
  }
  const mark = G.mark;
  for (let guard = 0; guard < 4096; guard++) {
    const c = (iz * ny + iy) * nx + ix;
    for (let q = G.start[c], e = G.start[c + 1]; q < e; q++) {
      const t = G.tris[q];
      if (G.stamp[t] === mark) continue;
      G.stamp[t] = mark;
      const th = triHit(G, t, ox, oy, oz, dx, dy, dz, side);
      if (th > 1e-5 && th < tMax) return true;
    }
    if (nxT <= nyT && nxT <= nzT) {
      if (nxT > t1) break;
      ix += sx;
      if (ix < 0 || ix >= nx) break;
      nxT += ddx;
    } else if (nyT <= nzT) {
      if (nyT > t1) break;
      iy += sy;
      if (iy < 0 || iy >= ny) break;
      nyT += ddy;
    } else {
      if (nzT > t1) break;
      iz += sz;
      if (iz < 0 || iz >= nz) break;
      nzT += ddz;
    }
  }
  return false;
}

const _inv = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export function createOccluder(getMeshes) {
  const grids = new Map();
  function gridFor(mesh) {
    let G = grids.get(mesh);
    const attr = mesh.geometry?.attributes?.position;
    if (!attr) return null;
    if (!G || G.version !== attr.version || G.count !== attr.array.length || G.pos !== attr.array) {
      G = buildGrid(mesh);
      grids.set(mesh, G);
    }
    return G;
  }
  return {
    // from/to en mundo. margin: metros antes del destino que no cuentan (la tela donde apoya el hilo).
    blocked(from, to, margin = 0.025) {
      const meshes = getMeshes();
      for (const mesh of meshes) {
        if (!mesh || !mesh.visible) continue;
        const G = gridFor(mesh);
        if (!G) continue;
        _inv.copy(mesh.matrixWorld).invert();
        _a.copy(from).applyMatrix4(_inv);
        _b.copy(to).applyMatrix4(_inv);
        const worldLen = from.distanceTo(to);
        let dx = _b.x - _a.x;
        let dy = _b.y - _a.y;
        let dz = _b.z - _a.z;
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-9) continue;
        dx /= len;
        dy /= len;
        dz /= len;
        const k = worldLen > 1e-9 ? len / worldLen : 1;
        const tMax = (worldLen - margin) * k;
        if (tMax <= 0) continue;
        const s = mesh.material?.side;
        const side = s === THREE.BackSide ? 1 : s === THREE.DoubleSide ? 2 : 0;
        if (gridBlocked(G, _a.x, _a.y, _a.z, dx, dy, dz, tMax, side)) return true;
      }
      return false;
    },
    // arma las grillas ya (al entrar al paso) para que el primer rayo no haga un tirón
    warm() {
      const t0 = performance.now();
      for (const m of getMeshes()) if (m) gridFor(m);
      return performance.now() - t0;
    },
    dispose() {
      grids.clear();
    },
  };
}
