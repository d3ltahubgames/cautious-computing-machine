// AudioEngine.js — every sound in the game is synthesized at runtime with the
// Web Audio API. Nothing is loaded from disk, so there are no missing-asset
// failure modes.
window.TFPS = window.TFPS || {};

TFPS.AudioEngine = class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this._spikeTimer = null;
    this._defuseNode = null;
    this._unlocked = false;
  }

  // Must be called from within a user gesture (we hook it to the pointer-lock click).
  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this._buildNoiseBuffer(2);
  }

  _buildNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, rate * seconds, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  _env(node, param, now, attack, sustain, release, peak) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(peak, now + attack);
    param.linearRampToValueAtTime(peak * 0.7, now + attack + sustain);
    param.exponentialRampToValueAtTime(0.0001, now + attack + sustain + release);
  }

  playGunshot(weaponId) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const specs = {
      pistol: { f0: 1600, f1: 400, dur: 0.10, gain: 0.5, tone: 90 },
      smg: { f0: 2200, f1: 500, dur: 0.07, gain: 0.42, tone: 130 },
      rifle: { f0: 2600, f1: 250, dur: 0.14, gain: 0.62, tone: 70 },
      sniper: { f0: 3200, f1: 120, dur: 0.32, gain: 0.85, tone: 45 },
    };
    const s = specs[weaponId] || specs.pistol;

    const noise = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(s.f0, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(s.f1, 40), now + s.dur);
    filter.Q.value = 0.9;
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.002, s.dur * 0.3, s.dur * 0.7, s.gain);
    noise.connect(filter).connect(g).connect(this.master);
    noise.start(now); noise.stop(now + s.dur + 0.05);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(s.tone, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(s.tone * 0.4, 20), now + s.dur);
    const og = this.ctx.createGain();
    this._env(og, og.gain, now, 0.001, s.dur * 0.2, s.dur * 0.6, s.gain * 0.6);
    osc.connect(og).connect(this.master);
    osc.start(now); osc.stop(now + s.dur + 0.05);
  }

  playFootstep(indoor) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const noise = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = indoor ? 380 + Math.random() * 120 : 500 + Math.random() * 200;
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.001, 0.02, 0.06, 0.16);
    noise.connect(filter).connect(g).connect(this.master);
    noise.start(now); noise.stop(now + 0.1);
  }

  playReload() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.12;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 500 + i * 220;
      const g = this.ctx.createGain();
      this._env(g, g.gain, t, 0.001, 0.02, 0.05, 0.12);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.1);
    }
  }

  playHitmarker(kind) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freq = kind === 'kill' ? 1400 : kind === 'headshot' ? 1100 : 800;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (kind === 'kill') osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.15);
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.001, 0.05, kind === 'kill' ? 0.2 : 0.08, 0.35);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + 0.3);
  }

  playDamageGrunt() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.2);
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.001, 0.06, 0.15, 0.3);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + 0.25);
  }

  playFlashPop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const noise = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.001, 0.05, 0.3, 0.8);
    noise.connect(filter).connect(g).connect(this.master);
    noise.start(now); noise.stop(now + 0.4);
  }

  playSmokeHiss() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const noise = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.6;
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.05, 0.4, 0.6, 0.25);
    noise.connect(filter).connect(g).connect(this.master);
    noise.start(now); noise.stop(now + 1.1);
  }

  playBuySound() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.06);
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.001, 0.05, 0.1, 0.25);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + 0.2);
  }

  playRoundEndSting(won) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = won ? [440, 554, 659, 880] : [440, 392, 349, 261];
    notes.forEach((f, i) => {
      const t = now + i * 0.14;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, g.gain, t, 0.01, 0.12, 0.2, 0.3);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.4);
    });
  }

  playPlantTick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 900;
    const g = this.ctx.createGain();
    this._env(g, g.gain, now, 0.001, 0.02, 0.04, 0.15);
    osc.connect(g).connect(this.master);
    osc.start(now); osc.stop(now + 0.1);
  }

  // Beeps that accelerate as the spike timer approaches zero. Call once;
  // internally reschedules itself until stopSpikeBeep() is called.
  startSpikeBeep(getRemainingFn, totalDuration) {
    this.stopSpikeBeep();
    const tick = () => {
      if (!this.ctx) return;
      const remaining = getRemainingFn();
      if (remaining <= 0) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1200;
      const g = this.ctx.createGain();
      this._env(g, g.gain, now, 0.001, 0.03, 0.05, 0.3);
      osc.connect(g).connect(this.master);
      osc.start(now); osc.stop(now + 0.1);
      const frac = TFPS.Utils.clamp(remaining / totalDuration, 0, 1);
      const interval = TFPS.Utils.lerp(140, 900, frac * frac);
      this._spikeTimer = setTimeout(tick, interval);
    };
    tick();
  }

  stopSpikeBeep() {
    if (this._spikeTimer) { clearTimeout(this._spikeTimer); this._spikeTimer = null; }
  }

  startDefuseLoop() {
    if (!this.ctx) return;
    this.stopDefuseLoop();
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 520;
    const g = this.ctx.createGain();
    g.gain.value = 0.18;
    osc.connect(g).connect(this.master);
    osc.start();
    this._defuseNode = { osc, g };
  }

  stopDefuseLoop() {
    if (this._defuseNode) {
      try {
        const now = this.ctx.currentTime;
        this._defuseNode.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
        this._defuseNode.osc.stop(now + 0.2);
      } catch (e) { /* already stopped */ }
      this._defuseNode = null;
    }
  }
};
