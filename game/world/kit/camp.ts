import * as THREE from "three";
import { Surf, type Builder } from "~/gfx/builder";
import { canvasTex } from "~/gfx/textures";
import { signQuad, type WorldCtx } from "../ctx";
import type { Rect } from "../ground";
import * as P from "./props";

/**
 * PATROL BASE LION: the section's fortified harbour in the south-east corner of
 * the estate. Inside the HESCO line the player is safe: weapons are made safe,
 * nothing can hurt them, and the ammunition point restocks everything.
 */
export const CAMP: Rect = [16, 120, 56, 154];
export const CAMP_SPAWN = { x: 24, z: 137, yaw: Math.PI / 2 };
export const CAMP_AMMO = new THREE.Vector3(37, 0, 126.6);
/** Where friendly sentries stand: x, z, yaw. */
export const CAMP_SENTRIES: Array<[number, number, number]> = [[18.4, 132.6, -Math.PI / 2], [18.4, 141.4, -Math.PI / 2 + 0.3], [41, 141.5, 2.6], [29.5, 144.4, 0.4], [50.5, 131, -2.2]];

/** Ridge tent along local X with the front (+Z) end wall open. */
function tent(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number, len: number, w: number, tint: number): void {
  const eave = 1.5, ridge = 2.9, hw = w / 2;
  b.at(x, 0, z, yaw, () => {
    // Canvas skin as two thin roof planes and two walls, so the inside is a real space.
    b.at(0, 0, 0, Math.PI / 2, () => {
      b.prism("canvas", [[-hw, eave], [-hw, eave - 0.05], [0, ridge - 0.05], [0, ridge]], -len / 2, len / 2, { tint });
      b.prism("canvas", [[0, ridge], [0, ridge - 0.05], [hw, eave - 0.05], [hw, eave]], -len / 2, len / 2, { tint });
    });
    for (const s of [-1, 1]) b.box("canvas", 0, eave / 2 + 0.05, s * hw, len, eave, 0.04, { tint });
    // Closed rear gable; the front is tied back.
    b.at(-len / 2, 0, 0, Math.PI / 2, () => b.prism("canvas", [[-hw, 0.05], [hw, 0.05], [hw, eave], [0, ridge], [-hw, eave]], -0.02, 0.02, { tint }));
    for (const s of [-1, 1]) b.box("canvas", len / 2, eave / 2 + 0.3, s * (hw - 0.45), 0.04, eave + 0.5, 0.9, { tint, collide: "none" });
    // Poles, ridge pole, guy lines and pegs.
    for (const px of [-len / 2 + 0.1, 0, len / 2 - 0.1]) b.cyl("wood", px, ridge / 2, 0, 0.035, ridge, 6, { tint: 0x6a5a40, collide: "none" });
    b.cyl("wood", 0, ridge - 0.08, 0, 0.03, len, 6, { axis: "x", tint: 0x6a5a40, collide: "none" });
    for (const s of [-1, 1]) for (let i = 0; i <= 3; i++) {
      const px = -len / 2 + 0.3 + (i * (len - 0.6)) / 3;
      const m = new THREE.Matrix4().makeRotationX(s * 0.82).setPosition(px, eave / 2 + 0.05, s * (hw + 0.78));
      b.push(m);
      b.cyl("trim", 0, 0, 0, 0.006, 2.15, 3, { tint: 0xc8c0a0 });
      b.pop();
      b.box("wood", px, 0.1, s * (hw + 1.5), 0.04, 0.2, 0.04, { tint: 0x8a7458, collide: "none" });
    }
    b.slab("wood", -len / 2 + 0.1, 0.06, -hw + 0.1, len - 0.2, 0.04, w - 0.2, { tint: 0x8a7a5c, collide: "none" });
    b.box("emissive", 0, ridge - 0.22, 0, 0.5, 0.03, 0.06);
  });
  ctx.lamp(x, 2.3, z, 1.2, 7);
}

function flagTexture(): THREE.CanvasTexture {
  return canvasTex(384, 256, (c) => {
    c.fillStyle = "#f4f2ec";
    c.fillRect(0, 0, 384, 256);
    c.fillStyle = "#d2202f";
    c.fillRect(0, 0, 384, 128);
    c.fillStyle = "#f4f2ec";
    c.beginPath();
    c.arc(74, 64, 42, 0, 7);
    c.fill();
    c.fillStyle = "#d2202f";
    c.beginPath();
    c.arc(90, 64, 40, 0, 7);
    c.fill();
    c.fillStyle = "#f4f2ec";
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const cx = 112 + Math.cos(a) * 24, cy = 66 + Math.sin(a) * 24;
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 ? 4 : 10, aa = -Math.PI / 2 + (k * Math.PI) / 5;
        c.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr);
      }
      c.fill();
    }
  });
}

let flagMat: THREE.MeshStandardMaterial | null = null;

/** A flag that actually flies: a cloth mesh on a pole, driven by the wind shader and a slow swing. */
export function flag(ctx: WorldCtx, b: Builder, x: number, z: number, height = 8, y = 0.1): void {
  b.cyl("steel", x, y + height / 2, z, 0.045, height, 8, { tint: 0xd8dadc, collide: "none" });
  b.cyl("concrete", x, y + 0.15, z, 0.3, 0.3, 10, { tint: 0xc8c4b8 });
  b.cyl("paintmetal", x, y + height + 0.05, z, 0.07, 0.1, 8, { tint: 0xd8b040, collide: "none" });
  b.collisionBox(Surf.Metal, "solid", x, y + 1.2, z, 0.14, 2.4, 0.14);
  flagMat ??= ctx.engine.lit(new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85 }), { wind: true });
  const g = new THREE.PlaneGeometry(1.8, 1.2, 12, 6);
  g.translate(0.9, 0, 0);
  const pos = g.getAttribute("position");
  const wind = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) wind[i] = (pos.getX(i) / 1.8) ** 1.3 * 3.2;
  g.setAttribute("aWind", new THREE.BufferAttribute(wind, 1));
  const mesh = new THREE.Mesh(g, flagMat);
  mesh.position.set(x + 0.05, y + height - 0.75, z);
  mesh.castShadow = true;
  ctx.root.add(mesh);
  const phase = x * 0.7 + z * 0.3;
  ctx.anim.push((t) => {
    mesh.rotation.y = 0.5 + Math.sin(t * 0.31 + phase) * 0.35 + Math.sin(t * 1.3 + phase) * 0.08;
    mesh.rotation.z = -0.1 + Math.sin(t * 0.8 + phase) * 0.05;
  });
}

/** Blinking marker light (mast beacons, hazard lamps). */
export function beacon(ctx: WorldCtx, x: number, y: number, z: number, color: number, period = 1.4, size = 0.09, offset = 0): void {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3.5), fog: false }));
  m.position.set(x, y, z);
  ctx.root.add(m);
  ctx.anim.push((t) => {
    m.visible = (t + offset) % period < period * 0.38;
  });
}

function tower(ctx: WorldCtx, b: Builder, x: number, z: number, yaw: number): void {
  const H = 5.2;
  b.at(x, 0, z, yaw, () => {
    for (const sx of [-1.2, 1.2]) for (const sz of [-1.2, 1.2]) b.box("wood", sx, (H + 2.3) / 2, sz, 0.16, H + 2.3, 0.16, { tint: 0x6a5a40 });
    for (const yy of [1.4, 3.4]) for (const s of [-1, 1]) {
      b.box("wood", 0, yy, s * 1.2, 2.5, 0.1, 0.06, { tint: 0x6a5a40, collide: "none" });
      b.box("wood", s * 1.2, yy, 0, 0.06, 0.1, 2.5, { tint: 0x6a5a40, collide: "none" });
      const m = new THREE.Matrix4().makeRotationZ(s * 0.7).setPosition(0, yy + 1, 1.2);
      b.push(m);
      b.box("wood", 0, 0, 0, 0.06, 3.1, 0.05, { tint: 0x5d4f38, collide: "none" });
      b.pop();
    }
    b.box("wood", 0, H, 0, 2.9, 0.1, 2.9, { tint: 0x7a6a4c });
    // Sandbag parapet, corrugated roof, ladder.
    for (const s of [-1, 1]) {
      P.sandbags(b, ctx.rand, 0, s * 1.25, 0, 2.8, 4, H + 0.05);
      P.sandbags(b, ctx.rand, s * 1.25, 0, Math.PI / 2, 2.2, 4, H + 0.05);
    }
    b.box("ribmetal", 0, H + 2.35, 0, 3.4, 0.05, 3.4, { tint: 0x55603f });
    for (const s of [-0.22, 0.22]) b.box("wood", s, H / 2, -1.36, 0.05, H, 0.05, { tint: 0x6a5a40, collide: "none" });
    for (let i = 1; i < 14; i++) b.box("wood", 0, i * 0.37, -1.36, 0.44, 0.04, 0.04, { tint: 0x6a5a40, collide: "none" });
    b.box("paintmetal", 1.0, H + 1.5, 1.42, 0.3, 0.22, 0.26, { tint: 0x2a2c2e, collide: "none" });
    b.box("emissive", 1.0, H + 1.5, 1.56, 0.24, 0.16, 0.02);
  });
}

/** Build the patrol base. The ground pad is laid by the caller's ground plan. */
export function patrolBase(ctx: WorldCtx, b: Builder): void {
  const [x0, z0, x1, z1] = CAMP;
  const r = ctx.rand;
  // ---- perimeter: double-stacked HESCO on three sides, the gate on the avenue side ----
  const run = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    P.hesco(b, (ax + bx) / 2, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), Math.round(len / 1.06), 2);
  };
  run(x0, z0, x1, z0);
  run(x1, z0, x1, z1);
  run(x0, z1, x1, z1);
  run(x0, z0, x0, 133.4);
  run(x0, 140.6, x0, z1);
  P.wire(b, (x0 + x1) / 2, z0 - 1.6, 0, x1 - x0 - 2);
  // Gate: sandbagged sentry posts, a lifting barrier, the base sign.
  P.sandbagPost(b, r, x0 + 2.2, 132, -Math.PI / 2, 3, 5);
  P.sandbagPost(b, r, x0 + 2.2, 142, -Math.PI / 2, 3, 5);
  b.box("paintmetal", x0 - 0.2, 0.6, 133.2, 0.2, 1.2, 0.2, { tint: 0x2a2c2e });
  b.push(new THREE.Matrix4().makeRotationX(-1.05).setPosition(x0 - 0.2, 1.05, 133.2));
  for (let i = 0; i < 8; i++) b.box("paintmetal", 0, 0, 0.4 + i * 0.72, 0.09, 0.09, 0.72, { tint: i % 2 ? 0xe8e6e0 : 0xc8302a, collide: "none" });
  b.pop();
  const sign = ctx.signs.text("camp:sign", 768, 256, "#3a4230", "#e8e2c4", [["PATROL BASE LION", 76], ["3 SIR  ·  SECTION 2-1", 36], ["MAKE WEAPONS SAFE BEYOND THIS POINT", 30]], { border: "#e8e2c4" });
  for (const sx of [-1, 1]) b.cyl("steel", x0 - 1.4, 1.2, 143.4 + sx * 1.3, 0.04, 2.4, 6, { tint: 0x55595c, collide: "none" });
  signQuad(b, sign, x0 - 1.46, 1.8, 143.4, 2.9, 1.0, -Math.PI / 2);
  for (const jz of [130.2, 144.6]) P.jersey(b, x0 - 4.2, jz, Math.PI / 2 + 0.25, 0xbfbcb2, true);

  // ---- interior ----
  tent(ctx, b, 44.5, 147.5, Math.PI / 2, 8.5, 5.4, 0x5a6344); // command post, opens north
  tent(ctx, b, 26.5, 148, Math.PI / 2, 7, 5, 0x6a7052); // aid post
  const cross = ctx.signs.add("camp:cross", 128, 128, (c) => {
    c.fillStyle = "#f2f0ea";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#c8202a";
    c.fillRect(48, 16, 32, 96);
    c.fillRect(16, 48, 96, 32);
  });
  signQuad(b, cross, 24.6, 1.5, 143.9, 0.7, 0.7, Math.PI);
  b.cyl("steel", 24.6, 0.75, 143.94, 0.025, 1.5, 5, { tint: 0x55595c, collide: "none" });
  // Command post furniture: map table, radio stack, folding chairs.
  b.box("wood", 44.5, 0.78, 148.4, 2.2, 0.05, 1.1, { tint: 0x5d6247 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl("steel", 44.5 + sx * 1.0, 0.39, 148.4 + sz * 0.45, 0.02, 0.78, 5, { tint: 0x3a3d38, collide: "none" });
  b.collisionBox(Surf.Wood, "solid", 44.5, 0.4, 148.4, 2.2, 0.8, 1.1);
  const map = ctx.signs.add("camp:map", 320, 200, (c, w, h) => {
    c.fillStyle = "#dcd6bc";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(90,120,80,.35)";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#b8b4a4";
    c.fillRect(148, 0, 22, h);
    c.fillRect(0, 96, w, 18);
    c.fillStyle = "#e8dcc0";
    for (const [px, py, pw, ph] of [[30, 130, 90, 20], [40, 30, 22, 56], [190, 120, 60, 30], [200, 30, 70, 46], [60, 40, 70, 40]]) c.fillRect(px, py, pw, ph);
    c.strokeStyle = "#1c3a8a";
    c.lineWidth = 3;
    c.strokeRect(182, 150, 40, 34);
    c.strokeStyle = "#b02a1e";
    for (const [px, py] of [[159, 104], [215, 135], [95, 60], [235, 52]]) {
      c.beginPath();
      c.moveTo(px - 9, py);
      c.lineTo(px, py - 9);
      c.lineTo(px + 9, py);
      c.lineTo(px, py + 9);
      c.closePath();
      c.stroke();
    }
  });
  b.at(44.5, 0.81, 148.4, 0, () => b.quad("sign", [-0.8, 0, 0.5], [0.8, 0, 0.5], [0.8, 0, -0.5], [-0.8, 0, -0.5], { collide: "none" }, [[map[0], map[1]], [map[2], map[1]], [map[2], map[3]], [map[0], map[3]]]));
  b.box("paintmetal", 46.4, 0.5, 150.8, 0.5, 1.0, 0.6, { tint: 0x464f34 });
  b.box("paintmetal", 46.4, 1.15, 150.8, 0.4, 0.3, 0.34, { tint: 0x2f3329, collide: "none" });
  for (const [cx, cz] of [[43.4, 147.2], [45.6, 147.2], [42.8, 149.4]]) {
    b.box("canvas", cx, 0.45, cz, 0.42, 0.04, 0.42, { tint: 0x4a5338 });
    b.box("canvas", cx, 0.72, cz - 0.2, 0.42, 0.5, 0.03, { tint: 0x4a5338, collide: "none" });
  }
  // Antenna mast beside the command post, with its beacon.
  b.cyl("steel", 49.6, 5.5, 151.6, 0.035, 11, 6, { tint: 0x55595c, collide: "none" });
  for (const a of [0, 2.1, 4.2]) {
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(0.36)).setPosition(49.6 + Math.cos(-a) * 1.6, 4.4, 151.6 + Math.sin(-a) * 1.6);
    b.push(m);
    b.cyl("trim", 0, 0, 0, 0.006, 9.4, 3, { tint: 0x9a9da0 });
    b.pop();
  }
  beacon(ctx, 49.6, 11.1, 151.6, 0xff2a1a, 1.6, 0.1);
  // Aid post: stretcher cots and medical panniers.
  for (const cz of [147, 149.4]) {
    b.box("canvas", 26.5, 0.42, cz, 1.9, 0.05, 0.66, { tint: 0x7a8060 });
    for (const sx of [-0.8, 0.8]) b.box("steel", 26.5 + sx, 0.21, cz, 0.04, 0.42, 0.6, { tint: 0x6a6d68, collide: "none" });
    b.collisionBox(Surf.Sandbag, "solid", 26.5, 0.22, cz, 1.9, 0.44, 0.66);
  }
  b.box("plastic", 29, 0.25, 150.6, 0.7, 0.5, 0.45, { tint: 0xd8d4c8 });
  b.box("plastic", 29, 0.52, 150.37, 0.2, 0.2, 0.01, { tint: 0xc8202a, collide: "none" });

  // Ammunition point under an open-sided shelter.
  const [ax, az] = [CAMP_AMMO.x, CAMP_AMMO.z];
  for (const sx of [-2.6, 2.6]) for (const sz of [-1.6, 1.6]) b.cyl("steel", ax + sx, 1.3, az - 1.4 + sz, 0.04, 2.6, 6, { tint: 0x3a3d38 });
  b.box("canvas", ax, 2.62, az - 1.4, 5.8, 0.05, 3.8, { tint: 0x55603f });
  P.pallet(b, ax - 1.3, 0.06, az - 1.6, 0);
  P.pallet(b, ax + 1.3, 0.06, az - 1.6, 0.03);
  for (let i = 0; i < 9; i++) P.ammoBox(b, ax - 1.75 + (i % 3) * 0.5, 0.2 + Math.floor(i / 3) * 0.21, az - 1.6 + (r() - 0.5) * 0.1, (r() - 0.5) * 0.12, 1.1);
  P.crate(b, ax + 1.0, 0.2, az - 1.75, 0.05, 0.8, 0.7, 0x5c6440);
  P.crate(b, ax + 1.8, 0.2, az - 1.5, -0.1, 0.7, 0.6, 0x5c6440);
  P.crate(b, ax + 1.3, 0.9, az - 1.7, 0.2, 0.6, 0.45, 0x5c6440);
  P.weaponCrate(b, ax - 0.2, 0.06, az - 0.3, 0.1, true);
  const amm = ctx.signs.text("camp:ammo", 384, 128, "#c8a020", "#1a1a16", [["AMMUNITION POINT", 40], ["NO SMOKING · NO NAKED LIGHTS", 20]], { border: "#1a1a16" });
  signQuad(b, amm, ax, 2.2, az + 0.52, 2.2, 0.72, 0);
  for (const sx of [-1.15, 1.15]) b.cyl("steel", ax + sx, 1.3, az + 0.5, 0.025, 2.6, 5, { tint: 0x3a3d38, collide: "none" });
  ctx.lamp(ax, 2.3, az - 1.2, 1.0, 7);

  // Vehicle park, fuel point, generator and floodlights.
  P.fiveTonner(b, 49, 135.5, 0);
  P.car(b, r, 43, 131.5, 0.1, { color: 0x4a5338, kind: "suv" });
  for (let i = 0; i < 4; i++) P.drum(b, 53.6, 0.06, 141 + i * 0.66, 0x4a5338);
  P.jerrycans(b, 52.2, 0.06, 143.6, Math.PI / 2, 5);
  b.box("paintmetal", 33.5, 0.55, 151.6, 1.5, 0.9, 0.8, { tint: 0x4a5338 });
  b.box("paintmetal", 33.5, 0.08, 151.6, 1.7, 0.1, 0.9, { tint: 0x2a2c2e, collide: "none" });
  b.cyl("steel", 34, 1.2, 151.6, 0.03, 0.4, 5, { tint: 0x2a2c2e, collide: "none" });
  for (const [fx, fz, fy] of [[20, 123.4, 0.8], [52.6, 151, -2.4]]) {
    b.cyl("steel", fx, 2.6, fz, 0.05, 5.2, 6, { tint: 0x55595c });
    b.at(fx, 5.2, fz, fy, () => {
      b.box("paintmetal", 0, 0, 0.1, 0.9, 0.3, 0.12, { tint: 0x2a2c2e, collide: "none" });
      b.box("emissive", 0, 0, 0.17, 0.8, 0.22, 0.02);
    });
    ctx.lamp(fx, 4.6, fz, 1.6, 14);
  }
  tower(ctx, b, 52.4, 124, 0);
  flag(ctx, b, 21.4, 127.4, 8, 0.06);
  // Stores scattered about: camp life.
  P.crate(b, 22.4, 0.06, 151.6, 0.3, 1.0, 0.9, 0x5c6440);
  P.crate(b, 23.6, 0.06, 152, -0.1, 0.8, 0.7, 0x5c6440);
  P.tyreStack(b, 55, 138.2, 3, 0.06);
  P.sandbags(b, r, 32, 138, 0.1, 3.6, 3, 0.06);
  for (let i = 0; i < 3; i++) b.box("canvas", 37.4 + i * 0.62, 0.3, 144, 0.5, 0.48, 0.32, { tint: 0x55603f });
  P.cone(b, x0 - 3, 134.6);
  P.cone(b, x0 - 3, 139.4);
}
