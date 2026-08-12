import { Scene, Mesh, MeshBuilder, TransformNode, Vector3, Color3, PointLight, VertexBuffer } from "@babylonjs/core";
import { mulberry32 } from "@/world/Level";
import { buildTerminalMats, type TerminalMats } from "@/world/TerminalSurfaces";
import { buildTerminalFoliage, type FoliagePatch } from "@/world/TerminalFoliage";

/**
 * PASIR PANJANG TERMINAL — the venue for both Operations (Strongpoint Assault
 * and the Ranger Gauntlet). A working PSA container terminal on Singapore's
 * southwestern coast, fought through at night.
 *
 * Everything here parents to one `root` TransformNode so main.ts can toggle
 * the whole map with a single setEnabled — which is also why this file builds
 * its own props instead of reusing Level.ts's builders: those create meshes at
 * the scene root with no parent, so they'd stay visible after the map is
 * switched away.
 *
 * ---------------------------------------------------------------------------
 * NAV CONTRACT (Nav.ts drops a ray from y=200 and inspects the first mesh that
 * is enabled, `isPickable` and `checkCollisions`) — and, not coincidentally,
 * `WeaponController.raycastShot` uses the same `isPickable` test to decide
 * what a bullet can hit. Every mesh here picks one of four roles, and both the
 * map's AI navigability AND what a shot can stop on follow from that choice:
 *
 *   solid cover      pickable + collides                  → blocks nav AND stops bullets
 *                                                            (containers, walls, tanks, sandbags)
 *   walkable surface pickable + collides + walkable tag    → navigable at any height, and — being
 *                                                            solid — also stops bullets (floors, decks)
 *   roof over interior  NOT pickable + collides            → ray passes through to the floor below, so
 *                                                            the interior stays navigable; still stops
 *                                                            anyone walking in from above, but a bullet
 *                                                            passes through it same as the nav ray does
 *   visual only      NOT pickable + NO collision           → wholly invisible to nav, movement, AND
 *                                                            gunfire (handrails, pipes, cables, signage,
 *                                                            and the ground-decal surface painting layer)
 *
 * Nothing here is pickable-but-non-colliding: that combination used to mean
 * "stops bullets but not movement", and at the density this map places thin
 * dressing (a cable span or wire obstacle across nearly every sightline) that
 * silently ate rounds aimed at whatever was standing behind them. Real cover
 * you can hide behind should also be cover a bullet can't pass through, and
 * vice versa — the two properties are deliberately no longer independent.
 *
 * The one rule with no workaround: a walkable roof and a navigable interior
 * cannot share an (x,z) column, because the ray stops at whichever is on top.
 * Interiors won, so rooftops here are non-pickable and verticality comes from
 * open decks, catwalks and the Bukit Chandu ridge instead.
 *
 * Vegetation lives in TerminalFoliage.ts and is thin-instanced and
 * non-colliding, so it can be dense without ever affecting navigation.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** One layer of a strongpoint's defence. Cleared in order; the next only spawns once this one is dead. */
export interface StrongpointPhaseDef {
  /** Shown on the objective HUD while this layer is the live one. */
  label: string;
  /** Where this layer's defenders stand. Cycled over, so more anchors than types spreads them wider. */
  anchors: Vector3[];
  enemyTypes: string[];
  /** Constant "wave number" fed to EnemyManager's existing health/accuracy scaling. */
  difficultyWave: number;
  /** Marks the layer as an Elite spawn — scales health/damage/reward. Reserved for final holdouts. */
  elite?: boolean;
}

export interface TerminalStrongpointDef {
  id: string;
  /** Real feature of the Pasir Panjang / Telok Blangah coast this objective is built on. */
  name: string;
  /** Approach marker + HUD anchor. Also the point the activation radius is measured from. */
  center: Vector3;
  /** How close the player must get before the garrison stands to. */
  activationRadiusM: number;
  phases: StrongpointPhaseDef[];
  /**
   * Gated objectives stay locked until every ungated strongpoint is cleared —
   * used for Bukit Chandu so the operation ends on its strongest position
   * rather than wherever the player happened to wander first.
   */
  requiresAll?: boolean;
}

export interface PasirPanjangHandles {
  root: TransformNode;
  spawn: Vector3;
  strongpointDefs: TerminalStrongpointDef[];
}

/** Landing point — the seaward end of the container wharf, facing inland. */
export const TERMINAL_SPAWN = new Vector3(0, 2, -116);

/** Half-extent of the terminal's navigable square (see MapProfile.playableHalfM). */
export const TERMINAL_HALF_M = 130;

const G = { A: -72, B: 72, C: -68, D: 0 }; // objective X anchors, kept as named constants so layout edits stay legible

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

/**
 * Four objectives, each with its own combat character so no two play alike,
 * and each layered outer → interior → holdout so they take real work to clear.
 * Bukit Chandu is gated behind the other three (see `requiresAll`) — it is the
 * culmination, not a fourth interchangeable stop.
 *
 * Every anchor below is verified to resolve to navigable ground (see the
 * anchor probe in the verification pass) — moving one means re-checking it.
 */
const STRONGPOINT_DEFS: TerminalStrongpointDef[] = [
  {
    id: "distripark",
    name: "Keppel Distripark",
    // In the lane rather than dead-centre of the yard: nothing spawns at a
    // strongpoint's centre (only at its phase anchors), but it is the point the
    // activation radius measures from, so it should be somewhere a player can
    // actually stand rather than inside a container stack.
    center: new Vector3(-67.5, 0, -50),
    activationRadiusM: 32,
    phases: [
      {
        label: "PERIMETER",
        anchors: [new Vector3(G.A + 22, 0, -70), new Vector3(G.A + 18, 0, -34), new Vector3(G.A - 20, 0, -66)],
        enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_grunt", "opfor_marksman"],
        difficultyWave: 5,
      },
      {
        // Long container lanes — marksman country. The player has to break
        // sightlines lane by lane rather than push straight up the middle.
        // Placed in the cross-lanes between stacks (blocks 1201/1202/1203), so
        // the squad holds the gaps the player has to cross rather than
        // standing inside a container.
        label: "CONTAINER LANES",
        anchors: [new Vector3(-67.5, 0, -57), new Vector3(-97.5, 0, -48), new Vector3(G.A - 22, 0, -40)],
        enemyTypes: ["opfor_marksman", "opfor_marksman", "opfor_grunt", "opfor_grunt", "opfor_officer"],
        difficultyWave: 7,
      },
      {
        label: "STACK KEEP",
        anchors: [new Vector3(G.A - 26, 0, -22), new Vector3(G.A - 14, 0, -26)],
        enemyTypes: ["opfor_heavy", "opfor_marksman", "opfor_grunt", "opfor_grunt"],
        difficultyWave: 9,
      },
    ],
  },
  {
    id: "wharves",
    name: "Pasir Panjang Wharves",
    center: new Vector3(G.B, 0, -48),
    activationRadiusM: 30,
    phases: [
      {
        label: "LOADING BAYS",
        anchors: [new Vector3(G.B - 18, 0, -62), new Vector3(G.B + 16, 0, -64), new Vector3(G.B - 6, 0, -78)],
        enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_grunt", "opfor_grunt"],
        difficultyWave: 5,
      },
      {
        // Inside the sheds: short lanes, blind corners, no room to back off.
        // Heavy-weighted because the player can't hold them at range here.
        label: "TRANSIT SHEDS",
        anchors: [new Vector3(G.B - 14, 0, -48), new Vector3(G.B + 12, 0, -44), new Vector3(G.B, 0, -54)],
        enemyTypes: ["opfor_heavy", "opfor_grunt", "opfor_grunt", "opfor_grunt", "opfor_grunt"],
        difficultyWave: 8,
      },
      {
        label: "SHED 3 OFFICE",
        anchors: [new Vector3(G.B, 0, -26), new Vector3(G.B - 12, 0, -20)],
        enemyTypes: ["opfor_heavy", "opfor_heavy", "opfor_officer", "opfor_grunt"],
        difficultyWave: 10,
      },
    ],
  },
  {
    id: "powerstation",
    name: "Pasir Panjang Power Station",
    center: new Vector3(G.C, 0, 52),
    activationRadiusM: 32,
    phases: [
      {
        label: "SWITCHYARD",
        anchors: [new Vector3(G.C + 20, 0, 34), new Vector3(G.C - 18, 0, 40), new Vector3(G.C + 4, 0, 25)],
        enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_marksman", "opfor_grunt"],
        difficultyWave: 7,
      },
      {
        // Anchors sit ON the three level-2 decks (see buildPowerStation), not
        // merely near them — spawnGroupAt preserves the anchor's height, so a
        // deck anchor puts the defender on the deck.
        label: "TURBINE DECK",
        anchors: [new Vector3(G.C - 18, 6, 52), new Vector3(G.C + 18, 6, 50), new Vector3(G.C, 6, 68)],
        enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_marksman", "opfor_heavy", "opfor_grunt"],
        difficultyWave: 9,
      },
      {
        label: "CONTROL ROOM",
        anchors: [new Vector3(G.C - 4, 12, 62), new Vector3(G.C + 6, 12, 60)],
        enemyTypes: ["opfor_officer", "opfor_heavy", "opfor_marksman", "opfor_grunt"],
        difficultyWave: 11,
      },
    ],
  },
  {
    id: "bukitchandu",
    name: "Bukit Chandu",
    center: new Vector3(G.D, 0, 98),
    activationRadiusM: 34,
    // The last stand of the Malay Regiment in 1942 — held here as the
    // operation's culminating objective, and locked until the terminal below
    // it is clear.
    requiresAll: true,
    phases: [
      {
        label: "OUTER WALL",
        anchors: [new Vector3(-24, 0, 78), new Vector3(24, 0, 78), new Vector3(0, 0, 74)],
        enemyTypes: ["opfor_grunt", "opfor_grunt", "opfor_marksman", "opfor_grunt", "opfor_grunt"],
        difficultyWave: 10,
      },
      {
        // Between the courtyard bunkers, not inside them.
        label: "COURTYARD",
        anchors: [new Vector3(-16, 3, 96), new Vector3(16, 3, 96), new Vector3(0, 3, 84)],
        enemyTypes: ["opfor_heavy", "opfor_marksman", "opfor_grunt", "opfor_grunt", "opfor_officer"],
        difficultyWave: 12,
      },
      {
        label: "RIDGE BUNKER",
        anchors: [new Vector3(-10, 6, 110), new Vector3(10, 6, 110), new Vector3(0, 6, 114)],
        enemyTypes: ["opfor_heavy", "opfor_heavy", "opfor_officer", "opfor_marksman", "opfor_grunt", "opfor_grunt"],
        difficultyWave: 14,
        elite: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Primitives — every mesh in the map goes through one of these, so the nav
// contract above is enforced in exactly five places.
// ---------------------------------------------------------------------------

let uid = 0;
type Mats = TerminalMats;

/**
 * Rescales a mesh's UVs so texel density stays roughly constant regardless of
 * how big the mesh is. Without this a 30m shed wall and a 2m barrier sharing
 * one material show wildly different grain, which is the tell that gives away
 * a procedurally built level.
 */
function scaleUV(mesh: Mesh, s: number): void {
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uvs) return;
  for (let i = 0; i < uvs.length; i++) uvs[i] *= s;
  mesh.updateVerticesData(VertexBuffer.UVKind, uvs);
}

/** Solid cover: blocks bullets, movement and AI pathing. */
function solid(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: unknown, rotY = 0): Mesh {
  const m = MeshBuilder.CreateBox(`pp_${name}_${uid++}`, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.material = mat as Mesh["material"];
  m.checkCollisions = true;
  m.parent = root;
  scaleUV(m, Math.max(0.5, Math.max(w, d, h) / 4));
  return m;
}

/** A surface the player and AI can stand on, at any height. */
function walkable(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: unknown, rotY = 0): Mesh {
  const m = solid(root, scene, name, w, h, d, x, y, z, mat, rotY);
  m.metadata = { walkable: true };
  return m;
}

/** Roof over a navigable interior — invisible to the nav ray so the floor below still resolves. */
function roofPanel(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: unknown): Mesh {
  const m = solid(root, scene, name, w, h, d, x, y, z, mat);
  m.isPickable = false;
  return m;
}

/**
 * Thin visual dressing — cables, pipes, rails, wire, sign posts, lamp arms.
 * Never blocks movement, pathing, OR gunfire: `WeaponController.raycastShot`
 * stops on the first `isPickable` mesh it hits with no requirement that the
 * mesh actually collides, so a pickable prop with no hitbox would otherwise
 * silently eat rounds aimed at whatever is standing behind it. At the density
 * this map places dressing (a cable span or wire obstacle across nearly every
 * sightline), that turned into shots that visibly missed nothing but still
 * failed to register — real cover (`solid()`) still stops bullets exactly as
 * before; this is detail the eye reads but a bullet passes straight through.
 *
 * Tagged mergeable: with no collision, no navigation role and no pick role,
 * the optimisation pass at the end of the build is free to weld it all into
 * one mesh per material without changing any behaviour (see optimiseTerminal)
 * — and because it's non-pickable, weapon raycasts skip the whole merged mesh
 * for free rather than testing every shot against it.
 */
function decor(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: unknown, rotY = 0): Mesh {
  const m = MeshBuilder.CreateBox(`pp_${name}_${uid++}`, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.material = mat as Mesh["material"];
  m.checkCollisions = false;
  m.isPickable = false;
  m.parent = root;
  m.metadata = { mergeable: true };
  scaleUV(m, Math.max(0.5, Math.max(w, d, h) / 4));
  return m;
}

/**
 * A flat painted overlay on the ground — wear, spill, puddle, road marking.
 * Neither pickable nor collidable, so it is wholly invisible to navigation and
 * gunfire and exists purely to break up the apron.
 */
function decal(root: TransformNode, scene: Scene, name: string, w: number, d: number, x: number, z: number, mat: unknown, rotY = 0, y = 0.02): Mesh {
  const m = MeshBuilder.CreateGround(`pp_${name}_${uid++}`, { width: w, height: d }, scene);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.material = mat as Mesh["material"];
  m.isPickable = false;
  m.checkCollisions = false;
  m.parent = root;
  return m;
}

/** Axis-aligned walkable ramp running along Z. Axis-aligned keeps the pitch maths exact and the nav ray honest. */
function rampZ(root: TransformNode, scene: Scene, x: number, z0: number, z1: number, y0: number, y1: number, width: number, mat: unknown): void {
  const dz = z1 - z0;
  const dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const m = MeshBuilder.CreateBox(`pp_ramp_${uid++}`, { width, height: 0.3, depth: len }, scene);
  m.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(dy, dz);
  m.material = mat as Mesh["material"];
  m.checkCollisions = true;
  m.metadata = { walkable: true };
  m.parent = root;
}

/** Axis-aligned walkable ramp running along X. */
function rampX(root: TransformNode, scene: Scene, z: number, x0: number, x1: number, y0: number, y1: number, width: number, mat: unknown): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const m = MeshBuilder.CreateBox(`pp_ramp_${uid++}`, { width: len, height: 0.3, depth: width }, scene);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  m.rotation.z = Math.atan2(dy, dx);
  m.material = mat as Mesh["material"];
  m.checkCollisions = true;
  m.metadata = { walkable: true };
  m.parent = root;
}

// ---------------------------------------------------------------------------
// Modular structures
// ---------------------------------------------------------------------------

const CON_W = 12.2; // ISO 40ft, near enough
const CON_H = 2.9;
const CON_D = 2.9;

/** A stack of shipping containers. Pure cover — solid all the way up, so the nav ray correctly refuses the footprint. */
function containerStack(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, height: number, rotY: number, seed: number): void {
  for (let h = 0; h < height; h++) {
    const mat = mats.containers[(seed + h) % mats.containers.length];
    solid(root, scene, "con", CON_W, CON_H, CON_D, x, CON_H / 2 + h * CON_H, z, mat, rotY);
  }
}

/**
 * A run of container stacks with deliberate gaps: lanes wide enough to fight
 * down, narrow enough that crossing one exposes you.
 *
 * Takes a SEED rather than a shared generator, deliberately. The strongpoint
 * phase anchors are hand-placed against where these stacks land, so container
 * layout has to be stable — drawing from the map-wide stream meant that adding
 * a single prop anywhere earlier in the build shifted every stack and could
 * bury an anchor inside a container. A per-block seed makes the yard
 * reproducible no matter what else changes around it.
 */
function containerBlock(
  root: TransformNode,
  scene: Scene,
  mats: Mats,
  originX: number,
  originZ: number,
  cols: number,
  rows: number,
  seed: number,
  rotY = 0
): void {
  const rand = mulberry32(seed);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (rand() < 0.16) continue; // gaps: cross-lanes and collapsed slots
      const x = originX + c * (CON_W + 4.5);
      const z = originZ + r * (CON_D + 5.5);
      const h = 1 + Math.floor(rand() * 3); // 1–3 high: varied sightline breaks
      containerStack(root, scene, mats, x, z, h, rotY, Math.floor(rand() * 6));
    }
  }
}

/**
 * A warehouse / transit shed: walls with door gaps, a walkable interior floor,
 * internal partitions for close-quarters work, and a non-pickable roof so the
 * inside stays navigable.
 */
function shed(
  root: TransformNode,
  scene: Scene,
  mats: Mats,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  opts: { doorsN?: boolean; doorsS?: boolean; doorsE?: boolean; doorsW?: boolean; partitions?: number; rusty?: boolean } = {}
): void {
  const t = 0.6;
  const doorW = 6;
  const hw = w / 2;
  const hd = d / 2;
  const wall = opts.rusty ? mats.corrugatedRust : mats.corrugated;

  // Interior floor, raised a hair above the tarmac so it wins the nav ray.
  walkable(root, scene, "shedFloor", w - t, 0.12, d - t, cx, 0.06, cz, mats.concrete);

  // Each wall is built as up to three segments so a door gap is a real hole
  // rather than a decorative decal the AI would refuse to path through.
  const wallX = (z: number, hasDoor: boolean) => {
    if (!hasDoor) {
      solid(root, scene, "shedWall", w, h, t, cx, h / 2, z, wall);
      return;
    }
    const seg = (w - doorW) / 2;
    solid(root, scene, "shedWall", seg, h, t, cx - (doorW / 2 + seg / 2), h / 2, z, wall);
    solid(root, scene, "shedWall", seg, h, t, cx + (doorW / 2 + seg / 2), h / 2, z, wall);
    solid(root, scene, "shedLintel", doorW, h - 4.2, t, cx, h - (h - 4.2) / 2, z, wall);
    // Roller-shutter housing over the opening — reads as a real loading door.
    decor(root, scene, "shutter", doorW + 0.6, 0.7, 0.5, cx, h - 4.6, z, mats.steel);
  };
  const wallZ = (x: number, hasDoor: boolean) => {
    if (!hasDoor) {
      solid(root, scene, "shedWall", t, h, d, x, h / 2, cz, wall);
      return;
    }
    const seg = (d - doorW) / 2;
    solid(root, scene, "shedWall", t, h, seg, x, h / 2, cz - (doorW / 2 + seg / 2), wall);
    solid(root, scene, "shedWall", t, h, seg, x, h / 2, cz + (doorW / 2 + seg / 2), wall);
    solid(root, scene, "shedLintel", t, h - 4.2, doorW, x, h - (h - 4.2) / 2, cz, wall);
    decor(root, scene, "shutter", 0.5, 0.7, doorW + 0.6, x, h - 4.6, cz, mats.steel);
  };

  wallX(cz - hd, !!opts.doorsS);
  wallX(cz + hd, !!opts.doorsN);
  wallZ(cx - hw, !!opts.doorsW);
  wallZ(cx + hw, !!opts.doorsE);

  roofPanel(root, scene, "shedRoof", w, 0.4, d, cx, h, cz, mats.corrugatedRust);
  // Roof trusses, visible from inside through the open doors.
  for (let i = 1; i < 4; i++) {
    decor(root, scene, "truss", w, 0.3, 0.3, cx, h - 0.7, cz - hd + (d / 4) * i, mats.steel);
  }

  // Internal partitions with offset gaps — the blind corners that make the
  // interior a fight instead of a corridor.
  const partitions = opts.partitions ?? 0;
  for (let i = 1; i <= partitions; i++) {
    const px = cx - hw + (w / (partitions + 1)) * i;
    const gapZ = cz + (i % 2 === 0 ? d * 0.22 : -d * 0.22);
    const segLen = (d - 5) / 2;
    solid(root, scene, "shedPart", 0.5, h - 1.4, segLen, px, (h - 1.4) / 2, gapZ - (2.5 + segLen / 2), mats.corrugated);
    solid(root, scene, "shedPart", 0.5, h - 1.4, segLen, px, (h - 1.4) / 2, gapZ + (2.5 + segLen / 2), mats.corrugated);
  }

  // Racking along the inside walls: waist-high cover to fight from.
  for (let i = 0; i < 4; i++) {
    const rx = cx - hw + 3 + (w - 6) * (i / 3);
    solid(root, scene, "rack", 3.2, 1.5, 1.1, rx, 0.75, cz - hd + 2.2, mats.rust);
    solid(root, scene, "rack", 3.2, 1.5, 1.1, rx, 0.75, cz + hd - 2.2, mats.rust);
  }
}

/** A raised deck on legs, reached by ramps. Open underneath, so the ground below stays fightable. */
function deck(root: TransformNode, scene: Scene, mats: Mats, cx: number, cz: number, w: number, d: number, y: number): void {
  walkable(root, scene, "deck", w, 0.4, d, cx, y, cz, mats.steel);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    solid(root, scene, "deckLeg", 0.8, y, 0.8, cx + sx * (w / 2 - 1.2), y / 2, cz + sz * (d / 2 - 1.2), mats.steel);
  }
  // Handrails: bullet-stopping, but deliberately non-colliding so they never
  // wall the AI off the deck or confuse the nav ray.
  for (const sz of [-1, 1]) {
    decor(root, scene, "rail", w, 1.0, 0.1, cx, y + 0.7, cz + sz * (d / 2), mats.steel);
  }
  for (const sx of [-1, 1]) {
    decor(root, scene, "rail", 0.1, 1.0, d, cx + sx * (w / 2), y + 0.7, cz, mats.steel);
  }
}

/**
 * An inspection catwalk spanning a container lane. Verticality that is
 * nav-correct by construction: the walkway is walkable, and the ground beneath
 * it is open, so both levels are fightable at once.
 */
function catwalk(root: TransformNode, scene: Scene, mats: Mats, x0: number, x1: number, z: number, y: number): void {
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  walkable(root, scene, "catwalk", len, 0.25, 2.4, cx, y, z, mats.steel);
  for (const sz of [-1, 1]) {
    decor(root, scene, "cwRail", len, 1.0, 0.08, cx, y + 0.65, z + sz * 1.2, mats.steel);
  }
  for (let i = 0; i <= Math.floor(len / 10); i++) {
    const px = Math.min(x0, x1) + i * 10;
    solid(root, scene, "cwLeg", 0.4, y, 0.4, px, y / 2, z, mats.steel);
  }
}

/** A caged access ladder/stair tower up to a deck or catwalk. */
function stairTower(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, y: number): void {
  rampZ(root, scene, x, z - 6, z, 0, y, 1.8, mats.steel);
  for (const sx of [-1, 1]) {
    decor(root, scene, "stRail", 0.08, 1.0, 6.2, x + sx * 0.9, y * 0.6, z - 3, mats.steel);
  }
  solid(root, scene, "stPost", 0.35, y, 0.35, x + 1.1, y / 2, z + 0.4, mats.steel);
}

/** Guard post: a small hut with a sandbagged firing position — the standard junction hardpoint. */
function guardPost(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number): void {
  solid(root, scene, "postHut", 3.4, 3, 3.4, x, 1.5, z, mats.concrete, rotY);
  roofPanel(root, scene, "postRoof", 4.2, 0.25, 4.2, x, 3.1, z, mats.corrugatedRust);
  decor(root, scene, "postWindow", 2.4, 1.1, 0.12, x, 2.0, z - 1.75, mats.glass, rotY);
  for (let i = -1; i <= 1; i++) {
    solid(root, scene, "postBag", 1.6, 1.0, 0.9, x + Math.cos(rotY) * 3.2 + i * 1.5 * Math.sin(rotY), 0.5, z - Math.sin(rotY) * 3.2 + i * 1.5 * Math.cos(rotY), mats.sandbag, rotY);
  }
}

/** Jersey-barrier run — channels movement without fully blocking sight. */
function barrierRun(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, count: number, rotY: number): void {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 2.6;
    solid(root, scene, "barrier", 2.5, 1.0, 0.7, x + Math.cos(rotY) * off, 0.5, z + Math.sin(rotY) * off, mats.concrete, rotY);
  }
}

/** Sandbag emplacement — a low horseshoe you can actually fight from. */
function sandbagPost(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number): void {
  for (let i = -2; i <= 2; i++) {
    const ox = Math.cos(rotY) * i * 1.7;
    const oz = -Math.sin(rotY) * i * 1.7;
    solid(root, scene, "bag", 1.7, 0.55, 0.9, x + ox, 0.28, z + oz, mats.sandbag, rotY);
    if (Math.abs(i) < 2) solid(root, scene, "bag", 1.7, 0.55, 0.9, x + ox, 0.82, z + oz, mats.sandbag, rotY);
  }
  for (const s of [-1, 1]) {
    const ox = Math.cos(rotY) * s * 3.4 + Math.sin(rotY) * 1.2;
    const oz = -Math.sin(rotY) * s * 3.4 + Math.cos(rotY) * 1.2;
    solid(root, scene, "bag", 0.9, 0.55, 1.7, x + ox, 0.28, z + oz, mats.sandbag, rotY);
  }
}

/** Chain-link perimeter. Solid enough to path around, low enough to shoot over from cover. */
function fenceRun(root: TransformNode, scene: Scene, mats: Mats, x0: number, z0: number, x1: number, z1: number, gapAt?: number): void {
  const segs = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 8));
  const rot = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i < segs; i++) {
    if (gapAt !== undefined && i === gapAt) continue; // gate
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const mx = x0 + (x1 - x0) * ((t0 + t1) / 2);
    const mz = z0 + (z1 - z0) * ((t0 + t1) / 2);
    const len = Math.hypot((x1 - x0) * (t1 - t0), (z1 - z0) * (t1 - t0));
    solid(root, scene, "fence", 0.15, 2.6, len, mx, 1.3, mz, mats.steel, rot);
    // Posts and a barbed top rail: the detail that stops a fence reading as a
    // grey slab.
    decor(root, scene, "fencePost", 0.28, 3.0, 0.28, x0 + (x1 - x0) * t0, 1.5, z0 + (z1 - z0) * t0, mats.steel);
    decor(root, scene, "fenceTop", 0.06, 0.06, len, mx, 2.85, mz, mats.steel, rot);
  }
}

/** A sliding vehicle gate in a fence line, with its own posts. */
function gate(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number): void {
  for (const s of [-1, 1]) {
    solid(root, scene, "gatePost", 0.5, 3.6, 0.5, x + Math.cos(rotY) * s * 4.5, 1.8, z - Math.sin(rotY) * s * 4.5, mats.steel);
  }
  decor(root, scene, "gateLeaf", 4.4, 2.4, 0.12, x + Math.cos(rotY) * 2.4, 1.3, z - Math.sin(rotY) * 2.4, mats.steel, rotY);
  decor(root, scene, "gateSign", 1.6, 0.9, 0.08, x, 2.4, z, mats.hazard, rotY);
}

/** Pipe rack — overhead pipes on stanchions. Vaultable cover at the base, visual ceiling above. */
function pipeRack(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, len: number, rotY: number): void {
  const sin = Math.sin(rotY);
  const cos = Math.cos(rotY);
  for (let i = 0; i <= Math.floor(len / 9); i++) {
    const off = -len / 2 + i * 9;
    solid(root, scene, "pipeLeg", 0.6, 4.4, 0.6, x + cos * off, 2.2, z - sin * off, mats.steel);
  }
  for (const dy of [0, 0.75]) {
    decor(root, scene, "pipe", 0.5, 0.5, len, x, 4.0 + dy, z, mats.rust, rotY);
    decor(root, scene, "pipe", 0.45, 0.45, len, x + sin * 0.9, 4.0 + dy, z + cos * 0.9, mats.steel, rotY);
  }
  // Waist-high service pipe you can drop behind.
  solid(root, scene, "pipeLow", 0.9, 0.9, len * 0.6, x, 0.45, z, mats.rust, rotY);
}

/** Covered walkway — a canopy on posts. Non-pickable roof keeps the path beneath it navigable. */
function coveredWalk(root: TransformNode, scene: Scene, mats: Mats, x: number, z0: number, z1: number): void {
  const len = z1 - z0;
  roofPanel(root, scene, "walkRoof", 5, 0.25, len, x, 3.4, z0 + len / 2, mats.corrugatedRust);
  for (let i = 0; i <= Math.floor(Math.abs(len) / 8); i++) {
    const z = z0 + Math.sign(len) * i * 8;
    for (const sx of [-1, 1]) decor(root, scene, "walkPost", 0.3, 3.4, 0.3, x + sx * 2.3, 1.7, z, mats.steel);
    decor(root, scene, "walkBeam", 5, 0.24, 0.24, x, 3.15, z, mats.steel);
  }
}

/** Drainage channel: a sunken run with bridges. The bridges are the choke points. */
function drainChannel(root: TransformNode, scene: Scene, mats: Mats, z: number, x0: number, x1: number, bridgeXs: number[]): void {
  const width = 6;
  // Walls either side; the channel floor is the tarmac itself, so the AI can
  // still walk the length of it — it's cover, not a wall.
  for (const sz of [-1, 1]) {
    solid(root, scene, "drainLip", x1 - x0, 1.2, 0.7, (x0 + x1) / 2, 0.6, z + sz * (width / 2), mats.concrete);
  }
  // A damp, silted channel bed painted straight onto the apron.
  decal(root, scene, "drainBed", x1 - x0, width - 1.2, (x0 + x1) / 2, z, mats.dirt, 0, 0.03);
  for (const bx of bridgeXs) {
    walkable(root, scene, "drainBridge", 7, 0.3, width + 2.4, bx, 1.35, z, mats.concrete);
    for (const sz of [-1, 1]) decor(root, scene, "bridgeRail", 7, 0.9, 0.12, bx, 1.9, z + sz * (width / 2 + 1), mats.steel);
  }
  // Culvert mouths along the run — where the yard drains into the channel.
  for (let cx = x0 + 20; cx < x1; cx += 34) {
    if (bridgeXs.some((b) => Math.abs(b - cx) < 10)) continue;
    decor(root, scene, "culvert", 2.2, 1.4, 0.5, cx, 0.7, z - width / 2 - 0.2, mats.concrete);
    decal(root, scene, "seep", 5, 4, cx, z - width / 2 - 3, mats.dirt, 0, 0.025);
  }
}

/** Parked plant: trucks, trailers, forklifts. Hard cover that breaks up open tarmac. */
function vehicle(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number, kind: "truck" | "trailer" | "forklift"): void {
  if (kind === "forklift") {
    solid(root, scene, "fork", 2.2, 1.8, 3.2, x, 0.9, z, mats.hazard, rotY);
    decor(root, scene, "forkMast", 0.5, 2.6, 0.4, x, 2.6, z, mats.steel, rotY);
    decor(root, scene, "forkCage", 1.8, 1.2, 1.6, x, 2.4, z + 0.4, mats.steel, rotY);
    return;
  }
  if (kind === "trailer") {
    solid(root, scene, "trailerBed", 2.6, 1.1, 12, x, 1.1, z, mats.rust, rotY);
    for (const dz of [-4.5, 4.2]) decor(root, scene, "wheel", 2.7, 0.9, 0.9, x, 0.45, z + dz, mats.steel, rotY);
    decor(root, scene, "trailerLegs", 2.2, 0.7, 0.2, x, 0.35, z - 5.4, mats.steel, rotY);
    return;
  }
  solid(root, scene, "truckCab", 2.6, 2.8, 3.4, x, 1.4, z, mats.painted, rotY);
  decor(root, scene, "truckGlass", 2.3, 1.0, 0.12, x, 2.3, z - 1.75, mats.glass, rotY);
  solid(root, scene, "truckBox", 2.7, 3.0, 8, x - Math.sin(rotY) * 5.8, 1.7, z - Math.cos(rotY) * 5.8, mats.containers[1], rotY);
  for (const s of [-1, 1]) decor(root, scene, "truckWheel", 2.8, 1.0, 1.0, x, 0.5, z + s * 1.2, mats.steel, rotY);
}

/** A stack of pallets — the small-scale cover that makes a loading bay read as used. */
function pallets(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rand: () => number, rotY = 0): void {
  const n = 2 + Math.floor(rand() * 5);
  for (let i = 0; i < n; i++) {
    solid(root, scene, "pallet", 1.2, 0.16, 1.0, x, 0.08 + i * 0.17, z, mats.rust, rotY + (rand() - 0.5) * 0.2);
  }
  if (rand() < 0.6) solid(root, scene, "crate", 1.1, 0.9, 0.9, x, n * 0.17 + 0.45, z, mats.rust, rotY);
}

/** Loose crates and drums — clutter with a purpose, always beside something that would produce it. */
function stores(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rand: () => number): void {
  const n = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const dx = (rand() - 0.5) * 5;
    const dz = (rand() - 0.5) * 5;
    if (rand() < 0.5) {
      const s = 0.8 + rand() * 0.6;
      solid(root, scene, "crate", s, s * 0.85, s, x + dx, s * 0.42, z + dz, mats.rust, rand() * 3);
    } else {
      const drum = MeshBuilder.CreateCylinder(`pp_drum_${uid++}`, { diameter: 0.6, height: 0.9, tessellation: 8 }, scene);
      drum.position.set(x + dx, 0.45, z + dz);
      drum.material = (rand() < 0.5 ? mats.rust : mats.hazard) as Mesh["material"];
      drum.checkCollisions = true;
      drum.parent = root;
    }
  }
}

/** Rubble/clutter — cheap low cover that keeps open ground from reading as empty. */
function rubble(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rand: () => number): void {
  const n = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const s = 0.7 + rand() * 1.5;
    solid(root, scene, "rubble", s, s * 0.7, s, x + (rand() - 0.5) * 6, s * 0.35, z + (rand() - 0.5) * 6, rand() < 0.5 ? mats.concrete : mats.rust, rand() * 3);
  }
  decal(root, scene, "rubbleDust", 9, 9, x, z, mats.dirt, rand() * 3, 0.024);
}

/** Gantry crane straddling a container lane — the terminal's skyline, and a climbable deck. */
function gantryCrane(root: TransformNode, scene: Scene, mats: Mats, cx: number, cz: number): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      solid(root, scene, "craneLeg", 1.2, 16, 1.2, cx + sx * 13, 8, cz + sz * 7, mats.hazard);
      decor(root, scene, "craneBrace", 1.0, 0.5, 14, cx + sx * 13, 9, cz, mats.hazard);
    }
  }
  decor(root, scene, "craneBeam", 30, 1.6, 2.2, cx, 16.6, cz, mats.hazard);
  decor(root, scene, "craneBoom", 2.0, 1.2, 34, cx, 18.4, cz, mats.steel);
  decor(root, scene, "craneCab", 2.6, 2.0, 2.6, cx + 6, 15.2, cz, mats.painted);
  // Spreader hanging on its cables, mid-lift.
  decor(root, scene, "craneCable", 0.14, 8, 0.14, cx, 12, cz + 2, mats.steel);
  decor(root, scene, "spreader", 12, 0.6, 1.4, cx, 8.2, cz + 2, mats.hazard);
}

/** Lamp post — the standard yard light. Emissive head so it reads as the source. */
function lampPost(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY = 0): void {
  decor(root, scene, "lampPole", 0.28, 8, 0.28, x, 4, z, mats.steel);
  decor(root, scene, "lampArm", 2.2, 0.18, 0.18, x + Math.cos(rotY) * 1.1, 7.9, z - Math.sin(rotY) * 1.1, mats.steel, rotY);
  decor(root, scene, "lampHead", 1.1, 0.3, 0.6, x + Math.cos(rotY) * 2.1, 7.75, z - Math.sin(rotY) * 2.1, mats.lamp, rotY);
}

/** Utility pole with a cable run to the next one — ties the map together visually. */
function utilityPole(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, nextX?: number, nextZ?: number): void {
  decor(root, scene, "utilPole", 0.34, 10, 0.34, x, 5, z, mats.bark);
  decor(root, scene, "utilArm", 2.6, 0.16, 0.16, x, 9.2, z, mats.bark);
  for (const s of [-1, 0, 1]) decor(root, scene, "insulator", 0.16, 0.3, 0.16, x + s * 1.1, 9.5, z, mats.concrete);
  if (nextX === undefined || nextZ === undefined) return;
  // A single slack span, approximated by one long thin box between the poles.
  const dx = nextX - x;
  const dz = nextZ - z;
  const len = Math.hypot(dx, dz);
  const cable = decor(root, scene, "cable", 0.07, 0.07, len, x + dx / 2, 8.9, z + dz / 2, mats.steel);
  cable.rotation.y = Math.atan2(dx, dz);
}

/** A stencilled warning/wayfinding sign on posts. */
function sign(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number, wide = 2.2): void {
  for (const s of [-1, 1]) decor(root, scene, "signPost", 0.12, 2.6, 0.12, x + Math.cos(rotY) * s * (wide / 2 - 0.2), 1.3, z - Math.sin(rotY) * s * (wide / 2 - 0.2), mats.steel);
  decor(root, scene, "signFace", wide, 1.0, 0.08, x, 2.2, z, mats.hazard, rotY);
}

/** Floodlight mast — the tall four-head towers that actually light a container yard. */
function floodMast(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number): void {
  solid(root, scene, "mastBase", 1.4, 0.8, 1.4, x, 0.4, z, mats.concrete);
  decor(root, scene, "mastPole", 0.5, 15, 0.5, x, 7.9, z, mats.steel);
  decor(root, scene, "mastHead", 3.4, 0.5, 1.4, x, 15.3, z, mats.lamp);
  decor(root, scene, "mastHead2", 1.4, 0.5, 3.4, x, 15.3, z, mats.lamp);
  for (const s of [-1, 1]) decor(root, scene, "mastStay", 0.12, 0.12, 6, x + s * 1.4, 6, z, mats.steel);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildPasirPanjang(scene: Scene): PasirPanjangHandles {
  const root = new TransformNode("pasirPanjangRoot", scene);
  const mats = buildTerminalMats(scene);
  const rand = mulberry32(90417);

  buildGround(root, scene, mats, rand);
  buildQuayApproach(root, scene, mats, rand);
  buildDistripark(root, scene, mats, rand);
  buildWharves(root, scene, mats, rand);
  buildMidYard(root, scene, mats, rand);
  buildPowerStation(root, scene, mats, rand);
  buildNorthStorage(root, scene, mats, rand);
  buildBukitChandu(root, scene, mats, rand);
  buildRoadNetwork(root, scene, mats, rand);
  buildPerimeter(root, scene, mats, rand);
  // Runs last, and on its own generators, so filling gaps can never perturb
  // the layout the strongpoint anchors were verified against.
  buildInfill(root, scene, mats);
  buildVegetation(root, scene, mats);
  buildLighting(root, scene);
  optimiseTerminal(root, scene);
  scopeFloodlights(root, scene);

  root.setEnabled(false);
  return { root, spawn: TERMINAL_SPAWN, strongpointDefs: STRONGPOINT_DEFS };
}

/**
 * Post-build optimisation. The terminal is entirely static once built, which
 * makes two things safe that would not be in a dynamic scene:
 *
 *  1. Weld the dressing. Every `decor` mesh is non-colliding and non-pickable
 *     (invisible to both the navigation raycast and weapon fire — see the nav
 *     contract at the top of this file), so merging the lot into one mesh per
 *     material cannot change collision, pathing or gunplay: it only trades
 *     hundreds of draw calls for a handful. Anything with a collision, nav or
 *     pick role (containers, walls, floors, ramps, decks) is deliberately left
 *     alone, so per-object granularity there is untouched.
 *  2. Freeze world matrices. Nothing here ever moves, so Babylon can stop
 *     recomputing transforms and bounding info for ~2,500 meshes every frame.
 */
/**
 * Restrict each floodlight to the geometry it can actually illuminate.
 *
 * Babylon decides which lights a mesh's shader must evaluate from
 * `Light.canAffectMesh`, which consults the include/exclude lists — it does NOT
 * cull by range. So every one of the six floodlights was being compiled into
 * every material on the map, and with the four static rig lights that put every
 * mesh over WorldMaterial's 8-light budget: Babylon then renders the mesh in a
 * second pass for the overflow. Measured on the terminal, all 1510 active
 * meshes were being lit by all 11 lights, roughly doubling draw calls and
 * making every fragment evaluate lights that contribute nothing.
 *
 * A point light's contribution is clamped to zero beyond `range`, so excluding
 * geometry further away than that is mathematically identical output — this is
 * a pure cost saving, not a lighting change. Exclusion (rather than an
 * include-list) is deliberate: anything spawned later that isn't on the list —
 * OPFOR, BOTTY, projectiles, throwables — keeps full lighting, so soldiers
 * still light up correctly as they move under a mast.
 *
 * Runs once at build time against static geometry; there is no per-frame cost.
 */
function scopeFloodlights(root: TransformNode, scene: Scene): void {
  const floods = scene.lights.filter((l) => l.name.startsWith("ppFlood_"));
  if (floods.length === 0) return;
  const statics = root.getChildMeshes();

  for (const light of floods) {
    const lightPos = (light as PointLight).position;
    const range = (light as PointLight).range;
    const excluded: Mesh[] = [];
    for (const node of statics) {
      const mesh = node as Mesh;
      const info = mesh.getBoundingInfo?.();
      if (!info) continue;
      // Compare against the bounding sphere so a long mesh straddling the
      // range boundary is kept rather than clipped.
      const sphere = info.boundingSphere;
      const d = Vector3.Distance(sphere.centerWorld, lightPos) - sphere.radiusWorld;
      if (d > range) excluded.push(mesh);
    }
    light.excludedMeshes = excluded;
  }
}

function optimiseTerminal(root: TransformNode, scene: Scene): void {
  const byMaterial = new Map<string, Mesh[]>();
  for (const node of root.getChildMeshes()) {
    const mesh = node as Mesh;
    if (mesh.metadata?.mergeable !== true || !mesh.material) continue;
    const key = mesh.material.name;
    const list = byMaterial.get(key);
    if (list) list.push(mesh);
    else byMaterial.set(key, [mesh]);
  }

  for (const [key, group] of byMaterial) {
    if (group.length < 2) continue;
    // multiMultiMaterials=false: every mesh in the group already shares one
    // material, which is what makes this a single-submesh merge.
    const merged = Mesh.MergeMeshes(group, true, true, undefined, false, false);
    if (!merged) continue;
    merged.name = `pp_merged_${key}`;
    merged.parent = root;
    merged.checkCollisions = false;
    merged.isPickable = false; // pure visual dressing — never intercepts nav rays or gunfire
    // One welded mesh spans most of the map, so per-mesh frustum culling would
    // only ever cull it when the player looks at the sky. Keeping it always
    // active skips the pointless test.
    merged.alwaysSelectAsActiveMesh = true;
  }

  for (const node of root.getChildMeshes()) {
    const mesh = node as Mesh;
    if (mesh.thinInstanceCount > 0) continue; // instanced foliage manages its own buffers
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
  }
}

/**
 * The ground, and the painting on top of it.
 *
 * The apron itself stays dead flat, because that is what a container terminal
 * is — a graded concrete slab you can drive a straddle carrier across. The
 * variation instead comes from the surface layer: gravel margins where the
 * slab gives out, worn dirt where vehicles cut the corner, standing water in
 * the low spots, and spill around anything that leaks. Relief is reserved for
 * the places that logically have it (the ridge, the embankment, the channel).
 */
function buildGround(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ground = MeshBuilder.CreateGround("ppTerminalGround", { width: 300, height: 300, subdivisions: 2 }, scene);
  ground.material = mats.apron as Mesh["material"];
  ground.checkCollisions = true;
  ground.metadata = { walkable: true };
  ground.parent = root;

  // Gravel/earth margins where the paved yard ends and the scrub begins.
  for (const [x, z, w, d] of [
    [-116, -20, 26, 190],
    [116, -20, 26, 190],
    [0, 126, 250, 22],
    [-60, -122, 90, 18],
    [60, -122, 90, 18],
  ] as const) {
    decal(root, scene, "margin", w, d, x, z, mats.gravel, 0, 0.015);
  }

  // Worn vehicle paths: the routes a yard tractor actually takes, laid down
  // as overlapping dirt strips so the wear reads as accumulated rather than
  // painted on in one stroke.
  const paths: Array<[number, number, number, number, number]> = [
    [0, -100, 14, 40, 0],
    [0, -55, 12, 60, 0],
    [-40, -30, 60, 12, 0],
    [40, -30, 60, 12, 0],
    [0, -6, 16, 30, 0],
    [-62, 4, 12, 26, 0],
    [64, 4, 12, 26, 0],
    [0, 40, 14, 60, 0],
    [-68, 26, 40, 11, 0],
    [66, 30, 40, 11, 0],
    [0, 74, 30, 14, 0],
  ];
  for (const [x, z, w, d, r] of paths) {
    decal(root, scene, "wear", w, d, x, z, mats.dirt, r, 0.018);
  }

  // Standing water. Singapore gets 2.3m of rain a year and a port apron
  // drains badly, so puddles gather in the ruts and against kerb lines.
  for (let i = 0; i < 34; i++) {
    const px = (rand() - 0.5) * 220;
    const pz = (rand() - 0.5) * 230;
    decal(root, scene, "puddle", 3 + rand() * 9, 2 + rand() * 7, px, pz, mats.puddle, rand() * 3, 0.03);
  }

  // Diesel and hydraulic spill under anything that leaks: the crane rails, the
  // fuel point, the plant parking.
  for (const [x, z] of [[-34, -92], [36, -92], [-12, -58], [52, -68], [-68, 40], [46, 44], [4, -30]] as const) {
    decal(root, scene, "spill", 7 + rand() * 6, 6 + rand() * 5, x, z, mats.dirt, rand() * 3, 0.022);
  }
}

/** South quay: the insertion point and the funnel inland. Open, but not bare. */
function buildQuayApproach(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // Seawall along the southern edge, with fenders and mooring furniture.
  solid(root, scene, "seawall", 260, 2.2, 1.6, 0, 1.1, -127, mats.concrete);
  for (let i = 0; i < 13; i++) {
    const x = -114 + i * 19;
    const bollard = MeshBuilder.CreateCylinder(`pp_bollard_${uid++}`, { diameterTop: 0.9, diameterBottom: 1.3, height: 1.3, tessellation: 8 }, scene);
    bollard.position.set(x, 0.65, -123);
    bollard.material = mats.steel as Mesh["material"];
    bollard.checkCollisions = true;
    bollard.parent = root;
    // Mooring line coiled at the foot of every other bollard.
    if (i % 2 === 0) decor(root, scene, "coil", 1.8, 0.22, 1.8, x, 0.11, -121, mats.rust);
    if (i % 3 === 0) decor(root, scene, "fender", 1.2, 1.6, 0.5, x, 0.8, -126.4, mats.rust);
  }
  // Crane rails running the length of the quay — the reason the cranes are here.
  decal(root, scene, "railStrip", 250, 1.2, 0, -100, mats.rust, 0, 0.02);
  decal(root, scene, "railStrip2", 250, 1.2, 0, -84, mats.rust, 0, 0.02);

  // Landing zone: sandbagged, so the player has something to fall back into
  // during the Ranger Gauntlet rather than standing on open tarmac.
  sandbagPost(root, scene, mats, 0, -108, 0);
  sandbagPost(root, scene, mats, -13, -106, 0.4);
  sandbagPost(root, scene, mats, 13, -106, -0.4);
  barrierRun(root, scene, mats, -16, -100, 4, 0);
  barrierRun(root, scene, mats, 16, -100, 4, 0);
  guardPost(root, scene, mats, -24, -98, Math.PI / 2);
  guardPost(root, scene, mats, 24, -98, -Math.PI / 2);
  sign(root, scene, mats, 0, -96, 0, 3.2);

  // Quayside container rows either side of the approach — immediate cover off
  // the landing, and the first taste of the lane fighting inland.
  containerBlock(root, scene, mats, -50, -104, 2, 3, 1101);
  containerBlock(root, scene, mats, 24, -104, 2, 3, 1102);
  gantryCrane(root, scene, mats, -34, -92);
  gantryCrane(root, scene, mats, 36, -92);

  // Cargo that came off the ship and has not moved on yet.
  pallets(root, scene, mats, -20, -96, rand);
  pallets(root, scene, mats, -17, -92, rand, 0.4);
  pallets(root, scene, mats, 19, -95, rand);
  stores(root, scene, mats, 26, -88, rand);
  vehicle(root, scene, mats, -8, -88, 0, "trailer");
  vehicle(root, scene, mats, 10, -84, Math.PI, "truck");
  vehicle(root, scene, mats, -46, -86, 1.3, "forklift");
  coveredWalk(root, scene, mats, 0, -104, -78);
  rubble(root, scene, mats, -22, -80, rand);
  rubble(root, scene, mats, 22, -76, rand);
  floodMast(root, scene, mats, -56, -96);
  floodMast(root, scene, mats, 56, -96);
}

/** STRONGPOINT A — Keppel Distripark. Open container yard, long lanes, marksman country. */
function buildDistripark(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ox = G.A;

  fenceRun(root, scene, mats, ox - 40, -78, ox + 26, -78, 4); // gate on the approach side
  gate(root, scene, mats, ox + 6, -78, 0);
  fenceRun(root, scene, mats, ox - 40, -78, ox - 40, -18);
  guardPost(root, scene, mats, ox + 20, -74, Math.PI);
  sign(root, scene, mats, ox + 12, -76, 0);

  // Three long lanes running north–south. Wide spacing is the point: this is
  // the objective where the player gets shot at from 60m.
  containerBlock(root, scene, mats, ox - 34, -70, 2, 5, 1201);
  containerBlock(root, scene, mats, ox - 4, -70, 2, 5, 1202);
  containerBlock(root, scene, mats, ox + 12, -66, 1, 4, 1203);

  // Reefer plant: powered containers need a gantry of sockets and a genset,
  // which is also a useful piece of hard cover mid-lane.
  solid(root, scene, "reeferGen", 4.5, 2.6, 9, ox + 4, 1.3, -30, mats.painted);
  decor(root, scene, "reeferStack", 0.7, 2.2, 0.7, ox + 4, 3.6, -34, mats.steel);
  for (let i = 0; i < 5; i++) {
    decor(root, scene, "reeferSocket", 0.5, 0.7, 0.4, ox - 8 + i * 4, 1.2, -26, mats.hazard);
  }

  gantryCrane(root, scene, mats, ox - 12, -58);
  // An inspection catwalk over the middle lane: high ground that leaves the
  // lane below fully fightable.
  catwalk(root, scene, mats, ox - 30, ox + 6, -46, 6.5);
  stairTower(root, scene, mats, ox + 6, -46, 6.5);

  vehicle(root, scene, mats, ox + 16, -50, Math.PI / 2, "forklift");
  vehicle(root, scene, mats, ox - 20, -34, 0, "trailer");
  vehicle(root, scene, mats, ox + 20, -62, 0.3, "truck");
  pallets(root, scene, mats, ox - 36, -50, rand);
  stores(root, scene, mats, ox + 14, -38, rand);

  // The keep at the back of the yard: a tight ring of stacks with a raised
  // deck overlooking the only clean approach.
  containerStack(root, scene, mats, ox - 30, -28, 3, 0, 1);
  containerStack(root, scene, mats, ox - 30, -18, 3, 0, 3);
  containerStack(root, scene, mats, ox - 18, -30, 2, Math.PI / 2, 2);
  deck(root, scene, mats, ox - 24, -23, 12, 9, 6);
  rampZ(root, scene, ox - 20, -36, -28, 0, 6, 3, mats.steel);
  barrierRun(root, scene, mats, ox - 10, -24, 5, Math.PI / 2);
  sandbagPost(root, scene, mats, ox - 24, -30, 0);
  rubble(root, scene, mats, ox - 6, -40, rand);
  floodMast(root, scene, mats, ox + 24, -40);
  lampPost(root, scene, mats, ox - 40, -60, -Math.PI / 2);
  lampPost(root, scene, mats, ox - 40, -34, -Math.PI / 2);
}

/** STRONGPOINT B — Pasir Panjang Wharves. Three transit sheds: doors, partitions, no long shots. */
function buildWharves(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ox = G.B;

  // Loading bays out front: trucks nose-in to the shed doors, with dock
  // levellers, pallet stacks and the general litter of a working bay.
  for (let i = 0; i < 4; i++) {
    const bx = ox - 24 + i * 15;
    vehicle(root, scene, mats, bx, -68, 0, i % 2 === 0 ? "truck" : "trailer");
    solid(root, scene, "dockLeveller", 3.4, 1.1, 2.2, bx, 0.55, -62.5, mats.concrete);
    if (i % 2 === 1) pallets(root, scene, mats, bx + 4.5, -60, rand);
  }
  barrierRun(root, scene, mats, ox - 30, -74, 6, 0);
  guardPost(root, scene, mats, ox + 26, -70, Math.PI);
  fenceRun(root, scene, mats, ox + 38, -78, ox + 38, -20);
  sign(root, scene, mats, ox - 8, -76, 0, 3);

  shed(root, scene, mats, ox - 14, -50, 30, 22, 8, { doorsS: true, doorsE: true, partitions: 2 });
  shed(root, scene, mats, ox + 18, -46, 26, 24, 8, { doorsS: true, doorsW: true, doorsN: true, partitions: 2, rusty: true });
  shed(root, scene, mats, ox - 2, -22, 34, 18, 9, { doorsS: true, doorsW: true, partitions: 3 });

  // Cargo staged between the sheds — the reason the sheds exist, and the cover
  // that makes crossing between them a decision.
  pallets(root, scene, mats, ox + 2, -58, rand);
  pallets(root, scene, mats, ox + 5, -55, rand, 0.5);
  stores(root, scene, mats, ox - 30, -44, rand);
  stores(root, scene, mats, ox + 32, -34, rand);
  vehicle(root, scene, mats, ox + 30, -56, 1.6, "forklift");
  vehicle(root, scene, mats, ox - 30, -28, 0.2, "forklift");

  coveredWalk(root, scene, mats, ox + 2, -62, -36);
  // East of the sheds, clear of Shed 3's footprint — its low service pipe is
  // solid cover and used to reach inside the shed and block the interior.
  pipeRack(root, scene, mats, 98, -24, 40, 0);
  rubble(root, scene, mats, ox - 28, -34, rand);
  rubble(root, scene, mats, ox + 30, -30, rand);
  floodMast(root, scene, mats, ox - 34, -58);
  lampPost(root, scene, mats, ox + 38, -50, Math.PI / 2);
}

/** The middle band. Not an objective — the connective terrain that stops the map having a hollow centre. */
function buildMidYard(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // Drainage channel across the whole map: three bridges, so crossing north is
  // always a decision rather than a straight line.
  drainChannel(root, scene, mats, 4, -120, 120, [-62, 0, 64]);

  // Maintenance row down the centre, flanked by scattered stacks so the
  // crossing has cover on both approaches.
  shed(root, scene, mats, 0, -30, 22, 16, 7, { doorsS: true, doorsN: true, partitions: 1, rusty: true });
  containerBlock(root, scene, mats, -30, -18, 1, 3, 1301, Math.PI / 2);
  containerBlock(root, scene, mats, 18, -16, 1, 3, 1302, Math.PI / 2);

  // The workshop's yard: dead plant, drums, a jack stand. Explains the shed.
  vehicle(root, scene, mats, -12, -34, 0.8, "forklift");
  stores(root, scene, mats, 14, -34, rand);
  stores(root, scene, mats, -16, -24, rand);
  rubble(root, scene, mats, 10, -22, rand);

  pipeRack(root, scene, mats, -30, 18, 44, Math.PI / 2);
  pipeRack(root, scene, mats, 34, 20, 36, Math.PI / 2);
  guardPost(root, scene, mats, -60, 14, 0);
  guardPost(root, scene, mats, 62, 14, 0);
  barrierRun(root, scene, mats, 0, 16, 6, Math.PI / 2);
  sandbagPost(root, scene, mats, -8, 14, Math.PI);
  sandbagPost(root, scene, mats, 8, 14, Math.PI);

  vehicle(root, scene, mats, -44, 22, 0.6, "truck");
  vehicle(root, scene, mats, 46, 26, -0.4, "forklift");
  pallets(root, scene, mats, -48, 16, rand);
  rubble(root, scene, mats, -12, 22, rand);
  rubble(root, scene, mats, 14, 26, rand);
  floodMast(root, scene, mats, -24, 10);
  floodMast(root, scene, mats, 26, 10);
}

/** STRONGPOINT C — Pasir Panjang Power Station. Three levels; the fight climbs. */
function buildPowerStation(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ox = G.C;

  // Ground level: switchyard clutter and transformer blocks.
  fenceRun(root, scene, mats, ox - 34, 30, ox + 30, 30, 3);
  gate(root, scene, mats, ox - 10, 30, 0);
  for (let i = 0; i < 4; i++) {
    const tx = ox - 24 + i * 13;
    solid(root, scene, "transformer", 4.5, 3.4, 4.5, tx, 1.7, 36, mats.steel);
    decor(root, scene, "insulatorA", 0.6, 1.6, 0.6, tx - 1.2, 4.2, 36, mats.concrete);
    decor(root, scene, "insulatorB", 0.6, 1.6, 0.6, tx + 1.2, 4.2, 36, mats.concrete);
    decor(root, scene, "radiator", 0.5, 2.4, 4.0, tx - 2.6, 1.7, 36, mats.steel);
    // Every transformer sits in its own bunded gravel pit.
    decal(root, scene, "bund", 8, 8, tx, 36, mats.gravel, 0, 0.02);
    sign(root, scene, mats, tx, 32.4, 0, 1.2);
  }
  barrierRun(root, scene, mats, ox + 12, 40, 5, Math.PI / 2);
  guardPost(root, scene, mats, ox - 30, 38, -Math.PI / 2);

  // Boiler house: the solid mass the upper levels wrap around.
  shed(root, scene, mats, ox, 52, 30, 22, 10, { doorsS: true, doorsE: true, partitions: 2 });

  // Level 2 — turbine deck, on legs around the boiler house, reached by two
  // ramps on opposite sides so it can be flanked rather than only rushed.
  deck(root, scene, mats, ox - 18, 52, 14, 26, 6);
  deck(root, scene, mats, ox + 18, 50, 14, 26, 6);
  deck(root, scene, mats, ox, 68, 40, 10, 6);
  rampZ(root, scene, ox - 18, 36, 48, 0, 6, 3.5, mats.steel);
  rampZ(root, scene, ox + 18, 34, 46, 0, 6, 3.5, mats.steel);

  // Level 3 — control room over the north deck, the last position.
  deck(root, scene, mats, ox, 62, 22, 14, 12);
  rampX(root, scene, 68, ox - 16, ox - 2, 6, 12, 3.5, mats.steel);
  rampX(root, scene, 68, ox + 16, ox + 2, 6, 12, 3.5, mats.steel);
  solid(root, scene, "ctrlWall", 22, 3, 0.5, ox, 13.5, 55.4, mats.painted);
  decor(root, scene, "ctrlGlass", 18, 1.5, 0.14, ox, 14, 55.2, mats.glass);
  solid(root, scene, "ctrlWall", 0.5, 3, 14, ox - 11, 13.5, 62, mats.painted);
  solid(root, scene, "ctrlWall", 0.5, 3, 14, ox + 11, 13.5, 62, mats.painted);
  roofPanel(root, scene, "ctrlRoof", 22, 0.3, 14, ox, 15.2, 62, mats.corrugatedRust);

  // Stack — pure silhouette, so the objective is findable from across the map.
  const stack = MeshBuilder.CreateCylinder("pp_stack", { diameter: 7, height: 34, tessellation: 12 }, scene);
  stack.position.set(ox + 26, 17, 66);
  stack.material = mats.concrete as Mesh["material"];
  stack.checkCollisions = true;
  stack.parent = root;
  for (const y of [12, 22, 31]) decor(root, scene, "stackBand", 7.4, 0.5, 7.4, ox + 26, y, 66, mats.rust);

  // Cable runs and conduit from the switchyard into the plant.
  for (let i = 0; i < 3; i++) {
    decor(root, scene, "conduit", 0.35, 0.35, 18, ox - 6 + i * 6, 0.9, 42, mats.steel);
  }
  stores(root, scene, mats, ox - 28, 46, rand);
  pallets(root, scene, mats, ox + 26, 42, rand);
  rubble(root, scene, mats, ox - 28, 60, rand);
  pipeRack(root, scene, mats, ox, 40, 26, Math.PI / 2);
  floodMast(root, scene, mats, ox - 34, 56);
  lampPost(root, scene, mats, ox + 30, 34, Math.PI);
}

/** North-east storage. Fills what would otherwise be the map's one dead quarter. */
function buildNorthStorage(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // Tank farm, each tank inside its own bund wall — which is exactly the
  // chest-high cover the quarter needed.
  for (const [tx, tz] of [[46, 44], [62, 52], [44, 64], [64, 70]] as const) {
    const tank = MeshBuilder.CreateCylinder(`pp_tank_${uid++}`, { diameter: 11, height: 8, tessellation: 14 }, scene);
    tank.position.set(tx, 4, tz);
    tank.material = mats.rust as Mesh["material"];
    tank.checkCollisions = true;
    tank.parent = root;
    decor(root, scene, "tankTop", 11.4, 0.4, 11.4, tx, 8.1, tz, mats.steel);
    decor(root, scene, "tankLadder", 0.6, 8, 0.2, tx + 5.6, 4, tz, mats.steel);
    // Bund wall: a low square ring around the tank.
    for (const [dx, dz, w, d] of [[0, -8, 17, 0.6], [0, 8, 17, 0.6], [-8, 0, 0.6, 17], [8, 0, 0.6, 17]] as const) {
      solid(root, scene, "bundWall", w, 1.1, d, tx + dx, 0.55, tz + dz, mats.concrete);
    }
    decal(root, scene, "tankStain", 18, 18, tx, tz, mats.dirt, 0, 0.018);
  }
  // Pump house and manifold serving the farm.
  solid(root, scene, "pumpHouse", 7, 3.4, 6, 54, 1.7, 32, mats.concrete);
  roofPanel(root, scene, "pumpRoof", 8, 0.3, 7, 54, 3.5, 32, mats.corrugatedRust);
  for (let i = 0; i < 4; i++) decor(root, scene, "manifold", 0.4, 0.4, 12, 50 + i * 2.4, 1.0, 40, mats.rust);

  barrierRun(root, scene, mats, 54, 26, 8, 0);
  sign(root, scene, mats, 46, 28, 0, 2.6);
  shed(root, scene, mats, 92, 56, 24, 20, 8, { doorsW: true, doorsS: true, partitions: 2, rusty: true });
  containerBlock(root, scene, mats, 78, 76, 2, 2, 1401);
  pipeRack(root, scene, mats, 56, 84, 40, 0);
  vehicle(root, scene, mats, 34, 74, 1.2, "trailer");
  vehicle(root, scene, mats, 78, 40, 2.4, "truck");
  stores(root, scene, mats, 88, 40, rand);
  pallets(root, scene, mats, 96, 72, rand);
  rubble(root, scene, mats, 70, 40, rand);
  rubble(root, scene, mats, 88, 82, rand);
  floodMast(root, scene, mats, 74, 58);
  lampPost(root, scene, mats, 40, 36, 0);
}

/** STRONGPOINT D — Bukit Chandu. A walled compound climbing a ridge. The culmination. */
function buildBukitChandu(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // The ridge itself: two walkable terraces with ramps, so the whole objective
  // is fought uphill. This is the one place on the map with real relief, and
  // it earns it — the position exists because of the high ground.
  walkable(root, scene, "ridgeLower", 96, 3, 46, 0, 1.5, 96, mats.earth);
  walkable(root, scene, "ridgeUpper", 56, 3, 26, 0, 4.5, 114, mats.earth);
  rampZ(root, scene, -20, 76, 86, 0, 3, 6, mats.earth);
  rampZ(root, scene, 20, 76, 86, 0, 3, 6, mats.earth);
  rampZ(root, scene, -14, 100, 106, 3, 6, 5, mats.earth);
  rampZ(root, scene, 14, 100, 106, 3, 6, 5, mats.earth);
  // Cut earth faces either side of the ramps, so the terrace reads as dug.
  for (const s of [-1, 1]) {
    decor(root, scene, "cutFace", 26, 3, 1, s * 34, 1.5, 76, mats.earth);
  }

  // Outer wall with a single gate — the approach the player has to force.
  solid(root, scene, "chanduWall", 34, 4, 1.2, -30, 2, 76, mats.concrete);
  solid(root, scene, "chanduWall", 34, 4, 1.2, 30, 2, 76, mats.concrete);
  solid(root, scene, "chanduWall", 1.2, 4, 46, -47, 2, 96, mats.concrete);
  solid(root, scene, "chanduWall", 1.2, 4, 46, 47, 2, 96, mats.concrete);
  guardPost(root, scene, mats, -13, 72, 0);
  guardPost(root, scene, mats, 13, 72, 0);
  barrierRun(root, scene, mats, 0, 72, 4, Math.PI / 2);
  sign(root, scene, mats, 0, 68, 0, 3.4);
  // Wire obstacle across the dead ground below the wall.
  for (let i = -3; i <= 3; i++) {
    decor(root, scene, "wire", 6, 0.9, 0.9, i * 7, 0.5, 66, mats.steel);
  }

  // Courtyard: bunkers and sandbag lines on the lower terrace, plus the
  // vehicles and stores of a garrison that has been here a while.
  for (const bx of [-28, 0, 28]) {
    solid(root, scene, "bunker", 9, 3.2, 7, bx, 4.6, 92, mats.concrete);
    roofPanel(root, scene, "bunkerRoof", 10.5, 0.5, 8.5, bx, 6.4, 92, mats.concrete);
    decor(root, scene, "embrasure", 5, 0.7, 0.3, bx, 4.9, 88.4, mats.steel);
    sandbagPost(root, scene, mats, bx, 87.5, 0);
  }
  containerBlock(root, scene, mats, -40, 100, 1, 2, 1501);
  containerBlock(root, scene, mats, 30, 100, 1, 2, 1502);
  vehicle(root, scene, mats, -36, 88, 1.1, "truck");
  stores(root, scene, mats, 34, 88, rand);
  stores(root, scene, mats, -8, 100, rand);
  // Camouflage netting over the stores, on posts.
  for (const [nx, nz] of [[-8, 100], [34, 88]] as const) {
    roofPanel(root, scene, "camNet", 10, 0.14, 8, nx, 5.6, nz, mats.foliage[2]);
    for (const [dx, dz] of [[-4.5, -3.5], [4.5, -3.5], [-4.5, 3.5], [4.5, 3.5]] as const) {
      decor(root, scene, "netPost", 0.16, 2.6, 0.16, nx + dx, 4.3, nz + dz, mats.steel);
    }
  }

  // Ridge bunker: the final position, dug into the top terrace.
  solid(root, scene, "keepWall", 30, 4, 1.2, 0, 8, 104, mats.concrete);
  solid(root, scene, "keepWall", 1.2, 4, 22, -15, 8, 114, mats.concrete);
  solid(root, scene, "keepWall", 1.2, 4, 22, 15, 8, 114, mats.concrete);
  walkable(root, scene, "keepFloor", 28, 0.2, 20, 0, 6.1, 115, mats.concrete);
  roofPanel(root, scene, "keepRoof", 32, 0.6, 24, 0, 10, 115, mats.concrete);
  for (let i = -3; i <= 3; i++) {
    solid(root, scene, "keepBag", 1.8, 1.0, 0.9, i * 2.2, 6.6, 105.5, mats.sandbag);
  }
  decor(root, scene, "mast", 0.2, 9, 0.2, 12, 10.5, 118, mats.steel);
  rubble(root, scene, mats, -34, 88, rand);
  rubble(root, scene, mats, 36, 90, rand);
  floodMast(root, scene, mats, -40, 84);
  floodMast(root, scene, mats, 40, 84);
}

/**
 * The service road that ties the terminal together. A port is organised around
 * its roads, and having one makes the map legible: it tells the player which
 * way is "deeper in" without a marker.
 */
function buildRoadNetwork(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const laneW = 13;

  /** One straight run of road with kerbs, centre dashes and edge wear. */
  const road = (x: number, z: number, w: number, d: number, vertical: boolean) => {
    decal(root, scene, "road", w, d, x, z, mats.asphalt, 0, 0.01);
    // Kerbs: low, so they read from a distance without becoming an obstacle.
    if (vertical) {
      for (const s of [-1, 1]) {
        decor(root, scene, "kerb", 0.5, 0.3, d, x + s * (w / 2), 0.14, z, mats.concrete);
      }
      for (let i = -d / 2 + 3; i < d / 2; i += 8) {
        decal(root, scene, "dash", 0.4, 3.2, x, z + i, mats.roadLine, 0, 0.014);
      }
    } else {
      for (const s of [-1, 1]) {
        decor(root, scene, "kerb", w, 0.3, 0.5, x, 0.14, z + s * (d / 2), mats.concrete);
      }
      for (let i = -w / 2 + 3; i < w / 2; i += 8) {
        decal(root, scene, "dash", 3.2, 0.4, x + i, z, mats.roadLine, 0, 0.014);
      }
    }
  };

  // North–south spine from the quay to the foot of the ridge, broken at the
  // drainage channel where the bridge carries it.
  road(0, -88, laneW, 70, true);
  road(0, -40, laneW, 24, true);
  road(0, 40, laneW, 60, true);
  // East–west distributor serving the two southern objectives.
  road(0, -30, 200, laneW, false);
  // Northern distributor to the power station and tank farm.
  road(0, 30, 190, laneW, false);

  // Junction hatching and stop lines where the two cross.
  decal(root, scene, "stopLine", laneW, 0.6, 0, -37, mats.roadLine, 0, 0.015);
  decal(root, scene, "stopLine", laneW, 0.6, 0, 24, mats.roadLine, 0, 0.015);

  // Street furniture down the spine, alternating sides.
  for (let i = 0; i < 7; i++) {
    const z = -100 + i * 26;
    lampPost(root, scene, mats, i % 2 === 0 ? -9 : 9, z, i % 2 === 0 ? 0 : Math.PI);
  }
  // A pole line running parallel to the distributor, poles wired together.
  const poleZ = 22;
  for (let i = 0; i < 7; i++) {
    const x = -90 + i * 30;
    utilityPole(root, scene, mats, x, poleZ, i < 6 ? x + 30 : undefined, i < 6 ? poleZ : undefined);
  }
  // Edge wear and vegetation encroachment where the asphalt meets the yard.
  for (let i = 0; i < 16; i++) {
    const along = -120 + rand() * 240;
    decal(root, scene, "roadEdge", 4 + rand() * 7, 2.4, along, -30 + (rand() < 0.5 ? -7 : 7), mats.dirt, 0, 0.016);
  }
}

/** Terminal boundary — a hard edge just inside the nav bound, so nobody walks into the void. */
function buildPerimeter(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const h = TERMINAL_HALF_M - 2;
  for (const [x0, z0, x1, z1] of [
    [-h, h, h, h],
    [-h, -h, -h, h],
    [h, -h, h, h],
  ] as const) {
    fenceRun(root, scene, mats, x0, z0, x1, z1);
  }
  // The strip inside the fence: unmaintained, so it collects windblown rubbish
  // and the odd abandoned container.
  for (let i = 0; i < 5; i++) {
    containerStack(root, scene, mats, -h + 8, -80 + i * 40, 1, Math.PI / 2, i);
    containerStack(root, scene, mats, h - 8, -70 + i * 40, 1, Math.PI / 2, i + 2);
  }
  for (let i = 0; i < 6; i++) {
    rubble(root, scene, mats, -h + 12 + rand() * 6, -100 + rand() * 200, rand);
    rubble(root, scene, mats, h - 12 - rand() * 6, -100 + rand() * 200, rand);
  }
}

/**
 * Targeted infill for the areas a density audit flagged as bare.
 *
 * This is deliberately NOT a scatter pass. Each block below addresses one
 * specific empty region with content that belongs there — a staging yard where
 * the yard would stage, a chassis park where the trailers would be parked, a
 * rear echelon behind the ridge — so the fix reads as part of the terminal
 * rather than as filler.
 *
 * Every builder here uses its own generator, and the whole pass runs after the
 * rest of the map, so adding to it can never shift the props the strongpoint
 * anchors were verified against.
 */
function buildInfill(root: TransformNode, scene: Scene, mats: Mats): void {
  buildStagingYard(root, scene, mats);
  buildChassisPark(root, scene, mats);
  buildEastMarshalling(root, scene, mats);
  buildQuayEdge(root, scene, mats);
  buildRidgeRear(root, scene, mats);
  buildNorthApproach(root, scene, mats);
  buildSouthApproach(root, scene, mats);
}

/**
 * The open ground between the drainage channel and Bukit Chandu's outer wall.
 *
 * Left bare this was both the map's largest gap and its worst piece of design:
 * a 60m sprint at the hardest objective's guns with nothing to use. It is now
 * the site of an earlier attempt on the ridge that failed — burnt-out plant,
 * shell scrapes, hastily-dug scrapes and a collapsed shed. That reads as a
 * story, and mechanically it turns the approach into a series of bounds
 * between real cover instead of one long run across open ground.
 */
function buildNorthApproach(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7706);

  // Burnt-out vehicles, scattered as if they were hit moving up.
  for (const [x, z, r] of [[-26, 44, 0.6], [18, 52, -1.1], [-8, 62, 2.2], [34, 40, 0.3]] as const) {
    vehicle(root, scene, mats, x, z, r, "truck");
    decal(root, scene, "burn", 16, 14, x, z, mats.dirt, r, 0.02);
    rubble(root, scene, mats, x + 3, z + 3, rand);
  }

  // Shell scrapes: shallow craters ringed with spoil, giving prone cover.
  for (let i = 0; i < 9; i++) {
    const x = -46 + rand() * 92;
    const z = 34 + rand() * 34;
    decal(root, scene, "crater", 7 + rand() * 5, 6 + rand() * 4, x, z, mats.dirt, rand() * 3, 0.021);
    const n = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2 + rand();
      solid(root, scene, "spoil", 2.2, 0.7, 1.6, x + Math.cos(a) * 3.4, 0.35, z + Math.sin(a) * 3.4, mats.earth, a);
    }
  }

  // A collapsed transit shed — its frame still standing, walls down.
  for (let i = 0; i < 5; i++) {
    decor(root, scene, "wreckFrame", 0.4, 6, 0.4, -60 + i * 5, 3, 56, mats.rust);
  }
  decor(root, scene, "wreckBeam", 22, 0.5, 0.5, -50, 5.8, 56, mats.rust);
  for (let i = 0; i < 6; i++) {
    solid(root, scene, "fallenSheet", 6, 0.3, 4, -62 + rand() * 24, 0.15, 52 + rand() * 8, mats.corrugatedRust, rand() * 3);
  }
  rubble(root, scene, mats, -52, 50, rand);
  rubble(root, scene, mats, -44, 60, rand);

  // Hasty defensive line the earlier attempt dug in on before it broke.
  sandbagPost(root, scene, mats, -18, 36, 0);
  sandbagPost(root, scene, mats, 6, 38, 0);
  sandbagPost(root, scene, mats, 28, 34, 0);
  barrierRun(root, scene, mats, -34, 60, 5, 0);
  barrierRun(root, scene, mats, 40, 58, 5, 0);
  for (const [x, z] of [[-14, 66], [12, 68]] as const) {
    for (let i = -2; i <= 2; i++) decor(root, scene, "wire", 6, 0.9, 0.9, x + i * 6.5, 0.5, z, mats.steel);
  }
  floodMast(root, scene, mats, -44, 34);
  lampPost(root, scene, mats, 44, 50, Math.PI);
}

/**
 * The corridor between the quay and the two southern objectives, and the far
 * corners behind the ridge — the last thin spots the density audit flagged.
 */
function buildSouthApproach(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7707);
  // Staged boxes and barriers give the run inland something to bound between.
  containerBlock(root, scene, mats, -34, -74, 1, 2, 1901);
  containerBlock(root, scene, mats, 14, -74, 1, 2, 1902);
  barrierRun(root, scene, mats, -18, -68, 6, Math.PI / 2);
  barrierRun(root, scene, mats, 20, -70, 6, Math.PI / 2);
  pallets(root, scene, mats, -24, -64, rand);
  stores(root, scene, mats, 26, -64, rand);
  vehicle(root, scene, mats, -4, -72, 1.2, "trailer");
  lampPost(root, scene, mats, -12, -76, 0);
  lampPost(root, scene, mats, 12, -76, Math.PI);
  rubble(root, scene, mats, 4, -66, rand);

  // The wooded shoulders of the ridge, out past the compound walls. Props are
  // sparse here on purpose — it is flanking terrain, not a fighting position —
  // but it should not read as the edge of the world either.
  for (const sx of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const x = sx * (74 + i * 16);
      const z = 104 + rand() * 18;
      rubble(root, scene, mats, x, z, rand);
      if (i % 2 === 0) solid(root, scene, "boulder", 2.6, 1.8, 2.2, x + 6, 0.9, z - 6, mats.concrete, rand() * 3);
    }
    // A track contouring round the back of the ridge.
    decal(root, scene, "backTrack", 46, 8, sx * 86, 112, mats.dirt, 0, 0.016);
  }
}

/**
 * The band between the southern objectives and the drainage channel was the
 * map's biggest hole, and it is exactly where a terminal stages boxes waiting
 * for a ship: painted slot markings, low rows of empties, a weighbridge on the
 * road, and the lighting to work under. Cover here is low and regular, so the
 * crossing is survivable but never free.
 */
function buildStagingYard(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7701);

  // Painted stacking slots — the yard's grid, and the thing that makes the
  // area read as organised rather than abandoned.
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 2; j++) {
      const x = -84 + i * 24;
      const z = -16 + j * 12;
      decal(root, scene, "slot", 13, 3.4, x, z, mats.roadLine, 0, 0.013);
      decal(root, scene, "slotWear", 15, 9, x, z, mats.dirt, 0, 0.012);
    }
  }

  // Single-height rows of empties: chest-to-head cover that breaks the sightline
  // without walling the band off.
  containerBlock(root, scene, mats, -84, -18, 2, 2, 1801);
  containerBlock(root, scene, mats, -30, -18, 1, 2, 1802);
  containerBlock(root, scene, mats, 44, -18, 2, 2, 1803);

  // Weighbridge on the spine road — every box crossing the gate gets weighed.
  solid(root, scene, "weighDeck", 4.5, 0.35, 16, -12, 0.18, -12, mats.steel);
  solid(root, scene, "weighHut", 3.2, 3, 3.2, -18, 1.5, -12, mats.concrete);
  roofPanel(root, scene, "weighRoof", 4, 0.25, 4, -18, 3.1, -12, mats.corrugatedRust);
  decor(root, scene, "weighGlass", 2.2, 1.1, 0.12, -16.5, 2.0, -12, mats.glass, Math.PI / 2);
  sign(root, scene, mats, -12, -21, 0, 2.6);

  // Working kit, placed where the work happens.
  for (const [x, z] of [[-60, -12], [-6, -18], [26, -12], [58, -16]] as const) {
    pallets(root, scene, mats, x, z, rand);
    stores(root, scene, mats, x + 5, z + 4, rand);
  }
  vehicle(root, scene, mats, -40, -12, 1.5, "forklift");
  vehicle(root, scene, mats, 14, -16, -1.4, "forklift");
  vehicle(root, scene, mats, 68, -12, 0.2, "truck");
  floodMast(root, scene, mats, -52, -14);
  floodMast(root, scene, mats, 34, -14);
  lampPost(root, scene, mats, -10, -22, Math.PI);
  rubble(root, scene, mats, -70, -8, rand);
  rubble(root, scene, mats, 52, -8, rand);
}

/**
 * The flanks of the east–west distributor. A container terminal parks its
 * trailer chassis in long ranks, which happens to be ideal terrain: low, dense,
 * shoot-through-able cover that channels movement along the rows.
 */
function buildChassisPark(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7702);
  for (const [ox, oz, rows] of [[-34, -50, 4], [10, -50, 4], [-34, -34, 3], [30, -34, 3]] as const) {
    for (let r = 0; r < rows; r++) {
      const z = oz + r * 4.5;
      // A chassis is a long low skeletal frame — modelled as its rails.
      solid(root, scene, "chassisRail", 13, 0.7, 0.5, ox, 0.6, z - 0.7, mats.rust);
      solid(root, scene, "chassisRail", 13, 0.7, 0.5, ox, 0.6, z + 0.7, mats.rust);
      decor(root, scene, "chassisAxle", 1.2, 0.8, 2.4, ox + 5, 0.4, z, mats.steel);
      decor(root, scene, "chassisNeck", 3, 0.3, 0.4, ox - 7.4, 0.75, z, mats.rust);
    }
    decal(root, scene, "chassisStain", 20, rows * 5 + 3, ox, oz + (rows - 1) * 2.25, mats.dirt, 0, 0.014);
  }
  // Spreader beams and twistlock bins laid out at the end of the ranks.
  for (const [x, z] of [[-20, -42], [24, -42]] as const) {
    decor(root, scene, "spreaderLaid", 12, 0.7, 1.6, x, 0.35, z, mats.hazard);
    stores(root, scene, mats, x + 8, z, rand);
  }
  lampPost(root, scene, mats, -24, -38, 0);
  lampPost(root, scene, mats, 24, -38, Math.PI);
}

/**
 * East of the drainage channel, short of the tank farm: the truck marshalling
 * lanes where vehicles queue for the fuel point. Queue barriers give a run of
 * hard cover on an approach that was previously wide open.
 */
function buildEastMarshalling(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7703);
  for (let i = 0; i < 4; i++) {
    const x = 44 + i * 14;
    barrierRun(root, scene, mats, x, 12, 5, Math.PI / 2);
    decal(root, scene, "lane", 4, 26, x + 6, 12, mats.asphalt, 0, 0.012);
  }
  vehicle(root, scene, mats, 50, 6, 0, "truck");
  vehicle(root, scene, mats, 64, 8, 0, "trailer");
  vehicle(root, scene, mats, 92, 14, 0.3, "truck");
  // Fuel point: canopy, pumps, spill kit — the reason for the queue.
  roofPanel(root, scene, "fuelCanopy", 16, 0.4, 10, 98, 5.2, 6, mats.corrugated);
  for (const [dx, dz] of [[-7, -4], [7, -4], [-7, 4], [7, 4]] as const) {
    decor(root, scene, "canopyPost", 0.35, 5.2, 0.35, 98 + dx, 2.6, 6 + dz, mats.steel);
  }
  for (const dz of [-2, 2]) solid(root, scene, "pump", 1.1, 2.0, 0.8, 98, 1.0, 6 + dz, mats.hazard);
  decal(root, scene, "fuelStain", 20, 14, 98, 6, mats.dirt, 0, 0.016);
  stores(root, scene, mats, 106, 12, rand);
  sign(root, scene, mats, 90, 2, Math.PI / 2, 2.4);
  floodMast(root, scene, mats, 78, 16);
  rubble(root, scene, mats, 108, 20, rand);
}

/**
 * The outer quay strip either side of the landing. A working wharf keeps its
 * mooring gear, hatch covers and lashing bins on the apron, which also gives
 * the Ranger Gauntlet's opening waves something to fight around.
 */
function buildQuayEdge(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7704);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const x = side * (62 + i * 18);
      // Mooring winch: a drum on a bedplate.
      solid(root, scene, "winchBed", 3.4, 0.5, 2.6, x, 0.25, -112, mats.concrete);
      const drum = MeshBuilder.CreateCylinder(`pp_winchDrum_${uid++}`, { diameter: 1.5, height: 2.2, tessellation: 10 }, scene);
      drum.position.set(x, 1.1, -112);
      drum.rotation.z = Math.PI / 2;
      drum.material = mats.rust as Mesh["material"];
      drum.checkCollisions = true;
      drum.parent = root;
      // Stacked hatch covers — big flat slabs, waist-high cover.
      for (let h = 0; h < 2 + Math.floor(rand() * 2); h++) {
        solid(root, scene, "hatchCover", 9, 0.5, 5, x - side * 9, 0.25 + h * 0.55, -105, mats.rust, rand() * 0.1);
      }
      stores(root, scene, mats, x + side * 6, -100, rand);
    }
    // Lashing bins and a bunkering hose reel at the ends of the strip.
    pallets(root, scene, mats, side * 104, -108, rand);
    decor(root, scene, "hoseReel", 2.2, 2.2, 1.2, side * 96, 1.1, -114, mats.hazard);
    lampPost(root, scene, mats, side * 88, -104, side > 0 ? Math.PI : 0);
  }
  // Pilot/foreman's hut watching the berth.
  solid(root, scene, "pilotHut", 5, 3.2, 4, -104, 1.6, -96, mats.concrete);
  roofPanel(root, scene, "pilotRoof", 6, 0.3, 5, -104, 3.4, -96, mats.corrugatedRust);
  decor(root, scene, "pilotGlass", 3.4, 1.2, 0.12, -104, 2.2, -98, mats.glass);
}

/**
 * Behind Bukit Chandu: the garrison's rear echelon on the reverse slope, where
 * a real position keeps the things it does not want under direct fire —
 * ammunition, fuel, transport — plus a track down the back.
 */
function buildRidgeRear(root: TransformNode, scene: Scene, mats: Mats): void {
  const rand = mulberry32(7705);
  // Earth revetments: U-shaped berms, open to the rear.
  for (const rx of [-52, 52]) {
    solid(root, scene, "revetBack", 14, 2.4, 1.4, rx, 1.2 + 3, 104, mats.earth);
    solid(root, scene, "revetSide", 1.4, 2.4, 10, rx - 6.5, 1.2 + 3, 109, mats.earth);
    solid(root, scene, "revetSide", 1.4, 2.4, 10, rx + 6.5, 1.2 + 3, 109, mats.earth);
    vehicle(root, scene, mats, rx, 110, rx < 0 ? 0.2 : -0.2, "truck");
    stores(root, scene, mats, rx, 116, rand);
  }
  // Ammunition bunkers dug into the reverse slope, with blast walls.
  for (const bx of [-22, 22]) {
    solid(root, scene, "ammoBunker", 8, 2.8, 6, bx, 4.4 + 3, 122, mats.concrete);
    roofPanel(root, scene, "ammoRoof", 9.5, 0.5, 7.5, bx, 5.9 + 3, 122, mats.earth);
    solid(root, scene, "blastWall", 11, 2.6, 1.0, bx, 4.3 + 3, 117, mats.concrete);
    pallets(root, scene, mats, bx + 5, 118, rand);
    sign(root, scene, mats, bx, 115, 0, 1.8);
  }
  // The track down the reverse slope, and a west vehicle park in the courtyard.
  rampZ(root, scene, -66, 88, 100, 0, 3, 7, mats.earth);
  vehicle(root, scene, mats, -62, 92, 1.5, "truck");
  vehicle(root, scene, mats, -58, 100, 1.5, "trailer");
  stores(root, scene, mats, -68, 96, rand);
  sandbagPost(root, scene, mats, -44, 92, Math.PI / 2);
  rubble(root, scene, mats, -70, 104, rand);
  floodMast(root, scene, mats, 0, 124);
}

/**
 * Where the greenery goes. A working terminal is not overgrown, so vegetation
 * is confined to the places a port actually has it: the fence line, the
 * drainage margins, the corners nobody sweeps, and the ridge above the yard —
 * which, being Bukit Chandu, is genuinely secondary forest.
 *
 * Nothing is planted on the apron, in the container lanes, or across the
 * approach to any objective, so combat routes stay readable.
 */
function buildVegetation(root: TransformNode, scene: Scene, mats: Mats): void {
  const patches: FoliagePatch[] = [
    // Perimeter strip, all four sides.
    { x: -120, z: -60, r: 20, density: 3, trees: true },
    { x: -120, z: 10, r: 20, density: 3, trees: true },
    { x: -118, z: 70, r: 18, density: 2.5, trees: true },
    { x: 120, z: -60, r: 20, density: 3, trees: true },
    { x: 120, z: 10, r: 20, density: 3, trees: true },
    { x: 118, z: 78, r: 18, density: 2.5, trees: true },
    { x: -60, z: 122, r: 22, density: 3.5, trees: true },
    { x: 60, z: 122, r: 22, density: 3.5, trees: true },
    // Drainage margins — damp ground, so this is the thickest growth in the yard.
    { x: -100, z: 4, r: 12, density: 3, trees: false },
    { x: 100, z: 4, r: 12, density: 3, trees: false },
    { x: -32, z: 4, r: 9, density: 2, trees: false },
    { x: 32, z: 4, r: 9, density: 2, trees: false },
    // The Bukit Chandu ridge: secondary forest on the slopes, thinning where
    // the compound is cut into it.
    { x: -40, z: 96, r: 16, density: 3, y: 3, trees: true },
    { x: 40, z: 96, r: 16, density: 3, y: 3, trees: true },
    { x: -34, z: 116, r: 14, density: 2.5, y: 6, trees: true },
    { x: 34, z: 116, r: 14, density: 2.5, y: 6, trees: true },
    { x: 0, z: 124, r: 18, density: 3, y: 6, trees: true },
    // Neglected corners of the yard itself.
    { x: -104, z: -100, r: 13, density: 2, trees: true },
    { x: 104, z: -104, r: 13, density: 2, trees: true },
    { x: -100, z: 86, r: 14, density: 2.5, trees: true },
    { x: 16, z: 84, r: 10, density: 1.6, trees: false },
    { x: -20, z: 60, r: 9, density: 1.4, trees: false },
  ];
  buildTerminalFoliage(root, scene, mats, patches);

  // Grass under the planted patches, so the plants sit on green rather than
  // appearing to grow out of bare concrete.
  for (const p of patches) {
    decal(root, scene, "grassBed", p.r * 2.1, p.r * 2.1, p.x, p.z, mats.grass, 0, (p.y ?? 0) + 0.012);
  }
}

/**
 * Flood lighting. Kept sparse on purpose: WorldMaterial allows 8 simultaneous
 * lights and the static rig already claims four, so a denser grid would start
 * evicting the sun/fill/flashlight on nearby geometry. The visible masts and
 * lamp heads are dressed separately (see floodMast/lampPost) — these are just
 * the six that actually cast.
 */
function buildLighting(root: TransformNode, scene: Scene): void {
  const spots: Array<[number, number, number]> = [
    [0, -100, 0.5],
    [G.A, -50, 0.55],
    [G.B, -46, 0.55],
    [0, 10, 0.42],
    [G.C, 52, 0.6],
    [0, 100, 0.6],
  ];
  for (const [x, z, intensity] of spots) {
    const light = new PointLight(`ppFlood_${uid++}`, new Vector3(x, 15, z), scene);
    light.diffuse = new Color3(0.92, 0.87, 0.72);
    light.intensity = intensity;
    light.range = 70;
    light.parent = root;
  }
}
