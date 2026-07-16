/**
 * Rank ladder + XP economy. Ranks are derived from `xp` at read time (never
 * stored) so re-tuning thresholds or adding a rank is a code change here, not
 * a database migration. Themed on real SAF rank names to match the rest of
 * the game's authenticity (see data/weapons.ts).
 */
export interface RankDef {
  name: string;
  xp: number;
}

export const RANKS: RankDef[] = [
  { name: "Recruit", xp: 0 },
  { name: "Private", xp: 400 },
  { name: "Private (1CL)", xp: 1000 },
  { name: "Lance Corporal", xp: 2000 },
  { name: "Corporal", xp: 3400 },
  { name: "Corporal First Class", xp: 5200 },
  { name: "3rd Sergeant", xp: 7500 },
  { name: "2nd Sergeant", xp: 10500 },
  { name: "1st Sergeant", xp: 14200 },
  { name: "Master Sergeant", xp: 18800 },
  { name: "2nd Lieutenant", xp: 24500 },
  { name: "Lieutenant", xp: 31500 },
  { name: "Captain", xp: 40000 },
  { name: "Major", xp: 50500 },
];

export interface RankProgress {
  name: string;
  index: number;
  xp: number;
  xpIntoRank: number;
  /** XP needed for the next rank, or null when already at the top rank. */
  xpForNextRank: number | null;
}

export function rankForXp(xp: number): RankProgress {
  let index = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].xp) {
      index = i;
      break;
    }
  }
  const next = RANKS[index + 1] ?? null;
  return {
    name: RANKS[index].name,
    index,
    xp,
    xpIntoRank: xp - RANKS[index].xp,
    xpForNextRank: next ? next.xp - RANKS[index].xp : null,
  };
}

export interface MatchXpInput {
  kills: number;
  headshots: number;
  waveReached: number;
  creditsEarned: number;
}

/** XP awarded for one completed deployment. Kept as one pure function so the economy can be re-tuned in one place. */
export function xpForMatch(m: MatchXpInput): number {
  return Math.round(m.kills * 10 + m.headshots * 15 + m.waveReached * 25 + m.creditsEarned / 10);
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
