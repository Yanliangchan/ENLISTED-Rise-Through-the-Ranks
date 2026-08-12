import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Color4, PointLight, Mesh, ParticleSystem, DynamicTexture } from "@babylonjs/core";
import { THROWABLES, type Throwable } from "@/data/gamedata";
import type { PlayerController } from "@/player/PlayerController";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { AudioManager } from "@/core/AudioManager";
import type { GameState } from "@/core/GameState";
import type { InputManager } from "@/core/InputManager";
import { admitLightToFrozenWorld } from "@/world/Level";
import { registerSmokeOccluder } from "@/world/RayIndex";

const THROW_SPEED = 11;
const THROW_ARC_UP = 3;
const GRAVITY = -18;
/** Fraction of horizontal speed lost per second of ground contact (rolling friction). */
const GROUND_FRICTION_PER_SEC = 6;
const RESTING_SPEED_THRESHOLD = 0.15;

interface FlyingThrowable {
  throwable: Throwable;
  mesh: Mesh;
  velocity: Vector3;
  fuseRemaining: number;
  /** Touching the ground — still slides briefly under friction before coming to rest. */
  grounded: boolean;
  /** False when thrown from inside the safe zone — still flies/detonates visually, just can't hurt anything. */
  canDealDamage: boolean;
}

/**
 * Handles the equipped throwable (slot 4, `G` to throw): SFG 87 frag with
 * blast falloff, four colours of AI-LOS-blocking smoke, a flashbang that
 * whites out the screen + stuns nearby OPFOR, an illumination flare, and a
 * tripflare that arms on landing and triggers on enemy proximity.
 */
export class ThrowableController {
  private flying: FlyingThrowable[] = [];
  private tripflares: Array<{ position: Vector3; radiusM: number; triggered: boolean }> = [];
  private smokeVolumes: Array<{ mesh: Mesh; expiresAt: number }> = [];
  private claymores: Array<{ mesh: Mesh; forward: Vector3; rangeM: number; damage: number }> = [];
  private cachedFlareGlowTex: DynamicTexture | null = null;

  onFlashbangScreen?: (intensity: number) => void;
  onFlareTriggered?: (position: Vector3) => void;
  /** Fired with the number of kills scored by one frag/claymore detonation — feeds the EOD badge track. */
  onExplosiveKills?: (count: number) => void;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly input: InputManager,
    private readonly enemyManager: EnemyManager,
    private readonly gameState: GameState,
    private readonly audio: AudioManager
  ) {}

  update(dt: number): void {
    if (this.input.wasPressed("KeyG")) this.throwEquipped();

    const justArmed: FlyingThrowable[] = [];
    for (const f of this.flying) {
      if (!f.grounded) {
        f.velocity.y += GRAVITY * dt;
        const nextPos = f.mesh.position.add(f.velocity.scale(dt));
        if (nextPos.y <= 0.1) {
          // Touch down: kill vertical speed, keep a damped fraction of horizontal
          // speed so it rolls a little rather than either stopping dead or sliding forever.
          nextPos.y = 0.1;
          f.grounded = true;
          f.velocity.y = 0;
          f.velocity.x *= 0.4;
          f.velocity.z *= 0.4;
          if (f.throwable.type === "tripflare") justArmed.push(f);
        }
        f.mesh.position = nextPos;
      } else {
        // Ground friction decays horizontal speed exponentially until it stops.
        const decay = Math.max(0, 1 - GROUND_FRICTION_PER_SEC * dt);
        f.velocity.x *= decay;
        f.velocity.z *= decay;
        if (f.velocity.lengthSquared() < RESTING_SPEED_THRESHOLD * RESTING_SPEED_THRESHOLD) {
          f.velocity.setAll(0);
        } else {
          f.mesh.position.addInPlace(f.velocity.scale(dt));
        }
      }
      f.fuseRemaining -= dt;
      if (f.fuseRemaining <= 0) this.detonate(f);
    }

    for (const f of justArmed) {
      this.tripflares.push({ position: f.mesh.position.clone(), radiusM: f.throwable.radiusM, triggered: false });
      f.mesh.dispose();
      this.flying = this.flying.filter((x) => x !== f);
    }

    const now = performance.now();
    for (const smoke of this.smokeVolumes) {
      if (now >= smoke.expiresAt) smoke.mesh.dispose();
    }
    this.smokeVolumes = this.smokeVolumes.filter((s) => now < s.expiresAt);

    this.checkTripflareTriggers();
    this.checkClaymoreTriggers();
  }

  private checkTripflareTriggers(): void {
    for (const trip of this.tripflares) {
      if (trip.triggered) continue;
      if (this.enemyManager.anyEnemyWithin(trip.position, trip.radiusM)) {
        trip.triggered = true;
        this.detonateFlare(trip.position, THROWABLES.tripflare);
      }
    }
  }

  private checkClaymoreTriggers(): void {
    for (const mine of [...this.claymores]) {
      const { hit, kills } = this.enemyManager.damageInCone(mine.mesh.position, mine.forward, mine.rangeM, Math.PI / 4, mine.damage);
      if (hit) {
        this.spawnFlashSprite(mine.mesh.position.add(mine.forward.scale(1.2)), new Color3(1, 0.75, 0.35), 1.0, 220);
        this.audio.explosion();
        if (kills > 0) this.onExplosiveKills?.(kills);
        mine.mesh.dispose();
        this.claymores = this.claymores.filter((m) => m !== mine);
      }
    }
  }

  private throwEquipped(): void {
    const throwableId = this.gameState.data.loadout.throwable;
    const throwable = THROWABLES[throwableId];
    if (!throwable) return;
    if (this.gameState.data.loadout.throwableCount <= 0) {
      this.audio.uiClick();
      return;
    }
    this.player.breakSpawnProtection();
    this.gameState.data.loadout.throwableCount -= 1;

    const forward = this.player.camera.getDirection(Vector3.Forward());
    if (throwable.type === "claymore") {
      this.placeClaymore(throwable, forward);
      this.gameState.save();
      return;
    }
    const origin = this.player.camera.globalPosition.add(forward.scale(0.6));
    const velocity = forward.scale(THROW_SPEED).add(new Vector3(0, THROW_ARC_UP, 0));

    const mesh = MeshBuilder.CreateSphere(`throwable_${throwable.id}_${Date.now()}`, { diameter: 0.12 }, this.scene);
    mesh.position = origin;
    const mat = new StandardMaterial(`throwableMat_${throwable.id}`, this.scene);
    mat.diffuseColor = throwable.color ? Color3.FromHexString(throwable.color) : new Color3(0.2, 0.25, 0.15);
    mesh.material = mat;
    mesh.isPickable = false;

    // Thrown from inside the safe zone can't hurt anything, mirroring gunfire —
    // captured at throw time so a mid-flight zone crossing doesn't matter.
    const canDealDamage = !this.player.inSafeZone;
    this.flying.push({ throwable, mesh, velocity, fuseRemaining: throwable.fuseSec, grounded: false, canDealDamage });
    this.audio.throwableFuse();
  }

  private detonate(f: FlyingThrowable): void {
    const pos = f.mesh.position.clone();
    f.mesh.dispose();
    this.flying = this.flying.filter((x) => x !== f);

    switch (f.throwable.type) {
      case "frag":
        this.detonateFrag(pos, f.throwable, f.canDealDamage);
        break;
      case "smoke":
        this.detonateSmoke(pos, f.throwable);
        break;
      case "flashbang":
        this.detonateFlashbang(pos, f.throwable, f.canDealDamage);
        break;
      case "flare":
        this.detonateFlare(pos, f.throwable);
        break;
      case "claymore":
        break;
    }
  }

  private placeClaymore(throwable: Throwable, forward: Vector3): void {
    const dir = forward.clone();
    dir.y = 0;
    if (dir.lengthSquared() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const pos = this.player.position.add(dir.scale(1.25));
    pos.y = 0.12;
    const mine = MeshBuilder.CreateBox(`claymore_${Date.now()}`, { width: 0.55, height: 0.28, depth: 0.12 }, this.scene);
    mine.position = pos;
    mine.rotation.y = Math.atan2(dir.x, dir.z);
    const mat = new StandardMaterial("claymoreMat", this.scene);
    mat.diffuseColor = new Color3(0.18, 0.28, 0.12);
    mine.material = mat;
    mine.isPickable = true;
    mine.metadata = {
      isClaymore: true,
      damageable: {
        id: mine.name,
        get isDead() { return mine.isDisposed(); },
        takeDamage: () => {
          mine.dispose();
          this.claymores = this.claymores.filter((m) => m.mesh !== mine);
        },
      },
    };
    const indicator = MeshBuilder.CreateBox(`claymore_front_${Date.now()}`, { width: 0.08, height: 0.08, depth: 0.7 }, this.scene);
    indicator.position = pos.add(dir.scale(0.42)).add(new Vector3(0, 0.08, 0));
    indicator.rotation.y = mine.rotation.y;
    const imat = new StandardMaterial("claymoreIndicatorMat", this.scene);
    imat.diffuseColor = new Color3(0.9, 0.1, 0.05);
    imat.emissiveColor = imat.diffuseColor.scale(0.5);
    indicator.material = imat;
    indicator.parent = mine;
    this.claymores.push({ mesh: mine, forward: dir, rangeM: throwable.radiusM, damage: throwable.damage ?? 180 });
    this.audio.uiClick();
  }

  private detonateFrag(pos: Vector3, throwable: Throwable, canDealDamage: boolean): void {
    this.audio.explosion();
    if (canDealDamage) {
      const kills = this.enemyManager.damageInRadius(pos, throwable.radiusM, throwable.damage ?? 150);
      if (kills > 0) this.onExplosiveKills?.(kills);
      const distToPlayer = Vector3.Distance(pos, this.player.position);
      if (distToPlayer < throwable.radiusM) {
        const dmg = (throwable.damage ?? 150) * (1 - distToPlayer / throwable.radiusM);
        this.player.takeDamage(dmg);
      }
    }
    this.spawnFlashSprite(pos, new Color3(1, 0.6, 0.2), 0.6, 250);
  }

  private detonateSmoke(pos: Vector3, throwable: Throwable): void {
    const smoke = MeshBuilder.CreateSphere(`smoke_${Date.now()}`, { diameter: throwable.radiusM * 2 }, this.scene);
    smoke.position = pos;
    const mat = new StandardMaterial("smokeMat", this.scene);
    mat.diffuseColor = throwable.color ? Color3.FromHexString(throwable.color) : Color3.Gray();
    mat.alpha = 0.55;
    smoke.material = mat;
    // Smoke blocks VISION only, never bullets. It's pickable so the enemy LOS
    // raycast can treat it as an obscurant, and tagged `isSmoke` so the player's
    // shot raycast (and any other bullet ray) explicitly skips it — rounds pass
    // straight through the cloud and hit whatever's on the far side.
    smoke.isPickable = true;
    smoke.checkCollisions = false;
    smoke.metadata = { isSmoke: true };
    // Smoke is the one dynamic sight-blocker, so it can't live in the static
    // ray index — register it as an occluder the AI's LOS test checks directly.
    registerSmokeOccluder(smoke);
    this.smokeVolumes.push({ mesh: smoke, expiresAt: performance.now() + throwable.effectDurationSec * 1000 });
  }

  private detonateFlashbang(pos: Vector3, throwable: Throwable, canDealDamage: boolean): void {
    this.audio.explosion();
    if (canDealDamage) {
      this.enemyManager.stunInRadius(pos, throwable.radiusM, throwable.effectDurationSec);
      const distToPlayer = Vector3.Distance(pos, this.player.position);
      if (distToPlayer < throwable.radiusM) {
        const intensity = 1 - distToPlayer / throwable.radiusM;
        this.onFlashbangScreen?.(intensity);
      }
    }
    this.spawnFlashSprite(pos, Color3.White(), 1.2, 150);
  }

  /**
   * Illumination flare: a visible burning stick + glow halo + rising smoke so
   * landing reads clearly even before the light itself is considered, and a
   * real PointLight that actually lights the surrounding area.
   *
   * World geometry (buildings, roads, ground) uses frozen materials for
   * performance — a material frozen before this light exists never picks it
   * up (same class of bug the weapon flashlight had). admitLightToFrozenWorld
   * re-preps every material once so nearby static surfaces genuinely light up
   * instead of only affecting dynamic actors (player/enemies/BOTTY). This is a
   * rare, bounded cost (paid once per flare thrown, not per frame).
   */
  private detonateFlare(pos: Vector3, throwable: Throwable): void {
    const anchor = pos.add(new Vector3(0, 1, 0));

    // Visible burning stick — a small bright emissive cylinder standing at the
    // landing point, so the flare is obviously "deployed" even at a glance.
    const stick = MeshBuilder.CreateCylinder(`flareStick_${Date.now()}`, { diameter: 0.06, height: 0.5, tessellation: 8 }, this.scene);
    stick.position = pos.add(new Vector3(0, 0.25, 0));
    const stickMat = new StandardMaterial(`flareStickMat_${Date.now()}`, this.scene);
    stickMat.emissiveColor = new Color3(1, 0.55, 0.15);
    stickMat.diffuseColor = Color3.Black();
    stickMat.disableLighting = true;
    stick.material = stickMat;
    stick.isPickable = false;

    // Soft glow halo billboard for bloom pickup, brightest right at the flame.
    const halo = MeshBuilder.CreatePlane(`flareHalo_${Date.now()}`, { size: 2.4 }, this.scene);
    halo.position = anchor;
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.isPickable = false;
    const haloMat = new StandardMaterial(`flareHaloMat_${Date.now()}`, this.scene);
    haloMat.emissiveTexture = this.flareGlowTexture();
    haloMat.opacityTexture = haloMat.emissiveTexture;
    haloMat.diffuseColor = Color3.Black();
    haloMat.disableLighting = true;
    haloMat.emissiveColor = new Color3(1, 0.8, 0.45);
    halo.material = haloMat;

    // The actual illumination — real light, tuned to the throwable's radius.
    const light = new PointLight(`flare_${Date.now()}`, anchor, this.scene);
    light.diffuse = new Color3(1, 0.9, 0.65);
    light.specular = new Color3(0.5, 0.45, 0.3);
    light.intensity = 3.2;
    light.range = throwable.radiusM * 2.2;
    admitLightToFrozenWorld(this.scene);

    // Gentle rising smoke so the flare reads as burning, not just glowing.
    const smoke = new ParticleSystem(`flareSmoke_${Date.now()}`, 40, this.scene);
    smoke.particleTexture = this.flareGlowTexture();
    smoke.emitter = anchor;
    smoke.minEmitBox = new Vector3(-0.05, 0, -0.05);
    smoke.maxEmitBox = new Vector3(0.05, 0.1, 0.05);
    smoke.direction1 = new Vector3(-0.3, 1.5, -0.3);
    smoke.direction2 = new Vector3(0.3, 2.2, 0.3);
    smoke.color1 = new Color4(0.5, 0.45, 0.35, 0.35);
    smoke.color2 = new Color4(0.35, 0.32, 0.28, 0.2);
    smoke.colorDead = new Color4(0.3, 0.3, 0.3, 0);
    smoke.minSize = 0.3;
    smoke.maxSize = 0.8;
    smoke.minLifeTime = 1.2;
    smoke.maxLifeTime = 2.2;
    smoke.emitRate = 12;
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.start();

    // Subtle flicker so the light doesn't read as a flat, static bulb.
    let flickerT = 0;
    const flickerObs = this.scene.onBeforeRenderObservable.add(() => {
      flickerT += this.scene.getEngine().getDeltaTime() / 1000;
      light.intensity = 3.2 + Math.sin(flickerT * 17) * 0.25 + Math.sin(flickerT * 41) * 0.12;
    });

    this.onFlareTriggered?.(pos);
    this.enemyManager.alertAllToPosition(pos);

    setTimeout(() => {
      this.scene.onBeforeRenderObservable.remove(flickerObs);
      light.dispose();
      stick.dispose();
      halo.dispose();
      smoke.stop();
      setTimeout(() => smoke.dispose(), 2500); // let in-flight smoke particles finish fading
    }, throwable.effectDurationSec * 1000);
  }

  /** Small soft radial-gradient sprite shared by every flare's halo + smoke this session. */
  private flareGlowTexture(): DynamicTexture {
    if (this.cachedFlareGlowTex) return this.cachedFlareGlowTex;
    const size = 64;
    const tex = new DynamicTexture("flareGlowTex", { width: size, height: size }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,220,160,0.6)");
    g.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.update();
    tex.hasAlpha = true;
    this.cachedFlareGlowTex = tex;
    return tex;
  }

  private spawnFlashSprite(pos: Vector3, color: Color3, scale: number, ms: number): void {
    const sphere = MeshBuilder.CreateSphere("blastFlash", { diameter: scale }, this.scene);
    sphere.position = pos;
    sphere.isPickable = false;
    const mat = new StandardMaterial("blastFlashMat", this.scene);
    mat.emissiveColor = color;
    mat.disableLighting = true;
    sphere.material = mat;
    setTimeout(() => sphere.dispose(), ms);
  }
}
