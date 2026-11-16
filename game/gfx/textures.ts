import * as THREE from "three";
import { fbm, rng, type Rand } from "./noise";

/**
 * Procedural PBR texture toolkit.
 *
 * There are no image files in this game: every surface is painted at load into
 * three aligned layers (albedo, height, roughness) with the 2D canvas API plus
 * per-pixel noise, then baked into the albedo / normal / ORM maps a
 * MeshStandardMaterial expects. Painting height alongside colour is the point:
 * a brick, a crack or a paint chip drawn once shows up consistently in colour,
 * in the normal map and in the cavity occlusion, which is what makes a flat
 * polygon read as a material instead of a picture of one.
 */

export interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** R = ambient occlusion, G = roughness, B = metalness. */
  ormMap: THREE.Texture;
}

export interface FinishOpts {
  /** Normal-map strength (height units → slope). */
  normal?: number;
  /** Extra float height added to the painted height canvas (same size). */
  height?: Float32Array;
  /** Cavity occlusion strength baked into the AO channel. */
  ao?: number;
  /** Constant metalness, or leave to the painted metal canvas. */
  metal?: number;
  /** Disable wrapping (decals, atlases). */
  clamp?: boolean;
  /** sRGB albedo anisotropy. */
  aniso?: number;
}

function ctx2d(size: number, w = size): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return [c, ctx];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, mul: number, add = 0): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * mul + add)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

const gray = (v: number): string => {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${g},${g},${g})`;
};

export class Paint {
  readonly size: number;
  readonly width: number;
  readonly ac: HTMLCanvasElement;
  /** Albedo layer. */
  readonly a: CanvasRenderingContext2D;
  /** Height layer: 0.5 is the surface plane, brighter is proud, darker is recessed. */
  readonly h: CanvasRenderingContext2D;
  /** Roughness layer: white = fully rough. */
  readonly r: CanvasRenderingContext2D;
  /** Metalness layer: white = metal. */
  readonly m: CanvasRenderingContext2D;
  readonly rand: Rand;

  constructor(size: number, base: string, opts: { height?: number; rough?: number; seed?: number; width?: number } = {}) {
    this.size = size;
    this.width = opts.width ?? size;
    [this.ac, this.a] = ctx2d(size, this.width);
    [, this.h] = ctx2d(size, this.width);
    [, this.r] = ctx2d(size, this.width);
    [, this.m] = ctx2d(size, this.width);
    this.rand = rng(opts.seed ?? 1);
    this.a.fillStyle = base;
    this.a.fillRect(0, 0, this.width, size);
    this.h.fillStyle = gray(opts.height ?? 0.5);
    this.h.fillRect(0, 0, this.width, size);
    this.r.fillStyle = gray(opts.rough ?? 0.85);
    this.r.fillRect(0, 0, this.width, size);
    this.m.fillStyle = "#000";
    this.m.fillRect(0, 0, this.width, size);
  }

  /** Run a draw routine on all three layers at once (colour, height 0..1, roughness 0..1). */
  all(color: string | null, height: number | null, rough: number | null, draw: (c: CanvasRenderingContext2D) => void): void {
    if (color !== null) {
      this.a.fillStyle = color;
      this.a.strokeStyle = color;
      draw(this.a);
    }
    if (height !== null) {
      this.h.fillStyle = gray(height);
      this.h.strokeStyle = gray(height);
      draw(this.h);
    }
    if (rough !== null) {
      this.r.fillStyle = gray(rough);
      this.r.strokeStyle = gray(rough);
      draw(this.r);
    }
  }

  /** Draw with wrap-around so shapes crossing an edge tile seamlessly. */
  wrap(draw: (ox: number, oy: number) => void): void {
    for (const ox of [-this.width, 0, this.width]) for (const oy of [-this.size, 0, this.size]) draw(ox, oy);
  }

  /** Multiply albedo by fractal noise: the base "it is not one flat colour" pass. */
  grain(strength: number, period: number, octaves = 4, seed = 7): this {
    const img = this.a.getImageData(0, 0, this.width, this.size);
    const d = img.data;
    const s = this.size;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < this.width; x++) {
        const n = fbm(x / this.width, y / s, period, octaves, seed) - 0.5;
        const k = 1 + n * 2 * strength;
        const i = (y * this.width + x) * 4;
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
      }
    }
    this.a.putImageData(img, 0, 0);
    return this;
  }

  /** Per-pixel white noise on albedo (fine aggregate, fabric fuzz). */
  speckle(strength: number, seed = 3): this {
    const r = rng(seed);
    const img = this.a.getImageData(0, 0, this.width, this.size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = 1 + (r() - 0.5) * 2 * strength;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
    this.a.putImageData(img, 0, 0);
    return this;
  }

  /**
   * Blend a tint into the albedo where a noise mask exceeds a threshold:
   * stains, moss, rust blooms, sun-bleaching. `mask` returns 0..1 coverage.
   */
  stain(color: string, mask: (u: number, v: number) => number, opts: { rough?: number; height?: number } = {}): this {
    const [tr, tg, tb] = hexToRgb(color);
    const img = this.a.getImageData(0, 0, this.width, this.size);
    const d = img.data;
    const rimg = opts.rough !== undefined ? this.r.getImageData(0, 0, this.width, this.size) : null;
    const himg = opts.height !== undefined ? this.h.getImageData(0, 0, this.width, this.size) : null;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.width; x++) {
        const m = Math.max(0, Math.min(1, mask(x / this.width, y / this.size)));
        if (m <= 0) continue;
        const i = (y * this.width + x) * 4;
        d[i] += (tr - d[i]) * m;
        d[i + 1] += (tg - d[i + 1]) * m;
        d[i + 2] += (tb - d[i + 2]) * m;
        if (rimg) {
          const v = rimg.data[i] + (opts.rough! * 255 - rimg.data[i]) * m;
          rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = v;
        }
        if (himg) {
          const v = himg.data[i] + opts.height! * 255 * m;
          himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = Math.max(0, Math.min(255, v));
        }
      }
    }
    this.a.putImageData(img, 0, 0);
    if (rimg) this.r.putImageData(rimg, 0, 0);
    if (himg) this.h.putImageData(himg, 0, 0);
    return this;
  }

  /** Bake the three painted layers into GPU textures. */
  finish(opts: FinishOpts = {}): TexSet {
    const s = this.size;
    const w = this.width;
    const hd = this.h.getImageData(0, 0, w, s).data;
    const rd = this.r.getImageData(0, 0, w, s).data;
    const md = this.m.getImageData(0, 0, w, s).data;
    const height = new Float32Array(w * s);
    for (let i = 0; i < w * s; i++) height[i] = hd[i * 4] / 255 + (opts.height ? opts.height[i] : 0);

    const strength = opts.normal ?? 2;
    const normal = new Uint8Array(w * s * 4);
    const orm = new Uint8Array(w * s * 4);
    const aoK = opts.ao ?? 1.2;
    const at = (x: number, y: number): number => height[((y + s) % s) * w + ((x + w) % w)];
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Sobel slope → tangent-space normal.
        const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * 0.25;
        const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * 0.25;
        let nx = -dx * strength * 4;
        let ny = dy * strength * 4;
        const inv = 1 / Math.hypot(nx, ny, 1);
        nx *= inv;
        ny *= inv;
        normal[i] = (nx * 0.5 + 0.5) * 255;
        normal[i + 1] = (ny * 0.5 + 0.5) * 255;
        normal[i + 2] = (inv * 0.5 + 0.5) * 255;
        normal[i + 3] = 255;
        // Cavity AO: how far this texel sits below its neighbourhood.
        const here = at(x, y);
        const around = (at(x - 3, y) + at(x + 3, y) + at(x, y - 3) + at(x, y + 3) + at(x - 2, y - 2) + at(x + 2, y + 2) + at(x - 2, y + 2) + at(x + 2, y - 2)) / 8;
        const cav = Math.max(0, around - here);
        orm[i] = Math.max(0, 1 - cav * aoK * 6) * 255;
        orm[i + 1] = rd[i];
        orm[i + 2] = opts.metal !== undefined ? opts.metal * 255 : md[i];
        orm[i + 3] = 255;
      }
    }

    const wrapMode = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    const map = new THREE.CanvasTexture(this.ac);
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = new THREE.DataTexture(normal, w, s, THREE.RGBAFormat);
    const ormMap = new THREE.DataTexture(orm, w, s, THREE.RGBAFormat);
    for (const t of [map, normalMap, ormMap]) {
      t.wrapS = t.wrapT = wrapMode;
      t.anisotropy = opts.aniso ?? 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    }
    // DataTextures are not flipped on upload; canvases are. Keep them aligned.
    normalMap.flipY = true;
    ormMap.flipY = true;
    return { map, normalMap, ormMap };
  }
}

/** A plain canvas texture for things that only need colour + alpha (decals, sprites, signs). */
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, opts: { repeat?: boolean; srgb?: boolean } = {}): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/** Tileable single-channel noise texture, used by shaders (clouds, macro grime, wind). */
export function noiseTex(size: number, period: number, octaves: number, seed: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = fbm(u, v, period, octaves, seed) * 255;
      data[i + 1] = fbm(u, v, period * 2, octaves, seed + 31) * 255;
      data[i + 2] = fbm(u, v, period * 4, Math.max(1, octaves - 1), seed + 67) * 255;
      data[i + 3] = fbm(u, v, period, 2, seed + 101) * 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
