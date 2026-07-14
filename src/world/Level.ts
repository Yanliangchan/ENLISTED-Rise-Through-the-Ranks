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

const SHOPHOUSE_COLORS = [
  new Color3(0.55, 0.5, 0.42),
  new Color3(0.58, 0.46, 0.36),
  new Color3(0.6, 0.42, 0.32),
  new Color3(0.5, 0.4, 0.3),
];
const HDB_COLORS = [new Color3(0.72, 0.72, 0.7), new Color3(0.66, 0.68, 0.7), new Color3(0.75, 0.74, 0.68)];
const HDB_ACCENT = new Color3(0.35, 0.5, 0.62);

/** Grid line positions for the street layout — the 0 line is left out to keep a clear central plaza. */
const GRID_LINES = [-91, -65, -39, -13, 13, 39, 65, 91];

/** South-west quadrant reserved for the park district — kept clear of street-grid buildings. */
const GARDEN_BOUNDS = { minX: -100, maxX: -22, minZ: -100, maxZ: -22 };

export type BuildingType = "shophouse" | "hdb";

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

/**
 * Deterministic building layout — the single source of truth for both the
 * collidable meshes (buildStreetGrid) and the HUD radar, so the minimap
 * always matches the real map instead of drifting out of sync. Pure/no
 * scene side effects — safe to call from UI code. The south-west quadrant
 * is left clear for the park district (trees/lake/garden).
 */
export function generateBuildingLayout(): BuildingFootprint[] {
  const rand = mulberry32(1337);
  const layout: BuildingFootprint[] = [];
  for (const gx of GRID_LINES) {
    for (const gz of GRID_LINES) {
      const isHdb = rand() < 0.3;
      const skipChance = isHdb ? 0.15 : 0.22;
      if (rand() < skipChance) continue; // gap: open flanking route / sightline break
      if (inGardenDistrict(gx, gz, 10)) continue; // reserved for the park

      const jitterX = (rand() - 0.5) * 5;
      const jitterZ = (rand() - 0.5) * 5;
      const x = gx + jitterX;
      const z = gz + jitterZ;
      if (isHdb) {
        // Slab residential tower: narrower footprint, much taller.
        layout.push({ x, z, size: 10 + rand() * 4, height: 24 + rand() * 16, type: "hdb" });
      } else {
        // Low/mid-rise shophouse block.
        layout.push({ x, z, size: 12 + rand() * 8, height: 8 + rand() * 10, type: "shophouse" });
      }
    }
  }
  return layout;
}

/**
 * Medium-size urban-estate map modelled loosely on a Singapore town centre:
 * a street grid mixing shophouse blocks and taller HDB-style towers around
 * a clear central plaza (player spawn), a park district with a lake and
 * trees, parked cars for street-level cover, and a Marina-Bay-Sands-style
 * three-tower "SkyPark" landmark anchoring the skyline. Evocative dressing,
 * not a real streetscape. Spawn points (EnemySpawner) ring the outside so
 * OPFOR has to move through the blocks and cover to reach the plaza.
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
  buildParkedCars(scene);
  buildGardenDistrict(scene);
  buildMbsLandmark(scene);

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
 * Street grid built from `generateBuildingLayout` — shophouse blocks get a
 * roof trim band, HDB towers get horizontal balcony banding + window-accent
 * colour so the skyline actually reads as two different building types.
 */
function buildStreetGrid(scene: Scene): void {
  const shophouseMats = SHOPHOUSE_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`shophouseMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  });
  const hdbMats = HDB_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`hdbMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  });
  const hdbAccentMat = new StandardMaterial("hdbAccentMat", scene);
  hdbAccentMat.diffuseColor = HDB_ACCENT;
  hdbAccentMat.specularColor = Color3.Black();

  const layout = generateBuildingLayout();
  layout.forEach(({ x, z, size, height, type }, i) => {
    const building = MeshBuilder.CreateBox(`building_${i}`, { width: size, height, depth: size }, scene);
    building.position.set(x, height / 2, z);
    building.checkCollisions = true;

    if (type === "hdb") {
      building.material = hdbMats[i % hdbMats.length];
      // Balcony banding: a handful of thin accent-coloured slabs up the face.
      const bands = 3 + Math.floor(height / 12);
      for (let b = 1; b <= bands; b++) {
        const band = MeshBuilder.CreateBox(`hdbBand_${i}_${b}`, { width: size + 0.3, height: 0.4, depth: size + 0.3 }, scene);
        band.position.set(x, (height / (bands + 1)) * b, z);
        band.material = hdbAccentMat;
        band.isPickable = false;
      }
      const roof = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size + 0.2, height: 0.4, depth: size + 0.2 }, scene);
      roof.position.set(x, height + 0.2, z);
      roof.material = hdbMats[(i + 1) % hdbMats.length];
      roof.isPickable = false;
    } else {
      building.material = shophouseMats[i % shophouseMats.length];
      const trim = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size + 0.4, height: 0.6, depth: size + 0.4 }, scene);
      trim.position.set(x, height + 0.3, z);
      trim.material = shophouseMats[(i + 1) % shophouseMats.length];
      trim.isPickable = false;
    }
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

const CAR_COLORS = [new Color3(0.75, 0.1, 0.1), new Color3(0.1, 0.15, 0.5), new Color3(0.85, 0.85, 0.85), new Color3(0.15, 0.15, 0.15)];

/** Parked cars along the street grid edges — street-level cover + set dressing. */
function buildParkedCars(scene: Scene): void {
  const rand = mulberry32(4242);
  const wheelMat = new StandardMaterial("wheelMat", scene);
  wheelMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
  wheelMat.specularColor = Color3.Black();

  const carMats = CAR_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`carMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    return mat;
  });

  let carIndex = 0;
  for (const line of GRID_LINES) {
    for (const offset of [-6, 6]) {
      if (rand() < 0.4) continue;
      const alongOtherAxis = GRID_LINES[Math.floor(rand() * GRID_LINES.length)] + (rand() - 0.5) * 10;
      const onXStreet = rand() < 0.5;
      const x = onXStreet ? alongOtherAxis : line + offset;
      const z = onXStreet ? line + offset : alongOtherAxis;
      if (inGardenDistrict(x, z, 6)) continue;
      if (Math.abs(x) < 20 && Math.abs(z) < 20) continue; // keep the plaza clear

      buildCar(scene, x, z, rand() * Math.PI * 2, carMats[carIndex % carMats.length], wheelMat, carIndex);
      carIndex++;
    }
  }
}

function buildCar(
  scene: Scene,
  x: number,
  z: number,
  rotationY: number,
  bodyMat: StandardMaterial,
  wheelMat: StandardMaterial,
  index: number
): void {
  const root = MeshBuilder.CreateBox(`car_${index}_body`, { width: 1.8, height: 0.6, depth: 4 }, scene);
  root.position.set(x, 0.5, z);
  root.rotation.y = rotationY;
  root.material = bodyMat;
  root.checkCollisions = true;

  const cabin = MeshBuilder.CreateBox(`car_${index}_cabin`, { width: 1.6, height: 0.5, depth: 2 }, scene);
  cabin.position.set(0, 0.55, -0.2);
  cabin.material = bodyMat;
  cabin.parent = root;
  cabin.isPickable = false;

  const wheelPositions: Array<[number, number]> = [
    [-0.95, 1.3],
    [0.95, 1.3],
    [-0.95, -1.3],
    [0.95, -1.3],
  ];
  wheelPositions.forEach(([wx, wz], i) => {
    const wheel = MeshBuilder.CreateCylinder(`car_${index}_wheel_${i}`, { diameter: 0.55, height: 0.3 }, scene);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, -0.25, wz);
    wheel.material = wheelMat;
    wheel.parent = root;
    wheel.isPickable = false;
  });
}

/** Park district: grass patch, a lake (visual, ringed with a low collidable kerb), trees, and benches. */
function buildGardenDistrict(scene: Scene): void {
  const grassMat = new StandardMaterial("grassMat", scene);
  grassMat.diffuseColor = new Color3(0.24, 0.38, 0.2);
  grassMat.specularColor = Color3.Black();

  const centerX = (GARDEN_BOUNDS.minX + GARDEN_BOUNDS.maxX) / 2;
  const centerZ = (GARDEN_BOUNDS.minZ + GARDEN_BOUNDS.maxZ) / 2;
  const width = GARDEN_BOUNDS.maxX - GARDEN_BOUNDS.minX;
  const depth = GARDEN_BOUNDS.maxZ - GARDEN_BOUNDS.minZ;

  const grass = MeshBuilder.CreateGround("gardenGrass", { width, height: depth }, scene);
  grass.position.set(centerX, 0.02, centerZ);
  grass.material = grassMat;
  grass.isPickable = false;

  buildLake(scene, centerX + 8, centerZ - 6, 16);
  buildTrees(scene, centerX, centerZ, width, depth);
  buildBenches(scene, centerX, centerZ);
}

function buildLake(scene: Scene, x: number, z: number, diameter: number): void {
  const waterMat = new StandardMaterial("waterMat", scene);
  waterMat.diffuseColor = new Color3(0.15, 0.35, 0.5);
  waterMat.specularColor = new Color3(0.6, 0.7, 0.75);
  waterMat.specularPower = 32;
  waterMat.alpha = 0.9;

  const water = MeshBuilder.CreateDisc("lake", { radius: diameter / 2, tessellation: 24 }, scene);
  water.rotation.x = Math.PI / 2;
  water.position.set(x, 0.05, z);
  water.material = waterMat;
  water.isPickable = false;

  // Low invisible kerb ring so the player can't walk out onto the water.
  const kerbMat = new StandardMaterial("kerbMat", scene);
  kerbMat.diffuseColor = new Color3(0.5, 0.48, 0.42);
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const kerb = MeshBuilder.CreateBox(`lakeKerb_${i}`, { width: 2.6, height: 0.6, depth: 0.6 }, scene);
    kerb.position.set(x + Math.cos(angle) * (diameter / 2 + 0.3), 0.3, z + Math.sin(angle) * (diameter / 2 + 0.3));
    kerb.rotation.y = -angle;
    kerb.material = kerbMat;
    kerb.checkCollisions = true;
    kerb.isVisible = false;
  }
}

function buildTrees(scene: Scene, centerX: number, centerZ: number, width: number, depth: number): void {
  const rand = mulberry32(99);
  const trunkMat = new StandardMaterial("trunkMat", scene);
  trunkMat.diffuseColor = new Color3(0.32, 0.22, 0.14);
  trunkMat.specularColor = Color3.Black();
  const canopyMats = [
    new Color3(0.18, 0.4, 0.16),
    new Color3(0.22, 0.45, 0.18),
    new Color3(0.16, 0.36, 0.2),
  ].map((c, i) => {
    const mat = new StandardMaterial(`canopyMat_${i}`, scene);
    mat.diffuseColor = c;
    mat.specularColor = Color3.Black();
    return mat;
  });

  for (let i = 0; i < 26; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (Vector3.Distance(new Vector3(x, 0, z), new Vector3(centerX + 8, 0, centerZ - 6)) < 11) continue; // avoid the lake

    const trunk = MeshBuilder.CreateCylinder(`tree_${i}_trunk`, { diameter: 0.35, height: 2.2 }, scene);
    trunk.position.set(x, 1.1, z);
    trunk.material = trunkMat;
    trunk.checkCollisions = true;

    const canopy = MeshBuilder.CreateCylinder(`tree_${i}_canopy`, { diameterTop: 0, diameterBottom: 3.2 + rand() * 1.5, height: 3.5 + rand() * 1.5, tessellation: 8 }, scene);
    canopy.position.set(x, 2.2 + canopy.getBoundingInfo().boundingBox.extendSize.y, z);
    canopy.material = canopyMats[i % canopyMats.length];
    canopy.isPickable = false;
  }
}

function buildBenches(scene: Scene, centerX: number, centerZ: number): void {
  const benchMat = new StandardMaterial("benchMat", scene);
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
  const towerMat = new StandardMaterial("mbsTowerMat", scene);
  towerMat.diffuseColor = new Color3(0.35, 0.4, 0.46);
  towerMat.specularColor = new Color3(0.4, 0.45, 0.5);

  const deckMat = new StandardMaterial("mbsDeckMat", scene);
  deckMat.diffuseColor = new Color3(0.2, 0.55, 0.3);
  deckMat.specularColor = new Color3(0.3, 0.3, 0.3);

  const towerHeight = 46;
  const towerXs = [28, 45, 62];
  towerXs.forEach((tx, i) => {
    const tower = MeshBuilder.CreateBox(`mbsTower_${i}`, { width: 11, height: towerHeight, depth: 9 }, scene);
    tower.position.set(tx, towerHeight / 2, 102);
    tower.material = towerMat;
    tower.checkCollisions = true;
  });

  const deck = MeshBuilder.CreateBox("mbsDeck", { width: 50, height: 2.5, depth: 14 }, scene);
  deck.position.set(45, towerHeight + 1.25, 102);
  deck.material = deckMat;
  deck.checkCollisions = true;

  const railMat = new StandardMaterial("mbsRailMat", scene);
  railMat.diffuseColor = new Color3(0.7, 0.75, 0.7);
  const rail = MeshBuilder.CreateBox("mbsDeckRail", { width: 50, height: 0.4, depth: 14.4 }, scene);
  rail.position.set(45, towerHeight + 2.7, 102);
  rail.material = railMat;
  rail.isPickable = false;
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
