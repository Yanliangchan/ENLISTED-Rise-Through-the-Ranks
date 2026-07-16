import { Scene, MeshBuilder, StandardMaterial, Color3, Mesh, TransformNode, Vector3, Matrix } from "@babylonjs/core";
import type { HitMeshMetadata, HitZone, Damageable } from "@/weapons/Damageable";
import { RANGE_FIRING_LINE } from "@/world/TrainingRange";

const SHOTS_PER_SESSION = 10;
const TARGET_WIDTH = 0.5;
const TARGET_HEAD_H = 0.22;
const TARGET_BODY_H = 0.75;
const TARGET_CENTER_Y = 1.2; // ground -> target vertical centre
/** Local Y of the body zone's own centre — the conventional "point of aim" for group/centre-offset scoring. */
const AIM_CENTER_LOCAL_Y = TARGET_CENTER_Y - TARGET_HEAD_H / 2;

interface RecordedHit {
  zone: Exclude<HitZone, "limb">;
  /** Metres, relative to the target's aim-point centre. */
  x: number;
  y: number;
}

export interface RangeSessionResult {
  distanceM: number;
  shots: number;
  headHits: number;
  bodyHits: number;
  misses: number;
  accuracyPct: number;
  /** Extreme spread — the largest distance between any two hits on the target. */
  groupSizeCm: number;
  /** Distance from the point-of-aim centre to the group's centroid — a measure of overall bias/zero. */
  centreOffsetCm: number;
  /** Mean distance of individual hits from the point-of-aim centre. */
  avgDistFromCentreCm: number;
  score: number;
}

function solidMat(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * A single relocatable paper target implementing `Damageable` so it plugs
 * straight into the existing hitscan pipeline (WeaponController.raycastShot)
 * exactly like an enemy soldier does. `takeDamage` is a no-op (a paper
 * target has no health); `onImpact` metadata is what actually records shots,
 * since it hands back the exact world impact point the damage economy
 * doesn't otherwise expose.
 */
export class RangeTargetController implements Damageable {
  id = "range_target";
  isDead = false;

  private headMesh: Mesh;
  private bodyMesh: Mesh;
  private decalMat: StandardMaterial;
  private decals: Mesh[] = [];

  private hits: RecordedHit[] = [];
  private misses = 0;
  /** True between a fired shot and its resolution (hit-on-target or confirmed miss) this tick. */
  private pendingShot = false;

  distanceM: number;
  locked = false;

  /** Live feedback after every resolved shot (hit or miss), while the session is still open. */
  onShotResolved?: (shotsSoFar: number, shotsRemaining: number) => void;
  /** Fired once, the moment the 10th shot resolves. */
  onSessionComplete?: (result: RangeSessionResult) => void;

  constructor(private readonly scene: Scene, private readonly carriage: TransformNode, initialDistanceM: number) {
    this.distanceM = initialDistanceM;

    const postMat = solidMat(scene, "rangeTargetPostMat", new Color3(0.25, 0.25, 0.27));
    const post = MeshBuilder.CreateBox("rangeTargetPost", { width: 0.1, height: TARGET_CENTER_Y + TARGET_BODY_H / 2, depth: 0.1 }, scene);
    post.position.set(0, (TARGET_CENTER_Y + TARGET_BODY_H / 2) / 2, 0);
    post.material = postMat;
    post.isPickable = false;
    post.parent = carriage;

    const paperMat = solidMat(scene, "rangeTargetPaperMat", new Color3(0.92, 0.9, 0.82));
    paperMat.backFaceCulling = false;

    this.bodyMesh = MeshBuilder.CreateBox("rangeTargetBody", { width: TARGET_WIDTH, height: TARGET_BODY_H, depth: 0.03 }, scene);
    this.bodyMesh.position.set(0, AIM_CENTER_LOCAL_Y, 0);
    this.bodyMesh.material = paperMat;
    this.bodyMesh.parent = carriage;
    this.bodyMesh.metadata = {
      damageable: this,
      hitZone: "body",
      onImpact: (p, z) => this.recordHit(p, z),
    } satisfies HitMeshMetadata;

    this.headMesh = MeshBuilder.CreateBox("rangeTargetHead", { width: TARGET_WIDTH * 0.55, height: TARGET_HEAD_H, depth: 0.03 }, scene);
    this.headMesh.position.set(0, TARGET_CENTER_Y + TARGET_BODY_H / 2, 0);
    this.headMesh.material = paperMat;
    this.headMesh.parent = carriage;
    this.headMesh.metadata = {
      damageable: this,
      hitZone: "head",
      isHeadshotMesh: true,
      onImpact: (p, z) => this.recordHit(p, z),
    } satisfies HitMeshMetadata;

    this.decalMat = solidMat(scene, "rangeTargetDecalMat", new Color3(0.06, 0.06, 0.06));

    this.setDistance(initialDistanceM);
  }

  /** No health economy on a paper target — `onImpact` metadata does the actual recording. */
  takeDamage(): void {}

  /** Call once per fired shot (from the same `onFire` callback the HUD already uses) to arm miss detection. */
  notifyShotFired(): void {
    if (this.locked) return;
    this.pendingShot = true;
    queueMicrotask(() => {
      // If nothing resolved this shot synchronously (raycastShot already ran
      // by the time this microtask runs), the round missed the target entirely.
      if (this.pendingShot) {
        this.pendingShot = false;
        this.misses++;
        this.afterShotResolved();
      }
    });
  }

  private recordHit(worldPoint: Vector3, zone: HitZone): void {
    if (this.locked || zone === "limb") return;
    this.pendingShot = false;
    const local = Vector3.TransformCoordinates(worldPoint, Matrix.Invert(this.carriage.getWorldMatrix()));
    const x = local.x;
    const y = local.y - AIM_CENTER_LOCAL_Y;
    this.hits.push({ zone, x, y });
    this.spawnDecal(local);
    this.afterShotResolved();
  }

  private afterShotResolved(): void {
    const shotsSoFar = this.hits.length + this.misses;
    this.onShotResolved?.(shotsSoFar, Math.max(0, SHOTS_PER_SESSION - shotsSoFar));
    if (shotsSoFar >= SHOTS_PER_SESSION) {
      this.locked = true;
      this.onSessionComplete?.(this.computeResult());
    }
  }

  private spawnDecal(local: Vector3): void {
    // A small dark disc just proud of the target face (toward the shooter,
    // -Z) so it renders on top without z-fighting the paper behind it.
    const decal = MeshBuilder.CreateDisc(`rangeDecal_${this.decals.length}`, { radius: 0.012, tessellation: 8 }, this.scene);
    decal.position.set(local.x, local.y + AIM_CENTER_LOCAL_Y, -0.02);
    decal.material = this.decalMat;
    decal.parent = this.carriage;
    decal.isPickable = false;
    this.decals.push(decal);
  }

  private computeResult(): RangeSessionResult {
    const headHits = this.hits.filter((h) => h.zone === "head").length;
    const bodyHits = this.hits.filter((h) => h.zone === "body").length;
    const totalHits = this.hits.length;
    const accuracyPct = Math.round((totalHits / SHOTS_PER_SESSION) * 100);

    let groupSizeCm = 0;
    let centreOffsetCm = 0;
    let avgDistFromCentreCm = 0;

    if (totalHits > 0) {
      let sumDist = 0;
      let sumX = 0;
      let sumY = 0;
      for (const h of this.hits) {
        sumDist += Math.hypot(h.x, h.y);
        sumX += h.x;
        sumY += h.y;
      }
      avgDistFromCentreCm = (sumDist / totalHits) * 100;
      const centroidX = sumX / totalHits;
      const centroidY = sumY / totalHits;
      centreOffsetCm = Math.hypot(centroidX, centroidY) * 100;

      let maxPairDist = 0;
      for (let i = 0; i < this.hits.length; i++) {
        for (let j = i + 1; j < this.hits.length; j++) {
          const d = Math.hypot(this.hits[i].x - this.hits[j].x, this.hits[i].y - this.hits[j].y);
          if (d > maxPairDist) maxPairDist = d;
        }
      }
      groupSizeCm = maxPairDist * 100;
    }

    // Precision credit scales its tolerance with range — the same angular
    // wobble opens up a wider group in absolute metres the further out the
    // target sits, so a flat cm tolerance would unfairly punish long range.
    const toleranceM = 0.05 + this.distanceM * 0.004;
    const precision = totalHits > 0 ? Math.max(0, 1 - avgDistFromCentreCm / 100 / toleranceM) : 0;
    const score = Math.max(0, Math.min(100, Math.round((totalHits / SHOTS_PER_SESSION) * 60 + precision * 40)));

    return {
      distanceM: this.distanceM,
      shots: totalHits + this.misses,
      headHits,
      bodyHits,
      misses: this.misses,
      accuracyPct,
      groupSizeCm,
      centreOffsetCm,
      avgDistFromCentreCm,
      score,
    };
  }

  setDistance(m: number): void {
    this.distanceM = m;
    this.carriage.position.z = RANGE_FIRING_LINE.z + m;
  }

  /** Clears bullet holes and hit history for a fresh 10-round session — keeps the current distance/weapon. */
  reset(): void {
    for (const d of this.decals) d.dispose();
    this.decals = [];
    this.hits = [];
    this.misses = 0;
    this.pendingShot = false;
    this.locked = false;
  }
}
