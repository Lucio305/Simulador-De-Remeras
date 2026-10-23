// Motor de estampado: convierte una imagen (canvas) en una estampa con el "look" real de cada
// técnica: color, mapa de alturas (relieve), normal map, rugosidad/metalicidad y parámetros de
// material. Todo con canvas 2D + typed arrays (sin WebGL), así sirve para la vista previa en vivo.
//
//   processPrint(source, techniqueId, options) → PrintResult (ver SPEC)
//   loadImageFile(file) / removeBackground(canvas) / trimTransparent(canvas)
//   applyWear(result, { fade, crack })   → para la prueba de lavado
//
// Nota: `height` del PrintResult es el canvas del mapa de alturas (también en `heightMap`);
// el tamaño en píxeles está en `width` / `pixelWidth` y `pixelHeight`.

import { TECHNIQUES, FABRICS, techniqueById, fabricById } from '../data/catalog.js';
import { clamp, hexToRgb, rgbToHex } from '../core/utils.js';
import { newCanvas, ctx2d, readRGBA, rgbaToCanvas, normalsFromHeight, bleedEdges, SRGB_TO_LINEAR } from './raster.js';
import { serigrafia, vinilo, dtf, sublimacion, puff, glitter, foil, pintura } from './techniques.js';
import { bordado } from './embroidery.js';
import { applyDefects, applyWear as wear, normalizeDefects } from './defects.js';

export { PRESETS, renderPreset, renderText, FONTS } from './presets.js';

const BUILDERS = { serigrafia, vinilo, dtf, sublimacion, bordado, puff, glitter, foil, pintura };

// ---------------------------------------------------------------------------
// Carga y limpieza de imágenes
// ---------------------------------------------------------------------------

// Lee un File/Blob de imagen y lo devuelve como canvas (máx. 1024 px de lado, conserva alpha).
export async function loadImageFile(file, maxSide = 1024) {
  if (!file) throw new Error('No hay archivo');
  let src = null;
  let w = 0;
  let h = 0;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width;
    h = src.height;
  } catch (e) {
    // SVG u otros formatos que createImageBitmap no toma: vía <img>
    src = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen'));
      };
      img.src = url;
    });
    w = src.naturalWidth || src.width || 512;
    h = src.naturalHeight || src.height || 512;
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = newCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  return c;
}

// Vuelve transparente el fondo liso (blanco o de cualquier color) conectado a los bordes,
// con un borde antialias de ~1 px y "descontaminando" el color del fondo en el filo.
// opts.holes = true también borra huecos interiores del mismo color (p. ej. el centro de una "O").
export function removeBackground(canvas, { tolerance = 0.12, holes = false } = {}) {
  canvas = asCanvas(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const img = readRGBA(canvas);
  const d = img.data;
  const n = w * h;
  // color de fondo = el más frecuente en el perímetro (histograma de 4 bits por canal)
  const bins = new Map();
  const addBorder = (i) => {
    const o = i * 4;
    if (d[o + 3] < 128) return;
    const key = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
    let b = bins.get(key);
    if (!b) bins.set(key, (b = { c: 0, r: 0, g: 0, b: 0 }));
    b.c++;
    b.r += d[o];
    b.g += d[o + 1];
    b.b += d[o + 2];
  };
  for (let x = 0; x < w; x++) {
    addBorder(x);
    addBorder((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    addBorder(y * w);
    addBorder(y * w + w - 1);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b.c > best.c) best = b;
  const ref = best ? { r: best.r / best.c, g: best.g / best.c, b: best.b / best.c } : { r: 255, g: 255, b: 255 };
  const MAXD = Math.sqrt(3) * 255;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    dist[i] = d[o + 3] < 26 ? 0 : Math.hypot(d[o] - ref.r, d[o + 1] - ref.g, d[o + 2] - ref.b) / MAXD;
  }
  const tol = clamp(tolerance, 0.005, 0.9);
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  // el relleno avanza si el píxel se parece al fondo, o si es un escalón suave desde un píxel de
  // fondo vecino (sombras y degradés del fondo de una foto) sin alejarse demasiado del color base
  const stepTol = tol * 0.3 * MAXD;
  const farTol = tol * 3;
  const visit = (i, from) => {
    if (bg[i]) return;
    if (dist[i] > tol) {
      if (from < 0 || dist[i] > farTol) return;
      const o = i * 4;
      const q = from * 4;
      if (Math.hypot(d[o] - d[q], d[o + 1] - d[q + 1], d[o + 2] - d[q + 2]) > stepTol) return;
    }
    bg[i] = 1;
    stack[sp++] = i;
  };
  for (let x = 0; x < w; x++) {
    visit(x, -1);
    visit((h - 1) * w + x, -1);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w, -1);
    visit(y * w + w - 1, -1);
  }
  while (sp) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) visit(i - 1, i);
    if (x < w - 1) visit(i + 1, i);
    if (i >= w) visit(i - w, i);
    if (i < n - w) visit(i + w, i);
  }
  if (holes) for (let i = 0; i < n; i++) if (dist[i] < tol * 0.7) bg[i] = 1;
  // borde suave: los píxeles del objeto que tocan el fondo toman alpha según su parecido al fondo
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (bg[i]) {
        out[o + 3] = 0;
        continue;
      }
      const touches = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      if (!touches) continue;
      const a = clamp((dist[i] - tol) / (tol * 2.2) + 0.35, 0.35, 1);
      // quitar la "contaminación" del fondo: C = (P − (1−a)·B) / a
      out[o] = (d[o] - (1 - a) * ref.r) / a;
      out[o + 1] = (d[o + 1] - (1 - a) * ref.g) / a;
      out[o + 2] = (d[o + 2] - (1 - a) * ref.b) / a;
      out[o + 3] = d[o + 3] * a;
    }
  }
  return rgbaToCanvas(out, w, h);
}

// Acepta canvas, <img>, ImageBitmap, video…: si no es un canvas lo copia a uno.
function asCanvas(src) {
  if (src && typeof src.getContext === 'function') return src;
  const w = (src && (src.naturalWidth || src.videoWidth || src.width)) || 1;
  const h = (src && (src.naturalHeight || src.videoHeight || src.height)) || 1;
  const c = newCanvas(w, h);
  if (src) ctx2d(c).drawImage(src, 0, 0, w, h);
  return c;
}

// Recorta los márgenes transparentes. Si no hay nada visible, devuelve una copia 1×1.
export function trimTransparent(canvas, threshold = 8) {
  canvas = asCanvas(canvas);
  const w = canvas.width;
  const h = canvas.height;
  const d = readRGBA(canvas).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return newCanvas(1, 1);
  const c = newCanvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx2d(c).drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// ---------------------------------------------------------------------------
// Proceso principal
// ---------------------------------------------------------------------------

function prepare(source, res, opts, tech, fabric) {
  const trimmed = trimTransparent(source);
  const sw = trimmed.width;
  const sh = trimmed.height;
  // margen transparente alrededor (para bordes redondeados, aureolas, etc.): ~2% de cada lado,
  // proporcional en cada eje para no alterar la proporción del diseño (mínimo 3 px)
  const f = 0.02;
  const inner = res / (1 + 2 * f);
  const s = inner / Math.max(sw, sh);
  let dw = Math.max(1, Math.round(sw * s));
  let dh = Math.max(1, Math.round(sh * s));
  const padX = Math.max(3, Math.round(dw * f));
  const padY = Math.max(3, Math.round(dh * f));
  // que el lado mayor quede exactamente en `res`
  if (sw >= sh) dw = Math.max(1, res - padX * 2);
  else dh = Math.max(1, res - padY * 2);
  const pad = Math.min(padX, padY);
  const w = dw + padX * 2;
  const h = dh + padY * 2;
  const c = newCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(trimmed, 0, 0, sw, sh, padX, padY, dw, dh);
  const img = ctx.getImageData(0, 0, w, h);
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = img.data[i * 4 + 3] / 255;
  const fabricHex = opts.fabricColor || '#f3f1ea';
  const fr = hexToRgb(fabricHex);
  const fabricLin = [SRGB_TO_LINEAR[fr.r], SRGB_TO_LINEAR[fr.g], SRGB_TO_LINEAR[fr.b]];
  const widthM = opts.widthM > 0 ? opts.widthM : 0.26;
  return {
    w,
    h,
    n,
    pad,
    src: img.data,
    alpha,
    pxMm: (widthM * 1000) / w,
    widthM,
    tech,
    fabric,
    fabricHex,
    fabricRgb: fr,
    fabricLin,
    fabricLum: 0.2126 * fabricLin[0] + 0.7152 * fabricLin[1] + 0.0722 * fabricLin[2],
    opts,
    quality: clamp(opts.quality ?? 1, 0, 1),
    seed: (opts.seed ?? 7) | 0,
  };
}

function finalize(job, out, defectsUsed, t0) {
  const { w, h, n, pxMm } = job;
  const A = out.alpha;
  // relieve real = máximo alcanzado (puede crecer con bordes levantados o bajar con curado pobre)
  let maxH = 0;
  for (let i = 0; i < n; i++) if (A[i] > 0.03 && out.Hmm[i] > maxH) maxH = out.Hmm[i];
  const reliefMm = maxH > 0.002 ? maxH : 0;
  const hgt = new Uint8ClampedArray(n * 4);
  const inv = reliefMm ? 255 / reliefMm : 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const v = A[i] > 0.003 ? out.Hmm[i] * inv : 0;
    hgt[o] = hgt[o + 1] = hgt[o + 2] = v;
    hgt[o + 3] = 255;
  }
  // normal: relieve macro (ponderado) + micro-textura de la técnica
  let nrm;
  if (out.flat) {
    nrm = new Uint8ClampedArray(n * 4);
    for (let o = 0; o < nrm.length; o += 4) {
      nrm[o] = 128;
      nrm[o + 1] = 128;
      nrm[o + 2] = 255;
      nrm[o + 3] = 255;
    }
  } else {
    const comb = new Float32Array(n);
    const mw = out.macroW ?? 1;
    for (let i = 0; i < n; i++) {
      const a = A[i];
      if (a <= 0.003) continue;
      comb[i] = out.Hmm[i] * mw + (out.Dmm ? out.Dmm[i] * Math.min(1, a * 1.5) : 0);
    }
    let tilt = out.tilt;
    if (tilt) for (let i = 0; i < n; i++) if (A[i] <= 0.003) tilt[i * 2] = tilt[i * 2 + 1] = 0;
    nrm = normalsFromHeight(comb, w, h, pxMm, out.gain ?? 1, tilt);
  }
  // ORM: R = 1 (sin oclusión), G = rugosidad, B = metalicidad
  const orm = new Uint8ClampedArray(n * 4);
  const pr = out.params.roughness ?? 0.6;
  const pm = out.params.metalness ?? 0;
  const R = out.rough;
  const M = out.metal;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const inside = A[i] > 0.003;
    const rv = inside ? R[i] || pr : pr;
    orm[o] = 255;
    orm[o + 1] = (rv < 0.02 ? 0.02 : rv) * 255;
    orm[o + 2] = (inside && M ? M[i] : pm) * 255;
    orm[o + 3] = 255;
  }
  // color + cobertura (con anillo de color "sangrado" para filtrar sin halo oscuro)
  const C = out.color;
  let cov = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const a = A[i];
    C[o + 3] = a * 255;
    cov += a;
  }
  bleedEdges(C, w, h, 2, 4);
  const colorCanvas = rgbaToCanvas(C, w, h);
  const heightCanvas = rgbaToCanvas(hgt, w, h);
  const normalCanvas = rgbaToCanvas(nrm, w, h);
  const ormCanvas = rgbaToCanvas(orm, w, h);
  const palette = (out.palette || []).map((p) => rgbToHex(p.r, p.g, p.b));
  const tech = job.tech;
  const p = out.params;
  const params = {
    reliefMm,
    normalScale: p.normalScale ?? 1,
    roughness: pr,
    metalness: pm,
    opacity: p.opacity ?? 1,
    clearcoat: p.clearcoat ?? 0,
    clearcoatRoughness: p.clearcoatRoughness ?? 0.3,
    sheen: p.sheen ?? 0,
    sheenRoughness: p.sheenRoughness ?? 0.5,
    sheenColor: p.sheenColor ?? '#ffffff',
    iridescence: p.iridescence ?? 0,
    showWeave: !!p.showWeave,
    alphaTest: p.alphaTest ?? 0.03,
  };
  return {
    technique: tech.id,
    width: w,
    pixelWidth: w,
    pixelHeight: h,
    aspect: w / h,
    color: colorCanvas,
    height: heightCanvas,
    heightMap: heightCanvas,
    normal: normalCanvas,
    orm: ormCanvas,
    params,
    palette,
    colorsUsed: palette.length,
    coverage: cov / n,
    quality: job.quality,
    defects: defectsUsed,
    stitch: out.stitch || null,
    meta: {
      pxMm,
      widthM: job.widthM,
      pad: job.pad,
      fabricId: job.fabric.id,
      fabricColor: job.fabricHex,
      seed: job.seed,
      ms: Math.round(performance.now() - t0),
    },
  };
}

// Procesa una imagen con una técnica. Ver SPEC para `options`.
// Extras opcionales: options.widthM (ancho físico en metros, default 0.26: escala de puntadas,
// purpurina, etc.), options.seed (variación determinística), options.holo (foil holográfico).
export function processPrint(source, techniqueId, options = {}) {
  const t0 = performance.now();
  const tech = techniqueById(techniqueId) || TECHNIQUES[0];
  const fabric = fabricById(options.fabricId) || FABRICS[0];
  const res = clamp(Math.round(options.resolution || 768), 64, 2048);
  const job = prepare(source, res, options, tech, fabric);
  const build = BUILDERS[tech.id] || serigrafia;
  const out = build(job);
  const defects = normalizeDefects(options.defects);
  const used = applyDefects(job, out, job.quality, defects);
  const result = finalize(job, out, defects, t0);
  result.meta.effectiveDefects = { patchy: used.patchy, lift: used.lift, scorch: used.scorch, ghost: used.ghost, under: used.under };
  return result;
}

// Desgaste tras lavados: aclara/desatura (fade) y agrieta (crack). Devuelve un PrintResult nuevo.
export function applyWear(result, opts = {}) {
  return wear(result, opts);
}

// Útil para miniaturas/depuración: compone la estampa sobre un color de tela en un canvas 2D.
export function previewOnFabric(result, fabricColor = '#f3f1ea', size = 256) {
  const s = Math.min(1, size / Math.max(result.pixelWidth, result.pixelHeight));
  const c = newCanvas(Math.round(result.pixelWidth * s), Math.round(result.pixelHeight * s));
  const ctx = ctx2d(c);
  ctx.fillStyle = fabricColor;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(result.color, 0, 0, c.width, c.height);
  return c;
}

