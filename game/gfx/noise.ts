/** Seeded PRNG (mulberry32). Every procedural asset takes one so the world is identical each load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;
export const rr = (r: Rand, a: number, b: number): number => a + (b - a) * r();
export const ri = (r: Rand, a: number, b: number): number => Math.floor(rr(r, a, b + 1));
export const pick = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Tileable value noise: `period` lattice cells across the unit square. */
export function vnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const w = (n: number): number => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Tileable fractal noise in 0..1. */
export function fbm(u: number, v: number, period: number, octaves: number, seed: number, gain = 0.5): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, p, seed + o * 17) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

/** Tileable Worley (cellular) noise. Returns [F1, F2] distances in cell units. */
export function worley(u: number, v: number, period: number, seed: number): [number, number] {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 91);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2];
}

/** Fill a size×size float field from a function of (u, v) in 0..1. */
export function field(size: number, fn: (u: number, v: number) => number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + x] = fn(x / size, y / size);
  }
  return out;
}
