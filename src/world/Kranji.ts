import { Scene, MeshBuilder, TransformNode, Vector3, Color3, PointLight } from "@babylonjs/core";
import { WorldMaterial } from "@/world/WorldMaterial";
import {
  mulberry32,
  solidMat,
  buildSandbagWall,
  buildConcreteBarrier,
  buildFenceLine,
  buildStreetlight,
} from "@/world/Level";

/**
 * Firebase Kranji — a night-lit port/industrial dockyard, the venue for
 * Strongpoint Assault and the Ranger Gauntlet. Built like Level.ts (real
 * procedural geometry registered under one MapProfile — see KRANJI_PROFILE in
 * MapProfile.ts) rather than IronCitadel.ts's shortcut of skipping the
 * safe-zone/enemy-spawn systems entirely.
 *
 * Shares Singapore's coordinate space by design (both near world origin) so
 * Nav.ts's fixed ±96 playable half-extent still resolves real navigable
 * ground for the AI squads this map needs — see the comment on
 * KRANJI_PROFILE for why. Only one map's root is ever enabled at a time
 * (main.ts toggles visibility), so the shared coordinate range never causes
 * overlap on screen or in picking.
 */

export interface KranjiHandles {
  root: TransformNode;
  spawn: Vector3;
  /** The four objective areas Strongpoint Assault/Ranger Gauntlet spawn squads at and track. */
  strongpointDefs: KranjiStrongpointDef[];
}

export interface KranjiStrongpointDef {
  id: string;
  name: string;
  center: Vector3;
  enemyTypes: string[];
  /** Constant "wave number" fed into EnemyManager.spawnGroupAt's existing health/accuracy scaling — later strongpoints pass a higher value for a tougher fixed squad. */
  difficultyWave: number;
}

/** Player deploy point — the quay entrance, facing into the yard. */
const SPAWN = new Vector3(0, 2, -85);

/** The four objective areas, escalating in difficulty toward the fuel depot at the back of the yard. */
const STRONGPOINT_DEFS: KranjiStrongpointDef[] = [
  {
    id: "containers",
    name: "Container Stacks",
    center: new Vector3(-40, 0, -10),
    enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_grunt", "opfor_marksman"],
    difficultyWave: 3,
  },
  {
    id: "crane",
    name: "Crane Control",
    center: new Vector3(40, 0, -10),
    enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_marksman", "opfor_marksman"],
    difficultyWave: 5,
  },
  {
    id: "dockmaster",
    name: "Dockmaster's Office",
    center: new Vector3(-40, 0, 35),
    enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_officer", "opfor_marksman"],
    difficultyWave: 7,
  },
  {
    id: "fueldepot",
    name: "Fuel Depot",
    center: new Vector3(40, 0, 35),
    enemyTypes: ["opfor_heavy", "opfor_grunt", "opfor_grunt", "opfor_marksman", "opfor_officer"],
    difficultyWave: 9,
  },
];

export function buildKranji(scene: Scene): KranjiHandles {
  const root = new TransformNode("kranjiRoot", scene);

  // ---- Ground: a single dark asphalt/concrete quay plane, tagged walkable
  // (not literally named "ground" — Singapore's own ground mesh already
  // claims that name, and Nav.ts's isNavigable() treats any mesh tagged
  // metadata.walkable === true as navigable regardless of name, the same
  // mechanism Iron Citadel's interior floors use).
  const groundMat = new WorldMaterial("kranjiGroundMat", scene);
  groundMat.diffuseColor = new Color3(0.09, 0.09, 0.1);
  groundMat.specularColor = Color3.Black();
  const ground = MeshBuilder.CreateGround("kranjiGround", { width: 160, height: 160 }, scene);
  ground.position.set(0, 0, -25);
  ground.material = groundMat;
  ground.checkCollisions = true;
  ground.metadata = { walkable: true };
  ground.parent = root;

  // ---- Night lighting: a handful of flood lights over the yard, dim ambient
  // otherwise so the map reads as a raid at night rather than a recolour of
  // the daytime city.
  const floodPositions: Array<[number, number]> = [
    [-40, -10],
    [40, -10],
    [-40, 35],
    [40, 35],
    [0, -85],
  ];
  for (const [x, z] of floodPositions) {
    const flood = new PointLight(`kranjiFlood_${x}_${z}`, new Vector3(x, 9, z), scene);
    flood.diffuse = new Color3(0.85, 0.82, 0.68);
    flood.intensity = 0.55;
    flood.range = 30;
    flood.parent = root;
  }

  // ---- Perimeter fencing + checkpoint dressing near the spawn.
  const fenceMat = new WorldMaterial("kranjiFenceMat", scene);
  fenceMat.diffuseColor = new Color3(0.2, 0.21, 0.22);
  const rand = mulberry32(4471);
  let fenceIdx = 0;
  for (const side of [-1, 1]) {
    for (let i = -3; i <= 3; i++) {
      buildFenceLine(scene, side * 78, -85 + i * 6, Math.PI / 2, 2.2, fenceMat, fenceIdx++, "kranjiFence");
    }
  }

  const barrierMat = new WorldMaterial("kranjiBarrierMat", scene);
  barrierMat.diffuseColor = new Color3(0.75, 0.72, 0.15);
  const sandbagMat = solidMat(scene, "kranjiSandbagMat", new Color3(0.42, 0.38, 0.28));
  buildConcreteBarrier(scene, -6, -78, 0, barrierMat, 0, "roadblock", barrierMat);
  buildConcreteBarrier(scene, 6, -78, 0, barrierMat, 1, "roadblock", barrierMat);
  buildSandbagWall(scene, -12, -80, 0.3, sandbagMat, 0);
  buildSandbagWall(scene, 12, -80, -0.3, sandbagMat, 1);

  // A streetlight line down the quay approach.
  const poleMat = new WorldMaterial("kranjiPoleMat", scene);
  poleMat.diffuseColor = new Color3(0.15, 0.15, 0.16);
  const lampMat = solidMat(scene, "kranjiLampMat", new Color3(0.9, 0.85, 0.6));
  for (let i = 0; i < 5; i++) {
    buildStreetlight(scene, -6, -85 + i * 15, poleMat, lampMat, i);
  }

  // ---- The four strongpoint sub-areas: a distinct silhouette per objective
  // so the player can navigate by sight, not just a HUD marker.
  buildContainerStacks(scene, root, rand);
  buildCraneControl(scene, root, rand);
  buildDockmasterOffice(scene, root, rand);
  buildFuelDepot(scene, root, rand);

  root.setEnabled(false);
  return { root, spawn: SPAWN, strongpointDefs: STRONGPOINT_DEFS };
}

function containerMat(scene: Scene, colorIdx: number): WorldMaterial {
  const colors = [
    new Color3(0.55, 0.14, 0.1),
    new Color3(0.1, 0.3, 0.48),
    new Color3(0.14, 0.4, 0.18),
    new Color3(0.55, 0.46, 0.09),
  ];
  const mat = new WorldMaterial(`kranjiContainer_${colorIdx}`, scene);
  mat.diffuseColor = colors[colorIdx % colors.length];
  mat.specularColor = Color3.Black();
  return mat;
}

/** Stacked shipping containers forming corridors and elevated cover — the western objective. */
function buildContainerStacks(scene: Scene, root: TransformNode, rand: () => number): void {
  const center = new Vector3(-40, 0, -10);
  const rows = 3;
  const perRow = 4;
  let idx = 0;
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < perRow; c++) {
      const x = center.x - 12 + c * 8 + (rand() - 0.5) * 1.5;
      const z = center.z - 10 + row * 8 + (rand() - 0.5) * 1.5;
      const stackHeight = 1 + Math.floor(rand() * 2); // 1-2 containers tall
      for (let h = 0; h < stackHeight; h++) {
        const box = MeshBuilder.CreateBox(`kranjiContainer_${idx}_${h}`, { width: 6, height: 2.6, depth: 2.4 }, scene);
        box.position.set(x, 1.3 + h * 2.6, z);
        box.rotation.y = rand() * 0.3;
        box.material = containerMat(scene, idx % 4);
        box.checkCollisions = true;
        box.parent = root;
      }
      idx++;
    }
  }
}

/** A raised gantry-crane control cabin — the northern-east objective, verticality as cover. */
function buildCraneControl(scene: Scene, root: TransformNode, rand: () => number): void {
  const cx = 40, cz = -10;
  const metalMat = new WorldMaterial("kranjiCraneMat", scene);
  metalMat.diffuseColor = new Color3(0.72, 0.4, 0.08);
  metalMat.specularColor = Color3.Black();

  for (const [dx, dz] of [
    [-6, -6],
    [6, -6],
    [-6, 6],
    [6, 6],
  ]) {
    const leg = MeshBuilder.CreateBox(`kranjiCraneLeg_${dx}_${dz}`, { width: 0.7, height: 11, depth: 0.7 }, scene);
    leg.position.set(cx + dx, 5.5, cz + dz);
    leg.material = metalMat;
    leg.checkCollisions = true;
    leg.parent = root;
  }
  const deck = MeshBuilder.CreateBox("kranjiCraneDeck", { width: 14, height: 0.5, depth: 14 }, scene);
  deck.position.set(cx, 11, cz);
  deck.material = metalMat;
  deck.checkCollisions = true;
  deck.metadata = { walkable: true };
  deck.parent = root;

  const cabin = MeshBuilder.CreateBox("kranjiCraneCabin", { width: 4, height: 2.6, depth: 3.2 }, scene);
  cabin.position.set(cx, 12.6, cz);
  cabin.material = solidMat(scene, "kranjiCabinMat", new Color3(0.18, 0.2, 0.22));
  cabin.checkCollisions = true;
  cabin.parent = root;

  // Ramp up to the deck.
  const ramp = MeshBuilder.CreateBox("kranjiCraneRamp", { width: 2.4, height: 0.3, depth: 12 }, scene);
  ramp.position.set(cx - 8, 5.5, cz);
  ramp.rotation.x = -Math.atan2(11, 12);
  ramp.material = metalMat;
  ramp.checkCollisions = true;
  ramp.metadata = { walkable: true };
  ramp.parent = root;

  void rand;
}

/** A two-storey dockmaster's office block — the south-west objective, close-quarters interior fighting. */
function buildDockmasterOffice(scene: Scene, root: TransformNode, rand: () => number): void {
  const cx = -40, cz = 35;
  const wallMat = new WorldMaterial("kranjiOfficeMat", scene);
  wallMat.diffuseColor = new Color3(0.42, 0.4, 0.35);

  const shell = MeshBuilder.CreateBox("kranjiOfficeShell", { width: 12, height: 6.4, depth: 9 }, scene);
  shell.position.set(cx, 3.2, cz);
  shell.material = wallMat;
  shell.checkCollisions = true;
  shell.parent = root;

  const floor = MeshBuilder.CreateGround("kranjiOfficeFloor", { width: 11, height: 8 }, scene);
  floor.position.set(cx, 3.3, cz);
  floor.material = solidMat(scene, "kranjiOfficeFloorMat", new Color3(0.3, 0.29, 0.26));
  floor.metadata = { walkable: true };
  floor.checkCollisions = true;
  floor.parent = root;

  // Sandbagged approach.
  buildSandbagWall(scene, cx - 8, cz - 3, Math.PI / 2, solidMat(scene, "kranjiOfficeSandbagMat", new Color3(0.4, 0.36, 0.26)), 10);
  void rand;
}

/** Fuel storage tanks + pipe racks — the toughest, north-east objective. */
function buildFuelDepot(scene: Scene, root: TransformNode, rand: () => number): void {
  const cx = 40, cz = 35;
  const tankMat = new WorldMaterial("kranjiTankMat", scene);
  tankMat.diffuseColor = new Color3(0.5, 0.15, 0.12);
  tankMat.specularColor = Color3.Black();

  for (const [dx, dz] of [
    [-6, -4],
    [6, -4],
    [0, 5],
  ]) {
    const tank = MeshBuilder.CreateCylinder(`kranjiFuelTank_${dx}_${dz}`, { diameter: 5, height: 5.5 }, scene);
    tank.position.set(cx + dx, 2.75, cz + dz);
    tank.material = tankMat;
    tank.checkCollisions = true;
    tank.parent = root;
  }

  const barrierMat = solidMat(scene, "kranjiFuelBarrierMat", new Color3(0.72, 0.68, 0.14));
  buildConcreteBarrier(scene, cx - 10, cz + 8, Math.PI / 2, barrierMat, 20, "barrier");
  buildConcreteBarrier(scene, cx + 10, cz + 8, -Math.PI / 2, barrierMat, 21, "barrier");
  void rand;
}
