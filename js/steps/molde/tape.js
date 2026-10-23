// Cintas métricas dibujadas sobre la remera 3D (overlay SVG + etiquetas HTML).
// Cada cinta es una polilínea en coordenadas de prenda que se pega a la superficie del frente
// (shirt.garmentToLocal) y se proyecta a la pantalla cada frame, así sigue el giro de la remera.

import { resampleN } from '../../shirt/pattern.js';
import { clamp, smoothstep } from '../../core/utils.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const cmTxt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

export function createTape({ engine, shirt, THREE, h }) {
  const root = h('div', { class: 'molde-tape', 'aria-hidden': 'true' });
  const svg = svgEl('svg', { class: 'molde-tape-svg' });
  root.appendChild(svg);
  document.getElementById('app').appendChild(root);

  let items = [];
  let visible = true;
  let opacity = 0;
  let shown = 0; // 0..1 animación de "desenrollar" la cinta al reconstruir
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  function clear() {
    for (const it of items) {
      it.g.remove();
      it.label.remove();
    }
    items = [];
  }

  // pattern: Pattern actual de la remera. Arma cintas de pecho, largo y manga.
  function build(pattern) {
    clear();
    const c = pattern.construction;
    const m = pattern.measurements;
    const defsList = [];
    // pecho: de costado a costado, 2 cm debajo de la axila
    {
      const y = c.UA.y - 0.025;
      const x0 = c.UA.x - 0.004;
      const pts = [];
      for (let i = 0; i <= 26; i++) pts.push({ x: -x0 + (2 * x0 * i) / 26, y });
      defsList.push({ key: 'pecho', text: `Pecho ${cmTxt(m.chest)} cm`, cm: m.chest, pts, at: 0.5, side: 'up' });
    }
    // largo total: del punto alto del hombro (al lado del cuello) hasta el ruedo
    {
      const x = c.HPS.x + 0.014;
      const pts = [];
      for (let i = 0; i <= 30; i++) pts.push({ x, y: -0.006 - ((c.L - 0.01) * i) / 30 });
      defsList.push({ key: 'largo', text: `Largo ${cmTxt(m.length)} cm`, cm: m.length, pts, at: 0.6, side: 'right' });
    }
    // manga: por arriba de la manga derecha (de quien mira), del hombro al puño
    if (c.hasSleeves) {
      const segs = pattern.silhouette.front.segments;
      const top = segs.find((sg) => sg.name === 'mangaArribaDer');
      const bot = segs.find((sg) => sg.name === 'mangaAbajoDer');
      if (top && bot) {
        const T = resampleN(top.points.slice().reverse(), 16); // del hombro al puño
        const B = resampleN(bot.points, 16); // de la axila al puño
        const pts = T.map((p, i) => ({ x: p.x + (B[i].x - p.x) * 0.16, y: p.y + (B[i].y - p.y) * 0.16 }));
        defsList.push({ key: 'manga', text: `Manga ${cmTxt(m.sleeveLength)} cm`, cm: m.sleeveLength, pts, at: 0.55, side: 'up' });
      }
    }
    for (const d of defsList) {
      const local = d.pts.map((p) => shirt.garmentToLocal('frente', p.x, p.y, 0.006).position.clone());
      const g = svgEl('g', { class: `molde-tape-item molde-tape-${d.key}` });
      const edge = svgEl('polyline', { class: 'molde-tape-edge' });
      const band = svgEl('polyline', { class: 'molde-tape-band' });
      const ticks = svgEl('polyline', { class: 'molde-tape-ticks' });
      const ticks10 = svgEl('polyline', { class: 'molde-tape-ticks10' });
      const tip = svgEl('circle', { class: 'molde-tape-tip', r: 3.2 });
      g.append(edge, band, ticks, ticks10, tip);
      svg.appendChild(g);
      const label = h('div', { class: `molde-tape-label side-${d.side}` }, d.text);
      root.appendChild(label);
      items.push({ ...d, local, g, edge, band, ticks, ticks10, tip, label, screen: local.map(() => ({ x: 0, y: 0 })) });
    }
    shown = 0;
  }

  let lastT = performance.now();
  function update() {
    // animaciones de interfaz en tiempo real (no dependen del dt del motor, que se recorta)
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const cam = engine.camera;
    const canvas = engine.canvas;
    const W = canvas.clientWidth || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;
    shirt.group.updateMatrixWorld(true);
    cam.updateMatrixWorld();
    // se desvanece cuando el frente deja de mirar a la cámara
    nrm.set(0, 0, 1).transformDirection(shirt.group.matrixWorld);
    shirt.group.getWorldPosition(v);
    camDir.copy(cam.position).sub(v).normalize();
    const facing = smoothstep(0.45, 0.8, nrm.dot(camDir));
    const target = visible && shirt.group.visible ? facing : 0;
    opacity += (target - opacity) * (1 - Math.exp(-dt * 10));
    shown = Math.min(1, shown + dt * 1.6);
    root.style.opacity = opacity.toFixed(3);
    root.style.display = opacity < 0.01 ? 'none' : '';
    if (opacity < 0.01) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const mw = shirt.group.matrixWorld;
    for (const it of items) {
      let len = 0;
      let prev = null;
      const n = it.local.length;
      const upto = Math.max(2, Math.round(n * clamp(shown * 1.15 - 0.0)));
      const pts = [];
      for (let i = 0; i < n; i++) {
        v.copy(it.local[i]).applyMatrix4(mw).project(cam);
        const sp = it.screen[i];
        sp.x = (v.x * 0.5 + 0.5) * W;
        sp.y = (-v.y * 0.5 + 0.5) * H;
        if (i < upto) {
          pts.push(`${sp.x.toFixed(1)},${sp.y.toFixed(1)}`);
          if (prev) len += Math.hypot(sp.x - prev.x, sp.y - prev.y);
          prev = sp;
        }
      }
      const str = pts.join(' ');
      it.edge.setAttribute('points', str);
      it.band.setAttribute('points', str);
      it.ticks.setAttribute('points', str);
      it.ticks10.setAttribute('points', str);
      // marcas de centímetro reales según el largo en pantalla
      const full = upto >= n ? len : len / Math.max(1e-3, (upto - 1) / (n - 1));
      const pxCm = full / Math.max(1, it.cm);
      if (pxCm >= 2.2) {
        it.ticks.style.display = '';
        it.ticks.setAttribute('stroke-dasharray', `0.9 ${(pxCm - 0.9).toFixed(2)}`);
      } else it.ticks.style.display = 'none';
      it.ticks10.setAttribute('stroke-dasharray', `1.6 ${(pxCm * 10 - 1.6).toFixed(2)}`);
      const s0 = it.screen[0];
      it.tip.setAttribute('cx', s0.x.toFixed(1));
      it.tip.setAttribute('cy', s0.y.toFixed(1));
      // etiqueta en el punto `at` de la cinta
      const k = Math.min(n - 1, Math.round((n - 1) * it.at));
      const sp = it.screen[k];
      it.label.style.left = `${sp.x.toFixed(1)}px`;
      it.label.style.top = `${sp.y.toFixed(1)}px`;
      it.label.style.opacity = shown >= 0.85 ? '1' : '0';
    }
  }

  return {
    el: root,
    build,
    update,
    setVisible(on) {
      visible = !!on;
    },
    get visible() {
      return visible;
    },
    dispose() {
      clear();
      root.remove();
    },
  };
}
