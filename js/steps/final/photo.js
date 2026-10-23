// Fotos de la remera terminada: recorte del canvas 3D alrededor de la remera,
// miniatura para la colección y "polaroid" descargable con epígrafe.

import * as THREE from 'three';
import { makeCanvas } from '../../core/utils.js';

const _v = new THREE.Vector3();

// Rectángulo (en px del drawing buffer) que ocupa la remera en pantalla.
function shirtRect(engine, shirt) {
  const canvas = engine.renderer.domElement;
  const W = canvas.width;
  const H = canvas.height;
  const sil = shirt.pattern?.silhouette?.front?.outline;
  let minX = -0.4;
  let maxX = 0.4;
  let minY = -0.75;
  let maxY = 0.05;
  if (sil && sil.length) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    for (const p of sil) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    maxY += 0.06; // el cuello del soporte asoma arriba
  }
  shirt.group.updateMatrixWorld(true);
  const cam = engine.camera;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [-0.16, 0.16]) {
        _v.set(x, y, z).applyMatrix4(shirt.group.matrixWorld).project(cam);
        const px = (_v.x * 0.5 + 0.5) * W;
        const py = (-_v.y * 0.5 + 0.5) * H;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    }
  }
  return { x0, x1, y0, y1, W, H };
}

// Proyecta un punto en coordenadas de prenda (x, y, z en metros, espacio de shirt.group)
// a píxeles del drawing buffer.
export function projectGarmentPoint(engine, shirt, x, y, z = 0) {
  const canvas = engine.renderer.domElement;
  shirt.group.updateMatrixWorld(true);
  _v.set(x, y, z).applyMatrix4(shirt.group.matrixWorld).project(engine.camera);
  return { x: (_v.x * 0.5 + 0.5) * canvas.width, y: (-_v.y * 0.5 + 0.5) * canvas.height };
}

// Dibuja una línea punteada horizontal con etiqueta sobre una captura (marca de referencia).
export function markLine(canvas, y, label) {
  const g = canvas.getContext('2d');
  g.save();
  g.setLineDash([8, 5]);
  g.lineWidth = 3;
  g.strokeStyle = '#d2553f';
  g.beginPath();
  g.moveTo(6, y);
  g.lineTo(canvas.width - 6, y);
  g.stroke();
  g.setLineDash([]);
  g.font = "800 11px Inter, 'Segoe UI', system-ui, sans-serif";
  const w = g.measureText(label).width + 10;
  g.fillStyle = '#d2553f';
  g.fillRect(canvas.width - w - 6, y + 3, w, 16);
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(label, canvas.width - w - 1, y + 11.5);
  g.restore();
}

// Recorta la zona de la remera (proporción `aspect` = ancho/alto) del último render.
// Hace su propio render antes de copiar, así no depende de cuándo se llamó.
// `rect` reutiliza un recorte anterior ({sx, sy, cw, ch}) y `rectOut` recibe el usado (antes / después).
export function captureShirt(engine, shirt, { aspect = 4 / 5, margin = 0.16, maxSide = 0, rect = null, rectOut = null } = {}) {
  engine.renderer.render(engine.scene, engine.camera);
  const canvas = engine.renderer.domElement;
  let sx;
  let sy;
  let cw;
  let ch;
  if (rect && rect.cw) {
    ({ sx, sy, cw, ch } = rect);
  } else {
    const r = shirtRect(engine, shirt);
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    ch = Math.max(r.y1 - r.y0, (r.x1 - r.x0) / aspect) * (1 + margin * 2);
    ch = Math.min(ch, r.H, r.W / aspect);
    cw = ch * aspect;
    sx = Math.max(0, Math.min(r.W - cw, cx - cw / 2));
    sy = Math.max(0, Math.min(r.H - ch, cy - ch / 2));
  }
  if (rectOut) Object.assign(rectOut, { sx, sy, cw, ch });
  let ow = Math.round(cw);
  let oh = Math.round(ch);
  if (maxSide && Math.max(ow, oh) > maxSide) {
    const k = maxSide / Math.max(ow, oh);
    ow = Math.round(ow * k);
    oh = Math.round(oh * k);
  }
  const out = makeCanvas(Math.max(1, ow), Math.max(1, oh));
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, sx, sy, cw, ch, 0, 0, out.width, out.height);
  return out;
}

// Miniatura chica (JPEG) para guardar en localStorage.
export function thumbnailDataURL(engine, shirt, height = 256) {
  const c = captureShirt(engine, shirt, { aspect: 13 / 16, margin: 0.1 });
  const t = makeCanvas(Math.round((height * 13) / 16), height);
  const g = t.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.82);
}

// Renderiza una foto en alta (sube el pixel ratio un momento) y la arma como polaroid.
// `stars` (0..5, de a media) se dibuja después de line1, igual que las estrellas del panel.
export function polaroidCanvas(engine, shirt, { title = '', line1 = '', line2 = '', stamp = '', score = null, stars = null } = {}) {
  const renderer = engine.renderer;
  const pr0 = renderer.getPixelRatio();
  const cssW = renderer.domElement.clientWidth || window.innerWidth;
  const cssH = renderer.domElement.clientHeight || window.innerHeight;
  // más resolución para la foto, sin pasar de 4096 px por lado (límite habitual de la GPU)
  const boost = Math.max(1, Math.min(2.5, 3000 / Math.max(1, cssW * pr0), 4096 / Math.max(1, cssW * pr0), 4096 / Math.max(1, cssH * pr0)));
  let photo;
  try {
    if (boost > 1.05) renderer.setPixelRatio(pr0 * boost);
    photo = captureShirt(engine, shirt, { aspect: 4 / 5, margin: 0.17, maxSide: 1500 });
  } finally {
    if (boost > 1.05) renderer.setPixelRatio(pr0);
    renderer.render(engine.scene, engine.camera);
  }
  const PW = 960;
  const PH = Math.round(PW * (photo.height / photo.width));
  const pad = 56;
  const cap = 230;
  const W = PW + pad * 2;
  const H = PH + pad + cap;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  // papel
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#fffaf2');
  bg.addColorStop(1, '#f3e9da');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // grano del papel
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  let seed = 1234567;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = ((seed >> 8) % 13) - 6;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // foto con sombra interior
  g.drawImage(photo, pad, pad, PW, PH);
  const sh = g.createLinearGradient(0, pad, 0, pad + 18);
  sh.addColorStop(0, 'rgba(0,0,0,0.18)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(pad, pad, PW, 18);
  g.strokeStyle = 'rgba(43,36,32,0.25)';
  g.lineWidth = 2;
  g.strokeRect(pad, pad, PW, PH);
  // pespunte alrededor
  g.save();
  g.setLineDash([16, 10]);
  g.lineWidth = 3;
  g.strokeStyle = '#d2553f';
  g.strokeRect(20, 20, W - 40, H - 40);
  g.restore();
  // epígrafe
  const serif = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', 'Bitstream Charter', Georgia, 'DejaVu Serif', serif";
  const sans = "'Segoe UI', Inter, system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";
  const textW = PW - 200;
  const ty = pad + PH + 70;
  g.fillStyle = '#2b2420';
  g.textBaseline = 'alphabetic';
  g.font = `700 58px ${serif}`;
  g.fillText(fit(g, title, textW), pad, ty);
  g.font = `600 30px ${sans}`;
  g.fillStyle = '#5d5049';
  const starW = stars != null ? 5 * 32 + 18 : 0;
  const l1 = fit(g, line1, textW - starW);
  g.fillText(l1, pad, ty + 48);
  if (stars != null) drawStars(g, pad + g.measureText(l1).width + 22, ty + 48 - 11, 15, stars);
  g.font = `500 25px ${sans}`;
  g.fillStyle = '#8c7d73';
  g.fillText(fit(g, line2, textW), pad, ty + 86);
  if (stamp) {
    g.font = `700 19px ${sans}`;
    g.fillStyle = 'rgba(43,36,32,0.4)';
    g.fillText(fit(g, stamp.toUpperCase(), textW), pad, ty + 122);
  }
  // escarapela con la nota
  if (score != null) rosette(g, W - pad - 80, pad + PH + 92, 68, score);
  return c;
}

// Cinco estrellas vectoriales (llenas, medias o vacías) centradas en la línea y.
function drawStars(g, x, y, r, value) {
  const star = (cx) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(cx + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  };
  for (let i = 0; i < 5; i++) {
    const cx = x + r + i * (r * 2 + 2);
    star(cx);
    g.fillStyle = '#e4d6c3';
    g.fill();
    const fillK = Math.max(0, Math.min(1, value - i));
    if (fillK > 0) {
      g.save();
      g.beginPath();
      g.rect(cx - r, y - r, r * 2 * fillK, r * 2);
      g.clip();
      star(cx);
      g.fillStyle = '#d9a43b';
      g.fill();
      g.restore();
    }
  }
}

function fit(g, text, maxW) {
  if (!text) return '';
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Escarapela de concurso (cintas + disco festoneado) con la nota adentro.
function rosette(g, x, y, r, score) {
  const col = score >= 85 ? '#3c8a4f' : score >= 70 ? '#2f6f6a' : score >= 55 ? '#d9a43b' : '#d2553f';
  g.save();
  g.translate(x, y);
  // cintas
  for (const s of [-1, 1]) {
    g.save();
    g.rotate(s * 0.32);
    g.fillStyle = shade(col, -0.18);
    g.beginPath();
    g.moveTo(-r * 0.28, 0);
    g.lineTo(r * 0.28, 0);
    g.lineTo(r * 0.28, r * 1.35);
    g.lineTo(0, r * 1.15);
    g.lineTo(-r * 0.28, r * 1.35);
    g.closePath();
    g.fill();
    g.restore();
  }
  // festón
  g.fillStyle = col;
  g.beginPath();
  const n = 24;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.9 : r;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.fillStyle = '#fffaf2';
  g.beginPath();
  g.arc(0, 0, r * 0.7, 0, Math.PI * 2);
  g.fill();
  g.setLineDash([6, 5]);
  g.strokeStyle = col;
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#2b2420';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(r * 0.62)}px 'Segoe UI', Inter, system-ui, sans-serif`;
  g.fillText(String(Math.round(score)), 0, -r * 0.04);
  g.font = `700 ${Math.round(r * 0.17)}px 'Segoe UI', Inter, system-ui, sans-serif`;
  g.fillStyle = '#8c7d73';
  g.fillText('/ 100', 0, r * 0.36);
  g.restore();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
