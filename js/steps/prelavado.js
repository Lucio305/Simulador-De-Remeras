// Paso 4 · Prelavado de la tela.
// Mini-juego en el lavarropas: revisar el tambor (¡a veces quedó una media roja!), arrastrar el
// corte de tela adentro, programar temperatura y centrifugado con la perilla, elegir el secado
// y ver el ciclo acelerado (lavado → enjuague → centrifugado → secado). La tela encoge AHORA,
// así la remera terminada no se achica en el primer lavado.

import * as catalog from '../data/catalog.js';
import { fabricSwatch } from '../materials/fabric.js';
import { createPattern } from '../shirt/pattern.js';
import { fabricEstimate } from './molde.js';
import { createLaundryScene, WM } from './prelavado/scene.js';
import { createTempDial, tempLabel } from './prelavado/dial.js';
import { clamp, lerp, mixHex, smoothstep, easeInOutCubic } from '../core/utils.js';

const { PREWASH, COSTS, fabricById, luminance } = catalog;

const OK = '<span class="prela-mark ok">✓</span> ';
const NO = '<span class="prela-mark no">✗</span> ';
const MID = '<span class="prela-mark mid">≈</span> ';
const pctTxt = (v) => `${String(Math.round(v * 1000) / 10).replace('.', ',')} %`;
const mTxt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

export const DRY_OPTIONS = [
  { id: 'sombra', name: 'Tendido a la sombra', short: 'A la sombra', icon: '🌳', sub: 'El más suave' },
  { id: 'sol', name: 'Tendido al sol', short: 'Al sol', icon: '☀️', sub: 'Seca rápido' },
  { id: 'secarropas', name: 'Secarropas', short: 'Secarropas', icon: '🌀', sub: 'Con calor' },
];
const SPIN_INFO = { 400: 'Suave', 800: 'Normal', 1200: 'Fuerte' };
// fibras que sufren en el secarropas (encogen / se arrugan)
const DRYER_SENSITIVE = ['algodon_jersey', 'algodon_peinado', 'pique', 'lino', 'modal', 'mezcla'];
const FIBER_WORD = { algodon_jersey: 'el algodón', algodon_peinado: 'el algodón peinado', pique: 'el piqué de algodón', lino: 'el lino', poliester: 'el poliéster', modal: 'el modal', mezcla: 'la mezcla 50/50' };

// ---------------------------------------------------------------------------
// Reglas (exportadas para reutilizar en otros pasos / pruebas)
// ---------------------------------------------------------------------------

export function idealPrewash(fabric) {
  return { temp: fabric.washTemp, spin: PREWASH.idealSpin, dry: 'sombra' };
}

// choice = { temp, spin, dry }; extra = { sock: bool (se lavó con la media), sockRemoved, auto }
export function scorePrewash(fabric, colorHex, choice, { sock = false, sockRemoved = false, auto = false } = {}) {
  const notes = [];
  const wt = fabric.washTemp;
  const fiber = FIBER_WORD[fabric.id] || 'la tela';
  const t = choice.temp;
  let score;
  let residual = 0; // fracción del encogimiento que queda pendiente para la remera terminada
  if (t === wt) {
    score = 100;
    notes.push(`${OK} <b>${tempLabel(t)}</b> es justo lo que pide ${fiber}: encogió ahora (${pctTxt(fabric.shrink)}) y no después, en la remera terminada.`);
  } else if (t === 0) {
    score = fabric.shrink >= 0.04 ? 70 : 85;
    residual = 0.5;
    notes.push(`${MID} Con <b>agua fría</b> la fibra no termina de encoger: la remera todavía se va a achicar en su primer lavado tibio. Para ${fiber} lo ideal era <b>${wt} °C</b>.`);
  } else if (t - wt >= 20) {
    score = 45;
    const harm = fabric.id === 'poliester' ? 'el poliéster se marca y pierde la elasticidad' : fabric.id === 'modal' ? 'la viscosa se debilita y hace pelotitas' : fabric.id === 'mezcla' ? 'el poliéster de la mezcla se marca y el algodón encoge de más' : 'encogió de más y la fibra se resintió';
    notes.push(`${NO} El agua a <b>${t} °C</b> fue demasiado: ${harm}. Para ${fiber} lo ideal era <b>${wt} °C</b>.`);
  } else {
    score = 80;
    if (t > wt) notes.push(`${MID} <b>${t} °C</b> es un poco caliente para ${fiber} (ideal ${wt} °C): encogió un poquito de más.`);
    else {
      residual = 0.25;
      notes.push(`${MID} <b>${t} °C</b> se queda corto para ${fiber} (ideal ${wt} °C): le va a quedar algo de encogimiento para después.`);
    }
  }
  let wrinkleBoost = 0;
  // centrifugado
  if (choice.spin === PREWASH.idealSpin) notes.push(`${OK} Centrifugado a <b>${choice.spin} rpm</b>: saca el agua sin marcar la tela.`);
  else if (choice.spin > PREWASH.idealSpin) {
    if (fabric.id === 'lino' || fabric.id === 'modal') {
      score -= 10;
      wrinkleBoost += 0.3;
      notes.push(`${NO} <b>${choice.spin} rpm</b> en ${fiber} deja quiebres marcados: te espera más plancha (−10).`);
    } else {
      score -= 4;
      wrinkleBoost += 0.1;
      notes.push(`${MID} <b>${choice.spin} rpm</b> es mucho: la tela sale más arrugada (−4). Con 800 alcanza.`);
    }
  } else if (fabric.id === 'modal') notes.push(`${OK} Centrifugado suave (<b>${choice.spin} rpm</b>): el modal es delicado, bien cuidado.`);
  else {
    score -= 3;
    notes.push(`${MID} A <b>${choice.spin} rpm</b> la tela sale empapada y tarda mucho en secar (−3).`);
  }
  // secado
  const dark = luminance(colorHex) < 0.35;
  if (choice.dry === 'sombra') notes.push(`${OK} <b>A la sombra</b>: el secado más amable con el color y la fibra.`);
  else if (choice.dry === 'sol') {
    if (dark) {
      score -= 10;
      notes.push(`${NO} <b>Al sol</b> los colores oscuros se destiñen y quedan con aureolas: mejor a la sombra (−10).`);
    } else notes.push(`${OK} <b>Al sol</b> seca rápido y en colores claros no pasa nada (hasta blanquea un poco).`);
  } else if (DRYER_SENSITIVE.includes(fabric.id)) {
    score -= 10;
    wrinkleBoost += 0.15;
    notes.push(`${NO} El <b>secarropas</b> encoge y arruga ${fiber}: tendela (−10).`);
  } else notes.push(`${OK} <b>Secarropas</b> suave: el poliéster lo aguanta sin problema.`);
  // media roja
  let tinted = false;
  if (sock) {
    const light = luminance(colorHex) > 0.45;
    if (light) {
      score -= 20;
      tinted = true;
      notes.unshift(`${NO} <b>¡La media roja destiñó!</b> Tu tela quedó rosada. Antes de cargar, revisá siempre el tambor y nunca laves la tela con ropa de color (−20).`);
    } else {
      score -= 8;
      notes.unshift(`${MID} Lavaste la tela con una media roja adentro: por suerte el color oscuro lo disimula, pero se separa siempre por color (−8).`);
    }
  } else if (sockRemoved) notes.unshift(auto ? `${OK} El taller revisó el tambor y sacó una <b>media roja</b> olvidada: siempre se mira antes de cargar.` : `${OK} <b>¡Bien visto!</b> Sacaste la media roja del tambor antes de cargar: te salvó la tela.`);
  if (auto) {
    score = Math.min(score, 72);
    notes.unshift(`${MID} Lavado en automático: la próxima programalo vos y sumá más puntos.`);
  }
  return { score: clamp(score, 0, 100), notes, wrinkleBoost: Math.round(wrinkleBoost * 100) / 100, residualShrink: residual, tinted };
}

export const TINT = '#e8708c';

// ---------------------------------------------------------------------------

export default {
  id: 'prelavado',
  title: 'Prelavado de la tela',
  short: 'Prelavado',
  icon: '🫧',
  scored: true,
  help: `<p>Antes de cortar, la tela se lava <b>como se va a lavar la remera</b>: así encoge ahora y no después.</p>
<ul>
<li><b>Revisá el tambor</b> (tocá la puerta para abrirla): si quedó ropa de color, sacala.</li>
<li><b>Arrastrá la tela</b> doblada hasta la boca del lavarropas (o tocala para cargarla).</li>
<li>Programá la <b>temperatura</b> con la perilla (<span class="kbd">←</span> <span class="kbd">→</span>) y el <b>centrifugado</b> (<span class="kbd">↑</span> <span class="kbd">↓</span>).</li>
<li>Regla del oficio: algodón, piqué y lino hasta <b>40 °C</b>; poliéster, modal y mezclas a <b>30 °C</b>. 60 °C o más encoge de más y castiga la fibra.</li>
<li>Centrifugado normal: 800 rpm. Secado ideal: tendido a la sombra (el sol destiñe los oscuros, el secarropas encoge el algodón).</li>
<li><span class="kbd">Espacio</span> carga la tela o arranca el lavado.</li>
</ul>`,

  defaults(state, ctx) {
    const fab = fabricById(state.fabric?.id) || fabricById('algodon_jersey');
    const ideal = idealPrewash(fab);
    state.prewash = { done: true, skipped: false, temp: ideal.temp, spin: ideal.spin, dry: ideal.dry, wrinkleBoost: 0, residualShrink: 0 };
    ctx?.addCost?.('Prelavado', COSTS.prewash);
  },

  async enter(ctx) {
    const { ui, h, state, engine, THREE, audio, world } = ctx;
    const wm = world.props.washingMachine;
    const fab = fabricById(state.fabric.id) || fabricById('algodon_jersey');
    const color0 = state.fabric.color;
    const anchor = ctx.stations.prelavado.anchor;
    const ax = anchor[0];
    const az = anchor[2];
    const front = az + WM.FRONT_Z;
    const params = new URLSearchParams(location.search);
    const forceSock = params.get('media');
    const hasSock = forceSock === '1' ? true : forceSock === '0' ? false : Math.random() < 0.55;

    const ideal = idealPrewash(fab);
    // la perilla arranca en "Fría": la temperatura la tiene que elegir el jugador
    const sel = { temp: PREWASH.temps[0], spin: PREWASH.idealSpin, dry: 'sombra' };
    if (state.prewash?.done && PREWASH.temps.includes(state.prewash.temp)) {
      sel.temp = state.prewash.temp;
      sel.spin = state.prewash.spin || sel.spin;
      sel.dry = state.prewash.dry || sel.dry;
    }

    // ---------- lavarropas en reposo al salir ----------
    const rest = () => {
      wm.setDrum(0);
      wm.setWater(0);
      wm.setLoad(null);
      wm.setDoor(0);
      wm.setDisplay('--:--');
    };
    rest();
    ctx.track(rest);
    let rumble = null;
    ctx.track(() => rumble && rumble.stop());

    // ---------- escena ----------
    const scene3 = createLaundryScene(ctx, { fabricId: fab.id, color: color0, heather: !!state.fabric.heather, anchor });
    if (!hasSock) {
      scene3.sock.visible = false;
      scene3.removeSock();
    }
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const canvas = engine.canvas;

    function frameView(focus = 'machine') {
      const W = canvas.clientWidth || window.innerWidth;
      const H = canvas.clientHeight || window.innerHeight;
      const mobile = isMobile();
      const pEl = ui.panelEl;
      let right = 0;
      let bottom = 0;
      if (pEl && !pEl.classList.contains('hidden')) {
        if (mobile) bottom = pEl.classList.contains('collapsed') ? 64 : Math.min(pEl.offsetHeight || H * 0.48, H * 0.48);
        else right = (pEl.offsetWidth || 380) + 24;
      }
      const top = mobile ? 50 : 58;
      const hintH = mobile ? 64 : 70; // la indicación de abajo también tapa
      const fw = W - right - (mobile ? 12 : 40);
      const fh = H - bottom - top - hintH;
      const tan = Math.tan(((engine.camera.fov || 45) * Math.PI) / 360);
      // caja a encuadrar: lavarropas + tela arriba (+ tendedero al secar)
      const box = focus === 'line' ? { w: 1.2, h: 1.3, cx: ax + 0.05, cy: 0.76 } : { w: 1.25, h: 1.38, cx: ax + 0.1, cy: 0.64 };
      const wpp = Math.max(box.w / Math.max(120, fw * 0.92), box.h / Math.max(120, fh * 0.92));
      const dist = clamp((wpp * H) / (2 * tan), 1.0, 4.5);
      const shiftY = ((top - hintH) / 2) * ((2 * dist * tan) / H);
      const target = new THREE.Vector3(box.cx, box.cy + shiftY, front - 0.12);
      const dir = new THREE.Vector3(0.06, mobile ? 0.36 : 0.42, 1).normalize();
      const position = target.clone().addScaledVector(dir, dist);
      return { position: position.toArray(), target: target.toArray() };
    }
    let focus = 'machine';
    const fly = (f = focus, d = 1.0) => {
      focus = f;
      return ctx.flyTo(frameView(f), d);
    };

    // ---------- panel ----------
    const swatch = h('span', { class: 'prela-fab-sw', style: { backgroundImage: `url(${fabricSwatch(fab.id, color0, 96, { heather: !!state.fabric.heather })})` } });
    const fabCard = h(
      'div',
      { class: 'prela-fab' },
      swatch,
      h('div', { class: 'prela-fab-text' }, h('b', {}, fab.name), h('span', {}, fab.composition), h('span', { class: 'prela-fab-shrink' }, `Encoge sin prelavar: ${pctTxt(fab.shrink)}`)),
    );
    const loadStatus = h('div', { class: 'prela-load' });
    const loadBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => autoLoad() }, 'Cargar');
    const loadRow = h('div', { class: 'prela-load-row' }, loadStatus, loadBtn);

    const tempCap = h('div', { class: 'prela-temp-cap' });
    const dial = createTempDial({
      temps: PREWASH.temps,
      value: sel.temp,
      onTick: () => audio.play('tick'),
      onChange: (v) => {
        sel.temp = v;
        refresh();
      },
    });
    ctx.track(() => dial.dispose());

    const spinRow = h('div', { class: 'prela-spin', role: 'radiogroup', 'aria-label': 'Centrifugado' });
    for (const rpm of PREWASH.spin) {
      spinRow.appendChild(
        h(
          'button',
          { class: 'prela-spin-btn', type: 'button', role: 'radio', dataset: { rpm }, onClick: () => setSpin(rpm) },
          h('span', { class: 'prela-spin-ico', style: { '--spd': `${2.4 - (rpm / 1200) * 1.9}s` } }, '🌀'),
          h('b', {}, `${rpm}`),
          h('small', {}, `rpm · ${SPIN_INFO[rpm]}`),
        ),
      );
    }
    const dryRow = h('div', { class: 'prela-dry', role: 'radiogroup', 'aria-label': 'Secado' });
    for (const d of DRY_OPTIONS) {
      dryRow.appendChild(
        h('button', { class: 'prela-dry-btn', type: 'button', role: 'radio', dataset: { id: d.id }, title: d.name, onClick: () => setDry(d.id) }, h('span', { class: 'prela-dry-ico' }, d.icon), h('b', {}, d.short), h('small', {}, d.sub)),
      );
    }
    const ruleBox = h('div', { class: 'prela-rule' });
    const ruleBtn = h(
      'button',
      {
        class: 'prela-rule-btn',
        type: 'button',
        onClick: () => {
          ruleBox.classList.toggle('open');
          ruleBtn.textContent = ruleBox.classList.contains('open') ? '💡 Ocultar la regla del oficio' : '💡 ¿A qué temperatura? Ver la regla del oficio';
          audio.play('select');
        },
      },
      '💡 ¿A qué temperatura? Ver la regla del oficio',
    );
    ruleBox.innerHTML = `<p>Se prelava <b>a la temperatura a la que se va a lavar la remera</b>, así encoge ahora y no después.</p>
<ul><li><b>Algodón, piqué y lino:</b> hasta 40 °C.</li><li><b>Poliéster, modal y mezclas:</b> 30 °C.</li><li><b>60 °C o más:</b> encoge de más y castiga la fibra.</li><li><b>Fría:</b> cuida, pero no termina de encoger.</li></ul>`;
    const skipBtn = h('button', { class: 'btn btn-ghost btn-sm prela-skip', type: 'button', onClick: () => skip() }, 'Saltear el prelavado…');
    const controlsEl = h(
      'div',
      { class: 'prela-controls' },
      ui.section('1 · Cargar la tela', loadRow),
      ui.section('2 · Temperatura', h('div', { class: 'prela-dial-wrap' }, dial.el), tempCap, ruleBtn, ruleBox),
      ui.section('3 · Centrifugado', spinRow),
      ui.section('4 · Secado', dryRow),
    );
    const body = h('div', { class: 'prela-panel' }, fabCard, controlsEl, skipBtn);

    ui.panel({
      kicker: 'Paso 4 · Lavadero',
      title: 'Prelavado de la tela',
      subtitle: 'Lavá el corte de tela antes de cortarlo: si encoge ahora, la remera terminada no se achica.',
      body,
      actions: [
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => runAuto() },
        { id: 'start', label: '▶ Iniciar lavado', kind: 'primary', disabled: true, onClick: () => startWash(false), title: 'Primero cargá la tela en el lavarropas' },
      ],
    });
    ui.panelEl?.classList.add('prela-step');
    ctx.track(() => ui.panelEl?.classList.remove('prela-step'));
    const hintIdle = () => ui.hint(isMobile() ? 'Tocá la puerta para revisar el tambor y arrastrá la tela adentro' : 'Tocá la puerta para revisar el tambor · arrastrá la tela hasta la boca del lavarropas (o tocala) · <kbd>Espacio</kbd> carga');
    let hintKey = 'idle';
    hintIdle();
    // en el celular la indicación tapa parte de la escena: se va sola
    if (isMobile()) ctx.timeout(() => hintKey === 'idle' && phase === 'load' && ui.hint(null), 8000);

    // ---------- etiquetas 3D ----------
    const tmpV = new THREE.Vector3();
    const mkLabel = (cls) => {
      const el = h('div', { class: `world-label prela-label ${cls}` });
      el.style.display = 'none';
      document.getElementById('app').appendChild(el);
      ctx.track(() => el.remove());
      return el;
    };
    const bundleLabel = mkLabel('prela-label-bundle');
    bundleLabel.textContent = '✋ Arrastrame al tambor';
    const sockLabel = mkLabel('prela-label-sock');
    sockLabel.textContent = '🧦 ¡Una media roja! Tocala para sacarla';
    const sunEl = h('div', { class: 'prela-sun', 'aria-hidden': 'true' }, h('span', { class: 'prela-sun-rays' }), h('span', { class: 'prela-sun-core' }, '☀️'));
    sunEl.style.display = 'none';
    document.getElementById('app').appendChild(sunEl);
    ctx.track(() => sunEl.remove());
    let sunOn = false;
    const placeLabel = (el, pos, show) => {
      if (!show) {
        el.style.display = 'none';
        return;
      }
      const sp = engine.worldToScreen(pos);
      el.style.display = sp.behind ? 'none' : '';
      const W = canvas.clientWidth || window.innerWidth;
      const half = (el.offsetWidth || 120) / 2 + 8;
      el.style.left = `${clamp(sp.x, half, W - half)}px`;
      el.style.top = `${sp.y}px`;
    };

    // ---------- estado del mini-juego ----------
    let phase = 'load'; // load → ready → wash → dry → done
    let loaded = false;
    let doorOpen = false;
    let drag = null; // { started }
    let bundleAnim = null; // { from, to, t, dur, arc, s0, s1, onEnd }
    let sockAnim = null;
    let sockRemoved = false;
    let sockInside = hasSock;
    let sockSeen = false;
    let autoMode = false;
    let busy = false;
    const bundleTarget = scene3.bundleHome.clone();

    function setDoor(open) {
      doorOpen = !!open;
      wm.setDoor(doorOpen ? 1 : 0);
    }

    function refresh() {
      // estado de carga
      loadStatus.innerHTML = loaded
        ? `<span class="prela-check ok">✓</span><span><b>Tela adentro</b> y puerta cerrada.</span>`
        : `<span class="prela-check"></span><span>${sockInside && sockSeen ? '<b>Sacá la media roja</b> y después a' : 'A'}rrastrá la tela doblada hasta la boca del lavarropas.</span>`;
      loadBtn.style.display = loaded ? 'none' : '';
      if (phase === 'load' && !autoMode) {
        const k = sockInside && doorOpen ? 'sock' : 'idle';
        if (k !== hintKey) {
          hintKey = k;
          if (k === 'sock') ui.hint('🧦 Tocá la <b>media roja</b> para sacarla del tambor… y después cargá la tela');
          else hintIdle();
        }
      }
      // temperatura
      const t = sel.temp;
      const capTxt = t === 0 ? 'Agua fría: la más suave, pero encoge poco.' : t === 30 ? 'Tibia suave: sintéticos, modal y mezclas.' : t === 40 ? 'Tibia: el lavado de todos los días del algodón.' : t === 60 ? 'Caliente: solo para blancos de algodón muy resistentes.' : 'Muy caliente: hierve la fibra. ¡Cuidado!';
      tempCap.innerHTML = `<b>${tempLabel(t)}</b> · ${capTxt}`;
      tempCap.className = `prela-temp-cap t${t}`;
      for (const b of spinRow.children) {
        const on = Number(b.dataset.rpm) === sel.spin;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      for (const b of dryRow.children) {
        const on = b.dataset.id === sel.dry;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      if (phase === 'load' || phase === 'ready') {
        wm.setDisplay(`${t === 0 ? 'FRIA' : `${t}°C`} ${sel.spin}\n${loaded ? 'LISTO' : 'CARGAR'}`);
        ui.updateAction('start', { label: '▶ Iniciar lavado', disabled: !loaded });
      }
    }

    // los botones del panel sueltan el foco: así Espacio / Enter siguen manejando el lavarropas
    const blurPanel = () => {
      const a = document.activeElement;
      if (a && a !== document.body && ui.panelEl?.contains(a) && a.tagName === 'BUTTON') a.blur();
    };
    function setSpin(rpm) {
      if (busy) return;
      blurPanel();
      sel.spin = rpm;
      audio.play('select');
      refresh();
    }
    function setDry(id) {
      if (busy) return;
      blurPanel();
      sel.dry = id;
      audio.play('select');
      refresh();
    }

    // ---------- carga ----------
    function animateBundle(to, { dur = 0.6, arc = 0.12, scale = 1, onEnd = null } = {}) {
      bundleAnim = { from: scene3.bundle.position.clone(), to: to.clone(), t: 0, dur, arc, s0: scene3.bundle.scale.x, s1: scale, r0: scene3.bundle.rotation.y, onEnd };
    }
    const mouth = new THREE.Vector3(ax, WM.DOOR_Y, front + 0.02);
    const insideDrum = new THREE.Vector3(ax, WM.DOOR_Y - 0.12, front - 0.2);

    function loadIntoDrum() {
      if (loaded) return;
      busy = true;
      if (!doorOpen) setDoor(true);
      drag = null;
      canvas.style.cursor = '';
      scene3.setRing(0);
      animateBundle(mouth, {
        dur: 0.45,
        arc: 0.05,
        scale: 0.8,
        onEnd: () =>
          animateBundle(insideDrum, {
            dur: 0.4,
            arc: 0,
            scale: 0.55,
            onEnd: () => {
              scene3.bundle.visible = false;
              wm.setLoad(color0);
              audio.play('thud');
              loaded = true;
              phase = 'ready';
              ctx.timeout(() => {
                setDoor(false);
                audio.play('press');
                busy = false;
                refresh();
                if (!autoMode) {
                  ui.hint('¡Adentro! Ahora programá <b>temperatura</b>, <b>centrifugado</b> y <b>secado</b> en el panel y tocá <b>Iniciar lavado</b>');
                  ctx.timeout(() => phase === 'ready' && ui.hint(null), 7000);
                }
              }, autoMode ? 250 : 550);
              refresh();
            },
          }),
      });
    }

    function autoLoad() {
      if (busy || loaded || phase !== 'load') return;
      audio.play('select');
      if (sockInside && !sockRemoved && !autoMode) {
        // primero hay que abrir y mirar: si no la vio, se la muestra
        if (!doorOpen) {
          setDoor(true);
          sockSeen = true;
          refresh();
          ui.toast('🧦 Antes de cargar, mirá adentro del tambor…', 'warn', 3200);
          return;
        }
      }
      loadIntoDrum();
    }

    function removeSock() {
      if (!scene3.sock || sockAnim) return;
      const s = scene3.sock;
      const basket = new THREE.Vector3(ax + 0.55, 0.42, az + 0.02);
      sockAnim = { from: s.position.clone(), to: basket, t: 0, dur: 0.7, obj: s };
      audio.play('pop');
      sockInside = false;
      sockRemoved = true;
      refresh();
      if (!autoMode) ui.toast('🧦 ¡Bien visto! Una media roja habría teñido toda la tela.', 'good', 3200);
    }

    // ---------- interacción ----------
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(front + 0.13));
    // el canasto de mimbre es parte del grupo del lavarropas: no cuenta como "tocar el lavarropas"
    const inBasket = (o) => {
      for (; o; o = o.parent) if (o.name === 'canasto') return true;
      return false;
    };
    const machineHit = () => engine.raycast([wm.group]).some((hh) => !inBasket(hh.object));
    const bundleHit = () => scene3.bundle.visible && engine.raycast([scene3.grab], null, false).length > 0;
    const sockHit = () => scene3.sock && scene3.sock.visible && doorOpen && engine.raycast([scene3.sock]).length > 0;
    let downAt = null;
    let lastHover = 0;
    ctx.track(() => (canvas.style.cursor = ''));

    ctx.onPointer('down', (e, p) => {
      if (busy || phase !== 'load' || e.target !== canvas) return;
      downAt = { x: p.x, y: p.y, t: performance.now() };
      if (sockHit()) {
        downAt.sock = true;
        return;
      }
      if (bundleHit()) {
        drag = { started: false };
        canvas.style.cursor = 'grabbing';
      }
    });
    ctx.onPointer('move', (e, p) => {
      if (drag) {
        if (!drag.started && downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 5) {
          drag.started = true;
          if (!doorOpen) {
            setDoor(true);
            audio.play('click');
          }
          if (sockInside) sockSeen = true;
          refresh();
        }
        if (drag.started) {
          const hit = engine.pointerOnPlane(dragPlane);
          if (hit) {
            bundleTarget.set(clamp(hit.x, ax - 0.6, ax + 0.6), clamp(hit.y - 0.03, 0.12, 1.25), front + 0.13);
          }
        }
        return;
      }
      if (busy || phase !== 'load' || !engine.pointer.inside) return;
      const now = performance.now();
      if (now - lastHover < 60) return;
      lastHover = now;
      canvas.style.cursor = sockHit() || bundleHit() || machineHit() ? 'pointer' : '';
    });
    ctx.onPointer('up', (e, p) => {
      const d = downAt;
      downAt = null;
      if (drag) {
        const started = drag.started;
        drag = null;
        canvas.style.cursor = '';
        if (started) {
          // se mide donde soltó el puntero (la tela lo sigue con un poquito de retraso)
          const near = Math.hypot(bundleTarget.x - ax, bundleTarget.y + 0.03 - WM.DOOR_Y) < 0.2;
          if (near) loadIntoDrum();
          else {
            scene3.setRing(0);
            animateBundle(scene3.bundleHome, { dur: 0.5, arc: 0.1 });
            bundleTarget.copy(scene3.bundleHome);
            ui.toast('Soltala sobre la boca del lavarropas (el aro verde).', 'info', 2400);
          }
          return;
        }
        // toque sin arrastrar: carga automática
        autoLoad();
        return;
      }
      if (!d || busy || phase !== 'load' || e.target !== canvas) return;
      if (Math.hypot(p.x - d.x, p.y - d.y) > 8) return;
      if (d.sock && sockHit()) {
        removeSock();
        return;
      }
      if (machineHit()) {
        setDoor(!doorOpen);
        audio.play('click');
        if (doorOpen && sockInside) sockSeen = true;
        refresh();
      }
    });

    ctx.listen(window, 'keydown', (e) => {
      if (e.defaultPrevented || document.querySelector('.modal-wrap')) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
      if (busy && phase !== 'load' && phase !== 'ready') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (busy) return;
        e.preventDefault();
        dial.step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (busy) return;
        e.preventDefault();
        const i = PREWASH.spin.indexOf(sel.spin);
        const j = clamp(i + (e.key === 'ArrowUp' ? 1 : -1), 0, PREWASH.spin.length - 1);
        setSpin(PREWASH.spin[j]);
      } else if (e.code === 'Space' || e.key === 'Enter') {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        e.preventDefault();
        if (phase === 'load') autoLoad();
        else if (phase === 'ready' && !busy) startWash(false);
      }
    });

    let layoutMobile = isMobile();
    ctx.listen(window, 'resize', () => {
      const mob = isMobile();
      if (mob !== layoutMobile) fly(focus, 0.6);
      layoutMobile = mob;
    });

    // ---------- ciclo de lavado ----------
    const PHASES = [
      { id: 'lavado', name: 'Lavado', dur: 3.0 },
      { id: 'enjuague', name: 'Enjuague', dur: 2.0 },
      { id: 'centrifugado', name: 'Centrifugado', dur: 2.6 },
      { id: 'fin', name: 'Fin', dur: 0.5 },
    ];
    const WASH_TOTAL = PHASES.reduce((a, p) => a + p.dur, 0);
    const PROGRAM_MIN = 58;
    let wash = null; // { t, speed, tinted }
    let dry = null; // { t, dur, mode }
    let hudRefs = null;

    function buildHud() {
      const dryName = DRY_OPTIONS.find((d) => d.id === sel.dry).short;
      const steps = [...PHASES.slice(0, 3).map((p) => p.name), `Secado · ${dryName.toLowerCase()}`];
      const list = h('ol', { class: 'prela-hud-steps' }, ...steps.map((s) => h('li', {}, s)));
      const big = h('div', { class: 'hud-big prela-hud-time' }, '0:58');
      const meter = ui.meter({ label: '', value: 0 });
      const prog = h('div', { class: 'prela-hud-prog' }, `${fab.short} · ${tempLabel(sel.temp)} · ${sel.spin} rpm`);
      ui.hud(h('div', { class: 'prela-hud' }, h('div', { class: 'hud-title' }, '🫧 Lavarropas'), prog, big, meter, list));
      hudRefs = { list, big, meter };
    }
    function hudStep(i, timeTxt, progress) {
      if (!hudRefs) return;
      [...hudRefs.list.children].forEach((li, k) => {
        li.className = k < i ? 'done' : k === i ? 'now' : '';
      });
      hudRefs.big.textContent = timeTxt;
      hudRefs.meter.set(progress, '');
    }

    function startWash(auto) {
      if (phase !== 'ready' || busy || !loaded) return;
      busy = true;
      phase = 'wash';
      controlsEl.classList.add('is-busy');
      dial.setDisabled(true);
      skipBtn.disabled = true;
      ui.enableAction('start', false);
      ui.enableAction('auto', false);
      ui.updateAction('start', { label: 'Lavando…' });
      ui.hint(auto ? null : 'El lavarropas hace su magia (ciclo acelerado)…');
      ctx.addCost('Prelavado', COSTS.prewash);
      rumble = audio.loop('rumble');
      // la media (si quedó) ya está mezclada con la carga
      if (scene3.sock) scene3.sock.visible = false;
      wash = { t: 0, speed: auto ? 2.6 : 1, tinted: false, lastWater: -1, splash: new Set() };
      buildHud();
      audio.play('press');
    }

    function waterTo(level) {
      const q = Math.round(level * 25) / 25;
      if (q !== wash.lastWater) {
        wash.lastWater = q;
        wm.setWater(q);
      }
    }

    function updateWash(rdt) {
      wash.t += rdt * wash.speed;
      let acc = 0;
      let idx = PHASES.length - 1;
      for (let i = 0; i < PHASES.length; i++) {
        if (wash.t < acc + PHASES[i].dur) {
          idx = i;
          break;
        }
        acc += PHASES[i].dur;
      }
      const ph = PHASES[idx];
      const lt = clamp(wash.t - acc, 0, ph.dur); // tiempo local de la fase
      const spinK = (sel.spin - 400) / 800; // 0..1
      const spinSpeed = 0.62 + spinK * 0.38;
      if (!wash.splash.has(ph.id) && (ph.id === 'lavado' || ph.id === 'enjuague')) {
        wash.splash.add(ph.id);
        audio.play('splash');
      }
      scene3.setBubbles(ph.id === 'lavado' ? lt > 0.5 : ph.id === 'enjuague' ? lt > 0.6 : false);
      if (ph.id === 'lavado') {
        waterTo(Math.min(0.5, (lt / 0.7) * 0.5));
        const cyc = lt % 1.3;
        wm.setDrum(lt < 0.4 ? 0.12 : cyc < 1.0 ? 0.26 : 0.05);
        rumble.set(0.28 + (cyc < 1.0 ? 0.1 : 0), 240);
      } else if (ph.id === 'enjuague') {
        waterTo(lt < 0.4 ? lerp(0.5, 0.12, lt / 0.4) : Math.min(0.4, 0.12 + ((lt - 0.4) / 0.5) * 0.28));
        wm.setDrum(0.3);
        rumble.set(0.36, 300);
        // la media destiñe en el enjuague
        if (sockInside && !wash.tinted && lt > 0.6) {
          wash.tinted = true;
          if (luminance(color0) > 0.45) wm.setLoad(mixHex(color0, TINT, 0.4));
        }
      } else if (ph.id === 'centrifugado') {
        waterTo(Math.max(0, 0.4 * (1 - lt / 0.5)));
        const ramp = smoothstep(0.3, 1.3, lt);
        wm.setDrum(lerp(0.3, spinSpeed, ramp));
        rumble.set(0.4 + ramp * (0.25 + spinK * 0.3), 320 + ramp * (380 + spinK * 700));
      } else {
        waterTo(0);
        wm.setDrum(0);
        rumble.set(0.1, 200);
      }
      const frac = clamp(wash.t / WASH_TOTAL);
      const left = Math.max(0, Math.round(PROGRAM_MIN * (1 - frac)));
      const timeTxt = `0:${String(left).padStart(2, '0')}`;
      wm.setDisplay(ph.id === 'fin' ? 'FIN\n0:00' : `${ph.name.toUpperCase()}\n${timeTxt}`);
      hudStep(idx >= 3 ? 3 : idx, ph.id === 'fin' ? '0:00' : timeTxt, frac * 0.75);
      if (wash.t >= WASH_TOTAL) {
        wash = null;
        rumble.set(0, 200);
        audio.play('tick');
        ctx.timeout(() => audio.play('tick'), 180);
        ctx.timeout(() => audio.play('tick'), 360);
        startDry();
      }
    }

    // ---------- secado ----------
    let tintHex = null;
    let fadeHex = null; // el sol destiñe los colores oscuros
    function startDry() {
      phase = 'dry';
      const auto = autoMode;
      const speed = auto ? 2.4 : 1;
      if (sockInside && luminance(color0) > 0.45) {
        tintHex = mixHex(color0, TINT, 0.24);
        scene3.setTint(tintHex);
      }
      scene3.setWet(1);
      if (sel.dry === 'sol' && luminance(color0) < 0.35) fadeHex = mixHex(color0, '#b9b2a6', 0.16);
      if (sel.dry === 'secarropas') {
        dry = { t: 0, dur: 3.4 / speed, mode: 'secarropas' };
        rumble.set(0.3, 210);
        wm.setDrum(0.42);
        ui.hint(auto ? null : 'Secarropas: aire caliente y vueltas…');
        return;
      }
      // tendido: abrir, sacar la tela mojada y colgarla en la soga
      setDoor(true);
      audio.play('click');
      ctx.timeout(() => {
        if (!ctx.alive) return;
        wm.setLoad(null);
        if (sockInside && scene3.sock) scene3.sock.visible = false;
        scene3.bundle.visible = true;
        scene3.bundle.position.copy(insideDrum);
        scene3.bundle.scale.setScalar(0.55);
        animateBundle(mouth, {
          dur: 0.35 / speed,
          arc: 0,
          scale: 0.8,
          onEnd: () =>
            animateBundle(new THREE.Vector3(ax, scene3.lineY - 0.12, scene3.lineZ + 0.02), {
              dur: 0.6 / speed,
              arc: 0.18,
              scale: 0.9,
              onEnd: () => {
                scene3.bundle.visible = false;
                scene3.showHanging(true);
                scene3.setDrip(7);
                if (sel.dry === 'sol') {
                  scene3.setSun(true);
                  sunOn = true;
                }
                audio.play('pop');
                setDoor(false);
                dry = { t: 0, dur: (sel.dry === 'sol' ? 2.6 : 3.4) / speed, mode: sel.dry };
              },
            }),
        });
      }, 450 / speed);
      fly('line', 1.0 / speed);
      ui.hint(auto ? null : sel.dry === 'sol' ? 'Al sol: seca rápido… ¿y el color?' : 'A la sombra: despacito y sin castigar la tela');
    }

    function updateDry(rdt) {
      dry.t += rdt;
      const k = clamp(dry.t / dry.dur);
      if (dry.mode === 'secarropas') {
        const left = Math.max(0, Math.round(40 * (1 - k)));
        wm.setDisplay(`SECADO\n0:${String(left).padStart(2, '0')}`);
        hudStep(3, `0:${String(left).padStart(2, '0')}`, 0.75 + k * 0.25);
      } else {
        scene3.setWet(1 - easeInOutCubic(k));
        scene3.setDrip(7 * (1 - k) * (1 - k));
        if (fadeHex) scene3.setFade(mixHex(tintHex || color0, fadeHex, smoothstep(0.2, 1, k)));
        hudStep(3, `${Math.round(k * 100)} %`, 0.75 + k * 0.25);
        if (hudRefs) hudRefs.big.textContent = k < 1 ? `Secando ${Math.round(k * 100)} %` : 'Seca ✓';
      }
      if (k >= 1) {
        const mode = dry.mode;
        dry = null;
        if (mode === 'secarropas') {
          wm.setDrum(0);
          rumble.set(0, 200);
          wm.setDisplay('FIN\nSECO');
          scene3.setWet(0);
          setDoor(true);
          ctx.timeout(() => {
            if (!ctx.alive) return;
            wm.setLoad(null);
            scene3.bundle.visible = true;
            scene3.bundle.position.copy(insideDrum);
            scene3.bundle.scale.setScalar(0.55);
            animateBundle(scene3.bundleHome, { dur: 0.7, arc: 0.12, scale: DRYER_SENSITIVE.includes(fab.id) ? 0.95 : 1, onEnd: () => finish() });
          }, 300);
        } else {
          scene3.setDrip(0);
          wm.setDisplay('FIN\nSECO');
          finish();
        }
      }
    }

    // ---------- resultado ----------
    async function finish() {
      if (phase === 'done') return;
      phase = 'done';
      rumble?.stop();
      rumble = null;
      const r = scorePrewash(fab, color0, sel, { sock: sockInside, sockRemoved, auto: autoMode });
      if (r.tinted && tintHex) {
        state.fabric.color = tintHex;
        state.fabric.colorId = null;
      }
      // al sol, un color oscuro queda apenas desteñido (sigue siendo el mismo color de catálogo)
      if (fadeHex) state.fabric.color = mixHex(state.fabric.color, '#b9b2a6', 0.1);
      state.prewash = { done: true, skipped: false, temp: sel.temp, spin: sel.spin, dry: sel.dry, wrinkleBoost: r.wrinkleBoost, residualShrink: r.residualShrink, stained: !!r.tinted };
      // cuánto encogió el corte de tela
      const meters = fabricEstimate(createPattern({ ...state.pattern }));
      const shrinkNow = fab.shrink * (1 - r.residualShrink) * (sel.temp - fab.washTemp >= 20 ? 1.35 : 1);
      r.notes.push(`📏 El corte encogió <b>${pctTxt(shrinkNow)}</b>: de ${mTxt(meters)} m a ${mTxt(meters * (1 - shrinkNow))} m de largo. Mejor ahora que en la remera terminada.`);
      if (r.wrinkleBoost > 0) r.notes.push('👕 Sale más arrugada de lo normal: en el planchado vas a tener más trabajo.');
      hudStep(4, '✓', 1);
      if (hudRefs) hudRefs.big.textContent = '¡Listo!';
      audio.play('good');
      ui.hint(null);
      await new Promise((res) => ctx.timeout(res, autoMode ? 400 : 900));
      if (!ctx.alive) return;
      await ctx.complete({ score: r.score, notes: r.notes });
    }

    // ---------- automático / saltear ----------
    function runAuto() {
      if (busy || phase === 'wash' || phase === 'dry' || phase === 'done') return;
      autoMode = true;
      ui.enableAction('auto', false);
      sel.temp = ideal.temp;
      sel.spin = ideal.spin;
      sel.dry = ideal.dry;
      dial.set(sel.temp);
      refresh();
      ui.hint(null);
      const go = () => {
        if (phase === 'ready' && !busy) startWash(true);
        else if (phase === 'load' || phase === 'ready') ctx.timeout(go, 150);
      };
      if (!loaded) {
        if (scene3.sock && sockInside) {
          setDoor(true);
          ctx.timeout(() => {
            removeSock();
            ctx.timeout(() => loadIntoDrum(), 500);
          }, 350);
        } else loadIntoDrum();
      }
      go();
    }

    async function skip() {
      if (busy) return;
      const pct = pctTxt(fab.shrink);
      const id = await ui.modal({
        title: '¿Saltear el prelavado?',
        body: h('div', { class: 'prela-skip-modal' }, h('p', { html: `Sin prelavar, <b>${fab.short}</b> va a encoger cerca de <b>${pct}</b> en el primer lavado… ¡con la remera ya cosida y estampada!` }), h('p', { html: 'Además, el prelavado saca el apresto de fábrica, que hace que las estampas agarren peor.' })),
        actions: [
          { id: 'skip', label: 'Saltear igual', kind: 'danger' },
          { id: 'wash', label: 'Mejor la lavo', kind: 'primary' },
        ],
      });
      if (id !== 'skip' || !ctx.alive || busy) return;
      busy = true;
      phase = 'done';
      state.prewash = { done: false, skipped: true, temp: null, spin: null, dry: null, wrinkleBoost: 0, residualShrink: 1 };
      ctx.removeCost('Prelavado');
      audio.play('bad');
      const notes = [
        `${NO} <b>Salteaste el prelavado:</b> en la prueba de lavado la remera va a encoger cerca de ${pct} (y puede quedar torcida).`,
        'El prelavado también saca el <b>apresto</b> de fábrica: sin eso, tintas y vinilos agarran mejor.',
        fab.shrink <= 0.015 ? `${MID} ${fab.short} casi no encoge, pero igual conviene lavarla una vez antes de estampar.` : `Para ${FIBER_WORD[fab.id] || 'esta tela'} lo ideal era lavarla a <b>${fab.washTemp} °C</b> y tenderla a la sombra.`,
      ];
      await ctx.complete({ score: 30, notes });
    }

    // ---------- loop ----------
    let last = performance.now();
    ctx.onUpdate((dt, t) => {
      // tiempo real (el dt del motor se recorta y en equipos lentos el ciclo duraría minutos)
      const now = performance.now();
      const rdt = Math.min(0.5, (now - last) / 1000);
      last = now;
      // tela siguiendo al puntero / animaciones de vuelo
      const b = scene3.bundle;
      if (bundleAnim) {
        const A = bundleAnim;
        A.t = Math.min(1, A.t + rdt / A.dur);
        const e = easeInOutCubic(A.t);
        b.position.lerpVectors(A.from, A.to, e);
        b.position.y += Math.sin(Math.PI * A.t) * A.arc;
        const sc = lerp(A.s0, A.s1, e);
        b.scale.setScalar(sc);
        if (A.t >= 1) {
          bundleAnim = null;
          A.onEnd && A.onEnd();
        }
      } else if (drag && drag.started) {
        const k = 1 - Math.exp(-rdt * 16);
        b.position.lerp(bundleTarget, k);
        b.rotation.y += (0.05 - b.rotation.y) * k;
        const near = Math.hypot(b.position.x - ax, b.position.y + 0.03 - WM.DOOR_Y);
        const sc = lerp(b.scale.x, near < 0.2 ? 0.86 : 1, k);
        b.scale.setScalar(sc);
        scene3.setRing(near < 0.2 ? 0.95 : 0.45 + Math.sin(now / 160) * 0.12);
        scene3.ring.scale.setScalar(near < 0.2 ? 1.04 : 1);
      }
      // media volando al canasto
      if (sockAnim) {
        sockAnim.t = Math.min(1, sockAnim.t + rdt / sockAnim.dur);
        const e = easeInOutCubic(sockAnim.t);
        sockAnim.obj.position.lerpVectors(sockAnim.from, sockAnim.to, e);
        sockAnim.obj.position.y += Math.sin(Math.PI * sockAnim.t) * 0.3;
        sockAnim.obj.position.z += Math.sin(Math.PI * sockAnim.t) * 0.25;
        sockAnim.obj.rotation.z += rdt * 9;
        if (sockAnim.t >= 1) {
          sockAnim.obj.visible = false;
          scene3.removeSock();
          sockAnim = null;
        }
      }
      if (wash) updateWash(rdt);
      if (dry) updateDry(rdt);
      scene3.update(rdt, t);
      // sol
      if (sunOn && phase !== 'done') {
        const sp = engine.worldToScreen(scene3.sunAnchor);
        sunEl.style.display = sp.behind ? 'none' : '';
        sunEl.style.left = `${sp.x}px`;
        sunEl.style.top = `${sp.y}px`;
      } else if (sunEl.style.display !== 'none' && phase === 'done') sunEl.classList.add('out');
      // etiquetas
      const idleLoad = phase === 'load' && !busy;
      b.getWorldPosition(tmpV);
      tmpV.y += 0.1;
      placeLabel(bundleLabel, tmpV, idleLoad && !drag && b.visible && !(sockInside && doorOpen));
      if (scene3.sock && scene3.sock.visible && !sockAnim) {
        scene3.sock.getWorldPosition(tmpV);
        tmpV.y += 0.16;
        placeLabel(sockLabel, tmpV, idleLoad && doorOpen && sockInside);
      } else placeLabel(sockLabel, tmpV, false);
    });

    refresh();
    await new Promise((r) => requestAnimationFrame(() => r()));
    if (!ctx.alive) return;
    fly('machine', 1.3);
  },
};
