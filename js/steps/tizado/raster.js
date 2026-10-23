// Tizado · geometría de la distribución: rasterizado de moldes sobre la tela (misma regla que
// evaluateLayout: una celda es de una pieza si su CENTRO cae dentro del contorno), chequeos
// rápidos de superposición mientras se arrastra, "acomodo fino" al soltar y un acomodo
// automático por primer hueco (bottom-left) que encastra las piezas por su forma real.

import { FABRIC_WIDTH, FABRIC_MAX_LENGTH, PIECE_GAP, placedOutline, bounds, evaluateLayout, autoLayout, isGrainOk } from '../shared/fabricLayout.js';

export const CELL = 0.01; // igual que evaluateLayout
export const COLS = Math.ceil(FABRIC_MAX_LENGTH / CELL);
export const ROWS = Math.ceil(FABRIC_WIDTH / CELL);
export const SELVEDGE = PIECE_GAP; // franja del orillo que conviene no pisar (m)
const TOL = 0.001; // tolerancia de borde (como evaluateLayout)

const TAU = Math.PI * 2;
export const normRot = (r) => ((r % TAU) + TAU) % TAU;

// Contorno de una pieza en coords de tela con {x, z} (cacheado por pose).
export function outlineAt(piece, pl) {
  return placedOutline(piece, pl);
}

// Scanline con la regla par-impar de pointInPolygon: devuelve un arreglo de filas
// [{ r, c0, c1 }] (c1 exclusivo) con las celdas cuyo centro está adentro.
export function rasterRuns(poly, cell = CELL, cols = COLS, rows = ROWS) {
  const b = bounds(poly);
  const r0 = Math.max(0, Math.floor(b.minZ / cell - 0.5));
  const r1 = Math.min(rows - 1, Math.ceil(b.maxZ / cell));
  const out = [];
  const xs = [];
  const n = poly.length;
  for (let r = r0; r <= r1; r++) {
    const z = (r + 0.5) * cell;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = poly[i].z;
      const zj = poly[j].z;
      if (zi > z !== zj > z) xs.push(((poly[j].x - poly[i].x) * (z - zi)) / (zj - zi) + poly[i].x);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b2) => a - b2);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // adentro si xs[k] <= xc < xs[k+1], con xc = (c + 0.5) * cell
      let c0 = Math.ceil(xs[k] / cell - 0.5);
      let c1 = Math.ceil(xs[k + 1] / cell - 0.5);
      if (c0 < 0) c0 = 0;
      if (c1 > cols) c1 = cols;
      if (c1 > c0) out.push({ r, c0, c1 });
    }
  }
  return out;
}

export function runsArea(runs, cell = CELL) {
  let n = 0;
  for (const s of runs) n += s.c1 - s.c0;
  return n * cell * cell;
}

// ¿El contorno sale de la tela? (misma tolerancia que evaluateLayout)
export function isOutside(b) {
  return b.minX < -TOL || b.minZ < -TOL || b.maxX > FABRIC_MAX_LENGTH + TOL || b.maxZ > FABRIC_WIDTH + TOL;
}
export function onSelvedge(b) {
  return b.minZ < SELVEDGE - 0.002 || b.maxZ > FABRIC_WIDTH - SELVEDGE + 0.002;
}

// ---------------------------------------------------------------------------
// Estado rasterizado de una distribución (para el overlay rojo y los avisos en vivo)
// ---------------------------------------------------------------------------

export function analyze(pieceMap, placements) {
  const count = new Uint8Array(COLS * ROWS);
  const items = [];
  for (const pl of placements) {
    const piece = pieceMap.get(pl.id);
    if (!piece) continue;
    const poly = outlineAt(piece, pl);
    const b = bounds(poly);
    const runs = rasterRuns(poly);
    for (const s of runs) {
      const base = s.r * COLS;
      for (let c = s.c0; c < s.c1; c++) if (count[base + c] < 250) count[base + c]++;
    }
    items.push({ id: pl.id, poly, b, runs });
  }
  const flags = new Map();
  let usedLength = 0;
  let area = 0;
  for (const it of items) {
    let overlap = false;
    for (const s of it.runs) {
      const base = s.r * COLS;
      for (let c = s.c0; c < s.c1 && !overlap; c++) if (count[base + c] > 1) overlap = true;
      if (overlap) break;
    }
    const outside = isOutside(it.b);
    area += runsArea(it.runs);
    // un molde que quedó fuera de la tela no "estira" el largo usado (es inválido igual)
    if (!outside) usedLength = Math.max(usedLength, it.b.maxX);
    flags.set(it.id, { overlap, outside, selvedge: onSelvedge(it.b), b: it.b, poly: it.poly });
  }
  return { count, flags, usedLength, area, efficiency: usedLength > 0 ? area / (usedLength * FABRIC_WIDTH) : 0 };
}

// ---------------------------------------------------------------------------
// Intersección exacta de contornos (para no dejar "lonjas" superpuestas que la grilla no ve)
// ---------------------------------------------------------------------------

function segHit(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = dx - cx;
  const d2z = dz - cz;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * d2z - (cz - az) * d2x) / den;
  const u = ((cx - ax) * d1z - (cz - az) * d1x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

export function polygonsCross(pa, ba, pb, bb, pad = 0) {
  const minX = Math.max(ba.minX, bb.minX) - pad;
  const maxX = Math.min(ba.maxX, bb.maxX) + pad;
  const minZ = Math.max(ba.minZ, bb.minZ) - pad;
  const maxZ = Math.min(ba.maxZ, bb.maxZ) + pad;
  if (minX > maxX || minZ > maxZ) return false;
  const pick = (p) => {
    const out = [];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j];
      const b = p[i];
      if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.z, b.z) < minZ || Math.min(a.z, b.z) > maxZ) continue;
      out.push(a, b);
    }
    return out;
  };
  const ea = pick(pa);
  const eb = pick(pb);
  for (let i = 0; i < ea.length; i += 2) {
    const a = ea[i];
    const b = ea[i + 1];
    for (let k = 0; k < eb.length; k += 2) if (segHit(a.x, a.z, b.x, b.z, eb[k].x, eb[k].z, eb[k + 1].x, eb[k + 1].z)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Acomodo fino al soltar: busca la posición válida más cercana (hasta `radius` m)
// sin superposición (grilla de 1 cm + cruce exacto de contornos) y dentro de la tela.
// ---------------------------------------------------------------------------

export function settle(pieceMap, placements, id, { radius = 0.035, step = 0.005 } = {}) {
  const pl = placements.find((p) => p.id === id);
  const piece = pieceMap.get(id);
  if (!pl || !piece) return null;
  const others = placements.filter((p) => p.id !== id);
  const occ = new Uint8Array(COLS * ROWS);
  const oPolys = [];
  for (const o of others) {
    const pc = pieceMap.get(o.id);
    if (!pc) continue;
    const poly = outlineAt(pc, o);
    const b = bounds(poly);
    oPolys.push({ poly, b });
    for (const s of rasterRuns(poly)) occ.fill(1, s.r * COLS + s.c0, s.r * COLS + s.c1);
  }
  const ok = (cand) => {
    const poly = outlineAt(piece, cand);
    const b = bounds(poly);
    if (isOutside(b)) return false;
    for (const s of rasterRuns(poly)) {
      const base = s.r * COLS;
      for (let c = s.c0; c < s.c1; c++) if (occ[base + c]) return false;
    }
    for (const o of oPolys) if (polygonsCross(poly, b, o.poly, o.b)) return false;
    return true;
  };
  if (ok(pl)) return { x: pl.x, z: pl.z, moved: false };
  const n = Math.round(radius / step);
  const cands = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (i * i + j * j <= n * n) cands.push([i, j, i * i + j * j]);
  cands.sort((a, b) => a[2] - b[2]);
  for (const [i, j] of cands) {
    const cand = { ...pl, x: pl.x + i * step, z: pl.z + j * step };
    if (ok(cand)) return { x: cand.x, z: cand.z, moved: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Acomodo por primer hueco (bottom-left) con formas reales. Respeta el hilo (rot = ±π/2),
// deja libre el orillo y 1 cm entre piezas. Sirve de referencia de "lo mejor posible".
// ---------------------------------------------------------------------------

function dilate(occ, runs, d) {
  for (const s of runs) {
    for (let dr = -d; dr <= d; dr++) {
      const r = s.r + dr;
      if (r < 0 || r >= ROWS) continue;
      const a = Math.max(0, s.c0 - d);
      const b = Math.min(COLS, s.c1 + d);
      occ.fill(1, r * COLS + a, r * COLS + b);
    }
  }
}

// Ocupación de la tela (1 = celda tomada), dilatada `gapCells` celdas para dejar luz entre piezas.
export function occupancyFrom(pieceMap, placements, gapCells = 0) {
  const occ = new Uint8Array(COLS * ROWS);
  for (const pl of placements) {
    const pc = pieceMap.get(pl.id);
    if (pc) dilate(occ, rasterRuns(placedOutline(pc, pl)), gapCells);
  }
  return occ;
}

// Primer hueco (de izquierda a derecha y de atrás hacia adelante) donde entra la pieza con esa
// rotación sin tocar la ocupación. Devuelve { x, z, right } o null.
export function firstFit(piece, rot, occ, { zMin = 0, zMax = FABRIC_WIDTH, xMax = FABRIC_MAX_LENGTH, beat = Infinity } = {}) {
  const b0 = bounds(placedOutline(piece, { x: 0, z: 0, rot }));
  const fx = -b0.minX + 0.002;
  const fz = zMin - b0.minZ + 0.001;
  const zEnd = zMax - b0.maxZ - 0.001;
  if (zEnd < fz) return null;
  // centro alineado a la grilla: correr la pieza celdas enteras = correr su raster
  const runs0 = rasterRuns(placedOutline(piece, { x: fx, z: fz, rot }), CELL, COLS * 4, ROWS * 4);
  const maxI = Math.floor((xMax - b0.maxX - 0.001 - fx) / CELL);
  const maxJ = Math.floor((zEnd - fz) / CELL);
  for (let i = 0; i <= maxI; i++) {
    if (fx + i * CELL + b0.maxX >= beat - 1e-9) return null;
    for (let j = 0; j <= maxJ; j++) {
      let hit = false;
      for (const s of runs0) {
        const r = s.r + j;
        if (r >= ROWS) continue;
        const base = r * COLS;
        const e = Math.min(COLS, s.c1 + i);
        for (let c = s.c0 + i; c < e; c++) {
          if (occ[base + c]) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) return { x: fx + i * CELL, z: fz + j * CELL, right: fx + i * CELL + b0.maxX };
    }
  }
  return null;
}

const GOOD_ROTS = [Math.PI / 2, (3 * Math.PI) / 2];
const ANY_ROTS = [Math.PI / 2, (3 * Math.PI) / 2, 0, Math.PI];

export function nestLayout(pattern, { gapCells = 1, selvedge = true, rotations = GOOD_ROTS } = {}) {
  const items = pattern.pieces.map((p) => ({ piece: p, area: p.width * p.height })).sort((a, b) => b.area - a.area);
  const occ = new Uint8Array(COLS * ROWS);
  const placements = [];
  const zMin = selvedge ? SELVEDGE : 0.002;
  const zMax = FABRIC_WIDTH - zMin;
  for (const { piece } of items) {
    let best = null;
    const tryRots = (list) => {
      for (const rot of list) {
        const f = firstFit(piece, rot, occ, { zMin, zMax, beat: best ? best.right : Infinity });
        if (f && (!best || f.right < best.right - 1e-9)) best = { ...f, rot };
      }
    };
    // las rotaciones con el hilo cruzado, solo si no entra de otra forma
    tryRots(rotations.filter((r) => isGrainOk(r)));
    if (!best) tryRots(rotations.filter((r) => !isGrainOk(r)));
    if (!best) return null;
    const pl = { id: piece.id, x: best.x, z: best.z, rot: best.rot };
    placements.push(pl);
    dilate(occ, rasterRuns(placedOutline(piece, pl)), gapCells);
  }
  const ev = evaluateLayout(pattern, placements);
  if (ev.overlaps.length || ev.outside.length) return null;
  const wrong = placements.filter((p) => !isGrainOk(p.rot)).length;
  return { placements, fabricLength: Math.min(FABRIC_MAX_LENGTH, ev.usedLength + PIECE_GAP), efficiency: ev.efficiency, grainOk: wrong === 0, grainForced: wrong };
}

// Acomodo automático "de manual" (columnas del módulo compartido). Si deja piezas afuera
// (talles muy grandes), se usa el encastre por forma.
export function safeAutoLayout(pattern) {
  let res = null;
  try {
    res = autoLayout(pattern);
    const ev = evaluateLayout(pattern, res.placements);
    if (ev.overlaps.length || ev.outside.length) res = null;
  } catch (e) {
    res = null;
  }
  return res || nestChain(pattern) || autoLayout(pattern);
}

// Encastre cada vez más apretado hasta que entre (último recurso: alguna pieza chica cruzada).
function nestChain(pattern) {
  return (
    nestLayout(pattern) ||
    nestLayout(pattern, { gapCells: 0 }) ||
    nestLayout(pattern, { gapCells: 0, selvedge: false }) ||
    nestLayout(pattern, { gapCells: 0, rotations: ANY_ROTS }) ||
    nestLayout(pattern, { gapCells: 0, selvedge: false, rotations: ANY_ROTS })
  );
}

// La mejor referencia conocida para el puntaje (columnas o encastre, la que rinda más).
export function referenceLayout(pattern) {
  const a = (() => {
    try {
      const r = autoLayout(pattern);
      const ev = evaluateLayout(pattern, r.placements);
      return ev.overlaps.length || ev.outside.length ? null : r;
    } catch (e) {
      return null;
    }
  })();
  const b = nestChain(pattern);
  if (a && b) return b.efficiency > a.efficiency ? b : a;
  return b || a;
}

export { isGrainOk };
