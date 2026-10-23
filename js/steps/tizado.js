// Paso 5 · Tizado de moldes.
// La tela extendida sobre la mesa de corte (fabricOrigin) y los moldes de papel madera en una
// bandeja del panel. Se arrastran a la tela, se giran para que la flecha de hilo quede paralela al
// orillo y se encastran para gastar la menor cantidad de tela posible. Con "Tizar", la tiza de
// sastre recorre el contorno de cada molde dejando la línea que después sigue el corte.

import * as catalog from '../data/catalog.js';
import { clamp, money, easeInOutCubic, resamplePolyline, distToSegment } from '../core/utils.js';
import { FABRIC_WIDTH, FABRIC_MAX_LENGTH, PIECE_GAP, fabricOrigin, worldToFabric, placedOutline, isGrainOk, evaluateLayout, bounds } from './shared/fabricLayout.js';
import { analyze, settle, safeAutoLayout, referenceLayout, firstFit, occupancyFrom, normRot, SELVEDGE } from './tizado/raster.js';
import { createPaperPiece } from './tizado/paper.js';
import { createTableScene } from './tizado/table.js';
import { fitView, screenInsets } from './tizado/view.js';
import { pieceThumb, layoutMap } from './tizado/svg.js';

const { COSTS, fabricById, fitById, sleeveById } = catalog;
const L = FABRIC_MAX_LENGTH;
const W = FABRIC_WIDTH;
const HALF_PI = Math.PI / 2;
const mTxt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
const cmTxt = (v) => String(Math.round(v * 100));
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const CHALK_TILT = -1.05;

// ---------------------------------------------------------------------------
// Reglas (exportadas para pruebas)
// ---------------------------------------------------------------------------

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// Largo de tela a comprar (al milímetro, igual que el que queda guardado en state.layout)
export function fabricLengthOf(usedLength) {
  return Math.round(Math.min(L, usedLength + PIECE_GAP) * 1000) / 1000;
}

// Rango de aprovechamiento del molde (0,45 … 0,8 si el molde permite llegar a 0,8; si la mejor
// distribución conocida no llega, se achica en proporción). Lo usan la nota del acomodo
// automático (65–75) y la meta del HUD; el acomodo a mano se puntúa con efficiencyPoints.
export function efficiencyScale(refEff) {
  const hi = clamp(refEff || 0.8, 0.42, 0.8);
  return { lo: hi * 0.5625, hi };
}

// Puntos por aprovechamiento según qué tan cerca se queda de la mejor distribución conocida
// (r = eficiencia / referencia). Con referencia 0,8 equivale a la regla 0,45 → ~40 … 0,8 → 100,
// pero más exigente arriba: cada centímetro de tela de más se nota.
const EFF_CURVE = [
  [0, 0],
  [0.6, 40],
  [0.85, 72],
  [0.95, 88],
  [0.995, 100],
];
export function efficiencyPoints(eff, refEff) {
  const r = eff / Math.max(0.3, refEff || 0.75);
  if (r >= EFF_CURVE[EFF_CURVE.length - 1][0]) return 100;
  for (let i = 1; i < EFF_CURVE.length; i++) {
    const [r1, p1] = EFF_CURVE[i];
    if (r <= r1) {
      const [r0, p0] = EFF_CURVE[i - 1];
      return p0 + ((p1 - p0) * (r - r0)) / (r1 - r0);
    }
  }
  return 100;
}

export function scoreLayout(res, ctxInfo) {
  const { efficiency, fabricLength, grainWrong = [], selvedge = [] } = res;
  const { ref, autoRef, usedAuto = false, auto = false, fabric, state, pattern, pieceName } = ctxInfo;
  const notes = [];
  const refEff = ref?.efficiency || 0.75;
  const { lo, hi } = efficiencyScale(refEff);
  let score;
  const pct = (v) => Math.round(v * 100);
  if (auto) {
    score = 65 + 10 * clamp((efficiency - lo) / (hi - lo));
    const canBeat = autoRef && pct(refEff) > pct(autoRef.efficiency);
    notes.push(
      `🤖 Acomodo automático: aprovechó el <b>${pctTxt(efficiency)}</b> de la tela. ${canBeat ? `Acomodando a mano se puede encastrar mejor (la mejor distribución que conocemos llega al ${pctTxt(refEff)}).` : 'Para este molde casi no queda margen, pero el oficio está en mirar cada hueco con tus propios ojos.'}`,
    );
  } else {
    score = efficiencyPoints(efficiency, refEff);
    const best = pct(efficiency) >= pct(refEff);
    notes.push(`🧩 Aprovechaste el <b>${pctTxt(efficiency)}</b> de la tela${best ? '. ¡Igual o mejor que la mejor distribución que conocemos!' : ` (la mejor que conocemos llega al ${pctTxt(refEff)}).`}`);
  }
  const price = fabric.pricePerMeter;
  notes.push(`📏 Usaste <b>${mTxt(fabricLength)} m</b> de ${fabric.short} (${Math.round(W * 100)} cm de ancho): <b>${money(Math.round(fabricLength * price))}</b>.`);
  // tela ahorrada frente al acomodo por columnas
  if (!auto && autoRef) {
    const saved = autoRef.fabricLength - fabricLength;
    if (saved > 0.005) {
      const bonus = Math.min(5, (saved / 0.1) * 5);
      score += bonus;
      notes.push(`✂️ Le ganaste al acomodo por columnas: ahorraste <b>${cmTxt(saved)} cm</b> de tela (${money(Math.round(saved * price))})${Math.round(bonus) >= 1 ? ` (+${Math.round(bonus)})` : ''}.`);
    } else if (saved < -0.015) {
      const body = pattern.pieces.find((p) => p.id === 'frente');
      const stack = body && 2 * body.width + 3 * PIECE_GAP <= W;
      notes.push(
        `📐 El acomodo por columnas usa ${mTxt(autoRef.fabricLength)} m: gastaste <b>${cmTxt(-saved)} cm de más</b> (${money(Math.round(-saved * price))}). ${stack ? 'Frente y espalda contra los orillos, una al lado de la otra a lo ancho' : 'Frente y espalda pegadas, una detrás de la otra'}, y las piezas chicas en los huecos de escote y sisa.`,
      );
    }
  }
  // acomodo automático sin mejorar: vale como el botón "Hacerlo automático"
  const untouchedAuto = !auto && usedAuto && autoRef && efficiency <= autoRef.efficiency + 0.005;
  if (untouchedAuto) {
    score = Math.min(score, 65 + 10 * clamp((efficiency - lo) / (hi - lo)));
    notes.push('🤖 Tizaste el acomodo automático tal cual, sin mejorarlo (nota de acomodo automático). Probá correr las piezas contra el borde de la tela y meter las chicas en los huecos que dejan el escote y las sisas.');
  }
  // hilo
  if (grainWrong.length) {
    const forced = !!ref?.grainForced;
    const per = forced ? 5 : 15;
    score -= per * grainWrong.length;
    const names = grainWrong.map(pieceName).join(', ');
    notes.push(
      `🧭 <b>${grainWrong.length === 1 ? 'Una pieza' : `${grainWrong.length} piezas`} con el hilo cruzado</b>: ${names} (−${per * grainWrong.length}). ${
        fabric.knit ? 'En el tejido de punto la pieza estira para el lado equivocado: la remera se deforma y se "revira" (se tuerce la costura del costado) después del lavado.' : 'En tejido plano, fuera del hilo la pieza se estira y cae torcida.'
      }${forced ? ' Con este molde no entraba de otra forma en tela de 1,20 m: para un talle así conviene comprar tela más ancha.' : ''}`,
    );
  } else notes.push('🧭 Todas las piezas con el <b>hilo derecho</b>: la flecha paralela al orillo. Así la remera cae recta y no se tuerce al lavarla.');
  if (selvedge.length) {
    const forced = !!ctxInfo.selvedgeForced;
    const pen = forced ? 0 : Math.min(9, 3 * selvedge.length);
    score -= pen;
    notes.push(
      `🧵 ${selvedge.map(pieceName).join(', ')} ${selvedge.length === 1 ? 'pisa' : 'pisan'} el orillo${pen ? ` (−${pen})` : ''}: es más tupido, encoge distinto y tiene los agujeritos de la rama. ${forced ? 'Con este talle no entra de otra forma en 1,20 m de ancho: para moldes tan grandes conviene tela más ancha.' : 'Dejá 1–2 cm libres.'}`,
    );
  }
  // consejos de oficio
  const hasRibb = pattern.pieces.some((p) => p.id === 'cuello');
  if (hasRibb) notes.push('💡 El cuello de ribb va con su largo <b>atravesado</b> al hilo: así estira para pasar la cabeza y abraza el escote.');
  if (state.prewash?.skipped) notes.push(`💡 No prelavaste: la tela puede encoger hasta un ${Math.round((fabric.shrink || 0.04) * 100)}%. Algunos sastres tizan con un margen extra para compensar.`);
  else if (!fabric.knit) notes.push('💡 En tejido plano el hilo es la urdimbre, que corre paralela al orillo: tizá siempre con la flecha alineada.');
  return { score: Math.round(clamp(score, 0, 100)), notes };
}

// Se guarda redondeado al milímetro, salvo que el redondeo haga que dos moldes pegados se pisen
// (corte vuelve a validar la distribución y, si no pasa, la reemplazaría por la automática).
function storablePlacements(pattern, placements) {
  const valid = (pls) => {
    const ev = evaluateLayout(pattern, pls);
    return !ev.overlaps.length && !ev.outside.length;
  };
  const rounded = placements.map((p) => ({ id: p.id, x: round3(p.x), z: round3(p.z), rot: normRot(p.rot) }));
  if (valid(rounded)) return rounded;
  const exact = placements.map((p) => ({ id: p.id, x: p.x, z: p.z, rot: normRot(p.rot) }));
  if (valid(exact)) return exact;
  const raw = placements.map((p) => ({ id: p.id, x: p.x, z: p.z, rot: p.rot }));
  return valid(raw) ? raw : rounded;
}

function storeLayout(state, pattern, placements) {
  const ev = evaluateLayout(pattern, placements);
  const grainWrong = placements.filter((p) => !isGrainOk(p.rot)).map((p) => p.id);
  state.layout = {
    placements: storablePlacements(pattern, placements),
    fabricLength: fabricLengthOf(ev.usedLength),
    efficiency: Math.round(ev.efficiency * 1000) / 1000,
    grainOk: grainWrong.length === 0,
    grainWrong,
  };
  return { ev, grainWrong };
}

function addFabricCosts(ctx, fabric, fabricLength, pattern) {
  ctx.addCost('Tela', Math.round(fabricLength * fabric.pricePerMeter));
  if (pattern.pieces.some((p) => p.id === 'cuello')) ctx.addCost('Ribb (cuello)', COSTS.ribbing);
}

// ---------------------------------------------------------------------------

export default {
  id: 'tizado',
  title: 'Tizado de moldes',
  short: 'Tizado',
  icon: '🖍️',
  scored: true,
  help: `<p>Arrastrá cada <b>molde de papel</b> desde el panel hasta la tela (o tocalo para que caiga en un lugar libre).</p>
<ul>
<li><b>Hilo:</b> girá los moldes hasta que la <b>flecha de hilo</b> quede <b>paralela al orillo</b> (se pone verde). <span class="tiz-kbd">R</span>, la rueda del mouse, clic derecho o doble toque giran 90°.</li>
<li><b>Sin pisarse:</b> si dos moldes se superponen o uno sale de la tela, se marcan en rojo. Al soltar, el imán los acomoda unos milímetros (mantené <span class="tiz-kbd">Alt</span> para soltarlos libres).</li>
<li><b>Ahorro:</b> cuanto menos largo de tela uses, mejor. Encastrá las piezas chicas en los huecos.</li>
<li>Con un molde elegido: flechas para moverlo fino · <span class="tiz-kbd">Supr</span>: devolver a la bandeja · <span class="tiz-kbd">Tab</span>: siguiente molde. <span class="tiz-kbd">Enter</span>: tizar. Sin mouse: <span class="tiz-kbd">Tab</span> hasta una tarjeta del panel y <span class="tiz-kbd">Enter</span> la pone en la tela.</li>
<li><b>Tizar:</b> la tiza recorre cada contorno y deja la línea que después vas a seguir con la tijera. Un clic, un toque o <span class="tiz-kbd">Espacio</span> la aceleran.</li>
</ul>`,

  defaults(state, ctx) {
    const pattern = ctx.getPattern();
    const lay = safeAutoLayout(pattern);
    storeLayout(state, pattern, lay.placements);
    const fabric = fabricById(state.fabric?.id) || fabricById('algodon_jersey');
    ctx.addCost?.('Tela', Math.round(state.layout.fabricLength * fabric.pricePerMeter));
    if (pattern.pieces.some((p) => p.id === 'cuello')) ctx.addCost?.('Ribb (cuello)', COSTS.ribbing);
  },

  async enter(ctx) {
    const { THREE, engine, ui, h, audio, state, world } = ctx;
    const pattern = ctx.getPattern();
    const fabric = fabricById(state.fabric?.id) || fabricById('algodon_jersey');
    const pieces = pattern.pieces;
    const pieceMap = new Map(pieces.map((p) => [p.id, p]));
    const pieceName = (id) => pieceMap.get(id)?.name || id;
    const ref = referenceLayout(pattern) || safeAutoLayout(pattern);
    const autoRef = safeAutoLayout(pattern);
    const selvedgeForced = !!ref && [...analyze(pieceMap, ref.placements).flags.values()].some((f) => f.selvedge);
    // la meta del HUD es la mejor distribución conocida, sin tope: es contra la que se puntúa (efficiencyPoints)
    const targetEff = ref?.efficiency > 0 ? Math.round(ref.efficiency * 1000) / 1000 : efficiencyScale().hi;
    // récord personal por molde (comodidad de este navegador; si no hay storage, no pasa nada)
    const bestKey = `taller:tizado:mejor:${pattern.key}`;
    let personalBest = null;
    try {
      const v = parseFloat(localStorage.getItem(bestKey));
      if (Number.isFinite(v) && v > 0 && v <= 1) personalBest = v;
    } catch (e) {
      personalBest = null;
    }
    const o = fabricOrigin();
    const canvas = engine.canvas;
    const panelEl = document.getElementById('panel');
    const appEl = document.getElementById('app');
    const mobileMq = window.matchMedia('(max-width: 820px)');
    const isMobile = () => mobileMq.matches;
    const modalOpen = () => !!document.querySelector('.modal-wrap');
    // ¿el foco está en un control de la interfaz? (ahí Enter, Tab y las flechas hacen lo suyo)
    const focusInUi = () => {
      const a = document.activeElement;
      return !!a && a !== document.body && a !== canvas && !!a.closest?.('button, a[href], input, select, textarea, summary, [contenteditable="true"]');
    };

    // ---------------- escena ----------------
    const table = createTableScene({ fabric, color: state.fabric.color, heather: state.fabric.heather, sizeLabel: pattern.opts.size });
    ctx.add(table.group);
    const baseY = table.topWorldY + 0.0012;

    const info = `${fitById(pattern.opts.fit)?.name || ''} · ${sleeveById(pattern.opts.sleeve)?.name || ''}`;
    const items = new Map();
    pieces.forEach((piece, i) => {
      const obj = createPaperPiece(piece, { sizeLabel: pattern.opts.size, info });
      obj.group.visible = false;
      ctx.add(obj.group);
      items.set(piece.id, {
        id: piece.id,
        piece,
        obj,
        placed: false,
        pl: { id: piece.id, x: L / 2, z: W / 2, rot: 0 },
        vis: { x: L / 2, z: W / 2, rot: 0, lift: 0, opacity: 1 },
        layer: i,
        tween: null,
        grainWasOk: false,
      });
    });
    const order = [...items.values()];

    // tiza del carrito: guardar pose y restaurarla al salir
    const chalk = world.props.chalk?.group;
    const chalkRest = chalk ? { parent: chalk.parent, position: chalk.position.clone(), rotation: chalk.rotation.clone(), scale: chalk.scale.clone(), visible: chalk.visible } : null;
    ctx.track(() => {
      if (!chalk || !chalkRest) return;
      if (chalk.parent !== chalkRest.parent) chalkRest.parent?.add(chalk);
      chalk.position.copy(chalkRest.position);
      chalk.rotation.copy(chalkRest.rotation);
      chalk.scale.copy(chalkRest.scale);
      chalk.visible = chalkRest.visible;
    });
    // mientras tiza, la tiza toma el color de la línea que deja (celeste pálido no se ve sobre tela clara)
    const chalkMeshes = [];
    chalk?.traverse((m) => m.isMesh && chalkMeshes.push({ mesh: m, material: m.material }));
    const tracingMat = new THREE.MeshStandardMaterial({ color: table.chalkHex, roughness: 0.9, metalness: 0, emissive: table.chalkHex, emissiveIntensity: 0.12 });
    const setChalkLook = (tracing) => {
      for (const c of chalkMeshes) c.mesh.material = tracing ? tracingMat : c.material;
    };
    ctx.track(() => {
      setChalkLook(false);
      tracingMat.dispose();
    });
    ctx.track(() => (canvas.style.cursor = ''));
    panelEl.classList.add('tiz-mode');
    ctx.track(() => panelEl.classList.remove('tiz-mode'));

    // ---------------- estado del juego ----------------
    let phase = 'layout'; // 'layout' | 'arranging' (Hacerlo automático) | 'chalk' | 'done'
    let arranging = false; // moldes volando hacia un acomodo automático: todavía no se puede tizar
    let confirming = false; // diálogo "¿Tizar con el hilo cruzado?" abierto
    let selected = null;
    let hover = null;
    let drag = null;
    let pendingCard = null;
    let lastTap = null;
    let an = null;
    let usedAuto = false;
    let speedMul = 1;
    let wheelAcc = 0;
    let wheelT = 0;
    let grainToastShown = false;
    let lastValid = false;
    let timeScale = 1; // solo para pruebas automáticas (_test.speed)
    let pauseAt = null; // solo para pruebas automáticas (_test.pauseAt)
    let chalkK = 1; // escala de la tiza mientras tiza
    let chalkSize = 0; // tamaño visible de la tiza (m) para su sombra; 0 = sin sombra
    const anims = [];

    const placedItems = () => order.filter((it) => it.placed);
    const placements = () => placedItems().map((it) => it.pl);

    // ---------------- UI: DOM flotante ----------------
    const mkLabel = (cls, html) => {
      const e = h('div', { class: `tiz-label ${cls}`, html });
      appEl.appendChild(e);
      ctx.track(() => e.remove());
      return e;
    };
    const selLabels = [mkLabel('tiz-label-orillo', '<b>ORILLO</b> <span>⟵ hilo ⟶</span>'), mkLabel('tiz-label-orillo', '<b>ORILLO</b> <span>⟵ hilo ⟶</span>')];
    const lenLabel = mkLabel('tiz-label-len', '');
    lenLabel.style.display = 'none';
    const floatEl = h(
      'div',
      { class: 'tiz-float' },
      h('span', { class: 'tiz-float-name' }),
      h('button', { class: 'tiz-float-btn', 'data-act': 'rot', title: 'Girar 90° (R)', 'aria-label': 'Girar 90 grados' }, '⟳'),
      h('button', { class: 'tiz-float-btn', 'data-act': 'tray', title: 'Devolver a la bandeja (Supr)', 'aria-label': 'Devolver a la bandeja' }, '↩'),
    );
    floatEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    floatEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || !selected || phase !== 'layout') return;
      if (act === 'rot') rotateItem(selected, 1);
      if (act === 'tray') returnToTray(selected);
    });
    appEl.appendChild(floatEl);
    ctx.track(() => floatEl.remove());
    const ghost = h('div', { class: 'tiz-ghost' });
    appEl.appendChild(ghost);
    ctx.track(() => ghost.remove());

    // ---------------- HUD ----------------
    const hudEl = h(
      'div',
      { class: 'tiz-hud' },
      h('div', { class: 'hud-title' }, '🖍️ Tizado'),
      h('div', { class: 'tiz-hud-main' }, h('span', { class: 'hud-big tiz-hud-eff' }, '—'), h('span', { class: 'tiz-hud-cap' }, h('span', {}, 'de la tela'), ' ', h('span', {}, 'aprovechada'))),
      h(
        'div',
        { class: 'tiz-hud-meter', title: `La marca negra es la meta: la mejor distribución que conocemos para este molde${personalBest ? `. La dorada, tu récord (${pctTxt(personalBest)})` : ''}` },
        h('i', { class: 'tiz-hud-fill' }),
        personalBest ? h('b', { class: 'tiz-hud-best', style: { left: `${Math.round(personalBest * 100)}%` } }) : null,
        h('b', { class: `tiz-hud-goal${personalBest ? (targetEff > 0.6 ? ' r' : ' l') : ''}`, style: { left: `${Math.round(targetEff * 100)}%` } }, h('span', {}, `meta ${pctTxt(targetEff)}${personalBest ? ` · récord ${pctTxt(personalBest)}` : ''}`)),
      ),
      h('div', { class: 'tiz-hud-line tiz-hud-len' }),
      h('div', { class: 'tiz-hud-line tiz-hud-count' }),
      h('div', { class: 'tiz-hud-status' }),
    );
    ui.hud(hudEl);
    const q = (sel) => hudEl.querySelector(sel);
    // rectángulos de la UI compartida (HUD, indicación) para que las etiquetas no se les encimen
    const rectCache = new Map();
    const cachedRect = (id) => {
      const now = performance.now();
      let c = rectCache.get(id);
      if (!c || now - c.t > 400) {
        const e = document.getElementById(id);
        c = { t: now, r: e && e.classList.contains('show') ? e.getBoundingClientRect() : null };
        rectCache.set(id, c);
      }
      return c.r;
    };
    const hudRect = () => cachedRect('hud');
    const hintRect = () => cachedRect('hint');

    // ---------------- Panel ----------------
    const cards = new Map();
    const tray = h('div', { class: 'tiz-tray', role: 'list' });
    for (const it of order) {
      const chip = h('span', { class: 'tiz-chip' }, 'En la bandeja');
      const card = h(
        'button',
        { class: 'tiz-card is-tray', role: 'listitem', dataset: { id: it.id }, title: `${it.piece.name}: arrastralo a la tela o tocalo` },
        h('span', { class: 'tiz-card-thumb' }, pieceThumb(it.piece, { size: 56 })),
        h('span', { class: 'tiz-card-text' }, h('span', { class: 'tiz-card-name' }, it.piece.name), chip),
      );
      card.addEventListener('pointerdown', (e) => {
        if (phase !== 'layout' || e.button === 2) return;
        e.preventDefault();
        pendingCard = { id: it.id, sx: e.clientX, sy: e.clientY, touch: e.pointerType !== 'mouse' };
      });
      // con el teclado (Tab hasta la tarjeta + Enter/Espacio) el molde cae en un lugar libre
      card.addEventListener('click', (e) => {
        if (e.detail !== 0 || phase !== 'layout' || card.disabled) return;
        trayTap(it.id);
      });
      card.addEventListener('contextmenu', (e) => e.preventDefault());
      cards.set(it.id, { card, chip });
      tray.appendChild(card);
    }
    const issuesEl = h('div', { class: 'tiz-issues' });
    const body = h(
      'div',
      { class: 'tiz' },
      h(
        'div',
        { class: 'tiz-legend' },
        h('span', { class: 'tiz-leg tiz-leg-ok' }, h('i'), 'hilo paralelo al orillo'),
        h('span', { class: 'tiz-leg tiz-leg-bad' }, h('i'), 'hilo cruzado'),
      ),
      ui.section(`Moldes de papel · talle ${pattern.opts.size}`, h('p', { class: 'tiz-sub' }, isMobile() ? 'Arrastralos hasta la tela o tocalos para ubicarlos.' : 'Arrastralos hasta la tela (o hacé clic para ubicarlos en un lugar libre).'), tray),
      issuesEl,
      h(
        'details',
        { class: 'tiz-tips' },
        h('summary', {}, '📐 Cómo se tiza bien'),
        h(
          'ul',
          {},
          h('li', { html: 'La <b>flecha de hilo</b> de cada molde va <b>paralela al orillo</b> (el borde de fábrica de la tela). Medí desde la flecha hasta el orillo en las dos puntas: tiene que dar lo mismo.' }),
          h('li', { html: 'Primero las piezas <b>grandes</b> (frente y espalda) contra un orillo; después las mangas y el cuello en los huecos.' }),
          h('li', { html: 'Las curvas de escote y sisa dejan lugar: girando 180° una pieza a veces encastra mejor (el hilo sigue derecho).' }),
          h('li', { html: 'No tices sobre el <b>orillo</b>: es más duro y encoge distinto.' }),
          h('li', { html: fabric.knit ? `En <b>${fabric.short}</b> (tejido de punto) el hilo son las columnas de mallas: si quedan cruzadas, la remera se tuerce al lavarla.` : `En <b>${fabric.short}</b> (tejido plano) el hilo es la urdimbre, paralela al orillo: torcida, la pieza cede y cae mal.` }),
        ),
      ),
      h(
        'div',
        { class: 'tiz-keys' },
        isMobile()
          ? h('span', { html: '<b>Doble toque</b> o <b>⟳</b>: girar · <b>↩</b>: a la bandeja' })
          : h('span', { html: '<span class="kbd">R</span> / rueda / clic der.: girar · <span class="kbd">←↑→↓</span> mover fino · <span class="kbd">Supr</span> a la bandeja · <span class="kbd">Alt</span> sin imán' }),
      ),
    );
    ui.panel({
      kicker: 'Paso 5 · Mesa de corte',
      title: 'Tizado de moldes',
      subtitle: isMobile() ? `Moldes sobre la tela de <b>${fabric.short}</b>: hilo derecho y la menor cantidad de tela.` : `Acomodá los moldes sobre la tela de <b>${fabric.short}</b> con el hilo derecho y gastando lo menos posible.`,
      body,
      actions: [
        { id: 'acomodar', label: '🧩 Acomodar', kind: 'secondary', title: 'Acomodo automático por columnas (después lo podés mejorar)', onClick: () => autoArrange(false) },
        { id: 'tizar', label: '🖍️ Tizar', kind: 'primary', disabled: true, onClick: () => tizar(false) },
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoComplete() },
      ],
    });

    // ---------------- cámara ----------------
    const viewBox = () => {
      const pad = isMobile() ? 0.03 : 0.06;
      return { minX: o.x0 - pad * 0.6, maxX: o.x0 + L + 0.06, minZ: o.z0 - pad - 0.02, maxZ: o.z0 + W + pad, y: table.topWorldY };
    };
    let insets = screenInsets();
    const computeView = () => {
      insets = screenInsets();
      return fitView(engine.camera, viewBox(), { tilt: isMobile() ? 1.4 : 1.3, reserveTop: isMobile() ? 82 : 150, reserveBottom: isMobile() ? 50 : 52, margin: isMobile() ? 6 : 16 });
    };
    let view = computeView();
    // Las lámparas colgantes de la mesa quedan entre la cámara y la tela: con el plano cercano de la
    // cámara justo por encima de la mesa se recortan (corte tipo maqueta), sin tocar el taller.
    const cam = engine.camera;
    const near0 = cam.near;
    const setNear = (v) => {
      cam.near = v;
      cam.updateProjectionMatrix();
    };
    const nearFor = (vw) => Math.max(near0, Math.hypot(vw.position[0] - vw.target[0], vw.position[1] - vw.target[1], vw.position[2] - vw.target[2]) - 0.95);
    ctx.track(() => setNear(near0));
    let flightId = 0;
    const flyView = async (dur) => {
      const id = ++flightId;
      const nNew = nearFor(view);
      if (cam.near > nNew) setNear(nNew);
      await ctx.flyTo(view, dur);
      if (ctx.alive && id === flightId && !engine.flying) setNear(nNew);
    };
    flyView(1.3);
    let refitTimer = null;
    const refit = (dur = 0.4) => {
      clearTimeout(refitTimer);
      refitTimer = setTimeout(() => {
        if (!ctx.alive) return;
        view = computeView();
        flyView(dur);
      }, 180);
    };
    ctx.track(() => clearTimeout(refitTimer));
    ctx.listen(window, 'resize', () => refit(0.3));
    const toggleBtn = document.getElementById('panel-toggle');
    if (toggleBtn) ctx.listen(toggleBtn, 'click', () => refit(0.45));
    ctx.listen(canvas, 'contextmenu', (e) => e.preventDefault());

    // ---------------- geometría auxiliar ----------------
    const boundsCache = new Map();
    const localBounds = (piece, rot) => {
      const k = `${piece.id}|${normRot(rot).toFixed(3)}`;
      if (!boundsCache.has(k)) boundsCache.set(k, bounds(placedOutline(piece, { x: 0, z: 0, rot })));
      return boundsCache.get(k);
    };
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -table.topWorldY);
    const pointerFabric = () => {
      const p = engine.pointerOnPlane(plane);
      return p ? worldToFabric(p.x, p.z) : null;
    };
    // metros por píxel en la tela (para tolerancias de toque)
    const metersPerPx = () => {
      const a = toScreen(L / 2 - 0.5, W / 2);
      const b = toScreen(L / 2 + 0.5, W / 2);
      return 1 / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    };
    const pickPiece = () => {
      const live = order.filter((it) => it.placed && it.obj.group.visible);
      if (!live.length) return null;
      const hits = engine.raycast(live.map((it) => it.obj.paper), null, false);
      if (hits.length) return hits[0].object.userData.pieceId;
      // tiras finitas (cuello, ribetes): se agarran aunque el dedo caiga unos píxeles al costado
      const p = pointerFabric();
      if (!p) return null;
      const tol = (isMobile() ? 22 : 10) * metersPerPx();
      let best = null;
      let bd = tol;
      for (const it of live) {
        const poly = placedOutline(it.piece, { ...it.pl, x: it.vis.x, z: it.vis.z, rot: it.pl.rot });
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const d = distToSegment(p.x, p.z, poly[j].x, poly[j].z, poly[i].x, poly[i].z);
          if (d < bd) {
            bd = d;
            best = it.id;
          }
        }
      }
      return best;
    };
    const overPanel = (e) => {
      if (panelEl.classList.contains('hidden')) return false;
      const r = panelEl.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const bringToTop = (id) => {
      const it = items.get(id);
      const rest = order.filter((x) => x !== it).sort((a, b) => a.layer - b.layer);
      rest.forEach((x, i) => (x.layer = i));
      it.layer = rest.length;
    };
    const clampCenter = (x, z) => ({ x: clamp(x, -0.35, L + 0.3), z: clamp(z, -0.3, W + 0.3) });

    // Imán: alinea los bordes de la caja del molde con los extremos de la tela, el orillo y los
    // moldes vecinos cuando quedan a menos de 1,5 cm.
    const snap = (it, x, z) => {
      const b0 = localBounds(it.piece, it.pl.rot);
      const bx0 = x + b0.minX;
      const bx1 = x + b0.maxX;
      const bz0 = z + b0.minZ;
      const bz1 = z + b0.maxZ;
      const G = 0.004;
      const cx = [0.003 - bx0, L - 0.003 - bx1];
      const cz = [SELVEDGE + 0.001 - bz0, W - SELVEDGE - 0.001 - bz1];
      for (const other of placedItems()) {
        if (other === it) continue;
        const ob = an?.flags.get(other.id)?.b || bounds(placedOutline(other.piece, other.pl));
        if (bz0 < ob.maxZ + 0.05 && bz1 > ob.minZ - 0.05) cx.push(ob.maxX + G - bx0, ob.minX - G - bx1);
        if (bx0 < ob.maxX + 0.05 && bx1 > ob.minX - 0.05) cz.push(ob.maxZ + G - bz0, ob.minZ - G - bz1);
      }
      const T = 0.015;
      const pick = (arr) => arr.reduce((best, d) => (Math.abs(d) < T && (best === null || Math.abs(d) < Math.abs(best)) ? d : best), null);
      const dx = pick(cx);
      const dz = pick(cz);
      return { x: x + (dx ?? 0), z: z + (dz ?? 0) };
    };

    // ---------------- análisis + UI ----------------
    let evalCache = null;
    function refresh(full = false) {
      const pls = placements();
      an = analyze(pieceMap, pls);
      table.setOverlap(an.count);
      for (const it of order) {
        const fl = an.flags.get(it.id);
        const grainOk = isGrainOk(it.pl.rot);
        it.obj.setState({ bad: it.placed && !!fl && (fl.overlap || fl.outside), warn: it.placed && !!fl && fl.selvedge, grainOk, selected: selected === it.id, hover: hover === it.id, drag: drag?.id === it.id });
        if (it.placed && grainOk && !it.grainWasOk && full) {
          it.grainWasOk = true;
          if (!grainToastShown) {
            grainToastShown = true;
            ui.toast('✓ ¡Hilo derecho! La flecha verde quedó paralela al orillo.', 'good', 2600);
          }
        }
        if (!grainOk) it.grainWasOk = false;
        const okNow = it.placed && !!fl && !fl.overlap && !fl.outside && grainOk;
        if (okNow && !it.wasOk && full && phase === 'layout') popCheck(it);
        it.wasOk = okNow;
      }
      const allPlaced = order.every((it) => it.placed);
      const anyBad = [...an.flags.values()].some((f) => f.overlap || f.outside);
      table.setLength(pls.length && an.usedLength > 0 ? fabricLengthOf(an.usedLength) : null);
      if (full && allPlaced) evalCache = evaluateLayout(pattern, pls);
      else if (!allPlaced) evalCache = null;
      const evalBad = evalCache && (evalCache.overlaps.length || evalCache.outside.length);
      // con los moldes todavía volando hacia un acomodo automático (o el diálogo abierto) no se tiza
      const valid = allPlaced && !anyBad && !evalBad && phase === 'layout' && !arranging && !confirming;
      ui.enableAction('tizar', valid);
      if (valid && !lastValid && full) audio.play('pop');
      lastValid = valid;
      if (valid && full) addFabricCosts(ctx, fabric, fabricLengthOf(an.usedLength), pattern);
      updateHud(allPlaced, valid);
      updateCards();
      updateIssues(allPlaced, valid);
      updateHint(allPlaced, valid);
    }

    function updateHud(allPlaced, valid) {
      const pls = placements();
      const bad = [...an.flags.entries()].filter(([, f]) => f.overlap || f.outside);
      // El aprovechamiento solo vale con todos los moldes en la tela: con algunos en la bandeja
      // el número da alto y después baja al sumar piezas. Con moldes en rojo se muestra en gris.
      const measurable = allPlaced && pls.length > 0;
      const eff = measurable ? an.efficiency : 0;
      const effEl = q('.tiz-hud-eff');
      effEl.textContent = measurable ? pctTxt(eff) : '—';
      effEl.classList.toggle('dim', !measurable || bad.length > 0);
      const fill = q('.tiz-hud-fill');
      fill.style.width = `${Math.round(clamp(eff) * 100)}%`;
      fill.classList.toggle('good', measurable && !bad.length && eff >= targetEff - 0.02);
      fill.classList.toggle('dim', bad.length > 0);
      const left = order.length - pls.length;
      const cap = q('.tiz-hud-cap');
      const capTxt = measurable ? 'de la tela|aprovechada' : pls.length ? `se mide con|todos los moldes` : 'de la tela|aprovechada';
      if (cap.dataset.t !== capTxt) {
        cap.dataset.t = capTxt;
        const [a, b] = capTxt.split('|');
        cap.innerHTML = '';
        cap.append(h('span', {}, a), ' ', h('span', {}, b));
        cap.classList.toggle('todo', !measurable && pls.length > 0);
      }
      const len = pls.length && an.usedLength > 0 ? fabricLengthOf(an.usedLength) : 0;
      q('.tiz-hud-len').innerHTML = len ? `📏 <b>${mTxt(len)} m</b> de tela · ${money(Math.round(len * fabric.pricePerMeter))}` : '📏 Todavía no hay moldes en la tela';
      const nOk = pls.filter((p) => isGrainOk(p.rot)).length;
      q('.tiz-hud-count').innerHTML = `🧩 ${pls.length}/${order.length} moldes · 🧭 hilo ${nOk}/${pls.length || 0}`;
      const st = q('.tiz-hud-status');
      if (arranging) {
        st.className = 'tiz-hud-status';
        st.textContent = '🧩 Acomodando los moldes…';
      } else if (bad.length) {
        st.className = 'tiz-hud-status bad';
        st.textContent = `⚠ ${bad.some(([, f]) => f.outside) ? 'Hay moldes fuera de la tela' : 'Hay moldes que se pisan'}`;
      } else if (valid) {
        st.className = 'tiz-hud-status good';
        st.textContent = nOk === pls.length ? '✓ Listo para tizar' : '✓ Se puede tizar (ojo con el hilo)';
      } else if (!allPlaced) {
        st.className = 'tiz-hud-status todo';
        st.textContent = `Faltan ${left} ${left === 1 ? 'molde' : 'moldes'} en la bandeja`;
      } else {
        st.className = 'tiz-hud-status';
        st.textContent = '';
      }
    }

    function updateCards() {
      for (const it of order) {
        const { card, chip } = cards.get(it.id);
        const fl = an?.flags.get(it.id);
        let cls = 'is-tray';
        let txt = 'En la bandeja';
        if (it.placed && fl) {
          if (fl.outside) {
            cls = 'is-bad';
            txt = '✗ Fuera de la tela';
          } else if (fl.overlap) {
            cls = 'is-bad';
            txt = '✗ Se pisa';
          } else if (!isGrainOk(it.pl.rot)) {
            cls = 'is-grain';
            txt = '⟳ Hilo cruzado';
          } else if (fl.selvedge) {
            cls = 'is-warn';
            txt = '⚠ Sobre el orillo';
          } else {
            cls = 'is-ok';
            txt = '✓ Bien';
          }
        }
        card.className = `tiz-card ${cls}${selected === it.id ? ' is-selected' : ''}`;
        if (chip.textContent !== txt) chip.textContent = txt;
      }
    }

    let issuesKey = '';
    function updateIssues(allPlaced, valid) {
      const pls = placements();
      const list = [];
      if (evalCache?.overlaps.length) for (const [a, b] of evalCache.overlaps) list.push(['bad', `<b>${pieceName(a)}</b> y <b>${pieceName(b)}</b> se pisan.`]);
      else for (const [id, f] of an.flags) if (f.overlap) list.push(['bad', `<b>${pieceName(id)}</b> se pisa con otro molde.`]);
      for (const [id, f] of an.flags) if (f.outside) list.push(['bad', `<b>${pieceName(id)}</b> sale de la tela.`]);
      const wrong = pls.filter((p) => !isGrainOk(p.rot));
      if (wrong.length) list.push(['warn', `Hilo cruzado en <b>${wrong.map((p) => pieceName(p.id)).join(', ')}</b>: giralos 90° (flecha roja → verde).`]);
      const onSel = [...an.flags.entries()].filter(([, f]) => f.selvedge && !f.outside).map(([id]) => pieceName(id));
      if (onSel.length) list.push(['warn', `<b>${onSel.join(', ')}</b> ${onSel.length === 1 ? 'pisa el orillo: correlo' : 'pisan el orillo: correlos'} 1–2 cm hacia adentro.`]);
      const head = valid && !wrong.length && !onSel.length ? 'good' : valid ? 'warn' : '';
      const key = JSON.stringify([head, head === 'good' ? pctTxt(an.efficiency) : '', list.slice(0, 5)]);
      if (key === issuesKey) return; // sin cambios: no rehacer el DOM en cada movimiento del mouse
      issuesKey = key;
      issuesEl.innerHTML = '';
      if (head === 'good') issuesEl.appendChild(ui.note(`✓ <b>Todo en su lugar.</b> Aprovechás el ${pctTxt(an.efficiency)} de la tela. ¿Podés encastrar más? Si no, ¡a tizar!`, 'good'));
      else if (head === 'warn') issuesEl.appendChild(ui.note('Se puede tizar, pero hay detalles que te van a restar puntos:', 'warn'));
      for (const [type, html] of list.slice(0, 5)) issuesEl.appendChild(h('div', { class: `tiz-issue ${type}`, html }));
    }

    let lastHint = null;
    const setHint = (txt) => {
      if (txt === lastHint) return;
      lastHint = txt;
      ui.hint(txt);
    };
    function updateHint(allPlaced, valid) {
      if (arranging) {
        setHint(isMobile() ? '🧩 Acomodando los moldes…' : '🧩 Acomodando los moldes por columnas…');
        return;
      }
      if (phase !== 'layout') return;
      const pls = placements();
      const m = isMobile();
      if (drag) setHint(m ? 'Soltalo sobre la tela' : 'Soltá sobre la tela · <kbd>R</kbd> o la rueda giran 90° · <kbd>Alt</kbd> suelta sin imán');
      else if (!pls.length) setHint(m ? '👇 Arrastrá un molde hasta la tela' : '👉 Arrastrá un molde desde el panel hasta la tela');
      else if (pls.some((p) => !isGrainOk(p.rot))) setHint(m ? 'Doble toque o <b>⟳</b>: flecha paralela al orillo ⟷' : 'Girá con <kbd>R</kbd>, la rueda o clic derecho: la flecha tiene que quedar <b>paralela al orillo</b> ⟷');
      else if (!allPlaced) setHint(m ? 'Seguí con los moldes de la bandeja' : 'Seguí con los moldes de la bandeja · las piezas chicas entran en los huecos');
      else if (!valid) setHint(m ? 'Separá los moldes en rojo' : 'Hay moldes en rojo: separalos o metelos adentro de la tela');
      else setHint(m ? '¡Listo! Tocá <b>🖍️ Tizar</b>' : '¡Listo! Encastrá un poco más o tocá <b>🖍️ Tizar</b> para marcar los contornos');
    }

    // tilde verde que sube y se desvanece sobre un molde que quedó bien ubicado
    function popCheck(it) {
      const p = toScreen(it.pl.x, it.pl.z, 0.01);
      if (p.behind) return;
      const el = h('div', { class: 'tiz-pop' }, '✓');
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
      appEl.appendChild(el);
      const kill = () => el.remove();
      ctx.track(kill);
      ctx.timeout(kill, 1100);
    }

    // ---------------- acciones sobre moldes ----------------
    function select(id) {
      selected = id;
      refreshStates();
      updateCards();
    }
    function refreshStates() {
      for (const it of order) it.obj.setState({ selected: selected === it.id, hover: hover === it.id, drag: drag?.id === it.id });
    }

    function placeFromTray(id, x, z, { tweenFrom = null } = {}) {
      const it = items.get(id);
      it.placed = true;
      it.pl.rot = 0;
      it.pl.x = x;
      it.pl.z = z;
      it.vis.rot = 0;
      it.vis.opacity = 1;
      it.obj.setOpacity(1);
      it.obj.group.visible = true;
      bringToTop(id);
      if (tweenFrom) {
        it.tween = { from: { ...tweenFrom, rot: 0 }, to: { x, z, rot: 0 }, t: 0, dur: 0.45, delay: 0, arc: 0.05 };
      } else {
        it.vis.x = x;
        it.vis.z = z;
      }
    }

    function returnToTray(id) {
      const it = items.get(id);
      if (!it || !it.placed) return;
      it.placed = false;
      it.tween = null;
      it.obj.group.visible = false;
      if (selected === id) selected = null;
      if (hover === id) hover = null;
      audio.play('cut');
      refresh(true);
    }

    function rotateItem(id, dir = 1) {
      const it = items.get(id);
      if (!it || !it.placed || phase !== 'layout') return;
      const a = dir * HALF_PI;
      it.pl.rot = normRot(it.pl.rot + a);
      if (drag && drag.id === id) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const ox = drag.offX;
        const oz = drag.offZ;
        drag.offX = ox * c + oz * s;
        drag.offZ = -ox * s + oz * c;
        const p = pointerFabric();
        if (p) {
          const cc = clampCenter(p.x - drag.offX, p.z - drag.offZ);
          it.pl.x = it.vis.x = cc.x;
          it.pl.z = it.vis.z = cc.z;
        }
      }
      audio.play('select');
      if (!drag) {
        selected = id;
        bringToTop(id);
        // al girar en el lugar puede sobresalir o quedar apenas encimado: se acomoda solo
        const centerIn = it.pl.x > 0 && it.pl.x < L && it.pl.z > 0 && it.pl.z < W;
        if (centerIn) keepInside(id);
        settleItem(id);
      }
      refresh(!drag);
    }

    // Si el molde sobresale de la tela (por ejemplo al girarlo cerca del borde), lo entra.
    function keepInside(id) {
      const it = items.get(id);
      const b = localBounds(it.piece, it.pl.rot);
      const x0 = 0.003 - b.minX;
      const x1 = L - 0.003 - b.maxX;
      const z0 = SELVEDGE + 0.001 - b.minZ;
      const z1 = W - SELVEDGE - 0.001 - b.maxZ;
      if (x0 <= x1) it.pl.x = clamp(it.pl.x, x0, x1);
      if (z0 <= z1) it.pl.z = clamp(it.pl.z, z0, z1);
      else it.pl.z = clamp(it.pl.z, 0.002 - b.minZ, W - 0.002 - b.maxZ);
    }

    function settleItem(id) {
      const r = settle(pieceMap, placements(), id);
      const it = items.get(id);
      if (r && r.moved) {
        it.tween = { from: { x: it.vis.x, z: it.vis.z, rot: it.vis.rot }, to: { x: r.x, z: r.z, rot: it.pl.rot }, t: 0, dur: 0.14, delay: 0, arc: 0 };
        it.pl.x = r.x;
        it.pl.z = r.z;
        return true;
      }
      return false;
    }

    // Lugar libre para un molde que llega de la bandeja (con rot = 0, como viene).
    function autoSpot(id) {
      const it = items.get(id);
      const occ = occupancyFrom(pieceMap, placements(), 1);
      const spot = firstFit(it.piece, 0, occ, { zMin: SELVEDGE, zMax: W - SELVEDGE });
      if (spot) return spot;
      const lb = localBounds(it.piece, 0);
      return { x: clamp(L - 0.25, -lb.minX, L - lb.maxX), z: W / 2 };
    }

    // Toque (o Enter) sobre una tarjeta de la bandeja: si el molde no está en la tela, cae en el
    // primer lugar libre; si ya está, se elige.
    function trayTap(id) {
      const it = items.get(id);
      if (!it || phase !== 'layout') return;
      if (!it.placed) {
        const s = autoSpot(id);
        placeFromTray(id, s.x, s.z, { tweenFrom: { x: L + 0.35, z: s.z, lift: 0.06 } });
        selected = id;
        audio.play('cut');
        refresh(true);
      } else {
        selected = id;
        bringToTop(id);
        refreshStates();
        updateCards();
      }
    }

    function nudge(dx, dz) {
      if (!selected) return;
      const it = items.get(selected);
      const c = clampCenter(it.pl.x + dx, it.pl.z + dz);
      it.pl.x = c.x;
      it.pl.z = c.z;
      refresh(true);
    }

    // ---------------- puntero ----------------
    ctx.onPointer('down', (e) => {
      if (phase === 'chalk') {
        speedMul = 3;
        return;
      }
      if (phase !== 'layout' || modalOpen()) return;
      const id = pickPiece();
      if (e.button === 2) {
        if (id) rotateItem(id, 1);
        return;
      }
      if (!id) {
        if (selected) select(null);
        return;
      }
      const now = performance.now();
      if (lastTap && lastTap.id === id && now - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
        lastTap = null;
        rotateItem(id, 1);
        return;
      }
      lastTap = { id, t: now, x: e.clientX, y: e.clientY };
      const it = items.get(id);
      const p = pointerFabric() || { x: it.pl.x, z: it.pl.z };
      it.tween = null;
      drag = { id, offX: p.x - it.pl.x, offZ: p.z - it.pl.z, moved: false, sx: e.clientX, sy: e.clientY, fromTray: false };
      selected = id;
      bringToTop(id);
      audio.play('tick');
      canvas.style.cursor = 'grabbing';
      refreshStates();
      updateCards();
    });

    ctx.onPointer('move', (e) => {
      if (phase !== 'layout') return;
      if (pendingCard && !drag) {
        const dx = e.clientX - pendingCard.sx;
        const dy = e.clientY - pendingCard.sy;
        // En el celular la bandeja es una fila que se desliza de costado: un gesto horizontal (o
        // hacia abajo) es para recorrerla. Solo un gesto hacia arriba, hacia la tela, saca el molde.
        if (Math.hypot(dx, dy) > 7 && pendingCard.touch && isMobile() && !(-dy > Math.abs(dx) * 0.8)) {
          pendingCard = null;
          return;
        }
        if (Math.hypot(dx, dy) > 7) {
          const id = pendingCard.id;
          pendingCard = null;
          const it = items.get(id);
          if (it.placed) returnToTray(id);
          const p = pointerFabric() || { x: L + 0.2, z: W / 2 };
          const c = clampCenter(p.x, p.z);
          placeFromTray(id, c.x, c.z);
          drag = { id, offX: 0, offZ: 0, moved: true, sx: e.clientX, sy: e.clientY, fromTray: true };
          selected = id;
          audio.play('tick');
          ghost.innerHTML = '';
          ghost.appendChild(pieceThumb(it.piece, { size: 70 }));
          refresh(false);
        } else return;
      }
      if (drag) {
        const it = items.get(drag.id);
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        drag.moved = true;
        const p = pointerFabric();
        if (!p) return;
        let c = clampCenter(p.x - drag.offX, p.z - drag.offZ);
        if (!e.altKey) c = snap(it, c.x, c.z);
        it.pl.x = it.vis.x = c.x;
        it.pl.z = it.vis.z = c.z;
        const inPanel = drag.fromTray && overPanel(e);
        drag.overPanel = inPanel;
        ghost.classList.toggle('show', inPanel);
        if (inPanel) {
          ghost.style.left = `${e.clientX}px`;
          ghost.style.top = `${e.clientY}px`;
        }
        refresh(false);
        return;
      }
      if (!engine.pointer.inside && !e.target?.closest?.('#scene')) {
        if (hover) {
          hover = null;
          refreshStates();
          canvas.style.cursor = '';
        }
        return;
      }
      const id = pickPiece();
      if (id !== hover) {
        hover = id;
        refreshStates();
        canvas.style.cursor = id ? 'grab' : '';
      }
    });

    ctx.onPointer('up', (e) => {
      if (phase !== 'layout') {
        pendingCard = null;
        return;
      }
      if (pendingCard) {
        const id = pendingCard.id;
        pendingCard = null;
        trayTap(id);
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      ghost.classList.remove('show');
      canvas.style.cursor = hover ? 'grab' : '';
      if (d.fromTray && overPanel(e)) {
        returnToTray(d.id);
        return;
      }
      if (d.moved) {
        const it = items.get(d.id);
        if (!e.altKey) {
          // soltado con el centro sobre la tela: lo que sobresale se entra y el imán lo despega de los vecinos
          const lb = localBounds(it.piece, it.pl.rot);
          const out = Math.max(-(it.pl.x + lb.minX), it.pl.x + lb.maxX - L, -(it.pl.z + lb.minZ), it.pl.z + lb.maxZ - W);
          if (out > 0 && out < 0.15 && it.pl.x > 0 && it.pl.x < L && it.pl.z > 0 && it.pl.z < W) {
            const from = { x: it.vis.x, z: it.vis.z, rot: it.vis.rot, lift: it.vis.lift };
            keepInside(d.id);
            it.tween = { from, to: { x: it.pl.x, z: it.pl.z, rot: it.pl.rot }, t: 0, dur: 0.16, delay: 0, arc: 0 };
          }
          settleItem(d.id);
        }
        audio.play('tick');
      }
      refresh(true);
    });

    // el navegador se quedó con el gesto (p. ej. deslizar la bandeja en el celular)
    // Un molde recién sacado de la bandeja vuelve a ella salvo que ya esté sobre la tela.
    ctx.listen(window, 'pointercancel', () => {
      pendingCard = null;
      if (!drag) return;
      const d = drag;
      drag = null;
      ghost.classList.remove('show');
      canvas.style.cursor = '';
      if (phase !== 'layout') return;
      const fl = an?.flags.get(d.id);
      if (d.fromTray && (!fl || fl.outside || d.overPanel)) returnToTray(d.id);
      else {
        if (d.moved) settleItem(d.id);
        refresh(true);
      }
    });

    ctx.onPointer('wheel', (e) => {
      if (phase !== 'layout') return;
      const id = drag?.id || hover;
      if (!id) return;
      const now = performance.now();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) >= 60 && now - wheelT > 170) {
        rotateItem(id, wheelAcc > 0 ? 1 : -1);
        wheelAcc = 0;
        wheelT = now;
      }
    });

    ctx.listen(window, 'keydown', (e) => {
      if (modalOpen() || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (phase === 'chalk') {
        if (e.code === 'Space') {
          speedMul = 3;
          e.preventDefault();
        }
        return;
      }
      if (phase !== 'layout') return;
      const k = e.key;
      const step = e.shiftKey ? 0.02 : 0.005;
      const target = drag?.id || hover || selected;
      // Solo se toman las teclas de navegación cuando hay un molde elegido: si no, Tab recorre los
      // botones del panel y las flechas lo desplazan como siempre.
      const sel = selected && items.get(selected)?.placed ? selected : null;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (k === 'r' || k === 'R' || k === 'e' || k === 'E') {
        if (target) {
          rotateItem(target, e.shiftKey ? -1 : 1);
          e.preventDefault();
        }
      } else if (k === 'q' || k === 'Q') {
        if (target) rotateItem(target, -1);
      } else if (arrows[k]) {
        if (sel) {
          nudge(...arrows[k]);
          e.preventDefault();
        }
      } else if (k === 'Delete' || k === 'Backspace') {
        if (sel) {
          returnToTray(sel);
          e.preventDefault();
        }
      } else if (k === 'Tab') {
        // con un molde elegido (y el foco fuera del panel), Tab pasa al siguiente; después del
        // último suelta la selección y el foco sigue su camino normal
        const pl = placedItems();
        if (sel && !focusInUi() && pl.length > 1) {
          const i = pl.findIndex((x) => x.id === sel);
          const j = i + (e.shiftKey ? -1 : 1);
          if (j < 0 || j >= pl.length) select(null);
          else {
            select(pl[j].id);
            bringToTop(pl[j].id);
            e.preventDefault();
          }
        }
      } else if (k === 'Escape') {
        select(null);
      } else if (k === 'Enter') {
        // en un botón enfocado, Enter es su clic (no un segundo "Tizar")
        if (e.repeat || focusInUi()) return;
        if (!ui.action('tizar')?.disabled) {
          e.preventDefault();
          tizar(false);
        }
      }
    });

    // ---------------- animaciones ----------------
    const tweenP = (dur, fn) =>
      new Promise((resolve) => {
        anims.push({ t: 0, dur: Math.max(0.001, dur), fn, resolve });
      });

    const worldOf = (x, z, dy = 0) => new THREE.Vector3(o.x0 + x, table.topWorldY + dy, o.z0 + z);
    const tmpV = new THREE.Vector3();

    // espera a que terminen las animaciones de los moldes (por cuadros, no por reloj: en un equipo
    // lento los tweens van más despacio y no hay que tizar con los moldes todavía en el aire)
    const settleWaiters = [];
    const whenSettled = () => new Promise((resolve) => settleWaiters.push(resolve));

    ctx.onUpdate((dt0, t) => {
      const dt = dt0 * timeScale;
      const sdt = dt * speedMul;
      for (let i = anims.length - 1; i >= 0; i--) {
        const a = anims[i];
        a.t += sdt;
        const k = Math.min(1, a.t / a.dur);
        a.fn(k, sdt);
        if (k >= 1) {
          anims.splice(i, 1);
          a.resolve();
        }
      }
      const kPos = 1 - Math.exp(-dt * 22);
      const kRot = 1 - Math.exp(-dt * 16);
      for (const it of order) {
        if (!it.obj.group.visible) continue;
        const v = it.vis;
        const isDrag = drag?.id === it.id;
        if (it.tween) {
          const tw = it.tween;
          if (tw.delay > 0) tw.delay -= dt;
          else {
            if (tw.sound) {
              tw.sound = false;
              audio.play('cut');
            }
            tw.t += dt;
            const k = Math.min(1, tw.t / tw.dur);
            const e = easeInOutCubic(k);
            v.x = tw.from.x + (tw.to.x - tw.from.x) * e;
            v.z = tw.from.z + (tw.to.z - tw.from.z) * e;
            v.rot = tw.from.rot + wrapPi(tw.to.rot - tw.from.rot) * e;
            v.lift = (tw.from.lift || 0) * (1 - e) + tw.arc * Math.sin(Math.PI * k);
            if (k >= 1) {
              it.tween = null;
              v.rot = tw.to.rot;
            }
          }
        } else if (!it.lifting) {
          if (!isDrag) {
            v.x += (it.pl.x - v.x) * kPos;
            v.z += (it.pl.z - v.z) * kPos;
          }
          v.rot += wrapPi(it.pl.rot - v.rot) * kRot;
          const liftTarget = isDrag && drag.moved ? 0.024 : 0;
          v.lift += (liftTarget - v.lift) * (1 - Math.exp(-dt * 14));
        }
        it.obj.group.position.set(o.x0 + v.x, baseY + it.layer * 0.0007 + v.lift, o.z0 + v.z);
        it.obj.group.rotation.y = v.rot;
        it.obj.tick(t);
        if (it.lifting) it.obj.setOpacity(v.opacity);
      }
      table.tick(dt, t);
      const cf = chalk && chalkSize > 0 ? worldToFabric(chalk.position.x, chalk.position.z) : null;
      if (cf && cf.x > -0.02 && cf.x < L + 0.02 && cf.z > -0.02 && cf.z < W + 0.02) table.setChalkShadow(cf.x, cf.z, chalk.position.y - table.topWorldY, chalkSize);
      else table.setChalkShadow(null);
      positionLabels();
      if (settleWaiters.length && order.every((it) => !it.tween)) for (const r of settleWaiters.splice(0)) r();
    });

    const projV = new THREE.Vector3();
    let cw = canvas.clientWidth || window.innerWidth;
    let chh = canvas.clientHeight || window.innerHeight;
    ctx.listen(window, 'resize', () => {
      cw = canvas.clientWidth || window.innerWidth;
      chh = canvas.clientHeight || window.innerHeight;
    });
    const toScreen = (x, z, dy = 0) => {
      projV.set(o.x0 + x, table.topWorldY + dy, o.z0 + z).project(engine.camera);
      return { x: (projV.x * 0.5 + 0.5) * cw, y: (-projV.y * 0.5 + 0.5) * chh, behind: projV.z > 1 };
    };
    function positionLabels() {
      const hudR = hudRect();
      const avoid = [hintRect()].filter(Boolean);
      // barra flotante del molde elegido (primero: las etiquetas se corren de ella)
      const it = selected ? items.get(selected) : null;
      if (it && it.placed && phase === 'layout' && !drag) {
        const b = localBounds(it.piece, it.pl.rot);
        const pTop = toScreen(it.vis.x, it.vis.z + b.minZ, 0.01);
        const nm = floatEl.querySelector('.tiz-float-name');
        const wasShown = floatEl.classList.contains('show');
        floatEl.classList.add('show');
        if (nm.textContent !== it.piece.name || !wasShown || !floatEl._w) {
          nm.textContent = it.piece.name;
          floatEl._w = floatEl.offsetWidth || 150;
          floatEl._h = floatEl.offsetHeight || 40;
        }
        const fw = floatEl._w;
        const fh = floatEl._h;
        if (isMobile()) {
          // En el celular la tela mide unos pocos centímetros de pantalla: una barra encima del
          // molde taparía a los vecinos. Queda fija arriba a la derecha, en la franja libre que
          // hay entre la barra superior y la tela (al lado del HUD).
          if (!floatEl.classList.contains('docked') || floatEl._dockName !== it.piece.name) {
            floatEl.classList.add('docked');
            floatEl.classList.remove('below');
            floatEl._dockName = it.piece.name;
            floatEl._dw = floatEl.offsetWidth || 110;
            floatEl._dh = floatEl.offsetHeight || 64;
          }
          const top = hudR ? hudR.top : insets.top + 8;
          floatEl.style.transform = `translate(${Math.round(cw - 8)}px, ${Math.round(top)}px) translate(-100%, 0)`;
          avoid.push({ left: cw - 8 - floatEl._dw, right: cw - 8, top, bottom: top + floatEl._dh });
        } else {
          if (floatEl.classList.contains('docked')) {
            floatEl.classList.remove('docked');
            floatEl._dockName = null;
            floatEl._w = 0;
          }
          // arriba del molde; si ahí lo tapa la barra o el HUD, abajo
          let y = pTop.y - 14;
          let below = false;
          const hud = hudR;
          const blocked = y - fh < insets.top + 4 || (hud && pTop.x - fw / 2 < hud.right && pTop.x + fw / 2 > hud.left && y - fh < hud.bottom);
          if (blocked) {
            const pBot = toScreen(it.vis.x, it.vis.z + b.maxZ, 0.01);
            y = pBot.y + 14;
            below = true;
          }
          floatEl.classList.toggle('below', below);
          const x = clamp(pTop.x, fw / 2 + 4, cw - insets.right - fw / 2 - 4);
          floatEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, ${below ? '0' : '-100%'})`;
          avoid.push({ left: x - fw / 2, right: x + fw / 2, top: below ? y : y - fh, bottom: below ? y + fh : y });
        }
      } else floatEl.classList.remove('show');

      const put = (el, p, show = true) => {
        if (!show || p.behind) {
          el.style.display = 'none';
          return;
        }
        el.style.display = '';
        if (!el._w) {
          el._w = el.offsetWidth;
          el._h = el.offsetHeight;
        }
        const hw = (el._w || 80) / 2 + 4;
        const hh = (el._h || 20) / 2 + 4;
        const hits = (a, y) => p.x + hw > a.left && p.x - hw < a.right && y + hh > a.top && y - hh < a.bottom;
        // debajo del HUD: se corre un poco hacia abajo (sobre la tela) en vez de desaparecer
        let y = p.y;
        if (hudR && hits(hudR, y)) y = hudR.bottom + hh;
        // si cae encima de la indicación o de la barra flotante, mejor no mostrarla
        if (avoid.some((a) => hits(a, y))) {
          el.style.display = 'none';
          return;
        }
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      };
      const lx = 1.3;
      const len = table.shownLength;
      const lp = len && phase === 'layout' ? toScreen(Math.min(len, L - 0.06), -0.03) : null;
      const sp0 = toScreen(lx, -0.03);
      put(selLabels[0], sp0, phase !== 'done' && !(lp && Math.abs(lp.x - sp0.x) < 150));
      put(selLabels[1], toScreen(L - 0.22, W + 0.032), phase !== 'done');
      if (lp) {
        const txt = `✂ <b>${mTxt(len)} m</b>`;
        if (lenLabel.innerHTML !== txt) {
          lenLabel.innerHTML = txt;
          lenLabel._w = 0;
        }
        put(lenLabel, lp);
      } else lenLabel.style.display = 'none';
    }

    // ---------------- acomodo automático ----------------
    function applyLayout(target, { stagger = 0.07, dur = 0.55 } = {}) {
      let i = 0;
      for (const pl of target.placements) {
        const it = items.get(pl.id);
        if (!it) continue;
        const from = it.placed ? { x: it.vis.x, z: it.vis.z, rot: it.vis.rot, lift: it.vis.lift } : { x: L + 0.4, z: pl.z, rot: 0, lift: 0.08 };
        // mientras espera su turno (delay) el molde se queda donde arranca su vuelo, fuera de la
        // tela, y no en su posición vieja (el centro de la tela para los que venían de la bandeja)
        Object.assign(it.vis, from, { opacity: 1 });
        it.placed = true;
        it.obj.group.visible = true;
        it.obj.setOpacity(1);
        it.pl.x = pl.x;
        it.pl.z = pl.z;
        it.pl.rot = normRot(pl.rot);
        it.tween = { from, to: { x: pl.x, z: pl.z, rot: it.pl.rot }, t: 0, dur, delay: i * stagger, arc: 0.05, sound: true };
        i++;
      }
      return whenSettled();
    }

    async function autoArrange() {
      if (phase !== 'layout' || arranging || confirming) return;
      arranging = true;
      usedAuto = true;
      selected = null;
      ui.enableAction('acomodar', false);
      ui.enableAction('tizar', false);
      const done = applyLayout(autoRef);
      refresh(false);
      await done;
      arranging = false;
      if (!ctx.alive || phase !== 'layout') return;
      ui.enableAction('acomodar', true);
      refresh(true);
      ui.toast(`🧩 Acomodo por columnas: ${pctTxt(autoRef.efficiency)} de aprovechamiento. ¿Le ganás encastrando a mano?`, 'info', 3600);
    }

    // ---------------- tizado (la tiza recorre los contornos) ----------------
    async function moveChalk(from, to, dur, arc = 0.06, extra = null) {
      const p0 = from.clone();
      await tweenP(dur, (k) => {
        const e = easeInOutCubic(k);
        tmpV.lerpVectors(p0, to, e);
        tmpV.y += arc * Math.sin(Math.PI * k);
        chalk.position.copy(tmpV);
        if (extra) extra(e);
      });
    }

    async function chalkPiece(it) {
      const piece = it.piece;
      const pts0 = placedOutline(piece, it.pl);
      const closed = resamplePolyline([...pts0.map((p) => ({ x: p.x, y: p.z })), { x: pts0[0].x, y: pts0[0].z }], 0.005, false).map((p) => ({ x: p.x, z: p.y }));
      if (closed.length > 2) closed.pop();
      // empezar por el punto más cercano a la tiza
      const cur = worldToFabric(chalk.position.x, chalk.position.z);
      let si = 0;
      let sd = Infinity;
      closed.forEach((p, i) => {
        const d = (p.x - cur.x) ** 2 + (p.z - cur.z) ** 2;
        if (d < sd) {
          sd = d;
          si = i;
        }
      });
      const pts = closed.slice(si).concat(closed.slice(0, si));
      const cum = [0];
      for (let i = 1; i <= pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i % pts.length];
        cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
      }
      const total = cum[cum.length - 1];
      await moveChalk(chalk.position, worldOf(pts[0].x, pts[0].z, 0.001), 0.32, 0.07);
      if (!ctx.alive) return;
      const line = table.addChalkLine(pts, { offset: 0.0022 });
      let seg = 0;
      let sndT = 0;
      const speed = 1.45;
      await tweenP(total / speed, (k, sdt) => {
        const s = k * total;
        while (seg < pts.length - 1 && cum[seg + 1] < s) seg++;
        const a = pts[seg];
        const b = pts[(seg + 1) % pts.length];
        const f = clamp((s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]));
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        chalk.position.copy(worldOf(x, z, 0.001));
        const head = Math.atan2(-(b.z - a.z), b.x - a.x);
        chalk.rotation.set(CHALK_TILT, chalk.rotation.y + wrapPi(head - chalk.rotation.y) * 0.35, 0);
        line.setProgress(k);
        if (pauseAt && table.chalkLines.length >= pauseAt.lines && k >= pauseAt.k) {
          pauseAt = null;
          timeScale = 0; // pausa de prueba (_test.pauseAt); se reanuda con _test.speed()
          document.body.dataset.tizPaused = '1';
        }
        table.puff(x, z, 1);
        sndT += sdt;
        if (sndT > 0.055) {
          sndT = 0;
          audio.play('chalk');
        }
      });
      line.setProgress(1);
      if (!ctx.alive) return;
      // piquetes: marquitas hacia adentro
      const notches = placedOutline(piece, it.pl, 'notches');
      for (const n of notches) {
        const dx = it.pl.x - n.x;
        const dz = it.pl.z - n.z;
        const l = Math.hypot(dx, dz) || 1;
        table.addChalkTick(n, { x: n.x + (dx / l) * 0.012, z: n.z + (dz / l) * 0.012 });
      }
      if (notches.length) audio.play('chalk');
      // levantar el molde de papel (en paralelo con lo que sigue)
      it.lifting = true;
      const v = it.vis;
      const x0 = v.x;
      tweenP(0.55, (k) => {
        const e = easeInOutCubic(k);
        v.lift = 0.09 * e;
        v.x = x0 + 0.25 * e * e;
        v.opacity = 1 - e;
      }).then(() => {
        it.obj.group.visible = false;
      });
      audio.play('cut');
    }

    async function tizar(auto) {
      if (phase !== 'layout' || arranging || confirming) return;
      const pls = placements();
      if (pls.length !== order.length) return;
      const ev = evaluateLayout(pattern, pls);
      if (ev.overlaps.length || ev.outside.length) {
        ui.toast('Hay moldes que se pisan o salen de la tela.', 'bad');
        refresh(true);
        return;
      }
      const wrong = pls.filter((p) => !isGrainOk(p.rot));
      if (wrong.length && !auto) {
        // Mientras el diálogo está abierto no se puede abrir otro: el botón Tizar enfocado
        // recibiría el Enter con el que se quiere responder. El foco va a "Corregir".
        confirming = true;
        ui.enableAction('tizar', false);
        document.activeElement?.blur?.();
        const asked = ui.modal({
          title: '¿Tizar con el hilo cruzado?',
          body: h(
            'div',
            {},
            h('p', { html: `${wrong.length === 1 ? 'Un molde tiene' : `${wrong.length} moldes tienen`} la <b>flecha de hilo cruzada</b>: ${wrong.map((p) => `<b>${pieceName(p.id)}</b>`).join(', ')}.` }),
            h('p', { html: 'Cortada así, la pieza estira para el lado equivocado y la remera se tuerce al lavarla. Cada una resta <b>15 puntos</b>.' }),
          ),
          actions: [
            { id: 'fix', label: 'Corregir', kind: 'secondary' },
            { id: 'go', label: 'Tizar igual', kind: 'primary' },
          ],
        });
        const wraps = document.querySelectorAll('#modal-root .modal-wrap');
        wraps[wraps.length - 1]?.querySelector('.modal-foot .btn')?.focus({ preventScroll: true });
        let r = null;
        try {
          r = await asked;
        } finally {
          confirming = false;
        }
        if (!ctx.alive) return;
        if (r !== 'go' || phase !== 'layout') {
          if (phase === 'layout') {
            // Corregir: queda elegido el primer molde con el hilo cruzado, listo para girarlo
            const first = wrong.find((p) => items.get(p.id)?.placed);
            if (first) {
              selected = first.id;
              bringToTop(first.id);
            }
            refresh(true);
          }
          return;
        }
      }
      phase = 'chalk';
      speedMul = auto ? 2.6 : 1;
      selected = null;
      hover = null;
      drag = null;
      canvas.style.cursor = '';
      refreshStates();
      ui.enableAction('tizar', false);
      ui.enableAction('acomodar', false);
      ui.enableAction('auto', false);
      for (const { card } of cards.values()) card.disabled = true;
      floatEl.classList.remove('show');
      ui.hint(isMobile() ? '🖍️ Tizando… tocá la pantalla para acelerar' : '🖍️ Tizando los contornos… clic o <kbd>Espacio</kbd> para acelerar');
      q('.tiz-hud-status').className = 'tiz-hud-status';
      q('.tiz-hud-status').textContent = '🖍️ Tizando…';
      table.setOverlap(null);
      // por si algún molde todavía se está acomodando (el imán al soltar): la tiza arranca con todos apoyados
      await whenSettled();
      if (!ctx.alive) return;
      // orden: de izquierda a derecha
      const seq = placedItems().sort((a, b) => a.pl.x - b.pl.x || a.pl.z - b.pl.z);
      if (chalk) {
        if (chalk.parent !== chalkRest.parent) chalkRest.parent?.add(chalk);
        chalk.visible = true;
        setChalkLook(true);
        // que se vea a esta distancia: ~40 px de tiza en pantalla (30 en el celular), sea cual sea la ventana
        chalkK = clamp((isMobile() ? 30 : 40) / (0.048 / metersPerPx()), 1.8, 3.6);
        chalkSize = 0.048 * chalkK;
        // inclinada sobre el filo, como se la sostiene: así desde arriba se ve la cara de la tiza
        chalk.rotation.order = 'YXZ';
        const ry = chalk.rotation.y;
        const rx0 = chalk.rotation.x;
        await moveChalk(chalk.position, worldOf(seq[0].pl.x, seq[0].pl.z, 0.05), 0.55, 0.12, (e) => {
          chalk.scale.copy(chalkRest.scale).multiplyScalar(1 + (chalkK - 1) * e);
          chalk.rotation.set(rx0 + (CHALK_TILT - rx0) * e, ry, 0);
        });
      }
      let n = 0;
      for (const it of seq) {
        if (!ctx.alive) return;
        n++;
        q('.tiz-hud-status').textContent = `🖍️ Tizando ${it.piece.name.toLowerCase()} (${n}/${seq.length})`;
        if (chalk) await chalkPiece(it);
      }
      if (!ctx.alive) return;
      if (chalk) {
        const r0 = chalk.rotation.clone();
        const r1 = chalkRest.rotation;
        await moveChalk(chalk.position, chalkRest.position, 0.6, 0.12, (e) => {
          chalk.scale.copy(chalkRest.scale).multiplyScalar(chalkK + (1 - chalkK) * e);
          chalk.rotation.set(r0.x + (r1.x - r0.x) * e, r0.y + wrapPi(r1.y - r0.y) * e, r0.z + (r1.z - r0.z) * e);
        });
        chalk.rotation.copy(chalkRest.rotation);
        chalk.scale.copy(chalkRest.scale);
        chalkSize = 0;
        setChalkLook(false);
      }
      if (!ctx.alive) return;
      phase = 'done';
      ui.hint(null);
      finish(auto);
    }

    async function finish(auto) {
      const pls = placements();
      const { ev, grainWrong } = storeLayout(state, pattern, pls);
      const fabricLength = state.layout.fabricLength;
      const selvedge = [...analyze(pieceMap, pls).flags.entries()].filter(([, f]) => f.selvedge).map(([id]) => id);
      state.layout.selvedge = selvedge;
      state.layout.usedAuto = usedAuto || auto;
      addFabricCosts(ctx, fabric, fabricLength, pattern);
      const { score, notes } = scoreLayout({ efficiency: ev.efficiency, fabricLength, grainWrong, selvedge }, { ref, autoRef, usedAuto, auto, fabric, state, pattern, pieceName, selvedgeForced });
      // récord personal: solo cuentan los acomodos hechos (o mejorados) a mano y con el hilo derecho
      const ownWork = !auto && !(usedAuto && autoRef && ev.efficiency <= autoRef.efficiency + 0.005) && !grainWrong.length;
      if (ownWork && (!personalBest || ev.efficiency > personalBest + 0.0005)) {
        if (personalBest) notes.splice(1, 0, `🏆 <b>¡Nuevo récord personal</b> para este molde! Antes tu mejor tizado aprovechaba el ${pctTxt(personalBest)}.`);
        try {
          localStorage.setItem(bestKey, String(Math.round(ev.efficiency * 1000) / 1000));
        } catch (e) {
          /* sin storage: no se guarda el récord */
        }
      }
      const extra = h(
        'div',
        { class: 'tiz-result' },
        layoutMap(pattern, pls, { fabricLength, fabricHex: state.fabric.color, chalkHex: table.chalkHex, badIds: grainWrong }),
        h(
          'div',
          { class: 'tiz-result-stats' },
          h('span', {}, h('b', {}, pctTxt(ev.efficiency)), ' aprovechado'),
          h('span', {}, h('b', {}, `${mTxt(fabricLength)} m`), ' de tela'),
          h('span', {}, h('b', {}, money(Math.round(fabricLength * fabric.pricePerMeter))), ' en tela'),
        ),
      );
      audio.play(score >= 75 ? 'fanfare' : 'select');
      q('.tiz-hud-status').className = 'tiz-hud-status good';
      q('.tiz-hud-status').textContent = '✓ ¡Moldes tizados!';
      await new Promise((r) => ctx.timeout(r, 650));
      if (!ctx.alive) return;
      await ctx.complete({ score, notes, extra });
    }

    async function autoComplete() {
      if (phase !== 'layout' || confirming) return;
      phase = 'arranging';
      arranging = true;
      ui.enableAction('tizar', false);
      ui.enableAction('acomodar', false);
      ui.enableAction('auto', false);
      selected = null;
      hover = null;
      drag = null;
      pendingCard = null;
      ghost.classList.remove('show');
      canvas.style.cursor = '';
      const done = applyLayout(autoRef, { stagger: 0.05, dur: 0.4 });
      refresh(false); // fase 'arranging': Tizar sigue deshabilitado mientras vuelan
      await done;
      if (!ctx.alive) return;
      arranging = false;
      phase = 'layout';
      refresh(true);
      await tizar(true);
    }

    // ganchos para pruebas automáticas (window.__taller.step._test)
    const step = this;
    const testApi = {
      speed(k = 1) {
        timeScale = Math.max(0.1, +k || 1);
        delete document.body.dataset.tizPaused;
        return timeScale;
      },
      // congela la animación cuando la tiza va por la línea n (1 = primera pieza) al k (0..1) del recorrido
      pauseAt(lines = 1, k = 0.5) {
        pauseAt = { lines, k };
        return true;
      },
      get paused() {
        return timeScale === 0;
      },
      // salta el vuelo de cámara (el render por software va a ~1 fps)
      skipFlight() {
        flightId++;
        engine.flyTo({ ...view, duration: 0 });
        setNear(nearFor(view));
        return true;
      },
      info() {
        const pls = placements();
        return {
          phase,
          selected,
          valid: !ui.action('tizar')?.disabled,
          efficiency: an ? Math.round(an.efficiency * 1000) / 1000 : 0,
          placements: pls.map((p) => ({ id: p.id, x: round3(p.x), z: round3(p.z), rot: round3(normRot(p.rot)), grainOk: isGrainOk(p.rot), ...(an?.flags.get(p.id) ? { overlap: an.flags.get(p.id).overlap, outside: an.flags.get(p.id).outside, selvedge: an.flags.get(p.id).selvedge } : {}) })),
          chalk: chalk ? chalk.position.toArray().map(round3) : null,
          chalkLines: table.chalkLines.length,
        };
      },
      // centro en pantalla (px) de un punto de la tela o de un molde ubicado
      toScreen(x, z) {
        const p = toScreen(x, z);
        return [Math.round(p.x), Math.round(p.y)];
      },
      pieceScreen(id) {
        const it = items.get(id);
        return it ? testApi.toScreen(it.vis.x, it.vis.z) : null;
      },
      cardScreen(id) {
        const r = cards.get(id)?.card.getBoundingClientRect();
        return r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null;
      },
      refLayout: () => ({ ref: ref?.efficiency, auto: autoRef?.efficiency, target: targetEff }),
      refPlacements: () => (ref?.placements || []).map((p) => ({ ...p })),
      // ubica un molde directo (para armar escenas de prueba); rot en radianes
      place(id, x, z, rot = HALF_PI, { select: sel = false } = {}) {
        const it = items.get(id);
        if (!it || phase !== 'layout') return false;
        it.placed = true;
        it.tween = null;
        it.pl.x = it.vis.x = x;
        it.pl.z = it.vis.z = z;
        it.pl.rot = it.vis.rot = normRot(rot);
        it.vis.lift = 0;
        it.obj.setOpacity(1);
        it.obj.group.visible = true;
        bringToTop(id);
        if (sel) selected = id;
        refresh(true);
        return true;
      },
    };
    step._test = testApi;
    ctx.track(() => {
      if (step._test === testApi) delete step._test;
      delete document.body.dataset.tizPaused;
    });

    // estado inicial
    refresh(true);
  },
};
