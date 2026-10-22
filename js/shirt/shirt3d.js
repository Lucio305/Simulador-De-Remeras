// Remera 3D (implementación provisoria: una caja).
import * as THREE from 'three';

export class Shirt3D {
  constructor({ pattern, color }) {
    this.pattern = pattern;
    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.2), this.mat);
    m.position.y = -0.35;
    this.group.add(m);
  }
  setPattern(p) { this.pattern = p; }
  setFabric(f, color) { this.mat.color.set(color); }
  setThreadColor() {}
  setInflation() {}
  setParts() {}
  setSeams() {}
  setWrinkles() {}
  resetWrinkleMask() {}
  setPrint() {}
  setPrintWear() {}
  setShrink() {}
  clearScorches() {}
  clearLooseThreads() {}
}
