// Tizado · moldes de papel madera en 3D: textura canvas (contorno de corte, línea de costura
// punteada, piquetes, nombre y talle), flecha de hilo con color según la orientación, y un
// halo (cinta alrededor del contorno) para selección / avisos.

import * as THREE from 'three';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Geometrías planas en el plano XZ (cara hacia +Y). Un punto de pieza (x, y) va a (x, 0, −y),
// igual que createPieceMesh, así el grupo se ubica con fabricToWorld + rotation.y = rot.
// ---------------------------------------------------------------------------

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2; // > 0 → antihorario (con y hacia arriba)
}

// Normales hacia afuera (con inglete limitado) de un polígono cerrado.
export function outwardNormals(pts) {
  const n = pts.length;
  const ccw = signedArea(pts) > 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    let ax = p1.x - p0.x;
    let ay = p1.y - p0.y;
    let bx = p2.x - p1.x;
    let by = p2.y - p1.y;
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    // normal derecha de cada tramo (afuera si es antihorario)
    let nx = ay + by;
    let ny = -ax - bx;
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const dot = (ccw ? 1 : -1) * (nx * ay - ny * ax);
    const k = Math.min(2.2, 1 / Math.max(0.35, Math.abs(dot)));
    out.push({ x: nx * k, y: ny * k });
  }
  return out;
}

// Cinta cerrada entre los desplazamientos d0 y d1 (m) del contorno. uv: u = largo (m), v = 0..1.
export function ribbonGeometry(pts, d0, d1, { y = 0 } = {}) {
  const n = pts.length;
  const nr = outwardNormals(pts);
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  let len = 0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) len += Math.hypot(pts[k].x - pts[i - 1].x, pts[k].y - pts[i - 1].y);
    const p = pts[k];
    const q = nr[k];
    pos.set([p.x + q.x * d0, y, -(p.y + q.y * d0), p.x + q.x * d1, y, -(p.y + q.y * d1)], i * 6);
    uv.set([len, 0, len, 1], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // todas las caras hacia arriba
  const ia = g.index.array;
  for (let t = 0; t < ia.length; t += 3) {
    const a = ia[t] * 3;
    const b = ia[t + 1] * 3;
    const c = ia[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vz = pos[c + 2] - pos[a + 2];
    const ny = uz * vx - ux * vz;
    if (ny < 0) {
      const tmp = ia[t + 1];
      ia[t + 1] = ia[t + 2];
      ia[t + 2] = tmp;
    }
  }
  g.computeVertexNormals();
  g.userData.length = len;
  g.userData.segments = n;
  return g;
}

function shapeGeometry(pts, w, h) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (-pos.getZ(i) + h / 2) / h);
  uv.needsUpdate = true;
  return g;
}

// ---------------------------------------------------------------------------
// Texturas
// ---------------------------------------------------------------------------

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function tracePath(ctx, pts, X, Y) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
  ctx.closePath();
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k > 0) c.lerp(new THREE.Color('#ffffff'), k);
  else c.lerp(new THREE.Color('#000000'), -k);
  return `#${c.getHexString()}`;
}

export function paperCanvas(piece, { sizeLabel = '', info = '', pxPerM = 760, maxPx = 760 } = {}) {
  const w = piece.width;
  const h = piece.height;
  const s = Math.min(pxPerM, maxPx / Math.max(w, h));
  const cw = Math.max(8, Math.ceil(w * s));
  const ch = Math.max(8, Math.ceil(h * s));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');
  const X = (x) => (x + w / 2) * s;
  const Y = (y) => (h / 2 - y) * s;
  const base = shade(piece.color || '#d9bb8c', -0.24);
  const r = rand(piece.id.length * 977 + Math.round(w * 1000));

  // papel: gradiente suave + fibras
  ctx.save();
  tracePath(ctx, piece.outline, X, Y);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, cw, ch);
  g.addColorStop(0, shade(base, 0.1));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -0.06));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  const fibers = Math.round((cw * ch) / 90);
  for (let i = 0; i < fibers; i++) {
    const x = r() * cw;
    const y = r() * ch;
    const a = r() * TAU;
    const l = 2 + r() * 7;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(255,248,232,0.22)' : 'rgba(92,60,30,0.12)';
    ctx.lineWidth = 0.6 + r() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // manchitas de manipulación
  for (let i = 0; i < 5; i++) {
    const x = r() * cw;
    const y = r() * ch;
    const rr = (0.04 + r() * 0.08) * s;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    rg.addColorStop(0, 'rgba(120,80,40,0.06)');
    rg.addColorStop(1, 'rgba(120,80,40,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  ctx.restore();

  const ink = '#3a2416';
  const lw = Math.max(1.6, 0.0028 * s);
  // línea de costura punteada
  ctx.save();
  ctx.setLineDash([0.012 * s, 0.008 * s]);
  ctx.strokeStyle = 'rgba(74,49,34,0.78)';
  ctx.lineWidth = Math.max(1, 0.0016 * s);
  tracePath(ctx, piece.seamLine, X, Y);
  ctx.stroke();
  ctx.restore();
  // línea de corte (adentro del borde)
  ctx.save();
  tracePath(ctx, piece.outline, X, Y);
  ctx.clip();
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw * 2;
  tracePath(ctx, piece.outline, X, Y);
  ctx.stroke();
  // piquetes: muesca hacia adentro
  ctx.fillStyle = ink;
  for (const p of piece.notches || []) {
    const dx = -p.x;
    const dy = -p.y;
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const L = 0.011;
    const W = 0.004;
    ctx.beginPath();
    ctx.moveTo(X(p.x - uy * W), Y(p.y + ux * W));
    ctx.lineTo(X(p.x + ux * L), Y(p.y + uy * L));
    ctx.lineTo(X(p.x + uy * W), Y(p.y - ux * W));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // textos: en las piezas grandes corren junto a la flecha de hilo (eje y), así se leen
  // derechos cuando el molde está bien orientado; en las tiras, a lo largo de la tira.
  const strip = Math.min(w, h) < 0.08;
  const name = piece.name.toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!strip) {
    const big = Math.min(0.048, w * 0.13, h * 0.08);
    const withInfo = !!info && h > 0.4;
    // el bloque crece hacia la flecha (las líneas giradas se apilan hacia −x): que no la pise
    const reach = (withInfo ? 1.95 : 1.15) * big;
    const tx = Math.min(w / 2 - 0.7 * big, Math.max(Math.min(w * 0.16, 0.09), 0.03 + reach));
    ctx.save();
    ctx.translate(X(tx), Y(0));
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = ink;
    ctx.font = `700 ${Math.round(big * s)}px Georgia, 'Iowan Old Style', serif`;
    ctx.fillText(name, 0, -big * 0.15 * s);
    ctx.font = `600 ${Math.round(big * 0.52 * s)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(74,49,34,0.85)';
    const sub = [sizeLabel ? `Talle ${sizeLabel}` : '', `Cortar ×${piece.count || 1}`].filter(Boolean).join('  ·  ');
    ctx.fillText(sub, 0, big * 0.9 * s);
    if (withInfo) {
      ctx.font = `500 ${Math.round(big * 0.44 * s)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
      ctx.fillText(info, 0, big * 1.7 * s);
    }
    ctx.restore();
    // "HILO" junto a la flecha
    ctx.save();
    ctx.translate(X(-Math.min(0.032, w * 0.1)), Y(Math.min(0.07, h * 0.2)));
    ctx.rotate(Math.PI / 2);
    ctx.font = `800 ${Math.round(Math.min(0.014, h * 0.06) * s)}px ui-rounded, 'Nunito', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(74,49,34,0.8)';
    ctx.fillText('HILO', 0, 0);
    ctx.restore();
  } else {
    const big = Math.min(0.02, h * 0.5);
    ctx.fillStyle = ink;
    ctx.font = `700 ${Math.round(big * s)}px Georgia, 'Iowan Old Style', serif`;
    ctx.fillText(`${name}  ·  ×${piece.count || 1}`, X(w * 0.1), Y(0));
  }
  return cv;
}

let arrowTex = null;
function arrowTexture() {
  if (arrowTex) return arrowTex;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 512;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  const head = 70;
  const sw = 12;
  c.fillRect(32 - sw / 2, head - 6, sw, 512 - head * 2 + 12);
  for (const dir of [1, -1]) {
    c.beginPath();
    const y0 = dir > 0 ? 4 : 508;
    c.moveTo(32, y0);
    c.lineTo(60, y0 + dir * head);
    c.lineTo(32, y0 + dir * (head - 18));
    c.lineTo(4, y0 + dir * head);
    c.closePath();
    c.fill();
  }
  arrowTex = new THREE.CanvasTexture(cv);
  arrowTex.colorSpace = THREE.SRGBColorSpace;
  arrowTex.anisotropy = 4;
  arrowTex.userData.shared = true;
  return arrowTex;
}

// ---------------------------------------------------------------------------
// Pieza de papel
// ---------------------------------------------------------------------------

export const PAPER_COLORS = {
  ok: new THREE.Color('#3c8a4f'),
  bad: new THREE.Color('#c0392b'),
  warn: new THREE.Color('#d9a43b'),
  select: new THREE.Color('#2f6f6a'),
  hover: new THREE.Color('#fff4df'),
};

export function createPaperPiece(piece, { sizeLabel = '', info = '' } = {}) {
  const group = new THREE.Group();
  group.name = `molde-${piece.id}`;
  const w = piece.width;
  const h = piece.height;

  const tex = new THREE.CanvasTexture(paperCanvas(piece, { sizeLabel, info }));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paperMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, transparent: true, opacity: 0.93, color: '#ffffff', envMapIntensity: 0.45 });
  const paper = new THREE.Mesh(shapeGeometry(piece.outline, w, h), paperMat);
  paper.castShadow = true;
  paper.receiveShadow = false;
  paper.userData.pieceId = piece.id;
  paper.renderOrder = 2;
  group.add(paper);

  // flecha de hilo (eje y de la pieza)
  const al = Math.max(0.026, Math.min(0.46, h * 0.62));
  const aw = Math.max(0.012, Math.min(0.034, al * 0.12, w * 0.3));
  const arrowGeo = new THREE.PlaneGeometry(aw, al);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, color: PAPER_COLORS.bad.clone(), depthWrite: false, toneMapped: false });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.position.y = 0.0004;
  if (Math.min(w, h) < 0.08) arrow.position.x = -w * 0.38;
  arrow.renderOrder = 3;
  arrow.raycast = () => {};
  group.add(arrow);

  // halo
  const halo = new THREE.Mesh(ribbonGeometry(piece.outline, 0.0005, 0.0085), new THREE.MeshBasicMaterial({ color: PAPER_COLORS.select.clone(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  halo.position.y = 0.0002;
  halo.renderOrder = 1;
  halo.raycast = () => {};
  halo.visible = false;
  group.add(halo);

  const tint = new THREE.Color('#ffffff');
  const tintBad = new THREE.Color('#ffb4a6');
  let st = { selected: false, hover: false, bad: false, warn: false, grainOk: false, drag: false };
  const api = {
    group,
    paper,
    arrow,
    halo,
    piece,
    setState(next) {
      st = { ...st, ...next };
      arrowMat.color.copy(st.grainOk ? PAPER_COLORS.ok : PAPER_COLORS.bad);
    },
    get state() {
      return st;
    },
    // se llama cada frame (t en s) para pulsos y transiciones
    tick(t) {
      let col = null;
      let op = 0;
      if (st.bad) {
        col = PAPER_COLORS.bad;
        op = 0.55 + 0.35 * Math.sin(t * 7);
      } else if (st.selected || st.drag) {
        col = PAPER_COLORS.select;
        op = 0.9;
      } else if (st.warn) {
        col = PAPER_COLORS.warn;
        op = 0.7;
      } else if (st.hover) {
        col = PAPER_COLORS.hover;
        op = 0.85;
      }
      halo.visible = !!col;
      if (col) {
        halo.material.color.copy(col);
        halo.material.opacity = op;
      }
      paperMat.color.copy(st.bad ? tint.clone().lerp(tintBad, 0.65 + 0.35 * Math.sin(t * 7)) : tint);
    },
    setOpacity(o) {
      paperMat.opacity = 0.93 * o;
      arrowMat.opacity = o;
      halo.material.opacity *= o;
      paper.castShadow = o > 0.5;
    },
  };
  api.setState({});
  return api;
}
