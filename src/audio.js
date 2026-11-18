// 全程序化 WebAudio 音效系统（无任何音频文件）

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.heartTimer = 0;
    this.heartOn = false;
    this.tension = 0;
    this.ambientNodes = [];
    this.hidden = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;

    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 20;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.25;

    this.master.connect(this.muffle);
    this.muffle.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    this.noiseBuffer = this.buildNoise(3);
    this.startAmbient();
    this.ready = true;
  }

  buildNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  // ---------------------------------------------------------------- 环境

  startAmbient() {
    const ctx = this.ctx;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.018;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    lp.Q.value = 4;

    for (const f of [41.2, 41.9, 61.7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      osc.connect(g);
      g.connect(lp);
      osc.start();
      this.ambientNodes.push(osc);
    }
    lp.connect(droneGain);
    droneGain.connect(this.master);

    // 缓慢移动的低频噪声
    const noise = this.noiseSource();
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 220;
    nf.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.02;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(this.master);
    noise.start();
    this.ambientNodes.push(noise);

    // 鬼靠近时的低频隆隆声
    const rumble = this.noiseSource();
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 90;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(rlp);
    rlp.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);
    rumble.start();
    this.ambientNodes.push(rumble);

    // 心跳
    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0.0001;
    this.heartGain.connect(this.master);
  }

  // ---------------------------------------------------------------- 基础音色

  env(node, t0, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  tone({ freq = 200, type = 'sine', attack = 0.01, decay = 0.3, gain = 0.1, slideTo = null, dest = null }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + attack + decay);
    const g = this.env(osc, t0, attack, decay, gain);
    g.connect(dest || this.master);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.06);
  }

  noiseBurst({ freq = 800, q = 1.2, attack = 0.004, decay = 0.12, gain = 0.12, rate = 1 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const src = this.noiseSource();
    src.playbackRate.value = rate;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t0);
    bp.Q.value = q;
    src.connect(bp);
    const g = this.env(bp, t0, attack, decay, gain);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + attack + decay + 0.05);
  }

  // ---------------------------------------------------------------- 事件音效

  footstep(running, crouching = false) {
    if (!this.ready) return;
    const strength = running ? 1 : crouching ? 0.28 : 0.62;
    const heel = 130 + Math.random() * 30;
    this.tone({ freq: heel, slideTo: heel * 0.8, attack: 0.004, decay: 0.11, gain: 0.22 * strength });
    this.noiseBurst({
      freq: 600 + Math.random() * 450,
      q: 0.85,
      decay: running ? 0.115 : 0.09,
      gain: 0.28 * strength,
      rate: 0.8 + Math.random() * 0.5,
    });
  }

  beep(strength = 0.5) {
    if (!this.ready) return;
    const f = 620 + strength * 900;
    this.tone({ freq: f, type: 'square', attack: 0.002, decay: 0.05, gain: 0.035 + strength * 0.035 });
  }

  doorCreak() {
    if (!this.ready) return;
    this.tone({ freq: 78, type: 'sawtooth', attack: 0.15, decay: 0.9, gain: 0.035, slideTo: 132 });
    this.noiseBurst({ freq: 900, q: 3, attack: 0.2, decay: 0.7, gain: 0.02 });
  }

  whisper() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150;
    bp.Q.value = 8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 420;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.035, t0 + 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 1.9);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    src.connect(bp);
    bp.connect(g);
    g.connect(pan);
    pan.connect(this.master);
    src.start(t0);
    lfo.start(t0);
    src.stop(t0 + 2.0);
    lfo.stop(t0 + 2.0);
  }

  stinger() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    for (const [i, f] of [110, 116, 155].entries()) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 3.4, t0 + 1.1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05 - i * 0.008, t0 + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      osc.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 1.5);
    }
    this.noiseBurst({ freq: 1800, q: 0.8, attack: 0.05, decay: 0.8, gain: 0.06 });
  }

  catchSound() {
    if (!this.ready) return;
    this.tone({ freq: 52, type: 'sine', attack: 0.005, decay: 1.4, gain: 0.4, slideTo: 28 });
    this.noiseBurst({ freq: 300, q: 0.6, attack: 0.01, decay: 0.7, gain: 0.25 });
    this.tone({ freq: 900, type: 'sawtooth', attack: 0.005, decay: 0.6, gain: 0.08, slideTo: 120 });
  }

  foundSound() {
    if (!this.ready) return;
    this.tone({ freq: 174, type: 'sine', attack: 0.02, decay: 1.2, gain: 0.12, slideTo: 116 });
    this.tone({ freq: 261, type: 'sine', attack: 0.02, decay: 0.9, gain: 0.06 });
  }

  transitionRinging() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    for (const f of [3100, 4380]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.012, t0 + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 2.4);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 2.5);
    }
    this.tone({ freq: 60, type: 'sine', attack: 0.1, decay: 2.0, gain: 0.18 });
  }

  breath() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.03, t0 + 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 1.1);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    src.connect(bp);
    bp.connect(g);
    g.connect(pan);
    pan.connect(this.master);
    src.start(t0);
    src.stop(t0 + 1.2);
  }

  uiClick() {
    if (!this.ready) return;
    this.tone({ freq: 1400, type: 'sine', attack: 0.002, decay: 0.04, gain: 0.04 });
  }

  // ---------------------------------------------------------------- 每帧

  setHidden(hidden) {
    if (!this.ready || this.hidden === hidden) return;
    this.hidden = hidden;
    const target = hidden ? 700 : 20000;
    this.muffle.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.15);
    this.master.gain.setTargetAtTime(hidden ? 0.32 : 0.55, this.ctx.currentTime, 0.2);
  }

  update(dt, tension = 0, hunt = false) {
    if (!this.ready) return;
    if (!Number.isFinite(tension)) tension = 0;
    tension = Math.max(0, Math.min(1, tension));
    this.tension += (tension - this.tension) * Math.min(1, dt * 4);

    if (this.rumbleGain) {
      const target = this.tension * this.tension * 0.11;
      this.rumbleGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }

    const needBeat = this.tension > 0.08 || hunt;
    if (needBeat) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const interval = 1.18 - this.tension * 0.72 - (hunt ? 0.12 : 0);
        this.heartTimer = Math.max(0.32, interval);
        this.heartbeat(hunt ? 1 : this.tension);
      }
    }
  }

  heartbeat(intensity = 0.5) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const g = 0.1 + intensity * 0.22;
    this.tone({ freq: 58, type: 'sine', attack: 0.004, decay: 0.16, gain: g, slideTo: 40 });
    setTimeout(() => {
      if (!this.ready) return;
      this.tone({ freq: 50, type: 'sine', attack: 0.004, decay: 0.13, gain: g * 0.7, slideTo: 34 });
    }, 145);
  }
}
