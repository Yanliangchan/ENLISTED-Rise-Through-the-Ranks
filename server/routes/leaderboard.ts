import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

export const leaderboardRouter = Router();

const VALID_CATEGORIES = new Set(["highest_wave", "total_kills", "best_game_kills"]);

/** GET /api/leaderboard/:category?limit=50 — top N from the precomputed cache. Public, no auth. */
leaderboardRouter.get(
  "/leaderboard/:category",
  asyncHandler(async (req, res) => {
    const category = req.params.category;
    if (!VALID_CATEGORIES.has(category)) {
      res.status(400).json({ error: `Unknown category. Valid: ${[...VALID_CATEGORIES].join(", ")}` });
      return;
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await query<{ rank: number; username: string; value: string }>(
      "SELECT rank, username, value FROM leaderboard_cache WHERE category = $1 ORDER BY rank LIMIT $2",
      [category, limit]
    );
    res.json({ category, entries: rows.map((r) => ({ rank: r.rank, username: r.username, value: Number(r.value) })) });
  })
);
