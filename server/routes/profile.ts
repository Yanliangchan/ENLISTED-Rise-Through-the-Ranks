import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { queryOne } from "../db.js";
import { loadProfile } from "../profile.js";
import { asyncHandler } from "../asyncHandler.js";

export const profileRouter = Router();

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
