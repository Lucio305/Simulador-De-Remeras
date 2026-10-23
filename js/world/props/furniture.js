// Muebles del taller: mesa de corte, mesa de costura, mesa de estampado con repisa,
// carrito de herramientas, banquetas, cajonera de mercería y estantes de pared.

import {
  THREE, Batch, std, mesh, woodMaterial, brass, steel, blackPaint, rubber, PALETTE, V3, lathe, rand, vc,
} from './common.js';
import { cuttingMatTexture, cardboardTextures, drawTexture } from './textures.js';
import { getFabricMaterial } from '../../materials/fabric.js';

export const cardboard = () => {
  const T = cardboardTextures();
  return std('carton', { color: '#ffffff', map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.92 });
};
const paintedMetal = (hex, key) => std(`metal-pintado-${key || hex}`, { color: hex, roughness: 0.42, metalness: 0.35 });

// Pila de telas dobladas (decorativa) con el material de tela real.
export function foldedStack(b, { x, y, z, w = 0.34, d = 0.26, colors, fabric = 'algodon_jersey', ry = 0 }) {
  let yy = y;
  for (let i = 0; i < colors.length; i++) {
    const h = 0.03 + rand() * 0.012;
    const mat = getFabricMaterial(fabric, '#ffffff', { side: THREE.FrontSide, vertexColors: true });
    const jitter = (rand() - 0.5) * 0.02;
    b.box(w + (rand() - 0.5) * 0.02, h, d + (rand() - 0.5) * 0.015, mat, {
      radius: 0.012,
      seg: 3,
      p: [x + jitter * Math.cos(ry), yy + h / 2, z + jitter * Math.sin(ry)],
      r: [0, ry + (rand() - 0.5) * 0.08, 0],
      grain: 'x',
      color: colors[i],
      cast: i === colors.length - 1,
    });
    yy += h;
  }
  return yy;
}

// Caja de cartón con tapa y cinta.
export function cardboardBox(b, { x, y = 0, z, w, h, d, ry = 0, open = false }) {
  const mat = cardboard();
  const tape = std('cinta-embalar', { color: '#c9a36a', roughness: 0.35 });
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const add = (geo, m, px, py, pz, opts = {}) => {
    b.add(geo, m, { matrix: new THREE.Matrix4().makeTranslation(px, py, pz).premultiply(M), uv: 'box', ...opts });
    geo.dispose();
  };
  add(new THREE.BoxGeometry(w, h, d), mat, 0, h / 2, 0, { cast: true });
  if (!open) add(new THREE.BoxGeometry(0.06, 0.002, d + 0.002), tape, 0, h + 0.001, 0);
  add(new THREE.BoxGeometry(0.06, h * 0.3, 0.002), tape, 0, h - h * 0.15, d / 2 + 0.001);
}

// ---------------------------------------------------------------------------
// Mesa de corte 2.0 × 1.3 (tapa a 0.9 m) con base de corte verde
// ---------------------------------------------------------------------------

export function createCuttingTable({ center, size = [2.0, 1.3] }) {
  const group = new THREE.Group();
  group.name = 'mesa-corte';
  group.position.set(center[0], 0, center[2]);
  const b = new Batch();
  const [W, D] = size;
  const topY = center[1];
  const matT = 0.003;
  const topT = 0.045;
  const wTop = woodMaterial('haya', { key: '-tapa' });
  const wLeg = woodMaterial('roble', { color: '#b58d6a' });
  const yTop = topY - matT;
  b.box(W, topT, D, wTop, { p: [0, yTop - topT / 2, 0], radius: 0.008, seg: 2, grain: 'x', cast: true });
  // patas robustas y faldón
  const lx = W / 2 - 0.09;
  const lz = D / 2 - 0.09;
  const legH = yTop - topT;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(0.085, legH, 0.085, wLeg, { p: [sx * lx, legH / 2, sz * lz], grain: 'y', cast: true, radius: 0.006 });
  }
  for (const sz of [-1, 1]) b.box(W - 0.24, 0.11, 0.028, wLeg, { p: [0, legH - 0.055, sz * (lz + 0.02)], grain: 'x' });
  for (const sx of [-1, 1]) b.box(0.028, 0.11, D - 0.24, wLeg, { p: [sx * (lx + 0.02), legH - 0.055, 0], grain: 'z' });
  // estante inferior con travesaños
  const shelfY = 0.2;
  for (const sz of [-1, 1]) b.box(W - 0.2, 0.05, 0.04, wLeg, { p: [0, shelfY - 0.03, sz * lz], grain: 'x' });
  b.box(W - 0.2, 0.022, D - 0.22, wTop, { p: [0, shelfY + 0.006, 0], grain: 'x' });
  // cosas en el estante: telas dobladas, rollo de papel para moldes, caja
  foldedStack(b, { x: -0.6, y: shelfY + 0.017, z: 0.05, colors: ['#e7dcc4', '#1f2a46', '#93c6e6', '#cf9a2c', '#f3f1ea'] });
  foldedStack(b, { x: -0.18, y: shelfY + 0.017, z: 0.1, colors: ['#6a1f2c', '#9b9a97', '#8fd0b8', '#1e1e21'], fabric: 'pique' });
  cardboardBox(b, { x: 0.45, y: shelfY + 0.017, z: 0.05, w: 0.42, h: 0.26, d: 0.5, ry: 0.06 });
  const paper = std('papel-madera', { color: '#cfa978', roughness: 0.85 });
  b.cyl(0.07, 0.07, 1.0, paper, { p: [0.05, shelfY + 0.087, -0.38], r: [0, 0, Math.PI / 2], seg: 24, cast: true });
  b.cyl(0.022, 0.022, 1.02, cardboard(), { p: [0.05, shelfY + 0.087, -0.38], r: [0, 0, Math.PI / 2], seg: 12 });
  b.flush(group, 'mesa-corte');

  // base de corte (textura única)
  const mw = W - 0.04;
  const md = D - 0.04;
  const matTex = cuttingMatTexture(mw, md);
  const matMat = std('base-corte', { map: matTex, roughness: 0.72, metalness: 0 });
  const top = mesh(new THREE.PlaneGeometry(mw, md), matMat, { receive: true, r: [-Math.PI / 2, 0, 0], p: [0, topY, 0], name: 'base-corte' });
  group.add(top);
  const edge = mesh(new THREE.BoxGeometry(mw, matT, md), std('base-corte-canto', { color: '#24583f', roughness: 0.7 }), { p: [0, topY - matT / 2 - 0.0002, 0] });
  group.add(edge);

  return {
    group,
    topY,
    center: V3(center[0], topY, center[2]),
    size: [W, D],
  };
}

// ---------------------------------------------------------------------------
// Mesa de costura (tapa a 0.76 m) con cajonera
// ---------------------------------------------------------------------------

export function createSewingTable({ center, size = [1.3, 0.65] }) {
  const group = new THREE.Group();
  group.name = 'mesa-costura';
  group.position.set(center[0], 0, center[2]);
  const b = new Batch();
  const [W, D] = size;
  const topY = center[1];
  const t = 0.035;
  const wTop = woodMaterial('roble', { key: '-costura' });
  const wBody = woodMaterial('nogal', { color: '#d6b89a' });
  b.box(W, t, D, wTop, { p: [0, topY - t / 2, 0], radius: 0.006, seg: 2, grain: 'x', cast: true });
  // cajonera a la derecha (desde la persona, que mira a -Z)
  const cw = 0.42;
  const ch = topY - t - 0.06;
  const cx = W / 2 - cw / 2 - 0.02;
  b.box(cw, ch, D - 0.06, wBody, { p: [cx, 0.06 + ch / 2, -0.01], grain: 'y', cast: true });
  b.box(cw - 0.04, 0.05, D - 0.1, wBody, { p: [cx, 0.025, -0.01], grain: 'x' });
  const pull = brass();
  const nDr = 3;
  for (let i = 0; i < nDr; i++) {
    const dh = (ch - 0.02) / nDr;
    const y = 0.06 + 0.01 + dh * (i + 0.5);
    b.box(cw - 0.03, dh - 0.012, 0.018, wTop, { p: [cx, y, D / 2 - 0.03], radius: 0.004, seg: 2, grain: 'x' });
    b.box(0.09, 0.012, 0.012, pull, { p: [cx, y + dh * 0.12, D / 2 - 0.012], radius: 0.005, seg: 2 });
  }
  // patas cónicas a la izquierda, levemente abiertas
  for (const sz of [-1, 1]) {
    const leg = lathe([[0.0, 0], [0.016, 0], [0.017, 0.02], [0.024, ch + 0.06 - 0.02], [0.0, ch + 0.06 - 0.02]], 12);
    b.add(leg, wBody, { p: [-W / 2 + 0.09, 0, sz * (D / 2 - 0.09)], r: [sz * 0.05, 0, 0.05], uv: 'cyl', cyl: [0.02, ch], cast: true });
    leg.dispose();
  }
  b.box(W - cw - 0.12, 0.08, 0.022, wBody, { p: [-W / 2 + (W - cw - 0.12) / 2 + 0.05, topY - t - 0.04, -D / 2 + 0.06], grain: 'x' });
  b.flush(group, 'mesa-costura');
  return { group, topY, center: V3(center[0], topY, center[2]), size };
}

// ---------------------------------------------------------------------------
// Mesa de estampado (tapa a 0.9 m), estructura metálica y repisa trasera
// ---------------------------------------------------------------------------

export function createPrintTable({ center, size = [1.7, 0.85] }) {
  const group = new THREE.Group();
  group.name = 'mesa-estampado';
  group.position.set(center[0], 0, center[2]);
  const b = new Batch();
  const [W, D] = size;
  const topY = center[1];
  const t = 0.04;
  const top = woodMaterial('pino', { key: '-estampado' });
  const frame = paintedMetal(PALETTE.teal, 'verde-agua');
  b.box(W, t, D, top, { p: [0, topY - t / 2, 0], radius: 0.005, seg: 2, grain: 'x', cast: true });
  // patas de caño cuadrado
  const legH = topY - t;
  const lx = W / 2 - 0.05;
  const lz = D / 2 - 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.045, legH, 0.045, frame, { p: [sx * lx, legH / 2, sz * lz], radius: 0.004, seg: 1, cast: true });
  for (const sz of [-1, 1]) b.box(W - 0.1, 0.04, 0.03, frame, { p: [0, legH - 0.02, sz * lz], radius: 0.003, seg: 1 });
  for (const sx of [-1, 1]) b.box(0.03, 0.04, D - 0.1, frame, { p: [sx * lx, legH - 0.02, 0], radius: 0.003, seg: 1 });
  // estante inferior
  const shY = 0.16;
  for (const sz of [-1, 1]) b.box(W - 0.1, 0.03, 0.03, frame, { p: [0, shY - 0.02, sz * lz], radius: 0.003, seg: 1 });
  b.box(W - 0.08, 0.02, D - 0.08, top, { p: [0, shY, 0], grain: 'x' });
  // remeras lisas dobladas listas para estampar + baldes de tinta
  foldedStack(b, { x: -0.55, y: shY + 0.01, z: 0.05, colors: ['#f3f1ea', '#f3f1ea', '#1e1e21', '#1e1e21', '#9b9a97'] });
  foldedStack(b, { x: -0.12, y: shY + 0.01, z: 0.08, colors: ['#f3f1ea', '#e7dcc4', '#1f2a46', '#b42b2b'] });
  const bucket = std('balde-blanco', { color: '#eeeae2', roughness: 0.4 });
  const lids = ['#1e1e21', '#c42b2b', '#2f5cb6'];
  lids.forEach((lc, i) => {
    const x = 0.32 + i * 0.17;
    const g = lathe([[0, 0], [0.065, 0], [0.075, 0.17], [0.078, 0.175], [0, 0.175]], 20);
    b.add(g, bucket, { p: [x, shY + 0.01, 0.02 + (i % 2) * 0.1], cast: true });
    g.dispose();
    b.cyl(0.079, 0.079, 0.018, vc('plastico'), { color: lc, p: [x, shY + 0.194, 0.02 + (i % 2) * 0.1], seg: 20 });
  });
  // repisa trasera (estante de dos niveles sobre el fondo de la mesa)
  const hz = -D / 2 + 0.085;
  const hW = W - 0.02;
  const back = woodMaterial('pino', { color: '#e8d2b6', key: '-repisa' });
  b.box(hW, 0.6, 0.015, back, { p: [0, topY + 0.3, -D / 2 + 0.0075], grain: 'x' });
  for (const sx of [-1, 1]) b.box(0.018, 0.6, 0.17, back, { p: [sx * (hW / 2 - 0.009), topY + 0.3, hz], grain: 'y', cast: true });
  for (const y of [0.3, 0.58]) b.box(hW - 0.036, 0.018, 0.165, back, { p: [0, topY + y, hz + 0.005], grain: 'x', cast: true });
  b.flush(group, 'mesa-estampado');
  return {
    group,
    topY,
    center: V3(center[0], topY, center[2]),
    size,
    hutch: { z: center[2] + hz, shelves: [topY + 0.309, topY + 0.589], front: center[2] + hz + 0.085, width: hW },
  };
}

// ---------------------------------------------------------------------------
// Carrito auxiliar de herramientas (dos bandejas)
// ---------------------------------------------------------------------------

export function createToolCart({ position, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'carrito';
  group.position.set(position[0], 0, position[2]);
  group.rotation.y = ry;
  const b = new Batch();
  const W = 0.46;
  const D = 0.36;
  const col = paintedMetal(PALETTE.mint, 'menta');
  const topY = 0.82;
  const trays = [0.16, 0.5, topY];
  for (const y of trays) {
    b.box(W, 0.012, D, col, { p: [0, y - 0.006, 0], radius: 0.004, seg: 1, cast: y === topY });
    // bordes de bandeja
    for (const sz of [-1, 1]) b.box(W, 0.035, 0.008, col, { p: [0, y + 0.0115, sz * (D / 2 - 0.004)] });
    for (const sx of [-1, 1]) b.box(0.008, 0.035, D, col, { p: [sx * (W / 2 - 0.004), y + 0.0115, 0] });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cyl(0.009, 0.009, topY - 0.06, col, { p: [sx * (W / 2 - 0.012), 0.06 + (topY - 0.06) / 2, sz * (D / 2 - 0.012)], seg: 10 });
      b.cyl(0.024, 0.024, 0.02, rubber(), { p: [sx * (W / 2 - 0.03), 0.026, sz * (D / 2 - 0.03)], r: [0, 0, Math.PI / 2], seg: 14 });
      b.box(0.02, 0.03, 0.02, steel(), { p: [sx * (W / 2 - 0.03), 0.05, sz * (D / 2 - 0.03)] });
    }
  }
  // cosas en las bandejas de abajo
  cardboardBox(b, { x: -0.08, y: 0.16, z: 0, w: 0.26, h: 0.12, d: 0.2, ry: 0.1 });
  foldedStack(b, { x: 0.05, y: 0.5, z: 0, w: 0.3, d: 0.22, colors: ['#e5732b', '#f1cc4e', '#8fd0b8'] });
  b.flush(group, 'carrito');
  return { group, topY: topY + 0.0 };
}

// ---------------------------------------------------------------------------
// Banqueta redonda de madera
// ---------------------------------------------------------------------------

export function addStool(b, { x, z, h = 0.62, ry = 0 }) {
  const seat = woodMaterial('roble', { key: '-banqueta' });
  const legs = woodMaterial('nogal', { color: '#cfb08f', key: '-banqueta' });
  const sg = lathe([[0, 0], [0.17, 0], [0.18, 0.012], [0.18, 0.03], [0.17, 0.04], [0, 0.042]], 28);
  b.add(sg, seat, { p: [x, h - 0.042, z], uv: 'box', cast: true });
  sg.dispose();
  for (let i = 0; i < 4; i++) {
    const a = ry + (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = V3(x + Math.cos(a) * 0.1, h - 0.04, z + Math.sin(a) * 0.1);
    const bot = V3(x + Math.cos(a) * 0.17, 0, z + Math.sin(a) * 0.17);
    const len = top.distanceTo(bot);
    const g = new THREE.CylinderGeometry(0.016, 0.019, len, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), top.clone().sub(bot).normalize());
    b.add(g, legs, { matrix: new THREE.Matrix4().compose(top.clone().add(bot).multiplyScalar(0.5), q, V3(1, 1, 1)), uv: 'box', cast: true });
    g.dispose();
  }
  const ring = new THREE.TorusGeometry(0.15, 0.009, 8, 32);
  b.add(ring, legs, { p: [x, 0.22, z], r: [Math.PI / 2, 0, 0], uv: 'box' });
  ring.dispose();
}

// ---------------------------------------------------------------------------
// Cajonera de mercería (cajoncitos con etiquetas) — debajo del rack de hilos
// ---------------------------------------------------------------------------

export function createNotionsCabinet({ position, w = 0.82, h = 0.92, d = 0.4 }) {
  const group = new THREE.Group();
  group.name = 'cajonera';
  group.position.set(position[0], 0, position[2]);
  const b = new Batch();
  const body = woodMaterial('nogal', { color: '#e4c8a8', key: '-cajonera' });
  const front = woodMaterial('roble', { color: '#f0dcc0', key: '-cajones' });
  b.box(w, h - 0.06, d, body, { p: [0, 0.06 + (h - 0.06) / 2, 0], grain: 'y', cast: true });
  b.box(w + 0.03, 0.03, d + 0.03, body, { p: [0, h + 0.015, 0.0], radius: 0.006, seg: 2, grain: 'x', cast: true });
  b.box(w - 0.04, 0.06, d - 0.04, body, { p: [0, 0.03, 0], grain: 'x' });
  const labels = drawTexture(
    256,
    64,
    (ctx, W, H) => {
      ctx.fillStyle = '#f3ead6';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#8c7458';
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    },
    { key: 'etiqueta-cajon' },
  );
  const labelMat = std('etiqueta-cajon', { map: labels, roughness: 0.8 });
  const pull = brass();
  const cols = 4;
  const rows = 5;
  const dw = (w - 0.04) / cols;
  const dh = (h - 0.1) / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = -w / 2 + 0.02 + dw * (i + 0.5);
      const y = 0.08 + dh * (j + 0.5);
      b.box(dw - 0.01, dh - 0.01, 0.02, front, { p: [x, y, d / 2 + 0.005], radius: 0.003, seg: 1, grain: 'x' });
      const lg = new THREE.PlaneGeometry(0.07, 0.022);
      b.add(lg, labelMat, { p: [x, y + dh * 0.18, d / 2 + 0.0155], uv: 'keep' });
      lg.dispose();
      b.cyl(0.009, 0.007, 0.014, pull, { p: [x, y - dh * 0.12, d / 2 + 0.022], r: [Math.PI / 2, 0, 0], seg: 10 });
    }
  }
  b.flush(group, 'cajonera');
  return { group, topY: h + 0.03 };
}

// ---------------------------------------------------------------------------
// Estante de pared con ménsulas
// ---------------------------------------------------------------------------

export function addWallShelf(b, { x, y, z, w, d = 0.22, ry = 0, wood = 'roble' }) {
  const m = woodMaterial(wood, { key: '-estante' });
  const br = blackPaint();
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const add = (g, mat, px, py, pz, opts = {}) => {
    b.add(g, mat, { matrix: new THREE.Matrix4().makeTranslation(px, py, pz).premultiply(M), uv: 'box', ...opts });
    g.dispose();
  };
  add(new THREE.BoxGeometry(w, 0.028, d), m, 0, 0, d / 2, { cast: true, grain: 'x' });
  for (const sx of [-1, 1]) {
    // ménsula en L de hierro
    add(new THREE.BoxGeometry(0.018, 0.006, d * 0.8), br, sx * (w / 2 - 0.12), -0.017, d * 0.4);
    add(new THREE.BoxGeometry(0.018, d * 0.7, 0.006), br, sx * (w / 2 - 0.12), -0.014 - d * 0.35, 0.003);
    const diag = new THREE.BoxGeometry(0.014, 0.006, d * 0.85);
    diag.rotateX(-Math.PI / 4);
    add(diag, br, sx * (w / 2 - 0.12), -0.014 - d * 0.33, d * 0.3);
  }
  return { topY: y + 0.014 };
}
