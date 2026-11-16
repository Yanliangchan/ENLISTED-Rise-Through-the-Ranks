import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Engine } from "~/core/engine";
import { canvasTex } from "~/gfx/textures";
import { fbm } from "~/gfx/noise";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Soldier: one skinned mesh generated in code. The body is lofted from
 * elliptical cross-sections along each bone with blended skin weights at the
 * joints (so elbows, knees and the waist bend as continuous cloth, not as
 * separate blocks), with rigid kit — helmet, plate carrier, pouches, boots —
 * bound to single bones. A 17-bone skeleton is posed procedurally every frame:
 * gait cycle, crouch, torso aim, two-bone arm IK onto the rifle, flinches and
 * collapse.
 */

const B = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, lUp: 5, lFore: 6, lHand: 7, rUp: 8, rFore: 9, rHand: 10, lThigh: 11, lShin: 12, lFoot: 13, rThigh: 14, rShin: 15, rFoot: 16 } as const;
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
const REST: number[][] = [
  [0, 0.96, 0], [0, 1.1, 0], [0, 1.26, 0], [0, 1.5, 0], [0, 1.6, 0],
  [0.2, 1.45, 0], [0.2, 1.17, 0], [0.2, 0.91, 0],
  [-0.2, 1.45, 0], [-0.2, 1.17, 0], [-0.2, 0.91, 0],
  [0.1, 0.92, 0], [0.1, 0.5, 0], [0.1, 0.09, 0],
  [-0.1, 0.92, 0], [-0.1, 0.5, 0], [-0.1, 0.09, 0],
];
const L_UP = 0.28;
const L_FORE = 0.26;
const L_THIGH = 0.42;
const L_SHIN = 0.41;

interface Acc {
  pos: number[]; nrm: number[]; uv: number[]; col: number[]; si: number[]; sw: number[];
  idx: number[][]; // per group
}

type Ring = [number, number, number, number, number, number, number]; // y, rx, rz, boneA, wA, boneB, wB
type Sel = [number, number, number];

/** Loft elliptical rings into a tube. `zc` shifts each ring fore/aft so limbs and torso can curve. */
function loft(a: Acc, group: number, cx: number, rings: Ring[], seg: number, color: Sel, zc: number[] = []): void {
  const base = a.pos.length / 3;
  for (let r = 0; r < rings.length; r++) {
    const [y, rx, rz, b0, w0, b1, w1] = rings[r];
    // Slope of the profile, so normals tilt where the tube flares or narrows.
    const p = rings[Math.max(0, r - 1)], n = rings[Math.min(rings.length - 1, r + 1)];
    const slope = ((n[1] + n[2]) / 2 - (p[1] + p[2]) / 2) / (n[0] - p[0] || 1);
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      a.pos.push(cx + c * rx, y, sn * rz + (zc[r] ?? 0));
      const nx = c / rx;
      const nz = sn / rz;
      const nl = Math.hypot(nx, nz);
      const ny = -slope;
      const l3 = Math.hypot(1, ny);
      a.nrm.push(nx / nl / l3, ny / l3, nz / nl / l3);
      a.uv.push((s / seg) * Math.max(1, Math.round(((rx + rz) * Math.PI) / 0.3)), y / 0.3);
      a.col.push(...color);
      a.si.push(b0, b1, 0, 0);
      a.sw.push(w0, w1, 0, 0);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const p = base + r * (seg + 1) + s;
      const q = p + seg + 1;
      if (rings[r + 1][0] > rings[r][0]) a.idx[group].push(p, q, p + 1, p + 1, q, q + 1);
      else a.idx[group].push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
}

function rigid(a: Acc, group: number, g: THREE.BufferGeometry, bone: number, color: Sel, x = 0, y = 0, z = 0): void {
  const gg = g.index ? g.toNonIndexed() : g;
  const base = a.pos.length / 3;
  const p = gg.getAttribute("position");
  const n = gg.getAttribute("normal");
  for (let i = 0; i < p.count; i++) {
    a.pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z);
    a.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    a.uv.push(p.getX(i) * 3, p.getY(i) * 3);
    a.col.push(...color);
    a.si.push(bone, 0, 0, 0);
    a.sw.push(1, 0, 0, 0);
    a.idx[group].push(base + i);
  }
}

const rbox = (w: number, h: number, d: number, r = 0.012): THREE.BufferGeometry => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));

/** Head and face covering: what makes each variant read differently at a glance. */
export type SoldierVariant = "operator" | "raider" | "wrapped" | "saf";

export interface SoldierLook {
  variant: SoldierVariant;
  uniform: THREE.Texture;
  /** Multiplies the uniform texture. */
  cloth: number;
  /** Boots and gloves. */
  dark: number;
  helmet: number;
  gear: number;
  pouch: number;
  skin: number;
  /** Balaclava / head wrap colour. */
  mask: number;
}

/** Black multi-terrain camouflage: charcoal blotches, low contrast, for the OPFOR fatigues. */
export function opforCamo(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (c) => {
      const img = c.createImageData(256, 256);
      const cols = [[60, 62, 65], [48, 50, 53], [72, 73, 72], [38, 40, 43], [56, 55, 52]];
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const v = fbm(x / 256, y / 256, 5, 4, 51) * 0.65 + fbm(x / 256, y / 256, 14, 2, 77) * 0.35;
        const k = v < 0.4 ? 0 : v < 0.5 ? 1 : v < 0.57 ? 2 : v < 0.64 ? 0 : v < 0.7 ? 4 : 3;
        // Ripstop weave: a faint grid plus fibre noise.
        const weave = (x % 4 === 0 || y % 4 === 0 ? 0.93 : 1) * (0.94 + fbm(x / 256, y / 256, 90, 2, 3) * 0.12);
        const i = (y * 256 + x) * 4;
        img.data[i] = cols[k][0] * weave;
        img.data[i + 1] = cols[k][1] * weave;
        img.data[i + 2] = cols[k][2] * weave;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    },
    { repeat: true }
  );
}

const geoCache = new Map<SoldierVariant, THREE.BufferGeometry>();

function buildGeometry(variant: SoldierVariant): THREE.BufferGeometry {
  const a: Acc = { pos: [], nrm: [], uv: [], col: [], si: [], sw: [], idx: [[], [], []] };
  const W: Sel = [1, 1, 1];
  const DARK: Sel = [0, 0, 0], HELM: Sel = [0.25, 0, 0], GEAR: Sel = [0.5, 0, 0], POUCH: Sel = [0.75, 0, 0], SKIN: Sel = [0, 1, 0], MASK: Sel = [0, 0, 1];
  const saf = variant === "saf";

  // ---- torso: pelvis, waist, ribcage, shoulders, neck (group 0 = fatigues) ----
  loft(a, 0, 0, [
    [0.82, 0.15, 0.108, B.hips, 1, 0, 0],
    [0.9, 0.168, 0.12, B.hips, 1, 0, 0],
    [0.98, 0.17, 0.122, B.hips, 1, 0, 0],
    [1.05, 0.156, 0.11, B.hips, 0.5, B.spine, 0.5],
    [1.12, 0.154, 0.11, B.spine, 0.8, B.chest, 0.2],
    [1.2, 0.166, 0.12, B.spine, 0.4, B.chest, 0.6],
    [1.3, 0.184, 0.132, B.chest, 1, 0, 0],
    [1.38, 0.19, 0.13, B.chest, 1, 0, 0],
    [1.44, 0.18, 0.118, B.chest, 1, 0, 0],
    [1.49, 0.12, 0.096, B.chest, 0.6, B.neck, 0.4],
    [1.525, 0.064, 0.068, B.neck, 1, 0, 0],
    [1.6, 0.058, 0.062, B.neck, 0.5, B.head, 0.5],
  ], 20, W, [0, 0, -0.004, 0, 0.004, 0.008, 0.008, 0.004, 0, 0, 0.004, 0.006]);
  for (const s of [1, -1]) {
    const th = s > 0 ? B.lThigh : B.rThigh;
    const sh = s > 0 ? B.lShin : B.rShin;
    const up = s > 0 ? B.lUp : B.rUp;
    const fo = s > 0 ? B.lFore : B.rFore;
    const ha = s > 0 ? B.lHand : B.rHand;
    const ft = s > 0 ? B.lFoot : B.rFoot;
    // Leg: seat, thigh, knee, calf, bloused cuff over the boot.
    loft(a, 0, s * 0.1, [
      [0.98, 0.084, 0.098, B.hips, 0.7, th, 0.3],
      [0.9, 0.092, 0.104, B.hips, 0.25, th, 0.75],
      [0.8, 0.09, 0.1, th, 1, 0, 0],
      [0.68, 0.08, 0.09, th, 1, 0, 0],
      [0.58, 0.07, 0.078, th, 0.8, sh, 0.2],
      [0.5, 0.066, 0.074, th, 0.5, sh, 0.5],
      [0.44, 0.064, 0.07, sh, 0.85, th, 0.15],
      [0.36, 0.066, 0.074, sh, 1, 0, 0],
      [0.27, 0.058, 0.064, sh, 1, 0, 0],
      [0.22, 0.064, 0.07, sh, 1, 0, 0],
      [0.19, 0.056, 0.06, sh, 1, 0, 0],
    ], 14, W, [0, 0, 0.004, 0.006, 0.006, 0.01, 0, -0.012, -0.008, -0.004, 0]);
    // Boot: shaft, heel and a rounded toe box.
    loft(a, 1, s * 0.1, [
      [0.2, 0.052, 0.056, sh, 0.7, ft, 0.3],
      [0.13, 0.05, 0.056, ft, 1, 0, 0],
      [0.06, 0.052, 0.064, ft, 1, 0, 0],
      [0.0, 0.054, 0.068, ft, 1, 0, 0],
    ], 12, DARK, [0, 0, 0.004, 0.006]);
    rigid(a, 1, rbox(0.104, 0.085, 0.2, 0.035), ft, DARK, s * 0.1, 0.045, 0.1);
    rigid(a, 1, rbox(0.11, 0.022, 0.29, 0.01), ft, DARK, s * 0.1, 0.011, 0.055);
    // Arm: deltoid, upper arm, elbow, forearm, glove cuff.
    loft(a, 0, s * 0.2, [
      [1.49, 0.054, 0.062, B.chest, 0.55, up, 0.45],
      [1.44, 0.064, 0.07, up, 1, 0, 0],
      [1.36, 0.06, 0.066, up, 1, 0, 0],
      [1.26, 0.053, 0.058, up, 1, 0, 0],
      [1.2, 0.049, 0.054, up, 0.65, fo, 0.35],
      [1.15, 0.049, 0.054, up, 0.35, fo, 0.65],
      [1.08, 0.05, 0.054, fo, 1, 0, 0],
      [0.98, 0.042, 0.045, fo, 1, 0, 0],
      [0.935, 0.037, 0.04, fo, 1, 0, 0],
    ], 12, W);
    // Glove: cuff, palm, curled fingers, thumb.
    loft(a, 1, s * 0.2, [
      [0.945, 0.041, 0.044, fo, 0.5, ha, 0.5],
      [0.915, 0.04, 0.036, ha, 1, 0, 0],
    ], 10, DARK);
    rigid(a, 1, rbox(0.082, 0.095, 0.04, 0.016), ha, DARK, s * 0.2, 0.868, 0);
    rigid(a, 1, rbox(0.078, 0.05, 0.05, 0.018), ha, DARK, s * 0.2, 0.812, 0.012);
    rigid(a, 1, rbox(0.026, 0.06, 0.03, 0.012), ha, DARK, s * 0.2 - s * 0.048, 0.872, 0.02);
    rigid(a, 1, rbox(0.07, 0.03, 0.012, 0.005), ha, GEAR, s * 0.2, 0.895, -0.024);
    // Knee and elbow pads: hard caps on a fabric backing.
    rigid(a, 1, new THREE.SphereGeometry(0.066, 12, 8).scale(0.95, 1.25, 0.6), sh, DARK, s * 0.1, 0.5, 0.058);
    rigid(a, 1, rbox(0.15, 0.03, 0.14, 0.01), sh, GEAR, s * 0.1, 0.43, 0.004);
    rigid(a, 1, new THREE.SphereGeometry(0.052, 10, 8).scale(1, 1.3, 0.6), fo, DARK, s * 0.2, 1.17, -0.046);
    if (!saf) rigid(a, 1, rbox(0.125, 0.07, 0.125, 0.02), up, GEAR, s * 0.2, 1.36, 0); // shoulder pocket / patch panel
  }

  // ---- head ----
  const HY = 1.672;
  // Skull under a balaclava (or bare, for friendlies): slightly egg-shaped, jaw narrower than crown.
  rigid(a, saf ? 2 : 1, new THREE.SphereGeometry(0.1, 20, 16).scale(0.9, 1.18, 1.0), B.head, saf ? SKIN : MASK, 0, HY, 0.006);
  rigid(a, saf ? 2 : 1, new THREE.SphereGeometry(0.062, 12, 10).scale(1.05, 0.9, 0.9), B.head, saf ? SKIN : MASK, 0, HY - 0.07, 0.04); // jaw and chin
  rigid(a, saf ? 2 : 1, new THREE.SphereGeometry(0.02, 8, 6).scale(0.9, 1.3, 1), B.head, saf ? SKIN : MASK, 0, HY - 0.012, 0.1); // nose
  if (!saf) {
    // The eye opening: a strip of skin sitting just proud of the knit, brow shadowed by a rolled edge.
    rigid(a, 2, new THREE.SphereGeometry(0.1, 16, 4, Math.PI / 2 - 0.86, 1.72, 1.36, 0.3).scale(0.905, 1.18, 1.012), B.head, SKIN, 0, HY, 0.007);
    rigid(a, 1, new THREE.TorusGeometry(0.066, 0.008, 5, 16, Math.PI).rotateZ(0).scale(1.18, 0.5, 1), B.head, MASK, 0, HY + 0.012, 0.074);
    for (const s of [-1, 1]) rigid(a, 1, new THREE.SphereGeometry(0.009, 6, 5), B.head, DARK, s * 0.034, HY + 0.008, 0.098); // eyes
  } else {
    for (const s of [-1, 1]) rigid(a, 1, new THREE.SphereGeometry(0.009, 6, 5), B.head, DARK, s * 0.034, HY + 0.012, 0.094);
  }
  if (variant === "operator" || saf) {
    // High-cut ballistic helmet: shell, brim roll, side rails, NVG shroud, rear counterweight pouch.
    const shell = new THREE.SphereGeometry(0.127, 22, 12, 0, Math.PI * 2, 0, Math.PI * (saf ? 0.6 : 0.52)).scale(1, 0.96, 1.13);
    rigid(a, 1, shell, B.head, HELM, 0, HY + 0.03, -0.004);
    rigid(a, 1, new THREE.TorusGeometry(0.126, 0.007, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.13), B.head, HELM, 0, HY + (saf ? -0.008 : 0.022), -0.004);
    if (!saf) {
      for (const s of [-1, 1]) {
        rigid(a, 1, rbox(0.014, 0.026, 0.13, 0.005), B.head, DARK, s * 0.127, HY + 0.045, 0);
        rigid(a, 1, new THREE.CylinderGeometry(0.043, 0.043, 0.036, 12).rotateZ(Math.PI / 2), B.head, DARK, s * 0.108, HY - 0.012, -0.005); // headset cup
        rigid(a, 1, rbox(0.012, 0.07, 0.02, 0.004), B.head, DARK, s * 0.118, HY + 0.03, -0.005);
      }
      rigid(a, 1, rbox(0.05, 0.042, 0.022, 0.006), B.head, DARK, 0, HY + 0.095, 0.134);
      rigid(a, 1, rbox(0.075, 0.055, 0.035, 0.012), B.head, GEAR, 0, HY + 0.06, -0.145);
      rigid(a, 1, new THREE.CylinderGeometry(0.004, 0.004, 0.09, 5).rotateX(Math.PI / 2 - 0.5), B.head, DARK, -0.1, HY - 0.05, 0.05); // boom mic
      // Chin strap.
      for (const s of [-1, 1]) rigid(a, 1, rbox(0.006, 0.1, 0.014, 0.002).rotateZ(s * 0.18), B.head, DARK, s * 0.088, HY - 0.06, 0.03);
    } else {
      rigid(a, 1, rbox(0.03, 0.012, 0.02, 0.004), B.head, DARK, 0, HY + 0.06, 0.142);
    }
  } else if (variant === "raider") {
    // Watch cap rolled above the eyes, ballistic goggles pushed up, earpiece.
    rigid(a, 1, new THREE.SphereGeometry(0.104, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.46).scale(0.93, 1.16, 1.02), B.head, HELM, 0, HY + 0.008, 0.004);
    rigid(a, 1, new THREE.TorusGeometry(0.094, 0.013, 6, 20).rotateX(Math.PI / 2).scale(0.93, 1, 1.02), B.head, HELM, 0, HY + 0.044, 0.004);
    rigid(a, 1, rbox(0.15, 0.042, 0.03, 0.014), B.head, DARK, 0, HY + 0.062, 0.088);
    rigid(a, 1, new THREE.TorusGeometry(0.098, 0.007, 4, 18).rotateX(Math.PI / 2 - 0.12).scale(0.93, 1, 1.02), B.head, DARK, 0, HY + 0.058, 0);
  } else {
    // Head wrap: cloth bound over the crown with a tail down the neck, scarf bunched at the throat.
    rigid(a, 1, new THREE.SphereGeometry(0.108, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.95, 1.14, 1.04), B.head, POUCH, 0, HY + 0.012, 0);
    rigid(a, 1, new THREE.TorusGeometry(0.097, 0.016, 6, 20).rotateX(Math.PI / 2 + 0.16).scale(0.95, 1, 1.04), B.head, POUCH, 0, HY + 0.04, 0);
    rigid(a, 1, rbox(0.1, 0.17, 0.03, 0.012).rotateX(0.18), B.head, POUCH, 0.02, HY - 0.07, -0.098);
    rigid(a, 1, new THREE.TorusGeometry(0.078, 0.034, 8, 18).rotateX(Math.PI / 2).scale(1.1, 1, 1), B.neck, POUCH, 0, 1.535, 0.012);
    rigid(a, 1, rbox(0.11, 0.12, 0.03, 0.014).rotateX(-0.25), B.chest, POUCH, 0.01, 1.46, 0.105);
  }

  // ---- load-bearing kit ----
  // Plate carrier: a shell lofted just outside the ribcage, with plate bags front and back.
  loft(a, 1, 0, [
    [1.08, 0.166, 0.124, B.spine, 0.6, B.chest, 0.4],
    [1.1, 0.184, 0.144, B.spine, 0.5, B.chest, 0.5],
    [1.2, 0.193, 0.152, B.chest, 1, 0, 0],
    [1.34, 0.2, 0.154, B.chest, 1, 0, 0],
    [1.42, 0.196, 0.144, B.chest, 1, 0, 0],
    [1.455, 0.16, 0.12, B.chest, 1, 0, 0],
  ], 20, GEAR, [0, 0.004, 0.008, 0.008, 0.004, 0]);
  rigid(a, 1, rbox(0.25, 0.29, 0.04, 0.03), B.chest, GEAR, 0, 1.3, 0.146);
  rigid(a, 1, rbox(0.26, 0.31, 0.04, 0.03), B.chest, GEAR, 0, 1.3, -0.14);
  for (const s of [-1, 1]) {
    // Shoulder straps over the top, with a comms cable guide on one.
    rigid(a, 1, new THREE.TorusGeometry(0.09, 0.017, 5, 12, Math.PI).rotateY(Math.PI / 2).scale(0.9, 0.62, 1.5), B.chest, GEAR, s * 0.105, 1.445, 0.002);
    // Cummerbund side panels with a pouch each.
    rigid(a, 1, rbox(0.03, 0.15, 0.2, 0.012), B.chest, GEAR, s * 0.196, 1.2, 0.002);
    rigid(a, 1, rbox(0.05, 0.1, 0.075, 0.018), B.chest, POUCH, s * 0.218, 1.2, s > 0 ? 0.03 : -0.02);
  }
  // Three rifle-magazine pouches with the magazines standing proud, and an admin pouch above.
  for (const sx of [-0.088, 0, 0.088]) {
    rigid(a, 1, rbox(0.078, 0.13, 0.044, 0.014), B.chest, POUCH, sx, 1.175, 0.184);
    rigid(a, 1, rbox(0.056, 0.05, 0.024, 0.006).rotateX(0.08), B.chest, DARK, sx, 1.26, 0.186);
    rigid(a, 1, rbox(0.03, 0.012, 0.05, 0.003), B.chest, DARK, sx, 1.238, 0.188);
  }
  rigid(a, 1, rbox(0.15, 0.075, 0.03, 0.012), B.chest, POUCH, 0.035, 1.375, 0.168);
  if (!saf) {
    // Radio on the back of the left shoulder with a whip antenna; push-to-talk on the chest.
    rigid(a, 1, rbox(0.06, 0.13, 0.04, 0.01), B.chest, DARK, 0.125, 1.39, -0.17);
    rigid(a, 1, new THREE.CylinderGeometry(0.004, 0.006, 0.3, 5), B.chest, DARK, 0.14, 1.6, -0.17);
    rigid(a, 1, rbox(0.035, 0.045, 0.02, 0.006), B.chest, DARK, -0.11, 1.4, 0.166);
    // Fragmentation grenades on the cummerbund.
    rigid(a, 1, new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.25, 1), B.chest, DARK, -0.15, 1.13, 0.14);
    rigid(a, 1, new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1.25, 1), B.chest, DARK, 0.155, 1.13, 0.13);
  }
  // Assault pack: main bag, lid roll, compression straps.
  rigid(a, 1, rbox(0.25, 0.3, 0.1, 0.045), B.chest, POUCH, 0, 1.31, -0.205);
  rigid(a, 1, new THREE.CylinderGeometry(0.05, 0.05, 0.24, 10).rotateZ(Math.PI / 2), B.chest, POUCH, 0, 1.47, -0.19);
  for (const sx of [-0.07, 0.07]) rigid(a, 1, rbox(0.022, 0.3, 0.012, 0.003), B.chest, DARK, sx, 1.31, -0.257);
  // Battle belt: belt, buckle, pouches, dump pouch, drop-leg holster with the pistol's grip showing.
  loft(a, 1, 0, [
    [0.975, 0.176, 0.128, B.hips, 1, 0, 0],
    [0.99, 0.181, 0.133, B.hips, 1, 0, 0],
    [1.03, 0.181, 0.133, B.hips, 1, 0, 0],
    [1.045, 0.174, 0.126, B.hips, 1, 0, 0],
  ], 18, GEAR);
  rigid(a, 1, rbox(0.05, 0.04, 0.014, 0.004), B.hips, DARK, 0, 1.01, 0.134);
  rigid(a, 1, rbox(0.06, 0.12, 0.09, 0.016), B.hips, POUCH, 0.19, 0.97, 0.03);
  rigid(a, 1, rbox(0.13, 0.13, 0.07, 0.03), B.hips, POUCH, 0.1, 0.95, -0.14);
  rigid(a, 1, rbox(0.075, 0.1, 0.05, 0.014), B.hips, POUCH, -0.11, 0.97, -0.135);
  rigid(a, 1, rbox(0.05, 0.19, 0.11, 0.014), B.rThigh, DARK, -0.196, 0.79, 0.01);
  rigid(a, 1, rbox(0.03, 0.07, 0.045, 0.008).rotateX(-0.3), B.rThigh, DARK, -0.205, 0.905, -0.012);
  for (const yy of [0.84, 0.73]) rigid(a, 1, new THREE.TorusGeometry(0.094, 0.009, 4, 14).rotateX(Math.PI / 2), B.rThigh, DARK, -0.1, yy, 0);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(a.nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
  g.setAttribute("sel", new THREE.Float32BufferAttribute(a.col, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(a.si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(a.sw, 4));
  const index: number[] = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    g.addGroup(off, a.idx[i].length, i);
    index.push(...a.idx[i]);
    off += a.idx[i].length;
  }
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
  return g;
}

/** Rifle built along +Z with the grip at the origin: a railed, suppressed AK for OPFOR, a bullpup for the SAF. */
function rifleGeometry(bullpup: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: number, x: number, y: number, z: number, rx = 0): void => {
    const gg = g.index ? g.toNonIndexed() : g.clone();
    if (rx) gg.rotateX(rx);
    gg.translate(x, y, z);
    const c = new THREE.Color(col);
    const n = gg.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    gg.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    gg.deleteAttribute("uv");
    parts.push(gg);
  };
  const steel = 0x1d1f22, poly = 0x26282b, worn = 0x3a3c40;
  const cyl = (r: number, l: number, seg = 10): THREE.BufferGeometry => new THREE.CylinderGeometry(r, r, l, seg);
  if (bullpup) {
    add(rbox(0.05, 0.085, 0.5, 0.014), poly, 0, 0.05, -0.08);
    add(rbox(0.046, 0.06, 0.2, 0.012), poly, 0, 0.04, 0.27);
    add(cyl(0.012, 0.2), steel, 0, 0.05, 0.45, Math.PI / 2);
    add(cyl(0.016, 0.05), steel, 0, 0.05, 0.55, Math.PI / 2);
    add(cyl(0.02, 0.2, 12), poly, 0, 0.135, 0.06, Math.PI / 2);
    add(rbox(0.016, 0.03, 0.26, 0.004), poly, 0, 0.105, 0.06);
    add(rbox(0.04, 0.11, 0.05, 0.012), poly, 0, -0.03, 0.02, 0.2);
    add(rbox(0.034, 0.17, 0.065, 0.008), worn, 0, -0.07, -0.19, -0.12);
  } else {
    // Receiver, dust cover, rear trunnion.
    add(rbox(0.044, 0.062, 0.27, 0.01), steel, 0, 0.05, 0.09);
    add(rbox(0.04, 0.02, 0.2, 0.008), worn, 0, 0.088, 0.07);
    // Railed handguard, gas tube, barrel, front sight block.
    add(rbox(0.05, 0.052, 0.21, 0.008), poly, 0, 0.046, 0.33);
    for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.022, 0.008, 0.016), steel, 0, 0.078, 0.245 + i * 0.027);
    add(cyl(0.009, 0.2, 8), steel, 0, 0.084, 0.36, Math.PI / 2);
    add(cyl(0.0105, 0.22, 8), steel, 0, 0.056, 0.53, Math.PI / 2);
    add(new THREE.BoxGeometry(0.014, 0.05, 0.02), steel, 0, 0.082, 0.6);
    // Suppressor.
    add(cyl(0.021, 0.19, 12), steel, 0, 0.056, 0.72, Math.PI / 2);
    add(cyl(0.0225, 0.012, 12), worn, 0, 0.056, 0.64, Math.PI / 2);
    // Curved magazine in three steps.
    add(rbox(0.03, 0.085, 0.062, 0.006), worn, 0, -0.03, 0.135, -0.22);
    add(rbox(0.03, 0.085, 0.06, 0.006), worn, 0, -0.1, 0.16, -0.42);
    add(rbox(0.03, 0.07, 0.058, 0.006), worn, 0, -0.158, 0.194, -0.62);
    // Pistol grip, trigger guard, polymer stock with cheek riser and butt pad.
    add(rbox(0.034, 0.105, 0.046, 0.01), poly, 0, -0.036, -0.03, 0.26);
    add(new THREE.TorusGeometry(0.026, 0.004, 4, 10, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI), steel, 0, 0.012, 0.045);
    add(rbox(0.034, 0.05, 0.22, 0.01), poly, 0, 0.04, -0.16);
    add(rbox(0.036, 0.1, 0.045, 0.01), poly, 0, 0.012, -0.285);
    add(rbox(0.03, 0.026, 0.14, 0.008), poly, 0, 0.074, -0.16);
    // Red-dot sight on a riser, weapon light under the handguard.
    add(rbox(0.036, 0.016, 0.07, 0.004), steel, 0, 0.104, 0.1);
    add(rbox(0.04, 0.046, 0.058, 0.01), poly, 0, 0.134, 0.1);
    add(cyl(0.014, 0.004, 10), 0x3a1410, 0, 0.136, 0.131, Math.PI / 2);
    add(cyl(0.014, 0.075, 10), steel, 0.036, 0.046, 0.4, Math.PI / 2);
    // Sling loop.
    add(new THREE.TorusGeometry(0.012, 0.003, 4, 8), worn, 0.026, 0.05, -0.05);
  }
  const g = mergeGeometries(parts)!;
  return g;
}

export interface Pose {
  /** Walk-cycle phase, radians. */
  phase: number;
  /** Ground speed, m/s. */
  speed: number;
  crouch: number;
  /** Torso yaw relative to the legs, radians. */
  aimYaw: number;
  aimPitch: number;
  /** 0 = low ready, 1 = shouldered and aiming. */
  aim: number;
  kick: number;
  flinch: number;
  /** 0 = alive, 0..1 = collapsing. */
  dead: number;
  deadKind: number;
  /** Seconds, for idle breathing and weight shift. */
  time?: number;
  /** Head turn relative to the chest, radians. */
  headYaw?: number;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qAim = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler();

export interface SoldierMats {
  variant: SoldierVariant;
  uniform: THREE.MeshStandardMaterial;
  gear: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  rifle: THREE.MeshStandardMaterial;
}

export function soldierMaterials(engine: Engine, look: SoldierLook): SoldierMats {
  // Palette selectors stored in the geometry resolve to this look's colours in the shader.
  const patch = (m: THREE.MeshStandardMaterial, palette: number[]): THREE.MeshStandardMaterial => {
    engine.lit(m, { rim: 0.5 });
    const lit = m.onBeforeCompile.bind(m);
    const cols = palette.map((h) => new THREE.Color(h));
    m.customProgramCacheKey = () => `sold2:${palette.join(",")}`;
    m.onBeforeCompile = (sh, r) => {
      lit(sh, r);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 sel;\nvarying vec3 vSel;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vSel = sel;");
      const v = (c: THREE.Color): string => `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSel;")
        .replace("#include <map_fragment>", `#include <map_fragment>\n  diffuseColor.rgb *= mix(mix(mix(${v(cols[0])}, ${v(cols[1])}, step(0.2, vSel.r)), ${v(cols[2])}, step(0.45, vSel.r)), ${v(cols[3])}, step(0.7, vSel.r));\n  diffuseColor.rgb = mix(diffuseColor.rgb, ${v(cols[4])}, step(0.5, vSel.g));\n  diffuseColor.rgb = mix(diffuseColor.rgb, ${v(cols[5])}, step(0.5, vSel.b));`);
    };
    return m;
  };
  const pal = [look.dark, look.helmet, look.gear, look.pouch, look.skin, look.mask];
  return {
    variant: look.variant,
    uniform: engine.lit(new THREE.MeshStandardMaterial({ map: look.uniform, color: look.cloth, roughness: 0.94 }), { rim: 0.5 }),
    gear: patch(new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.05 }), pal),
    skin: patch(new THREE.MeshStandardMaterial({ roughness: 0.62 }), [look.skin, look.skin, look.skin, look.skin, look.skin, look.mask]),
    rifle: engine.lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 }), { rim: 0.5 }),
  };
}

const rifleCache = new Map<boolean, THREE.BufferGeometry>();

export class SoldierModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly rifle: THREE.Mesh;
  private readonly bones: THREE.Bone[] = [];
  private readonly mesh: THREE.SkinnedMesh;
  /** Rifle muzzle in world space, updated by `pose`. */
  readonly muzzle = new THREE.Vector3();
  /** Head centre in world space. */
  readonly headPos = new THREE.Vector3();
  readonly chestPos = new THREE.Vector3();
  private limp = [0, 0, 0, 0];

  constructor(mats: SoldierMats) {
    let sharedGeo = geoCache.get(mats.variant);
    if (!sharedGeo) geoCache.set(mats.variant, (sharedGeo = buildGeometry(mats.variant)));
    const bullpup = mats.variant === "saf";
    let sharedRifle = rifleCache.get(bullpup);
    if (!sharedRifle) rifleCache.set(bullpup, (sharedRifle = rifleGeometry(bullpup)));
    for (let i = 0; i < REST.length; i++) {
      const b = new THREE.Bone();
      const p = PARENT[i];
      if (p >= 0) {
        b.position.set(REST[i][0] - REST[p][0], REST[i][1] - REST[p][1], REST[i][2] - REST[p][2]);
        this.bones[p].add(b);
      } else b.position.set(REST[i][0], REST[i][1], REST[i][2]);
      this.bones.push(b);
    }
    this.mesh = new THREE.SkinnedMesh(sharedGeo, [mats.uniform, mats.gear, mats.skin]);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.body.add(this.mesh);
    this.rifle = new THREE.Mesh(sharedRifle, mats.rifle);
    this.rifle.castShadow = true;
    this.body.add(this.rifle);
    this.root.add(this.body);
    this.limp = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
  }

  /** Two-bone IK: point `up`→`fore` at `target` from `shoulder`, elbow toward `pole`. Returns world quats via out params. */
  private armIK(up: THREE.Bone, fore: THREE.Bone, shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, parentQ: THREE.Quaternion): void {
    const n = _v.subVectors(target, shoulder);
    const d = Math.max(0.06, Math.min(L_UP + L_FORE - 0.004, n.length()));
    n.normalize();
    const aa = (L_UP * L_UP - L_FORE * L_FORE + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, L_UP * L_UP - aa * aa));
    const perp = _v2.copy(pole).addScaledVector(n, -pole.dot(n)).normalize();
    const elbow = new THREE.Vector3().copy(shoulder).addScaledVector(n, aa).addScaledVector(perp, hh);
    const dirU = elbow.clone().sub(shoulder).normalize();
    const dirF = new THREE.Vector3().copy(shoulder).addScaledVector(n, d).sub(elbow).normalize();
    const qU = new THREE.Quaternion().setFromUnitVectors(DOWN, dirU);
    const qF = new THREE.Quaternion().setFromUnitVectors(DOWN, dirF);
    up.quaternion.copy(parentQ).invert().multiply(qU);
    fore.quaternion.copy(qU).invert().multiply(qF);
  }

  pose(p: Pose): void {
    const bn = this.bones;
    const gait = Math.min(1, p.speed / 4.6);
    const moving = p.speed > 0.15 ? 1 : 0;
    const dying = p.dead;
    const c = Math.min(1, p.crouch + dying * 0.5);

    // ---- legs (forward kinematics gait) ---------------------------------------
    let hipY = 0;
    const legs: Array<[THREE.Bone, THREE.Bone, THREE.Bone, number]> = [
      [bn[B.lThigh], bn[B.lShin], bn[B.lFoot], 0],
      [bn[B.rThigh], bn[B.rShin], bn[B.rFoot], Math.PI],
    ];
    for (const [thigh, shin, foot, off] of legs) {
      const ph = p.phase + off;
      const swing = Math.sin(ph) * (0.22 + 0.48 * gait) * moving;
      const tt = c * 1.0 + swing + gait * 0.08;
      const kk = c * 1.85 + Math.max(0, -Math.cos(ph + 0.5)) * (0.25 + 0.95 * gait) * moving + 0.06;
      thigh.rotation.set(-tt, 0, 0);
      shin.rotation.set(kk, 0, 0);
      foot.rotation.set(tt - kk, 0, 0);
      hipY = Math.max(hipY, L_THIGH * Math.cos(tt) + L_SHIN * Math.cos(kk - tt));
    }
    const bob = Math.abs(Math.sin(p.phase)) * 0.035 * gait * moving;
    const hips = bn[B.hips];
    hips.position.set(0, hipY + 0.09 + 0.04 - bob, -c * 0.06);
    hips.rotation.set(c * 0.12, Math.sin(p.phase) * 0.1 * gait * moving, 0);

    // ---- spine -----------------------------------------------------------------
    const lean = 0.05 + gait * 0.16 + c * 0.3;
    bn[B.spine].rotation.set(lean * 0.6 - p.aimPitch * 0.25 - p.flinch * 0.3, p.aimYaw * 0.4, p.flinch * 0.15);
    bn[B.chest].rotation.set(lean * 0.4 - p.aimPitch * 0.3, p.aimYaw * 0.45, 0);
    bn[B.neck].rotation.set(-lean * 0.5, p.aimYaw * 0.1, 0);
    const tt0 = p.time ?? 0;
    const still = (1 - gait * moving) * (1 - dying);
    const breath = Math.sin(tt0 * 1.7 + this.limp[0] * 9) * 0.012 * still;
    bn[B.chest].rotation.x += breath;
    bn[B.spine].rotation.z += Math.sin(tt0 * 0.43 + this.limp[1] * 7) * 0.02 * still;
    bn[B.head].rotation.set(-lean * 0.45 - p.aimPitch * 0.35 + dying * 0.5 - breath, p.aimYaw * 0.05 + (p.headYaw ?? 0) * (1 - dying), dying * this.limp[0]);

    // World orientation of the chest (model space), tracked by hand.
    const qH = _q.setFromEuler(hips.rotation).clone();
    const qS = qH.clone().multiply(_q.setFromEuler(bn[B.spine].rotation));
    const qC = qS.clone().multiply(_q.setFromEuler(bn[B.chest].rotation));
    const pS = hips.position.clone().add(_v.set(0, 0.14, 0).applyQuaternion(qH));
    const pC = pS.clone().add(_v.set(0, 0.16, 0).applyQuaternion(qS));

    // ---- rifle and arms ---------------------------------------------------------
    const aim = p.aim * (1 - dying);
    const yawA = p.aimYaw + (1 - aim) * 0.45;
    const pitchA = p.aimPitch * aim - (1 - aim) * 0.62 + p.kick * 0.06;
    _qAim.setFromEuler(_e.set(-pitchA, yawA, (1 - aim) * 0.25, "YXZ"));
    const fwd = _v.set(0, 0, 1).applyQuaternion(_qAim).clone();
    const upv = _v.set(0, 1, 0).applyQuaternion(_qAim).clone();
    const anchor = pC.clone().add(_v.set(-0.115, 0.15 - (1 - aim) * 0.16, 0.1).applyQuaternion(qC)).addScaledVector(fwd, -p.kick * 0.02);
    this.rifle.position.copy(anchor).addScaledVector(fwd, 0.16);
    this.rifle.quaternion.copy(_qAim);
    const rTarget = this.rifle.position.clone().addScaledVector(upv, -0.02);
    const lTarget = this.rifle.position.clone().addScaledVector(fwd, 0.33).addScaledVector(upv, 0.02);
    const shR = pC.clone().add(_v.set(-0.2, 0.19, 0).applyQuaternion(qC));
    const shL = pC.clone().add(_v.set(0.2, 0.19, 0).applyQuaternion(qC));
    if (dying < 0.05) {
      this.armIK(bn[B.rUp], bn[B.rFore], shR, rTarget, _pole.set(-0.5, -1, -0.5), qC);
      this.armIK(bn[B.lUp], bn[B.lFore], shL, lTarget, _pole.set(0.6, -1, -0.2), qC);
    } else {
      // Arms go slack.
      bn[B.rUp].quaternion.slerp(_q2.setFromEuler(_e.set(this.limp[1] * 1.2, 0, -0.5 + this.limp[2], "XYZ")), 0.2);
      bn[B.lUp].quaternion.slerp(_q2.setFromEuler(_e.set(this.limp[2] * 1.2, 0, 0.6 + this.limp[3], "XYZ")), 0.2);
      bn[B.rFore].quaternion.slerp(_q2.setFromEuler(_e.set(-0.4 + this.limp[0], 0, 0, "XYZ")), 0.2);
      bn[B.lFore].quaternion.slerp(_q2.setFromEuler(_e.set(-0.6 + this.limp[1], 0, 0, "XYZ")), 0.2);
    }

    // ---- collapse: the whole body pivots about the feet onto the ground -------------
    if (dying > 0) {
      const t = dying * dying * (3 - 2 * dying);
      const dir = p.deadKind < 1 ? -1 : p.deadKind < 2 ? 1 : 0;
      if (dir !== 0) {
        this.body.rotation.set(dir * t * (Math.PI / 2) * 0.97, 0, this.limp[3] * 0.3 * t);
        this.body.position.set(0, t * 0.14, 0);
      } else {
        this.body.rotation.set(0, 0, (this.limp[0] > 0 ? 1 : -1) * t * (Math.PI / 2) * 0.96);
        this.body.position.set(0, t * 0.2, 0);
      }
      // The rifle drops beside the body.
      this.rifle.position.set(0.35 * (this.limp[1] > 0 ? 1 : -1), Math.max(0.04, 1.1 * (1 - t)), 0.3);
      this.rifle.rotation.set(0, this.limp[2] * 3, Math.PI / 2);
    } else {
      this.body.rotation.set(0, 0, 0);
      this.body.position.set(0, 0, 0);
    }

    // Derived world-space points.
    this.root.updateWorldMatrix(true, false);
    this.body.updateWorldMatrix(false, false);
    this.muzzle.copy(this.rifle.position).addScaledVector(fwd, 0.78).addScaledVector(upv, 0.055).applyMatrix4(this.body.matrixWorld);
    this.chestPos.copy(pC).applyMatrix4(this.body.matrixWorld);
    this.headPos.copy(pC).add(_v.set(0, 0.42, 0.02).applyQuaternion(qC)).applyMatrix4(this.body.matrixWorld);
    void X;
    void Y;
    void Z;
  }
}
