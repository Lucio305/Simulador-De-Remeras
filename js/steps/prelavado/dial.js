// Perilla de temperatura del lavarropas (SVG): arco de frío a caliente con las posiciones de
// PREWASH.temps, perilla blanca con puntero que se arrastra (o se toca una marca) y salta a la
// posición más cercana. Teclado: ← → cuando tiene el foco.

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of kids) if (c) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

const COLORS = { 0: '#4f8fd6', 30: '#5fb3c9', 40: '#e2b23a', 60: '#e07a32', 90: '#c8382b' };
export const tempLabel = (t) => (t === 0 ? 'Fría' : `${t} °C`);

export function createTempDial({ temps, value, onChange, onTick }) {
  const W = 260;
  const H = 168;
  const cx = W / 2;
  const cy = 112;
  const R = 78;
  const a0 = 200; // grados (0 = derecha, antihorario hacia arriba)
  const a1 = -20;
  const angOf = (i) => a0 + ((a1 - a0) * i) / (temps.length - 1);
  const pt = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy - Math.sin(a) * r];
  };

  const svg = s('svg', { class: 'prela-dial', viewBox: `0 0 ${W} ${H}`, tabindex: 0, role: 'slider', 'aria-label': 'Temperatura del lavado', 'aria-valuemin': temps[0], 'aria-valuemax': temps[temps.length - 1] });
  const defs = s(
    'defs',
    {},
    s('linearGradient', { id: 'prela-arc', x1: 0, y1: 0, x2: 1, y2: 0 }, s('stop', { offset: '0%', 'stop-color': '#4f8fd6' }), s('stop', { offset: '45%', 'stop-color': '#e2b23a' }), s('stop', { offset: '100%', 'stop-color': '#c8382b' })),
    s('radialGradient', { id: 'prela-knob', cx: '38%', cy: '30%', r: '75%' }, s('stop', { offset: '0%', 'stop-color': '#ffffff' }), s('stop', { offset: '70%', 'stop-color': '#e9e6df' }), s('stop', { offset: '100%', 'stop-color': '#cfcac0' })),
    s('filter', { id: 'prela-knob-sh', x: '-30%', y: '-30%', width: '160%', height: '160%' }, s('feDropShadow', { dx: 0, dy: 2.5, stdDeviation: 2.5, 'flood-color': '#2b2420', 'flood-opacity': 0.3 })),
  );
  svg.appendChild(defs);
  // arco de colores
  const [sx, sy] = pt(a0, R);
  const [ex, ey] = pt(a1, R);
  svg.appendChild(s('path', { d: `M${sx} ${sy}A${R} ${R} 0 1 1 ${ex} ${ey}`, fill: 'none', stroke: 'url(#prela-arc)', 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.9 }));
  // marcas y etiquetas
  const stops = [];
  temps.forEach((t, i) => {
    const a = angOf(i);
    const [tx, ty] = pt(a, R + 27);
    const [m0x, m0y] = pt(a, R - 9);
    const [m1x, m1y] = pt(a, R + 9);
    const g = s('g', { class: 'prela-dial-stop', 'data-temp': t });
    g.appendChild(s('line', { x1: m0x, y1: m0y, x2: m1x, y2: m1y, stroke: '#2b2420', 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
    const dot = s('circle', { cx: m1x, cy: m1y, r: 0, fill: COLORS[t] || '#888' });
    g.appendChild(dot);
    const lab = s('text', { x: tx, y: ty + 5, 'text-anchor': 'middle', class: 'prela-dial-lab' }, tempLabel(t));
    g.appendChild(lab);
    // zona de toque generosa
    g.appendChild(s('circle', { cx: tx, cy: ty, r: 20, fill: 'transparent', class: 'prela-dial-hit' }));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      set(t, true);
    });
    svg.appendChild(g);
    stops.push({ t, g, a });
  });
  // perilla
  const knob = s('g', { class: 'prela-dial-knob', filter: 'url(#prela-knob-sh)' });
  knob.appendChild(s('circle', { cx, cy, r: 44, fill: 'url(#prela-knob)', stroke: '#bdb7ab', 'stroke-width': 1.2 }));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 360;
    const [p0x, p0y] = pt(a, 40);
    const [p1x, p1y] = pt(a, 44);
    knob.appendChild(s('line', { x1: p0x, y1: p0y, x2: p1x, y2: p1y, stroke: 'rgba(43,36,32,0.18)', 'stroke-width': 1.3 }));
  }
  const pointer = s('g', {});
  pointer.appendChild(s('rect', { x: cx + 14, y: cy - 3.5, width: 26, height: 7, rx: 3.5, fill: '#d2553f' }));
  knob.appendChild(pointer);
  knob.appendChild(s('circle', { cx, cy, r: 26, fill: 'rgba(255,255,255,0.55)', stroke: 'rgba(43,36,32,0.08)' }));
  const valueTxt = s('text', { x: cx, y: cy + 7, 'text-anchor': 'middle', class: 'prela-dial-val' }, '');
  knob.appendChild(valueTxt);
  svg.appendChild(knob);

  let cur = temps.includes(value) ? value : temps[0];
  let shownAngle = angOf(temps.indexOf(cur));
  let raf = 0;
  let disabled = false;

  function render() {
    const i = temps.indexOf(cur);
    const target = angOf(i);
    for (const st of stops) {
      const on = st.t === cur;
      st.g.classList.toggle('on', on);
      st.g.querySelector('circle').setAttribute('r', on ? 5 : 0);
    }
    valueTxt.textContent = cur === 0 ? 'Fría' : `${cur}°`;
    valueTxt.setAttribute('fill', COLORS[cur] || '#2b2420');
    svg.setAttribute('aria-valuenow', cur);
    svg.setAttribute('aria-valuetext', tempLabel(cur));
    // animación suave del puntero
    cancelAnimationFrame(raf);
    const from = shownAngle;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 220);
      const e = 1 - Math.pow(1 - k, 3);
      shownAngle = from + (target - from) * e;
      pointer.setAttribute('transform', `rotate(${-shownAngle} ${cx} ${cy})`);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    step();
  }

  function set(t, user = false) {
    if (disabled || !temps.includes(t)) return;
    if (t === cur) return;
    cur = t;
    render();
    if (user) {
      onTick && onTick();
      onChange && onChange(cur);
    }
  }

  // arrastrar la perilla
  let dragging = false;
  const angleFromEvent = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - cx;
    const y = cy - ((e.clientY - r.top) / r.height) * H;
    let a = (Math.atan2(y, x) * 180) / Math.PI; // -180..180
    if (a < -90) a += 360; // debajo a la izquierda → continúa el arco
    return a;
  };
  const nearest = (a) => {
    let best = cur;
    let bd = Infinity;
    temps.forEach((t, i) => {
      const d = Math.abs(angOf(i) - a);
      if (d < bd) {
        bd = d;
        best = t;
      }
    });
    return best;
  };
  knob.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    dragging = true;
    knob.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  knob.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    set(nearest(angleFromEvent(e)), true);
  });
  const end = () => (dragging = false);
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    step(e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1);
  });
  function step(d) {
    const i = Math.max(0, Math.min(temps.length - 1, temps.indexOf(cur) + d));
    set(temps[i], true);
  }

  render();
  return {
    el: svg,
    get value() {
      return cur;
    },
    set(t) {
      set(t, false);
    },
    step,
    setDisabled(v) {
      disabled = !!v;
      svg.classList.toggle('disabled', disabled);
    },
    dispose() {
      cancelAnimationFrame(raf);
    },
  };
}
