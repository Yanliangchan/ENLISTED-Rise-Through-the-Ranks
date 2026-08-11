import { Scene, Mesh, MeshBuilder, TransformNode, Vector3, Color3, PointLight } from "@babylonjs/core";
import { WorldMaterial } from "@/world/WorldMaterial";
import { mulberry32, solidMat } from "@/world/Level";

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
 * is BOTH `isPickable` and `checkCollisions`). Every mesh here picks one of
 * four roles, and the whole map's AI navigability follows from that choice:
 *
 *   solid cover      pickable + collides                  → blocks nav (containers, walls, tanks)
 *   walkable surface pickable + collides + walkable tag    → navigable at any height (floors, ramps, decks)
 *   roof over interior  NOT pickable + collides            → ray passes through to the floor below, so
 *                                                            the interior stays navigable; still stops
 *                                                            anyone walking in from above
 *   thin decoration  pickable + NO collision               → bullets stop on it, nav and movement ignore it
 *                                                            (handrails, pipes, cables, signage)
 *
 * The one rule with no workaround: a walkable roof and a navigable interior
 * cannot share an (x,z) column, because the ray stops at whichever is on top.
 * Interiors won, so rooftops here are non-pickable and verticality comes from
 * open decks, gantries and the Bukit Chandu ridge instead.
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
 */
const STRONGPOINT_DEFS: TerminalStrongpointDef[] = [
  {
    id: "distripark",
    name: "Keppel Distripark",
    center: new Vector3(G.A, 0, -52),
    activationRadiusM: 30,
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
        label: "CONTAINER LANES",
        anchors: [new Vector3(G.A - 6, 0, -52), new Vector3(G.A + 10, 0, -44), new Vector3(G.A - 22, 0, -40)],
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
        // Second-level deck: the fight goes vertical, with defenders shooting
        // down the ramps the player has to climb.
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
// Materials — built once per map build and shared by every prop.
// ---------------------------------------------------------------------------

interface Mats {
  tarmac: WorldMaterial;
  concrete: WorldMaterial;
  steel: WorldMaterial;
  rust: WorldMaterial;
  paintedSteel: WorldMaterial;
  roof: WorldMaterial;
  sandbag: WorldMaterial;
  hazard: WorldMaterial;
  lamp: WorldMaterial;
  earth: WorldMaterial;
  containers: WorldMaterial[];
}

function buildMats(scene: Scene): Mats {
  const matte = (name: string, c: Color3): WorldMaterial => {
    const m = solidMat(scene, name, c);
    m.specularColor = Color3.Black();
    return m;
  };
  const lamp = matte("ppLamp", new Color3(0.95, 0.9, 0.7));
  lamp.emissiveColor = new Color3(0.9, 0.85, 0.62); // reads as the source of the flood pool below it
  return {
    tarmac: matte("ppTarmac", new Color3(0.085, 0.088, 0.095)),
    concrete: matte("ppConcrete", new Color3(0.29, 0.29, 0.28)),
    steel: matte("ppSteel", new Color3(0.2, 0.21, 0.23)),
    rust: matte("ppRust", new Color3(0.32, 0.17, 0.1)),
    paintedSteel: matte("ppPainted", new Color3(0.36, 0.4, 0.38)),
    roof: matte("ppRoof", new Color3(0.16, 0.17, 0.18)),
    sandbag: matte("ppSandbag", new Color3(0.38, 0.35, 0.26)),
    hazard: matte("ppHazard", new Color3(0.6, 0.52, 0.12)),
    lamp,
    earth: matte("ppEarth", new Color3(0.19, 0.17, 0.12)),
    containers: [
      matte("ppCon0", new Color3(0.42, 0.13, 0.1)),
      matte("ppCon1", new Color3(0.1, 0.24, 0.36)),
      matte("ppCon2", new Color3(0.13, 0.31, 0.16)),
      matte("ppCon3", new Color3(0.44, 0.36, 0.09)),
      matte("ppCon4", new Color3(0.3, 0.3, 0.31)),
    ],
  };
}

// ---------------------------------------------------------------------------
// Primitive helpers — every mesh in the map goes through one of these, so the
// nav contract above is enforced in exactly four places.
// ---------------------------------------------------------------------------

let uid = 0;

/** Solid cover: blocks bullets, movement and AI pathing. */
function solid(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: WorldMaterial, rotY = 0): Mesh {
  const m = MeshBuilder.CreateBox(`pp_${name}_${uid++}`, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.material = mat;
  m.checkCollisions = true;
  m.parent = root;
  return m;
}

/** A surface the player and AI can stand on, at any height. */
function walkable(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: WorldMaterial, rotY = 0): Mesh {
  const m = solid(root, scene, name, w, h, d, x, y, z, mat, rotY);
  m.metadata = { walkable: true };
  return m;
}

/** Roof over a navigable interior — invisible to the nav ray so the floor below still resolves. */
function roofPanel(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: WorldMaterial): Mesh {
  const m = solid(root, scene, name, w, h, d, x, y, z, mat);
  m.isPickable = false;
  return m;
}

/** Thin dressing — stops bullets, but never blocks movement or pathing. */
function decor(root: TransformNode, scene: Scene, name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: WorldMaterial, rotY = 0): Mesh {
  const m = MeshBuilder.CreateBox(`pp_${name}_${uid++}`, { width: w, height: h, depth: d }, scene);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.material = mat;
  m.checkCollisions = false;
  m.parent = root;
  return m;
}

/** Axis-aligned walkable ramp running along Z. Axis-aligned keeps the pitch maths exact and the nav ray honest. */
function rampZ(root: TransformNode, scene: Scene, x: number, z0: number, z1: number, y0: number, y1: number, width: number, mat: WorldMaterial): void {
  const dz = z1 - z0;
  const dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const m = MeshBuilder.CreateBox(`pp_ramp_${uid++}`, { width, height: 0.3, depth: len }, scene);
  m.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(dy, dz);
  m.material = mat;
  m.checkCollisions = true;
  m.metadata = { walkable: true };
  m.parent = root;
}

/** Axis-aligned walkable ramp running along X. */
function rampX(root: TransformNode, scene: Scene, z: number, x0: number, x1: number, y0: number, y1: number, width: number, mat: WorldMaterial): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const m = MeshBuilder.CreateBox(`pp_ramp_${uid++}`, { width: len, height: 0.3, depth: width }, scene);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  m.rotation.z = Math.atan2(dy, dx);
  m.material = mat;
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
 * A run of container stacks with a deliberate lane down one side. `lanes` is
 * what turns a block of boxes into terrain: gaps wide enough to fight down,
 * narrow enough that crossing one exposes you.
 */
function containerBlock(
  root: TransformNode,
  scene: Scene,
  mats: Mats,
  originX: number,
  originZ: number,
  cols: number,
  rows: number,
  rand: () => number,
  rotY = 0
): void {
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (rand() < 0.16) continue; // gaps: cross-lanes and collapsed slots
      const x = originX + c * (CON_W + 4.5);
      const z = originZ + r * (CON_D + 5.5);
      const h = 1 + Math.floor(rand() * 3); // 1–3 high: varied sightline breaks
      containerStack(root, scene, mats, x, z, h, rotY, Math.floor(rand() * 5));
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
  opts: { doorsN?: boolean; doorsS?: boolean; doorsE?: boolean; doorsW?: boolean; partitions?: number } = {}
): void {
  const t = 0.6;
  const doorW = 6;
  const hw = w / 2;
  const hd = d / 2;

  // Interior floor, raised a hair above the tarmac so it wins the nav ray.
  walkable(root, scene, "shedFloor", w - t, 0.12, d - t, cx, 0.06, cz, mats.concrete);

  // Each wall is built as up to three segments so a door gap is a real hole
  // rather than a decorative decal the AI would refuse to path through.
  const wallX = (z: number, hasDoor: boolean) => {
    if (!hasDoor) {
      solid(root, scene, "shedWall", w, h, t, cx, h / 2, z, mats.paintedSteel);
      return;
    }
    const seg = (w - doorW) / 2;
    solid(root, scene, "shedWall", seg, h, t, cx - (doorW / 2 + seg / 2), h / 2, z, mats.paintedSteel);
    solid(root, scene, "shedWall", seg, h, t, cx + (doorW / 2 + seg / 2), h / 2, z, mats.paintedSteel);
    solid(root, scene, "shedLintel", doorW, h - 4.2, t, cx, h - (h - 4.2) / 2, z, mats.paintedSteel);
  };
  const wallZ = (x: number, hasDoor: boolean) => {
    if (!hasDoor) {
      solid(root, scene, "shedWall", t, h, d, x, h / 2, cz, mats.paintedSteel);
      return;
    }
    const seg = (d - doorW) / 2;
    solid(root, scene, "shedWall", t, h, seg, x, h / 2, cz - (doorW / 2 + seg / 2), mats.paintedSteel);
    solid(root, scene, "shedWall", t, h, seg, x, h / 2, cz + (doorW / 2 + seg / 2), mats.paintedSteel);
    solid(root, scene, "shedLintel", t, h - 4.2, doorW, x, h - (h - 4.2) / 2, cz, mats.paintedSteel);
  };

  wallX(cz - hd, !!opts.doorsS);
  wallX(cz + hd, !!opts.doorsN);
  wallZ(cx - hw, !!opts.doorsW);
  wallZ(cx + hw, !!opts.doorsE);

  roofPanel(root, scene, "shedRoof", w, 0.4, d, cx, h, cz, mats.roof);

  // Internal partitions with offset gaps — the blind corners that make the
  // interior a fight instead of a corridor.
  const partitions = opts.partitions ?? 0;
  for (let i = 1; i <= partitions; i++) {
    const px = cx - hw + (w / (partitions + 1)) * i;
    const gapZ = cz + (i % 2 === 0 ? d * 0.22 : -d * 0.22);
    const segLen = (d - 5) / 2;
    solid(root, scene, "shedPart", 0.5, h - 1.4, segLen, px, (h - 1.4) / 2, gapZ - (2.5 + segLen / 2), mats.steel);
    solid(root, scene, "shedPart", 0.5, h - 1.4, segLen, px, (h - 1.4) / 2, gapZ + (2.5 + segLen / 2), mats.steel);
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

/** Guard post: a small hut with a sandbagged firing position — the standard junction hardpoint. */
function guardPost(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number): void {
  solid(root, scene, "postHut", 3.4, 3, 3.4, x, 1.5, z, mats.concrete, rotY);
  roofPanel(root, scene, "postRoof", 4.2, 0.25, 4.2, x, 3.1, z, mats.roof);
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

/** Chain-link perimeter. Solid enough to path around, low enough to shoot over from cover. */
function fenceRun(root: TransformNode, scene: Scene, mats: Mats, x0: number, z0: number, x1: number, z1: number, gapAt?: number): void {
  const segs = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 8));
  for (let i = 0; i < segs; i++) {
    if (gapAt !== undefined && i === gapAt) continue; // gate
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const mx = x0 + (x1 - x0) * ((t0 + t1) / 2);
    const mz = z0 + (z1 - z0) * ((t0 + t1) / 2);
    const len = Math.hypot((x1 - x0) * (t1 - t0), (z1 - z0) * (t1 - t0));
    const rot = Math.atan2(x1 - x0, z1 - z0);
    solid(root, scene, "fence", 0.15, 2.6, len, mx, 1.3, mz, mats.steel, rot);
  }
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
    decor(root, scene, "pipe", 0.45, 0.45, len, x + cos * 0 + sin * 0.9, 4.0 + dy, z + cos * 0.9, mats.steel, rotY);
  }
  // Waist-high service pipe you can drop behind.
  solid(root, scene, "pipeLow", 0.9, 0.9, len * 0.6, x, 0.45, z, mats.rust, rotY);
}

/** Covered walkway — a canopy on posts. Non-pickable roof keeps the path beneath it navigable. */
function coveredWalk(root: TransformNode, scene: Scene, mats: Mats, x: number, z0: number, z1: number): void {
  const len = z1 - z0;
  roofPanel(root, scene, "walkRoof", 5, 0.25, len, x, 3.4, z0 + len / 2, mats.roof);
  for (let i = 0; i <= Math.floor(Math.abs(len) / 8); i++) {
    const z = z0 + Math.sign(len) * i * 8;
    for (const sx of [-1, 1]) decor(root, scene, "walkPost", 0.3, 3.4, 0.3, x + sx * 2.3, 1.7, z, mats.steel);
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
  for (const bx of bridgeXs) {
    walkable(root, scene, "drainBridge", 7, 0.3, width + 2.4, bx, 1.35, z, mats.concrete);
    for (const sz of [-1, 1]) decor(root, scene, "bridgeRail", 7, 0.9, 0.12, bx, 1.9, z + sz * (width / 2 + 1), mats.steel);
  }
}

/** Parked plant: trucks, trailers, forklifts. Hard cover that breaks up open tarmac. */
function vehicle(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rotY: number, kind: "truck" | "trailer" | "forklift"): void {
  if (kind === "forklift") {
    solid(root, scene, "fork", 2.2, 1.8, 3.2, x, 0.9, z, mats.hazard, rotY);
    decor(root, scene, "forkMast", 0.5, 2.6, 0.4, x, 2.6, z, mats.steel, rotY);
    return;
  }
  if (kind === "trailer") {
    solid(root, scene, "trailerBed", 2.6, 1.1, 12, x, 1.1, z, mats.rust, rotY);
    for (const dz of [-4.5, 4.2]) decor(root, scene, "wheel", 2.7, 0.9, 0.9, x, 0.45, z + dz, mats.steel, rotY);
    return;
  }
  solid(root, scene, "truckCab", 2.6, 2.8, 3.4, x, 1.4, z, mats.paintedSteel, rotY);
  solid(root, scene, "truckBox", 2.7, 3.0, 8, x - Math.sin(rotY) * 5.8, 1.7, z - Math.cos(rotY) * 5.8, mats.containers[1], rotY);
}

/** Rubble/clutter — cheap low cover that keeps open ground from reading as empty. */
function rubble(root: TransformNode, scene: Scene, mats: Mats, x: number, z: number, rand: () => number): void {
  const n = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.7 + rand() * 1.5;
    solid(root, scene, "rubble", s, s * 0.7, s, x + (rand() - 0.5) * 5, s * 0.35, z + (rand() - 0.5) * 5, rand() < 0.5 ? mats.concrete : mats.rust, rand() * 3);
  }
}

/** Gantry crane straddling a container lane — the terminal's skyline, and a climbable deck. */
function gantryCrane(root: TransformNode, scene: Scene, mats: Mats, cx: number, cz: number): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      solid(root, scene, "craneLeg", 1.2, 16, 1.2, cx + sx * 13, 8, cz + sz * 7, mats.hazard);
    }
  }
  decor(root, scene, "craneBeam", 30, 1.6, 2.2, cx, 16.6, cz, mats.hazard);
  decor(root, scene, "craneBoom", 2.0, 1.2, 34, cx, 18.4, cz, mats.steel);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildPasirPanjang(scene: Scene): PasirPanjangHandles {
  const root = new TransformNode("pasirPanjangRoot", scene);
  const mats = buildMats(scene);
  const rand = mulberry32(90417);

  // Ground. Deliberately not named "ground" — the Singapore map already owns
  // that name in Nav.ts's fallback check; this one qualifies via the walkable
  // tag instead, the same route Iron Citadel's floors take.
  const ground = MeshBuilder.CreateGround("ppTerminalGround", { width: 280, height: 280 }, scene);
  ground.material = mats.tarmac;
  ground.checkCollisions = true;
  ground.metadata = { walkable: true };
  ground.parent = root;

  buildQuayApproach(root, scene, mats, rand);
  buildDistripark(root, scene, mats, rand);
  buildWharves(root, scene, mats, rand);
  buildMidYard(root, scene, mats, rand);
  buildPowerStation(root, scene, mats, rand);
  buildNorthStorage(root, scene, mats, rand);
  buildBukitChandu(root, scene, mats, rand);
  buildPerimeter(root, scene, mats);
  buildLighting(root, scene, mats);

  root.setEnabled(false);
  return { root, spawn: TERMINAL_SPAWN, strongpointDefs: STRONGPOINT_DEFS };
}

/** South quay: the insertion point and the funnel inland. Open, but not bare. */
function buildQuayApproach(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // Seawall along the southern edge.
  solid(root, scene, "seawall", 260, 2.2, 1.6, 0, 1.1, -127, mats.concrete);
  for (let i = 0; i < 9; i++) {
    solid(root, scene, "bollard", 1.1, 1.3, 1.1, -110 + i * 27, 0.65, -123, mats.steel);
  }

  // Landing zone: sandbagged, so the player has something to fall back into
  // during the Ranger Gauntlet rather than standing on open tarmac.
  for (let i = -3; i <= 3; i++) {
    solid(root, scene, "lzBag", 2.0, 1.1, 1.0, i * 3.2, 0.55, -108, mats.sandbag);
  }
  barrierRun(root, scene, mats, -14, -100, 4, 0);
  barrierRun(root, scene, mats, 14, -100, 4, 0);
  guardPost(root, scene, mats, -22, -98, Math.PI / 2);
  guardPost(root, scene, mats, 22, -98, -Math.PI / 2);

  // Quayside container rows either side of the approach — immediate cover off
  // the landing, and the first taste of the lane fighting inland.
  containerBlock(root, scene, mats, -46, -104, 2, 3, rand);
  containerBlock(root, scene, mats, 22, -104, 2, 3, rand);
  gantryCrane(root, scene, mats, -34, -92);
  gantryCrane(root, scene, mats, 36, -92);

  vehicle(root, scene, mats, -8, -88, 0, "trailer");
  vehicle(root, scene, mats, 10, -84, Math.PI, "truck");
  coveredWalk(root, scene, mats, 0, -104, -78);
  rubble(root, scene, mats, -18, -86, rand);
  rubble(root, scene, mats, 20, -78, rand);
}

/** STRONGPOINT A — Keppel Distripark. Open container yard, long lanes, marksman country. */
function buildDistripark(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ox = G.A;

  fenceRun(root, scene, mats, ox - 40, -78, ox + 26, -78, 4); // gate on the approach side
  fenceRun(root, scene, mats, ox - 40, -78, ox - 40, -18);
  guardPost(root, scene, mats, ox + 20, -74, Math.PI);

  // Three long lanes running north–south. Wide spacing is the point: this is
  // the objective where the player gets shot at from 60m.
  containerBlock(root, scene, mats, ox - 34, -70, 2, 5, rand);
  containerBlock(root, scene, mats, ox - 4, -70, 2, 5, rand);
  containerBlock(root, scene, mats, ox + 12, -66, 1, 4, rand);

  gantryCrane(root, scene, mats, ox - 12, -58);
  vehicle(root, scene, mats, ox + 16, -50, Math.PI / 2, "forklift");
  vehicle(root, scene, mats, ox - 20, -34, 0, "trailer");

  // The keep at the back of the yard: a tight ring of stacks with a raised
  // deck overlooking the only clean approach.
  containerStack(root, scene, mats, ox - 30, -28, 3, 0, 1);
  containerStack(root, scene, mats, ox - 30, -18, 3, 0, 3);
  containerStack(root, scene, mats, ox - 18, -30, 2, Math.PI / 2, 2);
  deck(root, scene, mats, ox - 24, -23, 12, 9, 6);
  rampZ(root, scene, ox - 20, -36, -28, 0, 6, 3, mats.steel);
  barrierRun(root, scene, mats, ox - 10, -24, 5, Math.PI / 2);
  rubble(root, scene, mats, ox - 6, -40, rand);
}

/** STRONGPOINT B — Pasir Panjang Wharves. Three transit sheds: doors, partitions, no long shots. */
function buildWharves(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ox = G.B;

  // Loading bays out front: trucks nose-in to the shed doors.
  for (let i = 0; i < 4; i++) {
    vehicle(root, scene, mats, ox - 24 + i * 15, -68, 0, i % 2 === 0 ? "truck" : "trailer");
  }
  barrierRun(root, scene, mats, ox - 30, -74, 6, 0);
  guardPost(root, scene, mats, ox + 26, -70, Math.PI);
  fenceRun(root, scene, mats, ox + 38, -78, ox + 38, -20);

  shed(root, scene, mats, ox - 14, -50, 30, 22, 8, { doorsS: true, doorsE: true, partitions: 2 });
  shed(root, scene, mats, ox + 18, -46, 26, 24, 8, { doorsS: true, doorsW: true, doorsN: true, partitions: 2 });
  shed(root, scene, mats, ox - 2, -22, 34, 18, 9, { doorsS: true, doorsW: true, partitions: 3 });

  coveredWalk(root, scene, mats, ox + 2, -62, -36);
  // East of the sheds, clear of Shed 3's footprint — its low service pipe is
  // solid cover and used to reach inside the shed and block the interior.
  pipeRack(root, scene, mats, 98, -24, 40, 0);
  rubble(root, scene, mats, ox - 28, -34, rand);
  rubble(root, scene, mats, ox + 30, -30, rand);
}

/** The middle band. Not an objective — the connective terrain that stops the map having a hollow centre. */
function buildMidYard(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // Drainage channel across the whole map: three bridges, so crossing north is
  // always a decision rather than a straight line.
  drainChannel(root, scene, mats, 4, -120, 120, [-62, 0, 64]);

  // Maintenance row down the centre, flanked by scattered stacks so the
  // crossing has cover on both approaches.
  shed(root, scene, mats, 0, -30, 22, 16, 7, { doorsS: true, doorsN: true, partitions: 1 });
  containerBlock(root, scene, mats, -30, -18, 1, 3, rand, Math.PI / 2);
  containerBlock(root, scene, mats, 18, -16, 1, 3, rand, Math.PI / 2);

  pipeRack(root, scene, mats, -30, 18, 44, Math.PI / 2);
  pipeRack(root, scene, mats, 34, 20, 36, Math.PI / 2);
  guardPost(root, scene, mats, -60, 14, 0);
  guardPost(root, scene, mats, 62, 14, 0);
  barrierRun(root, scene, mats, 0, 16, 6, Math.PI / 2);

  vehicle(root, scene, mats, -44, 22, 0.6, "truck");
  vehicle(root, scene, mats, 46, 26, -0.4, "forklift");
  rubble(root, scene, mats, -12, 22, rand);
  rubble(root, scene, mats, 14, 26, rand);
}

/** STRONGPOINT C — Pasir Panjang Power Station. Three levels; the fight climbs. */
function buildPowerStation(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  const ox = G.C;

  // Ground level: switchyard clutter and transformer blocks.
  fenceRun(root, scene, mats, ox - 34, 30, ox + 30, 30, 3);
  for (let i = 0; i < 4; i++) {
    solid(root, scene, "transformer", 4.5, 3.4, 4.5, ox - 24 + i * 13, 1.7, 36, mats.steel);
    decor(root, scene, "insulator", 0.6, 1.6, 0.6, ox - 24 + i * 13, 4.2, 36, mats.concrete);
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
  solid(root, scene, "ctrlWall", 22, 3, 0.5, ox, 13.5, 55.4, mats.paintedSteel);
  solid(root, scene, "ctrlWall", 0.5, 3, 14, ox - 11, 13.5, 62, mats.paintedSteel);
  solid(root, scene, "ctrlWall", 0.5, 3, 14, ox + 11, 13.5, 62, mats.paintedSteel);
  roofPanel(root, scene, "ctrlRoof", 22, 0.3, 14, ox, 15.2, 62, mats.roof);

  // Stack — pure silhouette, so the objective is findable from across the map.
  const stack = MeshBuilder.CreateCylinder("pp_stack", { diameter: 7, height: 34 }, scene);
  stack.position.set(ox + 26, 17, 66);
  stack.material = mats.concrete;
  stack.checkCollisions = true;
  stack.parent = root;

  rubble(root, scene, mats, ox - 28, 60, rand);
  pipeRack(root, scene, mats, ox, 40, 26, Math.PI / 2);
}

/** North-east storage. Fills what would otherwise be the map's one dead quarter. */
function buildNorthStorage(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  for (const [tx, tz] of [[46, 44], [62, 52], [44, 64], [64, 70]] as const) {
    const tank = MeshBuilder.CreateCylinder(`pp_tank_${uid++}`, { diameter: 11, height: 8 }, scene);
    tank.position.set(tx, 4, tz);
    tank.material = mats.rust;
    tank.checkCollisions = true;
    tank.parent = root;
  }
  barrierRun(root, scene, mats, 54, 34, 8, 0);
  shed(root, scene, mats, 92, 56, 24, 20, 8, { doorsW: true, doorsS: true, partitions: 2 });
  containerBlock(root, scene, mats, 78, 76, 2, 2, rand);
  pipeRack(root, scene, mats, 56, 84, 40, 0);
  vehicle(root, scene, mats, 34, 74, 1.2, "trailer");
  rubble(root, scene, mats, 70, 40, rand);
  rubble(root, scene, mats, 88, 82, rand);
}

/** STRONGPOINT D — Bukit Chandu. A walled compound climbing a ridge. The culmination. */
function buildBukitChandu(root: TransformNode, scene: Scene, mats: Mats, rand: () => number): void {
  // The ridge itself: two walkable terraces with ramps, so the whole objective
  // is fought uphill.
  walkable(root, scene, "ridgeLower", 96, 3, 46, 0, 1.5, 96, mats.earth);
  walkable(root, scene, "ridgeUpper", 56, 3, 26, 0, 4.5, 114, mats.earth);
  rampZ(root, scene, -20, 76, 86, 0, 3, 6, mats.earth);
  rampZ(root, scene, 20, 76, 86, 0, 3, 6, mats.earth);
  rampZ(root, scene, -14, 100, 106, 3, 6, 5, mats.earth);
  rampZ(root, scene, 14, 100, 106, 3, 6, 5, mats.earth);

  // Outer wall with a single gate — the approach the player has to force.
  solid(root, scene, "chanduWall", 34, 4, 1.2, -30, 2, 76, mats.concrete);
  solid(root, scene, "chanduWall", 34, 4, 1.2, 30, 2, 76, mats.concrete);
  solid(root, scene, "chanduWall", 1.2, 4, 46, -47, 2, 96, mats.concrete);
  solid(root, scene, "chanduWall", 1.2, 4, 46, 47, 2, 96, mats.concrete);
  guardPost(root, scene, mats, -13, 72, 0);
  guardPost(root, scene, mats, 13, 72, 0);
  barrierRun(root, scene, mats, 0, 72, 4, Math.PI / 2);

  // Courtyard: bunkers and sandbag lines on the lower terrace.
  for (const bx of [-28, 0, 28]) {
    solid(root, scene, "bunker", 9, 3.2, 7, bx, 4.6, 92, mats.concrete);
    roofPanel(root, scene, "bunkerRoof", 10.5, 0.5, 8.5, bx, 6.4, 92, mats.roof);
    for (let i = -2; i <= 2; i++) {
      solid(root, scene, "chanduBag", 1.8, 1.0, 0.9, bx + i * 2.0, 3.5, 87.5, mats.sandbag);
    }
  }
  containerBlock(root, scene, mats, -40, 100, 1, 2, rand);
  containerBlock(root, scene, mats, 30, 100, 1, 2, rand);

  // Ridge bunker: the final position, dug into the top terrace.
  solid(root, scene, "keepWall", 30, 4, 1.2, 0, 8, 104, mats.concrete);
  solid(root, scene, "keepWall", 1.2, 4, 22, -15, 8, 114, mats.concrete);
  solid(root, scene, "keepWall", 1.2, 4, 22, 15, 8, 114, mats.concrete);
  walkable(root, scene, "keepFloor", 28, 0.2, 20, 0, 6.1, 115, mats.concrete);
  roofPanel(root, scene, "keepRoof", 32, 0.6, 24, 0, 10, 115, mats.roof);
  for (let i = -3; i <= 3; i++) {
    solid(root, scene, "keepBag", 1.8, 1.0, 0.9, i * 2.2, 6.6, 105.5, mats.sandbag);
  }
  rubble(root, scene, mats, -34, 88, rand);
  rubble(root, scene, mats, 36, 90, rand);
}

/** Terminal boundary — a hard edge just inside the nav bound, so nobody walks into the void. */
function buildPerimeter(root: TransformNode, scene: Scene, mats: Mats): void {
  const h = TERMINAL_HALF_M - 2;
  for (const [x0, z0, x1, z1] of [
    [-h, h, h, h],
    [-h, -h, -h, h],
    [h, -h, h, h],
  ] as const) {
    fenceRun(root, scene, mats, x0, z0, x1, z1);
  }
}

/**
 * Six flood lights, one per major area. Kept sparse on purpose: WorldMaterial
 * allows 8 simultaneous lights and the static rig already claims four, so a
 * denser grid would start evicting the sun/fill/flashlight on nearby geometry.
 */
function buildLighting(root: TransformNode, scene: Scene, mats: Mats): void {
  const spots: Array<[number, number, number]> = [
    [0, -100, 0.5],
    [G.A, -50, 0.55],
    [G.B, -46, 0.55],
    [0, 10, 0.4],
    [G.C, 52, 0.6],
    [0, 100, 0.6],
  ];
  for (const [x, z, intensity] of spots) {
    const light = new PointLight(`ppFlood_${uid++}`, new Vector3(x, 14, z), scene);
    light.diffuse = new Color3(0.9, 0.86, 0.7);
    light.intensity = intensity;
    light.range = 62;
    light.parent = root;
    // Mast + emissive head, so the light reads as coming from something.
    decor(root, scene, "mastPole", 0.5, 14, 0.5, x, 7, z, mats.steel);
    decor(root, scene, "mastHead", 2.4, 0.6, 1.4, x, 14.2, z, mats.lamp);
  }
}
