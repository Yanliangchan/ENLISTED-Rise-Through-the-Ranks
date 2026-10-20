# FPS Graphics Overhaul — Progress Tracker

This file is the single source of truth for where the overhaul stands.
**Every phase ends by updating this file, committing, and pushing.** A new
session resumes by reading this file first, then the docs it links.

Branch: `claude/game-creation-hbdyq5`

## Phase status

| # | Phase | Status | Deliverable |
|---|---|---|---|
| 1 | Audit | DONE (baseline screenshots in progress) | `docs/overhaul/AUDIT.md`, `audit/*.md`, `REFERENCES.md` |
| 2 | Art direction + benchmarks | IN PROGRESS | `docs/overhaul/ART_DIRECTION.md`, benchmarks in `shots/bench/` |
| 3/4 | Workstream rebuilds | not started | see workstream table |
| 6 | QA | not started | `docs/overhaul/QA.md` |
| 7 | Polish | not started | |
| 8 | Acceptance gate | not started | `docs/overhaul/FINAL_REPORT.md` |

## Workstreams and file ownership

One owner per file per phase. Agents work in isolated git worktrees; the
integration owner (lead session, Agent J role) merges, resolves conflicts and
runs the review gates. Shared files (`ViewmodelFactory.ts` MODELS map,
`lookdevAssets.ts`, `main.ts`) take additive one-line changes only.

| WS | Scope | Owns | Status |
|---|---|---|---|
| D | Shared materials/textures/geometry | `src/render/*` | Foundation done (lead) |
| B | Weapons + hands | `src/weapons/models/*`, ViewmodelFactory MODELS | SAR 21 benchmark done; rest pending |
| C | Characters | `src/characters/*`, model sections of `EnemyAI.ts`, `Botty.ts`, `NetMatch.ts` | pending |
| E | Lighting/sky/atmosphere | lighting+sky sections of `Level.ts`, `Postprocess.ts`, map lighting | sky shader done (lead); integration pending |
| F | Combat VFX | `src/fx/*`, FX parts of `WeaponController.ts`, `Projectile.ts`, `ThrowableController.ts` | pending |
| G | UI | `src/ui/*`, `index.html` | pending |
| H | Game feel | viewmodel motion in `WeaponController.ts` (after F) | pending |
| A | Environment art | map builders (after E) | pending |
| I | Performance | measurement + fixes across | ongoing |
| J | Integration/QA/authenticity review | `docs/overhaul/CATALOGUE.md`, `QA.md` | lead |

## Resume instructions

1. `npm ci && npm run build`
2. `node scripts/capture.mjs <label> <menu|city|range|terminal|citadel>`:
   full-game screenshots + scene metrics from fixed cameras, written to
   `docs/overhaul/shots/<label>/`. Slow (software WebGL, ~20 s/frame): run
   one group per call. `DIST=dist-baseline` serves the frozen pre-overhaul
   build (recreate it with `git worktree` at commit 4e29122 if missing).
3. `node scripts/lookdev.mjs <outDir> <asset:view[:night]> ...`: fast
   single-asset renders (`?lookdev=` scene) for asset review.
4. Read the most recent log entry below and continue from "Next".

## Log

### 2026-10-20: session 1

Done:
- Phase 1 audit: four parallel read-only audit agents (weapons, characters,
  environments, UI); reports saved in `audit/`; consolidated `AUDIT.md`.
- SAF research: web fetch is blocked in this sandbox, so search summaries
  only; `REFERENCES.md` holds text reference packs + open photo checks.
- Tooling: `scripts/capture.mjs` (full game), `?fixedquality` flag (pins
  post stack), `?lookdev=` review scene + `scripts/lookdev.mjs`.
- Phase 2 foundation: `ART_DIRECTION.md`; `src/render/geom.ts` (bevelled
  profile extrusion, fillet, stroke, lathe, limbs, box UVs, merge),
  `src/render/textures.ts` (corrected No. 4 camo, OPFOR pattern, normals,
  grain), `src/render/materials.ts` (shared PBR library), `src/render/sky.ts`
  (shader sky dome + env probe).
- Benchmark weapon in progress: `src/weapons/models/sar21.ts` + hands
  (`src/weapons/models/hands.ts`). Not yet wired into the game.

Next:
- Review SAR 21 lookdev renders, revise, then wire into ViewmodelFactory.
- Benchmarks still to build: OPFOR soldier, friendly soldier, combat VFX,
  environment (sky/lighting fixes in the game), HUD/menu pass.
