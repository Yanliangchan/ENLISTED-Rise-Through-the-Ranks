import "dotenv/config"; // loads .env locally; no-op on Railway, where env vars are injected directly
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profile.js";
import { saveRouter } from "./routes/save.js";
import { matchesRouter } from "./routes/matches.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { adminRouter } from "./routes/admin.js";
import { guardianRouter } from "./routes/guardian.js";
import { attachRoomServer } from "./multiplayer/RoomServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRouter);
app.use("/api", profileRouter);
app.use("/api", saveRouter);
app.use("/api", matchesRouter);
app.use("/api", leaderboardRouter);
app.use("/api/admin", adminRouter);
app.use("/api/guardian", guardianRouter);

// Centralised error handler — any thrown/rejected error in a route above lands
// here instead of taking the process down or hanging the request.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] unhandled error", err);
  res.status(500).json({ error: "Internal server error." });
});

// Serve the built frontend (`vite build` output) — same Railway service hosts
// both the API and the static game, so there's one deployment, one origin, no
// CORS to worry about in production.
const distPath = path.join(__dirname, "..", "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distPath, "index.html")));
} else {
  console.warn(`[server] ${distPath} not found — run "npm run build" first. API routes still work.`);
}

const port = Number(process.env.PORT) || 8080;
const httpServer = app.listen(port, () => {
  console.log(`[server] listening on :${port}`);
});

// Private-room multiplayer (WebSocket) shares the same HTTP server / port, so
// there is still one deployment and one origin (ws:// upgrade on /mp).
attachRoomServer(httpServer);
