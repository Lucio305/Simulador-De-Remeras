// Paso 1 · Elegir la tela (tipo + color + jaspeado).
// La remera del maniquí de prueba se viste en vivo con la tela elegida y el rollo de la
// estantería se desenrolla con ese color. Se puede elegir desde el panel o tocando los
// rollos en 3D; la muestra del panel se puede estirar para sentir la elasticidad.

import { fabricSwatch } from '../materials/fabric.js';
import { createRetazo, maxStretchOf } from './hilo/retazo.js';
import { clamp, money } from '../core/utils.js';

const DEG = Math.PI / 180;
const OK = '<span class="hilo-mark ok">✓</span>';
const NO = '<span class="hilo-mark no">✗</span>';
const MID = '<span class="hilo-mark mid">≈</span>';
const SWAY = 35 * DEG;

// ---------------------------------------------------------------------------
// Reglas (exportadas para reutilizar en otros pasos / pruebas)
// ---------------------------------------------------------------------------

export function weightName(gsm) {
  return gsm < 155 ? 'liviana' : gsm < 185 ? 'peso medio' : 'pesada';
}

// Requisitos del pedido que tocan a la tela: { fabrics, colors, heather } (null = libre).
export function fabricRequirements(order) {
  const r = order?.req || {};
  const colors = r.color ? [r.color] : r.colors ? [...r.colors] : null;
  const fabrics = r.fabrics ? [...r.fabrics] : null;
  // "una remera jaspeada": solo se pidió el 50/50, que se luce en melange
  const heather = fabrics && fabrics.length === 1 && fabrics[0] === 'mezcla' ? true : null;
  return { fabrics, colors, heather, any: !!(colors || fabrics) };
}

// Id de color de catálogo para un hex (si coincide exactamente con uno de la paleta).
export function colorIdForHex(catalog, hex) {
  const n = String(hex || '').toLowerCase();
  return catalog.FABRIC_COLORS.find((c) => c.hex.toLowerCase() === n)?.id || null;
}

export function checkFabricOrder(catalog, order, fabric) {
  const req = fabricRequirements(order);
  const colorId = fabric.colorId || colorIdForHex(catalog, fabric.color);
  return {
    req,
    fabricOk: !req.fabrics || req.fabrics.includes(fabric.id),
    colorOk: !req.colors || req.colors.includes(colorId),
    heatherOk: req.heather === null || !!fabric.heather === req.heather,
  };
}

// Consejos de oficio para la combinación elegida (máximo 3, de más a menos importante).
export function fabricTips(catalog, fab, hex, heather) {
  const lum = catalog.luminance(hex);
  const tips = [];
  const byFabric = {
    algodon_jersey: 'El <b>algodón jersey</b> es el más noble para empezar: fácil de coser y de estampar. Sin prelavado encoge ~5 %.',
    algodon_peinado: 'El <b>algodón peinado</b> tiene la superficie más lisa y pareja: ideal para estampas con detalle fino.',
    pique: 'El <b>piqué</b> tiene relieve de panal: las estampas muy finas pierden definición; el bordado le queda bárbaro.',
    lino: 'El <b>lino</b> es tejido plano (no estira) y se arruga muchísimo: plancha al máximo con vapor y molde con holgura.',
    poliester: 'El <b>dry-fit</b> es el rey de la sublimación en colores claros. Plancha al mínimo: el poliéster se derrite.',
    modal: 'El <b>modal</b> tiene caída y brillo sedoso, pero es delicado con el calor: plancha tibia y sin vapor.',
    mezcla: 'El <b>50/50</b> no se deforma y encoge poco; acepta sublimación con look vintage (algo desteñido).',
  };
  if (byFabric[fab.id]) tips.push({ type: 'info', html: byFabric[fab.id] });
  if (fab.id === 'lino' && lum > 0.62) tips.push({ type: 'warn', html: '<b>Lino claro:</b> fresquísimo, pero transparenta un poco. Ojo con estampas oscuras en la espalda: se marcan al frente.' });
  else if (fab.id === 'poliester' && lum < 0.45) tips.push({ type: 'warn', html: '<b>Dry-fit oscuro:</b> la sublimación tiñe pero no cubre, así que en este color no se va a ver. Pensá en vinilo o DTF.' });
  else if (lum < 0.2) tips.push({ type: 'info', html: '<b>Color oscuro:</b> para estampar vas a necesitar tintas cubrientes (serigrafía plastisol, DTF o vinilo).' });
  else if (lum > 0.86) tips.push({ type: 'info', html: '<b>Blanco:</b> acepta cualquier técnica de estampado… y también se le nota cualquier mancha.' });
  if (heather && fab.id !== 'mezcla') tips.push({ type: 'info', html: '<b>Melange:</b> las fibras de distintos tonos disimulan pelusas y manchitas (en algodón puro sale un poco más caro).' });
  else if (!heather && fab.id === 'mezcla') tips.push({ type: 'info', html: 'Elegiste el 50/50 <b>liso</b>: también existe, aunque su look clásico es el jaspeado.' });
  return tips.slice(0, 3);
}

function colorName(catalog, fabric) {
  const id = fabric.colorId || colorIdForHex(catalog, fabric.color);
  return catalog.colorById(id)?.name || `color ${String(fabric.color).toUpperCase()}`;
}

// Puntaje del paso. libre = 90 + consejos; pedido = 100 − 40 por tela/color fuera de lo pedido.
export function scoreFabric(catalog, state, { auto = false } = {}) {
  const fab = catalog.fabricById(state.fabric.id);
  const notes = [];
  let score;
  if (state.order) {
    const o = state.order;
    const chk = checkFabricOrder(catalog, o, state.fabric);
    score = 100;
    if (chk.req.fabrics) {
      const want = chk.req.fabrics.map((id) => catalog.fabricById(id)?.short).join(' o ');
      if (chk.fabricOk) notes.push(`${OK} Tela pedida por ${o.name}: <b>${fab.short}</b>.`);
      else {
        score -= 40;
        notes.push(`${NO} ${o.name} pidió <b>${want}</b> y elegiste ${fab.short} (−40).`);
      }
    }
    if (chk.req.colors) {
      const want = chk.req.colors.map((id) => catalog.colorById(id)?.name).join(' o ');
      if (chk.colorOk) notes.push(`${OK} Color pedido: <b>${colorName(catalog, state.fabric)}</b>.`);
      else {
        score -= 40;
        notes.push(`${NO} ${o.name} pidió color <b>${want}</b> y elegiste ${colorName(catalog, state.fabric)} (−40).`);
      }
    }
    if (!chk.heatherOk) {
      score -= 20;
      notes.push(`${NO} ${o.name} quería la remera <b>jaspeada</b>: apagaste el melange (−20).`);
    }
    if (!chk.req.any) notes.push(`${o.name} dejó la tela y el color a gusto del taller.`);
  } else {
    score = 90;
    notes.push('En taller libre no hay tela "incorrecta": cada una tiene su carácter. Lo importante es que combine con lo que vas a hacer.');
  }
  if (auto) {
    score = Math.min(score, 72);
    notes.unshift(`${MID} Elegida en automático por el taller: la próxima elegila vos y sumá más puntos.`);
  }
  for (const t of fabricTips(catalog, fab, state.fabric.color, state.fabric.heather)) notes.push(t.html);
  return { score: clamp(score, 0, 100), notes };
}

// Selección por defecto: lo que pide el cliente o algodón jersey blanco.
function defaultChoice(catalog, order) {
  const req = fabricRequirements(order);
  const fab = catalog.fabricById(req.fabrics?.[0] || 'algodon_jersey');
  // sin color pedido: blanco, salvo el 50/50, que se luce en el gris melange clásico
  const col = catalog.colorById(req.colors?.[0] || (fab.id === 'mezcla' ? 'gris' : 'blanco'));
  return { id: fab.id, color: col.hex, colorId: col.id, heather: req.heather ?? !!fab.heather };
}

function dots(value, max = 5, cls = '') {
  const n = Math.round(clamp(value) * max);
  let s = '';
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="tela-dots ${cls}">${s}</span>`;
}

// ---------------------------------------------------------------------------

export default {
  id: 'tela',
  title: 'Elegir la tela',
  short: 'Tela',
  icon: '🧶',
  scored: true,
  help: `<p>Elegí el <b>tipo de tela</b>, el <b>color</b> y si la querés <b>jaspeada</b> (melange). La remera del maniquí se viste al instante con tu elección.</p>
<ul>
<li>Tocá un rollo de la estantería o una tarjeta del panel (<span class="kbd">←</span> <span class="kbd">→</span> recorren las telas).</li>
<li>Arrastrá la remera para girarla y mirá cómo cae la luz sobre la trama.</li>
<li>Tirá de la muestra del panel para sentir cuánto estira: el punto cede, el tejido plano casi nada.</li>
<li>En un pedido, las opciones que pidió el cliente tienen la marca <b>Pedido</b>.</li>
</ul>`,

  defaults(state, ctx) {
    const catalog = ctx.catalog;
    const ch = defaultChoice(catalog, state.order);
    state.fabric = { ...ch };
    if (state.thread?.match !== false) {
      state.thread.color = ch.color;
      state.thread.colorId = ch.colorId;
    }
    const fab = catalog.fabricById(ch.id);
    ctx.addCost?.('Tela', Math.round(catalog.COSTS.fabricMetersBase * fab.pricePerMeter));
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, THREE, audio } = ctx;
    const { FABRICS, FABRIC_COLORS, COSTS, IRON_LEVELS } = catalog;
    const shelf = world.props.shelf;
    const rolls = shelf?.rolls || [];

    // Pose original de los rollos: se restaura al salir.
    const originals = new Map(rolls.map((r) => [r, r.color]));
    ctx.track(() => {
      for (const [r, color] of originals) {
        r.setColor(color);
        r.setHighlight(false);
      }
    });

    // Selección inicial (lo que ya hay en el estado; si no es válido, la de defecto).
    let sel = { ...state.fabric };
    if (!catalog.fabricById(sel.id)) sel = defaultChoice(catalog, state.order);
    if (!sel.colorId) sel.colorId = colorIdForHex(catalog, sel.color);
    const order = state.order;
    const req = fabricRequirements(order);

    // ---------- escena ----------
    ctx.placeShirt('preview');
    const shirt = ctx.shirt;
    ctx.track(() => {
      shirt.group.rotation.set(0, 0, 0);
      shirt.group.scale.set(1, 1, 1);
    });
    // En el celular la escena libre es una franja chica arriba del panel: se encuadra la
    // remera con un costado de la estantería (en escritorio, la vista de la estación).
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const mainView = () => (isMobile() ? { position: [-4.5, 1.32, 1.45], target: [-4.42, 1.12, -2.0] } : ctx.stations.materiales.view);
    ctx.flyTo(mainView(), 1.4);
    let layoutMobile = isMobile();
    ctx.listen(window, 'resize', () => {
      if (isMobile() === layoutMobile || busy) return;
      layoutMobile = isMobile();
      ctx.flyTo(closeup ? closeView() : mainView(), 0.8);
    });
    let phase = 0;
    let closeup = false;
    let userYaw = 0;
    let yawVel = 0;

    // ---------- panel ----------
    const fabCards = new Map();
    const grid = h('div', { class: 'tela-grid', role: 'listbox', 'aria-label': 'Telas' });
    for (const f of FABRICS) {
      const sw = h('span', { class: 'tela-card-sw' });
      const reqd = req.fabrics?.includes(f.id);
      const card = h(
        'button',
        { class: 'tela-card', type: 'button', role: 'option', dataset: { id: f.id }, title: f.name, onClick: () => selectFabric(f.id, { from: 'panel' }) },
        sw,
        h('span', { class: 'tela-card-text' }, h('span', { class: 'tela-card-name' }, f.short), h('span', { class: 'tela-card-sub' }, `${f.gsm} g/m² · ${f.knit ? 'punto' : 'plano'}`)),
        reqd ? h('span', { class: 'tela-badge' }, 'Pedido') : null,
      );
      fabCards.set(f.id, { card, sw });
      grid.appendChild(card);
    }

    const detailName = h('h3', { class: 'tela-detail-name' });
    const detailDesc = h('p', { class: 'tela-detail-desc' });
    const detailTable = h('div', { class: 'tela-detail-table' });
    const retazo = createRetazo({ h, listen: ctx.listen, height: 88, seam: false, idleText: 'estirá →', staleText: 'Otra tela, otra elasticidad: estirala de nuevo.' });
    ctx.onUpdate((dt) => retazo.update(dt));
    retazo.onResult(({ maxStretch }) => {
      const f = catalog.fabricById(sel.id);
      const p = Math.round(maxStretch * 100);
      let html;
      if (!f.knit) html = `<b>Apenas ${p} %.</b> El tejido plano casi no cede: por eso se cose con puntada recta y el molde lleva un poco más de holgura.`;
      else if (f.stretch >= 0.7) html = `<b>¡${p} %!</b> Con elastano estira muchísimo y vuelve a su forma: hilo elástico y aguja punta bola, sí o sí.`;
      else if (f.stretch <= 0.35) html = `<b>${p} %.</b> Es de punto, pero firme: estira poco y mantiene bien la forma (por eso se usa en chombas).`;
      else html = `<b>${p} %.</b> El tejido de punto cede y vuelve: las costuras tienen que acompañar ese estiramiento.`;
      retazo.setVerdict(h('div', { class: 'tela-retazo-msg', html }));
      audio.play('pop');
    });
    const detail = h(
      'div',
      { class: 'tela-detail' },
      h('div', { class: 'tela-detail-head' }, detailName, h('span', { class: 'tela-detail-price' })),
      detailDesc,
      detailTable,
      h('div', { class: 'tela-retazo-title' }, '🖐 Tirá de la muestra para sentir cuánto estira'),
      retazo.el,
    );

    const palette = ui.colorPalette({
      colors: FABRIC_COLORS,
      value: sel.color,
      allowCustom: true,
      onChange: (hex, c) => selectColor(hex, c ? c.id : colorIdForHex(catalog, hex)),
    });
    palette.classList.add('tela-palette');
    if (req.colors) {
      for (const b of palette.querySelectorAll('.swatch-btn[data-id]')) if (req.colors.includes(b.dataset.id)) b.classList.add('tela-req');
    }
    const heatherToggle = ui.toggle({ label: 'Jaspeado (melange)', value: sel.heather, onChange: (v) => selectHeather(v) });
    heatherToggle.classList.add('tela-heather');
    const zoomBtn = h('button', { class: 'btn btn-secondary btn-sm tela-zoom', type: 'button', onClick: () => toggleCloseup() }, '🔍 Mirar la trama de cerca');

    const tipsEl = h('div', { class: 'tela-tips' });
    const costEl = h('div', { class: 'tela-cost' });

    let orderEl = null;
    let orderItems = [];
    if (order) {
      const list = h('ul', { class: 'tela-order-list' });
      if (req.fabrics) orderItems.push({ key: 'fabric', li: h('li', {}), text: `Tela: ${req.fabrics.map((id) => catalog.fabricById(id)?.short).join(' o ')}` });
      if (req.colors) orderItems.push({ key: 'color', li: h('li', {}), text: `Color: ${req.colors.map((id) => catalog.colorById(id)?.name).join(' o ')}` });
      if (req.heather) orderItems.push({ key: 'heather', li: h('li', {}), text: 'Jaspeada (melange)' });
      for (const it of orderItems) list.appendChild(it.li);
      orderEl = h(
        'div',
        { class: 'tela-order' },
        h('div', { class: 'tela-order-head' }, h('span', { class: 'tela-order-avatar' }, order.avatar), h('span', {}, h('b', {}, order.name), ' te pidió:')),
        orderItems.length ? list : h('p', { class: 'tela-order-free' }, 'Tela y color a gusto del taller. ¡Lucite!'),
      );
    }

    const body = h(
      'div',
      { class: 'tela-panel' },
      orderEl,
      ui.section('Tela', grid),
      detail,
      ui.section('Color', palette, heatherToggle, zoomBtn),
      tipsEl,
      costEl,
    );

    ui.panel({
      kicker: 'Paso 1 · Depósito de materiales',
      title: 'Elegir la tela',
      subtitle: 'Tocá un rollo de la estantería o elegí en la lista: la remera del maniquí se viste con esa tela al instante.',
      body,
      actions: [
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => confirm(true) },
        { id: 'ok', label: 'Usar esta tela →', kind: 'primary', onClick: () => confirm(false) },
      ],
    });
    ui.panelEl?.classList.add('tela-step');
    ctx.track(() => ui.panelEl?.classList.remove('tela-step'));
    ui.hint(isMobile() ? 'Tocá un rollo para probar la tela · deslizá el dedo sobre la remera para girarla' : 'Tocá un rollo para probar la tela · arrastrá la remera para girarla · <kbd>←</kbd> <kbd>→</kbd> cambian de tela');
    ctx.timeout(() => ui.hint(null), 9000);

    // ---------- aplicar la selección ----------
    let dirty3D = true;
    let lastApply = -1;
    let skinKey = '';
    let cardKey = '';

    function refreshPanel() {
      const f = catalog.fabricById(sel.id);
      for (const [id, { card }] of fabCards) {
        const on = id === sel.id;
        card.classList.toggle('selected', on);
        card.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      detailName.textContent = f.name;
      detail.querySelector('.tela-detail-price').textContent = `${money(f.pricePerMeter)} / m`;
      detailDesc.textContent = f.desc;
      const iron = IRON_LEVELS.find((l) => l.level === f.ironLevel);
      const subl = f.sublimation >= 0.9 ? '<span class="tela-ok">Ideal</span>' : f.sublimation >= 0.4 ? '<span class="tela-mid">Vintage (desteñida)</span>' : '<span class="tela-no">No recomendada</span>';
      const shrinkTxt = `${String(Math.round(f.shrink * 1000) / 10).replace('.', ',')} %`;
      detailTable.innerHTML = '';
      detailTable.appendChild(
        ui.propTable([
          ['Composición', f.composition],
          ['Gramaje', `${f.gsm} g/m² · ${weightName(f.gsm)}`],
          ['Tejido', f.knit ? 'De punto (estira)' : 'Plano (no estira)'],
          ['Elasticidad', h('span', { html: dots(f.stretch) })],
          ['Se arruga', h('span', { html: dots(f.wrinkle / 1.7, 5, 'warm') })],
          ['Encoge sin prelavar', shrinkTxt],
          ['Plancha', h('span', { html: `<span class="tela-iron">${'•'.repeat(f.ironLevel)}</span> ${iron ? iron.name.replace(/^[•\s]+/, '') : ''}` })],
          ['Apta sublimación', h('span', { html: subl })],
          ['Precio', `${money(f.pricePerMeter)} por metro`],
        ]),
      );
      palette.setValue(sel.color);
      heatherToggle.input.checked = !!sel.heather;
      retazo.setConfig({ fabricId: f.id, color: sel.color, heather: !!sel.heather, maxStretch: maxStretchOf(f) });

      // consejos
      tipsEl.innerHTML = '';
      for (const t of fabricTips(catalog, f, sel.color, sel.heather)) tipsEl.appendChild(ui.note(t.html, t.type));
      // pedido
      if (order) {
        const chk = checkFabricOrder(catalog, order, sel);
        for (const it of orderItems) {
          const ok = it.key === 'fabric' ? chk.fabricOk : it.key === 'color' ? chk.colorOk : chk.heatherOk;
          it.li.className = ok ? 'ok' : 'no';
          it.li.textContent = `${ok ? '✓' : '✗'} ${it.text}`;
        }
      }
      // costo estimado
      const meters = COSTS.fabricMetersBase;
      costEl.innerHTML = `<span>✂️ Vas a cortar ~${String(meters).replace('.', ',')} m</span><b>${money(meters * f.pricePerMeter)}</b><small>El largo exacto sale del tizado.</small>`;
      dirty3D = true;
    }

    // Miniaturas teñidas con el color elegido (las tarjetas) y botones de color con la
    // trama de la tela elegida. Se hace en un frame aparte para no trabar el clic.
    function reskin() {
      const ck = `${sel.color}|${sel.id}|${sel.heather}`;
      if (ck !== cardKey) {
        cardKey = ck;
        for (const f of FABRICS) {
          const { sw } = fabCards.get(f.id);
          const url = fabricSwatch(f.id, sel.color, 96, { heather: f.id === sel.id ? !!sel.heather : undefined });
          sw.style.backgroundImage = `url(${url})`;
        }
      }
      const sk = `${sel.id}|${sel.heather}`;
      if (sk !== skinKey) {
        skinKey = sk;
        for (const b of palette.querySelectorAll('.swatch-btn[data-hex]')) {
          b.style.backgroundImage = `url(${fabricSwatch(sel.id, b.dataset.hex, 40, { heather: !!sel.heather })})`;
        }
      }
    }

    function apply3D() {
      state.fabric = { id: sel.id, color: sel.color, colorId: sel.colorId || null, heather: !!sel.heather };
      if (state.thread.match !== false) {
        state.thread.color = sel.color;
        state.thread.colorId = sel.colorId || null;
      }
      ctx.updateShirt();
      // el costo estimado se ve en vivo arriba (el tizado lo ajusta con los metros reales)
      ctx.addCost('Tela', Math.round(COSTS.fabricMetersBase * catalog.fabricById(sel.id).pricePerMeter));
      for (const r of rolls) {
        if (r.fabricId === sel.id) {
          if (r.color !== sel.color) r.setColor(sel.color);
          if (!r.highlighted) r.setHighlight(true);
        } else {
          const c0 = originals.get(r);
          if (r.color !== c0) r.setColor(c0);
          if (r.highlighted) r.setHighlight(false);
        }
      }
      dirty3D = false;
    }

    function selectFabric(id, { from = 'panel' } = {}) {
      if (busy) return;
      const f = catalog.fabricById(id);
      if (!f) return;
      if (id !== sel.id) {
        sel.id = id;
        // el 50/50 viene jaspeado; las demás, lisas (salvo que el pedido diga otra cosa)
        sel.heather = req.heather && id === 'mezcla' ? true : !!f.heather;
        audio.play('select');
        pop = 1;
      }
      refreshPanel();
      if (from !== 'panel') fabCards.get(id)?.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function selectColor(hex, colorId) {
      if (busy) return;
      sel.color = hex;
      sel.colorId = colorId || null;
      refreshPanel();
    }

    function selectHeather(v) {
      if (busy) return;
      sel.heather = !!v;
      audio.play('select');
      refreshPanel();
    }

    // ---------- interacción 3D ----------
    const tmp = new THREE.Vector3();
    const label = h('div', { class: 'world-label tela-roll-label' });
    const selLabel = h('div', { class: 'world-label tela-sel-label' });
    label.style.display = 'none';
    selLabel.style.display = 'none';
    document.getElementById('app').append(label, selLabel);
    ctx.track(() => {
      label.remove();
      selLabel.remove();
    });
    // etiqueta sobre la cara del rollo que mira a la cámara
    const placeLabel = (el, obj, dy, dz = 0) => {
      obj.getWorldPosition(tmp);
      tmp.y += dy;
      tmp.z += dz;
      const sp = engine.worldToScreen(tmp);
      const W = engine.canvas.clientWidth || window.innerWidth;
      const H = engine.canvas.clientHeight || window.innerHeight;
      const off = sp.behind || sp.x < -W * 0.2 || sp.x > W * 1.2 || sp.y < 0 || sp.y > H;
      el.style.display = off ? 'none' : '';
      // que no se salga de la pantalla (p. ej. el rollo cortado por el borde en el celular)
      const half = (el.offsetWidth || 80) / 2 + 8;
      el.style.left = `${Math.min(Math.max(sp.x, half), W - half)}px`;
      el.style.top = `${sp.y}px`;
    };
    const canvas = engine.canvas;
    ctx.track(() => (canvas.style.cursor = ''));

    let hovered = null;
    let moved = true;
    let down = null; // { x, y, t, onShirt, lastX }
    let pop = 0;
    let busy = false;

    const rollOf = (obj) => {
      while (obj) {
        const r = rolls.find((rr) => rr.group === obj);
        if (r) return r;
        obj = obj.parent;
      }
      return null;
    };
    const pickRoll = () => {
      const hits = engine.raycast(rolls.map((r) => r.group));
      return hits.length ? rollOf(hits[0].object) : null;
    };
    const onShirt = () => {
      const m = shirt.getPanelMeshes();
      return engine.raycast([m.frente, m.espalda].filter(Boolean), null, false).length > 0;
    };

    ctx.onPointer('move', (e, p) => {
      moved = true;
      if (down && down.onShirt) {
        const dx = p.x - down.lastX;
        down.lastX = p.x;
        userYaw += dx * 0.012;
        yawVel = dx * 0.012;
        if (Math.abs(p.x - down.x) > 4) down.dragged = true;
      } else if (down && Math.hypot(p.x - down.x, p.y - down.y) > 6) down.dragged = true;
    });
    ctx.onPointer('down', (e, p) => {
      if (busy) return;
      const sh = onShirt();
      down = { x: p.x, y: p.y, lastX: p.x, t: performance.now(), onShirt: sh, dragged: false };
      if (sh) canvas.style.cursor = 'grabbing';
    });
    ctx.onPointer('up', (e, p) => {
      if (!down) return;
      const d = down;
      down = null;
      canvas.style.cursor = hovered ? 'pointer' : '';
      if (busy || d.dragged) return;
      if (e.target !== canvas) return;
      const r = pickRoll();
      if (r) selectFabric(r.fabricId, { from: 'scene' });
      else if (closeup && !d.onShirt) toggleCloseup(false);
    });

    // teclado: ← → recorren las telas
    ctx.listen(window, 'keydown', (e) => {
      if (busy || e.defaultPrevented) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
      if (document.querySelector('.modal-wrap')) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = FABRICS.findIndex((f) => f.id === sel.id);
      const n = FABRICS.length;
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      selectFabric(FABRICS[j].id, { from: 'key' });
    });

    ctx.onUpdate((dt, t) => {
      // remera: vaivén suave ±35° + giro del usuario que vuelve solo
      if (!down || !down.onShirt) {
        phase += dt * 0.55;
        userYaw *= Math.exp(-dt * 0.7);
        userYaw += yawVel;
        yawVel *= Math.exp(-dt * 6);
      }
      pop = Math.max(0, pop - dt * 3.2);
      const s = 1 - 0.035 * Math.sin(pop * Math.PI);
      shirt.group.rotation.y = Math.sin(phase) * (closeup ? SWAY * 0.3 : SWAY) + userYaw;
      shirt.group.scale.set(s, s, s);

      // aplicar a la escena como mucho cada 70 ms (paleta personalizada = muchos eventos)
      if (dirty3D && t - lastApply > 0.07) {
        lastApply = t;
        apply3D();
        reskin();
      }

      // hover de rollos (un raycast por frame como máximo)
      if (moved && !busy) {
        moved = false;
        const r = engine.pointer.inside && !(down && down.onShirt) ? pickRoll() : null;
        if (r !== hovered) {
          hovered = r;
          if (!down) canvas.style.cursor = r ? 'pointer' : '';
          if (r) {
            const f = catalog.fabricById(r.fabricId);
            label.innerHTML = `${f.short} <span>· ${f.gsm} g/m²</span>`;
          }
        }
      }
      const selRoll = rolls.find((r) => r.fabricId === sel.id);
      if (hovered && hovered !== selRoll && !busy && !closeup) placeLabel(label, hovered.group, 0, 0.13);
      else label.style.display = 'none';
      if (selRoll && !closeup) {
        const f = catalog.fabricById(sel.id);
        const txt = `✓ ${f.short}`;
        if (selLabel.textContent !== txt) selLabel.textContent = txt;
        placeLabel(selLabel, selRoll.group, 0, 0.13);
      } else selLabel.style.display = 'none';
    });

    // ---------- de cerca: la trama y el brillo de la tela sobre el pecho ----------
    function closeView() {
      const yaw0 = shirt.group.rotation.y;
      shirt.group.rotation.y = 0;
      shirt.group.updateMatrixWorld(true);
      const { position, normal } = shirt.garmentToLocal('frente', 0.07, -0.2, 0);
      const wp = shirt.group.localToWorld(position.clone());
      const wn = normal.clone().transformDirection(shirt.group.matrixWorld);
      shirt.group.rotation.y = yaw0;
      const cam = wp.clone().addScaledVector(wn, isMobile() ? 0.62 : 0.36).add(new THREE.Vector3(0.08, 0.06, 0));
      return { position: cam.toArray(), target: wp.toArray() };
    }
    function toggleCloseup(force) {
      if (busy) return;
      closeup = force === undefined ? !closeup : !!force;
      zoomBtn.textContent = closeup ? '↩ Volver a la estantería' : '🔍 Mirar la trama de cerca';
      zoomBtn.classList.toggle('on', closeup);
      if (closeup) {
        userYaw = 0;
        yawVel = 0;
        ctx.flyTo(closeView(), 1.0);
        ui.hint('Así se ven la trama y el brillo de tu tela de cerca · cambiá de tela o de color para comparar');
        ctx.timeout(() => closeup && ui.hint(null), 6000);
      } else ctx.flyTo(mainView(), 1.0);
    }

    // ---------- confirmar ----------
    async function confirm(auto) {
      if (busy) return;
      if (auto) {
        const ch = defaultChoice(catalog, order);
        sel = { ...ch };
        refreshPanel();
        audio.play('select');
      }
      busy = true;
      ui.enableAction('ok', false);
      ui.enableAction('auto', false);
      ui.hint(null);
      hovered = null;
      label.style.display = 'none';
      canvas.style.cursor = '';
      apply3D();
      reskin();
      const f = catalog.fabricById(sel.id);
      const meters = COSTS.fabricMetersBase;
      ctx.addCost('Tela', Math.round(meters * f.pricePerMeter));
      const { score, notes } = scoreFabric(catalog, state, { auto });
      // micro-vuelo hacia el rollo elegido mientras "se corta" la tela
      const roll = rolls.find((r) => r.fabricId === sel.id);
      if (roll) {
        const p = roll.group.getWorldPosition(new THREE.Vector3());
        const back = isMobile() ? 2.6 : 1.55;
        ctx.flyTo({ position: [p.x + 0.55, p.y + 0.12, p.z + back], target: [p.x + 0.15, p.y - 0.08, p.z] }, 0.9);
      }
      audio.play('snip');
      ctx.timeout(() => audio.play('snip'), 160);
      ctx.timeout(() => audio.play('cut'), 330);
      const name = colorName(catalog, state.fabric);
      ui.toast(`✂️ ${f.short} · ${name}${state.fabric.heather ? ' jaspeado' : ''}: cortaste ~${String(meters).replace('.', ',')} m del rollo`, score >= 85 ? 'good' : score >= 60 ? 'info' : 'warn', 3600);
      if (order && score < 100) {
        const bad = notes.filter((n) => n.startsWith(NO)).length;
        if (bad) ui.toast(`📋 Ojo: no cumple ${bad === 1 ? 'un requisito' : 'requisitos'} del pedido de ${order.name}.`, 'bad', 4200);
      }
      await new Promise((r) => ctx.timeout(r, 1100));
      if (!ctx.alive) return;
      await ctx.complete({ score, notes, silent: true });
    }

    refreshPanel();
    apply3D();
    reskin();
  },
};
