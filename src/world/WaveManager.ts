import type { PlayerController } from "@/player/PlayerController";
import { EnemyManager } from "@/enemies/EnemySpawner";
import { ECONOMY } from "@/data/gamedata";
import type { GameState } from "@/core/GameState";
import type { AudioManager } from "@/core/AudioManager";

export type RunPhase = "intro" | "combat" | "armoury" | "gameover";

export interface WaveManagerCallbacks {
  onWaveStart?: (wave: number, isBoss: boolean) => void;
  onWaveClear?: (wave: number, bonus: number) => void;
  onPhaseChange?: (phase: RunPhase) => void;
  onKillFeed?: (enemyName: string, headshot: boolean) => void;
  onGameOver?: (waveReached: number) => void;
  onPlayerDamaged?: (damage: number, sourcePosition: import("@babylonjs/core").Vector3) => void;
}

const ARMOURY_DURATION_SEC = 45;
/** Free-roam window before Wave 1 so the player can scout the map before OPFOR forms up. */
const INTRO_DURATION_SEC = 10;

/**
 * Orchestrates the wave-survival loop: a free-roam intro before Wave 1,
 * spawn a wave via `EnemyManager`, wait for it to clear, award the scaling
 * `WAVES`/`ECONOMY` bonus, open the between-wave armoury for a breather,
 * then advance. Ends the run on player death.
 */
export class WaveManager {
  readonly enemyManager: EnemyManager;
  phase: RunPhase = "intro";
  wave: number;
  armouryTimeRemaining = ARMOURY_DURATION_SEC;
  introTimeRemaining = INTRO_DURATION_SEC;

  constructor(
    private readonly scene: import("@babylonjs/core").Scene,
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

  /**
   * Starts a fresh deployment at a specific wave — 1 for a clean start, or a
   * milestone (5/10/15/...) the player has previously cleared and chose to
   * jump back into from the landing page's wave picker.
   */
  beginRunAt(startWave: number): void {
    this.wave = Math.max(1, Math.floor(startWave));
    this.gameState.data.wave = this.wave;
    this.gameState.save();
    this.beginIntro();
  }

  /** Free-roam scouting window before Wave 1 only — no shop, no enemies. */
  beginIntro(): void {
    this.phase = "intro";
    this.introTimeRemaining = INTRO_DURATION_SEC;
    this.callbacks.onPhaseChange?.(this.phase);
  }

  beginArmoury(): void {
    this.phase = "armoury";
    this.armouryTimeRemaining = ARMOURY_DURATION_SEC;
    this.callbacks.onPhaseChange?.(this.phase);
  }

  /** Remaining seconds until the next wave starts, whichever pre-combat phase we're in. */
  get timeUntilWaveStart(): number {
    return this.phase === "intro" ? this.introTimeRemaining : this.armouryTimeRemaining;
  }

  startWave(): void {
    this.phase = "combat";
    // Reset to the main base at the start of every wave — a player who wandered
    // off (or is still mid-armoury) never gets caught out in an unsafe spot the
    // instant OPFOR forms up. Position only: health/armour are untouched.
    this.player.teleportTo(this.spawnPosition);
    const isBoss = this.enemyManager.isBossWave(this.wave);
    this.enemyManager.startWave(this.wave, this.player);
    this.audio.waveStart();
    this.callbacks.onPhaseChange?.(this.phase);
    this.callbacks.onWaveStart?.(this.wave, isBoss);
  }

  update(dt: number): void {
    if (this.phase === "gameover") return;

    if (this.player.isDead) {
      this.phase = "gameover";
      this.callbacks.onPhaseChange?.(this.phase);
      this.callbacks.onGameOver?.(this.wave);
      return;
    }

    if (this.phase === "intro") {
      this.introTimeRemaining -= dt;
      if (this.introTimeRemaining <= 0) this.startWave();
      return;
    }

    if (this.phase === "armoury") {
      this.armouryTimeRemaining -= dt;
      if (this.armouryTimeRemaining <= 0) this.startWave();
      return;
    }

    if (this.phase === "combat") {
      this.enemyManager.update(dt, this.player, this.wave);
      if (this.enemyManager.totalForWaveRemaining === 0) {
        this.clearWave();
      }
    }
  }

  private clearWave(): void {
    const bonus = Math.round(
      ECONOMY.waveClearBonus * Math.pow(ECONOMY.waveClearScaling, this.wave - 1)
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

  skipArmoury(): void {
    if (this.phase === "armoury" || this.phase === "intro") this.startWave();
  }

  /**
   * Redeploy after death: credits/unlocks/gear already earned this session
   * are kept (GameState persists them independently) — only the wave count
   * and combat state reset, and the player respawns full health straight
   * into the armoury so they can spend before the next Wave 1.
   */
  restartRun(spawnPosition: import("@babylonjs/core").Vector3): void {
    this.enemyManager.clearAll();
    this.wave = 1;
    this.gameState.data.wave = 1;
    this.gameState.save();
    this.player.respawn(spawnPosition);
    this.beginArmoury();
  }
}
