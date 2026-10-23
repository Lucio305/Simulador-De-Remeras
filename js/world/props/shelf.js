// Estantería de materiales: un rollo de tela por cada tela del catálogo, acostado en su
// estante, con la etiqueta en el canto. setHighlight desenrolla un paño que cuelga por
// delante del estante (se ve la tela de cerca) y enciende la etiqueta.

import { THREE, Batch, std, mesh, woodMaterial, damp, PALETTE } from './common.js';
import { drawTexture } from './textures.js';
import { cardboard, foldedStack, cardboardBox } from './furniture.js';
import { getFabricMaterial } from '../../materials/fabric.js';
import { FABRICS } from '../../data/catalog.js';
import { mixHex } from '../../core/utils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Colores con los que arranca cada rollo (variados para que la estantería luzca).
export const ROLL_COLORS = {
  algodon_jersey: '#f3f1ea',
  algodon_peinado: '#93c6e6',
  pique: '#1f2a46',
  lino: '#e7dcc4',
  poliester: '#e5732b',
  modal: '#6a1f2c',
  mezcla: '#9b9a97',
};

// Anillos concéntricos de tela enrollada (gris, se tiñe con el color del material).
function rollEndTexture() {
  return drawTexture(
    256,
    256,
    (ctx, W) => {
      const c = W / 2;
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(0, 0, W, W);
      let r = 128;
      let k = 0;
      while (r > 20) {
        const shade = 190 + ((k * 37) % 50);
        ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(c + Math.sin(k) * 0.6, c, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(60,60,60,0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(c, c, r - 1.4, 0, Math.PI * 2);
        ctx.stroke();
        r -= 2.6;
        k++;
      }
    },
    { key: 'rollo-canto' },
  );
}

function labelTexture(fabric, highlighted) {
  return drawTexture(
    384,
    112,
    (ctx, W, H) => {
      ctx.fillStyle = highlighted ? '#fff4d6' : '#ecdcbc';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = highlighted ? PALETTE.terracotta : '#a68a63';
      ctx.lineWidth = highlighted ? 8 : 4;
      ctx.strokeRect(4, 4, W - 8, H - 8);
      ctx.fillStyle = '#2b2420';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let s = 40;
      ctx.font = `700 ${s}px Georgia, serif`;
      while (ctx.measureText(fabric.short).width > W - 36 && s > 18) ctx.font = `700 ${--s}px Georgia, serif`;
      ctx.fillText(fabric.short, 18, H * 0.38);
      ctx.font = '500 26px sans-serif';
      ctx.fillStyle = '#5a4a3a';
      ctx.fillText(`${fabric.gsm} g/m² · ${fabric.knit ? 'punto' : 'plano'}`, 18, H * 0.76);
    },
    { key: `etiqueta-rollo-${fabric.id}-${highlighted ? 'on' : 'off'}` },
  );
}

// Malla del paño colgante (perfil 2D en YZ extruido a lo largo de X). uv en metros.
function buildDrape(geo, { len, width, r, edgeZ, edgeY, amount, t }) {
  // paño corto: muestra la tela sobre el canto sin tapar el rollo del estante de abajo
  const hang = 0.075 * amount;
  const pts = [];
  // del frente del rollo al canto del estante y luego cae
  const a0 = -0.35;
  pts.push(new THREE.Vector2(r * Math.cos(a0) + 0.001, r * Math.sin(a0)));
  pts.push(new THREE.Vector2(edgeZ - 0.004, edgeY + 0.004));
  pts.push(new THREE.Vector2(edgeZ + 0.006, edgeY - 0.004));
  pts.push(new THREE.Vector2(edgeZ + 0.01, edgeY - 0.02));
  const n = 8;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    pts.push(new THREE.Vector2(edgeZ + 0.012 + k * k * 0.02, edgeY - 0.02 - hang * k));
  }
  const curve = new THREE.SplineCurve(pts);
  const N = 22;
  const prof = curve.getSpacedPoints(N);
  const lens = [0];
  for (let i = 1; i < prof.length; i++) lens.push(lens[i - 1] + prof[i].distanceTo(prof[i - 1]));
  const total = lens[lens.length - 1];
  const M = 24;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let j = 0; j <= M; j++) {
    const x = -width / 2 + (width * j) / M;
    for (let i = 0; i <= N; i++) {
      const s = lens[i] / total;
      // ondas de caída que crecen hacia el ruedo del paño
      const wave = Math.sin(x * 14 + t * 0.8) * 0.012 * s * s + Math.sin(x * 31) * 0.004 * s;
      const k = j * (N + 1) + i;
      pos.setXYZ(k, x, prof[i].y, prof[i].x + wave);
      uv.setXY(k, x, lens[i] + len);
    }
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

function makeDrapeGeometry() {
  const N = 22;
  const M = 24;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * (M + 1) * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((N + 1) * (M + 1) * 2), 2));
  const idx = [];
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = (j + 1) * (N + 1) + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geo.setIndex(idx);
  return geo;
}

export function createShelf({ anchor }) {
  const group = new THREE.Group();
  group.name = 'estanteria-telas';
  const W = 1.5;
  const D = 0.46;
  const H = 2.0;
  // la estantería queda contra la pared; los rollos centrados cerca de anchor.z
  const zBack = -3.18;
  const cz = zBack + D / 2;
  group.position.set(anchor[0], 0, cz);
  const b = new Batch();
  const wood = woodMaterial('roble', { key: '-estanteria' });
  const backMat = std('fondo-estanteria', { color: '#b9cfc3', roughness: 0.8 });
  const t = 0.028;
  // laterales, fondo, techo
  for (const sx of [-1, 1]) b.box(t, H, D, wood, { p: [sx * (W / 2 - t / 2), H / 2, 0], grain: 'y', cast: true });
  b.box(W - t * 2, H, 0.01, backMat, { p: [0, H / 2, -D / 2 + 0.005] });
  b.box(W + 0.03, 0.03, D + 0.02, wood, { p: [0, H + 0.015, 0.005], grain: 'x', cast: true, radius: 0.006, seg: 2 });
  b.box(W - t * 2, 0.08, 0.02, wood, { p: [0, 0.04, D / 2 - 0.02], grain: 'x' });

  const levels = FABRICS.length;
  const pitch = 0.262;
  const y0 = 0.1;
  const boardT = 0.022;
  const innerW = W - t * 2;
  const edgeZ = D / 2 - 0.005; // canto del estante (local del grupo)
  const rolls = [];
  const endTex = rollEndTexture();
  const coreMat = cardboard();
  const coreInner = std('carton-interior', { color: '#5a4430', roughness: 1, side: THREE.BackSide });
  const rollLen = 1.2;
  const rollX = innerW / 2 - rollLen / 2 - 0.04; // corrido a la derecha: etiqueta a la izquierda

  for (let i = 0; i < levels; i++) {
    const yb = y0 + (levels - 1 - i) * pitch; // la primera tela arriba
    b.box(innerW, boardT, D - 0.012, wood, { p: [0, yb - boardT / 2, 0.006], grain: 'x' });
    b.box(innerW, 0.035, 0.012, wood, { p: [0, yb - 0.0175, D / 2 - 0.006], grain: 'x' });

    const fab = FABRICS[i];
    const r = 0.06 + (fab.gsm / 1000) * 0.2;
    const rg = new THREE.Group();
    rg.name = `rollo-${fab.id}`;
    const zc = edgeZ - 0.025 - r;
    rg.position.set(rollX, yb + r, zc);
    group.add(rg);

    // cuerpo: uv en metros (u = a lo largo del eje, v = alrededor)
    const body = new THREE.CylinderGeometry(r, r, rollLen, 56, 1, true);
    const uvA = body.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getY(k) * rollLen, uvA.getX(k) * Math.PI * 2 * r);
    body.rotateZ(Math.PI / 2);
    const color = ROLL_COLORS[fab.id] || '#ffffff';
    const heather = !!fab.heather;
    const bodyMesh = mesh(body, getFabricMaterial(fab.id, color, { heather, side: THREE.FrontSide }), { cast: true, receive: true, name: 'tela' });
    rg.add(bodyMesh);
    // cantos con las vueltas de tela
    const endMat = new THREE.MeshStandardMaterial({ map: endTex, color: mixHex(color, '#000000', 0.08), roughness: 0.95 });
    const ring = new THREE.RingGeometry(0.022, r, 48, 1);
    const ringUV = ring.attributes.uv;
    const rp = ring.attributes.position;
    for (let k = 0; k < ringUV.count; k++) ringUV.setXY(k, 0.5 + (rp.getX(k) / r) * 0.5, 0.5 + (rp.getY(k) / r) * 0.5);
    const ends = mergeGeometries([-1, 1].map((sx) => ring.clone().rotateY((sx * Math.PI) / 2).translate((sx * rollLen) / 2, 0, 0)));
    ring.dispose();
    rg.add(mesh(ends, endMat, { name: 'cantos' }));
    // tubo de cartón asomando (estático: va al lote)
    const cp = [rollX, yb + r, zc];
    const coreG = new THREE.CylinderGeometry(0.022, 0.022, rollLen + 0.05, 20, 1, true);
    b.add(coreG, coreMat, { p: cp, r: [0, 0, Math.PI / 2], uv: 'keep' });
    coreG.dispose();
    const coreInG = new THREE.CylinderGeometry(0.018, 0.018, rollLen + 0.05, 16, 1, true);
    b.add(coreInG, coreInner, { p: cp, r: [0, 0, Math.PI / 2], uv: 'keep' });
    coreInG.dispose();
    const cr = new THREE.RingGeometry(0.018, 0.022, 20);
    for (const sx of [-1, 1]) b.add(cr, coreMat, { p: [rollX + sx * (rollLen / 2 + 0.025), yb + r, zc], r: [0, (sx * Math.PI) / 2, 0], uv: 'keep' });
    cr.dispose();

    // etiqueta en el canto del estante (a la izquierda del rollo)
    const lblW = 0.19;
    const lblH = 0.055;
    const offTex = labelTexture(fab, false);
    const onTex = labelTexture(fab, true);
    const lblMat = new THREE.MeshStandardMaterial({ map: offTex, roughness: 0.75, emissive: new THREE.Color('#ffd8a0'), emissiveIntensity: 0, emissiveMap: onTex });
    const lbl = mesh(new THREE.PlaneGeometry(lblW, lblH), lblMat, { p: [-innerW / 2 + lblW / 2 + 0.02, yb - lblH / 2 + 0.012, D / 2 + 0.0015], name: 'etiqueta' });
    group.add(lbl);

    // paño desenrollado (aparece con setHighlight)
    const drapeGeo = makeDrapeGeometry();
    const drape = mesh(drapeGeo, getFabricMaterial(fab.id, color, { heather }), { cast: true, receive: true, name: 'pano' });
    drape.visible = false;
    rg.add(drape);

    const roll = {
      fabricId: fab.id,
      group: rg,
      color,
      highlighted: false,
      _amount: 0,
      _target: 0,
      setColor(hex) {
        this.color = hex;
        const mat = getFabricMaterial(fab.id, hex, { heather, side: THREE.FrontSide });
        bodyMesh.material = mat;
        drape.material = getFabricMaterial(fab.id, hex, { heather });
        endMat.color.set(mixHex(hex, '#000000', 0.08));
      },
      setHighlight(on) {
        this.highlighted = !!on;
        this._target = on ? 1 : 0;
        lblMat.map = on ? onTex : offTex;
        lblMat.emissiveIntensity = on ? 0.35 : 0;
        lblMat.needsUpdate = true;
      },
      update(dt, time) {
        const prev = this._amount;
        this._amount = damp(this._amount, this._target, 5, dt);
        if (Math.abs(this._amount - this._target) < 0.002) this._amount = this._target;
        const a = this._amount;
        drape.visible = a > 0.01;
        // el rollo gira apenas al soltar tela
        bodyMesh.rotation.x = -a * 1.4;
        if (drape.visible && (Math.abs(a - prev) > 1e-4 || a > 0.99)) {
          buildDrape(drapeGeo, { len: 0.3, width: rollLen - 0.02, r, edgeZ: edgeZ - zc, edgeY: -r, amount: a, t: time });
        }
      },
    };
    rolls.push(roll);
  }

  // arriba de la estantería: cajas y telas dobladas
  const topY = H + 0.03;
  cardboardBox(b, { x: -0.48, y: topY, z: -0.02, w: 0.42, h: 0.24, d: 0.36, ry: -0.04 });
  foldedStack(b, { x: 0.02, y: topY, z: 0.02, w: 0.36, d: 0.28, colors: ['#f0a9c4', '#f1cc4e', '#8fd0b8', '#e7dcc4', '#6b4b9b'] });
  cardboardBox(b, { x: 0.48, y: topY, z: -0.03, w: 0.36, h: 0.18, d: 0.32, ry: 0.05 });
  b.flush(group, 'estanteria');

  return {
    group,
    rolls,
    update(dt, t) {
      for (const r of rolls) if (r._amount !== r._target || r._amount > 0) r.update(dt, t);
    },
  };
}
