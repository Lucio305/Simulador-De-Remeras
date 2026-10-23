// Tabla de planchar (funda estampada, patas cruzadas, apoya-plancha y porta-cable) y
// plancha a vapor: suela de acero con agujeros, cuerpo con tanque de agua, mango, perilla
// de temperatura con puntos (setLevel), luz piloto (setHot), vapor (setSteam) y cable.
// La plancha tiene su origen en el centro de la suela (plano de apoyo) y la punta hacia +X.

import { THREE, Batch, std, phys, mesh, V3, lathe, extrude, chrome, rubber, place, tube, PALETTE } from './common.js';
import { ironCoverTexture, drawTexture, steamSprite } from './textures.js';
import { getWeaveNormalTexture } from '../../materials/fabric.js';
import { clamp } from '../../core/utils.js';

// Contorno de la tabla en el plano (x = largo, y = ancho); punta hacia +x.
function boardShape(L, W) {
  const s = new THREE.Shape();
  const hw = W / 2;
  const r = 0.045;
  s.moveTo(-L / 2 + r, -hw);
  s.lineTo(L * 0.05, -hw);
  s.bezierCurveTo(L * 0.32, -hw, L / 2, -hw * 0.42, L / 2, 0);
  s.bezierCurveTo(L / 2, hw * 0.42, L * 0.32, hw, L * 0.05, hw);
  s.lineTo(-L / 2 + r, hw);
  s.quadraticCurveTo(-L / 2, hw, -L / 2, hw - r);
  s.lineTo(-L / 2, -hw + r);
  s.quadraticCurveTo(-L / 2, -hw, -L / 2 + r, -hw);
  return s;
}

// Contorno de la suela de la plancha (punta hacia +x).
function soleShape(scale = 1) {
  const s = new THREE.Shape();
  const k = scale;
  s.moveTo(-0.118 * k, -0.056 * k);
  s.bezierCurveTo(-0.02 * k, -0.062 * k, 0.07 * k, -0.05 * k, 0.132 * k, 0.0);
  s.bezierCurveTo(0.07 * k, 0.05 * k, -0.02 * k, 0.062 * k, -0.118 * k, 0.056 * k);
  s.quadraticCurveTo(-0.126 * k, 0.05 * k, -0.126 * k, 0.04 * k);
  s.lineTo(-0.126 * k, -0.04 * k);
  s.quadraticCurveTo(-0.126 * k, -0.05 * k, -0.118 * k, -0.056 * k);
  return s;
}

// Ángulos (en el canvas, y hacia abajo = hacia +Z del mundo) de cada nivel de la perilla.
const DOT_A = (i) => Math.PI * (0.14 + i * 0.24);
const OFF_A = -Math.PI * 0.1;

function dotsDecal() {
  return drawTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const c = w / 2;
      ctx.fillStyle = '#3a3f44';
      const labels = ['•', '••', '•••', '••••'];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 34px sans-serif';
      labels.forEach((l, i) => {
        const a = DOT_A(i);
        ctx.save();
        ctx.translate(c + Math.cos(a) * 92, c + Math.sin(a) * 92);
        ctx.rotate(a - Math.PI / 2);
        ctx.fillText(l, 0, 0);
        ctx.restore();
      });
      ctx.fillStyle = '#5f9a8f';
      ctx.beginPath();
      ctx.arc(c + Math.cos(OFF_A) * 92, c + Math.sin(OFF_A) * 92, 7, 0, Math.PI * 2);
      ctx.fill();
    },
    { key: 'puntos-plancha' },
  );
}

// ---------------------------------------------------------------------------
// Vapor: partículas en coordenadas de mundo (ShaderMaterial de puntos con alfa por partícula)
// ---------------------------------------------------------------------------

function createSteam(count = 110) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: steamSprite() }, scale: { value: 500 }, color: { value: new THREE.Color('#f4f7fa') } },
    vertexShader: `
      attribute float size; attribute float alpha; varying float vA; uniform float scale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
        vA = alpha;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 color; varying float vA;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(color, t.a * vA);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.name = 'vapor';
  points.visible = false;
  const _s = new THREE.Vector2();
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(_s);
    mat.uniforms.scale.value = (_s.y * 0.5) * camera.projectionMatrix.elements[5];
  };
  const parts = [];
  for (let i = 0; i < count; i++) parts.push({ life: 0, max: 1, p: V3(), v: V3(), s0: 0.02 });
  let cursor = 0;
  let idle = true;
  return {
    points,
    emit(p, v, s0 = 0.02, max = 1.2) {
      idle = false;
      const q = parts[cursor];
      cursor = (cursor + 1) % count;
      q.p.copy(p);
      q.v.copy(v);
      q.life = max;
      q.max = max;
      q.s0 = s0;
    },
    update(dt) {
      if (idle && !parts.some((q) => q.life > 0)) return;
      let any = false;
      for (let i = 0; i < count; i++) {
        const q = parts[i];
        if (q.life > 0) {
          any = true;
          q.life -= dt;
          // el vapor frena, sube y se expande
          q.v.multiplyScalar(Math.exp(-2.2 * dt));
          q.v.y += 0.22 * dt;
          q.p.addScaledVector(q.v, dt);
          const k = 1 - q.life / q.max;
          pos[i * 3] = q.p.x;
          pos[i * 3 + 1] = q.p.y;
          pos[i * 3 + 2] = q.p.z;
          size[i] = q.s0 * (1 + k * 3.5);
          // aparece rápido y se desvanece mientras se expande
          const fadeIn = Math.min(1, k / 0.08);
          alpha[i] = fadeIn * Math.pow(1 - k, 1.3) * 0.62;
        } else {
          alpha[i] = 0;
          size[i] = 0;
        }
      }
      points.visible = any;
      idle = !any;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
      geo.attributes.alpha.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Tabla de planchar
// ---------------------------------------------------------------------------

export function createIroningBoard({ center, size = [1.25, 0.42] }) {
  const [L, Wd] = size;
  const surfaceY = center[1];
  const group = new THREE.Group();
  group.name = 'tabla-planchar';
  group.position.set(center[0], 0, center[2]);
  const b = new Batch();
  // funda acolchada: extrusión del contorno con bisel grande
  const cover = ironCoverTexture();
  const weave = getWeaveNormalTexture('lino');
  const coverMat = std('funda-tabla', { map: cover, normalMap: weave, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.92 });
  const pad = 0.028;
  const g = extrude(boardShape(L, Wd), pad, { bevel: 0.011, bevelSegments: 3, curveSegments: 40 });
  g.rotateX(-Math.PI / 2);
  b.add(g, coverMat, { p: [0, surfaceY - pad, 0], uv: 'keep', cast: true });
  g.dispose();
  // chapa de abajo y bastidor
  const frameMat = std('tabla-chapa', { color: '#8d9499', roughness: 0.45, metalness: 0.7 });
  const plate = extrude(boardShape(L - 0.03, Wd - 0.03), 0.006, { bevel: 0.001 });
  plate.rotateX(-Math.PI / 2);
  b.add(plate, frameMat, { p: [-0.005, surfaceY - pad - 0.006, 0], uv: 'box' });
  plate.dispose();
  // patas cruzadas (vista de costado: una X) — caños pintados verde agua
  const legMat = std('tabla-patas', { color: PALETTE.teal, roughness: 0.4, metalness: 0.4 });
  const yU = surfaceY - pad - 0.012;
  const legA = [V3(-0.42, yU, 0), V3(0.36, 0.02, 0), 0.13, 0.165];
  const legB = [V3(0.3, yU, 0), V3(-0.48, 0.02, 0), 0.1, 0.135];
  for (const [p0, p1, zu, zd] of [legA, legB]) {
    const zs = [-zd, zd];
    for (const sz of [-1, 1]) {
      const a = p0.clone().setZ(sz * zu);
      const c = p1.clone().setZ(sz * zd);
      const t = tube([a, c], 0.011, { tubular: 4, radial: 10 });
      b.add(t, legMat, { uv: 'keep', cast: true });
      t.dispose();
    }
    // barra de pie con regatones
    b.cyl(0.011, 0.011, zd * 2, legMat, { p: [p1.x, 0.02, 0], r: [Math.PI / 2, 0, 0], seg: 10, cast: true });
    for (const z of zs) b.cyl(0.018, 0.02, 0.03, rubber(), { p: [p1.x, 0.015, z], r: [Math.PI / 2, 0, 0], seg: 12 });
  }
  // eje del cruce
  b.cyl(0.006, 0.006, 0.36, chrome(), { p: [-0.06, 0.47, 0], r: [Math.PI / 2, 0, 0], seg: 8 });
  // apoya-plancha en el extremo cuadrado (−X)
  const restY = surfaceY - 0.012;
  const restMat = std('apoya-plancha', { color: '#b7bdc2', roughness: 0.35, metalness: 0.9 });
  b.box(0.21, 0.004, 0.17, restMat, { p: [-L / 2 - 0.105, restY - 0.002, 0], radius: 0.0015, seg: 1, cast: true });
  // escuadras que sostienen el apoya-plancha desde el bastidor
  for (const z of [-0.07, 0.07]) {
    const br = tube([[-L / 2 + 0.06, surfaceY - pad - 0.01, z], [-L / 2 - 0.02, restY - 0.03, z], [-L / 2 - 0.17, restY - 0.006, z]], 0.004, { tubular: 10, radial: 6 });
    b.add(br, restMat, { uv: 'keep' });
    br.dispose();
  }
  b.box(0.215, 0.012, 0.004, restMat, { p: [-L / 2 - 0.105, restY + 0.002, 0.085], radius: 0.001, seg: 1 });
  b.box(0.215, 0.012, 0.004, restMat, { p: [-L / 2 - 0.105, restY + 0.002, -0.085], radius: 0.001, seg: 1 });
  for (const x of [-0.06, -0.16]) for (const z of [-0.075, 0.075]) b.cyl(0.006, 0.006, 0.006, rubber(), { p: [-L / 2 + x, restY + 0.003, z], seg: 8 });
  // porta-cable: alambre que sube en la esquina
  const holderBase = V3(-L / 2 + 0.06, surfaceY - 0.01, -Wd / 2 + 0.03);
  const holderTop = V3(-L / 2 + 0.06, surfaceY + 0.36, -Wd / 2 + 0.03);
  const wire = tube([holderBase, holderBase.clone().lerp(holderTop, 0.5).add(V3(-0.01, 0, 0.01)), holderTop], 0.0035, { tubular: 12, radial: 6 });
  b.add(wire, chrome(), { uv: 'keep' });
  wire.dispose();
  const clip = new THREE.TorusGeometry(0.012, 0.003, 6, 16);
  b.add(clip, chrome(), { p: [holderTop.x, holderTop.y + 0.01, holderTop.z] });
  clip.dispose();
  b.flush(group, 'tabla');

  return {
    group,
    surfaceY,
    center: V3(center[0], surfaceY, center[2]),
    length: L,
    width: Wd,
    tipDir: V3(1, 0, 0),
    restPoint: V3(center[0] - L / 2 - 0.105, restY, center[2]),
    cordAnchor: V3(center[0] + holderTop.x, holderTop.y + 0.01, center[2] + holderTop.z),
  };
}

// ---------------------------------------------------------------------------
// Plancha a vapor
// ---------------------------------------------------------------------------

export function createIron({ cordAnchor = null, outlet = null } = {}) {
  const group = new THREE.Group();
  group.name = 'plancha';
  // suela
  const soleMat = std('suela-plancha', { color: '#d2d6da', roughness: 0.18, metalness: 1, emissive: '#000000' });
  const sole = extrude(soleShape(1), 0.007, { bevel: 0.0018, bevelSegments: 2, curveSegments: 30 });
  sole.rotateX(-Math.PI / 2);
  group.add(mesh(sole, soleMat, { cast: true, name: 'suela' }));
  // agujeros de vapor (en la cara inferior, se ven al inclinarla)
  const holeMat = std('agujero-vapor', { color: '#2a2c2e', roughness: 0.6, metalness: 0.5 });
  const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.0022, 8).rotateX(Math.PI / 2), holeMat, 26);
  const mtx = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < 6 && k < 26; i++) {
    for (let j = -2; j <= 2 && k < 26; j++) {
      const x = -0.07 + i * 0.03;
      const z = j * 0.016 * (1 - i * 0.08);
      if (x > 0.08 && Math.abs(j) > 1) continue;
      mtx.makeTranslation(x, -0.0003, z);
      holes.setMatrixAt(k++, mtx);
    }
  }
  holes.count = k;
  group.add(holes);
  // cuerpo (blanco) con faja verde agua y tanque translúcido
  const body = phys('plancha-cuerpo', { color: '#f4f2ec', roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const accent = phys('plancha-acento', { color: PALETTE.teal, roughness: 0.3, clearcoat: 0.6 });
  const shell = extrude(soleShape(0.94), 0.045, { bevel: 0.018, bevelSegments: 5, curveSegments: 30 });
  shell.rotateX(-Math.PI / 2);
  group.add(mesh(shell, body, { p: [0, 0.008, 0], cast: true }));
  const band = extrude(soleShape(0.985), 0.008, { bevel: 0.002, bevelSegments: 1, curveSegments: 30 });
  band.rotateX(-Math.PI / 2);
  group.add(mesh(band, accent, { p: [0, 0.0085, 0] }));
  const tank = phys('plancha-tanque', { color: '#7fb8d6', roughness: 0.1, transparent: true, opacity: 0.6, clearcoat: 1 });
  const tankGeo = new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  group.add(mesh(tankGeo, tank, { p: [0.045, 0.045, 0], s: [1.35, 0.5, 0.85] }));
  // mango
  const handlePath = [
    [-0.098, 0.05, 0],
    [-0.092, 0.1, 0],
    [-0.06, 0.128, 0],
    [0.02, 0.13, 0],
    [0.06, 0.112, 0],
    [0.075, 0.065, 0],
  ];
  const hg = tube(handlePath, 0.0135, { tubular: 40, radial: 12 });
  hg.scale(1, 1, 0.78);
  group.add(mesh(hg, body, { cast: true }));
  // botones de vapor y spray
  group.add(mesh(new THREE.SphereGeometry(0.0085, 14, 10), accent, { p: [0.035, 0.139, 0], s: [1.3, 0.55, 1] }));
  group.add(mesh(new THREE.SphereGeometry(0.0075, 14, 10), accent, { p: [0.056, 0.128, 0], s: [1.1, 0.55, 1], r: [0, 0, -0.5] }));
  // perilla con puntos (rota alrededor de Y)
  const decal = mesh(new THREE.CircleGeometry(0.036, 32).rotateX(-Math.PI / 2), std('puntos-plancha', { map: dotsDecal(), transparent: true, roughness: 0.4 }), { p: [-0.035, 0.0535, 0] });
  group.add(decal);
  const dial = new THREE.Group();
  place(dial, [-0.035, 0.052, 0]);
  group.add(dial);
  dial.add(mesh(lathe([[0, 0.012], [0.016, 0.012], [0.019, 0.008], [0.019, 0]], 24), accent, { cast: true }));
  dial.add(mesh(new THREE.BoxGeometry(0.004, 0.003, 0.016), std('marca-dial', { color: '#ffffff' }), { p: [0, 0.0128, -0.006] }));
  // luz piloto
  const pilotMat = new THREE.MeshStandardMaterial({ color: '#552a10', emissive: '#ff7a1a', emissiveIntensity: 0, roughness: 0.2 });
  group.add(mesh(new THREE.SphereGeometry(0.0045, 12, 8), pilotMat, { p: [-0.0815, 0.085, 0.0], s: [0.6, 1, 1] }));
  // salida del cable (talón)
  const boot = lathe([[0.009, 0], [0.006, 0.03], [0.004, 0.036]], 12);
  boot.rotateZ(Math.PI / 2 - 0.35);
  group.add(mesh(boot, std('cable-plancha', { color: '#e9e6df', roughness: 0.6 }), { p: [-0.118, 0.035, 0] }));

  // cable dinámico (talón → porta-cable) y tramo fijo (porta-cable → enchufe)
  const fx = new THREE.Group();
  fx.name = 'plancha-fx';
  const cordMat = std('cable-plancha', { color: '#e9e6df', roughness: 0.6 });
  let cord = null;
  if (cordAnchor && outlet) {
    const fixed = tube([cordAnchor, cordAnchor.clone().add(V3(-0.02, -0.3, -0.06)), V3(cordAnchor.x - 0.05, 0.04, cordAnchor.z - 0.25), V3(outlet.x, 0.02, outlet.z + 0.25), V3(outlet.x, 0.08, outlet.z + 0.02), outlet], 0.0032, { tubular: 60, radial: 6 });
    fx.add(mesh(fixed, cordMat));
  }
  const steam = createSteam();
  fx.add(steam.points);

  // estado
  let level = 0;
  let hot = 0;
  let steamOn = false;
  let emitAcc = 0;
  const lastMatrix = new THREE.Matrix4();
  const heel = V3();
  const tmp = V3();
  const tmpV = V3();
  const edge = soleShape(1).getSpacedPoints(40);

  function rebuildCord() {
    if (!cordAnchor) return;
    group.updateWorldMatrix(true, false);
    heel.set(-0.152, 0.047, 0).applyMatrix4(group.matrixWorld);
    const mid = heel.clone().lerp(cordAnchor, 0.5);
    const dist = heel.distanceTo(cordAnchor);
    mid.y -= Math.min(0.25, dist * 0.3);
    const pts = [heel, heel.clone().lerp(mid, 0.5).add(V3(0, -dist * 0.05, 0)), mid, mid.clone().lerp(cordAnchor, 0.6), cordAnchor];
    const g = tube(pts, 0.0032, { tubular: 36, radial: 6 });
    if (cord) {
      cord.geometry.dispose();
      cord.geometry = g;
    } else {
      cord = mesh(g, cordMat, { cast: false });
      cord.frustumCulled = false;
      fx.add(cord);
    }
  }

  const api = {
    group,
    fx,
    setLevel(l) {
      level = clamp(Math.round(l), 0, 4);
      // 0 = apagada (MIN); 1..4 apuntan a los puntos
      dial.rotation.y = -Math.PI / 2 - (level === 0 ? OFF_A : DOT_A(level - 1));
    },
    setSteam(on) {
      if (on && !steamOn) emitAcc = 6; // bocanada inicial
      steamOn = !!on;
    },
    setHot(t) {
      hot = clamp(t, 0, 1);
      soleMat.emissive.setRGB(0.25 * hot * hot, 0.06 * hot * hot, 0.0);
    },
    get level() {
      return level;
    },
    update(dt, t) {
      // luz piloto: encendida mientras calienta, tenue cuando llegó a temperatura
      const heating = level > 0 && hot < 0.97;
      pilotMat.emissiveIntensity = level === 0 ? 0 : heating ? 1.6 + Math.sin(t * 6) * 0.25 : 0.35;
      // vapor desde los bordes de la suela
      if (steamOn && level > 0) emitAcc += dt * 70 * (0.4 + hot * 0.6);
      group.updateWorldMatrix(true, false);
      while (emitAcc >= 1) {
        emitAcc -= 1;
        const e = edge[(Math.random() * edge.length) | 0];
        tmp.set(e.x * 0.95, 0.004, -e.y * 0.95).applyMatrix4(group.matrixWorld);
        tmpV.set(e.x, 0, -e.y).normalize().transformDirection(group.matrixWorld).multiplyScalar(0.12 + Math.random() * 0.12);
        tmpV.y = 0.05 + Math.random() * 0.06;
        steam.emit(tmp, tmpV, 0.024 + Math.random() * 0.016, 0.7 + Math.random() * 0.8);
      }
      steam.update(dt);
      if (!lastMatrix.equals(group.matrixWorld)) {
        lastMatrix.copy(group.matrixWorld);
        rebuildCord();
      }
    },
  };
  api.setLevel(0);
  return api;
}
