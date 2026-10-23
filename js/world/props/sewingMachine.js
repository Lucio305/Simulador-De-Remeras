// Máquina de coser doméstica vintage (~43 cm): cuerpo con brazo en C, base con placa de
// aguja y dientes de arrastre, barra de aguja que sube y baja (setSpeed), prensatelas
// (setPresserFoot), volante a la derecha, carretel con su recorrido de hilo
// (setThreadColor), luz de costura (setLight), perillas y pedal en el piso.
// Mira hacia +Z (la persona se sienta del lado +Z); la tela avanza hacia -Z.

import {
  THREE, Batch, std, phys, mesh, V3, lathe, extrude, roundedRectShape, chrome, steel, darkSteel, rubber, darkPlastic, place, damp, tube, DEG,
} from './common.js';
import { drawTexture } from './textures.js';
import { getThreadMaterial } from '../../materials/fabric.js';
import { clamp } from '../../core/utils.js';

export const BED_H = 0.07; // alto de la base sobre la mesa
const PLATE_T = 0.0015;
const HEAD_BOTTOM = 0.135;
const STROKE = 0.025;
const NEEDLE_LEN = 0.038;

const bodyPaint = () => phys('pintura-maquina', { color: '#a6d2bf', roughness: 0.32, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.2 });
const creamPaint = () => phys('pintura-maquina-crema', { color: '#efe3c8', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 });

function brandTexture() {
  return drawTexture(
    512,
    160,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // filete dorado
      ctx.strokeStyle = 'rgba(206,168,92,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(18, h * 0.82);
      ctx.bezierCurveTo(w * 0.3, h * 0.95, w * 0.7, h * 0.7, w - 18, h * 0.82);
      ctx.stroke();
      ctx.fillStyle = '#c49a48';
      ctx.font = 'italic 700 82px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(90,60,20,0.5)';
      ctx.shadowBlur = 2;
      ctx.fillText('Taller', w / 2, h * 0.42);
      ctx.font = '600 20px sans-serif';
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8f7a55';
      ctx.fillText('DE REMERAS · MOD. 1957', w / 2, h * 0.68 + 26);
    },
    { key: 'marca-maquina' },
  );
}

function dialTexture(kind) {
  return drawTexture(
    256,
    256,
    (ctx, w, h) => {
      const c = w / 2;
      ctx.fillStyle = '#f3ecdc';
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9a8e78';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = '#3a342c';
      ctx.font = '700 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const n = kind === 'tension' ? 10 : 6;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const lbl = kind === 'tension' ? String(i) : ['0', '1', '2', '3', '4', '5'][i];
        ctx.fillText(lbl, c + Math.cos(a) * 88, c + Math.sin(a) * 88);
      }
      ctx.fillStyle = '#5f9a8f';
      ctx.beginPath();
      ctx.arc(c, c, 34, 0, Math.PI * 2);
      ctx.fill();
    },
    { key: `dial-maquina-${kind}` },
  );
}

function stitchSelectorTexture() {
  return drawTexture(
    256,
    256,
    (ctx, w, h) => {
      const c = w / 2;
      ctx.fillStyle = '#f3ecdc';
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a342c';
      ctx.lineWidth = 4;
      const icons = [
        (x, y) => { ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.stroke(); },
        (x, y) => { ctx.beginPath(); for (let i = 0; i <= 4; i++) ctx.lineTo(x - 14 + i * 7, y + (i % 2 ? -8 : 8)); ctx.stroke(); },
        (x, y) => { ctx.beginPath(); for (let i = 0; i <= 8; i++) ctx.lineTo(x - 14 + i * 3.5, y + (i % 2 ? -4 : 4)); ctx.stroke(); },
        (x, y) => { ctx.strokeRect(x - 10, y - 8, 20, 16); },
        (x, y) => { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); },
        (x, y) => { ctx.beginPath(); ctx.moveTo(x - 14, y - 6); ctx.lineTo(x + 14, y - 6); ctx.moveTo(x - 14, y + 6); ctx.lineTo(x + 14, y + 6); ctx.stroke(); },
      ];
      icons.forEach((f, i) => {
        const a = -Math.PI / 2 + (i / icons.length) * Math.PI * 2;
        f(c + Math.cos(a) * 84, c + Math.sin(a) * 84);
      });
      ctx.fillStyle = '#c46a45';
      ctx.beginPath();
      ctx.arc(c, c, 30, 0, Math.PI * 2);
      ctx.fill();
    },
    { key: 'selector-puntadas' },
  );
}

// Perfil lateral del cuerpo (pilar + brazo + cabezal) en el plano XY.
function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.072, HEAD_BOTTOM);
  s.lineTo(-0.072, 0.24);
  s.quadraticCurveTo(-0.072, 0.274, -0.038, 0.276);
  s.lineTo(0.27, 0.276);
  s.quadraticCurveTo(0.345, 0.274, 0.347, 0.215);
  s.lineTo(0.347, BED_H);
  s.lineTo(0.232, BED_H);
  s.lineTo(0.232, 0.165);
  s.quadraticCurveTo(0.228, 0.196, 0.19, 0.198);
  s.lineTo(0.012, 0.198);
  s.quadraticCurveTo(0.002, 0.196, 0.0, 0.185);
  s.lineTo(0.0, HEAD_BOTTOM);
  s.closePath();
  return s;
}

export function createSewingMachine({ needle, topY, ry = 0 }) {
  // `needle` = [x, z] en mundo del punto de aguja; topY = tapa de la mesa
  const group = new THREE.Group();
  group.name = 'maquina-coser';
  group.position.set(needle[0], topY, needle[1]);
  group.rotation.y = ry;
  const b = new Batch();
  const paint = bodyPaint();
  const cream = creamPaint();
  const chromeM = chrome();

  // base
  b.box(0.435, BED_H, 0.18, paint, { p: [0.1425, BED_H / 2, -0.005], radius: 0.014, seg: 3, cast: true });
  b.box(0.42, 0.006, 0.17, std('base-goma', { color: '#2e3134', roughness: 0.9 }), { p: [0.1425, 0.003, -0.005], radius: 0.002, seg: 1 });
  // cuerpo en C extruido
  const bodyGeo = extrude(bodyShape(), 0.1, { bevel: 0.016, bevelSegments: 4, curveSegments: 20 });
  b.add(bodyGeo, paint, { p: [0, 0, -0.062], uv: 'box', cast: true });
  bodyGeo.dispose();
  // tapa del cabezal (crema) y frente del brazo
  b.box(0.006, 0.12, 0.085, cream, { p: [-0.0745, 0.205, -0.012], radius: 0.003, seg: 2 });
  // placa de aguja (cromada) y tapa de canilla (acrílico ahumado)
  const plate = roundedRectShape(0.11, 0.075, 0.006, 0.025, -0.002);
  const plateGeo = extrude(plate, PLATE_T, { bevel: 0.0005, bevelSegments: 1 });
  plateGeo.rotateX(-Math.PI / 2);
  b.add(plateGeo, chromeM, { p: [0, BED_H, 0], uv: 'box' });
  plateGeo.dispose();
  // guías de costura grabadas
  const engr = std('grabado-placa', { color: '#4a4e52', metalness: 0.8, roughness: 0.4 });
  for (let i = 1; i <= 4; i++) b.box(0.03, 0.0004, 0.0006, engr, { p: [0.055, BED_H + PLATE_T + 0.0002, -0.012 + i * 0.008] });
  for (let i = 0; i < 3; i++) b.box(0.016, 0.0005, 0.0024, std('ranura-dientes', { color: '#151515', roughness: 0.9 }), { p: [0.002, BED_H + PLATE_T + 0.0001, -0.007 + i * 0.007] });
  const bobbin = phys('tapa-canilla', { color: '#3d4247', roughness: 0.1, transparent: true, opacity: 0.75 });
  b.box(0.06, 0.0012, 0.04, bobbin, { p: [0.02, BED_H + 0.0006, 0.058], radius: 0.0005, seg: 1 });

  // calcomanía de marca en el brazo
  const brand = new THREE.PlaneGeometry(0.15, 0.047);
  b.add(brand, std('marca-maquina', { map: brandTexture(), transparent: true, roughness: 0.4 }), { p: [0.12, 0.2375, 0.0386], uv: 'keep' });
  brand.dispose();
  // perillas del pilar: selector de puntada y largo de puntada
  const selector = new THREE.CylinderGeometry(0.026, 0.026, 0.008, 40);
  selector.rotateX(Math.PI / 2);
  b.add(selector, cream, { p: [0.29, 0.13, 0.042] });
  const selFace = new THREE.CircleGeometry(0.024, 40);
  b.add(selFace, std('selector-cara', { map: stitchSelectorTexture(), roughness: 0.5 }), { p: [0.29, 0.13, 0.0462], uv: 'keep' });
  b.add(selFace, std('dial-largo-cara', { map: dialTexture('largo'), roughness: 0.5 }), { matrix: new THREE.Matrix4().compose(V3(0.29, 0.2, 0.0442), new THREE.Quaternion(), V3(0.75, 0.75, 1)), uv: 'keep' });
  selector.dispose();
  const knob2 = new THREE.CylinderGeometry(0.019, 0.019, 0.006, 32);
  knob2.rotateX(Math.PI / 2);
  b.add(knob2, cream, { p: [0.29, 0.2, 0.041] });
  knob2.dispose();
  // dial de tensión al frente del cabezal
  const tens = new THREE.CylinderGeometry(0.014, 0.016, 0.012, 32);
  tens.rotateX(Math.PI / 2);
  b.add(tens, cream, { p: [-0.035, 0.212, 0.044] });
  tens.dispose();
  const tensFace = new THREE.CircleGeometry(0.0135, 32);
  b.add(tensFace, std('dial-tension-cara', { map: dialTexture('tension'), roughness: 0.5 }), { p: [-0.035, 0.212, 0.0503], uv: 'keep' });
  tensFace.dispose();
  // discos de tensión cromados
  for (let i = 0; i < 2; i++) {
    const d = new THREE.CylinderGeometry(0.008, 0.008, 0.0012, 20);
    d.rotateX(Math.PI / 2);
    b.add(d, chromeM, { p: [-0.035, 0.188, 0.0395 + i * 0.002] });
    d.dispose();
  }
  // perno del carretel y devanador
  b.cyl(0.0025, 0.0025, 0.07, chromeM, { p: [0.2, 0.276 + 0.035, -0.012], seg: 8 });
  b.cyl(0.0025, 0.0025, 0.028, chromeM, { p: [0.29, 0.276 + 0.014, -0.012], seg: 8 });
  b.cyl(0.009, 0.009, 0.012, cream, { p: [0.29, 0.282, -0.012], seg: 16 });
  // guía de hilo superior
  b.box(0.012, 0.012, 0.006, chromeM, { p: [0.05, 0.282, 0.02], radius: 0.002, seg: 1 });
  b.box(0.006, 0.018, 0.006, chromeM, { p: [-0.02, 0.165, 0.04], radius: 0.002, seg: 1 });
  // palanca del prensatelas (atrás del cabezal)
  b.box(0.008, 0.03, 0.006, chromeM, { p: [-0.02, 0.145, -0.05], radius: 0.002, seg: 1 });
  b.flush(group, 'maquina-coser');

  // volante (gira)
  const wheel = new THREE.Group();
  place(wheel, [0.36, 0.215, -0.012]);
  group.add(wheel);
  const wheelGeo = lathe([[0.0, -0.014], [0.05, -0.014], [0.056, -0.008], [0.056, 0.008], [0.05, 0.014], [0.02, 0.009], [0.0, 0.012]], 40);
  wheelGeo.rotateZ(-Math.PI / 2);
  wheel.add(mesh(wheelGeo, cream, { cast: true }));
  const grip = new THREE.TorusGeometry(0.056, 0.0035, 8, 48);
  grip.rotateY(Math.PI / 2);
  wheel.add(mesh(grip, rubber()));
  wheel.add(mesh(new THREE.BoxGeometry(0.003, 0.03, 0.006), std('marca-volante', { color: '#c46a45' }), { p: [0.0135, 0.034, 0] }));

  // barra de aguja + aguja
  const needleBar = new THREE.Group();
  group.add(needleBar);
  needleBar.add(mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.09, 12), chromeM, { p: [0, NEEDLE_LEN + 0.045 + 0.004, 0] }));
  needleBar.add(mesh(new THREE.BoxGeometry(0.008, 0.008, 0.009), steel(), { p: [0, NEEDLE_LEN + 0.004, 0.0005] }));
  const needleGeo = lathe([[0.0, 0.0], [0.00035, 0.0015], [0.0006, 0.006], [0.0006, NEEDLE_LEN - 0.012], [0.001, NEEDLE_LEN - 0.01], [0.001, NEEDLE_LEN], [0, NEEDLE_LEN]], 8);
  needleBar.add(mesh(needleGeo, steel(), { name: 'aguja' }));
  // palanca tirahilos
  const lever = new THREE.Group();
  place(lever, [-0.055, 0.235, 0.05]);
  group.add(lever);
  lever.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), chromeM, { p: [-0.012, 0, 0.004] }));
  lever.add(mesh(new THREE.TorusGeometry(0.003, 0.001, 6, 12), chromeM, { p: [-0.028, 0, 0.006] }));
  // prensatelas
  const foot = new THREE.Group();
  group.add(foot);
  foot.add(mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.06, 10), chromeM, { p: [0, 0.042, -0.01] }));
  const sole = new THREE.Shape();
  sole.moveTo(-0.006, -0.012);
  sole.lineTo(0.006, -0.012);
  sole.lineTo(0.006, 0.014);
  sole.quadraticCurveTo(0.006, 0.02, 0.0, 0.02);
  sole.quadraticCurveTo(-0.006, 0.02, -0.006, 0.014);
  sole.closePath();
  const slot = new THREE.Path();
  slot.moveTo(-0.0012, -0.004);
  slot.lineTo(0.0012, -0.004);
  slot.lineTo(0.0012, 0.006);
  slot.lineTo(-0.0012, 0.006);
  slot.closePath();
  sole.holes.push(slot);
  const soleGeo = extrude(sole, 0.0018, { bevel: 0.0004, bevelSegments: 1 });
  soleGeo.rotateX(-Math.PI / 2);
  soleGeo.rotateY(Math.PI); // la punta curvada mira a la persona (+Z)
  foot.add(mesh(soleGeo, chromeM, { p: [0, 0, -0.002] }));
  foot.add(mesh(new THREE.BoxGeometry(0.008, 0.012, 0.004), chromeM, { p: [0, 0.008, -0.01] }));
  // dientes de arrastre
  const dogs = new THREE.Group();
  group.add(dogs);
  const dogMat = darkSteel();
  for (let i = 0; i < 3; i++) dogs.add(mesh(new THREE.BoxGeometry(0.012, 0.0014, 0.0016), dogMat, { p: [0.002, BED_H + PLATE_T - 0.0004, -0.007 + i * 0.007] }));

  // carretel arriba
  const spoolG = new THREE.Group();
  place(spoolG, [0.2, 0.278, -0.012]);
  group.add(spoolG);
  spoolG.add(mesh(lathe([[0.003, 0], [0.019, 0], [0.019, 0.004], [0.009, 0.006], [0.009, 0.042], [0.019, 0.044], [0.019, 0.048], [0.003, 0.048]], 24), std('carretel-madera', { color: '#e6c9a0', roughness: 0.6 }), { cast: true }));
  let threadColor = '#f3f1ea';
  const spoolThread = mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.036, 24, 1, true), getThreadMaterial(threadColor, 'poliester'), { p: [0, 0.024, 0] });
  spoolG.add(spoolThread);

  // recorrido del hilo (estático) y tramo final hasta el ojo de la aguja (dinámico)
  const threadMat = new THREE.MeshStandardMaterial({ color: threadColor, roughness: 0.6 });
  const path = tube(
    [
      [0.2 - 0.016, 0.3, -0.012],
      [0.12, 0.29, 0.0],
      [0.05, 0.288, 0.02],
      [-0.01, 0.25, 0.05],
      [-0.035, 0.19, 0.043],
      [-0.045, 0.21, 0.046],
      [-0.083, 0.237, 0.056],
      [-0.05, 0.2, 0.048],
      [-0.02, 0.165, 0.043],
    ],
    0.0005,
    { tubular: 80, radial: 4 },
  );
  group.add(mesh(path, threadMat, { receive: false }));
  const lastSeg = mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 1, 4), threadMat, { receive: false });
  group.add(lastSeg);

  // luz de costura
  const lightMat = new THREE.MeshStandardMaterial({ color: '#d8d6cf', emissive: '#fff1d0', emissiveIntensity: 0, roughness: 0.3 });
  group.add(mesh(new THREE.BoxGeometry(0.04, 0.003, 0.03), lightMat, { p: [-0.036, HEAD_BOTTOM - 0.001, 0.0] }));
  const lamp = new THREE.SpotLight('#ffe7c2', 0, 0.8, 55 * DEG, 0.85, 2);
  lamp.position.set(-0.03, HEAD_BOTTOM - 0.004, 0.006);
  lamp.target.position.set(0.0, BED_H, 0.01);
  group.add(lamp, lamp.target);

  // estado y animación
  let speed = 0;
  let speedTarget = 0;
  let phase = 0;
  let footDown = true;
  let footY = 0;
  const _a = V3();
  const _b = V3();
  const plateTop = BED_H + PLATE_T;

  function pose() {
    // 0 = arriba; la aguja baja con cos
    const k = 0.5 + 0.5 * Math.cos(phase);
    const tipY = plateTop - 0.0015 + STROKE * k;
    needleBar.position.y = tipY;
    lever.rotation.z = Math.sin(phase + 0.9) * 0.35;
    wheel.rotation.x = -phase;
    // dientes: suben cuando la aguja está arriba y empujan hacia -Z
    const d = Math.max(0, Math.cos(phase + Math.PI)) * speed;
    dogs.position.set(0, d * 0.0012, -Math.sin(phase) * 0.0015 * speed);
    foot.position.y = plateTop + footY;
    // último tramo: guía → ojo de la aguja
    _a.set(-0.02, 0.165, 0.043);
    _b.set(0, tipY + 0.004, 0.0008);
    lastSeg.position.copy(_a).add(_b).multiplyScalar(0.5);
    lastSeg.scale.set(1, _a.distanceTo(_b), 1);
    lastSeg.quaternion.setFromUnitVectors(V3(0, 1, 0), _b.clone().sub(_a).normalize());
    spoolThread.rotation.y = phase * 0.05;
  }
  pose();

  const needlePoint = new THREE.Vector3();
  group.updateWorldMatrix(true, true);
  needlePoint.copy(group.localToWorld(V3(0, plateTop, 0)));
  const feedDir = V3(0, 0, -1).applyAxisAngle(V3(0, 1, 0), ry).normalize();

  return {
    group,
    needlePoint,
    bedTopY: topY + plateTop,
    feedDir,
    // fase y velocidad internas de la aguja (para sincronizar puntadas)
    get phase() {
      return phase;
    },
    get speed() {
      return speed;
    },
    setSpeed(v) {
      speedTarget = clamp(v, 0, 1);
    },
    setThreadColor(hex, threadId = 'poliester') {
      threadColor = hex;
      spoolThread.material = getThreadMaterial(hex, threadId);
      threadMat.color.set(hex);
    },
    setLight(on) {
      lamp.intensity = on ? 0.06 : 0;
      lightMat.emissiveIntensity = on ? 2.2 : 0;
    },
    setPresserFoot(down) {
      footDown = !!down;
    },
    update(dt) {
      speed = damp(speed, speedTarget, 10, dt);
      if (speed < 0.002 && speedTarget === 0) {
        // frena con la aguja arriba
        const rest = Math.round(phase / (Math.PI * 2)) * Math.PI * 2;
        phase = damp(phase, rest, 8, dt);
        speed = 0;
      } else {
        phase += speed * Math.PI * 2 * 9 * dt; // hasta ~9 puntadas por segundo
      }
      footY = damp(footY, footDown ? 0 : 0.0065, 12, dt);
      pose();
    },
  };
}

// Pedal (control de pie) con cable hacia la mesa.
export function createPedal({ position, cableTo }) {
  const group = new THREE.Group();
  group.name = 'pedal';
  place(group, position, [0, 0.15, 0]);
  const s = new THREE.Shape();
  s.moveTo(-0.09, 0);
  s.lineTo(0.09, 0);
  s.lineTo(0.08, 0.035);
  s.quadraticCurveTo(0.0, 0.07, -0.08, 0.055);
  s.closePath();
  const g = extrude(s, 0.12, { bevel: 0.01, bevelSegments: 3 });
  g.rotateY(Math.PI / 2);
  g.translate(-0.06, 0, 0);
  group.add(mesh(g, darkPlastic(), { cast: true }));
  const pad = new THREE.BoxGeometry(0.1, 0.004, 0.13);
  pad.rotateX(-0.25);
  group.add(mesh(pad, rubber(), { p: [0, 0.058, 0.005] }));
  const parts = [];
  if (cableTo) {
    const local = V3(...cableTo).sub(V3(...position)).applyAxisAngle(V3(0, 1, 0), -0.15);
    const cable = tube(
      [
        [0, 0.02, -0.09],
        [0, 0.008, -0.2],
        [local.x * 0.3, 0.006, local.z * 0.6],
        [local.x * 0.8, 0.01, local.z * 0.95],
        [local.x, local.y * 0.5, local.z],
        [local.x, local.y, local.z],
      ],
      0.0035,
      { tubular: 48, radial: 6 },
    );
    const cm = mesh(cable, rubber());
    group.add(cm);
    parts.push(cm);
  }
  return { group };
}
