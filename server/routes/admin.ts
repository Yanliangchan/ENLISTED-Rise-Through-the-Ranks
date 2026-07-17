import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { rateLimit } from "../rateLimit.js";

export const adminRouter = Router();

/**
 * POST /api/admin/verify — validates a code the client only prompts for after
 * a hidden key sequence, against ADMIN_CODE (set as a Railway env var; never
 * shipped in the client bundle). Stateless: on match, the client unlocks
 * everything locally for the rest of the session — this endpoint is purely
 * the secret check, not a persisted account flag. Rate-limited since it's a
 * fixed-length secret check reachable without auth.
 */
adminRouter.post("/verify", rateLimit(10, 5 * 60_000), asyncHandler(async (req, res) => {
  const code = String(req.body?.code ?? "");
  const expected = process.env.ADMIN_CODE;
  if (!expected) {
    res.status(503).json({ ok: false });
    return;
  }
  res.json({ ok: code.length > 0 && code === expected });
}));
