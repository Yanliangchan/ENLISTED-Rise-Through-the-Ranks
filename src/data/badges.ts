/**
 * badges.ts — AUTHORITATIVE BADGE DATA (SAF-accurate qualification badges)
 *
 * Badges are earned by completing optional CHALLENGE OPS (special missions),
 * NOT by accumulating rank merit. They are independent of your career track —
 * an officer or a specialist can both earn the Ranger tab. Each badge grants a
 * passive perk and is displayed on the soldier model + profile card.
 *
 * This is reference/planning data — see ProfilePage.ts's "SAF Career Ladder"
 * section for where the catalog is surfaced. The Challenge Ops missions
 * themselves aren't implemented as playable content yet; this defines the
 * target design for when they are.
 *
 * SAF WEAR RULES (accurate — use these for on-model placement):
 *  - Ranger & Guards are SHOULDER TABS, worn on the left sleeve. Max 2 tabs.
 *  - Airborne/parachutist WINGS and skill BADGES are worn on the LEFT CHEST,
 *    above the pocket. Max 2 skills tabs on the sleeve.
 *  - BERET colour denotes formation (e.g. maroon/red = Commando).
 *  - Parachutist wing BACKING colour denotes type: none = basic parachutist,
 *    red backing = commando parachutist, black backing = diver parachutist,
 *    yellow backing = jumpmaster.
 */

export type BadgeCategory = "tab" | "wings" | "badge" | "beret";

export interface Badge {
  id: string;
  name: string;
  category: BadgeCategory;
  wear: string; // where it sits on the uniform (accuracy)
  challengeId: string; // the Challenge Op that awards it
  meritReward: number; // lump merit granted on earning
  perk: string; // passive gameplay perk
  tiers?: string[]; // progressive versions, low → high
  /** What this badge actually is in the real SAF — accurate reference text. */
  realLife: string;
  /** How you earn it in-game (this Challenge Op's rules). */
  howToEarn: string;
}

export const BADGES: Record<string, Badge> = {
  ranger: {
    id: "ranger",
    name: "Ranger Tab",
    category: "tab",
    wear: "Left sleeve (shoulder tab).",
    challengeId: "op_ranger_gauntlet",
    meritReward: 800,
    perk: "Endurance: −40% stamina drain, faster sprint recovery.",
    realLife:
      "SAF Ranger tab (red) — a volunteer confidence course in small-unit tactics, survival and combat endurance for combat vocations. One of the toughest schools in the SAF; earned by passing Ranger selection and the full course.",
    howToEarn:
      "OPERATION: RANGER GAUNTLET — hold Pasir Panjang Terminal through 18 escalating waves with NO resupply, NO armour and no BOTTY.",
  },

  guards: {
    id: "guards",
    name: "Guards Tab",
    category: "tab",
    wear: "Left sleeve (shoulder tab).",
    challengeId: "op_guards_assault",
    meritReward: 600,
    perk: "Mobility: +12% move speed, −15% ADS time.",
    realLife:
      "SAF Guards tab — awarded on conversion into a Guards unit, recognised for rapid, aggressive light-infantry doctrine. Earned by completing Guards conversion training.",
    howToEarn:
      "OPERATION: STRONGPOINT ASSAULT — fight through all four layered objectives at Pasir Panjang Terminal, ending at Bukit Chandu, inside the mission clock.",
  },

  parachutist: {
    id: "parachutist",
    name: "Parachutist Wings (Airborne)",
    category: "wings",
    wear: "Left chest, above pocket.",
    challengeId: "op_airborne_insertion",
    meritReward: 700,
    perk: "No fall damage; faster deploy after insertion.",
    tiers: ["Basic Parachutist", "Commando Parachutist (red backing)", "Jumpmaster (yellow backing)"],
    realLife:
      "Basic Airborne Course (BAC) wings — the SAF's static-line parachute qualification, earned at the Airborne School. Backing colour denotes type: none = basic, red = commando, black = diver, yellow = jumpmaster.",
    howToEarn: "Complete airborne-insertion drops; tiers unlock at 1 / 5 / 15 successful drops.",
  },

  freefall: {
    id: "freefall",
    name: "Combat Free Fall Wings (HALO/HAHO)",
    category: "wings",
    wear: "Left chest, above pocket.",
    challengeId: "op_halo_insertion",
    meritReward: 900,
    perk: "Silent insertion: start a wave undetected (enemies unaware for 15s).",
    realLife:
      "Combat Free Fall wings (HALO/HAHO) — high-altitude military freefall qualification for covert insertion, well above the basic static-line jump.",
    howToEarn: "Nail a high-altitude drop challenge onto a marked landing zone.",
  },

  combat_diver: {
    id: "combat_diver",
    name: "Combat Diver Badge",
    category: "badge",
    wear: "Left chest, above pocket.",
    challengeId: "op_amphibious",
    meritReward: 800,
    perk: "Amphibious: full move speed + weapon handling in/near water.",
    realLife:
      "Combat Diver badge — underwater combat proficiency in the Naval Diving Unit lineage, one of the SAF's most selective specialist quals.",
    howToEarn: "Complete an amphibious/coastal objective, infiltrating via the water.",
  },

  sniper: {
    id: "sniper",
    name: "Marksmanship Badge",
    category: "badge",
    wear: "Left chest, above pocket.",
    challengeId: "op_precision",
    meritReward: 500,
    perk: "Precision: −30% scope sway, faster ADS on DMR/sniper.",
    tiers: ["Marksman", "Sharpshooter", "Sniper"],
    realLife:
      "SAF Marksmanship badge — shooting-proficiency recognition earned through live-fire qualification scoring in the top marksmanship band.",
    howToEarn: "Rack up long-range/headshot kills with precision weapons; tiers unlock at 25 / 75 / 150.",
  },

  commando: {
    id: "commando",
    name: "Commando (Red Beret)",
    category: "beret",
    wear: "Headgear (beret colour denotes formation).",
    challengeId: "op_commando_selection",
    meritReward: 1500,
    perk: "Elite: +10% damage resistance and stacks with all other badge perks.",
    realLife:
      "SAF Commando Formation, signature maroon/red beret — among the most selective units in the SAF, earned by passing Commando selection and the full commando course.",
    howToEarn: "Capstone Op. Requires Ranger + Parachutist already earned, then survive an elite gauntlet on the hardest difficulty.",
  },
};

/**
 * CHALLENGE OPS — the missions that award badges. These sit alongside the
 * survival waves as optional objectives selectable from the Armoury.
 */
export const CHALLENGE_OPS: Record<string, { name: string; badgeId: string; brief: string }> = {
  op_ranger_gauntlet: { name: "Op: Ranger Gauntlet", badgeId: "ranger", brief: "18 waves at Pasir Panjang Terminal. No resupply, no armour, no support." },
  op_guards_assault: { name: "Op: Guards Assault", badgeId: "guards", brief: "Take four layered objectives across Pasir Panjang Terminal, ending at Bukit Chandu." },
  op_airborne_insertion: { name: "Op: Airborne Insertion", badgeId: "parachutist", brief: "Parachute onto the drop zone and secure it. (Tiers at 1/5/15 drops.)" },
  op_halo_insertion: { name: "Op: HALO Insertion", badgeId: "freefall", brief: "High-altitude freefall onto a marked covert LZ." },
  op_amphibious: { name: "Op: Amphibious Raid", badgeId: "combat_diver", brief: "Infiltrate a coastal objective via water." },
  op_precision: { name: "Op: Precision Shoot", badgeId: "sniper", brief: "Rack up long-range/headshot kills. (Tiers at 25/75/150.)" },
  op_commando_selection: { name: "Op: Commando Selection", badgeId: "commando", brief: "Capstone. Requires Ranger + Parachutist. Elite gauntlet, high difficulty." },
};
