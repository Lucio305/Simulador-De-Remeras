// Taller 3D: arma la sala y todos los muebles, máquinas y herramientas de cada estación
// (posiciones según js/data/stations.js), la decoración, las luces y el modo exhibición.
// Todas las props quedan como hijas directas de `group` (que está en el origen, sin
// rotar), así que la posición local de cada prop.group es también su posición de mundo.

import * as THREE from 'three';
import { STATIONS } from '../data/stations.js';
import { Batch, woodMaterial, damp, PALETTE } from './props/common.js';
import { createRoom } from './props/room.js';
import { createCuttingTable, createSewingTable, createPrintTable, createToolCart, createNotionsCabinet, addStool, addWallShelf, cardboardBox, foldedStack } from './props/furniture.js';
import { createShelf } from './props/shelf.js';
import { createThreadRack } from './props/threadRack.js';
import { createMannequin } from './props/mannequin.js';
import { createWashingMachine } from './props/washingMachine.js';
import { createScissors, createRotaryCutter, createChalk, createRulerSet, addPinCushion, addTapeMeasure } from './props/cuttingTools.js';
import { createSewingMachine, createPedal } from './props/sewingMachine.js';
import { createOverlock } from './props/overlock.js';
import { createIroningBoard, createIron } from './props/ironing.js';
import { createHeatPress } from './props/heatPress.js';
import { createScreenPrint, createSqueegee, createFlashDryer, addInkTubs } from './props/screenPrint.js';
import { createEmbroideryMachine } from './props/embroidery.js';
import { createPaintKit, createBrush } from './props/paintKit.js';
import { createDisplayStand, createLabelKit } from './props/displayStand.js';
import {
  createContactShadows, createPendantLamp, createCorkBoard, createClock, addPlant, createRug, createClothesRack, createPegboard,
  addLaundryShelfItems, addVinylRolls, createSign, createPosters, createWallDisplay, createCurtains, createFloorAO,
} from './props/decor.js';

export function createWorkshop(engine) {
  const S = STATIONS;
  const group = new THREE.Group();
  group.name = 'taller';
  engine.scene.add(group);
  const add = (...objs) => objs.forEach((o) => group.add(o.group || o));

  const room = createRoom();
  add(room);

  // ---------------- Materiales: estantería, mercería, rack de hilos y maniquí ----------------
  const shelf = createShelf({ anchor: S.materiales.anchor });
  const cabinet = createNotionsCabinet({ position: [-4.05, 0, -2.98] });
  const threadRack = createThreadRack({ center: [-4.05, 1.88, -3.2] });
  const mannequinPreview = createMannequin({ base: S.materiales.preview, neckY: 1.45 });
  add(shelf, cabinet, threadRack, mannequinPreview);

  // ---------------- Lavadero ----------------
  const washingMachine = createWashingMachine({ anchor: S.prelavado.anchor });
  add(washingMachine);

  // ---------------- Corte: mesa, carrito con herramientas, tablero de pared ----------------
  const cuttingTable = createCuttingTable({ center: S.corte.anchor, size: S.corte.size });
  const cart = createToolCart({ position: [0.32, 0, -1.95] });
  const trayY = cart.topY;
  const scissors = createScissors();
  scissors.group.position.set(0.28, trayY, -2.0);
  scissors.group.rotation.y = 0.35;
  const rotaryCutter = createRotaryCutter();
  rotaryCutter.group.position.set(0.44, trayY, -1.87);
  rotaryCutter.group.rotation.y = -0.5;
  const chalk = createChalk();
  chalk.group.position.set(0.15, trayY + 0.006, -1.84);
  const pegboard = createPegboard({ x: -2.12, y: 1.5, z: -3.2, w: 0.7 });
  const ruler = createRulerSet();
  ruler.group.position.set(-2.42, 1.1, -3.2 + 0.016);
  ruler.group.rotation.x = Math.PI / 2;
  add(cuttingTable, cart, scissors, rotaryCutter, chalk, pegboard, ruler);

  // ---------------- Costura ----------------
  const sewingTable = createSewingTable({ center: S.costura.anchor, size: S.costura.size });
  const topC = S.costura.anchor[1];
  const sewingMachine = createSewingMachine({ needle: [1.16, -2.43], topY: topC });
  const overlock = createOverlock({ position: [1.76, -2.47], topY: topC, ry: -0.12 });
  const pedal = createPedal({ position: [1.24, 0, -2.2], cableTo: [1.02, 0.74, -2.74] });
  add(sewingTable, sewingMachine, overlock, pedal);

  // ---------------- Planchado ----------------
  const ironingBoard = createIroningBoard({ center: S.planchado.anchor, size: S.planchado.size });
  const iron = createIron({ cordAnchor: ironingBoard.cordAnchor, outlet: new THREE.Vector3(2.95, 0.32, -3.19) });
  iron.group.position.copy(ironingBoard.restPoint);
  add(ironingBoard, iron);
  group.add(iron.fx);

  // ---------------- Estampado ----------------
  const printTable = createPrintTable({ center: S.estampado.anchor, size: S.estampado.size });
  const topP = S.estampado.anchor[1];
  const screenPrint = createScreenPrint({ position: [4.97, -2.08], topY: topP });
  const heatPress = createHeatPress({ position: [5.52, -2.08], topY: topP });
  const embroideryMachine = createEmbroideryMachine({ needle: [6.0, -2.1], topY: topP });
  const squeegee = createSqueegee();
  squeegee.position.set(5.245, topP, -1.93);
  squeegee.rotation.y = Math.PI / 2;
  screenPrint.squeegee = squeegee;
  const flashDryer = createFlashDryer({ position: [4.45, -2.4], over: [screenPrint.frameCenter.x, 0, screenPrint.frameCenter.z], headY: 1.14, asideAngle: 0.9 });
  const hut = printTable.hutch;
  const paintKit = createPaintKit({ position: [4.95, hut.z + 0.01], topY: hut.shelves[0] });
  // pincel suelto: parado en el vaso de agua (rotación identidad = mango hacia arriba)
  const brush = createBrush({ color: '#2f5cb6' });
  brush.position.set(4.95 + 0.058, hut.shelves[0] + 0.006, hut.z + 0.01 + 0.068);
  paintKit.brush = brush;
  add(printTable, screenPrint, heatPress, embroideryMachine, flashDryer, paintKit);
  group.add(squeegee, brush);

  // ---------------- Exhibición y terminaciones ----------------
  const displayStand = createDisplayStand({ base: S.exhibicion.anchor, neck: S.exhibicion.shirtNeck });
  const labelKit = createLabelKit({ position: [-0.85, 0, 1.3], ry: 0.12 });
  const rug = createRug({ x: 0.2, z: 1.15 });
  // brazo exhibidor en la pared con remeras terminadas (de frente al taller)
  const rack = createWallDisplay({ x: 2.45, y: 1.98, z: -3.2, colors: ['#e5732b', '#93c6e6', '#f3f1ea', '#1f2a46'] });
  // perchero de pie con remeras de colores (rincón delantero derecho, fuera de las vistas de estación)
  const clothesRack = createClothesRack({ x: 3.85, z: 2.05, length: 1.2, ry: Math.PI / 2 - 0.25, colors: ['#f3f1ea', '#1e1e21', '#e5732b', '#93c6e6', '#f1cc4e', '#6a1f2c', '#8fd0b8', '#2f5cb6'] });
  add(displayStand, labelKit, rug, rack, clothesRack);

  // ---------------- Decoración de paredes ----------------
  const sign = createSign({ x: 0.18, y: 2.78, z: -3.2 });
  const posters = createPosters();
  const cork = createCorkBoard({ x: 3.55, y: 1.55, z: -3.2 });
  const clock = createClock({ x: 2.45, y: 2.42, z: -3.2, r: 0.15 });
  const curtains = createCurtains([
    { x: -1.0, w: 1.15, top: 2.47 },
    { x: 1.35, w: 1.05, top: 2.47 },
  ]);
  add(sign, posters, cork, clock, curtains, createFloorAO());

  // ---------------- Estático decorativo (un solo lote) ----------------
  const b = new Batch();

  // ---------------- Lámparas colgantes ----------------
  const lamps = [
    createPendantLamp({ x: -1.5, z: -1.78, y: 2.32, color: PALETTE.teal, b }),
    createPendantLamp({ x: -0.5, z: -1.78, y: 2.32, color: PALETTE.teal, b }),
    createPendantLamp({ x: 1.35, z: -2.55, y: 2.25, color: PALETTE.terracotta, b }),
    createPendantLamp({ x: 5.5, z: -2.2, y: 2.32, color: PALETTE.mustard, b }),
  ];
  add(...lamps);
  // herramientas chicas del carrito
  b.box(0.064, 0.022, 0.026, woodMaterial('nogal', { key: '-portatiza' }), { p: [0.15, trayY + 0.011, -1.84], cast: true });
  addPinCushion(b, { x: 0.17, y: trayY, z: -2.06 });
  addTapeMeasure(b, { x: 0.47, y: trayY, z: -1.92, edgeZ: 0.15, hang: 0.3, rim: 0.035, ry: 0 });
  // estante del lavadero con jabones, broches y toallas
  addWallShelf(b, { x: -3.0, y: 1.38, z: -3.2, w: 0.86, d: 0.22 });
  addLaundryShelfItems(b, { x: -3.0, y: 1.394, z: -3.09 });
  // repisa de estampado: potes de tinta y vinilos
  addInkTubs(b, { x: 4.92, y: hut.shelves[1], z: hut.z + 0.01, spacing: 0.115 });
  addVinylRolls(b, { x: 5.9, y: hut.shelves[1], z: hut.z + 0.01 });
  foldedStack(b, { x: 6.1, y: hut.shelves[0], z: hut.z + 0.01, w: 0.24, d: 0.15, colors: ['#f3f1ea', '#f3f1ea', '#1e1e21'] });
  // estante alto sobre la estación de estampado con cajas
  addWallShelf(b, { x: 5.55, y: 1.92, z: -3.2, w: 1.5, d: 0.26 });
  cardboardBox(b, { x: 6.0, y: 1.934, z: -3.06, w: 0.36, h: 0.22, d: 0.24, ry: 0.05 });
  cardboardBox(b, { x: 5.62, y: 1.934, z: -3.07, w: 0.3, h: 0.16, d: 0.22, ry: -0.06 });
  // banquetas
  addStool(b, { x: 1.28, z: -1.86, h: 0.5 });
  addStool(b, { x: -2.85, z: -0.5 });
  addStool(b, { x: 5.0, z: -1.3 });
  // cajas apiladas en rincones
  cardboardBox(b, { x: 6.66, z: -2.92, w: 0.5, h: 0.4, d: 0.44, ry: 0.1 });
  cardboardBox(b, { x: 6.64, y: 0.4, z: -2.94, w: 0.42, h: 0.3, d: 0.38, ry: -0.08 });
  // plantas
  addPlant(b, { x: -6.62, z: -2.85, kind: 'lengua', height: 1.05, seed: 3, potR: 0.2 });
  addPlant(b, { x: 6.65, z: -1.15, kind: 'arbusto', height: 0.95, seed: 7, potR: 0.2, pot: '#d9cfc0' });
  addPlant(b, { x: -2.85, z: 2.55, kind: 'arbusto', height: 1.15, seed: 11, potR: 0.22, scale: 1.15 });
  addPlant(b, { x: 3.15, z: 2.65, kind: 'lengua', height: 0.9, seed: 21, potR: 0.17, pot: '#d9cfc0' });
  addPlant(b, { x: 6.45, z: 2.9, kind: 'arbusto', height: 1.25, seed: 23, potR: 0.24, scale: 1.2 });
  addPlant(b, { x: -6.4, z: 2.6, kind: 'lengua', height: 1.1, seed: 29, potR: 0.2, pot: PALETTE.teal });
  addStool(b, { x: 5.9, z: 1.6, h: 0.45 });
  cardboardBox(b, { x: 6.55, z: 1.55, w: 0.5, h: 0.36, d: 0.42, ry: 0.15 });
  cardboardBox(b, { x: 6.5, y: 0.36, z: 1.57, w: 0.4, h: 0.26, d: 0.34, ry: -0.1, open: true });
  foldedStack(b, { x: 6.5, y: 0.37, z: 1.57, w: 0.3, d: 0.24, colors: ['#f0a9c4', '#f3f1ea', '#8fd0b8'], ry: -0.1 });
  cardboardBox(b, { x: -6.5, z: 1.7, w: 0.55, h: 0.4, d: 0.45, ry: -0.2 });
  addPlant(b, { x: -1.35, y: 1.175, z: -3.1, kind: 'arbusto', height: 0.18, seed: 5, potR: 0.06, scale: 0.55 });
  addPlant(b, { x: -0.62, y: 1.175, z: -3.1, kind: 'lengua', height: 0.22, seed: 9, potR: 0.055, scale: 0.6, pot: '#efe6d6' });
  addPlant(b, { x: 1.7, y: 1.175, z: -3.1, kind: 'arbusto', height: 0.16, seed: 13, potR: 0.055, scale: 0.5, pot: PALETTE.teal });
  addPlant(b, { x: -5.75, y: 2.03, z: -2.98, kind: 'arbusto', height: 0.2, seed: 17, potR: 0.07, scale: 0.6 });
  b.flush(group, 'decoracion');

  // ---------------- Sombras de contacto ----------------
  const shadows = createContactShadows([
    { x: -5.4, z: -2.95, w: 1.5, d: 0.46, o: 0.6 },
    { x: -4.05, z: -2.98, w: 0.82, d: 0.4, o: 0.6 },
    { x: -3.0, z: -2.75, w: 0.6, d: 0.56, o: 0.7 },
    { x: -2.45, z: -2.73, w: 0.42, d: 0.42, round: true, o: 0.6 },
    { x: -4.15, z: -2.0, w: 0.62, d: 0.62, round: true, o: 0.4 },
    { x: -1.0, z: -1.65, w: 2.0, d: 1.3, o: 0.45 },
    { x: 0.32, z: -1.95, w: 0.46, d: 0.36, o: 0.4 },
    { x: 1.35, z: -2.45, w: 1.3, d: 0.65, o: 0.45 },
    { x: 3.5, z: -1.95, w: 1.1, d: 0.42, o: 0.35 },
    { x: 5.55, z: -2.2, w: 1.7, d: 0.85, o: 0.45 },
    { x: 4.45, z: -2.4, w: 0.56, d: 0.56, round: true, o: 0.4 },
    { x: 0.2, z: 1.0, w: 1.05, d: 1.05, round: true, o: 0.6, y: 0.0095 },
    { x: -0.85, z: 1.3, w: 0.66, d: 0.42, o: 0.4, y: 0.0095 },
    { x: 1.28, z: -1.86, w: 0.4, d: 0.4, round: true, o: 0.4 },
    { x: -2.85, z: -0.5, w: 0.4, d: 0.4, round: true, o: 0.4 },
    { x: 5.0, z: -1.3, w: 0.4, d: 0.4, round: true, o: 0.4 },
    { x: -6.62, z: -2.85, w: 0.42, d: 0.42, round: true, o: 0.5 },
    { x: 6.65, z: -1.15, w: 0.42, d: 0.42, round: true, o: 0.5 },
    { x: -2.85, z: 2.55, w: 0.5, d: 0.5, round: true, o: 0.5 },
    { x: 3.15, z: 2.65, w: 0.4, d: 0.4, round: true, o: 0.5 },
    { x: 3.85, z: 2.05, w: 1.25, d: 0.5, o: 0.35, ry: Math.PI / 2 - 0.25 },
    { x: 6.45, z: 2.9, w: 0.55, d: 0.55, round: true, o: 0.5 },
    { x: -6.4, z: 2.6, w: 0.45, d: 0.45, round: true, o: 0.5 },
    { x: 5.9, z: 1.6, w: 0.4, d: 0.4, round: true, o: 0.4 },
    { x: 6.55, z: 1.55, w: 0.5, d: 0.42, o: 0.5, ry: 0.15 },
    { x: -6.5, z: 1.7, w: 0.55, d: 0.45, o: 0.5, ry: -0.2 },
    { x: 6.66, z: -2.92, w: 0.5, d: 0.44, o: 0.5 },
  ]);
  group.add(shadows);

  // ---------------- Modo exhibición ----------------
  const L = engine.lights || {};
  const base = {
    hemi: L.hemi?.intensity ?? 0,
    sun: L.sun?.intensity ?? 0,
    fill: L.fill?.intensity ?? 0,
    env: engine.scene.environmentIntensity ?? 1,
    lamps: lamps.map((l) => l.light.intensity),
  };
  let showcase = 0;
  let showcaseTarget = 0;
  const applyShowcase = (k) => {
    const dim = 1 - 0.68 * k;
    if (L.hemi) L.hemi.intensity = base.hemi * dim;
    if (L.sun) L.sun.intensity = base.sun * (1 - 0.75 * k);
    if (L.fill) L.fill.intensity = base.fill * dim;
    engine.scene.environmentIntensity = base.env * (1 - 0.55 * k);
    lamps.forEach((l, i) => (l.light.intensity = base.lamps[i] * (1 - 0.7 * k)));
  };

  const props = {
    shelf, threadRack, mannequinPreview, washingMachine,
    cuttingTable, scissors, rotaryCutter, chalk, ruler,
    sewingTable, sewingMachine, overlock,
    ironingBoard, iron,
    printTable, heatPress, screenPrint, flashDryer, embroideryMachine, paintKit,
    displayStand, labelKit,
  };
  const animated = [shelf, threadRack, washingMachine, sewingMachine, overlock, iron, heatPress, screenPrint, flashDryer, embroideryMachine, displayStand, clock];

  return {
    group,
    stations: STATIONS,
    props,
    extras: { cart, pegboard, rug, rack, clothesRack, lamps, room, sign, cork, clock, pedal },
    setShowcase(on) {
      showcaseTarget = on ? 1 : 0;
      displayStand.setOn(!!on);
    },
    update(dt, t) {
      for (const a of animated) a.update(dt, t);
      if (showcase !== showcaseTarget) {
        showcase = damp(showcase, showcaseTarget, 3.5, dt);
        if (Math.abs(showcase - showcaseTarget) < 0.002) showcase = showcaseTarget;
        applyShowcase(showcase);
      }
    },
  };
}
