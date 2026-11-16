import { Surf } from "~/gfx/builder";

/**
 * Sound, fully synthesised with the Web Audio API (there are no sample files).
 * Gunshots are layered — crack, body, low thump, mechanical clatter — and fed
 * into a generated urban reverb; distant fire is delayed by the speed of sound,
 * low-passed and panned from the listener's heading. Ambience layers tropical
 * insects, birds, wind and a far-off battle.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbGain!: GainNode;
  private noise!: AudioBuffer;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private ambienceOn = false;
  private muffle!: BiquadFilterNode;
  volume = 0.8;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Reverb: decaying noise with a few discrete early slaps (street between tall blocks).
    const rl = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const b = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < rl; i++) {
        const t = i / ctx.sampleRate;
        const env = Math.exp(-t * 3.1);
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - Math.min(0.42, t * 0.25));
        b[i] = lp * env * 0.9;
      }
      for (const [t, g] of [[0.085, 0.5], [0.19, 0.34], [0.33, 0.22], [0.52, 0.14]]) {
        const at = Math.floor((t + ch * 0.011) * ctx.sampleRate);
        for (let k = 0; k < 220; k++) b[at + k] += (Math.random() * 2 - 1) * g * (1 - k / 220);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain).connect(this.master);
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** 0 = clear, 1 = heavily muffled (near explosion, low health). */
  setMuffle(amount: number): void {
    if (this.ctx) this.muffle.frequency.setTargetAtTime(20000 - amount * 19200, this.ctx.currentTime, 0.08);
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lyaw = yaw;
  }

  // ---- building blocks -------------------------------------------------------

  /** Output chain for a positioned sound: gain, pan, distance low-pass, reverb send. Returns node + start time. */
  private at(x: number | null, y: number, z: number, gain: number, wet: number, maxDist = 260): { node: AudioNode; t: number; dist: number } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let dist = 0;
    let pan = 0;
    if (x !== null) {
      const dx = x - this.lx;
      const dz = z - this.lz;
      dist = Math.hypot(dx, y - this.ly, dz);
      if (dist > maxDist) return null;
      // Bearing relative to the listener's facing.
      const fx = -Math.sin(this.lyaw);
      const fz = -Math.cos(this.lyaw);
      const rx = Math.cos(this.lyaw);
      const rz = -Math.sin(this.lyaw);
      const h = Math.hypot(dx, dz) || 1;
      pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / h) * Math.min(1, dist / 3)));
      void fx;
      void fz;
    }
    const g = ctx.createGain();
    const att = x === null ? 1 : 1 / (1 + dist * 0.07 + dist * dist * 0.0009);
    g.gain.value = gain * att;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(700, 19000 - dist * 150);
    g.connect(lp).connect(p);
    p.connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = wet * (0.6 + Math.min(1, dist / 60));
    p.connect(send).connect(this.reverb);
    return { node: g, t: ctx.currentTime + Math.min(0.6, dist / 343), dist };
  }

  private burst(dest: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number, q = 0.7, offset = Math.random() * 1.5): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, offset);
    src.stop(t + dur + 0.02);
  }

  private tone(dest: AudioNode, t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ---- weapons -----------------------------------------------------------------

  /** A rifle shot. Pass no position for the player's own weapon. */
  shot(kind: "rifle" | "lmg" | "pistol" | "dmr", x: number | null = null, y = 0, z = 0): void {
    const own = x === null;
    const o = this.at(x, y, z, own ? 0.95 : 1.5, own ? 0.3 : 0.5);
    if (!o) return;
    const { node, t, dist } = o;
    const pitch = (kind === "pistol" ? 1.25 : kind === "lmg" ? 0.88 : 1) * (0.96 + Math.random() * 0.08);
    if (kind === "dmr") {
      // Suppressed 7.62: no crack at the muzzle, a flat thump and the action clattering.
      this.burst(node, t, 0.09, 0.55, "lowpass", 1500, 300, 0.8);
      this.tone(node, t, 0.09, 0.5, "sine", 130, 50);
      this.burst(node, t + 0.03, 0.05, 0.22, "bandpass", 2600, 1800, 3);
      return;
    }
    if (dist < 90) {
      this.burst(node, t, 0.03, 1.0, "highpass", 2400 * pitch, 1500, 0.5); // crack
      this.burst(node, t, 0.16, 0.9, "lowpass", 3800 * pitch, 420, 0.9); // body
      this.tone(node, t, 0.11, 0.75, "sine", 170 * pitch, 48); // thump
      this.burst(node, t + 0.004, 0.07, 0.5, "bandpass", 900 * pitch, 500, 1.4);
      if (own) this.burst(node, t + 0.035, 0.035, 0.16, "bandpass", 3200, 2400, 3); // action cycling
    } else {
      // Far away: only the low-mid body survives, long and soft.
      this.burst(node, t, 0.32, 0.9, "lowpass", 900, 180, 0.7);
      this.tone(node, t, 0.2, 0.5, "sine", 110, 45);
    }
  }

  dryFire(): void {
    const o = this.at(null, 0, 0, 0.4, 0.02);
    if (o) this.burst(o.node, o.t, 0.025, 0.6, "bandpass", 2600, 1800, 4);
  }

  /** Reload foley. */
  foley(kind: "magOut" | "magIn" | "bolt" | "raise" | "cloth" | "pin"): void {
    const o = this.at(null, 0, 0, 0.55, 0.06);
    if (!o) return;
    const { node, t } = o;
    if (kind === "magOut") {
      this.burst(node, t, 0.03, 0.7, "bandpass", 1800, 900, 3);
      this.burst(node, t + 0.05, 0.08, 0.3, "bandpass", 600, 300, 1.5);
    } else if (kind === "magIn") {
      this.burst(node, t, 0.02, 0.5, "bandpass", 900, 700, 2);
      this.burst(node, t + 0.07, 0.035, 0.95, "bandpass", 2200, 1100, 3.5);
      this.tone(node, t + 0.07, 0.05, 0.3, "triangle", 320, 180);
    } else if (kind === "bolt") {
      this.burst(node, t, 0.04, 0.7, "bandpass", 2600, 1400, 3);
      this.burst(node, t + 0.14, 0.045, 1.0, "bandpass", 3000, 1300, 3);
      this.tone(node, t + 0.14, 0.05, 0.3, "triangle", 420, 200);
    } else if (kind === "pin") {
      this.burst(node, t, 0.03, 0.6, "highpass", 4200, 3000, 2);
      this.tone(node, t + 0.02, 0.09, 0.2, "sine", 2400, 1800);
    } else {
      this.burst(node, t, 0.18, kind === "raise" ? 0.22 : 0.14, "bandpass", 700, 1500, 0.7);
    }
  }

  /** Bullet hitting the world. */
  impact(surf: Surf, x: number, y: number, z: number): void {
    const o = this.at(x, y, z, 0.7, 0.12, 90);
    if (!o) return;
    const { node, t } = o;
    if (surf === Surf.Metal) {
      this.burst(node, t, 0.04, 0.8, "highpass", 3000, 2000, 1);
      for (const f of [1900 + Math.random() * 900, 3300 + Math.random() * 1200, 5200]) this.tone(node, t, 0.16 + Math.random() * 0.12, 0.22, "sine", f, f * 0.985);
      if (Math.random() < 0.35) this.tone(node, t + 0.01, 0.42, 0.16, "sawtooth", 2800 + Math.random() * 1200, 700);
    } else if (surf === Surf.Dirt || surf === Surf.Grass || surf === Surf.Sandbag) {
      this.burst(node, t, 0.09, 0.9, "lowpass", 900, 200, 0.8);
    } else if (surf === Surf.Wood) {
      this.burst(node, t, 0.05, 0.9, "bandpass", 1100, 500, 2.2);
      this.tone(node, t, 0.06, 0.3, "triangle", 300, 140);
    } else if (surf === Surf.Glass) {
      this.burst(node, t, 0.2, 0.8, "highpass", 5000, 3500, 0.6);
      for (let i = 0; i < 4; i++) this.tone(node, t + i * 0.03, 0.12, 0.12, "sine", 4000 + Math.random() * 4000, 3800);
    } else {
      this.burst(node, t, 0.06, 0.95, "bandpass", 2000, 700, 1.1);
      this.burst(node, t + 0.03, 0.14, 0.25, "highpass", 3800, 2400, 0.8);
      if (Math.random() < 0.18) this.tone(node, t + 0.01, 0.5, 0.14, "sawtooth", 3400 + Math.random() * 1000, 800);
    }
  }

  /** Flesh hit, heard by the shooter as confirmation. */
  hitFlesh(x: number, y: number, z: number): void {
    const o = this.at(x, y, z, 0.6, 0.05, 80);
    if (o) {
      this.burst(o.node, o.t, 0.07, 0.9, "lowpass", 1400, 240, 1.2);
      this.tone(o.node, o.t, 0.05, 0.3, "sine", 180, 80);
    }
  }

  /** Supersonic crack of a round passing close. */
  whiz(x: number, y: number, z: number): void {
    const o = this.at(x, y, z, 0.8, 0.1, 40);
    if (!o) return;
    this.burst(o.node, o.t, 0.02, 1.0, "highpass", 5200, 3600, 0.7);
    this.burst(o.node, o.t + 0.01, 0.16, 0.3, "bandpass", 2600, 900, 2.5);
  }

  explosion(x: number, y: number, z: number, scale = 1): void {
    const o = this.at(x, y, z, 2.6 * scale, 0.9, 500);
    if (!o) return;
    const { node, t } = o;
    this.burst(node, t, 0.06, 1.0, "highpass", 1800, 900, 0.5);
    this.burst(node, t, 1.3, 1.0, "lowpass", 1800, 70, 0.6);
    this.tone(node, t, 0.9, 1.0, "sine", 82, 28);
    this.burst(node, t + 0.2, 1.6, 0.35, "bandpass", 500, 160, 0.5);
    // Debris rattling down.
    for (let i = 0; i < 9; i++) this.burst(node, t + 0.5 + Math.random() * 1.3, 0.04, 0.12, "bandpass", 1500 + Math.random() * 2500, 900, 2);
  }

  footstep(surf: Surf, sprint: boolean, x: number | null = null, y = 0, z = 0): void {
    const o = this.at(x, y, z, (x === null ? 0.3 : 0.9) * (sprint ? 1.3 : 1), 0.08, 30);
    if (!o) return;
    const { node, t } = o;
    const p = 0.9 + Math.random() * 0.2;
    if (surf === Surf.Grass || surf === Surf.Dirt) {
      this.burst(node, t, 0.11, 0.7, "lowpass", 700 * p, 180, 0.7);
      this.burst(node, t + 0.02, 0.09, 0.2, "highpass", 3200, 2000, 0.6);
    } else if (surf === Surf.Metal) {
      this.burst(node, t, 0.05, 0.8, "bandpass", 1300 * p, 500, 2);
      this.tone(node, t, 0.2, 0.14, "sine", 520 * p, 500);
    } else if (surf === Surf.Wood) {
      this.burst(node, t, 0.07, 0.8, "bandpass", 500 * p, 220, 1.6);
    } else {
      this.burst(node, t, 0.05, 0.75, "lowpass", 1500 * p, 320, 0.9);
      this.burst(node, t + 0.012, 0.05, 0.18, "bandpass", 3000, 1800, 1);
    }
  }

  land(impact: number): void {
    const o = this.at(null, 0, 0, 0.4 + impact * 0.5, 0.08);
    if (o) {
      this.burst(o.node, o.t, 0.12, 1, "lowpass", 900, 120, 0.8);
      this.tone(o.node, o.t, 0.1, 0.5, "sine", 110, 50);
    }
  }

  shellDrop(x: number, y: number, z: number): void {
    const o = this.at(x, y, z, 0.22, 0.06, 14);
    if (!o) return;
    const f = 3600 + Math.random() * 1400;
    this.tone(o.node, o.t, 0.07, 0.5, "sine", f, f * 0.97);
    this.tone(o.node, o.t + 0.07, 0.05, 0.25, "sine", f * 1.18, f * 1.15);
  }

  // ---- feedback / UI --------------------------------------------------------------

  hitmarker(kill: boolean, head: boolean): void {
    const o = this.at(null, 0, 0, 0.45, 0);
    if (!o) return;
    this.tone(o.node, o.t, 0.045, 0.6, "square", head ? 2100 : 1500, head ? 2000 : 1300);
    if (kill) {
      this.tone(o.node, o.t + 0.06, 0.09, 0.6, "square", 900, 600);
      this.burst(o.node, o.t + 0.06, 0.05, 0.35, "bandpass", 2400, 1200, 2);
    }
  }

  hurt(): void {
    const o = this.at(null, 0, 0, 0.6, 0.05);
    if (!o) return;
    this.burst(o.node, o.t, 0.1, 1, "lowpass", 600, 140, 1);
    this.tone(o.node, o.t, 0.14, 0.5, "sine", 120, 60);
  }

  ui(kind: "hover" | "click" | "confirm" | "deny" | "radio" | "objective"): void {
    const o = this.at(null, 0, 0, 0.3, 0);
    if (!o) return;
    const { node, t } = o;
    if (kind === "hover") this.tone(node, t, 0.03, 0.25, "sine", 1700, 1650);
    else if (kind === "click") {
      this.burst(node, t, 0.02, 0.6, "bandpass", 2400, 1600, 3);
      this.tone(node, t, 0.04, 0.3, "sine", 900, 700);
    } else if (kind === "confirm") {
      this.tone(node, t, 0.07, 0.4, "sine", 660, 660);
      this.tone(node, t + 0.08, 0.12, 0.4, "sine", 990, 990);
    } else if (kind === "deny") this.tone(node, t, 0.14, 0.4, "square", 180, 140);
    else if (kind === "radio") {
      this.burst(node, t, 0.06, 0.5, "bandpass", 2200, 2000, 1.2);
      this.tone(node, t + 0.03, 0.05, 0.25, "sine", 1250, 1250);
    } else {
      for (let i = 0; i < 3; i++) this.tone(node, t + i * 0.11, 0.16, 0.35, "sine", [523, 659, 784][i], [523, 659, 784][i]);
    }
  }

  /** Radio squelch + filtered noise "voice" burst under a subtitle. */
  radio(duration: number): void {
    const o = this.at(null, 0, 0, 0.22, 0);
    if (!o) return;
    const { node, t } = o;
    this.burst(node, t, 0.05, 0.8, "bandpass", 2400, 2000, 1);
    const syll = Math.floor(duration * 5.5);
    for (let i = 0; i < syll; i++) {
      const st = t + 0.08 + (i / syll) * duration + Math.random() * 0.03;
      const f = 300 + Math.random() * 260;
      this.tone(node, st, 0.09 + Math.random() * 0.06, 0.5, "sawtooth", f, f * (0.85 + Math.random() * 0.3));
      this.burst(node, st, 0.08, 0.2, "bandpass", 1500 + Math.random() * 900, 1200, 4);
    }
    this.burst(node, t + duration + 0.1, 0.07, 0.7, "bandpass", 2600, 1800, 1);
  }

  // ---- ambience ---------------------------------------------------------------------

  startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambienceOn) return;
    this.ambienceOn = true;
    const bed = ctx.createGain();
    bed.gain.value = 0.5;
    bed.connect(this.master);
    const loop = (type: BiquadFilterType, freq: number, q: number, gain: number, lfoHz: number, lfoDepth: number): void => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lg = ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(bed);
      src.start(0, Math.random());
      lfo.start();
    };
    loop("lowpass", 320, 0.4, 0.2, 0.07, 0.09); // wind through the blocks
    loop("bandpass", 5200, 9, 0.05, 0.19, 0.035); // cicadas
    loop("bandpass", 6900, 14, 0.028, 0.31, 0.02);
    loop("bandpass", 180, 0.8, 0.1, 0.05, 0.05); // city rumble

    const schedule = (): void => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const k = Math.random();
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 2 - 1;
      const g = ctx.createGain();
      g.gain.value = 0.08 + Math.random() * 0.08;
      g.connect(pan).connect(bed);
      pan.connect(this.reverb);
      if (k < 0.3) {
        // Asian koel: the rising two-note call heard across every Singapore estate.
        const n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const st = t + i * 0.62;
          const base = 640 + i * 28;
          this.tone(g, st, 0.2, 0.6, "sine", base, base * 1.02);
          this.tone(g, st + 0.2, 0.28, 0.7, "sine", base * 1.25, base * 1.62);
        }
      } else if (k < 0.55) {
        // Mynah chatter.
        for (let i = 0; i < 6; i++) {
          const f = 1800 + Math.random() * 2200;
          this.tone(g, t + i * 0.09 + Math.random() * 0.03, 0.06, 0.4, "triangle", f, f * (0.7 + Math.random() * 0.6));
        }
      } else if (k < 0.85) {
        // Distant small-arms exchange.
        const shots = 2 + Math.floor(Math.random() * 7);
        const gg = ctx.createGain();
        gg.gain.value = 1.2;
        gg.connect(g);
        for (let i = 0; i < shots; i++) {
          const st = t + i * (0.09 + Math.random() * 0.16);
          this.burst(gg, st, 0.25, 0.9, "lowpass", 700 + Math.random() * 300, 160, 0.7);
        }
      } else {
        // Far artillery.
        const gg = ctx.createGain();
        gg.gain.value = 2.2;
        gg.connect(g);
        this.burst(gg, t, 1.8, 1, "lowpass", 260, 50, 0.6);
        this.tone(gg, t, 1.2, 0.8, "sine", 60, 28);
      }
      window.setTimeout(schedule, 2500 + Math.random() * 6500);
    };
    window.setTimeout(schedule, 1500);
  }
}
