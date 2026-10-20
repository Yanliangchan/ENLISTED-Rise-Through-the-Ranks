# Phase 1 Audit: Consolidated Report

Date: 2026-10-20. Baseline commit `4e29122`.

Detailed per-area inventories (one row per asset, with file:line, quality
scores, recommendation, risks and priority):

- [audit/weapons.md](audit/weapons.md): weapons, viewmodels, VFX
- [audit/characters.md](audit/characters.md): OPFOR, BOTTY, MP avatars, camo
- [audit/environments.md](audit/environments.md): maps, materials, lighting, post
- [audit/ui.md](audit/ui.md): HUD, menus, design system
- [REFERENCES.md](REFERENCES.md): SAF reference packs
- Screenshots: `shots/baseline/` (+ `metrics.json`)

## 1. Project summary

| Aspect | Finding |
|---|---|
| Engine | Babylon.js 7 (WebGL2), TypeScript, Vite; Express + PostgreSQL backend |
| Asset pipeline | **Everything is procedural code.** No .glb, no image textures on disk. A dormant GLB loader exists for buildings only (`ModelLoader.ts`, `public/models/README.md`). Textures are canvas `DynamicTexture`s generated at runtime. |
| Size | ~30k lines TS; `Level.ts` 4.3k, `IronCitadel.ts` 1.9k, `PasirPanjang.ts` 1.7k |
| Bundle | Single 5.9 MB JS chunk (1.36 MB gzip) |
| Modes | Survival waves (Singapore city), Training Range, Operations (Strongpoint Assault + Ranger Gauntlet at Pasir Panjang Terminal), Multiplayer (Iron Citadel) |
| Tests | No automated test suite. `?debug` exposes `window.__debug` hooks used for headless checks |

**Implication for the pipeline.** The production format for this game is
procedural TypeScript geometry plus generated textures. A rebuilt asset is
"real" when it is a TS builder that returns the same contract as the one it
replaces, integrated and tested in the running game. Offline-authored .glb is
not available in this environment (no DCC tool, no asset hosts reachable), so
the overhaul raises the quality of the procedural pipeline itself: lathe and
extruded profiles instead of boxes, chamfers, merged meshes, shared PBR
material library, generated albedo/normal/roughness textures, and real
pivots for animation.

## 2. Weakest elements (ranked by player screen time × visual damage)

1. **First-person weapons**: on screen 100% of play. Box-built, one model per
   class (BR18 = SAR 21, P90 = MP5K, IAR/Ultimax = FN MAG), SAR 21 trigger
   behind grip, no hands, muzzle inside barrel, no attachments shown.
2. **OPFOR soldiers**: the main thing players look at. Flat orange box people,
   floating rifles, corpses sink underground, classes indistinguishable.
3. **Sky + lighting**: painted cube with four suns; night preset overridden into
   pale-blue fog; one random day/night rig for every map.
4. **Combat VFX**: 1 px tracers, disc impacts, sphere explosions; material leaks.
5. **No 3D No. 4 camo anywhere**; BOTTY green-faced with buried vest.
6. **City surfaces**: no normal maps or shadows outside the city, so maps look
   like different games.
7. **UI coherence**: font never loaded; six button systems; off-brief bright
   greens; Profile/Leaderboard/MP/Account off-system.

Assets that already meet or approach the bar (retain, refine only): Pasir
Panjang surfacing system, Iron Citadel interiors, HUD core, landing page
identity, strike targeting, airstrike VFX, BOTTY's persistent muzzle flash.

## 3. Prioritised rebuild plan

| Order | Workstream | Scope | Pri |
|---|---|---|---|
| 1 | D: shared material + texture library | PBR palette module, No. 4 camo texture (corrected), metal/polymer/fabric/concrete presets, generated normal/roughness | P0 (dependency of everything) |
| 2 | E: lighting/sky fixes | fix night-arc override, real sky (gradient dome + correct sun), per-map lighting presets, terminal/Citadel shadows | P0 |
| 3 | B: weapons + arms | per-weapon viewmodels starting with SAR 21; gloved hands with No. 4 sleeves; muzzle at bore; mount nodes; viewmodel rendering group; persistent pooled flash | P0 |
| 4 | C: OPFOR rebuild | template soldier with pivots, held rifle, class silhouettes, ragdoll-style death that stays on the ground, shared materials, distinct non-SAF hostile uniform | P0 |
| 5 | C: friendly soldier builder | No. 4, high-cut helmet, LBS vest; used by BOTTY + NetAvatar | P1 |
| 6 | F: combat VFX | tracers, impacts + decals, explosions, smoke; fix leaks; projectile loop in scene update | P1 |
| 7 | H: game feel | hip sway, walk bob, sprint pose, recoil kick on viewmodel, equip, reload motion | P1 |
| 8 | A: environment pass | fix leaked wrecks/crates; city normal maps; camp authenticity (flag, signage, drains, camp blocks); HDB massing | P1-P2 |
| 9 | G: UI | load fonts, unify buttons, reskin Account/WaveSelect/Profile/Leaderboard/MP/Range, remove placeholders | P1-P2 |
| 10 | I: perf | merge viewmodels, instanced soldiers, material dedupe, flare-light hitch | ongoing |
| 11 | J: QA | capture comparisons, functional checks every phase | ongoing |

## 4. Dependency map

```
Material library (D) ──┬─> Weapons/arms (B) ──> Game feel (H)
                       ├─> Soldiers OPFOR/friendly (C) ──> BOTTY, NetAvatar
                       ├─> Environment pass (A)
                       └─> VFX (F)
Lighting/sky (E) ──────> every visual approval (benchmarks judged under final light)
ViewmodelFactory contract ──> WeaponController (ADS, muzzle, hide logic), HUD
EnemyAI contract ──> hit zones (WeaponController), RayIndex LOS, EnemySpawner, Botty targeting
Map contracts (pickable/colliding roles, "ground" name, walkable) ──> Nav, RayIndex, AI
Level freeze (buildLevel end) ──> anything created after must manage its own freeze
UI theme tokens (saf.ts/theme.ts) ──> every screen
```

## 5. Gameplay behaviours that must remain intact

- All weapon stats in `src/data/weapons.ts` / `attachments.ts` /
  `gamedata.ts`: fire rate, reload time, ADS time, recoil, spread, damage
  falloff, headshot multipliers, magazine sizes, M203 and MATADOR ballistics.
- Hitscan from the camera, independent of the viewmodel. FMJ penetration,
  breakable glass.
- ADS solve: `sightOffset` placed 0.28 m in front of the camera; body/sight
  mesh hide thresholds; scope overlay at zoom ≥ 1.3, red dot at ≥ 1.05.
- Enemy hitboxes: torso 0.56×1.0×0.36 at y 0.98, head 0.27×0.3×0.27 at y 1.67,
  ×0.95; `metadata.hitZone`/`damageable`; colliders (0.3,0.85,0.3) at feet
  origin, facing +Z; eye height 1.6; AI LOS skipping damageables.
- Player eye 1.7 standing / 1.0 crouched; collider radius 0.4.
- Map roles: pickable+colliding cover, `walkable` metadata, non-pickable
  roofs, `"ground"` mesh name, spawn points, nav bounds, deterministic
  building layout.
- Map enable/disable + `invalidateRayIndex()` on every switch.
- HUD API and write-caching; UI `visible` flags read by pause/input gates;
  `onDeploy` inside the click gesture.
- Economy, progression, badges, backend saves (no changes planned).

## 6. Visual consistency report

The game currently reads as three art styles:
1. **City + camp + range**: flat-colour PBR, no normal maps, city-only
   shadows, saturated orange enemies.
2. **Terminal + Citadel**: normal-mapped, texel-normalised PBR, no shadows.
3. **UI**: a strong, muted SAF olive design system on the landing/HUD,
   undercut by off-system screens in Consolas with bright greens.

Cross-cutting breaks: the sky (four suns) is visible from every map; each map
defines its own olive, concrete and glass; viewmodels are bare dark boxes
with no hands next to PBR environments; enemies are emissive orange (unlit
look) against lit environments.

## 7. Performance baseline

See `shots/baseline/metrics.json` for per-scene numbers (meshes, active
meshes, vertices, materials, textures, lights, frame times, JS heap).

**Hardware caveat.** This environment has no GPU. Chromium renders WebGL via
SwiftShader (CPU) at 4 cores, giving 0.5-9 s per frame. Frame times are
**only comparable run-to-run on this harness** and say nothing about real
player hardware. Scene-complexity counts (meshes, vertices, materials, draw
calls) are hardware-independent and are the primary budget metric.
Real-GPU FPS must be measured by a human before launch (see Risks).

## 8. Technical risks and unresolved questions

| # | Risk / question | Mitigation |
|---|---|---|
| R1 | No GPU: cannot measure real FPS | Budget on hardware-independent counts; request human GPU test before launch |
| R2 | No web/image access: authenticity is text-verified only | REFERENCES.md documents sources + open photo checks for a human |
| R3 | No automated tests | Headless `__debug` checks + capture harness each phase; add scripted functional checks |
| R4 | Global level freeze + 8-light budget make new dynamic materials/lights fragile | New assets create their own materials after freeze; avoid new lights; fix flare hitch |
| R5 | Enemy shared-material disposal bug | Fix during OPFOR rebuild (`dispose(false,false)`) |
| R6 | Changing silhouettes can change visual hit area vs hitbox | Keep hitbox meshes identical; visuals fit within them |
| R7 | Large single files (Level.ts) shared by environment + lighting work | One owner per file per phase (coordination table in PROGRESS.md) |
| R8 | Software-render screenshots are slow (~1-2 min each) | Keep the shot list small and fixed |
| Q1 | Is the BR18 meant as the new standard issue rifle (default loadout)? | Keep the current default (SAR 21); the BR18 stays as an unlockable |
| Q2 | Should OPFOR keep high-visibility orange? | Keep a strong hostile read with a realistic, distinct, non-SAF uniform (tan/khaki + dark gear) plus a subtle warm rim. Decision recorded in ART_DIRECTION.md |
| Q3 | Day/night randomness: design or accident? | Keep random day/night for the city; per-map presets elsewhere (terminal night, Citadel interior day) as their source comments state |
