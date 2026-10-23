// Texturas procedurales del taller (canvas 2D): madera, piso de tablones, revoque,
// friso, base de corte, corcho, funda de tabla, mimbre, cartón, metal cepillado,
// tambor perforado, sprites suaves y helpers de texto. Todo se genera una vez y se cachea.
// Convención: las uv de las mallas están en METROS, así que cada textura trae
// `repeat = 1 / tamaño del tile (m)`.

import * as THREE from 'three';
import { makeCanvas, heightToNormalCanvas, clamp, lerp, hexToRgb, rng } from '../../core/utils.js';

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// Ruido tileable con períodos independientes en X e Y
// ---------------------------------------------------------------------------

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// x, y en celdas; px, py = período en celdas.
export function tnoise(x, y, px, py, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// fBm tileable: u, v en [0,1); px, py = celdas de la primera octava.
export function tfbm(u, v, px, py, oct = 4, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let i = 0; i < oct; i++) {
    sum += amp * tnoise(u * fx, v * fy, fx, fy, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

// Campo de ruido suave evaluado en una grilla gruesa (1 de cada `step` px) y
// reconstruido con interpolación bilineal tileable: mucho más rápido para las capas
// de baja frecuencia. Devuelve sample(x, y) en píxeles.
function coarseField(W, H, step, fn) {
  const cw = Math.ceil(W / step);
  const ch = Math.ceil(H / step);
  const F = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) F[j * cw + i] = fn(i / cw, j / ch);
  return (x, y) => {
    const fx = (x / W) * cw;
    const fy = (y / H) * ch;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const tx = fx - i0;
    const ty = fy - j0;
    const i1 = (i0 + 1) % cw;
    const j1 = (j0 + 1) % ch;
    const a = F[j0 * cw + i0];
    const b = F[j0 * cw + i1];
    const c = F[j1 * cw + i0];
    const d = F[j1 * cw + i1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// ---------------------------------------------------------------------------
// Helpers de textura
// ---------------------------------------------------------------------------

export function canvasTexture(canvas, { srgb = true, tile = null, repeat = null, wrap = true, aniso = 8, flipY = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (tile) t.repeat.set(1 / (Array.isArray(tile) ? tile[0] : tile), 1 / (Array.isArray(tile) ? tile[1] : tile));
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.flipY = flipY;
  t.userData.shared = true;
  t.needsUpdate = true;
  return t;
}

// Escribe un Float32Array (0..1) como canvas gris.
function grayCanvas(F, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = clamp(F[i], 0, 1) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function rgbCanvas(R, G, B, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = clamp(R[i], 0, 255);
    img.data[i * 4 + 1] = clamp(G[i], 0, 255);
    img.data[i * 4 + 2] = clamp(B[i], 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const mixc = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });

// ---------------------------------------------------------------------------
// Madera (veta a lo largo de u)
// ---------------------------------------------------------------------------

const WOODS = {
  roble: { light: '#c8a273', dark: '#94693f', rings: 22, warp: 1.6, tile: 0.9, rough: 0.55, seed: 3, contrast: 0.7 },
  nogal: { light: '#7d573b', dark: '#3f2a1b', rings: 18, warp: 1.8, tile: 0.8, rough: 0.5, seed: 11, contrast: 0.75 },
  pino: { light: '#e2c79f', dark: '#b98c5c', rings: 12, warp: 1.4, tile: 1.0, rough: 0.62, seed: 21, contrast: 0.65 },
  haya: { light: '#e0bf98', dark: '#c09068', rings: 26, warp: 1.2, tile: 0.8, rough: 0.5, seed: 31, contrast: 0.45 },
};

const fract = (x) => x - Math.floor(x);
const sstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// Capas suaves de la veta (espaciado de anillos, ondulación y manchas) en grilla gruesa.
function woodFields(P, W, H) {
  return {
    n1: coarseField(W, H, 4, (u, v) => tfbm(u, v, 1, 3, 3, P.seed) - 0.5),
    n2: coarseField(W, H, 4, (u, v) => tfbm(u, v, 2, 2, 3, P.seed + 5) - 0.5),
    blotch: coarseField(W, H, 4, (u, v) => tfbm(u, v, 3, 2, 3, P.seed + 40)),
  };
}

// Valor de veta 0..1 (1 = oscuro) en el píxel (x, y) de una textura W×H tileable
// (u = a lo largo de la veta). Anillos de ancho irregular (leño temprano claro y una
// línea fina de leño tardío), con contraste variable de anillo a anillo, manchas y poros.
function woodValue(x, y, W, H, P, Fd, phase = 0) {
  const u = x / W;
  const v = y / H;
  const t = v * P.rings + Fd.n1(x, y) * P.rings * 0.18 + Fd.n2(x, y) * P.warp + phase;
  const s = fract(t);
  const ringId = Math.floor(t);
  const amp = 0.35 + 0.65 * hash2(((ringId % P.rings) + P.rings) % P.rings, 7, P.seed);
  const late = sstep(0.68, 0.9, s) * (1 - sstep(0.93, 1.0, s));
  const grad = s * 0.35;
  const pores = tnoise(u * 48, v * 480, 48, 480, P.seed + 9);
  const pore = pores > 0.78 ? (pores - 0.78) * 2.5 : 0;
  return clamp((late * 0.8 + grad * 0.3) * amp + Fd.blotch(x, y) * 0.25 + pore * 0.35 - 0.08, 0, 1);
}

export function woodTextures(kind = 'roble') {
  return cached(`madera-${kind}`, () => {
    const P = WOODS[kind] || WOODS.roble;
    const W = 512;
    const H = 512;
    const R = new Float32Array(W * H);
    const G = new Float32Array(W * H);
    const B = new Float32Array(W * H);
    const Ht = new Float32Array(W * H);
    const Ro = new Float32Array(W * H);
    const L = hexToRgb(P.light);
    const D = hexToRgb(P.dark);
    const Fd = woodFields(P, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const f = woodValue(x, y, W, H, P, Fd);
        const c = mixc(L, D, clamp(f * P.contrast + 0.08, 0, 1));
        const i = y * W + x;
        R[i] = c.r;
        G[i] = c.g;
        B[i] = c.b;
        Ht[i] = 1 - f;
        Ro[i] = clamp(P.rough + f * 0.16 - 0.04, 0, 1);
      }
    }
    // la textura cubre `tile` metros a lo largo de la veta y lo mismo a lo ancho
    const tile = [P.tile, P.tile * 0.6];
    return {
      map: canvasTexture(rgbCanvas(R, G, B, W, H), { tile }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, W, H, 0.9, true), { srgb: false, tile }),
      roughnessMap: canvasTexture(grayCanvas(Ro, W, H), { srgb: false, tile }),
    };
  });
}

// ---------------------------------------------------------------------------
// Piso de tablones (tile de 2.4 × 2.4 m, tablas de 15 cm a lo largo de X)
// ---------------------------------------------------------------------------

export const FLOOR_TILE = 2.4;

export function floorTextures() {
  return cached('piso', () => {
    const S = 768;
    const rows = 14;
    const rowH = S / rows;
    const r = rng(42);
    const P = { ...WOODS.roble, rings: 70, warp: 3, seed: 5 };
    const L = hexToRgb('#a87b50');
    const D = hexToRgb('#62402a');
    const Fd = woodFields(P, S, S);
    const bigF = coarseField(S, S, 8, (u, v) => tfbm(u, v, 4, 4, 3, 77) - 0.5);
    // juntas por fila (en fracción del ancho)
    const layouts = [[1], [0.5, 0.5], [0.62, 0.38], [0.7, 0.3], [0.45, 0.55], [0.8, 0.2], [1]];
    const rowsInfo = [];
    for (let j = 0; j < rows; j++) {
      const lay = layouts[Math.floor(r() * layouts.length)];
      const off = r();
      const planks = [];
      let acc = off;
      for (const len of lay) {
        planks.push({ start: acc, len, tone: r() - 0.5, phase: r() * 10, hue: r() - 0.5 });
        acc += len;
      }
      rowsInfo.push(planks);
    }
    const R = new Float32Array(S * S);
    const G = new Float32Array(S * S);
    const B = new Float32Array(S * S);
    const Ht = new Float32Array(S * S);
    const Ro = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      const j = Math.floor(y / rowH);
      const inRow = (y - j * rowH) / rowH; // 0..1 a lo ancho de la tabla
      const planks = rowsInfo[j];
      const edgeY = Math.min(inRow, 1 - inRow) * rowH; // px al borde largo
      for (let x = 0; x < S; x++) {
        const u = x / S;
        // ¿qué tabla? (con wrap)
        let pk = planks[0];
        let dEnd = 1e9;
        for (const p of planks) {
          let du = (u - p.start) % 1;
          if (du < 0) du += 1;
          if (du < p.len) {
            pk = p;
            dEnd = Math.min(du, p.len - du) * S;
            break;
          }
        }
        const f = woodValue(x, y, S, S, P, Fd, pk.phase);
        const big = bigF(x, y);
        let c = mixc(L, D, clamp(0.22 + f * 0.75 + pk.tone * 0.4 + big * 0.25, 0, 1));
        // leve variación de tono (algunas tablas más rojizas)
        c = { r: c.r * (1 + pk.hue * 0.06), g: c.g, b: c.b * (1 - pk.hue * 0.06) };
        // juntas
        const edge = Math.min(edgeY, dEnd);
        const groove = edge < 0.6 ? 1 : edge < 1.5 ? 1 - (edge - 0.6) / 0.9 : 0;
        const bevel = clamp(edge / 3, 0, 1);
        const shade = 1 - groove * 0.32 - (1 - bevel) * 0.06;
        const i = y * S + x;
        R[i] = c.r * shade;
        G[i] = c.g * shade;
        B[i] = c.b * shade;
        Ht[i] = 0.35 + 0.65 * Math.sqrt(bevel) - f * 0.05;
        Ro[i] = clamp(0.4 + f * 0.12 + groove * 0.3 + big * 0.18 + Math.abs(pk.tone) * 0.12, 0, 1);
      }
    }
    const tile = FLOOR_TILE;
    return {
      map: canvasTexture(rgbCanvas(R, G, B, S, S), { tile, aniso: 16 }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, S, S, 2.2, true), { srgb: false, tile, aniso: 16 }),
      roughnessMap: canvasTexture(grayCanvas(Ro, S, S), { srgb: false, tile, aniso: 16 }),
    };
  });
}

// ---------------------------------------------------------------------------
// Revoque de pared y friso machimbrado
// ---------------------------------------------------------------------------

export function plasterTextures() {
  return cached('revoque', () => {
    const S = 384;
    const Ht = new Float32Array(S * S);
    const T = new Float32Array(S * S);
    const tone = coarseField(S, S, 6, (u, v) => tfbm(u, v, 3, 3, 4, 93));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const i = y * S + x;
        Ht[i] = tfbm(u, v, 32, 32, 3, 91) * 0.7 + tnoise(u * 96, v * 96, 96, 96, 92) * 0.3;
        T[i] = 0.5 + (tone(x, y) - 0.5) * 0.9;
      }
    }
    const tile = 1.6;
    // el color base lo pone el material (map en gris claro para variar el tono)
    const R = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) R[i] = 0.9 + (T[i] - 0.5) * 0.12;
    return {
      map: canvasTexture(grayCanvas(R, S, S), { tile }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, S, S, 1.2, true), { srgb: false, tile }),
    };
  });
}

// Machimbre vertical pintado (tablas de 10 cm). Tile 0.8 m × 0.8 m.
export function beadboardTextures() {
  return cached('friso', () => {
    const W = 256;
    const H = 256;
    const boards = 8;
    const bw = W / boards;
    const Ht = new Float32Array(W * H);
    const T = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const lx = x % bw;
        const d = Math.min(lx, bw - lx);
        const groove = d < 1.5 ? 0 : d < 4 ? (d - 1.5) / 2.5 : 1;
        const bead = Math.abs(lx - bw / 2) < 1 ? 0.6 : 1; // perlita central
        const grain = tnoise((x / W) * 8, (y / H) * 2, 8, 2, 5) * 0.08;
        const i = y * W + x;
        Ht[i] = groove * bead - grain;
        T[i] = 0.92 - (1 - groove) * 0.35 + (bead < 1 ? -0.05 : 0) + grain * 0.5;
      }
    }
    const tile = 0.8;
    return {
      map: canvasTexture(grayCanvas(T, W, H), { tile }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, W, H, 2.5, true), { srgb: false, tile }),
    };
  });
}

// ---------------------------------------------------------------------------
// Base de corte verde cuadriculada (textura única, no repetida)
// ---------------------------------------------------------------------------

export function cuttingMatTexture(wm = 1.96, hm = 1.26) {
  return cached(`base-corte-${wm}x${hm}`, () => {
    const ppm = 1000; // px por metro (1 cm = 10 px)
    const W = Math.round(wm * ppm);
    const H = Math.round(hm * ppm);
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    // base verde con leve moteado
    ctx.fillStyle = '#2f7756';
    ctx.fillRect(0, 0, W, H);
    const r = rng(9);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.03})`;
      ctx.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
    }
    const m = 30; // margen (3 cm)
    const line = (x0, y0, x1, y1, wpx, a) => {
      ctx.strokeStyle = `rgba(232,245,236,${a})`;
      ctx.lineWidth = wpx;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    for (let x = m, k = 0; x <= W - m + 0.5; x += 10, k++) {
      const major = k % 10 === 0;
      const mid = k % 5 === 0;
      line(x, m, x, H - m, major ? 2.2 : mid ? 1.4 : 0.8, major ? 0.7 : mid ? 0.5 : 0.28);
    }
    for (let y = m, k = 0; y <= H - m + 0.5; y += 10, k++) {
      const major = k % 10 === 0;
      const mid = k % 5 === 0;
      line(m, y, W - m, y, major ? 2.2 : mid ? 1.4 : 0.8, major ? 0.7 : mid ? 0.5 : 0.28);
    }
    // diagonales de 45° y 60° desde la esquina inferior izquierda
    ctx.setLineDash([14, 10]);
    line(m, H - m, m + (H - 2 * m), m, 1.4, 0.4);
    line(m, H - m, m + (H - 2 * m) / Math.tan((60 * Math.PI) / 180), m, 1.2, 0.32);
    line(W - m, H - m, W - m - (H - 2 * m), m, 1.4, 0.4);
    ctx.setLineDash([]);
    // números cada 10 cm (arriba e izquierda)
    ctx.fillStyle = 'rgba(232,245,236,0.8)';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = m, k = 0; x <= W - m + 0.5; x += 100, k += 10) {
      ctx.fillText(String(k), x, m / 2);
      ctx.fillText(String(k), x, H - m / 2);
    }
    for (let y = m, k = 0; y <= H - m + 0.5; y += 100, k += 10) {
      ctx.fillText(String(k), m / 2, y);
      ctx.fillText(String(k), W - m / 2, y);
    }
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = 'rgba(232,245,236,0.55)';
    ctx.fillText('BASE DE CORTE AUTORREGENERABLE · cm', W / 2, H - m - 22);
    return canvasTexture(c, { wrap: false, aniso: 16 });
  });
}

// ---------------------------------------------------------------------------
// Corcho
// ---------------------------------------------------------------------------

export function corkTextures() {
  return cached('corcho', () => {
    const S = 256;
    const R = new Float32Array(S * S);
    const G = new Float32Array(S * S);
    const B = new Float32Array(S * S);
    const Ht = new Float32Array(S * S);
    const base = hexToRgb('#b98a5a');
    const dark = hexToRgb('#7a5332');
    const light = hexToRgb('#d6ab78');
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const n1 = tnoise(u * 64, v * 64, 64, 64, 3);
        const n2 = tnoise(u * 128, v * 128, 128, 128, 4);
        const n3 = tfbm(u, v, 8, 8, 2, 6);
        let c = base;
        if (n1 > 0.72) c = mixc(base, dark, (n1 - 0.72) * 3);
        else if (n2 > 0.75) c = mixc(base, light, (n2 - 0.75) * 3);
        c = mixc(c, dark, (n3 - 0.5) * 0.4 + 0.1);
        const i = y * S + x;
        R[i] = c.r;
        G[i] = c.g;
        B[i] = c.b;
        Ht[i] = 1 - n1 * 0.6 - n2 * 0.4;
      }
    }
    const tile = 0.3;
    return {
      map: canvasTexture(rgbCanvas(R, G, B, S, S), { tile }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, S, S, 2.0, true), { srgb: false, tile }),
    };
  });
}

// ---------------------------------------------------------------------------
// Funda de tabla de planchar (estampado retro de hojitas). Tile 0.3 m.
// ---------------------------------------------------------------------------

export function ironCoverTexture() {
  return cached('funda', () => {
    const S = 512;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#efe5d2';
    ctx.fillRect(0, 0, S, S);
    const r = rng(17);
    const colors = ['#c46a45', '#5f9a8f', '#d4a33b', '#8fb5a3'];
    const leaf = (x, y, s, a, col) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.7, 0, 0, s);
      ctx.quadraticCurveTo(-s * 0.7, 0, 0, -s);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.8);
      ctx.lineTo(0, s * 0.8);
      ctx.stroke();
      ctx.restore();
    };
    // grilla con jitter, dibujada con wrap para que sea tileable
    const n = 7;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5 + (j % 2) * 0.5) / n) * S + (r() - 0.5) * 18;
        const y = ((j + 0.5) / n) * S + (r() - 0.5) * 18;
        const col = colors[(i + j * 3) % colors.length];
        const a = r() * Math.PI * 2;
        const s = 13 + r() * 6;
        for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
          leaf(x + dx, y + dy, s, a, col);
          ctx.fillStyle = 'rgba(70,60,50,0.55)';
          ctx.beginPath();
          ctx.arc(x + dx + 22, y + dy + 14, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    return canvasTexture(c, { tile: 0.28 });
  });
}

// ---------------------------------------------------------------------------
// Mimbre (canasto)
// ---------------------------------------------------------------------------

export function wickerTextures() {
  return cached('mimbre', () => {
    const S = 256;
    const R = new Float32Array(S * S);
    const G = new Float32Array(S * S);
    const B = new Float32Array(S * S);
    const Ht = new Float32Array(S * S);
    const L = hexToRgb('#d7b27a');
    const D = hexToRgb('#9b723f');
    const cols = 16;
    const rows = 16;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const cx = (x / S) * cols;
        const cy = (y / S) * rows;
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);
        const fx = cx - ix;
        const fy = cy - iy;
        // tejido sobre/bajo: la hebra horizontal pasa por encima en celdas alternadas
        const over = (ix + iy) % 2 === 0;
        const hStrand = Math.sin(fy * Math.PI);
        const vStrand = Math.sin(fx * Math.PI);
        const h = over ? hStrand * (0.6 + 0.4 * Math.sin(fx * Math.PI)) : vStrand * 0.7;
        const fib = tnoise((x / S) * 64, (y / S) * 8, 64, 8, 2);
        const c = mixc(L, D, clamp(1 - h + fib * 0.3 - 0.15, 0, 1));
        const i = y * S + x;
        R[i] = c.r;
        G[i] = c.g;
        B[i] = c.b;
        Ht[i] = h;
      }
    }
    const tile = 0.16;
    return {
      map: canvasTexture(rgbCanvas(R, G, B, S, S), { tile }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, S, S, 3, true), { srgb: false, tile }),
    };
  });
}

// ---------------------------------------------------------------------------
// Cartón kraft
// ---------------------------------------------------------------------------

export function cardboardTextures() {
  return cached('carton', () => {
    const S = 256;
    const R = new Float32Array(S * S);
    const G = new Float32Array(S * S);
    const B = new Float32Array(S * S);
    const Ht = new Float32Array(S * S);
    const base = hexToRgb('#b88d5c');
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const n = tfbm(u, v, 8, 8, 4, 33);
        const fib = tnoise(u * 128, v * 32, 128, 32, 35);
        const k = 0.86 + (n - 0.5) * 0.22 + (fib - 0.5) * 0.08;
        const i = y * S + x;
        R[i] = base.r * k;
        G[i] = base.g * k;
        B[i] = base.b * k;
        Ht[i] = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 48) * 0.15 + n * 0.3;
      }
    }
    const tile = 0.5;
    return {
      map: canvasTexture(rgbCanvas(R, G, B, S, S), { tile }),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, S, S, 0.8, true), { srgb: false, tile }),
    };
  });
}

// ---------------------------------------------------------------------------
// Metal cepillado (rugosidad) y tambor perforado
// ---------------------------------------------------------------------------

export function brushedRoughness() {
  return cached('cepillado', () => {
    const W = 256;
    const H = 256;
    const F = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        F[y * W + x] = 0.28 + tnoise(u * 4, v * 256, 4, 256, 8) * 0.18 + tnoise(u * 16, v * 128, 16, 128, 9) * 0.06;
      }
    }
    return canvasTexture(grayCanvas(F, W, H), { srgb: false, tile: 0.3 });
  });
}

// Chapa perforada (tambor del lavarropas). uv normalizadas: repeat lo pone quien la usa.
export function perforatedTextures() {
  return cached('perforado', () => {
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, S, 0);
    g.addColorStop(0, '#b9bcc0');
    g.addColorStop(0.5, '#d4d7da');
    g.addColorStop(1, '#b9bcc0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const holes = (ctx2, col) => {
      ctx2.fillStyle = col;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const x = (i + 0.5 + (j % 2) * 0.5) * (S / 4);
          const y = (j + 0.5) * (S / 4);
          for (const dx of [-S, 0, S]) {
            ctx2.beginPath();
            ctx2.arc(x + dx, y, 5, 0, Math.PI * 2);
            ctx2.fill();
          }
        }
      }
    };
    holes(ctx, '#2a2c2f');
    const Ht = new Float32Array(S * S);
    const hc = makeCanvas(S, S);
    const hctx = hc.getContext('2d');
    hctx.fillStyle = '#fff';
    hctx.fillRect(0, 0, S, S);
    holes(hctx, '#000');
    const d = hctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) Ht[i] = d[i * 4] / 255;
    return {
      map: canvasTexture(c, {}),
      normalMap: canvasTexture(heightToNormalCanvas(Ht, S, S, 1.5, true), { srgb: false }),
    };
  });
}

// ---------------------------------------------------------------------------
// Sprites suaves y texto
// ---------------------------------------------------------------------------

export function softSprite(key = 'suave', inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return cached(`sprite-${key}`, () => {
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return canvasTexture(c, { wrap: false });
  });
}

// Bocanada de vapor: mancha irregular suave.
export function steamSprite() {
  return cached('sprite-vapor', () => {
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x / S - 0.5;
        const dy = y / S - 0.5;
        const d = Math.hypot(dx, dy) * 2;
        const n = tfbm(x / S, y / S, 4, 4, 3, 61);
        const a = clamp((1 - d) * 1.4 - 0.15, 0, 1) * (0.55 + n * 0.9);
        const o = (y * S + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = clamp(a * a * 255, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(c, { wrap: false });
  });
}

// Textura de un dibujo en canvas (para carteles, etiquetas, displays...).
export function drawTexture(w, h, draw, { srgb = true, key = null } = {}) {
  const make = () => {
    const c = makeCanvas(w, h);
    draw(c.getContext('2d'), w, h, c);
    const t = canvasTexture(c, { srgb, wrap: false });
    t.userData.canvas = c;
    return t;
  };
  return key ? cached(key, make) : make();
}

// Texto ajustado a un ancho máximo.
export function fitText(ctx, text, x, y, maxW, font, size) {
  let s = size;
  ctx.font = `${font.replace('{s}', s)}`;
  while (ctx.measureText(text).width > maxW && s > 6) {
    s -= 1;
    ctx.font = `${font.replace('{s}', s)}`;
  }
  ctx.fillText(text, x, y);
  return s;
}
