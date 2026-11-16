import type { Builder, PartOpts } from "~/gfx/builder";

/** Architectural parts shared by every building: walls with openings, windows, doors, shutters. */

export interface Opening {
  /** Centre along the wall. */
  x: number;
  w: number;
  /** Sill height (bottom of the opening). */
  y: number;
  h: number;
}

/**
 * A wall running along local X at depth `z`, from x0..x1 and y0..y1, with
 * rectangular openings cut out. Built as panels around the holes, so openings
 * are real: you can see, shoot and (if tall enough) walk through them.
 */
export function wall(b: Builder, key: string, x0: number, x1: number, y0: number, y1: number, z: number, t: number, openings: Opening[] = [], opts?: PartOpts): void {
  const ops = openings
    .filter((o) => o.x + o.w / 2 > x0 && o.x - o.w / 2 < x1)
    .sort((a, c) => a.x - c.x);
  let cursor = x0;
  for (const o of ops) {
    const ox0 = Math.max(x0, o.x - o.w / 2);
    const ox1 = Math.min(x1, o.x + o.w / 2);
    if (ox0 > cursor + 1e-4) b.slab(key, cursor, y0, z - t / 2, ox0 - cursor, y1 - y0, t, opts);
    const oy0 = Math.max(y0, o.y);
    const oy1 = Math.min(y1, o.y + o.h);
    if (oy0 > y0 + 1e-4) b.slab(key, ox0, y0, z - t / 2, ox1 - ox0, oy0 - y0, t, opts);
    if (oy1 < y1 - 1e-4) b.slab(key, ox0, oy1, z - t / 2, ox1 - ox0, y1 - oy1, t, opts);
    cursor = Math.max(cursor, ox1);
  }
  if (cursor < x1 - 1e-4) b.slab(key, cursor, y0, z - t / 2, x1 - cursor, y1 - y0, t, opts);
}

export interface WinOpts {
  /** Frame colour. */
  frame?: number;
  /** Glass tint (multiplies the dark reflective base; bright values read as curtains). */
  glass?: number;
  /** 0 = glass + backing only, 1 = frame + mullions, 2 = adds grille bars / louvre blades. */
  detail?: 0 | 1 | 2;
  style?: "slide" | "louvre" | "fixed";
  grille?: boolean;
  /** How far the glazing sits behind the wall face (positive = recessed). */
  inset?: number;
}

/**
 * Window filling an opening centred at x, sill at y, in a wall whose outer
 * face is at `z` and faces `dir` (+1 = +Z, -1 = -Z).
 */
export function win(b: Builder, x: number, y: number, z: number, w: number, h: number, dir: 1 | -1, o: WinOpts = {}): void {
  const detail = o.detail ?? 1;
  const frame = o.frame ?? 0xd9dad6;
  const inset = o.inset ?? 0.06;
  const zg = z - dir * inset;
  const cy = y + h / 2;
  // Glazing.
  if (dir > 0) b.quad("glass", [x - w / 2, y, zg], [x + w / 2, y, zg], [x + w / 2, y + h, zg], [x - w / 2, y + h, zg], { tint: o.glass ?? 0x18262a, collide: "none" });
  else b.quad("glass", [x + w / 2, y, zg], [x - w / 2, y, zg], [x - w / 2, y + h, zg], [x + w / 2, y + h, zg], { tint: o.glass ?? 0x18262a, collide: "none" });
  if (detail === 0) return;
  const ft = 0.05;
  const fz = zg + dir * 0.025;
  const none: PartOpts = { tint: frame, collide: "none" };
  b.box("trim", x, y + ft / 2, fz, w, ft, 0.06, none);
  b.box("trim", x, y + h - ft / 2, fz, w, ft, 0.06, none);
  b.box("trim", x - w / 2 + ft / 2, cy, fz, ft, h, 0.06, none);
  b.box("trim", x + w / 2 - ft / 2, cy, fz, ft, h, 0.06, none);
  const style = o.style ?? "slide";
  if (style === "slide") {
    const panes = w > 1.9 ? 3 : 2;
    for (let i = 1; i < panes; i++) b.box("trim", x - w / 2 + (w * i) / panes, cy, fz, 0.04, h, 0.05, none);
  } else if (style === "louvre") {
    b.box("trim", x, cy, fz, 0.04, h, 0.05, none);
    if (detail >= 2) {
      const blades = Math.floor(h / 0.11);
      for (let i = 1; i < blades; i++) b.box("trim", x, y + (i * h) / blades, fz + dir * 0.01, w - 0.08, 0.012, 0.07, { tint: 0xaab4b6, collide: "none" });
    }
  }
  if (o.grille && detail >= 2) {
    const gz = zg + dir * 0.07;
    const bars = Math.floor(w / 0.14);
    for (let i = 1; i < bars; i++) b.box("trim", x - w / 2 + (w * i) / bars, cy, gz, 0.012, h - 0.06, 0.012, { tint: 0x3a3c3d, collide: "none" });
    for (const f of [0.33, 0.66]) b.box("trim", x, y + h * f, gz, w - 0.06, 0.014, 0.014, { tint: 0x3a3c3d, collide: "none" });
  }
}

/** A hinged door leaf in its frame. Closed, flush-panel. */
export function door(b: Builder, x: number, y: number, z: number, w: number, h: number, dir: 1 | -1, tint: number, o: { gate?: boolean; frame?: number; solid?: boolean } = {}): void {
  const zc = z - dir * 0.05;
  b.box(o.solid === false ? "trim" : "wood", x, y + h / 2, zc, w, h, 0.05, { tint, collide: o.solid === false ? "none" : "solid" });
  const fr = o.frame ?? 0x6b5a48;
  b.box("trim", x - w / 2 - 0.03, y + h / 2, zc + dir * 0.02, 0.06, h + 0.06, 0.09, { tint: fr, collide: "none" });
  b.box("trim", x + w / 2 + 0.03, y + h / 2, zc + dir * 0.02, 0.06, h + 0.06, 0.09, { tint: fr, collide: "none" });
  b.box("trim", x, y + h + 0.03, zc + dir * 0.02, w + 0.12, 0.06, 0.09, { tint: fr, collide: "none" });
  b.box("trim", x + w / 2 - 0.1, y + 1.0, zc + dir * 0.045, 0.03, 0.12, 0.05, { tint: 0xb0a070, collide: "none" });
  if (o.gate) {
    // The HDB metal gate: a second leaf of thin bars in front of the door.
    const gz = z + dir * 0.03;
    const bars = Math.floor(w / 0.09);
    for (let i = 0; i <= bars; i++) b.box("trim", x - w / 2 + (w * i) / bars, y + h / 2, gz, 0.014, h, 0.014, { tint: 0x55524c, collide: "none" });
    for (const f of [0.02, 0.35, 0.65, 0.98]) b.box("trim", x, y + h * f, gz, w, 0.02, 0.02, { tint: 0x55524c, collide: "none" });
  }
}

/** Roller shutter: ribbed steel curtain with its hood box and bottom rail. */
export function shutter(b: Builder, x: number, y: number, z: number, w: number, h: number, dir: 1 | -1, tint: number, open = 0): void {
  const hh = h * (1 - open);
  const zc = z - dir * 0.08;
  if (hh > 0.05) {
    b.at(x, y + h - hh / 2, zc, 0, () => {
      // Ribs run horizontally on a shutter: rotate the ribbed sheet's UVs.
      b.box("ribmetal", 0, 0, 0, w, hh, 0.04, { tint, uvRot: true, tile: 0.55 });
    });
    b.box("paintmetal", x, y + h - hh + 0.04, zc + dir * 0.03, w, 0.08, 0.05, { tint: 0x8d9092, collide: "none" });
  }
  b.box("paintmetal", x, y + h + 0.14, z + dir * 0.02, w + 0.1, 0.28, 0.24, { tint: 0x9a9da0, collide: "none" });
  for (const s of [-1, 1]) b.box("paintmetal", x + (s * w) / 2, y + h / 2, zc + dir * 0.02, 0.06, h, 0.1, { tint: 0x8d9092, collide: "none" });
}

/** Wall-hung air-conditioner compressor on its bracket. Faces `dir`. */
export function airconUnit(b: Builder, x: number, y: number, z: number, dir: 1 | -1, tint = 0xdedfda): void {
  const zc = z + dir * 0.2;
  b.box("paintmetal", x, y + 0.29, zc, 0.82, 0.56, 0.32, { tint, collide: "none" });
  b.cyl("paintmetal", x - 0.12, y + 0.3, zc + dir * 0.165, 0.2, 0.012, 14, { axis: "z", tint: 0x2a2c2e, collide: "none" });
  b.box("paintmetal", x + 0.3, y + 0.3, zc + dir * 0.165, 0.12, 0.44, 0.012, { tint: 0xa9aaa6, collide: "none" });
  for (const s of [-0.3, 0.3]) b.box("trim", x + s, y - 0.02, zc, 0.04, 0.04, 0.42, { tint: 0x8d9092, collide: "none" });
}
