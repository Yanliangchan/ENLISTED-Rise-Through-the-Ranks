import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  Ray,
} from "@babylonjs/core";
import { ENEMIES, ECONOMY, type EnemyType } from "@/data/gamedata";
import type { Damageable, HitMeshMetadata } from "@/weapons/Damageable";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";
import { CAMP_POSITION } from "@/world/Level";
import { isInSafeZone, isInExclusionZone, steerAroundExclusionZone } from "@/world/SafeZone";

export type EnemyState =
  | "idle"
  | "patrol"
  | "alerted"
  | "chase"
  | "attack"
  | "suppressed"
  | "dead";

const OPFOR_DARK = new Color3(0.14, 0.16, 0.13);
const OPFOR_ACCENT = new Color3(0.22, 0.08, 0.08);
let enemyCounter = 0;

export interface EnemyKillInfo {
  enemy: EnemyInstance;
  headshot: boolean;
  creditsAwarded: number;
}

/** Caps how many OPFOR can actively fire on the player at once — implemented by EnemyManager. */
export interface EngagementLimiter {
  requestEngage(enemyId: string, wave: number): boolean;
  releaseEngage(enemyId: string): void;
}

/**
 * One live OPFOR combatant: FSM (Idle→Patrol→Alerted→Chase→Attack→Suppressed→Dead)
 * driven by line-of-sight + gunshot-hearing checks against the player, stats
 * straight from `ENEMIES`. Low-poly humanoid built in code; head mesh is
 * tagged `isHeadshotMesh` so the player's hitscan can multiply damage on it.
 */
export class EnemyInstance implements Damageable {
  readonly id: string;
  /** Invisible capsule collider that owns movement/collision; visual meshes ride on it. */
  readonly root: Mesh;
  private bodyMesh: Mesh;
  private headMesh: Mesh;
  private limbMeshes: Mesh[] = [];
  private bodyMat: StandardMaterial;

  health: number;
  readonly maxHealth: number;
  state: EnemyState = "idle";
  isDead = false;
  disposed = false;

  private patrolTarget: Vector3;
  private stateTimer = 0;
  private fireCooldown = 0;
  private suppressedTimer = 0;
  private deathTimer = 0;

  onDeath?: (info: EnemyKillInfo) => void;
  onDamagePlayer?: (damage: number, sourcePosition: Vector3) => void;

  constructor(
    private readonly scene: Scene,
    readonly type: EnemyType,
    spawnPosition: Vector3,
    private readonly waveHealthMult: number,
    private readonly audio: AudioManager,
    /** Fraction of base accuracy/fire-rate actually applied — ramps up over early waves. */
    private readonly difficultyMult: number = 1,
    private readonly engageLimiter?: EngagementLimiter
  ) {
    this.id = `enemy_${type.id}_${enemyCounter++}`;
    this.maxHealth = Math.round(type.health * waveHealthMult);
    this.health = this.maxHealth;
    this.patrolTarget = spawnPosition.clone();

    this.root = MeshBuilder.CreateCapsule(`${this.id}_collider`, { height: 1.85, radius: 0.32 }, scene);
    this.root.position = spawnPosition.clone();
    this.root.isVisible = false;
    this.root.isPickable = false;
    this.root.checkCollisions = true;
    this.root.ellipsoid = new Vector3(0.32, 0.92, 0.32);
    this.root.ellipsoidOffset = new Vector3(0, 0.92, 0);

    this.bodyMat = new StandardMaterial(`${this.id}_mat`, scene);
    this.bodyMat.diffuseColor = OPFOR_DARK;
    this.bodyMat.specularColor = Color3.Black();

    const accentMat = new StandardMaterial(`${this.id}_accent`, scene);
    accentMat.diffuseColor = OPFOR_ACCENT;
    accentMat.specularColor = Color3.Black();

    const webbingMat = new StandardMaterial(`${this.id}_webbing`, scene);
    webbingMat.diffuseColor = new Color3(0.08, 0.09, 0.07);
    webbingMat.specularColor = Color3.Black();

    // Torso — the main hittable mass. Sized a little generously versus the
    // pure silhouette so shots that clip the edge of a moving target still
    // register, rather than punishing near-misses that should have counted.
    this.bodyMesh = MeshBuilder.CreateBox(`${this.id}_body`, { width: 0.62, height: 1.05, depth: 0.42 }, scene);
    this.bodyMesh.position.y = 0.95;
    this.bodyMesh.material = this.bodyMat;
    this.bodyMesh.parent = this.root;
    this.bodyMesh.checkCollisions = false;
    this.bodyMesh.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;

    // Chest rig / webbing — visual only, reads as load-bearing equipment.
    const rig = MeshBuilder.CreateBox(`${this.id}_rig`, { width: 0.5, height: 0.5, depth: 0.06 }, scene);
    rig.position.set(0, 1.05, 0.24);
    rig.material = webbingMat;
    rig.parent = this.root;
    rig.isPickable = false;

    this.headMesh = MeshBuilder.CreateBox(`${this.id}_head`, { width: 0.32, height: 0.34, depth: 0.32 }, scene);
    this.headMesh.position.y = 1.7;
    this.headMesh.material = accentMat;
    this.headMesh.parent = this.root;
    this.headMesh.metadata = { damageable: this, isHeadshotMesh: true } satisfies HitMeshMetadata;

    // Helmet — a shallow dome over the head hitbox, visual only, breaks up the
    // head's boxy silhouette a bit without changing what the shot detects.
    const helmet = MeshBuilder.CreateSphere(`${this.id}_helmet`, { diameter: 0.4, slice: 0.55 }, scene);
    helmet.position.y = 1.85;
    helmet.material = webbingMat;
    helmet.parent = this.root;
    helmet.isPickable = false;

    const shoulders = MeshBuilder.CreateBox(`${this.id}_shoulders`, { width: 0.72, height: 0.18, depth: 0.44 }, scene);
    shoulders.position.y = 1.45;
    shoulders.material = accentMat;
    shoulders.parent = this.root;
    shoulders.isPickable = false;

    // Arms and legs — hittable (normal damage, no headshot multiplier) so a
    // limb hit reliably registers instead of silently whiffing through gaps
    // in the old torso-only hitbox; also fills out the soldier silhouette.
    const limbMat = this.bodyMat;
    const armSpecs: Array<[number, number, number]> = [
      [-0.42, 1.08, 0],
      [0.42, 1.08, 0],
    ];
    for (const [x, y, z] of armSpecs) {
      const arm = MeshBuilder.CreateBox(`${this.id}_arm_${x}`, { width: 0.2, height: 0.72, depth: 0.24 }, scene);
      arm.position.set(x, y, z);
      arm.material = limbMat;
      arm.parent = this.root;
      arm.checkCollisions = false;
      arm.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(arm);
    }
    const legSpecs: Array<[number, number, number]> = [
      [-0.17, 0.42, 0],
      [0.17, 0.42, 0],
    ];
    for (const [x, y, z] of legSpecs) {
      const leg = MeshBuilder.CreateBox(`${this.id}_leg_${x}`, { width: 0.24, height: 0.82, depth: 0.28 }, scene);
      leg.position.set(x, y, z);
      leg.material = limbMat;
      leg.parent = this.root;
      leg.checkCollisions = false;
      leg.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(leg);
    }
  }

  private eyePosition(): Vector3 {
    return this.root.position.add(new Vector3(0, 1.6, 0));
  }

  private distanceToPlayer(player: PlayerController): number {
    return Vector3.Distance(this.root.position, player.position);
  }

  private hasLineOfSight(player: PlayerController): boolean {
    const from = this.eyePosition();
    const to = player.position.add(new Vector3(0, 1.4, 0));
    const dir = to.subtract(from);
    const dist = dir.length();
    if (dist <= 0.01) return true;
    dir.normalize();
    const ray = new Ray(from, dir, dist - 0.3);
    const pick = this.scene.pickWithRay(
      ray,
      (mesh) => mesh.isPickable && mesh !== this.bodyMesh && mesh !== this.headMesh && !mesh.metadata?.damageable
    );
    return !pick?.hit;
  }

  suppress(durationSec: number): void {
    if (this.state === "dead") return;
    this.engageLimiter?.releaseEngage(this.id);
    this.state = "suppressed";
    this.suppressedTimer = durationSec;
  }

  /** Called by the weapon system whenever the player fires, for hearing checks. */
  hearGunshot(position: Vector3, effectiveHearingRangeM: number): void {
    if (this.state === "dead") return;
    if (isInSafeZone(position)) return; // shots fired from inside the camp never alert OPFOR
    const dist = Vector3.Distance(this.root.position, position);
    if (dist <= Math.min(this.type.hearingRangeM, effectiveHearingRangeM)) {
      if (this.state === "idle" || this.state === "patrol") {
        this.state = "alerted";
        this.stateTimer = 0;
      }
    }
  }

  takeDamage(damage: number, _isHeadshot: boolean, _sourcePosition?: Vector3): void {
    if (this.isDead) return;
    this.health -= damage;
    this.flashHit();
    if (this.health <= 0) {
      this.die(_isHeadshot);
      return;
    }
    if (this.state !== "attack" && this.state !== "chase") {
      this.state = "chase";
    }
  }

  private flashHit(): void {
    this.bodyMat.emissiveColor = new Color3(0.6, 0.05, 0.05);
    setTimeout(() => {
      if (!this.isDead) this.bodyMat.emissiveColor = Color3.Black();
    }, 80);
  }

  private die(headshot: boolean): void {
    this.isDead = true;
    this.state = "dead";
    this.engageLimiter?.releaseEngage(this.id);
    this.audio.enemyDeath();
    const credits = this.type.creditReward + (headshot ? ECONOMY.headshotBonus : 0);
    this.onDeath?.({ enemy: this, headshot, creditsAwarded: credits });
    this.root.scaling = new Vector3(1, 0.15, 1);
    this.root.position.y -= 0.7;
    this.deathTimer = 4;
  }

  update(dt: number, player: PlayerController, wave = 1): void {
    if (this.state === "dead") {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.dispose();
      return;
    }

    // AI must never occupy the army base: if a knockback/blast or navigation
    // edge case ever lands one inside the exclusion zone, immediately retreat
    // instead of running the normal FSM this frame.
    if (isInExclusionZone(this.root.position)) {
      this.retreatFromExclusionZone(dt);
      return;
    }

    this.stateTimer += dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    const playerInSafeZone = isInSafeZone(player.position);
    // Losing aggro the moment the player is back in the safe zone means OPFOR
    // never detect, target, or fire at players inside it.
    if (playerInSafeZone && this.state !== "idle" && this.state !== "patrol") {
      this.engageLimiter?.releaseEngage(this.id);
      this.state = "patrol";
      this.patrolTarget = this.root.position.clone();
    }

    const distToPlayer = this.distanceToPlayer(player);
    const canSeePlayer = !playerInSafeZone && distToPlayer <= this.type.sightRangeM && this.hasLineOfSight(player);

    switch (this.state) {
      case "idle":
        this.state = "patrol";
        break;
      case "patrol":
        this.wander(dt);
        if (canSeePlayer) this.state = "alerted";
        break;
      case "alerted":
        if (this.stateTimer > 0.6) this.state = "chase";
        this.facePlayer(player);
        break;
      case "chase":
        this.moveToward(player.position, dt);
        if (canSeePlayer && distToPlayer < this.type.sightRangeM * 0.85) {
          // Approaches regardless, but only opens fire once a concurrent-attacker slot frees up.
          if (!this.engageLimiter || this.engageLimiter.requestEngage(this.id, wave)) {
            this.state = "attack";
          }
        }
        break;
      case "attack":
        this.facePlayer(player);
        if (!canSeePlayer || distToPlayer > this.type.sightRangeM) {
          this.engageLimiter?.releaseEngage(this.id);
          this.state = "chase";
          break;
        }
        this.tryFire(player);
        break;
      case "suppressed":
        this.suppressedTimer -= dt;
        if (this.suppressedTimer <= 0) this.state = "chase";
        break;
    }
  }

  private wander(dt: number): void {
    const toTarget = this.patrolTarget.subtract(this.root.position);
    if (toTarget.length() < 0.5) {
      const angle = Math.random() * Math.PI * 2;
      this.patrolTarget = this.root.position.add(new Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4));
    } else {
      this.moveToward(this.patrolTarget, dt, 0.4);
    }
  }

  private moveToward(target: Vector3, dt: number, speedOverride?: number): void {
    const dir = new Vector3(target.x - this.root.position.x, 0, target.z - this.root.position.z);
    const dist = dir.length();
    if (dist < 0.05) return;
    dir.normalize();
    // Curve around the camp's exclusion zone instead of walking straight at
    // its edge and stalling there — this is what lets OPFOR reroute around
    // the army base rather than clustering just outside it.
    const steered = steerAroundExclusionZone(this.root.position, dir);
    const speed = speedOverride ?? this.type.moveSpeed;
    this.root.moveWithCollisions(steered.scale(speed * dt));
    this.root.rotation.y = Math.atan2(steered.x, steered.z);
  }

  /** Walks straight away from the camp centre until clear of the exclusion zone — the fallback for the rare case an enemy ends up inside it. */
  private retreatFromExclusionZone(dt: number): void {
    const away = new Vector3(this.root.position.x - CAMP_POSITION.x, 0, this.root.position.z - CAMP_POSITION.z);
    if (away.lengthSquared() < 0.0001) away.set(1, 0, 0);
    away.normalize();
    this.root.moveWithCollisions(away.scale(this.type.moveSpeed * 1.3 * dt));
    this.root.rotation.y = Math.atan2(away.x, away.z);
    this.engageLimiter?.releaseEngage(this.id);
    this.state = "patrol";
  }

  private facePlayer(player: PlayerController): void {
    const dir = player.position.subtract(this.root.position);
    dir.y = 0;
    if (dir.length() > 0.01) this.root.rotation.y = Math.atan2(dir.x, dir.z);
  }

  private tryFire(player: PlayerController): void {
    if (this.fireCooldown > 0) return;
    // Early waves fire slower and less accurately — ramps to full lethality by ~wave 7.
    this.fireCooldown = 60 / (this.type.fireRateRpm * this.difficultyMult);
    const hit = Math.random() < this.type.accuracy * this.difficultyMult;
    this.audio.gunshot();
    if (hit) {
      player.takeDamage(this.type.damage);
      this.onDamagePlayer?.(this.type.damage, this.root.position.clone());
      this.audio.playerHurt();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.dispose(false, true);
  }
}
