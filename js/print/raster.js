// Herramientas de raster para el motor de estampado: todo con typed arrays
// (sin WebGL). Distancias, desenfoques, ruido rápido, cuantización de color,
// filtros de etiquetas y mapas de normales.

import { rng } from '../core/utils.js';

// ---------------------------------------------------------------------------
// Canvas <-> datos
// ---------------------------------------------------------------------------

export function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

export function ctx2d(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true });
}

export function readRGBA(canvas) {
  return ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

// Crea un canvas a partir de un Uint8ClampedArray RGBA.
export function rgbaToCanvas(data, w, h) {
  const c = newCanvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return c;
}

// Canvas gris (R=G=B) a partir de un Float32Array 0..1.
export function grayToCanvas(f, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, o = 0; i < f.length; i++, o += 4) {
    const v = f[i] * 255;
    out[o] = out[o + 1] = out[o + 2] = v;
    out[o + 3] = 255;
  }
  return rgbaToCanvas(out, w, h);
}

// ---------------------------------------------------------------------------
// Desenfoques
// ---------------------------------------------------------------------------

// Box blur separable (devuelve un array nuevo). radius en px (entero). La pasada vertical usa
// acumuladores por columna (recorre por filas: mucho más amigable con la caché).
export function blur(src, w, h, radius, passes = 1) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return new Float32Array(src);
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  const col = new Float32Array(w);
  const inv = 1 / (2 * r + 1);
  const wm = w - 1;
  const hm = h - 1;
  for (let p = 0; p < passes; p++) {
    // horizontal a → b
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = a[row] * (r + 1);
      for (let x = 1; x <= r; x++) acc += a[row + (x > wm ? wm : x)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv;
        const xo = x - r;
        const xi = x + r + 1;
        acc += a[row + (xi > wm ? wm : xi)] - a[row + (xo < 0 ? 0 : xo)];
      }
    }
    // vertical b → a
    for (let x = 0; x < w; x++) col[x] = b[x] * (r + 1);
    for (let y = 1; y <= r; y++) {
      const row = (y > hm ? hm : y) * w;
      for (let x = 0; x < w; x++) col[x] += b[row + x];
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const yo = y - r;
      const yi = y + r + 1;
      const ro = (yo < 0 ? 0 : yo) * w;
      const ri = (yi > hm ? hm : yi) * w;
      for (let x = 0; x < w; x++) {
        a[row + x] = col[x] * inv;
        col[x] += b[ri + x] - b[ro + x];
      }
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// Transformada de distancia euclídea exacta (Felzenszwalb & Huttenlocher)
// ---------------------------------------------------------------------------

const INF = 1e20;

function edt1d(f, n, d, v, z, arg) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
    if (arg) arg[q] = v[k];
  }
}

// Distancia (px) de cada píxel al píxel "semilla" más cercano (seed[i] = 1).
// Si `feature` es un Int32Array, guarda el índice de la semilla más cercana.
export function distanceTo(seed, w, h, feature = null) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const arg = new Int32Array(n);
  const g = new Float64Array(w * h);
  const fy = feature ? new Int32Array(w * h) : null;
  // columnas
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = seed[y * w + x] ? 0 : INF;
    edt1d(f, h, d, v, z, fy ? arg : null);
    for (let y = 0; y < h; y++) {
      g[y * w + x] = d[y];
      if (fy) fy[y * w + x] = arg[y];
    }
  }
  // filas
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = g[row + x];
    edt1d(f, w, d, v, z, feature ? arg : null);
    for (let x = 0; x < w; x++) {
      out[row + x] = Math.sqrt(d[x]);
      if (feature) {
        const qx = arg[x];
        feature[row + x] = fy[row + qx] * w + qx;
      }
    }
  }
  return out;
}

// Distancia interior: para cada píxel dentro de la máscara, distancia al exterior.
export function insideDistance(mask, w, h, threshold = 0.5) {
  const seed = new Uint8Array(w * h);
  for (let i = 0; i < seed.length; i++) seed[i] = mask[i] < threshold ? 1 : 0;
  return distanceTo(seed, w, h);
}

// ---------------------------------------------------------------------------
// Ruido rápido (retícula interpolada) y hash
// ---------------------------------------------------------------------------

export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Ruido de valor suave (0..1) con celdas de `cell` px, en un Float32Array w*h.
export function valueNoise(w, h, cell, seed = 1) {
  cell = Math.max(1, cell);
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const r = rng(seed * 7919 + 13);
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const out = new Float32Array(w * h);
  const xi = new Int32Array(w);
  const xt = new Float32Array(w);
  // desfase aleatorio para que octavas distintas no coincidan en la grilla
  const ox = r() * cell;
  const oy = r() * cell;
  for (let x = 0; x < w; x++) {
    const fx = (x + ox) / cell;
    const i = Math.floor(fx);
    const t = fx - i;
    xi[x] = i;
    xt[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < h; y++) {
    const fy = (y + oy) / cell;
    const j = Math.floor(fy);
    let t = fy - j;
    t = t * t * (3 - 2 * t);
    const r0 = j * gw;
    const r1 = r0 + gw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = xi[x];
      const u = xt[x];
      const a = grid[r0 + i];
      const b = grid[r0 + i + 1];
      const c = grid[r1 + i];
      const d = grid[r1 + i + 1];
      const top = a + (b - a) * u;
      const bot = c + (d - c) * u;
      out[row + x] = top + (bot - top) * t;
    }
  }
  return out;
}

// fBm: suma de octavas de valueNoise. Devuelve 0..1 aprox.
export function fbmNoise(w, h, cell, octaves = 3, seed = 1, gain = 0.5) {
  const out = new Float32Array(w * h);
  let amp = 1;
  let norm = 0;
  let c = cell;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(w, h, c, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= gain;
    c = Math.max(1, c / 2);
  }
  const inv = 1 / norm;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

// Ruido blanco por píxel (0..1).
export function whiteNoise(w, h, seed = 1) {
  const out = new Float32Array(w * h);
  const r = rng(seed * 31 + 7);
  for (let i = 0; i < out.length; i++) out[i] = r();
  return out;
}

// ---------------------------------------------------------------------------
// Color: sRGB → Lab, k-means y cuantización
// ---------------------------------------------------------------------------

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export const SRGB_TO_LINEAR = LIN;

export function linearToSrgb8(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  return (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(r, g, b, out) {
  const R = LIN[r | 0];
  const G = LIN[g | 0];
  const B = LIN[b | 0];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = labF(X);
  const fy = labF(Y);
  const fz = labF(Z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}

// k-means sobre los colores de las zonas "lisas" del diseño (se descartan los píxeles de borde /
// antialias). Trabaja sobre un histograma de 15 bits y pondera cada color por cantidad^power, así
// un detalle chico pero bien distinto (un sol, un texto) consigue su propia tinta.
// Devuelve paleta [{r,g,b,L,A,B,weight}] ordenada por peso (fracción real de píxeles).
export function kmeansPalette(data, alpha, k, { seed = 3, minShare = 0.012, mergeDE = 7, power = 0.6, w = 0, tries = 4 } = {}) {
  const n = alpha.length;
  const W = w || Math.round(Math.sqrt(n));
  const cnt = new Uint32Array(32768);
  const sr = new Float32Array(32768);
  const sg = new Float32Array(32768);
  const sb = new Float32Array(32768);
  let total = 0;
  for (let pass = 0; pass < 2 && !total; pass++) {
    for (let i = 0; i < n; i++) {
      if (alpha[i] <= 0.5) continue;
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (pass === 0) {
        // saltear píxeles de transición (antialias entre colores)
        const j = i + 1 < n ? (i + 1) * 4 : o;
        const q = i + W < n ? (i + W) * 4 : o;
        const dj = Math.abs(r - data[j]) + Math.abs(g - data[j + 1]) + Math.abs(b - data[j + 2]);
        const dq = Math.abs(r - data[q]) + Math.abs(g - data[q + 1]) + Math.abs(b - data[q + 2]);
        if (dj > 60 || dq > 60) continue;
      }
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      cnt[key]++;
      sr[key] += r;
      sg[key] += g;
      sb[key] += b;
      total++;
    }
  }
  if (!total) return [{ r: 0, g: 0, b: 0, L: 0, A: 0, B: 0, weight: 1 }];
  // muestras = bins no vacíos
  const S = [];
  const lab = [0, 0, 0];
  for (let key = 0; key < 32768; key++) {
    const c = cnt[key];
    if (!c) continue;
    const r = sr[key] / c;
    const g = sg[key] / c;
    const b = sb[key] / c;
    rgbToLab(r, g, b, lab);
    S.push(lab[0], lab[1], lab[2], r, g, b, Math.pow(c, power), c);
  }
  const ST = 8;
  const m = S.length / ST;
  k = Math.max(1, Math.min(k, m));
  // varias inicializaciones: se queda con la de menor error ponderado
  let best = null;
  if (k <= 1) tries = 1;
  for (let tr = 0; tr < tries; tr++) {
    const res = kmeansRun(S, ST, m, k, seed + tr * 101);
    if (!best || res.err < best.err) best = res;
  }
  const { C, acc } = best;
  const pal = [];
  for (let c = 0; c < k; c++) {
    const a = c * 8;
    if (!acc[a + 7]) continue;
    pal.push({ r: acc[a + 3] / acc[a + 7], g: acc[a + 4] / acc[a + 7], b: acc[a + 5] / acc[a + 7], L: C[c * 3], A: C[c * 3 + 1], B: C[c * 3 + 2], weight: acc[a + 7] / total });
  }
  // descartar grupos chiquitos y fusionar casi iguales
  pal.sort((p, q) => q.weight - p.weight);
  const keep = [];
  for (const p of pal) {
    const near = keep.find((q) => Math.hypot(p.L - q.L, p.A - q.A, p.B - q.B) < mergeDE);
    if (near) {
      const t = p.weight / (near.weight + p.weight);
      near.r += (p.r - near.r) * t;
      near.g += (p.g - near.g) * t;
      near.b += (p.b - near.b) * t;
      near.weight += p.weight;
      continue;
    }
    if (p.weight < minShare && keep.length) continue;
    keep.push({ ...p });
  }
  return keep;
}

function kmeansRun(S, ST, m, k, seed) {
  const rnd = rng(seed);
  const C = new Float64Array(k * 3);
  // k-means++ ponderado (determinístico)
  let wsum = 0;
  for (let i = 0; i < m; i++) wsum += S[i * ST + 6];
  let t0 = rnd() * wsum;
  let first = 0;
  for (let i = 0; i < m; i++) {
    t0 -= S[i * ST + 6];
    if (t0 <= 0) {
      first = i;
      break;
    }
  }
  C[0] = S[first * ST];
  C[1] = S[first * ST + 1];
  C[2] = S[first * ST + 2];
  const dist = new Float64Array(m).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const dl = S[i * ST] - C[(c - 1) * 3];
      const da = S[i * ST + 1] - C[(c - 1) * 3 + 1];
      const db = S[i * ST + 2] - C[(c - 1) * 3 + 2];
      const d2 = dl * dl + da * da + db * db;
      if (d2 < dist[i]) dist[i] = d2;
      sum += dist[i] * S[i * ST + 6];
    }
    let t = rnd() * sum;
    let pick = m - 1;
    for (let i = 0; i < m; i++) {
      t -= dist[i] * S[i * ST + 6];
      if (t <= 0) {
        pick = i;
        break;
      }
    }
    C[c * 3] = S[pick * ST];
    C[c * 3 + 1] = S[pick * ST + 1];
    C[c * 3 + 2] = S[pick * ST + 2];
  }
  const assign = new Int32Array(m).fill(-1);
  const acc = new Float64Array(k * 8);
  for (let it = 0; it < 20; it++) {
    acc.fill(0);
    let moved = 0;
    for (let i = 0; i < m; i++) {
      const o = i * ST;
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = S[o] - C[c * 3];
        const da = S[o + 1] - C[c * 3 + 1];
        const db = S[o + 2] - C[c * 3 + 2];
        const d2 = dl * dl + da * da + db * db;
        if (d2 < bd) {
          bd = d2;
          best = c;
        }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
      const a = best * 8;
      const wt = S[o + 6];
      const cn = S[o + 7];
      acc[a] += S[o] * wt;
      acc[a + 1] += S[o + 1] * wt;
      acc[a + 2] += S[o + 2] * wt;
      acc[a + 3] += S[o + 3] * cn;
      acc[a + 4] += S[o + 4] * cn;
      acc[a + 5] += S[o + 5] * cn;
      acc[a + 6] += wt;
      acc[a + 7] += cn;
    }
    for (let c = 0; c < k; c++) {
      const a = c * 8;
      if (!acc[a + 6]) continue;
      C[c * 3] = acc[a] / acc[a + 6];
      C[c * 3 + 1] = acc[a + 1] / acc[a + 6];
      C[c * 3 + 2] = acc[a + 2] / acc[a + 6];
    }
    if (it > 2 && !moved) break;
  }
  // error ponderado final
  let err = 0;
  for (let i = 0; i < m; i++) {
    const o = i * ST;
    const c = assign[i];
    err += S[o + 6] * ((S[o] - C[c * 3]) ** 2 + (S[o + 1] - C[c * 3 + 1]) ** 2 + (S[o + 2] - C[c * 3 + 2]) ** 2);
  }
  return { C, acc, err };
}

// Asigna a cada píxel opaco (alpha > thr) el índice+1 del color de paleta más cercano (Lab).
// Devuelve Uint8Array de etiquetas (0 = fondo). Usa una LUT de 15 bits.
export function quantizeLabels(data, alpha, palette, thr = 0.5) {
  const n = alpha.length;
  const labels = new Uint8Array(n);
  const lut = new Uint8Array(32768).fill(255);
  const P = palette.map((p) => {
    const lab = rgbToLab(Math.round(p.r), Math.round(p.g), Math.round(p.b), [0, 0, 0]);
    return lab;
  });
  const lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (alpha[i] <= thr) continue;
    const o = i * 4;
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
    let l = lut[key];
    if (l === 255) {
      rgbToLab(((data[o] >> 3) << 3) + 4, ((data[o + 1] >> 3) << 3) + 4, ((data[o + 2] >> 3) << 3) + 4, lab);
      let bd = Infinity;
      l = 0;
      for (let c = 0; c < P.length; c++) {
        const d = (lab[0] - P[c][0]) ** 2 + (lab[1] - P[c][1]) ** 2 + (lab[2] - P[c][2]) ** 2;
        if (d < bd) {
          bd = d;
          l = c;
        }
      }
      lut[key] = l;
    }
    labels[i] = l + 1;
  }
  return labels;
}

// Filtro de moda 3x3 sobre etiquetas no nulas (limpia antialias y motas). `iters` pasadas.
// Los píxeles con etiqueta 0 se mantienen en 0; los no nulos toman la etiqueta no nula más frecuente.
export function modeFilter(labels, w, h, k, iters = 1) {
  let a = labels;
  const counts = new Int32Array(k + 1);
  for (let it = 0; it < iters; it++) {
    const b = new Uint8Array(a);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const c0 = a[i];
        if (!c0) continue;
        // vecindario uniforme: no cambia (la gran mayoría de los píxeles)
        if (a[i - 1] === c0 && a[i + 1] === c0 && a[i - w] === c0 && a[i + w] === c0 && a[i - w - 1] === c0 && a[i - w + 1] === c0 && a[i + w - 1] === c0 && a[i + w + 1] === c0) continue;
        counts.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const r = i + dy * w;
          counts[a[r - 1]]++;
          counts[a[r]]++;
          counts[a[r + 1]]++;
        }
        let best = a[i];
        let bc = counts[best];
        for (let c = 1; c <= k; c++) {
          if (counts[c] > bc) {
            bc = counts[c];
            best = c;
          }
        }
        b[i] = best;
      }
    }
    a = b;
  }
  return a;
}

// Extiende etiquetas a píxeles con cobertura (alpha > 0) que quedaron en 0.
export function growLabels(labels, alpha, w, h, iters = 3) {
  const a = labels;
  for (let it = 0; it < iters; it++) {
    let changed = 0;
    const b = new Uint8Array(a);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (a[i] || alpha[i] <= 0.001) continue;
        let l = 0;
        if (x > 0 && a[i - 1]) l = a[i - 1];
        else if (x < w - 1 && a[i + 1]) l = a[i + 1];
        else if (y > 0 && a[i - w]) l = a[i - w];
        else if (y < h - 1 && a[i + w]) l = a[i + w];
        if (l) {
          b[i] = l;
          changed++;
        }
      }
    }
    a.set(b);
    if (!changed) break;
  }
  return a;
}

// Componentes conexas (4-vecinos) de etiquetas no nulas. Devuelve { comp: Int32Array, count, sizes }.
export function components(labels, w, h) {
  const comp = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const sizes = [];
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i] || comp[i] >= 0) continue;
    const l = labels[i];
    let sp = 0;
    stack[sp++] = i;
    comp[i] = count;
    let size = 0;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w;
      if (x > 0 && comp[p - 1] < 0 && labels[p - 1] === l) {
        comp[p - 1] = count;
        stack[sp++] = p - 1;
      }
      if (x < w - 1 && comp[p + 1] < 0 && labels[p + 1] === l) {
        comp[p + 1] = count;
        stack[sp++] = p + 1;
      }
      if (p >= w && comp[p - w] < 0 && labels[p - w] === l) {
        comp[p - w] = count;
        stack[sp++] = p - w;
      }
      if (p < labels.length - w && comp[p + w] < 0 && labels[p + w] === l) {
        comp[p + w] = count;
        stack[sp++] = p + w;
      }
    }
    sizes.push(size);
    count++;
  }
  return { comp, count, sizes };
}

// Distancia (px) de cada píxel con etiqueta al borde de su región (otra etiqueta o fondo).
// El borde real está entre píxeles, por eso se suma 0.5.
export function regionDistance(labels, w, h) {
  const n = w * h;
  const seed = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i];
      if (!l) {
        seed[i] = 1;
        continue;
      }
      if ((x > 0 && labels[i - 1] !== l) || (x < w - 1 && labels[i + 1] !== l) || (y > 0 && labels[i - w] !== l) || (y < h - 1 && labels[i + w] !== l)) seed[i] = 1;
    }
  }
  const D = distanceTo(seed, w, h);
  for (let i = 0; i < n; i++) if (labels[i]) D[i] += 0.5;
  return D;
}

// Antialias entre regiones de colores distintos: en los píxeles de límite promedia el color 3x3
// (solo entre píxeles con etiqueta), así los bordes entre tintas no quedan escalonados.
export function smoothLabelEdges(rgba, labels, w, h) {
  const src = new Uint8ClampedArray(rgba);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = labels[i];
      if (!l) continue;
      const a = labels[i - 1];
      const b = labels[i + 1];
      const c = labels[i - w];
      const d = labels[i + w];
      if (!((a && a !== l) || (b && b !== l) || (c && c !== l) || (d && d !== l))) continue;
      let r = 0;
      let g = 0;
      let bb = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          if (!labels[j]) continue;
          const wt = dx === 0 && dy === 0 ? 2 : 1;
          r += src[j * 4] * wt;
          g += src[j * 4 + 1] * wt;
          bb += src[j * 4 + 2] * wt;
          k += wt;
        }
      }
      const o = i * 4;
      rgba[o] = r / k;
      rgba[o + 1] = g / k;
      rgba[o + 2] = bb / k;
    }
  }
  return rgba;
}

// Elimina islas (componentes de máscara binaria) más chicas que minArea px. Opcionalmente rellena agujeros chicos.
export function cleanMask(mask, w, h, minArea, minHole = 0) {
  const lab = new Uint8Array(w * h);
  for (let i = 0; i < lab.length; i++) lab[i] = mask[i] > 0.5 ? 1 : 0;
  const { comp, sizes } = components(lab, w, h);
  for (let i = 0; i < lab.length; i++) if (lab[i] && sizes[comp[i]] < minArea) mask[i] = 0;
  if (minHole > 0) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < inv.length; i++) inv[i] = mask[i] > 0.5 ? 0 : 1;
    const holes = components(inv, w, h);
    // los agujeros que tocan el borde son fondo, no agujeros
    const touches = new Uint8Array(holes.count);
    for (let x = 0; x < w; x++) {
      if (inv[x]) touches[holes.comp[x]] = 1;
      const b = (h - 1) * w + x;
      if (inv[b]) touches[holes.comp[b]] = 1;
    }
    for (let y = 0; y < h; y++) {
      const a = y * w;
      if (inv[a]) touches[holes.comp[a]] = 1;
      if (inv[a + w - 1]) touches[holes.comp[a + w - 1]] = 1;
    }
    for (let i = 0; i < inv.length; i++) if (inv[i] && !touches[holes.comp[i]] && holes.sizes[holes.comp[i]] < minHole) mask[i] = 1;
  }
  return mask;
}

// Suaviza una máscara binaria y la re-afila con un borde antialias de ~1.2 px.
// radius = desenfoque previo (redondea esquinas y elimina detalle menor al radio).
export function smoothMask(alpha, w, h, radius, threshold = 0.5) {
  const r = Math.max(1, Math.round(radius));
  const b = blur(alpha, w, h, r, 2);
  // tras 2 pasadas de caja la pendiente máxima del escalón es 1 / (2r + 1): re-afilar a ~1.3 px
  const k = (2 * r + 1) / 1.3;
  const out = new Float32Array(alpha.length);
  for (let i = 0; i < out.length; i++) {
    const v = (b[i] - threshold) * k + 0.5;
    out[i] = v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normales
// ---------------------------------------------------------------------------

// Normal map (OpenGL, Y arriba) desde una altura en mm. `pxMm` = tamaño de píxel en mm,
// `gain` = exageración. Devuelve Uint8ClampedArray RGBA. Si `tilt` (Float32Array 2n) viene,
// suma pendientes extra (para chispas de glitter, etc.).
export function normalsFromHeight(Hmm, w, h, pxMm, gain = 1, tilt = null) {
  const out = new Uint8ClampedArray(w * h * 4);
  const k = gain / (2 * pxMm);
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : w - 1;
      const i = y * w + x;
      let dx = (Hmm[y * w + xr] - Hmm[y * w + xl]) * k;
      // canvas: y crece hacia abajo; tangente +Y = arriba de la textura
      let dy = (Hmm[yd * w + x] - Hmm[yu * w + x]) * k;
      if (tilt) {
        dx += tilt[i * 2];
        dy += tilt[i * 2 + 1];
      }
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = i * 4;
      out[o] = (-dx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Copia el color de los píxeles cubiertos hacia un anillo transparente de `ring` px con alpha mínimo
// (evita el halo oscuro al filtrar la textura: el canvas guarda alpha premultiplicado).
export function bleedEdges(rgba, w, h, ring = 2, ringAlpha = 4) {
  const n = w * h;
  let filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
  for (let it = 0; it < ring; it++) {
    const next = new Uint8Array(filled);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!filled[j]) continue;
            r += rgba[j * 4];
            g += rgba[j * 4 + 1];
            b += rgba[j * 4 + 2];
            c++;
          }
        }
        if (!c) continue;
        const o = i * 4;
        rgba[o] = r / c;
        rgba[o + 1] = g / c;
        rgba[o + 2] = b / c;
        rgba[o + 3] = ringAlpha;
        next[i] = 1;
      }
    }
    filled = next;
  }
  return rgba;
}
