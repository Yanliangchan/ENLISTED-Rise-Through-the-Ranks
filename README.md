# Operation Sentinel Shield

Single-player, browser-based FPS: a Singapore Armed Forces soldier defends
against a generic OPFOR invasion in a wave-survival shooter with an armoury
shop between waves.

Stack: Babylon.js + TypeScript + Vite frontend, Express + PostgreSQL backend,
deployed as one Railway service.

## Status

Feature-complete first playable pass covering all master-prompt phases:

- **Movement & camera** — Pointer Lock mouse-look, WASD, sprint, crouch, jump, gravity/collision.
- **Shooting core** — hitscan raycasting, per-weapon recoil pattern + recovery, dynamic hip/ADS spread (widens moving/hipfire), damage falloff over range, headshot multiplier, mag/reserve ammo, reload, ADS zoom/FOV — all read from `weapons.ts`.
- **Weapon roster** — every weapon in `weapons.ts` (SAR 21, BR18, P30, M110, TRG-22, FN MAG, MATADOR) with a low-poly viewmodel per class and slot-based switching (1/2/3/4 + mouse wheel).
- **Attachments** — slot system from `attachments.ts` with stat deltas; SAR 21 P-Rail gates its optic/underbarrel slots; suppressors quiet gunshots for AI hearing; bipod cuts recoil/spread when deployed prone/crouched; M203 underbarrel HE secondary fire (`H`).
- **Enemies** — OPFOR grunt/marksman/heavy with an FSM (Idle→Patrol→Alerted→Chase→Attack→Suppressed→Dead), line-of-sight + gunshot-hearing, headshot-tagged hit meshes, credits on kill.
- **Waves & economy** — wave manager scaling enemy count/health per `WAVES`, boss waves, scaling wave-clear bonus, between-wave armoury shop, localStorage save/load.
- **Throwables & launchers** — SFG 87 frag (blast falloff), 4 smoke colours (blocks AI LOS), flashbang (screen whiteout + AI stun), flare, tripflare, plus MATADOR travel-time projectile + blast.
- **Gear** — FAST helmet + No.4 SAF-camo skin, LBV carry bonus, armour plate pool that absorbs damage before health.
- **HUD** — health/armour, ammo, weapon + fitted attachments, throwable count, credits, wave/objective, dynamic-spread crosshair, hitmarkers, damage-direction indicators, kill feed, top-down radar.
- **Polish** — wave-arc story beats (defence → holding → counter-attack → retake) with lighting shifts, procedural WebAudio SFX, pause/settings menu (sensitivity, volume), game-over/redeploy screen.

Art is clean low-poly geometry built in code (recognisable silhouettes per
weapon class); swap in real `.glb` models via GLTFLoader later without
touching game logic.

## Data files

`src/data/weapons.ts`, `src/data/attachments.ts`, and `src/data/gamedata.ts`
are the authoritative source for all weapon, attachment, throwable, gear,
enemy, and economy stats. Real-world fields (calibre, magazine size, fire
modes, effective range) are accurate to actual SAF equipment; `damage`,
`recoil`, `spread`, and prices are balanced game values. Game logic reads
from these files rather than hardcoding numbers.

## Development

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build locally
```

Click the canvas to engage Pointer Lock.

- `WASD` move, `Shift` sprint, `C` crouch, `Space` jump
- `LMB` fire, `RMB` ADS, `R` reload, `G` throw equipped throwable
- `1`/`2`/`3`/`4` select primary/secondary/special/throwable, mouse wheel cycles
- `H` fire underbarrel M203 (if fitted)
- `Escape` pause/settings

## Project layout

- `src/core` — engine/render loop, input, audio (procedural WebAudio SFX), `Backend` API client, save/settings/stats
- `src/player` — movement, camera, health/armour, gear stat application
- `src/weapons` — weapon controller, ballistics/attachment deltas, viewmodels, throwables, projectiles, loadout switching
- `src/enemies` — AI FSM, spawner
- `src/world` — level blockout, wave manager
- `src/ui` — HUD, armoury shop, pause/profile pages, login screen, game-over screen
- `src/data` — authoritative weapon/attachment/gamedata files
- `server/` — Express API + PostgreSQL data layer (see below)

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
