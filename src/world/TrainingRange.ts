import { Scene, MeshBuilder, StandardMaterial, DynamicTexture, Color3, Vector3, TransformNode } from "@babylonjs/core";

/**
 * SAF-style live-fire range, built once far outside the main city (well
 * clear of its invisible boundary walls) so it can share the same scene,
 * camera, and weapon-hit pipeline as the main game without any of the two
 * ever overlapping. The player only ever arrives here by teleport from the
 * Training Range menu action, never on foot.
 */
export const RANGE_FIRING_LINE = new Vector3(0, 0, 250);
/** Lane runs along +Z from the firing line. */
export const RANGE_DISTANCES_M = [25, 50, 100, 200] as const;
const LANE_HALF_WIDTH = 4;
const BERM_Z = RANGE_FIRING_LINE.z + 215;

function solidMat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = Color3.Black();
  return mat;
}

function numberBoardTexture(scene: Scene, name: string, label: string): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = "#f4f0e8";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 64, 68);
  tex.update();
  return tex;
}

export interface TrainingRangeAssets {
  /** Node the target rig is parented to — repositioned along the lane per selected distance. */
  targetCarriage: TransformNode;
}

/** Builds the whole range compound. Cheap/one-shot — fine to leave static-frozen with the rest of the world. */
export function buildTrainingRange(scene: Scene): TrainingRangeAssets {
  const concrete = solidMat(scene, "rangeConcreteMat", new Color3(0.55, 0.55, 0.52));
  const sand = solidMat(scene, "rangeSandMat", new Color3(0.68, 0.6, 0.42));
  const timber = solidMat(scene, "rangeTimberMat", new Color3(0.4, 0.3, 0.2));
  const steel = solidMat(scene, "rangeSteelMat", new Color3(0.3, 0.32, 0.34));
  const roofMat = solidMat(scene, "rangeRoofMat", new Color3(0.25, 0.28, 0.24));
  const paintMat = solidMat(scene, "rangeLaneMarkMat", new Color3(0.85, 0.82, 0.75));
  const olive = solidMat(scene, "rangeOliveMat", new Color3(0.28, 0.32, 0.2));

  const originX = RANGE_FIRING_LINE.x;
  const originZ = RANGE_FIRING_LINE.z;

  // Lane ground pad — flat concrete strip the full lane length.
  const laneLen = BERM_Z - originZ + 20;
  const laneGround = MeshBuilder.CreateGround("rangeLaneGround", { width: LANE_HALF_WIDTH * 2 + 4, height: laneLen }, scene);
  laneGround.position.set(originX, 0.01, originZ + laneLen / 2 - 10);
  laneGround.material = concrete;
  laneGround.checkCollisions = true;

  // Lane markings: painted edge lines + a firing-line stripe.
  for (const side of [-1, 1]) {
    const line = MeshBuilder.CreateBox(`rangeLaneLine_${side}`, { width: 0.12, height: 0.02, depth: laneLen - 4 }, scene);
    line.position.set(originX + side * LANE_HALF_WIDTH, 0.03, originZ + laneLen / 2 - 8);
    line.material = paintMat;
    line.isPickable = false;
  }
  const fireStripe = MeshBuilder.CreateBox("rangeFireStripe", { width: LANE_HALF_WIDTH * 2, height: 0.02, depth: 0.25 }, scene);
  fireStripe.position.set(originX, 0.03, originZ);
  fireStripe.material = paintMat;
  fireStripe.isPickable = false;

  // Safety barriers flanking the lane the full run.
  for (const side of [-1, 1]) {
    const barrier = MeshBuilder.CreateBox(`rangeSafetyBarrier_${side}`, { width: 0.4, height: 1.4, depth: laneLen - 6 }, scene);
    barrier.position.set(originX + side * (LANE_HALF_WIDTH + 0.6), 0.7, originZ + laneLen / 2 - 8);
    barrier.material = concrete;
    barrier.checkCollisions = true;
  }

  // --- Covered firing point: roof on posts, shooting benches, ammo crate ---
  // Generously tall clearance (well above head height even before the
  // player's spawn height has settled to the ground) so the shelter can
  // never clip a shot fired from directly underneath it.
  const shelterDepth = 4;
  const shelterHeight = 4.4;
  const shelterZ = originZ - shelterDepth / 2 + 1;
  const roof = MeshBuilder.CreateBox("rangeShelterRoof", { width: LANE_HALF_WIDTH * 2 + 1, height: 0.2, depth: shelterDepth + 1 }, scene);
  roof.position.set(originX, shelterHeight, shelterZ);
  roof.material = roofMat;
  roof.checkCollisions = true;
  const postXs = [-LANE_HALF_WIDTH - 0.3, -1.6, 1.6, LANE_HALF_WIDTH + 0.3];
  const postZs = [shelterZ - shelterDepth / 2, shelterZ + shelterDepth / 2];
  for (const px of postXs) {
    for (const pz of postZs) {
      const post = MeshBuilder.CreateBox(`rangeShelterPost_${px}_${pz}`, { width: 0.25, height: shelterHeight, depth: 0.25 }, scene);
      post.position.set(originX + px, shelterHeight / 2, pz);
      post.material = timber;
      post.checkCollisions = true;
    }
  }

  // Three shooting benches under the shelter, spaced across the lane.
  for (const bx of [-2.4, 0, 2.4]) {
    const bench = MeshBuilder.CreateBox(`rangeBench_${bx}`, { width: 1.4, height: 0.9, depth: 0.6 }, scene);
    bench.position.set(originX + bx, 0.45, originZ - 0.6);
    bench.material = timber;
    bench.checkCollisions = true;
    const stool = MeshBuilder.CreateCylinder(`rangeStool_${bx}`, { diameter: 0.4, height: 0.5 }, scene);
    stool.position.set(originX + bx, 0.25, originZ - 1.6);
    stool.material = steel;
    stool.checkCollisions = true;
  }

  // Ammo crate near the firing point (scenery — the actual weapon-change control lives in the range UI).
  const crate = MeshBuilder.CreateBox("rangeAmmoCrate", { width: 0.9, height: 0.7, depth: 0.6 }, scene);
  crate.position.set(originX + LANE_HALF_WIDTH - 0.7, 0.35, originZ - 1.2);
  crate.material = olive;
  crate.checkCollisions = true;
  const crateLid = MeshBuilder.CreateBox("rangeAmmoCrateLid", { width: 0.94, height: 0.08, depth: 0.64 }, scene);
  crateLid.position.set(originX + LANE_HALF_WIDTH - 0.7, 0.74, originZ - 1.2);
  crateLid.material = solidMat(scene, "rangeCrateLidMat", new Color3(0.35, 0.38, 0.25));
  crateLid.isPickable = false;

  // --- Distance markers (25/50/100/200m) ---
  for (const d of RANGE_DISTANCES_M) {
    const z = originZ + d;
    const poleMat = solidMat(scene, `rangeMarkerPoleMat_${d}`, new Color3(0.9, 0.4, 0.1));
    const pole = MeshBuilder.CreateCylinder(`rangeMarkerPole_${d}`, { diameter: 0.14, height: 1.8 }, scene);
    pole.position.set(originX + LANE_HALF_WIDTH + 1.3, 0.9, z);
    pole.material = poleMat;
    pole.checkCollisions = true;

    const boardMat = new StandardMaterial(`rangeMarkerBoardMat_${d}`, scene);
    boardMat.diffuseTexture = numberBoardTexture(scene, `rangeMarkerTex_${d}`, `${d}M`);
    boardMat.specularColor = Color3.Black();
    boardMat.backFaceCulling = false;
    const board = MeshBuilder.CreatePlane(`rangeMarkerBoard_${d}`, { size: 0.7 }, scene);
    board.position.set(originX + LANE_HALF_WIDTH + 1.3, 1.7, z);
    board.material = boardMat;
    board.isPickable = false;

    // A short painted tick across the lane at each distance.
    const tick = MeshBuilder.CreateBox(`rangeMarkerTick_${d}`, { width: LANE_HALF_WIDTH * 2, height: 0.02, depth: 0.1 }, scene);
    tick.position.set(originX, 0.03, z);
    tick.material = paintMat;
    tick.isPickable = false;
  }

  // --- Sand berm backstop beyond the furthest marker ---
  const bermMat = sand;
  const berm = MeshBuilder.CreateBox("rangeBerm", { width: LANE_HALF_WIDTH * 2 + 10, height: 6, depth: 8 }, scene);
  berm.position.set(originX, 3, BERM_Z);
  berm.material = bermMat;
  berm.checkCollisions = true;
  // Sloped face toward the shooters — a wedge silhouette instead of a plain wall.
  const slope = MeshBuilder.CreateBox("rangeBermSlope", { width: LANE_HALF_WIDTH * 2 + 10, height: 0.3, depth: 9 }, scene);
  slope.position.set(originX, 2.9, BERM_Z - 4.5);
  slope.rotation.x = -0.7;
  slope.material = bermMat;
  slope.checkCollisions = true;

  // --- Target carriage: an empty node the RangeTargetController repositions/attaches meshes to ---
  const targetCarriage = new TransformNode("rangeTargetCarriage", scene);
  targetCarriage.position.set(originX, 0, originZ + RANGE_DISTANCES_M[0]);

  return { targetCarriage };
}
