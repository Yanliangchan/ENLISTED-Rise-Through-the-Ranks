import {
  Scene,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
} from "@babylonjs/core";

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

const BUILDING_COLORS = [
  new Color3(0.55, 0.5, 0.42),
  new Color3(0.48, 0.44, 0.4),
  new Color3(0.58, 0.46, 0.36),
  new Color3(0.45, 0.47, 0.44),
];

/** Grid line positions for the street layout — the 0 line is left out to keep a clear central plaza. */
const GRID_LINES = [-91, -65, -39, -13, 13, 39, 65, 91];

export interface BuildingFootprint {
  x: number;
  z: number;
  size: number;
  height: number;
}

/**
 * Deterministic building layout — the single source of truth for both the
 * collidable meshes (buildStreetGrid) and the HUD radar, so the minimap
 * always matches the real map instead of drifting out of sync. Pure/no
 * scene side effects — safe to call from UI code.
 */
export function generateBuildingLayout(): BuildingFootprint[] {
  const rand = mulberry32(1337);
  const layout: BuildingFootprint[] = [];
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      if (rand() < 0.22) continue; // gap: open flanking route / sightline break
      const footprint = 12 + rand() * 8; // 12-20m
      const height = 8 + rand() * 12; // 8-20m
      const jitterX = (rand() - 0.5) * 5;
      const jitterZ = (rand() - 0.5) * 5;
      layout.push({ x: gx + jitterX, z: gz + jitterZ, size: footprint, height });
    }
  }
  return layout;
}

/**
 * Medium-size urban-estate map: a street grid of collidable "shophouse"
 * blocks around a clear central plaza (the player's spawn), plus scattered
 * low cover. Evocative Singapore dressing, not a real streetscape. Spawn
 * points (EnemySpawner) ring the outside so OPFOR has to move through the
 * blocks and cover to reach the plaza.
 */
export function buildLevel(scene: Scene): void {
  const hemi = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.65;

  const sun = new DirectionalLight("sunLight", new Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.28, 0.3, 0.27);
  groundMat.specularColor = Color3.Black();

  const ground = MeshBuilder.CreateGround("ground", { width: 260, height: 260 }, scene);
  ground.material = groundMat;
  ground.checkCollisions = true;

  buildStreetGrid(scene);
  buildCover(scene);

  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.5, 0.5, 0.52);
  wallMat.specularColor = Color3.Black();

  const perimeter: Array<[number, number, number, number]> = [
    // x, z, width, depth
    [0, -120, 240, 1],
    [0, 120, 240, 1],
    [-120, 0, 1, 240],
    [120, 0, 1, 240],
  ];
  perimeter.forEach(([x, z, width, depth], i) => {
    const wall = MeshBuilder.CreateBox(`boundary_${i}`, { width, height: 6, depth }, scene);
    wall.position.set(x, 3, z);
    wall.material = wallMat;
    wall.checkCollisions = true;
    wall.isVisible = false; // invisible playspace boundary
  });
}

/**
 * Singapore-flavoured shophouse blocks built from `generateBuildingLayout`
 * (~1-in-5 grid cells left empty for flanking routes/sightline breaks).
 */
function buildStreetGrid(scene: Scene): void {
  const mats = BUILDING_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`buildingMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  });

  const layout = generateBuildingLayout();
  layout.forEach(({ x, z, size, height }, i) => {
    const building = MeshBuilder.CreateBox(`building_${i}`, { width: size, height, depth: size }, scene);
    building.position.set(x, height / 2, z);
    building.material = mats[i % mats.length];
    building.checkCollisions = true;

    // Roof trim band for a bit of visual read at a distance.
    const trim = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size + 0.4, height: 0.6, depth: size + 0.4 }, scene);
    trim.position.set(x, height + 0.3, z);
    trim.material = mats[(i + 1) % mats.length];
    trim.isPickable = false;
  });
}

/** Waist-high crates for close cover in the plaza and at street junctions. */
function buildCover(scene: Scene): void {
  const crateMat = new StandardMaterial("crateMat", scene);
  crateMat.diffuseColor = new Color3(0.4, 0.35, 0.25);
  crateMat.specularColor = Color3.Black();

  const crateLayout: Array<[number, number, number]> = [
    // Central plaza — near player spawn, ring of low cover.
    [8, 1, 6],
    [-9, 1, 5],
    [6, 1, -9],
    [-7, 1, -8],
    [0, 1.3, 16],
    [14, 1, 2],
    [-14, 1, -3],
    [3, 1, -17],
    // Street junctions further out.
    [26, 1, 13],
    [-26, 1, -13],
    [13, 1, -26],
    [-13, 1, 26],
    [39, 1.4, 0],
    [-39, 1.4, 0],
    [0, 1.4, 39],
    [0, 1.4, -39],
  ];
  crateLayout.forEach(([x, halfHeight, z], i) => {
    const crate = MeshBuilder.CreateBox(
      `crate_${i}`,
      { width: 2, height: halfHeight * 2, depth: 2 },
      scene
    );
    crate.position.set(x, halfHeight, z);
    crate.material = crateMat;
    crate.checkCollisions = true;
  });
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
  const hemi = scene.getLightByName("hemiLight");
  if (hemi) hemi.intensity = intensity;
}
