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
import { ZONE_MULTIPLIER, type HitMeshMetadata, type HitZone } from "@/weapons/Damageable";
import type { ScopeOverlay } from "@/ui/ScopeOverlay";

const BASE_FOV = 1.1;
/** Optics at or above this zoom get the real windowed scope lens instead of just a centred in-world sight. */
const SCOPE_ZOOM_THRESHOLD = 1.3;

interface AmmoState {
  mag: number;
  reserve: number;
}

export interface WeaponControllerCallbacks {
  onFire?: (weapon: Weapon) => void;
  onHit?: (damage: number, isHeadshot: boolean) => void;
  onKill?: (targetId: string, weaponClass: string) => void;
  onReloadStart?: (weapon: Weapon) => void;
  onReloadEnd?: (weapon: Weapon) => void;
  onEmptyClick?: () => void;
  onSecondaryFire?: (weapon: Weapon, effective: EffectiveStats) => void;
  /** Fired for every damaging hit so the HUD can pop a floating damage number. */
  onDamageNumber?: (worldPos: Vector3, amount: number, zone: HitZone) => void;
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
  private swayTime = 0;
  bipodDeployed = false;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly gameState: GameState,
    private readonly enemyManager: EnemyManager,
    private readonly callbacks: WeaponControllerCallbacks = {},
    private readonly scopeOverlay?: ScopeOverlay
  ) {
    this.weapon = WEAPONS.sar21;
    this.effective = computeEffectiveStats(this.weapon, []);
  }

  private secondaryFireCooldown = 0;

  get ammo(): AmmoState {
    return this.ammoByWeapon.get(this.weapon.id)!;
  }

  /** True once the physical scope lens has taken over the view — HUD hides its 2D crosshair then. */
  get isScopedIn(): boolean {
    return this.effective.zoom >= SCOPE_ZOOM_THRESHOLD && this.adsBlend > 0.5;
  }

  /** Current bullet-spread cone in degrees, factoring in movement/airborne/stance — what the crosshair should actually reflect. */
  get currentSpreadDegrees(): number {
    return (this.computeSpreadRadians() * 180) / Math.PI;
  }

  /** A resupply/ammo box never leaves the player holding more than this many launcher (MATADOR) charges. */
  static readonly MAX_LAUNCHER_CHARGES = 2;

  /** Supply-crate ammo pickup: tops up every weapon whose ammo state has already been touched this run. */
  resupplyAmmo(amount: number): void {
    for (const [id, state] of this.ammoByWeapon.entries()) {
      const weapon = WEAPONS[id];
      if (weapon?.isProjectile) {
        // The MATADOR is limited-carry: an ammo box tops the player up to at most
        // 2 total charges (mag + reserve), never a full-blown stockpile.
        const total = Math.min(
          WeaponController.MAX_LAUNCHER_CHARGES,
          state.mag + state.reserve + amount
        );
        state.reserve = Math.max(0, total - state.mag);
      } else {
        state.reserve += amount;
      }
    }
  }

  /** Total remaining charges (mag + reserve) for a weapon touched this run — the HUD reads this for the MATADOR. */
  chargesFor(weaponId: string): number {
    const state = this.ammoByWeapon.get(weaponId);
    return state ? state.mag + state.reserve : 0;
  }

  /** Full resupply on spawn/redeploy: every touched weapon gets a full mag and full reserve back. */
  resetAllAmmo(): void {
    for (const weaponId of this.ammoByWeapon.keys()) {
      const weapon = WEAPONS[weaponId];
      if (!weapon) continue;
      const effective = computeEffectiveStats(weapon, this.gameState.getFittedAttachments(weaponId));
      this.ammoByWeapon.set(weaponId, { mag: effective.magSize, reserve: weapon.reserveAmmo });
    }
    this.isReloading = false;
    this.reloadTimer = 0;
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
    this.player.breakSpawnProtection();
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

    const isScope = this.effective.zoom >= SCOPE_ZOOM_THRESHOLD;
    // Red-dot / holo optics: a little magnification but not a full scope. They
    // get a screen-space red-dot reticle and hide the occluding sight housing.
    const isReflex = !isScope && this.effective.zoom >= 1.05;

    // A plain FOV narrow for every optic, scoped or not — a normal perspective
    // view stays undistorted (no lens-disc/fisheye artefacts) and gives a fast,
    // responsive scope-in feel. Scoped optics additionally show the circular
    // vignette + reticle overlay for the "looking through glass" read.
    const targetFov = BASE_FOV / (1 + (this.effective.zoom - 1) * this.adsBlend);
    this.player.camera.fov = targetFov;

    // Higher-power scopes feel less twitchy to aim with, like real optics — scale
    // mouse sensitivity down with zoom while aiming, blending back to normal at hip.
    const aimSens = wantsAim ? 1 / Math.sqrt(Math.max(1, this.effective.zoom)) : 1;
    this.player.aimSensitivityMult = 1 + (aimSens - 1) * this.adsBlend;

    // Subtle idle weapon sway while aiming — purely visual (the hitscan ray still
    // fires from the camera's exact look direction), fades in with ADS blend so it
    // never affects hip-fire and never throws off where the reticle is pointing.
    this.swayTime += dt;
    // Reduced from the original amplitude — enough to feel handheld and alive
    // without the sight visibly wandering off the target while aiming.
    const swayScale = 0.0018 * this.adsBlend;
    const swayX = Math.sin(this.swayTime * 1.3) * swayScale;
    const swayY = Math.cos(this.swayTime * 0.9) * swayScale * 0.6;

    this.scopeOverlay?.update(isScope ? "scope" : isReflex ? "reddot" : "none", this.adsBlend);

    if (this.activeViewmodel) {
      const hip = new Vector3(0.18, -0.16, 0.35);
      // Solve for the root position that puts the sight/optic at screen centre.
      const sight = this.activeViewmodel.sightOffset;
      const ads = new Vector3(-sight.x + swayX, -sight.y + swayY, 0.28 - sight.z);
      this.activeViewmodel.root.position = Vector3.Lerp(hip, ads, this.adsBlend);

      if (isScope) {
        // The lens disc takes over the view once mostly aimed in, so the whole
        // viewmodel (not just the bulky body) hides rather than clipping through it.
        this.activeViewmodel.root.setEnabled(this.adsBlend < 0.5);
      } else {
        this.activeViewmodel.root.setEnabled(true);
        // Hide the bulky body/barrel/mag once mostly aimed in — at ADS proximity + optic
        // zoom, the full gun body would otherwise loom into frame as a giant dark block.
        const showBody = this.adsBlend < 0.6;
        for (const mesh of this.activeViewmodel.bodyMeshes) mesh.setEnabled(showBody);
        // For red-dot/holo optics, also hide the sight housing once mostly aimed
        // in — the screen-space red dot replaces it, so the optic can no longer
        // block the target. Iron sights (no optic) keep their sight visible.
        const showSight = !(isReflex && this.adsBlend >= 0.55);
        for (const mesh of this.activeViewmodel.sightMeshes) mesh.setEnabled(showSight);
      }
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

    // Simple reload "animation": dip the weapon down and bring it back up over the
    // reload duration (no skeleton/rig to work with, so this is a stand-in for a
    // real lower-mag-insert-raise sequence).
    if (this.activeViewmodel) {
      const progress = 1 - Math.max(0, this.reloadTimer) / Math.max(0.01, this.effective.reloadTimeSec);
      const dip = Math.sin(Math.min(1, progress) * Math.PI) * 0.09;
      this.activeViewmodel.root.position.y -= dip;
    }

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
    // Faster recovery than the raw per-shot kick accumulates, so sustained fire
    // settles back onto the sight picture instead of climbing frame over frame.
    const recoveryRad = this.weapon.recoil.recovery * 0.03 * dt;
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

    this.player.breakSpawnProtection();
    this.player.markFired(); // muzzle flash + report gives the player's position away to nearby AI
    this.ammo.mag -= 1;
    this.fireCooldown = 60 / this.weapon.fireRateRpm;
    this.audio.gunshot(this.effective.suppressed);
    this.callbacks.onFire?.(this.weapon);
    this.spawnMuzzleFlash();

    const hearingRangeM = this.effective.suppressed ? 15 : 9999;
    this.enemyManager.broadcastGunshot(this.player.camera.globalPosition, hearingRangeM);

    // Fire the shot FIRST, from the exact aim direction, THEN apply recoil — so
    // the round always leaves through the centre of the optic (the reticle dot)
    // before the muzzle climbs, rather than a hair above it.
    if (this.weapon.isProjectile) {
      this.fireProjectileFromMuzzle(MATADOR_BLAST, this.weapon.muzzleVelocityMps, this.weapon.effectiveRangeM);
    } else {
      this.raycastShot();
    }

    this.applyRecoil();
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
    fireProjectile(this.scene, origin, direction, speedMps, maxRangeM, blast, this.enemyManager, this.player, this.audio, !this.player.inSafeZone);
  }

  private applyRecoil(): void {
    // Tuned down from the original values — muzzle climb and horizontal jitter
    // stayed readable shot-to-shot but added up to a wandering, unpredictable
    // group over a full mag. This keeps recoil present but smooth/controllable.
    const bipodMult = this.bipodDeployed ? 0.25 : 1;
    const kick = this.effective.recoilVertical * 0.0045 * bipodMult;
    this.player.camera.rotation.x -= kick;
    this.recoilKickPitch += kick;

    const jitter = (Math.random() * 2 - 1) * this.effective.recoilHorizontal * 0.0035 * bipodMult;
    this.player.addYaw(jitter);
  }

  private computeSpreadRadians(): number {
    const stationary = !this.player.isMoving && this.player.grounded;

    // ADS + fully stationary + grounded = pinpoint accuracy. The shot goes
    // through the exact centre of the optic (screen centre / the reticle dot)
    // with ZERO cone, so precision aiming is fully rewarded. Only movement or
    // leaving the ground opens the group up while aimed in — never a standing
    // aimed shot.
    if (this.isAiming && stationary) return 0;

    let base: number;
    if (this.isAiming) {
      // Aimed but moving: still tight, just not laser-perfect.
      base = this.effective.spreadAds * 0.22;
    } else {
      // Hip-fire: one flat, predictable baseline that is clearly worse than ADS
      // so spread is only ever noticeable from the hip.
      base = this.effective.spreadHip * 0.85;
    }

    // Movement adds a little spread; it bites much less while aiming.
    const moveExtra =
      this.player.isMoving && !this.bipodDeployed
        ? this.weapon.spread.movePenalty * (this.isAiming ? 0.3 : 0.8)
        : 0;
    // Leaving the ground (jumping/falling) throws aim off hard, same as most shooters.
    const airborneExtra = this.player.grounded
      ? 0
      : this.weapon.spread.movePenalty * (this.isAiming ? 1.1 : 1.8) + (this.isAiming ? 0.5 : 1.2);
    // Crouching or standing fully still tightens the group; bipod (handled below) supersedes this.
    const crouchMult = this.player.crouching && !this.bipodDeployed ? 0.55 : 1;
    const bipodMult = this.bipodDeployed ? 0.25 : 1;
    return ((base + moveExtra + airborneExtra) * crouchMult * bipodMult * Math.PI) / 180;
  }

  private raycastShot(): void {
    const camera = this.player.camera;
    const spreadRad = this.computeSpreadRadians();
    // Uniform sampling over a disk (not an independent-axis square) so the actual
    // worst-case miss angle matches the weapon's spread stat exactly instead of
    // overshooting by up to sqrt(2)x at the corners.
    const angle = Math.random() * Math.PI * 2;
    const radiusFrac = Math.sqrt(Math.random());
    const randYaw = Math.cos(angle) * spreadRad * radiusFrac;
    const randPitch = Math.sin(angle) * spreadRad * radiusFrac;

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
      // Firing from inside the safe zone can't deal damage — the shot still draws
      // and impacts visually, it just never hurts anything.
      if (meta?.damageable && !meta.damageable.isDead && !this.player.inSafeZone) {
        const distance = pick.distance;
        const dmg = damageAtRange(this.effective.damage, distance, this.weapon.falloff);
        // Zone multipliers: head keeps the weapon's own headshot bonus (>= 2.0×),
        // body 1.5×, limbs 1.0×. Any hit on an enemy always deals damage.
        const zone: HitZone = meta.hitZone ?? (meta.isHeadshotMesh ? "head" : "body");
        const isHeadshot = zone === "head";
        const zoneMult = zone === "head" ? this.weapon.headshotMultiplier : ZONE_MULTIPLIER[zone];
        const finalDmg = dmg * zoneMult;
        meta.damageable.takeDamage(finalDmg, isHeadshot, origin);
        meta.onImpact?.(pick.pickedPoint.clone(), zone);
        this.audio.hitmarker();
        if (isHeadshot) this.audio.headshot();
        this.callbacks.onHit?.(finalDmg, isHeadshot);
        this.callbacks.onDamageNumber?.(pick.pickedPoint.clone(), finalDmg, zone);
        if (meta.damageable.isDead) this.callbacks.onKill?.(meta.damageable.id, this.weapon.class);
        this.spawnImpactEffect(pick.pickedPoint, true);
      } else {
        this.audio.impact();
        this.spawnImpactEffect(pick.pickedPoint, false);
      }
    } else {
      this.drawTracer(muzzleWorld, origin.add(worldDir.scale(200)));
    }
  }

  // Shared, created-once FX materials. Building a fresh StandardMaterial for
  // every shot/impact forced a material-compile check + dirty-flag pass per
  // bullet — at 600rpm auto fire that shows up as frame hitches. One material
  // per effect kind, reused by every short-lived FX mesh, removes that cost.
  private fxMats: { flash?: StandardMaterial; sparkWorld?: StandardMaterial; sparkFlesh?: StandardMaterial } = {};

  private fxMat(kind: "flash" | "sparkWorld" | "sparkFlesh"): StandardMaterial {
    let mat = this.fxMats[kind];
    if (!mat) {
      mat = new StandardMaterial(`fx_${kind}`, this.scene);
      mat.emissiveColor =
        kind === "flash" ? new Color3(1, 0.75, 0.3) : kind === "sparkFlesh" ? new Color3(0.6, 0.05, 0.05) : new Color3(0.9, 0.75, 0.4);
      mat.disableLighting = true;
      mat.freeze();
      this.fxMats[kind] = mat;
    }
    return mat;
  }

  /** Quick spark/blood-tint flash at the bullet's impact point — world hits vs flesh hits read differently. */
  private spawnImpactEffect(position: Vector3, isFlesh: boolean): void {
    const spark = MeshBuilder.CreateDisc("impactSpark", { radius: 0.05, tessellation: 6 }, this.scene);
    spark.position = position.clone();
    spark.billboardMode = 7; // BILLBOARDMODE_ALL
    spark.isPickable = false;
    spark.material = this.fxMat(isFlesh ? "sparkFlesh" : "sparkWorld");
    setTimeout(() => spark.dispose(), 90);
  }

  private spawnMuzzleFlash(): void {
    if (this.effective.suppressed || !this.activeViewmodel) return;
    // No flash once the sight picture is what matters: fully suppressed through
    // the scope lens, and skipped entirely once mostly aimed in on ANY optic
    // (and in any stance, including crouched) so it can never sit over the
    // reticle/housing. Bullet trajectory is unaffected — the shot rays from the
    // camera centre regardless of the flash.
    if (this.isScopedIn) return;
    if (this.adsBlend > 0.7) return;
    // Small and brief, and smaller still while partway into ADS.
    const radius = 0.034 * (1 - 0.55 * this.adsBlend);
    const flash = MeshBuilder.CreateDisc("muzzleFlash", { radius, tessellation: 6 }, this.scene);
    flash.parent = this.activeViewmodel.muzzle;
    // Nudged slightly down/forward of the bore so it blooms below the optic axis.
    flash.position = new Vector3(0, -0.01 * this.adsBlend, 0.01);
    flash.billboardMode = 7; // BILLBOARDMODE_ALL
    flash.isPickable = false;
    flash.material = this.fxMat("flash");
    setTimeout(() => flash.dispose(), 28);
  }

  private drawTracer(from: Vector3, to: Vector3): void {
    const line: LinesMesh = MeshBuilder.CreateLines("tracer", { points: [from, to] }, this.scene);
    line.color = new Color3(1, 0.9, 0.6);
    line.isPickable = false;
    setTimeout(() => line.dispose(), 50);
  }
}
