// Corte · manejo de las herramientas del carrito (tijera de sastre y cúter circular) mientras
// cortan, y la regla de acrílico para las tiras. Las herramientas son props del taller: se
// guarda su pose de reposo y se devuelve al salir.

import * as THREE from 'three';

const TAU = Math.PI * 2;

export function savePose(obj) {
  if (!obj) return null;
  return {
    obj,
    parent: obj.parent,
    position: obj.position.clone(),
    rotation: obj.rotation.clone(),
    scale: obj.scale.clone(),
    visible: obj.visible,
  };
}

export function restorePose(p) {
  if (!p) return;
  const o = p.obj;
  if (o.parent !== p.parent) p.parent?.add(o);
  o.position.copy(p.position);
  o.rotation.copy(p.rotation); // copia también el orden de los ejes
  o.scale.copy(p.scale);
  o.visible = p.visible;
}

// Ángulo de rotación Y para que el +X local apunte en la dirección (tx, tz) del plano XZ.
export const headingOf = (tx, tz) => Math.atan2(-tz, tx);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------------------
// Controlador común: sigue el punto de corte (mundo), suaviza el rumbo, baja al apoyar.
// ---------------------------------------------------------------------------

function baseController(prop, kind) {
  const group = prop.group;
  const state = { heading: 0, lift: 0.02, travelled: 0, phase: 0, has: false };
  return {
    kind,
    prop,
    group,
    state,
    // pose instantánea (sin suavizado) para arrancar o mudarse
    snap(pos, heading, lift = 0.02) {
      state.heading = heading;
      state.lift = lift;
      state.has = true;
      this.apply(pos);
    },
  };
}

export function scissorsController(prop) {
  const c = baseController(prop, 'tijera');
  const st = c.state;
  const BACK = 0.034; // el pivote va unos cm detrás del punto donde corta
  const ROLL = 0.5; // inclinación: la hoja de abajo pasa por debajo de la tela
  let lastSnip = 0;
  c.apply = (pos) => {
    const g = c.group;
    g.rotation.order = 'YXZ';
    const dx = Math.cos(st.heading);
    const dz = -Math.sin(st.heading);
    g.position.set(pos.x - dx * BACK, pos.y + 0.0012 + st.lift, pos.z - dz * BACK);
    g.rotation.set(ROLL * (1 - Math.min(1, st.lift / 0.03) * 0.6), st.heading, 0);
  };
  // pos (mundo), heading objetivo, avance ds (m), engaged (apoyada cortando), dt
  // devuelve true si en este paso "cerró" la tijera (para el sonido)
  c.update = (pos, heading, ds, engaged, dt) => {
    const k = 1 - Math.exp(-dt * 14);
    st.heading += wrapPi(heading - st.heading) * k;
    st.lift += ((engaged ? 0 : 0.018) - st.lift) * (1 - Math.exp(-dt * 12));
    let snipped = false;
    if (ds > 0) {
      st.travelled += ds;
      const prev = st.phase;
      st.phase += ds / 0.03; // una tijeretada cada 3 cm
      if (Math.floor(prev + 0.5) !== Math.floor(st.phase + 0.5)) {
        const now = performance.now();
        if (now - lastSnip > 90) {
          snipped = true;
          lastSnip = now;
        }
      }
      c.prop.setOpen?.(0.12 + 0.62 * (0.5 + 0.5 * Math.cos(TAU * st.phase)));
    } else if (!engaged) {
      // en el aire queda entreabierta
      const o = c.prop.open ?? 0.4;
      c.prop.setOpen?.(o + (0.45 - o) * (1 - Math.exp(-dt * 6)));
    }
    c.apply(pos);
    return snipped;
  };
  return c;
}

export function cutterController(prop) {
  const c = baseController(prop, 'cutter');
  const st = c.state;
  const R = 0.0225;
  c.apply = (pos) => {
    const g = c.group;
    g.position.set(pos.x, pos.y + 0.0004 + st.lift, pos.z);
    g.rotation.set(0, st.heading, 0);
  };
  c.update = (pos, heading, ds, engaged, dt) => {
    const k = 1 - Math.exp(-dt * 18);
    st.heading += wrapPi(heading - st.heading) * k;
    st.lift += ((engaged ? 0 : 0.016) - st.lift) * (1 - Math.exp(-dt * 12));
    if (ds > 0) {
      st.travelled += ds;
      c.prop.setRoll?.(st.travelled / R);
    }
    c.apply(pos);
    return false;
  };
  return c;
}

// Vuelo de una herramienta entre dos poses (arco), para levantarla del carrito o devolverla.
export function poseTween(group, to, { arc = 0.12 } = {}) {
  const p0 = group.position.clone();
  const q0 = group.quaternion.clone();
  const q1 = new THREE.Quaternion().setFromEuler(to.rotation);
  const p1 = to.position.clone();
  return (k) => {
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    group.position.lerpVectors(p0, p1, e);
    group.position.y += arc * Math.sin(Math.PI * k);
    group.quaternion.slerpQuaternions(q0, q1, e);
  };
}

// ---------------------------------------------------------------------------
// Regla de acrílico (para tiras): ancho exacto de la tira, con marcas cada 1 cm y bordes
// de corte que se ponen verdes cuando la regla queda justo sobre la tiza.
// ---------------------------------------------------------------------------

function rulerCanvas(lenM, widM) {
  const pxm = 900;
  const w = Math.max(64, Math.round(lenM * pxm));
  const h = Math.max(16, Math.round(widM * pxm));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, w, h);
  // líneas finas de grilla cada 1 cm (acrílico de patchwork)
  c.strokeStyle = 'rgba(255, 196, 64, 0.38)';
  c.lineWidth = 1.2;
  for (let mm = 10; mm < lenM * 1000; mm += 10) {
    const x = (mm / 1000) * pxm;
    c.beginPath();
    c.moveTo(x, h * 0.3);
    c.lineTo(x, h * 0.7);
    c.stroke();
  }
  // marcas sobre los dos bordes: mm cortitos, cm más largos
  c.fillStyle = 'rgba(25, 25, 30, 0.8)';
  for (let mm = 0; mm <= lenM * 1000; mm += 2) {
    const x = (mm / 1000) * pxm;
    const cm = mm % 10 === 0;
    const half = mm % 5 === 0;
    const th = cm ? h * 0.24 : half ? h * 0.15 : h * 0.08;
    c.fillRect(x, 0, cm ? 2 : 1, th);
    c.fillRect(x, h - th, cm ? 2 : 1, th);
  }
  c.font = `800 ${Math.round(h * 0.2)}px ui-rounded, system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(25, 25, 30, 0.75)';
  for (let cmi = 5; cmi < lenM * 100; cmi += 5) c.fillText(String(cmi), (cmi / 100) * pxm, h / 2);
  return cv;
}

export function createRuler(lenM, widM) {
  const group = new THREE.Group();
  group.name = 'corte-regla';
  const T = 0.003;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(lenM, T, widM),
    new THREE.MeshStandardMaterial({ color: '#d8efff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  body.position.y = T / 2;
  body.renderOrder = 6;
  body.castShadow = true;
  group.add(body);
  const tex = new THREE.CanvasTexture(rulerCanvas(lenM, widM));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(lenM, widM).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  face.position.y = T + 0.0003;
  face.renderOrder = 7;
  group.add(face);
  // bordes de corte (los que siguen la tiza)
  const edgeMat = new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const edges = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(lenM, 0.0032).rotateX(-Math.PI / 2), edgeMat);
    e.position.set(0, T + 0.0005, (s * widM) / 2);
    e.renderOrder = 8;
    group.add(e);
    edges.push(e);
  }
  group.traverse((o) => (o.raycast = () => {}));
  return {
    group,
    setAligned(k) {
      // k: 0 = lejos, 1 = justo
      edgeMat.color.setRGB(1 - 0.75 * k, 0.69 + 0.2 * k, 0.18 + 0.2 * k);
    },
  };
}
