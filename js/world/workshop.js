// Taller 3D (implementación provisoria: solo piso).
import * as THREE from 'three';
import { STATIONS } from '../data/stations.js';

export function createWorkshop(engine) {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshStandardMaterial({ color: '#b08a64' }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  engine.scene.add(group);
  return { group, stations: STATIONS, props: {}, update() {}, setShowcase() {} };
}
