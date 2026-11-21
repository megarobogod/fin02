// =====================================================
// audio.js - every sound is made in code (no sound files)
//
// Two building blocks, same as Project Sentinel:
//   tone()  - a beep that slides from one pitch to another
//   noise() - a burst of hiss through a filter (whooshes, thuds, cracks)
// Some sounds are also sent into a "reverb" so they echo like they're in
// a ruined cathedral.
// =====================================================

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /** Browsers only allow sound after a click, so this runs on the first click. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      // two seconds of hiss to cut noise sounds from
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      // home-made reverb: a decaying burst of noise is the "echo" of the room
      this.reverb = ctx.createConvolver();
      const len = ctx.sampleRate * 2.6;
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      this.reverb.buffer = ir;
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.5;
      this.reverb.connect(this.wet);
      this.wet.connect(this.master);

      this.startWind();
    } catch (err) {
      this.ctx = null;      // no sound available: the game still works
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
  }

  _out(gain, wet) {
    gain.connect(this.master);
    if (wet) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      gain.connect(s);
      s.connect(this.reverb);
    }
  }

  tone(type, from, to, dur, vol, o = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const atk = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this._out(g, o.wet);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(filterType, from, to, dur, vol, o = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (o.delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    const g = this.ctx.createGain();
    const atk = o.attack || 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    this._out(g, o.wet);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); lfo.start();
  }

  // ------------------------------------------------ the knight
  swing(heavy) {
    this.noise('bandpass', heavy ? 400 : 700, heavy ? 1800 : 2600, heavy ? 0.32 : 0.2, heavy ? 0.42 : 0.28, { q: 1.4, attack: 0.04 });
  }
  step() {
    this.tone('sine', 110, 45, 0.12, 0.22);
    this.noise('highpass', 4000, 2500, 0.05, 0.05);
  }
  roll() {
    this.noise('lowpass', 900, 200, 0.35, 0.3, { attack: 0.05 });
    for (let i = 0; i < 4; i++) this.noise('highpass', 5000, 3000, 0.03, 0.06, { delay: 0.05 + i * 0.07 });
  }
  hurt() {
    this.tone('sawtooth', 170, 85, 0.25, 0.22);
    this.noise('lowpass', 1200, 150, 0.2, 0.4);
  }
  block() {
    this.tone('triangle', 620, 560, 0.35, 0.22, { wet: 0.4 });
    this.tone('triangle', 910, 880, 0.3, 0.12, { wet: 0.4 });
    this.noise('lowpass', 1500, 200, 0.15, 0.4);
  }
  guardBreak() {
    this.block();
    this.noise('bandpass', 2500, 600, 0.4, 0.4, { q: 2 });
    this.tone('sawtooth', 300, 80, 0.4, 0.15);
  }
  parry() {
    for (const f of [1320, 1980, 2640, 3960]) this.tone('sine', f, f * 0.99, 0.9, 0.12, { wet: 0.9 });
    this.tone('triangle', 880, 870, 0.6, 0.25, { wet: 0.6 });
    this.noise('highpass', 6000, 3000, 0.08, 0.35);
    this.tone('sine', 1760, 1760, 0.4, 0.1, { delay: 0.09, wet: 0.8 });
  }
  slam() {
    this.tone('sine', 75, 24, 0.8, 0.9);
    this.noise('lowpass', 1600, 60, 0.7, 0.8);
    this.noise('highpass', 3000, 1200, 0.5, 0.15, { delay: 0.05 });
  }
  death() {
    this.tone('sawtooth', 200, 40, 1.2, 0.3, { wet: 0.5 });
    this.noise('lowpass', 900, 60, 1.0, 0.5);
  }

  // ------------------------------------------------ hitting angels
  hitBody(heavy) {
    this.tone('sine', heavy ? 120 : 150, 40, 0.18, heavy ? 0.8 : 0.6);
    this.noise('lowpass', 1600, 200, 0.14, 0.45);
    this.noise('highpass', 5000, 2500, 0.07, 0.18);
  }
  hitWeak() {
    // a crystal cracking: clean high ringing plus a crunch and a boom
    for (const f of [1870, 2650, 3910, 5230]) this.tone('sine', f, f * 0.97, 0.55, 0.09, { wet: 0.7 });
    this.noise('highpass', 7000, 2500, 0.18, 0.5);
    this.tone('sine', 95, 30, 0.35, 0.9);
    this.noise('bandpass', 1800, 500, 0.22, 0.35, { q: 3 });
  }
  clang() {
    // sword bouncing off armour
    for (const f of [1250, 1870, 2510, 3340]) this.tone('triangle', f, f * 0.995, 0.6, 0.07, { wet: 0.6 });
    this.noise('highpass', 5000, 3000, 0.06, 0.35);
  }
  shatter() {
    this.noise('bandpass', 3000, 7000, 0.35, 0.5, { q: 0.8 });
    for (let i = 0; i < 6; i++) {
      const f = 2000 + Math.random() * 4000;
      this.tone('sine', f, f * 0.9, 0.3, 0.05, { delay: Math.random() * 0.12, wet: 0.6 });
    }
    this.tone('sine', 110, 35, 0.4, 0.7);
  }
  haloSnap() {
    this.tone('sine', 2093, 2000, 0.8, 0.12, { wet: 0.8 });
    this.tone('sine', 1568, 1500, 0.8, 0.1, { wet: 0.8 });
    this.noise('highpass', 6000, 3000, 0.1, 0.4);
  }

  // ------------------------------------------------ angels
  choir(pitch = 1) {
    // a held "aaah" chord that swells and echoes
    const base = 220 * pitch;
    for (const r of [1, 1.26, 1.5, 2]) {
      this.tone('sine', base * r, base * r * 1.005, 2.6, 0.05, { attack: 0.6, wet: 1, detune: (Math.random() - 0.5) * 14 });
      this.tone('triangle', base * r, base * r, 2.2, 0.02, { attack: 0.8, wet: 1, detune: 8 });
    }
  }
  horn() {
    // the trumpet that announces a host
    this.tone('sawtooth', 220, 222, 1.4, 0.08, { attack: 0.15, wet: 1 });
    this.tone('sawtooth', 330, 332, 1.8, 0.07, { attack: 0.15, delay: 0.7, wet: 1 });
    this.tone('sine', 110, 111, 2.4, 0.12, { attack: 0.3, wet: 1 });
  }
  telegraph() {
    this.tone('sine', 900, 1400, 0.25, 0.07, { wet: 0.5 });
  }
  thrust() {
    this.noise('bandpass', 1500, 4000, 0.18, 0.3, { q: 2 });
  }
  beamCharge() {
    this.tone('sine', 300, 1300, 1.1, 0.1, { attack: 0.3, wet: 0.6 });
    this.tone('triangle', 600, 2600, 1.1, 0.04, { attack: 0.3 });
  }
  beamFire() {
    this.noise('bandpass', 4000, 800, 0.4, 0.5, { q: 1.5 });
    this.tone('square', 1800, 300, 0.35, 0.12);
    this.tone('sine', 140, 60, 0.4, 0.5);
  }
  burstCharge() {
    this.tone('sawtooth', 70, 200, 1.1, 0.12, { attack: 0.5 });
    this.choir(0.75);
  }
  burstFire() {
    this.tone('sine', 90, 25, 0.9, 0.9);
    this.noise('lowpass', 3000, 100, 0.8, 0.7);
    for (const f of [1320, 1760, 2200]) this.tone('sine', f, f, 1.2, 0.06, { wet: 1 });
  }
  ram() {
    this.noise('lowpass', 400, 1200, 0.8, 0.5, { attack: 0.2 });
    this.tone('sawtooth', 90, 140, 0.8, 0.1);
  }
  // ------------------------------------------------ the execution
  finisherHit() {
    // the world stops: a crack, a boom you feel in your chest, glass ringing
    this.tone('sine', 70, 18, 1.6, 1.0);
    this.noise('lowpass', 5000, 60, 1.2, 0.9);
    this.noise('highpass', 8000, 3000, 0.25, 0.6);
    for (const f of [1568, 2093, 2637, 3136, 4186]) this.tone('sine', f, f * 0.96, 2.2, 0.07, { wet: 1 });
    this.tone('sawtooth', 110, 55, 1.4, 0.12, { wet: 0.6 });
  }
  whoosh() {
    this.noise('bandpass', 300, 2400, 0.7, 0.45, { q: 1.2, attack: 0.25 });
  }
  unmakeBig() {
    this.noise('highpass', 400, 7000, 0.9, 0.35, { attack: 0.6 });
    this.tone('sine', 55, 16, 2.6, 1.0, { delay: 0.05 });
    this.noise('lowpass', 6000, 50, 2.2, 0.9, { delay: 0.05 });
    this.shatter();
    // a huge choir chord that falls away
    for (const f of [220, 277, 330, 440, 554, 660]) this.tone('sine', f, f * 0.5, 4.5, 0.07, { delay: 0.1, wet: 1, attack: 0.05 });
  }
  unmake() {
    // an angel coming apart: rising hiss, a crack, a falling chord
    this.noise('highpass', 800, 6000, 0.4, 0.25, { attack: 0.35 });
    this.shatter();
    for (const f of [880, 1108, 1318]) this.tone('sine', f, f * 0.5, 1.6, 0.06, { delay: 0.1, wet: 1 });
  }
}
