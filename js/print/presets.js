// Prediseños vectoriales (canvas 2D, fondo transparente) y texto con fuentes del sistema.
// Cada diseño se dibuja en un lienzo lógico de 1000×1000 que se escala al tamaño pedido.
// Están pensados para verse bien en todas las técnicas: formas claras, pocas tintas
// y una "capa oscura" que funciona sola como silueta (foil, glitter, vinilo de 1 color).

const TAU = Math.PI * 2;

// Fuentes del sistema (sin descargas). `css` = font-family; weight/style opcionales.
export const FONTS = [
  { id: 'impacto', name: 'Impacto', css: 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif', weight: '900' },
  { id: 'moderna', name: 'Moderna', css: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif', weight: '800' },
  { id: 'clasica', name: 'Clásica', css: 'Georgia, "Times New Roman", "Liberation Serif", serif', weight: '700' },
  { id: 'antigua', name: 'Antigua', css: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif', weight: '700', style: 'italic' },
  { id: 'maquina', name: 'Máquina de escribir', css: '"Courier New", Courier, "Liberation Mono", monospace', weight: '700' },
  { id: 'pincel', name: 'Pincel', css: '"Brush Script MT", "Segoe Script", "Lucida Handwriting", "URW Chancery L", cursive', weight: '400', style: 'italic' },
  { id: 'redonda', name: 'Redondeada', css: '"Trebuchet MS", "Verdana", "DejaVu Sans", sans-serif', weight: '700' },
  { id: 'divertida', name: 'Divertida', css: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive', weight: '700' },
];

const DISPLAY = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", "Liberation Sans", sans-serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
const SERIF = 'Georgia, "Times New Roman", "Liberation Serif", serif';
const SCRIPT = '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';

// ---------------------------------------------------------------------------
// Helpers de dibujo
// ---------------------------------------------------------------------------

function frame(ctx, w, h, fn) {
  const s = Math.min(w, h) / 1000;
  ctx.save();
  ctx.translate((w - 1000 * s) / 2, (h - 1000 * s) / 2);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  fn(ctx);
  ctx.restore();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

function linGrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  return g;
}

// Estrella de n puntas (r1 externo, r2 interno)
function star(ctx, cx, cy, r1, r2, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Destello de 4 puntas con lados curvos
function sparkle(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.12, cy - r * 0.12, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * 0.12, cy + r * 0.12, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.12, cy + r * 0.12, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * 0.12, cy - r * 0.12, cx, cy - r);
  ctx.closePath();
}

// Texto en arco alrededor de (cx, cy). bottom = texto de abajo (se lee de izq. a der.).
function textArc(ctx, text, cx, cy, r, { font, fill, stroke = null, lw = 0, bottom = false, spacing = 0, center = bottom ? Math.PI / 2 : -Math.PI / 2 }) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let acc = 0;
  for (let i = 0; i < chars.length; i++) {
    const cw = widths[i];
    const off = (acc + (cw - spacing) / 2 - total / 2) / r;
    const a = bottom ? center - off : center + off;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(bottom ? a - Math.PI / 2 : a + Math.PI / 2);
    if (stroke && lw) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.strokeText(chars[i], 0, 0);
    }
    ctx.fillStyle = fill;
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    acc += cw;
  }
  ctx.restore();
}

// Hoja/fronda: forma ahusada desde (x0,y0) hasta (x1,y1) con comba `bend` y ancho `wd`.
function leaf(ctx, x0, y0, x1, y1, wd, bend = 0) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx + nx * wd, cy + ny * wd, x1, y1);
  ctx.quadraticCurveTo(cx - nx * wd, cy - ny * wd, x0, y0);
  ctx.closePath();
}

function flower(ctx, cx, cy, r, petal, center, petals = 8, rot = 0) {
  ctx.fillStyle = petal;
  for (let i = 0; i < petals; i++) {
    const a = rot + (i * TAU) / petals;
    circle(ctx, cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45);
    ctx.fill();
  }
  ctx.fillStyle = center;
  circle(ctx, cx, cy, r * 0.36);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Diseños
// ---------------------------------------------------------------------------

function solYMontanas(ctx) {
  const cx = 500;
  const cy = 470;
  const R = 390;
  ctx.save();
  circle(ctx, cx, cy, R);
  ctx.clip();
  const sky = linGrad(ctx, 0, 80, 0, 860, [
    [0, '#ffd27a'],
    [0.45, '#ff9b5c'],
    [0.78, '#e8607a'],
    [1, '#a2508f'],
  ]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1000, 1000);
  // sol con rayas retro
  ctx.fillStyle = linGrad(ctx, 0, 300, 0, 700, [
    [0, '#fff6c9'],
    [1, '#ffd34f'],
  ]);
  circle(ctx, 500, 500, 185);
  ctx.fill();
  ctx.fillStyle = sky;
  [
    [548, 10],
    [584, 15],
    [622, 20],
    [662, 26],
  ].forEach(([y, hh]) => ctx.fillRect(300, y, 400, hh));
  // cordillera de atrás
  ctx.fillStyle = '#7b5aa6';
  poly(ctx, [
    [100, 720],
    [250, 520],
    [320, 580],
    [430, 410],
    [560, 620],
    [670, 470],
    [790, 640],
    [900, 560],
    [900, 900],
    [100, 900],
  ]);
  ctx.fill();
  ctx.fillStyle = '#f6efe4';
  poly(ctx, [
    [430, 410],
    [470, 472],
    [449, 462],
    [432, 486],
    [414, 460],
    [392, 470],
  ]);
  ctx.fill();
  poly(ctx, [
    [670, 470],
    [702, 516],
    [684, 508],
    [668, 528],
    [655, 506],
    [640, 513],
  ]);
  ctx.fill();
  // cordillera del frente
  ctx.fillStyle = '#2c4f6b';
  poly(ctx, [
    [80, 780],
    [230, 610],
    [320, 700],
    [470, 545],
    [620, 760],
    [760, 630],
    [920, 770],
    [920, 920],
    [80, 920],
  ]);
  ctx.fill();
  ctx.fillStyle = '#f6efe4';
  poly(ctx, [
    [470, 545],
    [520, 612],
    [494, 600],
    [474, 626],
    [452, 598],
    [424, 610],
  ]);
  ctx.fill();
  poly(ctx, [
    [760, 630],
    [800, 668],
    [778, 664],
    [760, 684],
    [745, 662],
    [722, 666],
  ]);
  ctx.fill();
  // pinos
  ctx.fillStyle = '#1b3433';
  const pine = (x, base, hgt) => {
    const wd = hgt * 0.42;
    for (let k = 0; k < 3; k++) {
      const top = base - hgt + k * hgt * 0.24;
      const bot = base - hgt * 0.32 + k * hgt * 0.2;
      poly(ctx, [
        [x, top],
        [x + wd * (0.55 + k * 0.22), bot],
        [x - wd * (0.55 + k * 0.22), bot],
      ]);
      ctx.fill();
    }
    ctx.fillRect(x - hgt * 0.04, base - hgt * 0.15, hgt * 0.08, hgt * 0.17);
  };
  ctx.fillRect(0, 838, 1000, 200);
  pine(180, 850, 190);
  pine(255, 850, 140);
  pine(745, 850, 150);
  pine(820, 850, 205);
  ctx.restore();
  // anillo
  ctx.strokeStyle = '#1f2a46';
  ctx.lineWidth = 34;
  circle(ctx, cx, cy, R);
  ctx.stroke();
  ctx.strokeStyle = '#f6efe4';
  ctx.lineWidth = 7;
  circle(ctx, cx, cy, R - 30);
  ctx.stroke();
  // cinta
  ctx.fillStyle = '#9e2b2b';
  poly(ctx, [
    [150, 790],
    [210, 790],
    [210, 900],
    [150, 900],
    [180, 845],
  ]);
  ctx.fill();
  poly(ctx, [
    [850, 790],
    [790, 790],
    [790, 900],
    [850, 900],
    [820, 845],
  ]);
  ctx.fill();
  ctx.fillStyle = '#c23b35';
  ctx.beginPath();
  ctx.moveTo(200, 770);
  ctx.quadraticCurveTo(500, 730, 800, 770);
  ctx.lineTo(800, 880);
  ctx.quadraticCurveTo(500, 840, 200, 880);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.fillStyle = '#fbf3e4';
  ctx.font = `76px ${DISPLAY}`;
  textArc(ctx, 'PATAGONIA', 500, 2620, 1800, { font: `bold 74px ${SANS}`, fill: '#fbf3e4', spacing: 10 });
  ctx.restore();
  ctx.fillStyle = '#1f2a46';
  sparkle(ctx, 120, 150, 46);
  ctx.fill();
  sparkle(ctx, 885, 210, 32);
  ctx.fill();
}

function ola(ctx) {
  const cx = 500;
  const cy = 500;
  const R = 410;
  ctx.save();
  circle(ctx, cx, cy, R);
  ctx.clip();
  ctx.fillStyle = '#f4ead3';
  ctx.fillRect(0, 0, 1000, 1000);
  // sol
  ctx.fillStyle = '#ef7d4f';
  circle(ctx, 300, 300, 92);
  ctx.fill();
  // cuerpo de la ola
  const wave = () => {
    ctx.beginPath();
    ctx.moveTo(60, 780);
    ctx.bezierCurveTo(200, 740, 300, 560, 400, 420);
    ctx.bezierCurveTo(480, 300, 640, 230, 760, 290);
    ctx.bezierCurveTo(860, 340, 880, 470, 800, 520);
    ctx.bezierCurveTo(740, 555, 680, 505, 705, 455);
    ctx.bezierCurveTo(650, 450, 600, 500, 610, 580);
    ctx.bezierCurveTo(625, 690, 760, 720, 960, 700);
    ctx.lineTo(960, 960);
    ctx.lineTo(60, 960);
    ctx.closePath();
  };
  wave();
  ctx.fillStyle = '#1d4f8f';
  ctx.fill();
  // bandas de la cara de la ola
  ctx.save();
  wave();
  ctx.clip();
  ctx.strokeStyle = '#5b9ad6';
  ctx.lineWidth = 16;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.moveTo(90 + k * 40, 840 + k * 6);
    ctx.bezierCurveTo(250 + k * 30, 760, 340 + k * 34, 580 + k * 30, 440 + k * 36, 470 + k * 34);
    ctx.bezierCurveTo(500 + k * 30, 400 + k * 30, 560 + k * 10, 370 + k * 20, 600 + k * 4, 380 + k * 22);
    ctx.stroke();
  }
  // interior del tubo
  ctx.fillStyle = '#123a6c';
  ctx.beginPath();
  ctx.moveTo(705, 455);
  ctx.bezierCurveTo(650, 450, 600, 500, 610, 580);
  ctx.bezierCurveTo(620, 640, 690, 680, 780, 690);
  ctx.bezierCurveTo(700, 640, 660, 560, 705, 455);
  ctx.fill();
  ctx.restore();
  // espuma: garras sobre la cresta
  ctx.fillStyle = '#fbf6ea';
  const crest = [
    [420, 400, 40],
    [470, 340, 44],
    [535, 300, 46],
    [605, 272, 46],
    [675, 268, 44],
    [738, 286, 40],
    [790, 318, 34],
    [826, 362, 28],
    [838, 410, 22],
  ];
  crest.forEach(([x, y, r], i) => {
    circle(ctx, x, y, r * 0.75);
    ctx.fill();
    // garra que cae hacia adelante
    ctx.beginPath();
    ctx.moveTo(x - r * 0.6, y + r * 0.1);
    ctx.quadraticCurveTo(x + r * 0.2, y - r * 1.25, x + r * 1.15, y - r * 0.45 + (i > 6 ? r * 0.8 : 0));
    ctx.quadraticCurveTo(x + r * 0.35, y - r * 0.35, x + r * 0.5, y + r * 0.45);
    ctx.closePath();
    ctx.fill();
  });
  // gotitas
  [
    [870, 300, 12],
    [900, 360, 9],
    [880, 240, 8],
    [380, 360, 10],
    [350, 400, 7],
  ].forEach(([x, y, r]) => {
    circle(ctx, x, y, r);
    ctx.fill();
  });
  // mar de abajo
  ctx.strokeStyle = '#fbf6ea';
  ctx.lineWidth = 12;
  [
    [150, 830, 330],
    [420, 860, 300],
    [230, 900, 260],
  ].forEach(([x, y, l]) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + l * 0.25, y - 22, x + l * 0.5, y + 22, x + l * 0.75, y);
    ctx.lineTo(x + l, y - 6);
    ctx.stroke();
  });
  ctx.restore();
  ctx.strokeStyle = '#13294b';
  ctx.lineWidth = 30;
  circle(ctx, cx, cy, R);
  ctx.stroke();
}

function calavera(ctx) {
  const dark = '#2a2228';
  // hojas detrás de la corona
  ctx.fillStyle = '#3e9a5c';
  leaf(ctx, 380, 250, 220, 160, 40, 20);
  ctx.fill();
  leaf(ctx, 620, 250, 790, 165, 40, -20);
  ctx.fill();
  leaf(ctx, 450, 205, 390, 90, 32, -10);
  ctx.fill();
  leaf(ctx, 550, 205, 620, 92, 32, 10);
  ctx.fill();
  // cráneo
  const skull = () => {
    ctx.beginPath();
    ctx.moveTo(500, 215);
    ctx.bezierCurveTo(665, 215, 765, 330, 765, 470);
    ctx.bezierCurveTo(765, 565, 728, 615, 690, 645);
    ctx.lineTo(678, 720);
    ctx.bezierCurveTo(674, 782, 636, 815, 592, 816);
    ctx.lineTo(408, 816);
    ctx.bezierCurveTo(364, 815, 326, 782, 322, 720);
    ctx.lineTo(310, 645);
    ctx.bezierCurveTo(272, 615, 235, 565, 235, 470);
    ctx.bezierCurveTo(235, 330, 335, 215, 500, 215);
    ctx.closePath();
  };
  skull();
  ctx.fillStyle = '#f5ecd8';
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 18;
  ctx.stroke();
  // ojos con flor
  [
    [400, 490],
    [600, 490],
  ].forEach(([x, y]) => {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x, y, 86, 80, 0, 0, TAU);
    ctx.fill();
    flower(ctx, x, y, 62, '#ff6fae', '#ffd23f', 7, 0.3);
  });
  // nariz (corazón invertido)
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(500, 575);
  ctx.bezierCurveTo(470, 610, 455, 640, 478, 652);
  ctx.bezierCurveTo(490, 658, 498, 650, 500, 640);
  ctx.bezierCurveTo(502, 650, 510, 658, 522, 652);
  ctx.bezierCurveTo(545, 640, 530, 610, 500, 575);
  ctx.fill();
  // sonrisa cosida
  ctx.strokeStyle = dark;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(380, 712);
  ctx.quadraticCurveTo(500, 752, 620, 712);
  ctx.stroke();
  ctx.lineWidth = 9;
  for (let k = 0; k < 7; k++) {
    const t = (k + 0.5) / 7;
    const x = 380 + t * 240;
    const y = 712 + Math.sin(t * Math.PI) * 26;
    ctx.beginPath();
    ctx.moveTo(x, y - 28);
    ctx.lineTo(x, y + 28);
    ctx.stroke();
  }
  // adornos de mejillas y frente
  ctx.fillStyle = '#ff9a3c';
  circle(ctx, 318, 600, 20);
  ctx.fill();
  circle(ctx, 682, 600, 20);
  ctx.fill();
  ctx.fillStyle = '#3ab0c8';
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.translate(500, 365);
    ctx.rotate(-0.55 + k * 0.55);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(26, -36, 0, -68);
    ctx.quadraticCurveTo(-26, -36, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#ff6fae';
  circle(ctx, 500, 368, 12);
  ctx.fill();
  // corona de flores
  flower(ctx, 330, 255, 78, '#e23b3b', '#ffd23f', 8, 0.2);
  flower(ctx, 670, 255, 78, '#ff6fae', '#ffd23f', 8, 0.1);
  flower(ctx, 500, 205, 92, '#ff9a3c', '#9e2b2b', 9, 0);
  flower(ctx, 412, 190, 40, '#ffd23f', '#e23b3b', 6, 0);
  flower(ctx, 590, 190, 40, '#ffd23f', '#e23b3b', 6, 0.4);
}

function heartPath(ctx, cx, cy, s) {
  const p = (x, y) => [cx + (x - 500) * s, cy + (y - 510) * s];
  ctx.beginPath();
  ctx.moveTo(...p(500, 840));
  ctx.bezierCurveTo(...p(300, 700), ...p(140, 565), ...p(140, 395));
  ctx.bezierCurveTo(...p(140, 262), ...p(245, 180), ...p(360, 180));
  ctx.bezierCurveTo(...p(432, 180), ...p(482, 222), ...p(500, 274));
  ctx.bezierCurveTo(...p(518, 222), ...p(568, 180), ...p(640, 180));
  ctx.bezierCurveTo(...p(755, 180), ...p(860, 262), ...p(860, 395));
  ctx.bezierCurveTo(...p(860, 565), ...p(700, 700), ...p(500, 840));
  ctx.closePath();
}

function corazonPuntadas(ctx) {
  heartPath(ctx, 500, 480, 1);
  ctx.fillStyle = linGrad(ctx, 200, 180, 760, 820, [
    [0, '#ec4d58'],
    [1, '#a9202e'],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#6e1420';
  ctx.lineWidth = 14;
  ctx.stroke();
  // brillo
  ctx.fillStyle = '#f7848b';
  ctx.beginPath();
  ctx.moveTo(220, 380);
  ctx.bezierCurveTo(215, 300, 270, 240, 345, 236);
  ctx.bezierCurveTo(300, 262, 262, 310, 258, 392);
  ctx.closePath();
  ctx.fill();
  // pespunte
  heartPath(ctx, 500, 488, 0.83);
  ctx.setLineDash([34, 22]);
  ctx.strokeStyle = '#fbeedd';
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.setLineDash([]);
  // aguja
  ctx.save();
  ctx.translate(735, 225);
  ctx.rotate(0.72);
  ctx.fillStyle = '#d7dbe2';
  ctx.strokeStyle = '#2a2a2e';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-210, 0);
  ctx.quadraticCurveTo(-80, -16, 170, -12);
  ctx.quadraticCurveTo(200, 0, 170, 12);
  ctx.quadraticCurveTo(-80, 16, -210, 0);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a2a2e';
  ctx.beginPath();
  ctx.ellipse(140, 0, 20, 5, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  // hilo saliendo del ojo de la aguja
  ctx.strokeStyle = '#f1cc4e';
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(838, 318);
  ctx.bezierCurveTo(930, 400, 900, 520, 820, 560);
  ctx.bezierCurveTo(760, 590, 760, 660, 830, 690);
  ctx.bezierCurveTo(890, 715, 900, 790, 840, 830);
  ctx.stroke();
  // texto
  ctx.fillStyle = '#7d1724';
  ctx.font = `bold 66px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  textArc(ctx, 'HECHO CON AMOR', 500, -1200, 2130, { font: `bold 62px ${SANS}`, fill: '#7d1724', bottom: true, spacing: 6 });
}

function rayo(ctx) {
  const bolt = [
    [610, 70],
    [285, 545],
    [472, 545],
    [360, 935],
    [742, 395],
    [548, 395],
    [690, 70],
  ];
  // sombra corrida
  ctx.save();
  ctx.translate(34, 26);
  ctx.fillStyle = '#ff3d7f';
  poly(ctx, bolt);
  ctx.fill();
  ctx.strokeStyle = '#ff3d7f';
  ctx.lineWidth = 22;
  ctx.stroke();
  ctx.restore();
  poly(ctx, bolt);
  ctx.fillStyle = linGrad(ctx, 300, 80, 700, 900, [
    [0, '#fff07a'],
    [1, '#ffbf1f'],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#1e1e21';
  ctx.lineWidth = 22;
  ctx.stroke();
  // brillo interno
  ctx.fillStyle = '#fffbe0';
  poly(ctx, [
    [600, 110],
    [345, 500],
    [380, 500],
    [628, 110],
  ]);
  ctx.fill();
  // destellos
  ctx.fillStyle = '#1e1e21';
  sparkle(ctx, 210, 230, 70);
  ctx.fill();
  ctx.fillStyle = '#6fe3ff';
  sparkle(ctx, 210, 230, 46);
  ctx.fill();
  ctx.fillStyle = '#1e1e21';
  sparkle(ctx, 815, 650, 56);
  ctx.fill();
  ctx.fillStyle = '#fff07a';
  sparkle(ctx, 815, 650, 34);
  ctx.fill();
  ctx.fillStyle = '#1e1e21';
  sparkle(ctx, 200, 780, 38);
  ctx.fill();
  [
    [300, 120, 14],
    [860, 300, 16],
    [770, 860, 12],
    [130, 520, 12],
  ].forEach(([x, y, r]) => {
    circle(ctx, x, y, r);
    ctx.fill();
  });
}

function gatoGeometrico(ctx) {
  const V = {
    E1: [235, 140],
    E2: [765, 140],
    A: [398, 318],
    B: [602, 318],
    T: [500, 292],
    M: [500, 455],
    L1: [222, 430],
    R1: [778, 430],
    L2: [255, 615],
    R2: [745, 615],
    L3: [365, 770],
    R3: [635, 770],
    C: [500, 835],
    N: [500, 612],
    EL: [372, 520],
    ER: [628, 520],
    ML: [425, 690],
    MR: [575, 690],
  };
  const tri = (a, b, c, col) => {
    ctx.fillStyle = col;
    poly(ctx, [V[a], V[b], V[c]]);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const c1 = '#f7c89a';
  const c2 = '#f0a35e';
  const c3 = '#e5732b';
  const c4 = '#c25a1c';
  const c5 = '#97410f';
  tri('E1', 'A', 'L1', c3);
  tri('E2', 'B', 'R1', c4);
  tri('A', 'T', 'M', c2);
  tri('T', 'B', 'M', c3);
  tri('A', 'M', 'EL', c1);
  tri('A', 'EL', 'L1', c2);
  tri('B', 'ER', 'M', c2);
  tri('B', 'R1', 'ER', c4);
  tri('L1', 'EL', 'L2', c3);
  tri('R1', 'R2', 'ER', c5);
  tri('EL', 'M', 'N', c1);
  tri('ER', 'N', 'M', c2);
  tri('EL', 'N', 'L2', c2);
  tri('ER', 'R2', 'N', c4);
  tri('L2', 'N', 'ML', c1);
  tri('R2', 'MR', 'N', c3);
  tri('L2', 'ML', 'L3', c3);
  tri('R2', 'R3', 'MR', c4);
  tri('N', 'MR', 'ML', '#fbe3c6');
  tri('ML', 'MR', 'C', c1);
  tri('L3', 'ML', 'C', c2);
  tri('R3', 'C', 'MR', c3);
  // orejas internas
  ctx.fillStyle = '#f28d9b';
  poly(ctx, [
    [262, 190],
    [372, 322],
    [272, 380],
  ]);
  ctx.fill();
  poly(ctx, [
    [738, 190],
    [628, 322],
    [728, 380],
  ]);
  ctx.fill();
  // contorno
  ctx.strokeStyle = '#3a2216';
  ctx.lineWidth = 14;
  poly(ctx, [V.E1, V.A, V.T, V.B, V.E2, V.R1, V.R2, V.R3, V.C, V.L3, V.L2, V.L1]);
  ctx.stroke();
  // ojos
  [
    [372, 520, 1],
    [628, 520, -1],
  ].forEach(([x, y, s]) => {
    ctx.fillStyle = '#3a2216';
    ctx.beginPath();
    ctx.moveTo(x - 78, y + 6 * s * 0);
    ctx.quadraticCurveTo(x, y - 70, x + 78, y);
    ctx.quadraticCurveTo(x, y + 66, x - 78, y);
    ctx.fill();
    ctx.fillStyle = '#9be36a';
    ctx.beginPath();
    ctx.moveTo(x - 62, y);
    ctx.quadraticCurveTo(x, y - 54, x + 62, y);
    ctx.quadraticCurveTo(x, y + 50, x - 62, y);
    ctx.fill();
    ctx.fillStyle = '#1b120c';
    ctx.beginPath();
    ctx.ellipse(x, y, 11, 40, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    circle(ctx, x + 18, y - 16, 9);
    ctx.fill();
  });
  // nariz y boca
  ctx.fillStyle = '#e8687e';
  poly(ctx, [
    [462, 600],
    [538, 600],
    [500, 648],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#3a2216';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(500, 648);
  ctx.lineTo(500, 676);
  ctx.quadraticCurveTo(470, 708, 440, 684);
  ctx.moveTo(500, 676);
  ctx.quadraticCurveTo(530, 708, 560, 684);
  ctx.stroke();
  // bigotes
  ctx.lineWidth = 7;
  [
    [-1, 640, -20],
    [-1, 672, 0],
    [-1, 704, 22],
    [1, 640, -20],
    [1, 672, 0],
    [1, 704, 22],
  ].forEach(([s, y, dy]) => {
    ctx.beginPath();
    ctx.moveTo(500 + s * 95, y);
    ctx.quadraticCurveTo(500 + s * 200, y + dy * 0.4 - 6, 500 + s * 300, y + dy);
    ctx.stroke();
  });
}

// Hoja de monstera dibujada en un lienzo aparte (los cortes y las venas solo afectan a la hoja).
function monsteraLeaf(ctx, cx, cy, scale, rot, c0, c1, vein) {
  const off = document.createElement('canvas');
  off.width = ctx.canvas.width;
  off.height = ctx.canvas.height;
  const g = off.getContext('2d');
  g.setTransform(ctx.getTransform());
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(scale, scale);
  g.translate(-500, -480);
  // silueta: base en corazón, punta aguda
  g.beginPath();
  g.moveTo(500, 790);
  g.bezierCurveTo(430, 860, 150, 800, 128, 540);
  g.bezierCurveTo(110, 330, 290, 150, 470, 112);
  g.quadraticCurveTo(500, 90, 532, 112);
  g.bezierCurveTo(712, 150, 890, 330, 872, 540);
  g.bezierCurveTo(850, 800, 570, 860, 500, 790);
  g.closePath();
  g.fillStyle = linGrad(g, 200, 120, 800, 860, [
    [0, c0],
    [1, c1],
  ]);
  g.fill();
  // venas laterales (curvas hacia la punta) y nervadura central
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = vein;
  g.lineWidth = 7;
  const VY = [228, 352, 478, 606, 728];
  VY.forEach((y) => {
    [-1, 1].forEach((sx) => {
      g.beginPath();
      g.moveTo(500, y + 22);
      g.quadraticCurveTo(500 + sx * 230, y + 4, 500 + sx * 420, y - 110);
      g.stroke();
    });
  });
  g.lineWidth = 16;
  g.beginPath();
  g.moveTo(500, 800);
  g.bezierCurveTo(496, 600, 504, 340, 500, 120);
  g.stroke();
  // cortes entre venas, desde el borde hacia la nervadura
  g.globalCompositeOperation = 'destination-out';
  const SY = [290, 415, 542, 668];
  SY.forEach((y0) => {
    [-1, 1].forEach((sx) => {
      const x0 = 500 + sx * 92;
      const cxp = 500 + sx * 260;
      g.beginPath();
      g.moveTo(x0, y0 - 3);
      g.quadraticCurveTo(cxp, y0 - 24, 500 + sx * 470, y0 - 150);
      g.lineTo(500 + sx * 470, y0 - 112);
      g.quadraticCurveTo(cxp, y0 + 4, x0, y0 + 6);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(x0, y0 + 1.5, 5, 0, TAU);
      g.fill();
    });
  });
  // agujeros alargados cerca de la nervadura
  SY.slice(0, 3).forEach((y) => {
    [-1, 1].forEach((sx) => {
      g.beginPath();
      g.ellipse(500 + sx * 150, y + 58, 26, 10, sx * -0.22, 0, TAU);
      g.fill();
    });
  });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

function monstera(ctx) {
  // hoja de atrás, más oscura
  monsteraLeaf(ctx, 690, 340, 0.56, 0.85, '#2a8152', '#14482f', '#49a374');
  // tallos
  ctx.strokeStyle = '#1d5c38';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(735, 585);
  ctx.quadraticCurveTo(660, 800, 545, 955);
  ctx.stroke();
  ctx.strokeStyle = '#2a7b4c';
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.moveTo(535, 750);
  ctx.quadraticCurveTo(575, 860, 530, 965);
  ctx.stroke();
  // hoja principal
  monsteraLeaf(ctx, 450, 500, 0.8, -0.26, '#4cb877', '#1d6a43', '#b4ecc8');
}

function tijeraVintage(ctx) {
  const navy = '#1f2a46';
  const cream = '#f1e6cf';
  const red = '#b8322f';
  circle(ctx, 500, 500, 470);
  ctx.fillStyle = navy;
  ctx.fill();
  circle(ctx, 500, 500, 325);
  ctx.fillStyle = cream;
  ctx.fill();
  ctx.strokeStyle = cream;
  ctx.lineWidth = 6;
  circle(ctx, 500, 500, 448);
  ctx.stroke();
  ctx.setLineDash([16, 13]);
  ctx.strokeStyle = navy;
  ctx.lineWidth = 7;
  circle(ctx, 500, 500, 298);
  ctx.stroke();
  ctx.setLineDash([]);
  textArc(ctx, 'TALLER DE REMERAS', 500, 500, 388, { font: `bold 66px ${SANS}`, fill: cream, spacing: 7 });
  textArc(ctx, '· HECHO A MANO ·', 500, 500, 388, { font: `bold 60px ${SANS}`, fill: cream, spacing: 7, bottom: true });
  ctx.fillStyle = cream;
  star(ctx, 88, 500, 30, 12);
  ctx.fill();
  star(ctx, 912, 500, 30, 12);
  ctx.fill();
  // tijera
  const blade = (sx) => {
    ctx.beginPath();
    ctx.moveTo(500, 520);
    ctx.bezierCurveTo(500 + sx * 26, 450, 500 + sx * 110, 330, 500 + sx * 182, 220);
    ctx.bezierCurveTo(500 + sx * 150, 330, 500 + sx * 70, 450, 500 + sx * 34, 560);
    ctx.closePath();
  };
  ctx.fillStyle = navy;
  blade(-1);
  ctx.fill();
  blade(1);
  ctx.fill();
  // brazos y argollas
  ctx.strokeStyle = navy;
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(500, 510);
  ctx.quadraticCurveTo(470, 590, 440, 640);
  ctx.moveTo(500, 510);
  ctx.quadraticCurveTo(530, 590, 560, 640);
  ctx.stroke();
  ctx.lineWidth = 30;
  ctx.strokeStyle = red;
  circle(ctx, 412, 690, 62);
  ctx.stroke();
  circle(ctx, 588, 690, 62);
  ctx.stroke();
  ctx.lineWidth = 7;
  ctx.strokeStyle = navy;
  circle(ctx, 412, 690, 80);
  ctx.stroke();
  circle(ctx, 588, 690, 80);
  ctx.stroke();
  ctx.fillStyle = cream;
  circle(ctx, 500, 512, 17);
  ctx.fill();
  ctx.fillStyle = navy;
  circle(ctx, 500, 512, 6);
  ctx.fill();
  ctx.fillStyle = navy;
  ctx.font = `bold 40px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EST. 2026', 500, 300);
}

function cafe(ctx) {
  const brown = '#4a2c1d';
  // vapor
  ctx.strokeStyle = '#8b5e3c';
  ctx.lineWidth = 20;
  [410, 500, 590].forEach((x, i) => {
    ctx.beginPath();
    ctx.moveTo(x, 340);
    ctx.bezierCurveTo(x - 50, 290, x + 50, 240, x, 190 - i * 8);
    ctx.bezierCurveTo(x - 40, 150, x + 20, 120, x + 4, 90 - (i % 2) * 20);
    ctx.stroke();
  });
  // plato
  ctx.fillStyle = '#e9d6b8';
  ctx.strokeStyle = brown;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.ellipse(500, 790, 330, 62, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // asa
  ctx.lineWidth = 50;
  ctx.strokeStyle = brown;
  ctx.beginPath();
  ctx.ellipse(752, 545, 72, 82, 0, -1.4, 1.5);
  ctx.stroke();
  ctx.lineWidth = 22;
  ctx.strokeStyle = '#f6efe2';
  ctx.beginPath();
  ctx.ellipse(752, 545, 72, 82, 0, -1.4, 1.5);
  ctx.stroke();
  // taza
  const cup = () => {
    ctx.beginPath();
    ctx.moveTo(262, 420);
    ctx.lineTo(738, 420);
    ctx.bezierCurveTo(735, 560, 700, 700, 610, 760);
    ctx.lineTo(390, 760);
    ctx.bezierCurveTo(300, 700, 265, 560, 262, 420);
    ctx.closePath();
  };
  cup();
  ctx.fillStyle = '#f6efe2';
  ctx.fill();
  ctx.save();
  cup();
  ctx.clip();
  ctx.fillStyle = '#d24a3c';
  ctx.fillRect(200, 520, 600, 70);
  ctx.fillStyle = '#f6efe2';
  for (let k = 0; k < 8; k++) {
    circle(ctx, 300 + k * 58, 555, 11);
    ctx.fill();
  }
  ctx.restore();
  cup();
  ctx.strokeStyle = brown;
  ctx.lineWidth = 16;
  ctx.stroke();
  // borde y café
  ctx.beginPath();
  ctx.ellipse(500, 420, 238, 46, 0, 0, TAU);
  ctx.fillStyle = '#f6efe2';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(500, 424, 205, 32, 0, 0, TAU);
  ctx.fillStyle = '#6b3f26';
  ctx.fill();
  // corazón de latte
  ctx.fillStyle = '#f3dcc0';
  ctx.beginPath();
  ctx.moveTo(500, 446);
  ctx.bezierCurveTo(450, 430, 452, 404, 478, 404);
  ctx.bezierCurveTo(490, 404, 498, 412, 500, 418);
  ctx.bezierCurveTo(502, 412, 510, 404, 522, 404);
  ctx.bezierCurveTo(548, 404, 550, 430, 500, 446);
  ctx.fill();
  // texto
  ctx.fillStyle = brown;
  ctx.font = `bold 92px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CAFÉ', 500, 920);
  ctx.fillStyle = '#d24a3c';
  star(ctx, 330, 918, 22, 9);
  ctx.fill();
  star(ctx, 670, 918, 22, 9);
  ctx.fill();
}

function planeta(ctx) {
  const cx = 500;
  const cy = 520;
  const R = 255;
  const ringA = -0.3;
  const ring = (front) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ringA);
    ctx.beginPath();
    if (front) ctx.ellipse(0, 0, 430, 112, 0, 0, Math.PI);
    else ctx.ellipse(0, 0, 430, 112, 0, Math.PI, TAU);
    ctx.strokeStyle = '#2a1b4d';
    ctx.lineWidth = 64;
    ctx.stroke();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 40;
    ctx.stroke();
    ctx.strokeStyle = '#ff9a3c';
    ctx.lineWidth = 9;
    ctx.beginPath();
    if (front) ctx.ellipse(0, 0, 430, 112, 0, 0.05, Math.PI - 0.05);
    else ctx.ellipse(0, 0, 430, 112, 0, Math.PI + 0.05, TAU - 0.05);
    ctx.stroke();
    ctx.restore();
  };
  ring(false);
  ctx.save();
  circle(ctx, cx, cy, R);
  ctx.clip();
  ctx.fillStyle = '#6b4b9b';
  ctx.fillRect(0, 0, 1000, 1000);
  ctx.translate(cx, cy);
  ctx.rotate(ringA);
  const bands = [
    [-210, 60, '#e5732b'],
    [-120, 34, '#ff6fae'],
    [-40, 70, '#f0a35e'],
    [70, 40, '#e5732b'],
    [150, 56, '#4b3480'],
  ];
  bands.forEach(([y, hh, col]) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-300, y);
    ctx.bezierCurveTo(-100, y - 30, 100, y + 30, 300, y);
    ctx.lineTo(300, y + hh);
    ctx.bezierCurveTo(100, y + hh + 30, -100, y + hh - 30, -300, y + hh);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
  // sombra (media luna) sólida
  ctx.save();
  circle(ctx, cx, cy, R);
  ctx.clip();
  ctx.fillStyle = '#2f1f57';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 2, 0, TAU);
  ctx.arc(cx - 70, cy - 70, R, 0, TAU, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.strokeStyle = '#2a1b4d';
  ctx.lineWidth = 12;
  circle(ctx, cx, cy, R);
  ctx.stroke();
  ring(true);
  // luna y estrellas
  ctx.fillStyle = '#d7dbe2';
  circle(ctx, 830, 230, 46);
  ctx.fill();
  ctx.fillStyle = '#9ea4ae';
  circle(ctx, 816, 218, 12);
  ctx.fill();
  circle(ctx, 846, 248, 8);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  sparkle(ctx, 160, 180, 52);
  ctx.fill();
  sparkle(ctx, 860, 820, 44);
  ctx.fill();
  sparkle(ctx, 150, 830, 28);
  ctx.fill();
  ctx.fillStyle = '#ff6fae';
  [
    [300, 110, 10],
    [700, 120, 12],
    [90, 470, 9],
    [920, 470, 10],
    [640, 930, 9],
  ].forEach(([x, y, r]) => {
    circle(ctx, x, y, r);
    ctx.fill();
  });
}

function palmera(ctx) {
  const ink = '#2b1d3a';
  ctx.save();
  circle(ctx, 500, 470, 330);
  ctx.fillStyle = linGrad(ctx, 0, 140, 0, 800, [
    [0, '#ffe36e'],
    [0.5, '#ff8c42'],
    [1, '#e8467c'],
  ]);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  [
    [560, 12],
    [610, 17],
    [662, 22],
    [716, 28],
    [772, 34],
  ].forEach(([y, hh]) => ctx.fillRect(150, y, 700, hh));
  ctx.restore();
  // reflejo en el agua
  ctx.lineCap = 'round';
  [
    [860, 520, '#ff8c42', 18],
    [895, 400, '#e8467c', 16],
    [928, 280, '#e8467c', 14],
  ].forEach(([y, l, col, lw]) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(500 - l / 2, y);
    ctx.lineTo(500 + l / 2, y);
    ctx.stroke();
  });
  // islita
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(470, 842, 250, 34, 0, Math.PI, TAU);
  ctx.fill();
  // palmeras
  const palm = (bx, by, tx, ty, scale) => {
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    // tronco ahusado
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const p = (t) => {
        const u = 1 - t;
        return [u * u * bx + 2 * u * t * (bx + (tx - bx) * 0.15) + t * t * tx, u * u * by + 2 * u * t * ((by + ty) / 2) + t * t * ty];
      };
      const a = p(t0);
      const b = p(t1);
      ctx.lineWidth = (34 - 16 * t0) * scale;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    const fr = [
      [-250, 40, 70],
      [-200, -60, 60],
      [-90, -150, 40],
      [80, -150, -40],
      [210, -70, -60],
      [260, 50, -70],
      [40, 120, -30],
      [-60, 130, 30],
    ];
    fr.forEach(([dx, dy, bend]) => {
      leaf(ctx, tx, ty, tx + dx * scale, ty + dy * scale, 34 * scale, bend * scale);
      ctx.fill();
    });
    circle(ctx, tx, ty, 22 * scale);
    ctx.fill();
  };
  palm(390, 840, 440, 330, 1);
  palm(560, 845, 640, 470, 0.72);
  // gaviotas
  ctx.strokeStyle = ink;
  ctx.lineWidth = 9;
  [
    [230, 260, 1],
    [290, 215, 0.8],
    [760, 250, 1.1],
  ].forEach(([x, y, s]) => {
    ctx.beginPath();
    ctx.moveTo(x - 34 * s, y);
    ctx.quadraticCurveTo(x - 16 * s, y - 20 * s, x, y);
    ctx.quadraticCurveTo(x + 16 * s, y - 20 * s, x + 34 * s, y);
    ctx.stroke();
  });
}

function retro80(ctx) {
  // sol con rayas
  ctx.save();
  circle(ctx, 500, 420, 270);
  ctx.fillStyle = linGrad(ctx, 0, 150, 0, 690, [
    [0, '#ffe14d'],
    [0.55, '#ff8a3d'],
    [1, '#ff2f8e'],
  ]);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  [
    [450, 10],
    [495, 15],
    [542, 20],
    [592, 26],
    [645, 32],
  ].forEach(([y, hh]) => ctx.fillRect(200, y, 600, hh));
  ctx.restore();
  // piso con grilla en perspectiva
  const top = 600;
  const bot = 900;
  ctx.save();
  poly(ctx, [
    [230, top],
    [770, top],
    [960, bot],
    [40, bot],
  ]);
  ctx.fillStyle = '#2a1450';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = '#ff3d9a';
  ctx.lineWidth = 7;
  for (let k = -8; k <= 8; k++) {
    ctx.beginPath();
    ctx.moveTo(500 + k * 34, top);
    ctx.lineTo(500 + k * 120, bot);
    ctx.stroke();
  }
  let y = top + 8;
  let step = 14;
  while (y < bot) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1000, y);
    ctx.stroke();
    y += step;
    step *= 1.45;
  }
  ctx.restore();
  ctx.strokeStyle = '#ff3d9a';
  ctx.lineWidth = 9;
  poly(ctx, [
    [230, top],
    [770, top],
    [960, bot],
    [40, bot],
  ]);
  ctx.stroke();
  // texto cromado
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 900 210px ${DISPLAY}`;
  ctx.translate(500, 640);
  ctx.transform(1, 0, -0.12, 1, 0, 0);
  ctx.lineWidth = 34;
  ctx.strokeStyle = '#1a0d33';
  ctx.strokeText('RETRO', 0, 0);
  ctx.fillStyle = linGrad(ctx, 0, -170, 0, 0, [
    [0, '#7cf0ff'],
    [0.48, '#ffffff'],
    [0.52, '#5b3aa8'],
    [1, '#d68bff'],
  ]);
  ctx.fillText('RETRO', 0, 0);
  ctx.restore();
  // "80s" en script
  ctx.save();
  ctx.translate(650, 790);
  ctx.rotate(-0.12);
  ctx.font = `italic bold 170px ${SCRIPT}`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 22;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('80s', 0, 0);
  ctx.fillStyle = '#ff2f8e';
  ctx.fillText('80s', 0, 0);
  ctx.restore();
  ctx.strokeStyle = '#6fe3ff';
  ctx.lineWidth = 10;
  poly(ctx, [
    [120, 220],
    [190, 110],
    [250, 230],
  ]);
  ctx.stroke();
  poly(ctx, [
    [800, 150],
    [880, 120],
    [860, 210],
  ]);
  ctx.stroke();
}

function mate(ctx) {
  const ink = '#3b2414';
  // vapor
  ctx.strokeStyle = '#9fb7a0';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(420, 330);
  ctx.bezierCurveTo(370, 280, 450, 230, 400, 170);
  ctx.bezierCurveTo(370, 130, 410, 100, 400, 70);
  ctx.stroke();
  // bombilla (detrás de la virola)
  ctx.strokeStyle = ink;
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(540, 470);
  ctx.lineTo(700, 140);
  ctx.quadraticCurveTo(716, 104, 760, 100);
  ctx.stroke();
  ctx.strokeStyle = '#d7dbe2';
  ctx.lineWidth = 18;
  ctx.stroke();
  ctx.fillStyle = '#d7dbe2';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.ellipse(782, 100, 32, 15, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // yerba
  ctx.fillStyle = '#7a9b2e';
  ctx.beginPath();
  ctx.ellipse(500, 392, 150, 46, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = '#5d7a1f';
  for (let k = 0; k < 9; k++) {
    circle(ctx, 380 + k * 30, 380 - Math.sin((k / 8) * Math.PI) * 26, 8);
    ctx.fill();
  }
  // calabaza
  const gourd = () => {
    ctx.beginPath();
    ctx.moveTo(355, 420);
    ctx.bezierCurveTo(330, 480, 262, 530, 262, 650);
    ctx.bezierCurveTo(262, 805, 375, 890, 500, 890);
    ctx.bezierCurveTo(625, 890, 738, 805, 738, 650);
    ctx.bezierCurveTo(738, 530, 670, 480, 645, 420);
    ctx.closePath();
  };
  gourd();
  ctx.fillStyle = linGrad(ctx, 270, 420, 740, 890, [
    [0, '#a8692f'],
    [1, '#5c3616'],
  ]);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 16;
  ctx.stroke();
  // guarda de cuero cosida
  ctx.save();
  gourd();
  ctx.clip();
  ctx.fillStyle = '#e9d6b0';
  ctx.beginPath();
  ctx.moveTo(240, 640);
  ctx.bezierCurveTo(400, 690, 600, 690, 760, 640);
  ctx.lineTo(760, 700);
  ctx.bezierCurveTo(600, 750, 400, 750, 240, 700);
  ctx.closePath();
  ctx.fill();
  ctx.setLineDash([22, 16]);
  ctx.strokeStyle = '#7d4a1e';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(240, 670);
  ctx.bezierCurveTo(400, 720, 600, 720, 760, 670);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // brillo
  ctx.fillStyle = '#c98a4b';
  ctx.beginPath();
  ctx.moveTo(320, 600);
  ctx.bezierCurveTo(320, 540, 350, 500, 380, 480);
  ctx.bezierCurveTo(365, 520, 352, 560, 350, 610);
  ctx.closePath();
  ctx.fill();
  // virola
  ctx.fillStyle = '#d7dbe2';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(330, 388, 340, 56, 20) : ctx.rect(330, 388, 340, 56);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#8d939c';
  ctx.lineWidth = 6;
  for (let k = 0; k < 9; k++) {
    ctx.beginPath();
    ctx.moveTo(366 + k * 34, 400);
    ctx.lineTo(352 + k * 34, 432);
    ctx.stroke();
  }
  // texto
  ctx.fillStyle = ink;
  textArc(ctx, '¿UNOS MATES?', 500, 640, 330, { font: `bold 54px ${SANS}`, fill: '#e9d6b0', stroke: ink, lw: 16, bottom: true, spacing: 4 });
}

export const PRESETS = [
  { id: 'sol_montanas', name: 'Sol y montañas', draw: (c, w, h) => frame(c, w, h, solYMontanas) },
  { id: 'ola', name: 'Ola', draw: (c, w, h) => frame(c, w, h, ola) },
  { id: 'calavera', name: 'Calavera con flores', draw: (c, w, h) => frame(c, w, h, calavera) },
  { id: 'corazon', name: 'Corazón de puntadas', draw: (c, w, h) => frame(c, w, h, corazonPuntadas) },
  { id: 'rayo', name: 'Rayo', draw: (c, w, h) => frame(c, w, h, rayo) },
  { id: 'gato', name: 'Gato geométrico', draw: (c, w, h) => frame(c, w, h, gatoGeometrico) },
  { id: 'monstera', name: 'Hoja de monstera', draw: (c, w, h) => frame(c, w, h, monstera) },
  { id: 'tijera', name: 'Tijera vintage', draw: (c, w, h) => frame(c, w, h, tijeraVintage) },
  { id: 'cafe', name: 'Café', draw: (c, w, h) => frame(c, w, h, cafe) },
  { id: 'planeta', name: 'Planeta', draw: (c, w, h) => frame(c, w, h, planeta) },
  { id: 'palmera', name: 'Palmera al atardecer', draw: (c, w, h) => frame(c, w, h, palmera) },
  { id: 'retro', name: 'Retro 80s', draw: (c, w, h) => frame(c, w, h, retro80) },
  { id: 'mate', name: 'Mate', draw: (c, w, h) => frame(c, w, h, mate) },
];

const cache = new Map();

// Dibuja un prediseño en un canvas nuevo (cuadrado, fondo transparente).
export function renderPreset(id, size = 768) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  p.draw(ctx, size, size);
  return c;
}

// Miniatura cacheada (dataURL) para la UI.
export function presetThumb(id, size = 128) {
  const key = id + ':' + size;
  if (!cache.has(key)) cache.set(key, renderPreset(id, size).toDataURL());
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

function fontFor(font) {
  if (!font) return FONTS[0];
  if (typeof font === 'object') return font;
  return FONTS.find((f) => f.id === font || f.css === font || f.name === font) || { id: 'custom', css: font, weight: '700' };
}

// Renderiza texto (multi-línea con \n) a un canvas recortado (fondo transparente).
// opts: font (id de FONTS o font-family css), color, outline (bool | ancho en px), outlineColor,
//       arc (grados que abarca el texto: + arco hacia arriba, − sonrisa, 0 recto),
//       size (px de la letra), letterSpacing (px), align ('center' | 'left' | 'right').
export function renderText(text, { font = 'impacto', color = '#1e1e21', outline = false, outlineColor = '#ffffff', arc = 0, size = 160, letterSpacing = 0, align = 'center' } = {}) {
  const f = fontFor(font);
  size = clamp(+size || 160, 8, 600);
  const lines = String(text ?? '').split('\n').map((l) => l.trimEnd());
  if (!lines.some((l) => l.length)) lines[0] = ' ';
  const fontCss = `${f.style || 'normal'} ${f.weight || '700'} ${size}px ${f.css}`;
  const ow = outline === true ? Math.max(2, size * 0.09) : typeof outline === 'number' ? Math.max(0, outline) : 0;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = fontCss;
  const lineH = size * 1.15;
  const widthOf = (l) => (letterSpacing ? [...l].reduce((a, ch) => a + measure.measureText(ch).width + letterSpacing, 0) - letterSpacing : measure.measureText(l).width);
  const widths = lines.map(widthOf);
  const maxW = Math.max(1, ...widths);
  const arcRad = (clamp(+arc || 0, -330, 330) * Math.PI) / 180;
  const curved = Math.abs(arcRad) >= 0.02;
  const pad = Math.ceil(ow + size * 0.3);
  const block = lineH * lines.length;
  let W;
  let H;
  let R = 0;
  if (!curved) {
    W = Math.ceil(maxW + pad * 2);
    H = Math.ceil(block + pad * 2);
  } else {
    R = maxW / Math.abs(arcRad);
    const half = Math.abs(arcRad) / 2;
    const outer = R + block;
    W = Math.ceil((half >= Math.PI / 2 ? 2 * outer : 2 * outer * Math.sin(half)) + pad * 2 + size);
    H = Math.ceil(outer * (1 - Math.cos(half)) + block + pad * 2 + size);
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.min(4096, W));
  c.height = Math.max(1, Math.min(4096, H));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = fontCss;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const stroke = (t, x, y) => {
    ctx.lineWidth = ow * 2;
    ctx.strokeStyle = outlineColor;
    ctx.strokeText(t, x, y);
  };
  const fill = (t, x, y) => {
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  };
  const passes = ow > 0 ? [stroke, fill] : [fill];
  if (!curved) {
    ctx.textAlign = 'left';
    for (const pass of passes) {
      lines.forEach((l, li) => {
        const lw = widths[li];
        let x = align === 'left' ? pad : align === 'right' ? c.width - pad - lw : (c.width - lw) / 2;
        const y = pad + lineH * (li + 0.5);
        if (!letterSpacing) return pass(l, x, y);
        for (const ch of l) {
          pass(ch, x, y);
          x += measure.measureText(ch).width + letterSpacing;
        }
      });
    }
  } else {
    // centro de curvatura abajo (arco +) o arriba (arco −); cada línea en un círculo concéntrico
    const up = arcRad > 0;
    const cx = c.width / 2;
    const cy = up ? pad + size * 0.6 + R + block - lineH : c.height - pad - size * 0.6 - R - block + lineH;
    ctx.textAlign = 'center';
    for (const pass of passes) {
      lines.forEach((l, li) => {
        const r = up ? R + (lines.length - 1 - li) * lineH : R + li * lineH;
        const lw = widthOf(l);
        let acc = 0;
        for (const ch of l) {
          const cw = measure.measureText(ch).width;
          const off = (acc + cw / 2 - lw / 2) / r;
          const a = up ? -Math.PI / 2 + off : Math.PI / 2 - off;
          ctx.save();
          ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.rotate(up ? a + Math.PI / 2 : a - Math.PI / 2);
          pass(ch, 0, 0);
          ctx.restore();
          acc += cw + letterSpacing;
        }
      });
    }
  }
  return trimCanvas(c, Math.ceil(size * 0.06));
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// Recorta al contenido dejando `margin` px.
function trimCanvas(c, margin = 4) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 6) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return c;
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin);
  y1 = Math.min(h - 1, y1 + margin);
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1;
  o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
