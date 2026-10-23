// Tizado · dibujos SVG para el panel: miniatura de cada molde (tal como está en la bandeja)
// y el mapa final del tizado para la tarjeta de resultado.

import { FABRIC_WIDTH, FABRIC_MAX_LENGTH, placedOutline } from '../shared/fabricLayout.js';

const NS = 'http://www.w3.org/2000/svg';
const f = (v) => (Math.round(v * 10000) / 10000).toString();

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  for (const k of kids) if (k) e.appendChild(k);
  return e;
}

const pathOf = (pts, X, Y) => `M${pts.map((p) => `${f(X(p))} ${f(Y(p))}`).join('L')}Z`;

// Miniatura del molde (orientación de la bandeja: y de la pieza hacia arriba).
export function pieceThumb(piece, { size = 64, grainColor = '#8c7d73' } = {}) {
  const w = piece.width;
  const h = piece.height;
  const pad = Math.max(w, h) * 0.08;
  const vb = [-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2];
  const svg = el('svg', { viewBox: vb.map(f).join(' '), width: size, height: size, class: 'tiz-thumb-svg', 'aria-hidden': 'true' });
  const X = (p) => p.x;
  const Y = (p) => -p.y;
  const sw = Math.max(w, h) * 0.018;
  svg.appendChild(el('path', { d: pathOf(piece.outline, X, Y), fill: piece.color || '#d9bb8c', stroke: '#4a3122', 'stroke-width': f(sw), 'stroke-linejoin': 'round' }));
  svg.appendChild(el('path', { d: pathOf(piece.seamLine, X, Y), fill: 'none', stroke: 'rgba(74,49,34,0.55)', 'stroke-width': f(sw * 0.6), 'stroke-dasharray': `${f(sw * 2)} ${f(sw * 1.4)}` }));
  // flecha de hilo
  const al = Math.max(h * 0.62, Math.max(w, h) * 0.18);
  const head = Math.min(al * 0.22, Math.max(w, h) * 0.08);
  const ax = Math.min(w, h) < 0.08 ? -w * 0.38 : 0;
  const g = el('g', { stroke: grainColor, 'stroke-width': f(sw * 1.3), 'stroke-linecap': 'round', fill: 'none', class: 'tiz-thumb-grain' });
  g.appendChild(el('path', { d: `M${f(ax)} ${f(-al / 2)}L${f(ax)} ${f(al / 2)}M${f(ax - head * 0.6)} ${f(-al / 2 + head)}L${f(ax)} ${f(-al / 2)}L${f(ax + head * 0.6)} ${f(-al / 2 + head)}M${f(ax - head * 0.6)} ${f(al / 2 - head)}L${f(ax)} ${f(al / 2)}L${f(ax + head * 0.6)} ${f(al / 2 - head)}` }));
  svg.appendChild(g);
  return svg;
}

// Mapa del tizado (vista de arriba): tela, orillos, piezas con su flecha de hilo y el largo usado.
export function layoutMap(pattern, placements, { fabricLength, fabricHex = '#f3f1ea', chalkHex = '#3f78b8', badIds = [] } = {}) {
  const L = FABRIC_MAX_LENGTH;
  const W = FABRIC_WIDTH;
  const pad = 0.05;
  const svg = el('svg', { viewBox: `${f(-pad)} ${f(-pad - 0.06)} ${f(L + pad * 2)} ${f(W + pad * 2 + 0.06)}`, class: 'tiz-map-svg', role: 'img', 'aria-label': 'Mapa del tizado' });
  svg.appendChild(el('rect', { x: 0, y: 0, width: f(L), height: f(W), fill: fabricHex, stroke: 'rgba(43,36,32,0.25)', 'stroke-width': 0.004, rx: 0.006 }));
  // sobrante
  if (fabricLength && fabricLength < L - 0.005) {
    svg.appendChild(el('rect', { x: f(fabricLength), y: 0, width: f(L - fabricLength), height: f(W), fill: 'url(#tizHatch)', opacity: 0.9 }));
  }
  const defs = el('defs');
  const pat = el('pattern', { id: 'tizHatch', width: 0.04, height: 0.04, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.appendChild(el('rect', { width: 0.04, height: 0.04, fill: 'rgba(43,36,32,0.04)' }));
  pat.appendChild(el('rect', { width: 0.012, height: 0.04, fill: 'rgba(43,36,32,0.14)' }));
  defs.appendChild(pat);
  svg.insertBefore(defs, svg.firstChild);
  // orillos
  for (const y of [0.006, W - 0.006]) svg.appendChild(el('line', { x1: 0, y1: f(y), x2: f(L), y2: f(y), stroke: 'rgba(43,36,32,0.25)', 'stroke-width': 0.012 }));
  const pm = new Map(pattern.pieces.map((p) => [p.id, p]));
  for (const pl of placements) {
    const piece = pm.get(pl.id);
    if (!piece) continue;
    const pts = placedOutline(piece, pl);
    const bad = badIds.includes(pl.id);
    svg.appendChild(el('path', { d: pathOf(pts, (p) => p.x, (p) => p.z), fill: 'rgba(255,255,255,0.18)', stroke: bad ? '#c0392b' : chalkHex, 'stroke-width': 0.007, 'stroke-linejoin': 'round' }));
    // flecha de hilo: dirección del eje y de la pieza en la tela
    const c = Math.cos(pl.rot);
    const s = Math.sin(pl.rot);
    const dx = -s; // (0, 1) local → (x = −sin, z = −cos)
    const dz = -c;
    const al = Math.min(0.3, piece.height * 0.5);
    const ax = pl.x;
    const az = pl.z;
    svg.appendChild(
      el('line', { x1: f(ax - (dx * al) / 2), y1: f(az - (dz * al) / 2), x2: f(ax + (dx * al) / 2), y2: f(az + (dz * al) / 2), stroke: bad ? '#c0392b' : '#3c8a4f', 'stroke-width': 0.01, 'stroke-linecap': 'round' }),
    );
  }
  if (fabricLength) {
    svg.appendChild(el('line', { x1: f(fabricLength), y1: -0.03, x2: f(fabricLength), y2: f(W + 0.01), stroke: '#d2553f', 'stroke-width': 0.008, 'stroke-dasharray': '0.03 0.02' }));
    const t = el('text', { x: f(fabricLength), y: -0.045, 'text-anchor': 'middle', 'font-size': 0.06, 'font-weight': 800, fill: '#d2553f' });
    t.textContent = `${String(Math.round(fabricLength * 100) / 100).replace('.', ',')} m`;
    svg.appendChild(t);
  }
  return svg;
}
