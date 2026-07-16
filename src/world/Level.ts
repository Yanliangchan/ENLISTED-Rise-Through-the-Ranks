import {
  Scene,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  DynamicTexture,
  Texture,
  Color3,
  Color4,
  Vector3,
  Mesh,
  AbstractMesh,
  Material,
  TransformNode,
  VertexData,
  ShadowGenerator,
  ReflectionProbe,
  RenderTargetTexture,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials";
import { WorldMaterial } from "@/world/WorldMaterial";
import { loadGlbContainerOrNull } from "@/core/ModelLoader";

/** Deterministic PRNG so the map layout is identical on every load. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHOPHOUSE_COLORS = [
  new Color3(0.55, 0.5, 0.42),
  new Color3(0.58, 0.46, 0.36),
  new Color3(0.6, 0.42, 0.32),
  new Color3(0.5, 0.4, 0.3),
];
const HDB_COLORS = [
  new Color3(0.72, 0.72, 0.7),
  new Color3(0.66, 0.68, 0.7),
  new Color3(0.75, 0.74, 0.68),
  new Color3(0.88, 0.89, 0.87), // clean white HDB block
  new Color3(0.85, 0.86, 0.84),
];
const HDB_ACCENT = new Color3(0.3, 0.42, 0.52);
const CBD_GLASS_COLORS = [new Color3(0.3, 0.42, 0.5), new Color3(0.35, 0.45, 0.42), new Color3(0.28, 0.38, 0.48)];
const INDUSTRIAL_COLORS = [new Color3(0.5, 0.42, 0.32), new Color3(0.42, 0.44, 0.46), new Color3(0.46, 0.38, 0.3)];

/**
 * Grid line positions — buildings are centred on these (the street grid's
 * "blocks"). Each line is nudged off its nominal evenly-spaced position by a
 * bounded, seeded random offset instead of sitting on a perfectly regular
 * lattice, so block widths and road lengths vary and the map reads as a
 * grown city rather than graph paper — while every other system (radar,
 * spawn clearance, cover/vehicle placement...) still just iterates the
 * array, unaware the spacing is irregular.
 */
function buildIrregularGridLines(): number[] {
  const rand = mulberry32(4004);
  const nominalSpacing = 22;
  const count = 8;
  const start = -((count - 1) * nominalSpacing) / 2;
  const lines: number[] = [];
  for (let i = 0; i < count; i++) {
    const nominal = start + i * nominalSpacing;
    const jitter = (rand() - 0.5) * 6; // +-3m — comfortably under half the nominal spacing
    lines.push(Math.round((nominal + jitter) * 10) / 10);
  }
  return lines;
}
const GRID_LINES = buildIrregularGridLines();
/** Midpoints between (irregular) grid lines — always clear of building footprints, so roads/props live here; road spacing now varies naturally with block size instead of being perfectly uniform. */
const MID_LINES = GRID_LINES.slice(0, -1).map((v, i) => Math.round(((v + GRID_LINES[i + 1]) / 2) * 10) / 10);
const MAP_SPAN = 200;
const BOUNDARY_HALF = 100;

/** South-west quadrant reserved for the park district — kept clear of street-grid buildings. */
const GARDEN_BOUNDS = { minX: -90, maxX: -18, minZ: -90, maxZ: -18 };
/** North-east quadrant, inner blocks — CBD glass-tower cluster. */
const CBD_BOUNDS = { minX: 11, maxX: 90, minZ: 11, maxZ: 90 };
/** South-east quadrant, outer blocks — industrial/logistics estate. */
const INDUSTRIAL_BOUNDS = { minX: 33, maxX: 90, minZ: -90, maxZ: -33 };
/** Footprint reserved for the Marina-Bay-Sands landmark — kept clear of street-grid buildings so its towers/deck don't intersect anything. */
const MBS_BOUNDS = { minX: 10, maxX: 62, minZ: 76, maxZ: 100 };
function inMbsZone(x: number, z: number, margin: number): boolean {
  return x > MBS_BOUNDS.minX - margin && x < MBS_BOUNDS.maxX + margin && z > MBS_BOUNDS.minZ - margin && z < MBS_BOUNDS.maxZ + margin;
}
/** Footprint reserved for the cargo terminal — kept clear so containers/lanes aren't blocked by grid buildings. */
const CARGO_BOUNDS = { minX: 42, maxX: 82, minZ: -90, maxZ: -48 };
function inCargoZone(x: number, z: number, margin: number): boolean {
  return x > CARGO_BOUNDS.minX - margin && x < CARGO_BOUNDS.maxX + margin && z > CARGO_BOUNDS.minZ - margin && z < CARGO_BOUNDS.maxZ + margin;
}
/** Footprint reserved for the multi-storey car park (NW, in the HDB district). */
const CARPARK_POS = new Vector3(-48, 0, 46);
const CARPARK_BOUNDS = { minX: -60, maxX: -36, minZ: 34, maxZ: 58 };
function inCarparkZone(x: number, z: number, margin: number): boolean {
  return (
    x > CARPARK_BOUNDS.minX - margin && x < CARPARK_BOUNDS.maxX + margin && z > CARPARK_BOUNDS.minZ - margin && z < CARPARK_BOUNDS.maxZ + margin
  );
}

/** Concealed forest clearing in the map's SW corner — the player's tented deployment point. */
export const CAMP_POSITION = new Vector3(-82, 2, -82);
const CAMP_CLEARING_RADIUS = 10;

export type BuildingType = "shophouse" | "hdb" | "cbd" | "industrial";

export interface BuildingFootprint {
  x: number;
  z: number;
  size: number;
  height: number;
  type: BuildingType;
}

function inGardenDistrict(x: number, z: number, margin: number): boolean {
  return (
    x > GARDEN_BOUNDS.minX - margin &&
    x < GARDEN_BOUNDS.maxX + margin &&
    z > GARDEN_BOUNDS.minZ - margin &&
    z < GARDEN_BOUNDS.maxZ + margin
  );
}

function overlapsAnyBuilding(x: number, z: number, clearance: number, layout: BuildingFootprint[]): boolean {
  for (const b of layout) {
    const halfSpan = b.size / 2 + clearance;
    if (Math.abs(x - b.x) < halfSpan && Math.abs(z - b.z) < halfSpan) return true;
  }
  return false;
}

/** Road hierarchy: the single centre line is the wide avenue, the next ring in are streets, the outer ring is narrow service road. */
type RoadKind = "avenue" | "street" | "service";
function roadKind(pos: number): RoadKind {
  const idx = MID_LINES.indexOf(pos);
  const distFromCentre = Math.abs(idx - 3);
  if (distFromCentre === 0) return "avenue";
  if (distFromCentre === 3) return "service";
  return "street";
}
function roadHalfWidth(kind: RoadKind): number {
  return kind === "avenue" ? 6 : kind === "street" ? 4.2 : 2.6;
}
/** Distance from (x,z) to the nearest road centreline, used to keep cover/props off the actual carriageway. */
function distanceToNearestRoad(x: number, z: number): number {
  let best = Infinity;
  for (const m of MID_LINES) {
    best = Math.min(best, Math.abs(x - m) - roadHalfWidth(roadKind(m))); // NS road at x=m
    best = Math.min(best, Math.abs(z - m) - roadHalfWidth(roadKind(m))); // EW road at z=m
  }
  return best;
}

/**
 * Deterministic building layout — the single source of truth for both the
 * collidable meshes (buildStreetGrid) and the HUD radar, so the minimap
 * always matches the real map instead of drifting out of sync. Pure/no
 * scene side effects — safe to call from UI code. The south-west quadrant
 * is left clear for the park district; the north-east inner blocks lean CBD
 * (glass towers), the south-east outer blocks lean industrial.
 */
export function generateBuildingLayout(): BuildingFootprint[] {
  const rand = mulberry32(1337);
  const layout: BuildingFootprint[] = [];
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      if (inGardenDistrict(gx, gz, 10)) continue; // reserved for the park
      if (inMbsZone(gx, gz, 4)) continue; // reserved for the MBS landmark (no intersecting blocks)
      if (inCargoZone(gx, gz, 3)) continue; // reserved for the cargo terminal
      if (inCarparkZone(gx, gz, 2)) continue; // reserved for the multi-storey car park

      const inCbd = gx >= CBD_BOUNDS.minX && gz >= CBD_BOUNDS.minZ;
      const inIndustrial = gx >= INDUSTRIAL_BOUNDS.minX && gz <= INDUSTRIAL_BOUNDS.maxZ;

      let type: BuildingType;
      if (inCbd && rand() < 0.78) type = "cbd";
      else if (inIndustrial && rand() < 0.7) type = "industrial";
      else type = rand() < 0.32 ? "hdb" : "shophouse";

      // Tighter city: fewer skipped lots than before, so blocks sit closer
      // together and intersections come up more often as you move around.
      const skipChance = type === "hdb" ? 0.08 : type === "cbd" ? 0.1 : type === "industrial" ? 0.12 : 0.14;
      if (rand() < skipChance) continue; // gap: open flanking route / sightline break

      const jitterX = (rand() - 0.5) * 2.4;
      const jitterZ = (rand() - 0.5) * 2.4;
      const x = gx + jitterX;
      const z = gz + jitterZ;

      if (type === "cbd") {
        layout.push({ x, z, size: 10 + rand() * 4, height: 32 + rand() * 26, type });
      } else if (type === "industrial") {
        layout.push({ x, z, size: 14 + rand() * 6, height: 7 + rand() * 4, type });
      } else if (type === "hdb") {
        layout.push({ x, z, size: 9 + rand() * 4, height: 24 + rand() * 16, type });
      } else {
        layout.push({ x, z, size: 10 + rand() * 6, height: 8 + rand() * 10, type });
      }
    }
  }
  return layout;
}

/**
 * Dense Singapore-inspired urban-estate map: a tight street grid mixing
 * shophouse blocks, HDB-style towers, a CBD glass-tower cluster, and an
 * industrial/logistics estate around a clear central plaza (player spawn).
 * Roads carry a real hierarchy (avenue/street/service) with sidewalks,
 * crosswalks, traffic lights and bus stops; a park district with a lake,
 * canal, and dense tropical planting anchors the south-west corner around
 * the player's concealed camp; a Marina-Bay-Sands-style landmark and an
 * elevated MRT viaduct anchor the skyline. Evocative dressing, not a real
 * streetscape. Spawn points (EnemySpawner) ring the outside so OPFOR has to
 * move through the blocks and cover to reach the plaza.
 */
export function buildLevel(scene: Scene): void {
  const hemi = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.65;
  // Cool sky from above, warm asphalt bounce from below — the two-tone ambient
  // is what stops flat unlit faces reading as uniform cardboard.
  hemi.diffuse = new Color3(0.92, 0.96, 1.0);
  hemi.groundColor = new Color3(0.38, 0.35, 0.3);

  const sun = new DirectionalLight("sunLight", new Vector3(-0.5, -1, 0.3), scene);
  // PBR surfaces respond physically to light energy — the sun carries most of
  // the scene's illumination now that materials are metallic/roughness based.
  sun.intensity = 1.6;
  // Shadow-map camera origin: hoisted far back along the light direction so
  // the tallest towers sit inside the depth frustum (a directional light left
  // at the default origin clips everything above y≈1 out of the shadow map).
  sun.position = new Vector3(90, 180, -54);
  sun.autoCalcShadowZBounds = true;
  // Warm tropical sunlight so lit faces separate from shadowed ones in colour, not just brightness.
  sun.diffuse = new Color3(1.0, 0.95, 0.85);
  sun.specular = new Color3(1.0, 0.97, 0.9);

  // Soft cool fill from the opposite azimuth: walls facing away from the sun
  // previously took only hemispheric light (≈half intensity on verticals) and
  // rendered near-black; this keeps them shaped and readable without
  // flattening the sun/shade contrast.
  const fill = new DirectionalLight("fillLight", new Vector3(0.45, -0.35, -0.35), scene);
  fill.intensity = 0.32;
  fill.diffuse = new Color3(0.75, 0.82, 0.9);
  fill.specular = Color3.Black();

  // Distance fog for depth/atmosphere — cheap (no extra draw calls) and hides the
  // ground/building pop-in at the far edge of the play space.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 65;
  scene.fogEnd = 195;
  scene.fogColor = new Color3(0.5, 0.58, 0.68);

  const groundMat = new WorldMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.3, 0.32, 0.28);
  groundMat.specularColor = Color3.Black();
  const pavementTex = createPavementTexture(scene, "pavementTex", "#4a4d46");
  pavementTex.uScale = 50;
  pavementTex.vScale = 50;
  groundMat.diffuseTexture = pavementTex;

  const ground = MeshBuilder.CreateGround("ground", { width: MAP_SPAN + 20, height: MAP_SPAN + 20 }, scene);
  ground.material = groundMat;
  ground.checkCollisions = true;

  const skyBox = buildSkybox(scene);

  // HDR image-based lighting: render the procedural sky into a cube once and
  // feed it to every PBR material as the environment — sky-blue ambient from
  // above, warm horizon bounce from the sides, and a real reflection source
  // for glass towers, car paint, and water.
  const envProbe = new ReflectionProbe("envProbe", 128, scene);
  envProbe.renderList!.push(skyBox);
  envProbe.position.set(0, 40, 0);
  envProbe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.environmentTexture = envProbe.cubeTexture;
  scene.environmentIntensity = 1.0;

  const layout = generateBuildingLayout();
  buildRoads(scene);
  buildCurbs(scene);
  buildIntersectionDressing(scene, layout);
  buildStreetGrid(scene, layout);
  buildStrongpoints(scene, layout);
  // Optional: swap procedural buildings for real .glb models where present.
  // Fire-and-forget — a no-op with no assets, so buildLevel stays synchronous.
  void upgradeBuildingsWithModels(scene, layout);
  buildHawkerCentre(scene, layout);
  buildPlazaTerrace(scene, layout);
  buildCoveredWalkways(scene, layout);
  buildCover(scene, layout);
  buildParkedCars(scene, layout);
  buildStreetFurniture(scene, layout);
  buildUrbanClutter(scene, layout);
  buildRoadsideTrees(scene, layout);
  buildContainerYard(scene);
  buildCarPark(scene);
  buildGardenDistrict(scene);
  buildDrainageCanal(scene);
  buildMbsLandmark(scene);
  buildMrtViaduct(scene);
  buildMrtStation(scene);

  const wallMat = new WorldMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.5, 0.5, 0.52);
  wallMat.specularColor = Color3.Black();

  const b = BOUNDARY_HALF;
  const perimeter: Array<[number, number, number, number]> = [
    // x, z, width, depth
    [0, -b, MAP_SPAN + 20, 1],
    [0, b, MAP_SPAN + 20, 1],
    [-b, 0, 1, MAP_SPAN + 20],
    [b, 0, 1, MAP_SPAN + 20],
  ];
  perimeter.forEach(([x, z, width, depth], i) => {
    const wall = MeshBuilder.CreateBox(`boundary_${i}`, { width, height: 6, depth }, scene);
    wall.position.set(x, 3, z);
    wall.material = wallMat;
    wall.checkCollisions = true;
    wall.isVisible = false; // invisible playspace boundary
  });

  // ---- Static-world performance pass ------------------------------------
  // 1) Batch: thousands of small decorative meshes (sandbag courses, tree
  //    canopy lobes, ferns, curbs, trim bands...) collapse into one mesh per
  //    material — the draw-call count drops by an order of magnitude while
  //    the rendered image is identical.
  mergeStaticDecor(scene);

  // 2) Shadows: one static PCF-filtered shadow map from the sun, rendered a
  //    single time (the whole city is immobile) — soft real shadows for every
  //    building/prop at effectively zero per-frame cost.
  setupStaticShadows(scene, sun, skyBox);

  // 3) Freeze: everything built above never moves, rotates, or scales again,
  //    so stop Babylon recomputing world matrices every frame; likewise the
  //    level materials never change after construction. Dynamic actors
  //    (player, enemies, viewmodels, particles, ambience) are all created
  //    AFTER buildLevel returns, so nothing frozen here ever needs to move.
  for (const mesh of scene.meshes) {
    mesh.freezeWorldMatrix();
    // Cheap sphere-only culling for the (now mostly merged) static set.
    mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
  }
  for (const material of scene.materials) {
    if (material.name === "skyMat") continue; // sky keeps its own update path
    material.freeze();
  }
}

/**
 * Collapses static, non-interactive decoration into one mesh per material.
 * Only meshes that can't affect gameplay are merged: no colliders, nothing
 * pickable (hitscan targets), nothing transparent (draw-order sensitive),
 * nothing tagged with metadata (the optional .glb upgrade path needs to find
 * those individually). Vertices are baked in world space, so parenting and
 * frozen transforms are irrelevant afterwards.
 */
function mergeStaticDecor(scene: Scene): void {
  const groups = new Map<string, { material: Material; meshes: Mesh[] }>();
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh)) continue;
    if (mesh.checkCollisions || mesh.isPickable) continue;
    if (!mesh.isVisible || !mesh.isEnabled()) continue;
    if (mesh.infiniteDistance) continue; // skybox
    if (mesh.metadata) continue; // glb-upgrade bookkeeping
    const mat = mesh.material;
    if (!mat || mat.needAlphaBlending()) continue;
    if (mesh.getTotalVertices() === 0) continue;
    // Meshes can only merge when their vertex layouts match — the custom
    // wedge prisms carry positions+normals but no UVs, unlike built-in boxes.
    const signature = mesh
      .getVerticesDataKinds()
      .sort()
      .join(",");
    const key = `${mat.uniqueId}|${signature}`;
    const group = groups.get(key) ?? { material: mat, meshes: [] };
    group.meshes.push(mesh);
    groups.set(key, group);
  }
  for (const { material, meshes } of groups.values()) {
    if (meshes.length < 4) continue; // not worth a merge
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (merged) {
      merged.name = `merged_${material.name}`;
      merged.isPickable = false;
    }
  }
}

/**
 * One 2048px PCF shadow map from the sun covering the whole (static) city,
 * rendered exactly once. Ground planes/decals don't cast; everything receives.
 */
function setupStaticShadows(scene: Scene, sun: DirectionalLight, skyBox: Mesh): void {
  const generator = new ShadowGenerator(2048, sun);
  generator.usePercentageCloserFiltering = true;
  generator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  generator.bias = 0.002;
  generator.normalBias = 0.05;

  const isGroundDecal = (name: string): boolean =>
    /^(ground|road|sidewalk|boulevard|crosswalk|grass|gardenGrass|campClearing|playgroundMat|drainFloor|drainWater|canal|lake|water)/i.test(
      name
    );

  for (const mesh of scene.meshes) {
    if (mesh === skyBox || mesh.infiniteDistance) continue;
    if (!mesh.isVisible || !mesh.isEnabled()) continue;
    if (mesh.material?.needAlphaBlending()) continue;
    if (!isGroundDecal(mesh.name)) generator.addShadowCaster(mesh, false);
    mesh.receiveShadows = true;
  }

  // The city never moves, so the map only needs rendering once — but locking
  // it on frame 1 bakes an empty map (caster shaders are still compiling on
  // the first frames and get skipped). Wait until every effect has compiled,
  // let a few real frames land, then freeze the last fully-rendered map.
  const map = generator.getShadowMap();
  if (map) {
    scene.executeWhenReady(() => {
      let settleFrames = 5;
      const observer = scene.onAfterRenderObservable.add(() => {
        settleFrames--;
        if (settleFrames <= 0) {
          map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
          scene.onAfterRenderObservable.remove(observer);
        }
      });
    });
  }
}

/**
 * Physically-plausible procedural sky (Preetham model via SkyMaterial) in place
 * of the flat clear-colour: a bright sun disc/halo, blue zenith falling to a
 * warm hazy horizon that the linear fog blends into. One box, no textures.
 */
function buildSkybox(scene: Scene): Mesh {
  const sky = new SkyMaterial("skyMat", scene);
  sky.backFaceCulling = false;
  sky.turbidity = 6.5; // light tropical haze
  sky.luminance = 1.02;
  sky.rayleigh = 2.1;
  sky.mieCoefficient = 0.006;
  sky.mieDirectionalG = 0.8;
  sky.useSunPosition = true;
  // Opposite of the sun DirectionalLight's direction (-0.5, -1, 0.3).
  sky.sunPosition = new Vector3(50, 100, -30);

  const box = MeshBuilder.CreateBox("skyBox", { size: 900 }, scene);
  box.material = sky;
  box.isPickable = false;
  box.infiniteDistance = true;
  box.applyFog = false;
  return box;
}

/**
 * Three enterable two-storey strongpoints on vacant lots nearest the plaza —
 * modern-FPS anchor pieces that each combat area routes around: a ground floor
 * with two door openings and all-round firing slits (hard cover with
 * sightlines), plus an external ramp to a parapeted rooftop (high ground).
 * Placed only on grid intersections with no building, so they never clip
 * roads, reserved districts, or other blocks.
 */
function buildStrongpoints(scene: Scene, layout: BuildingFootprint[]): void {
  const candidates: Array<{ x: number; z: number; d: number }> = [];
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      if (inGardenDistrict(gx, gz, 10) || inMbsZone(gx, gz, 4) || inCargoZone(gx, gz, 3) || inCarparkZone(gx, gz, 2)) continue;
      if (overlapsAnyBuilding(gx, gz, 7, layout)) continue;
      candidates.push({ x: gx, z: gz, d: Math.hypot(gx, gz) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  // More anchor pieces than before (3 -> 6) spread across the inner ring, so
  // every central approach has an enterable strongpoint with rooftop high
  // ground to fight around — the map reads as a series of tactical nodes rather
  // than one open plaza.
  const chosen = candidates.slice(0, 6);
  chosen.forEach((c, i) => buildStrongpoint(scene, c.x, c.z, i));
  // Register footprints so cover/vehicle scattering treats them like buildings.
  for (const c of chosen) {
    layout.push({ x: c.x, z: c.z, size: 10, height: 4, type: "industrial" });
  }
}

function buildStrongpoint(scene: Scene, cx: number, cz: number, index: number): void {
  const mat = solidMat(scene, `strongpointMat_${index}`, new Color3(0.52, 0.5, 0.46));
  const slabMat = solidMat(scene, `strongpointSlabMat_${index}`, new Color3(0.42, 0.42, 0.4));
  const half = 5;
  const wallH = 2.9;
  const t = 0.32; // wall thickness

  const wall = (name: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = MeshBuilder.CreateBox(`${name}_${index}`, { width: w, height: h, depth: d }, scene);
    m.position.set(cx + x, y, cz + z);
    m.material = mat;
    m.checkCollisions = true;
    return m;
  };

  // Front/back walls (±Z): door gap in the middle, lintel above.
  for (const side of [-1, 1]) {
    const segW = (half * 2 - 1.7) / 2;
    wall("spWall", segW, wallH, t, -(1.7 / 2 + segW / 2), wallH / 2, side * half);
    wall("spWall", segW, wallH, t, 1.7 / 2 + segW / 2, wallH / 2, side * half);
    wall("spLintel", 1.7, wallH - 2.15, t, 0, 2.15 + (wallH - 2.15) / 2, side * half);
  }
  // Side walls (±X): low wall + upper band leaving a continuous firing slit.
  for (const side of [-1, 1]) {
    wall("spLow", t, 1.35, half * 2, side * half, 1.35 / 2, 0);
    wall("spBand", t, wallH - 1.95, half * 2, side * half, 1.95 + (wallH - 1.95) / 2, 0);
  }

  // Walkable roof slab + parapet (gap on the ramp edge).
  const roof = MeshBuilder.CreateBox(`spRoof_${index}`, { width: half * 2 + 0.4, height: 0.25, depth: half * 2 + 0.4 }, scene);
  roof.position.set(cx, wallH + 0.13, cz);
  roof.material = slabMat;
  roof.checkCollisions = true;
  const parapetH = 0.85;
  const pY = wallH + 0.25 + parapetH / 2;
  wall("spParapet", half * 2 + 0.4, parapetH, 0.2, 0, pY, half);
  wall("spParapet", half * 2 + 0.4, parapetH, 0.2, 0, pY, -half);
  wall("spParapet", 0.2, parapetH, half * 2 + 0.4, -half, pY, 0);
  // Ramp-side parapet only covers half, leaving the arrival gap.
  wall("spParapet", 0.2, parapetH, half, half, pY, -half / 2);

  // External ramp up the +X face to the roof — the high-ground route.
  const rampLen = 7.5;
  const ramp = MeshBuilder.CreateBox(`spRamp_${index}`, { width: 1.6, height: 0.2, depth: rampLen }, scene);
  const rise = wallH + 0.25;
  ramp.position.set(cx + half + 0.9, rise / 2, cz + half - rampLen / 2 + 1.2);
  ramp.rotation.x = -Math.atan2(rise, rampLen);
  ramp.material = slabMat;
  ramp.checkCollisions = true;
  // Kick plate along the ramp's outer edge so you don't slide off mid-climb.
  const kick = MeshBuilder.CreateBox(`spRampKick_${index}`, { width: 0.12, height: 0.5, depth: rampLen }, scene);
  kick.position.set(cx + half + 1.72, rise / 2 + 0.2, cz + half - rampLen / 2 + 1.2);
  kick.rotation.x = ramp.rotation.x;
  kick.material = slabMat;
  kick.checkCollisions = true;

  // Interior soft cover: a couple of crates.
  for (const [ox, oz, s] of [[-2.2, -1.6, 1.0], [1.8, 2.0, 0.8]] as Array<[number, number, number]>) {
    const crate = MeshBuilder.CreateBox(`spCrate_${index}_${ox}`, { size: s }, scene);
    crate.position.set(cx + ox, s / 2, cz + oz);
    crate.material = solidMat(scene, `spCrateMat_${index}_${ox}`, new Color3(0.4, 0.35, 0.25));
    crate.checkCollisions = true;
  }
}

/**
 * Hawker centre on the vacant lots by the garden district's north edge — the
 * quintessential Singapore neighbourhood anchor. An open-sided food hall: a
 * raised floor slab, perimeter columns, a two-tier roof with clerestory vent,
 * a row of stall counters along the back, and round tables with stools that
 * double as scattered soft cover. Open on all sides = multiple entry routes.
 */
function buildHawkerCentre(scene: Scene, layout: BuildingFootprint[]): void {
  const cx = -55;
  const cz = -11;
  const W = 17; // along X
  const D = 13; // along Z
  const roofH = 3.5;

  const floorMat = solidMat(scene, "hawkerFloorMat", new Color3(0.55, 0.52, 0.46));
  const columnMat = solidMat(scene, "hawkerColumnMat", new Color3(0.72, 0.7, 0.64));
  const roofMat = solidMat(scene, "hawkerRoofMat", new Color3(0.45, 0.26, 0.2)); // terracotta
  const counterMat = solidMat(scene, "hawkerCounterMat", new Color3(0.35, 0.37, 0.4));
  const tableMat = solidMat(scene, "hawkerTableMat", new Color3(0.75, 0.73, 0.68));
  const stoolMat = solidMat(scene, "hawkerStoolMat", new Color3(0.65, 0.3, 0.15));
  const signColors = [new Color3(0.75, 0.2, 0.15), new Color3(0.15, 0.45, 0.6), new Color3(0.7, 0.55, 0.1), new Color3(0.2, 0.5, 0.25)];
  const signMats = signColors.map((c, i) => {
    const m = solidMat(scene, `hawkerSignMat_${i}`, c);
    m.emissiveColor = c.scale(0.25);
    return m;
  });

  const floor = MeshBuilder.CreateBox("hawkerFloor", { width: W, height: 0.18, depth: D }, scene);
  floor.position.set(cx, 0.09, cz);
  floor.material = floorMat;
  floor.checkCollisions = true;

  // Perimeter columns.
  const colXs = [-W / 2 + 0.5, -W / 6, W / 6, W / 2 - 0.5];
  const colZs = [-D / 2 + 0.5, D / 2 - 0.5];
  for (const px of colXs) {
    for (const pz of colZs) {
      const col = MeshBuilder.CreateBox(`hawkerCol_${px}_${pz}`, { width: 0.4, height: roofH, depth: 0.4 }, scene);
      col.position.set(cx + px, roofH / 2, cz + pz);
      col.material = columnMat;
      col.checkCollisions = true;
    }
  }

  // Two-tier roof with a raised clerestory vent band (hot-kitchen airflow).
  const roofLower = MeshBuilder.CreateBox("hawkerRoofLower", { width: W + 1.6, height: 0.22, depth: D + 1.6 }, scene);
  roofLower.position.set(cx, roofH, cz);
  roofLower.material = roofMat;
  roofLower.checkCollisions = true;
  const vent = MeshBuilder.CreateBox("hawkerVent", { width: W * 0.55, height: 0.7, depth: D * 0.5 }, scene);
  vent.position.set(cx, roofH + 0.55, cz);
  vent.material = columnMat;
  vent.isPickable = false;
  const roofUpper = MeshBuilder.CreateBox("hawkerRoofUpper", { width: W * 0.62, height: 0.18, depth: D * 0.56 }, scene);
  roofUpper.position.set(cx, roofH + 1.0, cz);
  roofUpper.material = roofMat;
  roofUpper.isPickable = false;

  // Stall row along the back (-Z): counters + coloured signboards.
  const stalls = 5;
  for (let s = 0; s < stalls; s++) {
    const sx = cx - W / 2 + 2.2 + s * ((W - 3.4) / (stalls - 1));
    const counter = MeshBuilder.CreateBox(`hawkerStall_${s}`, { width: 2.4, height: 1.1, depth: 1.0 }, scene);
    counter.position.set(sx, 0.73, cz - D / 2 + 1.3);
    counter.material = counterMat;
    counter.checkCollisions = true;
    const sign = MeshBuilder.CreateBox(`hawkerSign_${s}`, { width: 2.2, height: 0.5, depth: 0.08 }, scene);
    sign.position.set(sx, 2.6, cz - D / 2 + 1.0);
    sign.material = signMats[s % signMats.length];
    sign.isPickable = false;
  }

  // Round tables + stools — waist-high soft cover through the hall.
  const rand = mulberry32(2323);
  for (let t = 0; t < 8; t++) {
    const tx = cx - W / 2 + 3 + (t % 4) * ((W - 6) / 3) + (rand() - 0.5) * 0.8;
    const tz = cz + (t < 4 ? -0.6 : 3.2) + (rand() - 0.5) * 0.8;
    const table = MeshBuilder.CreateCylinder(`hawkerTable_${t}`, { diameter: 1.25, height: 0.78, tessellation: 12 }, scene);
    table.position.set(tx, 0.57, tz);
    table.material = tableMat;
    table.checkCollisions = true;
    for (let st = 0; st < 4; st++) {
      const a = (st / 4) * Math.PI * 2 + 0.5;
      const stool = MeshBuilder.CreateCylinder(`hawkerStool_${t}_${st}`, { diameter: 0.34, height: 0.45, tessellation: 8 }, scene);
      stool.position.set(tx + Math.cos(a) * 0.95, 0.4, tz + Math.sin(a) * 0.95);
      stool.material = stoolMat;
      stool.isPickable = false;
    }
  }

  // Register the footprint so scatter/cover systems treat it like a building.
  layout.push({ x: cx, z: cz, size: Math.max(W, D) + 1, height: roofH + 1, type: "shophouse" });
}

/**
 * A raised garden terrace on a vacant lot near the plaza: retaining walls,
 * a walkable top slab reached by two ramped stairs, perimeter railings and
 * planters. Adds the high/low-ground beat the flat street grid lacks right
 * where most fights happen.
 */
function buildPlazaTerrace(scene: Scene, layout: BuildingFootprint[]): void {
  // Nearest vacant lot to the plaza that isn't reserved or built on.
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      if (inGardenDistrict(gx, gz, 10) || inMbsZone(gx, gz, 4) || inCargoZone(gx, gz, 3) || inCarparkZone(gx, gz, 2)) continue;
      if (overlapsAnyBuilding(gx, gz, 7, layout)) continue;
      const d = Math.hypot(gx, gz);
      if (d < bestD) {
        bestD = d;
        best = { x: gx, z: gz };
      }
    }
  }
  if (!best) return;
  const cx = best.x;
  const cz = best.z;
  const S = 10;
  const H = 1.5;

  const wallMat = solidMat(scene, "terraceWallMat", new Color3(0.52, 0.5, 0.44));
  const topMat = solidMat(scene, "terraceTopMat", new Color3(0.34, 0.42, 0.26));
  const railMat = solidMat(scene, "terraceRailMat", new Color3(0.28, 0.3, 0.32));
  const planterMat = solidMat(scene, "terracePlanterMat", new Color3(0.44, 0.4, 0.34));
  const plantMat = solidMat(scene, "terracePlantMat", new Color3(0.2, 0.38, 0.18));

  // Retaining walls around the fill, then a walkable top slab.
  for (const [wx, wz, ww, wd] of [
    [0, -S / 2, S, 0.4],
    [0, S / 2, S, 0.4],
    [-S / 2, 0, 0.4, S],
    [S / 2, 0, 0.4, S],
  ] as Array<[number, number, number, number]>) {
    const wall = MeshBuilder.CreateBox(`terraceWall_${wx}_${wz}`, { width: ww, height: H, depth: wd }, scene);
    wall.position.set(cx + wx, H / 2, cz + wz);
    wall.material = wallMat;
    wall.checkCollisions = true;
  }
  const top = MeshBuilder.CreateBox("terraceTop", { width: S, height: 0.25, depth: S }, scene);
  top.position.set(cx, H + 0.05, cz);
  top.material = topMat;
  top.checkCollisions = true;

  // Two ramped stair approaches (opposite corners) with kick walls.
  for (const side of [-1, 1]) {
    const rampLen = 4.5;
    const ramp = MeshBuilder.CreateBox(`terraceRamp_${side}`, { width: 2, height: 0.18, depth: rampLen }, scene);
    ramp.position.set(cx + side * (S / 4), (H + 0.15) / 2, cz + side * (S / 2 + rampLen / 2 - 0.2));
    ramp.rotation.x = side * Math.atan2(H + 0.15, rampLen);
    ramp.material = wallMat;
    ramp.checkCollisions = true;
  }

  // Low railings along the two un-ramped edges (crouch cover on high ground).
  for (const side of [-1, 1]) {
    const rail = MeshBuilder.CreateBox(`terraceRail_${side}`, { width: 0.15, height: 0.85, depth: S }, scene);
    rail.position.set(cx + side * (S / 2 - 0.15), H + 0.6, cz);
    rail.material = railMat;
    rail.checkCollisions = true;
  }

  // Planter boxes on top — greenery + broken sightlines on the deck.
  for (const [px, pz] of [[-2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]] as const) {
    const planter = MeshBuilder.CreateBox(`terracePlanter_${px}_${pz}`, { width: 1.4, height: 0.5, depth: 1.4 }, scene);
    planter.position.set(cx + px, H + 0.4, cz + pz);
    planter.material = planterMat;
    planter.checkCollisions = true;
    const green = MeshBuilder.CreateSphere(`terraceGreen_${px}_${pz}`, { diameter: 1.5, segments: 6 }, scene);
    green.scaling.y = 0.55;
    green.position.set(cx + px, H + 0.85, cz + pz);
    green.material = plantMat;
    green.isPickable = false;
  }

  layout.push({ x: cx, z: cz, size: S + 1, height: H + 1, type: "shophouse" });
}

/**
 * Covered walkways linking nearby HDB blocks — the sheltered pedestrian
 * spine every Singapore estate has. Thin roofs on slim posts running from
 * block edge to block edge; purely visual dressing (no collision) so
 * movement stays smooth underneath.
 */
function buildCoveredWalkways(scene: Scene, layout: BuildingFootprint[]): void {
  const roofMat = solidMat(scene, "walkwayRoofMat", new Color3(0.78, 0.77, 0.72));
  const postMat = solidMat(scene, "walkwayPostMat", new Color3(0.4, 0.42, 0.44));
  const hdbs = layout.filter((b) => b.type === "hdb");
  const used = new Set<number>();
  let built = 0;

  for (let a = 0; a < hdbs.length && built < 7; a++) {
    if (used.has(a)) continue;
    for (let b = a + 1; b < hdbs.length; b++) {
      if (used.has(b)) continue;
      const A = hdbs[a];
      const B = hdbs[b];
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const dist = Math.hypot(dx, dz);
      const gap = dist - (A.size + B.size) / 2;
      if (gap < 6 || gap > 22) continue;
      const ux = dx / dist;
      const uz = dz / dist;
      const sx = A.x + ux * (A.size / 2 + 0.4);
      const sz = A.z + uz * (A.size / 2 + 0.4);
      const ex = B.x - ux * (B.size / 2 + 0.4);
      const ez = B.z - uz * (B.size / 2 + 0.4);
      const mx = (sx + ex) / 2;
      const mz = (sz + ez) / 2;
      if (overlapsAnyBuilding(mx, mz, 1, layout)) continue; // another block in the way
      const len = Math.hypot(ex - sx, ez - sz);
      const angle = Math.atan2(ex - sx, ez - sz);

      const roof = MeshBuilder.CreateBox(`walkwayRoof_${built}`, { width: 1.8, height: 0.09, depth: len }, scene);
      roof.position.set(mx, 2.5, mz);
      roof.rotation.y = angle;
      roof.material = roofMat;
      roof.isPickable = false;

      const posts = Math.max(2, Math.floor(len / 3.2));
      for (let p = 0; p <= posts; p++) {
        const t = p / posts;
        const px = sx + (ex - sx) * t;
        const pz = sz + (ez - sz) * t;
        for (const side of [-1, 1]) {
          const perp = angle + Math.PI / 2;
          const post = MeshBuilder.CreateCylinder(`walkwayPost_${built}_${p}_${side}`, { diameter: 0.09, height: 2.5 }, scene);
          post.position.set(px + Math.sin(perp) * side * 0.8, 1.25, pz + Math.cos(perp) * side * 0.8);
          post.material = postMat;
          post.isPickable = false;
        }
      }
      used.add(a);
      used.add(b);
      built++;
      break;
    }
  }
}

/**
 * Elevated MRT station on the viaduct: platform, canopy, a stair/lift core
 * down to a ground-level entrance, and a stopped three-car train — turns the
 * bare guideway into a recognisable piece of Singapore transit skyline.
 */
function buildMrtStation(scene: Scene): void {
  const z = 92;
  const cx = 40;
  const platformY = 10.4;

  const concrete = solidMat(scene, "mrtConcreteMat", new Color3(0.66, 0.66, 0.62));
  const canopyMat = solidMat(scene, "mrtCanopyMat", new Color3(0.3, 0.45, 0.4));
  const coreMat = solidMat(scene, "mrtCoreMat", new Color3(0.58, 0.6, 0.58));
  const trainBodyMat = solidMat(scene, "mrtTrainMat", new Color3(0.85, 0.86, 0.88));
  const trainStripeMat = solidMat(scene, "mrtStripeMat", new Color3(0.1, 0.5, 0.3));
  const trainGlassMat = solidMat(scene, "mrtGlassMat", new Color3(0.12, 0.16, 0.2));
  trainGlassMat.roughness = 0.25;

  // Side platform south of the guideway.
  const platform = MeshBuilder.CreateBox("mrtPlatform", { width: 24, height: 0.4, depth: 3.4 }, scene);
  platform.position.set(cx, platformY, z - 3.6);
  platform.material = concrete;
  platform.checkCollisions = true;

  // Canopy over the platform on slim columns.
  const canopy = MeshBuilder.CreateBox("mrtCanopy", { width: 24.6, height: 0.15, depth: 4.4 }, scene);
  canopy.position.set(cx, platformY + 3.1, z - 3.6);
  canopy.material = canopyMat;
  canopy.isPickable = false;
  for (const px of [-10, -3.4, 3.4, 10]) {
    const col = MeshBuilder.CreateCylinder(`mrtCanopyCol_${px}`, { diameter: 0.22, height: 3.1 }, scene);
    col.position.set(cx + px, platformY + 1.55, z - 3.6);
    col.material = concrete;
    col.isPickable = false;
  }

  // Stair/lift core from the platform down to a street-level entrance box.
  const core = MeshBuilder.CreateBox("mrtCore", { width: 4, height: platformY + 0.4, depth: 5 }, scene);
  core.position.set(cx - 14.5, (platformY + 0.4) / 2, z - 4.4);
  core.material = coreMat;
  core.checkCollisions = true;
  const entrance = MeshBuilder.CreateBox("mrtEntrance", { width: 5.4, height: 3, depth: 6.4 }, scene);
  entrance.position.set(cx - 14.5, 1.5, z - 4.4);
  entrance.material = concrete;
  entrance.checkCollisions = true;
  const entranceSign = MeshBuilder.CreateBox("mrtEntranceSign", { width: 4.6, height: 0.6, depth: 0.1 }, scene);
  entranceSign.position.set(cx - 14.5, 3.4, z - 7.6);
  entranceSign.material = trainStripeMat;
  entranceSign.isPickable = false;

  // Stopped three-car train on the guideway.
  const trainY = platformY + 1.1;
  for (let car = 0; car < 3; car++) {
    const carX = cx - 12 + car * 12.4;
    const body = MeshBuilder.CreateBox(`mrtCar_${car}`, { width: 12, height: 2.4, depth: 2.6 }, scene);
    body.position.set(carX, trainY, z);
    body.material = trainBodyMat;
    body.isPickable = false;
    const stripe = MeshBuilder.CreateBox(`mrtCarStripe_${car}`, { width: 12.04, height: 0.35, depth: 2.64 }, scene);
    stripe.position.set(carX, trainY - 0.75, z);
    stripe.material = trainStripeMat;
    stripe.isPickable = false;
    const windows = MeshBuilder.CreateBox(`mrtCarWin_${car}`, { width: 11.4, height: 0.8, depth: 2.66 }, scene);
    windows.position.set(carX, trainY + 0.35, z);
    windows.material = trainGlassMat;
    windows.isPickable = false;
  }
}

/** Road surface texture with lane markings baked in — a dashed/solid centre line and edge lines, tiled along the road's length. Far cheaper than per-dash meshes. */
function createRoadTexture(scene: Scene, name: string, kind: RoadKind): DynamicTexture {
  const w = 128;
  const h = 128;
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = kind === "service" ? "#232321" : "#1b1b1c";
  ctx.fillRect(0, 0, w, h);

  // Subtle asphalt speckle.
  const rand = mulberry32(kind === "avenue" ? 11 : kind === "street" ? 22 : 33);
  for (let i = 0; i < 220; i++) {
    const shade = 26 + Math.floor(rand() * 14);
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 1})`;
    ctx.fillRect(rand() * w, rand() * h, 1.4, 1.4);
  }

  if (kind === "avenue") {
    // Double yellow centre line + two white lane dividers either side.
    ctx.fillStyle = "#d8b23a";
    ctx.fillRect(w / 2 - 3, 0, 1.6, h);
    ctx.fillRect(w / 2 + 1.4, 0, 1.6, h);
    ctx.fillStyle = "rgba(220,220,210,0.85)";
    for (const off of [-0.62, 0.62]) {
      const cx = w / 2 + off * w;
      for (let y = 0; y < h; y += 16) ctx.fillRect(cx - 0.8, y, 1.6, 9);
    }
    ctx.fillRect(2, 0, 1.5, h);
    ctx.fillRect(w - 3.5, 0, 1.5, h);
  } else if (kind === "street") {
    ctx.fillStyle = "rgba(220,220,210,0.85)";
    for (let y = 0; y < h; y += 18) ctx.fillRect(w / 2 - 0.8, y, 1.6, 10);
    ctx.fillRect(3, 0, 1.2, h);
    ctx.fillRect(w - 4.2, 0, 1.2, h);
  } else {
    ctx.fillStyle = "rgba(200,200,190,0.5)";
    ctx.fillRect(3, 0, 1, h);
    ctx.fillRect(w - 4, 0, 1, h);
  }

  tex.update();
  tex.hasAlpha = false;
  return tex;
}

function createSidewalkTexture(scene: Scene, name: string): DynamicTexture {
  return createPavementTexture(scene, name, "#8a8a80");
}

/**
 * A sidewalk runs alongside every road, but must stop short at each cross
 * street instead of paving straight across its asphalt — otherwise the
 * light sidewalk texture bleeds over every intersection as an ugly patch
 * (this was the "sidewalks not properly rendered" bug). Since the grid is
 * square, the same set of cross-street gaps applies to both axes: this
 * computes the clear run lengths along one axis once and reuses it for all
 * NS and EW sidewalks.
 */
function sidewalkSegments(): Array<{ start: number; end: number }> {
  const half = MAP_SPAN / 2;
  const crossings = [...MID_LINES].sort((a, b) => a - b);
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = -half;
  for (const p of crossings) {
    const hw = roadHalfWidth(roadKind(p));
    const gapStart = p - hw - 0.15;
    const gapEnd = p + hw + 0.15;
    if (gapStart > cursor + 0.3) segments.push({ start: cursor, end: gapStart });
    cursor = Math.max(cursor, gapEnd);
  }
  if (half - cursor > 0.3) segments.push({ start: cursor, end: half });
  return segments;
}

/** Roads laid out per the avenue/street/service hierarchy, with sidewalks either side. */
function buildRoads(scene: Scene): void {
  const roadMats: Record<RoadKind, WorldMaterial> = {
    avenue: matFromTexture(scene, "avenueMat", createRoadTexture(scene, "roadTexAvenue", "avenue")),
    street: matFromTexture(scene, "streetMat", createRoadTexture(scene, "roadTexStreet", "street")),
    service: matFromTexture(scene, "serviceMat", createRoadTexture(scene, "roadTexService", "service")),
  };
  // A single vScale per kind, baked once — every road of that kind is built as a
  // narrow-X/long-Z plane and, for the east-west roads, simply rotated 90° in
  // world space rather than reshaped, so the UV mapping (and therefore the
  // dashed centre line's orientation) is identical and correct for both axes.
  for (const kind of Object.keys(roadMats) as RoadKind[]) {
    (roadMats[kind].diffuseTexture as Texture).vScale = 18;
  }

  const sidewalkTex = createSidewalkTexture(scene, "sidewalkTex");
  const sidewalkMat = new WorldMaterial("sidewalkMat", scene);
  sidewalkMat.diffuseColor = new Color3(0.62, 0.6, 0.55);
  sidewalkMat.specularColor = Color3.Black();
  sidewalkMat.diffuseTexture = sidewalkTex;
  sidewalkTex.uScale = 40;
  sidewalkTex.vScale = 4;

  const segments = sidewalkSegments();
  const sideW = 1.4;

  MID_LINES.forEach((m, i) => {
    const kind = roadKind(m);
    const hw = roadHalfWidth(kind);
    const mat = roadMats[kind];

    const roadNS = MeshBuilder.CreateGround(`roadNS_${i}`, { width: hw * 2, height: MAP_SPAN }, scene);
    roadNS.position.set(m, 0.015, 0);
    roadNS.material = mat;
    roadNS.isPickable = false;

    // The centre east-west avenue runs along the monsoon canal corridor — a
    // single full-length plane would float flat across the sunken cut. It's
    // built instead as two half-avenues that stop at the canal's concrete
    // edges (the canal spans x ±42), with a vScale-matched texture so lane
    // dashes keep the same spacing as every other road.
    if (Math.abs(m) < 10.9) {
      const shortTex = createRoadTexture(scene, `roadTexAvenueShort_${i}`, kind);
      const shortMat = matFromTexture(scene, `avenueShortMat_${i}`, shortTex);
      const segLen = MAP_SPAN / 2 - 43;
      shortTex.vScale = Math.max(2, Math.round((18 * segLen) / MAP_SPAN));
      for (const side of [-1, 1]) {
        const half = MeshBuilder.CreateGround(`roadEW_${i}_${side}`, { width: hw * 2, height: segLen }, scene);
        half.position.set(side * (43 + segLen / 2), 0.015, m);
        half.rotation.y = Math.PI / 2;
        half.material = shortMat;
        half.isPickable = false;
      }
    } else {
      const roadEW = MeshBuilder.CreateGround(`roadEW_${i}`, { width: hw * 2, height: MAP_SPAN }, scene);
      roadEW.position.set(0, 0.015, m);
      roadEW.rotation.y = Math.PI / 2;
      roadEW.material = mat;
      roadEW.isPickable = false;
    }

    // Segmented rather than one continuous strip, so each sidewalk stops at
    // the edge of every cross street instead of paving straight over it.
    for (const side of [-1, 1]) {
      const offset = m + side * (hw + sideW / 2 + 0.1);
      segments.forEach((seg, segIdx) => {
        const len = seg.end - seg.start;
        const mid = (seg.start + seg.end) / 2;

        const sideNS = MeshBuilder.CreateGround(`sidewalkNS_${i}_${side}_${segIdx}`, { width: sideW, height: len }, scene);
        sideNS.position.set(offset, 0.017, mid);
        sideNS.material = sidewalkMat;
        sideNS.isPickable = false;

        const sideEW = MeshBuilder.CreateGround(`sidewalkEW_${i}_${side}_${segIdx}`, { width: len, height: sideW }, scene);
        sideEW.position.set(mid, 0.017, offset);
        sideEW.material = sidewalkMat;
        sideEW.isPickable = false;
      });
    }
  });

  buildBoulevards(scene);
}

/**
 * A couple of diagonal boulevards cut across the orthogonal grid — real
 * cities are rarely pure right angles throughout, and a diagonal shortcut
 * gives players an extra route/flanking line that isn't grid-aligned.
 * Finite point-to-point strips (not full-map length), routed clear of the
 * garden/camp quadrant so they don't cut through the safe zone or forest.
 */
function buildBoulevards(scene: Scene): void {
  const mat = matFromTexture(scene, "boulevardMat", createRoadTexture(scene, "roadTexBoulevard", "street"));
  (mat.diffuseTexture as Texture).vScale = 14;
  const sidewalkMat = new WorldMaterial("boulevardSidewalkMat", scene);
  sidewalkMat.diffuseColor = new Color3(0.62, 0.6, 0.55);
  sidewalkMat.specularColor = Color3.Black();
  const sidewalkTex = createSidewalkTexture(scene, "boulevardSidewalkTex");
  sidewalkTex.uScale = 24;
  sidewalkTex.vScale = 3;
  sidewalkMat.diffuseTexture = sidewalkTex;

  const boulevards: Array<[number, number, number, number]> = [
    // x1,z1 -> x2,z2 — NE quadrant (through the CBD) and a second cutting the industrial estate.
    [4, 30, 82, 78],
    [30, -30, 82, -82],
  ];

  const hw = 4;
  boulevards.forEach(([x1, z1, x2, z2], i) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;

    const road = MeshBuilder.CreateGround(`boulevard_${i}`, { width: hw * 2, height: length }, scene);
    road.position.set(midX, 0.016, midZ);
    road.rotation.y = angle;
    road.material = mat;
    road.isPickable = false;

    for (const side of [-1, 1]) {
      const perp = angle + Math.PI / 2;
      const sw = MeshBuilder.CreateGround(`boulevardSidewalk_${i}_${side}`, { width: 1.3, height: length }, scene);
      sw.position.set(midX + Math.sin(perp) * (hw + 0.75), 0.018, midZ + Math.cos(perp) * (hw + 0.75));
      sw.rotation.y = angle;
      sw.material = sidewalkMat;
      sw.isPickable = false;
    }
  });
}

/**
 * Raised concrete curb strips along the road-facing edge of every sidewalk
 * segment, plus periodic dark drain covers set into them — the street-level
 * detail that makes a road read as engineered rather than painted on. All
 * non-collidable (no movement jank) and merged into a couple of draw calls by
 * the static-decor pass.
 */
function buildCurbs(scene: Scene): void {
  const curbMat = solidMat(scene, "curbMat", new Color3(0.68, 0.67, 0.62));
  const drainMat = solidMat(scene, "drainCoverMat", new Color3(0.16, 0.17, 0.16));
  const segments = sidewalkSegments();
  let i = 0;
  for (const m of MID_LINES) {
    const hw = roadHalfWidth(roadKind(m));
    for (const side of [-1, 1]) {
      const offset = m + side * (hw + 0.08);
      for (const seg of segments) {
        const len = seg.end - seg.start;
        const mid = (seg.start + seg.end) / 2;
        const curbNS = MeshBuilder.CreateBox(`curbNS_${i}`, { width: 0.22, height: 0.14, depth: len }, scene);
        curbNS.position.set(offset, 0.07, mid);
        curbNS.material = curbMat;
        curbNS.isPickable = false;
        const curbEW = MeshBuilder.CreateBox(`curbEW_${i}`, { width: len, height: 0.14, depth: 0.22 }, scene);
        curbEW.position.set(mid, 0.07, offset);
        curbEW.material = curbMat;
        curbEW.isPickable = false;
        i++;
        // A storm-drain cover every ~14m along avenue/street curbs.
        if (roadKind(m) !== "service") {
          for (let d = seg.start + 7; d < seg.end - 3; d += 14) {
            const drainNS = MeshBuilder.CreateBox(`drainNS_${i}_${d}`, { width: 0.5, height: 0.03, depth: 0.9 }, scene);
            drainNS.position.set(m + side * (hw - 0.35), 0.028, d);
            drainNS.material = drainMat;
            drainNS.isPickable = false;
            const drainEW = MeshBuilder.CreateBox(`drainEW_${i}_${d}`, { width: 0.9, height: 0.03, depth: 0.5 }, scene);
            drainEW.position.set(d, 0.028, m + side * (hw - 0.35));
            drainEW.material = drainMat;
            drainEW.isPickable = false;
          }
        }
      }
    }
  }
}

function matFromTexture(scene: Scene, name: string, tex: DynamicTexture): WorldMaterial {
  const mat = new WorldMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.specularColor = Color3.Black();
  return mat;
}

/** Crosswalks, traffic lights, and street signs — limited to avenue crossings so the mesh count stays bounded. */
function buildIntersectionDressing(scene: Scene, layout: BuildingFootprint[]): void {
  const crosswalkTex = new DynamicTexture("crosswalkTex", { width: 64, height: 64 }, scene, false);
  const cctx = crosswalkTex.getContext() as CanvasRenderingContext2D;
  cctx.fillStyle = "rgba(0,0,0,0)";
  cctx.clearRect(0, 0, 64, 64);
  cctx.fillStyle = "#d8d8ce";
  for (let x = 4; x < 64; x += 12) cctx.fillRect(x, 0, 6, 64);
  crosswalkTex.update();
  crosswalkTex.hasAlpha = true;
  const crosswalkMat = new WorldMaterial("crosswalkMat", scene);
  crosswalkMat.diffuseTexture = crosswalkTex;
  crosswalkMat.useAlphaFromDiffuseTexture = true;
  crosswalkMat.specularColor = Color3.Black();
  crosswalkMat.backFaceCulling = false;

  const poleMat = new WorldMaterial("trafficPoleMat", scene);
  poleMat.diffuseColor = new Color3(0.14, 0.14, 0.15);
  poleMat.specularColor = Color3.Black();
  const redMat = new WorldMaterial("trafficRedMat", scene);
  redMat.diffuseColor = new Color3(0.15, 0.1, 0.1);
  redMat.emissiveColor = new Color3(0.7, 0.1, 0.1);

  const avenuePositions = MID_LINES.filter((m) => roadKind(m) === "avenue");
  let signIndex = 0;

  for (const a of avenuePositions) {
    for (const m of MID_LINES) {
      placeIntersectionDressing(scene, a, m, crosswalkMat, poleMat, redMat, layout, signIndex++);
      if (a !== m) placeIntersectionDressing(scene, m, a, crosswalkMat, poleMat, redMat, layout, signIndex++);
    }
  }
}

const STREET_NAMES = ["ORCHARD RD", "BEACH RD", "SERANGOON AVE", "TANJONG WAY", "BUKIT RISE", "MARINA LINK"];

function placeIntersectionDressing(
  scene: Scene,
  x: number,
  z: number,
  crosswalkMat: WorldMaterial,
  poleMat: WorldMaterial,
  redMat: WorldMaterial,
  layout: BuildingFootprint[],
  index: number
): void {
  const xKind = roadKind(x);
  const zKind = roadKind(z);
  const xHw = roadHalfWidth(xKind);
  const zHw = roadHalfWidth(zKind);

  // Crosswalk strips on the two approaches along the z-road, just past the x-road edge.
  const stripW = zHw * 1.6;
  for (const side of [-1, 1]) {
    const strip = MeshBuilder.CreateGround(`crosswalk_${index}_${side}`, { width: 3, height: stripW }, scene);
    strip.position.set(x + side * (xHw + 1.8), 0.02, z);
    strip.material = crosswalkMat;
    strip.isPickable = false;
  }

  // A traffic light pole on one corner.
  const cornerX = x + xHw + 0.5;
  const cornerZ = z + zHw + 0.5;
  if (!overlapsAnyBuilding(cornerX, cornerZ, 1, layout)) {
    const pole = MeshBuilder.CreateCylinder(`trafficPole_${index}`, { diameter: 0.16, height: 3.6 }, scene);
    pole.position.set(cornerX, 1.8, cornerZ);
    pole.material = poleMat;
    pole.checkCollisions = true;

    const head = MeshBuilder.CreateBox(`trafficHead_${index}`, { width: 0.3, height: 0.6, depth: 0.22 }, scene);
    head.position.set(cornerX, 3.5, cornerZ);
    head.material = poleMat;
    head.isPickable = false;

    const light = MeshBuilder.CreateSphere(`trafficLight_${index}`, { diameter: 0.12 }, scene);
    light.position.set(cornerX, 3.7, cornerZ + 0.12);
    light.material = redMat;
    light.isPickable = false;
  }

  // Occasional street sign on the opposite corner.
  if (index % 5 === 0) {
    const signX = x - xHw - 0.6;
    const signZ = z - zHw - 0.6;
    if (!overlapsAnyBuilding(signX, signZ, 1, layout)) {
      buildStreetSign(scene, signX, signZ, STREET_NAMES[(index / 5) % STREET_NAMES.length], index);
    }
  }
}

function buildStreetSign(scene: Scene, x: number, z: number, label: string, index: number): void {
  const poleMat = new WorldMaterial(`signPoleMat_${index}`, scene);
  poleMat.diffuseColor = new Color3(0.2, 0.35, 0.22);
  const pole = MeshBuilder.CreateCylinder(`signPole_${index}`, { diameter: 0.09, height: 2.4 }, scene);
  pole.position.set(x, 1.2, z);
  pole.material = poleMat;
  pole.checkCollisions = true;

  const tex = new DynamicTexture(`signTex_${index}`, { width: 256, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#1f5c33";
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = "#eaf0e6";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 248, 56);
  ctx.fillStyle = "#eaf0e6";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 33);
  tex.update();

  const boardMat = new WorldMaterial(`signBoardMat_${index}`, scene);
  boardMat.diffuseTexture = tex;
  boardMat.specularColor = Color3.Black();
  boardMat.backFaceCulling = false;
  const board = MeshBuilder.CreatePlane(`signBoard_${index}`, { width: 1.4, height: 0.35 }, scene);
  board.position.set(x, 2.15, z);
  board.material = boardMat;
  board.isPickable = false;
}

/**
 * Street grid built from `generateBuildingLayout` — shophouse blocks get a
 * roof trim band + procedural window facade, HDB towers get horizontal
 * balcony banding, CBD towers get a reflective glass facade, and industrial
 * blocks read as flat-roofed warehouses.
 */
function buildStreetGrid(scene: Scene, layout: BuildingFootprint[]): void {
  // Each material gets its own DynamicTexture instance rather than sharing/cloning
  // one — Texture.clone() reloads from a `url`, which a canvas-based DynamicTexture
  // doesn't have, so cloned copies came out blank (that's what made buildings look
  // see-through: the facade texture had no image data).
  const shophouseMats = SHOPHOUSE_COLORS.map((color, i) => {
    const mat = new WorldMaterial(`shophouseMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    // Light wall base: the texture MULTIPLIES diffuseColor, so a dark base here
    // would square-darken the facade to near-black on shadow sides.
    const tex = createWindowTexture(scene, `shophouseWindowTex_${i}`, "#94908a");
    tex.uScale = 3;
    tex.vScale = 4;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const hdbMats = HDB_COLORS.map((color, i) => {
    const mat = new WorldMaterial(`hdbMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    const tex = createWindowTexture(scene, `hdbWindowTex_${i}`, "#9a9791"); // light base — multiplies diffuseColor (see shophouse note)
    tex.uScale = 2.5;
    tex.vScale = 9;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const cbdMats = CBD_GLASS_COLORS.map((color, i) => {
    const mat = new WorldMaterial(`cbdMat_${i}`, scene);
    mat.diffuseColor = color;
    // Curtain-wall glass: smooth and semi-metallic so the towers pick up the
    // sky environment as real reflections instead of a flat painted colour.
    mat.roughness = 0.22;
    mat.metallic = 0.6;
    const tex = createWindowTexture(scene, `cbdWindowTex_${i}`, "#5f7079"); // glass-mullion grid, kept darker than HDB but no longer near-black
    tex.uScale = 4;
    tex.vScale = 12;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const industrialMats = INDUSTRIAL_COLORS.map((color, i) => {
    const mat = new WorldMaterial(`industrialMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  });
  const hdbAccentMat = new WorldMaterial("hdbAccentMat", scene);
  hdbAccentMat.diffuseColor = HDB_ACCENT;
  hdbAccentMat.specularColor = Color3.Black();

  layout.forEach(({ x, z, size, height, type }, i) => {
    const building = MeshBuilder.CreateBox(`building_${i}`, { width: size, height, depth: size }, scene);
    building.position.set(x, height / 2, z);
    building.checkCollisions = true;
    // Tagged so an optional .glb model can locate this building and its
    // decorative bits later (see upgradeBuildingsWithModels). Metadata has no
    // `damageable`, so hitscan/collision logic ignores it as before.
    building.metadata = { footprintIndex: i };
    const decorations: Mesh[] = [];

    if (type === "hdb") {
      building.material = hdbMats[i % hdbMats.length];
      // Void deck: the tower stands on pillars over an open, walk-through
      // ground floor (the classic HDB undercroft) — hard cover, a shaded
      // flanking route through the block, and a huge realism cue. The tower
      // box is squashed upward so the space underneath is genuinely open.
      const voidH = 3.0;
      building.scaling.y = (height - voidH) / height;
      building.position.y = voidH + (height - voidH) / 2;
      const pillarMat = hdbMats[(i + 2) % hdbMats.length];
      const pHalf = size / 2 - 0.6;
      for (const px of [-pHalf, 0, pHalf]) {
        for (const pz of [-pHalf, 0, pHalf]) {
          if (px === 0 && pz === 0) continue; // centre taken by the lift core
          const pillar = MeshBuilder.CreateBox(`hdbPillar_${i}_${px}_${pz}`, { width: 0.55, height: voidH, depth: 0.55 }, scene);
          pillar.position.set(x + px, voidH / 2, z + pz);
          pillar.material = pillarMat;
          pillar.checkCollisions = true;
        }
      }
      // Lift/stair core: solid centre block of the void deck.
      const core = MeshBuilder.CreateBox(`hdbCore_${i}`, { width: 2.8, height: voidH, depth: 2.8 }, scene);
      core.position.set(x, voidH / 2, z);
      core.material = hdbAccentMat;
      core.checkCollisions = true;
      const bands = 3 + Math.floor(height / 12);
      for (let b = 1; b <= bands; b++) {
        const band = MeshBuilder.CreateBox(`hdbBand_${i}_${b}`, { width: size + 0.3, height: 0.4, depth: size + 0.3 }, scene);
        band.position.set(x, (height / (bands + 1)) * b, z);
        band.material = hdbAccentMat;
        band.isPickable = false;
        decorations.push(band);
      }
      const roof = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size + 0.2, height: 0.4, depth: size + 0.2 }, scene);
      roof.position.set(x, height + 0.2, z);
      roof.material = hdbMats[(i + 1) % hdbMats.length];
      roof.isPickable = false;
      decorations.push(roof);
    } else if (type === "cbd") {
      building.material = cbdMats[i % cbdMats.length];
      const cap = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size * 0.7, height: 1.2, depth: size * 0.7 }, scene);
      cap.position.set(x, height + 0.6, z);
      cap.material = poleGrayMat(scene, `cbdCapMat_${i}`);
      cap.isPickable = false;
      decorations.push(cap);
    } else if (type === "industrial") {
      building.material = industrialMats[i % industrialMats.length];
      // A row of shallow roof vents for a bit of warehouse silhouette detail.
      const vent = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size * 0.4, height: 0.8, depth: 1.6 }, scene);
      vent.position.set(x, height + 0.4, z);
      vent.material = industrialMats[(i + 1) % industrialMats.length];
      vent.isPickable = false;
      decorations.push(vent);
    } else {
      building.material = shophouseMats[i % shophouseMats.length];
      const trim = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size + 0.4, height: 0.6, depth: size + 0.4 }, scene);
      trim.position.set(x, height + 0.3, z);
      trim.material = shophouseMats[(i + 1) % shophouseMats.length];
      trim.isPickable = false;
      decorations.push(trim);

      // Ground-floor awning / sheltered walkway hint for a bit of shophouse character.
      const awning = MeshBuilder.CreateBox(`awning_${i}`, { width: size + 0.6, height: 0.15, depth: size + 0.6 }, scene);
      awning.position.set(x, 2.6, z);
      awning.material = hdbAccentMat;
      awning.isPickable = false;
      decorations.push(awning);
    }
    for (const d of decorations) d.metadata = { decorativeFor: i };
  });
}

/**
 * Optional post-pass: if a real `.glb` exists for a building type at
 * `public/models/buildings/<type>.glb` (e.g. a CC0 Singapore HDB or CBD
 * tower), load it once and instantiate a copy over every building of that
 * type, scaled to its footprint. The procedural box is kept as an invisible
 * collider (so movement/bullet-blocking is unchanged and cheap), and its
 * decorative bands/trim are removed. Fire-and-forget and fully optional: with
 * no model present (the default), every building stays procedural.
 *
 * The bundled `buildings/hdb.glb` is a PLACEHOLDER slab that only exists to
 * prove this pipeline renders external assets — replace it with a real
 * CC0 model (see public/models/README.md).
 */
async function upgradeBuildingsWithModels(scene: Scene, layout: BuildingFootprint[]): Promise<void> {
  const types: BuildingType[] = ["hdb", "cbd", "industrial", "shophouse"];
  for (const type of types) {
    const container = await loadGlbContainerOrNull(scene, `models/buildings/${type}.glb`);
    if (!container) continue; // no model for this type — keep procedural

    layout.forEach((b, i) => {
      if (b.type !== type) return;
      const box = scene.getMeshByName(`building_${i}`);
      if (!box) return;

      const instanced = container.instantiateModelsToScene((n) => `${type}_${i}_${n}`, false);
      const root = instanced.rootNodes[0];
      if (root && "position" in root) {
        // Model authored to a 1x1x1 base-origin footprint → scale to this block.
        (root as unknown as { position: Vector3; scaling: Vector3 }).position = new Vector3(b.x, 0, b.z);
        (root as unknown as { position: Vector3; scaling: Vector3 }).scaling = new Vector3(b.size, b.height, b.size);
      }
      // Loaded meshes are visual-only; the (now invisible) box keeps collision
      // + bullet-blocking, so gameplay is identical to the procedural version.
      for (const m of instanced.rootNodes.flatMap((n) => n.getChildMeshes())) {
        m.isPickable = false;
        m.checkCollisions = false;
      }
      box.isVisible = false;

      // Remove the procedural decorative bits this model replaces.
      for (const mesh of scene.meshes.slice()) {
        if ((mesh.metadata as { decorativeFor?: number } | null)?.decorativeFor === i) mesh.dispose();
      }
    });
  }
}

const poleGrayCache = new Map<string, WorldMaterial>();
function poleGrayMat(scene: Scene, name: string): WorldMaterial {
  let mat = poleGrayCache.get(name);
  if (!mat) {
    mat = new WorldMaterial(name, scene);
    mat.diffuseColor = new Color3(0.55, 0.57, 0.6);
    mat.specularColor = Color3.Black();
    poleGrayCache.set(name, mat);
  }
  return mat;
}

/** Tiled concrete-slab texture, reused for the ground and (in a lighter shade) sidewalks. */
function createPavementTexture(scene: Scene, name: string, base: string): DynamicTexture {
  // 256px with speckle, tonal blotches, hairline cracks and expansion joints —
  // reads as worn concrete at ground level instead of a flat grey wash.
  const size = 256;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(55);
  // Large soft tonal blotches (weathering/staining).
  for (let i = 0; i < 26; i++) {
    const shade = 30 + Math.floor(rand() * 40);
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade - 2},0.1)`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 12 + rand() * 30, 8 + rand() * 22, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fine aggregate speckle.
  for (let i = 0; i < 1400; i++) {
    const shade = 20 + Math.floor(rand() * 34);
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade - 2},0.35)`;
    ctx.fillRect(rand() * size, rand() * size, 1.4, 1.4);
  }
  // Hairline cracks: short random polylines.
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let cx = rand() * size;
    let cy = rand() * size;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 5; s++) {
      cx += (rand() - 0.5) * 34;
      cy += (rand() - 0.5) * 34;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  // Expansion joints on the tile border (tiles into a paving grid).
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  tex.update();
  tex.hasAlpha = false;
  return tex;
}

function createWindowTexture(scene: Scene, name: string, base: string): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const cols = 6;
  const rows = 8;
  const cellW = size / cols;
  const cellH = size / rows;
  const rand = mulberry32(7);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rand() < 0.35;
      ctx.fillStyle = lit ? "#d8e4df" : "#4a5560";
      const pad = cellW * 0.16;
      ctx.fillRect(c * cellW + pad, r * cellH + pad, cellW - pad * 2, cellH - pad * 2);
    }
  }
  tex.update();
  return tex;
}

/** Cover object kinds — a mix of natural and man-made cover so players aren't fighting only in open spaces. */
type CoverType =
  | "crate"
  | "cratePile"
  | "sandbags"
  | "jerseyBarrier"
  | "roadblock"
  | "lowWallStone"
  | "lowWallConcrete"
  | "hedge"
  | "fence"
  | "railing"
  | "constructionBarrier"
  | "bush";

const COVER_TYPES: CoverType[] = [
  "crate",
  "cratePile",
  "sandbags",
  "jerseyBarrier",
  "roadblock",
  "lowWallStone",
  "lowWallConcrete",
  "hedge",
  "fence",
  "railing",
  "constructionBarrier",
  "bush",
];

/**
 * Cover is scattered on sidewalks, plaza corners, and alley nooks — never on
 * the road carriageway itself (checked against distanceToNearestRoad) — and
 * never inside a building footprint.
 */
function buildCover(scene: Scene, layout: BuildingFootprint[]): void {
  const mats = {
    crate: solidMat(scene, "crateMat", new Color3(0.4, 0.35, 0.25)),
    sandbag: solidMat(scene, "sandbagMat", new Color3(0.55, 0.48, 0.32)),
    jersey: solidMat(scene, "jerseyMat", new Color3(0.62, 0.6, 0.58)),
    roadblock: solidMat(scene, "roadblockMat", new Color3(0.75, 0.15, 0.1)),
    roadblockStripe: solidMat(scene, "roadblockStripeMat", new Color3(0.9, 0.85, 0.75)),
    stone: solidMat(scene, "stoneMat", new Color3(0.45, 0.43, 0.4)),
    concrete: solidMat(scene, "concreteMat", new Color3(0.58, 0.58, 0.56)),
    hedge: solidMat(scene, "hedgeMat", new Color3(0.19, 0.33, 0.17)),
    fence: solidMat(scene, "fenceMat", new Color3(0.25, 0.27, 0.28)),
    barrier: solidMat(scene, "conBarrierMat", new Color3(0.85, 0.5, 0.1)),
    barrierStripe: solidMat(scene, "conBarrierStripeMat", new Color3(0.92, 0.92, 0.88)),
    bush: solidMat(scene, "cityBushMat", new Color3(0.21, 0.36, 0.18)),
  };

  const rand = mulberry32(909);
  let placed = 0;
  let attempts = 0;
  // Denser battlefield: ~55% more scattered cover than the previous pass, so
  // there's always a piece of hard or soft cover within a short sprint.
  const target = 72;

  while (placed < target && attempts < target * 12) {
    attempts++;
    // Sample near a random road so cover clusters at plausible junctions/sidewalks.
    const line = MID_LINES[Math.floor(rand() * MID_LINES.length)];
    const alongOtherAxis = -90 + rand() * 180;
    const onXRoad = rand() < 0.5;
    const jitter = (rand() - 0.5) * 6;
    const x = onXRoad ? line + jitter : alongOtherAxis;
    const z = onXRoad ? alongOtherAxis : line + jitter;

    if (inGardenDistrict(x, z, 8)) continue;
    if (Math.abs(x) < 8 && Math.abs(z) < 8) continue; // keep the plaza's very centre clear
    if (overlapsAnyBuilding(x, z, 1.2, layout)) continue;
    if (distanceToNearestRoad(x, z) < 1.6) continue; // stay off the carriageway (fixes cover blocking traffic lanes)

    const type = COVER_TYPES[Math.floor(rand() * COVER_TYPES.length)];
    const rot = rand() * Math.PI * 2;
    placeCover(scene, type, x, z, rot, mats, placed);
    placed++;
  }

  // Deliberate chokepoints: barricade lines thrown across the four avenue
  // approaches into the plaza. Each line blocks most of the carriageway with
  // Jersey barriers + a sandbag position but leaves a ~3m gap at one end — a
  // covered funnel both sides have to fight through, instead of a long open
  // avenue sightline straight into the plaza.
  const chokes: Array<{ x: number; z: number; acrossX: boolean }> = [
    { x: 0, z: 30, acrossX: true },
    { x: 0, z: -30, acrossX: true },
    { x: 30, z: 0, acrossX: false },
    { x: -30, z: 0, acrossX: false },
  ];
  for (const c of chokes) {
    const rot = c.acrossX ? 0 : Math.PI / 2; // barrier length lies across the road
    const offsets = [-3.9, -1.3, 1.3]; // gap left open on the +ve side
    for (const off of offsets) {
      const x = c.acrossX ? c.x + off : c.x;
      const z = c.acrossX ? c.z : c.z + off;
      placeCover(scene, "jerseyBarrier", x, z, rot, mats, placed++);
    }
    // Sandbag fighting position guarding the gap.
    const gx = c.acrossX ? c.x + 4.6 : c.x + 2.2;
    const gz = c.acrossX ? c.z + 2.2 : c.z + 4.6;
    placeCover(scene, "sandbags", gx, gz, rot, mats, placed++);
  }

  // Break up the open plaza itself: a loose ring of fighting positions ~13-16m
  // out from centre gives cover to hold or cross the middle instead of a bare
  // killing field. Eight positions of mixed hard cover, angled to face outward.
  const plazaRing: CoverType[] = ["sandbags", "jerseyBarrier", "lowWallConcrete", "cratePile"];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const r = 13 + (i % 2) * 3;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (overlapsAnyBuilding(x, z, 1.2, layout) || distanceToNearestRoad(x, z) < 1.6) continue;
    placeCover(scene, plazaRing[i % plazaRing.length], x, z, a + Math.PI / 2, mats, placed++);
  }
}

function solidMat(scene: Scene, name: string, color: Color3): WorldMaterial {
  const mat = new WorldMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * A flat-shaded wedge (right-triangular prism): width along X, vertical back
 * face at -Z, and a slope running from the bottom-front edge up to the
 * top-back edge. Origin at the bottom centre. This is the piece that
 * de-blocks silhouettes everywhere a pure box reads wrong — car windshields
 * and rear glass, Jersey-barrier sides, etc. Normals are hand-set per face;
 * paired materials disable backface culling so winding never bites.
 */
function createWedge(name: string, w: number, h: number, d: number, scene: Scene): Mesh {
  const x = w / 2;
  const z = d / 2;
  const positions = [
    // bottom
    -x, 0, -z,  x, 0, -z,  x, 0, z,  -x, 0, z,
    // vertical back face
    -x, 0, -z,  -x, h, -z,  x, h, -z,  x, 0, -z,
    // slope (bottom-front edge → top-back edge)
    -x, h, -z,  -x, 0, z,  x, 0, z,  x, h, -z,
    // side triangles
    -x, 0, -z,  -x, 0, z,  -x, h, -z,
    x, 0, -z,  x, h, -z,  x, 0, z,
  ];
  const front = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14,
    15, 16, 17,
  ];
  // Emit both windings so the wedge renders correctly under any material's
  // culling setting — a handful of extra (never-lit-wrong) triangles per prop.
  const indices = [...front];
  for (let i = 0; i < front.length; i += 3) indices.push(front[i], front[i + 2], front[i + 1]);
  const slopeLen = Math.hypot(d, h);
  const ny = d / slopeLen;
  const nz = h / slopeLen;
  const normals = [
    0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    0, ny, nz,  0, ny, nz,  0, ny, nz,  0, ny, nz,
    -1, 0, 0,  -1, 0, 0,  -1, 0, 0,
    1, 0, 0,  1, 0, 0,  1, 0, 0,
  ];
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(mesh);
  return mesh;
}

function placeCover(
  scene: Scene,
  type: CoverType,
  x: number,
  z: number,
  rot: number,
  mats: Record<string, WorldMaterial>,
  index: number
): void {
  switch (type) {
    case "crate": {
      const crate = MeshBuilder.CreateBox(`crate_${index}`, { width: 2, height: 2, depth: 2 }, scene);
      crate.position.set(x, 1, z);
      crate.rotation.y = rot;
      crate.material = mats.crate;
      crate.checkCollisions = true;
      break;
    }
    case "cratePile": {
      const base = MeshBuilder.CreateBox(`cratePileBase_${index}`, { width: 2.2, height: 1.4, depth: 2.2 }, scene);
      base.position.set(x, 0.7, z);
      base.rotation.y = rot;
      base.material = mats.crate;
      base.checkCollisions = true;
      const top = MeshBuilder.CreateBox(`cratePileTop_${index}`, { width: 1.3, height: 1.1, depth: 1.3 }, scene);
      top.position.set(x + 0.5, 1.4 + 0.55, z + 0.4);
      top.rotation.y = rot + 0.4;
      top.material = mats.crate;
      top.checkCollisions = true;
      break;
    }
    case "sandbags":
      buildSandbagWall(scene, x, z, rot, mats.sandbag, index);
      break;
    case "jerseyBarrier":
      buildConcreteBarrier(scene, x, z, rot, mats.jersey, index, "barrier");
      break;
    case "roadblock":
      buildConcreteBarrier(scene, x, z, rot, mats.roadblock, index, "roadblock", mats.roadblockStripe);
      break;
    case "lowWallStone":
      buildLowWall(scene, x, z, rot, mats.stone, index, "lowWallStone");
      break;
    case "lowWallConcrete":
      buildLowWall(scene, x, z, rot, mats.concrete, index, "lowWallConcrete");
      break;
    case "hedge":
      buildHedge(scene, x, z, rot, mats.hedge, index);
      break;
    case "fence":
      buildFenceLine(scene, x, z, rot, 1.4, mats.fence, index, "fence");
      break;
    case "railing":
      buildFenceLine(scene, x, z, rot, 0.9, mats.fence, index, "railing");
      break;
    case "constructionBarrier":
      buildConstructionBarrier(scene, x, z, rot, mats.barrier, mats.barrierStripe, index);
      break;
    case "bush": {
      const bush = MeshBuilder.CreateSphere(`cityBush_${index}`, { diameter: 1.2 + Math.random() * 0.4, segments: 6 }, scene);
      bush.scaling.y = 0.6;
      bush.position.set(x, 0.4, z);
      bush.material = mats.bush;
      bush.checkCollisions = true;
      break;
    }
  }
}

/**
 * Chest-high sandbag wall built from three staggered courses of individual
 * squashed bags (an invisible box still handles collision, so gameplay is
 * unchanged). Rounded, jittered bags read as filled hessian sacks instead of
 * the old single rectangular block with a decorative top row.
 */
function buildSandbagWall(scene: Scene, x: number, z: number, rotY: number, mat: WorldMaterial, index: number): void {
  const wall = MeshBuilder.CreateBox(`sandbagWall_${index}`, { width: 3, height: 1.1, depth: 0.8 }, scene);
  wall.position.set(x, 0.55, z);
  wall.rotation.y = rotY;
  wall.isVisible = false;
  wall.checkCollisions = true;

  const rand = mulberry32(8800 + index);
  const courses: Array<{ y: number; count: number; offset: number }> = [
    { y: 0.19, count: 6, offset: 0 },
    { y: 0.55, count: 5, offset: 0.29 }, // half-bag stagger like real coursing
    { y: 0.9, count: 6, offset: 0 },
  ];
  for (const course of courses) {
    for (let i = 0; i < course.count; i++) {
      const along = -1.45 + course.offset + i * (2.9 / Math.max(1, course.count - 1)) + (rand() - 0.5) * 0.06;
      const bag = MeshBuilder.CreateSphere(
        `sandbag_${index}_${course.y}_${i}`,
        { diameterX: 0.62, diameterY: 0.4, diameterZ: 0.68, segments: 8 },
        scene
      );
      bag.position.set(x + Math.cos(rotY) * along, course.y, z - Math.sin(rotY) * along);
      bag.rotation.y = rotY + (rand() - 0.5) * 0.22;
      bag.scaling.y = 0.92 + rand() * 0.16;
      bag.material = mat;
      bag.isPickable = false;
    }
  }
}

/** Concrete Jersey barrier / roadblock — a wedge-profile block, common roadside/checkpoint cover. Roadblocks add alternating stripe blocks for the hazard-paint look. */
function buildConcreteBarrier(
  scene: Scene,
  x: number,
  z: number,
  rotY: number,
  mat: WorldMaterial,
  index: number,
  kind: "barrier" | "roadblock",
  stripeMat?: WorldMaterial
): void {
  const base = MeshBuilder.CreateBox(`barrierBase_${index}`, { width: 2.4, height: 0.5, depth: 0.7 }, scene);
  base.position.set(x, 0.25, z);
  base.rotation.y = rotY;
  base.material = mat;
  base.checkCollisions = true;

  const top = MeshBuilder.CreateBox(`barrierTop_${index}`, { width: 2.4, height: 0.6, depth: 0.35 }, scene);
  top.position.set(x, 0.8, z);
  top.rotation.y = rotY;
  top.material = mat;
  top.checkCollisions = true;

  // Sloped flanks between the wide base and narrow top — the real Jersey
  // barrier profile instead of two stacked boxes. Parented to the top block
  // so they inherit its rotation; visual only.
  for (const side of [-1, 1]) {
    const flank = createWedge(`barrierFlank_${index}_${side}`, 2.4, 0.58, 0.17, scene);
    flank.position.set(0, -0.3, side * (0.35 / 2 + 0.17 / 2));
    if (side === -1) flank.rotation.y = Math.PI;
    flank.material = mat;
    flank.parent = top;
    flank.isPickable = false;
  }

  if (kind === "roadblock" && stripeMat) {
    for (const off of [-0.8, 0, 0.8]) {
      const stripe = MeshBuilder.CreateBox(`barrierStripe_${index}_${off}`, { width: 0.5, height: 0.62, depth: 0.36 }, scene);
      stripe.position.set(x + Math.cos(rotY) * off, 0.8, z - Math.sin(rotY) * off);
      stripe.rotation.y = rotY;
      stripe.material = stripeMat;
      stripe.isPickable = false;
    }
  }
}

/** A low stone or concrete wall — waist-high, good long cover along sidewalks and block edges. */
function buildLowWall(scene: Scene, x: number, z: number, rotY: number, mat: WorldMaterial, index: number, name: string): void {
  const wall = MeshBuilder.CreateBox(`${name}_${index}`, { width: 3.2, height: 1, depth: 0.5 }, scene);
  wall.position.set(x, 0.5, z);
  wall.rotation.y = rotY;
  wall.material = mat;
  wall.checkCollisions = true;
}

/** A trimmed hedge row — dense green cover, shorter than a wall but still blocks line of sight when crouched. */
function buildHedge(scene: Scene, x: number, z: number, rotY: number, mat: WorldMaterial, index: number): void {
  const hedge = MeshBuilder.CreateBox(`hedge_${index}`, { width: 3, height: 0.9, depth: 0.7 }, scene);
  hedge.position.set(x, 0.45, z);
  hedge.rotation.y = rotY;
  hedge.material = mat;
  hedge.checkCollisions = true;
}

/** Shared builder for metal fences (taller, chest-high) and railings (shorter, knee-high) — a line of thin posts with a top rail. */
function buildFenceLine(scene: Scene, x: number, z: number, rotY: number, height: number, mat: WorldMaterial, index: number, name: string): void {
  const rail = MeshBuilder.CreateBox(`${name}_${index}`, { width: 3, height: 0.06, depth: 0.06 }, scene);
  rail.position.set(x, height, z);
  rail.rotation.y = rotY;
  rail.material = mat;
  rail.checkCollisions = true;

  const midRail = MeshBuilder.CreateBox(`${name}Mid_${index}`, { width: 3, height: 0.05, depth: 0.05 }, scene);
  midRail.position.set(x, height * 0.5, z);
  midRail.rotation.y = rotY;
  midRail.material = mat;
  midRail.isPickable = false;

  for (const off of [-1.4, -0.5, 0.4, 1.3]) {
    const post = MeshBuilder.CreateCylinder(`${name}Post_${index}_${off}`, { diameter: 0.06, height }, scene);
    post.position.set(x + Math.cos(rotY) * off, height / 2, z - Math.sin(rotY) * off);
    post.material = mat;
    post.isPickable = false;
  }
}

/** Orange-and-white striped construction/road-work barrier — cheap warning cover near junctions and job sites. */
function buildConstructionBarrier(
  scene: Scene,
  x: number,
  z: number,
  rotY: number,
  mat: WorldMaterial,
  stripeMat: WorldMaterial,
  index: number
): void {
  const board = MeshBuilder.CreateBox(`conBarrier_${index}`, { width: 2.2, height: 0.9, depth: 0.12 }, scene);
  board.position.set(x, 0.7, z);
  board.rotation.y = rotY;
  board.material = mat;
  board.checkCollisions = true;

  for (const off of [-0.7, 0, 0.7]) {
    const stripe = MeshBuilder.CreateBox(`conBarrierStripe_${index}_${off}`, { width: 0.4, height: 0.92, depth: 0.13 }, scene);
    stripe.position.set(x + Math.cos(rotY) * off, 0.7, z - Math.sin(rotY) * off);
    stripe.rotation.y = rotY;
    stripe.material = stripeMat;
    stripe.isPickable = false;
  }

  for (const off of [-1, 1]) {
    const leg = MeshBuilder.CreateBox(`conBarrierLeg_${index}_${off}`, { width: 0.15, height: 0.5, depth: 0.5 }, scene);
    leg.position.set(x + Math.cos(rotY) * off, 0.25, z - Math.sin(rotY) * off);
    leg.rotation.y = rotY;
    leg.material = mat;
    leg.isPickable = false;
  }
}

type VehicleType = "sedan" | "hatchback" | "suv" | "van" | "lorry" | "bus" | "motorcycle" | "saf5tonner" | "safLandRover";

const CIVILIAN_VEHICLE_TYPES: VehicleType[] = ["sedan", "sedan", "hatchback", "suv", "van", "lorry", "motorcycle"];
const CAR_COLORS = [new Color3(0.75, 0.1, 0.1), new Color3(0.1, 0.15, 0.5), new Color3(0.85, 0.85, 0.85), new Color3(0.15, 0.15, 0.15), new Color3(0.6, 0.6, 0.15)];

/** Parked vehicles along the sidewalks — a mix of civilian traffic plus military vehicles near the camp/checkpoint, placed in guaranteed-clear road-side gaps so none clip into buildings or the carriageway. */
function buildParkedCars(scene: Scene, layout: BuildingFootprint[]): void {
  const rand = mulberry32(4242);
  const wheelMat = new WorldMaterial("wheelMat", scene);
  wheelMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
  wheelMat.specularColor = Color3.Black();

  const carMats = CAR_COLORS.map((color, i) => {
    const mat = new WorldMaterial(`carMat_${i}`, scene);
    mat.diffuseColor = color;
    // Tight glossy highlight so painted panels read as car paint, not matte plastic.
    mat.specularColor = new Color3(0.42, 0.42, 0.45);
    mat.specularPower = 56;
    return mat;
  });
  const busMat = solidMat(scene, "busMat", new Color3(0.85, 0.7, 0.15));
  const safMat = solidMat(scene, "safMat", new Color3(0.28, 0.32, 0.2));

  let vehicleIndex = 0;

  for (const line of MID_LINES) {
    const hw = roadHalfWidth(roadKind(line));
    const curbOffset = hw + 2;
    for (const zSpot of GRID_LINES) {
      if (rand() < 0.42) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const x = line + side * curbOffset;
      const z = zSpot + (rand() - 0.5) * 12;
      if (inGardenDistrict(x, z, 6) || (Math.abs(x) < 18 && Math.abs(z) < 18)) continue;
      if (overlapsAnyBuilding(x, z, 2.4, layout)) continue;
      const rotation = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.12;
      const type = CIVILIAN_VEHICLE_TYPES[Math.floor(rand() * CIVILIAN_VEHICLE_TYPES.length)];
      buildVehicle(scene, type, x, z, rotation, carMats[vehicleIndex % carMats.length], busMat, safMat, wheelMat, vehicleIndex);
      vehicleIndex++;
    }
    for (const xSpot of GRID_LINES) {
      if (rand() < 0.42) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const z = line + side * curbOffset;
      const x = xSpot + (rand() - 0.5) * 12;
      if (inGardenDistrict(x, z, 6) || (Math.abs(x) < 18 && Math.abs(z) < 18)) continue;
      if (overlapsAnyBuilding(x, z, 2.4, layout)) continue;
      const rotation = Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.12;
      const type = CIVILIAN_VEHICLE_TYPES[Math.floor(rand() * CIVILIAN_VEHICLE_TYPES.length)];
      buildVehicle(scene, type, x, z, rotation, carMats[vehicleIndex % carMats.length], busMat, safMat, wheelMat, vehicleIndex);
      vehicleIndex++;
    }
  }

  // A couple of buses on the avenue, and a military logistics cluster at a
  // checkpoint just outside the camp clearing.
  buildVehicle(scene, "bus", 22, -66 + roadHalfWidth("avenue") + 2.4, Math.PI / 2, busMat, busMat, safMat, wheelMat, vehicleIndex++);
  buildVehicle(scene, "bus", -22, 66 - roadHalfWidth("avenue") - 2.4, -Math.PI / 2, busMat, busMat, safMat, wheelMat, vehicleIndex++);

  const checkpointX = CAMP_POSITION.x + 16;
  const checkpointZ = CAMP_POSITION.z + 4;
  buildVehicle(scene, "saf5tonner", checkpointX, checkpointZ, Math.PI / 2, safMat, busMat, safMat, wheelMat, vehicleIndex++);
  buildVehicle(scene, "safLandRover", checkpointX + 4, checkpointZ - 3, Math.PI / 2 + 0.3, safMat, busMat, safMat, wheelMat, vehicleIndex++);
  buildVehicle(scene, "safLandRover", checkpointX - 3, checkpointZ + 5, -Math.PI / 2, safMat, busMat, safMat, wheelMat, vehicleIndex++);
}

const VEHICLE_DIMS: Record<VehicleType, { w: number; h: number; d: number; cabinH: number; cabinD: number }> = {
  sedan: { w: 1.8, h: 0.6, d: 4, cabinH: 0.5, cabinD: 2 },
  hatchback: { w: 1.7, h: 0.6, d: 3.2, cabinH: 0.55, cabinD: 2.2 },
  suv: { w: 1.95, h: 0.95, d: 4.3, cabinH: 0.7, cabinD: 3 },
  van: { w: 1.9, h: 1.3, d: 4.6, cabinH: 0, cabinD: 0 },
  lorry: { w: 2.1, h: 1.6, d: 6, cabinH: 0, cabinD: 0 },
  bus: { w: 2.3, h: 2.2, d: 8.5, cabinH: 0, cabinD: 0 },
  motorcycle: { w: 0.5, h: 0.5, d: 1.6, cabinH: 0, cabinD: 0 },
  saf5tonner: { w: 2.2, h: 1.8, d: 6.2, cabinH: 0, cabinD: 0 },
  safLandRover: { w: 1.85, h: 1.1, d: 3.8, cabinH: 0.55, cabinD: 2 },
};

/** Generalised vehicle builder — body + optional cabin + wheels, dimensions and colour driven by `type`. */
interface CarDetailMats {
  glass: WorldMaterial;
  headlight: WorldMaterial;
  tail: WorldMaterial;
  bumper: WorldMaterial;
  rim: WorldMaterial;
  shadow: WorldMaterial;
}
const carDetailCache = new WeakMap<Scene, CarDetailMats>();
/** Shared window/light/bumper/rim/shadow materials for cars — built once per scene. */
function carDetailMats(scene: Scene): CarDetailMats {
  let m = carDetailCache.get(scene);
  if (!m) {
    const glass = new WorldMaterial("carGlassMat", scene);
    glass.diffuseColor = new Color3(0.1, 0.14, 0.18);
    glass.specularColor = new Color3(0.5, 0.55, 0.6);
    glass.specularPower = 64;
    glass.backFaceCulling = false; // wedge windshields stay visible from any angle
    const headlight = new WorldMaterial("carHeadlightMat", scene);
    headlight.diffuseColor = new Color3(0.9, 0.9, 0.8);
    headlight.emissiveColor = new Color3(0.5, 0.5, 0.42);
    const tail = new WorldMaterial("carTailMat", scene);
    tail.diffuseColor = new Color3(0.5, 0.05, 0.05);
    tail.emissiveColor = new Color3(0.4, 0.03, 0.03);
    const bumper = solidMat(scene, "carBumperMat", new Color3(0.12, 0.12, 0.13));
    const rim = new WorldMaterial("carRimMat", scene);
    rim.diffuseColor = new Color3(0.45, 0.46, 0.48);
    rim.specularColor = new Color3(0.5, 0.5, 0.5);
    rim.specularPower = 48;
    // Soft dark disc under each vehicle — a cheap contact shadow that grounds
    // the car on the road instead of it looking pasted on.
    const shadow = new WorldMaterial("vehShadowMat", scene);
    shadow.diffuseColor = Color3.Black();
    shadow.specularColor = Color3.Black();
    shadow.alpha = 0.32;
    shadow.disableLighting = true;
    m = { glass, headlight, tail, bumper, rim, shadow };
    carDetailCache.set(scene, m);
  }
  return m;
}

function buildVehicle(
  scene: Scene,
  type: VehicleType,
  x: number,
  z: number,
  rotationY: number,
  civMat: WorldMaterial,
  busMat: WorldMaterial,
  safMat: WorldMaterial,
  wheelMat: WorldMaterial,
  index: number
): void {
  const dims = VEHICLE_DIMS[type];
  const isMilitary = type === "saf5tonner" || type === "safLandRover";
  const bodyMat = type === "bus" ? busMat : isMilitary ? safMat : civMat;

  const details = carDetailMats(scene);

  /** Soft elliptical contact shadow under the vehicle footprint. */
  const addBlobShadow = (parent: Mesh, groundLocalY: number, wScale: number, dScale: number): void => {
    const shadow = MeshBuilder.CreateDisc(`veh_${index}_shadow`, { radius: 0.5, tessellation: 20 }, scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.scaling.set(wScale, dScale, 1);
    shadow.position.set(0, groundLocalY + 0.03, 0);
    shadow.material = details.shadow;
    shadow.parent = parent;
    shadow.isPickable = false;
  };

  if (type === "motorcycle") {
    const body = MeshBuilder.CreateBox(`veh_${index}_body`, { width: dims.w, height: dims.h, depth: dims.d }, scene);
    body.position.set(x, 0.35, z);
    body.rotation.y = rotationY;
    body.material = bodyMat;
    body.checkCollisions = true;
    addBlobShadow(body, -0.33, dims.w * 1.6, dims.d * 1.15);
    const seat = MeshBuilder.CreateBox(`veh_${index}_seat`, { width: 0.3, height: 0.1, depth: 0.6 }, scene);
    seat.position.set(0, 0.28, -0.1);
    seat.material = solidMat(scene, `motoSeatMat_${index}`, new Color3(0.1, 0.1, 0.1));
    seat.parent = body;
    seat.isPickable = false;
    const wheelPositions: Array<[number, number]> = [
      [0, 0.7],
      [0, -0.7],
    ];
    wheelPositions.forEach(([wx, wz], i) => {
      const wheel = MeshBuilder.CreateCylinder(`veh_${index}_wheel_${i}`, { diameter: 0.5, height: 0.12 }, scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, -0.15, wz);
      wheel.material = wheelMat;
      wheel.parent = body;
      wheel.isPickable = false;
    });
    return;
  }

  // Position the body so the wheels sit exactly on the ground (no float / no sink):
  // wheels hang at local -dims.h/2, so root height = body half + wheel radius.
  const wheelDia = type === "bus" || type === "lorry" || type === "saf5tonner" ? 0.85 : 0.55;
  const root = MeshBuilder.CreateBox(`veh_${index}_body`, { width: dims.w, height: dims.h, depth: dims.d }, scene);
  root.position.set(x, dims.h / 2 + wheelDia / 2, z);
  root.rotation.y = rotationY;
  root.material = bodyMat;
  root.checkCollisions = true;
  addBlobShadow(root, -(dims.h / 2 + wheelDia / 2), dims.w * 1.5, dims.d * 1.15);

  if (dims.cabinH > 0) {
    const cabin = MeshBuilder.CreateBox(`veh_${index}_cabin`, { width: dims.w * 0.9, height: dims.cabinH, depth: dims.cabinD }, scene);
    cabin.position.set(0, dims.h / 2 + dims.cabinH / 2, dims.d * 0.05);
    cabin.material = bodyMat;
    cabin.parent = root;
    cabin.isPickable = false;

    // Window band wrapping the cabin (protrudes slightly past the body so the
    // glass actually shows), head/taillights, bumpers, and door mirrors —
    // enough detail to read as a real car up close.
    const d = details;
    const glass = MeshBuilder.CreateBox(`veh_${index}_glass`, { width: dims.w * 0.96, height: dims.cabinH * 0.55, depth: dims.cabinD * 0.9 }, scene);
    glass.position.set(0, dims.h / 2 + dims.cabinH * 0.5, dims.d * 0.05);
    glass.material = d.glass;
    glass.parent = root;
    glass.isPickable = false;

    // Raked windshield and rear glass: wedges bridging the bonnet/boot line up
    // to the roof, so the greenhouse has real slopes instead of a cliff face.
    const cabinFrontZ = dims.d * 0.05 + dims.cabinD / 2;
    const cabinRearZ = dims.d * 0.05 - dims.cabinD / 2;
    const windshieldD = Math.min(0.6, (dims.d / 2 - cabinFrontZ) * 0.85);
    if (windshieldD > 0.15) {
      const windshield = createWedge(`veh_${index}_ws`, dims.w * 0.86, dims.cabinH * 0.94, windshieldD, scene);
      windshield.position.set(0, dims.h / 2, cabinFrontZ + windshieldD / 2 - 0.04);
      windshield.material = d.glass;
      windshield.parent = root;
      windshield.isPickable = false;
    }
    const rearD = Math.min(type === "sedan" ? 0.5 : 0.32, (cabinRearZ + dims.d / 2) * 0.7);
    if (rearD > 0.12) {
      const rearGlass = createWedge(`veh_${index}_rw`, dims.w * 0.86, dims.cabinH * 0.9, rearD, scene);
      rearGlass.rotation.y = Math.PI;
      rearGlass.position.set(0, dims.h / 2, cabinRearZ - rearD / 2 + 0.04);
      rearGlass.material = d.glass;
      rearGlass.parent = root;
      rearGlass.isPickable = false;
    }

    for (const side of [-1, 1]) {
      const headlight = MeshBuilder.CreateBox(`veh_${index}_hl_${side}`, { width: 0.16, height: 0.12, depth: 0.05 }, scene);
      headlight.position.set(side * dims.w * 0.3, -0.02, dims.d / 2 - 0.02);
      headlight.material = d.headlight;
      headlight.parent = root;
      headlight.isPickable = false;
      const tail = MeshBuilder.CreateBox(`veh_${index}_tl_${side}`, { width: 0.16, height: 0.1, depth: 0.05 }, scene);
      tail.position.set(side * dims.w * 0.3, -0.02, -dims.d / 2 + 0.02);
      tail.material = d.tail;
      tail.parent = root;
      tail.isPickable = false;
      const mirror = MeshBuilder.CreateBox(`veh_${index}_mir_${side}`, { width: 0.1, height: 0.06, depth: 0.06 }, scene);
      mirror.position.set(side * (dims.w / 2 + 0.05), dims.h / 2, dims.d * 0.28);
      mirror.material = bodyMat;
      mirror.parent = root;
      mirror.isPickable = false;
    }
    for (const end of [-1, 1]) {
      const bumper = MeshBuilder.CreateBox(`veh_${index}_bmp_${end}`, { width: dims.w * 0.98, height: 0.14, depth: 0.12 }, scene);
      bumper.position.set(0, -dims.h / 2 + 0.05, end * (dims.d / 2 - 0.02));
      bumper.material = d.bumper;
      bumper.parent = root;
      bumper.isPickable = false;
    }
  } else if (type === "lorry" || type === "saf5tonner") {
    // Separate cab + open cargo bed with a canvas tilt for the 5-tonner.
    const cab = MeshBuilder.CreateBox(`veh_${index}_cab`, { width: dims.w * 0.95, height: 0.9, depth: 1.4 }, scene);
    cab.position.set(0, dims.h / 2 + 0.45, dims.d / 2 - 0.9);
    cab.material = bodyMat;
    cab.parent = root;
    cab.isPickable = false;
    // Raked windscreen panel on the cab face.
    const cabGlass = MeshBuilder.CreateBox(`veh_${index}_cabglass`, { width: dims.w * 0.82, height: 0.5, depth: 0.05 }, scene);
    cabGlass.position.set(0, dims.h / 2 + 0.6, dims.d / 2 - 0.16);
    cabGlass.rotation.x = -0.22;
    cabGlass.material = details.glass;
    cabGlass.parent = root;
    cabGlass.isPickable = false;
    if (type === "saf5tonner") {
      const canvas = MeshBuilder.CreateBox(`veh_${index}_canvas`, { width: dims.w * 0.92, height: 1.1, depth: dims.d * 0.55 }, scene);
      canvas.position.set(0, dims.h / 2 + 0.55, -dims.d * 0.12);
      canvas.material = solidMat(scene, `safCanvasMat_${index}`, new Color3(0.35, 0.38, 0.28));
      canvas.parent = root;
      canvas.isPickable = false;
    }
  } else if (type === "bus" || type === "van") {
    // Window band along the side for buses/vans.
    const band = MeshBuilder.CreateBox(`veh_${index}_band`, { width: dims.w + 0.02, height: dims.h * 0.3, depth: dims.d * 0.85 }, scene);
    band.position.set(0, dims.h * 0.22, 0);
    band.material = solidMat(scene, `vehWindowMat_${index}`, new Color3(0.15, 0.2, 0.24));
    band.parent = root;
    band.isPickable = false;
  }

  const wheelPositions: Array<[number, number]> = [
    [-dims.w / 2 * 0.55, dims.d / 2 - 0.7],
    [dims.w / 2 * 0.55, dims.d / 2 - 0.7],
    [-dims.w / 2 * 0.55, -dims.d / 2 + 0.7],
    [dims.w / 2 * 0.55, -dims.d / 2 + 0.7],
  ];
  wheelPositions.forEach(([wx, wz], i) => {
    const wheel = MeshBuilder.CreateCylinder(`veh_${index}_wheel_${i}`, { diameter: wheelDia, height: 0.3, tessellation: 18 }, scene);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, -dims.h / 2, wz);
    wheel.material = wheelMat;
    wheel.parent = root;
    wheel.isPickable = false;
    // Alloy rim/hubcap: a slightly wider, smaller-diameter light disc through
    // the tyre so wheels read as wheel + rim, not a plain black puck.
    const rim = MeshBuilder.CreateCylinder(`veh_${index}_rim_${i}`, { diameter: wheelDia * 0.55, height: 0.32, tessellation: 14 }, scene);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, -dims.h / 2, wz);
    rim.material = details.rim;
    rim.parent = root;
    rim.isPickable = false;
  });
}

/** Streetlights, trash bins, and bus stops along the roads/blocks — small set-dressing props, not collidable except the lamp pole. */
function buildStreetFurniture(scene: Scene, layout: BuildingFootprint[]): void {
  const poleMat = new WorldMaterial("lampPoleMat", scene);
  poleMat.diffuseColor = new Color3(0.12, 0.12, 0.13);
  poleMat.specularColor = Color3.Black();
  const lampMat = new WorldMaterial("lampHeadMat", scene);
  lampMat.diffuseColor = new Color3(0.9, 0.85, 0.6);
  lampMat.emissiveColor = new Color3(0.5, 0.45, 0.25);

  const binMat = new WorldMaterial("binMat", scene);
  binMat.diffuseColor = new Color3(0.15, 0.35, 0.2);
  binMat.specularColor = Color3.Black();
  const binLidMat = new WorldMaterial("binLidMat", scene);
  binLidMat.diffuseColor = new Color3(0.1, 0.25, 0.14);

  const shelterMat = solidMat(scene, "busShelterMat", new Color3(0.4, 0.45, 0.48));
  const benchMat = solidMat(scene, "busShelterBenchMat", new Color3(0.35, 0.28, 0.18));

  const rand = mulberry32(808);
  let lampIndex = 0;
  let binIndex = 0;
  let shelterIndex = 0;

  for (const line of MID_LINES) {
    const curbOffset = roadHalfWidth(roadKind(line)) + 2.2;
    for (const spot of GRID_LINES) {
      if (rand() < 0.5) {
        const x = line + curbOffset;
        const z = spot;
        if (!inGardenDistrict(x, z, 4) && !(Math.abs(x) < 20 && Math.abs(z) < 20) && !overlapsAnyBuilding(x, z, 1.5, layout)) {
          buildStreetlight(scene, x, z, poleMat, lampMat, lampIndex++);
        }
      }
      if (rand() < 0.35) {
        const z = line + curbOffset;
        const x = spot;
        if (!inGardenDistrict(x, z, 4) && !(Math.abs(x) < 20 && Math.abs(z) < 20) && !overlapsAnyBuilding(x, z, 1.5, layout)) {
          buildStreetlight(scene, x, z, poleMat, lampMat, lampIndex++);
        }
      }
      if (roadKind(line) === "street" && rand() < 0.12) {
        const x = line + curbOffset + 1.4;
        const z = spot;
        if (!inGardenDistrict(x, z, 4) && !(Math.abs(x) < 20 && Math.abs(z) < 20) && !overlapsAnyBuilding(x, z, 2, layout)) {
          buildBusStop(scene, x, z, Math.PI / 2, shelterMat, benchMat, shelterIndex++);
        }
      }
    }
  }

  for (const building of layout) {
    if (rand() < 0.55) continue;
    const angle = rand() * Math.PI * 2;
    const dist = building.size / 2 + 1.3;
    const x = building.x + Math.cos(angle) * dist;
    const z = building.z + Math.sin(angle) * dist;
    if (overlapsAnyBuilding(x, z, 0.6, layout)) continue;
    buildTrashBin(scene, x, z, binMat, binLidMat, binIndex++);
  }
}

function buildStreetlight(scene: Scene, x: number, z: number, poleMat: WorldMaterial, lampMat: WorldMaterial, index: number): void {
  const pole = MeshBuilder.CreateCylinder(`lampPole_${index}`, { diameter: 0.18, height: 5.5 }, scene);
  pole.position.set(x, 2.75, z);
  pole.material = poleMat;
  pole.checkCollisions = true;

  const arm = MeshBuilder.CreateCylinder(`lampArm_${index}`, { diameter: 0.1, height: 1.1 }, scene);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(x + 0.55, 5.3, z);
  arm.material = poleMat;
  arm.isPickable = false;

  const head = MeshBuilder.CreateBox(`lampHead_${index}`, { width: 0.4, height: 0.22, depth: 0.4 }, scene);
  head.position.set(x + 1.1, 5.2, z);
  head.material = lampMat;
  head.isPickable = false;
}

function buildTrashBin(scene: Scene, x: number, z: number, binMat: WorldMaterial, lidMat: WorldMaterial, index: number): void {
  const body = MeshBuilder.CreateCylinder(`trashBin_${index}`, { diameter: 0.6, height: 0.9 }, scene);
  body.position.set(x, 0.45, z);
  body.material = binMat;
  body.checkCollisions = true;

  const lid = MeshBuilder.CreateCylinder(`trashBinLid_${index}`, { diameter: 0.65, height: 0.08 }, scene);
  lid.position.set(x, 0.93, z);
  lid.material = lidMat;
  lid.isPickable = false;
}

/** Simple bus shelter: roof + two posts + a bench, Singapore-style covered waiting area. */
function buildBusStop(scene: Scene, x: number, z: number, rotY: number, shelterMat: WorldMaterial, benchMat: WorldMaterial, index: number): void {
  const roof = MeshBuilder.CreateBox(`busStopRoof_${index}`, { width: 2.6, height: 0.1, depth: 1.3 }, scene);
  roof.position.set(x, 2.3, z);
  roof.rotation.y = rotY;
  roof.material = shelterMat;
  roof.checkCollisions = true;

  for (const off of [-1.1, 1.1]) {
    const post = MeshBuilder.CreateCylinder(`busStopPost_${index}_${off}`, { diameter: 0.1, height: 2.3 }, scene);
    post.position.set(x + Math.cos(rotY) * off, 1.15, z - Math.sin(rotY) * off);
    post.material = shelterMat;
    post.isPickable = false;
  }

  const bench = MeshBuilder.CreateBox(`busStopBench_${index}`, { width: 1.8, height: 0.4, depth: 0.4 }, scene);
  bench.position.set(x, 0.2, z + 0.35);
  bench.rotation.y = rotY;
  bench.material = benchMat;
  bench.checkCollisions = true;
}

/**
 * Small street-level clutter scattered around building frontages to make the
 * city feel lived-in: concrete planters, bollards, fire hydrants, potted
 * plants, and wall-mounted AC units. Bounded (a couple of tries per building)
 * and kept off the carriageway / out of buildings for performance and sanity.
 */
function buildUrbanClutter(scene: Scene, layout: BuildingFootprint[]): void {
  const rand = mulberry32(1717);
  const planterMat = solidMat(scene, "planterMat", new Color3(0.42, 0.38, 0.32));
  const plantMat = solidMat(scene, "clutterPlantMat", new Color3(0.2, 0.4, 0.19));
  const bollardMat = solidMat(scene, "bollardMat", new Color3(0.22, 0.22, 0.24));
  const hydrantMat = solidMat(scene, "hydrantMat", new Color3(0.7, 0.16, 0.12));
  const potMat = solidMat(scene, "potMat", new Color3(0.5, 0.32, 0.22));
  const acMat = solidMat(scene, "acUnitMat", new Color3(0.62, 0.62, 0.64));
  let idx = 0;

  for (const b of layout) {
    // A wall-mounted AC unit or two on taller residential/commercial blocks.
    if ((b.type === "hdb" || b.type === "shophouse") && rand() < 0.7) {
      const acCount = 1 + Math.floor(rand() * 3);
      for (let a = 0; a < acCount; a++) {
        const side = rand() < 0.5 ? 1 : -1;
        const along = (rand() - 0.5) * b.size * 0.7;
        const onX = rand() < 0.5;
        const ac = MeshBuilder.CreateBox(`acUnit_${idx}_${a}`, { width: 0.7, height: 0.5, depth: 0.35 }, scene);
        const wy = 3 + rand() * Math.max(2, b.height - 5);
        if (onX) ac.position.set(b.x + side * (b.size / 2 + 0.18), wy, b.z + along);
        else ac.position.set(b.x + along, wy, b.z + side * (b.size / 2 + 0.18));
        ac.material = acMat;
        ac.isPickable = false;
      }
    }

    for (let t = 0; t < 2; t++) {
      const angle = rand() * Math.PI * 2;
      const dist = b.size / 2 + 1.1 + rand() * 1.4;
      const x = b.x + Math.cos(angle) * dist;
      const z = b.z + Math.sin(angle) * dist;
      if (inGardenDistrict(x, z, 4)) continue;
      if (Math.abs(x) < 20 && Math.abs(z) < 20) continue;
      if (overlapsAnyBuilding(x, z, 0.5, layout)) continue;
      if (distanceToNearestRoad(x, z) < 0.6) continue;

      const r = rand();
      if (r < 0.32) {
        // Concrete planter with greenery.
        const planter = MeshBuilder.CreateBox(`planter_${idx}`, { width: 1.0, height: 0.5, depth: 1.0 }, scene);
        planter.position.set(x, 0.25, z);
        planter.material = planterMat;
        planter.checkCollisions = true;
        const green = MeshBuilder.CreateBox(`planterGreen_${idx}`, { width: 0.86, height: 0.3, depth: 0.86 }, scene);
        green.position.set(x, 0.6, z);
        green.material = plantMat;
        green.isPickable = false;
      } else if (r < 0.55) {
        // Row of three bollards.
        for (let k = -1; k <= 1; k++) {
          const bollard = MeshBuilder.CreateCylinder(`bollard_${idx}_${k}`, { diameter: 0.16, height: 0.9 }, scene);
          bollard.position.set(x + k * 0.7, 0.45, z);
          bollard.material = bollardMat;
          bollard.checkCollisions = true;
        }
      } else if (r < 0.72) {
        // Fire hydrant.
        const body = MeshBuilder.CreateCylinder(`hydrant_${idx}`, { diameter: 0.24, height: 0.6 }, scene);
        body.position.set(x, 0.3, z);
        body.material = hydrantMat;
        body.checkCollisions = true;
        const cap = MeshBuilder.CreateSphere(`hydrantCap_${idx}`, { diameter: 0.26 }, scene);
        cap.position.set(x, 0.62, z);
        cap.material = hydrantMat;
        cap.isPickable = false;
      } else {
        // Potted plant.
        const pot = MeshBuilder.CreateCylinder(`pot_${idx}`, { diameterTop: 0.42, diameterBottom: 0.3, height: 0.42 }, scene);
        pot.position.set(x, 0.21, z);
        pot.material = potMat;
        pot.checkCollisions = true;
        const bush = MeshBuilder.CreateSphere(`potBush_${idx}`, { diameter: 0.6, segments: 6 }, scene);
        bush.position.set(x, 0.62, z);
        bush.scaling.y = 0.8;
        bush.material = plantMat;
        bush.isPickable = false;
      }
      idx++;
    }
  }
}

/**
 * Fully explorable cargo terminal for the industrial estate: parallel rows of
 * shipping containers all aligned the same way, laid out with wide clear lanes
 * (~4.5 m) between rows that stay open at both ends — no dead ends, no random
 * rotations, so both the player and AI can move freely between the lanes.
 * Rows carry occasional stacks and gaps for cover. A couple of gantry-style
 * frames and light poles dress the yard.
 */
function buildContainerYard(scene: Scene): void {
  const colors = [
    new Color3(0.65, 0.15, 0.1),
    new Color3(0.1, 0.35, 0.55),
    new Color3(0.15, 0.45, 0.2),
    new Color3(0.65, 0.55, 0.1),
    new Color3(0.5, 0.5, 0.52),
  ];
  const mats = colors.map((c, i) => solidMat(scene, `containerMat_${i}`, c));
  const rand = mulberry32(606);

  // Terminal footprint (kept inside the industrial SE quadrant). Containers run
  // with their long axis along X; rows are spaced along Z with walkable lanes.
  const originX = 46;
  const originZ = -86;
  const rows = 6;
  const rowPitch = 6.5; // 2.4 container depth + ~4.1 lane
  const containerLen = 6;
  const containerW = 2.4;
  const perRow = 5;
  let index = 0;

  for (let row = 0; row < rows; row++) {
    const z = originZ + row * rowPitch;
    for (let c = 0; c < perRow; c++) {
      if (rand() < 0.22) continue; // gap in the row — a through-route / cover break
      const x = originX + c * (containerLen + 0.4);
      const base = MeshBuilder.CreateBox(`container_${index}`, { width: containerLen, height: containerW, depth: containerW }, scene);
      base.position.set(x, containerW / 2, z);
      base.material = mats[(row + c) % mats.length];
      base.checkCollisions = true;
      index++;
      if (rand() < 0.35) {
        const top = MeshBuilder.CreateBox(`container_${index}`, { width: containerLen, height: containerW, depth: containerW }, scene);
        top.position.set(x, containerW * 1.5, z);
        top.material = mats[(row + c + 2) % mats.length];
        top.checkCollisions = true;
        index++;
      }
    }
  }

  // A gantry frame straddling the yard + a couple of tall floodlight poles.
  const steelMat = solidMat(scene, "yardSteelMat", new Color3(0.55, 0.45, 0.2));
  const gantryZ = originZ + rows * rowPitch + 3;
  for (const px of [originX - 2, originX + perRow * (containerLen + 0.4)]) {
    const leg = MeshBuilder.CreateBox(`yardGantryLeg_${px}`, { width: 0.5, height: 8, depth: 0.5 }, scene);
    leg.position.set(px, 4, gantryZ);
    leg.material = steelMat;
    leg.checkCollisions = true;
  }
  const beam = MeshBuilder.CreateBox("yardGantryBeam", { width: perRow * (containerLen + 0.4) + 2, height: 0.6, depth: 0.6 }, scene);
  beam.position.set(originX + (perRow * (containerLen + 0.4)) / 2 - 1, 8, gantryZ);
  beam.material = steelMat;
  beam.isPickable = false;

  const poleMat = solidMat(scene, "yardFloodPoleMat", new Color3(0.2, 0.2, 0.22));
  const lampMat = new WorldMaterial("yardFloodLampMat", scene);
  lampMat.diffuseColor = new Color3(0.9, 0.88, 0.7);
  lampMat.emissiveColor = new Color3(0.5, 0.48, 0.3);
  for (const [lx, lz] of [[originX - 3, originZ - 3], [originX + perRow * 6.4, originZ - 3]] as const) {
    const pole = MeshBuilder.CreateCylinder(`yardFlood_${lx}_${lz}`, { diameter: 0.3, height: 9 }, scene);
    pole.position.set(lx, 4.5, lz);
    pole.material = poleMat;
    pole.checkCollisions = true;
    const head = MeshBuilder.CreateBox(`yardFloodHead_${lx}_${lz}`, { width: 1.2, height: 0.3, depth: 0.4 }, scene);
    head.position.set(lx, 9, lz);
    head.material = lampMat;
    head.isPickable = false;
  }
}

/**
 * An open-deck multi-storey car park (HDB-estate style): a stack of concrete
 * floor slabs on columns with low perimeter barriers, open sides, a stair/lift
 * core, and a few cars parked on the decks. Sits in its own reserved footprint.
 */
function buildCarPark(scene: Scene): void {
  const cx = CARPARK_POS.x;
  const cz = CARPARK_POS.z;
  const W = 20; // along X
  const D = 16; // along Z
  const levels = 4;
  const levelH = 2.8;
  const concreteMat = solidMat(scene, "carparkConcreteMat", new Color3(0.62, 0.62, 0.58));
  const columnMat = solidMat(scene, "carparkColumnMat", new Color3(0.55, 0.55, 0.52));
  const barrierMat = solidMat(scene, "carparkBarrierMat", new Color3(0.5, 0.5, 0.48));
  const coreMat = solidMat(scene, "carparkCoreMat", new Color3(0.58, 0.57, 0.5));
  const carMats = CAR_COLORS.map((c, i) => solidMat(scene, `carparkCarMat_${i}`, c));
  const wheelMat = solidMat(scene, "carparkWheelMat", new Color3(0.05, 0.05, 0.05));

  // Ground slab + one slab per level.
  for (let lv = 0; lv <= levels; lv++) {
    const slab = MeshBuilder.CreateBox(`carparkSlab_${lv}`, { width: W, height: 0.25, depth: D }, scene);
    slab.position.set(cx, lv * levelH, cz);
    slab.material = concreteMat;
    slab.checkCollisions = true;
  }
  // Columns at a grid.
  const colXs = [-W / 2 + 1, -W / 6, W / 6, W / 2 - 1];
  const colZs = [-D / 2 + 1, 0, D / 2 - 1];
  for (const gx of colXs) {
    for (const gz of colZs) {
      const col = MeshBuilder.CreateBox(`carparkCol_${gx}_${gz}`, { width: 0.5, height: levels * levelH, depth: 0.5 }, scene);
      col.position.set(cx + gx, (levels * levelH) / 2, cz + gz);
      col.material = columnMat;
      col.checkCollisions = true;
    }
  }
  // Low perimeter barrier walls on each deck (front + back + sides, waist high).
  for (let lv = 1; lv <= levels; lv++) {
    const y = lv * levelH + 0.5;
    for (const side of [-1, 1]) {
      const front = MeshBuilder.CreateBox(`carparkBarF_${lv}_${side}`, { width: W, height: 0.9, depth: 0.2 }, scene);
      front.position.set(cx, y, cz + (side * D) / 2);
      front.material = barrierMat;
      front.checkCollisions = true;
      const sideW = MeshBuilder.CreateBox(`carparkBarS_${lv}_${side}`, { width: 0.2, height: 0.9, depth: D }, scene);
      sideW.position.set(cx + (side * W) / 2, y, cz);
      sideW.material = barrierMat;
      sideW.checkCollisions = true;
    }
  }
  // Stair/lift core on the west end.
  const core = MeshBuilder.CreateBox("carparkCore", { width: 3, height: levels * levelH + 1, depth: 4 }, scene);
  core.position.set(cx - W / 2 - 1, (levels * levelH + 1) / 2, cz);
  core.material = coreMat;
  core.checkCollisions = true;

  // A handful of parked cars on a couple of decks (bodies only — decor).
  const rand = mulberry32(321);
  for (let lv = 0; lv < levels; lv++) {
    if (rand() < 0.3) continue;
    for (let k = 0; k < 3; k++) {
      const px = cx - W / 2 + 4 + k * 5 + (rand() - 0.5) * 1.5;
      const body = MeshBuilder.CreateBox(`carparkCar_${lv}_${k}`, { width: 1.8, height: 0.6, depth: 4 }, scene);
      body.position.set(px, lv * levelH + 0.55, cz + (rand() < 0.5 ? -3 : 3));
      body.material = carMats[(lv + k) % carMats.length];
      body.isPickable = false;
      const cabin = MeshBuilder.CreateBox(`carparkCarCab_${lv}_${k}`, { width: 1.6, height: 0.5, depth: 2 }, scene);
      cabin.position.set(px, lv * levelH + 1.05, cz + (body.position.z - cz));
      cabin.material = body.material;
      cabin.isPickable = false;
      for (const [wx, wz] of [[-0.8, 1.3], [0.8, 1.3], [-0.8, -1.3], [0.8, -1.3]] as const) {
        const wheel = MeshBuilder.CreateCylinder(`carparkWheel_${lv}_${k}_${wx}_${wz}`, { diameter: 0.5, height: 0.25 }, scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(px + wx, lv * levelH + 0.4, body.position.z + wz);
        wheel.material = wheelMat;
        wheel.isPickable = false;
      }
    }
  }
}

/** Roadside trees along the sidewalks for tropical greenery, kept off the carriageway and clear of the reserved districts. */
function buildRoadsideTrees(scene: Scene, layout: BuildingFootprint[]): void {
  const rand = mulberry32(555);
  const trunkMat = solidMat(scene, "roadTreeTrunkMat", new Color3(0.32, 0.22, 0.14));
  const canopyMat = solidMat(scene, "roadTreeCanopyMat", new Color3(0.2, 0.42, 0.18));
  let i = 0;
  for (const line of MID_LINES) {
    const curb = roadHalfWidth(roadKind(line)) + 2.4;
    for (const spot of GRID_LINES) {
      for (const [x, z] of [[line + curb, spot], [spot, line + curb]] as const) {
        if (rand() < 0.55) continue;
        if (inGardenDistrict(x, z, 4) || inCargoZone(x, z, 2) || inMbsZone(x, z, 2) || inCarparkZone(x, z, 2)) continue;
        if (Math.abs(x) < 20 && Math.abs(z) < 20) continue;
        if (overlapsAnyBuilding(x, z, 1.2, layout)) continue;
        if (distanceToNearestRoad(x, z) < 0.8) continue;
        const trunk = MeshBuilder.CreateCylinder(`roadTree_${i}_trunk`, { diameter: 0.3, height: 2.4 }, scene);
        trunk.position.set(x, 1.2, z);
        trunk.material = trunkMat;
        trunk.checkCollisions = true;
        const canopy = MeshBuilder.CreateSphere(`roadTree_${i}_canopy`, { diameter: 2.6 + rand() * 1.2, segments: 6 }, scene);
        canopy.position.set(x, 3.1, z);
        canopy.scaling.y = 0.85;
        canopy.material = canopyMat;
        canopy.isPickable = false;
        i++;
      }
    }
  }
}

/**
 * Jungle floor: dark humus base with leaf-litter speckle, dappled
 * light-through-canopy patches, and root-shadow blotches — reads as forest
 * floor underfoot instead of a flat mown lawn. Same DynamicTexture recipe as
 * the pavement/road textures elsewhere in this file.
 */
function createJungleFloorTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture("jungleFloorTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#1e2414";
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(4488);
  // Soft dappled-light patches (sun breaking through canopy gaps).
  for (let i = 0; i < 40; i++) {
    const shade = 40 + Math.floor(rand() * 30);
    ctx.fillStyle = `rgba(${shade + 30},${shade + 45},${shade + 10},0.14)`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 10 + rand() * 26, 8 + rand() * 20, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dark root/shadow blotches.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = "rgba(8,10,5,0.22)";
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 8 + rand() * 20, 6 + rand() * 14, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Leaf-litter speckle.
  for (let i = 0; i < 2200; i++) {
    const g = 20 + Math.floor(rand() * 40);
    const brown = rand() < 0.4;
    ctx.fillStyle = brown ? `rgba(${g + 30},${g + 15},${g - 5},0.5)` : `rgba(${g},${g + 22},${g - 4},0.5)`;
    ctx.fillRect(rand() * size, rand() * size, 1.6, 1.6);
  }
  tex.update();
  tex.hasAlpha = false;
  return tex;
}

/** Park/forest district: jungle floor, a lake, a canal, dense layered tropical canopy, undergrowth, fallen logs, benches, a playground, and the camp clearing. */
function buildGardenDistrict(scene: Scene): void {
  const floorMat = new WorldMaterial("jungleFloorMat", scene);
  floorMat.diffuseColor = new Color3(0.36, 0.4, 0.3); // multiplies the texture; kept light so the texture reads, not muddy black
  floorMat.specularColor = Color3.Black();
  const floorTex = createJungleFloorTexture(scene);
  floorTex.uScale = 22;
  floorTex.vScale = 22;
  floorMat.diffuseTexture = floorTex;

  const centerX = (GARDEN_BOUNDS.minX + GARDEN_BOUNDS.maxX) / 2;
  const centerZ = (GARDEN_BOUNDS.minZ + GARDEN_BOUNDS.maxZ) / 2;
  const width = GARDEN_BOUNDS.maxX - GARDEN_BOUNDS.minX;
  const depth = GARDEN_BOUNDS.maxZ - GARDEN_BOUNDS.minZ;

  const grass = MeshBuilder.CreateGround("gardenGrass", { width, height: depth }, scene);
  grass.position.set(centerX, 0.02, centerZ);
  grass.material = floorMat;
  grass.isPickable = false;

  buildLake(scene, centerX + 8, centerZ - 6, 14);
  buildCanal(scene);
  buildTrees(scene, centerX, centerZ, width, depth);
  buildUndergrowth(scene, centerX, centerZ, width, depth);
  buildFallenLogs(scene, centerX, centerZ, width, depth);
  buildBenches(scene, centerX, centerZ);
  buildPlayground(scene, centerX - 12, centerZ + 14);
  buildCamp(scene);
}

/** A neighbourhood playground: rubberised mat, a slide, a swing set, a see-saw, and a climbing frame. */
function buildPlayground(scene: Scene, cx: number, cz: number): void {
  const matMat = solidMat(scene, "playgroundMatMat", new Color3(0.5, 0.28, 0.24)); // rubberised safety mat
  const frameMat = solidMat(scene, "playgroundFrameMat", new Color3(0.85, 0.55, 0.15));
  const blueMat = solidMat(scene, "playgroundBlueMat", new Color3(0.2, 0.45, 0.7));
  const seatMat = solidMat(scene, "playgroundSeatMat", new Color3(0.15, 0.15, 0.16));

  const mat = MeshBuilder.CreateGround("playgroundMat", { width: 14, height: 12 }, scene);
  mat.position.set(cx, 0.04, cz);
  mat.material = matMat;
  mat.isPickable = false;

  // Slide: a raised platform, a ladder, and a sloped chute.
  const platform = MeshBuilder.CreateBox("pgSlidePlatform", { width: 1.4, height: 0.15, depth: 1.4 }, scene);
  platform.position.set(cx - 4, 1.5, cz - 3);
  platform.material = blueMat;
  platform.checkCollisions = true;
  for (const px of [-0.6, 0.6]) {
    const leg = MeshBuilder.CreateCylinder(`pgSlideLeg_${px}`, { diameter: 0.1, height: 1.5 }, scene);
    leg.position.set(cx - 4 + px, 0.75, cz - 3);
    leg.material = frameMat;
    leg.isPickable = false;
  }
  const chute = MeshBuilder.CreateBox("pgChute", { width: 0.8, height: 0.08, depth: 2.6 }, scene);
  chute.position.set(cx - 4, 0.9, cz - 1.6);
  chute.rotation.x = 0.5;
  chute.material = frameMat;
  chute.checkCollisions = true;

  // Swing set: A-frame uprights + a top bar + two seats.
  for (const sx of [-1.4, 1.4]) {
    const upA = MeshBuilder.CreateCylinder(`pgSwingA_${sx}`, { diameter: 0.1, height: 2.4 }, scene);
    upA.position.set(cx + 3 + sx, 1.2, cz + 2 - 0.5);
    upA.rotation.x = 0.2;
    upA.material = frameMat;
    upA.checkCollisions = true;
    const upB = MeshBuilder.CreateCylinder(`pgSwingB_${sx}`, { diameter: 0.1, height: 2.4 }, scene);
    upB.position.set(cx + 3 + sx, 1.2, cz + 2 + 0.5);
    upB.rotation.x = -0.2;
    upB.material = frameMat;
    upB.isPickable = false;
  }
  const topBar = MeshBuilder.CreateCylinder("pgSwingTop", { diameter: 0.1, height: 3 }, scene);
  topBar.rotation.z = Math.PI / 2;
  topBar.position.set(cx + 3, 2.3, cz + 2);
  topBar.material = frameMat;
  topBar.isPickable = false;
  for (const sx of [-0.7, 0.7]) {
    const seat = MeshBuilder.CreateBox(`pgSwingSeat_${sx}`, { width: 0.5, height: 0.06, depth: 0.25 }, scene);
    seat.position.set(cx + 3 + sx, 0.6, cz + 2);
    seat.material = seatMat;
    seat.isPickable = false;
  }

  // Climbing frame: a small cube of bars.
  for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const post = MeshBuilder.CreateCylinder(`pgClimbPost_${bx}_${bz}`, { diameter: 0.08, height: 1.6 }, scene);
    post.position.set(cx + bx, 0.8, cz + 4 + bz);
    post.material = blueMat;
    post.checkCollisions = true;
  }
  const climbTop = MeshBuilder.CreateBox("pgClimbTop", { width: 2, height: 0.08, depth: 2 }, scene);
  climbTop.position.set(cx, 1.6, cz + 4);
  climbTop.material = blueMat;
  climbTop.isPickable = false;
}

function buildLake(scene: Scene, x: number, z: number, diameter: number): void {
  const waterMat = new WorldMaterial("waterMat", scene);
  waterMat.diffuseColor = new Color3(0.15, 0.35, 0.5);
  // Smooth dielectric: the lake mirrors the sky environment for a real water read.
  waterMat.roughness = 0.08;
  waterMat.alpha = 0.9;

  const water = MeshBuilder.CreateDisc("lake", { radius: diameter / 2, tessellation: 24 }, scene);
  water.rotation.x = Math.PI / 2;
  water.position.set(x, 0.05, z);
  water.material = waterMat;
  water.isPickable = false;

  // Low invisible kerb ring so the player can't walk out onto the water.
  const kerbMat = new WorldMaterial("kerbMat", scene);
  kerbMat.diffuseColor = new Color3(0.5, 0.48, 0.42);
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const kerb = MeshBuilder.CreateBox(`lakeKerb_${i}`, { width: 2.4, height: 0.6, depth: 0.6 }, scene);
    kerb.position.set(x + Math.cos(angle) * (diameter / 2 + 0.3), 0.3, z + Math.sin(angle) * (diameter / 2 + 0.3));
    kerb.rotation.y = -angle;
    kerb.material = kerbMat;
    kerb.checkCollisions = true;
    kerb.isVisible = false;
  }
}

/** A park-connector canal running along the garden district's eastern edge, railed off with metal railings. */
function buildCanal(scene: Scene): void {
  const waterMat = new WorldMaterial("canalWaterMat", scene);
  waterMat.diffuseColor = new Color3(0.14, 0.3, 0.42);
  waterMat.roughness = 0.12;
  waterMat.alpha = 0.9;

  const canalX = GARDEN_BOUNDS.maxX - 3;
  const canal = MeshBuilder.CreateGround("canal", { width: 3.5, height: GARDEN_BOUNDS.maxZ - GARDEN_BOUNDS.minZ }, scene);
  canal.position.set(canalX, 0.04, (GARDEN_BOUNDS.minZ + GARDEN_BOUNDS.maxZ) / 2);
  canal.material = waterMat;
  canal.isPickable = false;

  const railMat = solidMat(scene, "canalRailMat", new Color3(0.3, 0.32, 0.34));
  for (const side of [-1, 1]) {
    buildFenceLine(
      scene,
      canalX + side * 2,
      (GARDEN_BOUNDS.minZ + GARDEN_BOUNDS.maxZ) / 2,
      Math.PI / 2,
      0.9,
      railMat,
      side === -1 ? 900 : 901,
      "canalRailing"
    );
  }
}

/**
 * A Singapore-style concrete monsoon drainage canal cutting E–W across the
 * central plaza corridor (the z≈0 band is clear of grid buildings). It adds the
 * one thing a flat street grid lacks: real vertical relief. The channel floor
 * sits ~1.2m below street level (accessible low ground / a fighting trench),
 * reached by sloped concrete embankments on both long sides; two pedestrian
 * footbridges span it so the two halves of the map stay interconnected without
 * forcing everyone down into the ditch; a sludge-water strip runs the base; and
 * low kerb walls along the top edges give crouch cover overlooking the cut.
 */
function buildDrainageCanal(scene: Scene): void {
  const halfLen = 42; // extends x = -42 .. +42
  const cz = 0; // centred on the building-free central corridor
  const floorY = -1.25;
  const floorHalfW = 2.0; // channel floor half-width (z)
  const slopeRun = 2.6; // horizontal run of each embankment
  const outerHalfW = floorHalfW + slopeRun; // top edge of the cut

  const concrete = solidMat(scene, "canalConcreteMat", new Color3(0.46, 0.47, 0.44));
  const concreteDark = solidMat(scene, "canalConcreteDarkMat", new Color3(0.34, 0.35, 0.33));

  // Channel floor — walkable low ground.
  const floor = MeshBuilder.CreateGround("drainFloor", { width: halfLen * 2, height: floorHalfW * 2 }, scene);
  floor.position.set(0, floorY, cz);
  floor.material = concreteDark;
  floor.checkCollisions = true;

  // Sludge / storm-water strip down the centre of the base (visual only).
  const waterMat = new WorldMaterial("drainWaterMat", scene);
  waterMat.diffuseColor = new Color3(0.16, 0.22, 0.18);
  waterMat.specularColor = new Color3(0.3, 0.35, 0.32);
  waterMat.alpha = 0.85;
  const water = MeshBuilder.CreateGround("drainWater", { width: halfLen * 2 - 3, height: 1.5 }, scene);
  water.position.set(0, floorY + 0.05, cz);
  water.material = waterMat;
  water.isPickable = false;

  // Sloped embankments both long sides — walkable ramps ground↔floor.
  const slopeLen = Math.hypot(slopeRun, -floorY);
  const slopeAngle = Math.atan2(-floorY, slopeRun);
  for (const side of [-1, 1]) {
    const slope = MeshBuilder.CreateBox(`drainSlope_${side}`, { width: halfLen * 2, height: 0.3, depth: slopeLen }, scene);
    slope.position.set(0, floorY / 2, cz + side * (floorHalfW + slopeRun / 2));
    // +z side must rise toward +z (outer), so tilt opposite the -z side.
    slope.rotation.x = -side * slopeAngle;
    slope.material = concrete;
    slope.checkCollisions = true;
  }

  // Vertical retaining walls cap each end of the segment.
  for (const side of [-1, 1]) {
    const endWall = MeshBuilder.CreateBox(`drainEnd_${side}`, { width: outerHalfW * 2, height: -floorY, depth: 0.4 }, scene);
    endWall.position.set(side * halfLen, floorY / 2, cz);
    endWall.material = concreteDark;
    endWall.checkCollisions = true;
  }

  // Culvert bridge decks where north-south roads cross the cut — the road
  // surface rides on a concrete deck (as real roads bridge monsoon drains)
  // instead of hovering over the void. The canal becomes trench segments
  // between crossings, still entered/exited via the embankment slopes.
  for (const m of MID_LINES) {
    if (Math.abs(m) > 41) continue;
    const hw = roadHalfWidth(roadKind(m));
    const deck = MeshBuilder.CreateBox(`drainCulvert_${m}`, { width: hw * 2 + 1.6, height: 0.6, depth: outerHalfW * 2 + 0.6 }, scene);
    deck.position.set(m, -0.29, cz);
    deck.material = concrete;
    deck.checkCollisions = true;
  }

  // Two footbridges over the cut, with railings — keep the halves connected.
  const bridgeMat = solidMat(scene, "drainBridgeMat", new Color3(0.4, 0.4, 0.42));
  const railMat = solidMat(scene, "drainRailMat", new Color3(0.28, 0.3, 0.32));
  for (const bx of [-18, 18]) {
    const deck = MeshBuilder.CreateBox(`drainBridge_${bx}`, { width: 3.4, height: 0.2, depth: outerHalfW * 2 + 1 }, scene);
    deck.position.set(bx, 0.02, cz);
    deck.material = bridgeMat;
    deck.checkCollisions = true;
    for (const side of [-1, 1]) {
      buildFenceLine(scene, bx, cz + side * (outerHalfW + 0.3), 0, 0.9, railMat, bx + side, "drainBridgeRail");
    }
  }

  // Low kerb walls along the top edges as crouch cover, with gaps at the bridges
  // and one open descent point per side.
  for (const side of [-1, 1]) {
    const z = cz + side * (outerHalfW + 0.35);
    for (const x of [-34, -26, -8, 8, 26, 34]) {
      buildLowWall(scene, x, z, 0, concrete, x + side * 1000, "drainKerb");
    }
  }
}

/**
 * Dense layered tropical canopy — the single biggest "jungle, not garden"
 * cue. Two tiers: tall emergent trees poking through with big multi-lobed
 * crowns, and a shorter, denser understory tier packed in beneath/between
 * them, so looking up shows overlapping canopy layers rather than a lawn
 * dotted with single pine-cone trees. Crowns are built from several
 * overlapping flattened spheres (not a cone) for a rounded tropical-broadleaf
 * silhouette, and a fraction of emergents trail a hanging vine.
 */
function buildTrees(scene: Scene, centerX: number, centerZ: number, width: number, depth: number): void {
  const rand = mulberry32(99);
  const trunkMat = new WorldMaterial("trunkMat", scene);
  trunkMat.diffuseColor = new Color3(0.28, 0.2, 0.13);
  trunkMat.specularColor = Color3.Black();
  const vineMat = new WorldMaterial("vineMat", scene);
  vineMat.diffuseColor = new Color3(0.15, 0.28, 0.13);
  vineMat.specularColor = Color3.Black();

  const canopyPalette = [
    new Color3(0.13, 0.32, 0.13),
    new Color3(0.17, 0.38, 0.15),
    new Color3(0.11, 0.28, 0.17),
    new Color3(0.2, 0.4, 0.14),
    new Color3(0.14, 0.34, 0.22),
  ];
  const canopyMats = canopyPalette.map((c, i) => {
    const mat = new WorldMaterial(`canopyMat_${i}`, scene);
    mat.diffuseColor = c;
    mat.specularColor = Color3.Black();
    return mat;
  });

  const lakeCenter = new Vector3(centerX + 8, 0, centerZ - 6);

  /** One tropical-broadleaf tree: tapered trunk + a cluster of overlapping lobes forming a rounded crown. */
  function placeTree(x: number, z: number, index: number, trunkH: number, crownR: number, emergent: boolean): void {
    const trunk = MeshBuilder.CreateCylinder(
      `tree_${index}_trunk`,
      { diameterTop: 0.28 + crownR * 0.05, diameterBottom: 0.4 + crownR * 0.09, height: trunkH, tessellation: 7 },
      scene
    );
    trunk.position.set(x, trunkH / 2, z);
    trunk.material = trunkMat;
    trunk.checkCollisions = true;

    const crownY = trunkH + crownR * 0.4;
    const lobes = 3 + Math.floor(rand() * 3); // 3-5 overlapping lobes per crown
    const mat = canopyMats[index % canopyMats.length];
    for (let l = 0; l < lobes; l++) {
      const a = (l / lobes) * Math.PI * 2 + rand() * 0.6;
      const r = crownR * (0.35 + rand() * 0.3);
      const lobe = MeshBuilder.CreateSphere(
        `tree_${index}_lobe_${l}`,
        { diameterX: crownR * (1.3 + rand() * 0.5), diameterY: crownR * (0.85 + rand() * 0.3), diameterZ: crownR * (1.3 + rand() * 0.5), segments: 6 },
        scene
      );
      lobe.position.set(x + Math.cos(a) * r, crownY + (rand() - 0.3) * crownR * 0.3, z + Math.sin(a) * r);
      lobe.material = mat;
      lobe.isPickable = false;
    }

    // A hanging vine trailing from a fraction of the tall emergents.
    if (emergent && rand() < 0.35) {
      const vineLen = trunkH * (0.5 + rand() * 0.4);
      const vine = MeshBuilder.CreateCylinder(`tree_${index}_vine`, { diameter: 0.04, height: vineLen, tessellation: 4 }, scene);
      vine.position.set(x + (rand() - 0.5) * crownR * 0.6, trunkH + crownR * 0.3 - vineLen / 2, z + (rand() - 0.5) * crownR * 0.6);
      vine.material = vineMat;
      vine.isPickable = false;
    }
  }

  const forbidden = (x: number, z: number): boolean =>
    Vector3.Distance(new Vector3(x, 0, z), lakeCenter) < 10 ||
    Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS ||
    x > GARDEN_BOUNDS.maxX - 5;

  // Tier 1: tall emergent trees — sparser, bigger crowns, poke above the canopy line.
  let placed = 0;
  for (let i = 0; i < 70; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (forbidden(x, z)) continue;
    placeTree(x, z, placed++, 5.5 + rand() * 2.5, 2.6 + rand() * 1.3, true);
  }
  // Tier 2: dense understory — shorter, tighter-packed, fills the gaps between emergents.
  for (let i = 0; i < 130; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (forbidden(x, z)) continue;
    placeTree(x, z, placed++, 2.6 + rand() * 1.6, 1.5 + rand() * 0.9, false);
  }
}

/** Dense jungle undergrowth: packed bushes, low fern clusters, and a few tropical-flower accents. */
function buildUndergrowth(scene: Scene, centerX: number, centerZ: number, width: number, depth: number): void {
  const rand = mulberry32(212);
  const bushMats = [
    new Color3(0.16, 0.3, 0.14),
    new Color3(0.2, 0.34, 0.17),
    new Color3(0.13, 0.26, 0.16),
  ].map((c, i) => {
    const mat = new WorldMaterial(`bushMat_${i}`, scene);
    mat.diffuseColor = c;
    mat.specularColor = Color3.Black();
    return mat;
  });
  const fernMat = new WorldMaterial("fernMat", scene);
  fernMat.diffuseColor = new Color3(0.22, 0.4, 0.18);
  fernMat.specularColor = Color3.Black();
  fernMat.backFaceCulling = false;

  const flowerColors = [new Color3(0.85, 0.2, 0.25), new Color3(0.95, 0.8, 0.15), new Color3(0.8, 0.4, 0.75)];
  const flowerMats = flowerColors.map((c, i) => {
    const mat = new WorldMaterial(`flowerMat_${i}`, scene);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.25);
    mat.specularColor = Color3.Black();
    return mat;
  });

  const lakeCenter = new Vector3(centerX + 8, 0, centerZ - 6);
  const forbidden = (x: number, z: number, campMargin: number): boolean =>
    Vector3.Distance(new Vector3(x, 0, z), lakeCenter) < 9 ||
    Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS - campMargin ||
    x > GARDEN_BOUNDS.maxX - 5;

  // Dense bushes — roughly triple the old count, the jungle floor should read as choked with growth.
  for (let i = 0; i < 100; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (forbidden(x, z, 3)) continue;

    const bush = MeshBuilder.CreateSphere(`bush_${i}`, { diameter: 1.0 + rand() * 0.9, segments: 6 }, scene);
    bush.scaling.y = 0.55 + rand() * 0.25;
    bush.position.set(x, bush.scaling.y * (0.5 + rand() * 0.15), z);
    bush.material = bushMats[i % bushMats.length];
    bush.checkCollisions = true;
  }

  // Fern clusters: 3-4 flat crossed fronds per clump, low to the ground.
  for (let cluster = 0; cluster < 90; cluster++) {
    const cx = centerX - width / 2 + rand() * width;
    const cz = centerZ - depth / 2 + rand() * depth;
    if (forbidden(cx, cz, 4)) continue;
    const fronds = 3 + Math.floor(rand() * 2);
    for (let f = 0; f < fronds; f++) {
      const frond = MeshBuilder.CreatePlane(`fern_${cluster}_${f}`, { width: 0.15, height: 0.6 + rand() * 0.4 }, scene);
      frond.position.set(cx + (rand() - 0.5) * 0.5, 0.3, cz + (rand() - 0.5) * 0.5);
      frond.rotation.y = (f / fronds) * Math.PI * 2;
      frond.rotation.x = -0.35 - rand() * 0.2;
      frond.material = fernMat;
      frond.isPickable = false;
    }
  }

  // A scattering of tropical flowers for colour accent — sparse, jungle undergrowth isn't a meadow.
  for (let cluster = 0; cluster < 10; cluster++) {
    const cx = centerX - width / 2 + rand() * width;
    const cz = centerZ - depth / 2 + rand() * depth;
    if (forbidden(cx, cz, 4)) continue;
    const mat = flowerMats[cluster % flowerMats.length];
    for (let f = 0; f < 5; f++) {
      const fx = cx + (rand() - 0.5) * 1.8;
      const fz = cz + (rand() - 0.5) * 1.8;
      const flower = MeshBuilder.CreateSphere(`flower_${cluster}_${f}`, { diameter: 0.14, segments: 4 }, scene);
      flower.position.set(fx, 0.14, fz);
      flower.material = mat;
      flower.isPickable = false;
    }
  }
}

/** Fallen tree trunks scattered on the jungle floor — decay/clutter authenticity, doubling as waist-high cover. */
function buildFallenLogs(scene: Scene, centerX: number, centerZ: number, width: number, depth: number): void {
  const rand = mulberry32(717);
  const logMat = new WorldMaterial("fallenLogMat", scene);
  logMat.diffuseColor = new Color3(0.24, 0.18, 0.11);
  logMat.specularColor = Color3.Black();

  const lakeCenter = new Vector3(centerX + 8, 0, centerZ - 6);
  let placed = 0;
  for (let i = 0; i < 60 && placed < 14; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (Vector3.Distance(new Vector3(x, 0, z), lakeCenter) < 9) continue;
    if (Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS + 2) continue;
    if (x > GARDEN_BOUNDS.maxX - 6) continue;

    const len = 3 + rand() * 2.5;
    const log = MeshBuilder.CreateCylinder(`fallenLog_${i}`, { diameter: 0.5 + rand() * 0.25, height: len, tessellation: 8 }, scene);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rand() * Math.PI;
    log.position.set(x, 0.28, z);
    log.material = logMat;
    log.checkCollisions = true;
    placed++;
  }
}

/**
 * The player's SAF deployment point — a concealed tented camp tucked in the
 * forest's clearing (see CAMP_POSITION/CAMP_CLEARING_RADIUS). Two tents, a
 * flagpole, and supply crates; player always spawns/redeploys here. A small
 * checkpoint with SAF vehicles sits just outside the clearing (see
 * buildParkedCars) representing the logistics tail for the defence line.
 */
function buildCamp(scene: Scene): void {
  const dirtMat = new WorldMaterial("campDirtMat", scene);
  dirtMat.diffuseColor = new Color3(0.32, 0.28, 0.2);
  dirtMat.specularColor = Color3.Black();
  const clearing = MeshBuilder.CreateGround("campClearing", { width: 24, height: 24 }, scene);
  clearing.position.set(CAMP_POSITION.x, 0.03, CAMP_POSITION.z);
  clearing.material = dirtMat;
  clearing.isPickable = false;

  // One large command tent, centred just behind the spawn so the player
  // deploys standing inside it (open front faces the east gate). Sized big
  // enough that the camera stays well clear of every wall/roof panel.
  const tentCx = CAMP_POSITION.x - 1.5;
  const tentCz = CAMP_POSITION.z;
  buildCommandTent(scene, tentCx, tentCz);
  buildOpsArea(scene, tentCx, tentCz);

  buildCampFence(scene);

  const poleMat = new WorldMaterial("campFlagpoleMat", scene);
  poleMat.diffuseColor = new Color3(0.15, 0.15, 0.16);
  const pole = MeshBuilder.CreateCylinder("campFlagpole", { diameter: 0.14, height: 5 }, scene);
  pole.position.set(CAMP_POSITION.x + 7, 2.5, CAMP_POSITION.z - 6);
  pole.material = poleMat;
  pole.checkCollisions = true;

  const flagMat = new WorldMaterial("campFlagMat", scene);
  flagMat.diffuseColor = new Color3(0.85, 0.1, 0.1);
  flagMat.backFaceCulling = false;
  const flag = MeshBuilder.CreatePlane("campFlag", { width: 1.1, height: 0.7 }, scene);
  flag.position.set(CAMP_POSITION.x + 7.55, 4.5, CAMP_POSITION.z - 6);
  flag.rotation.y = Math.PI / 2;
  flag.material = flagMat;
  flag.isPickable = false;

  // Supply crates + a parked SAF Land Rover to the side of the tent.
  const crateMat = new WorldMaterial("campCrateMat", scene);
  crateMat.diffuseColor = new Color3(0.38, 0.33, 0.22);
  crateMat.specularColor = Color3.Black();
  const cratePositions: Array<[number, number]> = [
    [CAMP_POSITION.x + 6, CAMP_POSITION.z + 6],
    [CAMP_POSITION.x + 6.9, CAMP_POSITION.z + 6.8],
  ];
  cratePositions.forEach(([x, z], i) => {
    const crate = MeshBuilder.CreateBox(`campCrate_${i}`, { width: 1.2, height: 1, depth: 1.2 }, scene);
    crate.position.set(x, 0.5, z);
    crate.material = crateMat;
    crate.checkCollisions = true;
  });

  const opsWheel = solidMat(scene, "opsVehWheel", new Color3(0.05, 0.05, 0.05));
  const opsSaf = solidMat(scene, "opsVehSaf", new Color3(0.28, 0.32, 0.2));
  buildVehicle(scene, "safLandRover", CAMP_POSITION.x + 6.5, CAMP_POSITION.z + 2, -Math.PI / 2, opsSaf, opsSaf, opsSaf, opsWheel, 950);

  // A couple of sandbag stacks just outside the gate for cover as you leave.
  buildSandbagWall(scene, CAMP_POSITION.x + 12, CAMP_POSITION.z - 3, 0.2, solidMat(scene, "campGateSandbagA", new Color3(0.55, 0.48, 0.32)), 700);
  buildSandbagWall(scene, CAMP_POSITION.x + 12, CAMP_POSITION.z + 3, 0.2, solidMat(scene, "campGateSandbagB", new Color3(0.55, 0.48, 0.32)), 701);
}

/**
 * One large command marquee that the player spawns inside. Back + side walls,
 * a peaked canvas roof, open front (toward the gate), a ground sheet, and
 * front support poles. Deliberately roomy so the camera never gets close
 * enough to a wall/roof panel to clip through it.
 */
function buildCommandTent(scene: Scene, cx: number, cz: number): void {
  const { canvas, floor } = getTentMats(scene);
  const L = 11;
  const W = 7;
  const wallH = 2.8;
  const ridgeH = 3.8;

  const root = new TransformNode("cmdTent_root", scene);
  root.position.set(cx, 0, cz);

  const fl = MeshBuilder.CreateBox("cmdTent_floor", { width: L, height: 0.06, depth: W }, scene);
  fl.position.set(0, 0.03, 0);
  fl.material = floor;
  fl.parent = root;
  fl.isPickable = false;

  const back = MeshBuilder.CreateBox("cmdTent_back", { width: 0.1, height: wallH, depth: W }, scene);
  back.position.set(-L / 2, wallH / 2, 0);
  back.material = canvas;
  back.parent = root;
  back.checkCollisions = true;

  for (const side of [-1, 1]) {
    const wall = MeshBuilder.CreateBox(`cmdTent_side_${side}`, { width: L, height: wallH, depth: 0.1 }, scene);
    wall.position.set(0, wallH / 2, (side * W) / 2);
    wall.material = canvas;
    wall.parent = root;
    wall.checkCollisions = true;
    const frontPole = MeshBuilder.CreateCylinder(`cmdTent_frontpole_${side}`, { diameter: 0.12, height: wallH }, scene);
    frontPole.position.set(L / 2 - 0.1, wallH / 2, (side * (W - 0.4)) / 2);
    frontPole.material = floor;
    frontPole.parent = root;
    frontPole.checkCollisions = true;
  }

  // Peaked roof: two sloped panels from the eaves (wallH) up to a ridge.
  const hw = W / 2;
  const rise = ridgeH - wallH;
  const slope = Math.hypot(hw, rise);
  const theta = Math.atan2(rise, hw);
  const roofY = (wallH + ridgeH) / 2;
  const left = MeshBuilder.CreateBox("cmdTent_roofL", { width: L, height: 0.06, depth: slope }, scene);
  left.position.set(0, roofY, -hw / 2);
  left.rotation.x = -theta;
  left.material = canvas;
  left.parent = root;
  left.checkCollisions = true;
  const right = MeshBuilder.CreateBox("cmdTent_roofR", { width: L, height: 0.06, depth: slope }, scene);
  right.position.set(0, roofY, hw / 2);
  right.rotation.x = theta;
  right.material = canvas;
  right.parent = root;
  right.checkCollisions = true;
  const ridge = MeshBuilder.CreateCylinder("cmdTent_ridge", { diameter: 0.08, height: L }, scene);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, ridgeH, 0);
  ridge.material = floor;
  ridge.parent = root;
  ridge.isPickable = false;
}

/** Operations planning area inside the command tent: map tables, a briefing board, a comms set, and equipment crates. */
function buildOpsArea(scene: Scene, cx: number, cz: number): void {
  const metalMat = solidMat(scene, "opsMetalMat", new Color3(0.28, 0.3, 0.3));
  const woodMat = solidMat(scene, "opsWoodMat", new Color3(0.35, 0.28, 0.18));
  const crateMat = solidMat(scene, "opsCrateMat", new Color3(0.4, 0.35, 0.24));
  const mapMat = new WorldMaterial("opsMapMat", scene);
  mapMat.diffuseTexture = createOpsMapTexture(scene);
  mapMat.specularColor = Color3.Black();
  mapMat.backFaceCulling = false;

  // Planning table with a map laid on top (toward the back of the tent).
  const table = MeshBuilder.CreateBox("opsTable", { width: 2.6, height: 0.9, depth: 1.4 }, scene);
  table.position.set(cx - 3.2, 0.45, cz);
  table.material = metalMat;
  table.checkCollisions = true;
  const mapTop = MeshBuilder.CreateBox("opsMapTop", { width: 2.3, height: 0.05, depth: 1.15 }, scene);
  mapTop.position.set(cx - 3.2, 0.93, cz);
  mapTop.material = mapMat;
  mapTop.isPickable = false;

  // Briefing board stood against the back wall.
  const board = MeshBuilder.CreateBox("opsBoard", { width: 0.08, height: 1.4, depth: 2.2 }, scene);
  board.position.set(cx - 4.9, 1.4, cz);
  board.material = mapMat;
  board.checkCollisions = true;

  // Folding chairs beside the table.
  for (const dz of [-0.95, 0.95]) {
    const chair = MeshBuilder.CreateBox(`opsChair_${dz}`, { width: 0.45, height: 0.5, depth: 0.45 }, scene);
    chair.position.set(cx - 3.2, 0.25, cz + dz);
    chair.material = woodMat;
    chair.checkCollisions = true;
  }

  // Comms set: a boxy radio on a crate + a whip antenna.
  const radioCrate = MeshBuilder.CreateBox("opsRadioCrate", { width: 0.8, height: 0.7, depth: 0.8 }, scene);
  radioCrate.position.set(cx - 3.4, 0.35, cz - 2.2);
  radioCrate.material = crateMat;
  radioCrate.checkCollisions = true;
  const radio = MeshBuilder.CreateBox("opsRadio", { width: 0.6, height: 0.3, depth: 0.5 }, scene);
  radio.position.set(cx - 3.4, 0.85, cz - 2.2);
  radio.material = metalMat;
  radio.isPickable = false;
  const antenna = MeshBuilder.CreateCylinder("opsAntenna", { diameter: 0.03, height: 2.4 }, scene);
  antenna.position.set(cx - 3.4, 2.0, cz - 2.2);
  antenna.material = metalMat;
  antenna.isPickable = false;

  // Stacked equipment crates.
  const crateSpots: Array<[number, number, number]> = [
    [cx - 4.4, 0.4, cz + 2.2],
    [cx - 3.5, 0.4, cz + 2.4],
    [cx - 4.4, 1.2, cz + 2.2],
  ];
  crateSpots.forEach(([x, y, z], i) => {
    const c = MeshBuilder.CreateBox(`opsEquipCrate_${i}`, { width: 0.8, height: 0.8, depth: 0.8 }, scene);
    c.position.set(x, y, z);
    c.material = crateMat;
    c.checkCollisions = true;
  });
}

/** A simple top-down "map" texture (grid + coastline + a marked route) for the ops boards. */
function createOpsMapTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture("opsMapTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#d8d2b8"; // paper
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#9fb98a"; // land mass
  ctx.beginPath();
  ctx.moveTo(30, 210); ctx.lineTo(90, 120); ctx.lineTo(170, 90); ctx.lineTo(230, 150); ctx.lineTo(220, 230); ctx.lineTo(60, 235);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(70,90,120,0.4)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= size; g += 24) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke();
  }
  ctx.strokeStyle = "#c0392b"; // marked route
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(70, 180); ctx.lineTo(120, 140); ctx.lineTo(180, 150); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#1f5c33";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("SECTOR 7", 20, 30);
  tex.update();
  return tex;
}

/**
 * A tall chain-link perimeter fence around the camp — too high to jump over
 * (2.6 m vs the player's ~0.9 m jump) and collidable, so the spawn compound
 * is properly enclosed for safety, with a single gate gap on the city-facing
 * (east) side to leave through.
 */
function buildCampFence(scene: Scene): void {
  const postMat = solidMat(scene, "campFencePostMat", new Color3(0.24, 0.25, 0.23));
  const meshMat = new WorldMaterial("campFenceMeshMat", scene);
  meshMat.diffuseColor = new Color3(0.5, 0.52, 0.5);
  meshMat.specularColor = Color3.Black();
  meshMat.alpha = 0.4; // see-through chain-link
  meshMat.backFaceCulling = false;

  const cx = CAMP_POSITION.x;
  const cz = CAMP_POSITION.z;
  const half = 11;
  const H = 2.6;
  const gateHalf = 2.2;

  let seg = 0;
  const segment = (x1: number, z1: number, x2: number, z2: number): void => {
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const panel = MeshBuilder.CreateBox(`campFence_${seg}`, { width: 0.04, height: H, depth: len }, scene);
    panel.position.set(mx, H / 2, mz);
    panel.rotation.y = Math.atan2(dx, dz);
    panel.material = meshMat;
    panel.checkCollisions = true;
    for (const [px, pz] of [[x1, z1], [x2, z2]] as const) {
      const post = MeshBuilder.CreateBox(`campFencePost_${seg}_${px}_${pz}`, { width: 0.12, height: H + 0.2, depth: 0.12 }, scene);
      post.position.set(px, (H + 0.2) / 2, pz);
      post.material = postMat;
      post.checkCollisions = true;
    }
    seg++;
  };

  // North, south, west edges are solid; the east edge (facing the city) has a
  // centred gate gap the player walks out through.
  segment(cx - half, cz + half, cx + half, cz + half);
  segment(cx - half, cz - half, cx + half, cz - half);
  segment(cx - half, cz - half, cx - half, cz + half);
  segment(cx + half, cz - half, cx + half, cz - gateHalf);
  segment(cx + half, cz + gateHalf, cx + half, cz + half);
}

const tentCanvasMat = new WeakMap<Scene, WorldMaterial>();
function getTentMats(scene: Scene): { canvas: WorldMaterial; floor: WorldMaterial } {
  let canvas = tentCanvasMat.get(scene);
  if (!canvas) {
    canvas = new WorldMaterial("tentCanvasMat", scene);
    canvas.diffuseColor = new Color3(0.28, 0.32, 0.22); // olive canvas
    canvas.specularColor = Color3.Black();
    canvas.backFaceCulling = false; // visible from inside too
    tentCanvasMat.set(scene, canvas);
  }
  const floor = new WorldMaterial("tentFloorMat", scene);
  floor.diffuseColor = new Color3(0.2, 0.18, 0.14);
  floor.specularColor = Color3.Black();
  return { canvas, floor };
}

/**
 * A-frame ridge tent that actually sits on the ground (base at y = 0) — two
 * sloped canvas panels meeting at a ridge, a triangular back wall, and a
 * groundsheet floor, all parented to a node so the whole thing yaws cleanly.
 * The old version was a bare triangular-prism cylinder floating at y = 1.1.
 * `open` leaves the front unwalled so the player can walk in (spawn tent).
 */
function buildRidgeTent(
  scene: Scene,
  x: number,
  z: number,
  rotY: number,
  length: number,
  width: number,
  height: number,
  name: string
): void {
  const { canvas, floor: floorMat } = getTentMats(scene);
  const hw = width / 2;
  const theta = Math.atan2(height, hw); // slope angle from horizontal
  const slope = Math.hypot(hw, height);

  const root = new TransformNode(`${name}_root`, scene);
  root.position.set(x, 0, z);
  root.rotation.y = rotY;

  // Groundsheet.
  const floor = MeshBuilder.CreateBox(`${name}_floor`, { width: length, height: 0.06, depth: width }, scene);
  floor.position.set(0, 0.03, 0);
  floor.material = floorMat;
  floor.parent = root;
  floor.isPickable = false;

  // Two sloped roof panels meeting at the ridge.
  const left = MeshBuilder.CreateBox(`${name}_roofL`, { width: length, height: 0.06, depth: slope }, scene);
  left.position.set(0, height / 2, -hw / 2);
  left.rotation.x = -theta;
  left.material = canvas;
  left.parent = root;
  left.checkCollisions = true;

  const right = MeshBuilder.CreateBox(`${name}_roofR`, { width: length, height: 0.06, depth: slope }, scene);
  right.position.set(0, height / 2, hw / 2);
  right.rotation.x = theta;
  right.material = canvas;
  right.parent = root;
  right.checkCollisions = true;

  // Triangular-ish back wall (a thin box, clipped visually by the roof line).
  const back = MeshBuilder.CreateBox(`${name}_back`, { width: 0.06, height, depth: width }, scene);
  back.position.set(-length / 2 + 0.03, height / 2, 0);
  back.material = canvas;
  back.parent = root;
  back.checkCollisions = true;

  // Ridge pole.
  const ridge = MeshBuilder.CreateCylinder(`${name}_ridge`, { diameter: 0.06, height: length }, scene);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, height, 0);
  ridge.material = floorMat;
  ridge.parent = root;
  ridge.isPickable = false;
}

function buildBenches(scene: Scene, centerX: number, centerZ: number): void {
  const benchMat = new WorldMaterial("benchMat", scene);
  benchMat.diffuseColor = new Color3(0.35, 0.28, 0.18);
  benchMat.specularColor = Color3.Black();

  const benchSpots: Array<[number, number, number]> = [
    [centerX - 14, centerZ + 10, 0],
    [centerX - 20, centerZ - 2, Math.PI / 4],
    [centerX + 4, centerZ + 16, Math.PI / 2],
  ];
  benchSpots.forEach(([x, z, rotY], i) => {
    const bench = MeshBuilder.CreateBox(`bench_${i}`, { width: 1.6, height: 0.45, depth: 0.5 }, scene);
    bench.position.set(x, 0.25, z);
    bench.rotation.y = rotY;
    bench.material = benchMat;
    bench.checkCollisions = true;
  });
}

/** A low-poly Marina-Bay-Sands-inspired landmark: three towers + a "SkyPark" deck. Evocative, not literal. */
function buildMbsLandmark(scene: Scene): void {
  const towerMat = new WorldMaterial("mbsTowerMat", scene);
  towerMat.diffuseColor = new Color3(0.35, 0.4, 0.46);
  towerMat.specularColor = new Color3(0.4, 0.45, 0.5);

  const deckMat = new WorldMaterial("mbsDeckMat", scene);
  deckMat.diffuseColor = new Color3(0.2, 0.55, 0.3);
  deckMat.specularColor = new Color3(0.3, 0.3, 0.3);

  const towerHeight = 46;
  const towerXs = [22, 34, 46];
  towerXs.forEach((tx, i) => {
    const tower = MeshBuilder.CreateBox(`mbsTower_${i}`, { width: 10, height: towerHeight, depth: 8 }, scene);
    tower.position.set(tx, towerHeight / 2, 88);
    tower.material = towerMat;
    tower.checkCollisions = true;
  });

  const deck = MeshBuilder.CreateBox("mbsDeck", { width: 42, height: 2.2, depth: 12 }, scene);
  deck.position.set(34, towerHeight + 1.1, 88);
  deck.material = deckMat;
  deck.checkCollisions = true;

  const railMat = new WorldMaterial("mbsRailMat", scene);
  railMat.diffuseColor = new Color3(0.7, 0.75, 0.7);
  const rail = MeshBuilder.CreateBox("mbsDeckRail", { width: 42, height: 0.4, depth: 12.4 }, scene);
  rail.position.set(34, towerHeight + 2.4, 88);
  rail.material = railMat;
  rail.isPickable = false;
}

/** A short elevated MRT viaduct along the CBD's northern edge — concrete piers + a guideway box. Purely a skyline/flavour landmark, not rideable. */
function buildMrtViaduct(scene: Scene): void {
  const pierMat = solidMat(scene, "viaductPierMat", new Color3(0.55, 0.55, 0.53));
  const guidewayMat = solidMat(scene, "viaductGuidewayMat", new Color3(0.62, 0.63, 0.6));

  const z = 92;
  const xs = [4, 18, 32, 46, 60, 74];
  xs.forEach((x, i) => {
    const pier = MeshBuilder.CreateCylinder(`viaductPier_${i}`, { diameter: 1.1, height: 9 }, scene);
    pier.position.set(x, 4.5, z);
    pier.material = pierMat;
    pier.checkCollisions = true;
  });

  const guideway = MeshBuilder.CreateBox("viaductGuideway", { width: xs[xs.length - 1] - xs[0] + 8, height: 1.4, depth: 3.4 }, scene);
  guideway.position.set((xs[0] + xs[xs.length - 1]) / 2, 9.7, z);
  guideway.material = guidewayMat;
  guideway.checkCollisions = true;
}

const ARC_LIGHTING: Array<[number, Color3, number]> = [
  // [wave threshold, clear colour, light intensity] — desperate defence -> retake
  [1, new Color3(0.5, 0.58, 0.68), 0.65],
  [5, new Color3(0.42, 0.46, 0.55), 0.55],
  [10, new Color3(0.3, 0.28, 0.32), 0.45],
  [15, new Color3(0.55, 0.35, 0.28), 0.7],
];

/** Nudges ambient colour/intensity per the story's wave arc (defence -> holding -> counter-attack -> retake). */
export function applyWaveArcLighting(scene: Scene, wave: number): void {
  let band = ARC_LIGHTING[0];
  for (const entry of ARC_LIGHTING) {
    if (wave >= entry[0]) band = entry;
  }
  const [, color, intensity] = band;
  scene.clearColor = new Color4(color.r, color.g, color.b, 1);
  scene.fogColor = color;
  const hemi = scene.getLightByName("hemiLight");
  // Scaled up so shadow-side surfaces stay readable under the ACES tone curve.
  if (hemi) hemi.intensity = intensity * 1.25;
}
