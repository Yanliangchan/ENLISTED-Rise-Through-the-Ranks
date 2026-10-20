# Audit: Characters, Enemies, Animation

Read-only audit, 2026-10-20. Line refs are to the tree at commit `4e29122`.

All characters are runtime `MeshBuilder` primitives. No skeletons, no glTF.
A No. 4 camo generator exists (`src/ui/saf.ts:92-170`) but **only the 2D UI
uses it**; no 3D mesh wears camo.

## Inventory

| Model | Built at | Construction | V | T | Rec. | Pri |
|---|---|---|---|---|---|---|
| OPFOR soldier (grunt/marksman/heavy/officer share one body) | `EnemyAI.ts:288-439` | 20 meshes, ~18 draw calls, 1 mat/enemy + 6 shared + class accent | 2 | 2 | **Rebuild** | P0 |
| BOTTY companion | `Botty.ts:143-248` | 16 meshes, 8 per-instance mats | 2 | 2 | Rebuild on shared friendly builder | P1 |
| NetAvatar (MP) | `NetMatch.ts:52-157` | 28 meshes, 9 mats + 2 DynamicTextures | 2.5 | 2 | Rebuild on shared builder | P1 |
| Player arms | none | — | — | — | Build gloved hands + No.4 sleeves | P1 (with viewmodels) |
| Range target | `RangeTarget.ts:73-110` | 3 boxes + decals | 3 | 4 | Retain (optional Figure-11 texture) | P3 |
| Gear visuals | `Gear.ts` | stats only; FAST helmet/No.4/LBV have no visuals | — | — | Add visual hooks | P2 |
| Drones | none | only in story text | — | — | Remove text or build | P3 |

OPFOR problems: flat orange (0.86,0.36,0.14) overalls; arms hang straight
while the rifle floats (not held); legs pivot from box centre, not hip; classes
differ only by a 10 cm chest patch (heavy's patch is invisible against its
vest); no heavy armour, no marksman optic. Death squashes to 16% and drops
0.7 m, so **the corpse vanishes underground**. `root.dispose(false,true)`
disposes the **shared cached materials** still handed out by a WeakMap cache
(latent bug).

BOTTY: face uses the body material (green face); **vest is buried inside the
torso**; never animated; arms/legs not pickable.

NetAvatar: best-dressed (pack, pouches, knee pads) but flat colour despite a
"pixelised green" comment; no limb animation; crouch = scale 0.66.

## Contract replacements must preserve

- `root`: invisible capsule `Mesh` (h 1.7, r 0.3), `isPickable=false`,
  `checkCollisions=true`, `ellipsoid (0.3,0.85,0.3)`, `ellipsoidOffset (0,0.85,0)`.
  **Origin at the feet (y=0)**, model faces **+Z** (FOV test uses
  `root.rotation.y`). Movement via `root.moveWithCollisions`.
- `visualRoot`: TransformNode under root, scaling 0.95; AI bob writes
  `visualRoot.position.y`; BOTTY down state writes `visualRoot.scaling=(1,0.2,1)`.
- Hit meshes: `metadata = { damageable, hitZone: "head"|"body"|"limb", isHeadshotMesh }`
  (`Damageable.ts:23-36`). Head = weapon headshot multiplier, body 1.5×, limb 1.0×.
  Enemy hit meshes: `${id}_body`, `${id}_head`, 2 arms, 2 legs.
- **Every decorative mesh must be `isPickable=false`**; hit meshes must keep the
  `damageable` tag (AI LOS skips them; otherwise enemies self-occlude).
- Hitbox geometry (local, pre-0.95): torso 0.56×1.0×0.36 at y 0.98; head
  0.27×0.3×0.27 at y 1.67. Enemy eye root+1.6. Keep sizes (headshot balance).
- Per-frame animated: `legMeshes[0/1].rotation.x = ±sin(phase)*0.5` (phase
  += dt×9); `rifleNode` position.y/rotation.x reload dip; root yaw.
- Hit flash mutates per-enemy `bodyMat.emissiveColor` for 80 ms.
- Death: scaling/drop then 4 s then dispose; spawner keeps corpses until `disposed`.
- Shared materials ⇒ dispose with `disposeMaterialAndTextures=false`.
- `admitLightToFrozenWorld` freezes **all** scene materials on each flare
  throw, which can stall hit-flash emissive updates.
- MP team colours: blue (0.3,0.56,0.85), red (0.85,0.36,0.3), applied to accent
  band, number textures, nameplate.

## Camouflage

`safCamoDataUrl()` palette `#79805f #55663f #3a4a31 #26301f #151b11` + brown
`#5c5738`, weights 0.16/0.30/0.26/0.16/0.06/0.06, majority-vote smoothing.
Problems vs real No. 4: too dark/desaturated (three near-black olives), no true
light green, "brown" is olive-khaki, brown/black only 6% each, smoothing gives
rounded blobs instead of crisp rectilinear pixel clusters.

## Animation states

Enemy walk: legs ±0.5 rad from box centre, 4 cm bob, arms static (2/5).
Idle/attack/alerted: static, no aim pose, no recoil (1/5). Reload: rifle dip
(2/5). Suppressed/stunned: none. Hit: 80 ms flash (3/5). Death: vanishes
underground (1/5). BOTTY and avatars: translate/yaw only (1/5).

## Performance

Enemy 20 meshes (~18 draw calls), BOTTY 16, avatar 28. No instancing,
cloning, thin instances or merging; default 32/24 tessellation. Live enemy cap
22 → worst case ≈ 400 draw calls from soldiers. AI ticks LOD by distance; no
render LOD. Target: 3-6 draw calls per soldier via per-class merged templates
with pivot nodes, shared camo texture, per-instance hit tint.
