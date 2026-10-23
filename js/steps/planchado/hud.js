// HUD del planchado (arriba a la izquierda): arrugas por lado, temperatura de la suela,
// vapor y alertas. Se actualiza solo cuando cambia algo (sin tocar el DOM en cada cuadro).

import { clamp } from '../../core/utils.js';

export function createHud(h) {
  const sideRow = (id, name) => {
    const fill = h('i', { class: 'pl-bar-fill' });
    const pct = h('b', { class: 'pl-side-pct' }, '100 %');
    const tag = h('span', { class: 'pl-side-tag' }, '');
    const row = h(
      'div',
      { class: 'pl-side', dataset: { side: id } },
      h('span', { class: 'pl-side-name' }, name, tag),
      h('span', { class: 'pl-bar' }, fill),
      pct,
    );
    return { row, fill, pct, tag };
  };
  const front = sideRow('frente', 'Frente');
  const back = sideRow('espalda', 'Espalda');
  const thermFill = h('i', { class: 'pl-therm-fill' });
  const thermMark = h('i', { class: 'pl-therm-mark' });
  const thermTxt = h('b', { class: 'pl-therm-txt' }, '25 °C');
  const steamFlag = h('span', { class: 'pl-flag pl-flag-steam' }, '💨 Vapor');
  const burnFlag = h('span', { class: 'pl-flag bad', style: { display: 'none' } }, '');
  const timeFlag = h('span', { class: 'pl-flag pl-flag-time', style: { display: 'none' } }, '');
  const alertEl = h('div', { class: 'pl-alert' });
  const el = h(
    'div',
    { class: 'pl-hud' },
    h('div', { class: 'hud-title' }, '♨️ Arrugas'),
    h('div', { class: 'pl-sides' }, front.row, back.row),
    h('div', { class: 'pl-therm' }, h('span', { class: 'pl-therm-ic' }, '🌡'), h('span', { class: 'pl-therm-bar' }, thermFill, thermMark), thermTxt),
    h('div', { class: 'pl-flags' }, steamFlag, burnFlag, timeFlag),
    alertEl,
  );
  const last = {};
  const set = (key, val, fn) => {
    if (last[key] === val) return;
    last[key] = val;
    fn(val);
  };
  const MAXT = 240;
  return {
    el,
    // levels: {frente, espalda} 0..1 ; up: lado que mira arriba
    setSides(levels, up) {
      for (const [s, r] of [['frente', front], ['espalda', back]]) {
        const v = clamp(levels[s]);
        const p = Math.round(v * 100);
        set(`p-${s}`, p, () => {
          r.pct.textContent = `${p} %`;
          r.fill.style.width = `${p}%`;
          r.row.classList.toggle('done', v <= 0.08);
        });
        set(`u-${s}`, up === s, (on) => {
          r.row.classList.toggle('up', on);
          r.tag.textContent = on ? ' · arriba' : '';
        });
      }
    },
    // T actual, temperatura elegida (0 = apagada)
    setTemp(T, targetT, ready) {
      const t = Math.round(T);
      set('t', `${t}|${targetT}|${ready}`, () => {
        thermFill.style.width = `${clamp((T - 20) / (MAXT - 20)) * 100}%`;
        thermMark.style.left = `${clamp((targetT - 20) / (MAXT - 20)) * 100}%`;
        thermMark.style.display = targetT > 30 ? '' : 'none';
        thermTxt.textContent = targetT > 30 ? (ready ? `${t} °C ✓` : `${t} → ${targetT} °C`) : `${t} °C · apagada`;
        el.classList.toggle('heating', targetT > 30 && !ready && targetT > T);
      });
    },
    // steam: 'off' | 'on' | 'cold'
    setSteam(mode) {
      set('steam', mode, () => {
        steamFlag.className = `pl-flag pl-flag-steam ${mode}`;
        steamFlag.textContent = mode === 'on' ? '💨 Vapor' : mode === 'cold' ? '💧 Vapor: falta calor' : 'Sin vapor';
      });
    },
    setBurns(n, melt) {
      set('burns', `${n}|${melt}`, () => {
        burnFlag.style.display = n ? '' : 'none';
        burnFlag.textContent = `🔥 ${n} marca${n === 1 ? '' : 's'}${melt ? ' (derretida)' : ''}`;
        el.classList.toggle('has-burns', n > 0);
      });
    },
    setTime(secs) {
      const v = secs == null ? -1 : Math.floor(secs);
      set('time', v, () => {
        timeFlag.style.display = v < 0 ? 'none' : '';
        timeFlag.textContent = `⏱ ${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
      });
    },
    // kind: null | 'warn' | 'bad' | 'good' | 'info'
    setAlert(text, kind = 'warn') {
      set('alert', text ? `${kind}|${text}` : '', () => {
        alertEl.className = `pl-alert ${text ? `show ${kind}` : ''}`;
        alertEl.innerHTML = text || '';
      });
    },
  };
}
