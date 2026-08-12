import { Scene, AbstractMesh, Ray, Vector3, Matrix } from "@babylonjs/core";

/**
 * Broadphase ray index over the world's *static* collidable geometry.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `scene.pickWithRay` tests the ray against every mesh in `scene.meshes`, and
 * for each candidate `mesh.intersects()` inverts that mesh's world matrix to
 * pull the ray into local space. The matrix inversion — not triangle count —
 * is what costs: the terminal's props are tiny (≤62 verts each) but there are
 * ~1400 collidable ones, so a single ray measured **~950µs**.
 *
 * That is per ray, and the AI fires a lot of them. `computeAvoidanceAngle`
 * alone probes up to 9 directions per refresh, per moving enemy, several times
 * a second; add the line-of-sight ray, the navigation ground check and every
 * shot fired and a busy fight was spending most of a CPU core inside
 * `pickWithRay`. It is the single largest source of frame-time spikes in the
 * game, and it scales with map density — which is exactly the wrong way round,
 * because the Operations map is by far the densest one.
 *
 * The fix is a classic broadphase. World geometry does not move, so its
 * world-space AABBs can be computed once and bucketed into a uniform grid over
 * XZ. A query walks only the cells the ray actually crosses, rejects candidates
 * with a branch-light slab test in world space (no matrix inversion), and calls
 * Babylon's exact `mesh.intersects()` only on the handful that survive. Same
 * geometry, same answers, a fraction of the work: a naive linear AABB scan
 * already measured 61µs against pickWithRay's 950µs, and the grid cuts the
 * candidate set again on top of that.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS STATIC
 *
 * Anything pickable + collidable that isn't a combatant (`metadata.damageable`),
 * the player's own capsule, or thrown smoke. Those three are the only
 * collidable things in the game that move or come and go mid-fight, and callers
 * that care about them (line-of-sight cares about smoke) test them separately
 * against a short list — far cheaper than making the whole index dynamic.
 *
 * The index is rebuilt lazily: `invalidateRayIndex()` marks it dirty and the
 * next query rebuilds. Every map build and every `setActiveMap` switch
 * invalidates, which covers the only two ways the static world ever changes
 * wholesale. Meshes disposed in between (shot-out glass) are skipped by a
 * cheap `isDisposed()` guard at query time rather than forcing a rebuild.
 */

/** Grid cell size in metres. Props cluster at ~2-10m, so 8m keeps occupancy low without exploding cell count. */
const CELL_M = 8;

/**
 * A mesh whose footprint spans more than this many cells is kept in a separate
 * always-tested list instead of being written into every cell it covers. The
 * ground plane and perimeter walls are single meshes covering the entire map;
 * bucketing them normally would put them in all ~900 cells and defeat the grid.
 */
const OVERSIZED_CELL_SPAN = 24;

interface Entry {
  mesh: AbstractMesh;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /**
   * Inverse of the mesh's world matrix, cached at build time.
   *
   * `AbstractMesh.intersects` takes its ray in the mesh's LOCAL space — it
   * tests against the *local* bounding box, so handing it a world-space ray
   * silently misses (a building 30m from the origin never gets hit, because
   * the local box straddles zero). `scene.pickWithRay` hides this by
   * transforming the ray per mesh, and that inversion is the per-mesh cost
   * this whole module exists to avoid. Since static geometry never moves, the
   * inverse can be computed once here and reused for every query afterwards.
   */
  invWorld: Matrix;
}

let entries: Entry[] = [];
let oversized: Entry[] = [];
/** Flat grid of entry indices, `gridW * gridH` cells, row-major over (cx, cz). */
let cells: number[][] = [];
let gridW = 0;
let gridH = 0;
let originX = 0;
let originZ = 0;
let dirty = true;
/** Per-cell visit stamps, so a DDA walk never tests the same mesh twice in one query. */
let stamp: Int32Array = new Int32Array(0);
let stampTick = 0;

/**
 * Bumped every time the static world changes. Anything caching a result
 * derived from static geometry (Nav's navigability memo) watches this instead
 * of being invalidated directly — that keeps the dependency pointing one way
 * and avoids an import cycle between Nav, MapProfile and this module.
 */
let generation = 0;

/** Current static-world generation. Changes when geometry is rebuilt or a map is switched. */
export function rayIndexGeneration(): number {
  return generation;
}

/** Mark the static index stale. Called on map build and on every map switch. */
export function invalidateRayIndex(): void {
  dirty = true;
  generation++;
}

/** True for collidable geometry that never moves — everything the index may bucket. */
function isStaticCandidate(m: AbstractMesh): boolean {
  return (
    m.isEnabled() &&
    m.isPickable &&
    m.checkCollisions &&
    !m.metadata?.damageable &&
    !m.metadata?.isSmoke &&
    m.name !== "playerCollider"
  );
}

function rebuild(scene: Scene): void {
  dirty = false;
  entries = [];
  oversized = [];

  let lo = Infinity;
  let hi = -Infinity;
  let loZ = Infinity;
  let hiZ = -Infinity;

  for (const m of scene.meshes) {
    if (m.isDisposed() || !isStaticCandidate(m)) continue;
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    const mn = bb.minimumWorld;
    const mx = bb.maximumWorld;
    entries.push({
      mesh: m,
      minX: mn.x, minY: mn.y, minZ: mn.z,
      maxX: mx.x, maxY: mx.y, maxZ: mx.z,
      invWorld: m.getWorldMatrix().clone().invert(),
    });
    if (mn.x < lo) lo = mn.x;
    if (mx.x > hi) hi = mx.x;
    if (mn.z < loZ) loZ = mn.z;
    if (mx.z > hiZ) hiZ = mx.z;
  }

  if (entries.length === 0) {
    gridW = gridH = 0;
    cells = [];
    return;
  }

  originX = lo;
  originZ = loZ;
  gridW = Math.max(1, Math.ceil((hi - lo) / CELL_M) + 1);
  gridH = Math.max(1, Math.ceil((hiZ - loZ) / CELL_M) + 1);
  cells = new Array(gridW * gridH);
  if (stamp.length < gridW * gridH) stamp = new Int32Array(gridW * gridH);

  const kept: Entry[] = [];
  for (const e of entries) {
    const x0 = Math.max(0, Math.floor((e.minX - originX) / CELL_M));
    const x1 = Math.min(gridW - 1, Math.floor((e.maxX - originX) / CELL_M));
    const z0 = Math.max(0, Math.floor((e.minZ - originZ) / CELL_M));
    const z1 = Math.min(gridH - 1, Math.floor((e.maxZ - originZ) / CELL_M));
    // Map-spanning meshes (the ground plane, boundary walls) would otherwise be
    // written into every cell — cheaper to test them unconditionally.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > OVERSIZED_CELL_SPAN) {
      oversized.push(e);
      continue;
    }
    const idx = kept.length;
    kept.push(e);
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * gridW;
      for (let cx = x0; cx <= x1; cx++) {
        (cells[row + cx] ??= []).push(idx);
      }
    }
  }
  entries = kept;
}

/** Ray-vs-AABB slab test in world space. No matrix work — this is the whole point. */
function hitsAabb(
  e: Entry,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number
): boolean {
  let t0 = 0;
  let t1 = maxDist;

  if (Math.abs(dx) < 1e-9) {
    if (ox < e.minX || ox > e.maxX) return false;
  } else {
    const inv = 1 / dx;
    let a = (e.minX - ox) * inv;
    let b = (e.maxX - ox) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t1 < t0) return false;
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < e.minY || oy > e.maxY) return false;
  } else {
    const inv = 1 / dy;
    let a = (e.minY - oy) * inv;
    let b = (e.maxY - oy) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t1 < t0) return false;
  }

  if (Math.abs(dz) < 1e-9) {
    if (oz < e.minZ || oz > e.maxZ) return false;
  } else {
    const inv = 1 / dz;
    let a = (e.minZ - oz) * inv;
    let b = (e.maxZ - oz) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t1 < t0) return false;
  }

  return true;
}

/**
 * Collect the static entries whose AABB the ray crosses, walking only the grid
 * cells along its path (2D DDA over XZ). `out` is reused by callers to keep the
 * query allocation-free on the hot path.
 */
function gatherCandidates(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  out: Entry[]
): void {
  out.length = 0;

  for (const e of oversized) {
    if (hitsAabb(e, ox, oy, oz, dx, dy, dz, maxDist)) out.push(e);
  }
  if (gridW === 0) return;

  stampTick++;
  // Ensure the stamp buffer can't alias a previous generation after a rebuild.
  if (stampTick === 0x7fffffff) { stamp.fill(0); stampTick = 1; }

  // Walk the cells the ray's XZ projection crosses. A purely vertical ray
  // (the navigation ground probe) degenerates to a single cell, which is
  // exactly the cheap path that check wants.
  let cx = Math.floor((ox - originX) / CELL_M);
  let cz = Math.floor((oz - originZ) / CELL_M);
  const endX = ox + dx * maxDist;
  const endZ = oz + dz * maxDist;
  const lastX = Math.floor((endX - originX) / CELL_M);
  const lastZ = Math.floor((endZ - originZ) / CELL_M);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(CELL_M / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(CELL_M / dz) : Infinity;
  let tMaxX = stepX !== 0
    ? (((stepX > 0 ? cx + 1 : cx) * CELL_M + originX) - ox) / dx
    : Infinity;
  let tMaxZ = stepZ !== 0
    ? (((stepZ > 0 ? cz + 1 : cz) * CELL_M + originZ) - oz) / dz
    : Infinity;

  // Bound the walk: worst case a ray crosses the whole grid diagonally.
  const maxSteps = gridW + gridH + 2;
  for (let step = 0; step <= maxSteps; step++) {
    if (cx >= 0 && cx < gridW && cz >= 0 && cz < gridH) {
      const bucket = cells[cz * gridW + cx];
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          if (stamp[idx] === stampTick) continue;
          stamp[idx] = stampTick;
          const e = entries[idx];
          if (hitsAabb(e, ox, oy, oz, dx, dy, dz, maxDist)) out.push(e);
        }
      }
    }
    if (cx === lastX && cz === lastZ) break;
    if (tMaxX < tMaxZ) {
      if (stepX === 0) break;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (stepZ === 0) break;
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
}

/** Scratch buffers — these queries run thousands of times a second, so they never allocate. */
const scratch: Entry[] = [];
const scratchRay = new Ray(new Vector3(), new Vector3(1, 0, 0), 1);
const localRay = new Ray(new Vector3(), new Vector3(1, 0, 0), 1);

/**
 * Exact ray/mesh test for one AABB survivor, matching what `scene.pickWithRay`
 * does internally: pull the world ray into the mesh's local space (using the
 * inverse cached at build time) and let Babylon do the real intersection.
 * Returns the PickingInfo so callers can read the world-space hit point.
 */
function exactIntersect(e: Entry): import("@babylonjs/core").PickingInfo {
  Ray.TransformToRef(scratchRay, e.invWorld, localRay);
  return e.mesh.intersects(localRay, false);
}

/**
 * True if any static world geometry blocks the segment from `from` along `dir`
 * for `dist` metres. This is the "can I see / walk through" question the AI
 * asks constantly, and it deliberately answers with the *first* blocker rather
 * than the nearest one — nothing downstream cares which mesh it was.
 *
 * `accept` optionally narrows the candidate set further (used to skip the
 * caller's own mesh). It runs only on AABB survivors, so it stays cheap.
 */
export function isPathBlocked(
  scene: Scene,
  from: Vector3,
  dir: Vector3,
  dist: number,
  accept?: (m: AbstractMesh) => boolean
): boolean {
  if (dirty) rebuild(scene);
  if (dist <= 0) return false;

  gatherCandidates(from.x, from.y, from.z, dir.x, dir.y, dir.z, dist, scratch);
  if (scratch.length === 0) return false;

  scratchRay.origin.copyFrom(from);
  scratchRay.direction.copyFrom(dir);
  scratchRay.length = dist;

  for (let i = 0; i < scratch.length; i++) {
    const m = scratch[i].mesh;
    if (m.isDisposed() || !m.isEnabled()) continue;
    if (accept && !accept(m)) continue;
    // Exact test on the few AABB survivors keeps rotated props honest.
    if (exactIntersect(scratch[i]).hit) return true;
  }
  return false;
}

/**
 * Thrown smoke — the one *dynamic* thing that blocks sight. It's deliberately
 * not in the grid (it comes and goes mid-fight and would force rebuilds); there
 * are only ever a handful of puffs live at once, so they're kept in a flat list
 * and tested directly. Grenades register here as they bloom; disposed puffs are
 * pruned lazily on the next query.
 */
const smokeOccluders: AbstractMesh[] = [];

/** Register a smoke puff as a sight-blocking obscurant (see `isSightBlocked`). */
export function registerSmokeOccluder(mesh: AbstractMesh): void {
  smokeOccluders.push(mesh);
}

/**
 * True if static geometry *or* live smoke blocks the segment. This is the AI's
 * vision test: smoke screens are supposed to hide the player from OPFOR, so
 * they have to occlude here even though they're non-collidable and transient.
 */
export function isSightBlocked(
  scene: Scene,
  from: Vector3,
  dir: Vector3,
  dist: number,
  accept?: (m: AbstractMesh) => boolean
): boolean {
  if (isPathBlocked(scene, from, dir, dist, accept)) return true;

  if (smokeOccluders.length === 0) return false;
  scratchRay.origin.copyFrom(from);
  scratchRay.direction.copyFrom(dir);
  scratchRay.length = dist;
  for (let i = smokeOccluders.length - 1; i >= 0; i--) {
    const m = smokeOccluders[i];
    if (m.isDisposed()) {
      smokeOccluders.splice(i, 1);
      continue;
    }
    if (!m.isEnabled()) continue;
    if (m.intersects(scratchRay, false).hit) return true;
  }
  return false;
}

/** What a downward probe found at a column: the topmost static surface, if any. */
export interface GroundHit {
  mesh: AbstractMesh;
  y: number;
}

/**
 * Topmost static surface directly above/below the given column, found by
 * dropping a ray from `fromY`. This is the navigation ground probe: it needs
 * the *nearest* hit (not just any hit), so unlike `isPathBlocked` it keeps
 * searching after the first candidate.
 */
export function probeGround(scene: Scene, x: number, z: number, fromY: number, dist: number): GroundHit | null {
  if (dirty) rebuild(scene);

  gatherCandidates(x, fromY, z, 0, -1, 0, dist, scratch);
  if (scratch.length === 0) return null;

  scratchRay.origin.set(x, fromY, z);
  scratchRay.direction.set(0, -1, 0);
  scratchRay.length = dist;

  let bestY = -Infinity;
  let best: AbstractMesh | null = null;
  for (let i = 0; i < scratch.length; i++) {
    const m = scratch[i].mesh;
    if (m.isDisposed() || !m.isEnabled()) continue;
    const info = exactIntersect(scratch[i]);
    if (!info.hit || info.pickedPoint == null) continue;
    if (info.pickedPoint.y > bestY) {
      bestY = info.pickedPoint.y;
      best = m;
    }
  }
  return best ? { mesh: best, y: bestY } : null;
}

/** Diagnostics for the perf test harness. */
export function rayIndexStats(scene: Scene): {
  entries: number;
  oversized: number;
  cells: number;
  avgPerCell: number;
} {
  if (dirty) rebuild(scene);
  let occupied = 0;
  let total = 0;
  for (const c of cells) {
    if (c && c.length) {
      occupied++;
      total += c.length;
    }
  }
  return {
    entries: entries.length,
    oversized: oversized.length,
    cells: occupied,
    avgPerCell: occupied ? +(total / occupied).toFixed(1) : 0,
  };
}
