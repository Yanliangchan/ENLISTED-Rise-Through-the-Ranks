import { UniversalCamera, Scene, Vector3, MeshBuilder, Mesh } from "@babylonjs/core";
import type { InputManager } from "@/core/InputManager";
import type { AudioManager } from "@/core/AudioManager";

const FOOTSTEP_INTERVAL_WALK = 0.46; // seconds between footstep sounds at walk speed
const FOOTSTEP_INTERVAL_SPRINT = 0.32;

const WALK_SPEED = 4.5; // m/s
const SPRINT_MULT = 1.6;
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
  private currentEyeHeight = STAND_EYE_HEIGHT;
  health = 100;
  maxHealth = 100;
  armour = 0;
  maxArmour = 0;
  armourDamageReduction = 0;
  /** Current weapon's moveSpeedMult (heavier weapons slow the player). */
  weaponSpeedMult = 1;
  /** User sensitivity multiplier from settings (1 = default). */
  sensitivityMult = 1;
  /** Set by WeaponController while aiming — scopes/zoom feel less twitchy at higher magnification. */
  aimSensitivityMult = 1;
  private footstepTimer = 0;

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
    this.applyMouseLook();
    this.applyMovement(deltaSeconds);
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
    this.isCrouching = this.input.isDown("ControlLeft") || this.input.isDown("ControlRight");
    const sprinting = this.input.isDown("ShiftLeft") && moveZ > 0 && !this.isCrouching;

    let speed = WALK_SPEED * this.weaponSpeedMult;
    if (sprinting) speed *= SPRINT_MULT;
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

  /** Armour absorbs damage at `armourDamageReduction` fraction until it breaks. */
  takeDamage(rawDamage: number): number {
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
    this.verticalVelocity = 0;
    this.collider.position = position.clone();
  }
}
