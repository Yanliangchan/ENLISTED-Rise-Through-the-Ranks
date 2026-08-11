import type { AudioManager } from "@/core/AudioManager";
import type { StrikeChargeStore } from "@/world/AirstrikeSupport";
import { isUnlocked as isAdminUnlocked } from "@/core/AdminMode";

const UAV_DURATION_SEC = 20; // reveals all enemies for this long
const UAV_COOLDOWN_SEC = 30; // recharge time between deployments

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

  constructor(
    private readonly audio: AudioManager,
    private readonly store: StrikeChargeStore,
    private readonly callbacks: UAVCallbacks = {}
  ) {}

  /** Clear in-flight state on spawn or redeploy. Charges live on the save and are topped up there. */
  reset(): void {
    this.active = false;
    this.timeLeft = 0;
    this.cooldownLeft = 0;
  }

  get chargesRemaining(): number {
    return this.store.charges();
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
    return !this.active && this.cooldownLeft <= 0 && (this.chargesRemaining > 0 || isAdminUnlocked());
  }

  /** Launch a UAV (call from main when UAV is the equipped special and Z is pressed). */
  activate(): void {
    if (this.active) return;
    if (this.cooldownLeft > 0) {
      this.audio.uiClick();
      this.callbacks.onUnavailable?.("cooldown");
      return;
    }
    if (this.chargesRemaining <= 0 && !isAdminUnlocked()) {
      this.audio.uiClick();
      this.callbacks.onUnavailable?.("empty");
      return;
    }
    if (!isAdminUnlocked() && !this.store.consume()) return;
    this.active = true;
    this.timeLeft = UAV_DURATION_SEC;
    this.audio.waveStart();
    this.callbacks.onActivate?.();
  }
}
