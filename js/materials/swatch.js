// Miniaturas de tela para la UI: una muestra iluminada de costado, con una onda
// suave para que la luz revele el relieve del tejido. Se renderiza en CPU a 2x y
// se reduce (antialias). La parte cara (muestreo del tejido + iluminación) se
// cachea por tejido: cambiar de color solo re-tiñe.

import { clamp } from '../core/utils.js';
import { WEAVE_DEFS, albedoFactor, equalize, ALL, runJob } from './weaves.js';

const bases = new Map();

// Luz principal desde arriba a la izquierda, rasante; relleno suave desde la derecha.
const KEY = norm3([-0.62, 0.52, 0.58]);
const FILL = norm3([0.7, -0.2, 0.68]);
const HALF = norm3([KEY[0], KEY[1], KEY[2] + 1]);

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Superficie macro: una onda diagonal suave + un pliegue más chico (alto en
// unidades del ancho de la muestra). Devuelve la pendiente [du, dv].
function foldSlope(u, v, out) {
  const p1 = 2 * Math.PI * (0.85 * u + 0.6 * v) + 0.9;
  const p2 = 2 * Math.PI * (-0.5 * u + 1.25 * v) + 2.2;
  const a1 = 0.075;
  const a2 = 0.03;
  out[0] = a1 * 2 * Math.PI * 0.85 * Math.cos(p1) + a2 * 2 * Math.PI * -0.5 * Math.cos(p2);
  out[1] = a1 * 2 * Math.PI * 0.6 * Math.cos(p1) + a2 * 2 * Math.PI * 1.25 * Math.cos(p2);
  return out;
}

// Borde dentado (tijera zigzag): cobertura 0..1 para el píxel (u, v en 0..1).
function pinkedCoverage(u, v, S) {
  const teeth = 9;
  const amp = 0.035;
  const margin = 0.02;
  const tri = (t) => Math.abs(((t * teeth) % 1) - 0.5) * 2; // 0..1
  const dl = u - margin - amp * tri(v);
  const dr = 1 - u - margin - amp * tri(v);
  const db = v - margin - amp * tri(u);
  const dt = 1 - v - margin - amp * tri(u);
  const d = Math.min(dl, dr, db, dt) * S;
  return clamp(d + 0.5);
}

// Lado interno (2x) con el que se renderiza una miniatura de `size` px.
export const swatchInternalSize = (size) => Math.min(512, Math.max(32, Math.round(size * 2)));

function getBase(weave, S, pinked) {
  return bases.get(`${weave}|${S}|${pinked}`) || runJob(swatchBaseJob(weave, S, pinked));
}

// Generador (con `yield` cada tanto) que arma y cachea la base de una miniatura;
// se puede correr de una o en segundo plano (precarga).
export function* swatchBaseJob(weave, S, pinked = false) {
  const key = `${weave}|${S}|${pinked}`;
  let b = bases.get(key);
  if (b) return b;
  const def = WEAVE_DEFS[weave];
  const sample = def.make();
  const o = { h: 0, tone: 1, fiber: 0, gap: 0 };
  const n = S * S;
  const H = new Float32Array(n);
  const TONE = new Float32Array(n);
  const GAP = new Float32Array(n);
  const FIB = new Float32Array(n);
  const span = def.swatchTiles;
  let mn = Infinity;
  let mx = -Infinity;
  for (let py = 0; py < S; py++) {
    const y = (1 - (py + 0.5) / S) * span + 0.31;
    for (let px = 0; px < S; px++) {
      sample(((px + 0.5) / S) * span + 0.17, y, 64, o, ALL);
      const k = py * S + px;
      H[k] = o.h;
      TONE[k] = o.tone;
      GAP[k] = o.gap;
      FIB[k] = o.fiber;
      if (o.h < mn) mn = o.h;
      if (o.h > mx) mx = o.h;
    }
    if (py % 24 === 23) yield;
  }
  const sp = mx - mn || 1;
  for (let k = 0; k < n; k++) H[k] = (H[k] - mn) / sp;
  equalize(FIB);

  // normal (macro + detalle) y términos de iluminación por píxel
  const D = new Float32Array(n); // difuso
  const G = new Float32Array(n); // rasante (sheen)
  const P = new Float32Array(n); // especular (sin exponente: guardo N·H)
  const NL = new Float32Array(n);
  const GRAY = new Float32Array(n);
  const ALPHA = new Float32Array(n);
  const slope = [0, 0];
  // pendiente del detalle: relief (tiles) * dH/dx (por tile); dx de un píxel = span / S tiles
  const k = (def.relief * def.normalScale * 1.25) / (2 * (span / S));
  const fo = { tone: 1, gap: 0 };
  for (let py = 0; py < S; py++) {
    const ym = Math.max(0, py - 1) * S;
    const yp = Math.min(S - 1, py + 1) * S;
    const v = 1 - (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const i = py * S + px;
      const xm = Math.max(0, px - 1);
      const xp = Math.min(S - 1, px + 1);
      const u = (px + 0.5) / S;
      foldSlope(u, v, slope);
      // en el canvas la y crece hacia abajo: pendiente en v = -(abajo - arriba)
      const dhx = (H[py * S + xp] - H[py * S + xm]) * k;
      const dhy = -(H[yp + px] - H[ym + px]) * k;
      let nx = -(slope[0] + dhx);
      let ny = -(slope[1] + dhy);
      let nz = 1;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= il;
      ny *= il;
      nz *= il;
      const ndl = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
      const ndf = nx * FILL[0] + ny * FILL[1] + nz * FILL[2];
      const wrap = Math.max(0, (ndl + 0.2) / 1.2);
      // viñeta suave de foto de estudio
      const cx = u - 0.42;
      const cy = v - 0.58;
      const vig = 1 - 0.28 * (cx * cx + cy * cy);
      D[i] = (0.3 + 0.86 * wrap + 0.16 * Math.max(0, ndf)) * vig;
      G[i] = Math.pow(1 - nz, 1.6) * (0.35 + 0.9 * wrap) * vig;
      NL[i] = Math.max(0, ndl) * vig;
      P[i] = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
      fo.tone = TONE[i];
      fo.gap = GAP[i];
      GRAY[i] = albedoFactor(def, H[i], fo);
      ALPHA[i] = pinked ? pinkedCoverage(u, v, S) : 1;
    }
    if (py % 48 === 47) yield;
  }
  // normalizo el gris como en las texturas (crestas ≈ 1)
  let gMax = 0;
  for (let i = 0; i < n; i++) if (GRAY[i] > gMax) gMax = GRAY[i];
  for (let i = 0; i < n; i++) GRAY[i] = Math.min(1, GRAY[i] / (gMax * 0.985));
  b = { S, D, G, P, NL, GRAY, FIB, ALPHA };
  bases.set(key, b);
  return b;
}

// Compresión suave de altas luces (para que el blanco no se queme).
const shoulder = (x) => (x < 0.82 ? x : 0.82 + (x - 0.82) / (1 + (x - 0.82) / 0.18));

export function renderSwatch({ weave, color, tones, sheen, sheenColor, roughness, specular, size, pinked, encode, heatherPixel }) {
  const S = swatchInternalSize(size);
  const b = getBase(WEAVE_DEFS[weave] ? weave : 'jersey', S, !!pinked);
  const n = S * S;
  const rgb = new Float32Array(n * 3);
  // brillo especular tipo Blinn-Phong según la rugosidad del catálogo
  const r4 = Math.max(1e-3, Math.pow(roughness, 4));
  const shin = Math.max(1, 2 / r4 - 2);
  const ks = specular * 0.04 * ((shin + 2) / 8) * 1.4;
  const sh = sheen * 0.55;
  const px = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const g = b.GRAY[i];
    let ar;
    let ag;
    let ab;
    if (tones) {
      heatherPixel(tones, b.FIB[i], g, px);
      ar = px[0];
      ag = px[1];
      ab = px[2];
    } else {
      ar = color[0] * g;
      ag = color[1] * g;
      ab = color[2] * g;
    }
    const d = b.D[i];
    const gs = b.G[i] * sh;
    const sp = ks * Math.pow(b.P[i], shin) * b.NL[i];
    const q = i * 3;
    rgb[q] = ar * d + sheenColor[0] * gs + sp;
    rgb[q + 1] = ag * d + sheenColor[1] * gs + sp;
    rgb[q + 2] = ab * d + sheenColor[2] * gs + sp;
  }
  // reducción 2x → tamaño final
  const out = document.createElement('canvas');
  const W = Math.floor(S / 2);
  out.width = W;
  out.height = W;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(W, W);
  const dd = img.data;
  const A = b.ALPHA;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const k0 = (y * 2) * S + x * 2;
      const k1 = k0 + 1;
      const k2 = k0 + S;
      const k3 = k2 + 1;
      const a0 = A[k0];
      const a1 = A[k1];
      const a2 = A[k2];
      const a3 = A[k3];
      const r = rgb[k0 * 3] * a0 + rgb[k1 * 3] * a1 + rgb[k2 * 3] * a2 + rgb[k3 * 3] * a3;
      const g = rgb[k0 * 3 + 1] * a0 + rgb[k1 * 3 + 1] * a1 + rgb[k2 * 3 + 1] * a2 + rgb[k3 * 3 + 1] * a3;
      const bl = rgb[k0 * 3 + 2] * a0 + rgb[k1 * 3 + 2] * a1 + rgb[k2 * 3 + 2] * a2 + rgb[k3 * 3 + 2] * a3;
      const a = a0 + a1 + a2 + a3;
      const o = (y * W + x) * 4;
      const inv = a > 0 ? 1 / a : 0;
      dd[o] = encode(shoulder(r * inv));
      dd[o + 1] = encode(shoulder(g * inv));
      dd[o + 2] = encode(shoulder(bl * inv));
      dd[o + 3] = Math.round((a / 4) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
