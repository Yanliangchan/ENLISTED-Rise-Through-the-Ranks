/** Anything a hitscan/blast can damage — enemies implement this; meshes tag themselves via metadata. */
export interface Damageable {
  id: string;
  isDead: boolean;
  takeDamage(damage: number, isHeadshot: boolean, sourcePosition?: import("@babylonjs/core").Vector3): void;
}

/** Which body region a hit mesh represents — drives the damage multiplier. */
export type HitZone = "head" | "body" | "limb";

/** Damage multipliers by hit zone. Head keeps the weapon's own headshot bonus (>= 2.0). */
export const ZONE_MULTIPLIER: Record<Exclude<HitZone, "head">, number> = {
  body: 1.5,
  limb: 1.0,
};

export interface HitMeshMetadata {
  damageable: Damageable;
  /** Region this mesh represents; defaults to "body" when omitted. */
  hitZone?: HitZone;
  /** Legacy flag — kept in sync with `hitZone === "head"` for existing call sites. */
  isHeadshotMesh?: boolean;
}
