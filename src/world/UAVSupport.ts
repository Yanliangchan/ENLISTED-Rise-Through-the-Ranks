import type { AudioManager } from "@/core/AudioManager";
import { isUnlocked as isAdminUnlocked } from "@/core/AdminMode";

const UAV_DURATION_SEC = 20; // reveals all enemies for this long
const UAV_COOLDOWN_SEC = 30; // recharge time between deployments
const UAV_CHARGES_PER_RUN = 3; // limited uses; refills on redeploy

export interface UAVCallbacks {
  /** Fired when a UAV is launched — used to prompt the player to open the tactical map. */
  onActivate?: () => void;
  onUnavailable?: (reason: "cooldown" | "empty") => void;
}

/**
 * UAV recon support ability (default key: Z — Q now opens the BOTTY command
 * wheel). When launched it flies overhead
 * for 20 seconds, feeding a live fix on every OPFOR to the tactical map
 * (EnemyManager.intel is called with revealAll while `active`). Limited to a
 * few charges per deployment with a cooldown between launches, so it's a
 * deliberate tactical call rather than an always-on radar.
 */
export class UAVSupport {
  active = false;
  private timeLeft = 0;
  private cooldownLeft = 0;
  private charges = UAV_CHARGES_PER_RUN;

  constructor(
    private readonly audio: AudioManager,
    private readonly callbacks: UAVCallbacks = {}
  ) {}

  /** Reset charges/cooldown on spawn or redeploy. */
  reset(): void {
    this.active = false;
    this.timeLeft = 0;
    this.cooldownLeft = 0;
    this.charges = UAV_CHARGES_PER_RUN;
  }

  get chargesRemaining(): number {
    return this.charges;
  }

  get secondsRemaining(): number {
    return Math.max(0, this.timeLeft);
  }

  get cooldownRemaining(): number {
    return Math.max(0, this.cooldownLeft);
  }

  update(dt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;

    if (this.active) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.active = false;
        this.cooldownLeft = UAV_COOLDOWN_SEC;
      }
    }
    // NOTE: the Z trigger is routed from main.ts now, so the UAV only fires when
    // it is the equipped SPECIAL (mutually exclusive with the MATADOR / air strike).
  }

  /** True if a UAV can be launched right now. */
  get ready(): boolean {
    return !this.active && this.cooldownLeft <= 0 && (this.charges > 0 || isAdminUnlocked());
  }

  /** Launch a UAV (call from main when UAV is the equipped special and Z is pressed). */
  activate(): void {
    if (this.active) return;
    if (this.cooldownLeft > 0) {
      this.audio.uiClick();
      this.callbacks.onUnavailable?.("cooldown");
      return;
    }
    if (this.charges <= 0 && !isAdminUnlocked()) {
      this.audio.uiClick();
      this.callbacks.onUnavailable?.("empty");
      return;
    }
    if (!isAdminUnlocked()) this.charges -= 1;
    this.active = true;
    this.timeLeft = UAV_DURATION_SEC;
    this.audio.waveStart();
    this.callbacks.onActivate?.();
  }
}
