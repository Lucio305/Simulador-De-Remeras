// Diagrama SVG de la remera (frente) que muestra el armado: cada costura pendiente en punteado,
// la actual resaltada y las hechas pintadas del color del hilo (con un contorno para que se
// vean aunque el hilo sea al tono). Se dibuja desde la moldería real (silueta + seamLines).

import { mixHex } from '../../core/utils.js';
import { luminance } from '../../data/catalog.js';

const NS = 'http://www.w3.org/2000/svg';
// Coordenadas en milímetros (unidades chicas en SVG hacen muy lento el pintado del texto y los trazos).
const S = 1000;
const f = (v) => (Math.round(v * 10) / 10).toString();
const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x * S)} ${f(-p.y * S)}`).join(' ');

export function createDiagram({ pattern, seams, fabricColor, threadColor, compact = false }) {
  const front = pattern.silhouette.front;
  const back = pattern.silhouette.back;
  const pts = front.outline;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, -p.y);
    maxY = Math.max(maxY, -p.y);
  }
  const pad = 0.035;
  const vb = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].map((v) => v * S);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', vb.map(f).join(' '));
  svg.setAttribute('class', `cos-diagram${compact ? ' compact' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Armado de la remera');
  const light = luminance(fabricColor) > 0.6;
  const stroke = mixHex(fabricColor, '#2b2420', light ? 0.55 : 0.25);
  const inner = mixHex(fabricColor, '#000000', 0.28);
  // interior visible por el escote (espalda) y cuerpo
  const neckBack = back.segments.find((s) => s.name === 'cuello');
  let html = '';
  html += `<path d="${pathOf(pts)} Z" transform="translate(0 6)" fill="rgba(43,36,32,.16)"/>`;
  html += `<path d="${pathOf(pts)} Z" fill="${fabricColor}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round" class="cos-dg-body"/>`;
  if (neckBack) {
    const fr = front.segments.find((s) => s.name === 'cuello').points;
    const bk = neckBack.points.slice().reverse();
    html += `<path d="${pathOf(fr)} ${pathOf(bk).replace('M', 'L')} Z" fill="${inner}" opacity="0.9"/>`;
  }
  for (const ah of front.armholes || []) html += `<path d="${pathOf(ah)}" fill="none" stroke="${stroke}" stroke-width="2.5" opacity="0.55"/>`;
  html += `<g class="cos-dg-seams"></g><g class="cos-dg-badges"></g>`;
  svg.innerHTML = html;
  const gSeams = svg.querySelector('.cos-dg-seams');
  const gBadges = svg.querySelector('.cos-dg-badges');

  const items = new Map();
  seams.forEach((seam, i) => {
    const lines = (pattern.seamLines[seam.id] || []).filter((l) => l.length > 1);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'cos-dg-seam pending');
    g.dataset.id = seam.id;
    const paths = [];
    for (const l of lines) {
      const d = pathOf(l);
      const mk = (cls) => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('class', cls);
        if (cls !== 'cos-dg-guide') p.setAttribute('pathLength', '1');
        g.appendChild(p);
        return p;
      };
      const casing = mk('cos-dg-casing');
      const guide = mk('cos-dg-guide');
      const done = mk('cos-dg-done');
      done.style.stroke = threadColor;
      paths.push({ casing, guide, done });
    }
    gSeams.appendChild(g);
    // número en el medio de la primera línea
    let bx = 0;
    let by = 0;
    if (lines[0]) {
      const l = lines[lines.length > 1 && seam.id !== 'cuello' ? 1 : 0];
      const m = l[Math.floor(l.length / 2)];
      bx = m.x;
      by = -m.y;
      // empujar el número hacia afuera del cuerpo para que no tape la costura
      const cx = (minX + maxX) / 2;
      const dirX = Math.sign(bx - cx) || 1;
      if (seam.id === 'cuello') by -= 0.045;
      else if (seam.id === 'ruedo') by += 0.04;
      else if (seam.id === 'hombros') {
        by -= 0.035;
        bx += dirX * 0.01;
      } else bx += dirX * 0.045;
    }
    const badge = document.createElementNS(NS, 'g');
    badge.setAttribute('class', 'cos-dg-badge');
    badge.setAttribute('transform', `translate(${f(bx * S)} ${f(by * S)})`);
    badge.innerHTML = `<circle r="24"/><text y="8.5" text-anchor="middle">${i + 1}</text>`;
    gBadges.appendChild(badge);
    items.set(seam.id, { g, paths, badge, lines, status: 'pending', progress: 0 });
  });

  // progress: número 0..1 para todas las líneas, o array por línea
  function set(id, { status, progress } = {}) {
    const it = items.get(id);
    if (!it) return;
    if (status && status !== it.status) {
      it.g.setAttribute('class', `cos-dg-seam ${status}`);
      it.badge.setAttribute('class', `cos-dg-badge ${status}`);
      it.status = status;
    }
    if (progress !== undefined) {
      it.paths.forEach((p, k) => {
        const v = Array.isArray(progress) ? progress[k] ?? progress[progress.length - 1] : progress;
        const o = String(Math.max(0, 1 - v));
        p.done.style.strokeDashoffset = o;
        p.casing.style.strokeDashoffset = o;
      });
      it.progress = progress;
    }
  }

  function setThread(hex) {
    for (const it of items.values()) for (const p of it.paths) p.done.style.stroke = hex;
  }

  for (const id of items.keys()) set(id, { progress: 0 });
  return { el: svg, set, setThread, items };
}
