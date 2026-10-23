// Paso 6 · Cortar la tela.
// La misma mesa del tizado, con las líneas de tiza de cada molde. Se elige la herramienta
// (tijera de sastre o cúter circular) y se corta cada pieza siguiendo la tiza sin soltar:
// la herramienta 3D sigue el recorrido, deja la ranura del corte y mide cuánto se desvía.
// La segunda manga sale gemela de la primera (mismo trazo) y las tiras se cortan con regla
// (un clic en el momento justo). Cada pieza cortada se levanta y se apila; en la tela queda
// el hueco.

import * as catalog from '../data/catalog.js';
import { clamp, lerp, rng, easeInOutCubic } from '../core/utils.js';
import { FABRIC_WIDTH, FABRIC_MAX_LENGTH, PIECE_GAP, fabricOrigin, worldToFabric, placedOutline, evaluateLayout, isGrainOk, bounds } from './shared/fabricLayout.js';
import { safeAutoLayout, polygonsCross } from './tizado/raster.js';
import { pieceThumb } from './tizado/svg.js';
import { createCutTable, SHEET_TH } from './corte/table.js';
import { resampleLoop, buildPath, pointAt, closest, maxCurv, offsetRibbon, dynamicRibbon, normalsOf } from './corte/path.js';
import { savePose, restorePose, scissorsController, cutterController, poseTween, createRuler, headingOf } from './corte/tools.js';
import { TOOLS, scoreCut, pieceAccuracy, rulerAccuracy, RULER_AMP, recommendedTool, scissorsDrag } from './corte/scoring.js';
import { SQUASH, foldPlan, foldParts, foldMatrix, foldedOutline, foldedCenter, findStackSpot, stackFoot, stackPose } from './corte/stack.js';
import { bestFit, fitBox, screenInsets } from './corte/view.js';
import { cutMap, accColor, TOOL_SVG } from './corte/svg.js';

const { fabricById, luminance } = catalog;
const L = FABRIC_MAX_LENGTH;
const W = FABRIC_WIDTH;
const CHALK_W = 0.0055;
const LOOK = 0.14; // hasta dónde persigue la herramienta al puntero (m)
const END_SNAP = 0.004; // a menos de esto del final (con el puntero ahí), la pieza se da por cortada (m)
const MM_PER_PX = 0.0008; // desvío del pulso (px) → desvío del corte (m), antes de la herramienta
const TOUCH_K = 0.6; // con el dedo se perdona un poco más
const MAX_OFF = 0.012;
const mmTxt = (m) => `${String(Math.round(Math.abs(m) * 10000) / 10).replace('.', ',')} mm`;
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const round3 = (v) => Math.round(v * 1000) / 1000;
const perimeter = (pts) => {
  let l = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    l += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return l;
};

// ---------------------------------------------------------------------------
// Plan de corte: qué piezas se cortan a pulso, cuál sale gemela y cuáles con regla.
// ---------------------------------------------------------------------------

const ORDER = ['frente', 'espalda', 'manga_izq', 'manga_der', 'cuello', 'ribete_sisa_izq', 'ribete_sisa_der'];

export function planPieces(pattern) {
  const pieces = [...pattern.pieces].sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const ids = new Set(pieces.map((p) => p.id));
  return pieces.map((piece) => {
    const strip = Math.min(piece.width, piece.height) < 0.08;
    let method = strip ? 'regla' : 'trazo';
    let twinOf = null;
    if (piece.id === 'manga_der' && ids.has('manga_izq')) {
      method = 'gemela';
      twinOf = 'manga_izq';
    }
    return { id: piece.id, piece, name: piece.name, method, twinOf };
  });
}

function ensureLayout(ctx, pattern, fabric) {
  const { state, catalog: cat } = ctx;
  const pls = state.layout?.placements;
  const ok = Array.isArray(pls) && pattern.pieces.every((p) => pls.some((q) => q.id === p.id));
  if (ok) {
    const ev = evaluateLayout(pattern, pls);
    if (!ev.outside.length && !ev.overlaps.length) return state.layout;
  }
  const lay = safeAutoLayout(pattern);
  const ev = evaluateLayout(pattern, lay.placements);
  state.layout = {
    placements: lay.placements.map((p) => ({ id: p.id, x: round3(p.x), z: round3(p.z), rot: p.rot })),
    fabricLength: round3(Math.min(L, ev.usedLength + PIECE_GAP)),
    efficiency: Math.round(ev.efficiency * 1000) / 1000,
    grainOk: lay.placements.every((p) => isGrainOk(p.rot)),
    grainWrong: lay.placements.filter((p) => !isGrainOk(p.rot)).map((p) => p.id),
  };
  // la tela que se usa cambió: el costo se recalcula (addCost reemplaza por etiqueta)
  ctx.addCost('Tela', Math.round(state.layout.fabricLength * fabric.pricePerMeter));
  if (pattern.pieces.some((p) => p.id === 'cuello')) ctx.addCost('Ribb (cuello)', (cat || catalog).COSTS.ribbing);
  return state.layout;
}

// Desvíos automáticos suaves (m) a lo largo de un recorrido: amplitud ~amp.
function autoOffsets(path, amp, seed) {
  const r = rng(seed);
  const a = r() * 6.28;
  const b = r() * 6.28;
  const c = r() * 6.28;
  const out = new Float32Array(path.count);
  for (let i = 0; i < path.count; i++) {
    const s = path.cum[i];
    out[i] = 0.55 * Math.sin((6.283 * s) / 0.43 + a) + 0.3 * Math.sin((6.283 * s) / 0.13 + b) + 0.15 * Math.sin((6.283 * s) / 0.047 + c);
  }
  // normalizado: desvío medio = amp (así cada pieza automática da parecido)
  let m = 0;
  for (let i = 0; i < out.length; i++) m += Math.abs(out[i]);
  m = m / Math.max(1, out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] *= amp / m;
  return out;
}

function smoothLoop(arr, passes = 2) {
  let a = Float32Array.from(arr);
  const n = a.length;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = (a[(i - 1 + n) % n] + 2 * a[i] + a[(i + 1) % n]) / 4;
    a = b;
  }
  return a;
}

// ---------------------------------------------------------------------------

export default {
  id: 'corte',
  title: 'Cortar la tela',
  short: 'Corte',
  icon: '✂️',
  scored: true,
  help: `<p>Elegí la herramienta y cortá cada pieza <b>siguiendo la línea de tiza</b>.</p>
<ul>
<li><b>A pulso:</b> apretá sobre el punto <b>●</b> y, sin soltar, recorré el contorno. La herramienta te sigue mientras estés cerca de la línea; si te alejás mucho, se corta el trazo (y resta precisión).</li>
<li><b>Tijera de sastre:</b> más lenta pero precisa. <b>Cúter circular:</b> rapidísimo, pero en las curvas tenés que frenar o la cuchilla se desvía.</li>
<li>La <b>manga derecha</b> sale gemela de la izquierda (mismo trazo, como con la tela doblada).</li>
<li><b>Tiras</b> (cuello, ribetes): la regla se mueve sola; hacé clic cuando quede justo sobre la tiza.</li>
<li><span class="kbd">Espacio</span> sostenido también corta (con el mouse guiando).</li>
</ul>`,

  defaults(state, ctx) {
    const pattern = ctx.getPattern();
    const pieces = {};
    for (const p of pattern.pieces) pieces[p.id] = 0.8;
    state.cut = { tool: 'tijera', pieces, accuracy: 0.8, meanDevMm: 1.8, salidas: 0, auto: true };
  },

  async enter(ctx) {
    const { THREE, engine, ui, h, audio, state, world } = ctx;
    const step = this;
    const pattern = ctx.getPattern();
    const fabric = fabricById(state.fabric?.id) || fabricById('algodon_jersey');
    const layout = ensureLayout(ctx, pattern, fabric);
    const plMap = new Map(layout.placements.map((p) => [p.id, p]));
    const o = fabricOrigin();
    const canvas = engine.canvas;
    const panelEl = document.getElementById('panel');
    const appEl = document.getElementById('app');
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const modalOpen = () => !!document.querySelector('.modal-wrap');
    const recTool = recommendedTool(fabric);
    const drag = scissorsDrag(fabric);
    const darkFabric = luminance(state.fabric.color) < 0.22;

    // ---------------- escena ----------------
    const table = createCutTable({ fabric, color: state.fabric.color, heather: state.fabric.heather, sizeLabel: pattern.opts.size });
    ctx.add(table.group);
    const topY = table.topY;

    const plan = planPieces(pattern);
    const items = plan.map((p, idx) => {
      const pl = plMap.get(p.id);
      const outline = placedOutline(p.piece, pl);
      const loop = resampleLoop(outline);
      const line = table.addChalkLine(loop);
      line.setProgress(1);
      const b = bounds(loop);
      return { ...p, idx, pl, loop, line, b, len: perimeter(loop), ticks: [], status: 'pending', acc: null, dev: 0, salidas: 0, auto: false, path: null, offsets: null, mesh: null, cutPts: null, time: 0 };
    });
    const itemById = new Map(items.map((it) => [it.id, it]));
    // "frente, espalda, mangas y cuello" (según las piezas de este molde)
    const autoListText = () => {
      const has = (re) => items.some((it) => re.test(it.id));
      const parts = [];
      if (has(/^frente$/)) parts.push('frente');
      if (has(/^espalda$/)) parts.push('espalda');
      if (has(/^manga/)) parts.push('mangas');
      if (has(/^cuello$/)) parts.push('cuello');
      if (has(/^ribete/)) parts.push('ribetes');
      if (!has(/^cuello$/) && !has(/^ribete/) && items.some((it) => it.method === 'regla')) parts.push('tiras');
      return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0] || 'todas las piezas';
    };
    // piquetes (marquitas de tiza hacia adentro, como en el tizado; viajan con la pieza)
    const chalkMat = table.chalkMat();
    for (const it of items) {
      for (const n of placedOutline(it.piece, it.pl, 'notches')) {
        const dx = it.pl.x - n.x;
        const dz = it.pl.z - n.z;
        const l = Math.hypot(dx, dz) || 1;
        const a = n;
        const bb = { x: n.x + (dx / l) * 0.012, z: n.z + (dz / l) * 0.012 };
        const g = new THREE.PlaneGeometry(0.0045, 0.012);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, chalkMat);
        m.position.set((a.x + bb.x) / 2, topY + 0.0007, (a.z + bb.z) / 2);
        m.rotation.y = Math.atan2(bb.x - a.x, bb.z - a.z);
        m.renderOrder = 2;
        table.group.add(m);
        it.ticks.push(m);
      }
      // ¿tiene curvas cerradas? (escote, sisa, copa): tramos largos con radio de 3 a 14 cm
      // (las esquinas dan picos de curvatura mucho más altos y cortitos: no cuentan)
      const pth = buildPath(it.loop, 0, 1);
      let curvyLen = 0;
      for (let i = 0; i < pth.count; i++) if (pth.curv[i] > 7 && pth.curv[i] < 35) curvyLen += pth.cum[i + 1] - pth.cum[i];
      it.curvy = it.method === 'trazo' && curvyLen > 0.1;
    }
    // Lugar de la pila de piezas cortadas (dobladas): tela libre lejos de todos los moldes si entra;
    // si no, sobre la base de corte, adentro del hueco que deja el frente (la primera pieza).
    // Nunca encima de una pieza que falta cortar.
    const foot = stackFoot(items.map((it) => it.piece));
    const spot = findStackSpot({ outlines: items.map((it) => ({ id: it.id, pts: it.loop })), host: { id: items[0].id, pts: items[0].loop }, foot, L, W });
    const stackBaseY = spot.inHole ? 0.0002 : topY + 0.0002;
    let stacked = 0;
    let stackH = 0;
    // sombrita de contacto debajo de la pila (aparece con la primera pieza)
    const stackShadow = (() => {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = 128;
      const c = cv.getContext('2d');
      c.filter = 'blur(10px)';
      c.fillStyle = '#fff';
      c.fillRect(22, 22, 84, 84);
      const tex = new THREE.CanvasTexture(cv);
      const ex = (spot.longAxis === 'z' ? foot.short : foot.long) * 1.3;
      const ez = (spot.longAxis === 'z' ? foot.long : foot.short) * 1.3;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ex, ez).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: '#000', transparent: true, opacity: 0, depthWrite: false }));
      m.position.set(spot.x, stackBaseY + 0.0002, spot.z);
      m.renderOrder = 1;
      m.raycast = () => {};
      table.group.add(m);
      return m;
    })();

    // ---------------- herramientas ----------------
    const props = { tijera: world.props.scissors || null, cutter: world.props.rotaryCutter || null };
    const poses = { tijera: savePose(props.tijera?.group), cutter: savePose(props.cutter?.group) };
    const ctls = { tijera: props.tijera ? scissorsController(props.tijera) : null, cutter: props.cutter ? cutterController(props.cutter) : null };
    ctx.track(() => {
      for (const k of ['tijera', 'cutter']) restorePose(poses[k]);
      props.tijera?.setOpen?.(0);
      props.cutter?.setRoll?.(0);
    });
    let loop = null; // sonido del cúter
    const stopLoop = () => {
      if (loop) {
        loop.stop();
        loop = null;
      }
    };
    ctx.track(stopLoop);

    // ---------------- estado ----------------
    let phase = 'choose'; // choose | prep | trace | replay | ruler | rulerCut | done
    let tool = recTool || 'tijera';
    let ctl = null;
    let autoMode = false;
    let timeScale = 1; // solo pruebas
    let hold = false; // solo pruebas: demora la tarjeta final
    let pressing = false;
    let keyPress = false;
    let pressT = -1; // cuándo empezó la pulsación del mouse / dedo (performance.now)
    let keyT = -1; // cuándo empezó la de Espacio
    let isTouch = false;
    let tr = null; // corte a pulso en curso
    let curRun = null; // corte animado en curso (automático, gemela, regla)
    let ru = null; // regla en curso
    let curIdx = -1;
    let cutTime = 0;
    let cutLen = 0;
    const anims = [];
    const tween = (dur, fn) =>
      new Promise((resolve) => {
        anims.push({ t: 0, dur: Math.max(0.001, dur), fn, resolve });
      });
    // pausas con el reloj del juego (igual que las animaciones: si el navegador se traba, no se desfasan)
    const sleep = (ms) => tween(ms / 1000, () => {});

    // ---------------- cámara ----------------
    const cam = engine.camera;
    const near0 = cam.near;
    const setNear = (v) => {
      cam.near = v;
      cam.updateProjectionMatrix();
    };
    ctx.track(() => setNear(near0));
    const nearFor = (vw) => Math.max(near0, Math.hypot(vw.position[0] - vw.target[0], vw.position[1] - vw.target[1], vw.position[2] - vw.target[2]) - 0.95);
    let flightId = 0;
    let viewKind = 'overview';
    const flyView = async (vw, dur = 1.1) => {
      const id = ++flightId;
      const nNew = nearFor(vw);
      if (cam.near > nNew) setNear(nNew);
      await ctx.flyTo(vw, dur / timeScale);
      if (ctx.alive && id === flightId && !engine.flying) setNear(nNew);
    };
    const hudRect = () => {
      const hu = document.getElementById('hud');
      if (!hu || !hu.classList.contains('show')) return null;
      return hu.getBoundingClientRect();
    };
    const hudReserve = () => {
      const r = hudRect();
      if (!r) return isMobile() ? 82 : 150;
      return Math.max(isMobile() ? 70 : 110, r.bottom - screenInsets().top + 4);
    };
    const overviewView = () => {
      const m = isMobile();
      const pad = m ? 0.03 : 0.06;
      const box = { minX: o.x0 - pad * 0.6, maxX: o.x0 + L + 0.06, minZ: o.z0 - pad - 0.02, maxZ: o.z0 + W + pad, y: table.topWorldY };
      // con el HUD a la vista se le hace lugar (arriba o, en pantallas anchas, a la izquierda)
      const r = hudRect();
      const opts = { tilt: m ? 1.4 : 1.3, reserveTop: r ? hudReserve() : m ? 82 : 150, reserveBottom: m ? 50 : 52, margin: m ? 6 : 16 };
      const a = fitBox(cam, box, opts);
      if (m || !r) return a;
      const b = fitBox(cam, box, { ...opts, reserveTop: 0, reserveLeft: r.right + 4 - opts.margin });
      return b.distance < a.distance ? b : a;
    };
    const pieceView = (it) => {
      const m = isMobile();
      const mg = m ? 0.035 : 0.06;
      let { minX, maxX, minZ, maxZ } = it.b;
      minX -= mg;
      maxX += mg;
      minZ -= mg;
      maxZ += mg;
      const minW = it.method === 'regla' ? 0.62 : 0.5;
      const minD = it.method === 'regla' ? 0.3 : 0.4;
      if (maxX - minX < minW) {
        const c = (minX + maxX) / 2;
        minX = c - minW / 2;
        maxX = c + minW / 2;
      }
      if (maxZ - minZ < minD) {
        const c = (minZ + maxZ) / 2;
        minZ = c - minD / 2;
        maxZ = c + minD / 2;
      }
      const box = { minX: o.x0 + minX, maxX: o.x0 + maxX, minZ: o.z0 + minZ, maxZ: o.z0 + maxZ, y: table.topWorldY };
      const opts = { tilt: m ? 1.38 : 1.32, reserveTop: hudReserve(), reserveBottom: m ? 58 : 60, margin: m ? 8 : 20 };
      const a = bestFit(cam, box, opts, { allowTurn: m && window.innerHeight > window.innerWidth });
      // en pantallas anchas conviene reservar la columna del HUD en vez de la franja de arriba
      const r = hudRect();
      if (m || !r) return a;
      const b = bestFit(cam, box, { ...opts, reserveTop: 0, reserveLeft: r.right + 4 - (opts.margin || 0) });
      return b.distance < a.distance ? b : a;
    };
    // de cerca, el tramo del medio de una tira (para fijar la regla)
    const rulerView = (it) => {
      const m = isMobile();
      const c = Math.cos(it.pl.rot);
      const s = Math.sin(it.pl.rot);
      const half = Math.min(it.piece.width / 2, m ? 0.1 : 0.19);
      const acr = it.piece.height / 2 + (m ? 0.045 : 0.085);
      const pts = [
        [half, acr],
        [-half, acr],
        [half, -acr],
        [-half, -acr],
      ].map(([u, v]) => ({ x: it.pl.x + u * c - v * s, z: it.pl.z - u * s - v * c }));
      const b = bounds(pts);
      const box = { minX: o.x0 + b.minX, maxX: o.x0 + b.maxX, minZ: o.z0 + b.minZ, maxZ: o.z0 + b.maxZ, y: table.topWorldY };
      const opts = { tilt: m ? 1.38 : 1.32, reserveTop: hudReserve(), reserveBottom: m ? 58 : 60, margin: m ? 8 : 20 };
      const a = bestFit(cam, box, opts, { allowTurn: m && window.innerHeight > window.innerWidth });
      const r = hudRect();
      if (m || !r) return a;
      const b2 = bestFit(cam, box, { ...opts, reserveTop: 0, reserveLeft: r.right + 4 - (opts.margin || 0) });
      return b2.distance < a.distance ? b2 : a;
    };
    const refitNow = () => {
      if (!ctx.alive) return;
      if (viewKind === 'overview') flyView(overviewView(), 0.35);
      else if (viewKind === 'ruler' && ru && items[curIdx]) flyView(rulerView(items[curIdx]), 0.35);
      else if (items[curIdx]) flyView(pieceView(items[curIdx]), 0.35);
    };
    let refitTimer = null;
    const refit = () => {
      clearTimeout(refitTimer);
      refitTimer = setTimeout(refitNow, 200);
    };
    ctx.track(() => clearTimeout(refitTimer));
    ctx.listen(window, 'resize', refit);
    const toggleBtn = document.getElementById('panel-toggle');
    if (toggleBtn) ctx.listen(toggleBtn, 'click', refit);
    ctx.listen(canvas, 'contextmenu', (e) => e.preventDefault());

    // ---------------- proyección / puntero ----------------
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -table.topWorldY);
    const projV = new THREE.Vector3();
    let cw = canvas.clientWidth || window.innerWidth;
    let chh = canvas.clientHeight || window.innerHeight;
    ctx.listen(window, 'resize', () => {
      cw = canvas.clientWidth || window.innerWidth;
      chh = canvas.clientHeight || window.innerHeight;
    });
    const toScreen = (x, z, dy = 0) => {
      projV.set(o.x0 + x, table.topWorldY + dy, o.z0 + z).project(cam);
      return { x: (projV.x * 0.5 + 0.5) * cw, y: (-projV.y * 0.5 + 0.5) * chh, behind: projV.z > 1 };
    };
    const pointerFabric = () => {
      const p = engine.pointerOnPlane(plane);
      return p ? worldToFabric(p.x, p.z) : null;
    };
    // px por metro en la pantalla, en (x, z) y dirección (nx, nz)
    const pxPerM = (x, z, nx, nz) => {
      const a = toScreen(x, z);
      const b = toScreen(x + nx * 0.02, z + nz * 0.02);
      return Math.hypot(b.x - a.x, b.y - a.y) / 0.02;
    };
    const tolPx = () => (isTouch ? 44 : 28);
    const engagePx = () => (isTouch ? 56 : 36);
    const wPos = (x, z, dy = 0) => new THREE.Vector3(o.x0 + x, table.topWorldY + dy, o.z0 + z);

    // ---------------- marcadores 3D ----------------
    const accentMat = new THREE.MeshBasicMaterial({ color: '#e0553a', transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const marker = new THREE.Group();
    const ringM = new THREE.Mesh(new THREE.RingGeometry(0.0085, 0.0122, 40).rotateX(-Math.PI / 2), accentMat);
    const dotM = new THREE.Mesh(new THREE.CircleGeometry(0.0038, 24).rotateX(-Math.PI / 2), accentMat);
    const haloMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, toneMapped: false });
    const haloM = new THREE.Mesh(new THREE.RingGeometry(0.0122, 0.0145, 40).rotateX(-Math.PI / 2), haloMat);
    for (const m of [haloM, ringM, dotM]) {
      m.renderOrder = 30;
      marker.add(m);
    }
    marker.visible = false;
    table.group.add(marker);

    // guía: chevrones que muestran por dónde sigue la línea
    const chevCanvas = (() => {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 32;
      const c = cv.getContext('2d');
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(40,28,18,0.45)';
      c.lineWidth = 13;
      c.beginPath();
      c.moveTo(18, 5);
      c.lineTo(42, 16);
      c.lineTo(18, 27);
      c.stroke();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 8;
      c.stroke();
      return cv;
    })();
    const chevTex = new THREE.CanvasTexture(chevCanvas);
    chevTex.wrapS = THREE.RepeatWrapping;
    chevTex.wrapT = THREE.ClampToEdgeWrapping;
    chevTex.repeat.set(1 / 0.03, 1);
    chevTex.colorSpace = THREE.SRGBColorSpace;
    const guideMat = new THREE.MeshBasicMaterial({ map: chevTex, color: '#ffd166', transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
    const guides = [0, 1].map(() => {
      const rb = dynamicRibbon(60);
      const m = new THREE.Mesh(rb.geometry, guideMat);
      m.position.y = topY + 0.0012;
      m.renderOrder = 25;
      m.frustumCulled = false;
      m.visible = false;
      table.group.add(m);
      return { rb, m };
    });

    // ranura del corte
    const slitMat = new THREE.MeshBasicMaterial({ color: darkFabric ? '#4b8a69' : '#17301f', transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide, toneMapped: false });
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: darkFabric ? 0.2 : 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide, toneMapped: false });
    const makeSlit = (capacity) => {
      const core = dynamicRibbon(capacity);
      const rim = dynamicRibbon(capacity);
      const mRim = new THREE.Mesh(rim.geometry, edgeMat);
      const mCore = new THREE.Mesh(core.geometry, slitMat);
      mRim.position.y = topY + 0.0009;
      mCore.position.y = topY + 0.001;
      mRim.renderOrder = 3;
      mCore.renderOrder = 4;
      mRim.frustumCulled = mCore.frustumCulled = false;
      table.group.add(mRim, mCore);
      return {
        push(x, z, nx, nz) {
          rim.push(x, z, nx, nz, -0.0016, 0.0016);
          core.push(x, z, nx, nz, -0.0007, 0.0007);
        },
        tip(x, z, nx, nz) {
          rim.tip(x, z, nx, nz, -0.0016, 0.0016);
          core.tip(x, z, nx, nz, -0.0007, 0.0007);
        },
        dispose() {
          for (const m of [mRim, mCore]) {
            m.geometry.dispose();
            table.group.remove(m);
          }
        },
      };
    };

    // ---------------- DOM sobre la escena ----------------
    const mkLabel = (cls, html) => {
      const e = h('div', { class: `cor-label ${cls}`, html });
      e.style.display = 'none';
      appEl.appendChild(e);
      ctx.track(() => e.remove());
      return e;
    };
    const startLabel = mkLabel('cor-label-start', 'Empezá acá');
    const pop = (x, z, html, cls = '') => {
      const p = toScreen(x, z, 0.01);
      if (p.behind) return;
      const el = h('div', { class: `cor-pop ${cls}`, html });
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
      appEl.appendChild(el);
      const kill = () => el.remove();
      ctx.track(kill);
      ctx.timeout(kill, 1400);
    };
    panelEl.classList.add('cor-mode');
    ctx.track(() => panelEl.classList.remove('cor-mode'));
    ctx.track(() => {
      appEl.classList.remove('cor-play');
      canvas.style.cursor = '';
    });

    // ---------------- HUD ----------------
    const hudEl = h(
      'div',
      { class: 'cor-hud' },
      h('div', { class: 'hud-title' }, h('span', { class: 'cor-hud-tool' }, '✂️ Corte'), h('span', { class: 'cor-hud-count' })),
      h('div', { class: 'cor-hud-name' }),
      h('div', { class: 'cor-hud-main' }, h('span', { class: 'hud-big cor-hud-acc' }, '—'), h('span', { class: 'cor-hud-cap' }, 'precisión', h('br'), 'de la pieza')),
      h('div', { class: 'cor-hud-prog', title: 'Avance de la pieza' }, h('i')),
      h(
        'div',
        { class: 'cor-gauge' },
        h('span', { class: 'cor-gauge-lab' }, 'adentro'),
        h('span', { class: 'cor-gauge-track' }, h('i', { class: 'cor-gauge-ok' }), h('b', { class: 'cor-gauge-needle' })),
        h('span', { class: 'cor-gauge-lab' }, 'afuera'),
      ),
      h('div', { class: 'cor-hud-dev' }),
      h('div', { class: 'cor-hud-status' }),
    );
    const q = (sel) => hudEl.querySelector(sel);
    let hudShown = false;
    const showHud = () => {
      if (hudShown) return;
      hudShown = true;
      ui.hud(hudEl);
    };
    let statusKey = '';
    const setStatus = (key, html, cls = '') => {
      if (statusKey === key) return;
      statusKey = key;
      const st = q('.cor-hud-status');
      st.className = `cor-hud-status ${cls}`;
      st.innerHTML = html;
    };
    let hudT = 0;
    function updateHud(force = false) {
      const now = performance.now();
      if (!force && now - hudT < 90) return;
      hudT = now;
      const it = items[curIdx];
      if (!it) return;
      const nShown = items.filter((x) => x.method !== 'gemela').length;
      const nPos = items.slice(0, curIdx + 1).filter((x) => x.method !== 'gemela').length || 1;
      q('.cor-hud-tool').textContent = `${TOOLS[tool].icon} ${TOOLS[tool].short}`;
      q('.cor-hud-count').textContent = it.method === 'gemela' ? 'gemela' : `${nPos}/${nShown}`;
      const nm = q('.cor-hud-name');
      const label = it.method === 'regla' ? `${it.name} · con regla` : it.method === 'gemela' ? `${it.name} · mismo trazo` : it.name;
      if (nm.textContent !== label) nm.textContent = label;
      let acc = null;
      let prog = 0;
      let dev = 0;
      if (tr && tr.item === it) {
        acc = tr.cutLen > 0.015 ? pieceAccuracy(tr.devSum / tr.cutLen, tr.salidas) : null;
        prog = tr.path ? tr.s / tr.path.total : 0;
        dev = tr.off;
      } else if (ru && ru.item === it) {
        acc = ru.fixed ? rulerAccuracy(ru.off) : null;
        prog = ru.prog || 0;
        dev = ru.off;
      } else if (it.acc != null) {
        acc = it.acc;
        prog = 1;
      } else if (curRun && curRun.it === it) {
        const st = curRun.st;
        acc = st.cutLen > 0.03 ? pieceAccuracy(st.devSum / st.cutLen, st.salidas || 0) : null;
        prog = st.s / st.path.total;
        dev = st.off;
      }
      const accEl = q('.cor-hud-acc');
      accEl.textContent = acc == null ? '—' : pctTxt(acc);
      accEl.style.color = acc == null ? '' : accColor(acc);
      q('.cor-hud-prog i').style.width = `${Math.round(clamp(prog) * 100)}%`;
      const span = ru && ru.item === it ? RULER_AMP * 1.15 : 0.008;
      q('.cor-gauge-needle').style.left = `${Math.round(50 + clamp(dev / span, -1, 1) * 50)}%`;
      q('.cor-gauge').classList.toggle('bad', Math.abs(dev) > 0.0045);
      q('.cor-gauge').classList.toggle('good', Math.abs(dev) <= 0.0015);
      const dv = q('.cor-hud-dev');
      let txt = '';
      if (ru && ru.item === it) txt = `${ru.fixed ? 'Regla fijada' : 'Regla'}: <b>${mmTxt(ru.off)}</b> ${ru.off >= 0 ? 'afuera' : 'adentro'}`;
      else if (tr && tr.item === it) txt = `Desvío ahora: <b>${mmTxt(dev)}</b>${tr.salidas ? ` · salidas: <b>${tr.salidas}</b>` : ''}`;
      else if (it.acc != null) txt = `Desvío medio: <b>${mmTxt(it.dev)}</b>`;
      if (dv.innerHTML !== txt) dv.innerHTML = txt;
    }

    // ---------------- Panel ----------------
    const rows = new Map();
    const methodTag = { trazo: '✂ a pulso', gemela: '✂✂ gemela', regla: '📐 con regla' };
    const pieceList = h('div', { class: 'cor-pieces', role: 'list' });
    for (const it of items) {
      const chip = h('span', { class: 'cor-chip' }, 'Por cortar');
      const row = h(
        'div',
        { class: 'cor-piece is-pending', role: 'listitem' },
        h('span', { class: 'cor-piece-thumb' }, pieceThumb(it.piece, { size: 40 })),
        h('span', { class: 'cor-piece-text' }, h('span', { class: 'cor-piece-name' }, it.name), h('span', { class: 'cor-piece-method' }, methodTag[it.method] + (it.method === 'gemela' ? ' de la izquierda' : ''))),
        chip,
      );
      rows.set(it.id, { row, chip });
      pieceList.appendChild(row);
    }
    function renderRows() {
      for (const it of items) {
        const { row, chip } = rows.get(it.id);
        let cls = 'is-pending';
        let txt = 'Por cortar';
        if (it.status === 'active') {
          cls = 'is-active';
          txt = it.method === 'regla' ? 'Con regla…' : it.method === 'gemela' ? 'Copiando…' : 'Cortando…';
        } else if (it.status === 'done') {
          cls = 'is-done';
          txt = `✓ ${pctTxt(it.acc)}`;
          chip.style.setProperty('--acc', accColor(it.acc));
        }
        row.className = `cor-piece ${cls}`;
        if (chip.textContent !== txt) chip.textContent = txt;
      }
    }

    const toolBtns = new Map();
    const dots = (label, n) => h('span', { class: 'cor-dots', title: `${label}: ${n} de 5` }, h('span', { class: 'cor-dots-lab' }, label), h('span', { class: 'cor-dots-row' }, ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= n ? 'on' : '' }))));
    const toolCard = (id) => {
      const T = TOOLS[id];
      const btn = h(
        'button',
        { class: 'cor-tool', dataset: { id }, 'aria-pressed': 'false', onClick: () => chooseTool(id) },
        h('span', { class: 'cor-tool-icon', html: TOOL_SVG[id] }),
        h(
          'span',
          { class: 'cor-tool-text' },
          h('span', { class: 'cor-tool-name' }, T.name, recTool === id ? h('span', { class: 'cor-badge' }, 'Ideal para esta tela') : null),
          h('span', { class: 'cor-tool-desc' }, T.desc),
          h('span', { class: 'cor-tool-stats' }, dots('Precisión', T.precision), dots('Velocidad', T.speed)),
        ),
        isMobile() ? null : h('span', { class: 'kbd cor-tool-key' }, id === 'tijera' ? '1' : '2'),
      );
      toolBtns.set(id, btn);
      return btn;
    };
    const toolSection = h('div', { class: 'cor-tools' }, toolCard('tijera'), toolCard('cutter'));
    const toolChosen = h('div', { class: 'cor-tool-chosen' });
    const tips = h(
      'details',
      { class: 'cor-tips' },
      h('summary', {}, '✂️ Cómo se corta bien'),
      h(
        'ul',
        {},
        h('li', { html: 'Cortá por el <b>medio de la línea de tiza</b>: el margen de costura (1 cm, y 2,5 cm en el ruedo) ya está incluido en el molde.' }),
        h('li', { html: 'La tela bien plana sobre la mesa y la mano libre sosteniéndola cerca de la herramienta, <b>sin estirarla</b>.' }),
        h('li', { html: 'En las curvas (escote, sisa, copa de la manga) <b>bajá la velocidad</b>: es donde más se nota un corte torcido.' }),
        h('li', { html: 'Cúter circular: siempre sobre la <b>base de corte</b>, empujando hacia adelante y con los dedos lejos de la cuchilla.' }),
        h('li', { html: 'Cada pieza cortada se <b>dobla al medio por el hilo</b> y va a la pila, lejos de lo que falta cortar: así no se estira ni se pisa con la herramienta.' }),
        h('li', { html: fabric.knit ? `En <b>${fabric.short}</b> (tejido de punto) no levantes la tela: si la estirás mientras cortás, la pieza vuelve más chica.` : `El <b>${fabric.short.toLowerCase()}</b> es tejido plano y se deshilacha: herramienta bien afilada y bordes terminados con overlock.` }),
      ),
    );
    const keys = h('div', { class: 'cor-keys' });
    const renderKeys = () => {
      keys.innerHTML = isMobile()
        ? 'Apoyá el dedo en el <b>●</b> y seguí la línea sin levantarlo.'
        : phase === 'choose'
          ? '<span class="kbd">1</span> / <span class="kbd">2</span> herramienta · <span class="kbd">Enter</span> empezar'
          : 'Mantené apretado el mouse (o <span class="kbd">Espacio</span>) y seguí la tiza · tiras: clic o <span class="kbd">Espacio</span> para fijar la regla';
    };
    renderKeys();
    const body = h('div', { class: 'cor' }, ui.section('Herramienta', toolSection, toolChosen), ui.section(`Piezas a cortar · talle ${pattern.opts.size}`, pieceList), tips, keys);
    ui.panel({
      kicker: 'Paso 6 · Mesa de corte',
      title: 'Cortar la tela',
      subtitle: isMobile() ? `Elegí la herramienta y seguí las líneas de tiza sobre el <b>${fabric.short}</b>.` : `Elegí la herramienta y cortá cada molde siguiendo la <b>línea de tiza</b> sobre el ${fabric.short}. Cuanto más parejo, mejor calzan las costuras.`,
      body,
      actions: [
        { id: 'start', label: '✂️ ¡A cortar!', kind: 'primary', onClick: () => startGame() },
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoAll() },
      ],
    });
    renderRows();

    function renderToolChoice() {
      for (const [id, b] of toolBtns) {
        b.classList.toggle('selected', id === tool);
        b.setAttribute('aria-pressed', id === tool ? 'true' : 'false');
      }
      ui.updateAction('start', { label: `${TOOLS[tool].icon} ¡A cortar!` });
    }

    // ---------------- herramienta en la mano ----------------
    const toolPoseAt = (c, x, z, heading, lift) => {
      // pose que tendría la herramienta en ese punto (sin moverla)
      const g = c.group;
      const sp = g.position.clone();
      const sr = g.rotation.clone();
      const sh = { ...c.state };
      c.snap(wPos(x, z), heading, lift);
      const pose = { position: g.position.clone(), rotation: g.rotation.clone() };
      g.position.copy(sp);
      g.rotation.copy(sr);
      Object.assign(c.state, sh);
      return pose;
    };
    async function moveToolTo(c, x, z, heading, lift = 0.02, dur = 0.55) {
      if (!c) return;
      const pose = toolPoseAt(c, x, z, heading, lift);
      await tween(dur, poseTween(c.group, pose, { arc: 0.08 }));
      if (!ctx.alive) return;
      c.snap(wPos(x, z), heading, lift);
    }
    async function returnTool(c, dur = 0.7) {
      if (!c) return;
      const k = c === ctls.tijera ? 'tijera' : 'cutter';
      const p = poses[k];
      if (!p) return;
      await tween(dur, poseTween(c.group, { position: p.position, rotation: p.rotation }, { arc: 0.1 }));
      if (!ctx.alive) return;
      restorePose(p);
      if (k === 'tijera') props.tijera?.setOpen?.(0);
      else props.cutter?.setRoll?.(0);
    }
    const showcase = { x: L - 0.2, z: W * 0.62, heading: 0.55 };
    let pickToken = 0;
    async function chooseTool(id) {
      if (phase !== 'choose' || !TOOLS[id]) return;
      const prev = tool;
      tool = id;
      renderToolChoice();
      audio.play('select');
      const token = ++pickToken;
      if (prev !== id && ctls[prev] && ctl === ctls[prev]) returnTool(ctls[prev], 0.55);
      ctl = ctls[id];
      if (ctl) {
        if (prev === 'tijera' && id === 'tijera') props.tijera?.setOpen?.(0.45);
        await moveToolTo(ctl, showcase.x, showcase.z, showcase.heading, 0.03, 0.7);
        if (token !== pickToken || !ctx.alive) return;
        if (id === 'tijera') props.tijera?.setOpen?.(0.45);
      }
    }

    // ---------------- flujo ----------------
    async function startGame() {
      if (phase !== 'choose') return;
      phase = 'prep';
      document.activeElement?.blur?.();
      ui.hint(null);
      hintKey = '';
      ctl = ctls[tool];
      toolSection.style.display = 'none';
      toolChosen.innerHTML = '';
      toolChosen.appendChild(h('span', { class: 'cor-tool-icon', html: TOOL_SVG[tool] }));
      toolChosen.appendChild(h('span', { class: 'cor-tool-chosen-text', html: `<b>${TOOLS[tool].name}</b><br><span>${tool === 'tijera' ? 'Precisa: corta despacio y perdona el pulso.' : 'Rápido: frená en las curvas.'}</span>` }));
      ui.setActions([{ id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoAll() }]);
      renderKeys();
      showHud();
      if (isMobile()) {
        panelEl.classList.add('collapsed');
        appEl.classList.add('cor-play');
        ui._layout?.();
      }
      await runPieces();
    }

    async function runPieces() {
      for (const it of items) {
        if (!ctx.alive) return;
        if (it.status === 'done') continue;
        curIdx = it.idx;
        it.status = 'active';
        renderRows();
        updateHud(true);
        if (it.method === 'gemela') await doReplay(it);
        else if (it.method === 'regla') await doRuler(it);
        else await doTrace(it);
        if (!ctx.alive) return;
        const anim = finishPiece(it);
        renderRows();
        // pausa para ver cómo se despega la pieza, se dobla y el hueco que deja
        if (autoMode) await sleep(120);
        else if (items[it.idx + 1]?.method === 'gemela') {
          // la gemela se corta al lado: que la manga doblada ya esté en la pila
          await Promise.race([anim.landed, sleep(2600)]);
          await sleep(120);
        } else {
          await Promise.race([anim.folded, sleep(1800)]);
          await sleep(220);
        }
      }
      if (ctx.alive) await finishAll();
    }

    // ----- corte a pulso -----
    function startIndexFor(it, az) {
      const sx = Math.sin(az);
      const sz = Math.cos(az);
      let mx = -Infinity;
      for (const p of it.loop) mx = Math.max(mx, p.x * sx + p.z * sz);
      const cands = [];
      it.loop.forEach((p, i) => {
        if (p.x * sx + p.z * sz >= mx - 0.02) cands.push(i);
      });
      // el del medio de ese borde (lejos de las esquinas)
      const rx = Math.cos(az);
      const rz = -Math.sin(az);
      const mean = cands.reduce((a, i) => a + it.loop[i].x * rx + it.loop[i].z * rz, 0) / cands.length;
      let best = cands[0];
      let bd = Infinity;
      for (const i of cands) {
        const d = Math.abs(it.loop[i].x * rx + it.loop[i].z * rz - mean);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    }

    function doTrace(it) {
      return new Promise((resolve) => {
        if (autoMode) {
          autoTrace(it).then(resolve);
          return;
        }
        viewKind = 'piece';
        const vw = pieceView(it);
        flyView(vw, 1.0);
        const start = startIndexFor(it, vw.azimuth || 0);
        const pf = buildPath(it.loop, start, 1);
        const pr = buildPath(it.loop, start, -1);
        const p0 = pointAt(pf, 0);
        tr = {
          item: it,
          pf,
          pr,
          path: null,
          start,
          s: 0,
          off: 0,
          offBase: 0,
          lastOff: 0,
          skid: 0,
          travel: 0,
          engaged: false,
          engagedT: 0,
          engageS: 0,
          offT: 0,
          ahead: 0,
          fast: false,
          devSum: 0,
          cutLen: 0,
          time: 0,
          salidas: 0,
          next: 0,
          slit: null,
          offsets: null,
          resolve,
          done: false,
          freshT: performance.now(), // la pulsación tiene que empezar desde acá (no vale venir apretando)
        };
        phase = 'prep';
        setStatus('prep', `Preparando ${it.name.toLowerCase()}…`);
        moveToolTo(ctl, p0.x, p0.z, headingOf(p0.tx, p0.tz), 0.02, 0.5).then(() => {
          if (!ctx.alive || !tr || tr.item !== it || tr.done) return;
          if (autoMode) return;
          phase = 'trace';
          updateTraceHint();
        });
      });
    }

    let hintKey = '';
    const setHint = (key, html) => {
      if (hintKey === key) return;
      hintKey = key;
      ui.hint(html);
    };
    function updateTraceHint() {
      if (!tr) return;
      const m = isMobile() || isTouch;
      if (!tr.engaged) {
        if (tr.s < 0.002 && pressStale()) setHint('fresh', m ? '👆 Levantá el dedo y apoyalo de nuevo en el <b>●</b> para empezar esta pieza' : 'Soltá y volvé a apretar sobre el <b>●</b> para empezar esta pieza');
        else if (tr.s < 0.002) setHint('start', m ? '👆 Apoyá el dedo en el <b>●</b> y seguí la línea de tiza sin levantarlo' : 'Apretá sobre el <b>●</b> y, <b>sin soltar</b>, seguí la línea de tiza (o mantené <kbd>Espacio</kbd>)');
        else setHint('resume', m ? 'Volvé a apoyar el dedo en el <b>●</b> para seguir' : 'Apretá de nuevo sobre el <b>●</b> para seguir cortando');
      } else if (tr.fast) setHint('fast', '🌀 ¡Curva! Frená un poco o la cuchilla se desvía');
      else if (tr.ahead > LOOK * 0.85) setHint('ahead', tool === 'tijera' ? '⏳ Vas más rápido que la tijera: esperala <b>sobre la línea</b>' : '⏳ Vas más rápido que la cuchilla: esperala <b>sobre la línea</b>');
      else setHint('go', tool === 'tijera' ? '✂️ Seguí la tiza… despacio en las curvas' : '🌀 Seguí la tiza con pulso firme');
    }

    function initSlit() {
      const path = tr.path;
      tr.slit = makeSlit(path.count + 2);
      tr.offsets = new Float32Array(path.count);
      tr.offsets[0] = tr.off;
      tr.slit.push(path.pts[0].x + path.nx[0] * tr.off, path.pts[0].z + path.nz[0] * tr.off, path.nx[0], path.nz[0]);
      tr.next = 1;
      tr.lastOff = tr.off;
    }

    // avanza el corte ds (m) con el desvío actual; dibuja la ranura y mueve la herramienta
    function advance(st, ds, dt, engaged = true) {
      const path = st.path;
      const s0 = st.s;
      const s1 = Math.min(path.total, s0 + Math.max(0, ds));
      if (s1 > s0) {
        let vdev = 0;
        while (st.next <= path.count && path.cum[st.next] <= s1 + 1e-9) {
          const i = st.next % path.count;
          const f = (path.cum[st.next] - s0) / Math.max(1e-9, s1 - s0);
          // recorridos automáticos: el desvío de cada vértice sale de su perfil (no depende de los fps)
          const off = st.vertexOff ? st.vertexOff(i) : lerp(st.lastOff, st.off, clamp(f));
          if (st.next < path.count) st.offsets[i] = off;
          st.slit.push(path.pts[i].x + path.nx[i] * off, path.pts[i].z + path.nz[i] * off, path.nx[i], path.nz[i]);
          vdev += Math.abs(off) * (path.cum[st.next] - path.cum[st.next - 1]);
          st.next++;
        }
        if (st.vertexOff) st.devSum += vdev;
        else st.devSum += ((Math.abs(st.lastOff) + Math.abs(st.off)) / 2) * (s1 - s0);
        st.cutLen += s1 - s0;
        st.time += dt;
        st.travel += s1 - s0;
      }
      st.lastOff = st.off;
      st.s = s1;
      const p = pointAt(path, s1);
      const x = p.x + p.nx * st.off;
      const z = p.z + p.nz * st.off;
      if (st.next <= path.count) st.slit.tip(x, z, p.nx, p.nz);
      if (ctl) {
        const snip = ctl.update(wPos(x, z), headingOf(p.tx, p.tz), s1 - s0, engaged, dt);
        if (snip) audio.play('snip');
      }
      if (s1 > s0 && Math.random() < 0.25) table.puff(x, z, 1);
      if (tool === 'cutter') {
        const v = s1 > s0 ? (s1 - s0) / Math.max(1e-3, dt) / timeScale : 0;
        if (engaged || v > 0) {
          if (!loop) loop = audio.loop('rumble');
          loop.set(Math.min(1, v / 0.3) * 0.7, 700 + Math.min(1, v / 0.4) * 2200);
        }
      }
      return s1 >= path.total - 1e-6;
    }

    // ¿la pulsación vale para esta pieza? (tiene que haber empezado después de que la pieza se
    // preparó: si venías apretando desde la pieza anterior, hay que soltar y volver a apretar)
    const pressFresh = () => (pressing && pressT >= tr.freshT) || (keyPress && keyT >= tr.freshT);
    const pressStale = () => !pressFresh() && (pressing || keyPress);
    // distancia en pantalla (px) entre el puntero y un punto de la tela
    const ptrDistPx = (x, z) => {
      const a = toScreen(x, z);
      return Math.hypot(a.x - engine.pointer.x, a.y - engine.pointer.y);
    };
    const cA = {};
    const cB = {};
    const cC = {};

    function traceUpdate(dt) {
      const T = TOOLS[tool];
      const press = pressFresh() && !modalOpen();
      const P = pointerFabric();
      const path0 = tr.path || tr.pf;
      // punto actual del corte
      const cp = pointAt(path0, tr.s);
      const cx = cp.x + cp.nx * tr.off;
      const cz = cp.z + cp.nz * tr.off;
      if (!tr.engaged) {
        if (loop) loop.set(0);
        if (press && P && ptrDistPx(cx, cz) <= engagePx()) {
          tr.engaged = true;
          tr.engagedT = 0;
          tr.engageS = tr.s;
          tr.offT = 0;
          audio.play('tick');
          tr.ptrS = tr.s;
          canvas.style.cursor = 'crosshair';
        }
        if (ctl) ctl.update(wPos(cx, cz), headingOf(cp.tx, cp.tz), 0, false, dt);
        updateTraceHint();
        return;
      }
      if (!press) {
        tr.engaged = false;
        canvas.style.cursor = '';
        updateTraceHint();
        return;
      }
      tr.engagedT += dt;
      if (!P) return offLine(dt);
      const tol = tolPx();
      const gainK = MM_PER_PX * T.gain * (isTouch ? TOUCH_K : 1);
      let path = tr.path;
      if (!path) {
        // todavía en el arranque: el primer movimiento decide el sentido
        const cf = closest(tr.pf, P.x, P.z, 0, 0.3, cA);
        const cr = closest(tr.pr, P.x, P.z, 0, 0.3, cB);
        const useF = cf.d <= cr.d;
        const c = useF ? cf : cr;
        if (ptrDistPx(c.x, c.z) > tol) return offLine(dt);
        tr.offT = 0;
        const pxm = pxPerM(c.x, c.z, c.nx, c.nz);
        const offTarget = clamp(c.side * pxm * gainK, -MAX_OFF, MAX_OFF);
        tr.offBase += (offTarget - tr.offBase) * (1 - Math.exp(-dt / T.smooth));
        tr.off = tr.offBase;
        if (c.s > 0.012) {
          tr.path = useF ? tr.pf : tr.pr;
          path = tr.path;
          initSlit();
        } else {
          if (ctl) ctl.update(wPos(cx, cz), headingOf(cp.tx, cp.tz), 0, true, dt);
          setHint('go', tool === 'tijera' ? '✂️ Seguí la tiza… despacio en las curvas' : '🌀 Seguí la tiza con pulso firme');
          return;
        }
      }
      // 1) el puntero sobre la línea, cerca de donde venía (sigue la continuidad del trazo)
      const ptr0 = tr.ptrS ?? tr.s;
      let c = closest(path, P.x, P.z, Math.max(tr.s - 0.03, ptr0 - 0.1), ptr0 + 0.25, cA);
      let dPx = ptrDistPx(c.x, c.z);
      if (dPx > tol) {
        // 2) ¿sobre la línea pero más adelante? (fue más rápido que la herramienta: no es salida,
        // solo hay que esperarla). Se busca en todo lo que falta cortar.
        const c2 = closest(path, P.x, P.z, tr.s - 0.03, path.total, cB);
        const d2 = ptrDistPx(c2.x, c2.z);
        if (d2 <= tol) {
          c = c2;
          dPx = d2;
        }
      }
      const onLine = dPx <= tol;
      // ¿volvió para atrás por la línea ya cortada? (no es salida: solo no avanza)
      const behind = () => {
        if (tr.s < 0.05) return false;
        const c3 = closest(path, P.x, P.z, Math.max(0, tr.s - 0.6), tr.s - 0.004, cC);
        if (ptrDistPx(c3.x, c3.z) > tol) return false;
        if (tr.ptrS != null && Math.abs(c3.s - tr.ptrS) > 0.15) return false; // saltó: no viene por la línea
        tr.ptrS = c3.s;
        tr.offT = 0;
        tr.ahead = 0;
        setHint('back', '↪ Ese tramo ya está cortado: seguí hacia adelante, por donde marcan las flechas');
        if (ctl) ctl.update(wPos(cx, cz), headingOf(cp.tx, cp.tz), 0, true, dt);
        return true;
      };
      if (onLine && c.s <= tr.s - 0.028 && behind()) return;
      if (!onLine) {
        if (behind()) return;
        tr.ptrS = null;
        return offLine(dt);
      }
      tr.offT = 0;
      tr.ptrS = c.s;
      tr.ahead = c.s - tr.s;
      let target = Math.min(c.s, tr.s + LOOK);
      // ya llegó (el inicio es también el final): que no quede colgada a un milímetro
      if (target >= path.total - END_SNAP) target = path.total;
      const kc = maxCurv(path, tr.s, tr.s + 0.05);
      const straight = clamp(1 - (kc - 6) / 30);
      let v = T.vmax * timeScale;
      if (tool === 'tijera') v *= lerp(T.vCurve, 1, straight);
      const ds = clamp(target - tr.s, 0, v * dt);
      const speed = ds / Math.max(dt, 1e-4) / timeScale;
      // el desvío del corte sale de cuán corrido de la tiza va el puntero
      const pxm = pxPerM(c.x, c.z, c.nx, c.nz);
      const offTarget = clamp(c.side * pxm * gainK, -MAX_OFF, MAX_OFF);
      tr.offBase += (offTarget - tr.offBase) * (1 - Math.exp(-dt / T.smooth));
      let extra = 0;
      if (tool === 'cutter') {
        const curvy = 1 - straight;
        const over = Math.max(0, speed - T.curveSafe);
        const amp = over * curvy * 0.035;
        tr.skid += (amp - tr.skid) * (1 - Math.exp(-dt * 6));
        extra = tr.skid * Math.sin(tr.travel * 150);
        tr.fast = over * curvy > 0.05;
      } else if (drag > 0 && ds > 0) {
        extra = drag * Math.sin(tr.travel * 33 + 1.3) * (0.6 + 0.4 * Math.sin(tr.travel * 7.3));
      }
      tr.off = clamp(tr.offBase + extra, -MAX_OFF, MAX_OFF);
      const done = advance(tr, ds, dt, true);
      updateTraceHint();
      if (done) completeTrace();
    }

    function offLine(dt) {
      tr.offT += dt;
      if (tr.offT < 0.12) return;
      const started = tr.engagedT > 0.25 || tr.s - tr.engageS > 0.005;
      tr.engaged = false;
      tr.offT = 0;
      canvas.style.cursor = '';
      if (loop) loop.set(0);
      if (!started) return;
      tr.salidas++;
      audio.play('bad');
      const p = pointAt(tr.path || tr.pf, tr.s);
      pop(p.x, p.z, '✗', 'bad');
      ui.toast(tr.salidas === 1 ? '✗ ¡Te saliste de la línea! Volvé al punto ● para seguir.' : `✗ Otra salida (${tr.salidas}). Más despacio y mirando la tiza.`, 'bad', 2200);
      setStatus(`salida${tr.salidas}`, `✗ Salida ${tr.salidas}: −${3}% de precisión`, 'bad');
      setHint('resume', isMobile() || isTouch ? 'Volvé a apoyar el dedo en el <b>●</b> para seguir' : 'Apretá de nuevo sobre el <b>●</b> para seguir cortando');
    }

    function completeTrace() {
      if (!tr || tr.done) return;
      tr.done = true;
      const it = tr.item;
      const dev = tr.cutLen > 0 ? tr.devSum / tr.cutLen : 0;
      it.dev = dev;
      it.salidas = tr.salidas;
      it.acc = pieceAccuracy(dev, tr.salidas);
      it.path = tr.path;
      it.offsets = tr.offsets;
      it.slit = tr.slit;
      it.time = tr.time;
      it.auto = it.auto || false;
      cutTime += tr.time;
      cutLen += tr.cutLen;
      phase = 'prep';
      canvas.style.cursor = '';
      if (loop) loop.set(0);
      ui.hint(null);
      hintKey = '';
      const resolve = tr.resolve;
      tr = null;
      resolve();
    }

    // corte animado a lo largo de un recorrido (automático, gemela, regla)
    async function runAlong(it, path, offsets, speed, { manualPart = null } = {}) {
      const st = manualPart || { path, s: 0, off: offsets[0], lastOff: offsets[0], devSum: 0, cutLen: 0, time: 0, travel: 0, next: 0, slit: null, offsets: new Float32Array(path.count) };
      if (!st.slit) {
        st.slit = makeSlit(path.count + 2);
        st.offsets[0] = offsets[0];
        st.slit.push(path.pts[0].x + path.nx[0] * offsets[0], path.pts[0].z + path.nz[0] * offsets[0], path.nx[0], path.nz[0]);
        st.next = 1;
      }
      const sFrom = st.s;
      const rest = path.total - sFrom;
      const dur = rest / speed;
      st.vertexOff = (i) => offsets[i] ?? 0;
      curRun = { it, st };
      await tween(dur, (k, sdt) => {
        if (!ctx.alive) return;
        const s = sFrom + rest * k;
        const p = pointAt(path, s);
        const j = (p.i + 1) % path.count;
        st.off = lerp(offsets[p.i] ?? 0, offsets[j] ?? 0, p.f);
        advance(st, s - st.s, Math.max(1e-3, sdt), true);
      });
      if (!ctx.alive) return st;
      if (st.s < path.total) advance(st, path.total - st.s, 0.016, true);
      st.vertexOff = null;
      if (curRun && curRun.st === st) curRun = null;
      if (loop) loop.set(0);
      return st;
    }

    async function autoTrace(it, from = null) {
      // desvíos de "oficio promedio": ~2,7 mm de media → ~70%
      const start = from ? from.start : startIndexFor(it, 0);
      const path = from?.path || buildPath(it.loop, start, 1);
      const offs = autoOffsets(path, 0.0026, 17 + it.idx * 31);
      if (from) {
        // seguir desde donde quedó el jugador: el desvío arranca del actual
        const i0 = Math.floor((from.s / path.total) * path.count);
        for (let i = i0; i < Math.min(path.count, i0 + 25); i++) offs[i] = lerp(from.off, offs[i], (i - i0) / 25);
      }
      if (!from) {
        const p0 = pointAt(path, 0);
        await moveToolTo(ctl, p0.x, p0.z, headingOf(p0.tx, p0.tz), 0.015, 0.35 / Math.max(1, timeScale));
        if (!ctx.alive) return;
      }
      phase = 'replay';
      const manualTime = from ? from.time : 0;
      const manualLen = from ? from.cutLen : 0;
      const st = await runAlong(it, path, offs, 1.1 * timeScale, { manualPart: from });
      if (!ctx.alive) return;
      const dev = st.cutLen > 0 ? st.devSum / st.cutLen : 0;
      it.dev = dev;
      it.salidas = from ? from.salidas : 0;
      it.acc = pieceAccuracy(dev, it.salidas);
      it.path = path;
      it.offsets = st.offsets;
      it.slit = st.slit;
      it.auto = true;
      cutTime += manualTime;
      cutLen += manualLen;
    }

    // ----- manga gemela -----
    async function doReplay(it) {
      const twin = itemById.get(it.twinOf);
      if (!twin || !twin.path || !twin.offsets) {
        it.method = 'trazo';
        return doTrace(it);
      }
      phase = 'replay';
      if (!autoMode) {
        viewKind = 'piece';
        flyView(pieceView(it), 0.9);
        ui.toast('✂️✂️ La manga derecha es gemela de la izquierda: se corta con el mismo trazo.', 'info', 3000);
        setStatus('replay', '✂️✂️ Mismo trazo que la manga izquierda');
        ui.hint('✂️✂️ Copiando tu trazo de la manga izquierda…');
      }
      const path = buildPath(it.loop, twin.path.start, twin.path.dir);
      const nA = twin.offsets.length;
      const offs = new Float32Array(path.count);
      for (let i = 0; i < path.count; i++) offs[i] = twin.offsets[Math.min(nA - 1, Math.round((i / path.count) * nA))];
      const p0 = pointAt(path, 0);
      await moveToolTo(ctl, p0.x, p0.z, headingOf(p0.tx, p0.tz), 0.015, 0.45 / Math.max(1, timeScale));
      if (!ctx.alive) return;
      const st = await runAlong(it, path, offs, (autoMode ? 1.1 : 0.62) * timeScale);
      if (!ctx.alive) return;
      it.dev = twin.dev;
      it.salidas = 0;
      it.acc = twin.acc;
      it.path = path;
      it.offsets = st.offsets;
      it.slit = st.slit;
      it.auto = twin.auto;
      ui.hint(null);
    }

    // ----- tiras con regla -----
    function doRuler(it) {
      return new Promise((resolve) => {
        const c = Math.cos(it.pl.rot);
        const s = Math.sin(it.pl.rot);
        const across = { x: -s, z: -c }; // eje y de la pieza (el ancho de la tira) en la tela
        const ruler = createRuler(it.piece.width + 0.08, it.piece.height);
        ruler.group.position.set(it.pl.x, topY + 0.006, it.pl.z);
        ruler.group.rotation.y = it.pl.rot;
        table.group.add(ruler.group);
        const seed = rng(91 + it.idx * 13);
        ru = { item: it, ruler, across, t: seed() * 3, amp: RULER_AMP, period: 2.0 + seed() * 0.5, off: 0, fixed: false, prog: 0, resolve, drop: 0 };
        phase = 'ruler';
        if (autoMode) {
          fixRuler((seed() < 0.5 ? -1 : 1) * (0.002 + seed() * 0.0012));
          return;
        }
        // vista de cerca del medio de la tira: así se ve bien cuánto se corre la regla
        viewKind = 'ruler';
        flyView(rulerView(it), 0.9);
        setStatus('ruler', '📐 Fijá la regla justo sobre la tiza');
        setHint('ruler', isMobile() || isTouch ? '📐 Tocá la pantalla cuando la regla quede <b>justo sobre la tiza</b> (bordes verdes)' : '📐 Hacé clic (o <kbd>Espacio</kbd>) cuando la regla quede <b>justo sobre la tiza</b> (bordes verdes)');
        const mid = { x: it.pl.x + Math.cos(it.pl.rot) * (it.piece.width / 2 + 0.06), z: it.pl.z - Math.sin(it.pl.rot) * (it.piece.width / 2 + 0.06) };
        moveToolTo(ctl, mid.x, mid.z, headingOf(across.x, across.z), 0.03, 0.5);
      });
    }

    function rulerUpdate(dt) {
      if (!ru || ru.fixed) return;
      ru.t += dt;
      ru.off = ru.amp * Math.sin((Math.PI * 2 * ru.t) / ru.period) * (0.8 + 0.2 * Math.sin(ru.t * 0.9));
      const g = ru.ruler.group;
      g.position.x = ru.item.pl.x + ru.across.x * ru.off;
      g.position.z = ru.item.pl.z + ru.across.z * ru.off;
      ru.ruler.setAligned(clamp(1 - (Math.abs(ru.off) - 0.0008) / 0.003));
    }

    async function fixRuler(forceOff = null) {
      if (!ru || ru.fixed) return;
      const R = ru;
      R.fixed = true;
      if (forceOff != null) R.off = forceOff;
      const it = R.item;
      phase = 'rulerCut';
      ui.hint(null);
      hintKey = '';
      audio.play('thud');
      const g = R.ruler.group;
      g.position.x = it.pl.x + R.across.x * R.off;
      g.position.z = it.pl.z + R.across.z * R.off;
      R.ruler.setAligned(clamp(1 - (Math.abs(R.off) - 0.0008) / 0.003));
      const accNow = rulerAccuracy(R.off);
      if (!autoMode) {
        setStatus('rulerFix', Math.abs(R.off) <= 0.0015 ? '✓ ¡Justo sobre la tiza!' : Math.abs(R.off) <= 0.004 ? `Corrida ${mmTxt(R.off)}` : `⚠ Bastante corrida: ${mmTxt(R.off)}`, Math.abs(R.off) <= 0.0015 ? 'good' : Math.abs(R.off) > 0.004 ? 'bad' : '');
        pop(it.pl.x, it.pl.z, pctTxt(accNow), Math.abs(R.off) <= 0.0015 ? 'good' : '');
      }
      await tween(0.14, (k) => (g.position.y = topY + 0.006 - 0.0055 * k));
      if (!ctx.alive) return;
      if (!autoMode) {
        // de vuelta a la tira entera para ver el corte
        viewKind = 'piece';
        ctx.timeout(() => {
          if (ctx.alive && viewKind === 'piece' && items[curIdx] === it) flyView(pieceView(it), 0.7);
        }, 380 / timeScale);
      }
      // la herramienta recorre el contorno corrido junto con la regla
      const path = buildPath(it.loop, 0, 1);
      const offs = new Float32Array(path.count);
      for (let i = 0; i < path.count; i++) offs[i] = R.off * (R.across.x * path.nx[i] + R.across.z * path.nz[i]);
      const p0 = pointAt(path, 0);
      await moveToolTo(ctl, p0.x + p0.nx * offs[0], p0.z + p0.nz * offs[0], headingOf(p0.tx, p0.tz), 0.01, 0.3 / Math.max(1, timeScale));
      if (!ctx.alive) return;
      const st = await runAlong(it, path, offs, (autoMode ? 1.0 : 0.6) * timeScale);
      if (!ctx.alive) return;
      it.dev = Math.abs(R.off);
      it.acc = accNow;
      it.salidas = 0;
      it.path = path;
      it.offsets = st.offsets;
      it.slit = st.slit;
      it.auto = autoMode;
      // la regla se levanta y desaparece
      tween(0.4, (k) => {
        g.position.y = topY + 0.0005 + 0.05 * k;
        g.traverse((m) => {
          if (m.material) m.material.opacity = (m.material.userData.op0 ??= m.material.opacity) * (1 - k);
        });
      }).then(() => {
        g.traverse((m) => {
          m.geometry?.dispose();
          m.material?.map?.dispose();
          m.material?.dispose();
        });
        table.group.remove(g);
      });
      ru = null;
      R.resolve();
    }

    // ----- pieza terminada: hueco en la tela, pieza que se levanta y se apila -----
    function finishPiece(it) {
      const path = it.path;
      const nrm = normalsOf(path);
      let offs = smoothLoop(it.offsets, 2);
      const mkPts = () => path.pts.map((p, i) => ({ x: p.x + nrm[i].x * offs[i], z: p.z + nrm[i].z * offs[i] }));
      let pts = mkPts();
      const others = items.filter((x) => x !== it && x.cutPts);
      for (let attempt = 0; attempt < 4; attempt++) {
        const b = bounds(pts);
        const bad = others.some((x) => polygonsCross(pts, b, x.cutPts, x.cutB, 0.0008));
        if (!bad) break;
        offs = offs.map((v) => (attempt < 2 ? v * 0.5 : 0));
        pts = mkPts();
      }
      it.cutPts = pts;
      it.cutB = bounds(pts);
      it.status = 'done';
      table.addHole(it.id, pts, nrm);
      // la pieza cortada viaja en un "portador" ubicado como la pieza (así se puede doblar por partes)
      const carrier = new THREE.Group();
      carrier.name = `corte-pieza-${it.id}`;
      carrier.position.set(it.pl.x, 0, it.pl.z);
      carrier.rotation.y = it.pl.rot;
      const mesh = table.makePieceMesh(it.piece, it.pl, pts);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      carrier.add(mesh);
      table.group.add(carrier);
      it.mesh = carrier;
      it.fullMesh = mesh;
      // tiza partida: la mitad de afuera queda en la tela, la de adentro se va con la pieza
      it.line.mesh.visible = false;
      const w = CHALK_W / 2;
      const outer = new THREE.Mesh(offsetRibbon(path.pts, nrm, Array.from(offs, (v) => Math.max(v, -w)), w, { y: 0 }), chalkMat);
      // la de adentro (y los piquetes) con material propio: se desvanece cuando la pieza se dobla
      const carriedChalk = chalkMat.clone();
      it.carriedChalk = carriedChalk;
      const inner = new THREE.Mesh(offsetRibbon(path.pts, nrm, -w, Array.from(offs, (v) => Math.min(v, w)), { y: 0 }), carriedChalk);
      for (const m of [outer, inner]) {
        m.position.y = topY + 0.0006;
        m.renderOrder = 2;
        m.raycast = () => {};
        table.group.add(m);
      }
      it.slit?.dispose();
      it.slit = null;
      table.group.updateMatrixWorld(true);
      carrier.updateMatrixWorld(true);
      carrier.attach(inner);
      for (const t of it.ticks) {
        t.material = carriedChalk;
        carrier.attach(t);
      }
      // efectos
      audio.play('snip');
      if (!autoMode) {
        const c = { x: (it.b.minX + it.b.maxX) / 2, z: (it.b.minZ + it.b.maxZ) / 2 };
        pop(c.x, c.z, `✓ ${pctTxt(it.acc)}`, it.acc >= 0.85 ? 'good' : it.acc >= 0.6 ? '' : 'bad');
        setStatus(`done-${it.id}`, `✓ ${it.name}: ${pctTxt(it.acc)}`, it.acc >= 0.75 ? 'good' : '');
        if (it.method !== 'gemela') {
          if (it.acc >= 0.93) {
            audio.play('good');
            ui.toast(`✨ ¡${it.name}: corte impecable!`, 'good', 2200);
          } else if (it.acc < 0.6) {
            ui.toast(it.method === 'regla' ? '📐 Tip: esperá a que los bordes de la regla se pongan verdes.' : it.curvy ? '💡 Tip: en las curvas andá más despacio y mirá un poco más adelante.' : '💡 Tip: mirá la tiza un poco más adelante de la herramienta, no la herramienta.', 'warn', 3200);
          }
        }
      }
      updateHud(true);
      return stackPiece(it);
    }

    // La pieza se despega de la tela, se dobla en el aire (al medio por el hilo y, si es larga, otra
    // vez a lo ancho) y va a la pila. Devuelve { folded, landed } (promesas).
    function stackPiece(it) {
      const m = it.mesh;
      const k = stacked++;
      const plan = foldPlan(it.piece);
      const pose = stackPose(plan, spot, k, it.pl.rot);
      const toY = stackBaseY + stackH;
      stackH += plan.layers * SHEET_TH * SQUASH + 0.0003;
      // partes que se doblan (todavía ocultas: al principio se ve la pieza entera)
      const local = table.localOutline(it.pl, it.cutPts);
      const parts = (plan.a || plan.b ? foldParts(local, plan) : []).map((pt) => {
        const pm = table.makeLocalPieceMesh(it.piece, it.pl, pt.pts);
        pm.matrixAutoUpdate = false;
        pm.matrix.identity();
        pm.visible = false;
        pm.castShadow = true;
        m.add(pm);
        return { ...pt, mesh: pm };
      });
      const setFold = (ta, tb) => {
        for (const p of parts) {
          foldMatrix(p.mesh.matrix, p, plan, SHEET_TH, ta, tb);
          p.mesh.matrixWorldNeedsUpdate = true;
        }
      };
      // sombras falsas que acompañan a la pieza mientras vuela (la del sol es muy blanda a esta
      // escala): la de la pieza entera y la de la pieza doblada (se funden mientras se dobla)
      const shMat = new THREE.MeshBasicMaterial({ color: '#1b130c', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const shMat2 = shMat.clone();
      const mkShadow = (pts2, mat) => {
        const g = new THREE.ShapeGeometry(new THREE.Shape(pts2.map((q) => new THREE.Vector2(q.x, q.y))));
        g.rotateX(-Math.PI / 2);
        const sh = new THREE.Mesh(g, mat);
        sh.renderOrder = 1;
        sh.raycast = () => {};
        table.group.add(sh);
        return sh;
      };
      const shA = mkShadow(local, shMat);
      const shB = parts.length ? mkShadow(foldedOutline(local, plan), shMat2) : null;
      let foldK = 0;
      const groundY = () => (spot.inHole && Math.hypot(m.position.x - spot.x, m.position.z - spot.z) < 0.25 ? 0 : topY);
      // inclinación limitada por la altura: que ninguna punta se meta en la mesa
      const halfX = Math.max(it.b.maxX - it.b.minX, it.b.maxZ - it.b.minZ) / 2 + 0.01;
      const tiltCap = () => {
        const hgt = Math.max(0, m.position.y - topY - 0.004);
        const cap = 0.85 * Math.asin(clamp(hgt / halfX));
        m.rotation.x = clamp(m.rotation.x, -cap, cap);
        m.rotation.z = clamp(m.rotation.z, -cap, cap);
      };
      const syncShadow = () => {
        tiltCap();
        const gy = groundY();
        const hgt = Math.max(0, m.position.y - gy);
        const op = 0.3 * clamp(hgt / 0.025) * clamp((hgt - 0.003) / 0.02);
        for (const [sh, mat, kk] of [
          [shA, shMat, 1 - foldK],
          [shB, shMat2, foldK],
        ]) {
          if (!sh) continue;
          sh.position.set(m.position.x + hgt * 0.55, gy + 0.0006, m.position.z - hgt * 0.9);
          sh.rotation.y = m.rotation.y;
          sh.scale.set(1 + hgt * 0.6, 1, 1 + hgt * 0.6);
          mat.opacity = op * (shB ? kk : 1);
        }
      };
      const p0 = m.position.clone();
      const r0 = m.rotation.y;
      const lift = plan.b ? 0.075 : 0.06;
      let resolveFolded;
      const folded = new Promise((r) => (resolveFolded = r));
      const landed = (async () => {
        // 1) se despega de un costado (inclinada) y sube: desde arriba enseguida se ve el hueco
        const dx0 = Math.sign(pose.x - p0.x || 1) * 0.02;
        await tween(0.4, (t) => {
          const e = easeInOutCubic(t);
          m.position.y = p0.y + lift * e;
          m.position.x = p0.x + dx0 * e;
          m.rotation.x = 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - e);
          m.rotation.z = -0.1 * Math.sin(Math.PI * t);
          syncShadow();
        });
        if (!ctx.alive) return;
        m.rotation.x = 0;
        m.rotation.z = 0;
        // 2) se dobla: al medio por la línea de hilo y, si es larga, otra vez a lo ancho
        if (parts.length) {
          it.fullMesh.visible = false;
          for (const p of parts) p.mesh.visible = true;
          setFold(0, 0);
          const nf = (plan.a ? 1 : 0) + (plan.b ? 1 : 0);
          if (plan.a) {
            await tween(0.34, (t) => {
              const e = easeInOutCubic(t);
              setFold(Math.PI * e, 0);
              it.carriedChalk.opacity = 1 - clamp(t * 1.6);
              foldK = e / nf;
              syncShadow();
            });
            if (!ctx.alive) return;
            audio.play('click');
          }
          if (plan.b) {
            await tween(0.3, (t) => {
              const e = easeInOutCubic(t);
              setFold(plan.a ? Math.PI : 0, Math.PI * e);
              if (!plan.a) it.carriedChalk.opacity = 1 - clamp(t * 1.6);
              foldK = (plan.a ? 1 : 0) / nf + e / nf;
              syncShadow();
            });
            if (!ctx.alive) return;
            audio.play('click');
          }
          setFold(plan.a ? Math.PI : 0, plan.b ? Math.PI : 0);
          foldK = 1;
        }
        // la tiza que viajaba con la pieza ya no se ve (quedó adentro del doblez)
        m.children.forEach((ch) => {
          if (ch.material === it.carriedChalk) ch.visible = false;
        });
        resolveFolded();
        // 3) vuela a la pila (se aplasta un poco: las capas de tela quedan finitas)
        const q0 = m.position.clone();
        const dr = Math.atan2(Math.sin(pose.rot - r0), Math.cos(pose.rot - r0));
        await tween(0.7, (t) => {
          const e = easeInOutCubic(t);
          m.position.x = q0.x + (pose.x - q0.x) * e;
          m.position.z = q0.z + (pose.z - q0.z) * e;
          m.position.y = lerp(q0.y, toY, e) + 0.045 * Math.sin(Math.PI * t);
          m.rotation.y = r0 + dr * e;
          m.scale.y = lerp(1, SQUASH, e);
          syncShadow();
        });
        shA.geometry.dispose();
        shMat.dispose();
        table.group.remove(shA);
        if (!ctx.alive) return;
        m.position.set(pose.x, toY, pose.z);
        m.rotation.set(0, pose.rot, 0);
        m.scale.y = SQUASH;
        // sombra propia en la pila (un halo suave en dos pasos, corrido hacia donde cae la luz):
        // así se leen las capas sin que el borde parezca una línea dibujada
        const foldedPts = parts.length ? foldedOutline(local, plan) : local;
        const drop = shB || mkShadow(foldedPts, shMat2);
        const fc = foldedCenter(plan);
        const placeDrop = (sh, k2, dx, dz) => {
          // escala alrededor del centro de la huella doblada (no del origen de la pieza)
          const cs = Math.cos(pose.rot);
          const sn = Math.sin(pose.rot);
          const ox = fc.x * (1 - k2);
          const oz = fc.z * (1 - k2);
          sh.position.set(pose.x + ox * cs + oz * sn + dx, toY - 0.0001, pose.z - ox * sn + oz * cs + dz);
          sh.rotation.y = pose.rot;
          sh.scale.set(k2, 1, k2);
          sh.renderOrder = 2;
        };
        placeDrop(drop, 1.012, 0.0015, -0.0022);
        shMat2.opacity = 0.17;
        const halo = mkShadow(foldedPts, shMat2.clone());
        placeDrop(halo, 1.04, 0.0032, -0.0048);
        halo.material.opacity = 0.08;
        if (!autoMode || k === 0) audio.play('pop');
        if (k === 0) tween(0.4, (t) => (stackShadow.material.opacity = 0.24 * t));
      })();
      landed.finally(() => resolveFolded());
      return { folded, landed };
    }

    // ----- final -----
    async function finishAll() {
      phase = 'done';
      ui.hint(null);
      stopLoop();
      // ya no hay nada para automatizar
      ui.setActions([]);
      setStatus('fin', '✓ ¡Todas las piezas cortadas!', 'good');
      if (isMobile()) {
        // en el celular el panel (con la lista de piezas) vuelve a subir: el HUD ya no hace falta
        panelEl.classList.remove('collapsed');
        appEl.classList.remove('cor-play');
        ui.hud(null);
        hudShown = false;
        ui._layout?.();
      }
      viewKind = 'overview';
      flyView(overviewView(), 1.2);
      if (ctl) returnTool(ctl, 0.8);
      const results = items.map((it) => ({ id: it.id, name: it.name, acc: it.acc ?? 0.7, dev: it.dev || 0, salidas: it.salidas || 0, len: it.len, method: it.method, auto: !!it.auto, curvy: it.curvy }));
      const autoAll = items.every((it) => it.auto);
      const autoSome = items.some((it) => it.auto);
      const res = scoreCut({ tool, results, fabric, cutTime, cutLength: cutLen, autoAll, autoSome, state });
      const pieces = {};
      for (const r of results) pieces[r.id] = Math.round(r.acc * 1000) / 1000;
      state.cut = {
        tool,
        pieces,
        accuracy: Math.round(res.accuracy * 1000) / 1000,
        meanDevMm: Math.round(res.meanDev * 10000) / 10,
        salidas: res.salidas,
        time: Math.round(cutTime * 10) / 10,
        auto: autoAll,
      };
      audio.play(res.score >= 75 ? 'fanfare' : 'select');
      await sleep(1500);
      while (hold && ctx.alive) await new Promise((r) => setTimeout(r, 200));
      if (!ctx.alive) return;
      const extra = h(
        'div',
        { class: 'cor-result' },
        h('div', { class: 'cor-result-cap' }, 'Así quedó la tela (los huecos son las piezas cortadas):'),
        cutMap(
          items.map((it) => ({ id: it.id, pts: it.cutPts || it.loop, acc: it.acc ?? 0.7 })),
          { fabricHex: state.fabric.color, chalkHex: table.chalkHex },
        ),
        h(
          'div',
          { class: 'cor-result-list' },
          ...items.map((it) =>
            h(
              'div',
              { class: 'cor-result-row' },
              h('span', { class: 'cor-result-name' }, it.name, it.method === 'regla' ? ' 📐' : it.method === 'gemela' ? ' ✂✂' : ''),
              h('span', { class: 'cor-result-bar' }, h('i', { style: { width: `${Math.round((it.acc ?? 0) * 100)}%`, background: accColor(it.acc ?? 0) } })),
              h('b', { class: 'cor-result-pct' }, pctTxt(it.acc ?? 0)),
            ),
          ),
        ),
        h(
          'div',
          { class: 'cor-result-stats' },
          h('span', {}, h('b', {}, `${TOOLS[tool].icon} ${TOOLS[tool].short}`)),
          h('span', {}, 'desvío ', h('b', {}, mmTxt(res.meanDev))),
          cutTime > 0 ? h('span', {}, h('b', {}, `${Math.round(cutTime)} s`), ' cortando') : null,
          h('span', {}, h('b', {}, String(res.salidas)), res.salidas === 1 ? ' salida' : ' salidas'),
        ),
      );
      await ctx.complete({ score: res.score, notes: res.notes, extra });
    }

    // ----- automático -----
    async function autoAll() {
      if (autoMode || phase === 'done') return;
      autoMode = true;
      ui.enableAction('auto', false);
      ui.enableAction('start', false);
      ui.hint(null);
      hintKey = '';
      if (phase === 'choose') {
        // la herramienta que el jugador eligió (por defecto, la ideal para la tela); si había otra
        // afuera del carrito (cambió de idea a mitad del vuelo), vuelve a su lugar
        renderToolChoice();
        for (const k of ['tijera', 'cutter']) if (k !== tool && ctls[k] && ctl === ctls[k]) returnTool(ctls[k], 0.55);
        ctl = ctls[tool];
        phase = 'prep';
        ui.setActions([{ id: 'auto', label: '🤖 Cortando solo…', kind: 'auto', disabled: true }]);
        keys.innerHTML = `🤖 Mirá cómo se corta: ${autoListText()}.`;
        toolSection.style.display = 'none';
        toolChosen.innerHTML = '';
        toolChosen.appendChild(h('span', { class: 'cor-tool-icon', html: TOOL_SVG[tool] }));
        toolChosen.appendChild(h('span', { class: 'cor-tool-chosen-text', html: `<b>${TOOLS[tool].name}</b><br><span>Corte automático</span>` }));
        showHud();
        viewKind = 'overview';
        flyView(overviewView(), 0.8);
        await runPieces();
        return;
      }
      viewKind = 'overview';
      flyView(overviewView(), 0.8);
      if (tr && !tr.done) {
        const T = tr;
        if (T.path && T.slit) {
          T.done = true;
          tr = null;
          phase = 'replay';
          const it = T.item;
          await autoTrace(it, T);
          if (!ctx.alive) return;
          T.resolve();
        } else {
          // no había empezado: corte automático completo de esta pieza
          T.done = true;
          tr = null;
          const it = T.item;
          await autoTrace(it);
          if (!ctx.alive) return;
          T.resolve();
        }
      } else if (ru && !ru.fixed) {
        fixRuler((Math.random() < 0.5 ? -1 : 1) * 0.0026);
      }
    }

    // ---------------- entrada ----------------
    ctx.onPointer('down', (e) => {
      if (modalOpen()) return;
      isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (e.button === 2) return;
      if (phase === 'trace' || (phase === 'prep' && tr)) {
        pressing = true;
        pressT = performance.now();
      } else if (phase === 'ruler') fixRuler();
    });
    ctx.onPointer('up', () => {
      pressing = false;
    });
    ctx.listen(window, 'blur', () => {
      pressing = false;
      keyPress = false;
    });
    ctx.listen(window, 'keydown', (e) => {
      if (modalOpen() || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        if (phase === 'trace' || (phase === 'prep' && tr)) {
          // las repeticiones del teclado no cuentan como pulsación nueva
          if (!e.repeat) keyT = performance.now();
          keyPress = true;
          isTouch = false;
          e.preventDefault();
        } else if (phase === 'ruler') {
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          fixRuler();
          e.preventDefault();
        } else if (phase !== 'choose') e.preventDefault();
        return;
      }
      if (phase === 'choose') {
        if (e.key === '1') chooseTool('tijera');
        else if (e.key === '2') chooseTool('cutter');
        else if (e.key === 'Enter') {
          e.preventDefault();
          startGame();
        }
      } else if (phase === 'ruler' && e.key === 'Enter') fixRuler();
    });
    ctx.listen(window, 'keyup', (e) => {
      if (e.code === 'Space') {
        keyPress = false;
        if (phase !== 'choose') e.preventDefault();
      }
    });

    // ---------------- loop ----------------
    ctx.onUpdate((dt, t) => {
      const sdt = dt * timeScale;
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
      table.tick(dt, t);
      if (phase === 'trace' && tr) traceUpdate(dt);
      else if (phase === 'ruler' && ru) rulerUpdate(dt);
      // marcador de arranque / reanudación y guía
      const showMarker = phase === 'trace' && tr && !tr.engaged;
      marker.visible = !!showMarker;
      let lp = null;
      if (tr && (phase === 'trace' || phase === 'prep')) {
        const path0 = tr.path || tr.pf;
        const p = pointAt(path0, tr.s);
        const x = p.x + p.nx * tr.off;
        const z = p.z + p.nz * tr.off;
        if (showMarker) {
          marker.position.set(x, topY + 0.0015, z);
          const k = 1 + 0.22 * Math.sin(t * 6);
          marker.scale.set(k, 1, k);
          haloMat.opacity = 0.35 + 0.25 * Math.sin(t * 6);
          lp = toScreen(x, z);
        }
        // guías: delante del corte (antes de elegir sentido, para los dos lados)
        const paths = tr.path ? [tr.path] : [tr.pf, tr.pr];
        guides.forEach((gd, gi) => {
          const pth = paths[gi];
          gd.m.visible = !!pth && phase === 'trace';
          if (!gd.m.visible) return;
          gd.rb.reset();
          const len = tr.path ? 0.16 : 0.08;
          const s0 = tr.s + 0.012;
          const n = 22;
          for (let k = 0; k <= n; k++) {
            const s = Math.min(pth.total, s0 + (len * k) / n);
            const q2 = pointAt(pth, s);
            gd.rb.push(q2.x, q2.z, q2.nx, q2.nz, -0.0068, 0.0068);
          }
        });
        chevTex.offset.x -= dt * 1.4;
        guideMat.opacity = tr.engaged ? 0.55 : 0.75 + 0.25 * Math.sin(t * 5);
      } else guides.forEach((gd) => (gd.m.visible = false));
      if (lp && !lp.behind) {
        startLabel.style.display = '';
        const txt = tr.s < 0.002 ? 'Empezá acá' : 'Seguí desde acá';
        if (startLabel.textContent !== txt) startLabel.textContent = txt;
        // arriba del punto (abajo queda la indicación); si arriba tapa el HUD, abajo
        const hr = hudRect();
        const up = !(hr && lp.y - 44 < hr.bottom && lp.x > hr.left - 60 && lp.x < hr.right + 60) && lp.y > 110;
        startLabel.classList.toggle('below', !up);
        startLabel.style.transform = `translate(${Math.round(lp.x)}px, ${Math.round(up ? lp.y - 24 : lp.y + 24)}px) translate(-50%, ${up ? '-100%' : '0'})`;
      } else startLabel.style.display = 'none';
      if (phase === 'trace' && tr) {
        if (tr.engaged) setStatus(tr.fast ? 'fast' : tr.ahead > LOOK * 0.85 ? 'ahead' : 'go', tr.fast ? '⚠ ¡Muy rápido en la curva!' : tr.ahead > LOOK * 0.85 ? (tool === 'tijera' ? '⏳ Esperá a la tijera' : '⏳ Esperá al cúter') : '✂ Cortando…', tr.fast ? 'bad' : '');
        else if (tr.s > 0.002 && !statusKey.startsWith('salida')) setStatus('pause', '⏸ En pausa: volvé al ●');
        else if (tr.s <= 0.002) setStatus('ready', '● Empezá en el punto rojo');
      }
      if (hudShown) updateHud();
    });

    // ---------------- pruebas (window.__taller.step._test) ----------------
    const testApi = {
      speed(k = 1) {
        timeScale = Math.max(0.1, +k || 1);
        return timeScale;
      },
      info() {
        const it = items[curIdx];
        return {
          phase,
          tool,
          piece: it?.id || null,
          s: tr ? round3(tr.s) : null,
          total: tr?.path ? round3(tr.path.total) : tr ? round3(tr.pf.total) : null,
          engaged: !!tr?.engaged,
          off: tr ? round3(tr.off * 1000) : null,
          salidas: tr?.salidas ?? null,
          ruler: ru ? { off: round3(ru.off * 1000), fixed: ru.fixed } : null,
          done: items.map((x) => [x.id, x.status, x.acc == null ? null : round3(x.acc)]),
          cut: state.cut,
          stack: { x: round3(spot.x), z: round3(spot.z), inHole: spot.inHole, longAxis: spot.longAxis, n: stacked, h: round3(stackH * 1000) },
          stale: tr ? pressStale() : null,
          ahead: tr ? round3(tr.ahead) : null,
        };
      },
      // pose de cada pieza apilada (coords de tela), para chequeos
      stackPoses() {
        return items.filter((x) => x.mesh).map((x) => ({ id: x.id, x: round3(x.mesh.position.x), y: round3(x.mesh.position.y * 1000), z: round3(x.mesh.position.z), rot: round3(x.mesh.rotation.y) }));
      },
      // puntos de pantalla a lo largo de la línea de la pieza actual, desde el avance actual
      pathScreen(n = 60, len = null, dir = 1, jitterPx = 0, from = 0) {
        if (!tr) return [];
        const path = tr.path || (dir > 0 ? tr.pf : tr.pr);
        const s0 = clamp(tr.s + from, 0, path.total);
        const total = len == null ? path.total - s0 : len < 0 ? Math.max(len, -s0) : Math.min(len, path.total - s0);
        const r = rng(5);
        const out = [];
        for (let k = 0; k <= n; k++) {
          const p = pointAt(path, s0 + (total * k) / n);
          const sp = toScreen(p.x, p.z);
          out.push([Math.round(sp.x + (r() - 0.5) * 2 * jitterPx), Math.round(sp.y + (r() - 0.5) * 2 * jitterPx)]);
        }
        return out;
      },
      cutPoint() {
        if (!tr) return null;
        const p = pointAt(tr.path || tr.pf, tr.s);
        const sp = toScreen(p.x, p.z);
        return [Math.round(sp.x), Math.round(sp.y)];
      },
      skipFlight() {
        const f = engine._flight;
        if (f) engine.flyTo({ position: f.p1, target: f.t1, fov: f.f1, duration: 0 });
        return !!f;
      },
      // termina la pieza a pulso actual con un desvío constante (m)
      finishTrace(offM = 0.001) {
        if (!tr || tr.done) return false;
        if (!tr.path) {
          tr.path = tr.pf;
          tr.off = offM;
          initSlit();
        }
        tr.off = offM;
        advance(tr, tr.path.total - tr.s, 0.5, true);
        completeTrace();
        return true;
      },
      fixRuler: (offM = null) => fixRuler(offM),
      hold(v = true) {
        hold = !!v;
        return hold;
      },
    };
    step._test = testApi;
    ctx.track(() => {
      if (step._test === testApi) delete step._test;
    });

    // ---------------- arranque ----------------
    flyView(overviewView(), 1.2);
    renderToolChoice();
    ui.hint(isMobile() ? 'Elegí la herramienta y tocá <b>¡A cortar!</b>' : 'Elegí la herramienta en el panel (<kbd>1</kbd> / <kbd>2</kbd>) y tocá <b>¡A cortar!</b>');
    ctx.timeout(() => {
      if (phase === 'choose') chooseTool(tool);
    }, 700);
  },
};
