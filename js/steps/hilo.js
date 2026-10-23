// Paso 2 · Hilo y aguja (tipo de hilo, color, grosor y aguja).
// Se elige en el panel o tocando los conos del rack; el cono elegido se adelanta y toma el
// color del hilo, las puntadas de la remera del maniquí cambian en vivo y se puede mirar
// el pespunte de cerca. Un retazo de prueba (tu tela + tu hilo + tu aguja) permite tirar
// de una costura antes de decidir: si el hilo no acompaña, las puntadas se cortan.

import { createRetazo, maxStretchOf } from './hilo/retazo.js';
import { fabricSwatch } from '../materials/fabric.js';
import { clamp, hexToRgb, mixHex, money } from '../core/utils.js';

const DEG = Math.PI / 180;
const OK = '<span class="hilo-mark ok">✓</span> ';
const NO = '<span class="hilo-mark no">✗</span> ';
const MID = '<span class="hilo-mark mid">≈</span> ';

// Puntas de aguja (de perfil): redondeada, levemente redondeada y afilada.
const needleSvg = (tip) =>
  `<svg viewBox="0 0 64 18" width="50" height="14" aria-hidden="true"><rect x="1" y="5.5" width="13" height="7" rx="2" fill="#c9a24a"/><rect x="3" y="6.5" width="9" height="1.6" rx="0.8" fill="#f2d88a"/><path d="M14 6 H44 ${tip} L44 12 H14 Z" fill="#c3cad2" stroke="#5f6872" stroke-width="0.9" stroke-linejoin="round"/><rect x="18" y="8.2" width="11" height="1.6" rx="0.8" fill="#5f6872"/><path d="M15 7.2 H43" stroke="#fff" stroke-width="0.8" opacity="0.7"/></svg>`;
const NEEDLE_SVG = {
  punta_bola: needleSvg('C 54 6, 58.5 7.6, 58.5 9 C 58.5 10.4, 54 12, 44 12'),
  universal: needleSvg('L 57.5 8.3 Q 60 9 57.5 9.7 L 44 12'),
  microtex: needleSvg('L 63 9 L 44 12'),
};

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

// Grosores aptos para un gramaje (puede haber dos: los rangos del catálogo se solapan).
export function thicknessesFor(catalog, gsm) {
  return catalog.THREAD_THICKNESS.filter((t) => gsm >= t.minGsm && gsm <= t.maxGsm).map((t) => t.id);
}

export function bestThickness(catalog, gsm) {
  const ok = thicknessesFor(catalog, gsm);
  if (ok.includes('medio')) return 'medio';
  return ok[0] || 'medio';
}

export function bestNeedle(fabric) {
  return fabric.knit ? 'punta_bola' : 'microtex';
}

export function needlePoints(fabric, needleId) {
  if (needleId === 'universal') return 15;
  return needleId === bestNeedle(fabric) ? 25 : 0;
}

// Diferencia perceptual aproximada entre dos colores (0 = iguales, ~1 = opuestos).
export function colorDistance(a, b) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const dr = A.r - B.r;
  const dg = A.g - B.g;
  const db = A.b - B.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / (255 * 3);
}

// Por qué un hilo no sirve para una tela (null si sirve).
export function threadProblem(fabric, thread) {
  if (thread.goodFor.includes(fabric.id)) return null;
  if (thread.id === 'rayon') return 'weak';
  if (thread.elastic < 0.3 && fabric.knit) return 'rigid';
  return 'wavy';
}

export function thicknessProblem(catalog, fabric, thicknessId) {
  const t = catalog.THREAD_THICKNESS.find((x) => x.id === thicknessId);
  if (!t) return null;
  if (fabric.gsm < t.minGsm) return 'thick';
  if (fabric.gsm > t.maxGsm) return 'thin';
  return null;
}

// Comportamiento del retazo de prueba según las elecciones (coherente con el puntaje).
export function seamBehavior(catalog, fabric, sel) {
  const thread = catalog.threadById(sel.id) || catalog.THREADS[0];
  const prob = threadProblem(fabric, thread);
  const thick = thicknessProblem(catalog, fabric, sel.thickness);
  let breakLimit = Infinity;
  if (prob === 'weak') breakLimit = 0.2;
  else if (prob === 'rigid') breakLimit = 0.36;
  if (thick === 'thin') breakLimit = Math.min(breakLimit, 0.62);
  let skips = 0;
  let holes = false;
  if (fabric.knit) {
    if (sel.needle === 'microtex') holes = true;
    else if (sel.needle === 'universal') skips = 2;
  } else if (sel.needle === 'punta_bola') skips = 5;
  else if (sel.needle === 'universal') skips = 1;
  return {
    fabricId: fabric.id,
    maxStretch: maxStretchOf(fabric),
    zigzag: !!fabric.knit,
    threadColor: sel.color,
    threadWidth: { fino: 1.1, medio: 1.6, grueso: 2.4 }[sel.thickness] || 1.6,
    breakLimit,
    skips,
    holes,
    pucker: thick === 'thick',
    wavy: prob === 'wavy',
    seed: catalog.THREADS.indexOf(thread) * 11 + (sel.needle?.length || 0) * 3 + 1,
  };
}

// Puntaje: tipo apto 40 + grosor en rango 25 + aguja 25/15/0 + color 10.
export function scoreThread(catalog, state, { auto = false } = {}) {
  const fabric = catalog.fabricById(state.fabric.id) || catalog.FABRICS[0];
  const t = state.thread;
  const thread = catalog.threadById(t.id) || catalog.THREADS[0];
  const notes = [];
  let score = 0;

  const prob = threadProblem(fabric, thread);
  if (!prob) {
    score += 40;
    const why = {
      poliester: 'resistente y con un poco de elasticidad: el comodín del taller',
      nylon: 'suave y muy elástico: acompaña el estiramiento del punto',
      algodon: 'natural y mate, firme para un tejido que casi no estira',
    }[thread.id];
    notes.push(`${OK} <b>${thread.name}</b> con ${fabric.short}: ${why || 'buena combinación'}.`);
  } else if (prob === 'weak') {
    notes.push(`${NO} El <b>rayón</b> es para bordar: brilla hermoso pero es poco resistente y una costura de armado se corta (−40).`);
  } else if (prob === 'rigid') {
    notes.push(`${NO} El hilo de <b>algodón</b> no estira: en ${fabric.short} (tejido de punto) las costuras se cortan al ponerte la remera (−40). Usá poliéster o nylon.`);
  } else {
    notes.push(`${NO} El <b>nylon texturizado</b> estira de más para ${fabric.short}: la costura queda ondulada y floja (−40). Brilla en el overlock de tejidos de punto finos.`);
  }

  const thick = thicknessProblem(catalog, fabric, t.thickness);
  const th = catalog.THREAD_THICKNESS.find((x) => x.id === t.thickness);
  if (!thick) {
    score += 25;
    notes.push(`${OK} Grosor ${th ? th.name : t.thickness} justo para una tela de ${fabric.gsm} g/m².`);
  } else if (thick === 'thick') {
    notes.push(`${NO} ${th.name} es grueso para ${fabric.gsm} g/m²: frunce la costura y deja agujeros marcados (−25). Regla: tela liviana, hilo fino.`);
  } else {
    notes.push(`${NO} ${th.name} es fino para ${fabric.gsm} g/m²: la costura queda débil para ese gramaje (−25). Regla: a más gramaje, hilo más grueso.`);
  }

  const np = needlePoints(fabric, t.needle);
  score += np;
  const needle = catalog.NEEDLES.find((n) => n.id === t.needle);
  if (np === 25) notes.push(fabric.knit ? OK + 'Aguja <b>punta bola</b>: separa las mallas del punto sin cortarlas.' : OK + 'Aguja <b>microtex</b>: perfora limpio el tejido plano y la puntada sale prolija.');
  else if (np === 15) notes.push(`${MID} La aguja <b>universal</b> sirve, pero ${fabric.knit ? 'en tejido de punto saltea puntadas: la punta bola es la indicada' : 'en un plano fino la microtex da una puntada más prolija'} (−10).`);
  else notes.push(fabric.knit ? `${NO} Aguja <b>${needle?.name || t.needle}</b> en tejido de punto: corta las mallas y aparecen agujeritos y carreras (−25).` : NO + 'Aguja <b>punta bola</b> en tejido plano: no perfora limpio y saltea puntadas (−25).');

  // color: al tono o contraste a propósito valen igual; "casi igual" parece un error
  const dist = colorDistance(t.color, state.fabric.color);
  if (t.match || dist < 0.004) {
    score += 10;
    notes.push(OK + 'Hilo al tono: la costura se funde con la tela (lo más versátil).');
  } else if (dist < 0.12) {
    score += 5;
    notes.push(MID + 'El hilo es <b>casi</b> del color de la tela, pero no igual: no se lee como contraste y parece un error de tono (−5).');
  } else {
    score += 10;
    notes.push(OK + 'Pespunte en contraste: la costura pasa a ser un detalle de diseño… y se ve todo, así que ¡prolijidad!');
  }

  if (auto) {
    score = Math.min(score, 72);
    notes.unshift(MID + 'Elegido en automático: el taller cargó lo de siempre. Probá vos la próxima y sumá más puntos.');
  }
  return { score: clamp(score, 0, 100), notes };
}

function defaultsFor(catalog, state) {
  const fabric = catalog.fabricById(state.fabric.id) || catalog.FABRICS[0];
  return {
    id: 'poliester',
    color: state.fabric.color,
    colorId: state.fabric.colorId || null,
    match: true,
    thickness: bestThickness(catalog, fabric.gsm),
    needle: bestNeedle(fabric),
  };
}

function bar(v) {
  return `<span class="hilo-bar"><i style="width:${Math.round(clamp(v) * 100)}%"></i></span>`;
}

// ---------------------------------------------------------------------------

export default {
  id: 'hilo',
  title: 'Hilo y aguja',
  short: 'Hilo',
  icon: '🧵',
  scored: true,
  help: `<p>Elegí el <b>tipo de hilo</b>, su <b>color</b>, el <b>grosor</b> y la <b>aguja</b> para coser tu tela.</p>
<ul>
<li>Pensá en tu tela: ¿es de punto (estira) o plana? ¿liviana o pesada? Está resumida arriba del panel.</li>
<li>En el <b>retazo de prueba</b> arrastrá la pinza roja hacia la derecha (o tocá “Tirar”): si el hilo no acompaña, las puntadas se cortan; si la aguja no es la indicada, vas a ver agujeritos o puntadas salteadas.</li>
<li>Podés tocar los conos del rack para elegir el hilo y usar “Ver la costura de cerca” para mirar el pespunte en la remera.</li>
<li>Hilo al tono o en contraste: los dos valen, es una decisión de estilo.</li>
</ul>`,

  defaults(state, ctx) {
    const catalog = ctx.catalog;
    const d = defaultsFor(catalog, state);
    state.thread = { ...d };
    ctx.addCost?.('Hilo', catalog.threadById(d.id).price);
    const p = ctx.world?.props;
    p?.sewingMachine?.setThreadColor?.(d.color);
    p?.overlock?.setThreadColor?.(d.color);
    ctx.shirt?.setThreadColor?.(d.color);
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, THREE, audio } = ctx;
    const { THREADS, THREAD_THICKNESS, NEEDLES, FABRIC_COLORS } = catalog;
    const fabric = catalog.fabricById(state.fabric.id) || catalog.FABRICS[0];
    const rack = world.props.threadRack;
    const spools = rack?.spools || [];
    const props = world.props;

    // Estado original de los conos (se restaura al salir).
    const originals = new Map(spools.map((s) => [s, s.color]));
    ctx.track(() => {
      for (const [s, c] of originals) {
        s.setColor(c);
        s.setHighlight(false);
      }
    });
    // El rollo de la tela elegida queda a la vista con su color (continuidad con el paso anterior).
    const roll = props.shelf?.rolls?.find((r) => r.fabricId === fabric.id);
    if (roll) {
      const c0 = roll.color;
      roll.setColor(state.fabric.color);
      ctx.track(() => roll.setColor(c0));
    }
    ctx.track(() => ui.panelEl?.classList.remove('hilo-step'));

    // Selección inicial: si este paso ya se jugó, lo elegido; si no, el tipo de hilo y el
    // grosor arrancan sin elegir (hay que pensarlos) y la máquina trae la aguja universal
    // de fábrica. El color arranca al tono.
    const d0 = defaultsFor(catalog, state);
    const played = !!state.scores?.hilo && state.scores.hilo.notes?.[0] !== '(paso salteado)';
    let sel = played ? { ...d0, ...state.thread } : { ...d0, ...state.thread, id: null, thickness: null, needle: 'universal' };
    if (sel.id && !catalog.threadById(sel.id)) sel.id = null;
    if (sel.thickness && !THREAD_THICKNESS.some((t) => t.id === sel.thickness)) sel.thickness = null;
    if (!NEEDLES.some((n) => n.id === sel.needle)) sel.needle = 'universal';
    if (sel.match !== false) {
      sel.match = true;
      sel.color = state.fabric.color;
      sel.colorId = state.fabric.colorId || null;
    }
    let lastContrast = sel.match ? null : sel.color;

    // ---------- escena ----------
    ctx.updateShirt(); // la remera con la tela del paso anterior (por si se llegó con ?step=)
    ctx.placeShirt('preview');
    const shirt = ctx.shirt;
    ctx.track(() => shirt.group.rotation.set(0, 0, 0));
    // vista del rack de carreteles con la remera del maniquí debajo (más lejos en el celular,
    // donde la escena libre es solo la franja de arriba del panel)
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const mainView = () => (isMobile() ? { position: [-4.1, 1.56, 1.75], target: [-4.1, 1.43, -2.6] } : { position: [-4.1, 1.6, 0.2], target: [-4.1, 1.47, -2.6] });
    ctx.flyTo(mainView(), 1.3);
    let layoutMobile = isMobile();
    ctx.listen(window, 'resize', () => {
      if (isMobile() === layoutMobile || busy) return;
      layoutMobile = isMobile();
      ctx.flyTo(closeup ? closeView() : mainView(), 0.8);
    });
    let closeup = false;
    let yaw = 0;
    let phase = 0;

    // ---------- panel ----------
    const fabChip = h(
      'div',
      { class: 'hilo-fabric' },
      h('span', { class: 'hilo-fabric-sw', style: { backgroundImage: `url(${fabricSwatch(fabric.id, state.fabric.color, 96, { heather: !!state.fabric.heather })})` } }),
      h(
        'span',
        { class: 'hilo-fabric-text' },
        h('b', {}, `Tu tela: ${fabric.short}`),
        h('span', {}, `${fabric.gsm} g/m² · ${fabric.knit ? 'de punto: estira' : 'plana: no estira'} · ${fabric.composition}`),
      ),
    );

    // retazo de prueba
    const retazo = createRetazo({ h, listen: ctx.listen, height: 118, seam: true, idleText: 'tirá →' });
    ctx.onUpdate((dt) => retazo.update(dt));
    retazo.onResult((res) => showVerdict(res));
    const testBox = h(
      'div',
      { class: 'hilo-test' },
      h('div', { class: 'hilo-test-head' }, h('b', {}, '🧪 Prueba en un retazo'), h('span', {}, fabric.knit ? 'puntada zigzag (punto)' : 'puntada recta (plano)')),
      retazo.el,
    );

    // 1 · tipo de hilo
    const threadCards = new Map();
    const threadGrid = h('div', { class: 'hilo-threads', role: 'listbox', 'aria-label': 'Tipo de hilo' });
    for (const t of THREADS) {
      const spool = h('span', { class: 'hilo-spool', style: { '--sheen': String(0.15 + t.sheen * 0.55) } }, h('span', { class: 'hilo-spool-thread' }));
      const card = h(
        'button',
        { class: 'hilo-card', type: 'button', role: 'option', dataset: { id: t.id }, onClick: () => selectThread(t.id, 'panel') },
        spool,
        h(
          'span',
          { class: 'hilo-card-text' },
          h('span', { class: 'hilo-card-name' }, t.name),
          h('span', { class: 'hilo-card-bars', html: `<span>Resistencia</span>${bar(t.strength)}<span>Elasticidad</span>${bar(t.elastic)}<span>Brillo</span>${bar(t.sheen)}` }),
          h('span', { class: 'hilo-card-price' }, `${money(t.price)} el cono`),
        ),
      );
      threadCards.set(t.id, { card, spool });
      threadGrid.appendChild(card);
    }
    const threadDesc = h('div', { class: 'hilo-desc' });

    // 2 · color
    const matchToggle = ui.toggle({ label: 'Igual a la tela (al tono)', value: sel.match, onChange: (v) => selectMatch(v) });
    const palette = ui.colorPalette({
      colors: FABRIC_COLORS,
      value: sel.color,
      allowCustom: true,
      onChange: (hex, c) => selectColor(hex, c ? c.id : null),
    });
    palette.classList.add('hilo-palette');
    const paletteWrap = h('div', { class: 'hilo-palette-wrap' }, h('p', { class: 'hilo-small' }, 'Pespunte en contraste: elegí un color que se distinga de la tela.'), palette);
    const zoomBtn = h('button', { class: 'btn btn-secondary btn-sm hilo-zoom', type: 'button', onClick: () => toggleCloseup() }, '🔍 Ver la costura de cerca');

    // 3 · grosor
    const thickGrid = ui.optionGrid({
      options: THREAD_THICKNESS.map((t) => {
        const [nm, tex] = t.name.split(' (');
        const range = t.minGsm <= 0 ? `hasta ${t.maxGsm} g/m²` : t.maxGsm >= 999 ? `desde ${t.minGsm} g/m²` : `${t.minGsm}–${t.maxGsm} g/m²`;
        return { id: t.id, label: `${nm}`, sub: `${tex ? tex.replace(')', '') + ' · ' : ''}${range}` };
      }),
      value: sel.thickness,
      columns: 3,
      onChange: (id) => {
        sel.thickness = id;
        changed();
      },
    });
    thickGrid.classList.add('hilo-thick');
    // muestra del grosor: un trazo de hilo de 1, 2 o 3 px
    for (const b of thickGrid.querySelectorAll('.option')) {
      const w = { fino: 1.2, medio: 2.2, grueso: 3.4 }[b.dataset.id] || 2;
      b.appendChild(h('span', { class: 'hilo-thick-line', style: { height: `${w}px` } }));
    }

    // 4 · aguja
    const needleGrid = ui.optionGrid({
      options: NEEDLES.map((n) => ({ id: n.id, label: n.name, sub: n.desc, icon: '🪡' })),
      value: sel.needle,
      columns: 1,
      onChange: (id) => {
        sel.needle = id;
        changed();
      },
    });
    needleGrid.classList.add('hilo-needles');
    // ícono con la forma de la punta de cada aguja
    for (const b of needleGrid.querySelectorAll('.option')) {
      const ic = b.querySelector('.option-icon');
      if (ic) ic.innerHTML = NEEDLE_SVG[b.dataset.id] || NEEDLE_SVG.universal;
    }

    const body = h(
      'div',
      { class: 'hilo-panel' },
      fabChip,
      testBox,
      ui.section('1 · Tipo de hilo', threadGrid, threadDesc),
      ui.section('2 · Color del hilo', matchToggle, paletteWrap, zoomBtn),
      ui.section('3 · Grosor', thickGrid),
      ui.section('4 · Aguja', h('p', { class: 'hilo-small' }, 'La máquina trae puesta la universal de fábrica. ¿Es la indicada para tu tela?'), needleGrid),
    );

    ui.panel({
      kicker: 'Paso 2 · Depósito de materiales',
      title: 'Hilo y aguja',
      subtitle: `Elegí con qué vas a coser tu ${fabric.short.toLowerCase()}. Antes de decidir, probá la costura en un retazo.`,
      body,
      actions: [
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => confirm(true) },
        { id: 'ok', label: 'Coser con esto →', kind: 'primary', onClick: () => confirm(false) },
      ],
    });
    ui.panelEl?.classList.add('hilo-step');
    ui.hint(isMobile() ? 'Arrastrá la pinza roja del retazo para probar la costura · tocá un cono del rack para elegir el hilo' : 'Arrastrá la pinza roja del retazo (o <kbd>Espacio</kbd>) para probar la costura · tocá un cono del rack o usá <kbd>←</kbd> <kbd>→</kbd> para cambiar de hilo');
    ctx.timeout(() => ui.hint(null), 9000);

    // ---------- veredicto del retazo ----------
    function showVerdict({ maxF, broken }) {
      const t = catalog.threadById(sel.id);
      const prob = threadProblem(fabric, t);
      const thick = thicknessProblem(catalog, fabric, sel.thickness);
      const items = [];
      const typeBreak = prob === 'weak' || prob === 'rigid';
      // 1) el hilo
      if (typeBreak) {
        if (broken > 0) items.push(['bad', `Se cortaron <b>${broken}</b> puntada${broken === 1 ? '' : 's'}: ${prob === 'weak' ? 'el rayón es lindo pero débil, no sirve para armar' : 'el algodón no estira y el punto sí'}.`]);
        else items.push(['warn', 'Tiraste poquito: estirala hasta el fondo para probar de verdad.']);
      } else if (prob === 'wavy') items.push(['bad', 'La costura quedó <b>ondulada</b>: el nylon estira más que esta tela y la frunce.']);
      else if (maxF < 0.7 && broken === 0) items.push(['warn', 'Tiraste poquito: estirala hasta el fondo para probar de verdad.']);
      else if (broken === 0) items.push(['ok', fabric.knit ? 'La costura acompañó el estiramiento <b>sin cortarse</b>.' : 'La costura aguantó firme el tirón.']);
      // 2) la aguja
      if (fabric.knit) {
        if (sel.needle === 'microtex') items.push(['bad', 'Aparecieron <b>agujeritos y carreras</b>: la aguja afilada corta las mallas del punto.']);
        else if (sel.needle === 'universal') items.push(['warn', 'Hay <b>puntadas salteadas</b>: la universal a veces no engancha en el punto.']);
        else items.push(['ok', 'Puntadas parejas: la punta bola separa las mallas sin romperlas.']);
      } else if (sel.needle === 'punta_bola') items.push(['bad', 'Muchas <b>puntadas salteadas</b>: la punta bola no perfora limpio el tejido plano.']);
      else if (sel.needle === 'universal') items.push(['warn', 'Una puntada salteada: anda, pero la microtex es más prolija.']);
      else items.push(['ok', 'Puntadas parejas: la microtex perfora limpio.']);
      // 3) el grosor
      if (!sel.thickness) items.push(['warn', 'Todavía no elegiste el <b>grosor</b> del hilo.']);
      else if (thick === 'thick') items.push(['warn', 'La costura <b>frunce</b>: hilo grueso para una tela tan liviana.']);
      else if (thick === 'thin') {
        if (broken > 0 && !typeBreak) items.push(['bad', `Se cortaron <b>${broken}</b> puntada${broken === 1 ? '' : 's'}: hilo muy fino para una tela de ${fabric.gsm} g/m².`]);
        else items.push(['warn', `Hilo <b>fino</b> para ${fabric.gsm} g/m²: la costura queda débil.`]);
      } else items.push(['ok', 'El grosor del hilo está en proporción con la tela.']);
      const icon = { ok: '✓', warn: '!', bad: '✗' };
      retazo.setVerdict(h('ul', { class: 'hilo-verdict' }, ...items.map(([k, html]) => h('li', { class: k }, h('i', {}, icon[k]), h('span', { html })))));
      const worst = items.some((i) => i[0] === 'bad') ? 'bad' : items.some((i) => i[0] === 'warn') ? 'warn' : 'ok';
      audio.play(worst === 'ok' ? 'good' : worst === 'bad' ? 'bad' : 'pop');
      tested = true;
    }

    // ---------- aplicar ----------
    let dirty = true;
    let lastApply = -1;
    let tested = false;
    let busy = false;

    function refresh() {
      const t = sel.id ? catalog.threadById(sel.id) : null;
      for (const [id, { card, spool }] of threadCards) {
        card.classList.toggle('selected', id === sel.id);
        card.setAttribute('aria-selected', id === sel.id ? 'true' : 'false');
        spool.style.setProperty('--thread', sel.color);
        spool.style.setProperty('--thread-dark', mixHex(sel.color, '#000000', 0.35));
      }
      threadDesc.innerHTML = t ? `<b>${t.name}.</b> ${t.desc}` : 'Elegí uno de los cuatro (o tocá un cono del rack). Pensá: ¿tu tela estira? ¿la costura tiene que aguantar?';
      threadDesc.classList.toggle('empty', !t);
      matchToggle.input.checked = !!sel.match;
      paletteWrap.classList.toggle('hidden', !!sel.match);
      palette.setValue(sel.color);
      thickGrid.setValue(sel.thickness);
      needleGrid.setValue(sel.needle);
      retazo.setConfig({ ...seamBehavior(catalog, fabric, sel), noThread: !sel.id, color: state.fabric.color, heather: !!state.fabric.heather });
      dirty = true;
    }

    function apply3D() {
      state.thread = { ...state.thread, id: sel.id || state.thread.id, color: sel.color, colorId: sel.colorId || null, match: !!sel.match, thickness: sel.thickness || state.thread.thickness, needle: sel.needle };
      if (sel.id) ctx.addCost('Hilo', catalog.threadById(sel.id).price);
      // (el segundo argumento, el tipo de hilo, lo ignoran las versiones que no lo usan)
      const tid = sel.id || state.thread.id;
      shirt.setThreadColor(sel.color, tid);
      props.sewingMachine?.setThreadColor?.(sel.color, tid);
      props.overlock?.setThreadColor?.(sel.color, tid);
      for (const s of spools) {
        if (sel.id && s.threadId === sel.id) {
          if (s.color !== sel.color) s.setColor(sel.color);
          if (!s.highlighted) s.setHighlight(true);
        } else {
          const c0 = originals.get(s);
          if (s.color !== c0) s.setColor(c0);
          if (s.highlighted) s.setHighlight(false);
        }
      }
      dirty = false;
    }

    function changed() {
      if (busy) return;
      refresh();
    }

    function selectThread(id, from) {
      if (busy || !catalog.threadById(id)) return;
      if (id !== sel.id) {
        sel.id = id;
        if (from !== 'panel') audio.play('select');
        else audio.play('pop');
      }
      refresh();
      if (from !== 'panel') threadCards.get(id)?.card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function selectMatch(v) {
      if (busy) return;
      sel.match = !!v;
      if (sel.match) {
        sel.color = state.fabric.color;
        sel.colorId = state.fabric.colorId || null;
      } else {
        // un contraste razonable para arrancar: el último elegido o uno que se note
        const fl = catalog.luminance(state.fabric.color);
        const pick = lastContrast || (fl > 0.5 ? '#1f2a46' : '#cf9a2c');
        sel.color = pick;
        sel.colorId = FABRIC_COLORS.find((c) => c.hex === pick)?.id || null;
      }
      audio.play('select');
      refresh();
    }

    function selectColor(hex, colorId) {
      if (busy) return;
      sel.match = false;
      sel.color = hex;
      sel.colorId = colorId;
      lastContrast = hex;
      refresh();
    }

    // ---------- teclado: ← → cambian de hilo, Espacio tira del retazo ----------
    ctx.listen(window, 'keydown', (e) => {
      if (busy || e.defaultPrevented || e.repeat) return;
      const tg = e.target && e.target.closest ? e.target : null;
      if (tg && tg.closest('input, textarea, select')) return;
      if (document.querySelector('.modal-wrap')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = THREADS.findIndex((t) => t.id === sel.id);
        const n = THREADS.length;
        const j = i < 0 ? (e.key === 'ArrowRight' ? 0 : n - 1) : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
        selectThread(THREADS[j].id, 'key');
      } else if ((e.code === 'Space' || e.key === ' ') && !(tg && tg.closest('button'))) {
        e.preventDefault();
        retazo.pull();
      }
    });

    // ---------- vista de cerca del pespunte ----------
    function closeView() {
      const pat = shirt.pattern;
      const m = pat?.measurements || { chest: 52, length: 72 };
      const x = (m.chest / 200) * 0.55;
      const y = -m.length / 100 + 0.035;
      shirt.group.rotation.y = 0;
      shirt.group.updateMatrixWorld(true);
      const { position, normal } = shirt.garmentToLocal('frente', x, y, 0);
      const wp = shirt.group.localToWorld(position.clone());
      const wn = normal.clone().transformDirection(shirt.group.matrixWorld);
      const dist = isMobile() ? 0.7 : 0.42;
      const cam = wp.clone().addScaledVector(wn, dist).add(new THREE.Vector3(0.06, 0.12, 0));
      return { position: cam.toArray(), target: wp.clone().add(new THREE.Vector3(0, 0.02, 0)).toArray() };
    }
    function toggleCloseup(force) {
      closeup = force === undefined ? !closeup : !!force;
      zoomBtn.textContent = closeup ? '↩ Volver al rack' : '🔍 Ver la costura de cerca';
      zoomBtn.classList.toggle('on', closeup);
      if (closeup) {
        yaw = 0;
        ctx.flyTo(closeView(), 1.0);
        ui.hint('Este es el pespunte del ruedo: así se va a ver tu hilo sobre la tela');
        ctx.timeout(() => closeup && ui.hint(null), 5000);
      } else ctx.flyTo(mainView(), 1.0);
    }

    // ---------- interacción 3D: conos del rack ----------
    const tmp = new THREE.Vector3();
    const label = h('div', { class: 'world-label hilo-cone-label' });
    const selLabel = h('div', { class: 'world-label hilo-sel-label' });
    label.style.display = 'none';
    selLabel.style.display = 'none';
    document.getElementById('app').append(label, selLabel);
    ctx.track(() => {
      label.remove();
      selLabel.remove();
    });
    const placeLabel = (el, obj, dy) => {
      obj.getWorldPosition(tmp);
      tmp.y += dy;
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
    let down = null;
    const spoolOf = (obj) => {
      while (obj) {
        const s = spools.find((sp) => sp.group === obj);
        if (s) return s;
        obj = obj.parent;
      }
      return null;
    };
    const pick = () => {
      const hits = engine.raycast(spools.map((s) => s.group));
      return hits.length ? spoolOf(hits[0].object) : null;
    };
    ctx.onPointer('move', (e, p) => {
      moved = true;
      if (down && Math.hypot(p.x - down.x, p.y - down.y) > 6) down.dragged = true;
    });
    ctx.onPointer('down', (e, p) => {
      down = { x: p.x, y: p.y, dragged: false };
    });
    ctx.onPointer('up', (e) => {
      const d = down;
      down = null;
      if (!d || d.dragged || busy || e.target !== canvas) return;
      const s = pick();
      if (s) {
        if (closeup) toggleCloseup(false);
        selectThread(s.threadId, 'scene');
      }
    });

    ctx.onUpdate((dt, t) => {
      // remera: vaivén muy suave (quieta cuando se mira de cerca)
      if (!closeup) {
        phase += dt * 0.45;
        yaw = Math.sin(phase) * 14 * DEG;
      }
      shirt.group.rotation.y = yaw;
      if (dirty && t - lastApply > 0.06) {
        lastApply = t;
        apply3D();
      }
      if (moved && !busy) {
        moved = false;
        const s = engine.pointer.inside ? pick() : null;
        if (s !== hovered) {
          hovered = s;
          canvas.style.cursor = s ? 'pointer' : '';
          if (s) {
            const th = catalog.threadById(s.threadId);
            label.innerHTML = `${th.name} <span>· ${money(th.price)}</span>`;
          }
        }
      }
      const selSpool = sel.id ? spools.find((sp) => sp.threadId === sel.id) : null;
      if (hovered && hovered !== selSpool && !busy && !closeup) placeLabel(label, hovered.group, 0.11);
      else label.style.display = 'none';
      if (selSpool && !closeup) {
        const txt = `✓ ${catalog.threadById(sel.id).name}`;
        if (selLabel.textContent !== txt) selLabel.textContent = txt;
        placeLabel(selLabel, selSpool.group, 0.11);
      } else selLabel.style.display = 'none';
    });

    // ---------- confirmar ----------
    async function confirm(auto) {
      if (busy) return;
      if (auto) {
        sel = { ...defaultsFor(catalog, state) };
        refresh();
      } else if (!sel.id || !sel.thickness) {
        const miss = !sel.id && !sel.thickness ? 'el tipo de hilo y el grosor' : !sel.id ? 'el tipo de hilo' : 'el grosor del hilo';
        ui.toast(`🧵 Te falta elegir ${miss}.`, 'warn', 2800);
        audio.play('bad');
        const target = !sel.id ? threadGrid : thickGrid;
        target.classList.remove('hilo-missing');
        void target.offsetWidth;
        target.classList.add('hilo-missing');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      busy = true;
      ui.enableAction('ok', false);
      ui.enableAction('auto', false);
      ui.hint(null);
      hovered = null;
      label.style.display = 'none';
      canvas.style.cursor = '';
      apply3D();
      const thread = catalog.threadById(sel.id);
      ctx.addCost('Hilo', thread.price);
      const { score, notes } = scoreThread(catalog, state, { auto });
      if (tested && !auto) notes.push('Probaste la costura en un retazo antes de coser: así trabajan los que saben.');
      audio.play('pop');
      await new Promise((r) => ctx.timeout(r, 450));
      if (!ctx.alive) return;
      const th = THREAD_THICKNESS.find((x) => x.id === sel.thickness);
      const nd = NEEDLES.find((x) => x.id === sel.needle);
      const extra = h(
        'div',
        { class: 'hilo-result' },
        h('span', { class: 'hilo-spool', style: { '--thread': sel.color, '--thread-dark': mixHex(sel.color, '#000000', 0.35), '--sheen': String(0.15 + thread.sheen * 0.55) } }, h('span', { class: 'hilo-spool-thread' })),
        h('span', {}, h('b', {}, thread.name), h('br'), `${th ? th.name : sel.thickness} · aguja ${nd ? nd.name.replace(/\s*\(.*\)/, '').toLowerCase() : sel.needle} · ${sel.match ? 'al tono' : 'en contraste'}`),
      );
      await ctx.complete({ score, notes, extra });
    }

    refresh();
    apply3D();
  },
};
