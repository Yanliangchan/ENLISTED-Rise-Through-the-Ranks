import * as THREE from "three";
import { Surf, type Builder } from "~/gfx/builder";
import type { Rand } from "~/gfx/noise";
import { signQuad, type WorldCtx } from "../ctx";

/** Field defences, clutter and vehicles: everything you fight around. */

const BAG = [0xb7a888, 0xa99a7a, 0xc2b494, 0x9c8f72];

/** A sandbag wall along local X, `len` metres, `rows` courses high, stretcher bond. */
export function sandbags(b: Builder, r: Rand, x: number, z: number, yaw: number, len: number, rows = 3, y = 0): void {
  const bw = 0.62, bh = 0.2, bd = 0.34;
  const geo = new THREE.SphereGeometry(0.5, 8, 6);
  b.at(x, y, z, yaw, () => {
    const n = Math.max(1, Math.round(len / bw));
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? bw / 2 : 0;
      const cnt = row % 2 ? n - 1 : n;
      for (let i = 0; i < cnt; i++) {
        const px = -len / 2 + bw / 2 + i * bw + off + (r() - 0.5) * 0.04;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(px, bh / 2 + row * bh * 0.92, (r() - 0.5) * 0.05),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.08, (r() - 0.5) * 0.14, (r() - 0.5) * 0.05)),
          new THREE.Vector3(bw * 1.04, bh * 1.25, bd * 1.1)
        );
        b.geo("sandbag", geo, m, { tint: BAG[Math.floor(r() * BAG.length)], collide: "none", uvScale: 1.2 });
      }
    }
    b.collisionBox(Surf.Sandbag, "solid", 0, (rows * bh * 0.92) / 2, 0, len, rows * bh * 0.92, bd);
  });
}

/** U-shaped fighting position: a front wall and two short wings. Opens toward -Z locally. */
export function sandbagPost(b: Builder, r: Rand, x: number, z: number, yaw: number, w = 3.2, rows = 5): void {
  b.at(x, 0, z, yaw, () => {
    sandbags(b, r, 0, 0.9, 0, w, rows);
    sandbags(b, r, -w / 2 + 0.1, 0, Math.PI / 2, 1.9, rows);
    sandbags(b, r, w / 2 - 0.1, 0, Math.PI / 2, 1.9, rows);
  });
}

/** Wire-mesh earth-filled barrier cells in a row along local X. */
export function hesco(b: Builder, x: number, z: number, yaw: number, cells: number, tall = 1): void {
  const s = 1.06;
  b.at(x, 0, z, yaw, () => {
    for (let i = 0; i < cells; i++) {
      const cx = (i - (cells - 1) / 2) * s;
      for (let k = 0; k < tall; k++) {
        const y0 = k * 1.0;
        b.box("canvas", cx, y0 + 0.5, 0, s - 0.06, 1.0, s - 0.06, { tint: 0xa39a80 });
        b.box("dirt", cx, y0 + 1.0, 0, s - 0.14, 0.08, s - 0.14, { collide: "none", tint: 0x9a8a6a });
        // Mesh frame.
        for (const [ex, ez] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box("trim", cx + (ex * (s - 0.04)) / 2, y0 + 0.5, (ez * (s - 0.04)) / 2, 0.025, 1.0, 0.025, { tint: 0x6f7170 });
        for (const yy of [0.02, 0.34, 0.67, 0.98]) {
          b.box("trim", cx, y0 + yy, (s - 0.04) / 2, s - 0.04, 0.018, 0.018, { tint: 0x6f7170 });
          b.box("trim", cx, y0 + yy, -(s - 0.04) / 2, s - 0.04, 0.018, 0.018, { tint: 0x6f7170 });
        }
      }
    }
  });
}

/** Precast concrete road barrier, 3 m, along local X. */
export function jersey(b: Builder, x: number, z: number, yaw: number, tint = 0xbfbcb2, stripe = false): void {
  b.at(x, 0, z, yaw + Math.PI / 2, () => {
    b.prism("concrete", [[-0.3, 0], [0.3, 0], [0.3, 0.18], [0.12, 0.42], [0.08, 0.85], [-0.08, 0.85], [-0.12, 0.42], [-0.3, 0.18]], -1.5, 1.5, { tint, collide: "none" });
    b.collisionBox(Surf.Concrete, "solid", 0, 0.42, 0, 0.36, 0.85, 3);
    if (stripe) for (const s of [-1, 1]) b.box("trim", s * 0.105, 0.63, 0, 0.012, 0.2, 2.6, { tint: 0xc23a2a });
  });
}

export function crate(b: Builder, x: number, y: number, z: number, yaw: number, s = 0.9, h = s, tint = 0x8f7a56): void {
  b.at(x, y, z, yaw, () => {
    b.box("wood", 0, h / 2, 0, s, h, s, { tint });
    const t = 0.035;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box("wood", (sx * (s - 0.08)) / 2, h / 2, sz * (s / 2 + t / 2), 0.09, h, t, { tint: 0x7a6748, collide: "none" });
    for (const yy of [0.05, h - 0.05]) for (const sz of [-1, 1]) {
      b.box("wood", 0, yy, sz * (s / 2 + t / 2), s, 0.09, t, { tint: 0x7a6748, collide: "none" });
      b.box("wood", sz * (s / 2 + t / 2), yy, 0, t, 0.09, s, { tint: 0x7a6748, collide: "none" });
    }
  });
}

/** Olive ammunition box with stencilled lid. */
export function ammoBox(b: Builder, x: number, y: number, z: number, yaw: number, scale = 1): void {
  b.at(x, y, z, yaw, () => {
    b.box("paintmetal", 0, 0.1 * scale, 0, 0.46 * scale, 0.2 * scale, 0.2 * scale, { tint: 0x4f5a3a });
    b.box("paintmetal", 0, 0.2 * scale, 0, 0.48 * scale, 0.025, 0.21 * scale, { tint: 0x46502f, collide: "none" });
    b.box("trim", 0, 0.24 * scale, 0, 0.16, 0.02, 0.02, { tint: 0x2c2f28 });
    b.box("trim", 0, 0.12 * scale, 0.101 * scale, 0.22 * scale, 0.07 * scale, 0.004, { tint: 0xd8c84a });
  });
}

/** Long weapons crate (rifles, launchers). */
export function weaponCrate(b: Builder, x: number, y: number, z: number, yaw: number, open = false): void {
  b.at(x, y, z, yaw, () => {
    b.box("wood", 0, 0.17, 0, 1.3, 0.34, 0.46, { tint: 0x5c6440 });
    for (const sx of [-0.45, 0.45]) b.box("wood", sx, 0.17, 0, 0.08, 0.36, 0.48, { tint: 0x4d5536, collide: "none" });
    if (open) {
      const m = new THREE.Matrix4().makeRotationX(-1.2).setPosition(0, 0.36, -0.25);
      b.push(m);
      b.box("wood", 0, 0, 0.22, 1.3, 0.03, 0.46, { tint: 0x5c6440, collide: "none" });
      b.pop();
      for (const sz of [-0.1, 0.06]) b.cyl("steel", 0, 0.3, sz, 0.022, 1.05, 6, { axis: "x", tint: 0x25272a, collide: "none" });
    } else b.box("wood", 0, 0.355, 0, 1.32, 0.03, 0.48, { tint: 0x545c3a, collide: "none" });
    for (const sx of [-0.66, 0.66]) b.box("trim", sx, 0.2, 0, 0.02, 0.03, 0.16, { tint: 0x8a7a55 });
  });
}

export function drum(b: Builder, x: number, y: number, z: number, tint = 0x2f5f8a): void {
  b.cyl("paintmetal", x, y + 0.44, z, 0.29, 0.88, 12, { tint });
  for (const yy of [0.03, 0.3, 0.58, 0.85]) b.cyl("paintmetal", x, y + yy, z, 0.3, 0.03, 12, { tint, collide: "none", caps: false });
}

export function pallet(b: Builder, x: number, y: number, z: number, yaw: number): void {
  b.at(x, y, z, yaw, () => {
    for (let i = 0; i < 5; i++) b.box("wood", 0, 0.125, -0.5 + i * 0.25, 1.2, 0.022, 0.1, { tint: 0xb39b74, collide: "none" });
    for (const sx of [-0.55, 0, 0.55]) b.box("wood", sx, 0.057, 0, 0.1, 0.09, 1.1, { tint: 0xa58e69, collide: "none" });
    b.collisionBox(Surf.Wood, "solid", 0, 0.07, 0, 1.2, 0.14, 1.1);
  });
}

export function cone(b: Builder, x: number, z: number, y = 0): void {
  b.box("rubber", x, y + 0.015, z, 0.36, 0.03, 0.36, { tint: 0x1c1c1c, collide: "none" });
  b.cyl("plastic", x, y + 0.36, z, 0.13, 0.68, 10, { rTop: 0.03, tint: 0xe2561e, collide: "none" });
  b.cyl("plastic", x, y + 0.42, z, 0.095, 0.12, 10, { rTop: 0.075, tint: 0xf0f0ec, collide: "none", caps: false });
}

/** Green 660 L wheeled refuse bin. */
export function wheelieBin(b: Builder, x: number, z: number, yaw: number, y = 0, tint = 0x2f6b45): void {
  b.at(x, y, z, yaw, () => {
    b.box("plastic", 0, 0.68, 0, 1.25, 1.0, 0.76, { tint });
    b.box("plastic", 0, 1.21, 0, 1.3, 0.07, 0.8, { tint: 0x265a3a, collide: "none" });
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.3, 0.3]) b.cyl("rubber", sx, 0.09, sz, 0.09, 0.05, 8, { axis: "x", collide: "none" });
  });
}

/** Concrete planter with a clipped hedge. */
export function planter(b: Builder, x: number, z: number, yaw: number, len: number, y = 0, hedge = true): void {
  b.at(x, y, z, yaw, () => {
    b.box("concrete", 0, 0.25, 0, len, 0.5, 0.8, { tint: 0xc9c5b8 });
    b.box("dirt", 0, 0.5, 0, len - 0.16, 0.02, 0.64, { collide: "none", tint: 0x5a4a38 });
    if (hedge) b.box("hedge", 0, 0.82, 0, len - 0.2, 0.62, 0.62, { collide: "soft" });
  });
}

export function tyreStack(b: Builder, x: number, z: number, n: number, y = 0): void {
  for (let i = 0; i < n; i++) {
    b.cyl("rubber", x + (i % 2) * 0.03, y + 0.11 + i * 0.22, z, 0.33, 0.22, 12, { collide: i === 0 ? "solid" : "none" });
    b.cyl("rubber", x + (i % 2) * 0.03, y + 0.225 + i * 0.22, z, 0.18, 0.005, 10, { collide: "none", tint: 0x050505 });
  }
  b.collisionBox(Surf.Rubber, "solid", x, y + (n * 0.22) / 2, z, 0.62, n * 0.22, 0.62);
}

/** Concertina wire coil along local X: slows nothing, but reads from across the street. */
export function wire(b: Builder, x: number, z: number, yaw: number, len: number): void {
  b.at(x, 0, z, yaw, () => {
    const loops = Math.round(len / 0.22);
    for (let i = 0; i < loops; i++) {
      const m = new THREE.Matrix4().makeRotationY(Math.PI / 2 + (i % 2 ? 0.25 : -0.25)).setPosition(-len / 2 + i * 0.22, 0.46, 0);
      b.geo("trim", WIRE, m, { tint: 0x8c9092, collide: "none" });
    }
    for (let i = 0; i <= len; i += 2.4) {
      b.cyl("steel", -len / 2 + i, 0.55, 0, 0.02, 1.1, 5, { tint: 0x4b4d4a, collide: "none" });
    }
    b.collisionBox(Surf.Metal, "soft", 0, 0.45, 0, len, 0.9, 0.7);
  });
}
const WIRE = new THREE.TorusGeometry(0.44, 0.008, 3, 14);

// ---- vehicles --------------------------------------------------------------------

function wheel(b: Builder, x: number, y: number, z: number, r: number, w: number, hub = 0x8b8e90): void {
  b.cyl("rubber", x, y, z, r, w, 14, { axis: "x", collide: "none" });
  b.cyl("paintmetal", x, y, z, r * 0.58, w + 0.02, 10, { axis: "x", tint: hub, collide: "none" });
}

export interface CarOpts {
  color: number;
  kind?: "sedan" | "hatch" | "suv" | "taxi" | "van";
  wreck?: boolean;
}

/** Civilian car, nose toward local +Z. About 4.5 × 1.8 m. Body is an extruded side profile. */
export function car(b: Builder, r: Rand, x: number, z: number, yaw: number, o: CarOpts, y = 0): void {
  const kind = o.kind ?? "sedan";
  const wreck = !!o.wreck;
  const col = wreck ? 0x2a2420 : o.color;
  const L = kind === "van" ? 4.9 : kind === "hatch" ? 3.95 : 4.55;
  const W = kind === "van" ? 1.9 : 1.78;
  const H = kind === "van" ? 1.95 : kind === "suv" ? 1.68 : 1.44;
  const hl = L / 2;
  const sill = wreck ? 0.2 : 0.3;
  const belt = kind === "van" ? 1.05 : kind === "suv" ? 0.98 : 0.86;
  // Side profile in (z, y): counter-clockwise from rear-bottom.
  const roofF = kind === "van" ? hl - 1.15 : hl - 1.75;
  const roofR = kind === "van" ? -hl + 0.12 : kind === "sedan" || kind === "taxi" ? -hl + 1.15 : -hl + 0.35;
  const body: number[][] = [[-hl, sill], [hl, sill], [hl, belt - 0.24], [hl - 0.12, belt - 0.06], [hl - (kind === "van" ? 0.5 : 1.0), belt], [roofF, H], [roofR, H], [-hl + (kind === "sedan" || kind === "taxi" ? 0.55 : 0.08), belt + (kind === "sedan" || kind === "taxi" ? 0 : 0.2)], [-hl, belt - 0.04]];
  b.at(x, y, z, yaw - Math.PI / 2, () => {
    // prism extrudes XY along Z: profile z→x, y→y, width along z.
    b.prism("carpaint", body, -W / 2, W / 2, { tint: col, collide: "none" });
    b.collisionBox(Surf.Metal, "solid", 0, belt / 2 + 0.1, 0, L, belt, W);
    b.collisionBox(Surf.Metal, "solid", (roofF + roofR) / 2, (H + belt) / 2, 0, roofF - roofR, H - belt, W - 0.2);
    // Glazing: side strips and screens laid just over the body.
    const gl = wreck ? 0x0a0a0a : 0x1a2428;
    const gy0 = belt + 0.04, gy1 = H - 0.09;
    const f0 = hl - (kind === "van" ? 0.56 : 1.06), f1 = roofF - 0.04;
    const r0 = -hl + (kind === "sedan" || kind === "taxi" ? 0.62 : 0.16), r1 = roofR + 0.04;
    for (const s of [-1, 1]) {
      const zz = s * (W / 2 + 0.006);
      const pts = s > 0 ? [[r0 + 0.1, gy0, zz], [f0 - 0.1, gy0, zz], [f1 - 0.12, gy1, zz], [r1 + 0.1, gy1, zz]] : [[f0 - 0.1, gy0, zz], [r0 + 0.1, gy0, zz], [r1 + 0.1, gy1, zz], [f1 - 0.12, gy1, zz]];
      if (!wreck || s > 0) b.quad("glass", pts[0], pts[1], pts[2], pts[3], { tint: gl, collide: "none" });
      b.box("trim", (f1 + r1) / 2 - 0.1, (gy0 + gy1) / 2, zz, 0.07, gy1 - gy0, 0.012, { tint: col });
      // Door seams, handles, mirrors.
      b.box("trim", (f1 + r1) / 2 - 0.1, (sill + belt) / 2 + 0.05, zz, 0.012, belt - sill - 0.1, 0.006, { tint: 0x111111 });
      b.box("trim", f0 - 0.15, (sill + belt) / 2 + 0.05, zz, 0.012, belt - sill - 0.1, 0.006, { tint: 0x111111 });
      b.box("trim", f0 - 0.5, belt - 0.12, zz + s * 0.012, 0.16, 0.03, 0.02, { tint: 0x8a8c8e });
      b.box("trim", f0 + 0.02, belt + 0.1, zz + s * 0.09, 0.08, 0.11, 0.17, { tint: col });
    }
    // Screens sit on the sloped faces.
    const scr = (za: number, ya: number, zb: number, yb: number): void => {
      const hw = W / 2 - 0.14;
      const e = 0.012;
      const nx = yb - ya, ny = -(zb - za);
      const nl = Math.hypot(nx, ny);
      const ox = (nx / nl) * e, oy = (ny / nl) * e;
      b.quad("glass", [za + ox, ya + oy, hw], [za + ox, ya + oy, -hw], [zb + ox, yb + oy, -hw], [zb + ox, yb + oy, hw], { tint: gl, collide: "none" });
    };
    if (!wreck) scr(hl - (kind === "van" ? 0.52 : 1.03), belt + 0.03, roofF + 0.03, H - 0.04);
    if (!wreck) scr(roofR - 0.03, H - 0.04, -hl + (kind === "sedan" || kind === "taxi" ? 0.58 : 0.1), belt + (kind === "sedan" || kind === "taxi" ? 0.03 : 0.23));
    // Lamps, grille, bumpers, plates.
    for (const s of [-1, 1]) {
      b.box("emissiveoff", hl + 0.004, belt - 0.2, s * (W / 2 - 0.3), 0.02, 0.13, 0.36, { tint: wreck ? 0x202020 : 0xdfe6ea, collide: "none" });
      b.box("emissiveoff", -hl - 0.004, belt - 0.14, s * (W / 2 - 0.28), 0.02, 0.14, 0.34, { tint: wreck ? 0x1a0a0a : 0x8f1414, collide: "none" });
    }
    b.box("trim", hl + 0.005, belt - 0.42, 0, 0.02, 0.2, W - 0.7, { tint: 0x0d0d0d });
    b.box("plastic", hl + 0.02, sill + 0.09, 0, 0.1, 0.2, W - 0.04, { tint: wreck ? 0x1a1a1a : 0x1c1d1f, collide: "none" });
    b.box("plastic", -hl - 0.02, sill + 0.09, 0, 0.1, 0.2, W - 0.04, { tint: wreck ? 0x1a1a1a : 0x1c1d1f, collide: "none" });
    if (!wreck) {
      b.box("trim", hl + 0.075, sill + 0.12, 0, 0.006, 0.11, 0.48, { tint: 0x0b0b0b });
      b.box("trim", -hl - 0.075, sill + 0.16, 0, 0.006, 0.11, 0.48, { tint: 0x0b0b0b });
    }
    if (kind === "taxi") {
      b.box("plastic", -0.2, H + 0.07, 0, 0.16, 0.13, 0.5, { tint: 0xf4f4ee, collide: "none" });
    }
    // Wheels (flat and sunk on a wreck).
    const wr = kind === "suv" || kind === "van" ? 0.35 : 0.31;
    for (const wz of [hl - 0.85, -hl + 0.82]) for (const s of [-1, 1]) {
      b.at(wz, wreck ? wr * 0.7 : wr, s * (W / 2 - 0.1), Math.PI / 2, () => wheel(b, 0, 0, 0, wr, 0.2, wreck ? 0x2a2622 : 0x9a9da0));
      b.box("plastic", wz, wr * 2 + 0.02 - (wreck ? 0.1 : 0), s * (W / 2 + 0.002), wr * 2.3, 0.07, 0.01, { tint: 0x111111, collide: "none" });
    }
    b.box("plastic", 0, sill - 0.05, 0, L - 0.5, 0.14, W - 0.3, { tint: 0x0c0c0c, collide: "none" });
  });
  void r;
}

/** SAF 5-tonne cargo truck (MAN pattern): cab-over, canvas tilt on the bed. Nose toward local +Z. */
export function fiveTonner(b: Builder, x: number, z: number, yaw: number, o: { tilt?: boolean; tint?: number; roll?: number; burnt?: boolean } = {}): void {
  const g = o.burnt ? 0x5c4636 : o.tint ?? 0x4a5338;
  b.at(x, 0, z, yaw - Math.PI / 2, () => {
    // Overturned: roll about the long axis and lift so the truck rests on its side.
    if (o.roll) b.push(new THREE.Matrix4().makeRotationX(o.roll).setPosition(0, Math.abs(Math.sin(o.roll)) * 1.24, 0));
    // Chassis.
    b.box("paintmetal", -0.2, 0.92, 0, 7.0, 0.22, 0.9, { tint: 0x1e2019 });
    // Cab (local +X is forward).
    b.prism("paintmetal", [[2.25, 1.0], [3.95, 1.0], [3.95, 2.0], [3.8, 2.95], [2.25, 2.95]], -1.22, 1.22, { tint: g });
    b.box("glass", 3.93, 2.42, 0, 0.02, 0.72, 2.1, { tint: 0x1a2428, collide: "none" });
    for (const s of [-1, 1]) {
      b.box("glass", 3.15, 2.42, s * 1.225, 0.9, 0.62, 0.01, { tint: 0x1a2428, collide: "none" });
      b.box("trim", 3.1, 1.7, s * 1.228, 0.012, 1.3, 0.008, { tint: 0x20241a });
      b.box("paintmetal", 3.7, 2.5, s * 1.42, 0.06, 0.4, 0.2, { tint: 0x1b1d18, collide: "none" });
      b.box("paintmetal", 3.3, 0.72, s * 1.05, 0.5, 0.06, 0.3, { tint: 0x1b1d18, collide: "none" });
      b.box("emissiveoff", 3.96, 1.2, s * 0.9, 0.02, 0.16, 0.3, { tint: 0xd9dee0, collide: "none" });
    }
    b.box("paintmetal", 3.99, 1.02, 0, 0.14, 0.34, 2.46, { tint: 0x1e2019 });
    b.box("trim", 3.965, 1.62, 0, 0.012, 0.42, 1.3, { tint: 0x14160f });
    b.box("paintmetal", 3.0, 3.0, 0, 1.3, 0.1, 1.6, { tint: g, collide: "none" });
    // Cargo bed with drop sides.
    b.box("paintmetal", -0.85, 1.28, 0, 5.4, 0.12, 2.44, { tint: g });
    for (const s of [-1, 1]) b.box("ribmetal", -0.85, 1.62, s * 1.2, 5.4, 0.56, 0.05, { tint: g, uvRot: true });
    b.box("ribmetal", -3.53, 1.62, 0, 0.05, 0.56, 2.4, { tint: g });
    b.box("paintmetal", 1.83, 1.9, 0, 0.06, 1.12, 2.4, { tint: g });
    if (o.tilt !== false) {
      // Canvas tilt over hoops.
      b.prism("canvas", [[-3.5, 1.9], [1.8, 1.9], [1.8, 3.0], [1.5, 3.2], [-3.2, 3.2], [-3.5, 3.0]], -1.22, 1.22, { tint: 0x55603f });
    } else {
      for (const hx of [-3.3, -1.6, 0.1, 1.7]) {
        for (const s of [-1, 1]) b.cyl("steel", hx, 2.5, s * 1.18, 0.022, 1.3, 5, { tint: 0x2b2f24, collide: "none" });
        b.cyl("steel", hx, 3.15, 0, 0.022, 2.36, 5, { axis: "z", tint: 0x2b2f24, collide: "none" });
      }
      // Bench seats down the middle.
      b.box("wood", -0.85, 1.75, 0, 5.0, 0.06, 0.8, { tint: 0x5a5f3c });
    }
    // Wheels: one front axle, two rear.
    for (const wx of [3.05, -1.3, -2.65]) for (const s of [-1, 1]) {
      b.at(wx, 0.56, s * 1.05, Math.PI / 2, () => wheel(b, 0, 0, 0, 0.56, 0.36, 0x3a4030));
      if (wx < 0) b.box("paintmetal", wx, 1.18, s * 1.05, 1.3, 0.04, 0.42, { tint: 0x1e2019, collide: "none" });
    }
    b.box("paintmetal", 0.6, 0.75, 1.0, 1.1, 0.5, 0.4, { tint: 0x1e2019 });
    b.cyl("paintmetal", 0.4, 0.78, -0.95, 0.27, 1.0, 10, { axis: "x", tint: 0x23261d });
    b.collisionBox(Surf.Metal, "solid", 0.2, 0.6, 0, 7.4, 1.0, 2.2);
    if (o.roll) b.pop();
  });
}

/** Single-deck public bus in SBS livery (white, red and purple swoosh). Nose toward local +Z. */
export function bus(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number, service = "169"): void {
  const L = 12, W = 2.5, H = 3.1;
  const dest = ctx.signs.text(`bus:${service}`, 512, 96, "#0c0c0c", "#ffb428", [[`${service}   WOODLANDS INT`, 58]], { font: "'Courier New', monospace" });
  b.at(x, 0, z, yaw - Math.PI / 2, () => {
    b.box("carpaint", 0, 1.72, 0, L, H - 0.36, W, { tint: 0xeeeeea });
    b.box("carpaint", 0, 0.62, 0, L, 0.5, W + 0.01, { tint: 0xb3202a, collide: "none" });
    b.box("carpaint", -2, 1.0, 0, L - 4, 0.26, W + 0.012, { tint: 0x5a2a7a, collide: "none" });
    b.box("paintmetal", 0, H + 0.2, 0, L - 1.6, 0.28, W - 0.6, { tint: 0xdcdcd8, collide: "none" });
    for (const s of [-1, 1]) {
      b.box("glass", -0.3, 2.2, s * (W / 2 + 0.006), L - 1.8, 0.95, 0.01, { tint: 0x121a1e, collide: "none" });
      for (let i = -4; i <= 4; i++) b.box("trim", i * 1.2 - 0.3, 2.2, s * (W / 2 + 0.01), 0.05, 0.95, 0.008, { tint: 0x16181a });
    }
    // Doors on the kerb side (local -Z = left of travel).
    for (const dx of [4.6, -0.6]) {
      b.box("glass", dx, 1.55, -(W / 2 + 0.012), 1.2, 2.1, 0.01, { tint: 0x0e1416, collide: "none" });
      b.box("trim", dx, 1.55, -(W / 2 + 0.016), 0.04, 2.1, 0.008, { tint: 0x16181a });
    }
    b.box("glass", L / 2 + 0.006, 2.0, 0, 0.01, 1.35, W - 0.24, { tint: 0x121a1e, collide: "none" });
    b.box("glass", -L / 2 - 0.006, 2.3, 0, 0.01, 0.8, W - 0.5, { tint: 0x121a1e, collide: "none" });
    signQuad(b, dest, L / 2 + 0.012, 2.95, 0, 1.9, 0.34, Math.PI / 2, true);
    b.box("plastic", L / 2 + 0.03, 0.55, 0, 0.1, 0.4, W - 0.02, { tint: 0x17181a, collide: "none" });
    b.box("plastic", -L / 2 - 0.03, 0.55, 0, 0.1, 0.4, W - 0.02, { tint: 0x17181a, collide: "none" });
    for (const s of [-1, 1]) {
      b.box("emissiveoff", L / 2 + 0.01, 0.95, s * 0.95, 0.02, 0.16, 0.36, { tint: 0xe0e6ea, collide: "none" });
      b.box("emissiveoff", -L / 2 - 0.01, 1.2, s * 1.0, 0.02, 0.4, 0.14, { tint: 0x8f1414, collide: "none" });
    }
    for (const wx of [3.6, -3.2]) for (const s of [-1, 1]) b.at(wx, 0.5, s * (W / 2 - 0.14), Math.PI / 2, () => wheel(b, 0, 0, 0, 0.5, 0.3, 0x7d8082));
    b.box("plastic", 0, 0.3, 0, L - 0.6, 0.2, W - 0.4, { tint: 0x0c0c0c, collide: "none" });
  });
}

/** Folding field table with a map, radio and laptop: an OPFOR command post. */
export function commandTable(ctx: WorldCtx, b: Builder, x: number, y: number, z: number, yaw: number): void {
  const map = ctx.signs.add("cp:map", 256, 192, (c, w, h) => {
    c.fillStyle = "#d8d2b8";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(60,80,60,.5)";
    for (let i = 0; i < 12; i++) {
      c.beginPath();
      c.moveTo(0, i * 18 + 6);
      c.bezierCurveTo(60, i * 18 - 14, 150, i * 18 + 30, w, i * 18);
      c.stroke();
    }
    c.fillStyle = "rgba(90,90,90,.55)";
    c.fillRect(118, 0, 14, h);
    c.fillRect(0, 88, w, 12);
    c.strokeStyle = "#b02a1e";
    c.lineWidth = 3;
    for (const [px, py] of [[70, 50], [180, 60], [60, 140], [190, 140]]) {
      c.beginPath();
      c.arc(px, py, 13, 0, 7);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(125, 180);
    c.lineTo(125, 100);
    c.lineTo(175, 66);
    c.stroke();
  });
  const screen = ctx.signs.add("cp:screen", 128, 80, (c, w, h) => {
    c.fillStyle = "#0b1a14";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#3ad07a";
    c.font = "8px monospace";
    for (let i = 0; i < 8; i++) c.fillText(["> SYNC 41-A ........ OK", "> GRID 3411 CONFIRMED", "> UPLINK 12.4 kbps", "> ORDERS: HOLD ESTATE", "> RELIEF ETA 0200", "> CACHE: HAWKER CTR", "> MORTAR: MSCP DECK", "> _"][i], 5, 10 + i * 9);
  });
  b.at(x, y, z, yaw, () => {
    b.box("wood", 0, 0.74, 0, 1.8, 0.04, 0.76, { tint: 0x5d6247 });
    for (const sx of [-0.8, 0.8]) for (const sz of [-0.3, 0.3]) b.cyl("steel", sx, 0.37, sz, 0.02, 0.74, 6, { tint: 0x3a3d38, collide: "none" });
    b.collisionBox(Surf.Wood, "solid", 0, 0.38, 0, 1.8, 0.76, 0.76);
    b.at(-0.3, 0.763, 0, 0.1, () => b.quad("sign", [-0.5, 0, 0.33], [0.5, 0, 0.33], [0.5, 0, -0.33], [-0.5, 0, -0.33], { collide: "none" }, [[map[0], map[1]], [map[2], map[1]], [map[2], map[3]], [map[0], map[3]]]));
    // Laptop.
    b.box("plastic", 0.55, 0.772, 0.05, 0.34, 0.018, 0.24, { tint: 0x2b2d2f, collide: "none" });
    b.at(0.55, 0.78, -0.07, 0, () => {
      const m = new THREE.Matrix4().makeRotationX(-0.28);
      b.push(m);
      b.box("plastic", 0, 0.115, 0, 0.34, 0.23, 0.012, { tint: 0x2b2d2f, collide: "none" });
      signQuad(b, screen, 0, 0.115, 0.008, 0.3, 0.19, 0, true);
      b.pop();
    });
    // Manpack radio with whip antenna.
    b.box("paintmetal", -0.72, 0.9, -0.18, 0.26, 0.3, 0.1, { tint: 0x464f34, collide: "none" });
    b.cyl("steel", -0.8, 1.45, -0.18, 0.004, 0.9, 4, { tint: 0x16181a, collide: "none" });
  });
  ctx.lamp(x, y + 1.0, z, 0.5, 4);
}

/** A tarpaulin-draped stack of munitions: the cache the player destroys. */
export function weaponsCache(b: Builder, r: Rand, x: number, y: number, z: number, yaw: number): void {
  b.at(x, y, z, yaw, () => {
    pallet(b, -0.7, 0, 0, 0);
    pallet(b, 0.7, 0, 0, 0.04);
    weaponCrate(b, -0.7, 0.14, -0.25, 0);
    weaponCrate(b, -0.7, 0.14, 0.27, 0.02);
    weaponCrate(b, -0.68, 0.5, 0, 0.05, true);
    crate(b, 0.45, 0.14, -0.1, 0.1, 0.7, 0.6, 0x5c6440);
    crate(b, 1.05, 0.14, 0.15, -0.06, 0.6, 0.5, 0x5c6440);
    for (let i = 0; i < 5; i++) ammoBox(b, 0.35 + (i % 3) * 0.3, 0.74 + Math.floor(i / 3) * 0.21, -0.12 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.5);
    drum(b, 1.9, 0, -0.3, 0x4a5338);
    drum(b, 1.95, 0, 0.35, 0x4a5338);
    // RPG rounds leaning on the crates.
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Matrix4().makeRotationZ(0.3).setPosition(-1.5 - i * 0.03, 0.45, -0.3 + i * 0.22);
      b.push(m);
      b.cyl("paintmetal", 0, 0, 0, 0.022, 0.9, 6, { tint: 0x55452c, collide: "none" });
      b.cyl("paintmetal", 0, 0.5, 0, 0.045, 0.34, 8, { rTop: 0.008, tint: 0x4a5338, collide: "none" });
      b.pop();
    }
  });
}


// ---- battle debris ------------------------------------------------------------------

const _e = new THREE.Euler();
const _q4 = new THREE.Quaternion();

/** A heap of broken concrete and brick with rebar sticking out. Solid up to about `h`. */
export function rubble(b: Builder, r: Rand, x: number, z: number, radius = 1.6, h = 0.9, y = 0.1): void {
  b.at(x, y, z, r() * 6.3, () => {
    const n = Math.round(14 + radius * 9);
    for (let i = 0; i < n; i++) {
      const a = r() * 6.3, d = Math.sqrt(r()) * radius;
      const k = 1 - d / radius;
      const s = 0.25 + r() * 0.55;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * d, k * h * (0.3 + r() * 0.6) + 0.08, Math.sin(a) * d * 0.8),
        _q4.setFromEuler(_e.set(r() * 3, r() * 3, r() * 3)),
        new THREE.Vector3(s * (0.6 + r()), s * (0.3 + r() * 0.5), s * (0.6 + r()))
      );
      b.push(m);
      const t = r();
      b.box(t < 0.6 ? "concrete" : t < 0.85 ? "brick" : "plaster", 0, 0, 0, 1, 1, 1, { collide: "none", tint: t < 0.6 ? 0xb4b0a6 : t < 0.85 ? 0xa86a50 : 0xd8d2c4 });
      b.pop();
    }
    // Core mound and dust skirt.
    b.geo("dirt", RUBBLE_MOUND, new THREE.Matrix4().makeScale(radius * 1.15, h * 0.75, radius * 0.95), { collide: "none", tint: 0x8f8a80 });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3((r() - 0.5) * radius, h * 0.5, (r() - 0.5) * radius), _q4.setFromEuler(_e.set((r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6)), new THREE.Vector3(1, 1, 1));
      b.push(m);
      b.cyl("rust", 0, 0.3, 0, 0.012, 0.9 + r() * 0.6, 4, { collide: "none" });
      b.pop();
    }
    b.collisionBox(Surf.Concrete, "solid", 0, h * 0.42, 0, radius * 1.5, h * 0.84, radius * 1.25);
  });
}
const RUBBLE_MOUND = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);

/** What is left of a brick wall: a ragged run about chest high, taller at one end. */
export function brokenWall(b: Builder, r: Rand, x: number, z: number, yaw: number, len = 5, y = 0.1): void {
  b.at(x, y, z, yaw, () => {
    const cols = Math.round(len / 0.5);
    for (let i = 0; i < cols; i++) {
      const t = i / (cols - 1);
      const h = 0.7 + Math.max(0, Math.sin(t * 3.1 + 0.4)) * 1.2 * (0.6 + r() * 0.5) + (i < 2 ? 0.9 : 0);
      b.box("brick", -len / 2 + i * 0.5 + 0.25, h / 2, 0, 0.5, h, 0.24, { tint: 0xb07a60, collide: "none" });
      if (r() < 0.5) b.box("plaster", -len / 2 + i * 0.5 + 0.25, h * 0.4, 0.125, 0.5, h * 0.7, 0.02, { tint: 0xd8d0be, collide: "none" });
    }
    b.collisionBox(Surf.Concrete, "solid", 0, 0.6, 0, len, 1.2, 0.26);
    b.collisionBox(Surf.Concrete, "solid", -len / 2 + 0.5, 1.2, 0, 1, 2.2, 0.26);
  });
  rubble(b, r, x + Math.sin(yaw) * 0.9, z + Math.cos(yaw) * 0.9, 1.3, 0.45, y);
}

/** 20-foot shipping container. Doors at local +X; `open` swings them out. */
export function container(b: Builder, x: number, z: number, yaw: number, tint: number, open = false, y = 0.1): void {
  const L = 6.06, W = 2.44, H = 2.59;
  b.at(x, y, z, yaw, () => {
    b.box("ribmetal", 0, H / 2, -W / 2 + 0.03, L, H, 0.06, { tint, tile: 0.6 });
    b.box("ribmetal", 0, H / 2, W / 2 - 0.03, L, H, 0.06, { tint, tile: 0.6 });
    b.box("ribmetal", -L / 2 + 0.03, H / 2, 0, 0.06, H, W, { tint, tile: 0.6 });
    b.box("ribmetal", 0, H - 0.03, 0, L, 0.06, W, { tint, tile: 0.6, uvRot: true });
    b.box("wood", 0, 0.08, 0, L - 0.1, 0.08, W - 0.1, { tint: 0x6a5a48 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box("paintmetal", (sx * (L - 0.14)) / 2, H / 2, (sz * (W - 0.14)) / 2, 0.14, H, 0.14, { tint, collide: "none" });
      b.box("steel", (sx * (L - 0.16)) / 2, 0.06, (sz * (W - 0.16)) / 2, 0.18, 0.12, 0.18, { tint: 0x3a3c3d, collide: "none" });
    }
    for (const yy of [0.07, H - 0.07]) for (const sz of [-1, 1]) b.box("paintmetal", 0, yy, (sz * (W - 0.1)) / 2, L, 0.14, 0.1, { tint, collide: "none" });
    for (const s of [-1, 1]) {
      // Each leaf hangs from its corner post; an open one swings out past ninety degrees.
      b.at(L / 2, 0, (s * W) / 2, open ? -s * (s > 0 ? 1.9 : 1.4) : 0, () => {
        b.box("paintmetal", 0, H / 2, -s * 0.6, 0.05, H - 0.2, 1.18, { tint });
        for (const zz of [0.3, 0.9]) b.cyl("steel", 0.04, H / 2, -s * zz, 0.016, H - 0.25, 5, { tint: 0x9a9da0, collide: "none" });
      });
    }
  });
}

/** Stack of concrete culvert sections, big enough to crouch behind. */
export function pipes(b: Builder, x: number, z: number, yaw: number, y = 0.1): void {
  b.at(x, y, z, yaw, () => {
    const R = 0.62, L = 2.4;
    for (const [px, py] of [[-R, R], [R, R], [0, R * 2.72]]) {
      b.cyl("concrete", 0, py, px, R, L, 16, { axis: "x", tint: 0xbab6aa, collide: "none", caps: false });
      b.cyl("concrete", 0, py, px, R - 0.09, L, 16, { axis: "x", tint: 0x8a877e, collide: "none", caps: false });
      for (const e of [-1, 1]) b.geo("concrete", PIPE_RIM, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition((e * L) / 2, py, px), { tint: 0xa8a49a, collide: "none" });
    }
    b.collisionBox(Surf.Concrete, "solid", 0, R, 0, L, R * 2, R * 4);
    b.collisionBox(Surf.Concrete, "solid", 0, R * 2.7, 0, L, R * 1.9, R * 2);
    for (const e of [-0.8, 0.8]) b.box("wood", e, 0.04, 0, 0.12, 0.08, R * 4.4, { tint: 0x8a7458, collide: "none" });
  });
}
const PIPE_RIM = new THREE.RingGeometry(0.53, 0.62, 16);

/** A street lamp brought down across the road. */
export function fallenLamp(b: Builder, x: number, z: number, yaw: number, y = 0): void {
  b.at(x, y, z, yaw, () => {
    b.push(new THREE.Matrix4().makeRotationZ(Math.PI / 2 - 0.05).setPosition(0, 0.3, 0));
    b.cyl("steel", 0, 0, 0, 0.1, 9, 8, { rTop: 0.06, tint: 0x8a8e90, collide: "none" });
    b.pop();
    b.box("paintmetal", -4.6, 0.12, 0.5, 0.75, 0.1, 0.3, { tint: 0x55595c, collide: "none" });
    b.box("concrete", 4.5, 0.2, 0, 0.7, 0.4, 0.7, { tint: 0xbdbab0 });
    b.collisionBox(Surf.Metal, "solid", 0, 0.25, 0, 9, 0.5, 0.3);
  });
}

/** Jerrycans in a row. */
export function jerrycans(b: Builder, x: number, y: number, z: number, yaw: number, n = 3, tint = 0x4a5338): void {
  b.at(x, y, z, yaw, () => {
    for (let i = 0; i < n; i++) {
      b.box("paintmetal", i * 0.2, 0.22, 0, 0.16, 0.44, 0.34, { tint, collide: i === 0 ? "solid" : "none" });
      b.box("paintmetal", i * 0.2, 0.47, 0.06, 0.05, 0.06, 0.14, { tint: 0x2a2e22, collide: "none" });
    }
  });
}
