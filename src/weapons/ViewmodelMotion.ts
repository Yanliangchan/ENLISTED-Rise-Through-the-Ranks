import { Vector3 } from "@babylonjs/core";

/**
 * Procedural first-person weapon motion (ART_DIRECTION.md §9): the layer
 * that makes the gun feel held rather than bolted to the lens. Purely visual
 * — hitscan always fires from the camera — and it fades out as the sight
 * comes up, so ADS stays exact.
 *
 * Outputs a camera-local position/rotation offset each frame that the
 * weapon controller adds on top of the hip/ADS solve. All state is scalar;
 * no per-frame allocation.
 */
export interface MotionInputs {
  mouseDX: number;
  mouseDY: number;
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  grounded: boolean;
  adsBlend: number;
  sprintBlend: number;
  /** 0..1 through the current reload, or -1 when not reloading. */
  reloadProgress: number;
}

export class ViewmodelMotion {
  readonly pos = new Vector3();
  readonly rot = new Vector3();

  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private kickBack = 0;
  private kickPitch = 0;
  private kickRoll = 0;
  private landDip = 0;
  private wasGrounded = true;
  private equipT = 1;

  /** Per-shot impulse; `strength` ≈ the weapon's vertical recoil stat. */
  kick(strength: number, aimed: boolean): void {
    const s = Math.min(3, strength) * (aimed ? 0.4 : 1);
    this.kickBack = Math.max(-0.07, this.kickBack - 0.016 * s);
    this.kickPitch = Math.max(-0.16, this.kickPitch - 0.035 * s);
    this.kickRoll += (Math.random() * 2 - 1) * 0.012 * s;
  }

  /** Start the raise-into-view on weapon switch. */
  equip(): void {
    this.equipT = 0;
  }

  update(dt: number, i: MotionInputs): void {
    const hipWeight = 1 - 0.85 * i.adsBlend;

    // Sway lag: the gun trails the look direction a touch and settles.
    const tx = Math.max(-0.022, Math.min(0.022, -i.mouseDX * 0.00022));
    const ty = Math.max(-0.018, Math.min(0.018, i.mouseDY * 0.00022));
    const swayRate = Math.min(1, dt * 9);
    this.swayX += (tx - this.swayX) * swayRate;
    this.swayY += (ty - this.swayY) * swayRate;

    // Walk/sprint bob: a figure-of-eight at stride cadence.
    const walking = i.moving && i.grounded;
    this.bobAmount += ((walking ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * (i.sprinting ? 13 : i.crouching ? 6.5 : 9) * (walking ? 1 : 0.4);
    const bobScale = this.bobAmount * (i.sprinting ? 1.7 : i.crouching ? 0.6 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.006 * bobScale;
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.0075 * bobScale;

    // Landing: a quick dip when feet meet the ground again.
    if (i.grounded && !this.wasGrounded) this.landDip = 0.035;
    this.wasGrounded = i.grounded;
    this.landDip *= Math.exp(-8 * dt);

    // Recoil kick recovers fast so full-auto reads as a rhythm, not a drift.
    const kickDecay = Math.exp(-16 * dt);
    this.kickBack *= kickDecay;
    this.kickPitch *= kickDecay;
    this.kickRoll *= Math.exp(-10 * dt);

    // Equip raise.
    this.equipT = Math.min(1, this.equipT + dt / 0.35);
    const lowered = Math.pow(1 - this.equipT, 3);

    // Sprint pose: lowered, muzzle down and turned across the body.
    const sprint = i.sprintBlend * (1 - i.adsBlend);

    // Reload: drop and roll the gun to bring the magazine well up and out,
    // with a small bump as the new magazine seats.
    let reloadEnv = 0;
    let seat = 0;
    if (i.reloadProgress >= 0) {
      const p = Math.min(1, i.reloadProgress);
      reloadEnv = Math.sin(p * Math.PI);
      reloadEnv = reloadEnv * reloadEnv * (3 - 2 * reloadEnv); // flatter hold in the middle
      seat = Math.exp(-(((p - 0.62) / 0.035) ** 2));
    }

    this.pos.set(
      (this.swayX + bobX) * hipWeight + 0.03 * sprint - 0.02 * reloadEnv,
      (this.swayY + bobY) * hipWeight - this.landDip - 0.07 * sprint - 0.06 * reloadEnv + 0.012 * seat - 0.18 * lowered,
      this.kickBack - 0.06 * sprint
    );
    this.rot.set(
      this.kickPitch + this.landDip * 1.5 + 0.32 * sprint + 0.18 * reloadEnv + 0.6 * lowered,
      this.swayX * 1.6 * hipWeight - 0.45 * sprint,
      this.kickRoll + (this.swayX * 2.2 + Math.cos(this.bobPhase) * 0.012 * bobScale) * hipWeight - 0.25 * sprint + 0.45 * reloadEnv
    );
  }
}
