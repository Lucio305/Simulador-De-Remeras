// Paso 8 · Planchado. La remera recién cosida llega arrugada a la tabla: hay que elegir la
// temperatura justa para la tela (puntos de la perilla), decidir si usar vapor y pasar la
// plancha 3D sobre el frente y la espalda. Si la plancha está más caliente de lo que la
// tela aguanta, o se queda quieta apoyada, la tela se marca (o se derrite, si es sintética).
// Lo que sobresale de la tabla (costados y mangas) cuelga por el borde: se alisa cuando la
// plancha pasa por el borde de la tabla (el calor y el vapor bajan por la tela que cuelga).

import { createIronRig } from './planchado/ironRig.js';
import { createHeatMap } from './planchado/heatMap.js';
import { createHud } from './planchado/hud.js';
import { createDrape, boardHalfWidth } from './planchado/drape.js';
import { createWrinkleOverlay } from './planchado/wrinkleOverlay.js';
import {
  ROOM_TEMP, DONE_LEVEL, levelTemp, idealTemp, meltsInsteadOfScorch, wrinkleAmountFor, hardnessFor,
  stepTemp, overHeat, steamWorks, smoothRate, heatRate, scoreIroning, dots,
} from './planchado/rules.js';
import { fabricSwatch } from '../materials/fabric.js';
import { clamp, pointInPolygon, easeInOutCubic, smoothstep } from '../core/utils.js';

// Huella de la suela: círculos a lo largo del eje de la plancha (offset desde el centro, radio).
const FOOT = [
  [-0.066, 0.064],
  [0, 0.066],
  [0.062, 0.05],
];
// Puntos de la suela para saber si pisa la remera (a lo largo, de costado).
const SOLE_PTS = [
  [0, 0],
  [-0.1, 0],
  [-0.05, 0],
  [0.05, 0],
  [0.11, 0],
  [-0.06, 0.045],
  [-0.06, -0.045],
  [0.03, 0.045],
  [0.03, -0.045],
];
const MAX_MARKS = 8;
// Distancia del borde de la tabla al comienzo del doblez de la tela (borde redondeado de la funda).
const DRAPE_GAP = 0.017;
// La plancha no se acerca más que esto al borde de la tabla (la suela no queda colgando).
const IRON_MARGIN = 0.03;
// Fuerza con la que una pasada por el borde de la tabla alisa la tela que cuelga.
const SPILL = 0.9;
const FLIP_SECS = 1.35;

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
<li><b>Lo que cuelga</b> de la tabla (costados y mangas) se alisa cuando pasás la plancha pegada al borde de la tabla.</li>
<li><b>Vapor</b> (<span class="kbd">V</span>): relaja las fibras naturales (algodón, lino). Necesita la plancha en •• o más.</li>
<li><b>Resaltar arrugas</b> (<span class="kbd">R</span>): pinta lo que todavía falta planchar.</li>
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
    const hardness = hardnessFor(state.prewash);
    const lum = catalog.luminance(state.fabric.color || '#ffffff');
    const dark = lum < 0.2;
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
    const wrinkleAmt = wrinkleAmountFor(fabric, state.prewash, dark);
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
    const cz = board.center.z;
    const lenG = -ext.minY;
    const halfZ = Math.max(-ext.minX, ext.maxX);
    const boardEnd = board.center.x - halfL;
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ'));
    const xAxis = new THREE.Vector3(1, 0, 0);
    const qBack = new THREE.Quaternion().setFromAxisAngle(xAxis, Math.PI).multiply(q0);
    const shirtPos = new THREE.Vector3(Math.max(board.center.x + 0.12, boardEnd + 0.035 + lenG), board.surfaceY + 0.023, cz);
    const shirtCX = shirtPos.x - lenG / 2;
    const sg = shirt.group;
    sg.position.copy(shirtPos);
    sg.quaternion.copy(q0);
    sg.updateMatrixWorld(true);
    ctx.track(() => {
      sg.rotation.set(0, 0, 0);
      sg.scale.set(1, 1, 1);
      sg.updateMatrixWorld(true);
    });
    const topY = board.surfaceY + 0.042; // altura aproximada de la cara de arriba de la remera

    // ancho de la tabla a lo largo de su eje (la punta se angosta)
    const bhw = boardHalfWidth(board.length, board.width);
    const halfWAt = (wx) => bhw(wx - board.center.x);
    // la tela que pasa el borde de la tabla cuelga (los dos lados, con el lado de arriba según `up`)
    const limitAt = (gy) => Math.max(0.05, halfWAt(shirtPos.x + gy) - DRAPE_GAP);
    const drape = createDrape(shirt, { limitAt });
    ctx.track(() => drape.dispose());
    let drapeK = 0; // la tela "cae" sobre la tabla al llegar
    // zona por donde anda la plancha: arriba de la tabla (sin la punta ni el extremo cuadrado)
    const region = {
      x0: boardEnd + 0.1,
      x1: board.center.x + halfL - 0.17,
      z0: cz - halfW + IRON_MARGIN,
      z1: cz + halfW - IRON_MARGIN,
    };
    // (si la tela no puede caer por el borde, la plancha tiene que poder llegar a toda la remera)
    if (!drape.supported) {
      region.x0 = Math.min(boardEnd - 0.05, shirtPos.x + ext.minY - 0.08);
      region.x1 = Math.max(board.center.x + halfL, shirtPos.x + ext.maxY + 0.1);
      region.z0 = cz - halfZ - 0.07;
      region.z1 = cz + halfZ + 0.07;
    }
    const clampToBoard = (v) => {
      v.x = clamp(v.x, region.x0, region.x1);
      if (!drape.supported) {
        v.z = clamp(v.z, region.z0, region.z1);
        return v;
      }
      const hw = Math.max(0.04, halfWAt(v.x) - IRON_MARGIN);
      v.z = clamp(v.z, cz - hw, cz + hw);
      return v;
    };
    // ancho máximo de la prenda por fila (para alisar lo que cuelga)
    const ROW = 0.01;
    const rowY0 = ext.minY - 0.02;
    const rows = Math.ceil((ext.maxY + 0.02 - rowY0) / ROW) + 1;
    const rowMaxX = {};
    for (const side of ['frente', 'espalda']) {
      const poly = outlines[side];
      const arr = new Float32Array(rows);
      for (let j = 0; j < rows; j++) {
        const y = rowY0 + j * ROW;
        let mx = 0;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const ya = poly[a].y;
          const yb = poly[b].y;
          if (ya > y !== yb > y) mx = Math.max(mx, Math.abs(poly[a].x + ((y - ya) / (yb - ya)) * (poly[b].x - poly[a].x)));
        }
        arr[j] = mx;
      }
      rowMaxX[side] = arr;
    }
    const maxXAt = (side, y) => rowMaxX[side][clamp(Math.round((y - rowY0) / ROW), 0, rows - 1)];

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
    let hintOn = false;
    const keys = new Set();
    const target = new THREE.Vector3(board.center.x, topY, cz);
    const stats = { contact: { 1: 0, 2: 0, 3: 0, 4: 0 }, steamContact: 0, activeTime: 0, burns: 0, melts: 0, hotBurns: 0, started: false, flipped: false };
    const levels = { frente: 1, espalda: 1 };
    // para detectar cuando el lado de arriba "no baja más" (quedan arrugas escondidas)
    const stuck = { acc: 0, hist: [], lastT: -100 };
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
    // (es lo que hace cualquiera que plancha: mirar la tela a contraluz). En telas oscuras la luz
    // rasante es más fuerte. Se restaura al salir.
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
    const lit1 = dark ? { hemi: 0.3, sun: 1.1, fill: 4.8, env: 0.15 } : { hemi: 0.33, sun: 1.2, fill: 3.6, env: 0.16 };
    const fillColor1 = new THREE.Color('#fff1dc');
    const fillPos1 = new THREE.Vector3(board.center.x - 3, board.center.y + 0.4, cz + 0.4);
    let litK = 0;
    function applyLight(k) {
      if (!L.fill) return;
      const mix = (a, b) => a + (b - a) * k;
      L.hemi.intensity = mix(lit0.hemi, lit1.hemi);
      L.sun.intensity = mix(lit0.sun, lit1.sun);
      engine.scene.environmentIntensity = mix(lit0.env, lit1.env);
      L.fill.intensity = mix(lit0.fill, lit1.fill);
      L.fill.color.copy(lit0.fillColor).lerp(fillColor1, k);
      L.fill.position.copy(lit0.fillPos).lerp(fillPos1, k);
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

    // ---------------- lectura de arrugas (brillo en telas oscuras + resaltado) ----------------
    const sheenK = clamp((0.34 - lum) / 0.22);
    const fc = new THREE.Color(state.fabric.color || '#ffffff');
    const fhsl = {};
    fc.getHSL(fhsl);
    const chroma = Math.max(fc.r, fc.g, fc.b) - Math.min(fc.r, fc.g, fc.b);
    // el resaltado contrasta con la tela: ámbar en general, celeste en telas naranjas/amarillas/rojas
    const hintColor = chroma > 0.2 && (fhsl.h < 0.2 || fhsl.h > 0.93) ? '#4f8dff' : '#ff9a2a';
    const overlay = createWrinkleOverlay(shirt, {
      lightDir: fillPos1.clone().sub(board.center),
      sheen: sheenK,
      sheenColor: dark ? '#c4ccd8' : '#ffffff',
      hintColor,
    });
    if (overlay) ctx.track(() => overlay.dispose());

    // ---------------- cámara ----------------
    // lo que se ve de ancho: la tabla y lo que cuelga (si la tela no puede caer, toda la remera)
    const visHalfZ = drape.supported ? Math.min(halfZ, halfW + 0.06) : halfZ;
    const hang = drape.supported ? Math.max(0, halfZ - halfW) : 0;
    const view = () => {
      if (isMobile()) {
        const k = Math.max(1, (2 * visHalfZ + 0.12) / 0.93, (lenG + 0.12) / 0.84);
        const tx = shirtCX - 0.01;
        // el recuadro de arriba tapa el fondo de la tabla: la remera va un poco más abajo en la pantalla
        const tz = cz - 0.12 + Math.min(0.12, hang * 0.22);
        return { position: [tx, board.surfaceY + 2.39 * k, tz + 1.05 * k], target: [tx, board.surfaceY - Math.min(0.1, hang * 0.15), tz] };
      }
      // en ventanas más angostas (menos lugar libre al lado del panel) o con mangas largas, la cámara se aleja
      const freeW = Math.max(300, window.innerWidth - 404);
      const kW = clamp(1.15 / (freeW / Math.max(300, window.innerHeight)), 1, 1.45);
      const kS = Math.max(1, ((2 * visHalfZ + 0.15) * 0.87) / 1.18, (lenG + 0.1) / 0.84, 1 + hang * 0.18);
      const k = Math.max(kW, kS);
      // en ventanas angostas el recuadro de arriba a la izquierda tapa el ruedo: correr la remera a la derecha
      const shiftX = 0.22 * clamp((1400 - window.innerWidth) / 500);
      const tx = shirtCX - 0.07 - 0.06 * (k - 1) - shiftX;
      // lo que cuelga del lado de la cámara queda más abajo: correr un poco el centro
      const tz = cz + 0.03 + Math.min(0.1, hang * 0.25);
      return { position: [tx, board.surfaceY + 1.37 * k, tz + 0.79 * k], target: [tx, board.surfaceY - Math.min(0.08, hang * 0.15), tz] };
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
    for (const lv of catalog.IRON_LEVELS) {
      const b = h(
        'button',
        { class: 'pl-dial-btn', type: 'button', role: 'radio', title: `${lv.name} · ${lv.temp} °C (${lv.level})`, onClick: () => setLevel(lv.level) },
        h('span', { class: 'pl-dial-dots' }, dots(lv.level)),
        h('span', { class: 'pl-dial-temp' }, `${lv.temp} °C`),
        h('span', { class: 'pl-dial-label' }, lv.label),
      );
      dialBtns.set(lv.level, b);
      dial.appendChild(b);
    }
    const thermText = h('div', { class: 'pl-heat-text' });
    const thermFill = h('i');
    const thermo = h('div', { class: 'pl-heat' }, h('span', { class: 'pl-heat-bar' }, thermFill), thermText);

    const steamToggle = ui.toggle({ label: 'Vapor', value: false, onChange: (v) => setSteam(v) });
    steamToggle.classList.add('pl-steam-toggle');
    steamToggle.title = 'Vapor (V)';
    const steamNote = h('p', { class: 'pl-small' }, 'El vapor relaja las fibras naturales (algodón, lino); a los sintéticos y la viscosa no les hace falta. Necesita la plancha en •• o más.');
    const hintToggle = ui.toggle({ label: 'Resaltar arrugas', value: false, onChange: (v) => setHint(v) });
    hintToggle.classList.add('pl-hint-toggle');
    hintToggle.title = 'Resaltar lo que falta planchar (R)';
    const hintNote = h(
      'p',
      { class: 'pl-small' },
      'Pinta de color lo que todavía falta planchar. Lo que cuelga de la tabla (costados y mangas) se alisa pasando la plancha pegada al borde.',
    );

    const tip = h(
      'div',
      { class: 'pl-tip' },
      h('b', {}, 'Tip del oficio: '),
      'pasadas largas, de ida y vuelta y a lo largo de la remera. Nunca dejes la plancha quieta apoyada: si parás, llevala al apoya-plancha.',
    );

    const boosted = hardness > 1.001;
    const body = h(
      'div',
      { class: 'pl-panel' },
      fabChip,
      boosted ? ui.note('🌀 El centrifugado fuerte del prelavado la dejó <b>más arrugada</b> de lo normal: las arrugas están más marcadas y vas a necesitar más pasadas.', 'warn') : null,
      ui.section('1 · Temperatura', dial, thermo),
      h('div', { class: 'pl-sec-pair' }, ui.section('2 · Vapor', steamToggle, steamNote), ui.section('3 · Ver las arrugas', hintToggle, hintNote)),
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
    // que los botones no se queden con el foco después de un clic (Espacio es "apoyar la plancha")
    if (ui.panelEl) {
      ctx.listen(ui.panelEl, 'click', (e) => {
        const b = e.target?.closest?.('button, input');
        if (b) setTimeout(() => b.blur?.(), 0);
      });
    }

    // ---------------- HUD y etiqueta sobre la plancha ----------------
    const hud = createHud(h, { onFlip: () => startFlip() });
    ui.hud(hud.el);
    ui.hudEl?.classList.add('pl-hud-host');
    ctx.track(() => ui.hudEl?.classList.remove('pl-hud-host'));
    const ironLabel = h('div', { class: 'world-label pl-iron-label' });
    ironLabel.style.display = 'none';
    document.getElementById('app').appendChild(ironLabel);
    ctx.track(() => ironLabel.remove());

    // indicación de abajo: una sola a la vez (cada una cancela el temporizador de la anterior)
    let hintTimer = 0;
    function showHint(html, ms = 0) {
      clearTimeout(hintTimer);
      hintTimer = 0;
      ui.hint(html);
      if (html && ms) hintTimer = ctx.timeout(() => ui.hint(null), ms);
    }
    const clearHint = () => showHint(null);
    const hintStart = () =>
      showHint(isMobile() ? 'Primero elegí la <b>temperatura</b> para tu tela en el panel' : 'Primero elegí la <b>temperatura</b> para tu tela (perilla del panel o teclas <kbd>1</kbd>–<kbd>4</kbd>)');
    const hintIron = () =>
      showHint(
        isMobile()
          ? 'Apoyá el dedo sobre la remera y deslizá la plancha con pasadas largas'
          : 'Mantené apretado el clic sobre la remera y mové la plancha con pasadas largas · flechas + <kbd>Espacio</kbd> también',
        9000,
      );
    hintStart();

    // ---------------- controles ----------------
    function refreshPanel() {
      const locked = !!autoRun || finished;
      for (const [lv, b] of dialBtns) {
        b.classList.toggle('selected', lv === level);
        b.setAttribute('aria-checked', lv === level ? 'true' : 'false');
        b.disabled = locked;
      }
      steamToggle.input.checked = steamOn;
      steamToggle.input.disabled = locked;
      hintToggle.input.checked = hintOn;
      const sideDone = levels[up] <= DONE_LEVEL && levels[other(up)] > DONE_LEVEL;
      hud.setFlip({ up, disabled: !!flip || busy || locked, pulse: sideDone });
      ui.enableAction('auto', !autoRun && !finished && !flip && !busy);
      ui.enableAction('done', !finished && !flip && !autoRun && !busy);
    }

    // que los botones del panel o del HUD no se queden con el foco
    const dropFocus = () => {
      const a = document.activeElement;
      if (a && a !== document.body && a.closest?.('#panel, #hud')) a.blur();
    };

    function setLevel(lv) {
      dropFocus();
      if (busy || finished || autoRun) return;
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
      }
      if (lv === 1 && steamOn) ui.toast('💧 A • la plancha no calienta lo suficiente para hacer vapor (necesita •• o más).', 'warn', 3400);
    }

    function setSteam(on) {
      dropFocus();
      if (busy || finished || autoRun) {
        steamToggle.input.checked = steamOn;
        return;
      }
      steamOn = !!on;
      audio.play(steamOn ? 'steam' : 'click');
      if (steamOn && !steamLoop) steamLoop = audio.loop('steam');
      if (steamOn && level === 1) ui.toast('💧 A • la plancha no calienta lo suficiente para hacer vapor (necesita •• o más).', 'warn', 3400);
      refreshPanel();
    }

    function setHint(on) {
      dropFocus();
      hintOn = !!on;
      overlay?.setHint(hintOn);
      audio.play('click');
      refreshPanel();
    }

    // ---------------- dar vuelta ----------------
    function startFlip() {
      dropFocus();
      if (flip || busy || finished || autoRun) return;
      beginFlip();
      clearHint();
    }
    function beginFlip() {
      flip = { t: 0, from: up };
      rig.goRest();
      pressing = keyPress = pointerPress = false;
      hadContact = false;
      stuck.hist.length = 0;
      audio.play('pop');
      refreshPanel();
    }
    const qx = new THREE.Quaternion();
    function updateFlip(dt) {
      flip.t = Math.min(1, flip.t + dt / FLIP_SECS);
      const t = flip.t;
      // 1) la tela que cuelga sube a la tabla, 2) gira, 3) vuelve a caer del otro lado
      if (t < 0.24) drape.set(flip.from, 1 - easeInOutCubic(t / 0.24));
      else if (t < 0.76) drape.set(flip.from, 0);
      else drape.set(other(flip.from), easeInOutCubic((t - 0.76) / 0.24));
      overlay?.setVisible(1 - smoothstep(0, 0.12, t) + smoothstep(0.88, 1, t));
      const e = easeInOutCubic(clamp((t - 0.16) / 0.68));
      // se levanta y gira sobre su largo; en el aire se junta un poco de ancho (como cuando se la
      // agarra de los hombros), así no sube tanto: el borde de abajo nunca atraviesa la tabla
      const a = (flip.from === 'frente' ? 0 : Math.PI) + Math.PI * e;
      const up01 = Math.sin(Math.PI * e);
      const gather = 1 - 0.42 * up01;
      qx.setFromAxisAngle(xAxis, a);
      sg.quaternion.copy(qx).multiply(q0);
      sg.scale.set(gather, 1, 1);
      sg.position.set(shirtPos.x, shirtPos.y + up01 * (halfZ * gather + 0.025), shirtPos.z);
      if (e > 0.5 && overlay && flip.side !== 'other') {
        flip.side = 'other';
        overlay.setSide(other(flip.from));
      }
      if (flip.t >= 1) {
        up = other(flip.from);
        stats.flipped = true;
        flip = null;
        sg.position.copy(shirtPos);
        sg.quaternion.copy(up === 'frente' ? q0 : qBack);
        sg.scale.set(1, 1, 1);
        drape.set(up, 1);
        overlay?.setSide(up);
        overlay?.setVisible(1);
        audio.play('thud');
        refreshPanel();
        if (levels[up] > DONE_LEVEL && !autoRun && !finished) {
          showHint(up === 'espalda' ? 'Ahora la espalda: las mismas pasadas largas' : 'Otra vez el frente arriba', 3500);
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
      clampToBoard(target.set(p.x, topY, p.z));
      return true;
    }
    ctx.onPointer('move', (e) => {
      if (busy || finished || autoRun) return;
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
      if (busy || finished || flip || autoRun || e.target !== canvas) return;
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
      if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey) {
        setHint(!hintOn);
        return;
      }
      // en automático no se toca nada
      if (autoRun) return;
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
          if (rig.mode === 'rest') target.set(board.center.x - 0.05, topY, cz);
          else target.set(rig.position.x, topY, rig.position.z);
          clampToBoard(target);
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
          target.set(board.center.x - 0.05, topY, cz);
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
    const gq = { x: 0, y: 0 };
    const onShirt = (x, y) => pointInPolygon(x, y, outlines[up]);
    // altura de la cara de arriba de la remera en un punto de prenda
    function shirtTopAt(x, y) {
      const { position } = shirt.garmentToLocal(up, x, y, 0);
      tmpL.copy(position).applyMatrix4(sg.matrixWorld);
      return tmpL.y;
    }
    // ¿La suela (centrada en wx, wz con giro yaw) pisa la remera? Si withHeight, devuelve también
    // la altura de apoyo (el punto más alto de la tela bajo la suela).
    const soleOut = { over: false, y: 0 };
    function soleOnShirt(wx, wz, yaw, withHeight) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      soleOut.over = false;
      soleOut.y = -Infinity;
      for (const [a, l] of SOLE_PTS) {
        toGarment(wx + c * a + s * l, wz - s * a + c * l, gq);
        if (!onShirt(gq.x, gq.y)) continue;
        soleOut.over = true;
        if (!withHeight) return soleOut;
        // en el doblez del borde la tela baja: solo cuenta lo que está arriba de la tabla
        if (drape.supported && Math.abs(gq.x) > limitAt(gq.y)) continue;
        soleOut.y = Math.max(soleOut.y, shirtTopAt(gq.x, gq.y));
      }
      return soleOut;
    }

    // Alisa la tela que cuelga del borde de la tabla debajo de un círculo de la suela que lo pisa.
    function spillOver(x, y, r, st) {
      const lim = limitAt(y);
      const reach = Math.abs(x) + r - (lim - 0.015);
      if (reach <= 0) return;
      const prox = clamp(reach / r);
      const sgn = Math.sign(x) || 1;
      const xmax = maxXAt(up, y) + 0.01;
      for (let xx = lim + 0.015; xx <= xmax; xx += 0.045) shirt.smoothWrinkles(up, sgn * xx, y, r * 0.95, st * prox * SPILL);
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
      if (keys.size && !flip && !autoRun) {
        let mx = 0;
        let mz = 0;
        for (const k of keys) {
          mx += MOVE_KEYS[k][0];
          mz += MOVE_KEYS[k][1];
        }
        const l = Math.hypot(mx, mz) || 1;
        target.x += (mx / l) * 0.42 * dt;
        target.z += (mz / l) * 0.42 * dt;
        clampToBoard(target);
        lastInput = simT;
      }

      pressing = (pointerPress || keyPress) && !flip && !autoRun;
      inv.copy(sg.matrixWorld).invert();

      // a dónde va la plancha
      if (autoRun) {
        // la maneja runAuto
      } else if (flip || finished) rig.goRest();
      else if ((away && !pressing) || (!pressing && simT - lastInput > 7)) rig.goRest();
      else {
        const so = soleOnShirt(target.x, target.z, rig.yaw, true);
        const overBoard = Math.abs(target.z - cz) < halfWAt(target.x) && target.x > boardEnd;
        const y = so.over && so.y > -Infinity ? so.y + 0.0012 : overBoard ? board.surfaceY + 0.001 : topY + 0.01;
        contactYs += (y - contactYs) * (1 - Math.exp(-dt * 20));
        rig.follow(target.x, target.z, contactYs, pressing);
      }
      rig.update(dt);

      // contacto con la tela: alcanza con que alguna parte de la suela pise la remera
      const p = rig.position;
      const overShirt = !flip && soleOnShirt(p.x, p.z, rig.yaw, false).over;
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
        const rate = smoothRate(fabric, T, Ti, steamActive, hardness) * (autoRun ? autoRun.boost : 1);
        if (rate > 0) {
          const from = hadContact ? prevContact : p;
          const dist = Math.hypot(p.x - from.x, p.z - from.z);
          const n = clamp(Math.ceil(dist / 0.02), 1, 14);
          const st = (rate * dt) / n;
          let removed = 0;
          for (let i = 1; i <= n; i++) {
            const k = i / n;
            const wx = from.x + (p.x - from.x) * k;
            const wz = from.z + (p.z - from.z) * k;
            for (const [off, r] of FOOT) {
              toGarment(wx + c * off, wz - s * off, gp);
              removed += shirt.smoothWrinkles(up, gp.x, gp.y, r, st);
              if (drape.supported) spillOver(gp.x, gp.y, r, st);
            }
          }
          if (removed > 0 || drape.supported) overlay?.markDirty();
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
      if (stats.started && !finished && !flip && !busy) stats.activeTime += dt;

      // niveles de arrugas
      levels.frente = shirt.wrinkleLevel('frente');
      levels.espalda = shirt.wrinkleLevel('espalda');
      // historial del lado de arriba mientras se plancha (para avisar si quedó "trabado")
      if (contact && !autoRun) {
        stuck.acc += dt;
        if (stuck.acc >= 0.5) {
          stuck.acc = 0;
          stuck.hist.push(levels[up]);
          if (stuck.hist.length > 14) stuck.hist.shift();
        }
      }

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

    // ¿El lado de arriba quedó trabado (casi listo pero no baja)? → resaltar lo que falta.
    function checkStuck() {
      const H = stuck.hist;
      if (H.length < 12 || simT - stuck.lastT < 25) return;
      const lvl = levels[up];
      if (lvl <= DONE_LEVEL || lvl > 0.85) return;
      if (H[0] - lvl > 0.015) return;
      stuck.lastT = simT;
      H.length = 0;
      overlay?.pulse(4);
      showHudMsg('🔎 Quedan arrugas en lo que se ve resaltado: bordes, hombros y lo que cuelga', 'warn', 5);
      showHint(
        isMobile()
          ? 'Lo resaltado falta planchar. Para lo que cuelga, pasá la plancha pegada al borde de la tabla'
          : 'Lo resaltado falta planchar. Para lo que cuelga, pasá la plancha pegada al borde de la tabla · <kbd>R</kbd> deja el resaltado prendido',
        7000,
      );
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
      // la tela cae sobre los bordes de la tabla al llegar
      if (!flip && drapeK < 1) {
        drapeK = Math.min(1, drapeK + dt / 0.9);
        drape.set(up, easeInOutCubic(drapeK));
      }
      // una vuelta empezada siempre termina (aunque se haya apretado "Listo")
      if (flip) updateFlip(dt);
      overlay?.update(dt);
      if (finished && !autoRun) {
        rig.goRest();
        rig.update(dt);
        return;
      }
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
      const lowTemp = level > 0 && r.targetT < Ti * 0.7;
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
      else if (pressing && r.overShirt && level > 0 && T < r.targetT - 4 && T < Ti * 0.7) alert = '⏳ Todavía está tibia: esperá a que caliente';
      else if (pressing && r.overShirt && lowTemp) alert = `🌡 A ${dots(level)} casi no alisa ${fabric.short}: subí la temperatura`;
      else if (steamOn && level > 0 && !r.steamActive && T >= r.targetT - 4) alert = '💧 A esta temperatura no hace vapor';
      else if (simT < alertUntil) alert = hudMsg;
      if (alert === hudMsg) kind = hudMsgKind;
      hud.setAlert(alert, kind);

      updateThermo(r.targetT);
      // etiqueta flotante sobre la plancha
      updateIronLabel(r);

      // cursor
      canvas.style.cursor = pressing ? 'grabbing' : !away && rig.mode === 'follow' && !autoRun ? 'grab' : '';

      // avisos de progreso
      if (!autoRun && !flip) {
        if (r.contact && !firstContactHint) {
          firstContactHint = true;
          clearHint();
        }
        if (levels[up] <= DONE_LEVEL && levels[other(up)] > DONE_LEVEL && !frontDoneToast) {
          frontDoneToast = true;
          audio.play('good');
          showHudMsg(`✓ ¡${up === 'frente' ? 'Frente listo' : 'Espalda lista'}! Ahora dala vuelta`, 'good', 4);
          showHint(isMobile() ? 'Tocá <b>Dar vuelta</b> (arriba) para planchar el otro lado' : 'Tocá <b>Dar vuelta</b> en el recuadro de arriba (o <kbd>F</kbd>) para planchar el otro lado', 5000);
        }
        if (levels.frente <= DONE_LEVEL && levels.espalda <= DONE_LEVEL && !finished) {
          showHudMsg('✓ ¡Remera lisita!', 'good', 3);
          finish(false, true);
        }
        checkStuck();
      }
      refreshFlipBtn();
    });
    const other = (s) => (s === 'frente' ? 'espalda' : 'frente');
    let hudMsg = null;
    let hudMsgKind = 'info';
    function showHudMsg(text, kind = 'info', secs = 3) {
      hudMsg = text;
      hudMsgKind = kind;
      alertUntil = simT + secs;
    }
    function refreshFlipBtn() {
      const sideDone = levels[up] <= DONE_LEVEL && levels[other(up)] > DONE_LEVEL;
      hud.setFlip({ up, disabled: !!flip || busy || !!autoRun || finished, pulse: sideDone });
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
    // Recorre cada lado con pasadas a lo largo de la remera (franjas a lo ancho de la tabla) y la da vuelta.
    // El recorrido se calcula con la pose FINAL de ese lado (no con la del cuadro, por si estaba girando).
    const poseM = new THREE.Matrix4();
    const ONE = new THREE.Vector3(1, 1, 1);
    const poseOf = (side) => poseM.compose(shirtPos, side === 'frente' ? q0 : qBack, ONE);
    function lanesFor(side) {
      const poly = outlines[side];
      let minX = Infinity;
      let maxX = -Infinity;
      for (const q of poly) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
      }
      // la plancha solo anda arriba de la tabla: las franjas de las puntas van pegadas al borde
      const lim = halfW - IRON_MARGIN - 0.004;
      const xa = Math.max(minX + 0.04, -lim);
      const xb = Math.min(maxX - 0.04, lim);
      const nl = Math.max(2, Math.ceil((xb - xa) / 0.062) + 1);
      const pts = [];
      let dir = 1;
      for (let li = 0; li < nl; li++) {
        const x = xa + ((xb - xa) * li) / (nl - 1);
        // intervalo en y dentro del contorno para esta franja
        const ys = [];
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const xa2 = poly[a].x;
          const xb2 = poly[b].x;
          if (xa2 > x !== xb2 > x) ys.push(poly[a].y + ((x - xa2) / (xb2 - xa2)) * (poly[b].y - poly[a].y));
        }
        if (ys.length < 2) continue;
        const y0 = Math.min(...ys) + 0.05;
        const y1 = Math.max(...ys) - 0.05;
        if (y1 <= y0) continue;
        if (dir > 0) pts.push([x, y0], [x, y1]);
        else pts.push([x, y1], [x, y0]);
        dir = -dir;
      }
      const M = poseOf(side);
      return pts.map(([x, y]) => {
        const w = clampToBoard(new THREE.Vector3(x, y, 0).applyMatrix4(M));
        return [w.x, w.z, x, y];
      });
    }
    function runAuto() {
      dropFocus();
      if (busy || finished || autoRun) return;
      clearHint();
      keys.clear();
      pointerPress = keyPress = false;
      level = fabric.ironLevel;
      iron.setLevel(level);
      steamOn = !!fabric.ironSteam;
      if (steamOn && !steamLoop) steamLoop = audio.loop('steam');
      // la plancha ya estaba enchufada: llega a temperatura enseguida
      // fuerza ajustada para que una sola recorrida deje la remera casi lisa en cualquier tela
      const boost = 20 / Math.max(0.5, smoothRate(fabric, Ti, Ti, steamWorks(Ti, steamOn), hardness));
      const sides = [up, other(up)].filter((sd) => levels[sd] > DONE_LEVEL * 0.6);
      autoRun = { phase: flip ? 'wait' : 'next', t: 0, boost, sidesLeft: sides, path: null, i: 0, seg: 0 };
      refreshPanel();
      audio.play('select');
    }
    const autoP = new THREE.Vector3();
    function autoStep(dt) {
      const A = autoRun;
      A.t += dt;
      if (A.phase === 'wait') {
        // si justo se estaba dando vuelta, primero termina la vuelta
        if (!flip) A.phase = 'next';
        return;
      }
      if (A.phase === 'next') {
        if (!A.sidesLeft.length) {
          A.phase = 'end';
          A.t = 0;
          rig.goRest();
          return;
        }
        if (A.sidesLeft[0] !== up) {
          A.phase = 'flip';
          beginFlip();
          return;
        }
        A.phase = 'heat';
        A.t = 0;
        A.path = null;
      }
      if (A.phase === 'heat') {
        T = Math.min(levelTemp(catalog, level), T + dt * 260);
        if (!A.path) {
          A.path = lanesFor(up);
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
        const pts = A.path;
        // avanza el objetivo a lo largo del recorrido a velocidad constante
        let adv = dt * 2.6;
        while (adv > 0 && A.i < pts.length - 1) {
          const a = pts[A.i];
          const b = pts[A.i + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
          const left = len * (1 - A.seg);
          if (adv >= left) {
            adv -= left;
            A.i++;
            A.seg = 0;
          } else {
            A.seg += adv / len;
            adv = 0;
          }
        }
        if (A.i >= pts.length - 1) {
          A.sidesLeft.shift();
          A.phase = 'next';
          return;
        }
        const a = pts[A.i];
        const b = pts[A.i + 1];
        autoP.set(a[0] + (b[0] - a[0]) * A.seg, 0, a[1] + (b[1] - a[1]) * A.seg);
        const gx = a[2] + (b[2] - a[2]) * A.seg;
        const gy = a[3] + (b[3] - a[3]) * A.seg;
        // de una franja a la otra la plancha sigue apoyada (se desliza de costado)
        const y = onShirt(gx, gy) && Math.abs(gx) < limitAt(gy) ? shirtTopAt(gx, gy) + 0.0012 : topY;
        rig.follow(autoP.x, autoP.z, y, true, true);
        return;
      }
      if (A.phase === 'flip') {
        if (!flip) A.phase = 'next';
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

    // ---------------- terminar ----------------
    function blurActive() {
      const a = document.activeElement;
      if (a && a !== document.body && typeof a.blur === 'function') a.blur();
    }
    async function finish(auto, automatic = false) {
      if (finished || busy) return;
      if (flip && !automatic && !auto) return; // "Listo" está deshabilitado mientras gira
      if (!auto && !automatic) {
        const worst = Math.max(levels.frente, levels.espalda);
        if (worst > 0.25) {
          busy = true;
          pointerPress = keyPress = false;
          keys.clear();
          refreshPanel();
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
          // el foco vuelve al juego (si no, Espacio "aprieta" Listo otra vez)
          blurActive();
          if (!ctx.alive) return;
          if (id !== 'fin') {
            refreshPanel();
            return;
          }
        }
      }
      finished = true;
      busy = true;
      pointerPress = keyPress = false;
      keys.clear();
      blurActive();
      refreshPanel();
      clearHint();
      ironLabel.style.display = 'none';
      rig.goRest();
      // espera a que la plancha vuelva al apoya-plancha (y a que termine una vuelta empezada) y la apaga
      await new Promise((r) => ctx.timeout(r, automatic && !auto ? 1100 : 700));
      while (flip && ctx.alive) await new Promise((r) => ctx.timeout(r, 60));
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
      overlay?.setHint(false);
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
        drape: +drape.amount.toFixed(3),
        hint: hintOn,
      }),
      // Avanza la simulación `secs` segundos de una (sin renderizar) a pasos de 1/30 s.
      run(secs = 1) {
        const n = Math.round(secs * 30);
        for (let i = 0; i < n; i++) {
          if (!flip && drapeK < 1) {
            drapeK = Math.min(1, drapeK + 1 / 30 / 0.9);
            drape.set(up, easeInOutCubic(drapeK));
          }
          if (flip) updateFlip(1 / 30);
          if (finished && !autoRun) continue;
          if (autoRun) autoStep(1 / 30);
          simulate(1 / 30);
          shirt.update();
        }
        return this.info();
      },
      // Simula una pasada apretando de (x0,z0) a (x1,z1) en mundo, a `speed` m/s.
      stroke(x0, z0, x1, z1, speed = 0.4) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(2, Math.round((len / speed) * 30));
        away = false;
        pointerPress = true;
        for (let i = 0; i <= n; i++) {
          const k = i / n;
          clampToBoard(target.set(x0 + (x1 - x0) * k, topY, z0 + (z1 - z0) * k));
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
        drapeK = 1;
        if (!flip) drape.set(up, 1);
        return true;
      },
      // Recorrida continua de ida y vuelta (como un jugador): franjas a lo largo de X entre z0 y z1.
      sweep(z0 = cz - halfW + IRON_MARGIN, z1 = cz + halfW - IRON_MARGIN, lanes = 7, speed = 0.45, x0 = shirtPos.x - lenG + 0.03, x1 = shirtPos.x - 0.02) {
        const pts = [];
        for (let i = 0; i < lanes; i++) {
          const z = z0 + ((z1 - z0) * i) / Math.max(1, lanes - 1);
          if (i % 2 === 0) pts.push([x0, z], [x1, z]);
          else pts.push([x1, z], [x0, z]);
        }
        away = false;
        clampToBoard(target.set(pts[0][0], topY, pts[0][1]));
        pointerPress = true;
        for (let k = 1; k < pts.length; k++) {
          const [ax, az] = pts[k - 1];
          const [bx, bz] = pts[k];
          const n = Math.max(2, Math.round((Math.hypot(bx - ax, bz - az) / speed) * 30));
          for (let i = 1; i <= n; i++) {
            clampToBoard(target.set(ax + ((bx - ax) * i) / n, topY, az + ((bz - az) * i) / n));
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
      setHint(on) {
        setHint(on);
        return hintOn;
      },
      shirtBounds() {
        const box = new THREE.Box3();
        const pm = shirt.getPanelMeshes();
        box.setFromObject(pm[up]);
        return { min: box.min.toArray(), max: box.max.toArray() };
      },
      region,
      overlay,
      board: { cz, halfW, x0: shirtPos.x - lenG, x1: shirtPos.x },
    };
    ctx.track(() => {
      if (step._test) delete step._test;
    });

    refreshPanel();
  },
};
