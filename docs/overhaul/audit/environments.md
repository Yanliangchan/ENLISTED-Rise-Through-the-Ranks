# Audit: Environments, Materials, Lighting, Rendering

Read-only audit, 2026-10-20. Line refs are to the tree at commit `4e29122`.

## Top findings

1. **Night lighting never takes effect.** `applyWaveArcLighting` runs at boot
   (`main.ts:515`) and replaces the night values from `Level.ts:243-256`: hemi
   0.16 → ~0.81; fog/clear go near-black → pale blue-grey (0.5,0.58,0.68)
   (`Level.ts:4283-4302`). Sky ignores fog and stays black, so distant
   buildings fade to pale blue against a black sky.
2. **Skybox is one 2D painting on every cube face** (`Level.ts:541-637`):
   sun disc on four sides, seams top/bottom, painted sun not aligned with
   `sunLight` (-0.5,-1,0.3).
3. **One random day/night rig for every map** (`night = Math.random()<0.5`,
   `Level.ts:228`). Pasir Panjang is meant to be at night; Iron Citadel's
   interior gets outdoor night ambient.
4. **City objects leak into other maps.** Ambience burning wrecks
   (`Ambience.ts:76`) and supply crates (`SupplyCrates.ts:17-29,76`) are built
   after the survival snapshot (`main.ts:125`), so they stay enabled,
   collidable and pickable on Pasir Panjang (shared origin), with live particles.
5. **Only the city has shadows; only the terminal/Citadel have normal maps.**

## Per map

| Map | Visual | Tech | Authenticity | Weakest | Pri |
|---|---|---|---|---|---|
| Singapore city (`Level.ts`) | 3 | 3 | Strongest: HDB void decks, hawker centre, MRT, MBS, bus shelters, street names, 5-tonner | sky, night fog, box buildings, no normals | P0 sky/night, P1 rest |
| SAF camp (`Level.ts buildCamp :3710`) | 2.5 | 3 | Generic tents; plain red flag (`:3746`), no SAF signage | flat canvas | P2 |
| Pasir Panjang Terminal | 3 | 4 | Good place names; generic containers, box cranes | no shadows, random day/night, leaked city props | P0 leak/lighting, P1 shadows |
| Iron Citadel | 3.5 | 4 | Plausible HQ; correct SG flag | no interior lights; billboard exterior | P1 |
| Training range | 2.5 | 3 | Concept OK; no SAF range cues | no shadows/normals/merge; night fog cuts 200 m lane | P2 |

City: 200 m square, irregular street grid, zoned districts (garden/camp SW,
CBD NE, industrial SE, MBS, container yard, car park NW). ~57 `WorldMaterial`
+ 107 `solidMat()` sites, 10 DynamicTexture generators. HDB blocks lack
slab/point massing, corridor bands, laundry poles, block numbers. Shophouses
lack five-foot-way columns and pitched roofs.

Terminal: 300 m ground, nav half 130, spawn (0,2,-116), four strongpoints
(Keppel Distripark, Wharves, Power Station, Bukit Chandu). Clean role
primitives (`solid/walkable/roofPanel/decor/decal`, `PasirPanjang.ts:262-332`),
~23 PBR mats with canvas albedo + 2 detail normals, thin-instanced foliage.
Materials never frozen; foliage scale uses `Math.random()`.

Iron Citadel: interior HQ at (430,0,0), scale 0.8; PBR + emissive signage;
props hardware-instanced; merged and frozen.

## Material system

- `WorldMaterial` (`WorldMaterial.ts:18-71`): PBR subclass exposing a
  StandardMaterial-style API, roughness 0.92, env 0.55, `maxSimultaneousLights=8`.
- Factories: `solidMat` (`Level.ts:2133`), `poleGrayMat`, `matFromTexture`,
  `carDetailMats`, `getTentMats`, `buildTerminalMats`/`textured`/`plain`
  (`TerminalSurfaces.ts:400-505`), Citadel `pbr`/`glow`/`emissiveTexMat`, range `solid`.
- StandardMaterial (unlit/Blinn-Phong) leftovers: sky, night windows, Ambience,
  SupplyCrates, flare halo, Citadel glow.
- `createDetailNormalTexture` (`Level.ts:1869`): CPU value-noise normal map;
  used by terminal and Citadel only.
- Estimated unique materials: city ~200+ (many per-instance duplicates such as
  `cbdCapMat_${i}`, `strongpointMat_${i}`, `signPoleMat_${i}`), terminal ~23,
  Citadel ~40-60, range ~20. Duplicates cost extra draw calls because merges
  group by material. Three separate `mulberry32` copies.

## Lighting rig

- `hemiLight` day 0.85 / night 0.16 (overridden by arc bug).
- `sunLight` directional (-0.5,-1,0.3): 1.15 day warm, 0.26 night cool.
- `fillLight` directional 0.28 / 0.07.
- Local: camp tent point light, camera flashlight spot (3.4 day / 7.5 night,
  range 55), flare point lights, 6 terminal floodlights.
- Shadows: one 2048 PCF map, render-once, city only, ~11 cm/texel.
- Fog linear: day 90→320 m; night 34→140 m (then overwritten).
- Sky: painted 512 px box; ReflectionProbe 128 px → `environmentTexture`.
- Post (`Postprocess.ts`): FXAA, bloom (thr 0.93, w 0.09), ACES exposure 1.12
  contrast 1.06, vignette 1.15, olive/warm colour curves, sharpen 0.14, grain 7,
  SSAO2 half-res. Adaptive quality steps down below 45 fps.

## Contracts replacements must keep

| Role | isPickable | checkCollisions |
|---|---|---|
| Solid cover | yes | yes |
| Walkable | yes | yes (+ `metadata.walkable`) |
| Roof over interior | no | yes |
| Visual only | no | no |

- Never "pickable but not colliding": bullets stop on pickable meshes.
- RayIndex static set = enabled && pickable && colliding && !damageable &&
  !isSmoke; caches inverse world matrices, so static meshes must not move
  after `invalidateRayIndex()`. Pick predicates start with `isLiveMesh()`.
- Nav: ray from y=200; navigable if nothing hit, `metadata.walkable`, or mesh
  **named `"ground"`** below 0.8 m. Ceilings must be non-pickable.
- Load-bearing names: `ground`, `hemiLight`, `skyMat`, `building_${i}`,
  `ppFlood_`, `playerCollider`, `botty_`, ground-decal regex (`Level.ts:452-455`).
- Map roots: `pasirPanjangRoot`, `ironCitadel` TransformNodes toggled by
  `setEnabled`; city has **no root** (snapshot list in `main.ts:125-145`).
  Every switch calls `invalidateRayIndex()` / `setActiveMap()`.
- `buildLevel` freezes everything existing at its end; dynamic objects must be
  created later; new lights need `admitLightToFrozenWorld()`.
- `generateBuildingLayout()` must stay deterministic.

## Performance (from code comments; runtime numbers in PERFORMANCE section of AUDIT.md)

City ~930 pickable meshes; terminal ~2,500 meshes; Citadel 1000+ pre-merge.
8-light budget per material. Each flare throw unfreezes all materials (shader
recompile hitch). Range unmerged. CPU normal-map blur at build time.

## Cross-map consistency issues

1. One random lighting rig everywhere. 2. Surface fidelity gap (terminal/Citadel
normal-mapped PBR vs flat city/range). 3. Shadows only in city. 4. Mixed
Standard/PBR materials. 5. Each map defines its own olive, sandbag, concrete,
glass (glass roughness/metal/alpha differ on every map). 6. Faulty sky cube
seen everywhere. 7. SG flag only in Citadel.
