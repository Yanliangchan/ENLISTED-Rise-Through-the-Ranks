import type { InputManager } from "@/core/InputManager";
import type { AudioManager } from "@/core/AudioManager";
import type { GameState } from "@/core/GameState";
import type { PlayerController } from "@/player/PlayerController";

const HEAL_FRACTION = 0.5; // a used kit restores half of max health

export interface MedKitCallbacks {
  onUse?: (kitsLeft: number, healedAmount: number) => void;
  onEmpty?: () => void;
  onFullHealth?: () => void;
}

/**
 * First aid kits (default key: 5). A carried count persisted on the save,
 * refilled to the starting amount on redeploy, topped up by health crates
 * up to the current carry cap. Using one heals half of the player's max health.
 */
export class MedKitController {
  constructor(
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly gameState: GameState,
    private readonly player: PlayerController,
    private readonly callbacks: MedKitCallbacks = {}
  ) {}

  get count(): number {
    return this.gameState.data.medkitCount;
  }

  get maxCount(): number {
    return this.gameState.maxMedkitCount();
  }

  /** Grant kits from a supply crate pickup, capped by LBV medic capacity. */
  add(amount: number): void {
    this.gameState.data.medkitCount = Math.min(this.gameState.maxMedkitCount(), this.gameState.data.medkitCount + amount);
    this.gameState.save();
  }

  update(dt: number): void {
    void dt;
    if (this.input.wasPressed("Digit5")) this.tryUse();
  }

  private tryUse(): void {
    if (this.gameState.data.medkitCount <= 0) {
      this.audio.uiClick();
      this.callbacks.onEmpty?.();
      return;
    }
    if (this.player.health >= this.player.maxHealth) {
      this.audio.uiClick();
      this.callbacks.onFullHealth?.();
      return;
    }
    this.gameState.data.medkitCount -= 1;
    const healedAmount = this.player.maxHealth * HEAL_FRACTION;
    this.player.heal(healedAmount);
    this.gameState.save();
    this.audio.medkit();
    this.callbacks.onUse?.(this.gameState.data.medkitCount, healedAmount);
  }
}
