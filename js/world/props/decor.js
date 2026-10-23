// Decoración del taller: sombras de contacto, lámparas colgantes, cartel, afiches,
// pizarra de corcho, reloj, plantas en macetas, alfombra, perchero con remeras,
// tablero de herramientas y estantes con cosas.

import { THREE, Batch, std, phys, basic, mesh, V3, lathe, extrude, chrome, brass, blackPaint, woodMaterial, place, tube, PALETTE, rand, vc, RoundedBoxGeometry as RoundedBox } from './common.js';
import { drawTexture, corkTextures, softSprite } from './textures.js';
import { foldedStack } from './furniture.js';
import { ribbonGeometry, tapeTexture } from './cuttingTools.js';
import { getFabricMaterial, getWeaveNormalTexture } from '../../materials/fabric.js';
import { rng } from '../../core/utils.js';

// ---------------------------------------------------------------------------
// Sombras de contacto (un solo mesh para todas)
// ---------------------------------------------------------------------------

function shadowTexture() {
  return drawTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.filter = 'blur(14px)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
      ctx.filter = 'none';
    },
    { key: 'sombra-contacto' },
  );
}

export function createContactShadows(list) {
  const b = new Batch();
  for (const s of list) {
    const g = new THREE.PlaneGeometry(s.w * 1.45, s.d * 1.45);
    b.add(g, s.round ? roundShadowMat(s.o ?? 0.5) : rectShadowMat(s.o ?? 0.5), { p: [s.x, s.y ?? 0.0025, s.z], r: [-Math.PI / 2, 0, s.ry || 0], uv: 'keep', receive: false });
    g.dispose();
  }
  const group = new THREE.Group();
  group.name = 'sombras-contacto';
  for (const m of b.flush(group, 'sombras')) m.renderOrder = 1;
  return group;
}
const shadowMats = new Map();
function rectShadowMat(o) {
  const k = `r${Math.round(o * 10)}`;
  if (!shadowMats.has(k)) shadowMats.set(k, basic(`sombra-rect-${k}`, { map: shadowTexture(), color: '#1c130b', transparent: true, opacity: Math.round(o * 10) / 10, depthWrite: false, fog: false }));
  return shadowMats.get(k);
}
function roundShadowMat(o) {
  const k = `c${Math.round(o * 10)}`;
  if (!shadowMats.has(k)) shadowMats.set(k, basic(`sombra-red-${k}`, { map: softSprite('sombra', 'rgba(0,0,0,1)', 'rgba(0,0,0,0)'), color: '#1c130b', transparent: true, opacity: Math.round(o * 10) / 10, depthWrite: false, fog: false }));
  return shadowMats.get(k);
}

// ---------------------------------------------------------------------------
// Lámpara colgante esmaltada
// ---------------------------------------------------------------------------

// Las partes fijas van al lote `b` (si se pasa); el grupo devuelto tiene foco + luz.
export function createPendantLamp({ x, z, y = 2.3, color = PALETTE.teal, intensity = 4.5, ceiling = 3.2, b = null }) {
  const group = new THREE.Group();
  group.name = 'lampara';
  group.position.set(x, y, z);
  const own = !b;
  if (own) b = new Batch();
  const shadeOut = vc('esmalte');
  const shadeIn = std('lampara-interior', { color: '#fbf6ec', roughness: 0.5, emissive: '#fff1d6', emissiveIntensity: 0.35, side: THREE.BackSide });
  const prof = [[0.03, 0.16], [0.035, 0.14], [0.05, 0.115], [0.11, 0.07], [0.17, 0.02], [0.19, 0.0], [0.192, -0.004]];
  const o = own ? [0, 0, 0] : [x, y, z];
  const at = (dx, dy, dz) => [o[0] + dx, o[1] + dy, o[2] + dz];
  const g1 = lathe(prof, 40);
  b.add(g1, shadeOut, { color, p: at(0, 0, 0), uv: 'keep' });
  const g2 = lathe(prof.map(([r, yy]) => [r - 0.002, yy]), 40);
  b.add(g2, shadeIn, { p: at(0, 0, 0), uv: 'keep' });
  b.cyl(0.032, 0.03, 0.06, brass(), { p: at(0, 0.19, 0), seg: 20, uv: 'keep' });
  const len = ceiling - (y + 0.22);
  b.cyl(0.0035, 0.0035, len, blackPaint(), { p: at(0, 0.22 + len / 2, 0), seg: 6, uv: 'keep' });
  b.cyl(0.05, 0.05, 0.03, shadeOut, { color, p: at(0, ceiling - y - 0.015, 0), seg: 20, uv: 'keep' });
  g1.dispose();
  g2.dispose();
  if (own) b.flush(group, 'lampara');
  const bulb = mesh(new THREE.SphereGeometry(0.045, 20, 14), std('foco', { color: '#fff5e0', emissive: '#ffe3b0', emissiveIntensity: 2.2 }), { p: [0, 0.07, 0] });
  group.add(bulb);
  const light = new THREE.PointLight('#ffcf94', intensity, 6.5, 2);
  light.position.set(0, 0.05, 0);
  group.add(light);
  return { group, light, bulb };
}

// ---------------------------------------------------------------------------
// Cartel "Taller de Remeras"
// ---------------------------------------------------------------------------

function signTexture() {
  return drawTexture(1024, 224, (ctx, w, h) => {
    // tabla pintada terracota con veta
    const r = rng(3);
    ctx.fillStyle = '#b8603e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = `rgba(${r() < 0.5 ? '60,25,10' : '255,220,190'},${0.04 + r() * 0.05})`;
      ctx.lineWidth = 1 + r() * 2;
      const y = r() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 14, w * 0.7, y + (r() - 0.5) * 14, w, y + (r() - 0.5) * 8);
      ctx.stroke();
    }
    // filete
    ctx.strokeStyle = '#f1e3c8';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 16, w - 36, h - 32);
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 28, w - 60, h - 56);
    ctx.setLineDash([]);
    // texto
    ctx.fillStyle = '#f6ead2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(60,20,5,0.5)';
    ctx.shadowOffsetY = 3;
    ctx.shadowBlur = 2;
    ctx.font = 'italic 700 104px Georgia, "Times New Roman", serif';
    ctx.fillText('Taller de Remeras', w / 2 + 20, h * 0.47);
    ctx.shadowColor = 'transparent';
    ctx.font = '600 24px sans-serif';
    ctx.fillStyle = '#f1d9b5';
    ctx.fillText('·  HECHO A MANO  ·  CORTE  ·  COSTURA  ·  ESTAMPA  ·', w / 2 + 20, h * 0.82);
    // tijera dibujada a la izquierda
    ctx.save();
    ctx.translate(92, h * 0.47);
    ctx.rotate(-0.5);
    ctx.strokeStyle = '#f6ead2';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(-26, 18, 14, 0, Math.PI * 2);
    ctx.arc(-26, -18, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-14, 10);
    ctx.lineTo(44, -14);
    ctx.moveTo(-14, -10);
    ctx.lineTo(44, 14);
    ctx.stroke();
    ctx.restore();
  }, { key: 'cartel' });
}

// ---------------------------------------------------------------------------
// Afiches
// ---------------------------------------------------------------------------

function sizeChartTexture() {
  return drawTexture(400, 520, (ctx, w, h) => {
    ctx.fillStyle = '#f4ecdc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PALETTE.teal;
    ctx.fillRect(0, 0, w, 86);
    ctx.fillStyle = '#fff';
    ctx.font = '800 40px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Guía de talles', w / 2, 56);
    // remera esquemática
    ctx.strokeStyle = '#2b2420';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const cx = w / 2;
    ctx.moveTo(cx - 40, 110);
    ctx.lineTo(cx - 100, 130);
    ctx.lineTo(cx - 130, 185);
    ctx.lineTo(cx - 95, 200);
    ctx.lineTo(cx - 80, 170);
    ctx.lineTo(cx - 80, 290);
    ctx.lineTo(cx + 80, 290);
    ctx.lineTo(cx + 80, 170);
    ctx.lineTo(cx + 95, 200);
    ctx.lineTo(cx + 130, 185);
    ctx.lineTo(cx + 100, 130);
    ctx.lineTo(cx + 40, 110);
    ctx.quadraticCurveTo(cx, 140, cx - 40, 110);
    ctx.stroke();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = PALETTE.terracotta;
    ctx.beginPath();
    ctx.moveTo(cx - 80, 215);
    ctx.lineTo(cx + 80, 215);
    ctx.moveTo(cx + 100, 120);
    ctx.lineTo(cx + 100, 290);
    ctx.stroke();
    ctx.setLineDash([]);
    // tabla
    const rows = [['', 'Pecho', 'Largo'], ['XS', '46', '66'], ['S', '49', '69'], ['M', '52', '72'], ['L', '55', '74'], ['XL', '58', '76'], ['XXL', '61', '78']];
    ctx.font = '700 22px sans-serif';
    rows.forEach((r, i) => {
      const y = 330 + i * 27;
      if (i % 2) {
        ctx.fillStyle = 'rgba(95,154,143,0.15)';
        ctx.fillRect(40, y - 18, w - 80, 26);
      }
      ctx.fillStyle = i === 0 ? PALETTE.terracotta : '#2b2420';
      r.forEach((c, j) => ctx.fillText(c, 90 + j * 115, y));
    });
  }, { key: 'afiche-talles' });
}

function careTexture() {
  return drawTexture(400, 400, (ctx, w, h) => {
    ctx.fillStyle = '#eef0ea';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2420';
    ctx.font = '800 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Cuidado de prendas', w / 2, 48);
    ctx.strokeStyle = '#2b2420';
    ctx.lineWidth = 5;
    const cell = (i, j, draw, label) => {
      const x = 70 + i * 130;
      const y = 120 + j * 140;
      ctx.save();
      ctx.translate(x, y);
      draw();
      ctx.restore();
      ctx.font = '600 17px sans-serif';
      ctx.fillStyle = '#5a4a3a';
      ctx.fillText(label, x, y + 62);
      ctx.fillStyle = '#2b2420';
    };
    // tina con 30
    cell(0, 0, () => {
      ctx.beginPath();
      ctx.moveTo(-40, -20);
      ctx.lineTo(-30, 30);
      ctx.lineTo(30, 30);
      ctx.lineTo(40, -20);
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) ctx.lineTo(-40 + k * 10, -20 + (k % 2 ? -6 : 0));
      ctx.stroke();
      ctx.font = '800 24px sans-serif';
      ctx.fillText('30', 0, 14);
    }, 'Lavar 30°');
    // plancha 2 puntos
    cell(1, 0, () => {
      ctx.beginPath();
      ctx.moveTo(-40, 25);
      ctx.lineTo(40, 25);
      ctx.lineTo(30, -10);
      ctx.lineTo(-20, -10);
      ctx.quadraticCurveTo(-38, -8, -40, 25);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-8, 10, 4, 0, Math.PI * 2);
      ctx.arc(10, 10, 4, 0, Math.PI * 2);
      ctx.fill();
    }, 'Planchar ••');
    // triángulo tachado
    cell(2, 0, () => {
      ctx.beginPath();
      ctx.moveTo(0, -32);
      ctx.lineTo(36, 28);
      ctx.lineTo(-36, 28);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-36, -30);
      ctx.lineTo(36, 30);
      ctx.moveTo(36, -30);
      ctx.lineTo(-36, 30);
      ctx.stroke();
    }, 'Sin lavandina');
    // secado a la sombra
    cell(0, 1, () => {
      ctx.strokeRect(-34, -30, 68, 60);
      ctx.beginPath();
      ctx.moveTo(-34, -14);
      ctx.lineTo(-18, -30);
      ctx.moveTo(-14, -6);
      ctx.lineTo(14, -6);
      ctx.moveTo(-14, 4);
      ctx.lineTo(14, 4);
      ctx.stroke();
    }, 'Secar a la sombra');
    // secarropas tachado
    cell(1, 1, () => {
      ctx.strokeRect(-32, -32, 64, 64);
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.moveTo(-32, -32);
      ctx.lineTo(32, 32);
      ctx.moveTo(32, -32);
      ctx.lineTo(-32, 32);
      ctx.stroke();
    }, 'Sin secarropas');
    // círculo P
    cell(2, 1, () => {
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '800 30px sans-serif';
      ctx.fillText('P', 0, 11);
    }, 'Limpieza seca');
  }, { key: 'afiche-cuidado' });
}

function colorWheelTexture() {
  return drawTexture(400, 520, (ctx, w, h) => {
    ctx.fillStyle = '#f4ecdc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2420';
    ctx.font = '800 36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Círculo cromático', w / 2, 52);
    const cx = w / 2;
    const cy = 250;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = `hsl(${i * 30}, 70%, 52%)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 150, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `hsl(${i * 30}, 60%, 72%)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 90, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#f4ecdc';
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 20px sans-serif';
    ctx.fillStyle = '#5a4a3a';
    ctx.fillText('Complementarios: opuestos', cx, 450);
    ctx.fillText('Análogos: vecinos', cx, 480);
  }, { key: 'afiche-color' });
}

function framedPoster(b, { x, y, z, w, h, tex, ry = 0, frame = '#3b2a1e' }) {
  const M = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const fm = vc('plastico');
  const t = 0.025;
  const parts = [
    [new THREE.BoxGeometry(w + t * 2, t, 0.02), fm, [0, h / 2 + t / 2, 0.01]],
    [new THREE.BoxGeometry(w + t * 2, t, 0.02), fm, [0, -h / 2 - t / 2, 0.01]],
    [new THREE.BoxGeometry(t, h, 0.02), fm, [-w / 2 - t / 2, 0, 0.01]],
    [new THREE.BoxGeometry(t, h, 0.02), fm, [w / 2 + t / 2, 0, 0.01]],
    [new THREE.PlaneGeometry(w, h), std(`afiche-${tex.uuid}`, { map: tex, roughness: 0.75 }), [0, 0, 0.006]],
  ];
  for (const [g, m, p] of parts) {
    b.add(g, m, { color: frame, matrix: new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).premultiply(M), uv: g.type === 'PlaneGeometry' ? 'keep' : 'box', cast: false });
    g.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pizarra de corcho con moldes, fotos y muestras
// ---------------------------------------------------------------------------

function polaroidTexture(seed) {
  return drawTexture(160, 190, (ctx, w, h) => {
    const r = rng(seed);
    ctx.fillStyle = '#f7f4ee';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 12, 0, 150);
    const hue = Math.floor(r() * 360);
    g.addColorStop(0, `hsl(${hue},45%,72%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360},40%,48%)`);
    ctx.fillStyle = g;
    ctx.fillRect(12, 12, w - 24, 138);
    // una remera en la foto
    ctx.fillStyle = ['#f3f1ea', '#1e1e21', '#e5732b', '#8fd0b8', '#f1cc4e', '#2f5cb6'][seed % 6];
    const cx = w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 18, 40);
    ctx.lineTo(cx - 46, 52);
    ctx.lineTo(cx - 54, 76);
    ctx.lineTo(cx - 36, 82);
    ctx.lineTo(cx - 32, 70);
    ctx.lineTo(cx - 32, 130);
    ctx.lineTo(cx + 32, 130);
    ctx.lineTo(cx + 32, 70);
    ctx.lineTo(cx + 36, 82);
    ctx.lineTo(cx + 54, 76);
    ctx.lineTo(cx + 46, 52);
    ctx.lineTo(cx + 18, 40);
    ctx.quadraticCurveTo(cx, 52, cx - 18, 40);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(cx, 88, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a4a3a';
    ctx.font = 'italic 16px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(['¡Primera venta!', 'Feria 2026', 'Pedido Caro', 'Serigrafía', 'Bordado', 'Muestra'][seed % 6], cx, 174);
  });
}

function polaroidAtlas() {
  return drawTexture(320, 380, (ctx) => {
    for (let i = 0; i < 4; i++) {
      const t = polaroidTexture(i + 1);
      ctx.drawImage(t.userData.canvas, (i % 2) * 160, Math.floor(i / 2) * 190);
      t.dispose();
    }
  }, { key: 'polaroids' });
}

function patternPieceTexture() {
  return drawTexture(256, 320, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#d9b98a';
    ctx.strokeStyle = '#6b5236';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(60, 20);
    ctx.quadraticCurveTo(128, 70, 196, 20);
    ctx.lineTo(236, 40);
    ctx.quadraticCurveTo(210, 90, 222, 120);
    ctx.lineTo(228, 300);
    ctx.lineTo(28, 300);
    ctx.lineTo(34, 120);
    ctx.quadraticCurveTo(46, 90, 20, 40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = '#8c6a43';
    ctx.strokeRect(44, 130, 168, 156);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4a3826';
    ctx.font = '700 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FRENTE', w / 2, 190);
    ctx.font = '500 18px sans-serif';
    ctx.fillText('Talle M · cortar 1', w / 2, 218);
    ctx.beginPath();
    ctx.moveTo(w / 2, 236);
    ctx.lineTo(w / 2, 284);
    ctx.moveTo(w / 2 - 8, 246);
    ctx.lineTo(w / 2, 236);
    ctx.lineTo(w / 2 + 8, 246);
    ctx.stroke();
  }, { key: 'molde-corcho' });
}

function noteTexture() {
  return drawTexture(160, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f7e27a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3428';
    ctx.font = 'italic 20px "Comic Sans MS", cursive';
    ['Comprar', 'hilo rojo', '+ agujas', 'punta bola!'].forEach((t, i) => ctx.fillText(t, 14, 36 + i * 30));
  }, { key: 'nota-corcho' });
}

export function createCorkBoard({ x, y, z, w = 1.3, h = 0.8 }) {
  const group = new THREE.Group();
  group.name = 'pizarra-corcho';
  group.position.set(x, y, z);
  const b = new Batch();
  const ck = corkTextures();
  const cork = std('corcho', { map: ck.map, normalMap: ck.normalMap, roughness: 0.95 });
  const frame = woodMaterial('roble', { key: '-marco-corcho' });
  b.box(w, h, 0.012, cork, { p: [0, 0, 0.006], uv: 'box' });
  for (const sy of [-1, 1]) b.box(w + 0.06, 0.03, 0.03, frame, { p: [0, sy * (h / 2 + 0.015), 0.015], grain: 'x', cast: true });
  for (const sx of [-1, 1]) b.box(0.03, h, 0.03, frame, { p: [sx * (w / 2 + 0.015), 0, 0.015], grain: 'y' });
  const zf = 0.0135;
  const pinCols = ['#c42b2b', '#2f5cb6', '#f1cc4e', '#3f9a6c'];
  const pin = (px, py, k) => b.cyl(0.006, 0.007, 0.008, vc('plastico'), { color: pinCols[k % 4], p: [px, py, zf + 0.006], r: [Math.PI / 2, 0, 0], seg: 10 });
  const card = (px, py, pw, ph, mat, rot, k) => {
    const g = new THREE.PlaneGeometry(pw, ph);
    b.add(g, mat, { p: [px, py, zf + 0.0008 + k * 0.0004], r: [0, 0, rot], uv: 'keep' });
    g.dispose();
    pin(px + Math.sin(-rot) * ph * 0.42, py + Math.cos(rot) * ph * 0.42, k);
  };
  card(-0.42, 0.02, 0.32, 0.4, std('molde-corcho', { map: patternPieceTexture(), transparent: true, roughness: 0.85 }), 0.06, 0);
  // fotos: un solo atlas 2×2
  const atlas = polaroidAtlas();
  const polaroidMat = std('polaroids', { map: atlas, roughness: 0.6 });
  [0, 1, 2, 3].forEach((i) => {
    const g = new THREE.PlaneGeometry(0.13, 0.155);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, ((i % 2) + uv.getX(k)) / 2, (1 - Math.floor(i / 2) + uv.getY(k)) / 2);
    const px = -0.08 + (i % 2) * 0.17;
    const py = 0.17 - Math.floor(i / 2) * 0.22;
    const rot = (i % 2 ? -1 : 1) * 0.07;
    b.add(g, polaroidMat, { p: [px, py, zf + 0.0008 + (i + 1) * 0.0004], r: [0, 0, rot], uv: 'keep' });
    g.dispose();
    pin(px + Math.sin(-rot) * 0.155 * 0.42, py + Math.cos(rot) * 0.155 * 0.42, i + 1);
  });
  card(0.32, 0.2, 0.13, 0.13, std('nota-corcho', { map: noteTexture(), roughness: 0.8 }), -0.05, 2);
  // muestras de tela (cuadraditos)
  const sw = ['#f3f1ea', '#1f2a46', '#e5732b', '#8fd0b8', '#cf9a2c', '#6a1f2c'];
  sw.forEach((c, i) => {
    const g = new THREE.PlaneGeometry(0.07, 0.07);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.07, uv.getY(k) * 0.07);
    b.add(g, getFabricMaterial(['algodon_jersey', 'pique', 'lino'][i % 3], '#ffffff', { side: THREE.FrontSide, vertexColors: true }), { color: c, p: [0.27 + (i % 3) * 0.085, -0.06 - Math.floor(i / 3) * 0.1, zf + 0.001], r: [0, 0, (i - 2.5) * 0.04], uv: 'keep' });
    g.dispose();
    pin(0.27 + (i % 3) * 0.085, -0.03 - Math.floor(i / 3) * 0.1, i);
  });
  b.flush(group, 'corcho');
  return { group };
}

// ---------------------------------------------------------------------------
// Reloj de pared
// ---------------------------------------------------------------------------

export function createClock({ x, y, z, r = 0.17 }) {
  const group = new THREE.Group();
  group.name = 'reloj';
  group.position.set(x, y, z);
  const face = drawTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#f6efe1';
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2420';
    ctx.font = '700 30px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      ctx.fillText(String(i), c + Math.cos(a) * 96, c + Math.sin(a) * 96);
    }
    ctx.font = 'italic 16px Georgia, serif';
    ctx.fillText('Taller', c, c + 48);
  }, { key: 'reloj-cara' });
  group.add(mesh(new THREE.TorusGeometry(r, 0.018, 12, 48), std('reloj-aro', { color: PALETTE.terracotta, roughness: 0.35, metalness: 0.2 }), { p: [0, 0, 0.02], cast: true }));
  group.add(mesh(new THREE.CircleGeometry(r, 48), std('reloj-cara', { map: face, roughness: 0.5 }), { p: [0, 0, 0.012] }));
  const hand = (len, wd, rot, col) => {
    const g = new THREE.BoxGeometry(wd, len, 0.003);
    g.translate(0, len / 2 - 0.01, 0);
    const m = mesh(g, std(`aguja-reloj-${col}`, { color: col, roughness: 0.4 }), { p: [0, 0, 0.018] });
    m.rotation.z = rot;
    group.add(m);
    return m;
  };
  const hourH = hand(r * 0.5, 0.008, 0, '#2b2420');
  const minH = hand(r * 0.75, 0.005, 0, '#2b2420');
  const secH = hand(r * 0.8, 0.002, 0, PALETTE.terracotta);
  return {
    group,
    update() {
      const d = new Date();
      const s = d.getSeconds() + d.getMilliseconds() / 1000;
      const m = d.getMinutes() + s / 60;
      const h = (d.getHours() % 12) + m / 60;
      secH.rotation.z = -(s / 60) * Math.PI * 2;
      minH.rotation.z = -(m / 60) * Math.PI * 2;
      hourH.rotation.z = -(h / 12) * Math.PI * 2;
    },
  };
}

// ---------------------------------------------------------------------------
// Plantas
// ---------------------------------------------------------------------------

function leafTexture(kind) {
  return drawTexture(128, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    const [a, c] = kind === 'lengua' ? ['#3f6b35', '#5f8f45'] : ['#2f5d2c', '#4f8a3c'];
    g.addColorStop(0, a);
    g.addColorStop(0.5, c);
    g.addColorStop(1, a);
    ctx.fillStyle = g;
    ctx.beginPath();
    if (kind === 'lengua') {
      ctx.moveTo(w * 0.5, 2);
      ctx.quadraticCurveTo(w * 0.95, h * 0.4, w * 0.85, h);
      ctx.lineTo(w * 0.15, h);
      ctx.quadraticCurveTo(w * 0.05, h * 0.4, w * 0.5, 2);
    } else {
      ctx.moveTo(w * 0.5, 4);
      ctx.bezierCurveTo(w * 1.05, h * 0.2, w * 1.0, h * 0.75, w * 0.5, h - 2);
      ctx.bezierCurveTo(w * 0.0, h * 0.75, -w * 0.05, h * 0.2, w * 0.5, 4);
    }
    ctx.fill();
    ctx.strokeStyle = kind === 'lengua' ? 'rgba(220,230,170,0.35)' : 'rgba(200,230,170,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 6);
    ctx.lineTo(w * 0.5, h - 4);
    ctx.stroke();
    if (kind === 'lengua') {
      ctx.strokeStyle = 'rgba(30,50,25,0.45)';
      ctx.lineWidth = 4;
      for (let y = 20; y < h; y += 22) {
        ctx.beginPath();
        ctx.moveTo(w * 0.2, y);
        ctx.quadraticCurveTo(w * 0.5, y - 8, w * 0.8, y);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = 1.5;
      for (let y = 30; y < h - 20; y += 22) {
        ctx.beginPath();
        ctx.moveTo(w * 0.5, y + 14);
        ctx.quadraticCurveTo(w * 0.7, y + 4, w * 0.92, y - 6);
        ctx.moveTo(w * 0.5, y + 14);
        ctx.quadraticCurveTo(w * 0.3, y + 4, w * 0.08, y - 6);
        ctx.stroke();
      }
    }
  }, { key: `hoja-${kind}` });
}

const leafMats = {};
function leafMaterial(kind) {
  if (!leafMats[kind]) leafMats[kind] = std(`hoja-${kind}`, { map: leafTexture(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  return leafMats[kind];
}

// Hoja curvada: plano con la base en el origen que crece hacia +Y y se arquea hacia +Z.
function leafGeometry(curl = 0.25) {
  const g = new THREE.PlaneGeometry(1, 1, 2, 6);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const x = p.getX(i);
    p.setZ(i, curl * y * y + Math.abs(x) * 0.15);
  }
  g.computeVertexNormals();
  return g;
}

export function addPlant(b, { x, z, y = 0, kind = 'arbusto', height = 1.0, pot = PALETTE.terracotta, potR = 0.17, seed = 1, scale = 1 }) {
  const r = rng(seed);
  const potMat = vc('ceramica');
  const pr = potR * scale;
  const ph = pr * 1.25;
  const potG = lathe([[0, 0], [pr * 0.72, 0], [pr * 0.9, ph * 0.9], [pr, ph * 0.92], [pr, ph], [pr * 0.92, ph], [pr * 0.88, ph * 0.9], [0, ph * 0.9]], 28);
  b.add(potG, potMat, { color: pot, p: [x, y, z], cast: true, uv: 'keep' });
  potG.dispose();
  b.cyl(pr * 0.86, pr * 0.86, 0.01, std('tierra', { color: '#3b2a1e', roughness: 1 }), { p: [x, y + ph * 0.86, z], seg: 20 });
  const top = y + ph * 0.86;
  const leaf = leafGeometry(kind === 'lengua' ? 0.04 : 0.35);
  const mat = leafMaterial(kind === 'lengua' ? 'lengua' : 'ancha');
  const stemMat = std('tallo', { color: '#4d6b33', roughness: 0.7 });
  if (kind === 'lengua') {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const lh = height * scale * (0.55 + r() * 0.45);
      const lw = 0.07 * scale * (0.8 + r() * 0.4);
      const tilt = 0.06 + r() * 0.22;
      const m = new THREE.Matrix4().compose(
        V3(x + Math.cos(a) * pr * 0.35 * r(), top, z + Math.sin(a) * pr * 0.35 * r()),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * Math.sin(a), a, tilt * Math.cos(a), 'YXZ')),
        V3(lw, lh, lw),
      );
      b.add(leaf, mat, { matrix: m, uv: 'keep' });
    }
  } else {
    const stems = Math.round(9 * scale + 3);
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * Math.PI * 2 + r() * 0.5;
      const sh = height * scale * (0.45 + r() * 0.55);
      const spread = (0.12 + r() * 0.22) * scale;
      const p0 = V3(x + Math.cos(a) * 0.02, top, z + Math.sin(a) * 0.02);
      const p2 = V3(x + Math.cos(a) * spread, top + sh, z + Math.sin(a) * spread);
      const p1 = V3(x + Math.cos(a) * spread * 0.3, top + sh * 0.6, z + Math.sin(a) * spread * 0.3);
      const st = tube([p0, p1, p2], 0.006 * scale, { tubular: 8, radial: 5 });
      b.add(st, stemMat, { uv: 'keep' });
      st.dispose();
      const ls = (0.16 + r() * 0.1) * scale;
      const m = new THREE.Matrix4().compose(
        p2,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 - r() * 0.5, a + Math.PI / 2 + (r() - 0.5) * 0.6, 0, 'YXZ')),
        V3(ls * 0.75, ls, ls),
      );
      b.add(leaf, mat, { matrix: m, uv: 'keep', cast: true });
      // hojitas extra a lo largo del tallo
      if (r() < 0.7) {
        const q = p1.clone().lerp(p2, 0.4);
        const m2 = new THREE.Matrix4().compose(q, new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, a - Math.PI / 2, 0, 'YXZ')), V3(ls * 0.55, ls * 0.7, ls * 0.7));
        b.add(leaf, mat, { matrix: m2, uv: 'keep' });
      }
    }
  }
  leaf.dispose();
}

// ---------------------------------------------------------------------------
// Alfombra
// ---------------------------------------------------------------------------

function rugTexture() {
  return drawTexture(1024, 700, (ctx, w, h) => {
    const cols = { base: '#d9c7a6', a: PALETTE.terracotta, b: PALETTE.teal, c: PALETTE.mustard, d: '#5a3d2b' };
    ctx.fillStyle = cols.base;
    ctx.fillRect(0, 0, w, h);
    const band = (inset, col, wd) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = wd;
      ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    };
    band(14, cols.d, 20);
    band(44, cols.a, 22);
    band(70, cols.c, 6);
    // rombos kilim
    const row = (y, size, col) => {
      for (let x = 120; x < w - 100; x += size * 1.6) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, y - size / 2);
        ctx.lineTo(x + size / 2, y);
        ctx.lineTo(x, y + size / 2);
        ctx.lineTo(x - size / 2, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = cols.base;
        ctx.fillRect(x - size * 0.12, y - size * 0.12, size * 0.24, size * 0.24);
      }
    };
    row(140, 60, cols.b);
    row(h - 140, 60, cols.b);
    ctx.fillStyle = cols.a;
    ctx.beginPath();
    ctx.moveTo(w / 2, 190);
    ctx.lineTo(w / 2 + 260, h / 2);
    ctx.lineTo(w / 2, h - 190);
    ctx.lineTo(w / 2 - 260, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = cols.c;
    ctx.beginPath();
    ctx.moveTo(w / 2, 240);
    ctx.lineTo(w / 2 + 190, h / 2);
    ctx.lineTo(w / 2, h - 240);
    ctx.lineTo(w / 2 - 190, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = cols.b;
    ctx.beginPath();
    ctx.moveTo(w / 2, 290);
    ctx.lineTo(w / 2 + 110, h / 2);
    ctx.lineTo(w / 2, h - 290);
    ctx.lineTo(w / 2 - 110, h / 2);
    ctx.closePath();
    ctx.fill();
    // textura de trama
    const r = rng(8);
    for (let i = 0; i < 26000; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 2, 1);
    }
  }, { key: 'alfombra' });
}

export function createRug({ x, z, w = 2.8, d = 1.9, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'alfombra';
  place(group, [x, 0, z], [0, ry, 0]);
  const weave = getWeaveNormalTexture('lino').clone();
  weave.repeat.set(w / 0.012, d / 0.012);
  weave.needsUpdate = true;
  const mat = std('alfombra', { map: rugTexture(), normalMap: weave, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 });
  const g = new RoundedBox(w, 0.008, d, 1, 0.003);
  group.add(mesh(g, mat, { p: [0, 0.004, 0], receive: true }));
  // flecos
  const fr = new Batch();
  const fringe = std('flecos', { color: '#e6d8bd', roughness: 0.95 });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 46; i++) {
      const zz = -d / 2 + 0.03 + (i / 45) * (d - 0.06);
      fr.box(0.06, 0.003, 0.008, fringe, { p: [sx * (w / 2 + 0.028), 0.0016, zz], r: [0, (rand() - 0.5) * 0.3, 0], uv: 'keep' });
    }
  }
  fr.flush(group, 'flecos');
  return { group };
}

// ---------------------------------------------------------------------------
// Perchero con remeras de colores
// ---------------------------------------------------------------------------

function shirtShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.08, 0);
  s.quadraticCurveTo(0, -0.07, 0.08, 0);
  s.lineTo(0.2, -0.04);
  s.lineTo(0.3, -0.2);
  s.lineTo(0.22, -0.25);
  s.lineTo(0.18, -0.17);
  s.lineTo(0.2, -0.7);
  s.lineTo(-0.2, -0.7);
  s.lineTo(-0.18, -0.17);
  s.lineTo(-0.22, -0.25);
  s.lineTo(-0.3, -0.2);
  s.lineTo(-0.2, -0.04);
  s.closePath();
  return s;
}

export function createClothesRack({ x, z, length = 1.3, ry = 0, colors }) {
  const group = new THREE.Group();
  group.name = 'perchero';
  place(group, [x, 0, z], [0, ry, 0]);
  const b = new Batch();
  const metalM = std('perchero-metal', { color: '#2d2c2b', roughness: 0.4, metalness: 0.7 });
  const H = 1.62;
  for (const sx of [-1, 1]) {
    b.cyl(0.013, 0.013, H, metalM, { p: [sx * length / 2, H / 2, 0], seg: 10, cast: true });
    b.cyl(0.012, 0.012, 0.5, metalM, { p: [sx * length / 2, 0.05, 0], r: [Math.PI / 2, 0, 0], seg: 10 });
    for (const sz of [-1, 1]) b.cyl(0.022, 0.022, 0.03, std('rueda', { color: '#1c1c1e', roughness: 0.8 }), { p: [sx * length / 2, 0.022, sz * 0.24], r: [0, 0, Math.PI / 2], seg: 12 });
  }
  b.cyl(0.012, 0.012, length + 0.04, chrome(), { p: [0, H, 0], r: [0, 0, Math.PI / 2], seg: 12, cast: true });
  b.cyl(0.01, 0.01, length, metalM, { p: [0, 0.07, 0], r: [0, 0, Math.PI / 2], seg: 8 });
  // remeras colgando (planos perpendiculares a la barra)
  const shape = shirtShape();
  const sg = extrude(shape, 0.03, { bevel: 0.012, bevelSegments: 3, curveSegments: 10 });
  sg.translate(0, 0, -0.015);
  const hangerMat = woodMaterial('haya', { key: '-percha' });
  const hookMat = chrome();
  const n = colors.length;
  colors.forEach((c, i) => {
    const xx = -length / 2 + 0.1 + (i / (n - 1)) * (length - 0.2);
    const ry2 = Math.PI / 2 + (rand() - 0.5) * 0.25;
    const top = H - 0.05;
    b.add(sg, getFabricMaterial(i % 4 === 3 ? 'pique' : 'algodon_jersey', '#ffffff', { side: THREE.FrontSide, vertexColors: true }), { color: c, p: [xx, top - 0.02, 0], r: [0, ry2, (rand() - 0.5) * 0.04], uv: 'keep', cast: i % 3 === 0 });
    const hanger = tube([[-0.2, -0.045, 0], [-0.1, -0.01, 0], [0, 0.0, 0], [0.1, -0.01, 0], [0.2, -0.045, 0]], 0.008, { tubular: 12, radial: 6 });
    b.add(hanger, hangerMat, { p: [xx, top, 0], r: [0, ry2, 0], uv: 'keep' });
    hanger.dispose();
    const hook = tube([[0, 0.0, 0], [0, 0.04, 0], [0.012, 0.055, 0], [0.02, 0.045, 0]], 0.0018, { tubular: 10, radial: 4 });
    b.add(hook, hookMat, { p: [xx, top, 0], r: [0, ry2, 0], uv: 'keep' });
    hook.dispose();
  });
  sg.dispose();
  b.flush(group, 'perchero');
  return { group };
}

// ---------------------------------------------------------------------------
// Tablero de herramientas (pegboard) con curvas de sastre y cinta colgada
// ---------------------------------------------------------------------------

function pegboardTexture() {
  return drawTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d8c3a2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6b5236';
    for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { key: 'pegboard' });
}

export function createPegboard({ x, y, z, w = 0.8, h = 0.9 }) {
  const group = new THREE.Group();
  group.name = 'tablero-herramientas';
  group.position.set(x, y, z);
  const b = new Batch();
  const tex = pegboardTexture().clone();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 0.16, h / 0.16);
  tex.needsUpdate = true;
  b.box(w, h, 0.01, std('pegboard', { map: tex, roughness: 0.85 }), { p: [0, 0, 0.005], uv: 'keep' });
  const frame = woodMaterial('nogal', { key: '-pegboard' });
  for (const sy of [-1, 1]) b.box(w + 0.04, 0.02, 0.02, frame, { p: [0, sy * (h / 2 + 0.01), 0.01], grain: 'x' });
  for (const sx of [-1, 1]) b.box(0.02, h, 0.02, frame, { p: [sx * (w / 2 + 0.01), 0, 0.01], grain: 'y' });
  const hookM = chrome();
  const hook = (hx, hy) => {
    const t = tube([[hx, hy, 0.01], [hx, hy, 0.05], [hx, hy + 0.02, 0.06]], 0.0022, { tubular: 8, radial: 4 });
    b.add(t, hookM, { uv: 'keep' });
    t.dispose();
  };
  // curva de sastre ("pistola")
  const curve = new THREE.Shape();
  curve.moveTo(0, 0);
  curve.bezierCurveTo(0.08, 0.02, 0.16, 0.12, 0.2, 0.3);
  curve.bezierCurveTo(0.21, 0.36, 0.18, 0.4, 0.14, 0.38);
  curve.bezierCurveTo(0.12, 0.25, 0.06, 0.1, -0.01, 0.06);
  curve.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0.12, 0.24, 0.02, 0.06, 0, Math.PI * 2, false, -0.5);
  curve.holes.push(hole);
  const cg = extrude(curve, 0.003, { bevel: 0.0008, bevelSegments: 1 });
  b.add(cg, phys('acrilico-curva', { color: '#f2e7c9', roughness: 0.2, transparent: true, opacity: 0.85 }), { p: [0.06, -0.12, 0.05], r: [0, 0, 0.15], uv: 'keep' });
  cg.dispose();
  hook(0.2, 0.25);
  // cinta métrica doblada sobre un gancho: dos tiras que caen, de cara al frente
  const tapeMat = std('cinta-metrica', { map: tapeTexture(), roughness: 0.55, side: THREE.DoubleSide });
  const hx = -0.22;
  const hy = 0.3;
  hook(hx, hy);
  const c = new THREE.CatmullRomCurve3([
    V3(hx, hy - 0.38, 0.016),
    V3(hx, hy - 0.2, 0.018),
    V3(hx, hy + 0.004, 0.03),
    V3(hx, hy + 0.007, 0.05),
    V3(hx, hy - 0.02, 0.066),
    V3(hx + 0.006, hy - 0.25, 0.064),
    V3(hx + 0.012, hy - 0.46, 0.058),
  ]);
  const rg = ribbonGeometry(c, 0.016, V3(1, 0, 0), 70);
  b.add(rg, tapeMat, { uv: 'keep' });
  rg.dispose();
  // descosedor y tijera dentada
  b.cyl(0.004, 0.004, 0.09, std('descosedor', { color: PALETTE.terracotta, roughness: 0.35 }), { p: [0.32, 0.12, 0.03], r: [0, 0, 0.1], seg: 8 });
  hook(0.32, 0.18);
  b.flush(group, 'pegboard');
  return { group };
}

// ---------------------------------------------------------------------------
// Botellas de jabón, broches y toallas (estante del lavadero)
// ---------------------------------------------------------------------------

export function addLaundryShelfItems(b, { x, y, z }) {
  const bottle = (bx, col, h = 0.26, w = 0.11) => {
    b.box(w, h, 0.07, vc('plastico'), { color: col, p: [bx, y + h / 2, z], radius: 0.025, seg: 3, cast: true });
    b.cyl(0.02, 0.02, 0.03, vc('plastico'), { color: '#f4f2ec', p: [bx - w * 0.2, y + h + 0.015, z], seg: 12 });
    b.box(w * 0.7, h * 0.4, 0.002, vc('mate'), { color: '#f6f1e6', p: [bx, y + h * 0.45, z + 0.036] });
  };
  bottle(x - 0.28, '#5f9a8f');
  bottle(x - 0.15, '#f1efe8', 0.22, 0.1);
  // frasco con broches
  const jar = lathe([[0, 0], [0.05, 0], [0.052, 0.13], [0.04, 0.15], [0.04, 0.16]], 18);
  b.add(jar, phys('frasco-vidrio', { color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }), { p: [x + 0.02, y, z], uv: 'keep' });
  jar.dispose();
  const clipCols = ['#e5732b', '#f1cc4e', '#8fd0b8', '#f0a9c4'];
  for (let i = 0; i < 14; i++) {
    b.box(0.008, 0.06, 0.012, vc('plastico'), { color: clipCols[i % 4], p: [x + 0.02 + (rand() - 0.5) * 0.06, y + 0.03 + rand() * 0.06, z + (rand() - 0.5) * 0.06], r: [rand() * 2, rand() * 3, rand() * 2] });
  }
  // toallas dobladas
  foldedStack(b, { x: x + 0.22, y, z, w: 0.26, d: 0.18, colors: ['#f3f1ea', '#93c6e6', '#f3f1ea'], fabric: 'pique' });
}

// Rollos de vinilo y film de transferencia (repisa de estampado).
export function addVinylRolls(b, { x, y, z }) {
  const cols = ['#e23b3b', '#e2b64a', '#1e1e21', '#3d7bff', '#f3f1ea'];
  cols.forEach((c, i) => {
    b.cyl(0.03, 0.03, 0.34, vc('brillante'), { color: c, p: [x, y + 0.03 + Math.floor(i / 3) * 0.058, z + (i % 3) * 0.062 - 0.06 + (i >= 3 ? 0.03 : 0)], r: [0, 0, Math.PI / 2], seg: 20, cast: i < 3 });
  });
}


// ---------------------------------------------------------------------------
// Cartel y afiches enmarcados
// ---------------------------------------------------------------------------

export function createSign({ x, y, z, w = 2.0, h = 0.44 }) {
  const group = new THREE.Group();
  group.name = 'cartel';
  group.position.set(x, y, z);
  const b = new Batch();
  b.box(w, h, 0.035, woodMaterial('nogal', { key: '-cartel' }), { p: [0, 0, 0.0175 + 0.03], radius: 0.008, seg: 2, grain: 'x', cast: true });
  const face = new THREE.PlaneGeometry(w - 0.02, h - 0.02);
  b.add(face, std('cartel', { map: signTexture(), roughness: 0.6 }), { p: [0, 0, 0.0655], uv: 'keep' });
  face.dispose();
  // ménsulas de bronce
  for (const sx of [-1, 1]) b.box(0.03, 0.06, 0.04, brass(), { p: [sx * (w / 2 - 0.15), 0, 0.02], radius: 0.006, seg: 1 });
  b.flush(group, 'cartel');
  return { group };
}

export function createPosters() {
  const group = new THREE.Group();
  group.name = 'afiches';
  const b = new Batch();
  framedPoster(b, { x: -6.5, y: 1.98, z: -3.2, w: 0.42, h: 0.55, tex: sizeChartTexture() });
  framedPoster(b, { x: -3.0, y: 2.1, z: -3.2, w: 0.46, h: 0.46, tex: careTexture(), frame: '#f1e9da' });
  framedPoster(b, { x: 5.0, y: 2.5, z: -3.2, w: 0.4, h: 0.52, tex: colorWheelTexture() });
  framedPoster(b, { x: 6.05, y: 2.52, z: -3.2, w: 0.34, h: 0.42, tex: polaroidTexture(4), frame: '#2b2420' });
  b.flush(group, 'afiches');
  return { group };
}

// ---------------------------------------------------------------------------
// Brazo exhibidor de pared con remeras terminadas (de frente)
// ---------------------------------------------------------------------------

function shirtGeometry() {
  const g = extrude(shirtShape(), 0.024, { bevel: 0.011, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -0.012);
  // un poco de volumen en el pecho para que no parezca una placa
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const k = Math.max(0, 1 - (x / 0.21) ** 2) * Math.max(0, Math.sin(Math.min(1, (-y - 0.02) / 0.62) * Math.PI));
    p.setZ(i, p.getZ(i) * (1 + 1.2 * k) + 0.012 * k);
  }
  g.computeVertexNormals();
  return g;
}

export function createWallDisplay({ x, y, z, colors }) {
  const group = new THREE.Group();
  group.name = 'exhibidor-pared';
  group.position.set(x, y, z);
  const b = new Batch();
  const chromeM = chrome();
  b.box(0.06, 0.14, 0.012, chromeM, { p: [0, 0, 0.006], radius: 0.004, seg: 1 });
  const armLen = 0.46;
  const drop = 0.07;
  const arm = tube([[0, 0, 0.012], [0, -drop * 0.3, armLen * 0.4], [0, -drop, armLen]], 0.008, { tubular: 12, radial: 8 });
  b.add(arm, chromeM, { uv: 'keep', cast: true });
  arm.dispose();
  const sg = shirtGeometry();
  const hangerMat = woodMaterial('haya', { key: '-percha' });
  const shirtMat = getFabricMaterial('algodon_jersey', '#ffffff', { side: THREE.FrontSide, vertexColors: true });
  const n = colors.length;
  colors.forEach((c, i) => {
    const t = (i + 1) / (n + 0.4);
    const hz = 0.012 + armLen * t;
    const hy = -drop * t - 0.01;
    b.cyl(0.01, 0.01, 0.012, chromeM, { p: [0, hy + 0.008, hz], seg: 10 });
    const hanger = tube([[-0.2, -0.045, 0], [-0.1, -0.012, 0], [0, -0.002, 0], [0.1, -0.012, 0], [0.2, -0.045, 0]], 0.008, { tubular: 14, radial: 6 });
    b.add(hanger, hangerMat, { p: [0, hy - 0.045, hz], uv: 'keep' });
    hanger.dispose();
    const hook = tube([[0, -0.048, 0], [0, -0.01, 0], [0, 0.012, -0.006], [0, 0.012, 0.008]], 0.0018, { tubular: 10, radial: 4 });
    b.add(hook, chromeM, { p: [0, hy, hz], uv: 'keep' });
    hook.dispose();
    b.add(sg, shirtMat, { color: c, p: [0, hy - 0.06, hz], r: [0.04, (i % 2 ? 1 : -1) * 0.03, 0], uv: 'keep', cast: i === n - 1 });
  });
  sg.dispose();
  b.flush(group, 'exhibidor');
  return { group };
}

// ---------------------------------------------------------------------------
// Cortinas de lino recogidas a los costados de las ventanas del fondo
// ---------------------------------------------------------------------------

function curtainGeometry(w, h, side, tieY) {
  const g = new THREE.PlaneGeometry(w, h, 28, 24);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i) / w + 0.5; // 0..1 (0 = borde exterior si side = -1)
    const y = p.getY(i) + h / 2; // 0..h desde abajo
    const yy = h - y; // desde arriba
    const tie = Math.exp(-(((y - tieY) / 0.22) ** 2));
    // fruncido: los pliegues se juntan hacia el lazo y hacia la barra
    const u = side < 0 ? x0 : 1 - x0;
    const gather = 1 - 0.55 * tie - 0.15 * Math.exp(-yy / 0.06);
    const xs = (u * gather) * w;
    const fold = Math.sin(u * Math.PI * 2 * 5) * (0.018 + 0.012 * tie) * (1 - 0.6 * Math.exp(-yy / 0.15));
    const sway = Math.sin(y * 3.1 + u * 2) * 0.004;
    p.setXYZ(i, side < 0 ? xs - w / 2 : w / 2 - xs, p.getY(i), fold + sway + 0.02 * tie);
    uv.setXY(i, u * w * 1.6, y);
  }
  g.computeVertexNormals();
  return g;
}

export function createCurtains(list, { z = -3.2 + 0.075, color = '#ece3d2' } = {}) {
  const group = new THREE.Group();
  group.name = 'cortinas';
  const b = new Batch();
  const linen = getFabricMaterial('lino', color);
  const rodMat = brass();
  for (const win of list) {
    const h = win.top - 1.02;
    const w = 0.36;
    for (const side of [-1, 1]) {
      const g = curtainGeometry(w, h, side, h * 0.42);
      const cx = win.x + side * (win.w / 2 + 0.07 + w / 2 - 0.14);
      b.add(g, linen, { p: [cx, 1.02 + h / 2, z], uv: 'keep', cast: false });
      g.dispose();
      // lazo
      b.box(0.1, 0.03, 0.05, std('lazo-cortina', { color: '#c9b48e', roughness: 0.9 }), { p: [cx + side * 0.02, 1.02 + h * 0.42, z + 0.035], radius: 0.01, seg: 2 });
    }
    const rl = win.w + 0.75;
    b.cyl(0.011, 0.011, rl, rodMat, { p: [win.x, win.top + 0.03, z + 0.01], r: [0, 0, Math.PI / 2], seg: 12 });
    for (const sx of [-1, 1]) {
      const fin = new THREE.SphereGeometry(0.022, 14, 10);
      b.add(fin, rodMat, { p: [win.x + sx * (rl / 2 + 0.015), win.top + 0.03, z + 0.01] });
      fin.dispose();
      b.box(0.02, 0.05, 0.08, rodMat, { p: [win.x + sx * (rl / 2 - 0.1), win.top + 0.05, z - 0.03] });
    }
  }
  b.flush(group, 'cortinas');
  return { group };
}

// ---------------------------------------------------------------------------
// Oclusión ambiente falsa: degradés oscuros donde el piso se junta con las paredes
// ---------------------------------------------------------------------------

function aoTexture() {
  return drawTexture(16, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { key: 'ao-degrade' });
}

export function createFloorAO({ minX = -7, maxX = 7, backZ = -3.2, frontZ = 4.5 } = {}) {
  const group = new THREE.Group();
  group.name = 'ao';
  const b = new Batch();
  const mat = basic('ao-piso', { map: aoTexture(), color: '#24180e', transparent: true, opacity: 0.38, depthWrite: false, fog: false });
  const W = maxX - minX;
  const D = frontZ - backZ;
  const strip = (len, wd, matrix) => {
    const g = new THREE.PlaneGeometry(len, wd);
    b.add(g, mat, { matrix, uv: 'keep', receive: false });
    g.dispose();
  };
  const M = (x, y, z, rx, ry, rz) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V3(1, 1, 1));
  // piso: v=1 (oscuro) contra la pared
  strip(W, 0.7, M((minX + maxX) / 2, 0.0015, backZ + 0.35, -Math.PI / 2, 0, 0));
  strip(D, 0.6, M(minX + 0.3, 0.0016, (backZ + frontZ) / 2, -Math.PI / 2, Math.PI / 2, 0));
  strip(D, 0.6, M(maxX - 0.3, 0.0016, (backZ + frontZ) / 2, -Math.PI / 2, -Math.PI / 2, 0));
  // pared: una franja baja sobre el zócalo (oscuro abajo)
  strip(W, 0.4, M((minX + maxX) / 2, 0.2, backZ + 0.041, 0, 0, Math.PI));
  b.flush(group, 'ao');
  for (const m of group.children) m.renderOrder = 1;
  return { group };
}
