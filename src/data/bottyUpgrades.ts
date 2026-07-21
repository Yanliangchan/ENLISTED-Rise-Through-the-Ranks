/**
 * BOTTY's personal upgrade tree — independent of the player's own weapons/gear
 * economy. Seven tracks, three levels each, bought one level at a time in the
 * Armoury's Support tab. Costs sit in the $20k-50k band per the design brief:
 * level 1 is the cheapest entry, level 3 the expensive capstone.
 */
export type BottyUpgradeCategory =
  | "weapon"
  | "armour"
  | "health"
  | "reaction"
  | "accuracy"
  | "suppression"
  | "smoke";

export const BOTTY_UPGRADE_CATEGORIES: BottyUpgradeCategory[] = [
  "weapon",
  "armour",
  "health",
  "reaction",
  "accuracy",
  "suppression",
  "smoke",
];

export interface BottyUpgradeDef {
  name: string;
  /** Cost to buy level 1 / 2 / 3 (each level bought independently, in order). */
  levelPrices: [number, number, number];
  /** What each level actually does, for the Armoury tooltip/label. */
  levelDescriptions: [string, string, string];
  summary: string;
}

export const BOTTY_UPGRADES: Record<BottyUpgradeCategory, BottyUpgradeDef> = {
  weapon: {
    name: "Weapon Upgrade",
    levelPrices: [20000, 35000, 50000],
    levelDescriptions: [
      "+20% damage per hit, +10 round magazine.",
      "+40% damage per hit, +20 round magazine, faster cyclic rate.",
      "+65% damage per hit, +30 round magazine, faster cyclic rate.",
    ],
    summary: "Hits harder and carries more ammo before reloading.",
  },
  armour: {
    name: "Armour Upgrade",
    levelPrices: [20000, 35000, 50000],
    levelDescriptions: [
      "-12% incoming damage.",
      "-24% incoming damage.",
      "-38% incoming damage.",
    ],
    summary: "Plate carrier upgrades — BOTTY shrugs off more before going down.",
  },
  health: {
    name: "Health Upgrade",
    levelPrices: [20000, 35000, 50000],
    levelDescriptions: [
      "+25 max health.",
      "+55 max health.",
      "+95 max health.",
    ],
    summary: "Raises BOTTY's max health on top of the wave-based scaling.",
  },
  reaction: {
    name: "Reaction Speed",
    levelPrices: [20000, 35000, 50000],
    levelDescriptions: [
      "-20% reload time, faster target acquisition.",
      "-35% reload time, faster target acquisition.",
      "-50% reload time, near-instant target acquisition.",
    ],
    summary: "Reloads and re-acquires targets faster — fewer dead seconds in a firefight.",
  },
  accuracy: {
    name: "Accuracy",
    levelPrices: [25000, 40000, 50000],
    levelDescriptions: [
      "+8% hit chance.",
      "+16% hit chance.",
      "+25% hit chance.",
    ],
    summary: "Stacks directly onto BOTTY's wave-scaled hit chance.",
  },
  suppression: {
    name: "Suppression Fire",
    levelPrices: [25000, 40000, 50000],
    levelDescriptions: [
      "12% chance per hit to rattle the target's aim briefly.",
      "22% chance per hit, wider radius and longer rattle.",
      "35% chance per hit, wide radius — BOTTY's fire alone can break an engagement.",
    ],
    summary: "Landed hits have a chance to suppress the target and nearby OPFOR, spoiling their aim.",
  },
  smoke: {
    name: "Smoke Capacity",
    levelPrices: [20000, 30000, 40000],
    levelDescriptions: [
      "Carries 2 smoke charges instead of 1.",
      "Carries 3 smoke charges; can pop smoke on Cover Me / Engage too.",
      "Carries 4 smoke charges; auto-pops smoke when critically wounded, any order.",
    ],
    summary: "More screening smoke, usable in more situations, not just Retreat.",
  },
};

export function bottyUpgradePrice(category: BottyUpgradeCategory, currentLevel: number): number | null {
  if (currentLevel >= 3) return null;
  return BOTTY_UPGRADES[category].levelPrices[currentLevel];
}
