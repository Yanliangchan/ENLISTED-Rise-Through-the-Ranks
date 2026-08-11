import { UniversalCamera, Scene, Vector3, MeshBuilder, Mesh, Ray } from "@babylonjs/core";
import type { InputManager } from "@/core/InputManager";
import type { AudioManager } from "@/core/AudioManager";

const FOOTSTEP_INTERVAL_WALK = 0.46; // seconds between footstep sounds at walk speed
const FOOTSTEP_INTERVAL_SPRINT = 0.32;

const WALK_SPEED = 4.5; // m/s
const SPRINT_MULT = 1.8;
const CROUCH_MULT = 0.5;
const JUMP_SPEED = 4.2; // gives ~0.9m of jump height at real gravity below
const GRAVITY = -9.81; // real-world m/s^2
const MOUSE_SENSITIVITY = 0.0022;

const STAND_EYE_HEIGHT = 1.7;
const CROUCH_EYE_HEIGHT = 1.0;
const CROUCH_LERP_SPEED = 10;

/**
 * FPS player: mouse-look camera + WASD/sprint/crouch/jump movement with
 * gravity and collision. Babylon cameras don't expose moveWithCollisions
 * directly, so an invisible capsule mesh owns collision/movement and the
 * camera rides on it as a child (yaw on the collider, pitch on the camera).
 */
export class PlayerController {
  readonly camera: UniversalCamera;
  private readonly collider: Mesh;

  private verticalVelocity = 0;
  private isGrounded = false;
  private isCrouching = false;
  private _isMoving = false;
  private _isSprinting = false;
  /** Seconds of elevated visibility left after firing (muzzle flash/report gives the player away). */
  private noiseTimer = 0;
  private currentEyeHeight = STAND_EYE_HEIGHT;
  health = 100;
  maxHealth = 100;
  armour = 0;
  maxArmour = 0;
  armourDamageReduction = 0;
  /** Current weapon's moveSpeedMult (heavier weapons slow the player). */
  weaponSpeedMult = 1;
  gearMoveSpeedMult = 1;
  sprintAccelerationMult = 1;
  staminaMax = 5;
  stamina = 5;
  staminaRegenMult = 1;
  staminaDrainMult = 1;
  private sprintRamp = 0;
  /** User sensitivity multiplier from settings (1 = default). */
  sensitivityMult = 1;
  /** Set by WeaponController while aiming — scopes/zoom feel less twitchy at higher magnification. */
  aimSensitivityMult = 1;
  /** User's ADS/scope-sensitivity setting (1 = same as hip). Applied only while aiming. */
  adsSensitivitySetting = 1;
  /** Written every frame by SafeZoneManager — true while standing inside the camp's protected radius. */
  inSafeZone = false;
  /** Written by SafeZoneManager on leaving the safe zone; grants brief incoming-damage immunity. Cancelled by firing/throwing. */
  spawnProtected = false;
  /** Set by WeaponController while a laser aiming device is fitted — the visible beam makes the player easier for AI to spot. */
  laserOn = false;
  /** When true (e.g. dead in multiplayer, awaiting respawn) movement is locked;
   *  the player can still look around but cannot walk. */
  frozen = false;
  private footstepTimer = 0;
  // Camera shake: a decaying magnitude driving small random pitch/yaw jitter,
  // applied as an additive offset each frame. The offset is tracked and
  // subtracted before the next one is added so it never permanently drifts
  // the player's aim — only the momentary shake is visible.
  private shakeMagnitude = 0;
  private shakeTime = 0;
  private lastShakeYaw = 0;
  private lastShakePitch = 0;

  constructor(
    private readonly scene: Scene,
    private readonly input: InputManager,
    spawnPosition: Vector3,
    private readonly audio?: AudioManager
  ) {
    this.collider = MeshBuilder.CreateCapsule(
      "playerCollider",
      { height: STAND_EYE_HEIGHT, radius: 0.4 },
      scene
    );
    this.collider.position = spawnPosition.clone();
    this.collider.isVisible = false;
    // Own hitscan rays originate at the camera, which sits inside/near this
    // capsule's own dome — pickable left true, a downward-angled shot could
    // self-intersect its own collider before ever reaching a real target.
    this.collider.isPickable = false;
    this.collider.checkCollisions = true;
    this.collider.ellipsoid = new Vector3(0.4, STAND_EYE_HEIGHT / 2, 0.4);
    this.collider.ellipsoidOffset = new Vector3(0, STAND_EYE_HEIGHT / 2, 0);

    this.camera = new UniversalCamera("playerCamera", Vector3.Zero(), scene);
    this.camera.minZ = 0.05;
    this.camera.fov = 1.1; // ~63 deg, tune later for weapon FOV settings
    this.camera.inputs.clear(); // we drive rotation/movement ourselves
    this.camera.parent = this.collider;
    this.camera.position.y = this.currentEyeHeight - STAND_EYE_HEIGHT / 2;

    scene.activeCamera = this.camera;
  }

  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    if (this.noiseTimer > 0) this.noiseTimer = Math.max(0, this.noiseTimer - deltaSeconds);
    this.applyMouseLook();
    if (!this.frozen) this.applyMovement(deltaSeconds);
    this.applyCameraShake(deltaSeconds);
  }

  /**
   * Kick the camera-shake decay curve — call proportional to incoming damage
   * so a graze barely nudges the view and a heavy hit visibly rattles it.
   * Stays visible even while scoped (it's a real camera rotation, not a DOM
   * overlay the scope vignette could paint over).
   */
  shakeCamera(damage: number): void {
    const kick = Math.min(0.045, 0.006 + damage * 0.0009);
    this.shakeMagnitude = Math.min(0.06, this.shakeMagnitude + kick);
  }

  private applyCameraShake(dt: number): void {
    // Undo last frame's shake offset before computing a new one, so the
    // underlying aim (mouse look + recoil) never permanently drifts.
    this.collider.rotation.y -= this.lastShakeYaw;
    this.camera.rotation.x -= this.lastShakePitch;

    if (this.shakeMagnitude > 0.0002) {
      this.shakeTime += dt * 26; // jitter frequency
      this.lastShakeYaw = Math.sin(this.shakeTime * 1.7) * this.shakeMagnitude;
      this.lastShakePitch = Math.cos(this.shakeTime * 2.1) * this.shakeMagnitude * 0.6;
      this.collider.rotation.y += this.lastShakeYaw;
      this.camera.rotation.x += this.lastShakePitch;
      this.shakeMagnitude *= Math.max(0, 1 - dt * 7); // fast decay
    } else {
      this.shakeMagnitude = 0;
      this.lastShakeYaw = 0;
      this.lastShakePitch = 0;
    }
  }

  /** Nudge horizontal look angle — used by weapon recoil. */
  addYaw(delta: number): void {
    this.collider.rotation.y += delta;
  }

  get isMoving(): boolean {
    return this._isMoving;
  }

  get crouching(): boolean {
    return this.isCrouching;
  }

  /** True while sprinting (loud, wide-open movement — much easier for AI to spot). */
  get sprinting(): boolean {
    return this._isSprinting;
  }

  /** True for a short window after the last shot — firing lights the player up for AI detection. */
  get firedRecently(): boolean {
    return this.noiseTimer > 0;
  }

  /** Called by the weapon system on every shot to spike the player's visibility for a moment. */
  markFired(seconds = 2.5): void {
    this.noiseTimer = Math.max(this.noiseTimer, seconds);
  }

  get grounded(): boolean {
    return this.isGrounded;
  }

  get position(): Vector3 {
    return this.collider.position;
  }

  get yaw(): number {
    return this.collider.rotation.y;
  }

  private applyMouseLook(): void {
    if (!this.input.isPointerLocked) return;
    const sens = MOUSE_SENSITIVITY * this.sensitivityMult * this.aimSensitivityMult;
    this.collider.rotation.y += this.input.mouseDeltaX * sens;
    this.camera.rotation.x += this.input.mouseDeltaY * sens;
    const maxPitch = Math.PI / 2 - 0.01;
    this.camera.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.camera.rotation.x));
  }

  private applyMovement(dt: number): void {
    const yaw = this.collider.rotation.y;
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    let moveX = 0;
    let moveZ = 0;
    if (this.input.isDown("KeyW")) moveZ += 1;
    if (this.input.isDown("KeyS")) moveZ -= 1;
    if (this.input.isDown("KeyD")) moveX += 1;
    if (this.input.isDown("KeyA")) moveX -= 1;

    const moving = moveX !== 0 || moveZ !== 0;
    this._isMoving = moving;
    // Crouch is held on C (was Ctrl). Ctrl is kept as a secondary so existing
    // muscle memory still works, but C is the documented bind.
    this.isCrouching =
      this.input.isDown("KeyC") || this.input.isDown("ControlLeft") || this.input.isDown("ControlRight");
    const wantsSprint = this.input.isDown("ShiftLeft") && moveZ > 0 && !this.isCrouching && this.stamina > 0.05;
    if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - dt * this.staminaDrainMult);
      this.sprintRamp += (1 - this.sprintRamp) * Math.min(1, 5 * this.sprintAccelerationMult * dt);
    } else {
      this.stamina = Math.min(this.staminaMax, this.stamina + dt * 0.75 * this.staminaRegenMult);
      this.sprintRamp += (0 - this.sprintRamp) * Math.min(1, 7 * dt);
    }
    const sprinting = wantsSprint && this.sprintRamp > 0.1;
    this._isSprinting = sprinting;

    let speed = WALK_SPEED * this.weaponSpeedMult * this.gearMoveSpeedMult;
    if (sprinting) speed *= 1 + (SPRINT_MULT - 1) * this.sprintRamp;
    if (this.isCrouching) speed *= CROUCH_MULT;

    let moveVector = Vector3.Zero();
    if (moving) {
      const dir = forward.scale(moveZ).add(right.scale(moveX)).normalize();
      moveVector = dir.scale(speed * dt);
    }

    if (moving && this.isGrounded) {
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.audio?.footstep();
        this.footstepTimer = sprinting ? FOOTSTEP_INTERVAL_SPRINT : FOOTSTEP_INTERVAL_WALK;
      }
    } else {
      this.footstepTimer = 0;
    }

    // Gravity + jump
    if (this.isGrounded && this.input.wasPressed("Space")) {
      this.verticalVelocity = JUMP_SPEED;
      this.isGrounded = false;
    }
    this.verticalVelocity += GRAVITY * dt;
    moveVector.y = this.verticalVelocity * dt;

    const beforeY = this.collider.position.y;
    this.collider.moveWithCollisions(moveVector);

    // Grounded check: only true when the collision engine actually cut the fall
    // short (actualDy measurably closer to zero than the requested moveVector.y).
    // In free fall the two are equal, so the threshold must require a real gap —
    // getting this backwards previously made every falling frame register as
    // "landed" (zeroing velocity each tick, and re-arming the jump mid-air).
    const actualDy = this.collider.position.y - beforeY;
    if (this.verticalVelocity <= 0 && actualDy > moveVector.y + 0.001) {
      this.isGrounded = true;
      this.verticalVelocity = 0;
    } else if (this.verticalVelocity > 0) {
      this.isGrounded = false;
    } else {
      this.isGrounded = false;
    }

    // Smoothly blend eye height for crouch (camera-local offset + collider ellipsoid).
    const targetHeight = this.isCrouching ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
    this.currentEyeHeight +=
      (targetHeight - this.currentEyeHeight) * Math.min(1, CROUCH_LERP_SPEED * dt);
    this.camera.position.y = this.currentEyeHeight - STAND_EYE_HEIGHT / 2;
    this.collider.ellipsoid.y = this.currentEyeHeight / 2;
    this.collider.ellipsoidOffset.y = this.currentEyeHeight / 2;
  }

  /** Cancels the post-spawn-protection grace period the instant the player fires or throws — prevents abusing it as a free-hit window. */
  breakSpawnProtection(): void {
    this.spawnProtected = false;
  }

  /** Armour absorbs damage at `armourDamageReduction` fraction until it breaks. Fully immune inside the safe zone or during the brief spawn-protection grace period. */
  takeDamage(rawDamage: number): number {
    if (this.inSafeZone || this.spawnProtected) return 0;
    let remaining = rawDamage;
    if (this.armour > 0) {
      const absorbed = Math.min(this.armour, rawDamage * this.armourDamageReduction);
      this.armour -= absorbed;
      remaining -= absorbed;
    }
    this.health = Math.max(0, this.health - remaining);
    return remaining;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  respawn(position: Vector3): void {
    this.health = this.maxHealth;
    this.armour = this.maxArmour;
    this.stamina = this.staminaMax;
    this.teleportTo(position);
  }

  /**
   * Repositions the player without touching health/armour — used to reset to
   * the base at the start of each wave.
   *
   * The placement is resolved against the actual world rather than trusted
   * blind: a downward ray finds the solid ground under the target point and
   * seats the capsule's feet on it. A spawn point authored slightly below the
   * terrain (or a stale position carried over from another mode) would
   * otherwise start the capsule intersecting the floor, and the very first
   * `moveWithCollisions` resolves that by dropping the player straight through
   * it. Falls back to the requested position when nothing is underfoot.
   */
  teleportTo(position: Vector3): void {
    this.verticalVelocity = 0;
    this.isGrounded = false;
    this.collider.position = position.clone();

    const from = position.add(new Vector3(0, 6, 0));
    const pick = this.scene.pickWithRay(
      new Ray(from, new Vector3(0, -1, 0), 40),
      (m) => m.isPickable && m.checkCollisions && m !== this.collider
    );
    if (pick?.hit && pick.pickedPoint) {
      // Seat the feet a hair above the surface so the first collision sweep
      // resolves upward-clear instead of starting embedded.
      this.collider.position.y = pick.pickedPoint.y + 0.05;
    }
  }

  /**
   * Full spawn reset for a fresh deployment: position (ground-resolved),
   * health/armour/stamina, stance, look angles, and every transient combat
   * effect. Anything a previous run could leave behind — a crouch, a decaying
   * camera shake, a frozen-movement flag, a pitched-down camera — is cleared
   * here so a later-wave start begins in exactly the same state as Wave 1.
   */
  spawnForDeployment(position: Vector3, yaw = 0): void {
    this.respawn(position);
    this.frozen = false;
    this.isCrouching = false;
    this.currentEyeHeight = STAND_EYE_HEIGHT;
    this.camera.position.y = this.currentEyeHeight - STAND_EYE_HEIGHT / 2;
    this.collider.ellipsoid.y = this.currentEyeHeight / 2;
    this.collider.ellipsoidOffset.y = this.currentEyeHeight / 2;
    this.collider.rotation.y = yaw;
    this.camera.rotation.x = 0;
    this.shakeMagnitude = 0;
    this.shakeTime = 0;
    this.lastShakeYaw = 0;
    this.lastShakePitch = 0;
    this.noiseTimer = 0;
    this.sprintRamp = 0;
    this.footstepTimer = 0;
    this._isMoving = false;
    this._isSprinting = false;
    this.laserOn = false;
  }
}
