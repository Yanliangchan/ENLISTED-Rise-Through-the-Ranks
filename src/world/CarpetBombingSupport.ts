import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, ParticleSystem, Color4, DynamicTexture } from "@babylonjs/core";
import type { AudioManager } from "@/core/AudioManager";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { PlayerController } from "@/player/PlayerController";
import { CARPET_BOMBING } from "@/data/gamedata";
import { carpetImpactPoints, type StrikePlan } from "@/world/strikePlan";
import type { StrikeChargeStore } from "@/world/AirstrikeSupport";
import { isUnlocked as isAdminUnlocked } from "@/core/AdminMode";

/**
 * Carpet Bombing support ability. Equipped in the SPECIAL slot (alongside the
 * MATADOR, Hermes 900 UAV, and Precision Strike). Firing it opens the
 * targeting map to place AND orient a bombing box; after a fixed 3-second
 * inbound countdown a staggered string of bomb impacts rains down along the
 * chosen heading. Anything caught in a direct hit dies instantly; the wider
 * blast does heavy damage; survivors inside the affected area are stunned,
 * then left slowed and less accurate for several seconds.
 *
 * The impact points are NOT rolled here — they come from
 * `carpetImpactPoints(plan)`, the same call the targeting preview made, so
 * what the player was shown is exactly what lands. The `state` machine makes
 * each call-in run precisely once.
 */
export class CarpetBombingSupport {
  private state: "idle" | "inbound" | "running" = "idle";
  private cooldownLeft = 0;
  private inboundLeft = 0;
  private plan: StrikePlan | null = null;
  private markerMesh: ReturnType<typeof MeshBuilder.CreateBox> | null = null;
  // Once inbound hits zero the run itself plays out over impactSpreadSec —
  // tracked separately so update() can stagger individual impacts.
  private runElapsed = 0;
  private impactTimes: number[] = [];
  private impactPoints: Vector3[] = [];
  private nextImpactIndex = 0;

  constructor(
    private readonly scene: Scene,
    private readonly audio: AudioManager,
    private readonly enemyManager: EnemyManager,
    private readonly player: PlayerController,
    private readonly store: StrikeChargeStore
  ) {}

  reset(): void {
    this.state = "idle";
    this.cooldownLeft = 0;
    this.inboundLeft = 0;
    this.runElapsed = 0;
    this.impactTimes = [];
    this.impactPoints = [];
    this.nextImpactIndex = 0;
    this.plan = null;
    this.clearMarker();
  }

  get chargesRemaining(): number {
    return this.store.charges();
  }
  get cooldownRemaining(): number {
    return Math.max(0, this.cooldownLeft);
  }
  get inbound(): boolean {
    return this.state === "inbound";
  }
  get running(): boolean {
    return this.state === "running";
  }
  get secondsToImpact(): number {
    return Math.max(0, this.inboundLeft);
  }
  /** True if a bombing run can be called right now (has a charge and isn't cooling down / already inbound or running). */
  get ready(): boolean {
    return this.state === "idle" && this.cooldownLeft <= 0 && (this.chargesRemaining > 0 || isAdminUnlocked());
  }

  /** Called once the player confirms a box placement + heading. Spends a charge and starts the inbound countdown. */
  callStrike(plan: StrikePlan): boolean {
    if (!this.ready) {
      this.audio.uiClick();
      return false;
    }
    if (!isAdminUnlocked() && !this.store.consume()) return false;
    this.plan = plan;
    this.state = "inbound";
    this.inboundLeft = CARPET_BOMBING.inboundDelaySec;
    this.audio.waveStart();

    this.clearMarker();
    const m = MeshBuilder.CreateBox(
      "carpetbomb_marker",
      { width: CARPET_BOMBING.areaWidthM, depth: CARPET_BOMBING.areaLengthM, height: 0.1 },
      this.scene
    );
    m.position.set(plan.x, 0.08, plan.z);
    // Same heading the player set on the targeting map — the world marker and
    // the preview footprint are the same rectangle.
    m.rotation.y = plan.heading;
    m.isPickable = false;
    const mat = new StandardMaterial("carpetbomb_markerMat", this.scene);
    mat.emissiveColor = new Color3(0.95, 0.55, 0.1);
    mat.diffuseColor = new Color3(0.95, 0.55, 0.1);
    mat.alpha = 0.22;
    mat.disableLighting = true;
    m.material = mat;
    this.markerMesh = m;
    return true;
  }

  private clearMarker(): void {
    this.markerMesh?.material?.dispose();
    this.markerMesh?.dispose();
    this.markerMesh = null;
  }

  update(dt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;

    if (this.state === "inbound") {
      this.inboundLeft -= dt;
      if (this.markerMesh) {
        const k = 0.18 + 0.22 * Math.abs(Math.sin(this.inboundLeft * 5));
        (this.markerMesh.material as StandardMaterial).alpha = k;
      }
      if (this.inboundLeft <= 0 && this.plan) this.beginRun(this.plan);
      return;
    }

    if (this.state === "running") {
      this.runElapsed += dt;
      while (this.nextImpactIndex < this.impactTimes.length && this.impactTimes[this.nextImpactIndex] <= this.runElapsed) {
        this.impact(this.impactPoints[this.nextImpactIndex]);
        this.nextImpactIndex++;
      }
      if (this.nextImpactIndex >= this.impactTimes.length) this.finishRun();
    }
  }

  private beginRun(plan: StrikePlan): void {
    this.clearMarker();
    this.state = "running";
    this.plan = null;
    this.inboundLeft = 0;

    // A wide, sudden shake as the run starts — this is a saturation strike, not
    // a single pinpoint hit.
    this.player.shakeCamera(90);

    // Replay the exact pattern the targeting preview drew.
    this.impactPoints = carpetImpactPoints(plan).map((p) => new Vector3(p.x, 0, p.z));
    this.impactTimes = this.impactPoints.map(
      (_, i) => (i / Math.max(1, this.impactPoints.length - 1)) * CARPET_BOMBING.impactSpreadSec
    );
    this.nextImpactIndex = 0;
    this.runElapsed = 0;

    // Survivor debuffs apply once, across the whole affected area, when the
    // run starts — anyone still alive when it ends has been through it.
    this.enemyManager.applyBombingDebuffInRadius(
      new Vector3(plan.x, 0, plan.z),
      CARPET_BOMBING.survivorEffectRadiusM,
      CARPET_BOMBING.stunSec,
      CARPET_BOMBING.slowMult,
      CARPET_BOMBING.slowSec,
      CARPET_BOMBING.accuracyMult,
      CARPET_BOMBING.accuracyDebuffSec
    );
  }

  private finishRun(): void {
    this.state = "idle";
    this.runElapsed = 0;
    this.impactTimes = [];
    this.impactPoints = [];
    this.nextImpactIndex = 0;
    this.cooldownLeft = CARPET_BOMBING.cooldownSec;
  }

  private impact(at: Vector3): void {
    this.audio.explosion();
    const kills = this.enemyManager.killInRadius(at, CARPET_BOMBING.directHitRadiusM);
    this.enemyManager.damageInRadius(at, CARPET_BOMBING.outerBlastRadiusM, CARPET_BOMBING.outerBlastDamage);
    if (kills > 0) this.player.shakeCamera(20);

    const flash = MeshBuilder.CreateSphere("carpetbomb_flash", { diameter: CARPET_BOMBING.directHitRadiusM * 1.2, segments: 8 }, this.scene);
    flash.position.set(at.x, 1.6, at.z);
    flash.isPickable = false;
    const fmat = new StandardMaterial("carpetbomb_flashMat", this.scene);
    fmat.emissiveColor = new Color3(1, 0.68, 0.28);
    fmat.disableLighting = true;
    fmat.alpha = 0.9;
    flash.material = fmat;
    let life = 0.45;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      life -= dt;
      const k = Math.max(0, life / 0.45);
      flash.scaling.setAll(0.5 + (1 - k) * 2.2);
      fmat.alpha = k * 0.9;
      if (life <= 0) {
        flash.dispose();
        fmat.dispose();
        this.scene.onBeforeRenderObservable.remove(obs);
      }
    });

    const tex = dustTex(this.scene);
    const dust = new ParticleSystem("carpetbomb_dust", 150, this.scene);
    dust.particleTexture = tex;
    dust.emitter = new Vector3(at.x, 0.6, at.z);
    dust.minEmitBox = new Vector3(-4, 0, -4);
    dust.maxEmitBox = new Vector3(4, 1, 4);
    dust.direction1 = new Vector3(-1.5, 4, -1.5);
    dust.direction2 = new Vector3(1.5, 7, 1.5);
    dust.color1 = new Color4(0.32, 0.28, 0.22, 0.55);
    dust.color2 = new Color4(0.4, 0.36, 0.3, 0.35);
    dust.colorDead = new Color4(0.3, 0.3, 0.3, 0);
    dust.minSize = 2.5;
    dust.maxSize = 7;
    dust.minLifeTime = 1.4;
    dust.maxLifeTime = 3;
    dust.emitRate = 220;
    dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    dust.targetStopDuration = 0.35;
    dust.disposeOnStop = true;
    dust.start();
  }
}

function dustTex(scene: Scene): DynamicTexture {
  const s = 32;
  const t = new DynamicTexture("carpetbomb_dustTex", { width: s, height: s }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  t.update();
  t.hasAlpha = true;
  return t;
}
