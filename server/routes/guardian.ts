import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { query, queryOne } from "../db.js";
import { loadProfile } from "../profile.js";
import { listBadgeCatalogueFor, grantBadgeByCode } from "../badges.js";
import { CAREER_PATHS, type CareerPath } from "../ranks.js";
import { asyncHandler } from "../asyncHandler.js";
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

/** POST /api/guardian/grant { username, code } — code-gated, sets a target account's guardian flag. */
guardianRouter.post(
  "/grant",
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
    const { save: _save, settings: _settings, ...publicProfile } = profile!;
    res.json({ ...publicProfile, guardian: user.guardian });
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
    const result = await query<{ username: string }>(
      "UPDATE users SET career_path = $2 WHERE username_lower = $1 RETURNING username",
      [String(req.body?.username ?? "").trim().toLowerCase(), path]
    );
    if (result.length === 0) {
      res.status(404).json({ error: "No such operator." });
      return;
    }
    res.json({ ok: true, username: result[0].username, path });
  })
);
