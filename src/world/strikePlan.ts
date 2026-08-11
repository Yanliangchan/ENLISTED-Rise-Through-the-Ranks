import { CARPET_BOMBING } from "@/data/gamedata";

/**
 * A confirmed call-in: where it lands, which way the run flies, and the seed
 * that fixes its scatter pattern.
 *
 * The seed is what makes the targeting preview honest. Carpet bombing scatters
 * its impacts randomly inside the box, so a preview that rolled its own
 * randomness would show the player one pattern and then drop a different one —
 * the classic "preview detached from the actual impact location" bug. Instead
 * the plan is created ONCE when targeting begins, the preview draws
 * `carpetImpactPoints(plan)`, and the bombing run replays the exact same call.
 */
export interface StrikePlan {
  x: number;
  z: number;
  /** Radians. Heading of the bombing run's long axis (0 = +Z). Unused by the pin-point strike. */
  heading: number;
  seed: number;
}

/** Deterministic PRNG — same seed always replays the same scatter. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotate a box-local offset into world space along the run's heading. */
function toWorld(plan: StrikePlan, alongAxis: number, acrossAxis: number): { x: number; z: number } {
  const c = Math.cos(plan.heading);
  const s = Math.sin(plan.heading);
  return {
    x: plan.x + alongAxis * s + acrossAxis * c,
    z: plan.z + alongAxis * c - acrossAxis * s,
  };
}

/**
 * The exact points the bombing run will detonate at, in drop order. Called by
 * both the targeting preview and `CarpetBombingSupport.beginRun`.
 */
export function carpetImpactPoints(plan: StrikePlan): Array<{ x: number; z: number }> {
  const rng = mulberry32(plan.seed);
  const points: Array<{ x: number; z: number }> = [];
  const n = CARPET_BOMBING.impactCount;
  for (let i = 0; i < n; i++) {
    // Walk the long axis in order (a real run flies down the box) with a small
    // jitter, and scatter across the short axis. Ordered along-axis placement is
    // also what makes the preview's direction arrow meaningful.
    const along = ((i + 0.5) / n - 0.5) * CARPET_BOMBING.areaLengthM + (rng() - 0.5) * (CARPET_BOMBING.areaLengthM / n);
    const across = (rng() - 0.5) * CARPET_BOMBING.areaWidthM;
    points.push(toWorld(plan, along, across));
  }
  return points;
}

/** The four corners of the bombing box, in order, for drawing the target footprint. */
export function carpetBoxCorners(plan: StrikePlan): Array<{ x: number; z: number }> {
  const halfL = CARPET_BOMBING.areaLengthM / 2;
  const halfW = CARPET_BOMBING.areaWidthM / 2;
  return [
    toWorld(plan, halfL, -halfW),
    toWorld(plan, halfL, halfW),
    toWorld(plan, -halfL, halfW),
    toWorld(plan, -halfL, -halfW),
  ];
}

/** Tip of the direction arrow — where the run exits the box. */
export function carpetRunHead(plan: StrikePlan): { x: number; z: number } {
  return toWorld(plan, CARPET_BOMBING.areaLengthM / 2 + 8, 0);
}
