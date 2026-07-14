/**
 * Procedural WebAudio sound effects — no audio asset pipeline yet, so every
 * cue is synthesised (noise bursts + oscillators) rather than a sample file.
 * Swap in real `.glb`-adjacent `.ogg` assets later without touching call sites.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  volume = 0.6;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  private noiseBurst(durationSec: number, gainStart: number, filterHz: number): void {
    const ctx = this.ensureContext();
    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainStart, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

    noise.connect(filter).connect(gain).connect(this.masterGain!);
    noise.start();
    noise.stop(ctx.currentTime + durationSec);
  }

  private tone(freq: number, durationSec: number, type: OscillatorType, gainStart: number): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainStart, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain).connect(this.masterGain!);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  }

  gunshot(suppressed = false): void {
    this.noiseBurst(suppressed ? 0.06 : 0.12, suppressed ? 0.3 : 0.9, suppressed ? 1200 : 4000);
    if (!suppressed) this.tone(120, 0.08, "square", 0.4);
  }

  boltAction(): void {
    this.tone(300, 0.05, "square", 0.2);
  }

  reload(): void {
    this.tone(500, 0.05, "square", 0.15);
  }

  hitmarker(): void {
    this.tone(1200, 0.04, "sine", 0.2);
  }

  headshot(): void {
    this.tone(1800, 0.06, "sine", 0.25);
  }

  explosion(): void {
    this.noiseBurst(0.8, 1.0, 800);
    this.tone(60, 0.6, "sine", 0.5);
  }

  throwableFuse(): void {
    this.tone(2000, 0.03, "sine", 0.1);
  }

  playerHurt(): void {
    this.tone(200, 0.15, "sawtooth", 0.25);
  }

  enemyDeath(): void {
    this.noiseBurst(0.15, 0.4, 1000);
  }

  waveStart(): void {
    this.tone(440, 0.2, "sine", 0.3);
    setTimeout(() => this.tone(660, 0.25, "sine", 0.3), 150);
  }

  waveClear(): void {
    this.tone(523, 0.15, "sine", 0.3);
    setTimeout(() => this.tone(659, 0.15, "sine", 0.3), 120);
    setTimeout(() => this.tone(784, 0.3, "sine", 0.3), 240);
  }

  purchase(): void {
    this.tone(880, 0.08, "sine", 0.2);
  }

  uiClick(): void {
    this.tone(700, 0.03, "square", 0.1);
  }
}
