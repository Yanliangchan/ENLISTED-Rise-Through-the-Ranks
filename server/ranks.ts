/**
 * Rank ladder + XP economy. Ranks are derived from `xp` at read time (never
 * stored) so re-tuning thresholds or adding a rank is a code change here, not
 * a database migration. Themed on real SAF rank names to match the rest of
 * the game's authenticity (see data/weapons.ts).
 */
export interface RankDef {
  name: string;
  abbr: string;
  xp: number;
}

// Stops at Corporal First Class — the SAF career-path gate. Every rank above
// CFC belongs to CAREER_PATHS below instead, once a track is chosen.
export const RANKS: RankDef[] = [
  { name: "Recruit", abbr: "REC", xp: 0 },
  { name: "Private", abbr: "PTE", xp: 400 },
  { name: "Private (1CL)", abbr: "PTE(1)", xp: 1000 },
  { name: "Lance Corporal", abbr: "LCP", xp: 2000 },
  { name: "Corporal", abbr: "CPL", xp: 3400 },
  { name: "Corporal First Class", abbr: "CFC", xp: 5200 },
];

export interface RankProgress {
  name: string;
  /** Short rank-insignia abbreviation, e.g. "CPT", "ME4", "3SG" — for leaderboard/nameplate display. */
  insignia: string;
  index: number;
  xp: number;
  xpIntoRank: number;
  /** XP needed for the next rank, or null when already at the top rank. */
  xpForNextRank: number | null;
  /** True once the player has reached CFC and must pick a career path to rank further. */
  atCareerGate: boolean;
}

/** Index of Corporal First Class in RANKS — the SAF career-path gate. */
export const CFC_INDEX = RANKS.findIndex((r) => r.name === "Corporal First Class");

export type CareerPath = "officer" | "specialist" | "me";

export interface CareerRankDef {
  name: string;
  insignia: string;
  xp: number; // total career xp (continues from CFC's xp) required to hold this rank
}

/**
 * Post-CFC SAF-inspired ladders. Each track continues the same xp scale as
 * RANKS (so xpForMatch/xp totals never need re-basing) — index 0 of each
 * ladder is the first rank *above* CFC, awarded the moment a track is chosen.
 */
export const CAREER_PATHS: Record<CareerPath, CareerRankDef[]> = {
  officer: [
    { name: "Officer Cadet", insignia: "OCT", xp: 6500 },
    { name: "2nd Lieutenant", insignia: "2LT", xp: 9000 },
    { name: "Lieutenant", insignia: "LTA", xp: 13000 },
    { name: "Captain", insignia: "CPT", xp: 19000 },
    { name: "Major", insignia: "MAJ", xp: 28000 },
    { name: "Lieutenant Colonel", insignia: "LTC", xp: 40000 },
    { name: "Colonel", insignia: "COL", xp: 55000 },
  ],
  specialist: [
    { name: "3rd Sergeant", insignia: "3SG", xp: 6500 },
    { name: "2nd Sergeant", insignia: "2SG", xp: 8500 },
    { name: "1st Sergeant", insignia: "1SG", xp: 11500 },
    { name: "Staff Sergeant", insignia: "SSG", xp: 15500 },
    { name: "Master Sergeant", insignia: "MSG", xp: 20500 },
    { name: "3rd Warrant Officer", insignia: "3WO", xp: 27000 },
    { name: "2nd Warrant Officer", insignia: "2WO", xp: 34000 },
    { name: "1st Warrant Officer", insignia: "1WO", xp: 42000 },
    { name: "Master Warrant Officer", insignia: "MWO", xp: 51000 },
    { name: "Senior Warrant Officer", insignia: "SWO", xp: 61000 },
    { name: "Chief Warrant Officer", insignia: "CWO", xp: 72000 },
  ],
  me: [
    { name: "Military Expert 1", insignia: "ME1", xp: 6500 },
    { name: "Military Expert 2", insignia: "ME2", xp: 8500 },
    { name: "Military Expert 3", insignia: "ME3", xp: 11000 },
    { name: "Military Expert 4", insignia: "ME4", xp: 14500 },
    { name: "Military Expert 5", insignia: "ME5", xp: 19000 },
    { name: "Military Expert 6", insignia: "ME6", xp: 25000 },
    { name: "Military Expert 7", insignia: "ME7", xp: 32000 },
    { name: "Military Expert 8", insignia: "ME8", xp: 40000 },
  ],
};

export function careerPathLabel(path: CareerPath): string {
  return path === "officer" ? "Officer" : path === "specialist" ? "Specialist (WOSpec)" : "Military Expert";
}

/**
 * Rank a player holds given their total xp and (once chosen) career path.
 * Below CFC, or with no path chosen yet, this is identical to the flat RANKS
 * ladder and caps at CFC — `atCareerGate` tells the client to prompt for a
 * path once it goes true.
 */
export function rankForXp(xp: number, careerPath?: CareerPath | null): RankProgress {
  let index = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].xp) {
      index = i;
      break;
    }
  }

  if (index < CFC_INDEX || !careerPath) {
    const next = index >= CFC_INDEX ? null : RANKS[index + 1];
    return {
      name: RANKS[index].name,
      insignia: RANKS[index].abbr,
      index,
      xp,
      xpIntoRank: xp - RANKS[index].xp,
      xpForNextRank: next ? next.xp - RANKS[index].xp : null,
      atCareerGate: index >= CFC_INDEX && !careerPath,
    };
  }

  const ladder = CAREER_PATHS[careerPath];
  let ladderIndex = -1;
  for (let i = ladder.length - 1; i >= 0; i--) {
    if (xp >= ladder[i].xp) {
      ladderIndex = i;
      break;
    }
  }
  if (ladderIndex < 0) {
    // Path just chosen, not yet enough xp for the first career rank — still CFC.
    const first = ladder[0];
    return {
      name: RANKS[CFC_INDEX].name,
      insignia: RANKS[CFC_INDEX].abbr,
      index: CFC_INDEX,
      xp,
      xpIntoRank: xp - RANKS[CFC_INDEX].xp,
      xpForNextRank: first.xp - RANKS[CFC_INDEX].xp,
      atCareerGate: false,
    };
  }
  const rank = ladder[ladderIndex];
  const next = ladder[ladderIndex + 1] ?? null;
  return {
    name: `${rank.name} (${rank.insignia})`,
    insignia: rank.insignia,
    index: CFC_INDEX + 1 + ladderIndex,
    xp,
    xpIntoRank: xp - rank.xp,
    xpForNextRank: next ? next.xp - rank.xp : null,
    atCareerGate: false,
  };
}

export interface MatchXpInput {
  kills: number;
  headshots: number;
  waveReached: number;
  creditsEarned: number;
}

/**
 * XP awarded for one completed deployment. Kept as one pure function so the
 * economy can be re-tuned in one place. Coefficients trimmed ~25-30% from
 * their original values (progression rebalance) so rank-ups and end-game
 * career milestones take meaningfully longer to reach.
 */
export function xpForMatch(m: MatchXpInput): number {
  return Math.round(m.kills * 7 + m.headshots * 11 + m.waveReached * 18 + m.creditsEarned / 13);
}

/** Weapon class -> display label for the "career track" derived from kills-by-class. */
const CAREER_TRACK_LABELS: Record<string, string> = {
  rifle: "Rifleman",
  pistol: "Sidearm Specialist",
  dmr: "Marksman",
  sniper: "Marksman",
  lmg: "Support Gunner",
  hmg: "Support Gunner",
  launcher: "Anti-Armour",
};

/** The weapon class with the most lifetime kills, mapped to a career label. Empty/unknown -> "Rifleman". */
export function careerTrackFor(killsByClass: Record<string, number>): string {
  let bestClass: string | null = null;
  let bestKills = 0;
  for (const [cls, kills] of Object.entries(killsByClass)) {
    if (kills > bestKills) {
      bestKills = kills;
      bestClass = cls;
    }
  }
  if (!bestClass) return "Rifleman";
  return CAREER_TRACK_LABELS[bestClass] ?? "Rifleman";
}
