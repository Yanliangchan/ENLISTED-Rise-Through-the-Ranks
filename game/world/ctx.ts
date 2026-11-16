import * as THREE from "three";
import type { Engine } from "~/core/engine";
import { Builder, CollisionSoup, Surf } from "~/gfx/builder";
import type { MatLib } from "~/gfx/materials";
import { DECAL, SignAtlas, decalAtlasTex, decalUV, paintLineTex, type UVRect } from "~/gfx/decals";
import { rng, type Rand } from "~/gfx/noise";

/** A light source baked into the light volume (interiors, lamps). */
export interface Lamp {
  pos: THREE.Vector3;
  /** Brightness at 1 m. */
  power: number;
  radius: number;
}

/** Everything a kit function needs to add to the world. */
export class WorldCtx {
  readonly soup = new CollisionSoup();
  readonly signs = new SignAtlas();
  readonly root = new THREE.Group();
  readonly lamps: Lamp[] = [];
  readonly rand: Rand = rng(20240);
  /** Rectangles (x0, z0, x1, z1) the lawn must not cover. */
  readonly noGrass: number[][] = [];

  constructor(readonly engine: Engine, readonly lib: MatLib) {
    this.root.name = "world";
    const flat = (map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra });
    lib.add("roadpaint", flat(paintLineTex(), { alphaTest: 0.4, roughness: 0.7 }), 1.2, Surf.Asphalt, "none", { castShadow: false });
    lib.add("decal", flat(decalAtlasTex(), { transparent: true, depthWrite: false }), 1, Surf.Asphalt, "none", { castShadow: false });
    lib.add(
      "puddle",
      flat(decalAtlasTex(), { transparent: true, depthWrite: false, color: 0x1a1c1e, roughness: 0.03, metalness: 0, envMapIntensity: 2.4, vertexColors: false, polygonOffsetFactor: -3 }),
      1,
      Surf.Water,
      "none",
      { castShadow: false }
    );
    lib.add("sign", flat(this.signs.texture, { roughness: 0.6, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 1, Surf.Metal, "none", { castShadow: false });
    lib.add("signlit", new THREE.MeshStandardMaterial({ map: this.signs.texture, emissiveMap: this.signs.texture, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 1, Surf.Glass, "none", { castShadow: false, noVis: true });
  }

  get mats(): MatLib["mats"] {
    return this.lib.mats;
  }

  builder(name: string): Builder {
    return new Builder(name, this.lib.mats, this.soup);
  }

  /** Emit a builder's meshes into the world. */
  commit(b: Builder): THREE.Group {
    const g = b.build();
    this.root.add(g);
    return g;
  }

  lamp(x: number, y: number, z: number, power: number, radius: number): void {
    this.lamps.push({ pos: new THREE.Vector3(x, y, z), power, radius });
  }
}

/** A flat quad lying on the ground (road paint, decals), centred and yawed. */
export function groundQuad(b: Builder, key: string, cx: number, cz: number, w: number, l: number, yaw: number, y: number, tint?: THREE.ColorRepresentation, uv?: UVRect): void {
  b.at(cx, y, cz, yaw, () => {
    const hw = w / 2;
    const hl = l / 2;
    const uvs = uv ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] : undefined;
    b.quad(key, [-hw, 0, hl], [hw, 0, hl], [hw, 0, -hl], [-hw, 0, -hl], { tint, collide: "none" }, uvs);
  });
}

/** Place a ground decal from the atlas. */
export function decal(b: Builder, cell: number, cx: number, cz: number, size: number, yaw: number, y = 0.012, tint?: THREE.ColorRepresentation, aspect = 1): void {
  groundQuad(b, cell === DECAL.puddle ? "puddle" : "decal", cx, cz, size, size * aspect, yaw, y, tint, decalUV(cell));
}

/** A sign panel on a vertical surface. `yaw` 0 faces +Z. */
export function signQuad(b: Builder, uv: UVRect, x: number, y: number, z: number, w: number, h: number, yaw: number, lit = false): void {
  b.at(x, y, z, yaw, () => {
    b.quad(lit ? "signlit" : "sign", [-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], { collide: "none" }, [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]);
  });
}
