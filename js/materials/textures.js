// Texturas de tejido (normal, rugosidad, albedo, jaspeado y capa macro) con
// generación PROGRESIVA: al pedir un tejido por primera vez las texturas nacen
// "lisas" con el promedio correcto (tono y rugosidad medios, ver meanGray y
// meanRough en weaves.js) y la versión completa se calcula en segundo plano, repartida en
// tramos de ~8 ms, y se copia sobre las MISMAS texturas (mismo tamaño: no hay que
// recompilar ni re-crear materiales). Así elegir una tela nueva nunca congela la
// pantalla; el detalle del tejido aparece unos instantes después.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { WEAVE_DEFS, weaveJob, generateWeave, pnoise } from './weaves.js';
import { buildMipChain } from './mipmaps.js';
import { encodeSrgb, heatherTones, heatherPixel } from './color.js';

export const ANISOTROPY = 8;
const SLICE_MS = 8; // tiempo máximo por tramo de trabajo en segundo plano

// ---------------------------------------------------------------------------
// Cola de trabajo en segundo plano (generadores que hacen `yield` seguido)
// ---------------------------------------------------------------------------
const queue = [];
let scheduled = false;

function pump() {
  scheduled = false;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < SLICE_MS) {
    const job = queue[0];
    let r;
    try {
      r = job.it.next();
    } catch (err) {
      console.error('[telas] error generando texturas', err);
      queue.shift();
      job.resolve(null);
      continue;
    }
    if (r.done) {
      queue.shift();
      job.resolve(r.value);
    }
  }
  if (queue.length) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(pump, 0);
}

export function enqueue(it) {
  const job = { it, resolve: null, promise: null };
  job.promise = new Promise((res) => (job.resolve = res));
  queue.push(job);
  schedule();
  return job;
}

// Termina un trabajo encolado en el momento (sincrónico).
function finishNow(job) {
  const i = queue.indexOf(job);
  if (i < 0) return;
  queue.splice(i, 1);
  let r = job.it.next();
  while (!r.done) r = job.it.next();
  job.resolve(r.value);
}

// Promesa que se resuelve cuando no queda nada por generar.
export function texturesReady() {
  return Promise.all(queue.map((j) => j.promise)).then(() => (queue.length ? texturesReady() : undefined));
}

// ---------------------------------------------------------------------------
// DataTextures
// ---------------------------------------------------------------------------
const clonesOf = new WeakMap(); // textura base → Set de clones (comparten imagen)

// Llena un RGBA8 con un color constante (rápido: vista de 32 bits).
function fillRGBA(data, rgb) {
  const px = new Uint8Array([rgb[0], rgb[1], rgb[2], 255]);
  new Uint32Array(data.buffer, data.byteOffset, data.length >> 2).fill(new Uint32Array(px.buffer)[0]);
  return data;
}

function makeTexture(size, colorSpace, repeat, name, fill) {
  const data = fillRGBA(new Uint8Array(size * size * 4), fill);
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = name;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = ANISOTROPY;
  t.colorSpace = colorSpace;
  t.repeat.set(repeat, repeat);
  t.userData.shared = true;
  t.needsUpdate = true;
  return t;
}

// Clon que comparte la imagen (se le puede cambiar repeat/offset) y que se
// actualiza junto con la base cuando llega la versión completa.
export function shareTexture(base) {
  const c = base.clone();
  c.userData = { shared: true };
  c.needsUpdate = true;
  let set = clonesOf.get(base);
  if (!set) clonesOf.set(base, (set = new Set()));
  set.add(c);
  return c;
}

// Copia `bytes` (tamaño completo) en la textura y arma los mipmaps filtrados
// (anti-moiré). También actualiza los clones que comparten la imagen.
function fillTexture(tex, bytes, kind) {
  const size = tex.image.width;
  const dst = tex.image.data;
  if (bytes !== dst) dst.set(bytes);
  tex.mipmaps = buildMipChain(dst, size, kind);
  syncTexture(tex);
}

// Textura "lisa" de un color (mientras se genera la versión completa).
function flatTexture(tex, rgb) {
  fillRGBA(tex.image.data, rgb);
  tex.mipmaps = [];
  syncTexture(tex);
}

function syncTexture(tex) {
  tex.generateMipmaps = tex.mipmaps.length === 0;
  tex.needsUpdate = true;
  const set = clonesOf.get(tex);
  if (set) {
    for (const c of set) {
      c.mipmaps = tex.mipmaps;
      c.generateMipmaps = tex.generateMipmaps;
      c.needsUpdate = true;
    }
  }
}

// Gris (lineal) → RGBA sRGB.
function grayToRGBA(gray, A) {
  const out = new Uint8Array(A * A * 4);
  for (let k = 0; k < gray.length; k++) {
    const v = encodeSrgb(gray[k]);
    const q = k * 4;
    out[q] = v;
    out[q + 1] = v;
    out[q + 2] = v;
    out[q + 3] = 255;
  }
  return out;
}

// Jaspeado: tonos de fibra mezclados según el campo de fibras, por la oclusión.
function heatherRGBA(d, hex) {
  const tones = heatherTones(hex);
  const A = d.A;
  const out = new Uint8Array(A * A * 4);
  const px = [0, 0, 0];
  for (let k = 0; k < d.gray.length; k++) {
    heatherPixel(tones, d.fiber[k], d.gray[k], px);
    const q = k * 4;
    out[q] = encodeSrgb(px[0]);
    out[q + 1] = encodeSrgb(px[1]);
    out[q + 2] = encodeSrgb(px[2]);
    out[q + 3] = 255;
  }
  return out;
}

// Color medio (sRGB 0..255) del jaspeado, para la textura lisa provisoria.
function heatherMean(hex, grayMean) {
  const tones = heatherTones(hex);
  const px = [0, 0, 0];
  const acc = [0, 0, 0];
  for (let i = 0; i < 32; i++) {
    heatherPixel(tones, (i + 0.5) / 32, grayMean, px);
    for (let c = 0; c < 3; c++) acc[c] += px[c] / 32;
  }
  return acc.map(encodeSrgb);
}

// ---------------------------------------------------------------------------
// Estado por tejido
// ---------------------------------------------------------------------------
const states = new Map();

function applyFull(st, d) {
  st.data = d;
  fillTexture(st.tex.normal, d.normal, 'normal');
  fillTexture(st.tex.rough, d.rough, 'linear');
  fillTexture(st.tex.albedo, grayToRGBA(d.gray, d.A), 'srgb');
  for (const [hex, t] of st.heathers) fillTexture(t, heatherRGBA(d, hex), 'srgb');
  st.full = true;
}

function* refineJob(st) {
  const d = yield* weaveJob(st.weave);
  yield;
  st.data = d;
  fillTexture(st.tex.normal, d.normal, 'normal');
  yield;
  fillTexture(st.tex.rough, d.rough, 'linear');
  yield;
  fillTexture(st.tex.albedo, grayToRGBA(d.gray, d.A), 'srgb');
  for (const [hex, t] of st.heathers) {
    yield;
    fillTexture(t, heatherRGBA(d, hex), 'srgb');
  }
  st.full = true;
  st.job = null;
  for (const fn of st.onFull) fn(st);
  st.onFull.length = 0;
  return st;
}

// Devuelve el estado de un tejido (creándolo si hace falta). `sync` = generar ya
// la versión completa (p. ej. en la pantalla de carga).
export function getWeaveState(weave, { sync = false } = {}) {
  let st = states.get(weave);
  if (!st) {
    const def = WEAVE_DEFS[weave];
    const size = def.size;
    const rep = 1 / def.tile;
    st = {
      weave,
      def,
      size,
      data: null,
      full: false,
      job: null,
      heathers: new Map(),
      onFull: [], // callbacks a llamar cuando llega la versión completa
      tex: {
        normal: makeTexture(size, THREE.NoColorSpace, rep, `tela-normal-${weave}`, [128, 128, 255]),
        rough: makeTexture(size, THREE.NoColorSpace, rep, `tela-rugosidad-${weave}`, [235, 235, 235]),
        albedo: makeTexture(size, THREE.SRGBColorSpace, rep / def.albedoTiles, `tela-albedo-${weave}`, [245, 245, 245]),
      },
    };
    states.set(weave, st);
    if (sync) {
      applyFull(st, generateWeave(weave));
    } else {
      // texturas lisas con el tono y la rugosidad medios del tejido (sin saltos
      // cuando llega el detalle)
      st.data = { roughMean: def.meanRough, grayMean: def.meanGray, A: size };
      const r = Math.round(def.meanRough * 255);
      const g = encodeSrgb(def.meanGray);
      flatTexture(st.tex.rough, [r, r, r]);
      flatTexture(st.tex.albedo, [g, g, g]);
      st.job = enqueue(refineJob(st));
    }
  } else if (sync && st.job) {
    finishNow(st.job);
  }
  return st;
}

// Llama a fn(st) cuando el tejido tenga su versión completa (o ya, si la tiene).
export function whenWeaveFull(st, fn) {
  if (st.full) fn(st);
  else st.onFull.push(fn);
}

// Textura de jaspeado de un tejido en un color (se refina junto con el tejido).
export function getHeatherTexture(weave, hex) {
  const st = getWeaveState(weave);
  let t = st.heathers.get(hex);
  if (!t) {
    const def = st.def;
    t = makeTexture(st.size, THREE.SRGBColorSpace, 1 / (def.tile * def.albedoTiles), `tela-jaspeado-${weave}-${hex}`, [200, 200, 200]);
    st.heathers.set(hex, t);
    if (st.full) fillTexture(t, heatherRGBA(st.data, hex), 'srgb');
    else flatTexture(t, heatherMean(hex, st.data.grayMean)); // se completa con el tejido
  }
  return t;
}

// ---------------------------------------------------------------------------
// Capa "macro": variación suave de tono a escala de varios centímetros (nubes de
// teñido, barré de pasadas, vetas de hilo en el lino). Período MACRO_SIZE metros:
// así la tela no se ve perfectamente pareja de lejos y la repetición del tile
// chico no se nota. R = nubes, G = barré horizontal, B = vetas de hilo.
// ---------------------------------------------------------------------------
export const MACRO_SIZE = 0.45;
let macroTex = null;

// Ruido periódico evaluado en una grilla gruesa (nu x nv) para muestrearlo después
// con interpolación bilineal: cada canal se calcula a la resolución que necesita.
function noiseGrid(nu, nv, fn) {
  const g = new Float32Array(nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) g[j * nu + i] = fn(i / nu, j / nv);
  return { g, nu, nv };
}
function sampleGrid(G, u, v) {
  const nu = G.nu;
  const nv = G.nv;
  const g = G.g;
  const x = u * nu;
  const y = v * nv;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i0 = x0 % nu;
  const i1 = (x0 + 1) % nu;
  const j0 = (y0 % nv) * nu;
  const j1 = ((y0 + 1) % nv) * nu;
  const a = g[j0 + i0] + (g[j0 + i1] - g[j0 + i0]) * fx;
  const b = g[j1 + i0] + (g[j1 + i1] - g[j1 + i0]) * fx;
  return a + (b - a) * fy;
}

function* macroJob(tex) {
  const S = tex.image.width;
  const nubes = noiseGrid(64, 64, (u, v) => 0.5 * pnoise(u * 4, v * 4, 4, 4, 101) + 0.3 * pnoise(u * 8, v * 8, 8, 8, 102) + 0.2 * pnoise(u * 16, v * 16, 16, 16, 103));
  yield;
  const barre = noiseGrid(32, 256, (u, v) => 0.6 * pnoise(u * 3, v * 56, 3, 56, 104) + 0.4 * pnoise(u * 5, v * 110, 5, 110, 105));
  yield;
  const vetasV = noiseGrid(256, 32, (u, v) => pnoise(u * 120, v * 5, 120, 5, 106));
  const vetasH = noiseGrid(32, 256, (u, v) => pnoise(u * 5, v * 120, 5, 120, 107));
  yield;
  const ch = [new Float32Array(S * S), new Float32Array(S * S), new Float32Array(S * S)];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const k = y * S + x;
      ch[0][k] = sampleGrid(nubes, u, v);
      ch[1][k] = sampleGrid(barre, u, v);
      ch[2][k] = 0.5 * sampleGrid(vetasV, u, v) + 0.5 * sampleGrid(vetasH, u, v);
    }
    if (y % 32 === 31) yield;
  }
  // normalizo cada canal: media 0.5, desvío 0.18
  const data = new Uint8Array(S * S * 4);
  for (let c = 0; c < 3; c++) {
    const a = ch[c];
    let m = 0;
    for (let k = 0; k < a.length; k++) m += a[k];
    m /= a.length;
    let sd = 0;
    for (let k = 0; k < a.length; k++) sd += (a[k] - m) ** 2;
    sd = Math.sqrt(sd / a.length) || 1;
    const kk = 0.18 / sd;
    for (let k = 0; k < a.length; k++) data[k * 4 + c] = Math.round(clamp(0.5 + (a[k] - m) * kk) * 255);
  }
  for (let k = 0; k < S * S; k++) data[k * 4 + 3] = 255;
  yield;
  fillTexture(tex, data, 'linear');
}

export function getMacroTexture() {
  if (!macroTex) {
    // arranca neutra (sin variación) y se completa en segundo plano
    macroTex = makeTexture(256, THREE.NoColorSpace, 1, 'tela-macro', [128, 128, 128]);
    enqueue(macroJob(macroTex));
  }
  return macroTex;
}
