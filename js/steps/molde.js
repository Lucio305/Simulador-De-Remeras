// Paso 3 · Talle y molde.
// Elegís talle, calce, mangas y cuello; la remera del maniquí de prueba cambia en vivo (con un
// "pop"), unas cintas métricas muestran las medidas sobre la prenda y en el panel se ve la
// moldería real (moldes de papel madera sobre la base de corte) que después se tiza y se corta.

import * as catalog from '../data/catalog.js';
import { createPattern } from '../shirt/pattern.js';
import { autoLayout } from './shared/fabricLayout.js';
import { renderSheet, stampSheet, silhouetteIcon, outlinesBox } from './molde/sheet.js';
import { createTape } from './molde/tape.js';
import { clamp, money, easeOutBack, easeInOutCubic } from '../core/utils.js';

const { SIZES, FITS, SLEEVES, NECKS, fabricById, sizeById, fitById, sleeveById, neckById } = catalog;

const OK = '<span class="molde-mark ok">✓</span> ';
const NO = '<span class="molde-mark no">✗</span> ';
const MID = '<span class="molde-mark mid">≈</span> ';
// nota informativa con ícono en el lugar de la marca (la lista del informe queda pareja)
const ICO = (e) => `<span class="molde-mark ico" aria-hidden="true">${e}</span> `;
const TIP_ICO = { info: '💡', warn: '⚠️', good: '👍' };
const DEFAULT = { size: 'M', fit: 'regular', sleeve: 'corta', neck: 'redondo' };
const KEYS = ['size', 'fit', 'sleeve', 'neck'];
const cmTxt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const mTxt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

// ---------------------------------------------------------------------------
// Reglas (exportadas para reutilizar en otros pasos / pruebas)
// ---------------------------------------------------------------------------

// Requisitos del pedido que tocan al molde (null = a gusto del taller).
export function patternRequirements(order) {
  const r = order?.req || {};
  return { size: r.size || null, fit: r.fit || null, sleeve: r.sleeve || null, neck: r.neck || null };
}

export function defaultPattern(order) {
  const req = patternRequirements(order);
  const out = { ...DEFAULT };
  for (const k of KEYS) if (req[k]) out[k] = req[k];
  return out;
}

// Contorno de pecho del cuerpo para el que está pensado cada talle (la clásica lleva ~10 cm de holgura).
export function bodyChest(sizeId) {
  const s = sizeById(sizeId) || sizeById('M');
  return s.chest * 2 - 10;
}

export function easeOf(pattern) {
  return Math.round(pattern.measurements.chest * 2 - bodyChest(pattern.opts.size));
}

const layoutCache = new Map();
export function fabricEstimate(pattern) {
  if (!layoutCache.has(pattern.key)) {
    let len = catalog.COSTS.fabricMetersBase;
    try {
      len = autoLayout(pattern).fabricLength;
    } catch (e) {
      /* estimación por defecto */
    }
    layoutCache.set(pattern.key, Math.round(len * 100) / 100);
  }
  return layoutCache.get(pattern.key);
}

const lowerFirst = (t = '') => t.charAt(0).toLowerCase() + t.slice(1);
const label = {
  size: (id) => `talle ${id}`,
  fit: (id) => lowerFirst(fitById(id)?.name),
  sleeve: (id) => lowerFirst(sleeveById(id)?.name),
  neck: (id) => lowerFirst(neckById(id)?.name),
};

// Consejos de oficio para la combinación elegida (de más a menos importante).
export function patternTips(pattern, fabric) {
  const p = pattern.opts;
  const tips = [];
  const ease = easeOf(pattern);
  tips.push({ type: 'info', html: `Este molde tiene <b>${ease >= 0 ? '+' : ''}${ease} cm de holgura</b> en el contorno de pecho: le queda bien a alguien de unos <b>${bodyChest(p.size)} cm</b> de pecho.` });
  // (key 'fitWarn': el puntaje ya lo explica con su descuento, no se repite en las notas)
  if (!fabric.knit && p.fit === 'slim') tips.push({ type: 'warn', key: 'fitWarn', html: `<b>${fabric.short} + entallada:</b> es tejido plano y no estira, así que te va a tirar en hombros y sisas. Con lino conviene clásica u oversize.` });
  else if (fabric.stretch < 0.35 && p.fit === 'slim') tips.push({ type: 'warn', key: 'fitWarn', html: `<b>${fabric.short} + entallada:</b> estira poco y queda dura sobre el cuerpo. Una clásica le va mejor.` });
  else if (fabric.id === 'poliester' && p.fit === 'slim') tips.push({ type: 'good', html: '<b>Dry-fit entallada:</b> el calce deportivo de manual; el poliéster estira y seca rápido.' });
  else if (fabric.id === 'modal' && p.fit === 'oversize') tips.push({ type: 'good', html: '<b>Modal oversize:</b> la caída fluida del modal hace lucir el corte holgado.' });
  else if (fabric.id === 'lino' && p.fit !== 'slim') tips.push({ type: 'good', html: '<b>Lino con holgura:</b> fresco y relajado. El lino necesita aire porque no estira.' });
  if (p.fit === 'oversize') tips.push({ type: 'info', html: '<b>Oversize:</b> hombro caído 6 cm, sisa más profunda y mangas anchas. Usa bastante más tela.' });
  if (p.sleeve === 'sin') tips.push({ type: 'info', html: '<b>Sin mangas:</b> en vez de mangas se cortan dos <b>ribetes</b> para terminar las sisas.' });
  else if (p.sleeve === 'larga') tips.push({ type: 'info', html: '<b>Manga larga:</b> el puño se angosta. Cortá las dos mangas juntas con la tela doblada: así salen iguales y en espejo.' });
  if (p.neck === 'v') tips.push({ type: 'info', html: '<b>Escote en V:</b> la tira de ribb se cose con un inglete en la punta; respetá el piquete del centro.' });
  return tips;
}

// Puntaje: libre = 90 con consejos; pedido = 100 − 35 por cada requisito del molde incumplido.
export function scorePattern(state, { auto = false } = {}) {
  const pattern = createPattern({ ...state.pattern });
  const p = pattern.opts;
  const fab = fabricById(state.fabric?.id) || fabricById('algodon_jersey');
  const notes = [];
  const req = patternRequirements(state.order);
  const reqKeys = KEYS.filter((k) => req[k]);
  let score;
  if (state.order && reqKeys.length) {
    const o = state.order;
    score = 100;
    for (const k of reqKeys) {
      if (p[k] === req[k]) notes.push(`${OK} ${o.name} pidió <b>${label[k](req[k])}</b>: cumplido.`);
      else {
        score -= 35;
        notes.push(`${NO} ${o.name} pidió <b>${label[k](req[k])}</b> y elegiste ${label[k](p[k])} (−35).`);
      }
    }
  } else {
    score = 90;
    notes.push(state.order ? `${ICO('📋')}${state.order.name} dejó el molde a gusto del taller: elegiste ${label.size(p.size)}, ${label.fit(p.fit)}, ${label.sleeve(p.sleeve)} y ${label.neck(p.neck)}.` : `${ICO('📐')}En taller libre no hay molde "incorrecto": lo importante es que el calce acompañe a la tela y al uso.`);
  }
  let fitPenalty = false;
  if (!fab.knit && p.fit === 'slim') {
    score -= 10;
    fitPenalty = true;
    notes.push(`${MID} <b>${fab.short} + entallada:</b> el tejido plano no estira y la remera va a tirar en hombros y sisas. Conviene clásica (−10).`);
  } else if (fab.stretch < 0.35 && p.fit === 'slim') {
    score -= 5;
    fitPenalty = true;
    notes.push(`${MID} <b>${fab.short} + entallada:</b> estira poco; una clásica le queda más cómoda (−5).`);
  }
  if (auto) {
    score = Math.min(score, 72);
    notes.unshift(`${MID} Molde elegido en automático por el taller: la próxima elegilo vos y sumá más puntos.`);
  }
  const tips = patternTips(pattern, fab).filter((t) => !(fitPenalty && t.key === 'fitWarn'));
  for (const t of tips.slice(0, 3)) notes.push(`${ICO(TIP_ICO[t.type] || '💡')}${t.html}`);
  const meters = fabricEstimate(pattern);
  notes.push(`${ICO('🧵')}Consumo estimado de tela: <b>${mTxt(meters)} m</b> (ancho 1,20 m). El largo exacto sale del tizado.`);
  return { score: clamp(score, 0, 100), notes };
}

// ---------------------------------------------------------------------------

export default {
  id: 'molde',
  title: 'Talle y molde',
  short: 'Molde',
  icon: '📐',
  scored: true,
  help: `<p>Elegí el <b>talle</b>, el <b>calce</b>, las <b>mangas</b> y el <b>cuello</b>. La remera del maniquí cambia al instante y abajo ves la <b>moldería</b>: los moldes de papel que después vas a tizar sobre la tela.</p>
<ul>
<li><span class="kbd">←</span> <span class="kbd">→</span> cambian de talle. Arrastrá la remera para girarla.</li>
<li>Las cintas amarillas muestran las medidas de la prenda terminada (pecho de costado a costado, largo desde el hombro, largo de manga).</li>
<li>En el molde: línea llena = corte, punteada = costura (1 cm de margen, 2,5 cm en el ruedo), flecha = hilo de la tela, muescas = piquetes para que las piezas calcen.</li>
<li>En un pedido, lo que pidió el cliente tiene la marca <b>Pedido</b>.</li>
</ul>`,

  defaults(state) {
    state.pattern = defaultPattern(state.order);
  },

  async enter(ctx) {
    const { ui, h, state, engine, THREE, audio, world } = ctx;
    const order = state.order;
    const req = patternRequirements(order);
    const fab = fabricById(state.fabric.id) || fabricById('algodon_jersey');

    // selección inicial: lo que haya en el estado (si es válido) o la de defecto
    let sel = { ...DEFAULT, ...(state.pattern || {}) };
    if (!sizeById(sel.size) || !fitById(sel.fit) || !sleeveById(sel.sleeve) || !neckById(sel.neck)) sel = defaultPattern(order);
    let busy = false;

    // ---------- escena ----------
    state.pattern = { ...sel };
    ctx.updateShirt();
    ctx.placeShirt('preview');
    const shirt = ctx.shirt;
    ctx.track(() => {
      shirt.group.rotation.set(0, 0, 0);
      shirt.group.scale.set(1, 1, 1);
    });
    const anchor = world.props.mannequinPreview?.neckAnchor?.clone() || new THREE.Vector3(ctx.stations.materiales.preview[0], 1.45, ctx.stations.materiales.preview[2]);

    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const canvas = engine.canvas;

    // Encuadre: la remera entera (con mangas) centrada en el área libre de la pantalla.
    let lastDist = 0;
    function frameView(pattern) {
      const out = pattern.silhouette.front.outline;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = 0.03;
      for (const p of out) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
      }
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      const mobile = isMobile();
      const pEl = ui.panelEl;
      let right = 0;
      let bottom = 0;
      if (pEl && !pEl.classList.contains('hidden')) {
        if (mobile) bottom = pEl.classList.contains('collapsed') ? 64 : Math.min(pEl.offsetHeight || H * 0.48, H * 0.48);
        else right = (pEl.offsetWidth || 440) + 24;
      }
      const top = mobile ? 50 : 58;
      const fw = W - right - (mobile ? 16 : 60);
      const fh = H - bottom - top - (mobile ? 36 : 70);
      const tan = Math.tan(((engine.camera.fov || 45) * Math.PI) / 360);
      const sw = maxX - minX;
      const sh = maxY - minY + 0.06;
      const wpp = Math.max(sw / Math.max(120, fw * 0.84), sh / Math.max(120, fh * 0.8));
      const dist = clamp((wpp * H) / (2 * tan), 1.1, 4.2);
      // corrimiento vertical: el área libre empieza debajo de la barra superior
      const shiftY = ((top - (mobile ? 0 : 6)) / 2) * ((2 * dist * tan) / H);
      const cx = anchor.x + (minX + maxX) / 2;
      const cy = anchor.y + (minY + maxY) / 2 + shiftY * 0.9;
      const yaw = mobile ? 0.12 : 0.2;
      const pitch = 0.1;
      const target = new THREE.Vector3(cx, cy, anchor.z);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const position = target.clone().addScaledVector(dir, dist);
      return { view: { position: position.toArray(), target: target.toArray() }, dist };
    }
    function reframe(pattern, duration = 0.8, force = false) {
      const { view, dist } = frameView(pattern);
      if (!force && lastDist && Math.abs(dist - lastDist) / lastDist < 0.06) return;
      lastDist = dist;
      ctx.flyTo(view, duration);
    }

    // ---------- panel ----------
    const icons = (() => {
      const make = (opts, crop) => silhouetteIcon(createPattern({ ...DEFAULT, ...opts }).silhouette.front.outline, { crop, size: 40 });
      // calce: las tres siluetas a la MISMA escala y con la diferencia exagerada (entallada con
      // cintura marcada, oversize más ancha y de hombro caído); si no, a 40 px se ven iguales
      const fitOutline = (id) => {
        const out = createPattern({ ...DEFAULT, fit: id }).silhouette.front.outline;
        const waist = (y) => Math.exp(-(((y + 0.43) / 0.14) ** 2));
        if (id === 'slim') return out.map((p) => ({ x: p.x * (0.9 - 0.12 * waist(p.y)), y: p.y }));
        if (id === 'oversize') return out.map((p) => ({ x: p.x * 1.1, y: p.y * 1.03 - (Math.abs(p.x) > 0.17 && p.y > -0.2 ? 0.02 : 0) }));
        return out;
      };
      const fitOutlines = Object.fromEntries(FITS.map((f) => [f.id, fitOutline(f.id)]));
      const fitFrame = outlinesBox(Object.values(fitOutlines));
      return {
        fit: Object.fromEntries(FITS.map((f) => [f.id, () => silhouetteIcon(fitOutlines[f.id], { frame: fitFrame, size: 40 })])),
        sleeve: Object.fromEntries(SLEEVES.map((s) => [s.id, () => make({ sleeve: s.id })])),
        neck: Object.fromEntries(NECKS.map((n) => [n.id, () => make({ neck: n.id }, { minY: -0.3, minX: -0.32, maxX: 0.32 })])),
      };
    })();

    const controls = {};
    // talles: etiquetas tejidas con el ancho de pecho
    const sizeRow = h('div', { class: 'molde-sizes', role: 'radiogroup', 'aria-label': 'Talle' });
    for (const s of SIZES) {
      const btn = h(
        'button',
        { class: 'molde-size', type: 'button', role: 'radio', dataset: { id: s.id }, title: `Talle ${s.id}: ${s.chest} cm de ancho de pecho, ${s.length} cm de largo`, onClick: () => choose('size', s.id) },
        h('span', { class: 'molde-size-id' }, s.id),
        h('span', { class: 'molde-size-sub' }, `${s.chest} cm`),
        req.size === s.id ? h('span', { class: 'molde-badge' }, 'Pedido') : null,
      );
      sizeRow.appendChild(btn);
    }
    controls.size = sizeRow;
    const fitLine = h('div', { class: 'molde-fitline' });

    const cards = (key, list, sub) => {
      const row = h('div', { class: `molde-cards cols-${list.length}`, role: 'radiogroup' });
      for (const o of list) {
        row.appendChild(
          h(
            'button',
            { class: 'molde-card', type: 'button', role: 'radio', dataset: { id: o.id }, title: o.desc || o.name, onClick: () => choose(key, o.id) },
            h('span', { class: 'molde-card-icon' }, icons[key][o.id]()),
            h('span', { class: 'molde-card-name' }, o.name),
            sub ? h('span', { class: 'molde-card-sub' }, sub(o)) : null,
            req[key] === o.id ? h('span', { class: 'molde-badge' }, 'Pedido') : null,
          ),
        );
      }
      controls[key] = row;
      return row;
    };
    const fitSub = { slim: '−4 cm de contorno', regular: 'el de siempre', oversize: 'hombro caído' };
    const sleeveSub = (o) => (o.length ? `${o.length} cm` : 'con ribetes');
    const neckSub = { redondo: 'ribb de 4 cm', v: 'más profundo' };

    const measuresEl = h('div', { class: 'molde-measures' });
    const tapeToggle = ui.toggle({ label: '📏 Cintas métricas sobre la remera', value: true, onChange: (v) => tape.setVisible(v) });
    tapeToggle.classList.add('molde-tape-toggle');

    const sheetWrap = h('div', { class: 'molde-sheet-wrap', title: 'Tocá para ver la moldería grande', onClick: (e) => !e.target.closest('.molde-sheet-zoom') && openBigSheet() });
    const sheetZoom = h('button', { class: 'molde-sheet-zoom', type: 'button', onClick: () => openBigSheet() }, '⤢ Ampliar');
    const sheetCap = h('div', { class: 'molde-sheet-cap' });
    const legend = h(
      'div',
      { class: 'molde-sheet-legend' },
      h('span', {}, h('i', {}), 'corte'),
      h('span', {}, h('i', { class: 'seam' }), 'costura'),
      h('span', {}, h('i', { class: 'grain' }), 'hilo de la tela'),
    );
    const fabricEl = h('div', { class: 'molde-fabric' });
    const tipsEl = h('div', { class: 'molde-tips' });
    // aviso flotante "Ver la moldería" mientras la hoja de moldes quede fuera de la vista del panel
    // (se desplaza solo el cuerpo del panel: scrollIntoView podría mover también la página)
    const scrollToSheet = (smooth = true) => {
      const body = ui.bodyEl;
      if (!body) return;
      const br = body.getBoundingClientRect();
      const er = sheetWrap.getBoundingClientRect();
      const top = body.scrollTop + er.top - br.top - Math.max(8, (br.height - er.height) / 2);
      body.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    };
    const peek = h(
      'button',
      {
        class: 'molde-peek',
        type: 'button',
        onClick: () => {
          audio.play('select');
          scrollToSheet();
        },
      },
      h('span', { class: 'molde-peek-ico', 'aria-hidden': 'true' }, '📐'),
      h('span', {}, 'Ver la moldería'),
      h('b', { class: 'molde-peek-arrow', 'aria-hidden': 'true' }, '↓'),
    );
    const peekWrap = h('div', { class: 'molde-peek-wrap hide' }, peek);
    let sheetSeen = false;
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            // "vista" = al menos 40 % de la hoja adentro del panel (una franjita no alcanza)
            sheetSeen = en.isIntersecting && en.intersectionRatio >= 0.4;
            peekWrap.classList.toggle('hide', sheetSeen);
            // la flecha apunta hacia donde quedó la hoja (arriba si ya se pasó de largo)
            const above = en.rootBounds && en.boundingClientRect.top < en.rootBounds.top;
            peek.querySelector('.molde-peek-arrow').textContent = above ? '↑' : '↓';
          }
        },
        { root: ui.bodyEl || null, threshold: [0, 0.2, 0.4, 0.6, 1] },
      );
      io.observe(sheetWrap);
      ctx.track(() => io.disconnect());
    }
    const pulsePeek = () => {
      if (sheetSeen) return;
      peek.classList.remove('pulse');
      void peek.offsetWidth;
      peek.classList.add('pulse');
    };

    let orderEl = null;
    const orderItems = [];
    if (order) {
      const list = h('ul', { class: 'molde-order-list' });
      for (const k of KEYS) {
        if (!req[k]) continue;
        const li = h('li', {});
        orderItems.push({ key: k, li });
        list.appendChild(li);
      }
      orderEl = h(
        'div',
        { class: 'molde-order' },
        h('div', { class: 'molde-order-head' }, h('span', { class: 'molde-order-avatar' }, order.avatar), h('span', {}, h('b', {}, order.name), orderItems.length ? ' te pidió:' : '')),
        orderItems.length ? list : h('p', { class: 'molde-order-free' }, 'Talle y corte a gusto del taller. ¡Lucite!'),
      );
    }

    const body = h(
      'div',
      { class: 'molde-panel' },
      orderEl,
      ui.section('Talle', sizeRow, fitLine),
      ui.section('Calce', cards('fit', FITS, (o) => fitSub[o.id])),
      ui.section('Mangas', cards('sleeve', SLEEVES, sleeveSub)),
      ui.section('Cuello', cards('neck', NECKS, (o) => neckSub[o.id])),
      ui.section('Moldería', sheetWrap, sheetCap, legend, fabricEl),
      ui.section('Medidas de la prenda terminada', measuresEl, tapeToggle),
      tipsEl,
      peekWrap,
    );

    ui.panel({
      kicker: 'Paso 3 · Depósito de materiales',
      title: 'Talle y molde',
      subtitle: 'Elegí el talle y el corte: la remera del maniquí se ajusta al instante y abajo aparecen los moldes de papel que vas a cortar.',
      body,
      wide: true,
      actions: [
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => confirm(true) },
        { id: 'ok', label: 'Usar este molde →', kind: 'primary', onClick: () => confirm(false) },
      ],
    });
    ui.panelEl?.classList.add('molde-step');
    // si quedó un desplazamiento suave del panel en curso, se corta (si no, sigue sobre el panel del paso siguiente)
    ctx.track(() => ui.bodyEl?.scrollTo({ top: ui.bodyEl.scrollTop, behavior: 'instant' }));
    ctx.track(() => ui.panelEl?.classList.remove('molde-step'));
    ui.hint(isMobile() ? 'Tocá las opciones del panel · deslizá la remera para girarla' : 'Elegí en el panel · <kbd>←</kbd> <kbd>→</kbd> cambian de talle · arrastrá la remera para girarla');
    ctx.timeout(() => ui.hint(null), 9000);

    // ---------- cintas métricas ----------
    const tape = createTape({ engine, shirt, THREE, h });
    ctx.track(() => tape.dispose());

    // ---------- aplicar la selección ----------
    let sheet = null;
    let pop = 1;
    let dirty3D = false;
    let lastApply = -1;

    function refreshPanel(animateSheet = true) {
      const pattern = createPattern({ ...sel });
      for (const k of KEYS) {
        for (const b of controls[k].children) {
          const on = b.dataset.id === sel[k];
          b.classList.toggle('selected', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        }
      }
      const m = pattern.measurements;
      const ease = easeOf(pattern);
      fitLine.innerHTML = `Para un pecho de cuerpo de <b>~${bodyChest(sel.size)} cm</b> · holgura <b>${ease >= 0 ? '+' : ''}${ease} cm</b> con calce ${lowerFirst(fitById(sel.fit).name)}`;
      measuresEl.innerHTML = '';
      measuresEl.appendChild(
        ui.propTable([
          ['Ancho de pecho', `${cmTxt(m.chest)} cm (contorno ${cmTxt(m.chest * 2)})`],
          ['Largo total', `${cmTxt(m.length)} cm`],
          ['Hombro a hombro', `${cmTxt(m.shoulder)} cm`],
          ['Largo de manga', m.sleeveLength ? `${cmTxt(m.sleeveLength)} cm` : '— (sin mangas)'],
          ['Escote', `${cmTxt(m.neckWidth)} cm de ancho · ${cmTxt(m.frontNeckDepth)} cm de bajada`],
          ['Ancho de ruedo', `${cmTxt(m.hemWidth)} cm`],
        ]),
      );
      // moldería
      const r = renderSheet(pattern, { sizeLabel: sel.size, fitLabel: fitById(sel.fit).name, animate: animateSheet });
      sheetWrap.innerHTML = '';
      sheetWrap.append(r.svg, sheetZoom);
      sheet = r;
      bindSheetHover(r, sheetCap);
      sheetCap.innerHTML = `${pieceCount(pattern)} piezas · pasá el dedo o el mouse por un molde para ver sus medidas`;
      // tela estimada
      const meters = fabricEstimate(pattern);
      const cost = Math.round(meters * fab.pricePerMeter);
      fabricEl.innerHTML = `<span>🧵 Consumo estimado de <b>${fab.short}</b>: <b>${mTxt(meters)} m</b></span><b>${money(cost)}</b>${meters > 1.4 ? '<small>Las piezas no entran lado a lado en el ancho de la tela (1,20 m): se usa mucho más largo.</small>' : '<small>Con tela de 1,20 m de ancho. El largo exacto sale del tizado.</small>'}`;
      ctx.addCost('Tela', cost);
      // consejos
      tipsEl.innerHTML = '';
      for (const t of patternTips(pattern, fab).slice(1, 4)) tipsEl.appendChild(ui.note(t.html, t.type));
      // pedido
      for (const it of orderItems) {
        const ok = sel[it.key] === req[it.key];
        it.li.className = ok ? 'ok' : 'no';
        it.li.textContent = `${ok ? '✓' : '✗'} ${label[it.key](req[it.key]).replace(/^./, (c) => c.toUpperCase())}`;
      }
      return pattern;
    }

    function pieceCount(pattern) {
      return pattern.pieces.length;
    }

    function bindSheetHover(r, cap) {
      for (const [, g] of r.groups) {
        const show = () => {
          for (const [, o] of r.groups) o.classList.toggle('hover', o === g);
          cap.innerHTML = `<b>${g.dataset.info.split(' · ')[0]}</b> · ${g.dataset.info.split(' · ').slice(1).join(' · ')}`;
        };
        g.addEventListener('pointerenter', show);
        g.addEventListener('pointerdown', show);
        g.addEventListener('pointerleave', () => g.classList.remove('hover'));
      }
    }

    let bigModal = null;
    // si se sale del paso con la moldería grande abierta, se cierra (con su propio botón: así suelta su listener)
    const closeBigSheet = () => {
      if (!bigModal || !bigModal.isConnected) return;
      const btn = bigModal.querySelector('.modal-foot .btn');
      if (btn) btn.click();
      else bigModal.remove();
      bigModal = null;
    };
    ctx.track(closeBigSheet);
    function openBigSheet() {
      if (busy || (bigModal && bigModal.isConnected)) return;
      const pattern = createPattern({ ...sel });
      const r = renderSheet(pattern, { sizeLabel: sel.size, fitLabel: fitById(sel.fit).name, animate: true });
      const cap = h('div', { class: 'molde-sheet-cap' }, 'Pasá el mouse por un molde para ver sus medidas');
      // la hoja entra entera en la pantalla (manga larga = hoja alta): el ancho sale de la altura disponible
      r.svg.style.width = `min(100%, calc((100vh - 260px) * ${(r.width / r.height).toFixed(4)}))`;
      const wrap = h('div', { class: 'molde-modal-sheet' }, h('div', { class: 'molde-sheet-big' }, r.svg), cap, legend.cloneNode(true));
      bindSheetHover(r, cap);
      audio.play('select');
      ui.modal({
        title: `Moldería · talle ${sel.size} · ${fitById(sel.fit).name}`,
        body: wrap,
        wide: true,
        actions: [{ id: 'ok', label: 'Cerrar', kind: 'primary' }],
      }).then(() => (bigModal = null));
      bigModal = wrap.closest('.modal-wrap');
    }

    function apply3D() {
      state.pattern = { ...sel };
      ctx.updateShirt();
      tape.build(shirt.pattern);
      pop = 0;
      dirty3D = false;
      reframe(shirt.pattern);
    }

    function choose(key, id) {
      if (busy || sel[key] === id) return;
      sel[key] = id;
      audio.play('select');
      refreshPanel(true);
      dirty3D = true;
      pulsePeek();
    }

    // ---------- interacción 3D: girar la remera ----------
    let userYaw = 0;
    let yawVel = 0;
    let phase = 0;
    let down = null;
    let spin = null; // { t } vuelta completa al confirmar
    let lastHover = 0;
    const onShirt = () => {
      const m = shirt.getPanelMeshes();
      return engine.raycast([m.frente, m.espalda].filter(Boolean), null, false).length > 0;
    };
    ctx.track(() => (canvas.style.cursor = ''));
    ctx.onPointer('down', (e, p) => {
      if (busy) return;
      if (onShirt()) {
        down = { lastX: p.x };
        canvas.style.cursor = 'grabbing';
      }
    });
    ctx.onPointer('move', (e, p) => {
      if (down) {
        const dx = p.x - down.lastX;
        down.lastX = p.x;
        userYaw += dx * 0.012;
        yawVel = dx * 0.012;
      } else if (!busy && engine.pointer.inside && e.target === canvas) {
        // el raycast contra la remera (malla densa) se hace como mucho cada 60 ms
        const now = performance.now();
        if (now - lastHover > 60) {
          lastHover = now;
          canvas.style.cursor = onShirt() ? 'grab' : '';
        }
      }
    });
    ctx.onPointer('up', () => {
      if (!down) return;
      down = null;
      canvas.style.cursor = '';
    });

    // teclado: ← → talles
    ctx.listen(window, 'keydown', (e) => {
      if (busy || e.defaultPrevented) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
      if (document.querySelector('.modal-wrap')) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = SIZES.findIndex((s) => s.id === sel.size);
      const j = clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, SIZES.length - 1);
      choose('size', SIZES[j].id);
    });

    let layoutMobile = isMobile();
    ctx.listen(window, 'resize', () => {
      const mob = isMobile();
      reframe(shirt.pattern, mob !== layoutMobile ? 0.6 : 0.3, true);
      layoutMobile = mob;
    });

    ctx.onUpdate((dt, t) => {
      if (!down) {
        phase += dt * 0.5;
        userYaw *= Math.exp(-dt * 0.8);
        userYaw += yawVel;
        yawVel *= Math.exp(-dt * 6);
      }
      if (dirty3D && t - lastApply > 0.12) {
        lastApply = t;
        apply3D();
      }
      pop = Math.min(1, pop + dt * 2.6);
      const s = 0.97 + 0.03 * easeOutBack(pop);
      let yaw = Math.sin(phase) * 0.16 + userYaw;
      if (spin) {
        spin.t = Math.min(1, spin.t + dt / 1.1);
        yaw += easeInOutCubic(spin.t) * Math.PI * 2;
      }
      shirt.group.rotation.y = yaw;
      shirt.group.scale.set(s, s, s);
      tape.update(dt);
    });

    // ---------- confirmar ----------
    async function confirm(auto) {
      if (busy) return;
      if (auto) {
        sel = defaultPattern(order);
        refreshPanel(false);
        audio.play('select');
      }
      busy = true;
      closeBigSheet();
      ui.enableAction('ok', false);
      ui.enableAction('auto', false);
      ui.hint(null);
      if (state.pattern.size !== sel.size || state.pattern.fit !== sel.fit || state.pattern.sleeve !== sel.sleeve || state.pattern.neck !== sel.neck || dirty3D) apply3D();
      const pattern = shirt.pattern;
      const meters = fabricEstimate(pattern);
      ctx.addCost('Tela', Math.round(meters * fab.pricePerMeter));
      const { score, notes } = scorePattern(state, { auto });
      // sello sobre la moldería (se lleva la hoja a la vista para verlo) + vuelta completa de la remera
      const needScroll = !sheetSeen;
      if (needScroll) scrollToSheet();
      const stampDelay = needScroll ? 450 : 0;
      ctx.timeout(() => {
        if (sheet) stampSheet(sheet.svg, `MOLDE OK · T. ${sel.size}`);
        audio.play('press');
      }, stampDelay);
      ctx.timeout(() => audio.play('snip'), stampDelay + 380);
      spin = { t: 0 };
      tape.setVisible(false);
      const txt = `📐 Talle ${sel.size} · ${fitById(sel.fit).name} · ${sleeveById(sel.sleeve).name} · ${neckById(sel.neck).name}`;
      ui.toast(`${txt}: moldes listos para tizar`, score >= 85 ? 'good' : score >= 60 ? 'info' : 'warn', 3800);
      if (order) {
        const bad = notes.filter((n) => n.startsWith(NO)).length;
        if (bad) ui.toast(`📋 Ojo: el molde no cumple ${bad === 1 ? 'un requisito' : `${bad} requisitos`} del pedido de ${order.name}.`, 'bad', 4400);
      }
      await new Promise((r) => ctx.timeout(r, 1300 + stampDelay));
      if (!ctx.alive) return;
      await ctx.complete({ score, notes, silent: true });
    }

    refreshPanel(true);
    tape.build(shirt.pattern);
    // el panel se acomoda en el próximo frame: recién ahí se sabe cuánto tapa
    await new Promise((r) => requestAnimationFrame(() => r()));
    if (!ctx.alive) return;
    reframe(shirt.pattern, 1.3, true);
  },
};
