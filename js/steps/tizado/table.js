// Tizado · la tela extendida sobre la mesa de corte (en la posición de fabricOrigin()),
// con orillos marcados, el rollo al final, el overlay rojo de superposiciones, el sobrante
// rayado, la marca del largo usado y las líneas de tiza que deja la tiza al recorrer los moldes.

import * as THREE from 'three';
import { getFabricMaterial } from '../../materials/fabric.js';
import { luminance } from '../../data/catalog.js';
import { FABRIC_WIDTH, FABRIC_MAX_LENGTH, fabricOrigin } from '../shared/fabricLayout.js';
import { COLS, ROWS, SELVEDGE } from './raster.js';
import { ribbonGeometry } from './paper.js';

const L = FABRIC_MAX_LENGTH;
const W = FABRIC_WIDTH;

function canvasTex(cv, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Plano de tela con uv en metros: u = a lo ancho (z), v = a lo largo (x). Así las columnas de
// mallas / la urdimbre (que en las texturas corren a lo largo de v) quedan paralelas al orillo.
function fabricSheetGeometry(len, wid, th) {
  const pos = [];
  const uv = [];
  const idx = [];
  const quad = (a, b, c, d, ua, ub, uc, ud) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(...ua, ...ub, ...uc, ...ud);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // tapa (mirando +Y): recorrido antihorario visto desde arriba
  quad([0, th, 0], [0, th, wid], [len, th, wid], [len, th, 0], [0, 0], [wid, 0], [wid, len], [0, len]);
  // cantos
  quad([0, 0, wid], [len, 0, wid], [len, th, wid], [0, th, wid], [wid, 0], [wid, len], [wid + th, len], [wid + th, 0]);
  quad([len, 0, 0], [0, 0, 0], [0, th, 0], [len, th, 0], [0, len], [0, 0], [-th, 0], [-th, len]);
  quad([0, 0, 0], [0, 0, wid], [0, th, wid], [0, th, 0], [0, 0], [wid, 0], [wid, -th], [0, -th]);
  quad([len, 0, wid], [len, 0, 0], [len, th, 0], [len, th, wid], [wid, len], [0, len], [0, len + th], [wid, len + th]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function selvedgeCanvas(fabricHex, label) {
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = 24;
  const c = cv.getContext('2d');
  const dark = luminance(fabricHex) < 0.35;
  // banda más tupida
  c.fillStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.42)';
  c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = dark ? 'rgba(255,255,255,0.28)' : 'rgba(80,60,40,0.18)';
  c.fillRect(0, cv.height - 2, cv.width, 2);
  // agujeritos de la rama (cada ~1 cm)
  const step = cv.width / (L * 100);
  for (let x = step * 0.5; x < cv.width; x += step) {
    c.fillStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(60,45,30,0.42)';
    c.beginPath();
    c.arc(x, 5, 1.6, 0, Math.PI * 2);
    c.fill();
  }
  // leyenda impresa en el orillo
  c.font = '700 11px ui-rounded, system-ui, sans-serif';
  c.textBaseline = 'middle';
  c.fillStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(70,52,36,0.55)';
  const txt = `${label}  ·  ORILLO  ·  ⟵ HILO ⟶  ·  `;
  const tw = c.measureText(txt).width;
  for (let x = 30; x < cv.width; x += tw + 30) c.fillText(txt, x, 15);
  return cv;
}

// Ondulaciones suaves + doblez central del rollo + bordes apenas más oscuros (gris para multiplicar).
function shadeCanvas(fabricHex) {
  const w = 512;
  const h = 324;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  const img = c.createImageData(w, h);
  const dark = luminance(fabricHex) < 0.3;
  const amp = dark ? 0.1 : 0.055;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves = Array.from({ length: 6 }, () => ({ kx: (rnd() * 2 - 1) * 6, kz: (rnd() * 2 - 1) * 3.5 + 1.5, ph: rnd() * 6.28, a: 0.3 + rnd() * 0.7 }));
  for (let y = 0; y < h; y++) {
    const z = y / h; // 0..1 a lo ancho
    for (let x = 0; x < w; x++) {
      const u = x / w; // 0..1 a lo largo
      let n = 0;
      for (const wv of waves) n += wv.a * Math.sin(u * wv.kx * 6.28 * 0.5 + z * wv.kz * 6.28 * 0.5 + wv.ph);
      n = n / 3.5; // ~ -1..1
      let v = 1 - amp * (0.5 + 0.5 * n);
      // doblez del rollo a lo largo (centro de la tela)
      const dz = Math.abs(z - 0.5) * W;
      v -= (dark ? 0.1 : 0.07) * Math.exp(-(dz * dz) / (2 * 0.004 * 0.004));
      v -= (dark ? 0.04 : 0.025) * Math.exp(-(dz * dz) / (2 * 0.03 * 0.03));
      // orillos y puntas levemente más oscuros
      const e = Math.min(z, 1 - z) * W;
      v -= 0.05 * Math.exp(-e / 0.012);
      const ex = Math.min(u, 1 - u) * L;
      v -= 0.04 * Math.exp(-ex / 0.015);
      const g = Math.round(255 * Math.max(0, Math.min(1, v)));
      const k = (y * w + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = g;
      img.data[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function contactCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 168;
  const c = cv.getContext('2d');
  c.filter = 'blur(5px)';
  c.fillStyle = '#ffffff';
  c.fillRect(9, 9, 256 - 18, 168 - 18);
  c.filter = 'none';
  return cv;
}

function hatchCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 9;
  for (let k = -64; k < 128; k += 32) {
    c.beginPath();
    c.moveTo(k, 64);
    c.lineTo(k + 64, 0);
    c.stroke();
  }
  return cv;
}

function dashCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 16, 40);
  return cv;
}

// Granulado de tiza: vetas a lo largo de u (largo de la línea).
function chalkGrainCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 32;
  const c = cv.getContext('2d');
  const img = c.createImageData(256, 32);
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rowGain = Array.from({ length: 32 }, () => 0.55 + r() * 0.45);
  for (let y = 0; y < 32; y++) {
    const edge = Math.min(y, 31 - y) / 8;
    for (let x = 0; x < 256; x++) {
      const k = (y * 256 + x) * 4;
      const a = Math.min(1, edge) * rowGain[y] * (0.6 + r() * 0.4) * (r() < 0.06 ? 0.2 : 1);
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

export function chalkColorFor(fabricHex) {
  // tiza celeste sobre telas oscuras; azul más intenso sobre telas claras
  return luminance(fabricHex) < 0.45 ? '#d6ebff' : '#2f68b0';
}

export function createTableScene({ fabric, color, heather, sizeLabel }) {
  const o = fabricOrigin();
  const group = new THREE.Group();
  group.name = 'tizado-mesa';
  group.position.set(o.x0, o.y - 0.0035, o.z0); // la tela tiene 3 mm de espesor: apoya en la base

  // ---- tela ----
  const th = 0.0035;
  const mat = getFabricMaterial(fabric.id, color, { heather: !!heather });
  const sheet = new THREE.Mesh(fabricSheetGeometry(L, W, th), mat);
  sheet.receiveShadow = true;
  sheet.castShadow = false;
  sheet.name = 'tela-extendida';
  group.add(sheet);
  const topY = th; // altura local de la cara de la tela

  // sombreado suave de tela apoyada (ondulaciones, marca del doblez del rollo, bordes) por multiplicación
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: canvasTex(shadeCanvas(color)), blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, toneMapped: false }));
  shade.position.set(L / 2, topY + 0.0001, W / 2);
  shade.renderOrder = 0.5;
  shade.raycast = () => {};
  group.add(shade);
  // sombra de contacto sobre la base de corte
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.07, W + 0.07).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: canvasTex(contactCanvas()), transparent: true, depthWrite: false, color: '#000000', opacity: 0.32 }));
  contact.position.set(L / 2, 0.0004, W / 2);
  contact.renderOrder = 0;
  contact.raycast = () => {};
  group.add(contact);

  // ---- orillos ----
  const label = `${fabric.name.toUpperCase()}  ·  ${Math.round(W * 100)} CM`;
  const selTex = canvasTex(selvedgeCanvas(color, label));
  const selMat = new THREE.MeshStandardMaterial({ map: selTex, transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const [z, flip] of [
    [SELVEDGE / 2, false],
    [W - SELVEDGE / 2, true],
  ]) {
    const g = new THREE.PlaneGeometry(L, SELVEDGE);
    g.rotateX(-Math.PI / 2);
    if (flip) g.rotateY(Math.PI);
    const m = new THREE.Mesh(g, selMat);
    m.position.set(L / 2, topY + 0.0002, z);
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }

  // ---- rollo de tela al final ----
  const R = 0.048;
  const rollGeo = new THREE.CylinderGeometry(R, R, W + 0.02, 40, 1, false);
  rollGeo.rotateX(Math.PI / 2);
  {
    const uv = rollGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * (W + 0.02), uv.getX(i) * Math.PI * 2 * R); // el largo de la tela da la vuelta al rollo
  }
  const roll = new THREE.Mesh(rollGeo, mat);
  roll.position.set(L + 0.012, topY + R - 0.004, W / 2);
  roll.castShadow = true;
  roll.receiveShadow = true;
  group.add(roll);
  const coreMat = new THREE.MeshStandardMaterial({ color: '#b48a5a', roughness: 0.8 });
  for (const s of [-1, 1]) {
    const core = new THREE.Mesh(new THREE.RingGeometry(0.014, R * 0.985, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.78), roughness: 0.9 }));
    core.position.set(roll.position.x, roll.position.y, W / 2 + s * ((W + 0.02) / 2 + 0.0005));
    core.rotation.y = s > 0 ? 0 : Math.PI;
    group.add(core);
    const tube = new THREE.Mesh(new THREE.CircleGeometry(0.014, 20), coreMat);
    tube.position.copy(core.position);
    tube.position.z += s * 0.0004;
    tube.rotation.y = core.rotation.y;
    group.add(tube);
  }

  // ---- sobrante rayado + marca de largo ----
  const hatchTex = canvasTex(hatchCanvas(), { repeat: [1, 1] });
  hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
  const hatchMat = new THREE.MeshBasicMaterial({ map: hatchTex, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
  const hatch = new THREE.Mesh(new THREE.PlaneGeometry(1, W).rotateX(-Math.PI / 2), hatchMat);
  hatch.position.y = topY + 0.0004;
  hatch.renderOrder = 1;
  hatch.visible = false;
  group.add(hatch);
  const dashTex = canvasTex(dashCanvas(), { repeat: [1, W / 0.03] });
  const lineMat = new THREE.MeshBasicMaterial({ map: dashTex, transparent: true, color: chalkColorFor(color), depthWrite: false, toneMapped: false });
  const lenLine = new THREE.Mesh(new THREE.PlaneGeometry(0.006, W).rotateX(-Math.PI / 2), lineMat);
  lenLine.position.set(0, topY + 0.0005, W / 2);
  lenLine.renderOrder = 4;
  lenLine.visible = false;
  group.add(lenLine);
  let shownLen = null;
  const setLength = (len) => {
    if (len == null || len <= 0) {
      hatch.visible = false;
      lenLine.visible = false;
      shownLen = null;
      return;
    }
    shownLen = len;
    const rest = Math.max(0.0001, L - len);
    hatch.visible = rest > 0.01;
    hatch.scale.x = rest;
    hatch.position.x = len + rest / 2;
    hatch.position.z = W / 2;
    hatchTex.repeat.set(rest / 0.05, W / 0.05);
    lenLine.visible = true;
    lenLine.position.x = len;
  };

  // ---- overlay de superposiciones (1 píxel = 1 celda de 1 cm) ----
  const ovCanvas = document.createElement('canvas');
  ovCanvas.width = COLS;
  ovCanvas.height = ROWS;
  const ovCtx = ovCanvas.getContext('2d');
  const ovImg = ovCtx.createImageData(COLS, ROWS);
  const ovTex = canvasTex(ovCanvas);
  ovTex.anisotropy = 1;
  ovTex.generateMipmaps = false;
  ovTex.minFilter = THREE.LinearFilter;
  ovTex.magFilter = THREE.LinearFilter;
  const ovMat = new THREE.MeshBasicMaterial({ map: ovTex, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false, toneMapped: false });
  const ovGeo = new THREE.PlaneGeometry(L, W);
  ovGeo.rotateX(-Math.PI / 2);
  // la fila 0 del canvas (arriba) corresponde a z = 0 (orillo de atrás)
  const overlay = new THREE.Mesh(ovGeo, ovMat);
  overlay.position.set(L / 2, topY + 0.03, W / 2);
  overlay.renderOrder = 20;
  overlay.visible = false;
  group.add(overlay);
  let overlapCells = 0;
  const setOverlap = (count) => {
    const d = ovImg.data;
    overlapCells = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = r * COLS + c;
        const on = count && count[k] > 1;
        const p = k * 4;
        if (on) {
          overlapCells++;
          const stripe = (c + r) % 4 < 2;
          d[p] = 230;
          d[p + 1] = stripe ? 40 : 70;
          d[p + 2] = stripe ? 30 : 50;
          d[p + 3] = stripe ? 235 : 150;
        } else d[p + 3] = 0;
      }
    }
    ovCtx.putImageData(ovImg, 0, 0);
    ovTex.needsUpdate = true;
    overlay.visible = overlapCells > 0;
  };

  // ---- líneas de tiza ----
  const chalkHex = chalkColorFor(color);
  const grain = canvasTex(chalkGrainCanvas(), { srgb: false });
  grain.wrapS = THREE.RepeatWrapping;
  grain.wrapT = THREE.ClampToEdgeWrapping;
  grain.repeat.set(1 / 0.06, 1);
  const chalkMat = new THREE.MeshStandardMaterial({ color: chalkHex, alphaMap: grain, transparent: true, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const chalkLines = [];
  // pts en coords de tela {x, z}; devuelve un trazo con progress(0..1)
  const addChalkLine = (pts, { width = 0.0055 } = {}) => {
    const pp = pts.map((p) => ({ x: p.x, y: -p.z })); // a "coords de pieza" para ribbonGeometry (y → −z)
    const g = ribbonGeometry(pp, -width / 2, width / 2, { y: 0 });
    const m = new THREE.Mesh(g, chalkMat);
    m.position.y = topY + 0.0006;
    m.renderOrder = 2;
    m.receiveShadow = true;
    group.add(m);
    const segs = g.userData.segments;
    g.setDrawRange(0, 0);
    const line = {
      mesh: m,
      length: g.userData.length,
      setProgress(t) {
        const n = Math.max(0, Math.min(segs, Math.ceil(segs * t)));
        g.setDrawRange(0, n * 6);
      },
    };
    chalkLines.push(line);
    return line;
  };
  // marquita corta (piquetes): segmento de a→b
  const addChalkTick = (a, b, width = 0.0045) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const g = new THREE.PlaneGeometry(width, l);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, chalkMat);
    m.position.set((a.x + b.x) / 2, topY + 0.0007, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(dx, dz);
    m.renderOrder = 2;
    group.add(m);
    return m;
  };

  // ---- polvillo de tiza ----
  const N = 90;
  const dustGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(N * 3);
  const dVel = new Float32Array(N * 3);
  const dLife = new Float32Array(N);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: chalkHex, size: 0.006, transparent: true, opacity: 0.9, depthWrite: false }));
  dust.frustumCulled = false;
  dust.renderOrder = 5;
  group.add(dust);
  let dIdx = 0;
  for (let i = 0; i < N; i++) dPos[i * 3 + 1] = -10;
  const puff = (x, z, n = 2) => {
    if (Math.random() < 0.4) return;
    for (let k = 0; k < n; k++) {
      const i = dIdx++ % N;
      dPos[i * 3] = x + (Math.random() - 0.5) * 0.004;
      dPos[i * 3 + 1] = topY + 0.002;
      dPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.004;
      dVel[i * 3] = (Math.random() - 0.5) * 0.05;
      dVel[i * 3 + 1] = 0.01 + Math.random() * 0.03;
      dVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
      dLife[i] = 0.5 + Math.random() * 0.5;
    }
  };
  const tickDust = (dt) => {
    for (let i = 0; i < N; i++) {
      if (dLife[i] <= 0) continue;
      dLife[i] -= dt;
      dVel[i * 3 + 1] -= 0.09 * dt;
      dPos[i * 3] += dVel[i * 3] * dt;
      dPos[i * 3 + 1] = Math.max(topY + 0.0008, dPos[i * 3 + 1] + dVel[i * 3 + 1] * dt);
      dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
      if (dLife[i] <= 0) dPos[i * 3 + 1] = -10;
    }
    dustGeo.attributes.position.needsUpdate = true;
  };

  // coords de tela → mundo (sobre la cara de la tela)
  const toWorld = (x, z, dy = 0) => new THREE.Vector3(o.x0 + x, group.position.y + topY + dy, o.z0 + z);

  return {
    group,
    topWorldY: group.position.y + topY,
    toWorld,
    setLength,
    get shownLength() {
      return shownLen;
    },
    setOverlap,
    get overlapCells() {
      return overlapCells;
    },
    overlay,
    addChalkLine,
    addChalkTick,
    chalkLines,
    chalkHex,
    puff,
    tick(dt, t) {
      tickDust(dt);
      if (overlay.visible) ovMat.opacity = 0.6 + 0.3 * Math.sin(t * 7);
    },
  };
}
