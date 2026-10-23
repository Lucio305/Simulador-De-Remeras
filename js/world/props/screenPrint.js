// Serigrafía: pulpo de mesa de un brazo (base, platina con adhesivo, bisagra con
// prensa-marco), shablón de aluminio con malla y emulsión (setFrameDown), tinta sobre la
// malla (setInkColor), racleta con mango de madera, potes de tinta y secador flash de pie.

import { THREE, Batch, std, phys, mesh, V3, chrome, rubber, blackPaint, darkPlastic, place, damp, lathe, woodMaterial, DEG, tube, vc } from './common.js';
import { drawTexture, canvasTexture, softSprite } from './textures.js';
import { makeCanvas, clamp } from '../../core/utils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FRAME_W = 0.44; // marco exterior (x)
const FRAME_D = 0.54; // marco exterior (z)
const PROFILE = 0.03;
const PLATEN_TOP = 0.092;
const UP_ANGLE = 72 * DEG;

// Malla con emulsión: alfa alto en la emulsión, baja en las zonas abiertas del diseño.
function drawStencil(canvas, design = null) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(40,96,140,0.93)';
  ctx.fillRect(0, 0, w, h);
  // borde de cinta de enmascarar
  ctx.fillStyle = 'rgba(214,196,150,1)';
  ctx.fillRect(0, 0, w, h * 0.06);
  ctx.fillRect(0, h * 0.94, w, h * 0.06);
  ctx.fillRect(0, 0, w * 0.07, h);
  ctx.fillRect(w * 0.93, 0, w * 0.07, h);
  // zona abierta (se ve la malla amarilla, semitransparente)
  const ox = w * 0.2;
  const oy = h * 0.22;
  const ow = w * 0.6;
  const oh = h * 0.5;
  const mask = makeCanvas(w, h);
  const m = mask.getContext('2d');
  if (design) {
    const k = Math.min(ow / design.width, oh / design.height);
    const dw = design.width * k;
    const dh = design.height * k;
    m.drawImage(design, ox + (ow - dw) / 2, oy + (oh - dh) / 2, dw, dh);
  } else {
    // diseño genérico: un sol y la palabra TALLER
    m.fillStyle = '#000';
    m.beginPath();
    m.arc(w / 2, oy + oh * 0.36, oh * 0.24, 0, Math.PI * 2);
    m.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.save();
      m.translate(w / 2 + Math.cos(a) * oh * 0.33, oy + oh * 0.36 + Math.sin(a) * oh * 0.33);
      m.rotate(a);
      m.fillRect(-oh * 0.05, -oh * 0.015, oh * 0.1, oh * 0.03);
      m.restore();
    }
    m.font = `900 ${Math.round(oh * 0.24)}px Georgia, serif`;
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    m.fillText('TALLER', w / 2, oy + oh * 0.86);
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = 'rgba(236,214,120,0.38)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

function meshNormalTexture() {
  return drawTexture(
    64,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = 'rgb(128,128,255)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(160,128,255,0.6)';
      for (let i = 0; i < w; i += 4) ctx.fillRect(i, 0, 1, h);
      ctx.fillStyle = 'rgba(128,160,255,0.6)';
      for (let j = 0; j < h; j += 4) ctx.fillRect(0, j, w, 1);
    },
    { key: 'malla-normal', srgb: false },
  );
}

function tubLabelAtlas(tubs) {
  return drawTexture(
    1024,
    96,
    (ctx, W, h) => {
      const w = W / tubs.length;
      tubs.forEach(([color, name], i) => {
        ctx.save();
        ctx.translate(i * w, 0);
        ctx.fillStyle = '#f4f1ea';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = color;
        ctx.fillRect(0, h * 0.62, w, h * 0.38);
        ctx.fillStyle = '#2b2420';
        ctx.font = '800 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PLASTISOL', w / 2, h * 0.33);
        ctx.font = '600 20px sans-serif';
        ctx.fillStyle = color === '#f3f1ea' ? '#2b2420' : '#fff';
        ctx.fillText(name, w / 2, h * 0.84);
        ctx.restore();
      });
    },
    { key: 'potes-atlas' },
  );
}

// Potes de tinta plastisol (para la repisa de la mesa).
export function addInkTubs(b, { x, y, z, spacing = 0.12 }) {
  const tubs = [
    ['#c42b2b', 'ROJO'],
    ['#1e1e21', 'NEGRO'],
    ['#f3f1ea', 'BLANCO'],
    ['#2f5cb6', 'AZUL'],
  ];
  const body = std('pote-plastico', { color: '#f4f1ea', roughness: 0.4 });
  tubs.forEach(([c, n], i) => {
    const g = lathe([[0, 0], [0.048, 0], [0.052, 0.085], [0, 0.085]], 24);
    b.add(g, body, { p: [x + i * spacing, y, z], cast: true, uv: 'keep' });
    g.dispose();
    b.cyl(0.055, 0.055, 0.016, vc('plastico'), { color: c, p: [x + i * spacing, y + 0.093, z], seg: 24 });
    // etiqueta: las cuatro comparten un atlas (cada una ocupa un cuarto en u)
    const lbl = new THREE.CylinderGeometry(0.0505, 0.0485, 0.05, 24, 1, true, -Math.PI / 2, Math.PI);
    const luv = lbl.attributes.uv;
    for (let k = 0; k < luv.count; k++) luv.setX(k, (i + luv.getX(k)) / 4);
    b.add(lbl, std('pote-etiquetas', { map: tubLabelAtlas(tubs), roughness: 0.6 }), { p: [x + i * spacing, y + 0.045, z], uv: 'keep' });
    lbl.dispose();
  });
}

// Racleta: origen = centro del filo de goma (apoyado), largo a lo largo de X, mango arriba.
export function createSqueegee({ length = 0.28 } = {}) {
  const group = new THREE.Group();
  group.name = 'racleta';
  const blade = std('racleta-goma', { color: '#3f9a6c', roughness: 0.6 });
  group.add(mesh(new THREE.BoxGeometry(length, 0.045, 0.009), blade, { p: [0, 0.0225, 0], cast: true }));
  group.add(mesh(new THREE.BoxGeometry(length + 0.004, 0.02, 0.016), std('racleta-perfil', { color: '#b9bec3', roughness: 0.35, metalness: 0.9 }), { p: [0, 0.052, 0] }));
  const wood = woodMaterial('haya', { key: '-racleta' });
  const handle = new THREE.CylinderGeometry(0.016, 0.016, length + 0.04, 20);
  handle.rotateZ(Math.PI / 2);
  handle.scale(1, 1.3, 0.75);
  const hm = mesh(handle, wood, { p: [0, 0.08, 0], cast: true });
  // uv en metros para la veta
  const uv = hm.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * (length + 0.04), uv.getX(i) * 0.1);
  group.add(hm);
  return group;
}

export function createScreenPrint({ position, topY, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'serigrafia';
  group.position.set(position[0], topY, position[1]);
  group.rotation.y = ry;
  const b = new Batch();
  const alu = std('aluminio-anodizado', { color: '#b6bbc1', roughness: 0.38, metalness: 0.85 });
  const dark = blackPaint();
  // base, poste y platina (con adhesivo gris)
  b.box(0.42, 0.02, 0.64, dark, { p: [0, 0.01, -0.04], radius: 0.004, seg: 1, cast: true });
  b.box(0.06, 0.05, 0.06, dark, { p: [0, 0.045, 0.05], radius: 0.004, seg: 1 });
  b.box(0.33, 0.018, 0.42, woodMaterial('pino', { color: '#d7c2a5', key: '-platina' }), { p: [0, PLATEN_TOP - 0.012, 0.05], radius: 0.003, seg: 1, cast: true });
  b.box(0.325, 0.003, 0.415, std('adhesivo-platina', { color: '#9a9ea2', roughness: 0.55 }), { p: [0, PLATEN_TOP - 0.0015, 0.05], radius: 0.001, seg: 1 });
  // bisagra trasera
  b.box(0.3, 0.06, 0.06, dark, { p: [0, 0.05, -0.29], radius: 0.006, seg: 1, cast: true });
  for (const sx of [-1, 1]) b.box(0.03, 0.08, 0.04, alu, { p: [sx * 0.13, 0.1, -0.27], radius: 0.004, seg: 1 });
  b.cyl(0.008, 0.008, 0.32, chrome(), { p: [0, 0.125, -0.26], r: [0, 0, Math.PI / 2], seg: 10 });
  b.flush(group, 'serigrafia');

  // marco con malla (pivota en la bisagra)
  const pivot = new THREE.Group();
  place(pivot, [0, 0.125, -0.26]);
  group.add(pivot);
  const frame = new THREE.Group();
  pivot.add(frame);
  const zMid = 0.05 + 0.26; // centro del marco relativo al pivote (sobre la platina)
  const yFrame = PLATEN_TOP + 0.003 + PROFILE / 2 - 0.125;
  const rail = (w, d, x, z) => frame.add(mesh(new THREE.BoxGeometry(w, PROFILE, d), alu, { p: [x, yFrame, z], cast: true }));
  rail(FRAME_W, PROFILE, 0, zMid - FRAME_D / 2 + PROFILE / 2);
  rail(FRAME_W, PROFILE, 0, zMid + FRAME_D / 2 - PROFILE / 2);
  rail(PROFILE, FRAME_D - PROFILE * 2, -FRAME_W / 2 + PROFILE / 2, zMid);
  rail(PROFILE, FRAME_D - PROFILE * 2, FRAME_W / 2 - PROFILE / 2, zMid);
  // brazo que sujeta el marco a la bisagra
  frame.add(mesh(new THREE.BoxGeometry(0.24, 0.02, 0.08), alu, { p: [0, 0.0, 0.03] }));
  frame.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), dark, { p: [-0.09, 0.012, zMid - FRAME_D / 2 + 0.02] }));
  frame.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), dark, { p: [0.09, 0.012, zMid - FRAME_D / 2 + 0.02] }));
  // malla
  const stencilCanvas = makeCanvas(512, 640);
  drawStencil(stencilCanvas);
  const stencilTex = canvasTexture(stencilCanvas, { wrap: false });
  const meshNor = meshNormalTexture().clone();
  meshNor.wrapS = meshNor.wrapT = THREE.RepeatWrapping;
  meshNor.repeat.set(40, 50);
  meshNor.needsUpdate = true;
  const meshMat = new THREE.MeshStandardMaterial({
    map: stencilTex,
    normalMap: meshNor,
    normalScale: new THREE.Vector2(0.4, 0.4),
    transparent: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const innerW = FRAME_W - PROFILE * 2;
  const innerD = FRAME_D - PROFILE * 2;
  const screen = mesh(new THREE.PlaneGeometry(innerW, innerD), meshMat, { r: [-Math.PI / 2, 0, 0], p: [0, yFrame - PROFILE / 2 + 0.002, zMid], name: 'malla', receive: false });
  screen.renderOrder = 3;
  frame.add(screen);
  // charco de tinta sobre la malla, del lado de la bisagra
  const inkMat = phys('tinta-serigrafia', { color: '#c42b2b', roughness: 0.25, clearcoat: 0.6 });
  const ink = mesh(new THREE.CapsuleGeometry(0.012, 0.22, 6, 12).rotateZ(Math.PI / 2), inkMat, { p: [0, yFrame - PROFILE / 2 + 0.006, zMid - innerD / 2 + 0.06], s: [1, 0.35, 1.4], receive: false });
  frame.add(ink);

  let down = 1;
  let target = 1;
  const frameCenter = V3();
  const computeCenter = () => {
    group.updateWorldMatrix(true, false);
    frameCenter.copy(group.localToWorld(V3(0, PLATEN_TOP + 0.004, 0.05)));
  };
  computeCenter();

  return {
    group,
    frameCenter,
    frameSize: [innerW, innerD],
    // ventana donde drawStencil dibuja el diseño: fracciones del área interna (v desde la bisagra)
    stencilWindow: { u: 0.2, v: 0.22, w: 0.6, h: 0.5 },
    platenTopY: topY + PLATEN_TOP,
    squeegee: null, // lo asigna el taller
    setFrameDown(t) {
      target = clamp(t, 0, 1);
    },
    setInkColor(hex) {
      if (!hex) {
        ink.visible = false;
        return;
      }
      ink.visible = true;
      ink.material = phys(`tinta-${hex}`, { color: hex, roughness: 0.25, clearcoat: 0.6 });
    },
    // extra: dibuja el diseño como zona abierta de la emulsión (canvas con alfa) o null = genérico
    setStencil(canvas) {
      drawStencil(stencilCanvas, canvas || null);
      stencilTex.needsUpdate = true;
    },
    update(dt) {
      down = damp(down, target, 6, dt);
      pivot.rotation.x = -(1 - down) * UP_ANGLE;
    },
  };
}

// Secador flash de pie: trípode con ruedas, caño, brazo giratorio y cabezal con
// resistencias que se ponen al rojo (setOn). setSwing(t): 0 = a un costado, 1 = sobre `over`.
export function createFlashDryer({ position, over = null, headY = 1.12, asideAngle = 0 }) {
  const group = new THREE.Group();
  group.name = 'secador-flash';
  group.position.set(position[0], 0, position[1]);
  const b = new Batch();
  const dark = blackPaint();
  // trípode con ruedas
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const foot = V3(Math.cos(a) * 0.26, 0.05, Math.sin(a) * 0.26);
    const t = tube([V3(0, 0.12, 0), foot], 0.012, { tubular: 2, radial: 8 });
    b.add(t, dark, { uv: 'keep', cast: true });
    t.dispose();
    b.cyl(0.022, 0.022, 0.018, rubber(), { p: [foot.x, 0.022, foot.z], r: [Math.PI / 2, a, 0], seg: 14 });
    b.box(0.02, 0.03, 0.02, chrome(), { p: [foot.x, 0.045, foot.z] });
  }
  const poleTop = headY + 0.05;
  b.cyl(0.018, 0.018, 0.7, dark, { p: [0, 0.12 + 0.35, 0], seg: 12, cast: true });
  b.cyl(0.013, 0.013, poleTop - 0.75, chrome(), { p: [0, 0.75 + (poleTop - 0.75) / 2, 0], seg: 12, cast: true });
  b.cyl(0.024, 0.024, 0.04, dark, { p: [0, 0.8, 0], seg: 14 });
  b.flush(group, 'flash');

  // brazo + cabezal (gira alrededor del caño)
  const swing = new THREE.Group();
  swing.position.y = poleTop;
  group.add(swing);
  let armLen = 0.6;
  let overAngle = 0;
  if (over) {
    const dx = over[0] - position[0];
    const dz = over[2] - position[1];
    armLen = Math.hypot(dx, dz);
    overAngle = Math.atan2(-dz, dx); // ángulo alrededor de Y para apuntar +X al punto
  }
  const arm = mesh(new THREE.BoxGeometry(armLen, 0.03, 0.03), dark, { p: [armLen / 2, 0, 0], cast: true });
  swing.add(arm);
  const head = new THREE.Group();
  head.position.set(armLen, -0.05, 0);
  swing.add(head);
  head.add(mesh(new THREE.BoxGeometry(0.4, 0.07, 0.4), std('flash-carcasa', { color: '#2a2b2e', roughness: 0.45, metalness: 0.4 }), { p: [0, 0.0, 0], cast: true }));
  head.add(mesh(new THREE.BoxGeometry(0.36, 0.012, 0.36), dark, { p: [0, -0.04, 0] }));
  const coilMat = new THREE.MeshStandardMaterial({ color: '#5a2a1e', emissive: '#ff3c12', emissiveIntensity: 0, roughness: 0.5 });
  const coils = [];
  for (let i = 0; i < 7; i++) coils.push(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 8).rotateZ(Math.PI / 2).translate(0, -0.048, -0.15 + i * 0.05));
  head.add(mesh(mergeGeometries(coils), coilMat, { name: 'resistencias' }));
  // rejilla
  const grill = [new THREE.BoxGeometry(0.36, 0.004, 0.004).translate(0, -0.056, 0)];
  for (let i = 0; i < 5; i++) grill.push(new THREE.BoxGeometry(0.004, 0.004, 0.36).translate(-0.16 + i * 0.08, -0.056, 0));
  head.add(mesh(mergeGeometries(grill), chrome(), { name: 'rejilla' }));
  // brillo rojo debajo (aditivo)
  const glow = mesh(
    new THREE.PlaneGeometry(0.7, 0.7),
    new THREE.MeshBasicMaterial({ map: softSprite('rojo', 'rgba(255,90,40,1)', 'rgba(255,90,40,0)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    { r: [-Math.PI / 2, 0, 0], p: [0, -0.07, 0], receive: false },
  );
  glow.renderOrder = 8;
  head.add(glow);
  // perilla y luz
  head.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 14).rotateX(Math.PI / 2), darkPlastic(), { p: [0.12, 0.0, 0.205] }));
  const ledMat = new THREE.MeshStandardMaterial({ color: '#401010', emissive: '#ff2a10', emissiveIntensity: 0 });
  head.add(mesh(new THREE.SphereGeometry(0.005, 8, 6), ledMat, { p: [0.08, 0.01, 0.202] }));
  // cable
  const cable = tube([V3(0, poleTop - 0.05, 0.015), V3(0.02, 0.6, 0.03), V3(0.04, 0.05, 0.08), V3(-0.2, 0.01, -0.25)], 0.004, { tubular: 30, radial: 5 });
  group.add(mesh(cable, rubber()));

  let on = false;
  let heat = 0;
  let sw = 0;
  let swTarget = 0;
  const api = {
    group,
    setOn(v) {
      on = !!v;
    },
    setSwing(t) {
      swTarget = clamp(t, 0, 1);
    },
    update(dt, t) {
      heat = damp(heat, on ? 1 : 0, on ? 1.4 : 0.8, dt);
      coilMat.emissiveIntensity = heat * (2.4 + Math.sin(t * 9) * 0.08);
      glow.material.opacity = heat * 0.5;
      ledMat.emissiveIntensity = on ? 2 : 0;
      sw = damp(sw, swTarget, 3, dt);
      swing.rotation.y = asideAngle + (overAngle - asideAngle) * sw;
    },
  };
  swing.rotation.y = asideAngle;
  return api;
}
