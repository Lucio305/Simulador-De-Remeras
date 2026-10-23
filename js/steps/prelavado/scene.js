// Objetos 3D del paso de prelavado: el corte de tela doblado arriba del lavarropas, la media
// roja olvidada en el tambor, el aro que marca la boca del lavarropas al arrastrar, el
// tendedero de pared con la tela colgada (mojada → seca), gotas y el "sol" para secar.
// Todo se agrega con ctx.add (se destruye solo al salir del paso).

import { getFabricMaterial } from '../../materials/fabric.js';
import { boxUV } from '../../world/props/common.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, smoothstep } from '../../core/utils.js';
import { luminance } from '../../data/catalog.js';

// Medidas del lavarropas (ver js/world/props/washingMachine.js).
export const WM = { H: 0.85, W: 0.6, D: 0.56, DOOR_Y: 0.4, FRONT_Z: 0.245, DRUM_R: 0.235 };

export function createLaundryScene(ctx, { fabricId, color, heather, anchor }) {
  const { THREE } = ctx;
  const ax = anchor[0];
  const az = anchor[2];
  const front = az + WM.FRONT_Z;
  const mats = [];
  const own = (m) => {
    mats.push(m);
    return m;
  };
  ctx.track(() => mats.forEach((m) => m.dispose()));

  // material propio (clon) para poder oscurecerlo cuando está mojada sin tocar el compartido
  const base = getFabricMaterial(fabricId, color, { heather });
  const wetMat = own(base.clone());
  wetMat.userData = {};
  // En el jaspeado el tono va en el map y el color del material es blanco: un cambio de color
  // (media que tiñe, sol que destiñe) se aplica como factor relativo (nuevo / original) sobre el
  // color base del material, así no se multiplica dos veces el tono (y no se oscurece de más).
  const origColor = new THREE.Color(color);
  const baseColor = new THREE.Color(base.color);
  const relColor = (hex, out) => {
    const c = new THREE.Color(hex);
    return out.setRGB(
      baseColor.r * (c.r / Math.max(1e-4, origColor.r)),
      baseColor.g * (c.g / Math.max(1e-4, origColor.g)),
      baseColor.b * (c.b / Math.max(1e-4, origColor.b)),
    );
  };
  const dryColor = baseColor.clone();
  const wetColor = dryColor.clone().multiplyScalar(0.62);
  // brillo cálido del sol proporcional a la claridad de la tela: en una tela negra un emisivo
  // fuerte la haría ver marrón (parece que cambió de color, no que se secó al sol)
  const sunGlow = 0.008 + 0.09 * smoothstep(0.12, 0.6, luminance(color));

  // ---------- corte de tela doblado ----------
  const bundle = new THREE.Group();
  bundle.name = 'prelavado-tela';
  const layers = [
    { w: 0.3, h: 0.022, d: 0.21, y: 0.011, x: 0, z: 0, ry: 0 },
    { w: 0.296, h: 0.02, d: 0.205, y: 0.031, x: 0.004, z: -0.002, ry: 0.012 },
    { w: 0.29, h: 0.019, d: 0.2, y: 0.05, x: -0.003, z: 0.003, ry: -0.018 },
  ];
  for (const L of layers) {
    const g = new RoundedBoxGeometry(L.w, L.h, L.d, 3, Math.min(L.h * 0.48, 0.009));
    boxUV(g, 'x');
    const m = new THREE.Mesh(g, wetMat);
    m.position.set(L.x, L.y, L.z);
    m.rotation.y = L.ry;
    m.castShadow = true;
    m.receiveShadow = true;
    bundle.add(m);
  }
  // pliegue redondeado del frente (donde se dobló la tela)
  {
    const g = new THREE.CylinderGeometry(0.03, 0.03, 0.29, 18, 1, true, -Math.PI / 2, Math.PI);
    g.rotateZ(Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.09, uv.getY(i) * 0.29);
    const m = new THREE.Mesh(g, wetMat);
    m.position.set(0, 0.031, 0.104);
    m.scale.set(1, 1, 0.55);
    m.castShadow = true;
    bundle.add(m);
  }
  // cinta de yute atando el paquete + etiqueta de papel madera del corte (contraste en telas claras)
  {
    const jute = own(new THREE.MeshStandardMaterial({ color: '#a7804f', roughness: 0.95 }));
    const bx = 0.075;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.214), jute);
    top.position.set(bx, 0.0605, 0.002);
    const frontBand = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.064, 0.003), jute);
    frontBand.position.set(bx, 0.03, 0.123);
    const backBand = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.062, 0.003), jute);
    backBand.position.set(bx, 0.031, -0.107);
    bundle.add(top, frontBand, backBand);
    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 192;
    tagCanvas.height = 112;
    const g = tagCanvas.getContext('2d');
    g.fillStyle = '#d6b483';
    g.beginPath();
    g.moveTo(18, 0);
    g.lineTo(192, 0);
    g.lineTo(192, 112);
    g.lineTo(18, 112);
    g.lineTo(0, 56);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(90,58,24,0.12)';
    for (let i = 0; i < 90; i++) g.fillRect(Math.random() * 192, Math.random() * 112, 1 + Math.random() * 6, 1);
    g.fillStyle = '#f4ead8';
    g.beginPath();
    g.arc(24, 56, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a2410';
    g.font = '800 26px sans-serif';
    g.textAlign = 'center';
    g.fillText('CORTE', 112, 46);
    g.font = '700 20px sans-serif';
    g.fillText('para prelavar', 112, 78);
    const tagTex = new THREE.CanvasTexture(tagCanvas);
    tagTex.colorSpace = THREE.SRGBColorSpace;
    ctx.track(() => tagTex.dispose());
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.037), own(new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.9, side: THREE.DoubleSide })));
    tag.position.set(bx + 0.04, 0.024, 0.126);
    tag.rotation.set(0, 0, -0.18);
    bundle.add(tag);
  }
  const bundleHome = new THREE.Vector3(ax - 0.09, WM.H + 0.002, az - 0.05);
  bundle.position.copy(bundleHome);
  bundle.rotation.y = 0.16;
  ctx.add(bundle);
  // caja invisible más grande para agarrarla fácil con el mouse / dedo
  const grab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.17, 0.32), new THREE.MeshBasicMaterial({ visible: false }));
  grab.position.y = 0.055;
  bundle.add(grab);

  // ---------- media roja olvidada ----------
  let sock = null;
  {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.07, 0.0, 0.0),
      new THREE.Vector3(-0.02, 0.004, 0.01),
      new THREE.Vector3(0.03, 0.006, 0.005),
      new THREE.Vector3(0.06, 0.008, -0.025),
      new THREE.Vector3(0.068, 0.008, -0.06),
    ]);
    const g = new THREE.TubeGeometry(path, 24, 0.019, 10, false);
    g.scale(1, 0.55, 1);
    const sockMat = own(new THREE.MeshStandardMaterial({ color: '#c8272d', roughness: 0.9 }));
    const tube = new THREE.Mesh(g, sockMat);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 10), sockMat);
    toe.scale.set(1, 0.55, 1);
    toe.position.copy(path.getPoint(1));
    const cuffMat = own(new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.9 }));
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 12, 1, true), cuffMat);
    cuff.rotation.z = Math.PI / 2;
    cuff.scale.set(1, 1, 0.55);
    cuff.position.set(-0.07, 0, 0);
    sock = new THREE.Group();
    sock.add(tube, toe, cuff);
    // colisionador invisible generoso: la media es finita y se toca con el dedo
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.set(1.25, 0.8, 1);
    hit.name = 'media-roja-hit';
    sock.add(hit);
    sock.name = 'media-roja';
    sock.position.set(ax + 0.02, WM.DOOR_Y - WM.DRUM_R + 0.03, front - 0.13);
    sock.rotation.set(0.05, 0.5, 0.25);
    ctx.add(sock);
  }

  // ---------- aro de la boca (destino al arrastrar) ----------
  const ringMat = own(new THREE.MeshBasicMaterial({ color: '#49c2b0', transparent: true, opacity: 0, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 8, 64), ringMat);
  ring.position.set(ax, WM.DOOR_Y, front + 0.055);
  ring.renderOrder = 8;
  ctx.add(ring);

  // ---------- tendedero de pared sobre el lavarropas ----------
  const lineY = 1.215;
  const lineZ = az - 0.17;
  const line = new THREE.Group();
  line.name = 'tendedero';
  const metal = own(new THREE.MeshStandardMaterial({ color: '#cfd2d6', metalness: 0.85, roughness: 0.3 }));
  const plastic = own(new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.4 }));
  const x0 = ax - 0.43;
  const x1 = ax + 0.43;
  const wallZ = -3.2;
  for (const x of [x0, x1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.012), plastic);
    plate.position.set(x, lineY + 0.01, wallZ + 0.006);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, lineZ - wallZ, 8), metal);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(x, lineY, (lineZ + wallZ) / 2);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), plastic);
    tip.position.set(x, lineY, lineZ);
    line.add(plate, arm, tip);
  }
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, x1 - x0, 6), own(new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.7 })));
  cord.rotation.z = Math.PI / 2;
  cord.position.set(ax, lineY, lineZ);
  line.add(cord);
  ctx.add(line);

  // tela colgada a caballo de la soga: un lado más largo adelante, el otro atrás, con pliegues
  const HW = 0.46;
  const LF = 0.27; // largo que cuelga adelante
  const LB = 0.15; // largo que cuelga atrás
  const FR = 0.007; // radio del doblez sobre la soga
  const NX = 22;
  const NS = 20;
  const hangGeo = new THREE.PlaneGeometry(HW, LF + LB, NX, NS);
  // parámetro s (largo sobre la tela, 0 = arriba de la soga) por vértice
  const sParam = new Float32Array(hangGeo.attributes.position.count);
  {
    const p = hangGeo.attributes.position;
    const uv = hangGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const v = uv.getY(i); // 1 arriba … 0 abajo del plano original
      const sv = LF - (1 - v) * (LF + LB); // de +LF (adelante abajo) a -LB (atrás abajo)
      sParam[i] = -sv;
      uv.setXY(i, p.getX(i), sv);
    }
  }
  const hang = new THREE.Mesh(hangGeo, wetMat);
  hang.castShadow = true;
  hang.receiveShadow = true;
  hang.position.set(ax, lineY, lineZ);
  hang.visible = false;
  ctx.add(hang);
  const pinMat = own(new THREE.MeshStandardMaterial({ color: '#c9a36a', roughness: 0.75 }));
  const pins = [];
  for (const dx of [-HW * 0.36, HW * 0.36]) {
    const pin = new THREE.Group();
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.006), pinMat);
      leg.position.set(0, -0.012, sz * 0.009);
      leg.rotation.x = -sz * 0.12;
      pin.add(leg);
    }
    pin.position.set(ax + dx, lineY + 0.012, lineZ);
    pin.visible = false;
    pins.push(pin);
    ctx.add(pin);
  }
  function drapeCloth(time) {
    const p = hangGeo.attributes.position;
    const half = (FR * Math.PI) / 2;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const sv = -sParam[i]; // >0 adelante, <0 atrás
      const as = Math.abs(sv);
      let y;
      let z;
      if (as <= half) {
        const th = sv / FR;
        y = FR * Math.cos(th);
        z = FR * Math.sin(th);
      } else {
        const d = as - half;
        const k = d / (sv > 0 ? LF : LB); // 0 en la soga, 1 en el borde de abajo
        const sign = sv > 0 ? 1 : -1;
        // pliegues verticales de caída + bamboleo suave
        // entre los broches la tela se comba y forma pliegues en abanico hacia abajo
        const between = Math.max(0, 1 - Math.abs(x) / (HW * 0.36));
        const outside = Math.max(0, (Math.abs(x) - HW * 0.36) / (HW * 0.14));
        const folds = (Math.sin(x * 21 + 0.6) * 0.014 + Math.sin(x * 47 + 2.1) * 0.004) * (0.35 + 0.65 * k);
        const sway = Math.sin(x * 9 + time * 1.5) * 0.007 * k + Math.sin(time * 0.9) * 0.01 * k * k;
        y = -d - between * 0.012 * (1 - k * 0.5) - outside * 0.01 * k + Math.sin(x * 13 + 1.3) * 0.006 * k;
        z = sign * (FR + 0.004 * Math.min(1, d * 30) + (folds + 0.012) * Math.min(1, k * 2.5)) + sway * sign;
      }
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
    hangGeo.computeVertexNormals();
  }
  drapeCloth(0);

  // ---------- efectos chicos (gotas y burbujas) en un solo grupo ----------
  const fx = new THREE.Group();
  fx.name = 'prelavado-fx';
  ctx.add(fx);

  // ---------- burbujas dentro del tambor (se ven por el vidrio) ----------
  const bubMat = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }));
  const bubGeo = new THREE.SphereGeometry(1, 10, 8);
  const bubbles = [];
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(bubGeo, bubMat);
    m.visible = false;
    m.renderOrder = 7;
    const r = 0.004 + Math.random() * 0.01;
    m.userData = { r, ph: Math.random() * 6.28, sp: 0.06 + Math.random() * 0.1 };
    m.scale.setScalar(r);
    bubbles.push(m);
    fx.add(m);
  }
  const respawnBubble = (m, anywhere = false) => {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * 0.13;
    m.position.set(ax + Math.cos(a) * rr, anywhere ? WM.DOOR_Y + Math.sin(a) * rr : WM.DOOR_Y - 0.13 + Math.random() * 0.05, front - 0.05 - Math.random() * 0.08);
  };
  let bubbleAmt = 0;
  let bubbleTarget = 0;

  // ---------- gotas ----------
  const dropMat = own(new THREE.MeshStandardMaterial({ color: '#bfe3f1', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.8 }));
  const dropGeo = new THREE.SphereGeometry(0.0045, 8, 6);
  dropGeo.scale(1, 1.5, 1);
  const drops = [];
  for (let i = 0; i < 14; i++) {
    const d = new THREE.Mesh(dropGeo, dropMat);
    d.visible = false;
    d.userData = { vy: 0, life: 0 };
    drops.push(d);
    fx.add(d);
  }
  let dripRate = 0;
  let dripAcc = 0;

  // ---------- "sol" (secado al sol): brillo cálido en la tela; el sol en sí lo dibuja la UI ----------
  // (no se agregan luces: una luz nueva obliga a recompilar todos los materiales de la escena)
  let sunTarget = 0;
  let sunAmt = 0;
  const warm = new THREE.Color('#ffb46a');
  const sunAnchor = new THREE.Vector3(ax + HW * 0.5 + 0.12, lineY + 0.1, lineZ + 0.05);

  let wet = 0;
  let windT = 0;
  const api = {
    bundle,
    bundleHome,
    grab,
    sock,
    ring,
    hang,
    lineY,
    lineZ,
    // 0 = seca, 1 = empapada
    setWet(t) {
      wet = clamp(t);
      wetMat.color.copy(dryColor).lerp(wetColor, wet);
      wetMat.roughness = lerp(base.roughness, Math.max(0.35, base.roughness - 0.3), wet);
    },
    setTint(hex) {
      relColor(hex, dryColor);
      wetColor.copy(dryColor).multiplyScalar(0.62);
      api.setWet(wet);
    },
    showHanging(on) {
      hang.visible = !!on;
      for (const p of pins) p.visible = !!on;
    },
    setDrip(rate) {
      dripRate = rate;
    },
    setSun(on) {
      sunTarget = on ? 1 : 0;
    },
    sunAnchor,
    setBubbles(on) {
      bubbleTarget = on ? 1 : 0;
    },
    setFade(hex) {
      relColor(hex, dryColor);
      api.setWet(wet);
    },
    setRing(opacity) {
      ringMat.opacity = opacity;
    },
    removeSock() {
      sock = null;
      api.sock = null;
    },
    update(dt, t) {
      // tela colgada: se bambolea apenas
      if (hang.visible) {
        windT += dt;
        drapeCloth(windT);
      }
      // gotas que caen del borde de abajo
      if (dripRate > 0 && hang.visible) {
        dripAcc += dt * dripRate;
        while (dripAcc > 1) {
          dripAcc -= 1;
          const d = drops.find((q) => !q.visible);
          if (!d) break;
          d.visible = true;
          d.position.set(ax + (Math.random() - 0.5) * HW * 0.9, lineY - LF - 0.002, lineZ + 0.018);
          d.userData.vy = 0;
        }
      }
      for (const d of drops) {
        if (!d.visible) continue;
        d.userData.vy -= 9.8 * dt;
        d.position.y += d.userData.vy * dt;
        if (d.position.y < WM.H + 0.004) d.visible = false;
      }
      sunAmt += (sunTarget - sunAmt) * (1 - Math.exp(-dt * 3));
      wetMat.emissive.copy(warm).multiplyScalar(sunAmt * sunGlow);
      // burbujas
      bubbleAmt += (bubbleTarget - bubbleAmt) * (1 - Math.exp(-dt * 4));
      for (const m of bubbles) {
        const show = bubbleAmt > 0.02;
        if (show && !m.visible) respawnBubble(m, true);
        m.visible = show;
        if (!show) continue;
        const u = m.userData;
        m.position.y += u.sp * dt * (0.6 + bubbleAmt);
        m.position.x += Math.sin(t * 3 + u.ph) * 0.02 * dt;
        m.scale.setScalar(u.r * bubbleAmt);
        const dx = m.position.x - ax;
        const dy = m.position.y - WM.DOOR_Y;
        if (dx * dx + dy * dy > 0.145 * 0.145 && dy > 0) respawnBubble(m);
      }
    },
  };
  api.setWet(0);
  return api;
}
