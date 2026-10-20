import { DynamicTexture, Scene, Texture } from "@babylonjs/core";

/**
 * Runtime-generated textures shared by the overhaul's assets. No binary
 * assets ship with the game, so every texture is painted on a canvas from a
 * seeded RNG — deterministic across loads — and cached per scene so a
 * texture is built once no matter how many meshes use it.
 *
 * Palettes follow docs/overhaul/ART_DIRECTION.md §4; the No. 4 pattern
 * follows REFERENCES.md R-03 (black, foliage green and moss green pixels on a
 * brown base, crisp pixel clusters inside larger macro shapes).
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a `period`-cell lattice, smoothstep-interpolated. */
function periodicNoise(period: number, rng: () => number): (u: number, v: number) => number {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x: number, y: number) => g[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (u: number, v: number) => {
    const x = u * period, y = v * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Fractal (2-3 octave) tileable noise in 0..1. */
function fbm(base: number, octaves: number, rng: () => number): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => periodicNoise(base << i, rng));
  return (u, v) => {
    let sum = 0, amp = 1, norm = 0;
    for (const n of layers) {
      sum += n(u, v) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

const cache = new WeakMap<Scene, Map<string, Texture>>();
function cached(scene: Scene, key: string, make: () => Texture): Texture {
  let m = cache.get(scene);
  if (!m) cache.set(scene, (m = new Map()));
  let t = m.get(key);
  if (!t || t.getScene() !== scene) {
    t = make();
    m.set(key, t);
  }
  return t;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Map a cumulative-share table to colour indices — shares sum to 1. */
function pickBand(value: number, cumulative: number[]): number {
  for (let i = 0; i < cumulative.length; i++) if (value < cumulative[i]) return i;
  return cumulative.length - 1;
}

/** Equalise a noise field into uniform 0..1 ranks so palette shares land where intended. */
function rankField(field: Float32Array): Float32Array {
  const order = Array.from(field.keys()).sort((a, b) => field[a] - field[b]);
  const out = new Float32Array(field.length);
  order.forEach((idx, rank) => (out[idx] = rank / (field.length - 1)));
  return out;
}

export const NO4_COLORS = {
  brown: "#5e5240",
  moss: "#7d8a55",
  foliage: "#4f6236",
  dark: "#2f3d24",
  black: "#1b1d17",
};

/**
 * SAF Army No. 4 pixelised camouflage. One 512² tile covers 0.5 m of fabric
 * (≈1 cm pixels). Two decorrelated macro fields — one deciding the green/brown
 * structure, one placing dark/black clusters — are sampled once per pixel cell
 * and perturbed per cell so region borders break up into the stepped, ragged
 * edges of the real print instead of smooth blobs.
 */
export function no4CamoTexture(scene: Scene): Texture {
  return cached(scene, "no4", () => {
    const SIZE = 512;
    const CELLS = 52; // ~1 cm pixels across 0.5 m
    const rng = mulberry32(0x5af04);
    const macro = fbm(4, 3, rng);
    const accent = fbm(6, 2, rng);
    const jitter = mulberry32(0x5af05);

    const base = new Float32Array(CELLS * CELLS);
    const acc = new Float32Array(CELLS * CELLS);
    for (let y = 0; y < CELLS; y++) {
      for (let x = 0; x < CELLS; x++) {
        const u = (x + 0.5) / CELLS, v = (y + 0.5) / CELLS;
        base[y * CELLS + x] = macro(u, v) + (jitter() - 0.5) * 0.09;
        acc[y * CELLS + x] = accent(u, v) + (jitter() - 0.5) * 0.12;
      }
    }
    const baseRank = rankField(base);
    const accRank = rankField(acc);

    // Structure field: brown base, moss green, foliage green (cumulative shares).
    const structure = [NO4_COLORS.brown, NO4_COLORS.moss, NO4_COLORS.foliage];
    const structureCum = [0.26, 0.56, 1.0];
    const tex = new DynamicTexture("no4Camo", { width: SIZE, height: SIZE }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const cell = SIZE / CELLS;
    for (let y = 0; y < CELLS; y++) {
      for (let x = 0; x < CELLS; x++) {
        const i = y * CELLS + x;
        let color = structure[pickBand(baseRank[i], structureCum)];
        // Dark clusters overlay the top ~22% of the accent field; the deepest 8% go black.
        if (accRank[i] > 0.92) color = NO4_COLORS.black;
        else if (accRank[i] > 0.78) color = NO4_COLORS.dark;
        ctx.fillStyle = color;
        // Snap to whole pixels so neighbouring cells meet without seams.
        const x0 = Math.round(x * cell), y0 = Math.round(y * cell);
        ctx.fillRect(x0, y0, Math.round((x + 1) * cell) - x0, Math.round((y + 1) * cell) - y0);
      }
    }
    // Printed-fabric breakup: faint thread noise so flat colour doesn't read as plastic.
    weaveOverlay(ctx, SIZE, 0x5af06, 0.07);
    tex.update(false);
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    return tex;
  });
}

/** Faint per-pixel light/dark thread noise laid over a fabric albedo. */
function weaveOverlay(ctx: CanvasRenderingContext2D, size: number, seed: number, strength: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const r = mulberry32(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Twill: diagonal ridges plus random fibre noise.
      const ridge = ((x + y) % 4 < 2 ? 1 : -1) * 0.5;
      const k = 1 + (ridge + (r() - 0.5)) * strength;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Fictional OPFOR fatigues: sand-khaki with soft, organic tan-brown blotches
 * — deliberately unlike any pixel pattern so hostiles never read as SAF.
 */
export function opforCamoTexture(scene: Scene): Texture {
  return cached(scene, "opforCamo", () => {
    const SIZE = 256;
    const rng = mulberry32(0x0f0f1);
    const n1 = fbm(3, 3, rng);
    const n2 = fbm(5, 2, rng);
    const tex = new DynamicTexture("opforCamo", { width: SIZE, height: SIZE }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const img = ctx.createImageData(SIZE, SIZE);
    const sand = hexRgb("#a89a72"), tan = hexRgb("#8a7a55"), brown = hexRgb("#6a5a40");
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE, v = y / SIZE;
        const a = n1(u, v), b = n2(u, v);
        let c = sand;
        if (a > 0.58) c = tan;
        if (b > 0.66 && a > 0.45) c = brown;
        const i = (y * SIZE + x) * 4;
        const k = 0.94 + rng() * 0.08;
        img.data[i] = c[0] * k;
        img.data[i + 1] = c[1] * k;
        img.data[i + 2] = c[2] * k;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    weaveOverlay(ctx, SIZE, 0x0f0f2, 0.06);
    tex.update(false);
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  });
}

/**
 * Tangent-space normal map from a height function, tileable. Used for fabric
 * weave, polymer stipple and cast metal so close-up surfaces catch light.
 */
function heightToNormal(scene: Scene, name: string, size: number, height: (x: number, y: number) => number, strength: number): Texture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x, y);
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Twill weave bump for uniforms and webbing. */
export function fabricNormal(scene: Scene): Texture {
  return cached(scene, "fabricN", () => {
    const r = mulberry32(0xfab1);
    const t = heightToNormal(scene, "fabricNormal", 128, (x, y) => (((x + y) % 6) < 3 ? 1 : 0) * 0.6 + r() * 0.4, 1.4);
    t.level = 0.5;
    t.uScale = t.vScale = 3; // ~2 cm twill on 0.5 m camo tiles
    return t;
  });
}

/** Fine stipple bump for moulded polymer (grips, furniture). */
export function polymerNormal(scene: Scene): Texture {
  return cached(scene, "polyN", () => {
    const n = fbm(32, 2, mulberry32(0xb01));
    const t = heightToNormal(scene, "polymerNormal", 128, (x, y) => n(x / 128, y / 128), 2.2);
    t.level = 0.15;
    t.uScale = t.vScale = 20; // UVs in metres: 10 cm tile of fine stipple
    return t;
  });
}

/** Subtle large-scale variation for metal/painted parts (tooling marks, wear). */
export function metalNormal(scene: Scene): Texture {
  return cached(scene, "metalN", () => {
    const n = fbm(8, 3, mulberry32(0xe7a1));
    const t = heightToNormal(scene, "metalNormal", 128, (x, y) => n(x / 128, y / 128), 0.9);
    t.level = 0.25;
    t.uScale = t.vScale = 6;
    return t;
  });
}

/**
 * Low-contrast albedo grain (greyscale, centred on white) — multiply into a
 * base colour so large flat parts aren't a single RGB value.
 */
export function grainTexture(scene: Scene, seed = 0x6a1e, contrast = 0.12): Texture {
  return cached(scene, `grain_${seed}_${contrast}`, () => {
    const SIZE = 256;
    const n = fbm(6, 4, mulberry32(seed));
    const tex = new DynamicTexture(`grain_${seed}`, { width: SIZE, height: SIZE }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const img = ctx.createImageData(SIZE, SIZE);
    const r = mulberry32(seed + 1);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = 255 * (1 - contrast + (n(x / SIZE, y / SIZE) * 0.8 + r() * 0.2) * contrast * 2);
        const i = (y * SIZE + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update(false);
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    // UVs are in metres: ~8 tiles/m keeps the breakup at a few-cm scale.
    tex.uScale = tex.vScale = 8;
    return tex;
  });
}
