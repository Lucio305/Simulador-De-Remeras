// Parches sobre la superficie de la remera: estampas (con relieve geométrico real)
// y marcas de quemado. Cada parche es una grilla densa "pegada" al panel con
// coordenadas baricéntricas, así sigue el inflado y las arrugas.

import * as THREE from 'three';
import { getWeaveNormalTexture } from '../materials/fabric.js';
import { makeCanvas, rng, makeValueNoise, fbm, clamp, hexToRgb } from '../core/utils.js';

const DEG = Math.PI / 180;

// Grilla nx × ny de puntos en coords de prenda, con alto por vértice (m) sobre la superficie.
export class SurfacePatch {
  constructor({ side, nx, ny, garment, uv, heights, keep, index }) {
    this.side = side;
    this.nx = nx;
    this.ny = ny;
    this.garment = garment; // Float32Array 2n
    this.heights = heights; // Float32Array n (m sobre la superficie)
    this.atts = new Array(nx * ny).fill(null);
    this.valid = new Uint8Array(nx * ny);
    this.keep = keep; // función(i,j) → bool para cada celda (además de validez)
    this.uvArr = uv;
    this.index = index;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setAttribute('uv1', new THREE.BufferAttribute(garment, 2));
    this.base = new Float32Array(nx * ny * 3);
    this.bnrm = new Float32Array(nx * ny * 3);
  }
  // Fija cada vértice al panel (índice espacial del panel).
  attach(triIndex) {
    const { nx, ny, garment } = this;
    for (let k = 0; k < nx * ny; k++) {
      const a = triIndex.query(garment[k * 2], garment[k * 2 + 1], 0.004);
      this.atts[k] = a;
      this.valid[k] = a ? 1 : 0;
    }
    // triángulos: celdas con los 4 vértices válidos y que el filtro acepta
    const idx = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = a + nx;
        if (!(this.valid[a] && this.valid[b] && this.valid[c] && this.valid[d])) continue;
        if (this.keep && !this.keep(i, j)) continue;
        idx.push(a, b, c, a, c, d);
      }
    }
    this.geometry.setIndex(idx);
    this.triCount = idx.length / 3;
  }
  // Recalcula posiciones a partir de la superficie actual del panel.
  update(panel, flipWinding) {
    const { nx, ny } = this;
    const P = panel.pos;
    const N = panel.nrm;
    const base = this.base;
    const bn = this.bnrm;
    const pos = this.geometry.attributes.position.array;
    const nrm = this.geometry.attributes.normal.array;
    const H = this.heights;
    for (let k = 0; k < nx * ny; k++) {
      const at = this.atts[k];
      const o = k * 3;
      if (!at) {
        pos[o] = pos[o + 1] = pos[o + 2] = 0;
        continue;
      }
      const a = at.a * 3;
      const b = at.b * 3;
      const c = at.c * 3;
      for (let q = 0; q < 3; q++) {
        base[o + q] = P[a + q] * at.w0 + P[b + q] * at.w1 + P[c + q] * at.w2;
        bn[o + q] = N[a + q] * at.w0 + N[b + q] * at.w1 + N[c + q] * at.w2;
      }
      const l = Math.hypot(bn[o], bn[o + 1], bn[o + 2]) || 1;
      bn[o] /= l;
      bn[o + 1] /= l;
      bn[o + 2] /= l;
      const h = H[k];
      pos[o] = base[o] + bn[o] * h;
      pos[o + 1] = base[o + 1] + bn[o + 1] * h;
      pos[o + 2] = base[o + 2] + bn[o + 2] * h;
    }
    // normales: tangentes de la grilla base + gradiente de altura (base suave, relieve nítido)
    const sgn = flipWinding ? -1 : 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const o = k * 3;
        if (!this.valid[k]) continue;
        const iL = i > 0 && this.valid[k - 1] ? k - 1 : k;
        const iR = i < nx - 1 && this.valid[k + 1] ? k + 1 : k;
        const jD = j > 0 && this.valid[k - nx] ? k - nx : k;
        const jU = j < ny - 1 && this.valid[k + nx] ? k + nx : k;
        const ux = pos[iR * 3] - pos[iL * 3];
        const uy = pos[iR * 3 + 1] - pos[iL * 3 + 1];
        const uz = pos[iR * 3 + 2] - pos[iL * 3 + 2];
        const vx = pos[jU * 3] - pos[jD * 3];
        const vy = pos[jU * 3 + 1] - pos[jD * 3 + 1];
        const vz = pos[jU * 3 + 2] - pos[jD * 3 + 2];
        let nx_ = uy * vz - uz * vy;
        let ny_ = uz * vx - ux * vz;
        let nz_ = ux * vy - uy * vx;
        const l = Math.hypot(nx_, ny_, nz_);
        if (l < 1e-12 || iL === iR || jD === jU) {
          nrm[o] = bn[o];
          nrm[o + 1] = bn[o + 1];
          nrm[o + 2] = bn[o + 2];
          continue;
        }
        nx_ = (nx_ / l) * sgn;
        ny_ = (ny_ / l) * sgn;
        nz_ = (nz_ / l) * sgn;
        // que apunte hacia afuera (mismo lado que la normal del panel)
        if (nx_ * bn[o] + ny_ * bn[o + 1] + nz_ * bn[o + 2] < 0) {
          nx_ = -nx_;
          ny_ = -ny_;
          nz_ = -nz_;
        }
        nrm[o] = nx_;
        nrm[o + 1] = ny_;
        nrm[o + 2] = nz_;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();
  }
  dispose() {
    this.geometry.dispose();
  }
}

// ---------- utilidades de imagen ----------
function readPixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
function sampleChannel(img, u, v, ch) {
  const w = img.width;
  const h = img.height;
  const fx = clamp(u, 0, 1) * (w - 1);
  const fy = (1 - clamp(v, 0, 1)) * (h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = img.data;
  const at = (x, y) => d[(y * w + x) * 4 + ch];
  return ((at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty) / 255;
}
// Tabla de áreas sumadas de un canal (para promediar celdas: muestreo sin escalones).
function summedArea(img, ch) {
  const w = img.width;
  const h = img.height;
  const S = new Float64Array((w + 1) * (h + 1));
  const d = img.data;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += d[(y * w + x) * 4 + ch] / 255;
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  return { S, w, h };
}
// Promedio del canal en la caja centrada en (u, v) de medio lado (hu, hv) (en uv).
function boxAvg(T, u, v, hu, hv) {
  const { S, w, h } = T;
  const x0 = Math.max(0, Math.min(w, Math.floor((u - hu) * w)));
  const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((u + hu) * w)));
  const y0 = Math.max(0, Math.min(h, Math.floor((1 - v - hv) * h)));
  const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((1 - v + hv) * h)));
  const W1 = w + 1;
  const sum = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
  return sum / ((x1 - x0) * (y1 - y0));
}
function canvasTexture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------- estampa ----------
// placement en coords de prenda; para 'espalda' x está "vista desde atrás". rotation en grados.
export function buildPrintPatch(side, print, placement, triIndex, { exaggerate = 1.8, minOffset = 0.0004 } = {}) {
  // `height` es el mapa de alturas (canvas); por las dudas se aceptan otras variantes
  const hCanvas = print.height && print.height.getContext ? print.height : print.heightMap && print.heightMap.getContext ? print.heightMap : null;
  const cw = print.color.width;
  const ch = print.color.height;
  const aspect = print.aspect || (typeof print.width === 'number' && typeof print.height === 'number' ? print.width / print.height : cw / ch) || 1;
  const W = Math.max(0.01, placement.width || 0.25);
  const Hh = W / aspect;
  const nx = clamp(Math.round(W / 0.0018), 40, 200);
  const ny = clamp(Math.round(Hh / 0.0018), 40, 200);
  const rot = (placement.rotation || 0) * DEG;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const flip = side === 'espalda' ? -1 : 1; // vista desde atrás: x de prenda = −x de vista
  const cx = (placement.x || 0) * flip;
  const cy = placement.y ?? -0.25;
  const n = nx * ny;
  const garment = new Float32Array(n * 2);
  const uv = new Float32Array(n * 2);
  const heights = new Float32Array(n);
  const hImg = hCanvas ? readPixels(hCanvas) : null;
  const cImg = readPixels(print.color);
  const reliefM = ((print.params && print.params.reliefMm) || 0) / 1000;
  const alpha = new Float32Array(n);
  const hSAT = hImg ? summedArea(hImg, 0) : null;
  const aSAT = summedArea(cImg, 3);
  const hu = 0.6 / (nx - 1);
  const hv = 0.6 / (ny - 1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const u = i / (nx - 1);
      const v = j / (ny - 1);
      const lx = (u - 0.5) * W;
      const ly = (v - 0.5) * Hh;
      const vx = lx * cr - ly * sr; // rotación antihoraria vista por quien mira
      const vy = lx * sr + ly * cr;
      garment[k * 2] = cx + vx * flip;
      garment[k * 2 + 1] = cy + vy;
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
      // cobertura de la celda (máx. entre el punto y el promedio, para no perder trazos finos)
      const a = Math.max(sampleChannel(cImg, u, v, 3), boxAvg(aSAT, u, v, hu * 1.6, hv * 1.6) * 1.5);
      alpha[k] = a;
      const h = hSAT ? boxAvg(hSAT, u, v, hu, hv) : 0;
      heights[k] = minOffset + h * reliefM * exaggerate;
    }
  }
  const at = print.params && print.params.alphaTest != null ? print.params.alphaTest : 0.02;
  const keep = (i, j) => {
    const a = j * nx + i;
    return alpha[a] > at || alpha[a + 1] > at || alpha[a + nx] > at || alpha[a + nx + 1] > at;
  };
  const patch = new SurfacePatch({ side, nx, ny, garment, uv, heights, keep });
  patch.attach(triIndex);
  // (en la espalda la grilla queda espejada en x, así que sus triángulos ya miran hacia −Z = afuera)
  patch.alpha = alpha;
  return patch;
}

export function makePrintMaterial(print, fabric) {
  const p = print.params || {};
  const mat = new THREE.MeshPhysicalMaterial({
    map: canvasTexture(print.color, true),
    roughness: 1,
    metalness: 1,
    transparent: true,
    opacity: p.opacity ?? 1,
    alphaTest: p.alphaTest ?? 0.02,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  if (print.orm) {
    const orm = canvasTexture(print.orm, false);
    mat.roughnessMap = orm;
    mat.metalnessMap = orm;
  } else {
    mat.roughness = p.roughness ?? 0.6;
    mat.metalness = p.metalness ?? 0;
  }
  let weave = null;
  if (p.showWeave && fabric) {
    const src = getWeaveNormalTexture(fabric.weave || 'jersey');
    if (src) {
      weave = src.clone();
      weave.channel = 1; // uv1 = coords de prenda en metros
      weave.userData = { shared: false };
      weave.needsUpdate = true;
    }
  }
  if (weave) {
    mat.normalMap = weave;
    mat.normalScale = new THREE.Vector2(0.9, 0.9);
  } else if (print.normal) {
    mat.normalMap = canvasTexture(print.normal, false);
    const s = p.normalScale ?? 1;
    mat.normalScale = new THREE.Vector2(s, s);
  }
  if (p.clearcoat) {
    mat.clearcoat = p.clearcoat;
    mat.clearcoatRoughness = p.clearcoatRoughness ?? 0.3;
  }
  if (p.sheen) {
    mat.sheen = p.sheen;
    mat.sheenRoughness = p.sheenRoughness ?? 0.5;
    mat.sheenColor = new THREE.Color(p.sheenColor || '#ffffff');
  }
  if (p.iridescence) {
    mat.iridescence = p.iridescence;
    mat.iridescenceIOR = 1.4;
    mat.iridescenceThicknessRange = [180, 520];
  }
  mat.name = 'estampa-' + (print.technique || '');
  return mat;
}

// ---------- desgaste por lavados (local) ----------
// Aclara/desatura y agrieta: devuelve un PrintResult nuevo (mismos params) con canvases propios.
export function applyWearLocal(result, { fade = 0, crack = 0 } = {}, fabricColor = '#ffffff') {
  if (!result || (fade <= 0 && crack <= 0)) return result;
  const w = result.color.width;
  const h = result.color.height;
  const color = makeCanvas(w, h);
  const cctx = color.getContext('2d');
  cctx.drawImage(result.color, 0, 0);
  const img = cctx.getImageData(0, 0, w, h);
  const d = img.data;
  const fab = hexToRgb(fabricColor);
  // patrón de grietas: bordes de celdas de Voronoi (grilla jitter) + ruido
  const crackMask = crack > 0 ? crackPattern(w, h, crack, 97) : null;
  const noise = makeValueNoise(41, 64);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (d[o + 3] === 0) continue;
      const nz = fbm(noise, (x / w) * 14, (y / h) * 14, 3);
      const f = clamp(fade * (0.75 + 0.5 * nz), 0, 1);
      const r = d[o];
      const g = d[o + 1];
      const b = d[o + 2];
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      // desaturar, aclarar hacia blanco y dejar ver la tela
      let nr = r + (lum - r) * f * 0.6;
      let ng = g + (lum - g) * f * 0.6;
      let nb = b + (lum - b) * f * 0.6;
      nr += (235 - nr) * f * 0.35;
      ng += (235 - ng) * f * 0.35;
      nb += (235 - nb) * f * 0.35;
      nr += (fab.r - nr) * f * 0.25;
      ng += (fab.g - ng) * f * 0.25;
      nb += (fab.b - nb) * f * 0.25;
      d[o] = nr;
      d[o + 1] = ng;
      d[o + 2] = nb;
      let a = d[o + 3] * (1 - f * 0.18);
      if (crackMask) a *= 1 - crackMask[y * w + x];
      d[o + 3] = a;
    }
  }
  cctx.putImageData(img, 0, 0);
  const srcH = result.height && result.height.getContext ? result.height : null;
  let height = result.height;
  if (crackMask && srcH) {
    height = makeCanvas(srcH.width, srcH.height);
    const hc = height.getContext('2d');
    hc.drawImage(srcH, 0, 0);
    const hi = hc.getImageData(0, 0, height.width, height.height);
    const hw = height.width;
    const hh = height.height;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const mx = Math.min(w - 1, Math.floor((x / hw) * w));
        const my = Math.min(h - 1, Math.floor((y / hh) * h));
        const k = crackMask[my * w + mx];
        const o = (y * hw + x) * 4;
        const v = hi.data[o] * (1 - k) * (1 - fade * 0.2);
        hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = v;
      }
    }
    hc.putImageData(hi, 0, 0);
  }
  return { ...result, color, height, wear: { fade, crack } };
}

function crackPattern(w, h, amount, seed) {
  const r = rng(seed);
  const cells = Math.round(6 + amount * 16);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + r()) / cells, (j + r()) / cells]);
  const out = new Float32Array(w * h);
  const width = 0.0025 + amount * 0.006;
  const noise = makeValueNoise(seed + 3, 64);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w + (fbm(noise, x * 0.05, y * 0.05, 2) - 0.5) * 0.02;
      const v = y / h + (fbm(noise, x * 0.05 + 9, y * 0.05 + 4, 2) - 0.5) * 0.02;
      const ci = Math.floor(u * cells);
      const cj = Math.floor(v * cells);
      let d1 = Infinity;
      let d2 = Infinity;
      for (let jj = cj - 1; jj <= cj + 1; jj++) {
        for (let ii = ci - 1; ii <= ci + 1; ii++) {
          if (ii < 0 || jj < 0 || ii >= cells || jj >= cells) continue;
          const p = pts[jj * cells + ii];
          const dd = (p[0] - u) ** 2 + (p[1] - v) ** 2;
          if (dd < d1) {
            d2 = d1;
            d1 = dd;
          } else if (dd < d2) d2 = dd;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      out[y * w + x] = edge < width ? clamp(1 - edge / width, 0, 1) ** 0.6 * clamp(amount * 1.6, 0, 1) : 0;
    }
  }
  return out;
}

// ---------- quemaduras ----------
export function buildScorch(side, x, y, radius, intensity, kind, triIndex, seed) {
  const size = radius * 2.6;
  const nx = 36;
  const ny = 36;
  const n = nx * ny;
  const garment = new Float32Array(n * 2);
  const uv = new Float32Array(n * 2);
  const heights = new Float32Array(n).fill(kind === 'melt' ? 0.00035 : 0.00022);
  const rot = rng(seed)() * Math.PI * 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const u = i / (nx - 1);
      const v = j / (ny - 1);
      const lx = (u - 0.5) * size;
      const ly = (v - 0.5) * size;
      garment[k * 2] = x + lx * Math.cos(rot) - ly * Math.sin(rot);
      garment[k * 2 + 1] = y + lx * Math.sin(rot) + ly * Math.cos(rot);
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
    }
  }
  const patch = new SurfacePatch({ side, nx, ny, garment, uv, heights });
  patch.attach(triIndex);
  if (side === 'espalda') {
    // la grilla no está espejada, pero la espalda mira a −Z: invertir triángulos
    const ia = patch.geometry.index.array;
    for (let t = 0; t < ia.length; t += 3) {
      const b = ia[t + 1];
      ia[t + 1] = ia[t + 2];
      ia[t + 2] = b;
    }
  }
  const tex = scorchTexture(intensity, kind, seed);
  const mat =
    kind === 'melt'
      ? new THREE.MeshPhysicalMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          roughness: 0.18,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -3,
        })
      : new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          roughness: 0.95,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -3,
        });
  return { patch, material: mat, texture: tex };
}

function scorchTexture(intensity, kind, seed) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const noise = makeValueNoise(seed * 13 + 1, 64);
  const r = rng(seed);
  const elong = 0.75 + r() * 0.5;
  const k = clamp(intensity, 0.05, 1);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / (S - 1) - 0.5) * 2.6;
      const v = ((y / (S - 1) - 0.5) * 2.6) / elong;
      const nz = fbm(noise, x * 0.06, y * 0.06, 4);
      const d = Math.hypot(u, v) + (nz - 0.5) * 0.55;
      const o = (y * S + x) * 4;
      if (kind === 'melt') {
        // poliéster derretido: brillo plástico, algo más oscuro y amarillento, borde irregular
        const a = clamp((1.0 - d) / 0.25, 0, 1);
        img.data[o] = 120 + 40 * nz;
        img.data[o + 1] = 105 + 30 * nz;
        img.data[o + 2] = 80 + 20 * nz;
        img.data[o + 3] = 255 * a * (0.55 + 0.4 * k);
      } else {
        // marrón tostado con centro más oscuro y halo
        const core = clamp((0.62 - d) / 0.4, 0, 1);
        const halo = clamp((1.05 - d) / 0.45, 0, 1);
        const rC = 70 + (150 - 70) * (1 - core);
        const gC = 38 + (95 - 38) * (1 - core);
        const bC = 16 + (45 - 16) * (1 - core);
        img.data[o] = rC;
        img.data[o + 1] = gC;
        img.data[o + 2] = bC;
        img.data[o + 3] = 255 * clamp(halo * (0.35 + 0.65 * k) * (0.7 + 0.3 * nz) + core * 0.25 * k, 0, 0.95);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, true);
}
