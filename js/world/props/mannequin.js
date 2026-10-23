// Maniquí de prueba: torso de costura forrado en lino (más chico que una remera talle M
// para que la prenda lo cubra sin atravesarlo), cuello con tapa torneada y pie de madera
// de tres patas. neckAnchor = punto donde va el centro del cuello de la remera (HPS).

import { THREE, Batch, std, mesh, woodMaterial, brass, V3, lathe } from './common.js';
import { getFabricMaterial } from '../../materials/fabric.js';

// Perfil del torso [radio en X, y relativo al HPS]; en Z se aplana (DEPTH).
const TORSO = [
  [0.0, -0.53],
  [0.095, -0.53],
  [0.112, -0.5],
  [0.118, -0.44],
  [0.112, -0.36],
  [0.122, -0.27],
  [0.138, -0.18],
  [0.142, -0.12],
  [0.132, -0.08],
  [0.108, -0.055],
  [0.075, -0.04],
  [0.052, -0.03],
  [0.046, -0.01],
  [0.044, 0.03],
  [0.046, 0.045],
  [0.0, 0.047],
];
const DEPTH = 0.52;

export function createMannequin({ base, neckY = 1.45 }) {
  const group = new THREE.Group();
  group.name = 'maniqui-prueba';
  group.position.set(base[0], 0, base[2]);
  const b = new Batch();
  const wood = woodMaterial('nogal', { key: '-maniqui' });
  const brassM = brass();

  // torso: torneado aplanado en Z, uv aproximadas en metros
  const torsoGeo = lathe(TORSO, 40);
  torsoGeo.scale(1, 1, DEPTH);
  const uv = torsoGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.8, uv.getY(i) * 0.6);
  const linen = getFabricMaterial('lino', '#e2d3b8', { side: THREE.FrontSide });
  const torso = mesh(torsoGeo, linen, { cast: true, receive: true, p: [0, neckY, 0], name: 'torso' });
  group.add(torso);
  // ribete de costura a los costados del torso (cordón)
  const pipingMat = std('ribete-maniqui', { color: '#8a6a4c', roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const pts = TORSO.slice(1, 11).map(([r, y]) => V3(sx * r * 1.002, neckY + y, 0));
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 40, 0.0028, 6, false);
    b.add(g, pipingMat, { uv: 'keep' });
    g.dispose();
  }
  // tapa torneada del cuello
  const cap = lathe([[0, 0], [0.047, 0], [0.05, 0.008], [0.046, 0.016], [0.022, 0.024], [0.014, 0.036], [0.018, 0.046], [0, 0.05]], 28);
  cap.scale(1, 1, 0.9);
  b.add(cap, wood, { p: [0, neckY + 0.047, 0], uv: 'cyl', cyl: [0.04, 0.05], cast: true });
  cap.dispose();

  // caño central, virola de regulación y pie de tres patas
  const yTorsoBottom = neckY - 0.53;
  const hubY = 0.3;
  const pole = lathe([[0.012, 0], [0.012, yTorsoBottom - hubY]], 14);
  b.add(pole, brassM, { p: [0, hubY, 0], uv: 'keep', cast: true });
  pole.dispose();
  const collar = lathe([[0.0, 0], [0.02, 0], [0.024, 0.012], [0.024, 0.03], [0.018, 0.04], [0.0, 0.04]], 18);
  b.add(collar, brassM, { p: [0, hubY + 0.25, 0], uv: 'keep' });
  b.add(collar, wood, { p: [0, yTorsoBottom - 0.03, 0], uv: 'cyl', cyl: [0.02, 0.04] });
  collar.dispose();
  // perilla de ajuste
  b.cyl(0.006, 0.006, 0.04, brassM, { p: [0.03, hubY + 0.27, 0], r: [0, 0, Math.PI / 2], seg: 8 });
  b.cyl(0.012, 0.012, 0.01, brassM, { p: [0.052, hubY + 0.27, 0], r: [0, 0, Math.PI / 2], seg: 14 });
  const hub = lathe([[0, 0], [0.032, 0], [0.04, 0.03], [0.034, 0.07], [0.022, 0.1], [0.016, 0.13], [0, 0.13]], 20);
  b.add(hub, wood, { p: [0, hubY - 0.06, 0], uv: 'cyl', cyl: [0.035, 0.13], cast: true });
  hub.dispose();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const top = V3(Math.cos(a) * 0.03, hubY - 0.02, Math.sin(a) * 0.03);
    const foot = V3(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3);
    const curve = new THREE.QuadraticBezierCurve3(top, V3(Math.cos(a) * 0.2, hubY - 0.04, Math.sin(a) * 0.2), foot);
    const g = new THREE.TubeGeometry(curve, 16, 0.016, 10, false);
    b.add(g, wood, { uv: 'keep', cast: true });
    g.dispose();
    const tip = new THREE.SphereGeometry(0.02, 12, 8);
    b.add(tip, brassM, { p: [foot.x, 0.018, foot.z], s: [1, 0.85, 1] });
    tip.dispose();
  }
  b.flush(group, 'maniqui');

  return {
    group,
    neckAnchor: V3(base[0], neckY, base[2]),
  };
}
