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
  for (const id of gameState.data.ownedGear) {
    const item = GEAR[id];
    if (!item) continue;
    if (item.armour) armour += item.armour;
    if (item.damageReduction) damageReduction = Math.max(damageReduction, item.damageReduction);
  }
  player.maxArmour = armour;
  if (player.armour > armour) player.armour = armour;
  player.armourDamageReduction = damageReduction;
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
