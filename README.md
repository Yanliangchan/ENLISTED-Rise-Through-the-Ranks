# ENLISTED — Rise Through the Ranks

A Singapore Armed Forces first-person shooter that runs in the browser. You are a
rifleman of 3 SIR retaking Nee Soon Estate — an HDB heartland of void decks, a hawker
centre, a multi-storey carpark and a community club — with a SAR 21.

Built on Three.js. Every asset is generated in code at load: PBR surface textures,
the estate's buildings and interiors, vehicles, vegetation, the skinned soldiers,
the weapon, particle effects and all audio.

## Modes

- **Operation Swift Lion** — clear the junction, destroy the weapons cache in the
  hawker centre, clear the carpark, seize the command post, then hold for extraction.
- **Holdout** — hold the junction against escalating waves.

Patrol Base Lion, in the south-east corner by the insertion road, is a safe zone: weapons
are made safe inside, nothing can hurt you there, and the ammunition point restocks you (`F`).

## Weapons

Each is modelled at true scale from its real layout.

| Slot | Weapon | Notes |
|---|---|---|
| 1 | SAR 21 | 5.56 mm bullpup, integral 1.5× optic |
| 1 | Ultimax 100 Mk 3 | 100-round drum, slow to handle, steady in long bursts |
| 1 | KAC M110 SASS | suppressed 7.62 mm, 3.5–10× scope; enemies hear it from far less distance |
| 2 | H&K P30 | 9 mm sidearm |
| 3 | MATADOR | 90 mm rocket, two carried |

`1` `2` `3` or the mouse wheel switch; swap the primary at the patrol base armoury with `T`.

## Controls

`WASD` move · mouse look · `LMB` fire · `RMB` aim · `Shift` sprint · `C` crouch · `Z` prone ·
`Space` jump · `Q`/`E` lean · `R` reload · `V` fire selector · `G` grenade ·
`F` interact · `Esc` pause

## Development

```
npm ci
npm run dev          # client on :5173
npm run dev:server   # API on :8080 (needs DATABASE_URL, JWT_SECRET); optional
npm run build        # typecheck + production bundle
```

The game plays offline; signing in with a callsign records rank, career stats and
leaderboard standing through the API below.

Headless checks (software GL): `node scripts/shot.mjs out.png "cam=x,y,z,yaw,pitch&q=medium" 3`
renders a view; `node scripts/play.mjs out.png "auto=operation&q=low" script.js` runs a
scripted play session (`game.simulate(dt)` steps the game without rendering).

## Project layout

```
game/core      renderer (CSM shadows, post chain, lit-material patch), input, synth audio
game/gfx       procedural textures and materials, geometry builder, sky/fog, particles
game/world     the estate: ground plan, building kits, props, vegetation, collision BVH, light bake
game/player    movement controller, SAR 21 viewmodel, weapon system
game/ai        nav grid + A*, skinned soldier model, squad AI
game/play      game loop, mission scripts
game/ui        HUD and menus
game/net       API client
server/        Express + PostgreSQL: accounts, XP/ranks, badges, leaderboards
```

## Accounts & progression (PostgreSQL backend)

Player accounts, economy/loadout saves, settings, lifetime stats, XP/rank,
badges, and leaderboards persist in PostgreSQL via a small Express API in
`server/`. Login is **username-only** (find-or-create — no password), which
is a deliberate scope choice for this game, not a stand-in for real
credential auth; see the comment in `server/auth.ts`.

- `server/db.ts` — connection pool + query helpers
- `server/migrations/*.sql` + `server/migrate.ts` — schema, applied in order and tracked in `schema_migrations`; safe to re-run
- `server/ranks.ts` — XP → rank ladder and the per-match XP formula (edit here to re-tune)
- `server/badges.ts` — badge unlock predicates (add a badge: seed a row + add a case here)
- `server/routes/*.ts` — REST endpoints (see below)
- `server/index.ts` — Express app; also serves the built frontend (`dist/`) so the whole game is one deployable service

### REST API

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | — | Find-or-create-and-login by username; returns a JWT + full profile |
| `GET /api/profile` | ✓ | Own full profile (save, settings, stats, rank/XP, career track, badges) |
| `GET /api/profile/:username` | — | Public profile (no save/settings) |
| `GET /api/save` / `PUT /api/save` | ✓ | Economy/loadout blob (credits, owned weapons/attachments, fitted loadout) |
| `PUT /api/settings` | ✓ | Sensitivity/volume |
| `POST /api/matches` | ✓ | Save one completed deployment — increments lifetime stats, awards XP, unlocks badges, refreshes leaderboards, all in one transaction |
| `GET /api/leaderboard/:category` | — | Top N for `highest_wave` / `total_kills` / `best_game_kills` |
| `GET /api/health` | — | Liveness check |

### Local development

Requires a local PostgreSQL instance.

```bash
createuser enlisted --pwprompt --createdb   # once, if you don't have a role yet
createdb -O enlisted enlisted

cp .env.example .env                        # then edit DATABASE_URL / JWT_SECRET if needed
npm install
npm run migrate                             # applies server/migrations/*.sql

npm run dev            # terminal 1: Vite dev server on :5173 (proxies /api -> :8080)
npm run dev:server     # terminal 2: API server on :8080
```

Open `http://localhost:5173`. `?debug` on the URL auto-logs-in as a
throwaway "Debug" operator and exposes a `window.__debug` hook for headless
testing.

### Deploying to Railway

One Railway service runs both the API and the built game (`server/index.ts`
serves `dist/`); a Postgres plugin provides the database.

1. Create a new Railway project, add a **Postgres** plugin.
2. Add this repo as a service in the same project. Set its `DATABASE_URL`
   env var to a variable reference on the Postgres plugin (`${{Postgres.DATABASE_URL}}`),
   and set `JWT_SECRET` to a real secret (`openssl rand -hex 32`).
3. Railway auto-detects Node via Nixpacks; `railway.json` in this repo pins
   the build command to `npm run build` (frontend only — the server runs
   directly via `tsx`, no compile step) and the start command to
   `npm run migrate && npm start`, so migrations apply on every deploy before
   the server comes up.
4. Railway injects `PORT` automatically; `server/index.ts` listens on it.

No separate static host is needed — the API server serves the game.
