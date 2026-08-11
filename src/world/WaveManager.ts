import type { PlayerController } from "@/player/PlayerController";
import { EnemyManager } from "@/enemies/EnemySpawner";
import { ECONOMY, ELITE_WAVE } from "@/data/gamedata";
import type { GameState } from "@/core/GameState";
import type { AudioManager } from "@/core/AudioManager";

/**
 * `armoury` — shop open between waves, waits for the player (no timer).
 * `countdown` — the fixed pre-wave beat, shown as "WAVE N IN 5…1".
 */
export type RunPhase = "armoury" | "countdown" | "combat" | "gameover";

export interface WaveManagerCallbacks {
  onWaveStart?: (wave: number, isElite: boolean) => void;
  onWaveClear?: (wave: number, bonus: number) => void;
  onPhaseChange?: (phase: RunPhase) => void;
  onKillFeed?: (enemyName: string, headshot: boolean) => void;
  onGameOver?: (waveReached: number) => void;
  onPlayerDamaged?: (damage: number, sourcePosition: import("@babylonjs/core").Vector3) => void;
  /** Fires once per whole second of the pre-wave countdown (5,4,3,2,1) — drives the HUD tick + beep. */
  onCountdownTick?: (secondsLeft: number, wave: number) => void;
}

/** Pre-wave countdown, in seconds. `Wave cleared → 5 second countdown → next wave`. */
export const WAVE_COUNTDOWN_SEC = 5;

/** Milestones the player may restart a run from, once reached. */
export const WAVE_CHECKPOINTS = [5, 10, 15, 20];

/**
 * Orchestrates the wave-survival loop: an armoury breather (open until the
 * player deploys), a fixed 5-second countdown, the wave itself, then the
 * scaling `WAVES`/`ECONOMY` clear bonus and back round. Ends the run on player
 * death.
 *
 * Every phase transition goes through `setPhase`, and `startWave` is latched,
 * so a wave can never be started twice, no two countdowns can run at once, and
 * the next wave can never begin before the current one has actually finished.
 */
export class WaveManager {
  readonly enemyManager: EnemyManager;
  private _phase: RunPhase = "armoury";
  wave: number;
  countdownRemaining = WAVE_COUNTDOWN_SEC;
  /**
   * The wave this run was STARTED at. Persists across death so the game can
   * offer the player their chosen entry point again instead of silently
   * dumping them back at Wave 1.
   */
  runStartWave = 1;
  /** Guards against a second `startWave` landing while one is already in flight. */
  private waveInFlight = false;
  /** Whole-second boundary already announced, so each tick fires exactly once. */
  private lastCountdownTick = -1;

  constructor(
    scene: import("@babylonjs/core").Scene,
    private readonly player: PlayerController,
    private readonly gameState: GameState,
    private readonly audio: AudioManager,
    private readonly spawnPosition: import("@babylonjs/core").Vector3,
    private readonly callbacks: WaveManagerCallbacks = {}
  ) {
    // Always boots at 1 — the actual starting wave for a deployment is set
    // explicitly via beginRunAt() (landing page DEPLOY), not silently resumed
    // from whatever was last persisted. Kept players from getting an
    // inconsistent Wave 1 vs Wave 3/4 start depending on when they last saved.
    this.wave = 1;
    this.enemyManager = new EnemyManager(scene, audio, {
      onCredits: (amount) => this.gameState.addCredits(amount),
      onKillFeed: (name, hs) => this.callbacks.onKillFeed?.(name, hs),
      onPlayerDamaged: (dmg, pos) => this.callbacks.onPlayerDamaged?.(dmg, pos),
    });
  }

  get phase(): RunPhase {
    return this._phase;
  }

  private setPhase(next: RunPhase): void {
    if (this._phase === next) return;
    this._phase = next;
    this.callbacks.onPhaseChange?.(next);
  }

  /**
   * Starts a fresh deployment at a specific wave — 1 for a clean start, or a
   * milestone (5/10/15/...) the player has previously cleared and chose to
   * jump back into.
   *
   * Everything a wave needs is established HERE rather than being inherited
   * from a Wave 1 that may never have run: the wave number, the run's start
   * wave, a cleared battlefield, and a fully reset player standing on real
   * ground at the base. A Wave 10 start is therefore identical in every
   * respect to a Wave 1 start except the number.
   */
  beginRunAt(startWave: number): void {
    const wave = Math.max(1, Math.floor(startWave));
    this.enemyManager.clearAll();
    this.waveInFlight = false;
    this.wave = wave;
    this.runStartWave = wave;
    this.gameState.data.wave = wave;
    this.gameState.save();
    this.player.spawnForDeployment(this.spawnPosition);
    this.beginCountdown();
  }

  /** Checkpoints this run may be restarted from after death: Wave 1 plus every milestone up to where it began. */
  restartOptions(): number[] {
    return [1, ...WAVE_CHECKPOINTS.filter((w) => w <= this.runStartWave)];
  }

  /**
   * Redeploy after death at the player's chosen wave. Credits/unlocks/gear
   * earned this session are kept (GameState persists them independently);
   * everything run-scoped — enemies, wave number, phase, timers, player state —
   * is rebuilt from scratch.
   */
  restartRun(startWave: number): void {
    this.setPhase("armoury"); // leave gameover first so the phase callback fires cleanly
    this.beginRunAt(startWave);
  }

  /** Opens the between-wave shop. No timer — the wave starts when the player deploys. */
  beginArmoury(): void {
    this.waveInFlight = false;
    this.setPhase("armoury");
  }

  /** Starts the fixed pre-wave countdown. Idempotent — re-entry just restarts the same single timer. */
  beginCountdown(): void {
    this.waveInFlight = false;
    this.countdownRemaining = WAVE_COUNTDOWN_SEC;
    this.lastCountdownTick = -1;
    this.setPhase("countdown");
  }

  /** Remaining seconds until the next wave starts (0 while not counting down). */
  get timeUntilWaveStart(): number {
    return this._phase === "countdown" ? Math.max(0, this.countdownRemaining) : 0;
  }

  startWave(): void {
    // Latch + phase guard: a duplicate call (double-click on DEPLOY, a stray
    // skipArmoury, the countdown hitting zero on the same frame) is a no-op
    // rather than a second spawn set for the same wave.
    if (this.waveInFlight || this._phase === "combat" || this._phase === "gameover") return;
    this.waveInFlight = true;
    // Reset to the main base at the start of every wave — a player who wandered
    // off (or is still mid-armoury) never gets caught out in an unsafe spot the
    // instant OPFOR forms up. Position only: health/armour are untouched.
    this.player.teleportTo(this.spawnPosition);
    const isElite = this.enemyManager.isEliteWave(this.wave);
    this.enemyManager.startWave(this.wave, this.player);
    this.audio.waveStart();
    this.setPhase("combat");
    this.callbacks.onWaveStart?.(this.wave, isElite);
  }

  update(dt: number): void {
    if (this._phase === "gameover") return;

    if (this.player.isDead) {
      this.setPhase("gameover");
      this.callbacks.onGameOver?.(this.wave);
      return;
    }

    if (this._phase === "countdown") {
      this.countdownRemaining -= dt;
      const secondsLeft = Math.max(0, Math.ceil(this.countdownRemaining));
      if (secondsLeft !== this.lastCountdownTick && secondsLeft > 0) {
        this.lastCountdownTick = secondsLeft;
        this.callbacks.onCountdownTick?.(secondsLeft, this.wave);
      }
      if (this.countdownRemaining <= 0) this.startWave();
      return;
    }

    if (this._phase === "combat") {
      this.enemyManager.update(dt, this.player, this.wave);
      if (this.enemyManager.totalForWaveRemaining === 0) this.clearWave();
    }
  }

  private clearWave(): void {
    const eliteMult = this.enemyManager.isEliteWave(this.wave) ? ELITE_WAVE.waveClearBonusMult : 1;
    const bonus = Math.round(
      ECONOMY.waveClearBonus * Math.pow(ECONOMY.waveClearScaling, this.wave - 1) * eliteMult
    );
    this.gameState.addCredits(bonus);
    this.gameState.data.highestWaveCleared = Math.max(
      this.gameState.data.highestWaveCleared,
      this.wave
    );
    this.audio.waveClear();
    this.callbacks.onWaveClear?.(this.wave, bonus);
    this.wave += 1;
    this.gameState.data.wave = this.wave;
    this.gameState.save();
    this.beginArmoury();
  }

  /** Player pressed DEPLOY in the armoury — roll straight into the pre-wave countdown. */
  skipArmoury(): void {
    if (this._phase === "armoury") this.beginCountdown();
  }
}
