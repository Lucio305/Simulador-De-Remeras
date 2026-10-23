// Paso 9 · Diseño del estampado.
// La remera cuelga en el soporte de exhibición con los spots prendidos. El jugador elige la
// técnica (cada una con su relieve real), la imagen (prediseño, su propia imagen, texto o pintura
// a mano sobre la remera 3D), las opciones de tintas/tono y la ubicación (arrastrando sobre la
// remera, con manijas para agrandar y rotar). La vista previa se procesa en vivo con el motor de
// estampado y se pega sobre la remera con su relieve geométrico.

import { processPrint, loadImageFile, removeBackground, trimTransparent, renderPreset, renderText, PRESETS, FONTS } from '../print/printEngine.js';
import { presetThumb } from '../print/presets.js';
import { clamp, money, mixHex } from '../core/utils.js';
import * as R from './diseno/rules.js';
import { createPainter } from './diseno/paint.js';
import { createOverlay } from './diseno/overlay.js';
import { createPrintProxy } from './diseno/proxy.js';

const PREVIEW_RES = 448;
const PREVIEW_SRC_MAX = 960; // lado máx. de la imagen que se manda a la vista previa
const WORK_MAX = 1400; // lado máx. para quitar fondo de imágenes subidas
const OTHER = { frente: 'espalda', espalda: 'frente' };
const SIDE_NAME = { frente: 'Frente', espalda: 'Espalda' };

function dots(n, max, cls = '') {
  let s = '';
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="dis-dots ${cls}">${s}</span>`;
}

function scaleDown(canvas, maxSide, { copy = false } = {}) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (s >= 1 && !copy) return canvas;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * Math.min(1, s)));
  c.height = Math.max(1, Math.round(canvas.height * Math.min(1, s)));
  // copia de trabajo que se lee varias veces (quitar fondo, contar colores…)
  const g = c.getContext('2d', copy ? { willReadFrequently: true } : undefined);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

// ¿La imagen tiene un fondo liso y opaco en el borde? (foto de producto, JPG con fondo blanco…)
function hasPlainBackground(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  let d;
  try {
    d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  } catch (e) {
    return false;
  }
  const px = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) px.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += step) px.push(y * w, y * w + w - 1);
  let transparent = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of px) {
    const o = i * 4;
    if (d[o + 3] < 250) transparent++;
    r += d[o];
    g += d[o + 1];
    b += d[o + 2];
  }
  if (transparent > px.length * 0.2) return false;
  r /= px.length;
  g /= px.length;
  b /= px.length;
  let close = 0;
  for (const i of px) {
    const o = i * 4;
    if (Math.hypot(d[o] - r, d[o + 1] - g, d[o + 2] - b) < 30) close++;
  }
  return close / px.length > 0.86;
}

function checkerThumb(src, size = 88) {
  const s = Math.min(1, size / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function tintSwatch(hex, kind) {
  if (!hex) return 'conic-gradient(from 30deg, #e04f4f, #f2c641, #3f9a6c, #2f5cb6, #9a57c9, #e04f4f)';
  if (kind === 'holo') return 'linear-gradient(135deg, #f7c6ff, #b9a6ff 30%, #9fe7ff 55%, #fff2a8 80%, #f7c6ff)';
  if (kind === 'metal') return `linear-gradient(135deg, ${mixHex(hex, '#ffffff', 0.65)} 0%, ${hex} 38%, ${mixHex(hex, '#000000', 0.35)} 62%, ${mixHex(hex, '#ffffff', 0.45)} 100%)`;
  if (kind === 'glitter')
    return `radial-gradient(circle at 30% 35%, rgba(255,255,255,0.95) 0 1.2px, transparent 1.8px), radial-gradient(circle at 68% 62%, rgba(255,255,255,0.85) 0 1px, transparent 1.6px), radial-gradient(circle at 55% 25%, rgba(255,255,255,0.7) 0 0.8px, transparent 1.4px), linear-gradient(135deg, ${mixHex(hex, '#ffffff', 0.3)}, ${hex} 50%, ${mixHex(hex, '#000000', 0.3)})`;
  return hex;
}

// Tonos para foil / glitter / vinilo de una capa.
function tintList(catalog, techId) {
  if (techId === 'foil') return catalog.FOIL_TINTS.map((t) => ({ ...t, kind: t.id === 'holo' ? 'holo' : 'metal' }));
  if (techId === 'glitter') return catalog.GLITTER_TINTS.map((t) => ({ ...t, kind: 'glitter' }));
  if (techId === 'vinilo') return [{ id: 'diseno', name: 'Del diseño', hex: null }, ...R.INK_COLORS.map((c) => ({ ...c, kind: 'flat' }))];
  return null;
}

function defaultTintId(catalog, techId, state) {
  const ex = R.ORDER_EXTRAS[state.order?.name];
  if (techId === 'foil') return ex?.tint && catalog.FOIL_TINTS.some((t) => t.id === ex.tint) ? ex.tint : 'oro';
  if (techId === 'glitter') return ['amarillo', 'mostaza'].includes(state.fabric?.colorId) ? 'plateado' : 'dorado';
  if (techId === 'vinilo') return 'diseno';
  return null;
}

function tintHexOf(catalog, techId, tintId) {
  const list = tintList(catalog, techId);
  return list?.find((t) => t.id === tintId)?.hex || null;
}

// ---------------------------------------------------------------------------

export default {
  id: 'diseno',
  title: 'Diseño del estampado',
  short: 'Diseño',
  icon: '🎨',
  scored: true,
  help: `<p>Armá la estampa de tu remera en cuatro decisiones (el botón <b>Confirmar</b> se habilita cuando elegiste la técnica y la imagen):</p>
<ol>
<li><b>Técnica</b>: cada una tiene su relieve y sus reglas (la sublimación solo va en poliéster claro, la serigrafía hasta 4 tintas, el bordado luce chiquito…).</li>
<li><b>Imagen</b>: un prediseño, <b>tu propia imagen</b> (botón, arrastrar y soltar o pegar con <span class="kbd">Ctrl</span>+<span class="kbd">V</span>), un texto o <b>pintura a mano</b> directo sobre la remera (con pintura textil).</li>
<li><b>Opciones</b>: cantidad de tintas o hilos, o el tono del foil y del glitter.</li>
<li><b>Ubicación</b>: frente o espalda, posiciones rápidas o arrastrando la estampa sobre la remera. Las manijas la agrandan y la rotan.</li>
</ol>
<ul>
<li>Arrastrá el fondo para girar la vista y usá la rueda para acercarte: la vista previa muestra el relieve real de cada técnica.</li>
<li>Teclado: <span class="kbd">←</span><span class="kbd">→</span><span class="kbd">↑</span><span class="kbd">↓</span> mueven, <span class="kbd">+</span>/<span class="kbd">−</span> agrandan, <span class="kbd">Q</span>/<span class="kbd">E</span> rotan. Pintando: <span class="kbd">[</span>/<span class="kbd">]</span> grosor, <span class="kbd">B</span> pincel, <span class="kbd">G</span> goma, <span class="kbd">Ctrl</span>+<span class="kbd">Z</span> deshacer.</li>
</ul>`,

  defaults(state, ctx) {
    const catalog = ctx.catalog;
    // la técnica del pedido o serigrafía (lo más noble para cualquier tela)
    const tech = catalog.techniqueById(state.order?.req?.technique) || catalog.techniqueById('serigrafia');
    const source = trimTransparent(renderPreset(PRESETS[0].id, 768));
    const g = R.padFractions(source.width, source.height, 768);
    let placement = { x: 0, y: -0.29, width: 0.26 / g.fx, rotation: 0 };
    let side = 'frente';
    try {
      const pattern = ctx.getPattern?.();
      if (pattern) {
        const q = R.quickPlacement(state.order?.name === 'Don Ernesto' ? 'corazon' : 'pecho', pattern, g.aspect, g.fx, g.fy);
        placement = q.placement;
        side = q.side;
      }
    } catch (e) {
      /* sin moldería: queda el pecho estándar */
    }
    const colors = R.defaultColors(tech);
    const tintId = defaultTintId(catalog, tech.id, state);
    const tint = tintHexOf(catalog, tech.id, tintId);
    const cw = placement.width * g.fx;
    const ch = (placement.width / g.aspect) * g.fy;
    const cost = R.estimateCost(tech, { cw, ch, colors: colors || 1, coverage: 0.4 });
    state.design = {
      technique: tech.id,
      side,
      placement,
      options: { colors, tint, tintId: tint ? tintId : null, sourceType: 'preset', presetId: PRESETS[0].id },
      source,
      sourceName: PRESETS[0].name,
      sourceType: 'preset',
      size: { cw, ch },
      cost,
    };
    ctx.addCost?.('Estampa', cost);
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, THREE, audio, shirt } = ctx;
    const step = ctx.step;
    const { TECHNIQUES } = catalog;
    const pattern = ctx.getPattern();
    const fabric = catalog.fabricById(state.fabric.id) || catalog.FABRICS[0];
    const fabricHex = state.fabric.color;
    const order = state.order;
    const wantTech = order?.req?.technique && catalog.techniqueById(order.req.technique) ? order.req.technique : null;
    const extras = order ? R.ORDER_EXTRAS[order.name] || null : null;
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const app = document.getElementById('app');
    app.classList.add('dis-on');
    ctx.track(() => app.classList.remove('dis-on'));
    const canvasEl = engine.canvas;
    ctx.track(() => (canvasEl.style.cursor = ''));

    // =====================================================================
    // Estado de trabajo
    // =====================================================================
    // El estudio arranca vacío: la técnica y la imagen las elige el jugador (el pedido solo se
    // marca con un badge). Si se vuelve al paso con un diseño ya hecho, se retoma tal cual.
    const prev = state.design && catalog.techniqueById(state.design.technique) ? state.design : null;
    const sel = {
      techId: prev ? prev.technique : null,
      colors: {}, // por técnica
      tints: {}, // por técnica
      sourceType: prev?.sourceType || null, // null = todavía no eligió imagen
      side: prev?.side === 'espalda' ? 'espalda' : 'frente',
      cx: 0,
      cy: -0.28,
      cw: 0.26,
      rot: 0,
      spot: null,
      placed: !!prev, // ya se ubicó la estampa al menos una vez
    };
    for (const t of TECHNIQUES) {
      sel.colors[t.id] = R.defaultColors(t);
      sel.tints[t.id] = defaultTintId(catalog, t.id, state);
    }
    if (prev?.options?.colors && catalog.techniqueById(prev.technique)?.maxColors) sel.colors[prev.technique] = prev.options.colors;
    if (prev?.options?.tintId) sel.tints[prev.technique] = prev.options.tintId;

    const tech = () => (sel.techId ? catalog.techniqueById(sel.techId) : null);
    const area = () => pattern.printArea[sel.side];

    // --- fuentes de imagen ---
    const presetCache = new Map();
    const preset = {
      id: prev?.options?.presetId && PRESETS.some((p) => p.id === prev.options.presetId) ? prev.options.presetId : PRESETS[0].id,
      picked: prev?.sourceType === 'preset',
    };
    const upload = { original: null, work: null, processed: null, name: '', removeBg: false, tol: 0.12, scale: 1, colors: 0, loading: false };
    const defaultText = state.brand && state.brand !== 'Mi Taller' ? state.brand : 'Hecho a mano';
    const text = {
      value: prev?.options?.text?.value ?? defaultText,
      font: prev?.options?.text?.font || 'impacto',
      color: prev?.options?.text?.color || (R.luminanceOf(fabricHex) > 0.5 ? '#1e1e21' : '#f7f5ef'),
      outline: !!prev?.options?.text?.outline,
      outlineColor: prev?.options?.text?.outlineColor || (R.luminanceOf(fabricHex) > 0.5 ? '#f7f5ef' : '#1e1e21'),
      arc: prev?.options?.text?.arc || 0,
      spacing: prev?.options?.text?.spacing || 0,
    };
    const paint = { color: '#c42b2b', sizeMm: 10, erase: false };
    const painter = createPainter({ THREE, shirt, pattern });
    ctx.add(painter.dabs, shirt.group);
    ctx.track(() => painter.dispose());
    if (prev?.sourceType === 'upload' && prev.source) {
      upload.original = upload.work = upload.processed = prev.source;
      upload.name = prev.sourceName || 'tu imagen';
      upload.colors = R.countColors(prev.source);
      upload.scale = prev.options?.uploadScale || 1;
    }
    if (prev?.sourceType === 'paint' && prev.source) {
      const g0 = R.padFractions(prev.source.width, prev.source.height, PREVIEW_RES);
      painter.importCanvas(sel.side, prev.source, prev.placement.x, prev.placement.y, prev.placement.width * g0.fx);
    }

    // cur = fuente actual ya recortada: { canvas, preview, w, h, geo, name, type, paint? }
    let cur = null;
    function presetCanvas(id) {
      if (!presetCache.has(id)) presetCache.set(id, trimTransparent(renderPreset(id, 768)));
      return presetCache.get(id);
    }
    function buildSource() {
      let canvas = null;
      let name = '';
      let extra = null;
      const type = sel.sourceType;
      if (type === 'preset') {
        canvas = presetCanvas(preset.id);
        name = PRESETS.find((p) => p.id === preset.id)?.name || 'Prediseño';
      } else if (type === 'upload') {
        if (upload.processed) {
          canvas = trimTransparent(upload.processed);
          name = upload.name;
        }
      } else if (type === 'text') {
        const t = text.value.trim() ? text.value : '';
        if (t) {
          canvas = trimTransparent(renderText(t, { font: text.font, color: text.color, outline: text.outline, outlineColor: text.outlineColor, arc: text.arc, size: 150, letterSpacing: text.spacing }));
          name = `“${t.replace(/\s+/g, ' ').slice(0, 24)}${t.length > 24 ? '…' : ''}”`;
        }
      } else if (type === 'paint') {
        extra = painter.extract(sel.side);
        if (extra) {
          canvas = extra.canvas;
          name = 'Pintura a mano';
        }
      }
      if (!canvas || canvas.width < 2 || canvas.height < 2) {
        cur = null;
        return;
      }
      const geo = R.padFractions(canvas.width, canvas.height, PREVIEW_RES);
      cur = { canvas, preview: scaleDown(canvas, PREVIEW_SRC_MAX), w: canvas.width, h: canvas.height, geo, name, type, paint: extra };
      if (extra) {
        sel.cx = extra.vx;
        sel.cy = extra.y;
        sel.cw = extra.cw;
        sel.rot = 0;
      } else if (!sel.placed) {
        // primera imagen: arranca en la ubicación clásica de ese lado
        const id = sel.side === 'espalda' ? 'espalda' : 'pecho';
        const q = R.quickPlacement(id, pattern, geo.aspect, geo.fx, geo.fy);
        sel.cx = q.placement.x;
        sel.cy = q.placement.y;
        sel.cw = q.placement.width * geo.fx;
        sel.rot = 0;
        sel.spot = id;
        sel.placed = true;
      } else clampSel();
    }

    const geo = () => cur?.geo || { fx: 1 / 1.04, fy: 1 / 1.04, aspect: 1 };
    const placement = () => ({ x: sel.cx, y: sel.cy, width: sel.cw / geo().fx, rotation: sel.rot });
    const dimsCm = () => {
      const g = geo();
      const W = sel.cw / g.fx;
      return { cw: sel.cw, ch: (W / g.aspect) * g.fy };
    };
    function clampSel() {
      if (!cur || cur.type === 'paint') return;
      const g = cur.geo;
      const pl = R.clampPlacement(placement(), area(), g.aspect, g.fx, g.fy);
      sel.cx = pl.x;
      sel.cy = pl.y;
      sel.cw = pl.width * g.fx;
      sel.rot = pl.rotation;
    }
    function applySpot(id, { animate = true } = {}) {
      if (!cur || cur.type === 'paint') return;
      const g = cur.geo;
      const q = R.quickPlacement(id, pattern, g.aspect, g.fx, g.fy);
      sel.spot = id;
      sel.placed = true;
      const sideChanged = q.side !== sel.side;
      sel.side = q.side;
      sel.cx = q.placement.x;
      sel.cy = q.placement.y;
      sel.cw = q.placement.width * g.fx;
      sel.rot = 0;
      if (sideChanged) onSideChanged();
      if (animate) audio.play('pop');
      placementChanged({ reprocess: true, commit: true });
    }

    // =====================================================================
    // Vista previa (procesamiento con debounce)
    // =====================================================================
    let result = null;
    let processedCw = 0;
    let processAt = 0;
    let placeAt = 0; // > 0: la estampa provisoria está a la vista y falta aplicar la real
    let contrast = null;
    let evalRes = null;
    let busy = false;
    let lastHintKey = ''; // pista de abajo que se está mostrando
    let drag = null; // { kind: 'move'|'scale'|'rot'|'paint', pointerId, ... }
    let hover = null; // { hit, onPrint, frame }
    let frameHover = false; // el marco está a la vista por hover
    let lastOverHandle = false;
    let nudgeUntil = 0;
    const PLACE_IDLE_MS = 140; // quieta este tiempo → se aplica la estampa real

    // Estampa provisoria (liviana) para mover/agrandar/rotar sin reconstruir el parche real.
    const proxy = createPrintProxy({ THREE, shirt });
    ctx.add(proxy.mesh, shirt.group);
    ctx.track(() => proxy.dispose());

    function needProcess(delay = 170) {
      processAt = performance.now() + delay;
      setBusy(true);
    }
    function sourceChanged({ delay = 170 } = {}) {
      buildSource();
      needProcess(delay);
      updateFrame();
      refreshAll();
    }
    function placementChanged({ reprocess = false, commit = false } = {}) {
      clampSel();
      updateFrame();
      livePreview();
      if (commit && placeAt) placeAt = 1; // aplicar la real en el próximo cuadro
      if (reprocess && result && Math.abs(sel.cw - processedCw) / Math.max(0.01, sel.cw) > 0.18) needProcess(320);
      refreshPlace();
      refreshInfo();
    }
    // Mientras se ubica: la provisoria sigue al instante y la real se saca hasta que quede quieta.
    function livePreview() {
      if (!result || !cur || cur.type === 'paint') return;
      proxy.setResult(result);
      proxy.place(sel.side, placement(), result.aspect);
      if (shirt.hasPrint(sel.side)) shirt.setPrint(sel.side, null);
      if (shirt.hasPrint(OTHER[sel.side])) shirt.setPrint(OTHER[sel.side], null);
      placeAt = performance.now();
    }

    function doProcess() {
      processAt = 0;
      if (!cur) {
        result = null;
        contrast = null;
        painter.clearDabs();
        applyPrint();
        setBusy(false);
        refreshAll();
        return;
      }
      const t = tech();
      // sin técnica elegida: un boceto translúcido (a todo color, sin relieve) para ver la ubicación
      const tid = t ? t.id : 'dtf';
      const opts = { fabricId: fabric.id, fabricColor: fabricHex, resolution: PREVIEW_RES, widthM: sel.cw, quality: 1, seed: 11 };
      if (t) {
        if (t.maxColors) opts.colors = sel.colors[t.id];
        const tintHex = tintHexOf(catalog, t.id, sel.tints[t.id]);
        if (tintHex) opts.tint = tintHex;
        if (t.id === 'vinilo' && tintHex) opts.colors = 1;
      }
      try {
        const r = processPrint(cur.preview, tid, opts);
        result = t ? r : { ...r, sketch: true, params: { ...r.params, opacity: 0.5, reliefMm: 0, clearcoat: 0, sheen: 0, iridescence: 0, normalScale: 0.2 } };
        processedCw = sel.cw;
        contrast = t ? R.printContrast(result, fabricHex) : null;
      } catch (e) {
        console.error(e);
        result = null;
        ui.toast('No pude procesar esa imagen. Probá con otra.', 'bad');
      }
      applyPrint();
      painter.clearDabs();
      setBusy(false);
      refreshAll();
    }

    function applyPrint() {
      placeAt = 0;
      proxy.hide();
      shirt.setPrint(sel.side, result || null, placement());
      if (shirt.hasPrint(OTHER[sel.side])) shirt.setPrint(OTHER[sel.side], null);
    }

    // Al salir: la remera vuelve lisa (la estampa de verdad se aplica en el paso Estampar).
    ctx.track(() => {
      shirt.setPrint('frente', null);
      shirt.setPrint('espalda', null);
    });

    // =====================================================================
    // Escena: remera en el soporte, spots, cámara y órbita
    // =====================================================================
    ctx.placeShirt('exhibicion');
    world.setShowcase?.(true);
    ctx.track(() => world.setShowcase?.(false));
    let rotY = sel.side === 'espalda' ? Math.PI : 0;
    shirt.group.rotation.y = rotY;
    shirt.group.updateMatrixWorld(true);

    const neck = shirt.group.position.clone();
    // contorno de la remera (con mangas) para encuadrarla entera en el área libre de la pantalla
    const shirtBox = (() => {
      const b = { minX: -0.36, maxX: 0.36, minY: -0.74, maxY: 0.03 };
      const o = pattern.silhouette?.front?.outline;
      if (o?.length) {
        b.minX = Math.min(...o.map((p) => p.x));
        b.maxX = Math.max(...o.map((p) => p.x));
        b.minY = Math.min(...o.map((p) => p.y));
        b.maxY = Math.max(0.03, ...o.map((p) => p.y));
      }
      return b;
    })();
    const mainView = () => {
      const tx = neck.x;
      const tz = neck.z;
      const W = canvasEl.clientWidth || window.innerWidth;
      const H = canvasEl.clientHeight || window.innerHeight;
      const tan = Math.tan(((engine.camera.fov || 45) * Math.PI) / 360);
      const halfW = Math.max(-shirtBox.minX, shirtBox.maxX) + 0.03;
      const spanH = shirtBox.maxY - shirtBox.minY + 0.08;
      const pEl = ui.panelEl;
      if (isMobile()) {
        // celular: la franja libre está arriba de la hoja del panel; arriba tapan la barra y el HUD
        const bottom = Math.min(pEl?.offsetHeight || H * 0.48, H * 0.48);
        const usableW = W - 40;
        const usableH = H - bottom - 100 - 24;
        const d = clamp(Math.max((halfW * H) / (tan * usableW), (spanH * H) / (2 * tan * usableH)), 2.3, 3.8);
        return { position: [tx, neck.y - 0.17, tz + d], target: [tx, neck.y - 0.25, tz] };
      }
      // escritorio: el panel tapa la derecha; en pantallas angostas hay que alejarse un poco
      const right = (pEl && !pEl.classList.contains('hidden') ? pEl.offsetWidth || 440 : 440) + 24;
      const usableW = Math.max(240, W - right - 56);
      const usableH = Math.max(240, H - 64 - 40);
      const d = clamp(Math.max(1.62, (halfW * H) / (tan * usableW), (spanH * H) / (2 * tan * usableH)), 1.62, 2.9);
      return { position: [tx, neck.y - 0.24, tz + d], target: [tx, neck.y - 0.33, tz] };
    };
    let closeup = false;
    const orbitOpts = (target) => ({
      enabled: true,
      target,
      minDistance: 0.26,
      maxDistance: isMobile() ? 4.2 : 3.2,
      minPolarAngle: 0.95,
      maxPolarAngle: 2.0,
      minAzimuthAngle: -1.15,
      maxAzimuthAngle: 1.15,
      enablePan: false,
      enableZoom: true,
    });
    // Sobre la estampa (o pintando) se apaga solo el giro: la rueda / el pellizco siguen acercando.
    let orbitWanted = true;
    function setOrbitActive(on) {
      engine.controls.enabled = orbitWanted;
      engine.controls.enableRotate = !!on;
    }
    ctx.track(() => {
      engine.controls.enableRotate = true;
    });
    async function flyMain(duration = 1.3) {
      const v = mainView();
      engine.setOrbit({ ...orbitOpts(v.target), enabled: false });
      await ctx.flyTo(v, duration);
      if (!ctx.alive || busy) return;
      engine.setOrbit(orbitOpts(v.target));
      setOrbitActive(!hover?.onPrint);
    }
    // al cambiar el tamaño de la ventana (o girar el celular) se vuelve a encuadrar
    let resizeTimer = 0;
    ctx.listen(window, 'resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (ctx.alive && !closeup && !busy && !drag) flyMain(0.7);
      }, 260);
    });
    ctx.track(() => clearTimeout(resizeTimer));

    // Luz rasante para mirar el relieve de cerca. No se crea una luz nueva (cambiar la cantidad de
    // luces de la escena obliga a recompilar todos los shaders del taller): se toma prestada la luz
    // de relleno del motor (direccional, sin sombras; en exhibición está atenuada) y se devuelve igual.
    const graze = engine.lights?.fill || null;
    const grazeSaved = graze ? { position: graze.position.clone(), color: graze.color.clone(), intensity: graze.intensity } : null;
    const grazeColor = new THREE.Color('#fff1dc');
    const grazeDir = new THREE.Vector3();
    let grazeBase = null; // { position, color, intensity } al empezar a rasantear
    let grazeLevel = 0;
    function restoreGraze() {
      if (!graze || !grazeBase) return;
      graze.position.copy(grazeBase.position);
      graze.color.copy(grazeBase.color);
      graze.intensity = grazeBase.intensity;
      grazeBase = null;
    }
    ctx.track(() => {
      restoreGraze();
      if (graze && grazeSaved) {
        graze.position.copy(grazeSaved.position);
        graze.color.copy(grazeSaved.color);
      }
    });

    function printWorldFrame() {
      // sin estampa todavía (pintura a mano sin pintar): el centro del área estampable
      let cx = sel.cx;
      let cy = sel.cy;
      if (!cur) {
        const a = area();
        cx = (a.minX + a.maxX) / 2;
        cy = a.maxY - Math.min(0.14, (a.maxY - a.minY) / 2);
      }
      const { position, normal } = shirt.garmentToLocal(sel.side, sel.side === 'espalda' ? -cx : cx, cy, 0);
      shirt.group.updateMatrixWorld(true);
      const wp = shirt.group.localToWorld(position.clone());
      const wn = normal.clone().transformDirection(shirt.group.matrixWorld);
      return { wp, wn };
    }
    function closeView() {
      // la remera puede estar girando: calcular con el giro final
      const r0 = shirt.group.rotation.y;
      shirt.group.rotation.y = rotTarget();
      shirt.group.updateMatrixWorld(true);
      const { wp, wn } = printWorldFrame();
      shirt.group.rotation.y = r0;
      shirt.group.updateMatrixWorld(true);
      const dc = cur ? dimsCm() : { cw: 0.24, ch: 0.24 };
      const d = clamp(Math.max(dc.cw, dc.ch) * 2.1, 0.3, 0.75) * (isMobile() ? 1.6 : 1);
      const side = new THREE.Vector3(1, 0, 0);
      const cam = wp.clone().addScaledVector(wn, d).addScaledVector(side, d * 0.42).add(new THREE.Vector3(0, d * 0.2, 0));
      return { position: cam.toArray(), target: wp.toArray() };
    }
    async function toggleCloseup(force) {
      closeup = force === undefined ? !closeup : !!force;
      for (const b of zoomButtons) {
        b.textContent = closeup ? '↩ Ver la remera entera' : '🔍 Mirar el relieve de cerca';
        b.classList.toggle('on', closeup);
      }
      if (closeup) {
        const v = closeView();
        engine.setOrbit({ ...orbitOpts(v.target), enabled: false });
        ui.hint(paintActive() ? 'De cerca se pinta con más detalle · arrastrá el fondo para girar la vista' : 'Luz rasante: así se ve el relieve de esta técnica · girá la vista para que la luz lo marque');
        ctx.timeout(() => closeup && ui.hint(null), 6000);
        await ctx.flyTo(v, 1.0);
        if (!ctx.alive || busy || !closeup) return;
        engine.setOrbit({ ...orbitOpts(v.target), minDistance: 0.12 });
        setOrbitActive(!hover?.onPrint);
      } else {
        await flyMain(1.0);
      }
    }

    // =====================================================================
    // Capa SVG (marco, manijas, área, pincel)
    // =====================================================================
    const overlay = createOverlay({ THREE, engine, shirt, host: app, touch: coarse });
    ctx.track(() => overlay.dispose());
    function updateFrame() {
      if (!cur || cur.type === 'paint') overlay.clearFrame();
      else {
        const d = dimsCm();
        overlay.setFrame(sel.side, sel.cx, sel.cy, d.cw, d.ch, sel.rot);
      }
      overlay.setArea(sel.side, area());
      // sin imagen: un lugar marcado en el pecho (o la espalda alta) que invita a elegirla
      if (!cur && sel.sourceType !== 'paint') {
        const q = R.quickPlacement(sel.side === 'espalda' ? 'espalda' : 'pecho', pattern, 1.2, 1 / 1.04, 1 / 1.04);
        const w = q.placement.width / 1.04;
        overlay.setGhost(sel.side, q.placement.x, q.placement.y, w, w / 1.2);
      } else overlay.setGhost(null);
    }

    // pincel 3D (el del kit de pintura) que sigue al puntero mientras pintás
    const brush = world.props.paintKit?.brush || null;
    let brushSaved = null;
    let brushTipMat = null;
    function grabBrush() {
      if (!brush || brushSaved) return;
      brushSaved = { parent: brush.parent, position: brush.position.clone(), quaternion: brush.quaternion.clone(), scale: brush.scale.clone(), visible: brush.visible };
      const tipMesh = brush.children[1];
      if (tipMesh?.isMesh) {
        brushSaved.tipMesh = tipMesh;
        brushSaved.tipMat = tipMesh.material;
        brushTipMat = tipMesh.material.clone();
        tipMesh.material = brushTipMat;
      }
    }
    function releaseBrush() {
      if (!brush || !brushSaved) return;
      const s = brushSaved;
      if (s.parent && brush.parent !== s.parent) s.parent.add(brush);
      brush.position.copy(s.position);
      brush.quaternion.copy(s.quaternion);
      brush.scale.copy(s.scale);
      brush.visible = s.visible;
      if (s.tipMesh) s.tipMesh.material = s.tipMat;
      brushTipMat?.dispose();
      brushTipMat = null;
      brushSaved = null;
    }
    ctx.track(releaseBrush);

    // =====================================================================
    // Panel
    // =====================================================================
    const sections = {};
    let openId = null;
    function section(id, num, title, ...content) {
      const sum = h('span', { class: 'dis-sec-sum' });
      const stat = h('span', { class: 'dis-sec-stat' });
      const head = h(
        'button',
        { class: 'dis-sec-head', type: 'button', 'aria-expanded': 'false', onClick: () => openSection(openId === id ? null : id, { sound: true }) },
        h('span', { class: 'dis-sec-num' }, String(num)),
        h('span', { class: 'dis-sec-title' }, title),
        sum,
        stat,
        h('span', { class: 'dis-sec-chev', 'aria-hidden': 'true' }),
      );
      const body = h('div', { class: 'dis-sec-body' }, ...content);
      const el = h('section', { class: 'dis-sec', dataset: { id } }, head, body);
      sections[id] = { el, head, sum, stat, body };
      return el;
    }
    const ORDERED = ['tecnica', 'imagen', 'opciones', 'ubicacion'];
    const NEXT_LABEL = { tecnica: 'Seguir: la imagen →', imagen: 'Seguir: opciones →', opciones: 'Seguir: ubicación →' };
    const nextBtn = (id) => h('button', { class: 'dis-next', type: 'button', onClick: () => openSection(ORDERED[ORDERED.indexOf(id) + 1], { sound: true }) }, NEXT_LABEL[id]);
    function openSection(id, { sound = false, scroll = true } = {}) {
      openId = id;
      for (const [k, s] of Object.entries(sections)) {
        const on = k === id;
        s.el.classList.toggle('open', on);
        s.head.setAttribute('aria-expanded', on ? 'true' : 'false');
      }
      if (sound) audio.play('select');
      // que se vea el encabezado de la sección abierta (sin tapar lo de arriba si ya se ve)
      if (id && scroll) requestAnimationFrame(() => sections[id].head.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      refreshModeHints();
    }

    // ---------- 1. Técnica ----------
    const techCards = new Map();
    const techGrid = h('div', { class: 'dis-tech-grid', role: 'listbox', 'aria-label': 'Técnicas de estampado' });
    for (const t of TECHNIQUES) {
      const comp = R.compatibility(t, fabric, fabricHex);
      const badges = [];
      if (wantTech === t.id) badges.push(h('span', { class: 'dis-badge order' }, 'Pedido'));
      if (comp.badge) badges.push(h('span', { class: `dis-badge ${comp.level}` }, comp.badge));
      const card = h(
        'button',
        { class: `dis-tech lv-${comp.level}`, type: 'button', role: 'option', dataset: { id: t.id }, title: `${t.name} · relieve ${R.reliefText(t.relief)}`, onClick: () => setTech(t.id) },
        h('span', { class: 'dis-tech-icon' }, t.icon),
        h('span', { class: 'dis-tech-name' }, R.TECH_SHORT[t.id]),
        h('span', { class: 'dis-tech-relief', html: `${dots(R.reliefLevel(t.relief), 4)}` }),
        badges.length ? h('span', { class: 'dis-badges' }, ...badges) : null,
      );
      techCards.set(t.id, card);
      techGrid.appendChild(card);
    }
    const techDetail = h('div', { class: 'dis-tech-detail' });
    const zoomButtons = [];
    const mkZoom = (cls = '') => {
      const b = h(
        'button',
        {
          class: `btn btn-secondary btn-sm dis-zoom ${cls}`,
          type: 'button',
          onClick: () => {
            if (closeup || paintActive() || (result && !result.sketch)) toggleCloseup();
            else ui.toast(!tech() ? 'Primero elegí la técnica: de eso depende el relieve.' : 'Primero elegí una imagen.', 'warn');
          },
        },
        '🔍 Mirar el relieve de cerca',
      );
      zoomButtons.push(b);
      return b;
    };
    const secTech = section('tecnica', 1, 'Técnica', h('p', { class: 'dis-lead' }, 'El relieve (●) y las reglas cambian con cada técnica. La remera muestra la vista previa real.'), techGrid, techDetail, h('div', { class: 'dis-row' }, mkZoom(), nextBtn('tecnica')));

    // ---------- 2. Imagen ----------
    const tabs = ui.segmented({
      options: [
        { id: 'preset', label: '✦ Prediseños' },
        { id: 'upload', label: '⬆ Tu imagen' },
        { id: 'text', label: 'Aa Texto' },
        { id: 'paint', label: '🖌 Pintar' },
      ],
      value: sel.sourceType || 'preset',
      onChange: (id) => setSourceType(id),
    });
    tabs.classList.add('dis-tabs');
    const panes = {};
    // prediseños
    const presetGrid = h('div', { class: 'dis-presets' });
    const presetBtns = new Map();
    for (const p of PRESETS) {
      const b = h('button', { class: 'dis-preset', type: 'button', title: p.name, style: { backgroundColor: fabricHex }, onClick: () => pickPreset(p.id) }, h('img', { src: presetThumb(p.id, 112), alt: p.name, draggable: 'false' }), h('span', { class: 'dis-preset-name' }, p.name));
      presetBtns.set(p.id, b);
      presetGrid.appendChild(b);
    }
    panes.preset = h('div', { class: 'dis-pane' }, presetGrid, h('p', { class: 'dis-small' }, 'Los prediseños son vectoriales: se ven nítidos a cualquier tamaño. Las miniaturas ya están sobre el color de tu tela.'));
    // subir imagen
    const fileBtn = ui.fileButton({ label: '📁 Elegir imagen…', accept: 'image/*', onFile: (f) => loadFile(f) });
    const fileInput = fileBtn.querySelector('input');
    fileInput.classList.add('dis-file');
    const dropZone = h(
      'div',
      { class: 'dis-drop', role: 'button', tabindex: '0', onClick: (e) => !e.target.closest('.file-button') && fileInput.click() },
      h('span', { class: 'dis-drop-icon', 'aria-hidden': 'true' }, '🖼️'),
      h('span', { class: 'dis-drop-text' }, h('b', {}, 'Arrastrá tu imagen acá'), h('span', {}, coarse ? 'o elegila de la galería' : 'o elegila de tu compu · también podés pegarla con Ctrl+V')),
      fileBtn,
    );
    ctx.listen(dropZone, 'keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === dropZone) {
        e.preventDefault();
        fileInput.click();
      }
    });
    const upInfo = h('div', { class: 'dis-up-info' });
    const bgToggle = ui.toggle({ label: 'Quitar fondo liso', value: false, onChange: (v) => setRemoveBg(v) });
    const tolSlider = ui.slider({ label: 'Sensibilidad del borrado', min: 4, max: 40, step: 1, value: 12, unit: ' %', onChange: (v) => setTolerance(v / 100) });
    const upOpts = h('div', { class: 'dis-up-opts' }, bgToggle, tolSlider);
    const upNote = h('div', { class: 'dis-up-note' });
    panes.upload = h('div', { class: 'dis-pane' }, dropZone, upInfo, upOpts, upNote);
    // texto
    const textArea = h('textarea', { class: 'dis-text-input', rows: '2', maxlength: '60', placeholder: 'Escribí tu frase…', 'aria-label': 'Texto de la estampa' });
    textArea.value = text.value;
    ctx.listen(textArea, 'input', () => {
      text.value = textArea.value;
      if (sel.sourceType === 'text') sourceChanged({ delay: 260 });
    });
    const fontGrid = h('div', { class: 'dis-fonts' });
    const fontBtns = new Map();
    for (const f of FONTS) {
      const b = h(
        'button',
        { class: 'dis-font', type: 'button', title: f.name, onClick: () => setText({ font: f.id }) },
        h('span', { class: 'dis-font-sample', style: { fontFamily: f.css, fontWeight: f.weight || '700', fontStyle: f.style || 'normal' } }, 'Aa'),
        h('span', { class: 'dis-font-name' }, f.name),
      );
      fontBtns.set(f.id, b);
      fontGrid.appendChild(b);
    }
    const textColor = ui.colorPalette({ colors: R.INK_COLORS, value: text.color, onChange: (hex) => setText({ color: hex }) });
    textColor.classList.add('dis-palette');
    const outlineToggle = ui.toggle({ label: 'Contorno', value: text.outline, onChange: (v) => setText({ outline: v }) });
    const outlineColor = ui.colorPalette({ colors: R.INK_COLORS.slice(0, 8), value: text.outlineColor, allowCustom: false, onChange: (hex) => setText({ outlineColor: hex }) });
    outlineColor.classList.add('dis-palette', 'dis-palette-sm');
    const arcSlider = ui.slider({ label: 'Curva', min: -180, max: 180, step: 5, value: text.arc, format: (v) => (v ? `${v > 0 ? '⌒' : '◡'} ${Math.abs(v)}°` : 'recto'), onChange: (v) => setText({ arc: v }) });
    const spaceSlider = ui.slider({ label: 'Espaciado', min: 0, max: 40, step: 2, value: text.spacing, format: (v) => (v ? `${v} px` : 'normal'), onChange: (v) => setText({ spacing: v }) });
    panes.text = h(
      'div',
      { class: 'dis-pane' },
      textArea,
      h('div', { class: 'dis-label' }, 'Tipografía'),
      fontGrid,
      h('div', { class: 'dis-label' }, 'Color'),
      textColor,
      outlineToggle,
      outlineColor,
      arcSlider,
      spaceSlider,
    );
    // pintar a mano
    const paintNeed = h(
      'div',
      { class: 'dis-paint-need' },
      ui.note('Pintar a mano es para la <b>pintura textil</b>: se pinta con pincel directo sobre la remera y después se fija con calor.', 'info'),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => setTech('pintura') }, '🎨 Usar pintura textil'),
    );
    const toolSeg = ui.segmented({
      options: [
        { id: 'brush', label: '🖌 Pincel' },
        { id: 'erase', label: '🧽 Goma' },
      ],
      value: 'brush',
      onChange: (id) => setPaintTool(id === 'erase'),
    });
    const paintPalette = ui.colorPalette({ colors: R.PAINT_COLORS, value: paint.color, onChange: (hex) => setPaintColor(hex) });
    paintPalette.classList.add('dis-palette');
    const sizeSlider = ui.slider({ label: 'Grosor del pincel', min: 2, max: 40, step: 1, value: paint.sizeMm, unit: ' mm', onInput: (v) => (paint.sizeMm = v) });
    const undoBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => undoPaint() }, '↶ Deshacer');
    const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => clearPaint() }, '🗑 Borrar todo');
    const paintTools = h(
      'div',
      { class: 'dis-paint-tools' },
      h('p', { class: 'dis-lead' }, h('b', {}, 'Pintá arrastrando sobre la remera.'), ' Lo que pintes adentro del área punteada se fija con calor en el paso siguiente.'),
      toolSeg,
      h('div', { class: 'dis-label' }, 'Pintura textil'),
      paintPalette,
      sizeSlider,
      h('div', { class: 'dis-row' }, undoBtn, clearBtn),
    );
    const paintOther = h('p', { class: 'dis-small dis-paint-other' });
    panes.paint = h('div', { class: 'dis-pane' }, paintNeed, paintTools, paintOther);
    const paneWrap = h('div', { class: 'dis-panes' }, panes.preset, panes.upload, panes.text, panes.paint);
    const secImg = section('imagen', 2, 'Imagen', tabs, paneWrap, h('div', { class: 'dis-row end' }, nextBtn('imagen')));

    // ---------- 3. Opciones ----------
    const optsBody = h('div', { class: 'dis-opts' });
    const inkRow = h('div', { class: 'dis-inks' });
    const secOpts = section('opciones', 3, 'Opciones', optsBody, inkRow, h('div', { class: 'dis-row end' }, nextBtn('opciones')));

    // ---------- 4. Ubicación ----------
    const sideSeg = ui.segmented({
      options: [
        { id: 'frente', label: '👕 Frente' },
        { id: 'espalda', label: '🔙 Espalda' },
      ],
      value: sel.side,
      onChange: (id) => setSide(id),
    });
    const spotGrid = h('div', { class: 'dis-spots' });
    const spotBtns = new Map();
    const spotIcon = (id) => {
      // remerita con un rectángulo de la ubicación
      const rects = { pecho: [17, 15, 14, 12], corazon: [27, 14, 6, 6], espalda: [17, 11, 14, 10], gigante: [14, 13, 20, 22] };
      const [x, y, w, hh] = rects[id];
      const back = id === 'espalda';
      return `<svg viewBox="0 0 48 44" aria-hidden="true"><path d="M16 3 L8 7 L2 15 L8 19 L11 16 L11 41 L37 41 L37 16 L40 19 L46 15 L40 7 L32 3 Q24 ${back ? 5 : 10} 16 3 Z" class="tee"/><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="1.5" class="mark"/></svg>`;
    };
    for (const s of R.QUICK_SPOTS) {
      const b = h('button', { class: 'dis-spot', type: 'button', title: `${s.label} (${s.sub})`, onClick: () => applySpot(s.id) }, h('span', { class: 'dis-spot-ic', html: spotIcon(s.id) }), h('span', { class: 'dis-spot-label' }, s.label), h('span', { class: 'dis-spot-sub' }, s.sub));
      spotBtns.set(s.id, b);
      spotGrid.appendChild(b);
    }
    const widthSlider = ui.slider({
      label: 'Ancho',
      min: 4,
      max: 40,
      step: 0.5,
      value: 26,
      format: (v) => `${R.fmtNum(v, 1)} cm`,
      onInput: (v) => {
        sel.cw = v / 100;
        sel.spot = null;
        sel.placed = true;
        placementChanged();
      },
      onChange: () => placementChanged({ reprocess: true, commit: true }),
    });
    const rotSlider = ui.slider({
      label: 'Rotación',
      min: -45,
      max: 45,
      step: 1,
      value: 0,
      format: (v) => `${v > 0 ? '+' : ''}${v}°`,
      onInput: (v) => {
        sel.rot = v;
        sel.spot = null;
        sel.placed = true;
        placementChanged();
      },
      onChange: () => placementChanged({ commit: true }),
    });
    const centerBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => {
      sel.cx = 0;
      sel.spot = null;
      audio.play('pop');
      placementChanged({ commit: true });
    } }, '↔ Centrar');
    const straightBtn = h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => {
      sel.rot = 0;
      audio.play('pop');
      placementChanged({ commit: true });
    } }, '⟲ Enderezar');
    const placeReadout = h('div', { class: 'dis-readout' });
    const placeControls = h('div', { class: 'dis-place-ctl' }, h('div', { class: 'dis-label' }, 'Posiciones rápidas'), spotGrid, widthSlider, rotSlider, h('div', { class: 'dis-row' }, centerBtn, straightBtn));
    const placePaintNote = ui.note('Al pintar a mano, la estampa queda <b>donde la pintaste</b>: elegí el lado y pintá.', 'info');
    const placeTip = h('p', { class: 'dis-small' }, coarse ? 'Tocá y arrastrá la estampa sobre la remera para moverla; las manijas la agrandan y la rotan.' : 'Arrastrá la estampa sobre la remera para moverla. Las manijas del marco la agrandan y la rotan (doble clic en la remera la trae hasta ahí).');
    const secPlace = section('ubicacion', 4, 'Ubicación', sideSeg, placeReadout, placePaintNote, placeControls, placeTip);

    // ---------- Chequeo + costo ----------
    const checkList = h('ul', { class: 'dis-check-list' });
    const costLine = h('div', { class: 'dis-cost' });
    const checkBox = h('div', { class: 'dis-check' }, h('div', { class: 'dis-check-head' }, h('span', {}, '🔎 Chequeo del diseño'), h('span', { class: 'dis-check-busy' }, 'procesando…')), checkList, costLine);

    // ---------- pedido ----------
    let orderEl = null;
    if (order) {
      const items = [];
      if (wantTech) items.push(`Estampa en ${catalog.techniqueById(wantTech).name.toLowerCase()}`);
      if (extras) items.push(extras.text[0].toUpperCase() + extras.text.slice(1));
      orderEl = h(
        'div',
        { class: 'dis-order' },
        h('span', { class: 'dis-order-avatar' }, order.avatar),
        h('div', {}, h('b', {}, order.name), items.length ? h('span', {}, ` pidió: ${items.join(' · ')}.`) : h('span', {}, ' dejó la estampa a gusto del taller.')),
      );
    }

    const body = h('div', { class: 'dis-panel' }, orderEl, h('div', { class: 'dis-acc' }, secTech, secImg, secOpts, secPlace), checkBox);
    ui.panel({
      kicker: 'Paso 9 · Estudio de diseño',
      title: 'Diseñá tu estampa',
      subtitle: 'Elegí la técnica, subí tu imagen (o usá un prediseño, un texto o tu pincel) y ubicala sobre la remera. La vista previa muestra el relieve real.',
      body,
      wide: true,
      actions: [
        { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => confirm(true) },
        { id: 'ok', label: 'Confirmar diseño →', kind: 'primary', onClick: () => confirm(false) },
      ],
    });
    ui.panelEl?.classList.add('dis-step');
    ctx.track(() => ui.panelEl?.classList.remove('dis-step'));

    // ---------- HUD ----------
    const hudTech = h('div', { class: 'dis-hud-tech' });
    const hudSize = h('div', { class: 'dis-hud-line' });
    const hudRelief = h('div', { class: 'dis-hud-line' });
    const hudInks = h('div', { class: 'dis-hud-inks' });
    const hudCost = h('div', { class: 'dis-hud-cost' });
    const hudBusy = h('span', { class: 'dis-hud-busy', 'aria-hidden': 'true' });
    const hudPaint = h('div', { class: 'dis-hud-paint' });
    const hudEl = h('div', { class: 'dis-hud' }, h('div', { class: 'hud-title dis-hud-title' }, h('span', {}, 'Vista previa'), hudBusy), hudTech, hudSize, hudRelief, hudInks, hudPaint, hudCost, mkZoom('dis-hud-zoom'));
    ui.hud(hudEl);

    // =====================================================================
    // Acciones del jugador
    // =====================================================================
    function setTech(id) {
      if (busy || !catalog.techniqueById(id)) return;
      const first = !sel.techId;
      const changed = id !== sel.techId;
      sel.techId = id;
      if (changed) {
        audio.play('select');
        const t = tech();
        const comp = R.compatibility(t, fabric, fabricHex);
        if (comp.level === 'bad') ui.toast(`⚠️ ${R.TECH_SHORT[t.id]} en ${fabric.short.toLowerCase()}: no es buena idea (mirá el chequeo).`, 'warn', 3200);
        else if (wantTech && id !== wantTech) ui.toast(`📋 Ojo: ${order.name} pidió ${R.TECH_SHORT[wantTech].toLowerCase()}.`, 'warn', 3000);
      }
      if (id === 'pintura' && paneShown === 'paint' && sel.sourceType !== 'paint') {
        // venía de "Usar pintura textil" en la pestaña Pintar: a pintar
        sel.sourceType = 'paint';
        tabs.setValue('paint');
      } else if (id !== 'pintura' && sel.sourceType === 'paint' && painter.isEmpty(sel.side)) {
        // sin dibujo: queda sin imagen (con los prediseños a la vista)
        sel.sourceType = null;
        tabs.setValue('preset');
        showPane('preset');
      }
      rebuildOptions();
      sourceChanged();
      refreshModeHints();
      if (first && !sel.sourceType) nudge('tecnica', '¡Bien! Ahora elegí la imagen: un prediseño, tu propia imagen, un texto o pintura a mano.');
    }
    // resalta el botón "Seguir" de una sección (guía suave, sin abrir nada por la fuerza)
    function nudge(id, hint) {
      const b = sections[id]?.body.querySelector('.dis-next');
      if (b) {
        b.classList.remove('pulse');
        void b.offsetWidth;
        b.classList.add('pulse');
        ctx.timeout(() => b.classList.remove('pulse'), 4200);
        // que el botón quede a la vista sin perder de vista lo que se estaba leyendo
        requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      }
      if (hint) {
        lastHintKey = 'nudge';
        nudgeUntil = performance.now() + 5200;
        ui.hint(hint);
        ctx.timeout(() => {
          if (lastHintKey !== 'nudge') return;
          ui.hint(null);
          lastHintKey = '';
        }, 5200);
      }
    }
    function setSourceType(id) {
      if (busy) return;
      if (id === 'preset' && !preset.picked) {
        // la pestaña sola no elige nada: hay que tocar un prediseño
        showPane('preset');
        tabs.setValue('preset');
        refreshAll();
        return;
      }
      if (id === 'upload' && !upload.processed) {
        // todavía no hay imagen: mostramos la pestaña pero la estampa sigue siendo la anterior
        showPane('upload');
        tabs.setValue('upload');
        refreshAll();
        return;
      }
      if (id === 'paint' && sel.techId !== 'pintura') {
        showPane('paint');
        tabs.setValue('paint');
        refreshAll();
        return;
      }
      sel.sourceType = id;
      tabs.setValue(id);
      showPane(id);
      sourceChanged();
      refreshModeHints();
    }
    function showPane(id) {
      for (const [k, p] of Object.entries(panes)) p.classList.toggle('show', k === id);
      paneShown = id;
    }
    let paneShown = sel.sourceType || 'preset';
    function pickPreset(id) {
      if (busy) return;
      preset.id = id;
      preset.picked = true;
      sel.sourceType = 'preset';
      tabs.setValue('preset');
      showPane('preset');
      audio.play('select');
      sourceChanged({ delay: 60 });
    }
    function setText(patch) {
      Object.assign(text, patch);
      if (patch.font) audio.play('select');
      if (sel.sourceType !== 'text') {
        sel.sourceType = 'text';
        tabs.setValue('text');
      }
      sourceChanged({ delay: 120 });
    }

    async function loadFile(file) {
      if (busy || !file) return;
      const okType = (file.type && file.type.startsWith('image/')) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.name || '');
      if (!okType) {
        ui.toast('Ese archivo no es una imagen (probá con PNG, JPG o SVG).', 'bad', 3200);
        return;
      }
      upload.loading = true;
      dropZone.classList.add('loading');
      upInfo.innerHTML = '<div class="dis-up-loading">Cargando imagen…</div>';
      // la estampa actual sigue a la vista hasta que la imagen nueva esté lista
      tabs.setValue('upload');
      showPane('upload');
      openSection('imagen');
      await new Promise((r) => setTimeout(r, 20));
      let c;
      try {
        c = await loadImageFile(file, 2048);
      } catch (e) {
        console.warn(e);
        upload.loading = false;
        dropZone.classList.remove('loading');
        upInfo.innerHTML = '';
        ui.toast('No pude leer esa imagen. ¿Está dañada? Probá con otra.', 'bad', 3600);
        refreshAll();
        return;
      }
      if (!ctx.alive) return;
      fileInput.value = '';
      if (busy) return; // ya se confirmó el diseño mientras cargaba
      sel.sourceType = 'upload';
      upload.original = c;
      upload.work = scaleDown(c, WORK_MAX, { copy: true });
      upload.scale = c.width / upload.work.width;
      upload.name = file.name || 'imagen pegada';
      upload.removeBg = hasPlainBackground(upload.work);
      upload.tol = 0.12;
      bgToggle.input.checked = upload.removeBg;
      tolSlider.setValue(12);
      processUpload();
      upload.colors = R.countColors(upload.processed);
      upload.loading = false;
      dropZone.classList.remove('loading');
      audio.play('pop');
      ui.toast(upload.removeBg ? '🖼️ ¡Imagen cargada! Le quitamos el fondo liso (lo podés volver a poner).' : '🖼️ ¡Imagen cargada! Ubicala sobre la remera.', 'good', 3200);
      sourceChanged({ delay: 60 });
    }
    function processUpload() {
      if (!upload.work) return;
      upload.processed = upload.removeBg ? removeBackground(upload.work, { tolerance: upload.tol }) : upload.work;
    }
    function setRemoveBg(v) {
      upload.removeBg = !!v;
      if (!upload.work) return;
      processUpload();
      audio.play('select');
      if (sel.sourceType === 'upload') sourceChanged({ delay: 60 });
    }
    function setTolerance(t) {
      upload.tol = t;
      if (!upload.work || !upload.removeBg) return;
      processUpload();
      if (sel.sourceType === 'upload') sourceChanged({ delay: 60 });
    }

    function setSide(id) {
      if (busy || id === sel.side) return;
      sel.side = id;
      sel.spot = null;
      audio.play('select');
      onSideChanged();
      if (sel.sourceType === 'paint') sourceChanged({ delay: 60 });
      else {
        clampSel();
        // la espalda arranca alta, el frente a la altura del pecho
        if (cur && !sel.spot) {
          const g = cur.geo;
          const keepCw = sel.cw;
          const q = R.quickPlacement(id === 'espalda' ? 'espalda' : 'pecho', pattern, g.aspect, g.fx, g.fy);
          sel.cy = q.placement.y;
          sel.cw = Math.min(keepCw, R.maxWidthFor(area(), g.aspect, g.fx, g.fy, sel.rot) * g.fx);
        }
        placementChanged();
      }
      refreshAll();
    }
    function onSideChanged() {
      sideSeg.setValue(sel.side);
      if (closeup) toggleCloseup(false);
    }
    const rotTarget = () => (sel.side === 'espalda' ? Math.PI : 0);

    // --- pintura ---
    const paintActive = () => sel.sourceType === 'paint' && sel.techId === 'pintura' && !busy;
    function setPaintTool(erase) {
      paint.erase = !!erase;
      toolSeg.setValue(erase ? 'erase' : 'brush');
      refreshPaintHud();
    }
    function setPaintColor(hex) {
      paint.color = hex;
      if (paint.erase) setPaintTool(false);
      if (brushTipMat) brushTipMat.color.set(hex);
      refreshPaintHud();
    }
    function undoPaint() {
      if (painter.undo(sel.side)) {
        audio.play('click');
        sourceChanged({ delay: 40 });
      }
    }
    function clearPaint() {
      if (painter.clear(sel.side)) {
        audio.play('thud');
        sourceChanged({ delay: 40 });
      }
    }

    // =====================================================================
    // Refrescos de UI
    // =====================================================================
    function rebuildOptions() {
      const t = tech();
      optsBody.innerHTML = '';
      if (!t) {
        optsBody.appendChild(ui.note('Primero elegí la <b>técnica</b> (paso 1): de ella dependen las opciones (cantidad de tintas o hilos, o el tono del foil y del glitter).', 'info'));
        return;
      }
      if (t.maxColors > 1) {
        const word = R.inkWord(t.id);
        const opts = [];
        for (let i = 1; i <= t.maxColors; i++) opts.push({ id: String(i), label: String(i) });
        const seg = ui.segmented({
          options: opts,
          value: String(t.id === 'vinilo' && sel.tints.vinilo !== 'diseno' ? 1 : sel.colors[t.id]),
          onChange: (v) => {
            sel.colors[t.id] = parseInt(v, 10);
            if (t.id === 'vinilo' && sel.colors.vinilo > 1) sel.tints.vinilo = 'diseno';
            rebuildOptions();
            needProcess(80);
            refreshAll();
          },
        });
        const label = t.id === 'bordado' ? 'Cantidad de hilos' : t.id === 'vinilo' ? 'Capas de vinilo' : 'Cantidad de tintas';
        optsBody.append(h('div', { class: 'dis-label' }, label, h('span', { class: 'dis-label-sub' }, ` (máx. ${t.maxColors})`)), seg);
        const why = {
          serigrafia: 'Cada tinta es un shablón y una pasada más: más colores, más trabajo y más costo.',
          puff: 'El puff se trabaja con pocas tintas: cada una se infla por separado al curarla.',
          bordado: 'Cada hilo es un cambio de color en la bordadora. Con 3 o 4 hilos ya se ve riquísimo.',
          vinilo: 'Cada capa es un vinilo cortado y pegado encima del otro: más capas, más relieve (y más riesgo de que se despegue).',
        }[t.id];
        if (why) optsBody.appendChild(h('p', { class: 'dis-small' }, why));
      }
      const list = tintList(catalog, t.id);
      if (list && (t.id !== 'vinilo' || sel.colors.vinilo === 1 || sel.tints.vinilo !== 'diseno')) {
        const wrap = h('div', { class: 'dis-tints' });
        for (const c of list) {
          const isOrder = extras?.tint === c.id && (t.id === 'foil' || t.id === 'glitter');
          const b = h(
            'button',
            { class: `dis-tint${sel.tints[t.id] === c.id ? ' selected' : ''}`, type: 'button', title: c.name, dataset: { id: c.id }, onClick: () => {
              sel.tints[t.id] = c.id;
              if (t.id === 'vinilo') sel.colors.vinilo = c.id === 'diseno' ? Math.max(1, sel.colors.vinilo) : 1;
              audio.play('select');
              rebuildOptions();
              needProcess(80);
              refreshAll();
            } },
            h('span', { class: 'dis-tint-sw', style: { background: tintSwatch(c.hex, c.kind) } }),
            h('span', { class: 'dis-tint-name' }, c.name),
            isOrder ? h('span', { class: 'dis-badge order' }, 'Pedido') : null,
          );
          wrap.appendChild(b);
        }
        const label = t.id === 'foil' ? 'Tono del foil' : t.id === 'glitter' ? 'Color del glitter' : 'Color del vinilo';
        optsBody.append(h('div', { class: 'dis-label' }, label), wrap);
        if (t.id === 'foil') optsBody.appendChild(h('p', { class: 'dis-small' }, 'El foil es de un solo tono: del diseño se toma la silueta (o la capa más oscura).'));
        if (t.id === 'glitter') optsBody.appendChild(h('p', { class: 'dis-small' }, 'El vinilo glitter viene en un solo color por lámina: del diseño se usa la silueta.'));
      }
      if (!t.maxColors) {
        const msg = {
          dtf: 'El DTF imprime <b>a todo color</b>, con degradés y fotos, sobre una base blanca: no hay que separar tintas.',
          sublimacion: 'La sublimación imprime <b>a todo color</b>, pero no tiene blanco: lo blanco del diseño queda del color de la tela.',
          pintura: 'Con pintura textil usás <b>los colores que quieras</b>. Si pintás a mano, elegilos en la paleta del pincel.',
        }[t.id];
        optsBody.appendChild(ui.note(msg || 'A todo color.', 'info'));
      }
    }

    function refreshTech() {
      const t = tech();
      for (const [id, c] of techCards) {
        const on = id === sel.techId;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      techGrid.classList.toggle('none', !t);
      techDetail.innerHTML = '';
      if (!t) {
        techDetail.classList.add('empty');
        techDetail.append(
          h('div', { class: 'dis-td-empty' }, h('span', { class: 'dis-td-icon', 'aria-hidden': 'true' }, '👆'), h('div', {}, h('b', {}, 'Tocá una técnica'), h('span', {}, ' para ver su relieve, sus reglas y su costo. Fijate en las etiquetas: no todas van en cualquier tela.'))),
        );
        if (wantTech) techDetail.appendChild(ui.note(`📋 ${order.name} pidió <b>${catalog.techniqueById(wantTech).name}</b> (está marcada con “Pedido”).`, 'info'));
        return;
      }
      techDetail.classList.remove('empty');
      const comp = R.compatibility(t, fabric, fabricHex);
      techDetail.append(
        h('div', { class: 'dis-td-head' }, h('span', { class: 'dis-td-icon' }, t.icon), h('div', {}, h('div', { class: 'dis-td-name' }, t.name), h('div', { class: 'dis-td-desc' }, t.desc))),
        ui.propTable([
          ['Relieve', h('span', { html: `${dots(R.reliefLevel(t.relief), 4)} ${R.reliefText(t.relief)}` })],
          ['Colores', t.maxColors ? `hasta ${t.maxColors} ${R.inkWord(t.id, t.maxColors)}` : 'a todo color'],
          ['Durabilidad', h('span', { html: dots(Math.round(t.durability * 5), 5, 'dur') })],
          ['Proceso', R.processLabel(t)],
          ['Costo base', money(t.cost)],
        ]),
        h('p', { class: 'dis-td-tip', html: R.TECH_TIPS[t.id] || '' }),
      );
      if (comp.html) techDetail.appendChild(ui.note(comp.html, comp.level === 'bad' ? 'bad' : comp.level === 'warn' ? 'warn' : comp.level === 'ok' ? 'good' : 'info'));
      if (wantTech && wantTech !== t.id) techDetail.appendChild(ui.note(`📋 ${order.name} pidió <b>${catalog.techniqueById(wantTech).name}</b>.`, 'warn'));
    }

    function refreshImage() {
      showPane(paneShown || sel.sourceType);
      for (const [id, b] of presetBtns) b.classList.toggle('selected', sel.sourceType === 'preset' && id === preset.id);
      for (const [id, b] of fontBtns) b.classList.toggle('selected', id === text.font);
      textColor.setValue(text.color);
      outlineColor.setValue(text.outlineColor);
      outlineToggle.input.checked = !!text.outline;
      arcSlider.setValue(text.arc);
      spaceSlider.setValue(text.spacing);
      if (document.activeElement !== textArea && textArea.value !== text.value) textArea.value = text.value;
      outlineColor.style.display = text.outline ? '' : 'none';
      // subida
      upOpts.style.display = upload.work ? '' : 'none';
      tolSlider.style.display = upload.work && upload.removeBg ? '' : 'none';
      dropZone.classList.toggle('compact', !!upload.original);
      if (!upload.loading) {
        upInfo.innerHTML = '';
        upNote.innerHTML = '';
        if (upload.processed) {
          const th = checkerThumb(upload.processed, 76);
          th.className = 'dis-up-thumb';
          const pxW = upload.original?.width || upload.processed.width;
          const pxH = upload.original?.height || upload.processed.height;
          const active = sel.sourceType === 'upload';
          upInfo.append(
            h('div', { class: `dis-up-card${active ? ' active' : ''}` }, th, h('div', { class: 'dis-up-meta' }, h('b', {}, upload.name), h('span', {}, `${pxW} × ${pxH} px`), active ? null : h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onClick: () => setSourceType('upload') }, 'Usar esta imagen'))),
          );
          if (active && cur) {
            const dpi = R.dpiFor(cur.w * upload.scale, dimsCm().cw);
            const lv = R.dpiLevel(dpi);
            const d = Math.round(dpi);
            const msg =
              lv === 'bad'
                ? `⚠️ A este tamaño queda en <b>${d} dpi</b>: <b>se va a pixelar</b>. Achicá la estampa o usá una imagen más grande (para estampar se piden 150 dpi o más).`
                : lv === 'low'
                  ? `A este tamaño queda en <b>${d} dpi</b>: <b>se van a notar los píxeles</b>. Para estampar se piden 150 dpi o más: achicala o usá una imagen más grande.`
                  : lv === 'fair'
                    ? `A este tamaño queda en <b>${d} dpi</b>: alcanza justo, aunque de cerca se ve un poco blanda (lo ideal: 150 dpi o más).`
                    : `Resolución: <b>${d} dpi</b> a este tamaño: nítida${d >= 250 ? ', ¡sobra!' : '.'}`;
            upNote.appendChild(ui.note(msg, lv === 'bad' ? 'bad' : lv === 'ok' ? 'good' : 'warn'));
            const t = tech();
            const n = t?.maxColors ? (t.id === 'vinilo' && sel.tints.vinilo !== 'diseno' ? 1 : sel.colors[t.id]) : 0;
            if (t && t.maxColors && t.maxColors <= 6 && upload.colors > Math.max(8, t.maxColors * 2))
              upNote.appendChild(ui.note(`Tu imagen ${upload.colors >= R.PHOTO_COLORS ? 'es una foto (o tiene degradés)' : `tiene ${R.colorsText(upload.colors)}`}: en ${R.TECH_SHORT[t.id].toLowerCase()} se separa en ${n} ${R.inkWord(t.id, n)} y pierde detalle. Para fotos van mejor el <b>DTF</b> o la <b>sublimación</b>.`, 'warn'));
            else if (!t && upload.colors >= R.PHOTO_COLORS) upNote.appendChild(ui.note('Es una foto (o tiene degradés): para fotos van mejor las técnicas <b>a todo color</b> (DTF o sublimación).', 'info'));
          }
        } else {
          upNote.appendChild(h('p', { class: 'dis-small' }, 'Funciona con PNG (ideal con fondo transparente), JPG, WEBP o SVG. Si tiene fondo liso, se lo podemos quitar.'));
        }
      }
      // pintura
      const paintOk = sel.techId === 'pintura';
      paintNeed.style.display = paintOk ? 'none' : '';
      paintTools.style.display = paintOk ? '' : 'none';
      undoBtn.disabled = !painter.canUndo(sel.side);
      clearBtn.disabled = painter.isEmpty(sel.side);
      paintOther.textContent = !paintOk && sel.sourceType === 'paint' && cur && sel.techId ? `Tu dibujo se va a estampar con ${R.TECH_SHORT[sel.techId].toLowerCase()}. Para seguir pintándolo, volvé a la pintura textil.` : '';
    }

    function refreshPlace() {
      sideSeg.setValue(sel.side);
      const paintSrc = sel.sourceType === 'paint';
      placePaintNote.style.display = paintSrc ? '' : 'none';
      placeControls.classList.toggle('disabled', paintSrc || !cur);
      for (const [id, b] of spotBtns) b.classList.toggle('selected', id === sel.spot);
      if (cur) {
        const g = cur.geo;
        const maxCm = Math.floor(R.maxWidthFor(area(), g.aspect, g.fx, g.fy, sel.rot) * g.fx * 200) / 2;
        widthSlider.input.max = String(Math.max(5, maxCm));
        widthSlider.setValue(Math.round(sel.cw * 200) / 2);
        rotSlider.setValue(Math.round(sel.rot));
        const d = dimsCm();
        const fromNeck = Math.max(0, (sel.side === 'espalda' ? -pattern.construction.bnd : -pattern.construction.fnd) - (sel.cy + d.ch / 2));
        const offX = Math.abs(sel.cx) < 0.004 ? 'centrada' : `${R.fmtNum(Math.abs(sel.cx) * 100, 0)} cm a la ${(sel.cx > 0) === (sel.side === 'frente') ? 'izquierda de quien la usa' : 'derecha de quien la usa'}`;
        placeReadout.innerHTML = `<b>${R.fmtNum(d.cw * 100, 1)} × ${R.fmtNum(d.ch * 100, 1)} cm</b> · ${SIDE_NAME[sel.side].toLowerCase()} · ${R.fmtNum(fromNeck * 100, 0)} cm debajo del cuello · ${offX}`;
      } else placeReadout.innerHTML = '<span class="dis-muted">Todavía no hay estampa.</span>';
      for (const b of [centerBtn, straightBtn]) b.disabled = paintSrc || !cur;
      widthSlider.input.disabled = rotSlider.input.disabled = paintSrc || !cur;
    }

    function evaluateNow() {
      const t = tech();
      if (!t || !cur || !result || result.sketch) {
        evalRes = null;
        return null;
      }
      const d = dimsCm();
      evalRes = R.evaluateDesign({
        tech: t,
        fabric,
        fabricHex,
        sourceType: sel.sourceType,
        srcPxW: cur.w * (sel.sourceType === 'upload' ? upload.scale : 1),
        colors: t.id === 'vinilo' && sel.tints.vinilo !== 'diseno' ? 1 : sel.colors[t.id],
        tintId: sel.tints[t.id],
        richColors: sel.sourceType === 'upload' ? upload.colors : 3,
        cw: d.cw,
        ch: d.ch,
        coverage: result.coverage,
        contrast,
        inArea: true,
        side: sel.side,
        order,
        wantName: wantTech ? catalog.techniqueById(wantTech).name : null,
      });
      return evalRes;
    }

    function currentCost() {
      const t = tech();
      if (!cur || !t) return 0;
      const d = dimsCm();
      const colors = t.maxColors ? (t.id === 'vinilo' && sel.tints.vinilo !== 'diseno' ? 1 : sel.colors[t.id]) : 1;
      return R.estimateCost(t, { cw: d.cw, ch: d.ch, colors, coverage: result?.coverage ?? 0.4 });
    }

    // Qué falta para poder confirmar (técnica e imagen las elige el jugador).
    function missing() {
      const m = [];
      if (!tech()) m.push({ id: 'tecnica', label: 'Elegí la técnica', html: 'Tocá una técnica en el paso 1: cada una tiene su relieve, sus reglas y su costo.' });
      if (!cur)
        m.push({
          id: 'imagen',
          label: sel.sourceType === 'paint' ? 'Pintá tu diseño' : sel.sourceType === 'text' ? 'Escribí tu texto' : 'Elegí la imagen',
          html: sel.sourceType === 'paint' ? 'Pintá arrastrando sobre la remera, adentro del área punteada.' : sel.sourceType === 'text' ? 'Escribí una frase en el paso 2.' : 'En el paso 2: un prediseño, tu propia imagen, un texto o pintura a mano.',
        });
      return m;
    }

    function refreshInfo() {
      const t = tech();
      const ev = evaluateNow();
      const miss = missing();
      // chequeo
      checkList.innerHTML = '';
      for (const c of miss) checkList.appendChild(h('li', { class: 'lv-todo' }, h('span', { class: 'dis-ci' }, '•'), h('span', { class: 'dis-cl' }, c.label), h('span', { class: 'dis-cd', html: c.html })));
      if (ev) {
        for (const c of ev.checks) {
          const icon = c.level === 'ok' ? '✓' : c.level === 'bad' ? '✗' : '!';
          checkList.appendChild(h('li', { class: `lv-${c.level}`, title: c.html.replace(/<[^>]+>/g, '') }, h('span', { class: 'dis-ci' }, icon), h('span', { class: 'dis-cl' }, c.label), c.level !== 'ok' ? h('span', { class: 'dis-cd', html: c.html }) : null));
        }
      }
      const cost = currentCost();
      costLine.innerHTML = cur && t ? `<span>Costo estimado de la estampa</span><b>${money(cost)}</b>` : '';
      // resúmenes de las secciones
      const lv = (id) => ev?.checks.find((c) => c.id === id)?.level || 'ok';
      const worst = (...ids) => (ids.some((i) => lv(i) === 'bad') ? 'bad' : ids.some((i) => lv(i) === 'warn') ? 'warn' : 'ok');
      sections.tecnica.sum.innerHTML = t ? `${t.icon} ${R.TECH_SHORT[t.id]} ${dots(R.reliefLevel(t.relief), 4)}` : '<span class="dis-sum-todo">sin elegir</span>';
      sections.imagen.sum.innerHTML = '';
      if (cur) sections.imagen.sum.textContent = cur.name;
      else sections.imagen.sum.innerHTML = '<span class="dis-sum-todo">sin elegir</span>';
      const tintName = t ? tintList(catalog, t.id)?.find((x) => x.id === sel.tints[t.id])?.name : null;
      sections.opciones.sum.textContent = !t ? '—' : t.maxColors > 1 && !(t.id === 'vinilo' && sel.tints.vinilo !== 'diseno') ? `${sel.colors[t.id]} ${R.inkWord(t.id, sel.colors[t.id])}` : tintName && tintName !== 'Del diseño' ? tintName : t.maxColors === 1 ? '1 tono' : 'a todo color';
      const d = dimsCm();
      sections.ubicacion.sum.textContent = cur ? `${SIDE_NAME[sel.side]} · ${R.fmtNum(d.cw * 100, 0)} cm` : SIDE_NAME[sel.side];
      const stat = (s, level) => {
        s.stat.className = `dis-sec-stat lv-${level}`;
        s.stat.textContent = level === 'ok' ? '' : level === 'bad' ? '✗' : level === 'todo' ? '•' : '!';
      };
      stat(sections.tecnica, !t ? 'todo' : ev ? worst('tecnica', 'pedido') : 'ok');
      stat(sections.imagen, !cur ? 'todo' : ev ? worst('resolucion', 'contraste') : 'ok');
      stat(sections.opciones, ev ? worst('tintas') : 'ok');
      stat(sections.ubicacion, ev ? worst('tamano', 'area') : 'ok');
      for (const id of ORDERED) sections[id].el.classList.toggle('todo', miss.some((m) => m.id === id));
      // tintas usadas (después de procesar)
      inkRow.innerHTML = '';
      if (t && result && !result.sketch && result.palette?.length && t.id !== 'pintura' && t.maxColors !== 1 && !(t.id === 'vinilo' && sel.tints.vinilo !== 'diseno')) {
        const word = t.id === 'bordado' ? 'Hilos' : t.id === 'vinilo' ? 'Capas' : t.maxColors ? 'Tintas' : 'Colores';
        inkRow.append(h('span', { class: 'dis-inks-label' }, t.maxColors ? `${word} separadas:` : `${word} principales:`), ...result.palette.slice(0, 8).map((c) => h('span', { class: 'dis-ink', style: { background: c }, title: c })));
      }
      // HUD
      if (t) hudTech.innerHTML = `<span class="dis-hud-icon">${t.icon}</span><span>${R.TECH_SHORT[t.id]}</span>`;
      else hudTech.innerHTML = cur ? '<span class="dis-hud-icon">✏️</span><span>Boceto</span>' : '<span class="dis-hud-icon">✏️</span><span>Sin diseño</span>';
      hudSize.textContent = cur
        ? `${R.fmtNum(d.cw * 100, 0)} × ${R.fmtNum(d.ch * 100, 0)} cm · ${SIDE_NAME[sel.side].toLowerCase()}`
        : !t
          ? 'elegí técnica e imagen'
          : sel.sourceType === 'paint' && t.id === 'pintura'
            ? 'pintá sobre la remera'
            : sel.sourceType === 'text'
              ? 'escribí tu texto'
              : 'elegí la imagen';
      hudRelief.innerHTML = t ? `${dots(R.reliefLevel(t.relief), 4)} ${t.relief ? `relieve ${R.reliefText(t.relief)}` : 'sin relieve: tiñe la fibra'}` : cur ? 'elegí la técnica para ver el relieve' : '';
      hudInks.innerHTML = '';
      if (t && result?.palette?.length && !result.sketch && t.id !== 'pintura') for (const c of result.palette.slice(0, 6)) hudInks.appendChild(h('span', { style: { background: c } }));
      hudCost.innerHTML = cur && t ? `Costo <b>${money(cost)}</b>` : '';
      hudEl.classList.toggle('sketch', !t);
      for (const b of zoomButtons) if (b.classList.contains('dis-hud-zoom')) b.style.display = closeup || paintActive() || (result && !result.sketch) ? '' : 'none';
      refreshPaintHud();
      // acciones
      const can = !miss.length && !!result && !result.sketch && !busy;
      ui.enableAction('ok', can);
      const okBtn = ui.action('ok');
      if (okBtn) okBtn.title = can ? '' : miss.length ? `Falta: ${miss.map((m) => m.label.toLowerCase()).join(' y ')}` : 'Procesando la vista previa…';
      refreshModeHints();
    }

    function refreshPaintHud() {
      const on = sel.sourceType === 'paint' && sel.techId === 'pintura';
      hudPaint.style.display = on ? '' : 'none';
      if (!on) return;
      hudPaint.innerHTML = '';
      hudPaint.append(
        h('span', { class: 'dis-hud-sw', style: { background: paint.erase ? 'repeating-linear-gradient(45deg,#fff 0 3px,#ddd 3px 6px)' : paint.color } }),
        h('span', {}, paint.erase ? `Goma · ${paint.sizeMm} mm` : `Pincel · ${paint.sizeMm} mm`),
      );
    }

    function refreshAll() {
      refreshTech();
      refreshImage();
      refreshPlace();
      refreshInfo();
    }

    function setBusy(on) {
      hudBusy.classList.toggle('on', !!on);
      checkBox.classList.toggle('busy', !!on);
    }

    // pistas según lo que se esté haciendo
    function refreshModeHints() {
      if (performance.now() < nudgeUntil) return;
      let key;
      let msg;
      if (sel.sourceType === 'paint' && sel.techId === 'pintura') {
        key = 'paint';
        msg = coarse ? 'Pintá con el dedo sobre la remera · deslizá afuera de la remera para girar la vista' : 'Pintá arrastrando sobre la remera · <kbd>[</kbd> <kbd>]</kbd> grosor · <kbd>G</kbd> goma · <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer · arrastrá el fondo para girar';
      } else if (!sel.techId || !cur) {
        key = 'start';
        msg = coarse ? 'Elegí la técnica (1) y la imagen (2) en el panel · deslizá el fondo para girar la remera' : 'Elegí la <b>técnica</b> (1) y la <b>imagen</b> (2) en el panel · arrastrá el fondo para girar la remera · rueda para acercarte';
      } else if (openId === 'ubicacion') {
        key = 'place';
        msg = coarse ? 'Arrastrá la estampa para moverla · usá las manijas para agrandar y rotar' : 'Arrastrá la estampa para moverla · manijas: agrandar y rotar · <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> mover · <kbd>+</kbd> <kbd>−</kbd> tamaño';
      } else {
        key = 'base';
        msg = coarse ? 'Arrastrá la estampa para moverla · deslizá el fondo para girar la vista' : 'Arrastrá la estampa sobre la remera para moverla · arrastrá el fondo para girar · rueda para acercarte';
      }
      if (key === lastHintKey) return;
      lastHintKey = key;
      ui.hint(msg);
      const k = key;
      ctx.timeout(() => lastHintKey === k && ui.hint(null), 8000);
    }

    // =====================================================================
    // Interacción 3D: arrastrar, manijas, pintar
    // =====================================================================

    let pointerMoved = true;
    let lastTap = 0;

    const panels = () => {
      const m = shirt.getPanelMeshes();
      return [m.frente, m.espalda].filter(Boolean);
    };
    const hitShirt = () => {
      const hits = engine.raycast(panels(), null, false);
      if (!hits.length) return null;
      const g = shirt.hitToGarment(hits[0]);
      if (!g) return null;
      return { ...g, point: hits[0].point, face: hits[0].face, object: hits[0].object };
    };
    function onPrint(g) {
      if (!g || !cur || cur.type === 'paint' || g.side !== sel.side) return false;
      const d = dimsCm();
      const r = -sel.rot * R.DEG;
      const dx = g.viewX - sel.cx;
      const dy = g.y - sel.cy;
      const lx = dx * Math.cos(r) - dy * Math.sin(r);
      const ly = dx * Math.sin(r) + dy * Math.cos(r);
      const m = coarse ? 0.03 : 0.015;
      return Math.abs(lx) <= d.cw / 2 + m && Math.abs(ly) <= d.ch / 2 + m;
    }

    // Termina cualquier arrastre en curso (al soltar, si el navegador cancela el gesto, o si la
    // ventana pierde el foco). `cancel`: no hubo pointerup (gesto cancelado / foco perdido).
    function endDrag({ cancel = false } = {}) {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.captureEl && d.pointerId != null) {
        try {
          d.captureEl.releasePointerCapture?.(d.pointerId);
        } catch (e) {
          /* ya liberado */
        }
      }
      setOrbitActive(true);
      pointerMoved = true;
      if (d.kind === 'paint') {
        painter.end();
        sourceChanged({ delay: 120 });
        if (!cancel) audio.play('chalk');
      } else {
        canvasEl.style.cursor = '';
        placementChanged({ reprocess: true, commit: true });
        if (d.kind === 'move' && !cancel) audio.play('tick');
      }
    }

    ctx.onPointer('down', (e) => {
      if (drag) endDrag({ cancel: true }); // un arrastre viejo que no se cerró (no debería pasar)
      if (busy || e.button > 0) return;
      const g = hitShirt();
      if (paintActive()) {
        if (g && g.side === sel.side) {
          setOrbitActive(false);
          grabBrush();
          painter.begin(sel.side, g.viewX, g.y, { color: paint.color, sizeMm: paint.sizeMm, erase: paint.erase, fabricHex });
          drag = { kind: 'paint', pointerId: e.pointerId };
          audio.play('chalk');
        }
        return;
      }
      if (onPrint(g)) {
        setOrbitActive(false);
        drag = { kind: 'move', dx: sel.cx - g.viewX, dy: sel.cy - g.y, pointerId: e.pointerId };
        canvasEl.style.cursor = 'grabbing';
        audio.play('tick');
        return;
      }
      // doble toque/clic sobre la remera: traer la estampa hasta ahí
      const now = performance.now();
      if (g && g.side === sel.side && cur && cur.type !== 'paint' && now - lastTap < 380) {
        sel.cx = g.viewX;
        sel.cy = g.y;
        sel.spot = null;
        sel.placed = true;
        audio.play('pop');
        placementChanged({ commit: true });
      }
      lastTap = now;
    });

    function startHandle(kind, e) {
      if (busy || !cur || !overlay.screen.center || e.button > 0) return;
      if (drag) endDrag({ cancel: true });
      e.preventDefault();
      e.stopPropagation();
      setOrbitActive(false);
      const r = engine.canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const [cx, cy] = overlay.screen.center;
      const captureEl = e.currentTarget;
      if (kind === 'scale') drag = { kind, d0: Math.max(8, Math.hypot(px - cx, py - cy)), cw0: sel.cw };
      else drag = { kind, a0: Math.atan2(py - cy, px - cx), rot0: sel.rot };
      drag.pointerId = e.pointerId;
      drag.captureEl = captureEl;
      // los movimientos siguen llegando aunque el dedo/mouse se salga del círculo
      try {
        captureEl.setPointerCapture?.(e.pointerId);
      } catch (err) {
        /* sin captura: igual llegan por window */
      }
      sel.spot = null;
      sel.placed = true;
      audio.play('tick');
    }
    for (const [kind, els] of [
      ['scale', [overlay.handles.scale, overlay.handles.scaleHit]],
      ['rot', [overlay.handles.rot, overlay.handles.rotHit]],
    ]) {
      for (const el of els) ctx.listen(el, 'pointerdown', (e) => startHandle(kind, e));
    }

    ctx.onPointer('move', (e, p) => {
      pointerMoved = true;
      if (!drag) return;
      if (drag.pointerId != null && e.pointerId !== drag.pointerId) return; // otro dedo
      if (drag.kind === 'paint') {
        const g = hitShirt();
        if (g && g.side === sel.side) {
          if (!painter.painting) painter.begin(sel.side, g.viewX, g.y, { color: paint.color, sizeMm: paint.sizeMm, erase: paint.erase, fabricHex });
          else painter.to(g.viewX, g.y);
          hover = { hit: g, onPrint: false };
        } else if (painter.painting) {
          // se fue de la remera: corta la pincelada (sigue al volver)
          painter.end();
        }
        return;
      }
      if (drag.kind === 'move') {
        const g = hitShirt();
        if (g && g.side === sel.side) {
          sel.cx = g.viewX + drag.dx;
          sel.cy = g.y + drag.dy;
          sel.spot = null;
          sel.placed = true;
          placementChanged();
        }
        return;
      }
      if (!overlay.screen.center) return;
      const [cx, cy] = overlay.screen.center;
      if (drag.kind === 'scale') {
        const d = Math.hypot(p.x - cx, p.y - cy);
        sel.cw = clamp((drag.cw0 * d) / drag.d0, 0.03, 0.5);
        placementChanged();
      } else if (drag.kind === 'rot') {
        const a = Math.atan2(p.y - cy, p.x - cx);
        let deg = drag.rot0 - ((a - drag.a0) * 180) / Math.PI;
        deg = clamp(Math.round(deg), -45, 45);
        if (Math.abs(deg) <= 2) deg = 0; // imán al derecho
        sel.rot = deg;
        placementChanged();
      }
    });

    ctx.onPointer('up', (e) => {
      if (!drag) return;
      if (drag.pointerId != null && e.pointerId != null && e.pointerId !== drag.pointerId) return;
      endDrag();
    });
    // El motor no escucha pointercancel (el navegador se quedó con el gesto): se cierra igual que
    // al soltar y se corrige el estado del puntero para que el hover vuelva a funcionar.
    ctx.listen(window, 'pointercancel', (e) => {
      if (engine.pointer) {
        engine.pointer.down = false;
        engine.pointer.buttons = 0;
      }
      if (drag && (drag.pointerId == null || e.pointerId === drag.pointerId)) endDrag({ cancel: true });
    });
    ctx.listen(window, 'blur', () => endDrag({ cancel: true }));

    // ---------- teclado ----------
    ctx.listen(window, 'keydown', (e) => {
      if (busy || e.defaultPrevented) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.modal-wrap')) return;
      const k = e.key;
      if (paintActive()) {
        if (k === '[' || k === ']') {
          paint.sizeMm = clamp(paint.sizeMm + (k === ']' ? 2 : -2), 2, 40);
          sizeSlider.setValue(paint.sizeMm);
          refreshPaintHud();
          e.preventDefault();
        } else if (k === 'b' || k === 'B') setPaintTool(false);
        else if (k === 'g' || k === 'G') setPaintTool(true);
        else if ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey)) {
          undoPaint();
          e.preventDefault();
        }
        return;
      }
      if (!cur || cur.type === 'paint') return;
      const stepM = e.shiftKey ? 0.02 : 0.005;
      let moved = true;
      if (k === 'ArrowLeft') sel.cx -= stepM;
      else if (k === 'ArrowRight') sel.cx += stepM;
      else if (k === 'ArrowUp') sel.cy += stepM;
      else if (k === 'ArrowDown') sel.cy -= stepM;
      else if (k === '+' || k === '=') sel.cw *= 1.05;
      else if (k === '-' || k === '_') sel.cw /= 1.05;
      else if (k === 'q' || k === 'Q') sel.rot = clamp(sel.rot + 5, -45, 45);
      else if (k === 'e' || k === 'E') sel.rot = clamp(sel.rot - 5, -45, 45);
      else moved = false;
      if (moved) {
        e.preventDefault();
        sel.spot = null;
        sel.placed = true;
        placementChanged({ reprocess: k === '+' || k === '=' || k === '-' || k === '_' });
      }
    });

    // ---------- arrastrar y soltar / pegar ----------
    const dropOverlay = h('div', { class: 'dis-dropover' }, h('div', { class: 'dis-dropover-card' }, h('span', { class: 'dis-dropover-icon' }, '🖼️'), h('b', {}, 'Soltá tu imagen'), h('span', {}, 'la estampamos en la remera')));
    app.appendChild(dropOverlay);
    ctx.track(() => dropOverlay.remove());
    let dragDepth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    ctx.listen(window, 'dragenter', (e) => {
      if (!hasFiles(e) || busy) return;
      dragDepth++;
      dropOverlay.classList.add('show');
    });
    ctx.listen(window, 'dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    ctx.listen(window, 'dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) dropOverlay.classList.remove('show');
    });
    ctx.listen(window, 'drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      dropOverlay.classList.remove('show');
      const f = e.dataTransfer.files?.[0];
      if (f) loadFile(f);
    });
    ctx.listen(window, 'paste', (e) => {
      if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type && i.type.startsWith('image/'));
      if (!item) return;
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        loadFile(f);
      }
    });

    // =====================================================================
    // Bucle por frame
    // =====================================================================
    const tmpV = new THREE.Vector3();
    const tmpN = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    ctx.onUpdate((dt) => {
      const now = performance.now();
      // giro de la remera (frente/espalda)
      const rt = rotTarget();
      if (Math.abs(rt - rotY) > 1e-4) {
        rotY += (rt - rotY) * (1 - Math.exp(-dt * 6));
        if (Math.abs(rt - rotY) < 0.002) rotY = rt;
        shirt.group.rotation.y = rotY;
      }
      // procesar / aplicar la estampa real cuando el diseño queda quieto
      if (processAt && now >= processAt && !drag) doProcess();
      else if (placeAt && !drag && now - placeAt > PLACE_IDLE_MS) applyPrint();

      // luz rasante (la de relleno del motor, prestada mientras se mira de cerca)
      const gl = closeup && !busy ? 1 : 0;
      if (graze && (Math.abs(gl - grazeLevel) > 0.002 || (gl && !grazeBase))) {
        if (!grazeBase) grazeBase = { position: graze.position.clone(), color: graze.color.clone(), intensity: graze.intensity };
        grazeLevel += (gl - grazeLevel) * (1 - Math.exp(-dt * 4));
        if (Math.abs(gl - grazeLevel) <= 0.002) grazeLevel = gl;
        const { wn } = printWorldFrame();
        // casi rasante: de costado y un poco de arriba (una direccional solo usa la dirección)
        grazeDir.set(-0.9, 0.35, 0).addScaledVector(wn, 0.28).normalize().multiplyScalar(grazeBase.position.length() || 8);
        graze.position.lerpVectors(grazeBase.position, grazeDir, grazeLevel);
        graze.color.copy(grazeBase.color).lerp(grazeColor, grazeLevel);
        graze.intensity = grazeBase.intensity + (2.4 - grazeBase.intensity) * grazeLevel;
        if (!gl && grazeLevel === 0) restoreGraze();
      }

      // mientras se presenta el diseño confirmado no se muestra nada de la edición
      if (busy) {
        overlay.show({ frame: false, strong: false, handles: false, area: false, tip: '', ghost: false });
        overlay.setBrush(null);
        if (brushSaved) releaseBrush();
        overlay.update();
        return;
      }

      // hover (no mientras se gira la vista con la órbita)
      const overH = overlay.overHandle;
      if ((pointerMoved || overH !== lastOverHandle) && !drag && !engine.pointer.down) {
        pointerMoved = false;
        lastOverHandle = overH;
        const g = engine.pointer.inside ? hitShirt() : null;
        const onP = onPrint(g);
        // el marco sigue a la vista sobre la estampa, sobre una manija o yendo hacia ellas
        const keep = overH || (frameHover && overlay.nearHandles(engine.pointer.x, engine.pointer.y));
        hover = g || keep ? { hit: g, onPrint: onP, frame: onP || keep } : null;
        frameHover = !!hover?.frame;
        if (paintActive()) {
          canvasEl.style.cursor = g && g.side === sel.side ? 'crosshair' : '';
          setOrbitActive(!(g && g.side === sel.side));
        } else {
          canvasEl.style.cursor = onP ? 'grab' : '';
          setOrbitActive(!onP);
        }
      }

      // marco, área y lugar marcado
      const paintMode = paintActive();
      const placeOpen = openId === 'ubicacion';
      const dragging = !!drag && drag.kind !== 'paint';
      const showFrame = !!cur && cur.type !== 'paint' && (placeOpen || !!hover?.frame || dragging);
      const which = overlay.overWhich;
      const t = tech();
      overlay.show({
        frame: showFrame,
        strong: dragging || !!hover?.frame,
        handles: showFrame,
        area: paintMode || (drag && drag.kind === 'move') || placeOpen || !cur,
        tip: drag ? '' : which === 'scale' ? '⤡ Agrandar / achicar' : which === 'rot' ? '⟲ Rotar' : hover?.onPrint ? (coarse ? '✥ Arrastrá' : '✥ Arrastrá para mover') : '',
        ghost: !cur && !paintMode,
        ghostLabel: !t ? ['Tu estampa va acá', '<i>1</i> Técnica <i>2</i> Imagen'] : ['Tu estampa va acá', `${t.icon} ${R.TECH_SHORT[t.id]} · <i>2</i> Elegí la imagen`],
      });
      // anillo del pincel + pincel 3D
      if (paintMode && hover?.hit && hover.hit.side === sel.side && engine.pointer.inside) {
        const hp = hover.hit.point;
        tmpN.copy(hover.hit.face.normal).transformDirection(hover.hit.object.matrixWorld).normalize();
        const sp = engine.worldToScreen(hp);
        // radio en pantalla: proyectar un punto a la distancia del radio del pincel
        tmpV.copy(hp).add(new THREE.Vector3(1, 0, 0).applyQuaternion(engine.camera.quaternion).multiplyScalar(paint.sizeMm / 2000));
        const sp2 = engine.worldToScreen(tmpV);
        overlay.setBrush(sp.x, sp.y, Math.hypot(sp2.x - sp.x, sp2.y - sp.y), paint.erase ? '#ffffff' : paint.color);
        if (brush) {
          grabBrush();
          if (brushTipMat && !paint.erase) brushTipMat.color.set(paint.color);
          brush.visible = true;
          const lift = drag?.kind === 'paint' ? 0.0005 : 0.012;
          // mango hacia afuera de la tela, inclinado hacia arriba y a la derecha (como se sostiene)
          const dir = tmpV.copy(tmpN).multiplyScalar(0.85).add(new THREE.Vector3(0.22, 0.4, 0)).normalize();
          tmpQ.setFromUnitVectors(Y, dir);
          brush.quaternion.copy(tmpQ);
          const s = clamp(paint.sizeMm / 9, 0.75, 1.9);
          brush.scale.setScalar(s);
          brush.position.copy(hp).addScaledVector(tmpN, lift);
        }
      } else {
        overlay.setBrush(null);
        if (brushSaved && !(drag && drag.kind === 'paint')) releaseBrush();
      }
      overlay.update();
    });

    // =====================================================================
    // Confirmar
    // =====================================================================
    function applyAuto() {
      const tid = R.suggestedTechnique(catalog, state);
      sel.techId = tid;
      const t = tech();
      sel.colors[t.id] = R.defaultColors(t);
      sel.tints[t.id] = defaultTintId(catalog, t.id, state);
      const own = (sel.sourceType === 'upload' && upload.processed) || (sel.sourceType === 'text' && text.value.trim()) || (sel.sourceType === 'paint' && !painter.isEmpty(sel.side));
      if (!own) {
        sel.sourceType = 'preset';
        preset.id = PRESETS[0].id;
        preset.picked = true;
        tabs.setValue('preset');
        showPane('preset');
      }
      rebuildOptions();
      buildSource();
      if (cur && cur.type !== 'paint') applySpot(extras?.maxCm ? 'corazon' : extras?.side === 'espalda' ? 'espalda' : 'pecho', { animate: false });
      doProcess();
    }

    async function confirm(auto) {
      if (busy) return;
      if (drag) endDrag();
      if (auto) {
        applyAuto();
        audio.play('select');
      } else {
        const miss = missing();
        if (miss.length) {
          ui.toast(`Falta: ${miss.map((m) => m.label.toLowerCase()).join(' y ')}.`, 'warn', 3000);
          openSection(miss[0].id, { sound: true });
          return;
        }
        if (processAt || result?.sketch) doProcess();
        else if (placeAt) applyPrint();
      }
      if (!cur || !result || result.sketch || !tech()) {
        ui.toast(sel.sourceType === 'paint' ? 'Pintá algo sobre la remera antes de confirmar.' : 'Primero elegí o creá un diseño.', 'warn');
        return;
      }
      busy = true;
      ui.enableAction('ok', false);
      ui.enableAction('auto', false);
      body.classList.add('dis-locked');
      canvasEl.style.cursor = '';
      overlay.show({ frame: false, area: false, tip: '' });
      setOrbitActive(false);
      const t = tech();
      const ev = evaluateNow();
      let { score, notes } = ev;
      notes = [...notes];
      if (auto) {
        score = Math.min(score, 72);
        notes.unshift('<span class="dis-mark mid">≈</span> Diseño armado en automático por el taller: la próxima elegí vos la técnica y subí tu propia imagen para sumar más puntos.');
      }
      const d = dimsCm();
      const cost = currentCost();
      ctx.addCost('Estampa', cost);
      const colors = t.maxColors ? (t.id === 'vinilo' && sel.tints.vinilo !== 'diseno' ? 1 : sel.colors[t.id]) : null;
      const tintHex = tintHexOf(catalog, t.id, sel.tints[t.id]);
      state.design = {
        technique: t.id,
        side: sel.side,
        placement: placement(),
        options: {
          colors,
          tint: tintHex,
          tintId: tintHex ? sel.tints[t.id] : null,
          sourceType: sel.sourceType,
          presetId: preset.id,
          text: sel.sourceType === 'text' ? { ...text } : null,
          removeBg: sel.sourceType === 'upload' ? upload.removeBg : undefined,
          uploadScale: sel.sourceType === 'upload' ? upload.scale : undefined,
        },
        source: cur.canvas,
        sourceName: cur.name,
        sourceType: sel.sourceType,
        size: { cw: d.cw, ch: d.ch },
        palette: result.palette ? [...result.palette] : [],
        coverage: result.coverage,
        preview: result,
        cost,
      };
      // presentación: la estampa de cerca un instante (sin órbita ni luz rasante)
      closeup = false;
      orbitWanted = false;
      engine.setOrbit({ enabled: false });
      const { wp, wn } = printWorldFrame();
      const dist = clamp(d.cw * 2.6, 0.45, 1.05) * (isMobile() ? 1.8 : 1);
      ctx.flyTo({ position: wp.clone().addScaledVector(wn, dist).add(new THREE.Vector3(0.05, 0.04, 0)).toArray(), target: wp.toArray() }, 0.9);
      audio.play('pop');
      ui.hint(null);
      ui.toast(`🎨 ${t.icon} ${R.TECH_SHORT[t.id]} · ${R.fmtNum(d.cw * 100, 0)} × ${R.fmtNum(d.ch * 100, 0)} cm en la ${sel.side} · ${money(cost)}`, score >= 80 ? 'good' : score >= 55 ? 'info' : 'warn', 3600);
      await new Promise((r) => ctx.timeout(r, 1100));
      if (!ctx.alive) return;
      // tarjeta: miniatura de la estampa sobre el color de la tela
      const thumb = document.createElement('canvas');
      const pw = result.color.width;
      const ph = result.color.height;
      const s = Math.min(1, 150 / Math.max(pw, ph));
      thumb.width = Math.round(pw * s) + 24;
      thumb.height = Math.round(ph * s) + 24;
      const tg = thumb.getContext('2d');
      tg.fillStyle = fabricHex;
      tg.fillRect(0, 0, thumb.width, thumb.height);
      tg.drawImage(result.color, 12, 12, thumb.width - 24, thumb.height - 24);
      thumb.className = 'dis-res-thumb';
      const extra = h(
        'div',
        { class: 'dis-res' },
        thumb,
        h('div', { class: 'dis-res-meta' }, h('b', {}, `${t.icon} ${t.name}`), h('span', {}, `${cur.name} · ${SIDE_NAME[sel.side].toLowerCase()} · ${R.fmtNum(d.cw * 100, 0)} × ${R.fmtNum(d.ch * 100, 0)} cm`), h('span', { html: `${dots(R.reliefLevel(t.relief), 4)} ${R.reliefText(t.relief)} · costo ${money(cost)}` })),
      );
      await ctx.complete({ score, notes, extra });
    }

    // ---------- ayudas para pruebas automáticas ----------
    step._test = {
      sel,
      get result() {
        return result;
      },
      get cur() {
        return cur;
      },
      get eval() {
        return evaluateNow();
      },
      flush: () => doProcess(),
      setTech,
      pickPreset,
      setSide,
      applySpot,
      openSection,
      setText,
      setSourceType,
      toggleCloseup,
      overlay,
      // pinta una pincelada en coords de prenda (vista) sin mouse
      paintStroke(points, opts = {}) {
        if (sel.techId !== 'pintura') setTech('pintura');
        if (sel.sourceType !== 'paint') setSourceType('paint');
        const o = { color: opts.color || paint.color, sizeMm: opts.sizeMm || paint.sizeMm, erase: !!opts.erase, fabricHex };
        painter.begin(sel.side, points[0][0], points[0][1], o);
        for (const p of points.slice(1)) painter.to(p[0], p[1]);
        painter.end();
        sourceChanged({ delay: 10 });
      },
      screenOf(vx, y) {
        const { position } = shirt.garmentToLocal(sel.side, sel.side === 'espalda' ? -vx : vx, y, 0);
        shirt.group.updateMatrixWorld(true);
        const s = engine.worldToScreen(shirt.group.localToWorld(position));
        return [Math.round(s.x), Math.round(s.y)];
      },
      handles: () => ({ center: overlay.screen.center, scale: overlay.screen.scale, rot: overlay.screen.rot }),
      painter,
      proxy,
      get drag() {
        return drag ? drag.kind : null;
      },
      get missing() {
        return missing().map((m) => m.id);
      },
      get placing() {
        return !!placeAt;
      },
      upload,
    };
    ctx.track(() => {
      delete step._test;
    });

    // =====================================================================
    // Arranque
    // =====================================================================
    rebuildOptions();
    showPane(sel.sourceType || 'preset');
    buildSource();
    if (prev && cur && cur.type !== 'paint') {
      sel.cx = prev.placement.x;
      sel.cy = prev.placement.y;
      sel.cw = prev.placement.width * cur.geo.fx;
      sel.rot = prev.placement.rotation || 0;
      clampSel();
    }
    updateFrame();
    refreshAll();
    openSection('tecnica', { scroll: false });
    if (cur) needProcess(400);
    flyMain(1.4);
  },
};
