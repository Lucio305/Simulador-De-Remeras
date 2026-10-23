// Vista de moldería en SVG: los moldes de papel madera (kraft) de `pattern.pieces` apoyados
// sobre una base de corte cuadriculada, con línea de corte, línea de costura punteada,
// flecha de hilo, piquetes, ojal para colgar, talle y texto escrito a mano.
// Unidades del SVG = centímetros (la grilla de la base de corte es de 1 cm).

import { rng, pointInPolygon, makeValueNoise, fbm } from '../../core/utils.js';

const NS = 'http://www.w3.org/2000/svg';
const CM = 100;

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const f1 = (v) => Math.round(v * 100) / 100;
const cmTxt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

// Polígono (metros, y arriba) → atributo d (cm, y abajo), desplazado a (ox, oy).
function pathD(pts, ox, oy, closed = true) {
  let d = '';
  pts.forEach((p, i) => {
    d += `${i ? 'L' : 'M'}${f1(ox + p.x * CM)} ${f1(oy - p.y * CM)}`;
  });
  return closed ? `${d}Z` : d;
}

// Nombre, texto de corte y si representa a dos piezas iguales (mangas, ribetes).
const INFO = {
  frente: { name: 'FRENTE', cut: 'Cortar 1' },
  espalda: { name: 'ESPALDA', cut: 'Cortar 1' },
  manga_izq: { name: 'MANGA', cut: 'Cortar 2 · en espejo', pair: 'manga_der' },
  manga_der: { name: 'MANGA', cut: 'Cortar 2 · en espejo', skip: true },
  cuello: { name: 'CUELLO', cut: 'Cortar 1 · ribb' },
  ribete_sisa_izq: { name: 'RIBETE DE SISA', cut: 'Cortar 2', pair: 'ribete_sisa_der' },
  ribete_sisa_der: { name: 'RIBETE DE SISA', cut: 'Cortar 2', skip: true },
};

export function pieceInfo(piece) {
  return INFO[piece.id] || { name: piece.name.toUpperCase(), cut: 'Cortar 1' };
}

// ---------- textura de papel madera (canvas 2D, se genera una sola vez) ----------
// Mosaico de 24 cm con manchas suaves, fibras claras y oscuras y motitas, sobre fondo
// transparente: se apoya encima del color base de cada molde.
let kraftURL = null;
function kraftTexture() {
  if (kraftURL) return kraftURL;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const noise = makeValueNoise(7, 8);
  const r = rng(11);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = fbm(noise, (x / N) * 8, (y / N) * 8, 3);
      const k = (y * N + x) * 4;
      const stain = Math.max(0, n - 0.5) * 2; // 0..1
      const grain = r();
      if (grain > 0.93) {
        // grano claro
        img.data[k] = 255;
        img.data[k + 1] = 246;
        img.data[k + 2] = 224;
        img.data[k + 3] = 34;
      } else {
        img.data[k] = 98;
        img.data[k + 1] = 62;
        img.data[k + 2] = 26;
        img.data[k + 3] = Math.round(stain * 52 + (grain < 0.06 ? 30 : 0));
      }
    }
  }
  g.putImageData(img, 0, 0);
  // fibras (dibujadas con envoltura para que el mosaico no tenga costura)
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = r() * N;
    const y = r() * N;
    const a = r() * Math.PI;
    const l = 4 + r() * 14;
    const dark = r() < 0.6;
    g.strokeStyle = dark ? `rgba(86,52,20,${0.12 + r() * 0.16})` : `rgba(255,244,222,${0.18 + r() * 0.2})`;
    g.lineWidth = 0.5 + r() * 0.8;
    for (const ox of [-N, 0, N]) {
      for (const oy of [-N, 0, N]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(a) * l * 0.5 + (r() - 0.5) * 3, y + oy + Math.sin(a) * l * 0.5 + (r() - 0.5) * 3, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  kraftURL = c.toDataURL('image/png');
  return kraftURL;
}

// ---------- definiciones compartidas ----------
function defs() {
  return s(
    'defs',
    {},
    s('pattern', { id: 'mld-kraft', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, s('image', { href: kraftTexture(), x: 0, y: 0, width: 24, height: 24, preserveAspectRatio: 'none' })),
    s('marker', { id: 'mld-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 3.2, markerHeight: 3.2, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' }, s('path', { d: 'M0 0L10 5L0 10Z', fill: '#4a2f14' })),
  );
}

// Base de corte verde con grilla de 1 / 5 / 10 cm, números en los bordes y diagonales.
function cuttingMat(W, H) {
  const g = s('g', { class: 'mld-mat' });
  g.appendChild(s('rect', { x: 0, y: 0, width: W, height: H, rx: 1.6, fill: '#356f5b' }));
  let minor = '';
  let mid = '';
  let major = '';
  for (let x = 1; x < W; x++) {
    const line = `M${x} 0V${H}`;
    if (x % 10 === 0) major += line;
    else if (x % 5 === 0) mid += line;
    else minor += line;
  }
  for (let y = 1; y < H; y++) {
    const line = `M0 ${y}H${W}`;
    if (y % 10 === 0) major += line;
    else if (y % 5 === 0) mid += line;
    else minor += line;
  }
  g.appendChild(s('path', { d: minor, stroke: 'rgba(214,240,226,0.13)', 'stroke-width': 0.06 }));
  g.appendChild(s('path', { d: mid, stroke: 'rgba(214,240,226,0.24)', 'stroke-width': 0.1 }));
  g.appendChild(s('path', { d: major, stroke: 'rgba(230,248,238,0.42)', 'stroke-width': 0.16 }));
  // diagonales a 45° típicas de la base de corte
  const diag = [];
  for (let k = -H; k < W; k += 40) diag.push(`M${k} 0L${k + H} ${H}`);
  g.appendChild(s('path', { d: diag.join(''), stroke: 'rgba(230,248,238,0.16)', 'stroke-width': 0.12, 'stroke-dasharray': '1.2 1.2' }));
  // números cada 10 cm
  const nums = s('g', { class: 'mld-mat-nums', fill: 'rgba(236,250,242,0.7)', 'font-size': 1.9, 'font-weight': 700 });
  for (let x = 10; x < W - 2; x += 10) nums.appendChild(s('text', { x, y: 2.4, 'text-anchor': 'middle' }, x));
  for (let y = 10; y < H - 2; y += 10) nums.appendChild(s('text', { x: 1.0, y: y + 0.65 }, y));
  g.appendChild(nums);
  g.appendChild(s('text', { x: W - 1.4, y: H - 1.2, 'text-anchor': 'end', class: 'mld-mat-brand', 'font-size': 1.7, fill: 'rgba(236,250,242,0.55)', 'letter-spacing': 0.3 }, 'BASE DE CORTE · cm'));
  return g;
}

// Tira de cinta de papel (masking tape) semitransparente, con bordes rasgados.
function maskingTape(cx, cy, deg) {
  const w = 7.5;
  const hh = 2.3;
  const r = rng(Math.round(cx * 13 + cy * 7));
  let d = `M${f1(-w / 2)} ${f1(-hh / 2)}`;
  d += `L${f1(w / 2)} ${f1(-hh / 2)}`;
  for (let i = 1; i <= 5; i++) d += `L${f1(w / 2 + (r() - 0.5) * 0.5)} ${f1(-hh / 2 + (hh * i) / 5)}`;
  d += `L${f1(-w / 2)} ${f1(hh / 2)}`;
  for (let i = 4; i >= 0; i--) d += `L${f1(-w / 2 + (r() - 0.5) * 0.5)} ${f1(-hh / 2 + (hh * i) / 5)}`;
  d += 'Z';
  return s(
    'g',
    { class: 'mld-tape', transform: `translate(${f1(cx)} ${f1(cy)}) rotate(${deg})` },
    s('path', { d, fill: 'rgba(239,226,190,0.78)', stroke: 'rgba(170,150,110,0.5)', 'stroke-width': 0.12 }),
    s('path', { d: `M${f1(-w / 2 + 0.4)} ${f1(-hh / 4)}H${f1(w / 2 - 0.4)}`, stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 0.3 }),
  );
}

// Cruces de una horizontal (y, metros) con un polígono: [minX, maxX] o null.
function spanAtY(poly, y) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return hi > lo ? [lo, hi] : null;
}

// Línea de pecho trazada en lápiz por el moldista: cota con topes y la medida escrita.
// Devuelve { g, y } (y en cm del SVG) o null.
function chestLine(piece, ox, oy, chestY, chestCm) {
  let top = -Infinity;
  for (const p of piece.seamLine) top = Math.max(top, p.y);
  const y = chestY + top; // y de prenda → y de la pieza (el HPS es lo más alto de la costura)
  const span = spanAtY(piece.seamLine, y);
  if (!span) return null;
  const sy = f1(oy - y * CM);
  const x0 = f1(ox + span[0] * CM + 0.5);
  const x1 = f1(ox + span[1] * CM - 0.5);
  const g = s('g', { class: 'mld-pencil' });
  g.appendChild(s('path', { d: `M${x0} ${sy}H${x1}M${x0} ${f1(sy - 0.8)}v1.6M${x1} ${f1(sy - 0.8)}v1.6`, fill: 'none', stroke: 'rgba(70,64,58,0.55)', 'stroke-width': 0.13, 'stroke-linecap': 'round' }));
  const tx = f1(ox + span[1] * CM * 0.52);
  g.appendChild(s('text', { x: tx, y: f1(sy - 0.75), class: 'mld-pencil-txt', 'font-size': 1.75, 'text-anchor': 'middle' }, `pecho ${cmTxt(chestCm)}`));
  return { g, y: sy };
}

let clipSeq = 0;

// Una pieza de molde (coords de la pieza en metros, centrada en su bbox) ubicada en (ox, oy) cm.
function pieceGroup(piece, ox, oy, { sizeLabel, fitLabel, index, chestY = null, chestCm = null }) {
  const info = pieceInfo(piece);
  const w = piece.width * CM;
  const hgt = piece.height * CM;
  const g = s('g', { class: 'mld-piece', 'data-id': piece.id, style: `--i:${index};--mld-paper:${piece.color || '#d9bb8c'}` });
  const cut = pathD(piece.outline, ox, oy);
  // sombra sobre la base de corte (dos copias corridas, sin filtros: es barato de dibujar)
  g.appendChild(s('path', { d: cut, fill: 'rgba(6,28,20,0.16)', transform: 'translate(0.9 1.5)', class: 'mld-shadow2' }));
  g.appendChild(s('path', { d: cut, fill: 'rgba(6,28,20,0.32)', transform: 'translate(0.35 0.6)', class: 'mld-shadow1' }));
  const body = s('g', { class: 'mld-piece-body' });
  // papel: color base + textura de papel madera (manchas, fibras, motitas)
  body.appendChild(s('path', { d: cut, fill: piece.color || '#d9bb8c', class: 'mld-paper' }));
  body.appendChild(s('path', { d: cut, fill: 'url(#mld-kraft)', class: 'mld-fibers' }));
  // marca de doblez del papel (el molde estuvo guardado doblado): pliegue claro + sombra, recortado a la pieza
  if (piece.id === 'espalda' || (piece.id.startsWith('manga') && hgt > 40)) {
    const id = `mld-clip-${++clipSeq}`;
    body.appendChild(s('clipPath', { id }, s('path', { d: cut })));
    const r = rng(Math.round(w * 31 + hgt * 17 + index));
    const fy = oy + hgt * (0.12 + r() * 0.16);
    const tilt = (r() - 0.5) * 5;
    const d = `M${f1(ox - w / 2 - 2)} ${f1(fy - tilt)}Q${f1(ox)} ${f1(fy + (r() - 0.5) * 1.6)} ${f1(ox + w / 2 + 2)} ${f1(fy + tilt)}`;
    const crease = s('g', { 'clip-path': `url(#${id})`, class: 'mld-crease' });
    crease.appendChild(s('path', { d, fill: 'none', stroke: 'rgba(92,58,24,0.075)', 'stroke-width': 2.6, transform: 'translate(0 1.1)' }));
    crease.appendChild(s('path', { d, fill: 'none', stroke: 'rgba(255,246,226,0.16)', 'stroke-width': 1.6, transform: 'translate(0 -0.9)' }));
    crease.appendChild(s('path', { d, fill: 'none', stroke: 'rgba(255,246,226,0.42)', 'stroke-width': 0.3, transform: 'translate(0 -0.12)' }));
    crease.appendChild(s('path', { d, fill: 'none', stroke: 'rgba(80,50,20,0.2)', 'stroke-width': 0.12, transform: 'translate(0 0.2)' }));
    body.appendChild(crease);
  }
  // línea de costura (punteada) y línea de corte (marcador)
  body.appendChild(s('path', { d: pathD(piece.seamLine, ox, oy), fill: 'none', stroke: '#6b4521', 'stroke-width': 0.2, 'stroke-dasharray': '1.1 0.7', class: 'mld-seam' }));
  body.appendChild(s('path', { d: cut, fill: 'none', stroke: '#3f2611', 'stroke-width': 0.34, 'stroke-linejoin': 'round', class: 'mld-cut' }));

  // piquetes: cortecito perpendicular al borde, desde la línea de corte hacia la costura
  const notches = s('g', { stroke: '#3f2611', 'stroke-width': 0.3, 'stroke-linecap': 'round' });
  for (const n of piece.notches || []) {
    let best = null;
    let bd = Infinity;
    for (const p of piece.seamLine) {
      const d = Math.hypot(p.x - n.x, p.y - n.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best || bd < 1e-6) continue;
    const dx = (best.x - n.x) / bd;
    const dy = (best.y - n.y) / bd;
    const L = 0.009;
    notches.appendChild(s('path', { d: `M${f1(ox + n.x * CM)} ${f1(oy - n.y * CM)}l${f1(dx * L * CM)} ${f1(-dy * L * CM)}` }));
  }
  body.appendChild(notches);

  const big = w > 25 && hgt > 18;
  const strip = hgt < 8;
  const isSleeve = piece.id.startsWith('manga');
  const isBody = piece.id === 'frente' || piece.id === 'espalda';
  const inside = (cx, cy, r = 0) => {
    const px = (cx - ox) / CM;
    const py = (oy - cy) / CM;
    const rr = r / CM;
    return [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr]].every(([dx, dy]) => pointInPolygon(px + dx, py + dy, piece.outline));
  };
  // línea de centro (frente / espalda): de la boca del escote al ruedo, en raya y punto
  let chest = null;
  if (isBody) {
    let top = -Infinity;
    let bot = Infinity;
    for (const p of piece.seamLine) {
      if (Math.abs(p.x) > 0.012) continue;
      top = Math.max(top, p.y);
      bot = Math.min(bot, p.y);
    }
    if (top > bot) {
      body.appendChild(s('line', { x1: ox, y1: oy - top * CM + 1.2, x2: ox, y2: oy - bot * CM - 1.2, stroke: 'rgba(74,47,20,0.55)', 'stroke-width': 0.16, 'stroke-dasharray': '3 0.8 0.5 0.8' }));
    }
    if (chestY !== null && chestCm) {
      chest = chestLine(piece, ox, oy, chestY, chestCm);
      if (chest) body.appendChild(chest.g);
    }
  }
  // flecha de hilo (doble punta) paralela al eje y de la pieza
  const longSleeve = isSleeve && hgt > 40;
  const grain = (gx, y0, y1) => {
    body.appendChild(s('line', { x1: gx, y1: y1, x2: gx, y2: y0, stroke: '#4a2f14', 'stroke-width': 0.24, 'marker-start': 'url(#mld-arrow)', 'marker-end': 'url(#mld-arrow)' }));
    const my = (y0 + y1) / 2;
    body.appendChild(s('text', { x: gx - 0.75, y: my, class: 'mld-hand mld-grain-txt', 'font-size': 1.9, 'text-anchor': 'middle', transform: `rotate(-90 ${f1(gx - 0.75)} ${f1(my)})` }, 'HILO'));
  };
  if (strip) {
    const gx = ox - w / 2 + 2.2;
    body.appendChild(s('line', { x1: gx, y1: oy + hgt / 2 - 0.9, x2: gx, y2: oy - hgt / 2 + 0.9, stroke: '#4a2f14', 'stroke-width': 0.22, 'marker-start': 'url(#mld-arrow)', 'marker-end': 'url(#mld-arrow)' }));
  } else if (longSleeve) grain(ox, oy + hgt * 0.02, oy + hgt * 0.4);
  else if (isSleeve) grain(ox - w * 0.31, oy - hgt * 0.08, oy + hgt * 0.34);
  else grain(ox - w * 0.27, oy - hgt * 0.3, oy + hgt * 0.32);

  // textos escritos con marcador
  if (strip) {
    const txt = `${info.name} · ${info.cut.toLowerCase()} · T. ${sizeLabel}`;
    const room = w - 6;
    const est = txt.length * 2.2 * 0.6;
    body.appendChild(s('text', { x: ox + 1.6, y: oy + 0.78, class: 'mld-hand mld-name', 'font-size': 2.2, 'text-anchor': 'middle', textLength: est > room ? f1(room) : null, lengthAdjust: 'spacingAndGlyphs' }, txt));
  } else {
    const nameSize = big ? 4.4 : 3.6;
    const subSize = big ? 2.9 : 2.5;
    const cx = longSleeve ? ox : isSleeve ? ox + w * 0.06 : ox + w * 0.07;
    let cy = longSleeve ? oy - hgt * 0.24 : isSleeve ? oy - hgt * 0.02 : oy - hgt * 0.04;
    // el nombre va siempre debajo de la línea de pecho (en oversize la sisa baja y la línea también)
    if (chest) cy = Math.max(cy, chest.y + nameSize + 2.2);
    body.appendChild(s('text', { x: cx, y: cy, class: 'mld-hand mld-name', 'font-size': nameSize, 'text-anchor': 'middle' }, info.name));
    body.appendChild(s('text', { x: cx, y: cy + subSize * 1.35, class: 'mld-hand mld-sub', 'font-size': subSize, 'text-anchor': 'middle' }, `Talle ${sizeLabel} · ${fitLabel}`));
    body.appendChild(s('text', { x: cx, y: cy + subSize * 2.6, class: 'mld-hand mld-sub', 'font-size': subSize, 'text-anchor': 'middle' }, info.cut));
    // círculo con el talle (como lo marcan los moldistas)
    const sx = cx;
    const sy = cy + subSize * 2.6 + 5.4;
    if (big && !longSleeve && inside(sx, sy, 3.2)) {
      body.appendChild(s('circle', { cx: sx, cy: sy, r: 2.6, fill: 'none', stroke: '#9b3b24', 'stroke-width': 0.28 }));
      body.appendChild(s('text', { x: sx, y: sy + 1.05, class: 'mld-hand mld-size', 'font-size': sizeLabel.length > 2 ? 2.1 : 2.9, 'text-anchor': 'middle', fill: '#9b3b24' }, sizeLabel));
    }
    // ojal para colgar el molde en el gancho: el primer lugar libre (adentro y lejos de los textos)
    const longest = Math.max(info.name.length * nameSize * 0.72, `Talle ${sizeLabel} · ${fitLabel}`.length * subSize * 0.56, info.cut.length * subSize * 0.56);
    const tb = { x0: cx - longest / 2 - 1.6, x1: cx + longest / 2 + 1.6, y0: cy - nameSize - 1.6, y1: cy + subSize * 2.6 + 1.6 };
    const free = (x, y) => inside(x, y, 2.2) && !(x > tb.x0 && x < tb.x1 && y > tb.y0 && y < tb.y1);
    const spots = longSleeve
      ? [[-0.24, -0.3], [0.2, -0.3], [0, -0.38]]
      : isSleeve
        ? [[0.26, -0.14], [-0.12, -0.3], [0.12, -0.3], [0.3, 0.1]]
        : [[0.18, -0.36], [0.24, -0.3]];
    const spot = spots.map(([fx, fy]) => [ox + fx * w, oy + fy * hgt]).find(([x, y]) => free(x, y));
    if (spot) {
      const [px, py] = spot;
      body.appendChild(s('circle', { cx: px, cy: py, r: 1.15, fill: '#e9dcc3', stroke: '#b9a582', 'stroke-width': 0.35 }));
      body.appendChild(s('circle', { cx: px, cy: py, r: 0.62, fill: '#356f5b' }));
    }
  }
  g.appendChild(body);
  // cinta de papel que sujeta el molde a la base (en una esquina del ruedo / del puño)
  if (isBody && piece.id === 'frente') g.appendChild(maskingTape(ox - w / 2 + 1.2, oy + hgt / 2 - 1.4, 38));
  else if (isSleeve && !longSleeve) g.appendChild(maskingTape(ox + w / 2 - 3.5, oy + hgt / 2 - 1.2, -32));
  else if (longSleeve) g.appendChild(maskingTape(ox, oy + hgt / 2 - 0.6, 8));
  g.dataset.info = `${info.name.charAt(0)}${info.name.slice(1).toLowerCase()} · ${cmTxt(w)} × ${cmTxt(hgt)} cm · ${info.cut.toLowerCase()}`;
  return g;
}

// Ubica las piezas (una sola manga / un solo ribete: se cortan dos iguales) en filas.
function layoutPieces(pieces) {
  const show = pieces.filter((p) => !pieceInfo(p).skip);
  const byId = new Map(show.map((p) => [p.id, p]));
  const gap = 3.2;
  const margin = 4.2;
  const rows = [];
  const row1 = ['frente', 'espalda'].map((id) => byId.get(id)).filter(Boolean);
  const rest = show.filter((p) => !row1.includes(p));
  rows.push(row1);
  // segunda fila: manga + columna de tiras (cuello / ribete)
  const tall = rest.filter((p) => p.height * CM >= 8);
  const strips = rest.filter((p) => p.height * CM < 8);
  const row1W = row1.reduce((a, p) => a + p.width * CM, 0) + gap * (row1.length - 1);
  const placed = [];
  let y = margin + 2;
  let x = margin + 2;
  let rowH = 0;
  for (const p of row1) {
    placed.push({ piece: p, cx: x + (p.width * CM) / 2, cy: y + (p.height * CM) / 2 });
    x += p.width * CM + gap;
    rowH = Math.max(rowH, p.height * CM);
  }
  y += rowH + gap;
  x = margin + 2;
  rowH = 0;
  for (const p of tall) {
    placed.push({ piece: p, cx: x + (p.width * CM) / 2, cy: y + (p.height * CM) / 2 });
    x += p.width * CM + gap;
    rowH = Math.max(rowH, p.height * CM);
  }
  // tiras: a la derecha de la manga si entran, si no abajo
  let sx = x;
  let sy = y;
  for (const p of strips) {
    const w = p.width * CM;
    const hh = p.height * CM;
    if (sx + w > margin + 2 + row1W + 0.01) {
      sx = margin + 2;
      sy = Math.max(sy, y + rowH + gap);
    }
    placed.push({ piece: p, cx: sx + w / 2, cy: sy + hh / 2 });
    sy += hh + gap * 1.6;
    rowH = Math.max(rowH, sy - y - gap);
  }
  const W = Math.max(row1W, ...placed.map((q) => q.cx + (q.piece.width * CM) / 2 - margin - 2)) + (margin + 2) * 2 - 2;
  const H = Math.max(...placed.map((q) => q.cy + (q.piece.height * CM) / 2)) + margin;
  return { placed, W: Math.ceil(W), H: Math.ceil(H) };
}

// Crea el SVG de la moldería. Devuelve { el, svg, pieces: Map(id → g) }.
export function renderSheet(pattern, { sizeLabel = 'M', fitLabel = 'Clásica', animate = true } = {}) {
  const { placed, W, H } = layoutPieces(pattern.pieces);
  const svg = s('svg', {
    class: `mld-sheet${animate ? ' mld-animate' : ''}`,
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Moldería talle ${sizeLabel}: ${placed.map((q) => pieceInfo(q.piece).name.toLowerCase()).join(', ')}`,
  });
  svg.appendChild(defs());
  svg.appendChild(cuttingMat(W, H));
  const groups = new Map();
  const c = pattern.construction;
  const chestY = c && c.UA ? c.UA.y - 0.025 : null;
  const chestCm = pattern.measurements?.chest || null;
  placed.forEach((q, i) => {
    const g = pieceGroup(q.piece, q.cx, q.cy, { sizeLabel, fitLabel, index: i, chestY, chestCm });
    groups.set(q.piece.id, g);
    // apoyado a mano: cada molde queda apenas girado
    const deg = (((i * 37) % 7) - 3) * 0.22;
    svg.appendChild(s('g', { transform: `rotate(${f1(deg)} ${f1(q.cx)} ${f1(q.cy)})` }, g));
  });
  return { svg, groups, width: W, height: H };
}

// Sello "molde aprobado" que se estampa al confirmar.
export function stampSheet(svg, text) {
  const vb = svg.viewBox.baseVal;
  const cx = vb.width * 0.72;
  const cy = vb.height * 0.2;
  const w = Math.min(46, vb.width * 0.42);
  const g = s(
    'g',
    { class: 'mld-stamp', transform: `rotate(-12 ${f1(cx)} ${f1(cy)})` },
    s('rect', { x: cx - w / 2, y: cy - 6, width: w, height: 12, rx: 2, fill: 'rgba(255,248,236,0.18)', stroke: '#c0392b', 'stroke-width': 0.9 }),
    s('rect', { x: cx - w / 2 + 1.2, y: cy - 4.8, width: w - 2.4, height: 9.6, rx: 1.4, fill: 'none', stroke: '#c0392b', 'stroke-width': 0.35 }),
    s('text', { x: cx, y: cy + 2.1, 'text-anchor': 'middle', 'font-size': 5.6, 'font-weight': 900, fill: '#c0392b', class: 'mld-stamp-txt', textLength: f1(w - 6), lengthAdjust: 'spacingAndGlyphs' }, text),
  );
  svg.appendChild(g);
  return g;
}

// Caja (coords de prenda) que contiene a todas las siluetas: sirve como `frame` común para que
// varios íconos queden a la misma escala (así se ve que una es más ancha o más larga que otra).
export function outlinesBox(outlines) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const o of outlines) {
    for (const p of o) {
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}

// Icono chico de una silueta (outline en coords de prenda) para las opciones del panel.
// frame: caja fija (outlinesBox) en lugar de la propia de la silueta.
export function silhouetteIcon(outline, { crop = null, frame = null, size = 46, stroke = 'currentColor' } = {}) {
  let { minX, maxX, minY, maxY } = frame || outlinesBox([outline]);
  if (crop) {
    minX = crop.minX ?? minX;
    maxX = crop.maxX ?? maxX;
    minY = crop.minY ?? minY;
    maxY = crop.maxY ?? maxY;
  }
  const pad = 0.03;
  const w = maxX - minX + pad * 2;
  const hh = maxY - minY + pad * 2;
  const side = Math.max(w, hh);
  const vx = (minX + maxX) / 2 - side / 2;
  const vy = -((minY + maxY) / 2) - side / 2;
  const d = outline.map((p, i) => `${i ? 'L' : 'M'}${(p.x * CM).toFixed(1)} ${(-p.y * CM).toFixed(1)}`).join('') + 'Z';
  return s(
    'svg',
    { class: 'mld-icon', viewBox: `${(vx * CM).toFixed(1)} ${(vy * CM).toFixed(1)} ${(side * CM).toFixed(1)} ${(side * CM).toFixed(1)}`, width: size, height: size, 'aria-hidden': 'true' },
    s('path', { d, fill: 'var(--mld-icon-fill, #efe2cc)', stroke, 'stroke-width': side * CM * 0.028, 'stroke-linejoin': 'round' }),
  );
}
