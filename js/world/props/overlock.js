// Overlock de 4 hilos: cuerpo compacto, tapa de ancheros con diagrama de enhebrado,
// dos agujas que suben y bajan (setSpeed), cuchilla, volante, y antena con cuatro conos
// de hilo arriba (setThreadColor).

import { THREE, Batch, std, phys, mesh, lathe, chrome, steel, rubber, place, damp, tube } from './common.js';
import { drawTexture } from './textures.js';
import { getThreadMaterial } from '../../materials/fabric.js';
import { clamp } from '../../core/utils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function threadingDiagram() {
  return drawTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#e9e7e1';
      ctx.fillRect(0, 0, w, h);
      const cols = ['#3c9a5f', '#2f6db6', '#c43a3a', '#e0b72e'];
      ctx.lineWidth = 5;
      cols.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.moveTo(30 + i * 52, 20);
        ctx.bezierCurveTo(40 + i * 52, 90, 10 + i * 40, 150, 70 + i * 30, 230);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(30 + i * 52, 20, 9, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = '#6a6e73';
      ctx.font = '700 22px sans-serif';
      ctx.fillText('4 hilos', 150, 236);
    },
    { key: 'diagrama-overlock' },
  );
}

export function createOverlock({ position, topY, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'overlock';
  group.position.set(position[0], topY, position[1]);
  group.rotation.y = ry;
  const b = new Batch();
  const body = phys('overlock-cuerpo', { color: '#f1efe8', roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const gray = std('overlock-gris', { color: '#9aa1a6', roughness: 0.4 });
  const teal = std('overlock-acento', { color: '#5f9a8f', roughness: 0.4 });
  // base y cuerpo
  b.box(0.3, 0.075, 0.26, body, { p: [0.0, 0.0375, 0], radius: 0.02, seg: 3, cast: true });
  b.box(0.2, 0.17, 0.2, body, { p: [0.04, 0.075 + 0.085, -0.02], radius: 0.03, seg: 3, cast: true });
  b.box(0.12, 0.05, 0.16, body, { p: [-0.08, 0.215, -0.02], radius: 0.02, seg: 3, cast: true });
  // tapa delantera de ancheros con diagrama
  b.box(0.2, 0.07, 0.012, gray, { p: [-0.035, 0.04, 0.128], radius: 0.006, seg: 2 });
  const diag = new THREE.PlaneGeometry(0.075, 0.06);
  b.add(diag, std('diagrama-overlock', { map: threadingDiagram(), roughness: 0.5 }), { p: [0.03, 0.04, 0.1345], uv: 'keep' });
  diag.dispose();
  // cabezal de agujas (frente izquierda) y placa
  b.box(0.05, 0.06, 0.05, body, { p: [-0.085, 0.165, 0.06], radius: 0.012, seg: 2 });
  b.box(0.08, 0.003, 0.07, chrome(), { p: [-0.085, 0.0765, 0.07], radius: 0.002, seg: 1 });
  // perillas de tensión (4 colores) arriba
  const knobCols = ['#3c9a5f', '#2f6db6', '#c43a3a', '#e0b72e'];
  knobCols.forEach((c, i) => {
    b.cyl(0.011, 0.011, 0.018, std(`perilla-${c}`, { color: c, roughness: 0.35 }), { p: [-0.02 + i * 0.03, 0.245 + 0.009, 0.04], seg: 18 });
  });
  // plataforma trasera de conos y antena
  b.box(0.26, 0.012, 0.09, gray, { p: [0.0, 0.245 + 0.006, -0.09], radius: 0.004, seg: 1, cast: true });
  b.cyl(0.005, 0.005, 0.42, chrome(), { p: [0.0, 0.257 + 0.21, -0.1], seg: 10 });
  b.box(0.28, 0.008, 0.012, chrome(), { p: [0.0, 0.677, -0.1], radius: 0.003, seg: 1 });
  const eyelet = new THREE.TorusGeometry(0.005, 0.0012, 6, 12);
  for (let i = 0; i < 4; i++) b.add(eyelet, chrome(), { p: [-0.105 + i * 0.07, 0.677, -0.088] });
  eyelet.dispose();
  b.box(0.06, 0.012, 0.012, teal, { p: [0.08, 0.2, 0.075], radius: 0.004, seg: 1 });
  b.box(0.26, 0.008, 0.22, rubber(), { p: [0, 0.004, 0], radius: 0.002, seg: 1 });
  b.flush(group, 'overlock');

  // conos (4) y sus hilos
  const coneGeo = lathe([[0.012, 0], [0.034, 0.005], [0.033, 0.03], [0.024, 0.09], [0.013, 0.12], [0.011, 0.122]], 28);
  const paperGeo = lathe([[0.009, 0], [0.022, 0], [0.012, 0.13], [0.008, 0.13]], 20);
  const paperMat = std('cono-carton', { color: '#d9c4a0', roughness: 0.8 });
  let color = '#f3f1ea';
  const lineMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const coneParts = [];
  const paperParts = [];
  const lineParts = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.105 + i * 0.07;
    coneParts.push(coneGeo.clone().translate(x, 0.257, -0.09));
    paperParts.push(paperGeo.clone().translate(x, 0.257, -0.09));
    // hilo: cono → ojal de la antena → entrada en la máquina
    const p = tube(
      [
        [x, 0.257 + 0.125, -0.09],
        [x, 0.5, -0.092],
        [x, 0.672, -0.088],
        [x * 0.6 - 0.04, 0.45, -0.02],
        [-0.03 + i * 0.012, 0.27, 0.03],
      ],
      0.0005,
      { tubular: 40, radial: 4 },
    );
    lineParts.push(p);
  }
  // los cuatro conos cambian de color juntos: un solo mesh
  const cones = [mesh(mergeGeometries(coneParts), getThreadMaterial(color, 'nylon', { repeat: [3, 60] }), { cast: true, name: 'conos' })];
  group.add(cones[0], mesh(mergeGeometries(paperParts), paperMat), mesh(mergeGeometries(lineParts), lineMat, { receive: false }));

  // agujas (2) que suben y bajan
  const needles = new THREE.Group();
  group.add(needles);
  for (let i = 0; i < 2; i++) {
    needles.add(mesh(new THREE.CylinderGeometry(0.0007, 0.0005, 0.03, 6), steel(), { p: [-0.092 + i * 0.008, 0.11, 0.07] }));
  }
  needles.add(mesh(new THREE.BoxGeometry(0.022, 0.008, 0.01), chrome(), { p: [-0.088, 0.128, 0.07] }));
  // volante
  const wheel = new THREE.Group();
  place(wheel, [0.152, 0.15, -0.01]);
  group.add(wheel);
  const wg = new THREE.CylinderGeometry(0.048, 0.048, 0.022, 36);
  wg.rotateZ(Math.PI / 2);
  wheel.add(mesh(wg, gray, { cast: true }));
  wheel.add(mesh(new THREE.BoxGeometry(0.003, 0.025, 0.006), std('marca-volante', { color: '#c46a45' }), { p: [0.012, 0.03, 0] }));

  let speed = 0;
  let target = 0;
  let phase = 0;
  return {
    group,
    setSpeed(v) {
      target = clamp(v, 0, 1);
    },
    setThreadColor(hex, threadId = 'nylon') {
      color = hex;
      for (const c of cones) c.material = getThreadMaterial(hex, threadId, { repeat: [3, 60] });
      lineMat.color.set(hex);
    },
    update(dt) {
      speed = damp(speed, target, 8, dt);
      phase += speed * Math.PI * 2 * 12 * dt;
      needles.position.y = (0.5 + 0.5 * Math.cos(phase)) * 0.01 - 0.01;
      wheel.rotation.x = -phase;
    },
  };
}
