// Mini-juego de la prensa térmica (vinilo, DTF, sublimación, glitter, foil).
// 1) Programar temperatura, tiempo y presión según la ficha del material (la prensa tarda en
//    calentar), pre-planchar (opcional) y apoyar el transfer (con o sin hoja protectora).
// 2) Bajar la prensa (arrastrando la manija, tocándola o con Espacio): cuenta regresiva
//    acelerada con alarma; abrir a tiempo.
// 3) Despegar el film arrastrando la esquina: en caliente apenas abre o en frío esperando que
//    se enfríe, según la ficha. Todo eso define la calidad y los defectos de la estampa final.

import * as THREE from 'three';
import { OK, NO, MID, PRESSURES, pressureName, fmt, layShirt, conformGeometry, garmentX, createPuffs, basePrint, printOptions, gameKey, garmentHit, untilFrame, throttle, clamp, smoothstep } from './common.js';

const ROOM_T = 25;

// Cómo es cada material (para la ficha y el aspecto del transfer)
const MATERIAL = {
  vinilo: { name: 'Vinilo textil PU', kind: 'film', tip: 'Cortado a plotter y depilado: va con el film transparente hacia arriba.' },
  glitter: { name: 'Vinilo glitter', kind: 'film', tip: 'Más grueso que el vinilo liso: pide presión pareja para que no se levanten los bordes.' },
  dtf: { name: 'Film DTF', kind: 'film', tip: 'Tintas pigmentadas con polvo adhesivo. El film se saca cuando ya está frío.' },
  sublimacion: { name: 'Papel de sublimación', kind: 'paper', tip: 'La tinta pasa a gas y tiñe el poliéster: el papel va con la cara impresa hacia la tela.' },
  foil: { name: 'Foil + adhesivo', kind: 'foil', tip: 'La lámina metálica se pega solo donde hay adhesivo impreso: despegar en frío.' },
};

const PEEL_NAME = { caliente: 'en caliente', frio: 'en frío', tibio: 'tibio' };
const HOT_T = 85; // desde acá, despegue "en caliente"
const COLD_T = 45; // hasta acá, despegue "en frío"
const COOL_TAU = 4.2; // s: constante de enfriamiento del transfer al abrir la prensa

export async function runPress(kit) {
  const { ctx, info, ui, h, audio, world, shirt, engine, isMobile } = kit;
  const { tech, fabric, side, placement } = info;
  const P = tech.press || { temp: 160, time: 15, pressure: 2, peel: 'caliente' };
  const M = MATERIAL[tech.id] || MATERIAL.vinilo;
  const hp = world.props.heatPress;
  const sp = world.props.screenPrint;
  const c = hp.platenCenter.clone();

  // ---------------- props: estado de reposo al salir ----------------
  ctx.track(() => {
    hp.setOpen(0);
    hp.setDisplay(ROOM_T, 0, { heating: false });
    sp?.setFrameDown(1);
  });
  // el shablón de serigrafía (vecino) se levanta para que no lo pise la manga
  sp?.setFrameDown(0);
  hp.setOpen(1);

  // ---------------- remera acostada sobre la plancha inferior ----------------
  ctx.placeShirt('exhibicion', { inflation: 0.05 });
  // el centro de la estampa sobre el centro de la plancha, sin que el cuello toque la columna
  const anchor = new THREE.Vector3(c.x, c.y, Math.max(c.z, c.z - 0.212 - placement.y));
  const lay = layShirt(shirt, info, { anchor, inflation: 0.05, lift: 0.0012 });
  const restPos = lay.position.clone();
  let drop = 1; // animación de "apoyar la remera"
  shirt.group.position.y = restPos.y + 0.18;

  // centro de la plancha en coords vistas del lado (para alisar arrugas)
  const platenView = { x: placement.x + (c.x - anchor.x), y: placement.y + (anchor.z - c.z) };
  const smoothPlatenArea = () => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) shirt.smoothWrinkles(side, garmentX(side, platenView.x + i * 0.12), platenView.y + j * 0.12, 0.13, 1);
  };

  let phase = 'setup'; // setup | prepress | placed | pressing | opened | peeling | reveal

  // ---------------- cámara ----------------
  // Con la prensa abierta (programar, apoyar el transfer, bajarla) la vista se abre un poco más
  // para que entren la manija y la remera; prensando y despegando, más cerca del transfer.
  const wideView = () => phase === 'setup' || phase === 'placed' || phase === 'prepress';
  const view = () => {
    if (isMobile()) {
      return wideView()
        ? { position: [c.x + 0.02, c.y + 2.02, c.z + 1.78], target: [c.x, c.y + 0.1, c.z - 0.04] }
        : { position: [c.x + 0.02, c.y + 2.05, c.z + 1.42], target: [c.x, c.y - 0.02, c.z + 0.02] };
    }
    return wideView()
      ? { position: [c.x - 0.03, c.y + 1.06, c.z + 1.2], target: [c.x, c.y + 0.16, c.z - 0.07] }
      : { position: [c.x - 0.03, c.y + 1.12, c.z + 0.98], target: [c.x, c.y + 0.02, c.z - 0.04] };
  };
  ctx.flyTo(view(), 1.4);
  let wasMobile = isMobile();
  ctx.listen(window, 'resize', () => {
    if (isMobile() === wasMobile) return;
    wasMobile = isMobile();
    if (!finished) ctx.flyTo(view(), 0.6);
  });

  // ---------------- estado ----------------
  const sel = {
    temp: P.temp >= 185 ? 160 : 185,
    time: P.time >= 30 ? 20 : 30,
    pressure: P.pressure === 2 ? 3 : 2,
    teflon: false,
  };
  let platenT = ROOM_T + 4;
  let openTarget = 1;
  let prepressed = false;
  let prepressHot = false;
  let pressElapsed = 0; // segundos "de prensa" (acelerados)
  let pressIntegral = 0;
  let pressReal = 0;
  let pressedSec = 0;
  let effTemp = 0;
  let closedPressure = sel.pressure;
  let closedEarly = false;
  let openedAt = 0; // tiempo real desde que abrió
  let transferT = ROOM_T;
  let transferT0 = ROOM_T;
  let peelClass = null;
  let peelStartT = 0;
  let front = 0;
  let finished = false;
  let busy = false;
  let autoMode = false;
  let lastBeep = -1;
  let alarmShown = false;
  let simT = 0;
  let teflonUsed = false;
  const speed = clamp(P.time / 5.2, 1.8, 9); // segundos de prensa por segundo real

  // ---------------- mallas: transfer, protector, vapor ----------------
  // estampa perfecta (lo que queda debajo del film) — la del paso Diseño si sirve
  let baseRes = info.d.preview && info.d.preview.technique === tech.id && info.d.preview.color ? info.d.preview : null;
  if (!baseRes) {
    ui.panel({ kicker: kit.kicker, title: `Prensa térmica · ${tech.name}`, subtitle: 'Preparando el transfer…', body: h('div', { class: 'est-loading' }, 'Imprimiendo el transfer…') });
    await kit.wait(60);
    if (!ctx.alive) return;
    baseRes = basePrint(info);
  }
  if (!ctx.alive) return;

  const W = placement.width;
  const H = W / (baseRes.aspect || 1);
  const margin = 0.016;
  const filmRect = { cx: placement.x, cy: placement.y, w: W + margin * 2, h: H + margin * 2, rot: placement.rotation || 0 };

  // textura del transfer
  const texW = 512;
  const texH = Math.max(64, Math.round((texW * filmRect.h) / filmRect.w));
  const tCanvas = document.createElement('canvas');
  tCanvas.width = texW;
  tCanvas.height = texH;
  const tTex = new THREE.CanvasTexture(tCanvas);
  tTex.colorSpace = THREE.SRGBColorSpace;
  tTex.anisotropy = 4;
  const inset = { x: (margin / filmRect.w) * texW, y: (margin / filmRect.h) * texH, w: (W / filmRect.w) * texW, h: (H / filmRect.h) * texH };

  function drawTransfer(pressed) {
    const g = tCanvas.getContext('2d');
    g.clearRect(0, 0, texW, texH);
    if (M.kind === 'paper') {
      g.fillStyle = pressed ? '#efe7d6' : '#f6f3ec';
      g.fillRect(0, 0, texW, texH);
      // el diseño impreso del otro lado, en espejo y apenas visible a través del papel
      g.save();
      g.globalAlpha = pressed ? 0.12 : 0.22;
      g.filter = 'blur(1.5px) saturate(0.6)';
      g.translate(inset.x + inset.w, inset.y);
      g.scale(-1, 1);
      g.drawImage(info.d.source, 0, 0, inset.w, inset.h);
      g.restore();
      g.strokeStyle = 'rgba(120,110,95,0.25)';
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, texW - 3, texH - 3);
    } else if (M.kind === 'foil') {
      // lámina: blanca (el color metálico lo da el material); con agujeros después de prensar
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, texW, texH);
      if (pressed) {
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(baseRes.color, inset.x, inset.y, inset.w, inset.h);
        g.globalCompositeOperation = 'source-over';
      }
    } else {
      // film transparente (PET) con un leve tinte, reflejos y borde
      g.fillStyle = `rgba(232,242,250,${info.lum < 0.3 ? 0.15 : 0.32})`;
      g.fillRect(0, 0, texW, texH);
      const gl = g.createLinearGradient(0, 0, texW, texH);
      gl.addColorStop(0, 'rgba(255,255,255,0)');
      gl.addColorStop(0.42, 'rgba(255,255,255,0)');
      gl.addColorStop(0.47, 'rgba(255,255,255,0.32)');
      gl.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      gl.addColorStop(0.56, 'rgba(255,255,255,0.22)');
      gl.addColorStop(0.6, 'rgba(255,255,255,0)');
      g.fillStyle = gl;
      g.fillRect(0, 0, texW, texH);
      g.strokeStyle = 'rgba(140,165,185,0.75)';
      g.lineWidth = 4;
      g.strokeRect(2, 2, texW - 4, texH - 4);
      if (!pressed) g.drawImage(baseRes.color, inset.x, inset.y, inset.w, inset.h);
    }
    tTex.needsUpdate = true;
  }

  let film = null;
  let teflonMesh = null;
  const filmMat =
    M.kind === 'paper'
      ? new THREE.MeshStandardMaterial({ map: tTex, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
      : M.kind === 'foil'
        ? new THREE.MeshStandardMaterial({ color: printOptions(info).tint || '#d4af37', metalness: 1, roughness: 0.22, alphaMap: tTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
        : new THREE.MeshPhysicalMaterial({ map: tTex, transparent: true, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  if (M.kind === 'foil') filmMat.alphaMap.colorSpace = THREE.NoColorSpace;

  function buildFilm() {
    const geo = conformGeometry(shirt, side, filmRect, { segs: 18, offset: 0.0022 });
    if (!film) {
      film = new THREE.Mesh(geo, filmMat);
      film.name = 'transfer';
      film.renderOrder = 5;
      film.castShadow = false;
      film.receiveShadow = true;
      ctx.add(film, shirt.group);
    } else {
      film.geometry.dispose();
      film.geometry = geo;
    }
    film.visible = true;
    prepPeel();
  }

  function buildTeflon() {
    const r = { cx: platenView.x, cy: platenView.y, w: 0.36, h: 0.36, rot: 0 };
    const geo = conformGeometry(shirt, side, r, { segs: 14, offset: 0.0038 });
    if (!teflonMesh) {
      teflonMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#b98a5a', roughness: 0.32, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      teflonMesh.name = 'teflon';
      teflonMesh.renderOrder = 6;
      ctx.add(teflonMesh, shirt.group);
    } else {
      teflonMesh.geometry.dispose();
      teflonMesh.geometry = geo;
    }
    teflonMesh.visible = true;
    teflonMesh.userData.lift = 0;
  }

  const puffs = createPuffs(70, { color: '#ffffff' });
  ctx.add(puffs.points);
  const puffP = new THREE.Vector3();
  const puffV = new THREE.Vector3();
  function steamBurst(n = 1, edgeY = c.y + 0.012) {
    for (let i = 0; i < n; i++) {
      const s = Math.random() * 4;
      const t = (Math.random() - 0.5) * 0.36;
      const k = Math.floor(s);
      if (k === 0) puffP.set(c.x + t, edgeY, c.z + 0.19);
      else if (k === 1) puffP.set(c.x + 0.19, edgeY, c.z + t);
      else if (k === 2) puffP.set(c.x - 0.19, edgeY, c.z + t);
      else puffP.set(c.x + t, edgeY, c.z - 0.19);
      puffV.set((puffP.x - c.x) * 0.7, 0.06 + Math.random() * 0.06, (puffP.z - c.z) * 0.7);
      puffs.emit(puffP, puffV, 0.9 + Math.random() * 0.8, 1, '#f4f4f4');
    }
  }

  // marcador "agarrá acá" sobre la esquina del film
  const grab = h('div', { class: 'est-grab' }, h('span', { class: 'est-grab-dot' }), h('span', { class: 'est-grab-label' }, M.kind === 'paper' ? 'levantá de acá' : 'tirá de acá'));
  document.getElementById('app')?.appendChild(grab);
  ctx.track(() => grab.remove());
  const grabP = new THREE.Vector3();
  function placeGrab() {
    const show = phase === 'opened' && !!film?.visible;
    grab.classList.toggle('show', show);
    if (!show) return;
    grabP.copy(peel.corner).addScaledVector(peel.dirW, 0.012);
    grabP.y += 0.006;
    const s2 = engine.worldToScreen(grabP);
    grab.style.transform = `translate(${s2.x.toFixed(1)}px, ${s2.y.toFixed(1)}px)`;
  }

  // ---------------- despegue (film que se enrolla) ----------------
  const peel = { L: 1, dir: new THREE.Vector3(), n: new THREE.Vector3(), s: null, corner: new THREE.Vector3(), dirW: new THREE.Vector3(), planeY: 0 };
  function prepPeel() {
    const geo = film.geometry;
    const segs = geo.userData.segs;
    const n = segs + 1;
    const a = ((filmRect.rot || 0) * Math.PI) / 180;
    // dirección (en coords vistas) desde la esquina de abajo a la derecha hacia la de arriba a la izquierda
    let dvx = -filmRect.w;
    let dvy = filmRect.h;
    const len = Math.hypot(dvx, dvy);
    dvx /= len;
    dvy /= len;
    const rx = dvx * Math.cos(a) - dvy * Math.sin(a);
    const ry = dvx * Math.sin(a) + dvy * Math.cos(a);
    const sx = side === 'espalda' ? -1 : 1;
    peel.dir.set(sx * rx, ry, 0).normalize();
    peel.n.set(0, 0, sx);
    peel.L = len;
    peel.s = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = i / segs;
        const v = j / segs;
        // local del rect (sin rotar) respecto de la esquina (1, 0)
        const lx = (u - 1) * filmRect.w;
        const ly = v * filmRect.h;
        peel.s[j * n + i] = (lx * -filmRect.w + ly * filmRect.h) / len;
      }
    }
    // esquina y dirección en el mundo (para el arrastre)
    const pa = geo.userData.base;
    const k0 = segs; // (i = segs, j = 0)
    peel.corner.set(pa[k0 * 3], pa[k0 * 3 + 1], pa[k0 * 3 + 2]).applyMatrix4(shirt.group.matrixWorld);
    peel.dirW.copy(peel.dir).transformDirection(shirt.group.matrixWorld);
    peel.dirW.y = 0;
    peel.dirW.normalize();
    peel.planeY = peel.corner.y;
  }
  const tmpA = new THREE.Vector3();
  function applyPeel(fr) {
    if (!film) return;
    const geo = film.geometry;
    const pos = geo.attributes.position;
    const base0 = geo.userData.base;
    const aMax = (118 * Math.PI) / 180;
    let any = false;
    for (let k = 0; k < pos.count; k++) {
      const d = fr - peel.s[k];
      const bx = base0[k * 3];
      const by = base0[k * 3 + 1];
      const bz = base0[k * 3 + 2];
      if (d <= 0) {
        pos.setXYZ(k, bx, by, bz);
        continue;
      }
      any = true;
      const al = aMax * smoothstep(0, 0.035, d) + d * 1.6;
      const ca = Math.cos(al);
      const sa = Math.sin(al);
      // bisagra en el frente del despegue
      tmpA.set(bx, by, bz).addScaledVector(peel.dir, d);
      tmpA.addScaledVector(peel.dir, -ca * d).addScaledVector(peel.n, sa * d);
      pos.setXYZ(k, tmpA.x, tmpA.y, tmpA.z);
    }
    pos.needsUpdate = true;
    if (any) geo.computeVertexNormals();
  }

  // ---------------- panel ----------------
  const stages = kit.stepsBar(['Programar', 'Prensar', 'Despegar']);
  const spec = (icon, label, value) => h('div', { class: 'est-spec' }, h('span', { class: 'est-spec-i' }, icon), h('span', { class: 'est-spec-l' }, label), h('b', { class: 'est-spec-v' }, value));
  const ficha = h(
    'div',
    { class: 'est-ficha' },
    h('div', { class: 'est-ficha-head' }, h('span', { class: 'est-ficha-kicker' }, 'Ficha del proveedor'), h('b', {}, M.name)),
    h(
      'div',
      { class: 'est-ficha-grid' },
      spec('🌡️', 'Temperatura', `${P.temp} °C`),
      spec('⏱️', 'Tiempo', `${P.time} s`),
      spec('⬇️', 'Presión', pressureName(P.pressure)),
      spec(P.peel === 'frio' ? '❄️' : '🔥', 'Despegue', PEEL_NAME[P.peel]),
    ),
    h('p', { class: 'est-ficha-tip' }, M.tip),
  );

  const tempSlider = ui.slider({ label: 'Temperatura', min: 110, max: 220, step: 5, value: sel.temp, unit: ' °C', onInput: (v) => (sel.temp = v) });
  const timeSlider = ui.slider({ label: 'Temporizador', min: 5, max: 70, step: 1, value: sel.time, unit: ' s', onInput: (v) => (sel.time = v) });
  const pressSeg = ui.segmented({ options: PRESSURES.map((p) => ({ id: String(p.id), label: p.label })), value: String(sel.pressure), onChange: (id) => (sel.pressure = +id) });
  const teflonToggle = ui.toggle({ label: M.kind === 'paper' ? 'Papel protector encima' : 'Hoja de teflón encima', value: sel.teflon, onChange: (v) => (sel.teflon = v) });
  const statusText = h('span', { class: 'est-status-text' });
  const statusMeter = h('div', { class: 'est-status-bar' }, h('i'));
  const status = h('div', { class: 'est-status' }, statusText, statusMeter);
  const controls = h(
    'div',
    { class: 'est-controls' },
    tempSlider,
    timeSlider,
    h('div', { class: 'est-field' }, h('span', { class: 'est-field-l' }, 'Presión'), pressSeg),
    teflonToggle,
  );
  const preBtn = h('button', { class: 'btn btn-secondary btn-sm est-pre-btn', onClick: () => prepress() }, '♨️ Pre-planchar 3 s');
  const preRow = h('div', { class: 'est-pre' }, preBtn, h('span', { class: 'est-pre-text' }, 'Opcional: saca humedad y arrugas antes de apoyar el transfer.'));
  const fabricNote = info.heatSensitive
    ? ui.note(`<b>${fabric.short}</b> es sensible al calor: con una hoja protectora encima no queda brillo ni marca de la prensa.`, 'warn')
    : ui.note(`<b>${fabric.short}</b>: si está húmeda o arrugada, un <b>pre-planchado</b> de 3 s la deja lista para que el transfer pegue parejo.`, 'info');
  const body = h('div', { class: 'est-panel est-press' }, stages, ficha, ui.section('Programá la prensa', controls, status), preRow, fabricNote);

  ui.panel({
    kicker: kit.kicker,
    title: `Prensa térmica · ${tech.name}`,
    subtitle: 'Copiá la ficha en la prensa, prensá el tiempo justo y despegá como dice el material.',
    body,
  });

  // ---------------- HUD ----------------
  const hudTemp = h('b', { class: 'est-hud-big' });
  const hudTempBar = h('div', { class: 'est-hud-bar' }, h('i'));
  const ringFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ringSvg.setAttribute('viewBox', '0 0 100 100');
  ringSvg.setAttribute('class', 'est-ring');
  const ringBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  for (const [el, cls] of [
    [ringBg, 'est-ring-bg'],
    [ringFg, 'est-ring-fg'],
  ]) {
    el.setAttribute('cx', '50');
    el.setAttribute('cy', '50');
    el.setAttribute('r', '42');
    el.setAttribute('class', cls);
    ringSvg.appendChild(el);
  }
  const RING = 2 * Math.PI * 42;
  ringFg.setAttribute('stroke-dasharray', `${RING}`);
  const ringNum = h('b', { class: 'est-ring-num' }, '0');
  const ringSub = h('span', { class: 'est-ring-sub' }, 's');
  const ringBox = h('div', { class: 'est-ring-box' }, ringSvg, h('div', { class: 'est-ring-label' }, ringNum, ringSub));
  const hudMsg = h('div', { class: 'est-hud-msg' });
  const peelTemp = h('b', { class: 'est-hud-big' });
  const peelState = h('span', { class: 'est-peel-state' });
  const peelBar = h('div', { class: 'est-cool' }, h('i'), h('span', { class: 'est-cool-hot' }, 'caliente'), h('span', { class: 'est-cool-cold' }, 'frío'));
  const secTemp = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, '🌡️ Plancha'), hudTemp), hudTempBar);
  const secRing = h('div', { class: 'est-hud-sec est-hud-center' }, ringBox);
  const secPeel = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, 'Transfer'), peelTemp), peelBar, peelState);
  const hudEl = h('div', { class: 'est-hud' }, h('div', { class: 'hud-title' }, 'Prensa térmica'), secTemp, secRing, secPeel, hudMsg);
  ui.hud(hudEl);

  let lastDisp = '';
  function refreshDisplay() {
    let secs = sel.time;
    if (phase === 'pressing' || phase === 'prepress') secs = Math.max(0, Math.ceil(phase === 'prepress' ? 3 - pressElapsed : sel.time - pressElapsed));
    const heating = platenT < sel.temp - 3;
    const key = `${Math.round(platenT)}|${secs}|${heating}`;
    if (key === lastDisp) return;
    lastDisp = key;
    hp.setDisplay(platenT, secs, { heating });
  }

  function refreshHud() {
    const ready = platenT >= sel.temp - 3;
    hudTemp.textContent = `${Math.round(platenT)} °C`;
    hudTempBar.firstChild.style.width = `${clamp((platenT - ROOM_T) / Math.max(1, sel.temp - ROOM_T)) * 100}%`;
    hudTempBar.classList.toggle('ready', ready);
    secTemp.style.display = phase === 'opened' || phase === 'peeling' || phase === 'reveal' ? 'none' : '';
    secRing.style.display = phase === 'pressing' || phase === 'prepress' ? '' : 'none';
    secPeel.style.display = phase === 'opened' || phase === 'peeling' ? '' : 'none';
    if (phase === 'pressing' || phase === 'prepress') {
      const total = phase === 'prepress' ? 3 : sel.time;
      const rem = total - pressElapsed;
      const over = rem < 0;
      ringNum.textContent = over ? `+${Math.floor(-rem)}` : String(Math.max(0, Math.ceil(rem)));
      ringFg.setAttribute('stroke-dashoffset', `${over ? 0 : RING * clamp(1 - rem / total)}`);
      ringBox.classList.toggle('over', over);
      ringBox.classList.toggle('alarm', over && Math.floor(simT * 4) % 2 === 0);
      ringSub.textContent = over ? 's de más' : phase === 'prepress' ? 'pre-planchado' : 's';
    }
    if (phase === 'opened' || phase === 'peeling') {
      peelTemp.textContent = `${Math.round(transferT)} °C`;
      const span = Math.max(1, transferT0 - ROOM_T);
      const k = clamp((transferT - ROOM_T) / span);
      peelBar.style.setProperty('--k', `${k * 100}%`);
      // zona objetivo del material en la barra (frío a la izquierda, caliente a la derecha)
      const zHot = clamp((HOT_T - ROOM_T) / span);
      const zCold = clamp((COLD_T - ROOM_T) / span);
      peelBar.style.setProperty('--z0', `${(P.peel === 'frio' ? 0 : zHot) * 100}%`);
      peelBar.style.setProperty('--z1', `${(P.peel === 'frio' ? zCold : 1) * 100}%`);
      const cls = classifyPeel(transferT);
      const state = phase === 'peeling' ? (peelClass === P.peel ? 'ok' : 'late') : cls === P.peel ? 'ok' : P.peel === 'frio' ? 'wait' : 'late';
      peelState.textContent = phase === 'peeling' ? (peelClass === P.peel ? `✋ Despegando ${PEEL_NAME[P.peel]}…` : `✋ Despegando ${PEEL_NAME[peelClass]}…`) : peelText(cls);
      peelState.className = `est-peel-state ${cls} ${state}`;
      peelBar.classList.toggle('in-zone', cls === P.peel);
      if (phase === 'opened' && cls !== lastPeelCls) {
        lastPeelCls = cls;
        if (cls === P.peel && P.peel === 'frio') {
          ui.hint('❄️ <b>Ya está frío: ¡despegá!</b> Arrastrá la esquina en diagonal · <kbd>Espacio</kbd>');
          audio.play('select');
        } else if (cls !== P.peel && P.peel === 'caliente' && cls === 'tibio') ui.hint('〰️ Se está enfriando: el despegue en caliente es apenas abrís. Despegá igual.');
      }
    }
    // estado en el panel
    if (phase === 'setup' || phase === 'placed') {
      statusText.innerHTML = ready
        ? `✅ Prensa a temperatura: <b>${Math.round(platenT)} °C</b>`
        : platenT > sel.temp + 3
          ? `🌬️ Enfriando a ${sel.temp} °C… <b>${Math.round(platenT)} °C</b>`
          : `🔥 Calentando a ${sel.temp} °C… <b>${Math.round(platenT)} °C</b>`;
      statusMeter.firstChild.style.width = `${clamp((platenT - ROOM_T) / Math.max(1, sel.temp - ROOM_T)) * 100}%`;
      statusMeter.classList.toggle('ready', ready);
    }
  }

  // Estado del transfer según lo que pide el material
  let lastPeelCls = null;
  function peelText(cls) {
    if (P.peel === 'frio') {
      if (cls === 'caliente') return `🔥 Todavía caliente: ${M.kind === 'foil' ? 'el foil' : 'el film DTF'} se despega en frío, esperá…`;
      if (cls === 'tibio') return '〰️ Tibio: falta un poco, esperá que se enfríe…';
      return '❄️ Frío: ¡ahora sí, despegá!';
    }
    if (cls === 'caliente') return `🔥 Caliente: ¡despegá ya, de un tirón!`;
    if (cls === 'tibio') return '〰️ Tibio: se pasó el momento del despegue en caliente';
    return '❄️ Frío: tarde, el film se pega a la tela';
  }

  function setControlsEnabled(on) {
    for (const el of controls.querySelectorAll('input, button')) el.disabled = !on;
    controls.classList.toggle('locked', !on);
  }

  function refreshPre() {
    preBtn.disabled = prepressed || phase !== 'setup';
    preBtn.textContent = prepressed ? (prepressHot ? '♨️ Pre-planchado ✓' : '♨️ Pre-planchado (tibio)') : '♨️ Pre-planchar 3 s';
    preRow.classList.toggle('done', prepressed);
  }

  function setPhaseUI() {
    refreshPre();
    const auto = { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoRun() };
    if (phase === 'setup') {
      stages.set(0);
      ui.setActions([auto, { id: 'place', label: 'Apoyar transfer →', kind: 'primary', onClick: () => placeTransfer() }]);
      ui.hint(isMobile() ? 'Programá la prensa con la ficha · después apoyá el transfer' : 'Programá la prensa copiando la ficha · tocá la remera o <kbd>Enter</kbd> para apoyar el transfer');
    } else if (phase === 'placed') {
      stages.set(1);
      ui.setActions([auto, { id: 'close', label: '⬇️ Bajar la prensa', kind: 'primary', onClick: () => closePress() }]);
      ui.hint(isMobile() ? 'Arrastrá la manija hacia abajo o tocá la prensa para prensar' : 'Arrastrá la manija hacia abajo, tocá la prensa o apretá <kbd>Espacio</kbd> para prensar');
    } else if (phase === 'pressing') {
      stages.set(1);
      ui.setActions([{ id: 'open', label: '⬆️ Abrir la prensa', kind: 'primary', onClick: () => openPress() }]);
      ui.hint(isMobile() ? 'Cuando suene la alarma, abrí: arrastrá la manija hacia arriba o tocá la prensa' : 'Cuando suene la alarma, abrí: arrastrá la manija hacia arriba, tocá la prensa o <kbd>Espacio</kbd>');
      hudMsg.innerHTML = P.peel === 'frio' ? `❄️ ${M.name}: al abrir, <b>esperá que se enfríe</b> para despegar.` : `🔥 ${M.name}: al abrir, <b>despegá enseguida</b>, en caliente.`;
    } else if (phase === 'opened' || phase === 'peeling') {
      stages.set(2);
      hudMsg.innerHTML = '';
      lastPeelCls = classifyPeel(transferT);
      ui.setActions([{ id: 'peel', label: M.kind === 'paper' ? 'Levantar el papel' : 'Despegar el film', kind: 'primary', onClick: () => autoPeel() }]);
      const how = isMobile() ? 'arrastrá la esquina del film hacia la otra punta' : 'agarrá la esquina de abajo a la derecha y arrastrala en diagonal · <kbd>Espacio</kbd> lo despega solo';
      ui.hint(P.peel === 'frio' ? `❄️ Despegue en frío: esperá a que se enfríe y después ${how}` : `🔥 ¡Despegá ya, en caliente! ${how.charAt(0).toUpperCase() + how.slice(1)}`);
    } else if (phase === 'prepress') {
      ui.setActions([]);
      ui.hint('Pre-planchando: la tela larga la humedad…');
    } else {
      ui.setActions([]);
    }
  }

  // ---------------- acciones ----------------
  async function prepress() {
    if (phase !== 'setup' || prepressed) return;
    if (platenT < 95) {
      ui.toast('La prensa todavía está fría: esperá a que caliente para pre-planchar.', 'warn');
      return;
    }
    phase = 'prepress';
    pressElapsed = 0;
    setPhaseUI();
    setControlsEnabled(false);
    openTarget = 0;
    audio.play('press');
    await kit.wait(260);
    audio.play('steam');
    steamBurst(14);
  }
  function endPrepress() {
    prepressed = true;
    prepressHot = platenT >= 110;
    smoothPlatenArea();
    openTarget = 1;
    audio.play('press');
    phase = 'setup';
    setControlsEnabled(true);
    setPhaseUI();
    ui.toast(prepressHot ? '♨️ Listo: la tela soltó la humedad y quedó lisa.' : 'Pre-planchado tibio: sirvió poco.', prepressHot ? 'good' : 'warn');
  }

  function placeTransfer() {
    if (phase !== 'setup') return;
    buildFilm();
    drawTransfer(false);
    film.position.set(0, 0, 0);
    film.userData.drop = 1;
    film.userData.fly = 0;
    if (sel.teflon) buildTeflon();
    else if (teflonMesh) teflonMesh.visible = false;
    audio.play('pop');
    phase = 'placed';
    setPhaseUI();
  }

  function closePress() {
    if (phase !== 'placed') return;
    phase = 'pressing';
    openTarget = 0;
    pressElapsed = 0;
    pressIntegral = 0;
    pressReal = 0;
    lastBeep = -1;
    alarmShown = false;
    closedPressure = sel.pressure;
    closedEarly = platenT < sel.temp - 8;
    setControlsEnabled(false);
    ctx.flyTo(view(), 0.9);
    if (sel.teflon && !teflonMesh?.visible) buildTeflon();
    if (!sel.teflon && teflonMesh) teflonMesh.visible = false;
    teflonUsed = !!sel.teflon;
    audio.play('press');
    ctx.timeout(() => {
      audio.play('hiss');
      steamBurst(10);
    }, 220);
    // la remera fría le roba un poco de calor a la plancha
    platenT -= 10;
    setPhaseUI();
    if (closedEarly && !autoMode) ui.toast(`Cerraste a ${Math.round(platenT + 10)} °C: la prensa todavía no había llegado a ${sel.temp} °C.`, 'warn', 3200);
  }

  async function openPress() {
    if (phase !== 'pressing') return;
    pressedSec = pressElapsed;
    effTemp = pressIntegral / Math.max(1e-6, pressReal);
    phase = 'opened';
    openTarget = 1;
    openedAt = 0;
    transferT0 = transferT = Math.min(effTemp, platenT) - 4;
    audio.play('press');
    smoothPlatenArea();
    // el transfer ya está en la tela: debajo del film se ve la estampa
    await kit.wait(30);
    if (!ctx.alive) return;
    buildFilm();
    drawTransfer(true);
    shirt.setPrint(side, baseRes, placement);
    front = 0.02; // la esquina queda apenas levantada para agarrarla
    applyPeel(front);
    // la hoja protectora se saca sola
    if (teflonMesh?.visible) teflonMesh.userData.lift = 0.001;
    setPhaseUI();
    const ratio = pressedSec / P.time;
    if (!autoMode) {
      if (ratio < 0.85) ui.toast(`Abriste a los ${fmt(pressedSec)} s: poco tiempo.`, 'warn');
      else if (ratio > 1.2) ui.toast(`Abriste a los ${fmt(pressedSec)} s: se pasó de tiempo.`, 'warn');
      else ui.toast(`¡Justo! ${fmt(pressedSec)} s de prensa.`, 'good');
    }
  }

  function classifyPeel(T) {
    return T >= HOT_T ? 'caliente' : T <= COLD_T ? 'frio' : 'tibio';
  }
  function startPeel() {
    if (phase !== 'opened') return;
    phase = 'peeling';
    peelClass = classifyPeel(transferT);
    peelStartT = transferT;
    audio.play('snip');
  }

  let autoPeeling = false;
  async function autoPeel() {
    if (phase === 'opened') startPeel();
    if (phase !== 'peeling' || autoPeeling) return;
    autoPeeling = true;
  }

  async function completePeel() {
    if (phase !== 'peeling') return;
    phase = 'reveal';
    setPhaseUI();
    ui.hint(null);
    audio.play('pop');
    // el film vuela
    film.userData.fly = 0.001;
    await kit.wait(450);
    if (!ctx.alive) return;
    await reveal();
  }

  // ---------------- resultado ----------------
  function evaluate() {
    const eT = effTemp - P.temp;
    const et = (pressedSec - P.time) / P.time;
    const ep = closedPressure - P.pressure;
    const pen = {};
    const def = { patchy: 0, lift: 0, scorch: 0, ghost: 0, under: 0 };
    const notes = [];
    const subl = tech.id === 'sublimacion';
    // temperatura
    pen.temp = smoothstep(4, 30, Math.abs(eT)) * 0.32;
    if (Math.abs(eT) <= 6) notes.push(`${OK}Temperatura justa (${Math.round(effTemp)} °C de ${P.temp} °C): ${subl ? 'la tinta pasó a gas y tiñó la fibra' : 'el adhesivo se fundió y agarró la tela'}.`);
    else if (eT < 0) {
      notes.push(`${eT < -15 ? NO : MID}Te quedaste corto de temperatura (${Math.round(effTemp)} °C de ${P.temp} °C): ${subl ? 'los colores salen pálidos' : 'el adhesivo no termina de fundirse y los bordes se levantan'}.${closedEarly ? ' Cerraste antes de que la prensa llegara a temperatura.' : ''}`);
      if (subl) def.under += smoothstep(5, 40, -eT) * 0.8;
      else {
        def.lift += smoothstep(5, 40, -eT) * 0.75;
        def.patchy += smoothstep(10, 50, -eT) * 0.45;
      }
    } else {
      notes.push(`${eT > 15 ? NO : MID}Te pasaste de temperatura (${Math.round(effTemp)} °C de ${P.temp} °C): ${subl ? 'la imagen se corre y la tela amarillea' : 'el material se achicharra y la tela se tuesta alrededor'}.`);
      def.scorch += smoothstep(6, 45, eT) * 0.8;
      if (subl) def.ghost += smoothstep(10, 40, eT) * 0.3;
    }
    // tiempo
    pen.time = smoothstep(0.1, 0.65, Math.abs(et)) * 0.26;
    if (Math.abs(et) <= 0.12) notes.push(`${OK}Tiempo de prensa preciso: ${fmt(pressedSec)} s (la ficha pide ${P.time} s).`);
    else if (et < 0) {
      notes.push(`${et < -0.3 ? NO : MID}Abriste temprano (${fmt(pressedSec)} s de ${P.time} s): ${subl ? 'no llegó a teñir del todo' : 'no le diste tiempo al adhesivo para penetrar en la trama'}.`);
      if (subl) def.under += smoothstep(0.1, 0.7, -et) * 0.7;
      else def.lift += smoothstep(0.1, 0.7, -et) * 0.6;
    } else {
      notes.push(`${et > 0.4 ? NO : MID}Te pasaste de tiempo (${fmt(pressedSec)} s de ${P.time} s): más calor del necesario${subl ? ', la imagen pierde nitidez' : ', el material se endurece y la tela se marca'}.`);
      def.scorch += smoothstep(0.25, 1.6, et) * 0.55;
      if (subl) def.ghost += smoothstep(0.3, 1.2, et) * 0.25;
    }
    // presión
    pen.pressure = Math.abs(ep) * 0.09;
    if (ep === 0) notes.push(`${OK}Presión ${pressureName(closedPressure)}, como pide el material.`);
    else if (ep < 0) {
      notes.push(`${MID}Presión ${pressureName(closedPressure)}: con poca presión el transfer no entra en la trama y quedan zonas sin pegar (pedía ${pressureName(P.pressure)}).`);
      def.patchy += 0.18 * -ep;
      if (!subl) def.lift += 0.1 * -ep;
    } else {
      notes.push(`${MID}Presión ${pressureName(closedPressure)}: de más aplasta la tela y deja la marca de la plancha (pedía ${pressureName(P.pressure)}).`);
      def.scorch += 0.08 * ep;
    }
    // despegue
    const want = P.peel;
    if (peelClass === want) {
      pen.peel = 0;
      notes.push(`${OK}Despegue ${PEEL_NAME[want]} (${Math.round(peelStartT)} °C), como corresponde ${M.kind === 'paper' ? 'al papel de sublimación' : 'a este material'}.`);
    } else if (peelClass === 'tibio') {
      pen.peel = 0.07;
      notes.push(`${MID}Despegaste tibio (${Math.round(peelStartT)} °C): ${want === 'caliente' ? 'había que hacerlo apenas abriste, de un tirón' : 'había que esperar a que se enfríe del todo'}.`);
      if (want === 'frio') def.lift += 0.2;
      else if (subl) def.ghost += 0.25;
      else def.lift += 0.12;
    } else {
      pen.peel = 0.16;
      if (want === 'frio') {
        notes.push(`${NO}${M.name} es de <b>despegue en frío</b>: arrancado en caliente, ${tech.id === 'foil' ? 'el foil se rompe y queda a medias' : 'parte de la tinta se queda en el film'}.`);
        def.lift += 0.45;
        def.patchy += 0.35;
      } else if (subl) {
        notes.push(`${NO}El papel de sublimación se levanta <b>en caliente</b>: al enfriarse se corre y deja una imagen doble (fantasma).`);
        def.ghost += 0.6;
      } else {
        notes.push(`${NO}${M.name} es de <b>despegue en caliente</b>: en frío el film se pega y tironea los bordes.`);
        def.lift += 0.3;
        def.ghost += 0.1;
      }
    }
    // pre-planchado y protección
    pen.prepress = prepressed && prepressHot ? 0 : 0.04;
    if (prepressed && prepressHot) notes.push(`${OK}Pre-planchado: sacaste la humedad y las arrugas antes de apoyar el transfer.`);
    else {
      notes.push(`${MID}Sin pre-planchado: 3 s de prensa antes del transfer sacan la humedad y las arrugas (tip de taller).`);
      if (!fabric.id.includes('poliester')) def.patchy += 0.06;
    }
    if (teflonUsed) {
      pen.teflon = 0;
      notes.push(`${OK}${M.kind === 'paper' ? 'Papel protector' : 'Hoja de teflón'} encima: la plancha no tocó directo el material ni la tela.`);
    } else {
      pen.teflon = info.heatSensitive ? 0.08 : 0.03;
      notes.push(`${info.heatSensitive ? NO : MID}Sin ${M.kind === 'paper' ? 'papel protector' : 'hoja de teflón'}: ${info.heatSensitive ? `en ${fabric.short} la plancha deja brillo y marca` : 'la plancha se ensucia y puede marcar la tela'}.`);
      if (info.heatSensitive) def.scorch += 0.14;
    }
    // compatibilidad (no es culpa de la prensa, pero se ve en el resultado)
    if (tech.needsPolyester && fabric.sublimation < 0.9) notes.push(`${MID}Ojo: en ${fabric.short} la sublimación sale ${fabric.sublimation < 0.4 ? 'casi invisible' : 'desteñida (estilo vintage)'}: solo tiñe la parte de poliéster.`);
    const sum = Object.values(pen).reduce((a, b) => a + b, 0);
    const quality = clamp(1 - sum, 0.15, 1);
    return { quality, defects: def, notes };
  }

  async function reveal() {
    if (finished) return;
    finished = true;
    const ev = evaluate();
    if (autoMode) ev.notes.unshift(`${MID}Prensado en automático por el taller: la próxima programala vos y despegá en el momento justo para sumar más puntos.`);
    const result = await kit.process(ev.quality, ev.defects);
    if (!ctx.alive) return;
    shirt.setPrint(side, result, placement);
    if (film) film.visible = false;
    if (teflonMesh) teflonMesh.visible = false;
    audio.play(ev.quality >= 0.7 ? 'good' : 'bad');
    stages.set(3);
    const settings = { temp: Math.round(effTemp), time: Math.round(pressedSec * 10) / 10, pressure: closedPressure, peel: peelClass, prepress: prepressed, teflon: teflonUsed };
    const tags = [`${Math.round(effTemp)} °C`, `${fmt(pressedSec)} s`, `presión ${pressureName(closedPressure)}`, `despegue ${PEEL_NAME[peelClass] || '—'}`];
    await kit.finish({ quality: ev.quality, defects: ev.defects, notes: ev.notes, result, settings, tags });
  }

  // ---------------- automático ----------------
  async function autoRun() {
    if (busy || finished) return;
    busy = true;
    autoMode = true;
    ui.setActions([]);
    ui.hint('El taller prensa por vos…');
    sel.temp = Math.round((P.temp - 12) / 5) * 5;
    sel.time = Math.round(P.time * 1.4);
    sel.pressure = P.pressure;
    tempSlider.setValue(sel.temp);
    timeSlider.setValue(sel.time);
    pressSeg.setValue(String(sel.pressure));
    setControlsEnabled(false);
    platenT = sel.temp;
    if (phase === 'prepress') endPrepress();
    setControlsEnabled(false);
    // (las esperas son por frames de simulación: el resultado no depende de los fps)
    if (phase === 'setup') {
      placeTransfer();
      await untilFrame(ctx, () => false, 0.45);
    }
    if (!ctx.alive) return;
    if (phase === 'placed') closePress();
    // el contador corre más rápido en automático
    kit.timeScale = 5;
    await untilFrame(ctx, () => phase !== 'pressing' || pressElapsed >= sel.time, 30);
    kit.timeScale = 1;
    if (!ctx.alive) return;
    pressElapsed = Math.min(pressElapsed, sel.time);
    if (phase === 'pressing') await openPress();
    if (!ctx.alive) return;
    // esperar el despegue correcto
    if (P.peel === 'frio') {
      kit.timeScale = 6;
      await untilFrame(ctx, () => phase !== 'opened' || transferT <= COLD_T - 1, 30);
      kit.timeScale = 1;
    } else await untilFrame(ctx, () => phase !== 'opened' || openedAt >= 0.4, 5);
    if (!ctx.alive) return;
    if (phase === 'opened') startPeel();
    autoPeeling = true;
  }

  // ---------------- entrada: puntero y teclado ----------------
  let drag = null;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitShirt = () => !!garmentHit(engine, shirt);
  const hitPress = () => hitShirt() || engine.raycast([hp.group]).length > 0;
  const hoverCursor = throttle(() => {
    let cur = '';
    if (phase === 'setup' && hitShirt()) cur = 'pointer';
    else if ((phase === 'placed' || phase === 'pressing') && hitPress()) cur = 'grab';
    else if (phase === 'opened' || phase === 'peeling') cur = 'grab';
    engine.canvas.style.cursor = cur;
  }, 90);
  ctx.onPointer('down', (e) => {
    if (finished || busy || e.button > 0) return;
    if (phase === 'setup') {
      if (hitShirt()) placeTransfer();
      return;
    }
    if (phase === 'placed' || phase === 'pressing') {
      if (!hitPress()) return;
      drag = { kind: 'handle', y0: e.clientY, open0: openTarget, moved: 0 };
      engine.canvas.style.cursor = 'grabbing';
      return;
    }
    if (phase === 'opened' || phase === 'peeling') {
      plane.constant = -peel.planeY;
      const p = engine.pointerOnPlane(plane);
      if (!p) return;
      // tiene que agarrar cerca del film
      const along = p.clone().sub(peel.corner).dot(peel.dirW);
      const side2 = p.clone().sub(peel.corner).addScaledVector(peel.dirW, -along).length();
      if (along < -0.06 || along > peel.L + 0.04 || side2 > 0.28) return;
      if (phase === 'opened') startPeel();
      drag = { kind: 'peel', s0: along, f0: front };
      engine.canvas.style.cursor = 'grabbing';
    }
  });
  ctx.onPointer('move', (e) => {
    if (!drag) {
      // cursor según lo que hay debajo
      if (!finished) hoverCursor();
      return;
    }
    if (drag.kind === 'handle') {
      const dy = e.clientY - drag.y0;
      drag.moved = Math.max(drag.moved, Math.abs(dy));
      openTarget = clamp(drag.open0 - dy / 170);
    } else if (drag.kind === 'peel') {
      plane.constant = -peel.planeY;
      const p = engine.pointerOnPlane(plane);
      if (!p) return;
      const along = p.clone().sub(peel.corner).dot(peel.dirW);
      front = clamp(drag.f0 + (along - drag.s0), 0, peel.L + 0.05);
    }
  });
  ctx.onPointer('up', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    engine.canvas.style.cursor = '';
    if (d.kind === 'handle') {
      if (d.moved < 6) {
        // clic: alterna
        if (phase === 'placed') closePress();
        else if (phase === 'pressing') openPress();
        return;
      }
      if (phase === 'placed') {
        if (openTarget < 0.45) closePress();
        else openTarget = 1;
      } else if (phase === 'pressing') {
        if (openTarget > 0.3) openPress();
        else openTarget = 0;
      }
    }
  });
  ctx.listen(window, 'keydown', (e) => {
    const codes = phase === 'setup' ? ['Enter'] : phase === 'placed' || phase === 'pressing' || phase === 'opened' || phase === 'peeling' ? ['Space', 'Enter'] : [];
    if (finished || busy || e.repeat || !gameKey(e, codes)) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (phase === 'setup' && e.code === 'Enter') placeTransfer();
      else if (phase === 'placed') closePress();
      else if (phase === 'pressing') openPress();
      else if (phase === 'opened' || phase === 'peeling') autoPeel();
    }
  });

  // ---------------- bucle ----------------
  ctx.onUpdate((dt0) => {
    const dt = dt0 * kit.timeScale;
    simT += dt;
    // remera que baja a la plancha
    if (drop > 0) {
      drop = Math.max(0, drop - dt0 * 2.6);
      const e = drop * drop;
      shirt.group.position.y = restPos.y + 0.18 * e;
      if (drop === 0) audio.play('thud');
    }
    hp.setOpen(openTarget);
    // calefacción (acelerada)
    const target = sel.temp;
    if (platenT < target) platenT = Math.min(target, platenT + dt * (phase === 'pressing' ? 9 : 24));
    else platenT = Math.max(target, platenT - dt * 9);
    if (phase === 'prepress') {
      pressElapsed += dt * 2.2;
      if (Math.random() < dt * 8) steamBurst(1);
      if (pressElapsed >= 3) endPrepress();
    }
    if (phase === 'pressing') {
      pressElapsed += dt * speed;
      pressReal += dt;
      pressIntegral += platenT * dt;
      if (Math.random() < dt * 5) steamBurst(1);
      const rem = sel.time - pressElapsed;
      const sec = Math.ceil(rem);
      if (sec !== lastBeep) {
        lastBeep = sec;
        if (rem > 0 && rem <= 3) audio.play('tick');
        if (rem <= 0) {
          audio.play('beep');
          if (!alarmShown) {
            alarmShown = true;
            if (!autoMode) ui.hint('⏰ <b>¡Ya! Abrí la prensa</b>');
          }
        }
      }
      // seguro: a 3 veces el tiempo se abre sola
      if (pressElapsed > Math.max(sel.time, P.time) * 3) openPress();
    }
    if (phase === 'opened' || phase === 'peeling') {
      openedAt += dt;
      transferT = ROOM_T + (transferT0 - ROOM_T) * Math.exp(-openedAt / COOL_TAU);
    }
    // hoja protectora que se va
    if (teflonMesh?.visible && teflonMesh.userData.lift > 0) {
      teflonMesh.userData.lift += dt0 * 2.2;
      const k = teflonMesh.userData.lift;
      teflonMesh.position.set(0.25 * k * k, 0, 0.12 * k);
      teflonMesh.material.opacity = 0.5 * (1 - clamp(k));
      if (k >= 1) teflonMesh.visible = false;
    }
    // despegue
    if (phase === 'peeling') {
      if (autoPeeling && !drag) front = Math.min(peel.L + 0.06, front + dt0 * (peel.L / 0.75));
      applyPeel(front);
      if (front >= peel.L + 0.02) completePeel();
    }
    if (film?.userData.drop > 0) {
      film.userData.drop = Math.max(0, film.userData.drop - dt0 * 3.2);
      const k = film.userData.drop * film.userData.drop;
      film.position.copy(peel.n).multiplyScalar(0.07 * k);
    }
    if (film?.userData.fly > 0) {
      film.userData.fly += dt0 * 2.4;
      const k = film.userData.fly;
      film.position.set(peel.n.x * 0.2 * k, peel.n.y * 0.2 * k + 0.05 * k, peel.n.z * 0.25 * k);
      film.position.addScaledVector(peel.dir, -0.12 * k);
      film.material.opacity = Math.max(0, 1 - k);
      film.material.transparent = true;
      if (k >= 1) film.visible = false;
    }
    puffs.update(dt0);
    placeGrab();
    refreshDisplay();
    refreshHud();
  });

  // ---------------- ganchos de prueba ----------------
  Object.defineProperty(kit.test, 'phase', { get: () => phase, configurable: true, enumerable: true });
  Object.assign(kit.test, {
    info: () => ({ phase, platenT: Math.round(platenT), sel: { ...sel }, pressElapsed: Math.round(pressElapsed * 10) / 10, transferT: Math.round(transferT), front: Math.round(front * 1000) / 1000, L: Math.round(peel.L * 1000) / 1000, prepressed, peelClass, ideal: P }),
    set(v) {
      Object.assign(sel, v);
      tempSlider.setValue(sel.temp);
      timeSlider.setValue(sel.time);
      pressSeg.setValue(String(sel.pressure));
      teflonToggle.input.checked = !!sel.teflon;
    },
    heat: () => (platenT = sel.temp),
    prepress,
    place: placeTransfer,
    close: closePress,
    open: openPress,
    peel: autoPeel,
    fast: (k) => (kit.timeScale = k),
    auto: autoRun,
    peelCorner: () => {
      const s = engine.worldToScreen(peel.corner.clone().addScaledVector(peel.dirW, 0.015));
      const e2 = engine.worldToScreen(peel.corner.clone().addScaledVector(peel.dirW, peel.L + 0.06));
      return { x0: Math.round(s.x), y0: Math.round(s.y), x1: Math.round(e2.x), y1: Math.round(e2.y) };
    },
    handle: () => {
      const s = engine.worldToScreen(new THREE.Vector3(c.x, c.y + 0.25, c.z + 0.05));
      return { x: Math.round(s.x), y: Math.round(s.y) };
    },
  });

  refreshHud();
  setPhaseUI();
}
