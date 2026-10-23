// Remera 3D "en maniquí invisible": paneles frente/espalda inflados con bocas abiertas,
// cuello de ribb, dobladillos con pespunte, costuras con puntadas del color del hilo,
// arrugas geométricas que se planchan, quemaduras, estampas con relieve real e hilos sueltos.
// Origen del grupo = centro del cuello a la altura del HPS; el frente mira a +Z.

import * as THREE from 'three';
import { getFabricMaterial, getRibMaterial, getThreadMaterial } from '../materials/fabric.js';
import { buildSurfaces, computeNormals, blendSeamNormals, TriIndex } from './surface.js';
import { makeWrinkleField, sampleGrid, makeMask, rasterInside, WBOX } from './wrinkles.js';
import { NeckBand, EdgeFold, StitchGroup, attachEval, makeLooseThread, disposeLooseThread } from './trims.js';
import { buildPrintPatch, makePrintMaterial, applyWearLocal, buildScorch } from './decals.js';
import { mixHex, clamp, smoothstep, rng, polylineLength } from '../core/utils.js';

const SIDES = ['frente', 'espalda'];
const _p = [0, 0, 0];
const _n = [0, 0, 0];

// ---------- utilidades 2D ----------
function pointAt(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + l >= d) {
      const t = l ? (d - acc) / l : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += l;
  }
  return { ...pts[pts.length - 1] };
}
// Desplaza una polilínea `dist` metros hacia el lado de `ref` (punto de referencia).
function offsetLine(pts, dist, ref) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if ((ref.x - pts[i].x) * nx + (ref.y - pts[i].y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    out.push({ x: pts[i].x + nx * dist, y: pts[i].y + ny * dist });
  }
  return out;
}
const revPts = (a) => a.slice().reverse();
// El Raycaster de three no mira `visible`: las partes ocultas no deben recibir clics.
function raycastIfVisible(raycaster, intersects) {
  let o = this;
  while (o) {
    if (!o.visible) return;
    o = o.parent;
  }
  THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
}

export class Shirt3D {
  constructor({ pattern, fabric, color = '#f3f1ea', heather = false, threadColor = '#f3f1ea' } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'remera';
    this.root = new THREE.Group(); // escala de encogimiento (prueba de lavado)
    this.root.name = 'remera-cuerpo';
    this.group.add(this.root);
    this.fabric = fabric || { id: 'algodon_jersey', weave: 'jersey', knit: true };
    this.color = color;
    this.heather = !!heather;
    this.threadColor = threadColor;
    this.inflation = 1;
    this.wrinkleAmount = 0;
    this.parts = { frente: true, espalda: true, mangas: true, cuello: true, ruedos: true };
    this.seamProgress = { hombros: 1, cuello: 1, mangas: 1, sisas: 1, costados: 1, punos: 1, ruedo: 1 };
    this.looseThreads = [];
    this._prints = { frente: null, espalda: null };
    this._printMeshes = { frente: null, espalda: null };
    this._scorches = [];
    this._wear = { fade: 0, crack: 0 };
    this._wfield = { frente: makeWrinkleField(11), espalda: makeWrinkleField(29) };
    this._mask = { frente: makeMask(1), espalda: makeMask(1) };
    this._dirtyBase = true;
    this._dirtyW = { frente: true, espalda: true };
    this._depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this._pickMaterials();
    this.pattern = null;
    this.setPattern(pattern);
  }

  // ---------- materiales ----------
  _pickMaterials() {
    const id = this.fabric.id;
    const h = this.heather;
    const inner = mixHex(this.color, '#000000', 0.3);
    this._mat = {
      outer: getFabricMaterial(id, this.color, { heather: h, vertexColors: true, side: THREE.FrontSide }),
      inner: getFabricMaterial(id, inner, { heather: h, side: THREE.BackSide }),
      foldOuter: getFabricMaterial(id, this.color, { heather: h }),
      foldInner: getFabricMaterial(id, inner, { heather: h }),
      rib: getRibMaterial(id, this.color, { heather: h }),
      thread: getThreadMaterial(this.threadColor, this.threadId || 'poliester'),
    };
    const f = this.fabric;
    this._sharpF = !f.knit ? 1.35 : f.weave === 'modal' || f.weave === 'mesh' ? 0.55 : 0.8;
  }
  _applyMaterials() {
    const m = this._mat;
    for (const side of SIDES) {
      const pm = this._panelMeshes?.[side];
      if (!pm) continue;
      pm.outer.material = m.outer;
      pm.inner.material = m.inner;
    }
    if (this._band) this._band.mesh.material = m.rib;
    for (const f of this._folds || []) f.fold.mesh.material = f.rib ? [m.rib, m.rib] : [m.foldOuter, m.foldInner];
    for (const g of Object.values(this._stitches || {})) g.setMaterial(m.thread);
    for (const t of this.looseThreads) t.material = m.thread;
  }

  // ---------- molde / geometría ----------
  setPattern(pattern) {
    if (!pattern || !pattern.silhouette) return;
    const t0 = performance.now();
    this.pattern = pattern;
    this._disposeGeometry();
    const prof = {};
    let tp = performance.now();
    const mark = (k) => {
      const now = performance.now();
      prof[k] = Math.round((now - tp) * 10) / 10;
      tp = now;
    };
    const { front, back } = buildSurfaces(pattern);
    mark('superficies');
    this._front = front;
    this._back = back;
    this._panels = { frente: front, espalda: back };
    this._tri = {};
    this._panelMeshes = {};
    for (const side of SIDES) {
      const P = this._panels[side];
      P.rawN = new Float32Array(P.n * 3);
      P.col = new Float32Array(P.n * 3).fill(1);
      // arrugas base de este lado
      const wf = this._wfield[side];
      for (let v = 0; v < P.n; v++) {
        const x = P.flat[v * 2];
        const y = P.flat[v * 2 + 1];
        P.wSoft[v] = sampleGrid(wf.soft, wf.nx, wf.ny, wf.cell, x, y);
        P.wSharp[v] = sampleGrid(wf.sharp, wf.nx, wf.ny, wf.cell, x, y);
      }
      P.relief = this._staticRelief(P);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(P.nrm, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(P.flat, 2));
      g.setAttribute('color', new THREE.BufferAttribute(P.col, 3).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(P.index, 1));
      const outer = new THREE.Mesh(g, this._mat.outer);
      outer.name = `panel-${side}`;
      outer.castShadow = true;
      outer.receiveShadow = true;
      outer.customDepthMaterial = this._depthMat;
      outer.frustumCulled = false;
      outer.userData = { kind: 'panel', side };
      outer.raycast = raycastIfVisible;
      const inner = new THREE.Mesh(g, this._mat.inner);
      inner.name = `panel-${side}-interior`;
      inner.receiveShadow = true;
      inner.frustumCulled = false;
      inner.userData = { kind: 'panel', side, inner: true };
      inner.raycast = raycastIfVisible;
      this.root.add(outer, inner);
      this._panelMeshes[side] = { outer, inner, geometry: g };
      this._tri[side] = new TriIndex(P.flat, P.index);
      // máscara de arrugas: se resetea con el molde
      const mask = this._mask[side];
      mask.m.fill(1);
      rasterInside(mask, (side === 'frente' ? pattern.silhouette.front : pattern.silhouette.back).outline);
    }
    mark('paneles');
    this._buildTrims();
    mark('terminaciones');
    this._buildStitches();
    mark('puntadas');
    this.clearScorches();
    this._dirtyBase = true;
    this._dirtyW = { frente: true, espalda: true };
    this._flush(true);
    mark('flush');
    for (const side of SIDES) if (this._prints[side]) this._rebuildPrint(side);
    // hilos sueltos: se re-anclan al molde nuevo
    for (const t of this.looseThreads.slice()) {
      const ud = t.userData;
      ud.att = this._tri[ud.side].query(ud.x, ud.y, 0.03);
      if (!ud.att) this.removeLooseThread(t);
    }
    this._placeThreads();
    this.setParts(this.parts);
    this.setSeams(this.seamProgress);
    mark('resto');
    this.buildMs = performance.now() - t0;
    this.buildProfile = prof;
  }

  // Relieve estático: doble tela del dobladillo (ruedo y puños) y canaleta de la costura de sisa.
  _staticRelief(P) {
    const out = new Float32Array(P.n);
    const pat = this.pattern;
    const c = pat.construction;
    const seg = Object.fromEntries((P.side === 'frente' ? pat.silhouette.front : pat.silhouette.back).segments.map((s) => [s.name, s.points]));
    const cuffs = c.hasSleeves ? [seg.punoIzq, seg.punoDer] : [];
    const arms = c.hasSleeves ? pat.silhouette.front.armholes : [];
    const boxes = new Map();
    const dist = (pts, x, y) => {
      let bb = boxes.get(pts);
      if (!bb) {
        bb = [Infinity, Infinity, -Infinity, -Infinity];
        for (const q of pts) {
          bb[0] = Math.min(bb[0], q.x);
          bb[1] = Math.min(bb[1], q.y);
          bb[2] = Math.max(bb[2], q.x);
          bb[3] = Math.max(bb[3], q.y);
        }
        boxes.set(pts, bb);
      }
      if (x < bb[0] - 0.03 || x > bb[2] + 0.03 || y < bb[1] - 0.03 || y > bb[3] + 0.03) return 1;
      let best = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x;
        const ay = pts[i - 1].y;
        const dx = pts[i].x - ax;
        const dy = pts[i].y - ay;
        const l2 = dx * dx + dy * dy;
        const t = clamp(l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0);
        best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
      }
      return best;
    };
    for (let v = 0; v < P.n; v++) {
      const x = P.flat[v * 2];
      const y = P.flat[v * 2 + 1];
      let r = 0;
      const dh = y + c.L + 0.003 * (1 - (x / c.hw) ** 2);
      if (dh < 0.03) r += 0.0007 * (1 - smoothstep(0.019, 0.024, dh));
      for (const cf of cuffs) {
        const d = dist(cf, x, y);
        if (d < 0.03) r += 0.0006 * (1 - smoothstep(0.019, 0.024, d));
      }
      for (const a of arms) {
        const d = dist(a, x, y);
        if (d < 0.012) {
          // canaleta en la costura + leve lomo del margen planchado hacia el cuerpo
          r -= 0.0006 * Math.exp(-((d / 0.0022) ** 2));
          if (P.region[v] === 0) r += 0.00035 * Math.exp(-(((d - 0.006) / 0.003) ** 2));
        }
      }
      out[v] = r * P.wGain[v] ** 0.3;
      // el dobladillo (doble tela) se arruga menos
      let de = dh;
      for (const cf of cuffs) de = Math.min(de, dist(cf, x, y));
      if (de < 0.04) P.wGain[v] *= 0.35 + 0.65 * smoothstep(0.012, 0.035, de);
    }
    return out;
  }

  _buildTrims() {
    const pat = this.pattern;
    const c = pat.construction;
    const m = this._mat;
    this._band = new NeckBand(m.rib, { isV: c.isV, width: c.isV ? 0.016 : 0.018 });
    this._folds = [];
    const add = (side, edge, opts, rib = false, sleeve = false) => {
      const fold = new EdgeFold(rib ? [m.rib, m.rib] : [m.foldOuter, m.foldInner], opts);
      this._folds.push({ side, edge, fold, rib, sleeve });
    };
    for (const side of SIDES) {
      add(side, 'ruedo', { radius: 0.0012, inside: 0.022 });
      if (c.hasSleeves) {
        add(side, 'punoIzq', { radius: 0.0011, inside: 0.02 }, false, true);
        add(side, 'punoDer', { radius: 0.0011, inside: 0.02 }, false, true);
      } else {
        add(side, 'sisaIzq', { radius: 0.0011, inside: 0.008, outside: 0.008, cover: 0.0011 }, true);
        add(side, 'sisaDer', { radius: 0.0011, inside: 0.008, outside: 0.008, cover: 0.0011 }, true);
      }
    }
    this._band.update(this._front, this._back, this.inflation); // crea la malla (se recalcula en _flush)
    this.root.add(this._band.mesh);
  }

  _buildStitches() {
    const pat = this.pattern;
    const c = pat.construction;
    const sl = pat.seamLines;
    const STEP = 0.0031;
    const LEN = 0.0024;
    const slotsAlong = (pts, side, lift, sleeveFn = null, order = 0) => {
      const out = [];
      const total = polylineLength(pts);
      const tri = this._tri[side];
      for (let s = STEP * 0.4; s + LEN <= total; s += STEP) {
        const a = pointAt(pts, s);
        const b = pointAt(pts, s + LEN);
        const att0 = tri.query(a.x, a.y, 0.004);
        const att1 = tri.query(b.x, b.y, 0.004);
        if (!att0 || !att1) continue;
        const panel = this._panels[side];
        const onSleeve = sleeveFn === true ? panel.region[att0.a] > 0 || panel.region[att1.a] > 0 : sleeveFn ? sleeveFn(a) : false;
        out.push({ side, att0, att1, lift, sleeve: onSleeve, t: order + s / total });
      }
      return out;
    };
    const merge = (...lists) => lists.flat().sort((p, q) => p.t - q.t);
    const center = { x: 0, y: -0.3 };
    const groups = {};
    const mk = (name, slots, opts) => {
      if (slots.length) groups[name] = new StitchGroup(name, slots, this._mat.thread, opts);
    };
    // hombros: sobre la unión (lado del frente)
    mk('hombros', [...slotsAlong(sl.hombros[0], 'frente', 0.0003, null, 0), ...slotsAlong(sl.hombros[1], 'frente', 0.0003, null, 1)]);
    // costados: del puño al ruedo, sobre la unión
    // (true = marcar como "de manga" según la región de la malla, para ocultarlas sin mangas)
    mk('costados', [...slotsAlong(sl.costados[0], 'frente', 0.0003, true, 0), ...slotsAlong(sl.costados[1], 'frente', 0.0003, true, 1)]);
    // sisa con manga: un pespunte a 3 mm, hacia el cuerpo, en frente y espalda
    if (sl.mangas.length) {
      const lists = [];
      sl.mangas.forEach((line, i) => {
        const off = offsetLine(line, 0.003, center);
        lists.push(slotsAlong(off, 'frente', 0.0003, null, i * 2));
        lists.push(slotsAlong(revPts(off), 'espalda', 0.0003, null, i * 2 + 1));
      });
      mk('mangas', merge(...lists), {});
    }
    // sisa sin manga: doble pespunte sobre el ribete
    if (sl.sisas.length) {
      const lists = [];
      sl.sisas.forEach((line, i) => {
        for (const d of [0.0045]) {
          const off = offsetLine(line, d, center);
          lists.push(slotsAlong(off, 'frente', 0.0014, null, i * 2));
          lists.push(slotsAlong(revPts(off), 'espalda', 0.0014, null, i * 2 + 1));
        }
      });
      mk('sisas', merge(...lists));
    }
    // cuello: pespunte a 5 mm del escote, en frente y espalda (recorrido en lazo)
    {
      const fr = offsetLine(sl.cuello[0], 0.0052, center);
      const bk = offsetLine(revPts(sl.cuello[1]), 0.0052, center);
      mk('cuello', [...slotsAlong(fr, 'frente', 0.0003, null, 0), ...slotsAlong(bk, 'espalda', 0.0003, null, 1)]);
    }
    // puños: doble pespunte (2.0 y 2.6 cm del borde)
    if (sl.punos.length) {
      const lists = [];
      sl.punos.forEach((line, i) => {
        const ref = { x: c.SP.x * Math.sign(line[0].x) * 0.5, y: c.SP.y }; // hacia la sisa
        for (const d of [0, 0.006]) {
          const off = d ? offsetLine(line, d, ref) : line;
          lists.push(slotsAlong(off, 'frente', 0.0004, () => true, i * 2));
          lists.push(slotsAlong(revPts(off), 'espalda', 0.0004, () => true, i * 2 + 1));
        }
      });
      mk('punos', merge(...lists));
    }
    // ruedo: doble pespunte (recubridora) a 2.0 y 2.6 cm
    {
      const line = sl.ruedo[0];
      const lists = [];
      for (const d of [0, 0.006]) {
        const off = line.map((p) => ({ x: p.x, y: p.y + d }));
        lists.push(slotsAlong(off, 'frente', 0.0004, null, 0));
        lists.push(slotsAlong(revPts(off), 'espalda', 0.0004, null, 1));
      }
      mk('ruedo', merge(...lists));
    }
    this._stitches = groups;
    for (const g of Object.values(groups)) for (const m of Object.values(g.meshes)) this.root.add(m);
  }

  _disposeGeometry() {
    for (const side of SIDES) {
      const pm = this._panelMeshes?.[side];
      if (pm) {
        pm.geometry.dispose();
        this.root.remove(pm.outer, pm.inner);
      }
    }
    if (this._band) {
      this.root.remove(this._band.mesh);
      this._band.dispose();
      this._band = null;
    }
    for (const f of this._folds || []) {
      if (f.fold.mesh) this.root.remove(f.fold.mesh);
      f.fold.dispose();
    }
    this._folds = [];
    for (const g of Object.values(this._stitches || {})) {
      for (const m of Object.values(g.meshes)) this.root.remove(m);
      g.dispose();
    }
    this._stitches = {};
    for (const side of SIDES) this._removePrintMesh(side);
  }

  // ---------- recálculo perezoso ----------
  _flush(force = false) {
    const F = this._front;
    const B = this._back;
    if (!F) return;
    let changed = force;
    if (this._dirtyBase) {
      F.computeBase(this.inflation);
      B.computeBase(this.inflation);
      computeNormals(F.base, F.index, F.baseN);
      computeNormals(B.base, B.index, B.baseN);
      blendSeamNormals(F, B, F.baseN, B.baseN);
      this._dirtyBase = false;
      this._dirtyW.frente = this._dirtyW.espalda = true;
    }
    const touched = { frente: false, espalda: false };
    for (const side of SIDES) {
      if (!this._dirtyW[side]) continue;
      this._applyWrinkles(this._panels[side], this._mask[side]);
      this._dirtyW[side] = false;
      touched[side] = true;
      changed = true;
    }
    if (!changed) return;
    F.nrm.set(F.rawN);
    B.nrm.set(B.rawN);
    blendSeamNormals(F, B, F.nrm, B.nrm);
    for (const side of SIDES) {
      const g = this._panelMeshes[side].geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.computeBoundingSphere();
      g.computeBoundingBox();
    }
    this._updateAttached(touched, force);
  }

  _applyWrinkles(P, mask) {
    const amt = this.wrinkleAmount;
    const sf = this._sharpF;
    const n = P.n;
    const pos = P.pos;
    const base = P.base;
    const bn = P.baseN;
    for (let v = 0; v < n; v++) {
      let w = 0;
      if (amt > 0) {
        const m = sampleGrid(mask.m, mask.nx, mask.ny, mask.cell, P.flat[v * 2], P.flat[v * 2 + 1]);
        w = amt * m * (P.wSoft[v] + sf * P.wSharp[v]) * P.wGain[v];
      }
      P.wDisp[v] = w;
      const d = w + P.relief[v];
      const o = v * 3;
      pos[o] = base[o] + bn[o] * d;
      pos[o + 1] = base[o + 1] + bn[o + 1] * d;
      pos[o + 2] = base[o + 2] + bn[o + 2] * d;
    }
    computeNormals(pos, P.index, P.rawN);
    // oclusión de las arrugas: valles (laplaciano positivo) más oscuros, crestas apenas más claras
    const lap = P.lap || (P.lap = new Float32Array(n));
    const cnt = P.lapN || (P.lapN = new Float32Array(n));
    if (amt > 0) {
      lap.fill(0);
      cnt.fill(0);
      const I = P.index;
      const W = P.wDisp;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t];
        const b = I[t + 1];
        const c = I[t + 2];
        lap[a] += W[b] + W[c];
        lap[b] += W[a] + W[c];
        lap[c] += W[a] + W[b];
        cnt[a] += 2;
        cnt[b] += 2;
        cnt[c] += 2;
      }
    }
    for (let v = 0; v < n; v++) {
      let shade = P.ao[v];
      if (amt > 0 && cnt[v] > 0) {
        const L = lap[v] / cnt[v] - P.wDisp[v]; // > 0 en valles
        shade *= 1 - clamp(L / 0.0009, -0.6, 1) * 0.16;
      }
      const o = v * 3;
      P.col[o] = P.col[o + 1] = P.col[o + 2] = shade;
    }
  }

  _updateAttached(touched, all) {
    const F = this._front;
    const B = this._back;
    if (this._band && (this.parts.cuello || all)) this._band.update(F, B, this.inflation);
    for (const f of this._folds) {
      const P = this._panels[f.side];
      if (!P.edges[f.edge]) continue;
      if (!touched[f.side] && !all) continue;
      const isNew = !f.fold.mesh;
      f.fold.update(P, P.edges[f.edge], P.edges[f.edge + 'In'], P.edges[f.edge + 'Rows']);
      if (isNew) {
        f.fold.mesh.name = `dobladillo-${f.side}-${f.edge}`;
        this.root.add(f.fold.mesh);
      }
    }
    for (const g of Object.values(this._stitches)) g.update(this._panels);
    for (const side of SIDES) {
      const pm = this._printMeshes[side];
      if (pm && (touched[side] || all)) pm.patch.update(this._panels[side], false);
    }
    for (const s of this._scorches) if (touched[s.side] || all) s.patch.update(this._panels[s.side], false);
    this._placeThreads();
  }

  // ---------- API pública ----------
  setFabric(fabric, color, heather) {
    if (fabric) this.fabric = fabric;
    if (color) this.color = color;
    if (heather !== undefined) this.heather = !!heather;
    this._pickMaterials();
    this._applyMaterials();
    this._dirtyW.frente = this._dirtyW.espalda = true; // la dureza de las arrugas depende de la tela
    for (const side of SIDES) if (this._prints[side]) this._rebuildPrint(side);
  }

  setThreadColor(hex, threadId = this.threadId) {
    if (!hex) return;
    this.threadColor = hex;
    this.threadId = threadId || 'poliester';
    this._mat.thread = getThreadMaterial(hex, this.threadId);
    this._applyMaterials();
  }

  setInflation(k) {
    k = clamp(+k || 0, 0, 1.2);
    if (Math.abs(k - this.inflation) < 1e-4) return;
    this.inflation = k;
    this._dirtyBase = true;
  }

  setParts(p = {}) {
    this.parts = { ...this.parts, ...p };
    const P = this.parts;
    const hasSleeves = this.pattern?.construction.hasSleeves;
    for (const side of SIDES) {
      const pm = this._panelMeshes?.[side];
      if (!pm) continue;
      const vis = !!P[side];
      pm.outer.visible = pm.inner.visible = vis;
      const panel = this._panels[side];
      const tris = hasSleeves && !P.mangas ? panel.bodyTriCount : panel.index.length / 3;
      pm.geometry.setDrawRange(0, tris * 3);
      const pr = this._printMeshes[side];
      if (pr) pr.mesh.visible = vis;
    }
    if (this._band) this._band.mesh.visible = !!P.cuello && (P.frente || P.espalda);
    for (const f of this._folds || []) if (f.fold.mesh) f.fold.mesh.visible = !!P.ruedos && !!P[f.side] && (!f.sleeve || !!P.mangas);
    for (const [name, g] of Object.entries(this._stitches || {})) {
      const sleeveOnly = name === 'mangas' || name === 'punos';
      const hide = sleeveOnly && !P.mangas;
      if (g.hideSleeves !== !P.mangas) {
        g.hideSleeves = !P.mangas;
        if (this._front) g.update(this._panels);
      }
      for (const [side, m] of Object.entries(g.meshes)) m.visible = !hide && !!P[side] && m.count > 0;
    }
    for (const s of this._scorches) s.mesh.visible = !!P[s.side];
    for (const t of this.looseThreads) t.visible = !!P[t.userData.side];
  }

  setSeams(s = {}) {
    for (const [k, v] of Object.entries(s)) {
      if (!(k in this.seamProgress)) continue;
      this.seamProgress[k] = typeof v === 'boolean' ? (v ? 1 : 0) : clamp(+v || 0);
    }
    for (const [k, g] of Object.entries(this._stitches || {})) g.setProgress(this.seamProgress[k] ?? 1);
    // respetar visibilidad de partes
    if (this._stitches) {
      const P = this.parts;
      for (const [name, g] of Object.entries(this._stitches)) {
        const hide = (name === 'mangas' || name === 'punos') && !P.mangas;
        for (const [side, m] of Object.entries(g.meshes)) m.visible = !hide && !!P[side] && m.count > 0;
      }
    }
  }

  // --- arrugas ---
  setWrinkles(amount) {
    const a = clamp(+amount || 0, 0, 1.5);
    if (a === this.wrinkleAmount) return;
    this.wrinkleAmount = a;
    this._dirtyW.frente = this._dirtyW.espalda = true;
  }
  resetWrinkleMask(value = 1) {
    for (const side of SIDES) this._mask[side].m.fill(clamp(value));
    this._dirtyW.frente = this._dirtyW.espalda = true;
  }
  // Alisa alrededor de (x, y) [coords de prenda]. Devuelve cuánto bajó el nivel de arrugas de ese lado (0..1).
  smoothWrinkles(side, x, y, radius = 0.06, strength = 0.5) {
    const mask = this._mask[side];
    if (!mask) return 0;
    const { nx, ny, cell, m, inside } = mask;
    const r = Math.max(cell, radius);
    const i0 = Math.max(0, Math.floor((x - r - WBOX.x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((x + r - WBOX.x0) / cell));
    const j0 = Math.max(0, Math.floor((y - r - WBOX.y0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((y + r - WBOX.y0) / cell));
    let removed = 0;
    const st = clamp(strength, 0, 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = WBOX.x0 + i * cell;
        const cy = WBOX.y0 + j * cell;
        const d = Math.hypot(cx - x, cy - y);
        if (d >= r) continue;
        const f = (1 - (d / r) ** 2) ** 2;
        const k = j * nx + i;
        const old = m[k];
        const nv = Math.max(0, old - st * f);
        m[k] = nv;
        if (inside[k]) removed += old - nv;
      }
    }
    if (removed > 0) this._dirtyW[side] = true;
    return removed / mask.insideCount;
  }
  wrinkleLevel(side) {
    const lvl = (s) => {
      const { m, inside, insideCount } = this._mask[s];
      let sum = 0;
      for (let k = 0; k < m.length; k++) if (inside[k]) sum += m[k];
      return sum / insideCount;
    };
    if (side === 'frente' || side === 'espalda') return lvl(side);
    const a = this._mask.frente.insideCount;
    const b = this._mask.espalda.insideCount;
    return (lvl('frente') * a + lvl('espalda') * b) / (a + b);
  }

  // --- quemaduras ---
  addScorch(side, x, y, radius = 0.05, intensity = 1, kind = 'scorch') {
    if (!this._tri?.[side]) return null;
    this._flush();
    const seed = (this._scorches.length + 1) * 7 + Math.floor(Math.abs(x * 1000 + y * 777));
    const { patch, material, texture } = buildScorch(side, x, y, radius, intensity, kind, this._tri[side], seed);
    if (!patch.triCount) {
      patch.dispose();
      material.dispose();
      texture.dispose();
      return null;
    }
    const mesh = new THREE.Mesh(patch.geometry, material);
    mesh.name = `quemadura-${side}`;
    mesh.userData = { kind: 'scorch', side };
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = !!this.parts[side];
    patch.update(this._panels[side], false);
    this.root.add(mesh);
    this._scorches.push({ side, mesh, patch, material, texture });
    return mesh;
  }
  clearScorches() {
    for (const s of this._scorches) {
      this.root.remove(s.mesh);
      s.patch.dispose();
      s.material.dispose();
      s.texture.dispose();
    }
    this._scorches = [];
  }

  // --- estampado ---
  setPrint(side, print, placement) {
    if (side !== 'frente' && side !== 'espalda') return;
    this._prints[side] = print ? { print, placement: { x: 0, y: -0.25, width: 0.25, rotation: 0, ...(placement || {}) } } : null;
    this._rebuildPrint(side);
  }
  hasPrint(side) {
    return !!this._prints?.[side];
  }
  setPrintWear({ fade = 0, crack = 0 } = {}) {
    this._wear = { fade: clamp(fade), crack: clamp(crack) };
    for (const side of SIDES) if (this._prints[side]) this._rebuildPrint(side);
  }
  _removePrintMesh(side) {
    const pm = this._printMeshes[side];
    if (!pm) return;
    this.root.remove(pm.mesh);
    pm.patch.dispose();
    const mat = pm.mesh.material;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
      const t = mat[k];
      if (t && !(k === 'metalnessMap' && t === mat.roughnessMap)) t.dispose();
    }
    mat.dispose();
    this._printMeshes[side] = null;
  }
  _rebuildPrint(side) {
    this._removePrintMesh(side);
    const entry = this._prints[side];
    if (!entry || !this._tri?.[side]) return;
    this._flush();
    const w = this._wear;
    const res = w.fade > 0 || w.crack > 0 ? applyWearLocal(entry.print, w, this.color) : entry.print;
    const patch = buildPrintPatch(side, res, entry.placement, this._tri[side]);
    const material = makePrintMaterial(res, this.fabric);
    const mesh = new THREE.Mesh(patch.geometry, material);
    mesh.name = `estampa-${side}`;
    mesh.userData = { kind: 'print', side };
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = !!this.parts[side];
    patch.update(this._panels[side], false);
    this.root.add(mesh);
    this._printMeshes[side] = { mesh, patch };
  }

  // --- hilos sueltos ---
  addLooseThreads(n = 6, seed = 1) {
    const pat = this.pattern;
    if (!pat) return [];
    this._flush();
    const c = pat.construction;
    const r = rng(seed * 101 + 7);
    const sl = pat.seamLines;
    const cands = [];
    const push = (side, x, y, w = 1) => cands.push({ side, x, y, w });
    const hemY = -c.L + 0.02;
    const xs = (sl.ruedo[0][sl.ruedo[0].length - 1].x || c.hw) - 0.006;
    for (const side of SIDES) {
      push(side, -xs, hemY, 2);
      push(side, xs, hemY, 2);
      push(side, -xs, hemY + 0.006, 1);
      push(side, xs, hemY + 0.006, 1);
    }
    for (const sx of [-1, 1]) {
      push('frente', sx * (c.hw - 0.003), -c.L + 0.04, 1.5);
      push('frente', sx * (c.UA.x - 0.006), c.UA.y + 0.004, 1);
      push('frente', sx * (c.HPS.x + 0.004), -0.006, 1);
      push('espalda', sx * (c.HPS.x + 0.004), -0.006, 0.6);
    }
    for (const line of sl.punos) {
      const end = line[line.length - 1];
      const dir = { x: line[line.length - 2].x - end.x, y: line[line.length - 2].y - end.y };
      const l = Math.hypot(dir.x, dir.y) || 1;
      push('frente', end.x + (dir.x / l) * 0.006, end.y + (dir.y / l) * 0.006, 1.5);
      push('espalda', end.x + (dir.x / l) * 0.006, end.y + (dir.y / l) * 0.006, 1);
    }
    for (const line of sl.sisas) {
      const end = line[line.length - 1];
      push('frente', end.x * 0.97, end.y + 0.01, 1.5);
    }
    const total = cands.reduce((s, q) => s + q.w, 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      let pick = r() * total;
      let cand = cands[0];
      for (const q of cands) {
        pick -= q.w;
        if (pick <= 0) {
          cand = q;
          break;
        }
      }
      const x = cand.x + (r() - 0.5) * 0.006;
      const y = cand.y + (r() - 0.5) * 0.004;
      const att = this._tri[cand.side].query(x, y, 0.02);
      if (!att) continue;
      const mesh = makeLooseThread(this._mat.thread, Math.floor(seed * 1000 + i * 17 + r() * 1e6));
      mesh.userData.side = cand.side;
      mesh.userData.x = x;
      mesh.userData.y = y;
      mesh.userData.att = att;
      mesh.userData.spin = (r() - 0.5) * 1.6;
      mesh.visible = !!this.parts[cand.side];
      this.root.add(mesh);
      this.looseThreads.push(mesh);
      out.push(mesh);
    }
    this._placeThreads();
    return out;
  }
  removeLooseThread(mesh) {
    const i = this.looseThreads.indexOf(mesh);
    if (i >= 0) this.looseThreads.splice(i, 1);
    disposeLooseThread(mesh);
  }
  clearLooseThreads() {
    for (const t of this.looseThreads.slice()) this.removeLooseThread(t);
    this.looseThreads = [];
  }
  _placeThreads() {
    if (!this.looseThreads.length || !this._front) return;
    const up = new THREE.Vector3();
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    const Z = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const t of this.looseThreads) {
      const ud = t.userData;
      if (!ud.att) continue;
      attachEval(this._panels[ud.side], ud.att, _p, _n);
      Y.set(_n[0], _n[1], _n[2]);
      // "abajo" sobre el plano tangente, con un giro propio de cada hilo
      up.set(Math.sin(ud.spin) * 0.6, -1, 0);
      Z.copy(up).addScaledVector(Y, -up.dot(Y));
      if (Z.lengthSq() < 1e-6) Z.set(0, 0, -1);
      Z.normalize().negate();
      X.crossVectors(Y, Z).normalize();
      Z.crossVectors(X, Y).normalize();
      m.makeBasis(X, Y, Z);
      t.quaternion.setFromRotationMatrix(m);
      t.position.set(_p[0], _p[1], _p[2]);
    }
  }

  // --- lavado ---
  setShrink(sx = 1, sy = 1) {
    this.root.scale.set(sx, sy, (sx + sy) / 2);
  }

  // --- consultas ---
  getPanelMeshes() {
    return { frente: this._panelMeshes?.frente?.outer || null, espalda: this._panelMeshes?.espalda?.outer || null };
  }
  hitToGarment(intersection) {
    if (!intersection || !intersection.object) return null;
    const ud = intersection.object.userData || {};
    let uv = null;
    if (ud.kind === 'panel') uv = intersection.uv;
    else if (ud.kind === 'print' || ud.kind === 'scorch') uv = intersection.uv1;
    if (!uv || !ud.side) return null;
    return { side: ud.side, x: uv.x, y: uv.y, viewX: ud.side === 'espalda' ? -uv.x : uv.x };
  }
  garmentToLocal(side, x, y, offset = 0) {
    this._flush();
    const panel = this._panels?.[side];
    const position = new THREE.Vector3(x, y, 0);
    const normal = new THREE.Vector3(0, 0, side === 'espalda' ? -1 : 1);
    if (!panel) return { position, normal };
    const att = this._tri[side].query(x, y, 0.25);
    if (att) {
      attachEval(panel, att, _p, _n);
      position.set(_p[0], _p[1], _p[2]);
      normal.set(_n[0], _n[1], _n[2]);
    }
    position.addScaledVector(normal, offset);
    const s = this.root.scale;
    position.multiply(s);
    normal.set(normal.x / s.x, normal.y / s.y, normal.z / s.z).normalize();
    return { position, normal };
  }
  update() {
    this._flush();
  }
  dispose() {
    this.clearLooseThreads();
    this.clearScorches();
    this._disposeGeometry();
    this._depthMat.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

// Pieza plana de tela (molde cortado) acostada en XZ: cara superior +Y, la +y de la pieza hacia −Z.
export function createPieceMesh(piece, material, { thickness = 0.0015, showSeamLine = false } = {}) {
  const th = Math.max(0.0002, thickness);
  const pts = piece.outline;
  const contour = pts.map((p) => new THREE.Vector2(p.x, p.y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const n = pts.length;
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  // tapa superior e inferior
  for (const [y, ny] of [
    [th, 1],
    [0, -1],
  ]) {
    const base = pos.length / 3;
    for (const p of pts) {
      pos.push(p.x, y, -p.y);
      nrm.push(0, ny, 0);
      uv.push(p.x, p.y);
    }
    for (const f of faces) {
      const [a, b, c] = f;
      const area = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[c].x - pts[a].x) * (pts[b].y - pts[a].y);
      const ccw = area > 0;
      if ((ny > 0) === ccw) idx.push(base + a, base + b, base + c);
      else idx.push(base + a, base + c, base + b);
    }
  }
  // canto
  let per = 0;
  const ccwOutline = (() => {
    let a = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
    return a > 0;
  })();
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-7) continue;
    // normal exterior en 2D → 3D (x, 0, −y)
    let ex = (b.y - a.y) / l;
    let ey = -(b.x - a.x) / l;
    if (!ccwOutline) {
      ex = -ex;
      ey = -ey;
    }
    const base = pos.length / 3;
    pos.push(a.x, th, -a.y, b.x, th, -b.y, b.x, 0, -b.y, a.x, 0, -a.y);
    for (let k = 0; k < 4; k++) nrm.push(ex, 0, -ey);
    uv.push(per, th, per + l, th, per + l, 0, per, 0);
    per += l;
    // orientar el cuadrilátero para que mire hacia afuera
    const ux = b.x - a.x;
    const uz = -(b.y - a.y);
    const vx = b.x - a.x;
    const vy = -th;
    const vz = -(b.y - a.y);
    const cnx = 0 * vz - uz * vy;
    const cnz = ux * vy - 0 * vx;
    if (cnx * ex + cnz * -ey > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `pieza-${piece.id}`;
  mesh.userData.piece = piece;
  if (showSeamLine) {
    const lineMat = new THREE.MeshBasicMaterial({ color: '#2f2723', transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // línea de costura punteada (tiritas finas apenas sobre la tapa)
    const sp = [];
    const seam = piece.seamLine;
    const total = polylineLength([...seam, seam[0]]);
    const closed = [...seam, seam[0]];
    const dash = 0.006;
    const gap = 0.004;
    const w = 0.0007;
    const yy = th + 0.0002;
    for (let s = 0; s + dash <= total; s += dash + gap) {
      const a = pointAt(closed, s);
      const b = pointAt(closed, s + dash);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const ox = (-dy / l) * w;
      const oy = (dx / l) * w;
      sp.push(a.x + ox, yy, -(a.y + oy), b.x + ox, yy, -(b.y + oy), b.x - ox, yy, -(b.y - oy));
      sp.push(a.x + ox, yy, -(a.y + oy), b.x - ox, yy, -(b.y - oy), a.x - ox, yy, -(a.y - oy));
    }
    // piquetes: triangulitos hacia adentro desde el borde
    const cx = 0;
    const cy = 0;
    for (const p of piece.notches || []) {
      const dx = cx - p.x;
      const dy = cy - p.y;
      const l = Math.hypot(dx, dy) || 1;
      const ux = dx / l;
      const uy = dy / l;
      const s = 0.005;
      sp.push(p.x - uy * s * 0.5, yy, -(p.y + ux * s * 0.5), p.x + ux * s, yy, -(p.y + uy * s), p.x + uy * s * 0.5, yy, -(p.y - ux * s * 0.5));
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const lm = new THREE.Mesh(lg, lineMat);
    lm.material.side = THREE.DoubleSide;
    lm.name = 'linea-costura';
    lm.renderOrder = 1;
    mesh.add(lm);
  }
  return mesh;
}
