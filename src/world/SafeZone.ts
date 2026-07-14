import { Vector3 } from "@babylonjs/core";
import { CAMP_POSITION } from "@/world/Level";
import type { PlayerController } from "@/player/PlayerController";

/** Radius (metres, XZ-plane) of the fully-protected safe zone — covers the whole camp: clearing, tents, and checkpoint. */
export const SAFE_ZONE_RADIUS = 26;
/** Radius of the AI no-go zone around the camp — comfortably larger than the safe zone so OPFOR reroute well before reaching its edge. */
export const AI_EXCLUSION_RADIUS = 42;
/** Enemies never spawn closer than this to the camp. */
export const MIN_SPAWN_DISTANCE_FROM_CAMP = AI_EXCLUSION_RADIUS + 15;
/** Seconds of incoming-damage immunity after leaving the safe zone — cancelled instantly if the player fires or throws. */
export const SPAWN_PROTECTION_SEC = 4;

function flatDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isInSafeZone(position: Vector3): boolean {
  return flatDistance(position, CAMP_POSITION) < SAFE_ZONE_RADIUS;
}

export function isInExclusionZone(position: Vector3): boolean {
  return flatDistance(position, CAMP_POSITION) < AI_EXCLUSION_RADIUS;
}

/** Pushes a spawn point radially outward until it clears the minimum camp standoff distance. */
export function ensureClearOfCamp(position: Vector3): Vector3 {
  const dx = position.x - CAMP_POSITION.x;
  const dz = position.z - CAMP_POSITION.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= MIN_SPAWN_DISTANCE_FROM_CAMP || dist < 0.001) return position;
  const scale = MIN_SPAWN_DISTANCE_FROM_CAMP / dist;
  return new Vector3(CAMP_POSITION.x + dx * scale, position.y, CAMP_POSITION.z + dz * scale);
}

/**
 * Steers a desired movement direction away from the AI exclusion zone so
 * OPFOR curve around the camp instead of walking up to its edge and
 * stalling there. Only nudges the direction when it's actually heading
 * further into the zone; otherwise leaves it untouched.
 */
export function steerAroundExclusionZone(position: Vector3, dir: Vector3): Vector3 {
  const toCentre = new Vector3(CAMP_POSITION.x - position.x, 0, CAMP_POSITION.z - position.z);
  const dist = toCentre.length();
  if (dist > AI_EXCLUSION_RADIUS + 8 || dist < 0.001) return dir;
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
      this.protectionTimer = SPAWN_PROTECTION_SEC;
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
