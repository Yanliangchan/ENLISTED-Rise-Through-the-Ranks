import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  Mesh,
} from "@babylonjs/core";

/**
 * OPERATION IRON CITADEL — a single-floor tactical office CQB complex built
 * for the (future) multiplayer mode, NOT the bot-wave survival map.
 *
 * Design intent (from the Iron Citadel design doc): a captured military office
 * HQ that reads as multi-level but is ONE continuous walkable navigation
 * surface. Height differences are created purely with ramps, split-levels,
 * sunken rooms, mezzanines and raised platforms — no lifts, no multi-floor AI,
 * no separate nav layers. Every walkable slab/ramp/platform is tagged
 * `metadata.walkable = true` so the shared nav (`Nav.isNavigable`) accepts it
 * at any height; walls / cover / furniture stay untagged so they remain
 * blocking obstacles.
 *
 * The complex is built far out in +X (like the training range) so it can share
 * the scene without ever touching the city map. Nothing here is enemy/wave
 * aware — it's a self-contained arena a future multiplayer/free-roam mode
 * drops the player into. A preview free-roam entry (main.ts) lets the map be
 * walked and evaluated today.
 *
 * Elevation bands (one continuous mesh, joined by gentle ramps ≤ ~15°):
 *   Loading dock (sunken)     y = -1.2
 *   Reception / attacker spawn y =  0.0
 *   Office / atrium / rooms    y =  1.0   (up a ramp from reception)
 *   Server & ops mezzanines    y =  2.0
 *   Operations overwatch balcony y = 2.4  (up ramps from the office floor)
 */

/** Far-field origin so the complex never overlaps the city (±100) or the range (Z≈250+). */
const BASE = new Vector3(430, 0, 0);

// Interior footprint (local coords, centred on the BASE origin).
const HALF_W = 46; // X extent → 92m wide
const HALF_D = 34; // Z extent → 68m deep
const WALL_H = 5.5;
const WALL_T = 0.6;

// The whole main floor is flat at y=0 (one continuous surface); "levels" are
// created by platforms ABOVE it (balcony, mezzanine) and pits BELOW it (dock,
// courtyard) joined by gentle ramps. Keeping the main floor flat avoids
// fall-through gaps and head-bump traps while still delivering the multi-level
// read the design doc asks for.
const OFFICE_Y = 0.0; // main office floor
const BALCONY_Y = 2.4; // operations overwatch balcony (2.4m clearance to walk under)
const MEZZ_Y = 2.0; // server raised platform
const DOCK_Y = -1.4; // sunken loading dock
const COURT_Y = -1.0; // sunken indoor courtyard

export interface IronCitadelHandles {
  /** World-space player spawn (attacker reception staging). */
  spawn: Vector3;
  /** Container node for the whole complex — dispose to remove it. */
  root: TransformNode;
  /** Top-down footprints (world XZ) for a future radar/minimap. */
  footprints: Array<{ x: number; z: number; w: number; d: number; kind: string }>;
  dispose(): void;
}

function mat(scene: Scene, name: string, rgb: [number, number, number], emissive = 0.14, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = new Color3(rgb[0], rgb[1], rgb[2]);
  m.diffuseColor = c;
  // A little emissive so interior faces read even in flat/low light during preview.
  m.emissiveColor = c.scale(emissive);
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  if (alpha < 1) {
    m.alpha = alpha;
    m.backFaceCulling = false;
  }
  return m;
}

/**
 * Builds the whole Iron Citadel complex into `scene`. One-shot and static —
 * every mesh is frozen after placement. Returns handles (spawn + disposer).
 */
export function buildIronCitadel(scene: Scene): IronCitadelHandles {
  const root = new TransformNode("ironCitadel", scene);
  const footprints: IronCitadelHandles["footprints"] = [];

  // --- shared material palette (reused by every piece for cheap draw state) --
  const floorMat = mat(scene, "ic_floor", [0.34, 0.36, 0.4]); // dark carpet-tile
  const officeFloorMat = mat(scene, "ic_officefloor", [0.4, 0.41, 0.44]);
  const rampMat = mat(scene, "ic_ramp", [0.5, 0.47, 0.3], 0.18); // painted-metal ramp, reads distinctly
  const wallMat = mat(scene, "ic_wall", [0.78, 0.77, 0.73], 0.12); // off-white office wall
  const wallMat2 = mat(scene, "ic_wall2", [0.64, 0.66, 0.68], 0.12); // cool grey partition
  const glassMat = mat(scene, "ic_glass", [0.45, 0.6, 0.72], 0.1, 0.26); // meeting-room / window glass
  const pillarMat = mat(scene, "ic_pillar", [0.5, 0.5, 0.52], 0.1); // structural concrete
  const deskMat = mat(scene, "ic_desk", [0.55, 0.42, 0.28], 0.1); // laminate wood
  const cubicleMat = mat(scene, "ic_cubicle", [0.42, 0.46, 0.5], 0.1); // grey fabric partition
  const serverMat = mat(scene, "ic_server", [0.14, 0.15, 0.18], 0.08); // dark steel racks
  const serverLedMat = mat(scene, "ic_serverled", [0.2, 0.9, 0.5], 1.0); // glowing rack LEDs
  const cabinetMat = mat(scene, "ic_cabinet", [0.36, 0.38, 0.4], 0.1); // steel cabinet
  const sandbagMat = mat(scene, "ic_sandbag", [0.55, 0.5, 0.34], 0.12); // checkpoint sandbags (military)
  const oliveMat = mat(scene, "ic_olive", [0.28, 0.32, 0.2], 0.16); // objective / signage accent
  const counterMat = mat(scene, "ic_counter", [0.3, 0.33, 0.38], 0.12); // reception counter

  const meshes: Mesh[] = [];
  const add = (m: Mesh, walkable: boolean): Mesh => {
    m.position.addInPlace(BASE);
    m.parent = root;
    m.checkCollisions = true;
    m.isPickable = true;
    if (walkable) m.metadata = { ...(m.metadata ?? {}), walkable: true };
    m.freezeWorldMatrix();
    meshes.push(m);
    return m;
  };

  let idc = 0;
  const uid = (p: string) => `ic_${p}_${idc++}`;

  // ---- floor / walkable slab ------------------------------------------------
  const slab = (w: number, d: number, cx: number, cz: number, y: number, material: StandardMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("slab"), { width: w, height: 0.3, depth: d }, scene);
    m.position.set(cx, y - 0.15, cz);
    m.material = material;
    return add(m, true);
  };

  // ---- wall (blocking, not walkable) ---------------------------------------
  const wall = (w: number, d: number, cx: number, cz: number, y: number, h: number, material: StandardMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("wall"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, y + h / 2, cz);
    m.material = material;
    return add(m, false);
  };

  // ---- glass partition (blocking but see-through) --------------------------
  const glass = (w: number, d: number, cx: number, cz: number, y: number, h: number): Mesh => {
    const m = MeshBuilder.CreateBox(uid("glass"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, y + h / 2, cz);
    m.material = glassMat;
    return add(m, false);
  };

  // ---- prop (blocking cover, sits ON a floor) ------------------------------
  const prop = (w: number, h: number, d: number, cx: number, cz: number, floorY: number, material: StandardMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("prop"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, floorY + h / 2, cz);
    m.material = material;
    return add(m, false);
  };

  // ---- ramp: a gentle walkable incline from y0→y1 over `run` metres --------
  // axis "z": rises along +Z (or -Z if run<0). axis "x": rises along +X.
  const ramp = (
    w: number,
    run: number,
    cxOrCz: number, // the fixed cross-axis centre
    startCross: number, // start of the run on the moving axis
    y0: number,
    y1: number,
    axis: "x" | "z"
  ): Mesh => {
    const dh = y1 - y0;
    const len = Math.hypot(run, dh);
    const angle = Math.atan2(dh, run); // incline
    const runMid = startCross + run / 2;
    const yMid = (y0 + y1) / 2;
    const m = MeshBuilder.CreateBox(uid("ramp"), { width: axis === "z" ? w : len, height: 0.3, depth: axis === "z" ? len : w }, scene);
    if (axis === "z") {
      m.position.set(cxOrCz, yMid, runMid);
      m.rotation.x = -angle;
    } else {
      m.position.set(runMid, yMid, cxOrCz);
      m.rotation.z = angle;
    }
    m.material = rampMat;
    return add(m, true);
  };

  // ========================================================================
  // PERIMETER — enclosing walls (open-top; sun/ambient light the interior).
  // ========================================================================
  wall(HALF_W * 2 + WALL_T, WALL_T, 0, -HALF_D, 0, WALL_H, wallMat); // south (reception end)
  wall(HALF_W * 2 + WALL_T, WALL_T, 0, HALF_D, 0, WALL_H, wallMat); // north (objective end)
  wall(WALL_T, HALF_D * 2 + WALL_T, -HALF_W, 0, 0, WALL_H, wallMat); // west
  wall(WALL_T, HALF_D * 2 + WALL_T, HALF_W, 0, 0, WALL_H, wallMat); // east
  footprints.push({ x: BASE.x, z: BASE.z, w: HALF_W * 2, d: HALF_D * 2, kind: "complex" });

  // ========================================================================
  // MAIN FLOOR — one continuous flat y=0 surface, composed of slabs that leave
  // rectangular holes for the sunken loading dock (SE corner) and the sunken
  // indoor courtyard (atrium centre). Everything else stands on this floor.
  // ========================================================================
  // South band z[-34,-24], x[-46,24] (reception) — dock hole is x[24,46].
  slab(70, 10, -11, -29, OFFICE_Y, floorMat);
  // Main body z[-24,34], split around the courtyard hole (x[-6,6] z[-8,4]).
  slab(40, 58, -26, 5, OFFICE_Y, officeFloorMat); // west of courtyard
  slab(40, 58, 26, 5, OFFICE_Y, officeFloorMat); // east of courtyard
  slab(12, 16, 0, -16, OFFICE_Y, officeFloorMat); // south of courtyard
  slab(12, 30, 0, 19, OFFICE_Y, officeFloorMat); // north of courtyard

  // Sunken loading dock (SE corner), own floor + ramp down from reception.
  slab(22, 10, 35, -29, DOCK_Y, floorMat);
  ramp(5, 6, -29, 22, OFFICE_Y, DOCK_Y, "x"); // descends x[22,28] into the dock
  footprints.push({ x: BASE.x + 35, z: BASE.z - 29, w: 22, d: 10, kind: "dock" });

  // Sunken indoor courtyard (atrium centre) + a ramp down on its west edge.
  slab(12, 12, 0, -2, COURT_Y, floorMat);
  ramp(3.5, 4, -2, -6, OFFICE_Y, COURT_Y, "x"); // descends x[-6,-2] into the courtyard
  footprints.push({ x: BASE.x, z: BASE.z - 2, w: 12, d: 12, kind: "courtyard" });
  // Glass bridge across the courtyard at office level (connects W and E wings).
  const bridge = slab(14, 3.4, 0, -2, OFFICE_Y, officeFloorMat);
  bridge.material = counterMat;
  glass(14, 0.15, 0, -3.6, OFFICE_Y, 1.0); // balustrades
  glass(14, 0.15, 0, -0.4, OFFICE_Y, 1.0);

  // ========================================================================
  // RECEPTION / ATTACKER SPAWN (south) — spawn protection + multiple exits.
  // ========================================================================
  // Reception counter (soft cover, opening defence per doc).
  prop(10, 1.1, 1.4, -18, -30.5, 0, counterMat);
  prop(1.4, 1.1, 5, -23.5, -28, 0, counterMat); // counter return
  // One-way sight blockers flanking the spawn so you can't be shot on entry.
  wall(0.5, 6, -8, -31, 0, 3.2, wallMat2);
  wall(0.5, 6, 8, -31, 0, 3.2, wallMat2);
  // Hard cover in the staging area (planters / concrete blocks).
  prop(1.6, 1.0, 1.6, -3, -30, 0, pillarMat);
  prop(1.6, 1.0, 1.6, 3, -30, 0, pillarMat);
  footprints.push({ x: BASE.x, z: BASE.z - 31, w: 16, d: 6, kind: "spawn" });

  // ========================================================================
  // SECURITY CHECKPOINT (choke) — sandbags with 2 attack angles + flanks.
  // ========================================================================
  // Sandbag emplacements either side of a central gap, on the office floor.
  const sandbagLine = (cx: number, cz: number, len: number) => {
    for (let i = 0; i < len; i++) prop(1.2, 0.9, 1.0, cx, cz + (i - (len - 1) / 2) * 1.0, OFFICE_Y, sandbagMat);
  };
  sandbagLine(-4.5, -18, 4);
  sandbagLine(4.5, -18, 4);
  // Half-height partial cover in the gap itself.
  prop(2.0, 0.9, 0.6, 0, -18, OFFICE_Y, sandbagMat);
  // Checkpoint booth (hard cover pillar) offset to break the sightline.
  wall(2.2, 2.2, -11, -17, OFFICE_Y, 3.0, wallMat2);
  wall(2.2, 2.2, 11, -17, OFFICE_Y, 3.0, wallMat2);

  // ========================================================================
  // OFFICE WINGS (W & E) — cubicles (soft) + pillars (hard) + glass rooms.
  // ========================================================================
  const pillar = (cx: number, cz: number, floorY: number) => prop(1.1, WALL_H - floorY, 1.1, cx, cz, floorY, pillarMat);
  // structural pillar grid through the office floor (hard cover + sightline breaks)
  for (const px of [-30, -18, 18, 30]) for (const pz of [-10, 2, 14, 26]) pillar(px, pz, OFFICE_Y);

  // Cubicle cluster helper (a 2x2 block of chest-high partitions + desks).
  const cubicleCluster = (cx: number, cz: number) => {
    prop(6.5, 1.3, 0.15, cx, cz - 2.2, OFFICE_Y, cubicleMat); // back partition
    prop(0.15, 1.3, 4.4, cx - 3.2, cz, OFFICE_Y, cubicleMat); // side partition
    prop(0.15, 1.3, 4.4, cx, cz, OFFICE_Y, cubicleMat); // divider
    prop(2.6, 0.75, 1.2, cx - 1.6, cz + 1, OFFICE_Y, deskMat); // desk
    prop(2.6, 0.75, 1.2, cx + 1.6, cz + 1, OFFICE_Y, deskMat); // desk
  };
  // West wing cubicles
  cubicleCluster(-36, -8);
  cubicleCluster(-36, 6);
  cubicleCluster(-25, 20);
  // East wing cubicles
  cubicleCluster(36, -8);
  cubicleCluster(36, 6);
  footprints.push({ x: BASE.x - 33, z: BASE.z, w: 26, d: 40, kind: "west-wing" });
  footprints.push({ x: BASE.x + 33, z: BASE.z, w: 26, d: 40, kind: "east-wing" });

  // West glass meeting room (broken sightlines, close-quarters room).
  const meetingRoom = (cx: number, cz: number, w: number, d: number, doorSide: "n" | "s") => {
    glass(w, 0.15, cx, cz - d / 2, OFFICE_Y, 2.6); // south glass
    glass(0.15, d, cx - w / 2, cz, OFFICE_Y, 2.6); // west glass
    glass(0.15, d, cx + w / 2, cz, OFFICE_Y, 2.6); // east glass
    // north wall with a door gap
    if (doorSide === "n") {
      glass(w / 2 - 1, 0.15, cx - w / 4 - 0.5, cz + d / 2, OFFICE_Y, 2.6);
      glass(w / 2 - 1, 0.15, cx + w / 4 + 0.5, cz + d / 2, OFFICE_Y, 2.6);
    } else {
      glass(w, 0.15, cx, cz + d / 2, OFFICE_Y, 2.6);
    }
    prop(w - 2, 0.75, 1.4, cx, cz, OFFICE_Y, deskMat); // meeting table (cover)
  };
  meetingRoom(-38, 20, 12, 9, "n"); // west meeting room
  meetingRoom(38, 20, 12, 9, "n"); // east meeting room (exec-adjacent)

  // ========================================================================
  // OPERATIONS CENTRE (central atrium) — the main fight room, high & low.
  // ========================================================================
  // Central low cover around the sunken courtyard (planters / consoles).
  for (const [cx, cz] of [
    [-9, 6], [9, 6], [-9, -10], [9, -10],
  ] as const) {
    prop(2.2, 0.95, 1.2, cx, cz, OFFICE_Y, counterMat);
  }
  // Operations overwatch BALCONY: a raised catwalk ringing the north of the
  // atrium (high ground), reached by two ramps — exposed from both, flankable.
  slab(30, 4, 0, 12, BALCONY_Y, officeFloorMat); // balcony platform
  glass(30, 0.15, 0, 10, BALCONY_Y, 1.0); // balustrade (see-through, chest high)
  // balcony support pillars (visual + partial cover from below)
  for (const px of [-13, -4, 4, 13]) prop(0.8, BALCONY_Y - OFFICE_Y, 0.8, px, 13.5, OFFICE_Y, pillarMat);
  // ramps up to the balcony from the office floor (west & east), gentle ~15°.
  ramp(3.5, 9, -13, 1, OFFICE_Y, BALCONY_Y, "z");
  ramp(3.5, 9, 13, 1, OFFICE_Y, BALCONY_Y, "z");
  footprints.push({ x: BASE.x, z: BASE.z + 6, w: 30, d: 26, kind: "operations" });

  // ========================================================================
  // SERVER ROOM (NW) — power position: strong cover, 3 entrances, grenade-able.
  // ========================================================================
  // room walls (with three door gaps): south (2 gaps), east (1 gap)
  wall(9, WALL_T, -33, 14, OFFICE_Y, 3.4, wallMat2); // south-west segment
  wall(9, WALL_T, -17, 14, OFFICE_Y, 3.4, wallMat2); // south-east segment (gap between them = entrance 1)
  wall(WALL_T, 8, -10, 24, OFFICE_Y, 3.4, wallMat2); // east wall lower
  wall(WALL_T, 4, -10, 32, OFFICE_Y, 3.4, wallMat2); // east wall upper (gap = entrance 2)
  wall(WALL_T, 18, -40, 23, OFFICE_Y, 3.4, wallMat2); // west wall (against a service corridor door = entrance 3 at its north end)
  // server rack aisles (cover lanes, medium sightlines)
  for (let a = 0; a < 3; a++) {
    const rx = -34 + a * 8;
    prop(1.4, 2.2, 6, rx, 20, OFFICE_Y, serverMat);
    prop(1.5, 0.15, 6, rx, 20, OFFICE_Y + 2.2, serverLedMat); // rack-top LED strip glow
  }
  // raised server platform mezzanine (overwatch of the room), reached by a ramp
  slab(10, 5, -30, 28, MEZZ_Y, officeFloorMat);
  glass(10, 0.15, -30, 25.6, MEZZ_Y, 1.0); // balustrade
  ramp(3, 7, -37, 21, OFFICE_Y, MEZZ_Y, "z");
  footprints.push({ x: BASE.x - 27, z: BASE.z + 22, w: 30, d: 20, kind: "server" });

  // ========================================================================
  // COMMS / OPERATIONS HQ (N-centre) — objective room (intel + leadership).
  // ========================================================================
  wall(WALL_T, 14, -6, 25, OFFICE_Y, 3.4, wallMat); // west wall
  wall(WALL_T, 14, 20, 25, OFFICE_Y, 3.4, wallMat); // east wall
  wall(10, WALL_T, 2, 32, OFFICE_Y, 3.4, wallMat); // north wall (against perimeter)
  // doorway choke at the south (single controlled entrance + one flank via exec)
  wall(6, WALL_T, -3, 18, OFFICE_Y, 3.4, wallMat);
  wall(6, WALL_T, 17, 18, OFFICE_Y, 3.4, wallMat); // gap in the middle = doorway
  // objective: an intel table + comms consoles (partial cover)
  prop(4, 0.8, 2, 7, 26, OFFICE_Y, oliveMat); // intel / command table (objective marker colour)
  prop(1.4, 1.6, 0.8, 1, 30, OFFICE_Y, cabinetMat);
  prop(1.4, 1.6, 0.8, 13, 30, OFFICE_Y, cabinetMat);
  footprints.push({ x: BASE.x + 7, z: BASE.z + 25, w: 26, d: 14, kind: "comms-objective" });

  // ========================================================================
  // EXECUTIVE OFFICE (NE) — controls corridors, windows expose defenders.
  // ========================================================================
  wall(WALL_T, 16, 24, 24, OFFICE_Y, 3.4, wallMat); // west wall vs comms
  wall(14, WALL_T, 37, 16, OFFICE_Y, 3.4, wallMat); // south wall
  glass(0.2, 14, 44, 24, OFFICE_Y, 2.6); // east window wall (exposes occupants)
  prop(3.2, 0.75, 1.4, 38, 26, OFFICE_Y, deskMat); // exec desk (cover)
  prop(1.2, 1.4, 3, 30, 22, OFFICE_Y, cabinetMat); // filing cabinets (hard cover)
  footprints.push({ x: BASE.x + 37, z: BASE.z + 24, w: 18, d: 16, kind: "exec" });

  // ========================================================================
  // WEST SERVICE / MAINTENANCE CORRIDOR — long flank route (reception→server).
  // ========================================================================
  wall(WALL_T, 44, -42, 2, OFFICE_Y, 3.4, wallMat2); // inner corridor wall (perimeter is the outer)
  // scattered steel cabinets as intermittent cover down the corridor
  for (const cz of [-14, -2, 10]) prop(1.0, 1.6, 1.4, -44, cz, OFFICE_Y, cabinetMat);
  footprints.push({ x: BASE.x - 44, z: BASE.z, w: 6, d: 44, kind: "service-corridor" });

  // ========================================================================
  // CAFETERIA (SE, office level) — close-quarters furniture clusters.
  // ========================================================================
  wall(WALL_T, 12, 26, -8, OFFICE_Y, 3.4, wallMat2); // west wall
  wall(16, WALL_T, 38, -2, OFFICE_Y, 3.4, wallMat2); // north wall
  for (const [cx, cz] of [
    [32, -10], [40, -10], [32, -4], [40, -4],
  ] as const) {
    prop(2.0, 0.75, 2.0, cx, cz, OFFICE_Y, deskMat); // cafeteria tables
  }
  footprints.push({ x: BASE.x + 36, z: BASE.z - 7, w: 20, d: 14, kind: "cafeteria" });

  // Open-top complex: lit by the scene's existing global sun + hemispheric
  // light (directional/hemispheric lights are position-independent, so they
  // reach the far-field citadel too). Material emissive keeps shaded interior
  // faces readable without any dedicated interior lighting.

  return {
    spawn: new Vector3(BASE.x + 0, 1.2, BASE.z - 30), // reception staging, just above the y=0 floor
    root,
    footprints,
    dispose(): void {
      for (const m of meshes) m.dispose();
      root.dispose();
    },
  };
}
