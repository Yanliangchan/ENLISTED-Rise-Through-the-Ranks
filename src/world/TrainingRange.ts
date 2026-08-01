import {
  Scene,
  Mesh,
  MeshBuilder,
  DynamicTexture,
  Texture,
  Color3,
  Vector3,
  TransformNode,
} from "@babylonjs/core";
import { WorldMaterial } from "@/world/WorldMaterial";

/**
 * SAF-style outdoor live-fire range, built once far outside the main city
 * (well clear of its invisible boundary walls) so it can share the same
 * scene, camera, and weapon-hit pipeline as the main game without any of the
 * two ever overlapping. The player only ever arrives here by teleport from
 * the Training Range menu action, never on foot.
 *
 * Layout (all along +Z from the firing line):
 *
 *   covered firing point on a dirt apron
 *     │
 *     ├─ 5 grass firing lanes separated by low kerbs. The CENTRE lane (x=0)
 *     │  is the live one the target carriage runs down; it is kept clear of
 *     │  every prop — benches, posts, kerbs and lane boards all sit on the
 *     │  lane EDGES — so no geometry can ever eat a shot. Side lanes carry
 *     │  static A-frame target frames for depth.
 *     │
 *     ├─ distance markers down both flanks + per-lane number boards
 *     │
 *     └─ earth berm bullet stop spanning the full compound width
 *
 * There is deliberately NO flat back wall: the berm is the backstop, built
 * as a sloped earth face with a jittered crest so its silhouette reads as a
 * graded bank rather than a box. Everything here is static, shares a handful
 * of materials, and has its world matrix frozen, so the whole compound costs
 * a few dozen cheap draw calls.
 */
export const RANGE_FIRING_LINE = new Vector3(0, 0, 250);
/** Lane runs along +Z from the firing line. */
export const RANGE_DISTANCES_M = [25, 50, 100, 200] as const;

const LANE_HALF_WIDTH = 4;
/** Lane centres in X. The middle one (0) is the live lane. */
const LANE_XS = [-16, -8, 0, 8, 16] as const;
const LIVE_LANE_X = 0;
const BERM_Z = RANGE_FIRING_LINE.z + 215;
/** Half-width of the whole compound (grass field, side walls, berm span). */
const FIELD_HALF_W = 30;
const BERM_H = 9;
const BERM_DEPTH = 14;

/**
 * Mottled ground texture (grass / dirt / sand) — broad tonal blotches plus
 * fine speckle, which is enough to kill the flat-untextured look at the
 * grazing angles you actually view a range floor from.
 */
function groundTexture(
  scene: Scene,
  name: string,
  base: string,
  dark: string,
  light: string,
  speckles: number,
  uTile: number,
  vTile: number
): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = i % 2 === 0 ? dark : light;
    ctx.globalAlpha = 0.12 + Math.random() * 0.16;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 10 + Math.random() * 34, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < speckles; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? dark : light;
    const w = 1 + Math.random() * 2.5;
    ctx.fillRect(Math.random() * S, Math.random() * S, w, w);
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = uTile;
  tex.vScale = vTile;
  return tex;
}

function signTexture(
  scene: Scene,
  name: string,
  label: string,
  bg: string,
  fg: string,
  fontPx: number
): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = fg;
  ctx.font = `bold ${fontPx}px sans-serif`;
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
  const originX = RANGE_FIRING_LINE.x;
  const originZ = RANGE_FIRING_LINE.z;
  const laneLen = BERM_Z - originZ + 20;
  const fieldZ0 = originZ - 26;
  const fieldZ1 = BERM_Z + 26;

  // ---- shared materials -------------------------------------------------
  const solid = (name: string, color: Color3): WorldMaterial => {
    const mat = new WorldMaterial(name, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    return mat;
  };

  // CreateGround UVs run 0..1 across the whole mesh regardless of its real
  // size, so a single shared tiling would smear badly on the long thin lane
  // strips while looking fine on the square-ish field. Each ground surface
  // therefore gets its own material tiled to roughly 2m per texture repeat
  // in BOTH axes, which is what keeps the grass from streaking.
  const grass = solid("rangeGrassMat", new Color3(0.42, 0.5, 0.28));
  grass.diffuseTexture = groundTexture(scene, "rangeGrassTex", "#5d6b3c", "#3f4d27", "#7d8a52", 2600, 30, 150);
  const grassProp = solid("rangeGrassPropMat", new Color3(0.42, 0.5, 0.28)); // mounds/tufts (sphere UVs)
  grassProp.diffuseTexture = groundTexture(scene, "rangeGrassPropTex", "#5d6b3c", "#3f4d27", "#7d8a52", 2600, 3, 3);
  const grassLane = solid("rangeGrassLaneMat", new Color3(0.46, 0.54, 0.31)); // mown lane — a shade lighter
  grassLane.diffuseTexture = groundTexture(scene, "rangeGrassLaneTex", "#66744a", "#48562f", "#87945c", 2200, 4, 134);
  const dirt = solid("rangeDirtMat", new Color3(0.52, 0.44, 0.33));
  dirt.diffuseTexture = groundTexture(scene, "rangeDirtTex", "#7a6448", "#5b4a34", "#98815e", 2000, 26, 9);
  const dirtPatch = solid("rangeDirtPatchMat", new Color3(0.52, 0.44, 0.33));
  dirtPatch.diffuseTexture = groundTexture(scene, "rangeDirtPatchTex", "#7a6448", "#5b4a34", "#98815e", 2000, 3, 3);
  const sand = solid("rangeSandMat", new Color3(0.66, 0.58, 0.42));
  sand.diffuseTexture = groundTexture(scene, "rangeSandTex", "#947f5c", "#71603f", "#b09a76", 1500, 6, 4);
  // The flank banks are ~5m wide but run the whole length of the range, so
  // they need their own heavily V-tiled sand or the texture smears into
  // vertical streaks along that 260m face.
  const sandBank = solid("rangeSandBankMat", new Color3(0.66, 0.58, 0.42));
  sandBank.diffuseTexture = groundTexture(scene, "rangeSandBankTex", "#947f5c", "#71603f", "#b09a76", 1500, 3, 130);
  const concrete = solid("rangeConcreteMat", new Color3(0.55, 0.55, 0.52));
  const timber = solid("rangeTimberMat", new Color3(0.4, 0.3, 0.2));
  const steel = solid("rangeSteelMat", new Color3(0.3, 0.32, 0.34));
  const roofMat = solid("rangeRoofMat", new Color3(0.22, 0.25, 0.21));
  const paintMat = solid("rangeLaneMarkMat", new Color3(0.88, 0.86, 0.8));
  const olive = solid("rangeOliveMat", new Color3(0.28, 0.32, 0.2));
  const crateLidMat = solid("rangeCrateLidMat", new Color3(0.35, 0.38, 0.25));
  const poleMat = solid("rangeMarkerPoleMat", new Color3(0.9, 0.4, 0.1));
  const flagMat = solid("rangeFlagMat", new Color3(0.72, 0.14, 0.12));

  /**
   * Every static piece funnels through here, so nothing escapes the
   * freeze/pickable discipline. Rotation is applied BEFORE the freeze —
   * a frozen world matrix ignores later transform edits.
   */
  const place = (mesh: Mesh, mat: WorldMaterial, collide: boolean, rot?: Vector3): Mesh => {
    mesh.material = mat;
    mesh.checkCollisions = collide;
    mesh.isPickable = false;
    if (rot) mesh.rotation.copyFrom(rot);
    mesh.freezeWorldMatrix();
    return mesh;
  };

  const box = (
    name: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: WorldMaterial,
    collide = true,
    rot?: Vector3
  ): Mesh => {
    const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z);
    return place(m, mat, collide, rot);
  };

  const pad = (name: string, w: number, d: number, x: number, y: number, z: number, mat: WorldMaterial, rotY = 0): Mesh => {
    const g = MeshBuilder.CreateGround(name, { width: w, height: d }, scene);
    g.position.set(x, y, z);
    return place(g, mat, false, new Vector3(0, rotY, 0));
  };

  // =========================================================================
  // TERRAIN — grass field, dirt firing apron, grass↔dirt transitions, mounds
  // =========================================================================
  const field = MeshBuilder.CreateGround("rangeField", { width: FIELD_HALF_W * 2, height: fieldZ1 - fieldZ0 }, scene);
  field.position.set(originX, 0, (fieldZ0 + fieldZ1) / 2);
  place(field, grass, true);

  // Dirt apron under and behind the firing point, where boots and muzzle
  // blast have killed the grass off.
  pad("rangeApron", FIELD_HALF_W * 2 - 8, 18, originX, 0.02, originZ - 6, dirt);

  // Grass→dirt transition: ragged patches feathering downrange so the apron
  // doesn't end on a hard rectangular edge.
  for (let i = 0; i < 14; i++) {
    pad(
      `rangeDirtPatch_${i}`,
      3 + Math.random() * 7,
      3 + Math.random() * 7,
      originX + (Math.random() * 2 - 1) * (FIELD_HALF_W - 8),
      0.015,
      originZ + 3 + Math.random() * 26,
      dirtPatch,
      Math.random() * Math.PI
    );
  }

  // Natural terrain variation: low grassy mounds scattered OUTSIDE the lane
  // block (|x| > 20) so they can never obstruct a firing lane.
  for (let i = 0; i < 18; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const mound = MeshBuilder.CreateSphere(`rangeMound_${i}`, { diameter: 4 + Math.random() * 7, segments: 6 }, scene);
    mound.position.set(
      originX + side * (22 + Math.random() * 6),
      -1.2 - Math.random() * 0.9,
      originZ + 10 + Math.random() * (laneLen - 40)
    );
    mound.scaling.y = 0.3;
    place(mound, grassProp, false);
  }

  // =========================================================================
  // FIRING LANES — five lanes, mown strips, painted lines, kerb separators
  // =========================================================================
  box("rangeFireStripe", FIELD_HALF_W * 2 - 10, 0.02, 0.3, originX, 0.05, originZ, paintMat, false);

  for (const lx of LANE_XS) {
    pad(`rangeLaneStrip_${lx}`, LANE_HALF_WIDTH * 2, laneLen - 12, originX + lx, 0.03, originZ + (laneLen - 12) / 2, grassLane);
    for (const side of [-1, 1]) {
      box(
        `rangeLaneLine_${lx}_${side}`,
        0.12,
        0.02,
        laneLen - 16,
        originX + lx + side * LANE_HALF_WIDTH,
        0.05,
        originZ + (laneLen - 16) / 2,
        paintMat,
        false
      );
    }
  }

  // Knee-height kerbs BETWEEN lanes (never on a lane centre), so they divide
  // the lanes without blocking sightlines down the range.
  for (let i = 0; i < LANE_XS.length - 1; i++) {
    const kx = (LANE_XS[i] + LANE_XS[i + 1]) / 2;
    box(`rangeLaneKerb_${i}`, 0.5, 0.35, laneLen - 20, originX + kx, 0.175, originZ + (laneLen - 20) / 2, concrete);
  }

  // =========================================================================
  // SIDE SAFETY WALLS — revetments down the outer flanks, set well outside
  // the outermost lane (lanes end at |x|=20; these sit at |x|=24).
  // =========================================================================
  for (const side of [-1, 1]) {
    const wx = originX + side * (FIELD_HALF_W - 6);
    const midZ = originZ + (laneLen - 10) / 2;
    box(`rangeSafetyWall_${side}`, 1.2, 2.4, laneLen - 10, wx, 1.2, midZ, concrete);
    // Sloped earth backing so the wall sits in the terrain, not on it.
    box(`rangeSafetyBank_${side}`, 5, 2.6, laneLen - 10, wx + side * 2.6, 1.0, midZ, sandBank, true, new Vector3(0, 0, side * 0.35));
    // Buttress posts breaking up the wall's long unmodulated run.
    for (let z = originZ + 6; z < BERM_Z - 6; z += 15) {
      box(`rangeWallPost_${side}_${z}`, 0.5, 2.7, 0.5, wx - side * 0.5, 1.35, z, concrete, false);
    }
    // Red range-in-use pennants along the flank.
    for (let z = originZ + 20; z < BERM_Z - 10; z += 45) {
      box(`rangeFlagPole_${side}_${z}`, 0.1, 2.4, 0.1, wx - side * 1.2, 1.2, z, steel, false);
      box(`rangeFlag_${side}_${z}`, 0.05, 0.5, 0.8, wx - side * 1.55, 2.05, z, flagMat, false);
    }
  }

  // =========================================================================
  // COVERED FIRING POINT — roof on posts, benches, ammo crates
  // =========================================================================
  // Generously tall clearance (well above head height even before the
  // player's spawn height has settled to the ground) so the shelter can
  // never clip a shot fired from directly underneath it.
  const shelterDepth = 4;
  const shelterHeight = 4.4;
  const shelterZ = originZ - shelterDepth / 2 + 1;
  const shelterHalfW = 22;
  box("rangeShelterRoof", shelterHalfW * 2, 0.2, shelterDepth + 1, originX, shelterHeight, shelterZ, roofMat);
  for (let bx = -shelterHalfW + 2; bx <= shelterHalfW - 2; bx += 4) {
    box(`rangeRoofBatten_${bx}`, 0.16, 0.16, shelterDepth + 1, originX + bx, shelterHeight - 0.18, shelterZ, timber, false);
  }
  // Posts sit on the lane kerb lines (|x| = 4, 12) and the shelter ends —
  // never on a lane centreline.
  for (const px of [-shelterHalfW + 1, -12, -4, 4, 12, shelterHalfW - 1]) {
    for (const pz of [shelterZ - shelterDepth / 2, shelterZ + shelterDepth / 2]) {
      box(`rangeShelterPost_${px}_${pz}`, 0.25, shelterHeight, 0.25, originX + px, shelterHeight / 2, pz, timber);
    }
  }

  // Two shooting benches per lane, flanking the lane centreline so the live
  // lane's own firing position stays completely unobstructed.
  for (const lx of LANE_XS) {
    for (const off of [-2.4, 2.4]) {
      box(`rangeBench_${lx}_${off}`, 1.4, 0.9, 0.6, originX + lx + off, 0.45, originZ - 0.6, timber);
      const stool = MeshBuilder.CreateCylinder(`rangeStool_${lx}_${off}`, { diameter: 0.4, height: 0.5 }, scene);
      stool.position.set(originX + lx + off, 0.25, originZ - 1.6);
      place(stool, steel, true);
    }
  }

  // Ammo crates behind the firing point (scenery — the real weapon-change
  // control lives in the range UI).
  for (const cx of [-19, 19]) {
    box(`rangeAmmoCrate_${cx}`, 0.9, 0.7, 0.6, originX + cx, 0.35, originZ - 3.2, olive);
    box(`rangeAmmoCrateLid_${cx}`, 0.94, 0.08, 0.64, originX + cx, 0.74, originZ - 3.2, crateLidMat, false);
  }

  // =========================================================================
  // LANE NUMBER BOARDS — one per lane, mounted on the lane's LEFT kerb line
  // (never the centreline) and facing back toward the firing point.
  // =========================================================================
  // A CreatePlane's front face already looks back down -Z toward the firing
  // point, so it is left UNROTATED — rotating it by PI would show its back
  // and render the number mirrored.
  LANE_XS.forEach((lx, i) => {
    const bx = originX + lx - LANE_HALF_WIDTH + 0.5;
    const bz = originZ + 14;
    const boardMat = solid(`rangeLaneNumMat_${i}`, Color3.White());
    boardMat.diffuseTexture = signTexture(scene, `rangeLaneNumTex_${i}`, String(i + 1), "#161a14", "#e8efe2", 84);
    boardMat.backFaceCulling = false;
    const board = MeshBuilder.CreatePlane(`rangeLaneNum_${i}`, { size: 0.85 }, scene);
    board.position.set(bx, 2.2, bz);
    place(board, boardMat, false);
    box(`rangeLaneNumPost_${i}`, 0.12, 2.2, 0.12, bx, 1.1, bz, timber, false);
  });

  // =========================================================================
  // TARGET FRAMES — static A-frames in the side lanes at each distance. The
  // live centre lane is deliberately skipped: its target is the real
  // relocatable RangeTargetController rig riding on the carriage.
  // =========================================================================
  for (const lx of LANE_XS) {
    if (lx === LIVE_LANE_X) continue;
    for (const d of RANGE_DISTANCES_M) {
      const z = originZ + d;
      for (const side of [-1, 1]) {
        box(
          `rangeFrameLeg_${lx}_${d}_${side}`,
          0.12, 2.2, 0.12,
          originX + lx + side * 0.75, 1.1, z,
          timber, true, new Vector3(0, 0, side * 0.08)
        );
      }
      box(`rangeFrameTop_${lx}_${d}`, 1.8, 0.12, 0.12, originX + lx, 2.15, z, timber, false);
      box(`rangeFrameFace_${lx}_${d}`, 1.5, 1.5, 0.04, originX + lx, 1.35, z, paintMat);
      // Rear brace, so the frame doesn't read as a floating plank.
      box(`rangeFrameBrace_${lx}_${d}`, 0.1, 2.4, 0.1, originX + lx, 1.1, z + 0.7, timber, false, new Vector3(0.35, 0, 0));
    }
  }

  // =========================================================================
  // DISTANCE MARKERS — boards down BOTH flanks (outside the lane block) so
  // the range reads correctly from any lane.
  // =========================================================================
  for (const d of RANGE_DISTANCES_M) {
    const z = originZ + d;
    const boardMat = solid(`rangeMarkerBoardMat_${d}`, Color3.White());
    boardMat.diffuseTexture = signTexture(scene, `rangeMarkerTex_${d}`, `${d}M`, "#c0392b", "#f4f0e8", 40);
    boardMat.backFaceCulling = false;

    for (const side of [-1, 1]) {
      const mx = originX + side * (FIELD_HALF_W - 9);
      const pole = MeshBuilder.CreateCylinder(`rangeMarkerPole_${d}_${side}`, { diameter: 0.14, height: 1.8 }, scene);
      pole.position.set(mx, 0.9, z);
      place(pole, poleMat, true);

      const board = MeshBuilder.CreatePlane(`rangeMarkerBoard_${d}_${side}`, { size: 0.9 }, scene);
      board.position.set(mx, 1.9, z);
      place(board, boardMat, false); // unrotated: already faces the firing point
    }

    // Painted ground tick across each lane at this distance.
    for (const lx of LANE_XS) {
      box(`rangeMarkerTick_${d}_${lx}`, LANE_HALF_WIDTH * 2, 0.02, 0.12, originX + lx, 0.05, z, paintMat, false);
    }
  }

  // =========================================================================
  // EARTH BERM BULLET STOP — replaces the old flat back wall.
  //
  // Built per-chunk across the width rather than as one slab: each chunk is
  // an independently jittered wedge (sloped face + body behind it) whose
  // height and slope vary, so the crest line undulates and the whole bank
  // reads as graded earth. A single tall box — however it is textured —
  // always reads as the wall this is meant to replace.
  //
  // Chunk geometry: a face box of length L tilted by THETA has its low edge
  // on the ground and its high edge at the crest when L = h / sin(THETA),
  // which is what keeps every chunk seated in the terrain with no gap and
  // no floating slab.
  // =========================================================================
  const THETA = 0.58; // ~33° — a real bullet-stop slope, not a cliff
  const SIN_T = Math.sin(THETA);
  const COS_T = Math.cos(THETA);
  const CHUNKS = 16;
  const chunkW = (FIELD_HALF_W * 2) / CHUNKS;

  for (let i = 0; i < CHUNKS; i++) {
    const cx = originX - FIELD_HALF_W + chunkW * (i + 0.5);
    // Height eases up toward the centre (where the lanes are) and varies.
    const centreBias = 1 - Math.abs(i - (CHUNKS - 1) / 2) / ((CHUNKS - 1) / 2);
    const h = BERM_H * (0.72 + centreBias * 0.2) + (Math.random() - 0.5) * 1.1;
    const L = h / SIN_T;
    const faceZ = BERM_Z - (L / 2) * COS_T;

    // Sloped face — what rounds actually strike. Chunks overlap generously
    // in X so the joins between them don't read as vertical seams.
    box(
      `rangeBermFace_${i}`,
      chunkW * 1.3, 0.7, L,
      cx, h / 2, faceZ,
      sand, true, new Vector3(-THETA, 0, 0)
    );
    // Body behind the crest, carrying the bank back to full depth.
    box(
      `rangeBermBody_${i}`,
      chunkW * 1.3, h, BERM_DEPTH,
      cx, h / 2, BERM_Z + BERM_DEPTH / 2 - 0.5,
      sand
    );
    // Low rounded cap that just softens the crest edge — kept flat and wide,
    // since a tall cap reads as a row of pillows sitting on the bank.
    const cap = MeshBuilder.CreateSphere(`rangeBermCap_${i}`, { diameter: chunkW * (1.5 + Math.random() * 0.4), segments: 6 }, scene);
    cap.position.set(cx, h - 0.42, BERM_Z + 0.1 + Math.random() * 0.5);
    cap.scaling.y = 0.16;
    cap.scaling.z = 0.7;
    place(cap, sand, false);
  }

  // Grass creeping over the crest and down the back — an earth bank in
  // service is never bare sand all the way up.
  for (let i = 0; i < 20; i++) {
    const tuft = MeshBuilder.CreateSphere(`rangeBermTuft_${i}`, { diameter: 2.4 + Math.random() * 3.4, segments: 5 }, scene);
    tuft.position.set(
      originX - FIELD_HALF_W + Math.random() * FIELD_HALF_W * 2,
      BERM_H * 0.72 + Math.random() * 1.4,
      BERM_Z + 1.5 + Math.random() * 7
    );
    tuft.scaling.y = 0.3;
    place(tuft, grassProp, false);
  }

  // Toe of the berm: churned dirt where the slope meets the grass.
  pad("rangeBermToe", FIELD_HALF_W * 2, 10, originX, 0.03, BERM_Z - (BERM_H / SIN_T) * COS_T * 0.95, dirtPatch);

  // --- Target carriage: an empty node the RangeTargetController repositions/attaches meshes to ---
  const targetCarriage = new TransformNode("rangeTargetCarriage", scene);
  targetCarriage.position.set(originX + LIVE_LANE_X, 0, originZ + RANGE_DISTANCES_M[0]);

  return { targetCarriage };
}
