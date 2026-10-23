// Sala del taller: piso de tablones, paredes de revoque con friso machimbrado,
// zócalo, guardasilla, techo con vigas y ventanas con luz de día.

import { THREE, Batch, std, basic, phys, mesh, scaleUV, PALETTE, woodMaterial } from './common.js';
import { floorTextures, plasterTextures, beadboardTextures, drawTexture, softSprite } from './textures.js';
import { ROOM } from '../../data/stations.js';
import { rng } from '../../core/utils.js';

const WAINSCOT = 0.95; // altura del friso

export function floorMaterial() {
  const T = floorTextures();
  return std('piso-madera', {
    map: T.map,
    normalMap: T.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: T.roughnessMap,
    roughness: 1,
    metalness: 0,
  });
}

export function plasterMaterial(color = PALETTE.wall) {
  const T = plasterTextures();
  return std(`revoque-${color}`, { color, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.16, 0.16), roughness: 0.92 });
}

export function beadboardMaterial(color = PALETTE.sage) {
  const T = beadboardTextures();
  return std(`friso-${color}`, { color, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.6 });
}

export const trimMaterial = () => std('moldura-crema', { color: '#f1e9da', roughness: 0.5 });

// Vista del exterior (cielo, árboles lejanos) para los vidrios de las ventanas.
function outsideTexture() {
  return drawTexture(
    512,
    512,
    (ctx, w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#9fc3dd');
      sky.addColorStop(0.55, '#d9e8f0');
      sky.addColorStop(1, '#f4f1e6');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      // nubes suaves
      const r = rng(5);
      for (let i = 0; i < 14; i++) {
        const x = r() * w;
        const y = r() * h * 0.45;
        const rad = 40 + r() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // copas de árboles lejanos (desenfocadas)
      ctx.filter = 'blur(6px)';
      for (let i = 0; i < 26; i++) {
        const x = r() * w;
        const y = h * (0.62 + r() * 0.12);
        const rad = 30 + r() * 50;
        ctx.fillStyle = ['#8fae7c', '#7c9c6a', '#a3bd8b', '#6f8f5e'][i % 4];
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#9cb488';
      ctx.fillRect(0, h * 0.74, w, h * 0.3);
      // casita lejana
      ctx.fillStyle = '#e9d6bf';
      ctx.fillRect(w * 0.62, h * 0.6, w * 0.16, h * 0.14);
      ctx.fillStyle = '#c98a68';
      ctx.beginPath();
      ctx.moveTo(w * 0.6, h * 0.61);
      ctx.lineTo(w * 0.7, h * 0.53);
      ctx.lineTo(w * 0.8, h * 0.61);
      ctx.fill();
      ctx.filter = 'none';
    },
    { key: 'exterior' },
  );
}

// Ventana de dos hojas con travesaño. Se arma en el plano XY (frente hacia +Z),
// apoyada sobre la pared en z = 0; devuelve el grupo y agrega lo estático al batch.
function buildWindow(batch, { w, h, matrix }) {
  const frame = trimMaterial();
  const glassBack = basic('ventana-exterior', { map: outsideTexture(), color: new THREE.Color(1.45, 1.42, 1.36), fog: false });
  const parts = [];
  const add = (g, m, p, opts = {}) => parts.push({ g, m, p, ...opts });
  const t = 0.07; // ancho de marco
  // exterior "vista" (al ras de la pared)
  add(new THREE.PlaneGeometry(w, h), glassBack, [0, 0, 0.004]);
  // contramarco
  add(new THREE.BoxGeometry(w + t * 2, t, 0.05), frame, [0, h / 2 + t / 2, 0.025]);
  add(new THREE.BoxGeometry(w + t * 2, t * 0.8, 0.05), frame, [0, -h / 2 - t * 0.4, 0.025]);
  add(new THREE.BoxGeometry(t, h, 0.05), frame, [-w / 2 - t / 2, 0, 0.025]);
  add(new THREE.BoxGeometry(t, h, 0.05), frame, [w / 2 + t / 2, 0, 0.025]);
  // hojas: marco interior y parante central
  const s = 0.045;
  add(new THREE.BoxGeometry(s, h, 0.035), frame, [0, 0, 0.03]);
  add(new THREE.BoxGeometry(w, s * 0.8, 0.03), frame, [0, h * 0.18, 0.028]);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(s * 0.6, h, 0.025), frame, [sx * (w / 2 - s * 0.3), 0, 0.022]);
  }
  add(new THREE.BoxGeometry(w, s * 0.6, 0.025), frame, [0, h / 2 - s * 0.3, 0.022]);
  add(new THREE.BoxGeometry(w, s * 0.6, 0.025), frame, [0, -h / 2 + s * 0.3, 0.022]);
  // alféizar
  add(new THREE.BoxGeometry(w + t * 2 + 0.08, 0.035, 0.16), frame, [0, -h / 2 - t * 0.8 - 0.0175, 0.08], { cast: true });
  add(new THREE.BoxGeometry(w + t * 1.2, 0.06, 0.02), frame, [0, -h / 2 - t * 0.8 - 0.065, 0.01]);
  const M = new THREE.Matrix4();
  for (const pt of parts) {
    M.makeTranslation(pt.p[0], pt.p[1], pt.p[2]);
    M.premultiply(matrix);
    batch.add(pt.g, pt.m, { matrix: M.clone(), uv: pt.m === glassBack ? 'keep' : 'box', cast: !!pt.cast });
    pt.g.dispose();
  }
}

// Reflejo de vidrio sutil (un plano transparente con reflejo del entorno).
function glassMaterial() {
  return phys('vidrio-ventana', {
    color: '#ffffff',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.12,
    envMapIntensity: 1.2,
    depthWrite: false,
  });
}

export function createRoom() {
  const group = new THREE.Group();
  group.name = 'sala';
  const b = new Batch();
  const { minX, maxX, backZ, frontZ, height } = ROOM;
  const W = maxX - minX;
  const D = frontZ - backZ;

  // --- piso ---
  const floorGeo = new THREE.PlaneGeometry(W, D);
  scaleUV(floorGeo, W, D);
  const floor = mesh(floorGeo, floorMaterial(), { receive: true, name: 'piso', r: [-Math.PI / 2, 0, 0], p: [(minX + maxX) / 2, 0, (backZ + frontZ) / 2] });
  group.add(floor);

  // --- paredes: revoque arriba, friso abajo, guardasilla y zócalo ---
  const plaster = plasterMaterial();
  const bead = beadboardMaterial();
  const trim = trimMaterial();
  const walls = [
    // [largo, matriz: origen en el extremo izquierdo visto desde adentro, rotY]
    { len: W, p: [minX, 0, backZ], ry: 0 },
    { len: D, p: [minX, 0, frontZ], ry: Math.PI / 2 },
    { len: D, p: [maxX, 0, backZ], ry: -Math.PI / 2 },
  ];
  for (const wl of walls) {
    const M = new THREE.Matrix4().makeRotationY(wl.ry).setPosition(wl.p[0], wl.p[1], wl.p[2]);
    const local = (g, m, x, y, z, opts = {}) => {
      const L = new THREE.Matrix4().makeTranslation(x, y, z).premultiply(M);
      b.add(g, m, { matrix: L, ...opts });
      g.dispose();
    };
    const up = new THREE.PlaneGeometry(wl.len, height - WAINSCOT);
    scaleUV(up, wl.len, height - WAINSCOT);
    local(up, plaster, wl.len / 2, WAINSCOT + (height - WAINSCOT) / 2, 0, { uv: 'keep' });
    local(new THREE.BoxGeometry(wl.len, WAINSCOT, 0.014), bead, wl.len / 2, WAINSCOT / 2, 0.007, { uv: 'box', grain: 'x' });
    local(new THREE.BoxGeometry(wl.len, 0.045, 0.03), trim, wl.len / 2, WAINSCOT + 0.01, 0.015, { uv: 'box' });
    local(new THREE.BoxGeometry(wl.len, 0.02, 0.04), trim, wl.len / 2, WAINSCOT + 0.04, 0.02, { uv: 'box' });
    local(new THREE.BoxGeometry(wl.len, 0.12, 0.024), trim, wl.len / 2, 0.06, 0.026, { uv: 'box' });
    // moldura de techo
    local(new THREE.BoxGeometry(wl.len, 0.07, 0.05), trim, wl.len / 2, height - 0.035, 0.025, { uv: 'box' });
  }

  // --- techo con vigas ---
  const ceilMat = std('techo', { color: '#f6efe4', emissive: '#6e6152', roughness: 0.95, map: plasterTextures().map });
  const ceil = new THREE.PlaneGeometry(W, D);
  scaleUV(ceil, W, D);
  b.add(ceil, ceilMat, { uv: 'keep', p: [(minX + maxX) / 2, height, (backZ + frontZ) / 2], r: [Math.PI / 2, 0, 0], receive: false });
  ceil.dispose();
  const beamMat = woodMaterial('pino', { color: '#d9b994' });
  // vigas de adelante hacia atrás (en perspectiva se ven como líneas que fugan)
  for (const x of [-5.25, -1.75, 1.75, 5.25]) {
    b.box(0.16, 0.2, D, beamMat, { p: [x, height - 0.1, (backZ + frontZ) / 2], grain: 'z', receive: false });
  }
  // viga maestra junto a la pared del fondo
  b.box(W, 0.18, 0.14, beamMat, { p: [(minX + maxX) / 2, height - 0.09, backZ + 0.07], grain: 'x', receive: false });

  // --- ventanas ---
  const windows = [
    { w: 1.15, h: 1.2, p: [-1.0, 1.15 + 0.6, backZ], ry: 0 },
    { w: 1.05, h: 1.2, p: [1.35, 1.15 + 0.6, backZ], ry: 0 },
    { w: 1.4, h: 1.35, p: [minX, 1.0 + 0.675, 0.4], ry: Math.PI / 2 },
    { w: 1.4, h: 1.35, p: [maxX, 1.0 + 0.675, 0.4], ry: -Math.PI / 2 },
  ];
  const glass = glassMaterial();
  for (const win of windows) {
    const M = new THREE.Matrix4().makeRotationY(win.ry).setPosition(win.p[0], win.p[1], win.p[2]);
    buildWindow(b, { w: win.w, h: win.h, matrix: M });
    const gl = mesh(new THREE.PlaneGeometry(win.w, win.h), glass, { receive: false, name: 'vidrio' });
    gl.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.03).premultiply(M));
    gl.renderOrder = 2;
    group.add(gl);
  }

  // halo de luz de día alrededor de las ventanas (aditivo, muy sutil)
  const haloMat = basic('halo-ventana', {
    map: softSprite('halo', 'rgba(255,246,228,1)', 'rgba(255,246,228,0)'),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  for (const win of windows) {
    const halo = mesh(new THREE.PlaneGeometry(win.w * 2.4, win.h * 2.2), haloMat, { receive: false, name: 'halo' });
    halo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.1, 0.06).premultiply(new THREE.Matrix4().makeRotationY(win.ry).setPosition(win.p[0], win.p[1], win.p[2])));
    halo.renderOrder = 3;
    group.add(halo);
  }

  b.flush(group, 'sala');
  return { group, windows };
}
