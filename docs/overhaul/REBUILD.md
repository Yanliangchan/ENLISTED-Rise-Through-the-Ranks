# ENLISTED rebuild (Three.js) — status and resume notes

Supersedes the incremental Babylon overhaul in PROGRESS.md. The new client is
in `game/`, now the only client (the Babylon build was removed at cutover).

## Run / verify
- `npm ci && npx vite --port 5173`
- `node scripts/shot.mjs <out.png> "cam=x,y,z,yaw,pitch" 3` (software GL, ~20 s)

## Decisions
- Engine: three r170, three-mesh-bvh (collision/raycast), postprocessing + n8ao.
- All assets procedural (no asset hosts reachable from the build sandbox).
- One map: Nee Soon Estate (HDB heartland, late afternoon). North = -Z.
- Backend (server/) is kept unchanged.

## Done
- core/{engine,input,audio}, gfx/{atmosphere,textures,surfaces,materials,builder,decals,vfx}
- world/{ctx,ground,estate,collision}, kit/{street,arch,hdb,props,vegetation,buildings}
- player/{controller,sar21,weapon}, ai/{nav,soldierModel,soldiers}
- play/{game,mission} (Operation Swift Lion + Holdout), ui/{hud,menus,style}, net/api

## Test
- `node scripts/play.mjs <out.png> "auto=operation&q=low" <script.js> 640 360`
  runs a scripted play session in headless Chromium (script gets `game`, `THREE`, `wait`).

## Next
1. Baked light volume (interiors currently lit by sky/hemisphere only)
2. Viewmodel polish, surface tuning (grass tiling, asphalt normal)
