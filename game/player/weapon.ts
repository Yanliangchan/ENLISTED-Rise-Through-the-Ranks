import * as THREE from "three";
import type { Engine } from "~/core/engine";
import type { Input } from "~/core/input";
import type { Audio } from "~/core/audio";
import type { Vfx } from "~/gfx/vfx";
import { canvasTex } from "~/gfx/textures";
import type { CollisionWorld } from "~/world/collision";
import type { PlayerController } from "./controller";
import { buildGunMats, buildSar21, type ViewWeapon } from "./sar21";

export type BodyPart = "head" | "torso" | "limb";

export interface TargetHit {
  dist: number;
  point: THREE.Vector3;
  part: BodyPart;
  /** Apply damage; returns true if this killed the target. */
  apply(damage: number, dir: THREE.Vector3): boolean;
}

/** Anything that can be shot: implemented by the soldier manager. */
export interface TargetProvider {
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): TargetHit | null;
}

export interface WeaponDef {
  id: string;
  name: string;
  caliber: string;
  magSize: number;
  reserve: number;
  rpm: number;
  damage: number;
  /** Damage multiplier at and beyond `falloffEnd` metres. */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  hipSpread: number;
  adsSpread: number;
  recoilPitch: number;
  recoilYaw: number;
  adsTime: number;
  adsFov: number;
  reloadTime: number;
  sound: "rifle" | "lmg" | "pistol";
}

export const SAR21: WeaponDef = {
  id: "sar21",
  name: "SAR 21",
  caliber: "5.56 × 45 mm",
  magSize: 30,
  reserve: 150,
  rpm: 620,
  damage: 36,
  falloffStart: 45,
  falloffEnd: 140,
  falloffMin: 0.62,
  hipSpread: 2.4,
  adsSpread: 0.12,
  recoilPitch: 0.0105,
  recoilYaw: 0.0042,
  adsTime: 0.2,
  adsFov: 50,
  reloadTime: 2.9,
  sound: "rifle",
};

const sm = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
/** Piecewise keyframe curve with eased segments: [[time, value], ...]. */
function kf(t: number, keys: number[][]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * sm((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/** Damped spring used for recoil and sway. */
class Spring {
  x = 0;
  v = 0;
  constructor(private readonly k: number, private readonly c: number) {}
  step(dt: number): number {
    const a = -this.k * this.x - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * The player's weapon: firing, ballistics, ammunition, reloads and the
 * entire first-person presentation (aim-down-sights, sway, bob, recoil,
 * sprint and reload poses). All motion is procedural, driven by springs and
 * a keyframed reload timeline, layered on a single rig under the camera.
 */
export class WeaponSystem {
  readonly def = SAR21;
  ammo: number;
  reserve: number;
  /** 0 = hip, 1 = fully aimed. */
  ads = 0;
  reloading = false;
  auto = true;
  /** Current cone half-angle in degrees (for the crosshair). */
  spread = 0;
  shotsFired = 0;
  shotsHit = 0;
  enabled = true;
  hipFov = 74;
  onHit?: (part: BodyPart, killed: boolean) => void;
  onShot?: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
  private readonly rig = new THREE.Group();
  private readonly gun: ViewWeapon;
  private readonly flash: THREE.Group;
  private readonly reticle: THREE.Object3D;
  private cooldown = 0;
  private triggerLatch = false;
  private reloadT = 0;
  private reloadStage = 0;
  private heat = 0;
  private flashT = 0;
  private sprintBlend = 0;
  private drawT = 0;
  private readonly kick = new Spring(260, 26);
  private readonly rise = new Spring(190, 22);
  private readonly twist = new Spring(220, 20);
  private swayX = 0;
  private swayY = 0;
  private viewRecover = 0;
  private readonly magHome = new THREE.Vector3();
  private readonly leftHome = new THREE.Vector3();
  private readonly boltHome = new THREE.Vector3();
  private time = 0;

  constructor(
    private readonly engine: Engine,
    private readonly input: Input,
    private readonly player: PlayerController,
    private readonly world: CollisionWorld,
    private readonly vfx: Vfx,
    private readonly audio: Audio,
    private readonly targets: TargetProvider
  ) {
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserve;
    this.gun = buildSar21(buildGunMats(engine));
    this.gun.root.rotation.y = Math.PI / 2;
    this.rig.add(this.gun.root);
    engine.camera.add(this.rig);
    this.reticle = this.gun.root.getObjectByName("reticle")!;
    this.magHome.copy(this.gun.magazine.position);
    this.leftHome.copy(this.gun.leftArm.position);
    this.boltHome.copy(this.gun.bolt.position);

    // Muzzle flash: three crossed additive cards, shown for a frame or two per shot.
    const tex = canvasTex(128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 62);
      g.addColorStop(0, "rgba(255,250,230,1)");
      g.addColorStop(0.25, "rgba(255,210,130,0.85)");
      g.addColorStop(0.6, "rgba(255,140,50,0.3)");
      g.addColorStop(1, "rgba(255,120,40,0)");
      c.fillStyle = g;
      c.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r = i % 2 ? 22 + Math.random() * 10 : 46 + Math.random() * 16;
        c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      c.fill();
    });
    const fm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, color: new THREE.Color(3.2, 2.5, 1.6) });
    fm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n  gl_Position.z = (gl_Position.z / gl_Position.w * 0.04 - 0.96) * gl_Position.w;");
    };
    this.flash = new THREE.Group();
    const long = new THREE.PlaneGeometry(0.34, 0.14);
    long.translate(0.15, 0, 0);
    const a = new THREE.Mesh(long, fm);
    const b = new THREE.Mesh(long, fm);
    b.rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2).rotateY(Math.PI / 2), fm);
    face.position.x = 0.03;
    this.flash.add(a, b, face);
    this.flash.position.copy(this.gun.muzzle);
    this.flash.visible = false;
    for (const m of this.flash.children) (m as THREE.Mesh).frustumCulled = false;
    this.gun.root.add(this.flash);
  }

  reset(): void {
    this.ammo = this.def.magSize;
    this.reserve = this.def.reserve;
    this.reloading = false;
    this.reloadT = 0;
    this.heat = 0;
    this.drawT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
  }

  setVisible(v: boolean): void {
    this.rig.visible = v;
  }

  addAmmo(rounds: number): void {
    this.reserve = Math.min(this.def.reserve + this.def.magSize * 2, this.reserve + rounds);
  }

  update(dt: number): void {
    this.time += dt;
    const d = this.def;
    const inp = this.input;
    const p = this.player;
    this.cooldown -= dt;
    this.drawT = Math.min(1, this.drawT + dt / 0.45);
    const active = this.enabled && this.drawT >= 1;

    if (inp.hit("KeyV")) {
      this.auto = !this.auto;
      this.audio.dryFire();
    }
    const wantAim = active && inp.held("Mouse2") && !this.reloading && !p.sprinting;
    p.aiming = wantAim;
    this.ads += ((wantAim ? 1 : 0) - this.ads) * Math.min(1, dt / (d.adsTime * 0.45));
    if (Math.abs(this.ads - (wantAim ? 1 : 0)) < 0.002) this.ads = wantAim ? 1 : 0;
    const e = sm(this.ads);
    p.moveScale = 1 - 0.42 * e;
    this.sprintBlend += ((p.sprinting ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 9);

    // ---- firing ---------------------------------------------------------------
    const trigger = inp.held("Mouse0");
    if (!trigger) this.triggerLatch = false;
    if (active && trigger && this.cooldown <= 0 && !this.reloading && this.sprintBlend < 0.35) {
      if (this.ammo > 0 && (this.auto || !this.triggerLatch)) this.fire();
      else if (this.ammo === 0 && !this.triggerLatch) {
        this.audio.dryFire();
        this.startReload();
      }
      this.triggerLatch = true;
    }
    if (active && inp.hit("KeyR")) this.startReload();
    this.heat = Math.max(0, this.heat - dt * 5);
    const move = Math.min(1, p.speed / 4);
    this.spread = THREE.MathUtils.lerp(d.hipSpread * (0.55 + move * 0.9 + (p.onGround ? 0 : 1.2)) * (p.stance === "crouch" ? 0.7 : 1), d.adsSpread * (1 + move * 2), e) + this.heat * THREE.MathUtils.lerp(0.22, 0.03, e);

    // ---- reload timeline ------------------------------------------------------
    let rp = 0; // 0..1 through the reload
    if (this.reloading) {
      this.reloadT += dt;
      rp = this.reloadT / d.reloadTime;
      const stages: Array<[number, () => void]> = [
        [0.16, () => this.audio.foley("magOut")],
        [0.5, () => this.audio.foley("magIn")],
        [0.72, () => this.audio.foley("bolt")],
      ];
      while (this.reloadStage < stages.length && rp >= stages[this.reloadStage][0]) stages[this.reloadStage++][1]();
      if (rp >= 1) {
        const need = d.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
        rp = 0;
      }
    }
    // Magazine drops out and a fresh one comes up with the left hand.
    const magDrop = kf(rp, [[0.14, 0], [0.3, 1], [0.36, 1], [0.5, 0], [1, 0]]);
    this.gun.magazine.position.set(this.magHome.x - magDrop * 0.03, this.magHome.y - magDrop * 0.3, this.magHome.z - magDrop * 0.06);
    const toMag = kf(rp, [[0.02, 0], [0.14, 1], [0.52, 1], [0.6, 0], [1, 0]]);
    const toBolt = kf(rp, [[0.58, 0], [0.68, 1], [0.8, 1], [0.92, 0], [1, 0]]);
    const boltPull = kf(rp, [[0.68, 0], [0.74, 1], [0.78, 0], [1, 0]]);
    this.gun.leftArm.position.set(
      this.leftHome.x + toMag * -0.3 + toBolt * -0.1 - boltPull * 0.05 - magDrop * 0.03 * toMag,
      this.leftHome.y + toMag * -0.12 - magDrop * 0.3 * toMag + toBolt * 0.13,
      this.leftHome.z + toMag * 0.0 - magDrop * 0.06 * toMag + toBolt * -0.03
    );
    this.gun.bolt.position.x = this.boltHome.x - boltPull * 0.05 - (this.flashT > 0 ? 0.02 : 0);

    // ---- springs ---------------------------------------------------------------
    const kick = this.kick.step(dt);
    const rise = this.rise.step(dt);
    const twist = this.twist.step(dt);
    // Part of the view climb settles back on its own.
    if (this.viewRecover > 0) {
      const back = Math.min(this.viewRecover, dt * (0.06 + this.viewRecover * 6));
      p.pitch -= back;
      this.viewRecover -= back;
    }

    // ---- compose the rig pose ---------------------------------------------------
    const sway = 1 - e * 0.82;
    this.swayX += (-inp.mouseDX * 0.00016 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (inp.mouseDY * 0.00016 - this.swayY) * Math.min(1, dt * 9);
    const phase = (p.stride / 1.55) * Math.PI;
    const amp = (0.0045 + this.sprintBlend * 0.012) * Math.min(1, p.speed / 3.5) * (1 - e * 0.86);
    const bobX = Math.sin(phase) * amp * 1.4;
    const bobY = -Math.abs(Math.cos(phase)) * amp * 1.6 + amp;
    const breathe = Math.sin(this.time * 1.25) * 0.0011 * (1 - e * 0.5);
    const s = this.sprintBlend;
    const reloadTilt = kf(rp, [[0, 0], [0.1, 1], [0.84, 1], [1, 0]]);
    const draw = 1 - sm(this.drawT);

    const hx = 0.135, hy = -0.2, hz = -0.36;
    const ax = 0, ay = -this.gun.sight.y, az = this.gun.sight.x + 0.012;
    this.rig.position.set(
      THREE.MathUtils.lerp(hx, ax, e) + bobX + this.swayX * sway * 0.6 - s * 0.055 + reloadTilt * 0.012 + p.lean * 0.012,
      THREE.MathUtils.lerp(hy, ay, e) + bobY + breathe - this.swayY * sway * 0.5 - s * 0.045 - reloadTilt * 0.045 - p.landed * 0.035 - draw * 0.24 + Math.max(-0.02, Math.min(0.02, p.vel.y * -0.004)),
      THREE.MathUtils.lerp(hz, az, e) + kick * (1 - e * 0.45) + s * 0.03 + reloadTilt * 0.02
    );
    this.rig.rotation.set(
      rise * (1 - e * 0.55) + this.swayY * sway * 0.9 - s * 0.16 + reloadTilt * 0.32 + draw * 0.9 + breathe * 2,
      (1 - e) * 0.035 + this.swayX * sway * 1.4 + twist + s * 0.62 - reloadTilt * 0.12,
      (1 - e) * -0.045 + twist * 0.8 + this.swayX * sway * 1.8 - s * 0.22 - reloadTilt * 0.42 - p.lean * 0.1 + bobX * 2.5
    );
    this.reticle.visible = e > 0.85;

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.engine.setFov(THREE.MathUtils.lerp(this.hipFov + this.sprintBlend * 5, d.adsFov, e));
  }

  /** Look sensitivity scale for the current zoom. */
  get lookScale(): number {
    return THREE.MathUtils.lerp(1, 0.62, sm(this.ads));
  }

  private startReload(): void {
    if (this.reloading || this.ammo >= this.def.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.audio.foley("cloth");
  }

  private fire(): void {
    const d = this.def;
    const cam = this.engine.camera;
    this.ammo--;
    this.shotsFired++;
    this.cooldown = 60 / d.rpm;
    const e = sm(this.ads);

    cam.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, cam.up).normalize();
    _up.crossVectors(_right, _fwd).normalize();
    // Uniform sample inside the spread cone.
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * THREE.MathUtils.degToRad(this.spread);
    _dir.copy(_fwd).addScaledVector(_right, Math.cos(ang) * Math.tan(rad)).addScaledVector(_up, Math.sin(ang) * Math.tan(rad)).normalize();
    cam.getWorldPosition(_origin);

    const wHit = this.world.raycast(_origin, _dir, 500);
    const tHit = this.targets.raycast(_origin, _dir, wHit ? wHit.distance : 500);
    this.gun.root.updateWorldMatrix(true, false);
    _muzzle.copy(this.gun.muzzle);
    this.gun.root.localToWorld(_muzzle);
    let end: THREE.Vector3;
    if (tHit) {
      end = tHit.point;
      let dmg = d.damage * THREE.MathUtils.lerp(1, d.falloffMin, sm((tHit.dist - d.falloffStart) / (d.falloffEnd - d.falloffStart)));
      dmg *= tHit.part === "head" ? 3.4 : tHit.part === "limb" ? 0.72 : 1;
      const killed = tHit.apply(dmg, _dir);
      this.shotsHit++;
      this.vfx.blood(tHit.point, _tmp.copy(_dir).multiplyScalar(-0.4));
      this.audio.hitFlesh(tHit.point.x, tHit.point.y, tHit.point.z);
      this.audio.hitmarker(killed, tHit.part === "head");
      this.onHit?.(tHit.part, killed);
    } else if (wHit) {
      end = wHit.point;
      this.vfx.impact(wHit.point, wHit.normal, wHit.surf);
      this.audio.impact(wHit.surf, wHit.point.x, wHit.point.y, wHit.point.z);
    } else {
      end = _tmp.copy(_origin).addScaledVector(_dir, 300).clone();
    }
    if (this.shotsFired % 3 === 0 || e < 0.5) this.vfx.tracer(_muzzle, end, 480);

    // Presentation.
    this.flashT = 0.045;
    this.flash.rotation.x = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.vfx.muzzle(_muzzle, _dir, 1, false);
    this.vfx.flashLight(_muzzle, 26, 0.06);
    this.audio.shot(d.sound);
    const ej = _tmp.copy(this.gun.eject);
    this.gun.root.localToWorld(ej);
    const floor = this.world.floor(ej.x, ej.z, ej.y, 4);
    this.vfx.shell(ej, new THREE.Vector3().copy(_right).multiplyScalar(2.2 + Math.random()).addScaledVector(_up, 1.4 + Math.random()).addScaledVector(_fwd, -0.4).add(this.player.vel), floor ? floor.y : this.player.pos.y);

    // Recoil: weapon springs plus a climbing view.
    const stance = this.player.stance === "crouch" ? 0.75 : 1;
    this.kick.v += 1.5;
    this.rise.v += 2.1 * stance;
    this.twist.v += (Math.random() - 0.5) * 1.6;
    const climb = d.recoilPitch * (0.75 + Math.random() * 0.5) * stance * (1 + Math.min(1, this.heat / 8) * 0.5);
    this.player.pitch += climb;
    this.player.yaw += (Math.random() - 0.5) * 2 * d.recoilYaw * stance;
    this.viewRecover += climb * 0.55;
    this.heat = Math.min(12, this.heat + 1);
    this.onShot?.(_origin.clone(), _dir.clone());
  }
}
