import { Scene, Vector3 } from "@babylonjs/core";
import { ENEMIES, WAVES } from "@/data/gamedata";
import { EnemyInstance, type EnemyKillInfo } from "@/enemies/EnemyAI";
import { blastDamageAtDistance } from "@/weapons/ballistics";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";

/**
 * Spawn points ring the map edge, just inside the boundary wall (see
 * Level.ts BOUNDARY_HALF = 100), so OPFOR has to move through the blocks
 * and cover to reach the plaza.
 */
const SPAWN_POINTS: Vector3[] = [
  new Vector3(94, 0, 0),
  new Vector3(-94, 0, 0),
  new Vector3(0, 0, 94),
  new Vector3(0, 0, -94),
  new Vector3(65, 0, 65),
  new Vector3(-65, 0, 65),
  new Vector3(65, 0, -65),
  // The SW diagonal point moved off the forest-camp spawn corner (~(-82,-82)) so
  // OPFOR don't materialise right on top of the player at wave start.
  new Vector3(-94, 0, -45),
];

/** Enemy-type mix per wave band, roughly matching the story's escalation. */
function pickTypeForWave(wave: number): string {
  const roll = Math.random();
  if (wave >= 10 && roll < 0.25) return "opfor_heavy";
  if (wave >= 5 && roll < 0.4) return "opfor_marksman";
  return "opfor_grunt";
}

/** Seconds between individual spawns within a wave — long trickle early, tighter later. */
function spawnStaggerForWave(wave: number): number {
  return Math.max(0.7, 3.4 - wave * 0.25);
}

/** How much of a type's base accuracy/fire-rate applies — ramps up to full bite by wave ~7. */
function difficultyMultForWave(wave: number): number {
  return Math.min(1, 0.35 + wave * 0.09);
}

/** How many OPFOR are allowed to actively fire on the player at once — eases in with wave number. */
function maxConcurrentAttackersForWave(wave: number): number {
  return Math.max(1, Math.min(6, 1 + Math.floor((wave - 1) / 2)));
}

export interface EnemyManagerCallbacks {
  onCredits?: (amount: number) => void;
  onKillFeed?: (enemyName: string, headshot: boolean) => void;
  onPlayerDamaged?: (damage: number, sourcePosition: Vector3) => void;
}

/**
 * Spawns and ticks all live OPFOR for the current wave, using `WAVES` for
 * count/health scaling and `ENEMIES` for per-type stats. A boss wave every
 * `WAVES.bossEvery` skews the mix toward Heavies.
 */
export class EnemyManager {
  private enemies: EnemyInstance[] = [];
  private pendingSpawns: Array<{ type: string; delay: number; position: Vector3 }> = [];
  private spawnClock = 0;
  private engagedIds = new Set<string>();

  constructor(
    private readonly scene: Scene,
    private readonly audio: AudioManager,
    private readonly callbacks: EnemyManagerCallbacks = {}
  ) {}

  get aliveCount(): number {
    return this.enemies.filter((e) => !e.isDead).length;
  }

  livePositions(): Array<{ x: number; z: number }> {
    return this.enemies
      .filter((e) => !e.isDead)
      .map((e) => ({ x: e.root.position.x, z: e.root.position.z }));
  }

  get totalForWaveRemaining(): number {
    return this.aliveCount + this.pendingSpawns.length;
  }

  waveEnemyCount(wave: number): number {
    return WAVES.enemiesBase + WAVES.enemiesPerWave * (wave - 1);
  }

  waveHealthMultiplier(wave: number): number {
    return Math.pow(1 + WAVES.healthScalingPerWave, wave - 1);
  }

  isBossWave(wave: number): boolean {
    return wave % WAVES.bossEvery === 0;
  }

  startWave(wave: number): void {
    this.enemies = this.enemies.filter((e) => !e.isDead);
    this.engagedIds.clear();
    const count = this.waveEnemyCount(wave);
    const stagger = spawnStaggerForWave(wave);
    this.pendingSpawns = [];
    for (let i = 0; i < count; i++) {
      const point = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      const jitter = new Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
      const typeId = this.isBossWave(wave) && i < Math.ceil(count * 0.4)
        ? "opfor_heavy"
        : pickTypeForWave(wave);
      this.pendingSpawns.push({ type: typeId, delay: i * stagger, position: point.add(jitter) });
    }
    this.spawnClock = 0;
  }

  update(dt: number, player: PlayerController, wave: number): void {
    this.spawnClock += dt;
    this.pendingSpawns = this.pendingSpawns.filter((spawn) => {
      if (this.spawnClock >= spawn.delay) {
        this.spawnEnemy(spawn.type, spawn.position, wave);
        return false;
      }
      return true;
    });

    for (const enemy of this.enemies) {
      enemy.update(dt, player, wave);
    }
    this.enemies = this.enemies.filter((e) => !e.disposed);
  }

  private spawnEnemy(typeId: string, position: Vector3, wave: number): void {
    const type = ENEMIES[typeId];
    if (!type) return;
    const enemy = new EnemyInstance(
      this.scene,
      type,
      position,
      this.waveHealthMultiplier(wave),
      this.audio,
      difficultyMultForWave(wave),
      this
    );
    enemy.onDeath = (info: EnemyKillInfo) => {
      this.engagedIds.delete(enemy.id);
      this.callbacks.onCredits?.(info.creditsAwarded);
      this.callbacks.onKillFeed?.(type.name, info.headshot);
    };
    enemy.onDamagePlayer = (dmg, sourcePos) => this.callbacks.onPlayerDamaged?.(dmg, sourcePos);
    this.enemies.push(enemy);
  }

  /** Try to claim an "actively firing" slot; returns false if the wave's concurrent-attacker cap is full. */
  requestEngage(enemyId: string, wave: number): boolean {
    if (this.engagedIds.has(enemyId)) return true;
    if (this.engagedIds.size >= maxConcurrentAttackersForWave(wave)) return false;
    this.engagedIds.add(enemyId);
    return true;
  }

  releaseEngage(enemyId: string): void {
    this.engagedIds.delete(enemyId);
  }

  /** Broadcast a gunshot to all living enemies for hearing-based alerting. */
  broadcastGunshot(position: Vector3, effectiveHearingRangeM: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.isDead) enemy.hearGunshot(position, effectiveHearingRangeM);
    }
  }

  /** Apply blast damage (linear falloff to 0 at radiusM) to every living enemy in range. */
  damageInRadius(center: Vector3, radiusM: number, centreDamage: number): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      const dist = Vector3.Distance(enemy.root.position, center);
      if (dist >= radiusM) continue;
      const dmg = blastDamageAtDistance(centreDamage, dist, radiusM);
      if (dmg > 0) enemy.takeDamage(dmg, false);
    }
  }

  /** Stun (Suppressed state) every living enemy within radiusM of a flashbang/etc. */
  stunInRadius(center: Vector3, radiusM: number, durationSec: number): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      if (Vector3.Distance(enemy.root.position, center) < radiusM) {
        enemy.suppress(durationSec);
      }
    }
  }

  anyEnemyWithin(center: Vector3, radiusM: number): boolean {
    return this.enemies.some((e) => !e.isDead && Vector3.Distance(e.root.position, center) < radiusM);
  }

  alertAllToPosition(position: Vector3): void {
    for (const enemy of this.enemies) {
      if (!enemy.isDead) enemy.hearGunshot(position, 9999);
    }
  }

  clearAll(): void {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies = [];
    this.pendingSpawns = [];
  }
}
