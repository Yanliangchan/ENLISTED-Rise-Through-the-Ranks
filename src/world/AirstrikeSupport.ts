import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, ParticleSystem, Color4, DynamicTexture } from "@babylonjs/core";
import type { AudioManager } from "@/core/AudioManager";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import { isUnlocked as isAdminUnlocked } from "@/core/AdminMode";

const CHARGES_PER_RUN = 3; // max 3 air strikes per match, shared across the whole run
const COOLDOWN_SEC = 45;
const INBOUND_DELAY_SEC = 3; // faster deployment than Carpet Bombing — small-area guaranteed elimination
const BLAST_RADIUS_M = 16;
// Minimal splash damage just outside the guaranteed-kill radius — this is a
// pin-point strike, not an area-denial weapon (see Carpet Bombing for that).
const OUTER_SPLASH_DAMAGE = 25;

/**
 * Precision Strike support ability. Equipped in the SPECIAL slot (alongside
 * the MATADOR, Hermes 900 UAV, and Carpet Bombing). Firing it opens the
 * tactical map to pick a target point; after a short inbound delay anything
 * inside BLAST_RADIUS_M dies instantly, with only minimal splash damage just
 * outside it. Small-area guaranteed elimination — fast to call in, but no
 * crowd-control reach. Limited charges per deployment with a cooldown between
 * calls.
 *
 * Targeting/UI flow lives in main.ts (which opens the map on request and feeds
 * back the picked world coordinate); this class owns the ammo economy, the
 * inbound countdown, and the impact (damage + effect).
 */
export class AirstrikeSupport {
  private charges = CHARGES_PER_RUN;
  private cooldownLeft = 0;
  private inboundLeft = 0;
  private target: Vector3 | null = null;
  private markerMesh: ReturnType<typeof MeshBuilder.CreateCylinder> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly audio: AudioManager,
    private readonly enemyManager: EnemyManager
  ) {}

  reset(): void {
    this.charges = CHARGES_PER_RUN;
    this.cooldownLeft = 0;
    this.inboundLeft = 0;
    this.target = null;
    this.markerMesh?.dispose();
    this.markerMesh = null;
  }

  get chargesRemaining(): number {
    return this.charges;
  }
  get cooldownRemaining(): number {
    return Math.max(0, this.cooldownLeft);
  }
  get inbound(): boolean {
    return this.inboundLeft > 0;
  }
  get secondsToImpact(): number {
    return Math.max(0, this.inboundLeft);
  }
  /** True if a strike can be called right now (has a charge and isn't cooling down / already inbound). */
  get ready(): boolean {
    return this.inboundLeft <= 0 && this.cooldownLeft <= 0 && (this.charges > 0 || isAdminUnlocked());
  }

  /** Called when the player confirms a target on the map. Spends a charge and starts the inbound timer. */
  callStrike(x: number, z: number): boolean {
    if (!this.ready) {
      this.audio.uiClick();
      return false;
    }
    if (!isAdminUnlocked()) this.charges -= 1;
    this.target = new Vector3(x, 0, z);
    this.inboundLeft = INBOUND_DELAY_SEC;
    this.audio.waveStart();
    // Ground marker so the player sees where it's coming down.
    this.markerMesh?.dispose();
    const m = MeshBuilder.CreateCylinder("airstrike_marker", { diameter: BLAST_RADIUS_M * 2, height: 0.1, tessellation: 24 }, this.scene);
    m.position.set(x, 0.08, z);
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

  update(dt: number): void {
    if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
    if (this.inboundLeft > 0) {
      this.inboundLeft -= dt;
      // Pulse the marker as impact nears.
      if (this.markerMesh) {
        const k = 0.2 + 0.25 * Math.abs(Math.sin(this.inboundLeft * 6));
        (this.markerMesh.material as StandardMaterial).alpha = k;
      }
      if (this.inboundLeft <= 0 && this.target) {
        this.detonate(this.target);
        this.target = null;
        this.cooldownLeft = COOLDOWN_SEC;
        this.markerMesh?.dispose();
        this.markerMesh = null;
      }
    }
  }

  private detonate(at: Vector3): void {
    this.audio.explosion();
    // Guaranteed kill anywhere inside the strike radius...
    this.enemyManager.killInRadius(at, BLAST_RADIUS_M);
    // ...and only minimal splash damage in a thin band just outside it.
    this.enemyManager.damageInRadius(at, BLAST_RADIUS_M * 1.4, OUTER_SPLASH_DAMAGE);

    // A bright flash sphere + debris burst — cheap, self-disposing.
    const flash = MeshBuilder.CreateSphere("airstrike_flash", { diameter: BLAST_RADIUS_M, segments: 10 }, this.scene);
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
