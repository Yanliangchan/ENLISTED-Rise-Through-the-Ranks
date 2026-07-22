import type { PoolClient } from "pg";
import { query, queryOne } from "./db.js";

/** The 8 carried guns eligible for the Combat Skills badge — the MATADOR (a launcher, never a hitscan kill) is never in this list. */
export const COMBAT_SKILLS_WEAPON_ROSTER = ["sar21", "br18", "p30", "mp5k", "m110", "trg22", "fnmag", "colt_iar"];

/** Snapshot handed to badge checks: the just-updated lifetime totals plus this match's own deltas. */
export interface BadgeCheckInput {
  lifetime: {
    kills: number;
    headshots: number;
    gamesPlayed: number;
    killsByClass: Record<string, number>;
    killsByWeapon: Record<string, number>;
    explosiveKills: number;
    bottyHeals: number;
    airstrikeCalls: number;
    uavCalls: number;
    reconTouches: number;
  };
  match: {
    kills: number;
    waveReached: number;
    shotsFired: number;
    shotsHit: number;
  };
}

/**
 * Badge unlock conditions, keyed by the `code` seeded in badges.migration.
 * Adding a badge is: seed a new row in badges, add a case here — no schema
 * change. Kept as pure predicates over already-fetched data so this never
 * touches the DB itself.
 */
const BADGE_CHECKS: Record<string, (input: BadgeCheckInput) => boolean> = {
  first_blood: (i) => i.lifetime.kills >= 1,
  century: (i) => i.lifetime.kills >= 100,
  marksman: (i) => i.lifetime.headshots >= 100,
  veteran: (i) => i.lifetime.gamesPlayed >= 25,
  survivor: (i) => i.match.waveReached >= 10,
  deep_strike: (i) => i.match.waveReached >= 20,
  one_man_army: (i) => i.match.kills >= 50,
  sharpshooter: (i) => i.match.shotsFired >= 20 && i.match.shotsHit / i.match.shotsFired >= 0.8,
  // Progression tiers — same lifetime-kills data as century, just higher bars.
  kills_500: (i) => i.lifetime.kills >= 500,
  kills_1000: (i) => i.lifetime.kills >= 1000,
  kills_5000: (i) => i.lifetime.kills >= 5000,
  kills_10000: (i) => i.lifetime.kills >= 10000,
  headhunter: (i) => i.lifetime.headshots >= 500,
  // Skill-progression badges — genuinely earnable from stats the client now submits.
  combat_skills_basic: (i) => COMBAT_SKILLS_WEAPON_ROSTER.every((id) => (i.lifetime.killsByWeapon[id] ?? 0) >= 100),
  combat_skills_advanced: (i) => i.lifetime.kills >= 500,
  combat_skills_master: (i) => i.lifetime.kills >= 1500 && i.lifetime.explosiveKills >= 100,
  sniper_basic: (i) => (i.lifetime.killsByClass.sniper ?? 0) >= 500,
  sniper_advance: (i) => (i.lifetime.killsByClass.sniper ?? 0) >= 1000,
  sniper_master: (i) => (i.lifetime.killsByClass.sniper ?? 0) >= 2000,
  recon: (i) => i.lifetime.reconTouches >= 3,
  eod_basic: (i) => i.lifetime.explosiveKills >= 250,
  eod_advanced: (i) => i.lifetime.explosiveKills >= 500,
  eod_senior: (i) => i.lifetime.explosiveKills >= 1000,
  paramedic: (i) => i.lifetime.bottyHeals >= 200,
  adss: (i) => i.lifetime.airstrikeCalls >= 200,
  aiie: (i) => i.lifetime.uavCalls >= 300,
  // double_kill / triple_kill / quad_kill / killstreak_* / untouchable /
  // last_man_standing / medic / resupplier / engineer / defender need
  // per-match data (kill-window timing, damage-taken, revive/resupply counts)
  // the client doesn't submit yet — left unwired here, unlockable only via
  // the Guardian manual-grant tooling until that instrumentation lands.
  // guardian_badge / airborne_tab / ranger_tab / guards_tab /
  // commando_recognition / master_marksman / event_veteran / alpha_tester /
  // founder / event_winner are all manually granted (qualifications, events,
  // Guardian service) rather than auto-detected from gameplay stats.
};

export interface UnlockedBadge {
  code: string;
  name: string;
  icon: string;
}

/**
 * Evaluate every badge the user hasn't already unlocked and insert any newly
 * earned ones. Must run inside the same transaction as the player_stats
 * update it reads `input` from, so the check sees consistent data.
 */
export async function evaluateAndUnlockBadges(
  client: PoolClient,
  userId: number,
  input: BadgeCheckInput
): Promise<UnlockedBadge[]> {
  const { rows: catalogue } = await client.query<{ id: number; code: string; name: string; icon: string }>(
    "SELECT id, code, name, icon FROM badges"
  );
  const { rows: owned } = await client.query<{ badge_id: number }>(
    "SELECT badge_id FROM user_badges WHERE user_id = $1",
    [userId]
  );
  const ownedIds = new Set(owned.map((r) => r.badge_id));

  const unlocked: UnlockedBadge[] = [];
  for (const badge of catalogue) {
    if (ownedIds.has(badge.id)) continue;
    const check = BADGE_CHECKS[badge.code];
    if (!check || !check(input)) continue;
    await client.query(
      "INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, badge.id]
    );
    unlocked.push({ code: badge.code, name: badge.name, icon: badge.icon });
  }
  return unlocked;
}

/** Full badge catalogue with each user's unlock status — for Guardian's manual-grant tooling. */
export async function listBadgeCatalogueFor(userId: number): Promise<
  Array<{ code: string; name: string; description: string; icon: string; category: string; rarity: string; unlocked: boolean }>
> {
  const catalogue = await query<{ code: string; name: string; description: string; icon: string; category: string; rarity: string }>(
    "SELECT code, name, description, icon, category, rarity FROM badges ORDER BY category, rarity, name"
  );
  const owned = await query<{ code: string }>(
    "SELECT b.code FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = $1",
    [userId]
  );
  const ownedCodes = new Set(owned.map((r) => r.code));
  return catalogue.map((b) => ({ ...b, unlocked: ownedCodes.has(b.code) }));
}

/** Manually grant a badge by code (Guardian tooling) — no-op if already owned or code unknown. */
export async function grantBadgeByCode(userId: number, code: string): Promise<UnlockedBadge | null> {
  const badge = await queryOne<{ id: number; code: string; name: string; icon: string }>(
    "SELECT id, code, name, icon FROM badges WHERE code = $1",
    [code]
  );
  if (!badge) return null;
  await query("INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, badge.id]);
  return { code: badge.code, name: badge.name, icon: badge.icon };
}
