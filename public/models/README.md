# Optional `.glb` model assets

The game ships with **procedural, code-built** models for everything
(buildings, weapons, soldiers). This folder lets you replace them with real
`.glb` models **without touching any code** — if a file below is present it's
loaded automatically; if it's absent the game silently keeps its procedural
version. See `src/core/ModelLoader.ts` and `upgradeBuildingsWithModels` in
`src/world/Level.ts`.

## Buildings (`buildings/`)

Drop in any of these and every building of that type uses it:

| File | Replaces | Authoring convention |
| --- | --- | --- |
| `buildings/hdb.glb` | HDB residential towers | 1×1 footprint, ~1 tall, **origin at base centre** |
| `buildings/cbd.glb` | CBD glass towers | same |
| `buildings/industrial.glb` | industrial / warehouse blocks | same |
| `buildings/shophouse.glb` | shophouse blocks | same |

Each model is authored to a **unit footprint (1 × 1) with its base at y = 0**;
the game scales it non-uniformly to each block's real width/height, so one
model tile serves every building of that type. Model the tower once at unit
size and let the game stretch it.

> This folder ships **no `.glb` files** — the pipeline is dormant and every
> building stays procedural until you add one. To see the loader work with a
> throwaway placeholder, run `node scripts/gen_placeholder_glb.mjs` (writes
> `buildings/hdb.glb`); delete it to go back to procedural. Replace it with a
> real CC0 model for an actual visual upgrade.

## Where to get real CC0 Singapore-style models

These sources publish **CC0 (public-domain) `.glb`/`.gltf`** assets you can use
freely. Download, confirm the licence yourself, rename to the filenames above,
and drop them in:

- **Quaternius** (quaternius.com) — CC0 low-poly buildings, vehicles, weapons, characters.
- **Kenney** (kenney.nl) — CC0 asset packs incl. city kits and weapons.
- **KayKit** (kaylousberg.itch.io) — CC0 low-poly kits.
- **Poly Pizza** (poly.pizza) — filter by CC0; low-poly props/buildings.

For a Singapore look, an HDB slab block and a glass CBD tower from any low-poly
city kit read well once scaled. (This repo intentionally ships **no** downloaded
binaries — the sandbox can't reach these hosts, and asset licences must be
verified by a human before committing them.)

## Weapons (`weapons/`)

`weapons/` is reserved for per-weapon models (`sar21.glb`, `br18.glb`, etc.).
The weapon-viewmodel loader is not wired yet because a first-person weapon model
also needs a per-model muzzle/sight/scale config to line up with ADS — ask for
it to be wired once you have real weapon `.glb` files to tune against.
