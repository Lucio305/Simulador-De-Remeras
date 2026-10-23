// Paso 7 · Coser a máquina.
// La remera se arma costura por costura (hombros → cuello → mangas/ribetes → costados → puños →
// ruedo). Para cada una se elige la puntada (el overlock se cose en su propia máquina) y se juega
// un mini-juego: pedal (clic sostenido / Espacio), guiar la tela por la línea de tiza (mouse/dedo o
// A/D ←→) y rematar al principio y al final (R). La aguja sube y baja con la máquina, la tela avanza a
// golpes con los dientes, quedan las puntadas del color del hilo y suena el motor.

import { createStrip, BEDS } from './costura/strip.js';
import { SewingSim, MACHINE_RATES } from './costura/sim.js';
import { createDiagram } from './costura/diagram.js';
import { createHud } from './costura/hud.js';
import {
  seamsFor, stitchById, idealStitch, bestStitches, stitchFit, settingsFit, seamScore, machineIssues, courseFor, machineFor,
  stitchMachineLabel, seamTip, seamDesc, stitchHint, OK, NO, MID, STITCHES, MACHINE,
} from './costura/rules.js';
import { fabricSwatch } from '../materials/fabric.js';
import { clamp, lerp, mixHex, hexToRgb, easeInOutCubic } from '../core/utils.js';
import { luminance } from '../data/catalog.js';

const PATH_LABEL = { recta: 'Tramo recto', curva: 'Tramo curvo', larga: 'Tramo largo' };
const PATH_SHORT = { recta: 'Recto', curva: 'Curvo', larga: 'Largo' };
const SHORT = { hombros: 'hombros', cuello: 'cuello', mangas: 'mangas', sisas: 'sisas', costados: 'costados', punos: 'puños', ruedo: 'ruedo' };
const mmTxt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const ART = { hombros: 'los hombros', cuello: 'el cuello', mangas: 'las mangas', sisas: 'las sisas', costados: 'los costados', punos: 'los puños', ruedo: 'el ruedo' };
const stName = (id) => stitchById(id).name.replace(' 4 hilos', '').toLowerCase();
const joinY = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);

// Miniaturas de cada puntada para los botones.
const STITCH_ICON = {
  recta: '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2 8h7M13 8h7M24 8h7M35 8h3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  zigzag: '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2 12 7 4 12 12 17 4 22 12 27 4 32 12 37 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  overlock: '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2 5h36" stroke="currentColor" stroke-width="1.6"/><path d="M3 5 7 13 9 5 13 13 15 5 19 13 21 5 25 13 27 5 31 13 33 5 37 13" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 13.5h36" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>',
  recubridora: '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2 5h6M12 5h6M22 5h6M32 5h6M2 11h6M12 11h6M22 11h6M32 11h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

function chalkFor(hex) {
  if (luminance(hex) < 0.45) return '#f2eee6';
  const { r, b } = hexToRgb(hex);
  return b > r + 20 ? '#c8402c' : '#2d5fc4';
}

// Hilo al tono de la tela: en la tira se lo dibuja apenas más oscuro (o más claro en telas oscuras)
// para que la puntada se lea, como se lee en la tela real por el brillo y la sombra del hilo.
function visibleThread(thread, fabric) {
  const a = hexToRgb(thread);
  const b = hexToRgb(fabric);
  const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  if (d > 70) return thread;
  const k = (1 - d / 70) * 0.3;
  return luminance(fabric) > 0.35 ? mixHex(thread, '#2b2420', k) : mixHex(thread, '#ffffff', k * 1.15);
}

// Muestra de puntada (SVG) según la puntada, el largo y la tensión.
function stitchSampleSVG({ stitchId, len, tension, fabricColor, threadColor }) {
  const W = 300;
  const H = 56;
  const ts = settingsFit(len, tension).tension.state;
  const px = 6.2; // px por mm
  const step = len * px;
  const y = 28;
  const amp = ts === 'high' ? 2.2 : 0;
  const wave = (x) => (amp ? Math.sin(x / 7) * amp : 0);
  let fabricPath = `M0 ${10 + wave(0)}`;
  for (let x = 0; x <= W; x += 6) fabricPath += ` L${x} ${(10 + wave(x)).toFixed(1)}`;
  for (let x = W; x >= 0; x -= 6) fabricPath += ` L${x} ${(H - 8 + wave(x) * 0.6).toFixed(1)}`;
  const thread = threadColor;
  const casing = luminance(threadColor) > 0.5 ? 'rgba(43,36,32,.55)' : 'rgba(255,255,255,.6)';
  let marks = '';
  const dash = (x1, y1, x2, y2, w = 2.2) => {
    marks += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${casing}" stroke-width="${w + 1.6}" stroke-linecap="round"/>`;
    marks += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${thread}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  const loop = (x, yy) => {
    if (ts !== 'low') return;
    marks += `<path d="M${(x - 2).toFixed(1)} ${yy} q 2 -6 4 0" fill="none" stroke="${thread}" stroke-width="1.4"/>`;
  };
  const g = 0.16 * step;
  if (stitchId === 'zigzag') {
    let prev = null;
    let s = 1;
    for (let x = 8; x <= W - 8; x += step) {
      const pt = [x, y + s * 6 + wave(x) * 0.8];
      if (prev) dash(prev[0], prev[1], pt[0], pt[1], 1.9);
      loop(x, pt[1]);
      prev = pt;
      s = -s;
    }
  } else if (stitchId === 'overlock') {
    for (let x = 8; x <= W - 8 - step; x += step) {
      dash(x, y - 6, x + step, y - 6, 1.6);
      dash(x, y - 1, x + step, y - 1, 1.6);
      dash(x, y - 6, x + step / 2, y + 12, 1.1);
      dash(x + step / 2, y + 12, x + step, y - 6, 1.1);
    }
  } else if (stitchId === 'recubridora') {
    for (let x = 8; x <= W - 8 - step; x += step) {
      dash(x + g, y - 6 + wave(x) * 0.8, x + step - g, y - 6 + wave(x + step) * 0.8);
      dash(x + g, y + 6 + wave(x) * 0.8, x + step - g, y + 6 + wave(x + step) * 0.8);
      loop(x, y - 6);
    }
  } else {
    for (let x = 8; x <= W - 8 - step; x += step) {
      dash(x + g, y + wave(x) * 0.8, x + step - g, y + wave(x + step) * 0.8);
      loop(x, y);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="cos-sample-svg" aria-hidden="true"><path d="${fabricPath} Z" fill="${fabricColor}" stroke="rgba(43,36,32,.22)"/>${marks}</svg>`;
}

export default {
  id: 'costura',
  title: 'Coser a máquina',
  short: 'Costura',
  icon: '🪡',
  scored: true,
  help: `<p>Armá la remera costura por costura. Antes de cada una elegí la <b>puntada</b> (el overlock se cose en su propia máquina) y revisá el <b>largo de puntada</b> y la <b>tensión</b>.</p>
<ul>
<li><b>Pedal:</b> mantené apretado el clic sobre la tela (o <span class="kbd">Espacio</span>). La velocidad sube de a poco; soltá para frenar.</li>
<li><b>Guiar la tela:</b> mientras apretás, mové el mouse (o el dedo) a los costados, o usá <span class="kbd">A</span> <span class="kbd">D</span> / <span class="kbd">←</span> <span class="kbd">→</span>. Que la aguja caiga sobre la línea de tiza: la guía láser roja muestra por dónde va a pasar.</li>
<li><b>En las curvas, aflojá el pedal:</b> a toda velocidad la mano no llega a acompañar la tela.</li>
<li><b>Remate:</b> al empezar, dá 2 o 3 puntadas, mantené <span class="kbd">R</span> (o el botón ⟲) mientras pisás para volver sobre ellas y seguí para adelante; al terminar, lo mismo. Así la costura no se descose. El overlock no lo necesita.</li>
<li>Regla de taller para remeras: puntada de <b>2,5 a 3,5 mm</b> y tensión <b>entre 3 y 5</b>.</li>
</ul>`,

  defaults(state, ctx) {
    const catalog = ctx.catalog;
    const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
    const seams = seamsFor(state.pattern);
    state.sewing = {
      seams: Object.fromEntries(seams.map((s) => [s.id, { score: 75, stitch: idealStitch(s, fabric), accuracy: 0.75 }])),
      stitchLength: 3,
      tension: 4,
    };
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, THREE, audio } = ctx;
    const self = this;
    const fabric = catalog.fabricById(state.fabric.id) || catalog.FABRICS[0];
    const fabricColor = state.fabric.color;
    const heather = !!state.fabric.heather;
    const threadColor = state.thread?.color || fabricColor;
    const threadId = state.thread?.id || 'poliester';
    const pattern = ctx.getPattern();
    const seams = seamsFor(state.pattern);
    const hasSleeves = state.pattern.sleeve !== 'sin';
    const issues = machineIssues(fabric, state.thread);
    const machine = world.props.sewingMachine;
    const ovl = world.props.overlock;
    const canvas = engine.canvas;
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    // textos de controles táctiles: celular, o tablet sin mouse (aunque tenga el layout de escritorio)
    const touchUI = () => isMobile() || window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    // ---------- estado del paso ----------
    // La máquina quedó como la dejó el último trabajo (un jean): hay que revisarla.
    const settings = { stitchLength: 4, tension: 7 };
    const choices = {};
    const results = {};
    let lastChoice = 'recta';
    let current = 0;
    let mode = 'overview'; // overview | intro | sewing | outro | auto | finished
    let busy = false;
    let finished = false;
    let usedAuto = false;
    let resews = 0;
    for (const s of seams) choices[s.id] = null;

    // ---------- máquinas ----------
    machine.setThreadColor(threadColor, threadId);
    ovl.setThreadColor(threadColor, threadId);
    machine.setLight(true);
    machine.setPresserFoot(false);
    machine.setSpeed(0);
    ovl.setSpeed(0);
    ctx.track(() => {
      machine.setSpeed(0);
      ovl.setSpeed(0);
      machine.setPresserFoot(true);
      machine.setLight(false);
    });
    const props = { maquina: machine, overlock: ovl };
    const makeFrame = (g) => {
      const fr = new THREE.Group();
      fr.name = 'costura-frame';
      g.updateMatrixWorld(true);
      g.matrixWorld.decompose(fr.position, fr.quaternion, fr.scale);
      fr.scale.set(1, 1, 1);
      return ctx.add(fr);
    };
    const frames = { maquina: makeFrame(machine.group), overlock: makeFrame(ovl.group) };
    for (const f of Object.values(frames)) f.updateMatrixWorld(true);

    // ---------- la remera se va armando en un maniquí al lado de la mesa ----------
    const dummy = world.props.mannequinPreview;
    const shirt = ctx.shirt;
    const DUMMY_POS = new THREE.Vector3(0.42, 0, -2.78);
    const DUMMY_RY = 0.3;
    if (dummy?.group) {
      const g = dummy.group;
      const pose = { p: g.position.clone(), r: g.rotation.clone(), s: g.scale.clone(), parent: g.parent, visible: g.visible };
      g.position.copy(DUMMY_POS);
      g.rotation.set(0, DUMMY_RY, 0);
      g.visible = true;
      ctx.track(() => {
        g.position.copy(pose.p);
        g.rotation.copy(pose.r);
        g.scale.copy(pose.s);
        if (pose.parent && g.parent !== pose.parent) pose.parent.add(g);
        g.visible = pose.visible;
      });
    }
    const neckY = dummy?.neckAnchor ? dummy.neckAnchor.y : 1.45;
    const seamDone = {};
    const shirtParts = () => ({
      frente: true,
      espalda: true,
      cuello: !!seamDone.cuello,
      mangas: hasSleeves && !!seamDone.mangas,
      ruedos: hasSleeves ? !!(seamDone.punos || seamDone.ruedo) : !!(seamDone.sisas || seamDone.ruedo),
    });
    if (shirt) {
      ctx.updateShirt();
      ctx.placeShirt('preview');
      shirt.group.position.set(DUMMY_POS.x, neckY, DUMMY_POS.z);
      shirt.group.rotation.set(0, DUMMY_RY, 0);
      shirt.setParts(shirtParts());
      shirt.setSeams({ hombros: 0, cuello: 0, mangas: 0, sisas: 0, costados: 0, punos: 0, ruedo: 0 });
      // si el paso siguiente no la vuelve a ubicar, que quede armada
      ctx.track(() => {
        shirt.setParts({ frente: true, espalda: true, mangas: true, cuello: true, ruedos: true });
        shirt.setSeams({ hombros: 1, cuello: 1, mangas: 1, sisas: 1, costados: 1, punos: 1, ruedo: 1 });
      });
    }
    // marca una costura como hecha en la remera 3D (con un pequeño "dibujado" de las puntadas)
    const seamAnims = [];
    function sewOnShirt(id, animate = true) {
      seamDone[id] = true;
      if (!shirt) return;
      shirt.setParts(shirtParts());
      // (las puntadas se "dibujan" mientras la cámara vuelve al maniquí)
      if (animate) seamAnims.push({ id, t: -0.3 });
      else shirt.setSeams({ [id]: 1 });
    }
    ctx.onUpdate((dt) => {
      if (!shirt || !seamAnims.length) return;
      for (const a of seamAnims) {
        a.t += dt;
        shirt.setSeams({ [a.id]: clamp((a.t - 0.5) / 1.1) });
      }
      for (let i = seamAnims.length - 1; i >= 0; i--) if (seamAnims[i].t > 1.7) seamAnims.splice(i, 1);
    });

    // ---------- audio ----------
    let loop = null;
    let loopV = -1;
    ctx.track(() => {
      if (loop) loop.stop();
      loop = null;
    });

    // ---------- cámara ----------
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    function overviewView() {
      // (en el celular la cámara es muy angosta: se aleja para que entren el maniquí y la máquina)
      if (isMobile()) return { position: [0.95, 1.78, 0.95], target: [0.95, 1.05, -2.55] };
      // en ventanas angostas el área libre (sin el panel) es casi cuadrada: alejarse un poco más
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      const freeW = W - ((ui.panelEl?.offsetWidth || 380) + 24);
      const aspect = freeW / Math.max(1, H - 58);
      const k = clamp(1.18 / Math.max(0.5, aspect), 1, 1.45);
      const t = [0.98, 1.0, -2.55];
      const d = [0, 0.58, 1.97];
      return { position: [t[0] + d[0] * k, t[1] + d[1] * k, t[2] + d[2] * k], target: t };
    }
    // Vista de quien cose, un poco desde la derecha: se ve la tiza que viene, la aguja y, por
    // debajo del brazo, la costura que va quedando atrás.
    function sewView(kind) {
      const fr = frames[kind];
      const bed = BEDS[kind];
      const mob = isMobile();
      const o = kind === 'overlock';
      const ov = self._test?.camOverride || {};
      // (el overlock tiene el cabezal y el brazo encima de la costura terminada: se lo mira desde la
      // izquierda y bien de arriba, así se ve la costura que sale por debajo del brazo)
      // (en el celular el cartel tapa la parte de arriba: la aguja va más abajo en la pantalla)
      const az = (ov.az ?? (o ? (mob ? -18 : -28) : mob ? 14 : 28)) * (Math.PI / 180);
      const el = (ov.el ?? (o ? (mob ? 60 : 54) : mob ? 57 : 41)) * (Math.PI / 180);
      const dist = ov.dist ?? (mob ? 0.5 : 0.38) * (o ? 1.04 : 1);
      const t = V(bed.needle[0] + (ov.dx ?? (o ? -0.014 : -0.012)), bed.top, bed.needle[2] + (ov.dz ?? (mob ? -0.022 : o ? 0.004 : 0.027)));
      const c = t.clone().add(V(dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az)));
      fr.updateMatrixWorld(true);
      return { position: fr.localToWorld(c).toArray(), target: fr.localToWorld(t).toArray() };
    }

    // Cámara de prueba con la misma proyección que va a tener la del motor en `view` (incluye el
    // corrimiento con el que el motor centra la escena en el área que no tapa el panel).
    const _cam = engine.camera.clone();
    const _tv = V(0, 0, 0);
    function viewCamera(view) {
      _cam.copy(engine.camera, false);
      ui._layout?.();
      const ins = engine._insetTarget || engine._inset || { right: 0, bottom: 0 };
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      _cam.aspect = W / H;
      if (ins.right > 0.5 || ins.bottom > 0.5) _cam.setViewOffset(W, H, ins.right / 2, ins.bottom / 2, W, H);
      else _cam.clearViewOffset();
      _cam.position.fromArray(view.position);
      _cam.up.set(0, 1, 0);
      _cam.lookAt(_tv.fromArray(view.target));
      _cam.updateMatrixWorld(true);
      _cam.updateProjectionMatrix();
      return { cam: _cam, W, H, ins };
    }
    const screenOf = (cam, W, H, p) => {
      const q = p.clone().project(cam);
      return { x: ((q.x + 1) / 2) * W, y: ((1 - q.y) / 2) * H };
    };

    // La vista de costura, corrida (sin girarla) para que el HUD no tape la aguja, el prensatelas ni
    // la costura que va saliendo: en pantallas angostas la aguja va a la derecha del HUD o por debajo.
    function sewViewFit(kind) {
      const view = sewView(kind);
      const hudEl = document.getElementById('hud');
      if (!hudEl || !hudEl.classList.contains('show')) return view;
      const hr = hudEl.getBoundingClientRect();
      const { cam, W, H, ins } = viewCamera(view);
      const bed = BEDS[kind];
      const needle = frames[kind].localToWorld(V(bed.needle[0], bed.top, bed.needle[2]));
      const s = screenOf(cam, W, H, needle);
      // lo que tiene que quedar a la vista alrededor de la aguja (px; la escena escala con el alto)
      const up = 0.11 * H;
      const side = 0.06 * H;
      const down = 0.05 * H;
      const freeR = W - ins.right;
      const freeB = H - ins.bottom;
      if (!(s.x - side < hr.right + 6 && s.y - up < hr.bottom + 6)) return view;
      let tx = s.x;
      let ty = s.y;
      const xNeed = hr.right + 6 + side;
      if (xNeed <= freeR - side * 1.2) tx = Math.max(s.x, xNeed);
      else ty = Math.max(s.y, hr.bottom + 6 + up);
      ty = Math.min(ty, freeB - down - 0.06 * H);
      tx = Math.min(tx, freeR - side);
      const pos = V(...view.position);
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
      const depth = needle.clone().sub(pos).dot(fwd);
      const wpp = (2 * depth * Math.tan((cam.fov * Math.PI) / 360)) / (cam.zoom * H);
      const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
      const upV = V(0, 1, 0).applyQuaternion(cam.quaternion);
      const d = right.multiplyScalar(-(tx - s.x) * wpp).add(upV.multiplyScalar((ty - s.y) * wpp));
      return { position: pos.add(d).toArray(), target: V(...view.target).add(d).toArray() };
    }
    ctx.flyTo(overviewView(), 1.3);
    let layoutMobile = isMobile();
    ctx.listen(window, 'resize', () => {
      if (isMobile() === layoutMobile) return;
      layoutMobile = isMobile();
      if (mode === 'overview' || mode === 'finished') ctx.flyTo(overviewView(), 0.6);
      else if (run) {
        const sv = sewViewFit(run.kind);
        run.camBase = V(...sv.position);
        ctx.flyTo(sv, 0.6);
      }
    });

    // ---------- tarjeta flotante de resultado de cada costura ----------
    const card = h('div', { class: 'cos-card' });
    document.getElementById('app').appendChild(card);
    ctx.track(() => card.remove());
    let cardTimer = null;
    function showCard(seam, r) {
      clearTimeout(cardTimer);
      const st = stitchById(r.stitch);
      const bar = (v) => `<span class="cos-card-bar"><i style="width:${Math.round(clamp(v) * 100)}%"></i></span>`;
      const remTxt = r.needsRemate ? `${r.remStart ? '✓' : '✗'} inicio · ${r.remEnd ? '✓' : '✗'} final` : 'no hace falta (overlock)';
      card.innerHTML = `
        <div class="cos-card-head"><span class="cos-card-ok">✓</span><b>${seam.name}</b><span class="cos-card-score">${r.score}</span></div>
        <div class="cos-card-stars">${ui.starsHTML(r.score)}</div>
        <div class="cos-card-rows">
          <span>Precisión</span>${bar(r.accuracy)}<em>${Math.round(r.accuracy * 100)} %</em>
          <span>Puntada</span>${bar(r.sf.pts / 25)}<em>${st.name.split(' ')[0]}</em>
          <span>Ajustes</span>${bar(r.st.pts / 15)}<em>${Math.round(r.st.pts)}/15</em>
        </div>
        <div class="cos-card-foot">Remate: ${remTxt}${r.meanErr ? ` · desvío medio ${mmTxt(r.meanErr)} mm` : ''}</div>`;
      card.classList.remove('show');
      void card.offsetWidth;
      placeCard();
      card.classList.add('show');
      cardTimer = setTimeout(() => card.classList.remove('show'), self._test?.cardMs || 8000);
    }
    // La tarjeta va donde no tape la remera del maniquí (ahí se "dibujan" las puntadas nuevas):
    // arriba o abajo a la izquierda, o al costado del maniquí, según cómo quede el encuadre.
    function placeCard() {
      const { cam, W, H, ins } = viewCamera(overviewView());
      const tb = document.getElementById('topbar')?.getBoundingClientRect().bottom || 56;
      const top = tb + 10;
      const freeR = W - ins.right - 8;
      const freeB = H - ins.bottom - 8;
      // contorno de la remera (coords de prenda) llevado al maniquí, más la etiqueta "Tu remera"
      const out = pattern.silhouette.front.outline;
      let mnx = Infinity;
      let mxx = -Infinity;
      let mny = Infinity;
      for (const q of out) {
        mnx = Math.min(mnx, q.x);
        mxx = Math.max(mxx, q.x);
        mny = Math.min(mny, q.y);
      }
      const cy = Math.cos(DUMMY_RY);
      const sy = Math.sin(DUMMY_RY);
      let l = Infinity;
      let r = -Infinity;
      let tp = Infinity;
      let bt = -Infinity;
      for (const x of [mnx, mxx]) {
        for (const y of [0.2, mny - 0.02]) {
          for (const z of [-0.13, 0.13]) {
            const p = V(DUMMY_POS.x + x * cy + z * sy, neckY + y, DUMMY_POS.z - x * sy + z * cy);
            const q = screenOf(cam, W, H, p);
            l = Math.min(l, q.x);
            r = Math.max(r, q.x);
            tp = Math.min(tp, q.y);
            bt = Math.max(bt, q.y);
          }
        }
      }
      const cw = card.offsetWidth || 270;
      const ch = card.offsetHeight || 170;
      // (sin pisar el cartel de abajo si está a la vista)
      const hint = document.getElementById('hint');
      const hintTop = hint?.classList.contains('show') ? hint.getBoundingClientRect().top - 10 : freeB - 50;
      const cands = [
        { x: 12, y: top },
        { x: 12, y: Math.min(freeB, hintTop) - ch },
        { x: r + 14, y: top + 44 },
        { x: l - 14 - cw, y: top + 44 },
        { x: freeR - cw, y: top },
        { x: freeR - cw, y: Math.min(freeB, hintTop) - ch },
      ];
      let best = cands[0];
      let bestCost = Infinity;
      for (const c of cands) {
        const outside = c.x < 6 || c.x + cw > freeR || c.y < top - 2 || c.y + ch > freeB;
        const ox = Math.max(0, Math.min(c.x + cw, r + 8) - Math.max(c.x, l - 8));
        const oy = Math.max(0, Math.min(c.y + ch, bt + 8) - Math.max(c.y, tp - 8));
        const cost = ox * oy + (outside ? 1e7 : 0);
        if (cost < bestCost - 1) {
          bestCost = cost;
          best = c;
        }
      }
      card.style.left = `${Math.round(best.x)}px`;
      card.style.top = `${Math.round(best.y)}px`;
    }
    ctx.track(() => clearTimeout(cardTimer));

    // ---------- etiquetas en la escena (vista general) ----------
    const mLabel = h('div', { class: 'world-label cos-mlabel' });
    const dLabel = h('div', { class: 'world-label cos-dlabel' }, 'Tu remera');
    mLabel.style.display = dLabel.style.display = 'none';
    document.getElementById('app').append(mLabel, dLabel);
    ctx.track(() => {
      mLabel.remove();
      dLabel.remove();
    });
    const _lp = new THREE.Vector3();
    const placeLabel = (el, p) => {
      const sp = engine.worldToScreen(p);
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      const off = sp.behind || sp.x < 0 || sp.x > W || sp.y < 40 || sp.y > H;
      el.style.display = off ? 'none' : '';
      el.style.left = `${sp.x}px`;
      el.style.top = `${sp.y}px`;
    };
    ctx.onUpdate(() => {
      const show = (mode === 'overview' || mode === 'finished') && !engine.flying;
      const sel = !finished && seams[current] ? choices[seams[current].id] : null;
      if (show && sel) {
        const kind = machineFor(sel);
        const txt = kind === 'overlock' ? '🧵 Overlock: se cose acá' : '🪡 Máquina recta: se cose acá';
        if (mLabel.textContent !== txt) mLabel.textContent = txt;
        if (kind === 'overlock') frames.overlock.localToWorld(_lp.set(BEDS.overlock.needle[0], 0.3, BEDS.overlock.needle[2]));
        else _lp.copy(machine.group.position).add(V(0.15, 0.36, 0));
        placeLabel(mLabel, _lp);
      } else mLabel.style.display = 'none';
      if (show && dummy?.group) {
        _lp.set(DUMMY_POS.x, neckY + 0.14, DUMMY_POS.z);
        placeLabel(dLabel, _lp);
      } else dLabel.style.display = 'none';
    });

    // ---------- panel ----------
    const kicker = 'Paso 7 · Máquina de coser';
    const markOf = (ok) => (ok === 'ok' ? '<i class="ok">✓</i>' : ok === 'no' ? '<i class="no">✗</i>' : '<i class="mid">!</i>');
    function summaryChips() {
      const thOk = issues.thread.goodFor.includes(fabric.id) ? 'ok' : 'no';
      const ndOk = fabric.knit ? (issues.needle === 'punta_bola' ? 'ok' : issues.needle === 'universal' ? 'mid' : 'no') : issues.needle === 'microtex' ? 'ok' : issues.needle === 'universal' ? 'mid' : 'no';
      return h(
        'div',
        { class: 'cos-summary' },
        h(
          'div',
          { class: 'cos-chip cos-chip-fabric' },
          h('span', { class: 'cos-chip-sw', style: { backgroundImage: `url(${fabricSwatch(fabric.id, fabricColor, 96, { heather })})` } }),
          h('span', { class: 'cos-chip-txt' }, h('b', {}, fabric.short), h('small', {}, fabric.knit ? 'de punto · estira' : 'plano · no estira')),
        ),
        h(
          'div',
          { class: 'cos-chip' },
          h('span', { class: 'cos-chip-spool', style: { '--thread': threadColor, '--thread-dark': mixHex(threadColor, '#000000', 0.35) } }),
          h('span', { class: 'cos-chip-txt', title: issues.thread.name, html: `<b>Hilo: ${issues.thread.name.split(' ')[0].toLowerCase()} ${markOf(thOk)}</b><small>aguja ${issues.needleName.replace(/\s*\(.*\)/, '').toLowerCase()} ${markOf(ndOk)}</small>` }),
        ),
      );
    }

    // ajustes de la máquina
    const lenStatus = h('div', { class: 'cos-set-status' });
    const tenStatus = h('div', { class: 'cos-set-status' });
    const sample = h('div', { class: 'cos-sample' });
    function renderSettingsStatus() {
      const f = settingsFit(settings.stitchLength, settings.tension);
      const [a, b] = MACHINE.stitchLength.ideal;
      const [c, d] = MACHINE.tension.ideal;
      const L = { ok: `✓ Justo para tejido de remera (${mmTxt(a)}–${mmTxt(b)} mm).`, short: '✗ Muy corta: cose lento, perfora de más y la costura puede fruncir.', long: '✗ Muy larga: la costura queda floja y se abre al estirar.' }[f.len.state];
      const T = { ok: `✓ Tensión pareja: el nudo queda en el medio de las capas (${c}–${d}).`, low: '✗ Floja: el hilo de arriba hace rulitos y la costura se abre.', high: '✗ Muy tirante: la costura frunce la tela y el hilo se puede cortar.' }[f.tension.state];
      lenStatus.textContent = L;
      lenStatus.className = `cos-set-status ${f.len.state === 'ok' ? 'ok' : 'bad'}`;
      tenStatus.textContent = T;
      tenStatus.className = `cos-set-status ${f.tension.state === 'ok' ? 'ok' : 'bad'}`;
      const wEl = document.querySelector('.cos-next-warn');
      if (wEl) {
        wEl.style.display = f.pts < 15 ? '' : 'none';
        wEl.textContent = `⚠ Ojo: la máquina está en ${mmTxt(settings.stitchLength)} mm y tensión ${settings.tension}. Revisá los ajustes ↓`;
      }
      const seam = seams[current];
      const stitchId = (seam && choices[seam.id]) || lastChoice;
      sample.innerHTML = `${stitchSampleSVG({ stitchId, len: settings.stitchLength, tension: settings.tension, fabricColor, threadColor })}<span class="cos-sample-lbl">Muestra · ${stitchById(stitchId).name.toLowerCase()}</span>`;
    }
    function settingsSection() {
      const sl = ui.slider({
        label: 'Largo de puntada',
        min: MACHINE.stitchLength.min,
        max: MACHINE.stitchLength.max,
        step: MACHINE.stitchLength.step,
        value: settings.stitchLength,
        format: (v) => `${mmTxt(v)} mm`,
        onInput: (v) => {
          settings.stitchLength = v;
          renderSettingsStatus();
        },
        onChange: () => audio.play('tick'),
      });
      const tn = ui.slider({
        label: 'Tensión del hilo',
        min: MACHINE.tension.min,
        max: MACHINE.tension.max,
        step: MACHINE.tension.step,
        value: settings.tension,
        format: (v) => `${v}`,
        onInput: (v) => {
          settings.tension = v;
          renderSettingsStatus();
        },
        onChange: () => audio.play('tick'),
      });
      sl.classList.add('cos-slider');
      tn.classList.add('cos-slider');
      renderSettingsStatus();
      settingsEl = ui.section('Ajustes de la máquina', h('p', { class: 'cos-small' }, 'La máquina quedó como la dejó el último trabajo (un jean). Revisala antes de coser.'), sl, lenStatus, tn, tenStatus, sample);
      return settingsEl;
    }
    let settingsEl = null;

    // diagrama + lista de costuras
    const diagram = createDiagram({ pattern, seams, fabricColor, threadColor });
    const listEl = h('ol', { class: 'cos-list' });
    function seamCourseLabel(seam) {
      const n = seam.pairs > 1 ? `${seam.pairs} en cadena` : '1 tramo';
      return `${PATH_SHORT[seam.path] || seam.path} · ${n}`;
    }
    function renderList() {
      listEl.innerHTML = '';
      seams.forEach((s, i) => {
        const r = results[s.id];
        const status = r ? 'done' : i === current ? 'current' : 'pending';
        const right = r ? h('span', { class: `cos-li-score ${r.score >= 75 ? 'good' : r.score >= 55 ? 'mid' : 'bad'}` }, String(r.score)) : i === current ? h('span', { class: 'cos-li-now' }, 'ahora') : h('span', { class: 'cos-li-pend' }, '—');
        const sub = r ? (r.auto ? `${stitchById(r.stitch).name.replace(' 4 hilos', '')} · automático` : stitchById(r.stitch).name) : seamCourseLabel(s);
        listEl.appendChild(h('li', { class: `cos-li ${status}` }, h('span', { class: 'cos-li-num' }, String(i + 1)), h('span', { class: 'cos-li-txt' }, h('b', {}, s.name), h('small', {}, sub)), right));
        diagram.set(s.id, { status: r ? 'done' : i === current && !finished ? 'current' : 'pending', progress: r ? 1 : 0 });
      });
    }

    function currentSeamBlock() {
      const seam = seams[current];
      const sel = choices[seam.id];
      const grid = ui.optionGrid({
        options: STITCHES.map((s) => ({
          id: s.id,
          label: s.name.replace(' 4 hilos', ''),
          sub: s.id === 'overlock' ? 'en el overlock' : s.id === 'recubridora' ? 'aguja doble' : s.id === 'zigzag' ? 'elástica' : 'pespunte',
          icon: '·',
          title: s.desc,
        })),
        value: sel,
        columns: 2,
        onChange: (id) => {
          choices[seam.id] = id;
          lastChoice = id;
          stDesc.innerHTML = `<b>${stitchById(id).name}.</b> ${stitchById(id).desc}${id === 'overlock' ? ' <em>Se cose en el overlock (la máquina de la derecha).</em>' : ''}`;
          renderSettingsStatus();
          updateActions();
        },
      });
      grid.classList.add('cos-stitches');
      for (const b of grid.querySelectorAll('.option')) {
        const ic = b.querySelector('.option-icon');
        if (ic) ic.innerHTML = STITCH_ICON[b.dataset.id] || '';
      }
      const stDesc = h('div', { class: 'cos-st-desc', html: sel ? `<b>${stitchById(sel).name}.</b> ${stitchById(sel).desc}` : `¿Qué puntada va? ${stitchHint(seam, fabric)}` });
      // aviso si la máquina sigue mal ajustada (lleva a la sección de ajustes)
      const fit = settingsFit(settings.stitchLength, settings.tension);
      const warn =
        fit.pts < 15
          ? h(
              'button',
              { class: 'cos-next-warn', type: 'button', onClick: () => settingsEl?.scrollIntoView({ block: 'center', behavior: 'smooth' }) },
              `⚠ Ojo: la máquina está en ${mmTxt(settings.stitchLength)} mm y tensión ${settings.tension}. Revisá los ajustes ↓`,
            )
          : null;
      return h(
        'div',
        { class: 'cos-next' },
        h('div', { class: 'cos-next-head' }, h('span', { class: 'cos-next-k' }, `Costura ${current + 1} de ${seams.length}`), h('span', { class: `cos-path ${seam.path}` }, PATH_LABEL[seam.path] || seam.path)),
        warn,
        h('div', { class: 'cos-next-name' }, seam.name),
        h('p', { class: 'cos-next-desc' }, `${seamDesc(seam, hasSleeves)} ${seam.pairs > 1 ? 'Son dos: van “en cadena”, una detrás de la otra.' : ''}`),
        h('div', { class: 'cos-next-lbl' }, 'Puntada'),
        grid,
        stDesc,
        h('div', { class: 'cos-tip', html: `💡 ${seamTip(seam.id, hasSleeves)}` }),
      );
    }

    function updateActions() {
      if (mode !== 'overview') return;
      if (finished) return;
      const seam = seams[current];
      const sel = choices[seam.id];
      ui.updateAction('go', { label: sel ? `🪡 Coser ${SHORT[seam.id] || 'esta costura'}` : 'Elegí la puntada', disabled: !sel });
    }

    function renderOverview() {
      mode = 'overview';
      const body = h('div', { class: 'cos-panel' }, summaryChips());
      if (!finished) {
        body.appendChild(currentSeamBlock());
        body.appendChild(settingsSection());
        body.appendChild(ui.section('Armado de la remera', h('div', { class: 'cos-build' }, h('div', { class: 'cos-diagram-wrap' }, diagram.el), listEl)));
      } else {
        body.appendChild(ui.section('Armado de la remera', h('div', { class: 'cos-build final' }, h('div', { class: 'cos-diagram-wrap' }, diagram.el), listEl)));
        body.appendChild(h('div', { class: 'cos-tip', html: '💡 Antes de planchar, cortá los hilos sueltos de las puntas y revisá que ninguna costura haya quedado floja.' }));
      }
      renderList();
      const done = Object.keys(results).length;
      ui.panel({
        kicker,
        title: 'Coser a máquina',
        subtitle: finished
          ? '¡Remera armada! Mirá cómo quedó cada costura.'
          : done
            ? `Vas ${done} de ${seams.length}. Elegí la puntada de la próxima costura.`
            : 'Armá la remera costura por costura: elegí la puntada, ajustá la máquina y guiá la tela por la línea de tiza.',
        body,
        actions: finished
          ? [{ id: 'fin', label: 'Ver el resultado →', kind: 'primary', onClick: () => finish() }]
          : [
              { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoAll() },
              { id: 'go', label: 'Elegí la puntada', kind: 'primary', disabled: true, onClick: () => startSeam() },
            ],
      });
      ui.panelEl.classList.remove('collapsed');
      ui.panelEl.classList.add('cos-step');
      updateActions();
      if (!finished) {
        ui.hint(touchUI() ? 'Elegí la puntada y revisá la máquina en el panel; después tocá “Coser”.' : 'Elegí la puntada y revisá los ajustes en el panel · <kbd>Enter</kbd> para empezar a coser');
        // en el celular el cartel tapa la escena: se va solo
        if (isMobile()) ctx.timeout(() => mode === 'overview' && ui.hint(null), 5000);
      } else ui.hint(null);
    }
    ctx.track(() => ui.panelEl?.classList.remove('cos-step', 'collapsed'));

    function renderAutoPanel() {
      const body = h(
        'div',
        { class: 'cos-panel auto' },
        summaryChips(),
        h(
          'div',
          { class: 'cos-auto-note' },
          h('span', { class: 'cos-auto-spin', 'aria-hidden': 'true' }),
          h('span', { class: 'cos-auto-txt', html: `<b>El taller está cosiendo en automático</b><small>Puntada ideal para cada costura · máquina en ${mmTxt(settings.stitchLength)} mm y tensión ${settings.tension}.</small>` }),
        ),
        ui.section('Armado de la remera', h('div', { class: 'cos-build' }, h('div', { class: 'cos-diagram-wrap' }, diagram.el), listEl)),
      );
      renderList();
      ui.panel({
        kicker,
        title: 'Coser a máquina',
        subtitle: 'Cosiendo en automático…',
        body,
        actions: [{ id: 'auto', label: '🪡 Cosiendo…', kind: 'auto', disabled: true }],
      });
      ui.panelEl.classList.remove('collapsed');
      ui.panelEl.classList.add('cos-step');
    }

    function renderSewingPanel() {
      const seam = seams[current];
      const st = stitchById(run.stitchId);
      const mobile = isMobile();
      const ctl = touchUI()
        ? [
            ['👆', '<b>Tocá y mantené</b> sobre la tela: es el pedal.'],
            ['↔️', '<b>Deslizá el dedo</b> a los costados para guiarla.'],
            ['⟲', run.needsRemate ? '<b>Remate:</b> mantené el botón ⟲ del cartel con otro dedo.' : 'El overlock no necesita remate.'],
          ]
        : [
            ['🖱️', '<b>Mantené el clic</b> (o <kbd>Espacio</kbd>): pedal.'],
            ['↔️', '<b>Mové el mouse</b> con el clic apretado (o <kbd>A</kbd> <kbd>D</kbd>) para guiar la tela.'],
            ['⟲', run.needsRemate ? '<b>Remate:</b> 2 o 3 puntadas con <kbd>R</kbd> apretada al empezar y al terminar.' : 'El overlock no necesita remate: la cadeneta se anuda sola.'],
          ];
      const body = h(
        'div',
        { class: 'cos-panel sewing' },
        h(
          'div',
          { class: 'cos-now' },
          h('span', { class: 'cos-now-icon', html: STITCH_ICON[run.stitchId] }),
          h('span', { class: 'cos-now-txt' }, h('b', {}, seam.name), h('small', {}, `${st.name} · ${run.kind === 'overlock' ? 'overlock' : 'máquina'} · ${mmTxt(settings.stitchLength)} mm · tensión ${settings.tension}`)),
        ),
        h('ul', { class: 'cos-controls' }, ...ctl.map(([i, t]) => h('li', {}, h('span', { class: 'cos-ctl-i' }, i), h('span', { html: t })))),
        h('div', { class: 'cos-tip', html: `💡 ${seamTip(seam.id, hasSleeves)}` }),
        ui.section('Armado', h('div', { class: 'cos-build compact' }, h('div', { class: 'cos-diagram-wrap' }, diagram.el))),
      );
      ui.panel({
        kicker,
        title: `Cosiendo: ${seam.name}`,
        subtitle: run.kind === 'overlock' ? 'En el overlock: une, remata y corta el sobrante en una sola pasada.' : 'Que la aguja caiga siempre sobre la línea de tiza.',
        body,
        actions: [
          { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoAll() },
          { id: 'undo', label: '✂ Descoser', kind: 'secondary', title: 'Descoser esta costura y volver a la mesa (para cambiar la puntada o los ajustes)', onClick: () => abortSeam() },
        ],
      });
      ui.panelEl.classList.add('cos-step');
      if (mobile) ui.panelEl.classList.add('collapsed');
      requestAnimationFrame(() => ui._layout?.());
    }

    // ---------- mini-juego ----------
    let run = null; // costura en curso
    const input = { keyPedal: false, ptrPedal: false, left: false, right: false, keyRev: false, btnRev: false, grabbing: false };
    const plane = new THREE.Plane(V(0, 1, 0), 0);
    const _w = V(0, 0, 0);

    function handX() {
      if (!run) return null;
      const fr = frames[run.kind];
      plane.constant = -(fr.position.y + BEDS[run.kind].top);
      const hit = engine.pointerOnPlane(plane, steer.ndc);
      if (!hit) return null;
      _w.copy(hit);
      fr.worldToLocal(_w);
      return _w.x;
    }

    function startSeam() {
      if (busy || mode !== 'overview' || finished) return;
      const seam = seams[current];
      const stitchId = choices[seam.id];
      if (!stitchId) {
        ui.toast('🧵 Elegí primero la puntada para esta costura.', 'warn');
        audio.play('bad');
        return;
      }
      document.activeElement?.blur?.();
      const kind = machineFor(stitchId);
      const course = courseFor(seam.id, { hasSleeves, fabric });
      const sfit = settingsFit(settings.stitchLength, settings.tension);
      const strip = createStrip({
        course,
        bed: BEDS[kind],
        fabric,
        color: fabricColor,
        heather,
        threadColor: visibleThread(threadColor, fabricColor),
        threadId,
        stitchId,
        thicknessId: state.thread?.thickness,
        tensionState: sfit.tension.state,
        pucker: (sfit.tension.state === 'high' ? 0.0007 : 0) + (sfit.len.state === 'short' ? 0.0004 : 0) + (fabric.knit && stitchId === 'recta' ? 0.0003 : 0),
        chalkColor: chalkFor(fabricColor),
      });
      frames[kind].add(strip.group);
      const sim = new SewingSim({ course, stitchId, stitchLength: settings.stitchLength, machine: kind, issues, seed: 11 + current * 7 + resews * 3 });
      const lines = stitchId === 'recubridora' ? [{ off: -0.002, last: null }, { off: 0.002, last: null }] : [{ off: 0, last: null }];
      run = { camBase: null, seam, stitchId, kind, course, strip, sim, lines, sfit, t: 0, needsRemate: stitchId !== 'overlock', warnedSpeed: 0, lastDiag: -1, ovl: { l: null, r: null } };
      mode = 'intro';
      if (kind === 'maquina') machine.setPresserFoot(false);
      strip.update(sim.p - 0.1, sim.fx, 0);
      card.classList.remove('show');
      renderSewingPanel();
      const hud = createHud({
        h,
        seam,
        index: current + 1,
        total: seams.length,
        stitchName: stitchById(stitchId).name.replace(' 4 hilos', ''),
        machineLabel: stitchMachineLabel(stitchId),
        maxPpm: MACHINE_RATES[kind] * 60,
        pieces: course.pieces,
        needsRemate: run.needsRemate,
        onRemate: (on) => (input.btnRev = on),
      });
      run.hud = hud;
      ui.hud(hud.el);
      // (con el HUD y el panel ya puestos se sabe qué parte de la pantalla queda libre)
      const sv = sewViewFit(kind);
      run.camBase = V(...sv.position);
      ctx.flyTo(sv, 1.1);
      run.hintOn = true;
      run.pedalT = 0;
      if (isMobile()) ctx.timeout(() => run && run.seam === seam && ui.hint(null), 4500);
      ui.hint(
        touchUI()
          ? 'Tocá y mantené sobre la tela para coser · deslizá el dedo para guiarla por la tiza'
          : `Mantené el <kbd>clic</kbd> o <kbd>Espacio</kbd> para coser · guiá con el mouse o <kbd>A</kbd> <kbd>D</kbd>${run.needsRemate ? ' · <kbd>R</kbd> remate' : ''}`,
      );
      canvas.style.cursor = 'grab';
      if (!loop) loop = audio.loop('sewing');
      diagram.set(seam.id, { status: 'sewing', progress: 0 });
    }

    function disposeRun() {
      if (!run) return;
      run.strip.dispose();
      props[run.kind].setSpeed(0);
      run = null;
      ui.hud(null);
      canvas.style.cursor = '';
      input.ptrPedal = input.keyPedal = input.grabbing = false;
      steer.id = null;
      if (loop) loop.set(0);
      loopV = 0;
    }

    function abortSeam() {
      if (!run || mode === 'outro') return;
      audio.play('snip');
      ui.toast('✂ Descosiste la costura: la tela vuelve a la mesa.', 'info');
      const seam = run.seam;
      disposeRun();
      resews++;
      machine.setPresserFoot(false);
      diagram.set(seam.id, { status: 'current', progress: 0 });
      ctx.flyTo(overviewView(), 1.0);
      renderOverview();
    }

    function addStitch(e) {
      const { strip, lines, stitchId } = run;
      if (e.broken) {
        for (const l of lines) l.last = null;
        run.ovl.l = run.ovl.r = null;
        audio.play('bad');
        ui.toast(issues.thread.id === 'rayon' ? '💥 ¡Se cortó el hilo! El rayón es para bordar: no aguanta. Enhebrando de nuevo…' : '💥 ¡Se cortó el hilo! Enhebrando de nuevo…', 'bad', 2600);
        return;
      }
      if (e.speed < 0.45) audio.play('tick');
      if (e.warn === 'off') ui.toast('¡Te saliste de la tela! La aguja cose en el aire: corré la tela → hasta la tiza.', 'bad', 1800);
      else if (e.warn === 'edge') ui.toast('¡Cuidado! La aguja se va del margen de costura.', 'warn', 1600);
      else if (e.warn === 'inside') ui.toast('¡Te metiste en la prenda! Volvé a la línea de tiza.', 'warn', 1600);
      if (e.skipped) return;
      if (e.offEdge) {
        // la aguja cae al costado del canto: no queda puntada y la costura se corta ahí
        for (const l of lines) l.last = null;
        run.ovl.l = run.ovl.r = null;
        return;
      }
      if (!e.onFabric) {
        // en el aire (entre tramos): el hilo hace la cadena, se dibuja al volver a la tela
        lines.forEach((l, i) => {
          if (i > 0) l.last = null;
        });
        // (la cadeneta del overlock no se dibuja: el primer punto de la pieza nueva arranca limpio)
        run.ovl.l = run.ovl.r = null;
        return;
      }
      if (stitchId === 'overlock') {
        const uL = e.u - 0.0018;
        const uR = e.u + 0.0018;
        const uE = e.u + 0.0043;
        const o = run.ovl;
        const r = strip.radius;
        if (o.l) {
          strip.dash(o.l.u, o.l.v, uL, e.v, { r: r * 0.95 });
          strip.dash(o.r.u, o.r.v, uR, e.v, { r: r * 0.95 });
          const vm = (o.l.v + e.v) / 2;
          strip.dash(o.l.u, o.l.v, uE, vm, { r: r * 0.8, shrink: 1, y: 0.0002 });
          strip.dash(uE, vm, uL, e.v, { r: r * 0.8, shrink: 1, y: 0.0002 });
        }
        o.l = { u: uL, v: e.v };
        o.r = { u: uR, v: e.v };
        strip.trimUpTo(e.v + 0.002, uE + 0.0003);
        return;
      }
      for (const l of lines) {
        let u = e.u + l.off;
        if (stitchId === 'zigzag') {
          run.zig = !run.zig;
          u += run.zig ? 0.0015 : -0.0015;
        }
        const pt = { u, v: e.v };
        if (l.last && Math.abs(l.last.v - pt.v) < 0.05) strip.dash(l.last.u, l.last.v, pt.u, pt.v, { shrink: stitchId === 'zigzag' ? 0.94 : 0.86 });
        l.last = pt;
      }
    }

    function remWindow(sim) {
      const p0 = run.course.pieces[0];
      const pl = run.course.pieces[run.course.pieces.length - 1];
      if (sim.p <= p0.a + 0.024) return 'start';
      if (sim.p >= pl.b - 0.024) return 'end';
      return null;
    }

    function endSeam() {
      const { seam, sim, stitchId, sfit } = run;
      mode = 'outro';
      run.t = 0;
      run.outFrom = { p: sim.p, fx: sim.fx };
      props[run.kind].setSpeed(0);
      if (loop) loop.set(0);
      loopV = 0;
      if (run.kind === 'maquina') machine.setPresserFoot(false);
      audio.play('thud');
      ctx.timeout(() => audio.play('snip'), 450);
      canvas.style.cursor = '';
      ui.hint(null);
      ui.enableAction('auto', false);
      ui.enableAction('undo', false);
      const acc = sim.accuracy();
      const sf = stitchFit(seam, stitchId, fabric);
      const needsRemate = run.needsRemate;
      const remStart = sim.revStart >= 2;
      const remEnd = sim.revEnd >= 2;
      const score = seamScore({ accuracy: acc, stitchPts: sf.pts, settingsPts: sfit.pts, remateStart: remStart, remateEnd: remEnd, needsRemate });
      results[seam.id] = { score, stitch: stitchId, accuracy: acc, meanErr: sim.meanErrMm(), remStart, remEnd, needsRemate, skips: sim.skips, breaks: sim.breaks, outs: sim.outs, time: sim.time, sf, st: sfit, used: { len: settings.stitchLength, tension: settings.tension }, len: run.course.end, auto: false };
      diagram.set(seam.id, { status: 'done', progress: 1 });
      audio.play(score >= 55 ? 'good' : 'bad');
    }

    function afterOutro() {
      const seam = run.seam;
      const r = results[seam.id];
      disposeRun();
      sewOnShirt(seam.id);
      current++;
      if (current >= seams.length) {
        finished = true;
        mode = 'finished';
        ctx.flyTo(overviewView(), 1.1);
        renderOverview();
        mode = 'finished';
        showCard(seam, r);
        audio.play('fanfare');
        ui.toast('🎉 ¡La remera está armada!', 'good', 3000);
      } else {
        const next = seams[current];
        if (!choices[next.id]) choices[next.id] = null;
        ctx.flyTo(overviewView(), 1.1);
        renderOverview();
        showCard(seam, r);
      }
    }

    // ---------- automático ----------
    async function autoAll() {
      if (busy || finished) return;
      busy = true;
      usedAuto = true;
      if (run) {
        const seam = run.seam;
        disposeRun();
        diagram.set(seam.id, { status: 'current', progress: 0 });
      }
      ctx.flyTo(overviewView(), 0.9);
      // el taller ajusta la máquina y cose solo: el panel muestra el avance, sin controles
      settings.stitchLength = 3;
      settings.tension = 4;
      mode = 'auto';
      renderAutoPanel();
      if (!loop) loop = audio.loop('sewing');
      ui.hint(null);
      const sfit = settingsFit(settings.stitchLength, settings.tension);
      for (let i = current; i < seams.length; i++) {
        const s = seams[i];
        const stitchId = idealStitch(s, fabric);
        choices[s.id] = stitchId;
        const sf = stitchFit(s, stitchId, fabric);
        const acc = 0.62 + ((i * 37) % 7) / 100;
        const sc = Math.min(70, seamScore({ accuracy: acc, stitchPts: sf.pts, settingsPts: sfit.pts, needsRemate: false }));
        results[s.id] = { score: sc, stitch: stitchId, accuracy: acc, meanErr: 0, remStart: true, remEnd: true, needsRemate: false, skips: 0, breaks: 0, outs: 0, time: 0, sf, st: sfit, len: courseFor(s.id, { hasSleeves, fabric }).end, auto: true };
        diagram.set(s.id, { status: 'sewing', progress: 0 });
        const kind = machineFor(stitchId);
        const t0 = performance.now();
        await new Promise((res) => {
          const off = ctx.onUpdate(() => {
            const k = clamp((performance.now() - t0) / 380);
            diagram.set(s.id, { progress: k });
            props[kind].setSpeed(k < 1 ? 0.8 : 0);
            if (loop) loop.set(k < 1 ? 0.7 : 0);
            if (k >= 1) {
              off();
              res();
            }
          });
        });
        if (!ctx.alive) return;
        diagram.set(s.id, { status: 'done', progress: 1 });
        sewOnShirt(s.id, false);
        audio.play('pop');
        if (i + 1 < seams.length) current = i + 1;
        renderList();
      }
      machine.setSpeed(0);
      ovl.setSpeed(0);
      if (loop) loop.set(0);
      current = seams.length;
      finished = true;
      busy = false;
      finish();
    }

    // ---------- final ----------
    let finishing = false;
    async function finish() {
      if (finishing) return;
      finishing = true;
      ui.enableAction('fin', false);
      const list = seams.map((s) => ({ seam: s, r: results[s.id] })).filter((x) => x.r);
      let wsum = 0;
      let ssum = 0;
      let asum = 0;
      for (const { r } of list) {
        const w = 0.5 + r.len;
        wsum += w;
        ssum += r.score * w;
        asum += r.accuracy * w;
      }
      const base = wsum ? ssum / wsum : 0;
      const accMean = wsum ? asum / wsum : 0;
      let score = Math.round(base - issues.penalty);
      const notes = [];
      const played = list.filter((x) => !x.r.auto);
      if (usedAuto) notes.push(`${MID} ${played.length ? `${list.length - played.length} costura${list.length - played.length === 1 ? '' : 's'} las cosió el taller en automático` : 'Cosido en automático por el taller'}: la próxima guiá vos la tela y sumá más puntos.`);
      if (played.length) {
        const errs = played.filter((x) => x.r.meanErr);
        const meanErr = errs.length ? errs.reduce((a, x) => a + x.r.meanErr, 0) / errs.length : 0;
        const pa = played.reduce((a, x) => a + x.r.accuracy, 0) / played.length;
        notes.push(`${pa >= 0.88 ? OK : pa >= 0.7 ? MID : NO} Precisión media <b>${Math.round(pa * 100)} %</b>${meanErr ? ` (desvío medio ${mmTxt(meanErr)} mm)` : ''}${pa >= 0.88 ? ': costuras derechitas sobre la tiza.' : pa >= 0.7 ? ': algunas costuras se fueron de la línea. En las curvas, aflojá el pedal.' : ': las costuras quedaron torcidas. Cosé más despacio y mirá la tiza delante del prensatelas.'}`);
      }
      // puntadas (solo las que eligió el jugador: las del automático las eligió el taller)
      const tejido = fabric.knit ? 'tejido de punto' : 'tejido plano';
      const kindsOf = (arr) => joinY([...new Set(arr.map((x) => stName(x.r.stitch)))]);
      const wrong = played.filter((x) => x.r.sf.pts < 25);
      if (!played.length) {
        notes.push(`💡 El taller usó las puntadas ideales para ${tejido}: ${kindsOf(list)}. La próxima elegilas vos.`);
      } else if (!wrong.length) {
        notes.push(`${OK} Puntadas bien elegidas para ${tejido}: ${kindsOf(played)}.`);
      } else {
        const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
        for (const { seam, r } of wrong.slice(0, 3)) notes.push(`${r.sf.ok === 'no' ? NO : MID} <b>${seam.name}</b>: ${lc(r.sf.note)} (${Math.round(r.sf.pts)}/25)`);
        // qué iba en cada una, agrupado por puntada ("recta en los hombros y el cuello")
        const groups = new Map();
        for (const { seam } of wrong) {
          const id = bestStitches(seam, fabric)[0];
          if (!groups.has(id)) groups.set(id, []);
          groups.get(id).push(ART[seam.id] || seam.name.toLowerCase());
        }
        notes.push(`💡 En ${fabric.short.toLowerCase()} lo ideal era ${[...groups].map(([id, where]) => `${stName(id)} en ${joinY(where)}`).join('; ')}.`);
      }
      // ajustes
      if (played.length) {
        const used = played[played.length - 1].r.used || { len: settings.stitchLength, tension: settings.tension };
        if (played.every((x) => x.r.st.pts >= 15)) notes.push(`${OK} Máquina bien ajustada: puntada de ${mmTxt(used.len)} mm y tensión ${used.tension}.`);
        else {
          const badR = played.find((x) => x.r.st.pts < 15).r;
          const bad = badR.st;
          const u = badR.used || used;
          const nBad = played.filter((x) => x.r.st.pts < 15).length;
          const cuantas = nBad === played.length ? '' : ` (en ${nBad} costura${nBad === 1 ? '' : 's'})`;
          if (bad.len.state === 'short') notes.push(`${NO} Puntada de ${mmTxt(u.len)} mm${cuantas}: muy corta, perfora de más el tejido y frunce. Para remeras, 2,5–3,5 mm.`);
          if (bad.len.state === 'long') notes.push(`${NO} Puntada de ${mmTxt(u.len)} mm${cuantas}: muy larga, la costura queda floja y se abre al estirar. Para remeras, 2,5–3,5 mm.`);
          if (bad.tension.state === 'high') notes.push(`${NO} Tensión ${u.tension}${cuantas}: muy alta, el hilo tironea y la costura frunce. Lo normal es 3–5.`);
          if (bad.tension.state === 'low') notes.push(`${NO} Tensión ${u.tension}${cuantas}: floja, quedan rulitos de hilo y la costura se abre. Lo normal es 3–5.`);
        }
        const missing = played.reduce((a, x) => a + (x.r.needsRemate ? (x.r.remStart ? 0 : 1) + (x.r.remEnd ? 0 : 1) : 0), 0);
        const needing = played.filter((x) => x.r.needsRemate).length;
        if (needing) {
          if (!missing) notes.push(`${OK} Remataste todas las puntas: esas costuras no se van a descoser.`);
          else notes.push(`${MID} Faltaron <b>${missing}</b> remate${missing === 1 ? '' : 's'} (−2 c/u): 2 o 3 puntadas para atrás al empezar y al terminar (tecla R) traban la costura.`);
        }
        const skips = played.reduce((a, x) => a + x.r.skips, 0);
        const breaks = played.reduce((a, x) => a + x.r.breaks, 0);
        if (breaks) notes.push(`${NO} Se cortó el hilo ${breaks} ${breaks === 1 ? 'vez' : 'veces'} mientras cosías.`);
        if (skips >= 3) notes.push(`${MID} Hubo <b>${skips}</b> puntadas salteadas: es la aguja.`);
      }
      for (const n of issues.notes) notes.push(n);
      if (played.length >= 2) {
        const sorted = played.slice().sort((a, b) => b.r.score - a.r.score);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        if (best.r.score - worst.r.score >= 6) notes.push(`Tu mejor costura: <b>${best.seam.name}</b> (${best.r.score}). La más floja: <b>${worst.seam.name}</b> (${worst.r.score}).`);
      }
      if (resews) notes.push(`Descosiste y repetiste ${resews} ${resews === 1 ? 'vez' : 'veces'}: el descosedor también es parte del oficio.`);
      score = clamp(score, 0, 100);
      state.sewing = {
        seams: Object.fromEntries(list.map(({ seam, r }) => [seam.id, { score: r.score, stitch: r.stitch, accuracy: Math.round(r.accuracy * 1000) / 1000 }])),
        stitchLength: settings.stitchLength,
        tension: settings.tension,
        accuracy: Math.round(accMean * 1000) / 1000,
        auto: usedAuto,
      };
      seamAnims.length = 0;
      if (shirt) {
        shirt.setParts({ frente: true, espalda: true, mangas: true, cuello: true, ruedos: true });
        shirt.setSeams({ hombros: 1, cuello: 1, mangas: 1, sisas: 1, costados: 1, punos: 1, ruedo: 1 });
      }
      // tarjeta: diagrama terminado + nota por costura
      const dgDone = createDiagram({ pattern, seams, fabricColor, threadColor, compact: true });
      for (const s of seams) dgDone.set(s.id, { status: results[s.id] ? 'done' : 'pending', progress: results[s.id] ? 1 : 0 });
      const extra = h(
        'div',
        { class: 'cos-result' },
        h('div', { class: 'cos-result-dg' }, dgDone.el),
        h('ul', { class: 'cos-result-list' }, ...list.map(({ seam, r }) => h('li', {}, h('span', {}, seam.name), h('b', { class: r.score >= 75 ? 'good' : r.score >= 55 ? 'mid' : 'bad' }, String(r.score))))),
      );
      card.classList.remove('show');
      await ctx.complete({ score, notes, extra });
    }

    // ---------- entrada ----------
    // Un dedo (o el mouse) sobre la tela es el pedal y la mano que guía; se sigue SOLO ese puntero,
    // así en el celular se puede mantener el botón de remate con otro dedo.
    const steer = { id: null, ndc: new THREE.Vector2() };
    const setNdc = (e) => {
      const r = canvas.getBoundingClientRect();
      steer.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const releaseSteer = () => {
      steer.id = null;
      input.ptrPedal = false;
      if (input.grabbing && run) run.sim.release();
      input.grabbing = false;
      if (run && (mode === 'sewing' || mode === 'intro')) canvas.style.cursor = 'grab';
    };
    ctx.listen(canvas, 'pointerdown', (e) => {
      if (!run || (mode !== 'sewing' && mode !== 'intro')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (steer.id !== null) return;
      steer.id = e.pointerId;
      setNdc(e);
      input.ptrPedal = true;
      input.grabbing = true;
      run.grabPending = true;
      canvas.style.cursor = 'grabbing';
    });
    ctx.listen(window, 'pointermove', (e) => {
      if (e.pointerId === steer.id) setNdc(e);
    });
    ctx.listen(window, 'pointerup', (e) => {
      if (e.pointerId === steer.id) releaseSteer();
    });
    ctx.listen(window, 'pointercancel', (e) => {
      if (e.pointerId === steer.id) releaseSteer();
    });
    const typing = (e) => e.target && e.target.closest && e.target.closest('input, textarea, select');
    const isEnter = (e) => e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter';
    ctx.listen(window, 'keydown', (e) => {
      if (document.querySelector('.modal-wrap')) return;
      // Enter justo después de elegir la puntada o mover un ajuste (el foco quedó en ese control):
      // empieza a coser, como dice el cartel (sobre una opción no elegida, Enter la elige)
      if (mode === 'overview' && !finished && isEnter(e) && !e.repeat && e.target?.closest?.('.cos-stitches .option.selected, .cos-slider')) {
        e.preventDefault();
        startSeam();
        return;
      }
      if (typing(e)) return;
      const sewingNow = run && (mode === 'sewing' || mode === 'intro');
      if (sewingNow) {
        if (e.code === 'Space') {
          e.preventDefault();
          input.keyPedal = true;
        } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
          e.preventDefault();
          input.left = true;
        } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
          e.preventDefault();
          input.right = true;
        } else if (e.code === 'KeyR') {
          input.keyRev = true;
        }
      } else if ((mode === 'overview' || mode === 'finished') && isEnter(e) && !e.repeat) {
        if (e.target?.closest?.('button')) return;
        e.preventDefault();
        if (finished) finish();
        else startSeam();
      }
    });
    ctx.listen(window, 'keyup', (e) => {
      if (e.code === 'Space') {
        if (run) e.preventDefault();
        input.keyPedal = false;
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = false;
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = false;
      else if (e.code === 'KeyR') input.keyRev = false;
    });
    ctx.listen(window, 'blur', () => {
      input.keyPedal = input.ptrPedal = input.left = input.right = input.keyRev = input.btnRev = false;
      // si el clic quedó apretado al cambiar de ventana, el pointerup no llega: soltar la tela acá
      releaseSteer();
      run?.hud?.remBtn?.classList.remove('on');
    });
    ctx.track(() => (canvas.style.cursor = ''));

    // ---------- cuadro a cuadro ----------
    function frame(dt) {
      if (!run) return;
      const { sim, strip, hud } = run;
      if (mode === 'intro') {
        run.t += dt;
        const k = easeInOutCubic(clamp(run.t / 0.85));
        strip.update(lerp(sim.p - 0.1, sim.p, k), sim.fx, 0);
        if (run.t >= 0.85) {
          mode = 'sewing';
          if (run.kind === 'maquina') machine.setPresserFoot(true);
          audio.play('thud');
        }
        hud.update({ speed: 0, rec: sim.recommendedSpeed(), err: sim.currentError(), acc: null, progress: 0, remStart: false, remEnd: false, remWindow: run.needsRemate ? 'start' : null });
        return;
      }
      if (mode === 'outro') {
        run.t += dt;
        const k = easeInOutCubic(clamp(run.t / 0.9));
        strip.update(run.outFrom.p + k * 0.16, run.outFrom.fx - k * 0.035, 0);
        if (run.t >= 0.9) afterOutro();
        return;
      }
      if (mode !== 'sewing') return;
      sim.pedalHeld = input.keyPedal || input.ptrPedal;
      // el cartel de abajo tapa la tela que viene: una vez que arrancó a coser, se va
      if (run.hintOn && sim.pedalHeld) {
        run.pedalT += dt;
        if (run.pedalT > 2.5) {
          run.hintOn = false;
          ui.hint(null);
        }
      }
      sim.reverseHeld = run.needsRemate && (input.keyRev || input.btnRev);
      sim.keyDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let hx = null;
      if (input.grabbing) {
        hx = handX();
        if (run.grabPending && hx !== null) {
          sim.grabAt(hx);
          run.grabPending = false;
        }
      }
      const evs = sim.update(dt, sim.grab !== null ? hx : null);
      props[run.kind].setSpeed(sim.prevTarget);
      // la máquina vibra un poquito a toda velocidad
      if (!engine.flying && run.camBase) {
        const A = 0.00032 * sim.speed * sim.speed;
        const tt = sim.time;
        engine.camera.position.set(run.camBase.x + Math.sin(tt * 71) * A, run.camBase.y + Math.sin(tt * 89 + 1) * A * 0.7, run.camBase.z + Math.sin(tt * 53 + 2) * A * 0.4);
      }
      strip.update(sim.p, sim.fx, run.kind === 'maquina' ? 1 : 0);
      if (loop && Math.abs(sim.speed - loopV) > 0.01) {
        loop.set(sim.speed);
        loopV = sim.speed;
      }
      for (const e of evs) {
        if (e.type === 'stitch') addStitch(e);
        else if (e.type === 'done') {
          endSeam();
          return;
        }
      }
      const rec = sim.recommendedSpeed();
      let warn = '';
      if (sim.locked > 0) warn = '🧵 Enhebrando…';
      else if (sim.speed > rec + 0.08) warn = '¡Curva! Aflojá el pedal';
      else if (sim.reverseHeld && sim.speed > 0.05) warn = '⟲ Cosiendo hacia atrás';
      hud.update({ speed: sim.speed, rec, err: sim.currentError(), gap: sim.inGap(), acc: sim.scored ? sim.accuracy() : null, progress: sim.progress(), remStart: sim.revStart >= 2, remEnd: sim.revEnd >= 2, remWindow: run.needsRemate ? remWindow(sim) : null, warn });
      // diagrama en vivo (por tramo)
      const pr = sim.progress();
      if (Math.abs(pr - run.lastDiag) > 0.01) {
        run.lastDiag = pr;
        const ps = run.course.pieces;
        const prog = ps.map((p) => clamp((sim.maxP - p.a) / p.L));
        diagram.set(run.seam.id, { progress: ps.length > 1 ? prog : prog[0] });
      }
    }
    ctx.onUpdate((dt) => frame(dt));

    // ---------- ayudas para pruebas automáticas ----------
    self._test = {
      info: () => ({ inp: { ...input, steer: steer.id }, mode, current, seams: seams.map((s) => s.id), choices: { ...choices }, settings: { ...settings }, results: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, { score: r.score, acc: Math.round(r.accuracy * 1000) / 1000, stitch: r.stitch }])), p: run?.sim.p, fx: run?.sim.fx, speed: run?.sim.speed, err: run?.sim.currentError(), time: run?.sim.time, end: run?.course.end, rec: run?.sim.recommendedSpeed(), times: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, Math.round(r.time * 10) / 10])) }),
      choose: (id) => {
        const s = seams[current];
        if (s) {
          choices[s.id] = id;
          lastChoice = id;
          if (mode === 'overview') renderOverview();
        }
      },
      set: (len, ten) => {
        settings.stitchLength = len;
        settings.tension = ten;
        if (mode === 'overview') renderOverview();
      },
      start: () => startSeam(),
      // Avanza la simulación `sec` segundos con un "piloto": pedal apretado y la mano siguiendo la guía
      // con un error (m) y velocidad máxima dados. rev: rematar en las puntas.
      play: (sec = 1, { err = 0.0008, maxSpeed = 1, rev = true, dt = 1 / 60 } = {}) => {
        let t = 0;
        while (t < sec && run) {
          if (mode === 'intro') {
            run.t = 10;
            frame(dt);
            t += dt;
            continue;
          }
          if (mode !== 'sewing') break;
          const sim = run.sim;
          const pc = run.course.pieces.find((p) => sim.p >= p.a - 0.003 && sim.p <= p.b + 0.003) || run.course.pieces.find((p) => p.a > sim.p);
          const ahead = sim.p + 0.004;
          const g = pc ? pc.g(Math.min(Math.max(ahead, pc.a), pc.b)) : 0;
          sim.pilot = -(g + err * Math.sin(t * 3));
          input.grabbing = false;
          const rec = sim.recommendedSpeed();
          input.keyPedal = sim.speed < Math.min(maxSpeed, rec + 0.02);
          const w = remWindow(sim);
          const wantRev = rev && run.needsRemate && ((w === 'start' && sim.revStart < 3 && sim.p > run.course.pieces[0].a + 0.008) || (w === 'end' && sim.revEnd < 3 && sim.p > run.course.end - 0.006));
          input.keyRev = wantRev;
          frame(dt);
          t += dt;
        }
        if (run) run.sim.pilot = null;
        input.keyPedal = false;
        input.keyRev = false;
        return self._test.info();
      },
      skipIntro: () => {
        if (mode === 'intro' && run) {
          run.t = 10;
          frame(0.016);
        }
        return mode;
      },
      // Avanza `sec` segundos de juego con las entradas reales del momento (mouse/teclado).
      tick: (sec = 1, dt = 1 / 30) => {
        for (let t = 0; t < sec && run; t += dt) frame(dt);
        return self._test.info();
      },
      finishOutro: () => {
        if (mode === 'outro' && run) {
          run.t = 10;
          frame(0.016);
        }
        return self._test.info();
      },
      finish: () => finish(),
      // salta el vuelo de cámara en curso (el render por software es muy lento)
      snap: () => {
        const v = run && mode !== 'overview' && mode !== 'finished' ? sewViewFit(run.kind) : overviewView();
        engine.flyTo({ ...v, duration: 0 });
        return true;
      },
    };
    ctx.track(() => {
      if (self._test) self._test = null;
      if (run) disposeRun();
    });

    renderOverview();
  },
};
