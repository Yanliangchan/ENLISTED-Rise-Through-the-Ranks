import * as THREE from "three";
import type { Builder } from "~/gfx/builder";
import { Surf } from "~/gfx/builder";
import { groundQuad, signQuad, type WorldCtx } from "../ctx";

/** Street-level kit: paint, kerbs, lighting, signals, railings, furniture. */

export const WHITE = 0xe9e7df;
export const YELLOW = 0xd9a520;
const GALV = 0xb9bcbd;
const DARK = 0x2a2c2e;

const PY = 0.012;

/** Solid painted line between two points. */
export function line(b: Builder, x0: number, z0: number, x1: number, z1: number, width: number, tint: number = WHITE, y = PY): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  groundQuad(b, "roadpaint", (x0 + x1) / 2, (z0 + z1) / 2, width, len, Math.atan2(dx, dz), y, tint);
}

export function dashed(b: Builder, x0: number, z0: number, x1: number, z1: number, width: number, dash: number, gap: number, tint: number = WHITE): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  for (let d = 0; d + dash <= len; d += dash + gap) {
    line(b, x0 + ux * d, z0 + uz * d, x0 + ux * (d + dash), z0 + uz * (d + dash), width, tint);
  }
}

/** Zebra bars across a road. `along` is the direction the road runs. */
export function zebra(b: Builder, cx: number, cz: number, roadWidth: number, depth: number, along: "x" | "z"): void {
  const n = Math.floor(roadWidth / 1.0);
  for (let i = 0; i < n; i++) {
    const o = -roadWidth / 2 + 0.5 + i * (roadWidth / n);
    if (along === "z") groundQuad(b, "roadpaint", cx + o, cz, 0.5, depth, 0, PY, WHITE);
    else groundQuad(b, "roadpaint", cx, cz + o, depth, 0.5, 0, PY, WHITE);
  }
}

/** Yellow box junction: border plus criss-cross diagonals. */
export function yellowBox(b: Builder, x0: number, z0: number, x1: number, z1: number): void {
  const w = 0.14;
  line(b, x0, z0, x1, z0, w, YELLOW);
  line(b, x0, z1, x1, z1, w, YELLOW);
  line(b, x0, z0, x0, z1, w, YELLOW);
  line(b, x1, z0, x1, z1, w, YELLOW);
  const sx = x1 - x0;
  const sz = z1 - z0;
  const step = 2.2;
  for (let c = -sz; c < sx; c += step) {
    // Rising diagonals: x = x0 + c + (z - z0), clipped to the box.
    let zmin = Math.max(z0, z0 - c);
    let zmax = Math.min(z1, z0 + sx - c);
    if (zmax - zmin > 0.2) line(b, x0 + c + (zmin - z0), zmin, x0 + c + (zmax - z0), zmax, 0.1, YELLOW);
    // Falling diagonals: x = x0 + c + (z1 - z).
    zmin = Math.max(z0, z1 + c - sx);
    zmax = Math.min(z1, z1 + c);
    if (zmax - zmin > 0.2) line(b, x0 + c + (z1 - zmin), zmin, x0 + c + (z1 - zmax), zmax, 0.1, YELLOW);
  }
}

/** Raised kerb stones along an axis-aligned edge. */
export function kerb(b: Builder, x0: number, z0: number, x1: number, z1: number, tint = 0xcfcdc4): void {
  const w = 0.2;
  if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) b.slab("concrete", Math.min(x0, x1), -0.2, z0 - w / 2, Math.abs(x1 - x0), 0.37, w, { tint, tile: 1.1 });
  else b.slab("concrete", x0 - w / 2, -0.2, Math.min(z0, z1), w, 0.37, Math.abs(z1 - z0), { tint, tile: 1.1 });
}

/** LTA-style street lamp. `arms` 1 or 2 (median posts carry two). */
export function lampPost(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number, arms: 1 | 2 = 1, height = 9.5): void {
  b.at(x, 0, z, yaw, () => {
    b.box("concrete", 0, 0.1, 0, 0.6, 0.2, 0.6, { tint: 0xbdbab0, collide: "none" });
    b.cyl("steel", 0, 0.75, 0, 0.13, 1.1, 8, { tint: GALV });
    b.cyl("steel", 0, height / 2 + 0.65, 0, 0.1, height - 1.3, 8, { rTop: 0.06, tint: GALV, collide: "none" });
    b.collisionBox(Surf.Metal, "solid", 0, height / 2, 0, 0.22, height, 0.22);
    for (let a = 0; a < arms; a++) {
      const s = a === 0 ? 1 : -1;
      // Outreach arm: three short segments approximating the curve.
      const segs = [
        [0.25, height + 0.15, 0.55, 0.35],
        [0.8, height + 0.42, 0.62, 0.16],
        [1.45, height + 0.5, 0.7, 0.03],
      ];
      for (const [px, py, len, tilt] of segs) {
        const m = new THREE.Matrix4().makeRotationZ(s * -(Math.PI / 2 - tilt)).setPosition(s * px, py, 0);
        b.push(m);
        b.cyl("steel", 0, 0, 0, 0.05, len, 6, { tint: GALV, collide: "none" });
        b.pop();
      }
      b.box("paintmetal", s * 2.05, height + 0.5, 0, 0.75, 0.1, 0.3, { tint: 0x55595c, collide: "none" });
      b.box("emissive", s * 2.05, height + 0.44, 0, 0.6, 0.02, 0.22, { collide: "none" });
    }
  });
  void ctx;
}

/** Signal head: black housing, three lenses with hoods. */
function signalHead(b: Builder, y: number, z: number, lit: 0 | 1 | 2): void {
  b.box("paintmetal", 0, y, z - 0.02, 0.58, 1.3, 0.04, { tint: 0x101112, collide: "none" });
  b.box("paintmetal", 0, y, z + 0.12, 0.34, 1.02, 0.26, { tint: 0x17181a, collide: "none" });
  const cols = [0xff2a1c, 0xffa01c, 0x30ff68];
  for (let i = 0; i < 3; i++) {
    const ly = y + 0.33 - i * 0.33;
    b.cyl("paintmetal", 0, ly, z + 0.27, 0.115, 0.03, 12, { axis: "z", tint: i === lit ? cols[i] : 0x1b1d1c, collide: "none" });
    b.box("paintmetal", 0, ly + 0.13, z + 0.34, 0.26, 0.02, 0.16, { tint: 0x101112, collide: "none" });
  }
}

/** Kerbside traffic signal with optional overhead mast arm. Faces +Z at yaw 0. */
export function trafficLight(b: Builder, x: number, z: number, yaw: number, mast: boolean, lit: 0 | 1 | 2 = 0): void {
  b.at(x, 0, z, yaw, () => {
    const h = mast ? 6.4 : 3.5;
    b.cyl("paintmetal", 0, 0.5, 0, 0.14, 1.0, 10, { tint: 0x8d9092 });
    b.cyl("paintmetal", 0, h / 2 + 0.5, 0, 0.085, h - 1, 10, { tint: 0x8d9092, collide: "none" });
    b.collisionBox(Surf.Metal, "solid", 0, h / 2, 0, 0.2, h, 0.2);
    signalHead(b, 3.0, 0.12, lit);
    // Pedestrian signal, facing across the carriageway.
    b.at(0, 0, 0, Math.PI / 2, () => {
      b.box("paintmetal", 0, 2.25, 0.2, 0.32, 0.62, 0.22, { tint: 0x17181a, collide: "none" });
      b.cyl("paintmetal", 0, 2.4, 0.32, 0.1, 0.02, 10, { axis: "z", tint: 0xff2a1c, collide: "none" });
      b.cyl("paintmetal", 0, 2.12, 0.32, 0.1, 0.02, 10, { axis: "z", tint: 0x1b1d1c, collide: "none" });
    });
    // Push-button box.
    b.box("paintmetal", 0.13, 1.15, 0, 0.1, 0.24, 0.14, { tint: 0xd9a520, collide: "none" });
    if (mast) {
      b.cyl("paintmetal", 2.6, h, 0, 0.07, 5.4, 8, { axis: "x", tint: 0x8d9092, collide: "none" });
      b.at(4.6, 0, 0, 0, () => signalHead(b, h - 0.75, 0.1, lit));
      b.at(2.4, 0, 0, 0, () => signalHead(b, h - 0.75, 0.1, lit));
    }
  });
}

/** Pedestrian guard railing along a kerb (LTA galvanised pattern). */
export function railing(b: Builder, x0: number, z0: number, x1: number, z1: number, y = 0.15, tint = 0x9da3a6): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  b.at(x0, y, z0, Math.atan2(dx, dz), () => {
    const panels = Math.max(1, Math.round(len / 2));
    const pl = len / panels;
    for (let i = 0; i <= panels; i++) b.box("rail", 0, 0.55, i * pl, 0.06, 1.1, 0.06, { tint, collide: "none" });
    b.box("rail", 0, 1.05, len / 2, 0.05, 0.05, len, { tint, collide: "none" });
    b.box("rail", 0, 0.16, len / 2, 0.04, 0.04, len, { tint, collide: "none" });
    for (let i = 0; i < panels; i++) {
      const bars = Math.floor(pl / 0.125);
      for (let k = 1; k < bars; k++) b.box("rail", 0, 0.6, i * pl + (k * pl) / bars, 0.018, 0.86, 0.018, { tint, collide: "none" });
    }
    b.collisionBox(Surf.Metal, "soft", 0, 0.55, len / 2, 0.08, 1.1, len);
  });
}

/** Steel bollard. */
export function bollard(b: Builder, x: number, z: number, y = 0.15, tint = 0x2f3133): void {
  b.cyl("paintmetal", x, y + 0.45, z, 0.07, 0.9, 10, { tint });
  b.cyl("paintmetal", x, y + 0.78, z, 0.075, 0.08, 10, { tint: 0xe9e7df, collide: "none" });
}

/** Round pole sign (speed limit, no entry, etc.). Faces +Z at yaw 0. */
export function poleSign(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number, kind: "limit50" | "noentry" | "hump" | "stop" | "name", text = ""): void {
  b.at(x, 0, z, yaw, () => {
    b.cyl("steel", 0, 1.5, 0, 0.035, 3.0, 8, { tint: GALV, collide: "none" });
    b.collisionBox(Surf.Metal, "soft", 0, 1.2, 0, 0.1, 2.4, 0.1);
    if (kind === "name") {
      const uv = ctx.signs.text(`street:${text}`, 384, 96, "#0d5b3a", "#f2f2ec", [[text, 54]], { border: "#f2f2ec", grime: 0.2 });
      b.box("paintmetal", 0.55, 2.75, 0, 1.3, 0.34, 0.03, { tint: 0x0d5b3a, collide: "none" });
      signQuad(b, uv, 0.55, 2.75, 0.02, 1.28, 0.32, 0);
      signQuad(b, uv, 0.55, 2.75, -0.02, 1.28, 0.32, Math.PI);
      return;
    }
    const uv = ctx.signs.add(`pole:${kind}`, 192, 192, (c, w) => {
      const r = w / 2;
      c.clearRect(0, 0, w, w);
      if (kind === "limit50") {
        c.fillStyle = "#c8201c";
        c.beginPath();
        c.arc(r, r, r - 4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#f4f4f0";
        c.beginPath();
        c.arc(r, r, r - 26, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#111";
        c.font = "bold 92px Arial";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("50", r, r + 6);
      } else if (kind === "noentry") {
        c.fillStyle = "#c8201c";
        c.beginPath();
        c.arc(r, r, r - 4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#f4f4f0";
        c.fillRect(30, r - 18, w - 60, 36);
      } else if (kind === "stop") {
        c.fillStyle = "#c8201c";
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i + 0.5) * (Math.PI / 4);
          c.lineTo(r + Math.cos(a) * (r - 4), r + Math.sin(a) * (r - 4));
        }
        c.fill();
        c.fillStyle = "#f4f4f0";
        c.font = "bold 58px Arial";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("STOP", r, r + 4);
      } else {
        c.fillStyle = "#c8201c";
        c.beginPath();
        c.moveTo(r, 6);
        c.lineTo(w - 6, w - 14);
        c.lineTo(6, w - 14);
        c.fill();
        c.fillStyle = "#f4f4f0";
        c.beginPath();
        c.moveTo(r, 40);
        c.lineTo(w - 38, w - 32);
        c.lineTo(38, w - 32);
        c.fill();
        c.fillStyle = "#111";
        c.beginPath();
        c.ellipse(r, w - 62, 40, 16, 0, Math.PI, 0);
        c.fill();
      }
    });
    b.cyl("paintmetal", 0, 2.7, 0.03, 0.32, 0.02, 14, { axis: "z", tint: 0xa9acad, collide: "none" });
    signQuad(b, uv, 0, 2.7, 0.045, 0.66, 0.66, 0);
  });
}

/** Green electrical distribution ("OG") box: ubiquitous on estate verges, and good cover. */
export function ogBox(b: Builder, x: number, z: number, yaw: number, y = 0.1): void {
  b.at(x, y, z, yaw, () => {
    b.box("concrete", 0, 0.08, 0, 1.5, 0.16, 0.7, { tint: 0xbdbab0 });
    b.box("paintmetal", 0, 0.92, 0, 1.36, 1.52, 0.56, { tint: 0x2f5a44 });
    b.box("paintmetal", 0, 1.72, 0, 1.46, 0.08, 0.66, { tint: 0x274c3a, collide: "none" });
    b.box("paintmetal", 0, 0.92, 0.285, 0.02, 1.4, 0.01, { tint: 0x1c382b, collide: "none" });
    b.box("paintmetal", 0.1, 1.0, 0.29, 0.03, 0.14, 0.03, { tint: 0xb9bcbd, collide: "none" });
    for (let i = 0; i < 6; i++) b.box("paintmetal", -0.4, 1.35 - i * 0.05, 0.285, 0.36, 0.015, 0.012, { tint: 0x1c382b, collide: "none" });
  });
}

/** Town-council litter bin (green, domed lid, on a post). */
export function bin(b: Builder, x: number, z: number, y = 0.15): void {
  b.cyl("plastic", x, y + 0.5, z, 0.26, 0.82, 12, { tint: 0x2d6a3e, rTop: 0.29 });
  b.cyl("plastic", x, y + 0.98, z, 0.3, 0.14, 12, { tint: 0x24573a, rTop: 0.16, collide: "none" });
  b.box("plastic", x, y + 0.86, z + 0.27, 0.22, 0.09, 0.04, { tint: 0x101311, collide: "none" });
}

/** Precast park bench: concrete ends, timber slats. Sits along local X. */
export function bench(b: Builder, x: number, z: number, yaw: number, y = 0.15): void {
  b.at(x, y, z, yaw, () => {
    for (const s of [-0.75, 0.75]) b.box("concrete", s, 0.22, 0, 0.12, 0.44, 0.46, { tint: 0xbdbab0 });
    for (let i = 0; i < 4; i++) b.box("wood", 0, 0.47, -0.17 + i * 0.115, 1.8, 0.04, 0.09, { tint: 0x8a6846, collide: "none" });
    for (let i = 0; i < 2; i++) b.box("wood", 0, 0.68 + i * 0.13, -0.24, 1.8, 0.09, 0.035, { tint: 0x8a6846, collide: "none" });
    for (const s of [-0.75, 0.75]) b.box("paintmetal", s, 0.65, -0.26, 0.05, 0.4, 0.04, { tint: DARK, collide: "none" });
    b.collisionBox(Surf.Wood, "solid", 0, 0.25, 0, 1.8, 0.5, 0.46);
  });
}

/** Red SCDF pillar hydrant. */
export function hydrant(b: Builder, x: number, z: number, y = 0.1): void {
  b.cyl("paintmetal", x, y + 0.35, z, 0.1, 0.7, 10, { tint: 0xb0241c });
  b.cyl("paintmetal", x, y + 0.74, z, 0.12, 0.1, 10, { tint: 0xb0241c, rTop: 0.05, collide: "none" });
  b.cyl("paintmetal", x, y + 0.52, z, 0.05, 0.36, 8, { axis: "x", tint: 0x8a1c16, collide: "none" });
}
