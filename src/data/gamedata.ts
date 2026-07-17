/**
 * gamedata.ts — AUTHORITATIVE DATA for throwables, gear, enemies, and economy.
 * Split into separate files under /src/data if you prefer; kept together here for
 * a single paste. Real SAF values are accurate; radii/damage are balanced game values.
 */

// ===========================================================================
// THROWABLES  (equip in slot 4, throw with G)
// ===========================================================================
export type ThrowableType = "frag" | "smoke" | "flashbang" | "flare" | "tripflare";

export interface Throwable {
  id: string;
  name: string;
  type: ThrowableType;
  price: number;
  fuseSec: number;       // time from throw/trigger to effect
  effectDurationSec: number;
  radiusM: number;       // effect / blast radius
  color?: string;        // for coloured smoke
  damage?: number;       // for frag / launcher HE
  realNotes: string;
}

export const THROWABLES: Record<string, Throwable> = {
  sfg87: {
    id: "sfg87",
    name: "SFG 87 Frag",
    type: "frag",
    price: 0, // starter (2 issued)
    fuseSec: 5.0,          // real fuze 4–6s
    effectDurationSec: 0.2,
    radiusM: 20,           // ~20m casualty radius; ~5m kill radius (use a damage curve)
    damage: 150,           // at centre; falls to 0 by radiusM
    realNotes:
      "Standard SAF fragmentation grenade. ST Kinetics. ~300g, Composition B, ~2800 steel balls. Kill radius ~5m, casualty radius ~20m. Damage should fall off with distance from blast centre.",
  },
  smoke_red: {
    id: "smoke_red", name: "Smoke — Red", type: "smoke", price: 150,
    fuseSec: 1.5, effectDurationSec: 18, radiusM: 8, color: "#e53935",
    realNotes: "Coloured smoke for concealment/marking. Blocks enemy AI line-of-sight while active.",
  },
  smoke_yellow: {
    id: "smoke_yellow", name: "Smoke — Yellow", type: "smoke", price: 150,
    fuseSec: 1.5, effectDurationSec: 18, radiusM: 8, color: "#fdd835",
    realNotes: "Coloured smoke. Blocks enemy AI line-of-sight while active.",
  },
  smoke_blue: {
    id: "smoke_blue", name: "Smoke — Blue", type: "smoke", price: 150,
    fuseSec: 1.5, effectDurationSec: 18, radiusM: 8, color: "#1e88e5",
    realNotes: "Coloured smoke. Blocks enemy AI line-of-sight while active.",
  },
  smoke_green: {
    id: "smoke_green", name: "Smoke — Green", type: "smoke", price: 150,
    fuseSec: 1.5, effectDurationSec: 18, radiusM: 8, color: "#43a047",
    realNotes: "Coloured smoke. Blocks enemy AI line-of-sight while active.",
  },
  flashbang: {
    id: "flashbang", name: "Flashbang", type: "flashbang", price: 200,
    fuseSec: 2.0, effectDurationSec: 4, radiusM: 10,
    realNotes: "Bright flash + bang. Whites out the screen and muffles audio for the player if in radius/LOS; stuns enemy AI in a cone/radius for a few seconds.",
  },
  flare: {
    id: "flare", name: "Flare", type: "flare", price: 100,
    fuseSec: 1.0, effectDurationSec: 30, radiusM: 25,
    realNotes: "Illumination. Bright light source that lights up an area at night and reveals nearby enemies.",
  },
  tripflare: {
    id: "tripflare", name: "Tripflare", type: "tripflare", price: 250,
    fuseSec: 0, effectDurationSec: 20, radiusM: 3,
    realNotes: "Deployable trip alarm. Placed on the ground; triggers a bright flare + alerts the player when an enemy crosses the tripline. Early-warning trap.",
  },
};

/** MATADOR blast (fired via the launcher weapon, not thrown). */
export const MATADOR_BLAST = {
  radiusM: 6,
  centreDamage: 200,
  edgeDamage: 40,
  realNotes: "90mm warhead. Large blast; strong vs grouped/armoured enemies and cover.",
};

/** M203 underslung 40mm HE (attachment secondary-fire). */
export const M203_BLAST = {
  radiusM: 4,
  centreDamage: 120,
  edgeDamage: 25,
  fuseSec: 0, // impact-detonated
  realNotes: "40mm HE grenade, impact detonation, splash damage.",
};

// ===========================================================================
// GEAR & ARMOUR
// ===========================================================================
export interface GearItem {
  id: string;
  name: string;
  price: number;
  armour?: number;            // armour pool added
  damageReduction?: number;   // fraction of damage absorbed while armour remains
  carryBonus?: number;        // extra throwables/mags carried
  realNotes: string;
}

export const GEAR: Record<string, GearItem> = {
  fast_helmet: {
    id: "fast_helmet", name: "FAST Helmet", price: 0,
    armour: 15, damageReduction: 0.15,
    realNotes: "Default headgear. SAF issue. Small headshot mitigation.",
  },
  no4_uniform: {
    id: "no4_uniform", name: "No. 4 Uniform (SAF Digital Camo)", price: 0,
    realNotes: "Default player + friendly appearance. SAF pixelised digital camouflage pattern (manufactured by Sritex / PT Sri Rejeki Isman Tbk). Cosmetic, sets the soldier skin.",
  },
  lbv: {
    id: "lbv", name: "Load Bearing Vest", price: 800,
    carryBonus: 2,
    realNotes: "Increases carry capacity (extra throwables / magazines). Prerequisite for the armour plate.",
  },
  armour_plate: {
    id: "armour_plate", name: "Armour Plate", price: 1200,
    armour: 50, damageReduction: 0.5,
    realNotes: "Fits into the LBV. Adds an armour pool: incoming damage depletes armour (at 50% reduction) before health. Sustained fire can break the plate.",
  },
};

// ===========================================================================
// ENEMIES  (generic OPFOR — no real nation)
// ===========================================================================
export interface EnemyType {
  id: string;
  name: string;
  health: number;
  moveSpeed: number;      // m/s
  damage: number;         // per hit
  fireRateRpm: number;
  accuracy: number;       // 0–1
  sightRangeM: number;
  hearingRangeM: number;
  creditReward: number;
  weapon: string;         // flavour: which weapon they carry
  /** Fraction of incoming small-arms damage that actually lands (1 = none reduced). FMJ ammo bypasses this. */
  armorMultiplier: number;
  realNotes: string;
}

export const ENEMIES: Record<string, EnemyType> = {
  opfor_grunt: {
    id: "opfor_grunt", name: "OPFOR Rifleman", health: 100, moveSpeed: 3.5,
    damage: 12, fireRateRpm: 500, accuracy: 0.45, sightRangeM: 60, hearingRangeM: 40,
    creditReward: 50, weapon: "generic_rifle", armorMultiplier: 1.0,
    realNotes: "Baseline hostile infantry. Fills early waves.",
  },
  opfor_marksman: {
    id: "opfor_marksman", name: "OPFOR Marksman", health: 90, moveSpeed: 2.5,
    damage: 45, fireRateRpm: 60, accuracy: 0.8, sightRangeM: 120, hearingRangeM: 40,
    creditReward: 90, weapon: "generic_dmr", armorMultiplier: 1.0,
    realNotes: "Long-range threat; holds back and picks off the player. Prioritise or use smoke.",
  },
  opfor_heavy: {
    id: "opfor_heavy", name: "OPFOR Heavy", health: 250, moveSpeed: 2.2,
    damage: 20, fireRateRpm: 650, accuracy: 0.4, sightRangeM: 50, hearingRangeM: 40,
    creditReward: 140, weapon: "generic_lmg",
    // Plate carrier soaks 30% of small-arms damage; FMJ ammo bypasses this
    // entirely, so a Heavy takes damage as if it were an unarmoured rifleman.
    armorMultiplier: 0.7,
    realNotes: "Armoured, high HP, suppressing fire. Rewards MATADOR / headshots / .50 cal / FMJ ammo.",
  },
};

// ===========================================================================
// ECONOMY & WAVE SCALING
// ===========================================================================
export const ECONOMY = {
  killCredit: 50,          // base; per-enemy reward overrides this
  headshotBonus: 25,
  waveClearBonus: 200,
  waveClearScaling: 1.15,  // bonus grows each wave
  startingCredits: 0,
};

export const WAVES = {
  enemiesBase: 6,          // enemies in wave 1
  enemiesPerWave: 3,       // +3 each wave
  healthScalingPerWave: 0.06, // enemies +6% HP per wave
  bossEvery: 5,            // a heavy/boss wave every 5 waves
};
