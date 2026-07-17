import { Router } from "express";
import { query } from "../db.js";
import { rankForXp, type CareerPath } from "../ranks.js";
import { asyncHandler } from "../asyncHandler.js";

export const leaderboardRouter = Router();

const VALID_CATEGORIES = new Set(["highest_wave", "total_kills", "best_game_kills"]);

/**
 * GET /api/leaderboard/:category?limit=50 — top N from the precomputed cache,
 * joined against each entry's current xp/career_path so rank insignia
 * ("CPT", "ME4", "3SG"...) can be shown before the username, per the
 * leaderboard format spec. Public, no auth.
 */
leaderboardRouter.get(
  "/leaderboard/:category",
  asyncHandler(async (req, res) => {
    const category = req.params.category;
    if (!VALID_CATEGORIES.has(category)) {
      res.status(400).json({ error: `Unknown category. Valid: ${[...VALID_CATEGORIES].join(", ")}` });
      return;
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await query<{ rank: number; username: string; value: string; xp: string | null; career_path: CareerPath | null }>(
      `SELECT lc.rank, lc.username, lc.value, p.xp, u.career_path
       FROM leaderboard_cache lc
       JOIN users u ON u.id = lc.user_id
       LEFT JOIN progression p ON p.user_id = lc.user_id
       WHERE lc.category = $1 ORDER BY lc.rank LIMIT $2`,
      [category, limit]
    );
    res.json({
      category,
      entries: rows.map((r) => {
        const rank = rankForXp(r.xp ? Number(r.xp) : 0, r.career_path);
        return { rank: r.rank, username: r.username, value: Number(r.value), rankInsignia: rank.insignia, rankName: rank.name };
      }),
    });
  })
);
