import { Surf, type Builder } from "~/gfx/builder";
import { pick, rr } from "~/gfx/noise";
import { signQuad, type WorldCtx } from "../ctx";
import { airconUnit, door, shutter, win } from "./arch";

/**
 * HDB slab block: the long-corridor public housing block that defines the
 * estate's skyline. Open void deck at ground level, common corridors with
 * parapets on one face, windows / air-con ledges / laundry poles on the
 * other, stair towers at both ends, lift lobby in the middle.
 *
 * Local frame: X along the block, corridor face toward +Z, origin at the
 * block centre on the ground. The void deck, both ground-floor stairs and the
 * second-storey corridor are walkable.
 */

export interface HdbOpts {
  x: number;
  z: number;
  yaw: number;
  bays: number;
  storeys: number;
  number: string;
  accent: number;
  accent2: number;
  /** Bays (from, to) of the void deck enclosed as a room. */
  room?: [number, number, string];
}

export const HDB = { bayW: 3.6, coreW: 3.4, back: -5.2, front: 3.4, edge: 5.0, F0: 0.15, H0: 3.4, H: 2.8 };

const BODY = 0xf1ead8;
const BODY_DK = 0xd6ceb8;
const DOORS = [0x6b4a34, 0x7a2f26, 0x3f4f5c, 0x54563f, 0x8a6a4a, 0x2f3d33];
const CURTAINS = [0x18262a, 0x18262a, 0x18262a, 0x202c30, 0x6f6a58, 0x7c6f66, 0x5c6470, 0x0f1719, 0x8a8572];
const CLOTHES = [0xd8d4c8, 0x8fa3b8, 0xb8544a, 0x3f5f8a, 0xd9c26a, 0x4a4a4a, 0xe8e8e8, 0x6f8f6a, 0xc98aa0];

export function hdbBlock(ctx: WorldCtx, o: HdbOpts): void {
  const b = ctx.builder(`blk${o.number}`);
  const r = ctx.rand;
  const { bayW, coreW, back, front, edge, F0, H0, H } = HDB;
  const L = o.bays * bayW;
  const x0 = -L / 2;
  const N = o.storeys;
  const yk = (k: number): number => F0 + H0 + (k - 1) * H;
  const roofY = yk(N);
  const world = (lx: number, ly: number, lz: number): [number, number, number] => [
    o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw),
    ly,
    o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw),
  ];
  const cream = { tint: BODY };

  b.at(o.x, 0, o.z, o.yaw, () => {
    // ---- void deck ---------------------------------------------------------
    const ceil = yk(1) - 0.22;
    const lobby = Math.floor(o.bays / 2);
    for (let i = 0; i <= o.bays; i++) {
      const x = x0 + i * bayW;
      const inRoom = o.room && i > o.room[0] && i < o.room[1];
      // Corridor-edge column runs the full height of the block.
      b.slab("paint", x - 0.16, F0, edge - 0.32, 0.32, roofY - F0, 0.32, { tint: i % 4 === 0 ? o.accent : BODY });
      if (inRoom) continue;
      b.slab("paint", x - 0.18, F0, back, 0.36, ceil - F0, 0.8, cream);
      b.slab("paint", x - 0.18, F0, front - 0.6, 0.36, ceil - F0, 0.6, cream);
      if (i % 4 === 0 && Math.abs(i - lobby) > 1) {
        // Shear wall with a painted dado: the void deck's main hard cover.
        b.slab("paint", x - 0.12, F0, back + 0.8, 0.24, ceil - F0, 3.6, cream);
        b.slab("paint", x - 0.13, F0, back + 0.8, 0.26, 1.1, 3.6, { tint: o.accent2, collide: "none" });
      }
      // Transverse beam.
      b.slab("paint", x - 0.15, ceil - 0.42, back, 0.3, 0.42, edge - back, { tint: BODY_DK, collide: "none" });
    }
    for (const z of [back + 0.1, front - 0.3]) b.slab("paint", x0, ceil - 0.5, z, L, 0.5, 0.3, { tint: BODY_DK, collide: "none" });
    // Services slung under the slab: soil stacks and conduit, as in every real void deck.
    b.cyl("plastic", 0, ceil - 0.62, back + 1.6, 0.075, L - 0.6, 8, { axis: "x", tint: 0xc9c6ba, collide: "none" });
    b.cyl("plastic", 0, ceil - 0.56, back + 1.9, 0.04, L - 0.6, 6, { axis: "x", tint: 0xb9b6aa, collide: "none" });
    b.box("trim", 0, ceil - 0.03, 1.2, L - 1, 0.03, 0.08, { tint: 0x8d9092 });
    for (let i = 0; i < o.bays; i++) {
      const xc = x0 + (i + 0.5) * bayW;
      if (o.room && i >= o.room[0] && i < o.room[1]) continue;
      if (i % 2 === 0) {
        b.box("trim", xc, ceil - 0.06, -1.0, 1.25, 0.05, 0.12, { tint: 0xe8e8e2 });
        b.box("emissive", xc, ceil - 0.095, -1.0, 1.2, 0.025, 0.05);
        ctx.lamp(...world(xc, ceil - 0.3, -1.0), 1.0, 9);
      }
      if (i % 4 === 1) b.cyl("plastic", xc - bayW / 2 + 0.34, (F0 + ceil) / 2, back + 0.95, 0.075, ceil - F0, 8, { tint: 0xc9c6ba, collide: "none" });
    }

    // Lift lobby: shaft, two landing doors, call panel, block sign, letterboxes.
    const lx = x0 + lobby * bayW;
    b.slab("paint", lx - 2.5, F0, back, 5.0, roofY + 2.6 - F0, 3.9, cream);
    b.slab("walltile", lx - 2.5, F0, back + 3.9, 5.0, ceil - F0, 0.06, { tint: 0xd9d4c4, collide: "none" });
    for (const s of [-1.15, 1.15]) {
      b.box("steel", lx + s, F0 + 1.05, back + 3.98, 1.0, 2.1, 0.04, { tint: 0xb0b3b4, collide: "none" });
      b.box("steel", lx + s, F0 + 1.05, back + 4.0, 0.012, 2.1, 0.01, { tint: 0x55585a, collide: "none" });
      b.box("steel", lx + s, F0 + 2.16, back + 3.99, 1.16, 0.12, 0.06, { tint: 0x8d9092, collide: "none" });
      b.box("paintmetal", lx + s, F0 + 2.4, back + 3.98, 0.34, 0.14, 0.03, { tint: 0x1a1c1d, collide: "none" });
    }
    b.box("steel", lx, F0 + 1.2, back + 3.98, 0.14, 0.3, 0.03, { tint: 0xc4c6c7, collide: "none" });
    const lobbySign = ctx.signs.text(`lobby:${o.number}`, 384, 128, "#f1ead8", "#2a2c2e", [[`BLK ${o.number}`, 62], ["LIFT LOBBY A", 30]], { border: "#2a2c2e" });
    signQuad(b, lobbySign, lx, F0 + 2.85, back + 3.99, 1.5, 0.5, 0);
    // Letterbox bank on a low wall beside the lobby.
    const boxes = ctx.signs.add("letterbox", 512, 256, (c, w, h) => {
      c.fillStyle = "#9a9da0";
      c.fillRect(0, 0, w, h);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 12; i++) {
        const bx = 6 + i * 42;
        const by = 6 + j * 49;
        c.fillStyle = "#b4b7b9";
        c.fillRect(bx, by, 38, 45);
        c.fillStyle = "#202224";
        c.fillRect(bx + 5, by + 8, 28, 4);
        c.fillStyle = "#5a5d5f";
        c.beginPath();
        c.arc(bx + 30, by + 32, 3, 0, 7);
        c.fill();
        c.fillStyle = "#2a2c2e";
        c.font = "9px Arial";
        c.fillText(`#${String(j + 2).padStart(2, "0")}-${100 + i * 2 + j}`, bx + 4, by + 36);
      }
    });
    b.slab("paint", lx + 3.4, F0, back + 0.3, 0.3, 1.9, 3.2, cream);
    signQuad(b, boxes, lx + 3.71, F0 + 1.15, back + 1.9, 2.8, 1.3, Math.PI / 2);
    b.box("steel", lx + 3.74, F0 + 1.15, back + 1.9, 0.08, 1.36, 2.86, { tint: 0x8d9092, collide: "none" });

    // Enclosed room (RC centre / childcare): louvre windows, door, signboard.
    if (o.room) {
      const [ra, rb, name] = o.room;
      const rx0 = x0 + ra * bayW + 0.18;
      const rx1 = x0 + rb * bayW - 0.18;
      b.slab("paint", rx0, F0, back + 0.1, rx1 - rx0, ceil - F0, front - back - 0.3, cream);
      b.slab("paint", rx0 - 0.01, F0, back + 0.09, rx1 - rx0 + 0.02, 1.0, front - back - 0.28, { tint: o.accent, collide: "none" });
      const zf = front - 0.2;
      for (let i = ra; i < rb; i++) {
        const xc = x0 + (i + 0.5) * bayW;
        if (i === ra + 1) {
          door(b, xc, F0, zf + 0.06, 1.7, 2.15, 1, 0x4a5a52, { solid: false });
          b.box("glass", xc, F0 + 1.3, zf + 0.03, 1.2, 1.2, 0.02, { tint: 0x18262a, collide: "none" });
        } else if (i === rb - 1) {
          shutter(b, xc, F0, zf + 0.1, 2.6, 2.4, 1, 0xa9acad);
        } else {
          win(b, xc, F0 + 1.05, zf, 2.6, 1.25, 1, { style: "louvre", detail: 2, inset: -0.03, glass: 0x24343a });
        }
        win(b, xc, F0 + 1.6, back + 0.1, 2.2, 0.8, -1, { style: "louvre", detail: 2, inset: -0.03, glass: 0x24343a });
      }
      const sign = ctx.signs.text(`room:${name}`, 768, 128, "#f4f1e6", "#1f3a5a", [[name, 54]], { border: "#1f3a5a" });
      signQuad(b, sign, (rx0 + rx1) / 2, ceil - 0.5, zf + 0.05, Math.min(7.2, rx1 - rx0 - 1), 0.9, 0);
    }

    // Void-deck furniture: stone tables with stools, benches against shear walls.
    for (let i = 2; i < o.bays - 1; i += 5) {
      if (o.room && i >= o.room[0] - 1 && i <= o.room[1]) continue;
      if (Math.abs(i - lobby) < 2) continue;
      const xc = x0 + (i + 0.5) * bayW;
      b.cyl("concrete", xc, F0 + 0.36, 0.6, 0.12, 0.72, 10, { tint: 0xcfcabb });
      b.cyl("concrete", xc, F0 + 0.75, 0.6, 0.5, 0.07, 16, { tint: 0xd8d2c0 });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.78;
        b.cyl("concrete", xc + Math.cos(a) * 0.82, F0 + 0.22, 0.6 + Math.sin(a) * 0.82, 0.17, 0.44, 10, { tint: 0xcfcabb });
      }
    }

    // ---- upper storeys -----------------------------------------------------
    for (let k = 1; k < N; k++) {
      const y = yk(k);
      const detail: 0 | 1 | 2 = k <= 2 ? 2 : k <= 5 ? 1 : 0;
      b.slab("paint", x0, y - 0.22, back, L, 0.22, edge - back, { tint: BODY_DK });
      b.slab("paint", x0, y, back, L, H - 0.22, 0.2, cream);
      b.slab("paint", x0, y, front - 0.2, L, H - 0.22, 0.2, cream);
      // Corridor parapet with its painted band and coping.
      b.slab("paint", x0, y, edge - 0.12, L, 1.05, 0.12, cream);
      b.slab("paint", x0, y + 0.22, edge - 0.005, L, 0.34, 0.012, { tint: k % 3 === 0 ? o.accent2 : o.accent, collide: "none" });
      b.slab("paint", x0, y + 1.05, edge - 0.16, L, 0.05, 0.2, { tint: BODY_DK, collide: "none" });
      // Slab-edge band on the window face.
      b.slab("paint", x0, y - 0.3, back - 0.07, L, 0.42, 0.08, { tint: k % 3 === 0 ? o.accent : BODY_DK, collide: "none" });

      for (let i = 0; i < o.bays; i++) {
        const xc = x0 + (i + 0.5) * bayW;
        // Corridor face: door + louvre window, then a sliding window.
        if (i % 2 === 0) {
          const tint = pick(r, DOORS);
          if (detail >= 1) door(b, xc - 0.85, y, front + 0.06, 0.9, 2.05, 1, tint, { gate: detail === 2, solid: false });
          else b.box("trim", xc - 0.85, y + 1.03, front + 0.01, 0.9, 2.05, 0.03, { tint, collide: "none" });
          win(b, xc + 0.85, y + 1.15, front, 0.95, 1.0, 1, { style: "louvre", detail, inset: -0.02, glass: pick(r, CURTAINS) });
          if (detail === 2 && r() < 0.6) {
            // Shoe rack and a potted plant by the door: corridors are lived in.
            b.box("wood", xc - 1.55, y + 0.3, front + 0.2, 0.5, 0.6, 0.28, { tint: pick(r, [0x8a6a4a, 0x5a5a5a, 0xcfcabb]), collide: "none" });
          }
        } else {
          win(b, xc, y + 1.1, front, 1.7, 1.1, 1, { style: "slide", detail, inset: -0.02, glass: pick(r, CURTAINS), grille: true });
        }
        // Window face.
        const kind = i % 4;
        const zb = back;
        if (kind === 0) {
          win(b, xc, y + 0.95, zb, 2.3, 1.35, -1, { style: "slide", detail, inset: -0.025, glass: pick(r, CURTAINS), grille: true });
          b.box("paint", xc, y + 2.38, zb - 0.16, 2.6, 0.07, 0.32, { tint: BODY_DK, collide: "none" });
          b.box("paint", xc, y + 0.6, zb - 0.3, 1.5, 0.08, 0.6, { tint: BODY_DK, collide: "none" });
          if (r() < 0.6) airconUnit(b, xc - 0.2, y + 0.66, zb - 0.12, -1);
        } else if (kind === 2) {
          win(b, xc + 0.6, y + 1.5, zb, 1.1, 0.7, -1, { style: "louvre", detail, inset: -0.025, glass: pick(r, CURTAINS) });
          // Laundry pole sockets: the bamboo poles of every older block.
          b.box("trim", xc - 0.5, y + 1.32, zb - 0.06, 1.3, 0.1, 0.1, { tint: 0x8d9092, collide: "none" });
          const poles = r() < 0.75 ? 3 + Math.floor(r() * 2) : 0;
          for (let p = 0; p < poles; p++) {
            const px = xc - 1.0 + p * 0.32;
            b.cyl("wood", px, y + 1.36, zb - 1.3, 0.016, 2.5, 5, { axis: "z", tint: 0xc9a868, collide: "none" });
            const items = Math.floor(r() * 4);
            for (let c = 0; c < items; c++) {
              const cz = zb - 0.5 - c * 0.5 - r() * 0.2;
              const ch = rr(r, 0.4, 0.75);
              b.box("canvas", px, y + 1.34 - ch / 2, cz, 0.02, ch, rr(r, 0.3, 0.46), { tint: pick(r, CLOTHES), collide: "none" });
            }
          }
        } else {
          win(b, xc, y + 1.0, zb, 1.45, 1.2, -1, { style: "slide", detail, inset: -0.025, glass: pick(r, CURTAINS), grille: true });
          b.box("paint", xc, y + 2.28, zb - 0.14, 1.75, 0.07, 0.28, { tint: BODY_DK, collide: "none" });
          if (r() < 0.45) airconUnit(b, xc, y + 0.36, zb - 0.02, -1);
        }
        if (k === 1 && i % 4 === 3) b.cyl("plastic", xc + bayW / 2, (F0 + roofY) / 2, zb - 0.1, 0.06, roofY - F0, 8, { tint: 0xd9d4c4, collide: "none" });
      }
    }
    // Vertical piers on the window face, every two bays.
    for (let i = 0; i <= o.bays; i += 2) {
      const x = x0 + i * bayW;
      b.slab("paint", x - 0.2, yk(1) - 0.22, back - 0.14, 0.4, roofY - yk(1) + 0.22, 0.16, { tint: i % 8 === 0 ? o.accent : BODY, collide: "none" });
    }

    // ---- roof ----------------------------------------------------------------
    b.slab("concrete", x0 - coreW, roofY - 0.25, back, L + coreW * 2, 0.25, edge - back, { tint: 0xbdb9ac });
    for (const z of [back, edge - 0.15]) b.slab("paint", x0 - coreW, roofY, z, L + coreW * 2, 0.95, 0.15, cream);
    b.slab("paint", x0 - coreW, roofY + 0.5, edge - 0.01, L + coreW * 2, 0.3, 0.012, { tint: o.accent, collide: "none" });
    for (const f of [0.22, 0.72]) {
      const tx = x0 + L * f;
      b.slab("paint", tx - 2.6, roofY, -3.2, 5.2, 2.5, 4.6, cream);
      b.slab("concrete", tx - 2.8, roofY + 2.5, -3.4, 5.6, 0.14, 5.0, { tint: 0xbdb9ac, collide: "none" });
      for (let i = 0; i < 6; i++) b.box("trim", tx, roofY + 0.9 + i * 0.16, 1.42, 3.6, 0.03, 0.05, { tint: 0x9a9d9e, collide: "none" });
    }
    b.cyl("steel", lx + 1.5, roofY + 4.4, back + 1.5, 0.04, 3.6, 6, { collide: "none" });
    for (let i = 0; i < 3; i++) b.box("steel", lx + 1.5, roofY + 4.2 + i * 0.6, back + 1.5, 1.2 - i * 0.3, 0.03, 0.03, { collide: "none" });

    // ---- stair cores at both ends -------------------------------------------
    for (const s of [-1, 1]) {
      const xi = s * (L / 2); // inner face (block end)
      const xo = s * (L / 2 + coreW); // gable
      const xm = (xi + xo) / 2;
      // Gable wall, with the block number.
      b.box("paint", xo - s * 0.14, (F0 + roofY + 0.95) / 2, (back + edge) / 2, 0.28, roofY + 0.95 - F0, edge - back, cream);
      b.box("paint", xo + s * 0.006, (yk(1) + roofY) / 2, back + 1.6, 0.012, roofY - yk(1), 1.4, { tint: o.accent, collide: "none" });
      b.box("paint", xo + s * 0.006, (yk(1) + roofY) / 2, back + 3.3, 0.012, roofY - yk(1), 0.5, { tint: o.accent2, collide: "none" });
      const num = ctx.signs.add(`blknum:${o.number}:${o.accent}`, 512, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = `#${o.accent.toString(16).padStart(6, "0")}`;
        c.font = "bold 230px 'Arial Narrow', Arial, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(o.number, w / 2, h / 2 + 12);
      });
      signQuad(b, num, xo + s * 0.01, roofY - 4.2, 1.6, 5.2, 2.6, (s * Math.PI) / 2);
      signQuad(b, num, xo + s * 0.01, yk(1) + 1.4, 1.6, 2.6, 1.3, (s * Math.PI) / 2);
      // Rear service block (refuse chute, risers).
      b.box("paint", xm, (F0 + roofY) / 2, (back + -1.7) / 2, coreW - 0.28, roofY - F0, -1.7 - back, cream);
      b.box("ribmetal", xm, F0 + 1.0, -1.69, 1.0, 1.9, 0.03, { tint: 0x6f7a72, collide: "none" });
      // Spine wall between the two flights.
      b.box("paint", xm, (F0 + roofY) / 2, 2.3, 0.14, roofY - F0, 2.9, cream);
      // Front screen: parapets at each landing level, open between.
      for (let k = 1; k < N; k++) {
        const y = yk(k);
        b.box("paint", xm, y - 0.11, (edge - 1.7) / 2 + 0.0, coreW - 0.28, 0.22, edge + 1.7, { tint: BODY_DK });
        b.box("paint", xm, y + 0.52, edge - 0.06, coreW - 0.28, 1.05, 0.12, { tint: o.accent2 });
        // Mid-landing slab and the two flights (upper storeys are dressing only).
        b.box("paint", xm, y + H / 2 - 0.1, -1.0, coreW - 0.28, 0.2, 1.3, { tint: BODY_DK, collide: "none" });
      }
      // Walkable stair from the void deck to the second-storey corridor.
      const near = xi + s * 0.86; // flight beside the block
      const far = xo - s * 1.0; // flight beside the gable
      const rise = H0 / 2;
      const steps = 10;
      const run = 3.0;
      for (let i = 0; i < steps; i++) {
        const t = (i + 1) / steps;
        b.box("concrete", far, F0 + rise * t - rise / steps / 2, 3.9 - (run * (i + 0.5)) / steps, 1.5, rise / steps, run / steps + 0.02, { tint: 0xcfcabb, collide: "none" });
        b.box("concrete", near, F0 + rise + rise * t - rise / steps / 2, 0.9 + (run * (i + 0.5)) / steps, 1.5, rise / steps, run / steps + 0.02, { tint: 0xcfcabb, collide: "none" });
      }
      b.collisionQuad(Surf.Concrete, "solid", [far - 0.75, F0, 3.9], [far + 0.75, F0, 3.9], [far + 0.75, F0 + rise, 0.9], [far - 0.75, F0 + rise, 0.9]);
      b.collisionQuad(Surf.Concrete, "solid", [near + 0.75, F0 + rise, 0.9], [near - 0.75, F0 + rise, 0.9], [near - 0.75, F0 + H0, 3.9], [near + 0.75, F0 + H0, 3.9]);
      b.box("concrete", xm, F0 + rise - 0.1, -0.4, coreW - 0.28, 0.2, 2.6, { tint: 0xcfcabb });
      // Handrails.
      for (const fx of [far, near]) {
        b.box("rail", fx + (fx === far ? -s : s) * 0.7, F0 + (fx === far ? rise / 2 : rise * 1.5) + 0.95, 2.4, 0.04, 0.04, 3.4, { tint: 0x3a3c3d, collide: "none" });
      }
      // Gate closing off the flights above the second storey.
      b.box("rail", far, yk(1) + 1.1, 3.6, 1.5, 2.2, 0.05, { tint: 0x55524c, collide: "solid" });
    }
  });
  ctx.commit(b);
}
