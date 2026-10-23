// Mesa de doblado: simulación de papel plegado en SVG. La remera (boca abajo) es una pila de
// capas poligonales; cada doblez corta las capas con un semiplano, refleja la parte que se
// dobla y la apila encima, con una animación de "volteo" (escala perpendicular al pliegue).
// Al final se da vuelta el paquete (se ve el frente con la estampa) y se embolsa.

import { clamp, easeInOutCubic, easeOutBack, mixHex } from '../../core/utils.js';

const NS = 'http://www.w3.org/2000/svg';
let arcSeq = 0;
const MM = 1000; // metros → milímetros (unidades del SVG)

// ---------- geometría 2D ----------
const side = (L, p) => L.nx * (p[0] - L.px) + L.ny * (p[1] - L.py); // > 0 = lado que se dobla
function clipPoly(pts, L, keepFold) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sa = side(L, a) * (keepFold ? 1 : -1);
    const sb = side(L, b) * (keepFold ? 1 : -1);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 && Math.abs(area(out)) > 4 ? out : null;
}
function clipLine(pts, L, keepFold) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const sa = side(L, a) * (keepFold ? 1 : -1);
    if (i > 0) {
      const b = pts[i - 1];
      const sb = side(L, b) * (keepFold ? 1 : -1);
      if ((sa >= 0) !== (sb >= 0)) {
        const t = sb / (sb - sa);
        const q = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t];
        cur.push(q);
        if (sb >= 0) {
          if (cur.length > 1) runs.push(cur);
          cur = [];
        } else cur = [q];
      }
    }
    if (sa >= 0) cur.push(a);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}
const reflectPt = (L, p) => {
  const d = side(L, p);
  return [p[0] - 2 * d * L.nx, p[1] - 2 * d * L.ny];
};
function area(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return a / 2;
}
const pathD = (pts, closed = true) => `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}${closed ? ' Z' : ''}`;
// línea de pliegue por dos puntos; `away` = punto que queda en el lado fijo
function lineThrough(a, b, away) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  let nx = -dy / l;
  let ny = dx / l;
  const L = { px: a[0], py: a[1], nx, ny };
  if (side(L, away) > 0) {
    L.nx = -nx;
    L.ny = -ny;
  }
  return L;
}
// reflejo respecto de la recta L compuesto con la afín m (formato SVG: a b c d e f)
function composeReflect(L, m) {
  const { nx, ny, px, py } = L;
  const r = [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny];
  const k = 2 * (nx * px + ny * py);
  const tx = k * nx;
  const ty = k * ny;
  const [a, b, c, d, e, f] = m;
  // R·M: columnas (a,b) y (c,d); traslación R·(e,f) + t
  return [r[0] * a + r[2] * b, r[1] * a + r[3] * b, r[0] * c + r[2] * d, r[1] * c + r[3] * d, r[0] * e + r[2] * f + tx, r[1] * e + r[3] * f + ty];
}
let clipSeq = 0;
const el = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

// ---------------------------------------------------------------------------
export function createFoldTable(opts) {
  const { pattern, fabricColor, swatch, printURL, printPlacement, printSide, brand, h, isMobile } = opts;
  const c = pattern.construction;
  const sil = pattern.silhouette;
  const toS = (p) => [p.x * MM, -p.y * MM];
  const back = sil.back.outline.map(toS);
  const front = sil.front.outline.map(toS);
  const L = c.L * MM;
  const xs = clamp(0.118 + (c.hw - 0.26) * 0.45, 0.1, 0.15) * MM;
  // doblez a la mitad: si hay estampa en el frente, lo bastante abajo como para que se vea entera
  let yhM = c.L * 0.5;
  if (printURL && printSide !== 'espalda' && printPlacement) {
    const ph = printPlacement.width / (printPlacement.aspect || 1);
    const bottom = -printPlacement.y + ph / 2;
    yhM = clamp(Math.max(c.L * 0.5, bottom + 0.025), c.L * 0.45, c.L * 0.62);
  }
  const yh = (yhM * MM) | 0;
  const inner = mixHex(fabricColor, '#000000', 0.32);
  const edge = mixHex(fabricColor, '#000000', 0.28);
  const stitch = mixHex(fabricColor, '#000000', 0.42);
  const lightFab = (() => {
    const h6 = fabricColor.replace('#', '');
    const r = parseInt(h6.slice(0, 2), 16);
    const g = parseInt(h6.slice(2, 4), 16);
    const b = parseInt(h6.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
  })();

  // ---------- decoración (costuras y cuello) de la espalda ----------
  const decor = [];
  const sl = pattern.seamLines;
  const addLines = (list, kind) => {
    for (const ln of list || []) if (ln.side !== 'frente' && ln.length > 1) decor.push({ kind, pts: ln.map(toS) });
  };
  addLines(sl.ruedo, 'stitch');
  for (const ln of sl.ruedo || []) decor.push({ kind: 'stitch', pts: ln.map((p) => [p.x * MM, -(p.y + 0.007) * MM]) });
  addLines(sl.punos, 'stitch');
  addLines(sl.hombros, 'seam');
  addLines(sl.costados, 'seam');
  addLines(sl.mangas, 'seam');
  addLines(sl.sisas, 'stitch');
  // boca abajo se ve la espalda: solo su escote (poco profundo) con el ribb; el escote del
  // frente queda tapado debajo. (Boca arriba, en frontPacket, sí se ve el revés de la espalda.)
  const neckBack = sil.back.segments.find((s) => s.name === 'cuello')?.points.map(toS) || [];
  const neckFront = sil.front.segments.find((s) => s.name === 'cuello')?.points.map(toS) || [];
  if (neckBack.length > 2) {
    decor.push({ kind: 'rib', pts: neckBack });
    decor.push({ kind: 'stitch', pts: neckBack.map((p) => [p[0], p[1] + 9]) });
  }

  // cada capa guarda `m`: la transformación afín (a b c d e f) que lleva el dibujo original de
  // la espalda a su lugar actual (se compone con cada reflejo), para ubicar la estampa de la espalda
  const ID = [1, 0, 0, 1, 0, 0];
  let layers = [{ pts: back, face: 0, decor: decor.map((d) => ({ ...d })), m: ID }];

  // ---------- pliegues ----------
  const SP = [c.SP.x * MM, -c.SP.y * MM];
  const UA = [c.UA.x * MM, -c.UA.y * MM];
  const mid = [0, L * 0.5];
  const folds = {};
  if (c.hasSleeves) {
    folds.mangaIzq = { id: 'mangaIzq', name: 'Manga izquierda', line: lineThrough([-SP[0], SP[1]], [-UA[0], UA[1]], mid), group: 'manga', sideKey: 'izq' };
    folds.mangaDer = { id: 'mangaDer', name: 'Manga derecha', line: lineThrough([SP[0], SP[1]], [UA[0], UA[1]], mid), group: 'manga', sideKey: 'der' };
  }
  folds.costadoIzq = { id: 'costadoIzq', name: 'Costado izquierdo', line: lineThrough([-xs, 0], [-xs, 100], mid), group: 'costado', sideKey: 'izq' };
  folds.costadoDer = { id: 'costadoDer', name: 'Costado derecho', line: lineThrough([xs, 0], [xs, 100], mid), group: 'costado', sideKey: 'der' };
  folds.mitad = { id: 'mitad', name: 'A la mitad', line: lineThrough([-100, yh], [100, yh], [0, 0]), group: 'mitad' };
  const done = new Set();

  // posición de los botones-flecha sobre cada parte
  const hot = {};
  const sleeveTip = c.sleeve ? [((c.sleeve.CT.x + c.sleeve.CB.x) / 2) * MM, -((c.sleeve.CT.y + c.sleeve.CB.y) / 2) * MM] : null;
  if (c.hasSleeves) {
    const sx = (SP[0] + UA[0]) / 2;
    const sy = (SP[1] + UA[1]) / 2;
    const t = 0.52;
    hot.mangaDer = { x: sx + (sleeveTip[0] - sx) * t, y: sy + (sleeveTip[1] - sy) * t, ang: Math.atan2(sy - sleeveTip[1], sx - sleeveTip[0]) };
    hot.mangaIzq = { x: -hot.mangaDer.x, y: hot.mangaDer.y, ang: Math.PI - hot.mangaDer.ang };
  }
  const hw = c.hw * MM;
  hot.costadoIzq = { x: -(xs + hw) / 2 - 6, y: L * 0.62, ang: 0 };
  hot.costadoDer = { x: (xs + hw) / 2 + 6, y: L * 0.62, ang: Math.PI };
  hot.mitad = { x: 0, y: L * 0.86, ang: -Math.PI / 2 };

  // ---------- DOM ----------
  const all = [...back, ...front];
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const pad = 70;
  const vb = [minX - pad, minY - pad - 10, maxX - minX + pad * 2, maxY - minY + pad * 2 + 10];
  const svg = el('svg', { class: 'term-fold-svg', viewBox: vb.join(' '), preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Remera para doblar' });
  // la vista se acerca a medida que la remera se achica
  const view = vb.slice();
  let viewTarget = vb.slice();
  function fitView() {
    const pts = layers.flatMap((l) => l.pts);
    if (!pts.length) return;
    let x0 = Math.min(...pts.map((p) => p[0]));
    let x1 = Math.max(...pts.map((p) => p[0]));
    let y0 = Math.min(...pts.map((p) => p[1]));
    let y1 = Math.max(...pts.map((p) => p[1]));
    if (packedView) {
      x0 = -xs - 60;
      x1 = xs + 110;
      y0 = -90;
      y1 = yh + 70;
    }
    const w = x1 - x0;
    const hh = y1 - y0;
    // margen generoso y nunca más chico que ~55 % del tamaño original (que no "salte")
    const m = Math.max(w, hh) * 0.08 + 24;
    let W = Math.max(w + m * 2, vb[2] * 0.5);
    let H = Math.max(hh + m * 2, vb[3] * 0.5);
    const asp = vb[2] / vb[3];
    if (W / H > asp) H = W / asp;
    else W = H * asp;
    viewTarget = [(x0 + x1) / 2 - W / 2, (y0 + y1) / 2 - H / 2, W, H];
  }
  let packedView = false;
  const defs = el('defs', {}, svg);
  // tejido de punto finito (columnas de mallas) sobre el color de la tela
  {
    const pat = el('pattern', { id: 'tf-fab', patternUnits: 'userSpaceOnUse', width: 6, height: 5 }, defs);
    el('rect', { width: 6, height: 5, fill: fabricColor }, pat);
    const knit = lightFab ? 'rgba(60,45,30,0.07)' : 'rgba(255,255,255,0.08)';
    el('path', { d: 'M0.4 0 L1.6 2.5 L0.4 5 M3.4 0 L4.6 2.5 L3.4 5', fill: 'none', stroke: knit, 'stroke-width': 0.8 }, pat);
    void swatch;
  }
  const lg = el('linearGradient', { id: 'tf-shade', x1: 0, y1: 0, x2: 0.35, y2: 1 }, defs);
  el('stop', { offset: 0, 'stop-color': '#ffffff', 'stop-opacity': 0.16 }, lg);
  el('stop', { offset: 0.55, 'stop-color': '#ffffff', 'stop-opacity': 0 }, lg);
  el('stop', { offset: 1, 'stop-color': '#000000', 'stop-opacity': 0.12 }, lg);
  const flt = el('filter', { id: 'tf-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  el('feDropShadow', { dx: 0, dy: 6, stdDeviation: 7, 'flood-color': '#2b2420', 'flood-opacity': 0.28 }, flt);
  const flt2 = el('filter', { id: 'tf-lift', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
  el('feDropShadow', { dx: 0, dy: 14, stdDeviation: 12, 'flood-color': '#2b2420', 'flood-opacity': 0.3 }, flt2);

  const root = el('g', { class: 'tf-root' }, svg);
  const packet = el('g', { class: 'tf-packet' }, root);
  const stackG = el('g', { class: 'tf-stack', filter: 'url(#tf-shadow)' }, packet);
  const animG = el('g', { class: 'tf-anim' }, packet);
  const previewG = el('g', { class: 'tf-preview' }, packet);
  const hotG = el('g', { class: 'tf-hots' }, root);
  const packG = el('g', { class: 'tf-pack' }, root);

  const fabFill = 'url(#tf-fab)';
  // estampa de la espalda: boca abajo es lo que se ve (x "vista desde atrás", como el dibujo)
  const backPrint = printURL && printSide === 'espalda' && printPlacement ? (() => {
    const pw = printPlacement.width * MM;
    const ph = pw / (printPlacement.aspect || 1);
    const cx = printPlacement.x * MM;
    const cy = -printPlacement.y * MM;
    return { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph, cx, cy, rot: -(printPlacement.rotation || 0) };
  })() : null;
  function drawLayer(parent, ly, { lift = false } = {}) {
    const g = el('g', { class: `tf-layer face-${ly.face}` }, parent);
    el('path', { d: pathD(ly.pts), fill: fabFill }, g);
    if (backPrint && ly.face === 0) {
      const id = `tf-lc-${++clipSeq}`;
      const cp = el('clipPath', { id }, g);
      el('path', { d: pathD(ly.pts) }, cp);
      const ig = el('g', { 'clip-path': `url(#${id})` }, g);
      const mg = el('g', { transform: `matrix(${(ly.m || ID).map((v) => +v.toFixed(5)).join(' ')})` }, ig);
      el('image', { href: printURL, x: backPrint.x, y: backPrint.y, width: backPrint.w, height: backPrint.h, preserveAspectRatio: 'xMidYMid meet', transform: `rotate(${backPrint.rot} ${backPrint.cx} ${backPrint.cy})` }, mg);
    }
    el('path', { d: pathD(ly.pts), fill: ly.face ? 'rgba(255,255,255,0.07)' : 'url(#tf-shade)' }, g);
    for (const d of ly.decor) {
      if (d.poly) el('path', { d: pathD(d.pts), fill: inner, opacity: 0.85 }, g);
      else if (d.kind === 'crease') {
        el('path', { d: pathD(d.pts, false), fill: 'none', stroke: '#2b2420', 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.13 }, g);
        el('path', { d: pathD(d.pts, false), fill: 'none', stroke: '#ffffff', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.28 }, g);
      } else if (d.kind === 'rib') el('path', { d: pathD(d.pts, false), fill: 'none', stroke: mixHex(fabricColor, '#000000', 0.1), 'stroke-width': 13, 'stroke-linecap': 'round', opacity: 0.9 }, g);
      else el('path', { d: pathD(d.pts, false), fill: 'none', stroke: d.kind === 'seam' ? edge : stitch, 'stroke-width': d.kind === 'seam' ? 1.6 : 1.3, 'stroke-dasharray': d.kind === 'stitch' ? '5 3.5' : null, opacity: 0.8 }, g);
    }
    el('path', { d: pathD(ly.pts), fill: 'none', stroke: edge, 'stroke-width': 1.8, 'stroke-linejoin': 'round', opacity: 0.85 }, g);
    if (lift) g.setAttribute('filter', 'url(#tf-lift)');
    return g;
  }
  function redraw() {
    stackG.replaceChildren();
    for (const ly of layers) drawLayer(stackG, ly);
  }
  redraw();

  // botones de flecha
  const hotEls = {};
  for (const [id, p] of Object.entries(hot)) {
    if (!folds[id]) continue;
    const g = el('g', { class: 'tf-hot', transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: 0, role: 'button', 'aria-label': `Doblar: ${folds[id].name}` }, hotG);
    const inner2 = el('g', { class: 'tf-hot-in' }, g);
    el('circle', { r: 30, class: 'tf-hot-bg' }, inner2);
    const a = (p.ang * 180) / Math.PI;
    el('path', { d: 'M-13 0 H10 M2 -9 L12 0 L2 9', class: 'tf-hot-arrow', transform: `rotate(${a.toFixed(1)})` }, inner2);
    g.addEventListener('pointerenter', () => preview(id));
    g.addEventListener('pointerleave', () => preview(null));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      api.request(id);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        api.request(id);
      }
    });
    hotEls[id] = g;
  }

  function preview(id) {
    previewG.replaceChildren();
    if (!id || busy || done.has(id)) return;
    const Lf = folds[id].line;
    for (const ly of layers) {
      const part = clipPoly(ly.pts, Lf, true);
      if (part) el('path', { d: pathD(part), class: 'tf-prev' }, previewG);
    }
    const ext = 2000;
    const ax = Lf.px - Lf.ny * ext;
    const ay = Lf.py + Lf.nx * ext;
    const bx = Lf.px + Lf.ny * ext;
    const by = Lf.py - Lf.nx * ext;
    el('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'tf-prev-line' }, previewG);
  }

  // ---------- animación ----------
  let busy = false;
  let anim = null; // { kind, t, dur, ... }
  const queue = [];

  function startFold(id) {
    const f = folds[id];
    const Lf = f.line;
    const keep = [];
    const moving = [];
    for (const ly of layers) {
      const k = clipPoly(ly.pts, Lf, false);
      const m = clipPoly(ly.pts, Lf, true);
      const dk = [];
      const dm = [];
      for (const d of ly.decor) {
        if (d.poly) {
          const a = clipPoly(d.pts, Lf, false);
          const b = clipPoly(d.pts, Lf, true);
          if (a) dk.push({ ...d, pts: a });
          if (b) dm.push({ ...d, pts: b });
        } else {
          for (const r of clipLine(d.pts, Lf, false)) dk.push({ ...d, pts: r });
          for (const r of clipLine(d.pts, Lf, true)) dm.push({ ...d, pts: r });
        }
      }
      if (k) keep.push({ pts: k, face: ly.face, decor: dk, m: ly.m });
      if (m) moving.push({ pts: m, face: ly.face, decor: dm, m: ly.m });
    }
    if (!moving.length) return false;
    layers = keep;
    redraw();
    previewG.replaceChildren();
    anim = { kind: 'fold', id, Lf, moving, t: 0, dur: 0.62, g: null, face: null };
    busy = true;
    return true;
  }

  function commitFold(a) {
    const flipped = a.moving
      .slice()
      .reverse()
      .map((ly) => {
        const pts = ly.pts.map((p) => reflectPt(a.Lf, p)).reverse();
        const decor = ly.decor.map((d) => ({ ...d, pts: d.pts.map((p) => reflectPt(a.Lf, p)) }));
        // pliegue: los bordes de la capa que quedaron sobre la línea de doblez
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[(i + 1) % pts.length];
          if (Math.abs(side(a.Lf, p)) < 0.6 && Math.abs(side(a.Lf, q)) < 0.6 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 8) decor.push({ kind: 'crease', pts: [p, q] });
        }
        return { pts, face: 1 - ly.face, decor, m: composeReflect(a.Lf, ly.m) };
      });
    layers = layers.concat(flipped);
    animG.replaceChildren();
    redraw();
    done.add(a.id);
    hotEls[a.id]?.classList.add('done');
    if (Object.keys(folds).every((k) => done.has(k))) fitView();
  }

  // dibuja las capas en movimiento con la transformación del volteo (s = 1 → −1)
  function drawMoving(a, s) {
    animG.replaceChildren();
    const { nx, ny, px, py } = a.Lf;
    const k = s - 1;
    const A = 1 + k * nx * nx;
    const B = k * nx * ny;
    const D = 1 + k * ny * ny;
    const e = px - (A * px + B * py);
    const f = py - (B * px + D * py);
    const g = el('g', { transform: `matrix(${A} ${B} ${B} ${D} ${e} ${f})` }, animG);
    const showBack = s < 0;
    const list = showBack ? a.moving.slice().reverse() : a.moving;
    for (const ly of list) drawLayer(g, { ...ly, face: showBack ? 1 - ly.face : ly.face }, { lift: true });
    // oscurecido cuando la tela queda de canto
    const shade = (1 - Math.abs(s)) * 0.32;
    if (shade > 0.01) for (const ly of a.moving) el('path', { d: pathD(ly.pts), fill: '#2b2420', opacity: shade.toFixed(3) }, g);
  }

  // ---------- paquete final: dar vuelta y embolsar ----------
  let packaging = 'bolsa';
  let hangtag = true;
  let flipped = false;
  let packed = false;
  const frontPacket = () => {
    const g = el('g', { class: 'tf-front' });
    const rect = [
      [-xs, -40],
      [xs, -40],
      [xs, yh],
      [-xs, yh],
    ];
    const clipId = 'tf-clip-front';
    const cp = el('clipPath', { id: clipId }, g);
    el('path', { d: pathD(rect) }, cp);
    const body = el('g', { 'clip-path': `url(#${clipId})` }, g);
    el('path', { d: pathD(front), fill: fabFill }, body);
    el('path', { d: pathD(front), fill: 'url(#tf-shade)' }, body);
    if (neckFront.length > 2 && neckBack.length > 2) {
      el('path', { d: pathD([...neckFront, ...neckBack.slice().reverse()]), fill: inner, opacity: 0.9 }, body);
      el('path', { d: pathD(neckFront, false), fill: 'none', stroke: mixHex(fabricColor, '#000000', 0.1), 'stroke-width': 13, 'stroke-linecap': 'round' }, body);
      el('path', { d: pathD(neckFront.map((p) => [p[0], p[1] + 9]), false), fill: 'none', stroke: stitch, 'stroke-width': 1.2, 'stroke-dasharray': '5 3.5', opacity: 0.7 }, body);
    }
    if (printURL && printSide !== 'espalda' && printPlacement) {
      const pw = printPlacement.width * MM;
      const ph = pw / (printPlacement.aspect || 1);
      const cx = printPlacement.x * MM;
      const cy = -printPlacement.y * MM;
      el('image', { href: printURL, x: cx - pw / 2, y: cy - ph / 2, width: pw, height: ph, preserveAspectRatio: 'xMidYMid meet', transform: `rotate(${-(printPlacement.rotation || 0)} ${cx} ${cy})` }, body);
    }
    // pliegues de los costados y del doblez inferior
    el('path', { d: `M${-xs + 3} -10 V${yh - 3} M${xs - 3} -10 V${yh - 3} M${-xs + 4} ${yh - 3} H${xs - 4}`, fill: 'none', stroke: '#2b2420', 'stroke-opacity': 0.18, 'stroke-width': 5 }, body);
    el('path', { d: pathD(rect), fill: 'none', stroke: edge, 'stroke-width': 1.6, 'clip-path': null }, g);
    return g;
  };

  function packagingSVG(kind) {
    const g = el('g', { class: `tf-bag tf-bag-${kind}` });
    const pw = xs * 2 + 56;
    const top = -70;
    const ph = yh - top + 46;
    const x0 = -pw / 2;
    if (kind === 'bolsa') {
      el('rect', { x: x0, y: top, width: pw, height: ph, rx: 10, fill: 'rgba(221,236,214,0.42)', stroke: 'rgba(95,130,92,0.65)', 'stroke-width': 2.2 }, g);
      el('path', { d: `M${x0 + 18} ${top + 40} L${x0 + pw * 0.42} ${top + ph - 30}`, stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 16, 'stroke-linecap': 'round' }, g);
      el('rect', { x: x0, y: top, width: pw, height: 26, rx: 6, fill: 'rgba(160,190,150,0.7)' }, g);
      el('path', { d: `M${x0 + 10} ${top + 13} H${x0 + pw - 10}`, stroke: 'rgba(255,255,255,0.7)', 'stroke-width': 2, 'stroke-dasharray': '6 5' }, g);
      const t = el('text', { x: x0 + pw - 16, y: top + ph - 16, 'text-anchor': 'end', class: 'tf-bag-txt', fill: '#3f6a3d' }, g);
      t.textContent = '♻ 100 % compostable';
    } else if (kind === 'caja') {
      el('rect', { x: x0 - 8, y: top - 8, width: pw + 16, height: ph + 16, rx: 6, fill: '#c69a63', stroke: '#8a6236', 'stroke-width': 2.5 }, g);
      el('rect', { x: x0 + 6, y: top + 6, width: pw - 12, height: ph - 12, rx: 4, fill: 'none', stroke: '#a77b48', 'stroke-width': 2, 'stroke-dasharray': '2 6' }, g);
      el('path', { d: `M${x0 - 8} ${top + ph * 0.5} H${x0 + pw + 8}`, stroke: '#e8d4b4', 'stroke-width': 26, opacity: 0.55 }, g);
    } else {
      el('rect', { x: x0, y: top + 30, width: pw, height: ph - 30, rx: 5, fill: '#d9b98d', stroke: '#9b7447', 'stroke-width': 2 }, g);
      el('path', { d: `M${x0} ${top + ph} L0 ${top + ph * 0.55} L${x0 + pw} ${top + ph}`, fill: 'none', stroke: '#b38c5c', 'stroke-width': 2 }, g);
      const flap = el('path', { d: `M${x0} ${top + 30} L0 ${top + ph * 0.5} L${x0 + pw} ${top + 30} Z`, fill: '#cfa978', stroke: '#9b7447', 'stroke-width': 2, class: 'tf-flap' }, g);
      flap.dataset.top = String(top + 30);
    }
    // sticker con la marca
    const sx = kind === 'bolsa' ? x0 + 58 : 0;
    const sy = kind === 'sobre' ? top + ph * 0.5 : kind === 'caja' ? yh * 0.42 : top + 70;
    const st = el('g', { class: 'tf-sticker', transform: `translate(${sx} ${sy})` }, g);
    el('circle', { r: 44, fill: '#fffaf2', stroke: '#2b2420', 'stroke-width': 2.5 }, st);
    el('circle', { r: 37, fill: 'none', stroke: '#d2553f', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, st);
    const tx = el('text', { y: 6, 'text-anchor': 'middle', class: 'tf-sticker-txt' }, st);
    const b = (brand || 'Mi Taller').trim();
    tx.textContent = b.length > 12 ? b.slice(0, 11) + '…' : b;
    tx.setAttribute('font-size', String(Math.max(10, Math.min(19, 150 / Math.max(4, tx.textContent.length)))));
    // "HECHO A MANO" curvado por dentro del aro de abajo (que no choque con el borde)
    const arcId = `tf-arc-${++arcSeq}`;
    el('path', { id: arcId, d: 'M -30 2 A 30 30 0 0 0 30 2', fill: 'none' }, st);
    const t2 = el('text', { class: 'tf-sticker-sub', 'text-anchor': 'middle' }, st);
    const tp = el('textPath', { href: `#${arcId}`, startOffset: '50%' }, t2);
    tp.textContent = 'HECHO A MANO';
    return { g, top, ph, pw, x0, sticker: st };
  }

  function hangtagSVG(pk) {
    const g = el('g', { class: 'tf-tag' });
    const ax = pk.x0 + pk.pw - 26;
    const ay = pk.top + 22;
    el('circle', { cx: ax, cy: ay, r: 5, fill: '#2b2420' }, g);
    const sw = el('g', { transform: `translate(${ax} ${ay})` }, g);
    el('path', { d: 'M0 0 C 14 18, 26 30, 40 46', fill: 'none', stroke: '#2b2420', 'stroke-width': 2 }, sw);
    const card = el('g', { transform: 'translate(40 46) rotate(-18)' }, sw);
    el('rect', { x: -34, y: 0, width: 68, height: 108, rx: 8, fill: '#c9a26e', stroke: '#8c6a43', 'stroke-width': 2 }, card);
    el('circle', { cx: 0, cy: 14, r: 6, fill: '#efe6d6', stroke: '#8c6a43', 'stroke-width': 1.5 }, card);
    const t = el('text', { x: 0, y: 52, 'text-anchor': 'middle', class: 'tf-tag-txt' }, card);
    const b = (brand || 'Mi Taller').trim();
    t.textContent = b.length > 9 ? b.slice(0, 8) + '…' : b;
    const t3 = el('text', { x: 0, y: 72, 'text-anchor': 'middle', class: 'tf-tag-sub' }, card);
    t3.textContent = `TALLE ${pattern.opts?.size || ''}`;
    el('path', { d: 'M-22 84 H22', stroke: '#2b2420', 'stroke-width': 1.5 }, card);
    return { g, swing: sw };
  }

  // ---------- API ----------
  const wrap = h('div', { class: 'term-fold' }, h('div', { class: 'term-fold-card' }, h('div', { class: 'term-fold-head' }, h('b', {}, '🧺 Mesa de empaque'), h('span', { class: 'term-fold-msg' }, 'Boca abajo · tocá las flechas en orden')), svg));
  const msgEl = wrap.querySelector('.term-fold-msg');
  let errors = 0;
  let onChange = null;

  function ruleError(id) {
    const f = folds[id];
    const E = (short, long) => Object.assign(new String(long), { short, long });
    if (f.group === 'costado' && c.hasSleeves && !done.has(`manga${f.sideKey === 'izq' ? 'Izq' : 'Der'}`)) return E('✗ Primero la manga de ese lado', '✗ Primero la manga de ese lado: si doblás el costado con la manga suelta, queda un bulto y la manga se arruga.');
    if (f.group === 'mitad' && !(done.has('costadoIzq') && done.has('costadoDer'))) {
      if (c.hasSleeves && !(done.has('mangaIzq') && done.has('mangaDer'))) return E('✗ Todavía no: mangas → costados → mitad', '✗ Todavía no: primero las mangas hacia adentro, después los costados y recién al final, a la mitad.');
      return E('✗ Primero los dos costados', '✗ Antes de doblar a la mitad, llevá los dos costados al centro: así el paquete queda angosto y parejo.');
    }
    return null;
  }

  const api = {
    el: wrap,
    folds,
    get errors() {
      return errors;
    },
    get folded() {
      return Object.keys(folds).every((k) => done.has(k));
    },
    get packed() {
      return packed;
    },
    get busy() {
      return busy;
    },
    isDone: (id) => done.has(id),
    set onChange(fn) {
      onChange = fn;
    },
    message(txt, cls = '') {
      msgEl.textContent = txt;
      msgEl.className = `term-fold-msg ${cls}`;
    },
    order() {
      return c.hasSleeves ? ['mangaIzq', 'mangaDer', 'costadoIzq', 'costadoDer', 'mitad'] : ['costadoIzq', 'costadoDer', 'mitad'];
    },
    // pedido de doblez del jugador: valida el orden
    request(id) {
      if (!folds[id] || done.has(id) || packed) return { ok: false };
      if (busy) {
        if (!queue.includes(id)) queue.push(id);
        return { ok: true, queued: true };
      }
      const err = ruleError(id);
      if (err) {
        errors++;
        const he = hotEls[id];
        if (he) {
          he.classList.remove('shake');
          void he.getBoundingClientRect();
          he.classList.add('shake');
          clearTimeout(he._shakeT);
          he._shakeT = setTimeout(() => he.classList.remove('shake'), 650);
        }
        api.message(err.short, 'bad');
        onChange?.({ type: 'error', id, msg: err.long });
        return { ok: false, error: err.long };
      }
      startFold(id);
      api.message(`✓ ${folds[id].name}`, 'ok');
      onChange?.({ type: 'fold', id });
      return { ok: true };
    },
    setPackaging(id) {
      packaging = id;
    },
    setHangtag(on) {
      hangtag = !!on;
    },
    // al terminar los dobleces: dar vuelta + embolsar
    pack() {
      if (packed || !api.folded) return;
      busy = true;
      anim = { kind: 'flip', t: 0, dur: 0.8 };
    },
    // completa todo de una (modo automático o pruebas)
    finishInstant() {
      // si había un doblez animándose, se termina primero (antes se volvía a doblar la misma
      // parte y, sin capas que mover, commitFold recibía null)
      if (anim && anim.kind === 'fold') commitFold(anim);
      anim = null;
      busy = false;
      queue.length = 0;
      previewG.replaceChildren();
      animG.replaceChildren();
      for (const id of api.order()) {
        if (done.has(id)) continue;
        if (startFold(id)) commitFold(anim);
        else done.add(id);
        anim = null;
        busy = false;
      }
      hotG.replaceChildren();
      if (!packed) {
        flipped = true;
        packet.removeAttribute('transform');
        packet.replaceChildren(frontPacket());
        const pk = packagingSVG(packaging);
        packG.replaceChildren(pk.g);
        if (hangtag) packG.appendChild(hangtagSVG(pk).g);
        packed = true;
        hotG.replaceChildren();
        packedView = true;
        fitView();
        for (let i = 0; i < 4; i++) view[i] = viewTarget[i];
        svg.setAttribute('viewBox', view.join(' '));
        api.message(`¡Lista para entregar! ${packaging === 'caja' ? 'En su caja kraft' : packaging === 'sobre' ? 'En su sobre de papel' : 'En su bolsa compostable'}${hangtag ? ', con tag colgante' : ''}.`, 'ok');
      }
    },
    update(dt) {
      let moved = false;
      for (let i = 0; i < 4; i++) {
        const d = viewTarget[i] - view[i];
        if (Math.abs(d) > 0.3) {
          view[i] += d * clamp(dt * 3.2, 0, 1);
          moved = true;
        } else view[i] = viewTarget[i];
      }
      if (moved || svg.getAttribute('viewBox') !== view.join(' ')) svg.setAttribute('viewBox', view.map((v) => v.toFixed(1)).join(' '));
      if (!anim) {
        if (queue.length && !busy) api.request(queue.shift());
        return;
      }
      anim.t += dt;
      const k = clamp(anim.t / anim.dur);
      if (anim.kind === 'fold') {
        const s = Math.cos(Math.PI * easeInOutCubic(k));
        drawMoving(anim, s);
        if (k >= 1) {
          commitFold(anim);
          const id = anim.id;
          anim = null;
          busy = false;
          onChange?.({ type: 'folded', id });
          if (api.folded) {
            hotG.replaceChildren();
            api.message('¡Doblada! Ahora a darla vuelta y embolsarla.', 'ok');
            onChange?.({ type: 'allFolded' });
          }
        }
      } else if (anim.kind === 'flip') {
        const s = Math.cos(Math.PI * easeInOutCubic(k));
        packet.setAttribute('transform', `scale(${Math.max(0.001, Math.abs(s)).toFixed(4)} 1)`);
        if (s < 0 && !flipped) {
          flipped = true;
          packet.replaceChildren(frontPacket());
        }
        if (k >= 1) {
          packet.removeAttribute('transform');
          const pk = packagingSVG(packaging);
          packG.replaceChildren(pk.g);
          let tag = null;
          if (hangtag) {
            tag = hangtagSVG(pk);
            packG.appendChild(tag.g);
          }
          anim = { kind: 'bag', t: 0, dur: 1.15, pk, tag };
          packedView = true;
          fitView();
        }
      } else if (anim.kind === 'bag') {
        const { pk, tag } = anim;
        const kk = clamp(anim.t / 0.7);
        const e = 1 - Math.pow(1 - kk, 3);
        if (packaging === 'caja') {
          pk.g.setAttribute('transform', `translate(0 ${(-(1 - e) * 900).toFixed(1)})`);
          pk.g.setAttribute('opacity', String(clamp(kk * 3)));
        } else {
          pk.g.setAttribute('transform', `translate(0 ${((1 - e) * 900).toFixed(1)})`);
          if (packaging === 'sobre') {
            const flap = pk.g.querySelector('.tf-flap');
            const kf = clamp((anim.t - 0.7) / 0.4);
            const sy = -1 + 2 * easeInOutCubic(kf);
            const ty = +flap.dataset.top;
            flap.setAttribute('transform', `translate(0 ${ty}) scale(1 ${sy.toFixed(3)}) translate(0 ${-ty})`);
          }
        }
        const ks = clamp((anim.t - 0.75) / 0.4);
        pk.sticker.setAttribute('opacity', String(ks));
        const base = pk.sticker.getAttribute('transform').replace(/ scale\([^)]*\)/, '');
        pk.sticker.setAttribute('transform', `${base} scale(${(0.4 + 0.6 * easeOutBack(ks)).toFixed(3)})`);
        if (tag) {
          const kt = clamp((anim.t - 0.6) / 0.55);
          const ang = Math.sin(anim.t * 7) * 16 * (1 - kt) * kt * 2 + 0;
          tag.g.setAttribute('opacity', String(clamp(kt * 2)));
          const tr = tag.swing.getAttribute('transform').replace(/ rotate\([^)]*\)/, '');
          tag.swing.setAttribute('transform', `${tr} rotate(${ang.toFixed(2)})`);
        }
        if (anim.t >= anim.dur + 0.4) {
          if (tag) {
            const tr = tag.swing.getAttribute('transform').replace(/ rotate\([^)]*\)/, '');
            tag.swing.setAttribute('transform', tr);
          }
          anim = null;
          busy = false;
          packed = true;
          api.message(`¡Lista para entregar! ${packaging === 'caja' ? 'En su caja kraft' : packaging === 'sobre' ? 'En su sobre de papel' : 'En su bolsa compostable'}${hangtag ? ', con tag colgante' : ''}.`, 'ok');
          onChange?.({ type: 'packed' });
        }
      }
    },
    dispose() {
      wrap.remove();
    },
    // posición en pantalla del botón de un pliegue (para pruebas)
    hotRect(id) {
      const e = hotEls[id];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  };
  void isMobile;
  return api;
}
