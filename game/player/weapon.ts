import * as THREE from "three";
import type { Engine } from "~/core/engine";
import type { Input } from "~/core/input";
import type { Audio } from "~/core/audio";
import type { Vfx } from "~/gfx/vfx";
import { canvasTex } from "~/gfx/textures";
import type { CollisionWorld } from "~/world/collision";
import type { PlayerController } from "./controller";
import { buildGunMats, buildSar21, type GunMats, type ViewWeapon } from "./sar21";
import { buildBR18, buildFNMAG, buildM110, buildMatador, buildP30, buildUltimax } from "./arsenal";
import { reloadAnim, samplePose, type ReloadPose, type ReloadStyle } from "./reloads";

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

export type WeaponSlot = "primary" | "sidearm" | "launcher";

export interface WeaponDef {
  id: string;
  name: string;
  caliber: string;
  slot: WeaponSlot;
  build(mats: GunMats): ViewWeapon;
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
  /** Sight magnifications, ascending. The mouse wheel steps through them while aiming. */
  zooms: number[];
  /** Index into `zooms` the weapon is issued at. */
  zoomDefault: number;
  reloadTime: number;
  sound: "rifle" | "lmg" | "pistol" | "dmr";
  modes: Array<"auto" | "semi">;
  /** Hip-fire position of the gun origin in camera space. */
  hip: [number, number, number];
  /** Movement speed multiplier while this is in hand. */
  mobility: number;
  /** How far enemies hear a shot, metres. */
  noise: number;
  /** Reticle drawn as a full-screen sight picture at 2× and above (magnified optics). */
  scope?: "mil" | "sar" | "dot";
  /** Fires a rocket instead of a bullet. */
  rocket?: boolean;
  /** Weapon kick scale (viewmodel springs). */
  kick: number;
  /** Bolt / slide travel on each shot, metres. */
  boltTravel: number;
  /** Where the support hand goes for the magazine and for the bolt, relative to its rest. */
  magHand: [number, number, number];
  boltHand: [number, number, number];
  /** Direction the magazine leaves the gun. */
  magOut: [number, number, number];
  /** Reload choreography family. */
  anim: ReloadStyle;
  /** Seconds for a reload from empty (tactical reloads use `reloadTime`). */
  reloadEmpty: number;
  /** Support-hand offset to the feed cover latch (belt-fed). */
  coverHand?: [number, number, number];
  /** Firing-hand offset to a right-side charging handle (belt-fed). */
  rightBolt?: [number, number, number];
  /** How far the charging handle travels when worked, metres. */
  pullLen?: number;
}

export const SAR21: WeaponDef = {
  id: "sar21", name: "SAR 21", caliber: "5.56 × 45 mm", slot: "primary", build: buildSar21,
  magSize: 30, reserve: 150, rpm: 620, damage: 36, falloffStart: 45, falloffEnd: 140, falloffMin: 0.62,
  hipSpread: 2.4, adsSpread: 0.12, recoilPitch: 0.0105, recoilYaw: 0.0042, adsTime: 0.2, zooms: [1.5, 3], zoomDefault: 1, scope: "sar", reloadTime: 2.6,
  sound: "rifle", modes: ["auto", "semi"], hip: [0.135, -0.2, -0.36], mobility: 1, noise: 75, kick: 1, boltTravel: 0.02,
  magHand: [-0.3, -0.12, 0], boltHand: [-0.1, 0.13, -0.03], magOut: [-0.03, -0.3, -0.06],
  anim: "bullpup", reloadEmpty: 3.5,
};

/** The SAF's newer bullpup: shorter, quicker, faster-firing, with a red dot and a 3× magnifier. */
export const BR18: WeaponDef = {
  id: "br18", name: "BR18", caliber: "5.56 × 45 mm", slot: "primary", build: buildBR18,
  magSize: 30, reserve: 180, rpm: 780, damage: 33, falloffStart: 40, falloffEnd: 130, falloffMin: 0.6,
  hipSpread: 2.1, adsSpread: 0.14, recoilPitch: 0.0098, recoilYaw: 0.0048, adsTime: 0.17, zooms: [1.3, 3], zoomDefault: 0, scope: "dot", reloadTime: 2.4,
  sound: "rifle", modes: ["auto", "semi"], hip: [0.13, -0.19, -0.34], mobility: 1.04, noise: 75, kick: 0.95, boltTravel: 0,
  magHand: [-0.29, -0.11, 0], boltHand: [-0.07, 0.02, -0.04], magOut: [-0.03, -0.3, -0.06],
  anim: "bullpup", reloadEmpty: 3.2,
};

/** Section automatic weapon: a hundred rounds, slow to bring up and slow to feed, steady once it is running. */
export const ULTIMAX: WeaponDef = {
  id: "ultimax100", name: "ULTIMAX 100", caliber: "5.56 × 45 mm", slot: "primary", build: buildUltimax,
  magSize: 100, reserve: 200, rpm: 540, damage: 33, falloffStart: 50, falloffEnd: 160, falloffMin: 0.6,
  hipSpread: 3.2, adsSpread: 0.3, recoilPitch: 0.0062, recoilYaw: 0.0038, adsTime: 0.34, zooms: [1.45], zoomDefault: 0, reloadTime: 5.0,
  sound: "lmg", modes: ["auto"], hip: [0.15, -0.15, -0.37], mobility: 0.86, noise: 85, kick: 0.7, boltTravel: 0.0,
  magHand: [-0.16, -0.02, 0.02], boltHand: [-0.15, 0.1, 0.0], magOut: [0, -0.34, -0.05],
  anim: "drum", reloadEmpty: 6.2, pullLen: 0.1,
};

/** Marksman rifle: suppressed 7.62, two torso hits or one to the head at any range on this map. */
export const M110: WeaponDef = {
  id: "m110", name: "M110 SASS", caliber: "7.62 × 51 mm", slot: "primary", build: buildM110,
  magSize: 20, reserve: 80, rpm: 320, damage: 74, falloffStart: 120, falloffEnd: 400, falloffMin: 0.8,
  hipSpread: 3.6, adsSpread: 0.035, recoilPitch: 0.021, recoilYaw: 0.006, adsTime: 0.3, zooms: [4, 7, 10], zoomDefault: 1, reloadTime: 2.8,
  sound: "dmr", modes: ["semi"], hip: [0.15, -0.155, -0.35], mobility: 0.92, noise: 38, scope: "mil", kick: 1.5, boltTravel: 0.03,
  magHand: [-0.18, -0.1, 0.02], boltHand: [-0.2, 0.03, -0.01], magOut: [0.01, -0.3, -0.04],
  anim: "rifle", reloadEmpty: 3.6, pullLen: 0.03,
};

export const P30: WeaponDef = {
  id: "p30", name: "H&K P30", caliber: "9 × 19 mm", slot: "sidearm", build: buildP30,
  magSize: 15, reserve: 60, rpm: 420, damage: 28, falloffStart: 18, falloffEnd: 60, falloffMin: 0.45,
  hipSpread: 1.9, adsSpread: 0.4, recoilPitch: 0.017, recoilYaw: 0.006, adsTime: 0.12, zooms: [1.25], zoomDefault: 0, reloadTime: 1.5,
  sound: "pistol", modes: ["semi"], hip: [0.125, -0.115, -0.42], mobility: 1.06, noise: 60, kick: 1.3, boltTravel: 0.032,
  magHand: [0.0, -0.1, 0.01], boltHand: [-0.02, 0.085, 0.03], magOut: [-0.03, -0.26, 0],
  anim: "pistol", reloadEmpty: 2.1, pullLen: 0.032,
};

export const MATADOR: WeaponDef = {
  id: "matador", name: "MATADOR", caliber: "90 mm HEAT / HESH", slot: "launcher", build: buildMatador,
  magSize: 1, reserve: 2, rpm: 30, damage: 0, falloffStart: 0, falloffEnd: 1, falloffMin: 1,
  hipSpread: 1.2, adsSpread: 0.15, recoilPitch: 0.03, recoilYaw: 0.01, adsTime: 0.36, zooms: [2], zoomDefault: 0, reloadTime: 4.6,
  sound: "lmg", modes: ["semi"], hip: [0.2, -0.17, -0.32], mobility: 0.8, noise: 120, rocket: true, kick: 2.2, boltTravel: 0,
  magHand: [0, 0, 0], boltHand: [0, 0, 0], magOut: [0, 0, 0],
  anim: "tube", reloadEmpty: 4.6,
};

/** General-purpose machine gun: a hundred rounds of 7.62, punishing in a long burst, slow to feed. */
export const FNMAG: WeaponDef = {
  id: "fnmag", name: "FN MAG", caliber: "7.62 × 51 mm", slot: "primary", build: buildFNMAG,
  magSize: 100, reserve: 200, rpm: 720, damage: 50, falloffStart: 80, falloffEnd: 300, falloffMin: 0.75,
  hipSpread: 4.4, adsSpread: 0.4, recoilPitch: 0.0082, recoilYaw: 0.0052, adsTime: 0.46, zooms: [1.4], zoomDefault: 0, reloadTime: 6.4,
  sound: "lmg", modes: ["auto"], hip: [0.15, -0.16, -0.42], mobility: 0.78, noise: 110, kick: 1.15, boltTravel: 0,
  magHand: [-0.11, -0.044, -0.1], boltHand: [0, 0, 0], magOut: [0, -0.3, -0.05],
  anim: "belt", reloadEmpty: 7.2, coverHand: [-0.265, 0.128, 0.01], rightBolt: [0.14, 0.11, 0.03], pullLen: 0.12,
};

export const PRIMARIES: WeaponDef[] = [SAR21, BR18, ULTIMAX, FNMAG, M110];

/** One carried weapon: its model and its own ammunition. */
interface Carried {
  def: WeaponDef;
  gun: ViewWeapon;
  ammo: number;
  reserve: number;
  auto: boolean;
  flash: THREE.Group;
  reticle: THREE.Object3D | null;
  lenses: THREE.Object3D[];
  zoomI: number;
  magHome: THREE.Vector3;
  leftHome: THREE.Vector3;
  rightHome: THREE.Vector3;
  boltHome: THREE.Vector3;
}

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
  /** 0 = hip, 1 = fully aimed. */
  ads = 0;
  reloading = false;
  /** Current cone half-angle in degrees (for the crosshair). */
  spread = 0;
  shotsFired = 0;
  shotsHit = 0;
  enabled = true;
  hipFov = 74;
  onHit?: (part: BodyPart, killed: boolean) => void;
  onShot?: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
  /** A rocket left the tube: the game owns its flight. */
  onRocket?: (origin: THREE.Vector3, dir: THREE.Vector3) => void;
  onSwitch?: (def: WeaponDef) => void;
  /** The trigger was pressed while weapons are safe (inside the patrol base). */
  onSafeTrigger?: () => void;
  private safeBlend = 0;
  private readonly rig = new THREE.Group();
  private readonly mats: GunMats;
  private readonly all = new Map<string, Carried>();
  private slots: Carried[] = [];
  private cur!: Carried;
  private pending: Carried | null = null;
  private readonly flashMat: THREE.Material;
  private cooldown = 0;
  private triggerLatch = false;
  private reloadT = 0;
  private reloadStage = 0;
  private reloadEmpty = false;
  private reloadDur = 1;
  private readonly pose: ReloadPose = samplePose(null, 0, {} as ReloadPose);
  private heat = 0;
  private flashT = 0;
  private boltT = 0;
  private sprintBlend = 0;
  private drawT = 0;
  private readonly kick = new Spring(260, 26);
  private readonly rise = new Spring(190, 22);
  private readonly twist = new Spring(220, 20);
  private swayX = 0;
  private swayY = 0;
  private viewRecover = 0;
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
    this.mats = buildGunMats(engine);
    engine.camera.add(this.rig);
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
    this.flashMat = fm;
    for (const def of [SAR21, BR18, ULTIMAX, FNMAG, M110, P30, MATADOR]) this.all.set(def.id, this.make(def));
    this.slots = [this.all.get("sar21")!, this.all.get("p30")!, this.all.get("matador")!];
    this.cur = this.slots[0];
    this.cur.gun.root.visible = true;
  }

  private make(def: WeaponDef): Carried {
    const gun = def.build(this.mats);
    gun.root.rotation.y = Math.PI / 2;
    gun.root.visible = false;
    this.rig.add(gun.root);
    const flash = new THREE.Group();
    const long = new THREE.PlaneGeometry(0.34, 0.14);
    long.translate(0.15, 0, 0);
    const a = new THREE.Mesh(long, this.flashMat);
    const b = new THREE.Mesh(long, this.flashMat);
    b.rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2).rotateY(Math.PI / 2), this.flashMat);
    face.position.x = 0.03;
    flash.add(a, b, face);
    flash.position.copy(gun.muzzle);
    flash.visible = false;
    for (const m of flash.children) (m as THREE.Mesh).frustumCulled = false;
    gun.root.add(flash);
    const lenses: THREE.Object3D[] = [];
    gun.root.traverse((o) => {
      if (o.name === "lens") lenses.push(o);
    });
    return { zoomI: def.zoomDefault, lenses, def, gun, ammo: def.magSize, reserve: def.reserve, auto: def.modes[0] === "auto", flash, reticle: gun.root.getObjectByName("reticle") ?? null, magHome: gun.magazine.position.clone(), leftHome: gun.leftArm.position.clone(), rightHome: gun.rightArm.position.clone(), boltHome: gun.bolt.position.clone() };
  }

  get def(): WeaponDef {
    return this.cur.def;
  }
  get ammo(): number {
    return this.cur.ammo;
  }
  set ammo(v: number) {
    this.cur.ammo = v;
  }
  get reserve(): number {
    return this.cur.reserve;
  }
  set reserve(v: number) {
    this.cur.reserve = v;
  }
  get auto(): boolean {
    return this.cur.auto;
  }
  get primary(): WeaponDef {
    return this.slots[0].def;
  }
  /** True while a magnified scope picture should replace the viewmodel. */
  get scoped(): boolean {
    return !!this.cur.def.scope && this.ads > 0.86 && this.mag >= 2;
  }
  /** The selected magnification of the sight in hand. */
  get zoom(): number {
    return this.cur.def.zooms[this.cur.zoomI];
  }
  /** Sight picture for the HUD while scoped. */
  get scopeView(): { style: "mil" | "sar" | "dot"; mag: number; breath: number } | null {
    return this.scoped ? { style: this.cur.def.scope!, mag: this.zoom, breath: this.breath } : null;
  }
  /** Magnification actually on screen right now (eases between steps and from the hip). */
  private mag = 1;
  /** Hold-breath reserve, 0..1, and whether it is being spent. */
  breath = 1;
  private holding = false;
  private swayT = 0;
  private readonly aimOff = new THREE.Vector2();

  /**
   * Scope sway: a slow figure-of-eight scaled by magnification and steadied by stance. Holding
   * Shift while scoped holds the breath (about four seconds) to almost still the reticle.
   * Returns a pitch/yaw offset the camera adds; the bullet follows the camera, so it is honest.
   */
  aimSway(dt: number): THREE.Vector2 {
    const scoped = this.ads > 0.6 && this.mag >= 2;
    this.holding = scoped && this.breath > 0.02 && (this.input.held("ShiftLeft") || this.input.held("ShiftRight"));
    this.breath = this.holding ? Math.max(0, this.breath - dt / 4) : Math.min(1, this.breath + dt / (this.breath < 0.05 ? 5 : 2.5));
    const winded = this.breath < 0.05 && !this.holding ? 1.8 : 1;
    this.swayT += dt * (this.holding ? 0.35 : 1);
    const p = this.player;
    const stance = p.stance === "prone" ? 0.3 : p.stance === "crouch" ? 0.65 : 1;
    const amp = scoped ? 0.00045 * this.mag * stance * winded * (this.holding ? 0.12 : 1) * sm(this.ads) : 0;
    const t = this.swayT;
    this.aimOff.set(Math.sin(t * 1.1) * Math.cos(t * 0.37) * amp, Math.sin(t * 0.55 + 1.3) * amp * 1.3);
    return this.aimOff;
  }
  /** 1-based slot numbers that hold a weapon, with the active one, for the HUD. */
  get slotIndex(): number {
    return this.slots.indexOf(this.pending ?? this.cur);
  }
  get slotNames(): string[] {
    return this.slots.map((c) => c.def.name);
  }

  /** Issue a different primary (at the armoury). Ammunition is drawn full. */
  setPrimary(id: string): void {
    const c = this.all.get(id);
    if (!c || c.def.slot !== "primary" || c === this.slots[0]) return;
    const wasCur = this.cur === this.slots[0];
    this.slots[0] = c;
    c.ammo = c.def.magSize;
    c.reserve = c.def.reserve;
    if (wasCur) this.swap(c);
  }

  select(slot: number): void {
    const c = this.slots[slot];
    if (!c || c === this.cur || c === this.pending) return;
    this.swap(c);
  }

  private swap(c: Carried): void {
    this.pending = c;
    this.reloading = false;
    this.audio.foley("cloth");
  }

  /** Refill everything carried (patrol base ammunition point). */
  restock(): void {
    for (const c of this.slots) {
      c.ammo = c.def.magSize;
      c.reserve = c.def.reserve;
    }
  }

  get stocked(): boolean {
    return this.slots.every((c) => c.ammo >= c.def.magSize && c.reserve >= c.def.reserve);
  }

  reset(): void {
    for (const c of this.all.values()) {
      c.ammo = c.def.magSize;
      c.reserve = c.def.reserve;
      c.gun.root.visible = false;
    }
    this.cur = this.slots[0];
    this.cur.gun.root.visible = true;
    this.pending = null;
    this.ads = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.heat = 0;
    this.drawT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
  }

  /** Show every carried and stowed weapon at once (shader warm-up only). */
  showAll(on: boolean): void {
    for (const c of this.all.values()) c.gun.root.visible = on ? true : c === this.cur;
  }

  setVisible(v: boolean): void {
    this.rig.visible = v;
  }

  /** Field resupply: `rounds` is in rifle rounds; other weapons get a proportional share. */
  addAmmo(rounds: number): void {
    for (const c of this.slots) {
      const share = c.def.rocket ? 1 : Math.round((rounds / 150) * c.def.reserve);
      c.reserve = Math.min(c.def.reserve + (c.def.rocket ? 0 : c.def.magSize), c.reserve + share);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const inp = this.input;
    const p = this.player;
    this.cooldown -= dt;
    // Holster the old weapon, then bring the new one up.
    if (this.pending) {
      this.drawT -= dt / 0.22;
      if (this.drawT <= 0) {
        this.cur.gun.root.visible = false;
        this.cur.flash.visible = false;
        this.cur = this.pending;
        this.pending = null;
        this.cur.gun.root.visible = true;
        this.drawT = 0;
        this.heat = 0;
        this.audio.foley("raise");
        this.onSwitch?.(this.cur.def);
      }
    } else this.drawT = Math.min(1, this.drawT + dt / (0.36 / Math.min(1.1, this.cur.def.mobility)));
    const d = this.cur.def;
    const gun = this.cur.gun;
    const active = this.enabled && this.drawT >= 1 && !this.pending;

    if (!this.reloading) {
      if (inp.hit("Digit1")) this.select(0);
      else if (inp.hit("Digit2")) this.select(1);
      else if (inp.hit("Digit3")) this.select(2);
      else if (inp.wheel !== 0 && this.ads > 0.5 && d.zooms.length > 1) {
        // Aiming: the wheel works the sight's magnification instead of changing weapons.
        const next = Math.max(0, Math.min(d.zooms.length - 1, this.cur.zoomI + (inp.wheel < 0 ? 1 : -1)));
        if (next !== this.cur.zoomI) {
          this.cur.zoomI = next;
          this.audio.ui("hover");
        }
      } else if (inp.wheel !== 0 && this.ads < 0.5) this.select((this.slots.indexOf(this.pending ?? this.cur) + (inp.wheel > 0 ? 1 : this.slots.length - 1)) % this.slots.length);
    }
    if (inp.hit("KeyV") && d.modes.length > 1) {
      this.cur.auto = !this.cur.auto;
      this.audio.dryFire();
    }
    // Aiming always wins over sprinting: the controller drops the sprint the moment this is set.
    const wantAim = active && inp.held("Mouse2") && !this.reloading;
    p.aiming = wantAim;
    this.ads += ((wantAim ? 1 : 0) - this.ads) * Math.min(1, dt / (d.adsTime * 0.45));
    if (Math.abs(this.ads - (wantAim ? 1 : 0)) < 0.002) this.ads = wantAim ? 1 : 0;
    const e = sm(this.ads);
    p.moveScale = (1 - 0.42 * e) * d.mobility;
    this.sprintBlend += ((p.sprinting ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * (p.sprinting ? 9 : 14));

    // ---- firing ---------------------------------------------------------------
    const trigger = inp.held("Mouse0");
    if (!trigger) this.triggerLatch = false;
    // Pulling the trigger mid-sprint breaks the sprint; the shot follows as the weapon comes up.
    if (trigger && active) p.sprintLock = 0.3;
    if (trigger && !this.enabled && inp.hit("Mouse0")) {
      this.audio.dryFire();
      this.onSafeTrigger?.();
    }
    this.safeBlend += ((this.enabled ? 0 : 1) - this.safeBlend) * Math.min(1, dt * 7);
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
    this.spread = THREE.MathUtils.lerp(d.hipSpread * (0.55 + move * 0.9 + (p.onGround ? 0 : 1.2)) * (p.stance === "prone" ? 0.5 : p.stance === "crouch" ? 0.7 : 1), d.adsSpread * (p.stance === "prone" ? 0.6 : 1) * (1 + move * 2), e) + this.heat * THREE.MathUtils.lerp(0.22, 0.03, e);

    // ---- reload timeline ------------------------------------------------------
    let rp = 0; // 0..1 through the reload
    const anim = this.reloading ? reloadAnim(d.anim, this.reloadEmpty) : null;
    if (anim) {
      this.reloadT += dt;
      rp = this.reloadT / this.reloadDur;
      while (this.reloadStage < anim.sounds.length && rp >= anim.sounds[this.reloadStage][0]) this.audio.foley(anim.sounds[this.reloadStage++][1]);
      if (rp >= 1) {
        const need = d.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
        rp = 0;
      }
    }
    const q = samplePose(this.reloading ? anim : null, rp, this.pose);
    const c = this.cur;
    const pull = d.pullLen ?? 0.05;
    // Magazine (or belt bag): out along its own axis, rolled for drums.
    gun.magazine.position.set(c.magHome.x + q.mag * d.magOut[0], c.magHome.y + q.mag * d.magOut[1], c.magHome.z + q.mag * d.magOut[2]);
    gun.magazine.rotation.z = q.magRz;
    gun.magazine.visible = q.mag < 2.3;
    // Support hand: blend of rest, magazine, carried magazine, pouch, charging handle and cover latch.
    const ch = d.coverHand ?? [0, 0, 0];
    gun.leftArm.position.set(
      c.leftHome.x + q.hMag * d.magHand[0] + q.hFollow * q.mag * d.magOut[0] + q.hBolt * d.boltHand[0] + q.hCover * ch[0] - q.hAway * 0.1 - q.hBolt * q.pull * pull,
      c.leftHome.y + q.hMag * d.magHand[1] + q.hFollow * q.mag * d.magOut[1] + q.hBolt * d.boltHand[1] + q.hCover * ch[1] - q.hAway * 0.3 + q.hCover * q.cover * 0.08,
      c.leftHome.z + q.hMag * d.magHand[2] + q.hFollow * q.mag * d.magOut[2] + q.hBolt * d.boltHand[2] + q.hCover * ch[2] - q.hAway * 0.04
    );
    const rb = d.rightBolt ?? [0, 0, 0];
    gun.rightArm.position.set(c.rightHome.x + q.rBolt * rb[0] - q.rBolt * q.pull * pull, c.rightHome.y + q.rBolt * rb[1], c.rightHome.z + q.rBolt * rb[2]);
    if (gun.cover) gun.cover.rotation.z = -q.cover * 1.15;
    if (gun.belt) {
      gun.belt.position.set(0, q.belt * 0.05, -q.belt * 0.03);
      gun.belt.visible = q.mag < 2.3 || q.belt < 0.5;
    }
    this.boltT = Math.max(0, this.boltT - dt * 16);
    const locked = this.reloading ? q.lock : d.boltTravel > 0 && c.ammo === 0 ? 1 : 0;
    gun.bolt.position.x = c.boltHome.x - q.pull * pull - this.boltT * d.boltTravel - locked * d.boltTravel;

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
    // Weapons safe: carried low and canted, the same lowered pose as a sprint.
    const s = Math.max(this.sprintBlend, this.safeBlend * 0.85);

    const draw = 1 - sm(this.drawT);

    const [hx, hy, hz] = d.hip;
    const ax = -gun.sight.z, ay = -gun.sight.y, az = gun.sight.x + 0.012;
    this.rig.position.set(
      THREE.MathUtils.lerp(hx, ax, e) + bobX + this.swayX * sway * 0.6 - s * 0.055 + q.px + p.lean * 0.012,
      THREE.MathUtils.lerp(hy, ay, e) + bobY + breathe - this.swayY * sway * 0.5 - s * 0.045 + q.py - p.landed * 0.035 - draw * 0.24 + Math.max(-0.02, Math.min(0.02, p.vel.y * -0.004)),
      THREE.MathUtils.lerp(hz, az, e) + kick * (1 - e * 0.45) + s * 0.03 + q.pz
    );
    this.rig.rotation.set(
      rise * (1 - e * 0.55) + this.swayY * sway * 0.9 - s * 0.16 + q.rx + draw * 0.9 + breathe * 2,
      (1 - e) * 0.035 + this.swayX * sway * 1.4 + twist + s * 0.62 + q.ry,
      (1 - e) * -0.045 + twist * 0.8 + this.swayX * sway * 1.8 - s * 0.22 + q.rz - p.lean * 0.1 + bobX * 2.5
    );
    if (c.reticle) c.reticle.visible = e > 0.85;
    for (const l of c.lenses) l.visible = e < 0.5;
    // Looking through a magnified scope: the HUD draws the sight picture, so the model steps aside.
    gun.root.visible = !this.scoped;

    this.flashT -= dt;
    c.flash.visible = this.flashT > 0 && !this.scoped;
    // Field of view from true magnification: at N× the view is N times narrower in tangent terms.
    this.mag += (THREE.MathUtils.lerp(1, d.zooms[c.zoomI], e) - this.mag) * Math.min(1, dt * 14);
    const base = this.hipFov + this.sprintBlend * 5;
    this.engine.setFov(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) / this.mag)));
  }

  /** Look sensitivity scale for the current zoom. */
  get lookScale(): number {
    // Scale turn rate with magnification so the crosshair covers the same ground per mouse-inch.
    const zoom = Math.tan(THREE.MathUtils.degToRad(this.engine.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(this.hipFov) / 2);
    return THREE.MathUtils.lerp(1, Math.min(0.85, zoom * 1.15), sm(this.ads));
  }

  private startReload(): void {
    if (this.reloading || this.pending || this.ammo >= this.def.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.reloadEmpty = this.ammo === 0 && !this.def.rocket;
    this.reloadDur = this.reloadEmpty ? this.def.reloadEmpty : this.def.reloadTime;
    this.audio.foley("cloth");
  }

  private fire(): void {
    const d = this.def;
    const gun = this.cur.gun;
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

    gun.root.updateWorldMatrix(true, false);
    _muzzle.copy(gun.muzzle);
    gun.root.localToWorld(_muzzle);
    if (d.rocket) {
      // Backblast and launch; the rocket itself is flown by the game.
      const back = _tmp.copy(gun.eject);
      gun.root.localToWorld(back);
      this.vfx.muzzle(back, _dir.clone().negate(), 3.2, true);
      for (let i = 0; i < 5; i++) this.vfx.smokePuff(back.clone().addScaledVector(_dir, -0.8 - i * 0.9), 0.9 + i * 0.3, 0.5);
      this.vfx.muzzle(_muzzle, _dir, 2, true);
      this.vfx.flashLight(_muzzle, 120, 0.12);
      this.audio.shot("lmg");
      this.audio.explosion(_muzzle.x, _muzzle.y, _muzzle.z, 0.45);
      this.kick.v += 4;
      this.rise.v += 3;
      this.player.pitch += d.recoilPitch;
      this.viewRecover += d.recoilPitch * 0.8;
      this.onRocket?.(_muzzle.clone(), _dir.clone());
      this.onShot?.(_origin.clone(), _dir.clone());
      if (this.reserve > 0) this.startReload();
      return;
    }
    const wHit = this.world.raycast(_origin, _dir, 500);
    const tHit = this.targets.raycast(_origin, _dir, wHit ? wHit.distance : 500);
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
    const quiet = d.id === "m110";
    this.cur.flash.rotation.x = Math.random() * Math.PI;
    this.cur.flash.scale.setScalar((0.8 + Math.random() * 0.5) * (quiet ? 0.25 : d.sound === "pistol" ? 0.6 : d.sound === "lmg" ? 1.15 : 1));
    this.boltT = 1;
    this.vfx.muzzle(_muzzle, _dir, 1, false);
    if (!quiet) this.vfx.flashLight(_muzzle, 26, 0.06);
    this.audio.shot(d.sound);
    const ej = _tmp.copy(gun.eject);
    gun.root.localToWorld(ej);
    const floor = this.world.floor(ej.x, ej.z, ej.y, 4);
    this.vfx.shell(ej, new THREE.Vector3().copy(_right).multiplyScalar(2.2 + Math.random()).addScaledVector(_up, 1.4 + Math.random()).addScaledVector(_fwd, -0.4).add(this.player.vel), floor ? floor.y : this.player.pos.y);

    // Recoil: weapon springs plus a climbing view.
    const stance = this.player.stance === "prone" ? 0.5 : this.player.stance === "crouch" ? 0.75 : 1;
    this.kick.v += 1.5 * d.kick;
    this.rise.v += 2.1 * stance * d.kick;
    this.twist.v += (Math.random() - 0.5) * 1.6;
    const climb = d.recoilPitch * (0.75 + Math.random() * 0.5) * stance * (1 + Math.min(1, this.heat / 8) * 0.5);
    this.player.pitch += climb;
    this.player.yaw += (Math.random() - 0.5) * 2 * d.recoilYaw * stance;
    this.viewRecover += climb * 0.55;
    this.heat = Math.min(12, this.heat + 1);
    this.onShot?.(_origin.clone(), _dir.clone());
  }
}
