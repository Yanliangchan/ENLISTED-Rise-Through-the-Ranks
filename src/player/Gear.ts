import { GEAR } from "@/data/gamedata";
import type { GameState } from "@/core/GameState";
import type { PlayerController } from "@/player/PlayerController";

/**
 * Folds owned gear (`gamedata.ts` GEAR) into the player's stat pools: FAST
 * helmet's small headshot mitigation, the LBV's carry bonus (extra
 * throwables), and the armour plate's damage-absorbing pool. Call after any
 * purchase and once at run start.
 */
export function applyGearToPlayer(gameState: GameState, player: PlayerController): void {
  let armour = 0;
  let damageReduction = 0;
  let moveMult = 1;
  let sprintAccelMult = 1;
  let sprintDurationBonus = 0;
  let staminaRegenBonus = 0;
  let staminaDrainReduction = 0;
  for (const id of gameState.data.ownedGear) {
    const item = GEAR[id];
    if (!item) continue;
    if (item.armour) armour += item.armour;
    if (item.damageReduction) damageReduction = Math.max(damageReduction, item.damageReduction);
    if (item.movementSpeedMult) moveMult *= item.movementSpeedMult;
    if (item.sprintAccelerationMult) sprintAccelMult *= item.sprintAccelerationMult;
    sprintDurationBonus += item.sprintDurationBonus ?? 0;
    staminaRegenBonus += item.staminaRegenBonus ?? 0;
    staminaDrainReduction += item.staminaDrainReduction ?? 0;
  }
  player.maxArmour = armour;
  if (player.armour > armour) player.armour = armour;
  player.armourDamageReduction = damageReduction;
  player.gearMoveSpeedMult = moveMult;
  player.sprintAccelerationMult = sprintAccelMult;
  player.staminaMax = 5 * (1 + sprintDurationBonus);
  player.staminaRegenMult = 1 + staminaRegenBonus;
  player.staminaDrainMult = Math.max(0.4, 1 - staminaDrainReduction);
  player.stamina = Math.min(player.stamina, player.staminaMax);
}

export function carryBonus(gameState: GameState): number {
  let bonus = 0;
  for (const id of gameState.data.ownedGear) {
    const item = GEAR[id];
    if (item?.carryBonus) bonus += item.carryBonus;
  }
  return bonus;
}

export function maxThrowableCapacity(gameState: GameState): number {
  return 2 + carryBonus(gameState);
}
