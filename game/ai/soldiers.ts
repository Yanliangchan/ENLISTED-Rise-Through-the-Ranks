import * as THREE from "three";
import type { Engine } from "~/core/engine";
import type { Audio } from "~/core/audio";
import type { Vfx } from "~/gfx/vfx";
import type { CollisionWorld } from "~/world/collision";
import type { BodyPart, TargetHit, TargetProvider } from "~/player/weapon";
import type { NavGrid } from "./nav";
import { SoldierModel, opforCamo, soldierMaterials, type Pose, type SoldierMats } from "./soldierModel";

/** What the AI needs to know about the player. */
export interface AiTarget {
  /** Feet. */
  pos: THREE.Vector3;
  /** Eye height above the feet. */
  eye: number;
  speed: number;
  alive: boolean;
  damage(amount: number, from: THREE.Vector3): void;
  whiz(at: THREE.Vector3): void;
}

export type AiState = "idle" | "combat" | "search";

export interface SpawnOpts {
  yaw?: number;
  /** Stay within this distance of the spawn point (objective defenders). */
  leash?: number;
  patrol?: Array<[number, number]>;
  /** Start already hunting the player (reinforcements). */
  alerted?: boolean;
  tag?: string;
  accuracy?: number;
}

const rr = (a: number, b: number): number => a + Math.random() * (b - a);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const gauss = (): number => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Distance along the ray to a capsule (segment a-b, radius r), or -1. */
function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, maxT: number): number {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const uu = ux * ux + uy * uy + uz * uz;
  const ud = ux * d.x + uy * d.y + uz * d.z;
  const uw = ux * wx + uy * wy + uz * wz;
  const dw = d.x * wx + d.y * wy + d.z * wz;
  const den = uu - ud * ud;
  let s = den > 1e-6 ? (uw - ud * dw) / den : 0;
  s = Math.max(0, Math.min(1, uu > 1e-9 ? s : 0));
  let t = s * ud - dw;
  if (t < 0 || t > maxT + r) return -1;
  // Refine: closest point on the segment to the ray point.
  const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
  if (uu > 1e-9) s = Math.max(0, Math.min(1, ((px - a.x) * ux + (py - a.y) * uy + (pz - a.z) * uz) / uu));
  const cx = a.x + ux * s, cy = a.y + uy * s, cz = a.z + uz * s;
  t = (cx - o.x) * d.x + (cy - o.y) * d.y + (cz - o.z) * d.z;
  const qx = o.x + d.x * t - cx, qy = o.y + d.y * t - cy, qz = o.z + d.z * t - cz;
  const d2 = qx * qx + qy * qy + qz * qz;
  if (d2 > r * r) return -1;
  t -= Math.sqrt(r * r - d2);
  return t >= 0 && t <= maxT ? t : -1;
}

export class Soldier {
  readonly model: SoldierModel;
  readonly pos = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  yaw = 0;
  hp = 100;
  state: AiState = "idle";
  alive = true;
  tag = "";
  leash = 0;
  accuracy = 1;
  /** 0..1: how sure this soldier is that the player is there. */
  awareness = 0;
  sees = false;
  sinceSeen = 99;
  readonly lastKnown = new THREE.Vector3();
  path: THREE.Vector3[] | null = null;
  pathI = 0;
  run = false;
  cover: THREE.Vector3 | null = null;
  atCover = false;
  exposed = true;
  peekT = 0;
  burst = 0;
  shotCd = 0;
  settle = 0;
  thinkT = Math.random() * 0.4;
  losT = Math.random() * 0.2;
  coverAge = 0;
  patrol: Array<[number, number]> | null = null;
  patrolI = 0;
  waitT = 0;
  lookYaw = 0;
  deadT = 0;
  alertDelay = -1;
  readonly pose: Pose = { phase: Math.random() * 6, speed: 0, crouch: 0, aimYaw: 0, aimPitch: 0, aim: 0, kick: 0, flinch: 0, dead: 0, deadKind: 0 };
  stepAcc = 0;

  constructor(mats: SoldierMats) {
    this.model = new SoldierModel(mats);
  }
}

/**
 * Every hostile on the map: perception, decisions, movement, shooting, and the
 * hit test the player's weapon fires against.
 */
export class Soldiers implements TargetProvider {
  readonly list: Soldier[] = [];
  onKill?: (s: Soldier, part: BodyPart) => void;
  onAlert?: () => void;
  /** Global accuracy scale (difficulty). */
  difficulty = 1;
  private readonly mats: SoldierMats;
  private readonly eye = new THREE.Vector3();
  private readonly tEye = new THREE.Vector3();
  private everAlerted = false;

  constructor(private readonly engine: Engine, private readonly world: CollisionWorld, private readonly nav: NavGrid, private readonly vfx: Vfx, private readonly audio: Audio, private readonly target: AiTarget) {
    this.mats = soldierMaterials(engine, { uniform: opforCamo(), gear: 0x3d3f30, helmet: 0x45473a, skin: 0x9a7354, mask: 0x23241f, armband: null });
  }

  get aliveCount(): number {
    let n = 0;
    for (const s of this.list) if (s.alive) n++;
    return n;
  }

  countTag(tag: string): number {
    let n = 0;
    for (const s of this.list) if (s.alive && s.tag === tag) n++;
    return n;
  }

  get inCombat(): boolean {
    for (const s of this.list) if (s.alive && s.state === "combat") return true;
    return false;
  }

  spawn(x: number, z: number, o: SpawnOpts = {}): Soldier | null {
    const p = this.nav.nearest(x, z, 10);
    if (!p) return null;
    const s = new Soldier(this.mats);
    s.pos.copy(p);
    s.home.copy(p);
    s.yaw = s.lookYaw = o.yaw ?? Math.random() * Math.PI * 2;
    s.leash = o.leash ?? 0;
    s.patrol = o.patrol ?? null;
    s.tag = o.tag ?? "";
    s.accuracy = o.accuracy ?? 1;
    if (o.alerted) {
      s.awareness = 1;
      s.state = "combat";
      s.lastKnown.copy(this.target.pos);
      s.sinceSeen = 3;
    }
    s.model.root.position.copy(s.pos);
    s.model.root.rotation.y = s.yaw;
    this.engine.scene.add(s.model.root);
    this.list.push(s);
    return s;
  }

  clear(): void {
    for (const s of this.list) this.engine.scene.remove(s.model.root);
    this.list.length = 0;
    this.everAlerted = false;
  }

  /** A loud noise (the player's rifle, an explosion): nearby soldiers react. */
  noise(pos: THREE.Vector3, radius: number): void {
    for (const s of this.list) {
      if (!s.alive || s.state === "combat") continue;
      const d = s.pos.distanceTo(pos);
      if (d > radius) continue;
      s.lastKnown.copy(pos);
      s.awareness = Math.min(1, s.awareness + (d < radius * 0.5 ? 1 : 0.6));
      if (s.awareness < 1 && s.state === "idle") {
        s.state = "search";
        s.path = null;
        s.waitT = rr(0.4, 1.2);
      }
    }
  }

  /** Blast damage with line-of-sight falloff. Returns kills. */
  explode(pos: THREE.Vector3, radius: number, maxDamage: number): number {
    let kills = 0;
    for (const s of this.list) {
      if (!s.alive) continue;
      _a.copy(s.pos).setY(s.pos.y + 1);
      const d = _a.distanceTo(pos);
      if (d > radius) continue;
      if (d > 1.5 && !this.world.clear(pos, _a)) continue;
      const dmg = maxDamage * (1 - d / radius) * (1 - d / radius) + 20;
      if (this.hurt(s, dmg, _b.subVectors(_a, pos).normalize(), "torso")) kills++;
    }
    this.noise(pos, 90);
    return kills;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): TargetHit | null {
    let best: Soldier | null = null;
    let bestT = maxDist;
    let part: BodyPart = "torso";
    for (const s of this.list) {
      if (!s.alive) continue;
      // Broad reject against a sphere around the body.
      _a.set(s.pos.x - origin.x, s.pos.y + 0.9 - origin.y, s.pos.z - origin.z);
      const along = _a.dot(dir);
      if (along < -1.3 || along > bestT + 1.3) continue;
      if (_a.lengthSq() - along * along > 1.7) continue;
      const m = s.model;
      const head = rayCapsule(origin, dir, m.headPos, m.headPos, 0.135, bestT);
      if (head >= 0) {
        bestT = head;
        best = s;
        part = "head";
      }
      _b.copy(m.chestPos).setY(m.chestPos.y + 0.16);
      _c.set((s.pos.x + m.chestPos.x) / 2, s.pos.y + (m.chestPos.y - s.pos.y) * 0.72, (s.pos.z + m.chestPos.z) / 2);
      const torso = rayCapsule(origin, dir, _c, _b, 0.215, bestT);
      if (torso >= 0) {
        bestT = torso;
        best = s;
        part = "torso";
      }
      _d.set(s.pos.x, s.pos.y + 0.12, s.pos.z);
      const legs = rayCapsule(origin, dir, _d, _c, 0.19, bestT);
      if (legs >= 0) {
        bestT = legs;
        best = s;
        part = "limb";
      }
    }
    if (!best) return null;
    const s = best;
    const hitPart = part;
    return {
      dist: bestT,
      point: new THREE.Vector3().copy(origin).addScaledVector(dir, bestT),
      part: hitPart,
      apply: (damage, d) => this.hurt(s, damage, d, hitPart),
    };
  }

  private hurt(s: Soldier, damage: number, dir: THREE.Vector3, part: BodyPart): boolean {
    if (!s.alive) return false;
    s.hp -= damage;
    s.pose.flinch = 1;
    if (s.hp <= 0) {
      s.alive = false;
      s.deadT = 0;
      const f = Math.sin(s.yaw) * dir.x + Math.cos(s.yaw) * dir.z;
      s.pose.deadKind = Math.abs(f) < 0.45 ? 2.5 : f < 0 ? 0.5 : 1.5;
      this.onKill?.(s, part);
      this.alertNear(s.pos, 30, 0.3);
      return true;
    }
    if (s.state !== "combat") this.engage(s);
    s.lastKnown.copy(this.target.pos);
    // Getting hit breaks the peek: drop back into cover.
    if (s.atCover && Math.random() < 0.7) {
      s.exposed = false;
      s.peekT = rr(0.8, 1.8);
    }
    return false;
  }

  private engage(s: Soldier): void {
    if (s.state === "combat") return;
    s.state = "combat";
    s.awareness = 1;
    s.cover = null;
    s.atCover = false;
    s.path = null;
    s.thinkT = 0;
    s.settle = 0;
    s.lastKnown.copy(this.target.pos);
    this.alertNear(s.pos, 38, rr(0.5, 1.4));
    if (!this.everAlerted) {
      this.everAlerted = true;
      this.onAlert?.();
    }
  }

  private alertNear(pos: THREE.Vector3, radius: number, delay: number): void {
    for (const o of this.list) {
      if (!o.alive || o.state === "combat" || o.alertDelay >= 0) continue;
      if (o.pos.distanceTo(pos) < radius) o.alertDelay = delay + Math.random() * 0.8;
    }
  }

  private goto(s: Soldier, dest: THREE.Vector3, run: boolean): boolean {
    const p = this.nav.path(s.pos, dest);
    if (!p || p.length === 0) {
      s.path = null;
      return false;
    }
    s.path = p;
    s.pathI = 0;
    s.run = run;
    return true;
  }

  private pickCover(s: Soldier, advance: boolean): void {
    const t = this.target.pos;
    const d = Math.hypot(t.x - s.pos.x, t.z - s.pos.z);
    const near = _a.copy(s.pos);
    if (s.leash > 0) near.copy(s.home);
    else if (advance && d > 14) near.lerp(s.lastKnown, Math.min(0.5, 13 / d));
    const radius = s.leash > 0 ? s.leash : 15;
    const taken = (p: THREE.Vector3): boolean => {
      for (const o of this.list) if (o !== s && o.alive && o.cover && o.cover.distanceToSquared(p) < 3.2) return true;
      return false;
    };
    const c = this.nav.findCover(near, s.lastKnown, radius, taken, advance ? 16 : 26);
    s.coverAge = 0;
    if (c && this.goto(s, c, true)) {
      s.cover = c;
      s.atCover = false;
    } else {
      // Nothing to hide behind: fight from where we stand.
      s.cover = null;
      s.atCover = true;
      s.exposed = true;
      s.peekT = rr(2, 4);
    }
  }

  private fire(s: Soldier, dist: number): void {
    const m = s.model;
    const tp = this.target;
    const o = m.muzzle;
    // Aim at the upper body; error shrinks as the shooter settles on target.
    _a.set(tp.pos.x, tp.pos.y + tp.eye * 0.74, tp.pos.z);
    const sigma = (0.017 + tp.speed * 0.0042 + (1 - Math.min(1, s.settle / 1.3)) * 0.03 + s.pose.speed * 0.01) / (s.accuracy * this.difficulty);
    _b.subVectors(_a, o).normalize();
    _n.set(-_b.z, 0, _b.x).normalize();
    _b.addScaledVector(_n, gauss() * sigma);
    _b.y += gauss() * sigma * 0.8;
    _b.normalize();
    const wh = this.world.raycast(o, _b, 260);
    const maxT = wh ? wh.distance : 260;
    _c.set(tp.pos.x, tp.pos.y + 0.28, tp.pos.z);
    _d.set(tp.pos.x, tp.pos.y + tp.eye + 0.06, tp.pos.z);
    const t = tp.alive ? rayCapsule(o, _b, _c, _d, 0.27, maxT) : -1;
    const end = new THREE.Vector3();
    if (t >= 0) {
      end.copy(o).addScaledVector(_b, t);
      const dmg = (dist < 40 ? 15 : dist < 80 ? 12 : 9) * rr(0.85, 1.15);
      tp.damage(dmg, s.pos);
    } else {
      if (wh) {
        end.copy(wh.point);
        if (wh.distance < 150) {
          this.vfx.impact(wh.point, wh.normal, wh.surf);
          if (wh.point.distanceTo(tp.pos) < 30) this.audio.impact(wh.surf, wh.point.x, wh.point.y, wh.point.z);
        }
      } else end.copy(o).addScaledVector(_b, 260);
      // Near miss: closest approach to the player's head.
      const along = _d.sub(o).dot(_b);
      if (along > 0 && along < maxT) {
        _c.copy(o).addScaledVector(_b, along);
        if (_c.distanceToSquared(_a) < 3.2) tp.whiz(_c);
      }
    }
    this.vfx.tracer(o, end, 520);
    this.vfx.muzzle(o, _b, 0.9, true);
    if (dist < 60) this.vfx.flashLight(o, 16, 0.05);
    this.audio.shot("rifle", o.x, o.y, o.z);
    s.pose.kick = 1;
  }

  update(dt: number): void {
    const tp = this.target;
    this.tEye.set(tp.pos.x, tp.pos.y + tp.eye, tp.pos.z);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      const ps = s.pose;
      if (!s.alive) {
        s.deadT += dt;
        ps.dead = Math.min(1, s.deadT / 0.62);
        ps.speed = 0;
        if (s.deadT < 1.2) s.model.pose(ps);
        if (s.deadT > 45) {
          s.model.root.position.y -= dt * 0.3;
          if (s.deadT > 49) {
            this.engine.scene.remove(s.model.root);
            this.list.splice(i, 1);
          }
        }
        continue;
      }
      const dx = tp.pos.x - s.pos.x;
      const dz = tp.pos.z - s.pos.z;
      const dist = Math.hypot(dx, dz);
      this.eye.set(s.pos.x, s.pos.y + 1.58 - ps.crouch * 0.5, s.pos.z);

      // ---- perception -----------------------------------------------------------
      s.losT -= dt;
      if (s.losT <= 0) {
        const step = 0.16 + Math.random() * 0.08 + (dist > 70 ? 0.2 : 0);
        s.losT = step;
        let vis = false;
        if (tp.alive && dist < 120) {
          const fx = Math.sin(s.lookYaw), fz = Math.cos(s.lookYaw);
          const facing = (fx * dx + fz * dz) / (dist + 1e-4);
          if (s.state === "combat" || facing > 0.25 || dist < 3.5) {
            vis = this.world.clear(this.eye, this.tEye) || this.world.clear(this.eye, _a.set(tp.pos.x, tp.pos.y + tp.eye * 0.55, tp.pos.z));
          }
        }
        s.sees = vis;
        if (vis) {
          s.sinceSeen = 0;
          s.lastKnown.copy(tp.pos);
          if (s.state !== "combat") {
            s.awareness += step * Math.max(0.35, Math.min(5, 26 / dist)) * (tp.eye < 1.3 ? 0.7 : 1) * (0.6 + tp.speed * 0.15);
            if (s.awareness >= 1) this.engage(s);
          }
        } else if (s.state === "idle") s.awareness = Math.max(0, s.awareness - step * 0.12);
      }
      s.sinceSeen += dt;
      if (s.alertDelay >= 0) {
        s.alertDelay -= dt;
        if (s.alertDelay < 0 && s.state !== "combat") this.engage(s);
      }

      // ---- decisions ---------------------------------------------------------------
      let wantCrouch = 0;
      let wantAim = 0;
      let faceYaw = s.yaw;
      let facing = false;
      s.coverAge += dt;
      s.thinkT -= dt;
      if (s.state === "combat") {
        const toT = Math.atan2(s.lastKnown.x - s.pos.x, s.lastKnown.z - s.pos.z);
        if (s.thinkT <= 0) {
          s.thinkT = 0.35 + Math.random() * 0.2;
          if (!s.cover && !s.atCover) this.pickCover(s, false);
          else if (s.atCover && s.cover && s.sees && s.coverAge > 2.5 && this.world.clear(_a.set(s.pos.x, s.pos.y + 0.85, s.pos.z), this.tEye) && dist < 60) this.pickCover(s, false); // flanked
          else if (s.atCover && s.sinceSeen > rr(5, 8) && s.coverAge > 4) {
            if (s.sinceSeen > 16 && s.leash === 0) {
              s.state = "search";
              s.cover = null;
              s.atCover = false;
              this.goto(s, s.lastKnown, false);
            } else if (s.leash === 0) this.pickCover(s, true);
          } else if (s.atCover && s.coverAge > rr(12, 20) && s.leash === 0 && dist > 22) this.pickCover(s, true);
        }
        if (s.atCover) {
          s.peekT -= dt;
          if (s.peekT <= 0) {
            s.exposed = !s.exposed || !s.cover;
            s.peekT = s.exposed ? rr(1.8, 3.6) : rr(0.7, 2.0);
            if (s.exposed) s.settle = 0.2;
          }
          wantCrouch = s.exposed ? 0 : 1;
          wantAim = s.exposed ? 1 : 0.35;
          faceYaw = toT;
          facing = true;
        } else {
          wantAim = s.sees && dist < 30 ? 1 : 0.2;
          if (s.sees && dist < 30) {
            faceYaw = toT;
            facing = true;
          }
        }
        // Shooting.
        s.shotCd -= dt;
        const canFire = s.sees && tp.alive && ps.aim > 0.8 && ps.crouch < 0.35 && Math.abs(wrap(toT - s.yaw - ps.aimYaw)) < 0.2;
        if (canFire) {
          s.settle += dt;
          if (s.shotCd <= 0) {
            if (s.burst <= 0) s.burst = 2 + Math.floor(Math.random() * 4);
            this.fire(s, dist);
            s.burst--;
            s.shotCd = s.burst > 0 ? 0.105 : rr(0.55, 1.5) * (dist > 60 ? 1.5 : 1);
          }
        } else if (!s.sees) s.settle = Math.max(0, s.settle - dt * 0.5);
      } else if (s.state === "search") {
        wantAim = 0.5;
        if (s.waitT > 0) {
          s.waitT -= dt;
          faceYaw = Math.atan2(s.lastKnown.x - s.pos.x, s.lastKnown.z - s.pos.z);
          facing = true;
          if (s.waitT <= 0 && s.leash === 0) this.goto(s, s.lastKnown, false);
        } else if (!s.path) {
          // Arrived (or nowhere to go): scan, then stand down.
          s.lookYaw += dt * 0.9;
          faceYaw = s.lookYaw;
          facing = true;
          s.awareness -= dt * 0.1;
          if (s.awareness < 0.35) {
            s.state = "idle";
            if (s.leash > 0 || !s.patrol) this.goto(s, s.home, false);
          }
        }
      } else if (s.patrol && !s.path) {
        s.waitT -= dt;
        if (s.waitT <= 0) {
          s.patrolI = (s.patrolI + 1) % s.patrol.length;
          const [px, pz] = s.patrol[s.patrolI];
          this.goto(s, _a.set(px, 0, pz), false);
          s.waitT = rr(2, 6);
        }
      } else if (!s.path) {
        // Sentry: slow scan left and right.
        s.waitT -= dt;
        if (s.waitT <= 0) {
          s.waitT = rr(2.5, 6);
          s.lookYaw = s.yaw + rr(-0.9, 0.9);
        }
        faceYaw = s.lookYaw;
        facing = true;
      }

      // ---- movement ------------------------------------------------------------------
      let speed = 0;
      if (s.path) {
        const wp = s.path[s.pathI];
        const mx = wp.x - s.pos.x;
        const mz = wp.z - s.pos.z;
        const md = Math.hypot(mx, mz);
        if (md < 0.35) {
          s.pathI++;
          if (s.pathI >= s.path.length) {
            s.path = null;
            if (s.state === "combat" && s.cover) {
              s.atCover = true;
              s.exposed = false;
              s.peekT = rr(0.4, 1.2);
            }
          }
        } else {
          speed = s.run ? 4.5 : 1.5;
          if (facing && s.run) speed = 3.2;
          const moveYaw = Math.atan2(mx, mz);
          if (!facing) faceYaw = moveYaw;
          let vx = (mx / md) * speed;
          let vz = (mz / md) * speed;
          // Keep clear of squadmates.
          for (const o of this.list) {
            if (o === s || !o.alive) continue;
            const ox = s.pos.x - o.pos.x, oz = s.pos.z - o.pos.z;
            const od = ox * ox + oz * oz;
            if (od < 0.8 && od > 1e-4) {
              vx += (ox / od) * 0.5;
              vz += (oz / od) * 0.5;
            }
          }
          const nx = s.pos.x + vx * dt;
          const nz = s.pos.z + vz * dt;
          const fl = this.nav.floorAt(nx, nz);
          if (fl !== null) {
            s.pos.x = nx;
            s.pos.z = nz;
            s.pos.y += (fl - s.pos.y) * Math.min(1, dt * 12);
          } else {
            s.pos.x += (wp.x - s.pos.x) * Math.min(1, dt * 3);
            s.pos.z += (wp.z - s.pos.z) * Math.min(1, dt * 3);
          }
          ps.phase += dt * (s.run ? 10.5 : 6.2) * (speed / (s.run ? 4.5 : 1.5));
          s.stepAcc += speed * dt;
          if (s.stepAcc > (s.run ? 1.9 : 1.3)) {
            s.stepAcc = 0;
            if (dist < 28) this.audio.footstep(1, s.run, s.pos.x, s.pos.y, s.pos.z);
          }
        }
      }
      if (speed > 0 && !facing) s.lookYaw = faceYaw;

      // ---- pose ------------------------------------------------------------------------
      // Legs follow the movement direction; the torso makes up the difference to the target.
      const legYaw = speed > 0 && s.path ? Math.atan2(s.path[Math.min(s.pathI, s.path.length - 1)].x - s.pos.x, s.path[Math.min(s.pathI, s.path.length - 1)].z - s.pos.z) : faceYaw;
      let twist = wrap(faceYaw - legYaw);
      let bodyYaw = legYaw;
      if (Math.abs(twist) > 1.0) {
        // Cannot twist that far: side-step / back-pedal facing the target instead.
        bodyYaw = faceYaw;
        twist = 0;
      }
      s.yaw += wrap(bodyYaw - s.yaw) * Math.min(1, dt * (speed > 0 ? 9 : 5));
      const k = Math.min(1, dt * 8);
      ps.aimYaw += (twist - ps.aimYaw) * k;
      ps.speed += (speed - ps.speed) * Math.min(1, dt * 7);
      ps.crouch += (wantCrouch - ps.crouch) * Math.min(1, dt * 6);
      ps.aim += (wantAim - ps.aim) * Math.min(1, dt * 6);
      const pitchT = s.state === "combat" ? Math.atan2(this.tEye.y - 0.3 - (s.pos.y + 1.4), dist + 0.1) : 0;
      ps.aimPitch += (Math.max(-0.7, Math.min(0.7, pitchT)) - ps.aimPitch) * k;
      ps.kick = Math.max(0, ps.kick - dt * 9);
      ps.flinch = Math.max(0, ps.flinch - dt * 4);
      if (facing) s.lookYaw = faceYaw;
      s.model.root.position.copy(s.pos);
      s.model.root.rotation.y = s.yaw;
      // Far soldiers out of view pose less often? Posing is cheap enough at this headcount.
      s.model.pose(ps);
    }
  }
}
