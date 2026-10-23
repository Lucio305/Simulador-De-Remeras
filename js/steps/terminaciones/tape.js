// Cinta métrica 3D para el control de calidad: una cinta amarilla con marcas de centímetros
// apoyada sobre la superficie de la remera (sigue el inflado), que se "desenrolla" animada.

import * as THREE from 'three';

// Puntos (coords de prenda) por donde pasa la cinta para cada medición.
export function tapePath(pattern, kind) {
  const c = pattern.construction;
  const pts = [];
  if (kind === 'chest') {
    const y = c.UA.y - 0.025;
    const k = (c.UA.y - y) / Math.max(0.01, c.UA.y - c.HEM.y);
    const xe = c.UA.x + (c.HEM.x - c.UA.x) * k - 0.004;
    const n = 44;
    for (let i = 0; i <= n; i++) pts.push({ x: -xe + (2 * xe * i) / n, y });
    return { side: 'frente', pts };
  }
  if (kind === 'length') {
    const x = c.HPS.x + 0.014;
    const n = 48;
    const y0 = -0.008;
    const y1 = -c.L + 0.004;
    for (let i = 0; i <= n; i++) pts.push({ x, y: y0 + ((y1 - y0) * i) / n });
    return { side: 'frente', pts };
  }
  // manga (derecha visto de frente: x > 0)
  const SP = c.SP;
  const CT = c.sleeve?.CT || { x: SP.x + 0.15, y: SP.y - 0.08 };
  const CB = c.sleeve?.CB || { x: CT.x - 0.04, y: CT.y - 0.1 };
  const dx = CT.x - SP.x;
  const dy = CT.y - SP.y;
  const l = Math.hypot(dx, dy) || 1;
  // hacia el interior de la manga (del lado del puño de abajo)
  let px = -dy / l;
  let py = dx / l;
  if ((CB.x - CT.x) * px + (CB.y - CT.y) * py < 0) {
    px = -px;
    py = -py;
  }
  const inset = 0.014;
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: SP.x + dx * t + px * inset, y: SP.y + dy * t + py * inset - 0.002 });
  }
  return { side: 'frente', pts };
}

function tapeTexture(lenCm, scale) {
  const pxPerCm = 22;
  const w = Math.min(2048, Math.max(64, Math.ceil(lenCm * pxPerCm)));
  const h = 44;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, w, h);
  // leve brillo de plástico
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,255,255,0.35)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(120,80,0,0.18)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3a2c12';
  g.fillRect(0, 0, w, 2);
  g.fillRect(0, h - 2, w, 2);
  const cmPx = w / (lenCm * scale); // px por cm "medido"
  const total = lenCm * scale;
  g.textAlign = 'center';
  g.font = '700 13px Arial, Helvetica, sans-serif';
  for (let mm = 0; mm <= total * 10; mm += 5) {
    const x = (mm / 10) * cmPx;
    const big = mm % 10 === 0;
    const five = mm % 50 === 0;
    g.fillRect(x - 0.6, 2, big ? 1.6 : 1, five ? 16 : big ? 12 : 7);
    g.fillRect(x - 0.6, h - 2 - (five ? 16 : big ? 12 : 7), big ? 1.6 : 1, five ? 16 : big ? 12 : 7);
    if (big && mm > 0 && (cmPx > 16 || mm % 50 === 0)) {
      g.fillStyle = five ? '#b3261e' : '#3a2c12';
      g.fillText(String(mm / 10), x, h / 2 + 5);
      g.fillStyle = '#3a2c12';
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Crea la cinta. reading = valor (cm) que tiene que marcar al final de la cinta.
export function createTape(shirt, pattern, kind, reading, { width = 0.0135, offset = 0.0042 } = {}) {
  const { side, pts } = tapePath(pattern, kind);
  const P = [];
  const N = [];
  for (const p of pts) {
    const r = shirt.garmentToLocal(side, p.x, p.y, offset);
    P.push(r.position);
    N.push(r.normal);
  }
  const n = P.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  let len = 0;
  const acc = [0];
  for (let i = 1; i < n; i++) {
    len += P[i].distanceTo(P[i - 1]);
    acc.push(len);
  }
  for (let i = 0; i < n; i++) {
    T.copy(P[Math.min(n - 1, i + 1)]).sub(P[Math.max(0, i - 1)]).normalize();
    B.crossVectors(N[i], T).normalize();
    for (let s = 0; s < 2; s++) {
      const k = (i * 2 + s) * 3;
      const sg = s ? 1 : -1;
      pos[k] = P[i].x + B.x * sg * width * 0.5;
      pos[k + 1] = P[i].y + B.y * sg * width * 0.5;
      pos[k + 2] = P[i].z + B.z * sg * width * 0.5;
      nor[k] = N[i].x;
      nor[k + 1] = N[i].y;
      nor[k + 2] = N[i].z;
      uv[(i * 2 + s) * 2] = acc[i] / len;
      uv[(i * 2 + s) * 2 + 1] = s;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.setDrawRange(0, 0);
  const lenCm = len * 100;
  const tex = tapeTexture(lenCm, reading / lenCm);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `cinta-${kind}`;
  mesh.castShadow = true;
  mesh.renderOrder = 4;
  // chapita metálica del extremo
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.004, width * 1.05, 0.0035), new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.9, roughness: 0.3 }));
  tab.position.copy(P[0]);
  tab.lookAt(P[0].clone().add(N[0]));
  mesh.add(tab);
  const segs = n - 1;
  let prog = 0;
  return {
    mesh,
    length: len,
    set progress(t) {
      prog = Math.max(0, Math.min(1, t));
      geo.setDrawRange(0, Math.round(prog * segs) * 6);
    },
    get progress() {
      return prog;
    },
    // punto de la punta de la cinta (espacio local del grupo de la remera)
    tipLocal() {
      const i = Math.max(0, Math.min(n - 1, Math.round(prog * segs)));
      return P[i].clone().addScaledVector(N[i], 0.01);
    },
    endLocal() {
      return P[n - 1].clone().addScaledVector(N[n - 1], 0.01);
    },
    centerLocal() {
      const box = new THREE.Box3().setFromPoints(P);
      return box.getCenter(new THREE.Vector3());
    },
    boxLocal() {
      return new THREE.Box3().setFromPoints(P);
    },
    dispose() {
      geo.dispose();
      tex.dispose();
      mat.dispose();
      tab.geometry.dispose();
      tab.material.dispose();
      if (mesh.parent) mesh.parent.remove(mesh);
    },
  };
}
