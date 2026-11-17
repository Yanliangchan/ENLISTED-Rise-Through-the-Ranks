import * as THREE from "three";
import type { Input } from "~/core/input";
import type { CollisionWorld } from "~/world/collision";
import { Surf } from "~/gfx/builder";

const RADIUS = 0.32;
const STAND = 1.78;
const CROUCH = 1.15;
const EYE_STAND = 1.64;
const EYE_CROUCH = 1.02;
const PRONE = 0.68;
const EYE_PRONE = 0.36;
const GRAVITY = 15;

export type Stance = "stand" | "crouch" | "prone";

/**
 * First-person body: a capsule moved against the collision BVH, with
 * momentum, sprint, crouch, jump and lean. It owns where the eye is; the
 * camera, weapon sway and footsteps all read from here.
 */
export class PlayerController {
  /** Feet position. */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  stance: Stance = "stand";
  sprinting = false;
  /** Smoothed eye height above the feet. */
  eye = EYE_STAND;
  /** -1 (left) .. 1 (right), smoothed. */
  lean = 0;
  /** Horizontal speed, m/s. */
  speed = 0;
  /** Distance walked on the ground: drives footsteps and weapon bob. */
  stride = 0;
  surface: Surf = Surf.Concrete;
  /** Movement multiplier from the weapon system (ADS, heavy weapon). */
  moveScale = 1;
  sensitivity = 1;
  /** Set true by the weapon while aiming to block sprint. */
  aiming = false;
  landed = 0;
  onFootstep?: (surf: Surf, sprint: boolean) => void;
  onLand?: (impact: number) => void;
  private height = STAND;
  private stepAcc = 0;
  private airTime = 0;
  /** Seconds since the feet last touched: smooths sprint and control over kerbs, steps and rubble. */
  private offGround = 0;
  /** Set by the weapon when the trigger is pressed mid-sprint: drops out of the sprint so the shot can go. */
  sprintLock = 0;

  constructor(private readonly world: CollisionWorld, private readonly input: Input) {}

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.stance = "stand";
    this.height = STAND;
    this.eye = EYE_STAND;
    this.sprintLock = 0;
    this.lean = 0;
  }

  /** Mouse look. `scale` lets ADS / scopes slow the turn rate. */
  look(scale: number): void {
    const k = 0.0021 * this.sensitivity * scale;
    this.yaw -= this.input.mouseDX * k;
    this.pitch -= this.input.mouseDY * k;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  update(dt: number): void {
    const inp = this.input;
    // Stance.
    // C / Ctrl: crouch toggle. Z: go prone or get up. Space climbs one stance at a time.
    if (inp.hit("KeyC") || inp.hit("ControlLeft")) {
      if (this.stance === "stand") this.stance = "crouch";
      else if (this.stance === "prone") {
        if (this.fits(CROUCH)) this.stance = "crouch";
      } else if (this.fits(STAND)) this.stance = "stand";
    }
    if (inp.hit("KeyZ")) {
      if (this.stance !== "prone") this.stance = "prone";
      else if (this.fits(STAND)) this.stance = "stand";
      else if (this.fits(CROUCH)) this.stance = "crouch";
    }
    const targetH = this.stance === "prone" ? PRONE : this.stance === "crouch" ? CROUCH : STAND;
    this.height += (targetH - this.height) * Math.min(1, dt * (this.stance === "prone" ? 7 : 12));
    const targetEye = this.stance === "prone" ? EYE_PRONE : this.stance === "crouch" ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * (this.stance === "prone" ? 6 : 10));

    // Wish direction in the horizontal plane.
    let fx = 0;
    let fz = 0;
    if (inp.held("KeyW")) fz -= 1;
    if (inp.held("KeyS")) fz += 1;
    if (inp.held("KeyA")) fx -= 1;
    if (inp.held("KeyD")) fx += 1;
    const moving = fx !== 0 || fz !== 0;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    // Sprint: hold Shift while moving forward. It gets you up from a crouch or the ground, survives
    // brief loss of footing, and yields at once to aiming or the trigger.
    this.sprintLock = Math.max(0, this.sprintLock - dt);
    const wantSprint = (inp.held("ShiftLeft") || inp.held("ShiftRight")) && fz < 0 && !this.aiming && this.sprintLock <= 0;
    if (wantSprint && this.stance !== "stand" && this.fits(STAND)) this.stance = "stand";
    const footing = this.onGround || this.offGround < 0.18;
    this.sprinting = wantSprint && this.stance === "stand" && footing;
    let max = this.stance === "prone" ? 1.05 : this.stance === "crouch" ? 2.1 : this.sprinting ? 6.4 : 4.1;
    if (this.stance === "stand" && !this.sprinting && fx !== 0 && fz === 0) max *= 0.92;
    max *= this.moveScale;
    if (fz > 0) max *= 0.8;

    const accel = footing ? 46 : 9;
    const friction = footing ? (moving ? 7 : 11) : 0.2;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > 0) {
      const drop = Math.max(0, hv - hv * friction * dt - (this.onGround ? 0.6 * dt : 0)) / hv;
      this.vel.x *= drop;
      this.vel.z *= drop;
    }
    if (moving) {
      const cur = this.vel.x * wx + this.vel.z * wz;
      const add = Math.max(0, Math.min(accel * dt, max - cur));
      this.vel.x += wx * add;
      this.vel.z += wz * add;
    }

    if (footing && inp.hit("Space") && this.stance === "stand" && this.vel.y <= 0.5) {
      this.vel.y = 5.2;
      this.onGround = false;
      this.offGround = 1;
    } else if (inp.hit("Space") && this.stance === "crouch" && this.fits(STAND)) {
      this.stance = "stand";
    } else if (inp.hit("Space") && this.stance === "prone" && this.fits(CROUCH)) {
      this.stance = "crouch";
    }
    this.vel.y -= GRAVITY * dt;
    if (this.onGround && this.vel.y < 0) this.vel.y = Math.max(this.vel.y, -2);

    // Integrate in sub-steps so fast movement cannot tunnel thin walls.
    const steps = 4;
    const h = dt / steps;
    let grounded = false;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, h);
      a.set(this.pos.x, this.pos.y + RADIUS, this.pos.z);
      b.set(this.pos.x, this.pos.y + this.height - RADIUS, this.pos.z);
      const before = a.clone();
      this.world.resolveCapsule(a, b, RADIUS);
      const dx = a.x - before.x;
      const dy = a.y - before.y;
      const dz = a.z - before.z;
      this.pos.set(a.x, a.y - RADIUS, a.z);
      const push = Math.hypot(dx, dy, dz);
      if (push > 1e-5) {
        // Standing on something if the correction is mostly upward.
        if (dy > Math.abs(h * this.vel.y * 0.25) && dy / push > 0.5) grounded = true;
        // Remove the velocity component going into the surface.
        const nx = dx / push;
        const ny = dy / push;
        const nz = dz / push;
        const vn = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
        if (vn < 0) {
          if (grounded && ny > 0.5) this.vel.y = Math.max(this.vel.y, 0);
          else {
            this.vel.x -= nx * vn;
            this.vel.y -= ny * vn;
            this.vel.z -= nz * vn;
          }
        }
      }
    }
    if (grounded && !this.onGround) {
      const impact = Math.min(1, this.airTime * 1.6);
      if (this.airTime > 0.25) {
        this.landed = impact;
        this.onLand?.(impact);
      }
    }
    this.airTime = grounded ? 0 : this.airTime + dt;
    this.offGround = grounded ? 0 : this.offGround + dt;
    this.onGround = grounded;
    if (this.pos.y < -30) this.pos.y = 5;

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.landed = Math.max(0, this.landed - dt * 3);

    // Lean.
    const leanTarget = (inp.held("KeyE") ? 1 : 0) - (inp.held("KeyQ") ? 1 : 0);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 9);

    // Footsteps.
    if (this.onGround && this.speed > 0.8) {
      this.stride += this.speed * dt;
      this.stepAcc += this.speed * dt;
      const stepLen = this.sprinting ? 2.1 : this.stance === "prone" ? 0.75 : this.stance === "crouch" ? 1.1 : 1.55;
      if (this.stepAcc > stepLen) {
        this.stepAcc = 0;
        const f = this.world.floor(this.pos.x, this.pos.z, this.pos.y + 0.5, 1.5);
        if (f) this.surface = f.surf;
        this.onFootstep?.(this.surface, this.sprinting);
      }
    }
  }

  /** Is there headroom to rise to a body of this height? */
  private fits(height: number): boolean {
    return !this.world.sphereBlocked(new THREE.Vector3(this.pos.x, this.pos.y + height - RADIUS, this.pos.z), RADIUS * 0.9);
  }

  /** World-space eye position including lean. */
  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    const side = this.lean * 0.42;
    return out.set(this.pos.x + Math.cos(this.yaw) * side, this.pos.y + this.eye - Math.abs(this.lean) * 0.06, this.pos.z - Math.sin(this.yaw) * side);
  }
}
