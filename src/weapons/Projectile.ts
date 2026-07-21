import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Ray } from "@babylonjs/core";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";

export interface BlastSpec {
  radiusM: number;
  centreDamage: number;
  edgeDamage: number;
}

/**
 * Slow travel-time projectile for `isProjectile` weapons (MATADOR) and the
 * M203 underbarrel HE — flies at `muzzleVelocityMps`, detonates on impact
 * (or after `maxRangeM`) using a linear centre→edge blast falloff.
 */
export function fireProjectile(
  scene: Scene,
  origin: Vector3,
  direction: Vector3,
  speedMps: number,
  maxRangeM: number,
  blast: BlastSpec,
  enemyManager: EnemyManager,
  player: PlayerController,
  audio: AudioManager,
  /** False when fired from inside the safe zone — the projectile still flies and detonates visually, it just can't hurt anything. */
  canDealDamage = true,
  /** m/s² downward acceleration — 0 (default) keeps the old flat-trajectory rocket; >0 gives a real ballistic arc (the M203). */
  gravityMps2 = 0,
  /** Fired with the number of enemies killed by the detonation — feeds the EOD badge track (M203/MATADOR). */
  onKills?: (count: number) => void
): void {
  const mesh = MeshBuilder.CreateSphere("projectile", { diameter: 0.12 }, scene);
  mesh.position = origin.clone();
  mesh.isPickable = false;
  const mat = new StandardMaterial("projectileMat", scene);
  mat.emissiveColor = new Color3(0.9, 0.5, 0.1);
  mesh.material = mat;

  const velocity = direction.scale(speedMps);
  let travelled = 0;
  const step = () => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    if (gravityMps2 > 0) velocity.y -= gravityMps2 * dt;
    const moveDist = velocity.length() * dt;
    const moveDir = velocity.normalizeToNew();
    const ray = new Ray(mesh.position, moveDir, moveDist + 0.2);
    const pick = scene.pickWithRay(ray, (m) => m.isPickable && m !== mesh);

    if (pick?.hit && pick.pickedPoint && pick.distance <= moveDist) {
      detonate(pick.pickedPoint);
      return;
    }

    mesh.position.addInPlace(velocity.scale(dt));
    travelled += moveDist;
    if (travelled >= maxRangeM || mesh.position.y <= 0) {
      detonate(mesh.position.clone());
      return;
    }
    requestAnimationFrame(step);
  };

  const detonate = (at: Vector3) => {
    mesh.dispose();
    audio.explosion();
    if (canDealDamage) {
      const kills = enemyManager.damageInRadius(at, blast.radiusM, blast.centreDamage);
      if (kills > 0) onKills?.(kills);
      const distToPlayer = Vector3.Distance(at, player.position);
      if (distToPlayer < blast.radiusM) {
        const t = distToPlayer / blast.radiusM;
        player.takeDamage(blast.centreDamage * (1 - t) + blast.edgeDamage * t);
      }
    }
    const flash = MeshBuilder.CreateSphere("blastFlash", { diameter: 1.2 }, scene);
    flash.position = at;
    flash.isPickable = false;
    const flashMat = new StandardMaterial("blastFlashMat", scene);
    flashMat.emissiveColor = new Color3(1, 0.6, 0.2);
    flashMat.disableLighting = true;
    flash.material = flashMat;
    setTimeout(() => flash.dispose(), 200);
  };

  requestAnimationFrame(step);
}
