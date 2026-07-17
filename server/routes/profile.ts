import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { queryOne, query } from "../db.js";
import { loadProfile } from "../profile.js";
import { rankForXp, CFC_INDEX, CAREER_PATHS, type CareerPath } from "../ranks.js";
import { asyncHandler } from "../asyncHandler.js";

export const profileRouter = Router();

/**
 * POST /api/profile/career-path { path } — one-time SAF career-path choice.
 * Allowed only once the player has reached Corporal First Class (the SAF
 * career gate) and only if a path hasn't already been chosen — future
 * promotions then automatically follow that track's ladder (see
 * server/ranks.ts rankForXp). Guardian tooling can override via
 * POST /api/guardian/career-path.
 */
profileRouter.post(
  "/profile/career-path",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const path = String(req.body?.path ?? "") as CareerPath;
    if (!(path in CAREER_PATHS)) {
      res.status(400).json({ error: `path must be one of: ${Object.keys(CAREER_PATHS).join(", ")}` });
      return;
    }
    const userId = req.user!.sub;
    const existing = await queryOne<{ career_path: CareerPath | null }>("SELECT career_path FROM users WHERE id = $1", [userId]);
    if (existing?.career_path) {
      res.status(409).json({ error: "Career path already chosen." });
      return;
    }
    const progression = await queryOne<{ xp: string }>("SELECT xp FROM progression WHERE user_id = $1", [userId]);
    const xp = progression ? Number(progression.xp) : 0;
    if (rankForXp(xp, null).index < CFC_INDEX) {
      res.status(409).json({ error: "Reach Corporal First Class before choosing a career path." });
      return;
    }
    await query("UPDATE users SET career_path = $2 WHERE id = $1", [userId, path]);
    const profile = await loadProfile(userId);
    res.json({ ok: true, profile });
  })
);

/** GET /api/profile — the logged-in user's own full profile. */
profileRouter.get(
  "/profile",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const profile = await loadProfile(req.user!.sub);
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json(profile);
  })
);

/**
 * GET /api/profile/:username — public read-only view of any operator's
 * profile (no auth required), for leaderboard click-through. Save/settings
 * are stripped since those are private to the owner.
 */
profileRouter.get(
  "/profile/:username",
  asyncHandler(async (req, res) => {
    const user = await queryOne<{ id: number }>("SELECT id FROM users WHERE username_lower = $1", [
      req.params.username.toLowerCase(),
    ]);
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const profile = await loadProfile(user.id);
    if (!profile) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const { save: _save, settings: _settings, ...publicProfile } = profile;
    res.json(publicProfile);
  })
);
