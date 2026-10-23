// Generadores procedurales de tejidos (solo CPU, sin three.js).
// Cada tejido es un "muestreador": dado un punto en unidades de tile devuelve
// altura del hilo, variación de tono, campo de fibras (para el jaspeado) y huecos.
// Con eso se arman, una sola vez por tejido, el normal map, el roughness map y
// la variación de albedo, todos TILEABLES.
//
// Convención: x, y en unidades de tile (y hacia arriba = v de la textura).
// K = cantidad de tiles del dominio (el albedo cubre KxK tiles con variación
// propia: la geometría repite cada tile, los tonos cada K tiles).

import { clamp, smoothstep } from '../core/utils.js';

// ---------------------------------------------------------------------------
// Ruido y hash
// ---------------------------------------------------------------------------

// Hash entero (3 enteros → [0,1)), estilo murmur3.
export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0xcb1ab31f)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a, n) => {
  const r = a % n;
  return r < 0 ? r + n : r;
};

// Ruido de valor 2D periódico (px, py enteros) → [0,1].
export function pnoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = mod(xi, px);
  const x1 = mod(xi + 1, px);
  const y0 = mod(yi, py);
  const y1 = mod(yi + 1, py);
  const a = hash3(x0, y0, seed);
  const b = hash3(x1, y0, seed);
  const c = hash3(x0, y1, seed);
  const d = hash3(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Ruido de valor 2D no periódico (para coordenadas locales acotadas).
export function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash3(xi, yi, seed);
  const b = hash3(xi + 1, yi, seed);
  const c = hash3(xi, yi + 1, seed);
  const d = hash3(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Tabla 1D periódica de ruido suave (para perfiles a lo largo de un hilo).
function periodicTable(len, freq, seed, row) {
  const t = new Float32Array(len);
  for (let k = 0; k < len; k++) t[k] = pnoise((k / len) * freq, row, freq, 1 << 16, seed);
  return t;
}
const lookup = (t, f) => {
  // f en [0,1) periódico, interpolación lineal
  const n = t.length;
  const x = (f - Math.floor(f)) * n;
  const i = x | 0;
  const fr = x - i;
  return t[i] + (t[(i + 1) % n] - t[i]) * fr;
};

// ---------------------------------------------------------------------------
// Punto de jersey: columnas (wales) de mallas en V
// ---------------------------------------------------------------------------
// Unidades internas: 1 = ancho de una columna. Cada malla tiene dos "piernas"
// (granos de arroz inclinados) que forman la V; las V de pasadas vecinas se
// encastran: la punta de la V queda adelante y los extremos de arriba se hunden
// detrás de la malla siguiente (así se ve el trenzado del punto real).

function makeLegShape(p, a) {
  // pierna derecha: de B (abajo, cerca del centro) a T (arriba, afuera)
  const bx = p.legBotX;
  const by = p.legBotY * a;
  const tx = p.legTopX;
  const ty = p.legTopY * a;
  const len = Math.hypot(tx - bx, ty - by);
  const ux = (tx - bx) / len;
  const uy = (ty - by) / len;
  // dirección de las fibras (eje de la pierna girado por la torsión), por lado
  const angR = Math.atan2(uy, ux) + (p.twist || 0);
  const angL = Math.atan2(uy, -ux) + (p.twist || 0);
  return {
    ux,
    uy,
    half: (len / 2) * p.legLen,
    midX: (bx + tx) / 2,
    midY: (by + ty) / 2,
    cR: Math.cos(angR),
    sR: Math.sin(angR),
    cL: Math.cos(angL),
    sL: Math.sin(angL),
  };
}

// Tabla de parámetros aleatorios por malla (tileable: índice módulo columnas/pasadas).
function stitchTable(nW, nC, p, seed) {
  const T = new Float32Array(nW * nC * 4);
  for (let j = 0; j < nC; j++) {
    for (let i = 0; i < nW; i++) {
      const q = (j * nW + i) * 4;
      T[q] = (hash3(i, j, seed) - 0.5) * p.jitter; // corrimiento x
      T[q + 1] = (hash3(i, j, seed + 1) - 0.5) * p.jitter; // corrimiento y (en pasadas)
      T[q + 2] = 1 + (hash3(i, j, seed + 2) - 0.5) * p.heightVar; // alto
      T[q + 3] = p.legRadius * (1 + (hash3(i, j, seed + 3) - 0.5) * p.thickVar); // grosor
    }
  }
  return T;
}

// Busca la pierna más alta bajo (X, Y) revisando las columnas iMin..iMax y las
// pasadas vecinas. Devuelve la altura y deja los datos de la ganadora en `st`.
function knitLegs(X, Y, nW, nC, a, L, p, T, st, iMin, iMax) {
  const yc = Y / a;
  const j0 = Math.floor(yc);
  const t = yc - j0;
  // las piernas de una malla van de -0.16 a 1.16 pasadas: solo miro las vecinas cerca del borde
  const jMin = t < 0.26 ? j0 - 1 : j0;
  const jMax = t > 0.74 ? j0 + 1 : j0;
  const dip = p.dip;
  let best = -1;
  for (let j = jMin; j <= jMax; j++) {
    const jm = mod(j, nC);
    for (let i = iMin; i <= iMax; i++) {
      const q = (jm * nW + mod(i, nW)) * 4;
      const cx = i + 0.5 + T[q];
      const cy = (j + T[q + 1]) * a;
      const hs = T[q + 2];
      const rr = T[q + 3];
      for (let s = -1; s <= 1; s += 2) {
        const dx = X - (cx + s * L.midX);
        const dy = Y - (cy + L.midY);
        const ax = s * L.ux;
        const along = (dx * ax + dy * L.uy) / L.half;
        if (along <= -1 || along >= 1) continue;
        const perp = (dx * L.uy - dy * ax) / rr;
        if (perp <= -1 || perp >= 1) continue;
        const aa = along < 0 ? -along : along;
        const s2 = aa * aa * Math.sqrt(aa) + perp * perp; // superelipse (pierna "llena")
        if (s2 >= 1) continue;
        const h = Math.sqrt(1 - s2) * hs * (1 - dip * (along * 0.5 + 0.5));
        if (h > best) {
          best = h;
          st.i = i;
          st.j = j;
          st.s = s;
          st.along = along;
          st.perp = perp;
          st.dx = dx;
          st.dy = dy;
        }
      }
    }
  }
  return best;
}

// Estrías de fibra sobre la pierna ganadora, en la dirección de torsión del hilo.
// `relief` = false solo calcula las coordenadas de fibra (para tonos).
function legFibers(st, L, p, seedLeg, out, relief) {
  const c = st.s > 0 ? L.cR : L.cL;
  const sn = st.s > 0 ? L.sR : L.sL;
  out.fa = st.dx * c + st.dy * sn; // a lo largo de la fibra
  out.fc = -st.dx * sn + st.dy * c; // a través de las fibras
  return relief ? vnoise(out.fa * p.fiberLen, out.fc * p.fiberDensity, seedLeg) : 0.5;
}

// Modos de muestreo: RELIEF = solo altura (normal map), SHADE = tonos y fibras
// (albedo), ALL = todo (miniaturas).
export const RELIEF = 1;
export const SHADE = 2;
export const ALL = 3;

export function knitSampler(p) {
  const nW = p.wales;
  const nC = p.courses;
  const a = nW / nC; // alto de pasada en unidades de columna
  const L = makeLegShape(p, a);
  const seed = p.seed | 0;
  const T = stitchTable(nW, nC, p, seed);
  const st = { i: 0, j: 0, s: 1, along: 0, perp: 0, dx: 0, dy: 0 };
  const fo = { fa: 0, fc: 0 };
  return function sample(x, y, K, o, mode = ALL) {
    const X = x * nW;
    const Y = y * nW;
    const i0 = Math.floor(X);
    const u = X - i0;
    // la columna propia y, cerca del borde, la vecina
    const best = knitLegs(X, Y, nW, nC, a, L, p, T, st, u < 0.2 ? i0 - 1 : i0, u > 0.8 ? i0 + 1 : i0);
    if (best < 0) {
      // surco entre columnas (sin pierna): ruido periódico para que el tile empalme
      const P = nW * K * 3;
      o.h = 0;
      o.tone = 1;
      o.fiber = pnoise(X * 3, Y * 3, P, P, seed + 99);
      o.gap = 0;
      return o;
    }
    const iK = mod(st.i, nW * K);
    const jK = mod(st.j, nC * K);
    const legSeed = (iK * 7919 + jK * 104729 + (st.s > 0 ? 1 : 0)) | 0;
    const cross = Math.sqrt(Math.max(0, 1 - st.perp * st.perp));
    const fib = legFibers(st, L, p, legSeed, fo, mode & RELIEF);
    // hilo con estrías de fibra (más marcadas en el centro de la pierna)
    o.h = best + p.fiberAmp * (fib - 0.5) * cross;
    o.gap = 0;
    if (!(mode & SHADE)) return o;
    // tono: pasada (barré muy leve) + malla + fibras
    const courseTone = 1 + (hash3(jK, 0, seed + 17) - 0.5) * p.courseTone;
    const stitchTone = 1 + (hash3(iK, jK, seed + 23) - 0.5) * p.stitchTone;
    const fiberTone = 1 + (vnoise(fo.fa * p.fiberLen * 0.6, fo.fc * p.fiberDensity * 0.5, legSeed + 5) - 0.5) * p.fiberTone;
    o.tone = courseTone * stitchTone * fiberTone;
    // jaspeado: vetas cortas de fibras de distinto tono a lo largo del hilo
    o.fiber = vnoise(fo.fa * p.heatherLen + jK * 3.1, fo.fc * p.heatherDensity, legSeed + 77);
    return o;
  };
}

// ---------------------------------------------------------------------------
// Acanalado 1x1 (ribb): columnas al derecho en relieve y al revés hundidas
// ---------------------------------------------------------------------------
export function ribSampler(p) {
  const nP = p.pairs; // pares de columnas por tile
  const nC = p.courses;
  const kw = p.knitWidth; // ancho de la columna al derecho (el par mide 2)
  const knit = p.knit;
  const aW = (nP * 2) / nC; // alto de pasada (columna normal = 1)
  const a = aW / kw; // alto de pasada en unidades de la columna al derecho
  const L = makeLegShape(knit, a);
  const seed = p.seed | 0;
  const T = stitchTable(nP, nC, knit, seed);
  const st = { i: 0, j: 0, s: 1, along: 0, perp: 0, dx: 0, dy: 0 };
  const fo = { fa: 0, fc: 0 };
  return function sample(x, y, K, o, mode = ALL) {
    const X = x * nP * 2;
    const Y = y * nP * 2;
    const pair = Math.floor(X / 2);
    const lx = X - pair * 2;
    const pm = mod(pair, nP);
    const pK = mod(pair, nP * K);
    o.gap = 0;
    if (lx < kw) {
      // columna al derecho: piernas en V escaladas al ancho kw, sobre un lomo redondeado
      const U = lx / kw;
      const best = knitLegs(U + pm, Y / kw, nP, nC, a, L, knit, T, st, pm, pm);
      const ridge = Math.sin(Math.PI * U);
      if (best < 0) {
        const P = nP * 2 * K * 3;
        o.h = p.ridge * ridge;
        o.tone = 1;
        o.fiber = pnoise(X * 3, Y * 3, P, P, seed + 3);
        return o;
      }
      const jK = mod(st.j, nC * K);
      const legSeed = (pK * 7919 + jK * 104729 + (st.s > 0 ? 1 : 0)) | 0;
      const cross = Math.sqrt(Math.max(0, 1 - st.perp * st.perp));
      const fib = legFibers(st, L, knit, legSeed, fo, mode & RELIEF);
      o.h = p.ridge * ridge + (1 - p.ridge) * (best + knit.fiberAmp * (fib - 0.5) * cross);
      o.tone = (1 + (hash3(jK, 0, seed + 17) - 0.5) * knit.courseTone) *
        (1 + (vnoise(fo.fa * 6, fo.fc * 10, legSeed + 5) - 0.5) * knit.fiberTone);
      o.fiber = vnoise(fo.fa * knit.heatherLen + jK * 3.1, fo.fc * knit.heatherDensity, legSeed + 77);
      return o;
    }
    // columna al revés: hundida, con cabecitas de malla horizontales
    const U = (lx - kw) / (2 - kw);
    const yc = Y / aW;
    const j = Math.floor(yc);
    const jK = mod(j, nC * K);
    const bump = Math.sin(Math.PI * U) * Math.sin(Math.PI * (yc - j));
    o.h = p.purlH * bump;
    o.tone = 0.96 + (hash3(jK, pK, seed + 9) - 0.5) * 0.04;
    o.fiber = pnoise(X * 5 + jK, Y * 2, nP * 2 * K * 5, nP * 2 * K * 2, seed + 11);
    o.gap = p.purlGap * (1 - bump);
    return o;
  };
}

// ---------------------------------------------------------------------------
// Celdas en tresbolillo (para piqué y mesh): distancia al centro más cercano
// ---------------------------------------------------------------------------
function staggeredCells(nX, nY, jitter, seed) {
  const T = new Float32Array(nX * nY * 2);
  for (let r = 0; r < nY; r++) {
    for (let c = 0; c < nX; c++) {
      T[(r * nX + c) * 2] = (hash3(c, r, seed) - 0.5) * jitter;
      T[(r * nX + c) * 2 + 1] = (hash3(c, r, seed + 1) - 0.5) * jitter;
    }
  }
  return T;
}

// Devuelve d1 (más cercano), d2 (segundo) y la celda ganadora en `res`.
function nearestCells(X, Y, nX, nY, b, aniso, T, res) {
  const r0 = Math.floor(Y / b);
  let d1 = 9;
  let d2 = 9;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const rm = mod(r, nY);
    const off = rm & 1 ? 0.5 : 0;
    const cc0 = Math.floor(X - off);
    for (let c = cc0 - 1; c <= cc0 + 1; c++) {
      const q = (rm * nX + mod(c, nX)) * 2;
      const dx = X - (c + 0.5 + off + T[q]);
      const dy = (Y - (r + 0.5 + T[q + 1]) * b) * aniso;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        res.c = c;
        res.r = r;
      } else if (d < d2) d2 = d;
    }
  }
  res.d1 = d1;
  res.d2 = d2;
  return res;
}

// ---------------------------------------------------------------------------
// Piqué: celdas tipo panal hundidas con paredes de mallas en relieve
// ---------------------------------------------------------------------------
export function piqueSampler(p) {
  const nX = p.cellsX;
  const nY = p.cellsY; // par, para que las filas alternadas tileen
  const b = nX / nY; // alto de fila en unidades de celda
  const knit = knitSampler({ ...p.knit, seed: p.seed + 5 });
  const ko = { h: 0, tone: 1, fiber: 0, gap: 0 };
  const seed = p.seed | 0;
  const T = staggeredCells(nX, nY, p.jitter, seed);
  const cell = { c: 0, r: 0, d1: 0, d2: 0 };
  return function sample(x, y, K, o, mode = ALL) {
    nearestCells(x * nX, y * nX, nX, nY, b, p.aniso, T, cell);
    const edge = cell.d2 - cell.d1; // 0 sobre la pared
    const t = clamp(edge / p.wall);
    const ridge = 0.5 + 0.5 * Math.cos(Math.PI * t);
    knit(x, y, K, ko, mode);
    const dome = p.dome * (1 - smoothstep(0, 0.4, cell.d1));
    o.h = p.floorH + dome + (1 - p.floorH) * ridge * (p.knitMix + (1 - p.knitMix) * ko.h);
    const cK = mod(cell.c, nX * K);
    const rK = mod(cell.r, nY * K);
    o.tone = ko.tone * (1 + (hash3(cK, rK, seed + 41) - 0.5) * p.cellTone);
    o.fiber = ko.fiber;
    o.gap = (1 - ridge) * p.pitDark;
    return o;
  };
}

// ---------------------------------------------------------------------------
// Mesh deportivo: punto finísimo de filamento con poros en tresbolillo
// ---------------------------------------------------------------------------
export function meshSampler(p) {
  const nX = p.poresX;
  const nY = p.poresY; // par
  const b = nX / nY;
  const knit = knitSampler({ ...p.knit, seed: p.seed + 3 });
  const ko = { h: 0, tone: 1, fiber: 0, gap: 0 };
  const T = staggeredCells(nX, nY, p.jitter, p.seed | 0);
  const cell = { c: 0, r: 0, d1: 0, d2: 0 };
  return function sample(x, y, K, o, mode = ALL) {
    nearestCells(x * nX, y * nX, nX, nY, b, p.aniso, T, cell);
    const d1 = cell.d1;
    knit(x, y, K, ko, mode);
    const rp = p.poreR;
    const hole = 1 - smoothstep(rp * 0.7, rp * 1.12, d1);
    const rim = Math.exp(-(((d1 - rp * 1.6) / (rp * 0.8)) ** 2));
    const base = p.knitBase + (1 - p.knitBase) * ko.h;
    o.h = base * (0.8 + 0.2 * rim) * (1 - hole) - hole * 0.3;
    o.tone = ko.tone;
    o.fiber = ko.fiber;
    o.gap = hole;
    return o;
  };
}

// ---------------------------------------------------------------------------
// Lino: tafetán (uno arriba, uno abajo) con hilos irregulares y "slubs"
// ---------------------------------------------------------------------------
export function linenSampler(p) {
  const n = p.threads; // hilos por tile en cada dirección (par)
  const seed = p.seed | 0;
  const M = 256; // muestras a lo largo de cada hilo
  // perfiles precalculados por hilo y dirección: corrimiento, grosor, slub
  const dirs = [0, 1].map((dir) => {
    const sd = seed + dir * 1000;
    const offs = [];
    const thick = [];
    const slubs = [];
    for (let i = 0; i < n; i++) {
      const wob = periodicTable(M, p.wobFreq, sd + 3, i);
      const sl = periodicTable(M, p.slubFreq, sd + 7, i);
      const tn = periodicTable(M, p.thickFreq, sd + 11, i);
      const base = (hash3(i, 1, sd) - 0.5) * p.jitter;
      const th = p.radius * (1 + (hash3(i, 2, sd) - 0.5) * p.thickVar);
      const o = new Float32Array(M);
      const t = new Float32Array(M);
      const s = new Float32Array(M);
      for (let k = 0; k < M; k++) {
        const slub = smoothstep(p.slubLo, p.slubHi, sl[k]);
        o[k] = base + (wob[k] - 0.5) * p.wobble;
        s[k] = slub;
        t[k] = th * (1 + p.slubAmp * slub) * (1 + (tn[k] - 0.5) * p.thickNoise);
      }
      offs.push(o);
      thick.push(t);
      slubs.push(s);
    }
    return { offs, thick, slubs, sd };
  });
  const wRes = { h: -1, i: 0, across: 0, slub: 0, lt: 0, prof: 0 };
  const fRes = { h: -1, i: 0, across: 0, slub: 0, lt: 0, prof: 0 };

  // `c` = coordenada transversal, `l` = a lo largo (en unidades de hilo).
  function threads(c, l, dir, res) {
    const D = dirs[dir];
    const i0 = Math.floor(c);
    const lt = l / n; // a lo largo en unidades de tile
    res.h = -1;
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const im = mod(i, n);
      const cx = i + 0.5 + lookup(D.offs[im], lt);
      const thick = lookup(D.thick[im], lt);
      const across = (c - cx) / thick;
      if (across <= -1 || across >= 1) continue;
      const prof = Math.sqrt(1 - across * across);
      // sube y baja alternando con los hilos cruzados (tafetán)
      const par = (im & 1) === 0 ? 1 : -1;
      const e = par * Math.cos(Math.PI * (l - 0.5)) * (dir === 0 ? 1 : -1);
      const lift = 0.5 + 0.5 * e;
      const slub = lookup(D.slubs[im], lt);
      const h = prof * (0.2 + 0.8 * lift) * (0.9 + 0.2 * slub);
      if (h > res.h) {
        res.h = h;
        res.i = i;
        res.across = across;
        res.slub = slub;
        res.lt = lt;
        res.prof = prof;
      }
    }
    return res;
  }

  return function sample(x, y, K, o, mode = ALL) {
    const X = x * n;
    const Y = y * n;
    const w = threads(X, Y, 0, wRes); // urdimbre: verticales
    const f = threads(Y, X, 1, fRes); // trama: horizontales
    const dir = w.h >= f.h ? 0 : 1;
    const win = dir === 0 ? w : f;
    const top = Math.max(0, win.h);
    const sd = dirs[dir].sd;
    // fibras largas a lo largo del hilo (periódicas en el dominio)
    const fib = pnoise(win.lt * p.fiberLen, win.across * p.fiberDensity + mod(win.i, n * K) * 17.3, p.fiberLen * K, 1 << 16, sd + 13);
    o.h = top + p.fiberAmp * (fib - 0.5) * win.prof;
    o.gap = 1 - smoothstep(0.02, 0.25, top);
    if (!(mode & SHADE)) return o;
    // tono por hilo (dominio K para que no se note la repetición)
    const iK = mod(win.i, n * K);
    const threadTone = 1 + (hash3(iK, 5, sd) - 0.5) * p.threadTone;
    const alongTone = 1 + (pnoise(win.lt * p.toneFreq, iK, p.toneFreq * K, 1 << 16, sd + 21) - 0.5) * p.alongTone;
    o.tone = threadTone * alongTone * (1 + win.slub * p.slubTone) * (1 + (fib - 0.5) * p.fiberTone);
    o.fiber = pnoise(win.lt * p.heatherLen, win.across * 2.5 + iK * 7.7, p.heatherLen * K, 1 << 16, sd + 31);
    return o;
  };
}

// ---------------------------------------------------------------------------
// Hilo retorcido (para puntadas y carreteles): surcos diagonales
// ---------------------------------------------------------------------------
export function threadSampler(p) {
  const n = p.plies;
  const seed = p.seed | 0;
  return function sample(x, y, K, o) {
    const ph = (x + y) * n;
    const f = ph - Math.floor(ph);
    const prof = Math.pow(Math.sin(Math.PI * f), 0.6);
    const fib = pnoise(ph * 4, (x - y) * p.fibers, n * 4, p.fibers, seed);
    o.h = prof * 0.85 + (fib - 0.5) * 0.3 * prof;
    o.tone = 1 + (fib - 0.5) * 0.08;
    o.fiber = fib;
    o.gap = 0;
    return o;
  };
}

// ---------------------------------------------------------------------------
// Definiciones de tejidos
// ---------------------------------------------------------------------------
// tile: metros que ocupa una repetición de la textura (exagerado ~2x para que
//   la trama se perciba a 0.5–1 m).  size: lado de las texturas (px).
// relief: alto del hilo en unidades de tile (fuerza del normal map); normalScale
//   la ajusta en el material.
// albedoTiles: el mapa de color cubre KxK tiles con variación propia (disimula la
//   repetición). hpCells: tamaño del pasa-altos del albedo (celdas por tile).
// meanRough / meanGray: promedios medidos de la versión completa, para las
//   texturas lisas provisorias (si cambiás parámetros, volvé a medirlos).
// aoMin/aoPow: oscurecimiento de los surcos; roughTop: cuánto más lisas son las
//   crestas; holeDark: oscuridad de huecos/poros; swatchTiles: tiles visibles en la
//   miniatura; sheenRoughness: del material.

const KNIT_BASE = {
  legBotX: 0.07,
  legBotY: -0.16,
  legTopX: 0.37,
  legTopY: 1.16,
  legLen: 1.0,
  legRadius: 0.215,
  dip: 0.32,
  jitter: 0.035,
  heightVar: 0.05,
  thickVar: 0.06,
  twist: 0.5,
  fiberLen: 2.2,
  fiberDensity: 14,
  fiberAmp: 0.12,
  courseTone: 0.05,
  stitchTone: 0.05,
  fiberTone: 0.1,
  heatherLen: 2.4,
  heatherDensity: 6,
};

export const WEAVE_DEFS = {
  jersey: {
    name: 'Jersey',
    tile: 0.012,
    size: 256,
    relief: 0.05,
    normalScale: 1.0,
    hpCells: 8,
    meanRough: 0.916,
    meanGray: 0.840,
    albedoTiles: 2,
    aoMin: 0.62,
    aoPow: 0.8,
    roughTop: 0.18,
    holeDark: 0.6,
    swatchTiles: 2.2,
    sheenRoughness: 0.72,
    make: () => knitSampler({ ...KNIT_BASE, wales: 8, courses: 11, seed: 11 }),
  },
  jersey_fino: {
    name: 'Jersey fino',
    tile: 0.0095,
    size: 256,
    relief: 0.034,
    normalScale: 0.9,
    hpCells: 10,
    meanRough: 0.900,
    meanGray: 0.893,
    albedoTiles: 2,
    aoMin: 0.7,
    aoPow: 0.8,
    roughTop: 0.2,
    holeDark: 0.6,
    swatchTiles: 2.4,
    sheenRoughness: 0.62,
    make: () =>
      knitSampler({
        ...KNIT_BASE,
        wales: 10,
        courses: 14,
        seed: 21,
        jitter: 0.025,
        heightVar: 0.03,
        thickVar: 0.03,
        fiberAmp: 0.07,
        fiberTone: 0.06,
        courseTone: 0.03,
        stitchTone: 0.03,
      }),
  },
  pique: {
    name: 'Piqué',
    tile: 0.012,
    size: 256,
    relief: 0.042,
    normalScale: 1.0,
    hpCells: 7,
    meanRough: 0.964,
    meanGray: 0.808,
    albedoTiles: 2,
    aoMin: 0.74,
    aoPow: 0.9,
    roughTop: 0.12,
    holeDark: 0.25,
    swatchTiles: 1.8,
    sheenRoughness: 0.78,
    make: () =>
      piqueSampler({
        cellsX: 7,
        cellsY: 10,
        jitter: 0.06,
        aniso: 1.0,
        wall: 0.58,
        floorH: 0.3,
        dome: 0.1,
        knitMix: 0.55,
        cellTone: 0.04,
        pitDark: 0.15,
        seed: 31,
        knit: { ...KNIT_BASE, wales: 21, courses: 30, fiberAmp: 0.08 },
      }),
  },
  lino: {
    name: 'Lino',
    tile: 0.021,
    size: 256,
    relief: 0.032,
    normalScale: 1.15,
    hpCells: 6,
    meanRough: 0.970,
    meanGray: 0.823,
    albedoTiles: 2,
    aoMin: 0.62,
    aoPow: 0.7,
    roughTop: 0.08,
    holeDark: 0.35,
    swatchTiles: 1.6,
    sheenRoughness: 0.85,
    make: () =>
      linenSampler({
        threads: 18,
        radius: 0.44,
        jitter: 0.12,
        wobble: 0.14,
        wobFreq: 3,
        thickVar: 0.22,
        thickNoise: 0.18,
        thickFreq: 5,
        slubFreq: 4,
        slubLo: 0.62,
        slubHi: 0.86,
        slubAmp: 0.32,
        fiberLen: 80,
        fiberDensity: 4,
        fiberAmp: 0.1,
        fiberTone: 0.06,
        threadTone: 0.035,
        alongTone: 0.09,
        toneFreq: 7,
        slubTone: 0.08,
        heatherLen: 12,
        seed: 41,
      }),
  },
  mesh: {
    name: 'Micro-mesh',
    tile: 0.008,
    size: 256,
    relief: 0.045,
    normalScale: 1.0,
    hpCells: 6,
    meanRough: 0.847,
    meanGray: 0.883,
    albedoTiles: 2,
    aoMin: 0.78,
    aoPow: 0.8,
    roughTop: 0.22,
    holeDark: 0.62,
    swatchTiles: 2.6,
    sheenRoughness: 0.45,
    make: () =>
      meshSampler({
        poresX: 6,
        poresY: 8,
        jitter: 0.02,
        aniso: 1.0,
        poreR: 0.2,
        knitBase: 0.55,
        seed: 51,
        knit: {
          ...KNIT_BASE,
          wales: 18,
          courses: 24,
          jitter: 0.02,
          heightVar: 0.04,
          thickVar: 0.04,
          fiberAmp: 0.04,
          fiberTone: 0.03,
          courseTone: 0.02,
          stitchTone: 0.02,
        },
      }),
  },
  modal: {
    name: 'Modal',
    tile: 0.008,
    size: 256,
    relief: 0.022,
    normalScale: 0.8,
    hpCells: 10,
    meanRough: 0.841,
    meanGray: 0.947,
    albedoTiles: 2,
    aoMin: 0.8,
    aoPow: 0.8,
    roughTop: 0.3,
    holeDark: 0.5,
    swatchTiles: 3.4,
    sheenRoughness: 0.42,
    make: () =>
      knitSampler({
        ...KNIT_BASE,
        wales: 10,
        courses: 14,
        seed: 61,
        legRadius: 0.23,
        jitter: 0.025,
        heightVar: 0.04,
        thickVar: 0.04,
        fiberAmp: 0.03,
        fiberTone: 0.025,
        courseTone: 0.015,
        stitchTone: 0.015,
      }),
  },
  rib: {
    name: 'Ribb 1x1',
    tile: 0.012,
    size: 256,
    relief: 0.07,
    normalScale: 1.15,
    hpCells: 5,
    meanRough: 0.935,
    meanGray: 0.740,
    albedoTiles: 2,
    aoMin: 0.55,
    aoPow: 0.7,
    roughTop: 0.18,
    holeDark: 0.5,
    swatchTiles: 2.0,
    sheenRoughness: 0.7,
    make: () =>
      ribSampler({
        pairs: 5,
        courses: 14,
        knitWidth: 1.3,
        ridge: 0.35,
        purlH: 0.16,
        purlGap: 0.4,
        seed: 71,
        knit: { ...KNIT_BASE, legRadius: 0.23, legTopX: 0.36, legBotX: 0.08, jitter: 0.04 },
      }),
  },
  thread: {
    name: 'Hilo',
    tile: 1,
    size: 128,
    relief: 0.06,
    normalScale: 0.9,
    hpCells: 4,
    meanRough: 0.823,
    meanGray: 0.940,
    albedoTiles: 1,
    aoMin: 0.82,
    aoPow: 1,
    roughTop: 0.35,
    holeDark: 0,
    swatchTiles: 1,
    sheenRoughness: 0.4,
    make: () => threadSampler({ plies: 6, fibers: 48, seed: 81 }),
  },
};

// ---------------------------------------------------------------------------
// Generación de mapas
// ---------------------------------------------------------------------------

// Mapa de normales (RGBA8, OpenGL, fila 0 = v 0) desde alturas tileables.
// `k` escala la pendiente: relief (unidades de tile) * N.
export function heightToNormalData(H, N, relief) {
  const out = new Uint8Array(N * N * 4);
  const k = relief * N * 0.5;
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N;
    const yp = ((y + 1) % N) * N;
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N;
      const xp = (x + 1) % N;
      // Sobel (3x3) con wrap
      const dx = (H[ym + xp] + 2 * H[row + xp] + H[yp + xp] - H[ym + xm] - 2 * H[row + xm] - H[yp + xm]) * 0.25;
      const dy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp] - H[ym + xm] - 2 * H[ym + x] - H[ym + xp]) * 0.25;
      let nx = -dx * k;
      let ny = -dy * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const o = (row + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255 + 0.5;
      out[o + 1] = (ny * 0.5 + 0.5) * 255 + 0.5;
      out[o + 2] = (inv * 0.5 + 0.5) * 255 + 0.5;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Factor de albedo (lineal) a partir de altura normalizada y datos del muestreo.
// (oclusión por tabla: evita Math.pow por píxel)
const aoLUTs = new Map();
function aoLUT(def) {
  let t = aoLUTs.get(def);
  if (!t) {
    t = new Float32Array(257);
    for (let k = 0; k <= 256; k++) t[k] = def.aoMin + (1 - def.aoMin) * Math.pow(Math.min(1, k / 256 / 0.75), def.aoPow);
    aoLUTs.set(def, t);
  }
  return t;
}
export function albedoFactor(def, hn, o, lut = aoLUT(def)) {
  const ao = lut[hn <= 0 ? 0 : hn >= 1 ? 256 : (hn * 256) | 0];
  return ao * o.tone * (1 - o.gap * def.holeDark);
}

// Desenfoque de caja separable con wrap (tileable), `passes` veces.
export function wrapBlur(src, w, h, r, passes = 2) {
  let a = new Float32Array(src);
  const b = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + ((x + w) % w)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv;
        acc += a[row + ((x + r + 1) % w)] - a[row + ((x - r + w) % w)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[((y + h) % h) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * inv;
        acc += b[((y + r + 1) % h) * w + x] - b[((y - r + h) % h) * w + x];
      }
    }
  }
  return a;
}

// Pasa-altos: le saca a un campo tileable las manchas más grandes que ~r px.
// Así, al repetir el tile, no aparece una grilla de manchas (la variación de baja
// frecuencia la pone la capa "macro" de fabric.js, que no se repite a la vista).
export function highPass(F, w, h, r, keep = 0) {
  const lo = wrapBlur(F, w, h, r, 2);
  let mean = 0;
  for (let k = 0; k < F.length; k++) mean += F[k];
  mean /= F.length;
  for (let k = 0; k < F.length; k++) F[k] = F[k] - (1 - keep) * (lo[k] - mean);
  return F;
}

// Ecualiza un campo (por histograma) para que quede ~uniforme en [0,1].
export function equalize(F) {
  const bins = 256;
  const hist = new Uint32Array(bins);
  for (let k = 0; k < F.length; k++) hist[Math.min(bins - 1, Math.max(0, (F[k] * bins) | 0))]++;
  const cdf = new Float32Array(bins);
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    cdf[b] = acc / F.length;
  }
  for (let k = 0; k < F.length; k++) F[k] = cdf[Math.min(bins - 1, Math.max(0, (F[k] * bins) | 0))];
  return F;
}

// Genera todos los datos CPU de un tejido: alturas + normales + rugosidad (1 tile,
// N px) y albedo gris + campo de fibras (KxK tiles, A px).
// Es un generador que cede el control cada tanto (`yield`), para poder repartir
// el trabajo en varios frames; generateWeave() lo corre de una.
export function* weaveJob(id, { N, A } = {}) {
  const def = WEAVE_DEFS[id];
  N = N || def.size;
  A = A || def.size;
  const sample = def.make();
  const o = { h: 0, tone: 1, fiber: 0, gap: 0 };
  const band = Math.max(4, Math.round(4096 / N)); // filas por tramo (~4k muestras)

  // 1) alturas de un tile
  const H = new Float32Array(N * N);
  const GAP = new Float32Array(N * N);
  let mn = Infinity;
  let mx = -Infinity;
  for (let py = 0; py < N; py++) {
    const y = (py + 0.5) / N;
    for (let px = 0; px < N; px++) {
      sample((px + 0.5) / N, y, 1, o, RELIEF);
      const k = py * N + px;
      H[k] = o.h;
      GAP[k] = o.gap;
      if (o.h < mn) mn = o.h;
      if (o.h > mx) mx = o.h;
    }
    if (py % band === band - 1) yield;
  }
  const span = mx - mn || 1;
  for (let k = 0; k < H.length; k++) H[k] = (H[k] - mn) / span;

  // 2) normales
  const normal = heightToNormalData(H, N, def.relief);
  yield;

  // 3) rugosidad: crestas del hilo un poco más lisas, huecos más ásperos
  const rough = new Uint8Array(N * N * 4);
  let rSum = 0;
  for (let k = 0; k < H.length; k++) {
    const r = clamp(1 - def.roughTop * smoothstep(0.3, 1, H[k]) + GAP[k] * 0.1, 0, 1);
    rSum += r;
    const v = (r * 255 + 0.5) | 0;
    const q = k * 4;
    rough[q] = v;
    rough[q + 1] = v;
    rough[q + 2] = v;
    rough[q + 3] = 255;
  }
  yield;

  // 4) albedo (gris multiplicativo) + campo de fibras para el jaspeado
  const K = def.albedoTiles;
  const gray = new Float32Array(A * A);
  const fiber = new Float32Array(A * A);
  const lut = aoLUT(def);
  const bandA = Math.max(4, Math.round(4096 / A));
  for (let py = 0; py < A; py++) {
    const y = ((py + 0.5) / A) * K;
    for (let px = 0; px < A; px++) {
      sample(((px + 0.5) / A) * K, y, K, o, SHADE);
      const k = py * A + px;
      gray[k] = albedoFactor(def, (o.h - mn) / span, o, lut);
      fiber[k] = o.fiber;
    }
    if (py % bandA === bandA - 1) yield;
  }
  // sin manchas del tamaño del tile (evita que se vea la repetición)
  const hpR = Math.max(2, Math.round(A / K / (def.hpCells || 8)));
  highPass(gray, A, A, hpR);
  yield;
  highPass(fiber, A, A, hpR);
  let gMax = 0;
  for (let k = 0; k < gray.length; k++) if (gray[k] > gMax) gMax = gray[k];
  // normalizo: que las crestas queden en ~1 (el color elegido manda)
  const gScale = 1 / Math.max(gMax * 0.985, 1e-3);
  let gSum = 0;
  for (let k = 0; k < gray.length; k++) {
    gray[k] = Math.min(1, gray[k] * gScale);
    gSum += gray[k];
  }
  // contraste del campo de fibras para que el jaspeado tenga vetas definidas
  equalize(fiber);

  return {
    id,
    def,
    tile: def.tile,
    N,
    A,
    K,
    height: H,
    hMin: mn,
    hSpan: span,
    normal,
    rough,
    roughMean: rSum / H.length,
    gray,
    grayMean: gSum / gray.length,
    fiber,
  };
}

// Corre un generador hasta el final y devuelve su resultado.
export function runJob(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

export function generateWeave(id, opts = {}) {
  return runJob(weaveJob(id, opts));
}
