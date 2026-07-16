import { Router } from "express";
import { queryOne } from "../db.js";
import { signToken } from "../auth.js";
import { loadProfile } from "../profile.js";
import { asyncHandler } from "../asyncHandler.js";

export const authRouter = Router();

/** Username rules: 3-16 chars, letters/numbers/_/- — mirrors the client-side validator. */
function validateUsername(name: string): string | null {
  if (name.length < 3) return "Username must be at least 3 characters.";
  if (name.length > 16) return "Username must be at most 16 characters.";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "Use only letters, numbers, _ or -.";
  return null;
}

/**
 * POST /api/auth/login — find-or-create-and-login by username. No password:
 * this is deliberately the minimal "username-based account system" the spec
 * calls for, not a substitute for real credential auth. Returns a JWT the
 * client attaches to every subsequent request, plus the freshly-loaded profile
 * so the client doesn't need a second round trip.
 */
authRouter.post("/login", asyncHandler(async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const invalid = validateUsername(username);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const usernameLower = username.toLowerCase();

  let user = await queryOne<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE username_lower = $1",
    [usernameLower]
  );

  if (!user) {
    try {
      user = await queryOne<{ id: number; username: string }>(
        "INSERT INTO users (username, username_lower) VALUES ($1, $2) RETURNING id, username",
        [username, usernameLower]
      );
    } catch (err) {
      // Two simultaneous first-logins for the same new username — the loser
      // of the race just falls back to reading the row the winner created.
      if ((err as { code?: string }).code === "23505") {
        user = await queryOne<{ id: number; username: string }>(
          "SELECT id, username FROM users WHERE username_lower = $1",
          [usernameLower]
        );
      } else {
        throw err;
      }
    }
    if (!user) {
      res.status(500).json({ error: "Failed to create account." });
      return;
    }
    await queryOne("INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user.id]);
    await queryOne("INSERT INTO progression (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user.id]);
  } else {
    await queryOne("UPDATE users SET last_login = now() WHERE id = $1", [user.id]);
  }

  const token = signToken({ sub: user.id, username: user.username });
  const profile = await loadProfile(user.id);
  res.json({ token, profile });
}));
