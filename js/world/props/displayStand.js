// Exhibición: tarima redonda, pie cromado y cuello de maniquí invisible (la remera cuelga
// con el centro del cuello en neckAnchor), riel de spots en el techo que se encienden en
// modo exhibición, y el kit de etiquetas y packaging en una mesita al lado.

import { THREE, Batch, std, mesh, V3, lathe, chrome, woodMaterial, place, damp, DEG, PALETTE, tube } from './common.js';
import { drawTexture, cardboardTextures, softSprite } from './textures.js';
import { cardboard } from './furniture.js';
import { ribbonGeometry } from './cuttingTools.js';
import { getFabricMaterial } from '../../materials/fabric.js';

export function createDisplayStand({ base, neck }) {
  const group = new THREE.Group();
  group.name = 'exhibicion';
  group.position.set(base[0], 0, base[2]);
  const b = new Batch();
  const neckY = neck[1];
  // tarima: madera con canto oscuro y aro cromado
  const top = woodMaterial('nogal', { key: '-tarima' });
  const tg = lathe([[0, 0], [0.49, 0.0], [0.505, 0.02], [0.505, 0.13], [0.5, 0.135], [0, 0.135]], 64);
  b.add(tg, top, { uv: 'box', cast: true });
  tg.dispose();
  const trim = new THREE.TorusGeometry(0.505, 0.006, 8, 96);
  b.add(trim, chrome(), { p: [0, 0.112, 0], r: [Math.PI / 2, 0, 0] });
  trim.dispose();
  // base y caño cromado
  const foot = lathe([[0, 0.135], [0.15, 0.135], [0.155, 0.14], [0.14, 0.152], [0.03, 0.16], [0.018, 0.175], [0, 0.175]], 40);
  b.add(foot, chrome(), { cast: true });
  foot.dispose();
  const poleTop = neckY - 0.12;
  b.cyl(0.011, 0.011, poleTop - 0.17, chrome(), { p: [0, 0.17 + (poleTop - 0.17) / 2, 0], seg: 16, cast: true });
  // cuello "invisible": forma corta de terciopelo negro + tapa
  const neckMat = std('maniqui-terciopelo', { color: '#1d1c1f', roughness: 0.95 });
  const ng = lathe([[0.0, -0.14], [0.03, -0.14], [0.05, -0.1], [0.056, -0.06], [0.052, -0.02], [0.047, 0.02], [0.046, 0.05], [0.0, 0.052]], 32);
  ng.scale(1, 1, 0.85);
  b.add(ng, neckMat, { p: [0, neckY, 0], uv: 'keep', cast: true });
  ng.dispose();
  b.cyl(0.03, 0.03, 0.012, chrome(), { p: [0, neckY + 0.056, 0], seg: 24 });
  b.flush(group, 'tarima');

  // riel de spots en el techo (frente a la tarima) con 3 luces
  const rig = new THREE.Group();
  rig.name = 'spots';
  const railY = 3.08;
  const railZ = base[2] + 1.15;
  group.add(rig);
  const rb = new Batch();
  rb.box(2.2, 0.025, 0.035, std('riel-spots', { color: '#ece6da', roughness: 0.5 }), { p: [0, railY, railZ - base[2]], radius: 0.006, seg: 1 });
  for (const sx of [-1, 1]) rb.cyl(0.004, 0.004, 3.2 - railY, chrome(), { p: [sx * 0.9, railY + (3.2 - railY) / 2, railZ - base[2]], seg: 6 });
  rb.flush(rig, 'riel');
  const target = new THREE.Object3D();
  target.position.set(0, neckY - 0.3, 0);
  group.add(target);
  const spots = [];
  const lensMats = [];
  const defs = [
    { x: -0.75, z: railZ, color: '#fff2dc', I: 42, shadow: true },
    { x: 0.8, z: railZ, color: '#ffe9cf', I: 26, shadow: false },
    { x: 0.0, z: base[2] - 0.9, color: '#f2f5ff', I: 24, shadow: false, back: true },
  ];
  for (const d of defs) {
    const can = new THREE.Group();
    const pos = V3(d.x, d.back ? railY : railY - 0.06, d.z - base[2]);
    can.position.copy(pos);
    rig.add(can);
    const dir = target.position.clone().sub(pos).normalize();
    can.quaternion.setFromUnitVectors(V3(0, -1, 0), dir);
    can.add(mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.11, 20, 1, true), std('spot-lata', { color: '#efe9de', roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide }), { p: [0, 0.02, 0] }));
    can.add(mesh(new THREE.CircleGeometry(0.036, 20).rotateX(-Math.PI / 2), std('spot-lata', { color: '#efe9de' }), { p: [0, 0.075, 0] }));
    const lens = new THREE.MeshStandardMaterial({ color: '#333', emissive: d.color, emissiveIntensity: 0, roughness: 0.2 });
    lensMats.push(lens);
    can.add(mesh(new THREE.CircleGeometry(0.031, 20).rotateX(Math.PI / 2), lens, { p: [0, -0.033, 0] }));
    if (!d.back) can.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), chrome(), { p: [0, 0.12, 0] }));
    const L = new THREE.SpotLight(d.color, 0, 7, 24 * DEG, 0.7, 2);
    L.position.copy(pos);
    L.target = target;
    L.userData.on = d.I;
    if (d.shadow) {
      L.castShadow = true;
      L.shadow.mapSize.set(1024, 1024);
      L.shadow.bias = -0.0005;
      L.shadow.normalBias = 0.02;
      L.shadow.radius = 4;
      L.shadow.camera.near = 0.5;
      L.shadow.camera.far = 6;
      L.shadow.autoUpdate = false;
    }
    group.add(L);
    spots.push(L);
  }
  // halo de luz sobre la tarima (aditivo, solo en exhibición)
  const pool = mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshBasicMaterial({ map: softSprite('pool', 'rgba(255,236,205,1)', 'rgba(255,236,205,0)'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    { r: [-Math.PI / 2, 0, 0], p: [0, 0.137, 0], receive: false },
  );
  pool.renderOrder = 2;
  group.add(pool);

  let level = 0;
  let targetLevel = 0;
  return {
    group,
    neckAnchor: V3(neck[0], neckY, neck[2]),
    spots,
    setOn(on) {
      targetLevel = on ? 1 : 0;
      for (const s of spots) if (s.castShadow) s.shadow.autoUpdate = !!on;
    },
    get level() {
      return level;
    },
    update(dt) {
      if (level === targetLevel) return;
      level = damp(level, targetLevel, 3.5, dt);
      if (Math.abs(level - targetLevel) < 0.003) level = targetLevel;
      spots.forEach((s) => (s.intensity = s.userData.on * level));
      lensMats.forEach((m) => (m.emissiveIntensity = 3 * level));
      pool.material.opacity = 0.22 * level;
    },
  };
}

// ---------------------------------------------------------------------------
// Kit de etiquetas y packaging (mesita al lado de la exhibición)
// ---------------------------------------------------------------------------

function wovenLabelTexture() {
  return drawTexture(
    512,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = '#2b2420';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const x = i * (w / 4);
        ctx.fillStyle = '#efe6d6';
        ctx.font = 'italic 700 34px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('Taller', x + w / 8, h * 0.5);
        ctx.font = '600 14px sans-serif';
        ctx.fillText('HECHO A MANO', x + w / 8, h * 0.78);
        ctx.fillStyle = '#c49a48';
        ctx.fillRect(x + 4, 4, 2, h - 8);
      }
    },
    { key: 'etiqueta-tejida' },
  );
}

function hangTagTexture() {
  return drawTexture(
    128,
    224,
    (ctx, w, h) => {
      ctx.fillStyle = '#c9a26e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#efe6d6';
      ctx.beginPath();
      ctx.arc(w / 2, 22, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2420';
      ctx.font = 'italic 700 26px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Taller', w / 2, 90);
      ctx.font = '600 13px sans-serif';
      ctx.fillText('REMERAS', w / 2, 112);
      ctx.fillText('ARTESANALES', w / 2, 128);
      ctx.strokeStyle = '#2b2420';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 150);
      ctx.lineTo(w - 24, 150);
      ctx.stroke();
      ctx.font = '500 12px sans-serif';
      ctx.fillText('100% algodón', w / 2, 176);
    },
    { key: 'tarjeta-colgante' },
  );
}

export function createLabelKit({ position, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'kit-etiquetas';
  place(group, [position[0], 0, position[2]], [0, ry, 0]);
  const b = new Batch();
  const wood = woodMaterial('roble', { key: '-mesita' });
  const legs = woodMaterial('nogal', { key: '-mesita' });
  const H = 0.74;
  b.box(0.66, 0.03, 0.42, wood, { p: [0, H - 0.015, 0], radius: 0.006, seg: 2, cast: true, grain: 'x' });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = lathe([[0.0, 0], [0.014, 0], [0.02, H - 0.08], [0.022, H - 0.03], [0, H - 0.03]], 12);
      b.add(g, legs, { p: [sx * 0.28, 0, sz * 0.17], r: [sz * 0.05, 0, -sx * 0.05], uv: 'cyl', cyl: [0.02, H], cast: true });
      g.dispose();
    }
  }
  b.box(0.56, 0.06, 0.02, legs, { p: [0, H - 0.06, 0.17], grain: 'x' });
  const y = H;
  // rollo de etiquetas tejidas con tira desplegada
  const labelMat = std('etiqueta-tejida', { map: wovenLabelTexture(), roughness: 0.8, side: THREE.DoubleSide });
  b.cyl(0.035, 0.035, 0.03, std('rollo-etiquetas', { color: '#2b2420', roughness: 0.8 }), { p: [-0.22, y + 0.035, -0.08], r: [Math.PI / 2, 0, 0], seg: 24, cast: true });
  const strip = ribbonGeometry(new THREE.CatmullRomCurve3([V3(-0.22, y + 0.002, -0.045), V3(-0.18, y + 0.002, 0.02), V3(-0.12, y + 0.002, 0.06), V3(-0.03, y + 0.002, 0.08)]), 0.028, V3(0, 1, 0).cross(V3(1, 0, 0.3).normalize()).normalize(), 30);
  const su = strip.attributes.uv;
  for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) / 0.2, su.getY(i));
  b.add(strip, labelMat, { uv: 'keep' });
  strip.dispose();
  // tarjetas colgantes (hang tags) apiladas y una suelta con hilo
  const tagMat = std('tarjeta-colgante', { map: hangTagTexture(), roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(0.05, 0.0012, 0.088);
    b.add(g, tagMat, { p: [0.02 + i * 0.002, y + 0.0006 + i * 0.0013, -0.1 + i * 0.002], r: [0, 0.2 + i * 0.07, 0], uv: 'keep' });
    g.dispose();
  }
  // bolsa de papel kraft (abierta) con papel de seda y asas de cordón
  const kraft = std('bolsa-kraft', { color: '#f2dcc0', roughness: 0.9, map: cardboardTextures().map, side: THREE.DoubleSide });
  const bagM = new THREE.Matrix4().makeRotationY(-0.2).setPosition(0.2, y, -0.08);
  const bw = 0.2;
  const bh = 0.24;
  const bd = 0.1;
  const bagPart = (g, m, px, py, pz, rx = 0, rz = 0) => {
    const mm = new THREE.Matrix4().compose(V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), V3(1, 1, 1)).premultiply(bagM);
    b.add(g, m, { matrix: mm, uv: 'box', cast: true });
    g.dispose();
  };
  bagPart(new THREE.PlaneGeometry(bw, bh), kraft, 0, bh / 2, bd / 2);
  bagPart(new THREE.PlaneGeometry(bw, bh), kraft, 0, bh / 2, -bd / 2);
  bagPart(new THREE.PlaneGeometry(bd, bh).rotateY(Math.PI / 2), kraft, -bw / 2, bh / 2, 0);
  bagPart(new THREE.PlaneGeometry(bd, bh).rotateY(Math.PI / 2), kraft, bw / 2, bh / 2, 0);
  bagPart(new THREE.BoxGeometry(bw, 0.004, bd), kraft, 0, 0.002, 0);
  // fuelle lateral (pliegue)
  for (const sx of [-1, 1]) bagPart(new THREE.BoxGeometry(0.002, bh * 0.9, 0.002), std('bolsa-pliegue', { color: '#8c6a43', roughness: 0.9 }), sx * (bw / 2 + 0.001), bh * 0.47, 0);
  // papel de seda arrugado asomando
  const tissue = std('papel-seda', { color: '#f2cbd6', roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.13, 0.08, 6, 4);
    const pp = g.attributes.position;
    for (let k = 0; k < pp.count; k++) pp.setZ(k, Math.sin(pp.getX(k) * 60 + i) * 0.008 + Math.cos(pp.getY(k) * 50 + i * 2) * 0.006);
    g.computeVertexNormals();
    bagPart(g, tissue, (i - 1) * 0.03, bh + 0.012, (i - 1) * 0.022, -0.25 + i * 0.2, (i - 1) * 0.35);
  }
  // asas
  for (const sz of [-1, 1]) {
    const hg = tube([[-0.05, bh - 0.01, sz * (bd / 2 + 0.002)], [0, bh + 0.07, sz * (bd / 2 + 0.004)], [0.05, bh - 0.01, sz * (bd / 2 + 0.002)]], 0.0025, { tubular: 12, radial: 5 });
    bagPart(hg, std('cordon-asa', { color: '#2b2420', roughness: 0.8 }), 0, 0, 0);
  }
  // remera doblada lista para entregar con su faja
  const shirt = getFabricMaterial('algodon_peinado', '#8fd0b8', { side: THREE.FrontSide });
  b.box(0.24, 0.035, 0.18, shirt, { p: [0.05, y + 0.0175, 0.09], r: [0, 0.08, 0], radius: 0.012, seg: 3, cast: true });
  b.box(0.06, 0.037, 0.182, cardboard(), { p: [0.05, y + 0.0185, 0.09], r: [0, 0.08, 0] });
  // tijerita de hilos
  b.box(0.012, 0.004, 0.09, std('tijerita', { color: '#c8ccd0', roughness: 0.25, metalness: 1 }), { p: [-0.12, y + 0.002, 0.1], r: [0, 0.9, 0] });
  b.box(0.018, 0.006, 0.03, std('tijerita-mango', { color: PALETTE.terracotta, roughness: 0.4 }), { p: [-0.155, y + 0.003, 0.13], r: [0, 0.9, 0] });
  b.flush(group, 'kit-etiquetas');
  return { group, topY: y };
}
