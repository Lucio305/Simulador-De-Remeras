// Herramientas de corte: tijera de sastre (hojas que abren/cierran), cúter circular,
// tiza de sastre, regla y escuadra de aluminio, alfiletero con alfileres y cinta métrica.

import { THREE, std, mesh, V3, lathe, extrude, steel, chrome, brass, DEG, tube, vc } from './common.js';
import { drawTexture } from './textures.js';

const enamel = () => std('esmalte-negro', { color: '#1d1c1e', roughness: 0.28, metalness: 0.2 });
const bladeSteel = () => std('acero-hoja', { color: '#d5d9dd', roughness: 0.2, metalness: 1 });

// Cinta (tira plana) a lo largo de una curva. `side` = dirección del ancho.
export function ribbonGeometry(curve, width, side, segments = 80) {
  const pts = curve.getSpacedPoints(segments);
  const pos = new Float32Array((segments + 1) * 2 * 3);
  const uv = new Float32Array((segments + 1) * 2 * 2);
  let len = 0;
  for (let i = 0; i <= segments; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const a = pts[i].clone().addScaledVector(side, -width / 2);
    const b = pts[i].clone().addScaledVector(side, width / 2);
    pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    uv.set([len, 0, len, 1], i * 4);
  }
  const idx = [];
  for (let i = 0; i < segments; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Textura de cinta métrica (u en metros: repeat 1 = 1 m)
export function tapeTexture() {
  return drawTexture(
    2048,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#f2c94c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2b2420';
      for (let mm = 0; mm < 1000; mm += 5) {
        const x = (mm / 1000) * w;
        const cm = mm % 10 === 0;
        const big = mm % 50 === 0;
        ctx.fillRect(x, 0, cm ? 2 : 1, big ? h * 0.45 : cm ? h * 0.3 : h * 0.16);
        ctx.fillRect(x, h - (big ? h * 0.45 : cm ? h * 0.3 : h * 0.16), cm ? 2 : 1, h);
      }
      ctx.font = '700 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let c = 1; c < 100; c++) {
        ctx.fillStyle = c % 10 === 0 ? '#b42b2b' : '#2b2420';
        ctx.fillText(String(c), (c / 100) * w + 1, h / 2);
      }
    },
    { key: 'cinta-metrica' },
  );
}

// ---------------------------------------------------------------------------
// Tijera de sastre (~25 cm). Origen = pivote (cruce de hojas) al ras de la mesa,
// hojas a lo largo de +X, acostada en el plano XZ.
// ---------------------------------------------------------------------------

function bladeShape(len, wide, k = 1) {
  const s = new THREE.Shape();
  // contorno en 2D (x, y) → luego y pasa a ser -z; k = -1 espeja la hoja
  s.moveTo(-0.012, 0.0);
  s.quadraticCurveTo(-0.012, k * wide * 0.95, 0.0, k * wide);
  s.bezierCurveTo(len * 0.35, k * wide * 1.02, len * 0.75, k * wide * 0.6, len, k * 0.0007);
  s.lineTo(len, -k * 0.0006);
  s.bezierCurveTo(len * 0.7, -k * wide * 0.25, len * 0.3, -k * wide * 0.35, 0.0, -k * wide * 0.4);
  s.quadraticCurveTo(-0.012, -k * wide * 0.4, -0.012, 0.0);
  return s;
}

function scissorHalf({ top, loopCenter, loopR, color }) {
  const g = new THREE.Group();
  const T = 0.0024;
  const shape = bladeShape(0.135, 0.0105, top ? -1 : 1);
  const geo = extrude(shape, T, { bevel: 0.0006, bevelSegments: 1, curveSegments: 20 });
  geo.rotateX(-Math.PI / 2); // extrusión → +Y; y de la forma → -Z
  const blade = mesh(geo, bladeSteel(), { cast: true, name: 'hoja' });
  blade.position.y = top ? T + 0.0004 : 0;
  g.add(blade);
  // brazo y ojo de la manija (esmalte negro), doblados hacia arriba
  const y0 = top ? T * 1.5 : T * 0.5;
  const zs = top ? 1 : -1;
  const shank = tube(
    [
      [-0.004, y0, 0],
      [-0.025, y0 + 0.002, zs * 0.002],
      [-0.045, loopCenter[1] * 0.8, zs * 0.006],
      [loopCenter[0] + loopR[0] * 0.9, loopCenter[1], loopCenter[2] * 0.55],
    ],
    0.0042,
    { tubular: 20, radial: 8 },
  );
  g.add(mesh(shank, color, { cast: true }));
  const loopPts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    loopPts.push(V3(loopCenter[0] + Math.cos(a) * loopR[0], loopCenter[1] + Math.sin(a) * 0.002, loopCenter[2] + Math.sin(a) * loopR[1]));
  }
  const loopCurve = new THREE.CatmullRomCurve3(loopPts, true);
  g.add(mesh(new THREE.TubeGeometry(loopCurve, 48, 0.0048, 10, true), color, { cast: true }));
  return g;
}

export function createScissors() {
  const group = new THREE.Group();
  group.name = 'tijera';
  const color = enamel();
  const halfA = scissorHalf({ top: true, loopCenter: [-0.082, 0.02, 0.019], loopR: [0.021, 0.014], color });
  const halfB = scissorHalf({ top: false, loopCenter: [-0.094, 0.0055, -0.022], loopR: [0.032, 0.017], color });
  group.add(halfA, halfB);
  // tornillo del pivote
  const screw = mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.0072, 16), brass(), { p: [0, 0.0036, 0] });
  const head = mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.0012, 16), chrome(), { p: [0, 0.0062, 0] });
  group.add(screw, head);
  let open = 0;
  const setOpen = (t) => {
    open = Math.max(0, Math.min(1, t));
    const a = open * 32 * DEG;
    halfA.rotation.y = a / 2;
    halfB.rotation.y = -a / 2;
  };
  setOpen(0);
  return { group, setOpen, get open() { return open; } };
}

// ---------------------------------------------------------------------------
// Cúter circular (cuchilla de 45 mm). Origen = punto de contacto con la mesa;
// rueda a lo largo de +X; el mango sube hacia -X.
// ---------------------------------------------------------------------------

export function createRotaryCutter() {
  const group = new THREE.Group();
  group.name = 'cuter-circular';
  const R = 0.0225;
  const blade = new THREE.Group();
  blade.position.set(0, R, 0);
  group.add(blade);
  const disc = new THREE.CylinderGeometry(R, R, 0.0005, 56);
  disc.rotateX(Math.PI / 2);
  blade.add(mesh(disc, bladeSteel(), { cast: true }));
  const bevel = new THREE.TorusGeometry(R - 0.0012, 0.0006, 4, 56);
  blade.add(mesh(bevel, chrome()));
  // marcas para que se note el giro
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    blade.add(mesh(new THREE.CircleGeometry(0.0016, 10), std('marca-cuchilla', { color: '#8c9095', metalness: 1, roughness: 0.4 }), { p: [Math.cos(a) * 0.011, Math.sin(a) * 0.011, 0.0004] }));
  }
  const nut = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 6).rotateX(Math.PI / 2), chrome(), { p: [0, R, -0.004] });
  group.add(nut);
  // protector y mango (plástico verde agua + gris)
  const plastic = std('cuter-plastico', { color: '#4f9a8c', roughness: 0.35 });
  const grip = std('cuter-goma', { color: '#3b3e42', roughness: 0.7 });
  const guard = new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.004, 32, 1, false, Math.PI * 0.9, Math.PI * 0.75);
  guard.rotateX(Math.PI / 2);
  group.add(mesh(guard, plastic, { p: [0, R, 0.0035], cast: true }));
  // mango: torneado orientado hacia atrás y arriba
  const handle = lathe([[0.0, 0], [0.009, 0.0], [0.012, 0.02], [0.0135, 0.06], [0.0125, 0.105], [0.013, 0.13], [0.0095, 0.148], [0.0, 0.15]], 20);
  handle.scale(1, 1, 0.62);
  const hm = mesh(handle, plastic, { cast: true });
  hm.position.set(-0.002, R + 0.004, 0.009);
  hm.rotation.set(0, 0, 58 * DEG); // inclinado hacia -X, como se lo sostiene
  group.add(hm);
  const sleeve = lathe([[0.0126, 0.055], [0.0145, 0.06], [0.0145, 0.11], [0.0128, 0.115]], 20);
  sleeve.scale(1, 1, 0.62);
  const sm = mesh(sleeve, grip);
  sm.position.copy(hm.position);
  sm.rotation.copy(hm.rotation);
  group.add(sm);
  return {
    group,
    setRoll(angle) {
      blade.rotation.z = -angle;
    },
  };
}

// ---------------------------------------------------------------------------
// Tiza de sastre triangular (celeste). Origen = punta que marca, parada sobre la tela.
// ---------------------------------------------------------------------------

export function createChalk() {
  const group = new THREE.Group();
  group.name = 'tiza';
  const s = 0.048;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(s / 2, s * 0.866);
  shape.lineTo(-s / 2, s * 0.866);
  shape.closePath();
  const geo = extrude(shape, 0.007, { bevel: 0.0018, bevelSegments: 2 });
  geo.translate(0, 0.0015, -0.0035);
  const chalkMat = std('tiza-celeste', { color: '#9cc4e4', roughness: 0.95 });
  const m = mesh(geo, chalkMat, { cast: true, name: 'tiza' });
  m.rotation.z = -18 * DEG; // inclinada como cuando se arrastra
  group.add(m);
  return { group };
}

// ---------------------------------------------------------------------------
// Regla de aluminio + escuadra de sastre. Geometría acostada (XZ), origen en el
// vértice de la escuadra; brazo largo hacia +X, corto hacia -Z.
// ---------------------------------------------------------------------------

function rulerTexture(lengthCm) {
  return drawTexture(
    2048,
    96,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#d9dde1');
      g.addColorStop(1, '#c3c8cd');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1f2326';
      for (let mm = 0; mm <= lengthCm * 10; mm++) {
        const x = (mm / (lengthCm * 10)) * (w - 8) + 4;
        const cm = mm % 10 === 0;
        const half = mm % 5 === 0;
        ctx.fillRect(x, 0, cm ? 2 : 1, cm ? h * 0.42 : half ? h * 0.3 : h * 0.18);
      }
      ctx.font = '700 22px sans-serif';
      ctx.textAlign = 'center';
      for (let c = 0; c <= lengthCm; c += 1) {
        if (c % 5 !== 0 && lengthCm > 40) continue;
        ctx.fillText(String(c), (c / lengthCm) * (w - 8) + 4, h * 0.72);
      }
    },
    { key: `regla-${lengthCm}` },
  );
}

export function createRulerSet() {
  const group = new THREE.Group();
  group.name = 'reglas';
  const alu = std('aluminio', { color: '#c8cdd2', roughness: 0.32, metalness: 0.9 });
  const T = 0.003;
  const add = (len, wid, x, z, ry, cm) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(len, T, wid), alu, { p: [len / 2, T / 2, 0], cast: true }));
    const face = mesh(new THREE.PlaneGeometry(len, wid), std(`regla-cara-${cm}`, { map: rulerTexture(cm), roughness: 0.35, metalness: 0.6 }), { r: [-Math.PI / 2, 0, 0], p: [len / 2, T + 0.0002, 0] });
    g.add(face);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    group.add(g);
  };
  // escuadra en L: 60 cm × 30 cm
  add(0.6, 0.045, 0, -0.0225, 0, 60);
  add(0.3, 0.045, 0.0225, 0, Math.PI / 2, 30);
  // regla recta de 50 cm apoyada al lado
  add(0.5, 0.035, 0.08, -0.11, 0, 50);
  return { group };
}

// ---------------------------------------------------------------------------
// Alfiletero (tomate) con alfileres de cabeza de color
// ---------------------------------------------------------------------------

export function addPinCushion(b, { x, y, z, scale = 1 }) {
  const red = vc('mate');
  const g = new THREE.SphereGeometry(0.045 * scale, 24, 16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i);
    const vy = p.getY(i);
    const vz = p.getZ(i);
    const a = Math.atan2(vz, vx);
    const k = 1 - 0.06 * Math.pow(Math.abs(Math.cos(a * 4)), 6); // gajos
    p.setXYZ(i, vx * k, vy * 0.68, vz * k);
  }
  g.computeVertexNormals();
  b.add(g, red, { color: '#b8352e', p: [x, y + 0.03 * scale, z], cast: true, uv: 'keep' });
  g.dispose();
  const leaf = new THREE.ConeGeometry(0.014 * scale, 0.012 * scale, 5);
  b.add(leaf, vc('mate'), { color: '#4f7d3c', p: [x, y + 0.064 * scale, z] });
  leaf.dispose();
  const heads = ['#f1cc4e', '#2f5cb6', '#f3f1ea', '#e5732b', '#8fd0b8', '#6b4b9b', '#b42b2b'];
  const pinGeo = new THREE.CylinderGeometry(0.0004, 0.0004, 0.03, 4);
  const headGeo = new THREE.SphereGeometry(0.0028, 8, 6);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4;
    const el = 0.35 + (i % 4) * 0.22;
    const dir = V3(Math.cos(a) * Math.cos(el), Math.sin(el) * 0.9, Math.sin(a) * Math.cos(el)).normalize();
    const base = V3(x, y + 0.03 * scale, z).addScaledVector(dir, 0.028 * scale);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
    const tip = base.clone().addScaledVector(dir, 0.012);
    b.add(pinGeo, steel(), { matrix: new THREE.Matrix4().compose(base, q, V3(1, 1, 1)) });
    b.add(headGeo, vc('brillante'), { color: heads[i % heads.length], p: [tip.x, tip.y, tip.z] });
  }
  pinGeo.dispose();
  headGeo.dispose();
}

// Cinta métrica enrollada con una punta colgando por el borde (de +Z hacia abajo).
export function addTapeMeasure(b, { x, y, z, hang = 0.3, edgeZ = 0.05, ry = 0, rim = 0 }) {
  const tapeMat = std('cinta-metrica', { map: tapeTexture(), roughness: 0.55, side: THREE.DoubleSide });
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  // rollo
  const coil = new THREE.CylinderGeometry(0.03, 0.03, 0.016, 32);
  b.add(coil, std('cinta-rollo', { color: '#e9bd3e', roughness: 0.5 }), { matrix: new THREE.Matrix4().makeTranslation(0, 0.008, 0).premultiply(M), cast: true });
  coil.dispose();
  const curve = new THREE.CatmullRomCurve3([
    V3(0.0, 0.012, 0.028),
    V3(0.004, 0.004 + rim * 0.6, edgeZ * 0.55),
    V3(0.006, rim + 0.004, edgeZ - 0.006),
    V3(0.007, rim + 0.002, edgeZ + 0.006),
    V3(0.008, rim - 0.02, edgeZ + 0.012),
    V3(0.01, -hang * 0.5, edgeZ + 0.016),
    V3(0.006, -hang, edgeZ + 0.008),
  ]);
  const g = ribbonGeometry(curve, 0.016, V3(1, 0, 0), 60);
  b.add(g, tapeMat, { matrix: M.clone(), uv: 'keep' });
  g.dispose();
}
