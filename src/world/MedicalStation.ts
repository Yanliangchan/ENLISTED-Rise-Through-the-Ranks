import { Vector3 } from "@babylonjs/core";
import type { PlayerController } from "@/player/PlayerController";
import type { InputManager } from "@/core/InputManager";
import type { AudioManager } from "@/core/AudioManager";
import type { MedKitController } from "@/player/MedKit";
import { MEDICAL_TENT_POSITION } from "@/world/Level";

const INTERACT_RADIUS = 2.6;
/** Short cooldown rather than a long respawn — this is the home-base restock point, not a scarce field pickup. */
const RESTOCK_COOLDOWN_SEC = 15;

/**
 * The medical tent's first aid supply crate: press F within range to top up
 * to the full current kit carry before deploying. Unlike a field health crate this
 * doesn't add on top — it always tops up to the current kit cap, so revisiting it
 * with kits already in hand is a no-op (until the short cooldown expires).
 */
export class MedicalStation {
  promptText: string | null = null;
  private cooldown = 0;

  constructor(
    private readonly player: PlayerController,
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly medKit: MedKitController
  ) {}

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;

    const dist = Vector3.Distance(this.player.position, MEDICAL_TENT_POSITION);
    if (dist > INTERACT_RADIUS || this.cooldown > 0 || this.medKit.count >= this.medKit.maxCount) {
      this.promptText = null;
      return;
    }

    this.promptText = "Press F — restock First Aid Kits";
    if (this.input.wasPressed("KeyF")) {
      this.medKit.add(this.medKit.maxCount);
      this.cooldown = RESTOCK_COOLDOWN_SEC;
      this.audio.purchase();
      this.promptText = null;
    }
  }
}
