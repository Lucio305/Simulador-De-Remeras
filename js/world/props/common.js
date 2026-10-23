// Utilidades compartidas por los modelos del taller: materiales cacheados (compartidos),
// lotes de geometría estática que se mergean por material, UV en metros y formas 2D.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng } from '../../core/utils.js';
import { woodTextures } from './textures.js';

export { THREE, RoundedBoxGeometry };

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const DEG = Math.PI / 180;

// Aleatorio determinístico para que el taller se vea igual en cada carga.
let _seed = 1234;
export const rand = rng(_seed);
export const randRange = (a, b) => a + (b - a) * rand();
export function seeded(seed) {
  return rng(seed);
}

// ---------------------------------------------------------------------------
// Materiales compartidos (disposeObject los saltea por userData.shared)
// ---------------------------------------------------------------------------

export function markShared(mat) {
  mat.userData.shared = true;
  for (const k of Object.keys(mat)) {
    const v = mat[k];
    if (v && v.isTexture) v.userData.shared = true;
  }
  return mat;
}

const MATS = new Map();
export function material(key, make) {
  let m = MATS.get(key);
  if (!m) {
    m = markShared(make());
    m.name = key;
    MATS.set(key, m);
  }
  return m;
}
export const std = (key, params) => material(key, () => new THREE.MeshStandardMaterial(params));
export const phys = (key, params) => material(key, () => new THREE.MeshPhysicalMaterial(params));
export const basic = (key, params) => material(key, () => new THREE.MeshBasicMaterial(params));

// Materiales con color por vértice: muchos objetitos de distintos colores comparten uno
// solo y se mergean en un único mesh (usar con Batch.add(..., { color: '#hex' })).
const VC = {
  plastico: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 }),
  mate: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
  ceramica: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }),
  brillante: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
  esmalte: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  metal: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 }),
};
export function vc(kind = 'plastico') {
  return material(`vc-${kind}`, VC[kind] || VC.plastico);
}

// Materiales base del taller (paleta cálida: madera, metal pintado, verde agua, terracota).
export const PALETTE = {
  cream: '#efe6d6',
  wall: '#e7d2b3',
  sage: '#8fb5a3',
  teal: '#5f9a8f',
  mint: '#a9d3c2',
  terracotta: '#c46a45',
  mustard: '#d4a33b',
  walnut: '#5b3e2a',
  oak: '#b98b5b',
  ink: '#2b2420',
};

// Madera con veta (uv en metros: usar Batch con uv 'box' o 'cyl').
export function woodMaterial(kind = 'roble', { color = '#ffffff', normalScale = 0.5, key = '' } = {}) {
  const T = woodTextures(kind);
  return std(`madera-${kind}-${color}${key}`, {
    color,
    map: T.map,
    normalMap: T.normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: T.roughnessMap,
    roughness: 1,
    metalness: 0,
  });
}

export function metal(key = 'acero',{ color = '#c9ccd0', roughness = 0.32, metalness = 1, roughnessMap = null } = {}) {
  return std(`metal-${key}`, { color, roughness, metalness, roughnessMap });
}
export const chrome = () => metal('cromo', { color: '#e3e6ea', roughness: 0.12 });
export const steel = () => metal('acero', { color: '#c4c7cb', roughness: 0.34 });
export const darkSteel = () => metal('acero-oscuro', { color: '#6d7074', roughness: 0.42 });
export const brass = () => metal('bronce', { color: '#c9a05a', roughness: 0.3 });
export const blackPaint = () => std('pintura-negra', { color: '#232325', roughness: 0.5, metalness: 0.25 });
export const rubber = () => std('goma', { color: '#1c1c1e', roughness: 0.88, metalness: 0 });
export const whitePlastic = () => std('plastico-blanco', { color: '#f1efe9', roughness: 0.38, metalness: 0 });
export const grayPlastic = () => std('plastico-gris', { color: '#8a8d90', roughness: 0.45, metalness: 0 });
export const darkPlastic = () => std('plastico-oscuro', { color: '#38393c', roughness: 0.42, metalness: 0 });

// ---------------------------------------------------------------------------
// Transformaciones
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// Matriz desde { p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz] | número, order }
export function makeMatrix({ p = null, r = null, s = null, order = 'XYZ', q = null } = {}) {
  const m = new THREE.Matrix4();
  _p.set(0, 0, 0);
  if (p) _p.set(p[0], p[1], p[2]);
  if (q) _q.copy(q);
  else if (r) _q.setFromEuler(_e.set(r[0], r[1], r[2], order));
  else _q.identity();
  if (s == null) _s.set(1, 1, 1);
  else if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return m.compose(_p, _q, _s);
}

// Ubica un Object3D: place(obj, [x,y,z], [rx,ry,rz])
export function place(obj, p = null, r = null, s = null) {
  if (p) obj.position.set(p[0], p[1], p[2]);
  if (r) obj.rotation.set(r[0], r[1], r[2]);
  if (s != null) typeof s === 'number' ? obj.scale.setScalar(s) : obj.scale.set(s[0], s[1], s[2]);
  return obj;
}

export function mesh(geom, mat, { cast = false, receive = true, name = '', p, r, s } = {}) {
  const m = new THREE.Mesh(geom, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (name) m.name = name;
  place(m, p, r, s);
  return m;
}

// ---------------------------------------------------------------------------
// UV en metros
// ---------------------------------------------------------------------------

// Proyección tipo caja: cada cara toma las dos coordenadas del plano (metros).
// `grain` = eje a lo largo del cual corre la veta (u de la textura). Por defecto el más largo.
export function boxUV(g, grain = null, offset = [0, 0]) {
  g.computeBoundingBox();
  const size = g.boundingBox.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z];
  let gi = grain ? 'xyz'.indexOf(grain) : dims.indexOf(Math.max(...dims));
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const P = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    P[0] = pos.getX(i);
    P[1] = pos.getY(i);
    P[2] = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const a = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    let u;
    let v;
    if (gi !== a) {
      u = P[gi];
      v = P[gi === b ? c : b];
    } else {
      u = P[b];
      v = P[c];
    }
    uv[i * 2] = u + offset[0];
    uv[i * 2 + 1] = v + offset[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Cilindros / torneados: escala las uv (u alrededor, v a lo largo) a metros y
// las rota para que la veta (u de la textura) corra a lo largo del eje.
export function cylUV(g, radius, length, offset = [0, 0]) {
  const uv = g.attributes.uv;
  const C = Math.PI * 2 * radius;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, v * length + offset[0], u * C + offset[1]);
  }
  uv.needsUpdate = true;
  return g;
}

// Escala uniforme de las uv existentes (p. ej. uv 0..1 de un plano → metros).
export function scaleUV(g, su, sv = su) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

// ---------------------------------------------------------------------------
// Lote de geometría estática: se mergea por material al final
// ---------------------------------------------------------------------------

const KEEP = ['position', 'normal', 'uv', 'color'];
const _col = new THREE.Color();

export class Batch {
  constructor() {
    this.groups = new Map();
    this._r = seeded(77);
  }

  // add(geom, mat, { p, r, s, cast, receive, uv: 'box'|'cyl'|'keep', grain, cyl: [radio, largo] })
  add(geom, mat, opts = {}) {
    const g = geom.index ? geom.clone() : geom.clone();
    const off = opts.uvOffset || [this._r() * 4, this._r() * 4];
    if (opts.uv === 'box') boxUV(g, opts.grain || null, off);
    else if (opts.uv === 'cyl') cylUV(g, opts.cyl[0], opts.cyl[1], off);
    const m = opts.matrix || makeMatrix(opts);
    g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (mat.vertexColors) {
      // color por vértice (lineal); blanco si no se indicó
      _col.set(opts.color || '#ffffff');
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.set([_col.r, _col.g, _col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    } else if (g.attributes.color) g.deleteAttribute('color');
    g.morphAttributes = {};
    const cast = opts.cast ?? false;
    const receive = opts.receive ?? true;
    const key = `${mat.uuid}|${cast}|${receive}`;
    let entry = this.groups.get(key);
    if (!entry) {
      entry = { mat, cast, receive, geoms: [] };
      this.groups.set(key, entry);
    }
    entry.geoms.push(g);
    return this;
  }

  box(w, h, d, mat, opts = {}) {
    const g = opts.radius ? new RoundedBoxGeometry(w, h, d, opts.seg || 2, opts.radius) : new THREE.BoxGeometry(w, h, d);
    this.add(g, mat, { uv: 'box', ...opts });
    g.dispose();
    return this;
  }

  cyl(rTop, rBot, h, mat, opts = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, opts.seg || 16, 1, !!opts.open);
    this.add(g, mat, { uv: 'cyl', cyl: [Math.max(rTop, rBot), h], ...opts });
    g.dispose();
    return this;
  }

  // Crea un Mesh por material (y combinación de sombras) y los agrega a `parent`.
  flush(parent, name = 'estatico') {
    const out = [];
    for (const { mat, cast, receive, geoms } of this.groups.values()) {
      const anyNonIndexed = geoms.some((g) => !g.index);
      const list = anyNonIndexed ? geoms.map((g) => (g.index ? g.toNonIndexed() : g)) : geoms;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) {
        console.warn('[taller] no se pudo mergear', name, mat.name);
        continue;
      }
      merged.computeBoundingSphere();
      const m = mesh(merged, mat, { cast, receive, name: `${name}:${mat.name}` });
      parent.add(m);
      out.push(m);
      if (list !== geoms) for (const g of geoms) g.dispose();
    }
    this.groups.clear();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Formas
// ---------------------------------------------------------------------------

export function roundedRectShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function roundedRectPath(w, h, r, cx = 0, cy = 0) {
  const s = roundedRectShape(w, h, r, cx, cy);
  const p = new THREE.Path();
  p.curves = s.curves;
  return p;
}

export function circlePath(r, cx = 0, cy = 0, cw = false) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, cw);
  return p;
}

// Extrusión con bisel suave. La profundidad corre a lo largo de +Z (de 0 a depth).
export function extrude(shape, depth, { bevel = 0.003, bevelSegments = 2, curveSegments = 24, steps = 1 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
    steps,
  });
  if (bevel > 0) g.translate(0, 0, bevel);
  return g;
}

// Torneado desde pares [radio, y].
export function lathe(pairs, segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = pairs.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  return new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
}

// Tubo a lo largo de puntos [x,y,z] (curva Catmull-Rom).
export function tube(points, radius, { tubular = 48, radial = 8, closed = false, tension = 0.5 } = {}) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))),
    closed,
    'catmullrom',
    tension,
  );
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

// Orienta un cilindro (eje Y) entre dos puntos.
export function cylinderBetween(a, b, radius, mat, seg = 8) {
  const A = a.isVector3 ? a : V3(...a);
  const B = b.isVector3 ? b : V3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(radius, radius, len, seg, 1);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

export function matrixBetween(a, b) {
  const A = a.isVector3 ? a : V3(...a);
  const B = b.isVector3 ? b : V3(...b);
  const len = A.distanceTo(B);
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), B.clone().sub(A).normalize());
  return { matrix: new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, V3(1, len, 1)) };
}

// Posición de mundo de un Object3D (actualiza matrices).
export function worldPos(obj, local = V3()) {
  obj.updateWorldMatrix(true, false);
  return obj.localToWorld(local.clone());
}

// Lerp exponencial independiente de dt.
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
