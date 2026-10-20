# ENLISTED: Art Direction (single source of truth)

Every agent reads this before building anything. Changes to this file go
through the integration owner (Agent J role) and are logged in PROGRESS.md.

## 1. Identity in one sentence

**Grounded tropical military realism**: a Singapore National Serviceman's
world (humid green camps, pale concrete, monsoon drains, container
terminals) rendered with believable materials and readable silhouettes, at
a browser-friendly budget.

Reference realism level: grounded, slightly simplified realism (think modern
tactical shooters at medium settings). **Not** cartoon, not low-poly
stylised, not hyper-detailed photoreal. Silhouette and material truth matter
more than micro-detail.

## 2. Geometry and silhouette rules

- No raw unbevelled boxes on hero assets (weapons, hands, soldiers, cover
  props within 10 m of play). Use **extruded 2D profiles** (side
  silhouettes traced from the reference proportions), **lathed** round parts,
  and chamfered boxes (`chamferBox` helper).
- Real-world scale in metres. Weapons are built at **true dimensions** from
  REFERENCES.md (SAR 21 = 0.805 m long). First-person framing is achieved by
  camera-local placement, never by distorting proportions.
- Defining features first: each asset's reference pack lists its 3-5
  defining silhouette features; these must be present and correctly placed
  before any secondary detail is added.
- Tessellation proportional to screen size: viewmodel cylinders 16-24
  segments; world props 8-12; distant 6.

## 3. Conventions

| Item | Convention |
|---|---|
| Units | metres |
| Forward | +Z (models face +Z) |
| Up | +Y |
| Character origin | feet, y = 0 |
| Viewmodel origin | rear of pistol grip at hand height; `sightOffset` on optic axis |
| Pivots | real joints: hip, knee, shoulder, elbow, neck, rifle grip |
| Naming | `<owner>_<part>` e.g. `vm_sar21_body`, `opfor_<id>_head` |
| Hit meshes | invisible or visible boxes exactly matching current hitbox sizes |
| Decorative meshes | `isPickable = false` always |

## 4. Colour palette

### World (linear-ish sRGB hex, as authored in canvas textures)

| Role | Hex | Notes |
|---|---|---|
| Tropical foliage dark | `#2c3d22` | under-canopy |
| Foliage mid | `#4a6332` | |
| Foliage light / grass | `#7a8a46` | sunlit lalang |
| Camp concrete (painted) | `#d8d2c0` | cream-white blocks |
| Bare concrete | `#9c978a` | |
| Trim green | `#3f5a3a` | camp building trims, doors |
| Laterite / dirt | `#8a6a48` | red-brown tropical soil |
| Asphalt | `#3a3b3c` | |
| Drain/algae stain | `#4b5238` | |
| Container accents | muted: `#7a3a2c #2f4d6b #8a7a3e #4f5e4a` | weathered, never saturated |

### SAF No. 4 (corrected, see REFERENCES.md R-03)

| Colour | Hex | Share |
|---|---|---|
| Brown base | `#6b5a40` | ~22% |
| Moss green (light) | `#7d8a55` | ~26% |
| Foliage green (mid) | `#4f6236` | ~30% |
| Dark green | `#2f3d24` | ~14% |
| Black | `#1b1d17` | ~8% |

Crisp 1 cm pixels clustered into 4-12 cm rectilinear macro shapes. Solid
olive equipment: `#4b5233`.

### OPFOR (fictional, non-SAF)

Sand-khaki fatigues `#a89a72` with darker tan blotch, charcoal plate carrier
and helmet `#2b2c2a`, dark balaclava. Class read by silhouette and kit:
grunt = rifle + carrier; marksman = long DMR with scope + boonie hat;
heavy = bulky armour, larger helmet with visor, LMG; officer = beret + no
helmet + sidearm/rifle. A desaturated red armband `#8a2e22` on the left
arm is the team identifier. No national insignia.

Rationale: tan against green tropical environments gives an immediate
friend/foe read without the emissive cartoon orange.

## 5. Material standards (PBR metal/roughness)

| Surface | Albedo | Metallic | Roughness | Notes |
|---|---|---|---|---|
| Gun steel (parkerised) | `#2a2b2c` | 0.85 | 0.45 | edge wear lighter `#5a5b5c` |
| Gun polymer (olive) | `#3d4232` | 0 | 0.62 | SAR 21 body |
| Gun polymer (black) | `#1e1f1f` | 0 | 0.58 | |
| Aluminium (anodised) | `#2c2d2e` | 0.7 | 0.38 | rails, optics |
| Glass lens | `#0c1414` | 0.1 | 0.05 | slight green tint, alpha not needed |
| Translucent mag | `#4a4a40` | 0 | 0.35 | alpha 0.75 |
| Fabric (No. 4) | camo texture | 0 | 0.88 | normal: weave |
| Nylon webbing | `#4b5233` | 0 | 0.8 | |
| Skin | `#b8866a` (SG range: `#c99a7a`-`#8a5e45`) | 0 | 0.6 | |
| Glove (nomex) | `#3a3a32` | 0 | 0.85 | |
| Concrete | per palette | 0 | 0.9 | detail normal |
| Painted metal | per palette | 0.2 | 0.55 | |
| Wood | `#6b4f34` | 0 | 0.75 | |

All shared materials are created **once** in `src/render/materials.ts` and
reused. No per-instance duplicates of identical materials.

## 6. Texture standards

- Generated at runtime via canvas (no binary assets), seeded RNG, cached
  per scene.
- Sizes: camo 512², weapon detail 256², world surfaces 512². Max 1024.
- Texel density targets: viewmodel ~1024 px/m, characters ~256 px/m, world
  ~128 px/m.
- Each hero texture pairs albedo with a detail normal; roughness variation
  baked into albedo-driven `microSurface` where possible.

## 7. Lighting and grading

- **Day**: high tropical sun, warm (`#fff3dc`), intensity ~2.4 with ACES
  exposure ~1.0; soft sky ambient bluish-white; humidity haze (aerial
  perspective) beginning ~80 m. Shadows soft but present.
- **Night**: cool moon (`#9fb3d6`) intensity ~0.25, ambient ~0.12, sodium
  lamps (`#ffb35c`) as local sources; fog near-black green; flashlights
  matter.
- **Interiors**: neutral daylight fluorescent `#f2f5f0`.
- Grading: gentle olive bias in shadows, neutral highlights, saturation -5.
  No crushed blacks (min luminance ~0.02), no blown sky (sun disc only).
  Bloom subtle (threshold ≥ 0.9).
- **Sky**: gradient dome (zenith `#5f8fc4` → horizon `#cfd9dc` haze by day)
  with a sun disc aligned to the actual sun light; cumulus band near the
  horizon. Never a cube with repeated faces.

## 8. VFX standards

- Muzzle flash: 2-3 crossed alpha quads + short point of light, 1 frame on,
  random roll/scale; suppressed = 30% size, no light.
- Tracers: every 3rd round for rifles, 1-2 cm wide camera-facing streak,
  60-90 ms, warm `#ffd28a`.
- Impacts: per-surface puff (concrete dust grey, dirt brown, metal sparks),
  plus a pooled bullet-hole decal (max 64, oldest recycled).
- Explosions: bright core flash (≤ 0.12 s) → fire ball → dark grey smoke
  column; debris; scale true-to-size (frag ~3 m, MATADOR ~6 m).
- Everything pooled; no per-event material creation.

## 9. Animation and game feel

- Viewmodel: hip sway from mouse velocity (lag), walk bob (figure-8,
  amplitude ~6 mm), sprint pose (lowered + canted), recoil kick (back +
  muzzle rise, recovers ~90 ms), equip raise 0.25 s, reload motion (mag
  out/in dip with tilt).
- Characters: hip/knee walk cycle, arms holding the rifle with both hands,
  aim pitch on the upper body, recoil twitch when firing, collapse death
  that ends on the ground (not under it).

## 10. UI

- Fonts: load **Roboto Condensed** (UI) and **Roboto Mono** (data) from
  Google Fonts; fallbacks Arial Narrow / monospace.
- One button system (`.mil-btn`), one panel system (`.mil-panel`).
- Palette = `saf.ts` tokens only. No bright green, no glow, no cyan.
- Minimum UI text 11 px; labels contrast ≥ 4.5:1.
- No emoji as icons; no placeholder text; no debug UI outside `?debug`.

## 11. Budgets

| Asset | Draw calls | Triangles | Materials |
|---|---|---|---|
| Viewmodel (weapon + hands) | ≤ 6 | ≤ 20k | shared |
| Soldier (any) | ≤ 8 | ≤ 6k | shared + 1 tint |
| Live soldiers on screen | 22 cap | — | — |
| Whole frame (city) | ≤ +10% vs baseline meshes | | |

## 12. Review gates

Each asset gets two verdicts recorded in `docs/overhaul/CATALOGUE.md`:
**Visual quality** and **SAF authenticity**, each Approved / Revision
required / Rejected, with the reason. Both must be Approved. "Better than
before" is not a pass.
