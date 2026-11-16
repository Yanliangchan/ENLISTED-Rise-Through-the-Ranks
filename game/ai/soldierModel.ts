import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Engine } from "~/core/engine";
import { canvasTex } from "~/gfx/textures";
import { fbm } from "~/gfx/noise";

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

function loft(a: Acc, group: number, cx: number, rings: Ring[], seg: number, color: [number, number, number]): void {
  const base = a.pos.length / 3;
  for (let r = 0; r < rings.length; r++) {
    const [y, rx, rz, b0, w0, b1, w1] = rings[r];
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      a.pos.push(cx + c * rx, y, sn * rz);
      const nx = c / rx;
      const nz = sn / rz;
      const nl = Math.hypot(nx, nz);
      a.nrm.push(nx / nl, 0, nz / nl);
      a.uv.push((s / seg) * Math.max(1, Math.round((rx + rz) * Math.PI / 0.3)), y / 0.3);
      a.col.push(...color);
      a.si.push(b0, b1, 0, 0);
      a.sw.push(w0, w1, 0, 0);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const p = base + r * (seg + 1) + s;
      const q = p + seg + 1;
      // Rings are listed bottom-to-top or top-to-bottom; pick the winding that faces outward.
      if (rings[r + 1][0] > rings[r][0]) a.idx[group].push(p, q, p + 1, p + 1, q, q + 1);
      else a.idx[group].push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
}

function rigid(a: Acc, group: number, g: THREE.BufferGeometry, bone: number, color: [number, number, number], x = 0, y = 0, z = 0): void {
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

const hex = (h: number): [number, number, number] => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

export interface SoldierLook {
  uniform: THREE.Texture;
  gear: number;
  helmet: number;
  skin: number;
  /** Lower-face cover colour, or null for a bare face. */
  mask: number | null;
  armband: number | null;
}

/** OPFOR fatigues: broad tan/olive/brown woodland blotches (deliberately not the SAF pixel pattern). */
export function opforCamo(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (c) => {
      const img = c.createImageData(256, 256);
      const cols = [[104, 96, 70], [82, 80, 54], [62, 56, 40], [44, 48, 34]];
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const v = fbm(x / 256, y / 256, 4, 4, 51) * 0.7 + fbm(x / 256, y / 256, 11, 2, 77) * 0.3;
        const k = v < 0.42 ? 0 : v < 0.52 ? 1 : v < 0.6 ? 2 : v < 0.66 ? 0 : 3;
        const n = 0.92 + fbm(x / 256, y / 256, 60, 2, 3) * 0.16;
        const i = (y * 256 + x) * 4;
        img.data[i] = cols[k][0] * n;
        img.data[i + 1] = cols[k][1] * n;
        img.data[i + 2] = cols[k][2] * n;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    },
    { repeat: true }
  );
}

let sharedGeo: THREE.BufferGeometry | null = null;

function buildGeometry(): THREE.BufferGeometry {
  const a: Acc = { pos: [], nrm: [], uv: [], col: [], si: [], sw: [], idx: [[], [], []] };
  const W: [number, number, number] = [1, 1, 1];
  // Torso.
  loft(a, 0, 0, [
    [0.84, 0.16, 0.112, B.hips, 1, 0, 0],
    [0.96, 0.172, 0.122, B.hips, 1, 0, 0],
    [1.06, 0.158, 0.112, B.hips, 0.5, B.spine, 0.5],
    [1.16, 0.162, 0.116, B.spine, 0.6, B.chest, 0.4],
    [1.3, 0.186, 0.13, B.chest, 1, 0, 0],
    [1.42, 0.19, 0.124, B.chest, 1, 0, 0],
    [1.49, 0.125, 0.1, B.chest, 0.6, B.neck, 0.4],
    [1.53, 0.06, 0.064, B.neck, 1, 0, 0],
    [1.6, 0.056, 0.06, B.neck, 0.5, B.head, 0.5],
  ], 14, W);
  for (const s of [1, -1]) {
    const th = s > 0 ? B.lThigh : B.rThigh;
    const sh = s > 0 ? B.lShin : B.rShin;
    const up = s > 0 ? B.lUp : B.rUp;
    const fo = s > 0 ? B.lFore : B.rFore;
    const ha = s > 0 ? B.lHand : B.rHand;
    const ft = s > 0 ? B.lFoot : B.rFoot;
    loft(a, 0, s * 0.1, [
      [0.97, 0.086, 0.096, B.hips, 0.6, th, 0.4],
      [0.86, 0.09, 0.1, th, 1, 0, 0],
      [0.68, 0.078, 0.088, th, 1, 0, 0],
      [0.56, 0.066, 0.074, th, 0.75, sh, 0.25],
      [0.5, 0.064, 0.07, th, 0.5, sh, 0.5],
      [0.44, 0.062, 0.068, sh, 0.8, th, 0.2],
      [0.3, 0.06, 0.066, sh, 1, 0, 0],
      [0.15, 0.05, 0.054, sh, 1, 0, 0],
    ], 10, W);
    loft(a, 0, s * 0.2, [
      [1.48, 0.058, 0.064, B.chest, 0.5, up, 0.5],
      [1.4, 0.06, 0.064, up, 1, 0, 0],
      [1.26, 0.052, 0.056, up, 1, 0, 0],
      [1.2, 0.048, 0.052, up, 0.65, fo, 0.35],
      [1.15, 0.048, 0.052, up, 0.35, fo, 0.65],
      [1.05, 0.046, 0.05, fo, 1, 0, 0],
      [0.94, 0.038, 0.04, fo, 1, 0, 0],
    ], 9, W);
    // Shoulder cap, glove, boot, knee pad.
    rigid(a, 0, new THREE.SphereGeometry(0.066, 10, 8), up, W, s * 0.2, 1.45, 0);
    rigid(a, 1, new THREE.SphereGeometry(0.046, 8, 6).scale(0.85, 1.25, 1), ha, [0, 0, 0], s * 0.2, 0.87, 0);
    rigid(a, 1, new THREE.BoxGeometry(0.105, 0.2, 0.13), ft, [1, 0, 0], s * 0.1, 0.11, -0.01);
    rigid(a, 1, new THREE.BoxGeometry(0.1, 0.085, 0.2), ft, [1, 0, 0], s * 0.1, 0.045, 0.085);
    rigid(a, 1, new THREE.BoxGeometry(0.11, 0.13, 0.05), sh, [0.5, 0, 0], s * 0.1, 0.47, 0.065);
  }
  // Head: face, mask, helmet with rim and rails.
  rigid(a, 2, new THREE.SphereGeometry(0.1, 14, 12).scale(0.92, 1.16, 1.02), B.head, [0, 1, 0], 0, 1.67, 0.008);
  rigid(a, 1, new THREE.SphereGeometry(0.104, 12, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48).scale(0.95, 1.15, 1.06), B.head, [0, 0, 1], 0, 1.675, 0.01);
  rigid(a, 1, new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(1, 0.92, 1.12), B.head, [0.25, 0, 0], 0, 1.7, -0.005);
  rigid(a, 1, new THREE.BoxGeometry(0.03, 0.05, 0.16), B.head, [0.5, 0, 0], 0.125, 1.69, 0);
  rigid(a, 1, new THREE.BoxGeometry(0.03, 0.05, 0.16), B.head, [0.5, 0, 0], -0.125, 1.69, 0);
  // Plate carrier: a shell lofted just outside the torso so it wraps the body, then pouches, pack, belt.
  const G: [number, number, number] = [0.5, 0, 0];
  loft(a, 1, 0, [
    [1.07, 0.168, 0.124, B.spine, 0.6, B.chest, 0.4],
    [1.1, 0.186, 0.146, B.spine, 0.5, B.chest, 0.5],
    [1.2, 0.196, 0.156, B.chest, 1, 0, 0],
    [1.36, 0.204, 0.158, B.chest, 1, 0, 0],
    [1.44, 0.198, 0.146, B.chest, 1, 0, 0],
    [1.47, 0.15, 0.116, B.chest, 1, 0, 0],
  ], 14, G);
  for (const sx of [-0.105, 0, 0.105]) rigid(a, 1, new THREE.BoxGeometry(0.085, 0.15, 0.05), B.chest, [0.75, 0, 0], sx, 1.19, 0.17);
  rigid(a, 1, new THREE.BoxGeometry(0.11, 0.08, 0.04), B.chest, [0.75, 0, 0], 0.08, 1.37, 0.165);
  rigid(a, 1, new THREE.SphereGeometry(0.13, 10, 8).scale(1, 1.2, 0.62), B.chest, [0.75, 0, 0], 0, 1.3, -0.19);
  rigid(a, 1, new THREE.BoxGeometry(0.16, 0.07, 0.07), B.chest, [0.5, 0, 0], 0, 1.16, -0.2);
  loft(a, 1, 0, [
    [0.985, 0.18, 0.13, B.hips, 1, 0, 0],
    [1.0, 0.184, 0.134, B.hips, 1, 0, 0],
    [1.035, 0.18, 0.13, B.hips, 1, 0, 0],
  ], 12, G);
  rigid(a, 1, new THREE.BoxGeometry(0.06, 0.15, 0.11), B.hips, [0.75, 0, 0], -0.2, 0.95, 0.02);
  rigid(a, 1, new THREE.BoxGeometry(0.1, 0.11, 0.06), B.hips, [0.75, 0, 0], 0.16, 0.97, -0.11);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(a.nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
  // The colour channel carries palette selectors, resolved per soldier in the shader-free way: baked below.
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

/** AK-pattern rifle for OPFOR, built along +Z with the grip at the origin. */
function rifleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: number, x: number, y: number, z: number, rx = 0): void => {
    const gg = g.toNonIndexed();
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
  const steel = 0x24262a;
  const wood = 0x5a3a22;
  add(new THREE.BoxGeometry(0.045, 0.06, 0.3), steel, 0, 0.05, 0.1);
  add(new THREE.BoxGeometry(0.04, 0.05, 0.24), wood, 0, 0.035, -0.26);
  add(new THREE.BoxGeometry(0.042, 0.1, 0.04), wood, 0, 0.0, -0.36);
  add(new THREE.BoxGeometry(0.05, 0.05, 0.2), wood, 0, 0.045, 0.34);
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.36, 7), steel, 0, 0.055, 0.6, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), steel, 0, 0.082, 0.46, Math.PI / 2);
  add(new THREE.BoxGeometry(0.012, 0.045, 0.012), steel, 0, 0.09, 0.74);
  add(new THREE.BoxGeometry(0.036, 0.1, 0.045), steel, 0, -0.035, -0.02, 0.25);
  add(new THREE.BoxGeometry(0.03, 0.2, 0.06), steel, 0, -0.08, 0.14, -0.38);
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
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
  uniform: THREE.MeshStandardMaterial;
  gear: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  rifle: THREE.MeshStandardMaterial;
}

export function soldierMaterials(engine: Engine, look: SoldierLook): SoldierMats {
  // Palette selectors (stored in the geometry) resolve to these colours per look.
  const patch = (m: THREE.MeshStandardMaterial, palette: number[]): THREE.MeshStandardMaterial => {
    engine.lit(m);
    const lit = m.onBeforeCompile.bind(m);
    const cols = palette.map((h) => new THREE.Color(h));
    m.customProgramCacheKey = () => `sold:${palette.join(",")}`;
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
  const maskCol = look.mask ?? look.skin;
  // palette: [glove(r=0), helmet(.25), gear(.5), pouch(.75→lighter gear)], skin (g), mask (b)
  const boot = 0x1d1a17;
  const pal = [0x2a2b27, look.helmet, look.gear, new THREE.Color(look.gear).multiplyScalar(1.35).getHex(), look.skin, maskCol];
  const gear = patch(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), [pal[0], pal[1], pal[2], pal[3], pal[4], pal[5]]);
  void boot;
  return {
    uniform: engine.lit(new THREE.MeshStandardMaterial({ map: look.uniform, roughness: 0.92 })),
    gear,
    skin: patch(new THREE.MeshStandardMaterial({ roughness: 0.6 }), [pal[4], pal[4], pal[4], pal[4], pal[4], pal[5]]),
    rifle: engine.lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 })),
  };
}

let sharedRifle: THREE.BufferGeometry | null = null;

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
    sharedGeo ??= buildGeometry();
    sharedRifle ??= rifleGeometry();
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
    bn[B.head].rotation.set(-lean * 0.45 - p.aimPitch * 0.35 + dying * 0.5, p.aimYaw * 0.05, dying * this.limp[0]);

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
