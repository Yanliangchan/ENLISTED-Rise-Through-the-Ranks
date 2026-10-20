# Audit: Weapons, Viewmodels, VFX

Read-only audit, 2026-10-20. Line refs are to the tree at commit `4e29122`.

## Headline findings

- `buildViewmodel` builds **one model per weapon class, not per weapon**
  (`src/weapons/ViewmodelFactory.ts:84-579`). BR18 reuses SAR 21; P90 reuses
  MP5K; Colt IAR and Ultimax 100 reuse FN MAG; M110 reuses TRG-22.
- **No first-person arms/hands.**
- **Attachments are stats-only** (`ballistics.ts:31-74`): M203, suppressors,
  P-Rail, laser/light and optics never appear on the gun.
- No shell ejection, no impact decals, no viewmodel rendering group
  (viewmodel clips walls; post-FX applies to it).
- Muzzle nodes sit *inside* the barrels (SAR 21 muzzle z=0.5 vs barrel tip
  ≈0.665), so flash and tracers start 15 cm behind the visible muzzle.

## Inventory

| Asset | Built at | Construction | V | T | Rec. | Risks | Pri |
|---|---|---|---|---|---|---|---|
| Rifle (SAR 21; BR18 shares) | ViewmodelFactory.ts:85-222 | 25 meshes, 5 mats | 3 | 2 | Rebuild, split SAR21/BR18 | sightOffset (0,0.132,0.02) is the ADS pose; muzzle inside barrel | P0 |
| SMG (MP5K; P90 shares) | :223-312 | 18 meshes | 3 | 2 | Rebuild; P90 own model | rear drum blocks front post on ADS | P1 |
| Pistol (P30) | :313-365 | 15 meshes | 2 | 2 | Rebuild | tan slide, orange trigger, solid rear sight | P1 |
| DMR/Sniper (M110, TRG-22) | :366-460 | 20-22 meshes | 2 | 3 | Rebuild, split | scope 14mm×140mm, ~2.5× undersized | P1 |
| LMG (FN MAG; IAR, Ultimax share) | :461-520 | 16 meshes | 2 | 2 | Rebuild ×3 | muzzle inside flash hider | P1 |
| Launcher (MATADOR) | :521-564 | 10 meshes | 2 | 1 | Rebuild | reticle disc edge-on, sight box blocks centre | P1 |
| HMG | :565-578 | 3 meshes | 1 | 2 | Remove (unused) | dead code | P3 |
| Muzzle flash | WeaponController.ts:767-793 | new disc per shot, 28ms setTimeout | 2 | 2 | Improve (persistent toggled mesh, like BOTTY) | can be skipped (<1 frame) | P1 |
| Tracer | :795-800 | new CreateLines per shot | 1 | 2 | Rebuild (pooled quad) | 1px line | P2 |
| Impact spark | :758-765 | new disc per hit | 1 | 2 | Improve (pool, debris, decal) | no decals | P2 |
| Glass shards | :708-736 | 7 planes | 2 | 3 | Retain | invalidates RayIndex | P3 |
| Projectile (MATADOR/M203) | Projectile.ts:19-73 | sphere + **new material per shot**, own rAF loop | 1 | 1 | Rebuild | flies while paused; material leak | P1 |
| Projectile blast | Projectile.ts:62-69 | sphere + new mat | 1 | 1 | Rebuild | leak, no particles | P2 |
| Thrown grenade | ThrowableController.ts:149-153 | sphere + new mat | 1 | 1 | Rebuild | leak; no hand/throw anim | P2 |
| Frag/flash/claymore blast | :374-383 | sphere + new mat | 1 | 1 | Rebuild | leak | P2 |
| Smoke | :237-255 | one alpha sphere | 1 | 2 | Improve | keep `isSmoke` pickable LOS occluder | P2 |
| Claymore | :186-221 | 2 boxes | 2 | 2 | Improve | is a damageable | P3 |
| Flare | :282-354 | cylinder, halo, PointLight, 40 particles | 3 | 2 | Retain | `admitLightToFrozenWorld` hitch | P3 |
| Airstrike / carpet blasts | AirstrikeSupport.ts:132-192, CarpetBombingSupport.ts:179-225 | sphere + 120-150 particles | 3 | 3 | Retain | | P3 |
| BOTTY muzzle flash | Botty.ts:241-254 | persistent plane, toggled | 3 | 4 | Retain: **pattern to copy** | | — |
| Scope overlay | ScopeOverlay.ts | DOM vignette + 6 reticles | 3 | 3 | Retain | writes styles per frame | P3 |

## Per-weapon fidelity gaps

- **SAR 21**: trigger + torus guard are *behind* the grip (z=0.13 vs grip
  0.18); the signature large enclosed trigger guard from grip to fore-end is
  absent; length ≈1.0 m vs real 805 mm; missing LAD bulge on the fore-end,
  left-side cocking handle under the carry handle, cheek plate, rounded body,
  translucent magazine. P-Rail fit shows no rail and keeps the optic.
- **BR18**: shows SAR 21 carry-handle optic; real BR18 has a flat full-length
  Picatinny top rail, angular body, M-LOK fore-end, ambidextrous controls,
  forward ejection. ADS bug: iron path looks into the SAR 21 sight box (~9°
  black at screen centre).
- **P30**: tan slide, orange trigger, frame longer than slide, solid rear sight.
  Needs sculpted grip, rounded slide nose, black finish.
- **MP5K**: best of the set; rear drum needs an aperture.
- **P90**: wrong model entirely: needs bullpup kidney shell, thumbhole grip,
  translucent top magazine, ring sight.
- **M110**: needs AR-10 upper/lower, URX rail, curved 20-rd mag, correct
  3.5-10× scope.
- **TRG-22**: needs chassis + folding skeleton butt, adjustable cheekpiece,
  flush 10-rd mag, correctly sized scope.
- **FN MAG**: needs gas cylinder under barrel, barrel carry handle, tall front
  post, ladder rear sight, stock profile, linked belt.
- **Colt IAR**: should be an M16/HBAR: STANAG mag, flat-top, heavy barrel, bipod.
- **Ultimax 100**: needs 100-rd drum under the receiver, forward vertical grip,
  slim tubular receiver, quick-change barrel.
- **MATADOR**: needs olive body + markings, telescoping front, left-offset sight
  unit, firing-mechanism housing, shoulder pad.
- **M203**: no geometry at all. **SFG 87**: 0.12 m sphere, no hand/pin/lever.
- **Optics** (red dot, holo, ACOG, LPVO…): none modelled; ADS uses per-class
  `sightOffset` regardless of optic.

## Contract a replacement viewmodel must preserve

```ts
export interface Viewmodel { root: TransformNode; muzzle: TransformNode; sightOffset: Vector3; bodyMeshes: Mesh[]; sightMeshes: Mesh[]; }
export function buildViewmodel(weapon: Weapon, scene: Scene): Viewmodel
```

- `root` parented to `player.camera` (UniversalCamera, minZ 0.05) in
  `showViewmodel` (WeaponController.ts:243-254); cached per `weapon.id`.
- `root.position` overwritten every frame by `updateAds` (:385-394):
  `Lerp(HIP_REST[class] ?? (0.18,-0.16,0.35), (-sight.x+swayX, -sight.y+swayY, 0.28-sight.z), adsBlend)`.
  Camera-local frame: +z forward, +y up, metres, root at the grip area.
- `updateReload` subtracts a sine dip from `root.position.y` after `updateAds`.
- `muzzle.getAbsolutePosition()`: tracer start, projectile origin, flash parent.
  Must sit at the visible bore tip.
- `sightOffset`: root-local point on the optic axis; ADS centres it on screen.
  Iron sights need open notch/aperture geometry.
- `bodyMeshes` hidden at adsBlend ≥ 0.6 (non-scope); `sightMeshes` hidden at
  ≥ 0.55 for reflex optics (1.05 ≤ zoom < 1.3); whole root hidden for scopes
  (zoom ≥ 1.3, adsBlend > 0.5).
- **All viewmodel meshes `isPickable=false`** (else hitscan hits the gun).
- No animation system: recoil rotates the camera; sway ADS-only (0.0018).
  Hooks available: `onFire`, `onReloadStart`, `onReloadEnd`,
  `onSecondaryFire`, `onEmptyClick`; fields `isAiming`, `isReloading`,
  `m203Active`, `m203Blend`, `bipodDeployed`, `isScopedIn`.
- Viewmodels are created after the level freeze, so their materials are live
  and receive flashlight/flare light.

## Gameplay behaviour that must stay intact

All stats in `src/data/weapons.ts` (fire rate, reload, ADS time, recoil,
spread, damage falloff) and `computeEffectiveStats`. Hitscan is from
`camera.globalPosition`, **independent of the viewmodel**; only tracers use the
muzzle. FMJ penetration, breakable glass, M203 (H toggle, 1.6 s cooldown,
45 m/s, 11 m radius), MATADOR (6 m radius, 2 charges), AI gunshot broadcast.

Existing bug: in throwable slot, `updateAds` re-enables the hidden gun every frame.

## Performance

18-25 meshes per viewmodel, nothing merged, 4-6 unfrozen StandardMaterials
(some unused). Per-frame allocations in `updateAds`. Per shot: 3 geometry
create/dispose cycles (~45 meshes/s at 900 rpm). Material leaks in
Projectile.ts and ThrowableController.ts (new material per event).
Target: merge body per material → 2-4 draw calls per weapon, keep body and
sight meshes separate for the ADS hide logic.
