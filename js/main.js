// Punto de entrada: arma el motor, el taller, la remera y recorre los pasos del proceso.

import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { ui, h } from './core/ui.js';
import { audio } from './core/audio.js';
import { state, bus, resetState, addCost, removeCost, totalCost } from './core/state.js';
import { disposeObject, money } from './core/utils.js';
import * as catalog from './data/catalog.js';
import { STATIONS } from './data/stations.js';
import { createWorkshop } from './world/workshop.js';
import { createPattern } from './shirt/pattern.js';
import { Shirt3D } from './shirt/shirt3d.js';
import { STEPS } from './steps/index.js';
import { preloadWeavesIdle } from './materials/fabric.js';

const params = new URLSearchParams(location.search);

let engine;
let world;
let shirt;
let currentIndex = -1;
let currentStep = null;
let currentScope = null;
let transitioning = false;
let patternCache = { key: null, pattern: null };

// ---------- Alcance por paso: todo lo registrado acá se limpia al salir del paso ----------
function createScope() {
  const disposers = [];
  const objects = [];
  return {
    alive: true,
    track(fn) {
      disposers.push(fn);
      return fn;
    },
    addObject(obj) {
      objects.push(obj);
    },
    dispose() {
      this.alive = false;
      for (const fn of disposers.splice(0).reverse()) {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
      }
      for (const o of objects.splice(0)) disposeObject(o);
    },
  };
}

function getPattern() {
  const p = state.pattern;
  const key = `${p.size}-${p.fit}-${p.sleeve}-${p.neck}`;
  if (patternCache.key !== key) patternCache = { key, pattern: createPattern({ ...p }) };
  return patternCache.pattern;
}

// Aplica tela, hilo y molde del estado a la remera 3D.
function updateShirt() {
  const pattern = getPattern();
  if (shirt.pattern !== pattern) shirt.setPattern(pattern);
  const fabric = catalog.fabricById(state.fabric.id);
  shirt.setFabric(fabric, state.fabric.color, !!state.fabric.heather);
  shirt.setThreadColor(state.thread.color);
}

// Ubica la remera en un lugar predefinido. where: 'preview' | 'exhibicion' | 'oculta'
function placeShirt(where = 'exhibicion', { inflation = 1, rotationY = 0 } = {}) {
  shirt.group.visible = where !== 'oculta';
  if (where === 'oculta') return shirt;
  if (shirt.group.parent !== engine.scene) engine.scene.add(shirt.group);
  shirt.group.rotation.set(0, rotationY, 0);
  shirt.group.scale.set(1, 1, 1);
  shirt.setInflation(inflation);
  shirt.setParts({ frente: true, espalda: true, mangas: true, cuello: true, ruedos: true });
  shirt.setSeams({ hombros: true, cuello: true, mangas: true, sisas: true, costados: true, punos: true, ruedo: true });
  let anchor;
  if (where === 'preview') anchor = world.props.mannequinPreview?.neckAnchor;
  else anchor = world.props.displayStand?.neckAnchor;
  if (!anchor) {
    const a = where === 'preview' ? STATIONS.materiales.preview : STATIONS.exhibicion.shirtNeck;
    anchor = new THREE.Vector3(a[0], where === 'preview' ? 1.45 : a[1], a[2]);
  }
  shirt.group.position.copy(anchor);
  return shirt;
}

function makeCtx(step, scope) {
  let completed = false;
  const ctx = {
    THREE,
    engine,
    scene: engine.scene,
    camera: engine.camera,
    ui,
    h,
    audio,
    state,
    bus,
    catalog,
    stations: STATIONS,
    world,
    shirt,
    step,
    get alive() {
      return scope.alive;
    },
    // ---- registro con limpieza automática ----
    track: (fn) => scope.track(fn),
    add(obj, parent = engine.scene) {
      parent.add(obj);
      scope.addObject(obj);
      return obj;
    },
    onUpdate(fn) {
      return scope.track(engine.onUpdate(fn));
    },
    onPointer(type, fn) {
      return scope.track(engine.onPointer(type, fn));
    },
    listen(target, evt, fn, opts) {
      target.addEventListener(evt, fn, opts);
      return scope.track(() => target.removeEventListener(evt, fn, opts));
    },
    timeout(fn, ms) {
      const id = setTimeout(() => scope.alive && fn(), ms);
      scope.track(() => clearTimeout(id));
      return id;
    },
    interval(fn, ms) {
      const id = setInterval(() => scope.alive && fn(), ms);
      scope.track(() => clearInterval(id));
      return id;
    },
    // ---- cámara ----
    flyTo(view, duration) {
      return engine.flyTo({ ...view, duration: duration ?? view.duration ?? 1.3 });
    },
    // ---- remera ----
    getPattern,
    updateShirt,
    placeShirt,
    // ---- costos ----
    addCost,
    removeCost,
    totalCost,
    // ---- flujo ----
    // Registra el puntaje del paso, muestra la tarjeta de resultado y avanza.
    async complete({ score = 0, notes = [], silent = false, extra = null } = {}) {
      if (completed || !scope.alive) return;
      completed = true;
      score = Math.max(0, Math.min(100, score));
      state.scores[step.id] = { score, notes, title: step.title };
      ui.setStepper(STEPS, currentIndex, state.scores);
      bus.emit('step:complete', { id: step.id, score });
      if (!silent) await ui.resultCard({ title: step.title, score, notes, extra });
      if (scope.alive) await goTo(currentIndex + 1);
    },
    next() {
      if (!scope.alive) return;
      return goTo(currentIndex + 1);
    },
    restart,
    goTo: (id) => goTo(typeof id === 'number' ? id : STEPS.findIndex((s) => s.id === id)),
  };
  return ctx;
}

async function goTo(index) {
  if (transitioning || index < 0 || index >= STEPS.length) return;
  transitioning = true;
  try {
    if (currentStep) {
      try {
        await currentStep.exit?.();
      } catch (e) {
        console.error(e);
      }
      currentScope.dispose();
    }
    ui.hud(null);
    ui.hint(null);
    engine.setOrbit({ enabled: false });
    shirt.group.visible = false;
    currentIndex = index;
    currentStep = STEPS[index];
    currentScope = createScope();
    ui.setStepper(STEPS, index, state.scores);
    renderTicket();
    const ctx = makeCtx(currentStep, currentScope);
    if (currentStep.update) ctx.onUpdate((dt, t) => currentStep.update(dt, t));
    transitioning = false;
    await currentStep.enter(ctx);
  } catch (e) {
    console.error(e);
    ui.toast('Ups, algo falló en este paso. Probá continuar.', 'bad', 5000);
  } finally {
    transitioning = false;
  }
}

async function restart() {
  resetState();
  for (const k of Object.keys(state.scores)) delete state.scores[k];
  if (shirt.clearScorches) shirt.clearScorches();
  shirt.setPrint?.('frente', null);
  shirt.setPrint?.('espalda', null);
  shirt.setWrinkles?.(0);
  shirt.resetWrinkleMask?.(1);
  shirt.setShrink?.(1, 1);
  shirt.setPrintWear?.({ fade: 0, crack: 0 });
  shirt.clearLooseThreads?.();
  updateShirt();
  ui.setCost(totalCost());
  await goTo(0);
}

// Completa el estado con valores razonables de los pasos previos (para ?step=...).
function fillDefaultsUpTo(index) {
  const fakeCtx = { state, catalog, getPattern, addCost, removeCost, shirt, world, updateShirt };
  for (let i = 0; i < index; i++) {
    const s = STEPS[i];
    try {
      s.defaults?.(state, fakeCtx);
    } catch (e) {
      console.error('defaults', s.id, e);
    }
    if (s.scored !== false && !state.scores[s.id]) state.scores[s.id] = { score: 75, notes: ['(paso salteado)'], title: s.title };
  }
}

// ---------- Ticket del pedido del cliente ----------
function renderTicket() {
  let el = document.getElementById('ticket');
  if (!state.order || currentStep?.id === 'inicio' || currentStep?.id === 'final') {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = h('div', { id: 'ticket', class: 'ticket', onClick: () => el.classList.toggle('open') });
    document.getElementById('app').appendChild(el);
  }
  const o = state.order;
  const r = o.req || {};
  const reqs = [];
  if (r.fabrics) reqs.push(`Tela: ${r.fabrics.map((id) => catalog.fabricById(id)?.short).join(' o ')}`);
  if (r.color) reqs.push(`Color: ${catalog.colorById(r.color)?.name}`);
  if (r.colors) reqs.push(`Color: ${r.colors.map((c) => catalog.colorById(c)?.name).join(' o ')}`);
  if (r.size) reqs.push(`Talle: ${r.size}`);
  if (r.fit) reqs.push(`Corte: ${catalog.fitById(r.fit)?.name}`);
  if (r.sleeve) reqs.push(catalog.sleeveById(r.sleeve)?.name);
  if (r.neck) reqs.push(catalog.neckById(r.neck)?.name);
  if (r.technique) reqs.push(`Estampa: ${catalog.techniqueById(r.technique)?.name}`);
  if (o.budget) reqs.push(`Presupuesto: ${money(o.budget)}`);
  el.innerHTML = '';
  el.appendChild(h('div', { class: 'ticket-head' }, h('span', { class: 'ticket-avatar' }, o.avatar), h('span', {}, h('b', {}, 'Pedido de ', o.name))));
  el.appendChild(h('div', { class: 'ticket-body' }, h('p', { class: 'ticket-quote' }, `“${o.text}”`), h('ul', {}, ...reqs.map((t) => h('li', {}, t)))));
}

function showHelp() {
  const step = currentStep;
  const body = h(
    'div',
    { class: 'help' },
    step?.help ? h('div', { class: 'help-step' }, h('h4', {}, `${step.icon || ''} ${step.title}`), h('div', { html: step.help })) : null,
    h(
      'div',
      { class: 'help-general' },
      h('h4', {}, 'Controles generales'),
      h(
        'ul',
        {},
        h('li', {}, 'Usá el panel de la derecha para elegir opciones y avanzar.'),
        h('li', {}, 'En los mini-juegos interactuás con el mouse (o el dedo) sobre la escena 3D.'),
        h('li', {}, 'Si un mini-juego se te complica, el botón “Hacerlo automático” lo resuelve con una nota promedio.'),
        h('li', {}, 'Cada paso suma puntos de calidad; al final ves la nota de tu remera y su precio sugerido.'),
      ),
    ),
  );
  ui.modal({ title: 'Cómo jugar', body, actions: [{ id: 'ok', label: 'Entendido', kind: 'primary' }] });
}

async function showMenu() {
  const id = await ui.modal({
    title: 'Menú',
    body: h('p', {}, '¿Qué querés hacer?'),
    actions: [
      { id: 'restart', label: '↺ Empezar una remera nueva', kind: 'danger' },
      { id: 'help', label: 'Cómo jugar', kind: 'secondary' },
      { id: 'close', label: 'Seguir jugando', kind: 'primary' },
    ],
  });
  if (id === 'restart') restart();
  if (id === 'help') showHelp();
}

async function boot() {
  ui.init();
  ui.loading('Preparando el taller…');
  engine = new Engine(document.getElementById('scene'));
  world = createWorkshop(engine);
  if (world.update) engine.onUpdate((dt, t) => world.update(dt, t));

  shirt = new Shirt3D({
    pattern: getPattern(),
    fabric: catalog.fabricById(state.fabric.id),
    color: state.fabric.color,
    heather: !!state.fabric.heather,
    threadColor: state.thread.color,
  });
  shirt.group.visible = false;
  engine.scene.add(shirt.group);
  if (shirt.update) engine.onUpdate((dt, t) => shirt.update(dt, t));

  ui.onLayout = (insets) => engine.setInsets(insets);
  bus.on('cost:change', (total) => ui.setCost(total));
  ui.setCost(totalCost());

  const muteBtn = document.getElementById('btn-mute');
  const renderMute = () => (muteBtn.textContent = audio.muted ? '🔇' : '🔊');
  renderMute();
  muteBtn.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    renderMute();
  });
  document.getElementById('btn-help').addEventListener('click', showHelp);
  document.getElementById('btn-menu').addEventListener('click', showMenu);
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  // Acceso para depuración y pruebas automáticas.
  window.__taller = { engine, world, shirt, state, STEPS, goTo: (id) => goTo(STEPS.findIndex((s) => s.id === id)), get step() {
    return currentStep;
  } };

  engine.flyTo({ ...STATIONS.entrada.view, duration: 0 });
  ui.loading(null);
  // Texturas completas de todas las telas y miniaturas, en segundo plano.
  setTimeout(() => preloadWeavesIdle?.().catch?.(() => {}), 600);

  const jump = params.get('step');
  const jumpIndex = jump ? STEPS.findIndex((s) => s.id === jump) : -1;
  if (jumpIndex > 0) {
    fillDefaultsUpTo(jumpIndex);
    updateShirt();
    ui.setCost(totalCost());
    await goTo(jumpIndex);
  } else {
    await goTo(0);
  }
}

boot().catch((e) => {
  console.error(e);
  ui.loading('No se pudo iniciar el taller. ¿Tu navegador soporta WebGL?');
});
