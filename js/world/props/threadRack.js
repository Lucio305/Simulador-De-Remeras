// Rack de carreteles en la pared: tablero con clavijas inclinadas, un cono grande por
// cada hilo del catálogo (THREADS) y una colección de carreteles de madera de colores.

import { THREE, Batch, std, mesh, woodMaterial, V3, damp, lathe, DEG } from './common.js';
import { drawTexture } from './textures.js';
import { getThreadMaterial } from '../../materials/fabric.js';
import { THREADS } from '../../data/catalog.js';

export const SPOOL_COLORS = {
  poliester: '#efe9dc',
  algodon: '#c9ad82',
  nylon: '#3d5f95',
  rayon: '#c2364a',
};

const DECOR_COLORS = [
  '#b42b2b', '#e5732b', '#f1cc4e', '#8fd0b8', '#2f5cb6', '#6b4b9b', '#f0a9c4', '#1e1e21',
  '#4d5426', '#93c6e6', '#cf9a2c', '#f3f1ea', '#6a1f2c', '#5f9a8f', '#e7dcc4', '#1f2a46',
];

// Carretel de madera chico: devuelve geometrías (madera + hilo) con eje +Y y base en y=0.
function spoolGeoms(h = 0.042, r = 0.016) {
  const fl = 0.004;
  const wood = lathe(
    [[0.003, 0], [r + 0.002, 0], [r + 0.002, fl], [r * 0.55, fl + 0.002], [r * 0.55, h - fl - 0.002], [r + 0.002, h - fl], [r + 0.002, h], [0.003, h]],
    20,
  );
  const thread = new THREE.CylinderGeometry(r * 0.94, r * 0.94, h - fl * 2 - 0.002, 24, 1, true);
  thread.translate(0, h / 2, 0);
  return { wood, thread };
}

// Cono industrial de hilo: tubo de cartón cónico + hilo bobinado (bicónico).
function coneGeoms(h = 0.13) {
  const paper = lathe([[0.011, 0], [0.026, 0], [0.024, 0.008], [0.011, h + 0.008], [0.009, h + 0.008]], 24);
  const thread = lathe(
    [[0.024, 0.008], [0.036, 0.016], [0.0345, 0.04], [0.03, h * 0.62], [0.022, h * 0.9], [0.0135, h - 0.004], [0.0115, h]],
    32,
  );
  return { paper, thread };
}

function threadLabel(th) {
  return drawTexture(
    256,
    64,
    (ctx, W, H) => {
      ctx.fillStyle = '#f2e8d2';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2b2420';
      ctx.font = '700 30px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name = th.name.split(' ')[0].toUpperCase();
      ctx.fillText(name, W / 2, H / 2 + 2);
    },
    { key: `etiqueta-hilo-${th.id}` },
  );
}

export function createThreadRack({ center, width = 0.82, height = 0.66 }) {
  const group = new THREE.Group();
  group.name = 'rack-hilos';
  group.position.set(center[0], center[1], center[2]);
  const b = new Batch();
  const board = woodMaterial('haya', { key: '-rack' });
  const frame = woodMaterial('nogal', { key: '-rack' });
  const peg = woodMaterial('pino', { key: '-clavija' });
  b.box(width, height, 0.018, board, { p: [0, 0, 0.009], grain: 'x', cast: false });
  for (const sy of [-1, 1]) b.box(width + 0.04, 0.03, 0.03, frame, { p: [0, sy * (height / 2 + 0.005), 0.015], grain: 'x', cast: true });
  for (const sx of [-1, 1]) b.box(0.03, height + 0.04, 0.03, frame, { p: [sx * (width / 2 + 0.005), 0, 0.015], grain: 'y', cast: true });

  const pegAngle = 58 * DEG; // inclinación de las clavijas sobre la horizontal
  const pegDir = V3(0, Math.sin(pegAngle), Math.cos(pegAngle));
  const qPeg = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), pegDir);
  const pegGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.1, 8);
  pegGeo.translate(0, 0.05, 0);
  const addPeg = (x, y) => {
    const m = new THREE.Matrix4().compose(V3(x, y, 0.018), qPeg, V3(1, 1, 1));
    b.add(pegGeo, peg, { matrix: m, uv: 'box' });
    return m;
  };

  // carreteles decorativos (instanciados: madera + hilo de colores)
  const small = spoolGeoms();
  const rows = [height / 2 - 0.11, -height / 2 + 0.1];
  const perRow = 8;
  const decor = [];
  rows.forEach((y, j) => {
    for (let i = 0; i < perRow; i++) {
      const x = -width / 2 + 0.06 + (i * (width - 0.12)) / (perRow - 1);
      addPeg(x, y);
      decor.push({ x, y, color: DECOR_COLORS[(i + j * perRow) % DECOR_COLORS.length] });
    }
  });
  const woodSpool = woodMaterial('haya', { color: '#f3dfc4', key: '-carretel' });
  const decoThreadMat = getThreadMaterial('#ffffff', 'poliester');
  const instWood = new THREE.InstancedMesh(small.wood, woodSpool, decor.length);
  const instThread = new THREE.InstancedMesh(small.thread, decoThreadMat, decor.length);
  instWood.castShadow = instThread.castShadow = false;
  instWood.receiveShadow = instThread.receiveShadow = true;
  const col = new THREE.Color();
  decor.forEach((d, k) => {
    // apoyado en la clavija: base a 1.5 cm de la pared a lo largo de la clavija
    const base = V3(d.x, d.y, 0.018).addScaledVector(pegDir, 0.012);
    const m = new THREE.Matrix4().compose(base, qPeg, V3(1, 1, 1));
    instWood.setMatrixAt(k, m);
    instThread.setMatrixAt(k, m);
    instThread.setColorAt(k, col.set(d.color));
  });
  instThread.instanceColor.needsUpdate = true;
  group.add(instWood, instThread);

  // conos grandes: uno por hilo del catálogo, en la fila del medio
  const cone = coneGeoms();
  const paperMat = std('cono-carton', { color: '#d9c4a0', roughness: 0.8 });
  const spools = [];
  const midY = 0.0;
  THREADS.forEach((th, i) => {
    const x = -width / 2 + 0.11 + (i * (width - 0.22)) / (THREADS.length - 1);
    addPeg(x, midY - 0.03);
    const sg = new THREE.Group();
    sg.name = `cono-${th.id}`;
    const base = V3(x, midY - 0.03, 0.018).addScaledVector(pegDir, 0.01);
    sg.position.copy(base);
    sg.quaternion.copy(qPeg);
    const color = SPOOL_COLORS[th.id] || '#ffffff';
    const threadMesh = mesh(cone.thread, getThreadMaterial(color, th.id, { repeat: [3, 60] }), { cast: true, name: 'hilo' });
    sg.add(mesh(cone.paper, paperMat), threadMesh);
    group.add(sg);
    // etiqueta debajo
    const lbl = mesh(new THREE.PlaneGeometry(0.11, 0.028), std(`etiqueta-hilo-${th.id}`, { map: threadLabel(th), roughness: 0.8 }), {
      p: [x, midY - 0.085, 0.0185],
    });
    group.add(lbl);
    const spool = {
      threadId: th.id,
      group: sg,
      color,
      highlighted: false,
      _a: 0,
      _base: base.clone(),
      setColor(hex) {
        this.color = hex;
        threadMesh.material = getThreadMaterial(hex, th.id, { repeat: [3, 60] });
      },
      setHighlight(on) {
        this.highlighted = !!on;
      },
      update(dt) {
        this._a = damp(this._a, this.highlighted ? 1 : 0, 6, dt);
        // se adelanta por la clavija y gira un poquito
        sg.position.copy(this._base).addScaledVector(pegDir, 0.03 * this._a).add(V3(0, 0, 0.015 * this._a));
        sg.quaternion.copy(qPeg);
        sg.rotateY(this._a * 0.6);
      },
    };
    spools.push(spool);
  });
  pegGeo.dispose();
  b.flush(group, 'rack-hilos');

  return {
    group,
    spools,
    update(dt) {
      for (const s of spools) s.update(dt);
    },
  };
}
