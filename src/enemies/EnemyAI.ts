import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
  Color3,
  Vector3,
  Mesh,
  TransformNode,
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
  private legMeshes: Mesh[] = [];
  private rifleNode!: TransformNode;
  private visualRoot!: TransformNode;
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
  // Combat discipline: a soldier doesn't fire the instant it sees you (reaction
  // time), and it can't fire forever — it burns a magazine, then reloads (with a
  // matching gun-lowered animation) before it can shoot again.
  private reactionTimer = 0;
  private readonly magCapacity: number;
  private roundsInMag: number;
  private isReloading = false;
  private reloadTimer = 0;
  // Locomotion animation.
  private walkPhase = 0;
  private movingThisFrame = false;
  // Anti-stuck: when movement is repeatedly blocked (a container lane wall, a
  // building corner), sidestep along an escape vector for a moment.
  private stuckTimer = 0;
  private escapeDir: Vector3 | null = null;
  private escapeTimer = 0;

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
    // Magazine size by carried weapon class — LMG belt is large, DMR small.
    this.magCapacity = type.weapon === "generic_lmg" ? 50 : type.weapon === "generic_dmr" ? 10 : 30;
    this.roundsInMag = this.magCapacity;

    this.root = MeshBuilder.CreateCapsule(`${this.id}_collider`, { height: 1.7, radius: 0.3 }, scene);
    this.root.position = spawnPosition.clone();
    this.root.isVisible = false;
    this.root.isPickable = false;
    this.root.checkCollisions = true;
    this.root.ellipsoid = new Vector3(0.3, 0.85, 0.3);
    this.root.ellipsoidOffset = new Vector3(0, 0.85, 0);

    // All visual + hit meshes ride on this node, which is scaled down as one
    // unit so the whole soldier reads a touch smaller (previously stood taller
    // than the player). Hit meshes scale with it too, so picking stays aligned;
    // collision uses the collider's own ellipsoid above, unaffected.
    this.visualRoot = new TransformNode(`${this.id}_visual`, scene);
    this.visualRoot.parent = this.root;
    this.visualRoot.scaling.setAll(0.9);
    const vr = this.visualRoot;

    const assets = getOpforAssets(scene);

    // Per-enemy camo uniform material — kept per-instance (not shared) only
    // because it flashes red on hit; the texture underneath is shared. The
    // base colour is a definite olive so the soldier reads dark-green even if
    // the camo texture is washed out by bright light/fog (never pale/white).
    this.bodyMat = new StandardMaterial(`${this.id}_mat`, scene);
    this.bodyMat.diffuseColor = new Color3(0.34, 0.36, 0.26);
    this.bodyMat.diffuseTexture = assets.camoTex;
    this.bodyMat.specularColor = Color3.Black();

    // Torso — the main hittable mass. Sized a little generously versus the
    // pure silhouette so shots that clip the edge of a moving target still
    // register, rather than punishing near-misses that should have counted.
    this.bodyMesh = MeshBuilder.CreateBox(`${this.id}_body`, { width: 0.56, height: 1.02, depth: 0.38 }, scene);
    this.bodyMesh.position.y = 0.95;
    this.bodyMesh.material = this.bodyMat;
    this.bodyMesh.parent = vr;
    this.bodyMesh.checkCollisions = false;
    this.bodyMesh.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;

    // Plate carrier / chest rig over the torso, with a row of magazine pouches.
    const vest = MeshBuilder.CreateBox(`${this.id}_vest`, { width: 0.54, height: 0.6, depth: 0.14 }, scene);
    vest.position.set(0, 1.04, 0.19);
    vest.material = assets.webbingMat;
    vest.parent = vr;
    vest.isPickable = false;
    for (const px of [-0.16, 0, 0.16]) {
      const pouch = MeshBuilder.CreateBox(`${this.id}_pouch`, { width: 0.12, height: 0.17, depth: 0.1 }, scene);
      pouch.position.set(px, 0.88, 0.27);
      pouch.material = assets.webbingMat;
      pouch.parent = vr;
      pouch.isPickable = false;
    }

    // Neck + head. Head is the headshot hitbox; the helmet/skin are visual only.
    const neck = MeshBuilder.CreateCylinder(`${this.id}_neck`, { diameter: 0.15, height: 0.12 }, scene);
    neck.position.y = 1.5;
    neck.material = assets.skinMat;
    neck.parent = vr;
    neck.isPickable = false;

    this.headMesh = MeshBuilder.CreateBox(`${this.id}_head`, { width: 0.28, height: 0.32, depth: 0.28 }, scene);
    this.headMesh.position.y = 1.66;
    this.headMesh.material = assets.skinMat;
    this.headMesh.parent = vr;
    this.headMesh.metadata = { damageable: this, isHeadshotMesh: true } satisfies HitMeshMetadata;

    // Combat helmet: shell dome + a short brim, visual only.
    const helmet = MeshBuilder.CreateSphere(`${this.id}_helmet`, { diameter: 0.34, slice: 0.62 }, scene);
    helmet.position.y = 1.77;
    helmet.material = assets.helmetMat;
    helmet.parent = vr;
    helmet.isPickable = false;
    const brim = MeshBuilder.CreateCylinder(`${this.id}_brim`, { diameter: 0.38, height: 0.03 }, scene);
    brim.position.y = 1.74;
    brim.material = assets.helmetMat;
    brim.parent = vr;
    brim.isPickable = false;

    const shoulders = MeshBuilder.CreateBox(`${this.id}_shoulders`, { width: 0.68, height: 0.16, depth: 0.4 }, scene);
    shoulders.position.y = 1.4;
    shoulders.material = this.bodyMat;
    shoulders.parent = vr;
    shoulders.isPickable = false;

    // Arms and legs — hittable (normal damage, no headshot multiplier) so a
    // limb hit reliably registers instead of silently whiffing through gaps
    // in the old torso-only hitbox; also fills out the soldier silhouette.
    const armSpecs: Array<[number, number, number]> = [
      [-0.37, 1.05, 0.02],
      [0.37, 1.05, 0.02],
    ];
    for (const [x, y, z] of armSpecs) {
      const arm = MeshBuilder.CreateBox(`${this.id}_arm_${x}`, { width: 0.16, height: 0.68, depth: 0.2 }, scene);
      arm.position.set(x, y, z);
      arm.material = this.bodyMat;
      arm.parent = vr;
      arm.checkCollisions = false;
      arm.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(arm);
      // Glove at the end of each arm — parented to the arm so it rides with it.
      const hand = MeshBuilder.CreateBox(`${this.id}_hand_${x}`, { width: 0.13, height: 0.15, depth: 0.15 }, scene);
      hand.position.set(0, -0.4, 0.06);
      hand.material = assets.webbingMat;
      hand.parent = arm;
      hand.isPickable = false;
    }
    const legSpecs: Array<[number, number, number]> = [
      [-0.15, 0.42, 0],
      [0.15, 0.42, 0],
    ];
    for (const [x, y, z] of legSpecs) {
      const leg = MeshBuilder.CreateBox(`${this.id}_leg_${x}`, { width: 0.2, height: 0.78, depth: 0.24 }, scene);
      leg.position.set(x, y, z);
      leg.material = this.bodyMat;
      leg.parent = vr;
      leg.checkCollisions = false;
      leg.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(leg);
      this.legMeshes.push(leg);
      // Combat boot — parented to the leg so it swings with the walk cycle.
      const boot = MeshBuilder.CreateBox(`${this.id}_boot_${x}`, { width: 0.22, height: 0.14, depth: 0.34 }, scene);
      boot.position.set(0, -0.35, 0.06);
      boot.material = assets.bootMat;
      boot.parent = leg;
      boot.isPickable = false;
    }

    this.buildHeldRifle(assets);
  }

  /**
   * A slung AK-pattern rifle held across the chest — visually distinguishes
   * OPFOR from the SAF player's SAR 21 bullpup. Non-hittable dressing;
   * parented to the (scaled) visual root so it rides with the soldier.
   */
  private buildHeldRifle(assets: OpforAssets): void {
    // All rifle parts hang off one node so the whole weapon can be lowered/tilted
    // as a unit for the reload animation.
    const rifleNode = new TransformNode(`${this.id}_rifle`, this.scene);
    rifleNode.parent = this.visualRoot;
    this.rifleNode = rifleNode;
    const forward = 0.32; // out in front of the chest
    const y = 0.98;
    const receiver = MeshBuilder.CreateBox(`${this.id}_gun_body`, { width: 0.05, height: 0.09, depth: 0.5 }, this.scene);
    receiver.position.set(0.1, y, forward);
    receiver.material = assets.gunMetalMat;
    receiver.parent = rifleNode;
    receiver.isPickable = false;

    const barrel = MeshBuilder.CreateCylinder(`${this.id}_gun_barrel`, { diameter: 0.02, height: 0.28 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.1, y + 0.02, forward + 0.36);
    barrel.material = assets.gunMetalMat;
    barrel.parent = rifleNode;
    barrel.isPickable = false;

    const mag = MeshBuilder.CreateBox(`${this.id}_gun_mag`, { width: 0.035, height: 0.16, depth: 0.09 }, this.scene);
    mag.position.set(0.1, y - 0.11, forward + 0.02);
    mag.rotation.x = 0.35; // AK banana-mag forward curve
    mag.material = assets.gunMetalMat;
    mag.parent = rifleNode;
    mag.isPickable = false;

    const stock = MeshBuilder.CreateBox(`${this.id}_gun_stock`, { width: 0.04, height: 0.07, depth: 0.24 }, this.scene);
    stock.position.set(0.1, y, forward - 0.36);
    stock.material = assets.gunFurnitureMat;
    stock.parent = rifleNode;
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

    this.movingThisFrame = false;

    // AI must never occupy the army base: if a knockback/blast or navigation
    // edge case ever lands one inside the exclusion zone, immediately retreat
    // instead of running the normal FSM this frame.
    if (isInExclusionZone(this.root.position)) {
      this.retreatFromExclusionZone(dt);
      this.animateLocomotion(dt);
      return;
    }

    this.stateTimer += dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    // Reload runs on its own clock regardless of state, so an enemy that breaks
    // contact mid-reload still finishes it.
    this.updateReload(dt);

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
            // Human reaction time: face the target and settle before the first
            // shot. Harder waves react faster; early waves are noticeably slow.
            this.reactionTimer = 0.55 - 0.3 * Math.min(1, this.difficultyMult) + Math.random() * 0.15;
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
        // Hold fire until the reaction delay elapses (unless mid-reload).
        if (this.reactionTimer > 0) {
          this.reactionTimer -= dt;
          break;
        }
        this.tryFire(player);
        break;
      case "suppressed":
        this.suppressedTimer -= dt;
        if (this.suppressedTimer <= 0) this.state = "chase";
        break;
    }

    this.animateLocomotion(dt);
  }

  private wander(dt: number): void {
    const toTarget = this.patrolTarget.subtract(this.root.position);
    if (toTarget.length() < 1.2) {
      this.patrolTarget = this.pickPatrolTarget();
    } else {
      // Patrol at a steady walk (not a crawl) so OPFOR visibly move and advance
      // rather than milling on the spot.
      this.moveToward(this.patrolTarget, dt, this.type.moveSpeed * 0.62);
    }
  }

  /**
   * Patrol waypoints bias toward the central plaza with a wide lateral spread,
   * so idle OPFOR flow inward and fan out across the map instead of clustering
   * at the spawn edge. Near the centre they roam locally.
   */
  private pickPatrolTarget(): Vector3 {
    const pos = this.root.position;
    const toCentre = new Vector3(-pos.x, 0, -pos.z);
    const d = toCentre.length();
    if (d < 10) {
      const a = Math.random() * Math.PI * 2;
      return pos.add(new Vector3(Math.cos(a) * (8 + Math.random() * 10), 0, Math.sin(a) * (8 + Math.random() * 10)));
    }
    toCentre.normalize();
    const perp = new Vector3(-toCentre.z, 0, toCentre.x);
    const advance = 12 + Math.random() * 14;
    const lateral = (Math.random() - 0.5) * 20;
    return pos.add(toCentre.scale(advance)).add(perp.scale(lateral));
  }

  private moveToward(target: Vector3, dt: number, speedOverride?: number): void {
    const speed = speedOverride ?? this.type.moveSpeed;
    const pos = this.root.position;

    let dir: Vector3;
    if (this.escapeTimer > 0 && this.escapeDir) {
      // Mid-sidestep: keep moving along the escape vector to clear the snag.
      this.escapeTimer -= dt;
      dir = this.escapeDir;
    } else {
      dir = new Vector3(target.x - pos.x, 0, target.z - pos.z);
      if (dir.length() < 0.05) return;
      dir.normalize();
      // Curve around the camp's exclusion zone instead of walking straight at
      // its edge and stalling there — this is what lets OPFOR reroute around
      // the army base rather than clustering just outside it.
      dir = steerAroundExclusionZone(pos, dir);
    }

    const before = pos.clone();
    this.root.moveWithCollisions(dir.scale(speed * dt));
    this.root.rotation.y = Math.atan2(dir.x, dir.z);
    this.movingThisFrame = true;

    // Stuck detection: if we tried to move but barely did, count it; once it
    // persists, sidestep perpendicular for a beat to get around the obstacle.
    if (this.escapeTimer <= 0) {
      const moved = Vector3.Distance(this.root.position, before);
      if (moved < speed * dt * 0.35) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 0.45) {
          const side = Math.random() < 0.5 ? 1 : -1;
          this.escapeDir = new Vector3(-dir.z * side, 0, dir.x * side).normalize();
          this.escapeTimer = 0.7;
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 1.5);
      }
    }
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
    if (this.isReloading) return; // can't shoot mid-reload
    if (this.fireCooldown > 0) return;
    if (this.roundsInMag <= 0) {
      this.startReload();
      return;
    }
    // Early waves fire slower and less accurately — ramps to full lethality by ~wave 7.
    this.fireCooldown = 60 / (this.type.fireRateRpm * this.difficultyMult);
    this.roundsInMag -= 1;
    const hit = Math.random() < this.type.accuracy * this.difficultyMult;
    this.audio.gunshot();
    if (hit) {
      player.takeDamage(this.type.damage);
      this.onDamagePlayer?.(this.type.damage, this.root.position.clone());
      this.audio.playerHurt();
    }
    // Emptied the magazine — go straight into a reload so fire can't continue.
    if (this.roundsInMag <= 0) this.startReload();
  }

  /** Reload time by weapon class — the belt-fed LMG is the slowest to bring back up. */
  private reloadDuration(): number {
    return this.type.weapon === "generic_lmg" ? 4.5 : this.type.weapon === "generic_dmr" ? 2.8 : 2.4;
  }

  private startReload(): void {
    if (this.isReloading) return;
    this.isReloading = true;
    this.reloadTimer = this.reloadDuration();
    this.audio.reload();
  }

  /** Advance an in-progress reload and drive the gun-lowered reload animation. */
  private updateReload(dt: number): void {
    if (!this.isReloading) return;
    this.reloadTimer -= dt;
    const dur = this.reloadDuration();
    const progress = 1 - Math.max(0, this.reloadTimer) / dur; // 0 → 1
    // Dip and tilt the whole rifle down mid-reload, then bring it back up.
    const dip = Math.sin(Math.min(1, progress) * Math.PI);
    this.rifleNode.position.y = -dip * 0.14;
    this.rifleNode.rotation.x = dip * 0.55;
    if (this.reloadTimer <= 0) {
      this.isReloading = false;
      this.roundsInMag = this.magCapacity;
      this.rifleNode.position.y = 0;
      this.rifleNode.rotation.x = 0;
      // A fresh mag means re-acquiring the sight picture — small delay before firing.
      this.reactionTimer = Math.max(this.reactionTimer, 0.2);
    }
  }

  /** Leg-swing walk cycle + subtle body bob while moving; settles to rest when still. */
  private animateLocomotion(dt: number): void {
    if (this.movingThisFrame && this.state !== "dead") {
      this.walkPhase += dt * 9;
      const swing = Math.sin(this.walkPhase) * 0.5;
      if (this.legMeshes[0]) this.legMeshes[0].rotation.x = swing;
      if (this.legMeshes[1]) this.legMeshes[1].rotation.x = -swing;
      this.visualRoot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.04;
    } else {
      const decay = Math.max(0, 1 - dt * 10);
      for (const leg of this.legMeshes) leg.rotation.x *= decay;
      this.visualRoot.position.y *= decay;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.dispose(false, true);
  }
}
