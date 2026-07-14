import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, PointLight, Mesh } from "@babylonjs/core";
import { THROWABLES, type Throwable } from "@/data/gamedata";
import type { PlayerController } from "@/player/PlayerController";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { AudioManager } from "@/core/AudioManager";
import type { GameState } from "@/core/GameState";
import type { InputManager } from "@/core/InputManager";

const THROW_SPEED = 16;
const THROW_ARC_UP = 4;
const GRAVITY = -18;

interface FlyingThrowable {
  throwable: Throwable;
  mesh: Mesh;
  velocity: Vector3;
  fuseRemaining: number;
  landed: boolean;
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

  onFlashbangScreen?: (intensity: number) => void;
  onFlareTriggered?: (position: Vector3) => void;

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

    for (const f of this.flying) {
      if (f.landed) continue;
      f.velocity.y += GRAVITY * dt;
      const nextPos = f.mesh.position.add(f.velocity.scale(dt));
      if (nextPos.y <= 0.15) {
        nextPos.y = 0.15;
        f.landed = f.throwable.type !== "frag"; // frag can bounce briefly; others settle
        if (f.throwable.type === "tripflare") {
          this.tripflares.push({ position: nextPos.clone(), radiusM: f.throwable.radiusM, triggered: false });
          f.mesh.dispose();
          this.flying = this.flying.filter((x) => x !== f);
          continue;
        }
      }
      f.mesh.position = nextPos;
      f.fuseRemaining -= dt;
      if (f.fuseRemaining <= 0) this.detonate(f);
    }

    const now = performance.now();
    for (const smoke of this.smokeVolumes) {
      if (now >= smoke.expiresAt) smoke.mesh.dispose();
    }
    this.smokeVolumes = this.smokeVolumes.filter((s) => now < s.expiresAt);

    this.checkTripflareTriggers();
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

  private throwEquipped(): void {
    const throwableId = this.gameState.data.loadout.throwable;
    const throwable = THROWABLES[throwableId];
    if (!throwable) return;
    if (this.gameState.data.loadout.throwableCount <= 0) {
      this.audio.uiClick();
      return;
    }
    this.gameState.data.loadout.throwableCount -= 1;

    const forward = this.player.camera.getDirection(Vector3.Forward());
    const origin = this.player.camera.globalPosition.add(forward.scale(0.6));
    const velocity = forward.scale(THROW_SPEED).add(new Vector3(0, THROW_ARC_UP, 0));

    const mesh = MeshBuilder.CreateSphere(`throwable_${throwable.id}_${Date.now()}`, { diameter: 0.12 }, this.scene);
    mesh.position = origin;
    const mat = new StandardMaterial(`throwableMat_${throwable.id}`, this.scene);
    mat.diffuseColor = throwable.color ? Color3.FromHexString(throwable.color) : new Color3(0.2, 0.25, 0.15);
    mesh.material = mat;
    mesh.isPickable = false;

    this.flying.push({ throwable, mesh, velocity, fuseRemaining: throwable.fuseSec, landed: false });
    this.audio.throwableFuse();
  }

  private detonate(f: FlyingThrowable): void {
    const pos = f.mesh.position.clone();
    f.mesh.dispose();
    this.flying = this.flying.filter((x) => x !== f);

    switch (f.throwable.type) {
      case "frag":
        this.detonateFrag(pos, f.throwable);
        break;
      case "smoke":
        this.detonateSmoke(pos, f.throwable);
        break;
      case "flashbang":
        this.detonateFlashbang(pos, f.throwable);
        break;
      case "flare":
        this.detonateFlare(pos, f.throwable);
        break;
    }
  }

  private detonateFrag(pos: Vector3, throwable: Throwable): void {
    this.audio.explosion();
    this.enemyManager.damageInRadius(pos, throwable.radiusM, throwable.damage ?? 150);
    const distToPlayer = Vector3.Distance(pos, this.player.position);
    if (distToPlayer < throwable.radiusM) {
      const dmg = (throwable.damage ?? 150) * (1 - distToPlayer / throwable.radiusM);
      this.player.takeDamage(dmg);
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
    smoke.isPickable = true; // blocks enemy LOS raycasts
    smoke.checkCollisions = false;
    this.smokeVolumes.push({ mesh: smoke, expiresAt: performance.now() + throwable.effectDurationSec * 1000 });
  }

  private detonateFlashbang(pos: Vector3, throwable: Throwable): void {
    this.audio.explosion();
    this.enemyManager.stunInRadius(pos, throwable.radiusM, throwable.effectDurationSec);
    const distToPlayer = Vector3.Distance(pos, this.player.position);
    if (distToPlayer < throwable.radiusM) {
      const intensity = 1 - distToPlayer / throwable.radiusM;
      this.onFlashbangScreen?.(intensity);
    }
    this.spawnFlashSprite(pos, Color3.White(), 1.2, 150);
  }

  private detonateFlare(pos: Vector3, throwable: Throwable): void {
    const light = new PointLight(`flare_${Date.now()}`, pos.add(new Vector3(0, 1, 0)), this.scene);
    light.diffuse = new Color3(1, 0.95, 0.7);
    light.intensity = 1.5;
    light.range = throwable.radiusM * 2;
    this.onFlareTriggered?.(pos);
    this.enemyManager.alertAllToPosition(pos);
    setTimeout(() => light.dispose(), throwable.effectDurationSec * 1000);
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
