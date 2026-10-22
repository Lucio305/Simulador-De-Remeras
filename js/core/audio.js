// Sonidos sintetizados con WebAudio (no hace falta ningún archivo).
// Uso: audio.play('snip'), audio.loop('sewing') → handle.set(intensidad) / handle.stop().

let ctx = null;
let master = null;
let muted = false;
try {
  muted = localStorage.getItem('taller:mute') === '1';
} catch (e) {
  /* sin storage */
}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c, seconds = 1) {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

let _noise = null;
const noise = (c) => (_noise ||= noiseBuffer(c, 2));

function env(g, c, a, peak, d, end = 0.0001) {
  const t = c.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + d);
}

function tone(freq, { type = 'sine', a = 0.005, d = 0.2, vol = 0.3, slide = 0, delay = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t = c.currentTime + delay;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + a + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + a + d + 0.05);
}

function burst({ freq = 3000, q = 1, a = 0.002, d = 0.08, vol = 0.4, type = 'bandpass', delay = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random());
  s.stop(t + a + d + 0.05);
}

const SFX = {
  click: () => tone(880, { type: 'triangle', d: 0.06, vol: 0.12 }),
  select: () => {
    tone(660, { type: 'triangle', d: 0.08, vol: 0.12 });
    tone(990, { type: 'triangle', d: 0.1, vol: 0.1, delay: 0.05 });
  },
  snip: () => {
    burst({ freq: 4200, q: 2, d: 0.05, vol: 0.35 });
    burst({ freq: 2600, q: 3, d: 0.04, vol: 0.25, delay: 0.035 });
  },
  cut: () => burst({ freq: 1800, q: 0.8, d: 0.12, vol: 0.18 }),
  chalk: () => burst({ freq: 5200, q: 0.6, d: 0.06, vol: 0.08 }),
  thud: () => tone(120, { type: 'sine', d: 0.18, vol: 0.4, slide: -60 }),
  steam: () => burst({ freq: 6000, q: 0.3, a: 0.05, d: 0.6, vol: 0.18, type: 'highpass' }),
  hiss: () => burst({ freq: 3000, q: 0.4, a: 0.08, d: 1.2, vol: 0.12 }),
  press: () => {
    tone(90, { type: 'square', d: 0.15, vol: 0.12, slide: -30 });
    burst({ freq: 900, q: 1, d: 0.2, vol: 0.12 });
  },
  pop: () => tone(520, { type: 'sine', d: 0.09, vol: 0.2, slide: 300 }),
  good: () => {
    tone(523, { type: 'triangle', d: 0.15, vol: 0.18 });
    tone(659, { type: 'triangle', d: 0.15, vol: 0.18, delay: 0.09 });
    tone(784, { type: 'triangle', d: 0.25, vol: 0.18, delay: 0.18 });
  },
  bad: () => {
    tone(220, { type: 'sawtooth', d: 0.2, vol: 0.08 });
    tone(185, { type: 'sawtooth', d: 0.25, vol: 0.08, delay: 0.12 });
  },
  fanfare: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, { type: 'triangle', d: 0.3, vol: 0.16, delay: i * 0.11 }));
  },
  tick: () => tone(1500, { type: 'square', d: 0.02, vol: 0.04 }),
  splash: () => burst({ freq: 700, q: 0.5, a: 0.02, d: 0.5, vol: 0.25, type: 'lowpass' }),
  camera: () => {
    burst({ freq: 2500, q: 1, d: 0.04, vol: 0.3 });
    burst({ freq: 1500, q: 1, d: 0.06, vol: 0.25, delay: 0.07 });
  },
};

// Loops continuos parametrizables.
const LOOPS = {
  // Máquina de coser: zumbido de motor + golpeteo de aguja según la velocidad.
  sewing(c) {
    const out = c.createGain();
    out.gain.value = 0;
    const motor = c.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = 70;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const mg = c.createGain();
    mg.gain.value = 0.12;
    motor.connect(lp).connect(mg).connect(out);
    const thump = c.createOscillator();
    thump.type = 'square';
    thump.frequency.value = 8;
    const tg = c.createGain();
    tg.gain.value = 0.05;
    const tl = c.createBiquadFilter();
    tl.type = 'bandpass';
    tl.frequency.value = 1200;
    thump.connect(tl).connect(tg).connect(out);
    out.connect(master);
    motor.start();
    thump.start();
    return {
      set(v) {
        const t = c.currentTime;
        out.gain.setTargetAtTime(v > 0.01 ? 0.25 + v * 0.5 : 0, t, 0.05);
        motor.frequency.setTargetAtTime(60 + v * 110, t, 0.05);
        thump.frequency.setTargetAtTime(4 + v * 18, t, 0.05);
      },
      stop() {
        out.gain.setTargetAtTime(0, c.currentTime, 0.05);
        setTimeout(() => {
          motor.stop();
          thump.stop();
          out.disconnect();
        }, 300);
      },
    };
  },
  // Ruido filtrado continuo (lavarropas, vapor, prensa)
  rumble(c) {
    const out = c.createGain();
    out.gain.value = 0;
    const s = c.createBufferSource();
    s.buffer = noise(c);
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    s.connect(f).connect(out).connect(master);
    s.start();
    return {
      set(v, freq = 400) {
        const t = c.currentTime;
        out.gain.setTargetAtTime(v * 0.35, t, 0.1);
        f.frequency.setTargetAtTime(freq, t, 0.1);
      },
      stop() {
        out.gain.setTargetAtTime(0, c.currentTime, 0.08);
        setTimeout(() => {
          s.stop();
          out.disconnect();
        }, 400);
      },
    };
  },
  steam(c) {
    const out = c.createGain();
    out.gain.value = 0;
    const s = c.createBufferSource();
    s.buffer = noise(c);
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 4000;
    s.connect(f).connect(out).connect(master);
    s.start();
    return {
      set(v) {
        out.gain.setTargetAtTime(v * 0.2, c.currentTime, 0.08);
      },
      stop() {
        out.gain.setTargetAtTime(0, c.currentTime, 0.08);
        setTimeout(() => {
          s.stop();
          out.disconnect();
        }, 400);
      },
    };
  },
};

export const audio = {
  play(name) {
    if (muted) return;
    try {
      SFX[name] && SFX[name]();
    } catch (e) {
      /* audio no disponible */
    }
  },
  loop(name) {
    const c = ac();
    if (!c || !LOOPS[name]) return { set() {}, stop() {} };
    try {
      return LOOPS[name](c);
    } catch (e) {
      return { set() {}, stop() {} };
    }
  },
  get muted() {
    return muted;
  },
  setMuted(v) {
    muted = !!v;
    try {
      localStorage.setItem('taller:mute', muted ? '1' : '0');
    } catch (e) {
      /* sin storage */
    }
    if (master) master.gain.value = muted ? 0 : 0.6;
  },
  // Llamar en el primer gesto del usuario para habilitar el audio.
  unlock() {
    ac();
  },
};
