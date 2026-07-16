import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Material,
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

/**
 * Enemy visual: a Figure 11 target — the standard hunched, charging-rifleman
 * silhouette used on live-fire ranges (see the reference art). It is a single
 * billboarded, alpha-tested, *unlit* plane, which is the whole point: the old
 * multi-mesh soldier occasionally rendered white / material-less under certain
 * lighting/order conditions, whereas an unlit textured cut-out can never wash
 * out or lose its material — it looks identical at every distance and in every
 * light. The silhouette texture is drawn once and shared by every target; each
 * target still gets its own thin material so it can flash red on hit.
 */
interface OpforAssets {
  figureTex: DynamicTexture;
}
const opforAssetCache = new WeakMap<Scene, OpforAssets>();

function getOpforAssets(scene: Scene): OpforAssets {
  const cached = opforAssetCache.get(scene);
  if (cached) return cached;
  const assets: OpforAssets = { figureTex: createFigure11Texture(scene) };
  opforAssetCache.set(scene, assets);
  return assets;
}

/**
 * Draws the Figure 11 charging-soldier silhouette (dark cut-out on a
 * transparent field) with faint concentric aiming rings over centre mass,
 * matching the reference target. Composed from filled primitives so it reads
 * as the hunched, rifle-forward figure without needing an image asset.
 */
function createFigure11Texture(scene: Scene): DynamicTexture {
  const W = 160;
  const H = 320;
  const tex = new DynamicTexture("figure11Tex", { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, W, H);

  const px = (nx: number) => nx * W;
  const py = (ny: number) => ny * H;
  const dark = "#15170f"; // near-black with a faint olive cast — reads as hostile, not paper
  ctx.fillStyle = dark;
  ctx.strokeStyle = dark;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Helmet + head.
  ctx.beginPath();
  ctx.ellipse(px(0.5), py(0.135), px(0.15), py(0.085), 0, Math.PI, 0); // helmet dome
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px(0.5), py(0.17), px(0.11), py(0.075), 0, 0, Math.PI * 2); // face/jaw
  ctx.fill();
  ctx.fillRect(px(0.34), py(0.13), px(0.32), py(0.03)); // helmet brim

  // Hunched torso (leaning forward) — a broad tapering slab.
  ctx.beginPath();
  ctx.moveTo(px(0.24), py(0.25));
  ctx.lineTo(px(0.78), py(0.29));
  ctx.lineTo(px(0.7), py(0.6));
  ctx.lineTo(px(0.32), py(0.58));
  ctx.closePath();
  ctx.fill();

  // Forward arm across the chest holding the rifle, and the rear arm.
  ctx.lineWidth = px(0.12);
  ctx.beginPath();
  ctx.moveTo(px(0.32), py(0.33));
  ctx.lineTo(px(0.74), py(0.46));
  ctx.stroke();
  // Rifle held across the body (thin barrel + stock line).
  ctx.lineWidth = px(0.045);
  ctx.beginPath();
  ctx.moveTo(px(0.22), py(0.52));
  ctx.lineTo(px(0.92), py(0.38));
  ctx.stroke();

  // Legs mid-stride.
  ctx.lineWidth = px(0.15);
  ctx.beginPath();
  ctx.moveTo(px(0.46), py(0.56));
  ctx.lineTo(px(0.33), py(0.95));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px(0.56), py(0.56));
  ctx.lineTo(px(0.66), py(0.95));
  ctx.stroke();

  // Faint red concentric aiming rings over centre mass.
  const cx = px(0.5);
  const cy = py(0.42);
  ctx.lineWidth = 2;
  for (const r of [px(0.18), px(0.12), px(0.06)]) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(200,60,50,0.55)";
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  tex.update(true);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
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
  // Invisible, pickable hitboxes (head = headshot, torso + legs = body). The
  // visible Figure 11 plane is non-pickable so shots pass through to these.
  private bodyMesh: Mesh;
  private headMesh: Mesh;
  private legsMesh: Mesh;
  /** The visible Figure 11 target silhouette (billboarded, unlit). */
  private figurePlane!: Mesh;
  private figureMat!: StandardMaterial;
  private visualRoot!: TransformNode;

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

    // All visual + hit meshes ride on this node. Locomotion bob is applied here.
    this.visualRoot = new TransformNode(`${this.id}_visual`, scene);
    this.visualRoot.parent = this.root;
    const vr = this.visualRoot;

    const assets = getOpforAssets(scene);

    // Per-enemy material over the shared Figure 11 texture. Fully UNLIT: the
    // colour comes straight from the texture (emissive) so no lighting setup,
    // exposure, or render order can ever wash it to white or strip it to a
    // material-less mesh — the exact failure the old soldier model hit. Alpha
    // testing keeps the silhouette a clean cut-out without transparency sorting.
    this.figureMat = new StandardMaterial(`${this.id}_figmat`, scene);
    this.figureMat.diffuseTexture = assets.figureTex;
    this.figureMat.emissiveTexture = assets.figureTex;
    this.figureMat.emissiveColor = new Color3(1, 1, 1);
    this.figureMat.diffuseColor = Color3.Black();
    this.figureMat.specularColor = Color3.Black();
    this.figureMat.disableLighting = true;
    this.figureMat.useAlphaFromDiffuseTexture = true;
    this.figureMat.transparencyMode = Material.MATERIAL_ALPHATEST;
    this.figureMat.alphaCutOff = 0.45;
    this.figureMat.backFaceCulling = false;

    // The visible target: one billboarded plane (~1.7 m tall) that always faces
    // the player around the vertical axis, like a pop-up range target.
    this.figurePlane = MeshBuilder.CreatePlane(`${this.id}_figure`, { width: 1.05, height: 1.85 }, scene);
    this.figurePlane.material = this.figureMat;
    this.figurePlane.parent = vr;
    this.figurePlane.position.y = 0.92;
    this.figurePlane.isPickable = false; // shots pass through to the hitboxes below
    this.figurePlane.billboardMode = Mesh.BILLBOARDMODE_Y;

    // Invisible, pickable hitboxes aligned with the silhouette. Head = headshot
    // multiplier; torso + legs = normal damage. Kept generous so shots that
    // clip the moving target still register.
    this.headMesh = MeshBuilder.CreateBox(`${this.id}_head`, { width: 0.32, height: 0.34, depth: 0.32 }, scene);
    this.headMesh.position.y = 1.6;
    this.headMesh.isVisible = false;
    this.headMesh.parent = vr;
    this.headMesh.metadata = { damageable: this, isHeadshotMesh: true } satisfies HitMeshMetadata;

    this.bodyMesh = MeshBuilder.CreateBox(`${this.id}_body`, { width: 0.62, height: 0.8, depth: 0.4 }, scene);
    this.bodyMesh.position.y = 1.02;
    this.bodyMesh.isVisible = false;
    this.bodyMesh.parent = vr;
    this.bodyMesh.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;

    this.legsMesh = MeshBuilder.CreateBox(`${this.id}_legs`, { width: 0.5, height: 0.62, depth: 0.34 }, scene);
    this.legsMesh.position.y = 0.34;
    this.legsMesh.isVisible = false;
    this.legsMesh.parent = vr;
    this.legsMesh.metadata = { damageable: this, isHeadshotMesh: false } satisfies HitMeshMetadata;
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
        mesh.isPickable &&
        mesh.checkCollisions &&
        mesh.name !== "playerCollider" &&
        !mesh.metadata?.damageable
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
    return this.type.sightRangeM * factor;
  }

  /**
   * Strict first-contact detection: the player must be inside the vision cone,
   * within the stance-scaled spotting range, and in clear line of sight. This
   * is deliberately hard to satisfy so AI don't magically notice a careful
   * player simply for being nearby.
   */
  private detectsPlayer(player: PlayerController, distToPlayer: number, playerInSafeZone: boolean): boolean {
    if (playerInSafeZone) return false;
    if (distToPlayer > this.detectionRange(player)) return false;
    if (!this.playerInFov(player)) return false;
    return this.hasLineOfSight(player);
  }

  /**
   * Looser "still have eyes on" test for an enemy that is already engaged —
   * once alerted it tracks the player as long as it has LOS within its full
   * sight range, regardless of stance. Losing LOS starts the give-up timer.
   */
  private hasContact(player: PlayerController, distToPlayer: number, playerInSafeZone: boolean): boolean {
    if (playerInSafeZone) return false;
    if (distToPlayer > this.type.sightRangeM) return false;
    return this.hasLineOfSight(player);
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
        // A heard shot gives a bearing to investigate even without line of sight.
        this.lastKnownPlayerPos = position.clone();
        this.lostContactTimer = 0;
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
    // Taking fire always reveals the shooter's rough position — push the enemy
    // into the hunt even if the player was perfectly stealthed until now.
    if (_sourcePosition) this.lastKnownPlayerPos = _sourcePosition.clone();
    this.lostContactTimer = 0;
    if (this.state !== "attack" && this.state !== "chase") {
      this.state = "chase";
    }
  }

  private flashHit(): void {
    // Tint the whole (unlit) target red for a moment — the emissive colour is
    // what the texture is multiplied by, so this reddens the silhouette.
    this.figureMat.emissiveColor = new Color3(1, 0.35, 0.32);
    setTimeout(() => {
      if (!this.isDead) this.figureMat.emissiveColor = new Color3(1, 1, 1);
    }, 80);
  }

  private die(headshot: boolean): void {
    this.isDead = true;
    this.state = "dead";
    this.engageLimiter?.releaseEngage(this.id);
    this.audio.enemyDeath();
    const credits = this.type.creditReward + (headshot ? ECONOMY.headshotBonus : 0);
    this.onDeath?.({ enemy: this, headshot, creditsAwarded: credits });
    // Drop the target like a hinged pop-up: stop billboarding and tip it flat
    // away from the player, then fade out after a few seconds.
    this.figurePlane.billboardMode = Mesh.BILLBOARDMODE_NONE;
    this.figurePlane.rotation.set(-Math.PI / 2.1, 0, 0);
    this.figurePlane.position.y = 0.06;
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
    // Two tiers of perception: strict first-contact detection (respects FOV +
    // stance/stealth) to *become* alerted, and a looser "eyes on" test to keep
    // tracking a target the enemy is already fighting.
    const detected = this.detectsPlayer(player, distToPlayer, playerInSafeZone);
    const contact = this.hasContact(player, distToPlayer, playerInSafeZone);
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

  /** Advance an in-progress reload and duck the target briefly (taking cover to reload). */
  private updateReload(dt: number): void {
    if (!this.isReloading) return;
    this.reloadTimer -= dt;
    const dur = this.reloadDuration();
    const progress = 1 - Math.max(0, this.reloadTimer) / dur; // 0 → 1
    // Bob the target down and back up to read as "ducking to reload".
    const dip = Math.sin(Math.min(1, progress) * Math.PI);
    this.figurePlane.position.y = 0.92 - dip * 0.18;
    if (this.reloadTimer <= 0) {
      this.isReloading = false;
      this.roundsInMag = this.magCapacity;
      this.figurePlane.position.y = 0.92;
      // A fresh mag means re-acquiring the sight picture — small delay before firing.
      this.reactionTimer = Math.max(this.reactionTimer, 0.2);
    }
  }

  /** Leg-swing walk cycle + subtle body bob while moving; settles to rest when still. */
  private animateLocomotion(dt: number): void {
    if (this.movingThisFrame && this.state !== "dead") {
      this.walkPhase += dt * 9;
      // Subtle vertical bob so a moving Figure 11 reads as advancing on foot
      // rather than sliding along the ground.
      this.visualRoot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06;
    } else {
      const decay = Math.max(0, 1 - dt * 10);
      this.visualRoot.position.y *= decay;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.dispose(false, true);
  }
}
