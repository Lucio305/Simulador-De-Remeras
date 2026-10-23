// Mini-juego de pintura textil a mano: el dibujo ya está pintado (paso Diseño); acá se fija.
// 1) Secado al aire: mantener para adelantar el reloj (la pintura pasa de brillante a mate).
//    Se puede tocar la pintura para ver si está seca.
// 2) Fijado con plancha: papel protector encima, nivel de la plancha según la tela, sin vapor,
//    y pasarla por TODO el dibujo hasta completar el fijado (mapa de calor sobre el dibujo).
//    Quieta y demasiado caliente, quema la tela.

import * as THREE from 'three';
import { OK, NO, MID, layShirt, conformGeometry, basePrint, withParams, surfacePoint, garmentX, rectMapper, contentBox, garmentHit, gameKey, untilFrame, throttle, clamp } from './common.js';

const ROOM = 25;
const NEED = 180; // segundos "a 150 °C" que pide la pintura
const ACCEL = 48; // segundos de fijado por segundo real (a 150 °C)
const GN = 16;

export async function runPaint(kit) {
  const { ctx, info, ui, h, audio, world, shirt, engine, isMobile, catalog } = kit;
  const { tech, fabric, side, placement } = info;
  const board = world.props.ironingBoard;
  const iron = world.props.iron;
  const LEVELS = catalog.IRON_LEVELS;
  const maxLevel = fabric.ironLevel;
  const kicker = 'Paso 10 · Tabla de planchar';

  // ---------------- props ----------------
  kit.keepPose(iron.group);
  ctx.track(() => {
    iron.setLevel(0);
    iron.setSteam(false);
    iron.setHot(0);
  });
  iron.setLevel(0);
  iron.setSteam(false);
  iron.setHot(0);

  ui.panel({ kicker, title: 'Pintura textil · fijado', subtitle: 'Llevando la remera a la tabla…', body: h('div', { class: 'est-loading' }, 'Preparando la pintura…') });
  await kit.wait(60);
  if (!ctx.alive) return;
  const baseRes = info.d.preview && info.d.preview.technique === tech.id && info.d.preview.color ? info.d.preview : basePrint(info);
  if (!ctx.alive) return;
  const W = placement.width;
  const H = W / (baseRes.aspect || 1);

  // ---------------- remera acostada en la tabla (cuello hacia la punta) ----------------
  ctx.placeShirt('exhibicion', { inflation: 0.06 });
  const neckX = board.center.x + 0.12;
  const anchor = new THREE.Vector3(neckX + placement.y, board.surfaceY, board.center.z + placement.x);
  const lay = layShirt(shirt, info, { anchor, yaw: -Math.PI / 2, inflation: 0.06, lift: 0.002 });
  const restPos = lay.position.clone();
  const P0 = surfacePoint(shirt, side, placement.x, placement.y, 0).p;
  let drop = 1;

  // pintura fresca: brillante
  const wetLook = (k) => withParams(baseRes, { clearcoat: 0.85 * (1 - k), clearcoatRoughness: 0.08 + 0.4 * k, roughness: clamp((baseRes.params.roughness ?? 0.6) * (0.35 + 0.65 * k), 0.12, 1) });
  shirt.setPrint(side, wetLook(0), placement);
  let wetStep = 0;

  kit.closeDir = new THREE.Vector3(-1, 0, 0.08).normalize();
  // lo que de verdad está pintado (un dibujo a mano suele ocupar menos que su recuadro)
  const cb = contentBox(baseRes.color);
  const rect0 = { cx: placement.x, cy: placement.y, w: W, h: H, rot: placement.rotation || 0 };
  const cView = rectMapper(rect0)(cb.cu, cb.cv);
  const PC = surfacePoint(shirt, side, cView.x, cView.y, 0).p;
  const paintSize = Math.max(0.05, cb.w * W, cb.h * H);
  // desde la punta cuadrada de la tabla: el dibujo se ve derecho (el cuello queda al fondo).
  // En el celular, más cerca y según el tamaño del dibujo (que no quede diminuto).
  const view = () => {
    if (isMobile()) {
      const k = clamp(paintSize * 5.2, 0.74, 1.3) / 1.6;
      return { position: [PC.x - 1.02 * k, PC.y + 1.25 * k, PC.z + 0.05 * k], target: [PC.x + 0.05 * k, PC.y, PC.z] };
    }
    const k = clamp(paintSize / 0.24, 0.72, 1.1);
    return { position: [PC.x - 0.86 * k, PC.y + 0.9 * k, PC.z + 0.08 * k], target: [PC.x + 0.06 * k, PC.y + 0.01, PC.z] };
  };
  ctx.flyTo(view(), 1.5);
  let wasMobile = isMobile();
  ctx.listen(window, 'resize', () => {
    if (isMobile() === wasMobile) return;
    wasMobile = isMobile();
    if (!finished) ctx.flyTo(view(), 0.6);
  });

  // ---------------- celdas del dibujo (para el fijado) ----------------
  const rect = { cx: placement.x, cy: placement.y, w: W, h: H, rot: placement.rotation || 0 };
  const map = rectMapper(rect);
  const alphaC = document.createElement('canvas');
  alphaC.width = GN;
  alphaC.height = GN;
  {
    const g = alphaC.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(baseRes.color, 0, 0, GN, GN);
  }
  const ad = alphaC.getContext('2d').getImageData(0, 0, GN, GN).data;
  const cells = [];
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      // fila j del canvas = de arriba hacia abajo → v = 1 - (j + 0.5)/GN
      const w = ad[(j * GN + i) * 4 + 3] / 255;
      const p = map((i + 0.5) / GN, 1 - (j + 0.5) / GN);
      const wp = w > 0.04 ? surfacePoint(shirt, side, p.x, p.y, 0).p : null;
      cells.push({ w, wp, dose: 0, vx: p.x, vy: p.y });
    }
  }
  const sumW = cells.reduce((a, c) => a + (c.w > 0.04 ? c.w : 0), 0) || 1;

  // mapa de calor sobre el dibujo
  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = GN;
  heatCanvas.height = GN;
  const heatTex = new THREE.CanvasTexture(heatCanvas);
  heatTex.colorSpace = THREE.SRGBColorSpace;
  heatTex.magFilter = THREE.LinearFilter;
  const heatMesh = new THREE.Mesh(
    conformGeometry(shirt, side, { ...rect, w: W * 1.02, h: H * 1.02 }, { segs: 14, offset: 0.0034 }),
    new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  heatMesh.renderOrder = 7;
  heatMesh.visible = false;
  ctx.add(heatMesh, shirt.group);
  function drawHeat() {
    const g = heatCanvas.getContext('2d');
    const img = g.createImageData(GN, GN);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (c.w <= 0.04) continue;
      const d = clamp(c.dose / NEED);
      const o = k * 4;
      if (d >= 1) {
        img.data[o] = 120;
        img.data[o + 1] = 220;
        img.data[o + 2] = 140;
        img.data[o + 3] = 40;
      } else {
        // azul (sin fijar) → naranja (a medio camino)
        img.data[o] = 70 + 185 * d;
        img.data[o + 1] = 140 + 20 * d;
        img.data[o + 2] = 230 - 190 * d;
        img.data[o + 3] = 150 * (1 - d * 0.55) * Math.min(1, c.w * 1.5);
      }
    }
    g.putImageData(img, 0, 0);
    heatTex.needsUpdate = true;
  }

  // papel protector
  const paper = new THREE.Mesh(
    conformGeometry(shirt, side, { ...rect, w: W + 0.07, h: H + 0.07, rot: rect.rot + 3 }, { segs: 14, offset: 0.0022 }),
    new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.6, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  );
  paper.renderOrder = 6;
  paper.visible = false;
  ctx.add(paper, shirt.group);

  // ---------------- estado ----------------
  let phase = 'dry'; // dry | setup | iron | reveal
  let finished = false;
  let busy = false;
  let autoMode = false;
  let hours = 0;
  let ffwd = false;
  let protector = false;
  let level = Math.min(4, maxLevel + 1);
  let steam = true;
  let ironT = ROOM;
  let pressing = false;
  let keyPress = false;
  let pointerIn = false;
  let stillT = 0;
  let scorches = 0;
  let contactTime = 0;
  let simT = 0;
  const ironPos = new THREE.Vector3();
  const ironGoal = new THREE.Vector3();
  let yaw = 0;
  const shirtTop = () => P0.y + (protector ? 0.0025 : 0.0012);
  ironPos.copy(iron.group.position);
  ironGoal.copy(ironPos);
  let ironActive = false;


  // ---------------- panel ----------------
  const stages = kit.stepsBar(['Secar', 'Preparar', 'Fijar']);
  const clockFace = h('div', { class: 'est-clock' }, h('i', { class: 'est-clock-h' }), h('i', { class: 'est-clock-m' }));
  const clockText = h('b', { class: 'est-clock-text' }, '0 h');
  const dryMeter = ui.meter({ label: 'Secado', value: 0 });
  const ffBtn = h('button', { class: 'btn btn-secondary est-hold' }, '⏩ Adelantar el reloj (mantener)');
  ffBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ffwd = true;
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) ffBtn.addEventListener(ev, () => (ffwd = false));
  const dryBox = h(
    'div',
    {},
    ui.section(
      'Secado al aire',
      h('p', { class: 'est-p' }, 'La pintura textil tiene que secar bien antes de fijarla con calor. Tocá el dibujo para ver cómo está.'),
      h('div', { class: 'est-dry' }, clockFace, h('div', { class: 'est-dry-info' }, clockText, h('span', { class: 'est-dry-sub' }, 'de secado'))),
      ffBtn,
      dryMeter,
    ),
  );

  const spec = (icon, label, value) => h('div', { class: 'est-spec' }, h('span', { class: 'est-spec-i' }, icon), h('span', { class: 'est-spec-l' }, label), h('b', { class: 'est-spec-v' }, value));
  const ficha = h(
    'div',
    { class: 'est-ficha' },
    h('div', { class: 'est-ficha-head' }, h('span', { class: 'est-ficha-kicker' }, 'Etiqueta del frasco'), h('b', {}, 'Pintura textil al agua')),
    h('div', { class: 'est-ficha-grid' }, spec('⏳', 'Secado', '24 h'), spec('🔥', 'Fijado', '150 °C · 3 min'), spec('📄', 'Protección', 'papel o del revés'), spec('💧', 'Vapor', 'no')),
    h('p', { class: 'est-ficha-tip' }, 'En telas sintéticas: plancha baja y más tiempo. Siempre en movimiento.'),
  );
  const levelSeg = ui.segmented({
    options: LEVELS.map((l) => ({ id: String(l.level), label: '•'.repeat(l.level), title: `${l.name} · ${l.temp} °C · ${l.label}` })),
    value: String(level),
    onChange: (id) => {
      level = +id;
      iron.setLevel(level);
      refreshSetup();
    },
  });
  const levelText = h('div', { class: 'est-field-sub' });
  const protToggle = ui.toggle({
    label: 'Papel manteca encima (o planchar del revés)',
    value: protector,
    onChange: (v) => {
      protector = v;
      paper.visible = v;
      audio.play('pop');
    },
  });
  const steamToggle = ui.toggle({
    label: 'Vapor',
    value: steam,
    onChange: (v) => {
      steam = v;
      iron.setSteam(v && level > 0);
    },
  });
  const fabricNote = ui.note(`Tu tela: <b>${fabric.short}</b> · plancha hasta <b>${'•'.repeat(maxLevel)}</b> (${LEVELS.find((l) => l.level === maxLevel)?.temp} °C).`, maxLevel <= 1 ? 'warn' : 'info');
  const setupBox = h(
    'div',
    {},
    ficha,
    ui.section('Plancha', h('div', { class: 'est-field' }, h('span', { class: 'est-field-l' }, 'Temperatura (puntos del dial)'), levelSeg, levelText), protToggle, steamToggle, fabricNote),
  );
  const fixMeter = ui.meter({ label: 'Fijado del dibujo', value: 0 });
  const ironBox = h('div', {}, ui.section('Fijado', h('p', { class: 'est-p' }, 'Pasá la plancha por todo el dibujo, despacio y sin dejarla quieta: el mapa se pone verde donde ya fijó.'), fixMeter));
  const body = h('div', { class: 'est-panel est-paint' }, stages, dryBox, setupBox, ironBox);
  ui.panel({ kicker, title: 'Pintura textil · fijado', subtitle: 'La pintura a mano se fija con calor: primero secar, después planchar como dice el frasco.', body });

  // ---------------- HUD ----------------
  const hudDry = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, '⏳ Secado'), h('b', { class: 'est-hud-big' }, '0 h')), h('div', { class: 'est-hud-bar' }, h('i')));
  const hudIron = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, '🌡️ Plancha'), h('b', { class: 'est-hud-big' }, '25 °C')), h('div', { class: 'est-hud-bar' }, h('i')));
  const hudFix = h('div', { class: 'est-hud-sec' }, h('div', { class: 'est-hud-row' }, h('span', {}, '✅ Fijado'), h('b', { class: 'est-hud-big' }, '0%')), h('div', { class: 'est-hud-bar ready' }, h('i')));
  const hudMsg = h('div', { class: 'est-hud-msg' });
  ui.hud(h('div', { class: 'est-hud' }, h('div', { class: 'hud-title' }, 'Pintura textil'), hudDry, hudIron, hudFix, hudMsg));

  const dryK = () => clamp(hours / 24);
  function fixK() {
    let s = 0;
    for (const c of cells) if (c.w > 0.04) s += c.w * clamp(c.dose / NEED);
    return s / sumW;
  }
  function refreshSetup() {
    const L = LEVELS.find((l) => l.level === level);
    levelText.textContent = `${L.name.replace(/^[•\s]+/, '')} · ${L.temp} °C · ${L.label}`;
    levelText.className = `est-field-sub ${level > maxLevel ? 'bad' : ''}`;
  }
  function refreshHud() {
    hudDry.style.display = phase === 'dry' ? '' : 'none';
    hudIron.style.display = phase === 'setup' || phase === 'iron' ? '' : 'none';
    hudFix.style.display = phase === 'iron' ? '' : 'none';
    const hh = Math.floor(hours);
    hudDry.querySelector('b').textContent = `${hh} h`;
    hudDry.querySelector('i').style.width = `${dryK() * 100}%`;
    hudDry.querySelector('.est-hud-bar').classList.toggle('ready', hours >= 24);
    clockText.textContent = hours >= 48 ? `${Math.floor(hours / 24)} días` : `${hh} h`;
    clockFace.querySelector('.est-clock-h').style.transform = `rotate(${(hours / 12) * 360}deg)`;
    clockFace.querySelector('.est-clock-m').style.transform = `rotate(${hours * 360}deg)`;
    dryMeter.set(dryK(), hours < 1 ? 'fresca' : hours < 4 ? 'seca al tacto' : hours < 24 ? 'casi seca' : 'lista para fijar');
    const target = LEVELS.find((l) => l.level === level)?.temp || 150;
    hudIron.querySelector('b').textContent = `${Math.round(ironT)} °C`;
    hudIron.querySelector('i').style.width = `${clamp((ironT - ROOM) / (target - ROOM)) * 100}%`;
    hudIron.querySelector('.est-hud-bar').classList.toggle('ready', ironT >= target - 4);
    if (phase === 'iron') {
      const f = fixK();
      hudFix.querySelector('b').textContent = `${Math.round(f * 100)}%`;
      hudFix.querySelector('i').style.width = `${f * 100}%`;
      fixMeter.set(f);
    }
  }

  function setPhaseUI() {
    const auto = { id: 'auto', label: 'Hacerlo automático', kind: 'auto', onClick: () => autoRun() };
    dryBox.style.display = phase === 'dry' ? '' : 'none';
    setupBox.style.display = phase === 'setup' ? '' : 'none';
    ironBox.style.display = phase === 'iron' ? '' : 'none';
    stages.set({ dry: 0, setup: 1, iron: 2, reveal: 3 }[phase] ?? 0);
    if (phase === 'dry') {
      ui.setActions([auto, { id: 'next', label: 'Ya secó → planchar', kind: 'primary', onClick: () => toSetup() }]);
      ui.hint(isMobile() ? 'Mantené apretado ⏩ para adelantar el reloj · tocá el dibujo para probar' : 'Mantené <kbd>Espacio</kbd> (o ⏩) para adelantar el reloj · tocá el dibujo para ver si secó');
    } else if (phase === 'setup') {
      ui.setActions([auto, { id: 'go', label: 'Planchar →', kind: 'primary', onClick: () => toIron() }]);
      ui.hint('Prepará la plancha y el dibujo como dice el frasco');
    } else if (phase === 'iron') {
      ui.setActions([auto, { id: 'done', label: 'Listo', kind: 'primary', onClick: () => reveal() }]);
      ui.hint(isMobile() ? 'Arrastrá la plancha por todo el dibujo' : 'Mové la plancha con el mouse y mantené apretado (o <kbd>Espacio</kbd>) para apoyarla · recorré todo el dibujo');
    } else ui.setActions([]);
  }

  // ---------------- acciones ----------------
  function toSetup() {
    if (phase !== 'dry') return;
    ffwd = false;
    phase = 'setup';
    iron.setLevel(level);
    iron.setSteam(steam);
    ironActive = true;
    // la plancha sale del apoya-plancha y espera al costado del dibujo
    ironGoal.set(P0.x - W * 0.2 - 0.16, P0.y + 0.05, P0.z + H * 0.1 + 0.18);
    refreshSetup();
    setPhaseUI();
  }

  function toIron() {
    if (phase !== 'setup') return;
    phase = 'iron';
    heatMesh.visible = true;
    drawHeat();
    setPhaseUI();
    const target = LEVELS.find((l) => l.level === level)?.temp || 150;
    if (ironT < target - 20 && !autoMode) ui.toast('La plancha todavía está calentando: va a fijar más lento.', 'warn');
  }

  function touchPaint() {
    if (phase !== 'dry') return;
    audio.play('click');
    if (hours < 1) ui.toast('👆 ¡Está fresca! Casi te llevás pintura en el dedo.', 'warn', 2200);
    else if (hours < 6) ui.toast('👆 Seca al tacto… pero adentro todavía está húmeda.', 'info', 2200);
    else if (hours < 24) ui.toast('👆 Casi seca. El frasco dice 24 h antes de planchar.', 'info', 2200);
    else ui.toast('👆 Bien seca: lista para fijar.', 'good', 2000);
  }

  function evaluate() {
    const notes = [];
    const def = { patchy: 0, lift: 0, scorch: 0, ghost: 0, under: 0 };
    let pen = 0;
    // secado
    if (hours >= 24) notes.push(`${OK}Dejaste secar ${hours >= 48 ? `${Math.floor(hours / 24)} días` : `${Math.floor(hours)} h`}: la pintura estaba lista para fijar.`);
    else if (hours >= 12) {
      pen += 0.05;
      def.under += 0.1;
      notes.push(`${MID}Fijaste a las ${Math.floor(hours)} h: casi seca. El frasco pide 24 h para que el calor no encierre humedad.`);
    } else if (hours >= 2) {
      pen += 0.12;
      def.under += 0.3;
      notes.push(`${NO}Fijaste a las ${Math.floor(hours)} h: por dentro seguía húmeda y no curó bien (se va a lavar).`);
    } else {
      pen += 0.22;
      def.ghost += 0.35;
      def.patchy += 0.15;
      notes.push(`${NO}¡Pintura fresca bajo la plancha! Se corrió y quedó corrida/manchada. Hay que esperar 24 h.`);
    }
    // protección y vapor
    if (protector) notes.push(`${OK}Papel manteca encima: la plancha no tocó la pintura.`);
    else {
      pen += 0.08;
      def.scorch += 0.12;
      notes.push(`${NO}Sin papel protector: la pintura se pega a la plancha y queda con brillo. Siempre un papel o un paño encima.`);
    }
    if (!steam) notes.push(`${OK}Sin vapor, como pide el fijado (la humedad no ayuda acá).`);
    else {
      pen += 0.06;
      def.patchy += 0.1;
      notes.push(`${MID}Con vapor: la humedad lucha contra el fijado y quedan zonas más débiles. Para fijar, plancha seca.`);
    }
    // nivel
    if (level > maxLevel) {
      pen += 0.1;
      def.scorch += 0.3;
      notes.push(`${NO}Plancha en ${'•'.repeat(level)} para ${fabric.short}, que aguanta ${'•'.repeat(maxLevel)}: ${info.poly ? 'la fibra se derrite y brilla' : 'la tela se tuesta'}.`);
    } else if (level < 2 && maxLevel >= 2) {
      pen += 0.08;
      def.under += 0.2;
      notes.push(`${MID}Plancha en • (110 °C): no llega a los 150 °C que pide la pintura para fijar.`);
    } else notes.push(`${OK}Plancha en ${'•'.repeat(level)}: ${maxLevel <= 1 ? 'baja y con más tiempo, como pide una tela sintética' : 'temperatura suficiente sin dañar la tela'}.`);
    // cobertura del fijado
    const f = fixK();
    pen += (1 - f) * 0.45;
    def.under += (1 - f) * 0.8;
    if (f >= 0.97) notes.push(`${OK}Fijaste todo el dibujo de punta a punta (${Math.round(f * 100)}%).`);
    else notes.push(`${f >= 0.8 ? MID : NO}Fijado ${Math.round(f * 100)}%: lo que no recibió calor suficiente se va a ir en los lavados.`);
    if (scorches) {
      pen += Math.min(0.18, scorches * 0.06);
      def.scorch += Math.min(0.4, scorches * 0.15);
      notes.push(`${NO}Dejaste la plancha quieta y marcó la tela ${scorches > 1 ? `(${scorches} marcas)` : ''}: siempre en movimiento.`);
    }
    return { quality: clamp(1 - pen, 0.15, 1), defects: def, notes };
  }

  async function reveal() {
    if (finished || phase !== 'iron') return;
    finished = true;
    phase = 'reveal';
    pressing = false;
    setPhaseUI();
    ui.hint(null);
    heatMesh.visible = false;
    ironGoal.copy(board.restPoint);
    yaw = 0;
    iron.setSteam(false);
    const ev = evaluate();
    if (autoMode) ev.notes.unshift(`${MID}Fijado en automático por el taller: la próxima planchalo vos (y sin vapor) para sumar más puntos.`);
    paper.userData.leave = 0.001;
    await kit.wait(500);
    if (!ctx.alive) return;
    const result = await kit.process(ev.quality, ev.defects);
    if (!ctx.alive) return;
    shirt.setPrint(side, result, placement);
    audio.play(ev.quality >= 0.7 ? 'good' : 'bad');
    const settings = { hours: Math.floor(hours), protector, steam, level, fixed: Math.round(fixK() * 100) / 100, scorches };
    const tags = [`secado ${Math.floor(hours)} h`, `plancha ${'•'.repeat(level)}`, protector ? 'con papel' : 'sin papel', steam ? 'con vapor' : 'sin vapor', `fijado ${Math.round(fixK() * 100)}%`];
    await kit.finish({ quality: ev.quality, defects: ev.defects, notes: ev.notes, result, settings, tags });
  }

  // ---------------- automático ----------------
  async function autoRun() {
    if (busy || finished) return;
    busy = true;
    autoMode = true;
    ui.setActions([]);
    ui.hint('El taller fija la pintura por vos…');
    if (phase === 'dry') {
      hours = Math.max(hours, 24);
      await kit.wait(300);
      toSetup();
    }
    if (phase === 'setup') {
      level = clamp(maxLevel, 1, 3);
      levelSeg.setValue(String(level));
      iron.setLevel(level);
      ironT = LEVELS.find((l) => l.level === level)?.temp || 150;
      await kit.wait(300);
      toIron();
    }
    // pasadas en zigzag sobre el dibujo (rápidas: deja algo sin fijar)
    kit.timeScale = 2.5;
    autoPress = true;
    const rows = 4;
    rowsLoop: for (let r = 0; r < rows && ctx.alive && !finished; r++) {
      for (let s = 0; s <= 10 && ctx.alive && !finished; s++) {
        if (fixK() > 0.7) break rowsLoop;
        const u = r % 2 ? 1 - s / 10 : s / 10;
        const p = map(0.08 + u * 0.84, 0.88 - (r / (rows - 1)) * 0.76);
        const wp = surfacePoint(shirt, side, p.x, p.y, 0).p;
        ironGoal.set(wp.x, shirtTop(), wp.z);
        // por frames (no por reloj): el resultado no depende de los fps
        await untilFrame(ctx, () => false, 0.11);
      }
    }
    autoPress = false;
    kit.timeScale = 1;
    if (ctx.alive && !finished) await reveal();
  }
  let autoPress = false;

  // ---------------- entrada ----------------
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ptr = () => {
    plane.constant = -shirtTop();
    return engine.pointerOnPlane(plane);
  };
  const nearShirt = (p) => p && Math.abs(p.x - P0.x) < 0.45 && Math.abs(p.z - P0.z) < 0.4;
  // ¿el puntero está sobre el dibujo? (raycast solo a los paneles de tela: el papel protector y
  // el mapa de calor también cuelgan de la remera y, aunque estén ocultos, taparían el rayo)
  const hitPrint = () => {
    const r = garmentHit(engine, shirt);
    if (!r || r.g.side !== side) return false;
    const a = (-(placement.rotation || 0) * Math.PI) / 180;
    const dx = r.g.viewX - placement.x;
    const dy = r.g.y - placement.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) < W / 2 + 0.01 && Math.abs(ly) < H / 2 + 0.01;
  };
  const hoverPrint = throttle(() => (engine.canvas.style.cursor = hitPrint() ? 'pointer' : ''), 90);
  ctx.onPointer('down', (e) => {
    if (finished || busy || e.button > 0) return;
    if (phase === 'dry') {
      if (hitPrint()) touchPaint();
      return;
    }
    if (phase !== 'iron') return;
    const p = ptr();
    if (!nearShirt(p)) return;
    ironGoal.set(p.x, shirtTop(), p.z);
    if (e.pointerType === 'touch') ironPos.set(p.x, ironPos.y, p.z);
    pressing = true;
    pointerIn = true;
  });
  ctx.onPointer('move', (e) => {
    if (finished) return;
    if (phase === 'dry') {
      hoverPrint();
      return;
    }
    if (phase !== 'iron') return;
    const p = ptr();
    pointerIn = nearShirt(p);
    if (pointerIn) ironGoal.set(p.x, shirtTop(), p.z);
    engine.canvas.style.cursor = pointerIn ? 'none' : '';
  });
  ctx.onPointer('up', () => {
    pressing = false;
  });
  ctx.listen(window, 'keydown', (e) => {
    const codes = phase === 'dry' || phase === 'iron' ? ['Space', 'Enter'] : phase === 'setup' ? ['Enter'] : [];
    if (finished || !gameKey(e, codes)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (phase === 'dry') ffwd = true;
      else if (phase === 'iron') keyPress = true;
    } else if (e.code === 'Enter') {
      if (phase === 'dry') toSetup();
      else if (phase === 'setup') toIron();
    }
  });
  ctx.listen(window, 'keyup', (e) => {
    if (e.code === 'Space') {
      ffwd = false;
      keyPress = false;
    }
  });
  ctx.listen(window, 'blur', () => {
    ffwd = false;
    keyPress = false;
    pressing = false;
  });

  // ---------------- bucle ----------------
  const prev = new THREE.Vector3();
  const local = new THREE.Vector3();
  ctx.onUpdate((dt0) => {
    const dt = dt0 * kit.timeScale;
    simT += dt;
    if (drop > 0) {
      drop = Math.max(0, drop - dt0 * 2.6);
      shirt.group.position.y = restPos.y + 0.16 * drop * drop;
      if (drop === 0) audio.play('thud');
    }
    // secado
    if (phase === 'dry') {
      const rate = ffwd ? 4.5 : 0.04; // horas por segundo real
      hours += dt * rate;
      const st = Math.min(4, Math.floor((hours / 24) * 4));
      if (st > wetStep) {
        wetStep = st;
        shirt.setPrint(side, wetLook(st / 4), placement);
      }
    }
    // plancha: temperatura
    const target = phase === 'setup' || phase === 'iron' ? LEVELS.find((l) => l.level === level)?.temp || 150 : ROOM;
    if (ironT < target) ironT = Math.min(target, ironT + dt * 45);
    else ironT = Math.max(target, ironT - dt * 20);
    iron.setHot(clamp((ironT - 60) / 170));
    iron.setSteam(steam && (phase === 'setup' || phase === 'iron') && level > 0);
    // plancha: movimiento
    if (ironActive) {
      const press = phase === 'iron' && (pressing || keyPress || autoPress) && (pointerIn || keyPress || autoPress);
      prev.copy(ironPos);
      const k = 1 - Math.exp(-dt0 * (phase === 'iron' ? 16 : 5));
      ironPos.x += (ironGoal.x - ironPos.x) * k;
      ironPos.z += (ironGoal.z - ironPos.z) * k;
      const gy = phase === 'iron' ? (press ? shirtTop() : shirtTop() + 0.035) : ironGoal.y;
      ironPos.y += (gy - ironPos.y) * (1 - Math.exp(-dt0 * (press ? 26 : 10)));
      const vx = (ironPos.x - prev.x) / Math.max(1e-4, dt0);
      const vz = (ironPos.z - prev.z) / Math.max(1e-4, dt0);
      const sp = Math.hypot(vx, vz);
      if (sp > 0.08 && phase === 'iron') {
        let a = Math.atan2(-vz, vx);
        if (Math.abs(((a - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI / 2) a += Math.PI;
        const d = ((a - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        yaw += d * (1 - Math.exp(-dt0 * 6));
      }
      iron.group.position.copy(ironPos);
      iron.group.rotation.set(0, yaw, 0);
      // contacto: fijado por celda
      const contact = press && Math.abs(ironPos.y - shirtTop()) < 0.004;
      if (contact) {
        contactTime += dt;
        const rate = (ironT / 150) * ACCEL * dt;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        let any = false;
        for (const cell of cells) {
          if (!cell.wp) continue;
          local.set(cell.wp.x - ironPos.x, 0, cell.wp.z - ironPos.z);
          const lx = local.x * c - local.z * s;
          const lz = local.x * s + local.z * c;
          if ((lx / 0.12) ** 2 + (lz / 0.055) ** 2 <= 1) {
            cell.dose += rate;
            any = true;
          }
        }
        if (any && Math.random() < dt0 * 4) drawHeat();
        // quieta y demasiado caliente → marca
        if (sp < 0.02) stillT += dt0;
        else stillT = Math.max(0, stillT - dt0 * 2);
        if (stillT > 1.6 && level > maxLevel) {
          stillT = 0;
          scorches++;
          const gx = garmentX(side, placement.x + (ironPos.z - P0.z));
          const gyv = placement.y + (ironPos.x - P0.x);
          shirt.addScorch(side, gx, gyv, 0.05, 0.8, info.poly ? 'melt' : 'scorch');
          audio.play('bad');
          if (!autoMode) ui.toast('¡Quieta y muy caliente! Marcó la tela.', 'bad', 2200);
        }
        if (Math.random() < dt0 * 1.5) audio.play('steam');
      } else stillT = 0;
      if (phase === 'iron' && !finished && fixK() >= 0.985) reveal();
    }
    if (paper.userData.leave > 0) {
      paper.userData.leave += dt0 * 1.8;
      const k = paper.userData.leave;
      paper.position.set(0, 0.06 * k, 0);
      paper.material.opacity = 0.72 * (1 - clamp(k));
      if (k >= 1) paper.visible = false;
    }
    refreshHud();
  });

  // ---------------- ganchos de prueba ----------------
  Object.defineProperty(kit.test, 'phase', { get: () => phase, configurable: true, enumerable: true });
  Object.assign(kit.test, {
    info: () => ({ phase, hours: Math.round(hours * 10) / 10, level, maxLevel, protector, steam, ironT: Math.round(ironT), fix: Math.round(fixK() * 100) / 100, scorches, iron: ironPos.toArray().map((v) => +v.toFixed(3)) }),
    ff: (hh) => (hours = hh),
    toSetup,
    set: ({ level: l, protector: p, steam: s }) => {
      if (l != null) {
        level = l;
        levelSeg.setValue(String(l));
        iron.setLevel(l);
      }
      if (p != null) {
        protector = p;
        protToggle.input.checked = p;
        paper.visible = p;
      }
      if (s != null) {
        steam = s;
        steamToggle.input.checked = s;
      }
      refreshSetup();
    },
    toIron,
    heat: () => (ironT = LEVELS.find((l) => l.level === level)?.temp || 150),
    printScreen: () => {
      const pts = [];
      for (const v of [0.15, 0.5, 0.85]) {
        for (const u of [0.1, 0.5, 0.9]) {
          const p = map(u, v);
          const wp = surfacePoint(shirt, side, p.x, p.y, 0).p;
          const s2 = engine.worldToScreen(wp);
          pts.push([Math.round(s2.x), Math.round(s2.y)]);
        }
      }
      return pts;
    },
    done: reveal,
    auto: autoRun,
    fast: (k) => (kit.timeScale = k),
  });

  refreshSetup();
  setPhaseUI();
  refreshHud();
}
