// Utilidades de color para las telas: sRGB ↔ lineal, tonos del jaspeado (melange)
// y color del sheen.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// Tabla lineal (0..1, 4096 pasos) → byte sRGB, para codificar rápido.
const SRGB_LUT = (() => {
  const t = new Uint8Array(4097);
  for (let k = 0; k <= 4096; k++) t[k] = Math.round(linearToSrgb(k / 4096) * 255);
  return t;
})();
export const encodeSrgb = (lin) => SRGB_LUT[lin <= 0 ? 0 : lin >= 1 ? 4096 : (lin * 4096) | 0];

export function normalizeHex(hex) {
  let c = String(hex || '#ffffff').trim().replace('#', '').toLowerCase();
  if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/.test(c)) c = 'ffffff';
  return '#' + c;
}

// Color hex → [r, g, b] lineales.
export function hexToLinear(hex) {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

export const lumLin = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Tonos del jaspeado (melange) en lineal: fibras oscuras, del color y claras.
// Mezclar fibras teñidas con fibras crudas/claras es lo que da el aspecto "heather".
export function heatherTones(hex) {
  const c = hexToLinear(hex);
  const L = linearToSrgb(lumLin(c)); // 0..1 perceptual
  const lightK = 0.16 + 0.14 * (1 - L); // colores oscuros: fibras claras más visibles
  const darkK = 0.64 + 0.22 * L; // colores claros: fibras oscuras más suaves
  const toL = (v) => srgbToLinear(clamp(v));
  // mezclo en sRGB (perceptual) y vuelvo a lineal
  const dark = c.map((v) => toL(linearToSrgb(v) * darkK));
  const mid = c.map((v) => toL(linearToSrgb(v) * 0.97));
  const light = c.map((v) => {
    const s = linearToSrgb(v);
    return toL(s + (1 - s) * lightK);
  });
  // levemente desaturado, como el melange real
  const desat = (col, k) => {
    const l = lumLin(col);
    return col.map((v) => v + (l - v) * k);
  };
  return { dark: desat(dark, 0.1), mid, light: desat(light, 0.3) };
}

function smooth(a, b, v) {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// Color lineal de un píxel jaspeado: mezcla de fibras de 3 tonos según el campo de
// fibras `f` (0..1, ~uniforme), por la oclusión `g`. ~26 % oscuras, ~54 % del
// color, ~20 % claras.
export function heatherPixel(tones, f, g, out) {
  const wD = 1 - smooth(0.2, 0.32, f);
  const wL = smooth(0.74, 0.86, f);
  const wM = Math.max(0, 1 - wD - wL);
  out[0] = (tones.dark[0] * wD + tones.mid[0] * wM + tones.light[0] * wL) * g;
  out[1] = (tones.dark[1] * wD + tones.mid[1] * wM + tones.light[1] * wL) * g;
  out[2] = (tones.dark[2] * wD + tones.mid[2] * wM + tones.light[2] * wL) * g;
  return out;
}

// Color del sheen: versión aclarada (y un poco desaturada) del color de la tela.
export function sheenColorFor(hex, amount) {
  const c = hexToLinear(hex);
  const l = lumLin(c);
  const k = clamp(amount, 0, 1);
  const out = c.map((v) => {
    const d = v + (l - v) * 0.25; // un toque desaturado
    return d + (1 - d) * k;
  });
  return new THREE.Color(out[0], out[1], out[2]); // ya en lineal
}
