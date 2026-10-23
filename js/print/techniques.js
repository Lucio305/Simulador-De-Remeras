// "Look" de cada técnica de estampado. Cada función recibe el `job` preparado por
// printEngine (fuente escalada, cobertura, tela, opciones) y devuelve los campos crudos:
// color RGBA, cobertura, altura macro (mm), micro-relieve (mm, solo para normales),
// rugosidad, metalicidad y parámetros de material.

import { GLITTER_TINTS, FOIL_TINTS } from '../data/catalog.js';
import { clamp, hexToRgb } from '../core/utils.js';
import {
  blur,
  insideDistance,
  regionDistance,
  smoothLabelEdges,
  fbmNoise,
  valueNoise,
  whiteNoise,
  hash2,
  kmeansPalette,
  quantizeLabels,
  modeFilter,
  growLabels,
  smoothMask,
  cleanMask,
  SRGB_TO_LINEAR as LIN,
  linearToSrgb8,
} from './raster.js';

// ---------------------------------------------------------------------------
// Utilidades comunes
// ---------------------------------------------------------------------------

export const px = (job, mmValue) => mmValue / job.pxMm;

function blank(job) {
  const n = job.n;
  return {
    color: new Uint8ClampedArray(n * 4),
    alpha: new Float32Array(n),
    Hmm: new Float32Array(n),
    Dmm: new Float32Array(n),
    rough: new Float32Array(n),
    metal: new Float32Array(n),
    tilt: null,
    gain: 1,
    macroW: 1,
    params: {},
    palette: [],
    colorsUsed: 0,
  };
}

function srcAlpha(job) {
  return job.alpha;
}

// Capa de "tinta" para técnicas de un solo color (foil, glitter, vinilo de 1 color).
// Si el diseño tiene dos tonos bien distintos (p. ej. logo oscuro sobre un disco claro) usa
// solo la capa más oscura, como se separaría para imprimir; si no, la silueta completa.
// opts.silhouette = 'full' fuerza la silueta completa, 'ink' la capa oscura.
export function inkLayer(job) {
  const mode = job.opts.silhouette || 'auto';
  if (mode === 'full') return job.alpha;
  const pal = kmeansPalette(job.src, job.alpha, 2, { seed: job.seed, minShare: 0, mergeDE: 0, w: job.w });
  if (pal.length < 2) return job.alpha;
  const dE = Math.hypot(pal[0].L - pal[1].L, pal[0].A - pal[1].A, pal[0].B - pal[1].B);
  const minShare = Math.min(pal[0].weight, pal[1].weight);
  if (mode === 'auto' && (dE < 24 || minShare < 0.07)) return job.alpha;
  const dark = pal[0].L < pal[1].L ? 1 : 2;
  const labels = quantizeLabels(job.src, job.alpha, pal, 0.35);
  const a = new Float32Array(job.n);
  for (let i = 0; i < job.n; i++) a[i] = labels[i] === dark ? 1 : 0;
  return a;
}

// Máscara binaria limpia con antialias, opcionalmente redondeando detalle menor a `roundMm`.
function cleanAlpha(job, roundMm, { threshold = 0.5, minAreaMm2 = 0, minHoleMm2 = 0, base = null } = {}) {
  const r = Math.max(1, Math.round(px(job, roundMm)));
  let a = smoothMask(base || srcAlpha(job), job.w, job.h, r, threshold);
  if (minAreaMm2 > 0 || minHoleMm2 > 0) {
    const area = 1 / (job.pxMm * job.pxMm);
    cleanMask(a, job.w, job.h, minAreaMm2 * area, minHoleMm2 * area);
    a = smoothMask(a, job.w, job.h, 1, 0.5);
  }
  return a;
}

// Cuantiza a ≤ k colores planos. Devuelve { labels, palette } (labels 1..k, 0 = fondo).
export function posterize(job, alpha, k, { modeIters = 2 } = {}) {
  const { w, h } = job;
  const palette = kmeansPalette(job.src, job.alpha, k, { seed: job.seed, w: job.w });
  let labels = quantizeLabels(job.src, job.alpha, palette, 0.35);
  labels = modeFilter(labels, w, h, palette.length, modeIters);
  // cubrir el borde antialias y apagar lo que quedó afuera
  growLabels(labels, alpha, w, h, 4);
  for (let i = 0; i < labels.length; i++) if (alpha[i] <= 0.001) labels[i] = 0;
  // píxeles con cobertura pero sin etiqueta (islas nuevas): al color dominante
  for (let i = 0; i < labels.length; i++) if (!labels[i] && alpha[i] > 0.001) labels[i] = 1;
  // contar los realmente usados
  const used = new Uint32Array(palette.length + 1);
  for (let i = 0; i < labels.length; i++) used[labels[i]]++;
  return { labels, palette, used };
}

// Corre el registro de cada tinta (salvo la base) unos px: huecos y solapes como en un pulpo mal calibrado.
function misregister(labels, w, h, k, shiftPx, seed) {
  if (shiftPx < 0.5 || k < 2) return labels;
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) if (labels[i] === 1) out[i] = 1;
  for (let c = 2; c <= k; c++) {
    const ang = hash2(c, 3, seed) * Math.PI * 2;
    const dx = Math.round(Math.cos(ang) * shiftPx);
    const dy = Math.round(Math.sin(ang) * shiftPx);
    for (let y = 0; y < h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= h) continue;
      for (let x = 0; x < w; x++) {
        if (labels[y * w + x] !== c) continue;
        const tx = x + dx;
        if (tx < 0 || tx >= w) continue;
        out[ty * w + tx] = c;
      }
    }
  }
  return out;
}

// Píxeles en el límite entre dos colores distintos (no fondo).
function colorBoundaries(labels, w, h) {
  const b = new Float32Array(labels.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = labels[i];
      if (!l) continue;
      const a = labels[i - 1];
      const c = labels[i + 1];
      const d = labels[i - w];
      const e = labels[i + w];
      if ((a && a !== l) || (c && c !== l) || (d && d !== l) || (e && e !== l)) b[i] = 1;
    }
  }
  return b;
}

// Color medio de la fuente dentro de una máscara (para vinilo de un color sin tono elegido).
function meanColor(job, mask) {
  let r = 0;
  let g = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < job.n; i++) {
    if (mask[i] < 0.5 || job.alpha[i] < 0.5) continue;
    const o = i * 4;
    r += job.src[o];
    g += job.src[o + 1];
    b += job.src[o + 2];
    c++;
  }
  return c ? { r: r / c, g: g / c, b: b / c } : { r: 30, g: 30, b: 33 };
}

// Color de "espejo" (F0) para metales: un tono de catálogo es demasiado oscuro como reflectancia;
// se lleva el canal más alto a ~0.95 lineal conservando el matiz (oro → amarillo brillante).
export function metalF0(c, target = 0.95, maxGain = 1.7) {
  const r = LIN[c.r | 0];
  const g = LIN[c.g | 0];
  const b = LIN[c.b | 0];
  const m = Math.max(r, g, b);
  if (m < 0.12) return { ...c };
  const k = Math.min(maxGain, Math.max(1, target / m));
  return { r: linearToSrgb8(r * k), g: linearToSrgb8(g * k), b: linearToSrgb8(b * k) };
}

function rgbOf(hex) {
  const c = hexToRgb(hex || '#ffffff');
  return { r: c.r, g: c.g, b: c.b };
}

function lumOf(c) {
  return (0.2126 * LIN[c.r | 0] + 0.7152 * LIN[c.g | 0] + 0.0722 * LIN[c.b | 0]);
}

// Mezcla en sRGB
function mixC(c, d, t) {
  return { r: c.r + (d.r - c.r) * t, g: c.g + (d.g - c.g) * t, b: c.b + (d.b - c.b) * t };
}

function saturate(c, amount) {
  const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return { r: clamp(l + (c.r - l) * amount, 0, 255), g: clamp(l + (c.g - l) * amount, 0, 255), b: clamp(l + (c.b - l) * amount, 0, 255) };
}

function writeRGB(color, i, r, g, b) {
  const o = i * 4;
  color[o] = r;
  color[o + 1] = g;
  color[o + 2] = b;
  color[o + 3] = 255;
}

// Sube el borde de la meseta en `riseMm` (perfil "ease-out"): 0 afuera, 1 adentro.
function edgeProfile(job, alpha, riseMm) {
  const D = insideDistance(alpha, job.w, job.h);
  const k = job.pxMm / Math.max(1e-4, riseMm);
  const e = new Float32Array(D.length);
  for (let i = 0; i < D.length; i++) {
    const t = Math.min(1, D[i] * k);
    e[i] = t * (2 - t);
  }
  return { e, D };
}

function colorDefaults(job) {
  return job.opts.colors != null ? job.opts.colors : job.tech.maxColors || 4;
}

// ---------------------------------------------------------------------------
// Serigrafía (plastisol)
// ---------------------------------------------------------------------------

export function serigrafia(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const k = clamp(Math.round(colorDefaults(job)), 1, job.tech.maxColors || 4);
  let alpha = cleanAlpha(job, 0.12);
  let { labels, palette, used } = posterize(job, alpha, k, { modeIters: 2 });
  // calidad baja: registro corrido entre tintas
  const imp = 1 - job.quality;
  if (imp > 0.05 && palette.length > 1) {
    labels = misregister(labels, w, h, palette.length, px(job, imp * 1.1), job.seed);
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = labels[i] ? 1 : 0;
    alpha = smoothMask(m, w, h, 1, 0.5);
    growLabels(labels, alpha, w, h, 2);
  }
  const { e } = edgeProfile(job, alpha, 0.16);
  const bnd = blur(colorBoundaries(labels, w, h), w, h, 1, 1);
  const low = fbmNoise(w, h, px(job, 7), 3, job.seed + 1);
  const fine = fbmNoise(w, h, Math.max(1.5, px(job, 0.45)), 2, job.seed + 2);
  const grain = whiteNoise(w, h, job.seed + 3);
  const fab = job.fabricRgb;
  const darkFab = job.fabricLum < 0.25;
  // capa de cada tinta: la base (más área) es la más fina; las de arriba un poco más gruesas
  const layerH = palette.map((_, i) => 0.8 + 0.1 * (palette.length > 1 ? i / (palette.length - 1) : 1));
  const inks = palette.map((p) => {
    let c = { r: p.r, g: p.g, b: p.b };
    // plastisol sobre tela oscura sin base blanca: pierde un poco de brillo
    if (darkFab) c = mixC(c, fab, 0.07);
    return c;
  });
  const relief = job.tech.relief;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    out.alpha[i] = a;
    const l = labels[i];
    if (!l) continue;
    const c = inks[l - 1];
    const dens = 1 + (low[i] - 0.5) * 0.06 + (fine[i] - 0.5) * 0.035;
    writeRGB(out.color, i, c.r * dens, c.g * dens, c.b * dens);
    // meseta plana con borde sutil + leve sobre-espesor donde se solapan tintas (trapping)
    out.Hmm[i] = relief * e[i] * Math.min(1, (layerH[l - 1] + bnd[i] * 0.16) * (0.98 + (low[i] - 0.5) * 0.05));
    out.Dmm[i] = (fine[i] - 0.5) * 0.022 + (grain[i] - 0.5) * 0.006;
    out.rough[i] = 0.56 + (fine[i] - 0.5) * 0.12;
  }
  smoothLabelEdges(out.color, labels, w, h);
  out.Hmm = blur(out.Hmm, w, h, 1, 1);
  out.gain = 1.5;
  out.params = { roughness: 0.56, metalness: 0, clearcoat: 0, normalScale: 1 };
  out.palette = palette.filter((_, i) => used[i + 1] > 0);
  out.labels = labels;
  return out;
}

// ---------------------------------------------------------------------------
// Vinilo textil (corte a plotter)
// ---------------------------------------------------------------------------

export function vinilo(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const maxC = job.tech.maxColors || 3;
  const k = clamp(Math.round(job.opts.colors != null ? job.opts.colors : job.opts.tint ? 1 : maxC), 1, maxC);
  // el plotter redondea lo que es menor a ~0.35 mm y no se pueden "pelar" islas diminutas
  const alpha = cleanAlpha(job, 0.32, { minAreaMm2: 2.5, minHoleMm2: 1.2, base: k === 1 ? inkLayer(job) : null });
  let labels;
  let palette;
  let used;
  if (k === 1) {
    const base = job.opts.tint ? rgbOf(job.opts.tint) : meanColor(job, alpha);
    palette = [{ r: base.r, g: base.g, b: base.b }];
    labels = new Uint8Array(n);
    for (let i = 0; i < n; i++) labels[i] = alpha[i] > 0.001 ? 1 : 0;
    used = [0, 1];
  } else {
    ({ labels, palette, used } = posterize(job, alpha, k, { modeIters: 3 }));
  }
  const { e } = edgeProfile(job, alpha, 0.05);
  const peel = fbmNoise(w, h, px(job, 1.4), 2, job.seed + 4);
  const imprint = fbmNoise(w, h, Math.max(1.5, px(job, 0.55)), 2, job.seed + 5);
  const relief = job.tech.relief;
  // capas apiladas: la de más área va abajo, las demás encima (doble espesor)
  const layer = palette.map((_, i) => (palette.length === 1 ? 1 : i === 0 ? 0.55 : 1));
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    out.alpha[i] = a;
    const l = labels[i];
    if (!l) continue;
    const c = palette[l - 1];
    const v = 1 + (peel[i] - 0.5) * 0.025;
    writeRGB(out.color, i, c.r * v, c.g * v, c.b * v);
    out.Hmm[i] = relief * e[i] * layer[l - 1];
    out.Dmm[i] = (peel[i] - 0.5) * 0.007 + (imprint[i] - 0.5) * 0.007;
    out.rough[i] = 0.33 + (peel[i] - 0.5) * 0.06;
  }
  if (palette.length > 1) smoothLabelEdges(out.color, labels, w, h);
  out.gain = 1.5;
  out.params = { roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3, normalScale: 1 };
  out.palette = palette.filter((_, i) => used[i + 1] > 0);
  out.labels = labels;
  return out;
}

// ---------------------------------------------------------------------------
// DTF (film directo): todo color, film fino
// ---------------------------------------------------------------------------

export function dtf(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const alpha = cleanAlpha(job, 0.05);
  const { e } = edgeProfile(job, alpha, 0.04);
  const grain = blur(whiteNoise(w, h, job.seed + 6), w, h, 1, 1);
  const low = fbmNoise(w, h, px(job, 1.2), 2, job.seed + 7);
  const src = job.src;
  const relief = job.tech.relief;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    out.alpha[i] = a;
    if (a <= 0) continue;
    const o = i * 4;
    // tinta pigmentada sobre base blanca: colores vivos (+saturación, +contraste suave)
    const r = src[o];
    const g = src[o + 1];
    const b = src[o + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    writeRGB(out.color, i, (l + (r - l) * 1.12 - 128) * 1.04 + 128, (l + (g - l) * 1.12 - 128) * 1.04 + 128, (l + (b - l) * 1.12 - 128) * 1.04 + 128);
    out.Hmm[i] = relief * e[i];
    out.Dmm[i] = (grain[i] - 0.5) * 0.012 + (low[i] - 0.5) * 0.005;
    out.rough[i] = 0.44 + (low[i] - 0.5) * 0.06;
  }
  out.gain = 1.3;
  out.params = { roughness: 0.45, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.45, normalScale: 1 };
  out.palette = kmeansPalette(job.src, job.alpha, 8, { seed: job.seed, minShare: 0.01, mergeDE: 9, w: job.w, tries: 1 });
  return out;
}

// ---------------------------------------------------------------------------
// Sublimación: tiñe la fibra (multiplica con la tela), sin relieve
// ---------------------------------------------------------------------------

export function sublimacion(job) {
  const { w, h, n } = job;
  const out = blank(job);
  // la tinta gaseosa se abre apenas: borde suave
  const alpha = blur(srcAlpha(job), w, h, Math.max(1, Math.round(px(job, 0.22))), 2);
  const take = clamp(job.fabric.sublimation ?? 1, 0, 1); // 1 = poliéster
  const wash = 1 - take;
  const blotch = fbmNoise(w, h, px(job, 5), 3, job.seed + 8);
  const F = job.fabricLin;
  const src = job.src;
  for (let i = 0; i < n; i++) {
    let a = alpha[i];
    if (a <= 0.002) continue;
    const o = i * 4;
    // multiplicar en lineal con el color de la tela (el tinte es transparente)
    let r = LIN[src[o]] * F[0];
    let g = LIN[src[o + 1]] * F[1];
    let b = LIN[src[o + 2]] * F[2];
    if (wash > 0) {
      // en algodón casi no toma: desaturado y lavado hacia la tela, con manchas irregulares
      const k = clamp(wash * (0.85 + (blotch[i] - 0.5) * 0.5), 0, 1);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r += (l - r) * k * 0.8;
      g += (l - g) * k * 0.8;
      b += (l - b) * k * 0.8;
      r += (F[0] - r) * k * 0.62;
      g += (F[1] - g) * k * 0.62;
      b += (F[2] - b) * k * 0.62;
    }
    out.alpha[i] = a;
    writeRGB(out.color, i, linearToSrgb8(r), linearToSrgb8(g), linearToSrgb8(b));
    out.rough[i] = job.fabric.roughness ?? 0.85;
  }
  out.gain = 1;
  out.params = {
    roughness: job.fabric.roughness ?? 0.85,
    metalness: 0,
    showWeave: true,
    sheen: (job.fabric.sheen ?? 0.4) * 0.5,
    sheenRoughness: 0.55,
    sheenColor: '#9a9a9a',
    normalScale: 1,
    alphaTest: 0.01,
  };
  out.palette = kmeansPalette(job.src, job.alpha, 8, { seed: job.seed, minShare: 0.01, mergeDE: 9, w: job.w, tries: 1 });
  out.flat = true;
  return out;
}

// ---------------------------------------------------------------------------
// Tinta puff: cúpulas acolchadas, mate, grano de espuma
// ---------------------------------------------------------------------------

export function puff(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const k = clamp(Math.round(colorDefaults(job)), 1, job.tech.maxColors || 2);
  // la tinta se expande hacia los costados y no admite detalle fino
  const alpha = cleanAlpha(job, 0.45, { threshold: 0.4, minAreaMm2: 3, minHoleMm2: 1.5 });
  const { labels, palette, used } = posterize(job, alpha, k, { modeIters: 3 });
  const Dbg = insideDistance(alpha, w, h);
  const Dreg = regionDistance(labels, w, h);
  const low = fbmNoise(w, h, px(job, 4.5), 3, job.seed + 9);
  const pores = fbmNoise(w, h, Math.max(1.2, px(job, 0.32)), 2, job.seed + 10);
  const micro = whiteNoise(w, h, job.seed + 11);
  const R = 2.1; // radio de la cúpula (mm)
  const Rs = 1.4; // radio del pliegue entre colores (mm)
  const dome = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (alpha[i] <= 0) continue;
    const dmm = Dbg[i] * job.pxMm;
    const t = Math.min(1, dmm / R);
    // cuarto de círculo + crecimiento leve en zonas anchas + ondulación del inflado
    let hd = Math.sqrt(1 - (1 - t) * (1 - t)) * 0.84 + 0.16 * Math.min(1, dmm / 7);
    hd *= 0.92 + (low[i] - 0.5) * 0.18;
    // cada color infla por separado: pliegue donde se tocan dos tintas
    const ts = Math.min(1, (Dreg[i] * job.pxMm) / Rs);
    hd *= 0.5 + 0.5 * Math.sqrt(1 - (1 - ts) * (1 - ts));
    dome[i] = hd;
  }
  // redondear con blur (la espuma no tiene aristas)
  const sm = blur(dome, w, h, Math.max(1, Math.round(px(job, 0.28))), 2);
  const inks = palette.map((p) => {
    let c = { r: p.r, g: p.g, b: p.b };
    c = saturate(c, 0.86);
    return mixC(c, { r: 255, g: 252, b: 246 }, 0.17);
  });
  const relief = job.tech.relief;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    out.alpha[i] = a;
    const l = labels[i];
    if (!l) continue;
    const hd = Math.min(1, sm[i] * (a > 0.5 ? 1 : a * 2));
    const c = inks[l - 1];
    // oclusión en la base de la cúpula + grano
    const sh = (0.8 + 0.2 * Math.min(1, hd * 1.4)) * (1 + (pores[i] - 0.5) * 0.06);
    writeRGB(out.color, i, c.r * sh, c.g * sh, c.b * sh);
    out.Hmm[i] = relief * hd;
    // poros de espuma: hoyitos finos
    const pore = pores[i] < 0.34 ? (0.34 - pores[i]) * -0.12 : 0;
    out.Dmm[i] = (pores[i] - 0.5) * 0.03 + pore + (micro[i] - 0.5) * 0.01;
    out.rough[i] = 0.86 + (pores[i] - 0.5) * 0.08;
  }
  if (palette.length > 1) smoothLabelEdges(out.color, labels, w, h);
  out.gain = 1.1;
  out.macroW = 0.8;
  out.params = { roughness: 0.85, metalness: 0, clearcoat: 0, normalScale: 1 };
  out.palette = palette.filter((_, i) => used[i + 1] > 0).map((p, i) => inks[palette.indexOf(p)] || p);
  out.labels = labels;
  return out;
}

// ---------------------------------------------------------------------------
// Vinilo glitter: purpurina con chispas de normal aleatoria
// ---------------------------------------------------------------------------

export function glitter(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const tintHex = job.opts.tint || GLITTER_TINTS[0].hex;
  const tint = metalF0(rgbOf(tintHex), 0.9, 1.5);
  const tl = lumOf(tint);
  const alpha = cleanAlpha(job, 0.3, { minAreaMm2: 2.5, minHoleMm2: 1.2, base: inkLayer(job) });
  const { e } = edgeProfile(job, alpha, 0.06);
  const cell = Math.max(2.2, px(job, 0.42)); // tamaño de cada lentejuela
  const seed = job.seed * 13 + 5;
  const tilt = new Float32Array(n * 2);
  const relief = job.tech.relief;
  // lentejuelas: celdas de Voronoi sobre una grilla con jitter
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const fx = new Float32Array(gw * gh);
  const fy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const c = j * gw + i;
      fx[c] = (i + 0.15 + hash2(i, j, seed) * 0.7) * cell;
      fy[c] = (j + 0.15 + hash2(i, j, seed + 1) * 0.7) * cell;
    }
  }
  const dark = { r: tint.r * 0.32, g: tint.g * 0.32, b: tint.b * 0.32 };
  for (let y = 0; y < h; y++) {
    const cj = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i];
      out.alpha[i] = a;
      if (a <= 0) continue;
      const ci = Math.floor(x / cell);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        if (jj < 0 || jj >= gh) continue;
        for (let ii = ci - 1; ii <= ci + 1; ii++) {
          if (ii < 0 || ii >= gw) continue;
          const c = jj * gw + ii;
          const dx = fx[c] - x;
          const dy = fy[c] - y;
          const dd = dx * dx + dy * dy;
          if (dd < d1) {
            d2 = d1;
            d1 = dd;
            best = c;
          } else if (dd < d2) d2 = dd;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // distancia al borde de la lentejuela (px)
      const r1 = hash2(best, 7, seed);
      const r2 = hash2(best, 11, seed);
      const r3 = hash2(best, 13, seed);
      const r4 = hash2(best, 17, seed);
      const gap = edge < 0.55 ? 1 - edge / 0.55 : 0; // pegamento entre lentejuelas
      // cada lentejuela inclinada al azar (hasta ~35°)
      const ang = r1 * Math.PI * 2;
      const tlt = Math.sqrt(r2) * 0.7 * (1 - gap);
      tilt[i * 2] = Math.cos(ang) * tlt;
      tilt[i * 2 + 1] = Math.sin(ang) * tlt;
      const b = 0.62 + r3 * 0.55;
      let cr = tint.r * b;
      let cg = tint.g * b;
      let cb = tint.b * b;
      // chispa "caliente" (casi blanca) o lentejuela apagada
      const hot = r4 > 0.955 ? (tl < 0.1 ? 0.35 : 0.55) : 0;
      cr += (255 - cr) * hot;
      cg += (250 - cg) * hot;
      cb += (240 - cb) * hot;
      const dk = Math.min(1, (r4 < 0.05 ? 0.6 : 0) + gap * 0.85);
      cr += (dark.r - cr) * dk;
      cg += (dark.g - cg) * dk;
      cb += (dark.b - cb) * dk;
      writeRGB(out.color, i, cr, cg, cb);
      out.Hmm[i] = relief * e[i] * (0.9 + r3 * 0.1);
      out.Dmm[i] = gap * -0.01;
      out.rough[i] = gap > 0.5 ? 0.6 : 0.08 + r2 * 0.22;
      out.metal[i] = gap > 0.5 ? 0.25 : 0.85 + r1 * 0.15;
    }
  }
  out.tilt = tilt;
  out.gain = 1.2;
  out.params = { roughness: 0.2, metalness: 0.9, clearcoat: 0.25, clearcoatRoughness: 0.3, normalScale: 1 };
  out.palette = [rgbOf(tintHex)];
  return out;
}

// ---------------------------------------------------------------------------
// Foil metalizado: espejo con arruguitas, iridiscente si es holográfico
// ---------------------------------------------------------------------------

export function foil(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const tintHex = (job.opts.tint || FOIL_TINTS[0].hex).toLowerCase();
  const holoHex = (FOIL_TINTS.find((t) => t.id === 'holo') || { hex: '#b9a6ff' }).hex.toLowerCase();
  const holo = !!job.opts.holo || tintHex === holoHex;
  const tint = metalF0(rgbOf(tintHex));
  const alpha = cleanAlpha(job, 0.2, { minAreaMm2: 1.2, minHoleMm2: 0.6, base: inkLayer(job) });
  const { e } = edgeProfile(job, alpha, 0.05);
  const n1 = fbmNoise(w, h, px(job, 3.2), 3, job.seed + 12);
  const n2 = fbmNoise(w, h, px(job, 1.1), 2, job.seed + 13);
  const n3 = fbmNoise(w, h, Math.max(1.5, px(job, 0.4)), 2, job.seed + 14);
  const tone = fbmNoise(w, h, px(job, 9), 2, job.seed + 15);
  const relief = job.tech.relief;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    out.alpha[i] = a;
    if (a <= 0) continue;
    // arrugas: ruido "ridged" (crestas finas)
    const r1 = 1 - Math.abs(2 * n1[i] - 1);
    const r2 = 1 - Math.abs(2 * n2[i] - 1);
    const crease = r1 * r1 * r1 * r1;
    // lámina casi espejo: arruguitas suaves + la textura de la tela que se marca al prensar
    out.Dmm[i] = crease * 0.008 + r2 * r2 * r2 * 0.004 + (n3[i] - 0.5) * 0.004;
    out.Hmm[i] = relief * e[i];
    let c;
    if (holo) {
      // bandas de difracción: tono que gira con la posición
      const x = i % w;
      const y = (i / w) | 0;
      const hue = ((x * 0.7 + y * 0.45) * job.pxMm) / 26 + tone[i] * 1.2;
      c = hsv(hue, 0.22, 0.97);
      c = mixC(c, { r: 236, g: 238, b: 246 }, 0.4);
    } else {
      const v = 0.93 + (tone[i] - 0.5) * 0.1 + crease * 0.05;
      c = { r: tint.r * v, g: tint.g * v, b: tint.b * v };
    }
    writeRGB(out.color, i, c.r, c.g, c.b);
    out.rough[i] = 0.13 + (tone[i] - 0.5) * 0.08 + crease * 0.1;
    out.metal[i] = 1;
  }
  out.gain = 1.6;
  out.params = { roughness: 0.15, metalness: 1, clearcoat: 0, normalScale: 1, iridescence: holo ? 1 : 0 };
  out.palette = [rgbOf(tintHex)];
  return out;
}

function hsv(hTurns, s, v) {
  const h = (((hTurns % 1) + 1) % 1) * 6;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const m = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return { r: m[0] * 255, g: m[1] * 255, b: m[2] * 255 };
}

// ---------------------------------------------------------------------------
// Pintura textil a mano: pinceladas con cerdas en la dirección del trazo
// ---------------------------------------------------------------------------

export function pintura(job) {
  const { w, h, n } = job;
  const out = blank(job);
  const src = job.src;
  // dirección de los trazos: tensor de estructura de la luminancia (+ alpha), calculado a media
  // resolución (el campo es suave); en zonas lisas manda un campo de ruido de baja frecuencia
  const hw = Math.max(2, w >> 1);
  const hh = Math.max(2, h >> 1);
  const hn = hw * hh;
  const L = new Float32Array(hn);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const i = Math.min(h - 1, y * 2) * w + Math.min(w - 1, x * 2);
      const o = i * 4;
      const al = job.alpha[i];
      L[y * hw + x] = ((0.3 * src[o] + 0.59 * src[o + 1] + 0.11 * src[o + 2]) / 255) * al + al * 0.6;
    }
  }
  const Ls = blur(L, hw, hh, Math.max(1, Math.round(px(job, 0.35) / 2)), 1);
  const jxx = new Float32Array(hn);
  const jxy = new Float32Array(hn);
  for (let y = 1; y < hh - 1; y++) {
    for (let x = 1; x < hw - 1; x++) {
      const i = y * hw + x;
      const gx = Ls[i + 1] - Ls[i - 1];
      const gy = Ls[i + hw] - Ls[i - hw];
      jxx[i] = gx * gx - gy * gy;
      jxy[i] = 2 * gx * gy;
    }
  }
  const tr = Math.max(1, Math.round(px(job, 2.2) / 2));
  const bx = blur(jxx, hw, hh, tr, 2);
  const by = blur(jxy, hw, hh, tr, 2);
  const field = valueNoise(hw, hh, px(job, 18) / 2, job.seed + 16);
  const hdx = new Float32Array(hn);
  const hdy = new Float32Array(hn);
  let maxM = 1e-9;
  for (let i = 0; i < hn; i++) maxM = Math.max(maxM, Math.abs(bx[i]) + Math.abs(by[i]));
  const eps = maxM * 0.06;
  for (let i = 0; i < hn; i++) {
    const fa = field[i] * Math.PI * 4;
    const vx = bx[i] + Math.cos(fa) * eps;
    const vy = by[i] + Math.sin(fa) * eps;
    // ángulo doble → dirección del gradiente; el trazo va perpendicular (a lo largo del borde)
    const th = 0.5 * Math.atan2(vy, vx) + Math.PI / 2;
    hdx[i] = Math.cos(th);
    hdy[i] = Math.sin(th);
  }
  const dirX = new Float32Array(n);
  const dirY = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const hy = Math.min(hh - 1, y >> 1) * hw;
    for (let x = 0; x < w; x++) {
      const j = hy + Math.min(hw - 1, x >> 1);
      dirX[y * w + x] = hdx[j];
      dirY[y * w + x] = hdy[j];
    }
  }
  // cerdas: integral de línea (LIC) de ruido blanco a lo largo del trazo
  const wn = whiteNoise(w, h, job.seed + 17);
  const wn2 = blur(wn, w, h, 1, 1);
  // largo del trazo integrado ~±2.4 mm con pasos de 1.5 px
  const steps = Math.max(3, Math.min(8, Math.round(px(job, 2.4) / 1.5)));
  const bristle = new Float32Array(n);
  const alpha0 = blur(job.alpha, w, h, 1, 1);
  const norm = Math.sqrt(steps * 2 + 1) * 0.9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha0[i] <= 0.01) continue;
      const dx = dirX[i] * 1.5;
      const dy = dirY[i] * 1.5;
      let s = wn2[i];
      let c = 1;
      let ax = x + 0.5;
      let ay = y + 0.5;
      let bx = x + 0.5;
      let by = y + 0.5;
      for (let t = 1; t <= steps; t++) {
        ax += dx;
        ay += dy;
        bx -= dx;
        by -= dy;
        const xa = ax | 0;
        const ya = ay | 0;
        const xb = bx | 0;
        const yb = by | 0;
        if (ax >= 0 && xa < w && ay >= 0 && ya < h) {
          s += wn2[ya * w + xa];
          c++;
        }
        if (bx >= 0 && xb < w && by >= 0 && yb < h) {
          s += wn2[yb * w + xb];
          c++;
        }
      }
      // reescalar contraste (el promedio achica la varianza)
      const v = (s / c - 0.5) * norm + 0.5;
      bristle[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  // borde orgánico: umbral modulado por ruido y por las cerdas (pincel seco en los bordes)
  const edgeN = fbmNoise(w, h, px(job, 1.6), 3, job.seed + 18);
  const alpha = new Float32Array(n);
  const a1 = blur(job.alpha, w, h, Math.max(1, Math.round(px(job, 0.3))), 2);
  for (let i = 0; i < n; i++) {
    const v = (a1[i] + (edgeN[i] - 0.5) * 0.42 + (bristle[i] - 0.5) * 0.5 - 0.5) * 3.2 + 0.5;
    alpha[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  const D = insideDistance(alpha, w, h);
  const thick = fbmNoise(w, h, px(job, 4), 2, job.seed + 19);
  const fab = job.fabricRgb;
  const relief = job.tech.relief;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    out.alpha[i] = a;
    if (a <= 0) continue;
    const o = i * 4;
    const sl = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
    let cr = sl + (src[o] - sl) * 1.06;
    let cg = sl + (src[o + 1] - sl) * 1.06;
    let cb = sl + (src[o + 2] - sl) * 1.06;
    const dmm = D[i] * job.pxMm;
    // la pintura se acumula un poquito en el borde del trazo
    const ridge = dmm < 0.9 ? Math.sin(Math.min(1, dmm / 0.9) * Math.PI) : 0;
    const th = 0.45 + 0.3 * (thick[i] - 0.5) * 2 + 0.25 * ridge;
    // donde la capa es fina (valles de las cerdas, poca carga) se transparenta la tela
    const thin = clamp((1 - bristle[i]) * 0.26 + (0.5 - thick[i]) * 0.16 + (dmm < 0.6 ? (0.6 - dmm) * 0.2 : 0), 0, 0.42);
    cr += (fab.r - cr) * thin;
    cg += (fab.g - cg) * thin;
    cb += (fab.b - cb) * thin;
    const sh = 0.9 + bristle[i] * 0.18;
    writeRGB(out.color, i, cr * sh, cg * sh, cb * sh);
    out.Hmm[i] = relief * clamp(th + (bristle[i] - 0.5) * 0.35, 0, 1) * Math.min(1, dmm / 0.25 + 0.15);
    out.Dmm[i] = (bristle[i] - 0.5) * 0.07;
    out.rough[i] = 0.55 + (1 - bristle[i]) * 0.2;
  }
  out.Hmm = blur(out.Hmm, w, h, 1, 1);
  out.gain = 1.4;
  out.params = { roughness: 0.62, metalness: 0, clearcoat: 0, normalScale: 1 };
  out.palette = kmeansPalette(job.src, job.alpha, 8, { seed: job.seed, minShare: 0.01, mergeDE: 9, w: job.w, tries: 1 });
  return out;
}
