import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, ParticleSystem, Color4, DynamicTexture } from "@babylonjs/core";
import type { AudioManager } from "@/core/AudioManager";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { PlayerController } from "@/player/PlayerController";
import { PRECISION_STRIKE } from "@/data/gamedata";
import type { StrikePlan } from "@/world/strikePlan";
import { isUnlocked as isAdminUnlocked } from "@/core/AdminMode";

/** How the support class reaches the persistent charge stock without owning it. */
export interface StrikeChargeStore {
  charges(): number;
  consume(): boolean;
}

/**
 * Precision Strike support ability. Equipped in the SPECIAL slot (alongside
 * the MATADOR, Hermes 900 UAV, and Carpet Bombing). Firing it opens the
 * targeting map; once the player confirms a point, a fixed 3-second inbound
 * countdown runs and then anything inside `blastRadiusM` dies instantly, with
 * only minimal splash damage just outside it.
 *
 * Charges live on the save (bought in the Armoury, topped up each deployment)
 * rather than in this class, so the shop, the HUD and the ability can never
 * disagree about how many are left.
 *
 * `state` is the single source of truth for where a call-in is in its
 * lifecycle, which is what stops a strike detonating twice: `detonate` is
 * reachable only from the `inbound → idle` edge, and `ready` is false in every
 * state but `idle`.
 */
export class AirstrikeSupport {
  private state: "idle" | "inbound" = "idle";
  private cooldownLeft = 0;
  private inboundLeft = 0;
  private plan: StrikePlan | null = null;
  private markerMesh: ReturnType<typeof MeshBuilder.CreateCylinder> | null = null;

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
  get secondsToImpact(): number {
    return Math.max(0, this.inboundLeft);
  }
  /** True if a strike can be called right now (has a charge and isn't cooling down / already inbound). */
  get ready(): boolean {
    return this.state === "idle" && this.cooldownLeft <= 0 && (this.chargesRemaining > 0 || isAdminUnlocked());
  }

  /** Called once the player confirms a target. Spends a charge and starts the inbound countdown. */
  callStrike(plan: StrikePlan): boolean {
    if (!this.ready) {
      this.audio.uiClick();
      return false;
    }
    if (!isAdminUnlocked() && !this.store.consume()) return false;
    this.plan = plan;
    this.state = "inbound";
    this.inboundLeft = PRECISION_STRIKE.inboundDelaySec;
    this.audio.waveStart();

    // Ground marker so the player sees where it's coming down — the same
    // radius the targeting preview drew, and the same one that kills.
    this.clearMarker();
    const m = MeshBuilder.CreateCylinder(
      "airstrike_marker",
      { diameter: PRECISION_STRIKE.blastRadiusM * 2, height: 0.1, tessellation: 32 },
      this.scene
    );
    m.position.set(plan.x, 0.08, plan.z);
    m.isPickable = false;
    const mat = new StandardMaterial("airstrike_markerMat", this.scene);
    mat.emissiveColor = new Color3(0.9, 0.2, 0.12);
    mat.diffuseColor = new Color3(0.9, 0.2, 0.12);
    mat.alpha = 0.28;
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
    if (this.state !== "inbound") return;

    this.inboundLeft -= dt;
    // Pulse the marker as impact nears.
    if (this.markerMesh) {
      const k = 0.2 + 0.25 * Math.abs(Math.sin(this.inboundLeft * 6));
      (this.markerMesh.material as StandardMaterial).alpha = k;
    }
    if (this.inboundLeft > 0) return;

    // Leave `inbound` BEFORE detonating: the state change is what guarantees
    // exactly one detonation per call, whatever happens inside detonate().
    const target = this.plan;
    this.state = "idle";
    this.plan = null;
    this.inboundLeft = 0;
    this.cooldownLeft = PRECISION_STRIKE.cooldownSec;
    this.clearMarker();
    if (target) this.detonate(new Vector3(target.x, 0, target.z));
  }

  private detonate(at: Vector3): void {
    this.audio.explosion();
    this.player.shakeCamera(55);
    // Guaranteed kill anywhere inside the strike radius...
    this.enemyManager.killInRadius(at, PRECISION_STRIKE.blastRadiusM);
    // ...and only minimal splash damage in a thin band just outside it.
    this.enemyManager.damageInRadius(
      at,
      PRECISION_STRIKE.blastRadiusM * PRECISION_STRIKE.outerSplashRadiusMult,
      PRECISION_STRIKE.outerSplashDamage
    );

    // A bright flash sphere + debris burst — cheap, self-disposing.
    const flash = MeshBuilder.CreateSphere(
      "airstrike_flash",
      { diameter: PRECISION_STRIKE.blastRadiusM, segments: 10 },
      this.scene
    );
    flash.position.set(at.x, 2, at.z);
    flash.isPickable = false;
    const fmat = new StandardMaterial("airstrike_flashMat", this.scene);
    fmat.emissiveColor = new Color3(1, 0.72, 0.32);
    fmat.disableLighting = true;
    fmat.alpha = 0.9;
    flash.material = fmat;
    let life = 0.55;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      life -= dt;
      const k = Math.max(0, life / 0.55);
      flash.scaling.setAll(0.5 + (1 - k) * 2.4);
      fmat.alpha = k * 0.9;
      if (life <= 0) {
        flash.dispose();
        fmat.dispose();
        this.scene.onBeforeRenderObservable.remove(obs);
      }
    });

    // Smoke/debris column.
    const tex = smokeTex(this.scene);
    const smoke = new ParticleSystem("airstrike_smoke", 120, this.scene);
    smoke.particleTexture = tex;
    smoke.emitter = new Vector3(at.x, 1, at.z);
    smoke.minEmitBox = new Vector3(-3, 0, -3);
    smoke.maxEmitBox = new Vector3(3, 1, 3);
    smoke.direction1 = new Vector3(-1, 5, -1);
    smoke.direction2 = new Vector3(1, 9, 1);
    smoke.color1 = new Color4(0.15, 0.13, 0.11, 0.6);
    smoke.color2 = new Color4(0.25, 0.22, 0.2, 0.4);
    smoke.colorDead = new Color4(0.2, 0.2, 0.2, 0);
    smoke.minSize = 2;
    smoke.maxSize = 6;
    smoke.minLifeTime = 1.2;
    smoke.maxLifeTime = 2.6;
    smoke.emitRate = 200;
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.targetStopDuration = 0.4;
    smoke.disposeOnStop = true;
    smoke.start();
  }
}

function smokeTex(scene: Scene): DynamicTexture {
  const s = 32;
  const t = new DynamicTexture("airstrike_smokeTex", { width: s, height: s }, scene, false);
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
