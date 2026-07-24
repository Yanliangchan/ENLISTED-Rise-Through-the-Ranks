import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { query, queryOne } from "../db.js";
import { loadProfile } from "../profile.js";
import { listBadgeCatalogueFor, grantBadgeByCode, revokeBadgeByCode } from "../badges.js";
import { CAREER_PATHS, type CareerPath } from "../ranks.js";
import { asyncHandler } from "../asyncHandler.js";
import { rateLimit } from "../rateLimit.js";
import type { NextFunction, Response } from "express";

export const guardianRouter = Router();

/**
 * Guardian: a hidden, permission-gated tab for developers/moderators/testers.
 * The permission itself (`users.guardian`) is never self-service — it is set
 * out-of-band by whoever holds GUARDIAN_CODE (a Railway env var, same pattern
 * as ADMIN_CODE in routes/admin.ts), then persists on the account like any
 * other progression flag. Everything under this router additionally requires
 * that persisted flag, so a leaked GUARDIAN_CODE only grants/revokes access —
 * it can't itself moderate anyone.
 */
/** Pull the spendable credits out of a save blob, defaulting to 0. */
function creditsOf(save: unknown): number {
  const c = (save as { credits?: unknown } | null)?.credits;
  return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

async function requireGuardian(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const row = await queryOne<{ guardian: boolean }>("SELECT guardian FROM users WHERE id = $1", [req.user!.sub]);
  if (!row?.guardian) {
    res.status(403).json({ error: "Guardian access required." });
    return;
  }
  next();
}

/** GET /api/guardian/status — does the logged-in user have Guardian access? Client uses this to decide whether to render the tab at all. */
guardianRouter.get(
  "/status",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = await queryOne<{ guardian: boolean }>("SELECT guardian FROM users WHERE id = $1", [req.user!.sub]);
    res.json({ guardian: !!row?.guardian });
  })
);

/** POST /api/guardian/grant { username, code } — code-gated, sets a target account's guardian flag. Rate-limited (fixed-length secret check, reachable without auth). */
guardianRouter.post(
  "/grant",
  rateLimit(10, 5 * 60_000),
  asyncHandler(async (req, res) => {
    const expected = process.env.GUARDIAN_CODE;
    const code = String(req.body?.code ?? "");
    if (!expected) {
      res.status(503).json({ error: "Guardian grant is not configured." });
      return;
    }
    if (code.length === 0 || code !== expected) {
      res.status(403).json({ error: "Invalid code." });
      return;
    }
    const username = String(req.body?.username ?? "").trim();
    const result = await query<{ username: string }>(
      "UPDATE users SET guardian = TRUE WHERE username_lower = $1 RETURNING username",
      [username.toLowerCase()]
    );
    if (result.length === 0) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    res.json({ ok: true, username: result[0].username });
  })
);

guardianRouter.use(requireAuth, requireGuardian);

/** GET /api/guardian/lookup/:username — moderation view: full profile + guardian flag for a target operator. */
guardianRouter.get(
  "/lookup/:username",
  asyncHandler(async (req, res) => {
    const user = await queryOne<{ id: number; guardian: boolean }>(
      "SELECT id, guardian FROM users WHERE username_lower = $1",
      [req.params.username.toLowerCase()]
    );
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const profile = await loadProfile(user.id);
    const { save, settings: _settings, ...publicProfile } = profile!;
    // Surface just the spendable credits (from the save blob) without leaking
    // the whole save — the panel needs it to show + pre-fill the money field.
    res.json({ ...publicProfile, guardian: user.guardian, credits: creditsOf(save) });
  })
);

/** GET /api/guardian/badges/:username — full badge catalogue with the target's unlock state, for manual grant tooling. */
guardianRouter.get(
  "/badges/:username",
  asyncHandler(async (req, res) => {
    const user = await queryOne<{ id: number }>("SELECT id FROM users WHERE username_lower = $1", [
      req.params.username.toLowerCase(),
    ]);
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    res.json({ badges: await listBadgeCatalogueFor(user.id) });
  })
);

/** POST /api/guardian/badges/grant { username, code } — manually award a badge (Special/Support badges with no automatic check). */
guardianRouter.post(
  "/badges/grant",
  asyncHandler(async (req, res) => {
    const user = await queryOne<{ id: number }>("SELECT id FROM users WHERE username_lower = $1", [
      String(req.body?.username ?? "").trim().toLowerCase(),
    ]);
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const badge = await grantBadgeByCode(user.id, String(req.body?.code ?? ""));
    if (!badge) {
      res.status(404).json({ error: "Unknown badge code." });
      return;
    }
    res.json({ ok: true, badge });
  })
);

/** POST /api/guardian/badges/revoke { username, code } — remove an earned badge from an operator. */
guardianRouter.post(
  "/badges/revoke",
  asyncHandler(async (req, res) => {
    const user = await queryOne<{ id: number }>("SELECT id FROM users WHERE username_lower = $1", [
      String(req.body?.username ?? "").trim().toLowerCase(),
    ]);
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const badge = await revokeBadgeByCode(user.id, String(req.body?.code ?? ""));
    if (!badge) {
      res.status(404).json({ error: "Unknown badge code." });
      return;
    }
    res.json({ ok: true, badge });
  })
);

/** POST /api/guardian/xp { username, delta } — rank management: adjust a target operator's XP by a signed delta. */
guardianRouter.post(
  "/xp",
  asyncHandler(async (req, res) => {
    const delta = Math.round(Number(req.body?.delta));
    if (!Number.isFinite(delta)) {
      res.status(400).json({ error: "delta must be a finite number." });
      return;
    }
    const user = await queryOne<{ id: number }>("SELECT id FROM users WHERE username_lower = $1", [
      String(req.body?.username ?? "").trim().toLowerCase(),
    ]);
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const rows = await query<{ xp: string }>(
      "UPDATE progression SET xp = GREATEST(0, xp + $2), updated_at = now() WHERE user_id = $1 RETURNING xp",
      [user.id, delta]
    );
    res.json({ ok: true, xp: Number(rows[0].xp) });
  })
);

/** POST /api/guardian/career-path { username, path } — rank management: force-set a target's SAF career path. */
guardianRouter.post(
  "/career-path",
  asyncHandler(async (req, res) => {
    const path = String(req.body?.path ?? "") as CareerPath;
    if (!(path in CAREER_PATHS)) {
      res.status(400).json({ error: `path must be one of: ${Object.keys(CAREER_PATHS).join(", ")}` });
      return;
    }
    const user = await lookupUser(String(req.body?.username ?? ""));
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    await query("UPDATE users SET career_path = $2 WHERE id = $1", [user.id, path]);
    res.json({ ok: true, profile: await loadProfile(user.id) });
  })
);

// --- Full player-management console ---------------------------------------
// Every mutating endpoint below returns the freshly-reloaded profile so the
// Guardian panel reflects the change immediately (no restart / re-lookup).

/** Resolve a target user by username, returning id (+ current career_path). */
async function lookupUser(username: string): Promise<{ id: number } | null> {
  return queryOne<{ id: number }>("SELECT id FROM users WHERE username_lower = $1", [username.trim().toLowerCase()]);
}

/** POST /api/guardian/set-xp { username, xp } — set ABSOLUTE xp (rank recalculates from it on read). */
guardianRouter.post(
  "/set-xp",
  asyncHandler(async (req, res) => {
    const xp = Math.round(Number(req.body?.xp));
    if (!Number.isFinite(xp) || xp < 0) {
      res.status(400).json({ error: "xp must be a non-negative number." });
      return;
    }
    const user = await lookupUser(String(req.body?.username ?? ""));
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    await query(
      `INSERT INTO progression (user_id, xp) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET xp = $2, updated_at = now()`,
      [user.id, xp]
    );
    res.json({ ok: true, profile: await loadProfile(user.id) });
  })
);

/** Whitelisted editable combat-stat columns → request-body keys. */
const STAT_COLUMNS: Record<string, string> = {
  gamesPlayed: "games_played",
  kills: "kills",
  headshots: "headshots",
  shotsFired: "shots_fired",
  shotsHit: "shots_hit",
  highestWave: "highest_wave",
  bestGameKills: "best_game_kills",
  deaths: "deaths",
  creditsEarned: "credits_earned",
};

/** POST /api/guardian/stats { username, stats:{...} } — set any subset of the combat statistics. */
guardianRouter.post(
  "/stats",
  asyncHandler(async (req, res) => {
    const user = await lookupUser(String(req.body?.username ?? ""));
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    const stats = (req.body?.stats ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [user.id];
    for (const [key, col] of Object.entries(STAT_COLUMNS)) {
      if (stats[key] === undefined) continue;
      const n = Math.round(Number(stats[key]));
      if (!Number.isFinite(n) || n < 0) continue;
      vals.push(n);
      sets.push(`${col} = $${vals.length}`);
    }
    if (!sets.length) {
      res.status(400).json({ error: "No valid stat fields to update." });
      return;
    }
    // Ensure a row exists, then patch the requested columns.
    await query("INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [user.id]);
    await query(`UPDATE player_stats SET ${sets.join(", ")} WHERE user_id = $1`, vals);
    res.json({ ok: true, profile: await loadProfile(user.id) });
  })
);

/** POST /api/guardian/credits { username, credits } — set the operator's spendable currency (in save_data). */
guardianRouter.post(
  "/credits",
  asyncHandler(async (req, res) => {
    const credits = Math.round(Number(req.body?.credits));
    if (!Number.isFinite(credits) || credits < 0) {
      res.status(400).json({ error: "credits must be a non-negative number." });
      return;
    }
    const user = await lookupUser(String(req.body?.username ?? ""));
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    // Patch the credits field inside the save blob (coalescing a null save to {}).
    await query(
      "UPDATE users SET save_data = jsonb_set(COALESCE(save_data, '{}'::jsonb), '{credits}', to_jsonb($2::int), true) WHERE id = $1",
      [user.id, credits]
    );
    res.json({ ok: true, profile: await loadProfile(user.id), credits });
  })
);

/** POST /api/guardian/reset-stats { username } — zero all combat statistics (progression/badges untouched). */
guardianRouter.post(
  "/reset-stats",
  asyncHandler(async (req, res) => {
    const user = await lookupUser(String(req.body?.username ?? ""));
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    await query(
      `UPDATE player_stats SET games_played = 0, kills = 0, headshots = 0, shots_fired = 0, shots_hit = 0,
         waves_cleared = 0, highest_wave = 0, best_game_kills = 0, deaths = 0, credits_earned = 0,
         playtime_sec = 0, career_kills_by_class = '{}'::jsonb WHERE user_id = $1`,
      [user.id]
    );
    res.json({ ok: true, profile: await loadProfile(user.id) });
  })
);

/** POST /api/guardian/reset-progression { username } — full wipe: stats + XP + earned badges. */
guardianRouter.post(
  "/reset-progression",
  asyncHandler(async (req, res) => {
    const user = await lookupUser(String(req.body?.username ?? ""));
    if (!user) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    await query(
      `UPDATE player_stats SET games_played = 0, kills = 0, headshots = 0, shots_fired = 0, shots_hit = 0,
         waves_cleared = 0, highest_wave = 0, best_game_kills = 0, deaths = 0, credits_earned = 0,
         playtime_sec = 0, career_kills_by_class = '{}'::jsonb WHERE user_id = $1`,
      [user.id]
    );
    await query("UPDATE progression SET xp = 0, updated_at = now() WHERE user_id = $1", [user.id]);
    await query("DELETE FROM user_badges WHERE user_id = $1", [user.id]);
    res.json({ ok: true, profile: await loadProfile(user.id) });
  })
);
