import { Scene, Vector3, Ray } from "@babylonjs/core";
import { ENEMIES, WAVES, ELITE_WAVE, OFFICER_BUFF_RADIUS_M } from "@/data/gamedata";
import { EnemyInstance, type EnemyKillInfo } from "@/enemies/EnemyAI";
import { blastDamageAtDistance } from "@/weapons/ballistics";
import { ensureClearOfCamp } from "@/world/SafeZone";
import { findNearestNavigable } from "@/world/Nav";
import { activeMap } from "@/world/MapProfile";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";

// OPFOR spawn anchors come from the active map profile (MapProfile.ts): the
// Singapore ring, or Iron Citadel's building entry points. Every anchor is
// well clear of the base's AI-exclusion zone; `ensureClearOfCamp` re-checks
// the jittered runtime position too.

// --- Spawn placement rules --------------------------------------------------
// OPFOR reinforcements always arrive as pairs, and never materialise on top of
// the player, in their line of sight, or right behind them.
const SPAWN_PAIR_SIZE = 2;
// Cap on how many OPFOR are alive at once. A wave still fields its full count
// (unchanged difficulty and total rewards) — the surplus is held back and
// streamed in as reinforcements whenever a slot frees up. This bounds the
// per-frame render/AI cost (each soldier is ~15 draw calls + an AI tick), which
// is what made the late waves lag: at wave 20 the old "spawn all at once" put
// 60+ soldiers on screen simultaneously. Early waves are under the cap, so they
// play exactly as before.
const MAX_LIVE_ENEMIES = 22;
const MIN_SPAWN_RADIUS_M = 30; // never spawn closer than this to the player
const REAR_CONE_COS = Math.cos((30 * Math.PI) / 180); // "directly behind" exclusion half-angle
const FRONT_VIEW_COS = Math.cos((55 * Math.PI) / 180); // forward view half-angle for the "in sight" test

/** Enemy-type mix per wave band, roughly matching the story's escalation. */
function pickTypeForWave(wave: number): string {
  const roll = Math.random();
  if (wave >= 8 && roll < 0.06) return "opfor_officer"; // rare outside Elite Waves, where one is guaranteed instead
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
  /** Flags an Officer contact — high-priority, buffs nearby OPFOR — for a distinct tactical-map/minimap marker. */
  isOfficer?: boolean;
}

const INTEL_CONFIRM_RANGE = 60; // metres — within this the contact is "confirmed"

export class EnemyManager {
  private enemies: EnemyInstance[] = [];
  /** Enemy type ids still waiting to be streamed in as reinforcements for the current wave. */
  private pendingTypes: string[] = [];
  private pendingWave = 1;
  private pendingElite = false;
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

  livePositions(): Array<{ x: number; z: number; isOfficer?: boolean }> {
    return this.enemies
      .filter((e) => !e.isDead)
      .map((e) => ({ x: e.root.position.x, z: e.root.position.z, isOfficer: e.type.id === "opfor_officer" }));
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
        isOfficer: e.type.id === "opfor_officer",
      }))
      .sort((a, b) => a.dist - b.dist);

    if (revealAll) {
      return live.map((c) => ({ x: c.x, z: c.z, status: "confirmed" as const, isOfficer: c.isOfficer }));
    }

    const out: EnemyIntel[] = [];
    const confirmed = live.filter((c) => c.dist < INTEL_CONFIRM_RANGE);
    const suspected = live.filter((c) => c.dist >= INTEL_CONFIRM_RANGE);
    // Nearest confirmed contact (live position).
    if (confirmed.length > 0) {
      out.push({ x: confirmed[0].x, z: confirmed[0].z, status: "confirmed", isOfficer: confirmed[0].isOfficer });
    }
    // Two next-nearest as suspected — still at their exact current positions.
    for (const s of suspected.slice(0, 2)) {
      out.push({ x: s.x, z: s.z, status: "suspected", isOfficer: s.isOfficer });
    }
    // Officers are always flagged — high-priority, buffs nearby OPFOR — even
    // past the normal sparse confirmed/suspected cap.
    for (const officer of live.filter((c) => c.isOfficer)) {
      if (out.some((o) => o.x === officer.x && o.z === officer.z)) continue;
      out.push({ x: officer.x, z: officer.z, status: officer.dist < INTEL_CONFIRM_RANGE ? "confirmed" : "suspected", isOfficer: true });
    }
    return out;
  }

  get totalForWaveRemaining(): number {
    // Alive right now PLUS the reinforcements still queued to stream in — the
    // wave only clears once both reach zero.
    return this.aliveCount + this.pendingTypes.length;
  }

  waveEnemyCount(wave: number): number {
    return WAVES.enemiesBase + WAVES.enemiesPerWave * (wave - 1);
  }

  waveHealthMultiplier(wave: number): number {
    return Math.pow(1 + WAVES.healthScalingPerWave, wave - 1);
  }

  /** True on Waves 5, 10, 15, 20, ... — stronger spawn mix, scaled-up enemies, bigger rewards. Also the checkpoint interval. */
  isEliteWave(wave: number): boolean {
    return wave % WAVES.eliteEvery === 0;
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
    // Filter on `disposed`, not `isDead`: a soldier that died seconds ago is
    // `isDead` immediately but keeps its meshes alive for its ~4s death-collapse
    // animation. Dropping it from the tracked array here (as `isDead` would)
    // orphans those meshes — nothing left holding a reference ever calls
    // dispose() on them, leaking every corpse still mid-despawn at wave-start.
    this.enemies = this.enemies.filter((e) => !e.disposed);
    this.engagedIds.clear();
    const count = this.waveEnemyCount(wave);
    const elite = this.isEliteWave(wave);
    this.pendingWave = wave;
    this.pendingElite = elite;

    // Decide the whole wave's composition up front (same mix as before: one
    // guaranteed Officer on Elite waves, the boosted heavy fraction, then the
    // per-wave random pick), then queue it. The queue is drained up to
    // MAX_LIVE_ENEMIES now and topped up as enemies die (see streamReinforcements).
    this.pendingTypes = [];
    let officerPending = elite && ELITE_WAVE.guaranteesOfficer && count > 0;
    for (let i = 0; i < count; i++) {
      if (officerPending) {
        this.pendingTypes.push("opfor_officer");
        officerPending = false;
      } else if (elite && i < Math.ceil(count * ELITE_WAVE.heavyFraction)) {
        this.pendingTypes.push("opfor_heavy");
      } else {
        this.pendingTypes.push(pickTypeForWave(wave));
      }
    }

    // Fill up to the live cap immediately so the wave opens at full intensity;
    // the remainder streams in over the wave as slots free up.
    this.spawnFromQueue(player, MAX_LIVE_ENEMIES);
  }

  /**
   * Spawns queued reinforcements (as validated pairs) until either the live cap
   * is reached, the queue empties, or `maxThisCall` soldiers have spawned this
   * call — the last bound spreads spawn/anchor-finding cost across frames so a
   * big top-up never causes a single-frame hitch.
   */
  private spawnFromQueue(player: PlayerController, maxThisCall: number): void {
    let spawnedThisCall = 0;
    while (this.pendingTypes.length > 0 && this.aliveCount < MAX_LIVE_ENEMIES && spawnedThisCall < maxThisCall) {
      const anchor = this.findValidSpawnAnchor(player);
      for (
        let m = 0;
        m < SPAWN_PAIR_SIZE && this.pendingTypes.length > 0 && this.aliveCount < MAX_LIVE_ENEMIES && spawnedThisCall < maxThisCall;
        m++
      ) {
        const jitter = new Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
        let position = ensureClearOfCamp(anchor.add(jitter));
        position = ensureClearOfCamp(findNearestNavigable(this.scene, position));
        const typeId = this.pendingTypes.shift()!;
        this.spawnEnemy(typeId, position, this.pendingWave, this.pendingElite);
        spawnedThisCall++;
      }
    }
  }

  /**
   * Search the spawn ring (plus jitter) for a point satisfying all placement
   * rules. Tries strict validation first, then progressively drops the softest
   * rules so a valid-enough anchor is always returned.
   */
  private findValidSpawnAnchor(player: PlayerController): Vector3 {
    const spawnPoints = activeMap().enemySpawnPoints;
    const candidates: Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const base = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
      const jitter = new Vector3((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 22);
      let cand = ensureClearOfCamp(base.add(jitter));
      cand = ensureClearOfCamp(findNearestNavigable(this.scene, cand));
      candidates.push(cand);
    }
    // Score every candidate once (each score costs up to one LOS raycast) and
    // reuse it across all three tiers below, instead of re-running
    // spawnRuleScore per tier — at high wave counts (many pairs, each calling
    // this) the repeated 3x pass was a measurable source of frame hitches at
    // wave start.
    const scores = candidates.map((c) => this.spawnRuleScore(c, player));
    // Tier 1: all rules. Tier 2: allow front-but-occluded (drop LOS). Tier 3:
    // just the safe radius (guarantees a spawn on a pathological map).
    for (const tier of [3, 2, 1]) {
      const valid = candidates.filter((_, i) => scores[i] >= tier);
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
    this.applyOfficerBuffAura();
    for (const enemy of this.enemies) {
      enemy.update(dt, player, wave);
    }
    this.enemies = this.enemies.filter((e) => !e.disposed);
    // Trickle reinforcements in as the living count drops below the cap — at
    // most one pair per frame so the top-up cost is spread out.
    if (this.pendingTypes.length > 0 && this.aliveCount < MAX_LIVE_ENEMIES) {
      this.spawnFromQueue(player, SPAWN_PAIR_SIZE);
    }
  }

  /** Refreshes each soldier's `officerBuffed` flag: true while standing within a living Officer's buff radius. */
  private applyOfficerBuffAura(): void {
    const officers = this.enemies.filter((e) => !e.isDead && e.type.id === "opfor_officer");
    if (officers.length === 0) {
      for (const enemy of this.enemies) enemy.officerBuffed = false;
      return;
    }
    for (const enemy of this.enemies) {
      if (enemy.isDead || enemy.type.id === "opfor_officer") continue;
      enemy.officerBuffed = officers.some((o) => Vector3.Distance(o.root.position, enemy.root.position) <= OFFICER_BUFF_RADIUS_M);
    }
  }

  private spawnEnemy(typeId: string, position: Vector3, wave: number, isElite = false): void {
    const type = ENEMIES[typeId];
    if (!type) return;
    const enemy = new EnemyInstance(
      this.scene,
      type,
      position,
      this.waveHealthMultiplier(wave),
      this.audio,
      difficultyMultForWave(wave),
      this,
      isElite
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

  /** Apply blast damage (linear falloff to 0 at radiusM) to every living enemy in range. Returns how many were killed by this blast, for explosive-kill stat tracking. */
  damageInRadius(center: Vector3, radiusM: number, centreDamage: number): number {
    let kills = 0;
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      const dist = Vector3.Distance(enemy.root.position, center);
      if (dist >= radiusM) continue;
      const dmg = blastDamageAtDistance(centreDamage, dist, radiusM);
      if (dmg > 0) {
        enemy.takeDamage(dmg, false);
        this.onEnemyDamaged?.(enemy.root.position.add(new Vector3(0, 1.1, 0)), dmg);
        if (enemy.isDead) kills++;
      }
    }
    return kills;
  }

  /** Apply directional blast damage to enemies inside a forward cone. Returns whether anything was hit, and how many of those hits were kills (explosive-kill stat tracking). */
  damageInCone(origin: Vector3, forward: Vector3, rangeM: number, halfAngleRad: number, centreDamage: number): { hit: boolean; kills: number } {
    let hit = false;
    let kills = 0;
    const dir = forward.clone();
    dir.y = 0;
    if (dir.lengthSquared() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const cosHalf = Math.cos(halfAngleRad);
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      const to = enemy.root.position.subtract(origin);
      to.y = 0;
      const dist = to.length();
      if (dist <= 0.1 || dist > rangeM) continue;
      to.normalize();
      if (Vector3.Dot(dir, to) < cosHalf) continue;
      const dmg = blastDamageAtDistance(centreDamage, dist, rangeM);
      if (dmg > 0) {
        enemy.takeDamage(dmg, false);
        this.onEnemyDamaged?.(enemy.root.position.add(new Vector3(0, 1.1, 0)), dmg);
        hit = true;
        if (enemy.isDead) kills++;
      }
    }
    return { hit, kills };
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

  /** Instantly kills every living enemy within radiusM — direct-hit blast zones (Precision Strike core, Carpet Bombing impacts). Returns kill count. */
  killInRadius(center: Vector3, radiusM: number): number {
    let kills = 0;
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      if (Vector3.Distance(enemy.root.position, center) < radiusM) {
        enemy.takeDamage(enemy.maxHealth * 50, false, undefined, true);
        if (enemy.isDead) kills++;
      }
    }
    return kills;
  }

  /** Carpet Bombing survivor debuffs (stun/slow/reduced accuracy) for every living enemy within radiusM of a centre point. */
  applyBombingDebuffInRadius(
    center: Vector3,
    radiusM: number,
    stunSec: number,
    slowMult: number,
    slowSec: number,
    accuracyMult: number,
    accuracySec: number
  ): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      if (Vector3.Distance(enemy.root.position, center) < radiusM) {
        enemy.applyBombingDebuff(stunSec, slowMult, slowSec, accuracyMult, accuracySec);
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
    this.pendingTypes = [];
  }
}
