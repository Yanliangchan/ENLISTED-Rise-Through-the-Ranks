/**
 * Landing-page ambience + UI audio, fully synthesised with WebAudio (the
 * project has no sample pipeline — same approach as the in-game
 * AudioManager). Everything is deliberately quiet and randomised so the loop
 * never reads as repetitive:
 *
 *  - night wind bed (slow-breathing filtered noise)
 *  - jungle insects (randomised chirp bursts)
 *  - distant gunfire exchanges (low filtered thumps, random pan/count)
 *  - helicopter rotor flybys (triggered by the skyline background)
 *  - military radio chatter (squelch clicks + vocal-band AM noise)
 *  - UI: hover warning tone, click, typing ticks, deploy alarm, static
 *
 * Browsers refuse an AudioContext before a user gesture, so `unlock()` is
 * called from pointer/key handlers and everything no-ops until then.
 */
export class AmbienceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private started = false;
  private timers: number[] = [];
  private disposed = false;
  muted = false;

  /** Create/resume the context — must be called from a user-gesture handler. */
  unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoiseBuffer(2.5);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.started && this.ctx.state !== "suspended") {
      this.started = true;
      this.startWind();
      this.scheduleCrickets();
      this.scheduleGunfire();
      this.scheduleChatter();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.15);
    }
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private later(delayMs: number, fn: () => void): void {
    if (this.disposed) return;
    this.timers.push(window.setTimeout(() => { if (!this.disposed) fn(); }, delayMs));
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = true;
    return src;
  }

  // =========================================================================
  // Continuous beds
  // =========================================================================

  /** Low filtered noise with a very slow gain LFO — night wind through the treeline. */
  private startWind(): void {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.018;
    lfo.connect(lfoDepth).connect(gain.gain);
    src.connect(lp).connect(gain).connect(this.master!);
    src.start();
    lfo.start();
  }

  /** Short high sine blips in irregular bursts — tropical night insects. */
  private scheduleCrickets(): void {
    const burst = () => {
      const ctx = this.ctx!;
      const n = 2 + Math.floor(Math.random() * 4);
      const baseFreq = 4200 + Math.random() * 900;
      for (let i = 0; i < n; i++) {
        const t = ctx.currentTime + i * (0.055 + Math.random() * 0.03);
        const osc = ctx.createOscillator();
        osc.frequency.value = baseFreq + Math.random() * 120;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.008 + Math.random() * 0.005, t);
        g.gain.exponentialRampToValueAtTime(0.0004, t + 0.03);
        osc.connect(g).connect(this.master!);
        osc.start(t);
        osc.stop(t + 0.04);
      }
      this.later(700 + Math.random() * 2200, burst);
    };
    this.later(400, burst);
  }

  /** A distant small-arms exchange: 2–7 low muffled thumps, randomly panned. */
  private scheduleGunfire(): void {
    const exchange = () => {
      const ctx = this.ctx!;
      const shots = 2 + Math.floor(Math.random() * 6);
      const pan = (Math.random() * 2 - 1) * 0.7;
      let t = ctx.currentTime + 0.05;
      for (let i = 0; i < shots; i++) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf!;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 220 + Math.random() * 120;
        const g = ctx.createGain();
        const vol = 0.05 + Math.random() * 0.03;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        const p = ctx.createStereoPanner();
        p.pan.value = pan + (Math.random() - 0.5) * 0.1;
        src.connect(lp).connect(g).connect(p).connect(this.master!);
        src.start(t);
        src.stop(t + 0.25);
        t += 0.09 + Math.random() * 0.16;
      }
      this.later(9000 + Math.random() * 17000, exchange);
    };
    this.later(5000 + Math.random() * 6000, exchange);
  }

  /** Radio chatter: squelch click, a second of vocal-band AM noise, closing click. */
  private scheduleChatter(): void {
    const transmit = () => {
      const ctx = this.ctx!;
      const t0 = ctx.currentTime + 0.02;
      const dur = 0.7 + Math.random() * 1.1;
      this.squelchClick(t0);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf!;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1050 + Math.random() * 250;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.02, t0 + 0.06);
      g.gain.setValueAtTime(0.02, t0 + dur - 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      // Vocal-ish amplitude modulation so it reads as speech, not static.
      const am = ctx.createOscillator();
      am.type = "square";
      am.frequency.value = 4.5 + Math.random() * 3.5;
      const amDepth = ctx.createGain();
      amDepth.gain.value = 0.011;
      am.connect(amDepth).connect(g.gain);
      src.connect(bp).connect(g).connect(this.master!);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
      am.start(t0);
      am.stop(t0 + dur + 0.05);
      this.squelchClick(t0 + dur + 0.06);
      this.later(14000 + Math.random() * 22000, transmit);
    };
    this.later(7000 + Math.random() * 9000, transmit);
  }

  private squelchClick(atTime: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, atTime);
    g.gain.exponentialRampToValueAtTime(0.001, atTime + 0.05);
    src.connect(hp).connect(g).connect(this.master!);
    src.start(atTime);
    src.stop(atTime + 0.06);
  }

  // =========================================================================
  // Event sounds
  // =========================================================================

  /** Rotor wash panned across the stereo field for the on-screen flyby. */
  heliFlyby(durationSec: number, fromPan: number, toPan: number): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + durationSec * 0.35);
    g.gain.setValueAtTime(0.05, t0 + durationSec * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t0 + durationSec);
    // Blade-pass amplitude chop.
    const chop = ctx.createOscillator();
    chop.type = "square";
    chop.frequency.value = 12.5;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.03;
    chop.connect(chopDepth).connect(g.gain);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(fromPan * 0.8, t0);
    pan.pan.linearRampToValueAtTime(toPan * 0.8, t0 + durationSec);
    src.connect(lp).connect(g).connect(pan).connect(this.master!);
    src.start(t0);
    src.stop(t0 + durationSec + 0.1);
    chop.start(t0);
    chop.stop(t0 + durationSec + 0.1);
  }

  /** Two-tone warning blip for hovering the deploy button. */
  uiHover(): void {
    this.tone(660, 0.045, "sine", 0.022);
    this.later(55, () => this.tone(880, 0.05, "sine", 0.02));
  }

  uiClick(): void {
    this.tone(240, 0.05, "square", 0.03);
  }

  /** Per-character terminal tick. */
  typeTick(): void {
    this.tone(1300 + Math.random() * 350, 0.014, "square", 0.014);
  }

  /** Confirmation chirp when a terminal line completes. */
  lineDone(): void {
    this.tone(980, 0.06, "sine", 0.025);
  }

  /** Descending klaxon + static when DEPLOY is pressed. */
  deployAlarm(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.4;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(840, t);
      osc.frequency.exponentialRampToValueAtTime(430, t + 0.32);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.045, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.38);
    }
    this.staticBurst(0.35);
  }

  staticBurst(durationSec = 0.2): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
    src.connect(hp).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + durationSec + 0.05);
  }

  private tone(freq: number, durationSec: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || this.ctx.state === "suspended") return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0004, ctx.currentTime + durationSec);
    osc.connect(g).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + durationSec + 0.02);
  }

  /** Fade out and tear down — called when the page hands off to the game. */
  dispose(fadeSec = 1.2): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, fadeSec / 3);
      const ctx = this.ctx;
      window.setTimeout(() => void ctx.close().catch(() => {}), fadeSec * 1000 + 300);
    }
    this.ctx = null;
  }
}
