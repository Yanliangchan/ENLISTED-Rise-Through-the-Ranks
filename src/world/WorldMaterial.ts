import { PBRMaterial, Scene, Color3, BaseTexture } from "@babylonjs/core";

/**
 * PBR material with a StandardMaterial-compatible authoring surface, so the
 * whole procedural world upgrades from Blinn-Phong to physically based
 * rendering without rewriting every builder. Legacy setters map onto the
 * metallic/roughness model:
 *
 *  - `diffuseColor` / `diffuseTexture`  → albedo
 *  - `specularColor = Black()`          → fully matte (the common "no shine" idiom)
 *  - `specularColor` + `specularPower`  → lower roughness (glass, car paint)
 *
 * Everything defaults to a rough dielectric (concrete/canvas/paint), which is
 * what 90% of the city is made of; glass and water override roughness
 * explicitly where they're built.
 */
export class WorldMaterial extends PBRMaterial {
  constructor(name: string, scene: Scene) {
    super(name, scene);
    this.metallic = 0;
    this.roughness = 0.92;
    // Procedural sky IBL is fairly bright — keep ambient response moderate so
    // shaded faces stay readable without washing out the sun/shade contrast.
    this.environmentIntensity = 0.55;
    this.specularIntensity = 0.6;
    // Headroom above the default 4: the static rig alone (hemi + sun/moon +
    // fill) is 3, the weapon flashlight is admitted as a 4th (see
    // admitLightToFrozenWorld in Level.ts) — without this, a later dynamic
    // light (e.g. an illumination flare) would have no free slot to bind into
    // on frozen world geometry and would only ever light unfrozen dynamic
    // actors, never the buildings/ground around it.
    this.maxSimultaneousLights = 8;
  }

  get diffuseColor(): Color3 {
    return this.albedoColor;
  }
  set diffuseColor(c: Color3) {
    this.albedoColor = c;
  }

  get diffuseTexture(): BaseTexture | null {
    return this.albedoTexture;
  }
  set diffuseTexture(t: BaseTexture | null) {
    this.albedoTexture = t;
  }

  get specularColor(): Color3 {
    const gloss = 1 - (this.roughness ?? 0.92);
    return new Color3(gloss, gloss, gloss);
  }
  set specularColor(c: Color3) {
    const strength = (c.r + c.g + c.b) / 3;
    this.roughness = strength <= 0.02 ? 0.95 : Math.max(0.3, 0.92 - strength * 0.75);
  }

  get specularPower(): number {
    return 64;
  }
  set specularPower(p: number) {
    this.roughness = Math.max(0.18, 0.9 - Math.min(1, p / 96) * 0.6);
  }

  get useAlphaFromDiffuseTexture(): boolean {
    return this.useAlphaFromAlbedoTexture;
  }
  set useAlphaFromDiffuseTexture(v: boolean) {
    this.useAlphaFromAlbedoTexture = v;
  }
}
