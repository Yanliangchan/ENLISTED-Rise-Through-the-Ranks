import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Surf, type Builder } from "~/gfx/builder";
import { signQuad, type WorldCtx } from "../ctx";
import { airconUnit, door, shutter, wall, win } from "./arch";
import * as P from "./props";

/** The estate's set-piece buildings. Each is built in local space (front faces +Z) and placed with a yaw. */

const F0 = 0.15;
let fanMat: THREE.MeshStandardMaterial | null = null;
const FAN_BLADES = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) parts.push(new THREE.BoxGeometry(0.78, 0.012, 0.13).translate(0.47, 0, 0).rotateX(0.12).rotateY((k / 3) * Math.PI * 2));
  return mergeGeometries(parts)!;
})();

function placer(x: number, z: number, yaw: number): (lx: number, ly: number, lz: number) => [number, number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
}

/** Ceiling batten light: tube, tray and a baked lamp. */
function tube(ctx: WorldCtx, b: Builder, W: ReturnType<typeof placer>, x: number, y: number, z: number, alongX = true, power = 1.1, radius = 9): void {
  b.box("paintmetal", x, y - 0.03, z, alongX ? 1.3 : 0.12, 0.05, alongX ? 0.12 : 1.3, { tint: 0xdcdcd6, collide: "none" });
  b.box("emissive", x, y - 0.07, z, alongX ? 1.2 : 0.05, 0.025, alongX ? 0.05 : 1.2);
  ctx.lamp(...W(x, y - 0.3, z), power, radius);
}

// ---------------------------------------------------------------------------------
// Neighbourhood shop row
// ---------------------------------------------------------------------------------

export interface ShopSpec {
  name: string;
  kind: "mart" | "kopitiam" | "clinic" | "salon" | "hardware" | "closed" | "bakery";
  bg: string;
  fg: string;
}

export const SHOPS: ShopSpec[] = [
  { name: "HOCK SENG MINIMART", kind: "mart", bg: "#b3261e", fg: "#fff3c4" },
  { name: "YISHUN 41 KOPITIAM", kind: "kopitiam", bg: "#f2ead0", fg: "#1c4a2a" },
  { name: "NEE SOON FAMILY CLINIC", kind: "clinic", bg: "#f4f6f4", fg: "#1a5a8a" },
  { name: "LUCKY STAR HAIR SALON", kind: "salon", bg: "#2a2030", fg: "#f0c0d8" },
  { name: "SIN HUAT HARDWARE", kind: "hardware", bg: "#f0c020", fg: "#1a1a1a" },
  { name: "GOLDEN CRUST BAKERY", kind: "bakery", bg: "#5a3a1e", fg: "#f6dfa8" },
  { name: "TO LET  6555 0141", kind: "closed", bg: "#e8e8e4", fg: "#b02a1e" },
  { name: "KIM HENG PROVISION SHOP", kind: "mart", bg: "#1c5a3a", fg: "#f5f0d0" },
];

/**
 * HDB shop block: shops behind a covered five-foot way, two storeys of flats above.
 * Units run along local X; the walkway is z 0.4..3.6 and shop interiors reach back to z -8.
 */
export function shopRow(ctx: WorldCtx, o: { x: number; z: number; yaw: number; units: number; first?: number; accent: number }): void {
  const b = ctx.builder(`shops:${o.x}`);
  const W = placer(o.x, o.z, o.yaw);
  const UW = 5.6, H0 = 3.7, H = 2.9, back = -8, front = 0.4, walk = 3.6;
  const n = o.units;
  const L = n * UW;
  const x0 = -L / 2;
  const body = 0xe6dfcc;
  const roofY = F0 + H0 + 2 * H;
  b.at(o.x, 0, o.z, o.yaw, () => {
    // Floor: tiled shops and walkway.
    b.slab("floortile", x0, F0 - 0.3, back, L, 0.3, walk - back + 0.25, { tint: 0xcfc8b8, skip: "-y" });
    // Party walls, back wall, first-floor slab.
    for (let i = 0; i <= n; i++) b.slab("plaster", x0 + i * UW - 0.1, F0, back, 0.2, H0, front - back, { tint: 0xe9e5d8 });
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i + 0.5) * UW;
      wall(b, "plaster", cx - UW / 2, cx + UW / 2, F0, F0 + H0, back, 0.2, [{ x: cx + 1.4, w: 1.4, y: F0, h: 2.2 }], { tint: body });
      // Back-of-house: compressor, pipe, bins.
      airconUnit(b, cx - 1.2, F0 + 2.3, back - 0.1, -1);
      b.cyl("plastic", cx - 2.3, F0 + H0 / 2, back - 0.18, 0.055, H0, 6, { tint: 0xc8c8c0, collide: "none" });
    }
    b.slab("concrete", x0 - 0.3, F0 + H0, back - 0.3, L + 0.6, 0.25, walk - back + 0.9, { tint: 0xd8d4c8 });
    // Walkway columns and fascia beam carrying the signboards.
    for (let i = 0; i <= n; i++) {
      const cx = x0 + i * UW;
      b.box("paint", cx, F0 + H0 / 2, walk, 0.45, H0, 0.45, { tint: i % 2 ? body : o.accent });
      b.box("walltile", cx, F0 + 0.55, walk, 0.47, 1.1, 0.47, { tint: 0xb9b3a4, collide: "none" });
    }
    b.box("paint", 0, F0 + H0 - 0.45, walk + 0.12, L + 0.5, 0.9, 0.22, { tint: body });
    b.box("paint", 0, F0 + H0 - 0.92, walk + 0.14, L + 0.5, 0.07, 0.26, { tint: o.accent, collide: "none" });

    for (let i = 0; i < n; i++) {
      const spec = SHOPS[((o.first ?? 0) + i) % SHOPS.length];
      const cx = x0 + (i + 0.5) * UW;
      const sign = ctx.signs.text(`shop:${spec.name}`, 640, 112, spec.bg, spec.fg, [[spec.name, spec.name.length > 20 ? 44 : 52]], { border: spec.fg });
      signQuad(b, sign, cx, F0 + H0 - 0.45, walk + 0.24, UW - 0.5, 0.82, 0, spec.kind !== "closed");
      // Unit number plaque and walkway lighting.
      tube(ctx, b, W, cx, F0 + H0, 2.0, true, 0.9, 7);
      const fw = UW - 0.5;
      if (spec.kind === "closed") {
        shutter(b, cx, F0, front, fw, 2.9, 1, 0x9aa0a4, 0);
        wall(b, "plaster", cx - UW / 2, cx + UW / 2, F0 + 3.2, F0 + H0, front, 0.18, [], { tint: body });
        continue;
      }
      const glassFront = spec.kind === "clinic" || spec.kind === "salon" || spec.kind === "bakery";
      wall(b, "plaster", cx - UW / 2, cx + UW / 2, F0 + 3.0, F0 + H0, front, 0.18, [], { tint: body });
      if (glassFront) {
        // Shopfront glazing either side of a door gap.
        for (const s of [-1, 1]) {
          const gx = cx + s * (fw / 2 - 0.9);
          b.box("walltile", gx, F0 + 0.3, front, 1.8, 0.6, 0.16, { tint: 0x8f968f });
          b.box("glass", gx, F0 + 1.75, front, 1.8, 2.3, 0.03, { tint: 0x9fb4b8 });
          b.box("trim", gx, F0 + 2.95, front, 1.86, 0.08, 0.08, { tint: 0x3a3c3d });
          for (const e of [-0.9, 0.9]) b.box("trim", gx + e, F0 + 1.75, front, 0.06, 2.4, 0.08, { tint: 0x3a3c3d });
        }
      } else shutter(b, cx, F0, front, fw, 2.9, 1, 0x9aa0a4, 0.88);
      tube(ctx, b, W, cx, F0 + H0, -3.6, false, 1.2, 8);
      // ---- interiors ----
      if (spec.kind === "mart" || spec.kind === "hardware") {
        const cols = spec.kind === "mart" ? [0xc8402a, 0xe0b030, 0x2f7a4a, 0x2f5f9a, 0xe8e4d8, 0xd06a28] : [0x555a5e, 0x8a6a3a, 0x3a3c3d, 0xb0721e, 0x6a7074];
        for (const sx of [-1.7, 0, 1.7]) {
          for (const sz of [-2.2, -5.2]) {
            b.box("paintmetal", cx + sx, F0 + 0.85, sz, sx === 0 ? 0.7 : 0.42, 1.7, 2.3, { tint: 0xd8d8d2 });
            for (let lv = 0; lv < 4; lv++) for (let k = 0; k < 6; k++) {
              const col = cols[(lv * 5 + k * 3 + i) % cols.length];
              for (const side of sx === 0 ? [-1, 1] : [sx < 0 ? 1 : -1]) b.box("plastic", cx + sx + side * (sx === 0 ? 0.3 : 0.16), F0 + 0.28 + lv * 0.42, sz - 0.95 + k * 0.38, 0.14, 0.28, 0.32, { tint: col, collide: "none" });
            }
          }
        }
        b.box("wood", cx + 1.6, F0 + 0.5, -0.8, 1.6, 1.0, 0.6, { tint: 0x8a7a66 });
        // Goods spilling onto the walkway.
        P.crate(b, cx - 1.9, F0, 1.1, 0.1, 0.55, 0.45, 0x9a8a60);
        P.crate(b, cx - 1.3, F0, 1.0, -0.2, 0.55, 0.45, 0x9a8a60);
        b.box("plastic", cx - 1.6, F0 + 0.6, 1.05, 0.5, 0.3, 0.4, { tint: 0x2f5f9a, collide: "none" });
      } else if (spec.kind === "kopitiam") {
        for (const [tx, tz] of [[-1.5, -1.6], [1.3, -2.4], [-1.2, -4.6], [1.5, -5.4]]) kopiTable(b, cx + tx, F0, tz);
        kopiTable(b, cx - 1.2, F0, 1.9);
        b.box("walltile", cx, F0 + 0.55, -7.0, UW - 0.6, 1.1, 0.7, { tint: 0xd8dcd6 });
        b.box("steel", cx, F0 + 1.12, -7.0, UW - 0.5, 0.04, 0.8, { tint: 0xc0c4c6, collide: "none" });
        b.box("glass", cx - 1, F0 + 1.45, -6.75, 1.6, 0.6, 0.5, { tint: 0xb8c8c8, collide: "none" });
      } else if (spec.kind === "clinic") {
        b.box("wood", cx + 1.2, F0 + 0.55, -3.4, 2.2, 1.1, 0.6, { tint: 0xd8d4c8 });
        for (let k = 0; k < 4; k++) b.box("plastic", cx - 2.2, F0 + 0.45, -0.9 - k * 0.62, 0.5, 0.06, 0.5, { tint: 0x2f6f9a });
        for (let k = 0; k < 4; k++) b.box("plastic", cx - 2.42, F0 + 0.72, -0.9 - k * 0.62, 0.05, 0.5, 0.5, { tint: 0x2f6f9a, collide: "none" });
        wall(b, "plaster", cx - UW / 2 + 0.1, cx + UW / 2 - 0.1, F0, F0 + H0, -4.4, 0.12, [{ x: cx - 1.4, w: 1.5, y: F0, h: 2.2 }], { tint: 0xeef0ec });
      } else if (spec.kind === "salon") {
        for (const k of [0, 1, 2]) {
          b.box("wood", cx - 2.45, F0 + 0.8, -1.2 - k * 1.7, 0.3, 0.06, 1.2, { tint: 0x2a2a2e });
          b.box("glass", cx - 2.66, F0 + 1.6, -1.2 - k * 1.7, 0.02, 1.1, 1.0, { tint: 0xc8d4d8, collide: "none" });
          b.cyl("plastic", cx - 1.5, F0 + 0.3, -1.2 - k * 1.7, 0.3, 0.6, 10, { tint: 0x1d1d20 });
          b.box("plastic", cx - 1.5, F0 + 0.95, -0.95 - k * 1.7, 0.5, 0.7, 0.1, { tint: 0x1d1d20, collide: "none" });
        }
      } else if (spec.kind === "bakery") {
        b.box("wood", cx, F0 + 0.5, -2.6, UW - 1.6, 1.0, 0.7, { tint: 0x7a5a3a });
        b.box("glass", cx, F0 + 1.25, -2.6, UW - 1.7, 0.5, 0.6, { tint: 0xc8d0cc, collide: "none" });
        for (let k = 0; k < 3; k++) b.box("paintmetal", cx + 2.3, F0 + 0.6 + k * 0.5, -5, 0.5, 0.04, 2.6, { tint: 0xc8c8c4, collide: k ? "none" : "solid" });
      }
    }

    // Upper storeys: flats over the shops.
    for (let k = 0; k < 2; k++) {
      const y = F0 + H0 + 0.25 + k * H;
      const openingsF = [], openingsB = [];
      for (let i = 0; i < n; i++) {
        const cx = x0 + (i + 0.5) * UW;
        openingsF.push({ x: cx - 1.3, w: 1.8, y: y + 1.0, h: 1.25 }, { x: cx + 1.5, w: 1.2, y: y + 1.0, h: 1.25 });
        openingsB.push({ x: cx, w: 2.4, y: y + 1.0, h: 1.25 });
      }
      wall(b, "paint", x0 - 0.1, x0 + L + 0.1, y, y + H - 0.25, walk + 0.2, 0.2, openingsF, { tint: body });
      wall(b, "paint", x0 - 0.1, x0 + L + 0.1, y, y + H - 0.25, back, 0.2, openingsB, { tint: body });
      for (const sx of [x0 - 0.1, x0 + L - 0.1]) b.slab("paint", sx, y, back, 0.2, H - 0.25, walk - back + 0.3, { tint: k ? o.accent : body });
      b.slab("concrete", x0 - 0.3, y + H - 0.25, back - 0.3, L + 0.6, 0.25, walk - back + 0.9, { tint: 0xd8d4c8 });
      b.box("paint", 0, y + 0.45, walk + 0.34, L + 0.5, 0.12, 0.1, { tint: o.accent, collide: "none" });
      for (let i = 0; i < n; i++) {
        const cx = x0 + (i + 0.5) * UW;
        const cur = [0xd8cfae, 0x8fa6b0, 0x2a3236, 0xc7b79a][(i + k * 3) % 4];
        win(b, cx - 1.3, y + 1.0, walk + 0.3, 1.8, 1.25, 1, { glass: cur, detail: 1 });
        win(b, cx + 1.5, y + 1.0, walk + 0.3, 1.2, 1.25, 1, { glass: 0x1c2a2e, detail: 1, style: "louvre" });
        win(b, cx, y + 1.0, back - 0.1, 2.4, 1.25, -1, { glass: cur, detail: 1 });
        if ((i + k) % 2 === 0) airconUnit(b, cx + 0.2, y + 0.2, walk + 0.3, 1);
        // Bamboo-pole laundry under the front windows.
        if ((i * 7 + k * 3) % 3 === 0) {
          b.cyl("wood", cx - 1.3, y + 0.85, walk + 1.3, 0.016, 2.2, 5, { axis: "z", tint: 0xc8b070, collide: "none" });
          for (let c = 0; c < 4; c++) b.box("canvas", cx - 1.3, y + 0.55, walk + 0.6 + c * 0.42, 0.02, 0.55, 0.34, { tint: [0xd8d4c8, 0x4a6a9a, 0xb0403a, 0x3a3a3e][c], collide: "none" });
        }
      }
    }
    // Roof parapet and plant.
    b.slab("paint", x0 - 0.3, roofY, back - 0.3, L + 0.6, 0.7, 0.18, { tint: body });
    b.slab("paint", x0 - 0.3, roofY, walk + 0.42, L + 0.6, 0.7, 0.18, { tint: o.accent });
    for (const sx of [x0 - 0.3, x0 + L + 0.12]) b.slab("paint", sx, roofY, back - 0.3, 0.18, 0.7, walk - back + 0.9, { tint: body });
    b.box("paintmetal", x0 + 4, roofY + 0.9, -3, 2.4, 1.8, 2.4, { tint: 0x8f9494 });
  });
  ctx.commit(b);
}

/** Kopitiam table: marble-look round top on a pedestal, four fixed stools. */
export function kopiTable(b: Builder, x: number, y: number, z: number, tint = 0xd9d5c8): void {
  b.cyl("plastic", x, y + 0.74, z, 0.52, 0.04, 14, { tint });
  b.cyl("steel", x, y + 0.37, z, 0.045, 0.72, 6, { tint: 0x8a8d8f, collide: "none" });
  b.cyl("steel", x, y + 0.02, z, 0.26, 0.03, 10, { tint: 0x8a8d8f, collide: "none" });
  b.collisionBox(Surf.Plastic, "solid", x, y + 0.38, z, 0.9, 0.76, 0.9);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.78;
    const sx = x + Math.cos(a) * 0.82, sz = z + Math.sin(a) * 0.82;
    b.cyl("plastic", sx, y + 0.44, sz, 0.17, 0.04, 10, { tint: [0xc8402a, 0x2f6f9a, 0xe0b030, 0x2f7a4a][i], collide: "none" });
    b.cyl("steel", sx, y + 0.22, sz, 0.03, 0.44, 5, { tint: 0x8a8d8f, collide: "none" });
  }
}

// ---------------------------------------------------------------------------------
// Hawker centre
// ---------------------------------------------------------------------------------

const STALLS: Array<[string, string, string]> = [
  ["AH HENG CHICKEN RICE", "#b3261e", "#fff3c4"],
  ["NASI LEMAK  ·  MEE REBUS", "#1c5a3a", "#f5f0d0"],
  ["FISHBALL NOODLE", "#f0c020", "#7a1a12"],
  ["ROTI PRATA  ·  MURTABAK", "#e8e4d8", "#7a3a12"],
  ["KOPI  ·  TEH  ·  COLD DRINKS", "#2a4a8a", "#f2f2ea"],
  ["ECONOMY RICE", "#d8521e", "#fff8e0"],
  ["CHAR KWAY TEOW", "#3a2a1e", "#f0c020"],
  ["SATAY BEE HOON", "#7a1a12", "#f5e8c0"],
  ["WANTON MEE", "#f2ead0", "#b3261e"],
  ["FRUIT JUICE  ·  DESSERT", "#2f7a4a", "#fffbe0"],
];

/** Open-sided hawker centre, 38 × 26 m: stalls along the back and east end, fixed seating under a big pitched roof. */
export function hawkerCentre(ctx: WorldCtx, o: { x: number; z: number; yaw: number; cache: [number, number] }): void {
  const b = ctx.builder("hawker");
  const W = placer(o.x, o.z, o.yaw);
  const HX = 19, HZ = 13, eave = 4.3, ridge = 7.2;
  b.at(o.x, 0, o.z, o.yaw, () => {
    b.slab("floortile", -HX, F0 - 0.3, -HZ, HX * 2, 0.3, HZ * 2, { tint: 0xb8b2a2, skip: "-y" });
    // Columns on a 7.6 × 8.67 grid.
    for (let i = 0; i <= 5; i++) for (let j = 0; j <= 3; j++) {
      const cx = -HX + 0.5 + i * ((HX * 2 - 1) / 5), cz = -HZ + 0.5 + j * ((HZ * 2 - 1) / 3);
      if (j === 0 && i > 0 && i < 5) continue;
      b.box("paint", cx, F0 + eave / 2, cz, 0.5, eave, 0.5, { tint: 0xe9e3d0 });
      b.box("walltile", cx, F0 + 0.6, cz, 0.52, 1.2, 0.52, { tint: 0x4a7a6a, collide: "none" });
    }
    // Roof: two pitched planes with a raised vented ridge. Profile lies in (z, y), extruded along x.
    b.at(0, 0, 0, Math.PI / 2, () => {
      const e = F0 + eave, rd = F0 + ridge;
      b.prism("rooftile", [[-HZ - 1.6, e - 0.1], [-HZ - 1.6, e - 0.3], [-1.6, rd - 0.5], [-1.6, rd - 0.3]], -HX - 1.2, HX + 1.2, { tint: 0xa8553a });
      b.prism("rooftile", [[1.6, rd - 0.3], [1.6, rd - 0.5], [HZ + 1.6, e - 0.3], [HZ + 1.6, e - 0.1]], -HX - 1.2, HX + 1.2, { tint: 0xa8553a });
      // Light metal soffit under both planes, so the underside bounces light like a real hawker roof.
      b.prism("ribmetal", [[-HZ - 1.5, e - 0.36], [-HZ - 1.5, e - 0.4], [-1.6, rd - 0.6], [-1.6, rd - 0.56]], -HX - 1.1, HX + 1.1, { tint: 0xf2eee2, collide: "none" });
      b.prism("ribmetal", [[1.6, rd - 0.56], [1.6, rd - 0.6], [HZ + 1.5, e - 0.4], [HZ + 1.5, e - 0.36]], -HX - 1.1, HX + 1.1, { tint: 0xf2eee2, collide: "none" });
      b.prism("rooftile", [[-2.6, rd + 0.55], [-2.6, rd + 0.4], [0, rd + 1.05], [2.6, rd + 0.4], [2.6, rd + 0.55], [0, rd + 1.25]], -HX - 0.6, HX + 0.6, { tint: 0x98492f });
      for (const s of [-1, 1]) b.slab("ribmetal", s > 0 ? 1.55 : -1.65, rd - 0.35, -HX, 0.1, 0.85, HX * 2, { tint: 0xd8d4c4, collide: "none" });
    });
    // Trusses, purlins, fans and lights.
    for (let i = 0; i <= 5; i++) {
      const cx = -HX + 0.5 + i * ((HX * 2 - 1) / 5);
      b.box("paintmetal", cx, F0 + eave + 0.05, 0, 0.14, 0.24, HZ * 2, { tint: 0xe2ded0, collide: "none" });
      for (const s of [-1, 1]) {
        const m = new THREE.Matrix4().makeRotationX(s * Math.atan2(ridge - eave - 0.45, HZ)).setPosition(cx, F0 + (eave + ridge) / 2 - 0.3, s * (HZ / 2 + 0.6));
        b.push(m);
        b.box("paintmetal", 0, 0, 0, 0.12, 0.2, HZ + 1.6, { tint: 0xe2ded0, collide: "none" });
        b.pop();
      }
      b.box("paintmetal", cx, F0 + (eave + ridge) / 2, 0, 0.1, ridge - eave - 0.5, 0.1, { tint: 0xe2ded0, collide: "none" });
    }
    for (let i = 0; i < 5; i++) for (const cz of [-4.4, 4.4]) {
      const cx = -HX + 0.5 + (i + 0.5) * ((HX * 2 - 1) / 5);
      // Ceiling fan.
      b.cyl("steel", cx, F0 + eave + 0.2, cz, 0.02, 1.3, 5, { tint: 0xd0d0cc, collide: "none" });
      b.cyl("paintmetal", cx, F0 + eave - 0.45, cz, 0.12, 0.14, 8, { tint: 0xd8d8d2, collide: "none" });
      // The blades are a separate mesh so the fans actually turn.
      const fan = new THREE.Mesh(FAN_BLADES, (fanMat ??= ctx.engine.lit(new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.5, metalness: 0.3 }))));
      fan.position.set(...W(cx, F0 + eave - 0.47, cz));
      ctx.root.add(fan);
      const speed = 5.5 + ((i * 7 + (cz > 0 ? 3 : 0)) % 5) * 0.6;
      ctx.anim.push((t) => {
        fan.rotation.y = t * speed;
      });
      tube(ctx, b, W, cx - 1.8, F0 + eave, cz, true, 1.4, 10);
    }

    // Stalls along the back (north side) and the east end.
    const stall = (sx: number, sz: number, yaw: number, idx: number): void => {
      const [name, bg, fg] = STALLS[idx % STALLS.length];
      const sign = ctx.signs.text(`stall:${name}`, 512, 128, bg, fg, [[name, name.length > 18 ? 38 : 46], [`#01-${String(11 + idx).padStart(2, "0")}`, 22]]);
      const w0 = W(sx, 0, sz);
      const WS = placer(w0[0], w0[2], o.yaw + yaw);
      b.at(sx, 0, sz, yaw, () => {
        const w = 3.7, d = 3.2;
        // Side and back walls, tiled inside.
        b.slab("walltile", -w / 2, F0, -d, 0.12, 2.9, d, { tint: 0xe8ece8 });
        b.slab("walltile", w / 2 - 0.12, F0, -d, 0.12, 2.9, d, { tint: 0xe8ece8 });
        b.slab("walltile", -w / 2, F0, -d, w, 2.9, 0.12, { tint: 0xe8ece8 });
        b.slab("concrete", -w / 2, F0 + 2.9, -d, w, 0.12, d + 0.3, { tint: 0xd8d4c8 });
        // Counter with glass display and steel top.
        b.box("walltile", 0, F0 + 0.5, -0.3, w - 0.24, 1.0, 0.6, { tint: [0x4a7a6a, 0xd8dcd6, 0x2f5f8a, 0xc8402a][idx % 4] });
        b.box("steel", 0, F0 + 1.03, -0.3, w - 0.2, 0.05, 0.68, { tint: 0xc8ccce, collide: "none" });
        b.box("glass", -0.7, F0 + 1.4, -0.12, 1.8, 0.7, 0.03, { tint: 0xb8c8c8, collide: "none" });
        b.box("steel", -0.7, F0 + 1.77, -0.3, 1.8, 0.03, 0.4, { tint: 0xc8ccce, collide: "none" });
        // Cooking range, hood, shelves, gas cylinders.
        b.box("steel", 0.3, F0 + 0.45, -d + 0.5, 2.2, 0.9, 0.7, { tint: 0xb8bcbe });
        b.box("steel", 0.3, F0 + 2.3, -d + 0.55, 2.3, 0.5, 0.8, { tint: 0xa8acae, collide: "none" });
        for (const px of [-0.2, 0.7]) b.cyl("steel", px, F0 + 0.98, -d + 0.5, 0.2, 0.16, 10, { tint: 0x6a6c6e, collide: "none" });
        b.cyl("paintmetal", -1.5, F0 + 0.3, -d + 0.4, 0.15, 0.6, 9, { tint: 0x5a7a9a, collide: "none" });
        b.box("paintmetal", -1.3, F0 + 1.7, -d + 0.2, 0.9, 0.03, 0.3, { tint: 0xd0d0cc, collide: "none" });
        for (let k = 0; k < 4; k++) b.cyl("plastic", -1.6 + k * 0.2, F0 + 1.8, -d + 0.2, 0.07, 0.16, 6, { tint: [0xc8402a, 0xe0b030, 0x2f7a4a, 0xe8e4d8][k], collide: "none" });
        signQuad(b, sign, 0, F0 + 2.62, 0.32, w - 0.2, 0.62, 0, true);
        b.box("paintmetal", 0, F0 + 2.62, 0.26, w, 0.72, 0.1, { tint: 0x2a2c2e, collide: "none" });
        tube(ctx, b, WS, 0, F0 + 2.9, -1.4, true, 1.0, 6);
        // Menu board and a stack of trays.
        b.box("plastic", 1.3, F0 + 1.1, -0.28, 0.4, 0.14, 0.3, { tint: 0x8a5a2a, collide: "none" });
      });
    };
    for (let i = 0; i < 8; i++) stall(-HX + 2.6 + i * 3.9, -HZ + 3.3, 0, i);
    for (let i = 0; i < 2; i++) stall(HX - 3.3, -3.6 + i * 3.9 + 3.9, -Math.PI / 2, 8 + i);

    // Seating: fixed tables everywhere except a cleared space around the cache.
    const [kx, kz] = o.cache;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 5; j++) {
      const tx = -HX + 3.4 + i * 3.4, tz = -HZ + 7.6 + j * 3.6;
      if (Math.hypot(tx - kx, tz - kz) < 4.6 || tx > HX - 7.5) continue;
      kopiTable(b, tx, F0, tz, (i + j) % 3 ? 0xd9d5c8 : 0xc7c0ae);
    }
    P.weaponsCache(b, ctx.rand, kx, F0, kz, 0.2);
    P.sandbags(b, ctx.rand, kx, kz + 3.2, 0, 4.4, 4, F0);
    P.sandbags(b, ctx.rand, kx - 3.4, kz + 0.4, Math.PI / 2, 3.2, 4, F0);
    P.crate(b, kx + 2.9, F0, kz + 1.2, 0.3, 1.0, 1.0);
    P.crate(b, kx + 3.0, F0, kz - 0.1, -0.1, 0.9, 0.8);
    // Tray return, bins, wash point, perimeter planters with gaps to walk through.
    b.box("steel", -HX + 1.2, F0 + 0.9, 6, 0.7, 1.8, 2.2, { tint: 0xb8bcbe });
    P.wheelieBin(b, -HX + 1.3, 9.6, Math.PI / 2, F0);
    P.wheelieBin(b, HX - 1.4, 10.6, Math.PI / 2, F0, 0x2a5a8a);
    for (const px of [-13, -4.5, 4.5, 13]) P.planter(b, px, HZ + 0.9, 0, 5, 0);
    for (const pz of [-3, 6]) P.planter(b, -HX - 0.9, pz, Math.PI / 2, 5, 0);
    // Name board on the south fascia.
    const name = ctx.signs.text("hawker:name", 1024, 128, "#f2ead0", "#7a1a12", [["YISHUN ST 41 MARKET & FOOD CENTRE", 62]], { border: "#7a1a12" });
    signQuad(b, name, 0, F0 + eave - 0.45, HZ + 0.02, 14, 1.0, 0);
    b.box("paint", 0, F0 + eave - 0.4, HZ - 0.2, HX * 2, 0.9, 0.3, { tint: 0xe9e3d0, collide: "none" });
    b.box("paint", 0, F0 + eave - 0.4, -HZ + 0.2, HX * 2, 0.9, 0.3, { tint: 0xe9e3d0, collide: "none" });
  });
  ctx.commit(b);
}

// ---------------------------------------------------------------------------------
// Multi-storey carpark
// ---------------------------------------------------------------------------------

/** Four-deck carpark, 48 × 30 m, with a walkable ramp bay on the +Z side. */
export function carpark(ctx: WorldCtx, o: { x: number; z: number; yaw: number; number: string }): void {
  const b = ctx.builder("mscp");
  const m = ctx.builder("mscp-paint");
  const W = placer(o.x, o.z, o.yaw);
  const HX = 24, HZ = 15, DH = 3.0, decks = 4, rampW = 5.2;
  const cols = [0xc23a2a, 0x2a2c30, 0xd8d8d4, 0x9a9da0, 0x1f3a6a, 0x8a8f94, 0xb8b0a0, 0x3a5a44];
  const work = (bb: Builder, fn: () => void): void => bb.at(o.x, 0, o.z, o.yaw, fn);
  work(b, () => {
    for (let k = 0; k < decks; k++) {
      const y = k === 0 ? F0 : k * DH;
      // Deck slab (ground is a screed pad laid by the estate plan).
      if (k > 0) b.slab("concrete", -HX, y - 0.32, -HZ, HX * 2, 0.32, HZ * 2, { tint: 0xbdb9ae });
      // Columns.
      for (let i = 0; i <= 6; i++) for (const cz of [-HZ + 0.4, -5, 5, HZ - 0.4]) {
        const cx = -HX + 0.4 + i * ((HX * 2 - 0.8) / 6);
        b.box("concrete", cx, y + (DH - 0.32) / 2, cz, 0.6, DH - 0.32, 0.6, { tint: 0xc9c5ba });
        b.box("trim", cx, y + 0.6, cz, 0.62, 1.2, 0.62, { tint: k % 2 ? 0xd8a020 : 0x2a2c2e });
      }
      // Parapets: solid upstand with a painted band; openings at ground for vehicles and people.
      const band = [0x3f7a78, 0xe6dfcc, 0x3f7a78, 0xe6dfcc][k];
      const par = (x0: number, x1: number, z: number): void => {
        b.slab("paint", x0, y, z - 0.09, x1 - x0, 1.15, 0.18, { tint: 0xe6dfcc });
        b.slab("paint", x0, y + 0.75, z + (z > 0 ? 0.09 : -0.14), x1 - x0, 0.3, 0.05, { tint: band, collide: "none" });
      };
      if (k === 0) {
        // North side closed except two pedestrian gaps; south side has the vehicle entrance (centre) and gaps.
        // North side open at the west end (ramp approach); south side has the vehicle entrance and two gaps.
        par(-10, HX, -HZ);
        par(-HX, -16, HZ); par(-13.6, -4.2, HZ); par(4.2, 13.6, HZ);
      } else {
        // Gap where the ramp landing meets this deck.
        const d = (k - 1) % 2 ? -1 : 1;
        if (d > 0) { par(-HX, 14, -HZ); par(20, HX, -HZ); } else { par(-HX, -20, -HZ); par(-14, HX, -HZ); }
        par(-HX, HX, HZ);
      }
      for (const sx of [-HX, HX]) {
        if (k === 0) {
          b.slab("paint", sx - 0.09, y, -HZ, 0.18, 1.15, 11, { tint: 0xe6dfcc });
          b.slab("paint", sx - 0.09, y, -HZ + 13, 0.18, 1.15, HZ * 2 - 13, { tint: 0xe6dfcc });
        } else b.slab("paint", sx - 0.09, y, -HZ, 0.18, 1.15, HZ * 2, { tint: 0xe6dfcc });
      }
      // Vertical fins on the long facades.
      if (k > 0) for (let i = 0; i < 12; i++) {
        const fx = -HX + 2 + i * 4;
        b.box("paint", fx, y + 1.9, -HZ - 0.2, 0.14, DH - 1.4, 0.5, { tint: i % 3 ? 0xe6dfcc : 0x3f7a78, collide: "none" });
      }
      // Lights and bay furniture.
      for (let i = 0; i < 6; i++) for (const cz of [-10, 0, 10]) {
        const cx = -HX + 4.4 + i * 7.87;
        if ((i + (cz > 0 ? 1 : 0)) % 2) tube(ctx, b, W, cx, y + DH - 0.34, cz, false, k === 0 ? 1.3 : 0.8, 11);
      }
      // Parked cars: rows nose-in along both long sides, sparse.
      for (let i = 0; i < 16; i++) for (const side of [-1, 1]) {
        const cx = -HX + 3.2 + i * 2.8;
        const seed = (i * 7 + k * 13 + (side > 0 ? 5 : 0)) % 11;
        if (side > 0 && Math.abs(cx) < 5 && k === 0) continue;
        if (seed > (k === 0 ? 3 : k === 3 ? 1 : 4)) continue;
        const kind = (["sedan", "hatch", "suv", "sedan", "taxi", "van"] as const)[seed % 6];
        P.car(b, ctx.rand, cx, side * (HZ - 3.2), side > 0 ? Math.PI : 0, { color: kind === "taxi" ? 0x2a5a9a : cols[(i + k * 3) % cols.length], kind, wreck: k === 0 && seed === 2 }, y);
      }
    }
    // Roof-deck stair core, lift shaft and signage.
    for (const sx of [-1, 1]) {
      b.slab("paint", sx * (HX + 1.6) - 1.6, F0, -4, 3.2, decks * DH + 2.4, 5.2, { tint: 0xe6dfcc });
      b.slab("paint", sx * (HX + 1.6) - 1.7, decks * DH + 2.4, -4.1, 3.4, 0.2, 5.4, { tint: 0x3f7a78 });
      door(b, sx * (HX + 1.6), F0, 1.25, 1.1, 2.1, 1, 0x7a8a8a);
      const num = ctx.signs.text(`mscp:${o.number}:${sx}`, 256, 256, "#3f7a78", "#f4f0e2", [[o.number, 110]]);
      signQuad(b, num, sx * (HX + 3.22), decks * DH - 0.6, -1.4, 2.6, 2.6, (sx * Math.PI) / 2);
    }
    const sign = ctx.signs.text("mscp:name", 1024, 128, "#1c3a5a", "#f4f0e2", [[`MULTI-STOREY CAR PARK  ·  BLK ${o.number}`, 60]]);
    signQuad(b, sign, 0, F0 + 2.55, HZ + 0.14, 8.2, 0.9, 0);
    b.box("paint", 0, F0 + 2.55, HZ, 8.4, 1.0, 0.2, { tint: 0x1c3a5a });
    // Height-limit bar over the entrance.
    b.cyl("steel", 0, F0 + 2.1, HZ + 1.6, 0.05, 8, 6, { axis: "x", tint: 0xe0b030, collide: "none" });
    for (const sx of [-4, 4]) b.cyl("steel", sx, F0 + 2.3, HZ + 1.6, 0.012, 0.4, 4, { tint: 0x55595c, collide: "none" });

    // Ramp bay on the north side: one straight flight per level, alternating direction, walkable.
    const rz = -HZ - rampW / 2 - 0.1;
    for (let k = 0; k < decks - 1; k++) {
      const y0 = k === 0 ? F0 : k * DH, y1 = (k + 1) * DH;
      const dir = k % 2 ? -1 : 1;
      const xa = -dir * 14, xb = dir * 14;
      const len = Math.hypot(28, y1 - y0);
      const mm = new THREE.Matrix4().makeRotationZ(Math.atan2(y1 - y0, xb - xa)).setPosition((xa + xb) / 2, (y0 + y1) / 2 - 0.16, rz);
      b.push(mm);
      b.box("concrete", 0, 0, 0, len, 0.3, rampW, { tint: 0xb4b0a6, collide: "none" });
      b.pop();
      b.collisionQuad(Surf.Concrete, "solid", [xa, y0, rz + rampW / 2], [xb, y1, rz + rampW / 2], [xb, y1, rz - rampW / 2], [xa, y0, rz - rampW / 2]);
      // Landings joining the ramp to the decks at each end.
      b.slab("concrete", xb + (dir > 0 ? 0 : -6), y1 - 0.3, rz - rampW / 2, 6, 0.3, rampW + 0.2, { tint: 0xbdb9ae });
      // Outer kerb wall following the slope.
      const wm = new THREE.Matrix4().makeRotationZ(Math.atan2(y1 - y0, xb - xa)).setPosition((xa + xb) / 2, (y0 + y1) / 2 + 0.45, rz - rampW / 2);
      b.push(wm);
      b.box("paint", 0, 0, 0, len, 1.1, 0.16, { tint: 0xe6dfcc });
      b.pop();
    }
    for (const sx of [-HX + 2, HX - 2]) for (let k = 0; k < decks; k++) b.box("concrete", sx, k * DH + DH / 2, rz - rampW / 2, 0.5, DH, 0.5, { tint: 0xc9c5ba });
    // Mortar pit on the ground deck near the east opening.
    b.at(15, F0, -2, 0.4, () => {
      b.cyl("steel", 0, 0.02, 0, 0.3, 0.04, 10, { tint: 0x2a2c26 });
      const mt = new THREE.Matrix4().makeRotationZ(0.42).setPosition(-0.22, 0.55, 0);
      b.push(mt);
      b.cyl("steel", 0, 0, 0, 0.05, 1.25, 8, { tint: 0x2f3329, collide: "none" });
      b.pop();
      for (const s of [-1, 1]) {
        const lg = new THREE.Matrix4().makeRotationZ(-0.5).multiply(new THREE.Matrix4().makeRotationX(s * 0.3)).setPosition(-0.75, 0.42, s * 0.2);
        b.push(lg);
        b.cyl("steel", 0, 0, 0, 0.015, 0.95, 5, { tint: 0x2f3329, collide: "none" });
        b.pop();
      }
      for (let i = 0; i < 4; i++) P.ammoBox(b, 0.9 + (i % 2) * 0.55, Math.floor(i / 2) * 0.21, 0.6, 0.1 * i, 1.1);
      P.crate(b, 1.1, 0, -0.7, 0.2, 0.8, 0.6, 0x5c6440);
    });
    P.sandbags(b, ctx.rand, 11.5, -2, Math.PI / 2 + 0.1, 3.6, 4, F0);
    P.sandbags(b, ctx.rand, -9, 2, Math.PI / 2, 3.6, 4, F0);
    P.sandbags(b, ctx.rand, 0, 8.5, 0, 4.2, 4, F0);
  });
  // Bay lines on every deck.
  work(m, () => {
    for (let k = 0; k < decks; k++) {
      const y = (k === 0 ? F0 : k * DH) + 0.012;
      for (let i = 0; i <= 16; i++) for (const side of [-1, 1]) {
        const cx = -HX + 1.8 + i * 2.8;
        const za = Math.max(side * (HZ - 0.8), side * (HZ - 5.6)), zb = Math.min(side * (HZ - 0.8), side * (HZ - 5.6));
        m.quad("roadpaint", [cx - 0.05, y, za], [cx + 0.05, y, za], [cx + 0.05, y, zb], [cx - 0.05, y, zb], { tint: 0xe9e7df, collide: "none" });
      }
    }
  });
  ctx.commit(b);
  ctx.commit(m);
}

// ---------------------------------------------------------------------------------
// Community club
// ---------------------------------------------------------------------------------

/** Two-storey community club, 36 × 22 m. Lobby in the middle, hall to the west (the command post), offices east. */
export function communityClub(ctx: WorldCtx, o: { x: number; z: number; yaw: number; intel: [number, number] }): void {
  const b = ctx.builder("cc");
  const W = placer(o.x, o.z, o.yaw);
  const HX = 18, HZ = 11, H0 = 4.4, H1 = 3.8;
  const body = 0xeeeae0, accent = 0xb3261e, grey = 0x5a6064;
  const y1 = F0 + H0;
  b.at(o.x, 0, o.z, o.yaw, () => {
    b.slab("floortile", -HX, F0 - 0.3, -HZ, HX * 2, 0.3, HZ * 2, { tint: 0xd0cabb, skip: "-y" });
    // ---- ground floor shell: front (+Z), back, sides ----
    wall(b, "paint", -HX, HX, F0, y1, HZ, 0.3, [
      { x: 0, w: 5.2, y: F0, h: 3.0 }, // main entrance
      { x: -11, w: 5.4, y: F0 + 1.0, h: 2.2 }, { x: 11.5, w: 6.4, y: F0 + 1.0, h: 2.2 },
    ], { tint: body });
    wall(b, "paint", -HX, HX, F0, y1, -HZ, 0.3, [{ x: -11, w: 2.0, y: F0, h: 2.4 }, { x: 4, w: 1.6, y: F0, h: 2.3 }, { x: 12, w: 4, y: F0 + 1.2, h: 1.6 }], { tint: body });
    b.at(0, 0, 0, Math.PI / 2, () => {
      wall(b, "paint", -HZ, HZ, F0, y1, -HX, 0.3, [{ x: 2, w: 2.2, y: F0, h: 2.4 }, { x: -5, w: 4, y: F0 + 1.2, h: 1.8 }], { tint: body });
      wall(b, "paint", -HZ, HZ, F0, y1, HX, 0.3, [{ x: 4, w: 3, y: F0 + 1.2, h: 1.8 }, { x: -4, w: 3, y: F0 + 1.2, h: 1.8 }], { tint: body });
      // Interior partitions: hall | lobby | offices.
      wall(b, "plaster", -HZ, HZ, F0, y1, -4.2, 0.2, [{ x: 4, w: 2.6, y: F0, h: 2.5 }, { x: -6, w: 1.6, y: F0, h: 2.3 }], { tint: 0xf0ede4 });
      wall(b, "plaster", -HZ, HZ, F0, y1, 5.2, 0.2, [{ x: 5, w: 1.6, y: F0, h: 2.3 }, { x: -5, w: 1.6, y: F0, h: 2.3 }], { tint: 0xf0ede4 });
    });
    wall(b, "plaster", 5.2, HX, F0, y1, 0, 0.2, [{ x: 9, w: 1.5, y: F0, h: 2.3 }], { tint: 0xf0ede4 });
    // Windows in the openings.
    win(b, -11, F0 + 1.0, HZ + 0.14, 5.4, 2.2, 1, { glass: 0x33474c, frame: 0x3a3c3d });
    win(b, 11.5, F0 + 1.0, HZ + 0.14, 6.4, 2.2, 1, { glass: 0x33474c, frame: 0x3a3c3d });
    win(b, 12, F0 + 1.2, -HZ - 0.14, 4, 1.6, -1, { glass: 0x2a3a3e, frame: 0x3a3c3d });
    // Entrance: glazed side-lights, doors standing open.
    for (const s of [-1, 1]) {
      b.box("trim", s * 2.6, F0 + 1.5, HZ, 0.1, 3.0, 0.14, { tint: 0x3a3c3d });
      b.at(s * 2.55, F0, HZ + 0.1, s * 1.35, () => b.box("glass", s * -0.6, 1.25, 0, 1.2, 2.5, 0.04, { tint: 0x9fb4b8 }));
    }
    // First-floor slab, with a double-height void over the lobby front.
    b.slab("concrete", -HX, y1, -HZ, HX * 2, 0.3, HZ * 2, { tint: 0xd8d4c8 });
    // ---- upper storey: ribbon windows behind vertical sun-fins ----
    const y2 = y1 + 0.3;
    const ribbon = [];
    for (let i = -3; i <= 3; i++) ribbon.push({ x: i * 4.9, w: 4.0, y: y2 + 1.0, h: 1.7 });
    wall(b, "paint", -HX, HX, y2, y2 + H1, HZ, 0.3, ribbon, { tint: body });
    wall(b, "paint", -HX, HX, y2, y2 + H1, -HZ, 0.3, ribbon, { tint: body });
    for (const r of ribbon) {
      win(b, r.x, r.y, HZ + 0.14, r.w, r.h, 1, { glass: 0x2c3c40, frame: 0x3a3c3d });
      win(b, r.x, r.y, -HZ - 0.14, r.w, r.h, -1, { glass: 0x2c3c40, frame: 0x3a3c3d });
    }
    for (let i = 0; i < 30; i++) b.box("paintmetal", -HX + 0.6 + i * 1.2, y2 + 1.85, HZ + 0.5, 0.08, 2.3, 0.5, { tint: i % 5 === 0 ? accent : 0xd8d4c8, collide: "none" });
    for (const sx of [-HX, HX - 0.3]) b.slab("paint", sx, y2, -HZ, 0.3, H1, HZ * 2, { tint: sx < 0 ? accent : body });
    b.slab("concrete", -HX - 0.5, y2 + H1, -HZ - 0.5, HX * 2 + 1, 0.35, HZ * 2 + 1, { tint: 0xd8d4c8 });
    b.box("paintmetal", 8, y2 + H1 + 1.1, -4, 5, 1.6, 3, { tint: 0x8f9494 });
    b.box("paintmetal", -6, y2 + H1 + 0.8, 2, 2.4, 1.0, 2.4, { tint: 0x9a9f9f });
    // Entrance canopy on round columns, with the name in raised letters.
    b.slab("concrete", -6, y1 - 0.5, HZ, 12, 0.35, 5.5, { tint: grey });
    b.slab("paintmetal", -6.1, y1 - 0.15, HZ + 5.3, 12.2, 0.9, 0.2, { tint: accent, collide: "none" });
    for (const sx of [-5.2, 5.2]) b.cyl("concrete", sx, F0 + (H0 - 0.5) / 2, HZ + 4.8, 0.28, H0 - 0.5, 12, { tint: 0xe2ded2 });
    const name = ctx.signs.text("cc:name", 1024, 96, "#b3261e", "#ffffff", [["NEE SOON EAST COMMUNITY CLUB", 64]]);
    signQuad(b, name, 0, y1 + 0.3, HZ + 5.42, 11.4, 0.8, 0, true);
    const pa = ctx.signs.text("cc:pa", 512, 128, "#ffffff", "#b3261e", [["PEOPLE'S ASSOCIATION", 40], ["Bringing People Together", 24]], { weight: "bold" });
    signQuad(b, pa, 11.5, y2 + 0.5, HZ + 0.17, 4.6, 1.1, 0);

    // ---- lobby ----
    b.box("wood", 3.4, F0 + 0.55, 4.5, 0.8, 1.1, 4.2, { tint: 0x8a6a4a });
    b.box("plastic", 3.4, F0 + 1.12, 4.5, 0.9, 0.04, 4.3, { tint: 0xe8e6e0, collide: "none" });
    for (let k = 0; k < 3; k++) {
      b.box("plastic", -3.0, F0 + 0.42, 7.5 - k * 0.7, 0.55, 0.08, 0.55, { tint: 0x3a5a7a });
      b.box("plastic", -3.26, F0 + 0.75, 7.5 - k * 0.7, 0.06, 0.6, 0.55, { tint: 0x3a5a7a, collide: "none" });
    }
    const notice = ctx.signs.text("cc:notice", 512, 384, "#6a4a2a", "#f4f0e2", [["COMMUNITY NOTICES", 34], ["Line Dance · Tue 7.30pm", 24], ["Brisk Walk · Sat 7am", 24], ["Blood Donation Drive", 24], ["Durian Trip 14 Jul — FULL", 24]], { border: "#3a2a1a" });
    signQuad(b, notice, -4.08, F0 + 1.7, 2, 2.6, 1.9, Math.PI / 2);
    for (const [lx, lz] of [[0, 6], [0, -1], [0, -7]]) tube(ctx, b, W, lx, y1, lz, true, 1.5, 11);
    // Stairs up (closed off) at the back of the lobby.
    for (let i = 0; i < 10; i++) b.box("concrete", -2.6, F0 + 0.11 + i * 0.22, -4.2 - i * 0.3, 2.4, 0.22, 0.34, { tint: 0xcfcabb });
    b.slab("paint", -4.1, F0, -8.5, 2.9, 2.6, 0.2, { tint: body });
    P.sandbags(b, ctx.rand, 0, 2.2, 0, 3.6, 5, F0);

    // ---- multi-purpose hall (west): the command post ----
    const [ix, iz] = o.intel;
    P.commandTable(ctx, b, ix, F0, iz, 0);
    b.box("paintmetal", ix - 0.6, F0 + 0.24, iz + 1.0, 0.44, 0.48, 0.44, { tint: 0x2f3a2c });
    b.box("paintmetal", ix + 0.6, F0 + 0.24, iz + 1.0, 0.44, 0.48, 0.44, { tint: 0x2f3a2c });
    // Stage, stacked chairs, badminton court lines, banners.
    b.slab("wood", -HX + 0.3, F0, -HZ + 0.3, 13.4, 0.8, 3.2, { tint: 0x8a6a48 });
    b.slab("canvas", -HX + 0.4, F0 + 0.8, -HZ + 0.32, 13.2, 3.2, 0.08, { tint: 0x6a1a1e });
    for (let k = 0; k < 4; k++) {
      for (let h = 0; h < 6; h++) b.box("plastic", -HX + 1.2 + k * 0.7, F0 + 0.2 + h * 0.16, 9.6, 0.5, 0.05, 0.5, { tint: 0xc8402a, collide: h === 0 ? "solid" : "none" });
    }
    b.collisionBox(Surf.Plastic, "solid", -HX + 2.25, F0 + 0.6, 9.6, 2.7, 1.2, 0.6);
    P.crate(b, -9, F0, 5.5, 0.3, 1.0, 1.0, 0x5c6440);
    P.crate(b, -9.1, F0 + 1.0, 5.5, 0.1, 0.7, 0.6, 0x5c6440);
    P.crate(b, -14.5, F0, 0, -0.2, 1.0, 0.9, 0x5c6440);
    P.weaponCrate(b, -7.4, F0, -2, 1.3, true);
    P.sandbags(b, ctx.rand, -6.4, 3.6, Math.PI / 2, 3.0, 4, F0);
    for (const [lx, lz] of [[-14, 5], [-8, 5], [-14, -2], [-8, -2], [-11, -8]]) tube(ctx, b, W, lx, y1, lz, false, 1.5, 11);
    // ---- offices (east) ----
    for (const [dx, dz, dy] of [[10, 5.6, 0], [14, 5.6, Math.PI], [9, -6, 0.2], [14.5, -6.4, Math.PI / 2]]) {
      b.at(dx, F0, dz, dy, () => {
        b.box("wood", 0, 0.72, 0, 1.5, 0.05, 0.75, { tint: 0xb89a70 });
        b.box("paintmetal", 0, 0.36, 0.3, 1.4, 0.7, 0.04, { tint: 0x9a9da0, collide: "none" });
        b.collisionBox(Surf.Wood, "solid", 0, 0.37, 0, 1.5, 0.74, 0.75);
        b.box("plastic", 0.2, 0.95, 0.1, 0.5, 0.34, 0.04, { tint: 0x1a1c1e, collide: "none" });
        b.box("plastic", 0, 0.46, -0.75, 0.48, 0.08, 0.48, { tint: 0x22262a });
      });
    }
    for (const sx of [7.4, 8.4, 9.4]) b.box("paintmetal", sx + 6.5, F0 + 0.95, -10.3, 0.9, 1.9, 0.5, { tint: 0x8a9094 });
    for (const [lx, lz] of [[11.5, 5.5], [11.5, -5.5]]) tube(ctx, b, W, lx, y1, lz, true, 1.4, 10);
    // Forecourt: flagpoles and planters.
    P.planter(b, 9, HZ + 3.2, 0, 6, 0);
    P.planter(b, -9.5, HZ + 3.2, 0, 5, 0);
  });
  ctx.commit(b);
}

// ---------------------------------------------------------------------------------
// Street structures
// ---------------------------------------------------------------------------------

/** Bus stop: steel shelter, bench, pole with service numbers. Open side faces +Z (the road). */
export function busStop(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number, code = "59241"): void {
  const sign = ctx.signs.text(`bus:${code}`, 256, 384, "#f4f4f0", "#1a1c1e", [["BUS STOP", 34], [code, 28], ["169  171", 44], ["804  811", 44], ["969", 44]], { border: "#c8402a" });
  const ad = ctx.signs.text(`ad:${code}`, 256, 384, "#1c5a3a", "#f5f0d0", [["TOTAL", 52], ["DEFENCE", 52], ["It is everyone's part", 20]]);
  b.at(x, 0, z, yaw, () => {
    b.slab("concrete", -5, 0.13, -1.4, 10, 0.04, 2.8, { tint: 0xc8c4b8, collide: "none" });
    for (const sx of [-4.4, -1.5, 1.5, 4.4]) b.box("paintmetal", sx, 1.4, -1.1, 0.12, 2.6, 0.12, { tint: 0x55595c });
    b.slab("paintmetal", -5.1, 2.7, -1.5, 10.2, 0.14, 3.0, { tint: 0x3a3e42 });
    b.slab("glass", -4.4, 0.9, -1.16, 8.8, 1.5, 0.03, { tint: 0x8fa6a8 });
    for (const bx of [-2.9, 0.2, 3.0]) {
      b.box("paintmetal", bx, 0.6, -0.6, 2.2, 0.06, 0.4, { tint: 0xb07a2a });
      for (const e of [-0.9, 0.9]) b.box("paintmetal", bx + e, 0.36, -0.6, 0.06, 0.46, 0.36, { tint: 0x55595c, collide: "none" });
      b.collisionBox(Surf.Metal, "solid", bx, 0.4, -0.6, 2.2, 0.5, 0.4);
    }
    b.cyl("steel", 5.6, 1.5, 0.6, 0.04, 2.8, 6, { tint: 0xa8acae, collide: "none" });
    signQuad(b, sign, 5.6, 2.3, 0.65, 0.6, 0.9, 0);
    signQuad(b, sign, 5.6, 2.3, 0.55, 0.6, 0.9, Math.PI);
    b.box("paintmetal", -4.75, 1.4, -0.3, 0.1, 2.0, 1.4, { tint: 0x3a3e42 });
    signQuad(b, ad, -4.69, 1.45, -0.3, 1.2, 1.8, Math.PI / 2, true);
  });
  ctx.lamp(x, 2.4, z, 0.8, 7);
}

/** Covered linkway between two points: steel posts and a shallow vaulted roof. */
export function linkway(ctx: WorldCtx, b: Builder, x0: number, z0: number, x1: number, z1: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  b.at((x0 + x1) / 2, 0, (z0 + z1) / 2, yaw, () => {
    b.prism("paintmetal", [[-1.45, 2.62], [1.45, 2.62], [1.45, 2.7], [0, 2.92], [-1.45, 2.7]], -len / 2, len / 2, { tint: 0xd8d6cc });
    b.box("paintmetal", 0, 2.56, 0, 0.16, 0.12, len, { tint: 0x3f7a78, collide: "none" });
    const n = Math.max(2, Math.round(len / 4.5));
    for (let i = 0; i <= n; i++) {
      const zz = -len / 2 + 0.3 + (i * (len - 0.6)) / n;
      b.cyl("steel", 0, 1.4, zz, 0.07, 2.5, 8, { tint: 0x3f7a78 });
      b.box("paintmetal", 0, 2.56, zz, 2.7, 0.1, 0.1, { tint: 0x3f7a78, collide: "none" });
      if (i % 2 === 0) {
        b.box("emissive", 0.5, 2.49, zz + 1, 0.06, 0.02, 0.9);
        const w = placer((x0 + x1) / 2, (z0 + z1) / 2, yaw)(0.5, 2.3, zz + 1);
        ctx.lamp(w[0], w[1], w[2], 0.6, 6);
      }
    }
  });
}

/** Pedestrian overhead bridge spanning local X, with stair flights down both ends (toward +Z). */
export function overheadBridge(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number, span: number): void {
  const H = 5.3, w = 2.4;
  b.at(x, 0, z, yaw, () => {
    b.slab("concrete", -span / 2 - 1.4, H - 0.5, -w / 2, span + 2.8, 0.5, w, { tint: 0xc8c4b8 });
    for (const sx of [-span / 2 + 0.6, span / 2 - 0.6]) {
      b.box("concrete", sx, (H - 0.5) / 2, 0, 0.9, H - 0.5, 1.3, { tint: 0xc8c4b8 });
      b.box("concrete", sx, H - 0.8, 0, 1.6, 0.6, w, { tint: 0xc8c4b8, collide: "none" });
    }
    b.box("concrete", 0, (H - 0.5) / 2, 0, 0.7, H - 0.5, 1.0, { tint: 0xc8c4b8 });
    // Parapet planters with bougainvillea, and railings.
    for (const s of [-1, 1]) {
      b.slab("concrete", -span / 2 - 1.4, H, s * (w / 2) - (s > 0 ? 0.36 : 0), span + 2.8, 0.55, 0.36, { tint: 0xd0ccc0 });
      b.slab("hedge", -span / 2 - 1.2, H + 0.5, s * (w / 2) - (s > 0 ? 0.42 : -0.02), span + 2.4, 0.4, 0.4, { tint: 0xd070a0, collide: "none" });
      b.slab("rail", -span / 2 - 1.4, H + 1.25, s * (w / 2 - 0.2) - 0.02, span + 2.8, 0.04, 0.04, { tint: 0x8a8e90 });
    }
    // Stairs: two flights with a landing, at each end.
    for (const s of [-1, 1]) {
      const sx = s * (span / 2 + 0.2);
      const rise = H / 2, run = 5.0, steps = 15;
      for (let f = 0; f < 2; f++) {
        const zf = f === 0 ? w / 2 : w / 2 + run + 1.6;
        const ya = H - f * rise;
        for (let i = 0; i < steps; i++) b.box("concrete", sx, ya - ((i + 0.5) * rise) / steps, zf + ((i + 0.5) * run) / steps, 1.8, rise / steps, run / steps + 0.02, { tint: 0xcfcabb, collide: "none" });
        b.collisionQuad(Surf.Concrete, "solid", [sx - 0.9, ya, zf], [sx + 0.9, ya, zf], [sx + 0.9, ya - rise, zf + run], [sx - 0.9, ya - rise, zf + run]);
        const m = new THREE.Matrix4().makeRotationX(Math.atan2(rise, run)).setPosition(sx, ya - rise / 2 - 0.25, zf + run / 2);
        b.push(m);
        b.box("concrete", 0, 0, 0, 1.8, 0.24, Math.hypot(rise, run), { tint: 0xc8c4b8, collide: "none" });
        for (const e of [-0.92, 0.92]) b.box("rail", e, 1.2, 0, 0.04, 0.04, Math.hypot(rise, run), { tint: 0x8a8e90 });
        for (const e of [-0.92, 0.92]) for (let q = -2; q <= 2; q++) b.box("trim", e, 0.7, q * 1.3, 0.03, 1.0, 0.03, { tint: 0x8a8e90 });
        b.pop();
        if (f === 0) {
          b.slab("concrete", sx - 0.9, H - rise - 0.25, zf + run, 1.8, 0.25, 1.6, { tint: 0xc8c4b8 });
          b.box("concrete", sx, (H - rise - 0.25) / 2, zf + run + 0.8, 0.5, H - rise - 0.25, 0.5, { tint: 0xc8c4b8 });
        }
      }
    }
  });
  void ctx;
}

/** Precinct playground: rubber safety surface, a tower with slide, swings and a spring rider. */
export function playground(b: Builder, x: number, z: number): void {
  b.at(x, 0, z, 0, () => {
    b.slab("rubber", -7, 0.08, -5, 14, 0.07, 10, { tint: 0x9a4a3a, tile: 1.5 });
    b.slab("rubber", -3, 0.085, -2.5, 7, 0.07, 5, { tint: 0x3a7a8a, tile: 1.5, collide: "none" });
    // Tower.
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.cyl("paintmetal", px, 1.6, pz, 0.06, 3.2, 8, { tint: 0xe0b030 });
    b.box("plastic", 0, 1.45, 0, 2.1, 0.1, 2.1, { tint: 0x2f6f9a });
    b.at(0, 0, 0, Math.PI / 2, () => b.prism("plastic", [[-1.3, 2.9], [1.3, 2.9], [0, 3.7]], -1.3, 1.3, { tint: 0xc8402a }));
    for (const s of [-1, 1]) b.box("plastic", 0, 1.9, s * 1.02, 2.0, 0.7, 0.05, { tint: 0x2f7a4a });
    // Slide.
    const m = new THREE.Matrix4().makeRotationZ(-0.52).setPosition(2.3, 0.82, 0);
    b.push(m);
    b.box("plastic", 0, 0, 0, 3.0, 0.06, 0.7, { tint: 0xe0b030 });
    for (const s of [-1, 1]) b.box("plastic", 0, 0.12, s * 0.36, 3.0, 0.24, 0.05, { tint: 0xe0b030, collide: "none" });
    b.pop();
    // Steps.
    for (let i = 0; i < 5; i++) b.box("paintmetal", -1.2 - i * 0.28, 0.25 + i * 0.26, 0, 0.26, 0.04, 0.8, { tint: 0x55595c });
    // Swings.
    b.at(-4.5, 0, 2.6, 0, () => {
      for (const sx of [-1.5, 1.5]) for (const sz of [-0.7, 0.7]) {
        const lg = new THREE.Matrix4().makeRotationX(sz > 0 ? -0.28 : 0.28).setPosition(sx, 1.15, sz * 0.5);
        b.push(lg);
        b.cyl("paintmetal", 0, 0, 0, 0.045, 2.4, 6, { tint: 0x2f6f9a });
        b.pop();
      }
      b.cyl("paintmetal", 0, 2.28, 0, 0.05, 3.2, 6, { axis: "x", tint: 0x2f6f9a, collide: "none" });
      for (const sx of [-0.65, 0.65]) {
        b.box("rubber", sx, 0.55, 0, 0.5, 0.04, 0.2, { collide: "none" });
        for (const e of [-0.22, 0.22]) b.cyl("steel", sx + e, 1.42, 0, 0.008, 1.72, 4, { tint: 0x8a8d8f, collide: "none" });
      }
    });
    // Spring rider and bench.
    b.cyl("steel", 4.6, 0.3, -3, 0.06, 0.5, 6, { tint: 0x3a3c3d, collide: "none" });
    b.box("plastic", 4.6, 0.7, -3, 0.9, 0.36, 0.22, { tint: 0xc8402a });
  });
}

/** Monsoon canal: trapezoid concrete channel running along X, with railings and a trickle of water. */
export function canal(b: Builder, x0: number, x1: number, zc: number, gap: [number, number]): void {
  const half = 7, depth = 4.2;
  const seg = (a: number, c: number, bridge: boolean): void => {
    b.at(0, 0, zc, Math.PI / 2, () => {
      // Profile in (z, y) → prism XY, extruded along world X.
      const prof: number[][] = [[-half - 0.6, 0.12], [-half - 0.6, -0.4], [-half, -0.4], [-half + 2.6, -depth], [half - 2.6, -depth], [half, -0.4], [half + 0.6, -0.4], [half + 0.6, 0.12], [half, 0.12], [half - 2.5, -depth + 0.25], [-half + 2.5, -depth + 0.25], [-half, 0.12]];
      b.prism("drain", prof.map(([zz, y]) => [-zz, y]).reverse(), a, c, { tint: 0xb9b6aa, caps: false });
      b.box("glass", 0, -depth + 0.3, (a + c) / 2, 3.2, 0.02, c - a, { tint: 0x2c3a30, collide: "none" });
    });
    if (!bridge) for (const s of [-1, 1]) {
      b.slab("rail", a, 0.12 + 1.05, zc + s * (half + 0.3) - 0.02, c - a, 0.05, 0.05, { tint: 0x2f6a4a });
      b.slab("rail", a, 0.12 + 0.55, zc + s * (half + 0.3) - 0.02, c - a, 0.04, 0.04, { tint: 0x2f6a4a });
      for (let px = a; px <= c; px += 2.4) b.box("trim", px, 0.12 + 0.55, zc + s * (half + 0.3), 0.05, 1.1, 0.05, { tint: 0x2f6a4a });
    }
  };
  seg(x0, gap[0], false);
  seg(gap[0], gap[1], true);
  seg(gap[1], x1, false);
  // Road bridge parapets.
  for (const sx of gap) b.box("concrete", sx, 0.6, zc, 0.4, 1.0, half * 2 + 1.2, { tint: 0xc8c4b8 });
}

/** Elevated MRT viaduct along X with a train stopped on it. Pure backdrop. */
export function viaduct(b: Builder, x0: number, x1: number, z: number): void {
  const y = 11;
  for (let px = x0 + 15; px < x1; px += 30) {
    b.cyl("concrete", px, y / 2 - 0.5, z, 1.1, y - 1, 12, { tint: 0xc4c0b6 });
    b.at(px, 0, z, Math.PI / 2, () => b.prism("concrete", [[-1.2, y - 2.6], [1.2, y - 2.6], [3.4, y - 1], [-3.4, y - 1]], -1.1, 1.1, { tint: 0xc4c0b6, collide: "none" }));
  }
  b.at(0, 0, z, Math.PI / 2, () => {
    b.prism("concrete", [[-4.6, y + 0.3], [-4.6, y], [-2.2, y - 1.1], [2.2, y - 1.1], [4.6, y], [4.6, y + 0.3]], x0, x1, { tint: 0xbcb8ae, collide: "none" });
    for (const s of [-1, 1]) b.box("paint", s * 4.5, y + 0.9, (x0 + x1) / 2, 0.14, 1.3, x1 - x0, { tint: 0xd8d6cc, collide: "none" });
  });
  // Six-car train, white with the red band.
  for (let c = 0; c < 6; c++) {
    const cx = -30 + c * 23.2;
    b.box("carpaint", cx, y + 2.35, z - 1.9, 22.6, 3.5, 3.0, { tint: 0xe8e8e4, collide: "none" });
    b.box("carpaint", cx, y + 1.25, z - 1.9, 22.62, 0.5, 3.02, { tint: 0xb3202a, collide: "none" });
    b.box("glass", cx, y + 2.75, z - 1.9, 20.6, 1.0, 3.04, { tint: 0x121a1e, collide: "none" });
    b.box("plastic", cx, y + 0.5, z - 1.9, 20, 0.5, 2.4, { tint: 0x1a1c1e, collide: "none" });
  }
}

/** Distant HDB slab block: one textured box. Used outside the playable area to close the horizon. */
export function backdropBlock(b: Builder, x: number, z: number, yaw: number, len: number, storeys: number, tint: number): void {
  const h = storeys * 2.8 + 3.6;
  b.at(x, 0, z, yaw, () => {
    b.box("facade", 0, h / 2, 0, len, h, 11, { tint, collide: "none", tile: 1 });
    b.box("paint", 0, h + 0.5, 0, len + 0.4, 1.0, 11.4, { tint: 0xd8d4c8, collide: "none" });
    b.box("paint", -len / 2 + 3, h + 2.2, 0, 4, 2.6, 5, { tint: 0xc8c4b8, collide: "none" });
    b.box("paint", len / 2 - 3, h + 2.2, 0, 4, 2.6, 5, { tint: 0xc8c4b8, collide: "none" });
    for (const s of [-1, 1]) b.box("paint", s * (len / 2 + 0.2), h / 2, 0, 0.4, h, 3.2, { tint: 0xa8553a, collide: "none" });
  });
}

/** Facade texture for backdrop blocks: one storey × one bay, tiled by the box UVs (metres). */
export function facadeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 200;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e4dece";
  g.fillRect(0, 0, 256, 200);
  g.fillStyle = "#cfc8b6";
  g.fillRect(0, 150, 256, 50); // corridor parapet
  g.fillStyle = "#3a4448";
  g.fillRect(0, 60, 256, 90); // corridor shadow
  g.fillStyle = "#8a6a4a";
  g.fillRect(40, 66, 52, 84); // door
  g.fillStyle = "#1c2a30";
  g.fillRect(130, 76, 90, 50); // window
  g.fillStyle = "#b8b2a0";
  g.fillRect(0, 0, 256, 8);
  g.fillRect(0, 0, 6, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 3.6, 1 / 2.8);
  t.anisotropy = 8;
  return t;
}
