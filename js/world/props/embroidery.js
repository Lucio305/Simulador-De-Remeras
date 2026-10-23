// Bordadora compacta: cuerpo blanco con pantalla táctil, unidad de bordado a la izquierda
// con carro y bastidor (aro doble con la tela tensada y un bordado a medio hacer).
// setRunning(v) anima aguja + movimiento del bastidor; setThreadColor(hex) cambia el carretel.

import { THREE, Batch, std, phys, mesh, V3, lathe, extrude, roundedRectShape, chrome, steel, darkPlastic, place, damp, tube, RoundedBoxGeometry } from './common.js';
import { drawTexture } from './textures.js';
import { getThreadMaterial, getFabricMaterial } from '../../materials/fabric.js';
import { clamp } from '../../core/utils.js';

const BED_H = 0.065;
const HEAD_BOTTOM = 0.125;

function screenTexture() {
  return drawTexture(
    256,
    192,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1d3b4a');
      g.addColorStop(1, '#0f2430');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e9f3f7';
      ctx.font = '700 20px sans-serif';
      ctx.fillText('BORDADO', 14, 28);
      ctx.strokeStyle = '#7fd6c2';
      ctx.lineWidth = 3;
      ctx.strokeRect(14, 42, 110, 120);
      // flor esquemática
      ctx.fillStyle = '#ff8a7a';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(69 + Math.cos(a) * 20, 102 + Math.sin(a) * 20, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd36e';
      ctx.beginPath();
      ctx.arc(69, 102, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9fb7c2';
      ctx.font = '600 16px sans-serif';
      ['Puntadas 4.812', 'Hilos 3', 'Tiempo 9 min'].forEach((t, i) => ctx.fillText(t, 138, 70 + i * 28));
      ctx.fillStyle = '#5f9a8f';
      ctx.fillRect(138, 140, 100, 26);
      ctx.fillStyle = '#fff';
      ctx.font = '700 16px sans-serif';
      ctx.fillText('INICIAR', 158, 158);
    },
    { key: 'pantalla-bordadora' },
  );
}

function embroideredPatch() {
  return drawTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const c = w / 2;
      // pétalos bordados con puntada satinada (líneas finas)
      const petal = (a, col) => {
        ctx.save();
        ctx.translate(c + Math.cos(a) * 46, c + Math.sin(a) * 46);
        ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, 34, 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        for (let k = -30; k < 30; k += 3) {
          ctx.beginPath();
          ctx.moveTo(k, -18);
          ctx.lineTo(k + 6, 18);
          ctx.stroke();
        }
        ctx.restore();
      };
      for (let i = 0; i < 4; i++) petal((i / 6) * Math.PI * 2, '#e2574c');
      ctx.fillStyle = '#f1cc4e';
      ctx.beginPath();
      ctx.arc(c, c, 22, 0, Math.PI * 2);
      ctx.fill();
    },
    { key: 'bordado-parcial' },
  );
}

export function createEmbroideryMachine({ needle, topY, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'bordadora';
  group.position.set(needle[0], topY, needle[1]);
  group.rotation.y = ry;
  const b = new Batch();
  const white = phys('bordadora-cuerpo', { color: '#f4f4f1', roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const gray = std('bordadora-gris', { color: '#a9afb4', roughness: 0.4 });
  const accent = std('bordadora-acento', { color: '#c46a45', roughness: 0.4 });
  // base y cuerpo (perfil en C extruido)
  b.box(0.36, BED_H, 0.2, white, { p: [0.12, BED_H / 2, -0.01], radius: 0.014, seg: 3, cast: true });
  const s = new THREE.Shape();
  s.moveTo(-0.06, HEAD_BOTTOM);
  s.lineTo(-0.06, 0.25);
  s.quadraticCurveTo(-0.06, 0.28, -0.03, 0.28);
  s.lineTo(0.26, 0.28);
  s.quadraticCurveTo(0.3, 0.28, 0.3, 0.24);
  s.lineTo(0.3, BED_H);
  s.lineTo(0.2, BED_H);
  s.lineTo(0.2, 0.17);
  s.quadraticCurveTo(0.2, 0.2, 0.17, 0.2);
  s.lineTo(0.01, 0.2);
  s.quadraticCurveTo(0.0, 0.2, 0.0, 0.185);
  s.lineTo(0.0, HEAD_BOTTOM);
  s.closePath();
  const body = extrude(s, 0.11, { bevel: 0.016, bevelSegments: 4 });
  b.add(body, white, { p: [0, 0, -0.07], uv: 'box', cast: true });
  body.dispose();
  b.box(0.27, 0.01, 0.004, accent, { p: [0.12, 0.262, 0.0405], radius: 0.002, seg: 1 });
  // unidad de bordado (a la izquierda) y riel del carro
  b.box(0.19, 0.05, 0.26, gray, { p: [-0.135, 0.025, 0.0], radius: 0.012, seg: 2, cast: true });
  b.box(0.012, 0.003, 0.22, darkPlastic(), { p: [-0.135, 0.0505, 0.0], radius: 0.001, seg: 1 });
  // pantalla táctil en el pilar
  const scr = new THREE.PlaneGeometry(0.075, 0.056);
  b.add(scr, std('pantalla-bordadora', { color: '#000000', emissive: '#ffffff', emissiveMap: screenTexture(), roughness: 0.2 }), { p: [0.25, 0.16, 0.0428], uv: 'keep' });
  scr.dispose();
  b.box(0.085, 0.066, 0.004, darkPlastic(), { p: [0.25, 0.16, 0.0395], radius: 0.004, seg: 1 });
  // botones start/stop
  b.cyl(0.008, 0.008, 0.006, std('boton-verde', { color: '#4fb08f', roughness: 0.3 }), { p: [-0.03, 0.17, 0.042], r: [Math.PI / 2, 0, 0], seg: 14 });
  b.cyl(0.008, 0.008, 0.006, accent, { p: [-0.03, 0.145, 0.042], r: [Math.PI / 2, 0, 0], seg: 14 });
  // placa de aguja
  b.box(0.08, 0.002, 0.06, chrome(), { p: [0.01, BED_H + 0.001, 0.005], radius: 0.001, seg: 1 });
  // perno de carretel
  b.cyl(0.0025, 0.0025, 0.06, chrome(), { p: [0.15, 0.28 + 0.03, -0.015], seg: 8 });
  b.flush(group, 'bordadora');

  // carretel
  const spool = new THREE.Group();
  place(spool, [0.15, 0.282, -0.015]);
  group.add(spool);
  spool.add(mesh(lathe([[0.003, 0], [0.02, 0], [0.02, 0.003], [0.01, 0.006], [0.01, 0.04], [0.02, 0.043], [0.02, 0.046], [0.003, 0.046]], 20), std('carretel-plastico', { color: '#f2f0ea', roughness: 0.4 })));
  let color = '#c2364a';
  const spoolThread = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.034, 24, 1, true), getThreadMaterial(color, 'rayon'), { p: [0, 0.023, 0] });
  spool.add(spoolThread);
  const threadMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
  group.add(mesh(tube([[0.15, 0.31, -0.015], [0.06, 0.29, 0.02], [-0.03, 0.24, 0.045], [-0.04, 0.19, 0.046], [-0.012, 0.15, 0.03]], 0.0005, { tubular: 40, radial: 4 }), threadMat, { receive: false }));

  // aguja
  const needleBar = new THREE.Group();
  group.add(needleBar);
  needleBar.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 10), chrome(), { p: [0, 0.07, 0] }));
  needleBar.add(mesh(lathe([[0, 0], [0.0005, 0.002], [0.0006, 0.035], [0.001, 0.04], [0, 0.04]], 8), steel()));
  needleBar.add(mesh(new THREE.BoxGeometry(0.014, 0.01, 0.012), std('pie-bordado', { color: '#cfd3d6', roughness: 0.3, metalness: 0.6 }), { p: [0, 0.006, -0.004] }));

  // carro + bastidor con tela
  const carriage = new THREE.Group();
  group.add(carriage);
  const hoopY = BED_H + 0.012;
  const hoopW = 0.13;
  const hoopD = 0.18;
  const hoopMat = std('bastidor', { color: '#e9e6df', roughness: 0.4 });
  const ring = (w, d, r, th) => {
    const outer = roundedRectShape(w + th * 2, d + th * 2, r + th);
    outer.holes.push(new THREE.Path(roundedRectShape(w, d, r).getPoints(32)));
    const g = extrude(outer, 0.012, { bevel: 0.002, bevelSegments: 1, curveSegments: 16 });
    g.rotateX(-Math.PI / 2);
    return g;
  };
  carriage.add(mesh(ring(hoopW, hoopD, 0.03, 0.008), hoopMat, { p: [0, hoopY - 0.006, 0.0], cast: true }));
  carriage.add(mesh(ring(hoopW + 0.016, hoopD + 0.016, 0.038, 0.006), hoopMat, { p: [0, hoopY - 0.009, 0.0] }));
  carriage.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 10).rotateX(Math.PI / 2), chrome(), { p: [0, hoopY, hoopD / 2 + 0.028] }));
  // tela tensada (algodón blanco) y bordado a medio hacer
  const cloth = mesh(new THREE.PlaneGeometry(hoopW + 0.01, hoopD + 0.01), getFabricMaterial('algodon_jersey', '#f3f1ea'), { r: [-Math.PI / 2, 0, 0], p: [0, hoopY - 0.002, 0], name: 'tela-bastidor' });
  const cuv = cloth.geometry.attributes.uv;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 0.14, cuv.getY(i) * 0.19);
  carriage.add(cloth);
  carriage.add(mesh(new THREE.PlaneGeometry(0.08, 0.08), std('bordado-parcial', { map: embroideredPatch(), transparent: true, roughness: 0.35 }), { r: [-Math.PI / 2, 0, 0], p: [0, hoopY - 0.0012, 0.0] }));
  // brazo del carro hacia la unidad de bordado
  carriage.add(mesh(new RoundedBoxGeometry(0.12, 0.016, 0.05, 2, 0.006), gray, { p: [-0.115, hoopY - 0.006, 0.0], cast: true }));

  let speed = 0;
  let target = 0;
  let phase = 0;
  let travel = 0;
  const plateTop = BED_H + 0.002;
  group.updateWorldMatrix(true, false);
  const hoopCenter = group.localToWorld(V3(0, hoopY - 0.002, 0));
  return {
    group,
    hoopCenter,
    // oculta el bastidor de demostración cuando un paso pone una prenda real
    setDemoVisible(v) {
      carriage.visible = !!v;
    },
    setRunning(v) {
      target = clamp(typeof v === 'boolean' ? (v ? 1 : 0) : v, 0, 1);
    },
    setThreadColor(hex) {
      color = hex;
      spoolThread.material = getThreadMaterial(hex, 'rayon');
      threadMat.color.set(hex);
    },
    update(dt) {
      speed = damp(speed, target, 8, dt);
      phase += speed * Math.PI * 2 * 11 * dt;
      travel += speed * dt;
      const k = 0.5 + 0.5 * Math.cos(phase);
      needleBar.position.y = plateTop - 0.002 + 0.02 * k;
      // el bastidor dibuja una figura (lissajous) en pasitos
      const step = Math.floor(phase / (Math.PI * 2));
      const u = step * 0.07;
      carriage.position.x = Math.sin(u * 1.3) * 0.018 * Math.min(1, travel * 4);
      carriage.position.z = Math.sin(u * 0.9 + 1) * 0.024 * Math.min(1, travel * 4);
      spool.rotation.y = -phase * 0.03;
    },
  };
}
