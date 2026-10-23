// HUD del mini-juego de costura: velocímetro (puntadas por minuto) con la zona de riesgo según la
// curva que viene, mira "aguja vs. tiza" con el desvío en mm, precisión, progreso por tramo y remates.

import { clamp } from '../../core/utils.js';

const NS = 'http://www.w3.org/2000/svg';
const arcPath = (a0, a1, r = 40, cx = 50, cy = 50) => {
  const p0 = [cx + r * Math.cos(a0), cy - r * Math.sin(a0)];
  const p1 = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)];
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
};
const mm = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

export function createHud({ h, seam, index, total, stitchName, machineLabel, maxPpm, pieces, needsRemate, onRemate }) {
  const gauge = document.createElementNS(NS, 'svg');
  gauge.setAttribute('viewBox', '0 0 100 58');
  gauge.setAttribute('class', 'cos-gauge');
  gauge.innerHTML = `
    <path class="cos-g-track" d="${arcPath(Math.PI, 0)}"/>
    <path class="cos-g-risk" d=""/>
    <path class="cos-g-fill" d=""/>
    ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
      const a = Math.PI * (1 - t);
      return `<line class="cos-g-tick" x1="${(50 + 33 * Math.cos(a)).toFixed(2)}" y1="${(50 - 33 * Math.sin(a)).toFixed(2)}" x2="${(50 + 29 * Math.cos(a)).toFixed(2)}" y2="${(50 - 29 * Math.sin(a)).toFixed(2)}"/>`;
    }).join('')}
    <line class="cos-g-needle" x1="50" y1="50" x2="16" y2="50"/>
    <circle class="cos-g-hub" cx="50" cy="50" r="4.5"/>`;
  const gRisk = gauge.querySelector('.cos-g-risk');
  const gFill = gauge.querySelector('.cos-g-fill');
  const gNeedle = gauge.querySelector('.cos-g-needle');
  const ppm = h('span', { class: 'cos-ppm-num' }, '0');
  const speedWarn = h('div', { class: 'cos-speed-warn' }, '');

  // mira de desvío: la aguja fija al centro (como en la máquina) y la línea de tiza que se corre;
  // la flecha dice hacia dónde mover la tela
  const devLine = h('span', { class: 'cos-dev-chalk' });
  const devTxt = h('span', { class: 'cos-dev-txt' }, '—');
  const devHint = h('span', { class: 'cos-dev-hint' }, '');
  const devBox = h(
    'div',
    { class: 'cos-dev' },
    h('div', { class: 'cos-dev-head' }, h('span', {}, 'Desvío'), devTxt),
    h('div', { class: 'cos-dev-track' }, h('span', { class: 'cos-dev-zone z3' }), h('span', { class: 'cos-dev-zone z2' }), h('span', { class: 'cos-dev-zone z1' }), devLine, h('span', { class: 'cos-dev-needle' })),
    devHint,
  );

  const accTxt = h('b', {}, '—');
  const progFill = h('span', { class: 'cos-prog-fill' });
  const progTrack = h('div', { class: 'cos-prog-track' }, progFill);
  // marcas de tramos (costura en cadena)
  if (pieces.length > 1) {
    const total = pieces[pieces.length - 1].b - pieces[0].a;
    for (let i = 0; i < pieces.length - 1; i++) {
      const g0 = (pieces[i].b - pieces[0].a) / total;
      const g1 = (pieces[i + 1].a - pieces[0].a) / total;
      progTrack.appendChild(h('span', { class: 'cos-prog-gap', style: { left: `${g0 * 100}%`, width: `${(g1 - g0) * 100}%` } }));
    }
  }
  const progTxt = h('span', {}, '0 %');

  const remA = h('span', { class: 'cos-rem' }, '○ inicio');
  const remB = h('span', { class: 'cos-rem' }, '○ final');
  const remBtn = h('button', { class: 'cos-rem-btn', type: 'button', title: 'Mantené para coser hacia atrás (remate)' }, '⟲ Remate');
  const remRow = needsRemate ? h('div', { class: 'cos-rem-row' }, h('span', { class: 'cos-rem-lbl' }, 'Remate'), remA, remB, remBtn) : null;
  if (needsRemate && onRemate) {
    const down = (e) => {
      e.preventDefault();
      remBtn.classList.add('on');
      onRemate(true);
    };
    const up = () => {
      remBtn.classList.remove('on');
      onRemate(false);
    };
    remBtn.addEventListener('pointerdown', down);
    remBtn.addEventListener('pointerup', up);
    remBtn.addEventListener('pointercancel', up);
    remBtn.addEventListener('pointerleave', up);
  }

  const el = h(
    'div',
    { class: 'cos-hud' },
    h('div', { class: 'cos-hud-head' }, h('span', { class: 'hud-title' }, `Costura ${index}/${total}`), h('span', { class: 'cos-hud-stitch' }, stitchName)),
    h('div', { class: 'cos-hud-name' }, seam.name, h('small', {}, ` · ${machineLabel}`)),
    h('div', { class: 'cos-hud-row' }, h('div', { class: 'cos-gauge-wrap' }, gauge, h('div', { class: 'cos-ppm' }, ppm, h('small', {}, 'puntadas/min'))), devBox),
    speedWarn,
    h('div', { class: 'cos-hud-stats' }, h('span', {}, 'Precisión ', accTxt), h('span', {}, 'Progreso ', progTxt)),
    progTrack,
    remRow,
  );

  let last = {};
  function update({ speed = 0, rec = 1, err = null, gap = false, acc = null, progress = 0, remStart = false, remEnd = false, remWindow = null, warn = '' }) {
    const a = Math.PI * (1 - clamp(speed));
    if (Math.abs((last.speed ?? -1) - speed) > 0.004) {
      gNeedle.setAttribute('x2', (50 + 34 * Math.cos(a)).toFixed(2));
      gNeedle.setAttribute('y2', (50 - 34 * Math.sin(a)).toFixed(2));
      gFill.setAttribute('d', speed > 0.005 ? arcPath(Math.PI, a) : '');
      ppm.textContent = String(Math.round(speed * maxPpm));
      gauge.classList.toggle('fast', speed > rec + 0.06);
      last.speed = speed;
    }
    if (Math.abs((last.rec ?? -1) - rec) > 0.01) {
      gRisk.setAttribute('d', rec < 0.985 ? arcPath(Math.PI * (1 - rec), 0) : '');
      last.rec = rec;
    }
    if (err === null) {
      devTxt.textContent = '—';
      devLine.style.left = '50%';
      devBox.className = 'cos-dev idle';
      devHint.textContent = '';
    } else {
      const e = err * 1000;
      // err > 0: la aguja cae a la derecha de la tiza → la tiza se ve a la izquierda de la aguja
      const x = clamp(-e / 7, -1, 1);
      devLine.style.left = `${50 + x * 46}%`;
      const ae = Math.abs(e);
      devTxt.textContent = `${mm(ae)} mm`;
      devBox.className = `cos-dev ${ae <= 1.2 ? 'good' : ae <= 3 ? 'warn' : 'bad'}${gap ? ' gap' : ''}`;
      // (entre dos tramos se mide contra el arranque de la pieza que viene)
      const hint = gap
        ? ae <= 1.2
          ? '✓ próxima pieza alineada'
          : e > 0
            ? 'próxima pieza: corré →'
            : '← próxima pieza: corré'
        : ae <= 1.2
          ? '✓ sobre la línea'
          : e > 0
            ? 'corré la tela →'
            : '← corré la tela';
      if (devHint.textContent !== hint) devHint.textContent = hint;
    }
    if (acc !== null && acc !== last.acc) {
      accTxt.textContent = `${Math.round(acc * 100)} %`;
      last.acc = acc;
    }
    const pr = Math.round(progress * 100);
    if (pr !== last.pr) {
      progFill.style.width = `${progress * 100}%`;
      progTxt.textContent = `${pr} %`;
      last.pr = pr;
    }
    if (remRow) {
      remA.textContent = `${remStart ? '✓' : '○'} inicio`;
      remB.textContent = `${remEnd ? '✓' : '○'} final`;
      remA.classList.toggle('ok', remStart);
      remB.classList.toggle('ok', remEnd);
      remA.classList.toggle('now', remWindow === 'start' && !remStart);
      remB.classList.toggle('now', remWindow === 'end' && !remEnd);
    }
    if (warn !== last.warn) {
      speedWarn.textContent = warn;
      speedWarn.classList.toggle('show', !!warn);
      last.warn = warn;
    }
  }

  return { el, update, remBtn };
}
