import type { Builder } from "~/gfx/builder";

/** Axis-aligned rectangle on the ground: [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number];

export type GroundType = "road" | "pave" | "path" | "screed" | "tile" | "dirt" | "court" | "void";

const SPEC: Record<Exclude<GroundType, "void">, { mat: string; top: number; tint?: number }> = {
  road: { mat: "asphalt", top: 0 },
  pave: { mat: "pavers", top: 0.15 },
  path: { mat: "concrete", top: 0.15, tint: 0xd8d6cc },
  screed: { mat: "screed", top: 0.15 },
  tile: { mat: "floortile", top: 0.15 },
  dirt: { mat: "dirt", top: 0.06 },
  court: { mat: "asphalt", top: 0.04, tint: 0x6f9a78 },
};

export const GRASS_Y = 0.1;

/** Subtract `hole` from `r`, returning up to four leftover rectangles. */
function subtract(r: Rect, hole: Rect): Rect[] {
  const [x0, z0, x1, z1] = r;
  const hx0 = Math.max(x0, hole[0]);
  const hz0 = Math.max(z0, hole[1]);
  const hx1 = Math.min(x1, hole[2]);
  const hz1 = Math.min(z1, hole[3]);
  if (hx0 >= hx1 || hz0 >= hz1) return [r];
  const out: Rect[] = [];
  if (z0 < hz0) out.push([x0, z0, x1, hz0]);
  if (hz1 < z1) out.push([x0, hz1, x1, z1]);
  if (x0 < hx0) out.push([x0, hz0, hx0, hz1]);
  if (hx1 < x1) out.push([hx1, hz0, x1, hz1]);
  return out;
}

/**
 * The estate's ground: a list of typed rectangles (roads, pavements, courts,
 * building pads). Lawn is whatever is left over, computed by subtraction, so
 * adding a path never needs a matching hole cut by hand.
 */
export class GroundPlan {
  private readonly rects: Array<{ type: GroundType; r: Rect }> = [];

  add(type: GroundType, x0: number, z0: number, x1: number, z1: number): void {
    this.rects.push({ type, r: [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)] });
  }

  build(b: Builder, bounds: Rect): void {
    for (const { type, r } of this.rects) {
      if (type === "void") continue;
      const s = SPEC[type];
      b.slab(s.mat, r[0], s.top - 0.5, r[1], r[2] - r[0], 0.5, r[3] - r[1], { tint: s.tint, skip: "-y" });
    }
    let grass: Rect[] = [bounds];
    for (const { r } of this.rects) {
      const next: Rect[] = [];
      for (const g of grass) next.push(...subtract(g, r));
      grass = next;
    }
    for (const g of grass) {
      if (g[2] - g[0] < 0.05 || g[3] - g[1] < 0.05) continue;
      b.slab("grass", g[0], GRASS_Y - 0.5, g[1], g[2] - g[0], 0.5, g[3] - g[1], { skip: "-y" });
    }
    this.grassRects = grass;
  }

  /** Lawn rectangles, available after `build` for scattering grass and trees. */
  grassRects: Rect[] = [];
}
