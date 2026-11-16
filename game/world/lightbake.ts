import * as THREE from "three";
import { shared } from "~/core/engine";
import type { CollisionWorld } from "./collision";
import type { Lamp } from "./ctx";
import type { Rect } from "./ground";

/**
 * Bake the light volume every lit material samples: per voxel, how much open
 * sky it can see (so void decks, carpark decks and shop interiors fall into
 * real shade instead of being flooded by sky light) and how much artificial
 * light reaches it from the map's lamps. Runs once at load against the
 * collision BVH.
 */
export function bakeLight(world: CollisionWorld, lamps: Lamp[], bounds: Rect): void {
  const cell = 2.5;
  const cy = 1.5;
  const y0 = -0.2;
  const nx = Math.ceil((bounds[2] - bounds[0]) / cell);
  const nz = Math.ceil((bounds[3] - bounds[1]) / cell);
  const ny = 8;
  const data = new Uint8Array(nx * ny * nz * 4);
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  // One zenith ray and four at ~50° give a decent estimate of the visible sky dome.
  // Plus four low rays: light that comes in sideways through open walls and shopfronts.
  const dirs = [[0, 1, 0], [0.74, 0.67, 0.05], [-0.74, 0.67, -0.05], [0.05, 0.67, 0.74], [-0.05, 0.67, -0.74], [0.68, 0.26, 0.68], [-0.68, 0.26, 0.68], [0.68, 0.26, -0.68], [-0.68, 0.26, -0.68]];
  const weight = [0.2, 0.12, 0.12, 0.12, 0.12, 0.08, 0.08, 0.08, 0.08];
  const NR = dirs.length;
  const idx = (i: number, j: number, k: number): number => ((k * ny + j) * nx + i) * 4;
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds[0] + (i + 0.5) * cell;
      const z = bounds[1] + (k + 0.5) * cell;
      // Nothing overhead at all: the whole column is open (the common case out of doors).
      o.set(x, 60, z);
      const top = world.raycast(o, d.set(0, -1, 0), 61);
      const roof = top ? top.point.y : 0;
      for (let j = 0; j < ny; j++) {
        const y = y0 + (j + 0.5) * cy;
        let v = 0;
        if (y > roof + 0.2) {
          // Above everything here; only neighbours can shade it.
          v = weight[0];
          o.set(x, y, z);
          for (let r = 1; r < NR; r++) if (!world.raycast(o, d.set(dirs[r][0], dirs[r][1], dirs[r][2]), 45)) v += weight[r];
        } else {
          o.set(x, y, z);
          for (let r = 0; r < NR; r++) if (!world.raycast(o, d.set(dirs[r][0], dirs[r][1], dirs[r][2]), 45)) v += weight[r];
        }
        data[idx(i, j, k)] = Math.round((0.26 + 0.74 * v) * 255);
        data[idx(i, j, k) + 3] = 255;
      }
    }
  }
  // Soften: a 3-tap blur along each horizontal axis hides the voxel grid on walls.
  const tmp = new Uint8Array(nx * ny * nz);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = data[idx(Math.max(0, i - 1), j, pass ? Math.max(0, k - 1) : k)];
      const c = data[idx(Math.min(nx - 1, i + 1), j, pass ? Math.min(nz - 1, k + 1) : k)];
      const a2 = pass ? data[idx(i, j, Math.max(0, k - 1))] : a;
      const c2 = pass ? data[idx(i, j, Math.min(nz - 1, k + 1))] : c;
      tmp[(k * ny + j) * nx + i] = (data[idx(i, j, k)] * 2 + (pass ? a2 + c2 : a + c)) / 4;
    }
    for (let n = 0; n < tmp.length; n++) data[n * 4] = tmp[n];
  }
  // Lamps.
  const acc = new Float32Array(nx * ny * nz);
  for (const l of lamps) {
    const r = l.radius;
    const i0 = Math.max(0, Math.floor((l.pos.x - r - bounds[0]) / cell)), i1 = Math.min(nx - 1, Math.floor((l.pos.x + r - bounds[0]) / cell));
    const k0 = Math.max(0, Math.floor((l.pos.z - r - bounds[1]) / cell)), k1 = Math.min(nz - 1, Math.floor((l.pos.z + r - bounds[1]) / cell));
    const j0 = Math.max(0, Math.floor((l.pos.y - r - y0) / cy)), j1 = Math.min(ny - 1, Math.floor((l.pos.y + 1 - y0) / cy));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      o.set(bounds[0] + (i + 0.5) * cell, y0 + (j + 0.5) * cy, bounds[1] + (k + 0.5) * cell);
      const dist = o.distanceTo(l.pos);
      if (dist > r) continue;
      if (dist > 1.6 && !world.clear(l.pos, o)) continue;
      const f = 1 - dist / r;
      acc[(k * ny + j) * nx + i] += (l.power * f * f) / (1 + dist * dist * 0.05);
    }
  }
  for (let n = 0; n < acc.length; n++) data[n * 4 + 1] = Math.min(255, acc[n] * 400);

  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  shared.uVisTex.value?.dispose();
  shared.uVisTex.value = tex;
  shared.uVisMin.value.set(bounds[0], y0, bounds[1]);
  shared.uVisInv.value.set(1 / (nx * cell), 1 / (ny * cy), 1 / (nz * cell));
}
