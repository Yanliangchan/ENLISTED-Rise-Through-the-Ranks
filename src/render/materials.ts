import { Color3, PBRMaterial, Scene, type Texture } from "@babylonjs/core";
import {
  fabricNormal,
  grainTexture,
  metalNormal,
  no4CamoTexture,
  opforCamoTexture,
  polymerNormal,
} from "@/render/textures";

/**
 * The shared PBR material library (ART_DIRECTION.md §5). Every hero asset —
 * weapons, hands, soldiers, kit — draws from this one set, so steel looks
 * like the same steel on every gun and No. 4 fabric is one material however
 * many soldiers wear it. Materials are built once per scene and must never
 * be disposed by an individual asset (dispose meshes with
 * `disposeMaterialAndTextures = false`).
 */
export interface MaterialLibrary {
  gunSteel: PBRMaterial;
  gunSteelWorn: PBRMaterial;
  polymerOlive: PBRMaterial;
  polymerBlack: PBRMaterial;
  aluminium: PBRMaterial;
  lens: PBRMaterial;
  magTranslucent: PBRMaterial;
  brass: PBRMaterial;
  rubber: PBRMaterial;
  no4Fabric: PBRMaterial;
  webbingOlive: PBRMaterial;
  glove: PBRMaterial;
  skin: PBRMaterial;
  bootLeather: PBRMaterial;
  helmetNo4: PBRMaterial;
  opforFabric: PBRMaterial;
  opforGear: PBRMaterial;
  opforArmband: PBRMaterial;
  balaclava: PBRMaterial;
  launcherOlive: PBRMaterial;
}

const libs = new WeakMap<Scene, MaterialLibrary>();

function hex(h: string): Color3 {
  return Color3.FromHexString(h).toLinearSpace();
}

interface Spec {
  albedo: string;
  metallic: number;
  roughness: number;
  albedoTex?: Texture;
  bump?: Texture;
  bumpLevel?: number;
  uvScale?: number;
  alpha?: number;
  env?: number;
}

function make(scene: Scene, name: string, s: Spec): PBRMaterial {
  const m = new PBRMaterial(`mat_${name}`, scene);
  m.albedoColor = hex(s.albedo);
  m.metallic = s.metallic;
  m.roughness = s.roughness;
  m.environmentIntensity = s.env ?? 0.7;
  // Same light headroom as WorldMaterial: sun + sky + fill + flashlight + flares.
  m.maxSimultaneousLights = 8;
  if (s.albedoTex) {
    m.albedoTexture = s.albedoTex;
    if (s.uvScale) {
      // Textures are shared, so scale via a per-material clone of the sampler state.
      const t = s.albedoTex.clone();
      t.uScale = t.vScale = s.uvScale;
      m.albedoTexture = t;
    }
  }
  if (s.bump) {
    const b = s.bump.clone();
    b.level = s.bumpLevel ?? 0.6;
    if (s.uvScale) b.uScale = b.vScale = s.uvScale * 4;
    m.bumpTexture = b;
  }
  if (s.alpha !== undefined && s.alpha < 1) {
    m.alpha = s.alpha;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  }
  return m;
}

export function materialLibrary(scene: Scene): MaterialLibrary {
  const existing = libs.get(scene);
  if (existing) return existing;

  const grain = grainTexture(scene, 0x6a1e, 0.1);
  const grainStrong = grainTexture(scene, 0x6a1f, 0.22);
  const lib: MaterialLibrary = {
    gunSteel: make(scene, "gunSteel", { albedo: "#2f3133", metallic: 0.85, roughness: 0.42, albedoTex: grain, bump: metalNormal(scene), bumpLevel: 0.25 }),
    gunSteelWorn: make(scene, "gunSteelWorn", { albedo: "#4d4f52", metallic: 0.9, roughness: 0.34, albedoTex: grainStrong, bump: metalNormal(scene), bumpLevel: 0.3 }),
    polymerOlive: make(scene, "polymerOlive", { albedo: "#454b37", metallic: 0, roughness: 0.6, albedoTex: grain, bump: polymerNormal(scene), bumpLevel: 0.35 }),
    polymerBlack: make(scene, "polymerBlack", { albedo: "#222323", metallic: 0, roughness: 0.56, albedoTex: grain, bump: polymerNormal(scene), bumpLevel: 0.35 }),
    aluminium: make(scene, "aluminium", { albedo: "#2e3032", metallic: 0.7, roughness: 0.36, albedoTex: grain }),
    lens: make(scene, "lens", { albedo: "#0d1716", metallic: 0.2, roughness: 0.04, env: 1.4 }),
    magTranslucent: make(scene, "magTranslucent", { albedo: "#5a594c", metallic: 0, roughness: 0.3, alpha: 0.82, env: 1.0 }),
    brass: make(scene, "brass", { albedo: "#b08d4a", metallic: 1, roughness: 0.32 }),
    rubber: make(scene, "rubber", { albedo: "#1a1a1a", metallic: 0, roughness: 0.85 }),
    no4Fabric: make(scene, "no4Fabric", { albedo: "#ffffff", metallic: 0, roughness: 0.9, albedoTex: no4CamoTexture(scene), bump: fabricNormal(scene), bumpLevel: 0.5, env: 0.5 }),
    webbingOlive: make(scene, "webbingOlive", { albedo: "#4b5233", metallic: 0, roughness: 0.82, albedoTex: grainStrong, bump: fabricNormal(scene), bumpLevel: 0.6, env: 0.5 }),
    glove: make(scene, "glove", { albedo: "#3b3b33", metallic: 0, roughness: 0.84, albedoTex: grain, bump: fabricNormal(scene), bumpLevel: 0.4, env: 0.5 }),
    skin: make(scene, "skin", { albedo: "#b8866a", metallic: 0, roughness: 0.58, albedoTex: grain, env: 0.5 }),
    bootLeather: make(scene, "bootLeather", { albedo: "#1f1d1a", metallic: 0, roughness: 0.6, albedoTex: grain }),
    helmetNo4: make(scene, "helmetNo4", { albedo: "#ffffff", metallic: 0, roughness: 0.88, albedoTex: no4CamoTexture(scene), bump: fabricNormal(scene), bumpLevel: 0.5, env: 0.5 }),
    opforFabric: make(scene, "opforFabric", { albedo: "#ffffff", metallic: 0, roughness: 0.9, albedoTex: opforCamoTexture(scene), bump: fabricNormal(scene), bumpLevel: 0.5, env: 0.5 }),
    opforGear: make(scene, "opforGear", { albedo: "#2d2e2b", metallic: 0, roughness: 0.8, albedoTex: grainStrong, bump: fabricNormal(scene), bumpLevel: 0.5, env: 0.5 }),
    opforArmband: make(scene, "opforArmband", { albedo: "#8a2e22", metallic: 0, roughness: 0.85, albedoTex: grain }),
    balaclava: make(scene, "balaclava", { albedo: "#1e1f1c", metallic: 0, roughness: 0.92, bump: fabricNormal(scene), bumpLevel: 0.5 }),
    launcherOlive: make(scene, "launcherOlive", { albedo: "#4a5236", metallic: 0.05, roughness: 0.55, albedoTex: grainStrong }),
  };
  libs.set(scene, lib);
  return lib;
}

/** True for any material owned by the library — used to keep them out of per-asset disposal and global freeze churn. */
export function isLibraryMaterial(scene: Scene, mat: unknown): boolean {
  const lib = libs.get(scene);
  return !!lib && Object.values(lib).includes(mat as PBRMaterial);
}
