// Lavarropas de carga frontal: gabinete redondeado, puerta con vidrio abombado y bisagra,
// tambor de acero perforado que gira (setDrum), agua con espuma (setWater), ropa adentro
// (setLoad), display LCD (setDisplay) y perilla de programas. Al lado, canasto de mimbre.

import { THREE, Batch, std, phys, mesh, V3, lathe, extrude, roundedRectShape, circlePath, chrome, rubber, whitePlastic, darkPlastic, damp, place, RoundedBoxGeometry } from './common.js';
import { perforatedTextures, drawTexture, wickerTextures } from './textures.js';
import { getFabricMaterial } from '../../materials/fabric.js';
import { clamp, makeValueNoise } from '../../core/utils.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const W = 0.6;
const H = 0.85;
const D = 0.56;
const DOOR_Y = 0.4;
const HOLE_R = 0.172;
const DRUM_R = 0.235;
const DRUM_D = 0.34;
const FRONT_Z = 0.245; // cara del panel frontal (local)

function lcdDraw(ctx, w, h, text) {
  ctx.fillStyle = '#0e1d1a';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const lines = String(text ?? '').split('\n');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(110,255,214,0.8)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#8affdc';
  if (lines.length === 1) {
    let s = 64;
    ctx.font = `700 ${s}px "Courier New", monospace`;
    while (ctx.measureText(lines[0]).width > w - 24 && s > 18) ctx.font = `700 ${--s}px "Courier New", monospace`;
    ctx.fillText(lines[0], w / 2, h / 2 + 2);
  } else {
    let s = 44;
    ctx.font = `700 ${s}px "Courier New", monospace`;
    while (Math.max(...lines.map((l) => ctx.measureText(l).width)) > w - 24 && s > 14) ctx.font = `700 ${--s}px "Courier New", monospace`;
    ctx.fillText(lines[0], w / 2, h * 0.32);
    ctx.font = ctx.font.replace(/\d+px/, `${Math.round(s * 0.72)}px`);
    ctx.fillStyle = '#5fd9b5';
    ctx.fillText(lines[1], w / 2, h * 0.74);
  }
}

function programDialTexture() {
  return drawTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const c = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0)';
      const labels = ['Algodón', 'Sintét.', 'Delicado', 'Lana', 'Rápido', 'Enjuague', 'Centrif.', 'Eco'];
      ctx.font = '600 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      labels.forEach((l, i) => {
        const a = -Math.PI * 0.85 + (i / (labels.length - 1)) * Math.PI * 1.7 - Math.PI / 2;
        const x = c + Math.cos(a) * 100;
        const y = c + Math.sin(a) * 100;
        ctx.fillStyle = '#4b5a63';
        ctx.fillText(l, x, y);
        ctx.fillStyle = '#5f9a8f';
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * 74, c + Math.sin(a) * 74, 3.4, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    { key: 'dial-lavarropas' },
  );
}

function panelPrintTexture() {
  return drawTexture(
    512,
    96,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#6d7a82';
      ctx.font = 'italic 700 30px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Lavatex', 16, h * 0.5);
      ctx.font = '600 15px sans-serif';
      ctx.fillStyle = '#8a969d';
      ctx.fillText('8 kg · 1200', 18, h * 0.82);
      ctx.textAlign = 'center';
      ['°C', 'RPM', 'Inicio'].forEach((t, i) => ctx.fillText(t, w * 0.62 + i * 48, h * 0.88));
    },
    { key: 'panel-lavarropas' },
  );
}

// Agua: segmento circular extruido a lo largo del tambor (z: de 0 hacia -DRUM_D).
function waterGeometry(level) {
  const R = DRUM_R - 0.006;
  const hLine = -R + clamp(level, 0, 1) * R * 0.95;
  const a = Math.asin(clamp(hLine / R, -1, 1));
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(a) * R, hLine);
  shape.absarc(0, 0, R, a, Math.PI - a, true);
  shape.lineTo(Math.cos(a) * R, hLine);
  const g = new THREE.ExtrudeGeometry(shape, { depth: DRUM_D - 0.03, bevelEnabled: false, curveSegments: 28 });
  g.translate(0, 0, -(DRUM_D - 0.03));
  return { g, chord: Math.cos(a) * R * 2, hLine };
}

function foamTexture() {
  return drawTexture(
    256,
    128,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 380; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const r = 2 + Math.random() * 7;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.7, 'rgba(235,242,248,0.75)');
        g.addColorStop(1, 'rgba(200,215,225,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { key: 'espuma' },
  );
}

// Montón de ropa: icosfera deformada con ruido, aplastada abajo.
function clothesGeometry() {
  // icosfera con vértices compartidos (si no, las normales quedan facetadas)
  const ico = new THREE.IcosahedronGeometry(0.13, 5);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico, 1e-5);
  ico.dispose();
  const pc = g.attributes.position;
  const uvs = new Float32Array(pc.count * 2);
  for (let i = 0; i < pc.count; i++) {
    const x = pc.getX(i);
    const y = pc.getY(i);
    const z = pc.getZ(i);
    uvs[i * 2] = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    uvs[i * 2 + 1] = Math.asin(Math.max(-1, Math.min(1, y / 0.13))) / Math.PI + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const noise = makeValueNoise(12, 64);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    // bultos grandes + pliegues (crestas finas) como de ropa amontonada
    const k = noise(n.x * 3 + 10, n.y * 3 + n.z * 2 + 10) * 0.55 + noise(n.x * 9 + 3, n.z * 9 + 7) * 0.18 + Math.abs(noise(n.x * 14 + n.y * 6, n.z * 14 + 2) - 0.5) * 0.12;
    v.multiplyScalar(0.75 + k);
    v.x *= 1.3;
    v.z *= 1.15;
    if (v.y < -0.03) v.y = -0.03 + (v.y + 0.03) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.5);
  return g;
}

export function createWashingMachine({ anchor }) {
  const group = new THREE.Group();
  group.name = 'lavarropas';
  group.position.set(anchor[0], 0, anchor[2]);
  const b = new Batch();
  const enamel = phys('enlozado-blanco', { color: '#f3f2ee', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const topMat = std('lavarropas-tapa', { color: '#e6e4df', roughness: 0.45 });

  // gabinete hueco (laterales, fondo y base): el frente tiene la boca y adentro está el tambor
  const bodyH = H - 0.04;
  const bodyD = D - 0.07;
  const zc = -0.035;
  for (const sx of [-1, 1]) b.box(0.022, bodyH, bodyD, enamel, { p: [sx * (W / 2 - 0.013), 0.02 + bodyH / 2, zc], radius: 0.01, seg: 2, cast: true });
  b.box(W - 0.02, bodyH, 0.02, enamel, { p: [0, 0.02 + bodyH / 2, zc - bodyD / 2 + 0.01], cast: true });
  b.box(W - 0.02, 0.02, bodyD, enamel, { p: [0, 0.03, zc] });
  // interior oscuro (para que entre el tambor y el gabinete no se vea luz)
  const inner = std('lavarropas-interior', { color: '#2c2e30', roughness: 0.9, side: THREE.BackSide });
  b.box(W - 0.05, bodyH - 0.06, bodyD - 0.05, inner, { p: [0, 0.02 + bodyH / 2, zc], uv: 'keep' });
  b.box(W, 0.022, D, topMat, { p: [0, H - 0.011, 0], radius: 0.008, seg: 2, cast: true });
  // frente con boca circular
  const front = roundedRectShape(W - 0.004, 0.66, 0.02, 0, 0.02 + 0.33 - DOOR_Y);
  front.holes.push(circlePath(HOLE_R));
  const frontGeo = extrude(front, 0.035, { bevel: 0.008, curveSegments: 48 });
  b.add(frontGeo, enamel, { p: [0, DOOR_Y, FRONT_Z - 0.035], uv: 'box', cast: true });
  frontGeo.dispose();
  // panel de comandos
  b.box(W - 0.004, 0.14, 0.07, enamel, { p: [0, H - 0.022 - 0.07, FRONT_Z - 0.035], radius: 0.016, seg: 3 });
  // cajón de jabón
  b.box(0.17, 0.085, 0.012, whitePlastic(), { p: [-W / 2 + 0.11, H - 0.093, FRONT_Z + 0.001], radius: 0.006, seg: 2 });
  b.box(0.08, 0.012, 0.006, darkPlastic(), { p: [-W / 2 + 0.11, H - 0.123, FRONT_Z + 0.006], radius: 0.003, seg: 1 });
  // tapa de servicio y patas
  b.box(0.13, 0.08, 0.004, std('lavarropas-servicio', { color: '#e2e0db', roughness: 0.4 }), { p: [W / 2 - 0.1, 0.07, FRONT_Z + 0.001], radius: 0.006, seg: 1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.018, 0.022, 0.02, rubber(), { p: [sx * (W / 2 - 0.05), 0.01, sz * (D / 2 - 0.06)], seg: 12 });
  // fuelle de goma
  const gasket = lathe([[HOLE_R + 0.004, 0.0], [HOLE_R - 0.004, -0.008], [HOLE_R - 0.012, -0.03], [HOLE_R - 0.004, -0.05], [HOLE_R + 0.01, -0.075], [DRUM_R - 0.01, -0.09]], 48);
  gasket.rotateX(Math.PI / 2);
  b.add(gasket, std('fuelle-goma', { color: '#5b5e62', roughness: 0.7, side: THREE.DoubleSide }), { p: [0, DOOR_Y, FRONT_Z - 0.002], uv: 'keep' });
  gasket.dispose();
  // impresión del panel (marca, leyendas) y dial
  const printMat = std('panel-lavarropas-print', { map: panelPrintTexture(), transparent: true, roughness: 0.5 });
  const pr = new THREE.PlaneGeometry(0.42, 0.08);
  b.add(pr, printMat, { p: [-0.02, H - 0.09, FRONT_Z + 0.0008], uv: 'keep' });
  pr.dispose();
  // botoncitos
  for (let i = 0; i < 3; i++) b.cyl(0.009, 0.009, 0.006, whitePlastic(), { p: [0.035 + i * 0.028 - 0.03, H - 0.118, FRONT_Z + 0.003], r: [Math.PI / 2, 0, 0], seg: 16, uv: 'keep' });
  b.flush(group, 'lavarropas');

  const dialPlate = mesh(new THREE.PlaneGeometry(0.15, 0.15), std('dial-lavarropas', { map: programDialTexture(), transparent: true, roughness: 0.5 }), {
    p: [W / 2 - 0.085, H - 0.092, FRONT_Z + 0.0009],
  });
  group.add(dialPlate);
  const knob = new THREE.Group();
  place(knob, [W / 2 - 0.085, H - 0.092, FRONT_Z]);
  knob.add(mesh(lathe([[0, 0.026], [0.03, 0.026], [0.033, 0.02], [0.033, 0.004], [0.036, 0]], 32).rotateX(Math.PI / 2), whitePlastic(), { cast: true }));
  knob.add(mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.004, 32).rotateX(Math.PI / 2), chrome(), { p: [0, 0, 0.003] }));
  knob.add(mesh(new THREE.BoxGeometry(0.004, 0.022, 0.004), std('marca-perilla', { color: '#5f9a8f' }), { p: [0, 0.014, 0.027] }));
  group.add(knob);


  // display LCD
  const lcdCanvas = document.createElement('canvas');
  lcdCanvas.width = 256;
  lcdCanvas.height = 96;
  const lcdTex = new THREE.CanvasTexture(lcdCanvas);
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  const lcdMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: lcdTex, roughness: 0.25, metalness: 0 });
  const lcd = mesh(new THREE.PlaneGeometry(0.12, 0.045), lcdMat, { p: [0.03, H - 0.075, FRONT_Z + 0.001], name: 'display' });
  group.add(lcd);
  const setDisplay = (text) => {
    lcdDraw(lcdCanvas.getContext('2d'), lcdCanvas.width, lcdCanvas.height, text);
    lcdTex.needsUpdate = true;
  };
  setDisplay('--:--');

  // tambor (gira alrededor de Z)
  const drumPivot = new THREE.Group();
  place(drumPivot, [0, DOOR_Y, FRONT_Z - 0.085]);
  group.add(drumPivot);
  const drum = new THREE.Group();
  drumPivot.add(drum);
  const perf = perforatedTextures();
  const drumMap = perf.map.clone();
  drumMap.repeat.set(22, 3);
  drumMap.wrapS = drumMap.wrapT = THREE.RepeatWrapping;
  drumMap.needsUpdate = true;
  const drumNor = perf.normalMap.clone();
  drumNor.repeat.copy(drumMap.repeat);
  drumNor.wrapS = drumNor.wrapT = THREE.RepeatWrapping;
  drumNor.needsUpdate = true;
  const drumMat = new THREE.MeshStandardMaterial({ map: drumMap, normalMap: drumNor, metalness: 0.9, roughness: 0.38, side: THREE.BackSide, color: '#7b8186', envMapIntensity: 0.45 });
  const shell = new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_D, 48, 1, true);
  shell.rotateX(Math.PI / 2);
  shell.translate(0, 0, -DRUM_D / 2);
  drum.add(mesh(shell, drumMat, { receive: true }));
  const backMap = perf.map.clone();
  backMap.repeat.set(7, 7);
  backMap.wrapS = backMap.wrapT = THREE.RepeatWrapping;
  backMap.needsUpdate = true;
  const backMat = new THREE.MeshStandardMaterial({ map: backMap, metalness: 0.85, roughness: 0.4, color: '#5d6267', envMapIntensity: 0.35 });
  drum.add(mesh(new THREE.CircleGeometry(DRUM_R, 48), backMat, { p: [0, 0, -DRUM_D + 0.002], receive: true }));
  // paletas internas
  const lifterMat = std('paleta-tambor', { color: '#a3a8ad', metalness: 0.8, roughness: 0.35, envMapIntensity: 0.6 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const lg = new THREE.CylinderGeometry(0.02, 0.035, DRUM_D - 0.02, 12, 1, false, 0, Math.PI);
    const m = mesh(lg, lifterMat, { receive: false });
    m.rotation.set(Math.PI / 2, 0, a + Math.PI / 2, 'ZXY');
    m.position.set(Math.cos(a) * (DRUM_R - 0.001), Math.sin(a) * (DRUM_R - 0.001), -DRUM_D / 2);
    drum.add(m);
  }
  // estrella del eje
  drum.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.01, 6).rotateX(Math.PI / 2), lifterMat, { p: [0, 0, -DRUM_D + 0.008], receive: false }));

  // ropa
  const clothesPivot = new THREE.Group();
  drumPivot.add(clothesPivot);
  const clothes = mesh(clothesGeometry(), getFabricMaterial('algodon_jersey', '#ffffff'), { receive: false, name: 'ropa' });
  clothes.position.set(0, -DRUM_R + 0.075, -DRUM_D / 2);
  clothesPivot.add(clothes);
  clothes.visible = false;

  // agua + espuma
  const waterMat = phys('agua-lavarropas', { color: '#8fc3d8', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const foamMat = std('espuma-lavarropas', { map: foamTexture(), transparent: true, depthWrite: false, roughness: 0.6, color: '#ffffff' });
  const waterPivot = new THREE.Group();
  drumPivot.add(waterPivot);
  let water = null;
  let foam = null;
  let waterLevel = 0;
  const buildWater = (level) => {
    if (water) {
      water.geometry.dispose();
      waterPivot.remove(water);
      foam.geometry.dispose();
      waterPivot.remove(foam);
      water = foam = null;
    }
    if (level <= 0.01) return;
    const { g, chord, hLine } = waterGeometry(level);
    water = mesh(g, waterMat, { receive: false, name: 'agua' });
    water.renderOrder = 4;
    foam = mesh(new THREE.PlaneGeometry(chord * 0.98, DRUM_D - 0.04), foamMat, { r: [-Math.PI / 2, 0, 0], p: [0, hLine + 0.004, -(DRUM_D - 0.03) / 2], receive: false });
    foam.renderOrder = 5;
    waterPivot.add(water, foam);
  };

  // puerta (bisagra a la izquierda)
  const doorR = 0.205;
  const hinge = new THREE.Group();
  place(hinge, [-doorR - 0.004, DOOR_Y, FRONT_Z + 0.004]);
  group.add(hinge);
  const door = new THREE.Group();
  door.position.x = doorR + 0.004;
  hinge.add(door);
  const ring = lathe([[0.148, 0.0], [0.205, 0.0], [0.209, 0.012], [0.2, 0.032], [0.17, 0.045], [0.148, 0.04]], 64);
  ring.rotateX(Math.PI / 2);
  door.add(mesh(ring, whitePlastic(), { cast: true }));
  const trim = new THREE.TorusGeometry(0.16, 0.007, 10, 64);
  door.add(mesh(trim, chrome(), { p: [0, 0, 0.043] }));
  const glassGeo = lathe([[0.152, 0.038], [0.14, 0.02], [0.11, -0.012], [0.06, -0.035], [0.0, -0.042]], 40);
  glassGeo.rotateX(Math.PI / 2);
  const glassMat = phys('vidrio-puerta', { color: '#6f8794', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 0.6, specularIntensity: 0.6, side: THREE.FrontSide, depthWrite: false });
  const glass = mesh(glassGeo, glassMat, { receive: false, name: 'vidrio' });
  glass.renderOrder = 6;
  door.add(glass);
  // manija
  door.add(mesh(new RoundedBoxGeometry(0.03, 0.09, 0.03, 2, 0.01), darkPlastic(), { p: [0.19, 0, 0.03] }));

  // canasto de mimbre con ropa al lado
  const basket = new THREE.Group();
  basket.name = 'canasto';
  place(basket, [0.55, 0, 0.02]);
  group.add(basket);
  const wk = wickerTextures();
  const wickerMat = std('mimbre', { map: wk.map, normalMap: wk.normalMap, roughness: 0.85, side: THREE.DoubleSide });
  const bGeo = new THREE.CylinderGeometry(0.21, 0.18, 0.34, 40, 1, true);
  const bu = bGeo.attributes.uv;
  for (let i = 0; i < bu.count; i++) bu.setXY(i, bu.getX(i) * 1.2, bu.getY(i) * 0.34);
  basket.add(mesh(bGeo, wickerMat, { cast: true, p: [0, 0.17, 0] }));
  basket.add(mesh(new THREE.CircleGeometry(0.18, 32), wickerMat, { r: [-Math.PI / 2, 0, 0], p: [0, 0.005, 0] }));
  basket.add(mesh(new THREE.TorusGeometry(0.21, 0.012, 8, 40), std('mimbre-borde', { color: '#a77d48', roughness: 0.8 }), { r: [Math.PI / 2, 0, 0], p: [0, 0.34, 0] }));
  const heap = clothesGeometry();
  const hb = new Batch();
  const heapMat = getFabricMaterial('algodon_jersey', '#ffffff', { vertexColors: true });
  ['#93c6e6', '#f3f1ea', '#e5732b'].forEach((c, i) => {
    hb.add(heap, heapMat, { color: c, uv: 'keep', p: [(i - 1) * 0.06, 0.29 + i * 0.015, (i % 2) * 0.04 - 0.02], s: [0.78 - i * 0.08, 0.7, 0.75], r: [0, i * 1.7, 0] });
  });
  hb.flush(basket, 'ropa-canasto');

  // estado
  let drumSpeed = 0;
  let drumTarget = 0;
  let drumAngle = 0;
  let doorOpen = 0;
  let doorTarget = 0;
  let slosh = 0;

  const api = {
    group,
    doorCenter: V3(anchor[0], DOOR_Y, anchor[2] + FRONT_Z + 0.04),
    setDrum(speed) {
      drumTarget = clamp(speed, 0, 1);
    },
    setDoor(open) {
      doorTarget = clamp(open, 0, 1);
    },
    setDisplay,
    setWater(level) {
      level = clamp(level, 0, 1);
      if (Math.abs(level - waterLevel) < 0.005) return;
      waterLevel = level;
      buildWater(level);
    },
    setLoad(colorHex) {
      if (!colorHex) {
        clothes.visible = false;
        return;
      }
      clothes.material = getFabricMaterial('algodon_jersey', colorHex);
      clothes.visible = true;
    },
    update(dt, t) {
      drumSpeed = damp(drumSpeed, drumTarget, 2.2, dt);
      doorOpen = damp(doorOpen, doorTarget, 6, dt);
      hinge.rotation.y = -doorOpen * 1.75;
      const omega = drumSpeed * 16; // rad/s visuales
      drumAngle += omega * dt;
      drum.rotation.z = drumAngle;
      // la ropa da vueltas: a baja velocidad sube con el tambor y cae; rápido queda pegada
      const spin = clamp((drumSpeed - 0.45) / 0.25, 0, 1);
      const tumble = 1.35 * (0.5 - 0.5 * Math.cos(drumAngle * 0.55));
      clothesPivot.rotation.z = (1 - spin) * tumble * Math.min(1, drumSpeed * 4) + spin * drumAngle;
      clothes.scale.set(1, 1 - spin * 0.45, 1);
      // agua: se mueve con el tambor y baja al centrifugar
      slosh = damp(slosh, drumSpeed, 3, dt);
      waterPivot.rotation.z = Math.sin(t * 3.1) * 0.08 * slosh + slosh * 0.12;
      if (foam) foam.material.map.offset.x = (t * 0.05 * (1 + drumSpeed * 4)) % 1;
      // vibración del lavarropas al centrifugar
      const vib = spin * 0.0015;
      group.position.x = anchor[0] + Math.sin(t * 61) * vib;
      group.position.z = anchor[2] + Math.cos(t * 53) * vib;
    },
  };
  return api;
}
