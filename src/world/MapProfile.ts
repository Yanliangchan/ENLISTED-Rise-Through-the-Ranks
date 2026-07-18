import { Vector3 } from "@babylonjs/core";
import { CAMP_POSITION } from "@/world/Level";

/**
 * Per-map configuration for everything the wave/AI/safe-zone systems used to
 * read from hardcoded Singapore-map constants: the friendly base location
 * (deploy point + safe-zone centre + AI no-go centre + radar marker), the
 * OPFOR spawn ring, and the standoff radii. One profile is active at a time,
 * chosen at boot (see main.ts). SafeZone, EnemySpawner, EnemyAI, Botty and the
 * tactical map all read the active profile instead of a fixed constant, so a
 * second map (Iron Citadel) can define its own base + spawns without touching
 * any of them.
 */
export interface MapProfile {
  id: string;
  /** Player deploy point AND friendly-base centre (safe zone, AI exclusion, retreat target, radar HQ marker). */
  baseCenter: Vector3;
  /** Fully damage-protected radius around the base. */
  safeZoneRadius: number;
  /** AI no-go radius around the base — larger than the safe zone so OPFOR reroute before reaching its edge. */
  aiExclusionRadius: number;
  /** OPFOR never spawn closer than this to the base. */
  minSpawnDistanceFromBase: number;
  /** Seconds of post-spawn damage immunity after leaving the safe zone. */
  spawnProtectionSec: number;
  /** Ring of OPFOR spawn anchors — jittered + validated at runtime by EnemySpawner. */
  enemySpawnPoints: Vector3[];
}

/** The original dense Singapore-district map (default). Values lifted verbatim from the old SafeZone/EnemySpawner constants so behaviour is unchanged. */
export const SINGAPORE_PROFILE: MapProfile = {
  id: "singapore",
  baseCenter: CAMP_POSITION,
  safeZoneRadius: 26,
  aiExclusionRadius: 42,
  minSpawnDistanceFromBase: 42 + 15,
  spawnProtectionSec: 4,
  enemySpawnPoints: [
    new Vector3(77, 0, 0),
    new Vector3(-77, 0, 0),
    new Vector3(0, 0, 77),
    new Vector3(0, 0, -77),
    new Vector3(53, 0, 53),
    new Vector3(-53, 0, 53),
    new Vector3(53, 0, -53),
    new Vector3(-16, 0, -77),
  ],
};

let active: MapProfile = SINGAPORE_PROFILE;

/** Set once at boot, before the wave systems run, based on the player's chosen map. */
export function setActiveMap(profile: MapProfile): void {
  active = profile;
}

/** The currently-active map's config. Read at call time so a boot-time swap is picked up everywhere. */
export function activeMap(): MapProfile {
  return active;
}
