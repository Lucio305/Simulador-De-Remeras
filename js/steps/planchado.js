// Paso 8 · Planchado. La remera recién cosida llega arrugada a la tabla: hay que elegir la
// temperatura justa para la tela (puntos de la perilla), decidir si usar vapor y pasar la
// plancha 3D sobre el frente y la espalda. Si la plancha está más caliente de lo que la
// tela aguanta, o se queda quieta apoyada, la tela se marca (o se derrite, si es sintética).

import { createIronRig } from './planchado/ironRig.js';
import { createHeatMap } from './planchado/heatMap.js';
import { createHud } from './planchado/hud.js';
import {
  ROOM_TEMP, DONE_LEVEL, levelTemp, idealTemp, meltsInsteadOfScorch, wrinkleAmountFor,
  stepTemp, overHeat, steamWorks, smoothRate, heatRate, scoreIroning, dots,
} from './planchado/rules.js';
import { fabricSwatch } from '../materials/fabric.js';
import { clamp, pointInPolygon, easeInOutCubic } from '../core/utils.js';

// Huella de la suela: círculos a lo largo del eje de la plancha (offset desde el centro, radio).
const FOOT = [
  [-0.066, 0.064],
  [0, 0.066],
  [0.062, 0.05],
];
const MAX_MARKS = 8;

export default {
  id: 'planchado',
  title: 'Planchado',
  short: 'Planchado',
  icon: '♨️',
  scored: true,
  help: `<p>Dejá la remera lisita sin quemarla.</p>
<ul>
<li><b>Temperatura:</b> elegí los puntos de la perilla según la tela (teclas <span class="kbd">1</span>–<span class="kbd">4</span>). La plancha tarda unos segundos en calentar.</li>
<li><b>Planchar:</b> mantené apretado el clic (o el dedo) sobre la remera y mové la plancha con pasadas largas de ida y vuelta. Con teclado: flechas para moverla y <span class="kbd">Espacio</span> para apoyarla.</li>
<li><b>Vapor</b> (<span class="kbd">V</span>): relaja las fibras naturales (algodón, lino). Necesita la plancha caliente: a • gotea.</li>
<li><b>Dar vuelta</b> (<span class="kbd">F</span>): cuando el frente esté listo, planchá la espalda.</li>
<li>Ojo: si la plancha queda quieta apoyada, o está más caliente de lo que la tela aguanta, la tela se marca.</li>
</ul>`,

  defaults(state, ctx) {
    const catalog = ctx.catalog;
    const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
    state.ironing = { smooth: 0.9, burns: 0, level: fabric.ironLevel, steam: !!fabric.ironSteam, sides: { frente: 0.1, espalda: 0.1 } };
    const shirt = ctx.shirt;
    if (shirt) {
      shirt.clearScorches?.();
      shirt.resetWrinkleMask?.(1);
      shirt.setWrinkles?.(0.1);
    }
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, THREE, audio } = ctx;
    const step = this;
    const fabric = catalog.fabricById(state.fabric.id) || catalog.FABRICS[0];
    const Ti = idealTemp(catalog, fabric);
    const melts = meltsInsteadOfScorch(fabric);
    const board = world.props.ironingBoard;
    const iron = world.props.iron;
    const canvas = engine.canvas;
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

    // ---------------- remera acostada sobre la tabla ----------------
    ctx.updateShirt();
    ctx.placeShirt('exhibicion', { inflation: 0.1 });
    const shirt = ctx.shirt;
    const pattern = shirt.pattern;
    shirt.clearScorches();
    shirt.resetWrinkleMask(1);
    const wrinkleAmt = wrinkleAmountFor(fabric, state.prewash);
    shirt.setWrinkles(wrinkleAmt);
    // largo de la remera a lo largo de la tabla, cuello hacia la punta, frente arriba
    // (el ruedo queda justo adentro de la tabla, sin tapar el apoya-plancha)
    const outlines = { frente: pattern.silhouette.front.outline, espalda: pattern.silhouette.back.outline };
    const ext = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const q of outlines.frente) {
      ext.minX = Math.min(ext.minX, q.x);
      ext.maxX = Math.max(ext.maxX, q.x);
      ext.minY = Math.min(ext.minY, q.y);
      ext.maxY = Math.max(ext.maxY, q.y);
    }
    const halfL = board.length / 2;
    const halfW = board.width / 2;
    const lenG = -ext.minY;
    const halfZ = Math.max(-ext.minX, ext.maxX);
    const boardEnd = board.center.x - halfL;
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ'));
    const shirtPos = new THREE.Vector3(Math.max(board.center.x + 0.12, boardEnd + 0.035 + lenG), board.surfaceY + 0.023, board.center.z);
    const shirtCX = shirtPos.x - lenG / 2;
    const sg = shirt.group;
    sg.position.copy(shirtPos);
    sg.quaternion.copy(q0);
    sg.updateMatrixWorld(true);
    ctx.track(() => {
      sg.rotation.set(0, 0, 0);
      sg.updateMatrixWorld(true);
    });
    const topY = board.surfaceY + 0.042; // altura aproximada de la cara de arriba de la remera
    // zona donde puede andar la plancha: la tabla y toda la remera (mangas incluidas)
    const region = {
      x0: Math.min(boardEnd - 0.05, shirtPos.x + ext.minY - 0.08),
      x1: Math.max(board.center.x + halfL, shirtPos.x + ext.maxY + 0.1),
      z0: board.center.z - halfZ - 0.07,
      z1: board.center.z + halfZ + 0.07,
    };

    // ---------------- plancha ----------------
    const rig = createIronRig(iron, board);
    ctx.track(() => rig.restore());
    iron.setLevel(0);
    iron.setSteam(false);
    iron.setHot(0);
    const heat = createHeatMap();

    // ---------------- estado del juego ----------------
    let level = 0;
    let steamOn = false;
    let T = ROOM_TEMP;
    let ready = false;
    let up = 'frente';
    let flip = null; // { t, from }
    let finished = false;
    let busy = false;
    let autoRun = null;
    let pressing = false; // puntero o espacio apretado
    let keyPress = false;
    let pointerPress = false;
    let away = true; // puntero fuera de la zona de la tabla
    let lastInput = -1e9;
    let simT = 0;
    let lastMarkT = -10;
    let lastHissT = -10;
    let lastPuffT = -10;
    let lastContactT = -10;
    let stillT = 0;
    let frontDoneToast = false;
    let firstContactHint = false;
    let heatingHintShown = false;
    let usedKeys = false;
    let steamLoop = null;
    let contactYs = topY;
    const keys = new Set();
    const target = new THREE.Vector3(board.center.x, topY, board.center.z);
    const stats = { contact: { 1: 0, 2: 0, 3: 0, 4: 0 }, steamContact: 0, activeTime: 0, burns: 0, melts: 0, hotBurns: 0, started: false, flipped: false };
    const levels = { frente: 1, espalda: 1 };
    const inv = new THREE.Matrix4();
    const tmpV = new THREE.Vector3();
    const tmpL = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY);
    const prevContact = new THREE.Vector3();
    let hadContact = false;

    ctx.track(() => {
      steamLoop?.stop();
      steamLoop = null;
      canvas.style.cursor = '';
    });

    // ---------------- luz de trabajo ----------------
    // Luz rasante desde el lado del apoya-plancha y menos luz ambiente: así las arrugas se leen
    // (es lo que hace cualquiera que plancha: mirar la tela a contraluz). Se restaura al salir.
    const L = engine.lights || {};
    const lit0 = {
      hemi: L.hemi?.intensity,
      sun: L.sun?.intensity,
      fill: L.fill?.intensity,
      fillColor: L.fill?.color.clone(),
      fillPos: L.fill?.position.clone(),
      fillTarget: L.fill?.target.position.clone(),
      env: engine.scene.environmentIntensity,
    };
    const lit1 = { hemi: 0.33, sun: 1.2, fill: 3.6, env: 0.16 };
    const fillColor1 = new THREE.Color('#fff1dc');
    const tmpLightPos = new THREE.Vector3();
    let litK = 0;
    function applyLight(k) {
      if (!L.fill) return;
      const mix = (a, b) => a + (b - a) * k;
      L.hemi.intensity = mix(lit0.hemi, lit1.hemi);
      L.sun.intensity = mix(lit0.sun, lit1.sun);
      engine.scene.environmentIntensity = mix(lit0.env, lit1.env);
      L.fill.intensity = mix(lit0.fill, lit1.fill);
      L.fill.color.copy(lit0.fillColor).lerp(fillColor1, k);
      L.fill.position.copy(lit0.fillPos).lerp(tmpLightPos.set(board.center.x - 3, board.center.y + 0.4, board.center.z + 0.4), k);
      L.fill.target.position.copy(lit0.fillTarget).lerp(board.center, k);
      L.fill.target.updateMatrixWorld();
    }
    ctx.track(() => {
      if (!L.fill) return;
      L.hemi.intensity = lit0.hemi;
      L.sun.intensity = lit0.sun;
      L.fill.intensity = lit0.fill;
      L.fill.color.copy(lit0.fillColor);
      L.fill.position.copy(lit0.fillPos);
      L.fill.target.position.copy(lit0.fillTarget);
      L.fill.target.updateMatrixWorld();
      engine.scene.environmentIntensity = lit0.env;
    });

    // ---------------- cámara ----------------
    const view = () => {
      const cz = board.center.z;
      if (isMobile()) {
        const k = Math.max(1, (2 * halfZ + 0.12) / 0.93, (lenG + 0.12) / 0.84);
        const tx = shirtCX - 0.01;
        return { position: [tx, board.surfaceY + 2.39 * k, cz - 0.07 + 1.05 * k], target: [tx, board.surfaceY, cz - 0.07] };
      }
      // en ventanas más angostas (menos lugar libre al lado del panel) o con mangas largas, la cámara se aleja
      const freeW = Math.max(300, window.innerWidth - 404);
      const kW = clamp(1.15 / (freeW / Math.max(300, window.innerHeight)), 1, 1.45);
      const kS = Math.max(1, ((2 * halfZ + 0.15) * 0.87) / 1.18, (lenG + 0.1) / 0.84);
      const k = Math.max(kW, kS);
      const tx = shirtCX - 0.07 - 0.06 * (k - 1);
      // con mangas largas la manga de adelante queda más cerca de la cámara: correr un poco el centro
      const tz = cz + 0.03 + Math.max(0, halfZ - 0.42) * 0.3;
      return { position: [tx, board.surfaceY + 1.37 * k, tz + 0.79 * k], target: [tx, board.surfaceY, tz] };
    };
    ctx.flyTo(view(), 1.4);
    let resizeTimer = 0;
    ctx.listen(window, 'resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!ctx.alive) return;
        ctx.flyTo(view(), 0.6);
      }, 180);
    });
    ctx.track(() => clearTimeout(resizeTimer));

    // ---------------- panel ----------------
    const fabChip = h(
      'div',
      { class: 'pl-fabric' },
      h('span', { class: 'pl-fabric-sw', style: { backgroundImage: `url(${fabricSwatch(fabric.id, state.fabric.color, 96, { heather: !!state.fabric.heather })})` } }),
      h('span', { class: 'pl-fabric-text' }, h('b', {}, `Tu remera: ${fabric.short}`), h('span', {}, `${fabric.composition} · ${fabric.knit ? 'tejido de punto' : 'tejido plano'}`)),
    );

    const dialBtns = new Map();
    const dial = h('div', { class: 'pl-dial', role: 'radiogroup', 'aria-label': 'Temperatura de la plancha' });
    const offBtn = h('button', { class: 'pl-dial-btn off', type: 'button', title: 'Apagada (0)', onClick: () => setLevel(0) }, h('span', { class: 'pl-dial-dots' }, '○'), h('span', { class: 'pl-dial-temp' }, 'Off'));
    dial.appendChild(offBtn);
    dialBtns.set(0, offBtn);
    for (const L of catalog.IRON_LEVELS) {
      const b = h(
        'button',
        { class: 'pl-dial-btn', type: 'button', role: 'radio', title: `${L.name} · ${L.temp} °C (${L.level})`, onClick: () => setLevel(L.level) },
        h('span', { class: 'pl-dial-dots' }, dots(L.level)),
        h('span', { class: 'pl-dial-temp' }, `${L.temp} °C`),
        h('span', { class: 'pl-dial-label' }, L.label),
      );
      dialBtns.set(L.level, b);
      dial.appendChild(b);
    }
    const thermText = h('div', { class: 'pl-heat-text' });
    const thermFill = h('i');
    const thermo = h('div', { class: 'pl-heat' }, h('span', { class: 'pl-heat-bar' }, thermFill), thermText);

    const steamToggle = ui.toggle({ label: 'Vapor', value: false, onChange: (v) => setSteam(v) });
    steamToggle.classList.add('pl-steam-toggle');
    const steamNote = h('p', { class: 'pl-small' }, 'El vapor relaja las fibras naturales (algodón, lino); a los sintéticos y la viscosa no les hace falta. Necesita la plancha en •• o más.');

    const flipBtn = h('button', { class: 'btn btn-secondary pl-flip', type: 'button', onClick: () => startFlip() }, '⟲ Dar vuelta la remera');
    const sideText = h('div', { class: 'pl-side-now' });

    const tip = h(
      'div',
      { class: 'pl-tip' },
      h('b', {}, 'Tip del oficio: '),
      'pasadas largas, de ida y vuelta y a lo largo de la remera. Nunca dejes la plancha quieta apoyada: si parás, llevala al apoya-plancha.',
    );

    const boosted = (state.prewash?.wrinkleBoost || 0) > 0;
    const body = h(
      'div',
      { class: 'pl-panel' },
      fabChip,
      boosted ? ui.note('🌀 El centrifugado fuerte del prelavado la dejó <b>más arrugada</b> de lo normal: vas a necesitar más pasadas.', 'warn') : null,
      ui.section('1 · Temperatura', dial, thermo),
      ui.section('2 · Vapor', steamToggle, steamNote),
      ui.section('3 · Frente y espalda', sideText, flipBtn),
      tip,
    );

    ui.panel({
      kicker: 'Paso 8 · Tabla de planchar',
      title: 'Planchado',
      subtitle: 'La remera salió de la máquina toda arrugada. Elegí la temperatura justa, decidí si va con vapor y pasale la plancha sin quemarla.',
      body,
      actions: [
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => runAuto() },
        { id: 'done', label: 'Listo ✓', kind: 'primary', onClick: () => finish(false) },
      ],
    });
    ui.panelEl?.classList.add('pl-step');
    ctx.track(() => ui.panelEl?.classList.remove('pl-step'));

    // ---------------- HUD y etiqueta sobre la plancha ----------------
    const hud = createHud(h);
    ui.hud(hud.el);
    ui.hudEl?.classList.add('pl-hud-host');
    ctx.track(() => ui.hudEl?.classList.remove('pl-hud-host'));
    const ironLabel = h('div', { class: 'world-label pl-iron-label' });
    ironLabel.style.display = 'none';
    document.getElementById('app').appendChild(ironLabel);
    ctx.track(() => ironLabel.remove());

    const hintStart = () =>
      ui.hint(isMobile() ? 'Primero elegí la <b>temperatura</b> para tu tela en el panel' : 'Primero elegí la <b>temperatura</b> para tu tela (perilla del panel o teclas <kbd>1</kbd>–<kbd>4</kbd>)');
    const hintIron = () =>
      ui.hint(
        isMobile()
          ? 'Apoyá el dedo sobre la remera y deslizá la plancha con pasadas largas'
          : 'Mantené apretado el clic sobre la remera y mové la plancha con pasadas largas · flechas + <kbd>Espacio</kbd> también',
      );
    hintStart();

    // ---------------- controles ----------------
    function refreshPanel() {
      for (const [lv, b] of dialBtns) {
        b.classList.toggle('selected', lv === level);
        b.setAttribute('aria-checked', lv === level ? 'true' : 'false');
      }
      steamToggle.input.checked = steamOn;
      sideText.innerHTML = `Ahora está <b>${up === 'frente' ? 'el frente' : 'la espalda'}</b> arriba.`;
      flipBtn.textContent = up === 'frente' ? '⟲ Dar vuelta: planchar la espalda' : '⟲ Dar vuelta: volver al frente';
      flipBtn.disabled = !!flip || busy;
    }

    // que los botones del panel no se queden con el foco (Espacio es "apoyar la plancha")
    const dropFocus = () => {
      const a = document.activeElement;
      if (a && a !== document.body && a.closest?.('.pl-panel')) a.blur();
    };

    function setLevel(lv) {
      dropFocus();
      if (busy || finished) return;
      lv = clamp(lv | 0, 0, 4);
      if (lv === level) return;
      level = lv;
      ready = false;
      iron.setLevel(lv);
      audio.play('select');
      refreshPanel();
      if (lv > 0 && !heatingHintShown) {
        heatingHintShown = true;
        hintIron();
        ctx.timeout(() => ui.hint(null), 9000);
      }
      if (lv === 1 && steamOn) ui.toast('💧 A • la plancha no llega a hacer vapor: gotea agua.', 'warn', 3200);
    }

    function setSteam(on) {
      dropFocus();
      if (busy || finished) {
        steamToggle.input.checked = steamOn;
        return;
      }
      steamOn = !!on;
      audio.play(steamOn ? 'steam' : 'click');
      if (steamOn && !steamLoop) steamLoop = audio.loop('steam');
      if (steamOn && level === 1) ui.toast('💧 A • la plancha no llega a hacer vapor: gotea agua.', 'warn', 3200);
      refreshPanel();
    }

    // ---------------- dar vuelta ----------------
    function startFlip() {
      dropFocus();
      if (flip || busy || finished) return;
      flip = { t: 0, from: up };
      rig.goRest();
      pressing = keyPress = pointerPress = false;
      hadContact = false;
      audio.play('pop');
      ui.hint(null);
      refreshPanel();
    }
    const qx = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);
    function updateFlip(dt) {
      flip.t = Math.min(1, flip.t + dt / 1.05);
      const e = easeInOutCubic(flip.t);
      // se levanta el lado de atrás y la remera "rueda" hacia uno: el borde de abajo nunca atraviesa la tabla
      const a = (flip.from === 'frente' ? 0 : Math.PI) + Math.PI * e;
      qx.setFromAxisAngle(xAxis, a);
      sg.quaternion.copy(qx).multiply(q0);
      sg.position.set(shirtPos.x, shirtPos.y + Math.sin(Math.PI * e) * (halfZ + 0.02), shirtPos.z);
      if (flip.t >= 1) {
        up = flip.from === 'frente' ? 'espalda' : 'frente';
        stats.flipped = true;
        flip = null;
        sg.position.copy(shirtPos);
        audio.play('thud');
        refreshPanel();
        if (levels[up] > DONE_LEVEL && !autoRun) {
          ui.hint(up === 'espalda' ? 'Ahora la espalda: las mismas pasadas largas' : 'Otra vez el frente arriba');
          ctx.timeout(() => ui.hint(null), 3500);
        }
      }
    }

    // ---------------- puntero ----------------
    const inRegion = (p, m = 0) => p && p.x > region.x0 - m && p.x < region.x1 + m && p.z > region.z0 - m && p.z < region.z1 + m;
    function aimAtPointer() {
      const p = engine.pointerOnPlane(plane);
      if (!inRegion(p, 0.25)) {
        away = true;
        return false;
      }
      away = false;
      target.set(clamp(p.x, region.x0, region.x1), topY, clamp(p.z, region.z0, region.z1));
      return true;
    }
    ctx.onPointer('move', (e) => {
      if (busy || finished) return;
      const onCanvas = e.target === canvas;
      if (e.pointerType === 'touch' && !pointerPress) return;
      if (!onCanvas && !pointerPress) {
        away = true;
        return;
      }
      if (aimAtPointer()) lastInput = simT;
      usedKeys = false;
    });
    let lastPointerType = 'mouse';
    ctx.onPointer('down', (e) => {
      lastPointerType = e.pointerType || 'mouse';
      if (busy || finished || flip || e.target !== canvas) return;
      if (e.button !== undefined && e.button > 0) return;
      if (!aimAtPointer()) return;
      pointerPress = true;
      lastInput = simT;
      usedKeys = false;
      // con el dedo la plancha salta a donde se toca (no hay "flotar" antes)
      if (e.pointerType === 'touch' && (rig.mode === 'rest' || Math.hypot(rig.position.x - target.x, rig.position.z - target.z) > 0.25)) rig.snapXZ(target.x, target.z);
    });
    ctx.onPointer('up', () => {
      pointerPress = false;
    });
    ctx.listen(canvas, 'pointerleave', (e) => {
      // con el dedo, al levantarlo la plancha se queda donde estaba (vuelve sola si no se usa)
      if (!pointerPress && (e.pointerType || lastPointerType) !== 'touch') away = true;
    });
    ctx.listen(canvas, 'contextmenu', (e) => e.preventDefault());

    // ---------------- teclado ----------------
    const MOVE_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };
    ctx.listen(window, 'keydown', (e) => {
      if (busy || finished || e.defaultPrevented) return;
      const tg = e.target;
      if (tg && tg.closest && tg.closest('input, textarea, select')) return;
      if (document.querySelector('.modal-wrap')) return;
      if (/^Digit[0-4]$/.test(e.code) || /^Numpad[0-4]$/.test(e.code)) {
        setLevel(+e.code.slice(-1));
        return;
      }
      if (e.code === 'KeyV' && !e.repeat) {
        setSteam(!steamOn);
        return;
      }
      if (e.code === 'KeyF' && !e.repeat) {
        startFlip();
        return;
      }
      if (MOVE_KEYS[e.code]) {
        e.preventDefault();
        keys.add(e.code);
        if (!usedKeys) {
          usedKeys = true;
          if (rig.mode === 'rest') target.set(board.center.x - 0.05, topY, board.center.z);
          else target.set(rig.position.x, topY, rig.position.z);
        }
        away = false;
        lastInput = simT;
        return;
      }
      if (e.code === 'Space' && !(tg && tg.closest && tg.closest('button'))) {
        e.preventDefault();
        if (flip) return;
        if (!usedKeys && rig.mode === 'rest') {
          usedKeys = true;
          target.set(board.center.x - 0.05, topY, board.center.z);
        }
        away = false;
        keyPress = true;
        lastInput = simT;
      }
    });
    ctx.listen(window, 'keyup', (e) => {
      keys.delete(e.code);
      if (e.code === 'Space') keyPress = false;
    });
    ctx.listen(window, 'blur', () => {
      keys.clear();
      keyPress = pointerPress = false;
    });

    // ---------------- geometría de apoyo ----------------
    const toGarment = (wx, wz, out) => {
      tmpV.set(wx, topY, wz).applyMatrix4(inv);
      out.x = tmpV.x;
      out.y = tmpV.y;
      return out;
    };
    const gp = { x: 0, y: 0 };
    const onShirt = (x, y) => pointInPolygon(x, y, outlines[up]);
    const onBoard = (wx, wz) => wx > board.center.x - halfL && wx < board.center.x + halfL - 0.02 && Math.abs(wz - board.center.z) < halfW * (wx > board.center.x + 0.06 ? 1 - ((wx - board.center.x - 0.06) / (halfL - 0.06)) ** 2 * 0.8 : 1);
    // altura de la cara de arriba de la remera en un punto de prenda
    function shirtTopAt(x, y) {
      const { position } = shirt.garmentToLocal(up, x, y, 0);
      tmpL.copy(position).applyMatrix4(sg.matrixWorld);
      return tmpL.y;
    }

    // ---------------- simulación por cuadro ----------------
    const heatOut = { heat: 0, x: 0, y: 0 };
    function simulate(dt) {
      simT += dt;
      // temperatura de la suela
      const targetT = levelTemp(catalog, level);
      T = stepTemp(T, targetT, dt);
      const wasReady = ready;
      ready = level > 0 && Math.abs(T - targetT) < 4;
      iron.setHot(level > 0 ? clamp((T - ROOM_TEMP) / (targetT - ROOM_TEMP)) : clamp((T - ROOM_TEMP) / 200));
      if (ready && !wasReady && !autoRun) {
        audio.play('tick');
        ui.toast(`🌡 La plancha llegó a ${dots(level)} (${targetT} °C)`, 'info', 2200);
      }
      const steamActive = steamWorks(T, steamOn) && level > 0;
      // el vapor sale mientras la suela apoya (y un ratito después de levantarla)
      iron.setSteam(steamActive && !flip && rig.mode === 'follow' && simT - lastContactT < 0.45);

      // movimiento con teclado
      if (keys.size && !flip) {
        let mx = 0;
        let mz = 0;
        for (const k of keys) {
          mx += MOVE_KEYS[k][0];
          mz += MOVE_KEYS[k][1];
        }
        const l = Math.hypot(mx, mz) || 1;
        target.x = clamp(target.x + (mx / l) * 0.42 * dt, region.x0, region.x1);
        target.z = clamp(target.z + (mz / l) * 0.42 * dt, region.z0, region.z1);
        lastInput = simT;
      }

      pressing = (pointerPress || keyPress) && !flip;
      inv.copy(sg.matrixWorld).invert();

      // a dónde va la plancha
      if (autoRun) {
        // la maneja runAuto
      } else if (flip || finished) rig.goRest();
      else if ((away && !pressing) || (!pressing && simT - lastInput > 7)) rig.goRest();
      else {
        toGarment(target.x, target.z, gp);
        let y;
        if (onShirt(gp.x, gp.y)) y = shirtTopAt(gp.x, gp.y) + 0.0012;
        else if (onBoard(target.x, target.z)) y = board.surfaceY + 0.001;
        else y = topY + 0.01;
        contactYs += (y - contactYs) * (1 - Math.exp(-dt * 20));
        rig.follow(target.x, target.z, contactYs, pressing);
      }
      rig.update(dt);

      // contacto con la tela
      const p = rig.position;
      toGarment(p.x, p.z, gp);
      const overShirt = !flip && onShirt(gp.x, gp.y);
      const contact = rig.inContact && overShirt && !flip;
      let maxHeat = 0;
      const c = Math.cos(rig.yaw);
      const s = Math.sin(rig.yaw);
      if (contact) {
        if (!stats.started) stats.started = true;
        if (level > 0) {
          stats.contact[level] += dt;
          if (steamActive) stats.steamContact += dt;
        }
        // alisar a lo largo del recorrido de este cuadro (así una pasada rápida no deja huecos)
        const rate = smoothRate(fabric, T, Ti, steamActive) * (autoRun ? autoRun.boost : 1);
        if (rate > 0) {
          const from = hadContact ? prevContact : p;
          const dist = Math.hypot(p.x - from.x, p.z - from.z);
          const n = clamp(Math.ceil(dist / 0.02), 1, 14);
          const st = (rate * dt) / n;
          for (let i = 1; i <= n; i++) {
            const k = i / n;
            const wx = from.x + (p.x - from.x) * k;
            const wz = from.z + (p.z - from.z) * k;
            for (const [off, r] of FOOT) {
              toGarment(wx + c * off, wz - s * off, gp);
              shirt.smoothWrinkles(up, gp.x, gp.y, r, st);
            }
          }
        }
        // calor: quieta o demasiado caliente → marca
        if (!autoRun) {
          const hr = heatRate(T, Ti, rig.speed) * dt;
          heatOut.heat = 0;
          if (hr > 0) {
            for (const [off, r] of FOOT) {
              toGarment(p.x + c * off, p.z - s * off, gp);
              heat.add(up, gp.x, gp.y, r * 0.9, hr, onShirt, heatOut);
            }
          }
          maxHeat = heatOut.heat;
          if (heatOut.heat >= 1 && simT - lastMarkT > 1.1) {
            markFabric(heatOut.x, heatOut.y);
            // la suela entera "descarga" el calor en la marca: da tiempo a reaccionar
            toGarment(p.x, p.z, gp);
            heat.clear(up, gp.x, gp.y, 0.17);
          }
        }
        if (!hadContact && steamActive && simT - lastPuffT > 0.9) {
          lastPuffT = simT;
          audio.play('steam');
        }
        prevContact.copy(p);
        hadContact = true;
        lastContactT = simT;
        stillT = rig.speed < 0.03 ? stillT + dt : 0;
      } else {
        hadContact = false;
        stillT = 0;
      }
      heat.cool(dt);
      if (stats.started && !finished && !flip) stats.activeTime += dt;

      // niveles de arrugas
      levels.frente = shirt.wrinkleLevel('frente');
      levels.espalda = shirt.wrinkleLevel('espalda');

      // sonido del vapor
      if (steamLoop) steamLoop.set(steamActive && rig.mode === 'follow' ? (contact ? 0.9 : simT - lastContactT < 0.45 ? 0.4 : 0.08) : 0);

      return { contact, overShirt, maxHeat, steamActive, targetT };
    }

    function markFabric(x, y) {
      lastMarkT = simT;
      const over = overHeat(T, Ti);
      if (stats.burns < MAX_MARKS) {
        const kind = melts && over > 0 ? 'melt' : 'scorch';
        shirt.addScorch(up, x, y, 0.04 + Math.min(0.025, over * 0.03), clamp(0.45 + over * 0.6, 0.35, 1), kind);
        stats.burns++;
        if (kind === 'melt') stats.melts++;
        if (over > 0) stats.hotBurns++;
      }
      heat.clear(up, x, y, 0.12);
      audio.play('hiss');
      audio.play('bad');
      const msg = over > 0 ? (melts ? '🔥 ¡Se derritió la tela! Demasiado caliente para esta fibra' : '🔥 ¡Se quemó! Demasiado caliente para esta tela') : '🔥 ¡Marcaste la tela! La plancha quedó quieta demasiado tiempo';
      ui.toast(msg, 'bad', 3200);
    }

    // ---------------- cuadro ----------------
    let alertUntil = 0;
    let timeScale = 1; // solo para pruebas automáticas (_test.timeScale)
    ctx.onUpdate((dt0) => {
      const dt = dt0 * timeScale;
      // la luz de trabajo entra suave al llegar y se va al terminar
      const litGoal = finished && !autoRun ? 0 : 1;
      if (litK !== litGoal) {
        litK = litGoal > litK ? Math.min(1, litK + dt / 1.2) : Math.max(0, litK - dt / 0.8);
        applyLight(easeInOutCubic(litK));
      }
      if (finished && !autoRun) {
        rig.goRest();
        rig.update(dt);
        return;
      }
      if (flip) updateFlip(dt);
      if (autoRun) autoStep(dt);
      const r = simulate(dt);

      // HUD
      hud.setSides(levels, flip ? null : up);
      hud.setTemp(T, r.targetT, ready);
      hud.setSteam(!steamOn ? 'off' : r.steamActive ? 'on' : 'cold');
      hud.setBurns(stats.burns, stats.melts > 0);
      hud.setTime(stats.started ? stats.activeTime : null);
      let alert = null;
      let kind = 'warn';
      if (autoRun) {
        alert = 'Planchando en automático…';
        kind = 'info';
      } else if (r.maxHeat > 0.5) {
        alert = overHeat(T, Ti) > 0 ? '🔥 ¡Muy caliente para esta tela! Bajá la temperatura' : '🔥 ¡Se está recalentando! Mové la plancha';
        kind = 'bad';
        if (simT - lastHissT > 1.4) {
          lastHissT = simT;
          audio.play('hiss');
        }
      } else if (stillT > 1.2) alert = '✋ No la dejes quieta: movela';
      else if (pressing && level === 0 && r.overShirt) alert = '❄️ La plancha está apagada: elegí la temperatura';
      else if (pressing && r.overShirt && T < Ti * 0.7 && level > 0) alert = '⏳ Todavía está tibia: esperá a que caliente';
      else if (steamOn && level > 0 && !r.steamActive && T >= targetTempOf(level) - 4) alert = '💧 A esta temperatura no hace vapor';
      else if (simT < alertUntil) alert = hudMsg;
      if (alert === hudMsg) kind = hudMsgKind;
      hud.setAlert(alert, kind);

      updateThermo(r.targetT);
      // etiqueta flotante sobre la plancha
      updateIronLabel(r);

      // cursor
      canvas.style.cursor = pressing ? 'grabbing' : !away && rig.mode === 'follow' ? 'grab' : '';

      // avisos de progreso
      if (!autoRun && !flip) {
        if (r.contact && !firstContactHint) {
          firstContactHint = true;
          ui.hint(null);
        }
        if (levels[up] <= DONE_LEVEL && levels[other(up)] > DONE_LEVEL && !frontDoneToast) {
          frontDoneToast = true;
          audio.play('good');
          showHudMsg(`✓ ¡${up === 'frente' ? 'Frente' : 'Espalda'} lista! Ahora dala vuelta`, 'good', 4);
          flipBtn.classList.add('pulse');
          ui.hint(isMobile() ? 'Tocá <b>Dar vuelta</b> para planchar el otro lado' : 'Tocá <b>Dar vuelta</b> (o <kbd>F</kbd>) para planchar el otro lado');
          ctx.timeout(() => ui.hint(null), 5000);
        }
        if (levels.frente <= DONE_LEVEL && levels.espalda <= DONE_LEVEL && !finished) {
          showHudMsg('✓ ¡Remera lisita!', 'good', 3);
          finish(false, true);
        }
      }
      if (flip) flipBtn.classList.remove('pulse');
    });
    const other = (s) => (s === 'frente' ? 'espalda' : 'frente');
    const targetTempOf = (lv) => levelTemp(catalog, lv);
    let hudMsg = null;
    let hudMsgKind = 'info';
    function showHudMsg(text, kind = 'info', secs = 3) {
      hudMsg = text;
      hudMsgKind = kind;
      alertUntil = simT + secs;
    }

    let thermoKey = '';
    function updateThermo(targetT) {
      const t = Math.round(T);
      const key = `${t}|${level}|${ready}`;
      if (key === thermoKey) return;
      thermoKey = key;
      thermFill.style.width = `${clamp((T - 20) / 220) * 100}%`;
      if (level === 0) thermText.innerHTML = t > 40 ? `Apagada · se enfría (${t} °C)` : 'Apagada · elegí una temperatura';
      else if (ready) thermText.innerHTML = `<b>✓ Lista</b> a ${targetT} °C`;
      else if (T < targetT) thermText.innerHTML = `Calentando… <b>${t}</b> / ${targetT} °C`;
      else thermText.innerHTML = `Enfriando… <b>${t}</b> / ${targetT} °C`;
      thermo.classList.toggle('ready', ready);
    }

    const labelPos = new THREE.Vector3();
    function updateIronLabel(r) {
      let txt = '';
      let cls = '';
      if (rig.mode === 'follow' && !flip && !autoRun && !finished) {
        if (r.maxHeat > 0.5) {
          txt = '¡Quema!';
          cls = 'bad';
        } else if (level === 0) {
          txt = 'Apagada';
          cls = 'cold';
        } else if (!ready && T < r.targetT) {
          txt = `${Math.round(T)} °C…`;
          cls = 'heating';
        }
      }
      if (!txt) {
        ironLabel.style.display = 'none';
        return;
      }
      labelPos.copy(rig.position);
      labelPos.y += 0.17;
      const sp = engine.worldToScreen(labelPos);
      if (sp.behind) {
        ironLabel.style.display = 'none';
        return;
      }
      ironLabel.style.display = '';
      if (ironLabel.textContent !== txt) ironLabel.textContent = txt;
      ironLabel.className = `world-label pl-iron-label ${cls}`;
      ironLabel.style.left = `${sp.x}px`;
      ironLabel.style.top = `${sp.y}px`;
    }

    // ---------------- automático ----------------
    // Recorre cada lado con pasadas a lo largo de la remera (de una manga a la otra) y la da vuelta.
    function lanesFor(side) {
      const poly = outlines[side];
      let minX = Infinity;
      let maxX = -Infinity;
      for (const q of poly) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
      }
      const pts = [];
      const step = 0.06;
      let dir = 1;
      for (let x = minX + 0.04; x <= maxX - 0.03; x += step) {
        // intervalo en y dentro del contorno para esta franja
        const ys = [];
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const xa = poly[a].x;
          const xb = poly[b].x;
          if (xa > x !== xb > x) ys.push(poly[a].y + ((x - xa) / (xb - xa)) * (poly[b].y - poly[a].y));
        }
        if (ys.length < 2) continue;
        const y0 = Math.min(...ys) + 0.05;
        const y1 = Math.max(...ys) - 0.05;
        if (y1 <= y0) continue;
        if (dir > 0) pts.push([x, y0], [x, y1]);
        else pts.push([x, y1], [x, y0]);
        dir = -dir;
      }
      return pts;
    }
    function runAuto() {
      if (busy || finished || autoRun) return;
      ui.hint(null);
      ui.enableAction('auto', false);
      ui.enableAction('done', false);
      flipBtn.disabled = true;
      keys.clear();
      pointerPress = keyPress = false;
      level = fabric.ironLevel;
      iron.setLevel(level);
      steamOn = !!fabric.ironSteam;
      if (steamOn && !steamLoop) steamLoop = audio.loop('steam');
      refreshPanel();
      for (const b of dial.querySelectorAll('button')) b.disabled = true;
      steamToggle.input.disabled = true;
      // la plancha ya estaba enchufada: llega a temperatura enseguida
      // fuerza ajustada para que una sola recorrida deje la remera casi lisa en cualquier tela
      const boost = 20 / Math.max(0.5, smoothRate(fabric, Ti, Ti, steamWorks(Ti, steamOn)));
      autoRun = { phase: 'heat', t: 0, boost, sidesLeft: [up, other(up)], path: null, i: 0, side: up };
      audio.play('select');
    }
    const autoP = new THREE.Vector3();
    function autoStep(dt) {
      const A = autoRun;
      A.t += dt;
      if (A.phase === 'heat') {
        T = Math.min(levelTemp(catalog, level), T + dt * 260);
        if (!A.path) {
          A.path = lanesFor(up).map(([x, y]) => {
            const w = new THREE.Vector3(x, y, 0).applyMatrix4(sg.matrixWorld);
            return [w.x, w.z, x, y];
          });
          A.i = 0;
          A.seg = 0;
        }
        // viaja levantada hasta el comienzo de la primera pasada
        const p0 = A.path[0];
        rig.follow(p0[0], p0[1], shirtTopAt(p0[2], p0[3]) + 0.0012, false);
        if (A.t > 0.7) A.phase = 'path';
        return;
      }
      if (A.phase === 'path') {
        if (flip) return;
        const pts = A.path;
        // avanza el objetivo a lo largo del recorrido a velocidad constante
        let adv = dt * 2.6;
        while (adv > 0 && A.i < pts.length - 1) {
          const a = pts[A.i];
          const b = pts[A.i + 1];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const left = L * (1 - A.seg);
          if (adv >= left) {
            adv -= left;
            A.i++;
            A.seg = 0;
          } else {
            A.seg += adv / L;
            adv = 0;
          }
        }
        if (A.i >= pts.length - 1) {
          A.sidesLeft.shift();
          if (A.sidesLeft.length) {
            A.phase = 'flip';
            startFlipAuto();
          } else {
            A.phase = 'end';
            A.t = 0;
            rig.goRest();
          }
          return;
        }
        const a = pts[A.i];
        const b = pts[A.i + 1];
        autoP.set(a[0] + (b[0] - a[0]) * A.seg, 0, a[1] + (b[1] - a[1]) * A.seg);
        const gx = a[2] + (b[2] - a[2]) * A.seg;
        const gy = a[3] + (b[3] - a[3]) * A.seg;
        // de una franja a la otra la plancha sigue apoyada (se desliza de costado)
        const y = onShirt(gx, gy) ? shirtTopAt(gx, gy) + 0.0012 : topY;
        rig.follow(autoP.x, autoP.z, y, true, true);
        return;
      }
      if (A.phase === 'flip') {
        if (!flip) {
          A.phase = 'heat';
          A.path = null;
          A.t = 0.2;
        }
        return;
      }
      if (A.phase === 'end') {
        rig.goRest();
        if (A.t > 0.6 && !A.done) {
          A.done = true;
          finish(true, true);
        }
      }
    }
    function startFlipAuto() {
      flip = { t: 0, from: up };
      rig.goRest();
      hadContact = false;
      audio.play('pop');
      refreshPanel();
    }

    // ---------------- terminar ----------------
    async function finish(auto, automatic = false) {
      if (finished || busy) return;
      if (!auto && !automatic) {
        const worst = Math.max(levels.frente, levels.espalda);
        if (worst > 0.25) {
          busy = true;
          const id = await ui.modal({
            title: '¿Terminar el planchado?',
            body: h(
              'p',
              {},
              `Todavía quedan arrugas: frente ${Math.round(levels.frente * 100)} %, espalda ${Math.round(levels.espalda * 100)} %.`,
              !stats.flipped ? ' ¡Y no le diste vuelta!' : '',
            ),
            actions: [
              { id: 'seguir', label: 'Seguir planchando', kind: 'secondary' },
              { id: 'fin', label: 'Terminar igual', kind: 'primary' },
            ],
          });
          busy = false;
          if (!ctx.alive) return;
          if (id !== 'fin') return;
        }
      }
      finished = true;
      busy = true;
      pointerPress = keyPress = false;
      keys.clear();
      ui.enableAction('auto', false);
      ui.enableAction('done', false);
      flipBtn.disabled = true;
      ui.hint(null);
      ironLabel.style.display = 'none';
      rig.goRest();
      // espera a que la plancha vuelva al apoya-plancha y la apaga
      await new Promise((r) => ctx.timeout(r, automatic && !auto ? 1100 : 700));
      if (!ctx.alive) return;
      iron.setSteam(false);
      iron.setLevel(0);
      steamLoop?.set(0);
      levels.frente = shirt.wrinkleLevel('frente');
      levels.espalda = shirt.wrinkleLevel('espalda');
      const res = scoreIroning(catalog, state, fabric, { ...stats, sides: { ...levels } }, { auto });
      state.ironing = {
        smooth: Math.round(res.smooth * 1000) / 1000,
        burns: stats.burns,
        level: res.dominant,
        steam: res.steam,
        sides: { frente: Math.round(levels.frente * 1000) / 1000, espalda: Math.round(levels.espalda * 1000) / 1000 },
        time: Math.round(stats.activeTime),
      };
      const extra = h(
        'div',
        { class: 'pl-result' },
        h('span', { class: 'pl-chip' }, `Frente ${Math.round(levels.frente * 100)} %`),
        h('span', { class: 'pl-chip' }, `Espalda ${Math.round(levels.espalda * 100)} %`),
        h('span', { class: 'pl-chip' }, `Plancha ${dots(res.dominant)}`),
        h('span', { class: 'pl-chip' }, res.steam ? 'Con vapor' : 'Sin vapor'),
        h('span', { class: `pl-chip ${stats.burns ? 'bad' : 'good'}` }, stats.burns ? `${stats.burns} marca${stats.burns > 1 ? 's' : ''}` : 'Sin marcas'),
      );
      autoRun = null;
      await ctx.complete({ score: res.score, notes: res.notes, extra });
    }

    // ---------------- pruebas automáticas (window.__taller.step._test) ----------------
    step._test = {
      info: () => ({
        level,
        T: Math.round(T),
        ready,
        steamOn,
        up,
        flipping: !!flip,
        levels: { frente: +levels.frente.toFixed(3), espalda: +levels.espalda.toFixed(3) },
        stats: JSON.parse(JSON.stringify(stats)),
        iron: rig.position.toArray().map((v) => +v.toFixed(3)),
        mode: rig.mode,
        finished,
        auto: !!autoRun,
      }),
      // Avanza la simulación `secs` segundos de una (sin renderizar) a pasos de 1/30 s.
      run(secs = 1) {
        const n = Math.round(secs * 30);
        for (let i = 0; i < n; i++) {
          if (flip) updateFlip(1 / 30);
          if (autoRun) autoStep(1 / 30);
          simulate(1 / 30);
          shirt.update();
        }
        return this.info();
      },
      // Simula una pasada apretando de (x0,z0) a (x1,z1) en mundo, a `speed` m/s.
      stroke(x0, z0, x1, z1, speed = 0.4) {
        const L = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(2, Math.round((L / speed) * 30));
        away = false;
        pointerPress = true;
        for (let i = 0; i <= n; i++) {
          const k = i / n;
          target.set(x0 + (x1 - x0) * k, topY, z0 + (z1 - z0) * k);
          lastInput = simT;
          simulate(1 / 30);
          shirt.update();
        }
        pointerPress = false;
        return this.info();
      },
      timeScale(k = 1) {
        timeScale = k;
        return k;
      },
      // suelta todo y manda la plancha al apoya-plancha
      release() {
        pointerPress = keyPress = false;
        keys.clear();
        away = true;
        return this.run(1.2);
      },
      snapCamera() {
        engine.flyTo({ ...view(), duration: 0 });
        litK = 1;
        applyLight(1);
        return true;
      },
      // Recorrida continua de ida y vuelta (como un jugador): franjas a lo largo de X entre z0 y z1.
      sweep(z0 = -2.34, z1 = -1.56, lanes = 11, speed = 0.5, x0 = 2.96, x1 = 3.64) {
        const pts = [];
        for (let i = 0; i < lanes; i++) {
          const z = z0 + ((z1 - z0) * i) / Math.max(1, lanes - 1);
          if (i % 2 === 0) pts.push([x0, z], [x1, z]);
          else pts.push([x1, z], [x0, z]);
        }
        away = false;
        target.set(pts[0][0], topY, pts[0][1]);
        pointerPress = true;
        for (let k = 1; k < pts.length; k++) {
          const [ax, az] = pts[k - 1];
          const [bx, bz] = pts[k];
          const n = Math.max(2, Math.round((Math.hypot(bx - ax, bz - az) / speed) * 30));
          for (let i = 1; i <= n; i++) {
            target.set(ax + ((bx - ax) * i) / n, topY, az + ((bz - az) * i) / n);
            lastInput = simT;
            simulate(1 / 30);
            shirt.update();
          }
        }
        pointerPress = false;
        return this.info();
      },
      // fija el giro en un punto (0..1) para capturas
      flipAt(t) {
        if (!flip) flip = { t: 0, from: up };
        flip.t = Math.max(0, Math.min(0.999, t)) - 1e-6;
        updateFlip(1e-6);
        return { t: flip.t };
      },
      setT(v) {
        T = v;
        return this.info();
      },
      shirtBounds() {
        const box = new THREE.Box3();
        const pm = shirt.getPanelMeshes();
        box.setFromObject(pm[up]);
        return { min: box.min.toArray(), max: box.max.toArray() };
      },
      region,
    };
    ctx.track(() => {
      if (step._test) delete step._test;
    });

    refreshPanel();
  },
};
