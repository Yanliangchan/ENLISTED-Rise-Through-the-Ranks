/** Anything a hitscan/blast can damage — enemies implement this; meshes tag themselves via metadata. */
export interface Damageable {
  id: string;
  isDead: boolean;
  takeDamage(damage: number, isHeadshot: boolean, sourcePosition?: import("@babylonjs/core").Vector3): void;
}

export interface HitMeshMetadata {
  damageable: Damageable;
  isHeadshotMesh?: boolean;
}
