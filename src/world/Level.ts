import {
  Scene,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
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

/** Grid line positions — buildings are centred on these (the street grid's "blocks"). */
const GRID_LINES = [-91, -65, -39, -13, 13, 39, 65, 91];
/** Midpoints between grid lines — always clear of building footprints, so roads/cars/props live here. */
const MID_LINES = [-78, -52, -26, 0, 26, 52, 78];
const ROAD_HALF_WIDTH = 4.5;
const MAP_SPAN = 240;

/** South-west quadrant reserved for the park district — kept clear of street-grid buildings. */
const GARDEN_BOUNDS = { minX: -100, maxX: -22, minZ: -100, maxZ: -22 };
/** Concealed forest clearing in the map's SW corner — the player's tented deployment point. */
export const CAMP_POSITION = new Vector3(-92, 2, -92);
const CAMP_CLEARING_RADIUS = 11;

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

function overlapsAnyBuilding(x: number, z: number, clearance: number, layout: BuildingFootprint[]): boolean {
  for (const b of layout) {
    const halfSpan = b.size / 2 + clearance;
    if (Math.abs(x - b.x) < halfSpan && Math.abs(z - b.z) < halfSpan) return true;
  }
  return false;
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

      const jitterX = (rand() - 0.5) * 3;
      const jitterZ = (rand() - 0.5) * 3;
      const x = gx + jitterX;
      const z = gz + jitterZ;
      if (isHdb) {
        // Slab residential tower: narrower footprint, much taller.
        layout.push({ x, z, size: 9 + rand() * 4, height: 24 + rand() * 16, type: "hdb" });
      } else {
        // Low/mid-rise shophouse block.
        layout.push({ x, z, size: 10 + rand() * 6, height: 8 + rand() * 10, type: "shophouse" });
      }
    }
  }
  return layout;
}

/**
 * Medium-size urban-estate map modelled loosely on a Singapore town centre:
 * a street grid mixing shophouse blocks and taller HDB-style towers around
 * a clear central plaza (player spawn), roads with lane markings and
 * streetlights running through the gaps between blocks, a park district
 * with a lake and trees, parked cars and trash bins for street-level detail,
 * and a Marina-Bay-Sands-style three-tower "SkyPark" landmark anchoring the
 * skyline. Evocative dressing, not a real streetscape. Spawn points
 * (EnemySpawner) ring the outside so OPFOR has to move through the blocks
 * and cover to reach the plaza.
 */
export function buildLevel(scene: Scene): void {
  const hemi = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.65;

  const sun = new DirectionalLight("sunLight", new Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;

  // Distance fog for depth/atmosphere — cheap (no extra draw calls) and hides the
  // ground/building pop-in at the far edge of the play space.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 70;
  scene.fogEnd = 220;
  scene.fogColor = new Color3(0.5, 0.58, 0.68);

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.3, 0.32, 0.28);
  groundMat.specularColor = Color3.Black();
  const pavementTex = createPavementTexture(scene);
  pavementTex.uScale = 60;
  pavementTex.vScale = 60;
  groundMat.diffuseTexture = pavementTex;

  const ground = MeshBuilder.CreateGround("ground", { width: 260, height: 260 }, scene);
  ground.material = groundMat;
  ground.checkCollisions = true;

  const layout = generateBuildingLayout();
  buildRoads(scene);
  buildStreetGrid(scene, layout);
  buildCover(scene);
  buildParkedCars(scene, layout);
  buildStreetFurniture(scene, layout);
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

/** Dark asphalt strips (with a centre lane line) running along the gaps between building blocks. */
function buildRoads(scene: Scene): void {
  const asphaltMat = new StandardMaterial("asphaltMat", scene);
  asphaltMat.diffuseColor = new Color3(0.16, 0.16, 0.17);
  asphaltMat.specularColor = Color3.Black();

  const lineMat = new StandardMaterial("roadLineMat", scene);
  lineMat.diffuseColor = new Color3(0.85, 0.75, 0.3);
  lineMat.specularColor = Color3.Black();
  lineMat.disableLighting = true;
  lineMat.emissiveColor = new Color3(0.35, 0.3, 0.1);

  MID_LINES.forEach((m, i) => {
    const roadNS = MeshBuilder.CreateGround(`roadNS_${i}`, { width: ROAD_HALF_WIDTH * 2, height: MAP_SPAN }, scene);
    roadNS.position.set(m, 0.015, 0);
    roadNS.material = asphaltMat;
    roadNS.isPickable = false;

    const roadEW = MeshBuilder.CreateGround(`roadEW_${i}`, { width: MAP_SPAN, height: ROAD_HALF_WIDTH * 2 }, scene);
    roadEW.position.set(0, 0.015, m);
    roadEW.material = asphaltMat;
    roadEW.isPickable = false;

    const dashCount = 20;
    for (let k = 0; k < dashCount; k++) {
      const dashNS = MeshBuilder.CreateGround(`roadLineNS_${i}_${k}`, { width: 0.25, height: 3 }, scene);
      dashNS.position.set(m, 0.02, -MAP_SPAN / 2 + (k + 0.5) * (MAP_SPAN / dashCount));
      dashNS.material = lineMat;
      dashNS.isPickable = false;

      const dashEW = MeshBuilder.CreateGround(`roadLineEW_${i}_${k}`, { width: 3, height: 0.25 }, scene);
      dashEW.position.set(-MAP_SPAN / 2 + (k + 0.5) * (MAP_SPAN / dashCount), 0.02, m);
      dashEW.material = lineMat;
      dashEW.isPickable = false;
    }
  });
}

/**
 * Street grid built from `generateBuildingLayout` — shophouse blocks get a
 * roof trim band + procedural window facade, HDB towers get horizontal
 * balcony banding + window-accent colour so the skyline reads as two
 * different building types instead of uniform boxes.
 */
function buildStreetGrid(scene: Scene, layout: BuildingFootprint[]): void {
  // Each material gets its own DynamicTexture instance rather than sharing/cloning
  // one — Texture.clone() reloads from a `url`, which a canvas-based DynamicTexture
  // doesn't have, so cloned copies came out blank (that's what made buildings look
  // see-through: the facade texture had no image data).
  const shophouseMats = SHOPHOUSE_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`shophouseMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    const tex = createWindowTexture(scene, `shophouseWindowTex_${i}`);
    tex.uScale = 3;
    tex.vScale = 4;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const hdbMats = HDB_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`hdbMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    const tex = createWindowTexture(scene, `hdbWindowTex_${i}`);
    tex.uScale = 2.5;
    tex.vScale = 9;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const hdbAccentMat = new StandardMaterial("hdbAccentMat", scene);
  hdbAccentMat.diffuseColor = HDB_ACCENT;
  hdbAccentMat.specularColor = Color3.Black();

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

      // Ground-floor awning + door hint for a bit of shophouse character.
      const awning = MeshBuilder.CreateBox(`awning_${i}`, { width: size + 0.6, height: 0.15, depth: size + 0.6 }, scene);
      awning.position.set(x, 2.6, z);
      awning.material = hdbAccentMat;
      awning.isPickable = false;
    }
  });
}

/** Procedural window-grid facade texture, shared/cloned across building materials. */
/** Tiled concrete-slab texture for the ground — breaks up the previously flat colour. */
function createPavementTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture("pavementTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#4a4d46";
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(55);
  // Speckled noise for a rough concrete look.
  for (let i = 0; i < 500; i++) {
    const shade = 60 + Math.floor(rand() * 30);
    ctx.fillStyle = `rgb(${shade},${shade + 2},${shade - 2})`;
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
  // Slab joint lines.
  ctx.strokeStyle = "#33352f";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  tex.update();
  tex.hasAlpha = false;
  return tex;
}

function createWindowTexture(scene: Scene, name: string): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#33322f";
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

/** Waist-high crates for close cover in the plaza and at street junctions. */
type CoverType = "crate" | "cratePile" | "sandbags" | "barrier";

/**
 * Varied close-quarters cover scattered through the plaza and streets —
 * crates, stacked crate piles, sandbag walls, and concrete barriers instead
 * of one box repeated everywhere.
 */
function buildCover(scene: Scene): void {
  const crateMat = new StandardMaterial("crateMat", scene);
  crateMat.diffuseColor = new Color3(0.4, 0.35, 0.25);
  crateMat.specularColor = Color3.Black();

  const sandbagMat = new StandardMaterial("sandbagMat", scene);
  sandbagMat.diffuseColor = new Color3(0.55, 0.48, 0.32);
  sandbagMat.specularColor = Color3.Black();

  const barrierMat = new StandardMaterial("barrierMat", scene);
  barrierMat.diffuseColor = new Color3(0.62, 0.6, 0.58);
  barrierMat.specularColor = Color3.Black();

  const coverLayout: Array<[number, number, CoverType, number]> = [
    // Central plaza — near player spawn, ring of varied low cover.
    [8, 6, "crate", 0],
    [-9, 5, "sandbags", 0.3],
    [6, -9, "barrier", 0.9],
    [-7, -8, "cratePile", 0],
    [0, 16, "sandbags", 0],
    [14, 2, "crate", 0],
    [-14, -3, "barrier", 1.4],
    [3, -17, "cratePile", 0.5],
    // Street junctions further out.
    [26, 13, "barrier", 0],
    [-26, -13, "sandbags", 0.7],
    [13, -26, "crate", 0],
    [-13, 26, "cratePile", 0],
    [39, 0, "sandbags", Math.PI / 2],
    [-39, 0, "barrier", Math.PI / 2],
    [0, 39, "crate", 0],
    [0, -39, "cratePile", 0.2],
    [52, 26, "sandbags", 0],
    [-52, -26, "barrier", 0.4],
    [26, 52, "cratePile", 0],
    [-26, -52, "crate", 0],
  ];

  coverLayout.forEach(([x, z, type, rot], i) => {
    switch (type) {
      case "crate": {
        const crate = MeshBuilder.CreateBox(`crate_${i}`, { width: 2, height: 2, depth: 2 }, scene);
        crate.position.set(x, 1, z);
        crate.rotation.y = rot;
        crate.material = crateMat;
        crate.checkCollisions = true;
        break;
      }
      case "cratePile": {
        const base = MeshBuilder.CreateBox(`cratePileBase_${i}`, { width: 2.2, height: 1.4, depth: 2.2 }, scene);
        base.position.set(x, 0.7, z);
        base.rotation.y = rot;
        base.material = crateMat;
        base.checkCollisions = true;
        const top = MeshBuilder.CreateBox(`cratePileTop_${i}`, { width: 1.3, height: 1.1, depth: 1.3 }, scene);
        top.position.set(x + 0.5, 1.4 + 0.55, z + 0.4);
        top.rotation.y = rot + 0.4;
        top.material = crateMat;
        top.checkCollisions = true;
        break;
      }
      case "sandbags": {
        buildSandbagWall(scene, x, z, rot, sandbagMat, i);
        break;
      }
      case "barrier": {
        buildConcreteBarrier(scene, x, z, rot, barrierMat, i);
        break;
      }
    }
  });
}

/** Low stacked sandbag wall — two rows of squat bags, good chest-high cover. */
function buildSandbagWall(scene: Scene, x: number, z: number, rotY: number, mat: StandardMaterial, index: number): void {
  const wall = MeshBuilder.CreateBox(`sandbagWall_${index}`, { width: 3, height: 1.1, depth: 0.8 }, scene);
  wall.position.set(x, 0.55, z);
  wall.rotation.y = rotY;
  wall.material = mat;
  wall.checkCollisions = true;

  for (let i = 0; i < 5; i++) {
    const bag = MeshBuilder.CreateSphere(`sandbag_${index}_${i}`, { diameterX: 0.55, diameterY: 0.35, diameterZ: 0.4 }, scene);
    const along = -1.15 + i * 0.58;
    bag.position.set(
      x + Math.cos(rotY) * along,
      1.15,
      z - Math.sin(rotY) * along
    );
    bag.rotation.y = rotY;
    bag.material = mat;
    bag.isPickable = false;
  }
}

/** Concrete Jersey barrier — a wedge-profile block, common roadside/checkpoint cover. */
function buildConcreteBarrier(scene: Scene, x: number, z: number, rotY: number, mat: StandardMaterial, index: number): void {
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
}

const CAR_COLORS = [new Color3(0.75, 0.1, 0.1), new Color3(0.1, 0.15, 0.5), new Color3(0.85, 0.85, 0.85), new Color3(0.15, 0.15, 0.15)];

/** Parked cars along the road curbs — placed in the guaranteed-clear gaps between blocks, checked against real building footprints so none clip into walls. */
function buildParkedCars(scene: Scene, layout: BuildingFootprint[]): void {
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
  const curbOffset = ROAD_HALF_WIDTH - 1.3;

  for (const line of MID_LINES) {
    // North-south road at x=line: park along either curb, cars facing along Z.
    for (const zSpot of GRID_LINES) {
      if (rand() < 0.45) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const x = line + side * curbOffset;
      const z = zSpot + (rand() - 0.5) * 14;
      if (inGardenDistrict(x, z, 6) || (Math.abs(x) < 20 && Math.abs(z) < 20)) continue;
      if (overlapsAnyBuilding(x, z, 2.4, layout)) continue;
      const rotation = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.12;
      buildCar(scene, x, z, rotation, carMats[carIndex % carMats.length], wheelMat, carIndex);
      carIndex++;
    }
    // East-west road at z=line: park along either curb, cars facing along X.
    for (const xSpot of GRID_LINES) {
      if (rand() < 0.45) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const z = line + side * curbOffset;
      const x = xSpot + (rand() - 0.5) * 14;
      if (inGardenDistrict(x, z, 6) || (Math.abs(x) < 20 && Math.abs(z) < 20)) continue;
      if (overlapsAnyBuilding(x, z, 2.4, layout)) continue;
      const rotation = Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.12;
      buildCar(scene, x, z, rotation, carMats[carIndex % carMats.length], wheelMat, carIndex);
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

/** Streetlights and trash bins along the roads/blocks — small set-dressing props, not collidable except the lamp pole. */
function buildStreetFurniture(scene: Scene, layout: BuildingFootprint[]): void {
  const poleMat = new StandardMaterial("lampPoleMat", scene);
  poleMat.diffuseColor = new Color3(0.12, 0.12, 0.13);
  poleMat.specularColor = Color3.Black();
  const lampMat = new StandardMaterial("lampHeadMat", scene);
  lampMat.diffuseColor = new Color3(0.9, 0.85, 0.6);
  lampMat.emissiveColor = new Color3(0.5, 0.45, 0.25);

  const binMat = new StandardMaterial("binMat", scene);
  binMat.diffuseColor = new Color3(0.15, 0.35, 0.2);
  binMat.specularColor = Color3.Black();
  const binLidMat = new StandardMaterial("binLidMat", scene);
  binLidMat.diffuseColor = new Color3(0.1, 0.25, 0.14);

  const rand = mulberry32(808);
  let lampIndex = 0;
  let binIndex = 0;
  const curbOffset = ROAD_HALF_WIDTH + 0.6;

  for (const line of MID_LINES) {
    for (const spot of GRID_LINES) {
      if (rand() < 0.5) {
        const x = line + curbOffset;
        const z = spot;
        if (!inGardenDistrict(x, z, 4) && !(Math.abs(x) < 22 && Math.abs(z) < 22) && !overlapsAnyBuilding(x, z, 1.5, layout)) {
          buildStreetlight(scene, x, z, poleMat, lampMat, lampIndex++);
        }
      }
      if (rand() < 0.35) {
        const z = line + curbOffset;
        const x = spot;
        if (!inGardenDistrict(x, z, 4) && !(Math.abs(x) < 22 && Math.abs(z) < 22) && !overlapsAnyBuilding(x, z, 1.5, layout)) {
          buildStreetlight(scene, x, z, poleMat, lampMat, lampIndex++);
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

function buildStreetlight(
  scene: Scene,
  x: number,
  z: number,
  poleMat: StandardMaterial,
  lampMat: StandardMaterial,
  index: number
): void {
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

function buildTrashBin(
  scene: Scene,
  x: number,
  z: number,
  binMat: StandardMaterial,
  lidMat: StandardMaterial,
  index: number
): void {
  const body = MeshBuilder.CreateCylinder(`trashBin_${index}`, { diameter: 0.6, height: 0.9 }, scene);
  body.position.set(x, 0.45, z);
  body.material = binMat;
  body.checkCollisions = true;

  const lid = MeshBuilder.CreateCylinder(`trashBinLid_${index}`, { diameter: 0.65, height: 0.08 }, scene);
  lid.position.set(x, 0.93, z);
  lid.material = lidMat;
  lid.isPickable = false;
}

/** Park/forest district: grass patch, a lake, dense trees, bushes, flowers, benches, and the camp clearing. */
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
  buildBushesAndFlowers(scene, centerX, centerZ, width, depth);
  buildBenches(scene, centerX, centerZ);
  buildCamp(scene);
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

  for (let i = 0; i < 55; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (Vector3.Distance(new Vector3(x, 0, z), new Vector3(centerX + 8, 0, centerZ - 6)) < 11) continue; // avoid the lake
    if (Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS) continue; // keep the camp clearing open

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

/** Low bushes (small trunkless canopies) and clusters of flowers scattered through the forest. */
function buildBushesAndFlowers(scene: Scene, centerX: number, centerZ: number, width: number, depth: number): void {
  const rand = mulberry32(212);
  const bushMat = new StandardMaterial("bushMat", scene);
  bushMat.diffuseColor = new Color3(0.2, 0.34, 0.17);
  bushMat.specularColor = Color3.Black();

  const flowerColors = [
    new Color3(0.85, 0.2, 0.25),
    new Color3(0.95, 0.8, 0.15),
    new Color3(0.95, 0.95, 0.9),
    new Color3(0.8, 0.4, 0.75),
  ];
  const flowerMats = flowerColors.map((c, i) => {
    const mat = new StandardMaterial(`flowerMat_${i}`, scene);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.25);
    mat.specularColor = Color3.Black();
    return mat;
  });

  for (let i = 0; i < 34; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (Vector3.Distance(new Vector3(x, 0, z), new Vector3(centerX + 8, 0, centerZ - 6)) < 10) continue;
    if (Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS - 3) continue;

    const bush = MeshBuilder.CreateSphere(`bush_${i}`, { diameter: 1.1 + rand() * 0.6, segments: 6 }, scene);
    bush.scaling.y = 0.6;
    bush.position.set(x, 0.4, z);
    bush.material = bushMat;
    bush.checkCollisions = true;
  }

  for (let cluster = 0; cluster < 16; cluster++) {
    const cx = centerX - width / 2 + rand() * width;
    const cz = centerZ - depth / 2 + rand() * depth;
    if (Vector3.Distance(new Vector3(cx, 0, cz), CAMP_POSITION) < CAMP_CLEARING_RADIUS - 4) continue;
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

/**
 * The player's SAF deployment point — a concealed tented camp tucked in the
 * forest's clearing (see CAMP_POSITION/CAMP_CLEARING_RADIUS). Two tents, a
 * flagpole, and supply crates; player always spawns/redeploys here.
 */
function buildCamp(scene: Scene): void {
  const dirtMat = new StandardMaterial("campDirtMat", scene);
  dirtMat.diffuseColor = new Color3(0.32, 0.28, 0.2);
  dirtMat.specularColor = Color3.Black();
  const clearing = MeshBuilder.CreateGround("campClearing", { width: CAMP_CLEARING_RADIUS * 2, height: CAMP_CLEARING_RADIUS * 2 }, scene);
  clearing.position.set(CAMP_POSITION.x, 0.03, CAMP_POSITION.z);
  clearing.material = dirtMat;
  clearing.isPickable = false;

  buildTent(scene, CAMP_POSITION.x - 4, CAMP_POSITION.z + 2, 0.3, "camp_tent_0");
  buildTent(scene, CAMP_POSITION.x - 2, CAMP_POSITION.z - 4, -0.6, "camp_tent_1");

  const poleMat = new StandardMaterial("campFlagpoleMat", scene);
  poleMat.diffuseColor = new Color3(0.15, 0.15, 0.16);
  const pole = MeshBuilder.CreateCylinder("campFlagpole", { diameter: 0.14, height: 5 }, scene);
  pole.position.set(CAMP_POSITION.x + 3, 2.5, CAMP_POSITION.z);
  pole.material = poleMat;
  pole.checkCollisions = true;

  const flagMat = new StandardMaterial("campFlagMat", scene);
  flagMat.diffuseColor = new Color3(0.85, 0.1, 0.1);
  flagMat.backFaceCulling = false;
  const flag = MeshBuilder.CreatePlane("campFlag", { width: 1.1, height: 0.7 }, scene);
  flag.position.set(CAMP_POSITION.x + 3.55, 4.5, CAMP_POSITION.z);
  flag.rotation.y = Math.PI / 2;
  flag.material = flagMat;
  flag.isPickable = false;

  const crateMat = new StandardMaterial("campCrateMat", scene);
  crateMat.diffuseColor = new Color3(0.38, 0.33, 0.22);
  crateMat.specularColor = Color3.Black();
  const cratePositions: Array<[number, number]> = [
    [CAMP_POSITION.x + 2, CAMP_POSITION.z + 3.5],
    [CAMP_POSITION.x + 2.8, CAMP_POSITION.z + 4.3],
  ];
  cratePositions.forEach(([x, z], i) => {
    const crate = MeshBuilder.CreateBox(`campCrate_${i}`, { width: 1.2, height: 1, depth: 1.2 }, scene);
    crate.position.set(x, 0.5, z);
    crate.material = crateMat;
    crate.checkCollisions = true;
  });
}

/** Simple two-panel canvas tent: a triangular-prism roof over a low box body. */
function buildTent(scene: Scene, x: number, z: number, rotY: number, name: string): void {
  const canvasMat = new StandardMaterial(`${name}Mat`, scene);
  canvasMat.diffuseColor = new Color3(0.28, 0.32, 0.22); // olive canvas
  canvasMat.specularColor = Color3.Black();

  const roof = MeshBuilder.CreateCylinder(`${name}_roof`, { diameter: 2.6, height: 3.4, tessellation: 3 }, scene);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = rotY;
  roof.position.set(x, 1.1, z);
  roof.material = canvasMat;
  roof.checkCollisions = true;

  const floorMat = new StandardMaterial(`${name}FloorMat`, scene);
  floorMat.diffuseColor = new Color3(0.22, 0.2, 0.15);
  const floor = MeshBuilder.CreateBox(`${name}_floor`, { width: 3.4, height: 0.1, depth: 2.6 }, scene);
  floor.rotation.y = rotY;
  floor.position.set(x, 0.05, z);
  floor.material = floorMat;
  floor.isPickable = false;
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
  scene.fogColor = color;
  const hemi = scene.getLightByName("hemiLight");
  if (hemi) hemi.intensity = intensity;
}
