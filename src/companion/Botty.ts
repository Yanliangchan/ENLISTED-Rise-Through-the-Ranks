import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
  Vector3,
  Ray,
} from "@babylonjs/core";
import type { PlayerController } from "@/player/PlayerController";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { EnemyInstance } from "@/enemies/EnemyAI";
import type { AudioManager } from "@/core/AudioManager";
import type { HitMeshMetadata } from "@/weapons/Damageable";
import { CAMP_POSITION } from "@/world/Level";
import { isInSafeZone } from "@/world/SafeZone";
import { findNearestNavigable } from "@/world/Nav";

export type BottyCommand = "default" | "followMe" | "goDark" | "coverMe" | "engage" | "retreat";

export const BOTTY_MAX_HEALTH = 150;
export const BOTTY_PRICE = 22000; // +10% economy rebalance, rounded to nearest $100

const MAG_SIZE = 25;
const RELOAD_SEC = 2.2;
const FIRE_INTERVAL = 0.14;
const DAMAGE_PER_HIT = 9;
const MOVE_SPEED = 4.4;

function litMat(scene: Scene, name: string, diffuse: Color3, emissive = 0.35): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = diffuse;
  mat.emissiveColor = diffuse.scale(emissive);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  return mat;
}

/**
 * A purchasable AI squadmate. Reuses the same hitscan-target shape as
 * EnemyInstance (a capsule collider + tagged hit meshes) so it can be shot,
 * but never damages the player and only ever fires at enemies pulled from
 * the shared EnemyManager. Behaviour is driven entirely by `command`, set
 * either by the default state machine or explicitly via the command wheel.
 */
export class BottyController {
  readonly root: Mesh;
  private visualRoot: TransformNode;
  private bodyMat: StandardMaterial;

  health = BOTTY_MAX_HEALTH;
  readonly maxHealth = BOTTY_MAX_HEALTH;
  command: BottyCommand = "default";
  /** Health <= 0 — lying down, inert, needs a first aid kit to get back up. */
  get isDown(): boolean {
    return this.health <= 0;
  }

  private currentTarget: EnemyInstance | null = null;
  private fireCooldown = 0;
  private roundsInMag = MAG_SIZE;
  private isReloading = false;
  private reloadTimer = 0;
  private repositionTimer = 0;
  private coverOffset = new Vector3(0, 0, 0);
  // Obstacle-stuck handling: if moveToward keeps failing to make real progress
  // (wedged against a wall/prop), sidestep first; if that doesn't help either
  // after a longer stretch, teleport to the nearest walkable ground nearby —
  // same escalation EnemyAI uses, sized down since BOTTY only ever moves in
  // short reposition hops rather than long chases.
  private stuckTimer = 0;
  private hardStuckTimer = 0;
  private escapeDir: Vector3 | null = null;
  private escapeTimer = 0;
  private wasFiredUpon = false;
  private smokeThrownForRetreat = false;
  // Target acquisition runs LOS raycasts across every live enemy — far too
  // expensive per-frame. Same fix as EnemyAI's throttled perception: refresh
  // on a short timer and read the cached target in between.
  private targetTimer = 0;

  onCommandChange?: (cmd: BottyCommand) => void;

  constructor(
    private readonly scene: Scene,
    spawnPosition: Vector3,
    private readonly enemyManager: EnemyManager,
    private readonly audio: AudioManager
  ) {
    this.root = MeshBuilder.CreateCapsule("botty_collider", { height: 1.7, radius: 0.3 }, scene);
    this.root.position = spawnPosition.clone();
    this.root.isVisible = false;
    this.root.isPickable = false;
    this.root.checkCollisions = true;
    this.root.ellipsoid = new Vector3(0.3, 0.85, 0.3);
    this.root.ellipsoidOffset = new Vector3(0, 0.85, 0);

    this.visualRoot = new TransformNode("botty_visual", scene);
    this.visualRoot.parent = this.root;

    // Friendly SAF-blue uniform so BOTTY reads as an ally at a glance against hostile orange.
    this.bodyMat = litMat(scene, "botty_bodyMat", new Color3(0.16, 0.32, 0.55), 0.32);
    const visorMat = litMat(scene, "botty_visorMat", new Color3(0.15, 0.75, 0.85), 0.5);

    const body = MeshBuilder.CreateBox("botty_body", { width: 0.56, height: 1.0, depth: 0.36 }, scene);
    body.position.y = 0.98;
    body.material = this.bodyMat;
    body.parent = this.visualRoot;
    body.metadata = { damageable: this.asDamageable(), hitZone: "body" } satisfies HitMeshMetadata;

    const head = MeshBuilder.CreateBox("botty_head", { width: 0.27, height: 0.3, depth: 0.27 }, scene);
    head.position.y = 1.67;
    head.material = this.bodyMat;
    head.parent = this.visualRoot;
    head.metadata = { damageable: this.asDamageable(), hitZone: "head", isHeadshotMesh: true } satisfies HitMeshMetadata;

    const visor = MeshBuilder.CreateBox("botty_visor", { width: 0.2, height: 0.08, depth: 0.03 }, scene);
    visor.position.set(0, 1.68, 0.14);
    visor.material = visorMat;
    visor.parent = this.visualRoot;
    visor.isPickable = false;

    const shoulders = MeshBuilder.CreateBox("botty_shoulders", { width: 0.66, height: 0.16, depth: 0.38 }, scene);
    shoulders.position.y = 1.42;
    shoulders.material = this.bodyMat;
    shoulders.parent = this.visualRoot;
    shoulders.isPickable = false;

    for (const x of [-0.36, 0.36]) {
      const arm = MeshBuilder.CreateBox(`botty_arm_${x}`, { width: 0.16, height: 0.66, depth: 0.2 }, scene);
      arm.position.set(x, 1.06, 0.02);
      arm.material = this.bodyMat;
      arm.parent = this.visualRoot;
      arm.isPickable = false;
    }
    for (const x of [-0.15, 0.15]) {
      const leg = MeshBuilder.CreateBox(`botty_leg_${x}`, { width: 0.18, height: 0.85, depth: 0.2 }, scene);
      leg.position.set(x, 0.42, 0);
      leg.material = litMat(scene, `botty_legMat_${x}`, new Color3(0.12, 0.14, 0.18), 0.2);
      leg.parent = this.visualRoot;
      leg.isPickable = false;
    }

    // Simple carried-rifle silhouette.
    const rifle = MeshBuilder.CreateBox("botty_rifle", { width: 0.06, height: 0.08, depth: 0.7 }, scene);
    rifle.position.set(0.24, 1.05, 0.3);
    rifle.material = litMat(scene, "botty_rifleMat", new Color3(0.08, 0.08, 0.09), 0.1);
    rifle.parent = this.visualRoot;
    rifle.isPickable = false;

    // Muzzle flash — a small emissive sprite at the barrel tip, flashed on each
    // shot so the player can clearly SEE BOTTY engaging (especially at night).
    const flashMat = new StandardMaterial("botty_flashMat", scene);
    flashMat.emissiveColor = new Color3(1, 0.82, 0.4);
    flashMat.diffuseColor = new Color3(1, 0.82, 0.4);
    flashMat.disableLighting = true;
    flashMat.alpha = 0.9;
    this.muzzleFlash = MeshBuilder.CreatePlane("botty_muzzle", { size: 0.32 }, scene);
    this.muzzleFlash.position.set(0.24, 1.05, 0.66);
    this.muzzleFlash.material = flashMat;
    this.muzzleFlash.parent = this.visualRoot;
    this.muzzleFlash.isPickable = false;
    this.muzzleFlash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.muzzleFlash.setEnabled(false);
  }

  private muzzleFlash!: Mesh;
  private muzzleFlashTimer = 0;

  private asDamageable() {
    // Wraps `this` so hit-mesh metadata can point back without a circular type issue.
    return {
      id: "botty",
      get isDead() {
        return false; // BOTTY goes "down", never removed — takeDamage handles the health drop.
      },
      takeDamage: (damage: number, _isHeadshot: boolean) => this.takeDamage(damage),
    };
  }

  get position(): Vector3 {
    return this.root.position;
  }

  takeDamage(damage: number): void {
    if (this.isDown) return;
    this.health = Math.max(0, this.health - damage);
    this.wasFiredUpon = true;
    if (this.isDown) {
      this.visualRoot.scaling = new Vector3(1, 0.2, 1);
    }
  }

  /** Consumes one first aid kit's worth of healing — called from main.ts when the player interacts with a downed/wounded BOTTY. */
  heal(amount: number): void {
    const wasDown = this.isDown;
    this.health = Math.min(this.maxHealth, this.health + amount);
    if (wasDown && this.health > 0) this.visualRoot.scaling = new Vector3(1, 1, 1);
  }

  setCommand(cmd: BottyCommand): void {
    this.command = cmd;
    this.smokeThrownForRetreat = false;
    this.currentTarget = null;
    this.targetTimer = 0;
    // A fresh order resets the "return fire" latch — Go Dark means hold fire
    // again until BOTTY (or the player) actually draws fire under the new order.
    this.wasFiredUpon = false;
    this.onCommandChange?.(cmd);
  }

  private canFire(): boolean {
    return this.command !== "goDark" || this.wasFiredUpon;
  }

  /**
   * Cached target refresh (~5Hz): a dead or vanished target drops instantly,
   * but the raycast-heavy re-acquisition scan only runs when the timer lapses.
   */
  private refreshTarget(dt: number, player: PlayerController, includeOutOfSight = false): void {
    if (this.currentTarget && (this.currentTarget.isDead || this.currentTarget.disposed)) {
      this.currentTarget = null;
      this.targetTimer = 0;
    }
    this.targetTimer -= dt;
    if (this.targetTimer > 0) return;
    this.targetTimer = 0.18 + Math.random() * 0.08;
    this.currentTarget = this.acquireTarget(player);
    if (!this.currentTarget && includeOutOfSight) this.currentTarget = this.nearestAnyDistance();
  }

  private acquireTarget(player: PlayerController): EnemyInstance | null {
    const alive = this.enemyManager.getAliveEnemies();
    if (alive.length === 0) return null;

    if (this.command === "coverMe") {
      // Whoever's actually engaging the player — the closest enemy with LOS to the player.
      let best: EnemyInstance | null = null;
      let bestDist = Infinity;
      for (const e of alive) {
        if (!this.hasLineOfSight(e.root.position, player.position)) continue;
        const d = Vector3.Distance(e.root.position, player.position);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
      return best ?? this.nearestWithLos(alive);
    }
    return this.nearestWithLos(alive);
  }

  private nearestWithLos(alive: EnemyInstance[]): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let bestDist = Infinity;
    for (const e of alive) {
      const d = Vector3.Distance(e.root.position, this.position);
      if (d > 55) continue;
      if (!this.hasLineOfSight(this.eyePosition(), e.root.position.add(new Vector3(0, 1.0, 0)))) continue;
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private eyePosition(): Vector3 {
    return this.position.add(new Vector3(0, 1.55, 0));
  }

  /**
   * Deterministic ground clamp: cast straight down from just above BOTTY's
   * head and set `root.position.y` to whatever solid, collidable ground is
   * actually beneath it. Skips a frame gracefully (holds current height) if
   * nothing is hit, e.g. mid-air over a gap for a single frame.
   */
  private snapToGround(): void {
    const from = this.position.add(new Vector3(0, 3, 0));
    const ray = new Ray(from, new Vector3(0, -1, 0), 12);
    const pick = this.scene.pickWithRay(ray, (m) => m.isPickable && m.checkCollisions && m !== this.root);
    if (pick?.hit && pick.pickedPoint) {
      this.root.position.y = pick.pickedPoint.y;
    }
  }

  private hasLineOfSight(from: Vector3, to: Vector3): boolean {
    const dir = to.subtract(from);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    const ray = new Ray(from, dir, dist - 0.3);
    // Exclude BOTTY's OWN meshes: the eye ray originates inside BOTTY's head/body
    // (both are pickable so the player can shoot BOTTY), so without this the ray
    // instantly "hits" itself, LOS always reads blocked, and BOTTY never fires.
    const pick = this.scene.pickWithRay(ray, (m) => m.isPickable && m !== this.root && !m.name.startsWith("botty_"));
    return !pick?.hit;
  }

  private fireAt(target: EnemyInstance, dt: number): void {
    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        this.roundsInMag = MAG_SIZE;
      }
      return;
    }
    if (this.roundsInMag <= 0) {
      this.isReloading = true;
      this.reloadTimer = RELOAD_SEC;
      return;
    }
    this.fireCooldown -= dt;
    if (this.fireCooldown > 0) return;
    this.fireCooldown = FIRE_INTERVAL;
    this.roundsInMag--;

    const aimPoint = target.root.position.add(new Vector3(0, 0.9 + (Math.random() - 0.5) * 0.4, 0));
    if (!this.hasLineOfSight(this.eyePosition(), aimPoint)) return;
    this.audio.gunshot(true);
    this.muzzleFlash.setEnabled(true);
    this.muzzleFlashTimer = 0.05;
    // Face BOTTY toward whatever it's shooting so the flash/rifle read correctly.
    this.root.rotation.y = Math.atan2(target.root.position.x - this.position.x, target.root.position.z - this.position.z);
    // A slight miss chance keeps BOTTY competent rather than a laser-perfect turret.
    if (Math.random() < 0.78) {
      target.takeDamage(DAMAGE_PER_HIT, false, this.position);
    }
  }

  /** Picks a candidate point near `origin` that breaks LOS to `threat` while staying close enough to matter — an approximation of "duck behind cover" without a full navmesh. */
  private findCoverOffset(threat: Vector3 | null): Vector3 {
    if (!threat) return Vector3.Zero();
    let best = Vector3.Zero();
    let bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const candidate = this.position.add(new Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4));
      const blocked = !this.hasLineOfSight(candidate.add(new Vector3(0, 1.2, 0)), threat);
      const score = (blocked ? 10 : 0) - Vector3.Distance(candidate, this.position) * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = new Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4);
      }
    }
    return best;
  }

  private moveToward(target: Vector3, dt: number, speedMult = 1): void {
    const to = target.subtract(this.position);
    to.y = 0;
    const dist = to.length();
    if (dist < 0.3) return;
    to.normalize();

    // If a recent stuck episode is still being worked off, sidestep instead of
    // shoving straight into whatever's blocking the path.
    let dir = to;
    if (this.escapeTimer > 0) {
      this.escapeTimer -= dt;
      if (this.escapeDir) dir = this.escapeDir;
    }

    const before = this.position.clone();
    this.root.moveWithCollisions(dir.scale(MOVE_SPEED * speedMult * dt));
    this.root.rotation.y = Math.atan2(to.x, to.z);

    const moved = Vector3.Distance(this.position, before);
    const barelyMoved = moved < MOVE_SPEED * speedMult * dt * 0.35;
    if (this.escapeTimer <= 0) {
      if (barelyMoved) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 0.45) {
          const side = Math.random() < 0.5 ? 1 : -1;
          this.escapeDir = new Vector3(-to.z * side, 0, to.x * side).normalize();
          this.escapeTimer = 0.7;
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 1.5);
      }
    }
    // Sidestepping alone hasn't restored real progress for a good while —
    // BOTTY is genuinely wedged. Teleport to the nearest walkable ground.
    if (barelyMoved) {
      this.hardStuckTimer += dt;
      if (this.hardStuckTimer > 4) {
        const safe = findNearestNavigable(this.scene, this.position, 14);
        this.root.position.x = safe.x;
        this.root.position.z = safe.z;
        this.hardStuckTimer = 0;
        this.stuckTimer = 0;
        this.escapeTimer = 0;
        this.escapeDir = null;
      }
    } else {
      this.hardStuckTimer = Math.max(0, this.hardStuckTimer - dt * 2);
    }
  }

  private throwRetreatSmoke(threat: Vector3 | null, player: PlayerController): void {
    const between = threat ? Vector3.Lerp(this.position, threat, 0.4) : this.position.add(new Vector3(0, 0, 2));
    const puff = MeshBuilder.CreateSphere("botty_smoke", { diameter: 6 }, this.scene);
    puff.position = between;
    puff.position.y = 1.2;
    const mat = new StandardMaterial("botty_smokeMat", this.scene);
    mat.diffuseColor = new Color3(0.1, 0.35, 0.9);
    mat.emissiveColor = new Color3(0.03, 0.12, 0.35);
    mat.alpha = 0.55;
    puff.material = mat;
    // Obscures vision but not bullets — same contract as thrown smoke.
    puff.isPickable = true;
    puff.checkCollisions = false;
    puff.metadata = { isSmoke: true };
    window.setTimeout(() => puff.dispose(), 9000);
    this.audio.throwableFuse();
    void player; // reserved: could nudge the smoke toward the player's sightline in a future pass
  }

  update(dt: number, player: PlayerController): void {
    if (this.isDown) return;

    // Decay the muzzle flash from the previous shot.
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) this.muzzleFlash.setEnabled(false);
    }

    // Gravity: moveToward only ever moves on the XZ plane (holds Y constant),
    // so over sunken/uneven ground BOTTY would hover mid-air with nothing
    // pulling it down. A per-frame downward moveWithCollisions() nudge (the
    // fix used for EnemyAI) turned out to still creep upward here — repeated
    // collision-resolution "pop out of the ground" responses outpaced the
    // weak gravity pull over time. A direct downward raycast onto whatever's
    // actually below is deterministic and can't drift the same way.
    this.snapToGround();

    switch (this.command) {
      case "retreat": {
        const threat = this.currentTarget?.root.position ?? null;
        if (!this.smokeThrownForRetreat) {
          this.throwRetreatSmoke(threat, player);
          this.smokeThrownForRetreat = true;
        }
        if (isInSafeZone(this.position)) {
          // Home and safe — hold position, no more running.
        } else {
          this.moveToward(CAMP_POSITION, dt, 1.15);
        }
        break;
      }

      case "goDark": {
        if (this.canFire()) {
          this.refreshTarget(dt, player);
          if (this.currentTarget) this.fireAt(this.currentTarget, dt);
        } else {
          this.currentTarget = null;
        }
        this.repositionTowardPlayer(dt, 3, 6, true, player);
        break;
      }

      case "followMe": {
        this.refreshTarget(dt, player);
        if (this.currentTarget) this.fireAt(this.currentTarget, dt);
        this.repositionTowardPlayer(dt, 3, 5, false, player);
        break;
      }

      case "coverMe": {
        this.refreshTarget(dt, player);
        if (this.currentTarget) {
          this.repositionTimer -= dt;
          if (this.repositionTimer <= 0) {
            this.repositionTimer = 2 + Math.random();
            this.coverOffset = this.findCoverOffset(this.currentTarget.root.position);
          }
          this.moveToward(this.position.add(this.coverOffset), dt);
          this.fireAt(this.currentTarget, dt);
        } else {
          this.repositionTowardPlayer(dt, 4, 8, false, player);
        }
        break;
      }

      case "engage": {
        this.refreshTarget(dt, player, true);
        if (this.currentTarget) {
          const toTarget = Vector3.Distance(this.position, this.currentTarget.root.position);
          this.repositionTimer -= dt;
          if (this.repositionTimer <= 0) {
            this.repositionTimer = 1.5 + Math.random();
            // Push forward, biased to one flank, while still favouring cover.
            const flank = this.findCoverOffset(this.currentTarget.root.position);
            this.coverOffset = flank.length() > 0.5 ? flank : new Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
          }
          if (toTarget > 12) {
            this.moveToward(Vector3.Lerp(this.position, this.currentTarget.root.position, 0.3), dt, 1.1);
          } else {
            this.moveToward(this.position.add(this.coverOffset), dt);
          }
          this.fireAt(this.currentTarget, dt);
        } else {
          this.repositionTowardPlayer(dt, 5, 15, false, player);
        }
        break;
      }

      default: {
        this.refreshTarget(dt, player);
        if (this.currentTarget) this.fireAt(this.currentTarget, dt);
        this.repositionTowardPlayer(dt, 5, 15, false, player);
        break;
      }
    }
  }

  private nearestAnyDistance(): EnemyInstance | null {
    const alive = this.enemyManager.getAliveEnemies();
    let best: EnemyInstance | null = null;
    let bestDist = Infinity;
    for (const e of alive) {
      const d = Vector3.Distance(e.root.position, this.position);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  /** Stays within [minM, maxM] of the player, biased to a side so it never blocks the player's forward path; ducks toward cover if under fire and `seekCover`. */
  private repositionTowardPlayer(dt: number, minM: number, maxM: number, seekCover: boolean, player: PlayerController): void {
    const flat = new Vector3(player.position.x - this.position.x, 0, player.position.z - this.position.z);
    const dist = flat.length();

    if (seekCover && this.wasFiredUpon) {
      this.repositionTimer -= dt;
      if (this.repositionTimer <= 0 || this.coverOffset.lengthSquared() < 0.01) {
        this.repositionTimer = 2.5 + Math.random();
        this.coverOffset = this.findCoverOffset(this.currentTarget?.root.position ?? player.position);
      }
      this.moveToward(this.position.add(this.coverOffset), dt);
      return;
    }

    // Refresh the follow anchor periodically so BOTTY keeps repositioning rather
    // than freezing the moment it lands inside the [min, max] band.
    this.repositionTimer -= dt;
    if (this.repositionTimer <= 0) {
      this.repositionTimer = 1.5 + Math.random() * 1.5;
      this.coverOffset = this.sideOffsetFromPlayer(player);
    }

    if (dist > maxM) {
      // Too far — close the gap, heading for a point beside the player rather than
      // directly behind, so BOTTY doesn't end up walking in the player's footsteps.
      this.moveToward(player.position.add(this.coverOffset), dt, 1.15);
    } else if (dist < minM) {
      // Too close — back off toward the side anchor instead of standing still on top of the player.
      this.moveToward(this.position.add(this.coverOffset), dt);
    } else {
      // In-band: drift toward the side anchor so BOTTY keeps moving instead of planting itself.
      this.moveToward(player.position.add(this.coverOffset), dt, 0.6);
    }
  }

  /** A point a few metres to the player's left or right (their frame, not world axes) — keeps BOTTY out of the player's direct line of movement. */
  private sideOffsetFromPlayer(player: PlayerController): Vector3 {
    const fwd = player.camera.getDirection(Vector3.Forward());
    fwd.y = 0;
    if (fwd.lengthSquared() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const right = new Vector3(fwd.z, 0, -fwd.x);
    const side = Math.random() < 0.5 ? -1 : 1;
    const lateral = 3.5 + Math.random() * 2.5;
    const back = 1 + Math.random() * 2;
    return right.scale(side * lateral).subtract(fwd.scale(back));
  }
}
