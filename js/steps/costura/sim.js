// Simulación de una costura: pedal (la velocidad sube de a poco y al soltar frena), ciclo de la
// aguja sincronizado con la animación de la máquina, arrastre intermitente de la tela (los dientes
// empujan solo con la aguja arriba), guía lateral con la mano o el teclado (con límite de
// velocidad: en las curvas, ir rápido hace que cueste seguir la línea), deriva de la tela,
// remates, puntadas salteadas y cortes de hilo según el hilo y la aguja elegidos.

import { clamp, rng as makeRng } from '../../core/utils.js';
import { pieceAt, stitchAccuracy } from './rules.js';

const TAU = Math.PI * 2;
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

// ∫ max(0, cos t) dt desde 0 hasta φ (creciente, 2 por vuelta).
function feedIntegral(phi) {
  const k = Math.floor(phi / TAU);
  const f = phi - k * TAU;
  let r;
  if (f < Math.PI / 2) r = Math.sin(f);
  else if (f < (3 * Math.PI) / 2) r = 1;
  else r = 2 + Math.sin(f);
  return k * 2 + r;
}

export const MACHINE_RATES = { maquina: 9, overlock: 12 }; // puntadas por segundo a fondo
const HAND_MAX = 0.036; // m/s que la mano puede correr la tela con la máquina quieta
const EDGE_V = 0.0035; // la tira de tela sigue unos mm más allá de cada punta de la tiza
const OFF_EDGE = 0.0006; // la aguja que cae a más de esto del canto de la tela ya no la pincha

export class SewingSim {
  constructor({ course, stitchId, stitchLength = 2.5, machine = 'maquina', issues = {}, seed = 1 }) {
    this.course = course;
    this.stitchId = stitchId;
    this.len = stitchLength / 1000;
    this.machine = machine;
    this.rate = MACHINE_RATES[machine] || 9;
    this.issues = issues;
    this.rng = makeRng(seed);
    const p0 = course.pieces[0];
    this.start = p0.a;
    this.end = course.end;
    this.p = p0.a + 0.0015;
    this.maxP = this.p;
    // la tela entra un poco corrida: hay que acomodarla antes de arrancar
    this.fx = -(p0.g(p0.a) + 0.0035 * (this.rng() < 0.5 ? -1 : 1));
    this.target = this.fx;
    this.grab = null;
    this.pilot = null;
    this.keyDir = 0;
    this.keyVel = 0;
    this.pedalHeld = false;
    this.reverseHeld = false;
    this.pedal = 0;
    this.prevTarget = 0;
    this.speed = 0;
    this.phase = 0;
    this.locked = 0;
    this.done = false;
    this.t = 0;
    this.n = [this.rng() * 6, this.rng() * 6, this.rng() * 6];
    // estadísticas
    this.stitches = 0;
    this.scored = 0;
    this.accSum = 0;
    this.errSum = 0;
    this.skips = 0;
    this.breaks = 0;
    this.outs = 0;
    this.revStart = 0;
    this.revEnd = 0;
    this.lastErr = 0;
    this.lastAcc = 1;
    this.zig = 0;
    this.time = 0;
    this.sewTime = 0;
    this._warnT = 0;
  }

  // Desvío lateral actual de la aguja respecto de la guía (m, + = hacia el borde). En el hueco
  // entre dos tramos se mide contra el arranque del tramo que viene.
  currentError() {
    return -this.fx - this.course.guideAt(this.p).g;
  }

  // true mientras la aguja está en el hueco entre dos tramos (costura en cadena).
  inGap() {
    return this.course.guideAt(this.p).gap;
  }

  // Velocidad máxima recomendada según la curva que viene (0..1).
  recommendedSpeed() {
    let s = 0;
    for (let i = 0; i <= 8; i++) s = Math.max(s, this.course.slopeAt(this.p + i * 0.005));
    const feedMax = this.len * this.rate;
    const cap = 0.7 * HAND_MAX;
    return clamp(cap / (s * feedMax + cap * 0.5 + 1e-6), 0.2, 1);
  }

  progress() {
    return clamp((this.maxP - this.start) / (this.end - this.start));
  }

  grabAt(handX) {
    this.grab = handX === null || handX === undefined ? null : this.fx - handX;
  }

  release() {
    this.grab = null;
  }

  // dt: segundos; handX: x (frame) de la mano sobre la cama, o null.
  update(dt, handX = null) {
    const ev = [];
    this.t += dt;
    this.time += dt;
    // ----- máquina (emulada igual que el prop, con el objetivo del cuadro anterior) -----
    const tgt = this.prevTarget;
    const ph0 = this.phase;
    if (this.machine === 'overlock') {
      this.speed = damp(this.speed, tgt, 8, dt);
      this.phase += this.speed * TAU * this.rate * dt;
    } else {
      this.speed = damp(this.speed, tgt, 10, dt);
      if (this.speed < 0.002 && tgt === 0) {
        const rest = Math.round(this.phase / TAU) * TAU;
        this.phase = damp(this.phase, rest, 8, dt);
        this.speed = 0;
      } else this.phase += this.speed * TAU * this.rate * dt;
    }
    const dphi = this.phase - ph0;
    if (this.speed > 0.05) this.sewTime += dt;

    // ----- arrastre de la tela -----
    if (dphi > 0 && !this.done) {
      const cyc = (feedIntegral(this.phase) - feedIntegral(ph0)) / 2;
      const dir = this.reverseHeld ? -0.8 : 1;
      this.p += cyc * this.len * dir;
      this.p = Math.max(this.p, this.start - 0.002);
      this.maxP = Math.max(this.maxP, this.p);
    }

    // ----- guía lateral -----
    const cosNow = Math.cos(this.phase);
    const needleIn = this.speed > 0.03 && cosNow < -0.6;
    const maxLat = HAND_MAX * (1 - 0.5 * this.speed);
    const n = this.n;
    const noise = Math.sin(this.t * 1.3 + n[0]) * 0.6 + Math.sin(this.t * 2.9 + n[1]) * 0.3 + Math.sin(this.t * 0.53 + n[2]) * 0.45;
    const drift = this.course.drift * noise * this.speed;
    if (this.pilot !== null && this.pilot !== undefined) {
      this.target = this.pilot;
      if (!needleIn) this.fx += drift * dt;
    } else if (this.grab !== null && handX !== null) {
      this.grab += drift * dt;
      this.target = handX + this.grab;
    } else {
      this.keyVel = damp(this.keyVel, this.keyDir * HAND_MAX * 0.6, 9, dt);
      this.target = this.fx + this.keyVel / 14;
      if (!needleIn) this.fx += drift * dt;
    }
    if (!needleIn) {
      const want = clamp((this.target - this.fx) * 14, -maxLat, maxLat);
      this.fx += want * dt;
    }
    this.fx = clamp(this.fx, -0.06, 0.06);

    // ----- puntada: la aguja pasa por abajo (φ ≡ π) -----
    const k0 = Math.floor((ph0 - Math.PI) / TAU);
    const k1 = Math.floor((this.phase - Math.PI) / TAU);
    if (dphi > 0 && k1 > k0 && !this.done) ev.push(this._stitch());

    // ----- pedal -----
    if (this.locked > 0) this.locked -= dt;
    if (this.pedalHeld && this.locked <= 0 && !this.done) this.pedal = Math.min(1, Math.max(this.pedal, 0.2) + dt * 0.72);
    else this.pedal = Math.max(0, this.pedal - dt * 4.5);
    this.prevTarget = this.pedal;

    // ----- fin -----
    if (!this.done && this.p >= this.end + 0.003) {
      this.done = true;
      this.pedal = 0;
      this.prevTarget = 0;
      ev.push({ type: 'done' });
    }
    this._warnT -= dt;
    return ev;
  }

  _stitch() {
    const v = this.p;
    const u = -this.fx;
    const pieces = this.course.pieces;
    const pc = pieceAt(pieces, v); // dentro de la línea de tiza (cuenta para la precisión)
    const near = pc || pieceAt(pieces, v, EDGE_V); // la tira sobra unos mm en cada punta
    const rev = this.reverseHeld;
    this.stitches++;
    const e = { type: 'stitch', v, u, reverse: rev, onFabric: !!near, skipped: false, err: 0, speed: this.speed };
    if (this.machine !== 'overlock' && this.issues.skip && this.rng() < this.issues.skip) {
      e.skipped = true;
      this.skips++;
    }
    if (near) {
      const err = u - near.g(clamp(v, near.a, near.b));
      e.err = err;
      // más allá del canto de la tela la aguja cose en el aire: no queda puntada (y no suma precisión)
      if (err > (this.course.edge ?? this.course.allow + 0.0014) + OFF_EDGE) {
        e.onFabric = false;
        e.offEdge = true;
      }
      if (pc) {
        this.lastErr = err;
        if (!rev) {
          const acc = stitchAccuracy(err * 1000);
          this.lastAcc = acc;
          this.accSum += acc;
          this.errSum += Math.abs(err);
          this.scored++;
        }
        if ((err > this.course.allow + 0.0005 || err < -0.009) && this._warnT <= 0) {
          this.outs++;
          this._warnT = 1.2;
          e.warn = e.offEdge ? 'off' : err > 0 ? 'edge' : 'inside';
        }
      }
    }
    // remates: puntadas hacia atrás cerca de cada punta (también si se arranca ya en reversa: la
    // tela retrocede hasta el canto y la máquina da las puntadas en el lugar)
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    if (rev && !e.offEdge && v >= first.a - EDGE_V && v <= first.a + 0.024) this.revStart++;
    if (rev && !e.offEdge && v >= last.b - 0.024 && v <= last.b + EDGE_V) this.revEnd++;
    // hilo débil: se corta (más a toda velocidad)
    if (this.issues.breakRate && pc && this.rng() < this.issues.breakRate * (0.25 + this.speed * this.speed)) {
      e.broken = true;
      this.breaks++;
      this.locked = 1.4;
      this.pedal = 0;
    }
    return e;
  }

  accuracy() {
    return this.scored ? this.accSum / this.scored : 0;
  }

  meanErrMm() {
    return this.scored ? (this.errSum / this.scored) * 1000 : 0;
  }
}
