import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  TransformNode,
  Ray,
} from "@babylonjs/core";
import { ECONOMY, ELITE_WAVE, OFFICER_BUFF_ACCURACY_MULT, OFFICER_BUFF_FIRE_RATE_MULT, type EnemyType } from "@/data/gamedata";
import type { Damageable, HitMeshMetadata } from "@/weapons/Damageable";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";
import { CAMP_POSITION } from "@/world/Level";
import { isInSafeZone, isInExclusionZone, steerAroundExclusionZone } from "@/world/SafeZone";
import { isNavigable, findNearestNavigable, clampToPlayable, playableHalf } from "@/world/Nav";

export type EnemyState =
  | "idle"
  | "patrol"
  | "alerted"
  | "chase"
  | "attack"
  | "suppressed"
  | "dead";

let enemyCounter = 0;

/** Rotate a flat (XZ) direction vector by `angle` radians about the Y axis. */
function rotateY(dir: Vector3, angle: number): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Vector3(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
}

/** Ease `current` yaw toward `target` (shortest way round) at `rate` per second — smooths heading changes. */
function smoothYaw(current: number, target: number, dt: number, rate: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * Math.min(1, rate * dt);
}

// --- Perception tuning -----------------------------------------------------
// A soldier only spots the player through a forward cone (~120° total), never
// behind them. cos(60°) = 0.5.
const FOV_COS_HALF_ANGLE = 0.5;
// How the player's stance/motion scales the enemy's base sight range. Running
// or firing makes you easy to see; standing still or crouching in cover makes
// you very hard to notice until close. These are the core stealth knobs.
const DETECT_FACTOR = {
  sprint: 1.0,
  walk: 0.6,
  standStill: 0.3,
  crouchWalk: 0.3,
  crouchStill: 0.15,
  firingFloor: 1.2, // firing spikes visibility to at least this, whatever the stance
};
// Once actively tracking, an enemy keeps hunting the player's last-known
// position for this long after losing line of sight before giving up. This is
// what lets the player break contact by breaking LOS and going quiet.
const LOSE_CONTACT_SEC = 5;

// --- Fire accuracy tuning ---------------------------------------------------
// Global marksmanship nerf on top of the per-type accuracy — makes sustained
// firefights survivable rather than a wall of guaranteed hits (~35% cut).
const ACCURACY_GLOBAL = 0.65;
// Aim error grows with range: full accuracy holds out to this distance, then
// the hit chance scales down toward ACCURACY_MIN_DISTANCE_FACTOR at sight edge.
const ACCURACY_NEAR_M = 12;
const ACCURACY_MIN_DISTANCE_FACTOR = 0.4;
// Multiplier applied to hit chance while the soldier is under suppression.
const SUPPRESSION_ACCURACY_FACTOR = 0.45;
const SUPPRESSION_ACCURACY_SEC = 2.2;

/**
 * OPFOR are solid low-poly 3D soldiers again (not flat billboards) — the
 * billboard silhouette was hard to pick out against the dark city. To stay
 * easy to see AND rendering-reliable, every material carries an `emissiveColor`
 * floor: the soldier keeps a clear self-lit base colour in any lighting or
 * exposure (never washed to white, never crushed to black) while diffuse
 * shading still gives it 3D form. The uniform is a deliberately loud
 * hostile-orange so enemies read instantly at range. Equipment materials are
 * shared across all soldiers (built once); the body/uniform material is
 * per-enemy so it can flash on hit.
 */
interface OpforAssets {
  vestMat: StandardMaterial;
  skinMat: StandardMaterial;
  helmetMat: StandardMaterial;
  bootMat: StandardMaterial;
  gunMetalMat: StandardMaterial;
  contactShadowMat: StandardMaterial;
}
const opforAssetCache = new WeakMap<Scene, OpforAssets>();

/**
 * Per-class accent colour so the three OPFOR types are recognisable at a
 * glance without losing the hostile-orange base read: a bright helmet band +
 * shoulder patch in a colour tied to the class. Visible at medium range,
 * subtle enough up close not to look like a uniform malfunction.
 */
const CLASS_ACCENT_COLOR: Record<string, Color3> = {
  opfor_grunt: new Color3(0.2, 0.75, 0.25), // green — baseline rifleman
  opfor_marksman: new Color3(0.2, 0.45, 0.95), // blue — long-range threat
  opfor_heavy: new Color3(0.12, 0.12, 0.14), // dark/black — armoured support gunner
  opfor_officer: new Color3(0.95, 0.78, 0.15), // gold — high-priority, buffs nearby OPFOR
};
const classAccentCache = new WeakMap<Scene, Map<string, StandardMaterial>>();

function getClassAccentMat(scene: Scene, typeId: string): StandardMaterial {
  let byType = classAccentCache.get(scene);
  if (!byType) {
    byType = new Map();
    classAccentCache.set(scene, byType);
  }
  let mat = byType.get(typeId);
  if (!mat) {
    const color = CLASS_ACCENT_COLOR[typeId] ?? new Color3(0.6, 0.6, 0.6);
    mat = litMat(scene, `opforAccent_${typeId}`, color, 0.55);
    byType.set(typeId, mat);
  }
  return mat;
}

/** StandardMaterial with an emissive floor so it can never render white or pitch-black. */
function litMat(scene: Scene, name: string, diffuse: Color3, emissiveScale = 0.4): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = diffuse;
  mat.emissiveColor = diffuse.scale(emissiveScale);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  return mat;
}

function getOpforAssets(scene: Scene): OpforAssets {
  const cached = opforAssetCache.get(scene);
  if (cached) return cached;
  const assets: OpforAssets = {
    vestMat: litMat(scene, "opforVestMat", new Color3(0.12, 0.12, 0.11), 0.3),
    skinMat: litMat(scene, "opforSkinMat", new Color3(0.6, 0.44, 0.34)),
    helmetMat: litMat(scene, "opforHelmetMat", new Color3(0.14, 0.15, 0.11), 0.35),
    bootMat: litMat(scene, "opforBootMat", new Color3(0.08, 0.08, 0.08), 0.3),
    gunMetalMat: litMat(scene, "opforGunMetalMat", new Color3(0.1, 0.1, 0.12), 0.3),
    contactShadowMat: (() => {
      const mat = new StandardMaterial("opforShadowMat", scene);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.alpha = 0.34;
      mat.disableLighting = true;
      return mat;
    })(),
  };
  opforAssetCache.set(scene, assets);
  return assets;
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
  // Visible + hittable meshes: torso (body), head (headshot), plus arms/legs.
  private bodyMesh: Mesh;
  private headMesh: Mesh;
  private limbMeshes: Mesh[] = [];
  private legMeshes: Mesh[] = [];
  private rifleNode!: TransformNode;
  private visualRoot!: TransformNode;
  /** Per-enemy uniform material — flashes on hit. */
  private bodyMat!: StandardMaterial;

  health: number;
  readonly maxHealth: number;
  state: EnemyState = "idle";
  isDead = false;
  disposed = false;

  private patrolTarget: Vector3;
  // Last position the player was actually seen at — chased toward after LOS is
  // broken, and where a search sweep centres before the enemy gives up.
  private lastKnownPlayerPos: Vector3 | null = null;
  private lostContactTimer = 0;
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
  // Suppression accuracy penalty: taking fire (or a flashbang) shakes the
  // soldier's aim for a short window even if it keeps shooting. Separate from
  // the full "suppressed" FSM state (which stops fire entirely).
  private accuracySuppressionTimer = 0;
  // Carpet Bombing survivor debuffs: a slower, longer-lasting movement and
  // accuracy penalty on top of (and outlasting) the short suppress() stun.
  private slowMult = 1;
  private slowTimer = 0;
  private bombAccuracyMult = 1;
  private bombAccuracyTimer = 0;
  // Locomotion animation.
  private walkPhase = 0;
  private movingThisFrame = false;
  // Anti-stuck: when movement is repeatedly blocked (a container lane wall, a
  // building corner), sidestep along an escape vector for a moment.
  private stuckTimer = 0;
  private escapeDir: Vector3 | null = null;
  private escapeTimer = 0;
  // Building-avoidance steering: a deflection angle refreshed on a short clock
  // that curves the path around solid geometry so the AI never grinds a wall.
  private steerAngle = 0;
  private steerTimer = Math.random() * 0.15;
  // Hard-stuck escalation: total time making no real progress. Past a few
  // seconds the enemy is teleported to the nearest navigable point.
  private hardStuckTimer = 0;
  // Periodic "am I trapped in geometry / out of bounds?" self-check clock.
  private navCheckTimer = Math.random() * 1.5;
  // Throttled-perception cache (see update()) — random start staggers enemies.
  private visionTimer = Math.random() * 0.2;
  private cachedDetected = false;
  private cachedContact = false;

  onDeath?: (info: EnemyKillInfo) => void;
  onDamagePlayer?: (damage: number, sourcePosition: Vector3) => void;
  /** Set every frame by EnemyManager while this soldier stands within a living Officer's buff radius. */
  officerBuffed = false;

  constructor(
    private readonly scene: Scene,
    readonly type: EnemyType,
    spawnPosition: Vector3,
    private readonly waveHealthMult: number,
    private readonly audio: AudioManager,
    /** Fraction of base accuracy/fire-rate actually applied — ramps up over early waves. */
    private readonly difficultyMult: number = 1,
    private readonly engageLimiter?: EngagementLimiter,
    /** True when spawned on an Elite Wave — scales health/damage/credit reward up. */
    private readonly isElite: boolean = false
  ) {
    this.id = `enemy_${type.id}_${enemyCounter++}`;
    this.maxHealth = Math.round(type.health * waveHealthMult * (isElite ? ELITE_WAVE.healthMult : 1));
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

    // All visual + hit meshes ride on this node (scaled to soldier height).
    this.visualRoot = new TransformNode(`${this.id}_visual`, scene);
    this.visualRoot.parent = this.root;
    this.visualRoot.scaling.setAll(0.95);
    const vr = this.visualRoot;

    const assets = getOpforAssets(scene);

    // Soft contact shadow under the feet — grounds the soldier on whatever
    // surface it stands on (the static sun shadow map only covers the level).
    const contactShadow = MeshBuilder.CreateDisc(`${this.id}_shadow`, { radius: 0.42, tessellation: 16 }, scene);
    contactShadow.rotation.x = Math.PI / 2;
    contactShadow.position.y = 0.04;
    contactShadow.material = assets.contactShadowMat;
    contactShadow.parent = vr;
    contactShadow.isPickable = false;

    // Per-enemy uniform material: loud hostile-orange with an emissive floor so
    // the soldier is easy to spot at range and can never render white or black.
    this.bodyMat = litMat(scene, `${this.id}_mat`, new Color3(0.86, 0.36, 0.14), 0.42);

    // Torso — the main hittable mass, a touch generous so edge hits still count.
    this.bodyMesh = MeshBuilder.CreateBox(`${this.id}_body`, { width: 0.56, height: 1.0, depth: 0.36 }, scene);
    this.bodyMesh.position.y = 0.98;
    this.bodyMesh.material = this.bodyMat;
    this.bodyMesh.parent = vr;
    this.bodyMesh.metadata = { damageable: this, hitZone: "body", isHeadshotMesh: false } satisfies HitMeshMetadata;

    // Plate carrier / chest rig with a row of mag pouches.
    const vest = MeshBuilder.CreateBox(`${this.id}_vest`, { width: 0.54, height: 0.58, depth: 0.14 }, scene);
    vest.position.set(0, 1.06, 0.18);
    vest.material = assets.vestMat;
    vest.parent = vr;
    vest.isPickable = false;

    // Neck + head (headshot hitbox) + helmet.
    const neck = MeshBuilder.CreateCylinder(`${this.id}_neck`, { diameter: 0.15, height: 0.12 }, scene);
    neck.position.y = 1.52;
    neck.material = assets.skinMat;
    neck.parent = vr;
    neck.isPickable = false;

    this.headMesh = MeshBuilder.CreateBox(`${this.id}_head`, { width: 0.27, height: 0.3, depth: 0.27 }, scene);
    this.headMesh.position.y = 1.67;
    this.headMesh.material = assets.skinMat;
    this.headMesh.parent = vr;
    this.headMesh.metadata = { damageable: this, hitZone: "head", isHeadshotMesh: true } satisfies HitMeshMetadata;

    const helmet = MeshBuilder.CreateSphere(`${this.id}_helmet`, { diameter: 0.33, slice: 0.62 }, scene);
    helmet.position.y = 1.78;
    helmet.material = assets.helmetMat;
    helmet.parent = vr;

    // Class-identification accent: a coloured chest patch, visible at medium
    // range without recolouring the whole hostile silhouette. (A helmet-band
    // torus used to sit here too but was dropped for performance — a torus is
    // the priciest primitive per soldier and the patch already reads the class.)
    const accentMat = getClassAccentMat(scene, type.id);
    const chestPatch = MeshBuilder.CreateBox(`${this.id}_chestPatch`, { width: 0.1, height: 0.1, depth: 0.02 }, scene);
    chestPatch.position.set(0.18, 1.2, 0.26);
    chestPatch.material = accentMat;
    chestPatch.parent = vr;
    chestPatch.isPickable = false;
    helmet.isPickable = false;

    const shoulders = MeshBuilder.CreateBox(`${this.id}_shoulders`, { width: 0.66, height: 0.16, depth: 0.38 }, scene);
    shoulders.position.y = 1.42;
    shoulders.material = this.bodyMat;
    shoulders.parent = vr;
    // Non-pickable so a shot here passes through to the torso hitbox behind it
    // rather than landing on an un-tagged mesh and dealing no damage.
    shoulders.isPickable = false;

    // Arms (hittable) with gloves.
    for (const x of [-0.36, 0.36]) {
      const arm = MeshBuilder.CreateBox(`${this.id}_arm_${x}`, { width: 0.16, height: 0.66, depth: 0.2 }, scene);
      arm.position.set(x, 1.06, 0.02);
      arm.material = this.bodyMat;
      arm.parent = vr;
      arm.metadata = { damageable: this, hitZone: "limb", isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(arm);
      const hand = MeshBuilder.CreateBox(`${this.id}_hand_${x}`, { width: 0.13, height: 0.14, depth: 0.15 }, scene);
      hand.position.set(0, -0.39, 0.06);
      hand.material = assets.vestMat;
      hand.parent = arm;
      hand.isPickable = false;
    }
    // Legs (hittable, animated) with boots.
    for (const x of [-0.15, 0.15]) {
      const leg = MeshBuilder.CreateBox(`${this.id}_leg_${x}`, { width: 0.2, height: 0.78, depth: 0.24 }, scene);
      leg.position.set(x, 0.42, 0);
      leg.material = this.bodyMat;
      leg.parent = vr;
      leg.metadata = { damageable: this, hitZone: "limb", isHeadshotMesh: false } satisfies HitMeshMetadata;
      this.limbMeshes.push(leg);
      this.legMeshes.push(leg);
      const boot = MeshBuilder.CreateBox(`${this.id}_boot_${x}`, { width: 0.22, height: 0.14, depth: 0.34 }, scene);
      boot.position.set(0, -0.35, 0.06);
      boot.material = assets.bootMat;
      boot.parent = leg;
      boot.isPickable = false;
    }

    this.buildHeldRifle(assets);

    // Solid meshes cull correctly, but force the torso always-active as a belt-
    // and-braces guard against an "alive but never drawn" enemy.
    this.bodyMesh.alwaysSelectAsActiveMesh = true;
  }

  /** A simple rifle held across the chest — visual dressing, lowered on reload. */
  private buildHeldRifle(assets: OpforAssets): void {
    const rifleNode = new TransformNode(`${this.id}_rifle`, this.scene);
    rifleNode.parent = this.visualRoot;
    this.rifleNode = rifleNode;
    const forward = 0.3;
    const y = 0.98;
    const receiver = MeshBuilder.CreateBox(`${this.id}_gun_body`, { width: 0.05, height: 0.09, depth: 0.48 }, this.scene);
    receiver.position.set(0.1, y, forward);
    receiver.material = assets.gunMetalMat;
    receiver.parent = rifleNode;
    receiver.isPickable = false;
    const barrel = MeshBuilder.CreateCylinder(`${this.id}_gun_barrel`, { diameter: 0.02, height: 0.26 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.1, y + 0.02, forward + 0.34);
    barrel.material = assets.gunMetalMat;
    barrel.parent = rifleNode;
    barrel.isPickable = false;
    const mag = MeshBuilder.CreateBox(`${this.id}_gun_mag`, { width: 0.035, height: 0.16, depth: 0.09 }, this.scene);
    mag.position.set(0.1, y - 0.11, forward + 0.02);
    mag.rotation.x = 0.35;
    mag.material = assets.gunMetalMat;
    mag.parent = rifleNode;
    mag.isPickable = false;
  }

  private eyePosition(): Vector3 {
    return this.root.position.add(new Vector3(0, 1.6, 0));
  }

  private distanceToPlayer(player: PlayerController): number {
    return Vector3.Distance(this.root.position, player.position);
  }

  /**
   * True only if nothing solid stands between the enemy's eye and the player.
   * Vision is blocked by any *collidable* world mesh — buildings, walls,
   * vehicles, shipping containers, hedges and dense bushes all set
   * `checkCollisions`, so this single rule stops AI seeing through every kind
   * of cover. Glass, tree canopies and flat decals are non-collidable, so they
   * (correctly) don't block sight. The player's own invisible collider capsule
   * and all combatant hit meshes are excluded so they can never self-block.
   */
  private hasLineOfSight(player: PlayerController): boolean {
    // Aim at the player's chest at their *current* eye height so crouching
    // actually drops them behind waist-high cover.
    const targetY = player.crouching ? 0.9 : 1.4;
    const from = this.eyePosition();
    const to = player.position.add(new Vector3(0, targetY, 0));
    const dir = to.subtract(from);
    const dist = dir.length();
    if (dist <= 0.01) return true;
    dir.normalize();
    const ray = new Ray(from, dir, dist - 0.3);
    const pick = this.scene.pickWithRay(
      ray,
      (mesh) =>
        // Solid world geometry blocks sight, and so does thrown smoke (an
        // obscurant with checkCollisions off, tagged isSmoke) — that's the
        // whole point of a smoke screen: it hides the player from the AI.
        (mesh.metadata?.isSmoke ||
          (mesh.isPickable && mesh.checkCollisions && !mesh.metadata?.damageable)) &&
        mesh.name !== "playerCollider"
    );
    return !pick?.hit;
  }

  /** True if the player lies inside the enemy's forward vision cone (not behind it). */
  private playerInFov(player: PlayerController): boolean {
    const yaw = this.root.rotation.y;
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const to = player.position.subtract(this.root.position);
    to.y = 0;
    if (to.lengthSquared() < 0.0001) return true;
    to.normalize();
    return Vector3.Dot(forward, to) >= FOV_COS_HALF_ANGLE;
  }

  /**
   * Effective spotting range for the player's current stance/motion. Sprinting
   * or firing lights the player up; standing still or crouching in cover keeps
   * them hidden until very close.
   */
  private detectionRange(player: PlayerController): number {
    let factor: number;
    if (player.sprinting) factor = DETECT_FACTOR.sprint;
    else if (player.crouching) factor = player.isMoving ? DETECT_FACTOR.crouchWalk : DETECT_FACTOR.crouchStill;
    else factor = player.isMoving ? DETECT_FACTOR.walk : DETECT_FACTOR.standStill;
    if (player.firedRecently) factor = Math.max(factor, DETECT_FACTOR.firingFloor);
    // A visible laser beam gives the player away — floors detection at
    // walking-visibility even while crouched and still.
    if (player.laserOn) factor = Math.max(factor, DETECT_FACTOR.walk);
    return this.type.sightRangeM * factor;
  }

  suppress(durationSec: number): void {
    if (this.state === "dead") return;
    this.engageLimiter?.releaseEngage(this.id);
    this.state = "suppressed";
    this.suppressedTimer = durationSec;
    this.accuracySuppressionTimer = Math.max(this.accuracySuppressionTimer, durationSec);
  }

  /** Carpet Bombing survivor debuff: stunned briefly, then slowed and less accurate for longer. */
  applyBombingDebuff(stunSec: number, slowMult: number, slowSec: number, accuracyMult: number, accuracySec: number): void {
    if (this.isDead) return;
    if (stunSec > 0) this.suppress(stunSec);
    this.slowMult = Math.min(this.slowMult, slowMult);
    this.slowTimer = Math.max(this.slowTimer, slowSec);
    this.bombAccuracyMult = Math.min(this.bombAccuracyMult, accuracyMult);
    this.bombAccuracyTimer = Math.max(this.bombAccuracyTimer, accuracySec);
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
        // A heard shot gives a bearing to investigate even without line of sight.
        this.lastKnownPlayerPos = position.clone();
        this.lostContactTimer = 0;
      }
    }
  }

  takeDamage(damage: number, _isHeadshot: boolean, _sourcePosition?: Vector3, armorPiercing = false): void {
    if (this.isDead) return;
    // FMJ ammo bypasses this soldier's armour multiplier entirely — a Heavy
    // hit with FMJ takes damage as if it were an unarmoured rifleman.
    const effectiveDamage = armorPiercing ? damage : damage * this.type.armorMultiplier;
    this.health -= effectiveDamage;
    this.flashHit();
    // Being hit rattles the aim for a moment — degrades this soldier's accuracy
    // (distinct from the full suppressed FSM state).
    this.accuracySuppressionTimer = SUPPRESSION_ACCURACY_SEC;
    if (this.health <= 0) {
      this.die(_isHeadshot);
      return;
    }
    // Taking fire always reveals the shooter's rough position — push the enemy
    // into the hunt even if the player was perfectly stealthed until now.
    if (_sourcePosition) this.lastKnownPlayerPos = _sourcePosition.clone();
    this.lostContactTimer = 0;
    if (this.state !== "attack" && this.state !== "chase") {
      this.state = "chase";
    }
  }

  private flashHit(): void {
    // Bright emissive flash on the uniform for clear hit feedback.
    this.bodyMat.emissiveColor = new Color3(1, 0.55, 0.2);
    setTimeout(() => {
      if (!this.isDead) this.bodyMat.emissiveColor = this.bodyMat.diffuseColor.scale(0.42);
    }, 80);
  }

  private die(headshot: boolean): void {
    this.isDead = true;
    this.state = "dead";
    this.engageLimiter?.releaseEngage(this.id);
    this.audio.enemyDeath();
    const credits = (this.type.creditReward + (headshot ? ECONOMY.headshotBonus : 0)) * (this.isElite ? ELITE_WAVE.creditRewardMult : 1);
    this.onDeath?.({ enemy: this, headshot, creditsAwarded: credits });
    // Collapse the body flat to the ground, then fade out after a few seconds.
    this.root.scaling = new Vector3(1, 0.16, 1);
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

    // Gravity: soldiers walk with moveWithCollisions on the XZ plane, which
    // holds Y constant — over sunken ground (the monsoon canal, embankments)
    // they hovered mid-air. A constant downward collision step keeps their
    // feet planted on whatever surface is actually below them.
    this.root.moveWithCollisions(new Vector3(0, -6 * dt, 0));

    // Safety net against getting trapped in geometry or shoved out of bounds by
    // a blast/knockback: periodically confirm we're on walkable ground and,
    // failing that, snap to the nearest navigable point. Runs on a cheap ~1.5s
    // clock so it's not a per-frame raycast.
    this.navCheckTimer -= dt;
    if (this.navCheckTimer <= 0) {
      this.navCheckTimer = 1.2 + Math.random() * 0.6;
      if (!isNavigable(this.scene, this.root.position)) this.relocateToNavigable();
    }

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
    if (this.accuracySuppressionTimer > 0) this.accuracySuppressionTimer -= dt;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowMult = 1;
    }
    if (this.bombAccuracyTimer > 0) {
      this.bombAccuracyTimer -= dt;
      if (this.bombAccuracyTimer <= 0) this.bombAccuracyMult = 1;
    }
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
    // Two tiers of perception: strict first-contact detection (respects FOV +
    // stance/stealth) to *become* alerted, and a looser "eyes on" test to keep
    // tracking a target the enemy is already fighting. Both need a
    // line-of-sight raycast, which was by far the most expensive per-frame AI
    // work (2 scene raycasts × every enemy × every frame) — so perception now
    // runs on a short jittered timer (~7Hz per enemy, staggered so enemies
    // don't all raycast on the same frame) with ONE shared LOS ray, and the
    // FSM reads the cached result in between. A ~0.15s stale window is
    // imperceptible against the existing 0.25-0.55s reaction timers.
    this.visionTimer -= dt;
    if (this.visionTimer <= 0) {
      this.visionTimer = 0.12 + Math.random() * 0.08;
      if (playerInSafeZone || distToPlayer > this.type.sightRangeM) {
        // Cheap distance/safe-zone gate: no raycast at all when out of range.
        this.cachedContact = false;
        this.cachedDetected = false;
      } else {
        const los = this.hasLineOfSight(player);
        this.cachedContact = los;
        this.cachedDetected = los && distToPlayer <= this.detectionRange(player) && this.playerInFov(player);
      }
    }
    const detected = this.cachedDetected;
    const contact = this.cachedContact;
    if (contact) {
      this.lastKnownPlayerPos = player.position.clone();
      this.lostContactTimer = 0;
    }

    switch (this.state) {
      case "idle":
        this.state = "patrol";
        break;
      case "patrol":
        this.wander(dt);
        if (detected) {
          this.lastKnownPlayerPos = player.position.clone();
          this.lostContactTimer = 0;
          this.state = "alerted";
        }
        break;
      case "alerted":
        if (this.stateTimer > 0.6) this.state = "chase";
        this.facePlayer(player);
        break;
      case "chase": {
        // Head for where the player actually is if still in contact, otherwise
        // press toward the last-known position while searching.
        const goal = contact ? player.position : this.lastKnownPlayerPos ?? player.position;
        this.moveToward(goal, dt);
        if (contact && distToPlayer < this.type.sightRangeM * 0.85) {
          // Approaches regardless, but only opens fire once a concurrent-attacker slot frees up.
          if (!this.engageLimiter || this.engageLimiter.requestEngage(this.id, wave)) {
            this.state = "attack";
            // Human reaction time: face the target and settle before the first
            // shot. Harder waves react faster; early waves are noticeably slow.
            this.reactionTimer = 0.55 - 0.3 * Math.min(1, this.difficultyMult) + Math.random() * 0.15;
          }
        } else if (!contact) {
          // No eyes on the target — count down to giving up and returning to patrol.
          this.lostContactTimer += dt;
          if (this.lostContactTimer > LOSE_CONTACT_SEC) {
            this.state = "patrol";
            this.patrolTarget = this.lastKnownPlayerPos?.clone() ?? this.root.position.clone();
            this.lastKnownPlayerPos = null;
          }
        }
        break;
      }
      case "attack":
        this.facePlayer(player);
        if (!contact) {
          // Lost sight mid-fight — stop shooting and resume the hunt/search.
          this.engageLimiter?.releaseEngage(this.id);
          this.lostContactTimer = 0;
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
    const speed = (speedOverride ?? this.type.moveSpeed) * this.slowMult;
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
      // Proactively steer around buildings/props so OPFOR flow along walls and
      // fight from outside instead of grinding into a facade (which is what
      // triggered the sidestep jitter and last-resort teleporting). Refreshed
      // on a short clock so it costs a few raycasts a second, not per frame.
      this.steerTimer -= dt;
      if (this.steerTimer <= 0) {
        this.steerTimer = 0.14 + Math.random() * 0.06;
        this.steerAngle = this.computeAvoidanceAngle(pos, dir);
      }
      if (this.steerAngle !== 0) dir = rotateY(dir, this.steerAngle);
    }

    const before = pos.clone();
    this.root.moveWithCollisions(dir.scale(speed * dt));
    // Smoothly turn toward the heading of travel instead of snapping — removes
    // the visible spin/jitter when the steer direction changes.
    const targetYaw = Math.atan2(dir.x, dir.z);
    this.root.rotation.y = smoothYaw(this.root.rotation.y, targetYaw, dt, 10);
    this.movingThisFrame = true;

    // Hard boundary: never allow an enemy to drift outside the playable arena.
    const bound = playableHalf();
    if (Math.abs(this.root.position.x) > bound || Math.abs(this.root.position.z) > bound) {
      const clamped = clampToPlayable(this.root.position);
      this.root.position.x = clamped.x;
      this.root.position.z = clamped.z;
    }

    // Stuck detection: if we tried to move but barely did, count it; once it
    // persists, sidestep perpendicular for a beat to get around the obstacle.
    const moved = Vector3.Distance(this.root.position, before);
    const barelyMoved = moved < speed * dt * 0.35;
    if (this.escapeTimer <= 0) {
      if (barelyMoved) {
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
    // Escalation: if avoidance-steering AND sidestepping both fail to restore
    // real progress for a good while, the enemy is genuinely wedged — only then
    // relocate. The higher threshold (with steering now handling most snags)
    // means the jarring teleport almost never fires in practice.
    if (barelyMoved) {
      this.hardStuckTimer += dt;
      if (this.hardStuckTimer > 5) this.relocateToNavigable();
    } else {
      this.hardStuckTimer = Math.max(0, this.hardStuckTimer - dt * 2);
    }
  }

  /**
   * If a building/prop blocks the way ahead, find the smallest left/right
   * deflection that opens a clear lane and return it as a yaw offset (0 = path
   * already clear). Probes a torso-height ray forward, then widening angles to
   * each side — this is what makes OPFOR follow walls around a block instead of
   * pathing into it.
   */
  private computeAvoidanceAngle(pos: Vector3, dir: Vector3): number {
    const eye = pos.add(new Vector3(0, 0.9, 0));
    const probe = 3.2;
    if (this.pathClear(eye, dir, probe)) return 0;
    // Prefer the gentlest deflection; try both sides at each widening angle.
    for (const deg of [30, 55, 80, 110]) {
      const rad = (deg * Math.PI) / 180;
      const rightClear = this.pathClear(eye, rotateY(dir, rad), probe);
      const leftClear = this.pathClear(eye, rotateY(dir, -rad), probe);
      if (rightClear && leftClear) return Math.random() < 0.5 ? rad : -rad;
      if (rightClear) return rad;
      if (leftClear) return -rad;
    }
    return 0; // boxed in — the sidestep/teleport fallback takes over
  }

  /** True if nothing solid (excluding the player and other combatants) is within `len` along `dir`. */
  private pathClear(from: Vector3, dir: Vector3, len: number): boolean {
    const ray = new Ray(from, dir, len);
    const pick = this.scene.pickWithRay(
      ray,
      (m) =>
        m.isPickable &&
        m.checkCollisions &&
        m !== this.root &&
        m.name !== "playerCollider" &&
        !m.metadata?.damageable
    );
    return !pick?.hit;
  }

  /** Teleport to the nearest walkable ground and clear all stuck state. */
  private relocateToNavigable(): void {
    const safe = findNearestNavigable(this.scene, this.root.position, 18);
    this.root.position.x = safe.x;
    this.root.position.z = safe.z;
    this.hardStuckTimer = 0;
    this.stuckTimer = 0;
    this.escapeTimer = 0;
    this.escapeDir = null;
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
    // An Officer's buff aura speeds up the cyclic rate of everyone near it.
    const fireRateMult = this.officerBuffed ? OFFICER_BUFF_FIRE_RATE_MULT : 1;
    this.fireCooldown = 60 / (this.type.fireRateRpm * this.difficultyMult * fireRateMult);
    this.roundsInMag -= 1;
    const hit = Math.random() < this.hitChance(player);
    this.audio.gunshot();
    if (hit) {
      const damage = this.type.damage * (this.isElite ? ELITE_WAVE.damageMult : 1);
      player.takeDamage(damage);
      this.onDamagePlayer?.(damage, this.root.position.clone());
      this.audio.playerHurt();
    }
    // Emptied the magazine — go straight into a reload so fire can't continue.
    if (this.roundsInMag <= 0) this.startReload();
  }

  /**
   * Per-shot hit probability: base per-type accuracy, scaled by the wave
   * difficulty ramp, a global marksmanship nerf, an aim-error term that grows
   * with range, and a suppression penalty while the soldier is under fire.
   */
  private hitChance(player: PlayerController): number {
    // An Officer's buff aura sharpens the aim of everyone near it.
    const officerMult = this.officerBuffed ? OFFICER_BUFF_ACCURACY_MULT : 1;
    const base = this.type.accuracy * this.difficultyMult * ACCURACY_GLOBAL * officerMult;
    // Distance factor: 1.0 within ACCURACY_NEAR_M, easing to the floor at the
    // edge of this soldier's sight range.
    const dist = this.distanceToPlayer(player);
    const span = Math.max(1, this.type.sightRangeM - ACCURACY_NEAR_M);
    const t = Math.min(1, Math.max(0, (dist - ACCURACY_NEAR_M) / span));
    const distanceFactor = 1 - t * (1 - ACCURACY_MIN_DISTANCE_FACTOR);
    const suppressionFactor = this.accuracySuppressionTimer > 0 ? SUPPRESSION_ACCURACY_FACTOR : 1;
    return base * distanceFactor * suppressionFactor * this.bombAccuracyMult;
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

  /** Advance an in-progress reload and dip/tilt the rifle down as a reload tell. */
  private updateReload(dt: number): void {
    if (!this.isReloading) return;
    this.reloadTimer -= dt;
    const dur = this.reloadDuration();
    const progress = 1 - Math.max(0, this.reloadTimer) / dur; // 0 → 1
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
