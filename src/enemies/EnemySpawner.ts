import { Scene, Vector3, Ray } from "@babylonjs/core";
import { ENEMIES, WAVES } from "@/data/gamedata";
import { EnemyInstance, type EnemyKillInfo } from "@/enemies/EnemyAI";
import { blastDamageAtDistance } from "@/weapons/ballistics";
import { ensureClearOfCamp } from "@/world/SafeZone";
import { findNearestNavigable } from "@/world/Nav";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";

/**
 * Spawn points ring the map edge, just inside the boundary wall (see
 * Level.ts BOUNDARY_HALF = 100), so OPFOR has to move through the blocks
 * and cover to reach the plaza. Every point is well clear of the camp's AI
 * exclusion zone (see SafeZone.ts) — `ensureClearOfCamp` also re-checks the
 * jittered spawn position at runtime as a second line of defence.
 */
const SPAWN_POINTS: Vector3[] = [
  // Pulled in from the ±94 boundary ring (~18% closer to the centre) so OPFOR
  // reach the fight sooner — shorter travel time between engagements — while
  // still starting outside the built-up blocks and clear of the camp.
  new Vector3(77, 0, 0),
  new Vector3(-77, 0, 0),
  new Vector3(0, 0, 77),
  new Vector3(0, 0, -77),
  new Vector3(53, 0, 53),
  new Vector3(-53, 0, 53),
  new Vector3(53, 0, -53),
  // South edge, well east of the SW camp corner — clears the exclusion zone
  // by a wide margin (unlike the old (-94,-45) point, which sat inside it).
  new Vector3(-16, 0, -77),
];

// --- Spawn placement rules --------------------------------------------------
// OPFOR reinforcements always arrive as pairs, and never materialise on top of
// the player, in their line of sight, or right behind them.
const SPAWN_PAIR_SIZE = 2;
const MIN_SPAWN_RADIUS_M = 30; // never spawn closer than this to the player
const REAR_CONE_COS = Math.cos((30 * Math.PI) / 180); // "directly behind" exclusion half-angle
const FRONT_VIEW_COS = Math.cos((55 * Math.PI) / 180); // forward view half-angle for the "in sight" test

/** Enemy-type mix per wave band, roughly matching the story's escalation. */
function pickTypeForWave(wave: number): string {
  const roll = Math.random();
  if (wave >= 10 && roll < 0.25) return "opfor_heavy";
  if (wave >= 5 && roll < 0.4) return "opfor_marksman";
  return "opfor_grunt";
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
/** A contact for the tactical map: confirmed = seen right now, suspected = last-known position. */
export interface EnemyIntel {
  x: number;
  z: number;
  status: "confirmed" | "suspected";
}

const INTEL_CONFIRM_RANGE = 60; // metres — within this the contact is "confirmed"

export class EnemyManager {
  private enemies: EnemyInstance[] = [];
  private engagedIds = new Set<string>();

  constructor(
    private readonly scene: Scene,
    private readonly audio: AudioManager,
    private readonly callbacks: EnemyManagerCallbacks = {}
  ) {}

  /** Set by main.ts so blast/splash hits also pop floating damage numbers. */
  onEnemyDamaged?: (worldPos: Vector3, amount: number) => void;

  get aliveCount(): number {
    return this.enemies.filter((e) => !e.isDead).length;
  }

  livePositions(): Array<{ x: number; z: number }> {
    return this.enemies
      .filter((e) => !e.isDead)
      .map((e) => ({ x: e.root.position.x, z: e.root.position.z }));
  }

  /** Live enemy instances — read by BOTTY for targeting (position + the Damageable interface to fire on). */
  getAliveEnemies(): EnemyInstance[] {
    return this.enemies.filter((e) => !e.isDead);
  }

  /**
   * Tactical-map intel — always the *live* positions of real, living enemies,
   * so every marker on the map corresponds to an enemy standing at exactly that
   * spot right now (no stale "last-known" ghosts, no desync). Normal ops still
   * give a deliberately sparse picture — the nearest confirmed contact plus the
   * two next-nearest as suspected — while `revealAll` (UAV overhead) reports
   * every living enemy. Because positions are read fresh each call, markers
   * track enemies in real time.
   */
  intel(playerPos: Vector3, revealAll = false): EnemyIntel[] {
    const live = this.enemies
      .filter((e) => !e.isDead)
      .map((e) => ({
        x: e.root.position.x,
        z: e.root.position.z,
        dist: Math.hypot(e.root.position.x - playerPos.x, e.root.position.z - playerPos.z),
      }))
      .sort((a, b) => a.dist - b.dist);

    if (revealAll) {
      return live.map((c) => ({ x: c.x, z: c.z, status: "confirmed" as const }));
    }

    const out: EnemyIntel[] = [];
    const confirmed = live.filter((c) => c.dist < INTEL_CONFIRM_RANGE);
    const suspected = live.filter((c) => c.dist >= INTEL_CONFIRM_RANGE);
    // Nearest confirmed contact (live position).
    if (confirmed.length > 0) {
      out.push({ x: confirmed[0].x, z: confirmed[0].z, status: "confirmed" });
    }
    // Two next-nearest as suspected — still at their exact current positions.
    for (const s of suspected.slice(0, 2)) {
      out.push({ x: s.x, z: s.z, status: "suspected" });
    }
    return out;
  }

  get totalForWaveRemaining(): number {
    // The whole wave spawns at once, so remaining == still alive.
    return this.aliveCount;
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

  /**
   * Spawns the ENTIRE wave as pairs (SPAWN_PAIR_SIZE = 2). Every pair's anchor
   * point is validated first — never inside MIN_SPAWN_RADIUS_M of the player,
   * never in the player's line of sight, and never in the rear cone directly
   * behind them — then snapped clear of the camp and onto navigable ground so
   * the two soldiers never appear inside a building, prop, vehicle, or the
   * arena wall. If the map is so hemmed in that no point passes every rule, the
   * checks relax step by step (LOS first, then the rear cone) so a wave always
   * arrives rather than silently failing to spawn.
   */
  startWave(wave: number, player: PlayerController): void {
    this.enemies = this.enemies.filter((e) => !e.isDead);
    this.engagedIds.clear();
    const count = this.waveEnemyCount(wave);
    const pairCount = Math.ceil(count / SPAWN_PAIR_SIZE);

    let spawned = 0;
    for (let p = 0; p < pairCount && spawned < count; p++) {
      const anchor = this.findValidSpawnAnchor(player);
      for (let m = 0; m < SPAWN_PAIR_SIZE && spawned < count; m++) {
        // The two members of a pair stand a couple of metres apart, each
        // re-snapped to walkable ground and clear of the camp.
        const jitter = new Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
        let position = ensureClearOfCamp(anchor.add(jitter));
        position = ensureClearOfCamp(findNearestNavigable(this.scene, position));
        const typeId =
          this.isBossWave(wave) && spawned < Math.ceil(count * 0.4)
            ? "opfor_heavy"
            : pickTypeForWave(wave);
        this.spawnEnemy(typeId, position, wave);
        spawned++;
      }
    }
  }

  /**
   * Search the spawn ring (plus jitter) for a point satisfying all placement
   * rules. Tries strict validation first, then progressively drops the softest
   * rules so a valid-enough anchor is always returned.
   */
  private findValidSpawnAnchor(player: PlayerController): Vector3 {
    const candidates: Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const base = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      const jitter = new Vector3((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 22);
      let cand = ensureClearOfCamp(base.add(jitter));
      cand = ensureClearOfCamp(findNearestNavigable(this.scene, cand));
      candidates.push(cand);
    }
    // Tier 1: all rules. Tier 2: allow front-but-occluded (drop LOS). Tier 3:
    // just the safe radius (guarantees a spawn on a pathological map).
    for (const tier of [3, 2, 1]) {
      const valid = candidates.filter((c) => this.spawnRuleScore(c, player) >= tier);
      if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)];
    }
    return candidates[0];
  }

  /**
   * How many placement rules a candidate satisfies (0–3): +1 far enough from
   * the player, +1 not directly behind them, +1 not in their line of sight.
   */
  private spawnRuleScore(point: Vector3, player: PlayerController): number {
    const to = new Vector3(point.x - player.position.x, 0, point.z - player.position.z);
    const dist = to.length();
    if (dist < MIN_SPAWN_RADIUS_M) return 0; // too close — fails the hard rule
    to.normalize();

    const fwd = player.camera.getDirection(Vector3.Forward());
    fwd.y = 0;
    if (fwd.lengthSquared() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const facing = Vector3.Dot(fwd, to);

    let score = 1; // passed the radius rule
    // Not directly behind: the point must not sit in the rear cone.
    if (facing > -REAR_CONE_COS) score++;
    // Not in line of sight: either outside the forward view cone, or occluded
    // from the player's eye by a solid mesh.
    const inView = facing > FRONT_VIEW_COS;
    if (!inView || !this.hasLineOfSightFromPlayer(player, point)) score++;
    return score;
  }

  /** True if nothing solid stands between the player's eye and a world point. */
  private hasLineOfSightFromPlayer(player: PlayerController, point: Vector3): boolean {
    const from = player.position.add(new Vector3(0, 1.5, 0));
    const target = point.add(new Vector3(0, 1.0, 0));
    const dir = target.subtract(from);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    const ray = new Ray(from, dir, dist - 0.3);
    const pick = this.scene.pickWithRay(
      ray,
      (m) => m.isPickable && m.checkCollisions && m.name !== "playerCollider" && !m.metadata?.damageable
    );
    return !pick?.hit;
  }

  update(dt: number, player: PlayerController, wave: number): void {
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
      if (dmg > 0) {
        enemy.takeDamage(dmg, false);
        this.onEnemyDamaged?.(enemy.root.position.add(new Vector3(0, 1.1, 0)), dmg);
      }
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
  }
}
