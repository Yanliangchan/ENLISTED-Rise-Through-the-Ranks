import { Scene, Vector3, Matrix, MeshBuilder, StandardMaterial, Color3, LinesMesh, Ray } from "@babylonjs/core";
import type { Weapon } from "@/data/weapons";
import { WEAPONS } from "@/data/weapons";
import { MATADOR_BLAST, M203_BLAST } from "@/data/gamedata";
import { computeEffectiveStats, damageAtRange, type EffectiveStats } from "@/weapons/ballistics";
import { buildViewmodel, type Viewmodel } from "@/weapons/ViewmodelFactory";
import { fireProjectile } from "@/weapons/Projectile";
import type { PlayerController } from "@/player/PlayerController";
import type { InputManager } from "@/core/InputManager";
import type { AudioManager } from "@/core/AudioManager";
import type { GameState } from "@/core/GameState";
import type { EnemyManager } from "@/enemies/EnemySpawner";
import type { HitMeshMetadata } from "@/weapons/Damageable";

const BASE_FOV = 1.1;

interface AmmoState {
  mag: number;
  reserve: number;
}

export interface WeaponControllerCallbacks {
  onFire?: (weapon: Weapon) => void;
  onHit?: (damage: number, isHeadshot: boolean) => void;
  onKill?: (targetId: string) => void;
  onReloadStart?: (weapon: Weapon) => void;
  onReloadEnd?: (weapon: Weapon) => void;
  onEmptyClick?: () => void;
  onSecondaryFire?: (weapon: Weapon, effective: EffectiveStats) => void;
}

/**
 * Owns the currently-equipped weapon's runtime state: ammo, fire timing,
 * recoil, spread, ADS, reload — all derived from `weapons.ts` + fitted
 * attachment deltas (`ballistics.ts`). Renders a low-poly viewmodel and
 * fires hitscan rays against anything tagged with `Damageable` metadata.
 */
export class WeaponController {
  private ammoByWeapon = new Map<string, AmmoState>();
  private viewmodelCache = new Map<string, Viewmodel>();
  private activeViewmodel: Viewmodel | null = null;

  weapon: Weapon;
  effective: EffectiveStats;

  isAiming = false;
  private adsBlend = 0; // 0 = hip, 1 = fully aimed
  isReloading = false;
  private reloadTimer = 0;
  private fireCooldown = 0;
  private recoilKickPitch = 0; // accumulated upward kick still to recover
  bipodDeployed = false;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly gameState: GameState,
    private readonly enemyManager: EnemyManager,
    private readonly callbacks: WeaponControllerCallbacks = {}
  ) {
    this.weapon = WEAPONS.sar21;
    this.effective = computeEffectiveStats(this.weapon, []);
  }

  private secondaryFireCooldown = 0;

  get ammo(): AmmoState {
    return this.ammoByWeapon.get(this.weapon.id)!;
  }

  equip(weaponId: string): void {
    const weapon = WEAPONS[weaponId];
    if (!weapon) return;
    this.weapon = weapon;
    this.effective = computeEffectiveStats(weapon, this.gameState.getFittedAttachments(weaponId));
    this.isReloading = false;
    this.reloadTimer = 0;
    this.isAiming = false;
    this.adsBlend = 0;
    this.bipodDeployed = false;
    this.player.weaponSpeedMult = this.effective.moveSpeedMult;

    if (!this.ammoByWeapon.has(weaponId)) {
      this.ammoByWeapon.set(weaponId, { mag: this.effective.magSize, reserve: weapon.reserveAmmo });
    }

    this.showViewmodel(weapon);
  }

  /** Re-derive effective stats after attachments change without losing ammo state. */
  refreshAttachments(): void {
    this.effective = computeEffectiveStats(this.weapon, this.gameState.getFittedAttachments(this.weapon.id));
    this.player.weaponSpeedMult = this.effective.moveSpeedMult;
  }

  private showViewmodel(weapon: Weapon): void {
    if (this.activeViewmodel) this.activeViewmodel.root.setEnabled(false);
    let vm = this.viewmodelCache.get(weapon.id);
    if (!vm) {
      vm = buildViewmodel(weapon, this.scene);
      vm.root.parent = this.player.camera;
      vm.root.position = new Vector3(0.18, -0.16, 0.35);
      this.viewmodelCache.set(weapon.id, vm);
    }
    vm.root.setEnabled(true);
    this.activeViewmodel = vm;
  }

  setViewmodelVisible(visible: boolean): void {
    this.activeViewmodel?.root.setEnabled(visible);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.updateAds(dt);
    this.updateReload(dt);
    this.updateRecoilRecovery(dt);
    this.updateFireInput(dt);
    this.updateSecondaryFireInput(dt);
    this.bipodDeployed = this.effective.hasBipod && this.player.crouching && this.player.grounded;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.secondaryFireCooldown > 0) this.secondaryFireCooldown -= dt;
  }

  private updateSecondaryFireInput(_dt: number): void {
    if (!this.effective.hasGrenadeLauncher) return;
    if (this.secondaryFireCooldown > 0) return;
    if (!this.input.wasPressed("KeyH")) return;
    this.secondaryFireCooldown = 1.5;
    this.audio.gunshot(true);
    this.fireProjectileFromMuzzle(M203_BLAST, 80, 500);
    this.callbacks.onSecondaryFire?.(this.weapon, this.effective);
  }

  private updateAds(dt: number): void {
    const wantsAim = this.input.rightMouseDown && !this.isReloading;
    this.isAiming = wantsAim;
    const target = wantsAim ? 1 : 0;
    const rate = 1 / Math.max(0.05, this.effective.adsTimeSec);
    this.adsBlend += (target - this.adsBlend) * Math.min(1, rate * dt);

    const targetFov = BASE_FOV / (1 + (this.effective.zoom - 1) * this.adsBlend);
    this.player.camera.fov = targetFov;

    if (this.activeViewmodel) {
      const hip = new Vector3(0.18, -0.16, 0.35);
      // Solve for the root position that puts the sight/optic at screen centre.
      const sight = this.activeViewmodel.sightOffset;
      const ads = new Vector3(-sight.x, -sight.y, 0.28 - sight.z);
      this.activeViewmodel.root.position = Vector3.Lerp(hip, ads, this.adsBlend);

      // Hide the bulky body/barrel/mag once mostly aimed in — at ADS proximity + optic
      // zoom, the full gun body would otherwise loom into frame as a giant dark block.
      const showBody = this.adsBlend < 0.6;
      for (const mesh of this.activeViewmodel.bodyMeshes) mesh.setEnabled(showBody);
    }
  }

  private updateReload(dt: number): void {
    if (!this.isReloading) {
      if (
        this.input.wasPressed("KeyR") &&
        this.ammo.mag < this.effective.magSize &&
        this.ammo.reserve > 0
      ) {
        this.startReload();
      }
      return;
    }
    this.reloadTimer -= dt;
    if (this.reloadTimer <= 0) {
      const needed = this.effective.magSize - this.ammo.mag;
      const loaded = Math.min(needed, this.ammo.reserve);
      this.ammo.mag += loaded;
      this.ammo.reserve -= loaded;
      this.isReloading = false;
      this.callbacks.onReloadEnd?.(this.weapon);
    }
  }

  private startReload(): void {
    this.isReloading = true;
    this.reloadTimer = this.effective.reloadTimeSec;
    this.audio.reload();
    this.callbacks.onReloadStart?.(this.weapon);
  }

  private updateRecoilRecovery(dt: number): void {
    if (this.recoilKickPitch <= 0) return;
    const recoveryRad = this.weapon.recoil.recovery * 0.01 * dt;
    const step = Math.min(this.recoilKickPitch, recoveryRad);
    this.player.camera.rotation.x += step;
    this.recoilKickPitch -= step;
  }

  private updateFireInput(_dt: number): void {
    if (this.isReloading) return;
    const canFire = this.weapon.fireModes.some((m) => m !== "safe");
    if (!canFire) return;
    this.handleTrigger(this.weapon.fireModes.includes("auto"));
  }

  private firedThisPress = false;

  private handleTrigger(isAuto: boolean): void {
    const held = this.input.leftMouseDown;
    if (!held) {
      this.firedThisPress = false;
      return;
    }
    if (this.fireCooldown > 0) return;

    if (isAuto || !this.firedThisPress) {
      this.fire();
      this.firedThisPress = true;
    }
  }

  private fire(): void {
    if (this.ammo.mag <= 0) {
      this.callbacks.onEmptyClick?.();
      if (this.ammo.reserve > 0) {
        this.startReload(); // auto-reload on an empty trigger pull
      } else {
        this.audio.uiClick();
      }
      this.fireCooldown = 0.2;
      return;
    }

    this.ammo.mag -= 1;
    this.fireCooldown = 60 / this.weapon.fireRateRpm;
    this.audio.gunshot(this.effective.suppressed);
    this.callbacks.onFire?.(this.weapon);
    this.spawnMuzzleFlash();
    this.applyRecoil();

    const hearingRangeM = this.effective.suppressed ? 15 : 9999;
    this.enemyManager.broadcastGunshot(this.player.camera.globalPosition, hearingRangeM);

    if (this.weapon.isProjectile) {
      this.fireProjectileFromMuzzle(MATADOR_BLAST, this.weapon.muzzleVelocityMps, this.weapon.effectiveRangeM);
    } else {
      this.raycastShot();
    }
  }

  private fireProjectileFromMuzzle(
    blast: { radiusM: number; centreDamage: number; edgeDamage: number },
    speedMps: number,
    maxRangeM: number
  ): void {
    const camera = this.player.camera;
    const direction = camera.getDirection(Vector3.Forward());
    const origin = this.activeViewmodel
      ? this.activeViewmodel.muzzle.getAbsolutePosition()
      : camera.globalPosition;
    fireProjectile(this.scene, origin, direction, speedMps, maxRangeM, blast, this.enemyManager, this.player, this.audio);
  }

  private applyRecoil(): void {
    const bipodMult = this.bipodDeployed ? 0.25 : 1;
    const kick = this.effective.recoilVertical * 0.012 * bipodMult;
    this.player.camera.rotation.x -= kick;
    this.recoilKickPitch += kick;

    const jitter = (Math.random() * 2 - 1) * this.effective.recoilHorizontal * 0.01 * bipodMult;
    this.player.addYaw(jitter);
  }

  private computeSpreadRadians(): number {
    const base = this.isAiming ? this.effective.spreadAds : this.effective.spreadHip;
    const moveExtra = this.player.isMoving && !this.bipodDeployed ? this.weapon.spread.movePenalty : 0;
    const bipodMult = this.bipodDeployed ? 0.25 : 1;
    return ((base + moveExtra) * bipodMult * Math.PI) / 180;
  }

  private raycastShot(): void {
    const camera = this.player.camera;
    const spreadRad = this.computeSpreadRadians();
    const randYaw = (Math.random() * 2 - 1) * spreadRad;
    const randPitch = (Math.random() * 2 - 1) * spreadRad;

    const localDir = Vector3.TransformCoordinates(
      new Vector3(0, 0, 1),
      Matrix.RotationYawPitchRoll(randYaw, randPitch, 0)
    );
    const worldDir = Vector3.TransformNormal(localDir, camera.getWorldMatrix()).normalize();
    const origin = camera.globalPosition.clone();

    const ray = new Ray(origin, worldDir, 1000);
    const pick = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable);

    const muzzleWorld = this.activeViewmodel
      ? this.activeViewmodel.muzzle.getAbsolutePosition()
      : origin;

    if (pick?.hit && pick.pickedPoint) {
      this.drawTracer(muzzleWorld, pick.pickedPoint);
      const meta = pick.pickedMesh?.metadata as HitMeshMetadata | undefined;
      if (meta?.damageable && !meta.damageable.isDead) {
        const distance = pick.distance;
        const dmg = damageAtRange(this.effective.damage, distance, this.weapon.falloff);
        const isHeadshot = !!meta.isHeadshotMesh;
        const finalDmg = isHeadshot ? dmg * this.weapon.headshotMultiplier : dmg;
        meta.damageable.takeDamage(finalDmg, isHeadshot, origin);
        this.audio.hitmarker();
        if (isHeadshot) this.audio.headshot();
        this.callbacks.onHit?.(finalDmg, isHeadshot);
        if (meta.damageable.isDead) this.callbacks.onKill?.(meta.damageable.id);
      }
    } else {
      this.drawTracer(muzzleWorld, origin.add(worldDir.scale(200)));
    }
  }

  private spawnMuzzleFlash(): void {
    if (this.effective.suppressed || !this.activeViewmodel) return;
    const flash = MeshBuilder.CreateDisc("muzzleFlash", { radius: 0.06, tessellation: 6 }, this.scene);
    flash.parent = this.activeViewmodel.muzzle;
    flash.position = Vector3.Zero();
    flash.billboardMode = 7; // BILLBOARDMODE_ALL
    flash.isPickable = false;
    const mat = new StandardMaterial("muzzleFlashMat", this.scene);
    mat.emissiveColor = new Color3(1, 0.75, 0.3);
    mat.disableLighting = true;
    flash.material = mat;
    setTimeout(() => flash.dispose(), 45);
  }

  private drawTracer(from: Vector3, to: Vector3): void {
    const line: LinesMesh = MeshBuilder.CreateLines("tracer", { points: [from, to] }, this.scene);
    line.color = new Color3(1, 0.9, 0.6);
    line.isPickable = false;
    setTimeout(() => line.dispose(), 50);
  }
}
