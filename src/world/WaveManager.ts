import type { PlayerController } from "@/player/PlayerController";
import { EnemyManager } from "@/enemies/EnemySpawner";
import { ECONOMY } from "@/data/gamedata";
import type { GameState } from "@/core/GameState";
import type { AudioManager } from "@/core/AudioManager";

export type RunPhase = "combat" | "armoury" | "gameover";

export interface WaveManagerCallbacks {
  onWaveStart?: (wave: number, isBoss: boolean) => void;
  onWaveClear?: (wave: number, bonus: number) => void;
  onPhaseChange?: (phase: RunPhase) => void;
  onKillFeed?: (enemyName: string, headshot: boolean) => void;
  onGameOver?: (waveReached: number) => void;
  onPlayerDamaged?: (damage: number, sourcePosition: import("@babylonjs/core").Vector3) => void;
}

const ARMOURY_DURATION_SEC = 45;

/**
 * Orchestrates the wave-survival loop: spawn a wave via `EnemyManager`, wait
 * for it to clear, award the scaling `WAVES`/`ECONOMY` bonus, open the
 * between-wave armoury for a breather, then advance. Ends the run on player death.
 */
export class WaveManager {
  readonly enemyManager: EnemyManager;
  phase: RunPhase = "armoury";
  wave: number;
  armouryTimeRemaining = ARMOURY_DURATION_SEC;

  constructor(
    private readonly scene: import("@babylonjs/core").Scene,
    private readonly player: PlayerController,
    private readonly gameState: GameState,
    private readonly audio: AudioManager,
    private readonly callbacks: WaveManagerCallbacks = {}
  ) {
    this.wave = gameState.data.wave;
    this.enemyManager = new EnemyManager(scene, audio, {
      onCredits: (amount) => this.gameState.addCredits(amount),
      onKillFeed: (name, hs) => this.callbacks.onKillFeed?.(name, hs),
      onPlayerDamaged: (dmg, pos) => this.callbacks.onPlayerDamaged?.(dmg, pos),
    });
  }

  beginArmoury(): void {
    this.phase = "armoury";
    this.armouryTimeRemaining = ARMOURY_DURATION_SEC;
    this.callbacks.onPhaseChange?.(this.phase);
  }

  startWave(): void {
    this.phase = "combat";
    const isBoss = this.enemyManager.isBossWave(this.wave);
    this.enemyManager.startWave(this.wave);
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
    if (this.phase === "armoury") this.startWave();
  }
}
