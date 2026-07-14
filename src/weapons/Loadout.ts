import type { InputManager } from "@/core/InputManager";
import type { GameState } from "@/core/GameState";
import type { WeaponController } from "@/weapons/WeaponController";

export type LoadoutSlot = "primary" | "secondary" | "special" | "throwable";
const SLOT_ORDER: LoadoutSlot[] = ["primary", "secondary", "special", "throwable"];

/**
 * Weapon switching: keys 1–4 select primary/secondary/special/throwable,
 * mouse wheel cycles between slots that actually have something equipped.
 * Throwables are thrown with a dedicated `G` key handled by ThrowableController;
 * selecting the throwable slot here just hides the gun viewmodel.
 */
export class Loadout {
  activeSlot: LoadoutSlot = "primary";

  constructor(
    private readonly input: InputManager,
    private readonly gameState: GameState,
    private readonly weaponController: WeaponController
  ) {
    this.switchTo("primary");
  }

  private slotWeaponId(slot: LoadoutSlot): string | null {
    if (slot === "throwable") return null;
    return this.gameState.data.loadout[slot];
  }

  private availableSlots(): LoadoutSlot[] {
    return SLOT_ORDER.filter((s) => s === "throwable" || this.slotWeaponId(s));
  }

  update(): void {
    if (this.input.wasPressed("Digit1")) this.switchTo("primary");
    if (this.input.wasPressed("Digit2")) this.switchTo("secondary");
    if (this.input.wasPressed("Digit3") && this.slotWeaponId("special")) this.switchTo("special");
    if (this.input.wasPressed("Digit4")) this.switchTo("throwable");

    if (Math.abs(this.input.wheelDelta) > 1) {
      const slots = this.availableSlots();
      const idx = slots.indexOf(this.activeSlot);
      const dir = this.input.wheelDelta > 0 ? 1 : -1;
      const next = slots[(idx + dir + slots.length) % slots.length];
      this.switchTo(next);
    }
  }

  switchTo(slot: LoadoutSlot): void {
    this.activeSlot = slot;
    const weaponId = this.slotWeaponId(slot);
    if (weaponId) {
      this.weaponController.equip(weaponId);
      this.weaponController.setViewmodelVisible(true);
    } else {
      this.weaponController.setViewmodelVisible(false);
    }
  }
}
