import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { blob, boxProjectUVs, limb, mergeParts } from "@/render/geom";
import { materialLibrary } from "@/render/materials";

/**
 * First-person gloved hands and No. 4 sleeves. Weapon models describe where
 * the hands go (a grip axis for the firing hand, a fore-end for the support
 * hand) and these builders wrap fingers around that geometry, so every gun
 * gets hands that actually hold it rather than one generic pose.
 *
 * Frame: weapon-root local (z forward, y up, x right), metres.
 */

export interface FiringGrip {
  /** Top-centre of the pistol grip where the web of the hand sits. */
  top: Vector3;
  /** Unit vector down the grip (follows its rake). */
  axis: Vector3;
  /** Grip half-thickness across x. */
  halfWidth: number;
  /** Trigger-finger pad position (on the trigger face). */
  trigger: Vector3;
  /** Where the forearm leaves the frame (behind/below/right of the camera). */
  elbow: Vector3;
}

export interface SupportGrip {
  /** Centre line of the part the support hand wraps (fore-end), at the hand's middle. */
  centre: Vector3;
  /** Unit vector along the fore-end (forward). */
  along: Vector3;
  /** Half extents of the fore-end cross-section: x = half width, y = half height. */
  halfX: number;
  halfY: number;
  elbow: Vector3;
}

const FINGER_R = 0.0092;

/** Points of a finger curling around an axis through `c` in the plane spanned by r/f. */
function curl(c: Vector3, r: Vector3, f: Vector3, radius: number, anglesDeg: number[]): Vector3[] {
  return anglesDeg.map((a) => {
    const t = (a * Math.PI) / 180;
    return c.add(r.scale(Math.cos(t) * radius)).add(f.scale(Math.sin(t) * radius));
  });
}

function fingerChain(scene: Scene, name: string, pts: Vector3[], r0: number, r1: number, parts: Mesh[]): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const ra = r0 + (r1 - r0) * (i / (pts.length - 1));
    const rb = r0 + (r1 - r0) * ((i + 1) / (pts.length - 1));
    parts.push(limb(`${name}_seg${i}`, scene, pts[i], pts[i + 1], ra, rb, 8));
    parts.push(blob(`${name}_j${i}`, scene, pts[i], new Vector3(ra, ra, ra), 6));
  }
  const tip = pts[pts.length - 1];
  parts.push(blob(`${name}_tip`, scene, tip, new Vector3(r1, r1, r1), 6));
}

/** Sleeve: glove cuff at the wrist, then a No. 4 forearm running out of frame to the elbow. */
function sleeve(scene: Scene, name: string, wrist: Vector3, elbow: Vector3, gloveParts: Mesh[], fabricParts: Mesh[]): void {
  const dir = elbow.subtract(wrist).normalize();
  const cuffEnd = wrist.add(dir.scale(0.05));
  gloveParts.push(limb(`${name}_cuff`, scene, wrist, cuffEnd, 0.026, 0.031, 12));
  const sleeveStart = wrist.add(dir.scale(0.035));
  const fore = limb(`${name}_sleeve`, scene, sleeveStart, elbow, 0.036, 0.048, 14);
  boxProjectUVs(fore, 0.5);
  fabricParts.push(fore);
  // Loose fabric at the cuff hem so the sleeve doesn't read as a pipe.
  const hem = limb(`${name}_hem`, scene, sleeveStart, sleeveStart.add(dir.scale(0.025)), 0.039, 0.04, 14);
  boxProjectUVs(hem, 0.5);
  fabricParts.push(hem);
}

export interface HandsResult {
  glove: Mesh;
  fabric: Mesh;
}

export function buildHands(scene: Scene, id: string, grip: FiringGrip, support: SupportGrip | null): HandsResult {
  const lib = materialLibrary(scene);
  const glove: Mesh[] = [];
  const fabric: Mesh[] = [];

  // ---- Firing hand (right) ------------------------------------------------
  const g = grip.axis.normalizeToNew();
  const right = new Vector3(1, 0, 0);
  // Forward strap direction: perpendicular to the grip axis, in the y/z plane.
  const fwd = Vector3.Cross(right, g).normalize().scale(-1);
  const wrapR = grip.halfWidth + FINGER_R;
  const at = (s: number) => grip.top.add(g.scale(s));

  // Middle, ring, little fingers wrap from the right side across the front strap.
  [0.03, 0.05, 0.068].forEach((s, i) => {
    const pts = curl(at(s), right, fwd, wrapR + 0.004, [-35, 25, 90, 150]);
    fingerChain(scene, `${id}_rf${i}`, pts, FINGER_R, FINGER_R * (i === 2 ? 0.78 : 0.88), glove);
  });
  // Index finger lies along the frame then curls onto the trigger face.
  const knuckle = curl(at(0.012), right, fwd, wrapR + 0.006, [-25])[0];
  const trig = grip.trigger;
  fingerChain(scene, `${id}_rIndex`, [
    knuckle,
    new Vector3(trig.x + 0.012, knuckle.y - 0.004, knuckle.z + (trig.z - knuckle.z) * 0.55),
    new Vector3(trig.x + 0.008, trig.y + 0.004, trig.z - 0.004),
    new Vector3(trig.x + 0.002, trig.y - 0.008, trig.z - 0.006),
  ], FINGER_R, FINGER_R * 0.85, glove);
  // Thumb hooks over the top-left of the grip.
  const thumbBase = curl(at(0.04), right, fwd, wrapR + 0.006, [-120])[0];
  fingerChain(scene, `${id}_rThumb`, [
    thumbBase,
    curl(at(0.008), right, fwd, wrapR + 0.004, [-175])[0],
    curl(at(-0.012), right, fwd, wrapR, [150])[0],
  ], FINGER_R * 1.2, FINGER_R * 0.95, glove);
  // Palm: a flattened mass on the right/back of the grip, joining fingers to the wrist.
  const palmC = curl(at(0.05), right, fwd, wrapR + 0.006, [-70])[0];
  glove.push(blob(`${id}_rPalm`, scene, palmC, new Vector3(0.022, 0.045, 0.032), 10));
  const heel = curl(at(0.085), right, fwd, wrapR + 0.004, [-90])[0];
  glove.push(blob(`${id}_rHeel`, scene, heel, new Vector3(0.024, 0.028, 0.026), 8));
  const wristR = curl(at(0.1), right, fwd, wrapR + 0.012, [-85])[0];
  glove.push(limb(`${id}_rWrist`, scene, heel, wristR, 0.026, 0.026, 10));
  sleeve(scene, `${id}_rArm`, wristR, grip.elbow, glove, fabric);

  // ---- Support hand (left) --------------------------------------------------
  if (support) {
    const a = support.along.normalizeToNew();
    const up = new Vector3(0, 1, 0);
    const side = Vector3.Cross(up, a).normalize(); // +x for a forward-pointing fore-end
    const ell = (c: Vector3, deg: number, grow: number) => {
      const t = (deg * Math.PI) / 180;
      return c.add(side.scale(Math.cos(t) * (support.halfX + grow))).add(up.scale(Math.sin(t) * (support.halfY + grow)));
    };
    // Fingers come from under the fore-end and wrap up the right side.
    [-0.03, -0.01, 0.01, 0.028].forEach((dz, i) => {
      const c = support.centre.add(a.scale(dz));
      const pts = [ell(c, 225, FINGER_R), ell(c, 270, FINGER_R), ell(c, 320, FINGER_R), ell(c, 10, FINGER_R * 0.8)];
      fingerChain(scene, `${id}_lf${i}`, pts, FINGER_R, FINGER_R * (i === 3 ? 0.78 : 0.88), glove);
    });
    // Thumb runs forward along the left flank.
    const tb = support.centre.add(a.scale(-0.05));
    fingerChain(scene, `${id}_lThumb`, [
      ell(tb, 200, FINGER_R * 1.4),
      ell(support.centre.add(a.scale(-0.01)), 175, FINGER_R),
      ell(support.centre.add(a.scale(0.03)), 160, FINGER_R * 0.8),
    ], FINGER_R * 1.2, FINGER_R * 0.95, glove);
    const palm = ell(support.centre.add(a.scale(-0.012)), 228, 0.02);
    glove.push(blob(`${id}_lPalm`, scene, palm, new Vector3(0.03, 0.022, 0.045), 10));
    const wristL = ell(support.centre.add(a.scale(-0.07)), 235, 0.03);
    glove.push(limb(`${id}_lWrist`, scene, palm, wristL, 0.026, 0.026, 10));
    sleeve(scene, `${id}_lArm`, wristL, support.elbow, glove, fabric);
  }

  return {
    glove: mergeParts(`vm_${id}_gloves`, glove, lib.glove),
    fabric: mergeParts(`vm_${id}_sleeves`, fabric, lib.no4Fabric),
  };
}
