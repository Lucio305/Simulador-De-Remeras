// Tira de tela que pasa por la máquina: capas de tela (unión de dos piezas, tira de ribb sobre el
// escote o dobladillo), línea guía de tiza, guía láser de la máquina y las puntadas que van quedando.
// Todo vive en el espacio local de la máquina ("frame": misma posición y rotación que su grupo).
// La tela se mueve sobre la base: lo que sale de la cama cae sobre la mesa (drapeado por vértice),
// y en el overlock la cuchilla recorta el margen a medida que se cose.

import * as THREE from 'three';
import { getFabricMaterial, getRibMaterial, getThreadMaterial } from '../../materials/fabric.js';
import { clamp, makeCanvas, rng, disposeObject } from '../../core/utils.js';

// Cama de cada máquina en su espacio local (bordes ya descontado el redondeo de la base).
export const BEDS = {
  maquina: { x0: -0.061, x1: 0.346, z0: -0.081, z1: 0.071, top: 0.0718, R: 0.014, needle: [0, 0.0718, 0], foot: true, bulk: -0.26 },
  // (a la izquierda del overlock está la máquina recta: la tela no puede extenderse tanto)
  overlock: { x0: -0.132, x1: 0.13, z0: -0.11, z1: 0.129, top: 0.0786, R: 0.007, needle: [-0.088, 0.0786, 0.07], bulk: -0.115 },
};

const TH = 1.32; // ángulo de caída de la tela al salir de la cama (~75°)
const ROW = 0.004;

// Perfil de caída por el borde: d = distancia (en la tela) más allá del borde.
function profile(d, H, R, o) {
  if (d <= 0) {
    o.h = d;
    o.y = 0;
    o.th = 0;
    return o;
  }
  const arc = R * TH;
  if (d <= arc) {
    const th = d / R;
    o.h = R * Math.sin(th);
    o.y = R * (1 - Math.cos(th));
    o.th = th;
    return o;
  }
  const y0 = R * (1 - Math.cos(TH));
  const h0 = R * Math.sin(TH);
  const s = d - arc;
  const drop = (H - y0) / Math.sin(TH);
  if (s <= drop) {
    o.h = h0 + s * Math.cos(TH);
    o.y = y0 + s * Math.sin(TH);
    o.th = TH;
    return o;
  }
  // apoyada en la mesa (con un pequeño redondeo del aterrizaje)
  const s2 = s - drop;
  const land = Math.min(1, s2 / 0.012);
  o.h = h0 + drop * Math.cos(TH) + s2;
  o.y = H;
  o.th = TH * (1 - land) * (1 - land);
  return o;
}

const _px = { h: 0, y: 0, th: 0 };
const _pz = { h: 0, y: 0, th: 0 };

// Punto de tela plano (xf, zf) en el frame → posición y normal drapeadas, con un desplazamiento
// `off` a lo largo de la normal (capas superpuestas). Devuelve también un factor de sombra.
function drape(bed, xf, zf, off, out) {
  const H = bed.top - 0.0008;
  const dx = bed.x0 - xf;
  const dzF = zf - bed.z1;
  const dzB = bed.z0 - zf;
  profile(dx > 0 ? dx : 0, H, bed.R, _px);
  const dz = dzF > 0 ? dzF : dzB > 0 ? dzB : 0;
  profile(dz, H, bed.R, _pz);
  const wx = clamp(1 - _pz.y / H);
  const wz = clamp(1 - _px.y / H);
  let x = xf;
  let z = zf;
  if (dx > 0) x = bed.x0 - (dx + (_px.h - dx) * wx);
  if (dzF > 0) z = bed.z1 + (dzF + (_pz.h - dzF) * wz);
  else if (dzB > 0) z = bed.z0 - (dzB + (_pz.h - dzB) * wz);
  let y = bed.top - Math.max(_px.y, _pz.y);
  // pliegues suaves: la tela que cuelga ondula a lo largo del borde, la que está en la mesa se abomba
  const fall = Math.max(_px.y, _pz.y) / H;
  if (fall > 0.01) {
    const amp = 0.0065 * Math.sin(Math.min(1, fall * 1.15) * Math.PI * 0.5);
    if (dx > 0) x -= amp * (0.7 * Math.sin(zf * 58 + 1.3) + 0.3 * Math.sin(zf * 23 + 0.4) + 0.35);
    if (dzF > 0) z += amp * (0.7 * Math.sin(xf * 52 + 0.7) + 0.3 * Math.sin(xf * 19 + 2.1) + 0.35);
    else if (dzB > 0) z -= amp * (0.6 * Math.sin(xf * 47) + 0.4);
    if (fall > 0.985) {
      const fx = dx > 0 ? _px.h - 0.03 : 0;
      const fz = dz > 0 ? _pz.h - 0.03 : 0;
      const land = clamp(Math.max(fx, fz) / 0.06);
      y += land * 0.005 * (0.5 + 0.5 * Math.sin(xf * 31 + zf * 17)) * (0.55 + 0.45 * Math.sin(zf * 43 - xf * 11 + 1));
    }
  }
  const tx = _px.th * wx;
  const tz = _pz.th * wz;
  let nx = dx > 0 ? -Math.sin(tx) : 0;
  let nz = dzF > 0 ? Math.sin(tz) : dzB > 0 ? -Math.sin(tz) : 0;
  let ny = Math.cos(tx) * Math.cos(tz);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  out[0] = x + nx * off;
  out[1] = y + ny * off;
  out[2] = z + nz * off;
  out[3] = nx;
  out[4] = ny;
  out[5] = nz;
  // sombra: caída vertical algo más oscura, contacto con la mesa al pie del borde
  const nearFoot = fall > 0.98 ? Math.max(dx > 0 ? 1 - Math.min(1, (_px.h - 0.02) / 0.05) : 0, dz > 0 ? 1 - Math.min(1, (_pz.h - 0.02) / 0.05) : 0) : 0;
  out[6] = 1 - 0.18 * Math.sin(Math.min(1, fall) * Math.PI) - 0.2 * clamp(nearFoot);
  return out;
}

// ---------------------------------------------------------------------------
// Texturas
// ---------------------------------------------------------------------------
let chalkTex = null;
function chalkTexture() {
  if (chalkTex) return chalkTex;
  const W = 32;
  const Hh = 256;
  const c = makeCanvas(W, Hh);
  const g = c.getContext('2d');
  const img = g.createImageData(W, Hh);
  const r = rng(77);
  for (let y = 0; y < Hh; y++) {
    const band = 0.75 + 0.25 * Math.sin(y * 0.11) * Math.sin(y * 0.037 + 1.3);
    for (let x = 0; x < W; x++) {
      const t = Math.abs(x / (W - 1) - 0.5) * 2;
      const edge = clamp((1 - t) * 2.6);
      const grain = r() < 0.18 ? 0.6 : 1;
      const a = clamp(edge * (0.82 + 0.18 * band) * grain * (0.88 + r() * 0.25));
      // alphaMap usa el canal verde: la opacidad va en RGB
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  chalkTex = new THREE.CanvasTexture(c);
  chalkTex.wrapS = THREE.ClampToEdgeWrapping;
  chalkTex.wrapT = THREE.RepeatWrapping;
  chalkTex.userData.shared = true;
  return chalkTex;
}

let laserTex = null;
function laserTexture() {
  if (laserTex) return laserTex;
  const c = makeCanvas(16, 128);
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.75, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 128);
  const g2 = g.createLinearGradient(0, 0, 16, 0);
  g2.addColorStop(0, 'rgba(0,0,0,1)');
  g2.addColorStop(0.5, 'rgba(0,0,0,0)');
  g2.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = g2;
  g.fillRect(0, 0, 16, 128);
  laserTex = new THREE.CanvasTexture(c);
  laserTex.userData.shared = true;
  return laserTex;
}

// ---------------------------------------------------------------------------
// Capa de tela deformable
// ---------------------------------------------------------------------------
// cols: [{ du, dy, ao, cut }] desplazamiento lateral respecto de la guía, altura de capa, sombreado y
// si la cuchilla del overlock la recorta.
function makeLayer({ piece, cols, material, v0, v1, step = ROW, swapUV = false, chalk = false }) {
  const rowsV = [];
  for (let v = v0; v < v1 - 1e-6; v += step) rowsV.push(v);
  rowsV.push(v1);
  const R = rowsV.length;
  const C = cols.length;
  const n = R * C;
  const baseU = new Float32Array(n);
  const baseV = new Float32Array(n);
  const off = new Float32Array(n);
  const ao = new Float32Array(n);
  const du = new Float32Array(n);
  const cut = new Uint8Array(n);
  const rowOf = new Uint16Array(n);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = chalk ? null : new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < R; i++) {
    const v = rowsV[i];
    const g = piece.g(v);
    for (let j = 0; j < C; j++) {
      const k = i * C + j;
      const c = cols[j];
      baseU[k] = g + c.du;
      baseV[k] = v;
      off[k] = c.dy;
      ao[k] = c.ao ?? 1;
      du[k] = c.du;
      cut[k] = c.cut ? 1 : 0;
      rowOf[k] = i;
      if (chalk) {
        uv[k * 2] = j / (C - 1);
        uv[k * 2 + 1] = v / 0.06;
      } else if (swapUV) {
        uv[k * 2] = v;
        uv[k * 2 + 1] = baseU[k];
      } else {
        uv[k * 2] = baseU[k];
        uv[k * 2 + 1] = v;
      }
    }
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < C - 1; j++) {
      const a = i * C + j;
      const b = a + 1;
      const c = a + C;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = !chalk;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  if (chalk) mesh.renderOrder = 2;
  return { mesh, geo, n, baseU, baseV, off, ao, du, cut, rowOf, rowsV, pos, nrm, col, piece };
}

// Columnas (desplazamientos laterales respecto de la guía) densas cerca de la costura y del borde de la cama.
function bulkCols(min = -0.26) {
  const out = [-0.26, -0.21, -0.175, -0.15, -0.13, -0.115].filter((u) => u > min + 1e-4);
  out.unshift(min);
  for (let u = -0.105; u <= -0.0299; u += 0.005) if (u > min + 0.004) out.push(Math.round(u * 1e4) / 1e4);
  out.push(-0.025, -0.02, -0.016, -0.012, -0.009, -0.006, -0.004, -0.002, 0, 0.002, 0.004, 0.006);
  return out;
}

// ---------------------------------------------------------------------------
export function createStrip({ course, bed, fabric, color, heather, threadColor, threadId, stitchId, thicknessId = 'medio', tensionState = 'ok', pucker = 0, chalkColor }) {
  const group = new THREE.Group();
  group.name = 'costura-tira';
  const rig = new THREE.Group();
  rig.name = 'costura-puntadas';
  group.add(rig);
  const t = clamp((fabric?.gsm || 165) / 165, 0.7, 1.4) * 0.00075; // espesor de una capa
  const fabMat = getFabricMaterial(fabric.id, color, { heather, vertexColors: true });
  const ribMat = getRibMaterial(fabric.id, color, { heather, vertexColors: true });
  const overlock = stitchId === 'overlock';
  const layers = [];
  let topDy = t;

  for (const piece of course.pieces) {
    const v0 = piece.a - 0.004;
    const v1 = piece.b + 0.004;
    const A = course.allow;
    const base = bulkCols(bed.bulk ?? -0.26);
    if (course.kind === 'union') {
      // capa de abajo (borde 1,2 mm corrido) y capa de arriba con su canto
      const bottom = base.filter((u) => u < A - 0.0025).map((u) => ({ du: u, dy: 0, ao: 0.86, cut: u > 0.0045 }));
      bottom.push({ du: A - 0.0015, dy: 0, ao: 0.86, cut: true }, { du: A + 0.0012, dy: 0, ao: 0.8, cut: true }, { du: A + 0.0014, dy: -t * 0.6, ao: 0.55, cut: true });
      const top = base.filter((u) => u < A - 0.0025).map((u) => ({ du: u, dy: t, cut: u > 0.0045 }));
      top.push({ du: A - 0.0015, dy: t, cut: true }, { du: A, dy: t * 0.85, ao: 0.92, cut: true }, { du: A + 0.0002, dy: 0.0002, ao: 0.6, cut: true });
      layers.push(makeLayer({ piece, cols: bottom, material: fabMat, v0, v1 }));
      layers.push(makeLayer({ piece, cols: top, material: fabMat, v0, v1 }));
      topDy = t;
    } else if (course.kind === 'band') {
      // la prenda abajo y la tira de ribb doblada (2 cm) arriba, con los bordes crudos juntos
      const bottom = base.filter((u) => u < A - 0.002).map((u) => ({ du: u, dy: 0, ao: 0.9, cut: u > 0.0045 }));
      bottom.push({ du: A - 0.001, dy: 0, ao: 0.9, cut: true }, { du: A + 0.0012, dy: 0, ao: 0.82, cut: true }, { du: A + 0.0014, dy: -t * 0.6, ao: 0.55, cut: true });
      const W = 0.02;
      const bandT = t * 2.1;
      const band = [
        { du: A - W - 0.0004, dy: t * 0.2, ao: 0.55 },
        { du: A - W, dy: t + bandT * 0.55, ao: 0.82 },
        { du: A - W + 0.0012, dy: t + bandT, ao: 0.95 },
      ];
      for (let u = A - W + 0.003; u < A - 0.0016; u += 0.0025) band.push({ du: u, dy: t + bandT, cut: u > 0.0045 });
      band.push({ du: A - 0.001, dy: t + bandT, cut: true }, { du: A, dy: t + bandT * 0.7, ao: 0.85, cut: true }, { du: A + 0.0002, dy: t * 0.4, ao: 0.55, cut: true });
      layers.push(makeLayer({ piece, cols: bottom, material: fabMat, v0, v1 }));
      layers.push(makeLayer({ piece, cols: band, material: ribMat, v0, v1, swapUV: true }));
      topDy = t + bandT;
    } else {
      // dobladillo: una capa con el borde doblado a la derecha (el margen queda abajo)
      const cols = base.filter((u) => u < A - 0.0025).map((u) => ({ du: u, dy: u > -0.007 ? t * 2 : t, cut: u > 0.0045 }));
      for (let u = 0.008; u < A - 0.0024; u += 0.0025) cols.push({ du: u, dy: t * 2, cut: true });
      cols.push({ du: A - 0.0012, dy: t * 2.05, cut: true }, { du: A - 0.0002, dy: t * 1.6, ao: 0.9, cut: true }, { du: A + 0.0004, dy: t * 0.8, ao: 0.72, cut: true }, { du: A + 0.0001, dy: 0.0001, ao: 0.5, cut: true });
      const filtered = [];
      for (const c of cols) if (!filtered.length || c.du > filtered[filtered.length - 1].du - 1e-6 || c.dy < 0.0003) filtered.push(c);
      layers.push(makeLayer({ piece, cols: filtered, material: fabMat, v0, v1 }));
      topDy = t * 2;
    }
  }
  for (const L of layers) group.add(L.mesh);

  // línea de tiza sobre la capa de arriba
  const chalkMat = new THREE.MeshStandardMaterial({
    color: chalkColor,
    roughness: 1,
    metalness: 0,
    transparent: true,
    alphaMap: chalkTexture(),
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const chalks = [];
  for (const piece of course.pieces) {
    const cl = makeLayer({ piece, cols: [{ du: -0.00095, dy: topDy + 0.00012 }, { du: 0.00095, dy: topDy + 0.00012 }], material: chalkMat, v0: piece.a, v1: piece.b, step: 0.002, chalk: true });
    chalks.push(cl);
    group.add(cl.mesh);
  }

  // guía láser: línea fija desde la aguja hacia la persona (sobre la cama plana)
  const lz0 = bed.needle[2] + (bed.foot ? 0.026 : 0.012);
  const lz1 = Math.min(bed.z1 - 0.004, bed.needle[2] + 0.075);
  const laserGeo = new THREE.PlaneGeometry(0.0008, lz1 - lz0);
  laserGeo.rotateX(-Math.PI / 2);
  laserGeo.translate(bed.needle[0], bed.top + topDy + 0.0004, (lz0 + lz1) / 2);
  // halo rojo muy suave + núcleo fino: no tapa la tiza cuando la aguja va justo sobre la línea
  const laserMat = new THREE.MeshBasicMaterial({ color: '#ff2a12', map: laserTexture(), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const laser = new THREE.Mesh(laserGeo, laserMat);
  laser.renderOrder = 3;
  laser.scale.x = 2.2;
  laser.position.x = bed.needle[0] * (1 - 2.2);
  group.add(laser);
  const coreMat = new THREE.MeshBasicMaterial({ color: '#ff6a4a', map: laserTexture(), transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const core = new THREE.Mesh(laserGeo, coreMat);
  core.renderOrder = 4;
  core.scale.x = 0.36;
  core.position.x = bed.needle[0] * (1 - 0.36);
  group.add(core);
  // la uv v=0 queda del lado de la persona: invertir para que el brillo nazca en la aguja
  {
    const uvA = laserGeo.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));
    uvA.needsUpdate = true;
  }

  // ---------- puntadas ----------
  // (un poco exagerado respecto del hilo real para que la puntada se lea en pantalla)
  const radius = { fino: 0.00036, medio: 0.00044, grueso: 0.00056 }[thicknessId] || 0.00044;
  const rMul = tensionState === 'low' ? 1.25 : tensionState === 'high' ? 0.82 : 1;
  const lift = tensionState === 'low' ? 0.00035 : tensionState === 'high' ? -0.00012 : 0.00005;
  // cápsula de largo total 1 a lo largo de +Z y radio 0,5 (se escala por instancia)
  const capGeo = new THREE.CapsuleGeometry(0.5, 1, 2, 6);
  capGeo.rotateX(Math.PI / 2);
  capGeo.scale(1, 1, 0.5);
  const perPen = overlock ? 4 : stitchId === 'recubridora' ? 2 : 1;
  const cap = Math.ceil(((course.end + 0.12) / 0.0007) * perPen) + 64;
  const threadMat = getThreadMaterial(threadColor, threadId || 'poliester');
  const inst = new THREE.InstancedMesh(capGeo, threadMat, cap);
  inst.count = 0;
  inst.frustumCulled = false;
  inst.castShadow = false;
  inst.receiveShadow = false;
  rig.add(inst);
  // surco/sombra bajo cada puntada: el hilo hunde un poco la tela (se lee aunque el hilo sea al tono)
  const grooveMat = new THREE.MeshBasicMaterial({ color: '#1a120c', transparent: true, opacity: 0.42, depthWrite: false });
  const groove = new THREE.InstancedMesh(capGeo, grooveMat, cap);
  groove.count = 0;
  groove.frustumCulled = false;
  groove.renderOrder = 1;
  rig.add(groove);
  // parámetros de cada puntada (para poder ocultarla y volver a mostrarla)
  const P = { u: new Float32Array(cap), v: new Float32Array(cap), y: new Float32Array(cap), a: new Float32Array(cap), l: new Float32Array(cap), r: new Float32Array(cap) };
  const shown = new Uint8Array(cap);
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const wob = rng(5);

  function compose(i) {
    const r = P.r[i];
    _p.set(P.u[i], P.y[i], P.v[i]);
    _q.setFromAxisAngle(_Y, P.a[i]);
    _s.set(r * 2, r * 1.5, P.l[i]);
    _m.compose(_p, _q, _s);
    inst.setMatrixAt(i, _m);
    _p.y = P.y[i] - r * 0.75;
    _s.set(r * 3.6, r * 0.6, P.l[i] * 1.08 + r);
    _m.compose(_p, _q, _s);
    groove.setMatrixAt(i, _m);
  }

  function dash(u1, v1, u2, v2, { r = radius * rMul, y = 0, shrink = 0.86 } = {}) {
    if (inst.count >= cap) return;
    const du = u2 - u1;
    const dv = v2 - v1;
    const len = Math.hypot(du, dv);
    if (len < 1e-5) return;
    const i = inst.count++;
    let mu = (u1 + u2) / 2;
    if (tensionState === 'low') mu += (wob() - 0.5) * 0.0005;
    P.u[i] = mu;
    P.v[i] = (v1 + v2) / 2;
    P.y[i] = bed.top + topDy + r * 0.45 + lift + y;
    P.a[i] = Math.atan2(du, dv);
    P.l[i] = Math.max(len * shrink, r * 2.2);
    P.r[i] = r;
    shown[i] = 0;
    inst.setMatrixAt(i, ZERO);
    groove.count = inst.count;
    groove.setMatrixAt(i, ZERO);
    inst.instanceMatrix.needsUpdate = true;
    groove.instanceMatrix.needsUpdate = true;
    visibility(i, rig.position.x, rig.position.z);
  }

  // Una puntada se ve si salió de abajo del prensatelas y todavía no pasó por detrás de la cama.
  function visibility(i, nx, nz) {
    const z = nz + P.v[i];
    let vis = z > bed.z0 - 0.003;
    if (vis && bed.foot && foot > 0.5) {
      const x = nx + P.u[i] - bed.needle[0];
      const dz = z - bed.needle[2];
      if (Math.abs(x) < 0.0068 && dz > -0.0145 && dz < 0.0195) vis = false;
    }
    if (vis !== !!shown[i]) {
      shown[i] = vis ? 1 : 0;
      if (vis) compose(i);
      else {
        inst.setMatrixAt(i, ZERO);
        groove.setMatrixAt(i, ZERO);
      }
      inst.instanceMatrix.needsUpdate = true;
      groove.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- recorte del overlock ----------
  // por fila de cada capa: u de corte (NaN = sin cortar)
  const cutByLayer = layers.map((L) => new Float32Array(L.rowsV.length).fill(NaN));

  const tmp = new Float32Array(7);
  let lastKey = '';
  // el prensatelas aprieta la tela contra la placa (solo en la máquina recta)
  const footDip = bed.foot ? topDy + 0.0004 : 0;
  let foot = 0;
  let pSew = -1;
  function update(p, fx, footDown = 0) {
    const nx = bed.needle[0] + fx;
    const nz = bed.needle[2] - p;
    const key = `${nx.toFixed(5)}|${nz.toFixed(5)}|${footDown.toFixed(2)}`;
    foot = footDown;
    pSew = p;
    rig.position.set(nx, 0, nz);
    for (let i = 0; i < inst.count; i++) visibility(i, nx, nz);
    if (key === lastKey && !cutDirty) return;
    lastKey = key;
    cutDirty = false;
    const all = layers.concat(chalks);
    for (let li = 0; li < all.length; li++) {
      const L = all[li];
      const cuts = li < layers.length ? cutByLayer[li] : null;
      const { n, baseU, baseV, off, ao, cut, rowOf, pos, nrm, col, du } = L;
      for (let k = 0; k < n; k++) {
        let u = baseU[k];
        if (cuts && cut[k]) {
          const cu = cuts[rowOf[k]];
          if (cu === cu && u > cu) u = cu;
        }
        drape(bed, nx + u, nz + baseV[k], off[k], tmp);
        // tensión alta / puntada corta: la costura frunce la tela a los costados de la línea
        if (pucker > 0 && baseV[k] < pSew) {
          const d = Math.abs(du[k]);
          const w = clamp((d - 0.0008) / 0.0022) * (1 - clamp((d - 0.006) / 0.007));
          if (w > 0) tmp[1] += pucker * w * (0.5 + 0.5 * Math.sin(baseV[k] * 523 + d * 180));
        }
        if (footDip && foot > 0) {
          const ax = Math.abs(tmp[0] - bed.needle[0]);
          const az = tmp[2] - bed.needle[2];
          const wx = 1 - clamp((ax - 0.0062) / 0.0045);
          const wz = 1 - clamp(az > 0 ? (az - 0.018) / 0.006 : (-az - 0.014) / 0.006);
          if (wx > 0 && wz > 0) tmp[1] -= footDip * foot * wx * wx * (3 - 2 * wx) * wz * wz * (3 - 2 * wz);
        }
        pos[k * 3] = tmp[0];
        pos[k * 3 + 1] = tmp[1];
        pos[k * 3 + 2] = tmp[2];
        nrm[k * 3] = tmp[3];
        nrm[k * 3 + 1] = tmp[4];
        nrm[k * 3 + 2] = tmp[5];
        if (col) {
          const s = tmp[6] * ao[k];
          col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = s;
        }
      }
      L.geo.attributes.position.needsUpdate = true;
      if (col) {
        L.geo.computeVertexNormals();
        L.geo.attributes.color.needsUpdate = true;
      } else L.geo.attributes.normal.needsUpdate = true;
    }
  }
  let cutDirty = false;

  // La cuchilla del overlock corta a `uCut` (coords de tela) todas las filas hasta v.
  function trimUpTo(v, uCut) {
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const cuts = cutByLayer[li];
      for (let i = 0; i < L.rowsV.length; i++) {
        if (L.rowsV[i] <= v && cuts[i] !== cuts[i]) {
          cuts[i] = uCut;
          cutDirty = true;
        }
      }
    }
  }

  function dispose() {
    group.parent?.remove(group);
    inst.dispose();
    groove.dispose();
    disposeObject(group);
    capGeo.dispose();
  }

  return { group, rig, inst, topDy, update, dash, trimUpTo, dispose, radius, laser };
}
