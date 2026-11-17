/**
 * Reload choreography, one style per weapon family, each with a quicker tactical reload
 * (rounds still chambered) and a longer empty reload that ends by working the action.
 * Every channel is a keyframed curve over normalised time; the weapon system turns the
 * channels into gun, magazine, hand and cover poses.
 */

export type ReloadStyle = "bullpup" | "rifle" | "drum" | "pistol" | "belt" | "tube";
export type Foley = "magOut" | "magIn" | "bolt" | "raise" | "cloth" | "pin";

/** Channel values for one moment of a reload. Hand weights blend toward per-weapon targets. */
export interface ReloadPose {
  /** Magazine travel along the weapon's `magOut` direction: 1 = clear of the gun, 2.4 = gone to the pouch. */
  mag: number;
  /** Magazine roll about the gun's Z axis (drums are rolled out, not pulled straight). */
  magRz: number;
  /** Support hand: weight toward the magazine, whether it is carrying the magazine, toward the bolt, toward the cover. */
  hMag: number;
  hFollow: number;
  hBolt: number;
  hCover: number;
  /** Support hand dropped to the pouch, 0..1. */
  hAway: number;
  /** Firing hand to the charging handle (right-side handles), 0..1. */
  rBolt: number;
  /** Action pulled to the rear, 0..1, and slide held locked back (pistol), 0..1. */
  pull: number;
  lock: number;
  /** Feed cover open, 0..1. */
  cover: number;
  /** Belt lifted out of the tray, 0..1. */
  belt: number;
  /** Whole-rig offsets: position (camera metres) and rotation (radians: muzzle-up, yaw, cant). */
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

type Track = number[][];
interface Anim {
  tracks: Partial<Record<keyof ReloadPose, Track>>;
  sounds: Array<[number, Foley]>;
}

const sm = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
/** Piecewise keyframe curve with eased segments: [[time, value], ...]. */
export function kf(t: number, keys: number[][]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * sm((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Box-magazine reload shared by the rifles: tilt the gun, hand to the magazine, strip it,
 * hand away to the vest, back with a fresh one, seat it with a push past home, hand back.
 * `end` is where the magazine part finishes (earlier on an empty reload, to leave time for the bolt).
 */
function boxMag(end: number, tilt: { rx: number; ry: number; rz: number; px: number; py: number; pz: number }): Anim["tracks"] {
  const k = (t: number): number => t * end;
  return {
    mag: [[k(0.18), 0], [k(0.32), 1], [k(0.46), 2.4], [k(0.56), 2.4], [k(0.74), 1], [k(0.86), -0.06], [k(0.92), 0]],
    hMag: [[k(0.02), 0], [k(0.18), 1], [k(0.95), 1], [Math.min(1, k(1.12)), 0]],
    hFollow: [[k(0.18), 0], [k(0.2), 1], [k(0.9), 1], [k(0.96), 0]],
    hAway: [[k(0.32), 0], [k(0.44), 1], [k(0.56), 1], [k(0.7), 0]],
    rx: [[0, 0], [0.12, tilt.rx], [0.86, tilt.rx], [1, 0]],
    ry: [[0, 0], [0.12, tilt.ry], [0.86, tilt.ry], [1, 0]],
    rz: [[0, 0], [0.12, tilt.rz], [0.86, tilt.rz], [1, 0]],
    px: [[0, 0], [0.12, tilt.px], [0.86, tilt.px], [1, 0]],
    py: [[0, 0], [0.12, tilt.py], [0.86, tilt.py], [1, 0]],
    pz: [[0, 0], [0.12, tilt.pz], [0.86, tilt.pz], [1, 0]],
  };
}

/** Hand to the charging handle, a hard pull, let it fly, hand back to the fore-end. */
function boltWork(start: number): Anim["tracks"] {
  const s = start, r = 1 - start;
  return {
    hBolt: [[s, 0], [s + r * 0.25, 1], [s + r * 0.62, 1], [s + r * 0.9, 0]],
    pull: [[s + r * 0.3, 0], [s + r * 0.42, 1], [s + r * 0.48, 0]],
  };
}

function build(style: ReloadStyle, empty: boolean): Anim {
  switch (style) {
    case "bullpup": {
      // Magazine is behind the grip: the gun comes up and over, muzzle high, canted hard right.
      const end = empty ? 0.68 : 1;
      const tilt = { rx: 0.3, ry: 0.22, rz: -0.42, px: -0.06, py: 0.03, pz: 0.07 };
      const t = { ...boxMag(end, tilt), ...(empty ? boltWork(0.6) : {}) };
      return { tracks: t, sounds: [[end * 0.24, "magOut"], [end * 0.84, "magIn"], ...(empty ? ([[0.75, "bolt"]] as Array<[number, Foley]>) : [])] };
    }
    case "rifle": {
      const end = empty ? 0.74 : 1;
      const tilt = { rx: 0.14, ry: 0.16, rz: -0.32, px: -0.05, py: 0.03, pz: 0.05 };
      const t = boxMag(end, tilt);
      if (empty) {
        // Slap the bolt catch: the hand only travels to the side of the receiver and the carrier snaps home.
        t.hBolt = [[0.72, 0], [0.82, 1], [0.88, 1], [0.97, 0]];
        t.pull = [[0, 1], [0.84, 1], [0.86, 0]];
      }
      return { tracks: t, sounds: [[end * 0.24, "magOut"], [end * 0.84, "magIn"], ...(empty ? ([[0.85, "bolt"]] as Array<[number, Foley]>) : [])] };
    }
    case "drum": {
      // The drum is heavy and wide: the gun rolls well over, the drum is rocked out and lowered away.
      const end = empty ? 0.72 : 1;
      const k = (x: number): number => x * end;
      const t: Anim["tracks"] = {
        mag: [[k(0.2), 0], [k(0.34), 1], [k(0.48), 2.4], [k(0.6), 2.4], [k(0.76), 1], [k(0.88), -0.04], [k(0.94), 0]],
        magRz: [[k(0.2), 0], [k(0.3), 0.35], [k(0.46), 0.6], [k(0.62), 0.6], [k(0.78), 0.3], [k(0.9), 0]],
        hMag: [[k(0.02), 0], [k(0.18), 1], [k(0.96), 1], [Math.min(1, k(1.12)), 0]],
        hFollow: [[k(0.2), 0], [k(0.22), 1], [k(0.92), 1], [k(0.97), 0]],
        hAway: [[k(0.34), 0], [k(0.46), 1], [k(0.6), 1], [k(0.74), 0]],
        rx: [[0, 0], [0.14, 0.12], [0.88, 0.12], [1, 0]],
        ry: [[0, 0], [0.14, 0.2], [0.88, 0.2], [1, 0]],
        rz: [[0, 0], [0.14, -0.55], [0.88, -0.55], [1, 0]],
        px: [[0, 0], [0.14, -0.07], [0.88, -0.07], [1, 0]],
        py: [[0, 0], [0.14, 0.04], [0.88, 0.04], [1, 0]],
        pz: [[0, 0], [0.14, 0.06], [0.88, 0.06], [1, 0]],
        ...(empty ? boltWork(0.66) : {}),
      };
      return { tracks: t, sounds: [[end * 0.26, "magOut"], [end * 0.88, "magIn"], ...(empty ? ([[0.8, "bolt"]] as Array<[number, Foley]>) : [])] };
    }
    case "pistol": {
      // Thumb drops the magazine free, support hand goes to the belt and back, magazine seated
      // with a heel strike; on an empty gun the slide stays locked back until it is racked.
      const t: Anim["tracks"] = {
        mag: [[0.08, 0], [0.18, 1.2], [0.3, 2.4], [0.46, 2.4], [0.62, 1], [0.72, -0.08], [0.78, 0]],
        hMag: [[0.02, 0], [0.16, 1], [0.8, 1], [0.92, 0]],
        hFollow: [[0.3, 0], [0.32, 1], [0.76, 1], [0.8, 0]],
        hAway: [[0.12, 0], [0.26, 1], [0.44, 1], [0.6, 0]],
        rx: [[0, 0], [0.1, 0.22], [0.86, 0.22], [1, 0]],
        rz: [[0, 0], [0.1, 0.4], [0.86, 0.4], [1, 0]],
        py: [[0, 0], [0.1, -0.02], [0.86, -0.02], [1, 0]],
        pz: [[0, 0], [0.1, 0.05], [0.86, 0.05], [1, 0]],
      };
      if (empty) {
        t.hBolt = [[0.78, 0], [0.84, 1], [0.9, 1], [0.97, 0]];
        t.lock = [[0, 1], [0.86, 1], [0.88, 0]];
        t.pull = [[0.84, 0], [0.86, 0.3], [0.88, 0]];
      }
      return { tracks: t, sounds: [[0.12, "magOut"], [0.72, "magIn"], ...(empty ? ([[0.87, "bolt"]] as Array<[number, Foley]>) : [])] };
    }
    case "belt": {
      // Machine gun: charge first if it ran dry, open the cover, lift the old belt out, swap the
      // belt bag, lay the new belt in the tray, slam the cover shut.
      const o = empty ? 0.12 : 0;
      const k = (x: number): number => o + x * (1 - o);
      const t: Anim["tracks"] = {
        cover: [[k(0.04), 0], [k(0.14), 1], [k(0.84), 1], [k(0.9), 0]],
        hCover: [[0, 0], [k(0.06), 1], [k(0.16), 1], [k(0.24), 0], [k(0.8), 0], [k(0.86), 1], [k(0.92), 1], [1, 0]],
        belt: [[k(0.16), 0], [k(0.26), 1], [k(0.6), 1], [k(0.74), 0]],
        mag: [[k(0.26), 0], [k(0.36), 1], [k(0.44), 2.4], [k(0.5), 2.4], [k(0.62), 1], [k(0.7), 0]],
        hMag: [[k(0.16), 0], [k(0.26), 1], [k(0.74), 1], [k(0.8), 0]],
        hFollow: [[k(0.26), 0], [k(0.28), 1], [k(0.68), 1], [k(0.72), 0]],
        hAway: [[k(0.36), 0], [k(0.44), 1], [k(0.5), 1], [k(0.6), 0]],
        // Gun swung left and down so the open tray faces the firer and the cover clears the eye line.
        rx: [[0, 0], [0.08, 0.04], [0.92, 0.04], [1, 0]],
        ry: [[0, 0], [0.08, -0.42], [0.92, -0.42], [1, 0]],
        rz: [[0, 0], [0.08, 0.34], [0.92, 0.34], [1, 0]],
        px: [[0, 0], [0.08, -0.03], [0.92, -0.03], [1, 0]],
        py: [[0, 0], [0.08, -0.07], [0.92, -0.07], [1, 0]],
        pz: [[0, 0], [0.08, 0.02], [0.92, 0.02], [1, 0]],
      };
      if (empty) {
        t.rBolt = [[0, 0], [0.04, 1], [0.1, 1], [0.13, 0]];
        t.pull = [[0.05, 0], [0.08, 1], [0.1, 1], [0.11, 0]];
      }
      return { tracks: t, sounds: [...(empty ? ([[0.09, "bolt"]] as Array<[number, Foley]>) : []), [k(0.12), "pin"], [k(0.3), "magOut"], [k(0.66), "magIn"], [k(0.9), "bolt"]] };
    }
    case "tube":
    default:
      // Disposable launcher: drop the spent tube off the shoulder, bring a fresh one up, arm it.
      return {
        tracks: { py: [[0, 0], [0.2, -0.5], [0.6, -0.5], [0.9, 0]], rx: [[0, 0], [0.2, 0.9], [0.6, 0.9], [0.9, 0]], rz: [[0, 0], [0.2, -0.4], [0.6, -0.4], [0.9, 0]] },
        sounds: [[0.16, "cloth"], [0.55, "raise"], [0.85, "pin"]],
      };
  }
}

const cache = new Map<string, Anim>();
const ZERO: ReloadPose = { mag: 0, magRz: 0, hMag: 0, hFollow: 0, hBolt: 0, hCover: 0, hAway: 0, rBolt: 0, pull: 0, lock: 0, cover: 0, belt: 0, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

export function reloadAnim(style: ReloadStyle, empty: boolean): Anim {
  const key = `${style}:${empty}`;
  let a = cache.get(key);
  if (!a) cache.set(key, (a = build(style, empty)));
  return a;
}

/** Sample every channel at normalised time `t` (0..1). Outside a reload, pass `null` for rest. */
export function samplePose(anim: Anim | null, t: number, out: ReloadPose): ReloadPose {
  Object.assign(out, ZERO);
  if (!anim) return out;
  for (const k in anim.tracks) {
    const tr = anim.tracks[k as keyof ReloadPose]!;
    out[k as keyof ReloadPose] = kf(t, tr);
  }
  return out;
}
