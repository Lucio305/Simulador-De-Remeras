// Retazo de prueba (canvas 2D dentro del panel): un pedazo de tela sujeto con dos pinzas
// sobre la base de corte. Se tira de la pinza derecha (arrastrando o con el botón) y la
// tela se estira según su elasticidad. En modo costura el retazo son dos piezas unidas por
// una costura de prueba: las puntadas se estiran con la tela y, si el hilo no acompaña,
// se cortan de a una; además se ven los defectos de aguja y grosor (agujeritos, puntadas
// salteadas, frunce, costura ondulada).
//
// Uso: const r = createRetazo({ h, listen, seam: true }); panel.append(r.el);
//      ctx.onUpdate((dt) => r.update(dt)); r.setConfig({...}); r.onResult((res) => ...)

import { fabricSwatch } from '../../materials/fabric.js';
import { audio } from '../../core/audio.js';
import { clamp, mixHex, rng } from '../../core/utils.js';

// Estiramiento máximo de una tela al tirar fuerte (fracción del largo).
export function maxStretchOf(fabric) {
  return 0.04 + (fabric?.stretch ?? 0.5) * 0.62;
}

const REST_SCALE = 1.56; // largo útil / largo en reposo (deja lugar para estirar)
const PAD = 22;

export function createRetazo({ h, listen, height = 124, seam = true, idleText = 'tirá →', staleText = 'Cambiaste algo: tirá de nuevo para probar.' } = {}) {
  const canvas = h('canvas', { class: 'hilo-retazo-canvas', style: { height: `${height}px` }, 'aria-label': 'Retazo de prueba: arrastrá hacia la derecha para estirarlo' });
  const pctEl = h('span', { class: 'hilo-retazo-pct' }, '0 %');
  const stateEl = h('span', { class: 'hilo-retazo-state' }, '');
  const btn = h('button', { class: 'btn btn-secondary btn-sm hilo-retazo-btn', type: 'button' }, '🖐 Tirar');
  const verdictEl = h('div', { class: 'hilo-retazo-verdict' });
  const el = h(
    'div',
    { class: `hilo-retazo${seam ? ' is-seam' : ''}` },
    h('div', { class: 'hilo-retazo-stage' }, canvas),
    h('div', { class: 'hilo-retazo-bar' }, h('span', { class: 'hilo-retazo-read' }, h('b', {}, 'Estira '), pctEl, stateEl), btn),
    verdictEl,
  );

  const g = canvas.getContext('2d');
  let cfg = {
    fabricId: 'algodon_jersey',
    color: '#f3f1ea',
    heather: false,
    maxStretch: 0.35,
    zigzag: true,
    threadColor: '#f3f1ea',
    threadWidth: 1.6,
    breakLimit: Infinity,
    skips: 0,
    holes: false,
    pucker: false,
    wavy: false,
    seed: 1,
  };
  let img = null;
  let imgKey = '';
  let stitches = [];
  let s = 0; // estiramiento actual
  let v = 0;
  let dragging = false;
  let dragX0 = 0;
  let target = 0;
  let auto = null; // { t } tirón automático
  let pulled = false;
  let resultSent = true;
  let maxF = 0;
  let broken = 0;
  let snapCooldown = 0;
  let particles = [];
  let shake = 0;
  let time = 0;
  let resultFn = null;
  let W = 0;
  let dpr = 1;

  const usable = () => Math.max(60, W - PAD * 2 - 18);
  const restLen = () => usable() / REST_SCALE;

  function buildStitches() {
    const r = rng(cfg.seed * 7 + 3);
    const n = Math.max(12, Math.round(restLen() / 7.5));
    stitches = [];
    for (let i = 0; i < n; i++) {
      stitches.push({
        thr: cfg.breakLimit + r() * 0.38,
        broken: false,
        curl: r() * Math.PI * 2,
        hole: false,
        skip: false,
      });
    }
    // puntadas salteadas fijas (aguja que no engancha)
    for (let k = 0; k < cfg.skips; k++) {
      const i = 2 + Math.floor(r() * (n - 5));
      stitches[i].skip = true;
    }
    // agujeritos (aguja afilada en tejido de punto)
    if (cfg.holes) for (let i = 1; i < n; i += 2 + Math.floor(r() * 3)) stitches[i].hole = 0.25 + r() * 0.75;
    broken = 0;
    maxF = 0;
  }

  function setImage() {
    const key = `${cfg.fabricId}|${cfg.color}|${cfg.heather}`;
    if (key === imgKey) return;
    imgKey = key;
    const url = fabricSwatch(cfg.fabricId, cfg.color, 192, { heather: cfg.heather });
    const im = new Image();
    im.onload = () => {
      if (imgKey === key) img = im;
    };
    im.src = url;
  }

  function measure() {
    const w = canvas.clientWidth;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (w && (w !== W || d !== dpr)) {
      const first = !W;
      W = w;
      dpr = d;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(height * dpr);
      if (first || !stitches.length) buildStitches();
    }
    return W > 0;
  }

  // --------- puntero ---------
  const localX = (e) => e.clientX - canvas.getBoundingClientRect().left;
  const pullFromDx = (dx) => cfg.maxStretch * (1 - Math.exp(-Math.max(0, dx) / Math.max(40, usable() * 0.26)));
  listen(canvas, 'pointerdown', (e) => {
    if (!measure()) return;
    e.preventDefault();
    dragging = true;
    auto = null;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* sin captura */
    }
    // el tirón arranca en el estiramiento actual (si todavía estaba rebotando)
    dragX0 = localX(e) - invPull(Math.max(0, s));
    startPull();
    target = pullFromDx(localX(e) - dragX0);
    el.classList.add('is-pulling');
  });
  listen(canvas, 'pointermove', (e) => {
    if (!dragging) return;
    target = pullFromDx(localX(e) - dragX0);
    // la tela sigue al dedo al instante (el resorte es solo para la vuelta)
    s = target;
    v = 0;
    checkStrain();
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    target = 0;
    el.classList.remove('is-pulling');
  };
  listen(canvas, 'pointerup', release);
  listen(canvas, 'pointercancel', release);
  listen(canvas, 'lostpointercapture', release);
  listen(btn, 'click', () => api.pull());

  function invPull(sv) {
    const k = clamp(sv / Math.max(1e-6, cfg.maxStretch), 0, 0.98);
    return -Math.log(1 - k) * Math.max(40, usable() * 0.26);
  }

  function startPull() {
    if (!pulled || resultSent) {
      // nueva prueba: si estaba todo cortado de una prueba anterior, se renueva el retazo
      if (resultSent && broken > 0) buildStitches();
      maxF = 0;
    }
    pulled = true;
    resultSent = false;
    verdictEl.classList.remove('show');
  }

  // --------- simulación ---------
  function update(dt) {
    if (!el.isConnected) return;
    time += dt;
    if (!measure()) return;
    dt = Math.min(dt, 0.05);
    if (auto) {
      auto.t += dt;
      const T1 = 1.05;
      const T2 = 1.45;
      if (auto.t < T1) target = cfg.maxStretch * Math.sin((auto.t / T1) * Math.PI * 0.5) * 0.98;
      else if (auto.t < T2) target = cfg.maxStretch * 0.98;
      else {
        target = 0;
        auto = null;
        el.classList.remove('is-pulling');
      }
    }
    const holding = dragging || auto;
    // resorte: firme mientras se sostiene, rebote suave al soltar
    if (!dragging) {
      const k = holding ? 260 : 150;
      const c = holding ? 2 * Math.sqrt(k) : 9;
      const steps = 3;
      for (let i = 0; i < steps; i++) {
        const h2 = dt / steps;
        const a = -k * (s - target) - c * v;
        v += a * h2;
        s += v * h2;
      }
    }
    checkStrain();
    snapCooldown -= dt;
    finishFrame(dt, holding);
  }

  // estiramiento actual → puntadas que se cortan
  function checkStrain() {
    s = clamp(s, -0.03, cfg.maxStretch * 1.04);
    const f = Math.max(0, s) / Math.max(1e-6, cfg.maxStretch);
    if (pulled && !resultSent) maxF = Math.max(maxF, f);
    if (seam && !cfg.noThread && pulled && !resultSent) {
      for (let i = 0; i < stitches.length; i++) {
        const st = stitches[i];
        if (st.broken || f <= st.thr) continue;
        st.broken = true;
        broken++;
        shake = 1;
        spawnSnap(i);
        if (snapCooldown <= 0) {
          audio.play('snip');
          snapCooldown = 0.07;
        }
      }
    }
  }

  // efectos, lecturas, veredicto y dibujo del cuadro
  function finishFrame(dt, holding) {
    shake = Math.max(0, shake - dt * 4);
    for (const p of particles) {
      p.life -= dt;
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.life > 0);

    pctEl.textContent = `${Math.round(Math.max(0, s) * 100)} %`;
    stateEl.textContent = seam && broken ? ` · ${broken} puntada${broken === 1 ? '' : 's'} cortada${broken === 1 ? '' : 's'}` : '';
    stateEl.classList.toggle('bad', broken > 0);

    // el veredicto llega apenas el retazo vuelve (sin esperar a que deje de rebotar)
    if (pulled && !resultSent && !holding && maxF > 0.05 && s < maxF * cfg.maxStretch * 0.35) {
      resultSent = true;
      if (seam && cfg.noThread) api.setVerdict(h('div', { class: 'hilo-retazo-stale' }, 'Primero elegí un tipo de hilo: así el retazo solo tiene alfileres.'));
      else resultFn && resultFn({ maxF, maxStretch: maxF * cfg.maxStretch, broken, total: stitches.length });
    }
    draw();
  }

  function stitchX(i, x0, scale) {
    const step = restLen() / stitches.length;
    return x0 + (i + 0.5) * step * scale;
  }

  function spawnSnap(i) {
    const x0 = PAD;
    const sc = 1 + Math.max(0, s);
    const x = stitchX(i, x0, sc);
    const cy = height * 0.44;
    for (let k = 0; k < 6; k++) {
      particles.push({ x, y: cy, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 90, life: 0.45 + Math.random() * 0.25, color: k % 2 ? cfg.threadColor : '#ffffff' });
    }
  }

  // --------- dibujo ---------
  function draw() {
    const H = height;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // base de corte verde con cuadrícula
    g.fillStyle = '#2f5a4e';
    g.fillRect(0, 0, W, H);
    g.lineWidth = 1;
    for (let x = 6; x < W; x += 12) {
      g.strokeStyle = (Math.round((x - 6) / 12) % 5 === 0) ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
      g.stroke();
    }
    for (let y = 6; y < H; y += 12) {
      g.strokeStyle = (Math.round((y - 6) / 12) % 5 === 0) ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(W, y + 0.5);
      g.stroke();
    }

    const L0 = restLen();
    const sp = Math.max(0, s);
    const sc = 1 + s;
    const jx = shake ? (Math.random() - 0.5) * 2 * shake : 0;
    const x0 = PAD;
    const L = L0 * sc;
    const cy = H * 0.44;
    const hh0 = H * 0.27;
    const hh = hh0 * (1 - 0.32 * sp); // se angosta al estirar

    // regla de estiramiento
    const ry = H - 13;
    g.font = '700 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const labelEvery = L0 * 0.1 < 26 ? 2 : 1;
    for (let k = 0; k <= 5; k++) {
      const p = k / 10;
      const x = Math.round(x0 + L0 * (1 + p)) + 0.5;
      const major = k % labelEvery === 0;
      g.strokeStyle = major ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.moveTo(x, ry - (major ? 9 : 7));
      g.lineTo(x, ry - 3);
      g.stroke();
      if (major) {
        g.fillStyle = 'rgba(255,255,255,0.72)';
        g.fillText(k === 0 ? '0' : `+${k * 10}%`, x, ry + 4);
      }
    }
    // marca de hasta dónde llegó
    if (pulled && maxF > 0.02) {
      const xm = x0 + L0 * (1 + maxF * cfg.maxStretch);
      g.fillStyle = '#f1cc4e';
      g.beginPath();
      g.moveTo(xm, ry - 3);
      g.lineTo(xm - 4, ry - 10);
      g.lineTo(xm + 4, ry - 10);
      g.closePath();
      g.fill();
    }

    // contorno del retazo con bordes de tijera dentada arriba y abajo
    const teeth = 5.5 * sc;
    const path = new Path2D();
    path.moveTo(x0, cy - hh);
    for (let x = x0, k = 0; x < x0 + L; x += teeth / 2, k++) path.lineTo(Math.min(x0 + L, x), cy - hh + (k % 2 ? 2.2 : 0));
    path.lineTo(x0 + L, cy - hh);
    path.lineTo(x0 + L, cy + hh);
    for (let x = x0 + L, k = 0; x > x0; x -= teeth / 2, k++) path.lineTo(Math.max(x0, x), cy + hh - (k % 2 ? 2.2 : 0));
    path.lineTo(x0, cy + hh);
    path.closePath();

    g.save();
    g.translate(jx, 0);
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.fillStyle = cfg.color;
    g.fill(path);
    g.shadowColor = 'transparent';
    g.save();
    g.clip(path);
    if (img) {
      const S = img.naturalWidth || 192;
      const sw = S * 0.86;
      const sh = Math.min(S * 0.9, sw * ((hh0 * 2) / L0));
      g.drawImage(img, (S - sw) / 2, (S - sh) / 2, sw, sh, x0, cy - hh, L, hh * 2);
      if (seam) {
        // trama un poco más suave para que la costura se lea bien
        g.globalAlpha = 0.3;
        g.fillStyle = cfg.color;
        g.fillRect(x0, cy - hh, L, hh * 2);
        g.globalAlpha = 1;
      }
    }
    // sombreado suave + brillo de tensión
    const grd = g.createLinearGradient(0, cy - hh, 0, cy + hh);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = grd;
    g.fillRect(x0, cy - hh, L, hh * 2);
    if (sp > 0.02) {
      // líneas de tensión a lo largo del tirón
      g.strokeStyle = `rgba(255,255,255,${Math.min(0.18, sp * 0.5)})`;
      g.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        const y = cy - hh + (hh * 2 * k) / 4;
        g.beginPath();
        g.moveTo(x0 + 8, y);
        g.lineTo(x0 + L - 8, y);
        g.stroke();
      }
    }
    if (seam && !cfg.noThread) drawSeam(x0, L0, sc, cy, hh, sp);
    else if (seam) drawEmptySeam(x0, L, cy);
    g.restore();
    g.restore();

    // pinzas
    drawClamp(x0 - 12 + jx, cy, hh, '#7f868e', false);
    drawClamp(x0 + L - 4 + jx, cy, hh, '#d2553f', true);

    // indicación cuando todavía no se probó
    if (!pulled && !dragging) {
      const ax = x0 + L + 22 + Math.sin(time * 4) * 4;
      g.fillStyle = 'rgba(255,248,239,0.9)';
      g.font = '800 12px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(idleText, ax, cy);
    }

    for (const p of particles) {
      g.globalAlpha = clamp(p.life * 2.4);
      g.fillStyle = p.color;
      g.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
    }
    g.globalAlpha = 1;
  }

  function drawClamp(x, cy, hh, color, grip) {
    const w = 16;
    const top = cy - hh - 7;
    const hgt = hh * 2 + 14;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 2;
    g.fillStyle = color;
    roundRect(x, top, w, hgt, 4);
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(x + 2, top + 2, 4, hgt - 4, 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.arc(x + w / 2, top + 7, 2.2, 0, Math.PI * 2);
    g.arc(x + w / 2, top + hgt - 7, 2.2, 0, Math.PI * 2);
    g.fill();
    if (grip) {
      g.fillStyle = '#fff';
      g.font = '900 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('⇢', x + w / 2, cy + 0.5);
    }
    g.restore();
  }

  function roundRect(x, y, w, hgt, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hgt, r);
    g.arcTo(x + w, y + hgt, x, y + hgt, r);
    g.arcTo(x, y + hgt, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // sin hilo elegido: las dos piezas solo están hilvanadas con alfileres
  function drawEmptySeam(x0, L, cy) {
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x0 + 4, cy);
    g.lineTo(x0 + L - 4, cy);
    g.stroke();
    g.setLineDash([]);
    for (let x = x0 + 18; x < x0 + L - 10; x += 34) {
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.arc(x, cy - 6, 2.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#9aa3ad';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, cy - 6);
      g.lineTo(x + 3, cy + 8);
      g.stroke();
    }
  }

  function seamY(x) {
    return cfg.wavy ? Math.sin(x * 0.21) * 2.6 : 0;
  }

  function drawSeam(x0, L0, sc, cy, hh, sp) {
    const L = L0 * sc;
    const f = sp / Math.max(1e-6, cfg.maxStretch);
    // unión de las dos piezas (canaleta)
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    for (let x = x0; x <= x0 + L; x += 2) g[x === x0 ? 'moveTo' : 'lineTo'](x, cy + seamY(x));
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    for (let x = x0; x <= x0 + L; x += 2) g[x === x0 ? 'moveTo' : 'lineTo'](x, cy + 1.4 + seamY(x));
    g.stroke();

    // frunce: pliegues a los dos lados de la costura (hilo demasiado grueso para la tela)
    if (cfg.pucker) {
      const pitch = 6.5 * sc;
      for (let x = x0 + 5, k = 0; x < x0 + L - 5; x += pitch, k++) {
        for (const sgn of [-1, 1]) {
          const len = 10 + 4 * Math.sin(k * 1.7 + (sgn > 0 ? 1 : 0));
          const y1 = cy + seamY(x) + sgn * 2.5;
          const y2 = cy + seamY(x) + sgn * Math.min(hh - 3, len);
          const lean = sgn * 1.5;
          g.lineCap = 'round';
          g.strokeStyle = 'rgba(0,0,0,0.34)';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x, y1);
          g.quadraticCurveTo(x + 2 + lean, (y1 + y2) / 2, x + lean * 0.5, y2);
          g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.3)';
          g.lineWidth = 1.3;
          g.beginPath();
          g.moveTo(x + 2, y1);
          g.quadraticCurveTo(x + 4.2 + lean, (y1 + y2) / 2, x + 2 + lean * 0.5, y2);
          g.stroke();
        }
      }
    }

    const n = stitches.length;
    const step = (L0 / n) * sc;
    const amp = cfg.zigzag ? 4.4 * (1 - 0.35 * Math.min(1, sp * 2)) : 0;
    const pt = (i) => {
      const x = x0 + (i + 0.5) * step;
      const y = cy + seamY(x) + (cfg.zigzag ? (i % 2 ? amp : -amp) : 0);
      return [x, y];
    };

    // agujeritos y carreras (aguja afilada que corta las mallas del punto)
    if (cfg.holes) {
      for (let i = 0; i < n; i++) {
        const st = stitches[i];
        if (!st.hole) continue;
        const [x, y] = pt(i);
        const grow = clamp(0.25 + (f - 0.08) / 0.55) * st.hole;
        const rx = 1.2 + 3.2 * grow;
        if (grow > 0.3) {
          // carrera: escalerita de mallas sueltas hacia el borde
          const len = (hh - 5) * clamp((grow - 0.3) / 0.5);
          const dir = i % 4 < 2 ? 1 : -1;
          g.strokeStyle = 'rgba(20,14,10,0.5)';
          g.lineWidth = 1.2;
          for (const dx of [-1.6, 1.6]) {
            g.beginPath();
            g.moveTo(x + dx, y + dir * rx * 0.6);
            g.lineTo(x + dx * 0.8, y + dir * (rx + len));
            g.stroke();
          }
          g.strokeStyle = 'rgba(255,255,255,0.35)';
          g.lineWidth = 0.9;
          for (let k = 3; k < len; k += 3) {
            g.beginPath();
            g.moveTo(x - 1.4, y + dir * (rx + k));
            g.lineTo(x + 1.4, y + dir * (rx + k));
            g.stroke();
          }
        }
        g.fillStyle = 'rgba(18,12,8,0.78)';
        g.beginPath();
        g.ellipse(x, y, rx, rx * 0.8, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.ellipse(x, y + 0.5, rx + 0.6, rx * 0.8 + 0.6, 0, 0.2, Math.PI - 0.2);
        g.stroke();
      }
    }

    const w = cfg.threadWidth;
    const dark = mixHex(cfg.threadColor, '#000000', 0.5);
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      const st = stitches[i];
      if (st.skip) {
        // puntada salteada: un hilo largo y flojo que saltea un punto
        if (i + 2 < n) segs.push({ a: pt(i), b: pt(i + 2), loose: true, broken: st.broken, i });
        i++;
        continue;
      }
      segs.push({ a: pt(i), b: cfg.zigzag ? pt(i + 1) : null, broken: st.broken, i });
    }
    // donde se cortaron puntadas la costura se abre
    g.lineCap = 'round';
    for (const sg of segs) {
      if (!sg.broken) continue;
      const [ax] = sg.a;
      const bx = sg.b ? sg.b[0] : ax + step * 0.34;
      const x1 = Math.min(ax, bx) - step * 0.3;
      const x2 = Math.max(ax, bx) + step * 0.3;
      g.strokeStyle = 'rgba(28,18,12,0.55)';
      g.lineWidth = 1.6 + 2.4 * clamp(f);
      g.beginPath();
      g.moveTo(x1, cy + seamY(x1));
      g.lineTo(x2, cy + seamY(x2));
      g.stroke();
    }
    // sombra, contorno oscuro, el hilo y el brillo
    for (const pass of [0, 1, 2, 3]) {
      g.lineCap = 'round';
      g.lineWidth = pass === 0 ? w + 1.6 : pass === 1 ? w + 1.1 : pass === 2 ? w : Math.max(0.5, w * 0.35);
      g.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.28)' : pass === 1 ? dark : pass === 2 ? cfg.threadColor : 'rgba(255,255,255,0.45)';
      const off = pass === 0 ? 1.3 : pass === 3 ? -w * 0.22 : 0;
      for (const sg of segs) {
        const [ax, ay] = sg.a;
        let bx;
        let by;
        if (sg.b) [bx, by] = sg.b;
        else {
          // puntada recta: tramo centrado en el punto
          bx = ax + step * 0.3;
          by = ay;
        }
        const sx = cfg.zigzag || sg.loose ? ax : ax - step * 0.3;
        const sy = ay;
        if (sg.broken) {
          // dos puntas rizadas en vez de la puntada
          const st = stitches[sg.i];
          for (const [px, py, d] of [[sx, sy, 1], [bx, by, -1]]) {
            const ang = st.curl + (d > 0 ? 0 : Math.PI);
            g.beginPath();
            g.moveTo(px, py + off);
            g.quadraticCurveTo(px + d * 3 + Math.cos(ang) * 2, py + off + Math.sin(ang) * 3, px + d * 2 + Math.cos(ang + 1.4) * 3.5, py + off + Math.sin(ang + 1.4) * 3.5);
            g.stroke();
          }
          continue;
        }
        g.beginPath();
        g.moveTo(sx, sy + off);
        if (sg.loose) g.quadraticCurveTo((sx + bx) / 2, Math.max(sy, by) + 9, bx, by + off);
        else g.lineTo(bx, by + off);
        g.stroke();
      }
    }
  }

  const api = {
    el,
    canvas,
    update,
    get stretch() {
      return s;
    },
    get pulled() {
      return pulled;
    },
    setConfig(next = {}) {
      // los colores solo cambian el dibujo; todo lo demás cambia la prueba y la reinicia
      const key = (c) => JSON.stringify({ ...c, threadColor: null, color: null, heather: null });
      const before = key(cfg);
      cfg = { ...cfg, ...next };
      setImage();
      if (key(cfg) !== before) {
        const hadResult = pulled && resultSent;
        buildStitches();
        if (pulled) {
          pulled = false;
          resultSent = true;
          maxF = 0;
          if (hadResult) api.setVerdict(staleText ? h('div', { class: 'hilo-retazo-stale' }, staleText) : null);
        }
      }
    },
    // Tirón automático (botón): estira hasta el máximo, sostiene y suelta.
    pull() {
      if (!measure()) return;
      dragging = false;
      startPull();
      auto = { t: 0 };
      el.classList.add('is-pulling');
    },
    onResult(fn) {
      resultFn = fn;
    },
    setVerdict(content) {
      verdictEl.innerHTML = '';
      if (!content) {
        verdictEl.classList.remove('show');
        return;
      }
      if (typeof content === 'string') verdictEl.innerHTML = content;
      else verdictEl.appendChild(content);
      verdictEl.classList.add('show');
      // en el celular el veredicto puede quedar abajo del borde del panel
      requestAnimationFrame(() => {
        try {
          verdictEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (e) {
          /* sin scroll suave */
        }
      });
    },
  };
  setImage();
  return api;
}
