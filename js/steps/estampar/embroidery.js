// Mini-juego de bordado a máquina.
// 1) Estabilizador: recortable para tejidos de punto, desgarrable para planos.
// 2) Enmarcar: centrar el bastidor (con su plantilla) sobre la cruz de tiza arrastrándolo
//    (o con flechas, Q/E para rotar) y ajustar el tornillo hasta la tensión justa (mantener).
//    Lo que quede corrido o girado se borda corrido o girado.
// 3) Bordar: la máquina borda color por color (se ve aparecer el bordado) y pide cambiar el
//    hilo: hay que elegir el carretel correcto a tiempo.
// 4) Desenmarcar y recortar.

import * as THREE from 'three';
import { OK, NO, MID, fmt, layShirt, conformGeometry, buildLayers, layerMask, revealRow, maskedResult, layerCanvas, colorName, colorDist, distinctNames, basePrint, surfacePoint, gauge, gameKey, untilFrame, clamp, smoothstep } from './common.js';

const DEG = Math.PI / 180;
const HOOPS = [
  { id: '10x10', w: 0.1, h: 0.1 },
  { id: '13x18', w: 0.13, h: 0.18 },
  { id: '16x26', w: 0.16, h: 0.26 },
  { id: '20x30', w: 0.2, h: 0.3 },
];
const EXTRA_THREADS = ['#1e1e21', '#f4f2ec', '#c62f2f', '#2f5cb6', '#f1cc4e', '#3f9a5c', '#e5732b', '#6b4b9b', '#f0a0c0', '#8f8f8f', '#7a4f2e', '#8cc4e8'];

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function ringGeometry(w, h, r, th, height) {
  const outer = roundedRect(w + th * 2, h + th * 2, r + th);
  outer.holes.push(new THREE.Path(roundedRect(w, h, r).getPoints(40).reverse()));
  const g = new THREE.ExtrudeGeometry(outer, { depth: height, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 18 });
  g.rotateX(-Math.PI / 2);
  return g;
}

export async function runEmbroidery(kit) {
  const { ctx, info, ui, h, audio, world, shirt, engine, isMobile, catalog } = kit;
  const { tech, fabric, side, placement } = info;
  const em = world.props.embroideryMachine;
  const hp = world.props.heatPress;

  let phase = 'stab'; // stab | hoop | mount | stitch | change | finish | reveal
  // ---------------- props ----------------
  kit.keepPose(em.group);
  em.setDemoVisible?.(false);
  ctx.track(() => {
    em.setDemoVisible?.(true);
    em.setRunning(0);
    em.setThreadColor('#c2364a');
    hp.setOpen(0);
  });
  // la bordadora gira para que el brazo quede hacia la pared (la remera entra por delante)
  em.group.rotation.y = Math.PI / 2;
  em.group.updateMatrixWorld(true);
  hp.setOpen(0.9);
  const N = em.hoopCenter.clone();

  // ---------------- estampa y capas ----------------
  ui.panel({ kicker: kit.kicker, title: `Bordado · ${tech.name}`, subtitle: 'Preparando el programa de puntadas…', body: h('div', { class: 'est-loading' }, 'Digitalizando el diseño en puntadas…') });
  await kit.wait(60);
  if (!ctx.alive) return;
  const baseRes = info.d.preview && info.d.preview.technique === tech.id && info.d.preview.color ? info.d.preview : basePrint(info);
  const L = buildLayers(baseRes);
  const order = L.order.length ? L.order : [0];
  const threads = order.map((k) => L.palette[k] || '#1e1e21');
  // nombres sin repetir: si dos hilos se parecen, "rojo oscuro" y "rojo claro"
  const threadNames = distinctNames(threads);
  if (!ctx.alive) return;
  const W = placement.width;
  const H = W / (baseRes.aspect || 1);
  const cw = W * 0.96;
  const ch = H * 0.96;
  const hoopDef = HOOPS.find((x) => cw + 0.016 <= x.w && ch + 0.016 <= x.h) || { id: 'jumbo', w: Math.max(0.2, cw + 0.03), h: Math.max(0.3, ch + 0.03) };
  const hoopName = hoopDef.id === 'jumbo' ? `grande (${Math.round(hoopDef.w * 100)} × ${Math.round(hoopDef.h * 100)} cm)` : `${hoopDef.id.replace('x', ' × ')} cm`;
  const area = (baseRes.coverage || 0.4) * W * H;
  const totalStitches = Math.max(1200, Math.round((area * 1.8e6) / 10) * 10);
  const layerShare = order.map((k) => L.counts[k] / Math.max(1, order.reduce((a, kk) => a + L.counts[kk], 0)));

  // ---------------- remera ----------------
  // se enmarca al lado de la bordadora (a la izquierda) y después se monta bajo la aguja
  const shiftX = -(hoopDef.w / 2 + 0.105);
  let slide = shiftX; // desplazamiento actual de remera + bastidor respecto de la aguja
  let slideTarget = shiftX;
  let slideZ = 0;
  let slideZTarget = 0;
  ctx.placeShirt('exhibicion', { inflation: 0.025 });
  const surfaceY = Math.max(N.y + 0.012, hp.platenCenter.y + 0.002);
  const anchor = new THREE.Vector3(N.x + shiftX, surfaceY, N.z);
  const lay = layShirt(shirt, info, { anchor, inflation: 0.025, lift: 0.0008 });
  const restPos = lay.position.clone();
  let drop = 1;
  shirt.group.position.y = restPos.y + 0.16;
  let topYc = null;
  const topY = () => {
    if (drop > 0) return surfacePoint(shirt, side, placement.x, placement.y, 0).p.y;
    if (topYc === null) topYc = surfacePoint(shirt, side, placement.x, placement.y, 0).p.y;
    return topYc;
  };

  // ---------------- cámara ----------------
  const view = () => {
    if (phase === 'stab' || phase === 'hoop') {
      const x = N.x + shiftX;
      const k = Math.max(1, hoopDef.h / 0.2);
      return isMobile()
        ? { position: [x + 0.03, N.y + 0.95 * k, N.z + 0.62 * k], target: [x + 0.02, N.y, N.z + 0.05] }
        : { position: [x + 0.02, N.y + 0.62 * k, N.z + 0.42 * k], target: [x + 0.01, N.y + 0.01, N.z - 0.0] };
    }
    // Bordando: desde el costado derecho y bajo, mirando por debajo del brazo de la bordadora.
    // El pantógrafo lleva lo ya bordado hacia atrás de la aguja, donde el brazo deja ~16 cm de
    // luz: así se ve aparecer el bordado (desde arriba o de frente lo taparía el cabezal).
    const k = clamp(Math.max(W, H) / 0.11, 1, 1.9);
    return isMobile()
      ? { position: [N.x + 0.55 * k, N.y + 0.5 * k, N.z + 0.28 * k], target: [N.x - 0.02, N.y + 0.012, N.z - 0.04 - H * 0.1] }
      : { position: [N.x + 0.36 * k, N.y + 0.22 * k, N.z + 0.09 * k], target: [N.x - 0.01, N.y + 0.035 * k, N.z - 0.05 - H * 0.15] };
  };
  ctx.flyTo(view(), 1.4);
  let wasMobile = isMobile();
  ctx.listen(window, 'resize', () => {
    if (isMobile() === wasMobile) return;
    wasMobile = isMobile();
    if (!finished) ctx.flyTo(view(), 0.6);
  });

  // ---------------- cruz de tiza ----------------
  const chalkHex = info.lum > 0.55 ? '#3c6fb6' : '#f4f1e8';
  const crossCanvas = document.createElement('canvas');
  crossCanvas.width = crossCanvas.height = 128;
  {
    const g = crossCanvas.getContext('2d');
    g.strokeStyle = chalkHex;
    g.lineCap = 'round';
    g.globalAlpha = 0.85;
    for (let k = 0; k < 3; k++) {
      g.lineWidth = 3.2 - k * 0.6;
      g.beginPath();
      g.moveTo(64 + (Math.random() - 0.5) * 2, 6);
      g.lineTo(64 + (Math.random() - 0.5) * 2, 122);
      g.moveTo(6, 64 + (Math.random() - 0.5) * 2);
      g.lineTo(122, 64 + (Math.random() - 0.5) * 2);
      g.stroke();
    }
    g.lineWidth = 2;
    for (const t of [24, 104]) {
      g.beginPath();
      g.moveTo(t, 58);
      g.lineTo(t, 70);
      g.moveTo(58, t);
      g.lineTo(70, t);
      g.stroke();
    }
  }
  const crossTex = new THREE.CanvasTexture(crossCanvas);
  crossTex.colorSpace = THREE.SRGBColorSpace;
  const cross = new THREE.Mesh(
    conformGeometry(shirt, side, { cx: placement.x, cy: placement.y, w: 0.07, h: 0.07, rot: placement.rotation || 0 }, { segs: 6, offset: 0.0012 }),
    new THREE.MeshStandardMaterial({ map: crossTex, transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  cross.renderOrder = 3;
  ctx.add(cross, shirt.group);

  // ---------------- bastidor propio ----------------
  const hoop = new THREE.Group();
  hoop.name = 'bastidor';
  const hoopMat = new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.45 });
  const hoopMat2 = new THREE.MeshStandardMaterial({ color: '#d8cfbf', roughness: 0.5 });
  const R = 0.028;
  hoop.add(new THREE.Mesh(ringGeometry(hoopDef.w, hoopDef.h, R, 0.008, 0.009), hoopMat));
  const outerRing = new THREE.Mesh(ringGeometry(hoopDef.w + 0.018, hoopDef.h + 0.018, R + 0.009, 0.007, 0.007), hoopMat2);
  outerRing.position.y = -0.001;
  hoop.add(outerRing);
  for (const m of hoop.children) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  // tornillo de ajuste
  const screw = new THREE.Group();
  screw.position.set(0, 0.006, hoopDef.h / 2 + 0.024);
  const screwMat = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.9, roughness: 0.3 });
  screw.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), hoopMat2));
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 12).rotateX(Math.PI / 2), screwMat);
  knob.position.set(0, 0.004, 0.012);
  screw.add(knob);
  hoop.add(screw);
  // plantilla transparente con grilla y cruz
  const tplCanvas = document.createElement('canvas');
  tplCanvas.width = 256;
  tplCanvas.height = Math.round((256 * hoopDef.h) / hoopDef.w);
  {
    const g = tplCanvas.getContext('2d');
    const tw = tplCanvas.width;
    const th = tplCanvas.height;
    g.fillStyle = 'rgba(235,245,255,0.16)';
    g.fillRect(0, 0, tw, th);
    g.strokeStyle = 'rgba(40,120,200,0.45)';
    g.lineWidth = 1;
    const step = tw / (hoopDef.w * 100); // 1 cm
    for (let x = tw / 2 % step; x < tw; x += step) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, th);
      g.stroke();
    }
    for (let y = th / 2 % step; y < th; y += step) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(tw, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(210,60,40,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(tw / 2, 0);
    g.lineTo(tw / 2, th);
    g.moveTo(0, th / 2);
    g.lineTo(tw, th / 2);
    g.stroke();
    g.beginPath();
    g.arc(tw / 2, th / 2, step * 0.7, 0, Math.PI * 2);
    g.stroke();
  }
  const tplTex = new THREE.CanvasTexture(tplCanvas);
  tplTex.colorSpace = THREE.SRGBColorSpace;
  const template = new THREE.Mesh(new THREE.PlaneGeometry(hoopDef.w, hoopDef.h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tplTex, transparent: true, depthWrite: false }));
  template.position.y = 0.004;
  template.renderOrder = 6;
  hoop.add(template);
  ctx.add(hoop);
  // posición del bastidor en coords vistas (centro y giro)
  const hv = { x: placement.x + 0.045, y: placement.y - 0.035, rot: (placement.rotation || 0) - 7 };
  let hoopLift = 0.25;
  // pantógrafo: corrimiento de remera + bastidor para que la aguja caiga en la fila que se borda
  const panto = { x: 0, z: 0, tx: 0, tz: 0 };
  const placeHoop = () => {
    const y0 = topY();
    hoop.position.set(N.x + slide + panto.x + (hv.x - placement.x), y0 + 0.0015 + hoopLift, N.z + slideZ + panto.z - (hv.y - placement.y));
    hoop.rotation.set(0, hv.rot * DEG, 0);
  };
  placeHoop();
  hoop.visible = false;

  // ---------------- estado ----------------
  let finished = false;
  let busy = false;
  let autoMode = false;
  let stab = null;
  let tension = 0;
  let tensionSet = false;
  let tightening = false;
  let layer = 0;
  let layerFrac = 0;
  let layerSteps = 0;
  let stitchesDone = 0;
  let changeT = 0;
  const picks = []; // { wrong, t }
  let wrongNow = 0;
  let sewing = null;
  let simT = 0;
  let hooped = null; // error congelado al montar
  const tensionZone = fabric.knit ? [40, 64] : [55, 82];

  // ---------------- panel ----------------
  const stages = kit.stepsBar(['Entretela', 'Bastidor', 'Bordar', 'Terminar']);
  stages.classList.add('many');
  const stabGrid = ui.optionGrid({
    columns: 1,
    options: catalog.STABILIZERS.map((s) => ({ id: s.id, label: s.name, sub: s.desc, icon: s.id === 'recortable' ? '✂️' : s.id === 'desgarrable' ? '📄' : '💧' })),
    value: null,
    onChange: (id) => {
      stab = id;
      ui.enableAction('next', true);
    },
  });
  const fabricLine = ui.note(`Tu tela: <b>${fabric.short}</b> · ${fabric.knit ? 'tejido de <b>punto</b> (estira)' : 'tejido <b>plano</b> (no estira)'} · ${fabric.gsm} g/m².`, 'info');
  const stabBox = h('div', {}, ui.section('Estabilizador (va debajo de la tela)', fabricLine, stabGrid));

  const rotL = h('button', { class: 'btn btn-secondary btn-sm', title: 'Girar a la izquierda (Q)', onClick: () => rotateHoop(1) }, '⟲ Girar');
  const rotR = h('button', { class: 'btn btn-secondary btn-sm', title: 'Girar a la derecha (E)', onClick: () => rotateHoop(-1) }, 'Girar ⟳');
  const tightBtn = h('button', { class: 'btn btn-secondary est-hold' }, '🔩 Ajustar tornillo (mantener)');
  tightBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startTighten();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) tightBtn.addEventListener(ev, () => stopTighten());
  const tensionGauge = gauge(h, { min: 0, max: 100, zones: [{ from: 0, to: tensionZone[0] - 8, cls: 'cold' }, { from: tensionZone[0] - 8, to: tensionZone[0], cls: 'warn' }, { from: tensionZone[0], to: tensionZone[1], cls: 'good' }, { from: tensionZone[1], to: tensionZone[1] + 10, cls: 'warn' }, { from: tensionZone[1] + 10, to: 100, cls: 'bad' }], left: 'floja', right: 'estirada' });
  const tensionText = h('span', { class: 'est-status-text' }, 'Sin ajustar');
  const hoopBox = h(
    'div',
    {},
    ui.section(
      `Bastidor ${hoopName}`,
      h('p', { class: 'est-p', html: 'Arrastrá el bastidor hasta que la <b>cruz roja</b> de la plantilla quede justo sobre la <b>cruz de tiza</b>, y derecho.' }),
      h('div', { class: 'est-row' }, rotL, rotR),
    ),
    ui.section('Tensión de la tela', h('p', { class: 'est-p', html: fabric.knit ? 'En tejido de punto: firme pero <b>sin estirar</b> la malla (si la estirás, al soltar el bastidor el bordado se deforma).' : 'En tejido plano: tensa <b>como un tambor</b>, sin arrugas.' }), tightBtn, tensionGauge, h('div', { class: 'est-status' }, tensionText)),
  );

  const seqItems = threads.map((hex, i) => {
    const st = h('span', { class: 'est-ink-st' }, 'pendiente');
    const el = h('div', { class: 'est-ink' }, h('span', { class: 'est-ink-sw est-spool', style: { background: hex } }), h('span', { class: 'est-ink-name' }, `${i + 1}. hilo ${threadNames[i]}`), st);
    return { el, st };
  });
  const progMeter = ui.meter({ label: 'Puntadas', value: 0, text: `0 / ${totalStitches.toLocaleString('es-AR')}` });
  const stitchBox = h('div', {}, ui.section('Hoja de bordado (orden de los hilos)', h('div', { class: 'est-inks' }, ...seqItems.map((s) => s.el)), progMeter));
  const tipBox = h('div', { class: 'est-tipbox' });
  const body = h('div', { class: 'est-panel est-emb' }, stages, tipBox, stabBox, hoopBox, stitchBox);
  ui.panel({ kicker: kit.kicker, title: `Bordado a máquina`, subtitle: `${threads.length} hilo${threads.length > 1 ? 's' : ''} · ${totalStitches.toLocaleString('es-AR')} puntadas · bastidor ${hoopName}`, body });

  // ---------------- HUD ----------------
  const dial = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dial.setAttribute('viewBox', '-50 -50 100 100');
  dial.setAttribute('class', 'est-dial');
  dial.innerHTML = '<circle r="46" class="est-dial-bg"/><circle r="9" class="est-dial-ok"/><path d="M-46 0H46M0 -46V46" class="est-dial-cross"/><g class="est-dial-hoop"><path d="M-9 0H9M0 -9V9" /><circle r="5"/></g>';
  const dialHoop = dial.querySelector('.est-dial-hoop');
  const alignText = h('b', { class: 'est-hud-mid' }, '');
  const hudAlign = h('div', { class: 'est-hud-sec est-hud-align' }, dial, h('div', { class: 'est-hud-col' }, h('span', {}, 'Desvío'), alignText, h('small', { class: 'est-hud-small' }, 'escala ×3')));
  const scr = document.createElement('canvas');
  scr.width = 220;
  scr.height = 160;
  scr.className = 'est-emb-screen';
  const hudProg = h('div', { class: 'est-hud-sec' }, scr, h('div', { class: 'est-hud-row' }, h('span', { class: 'est-hud-ink' }), h('b', { class: 'est-hud-mid' })), h('div', { class: 'est-hud-bar' }, h('i')));
  // pantalla de la bordadora: lo bordado, el color actual avanzando y la línea de la aguja
  const layerCv = new Map();
  const silCv = (keys, hex) => {
    const key = keys.join(',') + hex;
    if (!layerCv.has(key)) layerCv.set(key, layerCanvas(L, keys, hex));
    return layerCv.get(key);
  };
  function drawScreen() {
    const g = scr.getContext('2d');
    const w = scr.width;
    const hh = scr.height;
    const bg = g.createLinearGradient(0, 0, 0, hh);
    bg.addColorStop(0, '#eef4ee');
    bg.addColorStop(1, '#d9e6de');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, hh);
    const s0 = Math.min((w - 16) / L.w, (hh - 16) / L.h);
    const dw = L.w * s0;
    const dh = L.h * s0;
    const ox = (w - dw) / 2;
    const oy = (hh - dh) / 2;
    g.globalAlpha = 0.35;
    g.drawImage(silCv(order, '#a9bcb4'), ox, oy, dw, dh);
    g.globalAlpha = 1;
    g.shadowColor = 'rgba(20,40,40,0.55)';
    g.shadowBlur = 1.5;
    for (let i = 0; i < Math.min(layer, order.length); i++) g.drawImage(silCv([order[i]], threads[i]), ox, oy, dw, dh);
    if (layer < order.length && (phase === 'stitch' || phase === 'change' || phase === 'mount')) {
      // se borda de arriba hacia abajo (como avanza el pantógrafo)
      const k = order[layer];
      const y0 = L.minY[k];
      const y1 = revealRow(L, k, layerFrac);
      if (y1 - y0 >= 1) g.drawImage(silCv([k], threads[layer]), 0, 0, L.w, y1, ox, oy, dw, y1 * s0);
      g.shadowBlur = 0;
      g.strokeStyle = '#e0452f';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(ox - 4, oy + y1 * s0);
      g.lineTo(ox + dw + 4, oy + y1 * s0);
      g.stroke();
    }
  }
  const pickTitle = h('div', { class: 'est-pick-title' }, '🧵 ¡Cambio de hilo!');
  const pickRow = h('div', { class: 'est-pick' });
  const hudPick = h('div', { class: 'est-hud-sec est-hud-pick' }, pickTitle, pickRow, h('small', { class: 'est-hud-small' }, 'Elegí el carretel que sigue en la hoja de bordado'));
  const hudEl = h('div', { class: 'est-hud' }, h('div', { class: 'hud-title' }, 'Bordadora'), hudAlign, hudProg, hudPick);
  ui.hud(hudEl);

  function alignErr() {
    const dx = hv.x - placement.x;
    const dy = hv.y - placement.y;
    return { mm: Math.hypot(dx, dy) * 1000, dx, dy, deg: hv.rot - (placement.rotation || 0) };
  }

  function refreshHud() {
    hudAlign.style.display = phase === 'hoop' ? '' : 'none';
    hudProg.style.display = phase === 'mount' || phase === 'stitch' || phase === 'change' || phase === 'finish' ? '' : 'none';
    hudPick.style.display = phase === 'change' ? '' : 'none';
    hudEl.classList.toggle('changing', phase === 'change');
    if (phase === 'hoop') {
      const e = alignErr();
      // 1 mm de error = 3 unidades del dial
      const px = clamp(e.dx * 3000, -42, 42);
      const py = clamp(-e.dy * 3000, -42, 42);
      dialHoop.setAttribute('transform', `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${(-e.deg * 3).toFixed(1)})`);
      const good = e.mm <= 3 && Math.abs(e.deg) <= 1.5;
      dial.classList.toggle('ok', good);
      alignText.textContent = `${fmt(e.mm, 0)} mm · ${fmt(Math.abs(e.deg), 1)}°`;
      alignText.className = `est-hud-mid ${good ? 'good' : e.mm < 8 && Math.abs(e.deg) < 4 ? 'warn' : 'bad'}`;
    }
    if (phase === 'mount' || phase === 'stitch' || phase === 'change' || phase === 'finish') {
      const hex = threads[clamp(layer, 0, threads.length - 1)];
      hudProg.querySelector('.est-hud-ink').innerHTML = phase === 'finish' ? '✅ Bordado terminado' : `<i class="est-dot" style="background:${hex}"></i> Hilo ${layer + 1} de ${threads.length}`;
      const pct = clamp(stitchesDone / totalStitches);
      hudProg.querySelector('b').textContent = `${Math.round(pct * 100)}%`;
      hudProg.querySelector('.est-hud-bar i').style.width = `${pct * 100}%`;
      progMeter.set(pct, `${Math.round(stitchesDone).toLocaleString('es-AR')} / ${totalStitches.toLocaleString('es-AR')}`);
    }
    if (phase === 'hoop') {
      tensionGauge.set(tension);
      const inZone = tension >= tensionZone[0] && tension <= tensionZone[1];
      tensionText.textContent = !tensionSet && !tightening ? 'Sin ajustar: mantené apretado el botón' : tightening ? `Ajustando… ${Math.round(tension)}` : inZone ? `Tensión justa (${Math.round(tension)}) ✓` : tension < tensionZone[0] ? `Floja (${Math.round(tension)}): se va a fruncir` : `Estirada (${Math.round(tension)}): aflojá y volvé a ajustar`;
      knob.rotation.z = tension * 0.12;
    }
  }

  function setPhaseUI() {
    const auto = { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoRun() };
    stabBox.style.display = phase === 'stab' ? '' : 'none';
    hoopBox.style.display = phase === 'hoop' ? '' : 'none';
    stitchBox.style.display = phase === 'mount' || phase === 'stitch' || phase === 'change' || phase === 'finish' || phase === 'reveal' ? '' : 'none';
    stages.set({ stab: 0, hoop: 1, mount: 2, stitch: 2, change: 2, finish: 3, reveal: 4 }[phase] ?? 0);
    seqItems.forEach((s, i) => {
      const done = i < layer || phase === 'finish' || phase === 'reveal';
      s.el.className = `est-ink ${done ? 'done' : i === layer ? 'current' : ''}`;
      s.st.textContent = done ? 'listo ✓' : i === layer ? (phase === 'change' ? 'cambiar' : 'bordando') : 'pendiente';
    });
    if (phase === 'stab') {
      tipBox.innerHTML = '<b>1 · Estabilizador</b><br>Es la entretela que va debajo y sostiene las puntadas. Cada tela pide el suyo.';
      ui.setActions([auto, { id: 'next', label: 'Enmarcar →', kind: 'primary', disabled: !stab, onClick: () => toHoop() }]);
      ui.hint('Elegí el estabilizador para tu tela');
    } else if (phase === 'hoop') {
      tipBox.innerHTML = '<b>2 · Enmarcar</b><br>Lo que quede corrido o torcido en el bastidor, se borda corrido o torcido.';
      ui.setActions([auto, { id: 'mount', label: 'Montar y bordar →', kind: 'primary', disabled: !tensionSet, onClick: () => mount() }]);
      ui.hint(isMobile() ? 'Arrastrá el bastidor sobre la cruz de tiza · girá con los botones' : 'Arrastrá el bastidor sobre la cruz de tiza · <kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> afinan · <kbd>Q</kbd>/<kbd>E</kbd> giran · mantené <kbd>Espacio</kbd> para ajustar');
    } else if (phase === 'stitch' || phase === 'mount') {
      tipBox.innerHTML = '<b>3 · Bordando</b><br>El pantógrafo mueve el bastidor bajo la aguja y la máquina borda un color por vez, de arriba hacia abajo. Cuando termine cada uno, te va a pedir el hilo siguiente: estate atento.';
      ui.setActions(autoMode ? [] : [auto]);
      ui.hint(null);
    } else if (phase === 'change') {
      ui.setActions([]);
      ui.hint(isMobile() ? '¡Cambio de hilo! Tocá el carretel que sigue' : '¡Cambio de hilo! Tocá el carretel que sigue (o su número <kbd>1</kbd>–<kbd>5</kbd>)');
    } else if (phase === 'finish') {
      tipBox.innerHTML = '<b>4 · Terminar</b><br>Sacá la remera del bastidor y recortá el estabilizador sobrante por el revés.';
      ui.setActions([{ id: 'done', label: '✂️ Desenmarcar y recortar', kind: 'primary', onClick: () => finishUp() }]);
      ui.hint(null);
    } else ui.setActions([]);
  }

  // ---------------- acciones ----------------
  function toHoop() {
    if (phase !== 'stab' || !stab) return;
    ctx.addCost('Estabilizador', stab === 'soluble' ? 450 : 300);
    phase = 'hoop';
    hoop.visible = true;
    hoopLift = 0.25;
    audio.play('pop');
    setPhaseUI();
  }

  function rotateHoop(dir) {
    if (phase !== 'hoop') return;
    hv.rot += dir * 1;
    audio.play('tick');
  }

  function startTighten() {
    if (phase !== 'hoop' || tightening) return;
    tightening = true;
    if (tensionSet) tension = 15; // se afloja y se vuelve a ajustar
    tensionSet = false;
    ui.enableAction('mount', false);
  }
  function stopTighten() {
    if (!tightening) return;
    tightening = false;
    tensionSet = true;
    ui.enableAction('mount', true);
    const inZone = tension >= tensionZone[0] && tension <= tensionZone[1];
    if (!autoMode) audio.play(inZone ? 'select' : 'bad');
  }

  function mount() {
    if (phase !== 'hoop' || !tensionSet) return;
    hooped = { ...alignErr(), tension };
    phase = 'mount';
    template.visible = false;
    layer = 0;
    layerFrac = 0;
    layerSteps = 0;
    // la remera con el bastidor se corre hasta la aguja (el centro del bastidor queda bajo la aguja)
    slideTarget = -(hv.x - placement.x);
    slideZTarget = hv.y - placement.y;
    em.setThreadColor(threads[0]);
    audio.play('thud');
    setPhaseUI();
    ctx.flyTo(view(), 1.1);
  }
  function startStitching() {
    phase = 'stitch';
    cross.visible = false;
    startSewing();
    drawScreen();
    setPhaseUI();
  }

  function startSewing() {
    em.setRunning(1);
    if (!sewing) sewing = audio.loop('sewing');
    sewing.set(0.55);
  }
  function stopSewing() {
    em.setRunning(0);
    sewing?.set(0);
  }
  ctx.track(() => {
    sewing?.stop();
    sewing = null;
  });

  // posición final del bordado (con el error del bastidor)
  const finalPlacement = () => {
    const e = hooped || { dx: 0, dy: 0, deg: 0 };
    return { ...placement, x: placement.x + e.dx, y: placement.y + e.dy, rotation: (placement.rotation || 0) + e.deg };
  };

  // Corrimiento del pantógrafo para la fila actual (coords del mundo; la remera está acostada con
  // el cuello hacia la pared: x vista → +x, y vista → −z). Lo ya bordado (arriba) se va hacia
  // atrás, por debajo del brazo de la bordadora, donde hay lugar y se ve. El bastidor no puede
  // pasar de la columna del fondo (a ~20 cm de la aguja): en diseños muy altos el final no llega.
  let jig = 0;
  const pantoMinZ = hoopDef.h / 2 - 0.18;
  function pantoTarget() {
    if (layer >= order.length) return { x: panto.tx, z: panto.tz };
    const k = order[layer];
    const row = revealRow(L, k, phase === 'change' ? 0 : layerFrac);
    const ly = H / 2 - (row / L.h) * H;
    // vaivén a lo ancho de la fila que se está rellenando
    const lx = phase === 'stitch' ? Math.sin(jig) * Math.min(W * 0.3, 0.03) : 0;
    const r = ((finalPlacement().rotation || 0) * Math.PI) / 180;
    const ox = lx * Math.cos(r) - ly * Math.sin(r);
    const oy = lx * Math.sin(r) + ly * Math.cos(r);
    return { x: -ox, z: Math.max(pantoMinZ, oy) };
  }

  function showLayer() {
    drawScreen();
    const done = order.slice(0, layer);
    const partial = layer < order.length ? { k: order[layer], frac: layerFrac } : null;
    shirt.setPrint(side, maskedResult(L, layerMask(L, done, partial)), finalPlacement());
  }

  let pickOptions = [];
  let pickNames = [];
  function askChange() {
    phase = 'change';
    stopSewing();
    changeT = 0;
    wrongNow = 0;
    audio.play('beep');
    // carretel correcto + distractores: nada que se llame igual ni que se vea casi igual al pedido
    // (ni entre ellos), así siempre hay un solo carretel que corresponde
    const want = threads[layer];
    const wantName = threadNames[layer];
    const cand = [...threads.map((hex, i) => ({ hex, name: threadNames[i], i })).filter((o) => o.i !== layer), ...EXTRA_THREADS.map((hex) => ({ hex, name: colorName(hex) }))];
    const shuffled = cand.sort(() => Math.random() - 0.5);
    // los otros hilos del diseño primero (son los que de verdad confunden)
    shuffled.sort((a, b) => (a.i != null ? 0 : 1) - (b.i != null ? 0 : 1));
    const chosen = [{ hex: want, name: wantName }];
    for (const o of shuffled) {
      if (chosen.length >= 5) break;
      const base = (n) => n.replace(/ (oscuro|claro|medio)$/, '');
      if (chosen.some((c) => c.hex.toLowerCase() === o.hex.toLowerCase() || c.name === o.name || colorDist(c.hex, o.hex) < 62)) continue;
      if (base(o.name) === base(wantName) && colorDist(o.hex, want) < 110) continue;
      chosen.push(o);
    }
    const opts = chosen.sort(() => Math.random() - 0.5);
    pickOptions = opts.map((o) => o.hex);
    pickNames = opts.map((o) => o.name);
    pickRow.innerHTML = '';
    opts.forEach(({ hex, name }, i) => {
      pickRow.appendChild(
        h(
          'button',
          { class: 'est-spool-btn', title: `Hilo ${name}`, 'aria-label': `Hilo ${name}`, onClick: () => pick(i) },
          h('span', { class: 'est-spool-top' }),
          h('span', { class: 'est-spool-thread', style: { background: hex } }),
          h('span', { class: 'est-spool-n' }, String(i + 1)),
        ),
      );
    });
    setPhaseUI();
  }

  function pick(i) {
    if (phase !== 'change') return;
    const hex = pickOptions[i];
    if (!hex) return;
    if (hex.toLowerCase() !== threads[layer].toLowerCase()) {
      wrongNow++;
      audio.play('bad');
      pickRow.children[i]?.classList.add('wrong');
      if (!autoMode) ui.toast(`Ese es ${pickNames[i] || colorName(hex)}: la hoja pide hilo ${threadNames[layer]}.`, 'warn', 2000);
      return;
    }
    picks.push({ wrong: wrongNow, t: changeT });
    audio.play('select');
    em.setThreadColor(hex);
    phase = 'stitch';
    layerFrac = 0;
    layerSteps = 0;
    startSewing();
    setPhaseUI();
  }

  async function finishUp() {
    if (phase !== 'finish') return;
    phase = 'reveal';
    setPhaseUI();
    audio.play('snip');
    hoop.userData.leave = 0.001;
    slideTarget = shiftX;
    slideZTarget = 0;
    panto.tx = 0;
    panto.tz = 0;
    await kit.wait(900);
    if (!ctx.alive) return;
    audio.play('snip');
    await reveal();
  }

  function evaluate() {
    const notes = [];
    const def = { patchy: 0, lift: 0, scorch: 0, ghost: 0, under: 0 };
    let pen = 0;
    // estabilizador
    const ideal = fabric.knit ? 'recortable' : 'desgarrable';
    const sname = catalog.STABILIZERS.find((s) => s.id === stab)?.name || stab;
    if (stab === ideal) notes.push(`${OK}Estabilizador ${sname}: el justo para ${fabric.knit ? 'tejido de punto (queda debajo y sostiene las puntadas para siempre)' : 'tejido plano y firme'}.`);
    else if (stab === 'soluble') {
      pen += 0.06;
      def.patchy += 0.15;
      notes.push(`${MID}El hidrosoluble es para telas finas o calados: en ${fabric.short} sostiene poco y las puntadas se hunden. Mejor ${ideal}.`);
    } else if (fabric.knit) {
      pen += 0.13;
      def.lift += 0.35;
      def.ghost += 0.15;
      notes.push(`${NO}Desgarrable en tejido de punto: al arrancarlo la malla queda sin sostén, el bordado se frunce y se deforma. En punto va <b>recortable</b>.`);
    } else {
      pen += 0.04;
      notes.push(`${MID}Recortable en tela plana: funciona, pero deja el revés más duro. Para ${fabric.short} alcanza con <b>desgarrable</b>.`);
    }
    // alineación
    const e = hooped || { mm: 0, deg: 0 };
    pen += smoothstep(3, 20, e.mm) * 0.15 + smoothstep(1.5, 10, Math.abs(e.deg)) * 0.08;
    if (e.mm <= 4 && Math.abs(e.deg) <= 2) notes.push(`${OK}Bastidor centrado y derecho (${fmt(e.mm, 0)} mm, ${fmt(Math.abs(e.deg), 1)}°): el bordado quedó donde lo marcaste.`);
    else notes.push(`${e.mm > 12 || Math.abs(e.deg) > 5 ? NO : MID}El bastidor quedó ${e.mm > 4 ? `corrido ${fmt(e.mm, 0)} mm` : ''}${e.mm > 4 && Math.abs(e.deg) > 2 ? ' y ' : ''}${Math.abs(e.deg) > 2 ? `torcido ${fmt(Math.abs(e.deg), 1)}°` : ''}: el bordado salió así. Tip: usá la plantilla y la cruz de tiza.`);
    // tensión
    const t = hooped?.tension ?? 50;
    if (t >= tensionZone[0] && t <= tensionZone[1]) notes.push(`${OK}Tela bien tensada en el bastidor (${fabric.knit ? 'firme, sin estirar el punto' : 'como un tambor'}).`);
    else if (t < tensionZone[0]) {
      pen += 0.1;
      def.lift += 0.4;
      def.ghost += 0.18;
      notes.push(`${NO}Tela floja en el bastidor: se movió mientras bordaba, quedó fruncido y los colores no calzan entre sí.`);
    } else {
      pen += fabric.knit ? 0.1 : 0.05;
      def.ghost += fabric.knit ? 0.28 : 0.1;
      notes.push(`${fabric.knit ? NO : MID}Tela estirada en el bastidor: ${fabric.knit ? 'al soltarla el punto vuelve y el bordado se deforma y frunce' : 'quedó algo tirante'}.`);
    }
    // cambios de hilo
    if (picks.length) {
      const wrong = picks.reduce((a, p) => a + p.wrong, 0);
      const slow = picks.filter((p) => p.t > 6).length;
      pen += Math.min(0.12, wrong * 0.03) + slow * 0.01;
      if (!wrong && !slow) notes.push(`${OK}Cambios de hilo rápidos y en orden: la máquina casi no estuvo parada.`);
      else if (wrong) notes.push(`${MID}Elegiste ${wrong} carretel${wrong > 1 ? 'es' : ''} equivocado${wrong > 1 ? 's' : ''}: seguí la hoja de bordado, cada parada es tiempo de máquina.`);
      else notes.push(`${MID}Algunos cambios de hilo tardaron: la bordadora parada es plata perdida.`);
    }
    if (W > 0.2) notes.push(`${MID}Un bordado de ${fmt(cw * 100, 0)} cm es grande: muchas puntadas y una zona dura en la remera. Los bordados lucen mejor chicos.`);
    return { quality: clamp(1 - pen, 0.15, 1), defects: def, notes };
  }

  async function reveal() {
    if (finished) return;
    finished = true;
    stopSewing();
    const ev = evaluate();
    if (autoMode) ev.notes.unshift(`${MID}Bordado en automático por el taller: la próxima enmarcalo vos para sumar más puntos.`);
    const pl = finalPlacement();
    const result = await kit.process(ev.quality, ev.defects);
    if (!ctx.alive) return;
    shirt.setPrint(side, result, pl);
    hoop.visible = false;
    audio.play(ev.quality >= 0.7 ? 'good' : 'bad');
    const e = hooped || { mm: 0, deg: 0 };
    const settings = { stabilizer: stab, hoop: hoopDef.id, offsetMm: Math.round(e.mm), rotation: Math.round(e.deg * 10) / 10, tension: Math.round(hooped?.tension ?? 0), wrongThreads: picks.reduce((a, p) => a + p.wrong, 0) };
    const tags = [catalog.STABILIZERS.find((s) => s.id === stab)?.name.split(' ')[0] || stab, `bastidor ${hoopDef.id === 'jumbo' ? 'grande' : hoopDef.id.replace('x', '×')}`, `${threads.length} hilo${threads.length > 1 ? 's' : ''}`, `${totalStitches.toLocaleString('es-AR')} puntadas`];
    await kit.finish({ quality: ev.quality, defects: ev.defects, notes: ev.notes, result, settings, placement: pl, tags });
  }

  // ---------------- automático ----------------
  async function autoRun() {
    if (busy || finished) return;
    busy = true;
    autoMode = true;
    ui.setActions([]);
    ui.hint('El taller borda por vos…');
    if (phase === 'stab') {
      stab = 'soluble';
      stabGrid.setValue(stab);
      await kit.wait(300);
      toHoop();
    }
    if (phase === 'hoop') {
      hv.x = placement.x + 0.008;
      hv.y = placement.y - 0.008;
      hv.rot = (placement.rotation || 0) + 4;
      tension = tensionZone[0] - 6;
      tensionSet = true;
      await kit.wait(500);
      if (!ctx.alive) return;
      mount();
    }
    kit.timeScale = 3;
    let wrongOnce = false;
    while (ctx.alive && !finished) {
      await untilFrame(ctx, () => !ctx.alive || finished || phase === 'change' || phase === 'finish', 120);
      if (!ctx.alive) return;
      if (phase === 'change') {
        await untilFrame(ctx, () => false, 0.25);
        if (!wrongOnce) {
          wrongOnce = true;
          const wi = pickOptions.findIndex((x) => x.toLowerCase() !== threads[layer].toLowerCase());
          if (wi >= 0) pick(wi);
          await untilFrame(ctx, () => false, 0.2);
        }
        pick(pickOptions.findIndex((x) => x.toLowerCase() === threads[layer].toLowerCase()));
      } else if (phase === 'finish') {
        kit.timeScale = 1;
        await kit.wait(200);
        await finishUp();
        return;
      }
    }
  }

  // ---------------- entrada ----------------
  let drag = null;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ptr = () => {
    plane.constant = -(hoop.position.y);
    return engine.pointerOnPlane(plane);
  };
  const nearHoop = (p) => p && Math.abs(p.x - hoop.position.x) < hoopDef.w / 2 + 0.06 && Math.abs(p.z - hoop.position.z) < hoopDef.h / 2 + 0.07;
  ctx.onPointer('down', (e) => {
    if (finished || busy || phase !== 'hoop' || e.button > 0) return;
    const p = ptr();
    if (!nearHoop(p)) return;
    drag = { p0: p.clone(), x0: hv.x, y0: hv.y };
    engine.canvas.style.cursor = 'grabbing';
    audio.play('click');
  });
  ctx.onPointer('move', () => {
    if (phase !== 'hoop') return;
    const p = ptr();
    if (!drag) {
      engine.canvas.style.cursor = nearHoop(p) ? 'grab' : '';
      return;
    }
    if (!p) return;
    hv.x = clamp(drag.x0 + (p.x - drag.p0.x), placement.x - 0.15, placement.x + 0.15);
    hv.y = clamp(drag.y0 - (p.z - drag.p0.z), placement.y - 0.15, placement.y + 0.15);
  });
  ctx.onPointer('up', () => {
    if (!drag) return;
    drag = null;
    engine.canvas.style.cursor = '';
  });
  ctx.onPointer('wheel', (e) => {
    if (phase !== 'hoop' || !nearHoop(ptr())) return;
    rotateHoop(e.deltaY > 0 ? -1 : 1);
  });
  const HOOP_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE', 'Space', 'Enter'];
  const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'];
  ctx.listen(window, 'keydown', (e) => {
    const codes = phase === 'hoop' ? HOOP_KEYS : phase === 'change' ? DIGITS : phase === 'stab' ? ['Enter'] : phase === 'finish' ? ['Enter', 'Space'] : [];
    if (finished || busy || !gameKey(e, codes)) return;
    if (phase === 'hoop') {
      const step = e.shiftKey ? 0.005 : 0.001;
      if (e.code === 'ArrowLeft') hv.x -= step;
      else if (e.code === 'ArrowRight') hv.x += step;
      else if (e.code === 'ArrowUp') hv.y += step;
      else if (e.code === 'ArrowDown') hv.y -= step;
      else if (e.code === 'KeyQ') rotateHoop(1);
      else if (e.code === 'KeyE') rotateHoop(-1);
      else if (e.code === 'Space') {
        if (!e.repeat) startTighten();
      } else if (e.code === 'Enter') mount();
      else return;
      e.preventDefault();
    } else if (phase === 'change') {
      const n = parseInt(e.code.slice(-1), 10);
      if (n >= 1 && n <= pickOptions.length) pick(n - 1);
    } else if (phase === 'stab' && e.code === 'Enter') toHoop();
    else if (phase === 'finish' && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      finishUp();
    }
  });
  ctx.listen(window, 'keyup', (e) => {
    if (e.code === 'Space') stopTighten();
  });
  ctx.listen(window, 'blur', () => stopTighten());

  // ---------------- bucle ----------------
  ctx.onUpdate((dt0) => {
    const dt = dt0 * kit.timeScale;
    simT += dt;
    if (drop > 0) {
      drop = Math.max(0, drop - dt0 * 2.6);
      shirt.group.position.y = restPos.y + 0.16 * drop * drop;
      if (drop === 0) audio.play('thud');
    }
    // pantógrafo: la fila que se borda va bajo la aguja (con el tembleque de las puntadas)
    if (phase === 'stitch' || phase === 'change') {
      const t = pantoTarget();
      panto.tx = t.x;
      panto.tz = t.z;
    }
    const pk = 1 - Math.exp(-dt0 * (phase === 'change' ? 2.5 : 7));
    panto.x += (panto.tx - panto.x) * pk;
    panto.z += (panto.tz - panto.z) * pk;
    if (Math.abs(slide - slideTarget) > 1e-5 || Math.abs(slideZ - slideZTarget) > 1e-5) {
      const k = 1 - Math.exp(-dt0 * 3.2);
      slide += (slideTarget - slide) * k;
      slideZ += (slideZTarget - slideZ) * k;
      if (Math.abs(slide - slideTarget) < 0.0008) slide = slideTarget;
      if (Math.abs(slideZ - slideZTarget) < 0.0008) slideZ = slideZTarget;
      if (slide === slideTarget && slideZ === slideZTarget && phase === 'mount') startStitching();
    } else if (phase === 'mount') startStitching();
    shirt.group.position.x = restPos.x + (slide - shiftX) + panto.x;
    shirt.group.position.z = restPos.z + slideZ + panto.z;
    if (hoop.visible) {
      if (hoopLift > 0 && !hoop.userData.leave) hoopLift = Math.max(0, hoopLift - dt0 * 0.9 - hoopLift * dt0 * 4);
      if (hoop.userData.leave) {
        hoop.userData.leave += dt0 * 1.6;
        hoopLift = 0.3 * hoop.userData.leave * hoop.userData.leave;
        if (hoop.userData.leave >= 1) hoop.visible = false;
      }
      placeHoop();
    }
    if (phase === 'hoop' && tightening) {
      tension = Math.min(100, tension + dt * 30);
      if (Math.floor(tension / 6) !== Math.floor((tension - dt * 30) / 6)) audio.play('tick');
    }
    if (phase === 'change') changeT += dt0;
    if (phase === 'stitch') {
      jig += dt * 5.5;
      const share = layerShare[layer] ?? 0.3;
      const dur = 2.2 + 7 * share; // segundos reales por color
      layerFrac = Math.min(1, layerFrac + dt / dur);
      stitchesDone = (layerShare.slice(0, layer).reduce((a, b) => a + b, 0) + share * layerFrac) * totalStitches;
      const step = Math.floor(layerFrac * 7);
      if (step > layerSteps || layerFrac >= 1) {
        layerSteps = step;
        if (layerFrac >= 1) {
          layer++;
          layerFrac = 0;
          layerSteps = 0;
          showLayer();
          if (layer >= order.length) {
            stopSewing();
            phase = 'finish';
            stitchesDone = totalStitches;
            audio.play('good');
            setPhaseUI();
          } else askChange();
        } else showLayer();
      }
    }
    refreshHud();
  });

  // ---------------- ganchos de prueba ----------------
  Object.defineProperty(kit.test, 'phase', { get: () => phase, configurable: true, enumerable: true });
  Object.assign(kit.test, {
    info: () => ({ phase, stab, hoop: { ...hv }, err: alignErr(), tension: Math.round(tension), tensionSet, layer, layerFrac: +layerFrac.toFixed(2), threads, picks, hoopDef }),
    stab: (id) => {
      stab = id;
      stabGrid.setValue(id);
      toHoop();
    },
    setHoop: (x, y, rot) => Object.assign(hv, { x, y, rot }),
    tighten: (v) => {
      tension = v;
      tensionSet = true;
      ui.enableAction('mount', true);
    },
    mount,
    pickRight: () => pick(pickOptions.findIndex((x) => x.toLowerCase() === threads[layer].toLowerCase())),
    pick,
    finish: finishUp,
    hoopScreen: () => {
      const s = engine.worldToScreen(hoop.position.clone());
      const t = engine.worldToScreen(surfacePoint(shirt, side, placement.x, placement.y, 0).p);
      return { hx: Math.round(s.x), hy: Math.round(s.y), tx: Math.round(t.x), ty: Math.round(t.y) };
    },
    auto: autoRun,
    fast: (k) => (kit.timeScale = k),
  });

  setPhaseUI();
  refreshHud();
}
