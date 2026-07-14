import {
  Scene,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
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
const CBD_GLASS_COLORS = [new Color3(0.3, 0.42, 0.5), new Color3(0.35, 0.45, 0.42), new Color3(0.28, 0.38, 0.48)];
const INDUSTRIAL_COLORS = [new Color3(0.5, 0.42, 0.32), new Color3(0.42, 0.44, 0.46), new Color3(0.46, 0.38, 0.3)];

/** Grid line positions — buildings are centred on these (the street grid's "blocks"). Tighter spacing (22m) than before for a denser city. */
const GRID_LINES = [-77, -55, -33, -11, 11, 33, 55, 77];
/** Midpoints between grid lines — always clear of building footprints, so roads/props live here. */
const MID_LINES = [-66, -44, -22, 0, 22, 44, 66];
const MAP_SPAN = 200;
const BOUNDARY_HALF = 100;

/** South-west quadrant reserved for the park district — kept clear of street-grid buildings. */
const GARDEN_BOUNDS = { minX: -90, maxX: -18, minZ: -90, maxZ: -18 };
/** North-east quadrant, inner blocks — CBD glass-tower cluster. */
const CBD_BOUNDS = { minX: 11, maxX: 90, minZ: 11, maxZ: 90 };
/** South-east quadrant, outer blocks — industrial/logistics estate. */
const INDUSTRIAL_BOUNDS = { minX: 33, maxX: 90, minZ: -90, maxZ: -33 };

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

  const sun = new DirectionalLight("sunLight", new Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 0.9;

  // Distance fog for depth/atmosphere — cheap (no extra draw calls) and hides the
  // ground/building pop-in at the far edge of the play space.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 65;
  scene.fogEnd = 195;
  scene.fogColor = new Color3(0.5, 0.58, 0.68);

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.3, 0.32, 0.28);
  groundMat.specularColor = Color3.Black();
  const pavementTex = createPavementTexture(scene, "pavementTex", "#4a4d46");
  pavementTex.uScale = 50;
  pavementTex.vScale = 50;
  groundMat.diffuseTexture = pavementTex;

  const ground = MeshBuilder.CreateGround("ground", { width: MAP_SPAN + 20, height: MAP_SPAN + 20 }, scene);
  ground.material = groundMat;
  ground.checkCollisions = true;

  const layout = generateBuildingLayout();
  buildRoads(scene);
  buildIntersectionDressing(scene, layout);
  buildStreetGrid(scene, layout);
  buildCover(scene, layout);
  buildParkedCars(scene, layout);
  buildStreetFurniture(scene, layout);
  buildContainerYard(scene);
  buildGardenDistrict(scene);
  buildMbsLandmark(scene);
  buildMrtViaduct(scene);

  const wallMat = new StandardMaterial("wallMat", scene);
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

/** Roads laid out per the avenue/street/service hierarchy, with sidewalks either side. */
function buildRoads(scene: Scene): void {
  const roadMats: Record<RoadKind, StandardMaterial> = {
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
  const sidewalkMat = new StandardMaterial("sidewalkMat", scene);
  sidewalkMat.diffuseColor = new Color3(0.62, 0.6, 0.55);
  sidewalkMat.specularColor = Color3.Black();
  sidewalkMat.diffuseTexture = sidewalkTex;
  sidewalkTex.uScale = 40;
  sidewalkTex.vScale = 4;

  MID_LINES.forEach((m, i) => {
    const kind = roadKind(m);
    const hw = roadHalfWidth(kind);
    const mat = roadMats[kind];

    const roadNS = MeshBuilder.CreateGround(`roadNS_${i}`, { width: hw * 2, height: MAP_SPAN }, scene);
    roadNS.position.set(m, 0.015, 0);
    roadNS.material = mat;
    roadNS.isPickable = false;

    const roadEW = MeshBuilder.CreateGround(`roadEW_${i}`, { width: hw * 2, height: MAP_SPAN }, scene);
    roadEW.position.set(0, 0.015, m);
    roadEW.rotation.y = Math.PI / 2;
    roadEW.material = mat;
    roadEW.isPickable = false;

    const sideW = 1.4;
    for (const side of [-1, 1]) {
      const sideNS = MeshBuilder.CreateGround(`sidewalkNS_${i}_${side}`, { width: sideW, height: MAP_SPAN }, scene);
      sideNS.position.set(m + side * (hw + sideW / 2 + 0.1), 0.017, 0);
      sideNS.material = sidewalkMat;
      sideNS.isPickable = false;

      const sideEW = MeshBuilder.CreateGround(`sidewalkEW_${i}_${side}`, { width: MAP_SPAN, height: sideW }, scene);
      sideEW.position.set(0, 0.017, m + side * (hw + sideW / 2 + 0.1));
      sideEW.material = sidewalkMat;
      sideEW.isPickable = false;
    }
  });
}

function matFromTexture(scene: Scene, name: string, tex: DynamicTexture): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
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
  const crosswalkMat = new StandardMaterial("crosswalkMat", scene);
  crosswalkMat.diffuseTexture = crosswalkTex;
  crosswalkMat.useAlphaFromDiffuseTexture = true;
  crosswalkMat.specularColor = Color3.Black();
  crosswalkMat.backFaceCulling = false;

  const poleMat = new StandardMaterial("trafficPoleMat", scene);
  poleMat.diffuseColor = new Color3(0.14, 0.14, 0.15);
  poleMat.specularColor = Color3.Black();
  const redMat = new StandardMaterial("trafficRedMat", scene);
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
  crosswalkMat: StandardMaterial,
  poleMat: StandardMaterial,
  redMat: StandardMaterial,
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
  const poleMat = new StandardMaterial(`signPoleMat_${index}`, scene);
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

  const boardMat = new StandardMaterial(`signBoardMat_${index}`, scene);
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
    const mat = new StandardMaterial(`shophouseMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    const tex = createWindowTexture(scene, `shophouseWindowTex_${i}`, "#33322f");
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
    const tex = createWindowTexture(scene, `hdbWindowTex_${i}`, "#33322f");
    tex.uScale = 2.5;
    tex.vScale = 9;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const cbdMats = CBD_GLASS_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`cbdMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.5, 0.55, 0.58);
    mat.specularPower = 64;
    const tex = createWindowTexture(scene, `cbdWindowTex_${i}`, "#1c2a33");
    tex.uScale = 4;
    tex.vScale = 12;
    tex.hasAlpha = false;
    mat.diffuseTexture = tex;
    return mat;
  });
  const industrialMats = INDUSTRIAL_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`industrialMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
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
    } else if (type === "cbd") {
      building.material = cbdMats[i % cbdMats.length];
      const cap = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size * 0.7, height: 1.2, depth: size * 0.7 }, scene);
      cap.position.set(x, height + 0.6, z);
      cap.material = poleGrayMat(scene, `cbdCapMat_${i}`);
      cap.isPickable = false;
    } else if (type === "industrial") {
      building.material = industrialMats[i % industrialMats.length];
      // A row of shallow roof vents for a bit of warehouse silhouette detail.
      const vent = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size * 0.4, height: 0.8, depth: 1.6 }, scene);
      vent.position.set(x, height + 0.4, z);
      vent.material = industrialMats[(i + 1) % industrialMats.length];
      vent.isPickable = false;
    } else {
      building.material = shophouseMats[i % shophouseMats.length];
      const trim = MeshBuilder.CreateBox(`buildingTrim_${i}`, { width: size + 0.4, height: 0.6, depth: size + 0.4 }, scene);
      trim.position.set(x, height + 0.3, z);
      trim.material = shophouseMats[(i + 1) % shophouseMats.length];
      trim.isPickable = false;

      // Ground-floor awning / sheltered walkway hint for a bit of shophouse character.
      const awning = MeshBuilder.CreateBox(`awning_${i}`, { width: size + 0.6, height: 0.15, depth: size + 0.6 }, scene);
      awning.position.set(x, 2.6, z);
      awning.material = hdbAccentMat;
      awning.isPickable = false;
    }
  });
}

const poleGrayCache = new Map<string, StandardMaterial>();
function poleGrayMat(scene: Scene, name: string): StandardMaterial {
  let mat = poleGrayCache.get(name);
  if (!mat) {
    mat = new StandardMaterial(name, scene);
    mat.diffuseColor = new Color3(0.55, 0.57, 0.6);
    mat.specularColor = Color3.Black();
    poleGrayCache.set(name, mat);
  }
  return mat;
}

/** Tiled concrete-slab texture, reused for the ground and (in a lighter shade) sidewalks. */
function createPavementTexture(scene: Scene, name: string, base: string): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(55);
  for (let i = 0; i < 400; i++) {
    const shade = 20 + Math.floor(rand() * 30);
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade - 2},0.35)`;
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
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
  const target = 46;

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
    if (Math.abs(x) < 10 && Math.abs(z) < 10) continue; // keep the plaza centre clear
    if (overlapsAnyBuilding(x, z, 1.2, layout)) continue;
    if (distanceToNearestRoad(x, z) < 1.6) continue; // stay off the carriageway (fixes cover blocking traffic lanes)

    const type = COVER_TYPES[Math.floor(rand() * COVER_TYPES.length)];
    const rot = rand() * Math.PI * 2;
    placeCover(scene, type, x, z, rot, mats, placed);
    placed++;
  }
}

function solidMat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = Color3.Black();
  return mat;
}

function placeCover(
  scene: Scene,
  type: CoverType,
  x: number,
  z: number,
  rot: number,
  mats: Record<string, StandardMaterial>,
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
    bag.position.set(x + Math.cos(rotY) * along, 1.15, z - Math.sin(rotY) * along);
    bag.rotation.y = rotY;
    bag.material = mat;
    bag.isPickable = false;
  }
}

/** Concrete Jersey barrier / roadblock — a wedge-profile block, common roadside/checkpoint cover. Roadblocks add alternating stripe blocks for the hazard-paint look. */
function buildConcreteBarrier(
  scene: Scene,
  x: number,
  z: number,
  rotY: number,
  mat: StandardMaterial,
  index: number,
  kind: "barrier" | "roadblock",
  stripeMat?: StandardMaterial
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
function buildLowWall(scene: Scene, x: number, z: number, rotY: number, mat: StandardMaterial, index: number, name: string): void {
  const wall = MeshBuilder.CreateBox(`${name}_${index}`, { width: 3.2, height: 1, depth: 0.5 }, scene);
  wall.position.set(x, 0.5, z);
  wall.rotation.y = rotY;
  wall.material = mat;
  wall.checkCollisions = true;
}

/** A trimmed hedge row — dense green cover, shorter than a wall but still blocks line of sight when crouched. */
function buildHedge(scene: Scene, x: number, z: number, rotY: number, mat: StandardMaterial, index: number): void {
  const hedge = MeshBuilder.CreateBox(`hedge_${index}`, { width: 3, height: 0.9, depth: 0.7 }, scene);
  hedge.position.set(x, 0.45, z);
  hedge.rotation.y = rotY;
  hedge.material = mat;
  hedge.checkCollisions = true;
}

/** Shared builder for metal fences (taller, chest-high) and railings (shorter, knee-high) — a line of thin posts with a top rail. */
function buildFenceLine(scene: Scene, x: number, z: number, rotY: number, height: number, mat: StandardMaterial, index: number, name: string): void {
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
  mat: StandardMaterial,
  stripeMat: StandardMaterial,
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
  const wheelMat = new StandardMaterial("wheelMat", scene);
  wheelMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
  wheelMat.specularColor = Color3.Black();

  const carMats = CAR_COLORS.map((color, i) => {
    const mat = new StandardMaterial(`carMat_${i}`, scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
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
function buildVehicle(
  scene: Scene,
  type: VehicleType,
  x: number,
  z: number,
  rotationY: number,
  civMat: StandardMaterial,
  busMat: StandardMaterial,
  safMat: StandardMaterial,
  wheelMat: StandardMaterial,
  index: number
): void {
  const dims = VEHICLE_DIMS[type];
  const isMilitary = type === "saf5tonner" || type === "safLandRover";
  const bodyMat = type === "bus" ? busMat : isMilitary ? safMat : civMat;

  if (type === "motorcycle") {
    const body = MeshBuilder.CreateBox(`veh_${index}_body`, { width: dims.w, height: dims.h, depth: dims.d }, scene);
    body.position.set(x, 0.35, z);
    body.rotation.y = rotationY;
    body.material = bodyMat;
    body.checkCollisions = true;
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

  const root = MeshBuilder.CreateBox(`veh_${index}_body`, { width: dims.w, height: dims.h, depth: dims.d }, scene);
  root.position.set(x, dims.h / 2 + 0.15, z);
  root.rotation.y = rotationY;
  root.material = bodyMat;
  root.checkCollisions = true;

  if (dims.cabinH > 0) {
    const cabin = MeshBuilder.CreateBox(`veh_${index}_cabin`, { width: dims.w * 0.9, height: dims.cabinH, depth: dims.cabinD }, scene);
    cabin.position.set(0, dims.h / 2 + dims.cabinH / 2, dims.d * 0.05);
    cabin.material = bodyMat;
    cabin.parent = root;
    cabin.isPickable = false;
  } else if (type === "lorry" || type === "saf5tonner") {
    // Separate cab + open cargo bed with a canvas tilt for the 5-tonner.
    const cab = MeshBuilder.CreateBox(`veh_${index}_cab`, { width: dims.w * 0.95, height: 0.9, depth: 1.4 }, scene);
    cab.position.set(0, dims.h / 2 + 0.45, dims.d / 2 - 0.9);
    cab.material = bodyMat;
    cab.parent = root;
    cab.isPickable = false;
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
  const wheelDia = type === "bus" || type === "lorry" || type === "saf5tonner" ? 0.85 : 0.55;
  wheelPositions.forEach(([wx, wz], i) => {
    const wheel = MeshBuilder.CreateCylinder(`veh_${index}_wheel_${i}`, { diameter: wheelDia, height: 0.3 }, scene);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, -dims.h / 2, wz);
    wheel.material = wheelMat;
    wheel.parent = root;
    wheel.isPickable = false;
  });
}

/** Streetlights, trash bins, and bus stops along the roads/blocks — small set-dressing props, not collidable except the lamp pole. */
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

function buildStreetlight(scene: Scene, x: number, z: number, poleMat: StandardMaterial, lampMat: StandardMaterial, index: number): void {
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

function buildTrashBin(scene: Scene, x: number, z: number, binMat: StandardMaterial, lidMat: StandardMaterial, index: number): void {
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
function buildBusStop(scene: Scene, x: number, z: number, rotY: number, shelterMat: StandardMaterial, benchMat: StandardMaterial, index: number): void {
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

/** A small stacked-container yard for the industrial estate — cheap coloured boxes, cover-friendly gaps between rows. */
function buildContainerYard(scene: Scene): void {
  const colors = [
    new Color3(0.65, 0.15, 0.1),
    new Color3(0.1, 0.35, 0.55),
    new Color3(0.15, 0.45, 0.2),
    new Color3(0.65, 0.55, 0.1),
  ];
  const mats = colors.map((c, i) => solidMat(scene, `containerMat_${i}`, c));

  const yardX = 74;
  const yardZ = -74;
  const rand = mulberry32(606);
  let index = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      if (rand() < 0.15) continue;
      const stacked = rand() < 0.4;
      const x = yardX - row * 4.5;
      const z = yardZ + col * 3;
      const container = MeshBuilder.CreateBox(`container_${index}`, { width: 2.4, height: 2.4, depth: 6 }, scene);
      container.position.set(x, 1.2, z);
      container.rotation.y = rand() < 0.5 ? 0 : Math.PI / 2;
      container.material = mats[index % mats.length];
      container.checkCollisions = true;
      index++;
      if (stacked) {
        const top = MeshBuilder.CreateBox(`container_${index}`, { width: 2.4, height: 2.4, depth: 6 }, scene);
        top.position.set(x, 3.6, z);
        top.rotation.y = container.rotation.y;
        top.material = mats[(index + 1) % mats.length];
        top.checkCollisions = true;
        index++;
      }
    }
  }
}

/** Park/forest district: grass patch, a lake, a canal, dense trees, bushes, flowers, benches, and the camp clearing. */
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

  buildLake(scene, centerX + 8, centerZ - 6, 14);
  buildCanal(scene);
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
  const waterMat = new StandardMaterial("canalWaterMat", scene);
  waterMat.diffuseColor = new Color3(0.14, 0.3, 0.42);
  waterMat.specularColor = new Color3(0.4, 0.5, 0.55);
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

function buildTrees(scene: Scene, centerX: number, centerZ: number, width: number, depth: number): void {
  const rand = mulberry32(99);
  const trunkMat = new StandardMaterial("trunkMat", scene);
  trunkMat.diffuseColor = new Color3(0.32, 0.22, 0.14);
  trunkMat.specularColor = Color3.Black();
  const canopyMats = [new Color3(0.18, 0.4, 0.16), new Color3(0.22, 0.45, 0.18), new Color3(0.16, 0.36, 0.2)].map((c, i) => {
    const mat = new StandardMaterial(`canopyMat_${i}`, scene);
    mat.diffuseColor = c;
    mat.specularColor = Color3.Black();
    return mat;
  });

  for (let i = 0; i < 55; i++) {
    const x = centerX - width / 2 + rand() * width;
    const z = centerZ - depth / 2 + rand() * depth;
    if (Vector3.Distance(new Vector3(x, 0, z), new Vector3(centerX + 8, 0, centerZ - 6)) < 10) continue; // avoid the lake
    if (Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS) continue; // keep the camp clearing open
    if (x > GARDEN_BOUNDS.maxX - 5) continue; // keep the canal bank clear

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
    if (Vector3.Distance(new Vector3(x, 0, z), new Vector3(centerX + 8, 0, centerZ - 6)) < 9) continue;
    if (Vector3.Distance(new Vector3(x, 0, z), CAMP_POSITION) < CAMP_CLEARING_RADIUS - 3) continue;
    if (x > GARDEN_BOUNDS.maxX - 5) continue;

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
    if (cx > GARDEN_BOUNDS.maxX - 5) continue;
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
 * flagpole, and supply crates; player always spawns/redeploys here. A small
 * checkpoint with SAF vehicles sits just outside the clearing (see
 * buildParkedCars) representing the logistics tail for the defence line.
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

  buildCampExits(scene);
}

/**
 * Three staggered exit chicanes around the camp clearing's edge — a pair of
 * offset low walls plus a hedge at each, so nobody standing at the treeline
 * outside has a clean sightline straight into the camp. Purely visual/cover
 * dressing; the actual no-combat guarantee comes from the AI exclusion zone
 * (SafeZone.ts) which keeps OPFOR out to begin with.
 */
function buildCampExits(scene: Scene): void {
  const wallMat = solidMat(scene, "campExitWallMat", new Color3(0.42, 0.4, 0.36));
  const hedgeMat = solidMat(scene, "campExitHedgeMat", new Color3(0.19, 0.32, 0.17));

  // Three exits toward the city (NE), the rest of the garden/canal (N), and
  // the checkpoint/road (E) — the directions a player would actually walk.
  const exitAngles = [Math.PI / 4, Math.PI / 2, 0];
  const gateRadius = CAMP_CLEARING_RADIUS + 1.5;

  exitAngles.forEach((angle, i) => {
    const gx = CAMP_POSITION.x + Math.cos(angle) * gateRadius;
    const gz = CAMP_POSITION.z + Math.sin(angle) * gateRadius;
    const perp = angle + Math.PI / 2;

    // Two walls staggered left/right of the exit line, offset inward and
    // outward, so a straight-through sightline never lines up.
    buildLowWall(
      scene,
      gx + Math.cos(perp) * 2.4,
      gz + Math.sin(perp) * 2.4,
      angle,
      wallMat,
      i * 2,
      "campExitWall"
    );
    buildLowWall(
      scene,
      gx - Math.cos(perp) * 2.4 + Math.cos(angle) * 3,
      gz - Math.sin(perp) * 2.4 + Math.sin(angle) * 3,
      angle,
      wallMat,
      i * 2 + 1,
      "campExitWall"
    );
    buildHedge(scene, gx + Math.cos(angle) * 4, gz + Math.sin(angle) * 4, angle + Math.PI / 2, hedgeMat, 800 + i);
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

  const railMat = new StandardMaterial("mbsRailMat", scene);
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
  if (hemi) hemi.intensity = intensity;
}
