/**
 * gamedata.ts — AUTHORITATIVE DATA for throwables, gear, enemies, and economy.
 * Split into separate files under /src/data if you prefer; kept together here for
 * a single paste. Real SAF values are accurate; radii/damage are balanced game values.
 */

// ===========================================================================
// THROWABLES  (equip in slot 4, throw with G)
// ===========================================================================
export type ThrowableType = "frag" | "smoke" | "flashbang" | "flare" | "tripflare" | "claymore";

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
    id: "smoke_red", name: "Smoke — Red", type: "smoke", price: 200,
    fuseSec: 1.5, effectDurationSec: 18, radiusM: 8, color: "#e53935",
    realNotes: "Coloured smoke for concealment/marking. Blocks enemy AI line-of-sight while active.",
  },
  claymore: {
    id: "claymore", name: "M18A1 Claymore Mine", type: "claymore", price: 450,
    fuseSec: 0, effectDurationSec: 0, radiusM: 12, damage: 180,
    realNotes: "Directional command mine. Place facing a choke point; detonates only in its forward cone and can be shot before it triggers.",
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
    id: "tripflare", name: "Tripflare", type: "tripflare", price: 300,
    fuseSec: 0, effectDurationSec: 20, radiusM: 3,
    realNotes: "Deployable trip alarm. Placed on the ground; triggers a bright flare + alerts the player when an enemy crosses the tripline. Early-warning trap.",
  },
};

/**
 * SPECIAL slot options that are call-in ABILITIES rather than a carried weapon
 * (the MATADOR is the weapon-type special). Only one special is equipped at a
 * time; abilities are triggered with Z instead of being switched to with 3.
 */
export const ABILITY_SPECIALS = ["uav", "airstrike", "carpetbombing"] as const;
export type AbilitySpecial = (typeof ABILITY_SPECIALS)[number];
export function isAbilitySpecial(id: string | null | undefined): id is AbilitySpecial {
  return id === "uav" || id === "airstrike" || id === "carpetbombing";
}
export const SPECIAL_ABILITY_LABELS: Record<AbilitySpecial, string> = {
  uav: "Hermes 900 UAV",
  airstrike: "Precision Strike",
  carpetbombing: "Carpet Bombing",
};
/** One-time unlock cost, credits, before either call-in ability can be equipped. */
export const SPECIAL_ABILITY_PRICES: Record<AbilitySpecial, number> = {
  uav: 8000,
  airstrike: 15000,
  carpetbombing: 30000,
};

/**
 * Call-in charges are a consumable stock now, not a per-deployment allowance
 * that silently refills: every deployment tops the player up to at least
 * `STRIKE_BASE_CHARGES`, and anything bought in the Armoury on top of that
 * carries forward until it's spent. `STRIKE_MAX_CHARGES` bounds the stockpile
 * so the shop can never turn a call-in into an every-wave certainty.
 */
export const STRIKE_BASE_CHARGES: Record<AbilitySpecial, number> = {
  uav: 2,
  airstrike: 3,
  carpetbombing: 1,
};
export const STRIKE_MAX_CHARGES: Record<AbilitySpecial, number> = {
  uav: 5,
  airstrike: 6,
  carpetbombing: 3,
};
/** Price of ONE extra charge, bought from the Armoury's Support Equipment tab. */
export const STRIKE_CHARGE_PRICES: Record<AbilitySpecial, number> = {
  uav: 1400,
  airstrike: 3800,
  carpetbombing: 9000,
};

/**
 * Pin-point elimination strike (Z to call, opens the targeting map).
 * Shared by AirstrikeSupport (which owns the damage) and the targeting
 * preview (which draws the blast footprint), so the ring the player aims with
 * is exactly the radius that later kills.
 */
export const PRECISION_STRIKE = {
  blastRadiusM: 16, // guaranteed kill inside this radius
  outerSplashRadiusMult: 1.4, // thin band beyond the kill radius that takes splash
  outerSplashDamage: 25,
  inboundDelaySec: 3, // "TARGET LOCKED → 3 → 2 → 1 → IMPACT"
  cooldownSec: 45,
};

/** Large-area saturation bombing run (Z to fire, opens the tactical map to pick an impact zone). */
export const CARPET_BOMBING = {
  areaLengthM: 60, // long axis of the rectangular bombing box
  areaWidthM: 22, // short axis
  impactCount: 14, // number of individual bomb impacts spread across the box
  impactSpreadSec: 1.4, // total time over which impacts land, staggered
  directHitRadiusM: 6, // guaranteed instant kill within this radius of an impact
  outerBlastRadiusM: 14, // heavy damage falloff zone beyond the direct-hit radius
  outerBlastDamage: 140,
  stunSec: 3, // survivors near any impact are stunned/disoriented
  slowMult: 0.5, // survivor move-speed multiplier while affected
  slowSec: 5,
  accuracyMult: 0.4, // survivor accuracy multiplier while affected
  accuracyDebuffSec: 5,
  survivorEffectRadiusM: 20, // radius (from box centre) applying the survivor debuffs
  inboundDelaySec: 3, // "TARGET LOCKED → 3 → 2 → 1 → IMPACT", same beat as Precision Strike
  cooldownSec: 90,
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
  // Wider casualty radius so the 40mm HE reads like a thrown frag rather than a
  // pin-point hit — more forgiving splash, closer to the SFG 87 grenade.
  radiusM: 11,
  centreDamage: 150,
  edgeDamage: 35,
  fuseSec: 0, // impact-detonated
  realNotes: "40mm HE grenade, impact detonation, wide splash damage.",
};

/**
 * M203 launch ballistics — the single source of truth for the projectile the
 * WeaponController fires AND the drop-compensating range ladder the HUD draws,
 * so the sight's tick marks always match where the grenade actually lands.
 */
export const M203_BALLISTICS = {
  speedMps: 45,
  maxRangeM: 180,
  gravityMps2: 9.0,
  muzzleHeightM: 1.5, // approximate launch height above ground, for the drop solution
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
  reserveAmmoBonus?: number;  // extra reserve magazine multiplier
  medkitBonus?: number;       // extra first aid kits at spawn / carried cap
  sprintDurationBonus?: number;
  staminaRegenBonus?: number;
  staminaDrainReduction?: number;
  movementSpeedMult?: number;
  sprintAccelerationMult?: number;
  lbvUpgrade?: boolean;
  /** One of the mutually-EQUIPPED plate types (hard/soft) — owning both is fine, but only one is worn at a time. */
  plateType?: boolean;
  /**
   * Pouch slots this item occupies on the vest. The LBV platform provides
   * `LBV_POUCH_SLOTS`; owning every upgrade is deliberately NOT the same as
   * wearing every upgrade, so the rig is a real loadout decision (armour vs.
   * ammunition vs. medical vs. endurance) rather than a shopping list.
   */
  slotCost?: number;
  /** Base kit that is always worn and never occupies vest capacity (helmet, uniform, the LBV platform itself). */
  alwaysEquipped?: boolean;
  /** One-line summary of what wearing this actually changes, shown in the Armoury. */
  effect?: string;
  realNotes: string;
}

/** Pouch capacity the Modular Load Bearing Vest platform provides. */
export const LBV_POUCH_SLOTS = 3;

export const GEAR: Record<string, GearItem> = {
  fast_helmet: {
    id: "fast_helmet", name: "FAST Helmet", price: 0, alwaysEquipped: true,
    armour: 15, damageReduction: 0.15,
    effect: "+15 armour · 15% of incoming damage absorbed",
    realNotes: "Default headgear. SAF issue. Small headshot mitigation.",
  },
  no4_uniform: {
    id: "no4_uniform", name: "No. 4 Uniform (SAF Digital Camo)", price: 0, alwaysEquipped: true,
    effect: "Cosmetic — sets the soldier skin",
    realNotes: "Default player + friendly appearance. SAF pixelised digital camouflage pattern (manufactured by Sritex / PT Sri Rejeki Isman Tbk). Cosmetic, sets the soldier skin.",
  },
  lbv: {
    id: "lbv", name: "Modular Load Bearing Vest", price: 900, alwaysEquipped: true,
    carryBonus: 1,
    effect: `+1 throwable carried · provides ${LBV_POUCH_SLOTS} pouch slots`,
    realNotes: "Base modular LBV platform. Unlocks plate, pouch, assault-load and hydration upgrades.",
  },
  hard_ballistic_plates: {
    id: "hard_ballistic_plates", name: "Hard Ballistic Plates", price: 1800, lbvUpgrade: true, plateType: true,
    slotCost: 2,
    armour: 120, damageReduction: 0.7, movementSpeedMult: 0.92, sprintAccelerationMult: 0.9,
    effect: "+120 armour · 70% damage absorbed · −8% move speed, slower sprint pickup",
    realNotes: "Maximum rifle-rated protection: much larger armour pool and strong damage absorption, offset by slower movement and sprint pickup. Bulky — takes two pouch slots.",
  },
  soft_ballistic_plates: {
    id: "soft_ballistic_plates", name: "Soft Ballistic Plates", price: 1200, lbvUpgrade: true, plateType: true,
    slotCost: 1,
    armour: 70, damageReduction: 0.5, movementSpeedMult: 0.97,
    effect: "+70 armour · 50% damage absorbed · −3% move speed",
    realNotes: "Lightweight survivability upgrade with moderate armour and minimal mobility penalty. Leaves room on the vest for two more pouches.",
  },
  assault_load_pouches: {
    id: "assault_load_pouches", name: "Assault Load Magazine Pouches", price: 1100, lbvUpgrade: true,
    slotCost: 1,
    reserveAmmoBonus: 0.75, carryBonus: 2,
    effect: "+75% reserve ammunition · +2 throwables carried",
    realNotes: "Extra rifle magazine pouches sharply increase reserve ammunition and carried equipment, without changing magazine size or reload speed.",
  },
  medic_pouch: {
    id: "medic_pouch", name: "Medic Pouch", price: 950, lbvUpgrade: true, medkitBonus: 3,
    slotCost: 1,
    effect: "+3 First Aid Kits at spawn · +3 to the carry cap",
    realNotes: "Dedicated IFAK pouch: spawn with additional First Aid Kits and raise the kit carry cap.",
  },
  hydration_pack: {
    id: "hydration_pack", name: "Hydration Pack", price: 850, lbvUpgrade: true,
    slotCost: 1,
    sprintDurationBonus: 0.7, staminaRegenBonus: 0.6, staminaDrainReduction: 0.35,
    effect: "+70% sprint duration · +60% stamina regen · −35% stamina drain",
    realNotes: "Rear-mounted bladder and shoulder tube substantially improve sprint endurance, stamina regeneration and running efficiency.",
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
    id: "opfor_grunt", name: "Infantry", health: 100, moveSpeed: 3.5,
    damage: 12, fireRateRpm: 500, accuracy: 0.45, sightRangeM: 60, hearingRangeM: 40,
    creditReward: 25, weapon: "generic_rifle", armorMultiplier: 1.0,
    realNotes: "Baseline hostile infantry. Fills early waves.",
  },
  opfor_marksman: {
    id: "opfor_marksman", name: "Marksman", health: 90, moveSpeed: 2.5,
    damage: 45, fireRateRpm: 60, accuracy: 0.8, sightRangeM: 120, hearingRangeM: 40,
    creditReward: 45, weapon: "generic_dmr", armorMultiplier: 1.0,
    realNotes: "Long-range threat; holds back and picks off the player. Prioritise or use smoke.",
  },
  opfor_heavy: {
    id: "opfor_heavy", name: "Heavy Infantry", health: 250, moveSpeed: 2.2,
    damage: 20, fireRateRpm: 650, accuracy: 0.4, sightRangeM: 50, hearingRangeM: 40,
    creditReward: 70, weapon: "generic_lmg",
    // Plate carrier soaks 30% of small-arms damage; FMJ ammo bypasses this
    // entirely, so a Heavy takes damage as if it were an unarmoured rifleman.
    armorMultiplier: 0.7,
    realNotes: "Armoured, high HP, suppressing fire. Rewards MATADOR / headshots / .50 cal / FMJ ammo.",
  },
  opfor_officer: {
    id: "opfor_officer", name: "Officer", health: 130, moveSpeed: 3.0,
    damage: 16, fireRateRpm: 450, accuracy: 0.5, sightRangeM: 65, hearingRangeM: 40,
    creditReward: 120, weapon: "generic_rifle", armorMultiplier: 0.85,
    realNotes: "Commands nearby OPFOR — buffs the accuracy and fire rate of soldiers near it while alive. High-value, high-priority target; flagged distinctly on the tactical map.",
  },
};

/** Radius (m) within which a living Officer buffs nearby OPFOR — see EnemySpawner's officer-aura pass. */
export const OFFICER_BUFF_RADIUS_M = 20;
/** Multiplier applied to accuracy/fire-rate for soldiers inside an Officer's buff radius. */
export const OFFICER_BUFF_ACCURACY_MULT = 1.25;
export const OFFICER_BUFF_FIRE_RATE_MULT = 1.2;

// ===========================================================================
// ECONOMY & WAVE SCALING
// ===========================================================================
// Progression rebalance pass 2: rewards trimmed a further ~30% from the
// already-reduced pass-1 values so weapon unlocks and rank progression take
// meaningfully longer to feel earned (waveClearScaling is untouched — the
// late-game bonus curve still grows the same rate off this smaller base).
export const ECONOMY = {
  killCredit: 25,          // base; per-enemy reward overrides this
  headshotBonus: 12,
  waveClearBonus: 100,
  waveClearScaling: 1.15,  // bonus grows each wave
  startingCredits: 0,
};

export const WAVES = {
  enemiesBase: 6,          // enemies in wave 1
  enemiesPerWave: 3,       // +3 each wave
  healthScalingPerWave: 0.06, // enemies +6% HP per wave
  eliteEvery: 5,           // an Elite Wave every 5 waves (5, 10, 15, 20, ...) — also the checkpoint interval
};

/**
 * Elite Waves (every WAVES.eliteEvery-th wave) skew the spawn mix toward
 * stronger variants and scale every spawned enemy up further on top of the
 * normal per-wave health curve, in exchange for a bigger credit payout —
 * both per kill and on the wave-clear bonus.
 */
export const ELITE_WAVE = {
  healthMult: 1.35,
  damageMult: 1.2,
  creditRewardMult: 1.5,
  waveClearBonusMult: 1.75,
  heavyFraction: 0.4, // fraction of the wave guaranteed to be Heavy Infantry
  guaranteesOfficer: true, // at least one Officer spawns if the map profile allows it
};
