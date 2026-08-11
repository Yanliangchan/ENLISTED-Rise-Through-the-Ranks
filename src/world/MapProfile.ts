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
  /**
   * Half-extent of this map's navigable square, in metres. Omitted means
   * Nav.ts's default (96) — the Singapore boundary wall. Only maps that
   * genuinely need a bigger footprint set it.
   */
  playableHalfM?: number;
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

/**
 * Pasir Panjang Terminal — the PSA container terminal on the southwestern
 * coast, and the venue for both Operations (see PasirPanjang.ts,
 * StrongpointMission.ts). Centred on the world origin like Singapore rather
 * than offset far away like Iron Citadel: the terminal spawns real AI through
 * EnemyManager, so it needs isNavigable()/findNearestNavigable() to actually
 * resolve, and those measure from the origin. Only one map root is ever
 * enabled at a time (main.ts), so sharing the coordinate range is safe —
 * nothing renders or gets picked from the inactive map's geometry.
 *
 * The terminal is substantially larger than the city, so it raises the
 * navigable bound via playableHalfM; Singapore and Iron Citadel omit the field
 * and keep Nav.ts's original 96.
 */
export const PASIR_PANJANG_PROFILE: MapProfile = {
  id: "pasir_panjang",
  baseCenter: new Vector3(0, 0, -116),
  safeZoneRadius: 11,
  aiExclusionRadius: 20,
  minSpawnDistanceFromBase: 34,
  spawnProtectionSec: 3,
  playableHalfM: 130,
  // Ring of approaches for the Ranger Gauntlet's waves — spread across the
  // yard so successive waves come from genuinely different directions rather
  // than funnelling up one lane.
  enemySpawnPoints: [
    new Vector3(-74, 0, -60),
    new Vector3(74, 0, -56),
    new Vector3(-96, 0, -14),
    new Vector3(96, 0, -10),
    new Vector3(-58, 0, 30),
    new Vector3(60, 0, 34),
    new Vector3(-24, 0, 62),
    new Vector3(28, 0, 66),
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
