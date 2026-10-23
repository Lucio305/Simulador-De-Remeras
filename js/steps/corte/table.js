// Corte · la mesa del tizado (misma tela, orillos, rollo y líneas de tiza que deja el paso
// anterior, vía tizado/table.js) con una tela que se puede agujerear: cada pieza cortada deja
// su hueco (se ve la base de corte), con sombra en el borde y la tiza partida por el corte.

import * as THREE from 'three';
import { createTableScene, chalkColorFor } from '../tizado/table.js';
import { FABRIC_WIDTH, FABRIC_MAX_LENGTH } from '../shared/fabricLayout.js';
import { createPieceMesh } from '../../shirt/shirt3d.js';
import { getFabricMaterial } from '../../materials/fabric.js';
import { offsetRibbon } from './path.js';

const L = FABRIC_MAX_LENGTH;
const W = FABRIC_WIDTH;
export const SHEET_TH = 0.0035; // espesor de la tela de la mesa (igual que tizado/table.js)

function gradientTexture({ w = 4, h = 64, stops }) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, h, 0, 0); // v = 0 abajo → v = 1 arriba
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Contorno en coords de tela → camino 2D para Shape (x, −z), ver uvs más abajo.
const toShapePts = (pts) => pts.map((p) => new THREE.Vector2(p.x, -p.z));

function clampInside(pts, pad = 0.0006) {
  return pts.map((p) => ({ x: Math.min(L - pad, Math.max(pad, p.x)), z: Math.min(W - pad, Math.max(pad, p.z)) }));
}

export function createCutTable({ fabric, color, heather, sizeLabel }) {
  const base = createTableScene({ fabric, color, heather, sizeLabel });
  const group = base.group;
  const topY = SHEET_TH;
  const mat = getFabricMaterial(fabric.id, color, { heather: !!heather });

  // Piezas del tizado que reemplazo por versiones con huecos (si no las encuentro, la tela
  // queda entera: las piezas igual se levantan, solo no se ve el hueco).
  // (si tizado/table.js las expone, se usan directo; si no, se buscan por nombre / material)
  const sheet0 = base.sheet || group.getObjectByName('tela-extendida');
  const shade0 = base.shade || group.children.find((m) => m.isMesh && m.material && m.material.blending === THREE.MultiplyBlending);
  const contact0 = base.contact || group.children.find((m) => m.isMesh && m.geometry?.parameters?.width > L + 0.05 && m !== shade0);
  const canHole = !!sheet0;

  // ---- tela con huecos ----
  let sheet = null;
  let shade = null;
  const holes = []; // { id, pts }
  const aoMat = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    alphaMap: gradientTexture({ stops: [[0, 'rgb(0,0,0)'], [0.55, 'rgb(70,70,70)'], [1, 'rgb(255,255,255)']] }),
    side: THREE.DoubleSide,
  });
  const aoMeshes = new Map();

  function sheetGeometry() {
    const shape = new THREE.Shape(toShapePts([
      { x: 0, z: 0 },
      { x: L, z: 0 },
      { x: L, z: W },
      { x: 0, z: W },
    ]));
    for (const h of holes) shape.holes.push(new THREE.Path(toShapePts(h.pts)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: SHEET_TH, bevelEnabled: false, curveSegments: 1, steps: 1 });
    // (X, Y, Zd) → (X, Zd, −Y): la forma (x, −z) queda en el plano XZ con espesor hacia +Y
    g.rotateX(-Math.PI / 2);
    // uv en metros con la convención de la tela del tizado: u = z (a lo ancho), v = x (a lo largo)
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i), p.getX(i));
    uv.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }

  function shadeGeometry() {
    const shape = new THREE.Shape(toShapePts([
      { x: 0, z: 0 },
      { x: L, z: 0 },
      { x: L, z: W },
      { x: 0, z: W },
    ]));
    for (const h of holes) shape.holes.push(new THREE.Path(toShapePts(h.pts)));
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / L, 1 - p.getZ(i) / W);
    uv.needsUpdate = true;
    return g;
  }

  function rebuild() {
    if (!canHole) return;
    if (!sheet) {
      sheet = new THREE.Mesh(sheetGeometry(), mat);
      sheet.name = 'corte-tela';
      sheet.receiveShadow = true;
      sheet.castShadow = false;
      group.add(sheet);
      sheet0.visible = false;
    } else {
      sheet.geometry.dispose();
      sheet.geometry = sheetGeometry();
    }
    if (shade0) {
      if (!shade) {
        shade = new THREE.Mesh(shadeGeometry(), shade0.material);
        shade.position.y = topY + 0.0001;
        shade.renderOrder = shade0.renderOrder;
        shade.raycast = () => {};
        group.add(shade);
        shade0.visible = false;
      } else {
        shade.geometry.dispose();
        shade.geometry = shadeGeometry();
      }
    }
  }

  // sombra de contacto: solo un marco alrededor de la tela (la original oscurece todo lo que
  // está debajo y se vería dentro de los huecos)
  if (contact0 && canHole) {
    contact0.visible = false;
    const frame = [
      { x: 0, z: 0 },
      { x: L, z: 0 },
      { x: L, z: W },
      { x: 0, z: W },
    ];
    const nrm = [
      { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
      { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
      { x: Math.SQRT1_2, z: Math.SQRT1_2 },
      { x: -Math.SQRT1_2, z: Math.SQRT1_2 },
    ].map((n) => ({ x: n.x * Math.SQRT2, z: n.z * Math.SQRT2 }));
    const g = offsetRibbon(frame, nrm, 0, 0.03, { closed: true, y: 0.0003 });
    const cm = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      alphaMap: gradientTexture({ stops: [[0, 'rgb(255,255,255)'], [0.4, 'rgb(90,90,90)'], [1, 'rgb(0,0,0)']] }),
    });
    const m = new THREE.Mesh(g, cm);
    m.renderOrder = 0;
    m.raycast = () => {};
    group.add(m);
  }

  // Agrega el hueco de una pieza (contorno real del corte, coords de tela) y su sombra interior.
  function addHole(id, pts, nrm) {
    const safe = clampInside(pts);
    holes.push({ id, pts: safe });
    rebuild();
    // sombra en el borde del hueco, sobre la base de corte (del borde hacia adentro de la pieza)
    const g = offsetRibbon(safe, nrm, -0.007, 0, { closed: true, y: -0.0004 });
    const ao = new THREE.Mesh(g, aoMat);
    ao.renderOrder = 0;
    ao.raycast = () => {};
    group.add(ao);
    aoMeshes.set(id, ao);
  }

  // Pieza cortada (createPieceMesh) con uv globales de la tela: mientras está en su lugar no se
  // nota ningún salto de textura entre la pieza y la tela que la rodea.
  // contorno (coords de tela) → coords locales de la pieza {x, y} según su ubicación
  function localOutline(pl, cutPts) {
    const c = Math.cos(pl.rot);
    const s = Math.sin(pl.rot);
    return cutPts.map((p) => {
      const rx = p.x - pl.x;
      const rz = p.z - pl.z;
      const lx = rx * c - rz * s;
      const lz = rx * s + rz * c;
      return { x: lx, y: -lz };
    });
  }

  // Malla de una parte de la pieza (contorno local), sin ubicar: uv globales de la tela según `pl`.
  function makeLocalPieceMesh(piece, pl, outline) {
    const c = Math.cos(pl.rot);
    const s = Math.sin(pl.rot);
    const mesh = createPieceMesh({ ...piece, outline }, mat, { thickness: SHEET_TH });
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      uv.setXY(i, pl.z - lx * s + lz * c, pl.x + lx * c + lz * s);
    }
    uv.needsUpdate = true;
    return mesh;
  }

  function makePieceMesh(piece, pl, cutPts) {
    const c = Math.cos(pl.rot);
    const s = Math.sin(pl.rot);
    const outline = localOutline(pl, cutPts);
    const mesh = createPieceMesh({ ...piece, outline }, mat, { thickness: SHEET_TH });
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const fx = pl.x + lx * c + lz * s;
      const fz = pl.z - lx * s + lz * c;
      uv.setXY(i, fz, fx);
    }
    uv.needsUpdate = true;
    mesh.position.set(pl.x, 0, pl.z);
    mesh.rotation.y = pl.rot;
    // matriz tela → local de la pieza (para colgarle la tiza y los piquetes)
    const toLocal = new THREE.Matrix4().makeRotationY(pl.rot).setPosition(pl.x, 0, pl.z).invert();
    mesh.userData.toLocal = toLocal;
    return mesh;
  }

  const chalkMatOf = () => base.chalkLines[0]?.mesh.material || null;

  return {
    group,
    base,
    topY,
    topWorldY: base.topWorldY,
    toWorld: base.toWorld,
    chalkHex: base.chalkHex || chalkColorFor(color),
    canHole,
    material: mat,
    addChalkLine: (pts, opts) => base.addChalkLine(pts, opts),
    chalkMat: chalkMatOf,
    addHole,
    makePieceMesh,
    makeLocalPieceMesh,
    localOutline,
    puff: (x, z, n) => base.puff(x, z, n),
    tick: (dt, t) => base.tick(dt, t),
  };
}
