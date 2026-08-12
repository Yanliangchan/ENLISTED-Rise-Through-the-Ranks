import { Scene, Mesh, MeshBuilder, TransformNode, Vector3, Matrix, Quaternion } from "@babylonjs/core";
import { mulberry32 } from "@/world/Level";
import type { TerminalMats } from "@/world/TerminalSurfaces";

/**
 * Tropical vegetation for Pasir Panjang Terminal.
 *
 * PERFORMANCE — everything here is thin-instanced. Each vegetation type is one
 * source mesh with a matrix buffer, so a thousand fern fronds cost one draw
 * call rather than a thousand. Nothing in this file is ever cloned per-plant.
 *
 * NAVIGATION — undergrowth is `checkCollisions = false` and `isPickable =
 * false`, which means Nav.ts's downward ray passes straight through it and the
 * ground below still resolves as navigable. Grass can therefore be as dense as
 * it likes without ever walling the AI out of an area or creating phantom
 * cover. Tree TRUNKS are the deliberate exception: those collide, because a
 * tree you can walk through reads as broken.
 *
 * PLACEMENT — a working container terminal is not overgrown. Vegetation lives
 * where a port actually has it: the drainage margins, the fence line, the
 * neglected corners of the apron, and the Bukit Chandu ridge above the yard.
 * The operating surfaces stay clear so combat routes stay readable.
 */

/** A patch of ground that should be planted, and how thickly. */
export interface FoliagePatch {
  x: number;
  z: number;
  /** Patch radius in metres. */
  r: number;
  /** Roughly plants per 100m² — 1 is sparse verge, 4 is thick scrub. */
  density: number;
  /** Ground height to sit the plants on (the ridge terraces sit above 0). */
  y?: number;
  /** Adds palms/trees as well as undergrowth. */
  trees?: boolean;
}

interface Buffers {
  grass: Matrix[];
  fern: Matrix[];
  bush: Matrix[];
  frond: Matrix[];
}

function xform(x: number, y: number, z: number, scale: number, yaw: number, tilt = 0): Matrix {
  return Matrix.Compose(
    new Vector3(scale, scale * (0.85 + Math.random() * 0.4), scale),
    Quaternion.FromEulerAngles(tilt, yaw, 0),
    new Vector3(x, y, z)
  );
}

/** A grass tuft: three crossed blades. Cheap, and reads as a clump from any angle. */
function grassSource(scene: Scene, mats: TerminalMats): Mesh {
  const blade = MeshBuilder.CreateBox("ppVegGrass", { width: 0.5, height: 0.7, depth: 0.06 }, scene);
  blade.material = mats.foliage[1];
  return blade;
}

/** A fern frond — a flat, wide, slightly drooping leaf. */
function fernSource(scene: Scene, mats: TerminalMats): Mesh {
  const frond = MeshBuilder.CreateBox("ppVegFern", { width: 1.5, height: 0.1, depth: 0.34 }, scene);
  frond.material = mats.foliage[0];
  return frond;
}

/** A low bush — a squat mass rather than a sphere, so it silhouettes like scrub. */
function bushSource(scene: Scene, mats: TerminalMats): Mesh {
  const bush = MeshBuilder.CreateBox("ppVegBush", { width: 1.5, height: 1.1, depth: 1.4 }, scene);
  bush.material = mats.foliage[2];
  return bush;
}

/** A palm frond, used both for palm crowns and as tall grass at the water's edge. */
function frondSource(scene: Scene, mats: TerminalMats): Mesh {
  const f = MeshBuilder.CreateBox("ppVegFrond", { width: 3.2, height: 0.1, depth: 0.5 }, scene);
  f.material = mats.foliage[3];
  return f;
}

/**
 * Plants one patch. Uses rejection sampling in a disc with a light clustering
 * bias so plants gather rather than spreading out on an even lattice — the
 * single biggest thing that stops vegetation reading as procedural scatter.
 */
function fillPatch(patch: FoliagePatch, rand: () => number, buf: Buffers): void {
  const area = Math.PI * patch.r * patch.r;
  const count = Math.round((area / 100) * patch.density * 10);
  const baseY = patch.y ?? 0;
  // A handful of clump centres per patch; most plants land near one of them.
  const clumps = Math.max(2, Math.round(patch.r / 4));
  const centres: Array<[number, number]> = [];
  for (let i = 0; i < clumps; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * patch.r;
    centres.push([patch.x + Math.cos(a) * d, patch.z + Math.sin(a) * d]);
  }

  for (let i = 0; i < count; i++) {
    let px: number;
    let pz: number;
    if (rand() < 0.78) {
      const [cx, cz] = centres[Math.floor(rand() * centres.length)];
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (patch.r * 0.3);
      px = cx + Math.cos(a) * d;
      pz = cz + Math.sin(a) * d;
    } else {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * patch.r;
      px = patch.x + Math.cos(a) * d;
      pz = patch.z + Math.sin(a) * d;
    }
    const yaw = rand() * Math.PI * 2;
    const roll = rand();
    if (roll < 0.55) {
      // Grass tufts: three blades crossed at the same spot.
      for (let b = 0; b < 3; b++) {
        buf.grass.push(xform(px, baseY + 0.35, pz, 0.7 + rand() * 0.8, yaw + (b * Math.PI) / 3, (rand() - 0.5) * 0.2));
      }
    } else if (roll < 0.8) {
      // Fern: a rosette of fronds at ankle height.
      const n = 3 + Math.floor(rand() * 3);
      for (let b = 0; b < n; b++) {
        buf.fern.push(xform(px, baseY + 0.2 + rand() * 0.2, pz, 0.6 + rand() * 0.6, yaw + (b / n) * Math.PI * 2, -0.25 - rand() * 0.2));
      }
    } else if (roll < 0.95) {
      buf.bush.push(xform(px, baseY + 0.5, pz, 0.7 + rand() * 0.9, yaw));
    } else {
      // Tall grass / wild sugarcane at the margins.
      const n = 2 + Math.floor(rand() * 3);
      for (let b = 0; b < n; b++) {
        buf.frond.push(xform(px, baseY + 0.9 + rand() * 0.5, pz, 0.5 + rand() * 0.5, yaw + rand() * 2, -0.5 - rand() * 0.4));
      }
    }
  }
}

/**
 * A tree: collidable trunk plus a non-colliding crown. Trees are real meshes
 * rather than thin instances precisely because the trunk has to collide, and
 * there are few enough of them (tens, not thousands) that it costs nothing.
 */
function buildTree(
  root: TransformNode,
  scene: Scene,
  mats: TerminalMats,
  x: number,
  z: number,
  y: number,
  rand: () => number,
  kind: "palm" | "raintree"
): void {
  const h = kind === "palm" ? 7 + rand() * 5 : 6 + rand() * 3;
  const trunk = MeshBuilder.CreateCylinder(`ppTrunk_${x.toFixed(0)}_${z.toFixed(0)}`, {
    diameter: kind === "palm" ? 0.5 : 0.9,
    height: h,
    tessellation: 6,
  }, scene);
  trunk.position.set(x, y + h / 2, z);
  trunk.rotation.z = (rand() - 0.5) * (kind === "palm" ? 0.12 : 0.05);
  trunk.material = mats.bark;
  trunk.checkCollisions = true; // a tree you can walk through reads as broken
  trunk.parent = root;

  if (kind === "palm") {
    // Radiating fronds; non-colliding so the crown never blocks a route.
    for (let i = 0; i < 7; i++) {
      const f = MeshBuilder.CreateBox(`ppPalmFrond_${i}`, { width: 3.4, height: 0.12, depth: 0.6 }, scene);
      const a = (i / 7) * Math.PI * 2;
      f.position.set(x + Math.cos(a) * 1.5, y + h - 0.3, z + Math.sin(a) * 1.5);
      f.rotation.y = a;
      f.rotation.z = -0.35;
      f.material = mats.foliage[3];
      f.checkCollisions = false;
      f.isPickable = false;
      f.parent = root;
    }
  } else {
    // Rain tree: a broad flat canopy in two stacked tiers.
    for (let i = 0; i < 2; i++) {
      const c = MeshBuilder.CreateCylinder(`ppCanopy_${i}`, {
        diameterTop: 8 - i * 3,
        diameterBottom: 6.5 - i * 2,
        height: 1.4,
        tessellation: 7,
      }, scene);
      c.position.set(x, y + h + i * 1.1, z);
      c.material = mats.foliage[i % 2];
      c.checkCollisions = false;
      c.isPickable = false;
      c.parent = root;
    }
  }
}

/**
 * Plants every patch and returns the source meshes (already parented to the
 * map root, so the whole lot toggles with the map).
 */
export function buildTerminalFoliage(
  root: TransformNode,
  scene: Scene,
  mats: TerminalMats,
  patches: FoliagePatch[],
  seed = 5150
): void {
  const rand = mulberry32(seed);
  const buf: Buffers = { grass: [], fern: [], bush: [], frond: [] };

  for (const p of patches) {
    fillPatch(p, rand, buf);
    if (!p.trees) continue;
    const treeCount = Math.max(1, Math.round((p.r * p.r) / 260));
    for (let i = 0; i < treeCount; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * p.r * 0.9;
      buildTree(
        root,
        scene,
        mats,
        p.x + Math.cos(a) * d,
        p.z + Math.sin(a) * d,
        p.y ?? 0,
        rand,
        rand() < 0.45 ? "palm" : "raintree"
      );
    }
  }

  const commit = (mesh: Mesh, matrices: Matrix[]): void => {
    if (matrices.length === 0) {
      mesh.dispose();
      return;
    }
    // Undergrowth never blocks movement, bullets, or the navigation raycast.
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.parent = root;
    mesh.thinInstanceAdd(matrices);
    // Thin instances share one bounding box; without this Babylon culls the
    // whole field the moment the source mesh's own origin leaves the frustum.
    mesh.alwaysSelectAsActiveMesh = true;
  };

  commit(grassSource(scene, mats), buf.grass);
  commit(fernSource(scene, mats), buf.fern);
  commit(bushSource(scene, mats), buf.bush);
  commit(frondSource(scene, mats), buf.frond);
}
