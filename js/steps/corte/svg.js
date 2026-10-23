// Corte · dibujos SVG para el panel y la tarjeta de resultado: la tela que quedó con los
// huecos de cada pieza (coloreados según la precisión) y un ícono de herramienta.

import { FABRIC_WIDTH, FABRIC_MAX_LENGTH } from '../shared/fabricLayout.js';

const NS = 'http://www.w3.org/2000/svg';
const f = (v) => (Math.round(v * 10000) / 10000).toString();

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  for (const k of kids) if (k) e.appendChild(k);
  return e;
}

export function accColor(acc) {
  if (acc >= 0.88) return '#3c8a4f';
  if (acc >= 0.75) return '#7aa63a';
  if (acc >= 0.6) return '#d9a43b';
  return '#c0392b';
}

// cuts: [{ id, pts: [{x, z}] (contorno real del corte), acc }]
export function cutMap(cuts, { fabricHex = '#f3f1ea', chalkHex = '#3f78b8' } = {}) {
  const L = FABRIC_MAX_LENGTH;
  const W = FABRIC_WIDTH;
  const pad = 0.04;
  const svg = el('svg', { viewBox: `${f(-pad)} ${f(-pad)} ${f(L + pad * 2)} ${f(W + pad * 2)}`, class: 'cor-map-svg', role: 'img', 'aria-label': 'La tela después del corte' });
  const defs = el('defs');
  const mat = el('pattern', { id: 'corMat', width: 0.05, height: 0.05, patternUnits: 'userSpaceOnUse' });
  mat.appendChild(el('rect', { width: 0.05, height: 0.05, fill: '#2f6a4e' }));
  mat.appendChild(el('path', { d: 'M0 0H0.05M0 0V0.05', stroke: 'rgba(255,255,255,0.28)', 'stroke-width': 0.003 }));
  defs.appendChild(mat);
  svg.appendChild(defs);
  // base de corte asomando por los huecos
  svg.appendChild(el('rect', { x: f(-pad * 0.5), y: f(-pad * 0.5), width: f(L + pad), height: f(W + pad), fill: 'url(#corMat)', rx: 0.01 }));
  // tela con huecos (regla evenodd)
  let d = `M0 0H${f(L)}V${f(W)}H0Z`;
  for (const c of cuts) d += `M${c.pts.map((p) => `${f(p.x)} ${f(p.z)}`).join('L')}Z`;
  svg.appendChild(el('path', { d, fill: fabricHex, 'fill-rule': 'evenodd', stroke: 'rgba(43,36,32,0.25)', 'stroke-width': 0.004 }));
  for (const c of cuts) {
    svg.appendChild(el('path', { d: `M${c.pts.map((p) => `${f(p.x)} ${f(p.z)}`).join('L')}Z`, fill: 'none', stroke: accColor(c.acc), 'stroke-width': 0.012, 'stroke-linejoin': 'round' }));
  }
  // orillos
  for (const y of [0.006, W - 0.006]) svg.appendChild(el('line', { x1: 0, y1: f(y), x2: f(L), y2: f(y), stroke: chalkHex, 'stroke-opacity': 0.25, 'stroke-width': 0.01 }));
  return svg;
}

export const TOOL_SVG = {
  tijera: `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M30 33 L58 9" stroke="#8d969e" stroke-width="5"/><path d="M30 31 L58 44" stroke="#b9c1c8" stroke-width="5"/><circle cx="30" cy="32" r="2.6" fill="#c9a24a" stroke="none"/><ellipse cx="15" cy="22" rx="9" ry="7" stroke="#2b2420" stroke-width="4.5"/><ellipse cx="14" cy="44" rx="10" ry="7.5" stroke="#2b2420" stroke-width="4.5"/><path d="M22 26 L29 31 M23 40 L29 33" stroke="#2b2420" stroke-width="4.5"/></g></svg>`,
  cutter: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="42" cy="40" r="15" fill="#d5dade" stroke="#8d969e" stroke-width="2.5"/><circle cx="42" cy="40" r="4" fill="#c9cfd4" stroke="#6d757c" stroke-width="2"/><path d="M42 40 L10 12" stroke="#4f9a8c" stroke-width="11" stroke-linecap="round"/><path d="M27 27 L17 18" stroke="#3b3e42" stroke-width="12" stroke-linecap="round"/><path d="M30 25 A18 18 0 0 1 58 33" fill="none" stroke="#4f9a8c" stroke-width="5" stroke-linecap="round"/></svg>`,
};
