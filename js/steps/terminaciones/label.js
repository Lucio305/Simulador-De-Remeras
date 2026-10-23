// Etiqueta del cuello: dibujo SVG (vista previa del panel, tarjeta de resultado y textura 3D)
// y la malla 3D cosida adentro del cuello de la espalda de la remera.

import * as THREE from 'three';
import { careGroup } from './careSymbols.js';
import { LABEL_COLORS } from './rules.js';
import { mixHex } from '../../core/utils.js';
import { luminance } from '../../data/catalog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LABEL_W = 320;
export const LABEL_H = 168;

// Tamaño de letra de la marca para que entre en el ancho disponible.
function brandSize(text, max = 34, width = 236) {
  const n = Math.max(1, text.length);
  return Math.max(15, Math.min(max, (width / n) * 1.85));
}

// data = { brand, size, composition, material, color, care: {wash, bleach, dry, iron, reverse}, fabricColor, swatch (dataURL|null) }
export function labelSVG(data, { id = 'lbl', className = 'term-label-svg', bare = false } = {}) {
  const W = LABEL_W;
  const H = LABEL_H;
  const brand = (data.brand || '').trim() || 'Mi Taller';
  const care = data.care || {};
  const printed = data.material === 'estampada';
  const col = LABEL_COLORS.find((c) => c.id === data.color) || LABEL_COLORS[0];
  let bg = col.bg;
  let ink = col.ink;
  let accent = col.accent;
  if (printed) {
    bg = data.fabricColor || '#f3f1ea';
    const dark = luminance(bg) < 0.45;
    ink = dark ? '#f6f1e8' : '#2b2420';
    accent = dark ? '#f6f1e8' : '#2b2420';
  }
  const parts = [];
  parts.push(`<svg class="${className}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  parts.push('<defs>');
  if (data.material === 'raso') {
    parts.push(
      `<linearGradient id="${id}-sat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mixHex(bg, '#ffffff', 0.05)}"/><stop offset="0.38" stop-color="${mixHex(bg, '#ffffff', 0.2)}"/><stop offset="0.5" stop-color="${mixHex(bg, '#ffffff', 0.07)}"/><stop offset="0.72" stop-color="${mixHex(bg, '#000000', 0.08)}"/><stop offset="1" stop-color="${mixHex(bg, '#ffffff', 0.12)}"/></linearGradient>`,
      `<pattern id="${id}-weave" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="3" height="1.1" fill="${mixHex(bg, '#ffffff', 0.18)}" opacity="0.35"/></pattern>`,
    );
  } else if (data.material === 'algodon') {
    parts.push(
      `<pattern id="${id}-weave" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="${bg}"/><rect width="2" height="2" fill="${mixHex(bg, '#000000', 0.07)}"/><rect x="2" y="2" width="2" height="2" fill="${mixHex(bg, '#000000', 0.07)}"/><rect x="0" y="1.6" width="4" height="0.5" fill="${mixHex(bg, '#ffffff', 0.12)}"/></pattern>`,
    );
  }
  parts.push('</defs>');

  if (printed) {
    // estampada adentro del cuello: tinta sobre la tela, sin bordes
    if (bare) {
      /* solo la tinta: el fondo es la tela de la remera */
    } else {
      // la tela de fondo: color de la remera con columnas de mallas de punto
      const knit = luminance(bg) > 0.5 ? 'rgba(60,45,30,0.10)' : 'rgba(255,255,255,0.10)';
      parts.push(`<defs><pattern id="${id}-kn" patternUnits="userSpaceOnUse" width="7" height="6"><path d="M0.6 0 L2 3 L0.6 6 M4.1 0 L5.5 3 L4.1 6" fill="none" stroke="${knit}" stroke-width="1"/></pattern><radialGradient id="${id}-vg" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></radialGradient></defs>`);
      parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/><rect width="${W}" height="${H}" fill="url(#${id}-kn)"/><rect width="${W}" height="${H}" fill="url(#${id}-vg)"/>`);
    }
    parts.push(`<g opacity="0.92">`);
    parts.push(`<rect x="22" y="14" width="${W - 44}" height="${H - 28}" rx="14" fill="none" stroke="${ink}" stroke-width="2"/>`);
  } else {
    // etiqueta tejida con los extremos doblados hacia atrás
    parts.push(`<rect x="2" y="6" width="${W - 4}" height="${H - 12}" rx="3" fill="${mixHex(bg, '#000000', 0.35)}" opacity="0.35"/>`);
    parts.push(`<rect x="0" y="4" width="${W}" height="${H - 10}" rx="2.5" fill="${data.material === 'raso' ? `url(#${id}-sat)` : `url(#${id}-weave)`}"/>`);
    if (data.material === 'raso') parts.push(`<rect x="0" y="4" width="${W}" height="${H - 10}" rx="2.5" fill="url(#${id}-weave)"/>`);
    // orillos tejidos arriba y abajo
    parts.push(`<rect x="0" y="4" width="${W}" height="5" fill="${mixHex(bg, accent, 0.35)}" opacity="0.9"/>`);
    parts.push(`<rect x="0" y="${H - 11}" width="${W}" height="5" fill="${mixHex(bg, accent, 0.35)}" opacity="0.9"/>`);
    // dobleces de los extremos (más oscuros) con la línea de costura
    for (const x of [0, W - 16]) {
      parts.push(`<rect x="${x}" y="4" width="16" height="${H - 10}" fill="${mixHex(bg, '#000000', 0.22)}"/>`);
      parts.push(`<line x1="${x + 8}" y1="8" x2="${x + 8}" y2="${H - 10}" stroke="${mixHex(bg, '#ffffff', 0.45)}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
    }
    parts.push(`<line x1="16" y1="4" x2="16" y2="${H - 6}" stroke="#000" stroke-opacity="0.25"/>`);
    parts.push(`<line x1="${W - 16}" y1="4" x2="${W - 16}" y2="${H - 6}" stroke="#000" stroke-opacity="0.25"/>`);
    parts.push(`<g>`);
  }

  // contenido
  const cx = W / 2;
  const bs = brandSize(brand);
  // línea de base: la marca queda centrada en la franja de arriba y las descendentes (g, j, p)
  // no tocan el recuadro del talle (que empieza en y = 56)
  parts.push(`<text x="${cx}" y="${(30 + bs * 0.4).toFixed(1)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="700" font-size="${bs.toFixed(1)}" fill="${ink}">${esc(brand)}</text>`);
  // filete y talle
  parts.push(`<line x1="${cx - 92}" y1="66" x2="${cx - 30}" y2="66" stroke="${accent}" stroke-width="1.3"/>`);
  parts.push(`<line x1="${cx + 30}" y1="66" x2="${cx + 92}" y2="66" stroke="${accent}" stroke-width="1.3"/>`);
  parts.push(`<rect x="${cx - 24}" y="56" width="48" height="20" rx="4" fill="none" stroke="${ink}" stroke-width="1.6"/>`);
  parts.push(`<text x="${cx}" y="71" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="13.5" fill="${ink}">${esc(data.size || 'M')}</text>`);
  parts.push(`<text x="${cx}" y="95" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="11" letter-spacing="0.6" fill="${ink}">${esc((data.composition || '').toUpperCase())}</text>`);
  // símbolos de cuidado
  const syms = [];
  if (care.wash) syms.push(['wash', care.wash]);
  if (care.bleach) syms.push(['bleach', care.bleach]);
  if (care.dry) syms.push(['dry', care.dry]);
  if (care.iron) syms.push(['iron', care.iron]);
  if (care.reverse) syms.push(['reverse', 1]);
  const s = 29;
  const gap = 9;
  const tw = syms.length * s + (syms.length - 1) * gap;
  let x = cx - tw / 2;
  for (const [k, v] of syms) {
    parts.push(careGroup(k, v, x, 102, s, ink));
    x += s + gap;
  }
  if (!syms.length) parts.push(`<text x="${cx}" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="10.5" fill="${ink}" opacity="0.6">(elegí los símbolos de cuidado)</text>`);
  parts.push(`<text x="${cx}" y="${printed ? H - 24 : H - 18}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="8.6" letter-spacing="2.2" fill="${ink}" opacity="0.85">HECHO A MANO · INDUSTRIA ARGENTINA</text>`);
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('');
}

// SVG (string) → canvas (para la textura 3D). Devuelve una promesa.
export function svgToCanvas(svg, w = 512, h = Math.round((512 * LABEL_H) / LABEL_W), canvas = null) {
  return new Promise((resolve) => {
    const c = canvas || document.createElement('canvas');
    c.width = w;
    c.height = h;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Malla de la etiqueta cosida adentro del cuello (lado de la espalda). Sigue la curvatura del panel.
// Coordenadas de prenda: centrada en x = 0, colgando desde justo debajo del ribb.
export function createNeckLabel(shirt, { width = 0.054, height = 0.028, printed = false } = {}) {
  const pat = shirt.pattern;
  const bnd = pat?.construction?.bnd ?? 0.02;
  const top = -bnd - (printed ? 0.024 : 0.019);
  const nx = 12;
  const ny = 6;
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
  const idx = [];
  let k = 0;
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    const y = top - height * (1 - v);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = (u - 0.5) * width;
      // la espalda se expresa en coords de prenda (x de frente): de adentro, mirando hacia la espalda,
      // la x de prenda va hacia la derecha del que mira
      const { position } = shirt.garmentToLocal('espalda', x, y, printed ? -0.0006 : -0.0016 - 0.0012 * Math.sin(Math.PI * u));
      pos[k * 3] = position.x;
      pos[k * 3 + 1] = position.y;
      pos[k * 3 + 2] = position.z;
      uv[k * 2] = u;
      uv[k * 2 + 1] = v;
      k++;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(document.createElement('canvas'));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: printed ? 0.9 : 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: printed,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'etiqueta-cuello';
  mesh.renderOrder = 3;
  mesh.receiveShadow = true;
  mesh.userData.kind = 'label';
  mesh.visible = false; // hasta que llegue la primera textura
  return {
    mesh,
    async setSVG(svg) {
      const c = await svgToCanvas(svg, 768, Math.round((768 * LABEL_H) / LABEL_W));
      if (!c) return;
      tex.image = c;
      tex.needsUpdate = true;
      mesh.visible = true;
    },
    dispose() {
      geo.dispose();
      tex.dispose();
      mat.dispose();
      if (mesh.parent) mesh.parent.remove(mesh);
    },
  };
}
