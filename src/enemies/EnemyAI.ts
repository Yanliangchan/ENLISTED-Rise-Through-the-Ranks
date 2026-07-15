import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
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

let enemyCounter = 0;

/**
 * OPFOR are the *invaders*, not the SAF — so they wear a distinct woodland
 * DPM-style camo and darker webbing to read clearly as "the enemy" against
 * the player's SAF kit. The camo texture + all the non-hittable equipment
 * materials are procedural and identical across every combatant, so they're
 * built once per scene and shared by all enemies rather than re-created per
 * spawn (that's what keeps ~20 concurrent soldiers cheap). The per-enemy
 * body material stays separate because it flashes red on hit.
 */
interface OpforAssets {
  camoTex: DynamicTexture;
  helmetMat: StandardMaterial;
  webbingMat: StandardMaterial;
  bootMat: StandardMaterial;
  skinMat: StandardMaterial;
  gunMetalMat: StandardMaterial;
  gunFurnitureMat: StandardMaterial;
}
const opforAssetCache = new WeakMap<Scene, OpforAssets>();

function getOpforAssets(scene: Scene): OpforAssets {
  const cached = opforAssetCache.get(scene);
  if (cached) return cached;

  const camoTex = createCamoTexture(scene);

  const helmetMat = new StandardMaterial("opforHelmetMat", scene);
  helmetMat.diffuseColor = new Color3(0.16, 0.18, 0.13);
  helmetMat.specularColor = Color3.Black();

  const webbingMat = new StandardMaterial("opforWebbingMat", scene);
  webbingMat.diffuseColor = new Color3(0.09, 0.1, 0.08);
  webbingMat.specularColor = Color3.Black();

  const bootMat = new StandardMaterial("opforBootMat", scene);
  bootMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
  bootMat.specularColor = new Color3(0.1, 0.1, 0.1);

  const skinMat = new StandardMaterial("opforSkinMat", scene);
  skinMat.diffuseColor = new Color3(0.5, 0.38, 0.3);
  skinMat.specularColor = Color3.Black();

  const gunMetalMat = new StandardMaterial("opforGunMetalMat", scene);
  gunMetalMat.diffuseColor = new Color3(0.09, 0.09, 0.1);
  gunMetalMat.specularColor = new Color3(0.2, 0.2, 0.2);

  const gunFurnitureMat = new StandardMaterial("opforGunFurnitureMat", scene);
  gunFurnitureMat.diffuseColor = new Color3(0.28, 0.15, 0.07); // wood-ish AK furniture
  gunFurnitureMat.specularColor = Color3.Black();

  const assets: OpforAssets = { camoTex, helmetMat, webbingMat, bootMat, skinMat, gunMetalMat, gunFurnitureMat };
  opforAssetCache.set(scene, assets);
  return assets;
}

/** Procedural blocky woodland camo (olive / khaki / brown / black) for the OPFOR uniform. */
function createCamoTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture("opforCamoTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const palette = ["#3a4029", "#4c5233", "#5f5a3a", "#2b2f1f", "#1c2013"];
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(20777);
  // Overlapping soft blobs of each palette colour for a DPM-like mottle.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    const bx = rand() * size;
    const by = rand() * size;
    const bw = 5 + rand() * 12;
    const bh = 5 + rand() * 12;
    ctx.fillRect(bx, by, bw, bh);
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.hasAlpha = false;
  return tex;
}

/** Small deterministic PRNG (shared shape with Level.ts) for the camo pattern. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

    const assets = getOpforAssets(scene);

    // Per-enemy camo uniform material — kept per-instance (not shared) only
    // because it flashes red on hit; the texture underneath is shared.
    this.bodyMat = new StandardMaterial(`${this.id}_mat`, scene);
    this.bodyMat.diffuseColor = new Color3(0.62, 0.62, 0.6); // let the camo texture carry the colour
    this.bodyMat.diffuseTexture = assets.camoTex;
    this.bodyMat.specularColor = Color3.Black();

    // Torso — the main hittable mass. Sized a little generously versus the
    // pure silhouette so shots that clip the edge of a moving target still
    // register, rather than punishing near-misses that should have counted.
    this.bodyMesh = MeshBuilder.CreateBox(`${this.id}_body`, { width: 0.6, height: 1.05, depth: 0.4 }, scene);
    this.bodyMesh.position.y = 0.95;
    this.bodyMesh.material = this.bodyMat;
    this.bodyMesh.parent = this.root;
    this.bodyMesh.checkCollisions = false;
    this.bodyMesh.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;

    // Plate carrier / chest rig over the torso, with a row of magazine pouches.
    const vest = MeshBuilder.CreateBox(`${this.id}_vest`, { width: 0.58, height: 0.62, depth: 0.14 }, scene);
    vest.position.set(0, 1.06, 0.2);
    vest.material = assets.webbingMat;
    vest.parent = this.root;
    vest.isPickable = false;
    for (const px of [-0.17, 0, 0.17]) {
      const pouch = MeshBuilder.CreateBox(`${this.id}_pouch`, { width: 0.13, height: 0.18, depth: 0.1 }, scene);
      pouch.position.set(px, 0.9, 0.29);
      pouch.material = assets.webbingMat;
      pouch.parent = this.root;
      pouch.isPickable = false;
    }

    // Neck + head. Head is the headshot hitbox; the helmet/skin are visual only.
    const neck = MeshBuilder.CreateCylinder(`${this.id}_neck`, { diameter: 0.16, height: 0.12 }, scene);
    neck.position.y = 1.52;
    neck.material = assets.skinMat;
    neck.parent = this.root;
    neck.isPickable = false;

    this.headMesh = MeshBuilder.CreateBox(`${this.id}_head`, { width: 0.3, height: 0.34, depth: 0.3 }, scene);
    this.headMesh.position.y = 1.7;
    this.headMesh.material = assets.skinMat;
    this.headMesh.parent = this.root;
    this.headMesh.metadata = { damageable: this, isHeadshotMesh: true } satisfies HitMeshMetadata;

    // Combat helmet: shell dome + a short brim, visual only.
    const helmet = MeshBuilder.CreateSphere(`${this.id}_helmet`, { diameter: 0.36, slice: 0.62 }, scene);
    helmet.position.y = 1.82;
    helmet.material = assets.helmetMat;
    helmet.parent = this.root;
    helmet.isPickable = false;
    const brim = MeshBuilder.CreateCylinder(`${this.id}_brim`, { diameter: 0.4, height: 0.03 }, scene);
    brim.position.y = 1.79;
    brim.material = assets.helmetMat;
    brim.parent = this.root;
    brim.isPickable = false;

    const shoulders = MeshBuilder.CreateBox(`${this.id}_shoulders`, { width: 0.72, height: 0.16, depth: 0.42 }, scene);
    shoulders.position.y = 1.44;
    shoulders.material = this.bodyMat;
    shoulders.parent = this.root;
    shoulders.isPickable = false;

    // Arms and legs — hittable (normal damage, no headshot multiplier) so a
    // limb hit reliably registers instead of silently whiffing through gaps
    // in the old torso-only hitbox; also fills out the soldier silhouette.
    const armSpecs: Array<[number, number, number]> = [
      [-0.4, 1.08, 0.02],
      [0.4, 1.08, 0.02],
    ];
    for (const [x, y, z] of armSpecs) {
      const arm = MeshBuilder.CreateBox(`${this.id}_arm_${x}`, { width: 0.18, height: 0.72, depth: 0.22 }, scene);
      arm.position.set(x, y, z);
      arm.material = this.bodyMat;
      arm.parent = this.root;
      arm.checkCollisions = false;
      arm.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(arm);
      // Glove at the end of each arm.
      const hand = MeshBuilder.CreateBox(`${this.id}_hand_${x}`, { width: 0.14, height: 0.16, depth: 0.16 }, scene);
      hand.position.set(x, y - 0.42, z + 0.06);
      hand.material = assets.webbingMat;
      hand.parent = this.root;
      hand.isPickable = false;
    }
    const legSpecs: Array<[number, number, number]> = [
      [-0.16, 0.44, 0],
      [0.16, 0.44, 0],
    ];
    for (const [x, y, z] of legSpecs) {
      const leg = MeshBuilder.CreateBox(`${this.id}_leg_${x}`, { width: 0.22, height: 0.8, depth: 0.26 }, scene);
      leg.position.set(x, y, z);
      leg.material = this.bodyMat;
      leg.parent = this.root;
      leg.checkCollisions = false;
      leg.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(leg);
      // Combat boot.
      const boot = MeshBuilder.CreateBox(`${this.id}_boot_${x}`, { width: 0.24, height: 0.14, depth: 0.36 }, scene);
      boot.position.set(x, 0.07, z + 0.06);
      boot.material = assets.bootMat;
      boot.parent = this.root;
      boot.isPickable = false;
    }

    this.buildHeldRifle(assets);
  }

  /**
   * A slung AK-pattern rifle held across the chest — visually distinguishes
   * OPFOR from the SAF player's SAR 21 bullpup. Non-hittable dressing;
   * parented to root so it rides with the soldier and faces where they aim.
   */
  private buildHeldRifle(assets: OpforAssets): void {
    const forward = 0.34; // out in front of the chest
    const y = 1.0;
    const receiver = MeshBuilder.CreateBox(`${this.id}_gun_body`, { width: 0.05, height: 0.09, depth: 0.5 }, this.scene);
    receiver.position.set(0.1, y, forward);
    receiver.material = assets.gunMetalMat;
    receiver.parent = this.root;
    receiver.isPickable = false;

    const barrel = MeshBuilder.CreateCylinder(`${this.id}_gun_barrel`, { diameter: 0.02, height: 0.28 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.1, y + 0.02, forward + 0.36);
    barrel.material = assets.gunMetalMat;
    barrel.parent = this.root;
    barrel.isPickable = false;

    const mag = MeshBuilder.CreateBox(`${this.id}_gun_mag`, { width: 0.035, height: 0.16, depth: 0.09 }, this.scene);
    mag.position.set(0.1, y - 0.11, forward + 0.02);
    mag.rotation.x = 0.35; // AK banana-mag forward curve
    mag.material = assets.gunMetalMat;
    mag.parent = this.root;
    mag.isPickable = false;

    const stock = MeshBuilder.CreateBox(`${this.id}_gun_stock`, { width: 0.04, height: 0.07, depth: 0.24 }, this.scene);
    stock.position.set(0.1, y, forward - 0.36);
    stock.material = assets.gunFurnitureMat;
    stock.parent = this.root;
    stock.isPickable = false;
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
