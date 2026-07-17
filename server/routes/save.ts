import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { queryOne } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";

export const saveRouter = Router();

// Well above any legitimate save/settings blob (defense in depth beyond the
// server-wide 256kb express.json() body limit already applied in index.ts).
const MAX_BLOB_BYTES = 64 * 1024;

/** GET /api/save — the raw save+settings blobs (used on rare reconnect-without-login-response paths). */
saveRouter.get(
  "/save",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = await queryOne<{ save_data: unknown; settings: unknown }>(
      "SELECT save_data, settings FROM users WHERE id = $1",
      [req.user!.sub]
    );
    res.json({ save: row?.save_data ?? null, settings: row?.settings ?? null });
  })
);

/** PUT /api/save — full-snapshot upsert of the economy/loadout blob (credits, weapons, attachments, loadout). */
saveRouter.put(
  "/save",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const save = req.body?.save;
    if (typeof save !== "object" || save === null) {
      res.status(400).json({ error: "Missing save payload." });
      return;
    }
    const serialized = JSON.stringify(save);
    if (serialized.length > MAX_BLOB_BYTES) {
      res.status(413).json({ error: "Save payload too large." });
      return;
    }
    await queryOne("UPDATE users SET save_data = $2 WHERE id = $1", [req.user!.sub, serialized]);
    res.json({ ok: true });
  })
);

/** PUT /api/settings — sensitivity/volume blob. */
saveRouter.put(
  "/settings",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const settings = req.body?.settings;
    if (typeof settings !== "object" || settings === null) {
      res.status(400).json({ error: "Missing settings payload." });
      return;
    }
    const serialized = JSON.stringify(settings);
    if (serialized.length > MAX_BLOB_BYTES) {
      res.status(413).json({ error: "Settings payload too large." });
      return;
    }
    await queryOne("UPDATE users SET settings = $2 WHERE id = $1", [req.user!.sub, serialized]);
    res.json({ ok: true });
  })
);
