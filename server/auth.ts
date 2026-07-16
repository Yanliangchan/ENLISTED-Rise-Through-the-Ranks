import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // A missing secret would otherwise silently fall back to a fixed default,
  // letting anyone forge a valid token — refuse to boot instead.
  throw new Error("JWT_SECRET is not set. Generate one (e.g. `openssl rand -hex 32`) and set it in the environment.");
}
const SECRET: string = JWT_SECRET;

export interface AuthTokenPayload {
  sub: number; // user id
  username: string;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "180d" });
}

export interface AuthedRequest extends Request {
  user?: AuthTokenPayload;
}

/**
 * Express middleware: requires a valid `Authorization: Bearer <token>` header,
 * populating `req.user`. This is identity-only (no password) — the token
 * proves "this browser previously logged in as this username", matching the
 * spec's username-based auth. It is NOT a substitute for real password/OAuth
 * auth in a context where account takeover would matter.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }
  try {
    req.user = jwt.verify(token, SECRET) as unknown as AuthTokenPayload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}
