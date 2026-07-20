import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  Mesh,
  InstancedMesh,
  DynamicTexture,
  Texture,
  VertexBuffer,
  PBRMaterial,
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

/**
 * The complex is authored in local coordinates and offset to BASE by the root
 * transform. The root scale is IDENTITY: a previous pass shrank the footprint
 * with a non-uniform root scale (0.9,1,0.9), but Babylon's collision is
 * unreliable under non-uniform parent scale + frozen world matrices, which let
 * the player's collision ellipsoid slip through floor seams (the "falling
 * forever" bug). Size reduction, if wanted again, must be baked into geometry.
 */
const S = 1;

export function buildIronCitadel(scene: Scene): IronCitadelHandles {
  const root = new TransformNode("ironCitadel", scene);
  root.position.copyFrom(BASE);
  root.scaling.set(1, 1, 1);
  const footprints: IronCitadelHandles["footprints"] = [];
  // Room rectangles, registered by roomShell, checked for overlaps after the
  // build so layout regressions surface immediately in the console.
  const roomRects: Array<{ name: string; x0: number; z0: number; x1: number; z1: number }> = [];
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

  let idc = 0;
  const uid = (p: string) => `ic_${p}_${idc++}`;

  // ---------------- procedural surface textures -----------------------------
  // Small seeded canvas textures (same technique as the city's road/pavement
  // tiles) so floors/walls/ceilings read as real materials instead of flat
  // colour fields. Meshes get world-space UVs (see scaleUV) so the pattern
  // density is uniform no matter the slab size.
  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const makeTex = (name: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 256): DynamicTexture => {
    const tex = new DynamicTexture(`ic_tex_${name}`, { width: size, height: size }, scene, true);
    draw(tex.getContext() as CanvasRenderingContext2D, size);
    tex.update(false);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    return tex;
  };
  const speckle = (ctx: CanvasRenderingContext2D, s: number, rand: () => number, n: number, tone: () => string, dot = 1.6) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = tone();
      ctx.fillRect(rand() * s, rand() * s, dot, dot);
    }
  };
  const carpetTexOf = (name: string, base: string, litA: string, litB: string, seed: number) =>
    makeTex(name, (ctx, s) => {
      const rand = mulberry32(seed);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      // 0.5m carpet tiles (tileSize 2m → 4 tiles per repeat) with alternating tone
      const q = s / 4;
      for (let tx = 0; tx < 4; tx++)
        for (let ty = 0; ty < 4; ty++) {
          if ((tx + ty) % 2 === 0) continue;
          ctx.fillStyle = "rgba(255,255,255,0.035)";
          ctx.fillRect(tx * q, ty * q, q, q);
        }
      speckle(ctx, s, rand, 2600, () => (rand() < 0.5 ? litA : litB), 1.3);
    });
  const texCarpetA = carpetTexOf("carpetA", "#3d4552", "#4a5464", "#333a45", 101);
  const texCarpetB = carpetTexOf("carpetB", "#4e4a42", "#5c574d", "#403c35", 202);
  const texTile = makeTex("tile", (ctx, s) => {
    const rand = mulberry32(303);
    ctx.fillStyle = "#a2a4a6";
    ctx.fillRect(0, 0, s, s);
    // 1m ceramic tiles (2 per 2m repeat) with per-tile tint + grout lines
    const q = s / 2;
    for (let tx = 0; tx < 2; tx++)
      for (let ty = 0; ty < 2; ty++) {
        const v = Math.floor(rand() * 10) - 5;
        ctx.fillStyle = `rgb(${162 + v},${164 + v},${166 + v})`;
        ctx.fillRect(tx * q + 2, ty * q + 2, q - 4, q - 4);
      }
    ctx.strokeStyle = "#7d7f82";
    ctx.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * q, 0); ctx.lineTo(i * q, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * q); ctx.lineTo(s, i * q); ctx.stroke();
    }
    speckle(ctx, s, rand, 700, () => "rgba(120,122,124,0.5)", 1.2);
  });
  const texConcrete = makeTex("concrete", (ctx, s) => {
    const rand = mulberry32(404);
    ctx.fillStyle = "#828287";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rand, 2000, () => {
      const v = 110 + Math.floor(rand() * 40);
      return `rgb(${v},${v},${v + 2})`;
    }, 1.5);
    for (let i = 0; i < 8; i++) {
      const v = 100 + Math.floor(rand() * 25);
      ctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
      ctx.beginPath();
      ctx.ellipse(rand() * s, rand() * s, 12 + rand() * 44, 8 + rand() * 30, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const texWood = makeTex("wood", (ctx, s) => {
    const rand = mulberry32(505);
    ctx.fillStyle = "#6b4c2f";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      const y = rand() * s;
      const v = rand();
      ctx.strokeStyle = v < 0.5 ? "rgba(48,32,18,0.35)" : "rgba(140,102,64,0.3)";
      ctx.lineWidth = 1 + rand() * 2.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + (rand() - 0.5) * 8, s * 0.7, y + (rand() - 0.5) * 8, s, y);
      ctx.stroke();
    }
  });
  const texCeil = makeTex("ceil", (ctx, s) => {
    const rand = mulberry32(606);
    ctx.fillStyle = "#eceae3";
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rand, 900, () => "rgba(190,188,180,0.55)", 1.1); // acoustic perforation
    ctx.strokeStyle = "#c9c6bc";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, s, s); // panel edge (one 0.6m panel per repeat)
  });
  const texWallOf = (name: string, base: string, noise: string, seed: number) =>
    makeTex(name, (ctx, s) => {
      const rand = mulberry32(seed);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      // fine paint grain only — larger blotches read as polka dots up close
      speckle(ctx, s, rand, 1400, () => noise, 1.1);
    });
  const texWall = texWallOf("wall", "#d3d0c6", "rgba(255,255,255,0.06)", 707);
  const texWallCool = texWallOf("wallCool", "#9aa0a6", "rgba(255,255,255,0.05)", 808);

  /** Textured PBR surface: white albedo modulated by a procedural texture. */
  const pbrTex = (name: string, tex: DynamicTexture, rough: number, metal = 0): WorldMaterial => {
    const m = pbr(name, [1, 1, 1], rough, metal);
    m.albedoTexture = tex;
    return m;
  };
  const M = {
    carpetA: pbrTex("ic_carpetA", texCarpetA, 0.95), // office carpet tiles (blue-grey)
    carpetB: pbrTex("ic_carpetB", texCarpetB, 0.95), // warm carpet tiles
    tile: pbrTex("ic_tile", texTile, 0.55), // ceramic floor tile (public/wet areas)
    concrete: pbrTex("ic_concrete", texConcrete, 0.9), // painted concrete (structure, dock)
    wallPaint: pbrTex("ic_wall", texWall, 0.85), // off-white painted wall
    wallCool: pbrTex("ic_wallCool", texWallCool, 0.85), // cool grey partition
    ceil: pbrTex("ic_ceil", texCeil, 0.92), // acoustic ceiling panels
    alu: pbr("ic_alu", [0.7, 0.72, 0.74], 0.32, 0.85), // brushed aluminium trim
    wood: pbrTex("ic_wood", texWood, 0.55), // wood desk / boardroom
    steel: pbr("ic_steel", [0.36, 0.38, 0.41], 0.45, 0.7), // steel cabinet / locker
    serverDark: pbr("ic_server", [0.09, 0.1, 0.12], 0.5, 0.4), // server rack body
    olive: pbr("ic_olive", [0.24, 0.28, 0.17], 0.85), // military olive
    sandbag: pbr("ic_sandbag", [0.5, 0.46, 0.32], 0.95), // checkpoint sandbags
    sofa: pbr("ic_sofa", [0.2, 0.32, 0.34], 0.9), // waiting-lounge sofa
    ramp: pbr("ic_ramp", [0.34, 0.36, 0.4], 0.6, 0.3), // painted-metal ramp (reads distinct)
    rubber: pbr("ic_rubber", [0.12, 0.13, 0.14], 0.95), // gym floor
    accentTeal: pbr("ic_accentTeal", [0.1, 0.45, 0.45], 0.7), // public-zone wayfinding
    accentBlue: pbr("ic_accentBlue", [0.16, 0.3, 0.58], 0.7), // office-zone wayfinding
    accentRed: pbr("ic_accentRed", [0.55, 0.16, 0.14], 0.7), // secure-zone wayfinding
  };
  /** World-space texture density per material (metres per texture repeat). */
  const tileSize = new Map<WorldMaterial, number>([
    [M.carpetA, 2], [M.carpetB, 2], [M.tile, 2], [M.concrete, 3],
    [M.wallPaint, 2.4], [M.wallCool, 2.4], [M.ceil, 0.6], [M.wood, 1.8],
  ]);
  // Realistic glass: PBR alpha-blend so panes pick up IBL/skyline reflection
  // instead of the old flat emissive tint.
  const glassMat = new WorldMaterial("ic_glassPbr", scene);
  glassMat.albedoColor = new Color3(0.6, 0.73, 0.8);
  glassMat.alpha = 0.3;
  glassMat.roughness = 0.07;
  glassMat.metallic = 0;
  glassMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  glassMat.backFaceCulling = false;
  glassMat.environmentIntensity = 1.0;
  glassMat.alpha = 0.22; // clearer panes: partitions must read as glass, not walls
  // Near-clear infill for guard rails (even lighter than partition glass).
  const railGlassMat = new WorldMaterial("ic_railGlass", scene);
  railGlassMat.albedoColor = new Color3(0.7, 0.8, 0.85);
  railGlassMat.alpha = 0.1;
  railGlassMat.roughness = 0.06;
  railGlassMat.metallic = 0;
  railGlassMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  railGlassMat.backFaceCulling = false;
  // Frosted glass for the perimeter facade + wet-room partitions: mostly
  // opaque so the boundary is sealed (no clear view into void / gaps between
  // the exterior silhouettes), while still reading as glass and admitting a
  // soft daylight glow. Backed by a 2D skyline billboard just outside.
  const frostedMat = new StandardMaterial("ic_frosted", scene);
  frostedMat.diffuseColor = new Color3(0.62, 0.7, 0.76);
  frostedMat.emissiveColor = new Color3(0.34, 0.4, 0.46);
  frostedMat.alpha = 0.82;
  frostedMat.specularColor = new Color3(0.15, 0.15, 0.15);
  frostedMat.backFaceCulling = false;
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

  // ---------------- signage & display content (canvas-drawn) ----------------
  const emissiveTexMat = (tex: DynamicTexture): StandardMaterial => {
    const m = new StandardMaterial(uid("texmat"), scene);
    m.emissiveTexture = tex;
    m.disableLighting = true;
    // cull back faces: text panels are placed with an explicit facing (and
    // hanging signs use two opposed panels), so the mirrored back never shows
    m.backFaceCulling = true;
    return m;
  };
  const signCache = new Map<string, StandardMaterial>();
  /** Backlit wayfinding sign with real text (shared per unique string). */
  const signFor = (text: string): StandardMaterial => {
    let m = signCache.get(text);
    if (m) return m;
    const tex = new DynamicTexture(uid("sign"), { width: 512, height: 128 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#0f1720";
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = "#3d5a6a";
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, 502, 118);
    tex.drawText(text, null, 84, "bold 52px Arial", "#e8f2f8", null, true);
    m = emissiveTexMat(tex);
    signCache.set(text, m);
    return m;
  };
  // Singapore flag (crescent + five stars drawn on canvas).
  const flagMat = (() => {
    const tex = new DynamicTexture("ic_tex_flag", { width: 300, height: 200 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 300, 200);
    ctx.fillStyle = "#ed2939";
    ctx.fillRect(0, 0, 300, 100);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(62, 50, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ed2939";
    ctx.beginPath(); ctx.arc(74, 50, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    const starAt = (sx: number, sy: number) => { ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); };
    starAt(110, 32); starAt(94, 46); starAt(126, 46); starAt(100, 64); starAt(120, 64);
    tex.update(); // default invertY keeps the canvas upright (red band on top)
    return emissiveTexMat(tex);
  })();
  // SAF-style unit crest roundel for the reception feature wall.
  const crestMat = (() => {
    const tex = new DynamicTexture("ic_tex_crest", { width: 320, height: 320 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, 320, 320);
    ctx.strokeStyle = "#c8a24a";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(160, 145, 105, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#8f1d22";
    ctx.beginPath(); ctx.arc(160, 145, 92, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e8d48a";
    ctx.lineWidth = 6;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(160 + Math.cos(a) * 30, 145 + Math.sin(a) * 30);
      ctx.lineTo(160 + Math.cos(a) * 78, 145 + Math.sin(a) * 78);
      ctx.stroke();
    }
    tex.drawText("HQ IRON CITADEL", null, 300, "bold 30px Arial", "#c8a24a", null, true);
    return emissiveTexMat(tex);
  })();
  // Live-looking operations display (grid, traces, contact blips).
  const nocMat = (() => {
    const tex = new DynamicTexture("ic_tex_noc", { width: 512, height: 256 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const rand = mulberry32(909);
    ctx.fillStyle = "#06121a";
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#0d2a38";
    ctx.fillRect(0, 0, 512, 30);
    ctx.strokeStyle = "#12384a";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= 512; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, 30); ctx.lineTo(gx, 256); ctx.stroke(); }
    for (let gy = 30; gy <= 256; gy += 32) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(512, gy); ctx.stroke(); }
    for (const col of ["#2fd27a", "#38b6e0", "#e0b638"]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let y = 100 + rand() * 100;
      ctx.moveTo(0, y);
      for (let x = 32; x <= 512; x += 32) { y = Math.max(40, Math.min(250, y + (rand() - 0.5) * 60)); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = rand() < 0.4 ? "#e04438" : "#2fd27a";
      ctx.beginPath(); ctx.arc(30 + rand() * 450, 50 + rand() * 190, 5, 0, Math.PI * 2); ctx.fill();
    }
    tex.drawText("SECTOR OVERWATCH — LIVE", 14, 23, "bold 18px Arial", "#7fd4e8", null, true);
    return emissiveTexMat(tex);
  })();
  // Yellow/black hazard chevrons for sunken-edge marking.
  const texHazard = makeTex("hazard", (ctx, s) => {
    ctx.fillStyle = "#d8b021";
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#17181a";
    for (let x = -s; x < s * 2; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 32 - s, s); ctx.lineTo(x - s, s);
      ctx.closePath(); ctx.fill();
    }
  }, 128);
  const hazardMat = pbrTex("ic_hazard", texHazard, 0.8);
  tileSize.set(hazardMat, 0.8);
  // Exterior surround materials (seen through the curtain-wall glazing).
  const asphaltMat = pbr("ic_asphalt", [0.15, 0.15, 0.16], 0.95);
  const towerMat = pbr("ic_tower", [0.1, 0.12, 0.16], 0.35, 0.3);

  // Meshes are authored in LOCAL map coordinates; the root transform applies
  // the BASE offset and the global S footprint scale to everything at once.
  const add = (m: Mesh, walkable: boolean, pickable = true, collide = true): Mesh => {
    m.parent = root;
    m.checkCollisions = collide;
    m.isPickable = pickable;
    if (walkable) m.metadata = { ...(m.metadata ?? {}), walkable: true };
    m.freezeWorldMatrix();
    meshes.push(m);
    return m;
  };

  // ---- primitives ----------------------------------------------------------
  /**
   * Rescale a box mesh's UVs so its material texture repeats in world units
   * (u along the mesh's larger horizontal extent, v along the other axis /
   * height). Uniform pattern density regardless of slab/wall size.
   */
  const scaleUV = (m: Mesh, mtl: WorldMaterial, uMetres: number, vMetres: number): void => {
    const ts = tileSize.get(mtl);
    if (!ts) return;
    const uv = m.getVerticesData(VertexBuffer.UVKind);
    if (!uv) return;
    const scaled = new Float32Array(uv.length);
    for (let i = 0; i < uv.length; i += 2) {
      scaled[i] = (uv[i] * uMetres) / ts;
      scaled[i + 1] = (uv[i + 1] * vMetres) / ts;
    }
    m.setVerticesData(VertexBuffer.UVKind, scaled);
  };
  const slab = (w: number, d: number, cx: number, cz: number, y: number, mtl: WorldMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("slab"), { width: w, height: 0.3, depth: d }, scene);
    m.position.set(cx, y - 0.15, cz);
    m.material = mtl;
    scaleUV(m, mtl, w, d);
    return add(m, true);
  };
  const wall = (w: number, d: number, cx: number, cz: number, y: number, h: number, mtl: WorldMaterial): Mesh => {
    const m = MeshBuilder.CreateBox(uid("wall"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, y + h / 2, cz);
    m.material = mtl;
    scaleUV(m, mtl, Math.max(w, d), h);
    return add(m, false);
  };
  const glassPanel = (w: number, d: number, cx: number, cz: number, y: number, h: number, breakable = true): Mesh => {
    const m = MeshBuilder.CreateBox(uid("glass"), { width: w, height: h, depth: d }, scene);
    m.position.set(cx, y + h / 2, cz);
    m.material = glassMat;
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
    // Thin deck sunk a few cm so the tilted box's end corners never poke a
    // lip above the flat floors it meets — transitions feel smooth on foot.
    const m = MeshBuilder.CreateBox(uid("ramp"), { width: axis === "z" ? w : len, height: 0.26, depth: axis === "z" ? len : w }, scene);
    if (axis === "z") {
      m.position.set(cross, (y0 + y1) / 2 - 0.05, start + run / 2);
      m.rotation.x = -ang;
    } else {
      m.position.set(start + run / 2, (y0 + y1) / 2 - 0.05, cross);
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
  const roomShell = (x0: number, z0: number, x1: number, z1: number, mtl: WorldMaterial, doors: Door[], h = ROOM_H, glassSides: Array<Door["side"]> = [], name = ""): void => {
    roomRects.push({ name: name || `room@${((x0 + x1) / 2).toFixed(0)},${((z0 + z1) / 2).toFixed(0)}`, x0, z0, x1, z1 });
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
      // Framed doorway: a header wall above the gap (2.1m clear opening) so
      // doors read as real architectural openings, not wall slots.
      const header = (hw: number, hd: number, px: number, pz: number) => {
        if (isGlass || h - 2.1 < 0.15) return;
        wall(hw, hd, px, pz, Y0 + 2.1, h - 2.1, mtl);
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
          header(door.width, WALL_T, door.at, pz);
          inst(jambSrc, door.at - door.width / 2, Y0 + 1.05, pz, Math.PI / 2);
          inst(jambSrc, door.at + door.width / 2, Y0 + 1.05, pz, Math.PI / 2);
        }
      } else {
        const px = side === "e" ? x1 : x0;
        if (!door) put(WALL_T, d, px, cz);
        else {
          const nearW = door.at - door.width / 2 - z0;
          const farW = z1 - (door.at + door.width / 2);
          if (nearW > 0.1) put(WALL_T, nearW, px, z0 + nearW / 2);
          if (farW > 0.1) put(WALL_T, farW, px, z1 - farW / 2);
          header(WALL_T, door.width, px, door.at);
          inst(jambSrc, px, Y0 + 1.05, door.at - door.width / 2, 0);
          inst(jambSrc, px, Y0 + 1.05, door.at + door.width / 2, 0);
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
    const e = MeshBuilder.CreateCylinder("e", { diameter: 0.2, height: 0.55, tessellation: 14 }, scene);
    e.material = G.emergency;
    return e;
  });
  const cctvSrc = makeSource("ic_src_cctv", () => {
    const c = MeshBuilder.CreateBox("cc", { width: 0.18, height: 0.14, depth: 0.32 }, scene);
    c.material = M.steel;
    return c;
  });
  const cupSrc = makeSource("ic_src_cup", () => {
    const c = MeshBuilder.CreateCylinder("cu", { diameter: 0.09, height: 0.11, tessellation: 12 }, scene);
    c.material = M.wallPaint;
    return c;
  });
  // Ceiling fixtures (instanced by the hundreds — one draw call per source).
  const ledPanelSrc = makeSource("ic_src_ledpanel", () => {
    const p = MeshBuilder.CreateBox("lp", { width: 0.95, height: 0.05, depth: 0.95 }, scene);
    p.material = G.strip;
    return p;
  });
  const ventSrc = makeSource("ic_src_vent", () => {
    const v = MeshBuilder.CreateBox("v", { width: 0.55, height: 0.07, depth: 0.55 }, scene);
    v.material = M.alu;
    return v;
  });
  const sprinklerSrc = makeSource("ic_src_sprinkler", () => {
    const s = MeshBuilder.CreateCylinder("sp", { diameter: 0.07, height: 0.16, tessellation: 6 }, scene);
    s.material = M.steel;
    return s;
  });
  const detectorSrc = makeSource("ic_src_detector", () => {
    const d = MeshBuilder.CreateCylinder("dt", { diameter: 0.16, height: 0.06, tessellation: 8 }, scene);
    d.material = M.wallPaint;
    return d;
  });
  const speakerSrc = makeSource("ic_src_speaker", () => {
    const s = MeshBuilder.CreateCylinder("sk", { diameter: 0.26, height: 0.06, tessellation: 8 }, scene);
    s.material = M.serverDark;
    return s;
  });
  // Desk / office clutter.
  const keyboardSrc = makeSource("ic_src_keyboard", () => {
    const k = MeshBuilder.CreateBox("kb", { width: 0.46, height: 0.03, depth: 0.16 }, scene);
    k.material = M.serverDark;
    return k;
  });
  const phoneSrc = makeSource("ic_src_phone", () => {
    const p = MeshBuilder.CreateBox("ph", { width: 0.24, height: 0.08, depth: 0.2 }, scene);
    p.material = M.serverDark;
    return p;
  });
  const plantSrc = makeSource("ic_src_plant", () => {
    const p = MeshBuilder.CreateCylinder("pl", { diameterBottom: 0.34, diameterTop: 0.95, height: 1.3, tessellation: 12 }, scene);
    p.material = M.olive;
    return p;
  });
  const binSrc = makeSource("ic_src_bin", () => {
    const b = MeshBuilder.CreateCylinder("bn", { diameter: 0.36, height: 0.6, tessellation: 12 }, scene);
    b.material = M.steel;
    return b;
  });
  const cardReaderSrc = makeSource("ic_src_cardreader", () => {
    const c = MeshBuilder.CreateBox("cr", { width: 0.1, height: 0.17, depth: 0.05 }, scene);
    c.material = G.led;
    return c;
  });
  const warmPanelSrc = makeSource("ic_src_warmpanel", () => {
    const p = MeshBuilder.CreateBox("wp", { width: 0.95, height: 0.05, depth: 0.95 }, scene);
    p.material = glow("ic_stripWarm", [1.0, 0.85, 0.62]);
    return p;
  });
  const jambSrc = makeSource("ic_src_jamb", () => {
    const j = MeshBuilder.CreateBox("jb", { width: 0.14, height: 2.1, depth: 0.64 }, scene);
    j.material = M.alu;
    return j;
  });
  const emergSrc = makeSource("ic_src_emerg", () => {
    const e = MeshBuilder.CreateBox("em", { width: 0.3, height: 0.12, depth: 0.09 }, scene);
    e.material = G.emergency;
    return e;
  });
  const inst = (src: Mesh, x: number, y: number, z: number, rotY = 0, sy = 1): void => {
    const i = src.createInstance(uid("i"));
    i.position.set(x, y, z);
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
    inst(keyboardSrc, cx, y + 0.78, cz + (rotY === 0 ? 0.12 : -0.12), rotY);
    inst(chairSrc, cx + Math.sin(rotY + Math.PI) * 0.7, y + 0.25, cz + Math.cos(rotY + Math.PI) * 0.7, rotY);
    if (Math.random() < 0.5) inst(cupSrc, cx + 0.4, y + 0.83, cz + 0.2);
    if (Math.random() < 0.35) inst(phoneSrc, cx - 0.55, y + 0.8, cz + 0.15, rotY);
  };
  const cabinet = (cx: number, cz: number, y = Y0): void => {
    cover(1.0, 1.5, 0.6, cx, cz, y, M.steel);
  };
  const locker = (cx: number, cz: number, len: number, axis: "x" | "z", y = Y0): void => {
    if (axis === "x") cover(len, 1.9, 0.5, cx, cz, y, M.steel);
    else cover(0.5, 1.9, len, cx, cz, y, M.steel);
  };
  /** Round structural column: concrete shaft on an aluminium plinth, with an
   *  optional coloured wayfinding band at eye height (zone identity). */
  const pillar = (cx: number, cz: number, y = Y0, h = WALL_H, accent?: WorldMaterial): void => {
    const shaft = MeshBuilder.CreateCylinder(uid("pillar"), { diameter: 1.1, height: h - y, tessellation: 20 }, scene);
    shaft.position.set(cx, y + (h - y) / 2, cz);
    shaft.material = M.concrete;
    add(shaft, false);
    cover(1.5, 0.16, 1.5, cx, cz, y, M.alu); // plinth
    if (accent) {
      const band = MeshBuilder.CreateCylinder(uid("band"), { diameter: 1.16, height: 0.3, tessellation: 14 }, scene);
      band.position.set(cx, y + 2.2, cz);
      band.material = accent;
      add(band, false, false, false);
    }
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
  const flag = (cx: number, cz: number, rotY: number, y = Y0): void => { panel(1.95, 1.3, cx, cz, y + 2.6, rotY, flagMat); };
  const exitSign = (cx: number, cz: number, rotY: number, y = Y0): void => { panel(0.7, 0.28, cx, cz, y + 2.7, rotY, G.exit); };
  // CCTV mounts at drop-ceiling height so cameras read as ceiling-mounted
  // rather than floating in the plenum void.
  const cctv = (cx: number, cz: number, rotY = 0): void => inst(cctvSrc, cx, ROOM_H - 0.15, cz, rotY);
  const ext = (cx: number, cz: number): void => inst(extSrc, cx, Y0 + 0.4, cz);
  const boxStack = (cx: number, cz: number, n = 2, y = Y0): void => {
    for (let i = 0; i < n; i++) inst(boxSrc, cx + (Math.random() - 0.5) * 0.3, y + 0.25 + i * 0.5, cz + (Math.random() - 0.5) * 0.3, Math.random());
  };
  const plant = (cx: number, cz: number, y = Y0): void => inst(plantSrc, cx, y + 0.65, cz);
  const bin = (cx: number, cz: number, y = Y0): void => inst(binSrc, cx, y + 0.3, cz);
  const cardReader = (cx: number, cz: number, rotY = 0): void => inst(cardReaderSrc, cx, Y0 + 1.2, cz, rotY);
  const waterCooler = (cx: number, cz: number, y = Y0): void => {
    cover(0.45, 1.15, 0.45, cx, cz, y, M.wallPaint);
    const bottle = MeshBuilder.CreateCylinder(uid("bottle"), { diameter: 0.32, height: 0.4, tessellation: 8 }, scene);
    bottle.position.set(cx, y + 1.35, cz);
    bottle.material = glassMat;
    add(bottle, false, false, false);
  };
  /** Waist-high concrete planter with greenery — deliberate hard cover that
   *  breaks long sightlines without reading as random clutter. */
  const bigPlanter = (cx: number, cz: number, axis: "x" | "z" = "x"): void => {
    const w = axis === "x" ? 2.6 : 1.0;
    const d = axis === "x" ? 1.0 : 2.6;
    cover(w, 0.62, d, cx, cz, Y0, M.concrete);
    inst(plantSrc, cx - (axis === "x" ? 0.6 : 0), Y0 + 0.95, cz - (axis === "z" ? 0.6 : 0));
    inst(plantSrc, cx + (axis === "x" ? 0.6 : 0), Y0 + 0.95, cz + (axis === "z" ? 0.6 : 0));
  };
  const emergencyLight = (cx: number, cz: number, rotY = 0): void => inst(emergSrc, cx, Y0 + 2.8, cz, rotY);
  /** Door / room name plaque mounted on a wall face. */
  const plaque = (text: string, cx: number, cz: number, rotY: number, y = Y0 + 2.55): void => {
    panel(1.7, 0.42, cx, cz, y, rotY, signFor(text));
  };
  /** Double-sided wayfinding sign hung from the services zone on drop rods. */
  const hangingSign = (text: string, cx: number, cz: number, rotY = 0, y = 2.95): void => {
    // two opposed faces so the text reads correctly from both directions
    panel(3.2, 0.8, cx + Math.sin(rotY) * 0.02, cz + Math.cos(rotY) * 0.02, y, rotY, signFor(text));
    panel(3.2, 0.8, cx - Math.sin(rotY) * 0.02, cz - Math.cos(rotY) * 0.02, y, rotY + Math.PI, signFor(text));
    for (const o of [-1.2, 1.2]) {
      const rod = MeshBuilder.CreateBox(uid("rod"), { width: 0.05, height: 0.55, depth: 0.05 }, scene);
      rod.position.set(cx + Math.cos(rotY) * o, y + 0.62, cz - Math.sin(rotY) * o);
      rod.material = M.alu;
      add(rod, false, false, false);
    }
  };
  /**
   * Low guard rail: aluminium handrail on posts with a near-clear glass
   * infill. Replaces the old chest-high tinted glass slabs on the platforms,
   * which stacked up visually into a huge blue wall across the atrium.
   */
  const guardRail = (len: number, cx: number, cz: number, y: number, axis: "x" | "z" = "x"): void => {
    const bar = MeshBuilder.CreateBox(uid("rail"), { width: axis === "x" ? len : 0.09, height: 0.07, depth: axis === "x" ? 0.09 : len }, scene);
    bar.position.set(cx, y + 1.02, cz);
    bar.material = M.alu;
    add(bar, false);
    const posts = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i < posts; i++) {
      const t = len * (i / (posts - 1) - 0.5) * 0.96;
      const p = MeshBuilder.CreateBox(uid("post"), { width: 0.07, height: 1.0, depth: 0.07 }, scene);
      p.position.set(cx + (axis === "x" ? t : 0), y + 0.5, cz + (axis === "z" ? t : 0));
      p.material = M.alu;
      add(p, false, false, false);
    }
    const g = MeshBuilder.CreateBox(uid("railglass"), { width: axis === "x" ? len : 0.05, height: 0.92, depth: axis === "x" ? 0.05 : len }, scene);
    g.position.set(cx, y + 0.5, cz);
    g.material = railGlassMat;
    add(g, false, false); // collides: still prevents walking off the edge
  };

  /** Flat yellow/black chevron strip marking a sunken edge (non-colliding). */
  const hazardStrip = (w: number, d: number, cx: number, cz: number, y = Y0): void => {
    const m = MeshBuilder.CreateBox(uid("hz"), { width: w, height: 0.06, depth: d }, scene);
    m.position.set(cx, y + 0.03, cz);
    m.material = hazardMat;
    scaleUV(m, hazardMat, Math.max(w, d), Math.min(w, d));
    add(m, false, false, false);
  };
  const photocopier = (cx: number, cz: number, rotY = 0, y = Y0): void => {
    void rotY;
    cover(0.95, 1.05, 0.7, cx, cz, y, M.steel);
    cover(0.7, 0.12, 0.5, cx, cz, y + 1.05, M.serverDark); // scanner lid
  };
  const coffeeMachine = (cx: number, cz: number, topY: number): void => {
    cover(0.42, 0.55, 0.4, cx, cz, topY, M.serverDark);
    inst(cupSrc, cx + 0.35, topY + 0.06, cz);
    inst(cupSrc, cx + 0.45, topY + 0.06, cz + 0.1);
  };

  /**
   * Finished room ceiling: an acoustic-panel slab at partition height carrying
   * recessed LED light panels, AC vents, fire sprinklers, a smoke detector and
   * a ceiling speaker. Non-pickable + non-colliding so nav probe rays and
   * gameplay raycasts pass through the plenum above.
   */
  const ceiling = (x0: number, z0: number, x1: number, z1: number, h = ROOM_H, warm = false): void => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const c = MeshBuilder.CreateBox(uid("ceil"), { width: x1 - x0, height: 0.12, depth: z1 - z0 }, scene);
    c.position.set(cx, h + 0.06, cz);
    c.material = M.ceil;
    scaleUV(c, M.ceil, x1 - x0, z1 - z0);
    add(c, false, false, false);
    // Finishing trim (non-colliding, thin) so rooms read less blocky: a dark
    // skirting board at the floor line and an aluminium cornice at the ceiling.
    const trim = (y: number, th: number, mtl: WorldMaterial) => {
      for (const [w, d, px, pz] of [
        [x1 - x0, th, cx, z0], [x1 - x0, th, cx, z1],
        [th, z1 - z0, x0, cz], [th, z1 - z0, x1, cz],
      ] as const) {
        const t = MeshBuilder.CreateBox(uid("trim"), { width: w, height: y < 0.3 ? 0.16 : 0.1, depth: d }, scene);
        t.position.set(px, y, pz);
        t.material = mtl;
        add(t, false, false, false);
      }
    };
    trim(Y0 + 0.08, 0.09, M.serverDark); // skirting board
    trim(h - 0.06, 0.06, M.alu); // cornice
    const panelSrc = warm ? warmPanelSrc : ledPanelSrc;
    for (let px = x0 + 1.6; px < x1 - 0.8; px += 3.2)
      for (let pz = z0 + 1.6; pz < z1 - 0.8; pz += 3.2) inst(panelSrc, px, h - 0.03, pz);
    inst(ventSrc, x0 + 1.0, h - 0.05, z0 + 1.0);
    inst(ventSrc, x1 - 1.0, h - 0.05, z1 - 1.0);
    for (let px = x0 + 2; px < x1; px += 4.5) inst(sprinklerSrc, px, h - 0.09, cz);
    inst(detectorSrc, cx, h - 0.04, cz + Math.min(1.5, (z1 - z0) / 4));
    inst(speakerSrc, x0 + 1.4, h - 0.04, z1 - 1.0);
  };

  // ---- ceiling light strip (emissive bar, mounted high) --------------------
  const lightStrip = (w: number, d: number, cx: number, cz: number): void => {
    const s = MeshBuilder.CreateBox(uid("strip"), { width: w, height: 0.12, depth: d }, scene);
    s.position.set(cx, WALL_H - 0.15, cz);
    s.material = G.strip;
    add(s, false, false, false);
  };

  const fp = (kind: string, x0: number, z0: number, x1: number, z1: number) =>
    footprints.push({ x: BASE.x + ((x0 + x1) / 2) * S, z: BASE.z + ((z0 + z1) / 2) * S, w: (x1 - x0) * S, d: (z1 - z0) * S, kind });

  // =========================================================================
  // PERIMETER + STRUCTURE — glass curtain walls (sill / continuous window
  // band / header) so daylight enters through the facade, not an open roof.
  // Perimeter glazing is NON-breakable: the shell stays sealed in combat.
  // =========================================================================
  const SILL_H = 1.0;
  const GLAZE_H = 2.0; // window band 1.0 → 3.0
  const curtainWall = (w: number, d: number, cx: number, cz: number): void => {
    wall(w, d, cx, cz, 0, SILL_H, M.wallPaint); // sill
    // Frosted curtain glazing (sealed + mostly opaque so the boundary can't be
    // seen through into the void between the exterior silhouettes).
    const g = MeshBuilder.CreateBox(uid("frost"), { width: w, height: GLAZE_H, depth: d }, scene);
    g.position.set(cx, SILL_H + GLAZE_H / 2, cz);
    g.material = frostedMat;
    add(g, false); // collides — sealed shell
    wall(w, d, cx, cz, SILL_H + GLAZE_H, WALL_H - SILL_H - GLAZE_H, M.wallPaint); // header
  };
  curtainWall(HALF_W * 2 + WALL_T, WALL_T, 0, -HALF_D); // south
  curtainWall(HALF_W * 2 + WALL_T, WALL_T, 0, HALF_D); // north
  curtainWall(WALL_T, HALF_D * 2 + WALL_T, -HALF_W, 0); // west
  curtainWall(WALL_T, HALF_D * 2 + WALL_T, HALF_W, 0); // east
  // Aluminium mullions dividing the curtain glazing into window bays.
  for (let mx = -HALF_W + 8; mx < HALF_W; mx += 8) {
    wall(0.24, WALL_T + 0.08, mx, -HALF_D, SILL_H, GLAZE_H, M.alu);
    wall(0.24, WALL_T + 0.08, mx, HALF_D, SILL_H, GLAZE_H, M.alu);
  }
  for (let mz = -HALF_D + 7; mz < HALF_D; mz += 7) {
    wall(WALL_T + 0.08, 0.24, -HALF_W, mz, SILL_H, GLAZE_H, M.alu);
    wall(WALL_T + 0.08, 0.24, HALF_W, mz, SILL_H, GLAZE_H, M.alu);
  }
  // Horizontal transom rail splitting each window band (reads as framed bays).
  wall(HALF_W * 2 + WALL_T, WALL_T + 0.1, 0, -HALF_D, 1.9, 0.14, M.alu);
  wall(HALF_W * 2 + WALL_T, WALL_T + 0.1, 0, HALF_D, 1.9, 0.14, M.alu);
  wall(WALL_T + 0.1, HALF_D * 2 + WALL_T, -HALF_W, 0, 1.9, 0.14, M.alu);
  wall(WALL_T + 0.1, HALF_D * 2 + WALL_T, HALF_W, 0, 1.9, 0.14, M.alu);
  fp("complex", -HALF_W, -HALF_D, HALF_W, HALF_D);

  // =========================================================================
  // ROOF — a complete slab over the whole footprint, composed around two
  // deliberate glass skylights (operations atrium + reception). Non-pickable
  // and non-colliding so nav rays / gameplay raycasts pass through the plenum,
  // but fully opaque from below: the building reads as enclosed.
  // =========================================================================
  const roofY = WALL_H + 0.12;
  const roofPiece = (x0: number, z0: number, x1: number, z1: number): void => {
    if (x1 - x0 < 0.2 || z1 - z0 < 0.2) return;
    const r = MeshBuilder.CreateBox(uid("roof"), { width: x1 - x0, height: 0.35, depth: z1 - z0 }, scene);
    r.position.set((x0 + x1) / 2, roofY, (z0 + z1) / 2);
    r.material = M.concrete;
    scaleUV(r, M.concrete, x1 - x0, z1 - z0);
    add(r, false, false, false);
  };
  const skylight = (x0: number, z0: number, x1: number, z1: number): void => {
    const g = MeshBuilder.CreateBox(uid("skylight"), { width: x1 - x0, height: 0.14, depth: z1 - z0 }, scene);
    g.position.set((x0 + x1) / 2, roofY, (z0 + z1) / 2);
    g.material = glassMat;
    add(g, false, false, false);
    // ridge mullions across the glazing
    for (let mx = x0 + 4; mx < x1; mx += 4) {
      const m = MeshBuilder.CreateBox(uid("skmul"), { width: 0.22, height: 0.3, depth: z1 - z0 }, scene);
      m.position.set(mx, roofY, (z0 + z1) / 2);
      m.material = M.alu;
      add(m, false, false, false);
    }
  };
  // Skylight A over the operations atrium/courtyard; skylight B over reception.
  const SKY_A = { x0: -12, z0: -9, x1: 12, z1: 11 };
  const SKY_B = { x0: -9, z0: -42, x1: 9, z1: -29 };
  roofPiece(-HALF_W, -HALF_D, SKY_B.x0, -29); // SW of reception skylight
  roofPiece(SKY_B.x1, -HALF_D, HALF_W, -29); // SE of reception skylight
  roofPiece(-HALF_W, -29, HALF_W, SKY_A.z0); // mid band between skylights
  roofPiece(-HALF_W, SKY_A.z0, SKY_A.x0, SKY_A.z1); // west of atrium skylight
  roofPiece(SKY_A.x1, SKY_A.z0, HALF_W, SKY_A.z1); // east of atrium skylight
  roofPiece(-HALF_W, SKY_A.z1, HALF_W, HALF_D); // north band
  skylight(SKY_A.x0, SKY_A.z0, SKY_A.x1, SKY_A.z1);
  skylight(SKY_B.x0, SKY_B.z0, SKY_B.x1, SKY_B.z1);

  // Structural beam grid under the roof slab + slung light strips (the open
  // areas keep an exposed-services industrial ceiling; rooms get finished
  // acoustic ceilings below).
  for (let gx = -HALF_W + 12; gx < HALF_W; gx += 24) {
    const beam = MeshBuilder.CreateBox(uid("beam"), { width: 0.4, height: 0.4, depth: HALF_D * 2 }, scene);
    beam.position.set(gx, WALL_H - 0.2, 0);
    beam.material = M.alu;
    add(beam, false, false, false);
  }
  // HVAC trunk ducts + electrical cable trays running the length of the plenum.
  for (const dx of [-26, 2, 30]) {
    const duct = MeshBuilder.CreateBox(uid("duct"), { width: 1.0, height: 0.6, depth: HALF_D * 2 - 4 }, scene);
    duct.position.set(dx, WALL_H - 0.7, 0);
    duct.material = M.steel;
    add(duct, false, false, false);
  }
  for (const tz of [-26, 14]) {
    const tray = MeshBuilder.CreateBox(uid("tray"), { width: HALF_W * 2 - 6, height: 0.1, depth: 0.5 }, scene);
    tray.position.set(0, WALL_H - 1.1, tz);
    tray.material = M.serverDark;
    add(tray, false, false, false);
  }
  // Maintenance access hatches + ventilation shaft drops (visual roof services).
  for (const [hx, hz] of [[-38, -20], [38, 18]] as const) {
    const hatch = MeshBuilder.CreateBox(uid("hatch"), { width: 1.0, height: 0.12, depth: 1.0 }, scene);
    hatch.position.set(hx, WALL_H - 0.08, hz);
    hatch.material = M.alu;
    add(hatch, false, false, false);
  }
  for (const [vx, vz] of [[-44, 30], [44, -24]] as const) {
    const shaft = MeshBuilder.CreateBox(uid("shaft"), { width: 1.4, height: 1.6, depth: 1.4 }, scene);
    shaft.position.set(vx, WALL_H - 0.8, vz);
    shaft.material = M.steel;
    add(shaft, false, false, false);
  }
  for (let gz = -HALF_D + 8; gz < HALF_D; gz += 12)
    for (let gx = -HALF_W + 14; gx < HALF_W; gx += 20) lightStrip(6, 0.6, gx, gz);

  // =========================================================================
  // MAIN FLOOR — flat y=0, composed slabs with holes for the sunken dock,
  // sunken courtyard, and sunken briefing pit.
  // =========================================================================
  // GAP-FREE FLOOR — a horizontal-band decomposition. Bands are split at the
  // z-edges of the three sunken features, and within each band at the x-edges
  // of any hole (and at material boundaries). Every rectangle abuts its
  // neighbours edge-to-edge with no overlap and no gap, so there is nowhere to
  // fall through. Holes left open: dock x[-56,-40]z[-42,-28], courtyard
  // x[-7,7]z[-7,7], briefing pit x[-24,-10]z[14,24].
  //
  // `band(z0,z1, segments)` lays one row; each segment is [x0,x1,material].
  const band = (z0: number, z1: number, segs: Array<[number, number, WorldMaterial]>): void => {
    for (const [x0, x1, mtl] of segs) slab(x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2, Y0, mtl);
  };
  band(-42, -28, [[-40, 36, M.tile], [36, 56, M.tile]]); // public concourse (dock hole west of x=-40)
  band(-28, -7, [[-56, -20, M.carpetA], [-20, 36, M.carpetA], [36, 56, M.tile]]); // offices + east staff tile
  band(-7, 7, [[-56, -7, M.carpetA], [7, 36, M.carpetA], [36, 56, M.tile]]); // atrium sides (courtyard hole x[-7,7])
  band(7, 14, [[-56, 36, M.carpetB], [36, 56, M.tile]]); // secure approach
  band(14, 24, [[-56, -24, M.carpetB], [-10, 36, M.carpetB], [36, 56, M.tile]]); // pit band (pit hole x[-24,-10])
  band(24, 42, [[-56, 56, M.carpetB]]); // secure + technical north

  // Sunken loading dock (SW), own floor + ramp rising east to the public band.
  slab(16, 14, -48, -35, Y_DOCK, M.concrete);
  ramp(4, 6, -39.5, -46, Y_DOCK, Y0, "x"); // dock floor at x=-46 up to Y0 at x=-40, clear of the south wall
  // Skirt walls: the perimeter walls start at Y0, so close the 1.6m gap
  // beneath them where they cross the sunken dock.
  wall(WALL_T, 14, -56, -35, Y_DOCK, -Y_DOCK, M.concrete);
  wall(16, WALL_T, -48, -42, Y_DOCK, -Y_DOCK, M.concrete);
  fp("dock", -56, -42, -40, -28);

  // Sunken courtyard (atrium centre) + ramp down (west edge) + glass bridge.
  slab(14, 14, 0, 0, Y_PIT, M.tile);
  ramp(4, 4, 0, -7, Y0, Y_PIT, "x"); // descends eastward from the west rim
  const bridge = slab(14, 3.6, 0, 0, Y0, M.alu);
  bridge.material = M.alu;
  guardRail(14, 0, -1.8, Y0, "x");
  guardRail(14, 0, 1.8, Y0, "x");
  cover(0.5, 1.0, 0.5, -4, 0, Y_PIT, M.steel); // bridge support columns
  cover(0.5, 1.0, 0.5, 4, 0, Y_PIT, M.steel);
  fp("courtyard", -7, -7, 7, 7);

  // Sunken briefing pit (military zone, tiered seating look) + ramp rising to
  // the secure zone at the pit's north edge.
  slab(14, 10, -17, 19, Y_PIT, M.carpetB);
  ramp(4, 4, -17, 20, Y_PIT, Y0, "z"); // pit floor at z=20 up to Y0 at z=24
  // Tiered benches: each tier is a solid block from the pit floor up (the old
  // stacked thin planks left the upper tiers floating in mid-air).
  for (let t = 0; t < 3; t++) cover(12, 0.35 * (t + 1), 1.2, -17, 15.5 + t * 1.4, Y_PIT, M.wood);

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
  flag(-2, -38.4, Math.PI); // faces the reception hall
  missionBoard(6, -39.6, 0);
  // Visitor waiting lounge (east of reception, on the tile concourse — the
  // old west spot floated over the sunken loading dock).
  sofa(16, -36, 0);
  sofa(22, -36, 0);
  sofa(19, -31, Math.PI);
  cover(1.6, 0.5, 1.0, 19, -33.5, Y0, M.wood); // coffee table
  plant(25, -32);
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
  cardReader(-9.4, -27.6);
  cardReader(9.4, -27.6, Math.PI);
  cctv(-20, -29, 0.5);
  cctv(20, -29, -0.5);
  // Reception greenery + bins under the entrance skylight.
  plant(-8, -38);
  plant(8, -38);
  plant(-38.5, -29);
  bin(-6, -34);
  bin(12, -34);
  waterCooler(-44, -27); // beside the dock rim, on the tile concourse

  // =========================================================================
  // MID — OFFICE DEPARTMENTS (west & east) + open-plan + cubicle maze
  // =========================================================================
  // Structural column grid through the office core (hard cover + sightline
  // breaks) — blue wayfinding bands mark the office zone.
  for (const px of [-30, -14, 14, 30]) for (const pz of [-20, -8, 4]) pillar(px, pz, Y0, WALL_H, M.accentBlue);

  // West department rooms in two columns with a 2m corridor between them.
  // Inner column x[-33,-17], outer column x[-51,-35] (abuts the cable corridor
  // wall at x=-51) — no overlap with the corridor or each other.
  const westRooms: Array<[string, number, number]> = [
    ["HR OFFICE", -25, -22],
    ["FINANCE OFFICE", -25, -12],
    ["ADMIN OFFICE", -43, -22],
    ["PLANNING OFFICE", -43, -12],
  ];
  for (const [label, cx, cz] of westRooms) {
    roomShell(cx - 8, cz - 4, cx + 8, cz + 4, M.wallCool, [{ side: "e", at: cz, width: 2.2 }], ROOM_H, ["e"], label);
    desk(cx - 4, cz + 1, 0);
    desk(cx + 3, cz - 1, Math.PI);
    cabinet(cx - 6, cz - 2.5);
    photocopier(cx + 6, cz + 2.5);
    bin(cx + 6.5, cz - 3);
    plant(cx - 7, cz + 3);
    whiteboard(cx, cz + 3.6, Math.PI);
    missionBoard(cx - 7.6, cz, Math.PI / 2);
    ceiling(cx - 8, cz - 4, cx + 8, cz + 4);
    plaque(label, cx + 8.3, cz, -Math.PI / 2); // readable from the corridor (east)
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
      // half-finished meeting: cups on the table + conference display
      inst(cupSrc, cx - 0.8, Y0 + 0.83, cz - 0.3);
      inst(cupSrc, cx + 1.1, Y0 + 0.83, cz + 0.2);
      panel(2.2, 1.3, cx, cz + 3.55, Y0 + 1.9, 0, nocMat); // conference display (faces the table)
      whiteboard(cx - 7.6, cz, Math.PI / 2);
      plant(cx + 6.5, cz - 3.5);
    } else {
      desk(cx - 4, cz + 1, 0);
      desk(cx + 3, cz - 1, Math.PI);
      cabinet(cx + 6, cz + 2.5);
      boxStack(cx - 6, cz - 2, 3);
      bin(cx - 6.5, cz + 3);
    }
    ceiling(cx - 8, cz - 4, cx + 8, cz + 4, ROOM_H, glassy); // warm light in meeting/breakout
    plaque(label, cx - 8.3, cz, Math.PI / 2);
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
  guardRail(16, 44, -28.2, Y_SPLIT, "x");
  cover(16, Y_SPLIT, 0.3, 44, -28.35, Y0, M.concrete); // front skirt closes the underside gap
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
  guardRail(20, 0, 3.2, Y_CMD, "x");
  for (const [lx, lz] of [[-9, 4], [9, 4], [-9, 8.4], [9, 8.4]] as const)
    cover(0.4, Y_CMD, 0.4, lx, lz, Y0, M.steel); // platform legs
  ramp(3.5, 6, -9, 0, Y0, Y_CMD, "z");
  ramp(3.5, 6, 9, 0, Y0, Y_CMD, "z");
  cover(3, 0.9, 1.4, 0, 7, Y_CMD, M.wood); // command console
  inst(monitorSrc, -1, Y_CMD + 1.2, 7, 0);
  inst(monitorSrc, 1, Y_CMD + 1.2, 7, 0);
  // Overwatch balcony above the command platform (highest point), 2 ramps.
  slab(14, 4, 0, 9, Y_BALC, M.alu);
  guardRail(14, 0, 7.2, Y_BALC, "x");
  for (const lx of [-6, 6]) cover(0.4, Y_BALC, 0.4, lx, 10.6, Y0, M.steel); // balcony rear legs
  ramp(3, 5, -8, 6, Y_CMD, Y_BALC, "z");
  ramp(3, 5, 8, 6, Y_CMD, Y_BALC, "z");
  for (const px of [-16, 16]) pillar(px, 6, Y0, WALL_H, M.accentTeal);

  // =========================================================================
  // WEST WING INFILL — Medical Clinic + Training Room fill the previously
  // empty band between the utility rooms and the secure approach, giving the
  // west flank the same room density (and cover) as the east.
  // =========================================================================
  roomShell(-48, -2, -36, 6, M.wallCool, [{ side: "e", at: 2, width: 2.0 }]);
  cover(2.0, 0.7, 1.0, -45, 2, Y0, M.wallPaint); // treatment bed
  cover(2.0, 0.7, 1.0, -45, -1, Y0, M.wallPaint); // second bed
  cabinet(-38, 4.5);
  cabinet(-46.5, 4.8);
  panel(1.0, 1.0, -42, 5.6, Y0 + 1.8, Math.PI, G.emergency); // clinic cross sign
  ceiling(-48, -2, -36, 6);
  fp("medical-clinic", -48, -2, -36, 6);
  roomShell(-40, 6, -24, 14, M.wallCool, [{ side: "s", at: -32, width: 2.2 }], ROOM_H, ["s"]);
  for (const rz of [9, 11.5] as const)
    for (const rx of [-37, -34, -31, -28] as const) inst(chairSrc, rx, Y0 + 0.25, rz, Math.PI);
  whiteboard(-32, 13.6, Math.PI);
  panel(2.6, 1.5, -36.5, 13.55, Y0 + 1.9, Math.PI, G.screen); // projector screen
  cover(1.2, 0.75, 0.8, -32, 7.5, Y0, M.wood); // instructor lectern
  ceiling(-40, 6, -24, 14);
  fp("training-room", -40, 6, -24, 14);

  // Secure-approach corridor (z 7-17): planter cover every few metres breaks
  // the 100m east-west sightline into readable engagement segments.
  for (const px of [-44, -20, 20, 44] as const) bigPlanter(px, 12, "x");
  bigPlanter(-6, 15, "z");
  bigPlanter(6, 15, "z");
  // Mid-office concourse (z≈-10) cover cluster on each flank.
  cabinet(-22, -10);
  photocopier(-22, -8.6);
  bigPlanter(22, -10, "z");

  // =========================================================================
  // NORTH — MILITARY SECURE BLOCK (ops centre / command / comms / signals /
  // archive / vault / armoury / equipment) behind a security barrier.
  // =========================================================================
  // Secure barrier line at z=17 with a controlled central gate + side flanks.
  // The west segment stops at the briefing pit (x=-24) instead of floating
  // across it — the pit itself is the covert route under the secure line.
  wall(8, WALL_T, -28, 17, Y0, ROOM_H, M.olive);
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
  for (const sx of [-6, -2, 2, 6]) panel(3.4, 2.0, sx, 31.7, Y0 + 2.0, 0, nocMat); // NOC screen wall (faces the room)
  cover(10, 0.85, 1.4, 0, 26, Y0, M.wood); // ops console row
  for (const o of [-3, 0, 3]) inst(monitorSrc, o, Y0 + 1.25, 26.6, Math.PI);
  for (const o of [-3, 0, 3]) inst(chairSrc, o, Y0 + 0.25, 24.6, 0);
  // Ops centre uses a taller exposed-services ceiling (beams/ducts visible
  // above the partitions) for visual variety over the standard office rooms.
  ceiling(-12, 20, 12, 32, 4.6);
  cardReader(1.8, 19.7, Math.PI); // controlled entry off the secure gate
  cctv(-10, 30, 2.4);

  // West secure block — two columns: outer x[-50,-37] rooms open WEST onto the
  // cable corridor, inner x[-37,-24] rooms open EAST onto the secure spine, so
  // every room has access and nothing overlaps the corridor, ops centre or pit.
  const westSecure: Array<[string, number, number, number, number, "w" | "e"]> = [
    ["SIGNALS ROOM", -50, 19, -37, 30, "w"],
    ["COMMS ROOM", -37, 19, -24, 30, "e"],
    ["SERVER ROOM", -50, 30, -37, 42, "w"],
    ["SECURE ARCHIVE", -37, 30, -24, 42, "e"],
  ];
  for (const [label, x0, z0, x1, z1, doorSide] of westSecure) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const steelRoom = label === "SECURE ARCHIVE" || label === "SERVER ROOM";
    roomShell(x0, z0, x1, z1, steelRoom ? M.steel : M.wallCool, [{ side: doorSide, at: cz, width: 2.0 }], ROOM_H, [], label);
    if (label === "SERVER ROOM") for (let a = 0; a < 3; a++) serverRack(x0 + 2.6 + a * 2.7, cz);
    else if (label === "SECURE ARCHIVE") { for (let i = 0; i < 3; i++) cabinet(x0 + 2.5 + i * 1.6, z1 - 2); boxStack(x1 - 3, z0 + 2.5, 3); }
    else if (label === "SIGNALS ROOM") { serverRack(x0 + 3, cz + 1.5); desk(cx, cz - 2, 0); }
    else { desk(cx, cz + 1, Math.PI); cabinet(x0 + 2, z1 - 2); }
    missionBoard(cx, z1 - 0.35, Math.PI);
    ceiling(x0, z0, x1, z1);
    const doorX = doorSide === "e" ? x1 : x0;
    cardReader(doorX + (doorSide === "e" ? -0.3 : 0.3), cz - 1.4, doorSide === "e" ? 0 : Math.PI);
    plaque(label, doorX + (doorSide === "e" ? 0.3 : -0.3), cz, doorSide === "e" ? -Math.PI / 2 : Math.PI / 2);
    fp(label.toLowerCase().replace(/\s+/g, "-"), x0, z0, x1, z1);
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
      flag(cx, cz + 4.6, 0); // faces into the command office
    } else if (label === "ARMOURY" || label === "EQUIPMENT ISSUE") {
      locker(cx, cz + 3.6, 10, "x");
      locker(cx - 5, cz, 6, "z");
      counter(6, 1.0, cx, cz - 3);
    } else {
      for (let i = 0; i < 3; i++) cabinet(cx - 4 + i * 3, cz + 3);
      boxStack(cx, cz - 2, 2);
    }
    ceiling(cx - 7, cz - 5, cx + 7, cz + 5, ROOM_H, label === "COMMAND OFFICE");
    cardReader(cx - 6.9, cz - 1.4, Math.PI);
    plaque(label, cx - 7.3, cz, Math.PI / 2);
    fp(label.toLowerCase().replace(/\s+/g, "-"), cx - 7, cz - 5, cx + 7, cz + 5);
  }
  // Briefing room label (the sunken pit is its floor) + command projector board
  // on a floor stand (it used to float unsupported in front of the pit).
  missionBoard(-17, 13.8, 0);
  for (const px of [-19.1, -14.9]) cover(0.12, 1.25, 0.12, px, 13.8, Y0, M.steel); // board stand legs
  fp("briefing-room", -24, 14, -10, 24);

  // =========================================================================
  // WEST TECHNICAL SPINE — cable/utility maintenance corridor (x[-56,-50]).
  // The old standalone utility rooms (Electrical / AC Plant / Fire Control /
  // Storage / Workshop) overlapped the west offices and are folded into this
  // service spine as open plant bays. Its east wall is solid south of the
  // secure block with one mid-run door (z 6-10) to the west approach; north of
  // z=19 the outer secure rooms' west walls close it.
  // =========================================================================
  fp("cable-corridor", -56, -28, -50, 42);
  wall(WALL_T, 34, -50, -11, Y0, ROOM_H, M.concrete); // east wall z[-28,6]
  wall(WALL_T, 9, -50, 14.5, Y0, ROOM_H, M.concrete); // east wall z[10,19] (door gap z[6,10])
  // Plant bays lining the corridor (open — no room shells).
  const plantBays: Array<[number, "elec" | "ac" | "fire" | "store"]> = [
    [-24, "elec"], [-14, "ac"], [-4, "fire"], [16, "store"], [28, "store"],
  ];
  for (const [pz, kind] of plantBays) {
    if (kind === "elec" || kind === "ac") cover(2.2, 2.2, 1.3, -53.6, pz, Y0, M.steel); // switchgear / AC plant
    else if (kind === "fire") { cover(1.4, 1.6, 0.5, -54.6, pz, Y0, M.steel); ext(-52.5, pz - 1.4); ext(-52.5, pz + 1.4); } // fire panel
    else boxStack(-53.6, pz, 3); // storage
  }
  for (const cz of [-27, -8, 22]) cabinet(-54.6, cz);
  for (const cz of [-18, 4, 26]) emergencyLight(-50.4, cz, Math.PI); // service-corridor emergency lighting
  plaque("PLANT & UTILITIES", -50.3, -20, Math.PI / 2);
  exitSign(-53, -27.4, 0);

  // =========================================================================
  // EAST STAFF-FACILITIES WING — cafeteria / kitchen / pantry / washrooms in
  // the block x[36,52] z[-7,17], with a 4m service corridor along the east
  // perimeter (x[52,56]) formed by the rooms' own east walls. This replaces
  // the old wing whose rooms overlapped the Armoury and poked outside the
  // building shell, and whose corridor wall sliced through the rooms.
  // =========================================================================
  fp("staff-corridor", 52, -28, 56, 17);
  // CAFETERIA — two entrances (concourse + corridor) so it plays as a route.
  roomShell(36, -7, 52, 3, M.wallCool, [
    { side: "w", at: -2, width: 2.2 },
    { side: "e", at: -2, width: 2.0 },
  ]);
  for (const [tx, tz] of [[41, -4], [47, -4], [41, 0], [47, 0]] as const) {
    cover(1.8, 0.75, 1.8, tx, tz, Y0, M.wood);
    inst(chairSrc, tx - 1.2, Y0 + 0.25, tz, 0);
    inst(chairSrc, tx + 1.2, Y0 + 0.25, tz, Math.PI);
    if (Math.random() < 0.6) inst(cupSrc, tx + 0.3, Y0 + 0.83, tz + 0.2);
  }
  sofa(38, 1.5, 0);
  waterCooler(50.5, 1.8);
  bin(37, -5.8);
  bin(50.8, -5.8);
  plant(44, 2);
  ceiling(36, -7, 52, 3, ROOM_H, true); // warm cafeteria lighting
  exitSign(44, -6.6, 0);
  fp("cafeteria", 36, -7, 52, 3);
  // KITCHEN — connects to the cafeteria (shared door) and the corridor.
  roomShell(36, 3, 52, 13, M.wallCool, [
    { side: "e", at: 8, width: 2.0 },
    { side: "s", at: 44, width: 1.8 },
  ]);
  counter(12, 1.0, 44, 11.5);
  counter(1.0, 6, 37.5, 8);
  coffeeMachine(40, 11.5, Y0 + 1.0); // machine on the back counter
  cover(1.2, 1.9, 0.8, 50.5, 11.5, Y0, M.steel); // tall fridge
  bin(37, 4.5);
  ceiling(36, 3, 52, 13);
  fp("kitchen", 36, 3, 52, 13);
  // PANTRY + WASHROOMS — small rooms in the z[13,17] band facing the secure approach.
  roomShell(36, 13, 44, 17, M.wallCool, [{ side: "n", at: 40, width: 1.8 }]);
  counter(3.5, 0.9, 40, 14.2);
  coffeeMachine(41.2, 14.2, Y0 + 0.9);
  waterCooler(37, 16);
  ceiling(36, 13, 44, 17);
  fp("pantry", 36, 13, 44, 17);
  roomShell(44, 13, 52, 17, M.tile, [{ side: "n", at: 48, width: 1.6 }]);
  ceiling(44, 13, 52, 17);
  fp("washrooms", 44, 13, 52, 17);
  // Locker + fitness alcove in the corridor's south run (open, not a room).
  locker(55.4, -22, 10, "z");
  cover(0.4, 0.45, 5, 53.6, -22, Y0, M.wood); // change bench
  for (const gz of [-12, -9.5]) cover(1.2, 1.1, 2.0, 55, gz, Y0, M.rubber); // fitness rig pair
  for (const ez of [-20, -2, 10]) emergencyLight(52.35, ez); // corridor emergency lights
  exitSign(54, -27.4, 0);
  cctv(54, 15, Math.PI);

  // (West utility rooms removed — they overlapped the west offices; utility is
  // now the open plant bays along the cable corridor, above.)
  // Loading dock props (crates, roller door, fork of boxes) — on the DOCK floor.
  boxStack(-50, -34, 3, Y_DOCK);
  boxStack(-46, -32, 2, Y_DOCK);
  cover(2, 2.6, 0.4, -55.6, -35, Y_DOCK, M.steel); // roller-door face
  exitSign(-48, -41.4, 0);

  // Scatter a few CCTV cameras + exit signs + extinguishers along the spine for occupancy.
  for (const [cx, cz, ry] of [[-6, -12, 0.4], [6, 4, -0.4], [-6, 20, 0.4], [6, 30, -0.4]] as const) cctv(cx, cz, ry);
  for (const [cx, cz] of [[-6, -30], [6, -8], [-6, 12], [6, 22]] as const) ext(cx, cz);
  // Atrium planters + corridor bins for lived-in occupancy.
  for (const [px, pz] of [[-14, -6], [14, -6], [-14, 8], [14, 8]] as const) plant(px, pz);
  for (const [bx, bz] of [[-48, -2], [48.8, -2], [-6, -16], [6, 14]] as const) bin(bx, bz);

  // =========================================================================
  // AAA POLISH — cover in front of exposed glass, sightline breakers in the
  // open areas, and environmental storytelling.
  // =========================================================================
  // Partial cover in front of the glass-fronted east meeting/breakout rooms so
  // occupants aren't fully exposed through the glazing.
  bigPlanter(33, -22, "z"); // in front of MEETING glass (west face x=36)
  bigPlanter(33, -12, "z"); // in front of BREAKOUT glass
  cover(2.6, 1.1, 0.5, 44, -7.4, Y0, M.alu); // low counter under BREAKOUT south glass
  // Open-plan cubicle bay (breaks the central sightline + soft cover). A 3x2
  // grid of half-height pods between the office columns.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const px = -6 + c * 6;
      const pz = -22 + r * 5;
      cover(2.4, 1.2, 0.12, px, pz + 1.1, Y0, M.wallCool); // pod back
      cover(0.12, 1.2, 2.2, px - 1.2, pz, Y0, M.wallCool); // pod side
      desk(px, pz, r === 0 ? 0 : Math.PI);
    }
  // Half-height partitions breaking the long secure-approach + concourse runs.
  for (const [hx, hz, ax] of [[-16, 10, "x"], [16, 10, "x"], [-16, -24, "x"], [16, -24, "x"]] as const)
    cover(ax === "x" ? 4 : 0.4, 1.1, ax === "x" ? 0.4 : 4, hx, hz, Y0, M.wallCool);

  // Environmental storytelling (non-colliding decals + light props): scattered
  // documents on the floor, an abandoned equipment case, a barricaded office.
  const docSrc = makeSource("ic_src_doc", () => {
    const d = MeshBuilder.CreatePlane("doc", { width: 0.3, height: 0.42 }, scene);
    d.rotation.x = Math.PI / 2;
    d.material = glow("ic_paper", [0.9, 0.9, 0.86]);
    d.bakeCurrentTransformIntoVertices();
    return d;
  });
  const doc = (cx: number, cz: number): void => inst(docSrc, cx, Y0 + 0.02, cz, Math.random() * Math.PI);
  for (const [dx, dz] of [[-2, -34], [3, -33], [-18, 6], [12, 22], [-30, 26], [42, 6], [1, 12], [-6, -20]] as const) {
    doc(dx, dz); doc(dx + 0.4, dz + 0.3);
  }
  // Abandoned equipment cases (hard cover) at a couple of chokepoints.
  for (const [cx, cz] of [[-2, -24], [8, 12], [-20, 20]] as const) { boxStack(cx, cz, 2); }
  // Barricaded HR office: desks shoved against the doorway (story + soft cover).
  cover(2.2, 0.9, 0.9, -17, -22, Y0, M.wood);
  cover(0.9, 0.9, 2.0, -18.5, -22, Y0, M.wood);
  // Evacuation signage at the main junctions.
  for (const [ex, ez, er] of [[-6, -26, 0], [6, 16, Math.PI], [-30, 12, Math.PI / 2]] as const) exitSign(ex, ez, er);

  // =========================================================================
  // WAYFINDING SIGNAGE — hanging signs at junctions + plaques on named rooms
  // the dept loops didn't cover, and the reception crest feature wall.
  // =========================================================================
  hangingSign("SECURITY SCREENING", 0, -26.5);
  hangingSign("RECEPTION", 0, -33.5);
  hangingSign("OPERATIONS ATRIUM", 0, -10.5);
  hangingSign("OPERATIONS CENTRE", 0, 15.3);
  hangingSign("TECHNICAL WING", -40, 9.5, Math.PI / 2);
  hangingSign("STAFF FACILITIES", 40, 9.5, Math.PI / 2);
  hangingSign("LIFT LOBBY", 40, -36.5);
  hangingSign("LOADING DOCK", -42.5, -30.5, Math.PI / 2);
  plaque("CAFETERIA", 35.7, -2, Math.PI / 2);
  plaque("KITCHEN", 52.3, 8, -Math.PI / 2);
  plaque("PANTRY", 40, 17.3, Math.PI);
  plaque("WASHROOMS", 48, 17.3, Math.PI);
  plaque("MEDICAL CLINIC", -35.7, 2, -Math.PI / 2);
  plaque("TRAINING ROOM", -32, 5.7, 0);
  plaque("OPERATIONS CENTRE", 0, 19.7, 0);
  panel(2.4, 2.4, 0, -41.6, Y0 + 3.6, Math.PI, crestMat); // reception crest wall (faces north)

  // Hazard chevron edging around the three sunken openings (split around the
  // ramp / bridge approaches so the markings never cross a walk line).
  hazardStrip(14.6, 0.3, 0, 7.3); // courtyard north rim
  hazardStrip(14.6, 0.3, 0, -7.3); // courtyard south rim
  for (const zz of [-4.7, 4.7] as const) hazardStrip(0.3, 4.6, 7.3, zz); // east rim (gap at bridge)
  for (const zz of [-4.7, 4.7] as const) hazardStrip(0.3, 4.6, -7.3, zz); // west rim (gap at ramp)
  hazardStrip(14, 0.3, -17, 13.7); // briefing pit south rim
  hazardStrip(5, 0.3, -21.5, 24.3); // pit north rim west of ramp
  hazardStrip(5, 0.3, -12.5, 24.3); // pit north rim east of ramp
  hazardStrip(0.3, 10, -24.3, 19); // pit west rim
  hazardStrip(0.3, 10, -9.7, 19); // pit east rim
  hazardStrip(0.3, 9, -39.7, -32.5); // dock rim beside the ramp
  hazardStrip(16, 0.3, -48, -27.7); // dock north rim

  // =========================================================================
  // EXTERIOR SURROUND — concrete apron + asphalt ring + skyline silhouettes,
  // so the curtain-wall windows look out onto a real compound instead of
  // empty void. All non-colliding, outside the playable shell.
  // =========================================================================
  const outSlab = (w: number, d: number, cx: number, cz: number, mtl: WorldMaterial, y = -0.02): void => {
    const m = MeshBuilder.CreateBox(uid("out"), { width: w, height: 0.25, depth: d }, scene);
    m.position.set(cx, y - 0.125, cz);
    m.material = mtl;
    scaleUV(m, mtl, w, d);
    add(m, false, false, false);
  };
  // concrete apron ring (8m) directly around the building
  outSlab(HALF_W * 2 + 16, 8, 0, -HALF_D - 4, M.concrete);
  outSlab(HALF_W * 2 + 16, 8, 0, HALF_D + 4, M.concrete);
  outSlab(8, HALF_D * 2, -HALF_W - 4, 0, M.concrete);
  outSlab(8, HALF_D * 2, HALF_W + 4, 0, M.concrete);
  // asphalt compound ground beyond the apron
  outSlab(320, 110, 0, -HALF_D - 63, asphaltMat, -0.05);
  outSlab(320, 110, 0, HALF_D + 63, asphaltMat, -0.05);
  outSlab(110, HALF_D * 2 + 16, -HALF_W - 63, 0, asphaltMat, -0.05);
  outSlab(110, HALF_D * 2 + 16, HALF_W + 63, 0, asphaltMat, -0.05);
  // 2D skyline billboards: a drawn city facade wrapped around the building on
  // all four sides, just beyond the apron. Through the frosted glazing this
  // reads as an adjacent cityscape and completely seals the boundary — no void,
  // no gaps between silhouettes. Unlit + non-colliding.
  const skylineTex = makeTex("skyline", (ctx, s) => {
    const rand = mulberry32(717);
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "#8fb2cc"); g.addColorStop(0.55, "#b9ccd8"); g.addColorStop(1, "#cdd7dd");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let layer = 0; layer < 3; layer++) {
      const base = s * (0.42 + layer * 0.16);
      const shade = [ "#5c6f80", "#47576620", "#33404d" ][layer];
      ctx.fillStyle = ["#6d8698", "#566a7b", "#42525f"][layer];
      let x = -20;
      while (x < s + 20) {
        const bw = 18 + rand() * 40;
        const bh = (0.3 + rand() * 0.7) * (s - base);
        ctx.fillRect(x, base - bh + (s - base), bw, bh + 40);
        // lit windows
        ctx.fillStyle = layer === 0 ? "#dfe8b0" : "#c9d4a8";
        for (let wy = base - bh + (s - base) + 6; wy < s; wy += 9)
          for (let wx = x + 4; wx < x + bw - 4; wx += 8)
            if (rand() < 0.5) ctx.fillRect(wx, wy, 3, 4);
        ctx.fillStyle = ["#6d8698", "#566a7b", "#42525f"][layer];
        x += bw + 4 + rand() * 8;
      }
      void shade;
    }
  }, 512);
  skylineTex.wrapU = Texture.WRAP_ADDRESSMODE;
  skylineTex.uScale = 4; // repeat the city band a few times across each billboard
  const skylineMat = emissiveTexMat(skylineTex);
  skylineMat.backFaceCulling = false;
  const SKY_DIST = 46;
  const SKY_H = 60;
  const billboard = (w: number, cx: number, cz: number, rotY: number): void => {
    const m = MeshBuilder.CreatePlane(uid("skyline"), { width: w, height: SKY_H }, scene);
    m.position.set(cx, SKY_H / 2 - 6, cz);
    m.rotation.y = rotY;
    m.material = skylineMat;
    add(m, false, false, false);
  };
  const spanW = HALF_W * 2 + SKY_DIST * 2;
  const spanD = HALF_D * 2 + SKY_DIST * 2;
  billboard(spanW, 0, -HALF_D - SKY_DIST, 0); // south
  billboard(spanW, 0, HALF_D + SKY_DIST, Math.PI); // north
  billboard(spanD, -HALF_W - SKY_DIST, 0, -Math.PI / 2); // west
  billboard(spanD, HALF_W + SKY_DIST, 0, Math.PI / 2); // east
  // A few solid tower blocks between the shell and the billboard for parallax depth.
  const towers: Array<[number, number, number]> = [
    [-78, -70, 34], [70, -74, 28], [82, 40, 40], [-40, 78, 30], [-84, 30, 24],
  ];
  for (const [tx, tz, th] of towers) {
    const t = MeshBuilder.CreateBox(uid("tower"), { width: 14 + (th % 10), height: th, depth: 14 + ((th * 7) % 8) }, scene);
    t.position.set(tx, th / 2 - 0.05, tz);
    t.material = towerMat;
    add(t, false, false, false);
  }

  // Build-time layout validation: warn on any pair of room rectangles that
  // overlap (shared edges are fine). Surfaces layout regressions immediately.
  for (let i = 0; i < roomRects.length; i++)
    for (let j = i + 1; j < roomRects.length; j++) {
      const a = roomRects[i];
      const b = roomRects[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ox > 0.05 && oz > 0.05)
        console.warn(`[IronCitadel] room overlap: "${a.name}" ∩ "${b.name}" = ${ox.toFixed(1)}×${oz.toFixed(1)}m`);
    }

  // The complex is fully enclosed: curtain-wall glazing + two skylights admit
  // the daylight/IBL; ceilings' LED panels, light strips, screen glow and
  // signage carry the interior lighting read. Roof/ceiling meshes are
  // non-pickable + non-colliding so nav rays and hitscans pass cleanly.
  return {
    spawn: new Vector3(BASE.x + 0, 1.2, BASE.z - 40 * S), // reception staging, just above the y=0 floor
    root,
    footprints,
    dispose(): void {
      for (const i of instances) i.dispose();
      for (const m of meshes) m.dispose();
      root.dispose();
    },
  };
}
