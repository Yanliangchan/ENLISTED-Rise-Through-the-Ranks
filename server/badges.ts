import type { PoolClient } from "pg";

/** Snapshot handed to badge checks: the just-updated lifetime totals plus this match's own deltas. */
export interface BadgeCheckInput {
  lifetime: {
    kills: number;
    headshots: number;
    gamesPlayed: number;
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
