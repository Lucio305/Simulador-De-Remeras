// Efecto de la prueba de lavado: burbujas de jabón iridiscentes que giran alrededor de la
// remera, espuma y gotas que caen al escurrir. Todo en dos InstancedMesh con cartelitos
// (billboards) orientados a la cámara: dos draw calls en total.

import * as THREE from 'three';
import { makeCanvas, rng } from '../../core/utils.js';

function bubbleTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const r = S / 2 - 2;
  // cuerpo casi transparente con borde iridiscente
  const body = g.createRadialGradient(S / 2, S / 2, r * 0.2, S / 2, S / 2, r);
  body.addColorStop(0, 'rgba(255,255,255,0.03)');
  body.addColorStop(0.72, 'rgba(210,235,255,0.10)');
  body.addColorStop(0.9, 'rgba(255,255,255,0.55)');
  body.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = body;
  g.beginPath();
  g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
  g.fill();
  // arcoíris en el borde (película de jabón)
  const hues = ['rgba(255,120,200,0.45)', 'rgba(120,200,255,0.45)', 'rgba(150,255,190,0.4)', 'rgba(255,230,120,0.4)'];
  g.lineWidth = 5;
  hues.forEach((col, i) => {
    g.strokeStyle = col;
    g.beginPath();
    g.arc(S / 2, S / 2, r * 0.86, i * 1.6, i * 1.6 + 1.3);
    g.stroke();
  });
  // brillos
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(S * 0.36, S * 0.32, r * 0.17, r * 0.09, -0.7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.beginPath();
  g.arc(S * 0.66, S * 0.7, r * 0.06, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dropTexture() {
  const W = 64;
  const H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(W / 2, 4);
  g.bezierCurveTo(W * 0.62, H * 0.35, W * 0.92, H * 0.6, W * 0.9, H * 0.74);
  g.arc(W / 2, H * 0.74, W * 0.4, 0, Math.PI);
  g.bezierCurveTo(W * 0.08, H * 0.6, W * 0.38, H * 0.35, W / 2, 4);
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, 'rgba(200,235,255,0.95)');
  grd.addColorStop(1, 'rgba(90,160,220,0.85)');
  g.fillStyle = grd;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.ellipse(W * 0.38, H * 0.68, W * 0.08, H * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWashFx({ center, bubbles = 120, drops = 50, seed = 7 }) {
  const R = rng(seed);
  const group = new THREE.Group();
  group.name = 'prueba-lavado-fx';
  const quad = new THREE.PlaneGeometry(1, 1);
  const bMat = new THREE.MeshBasicMaterial({ map: bubbleTexture(), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const dMat = new THREE.MeshBasicMaterial({ map: dropTexture(), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const bMesh = new THREE.InstancedMesh(quad, bMat, bubbles);
  const dMesh = new THREE.InstancedMesh(quad.clone(), dMat, drops);
  bMesh.frustumCulled = false;
  dMesh.frustumCulled = false;
  bMesh.renderOrder = 5;
  dMesh.renderOrder = 5;
  group.add(bMesh, dMesh);

  const B = [];
  for (let i = 0; i < bubbles; i++) {
    B.push({
      a: R() * Math.PI * 2,
      r: 0.2 + R() * 0.4,
      y: 0.6 + R() * 1.05,
      vy: 0.05 + R() * 0.14,
      size: 0.022 + R() ** 2 * 0.075,
      spin: 0.6 + R() * 0.8,
      delay: R() * 0.9,
      pop: 0.15 + R() * 0.85, // momento relativo en que revienta al final
      wob: R() * 10,
    });
  }
  const D = [];
  for (let i = 0; i < drops; i++) D.push({ x: 0, y: -10, z: 0, vy: 0, size: 0.012 + R() * 0.014, t: R() * 1.2, alive: false });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const qy = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tmpE = new THREE.Euler();

  // Spawn de gotas en el ruedo/puños de la remera (alrededor del eje).
  const respawnDrop = (d, hemY) => {
    const a = R() * Math.PI * 2;
    const rr = 0.12 + R() * 0.2;
    d.x = center.x + Math.cos(a) * rr;
    d.z = center.z + Math.sin(a) * rr * 0.6;
    d.y = hemY - R() * 0.03;
    d.vy = -0.2 - R() * 0.4;
    d.alive = true;
  };

  let time = 0;
  return {
    group,
    // k: { bubbles 0..1 (cantidad visible), swirl (rad/s), pop 0..1 (cuánto reventó), drip 0..1, hemY, floorY }
    update(dt, camera, k) {
      time += dt;
      q.copy(camera.quaternion);
      // burbujas
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        const visible = k.bubbles > b.delay * 0.7 && k.pop < b.pop;
        b.a += (k.swirl * b.spin * 0.45 + 0.4) * dt;
        b.y += b.vy * dt * (1 + k.swirl * 0.05);
        if (b.y > 1.75) b.y = 0.55;
        const grow = Math.min(1, Math.max(0, (k.bubbles - b.delay * 0.7) * 4));
        const sz = visible ? b.size * grow * (1 + 0.08 * Math.sin(time * 5 + b.wob)) : 0;
        const rr = b.r * (1 + 0.05 * Math.sin(time * 2 + b.wob));
        p.set(center.x + Math.cos(b.a) * rr, b.y + 0.02 * Math.sin(time * 3 + b.wob), center.z + Math.sin(b.a) * rr);
        s.setScalar(Math.max(1e-5, sz));
        m.compose(p, q, s);
        bMesh.setMatrixAt(i, m);
      }
      bMesh.instanceMatrix.needsUpdate = true;
      // gotas (billboard solo alrededor del eje vertical)
      tmpE.setFromQuaternion(camera.quaternion, 'YXZ');
      qy.setFromAxisAngle(up, tmpE.y);
      for (let i = 0; i < D.length; i++) {
        const d = D[i];
        if (!d.alive) {
          d.t -= dt;
          if (k.drip > 0.05 && d.t <= 0) respawnDrop(d, k.hemY);
        } else {
          d.vy -= 9.8 * dt * 0.55;
          d.y += d.vy * dt;
          if (d.y < k.floorY) {
            d.alive = false;
            d.t = 0.05 + R() * 0.5 / Math.max(0.2, k.drip);
          }
        }
        const sz = d.alive ? d.size : 0;
        p.set(d.x, d.y, d.z);
        s.set(Math.max(1e-5, sz), Math.max(1e-5, sz * 1.9), 1);
        m.compose(p, qy, s);
        dMesh.setMatrixAt(i, m);
      }
      dMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      bMat.map.dispose();
      dMat.map.dispose();
    },
  };
}
