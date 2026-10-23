// Distribución de moldes sobre la tela de la mesa de corte (compartido por tizado y corte).
//
// Coordenadas de tela: x = metros a lo largo de la tela (dirección del orillo / hilo, eje X del mundo),
// z = metros a lo ancho desde el orillo de arriba (el más cercano a la pared) hacia la persona.
// placement = { id, x, z, rot }: centro de la pieza en coords de tela y rotación (rad) alrededor del eje vertical,
// aplicada a la malla de createPieceMesh (cuya +y local apunta a -Z con rot = 0).
// El hilo de la pieza (su eje Y) queda paralelo al orillo cuando rot ≡ ±π/2 (mod π).

import { STATIONS } from '../../data/stations.js';
import { pointInPolygon } from '../../core/utils.js';

export const FABRIC_WIDTH = STATIONS.corte.fabricWidth || 1.2;
export const FABRIC_MAX_LENGTH = 1.9;
export const PIECE_GAP = 0.012;

// Origen de la tela en el mundo: extremo izquierdo (x0), orillo superior (z0) y altura de apoyo (y).
export function fabricOrigin() {
  const [ax, ay, az] = STATIONS.corte.anchor;
  return { x0: ax - FABRIC_MAX_LENGTH / 2, z0: az - FABRIC_WIDTH / 2, y: ay + 0.004 };
}

// Coordenadas de tela → mundo (para el centro de una pieza o cualquier punto).
export function fabricToWorld(x, z) {
  const o = fabricOrigin();
  return { x: o.x0 + x, y: o.y, z: o.z0 + z };
}

export function worldToFabric(wx, wz) {
  const o = fabricOrigin();
  return { x: wx - o.x0, z: wz - o.z0 };
}

// Un punto local de pieza (px, py) → coords de tela, según placement.
// Con rot = 0, la +y de la pieza apunta a -z de la tela (hacia el orillo superior).
export function pieceToFabric(px, py, placement) {
  const c = Math.cos(placement.rot);
  const s = Math.sin(placement.rot);
  // vector local en el plano XZ del mundo antes de rotar: (px, -py)
  const lx = px;
  const lz = -py;
  // rotación alrededor de Y (igual que Object3D.rotation.y)
  const rx = lx * c + lz * s;
  const rz = -lx * s + lz * c;
  return { x: placement.x + rx, z: placement.z + rz };
}

// Contorno de la pieza en coords de tela.
export function placedOutline(piece, placement, which = 'outline') {
  return piece[which].map((p) => pieceToFabric(p.x, p.y, placement));
}

export function isGrainOk(rot) {
  const r = ((rot % Math.PI) + Math.PI) % Math.PI;
  return Math.abs(r - Math.PI / 2) < 0.05;
}

// Caja envolvente de un contorno (en coords de tela)
export function bounds(pts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

// Rasteriza contornos en una grilla de `cell` metros para medir superposiciones y salidas de la tela.
// Devuelve { overlaps: [[idA, idB]...], outside: [id...], usedLength, efficiency }.
export function evaluateLayout(pattern, placements, cell = 0.01) {
  const pieces = new Map(pattern.pieces.map((p) => [p.id, p]));
  const cols = Math.ceil(FABRIC_MAX_LENGTH / cell);
  const rows = Math.ceil(FABRIC_WIDTH / cell);
  const owner = new Int16Array(cols * rows).fill(-1);
  const overlapSet = new Set();
  const outside = [];
  let usedLength = 0;
  let pieceArea = 0;
  placements.forEach((pl, idx) => {
    const piece = pieces.get(pl.id);
    if (!piece) return;
    const poly = placedOutline(piece, pl).map((p) => ({ x: p.x, y: p.z }));
    const b = bounds(placedOutline(piece, pl));
    if (b.minX < -0.001 || b.minZ < -0.001 || b.maxX > FABRIC_MAX_LENGTH + 0.001 || b.maxZ > FABRIC_WIDTH + 0.001) outside.push(pl.id);
    usedLength = Math.max(usedLength, b.maxX);
    const c0 = Math.max(0, Math.floor(b.minX / cell));
    const c1 = Math.min(cols - 1, Math.ceil(b.maxX / cell));
    const r0 = Math.max(0, Math.floor(b.minZ / cell));
    const r1 = Math.min(rows - 1, Math.ceil(b.maxZ / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = (c + 0.5) * cell;
        const z = (r + 0.5) * cell;
        if (!pointInPolygon(x, z, poly)) continue;
        const k = r * cols + c;
        if (owner[k] >= 0 && owner[k] !== idx) {
          const a = placements[owner[k]].id;
          overlapSet.add(a < pl.id ? `${a}|${pl.id}` : `${pl.id}|${a}`);
        } else {
          owner[k] = idx;
          pieceArea += cell * cell;
        }
      }
    }
  });
  const overlaps = [...overlapSet].map((s) => s.split('|'));
  const efficiency = usedLength > 0 ? pieceArea / (usedLength * FABRIC_WIDTH) : 0;
  return { overlaps, outside, usedLength, efficiency, pieceArea };
}

// Acomodo automático: piezas con el hilo correcto, de la más grande a la más chica,
// por columnas a lo largo de la tela (heurística "primer hueco que entra").
export function autoLayout(pattern) {
  const items = pattern.pieces
    .map((p) => ({ piece: p, area: p.width * p.height }))
    .sort((a, b) => b.area - a.area);
  const placements = [];
  // con rot = π/2 la altura de la pieza corre a lo largo (x) y el ancho a lo ancho (z)
  const columns = []; // { x0, width, used }
  for (const { piece } of items) {
    const len = piece.height; // a lo largo
    const wid = piece.width; // a lo ancho
    let col = columns.find((c) => c.used + wid + PIECE_GAP <= FABRIC_WIDTH && len <= c.width + 1e-6);
    if (!col) {
      const x0 = columns.reduce((m, c) => Math.max(m, c.x0 + c.width + PIECE_GAP), PIECE_GAP);
      col = { x0, width: len, used: PIECE_GAP };
      columns.push(col);
    }
    placements.push({ id: piece.id, x: col.x0 + len / 2, z: col.used + wid / 2, rot: Math.PI / 2 });
    col.used += wid + PIECE_GAP;
  }
  const ev = evaluateLayout(pattern, placements);
  return { placements, fabricLength: Math.min(FABRIC_MAX_LENGTH, ev.usedLength + PIECE_GAP), efficiency: ev.efficiency, grainOk: true };
}
