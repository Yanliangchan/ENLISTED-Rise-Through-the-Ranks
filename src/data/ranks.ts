/**
 * ranks.ts — AUTHORITATIVE RANK DATA (SAF-accurate structure)
 *
 * The SAF is NOT a single ladder. Everyone starts as an Enlistee (Other Ranks).
 * After a "Streaming Board" (mirrors post-BMT streaming), the player forks into
 * ONE career track: Specialist (NCO), Officer (commissioned), or Military Expert
 * (MDES / DIS tech track). The Warrant Officer ranks are the senior continuation
 * of the Specialist track (top specialists convert to 3WO).
 *
 * `abbr` and rank names are real. `meritRequired` is CUMULATIVE merit (XP) to
 * reach that rank. Merit is earned per kill/headshot/wave/objective/challenge
 * (see MERIT below). Perks are game values — tune freely.
 *
 * This is the reference/planning data model for the career-track system —
 * see ProfilePage.ts's "SAF Career Ladder" section for where it's surfaced.
 * The live server-computed rank shown elsewhere in the profile (`Profile.rank`
 * in Backend.ts) uses its own simpler XP economy; the two aren't numerically
 * unified yet (see the session notes for that follow-up).
 */

export type Track =
  | "enlistee"
  | "specialist"
  | "warrant"
  | "officer"
  | "military_expert";

export interface Rank {
  id: string;
  name: string;
  abbr: string;
  track: Track;
  tier: number; // order within the track
  meritRequired: number; // cumulative merit to reach this rank
  creditMultiplier: number; // multiplies credits earned in-game
  perk: string; // gameplay perk unlocked at this rank
}

export const MERIT = {
  perKill: 10,
  headshotBonus: 5,
  waveClear: 100,
  objective: 50,
  // Challenge Ops (badge missions) grant larger lump sums — see badges.ts.
};

/**
 * STREAMING: at CPL (Other Ranks) the Streaming Board opens. The player picks a
 * track. Gates reflect reality — the Officer track has the highest bar.
 */
export const STREAMING = {
  opensAtRankId: "cpl",
  opensAtMerit: 1000,
  gates: {
    // Specialist Cadet School: complete the SCS trial challenge.
    specialist: { minMerit: 1000, requiresChallenge: "trial_scs" },
    // Officer Cadet School: highest bar — merit + the OCS trial + min accuracy.
    officer: { minMerit: 1500, requiresChallenge: "trial_ocs", minAccuracyPct: 45 },
    // Military Domain Experts Scheme (DIS / technical track).
    military_expert: { minMerit: 1200, requiresChallenge: "trial_mdes" },
  },
};

export const RANKS: Rank[] = [
  // ============================ ENLISTEE (Other Ranks) ============================
  { id: "rec", name: "Recruit", abbr: "REC", track: "enlistee", tier: 0, meritRequired: 0, creditMultiplier: 1.0, perk: "Starter loadout: SAR 21 + P30 + 2× SFG 87." },
  { id: "pte", name: "Private", abbr: "PTE", track: "enlistee", tier: 1, meritRequired: 100, creditMultiplier: 1.0, perk: "+10% reserve ammo." },
  { id: "pfc", name: "Private First Class", abbr: "PFC", track: "enlistee", tier: 2, meritRequired: 300, creditMultiplier: 1.05, perk: "Unlock armoury tier 1 (Red Dot, foregrip)." },
  { id: "lcp", name: "Lance Corporal", abbr: "LCP", track: "enlistee", tier: 3, meritRequired: 600, creditMultiplier: 1.05, perk: "+1 throwable carry." },
  { id: "cpl", name: "Corporal", abbr: "CPL", track: "enlistee", tier: 4, meritRequired: 1000, creditMultiplier: 1.1, perk: "STREAMING BOARD opens — choose your track." },
  { id: "cfc", name: "Corporal First Class", abbr: "CFC", track: "enlistee", tier: 5, meritRequired: 1500, creditMultiplier: 1.1, perk: "Final Other-Ranks tier (if streaming deferred)." },

  // ============================ SPECIALIST (NCO) track ============================
  { id: "3sg", name: "Third Sergeant", abbr: "3SG", track: "specialist", tier: 0, meritRequired: 1000, creditMultiplier: 1.15, perk: "Faster reloads (−10%). Unlock armoury tier 2 (BR18, optics)." },
  { id: "2sg", name: "Second Sergeant", abbr: "2SG", track: "specialist", tier: 1, meritRequired: 2200, creditMultiplier: 1.2, perk: "+1 armour plate durability. Resupply caches refill faster." },
  { id: "1sg", name: "First Sergeant", abbr: "1SG", track: "specialist", tier: 2, meritRequired: 3800, creditMultiplier: 1.25, perk: "Unlock LMG tier (IAR 6940, FN MAG)." },
  { id: "ssg", name: "Staff Sergeant", abbr: "SSG", track: "specialist", tier: 3, meritRequired: 6000, creditMultiplier: 1.3, perk: "+15% throwable carry. Extended-mag discount." },
  { id: "msg", name: "Master Sergeant", abbr: "MSG", track: "specialist", tier: 4, meritRequired: 9000, creditMultiplier: 1.35, perk: "Top NCO. Eligible for Warrant conversion." },

  // ===================== WARRANT OFFICER (senior specialist) =====================
  { id: "3wo", name: "Third Warrant Officer", abbr: "3WO", track: "warrant", tier: 0, meritRequired: 9000, creditMultiplier: 1.4, perk: "Battle mentor: nearby friendly AI hit harder." },
  { id: "2wo", name: "Second Warrant Officer", abbr: "2WO", track: "warrant", tier: 1, meritRequired: 13000, creditMultiplier: 1.45, perk: "Unlock STK 50MG emplacement." },
  { id: "1wo", name: "First Warrant Officer", abbr: "1WO", track: "warrant", tier: 2, meritRequired: 18000, creditMultiplier: 1.5, perk: "Armoury master: all prices −10%." },
  { id: "mwo", name: "Master Warrant Officer", abbr: "MWO", track: "warrant", tier: 3, meritRequired: 24000, creditMultiplier: 1.55, perk: "'Encik' aura: squad morale — friendlies reload/revive faster." },
  { id: "swo", name: "Senior Warrant Officer", abbr: "SWO", track: "warrant", tier: 4, meritRequired: 32000, creditMultiplier: 1.6, perk: "Prestige tier." },
  { id: "cwo", name: "Chief Warrant Officer", abbr: "CWO", track: "warrant", tier: 5, meritRequired: 42000, creditMultiplier: 1.7, perk: "Apex WOSpec." },

  // ============================ OFFICER (commissioned) ============================
  { id: "oct", name: "Officer Cadet", abbr: "OCT", track: "officer", tier: 0, meritRequired: 1500, creditMultiplier: 1.15, perk: "In training — no command perks yet. Complete OCS to commission." },
  { id: "2lt", name: "Second Lieutenant", abbr: "2LT", track: "officer", tier: 1, meritRequired: 2000, creditMultiplier: 1.25, perk: "COMMISSIONED. Command 1 friendly AI rifleman." },
  { id: "lta", name: "Lieutenant", abbr: "LTA", track: "officer", tier: 2, meritRequired: 3600, creditMultiplier: 1.3, perk: "Command 2 friendly AI. Unlock optics tier." },
  { id: "cpt", name: "Captain", abbr: "CPT", track: "officer", tier: 3, meritRequired: 5500, creditMultiplier: 1.4, perk: "Call-in: 1 supply drop per wave (ammo/armour)." },
  { id: "maj", name: "Major", abbr: "MAJ", track: "officer", tier: 4, meritRequired: 8000, creditMultiplier: 1.5, perk: "Call-in: MATADOR resupply. Command 3 friendly AI." },
  { id: "ltc", name: "Lieutenant-Colonel", abbr: "LTC", track: "officer", tier: 5, meritRequired: 12000, creditMultiplier: 1.6, perk: "Call-in: mortar strike marker (1 per 2 waves)." },
  { id: "col", name: "Colonel", abbr: "COL", track: "officer", tier: 6, meritRequired: 17000, creditMultiplier: 1.7, perk: "Full command: 4 friendly AI, all call-ins." },
  { id: "bg", name: "Brigadier-General", abbr: "BG", track: "officer", tier: 7, meritRequired: 24000, creditMultiplier: 1.8, perk: "Flag-officer prestige." },
  { id: "mg", name: "Major-General", abbr: "MG", track: "officer", tier: 8, meritRequired: 34000, creditMultiplier: 1.9, perk: "Flag-officer prestige." },
  { id: "lg", name: "Lieutenant-General", abbr: "LG", track: "officer", tier: 9, meritRequired: 48000, creditMultiplier: 2.0, perk: "Apex commissioned rank." },

  // ============ MILITARY DOMAIN EXPERTS SCHEME (MDES / DIS tech track) ============
  // ME1–ME3 ≈ specialist/warrant level; ME4+ (Senior Military Experts) hold
  // commissioned-equivalent status. Perks are gadget/cyber-flavoured — a nod to
  // the Digital & Intelligence Service.
  { id: "me1", name: "Military Expert 1", abbr: "ME1", track: "military_expert", tier: 0, meritRequired: 1200, creditMultiplier: 1.15, perk: "Deploy a recon UAV (spots enemies) once per wave." },
  { id: "me2", name: "Military Expert 2", abbr: "ME2", track: "military_expert", tier: 1, meritRequired: 2400, creditMultiplier: 1.2, perk: "+2 tripflares. Hack OPFOR recon drones to disable them." },
  { id: "me3", name: "Military Expert 3", abbr: "ME3", track: "military_expert", tier: 2, meritRequired: 4200, creditMultiplier: 1.3, perk: "≈ Warrant status. UAV marks enemies for +damage." },
  { id: "me4", name: "Military Expert 4", abbr: "ME4", track: "military_expert", tier: 3, meritRequired: 6800, creditMultiplier: 1.4, perk: "SENIOR ME (commissioned-equivalent). Command 1 AI + gadgets." },
  { id: "me5", name: "Military Expert 5", abbr: "ME5", track: "military_expert", tier: 4, meritRequired: 10000, creditMultiplier: 1.5, perk: "Deploy an automated sentry turret." },
  { id: "me6", name: "Military Expert 6", abbr: "ME6", track: "military_expert", tier: 5, meritRequired: 15000, creditMultiplier: 1.6, perk: "Hijack an OPFOR heavy drone to fight for you." },
  { id: "me7", name: "Military Expert 7", abbr: "ME7", track: "military_expert", tier: 6, meritRequired: 22000, creditMultiplier: 1.75, perk: "Cyber-blackout: stun all enemy drones for a wave." },
  { id: "me8", name: "Military Expert 8", abbr: "ME8", track: "military_expert", tier: 7, meritRequired: 32000, creditMultiplier: 1.9, perk: "Apex ME. Full gadget suite." },
];

/** Helper: given a track + cumulative merit, return the current rank. */
export function currentRank(track: Track, merit: number): Rank {
  const inTrack = RANKS.filter((r) => r.track === track).sort((a, b) => a.meritRequired - b.meritRequired);
  let rank = inTrack[0];
  for (const r of inTrack) if (merit >= r.meritRequired) rank = r;
  return rank;
}
