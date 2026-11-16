# ENLISTED rebuild (Three.js) — status and resume notes

Supersedes the incremental Babylon overhaul in PROGRESS.md. The new client is
in `game/`, served at `/play.html` beside the old game until cutover.

## Run / verify
- `npm ci && npx vite --port 5173`
- `node scripts/shot.mjs <out.png> "cam=x,y,z,yaw,pitch" 3` (software GL, ~20 s)

## Decisions
- Engine: three r170, three-mesh-bvh (collision/raycast), postprocessing + n8ao.
- All assets procedural (no asset hosts reachable from the build sandbox).
- One map: Nee Soon Estate (HDB heartland, late afternoon). North = -Z.
- Backend (server/) is kept unchanged.

## Done
- core/engine, gfx/{atmosphere,textures,surfaces,materials,builder,decals}
- world/{ctx,ground,estate}, kit/{street,arch,hdb}

## Next (in order)
1. Collision BVH + player controller
2. Viewmodel (SAR 21 + arms), weapon system, VFX, audio
3. Soldiers (skinned, animated), AI, nav grid
4. Mission director, HUD, menus, backend hookup
5. Map: shop block, hawker centre, MSCP, community club, props, vehicles,
   vegetation, backdrop; baked light volume
6. Cutover: new game becomes index.html; remove src/ (Babylon)
