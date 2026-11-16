import * as THREE from "three";
import type { CollisionWorld } from "~/world/collision";

/**
 * Navigation grid, generated from the collision world at load: each cell is
 * walkable if there is ground-level floor under it and a standing soldier's
 * body fits there. A* over the grid gives paths; the same grid answers "is
 * there low or full cover between here and that threat", which is how the AI
 * picks places to fight from.
 */
export class NavGrid {
  readonly cell = 0.7;
  readonly w: number;
  readonly h: number;
  /** Floor height per cell, NaN where not walkable. */
  readonly height: Float32Array;
  private readonly x0: number;
  private readonly z0: number;
  // A* scratch.
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly from: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private readonly heap: number[] = [];

  constructor(private readonly world: CollisionWorld, bounds: [number, number, number, number]) {
    this.x0 = bounds[0];
    this.z0 = bounds[1];
    this.w = Math.ceil((bounds[2] - bounds[0]) / this.cell);
    this.h = Math.ceil((bounds[3] - bounds[1]) / this.cell);
    const n = this.w * this.h;
    this.height = new Float32Array(n).fill(NaN);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    const p = new THREE.Vector3();
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) * this.cell;
        const z = this.z0 + (j + 0.5) * this.cell;
        const fl = world.floor(x, z, 2.3, 3.2);
        if (!fl || fl.y > 0.75 || fl.y < -0.4) continue;
        if (world.sphereBlocked(p.set(x, fl.y + 0.78, z), 0.36) || world.sphereBlocked(p.set(x, fl.y + 1.45, z), 0.3)) continue;
        this.height[j * this.w + i] = fl.y;
      }
    }
  }

  /** Make a rectangle off-limits (the patrol base): no paths, cover or spawns inside it. */
  block(x0: number, z0: number, x1: number, z1: number): void {
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.x0 + (i + 0.5) * this.cell, z = this.z0 + (j + 0.5) * this.cell;
      if (x > x0 && x < x1 && z > z0 && z < z1) this.height[j * this.w + i] = NaN;
    }
  }

  index(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  cellPos(idx: number, out: THREE.Vector3): THREE.Vector3 {
    const i = idx % this.w;
    const j = Math.floor(idx / this.w);
    return out.set(this.x0 + (i + 0.5) * this.cell, this.height[idx], this.z0 + (j + 0.5) * this.cell);
  }

  walkable(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i >= 0 && !Number.isNaN(this.height[i]);
  }

  /** Floor height at a point, or null if off the mesh. */
  floorAt(x: number, z: number): number | null {
    const i = this.index(x, z);
    if (i < 0 || Number.isNaN(this.height[i])) return null;
    return this.height[i];
  }

  /** Nearest walkable cell centre to a point (spiral search). */
  nearest(x: number, z: number, maxCells = 14): THREE.Vector3 | null {
    const ci = Math.floor((x - this.x0) / this.cell);
    const cj = Math.floor((z - this.z0) / this.cell);
    for (let r = 0; r <= maxCells; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const idx = j * this.w + i;
        if (Number.isNaN(this.height[idx])) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = idx;
        }
      }
      if (best >= 0) return this.cellPos(best, new THREE.Vector3());
    }
    return null;
  }

  /** True if a straight walk between two points stays on walkable cells. */
  lineWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  private push(idx: number): void {
    const h = this.heap;
    h.push(idx);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[h[p]] <= this.f[h[i]]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }

  private pop(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.f[h[l]] < this.f[h[m]]) m = l;
        if (r < h.length && this.f[h[r]] < this.f[h[m]]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }

  /** A* path as smoothed waypoints, or null if unreachable. */
  path(from: THREE.Vector3, to: THREE.Vector3, maxExpand = 14000): THREE.Vector3[] | null {
    const s = this.nearest(from.x, from.z, 6);
    const e = this.nearest(to.x, to.z, 10);
    if (!s || !e) return null;
    const start = this.index(s.x, s.z);
    const goal = this.index(e.x, e.z);
    if (start === goal) return [e];
    const gen = ++this.gen;
    const w = this.w;
    const gi = goal % w;
    const gj = Math.floor(goal / w);
    const heur = (idx: number): number => {
      const dx = Math.abs((idx % w) - gi);
      const dz = Math.abs(Math.floor(idx / w) - gj);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    this.heap.length = 0;
    this.g[start] = 0;
    this.f[start] = heur(start);
    this.stamp[start] = gen;
    this.from[start] = -1;
    this.push(start);
    let expanded = 0;
    let found = false;
    while (this.heap.length) {
      const cur = this.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (++expanded > maxExpand) break;
      const ci = cur % w;
      const cj = Math.floor(cur / w);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const nb = nj * w + ni;
        if (Number.isNaN(this.height[nb]) || this.closed[nb] === gen) continue;
        // No corner cutting.
        if (di !== 0 && dj !== 0 && (Number.isNaN(this.height[cj * w + ni]) || Number.isNaN(this.height[nj * w + ci]))) continue;
        if (Math.abs(this.height[nb] - this.height[cur]) > 0.45) continue;
        const ng = this.g[cur] + (di !== 0 && dj !== 0 ? 1.414 : 1);
        if (this.stamp[nb] === gen && ng >= this.g[nb]) continue;
        this.stamp[nb] = gen;
        this.g[nb] = ng;
        this.f[nb] = ng + heur(nb);
        this.from[nb] = cur;
        this.push(nb);
      }
    }
    if (!found) return null;
    const raw: THREE.Vector3[] = [];
    for (let c = goal; c !== -1; c = this.from[c]) raw.push(this.cellPos(c, new THREE.Vector3()));
    raw.reverse();
    // String-pull: drop waypoints that a straight walk can skip.
    const out: THREE.Vector3[] = [];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let far = anchor + 1;
      for (let k = Math.min(raw.length - 1, anchor + 40); k > anchor + 1; k--) {
        if (this.lineWalkable(raw[anchor].x, raw[anchor].z, raw[k].x, raw[k].z)) {
          far = k;
          break;
        }
      }
      out.push(raw[far]);
      anchor = far;
    }
    return out;
  }

  /**
   * Find a spot near `near` that is shielded from `threat`: ideally a place
   * where a crouching soldier is hidden but a standing one can shoot.
   */
  findCover(near: THREE.Vector3, threat: THREE.Vector3, radius: number, taken: (p: THREE.Vector3) => boolean, prefDist = 26): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    const p = new THREE.Vector3();
    const a = new THREE.Vector3();
    const t = new THREE.Vector3(threat.x, threat.y + 1.35, threat.z);
    for (let k = 0; k < 46; k++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * radius;
      const x = near.x + Math.cos(ang) * r;
      const z = near.z + Math.sin(ang) * r;
      const idx = this.index(x, z);
      if (idx < 0 || Number.isNaN(this.height[idx])) continue;
      this.cellPos(idx, p);
      if (taken(p)) continue;
      const lowHidden = !this.world.clear(a.set(p.x, p.y + 0.85, p.z), t);
      if (!lowHidden) continue;
      const canShoot = this.world.clear(a.set(p.x, p.y + 1.5, p.z), t);
      const dThreat = Math.hypot(p.x - threat.x, p.z - threat.z);
      const score = (canShoot ? 6 : 0) - r * 0.18 - Math.abs(dThreat - prefDist) * 0.08 + Math.random();
      if (score > bestScore) {
        bestScore = score;
        best = p.clone();
      }
    }
    return best;
  }
}
