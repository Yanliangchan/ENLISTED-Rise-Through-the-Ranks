import { Scene, Vector3, Ray } from "@babylonjs/core";
import { activeMap } from "@/world/MapProfile";

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
  const ray = new Ray(new Vector3(pos.x, 200, pos.z), new Vector3(0, -1, 0), 210);
  // `isEnabled()` is load-bearing, not belt-and-braces: when pickWithRay is
  // given a predicate, Babylon uses it INSTEAD of its own
  // enabled/visible/pickable checks. Without it the raycast still hits maps
  // that are switched off — the hidden Singapore city was blocking navigation
  // across Pasir Panjang Terminal from a carpark slab 11m up.
  const pick = scene.pickWithRay(ray, (m) => m.isEnabled() && m.isPickable && m.checkCollisions);
  if (!pick?.hit) return true; // nothing solid at all — open ground
  const mesh = pick.pickedMesh;
  if (mesh?.metadata?.walkable === true) return true; // tagged interior floor/ramp/platform
  // Otherwise the topmost solid surface must be the outdoor ground itself.
  return mesh?.name === "ground" && (pick.pickedPoint?.y ?? 99) < 0.8;
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
