// Estampa provisoria mientras se mueve, agranda o rota el diseño: un parche liviano (27 × 27
// vértices, sin relieve geométrico) que sigue la superficie de la remera con las mismas
// texturas del PrintResult (color, rugosidad/metal y normal). Reconstruir la estampa real
// (malla densa de hasta 200 × 200, material y texturas nuevas) en cada movimiento da tirones;
// con esto el arrastre va fluido y la estampa real se aplica cuando el diseño queda quieto.

const N = 26; // celdas por lado

function solidCanvas(rgba) {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = rgba;
  g.fillRect(0, 0, 2, 2);
  return c;
}

export function createPrintProxy({ THREE, shirt }) {
  const V = N + 1;
  const pos = new Float32Array(V * V * 3);
  const nrm = new Float32Array(V * V * 3);
  const uv = new Float32Array(V * V * 2);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      uv[k * 2] = i / N;
      uv[k * 2 + 1] = j / N;
      nrm[k * 3 + 2] = 1;
    }
  }
  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i;
      idx.push(a, a + 1, a + V + 1, a, a + V + 1, a + V);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.setDrawRange(0, 0); // se dibuja vacío hasta el primer uso (así el shader ya queda compilado)

  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const blank = {
    map: tex(solidCanvas('rgba(255,255,255,0)'), true),
    orm: tex(solidCanvas('rgb(255,150,0)'), false),
    normal: tex(solidCanvas('rgb(128,128,255)'), false),
  };
  // Siempre con map, roughnessMap/metalnessMap, normalMap y alphaTest > 0: cambiar de estampa
  // solo cambia texturas y números, nunca el programa del shader.
  const mat = new THREE.MeshStandardMaterial({
    map: blank.map,
    roughnessMap: blank.orm,
    metalnessMap: blank.orm,
    normalMap: blank.normal,
    roughness: 1,
    metalness: 1,
    transparent: true,
    alphaTest: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  });
  mat.name = 'estampa-provisoria';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'estampa-provisoria';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  let current = null; // PrintResult cuyas texturas están cargadas
  let own = []; // texturas propias (no las "blank")
  let shown = false;

  function freeOwn() {
    for (const t of own) t.dispose();
    own = [];
  }

  function setResult(result) {
    if (result === current) return;
    current = result;
    freeOwn();
    if (!result) {
      mat.map = blank.map;
      mat.roughnessMap = mat.metalnessMap = blank.orm;
      mat.normalMap = blank.normal;
      return;
    }
    const p = result.params || {};
    const map = tex(result.color, true);
    own.push(map);
    mat.map = map;
    if (result.orm) {
      const orm = tex(result.orm, false);
      own.push(orm);
      mat.roughnessMap = mat.metalnessMap = orm;
    } else {
      const orm = tex(solidCanvas(`rgb(255,${Math.round(255 * (p.roughness ?? 0.6))},${Math.round(255 * (p.metalness ?? 0))})`), false);
      own.push(orm);
      mat.roughnessMap = mat.metalnessMap = orm;
    }
    if (result.normal && !p.showWeave) {
      const n = tex(result.normal, false);
      own.push(n);
      mat.normalMap = n;
      const s = p.normalScale ?? 1;
      mat.normalScale.set(s, s);
    } else {
      mat.normalMap = blank.normal;
      mat.normalScale.set(1, 1);
    }
    mat.opacity = p.opacity ?? 1;
    mat.alphaTest = Math.max(0.01, p.alphaTest ?? 0.02);
    mat.needsUpdate = false;
  }

  // placement = { x, y, width, rotation (grados) } como Shirt3D.setPrint (x vista desde ese lado).
  function place(side, placement, aspect = 1) {
    if (!current) return;
    const W = Math.max(0.01, placement.width || 0.25);
    const Hh = W / (aspect || 1);
    const r = ((placement.rotation || 0) * Math.PI) / 180;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const flip = side === 'espalda' ? -1 : 1;
    const cx = placement.x || 0;
    const cy = placement.y ?? -0.25;
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const k = j * V + i;
        const lx = (i / N - 0.5) * W;
        const ly = (j / N - 0.5) * Hh;
        const vx = lx * cr - ly * sr;
        const vy = lx * sr + ly * cr;
        const { position, normal } = shirt.garmentToLocal(side, (cx + vx) * flip, cy + vy, 0.0014);
        pos[k * 3] = position.x;
        pos[k * 3 + 1] = position.y;
        pos[k * 3 + 2] = position.z;
        nrm[k * 3] = normal.x;
        nrm[k * 3 + 1] = normal.y;
        nrm[k * 3 + 2] = normal.z;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.setDrawRange(0, Infinity);
    shown = true;
  }

  function hide() {
    if (!shown) return;
    geo.setDrawRange(0, 0);
    shown = false;
  }

  return {
    mesh,
    setResult,
    place,
    hide,
    get shown() {
      return shown;
    },
    dispose() {
      freeOwn();
      for (const t of Object.values(blank)) t.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
