import { Scene, Vector3 } from "@babylonjs/core";
import { activeMap } from "@/world/MapProfile";
import { probeGround, rayIndexGeneration } from "@/world/RayIndex";

/**
 * Lightweight navigation validation — a stand-in for a real nav mesh. The map
 * is a flat ground plane with collidable buildings/props/vehicles on top, so
 * "is this spot walkable?" reduces to: is it inside the playable area, and is
 * the ground clear directly above it (nothing solid overhead means we're not
 * inside/under a building, prop or vehicle). Used to validate enemy spawn
 * points and to rescue any AI that ends up trapped in geometry.
 */

/**
 * Default half-extent of the playable area — just inside the Singapore map's
 * ±100 boundary wall. Maps that need a bigger footprint (Pasir Panjang
 * Terminal) override it via `MapProfile.playableHalfM`; everything that used
 * to read this constant now goes through `playableHalf()` so the bound tracks
 * whichever map is actually active.
 */
export const PLAYABLE_HALF = 96;

/** The active map's playable half-extent, defaulting to the Singapore bound. */
export function playableHalf(): number {
  return activeMap().playableHalfM ?? PLAYABLE_HALF;
}

/** Clamp a position into the playable square (keeps y). */
export function clampToPlayable(pos: Vector3): Vector3 {
  const h = playableHalf();
  return new Vector3(
    Math.max(-h, Math.min(h, pos.x)),
    pos.y,
    Math.max(-h, Math.min(h, pos.z))
  );
}

/**
 * True if `pos` sits on a walkable surface inside the playable area. Drops a
 * ray from high above the point and inspects the first solid thing it meets:
 *
 *  - The flat outdoor ground plane (named "ground", below 0.8m) — the original
 *    single-storey city map's only walkable surface.
 *  - Any mesh explicitly tagged `metadata.walkable === true` at ANY height —
 *    lets interior maps (Iron Citadel) build one continuous nav mesh out of a
 *    ground floor plus ramps, mezzanines, split-levels and raised platforms
 *    while still treating walls / cover / furniture as blocking obstacles.
 *
 * Ceilings/roofs in interior maps must be left non-pickable so this downward
 * ray passes through them to the floor below.
 */
export function isNavigable(scene: Scene, pos: Vector3): boolean {
  const h = playableHalf();
  if (Math.abs(pos.x) > h || Math.abs(pos.z) > h) return false;

  // Memoised on a coarse grid: the world is static for the whole run, so the
  // answer for a given column never changes between rebuilds of the ray index.
  // AI re-probes the same ground constantly (stuck checks, spawn validation,
  // the patrol/relocate paths), and this turns almost all of that into a map
  // lookup. `navCacheGeneration` is bumped whenever the static world changes.
  if (navCacheGeneration !== rayIndexGeneration()) {
    navCache.clear();
    navCacheGeneration = rayIndexGeneration();
  }
  const key = navKey(pos.x, pos.z);
  const cached = navCache.get(key);
  if (cached !== undefined) return cached;

  // `probeGround` walks only the grid cells under this column instead of
  // testing every mesh in the scene — see RayIndex for why that matters. It
  // considers only enabled, non-disposed static geometry, which is what the
  // old `isEnabled()` predicate was there to enforce: without it the raycast
  // hit maps that are switched off, and the hidden Singapore city was blocking
  // navigation across Pasir Panjang Terminal from a carpark slab 11m up.
  const hit = probeGround(scene, pos.x, pos.z, 200, 210);
  let result: boolean;
  if (!hit) {
    result = true; // nothing solid at all — open ground
  } else if (hit.mesh.metadata?.walkable === true) {
    result = true; // tagged interior floor/ramp/platform
  } else {
    // Otherwise the topmost solid surface must be the outdoor ground itself.
    result = hit.mesh.name === "ground" && hit.y < 0.8;
  }
  navCache.set(key, result);
  return result;
}

/**
 * Navigability memo. Keyed on a ~0.5m grid — finer than any decision the AI
 * makes with it, coarse enough that repeated probes around a single enemy all
 * collapse onto the same entry. Cleared wholesale whenever the static world
 * changes (map build/switch), which is the only thing that can change an answer.
 */
const navCache = new Map<number, boolean>();
/** Static-world generation the memo's contents belong to (see RayIndex). */
let navCacheGeneration = -1;
const NAV_CACHE_CELL = 0.5;
/** Grid is ±512m at 0.5m resolution — comfortably larger than any map's bounds. */
function navKey(x: number, z: number): number {
  const gx = Math.round(x / NAV_CACHE_CELL) + 1024;
  const gz = Math.round(z / NAV_CACHE_CELL) + 1024;
  return gx * 4096 + gz;
}

/** Drop every memoised navigability answer. Normally unnecessary — the memo
 * self-invalidates on the RayIndex generation — but exposed for tests. */
export function clearNavCache(): void {
  navCache.clear();
}

/**
 * Returns `pos` if it's already navigable, otherwise the nearest open spot
 * found by spiralling outward. Always returns a point clamped into bounds —
 * even in the worst case it won't hand back something outside the arena.
 */
export function findNearestNavigable(scene: Scene, pos: Vector3, maxRadius = 16): Vector3 {
  const start = clampToPlayable(pos);
  if (isNavigable(scene, start)) return start;
  for (let r = 2; r <= maxRadius; r += 2) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r; // rotate rings so samples don't line up
      const p = clampToPlayable(new Vector3(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r));
      if (isNavigable(scene, p)) return p;
    }
  }
  return start;
}
