// Terminaciones 3D de la remera: tira de ribb del cuello, dobladillos (ruedo y puños),
// ribetes de sisa, puntadas (InstancedMesh) e hilos sueltos clickeables.

import * as THREE from 'three';
import { computeNormals } from './surface.js';
import { rng, clamp } from '../core/utils.js';

// Interpola posición y normal de un panel en una "fijación" baricéntrica.
export function attachEval(panel, att, outP, outN) {
  const P = panel.pos;
  const N = panel.nrm;
  const a = att.a * 3;
  const b = att.b * 3;
  const c = att.c * 3;
  const { w0, w1, w2 } = att;
  outP[0] = P[a] * w0 + P[b] * w1 + P[c] * w2;
  outP[1] = P[a + 1] * w0 + P[b + 1] * w1 + P[c + 1] * w2;
  outP[2] = P[a + 2] * w0 + P[b + 2] * w1 + P[c + 2] * w2;
  if (outN) {
    let x = N[a] * w0 + N[b] * w1 + N[c] * w2;
    let y = N[a + 1] * w0 + N[b + 1] * w1 + N[c + 1] * w2;
    let z = N[a + 2] * w0 + N[b + 2] * w1 + N[c + 2] * w2;
    const l = Math.hypot(x, y, z) || 1;
    outN[0] = x / l;
    outN[1] = y / l;
    outN[2] = z / l;
  }
}

// Geometría de "barrido": anillos de `ringN` puntos a lo largo de `count` muestras.
function sweepGeometry(count, ringN, closedLoop, groups = null) {
  const g = new THREE.BufferGeometry();
  const n = count * ringN;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const segs = closedLoop ? count : count - 1;
  const idx = [];
  const byGroup = groups ? groups.map(() => []) : null;
  for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % count;
    for (let r = 0; r < ringN - 1; r++) {
      const a = s * ringN + r;
      const b = s2 * ringN + r;
      const c = s2 * ringN + r + 1;
      const d = s * ringN + r + 1;
      const tri = [a, b, c, a, c, d];
      if (byGroup) byGroup[groups.findIndex((gr) => r >= gr[0] && r < gr[1])].push(...tri);
      else idx.push(...tri);
    }
  }
  if (byGroup) {
    let start = 0;
    byGroup.forEach((arr, gi) => {
      idx.push(...arr);
      g.addGroup(start, arr.length, gi);
      start += arr.length;
    });
  }
  g.setIndex(idx);
  return g;
}

// ---------- Tira de cuello (ribb acanalado) ----------
export class NeckBand {
  constructor(material, { width = 0.018, thick = 0.0026, ribPeriod = 0.0026, ribAmp = 0.00028, isV = false } = {}) {
    this.width = width;
    this.thick = thick;
    this.ribPeriod = ribPeriod;
    this.ribAmp = ribAmp;
    this.isV = isV;
    this.ring = this._ringProfile();
    this.mesh = null;
    this.material = material;
  }
  _ringProfile() {
    // perfil (a: a lo largo del ancho, b: espesor, rib: 1 si lleva acanalado)
    const pts = [];
    const tuck = -0.0035;
    const r = 0.5;
    for (const a of [tuck, 0.0, 0.3, 0.6, 0.86]) pts.push({ a, b: r, rib: 1, top: false });
    for (let i = 1; i < 6; i++) {
      const t = (i / 6) * Math.PI;
      pts.push({ a: 1, b: Math.cos(t) * r, round: Math.sin(t), rib: 0.6, top: true });
    }
    for (const a of [0.86, 0.6, 0.3, 0.0, tuck]) pts.push({ a, b: -r, rib: 1, top: false });
    return pts;
  }
  // front/back: PanelSurface. Arma el lazo del escote (frente HPS izq→der, espalda der→izq).
  update(front, back, inflation = 1) {
    const loop = [];
    const stand = 0.7 * clamp(inflation, 0, 1); // con volumen, la tira se para alrededor del cuello
    const collect = (panel, reverse) => {
      const E = panel.edges.cuello;
      const Ein = panel.edges.cuelloIn;
      const K = E.length - 1;
      const F = panel.flat;
      const P = panel.pos;
      const N = panel.nrm;
      const items = [];
      for (let k = 0; k <= K; k++) {
        const v = E[k];
        const kp = Math.max(0, k - 1);
        const kn = Math.min(K, k + 1);
        const qx = F[v * 2];
        const qy = F[v * 2 + 1];
        const vin = Ein[k];
        const bx = qx - F[vin * 2];
        const by = qy - F[vin * 2 + 1];
        // normales 2D de los tramos, hacia afuera del panel
        const segN = (i0, i1) => {
          const dx = F[E[i1] * 2] - F[E[i0] * 2];
          const dy = F[E[i1] * 2 + 1] - F[E[i0] * 2 + 1];
          const l = Math.hypot(dx, dy) || 1;
          let nx = -dy / l;
          let ny = dx / l;
          if (nx * bx + ny * by < 0) {
            nx = -nx;
            ny = -ny;
          }
          return [nx, ny];
        };
        const n1 = k > 0 ? segN(kp, k) : segN(k, kn);
        const n2 = k < K ? segN(k, kn) : n1;
        let ox = n1[0] + n2[0];
        let oy = n1[1] + n2[1];
        const ol = Math.hypot(ox, oy) || 1;
        ox /= ol;
        oy /= ol;
        const miter = 1 / Math.max(0.4, ox * n1[0] + oy * n1[1]);
        // jacobiano local 2D → 3D con los vecinos de la malla
        const ax = F[E[kn] * 2] - F[E[kp] * 2];
        const ay = F[E[kn] * 2 + 1] - F[E[kp] * 2 + 1];
        const det = ax * by - ay * bx;
        let wx = 0;
        let wy = 0;
        let wz = 0;
        if (Math.abs(det) > 1e-12) {
          const al = (ox * by - oy * bx) / det;
          const be = (ax * oy - ay * ox) / det;
          const A = [P[E[kn] * 3] - P[E[kp] * 3], P[E[kn] * 3 + 1] - P[E[kp] * 3 + 1], P[E[kn] * 3 + 2] - P[E[kp] * 3 + 2]];
          const B = [P[v * 3] - P[vin * 3], P[v * 3 + 1] - P[vin * 3 + 1], P[v * 3 + 2] - P[vin * 3 + 2]];
          wx = al * A[0] + be * B[0];
          wy = al * A[1] + be * B[1];
          wz = al * A[2] + be * B[2];
        }
        let wl = Math.hypot(wx, wy, wz) || 1;
        wx /= wl;
        wy /= wl;
        wz /= wl;
        wy += stand;
        wl = Math.hypot(wx, wy, wz) || 1;
        items.push({
          p: [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]],
          n: [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]],
          w: [wx / wl, wy / wl, wz / wl],
          m: miter,
          tip: this.isV && panel.side === 'frente' && k === K / 2,
        });
      }
      return reverse ? items.reverse() : items;
    };
    const fr = collect(front, false);
    const bk = collect(back, true);
    // en los HPS el frente y la espalda coinciden: promediar direcciones
    const avg = (A, B) => {
      const r = [];
      for (let i = 0; i < 3; i++) r.push(A[i] + B[i]);
      const l = Math.hypot(...r) || 1;
      return r.map((x) => x / l);
    };
    fr[fr.length - 1].w = avg(fr[fr.length - 1].w, bk[0].w);
    fr[fr.length - 1].n = avg(fr[fr.length - 1].n, bk[0].n);
    fr[0].w = avg(fr[0].w, bk[bk.length - 1].w);
    fr[0].n = avg(fr[0].n, bk[bk.length - 1].n);
    loop.push(...fr, ...bk.slice(1, -1));
    // suavizado de direcciones a lo largo del lazo (evita quiebres en los hombros); la punta de la V se respeta
    const M = loop.length;
    const tipIdx = loop.findIndex((o) => o.tip);
    for (let it = 0; it < 10; it++) {
      const ws = loop.map((o) => o.w.slice());
      for (let i = 0; i < M; i++) {
        if (tipIdx >= 0 && Math.min(Math.abs(i - tipIdx), M - Math.abs(i - tipIdx)) <= 2) continue;
        const a = ws[(i - 1 + M) % M];
        const b = ws[(i + 1) % M];
        const c = ws[i];
        const r = [c[0] * 2 + a[0] + b[0], c[1] * 2 + a[1] + b[1], c[2] * 2 + a[2] + b[2]];
        const l = Math.hypot(...r) || 1;
        loop[i].w = r.map((x) => x / l);
      }
    }
    this._build(loop);
  }
  _build(loop) {
    const M = loop.length;
    // borde interno de la tira (punto de costura + ancho con inglete): se interpola directamente
    for (const o of loop) o.i = [o.p[0] + o.w[0] * this.width * o.m, o.p[1] + o.w[1] * this.width * o.m, o.p[2] + o.w[2] * this.width * o.m];
    // longitud de arco del lazo
    const cum = new Float64Array(M + 1);
    for (let i = 1; i <= M; i++) {
      const a = loop[i - 1].p;
      const b = loop[i % M].p;
      cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const total = cum[M];
    const count = Math.max(64, Math.min(1400, Math.round((total / this.ribPeriod) * 4)));
    const ringN = this.ring.length;
    if (!this.mesh || this._count !== count) {
      const g = sweepGeometry(count, ringN, true);
      if (this.mesh) {
        this.mesh.geometry.dispose();
        this.mesh.geometry = g;
      } else {
        this.mesh = new THREE.Mesh(g, this.material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.name = 'cuello-ribb';
      }
      this._count = count;
    }
    const pos = this.mesh.geometry.attributes.position.array;
    const uv = this.mesh.geometry.attributes.uv.array;
    let seg = 0;
    const tmp = { p: [0, 0, 0], n: [0, 0, 0], w: [0, 0, 0] };
    const crPoint = (i0, t, key, out) => {
      // Catmull-Rom uniforme; en la punta de la V no se redondea
      const i1 = (i0 + 1) % M;
      const im = (i0 - 1 + M) % M;
      const i2 = (i0 + 2) % M;
      const p0 = loop[im][key];
      const p1 = loop[i0][key];
      const p2 = loop[i1][key];
      const p3 = loop[i2][key];
      const sharp1 = loop[i0].tip;
      const sharp2 = loop[i1].tip;
      for (let c = 0; c < 3; c++) {
        const m1 = sharp1 ? p2[c] - p1[c] : (p2[c] - p0[c]) / 2;
        const m2 = sharp2 ? p2[c] - p1[c] : (p3[c] - p1[c]) / 2;
        const t2 = t * t;
        const t3 = t2 * t;
        out[c] = (2 * t3 - 3 * t2 + 1) * p1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[c] + (t3 - t2) * m2;
      }
    };
    const W = this.width;
    const R = this.thick / 2;
    for (let s = 0; s < count; s++) {
      const arc = (s / count) * total;
      while (seg < M - 1 && cum[seg + 1] < arc) seg++;
      const t = clamp((arc - cum[seg]) / (cum[seg + 1] - cum[seg] || 1));
      crPoint(seg, t, 'p', tmp.p);
      crPoint(seg, t, 'i', tmp.w);
      const a0 = loop[seg];
      const a1 = loop[(seg + 1) % M];
      for (let c = 0; c < 3; c++) {
        tmp.n[c] = a0.n[c] * (1 - t) + a1.n[c] * t;
        tmp.w[c] -= tmp.p[c];
      }
      const wl = Math.hypot(...tmp.w) || 1;
      const miter = wl / W;
      const wx = tmp.w[0] / wl;
      const wy = tmp.w[1] / wl;
      const wz = tmp.w[2] / wl;
      // espesor: normal del panel ortogonalizada respecto del ancho
      const nd = tmp.n[0] * wx + tmp.n[1] * wy + tmp.n[2] * wz;
      let tx = tmp.n[0] - nd * wx;
      let ty = tmp.n[1] - nd * wy;
      let tz = tmp.n[2] - nd * wz;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const rib = Math.cos((arc / this.ribPeriod) * Math.PI * 2);
      const width = W * miter;
      let acc = 0;
      for (let r = 0; r < this.ring.length; r++) {
        const pr = this.ring[r];
        let a;
        let b;
        if (pr.top) {
          a = width - R + pr.round * R;
          b = pr.b * 2 * R;
        } else {
          a = pr.a * (pr.a > 0 ? width - R : 1 / miter);
          b = pr.b * 2 * R;
        }
        b += Math.sign(pr.b || 1) * pr.rib * this.ribAmp * rib * (pr.top ? 0.5 : 1);
        const o = (s * this.ring.length + r) * 3;
        pos[o] = tmp.p[0] + wx * a + tx * b;
        pos[o + 1] = tmp.p[1] + wy * a + ty * b;
        pos[o + 2] = tmp.p[2] + wz * a + tz * b;
        if (r > 0) {
          const q = o - 3;
          acc += Math.hypot(pos[o] - pos[q], pos[o + 1] - pos[q + 1], pos[o + 2] - pos[q + 2]);
        }
        uv[(s * this.ring.length + r) * 2] = arc;
        uv[(s * this.ring.length + r) * 2 + 1] = acc;
      }
    }
    const g = this.mesh.geometry;
    computeNormals(pos, g.index.array, g.attributes.normal.array);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.computeBoundingSphere();
  }
  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
  }
}

// ---------- Dobladillos / ribetes en bordes abiertos ----------
// Perfil en "J": el borde exterior da la vuelta (pliegue) y sube por dentro el margen doblado.
export class EdgeFold {
  constructor(materials, { radius = 0.0012, inside = 0.022, outside = 0, cover = 0 } = {}) {
    this.r = radius;
    this.inside = inside;
    this.outside = outside;
    this.cover = cover; // espesor extra (ribete que envuelve el borde)
    this.materials = materials;
    const prof = [];
    if (outside > 0) for (const t of [1, 0.66, 0.33]) prof.push({ e: outside * t, n: cover, g: 0 });
    const arcN = 7;
    for (let i = 0; i <= arcN; i++) {
      const a = (i / arcN) * Math.PI;
      const rr = radius + cover;
      prof.push({ e: -Math.sin(a) * rr * 0.95, n: -radius + Math.cos(a) * rr, g: 0 });
    }
    const inN = 4;
    for (let i = 1; i <= inN; i++) prof.push({ e: (i / inN) * inside, n: -2 * radius - cover, g: 1 });
    this.prof = prof;
    const gstart = prof.findIndex((p) => p.g === 1) - 1;
    this.groups = [
      [0, gstart],
      [gstart, prof.length - 1],
    ];
    this.mesh = null;
  }
  // chain/chainIn: índices de vértices del borde y de la fila interior; rows: filas sucesivas hacia adentro.
  update(panel, chain, chainIn, rows = null) {
    const count = chain.length;
    const ringN = this.prof.length;
    if (!this.mesh || this._count !== count) {
      const g = sweepGeometry(count, ringN, false, this.groups);
      if (this.mesh) {
        this.mesh.geometry.dispose();
        this.mesh.geometry = g;
      } else {
        this.mesh = new THREE.Mesh(g, this.materials);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
      }
      this._count = count;
    }
    const P = panel.pos;
    const N = panel.nrm;
    const g = this.mesh.geometry;
    const pos = g.attributes.position.array;
    const uv = g.attributes.uv.array;
    // marco por punto: E (hacia adentro del panel, ⟂ al borde) y N (normal ⟂ a E y al borde)
    if (!this._E || this._E.length !== count * 3) {
      this._E = new Float32Array(count * 3);
      this._N = new Float32Array(count * 3);
    }
    const EE = this._E;
    const NN = this._N;
    for (let s = 0; s < count; s++) {
      const v = chain[s] * 3;
      const w = chainIn[s] * 3;
      const a = chain[Math.max(0, s - 1)] * 3;
      const b = chain[Math.min(count - 1, s + 1)] * 3;
      let tx = P[b] - P[a];
      let ty = P[b + 1] - P[a + 1];
      let tz = P[b + 2] - P[a + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let ex = P[w] - P[v];
      let ey = P[w + 1] - P[v + 1];
      let ez = P[w + 2] - P[v + 2];
      const d = ex * tx + ey * ty + ez * tz;
      ex -= d * tx;
      ey -= d * ty;
      ez -= d * tz;
      let nx = N[v];
      let ny = N[v + 1];
      let nz = N[v + 2];
      // E también ⟂ a la normal: E = N × T orientado hacia adentro
      let cx = ny * tz - nz * ty;
      let cy = nz * tx - nx * tz;
      let cz = nx * ty - ny * tx;
      if (cx * ex + cy * ey + cz * ez < 0) {
        cx = -cx;
        cy = -cy;
        cz = -cz;
      }
      const cl = Math.hypot(cx, cy, cz) || 1;
      EE[s * 3] = cx / cl;
      EE[s * 3 + 1] = cy / cl;
      EE[s * 3 + 2] = cz / cl;
      NN[s * 3] = nx;
      NN[s * 3 + 1] = ny;
      NN[s * 3 + 2] = nz;
    }
    // suavizado del marco a lo largo del borde
    for (let it = 0; it < 3; it++) {
      for (const A of [EE, NN]) {
        const C = A.slice();
        for (let s = 1; s < count - 1; s++) {
          for (let q = 0; q < 3; q++) A[s * 3 + q] = (C[(s - 1) * 3 + q] + 2 * C[s * 3 + q] + C[(s + 1) * 3 + q]) / 4;
        }
        for (let s = 0; s < count; s++) {
          const l = Math.hypot(A[s * 3], A[s * 3 + 1], A[s * 3 + 2]) || 1;
          A[s * 3] /= l;
          A[s * 3 + 1] /= l;
          A[s * 3 + 2] /= l;
        }
      }
    }
    let along = 0;
    for (let s = 0; s < count; s++) {
      const v = chain[s] * 3;
      const ex = EE[s * 3];
      const ey = EE[s * 3 + 1];
      const ez = EE[s * 3 + 2];
      const nx = NN[s * 3];
      const ny = NN[s * 3 + 1];
      const nz = NN[s * 3 + 2];
      if (s > 0) {
        const u = chain[s - 1] * 3;
        along += Math.hypot(P[v] - P[u], P[v + 1] - P[u + 1], P[v + 2] - P[u + 2]);
      }
      let acc = 0;
      for (let r = 0; r < ringN; r++) {
        const pr = this.prof[r];
        const o = (s * ringN + r) * 3;
        if (rows && pr.e > 0.0005 && this._along(panel, rows, s, pr.e, _fp, _fn)) {
          // tramo que va pegado a la tela: sigue la superficie real (con arrugas y curvatura)
          pos[o] = _fp[0] + _fn[0] * pr.n;
          pos[o + 1] = _fp[1] + _fn[1] * pr.n;
          pos[o + 2] = _fp[2] + _fn[2] * pr.n;
        } else {
          pos[o] = P[v] + ex * pr.e + nx * pr.n;
          pos[o + 1] = P[v + 1] + ey * pr.e + ny * pr.n;
          pos[o + 2] = P[v + 2] + ez * pr.e + nz * pr.n;
        }
        if (r > 0) acc += Math.hypot(pr.e - this.prof[r - 1].e, pr.n - this.prof[r - 1].n);
        uv[(s * ringN + r) * 2] = along;
        uv[(s * ringN + r) * 2 + 1] = acc;
      }
    }
    computeNormals(pos, g.index.array, g.attributes.normal.array);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.computeBoundingSphere();
  }
  // Punto de la superficie a distancia `d` (por la tela) desde el borde, en la columna `s`.
  _along(panel, rows, s, d, outP, outN) {
    const P = panel.pos;
    const N = panel.nrm;
    let acc = 0;
    for (let r = 1; r < rows.length; r++) {
      const a = rows[r - 1][s] * 3;
      const b = rows[r][s] * 3;
      const l = Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
      if (acc + l >= d || r === rows.length - 1) {
        const t = l > 1e-9 ? clamp((d - acc) / l) : 0;
        for (let q = 0; q < 3; q++) {
          outP[q] = P[a + q] + (P[b + q] - P[a + q]) * t;
          outN[q] = N[a + q] + (N[b + q] - N[a + q]) * t;
        }
        const nl = Math.hypot(outN[0], outN[1], outN[2]) || 1;
        outN[0] /= nl;
        outN[1] /= nl;
        outN[2] /= nl;
        return true;
      }
      acc += l;
    }
    return false;
  }
  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
  }
}
const _fp = [0, 0, 0];
const _fn = [0, 0, 0];

// ---------- Puntadas ----------
const STITCH_GEO = (() => {
  const g = new THREE.SphereGeometry(0.5, 8, 5);
  return g;
})();
const _m4 = new THREE.Matrix4();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _pa = [0, 0, 0];
const _pb = [0, 0, 0];
const _na = [0, 0, 0];

// Un grupo de costura (ej. "ruedo") con puntadas en uno o ambos paneles.
export class StitchGroup {
  // slots: [{ side, att0, att1, lift, sleeve }] en orden de avance
  constructor(name, slots, material, { width = 0.0007, height = 0.00055 } = {}) {
    this.name = name;
    this.slots = slots;
    this.width = width;
    this.height = height;
    this.progress = 1;
    this.meshes = {};
    this.hideSleeves = false;
    for (const side of ['frente', 'espalda']) {
      const list = slots.filter((s) => s.side === side);
      if (!list.length) continue;
      const m = new THREE.InstancedMesh(STITCH_GEO, material, list.length);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.name = `puntadas-${name}-${side}`;
      m.userData.slots = list;
      this.meshes[side] = m;
    }
  }
  setMaterial(mat) {
    for (const m of Object.values(this.meshes)) m.material = mat;
  }
  update(panels) {
    for (const [side, m] of Object.entries(this.meshes)) {
      const panel = panels[side];
      const list = m.userData.slots;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        attachEval(panel, s.att0, _pa, _na);
        attachEval(panel, s.att1, _pb, null);
        const lift = s.lift;
        _bx.set(_pb[0] - _pa[0], _pb[1] - _pa[1], _pb[2] - _pa[2]);
        let len = _bx.length();
        if (len < 1e-6) {
          _bx.set(1, 0, 0);
          len = 0.002;
        } else _bx.divideScalar(len);
        _bz.set(_na[0], _na[1], _na[2]);
        _bz.addScaledVector(_bx, -_bz.dot(_bx)).normalize();
        _by.crossVectors(_bz, _bx);
        const hide = this.hideSleeves && s.sleeve;
        const sx = hide ? 0 : len * 0.92;
        const sy = hide ? 0 : this.width;
        const sz = hide ? 0 : this.height;
        _m4.set(
          _bx.x * sx, _by.x * sy, _bz.x * sz, (_pa[0] + _pb[0]) / 2 + _na[0] * lift,
          _bx.y * sx, _by.y * sy, _bz.y * sz, (_pa[1] + _pb[1]) / 2 + _na[1] * lift,
          _bx.z * sx, _by.z * sy, _bz.z * sz, (_pa[2] + _pb[2]) / 2 + _na[2] * lift,
          0, 0, 0, 1,
        );
        m.setMatrixAt(i, _m4);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    this._applyProgress();
  }
  setProgress(p) {
    this.progress = clamp(typeof p === 'boolean' ? (p ? 1 : 0) : +p || 0);
    this._applyProgress();
  }
  _applyProgress() {
    const total = this.slots.length;
    let shown = Math.round(this.progress * total);
    // el orden de avance es el del array `slots` (frente y espalda intercalados según el recorrido)
    const counts = { frente: 0, espalda: 0 };
    for (let i = 0; i < shown; i++) counts[this.slots[i].side]++;
    for (const [side, m] of Object.entries(this.meshes)) {
      m.count = counts[side];
      m.visible = m.count > 0;
    }
  }
  dispose() {
    for (const m of Object.values(this.meshes)) m.dispose();
  }
}

// ---------- Hilos sueltos ----------
// Crea un hilito curvo (en espacio local con origen en el anclaje) + colisionador invisible más grueso.
export function makeLooseThread(material, seed) {
  const r = rng(seed);
  const len = 0.015 + r() * 0.03;
  const pts = [new THREE.Vector3(0, 0, 0)];
  let x = 0;
  let y = 0.0015;
  let z = 0;
  let ang = (r() - 0.5) * 1.2;
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    ang += (r() - 0.5) * 1.4;
    x += Math.sin(ang) * (len / steps) * 0.8;
    z -= (len / steps) * (0.6 + 0.4 * t); // cuelga hacia "abajo" del marco local (−Z)
    y = 0.0015 + Math.sin(t * Math.PI) * 0.004 * (0.5 + r()) + t * 0.002;
    pts.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, 28, 0.00028, 5, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.name = 'hilo-suelto';
  const colGeo = new THREE.TubeGeometry(curve, 8, 0.0065, 6, false);
  const collider = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  // el raycast al hilo usa el colisionador grueso pero devuelve el hilo como objeto
  mesh.raycast = function (raycaster, intersects) {
    for (let o = this; o; o = o.parent) if (!o.visible) return;
    collider.matrixWorld.copy(this.matrixWorld);
    const tmp = [];
    collider.raycast(raycaster, tmp);
    for (const it of tmp) {
      it.object = this;
      intersects.push(it);
    }
  };
  mesh.userData.collider = collider;
  mesh.userData.length = len;
  return mesh;
}

export function disposeLooseThread(mesh) {
  mesh.geometry.dispose();
  const c = mesh.userData.collider;
  if (c) {
    c.geometry.dispose();
    c.material.dispose();
  }
  if (mesh.parent) mesh.parent.remove(mesh);
}

