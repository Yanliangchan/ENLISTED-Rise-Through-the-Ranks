import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { withTransaction } from "../db.js";
import { loadProfile } from "../profile.js";
import { rankForXp, xpForMatch, type CareerPath } from "../ranks.js";
import { evaluateAndUnlockBadges, type UnlockedBadge } from "../badges.js";
import { asyncHandler } from "../asyncHandler.js";

export const matchesRouter = Router();

interface MatchPayload {
  waveReached: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  creditsEarned: number;
  durationSec: number;
  killsByClass: Record<string, number>;
}

function toNonNegInt(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function sanitize(body: unknown): MatchPayload {
  const b = (body ?? {}) as Record<string, unknown>;
  const killsByClassRaw = (b.killsByClass ?? {}) as Record<string, unknown>;
  const killsByClass: Record<string, number> = {};
  for (const [cls, count] of Object.entries(killsByClassRaw)) {
    const n = toNonNegInt(count);
    if (n > 0) killsByClass[cls] = n;
  }
  return {
    waveReached: toNonNegInt(b.waveReached),
    kills: toNonNegInt(b.kills),
    headshots: toNonNegInt(b.headshots),
    shotsFired: toNonNegInt(b.shotsFired),
    shotsHit: toNonNegInt(b.shotsHit),
    creditsEarned: toNonNegInt(b.creditsEarned),
    durationSec: toNonNegInt(b.durationSec),
    killsByClass,
  };
}

const LEADERBOARD_CATEGORIES: Array<{ category: string; column: string }> = [
  { category: "highest_wave", column: "highest_wave" },
  { category: "total_kills", column: "kills" },
  { category: "best_game_kills", column: "best_game_kills" },
];

/**
 * POST /api/matches — save the results of one completed deployment. This is
 * the single write path for player_stats: it increments the lifetime
 * aggregates by this match's deltas (never trusts a client-submitted lifetime
 * total), awards XP, unlocks badges, and refreshes the leaderboard cache — all
 * in one transaction so a crash mid-request can't leave stats and XP out of
 * sync.
 */
matchesRouter.post("/matches", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const userId = req.user!.sub;
  const m = sanitize(req.body);

  const result = await withTransaction(async (client) => {
    // Lock the row for the duration of the transaction so two concurrent
    // match submissions from the same account (e.g. a duplicate retry) can't
    // both read the same starting totals and double-count.
    const before = await client.query<{
      games_played: number;
      kills: number;
      headshots: number;
      highest_wave: number;
      best_game_kills: number;
      career_kills_by_class: Record<string, number>;
    }>("SELECT games_played, kills, headshots, highest_wave, best_game_kills, career_kills_by_class FROM player_stats WHERE user_id = $1 FOR UPDATE", [userId]);
    const prevStats = before.rows[0];

    const mergedKillsByClass = { ...(prevStats?.career_kills_by_class ?? {}) };
    for (const [cls, count] of Object.entries(m.killsByClass)) {
      mergedKillsByClass[cls] = (mergedKillsByClass[cls] ?? 0) + count;
    }

    const updatedStats = await client.query<{
      games_played: number;
      kills: number;
      headshots: number;
      highest_wave: number;
      best_game_kills: number;
    }>(
      `UPDATE player_stats SET
         games_played = games_played + 1,
         kills = kills + $2,
         headshots = headshots + $3,
         shots_fired = shots_fired + $4,
         shots_hit = shots_hit + $5,
         waves_cleared = waves_cleared + $6,
         highest_wave = GREATEST(highest_wave, $7),
         best_game_kills = GREATEST(best_game_kills, $2),
         deaths = deaths + 1,
         credits_earned = credits_earned + $8,
         playtime_sec = playtime_sec + $9,
         career_kills_by_class = $10::jsonb,
         updated_at = now()
       WHERE user_id = $1
       RETURNING games_played, kills, headshots, highest_wave, best_game_kills`,
      [
        userId,
        m.kills,
        m.headshots,
        m.shotsFired,
        m.shotsHit,
        // A "wave cleared" count isn't directly in the payload — waveReached
        // approximates cleared waves as (reached - 1) since the match ends on
        // the wave the player died in, never having cleared it.
        Math.max(0, m.waveReached - 1),
        m.waveReached,
        m.creditsEarned,
        m.durationSec,
        JSON.stringify(mergedKillsByClass),
      ]
    );
    const stats = updatedStats.rows[0];

    const xpGained = xpForMatch(m);
    const progRows = await client.query<{ xp: string }>(
      "UPDATE progression SET xp = xp + $2, updated_at = now() WHERE user_id = $1 RETURNING xp",
      [userId, xpGained]
    );
    const xpBefore = Number(progRows.rows[0].xp) - xpGained;
    const xpAfter = Number(progRows.rows[0].xp);
    const careerPathRow = await client.query<{ career_path: CareerPath | null }>(
      "SELECT career_path FROM users WHERE id = $1",
      [userId]
    );
    const careerPath = careerPathRow.rows[0]?.career_path ?? null;
    const rankBefore = rankForXp(xpBefore, careerPath);
    const rankAfter = rankForXp(xpAfter, careerPath);

    await client.query(
      `INSERT INTO match_history
         (user_id, wave_reached, kills, headshots, shots_fired, shots_hit, credits_earned, duration_sec, xp_gained)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, m.waveReached, m.kills, m.headshots, m.shotsFired, m.shotsHit, m.creditsEarned, m.durationSec, xpGained]
    );

    const newBadges: UnlockedBadge[] = await evaluateAndUnlockBadges(client, userId, {
      lifetime: { kills: stats.kills, headshots: stats.headshots, gamesPlayed: stats.games_played },
      match: { kills: m.kills, waveReached: m.waveReached, shotsFired: m.shotsFired, shotsHit: m.shotsHit },
    });

    for (const { category, column } of LEADERBOARD_CATEGORIES) {
      await client.query("DELETE FROM leaderboard_cache WHERE category = $1", [category]);
      await client.query(
        `INSERT INTO leaderboard_cache (category, rank, user_id, username, value)
         SELECT $1, ROW_NUMBER() OVER (ORDER BY ps.${column} DESC), u.id, u.username, ps.${column}
         FROM player_stats ps JOIN users u ON u.id = ps.user_id
         WHERE ps.${column} > 0
         ORDER BY ps.${column} DESC
         LIMIT 100`,
        [category]
      );
    }

    return {
      xpGained,
      newBadges,
      rankUp: rankAfter.index > rankBefore.index ? { from: rankBefore.name, to: rankAfter.name } : null,
    };
  });

  const profile = await loadProfile(userId);
  res.json({ ...result, profile });
}));

interface MpPayload {
  mode: "tdm" | "elim";
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  durationSec: number;
}

function sanitizeMp(body: unknown): MpPayload {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    mode: b.mode === "elim" ? "elim" : "tdm",
    won: b.won === true,
    kills: toNonNegInt(b.kills),
    deaths: toNonNegInt(b.deaths),
    assists: toNonNegInt(b.assists),
    headshots: toNonNegInt(b.headshots),
    shotsFired: toNonNegInt(b.shotsFired),
    shotsHit: toNonNegInt(b.shotsHit),
    durationSec: Math.min(3600, toNonNegInt(b.durationSec)),
  };
}

/**
 * POST /api/matches/mp — record the results of one private multiplayer match.
 * Multiplayer is progression-free by design (no currency, no XP awarded) —
 * this endpoint still increments the same lifetime player_stats aggregates as
 * wave mode (by the real MP deaths, without touching wave-only columns),
 * evaluates badges, and refreshes the leaderboard, all in one transaction.
 * The authoritative result comes from the game server; the client relays its
 * own row here.
 */
matchesRouter.post("/matches/mp", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const userId = req.user!.sub;
  const m = sanitizeMp(req.body);
  const currency = 0;
  const xpGained = 0;

  const result = await withTransaction(async (client) => {
    const before = await client.query<{ kills: number; headshots: number; games_played: number }>(
      "SELECT kills, headshots, games_played FROM player_stats WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    void before;
    const updated = await client.query<{ kills: number; headshots: number; games_played: number }>(
      `UPDATE player_stats SET
         games_played = games_played + 1,
         kills = kills + $2,
         headshots = headshots + $3,
         shots_fired = shots_fired + $4,
         shots_hit = shots_hit + $5,
         best_game_kills = GREATEST(best_game_kills, $2),
         deaths = deaths + $6,
         credits_earned = credits_earned + $7,
         playtime_sec = playtime_sec + $8,
         updated_at = now()
       WHERE user_id = $1
       RETURNING kills, headshots, games_played`,
      [userId, m.kills, m.headshots, m.shotsFired, m.shotsHit, m.deaths, currency, m.durationSec]
    );
    const stats = updated.rows[0];

    const progRows = await client.query<{ xp: string }>(
      "UPDATE progression SET xp = xp + $2, updated_at = now() WHERE user_id = $1 RETURNING xp",
      [userId, xpGained]
    );
    const xpAfter = Number(progRows.rows[0].xp);
    const xpBefore = xpAfter - xpGained;
    const careerPathRow = await client.query<{ career_path: CareerPath | null }>("SELECT career_path FROM users WHERE id = $1", [userId]);
    const careerPath = careerPathRow.rows[0]?.career_path ?? null;
    const rankBefore = rankForXp(xpBefore, careerPath);
    const rankAfter = rankForXp(xpAfter, careerPath);

    await client.query(
      `INSERT INTO match_history
         (user_id, wave_reached, kills, headshots, shots_fired, shots_hit, credits_earned, duration_sec, xp_gained)
       VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, m.kills, m.headshots, m.shotsFired, m.shotsHit, currency, m.durationSec, xpGained]
    );

    const newBadges: UnlockedBadge[] = await evaluateAndUnlockBadges(client, userId, {
      lifetime: { kills: stats.kills, headshots: stats.headshots, gamesPlayed: stats.games_played },
      match: { kills: m.kills, waveReached: 0, shotsFired: m.shotsFired, shotsHit: m.shotsHit },
    });

    for (const { category, column } of LEADERBOARD_CATEGORIES) {
      await client.query("DELETE FROM leaderboard_cache WHERE category = $1", [category]);
      await client.query(
        `INSERT INTO leaderboard_cache (category, rank, user_id, username, value)
         SELECT $1, ROW_NUMBER() OVER (ORDER BY ps.${column} DESC), u.id, u.username, ps.${column}
         FROM player_stats ps JOIN users u ON u.id = ps.user_id
         WHERE ps.${column} > 0
         ORDER BY ps.${column} DESC
         LIMIT 100`,
        [category]
      );
    }

    return {
      xpGained,
      currency,
      newBadges,
      rankUp: rankAfter.index > rankBefore.index ? { from: rankBefore.name, to: rankAfter.name } : null,
    };
  });

  const profile = await loadProfile(userId);
  res.json({ ...result, profile });
}));
