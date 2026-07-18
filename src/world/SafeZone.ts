import { Vector3 } from "@babylonjs/core";
import { activeMap } from "@/world/MapProfile";
import type { PlayerController } from "@/player/PlayerController";

// Safe-zone / exclusion / spawn-standoff radii and the base centre now come
// from the active map profile (see MapProfile.ts) so a second map can define
// its own base and radii. The Singapore profile carries the original values,
// so this is behaviour-preserving for that map.

function flatDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isInSafeZone(position: Vector3): boolean {
  const m = activeMap();
  return flatDistance(position, m.baseCenter) < m.safeZoneRadius;
}

export function isInExclusionZone(position: Vector3): boolean {
  const m = activeMap();
  return flatDistance(position, m.baseCenter) < m.aiExclusionRadius;
}

/** Pushes a spawn point radially outward until it clears the minimum base standoff distance. */
export function ensureClearOfCamp(position: Vector3): Vector3 {
  const m = activeMap();
  const base = m.baseCenter;
  const dx = position.x - base.x;
  const dz = position.z - base.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= m.minSpawnDistanceFromBase || dist < 0.001) return position;
  const scale = m.minSpawnDistanceFromBase / dist;
  return new Vector3(base.x + dx * scale, position.y, base.z + dz * scale);
}

/**
 * Steers a desired movement direction away from the AI exclusion zone so
 * OPFOR curve around the camp instead of walking up to its edge and
 * stalling there. Only nudges the direction when it's actually heading
 * further into the zone; otherwise leaves it untouched.
 */
export function steerAroundExclusionZone(position: Vector3, dir: Vector3): Vector3 {
  const m = activeMap();
  const toCentre = new Vector3(m.baseCenter.x - position.x, 0, m.baseCenter.z - position.z);
  const dist = toCentre.length();
  if (dist > m.aiExclusionRadius + 8 || dist < 0.001) return dir;
  const toCentreNorm = toCentre.normalize();
  const approachAmount = Vector3.Dot(dir, toCentreNorm);
  if (approachAmount <= 0) return dir; // already moving away/tangential, no correction needed
  const tangent = new Vector3(-toCentreNorm.z, 0, toCentreNorm.x);
  const steered = dir.subtract(toCentreNorm.scale(approachAmount)).add(tangent.scale(0.7));
  return steered.lengthSquared() > 0.0001 ? steered.normalize() : dir;
}

/**
 * Tracks the player's safe-zone state frame to frame: writes
 * `player.inSafeZone`/`player.spawnProtected` (read by
 * PlayerController.takeDamage and the AI's detection checks) and fires
 * enter/exit callbacks for the HUD indicator + a brief message.
 */
export class SafeZoneManager {
  private wasInside = true;
  private protectionTimer = 0;
  onEnter?: () => void;
  onExit?: () => void;

  constructor(private readonly player: PlayerController) {
    this.player.inSafeZone = true;
  }

  update(dt: number): void {
    const inside = isInSafeZone(this.player.position);
    this.player.inSafeZone = inside;

    if (inside && !this.wasInside) {
      this.protectionTimer = 0;
      this.player.spawnProtected = false;
      this.onEnter?.();
    } else if (!inside && this.wasInside) {
      this.protectionTimer = activeMap().spawnProtectionSec;
      this.player.spawnProtected = true;
      this.onExit?.();
    }

    if (this.protectionTimer > 0) {
      this.protectionTimer -= dt;
      if (this.protectionTimer <= 0) this.player.spawnProtected = false;
    }

    this.wasInside = inside;
  }
}
