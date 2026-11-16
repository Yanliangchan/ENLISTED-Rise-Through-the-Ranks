import * as THREE from "three";
import type { Engine, LitOpts } from "~/core/engine";
import { Surf, type Collide, type MatDef } from "./builder";
import { buildSurfaces } from "./surfaces";
import type { TexSet } from "./textures";

/**
 * World material library. One MeshStandardMaterial per surface type, shared
 * by every part that uses it; colour variety comes from per-part vertex tint.
 */
export type Mats = Record<string, MatDef>;

export interface MatLib {
  mats: Mats;
  tex: Record<string, TexSet>;
  /** Register an extra material after the fact (signs, decals, foliage). */
  add(key: string, material: THREE.Material, tile: number, surf: Surf, collide: Collide, opts?: LitOpts & { castShadow?: boolean; receiveShadow?: boolean }): MatDef;
}

export function std(set: TexSet | null, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: set ? 1 : 0,
    ...(set ? { map: set.map, normalMap: set.normalMap, aoMap: set.ormMap, roughnessMap: set.ormMap, metalnessMap: set.ormMap } : {}),
    ...params,
  });
  return m;
}

export function buildMaterials(engine: Engine): MatLib {
  const tex = buildSurfaces();
  const mats: Mats = {};
  const add: MatLib["add"] = (key, material, tile, surf, collide, opts = {}) => {
    engine.lit(material, opts);
    const def: MatDef = { material, tile, surf, collide, castShadow: opts.castShadow, receiveShadow: opts.receiveShadow };
    mats[key] = def;
    return def;
  };

  add("concrete", std(tex.concrete), 3, Surf.Concrete, "solid", { macro: 0.5 });
  add("paint", std(tex.paint), 4, Surf.Plaster, "solid", { macro: 0.55 });
  add("plaster", std(tex.plaster), 3.2, Surf.Plaster, "solid", { macro: 0.6 });
  add("asphalt", std(tex.asphalt), 4.5, Surf.Asphalt, "solid", { macro: 0.7 });
  add("pavers", std(tex.pavers), 2, Surf.Concrete, "solid", { macro: 0.6 });
  add("floortile", std(tex.floortile), 1.3, Surf.Tile, "solid", { macro: 0.4 });
  add("walltile", std(tex.walltile), 1.2, Surf.Tile, "solid", { macro: 0.3 });
  add("screed", std(tex.screed), 3, Surf.Concrete, "solid", { macro: 0.5 });
  add("rooftile", std(tex.rooftile), 1.8, Surf.Tile, "solid", { macro: 0.5 });
  add("ribmetal", std(tex.ribmetal), 1.2, Surf.Metal, "solid", { macro: 0.4 });
  add("paintmetal", std(tex.paintmetal), 1.4, Surf.Metal, "solid", { macro: 0.25 });
  add("steel", std(tex.steel), 1.2, Surf.Metal, "solid", { macro: 0.2 });
  add("rust", std(tex.rust), 1.5, Surf.Metal, "solid", { macro: 0.4 });
  add("wood", std(tex.wood), 1.6, Surf.Wood, "solid", { macro: 0.4 });
  add("brick", std(tex.brick), 1.8, Surf.Concrete, "solid", { macro: 0.5 });
  add("grass", std(tex.grass), 3.5, Surf.Grass, "solid", { macro: 0.9 });
  add("dirt", std(tex.dirt), 3, Surf.Dirt, "solid", { macro: 0.8 });
  add("drain", std(tex.drain), 3, Surf.Concrete, "solid", { macro: 0.6 });
  add("sandbag", std(tex.sandbag), 0.9, Surf.Sandbag, "solid", { macro: 0.4 });
  add("canvas", std(tex.canvas), 1.6, Surf.Sandbag, "solid", { macro: 0.4 });
  add("plastic", std(tex.plastic), 1, Surf.Plastic, "solid", { macro: 0.15 });
  add("rubber", std(tex.rubber), 0.5, Surf.Rubber, "solid", {});
  // Thin dressing that should never stop a player or a bullet.
  add("trim", std(tex.paintmetal), 1.4, Surf.Metal, "none", { macro: 0.2 });
  add("rail", std(tex.paintmetal), 1.4, Surf.Metal, "soft", { macro: 0.2 });
  add(
    "glass",
    std(null, { color: 0xffffff, roughness: 0.06, metalness: 0.0, envMapIntensity: 2.2, vertexColors: true }),
    1,
    Surf.Glass,
    "solid",
    {}
  );
  add("carpaint", std(null, { roughness: 0.28, metalness: 0.35, envMapIntensity: 1.3 }), 1, Surf.Metal, "solid", { macro: 0.25 });
  add("emissiveoff", std(null, { roughness: 0.15, metalness: 0.1, envMapIntensity: 1.6 }), 1, Surf.Glass, "none", {});
  add("emissive", new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff2d8, emissiveIntensity: 2.2, vertexColors: false }), 1, Surf.Glass, "none", { noVis: true, castShadow: false });
  return { mats, tex, add };
}
