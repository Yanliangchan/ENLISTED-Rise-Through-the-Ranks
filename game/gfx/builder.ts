import * as THREE from "three";

/**
 * Static geometry builder.
 *
 * The whole map is authored in code as thousands of small parts (wall panels,
 * sills, railings, pipes, chairs). Drawing those as individual meshes would
 * cost a draw call each, so parts are appended into one growing vertex buffer
 * per material and emitted as a handful of merged meshes per builder (one
 * builder per building / zone, which is also the culling unit).
 *
 * The same calls feed the collision world: each part says whether it blocks
 * (`solid` = everything, `soft` = the player but not bullets or sight) and what
 * it is made of, which drives footsteps, bullet impacts and decals.
 */

export const enum Surf {
  Concrete = 0,
  Asphalt = 1,
  Metal = 2,
  Wood = 3,
  Dirt = 4,
  Grass = 5,
  Glass = 6,
  Water = 7,
  Tile = 8,
  Sandbag = 9,
  Plaster = 10,
  Foliage = 11,
  Plastic = 12,
  Rubber = 13,
}

export type Collide = "solid" | "soft" | "none";

export interface MatDef {
  material: THREE.Material;
  /** Metres covered by one texture repeat. */
  tile: number;
  surf: Surf;
  collide: Collide;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface PartOpts {
  collide?: Collide;
  /** Vertex tint multiplied into the albedo. */
  tint?: THREE.ColorRepresentation;
  /** UV offset in metres (shift the texture on this part). */
  uvOff?: [number, number];
  /** Override the texture scale for this part. */
  tile?: number;
  /** Faces to omit on a box: any of "+x -x +y -y +z -z". */
  skip?: string;
  /** Rotate the UVs 90° (planks running the other way, etc.). */
  uvRot?: boolean;
}

/** Collected collision triangles for the whole map (world space). */
export class CollisionSoup {
  readonly solid: number[] = [];
  readonly solidSurf: number[] = [];
  readonly soft: number[] = [];
  readonly softSurf: number[] = [];

  tri(kind: Collide, surf: Surf, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    if (kind === "none") return;
    const pos = kind === "solid" ? this.solid : this.soft;
    const sf = kind === "solid" ? this.solidSurf : this.softSurf;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    sf.push(surf);
  }
}

class Bucket {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  count = 0;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _col = new THREE.Color();
const _nm = new THREE.Matrix3();

export class Builder {
  private readonly buckets = new Map<string, Bucket>();
  private readonly stack: THREE.Matrix4[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();

  constructor(
    readonly name: string,
    private readonly mats: Record<string, MatDef>,
    private readonly soup: CollisionSoup | null
  ) {}

  // ---- transform stack ---------------------------------------------------

  /** Run `fn` with the local frame moved to (x, y, z) and yawed about Y. */
  at(x: number, y: number, z: number, yaw: number, fn: () => void): void {
    const t = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    this.push(t);
    fn();
    this.pop();
  }

  push(local: THREE.Matrix4): void {
    this.stack.push(this.m.clone());
    this.m = this.m.clone().multiply(local);
    this.nm.getNormalMatrix(this.m);
  }

  pop(): void {
    this.m = this.stack.pop()!;
    this.nm.getNormalMatrix(this.m);
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      if (!this.mats[key]) throw new Error(`Builder ${this.name}: unknown material "${key}"`);
      b = new Bucket();
      this.buckets.set(key, b);
    }
    return b;
  }

  private vert(b: Bucket, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: THREE.Color | null): void {
    _v.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
    b.pos.push(_v.x, _v.y, _v.z);
    b.nrm.push(_n.x, _n.y, _n.z);
    b.uv.push(u, v);
    if (col) b.col.push(col.r, col.g, col.b);
    else b.col.push(1, 1, 1);
    b.count++;
  }

  private collideTri(def: MatDef, opts: PartOpts | undefined, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const kind = opts?.collide ?? def.collide;
    if (kind === "none" || !this.soup) return;
    _a.set(ax, ay, az).applyMatrix4(this.m);
    _b.set(bx, by, bz).applyMatrix4(this.m);
    _c.set(cx, cy, cz).applyMatrix4(this.m);
    this.soup.tri(kind, def.surf, _a, _b, _c);
  }

  // ---- primitives ---------------------------------------------------------

  /**
   * A quad from four corners (counter-clockwise seen from the front). UVs are
   * laid out in metres along the quad's own edges unless given explicitly.
   */
  quad(key: string, p0: number[], p1: number[], p2: number[], p3: number[], opts?: PartOpts, uvs?: number[][]): void {
    const def = this.mats[key];
    const b = this.bucket(key);
    const tile = opts?.tile ?? def.tile;
    const col = opts?.tint !== undefined ? _col.set(opts.tint) : null;
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const w = Math.hypot(e1[0], e1[1], e1[2]);
    const h = Math.hypot(e2[0], e2[1], e2[2]);
    const ou = opts?.uvOff?.[0] ?? 0;
    const ov = opts?.uvOff?.[1] ?? 0;
    const uv = uvs ?? [
      [ou / tile, ov / tile],
      [(ou + w) / tile, ov / tile],
      [(ou + w) / tile, (ov + h) / tile],
      [ou / tile, (ov + h) / tile],
    ];
    const base = b.count;
    const ps = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) this.vert(b, ps[i][0], ps[i][1], ps[i][2], nx, ny, nz, uv[i][0], uv[i][1], col);
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.collideTri(def, opts, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    this.collideTri(def, opts, p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  }

  /**
   * Axis-aligned box centred at (x, y, z) in the local frame. UVs are
   * box-projected from local position, so adjacent coplanar boxes share a
   * continuous texture (walls built from several panels show no seams).
   */
  box(key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, opts?: PartOpts): void {
    const def = this.mats[key];
    const b = this.bucket(key);
    const tile = opts?.tile ?? def.tile;
    const col = opts?.tint !== undefined ? _col.set(opts.tint) : null;
    const skip = opts?.skip ?? "";
    const ou = opts?.uvOff?.[0] ?? 0;
    const ov = opts?.uvOff?.[1] ?? 0;
    const rot = opts?.uvRot ?? false;
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const face = (id: string, nx: number, ny: number, nz: number, c: number[][]): void => {
      if (skip.includes(id)) return;
      const base = b.count;
      for (const p of c) {
        let u: number;
        let v: number;
        if (nx !== 0) {
          u = -nx * p[2];
          v = p[1];
        } else if (nz !== 0) {
          u = nz * p[0];
          v = p[1];
        } else {
          u = p[0];
          v = -ny * p[2];
        }
        u += ou;
        v += ov;
        if (rot) [u, v] = [v, u];
        this.vert(b, p[0], p[1], p[2], nx, ny, nz, u / tile, v / tile, col);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      this.collideTri(def, opts, c[0][0], c[0][1], c[0][2], c[1][0], c[1][1], c[1][2], c[2][0], c[2][1], c[2][2]);
      this.collideTri(def, opts, c[0][0], c[0][1], c[0][2], c[2][0], c[2][1], c[2][2], c[3][0], c[3][1], c[3][2]);
    };
    const x0 = x - hx, x1 = x + hx, y0 = y - hy, y1 = y + hy, z0 = z - hz, z1 = z + hz;
    face("+x", 1, 0, 0, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
    face("-x", -1, 0, 0, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    face("+y", 0, 1, 0, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
    face("-y", 0, -1, 0, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
    face("+z", 0, 0, 1, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
    face("-z", 0, 0, -1, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  }

  /** Box given by its min corner and size: often more natural for architecture. */
  slab(key: string, x0: number, y0: number, z0: number, sx: number, sy: number, sz: number, opts?: PartOpts): void {
    this.box(key, x0 + sx / 2, y0 + sy / 2, z0 + sz / 2, sx, sy, sz, opts);
  }

  /**
   * Cylinder / frustum along an axis, centred at (x, y, z). `rTop` tapers it.
   * Collision is approximated by its bounding box when solid.
   */
  cyl(key: string, x: number, y: number, z: number, r: number, len: number, seg: number, opts?: PartOpts & { axis?: "x" | "y" | "z"; rTop?: number; caps?: boolean }): void {
    const def = this.mats[key];
    const b = this.bucket(key);
    const tile = opts?.tile ?? def.tile;
    const col = opts?.tint !== undefined ? _col.set(opts.tint) : null;
    const axis = opts?.axis ?? "y";
    const r1 = opts?.rTop ?? r;
    const h = len / 2;
    const map = (lx: number, ly: number, lz: number): [number, number, number] =>
      axis === "y" ? [x + lx, y + ly, z + lz] : axis === "x" ? [x + ly, y + lx, z + lz] : [x + lx, y + lz, z + ly];
    const mapN = (lx: number, ly: number, lz: number): [number, number, number] =>
      axis === "y" ? [lx, ly, lz] : axis === "x" ? [ly, lx, lz] : [lx, lz, ly];
    const base = b.count;
    const slope = (r - r1) / len;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const cx = Math.cos(t);
      const cz = Math.sin(t);
      const n = mapN(cx, slope, cz);
      const p0 = map(cx * r, -h, cz * r);
      const p1 = map(cx * r1, h, cz * r1);
      const u = ((i / seg) * Math.PI * 2 * r) / tile;
      this.vert(b, p0[0], p0[1], p0[2], n[0], n[1], n[2], u, 0, col);
      this.vert(b, p1[0], p1[1], p1[2], n[0], n[1], n[2], u, len / tile, col);
    }
    // Winding depends on the axis mapping (a swap of two axes mirrors it).
    const flip = axis !== "y";
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      if (flip) b.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    if (opts?.caps !== false) {
      for (const top of [false, true]) {
        const rr = top ? r1 : r;
        if (rr <= 0.0001) continue;
        const cb = b.count;
        const n = mapN(0, top ? 1 : -1, 0);
        const c = map(0, top ? h : -h, 0);
        this.vert(b, c[0], c[1], c[2], n[0], n[1], n[2], 0.5, 0.5, col);
        for (let i = 0; i <= seg; i++) {
          const t = (i / seg) * Math.PI * 2;
          const p = map(Math.cos(t) * rr, top ? h : -h, Math.sin(t) * rr);
          this.vert(b, p[0], p[1], p[2], n[0], n[1], n[2], 0.5 + (Math.cos(t) * rr) / tile, 0.5 + (Math.sin(t) * rr) / tile, col);
        }
        for (let i = 0; i < seg; i++) {
          const order = top !== flip;
          if (order) b.idx.push(cb, cb + 2 + i, cb + 1 + i);
          else b.idx.push(cb, cb + 1 + i, cb + 2 + i);
        }
      }
    }
    const kind = opts?.collide ?? def.collide;
    if (kind !== "none" && this.soup) {
      const R = Math.max(r, r1) * 0.86;
      const ext = axis === "y" ? [R, h, R] : axis === "x" ? [h, R, R] : [R, R, h];
      this.collisionBox(def.surf, kind, x, y, z, ext[0] * 2, ext[1] * 2, ext[2] * 2);
    }
  }

  /** Invisible collision-only box (simplified proxies for detailed props). */
  collisionBox(surf: Surf, kind: Collide, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    if (!this.soup || kind === "none") return;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c: number[][] = [];
    for (const dx of [-hx, hx]) for (const dy of [-hy, hy]) for (const dz of [-hz, hz]) c.push([x + dx, y + dy, z + dz]);
    const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const q of quads) {
      const P = q.map((i) => new THREE.Vector3(c[i][0], c[i][1], c[i][2]).applyMatrix4(this.m));
      this.soup.tri(kind, surf, P[0], P[1], P[2]);
      this.soup.tri(kind, surf, P[0], P[2], P[3]);
    }
  }

  /** Invisible collision ramp (a single sloped quad) for stairs and kerb transitions. */
  collisionQuad(surf: Surf, kind: Collide, p0: number[], p1: number[], p2: number[], p3: number[]): void {
    if (!this.soup || kind === "none") return;
    const P = [p0, p1, p2, p3].map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.m));
    this.soup.tri(kind, surf, P[0], P[1], P[2]);
    this.soup.tri(kind, surf, P[0], P[2], P[3]);
  }

  /**
   * Merge an arbitrary geometry (extrusions, lathes, spheres). Its UVs are
   * used as-is, scaled by `uvScale`. Collision uses the real triangles when
   * requested, so keep collidable geometry simple.
   */
  geo(key: string, g: THREE.BufferGeometry, local?: THREE.Matrix4, opts?: PartOpts & { uvScale?: number }): void {
    const def = this.mats[key];
    const b = this.bucket(key);
    const col = opts?.tint !== undefined ? _col.set(opts.tint) : null;
    if (local) this.push(local);
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const gcol = g.getAttribute("color");
    const s = opts?.uvScale ?? 1;
    const base = b.count;
    const c2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      let cc = col;
      if (gcol) {
        c2.setRGB(gcol.getX(i), gcol.getY(i), gcol.getZ(i));
        if (col) c2.multiply(col);
        cc = c2;
      }
      this.vert(b, pos.getX(i), pos.getY(i), pos.getZ(i), nrm ? nrm.getX(i) : 0, nrm ? nrm.getY(i) : 1, nrm ? nrm.getZ(i) : 0, uv ? uv.getX(i) * s : 0, uv ? uv.getY(i) * s : 0, cc);
    }
    const index = g.getIndex();
    const n = index ? index.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;
      b.idx.push(base + i0, base + i1, base + i2);
      this.collideTri(def, opts, pos.getX(i0), pos.getY(i0), pos.getZ(i0), pos.getX(i1), pos.getY(i1), pos.getZ(i1), pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    }
    if (local) this.pop();
  }

  /**
   * Extrude a 2D outline (in the local XY plane, counter-clockwise) along Z
   * from z0 to z1. Roof gables, kerbs, drains, awnings, beams.
   */
  prism(key: string, outline: number[][], z0: number, z1: number, opts?: PartOpts & { caps?: boolean }): void {
    const n = outline.length;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = outline[i];
      const c = outline[(i + 1) % n];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      this.quad(key, [a[0], a[1], z1], [a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], { ...opts, uvOff: [0, acc] }, undefined);
      acc += len;
    }
    if (opts?.caps !== false) {
      const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], p[1])));
      const tris = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
      const def = this.mats[key];
      const b = this.bucket(key);
      const tile = opts?.tile ?? def.tile;
      const col = opts?.tint !== undefined ? _col.set(opts.tint) : null;
      for (const [z, nz] of [[z1, 1], [z0, -1]] as const) {
        const base = b.count;
        for (const p of outline) this.vert(b, p[0], p[1], z, 0, 0, nz, p[0] / tile, p[1] / tile, col);
        for (const t of tris) {
          if (nz > 0) b.idx.push(base + t[0], base + t[1], base + t[2]);
          else b.idx.push(base + t[0], base + t[2], base + t[1]);
          const A = outline[t[0]], B = outline[t[1]], C = outline[t[2]];
          this.collideTri(def, opts, A[0], A[1], z, B[0], B[1], z, C[0], C[1], z);
        }
      }
    }
  }

  // ---- output -------------------------------------------------------------

  /** Emit one merged mesh per material used. */
  build(): THREE.Group {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [key, b] of this.buckets) {
      if (b.count === 0) continue;
      const def = this.mats[key];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, def.material);
      mesh.name = `${this.name}:${key}`;
      mesh.castShadow = def.castShadow ?? true;
      mesh.receiveShadow = def.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

void _nm;
