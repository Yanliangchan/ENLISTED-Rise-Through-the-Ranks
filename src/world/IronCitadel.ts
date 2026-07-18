import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  Mesh,
  InstancedMesh,
} from "@babylonjs/core";
import { WorldMaterial } from "@/world/WorldMaterial";

/**
 * OPERATION IRON CITADEL — a premium single-floor tactical CQB map: a captured
 * SAF-inspired military office HQ, built for the (future) multiplayer mode
 * (NOT the bot-wave survival map).
 *
 * Everything is ONE continuous walkable navigation surface. Height is an
 * illusion made from ramps, split-levels, sunken rooms, mezzanines, a raised
 * command platform and an overwatch balcony — no lifts, no multi-floor AI, no
 * separate nav layers. Walkable slabs/ramps/platforms carry
 * `metadata.walkable = true` (so `Nav.isNavigable` accepts them at any height);
 * walls / cover / furniture stay untagged so they block. Glass meeting-room
 * and partition panels carry `metadata.breakableGlass = true` so a bullet
 * shatters them out (see WeaponController.shatterGlass).
 *
 * The complex is a real department floor plan — reception & public areas, an
 * open-plan office + cubicle maze, HR/Finance/Admin/Planning/Logistics/Intel
 * offices, meeting rooms, a central Operations atrium with a command platform,
 * a military secure block (ops centre / briefing / command / comms / signals /
 * archive / vault / armoury / equipment issue), a technical zone (server room /
 * NOC / UPS / IT / cable corridor), an east staff-facilities flank wing
 * (pantry / cafeteria / kitchen / clinic / gym / rest / lockers / washrooms)
 * and a west utility flank (loading dock / storage / janitor / electrical / AC
 * plant / fire control / workshop). Three routes reach the Operations Centre —
 * the central spine and the two flank corridors.
 *
 * Perf: PBR surface materials + emissive glow materials are shared singletons;
 * the numerous small detail props (monitors, chairs, boxes, extinguishers,
 * CCTV, posters, cups) are hardware INSTANCES of a handful of source meshes;
 * every mesh's world matrix is frozen after placement.
 */

/** Far-field origin so the complex never overlaps the city (±100) or the range (Z≈250+). */
const BASE = new Vector3(430, 0, 0);

// Interior footprint (local coords, centred on BASE). ~+55% area vs the first pass.
const HALF_W = 56; // X → 112m wide
const HALF_D = 42; // Z → 84m deep
const WALL_H = 5.5;
const WALL_T = 0.55;
const ROOM_H = 3.4; // interior partition height

// Elevation bands — one continuous surface joined by gentle (≤~15°) ramps.
const Y0 = 0.0; // main floor
const Y_SPLIT = 0.8; // split-level open office
const Y_CMD = 1.4; // raised command platform
const Y_MEZZ = 2.0; // server / raised platforms
const Y_BALC = 2.6; // operations overwatch balcony
const Y_DOCK = -1.6; // sunken loading dock
const Y_PIT = -1.0; // sunken courtyard / briefing pit

export interface IronCitadelHandles {
  spawn: Vector3;
  root: TransformNode;
  footprints: Array<{ x: number; z: number; w: number; d: number; kind: string }>;
  dispose(): void;
}

type Door = { side: "n" | "s" | "e" | "w"; at: number; width: number };

export function buildIronCitadel(scene: Scene): IronCitadelHandles {
  const root = new TransformNode("ironCitadel", scene);
  const footprints: IronCitadelHandles["footprints"] = [];
  const meshes: Mesh[] = [];
  const instances: InstancedMesh[] = [];

  // ---------------- materials (PBR surfaces + emissive glow) ----------------
  const pbr = (name: string, rgb: [number, number, number], rough: number, metal = 0): WorldMaterial => {
    const m = new WorldMaterial(name, scene);
    m.albedoColor = new Color3(rgb[0], rgb[1], rgb[2]);
    m.roughness = rough;
    m.metallic = metal;
    return m;
  };
  const glow = (name: string, rgb: [number, number, number], alpha = 1): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    const c = new Color3(rgb[0], rgb[1], rgb[2]);
    m.emissiveColor = c;
    m.diffuseColor = c;
    m.disableLighting = true;
    if (alpha < 1) {
      m.alpha = alpha;
      m.backFaceCulling = false;
    }
    return m;
  };

  const M = {
    carpetA: pbr("ic_carpetA", [0.26, 0.29, 0.34], 0.95), // office carpet (blue-grey)
    carpetB: pbr("ic_carpetB", [0.32, 0.3, 0.28], 0.95), // warm carpet
    tile: pbr("ic_tile", [0.62, 0.63, 0.64], 0.6), // ceramic floor tile (public/wet areas)
    concrete: pbr("ic_concrete", [0.5, 0.5, 0.52], 0.9), // painted concrete (structure, dock)
    wallPaint: pbr("ic_wall", [0.82, 0.81, 0.77], 0.85), // off-white painted wall
    wallCool: pbr("ic_wallCool", [0.6, 0.63, 0.66], 0.85), // cool grey partition
    alu: pbr("ic_alu", [0.7, 0.72, 0.74], 0.32, 0.85), // brushed aluminium trim
    wood: pbr("ic_wood", [0.42, 0.3, 0.19], 0.6), // wood desk / boardroom
    steel: pbr("ic_steel", [0.36, 0.38, 0.41], 0.45, 0.7), // steel cabinet / locker
    serverDark: pbr("ic_server", [0.09, 0.1, 0.12], 0.5, 0.4), // server rack body
    olive: pbr("ic_olive", [0.24, 0.28, 0.17], 0.85), // military olive
    sandbag: pbr("ic_sandbag", [0.5, 0.46, 0.32], 0.95), // checkpoint sandbags
    sofa: pbr("ic_sofa", [0.2, 0.32, 0.34], 0.9), // waiting-lounge sofa
    ramp: pbr("ic_ramp", [0.34, 0.36, 0.4], 0.6, 0.3), // painted-metal ramp (reads distinct)
    rubber: pbr("ic_rubber", [0.12, 0.13, 0.14], 0.95), // gym floor
  };
  const G = {
    glass: glow("ic_glass", [0.5, 0.66, 0.78], 0.24), // partition / window glass
    screen: glow("ic_screen", [0.25, 0.6, 0.85]), // monitor / NOC screen glow
    strip: glow("ic_strip", [0.95, 0.96, 0.9]), // ceiling light strip
    emergency: glow("ic_emergency", [0.9, 0.2, 0.15]), // emergency light
    exit: glow("ic_exit", [0.2, 0.85, 0.35]), // exit sign
    flagRed: glow("ic_flagRed", [0.85, 0.15, 0.15]), // Singapore flag red band
    poster: glow("ic_poster", [0.85, 0.8, 0.5]), // lit poster / mission board
    led: glow("ic_led", [0.2, 0.9, 0.5]), // rack LEDs
  };

  let idc = 0;
  const uid = (p: string) => `ic_${p}_${idc++}`;
  const add = (m: Mesh, walkable: boolean, pickable = true, collide = true): Mesh => {
    m.position.addInPlace(BASE);
    m.parent = root;
    m.checkCollisions = collide;
    m.isPickable = pickable;
    if (walkable) m.metadata = { ...(m.metadata ?? {}), walkable: true };
    m.freezeWorldMatrix();
    meshes.push(m);
    return m;
  };

  // ---- primitives ----------------------------------------------------------
  const slab = (w: number, d: number, cx: number, cz: number, y: number, mtl: WorldMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("slab"), { width: w, height: 0.3, depth: d }, scene);
    m.position.set(cx, y - 0.15, cz);
    m.material = mtl;
    return add(m, true);
  };
  const wall = (w: number, d: number, cx: number, cz: number, y: number, h: number, mtl: WorldMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("wall"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, y + h / 2, cz);
    m.material = mtl;
    return add(m, false);
  };
  const glassPanel = (w: number, d: number, cx: number, cz: number, y: number, h: number, breakable = true): Mesh => {
    const m = MeshBuilder.CreateBox(uid("glass"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, y + h / 2, cz);
    m.material = G.glass;
    const mesh = add(m, false);
    if (breakable) mesh.metadata = { ...(mesh.metadata ?? {}), breakableGlass: true };
    return mesh;
  };
  const cover = (w: number, h: number, d: number, cx: number, cz: number, floorY: number, mtl: WorldMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("cover"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, floorY + h / 2, cz);
    m.material = mtl;
    return add(m, false);
  };
  const ramp = (w: number, run: number, cross: number, start: number, y0: number, y1: number, axis: "x" | "z"): Mesh => {
    const dh = y1 - y0;
    const len = Math.hypot(run, dh);
    const ang = Math.atan2(dh, run);
    const m = MeshBuilder.CreateBox(uid("ramp"), { width: axis === "z" ? w : len, height: 0.3, depth: axis === "z" ? len : w }, scene);
    if (axis === "z") {
      m.position.set(cross, (y0 + y1) / 2, start + run / 2);
      m.rotation.x = -ang;
    } else {
      m.position.set(start + run / 2, (y0 + y1) / 2, cross);
      m.rotation.z = ang;
    }
    m.material = M.ramp;
    return add(m, true);
  };
  /** Non-colliding decorative quad (poster / sign / screen) mounted flat on a wall. */
  const panel = (w: number, h: number, cx: number, cz: number, y: number, rotY: number, mtl: StandardMaterial | WorldMaterial): Mesh => {
    const m = MeshBuilder.CreatePlane(uid("panel"), { width: w, height: h }, scene);
    m.position.set(cx, y, cz);
    m.rotation.y = rotY;
    m.material = mtl;
    return add(m, false, false, false);
  };

  /** Build a room's perimeter (partition walls) with door gaps on the given sides. */
  const roomShell = (x0: number, z0: number, x1: number, z1: number, mtl: WorldMaterial, doors: Door[], h = ROOM_H, glassSides: Array<Door["side"]> = []): void => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    const build = (side: Door["side"]) => {
      const isGlass = glassSides.includes(side);
      const put = (segW: number, segD: number, px: number, pz: number) => {
        if (isGlass) glassPanel(segW, segD, px, pz, Y0, h - 0.4);
        else wall(segW, segD, px, pz, Y0, h, mtl);
      };
      const door = doors.find((dr) => dr.side === side);
      if (side === "n" || side === "s") {
        const pz = side === "n" ? z1 : z0;
        if (!door) put(w, WALL_T, cx, pz);
        else {
          const leftW = door.at - door.width / 2 - x0;
          const rightW = x1 - (door.at + door.width / 2);
          if (leftW > 0.1) put(leftW, WALL_T, x0 + leftW / 2, pz);
          if (rightW > 0.1) put(rightW, WALL_T, x1 - rightW / 2, pz);
        }
      } else {
        const px = side === "e" ? x1 : x0;
        if (!door) put(WALL_T, d, px, cz);
        else {
          const nearW = door.at - door.width / 2 - z0;
          const farW = z1 - (door.at + door.width / 2);
          if (nearW > 0.1) put(WALL_T, nearW, px, z0 + nearW / 2);
          if (farW > 0.1) put(WALL_T, farW, px, z1 - farW / 2);
        }
      }
    };
    (["n", "s", "e", "w"] as const).forEach(build);
  };

  // ---- instanced decoration (cheap detail) ---------------------------------
  const makeSource = (name: string, mk: () => Mesh): Mesh => {
    const src = mk();
    src.name = name;
    src.parent = root;
    src.isPickable = false;
    src.checkCollisions = false;
    src.isVisible = false; // source hidden; only its instances render
    src.setEnabled(true);
    meshes.push(src);
    return src;
  };
  const monitorSrc = makeSource("ic_src_monitor", () => {
    const m = MeshBuilder.CreateBox("m", { width: 0.5, height: 0.34, depth: 0.06 }, scene);
    m.material = G.screen;
    return m;
  });
  const chairSrc = makeSource("ic_src_chair", () => {
    const seat = MeshBuilder.CreateBox("c", { width: 0.5, height: 0.5, depth: 0.5 }, scene);
    seat.material = M.steel;
    return seat;
  });
  const boxSrc = makeSource("ic_src_box", () => {
    const b = MeshBuilder.CreateBox("b", { width: 0.6, height: 0.5, depth: 0.6 }, scene);
    b.material = M.wood;
    return b;
  });
  const extSrc = makeSource("ic_src_ext", () => {
    const e = MeshBuilder.CreateCylinder("e", { diameter: 0.2, height: 0.55 }, scene);
    e.material = G.emergency;
    return e;
  });
  const cctvSrc = makeSource("ic_src_cctv", () => {
    const c = MeshBuilder.CreateBox("cc", { width: 0.18, height: 0.14, depth: 0.32 }, scene);
    c.material = M.steel;
    return c;
  });
  const cupSrc = makeSource("ic_src_cup", () => {
    const c = MeshBuilder.CreateCylinder("cu", { diameter: 0.09, height: 0.11 }, scene);
    c.material = M.wallPaint;
    return c;
  });
  const inst = (src: Mesh, x: number, y: number, z: number, rotY = 0, sy = 1): void => {
    const i = src.createInstance(uid("i"));
    i.position.set(BASE.x + x, y, BASE.z + z);
    i.rotation.y = rotY;
    if (sy !== 1) i.scaling.y = sy;
    i.parent = root;
    i.isPickable = false;
    i.freezeWorldMatrix();
    instances.push(i);
  };

  // ---- compound cover / furniture helpers ----------------------------------
  const desk = (cx: number, cz: number, rotY = 0, y = Y0): void => {
    cover(1.6, 0.75, 0.8, cx, cz, y, M.wood); // desktop (cover)
    inst(monitorSrc, cx, y + 1.05, cz + (rotY === 0 ? -0.2 : 0), rotY);
    inst(chairSrc, cx + Math.sin(rotY + Math.PI) * 0.7, y + 0.25, cz + Math.cos(rotY + Math.PI) * 0.7, rotY);
    if (Math.random() < 0.5) inst(cupSrc, cx + 0.4, y + 0.83, cz + 0.2);
  };
  const cabinet = (cx: number, cz: number, y = Y0): void => {
    cover(1.0, 1.5, 0.6, cx, cz, y, M.steel);
  };
  const locker = (cx: number, cz: number, len: number, axis: "x" | "z", y = Y0): void => {
    if (axis === "x") cover(len, 1.9, 0.5, cx, cz, y, M.steel);
    else cover(0.5, 1.9, len, cx, cz, y, M.steel);
  };
  const pillar = (cx: number, cz: number, y = Y0, h = WALL_H): void => {
    cover(1.1, h - y, 1.1, cx, cz, y, M.concrete);
  };
  const counter = (w: number, d: number, cx: number, cz: number, y = Y0): void => {
    cover(w, 1.1, d, cx, cz, y, M.alu);
  };
  const sofa = (cx: number, cz: number, rotY = 0, y = Y0): void => {
    const w = 2.0;
    const back = MeshBuilder.CreateBox(uid("sofaback"), { width: w, height: 0.9, depth: 0.4 }, scene);
    back.position.set(cx - Math.cos(rotY) * 0.5, y + 0.45, cz + Math.sin(rotY) * 0.5);
    back.rotation.y = rotY;
    back.material = M.sofa;
    add(back, false);
    cover(w, 0.45, 0.9, cx, cz, y, M.sofa);
  };
  const sandbags = (cx: number, cz: number, len: number, axis: "x" | "z", y = Y0): void => {
    for (let i = 0; i < len; i++) {
      const o = (i - (len - 1) / 2) * 1.0;
      cover(axis === "x" ? 1.1 : 0.9, 0.9, axis === "x" ? 0.9 : 1.1, cx + (axis === "x" ? o : 0), cz + (axis === "z" ? o : 0), y, M.sandbag);
    }
  };
  const serverRack = (cx: number, cz: number, y = Y0): void => {
    cover(1.2, 2.2, 0.9, cx, cz, y, M.serverDark);
    const led = MeshBuilder.CreateBox(uid("led"), { width: 1.25, height: 0.12, depth: 0.95 }, scene);
    led.position.set(cx, y + 1.5, cz);
    led.material = G.led;
    add(led, false, false, false);
  };
  const whiteboard = (cx: number, cz: number, rotY: number, y = Y0): void => { panel(2.4, 1.3, cx, cz, y + 1.6, rotY, glow(uid("wb"), [0.9, 0.92, 0.9])); };
  const missionBoard = (cx: number, cz: number, rotY: number, y = Y0): void => { panel(1.8, 1.2, cx, cz, y + 1.8, rotY, G.poster); };
  const flag = (cx: number, cz: number, rotY: number, y = Y0): void => { panel(1.1, 1.7, cx, cz, y + 2.4, rotY, G.flagRed); };
  const exitSign = (cx: number, cz: number, rotY: number, y = Y0): void => { panel(0.7, 0.28, cx, cz, y + 2.7, rotY, G.exit); };
  const cctv = (cx: number, cz: number, rotY = 0): void => inst(cctvSrc, cx, WALL_H - 0.7, cz, rotY);
  const ext = (cx: number, cz: number): void => inst(extSrc, cx, Y0 + 0.4, cz);
  const boxStack = (cx: number, cz: number, n = 2): void => {
    for (let i = 0; i < n; i++) inst(boxSrc, cx + (Math.random() - 0.5) * 0.3, Y0 + 0.25 + i * 0.5, cz + (Math.random() - 0.5) * 0.3, Math.random());
  };

  // ---- ceiling light strip (emissive bar, mounted high) --------------------
  const lightStrip = (w: number, d: number, cx: number, cz: number): void => {
    const s = MeshBuilder.CreateBox(uid("strip"), { width: w, height: 0.12, depth: d }, scene);
    s.position.set(cx, WALL_H - 0.15, cz);
    s.material = G.strip;
    add(s, false, false, false);
  };

  const fp = (kind: string, x0: number, z0: number, x1: number, z1: number) =>
    footprints.push({ x: BASE.x + (x0 + x1) / 2, z: BASE.z + (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, kind });

  // =========================================================================
  // PERIMETER + STRUCTURE
  // =========================================================================
  wall(HALF_W * 2 + WALL_T, WALL_T, 0, -HALF_D, 0, WALL_H, M.wallPaint); // south
  wall(HALF_W * 2 + WALL_T, WALL_T, 0, HALF_D, 0, WALL_H, M.wallPaint); // north
  wall(WALL_T, HALF_D * 2 + WALL_T, -HALF_W, 0, 0, WALL_H, M.wallPaint); // west
  wall(WALL_T, HALF_D * 2 + WALL_T, HALF_W, 0, 0, WALL_H, M.wallPaint); // east
  fp("complex", -HALF_W, -HALF_D, HALF_W, HALF_D);

  // Ceiling beam grid (decorative, non-colliding so nav/bullets pass) + light
  // strips slung under it — reads as a lit drop-ceiling without enclosing.
  for (let gx = -HALF_W + 12; gx < HALF_W; gx += 24) {
    const beam = MeshBuilder.CreateBox(uid("beam"), { width: 0.4, height: 0.4, depth: HALF_D * 2 }, scene);
    beam.position.set(gx, WALL_H - 0.2, 0);
    beam.material = M.alu;
    add(beam, false, false, false);
  }
  for (let gz = -HALF_D + 8; gz < HALF_D; gz += 12)
    for (let gx = -HALF_W + 14; gx < HALF_W; gx += 20) lightStrip(6, 0.6, gx, gz);

  // =========================================================================
  // MAIN FLOOR — flat y=0, composed slabs with holes for the sunken dock,
  // sunken courtyard, and sunken briefing pit.
  // =========================================================================
  // Big carpet fields (leave holes: dock x[-56,-40]z[-42,-28], courtyard
  // x[-7,7]z[-7,7], briefing pit x[-24,-10]z[14,24]).
  slab(HALF_W * 2, 14, 0, -35, Y0, M.tile); // south public band z[-42,-28] (tiled)  (dock hole handled below by overlaying dock lower)
  slab(48, 20, 8, -18, Y0, M.carpetA); // south-office east of centre
  slab(32, 20, -40, -18, Y0, M.carpetA); // south-office west
  slab(HALF_W * 2, 14, 0, -21, Y0, M.carpetA); // ensure continuity band z[-28,-14]
  slab(48, 14, 8, -0, Y0, M.carpetA); // atrium east + concourse (east of courtyard)
  slab(48, 14, -8, 0, Y0, M.carpetA); // atrium west (west of courtyard) [overlap ok]
  slab(HALF_W * 2, 10, 0, 12, Y0, M.carpetB); // secure approach z[7,17]
  slab(HALF_W * 2, 20, 0, 27, Y0, M.carpetB); // secure + technical band z[17,37]
  slab(HALF_W * 2, 10, 0, 39, Y0, M.carpetB); // north band z[34,44]

  // Sunken loading dock (SW), own floor + ramp down from the public band.
  slab(16, 14, -48, -35, Y_DOCK, M.concrete);
  ramp(5, 6, -40, -46, Y0, Y_DOCK, "x"); // descend into the dock
  fp("dock", -56, -42, -40, -28);

  // Sunken courtyard (atrium centre) + ramp down (west edge) + glass bridge.
  slab(14, 14, 0, 0, Y_PIT, M.tile);
  ramp(4, 4, 0, -7, Y0, Y_PIT, "x");
  const bridge = slab(16, 3.6, 0, 0, Y0, M.alu);
  bridge.material = M.alu;
  glassPanel(16, 0.12, 0, -1.8, Y0, 1.0);
  glassPanel(16, 0.12, 0, 1.8, Y0, 1.0);
  fp("courtyard", -7, -7, 7, 7);

  // Sunken briefing pit (military zone, tiered seating look) + ramp.
  slab(14, 10, -17, 19, Y_PIT, M.carpetB);
  ramp(4, 4, -17, 24, Y0, Y_PIT, "z");
  for (let t = 0; t < 3; t++) cover(12, 0.35, 1.2, -17, 15.5 + t * 1.4, Y_PIT + t * 0.35, M.wood); // tiered benches

  // =========================================================================
  // SOUTH — PUBLIC AREAS (reception / lounge / screening / lift lobby)
  // =========================================================================
  fp("reception", -30, -40, 30, -28);
  // Attacker spawn staging (behind reception) + spawn protection cover.
  cover(1.6, 1.0, 1.6, -4, -40, Y0, M.concrete);
  cover(1.6, 1.0, 1.6, 4, -40, Y0, M.concrete);
  exitSign(0, -41.6, 0);
  // Information counter (curved feel via 3 angled segments) + reception desk.
  counter(8, 1.2, -2, -35);
  counter(1.2, 4, -6, -33);
  counter(1.2, 4, 2, -33);
  inst(monitorSrc, -2, Y0 + 1.35, -35.4, Math.PI);
  flag(-2, -38.4, 0);
  missionBoard(6, -39.6, 0);
  // Visitor waiting lounge (west of reception): sofas + low tables + plants.
  sofa(-40, -37, 0);
  sofa(-46, -37, 0);
  sofa(-43, -31, Math.PI);
  cover(1.6, 0.5, 1.0, -43, -34, Y0, M.wood); // coffee table
  // Lift lobby (east): decorative lift doors (aluminium) + call panel.
  wall(10, 0.4, 40, -39.4, Y0, ROOM_H, M.alu);
  for (const lx of [36, 40, 44]) panel(1.8, 2.4, lx, -39.15, Y0 + 1.4, 0, M.alu);
  exitSign(44, -33, Math.PI);
  // Security screening checkpoint (the entry choke at z=-28): scanners + sandbags + 2 lanes.
  wall(3, WALL_T, -14, -28, Y0, ROOM_H, M.wallCool); // between lanes
  wall(3, WALL_T, 14, -28, Y0, ROOM_H, M.wallCool);
  cover(1.2, 1.8, 1.2, -8, -28, Y0, M.alu); // scanner arch posts
  cover(1.2, 1.8, 1.2, 8, -28, Y0, M.alu);
  sandbags(-11, -27, 3, "z");
  sandbags(11, -27, 3, "z");
  cctv(-20, -29, 0.5);
  cctv(20, -29, -0.5);

  // =========================================================================
  // MID — OFFICE DEPARTMENTS (west & east) + open-plan + cubicle maze
  // =========================================================================
  // Structural pillar grid through the office core (hard cover + sightline breaks).
  for (const px of [-30, -14, 14, 30]) for (const pz of [-20, -8, 4]) pillar(px, pz);

  // West department rooms (glass-fronted, doors onto a west corridor at x=-6):
  const westRooms: Array<[string, number, number]> = [
    ["HR OFFICE", -26, -22],
    ["FINANCE OFFICE", -26, -12],
    ["ADMIN OFFICE", -44, -22],
    ["PLANNING OFFICE", -44, -12],
  ];
  for (const [label, cx, cz] of westRooms) {
    roomShell(cx - 8, cz - 4, cx + 8, cz + 4, M.wallCool, [{ side: "e", at: cz, width: 2.2 }], ROOM_H, ["e"]);
    desk(cx - 4, cz + 1, 0);
    desk(cx + 3, cz - 1, Math.PI);
    cabinet(cx - 6, cz - 2.5);
    whiteboard(cx, cz + 3.6, Math.PI);
    missionBoard(cx - 7.6, cz, Math.PI / 2);
    lightStrip(5, 0.5, cx, cz);
    fp(label.toLowerCase().replace(/\s+/g, "-"), cx - 8, cz - 4, cx + 8, cz + 4);
  }
  // East department rooms (Logistics / Intelligence / meeting rooms / breakout):
  const eastRooms: Array<[string, number, number, WorldMaterial]> = [
    ["LOGISTICS OFFICE", 26, -22, M.wallCool],
    ["INTELLIGENCE OFFICE", 26, -12, M.wallCool],
    ["MEETING ROOM (L)", 44, -22, M.wallCool],
    ["BREAKOUT SPACE", 44, -12, M.wallCool],
  ];
  for (const [label, cx, cz, mtl] of eastRooms) {
    const glassy = label.startsWith("MEETING") || label.startsWith("BREAKOUT");
    roomShell(cx - 8, cz - 4, cx + 8, cz + 4, mtl, [{ side: "w", at: cz, width: 2.2 }], ROOM_H, glassy ? ["w", "s"] : ["w"]);
    if (glassy) {
      cover(4, 0.75, 1.4, cx, cz, Y0, M.wood); // meeting table
      for (const o of [-1.6, 1.6]) inst(chairSrc, cx + o, Y0 + 0.25, cz + 1.4, 0);
      whiteboard(cx, cz + 3.6, Math.PI);
    } else {
      desk(cx - 4, cz + 1, 0);
      desk(cx + 3, cz - 1, Math.PI);
      cabinet(cx + 6, cz + 2.5);
      boxStack(cx - 6, cz - 2, 3);
    }
    lightStrip(5, 0.5, cx, cz);
    fp(label.toLowerCase().replace(/[\s()]+/g, "-"), cx - 8, cz - 4, cx + 8, cz + 4);
  }
  // Open-plan office + cubicle maze (central-south, between the room columns).
  fp("open-plan-office", -8, -24, 8, -12);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const cx = -6 + c * 6;
      const cz = -22 + r * 4;
      // cubicle: a 3-sided partition + a desk with a monitor
      cover(2.6, 1.3, 0.12, cx, cz - 1.2, Y0, M.wallCool);
      cover(0.12, 1.3, 2.4, cx - 1.3, cz, Y0, M.wallCool);
      desk(cx, cz, 0);
    }

  // Split-level open office (east-south raised bay reached by a ramp) — adds vertical interest.
  slab(16, 10, 44, -33, Y_SPLIT, M.carpetA);
  ramp(4, 5, 44, -30, Y0, Y_SPLIT, "z");
  glassPanel(16, 0.12, 44, -28.2, Y_SPLIT, 1.0);
  desk(40, -35, 0, Y_SPLIT);
  desk(48, -35, Math.PI, Y_SPLIT);
  fp("raised-office-bay", 36, -38, 52, -28);

  // =========================================================================
  // CENTRE — OPERATIONS ATRIUM + raised COMMAND PLATFORM + overwatch balcony
  // =========================================================================
  fp("operations-atrium", -18, -6, 18, 8);
  // low cover around the sunken courtyard (consoles / planters)
  for (const [cx, cz] of [[-10, 4], [10, 4], [-10, -4], [10, -4]] as const) counter(2.2, 1.2, cx, cz);
  // Raised command platform on the north side of the atrium (elevated overwatch).
  slab(20, 6, 0, 6, Y_CMD, M.alu);
  glassPanel(20, 0.12, 0, 3.2, Y_CMD, 1.0);
  ramp(3.5, 6, -9, 0, Y0, Y_CMD, "z");
  ramp(3.5, 6, 9, 0, Y0, Y_CMD, "z");
  cover(3, 0.9, 1.4, 0, 7, Y_CMD, M.wood); // command console
  inst(monitorSrc, -1, Y_CMD + 1.2, 7, 0);
  inst(monitorSrc, 1, Y_CMD + 1.2, 7, 0);
  // Overwatch balcony above the command platform (highest point), 2 ramps.
  slab(14, 4, 0, 9, Y_BALC, M.alu);
  glassPanel(14, 0.12, 0, 7.2, Y_BALC, 1.0);
  ramp(3, 5, -8, 6, Y_CMD, Y_BALC, "z");
  ramp(3, 5, 8, 6, Y_CMD, Y_BALC, "z");
  for (const px of [-16, 16]) pillar(px, 6);

  // =========================================================================
  // NORTH — MILITARY SECURE BLOCK (ops centre / command / comms / signals /
  // archive / vault / armoury / equipment) behind a security barrier.
  // =========================================================================
  // Secure barrier line at z=17 with a controlled central gate + side flanks.
  wall(20, WALL_T, -22, 17, Y0, ROOM_H, M.olive);
  wall(20, WALL_T, 22, 17, Y0, ROOM_H, M.olive);
  sandbags(0, 16, 4, "x");
  cctv(0, 18, 0);
  missionBoard(-30, 16.6, 0);
  flag(30, 16.6, 0);

  // Operations Centre (main, centre-north): screen wall + consoles, 3 entrances.
  fp("operations-centre", -12, 20, 12, 32);
  roomShell(-12, 20, 12, 32, M.wallCool, [
    { side: "s", at: 0, width: 3 },
    { side: "e", at: 26, width: 2.2 },
    { side: "w", at: 26, width: 2.2 },
  ]);
  for (const sx of [-6, -2, 2, 6]) panel(3.4, 2.0, sx, 31.7, Y0 + 2.0, Math.PI, G.screen); // NOC screen wall
  cover(10, 0.85, 1.4, 0, 26, Y0, M.wood); // ops console row
  for (const o of [-3, 0, 3]) inst(monitorSrc, o, Y0 + 1.25, 26.6, Math.PI);
  for (const o of [-3, 0, 3]) inst(chairSrc, o, Y0 + 0.25, 24.6, 0);
  lightStrip(9, 0.5, 0, 26);

  // West secure rooms: Signals / Communications / Secure archive.
  const westSecure: Array<[string, number, number]> = [
    ["COMMS ROOM", -30, 24],
    ["SIGNALS ROOM", -46, 24],
    ["SECURE ARCHIVE", -46, 34],
    ["INTEL VAULT", -30, 34],
  ];
  for (const [label, cx, cz] of westSecure) {
    const vault = label.includes("VAULT") || label.includes("ARCHIVE");
    roomShell(cx - 7, cz - 5, cx + 7, cz + 5, vault ? M.steel : M.wallCool, [
      { side: "e", at: cz, width: 2.0 },
      ...(vault ? [] : [{ side: "s" as const, at: cx, width: 2.0 }]),
    ]);
    if (vault) {
      for (let i = 0; i < 3; i++) cabinet(cx - 5 + i * 1.4, cz + 3);
      boxStack(cx + 4, cz - 3, 3);
    } else {
      serverRack(cx - 4, cz + 2);
      serverRack(cx + 4, cz + 2);
      desk(cx, cz - 2, 0);
    }
    missionBoard(cx, cz + 4.6, Math.PI);
    lightStrip(5, 0.5, cx, cz);
    fp(label.toLowerCase().replace(/\s+/g, "-"), cx - 7, cz - 5, cx + 7, cz + 5);
  }
  // East secure rooms: Command office / Armoury / Equipment issue.
  const eastSecure: Array<[string, number, number]> = [
    ["COMMAND OFFICE", 30, 24],
    ["ARMOURY", 46, 24],
    ["EQUIPMENT ISSUE", 46, 34],
    ["EVIDENCE ROOM", 30, 34],
  ];
  for (const [label, cx, cz] of eastSecure) {
    const secure = label === "ARMOURY" || label === "EVIDENCE ROOM";
    roomShell(cx - 7, cz - 5, cx + 7, cz + 5, secure ? M.steel : M.wallCool, [{ side: "w", at: cz, width: 2.0 }]);
    if (label === "COMMAND OFFICE") {
      cover(2.6, 0.78, 1.4, cx, cz, Y0, M.wood);
      inst(monitorSrc, cx, Y0 + 1.1, cz - 0.3, 0);
      flag(cx, cz + 4.6, Math.PI);
    } else if (label === "ARMOURY" || label === "EQUIPMENT ISSUE") {
      locker(cx, cz + 3.6, 10, "x");
      locker(cx - 5, cz, 6, "z");
      counter(6, 1.0, cx, cz - 3);
    } else {
      for (let i = 0; i < 3; i++) cabinet(cx - 4 + i * 3, cz + 3);
      boxStack(cx, cz - 2, 2);
    }
    lightStrip(5, 0.5, cx, cz);
    fp(label.toLowerCase().replace(/\s+/g, "-"), cx - 7, cz - 5, cx + 7, cz + 5);
  }
  // Briefing room label (the sunken pit is its floor) + command projector board.
  missionBoard(-17, 13.8, 0);
  fp("briefing-room", -24, 14, -10, 24);

  // =========================================================================
  // WEST TECHNICAL EDGE — Server room / NOC / UPS / IT / cable corridor
  // =========================================================================
  // Server room occupies the NW behind the secure rooms via the cable corridor;
  // rack aisles + a raised server mezzanine (overwatch), reached by a ramp.
  fp("server-room", -56, 34, -40, 44);
  roomShell(-56, 34, -40, 44, M.wallCool, [{ side: "e", at: 39, width: 2.2 }]);
  for (let a = 0; a < 3; a++) serverRack(-52 + a * 5, 38);
  slab(10, 5, -50, 41.5, Y_MEZZ, M.alu);
  glassPanel(10, 0.12, -50, 39.2, Y_MEZZ, 1.0);
  ramp(3, 6, -54, 35, Y0, Y_MEZZ, "z");
  // Cable maintenance corridor (west flank spine) — long, intermittent cover.
  fp("cable-corridor", -56, -28, -50, 34);
  wall(WALL_T, 62, -50, 3, Y0, ROOM_H, M.concrete);
  for (const cz of [-20, -6, 8, 22]) cabinet(-53, cz);
  for (const cz of [-24, -2, 20]) ext(-53.5, cz);

  // =========================================================================
  // EAST STAFF-FACILITIES FLANK WING (pantry / cafeteria / kitchen / clinic /
  // gym / rest / lockers / washrooms) off an east service corridor.
  // =========================================================================
  fp("staff-corridor", 50, -28, 56, 34);
  wall(WALL_T, 62, 50, 3, Y0, ROOM_H, M.wallCool);
  const staffRooms: Array<[string, number, number, WorldMaterial]> = [
    ["CAFETERIA", 46, -4, M.tile],
    ["KITCHEN", 46, 6, M.tile],
    ["MEDICAL CLINIC", 46, 16, M.tile],
    ["GYM CORNER", 46, 26, M.rubber],
    ["LOCKERS", 54, -20, M.tile],
    ["REST AREA", 54, 30, M.carpetB],
  ];
  for (const [label, cx, cz, floorMtl] of staffRooms) {
    void floorMtl;
    roomShell(cx - 7, cz - 5, cx + 7, cz + 5, M.wallCool, [{ side: cx < 50 ? "e" : "w", at: cz, width: 2.2 }]);
    if (label === "CAFETERIA") {
      for (const [tx, tz] of [[cx - 3, cz - 2], [cx + 3, cz - 2], [cx - 3, cz + 2], [cx + 3, cz + 2]] as const) {
        cover(1.8, 0.75, 1.8, tx, tz, Y0, M.wood);
        inst(chairSrc, tx - 1.2, Y0 + 0.25, tz, 0);
        inst(chairSrc, tx + 1.2, Y0 + 0.25, tz, Math.PI);
      }
    } else if (label === "KITCHEN") {
      counter(10, 1.0, cx, cz + 3.6);
      counter(1.0, 6, cx - 5, cz);
    } else if (label === "MEDICAL CLINIC") {
      cover(2.0, 0.7, 1.0, cx - 3, cz, Y0, M.wallPaint); // treatment bed
      cabinet(cx + 4, cz + 3);
      panel(1.0, 1.0, cx, cz + 4.6, Y0 + 1.8, Math.PI, G.emergency); // red cross-ish sign
    } else if (label === "GYM CORNER") {
      for (const gx of [-3, 0, 3]) cover(1.2, 1.3, 2.0, cx + gx, cz, Y0, M.rubber);
    } else if (label === "LOCKERS") {
      locker(cx, cz - 4, 12, "x");
      locker(cx, cz + 4, 12, "x");
      cover(6, 0.45, 0.4, cx, cz, Y0, M.wood); // bench
    } else {
      sofa(cx - 3, cz, 0);
      sofa(cx + 3, cz, Math.PI);
    }
    lightStrip(5, 0.5, cx, cz);
    exitSign(cx, cz - 4.6, 0);
    fp(label.toLowerCase().replace(/\s+/g, "-"), cx - 7, cz - 5, cx + 7, cz + 5);
  }
  // Washrooms + pantry as small side rooms off the corridor.
  roomShell(52, -14, 56, -8, M.tile, [{ side: "w", at: -11, width: 1.6 }]);
  fp("washrooms", 52, -14, 56, -8);
  roomShell(52, -6, 56, 0, M.tile, [{ side: "w", at: -3, width: 1.6 }]);
  counter(3.5, 0.9, 54, -1);
  fp("pantry", 52, -6, 56, 0);

  // =========================================================================
  // WEST UTILITY (storage / janitor / electrical / AC plant / fire control /
  // workshop) clustered around the loading dock.
  // =========================================================================
  const utility: Array<[string, number, number]> = [
    ["STORAGE", -30, -34],
    ["WORKSHOP", -14, -34],
    ["ELECTRICAL", -48, -20],
    ["AC PLANT", -48, -8],
    ["FIRE CONTROL", -34, -6],
  ];
  for (const [label, cx, cz] of utility) {
    roomShell(cx - 6, cz - 4, cx + 6, cz + 4, M.concrete, [{ side: "n", at: cx, width: 2.0 }]);
    if (label === "STORAGE" || label === "WORKSHOP") {
      boxStack(cx - 3, cz, 3);
      boxStack(cx + 3, cz - 1, 2);
      cover(4, 1.8, 0.6, cx, cz + 3, Y0, M.steel); // storage shelf
    } else if (label === "AC PLANT" || label === "ELECTRICAL") {
      cover(3, 2.4, 1.6, cx, cz, Y0, M.steel); // plant unit
      ext(cx + 4, cz + 2);
    } else {
      cover(2, 1.8, 0.5, cx, cz + 2.5, Y0, M.steel); // fire panel cabinet
      ext(cx - 3, cz - 2);
      ext(cx + 3, cz - 2);
    }
    exitSign(cx, cz + 3.6, Math.PI);
    fp(label.toLowerCase().replace(/\s+/g, "-"), cx - 6, cz - 4, cx + 6, cz + 4);
  }
  // Loading dock props (crates, roller door, fork of boxes).
  boxStack(-50, -34, 3);
  boxStack(-46, -32, 2);
  cover(2, 2.6, 0.4, -55.6, -35, Y_DOCK, M.steel); // roller-door face
  exitSign(-48, -41.4, 0);

  // Scatter a few CCTV cameras + exit signs + extinguishers along the spine for occupancy.
  for (const [cx, cz, ry] of [[-6, -12, 0.4], [6, 4, -0.4], [-6, 20, 0.4], [6, 30, -0.4]] as const) cctv(cx, cz, ry);
  for (const [cx, cz] of [[-6, -30], [6, -8], [-6, 12], [6, 22]] as const) ext(cx, cz);

  // Open-top: lit by the scene's global sun + IBL; material emissive + the
  // light strips / screen glow / signage carry the interior lighting read.
  return {
    spawn: new Vector3(BASE.x + 0, 1.2, BASE.z - 40), // reception staging, just above the y=0 floor
    root,
    footprints,
    dispose(): void {
      for (const i of instances) i.dispose();
      for (const m of meshes) m.dispose();
      root.dispose();
    },
  };
}
