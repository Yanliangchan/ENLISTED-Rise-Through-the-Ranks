import { Matrix, Mesh, MeshBuilder, Quaternion, Scene, Vector3, VertexData, type Material } from "@babylonjs/core";

/**
 * Procedural modelling toolkit for the overhaul's hero assets. The old
 * builders stacked raw boxes; these helpers model from real silhouettes
 * instead — a side profile traced from reference proportions, extruded with
 * a bevel so edges catch light like moulded polymer or machined steel, lathed
 * round parts, and limbs strung between joint positions. Everything bakes to
 * plain vertex data so callers can merge per material.
 *
 * Profiles are 2D points in the (z, y) plane — z forward, y up, metres — and
 * get extruded symmetrically across x. That matches how a weapon or a piece
 * of kit is drawn from the side.
 */

export type P2 = [number, number];

interface Builder {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

function newBuilder(): Builder {
  return { pos: [], nrm: [], uv: [], idx: [] };
}

function vert(b: Builder, p: Vector3, n: Vector3, u: number, v: number): number {
  b.pos.push(p.x, p.y, p.z);
  b.nrm.push(n.x, n.y, n.z);
  b.uv.push(u, v);
  return b.pos.length / 3 - 1;
}

/**
 * Emit a triangle wound so Babylon's own face normal — (v0 - v1) × (v2 - v1),
 * the formula VertexData.ComputeNormals uses — points along `facing`. Picking
 * winding from an explicit outward direction keeps culling right without
 * having to reason about handedness per call site.
 */
function tri(b: Builder, i0: number, i1: number, i2: number, facing: Vector3): void {
  const p = (i: number) => new Vector3(b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]);
  const a = p(i0), m = p(i1), c = p(i2);
  const n = Vector3.Cross(a.subtract(m), c.subtract(m));
  if (Vector3.Dot(n, facing) < 0) b.idx.push(i0, i2, i1);
  else b.idx.push(i0, i1, i2);
}

function finish(b: Builder, name: string, scene: Scene): Mesh {
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = b.pos;
  vd.indices = b.idx;
  vd.normals = b.nrm;
  vd.uvs = b.uv;
  vd.applyToMesh(mesh);
  return mesh;
}

function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Counter-clockwise (positive area) copy of a polygon, with duplicate/closing points dropped. */
function normalisePoly(pts: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return signedArea(out) < 0 ? out.reverse() : out;
}

/** Ear-clipping triangulation of a simple CCW polygon. Profiles here are tens of points, so O(n²) is fine. */
function triangulate(pts: P2[]): number[] {
  const idx = pts.map((_, i) => i);
  const out: number[] = [];
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(pts[j], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // self-intersecting input; emit what we have rather than hang
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/** Outward unit normal of edge a→b on a CCW polygon. */
function edgeNormal(a: P2, b: P2): P2 {
  const dz = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dz, dy) || 1;
  return [dy / l, -dz / l];
}

/** Shrink a CCW polygon by `d` along vertex bisectors (miter-limited). */
function insetPoly(pts: P2[], d: number): P2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const n0 = edgeNormal(pts[(i + n - 1) % n], p);
    const n1 = edgeNormal(p, pts[(i + 1) % n]);
    let bz = n0[0] + n1[0], by = n0[1] + n1[1];
    const bl = Math.hypot(bz, by) || 1;
    bz /= bl; by /= bl;
    const cos = Math.max(0.35, bz * n1[0] + by * n1[1]);
    const k = Math.min(d / cos, d * 3);
    return [p[0] - bz * k, p[1] - by * k] as P2;
  });
}

export interface ExtrudeOptions {
  /** Edge chamfer size in metres (0 = hard edges). */
  bevel?: number;
  /** Adjacent side faces closer than this angle share smoothed normals. */
  smoothDeg?: number;
  /** Centre of the extrusion along x. */
  x?: number;
  /** UV metres→texture scale. */
  uvScale?: number;
}

/**
 * Extrude a side profile across x into a closed, bevelled prism. This is the
 * workhorse for weapon receivers, grips, stocks, plates and pouches: trace the
 * silhouette from the reference's proportions and give it a thickness.
 */
export function extrudeProfile(name: string, scene: Scene, profile: P2[], width: number, opts: ExtrudeOptions = {}): Mesh {
  const pts = normalisePoly(profile);
  const bevel = Math.min(opts.bevel ?? 0.0015, width * 0.3);
  const smoothCos = Math.cos(((opts.smoothDeg ?? 32) * Math.PI) / 180);
  const x0 = opts.x ?? 0;
  const uvS = opts.uvScale ?? 1;
  const half = width / 2;
  const sideHalf = half - bevel;
  const n = pts.length;
  const b = newBuilder();

  const edgeN = pts.map((p, i) => edgeNormal(p, pts[(i + 1) % n]));
  // Cumulative perimeter for side UVs.
  const perim: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    perim.push(perim[i] + Math.hypot(c[0] - a[0], c[1] - a[1]));
  }

  // Side walls, with angle-thresholded smoothing between neighbouring edges.
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const ne = edgeN[i];
    const nPrev = edgeN[(i + n - 1) % n], nNext = edgeN[(i + 1) % n];
    const blend = (o: P2): Vector3 => {
      const dot = o[0] * ne[0] + o[1] * ne[1];
      if (dot < smoothCos) return new Vector3(0, ne[1], ne[0]);
      return new Vector3(0, ne[1] + o[1], ne[0] + o[0]).normalize();
    };
    const na = blend(nPrev), nc = blend(nNext);
    const facing = new Vector3(0, ne[1], ne[0]);
    const v0 = vert(b, new Vector3(x0 - sideHalf, a[1], a[0]), na, perim[i] * uvS, -sideHalf * uvS);
    const v1 = vert(b, new Vector3(x0 + sideHalf, a[1], a[0]), na, perim[i] * uvS, sideHalf * uvS);
    const v2 = vert(b, new Vector3(x0 + sideHalf, c[1], c[0]), nc, perim[i + 1] * uvS, sideHalf * uvS);
    const v3 = vert(b, new Vector3(x0 - sideHalf, c[1], c[0]), nc, perim[i + 1] * uvS, -sideHalf * uvS);
    tri(b, v0, v1, v2, facing);
    tri(b, v0, v2, v3, facing);
  }

  const inner = bevel > 0 ? insetPoly(pts, bevel) : pts;
  const capTris = triangulate(inner);
  for (const side of [-1, 1]) {
    const capN = new Vector3(side, 0, 0);
    // Cap face.
    const base = b.pos.length / 3;
    for (const p of inner) vert(b, new Vector3(x0 + side * half, p[1], p[0]), capN, p[0] * uvS, p[1] * uvS);
    for (let t = 0; t < capTris.length; t += 3) tri(b, base + capTris[t], base + capTris[t + 1], base + capTris[t + 2], capN);
    // Bevel ring between the side wall edge and the inset cap.
    if (bevel > 0) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ne = edgeN[i];
        const bn = new Vector3(side * 0.7, ne[1] * 0.7, ne[0] * 0.7).normalize();
        const a0 = vert(b, new Vector3(x0 + side * sideHalf, pts[i][1], pts[i][0]), bn, pts[i][0] * uvS, pts[i][1] * uvS);
        const a1 = vert(b, new Vector3(x0 + side * sideHalf, pts[j][1], pts[j][0]), bn, pts[j][0] * uvS, pts[j][1] * uvS);
        const c1 = vert(b, new Vector3(x0 + side * half, inner[j][1], inner[j][0]), bn, inner[j][0] * uvS, inner[j][1] * uvS);
        const c0 = vert(b, new Vector3(x0 + side * half, inner[i][1], inner[i][0]), bn, inner[i][0] * uvS, inner[i][1] * uvS);
        tri(b, a0, a1, c1, bn);
        tri(b, a0, c1, c0, bn);
      }
    }
  }
  return finish(b, name, scene);
}

/**
 * Round every corner of a polygon with a circular-ish fillet. `radius` can be
 * one value or one per vertex (0 keeps that corner sharp).
 */
export function fillet(pts: P2[], radius: number | number[], segs = 3): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const r = Array.isArray(radius) ? radius[i] ?? 0 : radius;
    const p = pts[i];
    if (r <= 0) { out.push(p); continue; }
    const prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    const lp = Math.hypot(prev[0] - p[0], prev[1] - p[1]);
    const ln = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const rr = Math.min(r, lp * 0.45, ln * 0.45);
    const a: P2 = [p[0] + ((prev[0] - p[0]) / lp) * rr, p[1] + ((prev[1] - p[1]) / lp) * rr];
    const c: P2 = [p[0] + ((next[0] - p[0]) / ln) * rr, p[1] + ((next[1] - p[1]) / ln) * rr];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      // Quadratic Bézier through the corner — visually a fillet at these sizes.
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * p[0] + t * t * c[0], u * u * a[1] + 2 * u * t * p[1] + t * t * c[1]]);
    }
  }
  return out;
}

/** Turn a polyline into a closed outline `thickness` wide — for trigger guards, slings, straps, tubes in profile. */
export function stroke(path: P2[], thickness: number): P2[] {
  const h = thickness / 2;
  const left: P2[] = [], right: P2[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)];
    const dz = c[0] - a[0], dy = c[1] - a[1];
    const l = Math.hypot(dz, dy) || 1;
    const nz = -dy / l, ny = dz / l;
    left.push([path[i][0] + nz * h, path[i][1] + ny * h]);
    right.push([path[i][0] - nz * h, path[i][1] - ny * h]);
  }
  return [...left, ...right.reverse()];
}

/** Rectangle profile (z,y) centred on (cz, cy). */
export function rect(cz: number, cy: number, len: number, height: number): P2[] {
  return [
    [cz - len / 2, cy - height / 2],
    [cz + len / 2, cy - height / 2],
    [cz + len / 2, cy + height / 2],
    [cz - len / 2, cy + height / 2],
  ];
}

/** A bevelled box — the minimum standard for any boxy part (no raw MeshBuilder boxes on hero assets). */
export function chamferBox(
  name: string,
  scene: Scene,
  size: { w: number; h: number; d: number },
  at: Vector3 = Vector3.Zero(),
  bevel = 0.002,
  cornerRadius = 0
): Mesh {
  let prof = rect(at.z, at.y, size.d, size.h);
  if (cornerRadius > 0) prof = fillet(prof, cornerRadius, 2);
  return extrudeProfile(name, scene, prof, size.w, { bevel, x: at.x });
}

/**
 * Lathe a radius profile around the z axis. `profile` is [radius, z] pairs
 * from back to front; good for barrels, flash hiders, scope tubes, lenses.
 */
export function latheZ(name: string, scene: Scene, profile: P2[], tess = 18, at: Vector3 = Vector3.Zero()): Mesh {
  const shape = profile.map(([r, z]) => new Vector3(Math.max(r, 0.0001), z, 0));
  const m = MeshBuilder.CreateLathe(name, { shape, tessellation: tess, closed: true, cap: Mesh.CAP_ALL }, scene);
  m.rotation.x = Math.PI / 2; // lathe axis y → z
  m.position.copyFrom(at);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

/**
 * A tapered cylinder strung between two points — limbs, fingers, straps, rods.
 * With `metresPerTile`, UVs wrap around the circumference and run along the
 * length at true scale, so fabric prints keep their size on sleeves and legs.
 */
export function limb(name: string, scene: Scene, a: Vector3, b: Vector3, rA: number, rB: number, tess = 10, metresPerTile = 0): Mesh {
  const dir = b.subtract(a);
  const len = dir.length();
  const m = MeshBuilder.CreateCylinder(name, { height: len, diameterBottom: rA * 2, diameterTop: rB * 2, tessellation: tess, cap: Mesh.CAP_ALL }, scene);
  if (metresPerTile > 0) {
    const uv = m.getVerticesData("uv")!;
    const circ = Math.PI * (rA + rB);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] *= circ / metresPerTile;
      uv[i + 1] *= len / metresPerTile;
    }
    m.setVerticesData("uv", uv);
  }
  const up = new Vector3(0, 1, 0);
  const d = dir.normalizeToNew();
  const axis = Vector3.Cross(up, d);
  const angle = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(up, d))));
  m.rotationQuaternion = axis.lengthSquared() < 1e-10
    ? (d.y < 0 ? Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI) : Quaternion.Identity())
    : Quaternion.RotationAxis(axis.normalize(), angle);
  m.position = a.add(b).scale(0.5);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

/** Ellipsoid blob (knuckles, joints, helmet shells, boots). */
export function blob(name: string, scene: Scene, at: Vector3, radii: Vector3, segs = 10, rot?: Vector3): Mesh {
  const m = MeshBuilder.CreateSphere(name, { segments: segs, diameter: 2 }, scene);
  m.scaling.copyFrom(radii);
  if (rot) m.rotation.copyFrom(rot);
  m.position.copyFrom(at);
  m.bakeCurrentTransformIntoVertices();
  return m;
}

/** Bake a local frame (origin + axes) into a mesh's vertices: model a part at the origin, then place it on a joint. */
export function bakeBasis(mesh: Mesh, origin: Vector3, x: Vector3, y: Vector3, z: Vector3): Mesh {
  const m = Matrix.Identity();
  Matrix.FromXYZAxesToRef(x.normalizeToNew(), y.normalizeToNew(), z.normalizeToNew(), m);
  m.setTranslation(origin);
  mesh.bakeTransformIntoVertices(m);
  return mesh;
}

/**
 * Re-project UVs from world-ish position by dominant normal axis (box
 * projection). Gives camo and grime a consistent texel density across
 * arbitrary procedural parts, with no stretching on limbs or plates.
 */
export function boxProjectUVs(mesh: Mesh, metresPerTile: number): void {
  const pos = mesh.getVerticesData("position");
  const nrm = mesh.getVerticesData("normal");
  if (!pos || !nrm) return;
  const uv = new Float32Array((pos.length / 3) * 2);
  const s = 1 / metresPerTile;
  for (let i = 0; i < pos.length / 3; i++) {
    const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
    uv[i * 2] = u * s;
    uv[i * 2 + 1] = v * s;
  }
  mesh.setVerticesData("uv", uv, true);
}

/**
 * Merge parts into one mesh with one material, disposing the sources. Hero
 * assets end up as a handful of meshes — one per material — instead of one
 * draw call per primitive.
 */
export function mergeParts(name: string, parts: Mesh[], material: Material | null): Mesh {
  const live = parts.filter((p) => p && !p.isDisposed());
  const merged = live.length === 1 ? live[0] : Mesh.MergeMeshes(live, true, true, undefined, false, false)!;
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  return merged;
}
