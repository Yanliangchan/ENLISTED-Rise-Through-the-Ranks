/**
 * weapons.ts — AUTHORITATIVE WEAPON DATA
 *
 * DO NOT invent, guess, or alter these stats. Real-world calibre, role, magazine,
 * fire mode, and effective range are accurate to actual SAF equipment. `damage`,
 * `recoil`, `spread`, `adsTimeSec`, and prices are BALANCED GAME VALUES — tune these
 * for feel, but keep the real fields (`realCaliber`, `magSize`, `fireModes`,
 * `effectiveRangeM`, `realNotes`) intact for authenticity.
 *
 * Bullets are HITSCAN (raycast). `muzzleVelocityMps` is used for tracer/visual feel.
 * `isProjectile: true` weapons (MATADOR) use travel-time physics + blast radius.
 *
 * Balancing baseline: OPFOR grunt = 100 HP. Player = 100 HP (+optional armour).
 */

export type WeaponClass =
  | "rifle"
  | "pistol"
  | "smg"
  | "dmr"
  | "sniper"
  | "lmg"
  | "hmg"
  | "launcher";

export type FireMode = "safe" | "semi" | "auto" | "bolt" | "single";

export type WeaponSlot = "primary" | "secondary" | "special";

export type AttachmentSlot =
  | "optic"
  | "underbarrel"
  | "muzzle"
  | "laser"
  | "magazine"
  | "rail";

export interface DamageFalloff {
  /** Full damage out to this range (metres). */
  startM: number;
  /** Damage decays linearly to `minMultiplier` by this range. */
  endM: number;
  /** Floor as a fraction of base damage (e.g. 0.4 = 40%). */
  minMultiplier: number;
}

export interface WeaponRecoil {
  /** Upward kick per shot (view-units). */
  vertical: number;
  /** Random horizontal kick per shot (± view-units). */
  horizontal: number;
  /** Recovery speed back to centre (units/sec). */
  recovery: number;
}

export interface WeaponSpread {
  /** Cone half-angle when hip-firing, stationary (degrees). */
  hip: number;
  /** Cone half-angle when aiming down sights, stationary (degrees). */
  ads: number;
  /** Extra spread added while moving (degrees). */
  movePenalty: number;
}

export interface Weapon {
  id: string;
  name: string;
  class: WeaponClass;
  slot: WeaponSlot;

  // --- REAL (authentic, do not change) ---
  realCaliber: string;
  fireModes: FireMode[];
  magSize: number;
  effectiveRangeM: number;
  muzzleVelocityMps: number;
  realNotes: string;

  // --- GAME (balanced, tune for feel) ---
  damage: number;
  headshotMultiplier: number;
  /** Rounds per minute used in-game (kept within the real weapon's range). */
  fireRateRpm: number;
  reserveAmmo: number;
  reloadTimeSec: number;
  adsTimeSec: number;
  falloff: DamageFalloff;
  recoil: WeaponRecoil;
  spread: WeaponSpread;
  /** Movement speed multiplier while equipped (heavier = slower). */
  moveSpeedMult: number;
  isProjectile: boolean;

  // --- ECONOMY & PROGRESSION ---
  price: number;
  unlockedByDefault: boolean;

  // --- ATTACHMENTS ---
  /** Which attachment slots this weapon exposes. */
  attachmentSlots: AttachmentSlot[];
  /** Attachment ids fitted by default (see attachments.ts). */
  defaultAttachments: string[];
}

export const WEAPONS: Record<string, Weapon> = {
  // =========================================================================
  // PRIMARY RIFLES
  // =========================================================================
  sar21: {
    id: "sar21",
    name: "SAR 21",
    class: "rifle",
    slot: "primary",
    realCaliber: "5.56×45mm NATO",
    fireModes: ["safe", "semi", "auto"],
    magSize: 30,
    effectiveRangeM: 460, // 460m (M193) / up to 800m (SS109/M855)
    muzzleVelocityMps: 945,
    realNotes:
      "Standard SAF service rifle since 1999. ST Kinetics bullpup. Integral 1.5x optic + backup irons. Low cyclic rate aids control. Starter weapon.",
    damage: 24,
    headshotMultiplier: 2.0,
    fireRateRpm: 600,
    reserveAmmo: 180,
    reloadTimeSec: 2.4,
    adsTimeSec: 0.25,
    falloff: { startM: 70, endM: 240, minMultiplier: 0.78 },
    recoil: { vertical: 1.2, horizontal: 0.4, recovery: 6 },
    spread: { hip: 3.0, ads: 0.35, movePenalty: 1.2 },
    moveSpeedMult: 1.0,
    isProjectile: false,
    price: 0,
    unlockedByDefault: true,
    // SAR 21 needs the P-Rail before most optics/attachments unlock (mirrors reality).
    attachmentSlots: ["rail", "optic", "underbarrel", "muzzle", "laser"],
    defaultAttachments: ["optic_sar21_1_5x"],
  },

  br18: {
    id: "br18",
    name: "BR18",
    class: "rifle",
    slot: "primary",
    realCaliber: "5.56×45mm NATO",
    fireModes: ["safe", "semi", "auto"],
    magSize: 30,
    effectiveRangeM: 650, // max ~1000m
    muzzleVelocityMps: 900, // approximate — game/visual value
    realNotes:
      "ST Engineering bullpup, 2018+. Higher cyclic rate (700–900 rpm). Full-length Picatinny rail (any optic) + built-in irons. Accepts STANAG or SAR-21 mags. A natural upgrade rifle.",
    damage: 22,
    headshotMultiplier: 2.0,
    fireRateRpm: 800,
    reserveAmmo: 210,
    reloadTimeSec: 2.3,
    adsTimeSec: 0.24,
    falloff: { startM: 75, endM: 260, minMultiplier: 0.78 },
    recoil: { vertical: 1.3, horizontal: 0.5, recovery: 6.5 },
    spread: { hip: 3.2, ads: 0.3, movePenalty: 1.2 },
    moveSpeedMult: 1.0,
    isProjectile: false,
    price: 2500,
    unlockedByDefault: false,
    // Full rail from the factory — no separate rail purchase needed.
    attachmentSlots: ["optic", "underbarrel", "muzzle", "laser"],
    defaultAttachments: [],
  },

  // =========================================================================
  // SIDEARM
  // =========================================================================
  p30: {
    id: "p30",
    name: "H&K P30",
    class: "pistol",
    slot: "secondary",
    realCaliber: "9×19mm Parabellum",
    fireModes: ["safe", "semi"],
    magSize: 15,
    effectiveRangeM: 50,
    muzzleVelocityMps: 360,
    realNotes:
      "Standard SAF sidearm since Nov 2018, replacing the SIG P226 (in service from 1985). DA/SA, ambidextrous, interchangeable backstraps. Fast to draw. Starter weapon.",
    damage: 30,
    headshotMultiplier: 2.0,
    fireRateRpm: 400, // semi, capped by trigger speed
    reserveAmmo: 60,
    reloadTimeSec: 1.6,
    adsTimeSec: 0.18,
    falloff: { startM: 25, endM: 75, minMultiplier: 0.5 },
    recoil: { vertical: 1.6, horizontal: 0.6, recovery: 8 },
    spread: { hip: 2.2, ads: 0.6, movePenalty: 0.8 },
    moveSpeedMult: 1.1, // pistols out = faster
    isProjectile: false,
    price: 0,
    unlockedByDefault: true,
    attachmentSlots: ["optic", "muzzle", "magazine", "laser"],
    defaultAttachments: [],
  },

  mp5k: {
    id: "mp5k",
    name: "H&K MP5K",
    class: "smg",
    slot: "secondary",
    realCaliber: "9×19mm Parabellum",
    fireModes: ["safe", "semi", "auto"],
    magSize: 30,
    effectiveRangeM: 100,
    muzzleVelocityMps: 375, // 4.5" barrel — noticeably down on the full MP5's ~400
    realNotes:
      "Kurz (short) MP5: 4.5\" barrel, front vertical grip, no stock. Roller-delayed blowback — famously smooth and controllable. ~900 rpm. Close-protection and special-operations weapon; MP5 family serves with SAF/SPF special units.",
    // Balanced against the P30: much higher sustained DPS inside ~30m, but
    // per-shot damage is low and falls off hard — past ~60m the pistol's
    // heavier single hits and the primaries outclass it.
    damage: 18,
    headshotMultiplier: 1.8,
    fireRateRpm: 850,
    reserveAmmo: 120,
    reloadTimeSec: 2.2,
    adsTimeSec: 0.16, // stockless and tiny — fastest ADS in the game
    falloff: { startM: 15, endM: 55, minMultiplier: 0.45 },
    recoil: { vertical: 0.7, horizontal: 0.35, recovery: 9 }, // roller-delayed = very soft
    spread: { hip: 1.5, ads: 0.55, movePenalty: 0.6 }, // best hip-fire in the game
    moveSpeedMult: 1.1, // as mobile as the pistol
    isProjectile: false,
    price: 1800,
    unlockedByDefault: false,
    attachmentSlots: ["optic", "muzzle", "laser"],
    defaultAttachments: [],
  },

  // =========================================================================
  // SNIPERS / MARKSMAN
  // =========================================================================
  m110: {
    id: "m110",
    name: "KAC M110 SASS",
    class: "dmr",
    slot: "primary",
    realCaliber: "7.62×51mm NATO",
    fireModes: ["safe", "semi"],
    magSize: 20,
    effectiveRangeM: 800,
    muzzleVelocityMps: 783,
    realNotes:
      "SAF semi-automatic sniper system; version resembles M110A1 (sliding stock). Section sharpshooter / DMR role. Fast follow-up shots at range.",
    damage: 55,
    headshotMultiplier: 2.5,
    fireRateRpm: 360,
    reserveAmmo: 100,
    reloadTimeSec: 2.8,
    adsTimeSec: 0.34,
    falloff: { startM: 120, endM: 380, minMultiplier: 0.88 },
    recoil: { vertical: 3.2, horizontal: 0.8, recovery: 4 },
    spread: { hip: 5.0, ads: 0.15, movePenalty: 2.0 },
    moveSpeedMult: 0.95,
    isProjectile: false,
    price: 4000,
    unlockedByDefault: false,
    attachmentSlots: ["optic", "underbarrel", "muzzle", "laser"],
    defaultAttachments: ["optic_variable_3_9x"],
  },

  trg22: {
    id: "trg22",
    name: "Sako TRG-22",
    class: "sniper",
    slot: "primary",
    realCaliber: "7.62×51mm / .308 Win",
    fireModes: ["safe", "bolt"],
    magSize: 10,
    effectiveRangeM: 800,
    muzzleVelocityMps: 800,
    realNotes:
      "Finnish bolt-action, sub-MOA. Dedicated SAF sniper rifle. One-shot body kill on grunts, always lethal headshot. Slow bolt cycle between shots.",
    damage: 110,
    headshotMultiplier: 3.0,
    fireRateRpm: 45, // bolt cycle
    reserveAmmo: 60,
    reloadTimeSec: 3.2,
    adsTimeSec: 0.45,
    falloff: { startM: 200, endM: 520, minMultiplier: 0.95 },
    recoil: { vertical: 5.0, horizontal: 0.6, recovery: 3 },
    spread: { hip: 6.0, ads: 0.05, movePenalty: 3.0 },
    moveSpeedMult: 0.9,
    isProjectile: false,
    price: 4500,
    unlockedByDefault: false,
    attachmentSlots: ["optic", "underbarrel", "muzzle"],
    defaultAttachments: ["optic_precision_5_25x"],
  },

  // =========================================================================
  // MACHINE GUNS
  // =========================================================================

  fnmag: {
    id: "fnmag",
    name: "FN MAG (GPMG)",
    class: "lmg",
    slot: "primary",
    realCaliber: "7.62×51mm NATO",
    fireModes: ["safe", "auto"],
    magSize: 100, // belt box
    effectiveRangeM: 800,
    muzzleVelocityMps: 840,
    realNotes:
      "General-purpose belt-fed MG, platoon-level support. High sustained fire, heavy — best deployed on bipod. Long reload.",
    damage: 34,
    headshotMultiplier: 2.0,
    fireRateRpm: 750,
    reserveAmmo: 300,
    reloadTimeSec: 6.5,
    adsTimeSec: 0.5,
    falloff: { startM: 90, endM: 300, minMultiplier: 0.78 },
    recoil: { vertical: 2.0, horizontal: 1.0, recovery: 4 },
    spread: { hip: 4.5, ads: 0.6, movePenalty: 2.5 },
    moveSpeedMult: 0.8,
    isProjectile: false,
    price: 6000,
    unlockedByDefault: false,
    attachmentSlots: ["optic", "underbarrel", "magazine"],
    defaultAttachments: ["under_bipod"],
  },


  // =========================================================================
  // SPECIAL / ANTI-ARMOUR
  // =========================================================================
  matador: {
    id: "matador",
    name: "MATADOR",
    class: "launcher",
    slot: "special",
    realCaliber: "90mm",
    fireModes: ["safe", "single"],
    magSize: 1, // single-shot disposable
    effectiveRangeM: 500,
    muzzleVelocityMps: 250, // real — matters, this is a projectile
    realNotes:
      "Man-portable Anti-Tank, Anti-DOoR. Single-shot disposable. Counter-mass = usable in confined spaces. Warhead variants: MP (multi-purpose), WB (wall-breach/EFR), AS (anti-structure tandem). Model as slow travel-time projectile + large blast radius; limited carry count.",
    damage: 200, // direct hit; blast handled separately (see throwables.ts blast pattern)
    headshotMultiplier: 1.0,
    fireRateRpm: 20,
    reserveAmmo: 0, // buy per shot; carry count limited by loadout
    reloadTimeSec: 3.5,
    adsTimeSec: 0.4,
    falloff: { startM: 500, endM: 500, minMultiplier: 1.0 },
    recoil: { vertical: 4.0, horizontal: 1.0, recovery: 3 },
    spread: { hip: 2.0, ads: 0.5, movePenalty: 1.0 },
    moveSpeedMult: 0.85,
    isProjectile: true,
    price: 1200, // per shot
    unlockedByDefault: false,
    attachmentSlots: ["optic"],
    defaultAttachments: [],
  },
};

/** Weapons the player owns at the start of a fresh save. */
export const STARTER_LOADOUT = {
  primary: "sar21",
  secondary: "p30",
  special: null as string | null,
  throwable: "sfg87",
  throwableCount: 2,
};
