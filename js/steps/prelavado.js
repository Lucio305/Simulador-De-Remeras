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

const { PREWASH, COSTS, FABRICS, fabricById, luminance } = catalog;

const OK = '<span class="prela-mark ok">✓</span> ';
const NO = '<span class="prela-mark no">✗</span> ';
const MID = '<span class="prela-mark mid">≈</span> ';
// nota informativa: mismo lugar que ✓/✗, con un ícono (así toda la lista queda alineada, sin viñetas mezcladas)
const ICO = (e) => `<span class="prela-mark ico" aria-hidden="true">${e}</span> `;
const pctTxt = (v) => `${String(Math.round(v * 1000) / 10).replace('.', ',')} %`;
const mTxt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

export const DRY_OPTIONS = [
  { id: 'sombra', name: 'Tendido a la sombra', short: 'A la sombra', icon: '🌳', sub: 'El más suave' },
  { id: 'sol', name: 'Tendido al sol', short: 'Al sol', icon: '☀️', sub: 'Seca rápido' },
  { id: 'secarropas', name: 'Secarropas', short: 'Secarropas', icon: '♨️', sub: 'Con calor' },
];
const SPIN_INFO = { 400: 'Suave', 800: 'Normal', 1200: 'Fuerte' };
// fibras que sufren en el secarropas (encogen / se arrugan)
const DRYER_SENSITIVE = ['algodon_jersey', 'algodon_peinado', 'pique', 'lino', 'modal', 'mezcla'];
const FIBER_WORD = { algodon_jersey: 'el algodón', algodon_peinado: 'el algodón peinado', pique: 'el piqué de algodón', lino: 'el lino', poliester: 'el poliéster', modal: 'el modal', mezcla: 'la mezcla 50/50' };

// ---------- Regla del oficio, armada desde el catálogo (FABRICS.washTemp) ----------
const lowerFirst = (t = '') => t.charAt(0).toLowerCase() + t.slice(1);
const joinY = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`);
// [{ temp, fabrics }] de la temperatura más alta a la más baja
export function washRule() {
  const temps = [...new Set(FABRICS.map((f) => f.washTemp))].sort((a, b) => b - a);
  return temps.map((temp) => ({ temp, fabrics: FABRICS.filter((f) => f.washTemp === temp) }));
}
const fabricNames = (list, markId = null) => joinY(list.map((f) => (f.id === markId ? `<mark class="prela-you">${lowerFirst(f.short)}</mark>` : lowerFirst(f.short))));
const RULE_TEXT = washRule()
  .map((r) => `${fabricNames(r.fabrics)} a <b>${r.temp} °C</b>`)
  .join('; ');

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
// hacia dónde "destiñe" un color oscuro al sol: gris neutro (se aclara y pierde intensidad)
const FADE_TO = '#9a9690';

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
<li>Regla del oficio: ${RULE_TEXT}. 60 °C o más encoge de más y castiga la fibra; en agua fría no termina de encoger.</li>
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

    // Qué parte de la pantalla tapa la interfaz (lo mismo que ui._layout le pasa al motor).
    function screenLayout() {
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
      return { W, H, mobile, right, bottom };
    }
    // Rectángulo del HUD (px del canvas) si está a la vista.
    function hudRect() {
      const el = ui.hudEl;
      if (!el || !el.classList.contains('show') || !el.firstChild) return null;
      const r = el.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      if (r.width < 1) return null;
      return { x0: r.left - c.left, y0: r.top - c.top, x1: r.right - c.left, y1: r.bottom - c.top };
    }
    // Cámara de prueba (con el mismo corrimiento del área libre que aplica el motor) para medir
    // dónde cae algo en pantalla con una vista dada.
    const probeCam = new THREE.PerspectiveCamera();
    const probeV = new THREE.Vector3();
    function projector(view, L) {
      probeCam.copy(engine.camera, false);
      probeCam.aspect = L.W / L.H;
      if (L.right > 0.5 || L.bottom > 0.5) probeCam.setViewOffset(L.W, L.H, L.right / 2, L.bottom / 2, L.W, L.H);
      else probeCam.clearViewOffset();
      probeCam.position.fromArray(view.position);
      probeCam.up.set(0, 1, 0);
      probeCam.lookAt(probeV.fromArray(view.target));
      probeCam.updateMatrixWorld(true);
      probeCam.updateProjectionMatrix();
      return (x, y, z) => {
        probeV.set(x, y, z).project(probeCam);
        return { x: ((probeV.x + 1) / 2) * L.W, y: ((1 - probeV.y) / 2) * L.H };
      };
    }
    // rectángulo en pantalla de la tela colgada (con los broches y la soga)
    function clothRect(view, L) {
      const P = projector(view, L);
      const pts = [];
      for (const x of [ax - 0.25, ax + 0.25]) for (const y of [scene3.lineY + 0.04, scene3.lineY - 0.3]) for (const z of [scene3.lineZ - 0.03, scene3.lineZ + 0.03]) pts.push(P(x, y, z));
      return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
    }
    const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

    // Encuadra `box` (metros) en la zona R (px) de la pantalla. El motor centra el objetivo de la
    // cámara en el área libre (sin el panel): la cámara se corre en paralelo a la pantalla (sin
    // girar) para que el centro de la caja caiga en el centro de R.
    function fitView(box, R, L) {
      const tan = Math.tan(((engine.camera.fov || 45) * Math.PI) / 360);
      const wpp = Math.max(box.w / Math.max(80, (R.x1 - R.x0) * 0.92), box.h / Math.max(80, (R.y1 - R.y0) * 0.92));
      const dist = clamp((wpp * L.H) / (2 * tan), 1.0, 4.5);
      const real = (2 * dist * tan) / L.H; // metros por px a la profundidad del objetivo
      const dir = new THREE.Vector3(0.06, L.mobile ? 0.36 : 0.42, 1).normalize();
      const target = new THREE.Vector3(box.cx, box.cy, box.cz);
      const position = target.clone().addScaledVector(dir, dist);
      const C = { x: (L.W - L.right) / 2, y: (L.H - L.bottom) / 2 };
      const S = { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 };
      const fwd = dir.clone().negate();
      const rightV = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const upV = new THREE.Vector3().crossVectors(rightV, fwd).normalize();
      const pan = (dx, dy, k) => {
        const d = rightV.clone().multiplyScalar(-dx * k).add(upV.clone().multiplyScalar(dy * k));
        target.add(d);
        position.add(d);
      };
      pan(S.x - C.x, S.y - C.y, real);
      return { view: { position: position.toArray(), target: target.toArray() }, pan, real, wpp };
    }

    function frameView(focus = 'machine') {
      const L = screenLayout();
      const top = L.mobile ? 50 : 58;
      // la indicación de abajo también tapa (en el celular, mientras seca, no se muestra)
      const hintH = L.mobile ? (focus === 'line' ? 14 : 64) : 70;
      const side = L.mobile ? 6 : 20;
      const full = { x0: side, x1: L.W - L.right - side, y0: top, y1: L.H - L.bottom - hintH };
      const front0 = front - 0.12;
      if (focus !== 'line') return fitView({ w: 1.25, h: 1.38, cx: ax + 0.1, cy: 0.64, cz: front0 }, full, L).view;
      // secado tendido: lavarropas + tendedero con la tela
      const wide = fitView({ w: 1.2, h: 1.38, cx: ax + 0.05, cy: 0.83, cz: front0 }, full, L);
      const hud = hudRect();
      const pad = 10;
      if (!hud || !overlaps(clothRect(wide.view, L), hud, pad)) return wide.view;
      // El HUD taparía la tela (celular, escritorios angostos): se encuadra la tela, la soga, el sol
      // y la parte de arriba del lavarropas en la zona libre más grande que deja el HUD.
      const tight = { w: 1.0, h: 0.82, cx: ax, cy: 0.96, cz: (front0 + scene3.lineZ) / 2 };
      const below = { ...full, y0: Math.max(full.y0, hud.y1 + pad) };
      const beside = { ...full, x0: Math.max(full.x0, hud.x1 + pad) };
      const a = fitView(tight, below, L);
      const b = fitView(tight, beside, L);
      const pick = a.wpp <= b.wpp ? { f: a, R: below, dirn: 'y' } : { f: b, R: beside, dirn: 'x' };
      // corrección fina con la proyección real (la tela está más al fondo que el centro de la caja)
      const cr = clothRect(pick.f.view, L);
      if (pick.dirn === 'y' && cr.y0 < hud.y1 + pad) pick.f.pan(0, hud.y1 + pad - cr.y0, pick.f.real);
      if (pick.dirn === 'x' && cr.x0 < hud.x1 + pad) pick.f.pan(hud.x1 + pad - cr.x0, 0, pick.f.real);
      return pick.f.view;
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
<ul>${washRule()
      .map((r) => `<li><b>A ${r.temp} °C:</b> ${fabricNames(r.fabrics, fab.id)}.</li>`)
      .join('')}<li><b>60 °C o más:</b> encoge de más y castiga la fibra.</li><li><b>Fría:</b> cuida, pero no termina de encoger.</li></ul>`;
    const skipBtn = h('button', { class: 'btn btn-ghost btn-sm prela-skip', type: 'button', onClick: () => skip() }, 'Saltear el prelavado…');
    let tempSection = null;
    const controlsEl = h(
      'div',
      { class: 'prela-controls' },
      ui.section('1 · Cargar la tela', loadRow),
      (tempSection = ui.section('2 · Temperatura', h('div', { class: 'prela-dial-wrap' }, dial.el), tempCap, ruleBtn, ruleBox)),
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
    // si quedó un desplazamiento suave del panel en curso, se corta (si no, sigue sobre el panel del paso siguiente)
    ctx.track(() => ui.bodyEl?.scrollTo({ top: ui.bodyEl.scrollTop, behavior: 'instant' }));
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
    // Etiqueta sobre un punto 3D: no se muestra durante los vuelos de cámara (quedaría flotando
    // sobre otra cosa) ni si el punto está fuera del área libre de la pantalla.
    const placeLabel = (el, pos, show) => {
      if (!show || engine.flying) {
        el.style.display = 'none';
        return;
      }
      const sp = engine.worldToScreen(pos);
      const L = screenLayout();
      const freeW = L.W - L.right;
      const freeH = L.H - L.bottom;
      if (sp.behind || sp.x < 0 || sp.x > freeW || sp.y < 30 || sp.y > freeH) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const half = (el.offsetWidth || 120) / 2 + 8;
      el.style.left = `${clamp(sp.x, half, Math.max(half, freeW - half))}px`;
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
    let skipping = false; // modal de "saltear" abierto o ya salteado
    // mientras la tela entra al tambor (o en automático) no se puede saltear: el botón se ve apagado
    function setBusy(v) {
      busy = !!v;
      skipBtn.disabled = busy || autoMode || !(phase === 'load' || phase === 'ready');
    }
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
        // puerta cerrada → revisar; media adentro → sacarla; tambor limpio → cargar la tela
        const k = !doorOpen ? 'idle' : sockInside ? 'sock' : 'open';
        if (k !== hintKey) {
          hintKey = k;
          if (k === 'sock') ui.hint('🧦 Tocá la <b>media roja</b> para sacarla del tambor… y después cargá la tela');
          else if (k === 'open') ui.hint(`${sockRemoved ? '¡Tambor limpio!' : 'Tambor vacío, todo en orden.'} Ahora arrastrá la tela hasta el <b>aro verde</b> de la boca${isMobile() ? ' (o tocala)' : ' (o tocala · <kbd>Espacio</kbd>)'}`);
          else hintIdle();
        }
      }
      // temperatura
      const t = sel.temp;
      const fits = FABRICS.filter((f) => f.washTemp === t);
      const capTxt =
        t === 0
          ? 'Agua fría: la más suave, pero la fibra no termina de encoger.'
          : fits.length
            ? `${t <= 30 ? 'Tibia suave' : 'Tibia'}: lo justo para ${fabricNames(fits)}.`
            : t >= 90
              ? 'Muy caliente: hierve la fibra. ¡Cuidado!'
              : 'Caliente: encoge de más. Solo para blancos de algodón muy resistentes.';
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
        wm.setDisplay(`${t === 0 ? 'FRÍA' : `${t}°C`} ${sel.spin}\n${loaded ? 'LISTO' : 'CARGAR'}`);
        ui.updateAction('start', { label: '▶ Iniciar lavado', disabled: !loaded });
      }
    }

    // los botones del panel sueltan el foco: así Espacio / Enter siguen manejando el lavarropas
    const blurPanel = () => {
      const a = document.activeElement;
      if (a && a !== document.body && ui.panelEl?.contains(a) && a.tagName === 'BUTTON') a.blur();
    };
    // el programa se puede tocar hasta que arranca el lavado (también mientras la tela entra al tambor)
    const canProgram = () => (phase === 'load' || phase === 'ready') && !skipping;
    function setSpin(rpm) {
      if (!canProgram()) return;
      blurPanel();
      sel.spin = rpm;
      audio.play('select');
      refresh();
    }
    function setDry(id) {
      if (!canProgram()) return;
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
      setBusy(true);
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
                setBusy(false);
                refresh();
                if (!autoMode) {
                  // en el celular el panel es chico: se lleva a la vista la perilla de temperatura
                  if (isMobile() && tempSection && ui.bodyEl) {
                    const br = ui.bodyEl.getBoundingClientRect();
                    const er = tempSection.getBoundingClientRect();
                    ui.bodyEl.scrollTo({ top: Math.max(0, ui.bodyEl.scrollTop + er.top - br.top - 6), behavior: 'smooth' });
                  }
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
      if (!canProgram()) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        dial.step(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
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

    // al cambiar el tamaño de la ventana se vuelve a encuadrar (el HUD y el panel cambian de lugar)
    let resizeT = 0;
    ctx.listen(window, 'resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => ctx.alive && fly(focus, 0.5), 160);
    });
    ctx.track(() => clearTimeout(resizeT));

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
      const title = h('div', { class: 'hud-title' }, '🫧 Lavarropas');
      const root = h('div', { class: 'prela-hud' }, title, prog, big, meter, list);
      ui.hud(root);
      hudRefs = { root, title, list, big, meter };
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
      phase = 'wash';
      setBusy(true);
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
      wash = { t: 0, speed: auto ? 4 : 1, tinted: false, lastWater: -1, splash: new Set() };
      buildHud();
      showWashTips();
      audio.play('press');
    }

    // ---------- "Mientras lava…": datos del oficio que rotan en el panel ----------
    const WASH_TIPS = [
      fab.shrink <= 0.015
        ? `<b>¿Y ${FIBER_WORD[fab.id] || 'esta tela'}?</b> Casi no encoge (${pctTxt(fab.shrink)}), pero igual se prelava: le saca el apresto y estabiliza el tejido.`
        : `<b>¿Por qué encoge?</b> En la fábrica los hilos se tejen estirados; con el agua las fibras se relajan y ${FIBER_WORD[fab.id] || 'la tela'} se acorta, sobre todo a lo largo.`,
      '<b>Chau apresto:</b> el prelavado saca el almidón de fábrica, y así tintas, vinilos y bordados agarran mejor.',
      '<b>Siempre solita:</b> la tela nueva se lava sin otras prendas: no destiñe sobre nada ni junta pelusas.',
      '<b>Ojo con el centrifugado:</b> a muchas vueltas quedan quiebres marcados que después cuestan horrores de planchar.',
    ];
    let tipHead = null;
    function showWashTips() {
      let i = 0;
      const txt = h('p', { class: 'prela-tip-text', html: WASH_TIPS[0] });
      const dots = h('div', { class: 'prela-tip-dots' }, ...WASH_TIPS.map((_, k) => h('i', { class: k === 0 ? 'on' : '' })));
      const head = h('span', {}, 'Mientras lava…');
      tipHead = head;
      const card = h('div', { class: 'prela-tip' }, h('div', { class: 'prela-tip-head' }, h('span', { class: 'prela-tip-ico', 'aria-hidden': 'true' }, '🫧'), head), txt, dots);
      controlsEl.parentNode.insertBefore(card, controlsEl);
      if (ui.bodyEl) ui.bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
      ctx.interval(() => {
        if (phase === 'done') return;
        i = (i + 1) % WASH_TIPS.length;
        txt.classList.remove('in');
        void txt.offsetWidth;
        txt.innerHTML = WASH_TIPS[i];
        txt.classList.add('in');
        [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      }, autoMode ? 1800 : 3200);
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
      ui.updateAction('start', { label: 'Secando…' });
      if (tipHead) tipHead.textContent = 'Mientras seca…';
      const auto = autoMode;
      const speed = auto ? 3.5 : 1;
      if (sockInside && luminance(color0) > 0.45) {
        tintHex = mixHex(color0, TINT, 0.24);
        scene3.setTint(tintHex);
      }
      scene3.setWet(1);
      // el sol destiñe los oscuros: se ven apenas más claros y grisáceos (no de otro color)
      if (sel.dry === 'sol' && luminance(color0) < 0.35) fadeHex = mixHex(color0, FADE_TO, 0.14);
      const dOpt = DRY_OPTIONS.find((d) => d.id === sel.dry);
      if (hudRefs) hudRefs.title.textContent = `${dOpt.icon} ${dOpt.name}`;
      if (sel.dry === 'secarropas') {
        dry = { t: 0, dur: 3.4 / speed, mode: 'secarropas' };
        rumble.set(0.3, 210);
        wm.setDrum(0.42);
        ui.hint(auto ? null : 'Secarropas: aire caliente y vueltas…');
        return;
      }
      // tendido: en pantallas chicas el HUD se achica (solo el avance) para dejar ver la tela colgada
      const L = screenLayout();
      if (hudRefs && (L.mobile || L.W - L.right < 820)) hudRefs.root.classList.add('compact');
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
      ui.hint(auto || L.mobile ? null : sel.dry === 'sol' ? 'Al sol: seca rápido… ¿y el color?' : 'A la sombra: despacito y sin castigar la tela');
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
        // el HUD compacto (solo "Secando…") muestra el avance del secado; el completo, el del ciclo entero
        const compact = !!hudRefs?.root.classList.contains('compact');
        hudStep(3, k < 1 ? `Secando ${Math.round(k * 100)}\u202f%` : 'Seca ✓', compact ? k : 0.75 + k * 0.25);
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
      if (fadeHex) state.fabric.color = mixHex(state.fabric.color, FADE_TO, 0.1);
      state.prewash = { done: true, skipped: false, temp: sel.temp, spin: sel.spin, dry: sel.dry, wrinkleBoost: r.wrinkleBoost, residualShrink: r.residualShrink, stained: !!r.tinted };
      // cuánto encogió el corte de tela
      const meters = fabricEstimate(createPattern({ ...state.pattern }));
      const shrinkNow = fab.shrink * (1 - r.residualShrink) * (sel.temp - fab.washTemp >= 20 ? 1.35 : 1);
      r.notes.push(`${ICO('📏')}El corte encogió <b>${pctTxt(shrinkNow)}</b>: de ${mTxt(meters)} m a ${mTxt(meters * (1 - shrinkNow))} m de largo. Mejor ahora que en la remera terminada.`);
      if (r.wrinkleBoost > 0) r.notes.push(`${ICO('👕')}Sale más arrugada de lo normal: en el planchado vas a tener más trabajo.`);
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
      setBusy(busy);
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
      if (id !== 'skip' || !ctx.alive || busy || phase === 'wash' || phase === 'dry' || phase === 'done') return;
      skipping = true;
      phase = 'done';
      setBusy(true);
      state.prewash = { done: false, skipped: true, temp: null, spin: null, dry: null, wrinkleBoost: 0, residualShrink: 1 };
      ctx.removeCost('Prelavado');
      audio.play('bad');
      const notes = [
        `${NO} <b>Salteaste el prelavado:</b> en la prueba de lavado la remera va a encoger cerca de ${pct} (y puede quedar torcida).`,
        `${MID} Como no la lavaste, el <b>apresto</b> de fábrica sigue ahí: tintas y vinilos van a agarrar peor.`,
        fab.shrink <= 0.015 ? `${MID} ${fab.short} casi no encoge, pero igual conviene lavarla una vez antes de estampar.` : `${ICO('💡')}Para ${FIBER_WORD[fab.id] || 'esta tela'} lo ideal era lavarla a <b>${fab.washTemp} °C</b> y tenderla a la sombra.`,
      ];
      await ctx.complete({ score: 30, notes });
    }

    // ---------- ayudas para las pruebas automáticas (window.__taller.step._test) ----------
    let testSpeed = 1;
    const screenOf = (obj) => {
      if (!obj) return null;
      obj.getWorldPosition(tmpV);
      const sp = engine.worldToScreen(tmpV);
      return [Math.round(sp.x), Math.round(sp.y)];
    };
    ctx.step._test = {
      get phase() {
        return phase;
      },
      get sel() {
        return { ...sel };
      },
      get sockInside() {
        return sockInside;
      },
      get doorOpen() {
        return doorOpen;
      },
      get busy() {
        return busy;
      },
      // avance del secado 0..1 (null si no está secando)
      get dryK() {
        return dry ? clamp(dry.t / dry.dur) : null;
      },
      screen: () => ({ bundle: screenOf(scene3.bundle), sock: scene3.sock?.visible ? screenOf(scene3.sock) : null, door: screenOf({ getWorldPosition: (v) => v.copy(wm.doorCenter) }), mouth: screenOf({ getWorldPosition: (v) => v.copy(mouth) }) }),
      fast: (k = 6) => (testSpeed = k),
    };
    ctx.track(() => delete ctx.step._test);

    // ---------- loop ----------
    let last = performance.now();
    let ringGlow = false;
    ctx.onUpdate((dt, t) => {
      // tiempo real (el dt del motor se recorta y en equipos lentos el ciclo duraría minutos)
      const now = performance.now();
      const rdt = Math.min(0.5, (now - last) / 1000) * testSpeed;
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
      // con la puerta abierta y el tambor limpio, el aro de la boca late suave: "acá va la tela"
      const dragging = !!(drag && drag.started);
      if (phase === 'load' && !busy && doorOpen && !sockInside && !bundleAnim && !dragging && b.visible) {
        scene3.setRing(0.22 + Math.sin(now / 260) * 0.1);
        scene3.ring.scale.setScalar(1);
        ringGlow = true;
      } else if (ringGlow && !dragging) {
        scene3.setRing(0);
        ringGlow = false;
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
