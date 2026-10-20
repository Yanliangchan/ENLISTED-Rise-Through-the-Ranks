# Workstream Agent Brief

Read this, then `ART_DIRECTION.md`, `REFERENCES.md`, `CATALOGUE.md` and your
area's audit in `audit/` before changing anything.

## The game

ENLISTED: browser FPS, Babylon.js 7 + TypeScript + Vite. Everything visual
is procedural code (no binary assets). SAF-inspired: Singapore Armed Forces.

## Production pipeline (what "a real asset" means here)

- Build geometry with `src/render/geom.ts`: `extrudeProfile` (bevelled side
  silhouettes), `fillet`, `stroke`, `latheZ`, `limb`, `blob`, `chamferBox`,
  `bakeBasis`, `boxProjectUVs`, `mergeParts`. No raw unbevelled
  `MeshBuilder.CreateBox` on hero assets.
- Materials come only from `materialLibrary(scene)` in
  `src/render/materials.ts`. Add new shared materials there (one per surface
  type), never per-instance duplicates. Never dispose library materials:
  dispose meshes with `dispose(false, false)`.
- Textures come from `src/render/textures.ts` (seeded canvas, cached per
  scene). Never `.clone()` a DynamicTexture (clones never become ready).
- True real-world scale in metres, +Z forward, +Y up. Characters: origin at
  the feet. Weapons: origin at the top of the pistol grip, bore at y = 0.
- Merge per material: hero assets end up as a few meshes.
- Decorative meshes are always `isPickable = false`.
- The quality bar is the SAR 21 benchmark: `src/weapons/models/sar21.ts`
  and `shots/bench/sar21_*`.

## Verifying your work (mandatory)

1. `npx tsc --noEmit` must be clean, then `npm run build`.
2. Lookdev renders: register your asset in a lookdev registration module
   (e.g. `src/characters/lookdev.ts`) imported from `src/lookdevAssets.ts`
   (add one import line), then
   `node scripts/lookdev.mjs docs/overhaul/shots/<ws> <asset>:side <asset>:three ...`
   Views: side, three, front, fp, ads, wide; append `:night` for night. Fp
   framing overrides: `<asset>:fp:day:hip=x,y,z&rot=x,y,z`.
   Read the PNGs and judge them against the reference pack and the SAR 21.
3. In-game check: `node scripts/capture.mjs <label> <city|terminal|range|citadel>`
   (slow: about 20 s per frame on the CPU rasteriser, so run one group).
   `window.__debug` (open the game with `?debug`) exposes test hooks: see
   the end of `src/main.ts`.
4. Iterate until it passes your own review, then report.

The machine has no GPU (SwiftShader, 4 cores, shared with other agents).
Keep renders few and targeted.

## Rules

- Preserve every gameplay contract in your audit file (hitboxes, stats,
  callbacks, pick/collision roles, names relied on elsewhere).
- Do not change weapon stats, economy, or backend code.
- Only edit files your workstream owns (see PROGRESS.md). For a shared file,
  make the smallest additive change and mention it in your report.
- Commit in your worktree with clear messages. Do not push and do not merge:
  the integration owner merges.
- Never claim something works unless you rendered or ran it. Report failures
  honestly.

## Report format (final message)

- What you inspected
- What you built or changed (files)
- Contracts and dependencies affected
- Verification run (commands, which renders you looked at, results)
- Self-review against the reference pack: visual and authenticity
- Remaining issues
- Your worktree branch name and final commit hash
