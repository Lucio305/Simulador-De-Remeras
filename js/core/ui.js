// Interfaz HTML superpuesta al canvas 3D: panel lateral, botones,
// HUD de mini-juegos, avisos, modales y componentes de formulario.

import { audio } from './audio.js';
import { clamp, money, stars } from './utils.js';

const $ = (id) => document.getElementById(id);

// Crea un elemento: h('div', { class: 'x', onClick: fn, style: {...} }, ...hijos)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function setContent(el, content) {
  el.innerHTML = '';
  if (content === null || content === undefined) return;
  if (typeof content === 'string') el.innerHTML = content;
  else appendChildren(el, [content]);
}

export const ui = {
  h,

  init() {
    this.panelEl = $('panel');
    this.bodyEl = $('panel-body');
    this.footEl = $('panel-foot');
    this.hudEl = $('hud');
    this.hintEl = $('hint');
    this.toastsEl = $('toasts');
    this.overlayEl = $('overlay');
    this.modalRoot = $('modal-root');
    this.stepperEl = $('stepper');
    this._actions = new Map();
    $('panel-toggle')?.addEventListener('click', () => {
      this.panelEl.classList.toggle('collapsed');
      this._layout();
    });
    window.addEventListener('resize', () => this._layout());
  },

  // Callback que main usa para avisarle al motor cuánto tapa el panel.
  onLayout: null,

  _layout() {
    if (!this.onLayout) return;
    const p = this.panelEl;
    const hidden = p.classList.contains('hidden');
    const mobile = window.matchMedia('(max-width: 820px)').matches;
    let right = 0;
    let bottom = 0;
    if (!hidden) {
      if (mobile) bottom = p.classList.contains('collapsed') ? 64 : Math.min(p.offsetHeight || window.innerHeight * 0.48, window.innerHeight * 0.48);
      else right = (p.offsetWidth || 380) + 24;
    }
    this.onLayout({ right, bottom });
  },

  // ---------- Panel lateral ----------
  panel({ kicker = '', title = '', subtitle = '', body = null, actions = null, wide = false } = {}) {
    this.panelEl.classList.remove('hidden', 'collapsed');
    this.panelEl.classList.toggle('wide', !!wide);
    $('panel-kicker').textContent = kicker;
    $('panel-title').textContent = title;
    const sub = $('panel-sub');
    sub.innerHTML = subtitle || '';
    sub.style.display = subtitle ? '' : 'none';
    setContent(this.bodyEl, body);
    this.bodyEl.scrollTop = 0;
    if (actions) this.setActions(actions);
    else this.setActions([]);
    requestAnimationFrame(() => this._layout());
    return this.bodyEl;
  },

  hidePanel() {
    this.panelEl.classList.add('hidden');
    this._layout();
  },

  showPanel() {
    this.panelEl.classList.remove('hidden');
    this._layout();
  },

  // Reemplaza el contenido del cuerpo del panel sin tocar título ni acciones.
  setBody(content) {
    setContent(this.bodyEl, content);
    return this.bodyEl;
  },

  // actions: [{ id, label, kind: 'primary'|'secondary'|'ghost'|'auto'|'danger', disabled, onClick, title }]
  setActions(actions = []) {
    this.footEl.innerHTML = '';
    this._actions.clear();
    for (const a of actions) {
      const b = h(
        'button',
        {
          class: `btn btn-${a.kind || 'secondary'}`,
          title: a.title || null,
          disabled: !!a.disabled,
          onClick: (e) => {
            if (b.disabled) return;
            audio.play('click');
            a.onClick && a.onClick(e);
          },
        },
        a.label,
      );
      if (a.id) this._actions.set(a.id, b);
      this.footEl.appendChild(b);
    }
    this.footEl.style.display = actions.length ? '' : 'none';
  },

  action(id) {
    return this._actions.get(id) || null;
  },

  enableAction(id, enabled = true) {
    const b = this.action(id);
    if (b) b.disabled = !enabled;
  },

  updateAction(id, { label, disabled, kind } = {}) {
    const b = this.action(id);
    if (!b) return;
    if (label !== undefined) b.textContent = label;
    if (disabled !== undefined) b.disabled = disabled;
    if (kind) b.className = `btn btn-${kind}`;
  },

  // ---------- Indicaciones y HUD ----------
  hint(text) {
    if (!text) {
      this.hintEl.classList.remove('show');
      return;
    }
    this.hintEl.innerHTML = text;
    this.hintEl.classList.add('show');
  },

  // Devuelve el contenedor del HUD (arriba a la izquierda) o lo oculta con null.
  hud(content) {
    if (content === null) {
      this.hudEl.innerHTML = '';
      this.hudEl.classList.remove('show');
      return this.hudEl;
    }
    setContent(this.hudEl, content);
    this.hudEl.classList.add('show');
    return this.hudEl;
  },

  toast(text, type = 'info', ms = 2600) {
    const t = h('div', { class: `toast toast-${type}` }, text);
    this.toastsEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, ms);
  },

  // Capa a pantalla completa (pantalla de título, etc.). null la oculta.
  overlay(content) {
    if (content === null) {
      this.overlayEl.classList.remove('show');
      setTimeout(() => {
        if (!this.overlayEl.classList.contains('show')) this.overlayEl.innerHTML = '';
      }, 400);
      return this.overlayEl;
    }
    setContent(this.overlayEl, content);
    this.overlayEl.classList.add('show');
    return this.overlayEl;
  },

  // Modal. Devuelve una promesa con el id de la acción elegida (o null si se cierra).
  modal({ title = '', body = null, actions = [{ id: 'ok', label: 'Aceptar', kind: 'primary' }], dismissible = true, wide = false } = {}) {
    return new Promise((resolve) => {
      const close = (id) => {
        wrap.classList.remove('show');
        setTimeout(() => wrap.remove(), 250);
        document.removeEventListener('keydown', onKey);
        resolve(id);
      };
      const onKey = (e) => {
        if (e.key === 'Escape' && dismissible) close(null);
      };
      const card = h('div', { class: `modal-card${wide ? ' wide' : ''}` }, title ? h('h3', { class: 'modal-title' }, title) : null);
      const bodyEl = h('div', { class: 'modal-body' });
      setContent(bodyEl, body);
      card.appendChild(bodyEl);
      const foot = h('div', { class: 'modal-foot' });
      for (const a of actions) {
        foot.appendChild(
          h(
            'button',
            {
              class: `btn btn-${a.kind || 'secondary'}`,
              onClick: () => {
                audio.play('click');
                close(a.id);
              },
            },
            a.label,
          ),
        );
      }
      card.appendChild(foot);
      const wrap = h('div', { class: 'modal-wrap', onClick: (e) => e.target === wrap && dismissible && close(null) }, card);
      this.modalRoot.appendChild(wrap);
      document.addEventListener('keydown', onKey);
      requestAnimationFrame(() => wrap.classList.add('show'));
    });
  },

  loading(text) {
    const el = $('loading');
    clearTimeout(this._loadingTimer);
    if (!text) {
      el.classList.add('done');
      this._loadingTimer = setTimeout(() => (el.style.display = 'none'), 700);
      return;
    }
    el.style.display = '';
    el.classList.remove('done');
    el.querySelector('.loading-text').textContent = text;
  },

  // ---------- Barra de pasos y costo ----------
  setStepper(steps, index, scores = {}) {
    const el = this.stepperEl;
    el.innerHTML = '';
    steps.forEach((s, i) => {
      if (s.hidden) return;
      const sc = scores[s.id];
      const cls = ['step-chip'];
      if (i < index) cls.push('done');
      if (i === index) cls.push('current');
      const chip = h('div', { class: cls.join(' '), title: s.title }, h('span', { class: 'step-icon' }, s.icon || '•'), h('span', { class: 'step-label' }, s.short || s.title));
      if (sc && typeof sc.score === 'number') chip.appendChild(h('span', { class: 'step-score' }, Math.round(sc.score)));
      el.appendChild(chip);
    });
    const cur = el.querySelector('.current');
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  },

  setCost(total) {
    const el = $('cost-pill');
    if (el) el.textContent = `💰 ${money(total)}`;
  },

  // ---------- Componentes ----------
  section(title, ...children) {
    return h('section', { class: 'ui-section' }, title ? h('h4', { class: 'ui-section-title' }, title) : null, ...children);
  },

  note(text, type = 'info') {
    return h('div', { class: `ui-note ui-note-${type}`, html: text });
  },

  // options: [{ id, label, sub, icon, swatch, badge, disabled }]
  optionGrid({ options, value, onChange, columns = 2, compact = false }) {
    const grid = h('div', { class: `option-grid cols-${columns}${compact ? ' compact' : ''}`, role: 'listbox' });
    const render = () => {
      for (const btn of grid.children) btn.classList.toggle('selected', btn.dataset.id === String(grid.value));
    };
    grid.value = value;
    for (const o of options) {
      const btn = h(
        'button',
        {
          class: 'option',
          dataset: { id: o.id },
          disabled: !!o.disabled,
          title: o.title || null,
          onClick: () => {
            if (o.disabled) return;
            grid.value = o.id;
            render();
            audio.play('select');
            onChange && onChange(o.id, o);
          },
        },
        o.swatch ? h('span', { class: 'option-swatch', style: { background: o.swatch } }) : null,
        o.icon ? h('span', { class: 'option-icon' }, o.icon) : null,
        h('span', { class: 'option-text' }, h('span', { class: 'option-label' }, o.label), o.sub ? h('span', { class: 'option-sub' }, o.sub) : null),
        o.badge ? h('span', { class: `option-badge ${o.badgeType || ''}` }, o.badge) : null,
      );
      grid.appendChild(btn);
    }
    grid.setValue = (v) => {
      grid.value = v;
      render();
    };
    render();
    return grid;
  },

  // colors: [{ id, name, hex }]
  colorPalette({ colors, value, onChange, allowCustom = true }) {
    const wrap = h('div', { class: 'palette' });
    const label = h('div', { class: 'palette-label' });
    const render = () => {
      for (const b of wrap.querySelectorAll('.swatch-btn')) b.classList.toggle('selected', b.dataset.hex === wrap.value);
      const c = colors.find((x) => x.hex === wrap.value);
      label.textContent = c ? c.name : `Personalizado ${wrap.value}`;
    };
    wrap.value = value;
    const row = h('div', { class: 'palette-row' });
    for (const c of colors) {
      row.appendChild(
        h('button', {
          class: 'swatch-btn',
          title: c.name,
          dataset: { hex: c.hex, id: c.id },
          style: { background: c.hex },
          onClick: () => {
            wrap.value = c.hex;
            render();
            audio.play('select');
            onChange && onChange(c.hex, c);
          },
        }),
      );
    }
    if (allowCustom) {
      const input = h('input', {
        type: 'color',
        class: 'swatch-custom',
        value: value || '#ffffff',
        title: 'Color personalizado',
        onInput: (e) => {
          wrap.value = e.target.value;
          render();
          onChange && onChange(e.target.value, null);
        },
      });
      row.appendChild(h('label', { class: 'swatch-btn custom', title: 'Elegir otro color' }, input));
    }
    wrap.appendChild(row);
    wrap.appendChild(label);
    wrap.setValue = (v) => {
      wrap.value = v;
      render();
    };
    render();
    return wrap;
  },

  slider({ label, min = 0, max = 100, step = 1, value = 50, unit = '', format = null, onInput, onChange }) {
    const out = h('span', { class: 'slider-value' });
    const fmt = (v) => (format ? format(v) : `${v}${unit}`);
    const input = h('input', {
      type: 'range',
      min,
      max,
      step,
      value,
      onInput: (e) => {
        const v = parseFloat(e.target.value);
        out.textContent = fmt(v);
        onInput && onInput(v);
      },
      onChange: (e) => onChange && onChange(parseFloat(e.target.value)),
    });
    out.textContent = fmt(value);
    const el = h('label', { class: 'slider' }, h('span', { class: 'slider-head' }, h('span', { class: 'slider-label' }, label), out), input);
    el.input = input;
    el.setValue = (v) => {
      input.value = v;
      out.textContent = fmt(v);
    };
    return el;
  },

  // options: [{ id, label }]
  segmented({ options, value, onChange }) {
    const el = h('div', { class: 'segmented' });
    el.value = value;
    const render = () => {
      for (const b of el.children) b.classList.toggle('selected', b.dataset.id === String(el.value));
    };
    for (const o of options) {
      el.appendChild(
        h(
          'button',
          {
            dataset: { id: o.id },
            title: o.title || null,
            onClick: () => {
              el.value = o.id;
              render();
              audio.play('select');
              onChange && onChange(o.id, o);
            },
          },
          o.label,
        ),
      );
    }
    el.setValue = (v) => {
      el.value = v;
      render();
    };
    render();
    return el;
  },

  toggle({ label, value = false, onChange }) {
    const input = h('input', { type: 'checkbox', onChange: (e) => onChange && onChange(e.target.checked) });
    input.checked = !!value;
    const el = h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', { class: 'toggle-label' }, label));
    el.input = input;
    return el;
  },

  // rows: [[clave, valor], ...]
  propTable(rows) {
    return h('dl', { class: 'prop-table' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  },

  // Barra de progreso / medidor. Devuelve el elemento con .set(v 0..1, texto?)
  meter({ label = '', value = 0, color = null, text = null }) {
    const fill = h('div', { class: 'meter-fill', style: color ? { background: color } : {} });
    const txt = h('span', { class: 'meter-text' });
    const el = h('div', { class: 'meter' }, label ? h('div', { class: 'meter-label' }, h('span', {}, label), txt) : null, h('div', { class: 'meter-track' }, fill));
    el.set = (v, t = null) => {
      fill.style.width = `${clamp(v) * 100}%`;
      txt.textContent = t ?? `${Math.round(clamp(v) * 100)}%`;
    };
    el.set(value, text);
    return el;
  },

  // Botón para subir archivos (imágenes). onFile(File)
  fileButton({ label = 'Subir imagen', accept = 'image/*', onFile }) {
    const input = h('input', { type: 'file', accept, style: { display: 'none' }, onChange: (e) => e.target.files[0] && onFile(e.target.files[0]) });
    const btn = h('button', { class: 'btn btn-secondary', onClick: () => input.click() }, label);
    return h('span', { class: 'file-button' }, btn, input);
  },

  starsHTML(score) {
    const s = stars(score);
    let out = '';
    for (let i = 1; i <= 5; i++) out += `<span class="star ${s >= i ? 'full' : s >= i - 0.5 ? 'half' : ''}">★</span>`;
    return `<span class="stars" aria-label="${s} de 5 estrellas">${out}</span>`;
  },

  // Tarjeta de resultado de un paso. Resuelve al tocar "Continuar".
  resultCard({ title, score, notes = [], extra = null, continueLabel = 'Continuar →' }) {
    const grade = score >= 90 ? '¡Excelente!' : score >= 75 ? 'Muy bien' : score >= 55 ? 'Aceptable' : score >= 35 ? 'Flojo' : 'A mejorar';
    audio.play(score >= 55 ? 'good' : 'bad');
    const body = h(
      'div',
      { class: 'result' },
      h('div', { class: 'result-score' }, h('span', { class: 'result-num' }, Math.round(score)), h('span', { class: 'result-of' }, '/100')),
      h('div', { class: 'result-grade', html: `${this.starsHTML(score)} <b>${grade}</b>` }),
      notes.length ? h('ul', { class: 'result-notes' }, ...notes.map((n) => h('li', { html: n }))) : null,
      extra,
    );
    return this.modal({ title, body, actions: [{ id: 'ok', label: continueLabel, kind: 'primary' }], dismissible: false });
  },
};
