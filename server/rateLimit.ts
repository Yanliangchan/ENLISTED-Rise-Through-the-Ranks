import type { Request, Response, NextFunction } from "express";

/**
 * Minimal in-memory sliding-window rate limiter for a handful of low-traffic,
 * high-sensitivity endpoints (admin/guardian secret-code checks). Not meant
 * for general API throttling — just enough to blunt a brute-force script
 * hammering a fixed-length secret code. Keyed by IP; state is per-process,
 * which is fine since these endpoints see negligible legitimate traffic.
 */
export function rateLimit(maxAttempts: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= maxAttempts) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
