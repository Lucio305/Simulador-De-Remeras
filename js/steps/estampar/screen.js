// Mini-juego de serigrafía (plastisol) y tinta puff, en el pulpo de un brazo.
// Una pasada por tinta: se baja el shablón de ese color, se carga la tinta y se tira la racleta
// hacia uno con velocidad pareja y cubriendo todo el diseño (se mide el depósito de tinta por
// zona: fina → manchas, cargada → se corre). Entre tintas, flash: mantener el secador hasta que
// la tinta gelifique (zona verde). Al final, curado con la temperatura y el tiempo de la tinta
// (el puff se infla mientras cura).

import * as THREE from 'three';
import { OK, NO, MID, layShirt, buildLayers, layerMask, maskedResult, withParams, distinctNames, darken, basePrint, createPuffs, gauge, gameKey, untilFrame, clamp, smoothstep } from './common.js';

const DEG = Math.PI / 180;
const UP_ANGLE = 72 * DEG; // igual que el prop
const PIVOT_Y = 0.125; // bisagra del marco (relativa a la mesa)
const PIVOT_Z = -0.26;
const MESH_DY = -0.028; // malla respecto de la bisagra con el marco bajo
const DOWN = 0.985; // el marco no apoya del todo: "fuera de contacto"
const GX = 24;
const GZ = 24;
const V_IDEAL = 0.26; // m/s
const ROOM = 25;
// racleta con teclado: ↓ acelera (empuja), soltarla la deja seguir con su inercia, ↑ frena
const KEY_ACCEL = 1.0; // m/s²
const KEY_BRAKE = 1.3; // m/s²
const KEY_DRAG = 0.35; // 1/s (la tinta frena de a poco la racleta)
const KEY_VMAX = 1.2;

const INK_INFO = {
  serigrafia: { name: 'Plastisol', tip: 'No se seca al aire: hay que curarlo con calor. Si queda crudo, se cuartea en el primer lavado.' },
  puff: { name: 'Tinta puff', tip: 'Lleva un agente espumante: se infla con el calor del curado. Muy caliente se quema; poco, queda chata.' },
};

export async function runScreen(kit) {
  const { ctx, info, ui, h, audio, world, shirt, engine, isMobile } = kit;
  const { tech, fabric, side, placement } = info;
  const sp = world.props.screenPrint;
  const fd = world.props.flashDryer;
  const sq = sp.squeegee;
  const cure = tech.cure || { temp: 160, time: 60 };
  const I = INK_INFO[tech.id] || INK_INFO.serigrafia;
  const puffMode = tech.id === 'puff';

  // ---------------- props ----------------
  kit.keepPose(sq);
  const sqRest = { p: sq.position.clone(), q: sq.quaternion.clone() };
  ctx.track(() => {
    sp.setFrameDown(1);
    sp.setInkColor('#c42b2b');
    sp.setStencil(null);
    fd.setOn(false);
    fd.setSwing(0);
  });
  sp.setFrameDown(0);
  sp.setInkColor(null);

  const G = sp.group;
  G.updateMatrixWorld(true);
  const tableY = G.position.y;
  const pivotW = new THREE.Vector3(G.position.x, tableY + PIVOT_Y, G.position.z + PIVOT_Z);
  const [innerW, innerD] = sp.frameSize;
  const box = { w: innerW * 0.6, h: innerD * 0.5 };
  const frameCZ = sp.frameCenter.z;
  const boxC = new THREE.Vector3(sp.frameCenter.x, sp.platenTopY, frameCZ - innerD / 2 + innerD * 0.47);

  // ---------------- estampa y separaciones ----------------
  ui.panel({ kicker: kit.kicker, title: `Serigrafía · ${tech.name}`, subtitle: 'Preparando los shablones…', body: h('div', { class: 'est-loading' }, 'Separando colores y revelando los shablones…') });
  await kit.wait(60);
  if (!ctx.alive) return;
  const baseRes = info.d.preview && info.d.preview.technique === tech.id && info.d.preview.color ? info.d.preview : basePrint(info);
  const L = buildLayers(baseRes);
  const inks = L.order.length ? L.order : [0];
  const inkHex = inks.map((k) => L.palette[k] || '#1e1e21');
  // nombres sin repetir ("rojo oscuro" / "rojo claro" si hay dos parecidos)
  const inkNames = distinctNames(inkHex);
  const inkName = (i) => inkNames[clamp(i, 0, inkNames.length - 1)];
  if (!ctx.alive) return;

  // tamaño del diseño en el shablón (si es más grande que la ventana, se achica)
  const W = placement.width;
  const H = W / (baseRes.aspect || 1);
  const fit = Math.min(1, box.w / W, box.h / H);
  const BOX_PX = 512;
  const boxPxH = Math.round((BOX_PX * box.h) / box.w);
  const pxPerM = BOX_PX / box.w;
  function sepBox(keys) {
    const src = document.createElement('canvas');
    src.width = L.w;
    src.height = L.h;
    const g0 = src.getContext('2d');
    const img = g0.createImageData(L.w, L.h);
    const set = new Set(keys);
    for (let i = 0, o = 0; i < L.w * L.h; i++, o += 4) {
      if (L.labels[i] < 0 || !set.has(L.labels[i])) continue;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
      img.data[o + 3] = Math.min(255, L.color.data[o + 3] * 1.15);
    }
    g0.putImageData(img, 0, 0);
    const c = document.createElement('canvas');
    c.width = BOX_PX;
    c.height = boxPxH;
    const g = c.getContext('2d');
    g.translate(BOX_PX / 2, boxPxH / 2);
    g.rotate((-(placement.rotation || 0) * Math.PI) / 180);
    g.drawImage(src, (-W * fit * pxPerM) / 2, (-H * fit * pxPerM) / 2, W * fit * pxPerM, H * fit * pxPerM);
    return c;
  }
  const seps = inks.map((k) => sepBox([k]));
  // fracción de diseño por celda (para medir la cobertura)
  const cellW = seps.map((c) => {
    const s = document.createElement('canvas');
    s.width = GX;
    s.height = GZ;
    const g = s.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, 0, 0, GX, GZ);
    const d = g.getImageData(0, 0, GX, GZ).data;
    const w = new Float32Array(GX * GZ);
    for (let i = 0; i < GX * GZ; i++) w[i] = d[i * 4 + 3] / 255;
    return w;
  });

  // ---------------- remera sobre la platina ----------------
  ctx.placeShirt('exhibicion', { inflation: 0.025 });
  const lay = layShirt(shirt, info, { anchor: boxC, inflation: 0.025, lift: 0.001 });
  const restPos = lay.position.clone();
  let drop = 1;
  shirt.group.position.y = restPos.y + 0.16;

  // ---------------- cámara ----------------
  const view = () => {
    const c = boxC;
    // en el celular, la racleta arriba del shablón queda por debajo del HUD
    return isMobile()
      ? { position: [c.x + 0.04, c.y + 1.5, c.z + 0.92], target: [c.x - 0.01, c.y - 0.03, c.z - 0.06], fov: 45 }
      : { position: [c.x + 0.06, c.y + 0.92, c.z + 0.78], target: [c.x, c.y + 0.02, c.z + 0.02], fov: 45 };
  };
  // Vista rasante por debajo del cabezal del flash: el cabezal (40 × 40 cm) queda a ~9 cm de la
  // platina, así que solo una mirada baja y de frente deja ver la estampa (y el puff inflándose).
  const lowView = () => {
    const c = boxC;
    return isMobile()
      ? { position: [c.x + 0.04, c.y + 0.135, c.z + 0.8], target: [c.x, c.y + 0.012, c.z - 0.02], fov: 38 }
      : { position: [c.x + 0.06, c.y + 0.12, c.z + 0.55], target: [c.x, c.y + 0.012, c.z - 0.02], fov: 36 };
  };
  ctx.flyTo(view(), 1.4);
  let wasMobile = isMobile();
  ctx.listen(window, 'resize', () => {
    if (isMobile() === wasMobile) return;
    wasMobile = isMobile();
    if (!finished) ctx.flyTo(phase === 'flash' || phase === 'curing' ? lowView() : view(), 0.6);
  });

  // ---------------- tinta en la malla (capa propia que sigue al marco) ----------------
  const frameRig = new THREE.Group();
  frameRig.position.copy(pivotW);
  ctx.add(frameRig);
  const inkCanvas = document.createElement('canvas');
  inkCanvas.width = 256;
  inkCanvas.height = Math.round((256 * box.h) / box.w);
  const inkTex = new THREE.CanvasTexture(inkCanvas);
  inkTex.colorSpace = THREE.SRGBColorSpace;
  const inkMat = new THREE.MeshPhysicalMaterial({ map: inkTex, transparent: true, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const inkPlane = new THREE.Mesh(new THREE.PlaneGeometry(box.w, box.h).rotateX(-Math.PI / 2), inkMat);
  inkPlane.position.set(boxC.x - pivotW.x, MESH_DY + 0.0016, boxC.z - pivotW.z);
  inkPlane.renderOrder = 4;
  frameRig.add(inkPlane);
  const covCanvas = document.createElement('canvas');
  covCanvas.width = GX;
  covCanvas.height = GZ;
  const covImg = covCanvas.getContext('2d').createImageData(GX, GZ);
  // cordón de tinta que empuja la racleta
  const beadMat = new THREE.MeshPhysicalMaterial({ color: inkHex[0], roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const bead = new THREE.Mesh(new THREE.CapsuleGeometry(0.0055, 0.22, 4, 10).rotateZ(Math.PI / 2), beadMat);
  bead.scale.set(1, 0.55, 1.25);
  bead.visible = false;
  bead.renderOrder = 5;
  ctx.add(bead);
  let down = 1; // espejo del marco del prop
  let downTarget = 0;
  const meshY = (z) => {
    const th = (1 - down) * UP_ANGLE;
    return pivotW.y + MESH_DY * Math.cos(th) + (z - pivotW.z) * Math.sin(th);
  };

  // ---------------- estado del juego ----------------
  const lo = info.dark ? 1.15 : 0.8;
  const hi = info.dark ? 1.95 : 1.55;
  let pass = 0;
  let phase = 'load'; // load | ready | stroke | lift | flash | cure | curing | reveal
  let finished = false;
  let busy = false;
  let autoMode = false;
  const dep = new Float32Array(GX * GZ);
  const passes = []; // { q, thin, heavy, miss, strokes }
  const flashes = []; // { T, cls }
  let strokes = 0;
  let inkT = ROOM;
  let flashing = false;
  let flashSwing = 0;
  let sqActive = false;
  const sqPos = new THREE.Vector3();
  const sqGoal = new THREE.Vector3();
  let sqSpeed = 0;
  let pulling = false;
  let lastZ = 0;
  let cureSel = { temp: cure.temp + (puffMode ? 25 : -25), time: Math.round(cure.time * 0.5) };
  let cureT = 0;
  let cureRun = null;
  let simT = 0;

  const startZ = () => boxC.z - box.h / 2 - 0.04;
  const endZ = () => boxC.z + box.h / 2 + 0.035;

  function resetDeposit() {
    dep.fill(0);
    strokes = 0;
    drawInk();
  }

  function drawInk() {
    const k = clamp(pass, 0, inks.length - 1);
    const D = covImg.data;
    for (let i = 0; i < GX * GZ; i++) {
      const v = dep[i];
      D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = 0;
      D[i * 4 + 3] = Math.round(clamp(v / lo) * 255 * (v > hi + 0.2 ? 1 : 0.92));
    }
    covCanvas.getContext('2d').putImageData(covImg, 0, 0);
    const g = inkCanvas.getContext('2d');
    g.save();
    g.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    g.fillStyle = darken(inkHex[k], 0.88);
    g.fillRect(0, 0, inkCanvas.width, inkCanvas.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(seps[k], 0, 0, inkCanvas.width, inkCanvas.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(covCanvas, 0, 0, inkCanvas.width, inkCanvas.height);
    g.restore();
    inkTex.needsUpdate = true;
    drawMap();
  }

  // ---------------- panel ----------------
  const stages = kit.stepsBar(inks.length > 1 ? ['Tintas', 'Flash', 'Curado'] : ['Tinta', 'Curado']);
  const inkChips = inks.map((k, i) => {
    const sw = h('span', { class: 'est-ink-sw', style: { background: inkHex[i] } });
    const st = h('span', { class: 'est-ink-st' }, 'pendiente');
    const el = h('div', { class: 'est-ink' }, sw, h('span', { class: 'est-ink-name' }, `${i + 1}. ${inkName(i)}`), st);
    return { el, st };
  });
  const inkList = h('div', { class: 'est-inks' }, ...inkChips.map((c) => c.el));
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = GX * 6;
  mapCanvas.height = GZ * 6;
  mapCanvas.className = 'est-covmap';
  const mapLegend = h(
    'div',
    { class: 'est-covlegend' },
    h('span', { class: 'thin' }, 'fina'),
    h('span', { class: 'ok' }, 'pareja'),
    h('span', { class: 'heavy' }, 'cargada'),
  );
  const covText = h('div', { class: 'est-covtext' });
  const strokeBox = h('div', { class: 'est-stroke' }, h('div', { class: 'est-covwrap' }, mapCanvas, h('div', { class: 'est-covside' }, covText, mapLegend)));
  const tipBox = h('div', { class: 'est-tipbox' });
  const flashBtn = h('button', { class: 'btn btn-secondary est-hold est-hold-big' }, '🔥 Flashear (mantener apretado)');
  flashBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    flashOn();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) flashBtn.addEventListener(ev, () => flashOff());
  const flashBox = h('div', { class: 'est-flashbox' }, flashBtn);

  const curTemp = ui.slider({ label: 'Temperatura del curado', min: 110, max: 200, step: 5, value: cureSel.temp, unit: ' °C', onInput: (v) => (cureSel.temp = v) });
  const curTime = ui.slider({ label: 'Tiempo', min: 15, max: 120, step: 5, value: cureSel.time, unit: ' s', onInput: (v) => (cureSel.time = v) });
  const spec = (icon, label, value) => h('div', { class: 'est-spec' }, h('span', { class: 'est-spec-i' }, icon), h('span', { class: 'est-spec-l' }, label), h('b', { class: 'est-spec-v' }, value));
  const ficha = h(
    'div',
    { class: 'est-ficha' },
    h('div', { class: 'est-ficha-head' }, h('span', { class: 'est-ficha-kicker' }, 'Etiqueta del pote'), h('b', {}, I.name)),
    h('div', { class: 'est-ficha-grid' }, spec('🔥', 'Curado', `${cure.temp} °C`), spec('⏱️', 'Tiempo', `${cure.time} s`)),
    h('p', { class: 'est-ficha-tip' }, I.tip),
  );
  const cureBox = h('div', { class: 'est-cure' }, ficha, h('div', { class: 'est-controls' }, curTemp, curTime));
  const inkSec = ui.section(inks.length > 1 ? `Tintas (${inks.length} shablones)` : 'Tinta', inkList);
  const body = h('div', { class: 'est-panel est-screen' }, stages, inkSec, tipBox, flashBox, strokeBox, cureBox);
  ui.panel({
    kicker: kit.kicker,
    title: `Serigrafía · ${tech.name}`,
    subtitle: inks.length > 1 ? 'Un shablón por color: pasá la racleta, flasheá entre tintas y curá al final.' : 'Pasá la racleta con velocidad pareja y curá la tinta al final.',
    body,
  });

  function drawMap() {
    const g = mapCanvas.getContext('2d');
    const k = clamp(pass, 0, inks.length - 1);
    const w = cellW[k];
    const cw = mapCanvas.width / GX;
    const ch = mapCanvas.height / GZ;
    g.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    g.fillStyle = '#efe7dc';
    g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    for (let j = 0; j < GZ; j++) {
      for (let i = 0; i < GX; i++) {
        const c = j * GX + i;
        if (w[c] < 0.05) continue;
        const d = dep[c];
        let col;
        if (d < 0.05) col = 'rgba(43,36,32,0.16)';
        else if (d < lo * 0.85) col = `rgba(217,140,59,${0.35 + 0.5 * clamp(d / lo)})`;
        else if (d <= hi + 0.15) col = 'rgba(60,138,79,0.85)';
        else col = 'rgba(122,62,160,0.85)';
        g.fillStyle = col;
        g.fillRect(i * cw + 0.5, j * ch + 0.5, cw - 1, ch - 1);
      }
    }
    const ev = evalPass(k);
    covText.innerHTML = strokes ? `<b>${Math.round(ev.q * 100)}%</b> parejo<br><small>${strokes} pasada${strokes > 1 ? 's' : ''}</small>` : '<b>—</b><br><small>sin pasadas</small>';
  }

  // ---------------- HUD ----------------
  const speedGauge = gauge(h, {
    min: 0.05,
    max: 1.2,
    log: true,
    zones: [
      { from: 0.05, to: 0.13, cls: 'bad' },
      { from: 0.13, to: 0.17, cls: 'warn' },
      { from: 0.17, to: 0.4, cls: 'good' },
      { from: 0.4, to: 0.55, cls: 'warn' },
      { from: 0.55, to: 1.2, cls: 'bad' },
    ],
    left: 'lenta',
    right: 'rápida',
  });
  const flashGauge = gauge(h, {
    min: 20,
    max: 180,
    zones: [
      { from: 20, to: 85, cls: 'cold' },
      { from: 85, to: 95, cls: 'warn' },
      { from: 95, to: 125, cls: 'good' },
      { from: 125, to: 140, cls: 'warn' },
      { from: 140, to: 180, cls: 'bad' },
    ],
    left: 'fresca',
    right: 'quemada',
  });
  const hudTitle = h('div', { class: 'hud-title' }, 'Serigrafía');
  const hudPass = h('div', { class: 'est-hud-row' }, h('span', { class: 'est-hud-ink' }), h('b', {}));
  const hudSpeed = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, 'Velocidad'), h('b', { class: 'est-hud-mid' }, '—')), speedGauge);
  const hudFlash = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, '🌡️ Tinta'), h('b', { class: 'est-hud-big' }, '25 °C')), flashGauge);
  const cureBar = h('div', { class: 'est-hud-bar' }, h('i'));
  const inflText = h('b', { class: 'est-hud-mid' }, '');
  const inflRow = puffMode ? h('div', { class: 'est-hud-row est-infl' }, h('span', {}, '🫧 Inflado del puff'), inflText) : null;
  const hudCure = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, '🔥 Curando'), h('b', { class: 'est-hud-big' }, '0 s')), cureBar, inflRow);
  const hudMsg = h('div', { class: 'est-hud-msg' });
  const hudEl = h('div', { class: 'est-hud' }, hudTitle, hudPass, hudSpeed, hudFlash, hudCure, hudMsg);
  ui.hud(hudEl);

  function refreshHud() {
    const k = clamp(pass, 0, inks.length - 1);
    const kf = clamp(pass - 1, 0, inks.length - 1);
    hudPass.firstChild.innerHTML =
      phase === 'cure' || phase === 'curing' || phase === 'reveal'
        ? 'Curado final'
        : phase === 'flash'
          ? `<i class="est-dot" style="background:${inkHex[kf]}"></i> Flash de la tinta ${kf + 1}`
          : `<i class="est-dot" style="background:${inkHex[k]}"></i> Tinta ${k + 1} de ${inks.length}`;
    hudPass.lastChild.textContent = phase === 'stroke' || phase === 'ready' ? inkName(k) : '';
    hudSpeed.style.display = phase === 'stroke' || phase === 'ready' ? '' : 'none';
    hudFlash.style.display = phase === 'flash' ? '' : 'none';
    hudCure.style.display = phase === 'curing' ? '' : 'none';
    if (phase === 'stroke' || phase === 'ready') {
      const v = pulling ? sqSpeed : null;
      speedGauge.set(v);
      const lbl = hudSpeed.querySelector('.est-hud-mid');
      lbl.textContent = v == null ? '—' : v < 0.13 ? 'muy lenta' : v < 0.17 ? 'lenta' : v <= 0.4 ? '¡pareja!' : v <= 0.55 ? 'rápida' : 'muy rápida';
      lbl.className = `est-hud-mid ${v == null ? '' : v < 0.13 || v > 0.55 ? 'bad' : v < 0.17 || v > 0.4 ? 'warn' : 'good'}`;
    }
    if (phase === 'flash') {
      hudFlash.querySelector('b').textContent = `${Math.round(inkT)} °C`;
      flashGauge.set(inkT);
    }
    if (phase === 'curing' && cureRun) {
      hudCure.querySelector('b').textContent = `${Math.round(cureRun.t)} s`;
      cureBar.firstChild.style.width = `${clamp(cureRun.t / cureSel.time) * 100}%`;
      if (puffMode) {
        const v = Math.round((cureRun.infl ?? 0.2) * 100);
        inflText.textContent = `${v}%`;
        inflText.className = `est-hud-mid ${v >= 85 ? 'good' : v >= 50 ? 'warn' : ''}`;
      }
    }
  }

  function setChips() {
    inkChips.forEach((c, i) => {
      const isFlash = phase === 'flash' && i === pass - 1;
      const st = isFlash ? 'flash 🔥' : i < pass ? 'lista ✓' : i === pass && phase !== 'cure' && phase !== 'curing' && phase !== 'reveal' ? (phase === 'flash' ? 'sigue' : 'ahora') : 'pendiente';
      c.st.textContent = st;
      c.el.className = `est-ink ${isFlash ? 'current' : i < pass ? 'done' : i === pass && phase !== 'flash' ? 'current' : ''}`;
    });
  }

  function setPhaseUI() {
    const auto = { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoRun() };
    setChips();
    strokeBox.style.display = phase === 'ready' || phase === 'stroke' ? '' : 'none';
    flashBox.style.display = phase === 'flash' ? '' : 'none';
    inkSec.style.display = phase === 'cure' || phase === 'curing' || phase === 'reveal' ? 'none' : '';
    cureBox.style.display = phase === 'cure' || phase === 'curing' ? '' : 'none';
    for (const el of cureBox.querySelectorAll('input')) el.disabled = phase !== 'cure';
    const nStage = inks.length > 1 ? { ready: 0, stroke: 0, lift: 0, flash: 1, cure: 2, curing: 2, reveal: 3 } : { ready: 0, stroke: 0, lift: 0, cure: 1, curing: 1, reveal: 2 };
    stages.set(nStage[phase] ?? 0);
    const k = clamp(pass, 0, inks.length - 1);
    if (phase === 'ready' || phase === 'stroke') {
      tipBox.innerHTML = `<b>Pasada de racleta · tinta ${inkName(k)}</b><br>Agarrá la racleta arriba del shablón y tirala hacia vos, apoyada y a velocidad pareja (aguja en verde), cubriendo todo el dibujo.${info.dark ? ' En tela oscura conviene <b>dos pasadas</b> para que la tinta tape.' : ''}`;
      ui.setActions([auto, { id: 'lift', label: '⬆️ Levantar shablón', kind: 'primary', disabled: strokes === 0, onClick: () => liftFrame() }]);
      ui.hint(isMobile() ? 'Arrastrá la racleta hacia abajo sobre el shablón, parejo' : 'Arrastrá la racleta hacia vos, parejo · con teclado: <kbd>↓</kbd> acelera, soltá con la aguja en verde, <kbd>↑</kbd> frena · <kbd>Enter</kbd> levanta');
    } else if (phase === 'flash') {
      tipBox.innerHTML = '<b>Flash entre tintas</b><br>Mantené apretado el secador hasta que la tinta <b>gelifique</b> (zona verde) y soltá. Cruda, la próxima tinta la mancha; pasada, se quema y no agarra la siguiente.';
      ui.setActions([auto, { id: 'next', label: 'Siguiente tinta →', kind: 'primary', disabled: inkT < 60, onClick: () => nextInk() }]);
      ui.hint(isMobile() ? 'Mantené apretado el botón del flash y soltá en la zona verde' : 'Mantené <kbd>Espacio</kbd> (o el botón) para flashear · soltá en la zona verde');
    } else if (phase === 'cure') {
      tipBox.innerHTML = `<b>Curado final</b><br>${puffMode ? 'Con calor la tinta puff se infla.' : 'El plastisol cura cuando toda la capa llega a temperatura.'} Programá el secador como dice el pote.`;
      ui.setActions([auto, { id: 'cure', label: '🔥 Curar', kind: 'primary', onClick: () => startCure() }]);
      ui.hint('Ajustá temperatura y tiempo del curado y tocá <b>Curar</b>');
    } else {
      ui.setActions([]);
      if (phase !== 'curing') ui.hint(null);
      else ui.hint(puffMode ? '🫧 Mirá cómo se infla la tinta debajo del flash…' : '🔥 Curando la tinta debajo del flash…');
    }
    if (phase === 'lift' || phase === 'load') tipBox.innerHTML = '';
    if (phase === 'reveal') tipBox.innerHTML = `<b>¡Listo!</b> ${inks.length > 1 ? `${inks.length} tintas impresas y curadas` : 'Tinta impresa y curada'}: la estampa ya no se va con el lavado.`;
  }

  // ---------------- pasadas ----------------
  function evalPass(k) {
    const w = cellW[k];
    let sw = 0;
    let sq2 = 0;
    let thin = 0;
    let heavy = 0;
    let miss = 0;
    let thinness = 0;
    let heaviness = 0;
    for (let i = 0; i < GX * GZ; i++) {
      const ww = w[i];
      if (ww < 0.05) continue;
      const d = dep[i];
      let s;
      if (d < lo) s = Math.pow(clamp(d / lo), 1.6);
      else if (d <= hi) s = 1;
      else s = Math.max(0.35, 1 - (d - hi) * 0.8);
      sw += ww;
      sq2 += ww * s;
      thinness += ww * Math.max(0, 1 - d / lo);
      heaviness += ww * Math.max(0, (d - hi) / hi);
      if (d < 0.2) miss += ww;
      else if (d < lo * 0.85) thin += ww;
      if (d > hi + 0.15) heavy += ww;
    }
    sw = Math.max(1e-6, sw);
    return { q: sq2 / sw, thin: thin / sw, heavy: heavy / sw, miss: miss / sw, thinness: thinness / sw, heaviness: heaviness / sw };
  }

  // el shablón tarda ~0,6 s en apoyar: hasta entonces no se puede pasar la racleta
  const frameReady = () => downTarget > 0.5 && down > DOWN - 0.02;
  let waitToast = 0;
  function notReady() {
    if (frameReady()) return false;
    if (performance.now() - waitToast > 1500 && !autoMode) {
      waitToast = performance.now();
      ui.toast('Esperá que el shablón apoye sobre la remera…', 'info', 1200);
    }
    return true;
  }

  function frameDown() {
    const k = pass;
    sp.setStencil(seps[k]);
    sp.setInkColor(inkHex[k]);
    beadMat.color.set(darken(inkHex[k], 0.9));
    resetDeposit();
    downTarget = DOWN;
    phase = 'ready';
    sqActive = true;
    parkSq = 0;
    sqPos.copy(sq.position);
    sqGoal.set(boxC.x, meshY(startZ()), startZ());
    audio.play('thud');
    setPhaseUI();
    if (pass > 0 && !autoMode) ui.toast(`Shablón ${pass + 1}: tinta ${inkName(k)}`, 'info', 1800);
  }

  async function liftFrame() {
    if ((phase !== 'ready' && phase !== 'stroke') || strokes === 0) return;
    pulling = false;
    const ev = evalPass(pass);
    passes.push({ ...ev, strokes });
    phase = 'lift';
    setPhaseUI();
    downTarget = 0;
    parkSq = 0.001;
    audio.play('pop');
    // la tinta queda en la remera
    const done = inks.slice(0, pass + 1);
    await kit.wait(350);
    if (!ctx.alive) return;
    // el puff recién se infla al curar: hasta entonces queda chato
    shirt.setPrint(side, maskedResult(L, layerMask(L, done), puffMode ? { relief: (baseRes.params.reliefMm || 2) * 0.2 } : {}), placement);
    inkPlane.visible = false;
    if (!autoMode) {
      const msg = ev.miss > 0.08 ? 'Quedaron zonas sin tinta: faltó cubrir todo el dibujo.' : ev.thin > 0.25 ? 'Capa fina en partes: más lento o una segunda pasada.' : ev.heavy > 0.25 ? 'Mucha tinta: se va a correr un poco.' : '¡Capa pareja!';
      ui.toast(`${msg} (${Math.round(ev.q * 100)}%)`, ev.q > 0.85 ? 'good' : ev.q > 0.6 ? 'info' : 'warn', 2600);
    }
    await kit.wait(500);
    if (!ctx.alive) return;
    pass++;
    if (pass < inks.length) {
      phase = 'flash';
      inkT = ROOM + 5;
      ctx.flyTo(lowView(), 0.9);
      setPhaseUI();
    } else {
      phase = 'cure';
      setPhaseUI();
    }
  }

  // ---------------- flash ----------------
  let flashPeak = ROOM;
  function flashOn() {
    if (phase !== 'flash' || flashing) return;
    flashing = true;
    fd.setSwing(1);
    fd.setOn(true);
    audio.play('hiss');
  }
  function flashOff() {
    if (!flashing) return;
    flashing = false;
    fd.setOn(false);
    fd.setSwing(0);
    flashPeak = Math.max(flashPeak, inkT);
    if (phase === 'flash') {
      ui.enableAction('next', inkT >= 60);
      if (!autoMode) {
        if (inkT >= 95 && inkT <= 125) ui.toast(`Gelificada a ${Math.round(inkT)} °C: ¡justo!`, 'good', 1800);
        else if (inkT < 95) ui.toast(`${Math.round(inkT)} °C: todavía está cruda. Podés darle otro toque.`, 'warn', 2200);
        else ui.toast(`${Math.round(inkT)} °C: se pasó, la tinta se quemó un poco.`, 'bad', 2200);
      }
    }
  }
  function nextInk() {
    if (phase !== 'flash') return;
    flashOff();
    const T = flashPeak;
    const cls = T < 85 ? 'cruda' : T < 95 ? 'casi' : T <= 125 ? 'ok' : T <= 140 ? 'pasada' : 'quemada';
    flashes.push({ T, cls });
    flashPeak = ROOM;
    inkPlane.visible = true;
    ctx.flyTo(view(), 0.9);
    frameDown();
  }

  // ---------------- curado ----------------
  function startCure() {
    if (phase !== 'cure') return;
    phase = 'curing';
    cureRun = { t: 0, steps: 0 };
    ctx.flyTo(lowView(), 0.9);
    fd.setSwing(1);
    fd.setOn(true);
    audio.play('hiss');
    setPhaseUI();
  }

  function evaluate() {
    const notes = [];
    const def = { patchy: 0, lift: 0, scorch: 0, ghost: 0, under: 0 };
    let pen = 0;
    // pasadas
    const avgQ = passes.reduce((a, p) => a + p.q, 0) / Math.max(1, passes.length);
    const np = Math.max(1, passes.length);
    const thin = passes.reduce((a, p) => a + p.thin + p.miss * 1.5, 0) / np;
    const heavy = passes.reduce((a, p) => a + p.heavy, 0) / np;
    const thinness = passes.reduce((a, p) => a + p.thinness, 0) / np;
    const heaviness = passes.reduce((a, p) => a + p.heaviness, 0) / np;
    const miss = passes.reduce((a, p) => a + p.miss, 0) / np;
    pen += (1 - avgQ) * 0.55;
    // capa fina pareja = translúcida; huecos = manchas; de más = se corre
    def.patchy += clamp(thinness * 1.1 + miss * 0.9);
    def.under += clamp(thinness * 0.45);
    def.ghost += clamp(heaviness * 0.9 + heavy * 0.15);
    if (avgQ >= 0.9) notes.push(`${OK}Racleta pareja: ${passes.length > 1 ? 'las tintas quedaron' : 'la tinta quedó'} con buena cobertura (${Math.round(avgQ * 100)}%).`);
    else if (avgQ >= 0.7) notes.push(`${MID}Cobertura ${Math.round(avgQ * 100)}%: ${thin > heavy ? 'hay zonas con poca tinta (pasada rápida o sin cubrir los bordes)' : 'en partes cargaste de más y se corre'}. Tip: una sola pasada firme a velocidad constante.`);
    else notes.push(`${NO}Cobertura ${Math.round(avgQ * 100)}%: ${thin > heavy ? 'faltó tinta en muchas zonas: la racleta tiene que cubrir todo el dibujo, despacio y parejo' : 'demasiada tinta: se empasta y se corren los bordes'}.`);
    if (info.dark) {
      const strokesAvg = passes.reduce((a, p) => a + p.strokes, 0) / Math.max(1, passes.length);
      if (strokesAvg >= 1.8) notes.push(`${OK}En tela oscura hiciste doble pasada: la tinta tapa bien.`);
    }
    // flash
    if (flashes.length) {
      let fpen = 0;
      for (const f of flashes) {
        if (f.cls === 'cruda') {
          fpen += 0.12;
          def.ghost += 0.3;
        } else if (f.cls === 'casi') {
          fpen += 0.05;
          def.ghost += 0.1;
        } else if (f.cls === 'pasada') {
          fpen += 0.06;
          def.patchy += 0.08;
        } else if (f.cls === 'quemada') {
          fpen += 0.12;
          def.scorch += 0.25;
          def.patchy += 0.12;
        }
      }
      fpen /= flashes.length;
      pen += fpen;
      const bad = flashes.filter((f) => f.cls !== 'ok');
      if (!bad.length) notes.push(`${OK}Flash justo entre tintas: cada color gelificó antes del siguiente (95–125 °C).`);
      else if (bad.some((f) => f.cls === 'cruda' || f.cls === 'casi')) notes.push(`${NO}Flash corto (${Math.round(bad[0].T)} °C): la tinta seguía cruda y el shablón siguiente la manchó.`);
      else notes.push(`${MID}Flash de más (${Math.round(bad[0].T)} °C): la tinta se sobrecura y la siguiente no agarra bien${bad.some((f) => f.cls === 'quemada') ? '; además se tostó la tela' : ''}.`);
    }
    // curado
    const eT = cureSel.temp - cure.temp;
    const rt = cureSel.time / cure.time;
    let cpen = 0;
    if (eT < -8) {
      def.under += smoothstep(5, 40, -eT) * 0.85;
      cpen += smoothstep(5, 40, -eT) * 0.2;
    } else if (eT > 12) {
      def.scorch += smoothstep(10, 50, eT) * 0.7;
      cpen += smoothstep(10, 50, eT) * 0.18;
    }
    if (rt < 0.8) {
      def.under += smoothstep(0.1, 0.6, 1 - rt) * 0.7;
      cpen += smoothstep(0.1, 0.6, 1 - rt) * 0.16;
    } else if (rt > 1.7) {
      def.scorch += smoothstep(0.7, 1.6, rt - 1) * 0.3;
      cpen += 0.05;
    }
    pen += cpen;
    const okT = eT >= -8 && eT <= 12;
    const okTime = rt >= 0.8 && rt <= 1.7;
    if (okT && okTime) notes.push(`${OK}Curado a ${cureSel.temp} °C durante ${cureSel.time} s: ${puffMode ? 'el puff se infló entero' : 'el plastisol curó en todo su espesor'} (pedía ${cure.temp} °C · ${cure.time} s).`);
    else if (eT < -8 || rt < 0.8) notes.push(`${NO}Curado corto (${cureSel.temp} °C · ${cureSel.time} s, pedía ${cure.temp} °C · ${cure.time} s): ${puffMode ? 'el puff no levantó del todo y' : 'la tinta quedó cruda por dentro:'} se va a cuartear en los lavados.`);
    else notes.push(`${MID}Curado de más (${cureSel.temp} °C · ${cureSel.time} s, pedía ${cure.temp} °C · ${cure.time} s): ${puffMode ? 'el puff se pasa y se tuesta' : 'la tinta se pone dura y la tela amarillea'}.`);
    if (tech.id === 'puff' && info.dark) notes.push(`${MID}La tinta puff queda en tonos pastel: en tela oscura luce menos que en clara.`);
    return { quality: clamp(1 - pen, 0.15, 1), defects: def, notes };
  }

  async function reveal() {
    if (finished) return;
    finished = true;
    phase = 'reveal';
    setPhaseUI();
    fd.setOn(false);
    fd.setSwing(0);
    const ev = evaluate();
    if (autoMode) ev.notes.unshift(`${MID}Estampado en automático por el taller: la próxima pasá vos la racleta para sumar más puntos.`);
    const result = await kit.process(ev.quality, ev.defects);
    if (!ctx.alive) return;
    shirt.setPrint(side, result, placement);
    audio.play(ev.quality >= 0.7 ? 'good' : 'bad');
    const avgQ = passes.reduce((a, p) => a + p.q, 0) / Math.max(1, passes.length);
    const settings = { inks: inks.length, coverage: Math.round(avgQ * 100) / 100, flashes: flashes.map((f) => Math.round(f.T)), cure: { ...cureSel } };
    const tags = [`${inks.length} tinta${inks.length > 1 ? 's' : ''}`, `cobertura ${Math.round(avgQ * 100)}%`, `curado ${cureSel.temp} °C · ${cureSel.time} s`];
    await kit.finish({ quality: ev.quality, defects: ev.defects, notes: ev.notes, result, settings, tags });
  }

  // ---------------- automático ----------------
  async function autoRun() {
    if (busy || finished) return;
    busy = true;
    autoMode = true;
    ui.setActions([]);
    ui.hint('El taller estampa por vos…');
    while (ctx.alive && !finished) {
      if (phase === 'load' || phase === 'lift') {
        await kit.wait(120);
        continue;
      }
      if (phase === 'ready' || phase === 'stroke') {
        // una pasada un poco rápida (deja la capa algo fina)
        const v = info.dark ? 0.32 : 0.6;
        await untilFrame(ctx, frameReady, 3);
        if (!ctx.alive) return;
        sqActive = true;
        sqPos.set(boxC.x + 0.008, meshY(startZ()), startZ());
        sqGoal.copy(sqPos);
        await untilFrame(ctx, () => false, 0.15);
        pulling = true;
        lastZ = startZ();
        autoStroke = v;
        await untilFrame(ctx, () => !ctx.alive || sqGoal.z >= endZ(), 20);
        autoStroke = 0;
        pulling = false;
        strokes++;
        drawInk();
        await kit.wait(120);
        await liftFrame();
        continue;
      }
      if (phase === 'flash') {
        flashOn();
        await untilFrame(ctx, () => !ctx.alive || inkT >= 92, 30);
        flashOff();
        await untilFrame(ctx, () => false, 0.15);
        nextInk();
        continue;
      }
      if (phase === 'cure') {
        cureSel = { temp: cure.temp - 15, time: Math.round(cure.time * 0.85) };
        curTemp.setValue(cureSel.temp);
        curTime.setValue(cureSel.time);
        startCure();
        continue;
      }
      await kit.wait(100);
    }
  }
  let autoStroke = 0;
  let parkSq = 0;

  // ---------------- entrada ----------------
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerPos = () => {
    plane.constant = -meshY(boxC.z);
    return engine.pointerOnPlane(plane);
  };
  const inFrame = (p) => p && Math.abs(p.x - boxC.x) < innerW / 2 + 0.06 && p.z > frameCZ - innerD / 2 - 0.08 && p.z < frameCZ + innerD / 2 + 0.12;
  const clampSq = (p) => {
    p.x = clamp(p.x, boxC.x - 0.07, boxC.x + 0.07);
    p.z = clamp(p.z, frameCZ - innerD / 2 + 0.025, frameCZ + innerD / 2 - 0.02);
    return p;
  };
  ctx.onPointer('down', (e) => {
    if (finished || busy || e.button > 0) return;
    if (phase !== 'ready' && phase !== 'stroke') return;
    if (keyPull) return;
    const p = pointerPos();
    if (!inFrame(p)) return;
    if (notReady()) return;
    clampSq(p);
    sqGoal.set(p.x, meshY(p.z), p.z);
    // si agarra la racleta lejos, la lleva ahí de un salto
    if (sqPos.distanceTo(sqGoal) > 0.03) sqPos.copy(sqGoal);
    pulling = true;
    lastZ = sqPos.z;
    phase = 'stroke';
    engine.canvas.style.cursor = 'grabbing';
  });
  ctx.onPointer('move', () => {
    if (finished) return;
    if (!pulling) {
      if (phase === 'ready' || phase === 'stroke') engine.canvas.style.cursor = inFrame(pointerPos()) ? 'grab' : '';
      return;
    }
    const p = pointerPos();
    if (!p) return;
    clampSq(p);
    sqGoal.set(p.x, meshY(p.z), p.z);
  });
  ctx.onPointer('up', () => {
    if (!pulling || autoStroke || keyPull) return;
    pulling = false;
    engine.canvas.style.cursor = '';
    endStroke();
  });
  function endStroke() {
    if (strokeMoved > 0.05) {
      strokes++;
      audio.play('cut');
      ui.enableAction('lift', true);
      drawMap();
    }
    strokeMoved = 0;
  }
  let strokeMoved = 0;
  const keys = new Set();
  const STROKE_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyS', 'KeyW', 'KeyA', 'KeyD', 'Enter'];
  ctx.listen(window, 'keydown', (e) => {
    const codes = phase === 'ready' || phase === 'stroke' ? STROKE_KEYS : phase === 'flash' ? ['Space', 'Enter'] : phase === 'cure' ? ['Enter'] : [];
    if (finished || busy || !gameKey(e, codes)) return;
    e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    // ↓ arranca la pasada (y mientras se mantiene, acelera la racleta)
    if ((e.code === 'ArrowDown' || e.code === 'KeyS') && (phase === 'ready' || phase === 'stroke') && !pulling && !notReady()) {
      if (sqPos.z > endZ() - 0.02) sqPos.set(sqPos.x, meshY(startZ()), startZ());
      sqGoal.copy(sqPos);
      pulling = true;
      keyPull = true;
      keyV = 0.06;
      lastZ = sqPos.z;
      phase = 'stroke';
    }
    if (e.code === 'Space' && phase === 'flash') flashOn();
    if (e.code === 'Enter') {
      if (phase === 'ready' || phase === 'stroke') liftFrame();
      else if (phase === 'flash') nextInk();
      else if (phase === 'cure') startCure();
    }
  });
  let keyPull = false;
  let keyV = 0;
  function endKeyStroke() {
    if (!keyPull) return;
    keyPull = false;
    pulling = false;
    keyV = 0;
    endStroke();
  }
  ctx.listen(window, 'keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space' && phase === 'flash') flashOff();
  });
  ctx.listen(window, 'blur', () => {
    keys.clear();
    flashOff();
  });
  // (endKeyStroke se llama desde el bucle cuando la racleta llega al final o se frena)

  // ---------------- bucle ----------------
  const puffs = createPuffs(50, { color: '#ffffff' });
  ctx.add(puffs.points);
  const tmpP = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  ctx.onUpdate((dt0) => {
    const dt = dt0 * kit.timeScale;
    simT += dt;
    if (drop > 0) {
      drop = Math.max(0, drop - dt0 * 2.6);
      shirt.group.position.y = restPos.y + 0.16 * drop * drop;
      if (drop === 0) {
        audio.play('thud');
        if (phase === 'load') ctx.timeout(() => phase === 'load' && frameDown(), 250);
      }
    }
    // marco (espejo del prop)
    sp.setFrameDown(downTarget);
    down += (downTarget - down) * (1 - Math.exp(-6 * dt0));
    frameRig.rotation.x = -(1 - down) * UP_ANGLE;
    // racleta
    if (parkSq > 0) {
      bead.visible = false;
      // la racleta vuelve a su lugar mientras se flashea/cura
      parkSq = Math.min(1, parkSq + dt0 * 1.6);
      const k = 1 - Math.exp(-dt0 * 5);
      sq.position.lerp(sqRest.p, k);
      sq.quaternion.slerp(sqRest.q, k);
    } else if (sqActive) {
      if (keyPull) {
        // ↓ empuja, ↑ frena; suelta, la racleta sigue con su inercia y la tinta la frena de a poco
        const push = keys.has('ArrowDown') || keys.has('KeyS');
        const brake = keys.has('ArrowUp') || keys.has('KeyW');
        keyV += ((push ? KEY_ACCEL : 0) - (brake ? KEY_BRAKE : 0) - keyV * KEY_DRAG) * dt;
        keyV = clamp(keyV, 0, KEY_VMAX);
        sqGoal.z = Math.min(endZ(), sqGoal.z + keyV * dt);
        if (keys.has('ArrowLeft') || keys.has('KeyA')) sqGoal.x -= 0.12 * dt;
        if (keys.has('ArrowRight') || keys.has('KeyD')) sqGoal.x += 0.12 * dt;
        clampSq(sqGoal);
        if ((sqGoal.z >= endZ() && sqPos.z >= endZ() - 0.004) || (keyV < 0.02 && !push)) endKeyStroke();
      } else if (autoStroke) {
        sqGoal.z = Math.min(endZ(), sqGoal.z + autoStroke * dt);
      }
      if (!pulling && phase !== 'lift') {
        // en reposo, la racleta descansa arriba del shablón
        if (phase === 'ready' && sqPos.z > endZ() - 0.03) sqGoal.set(boxC.x, meshY(startZ()), startZ());
      }
      const k = 1 - Math.exp(-dt0 * (pulling ? 30 : 9));
      const prevZ = sqPos.z;
      sqPos.lerp(sqGoal, k);
      if (pulling) sqPos.y = meshY(sqPos.z);
      sq.position.set(sqPos.x, sqPos.y, sqPos.z);
      sq.rotation.set(pulling ? 0.32 : 0.18, 0, 0);
      bead.visible = phase === 'ready' || phase === 'stroke';
      bead.position.set(sqPos.x, meshY(sqPos.z + 0.014) + 0.003, sqPos.z + 0.014);
      const vz = (sqPos.z - prevZ) / Math.max(1e-4, dt0);
      sqSpeed += (Math.max(0, vz) - sqSpeed) * (1 - Math.exp(-dt0 * 10));
      // depósito de tinta: solo tirando hacia uno
      if (pulling && sqPos.z > prevZ + 1e-5 && (phase === 'stroke' || phase === 'ready')) {
        strokeMoved += sqPos.z - prevZ;
        const v = Math.max(0.03, vz);
        const amt = clamp(Math.pow(V_IDEAL / v, 0.6), 0.32, 1.9);
        const z0 = boxC.z - box.h / 2;
        const j0 = Math.floor(((prevZ - z0) / box.h) * GZ);
        const j1 = Math.floor(((sqPos.z - z0) / box.h) * GZ);
        const xa = sqPos.x - 0.14;
        const xb = sqPos.x + 0.14;
        let touched = false;
        for (let j = Math.max(0, j0 + 1); j <= Math.min(GZ - 1, j1); j++) {
          for (let i = 0; i < GX; i++) {
            const cx0 = boxC.x - box.w / 2 + (i / GX) * box.w;
            const cx1 = cx0 + box.w / GX;
            const f = clamp((Math.min(xb, cx1) - Math.max(xa, cx0)) / (cx1 - cx0));
            if (f <= 0) continue;
            dep[j * GX + i] += amt * f;
            touched = true;
          }
        }
        if (touched) drawInk();
      }
    }
    // flash
    flashSwing += ((flashing || phase === 'curing' ? 1 : 0) - flashSwing) * (1 - Math.exp(-3 * dt0));
    if (phase === 'flash') {
      if (flashing && flashSwing > 0.8) inkT += (200 - inkT) * (1 - Math.exp(-0.26 * dt));
      else if (!flashing) inkT = Math.max(ROOM, inkT - dt * 6);
      if (flashing && inkT > 125 && Math.random() < dt * 6) {
        tmpP.set(boxC.x + (Math.random() - 0.5) * 0.15, boxC.y + 0.01, boxC.z + (Math.random() - 0.5) * 0.15);
        tmpV.set(0, 0.08, 0);
        puffs.emit(tmpP, tmpV, 1.2, 1, '#d8d2c8');
      }
    }
    // curado
    if (phase === 'curing' && cureRun) {
      if (flashSwing > 0.75) {
        const speedC = cureSel.time / 4.5; // ~4,5 s reales
        cureRun.t = Math.min(cureSel.time, cureRun.t + dt * speedC);
        const k = cureRun.t / cureSel.time;
        if (puffMode) {
          // se infla de a poco (y menos si la temperatura no alcanza)
          const okT = clamp(1 - smoothstep(5, 40, cure.temp - cureSel.temp) * 0.7, 0.25, 1);
          cureRun.infl = 0.2 + 0.8 * k * okT;
          const step = Math.floor(k * 8);
          if (step > cureRun.steps) {
            cureRun.steps = step;
            const r0 = baseRes.params.reliefMm || 2;
            shirt.setPrint(side, withParams(baseRes, { reliefMm: r0 * (0.2 + 0.8 * (step / 8) * okT) }), placement);
          }
        }
        if (Math.random() < dt0 * 5) {
          tmpP.set(boxC.x + (Math.random() - 0.5) * 0.2, boxC.y + 0.01, boxC.z + (Math.random() - 0.5) * 0.2);
          tmpV.set(0, 0.06, 0);
          puffs.emit(tmpP, tmpV, 1.3, 1, '#e6e1d8');
        }
        if (cureRun.t >= cureSel.time && !cureRun.done) {
          cureRun.done = true;
          reveal();
        }
      }
    }
    puffs.update(dt0);
    refreshHud();
  });

  // ---------------- ganchos de prueba ----------------
  Object.defineProperty(kit.test, 'phase', { get: () => phase, configurable: true, enumerable: true });
  Object.assign(kit.test, {
    info: () => ({ phase, pass, inks: inkHex, strokes, inkT: Math.round(inkT), speed: Math.round(sqSpeed * 100) / 100, sq: sqPos.toArray().map((v) => +v.toFixed(3)), passes: passes.map((p) => ({ q: +p.q.toFixed(2), thin: +p.thin.toFixed(2), heavy: +p.heavy.toFixed(2), miss: +p.miss.toFixed(2) })), cure: cureSel, cureT: cureRun ? Math.round(cureRun.t) : null }),
    screenPts: () => {
      const a = engine.worldToScreen(new THREE.Vector3(boxC.x, meshY(startZ()), startZ() + 0.01));
      const b = engine.worldToScreen(new THREE.Vector3(boxC.x, meshY(endZ()), endZ()));
      return { x0: Math.round(a.x), y0: Math.round(a.y), x1: Math.round(b.x), y1: Math.round(b.y) };
    },
    lift: liftFrame,
    flashOn,
    flashOff,
    next: nextInk,
    setCure: (t, s) => {
      cureSel = { temp: t, time: s };
      curTemp.setValue(t);
      curTime.setValue(s);
    },
    cure: startCure,
    auto: autoRun,
    fast: (k) => (kit.timeScale = k),
  });

  inkPlane.visible = true;
  drawInk();
  setPhaseUI();
  refreshHud();
}
