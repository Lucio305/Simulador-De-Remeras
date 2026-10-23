// Capa de lectura de arrugas sobre el lado de la remera que mira arriba.
// Comparte la geometría del panel (sigue las arrugas, el inflado y la caída por el borde) y
// lee la máscara de arrugas que queda (lo que falta planchar) como textura:
//  · "brillo": en telas oscuras las crestas que miran a la luz rasante agarran un reflejo
//    claro y los valles se oscurecen un poco, como pasa de verdad con la luz de costado;
//    donde ya está planchado no hay nada (la tela queda pareja).
//  · "resaltar": un velo de color sobre lo que todavía está arrugado (ayuda para encontrar
//    lo que falta, sobre todo en bordes y mangas).
// Es una capa sin luz propia (ShaderMaterial), sin sombras, que se dibuja encima del panel.

import * as THREE from 'three';
import { WBOX } from '../../shirt/wrinkles.js';

const VERT = /* glsl */ `
  varying vec2 vG;
  varying vec3 vN;
  void main() {
    vG = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec3 p = position + normal * 0.0007;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec4 uMap;
  uniform vec3 uLight;
  uniform float uSheen;
  uniform float uHint;
  uniform float uPulse;
  uniform float uFade;
  uniform float uTime;
  uniform vec3 uSheenColor;
  uniform vec3 uHintColor;
  varying vec2 vG;
  varying vec3 vN;
  void main() {
    float m = texture2D(uMask, (vG - uMap.xy) * uMap.zw).r;
    vec3 n = normalize(vN);
    vec3 upv = vec3(0.0, 1.0, 0.0);
    // cuánto más (o menos) mira a la luz rasante que la tela plana
    float d = dot(n, uLight) - dot(upv, uLight);
    // inclinación en cualquier dirección (pliegues paralelos a la luz también)
    float slope = 1.0 - clamp(n.y, 0.0, 1.0);
    float k = smoothstep(0.015, 0.3, m);
    // brillo suave en lo que mira a la luz (más fuerte cuanto más mira) + un toque en las crestas
    float lit = 0.26 * smoothstep(0.0, 0.32, d) + 0.1 * smoothstep(0.006, 0.07, slope);
    float shade = 0.22 * smoothstep(0.02, 0.28, -d);
    float aS = uSheen * k * lit;
    float aD = uSheen * k * shade;
    vec3 col = aS >= aD ? uSheenColor : vec3(0.0);
    float a = max(aS, aD);
    // velo de resaltado: rayado diagonal que avanza despacio (se lee como marca, no como mancha)
    float kh = smoothstep(0.02, 0.3, m);
    float st = smoothstep(0.35, 0.5, abs(fract((vG.x + vG.y) * 34.0 - uTime * 0.35) - 0.5) * 2.0);
    float aH = uHint * kh * (0.2 + 0.26 * st) * (0.85 + 0.15 * uPulse);
    if (aH > 0.0) {
      col = mix(col, uHintColor, aH / max(1e-4, a + aH));
      a = a + aH * (1.0 - a);
    }
    a *= uFade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export function createWrinkleOverlay(shirt, { lightDir, sheen = 0, sheenColor = '#c9d2de', hintColor = '#ff9d2e' } = {}) {
  const masks = shirt._mask;
  const pms = shirt._panelMeshes;
  if (!masks?.frente?.m || !masks?.espalda?.m || !pms?.frente?.geometry || !shirt.root) return null;
  const { nx, ny, cell } = masks.frente;
  const data = new Uint8Array(nx * ny);
  const tex = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const uniforms = {
    uMask: { value: tex },
    uMap: { value: new THREE.Vector4(WBOX.x0 - cell / 2, WBOX.y0 - cell / 2, 1 / (nx * cell), 1 / (ny * cell)) },
    uLight: { value: lightDir.clone().normalize() },
    uSheen: { value: sheen },
    uHint: { value: 0 },
    uPulse: { value: 0 },
    uFade: { value: 1 },
    uTime: { value: 0 },
    uSheenColor: { value: new THREE.Color(sheenColor) },
    uHintColor: { value: new THREE.Color(hintColor) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(pms.frente.geometry, material);
  mesh.name = 'planchado-lectura-arrugas';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {}; // no interfiere con los raycasts de la remera
  shirt.root.add(mesh);

  let side = 'frente';
  let dirty = true;
  let hint = 0;
  let hintGoal = 0;
  let pulseT = 0;
  let pulseUntil = 0;
  let clock = 0;
  let fade = 1;

  function upload() {
    const M = masks[side];
    const { m, inside } = M;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        let v;
        if (inside[k]) v = m[k];
        else {
          // fuera del contorno: promedio de los vecinos de adentro (sin "flecos" en el borde)
          let s = 0;
          let c = 0;
          if (i > 0 && inside[k - 1]) (s += m[k - 1]), c++;
          if (i < nx - 1 && inside[k + 1]) (s += m[k + 1]), c++;
          if (j > 0 && inside[k - nx]) (s += m[k - nx]), c++;
          if (j < ny - 1 && inside[k + nx]) (s += m[k + nx]), c++;
          v = c ? s / c : 0;
        }
        data[k] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
      }
    }
    tex.needsUpdate = true;
    dirty = false;
  }

  return {
    mesh,
    get hint() {
      return hintGoal > 0;
    },
    setSide(s) {
      if (s !== 'frente' && s !== 'espalda') return;
      side = s;
      const g = shirt._panelMeshes?.[s]?.geometry;
      if (g) mesh.geometry = g;
      dirty = true;
    },
    markDirty() {
      dirty = true;
    },
    setSheen(v) {
      uniforms.uSheen.value = v;
    },
    setHint(on) {
      hintGoal = on ? 1 : 0;
    },
    // resaltado momentáneo (aunque el resaltado esté apagado)
    pulse(secs = 3) {
      pulseUntil = clock + secs;
    },
    // 0..1: para ocultarla mientras la remera se da vuelta
    setVisible(k) {
      fade = k;
    },
    update(dt) {
      clock += dt;
      const goal = Math.max(hintGoal, clock < pulseUntil ? 0.9 : 0);
      hint += (goal - hint) * (1 - Math.exp(-dt * 7));
      if (Math.abs(goal - hint) < 0.003) hint = goal;
      pulseT += dt;
      uniforms.uHint.value = hint;
      uniforms.uFade.value = fade;
      uniforms.uTime.value = clock;
      uniforms.uPulse.value = 0.5 + 0.5 * Math.sin(pulseT * 4.2);
      const sheenOn = uniforms.uSheen.value > 0.001 && fade > 0.01;
      mesh.visible = fade > 0.01 && (sheenOn || hint > 0.004);
      if (mesh.visible && dirty) upload();
    },
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      material.dispose();
      tex.dispose();
    },
  };
}
