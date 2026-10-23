// Paso Estampar · utilidades compartidas por los cuatro mini-juegos (prensa, serigrafía,
// bordado y pintura): datos del diseño, ubicación de la remera acostada sobre una máquina,
// mallas que copian la superficie de la remera (transfer, film, bastidor…), capas de color de
// una estampa (para revelarla de a poco), pose de las props y armado del resultado final.

import * as THREE from 'three';
import { processPrint } from '../../print/printEngine.js';
import { FOIL_TINTS, GLITTER_TINTS } from '../../data/catalog.js';
import { clamp, smoothstep, hexToRgb, rgbToHex } from '../../core/utils.js';

export const OK = '<span class="est-mark ok">✓</span> ';
export const NO = '<span class="est-mark no">✗</span> ';
export const MID = '<span class="est-mark mid">≈</span> ';

export const PRESSURES = [
  { id: 1, label: 'Baja' },
  { id: 2, label: 'Media' },
  { id: 3, label: 'Alta' },
];
export const pressureName = (p) => (PRESSURES.find((x) => x.id === p)?.label || 'Media').toLowerCase();
export const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',');
export const DEFECT_KEYS = ['patchy', 'lift', 'scorch', 'ghost', 'under'];

export function emptyDefects() {
  return { patchy: 0, lift: 0, scorch: 0, ghost: 0, under: 0 };
}
export function clampDefects(d) {
  const out = emptyDefects();
  for (const k of DEFECT_KEYS) out[k] = Math.round(clamp(d[k] || 0, 0, 1) * 1000) / 1000;
  return out;
}

// Datos del diseño que se va a estampar (con valores seguros si falta algo).
export function designInfo(state, catalog) {
  const d = state.design || null;
  const tech = catalog.techniqueById(d?.technique) || catalog.techniqueById('serigrafia');
  const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
  const side = d?.side === 'espalda' ? 'espalda' : 'frente';
  const placement = { x: 0, y: -0.29, width: 0.26, rotation: 0, ...(d?.placement || {}) };
  const fabricHex = state.fabric?.color || '#f3f1ea';
  const widthM = d?.size?.cw > 0 ? d.size.cw : placement.width * 0.96;
  const lum = catalog.luminance(fabricHex);
  return {
    d,
    tech,
    fabric,
    side,
    other: side === 'frente' ? 'espalda' : 'frente',
    placement,
    fabricHex,
    widthM,
    dark: lum < 0.3,
    lum,
    heatSensitive: fabric.ironLevel <= 2,
    poly: /poli[eé]ster/i.test(fabric.composition || ''),
  };
}

// Opciones de processPrint coherentes con el paso Diseño.
export function printOptions(info, extra = {}) {
  const { d, fabric, fabricHex, widthM, tech } = info;
  const o = { fabricId: fabric.id, fabricColor: fabricHex, widthM, resolution: 640, seed: 11, quality: 1 };
  if (tech.maxColors && d?.options?.colors) o.colors = Math.min(tech.maxColors, d.options.colors);
  if (d?.options?.tint) o.tint = d.options.tint;
  else if (tech.id === 'foil') o.tint = FOIL_TINTS[0].hex;
  else if (tech.id === 'glitter') o.tint = GLITTER_TINTS[0].hex;
  return { ...o, ...extra };
}

// Estampa "perfecta" para vistas previas (reusa la del paso Diseño si sirve).
export function basePrint(info) {
  const d = info.d;
  if (d?.preview && d.preview.technique === info.tech.id && d.preview.color) return d.preview;
  return processPrint(d.source, info.tech.id, printOptions(info, { resolution: 448 }));
}

// Procesa la estampa final con calidad y defectos del mini-juego.
export function finalPrint(info, quality, defects, extra = {}) {
  return processPrint(info.d.source, info.tech.id, printOptions(info, { quality: clamp(quality, 0.05, 1), defects: clampDefects(defects), ...extra }));
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------------------
// Remera acostada sobre una superficie
// ---------------------------------------------------------------------------

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

// Orientación: lado `side` hacia arriba, cuello hacia `yaw` (0 = hacia la pared, -Z) y la
// estampa leíble desde el frente del taller.
export function layQuaternion(side, yaw = 0) {
  const qx = new THREE.Quaternion().setFromAxisAngle(AX, -Math.PI / 2);
  const qy = new THREE.Quaternion().setFromAxisAngle(AY, yaw);
  if (side === 'frente') return qy.multiply(qx);
  const qz = new THREE.Quaternion().setFromAxisAngle(AZ, Math.PI);
  return qy.multiply(qz).multiply(qx);
}

// garment x de un punto expresado "como lo ve quien mira ese lado"
export const garmentX = (side, viewX) => (side === 'espalda' ? -viewX : viewX);

// Ubica la remera acostada: el centro de la estampa cae en (anchor.x, anchor.z) y la capa de
// abajo apoya en anchor.y. Devuelve la posición/rotación usadas.
export function layShirt(shirt, info, { anchor, yaw = 0, inflation = 0.06, lift = 0.0015, centerView = null }) {
  const side = info.side;
  shirt.setInflation(inflation);
  const g = shirt.group;
  const q = layQuaternion(side, yaw);
  g.quaternion.copy(q);
  g.scale.set(1, 1, 1);
  const c = centerView || { x: info.placement.x, y: info.placement.y };
  const gx = garmentX(side, c.x);
  const top = shirt.garmentToLocal(side, gx, c.y, 0).position.applyQuaternion(q);
  const bottom = shirt.garmentToLocal(info.other, gx, c.y, 0).position.applyQuaternion(q);
  g.position.set(anchor.x - top.x, anchor.y + lift - bottom.y, anchor.z - top.z);
  g.visible = true;
  g.updateMatrixWorld(true);
  return { position: g.position.clone(), quaternion: q.clone() };
}

// Punto del mundo (y normal) sobre la remera en coordenadas "vistas" del lado.
export function surfacePoint(shirt, side, vx, vy, offset = 0) {
  const r = shirt.garmentToLocal(side, garmentX(side, vx), vy, offset);
  shirt.group.updateMatrixWorld(true);
  const p = r.position.applyMatrix4(shirt.group.matrixWorld);
  const n = r.normal.transformDirection(shirt.group.matrixWorld);
  return { p, n };
}

// Rectángulo (coords vistas del lado) → función que mapea (u, v) ∈ [0,1]² a coords vistas.
export function rectMapper({ cx, cy, w, h, rot = 0 }) {
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (u, v) => {
    const lx = (u - 0.5) * w;
    const ly = (v - 0.5) * h;
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
  };
}

// Caja de lo que de verdad está dibujado en un canvas RGBA (alfa > umbral), en fracciones del
// canvas: u → derecha, v → arriba (como rectMapper). Sirve para encuadrar dibujos chicos.
export function contentBox(canvas, thr = 0.12) {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  let x0 = N;
  let y0 = N;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (d[(y * N + x) * 4 + 3] / 255 <= thr) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { u0: 0, u1: 1, v0: 0, v1: 1, cu: 0.5, cv: 0.5, w: 1, h: 1 };
  const u0 = x0 / N;
  const u1 = (x1 + 1) / N;
  const v0 = 1 - (y1 + 1) / N;
  const v1 = 1 - y0 / N;
  return { u0, u1, v0, v1, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, w: u1 - u0, h: v1 - v0 };
}

// Geometría en grilla que copia la superficie de la remera sobre un rectángulo (espacio local
// de shirt.group). uv: u → derecha, v → arriba (como se ve el diseño).
export function conformGeometry(shirt, side, rect, { segs = 16, offset = 0.0015 } = {}) {
  const map = rectMapper(rect);
  const n = segs + 1;
  const pos = new Float32Array(n * n * 3);
  const nor = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / segs;
      const v = j / segs;
      const p = map(u, v);
      const r = shirt.garmentToLocal(side, garmentX(side, p.x), p.y, offset);
      const k = j * n + i;
      pos.set([r.position.x, r.position.y, r.position.z], k * 3);
      nor.set([r.normal.x, r.normal.y, r.normal.z], k * 3);
      uv.set([u, v], k * 2);
    }
  }
  // las coords "vistas" ya están del lado de quien mira: el orden (u, v) es antihorario para él
  const idx = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.base = pos.slice();
  g.userData.baseNormal = nor.slice();
  g.userData.segs = segs;
  return g;
}

// ---------------------------------------------------------------------------
// Capas de color de una estampa (tintas de serigrafía, hilos de bordado)
// ---------------------------------------------------------------------------

function readCanvas(c) {
  return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
}

// Etiqueta cada píxel con la tinta/hilo más cercano de la paleta (tolera el sombreado).
export function buildLayers(result) {
  const color = readCanvas(result.color);
  const height = readCanvas(result.height);
  const w = color.width;
  const hgt = color.height;
  const pal = (result.palette || []).map((hex) => hexToRgb(hex));
  const labels = new Int8Array(w * hgt).fill(-1);
  const counts = new Array(Math.max(1, pal.length)).fill(0);
  const D = color.data;
  // bbox vertical de cada capa (para revelar de arriba hacia abajo)
  const minY = new Array(pal.length).fill(hgt);
  const maxY = new Array(pal.length).fill(-1);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (D[o + 3] < 24) continue;
      let best = 0;
      if (pal.length > 1) {
        let bd = Infinity;
        for (let k = 0; k < pal.length; k++) {
          const c = pal[k];
          const cc = c.r * c.r + c.g * c.g + c.b * c.b + 1;
          const s = clamp((D[o] * c.r + D[o + 1] * c.g + D[o + 2] * c.b) / cc, 0.72, 1.3);
          const dr = D[o] - c.r * s;
          const dg = D[o + 1] - c.g * s;
          const db = D[o + 2] - c.b * s;
          const dd = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.8 + (1 - s) * (1 - s) * 9000;
          if (dd < bd) {
            bd = dd;
            best = k;
          }
        }
      }
      labels[i] = best;
      counts[best]++;
      if (y < minY[best]) minY[best] = y;
      if (y > maxY[best]) maxY[best] = y;
    }
  }
  // orden: de la capa más grande (fondo) a la más chica (detalles), como se imprime/borda
  const order = pal.map((_, k) => k).filter((k) => counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
  return { w, h: hgt, labels, color, height, palette: result.palette || [], counts, order, minY, maxY, result };
}

// Fila (px del canvas, desde arriba) hasta donde llega el revelado parcial de la capa k.
// De arriba hacia abajo por defecto; `fromBottom` revela de abajo hacia arriba.
export function revealRow(L, k, frac, fromBottom = false) {
  const span = L.maxY[k] - L.minY[k] + 1;
  return fromBottom ? L.maxY[k] + 1 - span * clamp(frac) : L.minY[k] + span * clamp(frac);
}

// Máscara (Float32 0..1) de las capas pedidas: done = capas completas, partial = { k, frac,
// fromBottom } se revela por filas hasta la fracción `frac` de su alto.
export function layerMask(L, done, partial = null) {
  const n = L.w * L.h;
  const m = new Float32Array(n);
  const doneSet = new Set(done);
  let cut = -1;
  const up = !!partial?.fromBottom;
  if (partial) cut = revealRow(L, partial.k, partial.frac, up);
  for (let i = 0; i < n; i++) {
    const k = L.labels[i];
    if (k < 0) continue;
    if (doneSet.has(k)) m[i] = 1;
    else if (partial && k === partial.k) {
      const row = Math.floor(i / L.w);
      if (up ? row >= cut : row < cut) m[i] = 1;
    }
  }
  return m;
}

// PrintResult con color y relieve recortados por una máscara.
export function maskedResult(L, mask, { relief = null } = {}) {
  const res = L.result;
  const w = L.w;
  const h = L.h;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const hc = document.createElement('canvas');
  hc.width = w;
  hc.height = h;
  const cd = new ImageData(new Uint8ClampedArray(L.color.data), w, h);
  const hd = new ImageData(new Uint8ClampedArray(L.height.data), w, h);
  const C = cd.data;
  const H = hd.data;
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const k = mask[i];
    if (k >= 1) continue;
    C[o + 3] = C[o + 3] * k;
    H[o] = H[o + 1] = H[o + 2] = H[o] * k;
  }
  c.getContext('2d').putImageData(cd, 0, 0);
  hc.getContext('2d').putImageData(hd, 0, 0);
  const params = { ...res.params };
  if (relief !== null) params.reliefMm = relief;
  return { ...res, color: c, height: hc, heightMap: hc, params };
}

// Variante de la estampa con otros parámetros de material (sin reprocesar).
export function withParams(res, p) {
  return { ...res, params: { ...res.params, ...p } };
}

// Canvas RGBA con solo la silueta (alfa) de un conjunto de capas, coloreada.
export function layerCanvas(L, keys, hex = '#000000') {
  const { r, g, b } = hexToRgb(hex);
  const c = document.createElement('canvas');
  c.width = L.w;
  c.height = L.h;
  const img = new ImageData(L.w, L.h);
  const D = img.data;
  const set = new Set(keys);
  for (let i = 0, o = 0; i < L.w * L.h; i++, o += 4) {
    const k = L.labels[i];
    if (k < 0 || !set.has(k)) continue;
    D[o] = r;
    D[o + 1] = g;
    D[o + 2] = b;
    D[o + 3] = Math.min(255, L.color.data[o + 3] * 1.1);
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

// Nombre aproximado de un color (para "tinta roja", "hilo azul"…).
const NAMED = [
  ['negro', '#1e1e21'],
  ['blanco', '#f4f2ec'],
  ['gris', '#8f8f8f'],
  ['rojo', '#c62f2f'],
  ['bordó', '#6a1f2c'],
  ['naranja', '#e5732b'],
  ['durazno', '#f9b47a'],
  ['salmón', '#ee8a70'],
  ['amarillo', '#f1cc4e'],
  ['mostaza', '#c99a2c'],
  ['verde', '#3f9a5c'],
  ['verde oliva', '#7d8a3c'],
  ['verde agua', '#8fd0b8'],
  ['turquesa', '#2aa3a3'],
  ['celeste', '#8cc4e8'],
  ['azul', '#2f5cb6'],
  ['azul marino', '#1f2a46'],
  ['violeta', '#6b4b9b'],
  ['lila', '#b6a2d8'],
  ['fucsia', '#d23c8a'],
  ['rosa', '#f0a0c0'],
  ['marrón', '#7a4f2e'],
  ['beige', '#d6bf98'],
  ['crema', '#ecdcb8'],
  ['dorado', '#d4af37'],
  ['plateado', '#c9ccd2'],
];
// Distancia aproximada entre dos colores (RGB ponderado, 0 … ~440).
export function colorDist(a, b) {
  const c = hexToRgb(a);
  const k = hexToRgb(b);
  return Math.sqrt((c.r - k.r) ** 2 * 0.9 + (c.g - k.g) ** 2 * 1.3 + (c.b - k.b) ** 2 * 0.8);
}
export function colorName(hex) {
  let best = NAMED[0][0];
  let bd = Infinity;
  for (const [name, h] of NAMED) {
    const dd = colorDist(hex, h);
    if (dd < bd) {
      bd = dd;
      best = name;
    }
  }
  return best;
}
// Nombres sin repetir para una lista de colores (dos "rojo" pasan a "rojo oscuro" y "rojo claro").
export function distinctNames(hexes) {
  const names = hexes.map((x) => colorName(x));
  const groups = new Map();
  names.forEach((n, i) => {
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(i);
  });
  for (const [n, idx] of groups) {
    if (idx.length < 2) continue;
    const byLum = [...idx].sort((a, b) => lumOf(hexes[a]) - lumOf(hexes[b]));
    byLum.forEach((i, r) => {
      names[i] = byLum.length === 2 ? `${n} ${r === 0 ? 'oscuro' : 'claro'}` : `${n} ${r === 0 ? 'oscuro' : r === byLum.length - 1 ? 'claro' : 'medio'}`;
    });
  }
  return names;
}
function lumOf(hex) {
  const c = hexToRgb(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function darken(hex, k = 0.75) {
  const c = hexToRgb(hex);
  return rgbToHex(Math.round(c.r * k), Math.round(c.g * k), Math.round(c.b * k));
}

// ---------------------------------------------------------------------------
// Props: guardar y restaurar su pose
// ---------------------------------------------------------------------------

export function savePose(obj) {
  if (!obj) return null;
  return { obj, parent: obj.parent, position: obj.position.clone(), quaternion: obj.quaternion.clone(), scale: obj.scale.clone(), visible: obj.visible };
}
export function restorePose(p) {
  if (!p || !p.obj) return;
  const o = p.obj;
  if (p.parent && o.parent !== p.parent) p.parent.add(o);
  o.position.copy(p.position);
  o.quaternion.copy(p.quaternion);
  o.scale.copy(p.scale);
  o.visible = p.visible;
  o.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// Partículas simples (vapor, humo de curado, chispitas)
// ---------------------------------------------------------------------------

let _puffTex = null;
function puffTexture() {
  if (_puffTex) return _puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _puffTex = new THREE.CanvasTexture(c);
  _puffTex.colorSpace = THREE.SRGBColorSpace;
  _puffTex.userData.shared = true;
  return _puffTex;
}

export function createPuffs(max = 60, { color = '#ffffff', additive = false } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 4);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const mat = new THREE.PointsMaterial({
    map: puffTexture(),
    size: 0.07,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    opacity: 0.85,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 9;
  const parts = [];
  const base = new THREE.Color(color);
  return {
    points,
    get count() {
      return parts.length;
    },
    emit(p, v, life = 1, s = 1, hex = null) {
      if (parts.length >= max) parts.shift();
      parts.push({ p: p.clone(), v: v.clone(), life, age: 0, s, c: hex ? new THREE.Color(hex) : base });
    },
    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.age += dt;
        if (q.age >= q.life) {
          parts.splice(i, 1);
          continue;
        }
        q.p.addScaledVector(q.v, dt);
        q.v.multiplyScalar(1 - dt * 1.4);
        q.v.y += dt * 0.05;
      }
      for (let i = 0; i < max; i++) {
        const q = parts[i];
        if (!q) {
          pos[i * 3 + 1] = -100;
          col[i * 4 + 3] = 0;
          continue;
        }
        pos[i * 3] = q.p.x;
        pos[i * 3 + 1] = q.p.y;
        pos[i * 3 + 2] = q.p.z;
        const k = q.age / q.life;
        const f = Math.sin(Math.PI * Math.min(1, k * 1.2)) * (1 - k * 0.3);
        col[i * 4] = q.c.r;
        col[i * 4 + 1] = q.c.g;
        col[i * 4 + 2] = q.c.b;
        col[i * 4 + 3] = additive ? f * 0.6 : f * 0.55;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.setDrawRange(0, max);
    },
    clear() {
      parts.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Miniatura del resultado para la tarjeta
// ---------------------------------------------------------------------------

export function resultThumb(result, fabricHex, size = 150) {
  const pw = result.color.width;
  const ph = result.color.height;
  const s = Math.min(1, size / Math.max(pw, ph));
  const c = document.createElement('canvas');
  c.width = Math.round(pw * s) + 24;
  c.height = Math.round(ph * s) + 24;
  const g = c.getContext('2d');
  g.fillStyle = fabricHex;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(result.color, 12, 12, c.width - 24, c.height - 24);
  c.className = 'est-res-thumb';
  return c;
}

// Calidad → nota, con piso para que nunca sea 0 si se terminó el proceso.
export function qualityScore(q) {
  return Math.round(clamp(q, 0, 1) * 100);
}

export { clamp, smoothstep };

// ---------------------------------------------------------------------------
// Medidor horizontal con zonas (velocidad de racleta, temperatura del flash, tensión…)
// zones: [{ from, to, cls }] en unidades del medidor; log = escala logarítmica.
// ---------------------------------------------------------------------------
export function gauge(h, { min = 0, max = 1, zones = [], log = false, left = '', right = '' } = {}) {
  const T = (v) => {
    const vv = clamp(v, min, max);
    return log ? Math.log(vv / min) / Math.log(max / min) : (vv - min) / (max - min);
  };
  const track = h('div', { class: 'est-gauge-track' });
  for (const z of zones) {
    const a = T(z.from);
    const b = T(z.to);
    track.appendChild(h('span', { class: `est-gauge-zone ${z.cls || ''}`, style: { left: `${a * 100}%`, width: `${(b - a) * 100}%` } }));
  }
  const needle = h('i', { class: 'est-gauge-needle' });
  track.appendChild(needle);
  const el = h('div', { class: 'est-gauge' }, track, left || right ? h('div', { class: 'est-gauge-ends' }, h('span', {}, left), h('span', {}, right)) : null);
  el.set = (v) => {
    needle.style.left = `${T(v) * 100}%`;
    el.classList.toggle('idle', v == null);
  };
  el.set(min);
  return el;
}

// ¿La tecla es para el mini-juego? No si se está escribiendo. Si el foco quedó en un botón o un
// control del panel porque se lo tocó con el mouse (Presión, ⟲ Girar, un toggle…), se suelta el
// foco y la tecla va al juego: si no, Enter/Espacio activarían ese botón en lugar de la acción
// del juego. Solo cuando se navega con el teclado (foco visible) Enter/Espacio quedan para el botón.
// `codes`: teclas que el mini-juego usa en este momento (las demás siguen su curso normal).
// Para saber si el foco llegó con el mouse o navegando con Tab se mira el último pointerdown
// (`:focus-visible` no sirve: Chrome lo prende apenas se toca cualquier tecla).
const focusSrc = { el: null };
export function trackFocusSource(ctx) {
  ctx.listen(window, 'pointerdown', (e) => (focusSrc.el = e.target), true);
  ctx.listen(window, 'keydown', (e) => {
    if (e.code === 'Tab') focusSrc.el = null;
  }, true);
  ctx.track(() => (focusSrc.el = null));
}
export function gameKey(e, codes = null) {
  if (codes && !codes.includes(e.code)) return false;
  const t = e.target;
  if (!t || !t.closest) return true;
  if (t.closest('textarea, select, input[type=text], input[type=number], input[type=color], input[type=search], [contenteditable=true]')) return false;
  const ctl = t.closest('button, [role=button], a[href], input, label');
  if (!ctl) return true;
  const act = e.code === 'Space' || e.code === 'Enter';
  const arrow = /^Arrow/.test(e.code);
  // el control solo "se come" Enter/Espacio (botones, toggles) o las flechas (sliders)
  if (!act && !(arrow && ctl.tagName === 'INPUT')) return true;
  const src = focusSrc.el;
  const byPointer = !!src && (ctl === src || ctl.contains(src) || (src.contains && src.contains(ctl)) || (src.closest && src.closest('label')?.contains(ctl)));
  // navegando con el teclado, Enter/Espacio son del botón enfocado
  if (!byPointer) return false;
  // foco puesto con el mouse: se suelta y la tecla va al juego (sin foco, el Espacio ya no
  // "clickea" el botón al soltarlo ni el slider se mueve con las flechas)
  e.preventDefault();
  ctl.blur();
  t.blur?.();
  return true;
}

// Primer punto de la remera bajo el puntero (solo los paneles de tela: así no estorban las mallas
// propias del paso que cuelgan de shirt.group, aunque estén ocultas). → { hit, g } | null
export function garmentHit(engine, shirt) {
  const panels = Object.values(shirt.getPanelMeshes?.() || {}).filter((m) => m && m.visible);
  if (!panels.length) return null;
  for (const hit of engine.raycast(panels, null, false)) {
    const g = shirt.hitToGarment(hit);
    if (g) return { hit, g };
  }
  return null;
}

// Promesa que se resuelve en el frame en que `cond()` da true (tiempo de simulación, no de reloj:
// no depende de los fps). Se corta sola a los `maxSec` segundos simulados o al salir del paso.
export function untilFrame(ctx, cond, maxSec = 60) {
  return new Promise((resolve) => {
    let t = 0;
    let done = false;
    const off = ctx.onUpdate((dt) => {
      if (done) return;
      t += dt;
      if (!ctx.alive || cond() || t >= maxSec) {
        done = true;
        off();
        resolve(t);
      }
    });
  });
}

// Limita una función a una llamada cada `ms` (para raycasts de "hover").
export function throttle(fn, ms = 80) {
  let last = -1e9;
  let val;
  return (...a) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      val = fn(...a);
    }
    return val;
  };
}
