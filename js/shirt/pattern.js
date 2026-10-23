// Moldería: medidas reales de la prenda, silueta frente/espalda (para la remera 3D),
// líneas de costura visibles y piezas de corte con margen de costura y piquetes.
// Todo en metros y en "coordenadas de prenda": x a la derecha visto de frente,
// y hacia arriba, origen = centro del cuello a la altura del punto alto del hombro (HPS).

import { SIZES, sizeById, fitById, sleeveById, neckById } from '../data/catalog.js';
import { cubicBezier, quadBezier, polylineLength, lerp, clamp } from '../core/utils.js';

const CM = 0.01;
const PIECE_COLORS = ['#d9bb8c', '#cfae7d', '#e2c79d', '#c8a575', '#ead3ab', '#d4b483'];

// ---------- utilidades geométricas 2D ----------
const P = (x, y) => ({ x, y });
const mirror = (pts) => pts.map((p) => ({ x: -p.x, y: p.y }));
const rev = (pts) => pts.slice().reverse();
const sub = (a, b) => P(a.x - b.x, a.y - b.y);
const add = (a, b) => P(a.x + b.x, a.y + b.y);
const mul = (a, k) => P(a.x * k, a.y * k);
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => {
  const l = len(a) || 1;
  return P(a.x / l, a.y / l);
};
const dirAngle = (deg) => P(Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)); // ángulo hacia abajo

function bezier(a, c1, c2, b, n = 32) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(cubicBezier(a, c1, c2, b, i / n));
  return out;
}
function quad(a, c, b, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(quadBezier(a, c, b, i / n));
  return out;
}
function line(a, b, n = 1) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(P(lerp(a.x, b.x, i / n), lerp(a.y, b.y, i / n)));
  return out;
}
// Concatena tramos sin repetir el punto de unión.
function join(...parts) {
  const out = [];
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      if (out.length && i === 0) {
        const l = out[out.length - 1];
        if (Math.hypot(l.x - part[0].x, l.y - part[0].y) < 1e-7) continue;
      }
      out.push({ x: part[i].x, y: part[i].y });
    }
  }
  return out;
}
// Remuestrea una polilínea abierta en n tramos iguales (n+1 puntos) por longitud de arco.
export function resampleN(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  const out = [];
  let k = 1;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (k < pts.length - 1 && cum[k] < s) k++;
    const a = pts[k - 1];
    const b = pts[k];
    const t = cum[k] - cum[k - 1] > 1e-12 ? (s - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
    out.push(P(lerp(a.x, b.x, clamp(t)), lerp(a.y, b.y, clamp(t))));
  }
  out[0] = { ...pts[0] };
  out[n] = { ...pts[pts.length - 1] };
  return out;
}
// Punto a distancia `d` (por arco) desde el inicio de una polilínea.
function pointAt(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + l >= d) {
      const t = l ? (d - acc) / l : 0;
      return P(lerp(pts[i - 1].x, pts[i].x, t), lerp(pts[i - 1].y, pts[i].y, t));
    }
    acc += l;
  }
  return { ...pts[pts.length - 1] };
}
function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return a / 2; // > 0 = antihorario
}
function bbox(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// Desplaza un polígono cerrado antihorario hacia afuera con un margen distinto por arista
// (offsets[i] = margen de la arista que sale del vértice i). Esquinas en inglete con límite.
function offsetPolygon(poly, offsets) {
  const n = poly.length;
  const dirs = [];
  const nors = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const d = norm(sub(b, a));
    dirs.push(d);
    nors.push(P(d.y, -d.x)); // normal exterior (a la derecha en sentido antihorario)
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const ip = (i - 1 + n) % n;
    const p = poly[i];
    const o0 = offsets[ip];
    const o1 = offsets[i];
    const p0 = add(p, mul(nors[ip], o0));
    const p1 = add(p, mul(nors[i], o1));
    const d0 = dirs[ip];
    const d1 = dirs[i];
    const cross = d0.x * d1.y - d0.y * d1.x;
    if (Math.abs(cross) < 1e-4) {
      out.push(o0 === o1 ? p1 : p0, ...(o0 === o1 ? [] : [p1]));
      continue;
    }
    // intersección de p0 + d0 t con p1 + d1 s
    const w = sub(p1, p0);
    const t = (w.x * d1.y - w.y * d1.x) / cross;
    const q = add(p0, mul(d0, t));
    const lim = 3 * Math.max(o0, o1);
    if (len(sub(q, p)) > lim) out.push(p0, p1);
    else out.push(q);
  }
  return removeLoops(out);
}

// Quita los "rulos" locales que deja el desplazamiento en esquinas cóncavas (punta del escote en V).
function removeLoops(poly, span = 40) {
  let pts = poly.slice();
  for (let guard = 0; guard < 20; guard++) {
    let fixed = false;
    const n = pts.length;
    for (let i = 0; i < n && !fixed; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      for (let k = 2; k < Math.min(span, n - 2); k++) {
        const j = (i + k) % n;
        const c = pts[j];
        const d = pts[(j + 1) % n];
        const r = segIntersect(a, b, c, d);
        if (!r) continue;
        // reemplaza los vértices i+1..j por el punto de cruce
        const out = [];
        for (let m = 0; m < n; m++) {
          const rel = (m - i - 1 + n) % n;
          if (rel < k) {
            if (rel === 0) out.push(r);
            continue;
          }
          out.push(pts[m]);
        }
        pts = out;
        fixed = true;
        break;
      }
    }
    if (!fixed) break;
  }
  return pts;
}
function segIntersect(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(c, a);
  const t = (w.x * s.y - w.y * s.x) / den;
  const u = (w.x * r.y - w.y * r.x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return add(a, mul(r, t));
}

// Longitud de media copa de manga (de la sisa al pico) para un alto `h` y medio ancho `hw`.
function capHalf(hw, h, n = 24) {
  return bezier(P(-hw, -h), P(-hw + hw * 0.42, -h + h * 0.04), P(-hw * 0.42, 0), P(0, 0), n);
}

// ---------- molde ----------
export function createPattern(opts = {}) {
  const size = sizeById(opts.size) || sizeById('M');
  const fit = fitById(opts.fit) || fitById('regular');
  const sleeve = sleeveById(opts.sleeve) || sleeveById('corta');
  const neck = neckById(opts.neck) || neckById('redondo');
  const o = { size: size.id, fit: fit.id, sleeve: sleeve.id, neck: neck.id };
  const sz = SIZES.indexOf(size) - 2; // talle relativo a M
  const hasSleeves = sleeve.id !== 'sin';
  const isV = neck.id === 'v';
  const drop = fit.dropShoulder;
  const oversize = fit.id === 'oversize';
  const slim = fit.id === 'slim';

  // --- medidas de la prenda terminada (cm) ---
  const chest = size.chest + fit.chestAdd; // ancho plano
  const length = size.length + fit.lengthAdd;
  const shoulder = size.shoulder + 2 * drop - (hasSleeves ? 0 : 3);
  const sleeveLength = hasSleeves ? sleeve.length * (1 + sz * 0.025) : 0;
  const neckWidth = 16.8 + sz * 0.4;
  const frontNeckDepth = isV ? 16 + sz * 0.4 : 8.5 + sz * 0.25;
  const backNeckDepth = 2 + sz * 0.1;
  const shoulderSlope = 4.5 + drop * 0.35;
  const armholeDepth = 24.5 + sz * 1.0 + (oversize ? 3.5 : slim ? -0.5 : 0) + (hasSleeves ? 0 : 2);

  // --- puntos clave (lado derecho, metros) ---
  const nw = (neckWidth / 2) * CM;
  const HPS = P(nw, 0);
  const SP = P((shoulder / 2) * CM, -shoulderSlope * CM);
  const UA = P((chest / 2) * CM, -armholeDepth * CM);
  const L = length * CM;
  const hw = UA.x + (slim ? -0.008 : oversize ? -0.004 : 0.002);
  const HEM = P(hw, -L);
  const fnd = frontNeckDepth * CM;
  const bnd = backNeckDepth * CM;

  // Dirección perpendicular al hombro (escote y sisa salen a escuadra del hombro).
  const shDir = norm(sub(SP, HPS));
  const perpDown = P(shDir.y, -shDir.x); // apunta hacia abajo y hacia el centro

  // Escotes (mitad derecha, del HPS al centro).
  const frontNeckR = isV
    ? bezier(HPS, add(HPS, mul(perpDown, fnd * 0.25)), P(nw * 0.2, -fnd * 0.8), P(0, -fnd), 40)
    : bezier(HPS, add(HPS, mul(perpDown, fnd * 0.55)), P(nw * 0.55, -fnd), P(0, -fnd), 40);
  const backNeckR = bezier(HPS, add(HPS, mul(perpDown, Math.max(bnd * 0.6, 0.008))), P(nw * 0.6, -bnd), P(0, -bnd), 32);
  const shoulderR = line(HPS, SP, 12);

  // Sisa (del hombro a la axila): curva en "J", sale a escuadra del hombro y llega horizontal a la axila.
  const ahDepth = SP.y - UA.y;
  const armholeR = hasSleeves
    ? bezier(SP, add(SP, mul(perpDown, ahDepth * 0.36)), P(UA.x - ahDepth * 0.3, UA.y + ahDepth * 0.02), UA, 40)
    : bezier(SP, add(SP, mul(perpDown, ahDepth * 0.42)), P(UA.x - ahDepth * 0.42, UA.y + ahDepth * 0.03), UA, 40);

  // Costado: de la axila al ruedo, con un leve entalle.
  const waistIn = slim ? 0.012 : oversize ? 0 : 0.004;
  const sideR = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    sideR.push(P(lerp(UA.x, HEM.x, t) - waistIn * Math.sin(Math.PI * Math.min(1, t * 1.15)), lerp(UA.y, HEM.y, t)));
  }
  // Ruedo: recto con una caída mínima al centro.
  const hemPts = [];
  for (let i = 0; i <= 32; i++) {
    const x = lerp(-hw, hw, i / 32);
    hemPts.push(P(x, -L - 0.003 * (1 - (x / hw) ** 2)));
  }

  // --- mangas de la silueta 3D (mitad derecha) ---
  let sleeveTopR = null;
  let sleeveBotR = null;
  let cuffR = null;
  let sleeveInfo = null;
  if (hasSleeves) {
    const Ls = sleeveLength * CM;
    const isLong = sleeve.id === 'larga';
    const a1 = isLong ? 43 : 27; // ángulo hacia abajo al salir del hombro
    const a2 = isLong ? 54 : 29; // ángulo al llegar al puño
    const d1 = dirAngle(a1);
    const d2 = dirAngle(a2);
    const ctrl = add(SP, mul(d1, Ls * 0.5));
    const CT = add(ctrl, mul(d2, Ls * 0.5));
    const cuffPerp = P(d2.y, -d2.x); // perpendicular al eje, hacia el lado de abajo
    const chord = sub(UA, SP);
    const startPerp = P(d1.y, -d1.x);
    const w0 = Math.abs(chord.x * startPerp.x + chord.y * startPerp.y); // ancho de manga al salir de la sisa
    const wc = isLong ? Math.max(0.088 + sz * 0.003, w0 * 0.64) : w0 * 0.9;
    const CB = add(CT, mul(cuffPerp, wc));
    const offA = sub(UA, SP);
    const offB = sub(CB, CT);
    const ctrlB = add(ctrl, mul(add(offA, offB), 0.5));
    sleeveTopR = quad(SP, ctrl, CT, isLong ? 30 : 12);
    sleeveBotR = quad(UA, ctrlB, CB, isLong ? 30 : 12);
    cuffR = line(CT, CB, 10);
    sleeveInfo = { CT, CB, w0, wc };
  }

  // --- silueta (frente y espalda) ---
  const buildPanel = (neckR) => {
    const cuello = join(neckR, rev(mirror(neckR)).slice(1)); // HPS der → centro → HPS izq
    const segs = [{ name: 'cuello', type: 'open', points: cuello }];
    segs.push({ name: 'hombroIzq', type: 'seam', points: mirror(shoulderR) });
    if (hasSleeves) {
      segs.push({ name: 'mangaArribaIzq', type: 'seam', points: mirror(sleeveTopR) });
      segs.push({ name: 'punoIzq', type: 'open', points: mirror(cuffR) });
      segs.push({ name: 'mangaAbajoIzq', type: 'seam', points: rev(mirror(sleeveBotR)) });
    } else {
      segs.push({ name: 'sisaIzq', type: 'open', points: mirror(armholeR) });
    }
    segs.push({ name: 'costadoIzq', type: 'seam', points: mirror(sideR) });
    segs.push({ name: 'ruedo', type: 'open', points: hemPts.map((p) => ({ ...p })) });
    segs.push({ name: 'costadoDer', type: 'seam', points: rev(sideR) });
    if (hasSleeves) {
      segs.push({ name: 'mangaAbajoDer', type: 'seam', points: sleeveBotR.map((p) => ({ ...p })) });
      segs.push({ name: 'punoDer', type: 'open', points: rev(cuffR) });
      segs.push({ name: 'mangaArribaDer', type: 'seam', points: rev(sleeveTopR) });
    } else {
      segs.push({ name: 'sisaDer', type: 'open', points: rev(armholeR) });
    }
    segs.push({ name: 'hombroDer', type: 'seam', points: rev(shoulderR) });
    const outline = join(...segs.map((s) => s.points));
    outline.pop(); // el último punto repite el primero
    const armholes = hasSleeves ? [mirror(armholeR), armholeR.map((p) => ({ ...p }))] : [];
    return { outline, segments: segs, armholes };
  };
  const front = buildPanel(frontNeckR);
  const back = buildPanel(backNeckR);

  // --- líneas de costura visibles ---
  const tag = (pts, side) => {
    pts.side = side;
    return pts;
  };
  const sideAtY = (y) => {
    // x del costado derecho a una altura y
    for (let i = 1; i < sideR.length; i++) {
      const a = sideR[i - 1];
      const b = sideR[i];
      if ((a.y - y) * (b.y - y) <= 0) return lerp(a.x, b.x, (y - a.y) / (b.y - a.y || 1));
    }
    return hw;
  };
  const hemLine = (dy) => {
    const y = -L + dy;
    const xs = sideAtY(y);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = lerp(-xs, xs, i / 24);
      pts.push(P(x, y - 0.003 * (1 - (x / hw) ** 2)));
    }
    return pts;
  };
  const seamLines = {
    hombros: [tag(mirror(shoulderR), 'ambos'), tag(shoulderR.map((p) => ({ ...p })), 'ambos')],
    mangas: hasSleeves ? [tag(mirror(armholeR), 'ambos'), tag(armholeR.map((p) => ({ ...p })), 'ambos')] : [],
    sisas: hasSleeves ? [] : [tag(mirror(armholeR), 'ambos'), tag(armholeR.map((p) => ({ ...p })), 'ambos')],
    costados: hasSleeves
      ? [tag(mirror(join(rev(sleeveBotR), sideR)), 'ambos'), tag(join(rev(sleeveBotR), sideR), 'ambos')]
      : [tag(mirror(sideR), 'ambos'), tag(sideR.map((p) => ({ ...p })), 'ambos')],
    cuello: [tag(front.segments[0].points.map((p) => ({ ...p })), 'frente'), tag(back.segments[0].points.map((p) => ({ ...p })), 'espalda')],
    punos: [],
    ruedo: [tag(hemLine(0.02), 'ambos')],
  };
  if (hasSleeves) {
    const a = pointAt(rev(sleeveTopR), 0.02);
    const b = pointAt(rev(sleeveBotR), 0.02);
    seamLines.punos = [tag(mirror(line(a, b, 10)), 'ambos'), tag(line(a, b, 10), 'ambos')];
  }

  // --- longitudes ---
  const armholeLen = polylineLength(armholeR) * 2; // contorno completo de sisa (frente + espalda)
  const neckLen = polylineLength(front.segments[0].points) + polylineLength(back.segments[0].points);

  // --- piezas de corte ---
  const pieces = [];
  const pushPiece = (id, name, seamPoly, allowances, notchesSeam, colorIdx) => {
    // (las piezas se arman siempre en sentido antihorario)
    if (signedArea(seamPoly) < 0) console.warn('pattern: pieza en sentido horario', id);
    const cut = offsetPolygon(seamPoly, allowances);
    const bb = bbox(cut);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const c = (p) => P(p.x - cx, p.y - cy);
    pieces.push({
      id,
      name,
      count: 1,
      outline: cut.map(c),
      seamLine: seamPoly.map(c),
      width: bb.maxX - bb.minX,
      height: bb.maxY - bb.minY,
      grain: 'y',
      notches: notchesSeam.map(c),
      color: PIECE_COLORS[colorIdx % PIECE_COLORS.length],
    });
  };

  // Frente / espalda: contorno del cuerpo sin mangas (sentido antihorario desde el HPS derecho).
  const bodyPiece = (neckR, id, name, colorIdx, isBack) => {
    const spans = [
      { pts: join(neckR, rev(mirror(neckR)).slice(1)), sa: 1 * CM },
      { pts: mirror(shoulderR), sa: 1 * CM },
      { pts: mirror(armholeR), sa: 1 * CM },
      { pts: mirror(sideR), sa: 1 * CM },
      { pts: hemPts, sa: 2.5 * CM },
      { pts: rev(sideR), sa: 1 * CM },
      { pts: rev(armholeR), sa: 1 * CM },
      { pts: rev(shoulderR), sa: 1 * CM },
    ];
    const poly = [];
    const sas = [];
    for (const s of spans) {
      const pts = resampleN(s.pts, Math.max(2, Math.ceil(polylineLength(s.pts) / 0.006)));
      for (let i = 0; i < pts.length - 1; i++) {
        poly.push(pts[i]);
        sas.push(s.sa);
      }
    }
    // piquetes: centro de escote, centro de ruedo, sisa (1 frente / 2 espalda)
    const notches = [];
    const outward = (p, d) => notches.push(P(p.x + d.x, p.y + d.y));
    outward(P(0, isBack ? -bnd : -fnd), P(0, 1 * CM));
    outward(P(0, -L - 0.003), P(0, -2.5 * CM));
    const ahMid = pointAt(armholeR, polylineLength(armholeR) * 0.5);
    for (const sx of [-1, 1]) {
      if (isBack) {
        const a = pointAt(armholeR, polylineLength(armholeR) * 0.46);
        const b = pointAt(armholeR, polylineLength(armholeR) * 0.54);
        outward(P(a.x * sx, a.y), P(sx * CM, 0));
        outward(P(b.x * sx, b.y), P(sx * CM, 0));
      } else outward(P(ahMid.x * sx, ahMid.y), P(sx * CM, 0));
    }
    pushPiece(id, name, poly, sas, notches, colorIdx);
  };
  bodyPiece(frontNeckR, 'frente', 'Frente', 0, false);
  bodyPiece(backNeckR, 'espalda', 'Espalda', 1, true);

  let bicep = 0;
  let cuffW = 0;
  let capHeight = 0;
  if (hasSleeves) {
    // Manga de corte: copa curva cuyo contorno coincide con la sisa (+ 0.8 cm de embebido).
    bicep = (chest * 2 * 0.3 + 5 + (oversize ? 3 : 0)) * CM;
    const Ls = sleeveLength * CM;
    const target = armholeLen / 2 + 0.004;
    let lo = 0.02;
    let hi = 0.2;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (polylineLength(capHalf(bicep / 2, mid)) < target) lo = mid;
      else hi = mid;
    }
    capHeight = clamp((lo + hi) / 2, 0.035, Math.min(0.16, Ls * 0.75));
    cuffW = sleeve.id === 'larga' ? (20.5 + sz * 1.0) * CM : bicep - 4 * CM;
    const half = capHalf(bicep / 2, capHeight, 28);
    const capPts = join(half, rev(mirror(half)).slice(1)); // de axila izq a axila der pasando por el pico
    const UL = P(-bicep / 2, -capHeight);
    const URp = P(bicep / 2, -capHeight);
    const CL = P(-cuffW / 2, -Ls);
    const CR = P(cuffW / 2, -Ls);
    // antihorario: pico → axila izq → puño izq → puño der → axila der → pico
    const spans = [
      { pts: rev(capPts.slice(0, Math.ceil(capPts.length / 2))), sa: 1 * CM },
      { pts: line(UL, CL, 4), sa: 1 * CM },
      { pts: line(CL, CR, 8), sa: 2.5 * CM },
      { pts: line(CR, URp, 4), sa: 1 * CM },
      { pts: rev(capPts.slice(Math.floor(capPts.length / 2))), sa: 1 * CM },
    ];
    const poly = [];
    const sas = [];
    for (const s of spans) {
      const pts = resampleN(s.pts, Math.max(2, Math.ceil(polylineLength(s.pts) / 0.006)));
      for (let i = 0; i < pts.length - 1; i++) {
        poly.push(pts[i]);
        sas.push(s.sa);
      }
    }
    const capQuarter = pointAt(half, polylineLength(half) * 0.5);
    const notchSet = (flip) => {
      const n = [P(0, 1 * CM)]; // pico de copa (va con la costura de hombro)
      const f = P(capQuarter.x * flip, capQuarter.y + 0.6 * CM);
      n.push(f); // delantero: un piquete
      const b1 = P(-capQuarter.x * flip - 0.004 * flip, capQuarter.y + 0.6 * CM);
      const b2 = P(-capQuarter.x * flip + 0.004 * flip, capQuarter.y + 0.6 * CM);
      n.push(b1, b2); // trasero: doble piquete
      return n;
    };
    pushPiece('manga_izq', 'Manga izquierda', poly.map((p) => ({ ...p })), sas.slice(), notchSet(1), 2);
    pushPiece('manga_der', 'Manga derecha', poly.map((p) => ({ ...p })), sas.slice(), notchSet(-1), 3);
  }

  // Cuello de ribb: rectángulo de ~85% del contorno de escote × 4 cm.
  {
    const w = neckLen * 0.85;
    const h = 4 * CM;
    const cut = [P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)];
    const seam = [P(-w / 2 + CM, -h / 2 + 0.5 * CM), P(w / 2 - CM, -h / 2 + 0.5 * CM), P(w / 2 - CM, h / 2 - 0.5 * CM), P(-w / 2 + CM, h / 2 - 0.5 * CM)];
    pieces.push({
      id: 'cuello',
      name: 'Cuello (ribb)',
      count: 1,
      outline: cut,
      seamLine: seam,
      width: w,
      height: h,
      grain: 'y',
      notches: [P(0, -h / 2), P(-w / 4, -h / 2), P(w / 4, -h / 2)],
      color: PIECE_COLORS[4],
    });
  }
  if (!hasSleeves) {
    const w = armholeLen * 0.92;
    const h = 3 * CM;
    for (const [id, name, ci] of [
      ['ribete_sisa_izq', 'Ribete de sisa izq.', 5],
      ['ribete_sisa_der', 'Ribete de sisa der.', 2],
    ]) {
      pieces.push({
        id,
        name,
        count: 1,
        outline: [P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)],
        seamLine: [P(-w / 2 + CM, -h / 2 + 0.5 * CM), P(w / 2 - CM, -h / 2 + 0.5 * CM), P(w / 2 - CM, h / 2 - 0.5 * CM), P(-w / 2 + CM, h / 2 - 0.5 * CM)],
        width: w,
        height: h,
        grain: 'y',
        notches: [P(0, -h / 2)],
        color: PIECE_COLORS[ci],
      });
    }
  }

  // --- zona estampable recomendada ---
  const pxw = Math.max(0.12, UA.x - 0.075);
  const printArea = {
    frente: { minX: -pxw, maxX: pxw, minY: -L + 0.09, maxY: -fnd - 0.035 },
    espalda: { minX: -pxw, maxX: pxw, minY: -L + 0.09, maxY: -bnd - 0.06 },
  };

  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    key: `${o.size}-${o.fit}-${o.sleeve}-${o.neck}`,
    opts: o,
    measurements: {
      chest: r1(chest),
      length: r1(length),
      shoulder: r1(shoulder),
      sleeveLength: r1(sleeveLength),
      neckWidth: r1(neckWidth),
      frontNeckDepth: r1(frontNeckDepth),
      backNeckDepth: r1(backNeckDepth),
      armhole: r1(armholeLen / CM),
      // extras útiles
      armholeDepth: r1(armholeDepth),
      bicep: r1(bicep / CM),
      cuff: r1(cuffW / CM),
      capHeight: r1(capHeight / CM),
      neckline: r1(neckLen / CM),
      hemWidth: r1((hw * 2) / CM),
    },
    silhouette: { front, back },
    seamLines,
    pieces,
    printArea,
    // Puntos de construcción (lado derecho) para la remera 3D.
    construction: { HPS, SP, UA, HEM, L, hw, fnd, bnd, hasSleeves, isV, sleeve: sleeveInfo, sleeveId: sleeve.id },
  };
}
