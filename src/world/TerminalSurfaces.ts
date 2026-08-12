import { Scene, DynamicTexture, Texture, Color3 } from "@babylonjs/core";
import { WorldMaterial } from "@/world/WorldMaterial";
import { mulberry32, createDetailNormalTexture } from "@/world/Level";

/**
 * Procedural PBR surfaces for Pasir Panjang Terminal.
 *
 * Everything is generated once, on the canvas, at first map build — no image
 * assets to ship. Each surface pairs an albedo canvas with the shared detail
 * normal map so it picks up real relief under the flood lights instead of
 * reading as a flat colour swatch.
 *
 * Two things fight visible tiling, because a container apron is the worst case
 * for it — a huge, uniform, flat plane:
 *   1. Every albedo carries large, low-frequency tonal blotches as well as
 *      fine grain, so the eye finds no single repeating motif to lock onto.
 *   2. UV scale is chosen per surface against its real-world size, and the
 *      apron is additionally broken up by non-tiling overlay decals painted on
 *      top of it (see the surface-patch pass in PasirPanjang.ts).
 */

const TEX = 512;

/** Shared canvas setup: fill with the base tone and hand back the 2D context. */
function canvas(scene: Scene, name: string, base: string, size = TEX): { tex: DynamicTexture; ctx: CanvasRenderingContext2D } {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  return { tex, ctx };
}

/** Large soft tonal variation — the low-frequency layer that hides tiling. */
function blotches(ctx: CanvasRenderingContext2D, rand: () => number, count: number, alpha: number, size = TEX): void {
  for (let i = 0; i < count; i++) {
    const shade = 30 + Math.floor(rand() * 60);
    ctx.fillStyle = `rgba(${shade},${shade + 3},${shade - 3},${alpha})`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, 20 + rand() * 90, 16 + rand() * 70, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Fine grain: aggregate, grit, flecks. */
function speckle(ctx: CanvasRenderingContext2D, rand: () => number, count: number, size = TEX): void {
  for (let i = 0; i < count; i++) {
    const light = rand() < 0.35;
    const shade = light ? 80 + Math.floor(rand() * 50) : 14 + Math.floor(rand() * 34);
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade - 2},${light ? 0.2 : 0.32})`;
    ctx.fillRect(rand() * size, rand() * size, 1.4, 1.4);
  }
}

/** Irregular dark seep — oil, damp, hydraulic fluid. */
function stains(ctx: CanvasRenderingContext2D, rand: () => number, count: number, strength = 0.26, size = TEX): void {
  for (let i = 0; i < count; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 12 + rand() * 46;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.55 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Hairline cracking, drawn as short wandering polylines. */
function cracks(ctx: CanvasRenderingContext2D, rand: () => number, count: number, alpha = 0.3, size = TEX): void {
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rand() * 5);
    for (let s = 0; s < segs; s++) {
      x += (rand() - 0.5) * 70;
      y += (rand() - 0.5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * The container apron: poured concrete slabs with expansion joints, decades of
 * tyre tracking, spilled diesel and crack repair. The single most-seen surface
 * on the map, so it gets the most work.
 */
function apronTexture(scene: Scene): DynamicTexture {
  const { tex, ctx } = canvas(scene, "ppApronTex", "#4a4b48");
  const rand = mulberry32(1207);
  blotches(ctx, rand, 70, 0.09);
  stains(ctx, rand, 14, 0.3);

  // Expansion joints on a slab grid — the apron's defining feature.
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    const p = (i / 2) * TEX;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, TEX); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(TEX, p); ctx.stroke();
  }
  // Crack repair: darker tar lines that wander off the joint grid.
  cracks(ctx, rand, 22, 0.3);
  // Patch repairs — squares of newer, lighter concrete.
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(120,120,114,${0.1 + rand() * 0.1})`;
    ctx.fillRect(rand() * TEX, rand() * TEX, 30 + rand() * 60, 24 + rand() * 50);
  }
  speckle(ctx, rand, 6000);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Service-road asphalt: darker, finer aggregate, patched and rutted. */
function asphaltTexture(scene: Scene): DynamicTexture {
  const { tex, ctx } = canvas(scene, "ppAsphaltTex", "#26262a");
  const rand = mulberry32(3311);
  blotches(ctx, rand, 45, 0.07);
  // Resurfacing patches with visible seams.
  for (let i = 0; i < 9; i++) {
    const x = rand() * TEX, y = rand() * TEX, w = 40 + rand() * 90, h = 30 + rand() * 70;
    ctx.fillStyle = `rgba(${18 + rand() * 20},${18 + rand() * 20},${22 + rand() * 20},0.5)`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }
  cracks(ctx, rand, 26, 0.34);
  speckle(ctx, rand, 7000);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Loose gravel/hardcore — verges, laydown areas, drainage margins. */
function gravelTexture(scene: Scene): DynamicTexture {
  const { tex, ctx } = canvas(scene, "ppGravelTex", "#54514a");
  const rand = mulberry32(881);
  blotches(ctx, rand, 40, 0.08);
  // Individually drawn stones give gravel its characteristic broken read.
  for (let i = 0; i < 2600; i++) {
    const s = 1.6 + rand() * 4.2;
    const v = 45 + Math.floor(rand() * 90);
    ctx.fillStyle = `rgba(${v},${v - 3},${v - 8},${0.35 + rand() * 0.45})`;
    ctx.beginPath();
    ctx.ellipse(rand() * TEX, rand() * TEX, s, s * (0.6 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Bare tropical earth — laterite red-brown, rutted and damp. */
function dirtTexture(scene: Scene, name: string): DynamicTexture {
  const { tex, ctx } = canvas(scene, name, "#3d3128");
  const rand = mulberry32(4242);
  blotches(ctx, rand, 55, 0.1);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${70 + rand() * 40},${48 + rand() * 26},${30 + rand() * 20},0.2)`;
    ctx.beginPath();
    ctx.ellipse(rand() * TEX, rand() * TEX, 12 + rand() * 46, 8 + rand() * 30, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  stains(ctx, rand, 16, 0.24); // standing water in the ruts
  speckle(ctx, rand, 4200);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Coarse tropical grass — uneven, patchy, going brown where it is walked on. */
function grassTexture(scene: Scene): DynamicTexture {
  const { tex, ctx } = canvas(scene, "ppGrassTex", "#2c3a1e");
  const rand = mulberry32(717);
  // Patchiness first, then blades on top.
  for (let i = 0; i < 60; i++) {
    const g = rand() < 0.3;
    ctx.fillStyle = g ? `rgba(70,84,40,0.16)` : `rgba(46,38,22,0.16)`;
    ctx.beginPath();
    ctx.ellipse(rand() * TEX, rand() * TEX, 20 + rand() * 70, 16 + rand() * 50, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 5200; i++) {
    const x = rand() * TEX, y = rand() * TEX;
    const len = 2 + rand() * 5;
    const dry = rand() < 0.25;
    ctx.strokeStyle = dry
      ? `rgba(${96 + rand() * 40},${84 + rand() * 30},${44 + rand() * 20},0.5)`
      : `rgba(${44 + rand() * 46},${68 + rand() * 54},${28 + rand() * 30},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 2.4, y - len);
    ctx.stroke();
  }
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Corrugated steel sheeting for shed walls — vertical ribs with rust bleed. */
function corrugatedTexture(scene: Scene, name: string, base: string, rustAmount = 1): DynamicTexture {
  const { tex, ctx } = canvas(scene, name, base);
  const rand = mulberry32(2024);
  // Ribs: alternating light/shadow bands read as profiled sheet.
  const pitch = 16;
  for (let x = 0; x < TEX; x += pitch) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(x, 0, pitch * 0.35, TEX);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x + pitch * 0.62, 0, pitch * 0.38, TEX);
  }
  // Panel seams every few ribs.
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 2;
  for (let y = 0; y < TEX; y += TEX / 3) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX, y); ctx.stroke();
  }
  // Rust streaking down from the seams — where the weathering actually starts.
  for (let i = 0; i < 60 * rustAmount; i++) {
    const x = rand() * TEX;
    const y = Math.floor(rand() * 3) * (TEX / 3);
    const h = 20 + rand() * 90;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(112,58,26,${0.16 + rand() * 0.2})`);
    g.addColorStop(1, "rgba(112,58,26,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + rand() * 5, h);
  }
  blotches(ctx, rand, 18, 0.05);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/**
 * Shipping-container livery: corrugation, faded paint, rust at the seams and a
 * stencilled owner code. The codes are invented rather than real operators'.
 */
function containerTexture(scene: Scene, idx: number, base: string): DynamicTexture {
  const { tex, ctx } = canvas(scene, `ppContainerTex_${idx}`, base);
  const rand = mulberry32(600 + idx * 37);
  // Vertical corrugation.
  const pitch = 22;
  for (let x = 0; x < TEX; x += pitch) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, 0, pitch * 0.3, TEX);
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.fillRect(x + pitch * 0.6, 0, pitch * 0.4, TEX);
  }
  // Top and bottom rails.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, 0, TEX, 26);
  ctx.fillRect(0, TEX - 26, TEX, 26);
  // Paint failure and rust blooms.
  for (let i = 0; i < 44; i++) {
    ctx.fillStyle = `rgba(${92 + rand() * 46},${44 + rand() * 26},${20 + rand() * 16},${0.1 + rand() * 0.28})`;
    ctx.beginPath();
    ctx.ellipse(rand() * TEX, rand() * TEX, 3 + rand() * 20, 3 + rand() * 15, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Dents: soft light/dark pairs.
  for (let i = 0; i < 10; i++) {
    const x = rand() * TEX, y = 40 + rand() * (TEX - 80);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath(); ctx.ellipse(x, y, 10 + rand() * 18, 6 + rand() * 10, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Stencilled code + a smaller serial beneath it.
  const codes = ["PPTU", "SGXU", "KEPU", "TLBU", "BRNU", "JRPU"];
  ctx.fillStyle = "rgba(232,230,222,0.82)";
  ctx.font = "bold 40px monospace";
  ctx.fillText(`${codes[idx % codes.length]}`, 36, 150);
  ctx.font = "bold 26px monospace";
  ctx.fillText(`${400000 + Math.floor(rand() * 500000)}`, 36, 186);
  ctx.strokeStyle = "rgba(232,230,222,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 210, 120, 34);
  ctx.font = "bold 18px monospace";
  ctx.fillText("22G1", 44, 235);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Poured/precast concrete for walls, barriers, bunkers. */
function concreteTexture(scene: Scene): DynamicTexture {
  const { tex, ctx } = canvas(scene, "ppConcreteTex", "#57564f");
  const rand = mulberry32(9091);
  blotches(ctx, rand, 50, 0.09);
  // Form-tie holes and shutter lines — reads as cast in place.
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 2;
  for (let y = 0; y < TEX; y += TEX / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX, y); ctx.stroke();
  }
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.arc(20 + rand() * (TEX - 40), 20 + rand() * (TEX - 40), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Water streaking down from the top edge.
  for (let i = 0; i < 26; i++) {
    const x = rand() * TEX;
    const g = ctx.createLinearGradient(0, 0, 0, 60 + rand() * 140);
    g.addColorStop(0, "rgba(0,0,0,0.16)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 3 + rand() * 7, 60 + rand() * 140);
  }
  cracks(ctx, rand, 12, 0.2);
  speckle(ctx, rand, 3600);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Weathered bare steel — gantries, pipes, catwalks. */
function steelTexture(scene: Scene, name: string, base: string, rusty: boolean): DynamicTexture {
  const { tex, ctx } = canvas(scene, name, base, 256);
  const rand = mulberry32(rusty ? 55 : 77);
  blotches(ctx, rand, 26, 0.08, 256);
  if (rusty) {
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(${100 + rand() * 60},${46 + rand() * 30},${18 + rand() * 18},${0.12 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 256, 2 + rand() * 12, 2 + rand() * 9, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  speckle(ctx, rand, 1800, 256);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Sandbag hessian — coarse woven weave. */
function hessianTexture(scene: Scene): DynamicTexture {
  const { tex, ctx } = canvas(scene, "ppHessianTex", "#5c5540", 256);
  const rand = mulberry32(313);
  for (let i = 0; i < 256; i += 3) {
    ctx.fillStyle = `rgba(0,0,0,${0.06 + rand() * 0.08})`;
    ctx.fillRect(i, 0, 1.6, 256);
    ctx.fillRect(0, i, 256, 1.6);
  }
  blotches(ctx, rand, 20, 0.1, 256);
  speckle(ctx, rand, 1400, 256);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

// ---------------------------------------------------------------------------

/** Material set shared by every prop on the terminal. */
export interface TerminalMats {
  apron: WorldMaterial;
  asphalt: WorldMaterial;
  gravel: WorldMaterial;
  dirt: WorldMaterial;
  grass: WorldMaterial;
  /** Flat, unlit-ish overlay used for painted road markings. */
  roadLine: WorldMaterial;
  /** Dark wet sheen for puddles — low roughness so the flood lights catch it. */
  puddle: WorldMaterial;
  concrete: WorldMaterial;
  corrugated: WorldMaterial;
  corrugatedRust: WorldMaterial;
  steel: WorldMaterial;
  rust: WorldMaterial;
  painted: WorldMaterial;
  sandbag: WorldMaterial;
  hazard: WorldMaterial;
  lamp: WorldMaterial;
  earth: WorldMaterial;
  glass: WorldMaterial;
  bark: WorldMaterial;
  foliage: WorldMaterial[];
  containers: WorldMaterial[];
}

function textured(
  scene: Scene,
  name: string,
  tex: DynamicTexture,
  normal: Texture,
  uv: number,
  roughness: number
): WorldMaterial {
  const m = new WorldMaterial(name, scene);
  m.albedoTexture = tex;
  m.bumpTexture = normal;
  tex.uScale = uv;
  tex.vScale = uv;
  m.roughness = roughness;
  m.metallic = 0;
  m.specularIntensity = 0.35;
  return m;
}

function plain(scene: Scene, name: string, c: Color3, roughness = 0.9): WorldMaterial {
  const m = new WorldMaterial(name, scene);
  m.albedoColor = c;
  m.roughness = roughness;
  m.metallic = 0;
  return m;
}

/**
 * Builds every surface the terminal uses. Called once, on the map's lazy first
 * build, so the canvas work never costs the wave-survival players anything.
 */
export function buildTerminalMats(scene: Scene): TerminalMats {
  // One shared detail normal across the big surfaces — a real lighting
  // response for the cost of a single 256px texture.
  const normal = createDetailNormalTexture(scene, "ppDetailNormal", 21, 1.8, 256);
  const fineNormal = createDetailNormalTexture(scene, "ppFineNormal", 5, 1.1, 256);

  // UV scales are set against the mesh's real size at each use site; these are
  // the defaults for the big planes (roughly one texture per 16m).
  const apron = textured(scene, "ppApron", apronTexture(scene), normal, 18, 0.95);
  const asphalt = textured(scene, "ppAsphalt", asphaltTexture(scene), normal, 10, 0.88);
  const gravel = textured(scene, "ppGravel", gravelTexture(scene), normal, 8, 1.0);
  const dirt = textured(scene, "ppDirt", dirtTexture(scene, "ppDirtTex"), normal, 6, 1.0);
  const grass = textured(scene, "ppGrass", grassTexture(scene), fineNormal, 8, 1.0);
  const concrete = textured(scene, "ppConcrete", concreteTexture(scene), normal, 2, 0.92);
  const corrugated = textured(scene, "ppCorrugated", corrugatedTexture(scene, "ppCorrTex", "#5e6660", 0.7), fineNormal, 3, 0.8);
  const corrugatedRust = textured(scene, "ppCorrugatedRust", corrugatedTexture(scene, "ppCorrRustTex", "#4a4239", 1.8), fineNormal, 3, 0.85);
  const steel = textured(scene, "ppSteel", steelTexture(scene, "ppSteelTex", "#3a3d42", false), fineNormal, 2, 0.55);
  steel.metallic = 0.5;
  const rust = textured(scene, "ppRust", steelTexture(scene, "ppRustTex", "#5b3320", true), fineNormal, 2, 0.9);
  const sandbag = textured(scene, "ppSandbag", hessianTexture(scene), fineNormal, 1.4, 1.0);

  const puddle = plain(scene, "ppPuddle", new Color3(0.04, 0.05, 0.06), 0.08);
  puddle.metallic = 0.15;
  puddle.alpha = 0.72;

  const glass = plain(scene, "ppGlass", new Color3(0.08, 0.11, 0.12), 0.12);
  glass.alpha = 0.4;
  glass.metallic = 0.2;

  const lamp = plain(scene, "ppLamp", new Color3(0.95, 0.9, 0.72));
  lamp.emissiveColor = new Color3(0.92, 0.87, 0.64);

  const roadLine = plain(scene, "ppRoadLine", new Color3(0.62, 0.6, 0.5), 0.85);

  const containerBases = ["#7a2a1e", "#1b4260", "#22532b", "#7a6318", "#4a4c4e", "#6b3566"];
  const containers = containerBases.map((base, i) =>
    textured(scene, `ppContainer_${i}`, containerTexture(scene, i, base), fineNormal, 1, 0.82)
  );

  // Foliage is deliberately flat-shaded colour rather than textured: the leaves
  // are tiny on screen, and a solid tone instances far cheaper than an
  // alpha-tested atlas would.
  const foliage = [
    plain(scene, "ppFoliage0", new Color3(0.12, 0.22, 0.09)),
    plain(scene, "ppFoliage1", new Color3(0.16, 0.28, 0.11)),
    plain(scene, "ppFoliage2", new Color3(0.1, 0.18, 0.08)),
    plain(scene, "ppFoliage3", new Color3(0.2, 0.26, 0.1)),
  ];

  return {
    apron,
    asphalt,
    gravel,
    dirt,
    grass,
    roadLine,
    puddle,
    concrete,
    corrugated,
    corrugatedRust,
    steel,
    rust,
    painted: plain(scene, "ppPainted", new Color3(0.3, 0.34, 0.32), 0.75),
    sandbag,
    hazard: plain(scene, "ppHazard", new Color3(0.58, 0.48, 0.1), 0.8),
    lamp,
    // Its own texture instance rather than sharing `dirt`'s: UV scale lives on
    // the texture, and the ridge needs a coarser tiling than the yard ruts.
    earth: textured(scene, "ppEarth", dirtTexture(scene, "ppEarthTex"), normal, 10, 1.0),
    glass,
    bark: plain(scene, "ppBark", new Color3(0.16, 0.13, 0.1)),
    foliage,
    containers,
  };
}
