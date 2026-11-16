import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { Surf, type CollisionSoup } from "~/gfx/builder";

export interface Hit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surf: Surf;
}

const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _sphere = new THREE.Sphere();

function makeBvh(positions: number[]): { bvh: MeshBVH; geo: THREE.BufferGeometry } | null {
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const bvh = new MeshBVH(geo, { maxLeafTris: 8 });
  return { bvh, geo };
}

/**
 * The static collision world: two triangle BVHs built from everything the map
 * builders marked as blocking. `solid` stops players, bullets and sight;
 * `soft` (railings, fences, glass) stops movement only. A ray against ~250k
 * triangles costs a few microseconds here, which is what lets every bullet,
 * every AI sight check and every footstep use real geometry.
 */
export class CollisionWorld {
  private readonly solid: MeshBVH;
  private readonly solidGeo: THREE.BufferGeometry;
  private readonly soft: MeshBVH | null;
  private readonly solidSurf: Uint8Array;
  readonly triangles: number;

  constructor(soup: CollisionSoup) {
    const s = makeBvh(soup.solid)!;
    this.solid = s.bvh;
    this.solidGeo = s.geo;
    this.soft = makeBvh(soup.soft)?.bvh ?? null;
    this.solidSurf = Uint8Array.from(soup.solidSurf);
    this.triangles = (soup.solid.length + soup.soft.length) / 9;
  }

  /** First solid hit along a ray, or null. `dir` must be normalised. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Hit | null {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    const h = this.solid.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
    if (!h) return null;
    // The BVH reorders its index; map the hit back to the original triangle.
    const index = this.solidGeo.index!;
    const tri = Math.floor(index.getX(h.faceIndex! * 3) / 3);
    const n = h.face!.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    return { point: h.point.clone(), normal: n, distance: h.distance, surf: this.solidSurf[tri] as Surf };
  }

  /** True if nothing solid lies between two points. */
  clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    _ray.origin.copy(a);
    _ray.direction.subVectors(b, a);
    const d = _ray.direction.length();
    if (d < 1e-4) return true;
    _ray.direction.multiplyScalar(1 / d);
    return !this.solid.raycastFirst(_ray, THREE.DoubleSide, 0, d - 0.05);
  }

  /** Height of the highest solid surface at or below `fromY` at (x, z), or null. */
  floor(x: number, z: number, fromY: number, maxDrop = 50): { y: number; surf: Surf } | null {
    _ray.origin.set(x, fromY, z);
    _ray.direction.set(0, -1, 0);
    const h = this.solid.raycastFirst(_ray, THREE.DoubleSide, 0, maxDrop);
    if (!h) return null;
    const index = this.solidGeo.index!;
    return { y: h.point.y, surf: this.solidSurf[Math.floor(index.getX(h.faceIndex! * 3) / 3)] as Surf };
  }

  /** True if a sphere overlaps any blocking geometry (solid or soft). */
  sphereBlocked(center: THREE.Vector3, radius: number): boolean {
    _sphere.center.copy(center);
    _sphere.radius = radius;
    if (this.solid.intersectsSphere(_sphere)) return true;
    return this.soft ? this.soft.intersectsSphere(_sphere) : false;
  }

  /**
   * Push a capsule (segment a→b, radius r) out of the world. Mutates a and b
   * and returns nothing; callers diff the position before/after.
   */
  resolveCapsule(a: THREE.Vector3, b: THREE.Vector3, r: number): void {
    for (const bvh of [this.solid, this.soft]) {
      if (!bvh) continue;
      _seg.start.copy(a);
      _seg.end.copy(b);
      _box.makeEmpty();
      _box.expandByPoint(a);
      _box.expandByPoint(b);
      _box.min.addScalar(-r);
      _box.max.addScalar(r);
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
          if (dist < r) {
            const depth = r - dist;
            const dir = _capPoint.sub(_triPoint).normalize();
            _seg.start.addScaledVector(dir, depth);
            _seg.end.addScaledVector(dir, depth);
          }
          return false;
        },
      });
      a.copy(_seg.start);
      b.copy(_seg.end);
    }
  }
}
