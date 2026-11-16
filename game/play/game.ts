import * as THREE from "three";
import { Engine, type Quality } from "~/core/engine";
import { Input } from "~/core/input";
import { Audio } from "~/core/audio";
import { buildMaterials } from "~/gfx/materials";
import { Vfx } from "~/gfx/vfx";
import { buildEstate, PLAY, type Fire } from "~/world/estate";
import { CAMP, CAMP_AMMO, CAMP_SENTRIES, CAMP_SPAWN } from "~/world/kit/camp";
import { SoldierModel, soldierMaterials, type Pose } from "~/ai/soldierModel";
import { camoTexture } from "~/player/sar21";
import { CollisionWorld } from "~/world/collision";
import { bakeLight } from "~/world/lightbake";
import { PlayerController } from "~/player/controller";
import { WeaponSystem } from "~/player/weapon";
import { NavGrid } from "~/ai/nav";
import { Soldiers, type AiTarget } from "~/ai/soldiers";
import { Api, type MatchResult } from "~/net/api";
import { Hud } from "~/ui/hud";
import { Menus, loadSettings, type Mode, type Settings } from "~/ui/menus";
import { installStyle } from "~/ui/style";
import { Holdout, Operation, type Mission, type MissionHost } from "./mission";

type State = "menu" | "playing" | "paused" | "ending" | "debrief";

interface Grenade {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  fuse: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _eye = new THREE.Vector3();

/** Slow camera moves used behind the main menu. */
const FLYBY: Array<{ from: [number, number, number]; to: [number, number, number]; yaw: number; pitch: number }> = [
  { from: [5.5, 1.7, 62], to: [3.5, 1.9, 40], yaw: 0.1, pitch: 0.06 },
  { from: [-24, 7, 30], to: [-16, 6, 22], yaw: -0.9, pitch: -0.22 },
  { from: [-30, 1.6, 78], to: [-44, 1.6, 70], yaw: 1.1, pitch: 0.12 },
  { from: [16, 3.2, -30], to: [10, 2.6, -16], yaw: 2.9, pitch: -0.05 },
];

export class Game implements MissionHost {
  readonly engine: Engine;
  readonly input: Input;
  readonly audio = new Audio();
  readonly vfx: Vfx;
  readonly world: CollisionWorld;
  readonly nav: NavGrid;
  readonly player: PlayerController;
  readonly weapon: WeaponSystem;
  readonly soldiers: Soldiers;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly api = new Api();
  readonly settings: Settings;
  state: State = "menu";
  mission: Mission | null = null;
  mode: Mode = "operation";
  hp = 100;
  nades = 2;
  kills = 0;
  headshots = 0;
  explosiveKills = 0;
  score = 0;
  playTime = 0;
  frames = 0;
  private sinceHit = 99;
  private flash = 0;
  private suppress = 0;
  private shake = 0;
  private endT = 0;
  private holdT = 0;
  private menuT = 0;
  private menuShot = 0;
  private moteT = 0;
  private readonly grenades: Grenade[] = [];
  private readonly fires: Fire[];
  private fireT = 0;
  private smokeT = 0;
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly anim: Array<(t: number, dt: number) => void>;
  private readonly sentries: Array<{ model: SoldierModel; pose: Pose; yaw: number }> = [];
  private worldT = 0;
  /** True while the player is inside the patrol base. */
  inCamp = false;
  private grace = 0;
  private readonly nadeGeo = new THREE.SphereGeometry(0.045, 10, 8);
  private readonly nadeMat: THREE.Material;
  private last = performance.now();
  private readonly target: AiTarget;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, forceQuality?: Quality) {
    installStyle();
    this.settings = loadSettings();
    if (forceQuality) this.settings.quality = forceQuality;
    this.engine = new Engine(canvas, { sunAzimuth: 128, sunElevation: 26, cloudCover: 0.5 }, this.settings.quality);
    this.input = new Input(canvas);
    const tA = performance.now();
    const lib = buildMaterials(this.engine);
    const tB = performance.now();
    const estate = buildEstate(this.engine, lib);
    const tC = performance.now();
    this.world = new CollisionWorld(estate.ctx.soup);
    console.info(`materials ${(tB - tA).toFixed(0)} ms, estate ${(tC - tB).toFixed(0)} ms, bvh ${(performance.now() - tC).toFixed(0)} ms`);
    const t0 = performance.now();
    bakeLight(this.world, estate.ctx.lamps, [-146, -98, 146, 160]);
    const t1 = performance.now();
    this.nav = new NavGrid(this.world, PLAY);
    console.info(`light bake ${(t1 - t0).toFixed(0)} ms, nav ${(performance.now() - t1).toFixed(0)} ms, ${this.world.triangles} collision tris`);
    this.nav.block(CAMP[0] - 3, CAMP[1] - 3, CAMP[2] + 3, CAMP[3] + 3);
    this.fires = estate.fires;
    this.anim = estate.anim;
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 18, 1.6);
      this.engine.scene.add(l);
      this.fireLights.push(l);
    }
    // The rest of the section, standing to in the patrol base.
    const safMats = soldierMaterials(this.engine, { variant: "saf", uniform: camoTexture(), cloth: 0xffffff, dark: 0x15140f, helmet: 0x4a5236, gear: 0x444b32, pouch: 0x525a3c, skin: 0xa07a5a, mask: 0xa07a5a });
    CAMP_SENTRIES.forEach(([sx, sz, yaw], i) => {
      const model = new SoldierModel(safMats);
      const fl = this.world.floor(sx, sz, 3, 6);
      model.root.position.set(sx, fl ? fl.y : 0.06, sz);
      model.root.rotation.y = yaw;
      this.engine.scene.add(model.root);
      this.sentries.push({ model, yaw, pose: { phase: 0, speed: 0, crouch: 0, aimYaw: 0, aimPitch: 0, aim: i === 2 ? 0.15 : 0, kick: 0, flinch: 0, dead: 0, deadKind: 0, time: i * 3.1, headYaw: 0 } });
    });
    this.vfx = new Vfx(this.engine);
    this.player = new PlayerController(this.world, this.input);
    const self = this;
    this.target = {
      pos: this.player.pos,
      get eye() {
        return self.player.eye;
      },
      get speed() {
        return self.player.speed;
      },
      get alive() {
        return self.hp > 0 && self.state === "playing" && !self.inCamp;
      },
      damage: (n, from) => this.hurt(n, from),
      whiz: (at) => {
        this.audio.whiz(at.x, at.y, at.z);
        this.suppress = Math.min(1, this.suppress + 0.3);
      },
    };
    this.soldiers = new Soldiers(this.engine, this.world, this.nav, this.vfx, this.audio, this.target);
    this.weapon = new WeaponSystem(this.engine, this.input, this.player, this.world, this.vfx, this.audio, this.soldiers);
    this.engine.scene.add(this.engine.camera);
    this.nadeMat = this.engine.lit(new THREE.MeshStandardMaterial({ color: 0x2f3a26, roughness: 0.55, metalness: 0.2 }));

    this.hud = new Hud(ui);
    this.menus = new Menus(ui, this.api, this.settings, {
      deploy: (m) => this.deploy(m),
      resume: () => this.resume(),
      abort: () => this.toMenu(),
      settings: (s) => this.applySettings(s),
      sound: (k) => {
        this.audio.start();
        this.audio.ui(k);
      },
    });

    // ---- wiring -------------------------------------------------------------
    this.player.onFootstep = (surf, sprint) => this.audio.footstep(surf, sprint);
    this.player.onLand = (impact) => {
      this.audio.land(impact);
      if (impact > 9) this.hurt((impact - 9) * 9, this.player.pos);
    };
    this.vfx.onShellLand = (p) => this.audio.shellDrop(p.x, p.y, p.z);
    this.weapon.onShot = (o) => this.soldiers.noise(o, 75);
    this.weapon.onHit = (part, killed) => {
      this.hud.hitmarker(killed);
      if (killed && part === "head") this.headshots++;
    };
    this.soldiers.onKill = (_s, part) => {
      this.kills++;
      const pts = part === "head" ? 150 : 100;
      this.score += pts;
      this.hud.feed(part === "head" ? "Hostile down · headshot" : "Hostile down", `+${pts}`);
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === "playing") this.pause();
    };
    window.addEventListener("resize", () => this.engine.resize());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.state === "paused") this.resume();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });

    this.applySettings(this.settings);
    this.weapon.setVisible(false);
    this.menus.showMain();
    void this.api.resume().then(() => this.menus.refreshMain());
  }

  // ---- MissionHost -------------------------------------------------------------
  get playerPos(): THREE.Vector3 {
    return this.player.pos;
  }

  say(speaker: string, text: string, seconds = 4.5): void {
    this.hud.subtitle(speaker, text, seconds);
  }

  banner(kicker: string, title: string): void {
    this.hud.banner(kicker, title);
    this.audio.ui("objective");
  }

  resupply(): void {
    this.weapon.addAmmo(120);
    this.nades = Math.min(3, this.nades + 1);
    this.hp = Math.min(100, this.hp + 40);
    this.hud.feed("Ammunition resupplied");
  }

  addScore(n: number): void {
    this.score += n;
  }

  visible(p: THREE.Vector3): boolean {
    return this.world.clear(this.player.eyePosition(_eye), p);
  }

  explode(pos: THREE.Vector3, scale: number): void {
    this.vfx.explosion(pos, scale);
    this.audio.explosion(pos.x, pos.y, pos.z, scale);
    const radius = 7.5 * scale;
    const k = this.soldiers.explode(pos, radius, 190);
    this.explosiveKills += k;
    const d = this.player.eyePosition(_eye).distanceTo(pos);
    if (d < radius * 1.2 && (d < 2 || this.world.clear(pos, _eye))) this.hurt(Math.max(0, 150 * (1 - d / (radius * 1.2))), pos);
    this.shake = Math.max(this.shake, Math.min(1, (14 * scale) / (d + 2)));
    const fl = this.world.floor(pos.x, pos.z, pos.y + 0.5, 3);
    if (fl) this.vfx.decal(_v.set(pos.x, fl.y, pos.z), _v2.set(0, 1, 0), 2.6 * scale, 0.25);
  }

  // ---- state changes --------------------------------------------------------------
  private applySettings(s: Settings): void {
    this.player.sensitivity = s.sensitivity;
    this.audio.setVolume(s.volume);
    this.weapon.hipFov = s.fov;
    if (this.engine.quality !== s.quality) this.engine.setQuality(s.quality);
    this.api.saveSettings(s);
  }

  deploy(mode: Mode): void {
    this.audio.start();
    this.audio.startAmbience();
    this.audio.ui("confirm");
    this.mode = mode;
    this.menus.setMode(mode);
    this.menus.hide();
    this.soldiers.clear();
    for (const g of this.grenades) this.engine.scene.remove(g.mesh);
    this.grenades.length = 0;
    this.hud.reset();
    this.hp = 100;
    this.nades = 2;
    this.kills = this.headshots = this.explosiveKills = this.score = 0;
    this.playTime = 0;
    this.sinceHit = 99;
    this.flash = this.suppress = this.shake = 0;
    this.weapon.reset();
    this.weapon.enabled = true;
    this.weapon.setVisible(true);
    this.mission = mode === "holdout" ? new Holdout(this) : new Operation(this);
    const sp = this.mission.spawn;
    this.inCamp = false;
    this.grace = 0;
    const fl = this.world.floor(sp.x, sp.z, 3, 6);
    this.player.spawn(sp.x, fl ? fl.y : 0, sp.z, sp.yaw);
    this.mission.start();
    this.hud.fade.classList.remove("on");
    this.hud.show(true);
    this.state = "playing";
    this.input.enabled = true;
    this.input.lock();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.input.unlock();
    this.menus.showPause();
    this.hud.show(false);
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.menus.hide();
    this.hud.show(true);
    this.state = "playing";
    this.input.lock();
  }

  toMenu(): void {
    this.state = "menu";
    this.input.unlock();
    this.soldiers.clear();
    this.mission = null;
    this.weapon.setVisible(false);
    this.hud.show(false);
    this.hud.fade.classList.remove("on");
    this.engine.setFeedback(0, 0, 0);
    this.engine.setFov(60);
    this.menuT = 0;
    this.menus.showMain();
  }

  private hurt(amount: number, from: THREE.Vector3): void {
    if (this.state !== "playing" || this.hp <= 0 || this.inCamp || this.grace > 0) return;
    this.hp -= amount;
    this.sinceHit = 0;
    this.flash = Math.min(1, this.flash + 0.35 + amount / 60);
    this.shake = Math.max(this.shake, 0.25);
    this.audio.hurt();
    const a = Math.atan2(from.x - this.player.pos.x, -(from.z - this.player.pos.z)) + this.player.yaw;
    this.hud.damageFrom(a);
    if (this.hp <= 0) {
      this.hp = 0;
      this.end(false, this.mode === "holdout" ? `You held the junction through ${this.mission?.progress ?? 0} wave${this.mission?.progress === 1 ? "" : "s"} before the position was overrun.` : "Your section took a casualty it could not afford. The estate remains in enemy hands.");
    }
  }

  private end(success: boolean, line: string): void {
    if (this.state !== "playing") return;
    this.state = "ending";
    this.endT = success ? 3.2 : 2.6;
    this.weapon.enabled = false;
    this.hud.fade.classList.add("on");
    this.hud.prompt(null);
    const m = this.mission!;
    const acc = this.weapon.shotsFired ? Math.round((this.weapon.shotsHit / this.weapon.shotsFired) * 100) : 0;
    const result: Promise<MatchResult | null> = this.api.submit({
      missionType: this.mode === "holdout" ? "wave_survival" : "strongpoint_assault",
      waveReached: this.mode === "holdout" ? m.progress : 0,
      strongpointsCleared: this.mode === "operation" ? m.progress : 0,
      kills: this.kills,
      headshots: this.headshots,
      shotsFired: this.weapon.shotsFired,
      shotsHit: this.weapon.shotsHit,
      creditsEarned: this.score,
      durationSec: Math.round(this.playTime),
      explosiveKills: this.explosiveKills,
    });
    this.pendingDebrief = () =>
      this.menus.showDebrief({
        mode: this.mode,
        success,
        title: this.mode === "holdout" ? "Holdout" : "Operation Swift Lion",
        line,
        kills: this.kills,
        headshots: this.headshots,
        accuracy: acc,
        seconds: this.playTime,
        score: this.score,
        waves: m.progress,
        objectives: m.progress,
        result,
      });
  }

  private pendingDebrief: (() => void) | null = null;

  // ---- per-frame ---------------------------------------------------------------------
  private throwGrenade(): void {
    if (this.nades <= 0) return;
    this.nades--;
    const cam = this.engine.camera;
    cam.getWorldDirection(_v);
    const mesh = new THREE.Mesh(this.nadeGeo, this.nadeMat);
    mesh.castShadow = true;
    mesh.position.copy(cam.position).addScaledVector(_v, 0.5);
    mesh.position.y -= 0.12;
    this.engine.scene.add(mesh);
    this.grenades.push({ mesh, vel: new THREE.Vector3().copy(_v).multiplyScalar(17).add(_v2.set(0, 4.2, 0)).addScaledVector(this.player.vel, 0.6), fuse: 3.1 });
    this.audio.foley("pin");
  }

  private stepGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      const sp = g.vel.length();
      if (sp > 0.05) {
        _v.copy(g.vel).multiplyScalar(1 / sp);
        const hit = this.world.raycast(g.mesh.position, _v, sp * dt + 0.05);
        if (hit) {
          g.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.05);
          const vn = g.vel.dot(hit.normal);
          g.vel.addScaledVector(hit.normal, -1.42 * vn).multiplyScalar(hit.normal.y > 0.6 ? 0.62 : 0.5);
          if (Math.abs(vn) > 1.5) this.audio.impact(hit.surf, hit.point.x, hit.point.y, hit.point.z);
        } else g.mesh.position.addScaledVector(g.vel, dt);
      }
      g.mesh.rotation.x += dt * sp * 2;
      if (g.fuse <= 0) {
        this.engine.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        this.explode(g.mesh.position.clone(), 1);
      }
    }
  }

  private play(dt: number): void {
    const p = this.player;
    const m = this.mission!;
    const cam = this.engine.camera;
    this.playTime += dt;
    p.look(this.weapon.lookScale);
    p.update(dt);
    p.eyePosition(cam.position);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.05;
    cam.rotation.set(p.pitch + (Math.random() - 0.5) * sh, p.yaw + (Math.random() - 0.5) * sh, -p.lean * 0.13 + (Math.random() - 0.5) * sh, "YXZ");
    cam.updateMatrixWorld();
    this.weapon.update(dt);
    // Patrol base: weapons safe, nothing can touch you, and you mend quickly.
    const inCamp = p.pos.x > CAMP[0] && p.pos.x < CAMP[2] && p.pos.z > CAMP[1] && p.pos.z < CAMP[3];
    if (inCamp !== this.inCamp) {
      this.inCamp = inCamp;
      this.weapon.enabled = !inCamp;
      if (inCamp) this.hud.banner("PATROL BASE LION", "Safe zone · weapons safe");
      else {
        this.grace = 2.5;
        this.hud.banner("LEAVING PATROL BASE", "Weapons free");
      }
      this.audio.ui("radio");
    }
    this.grace = Math.max(0, this.grace - dt);
    if (inCamp && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 30);
    if (this.input.hit("KeyG") && !inCamp) this.throwGrenade();
    this.stepGrenades(dt);
    this.soldiers.update(dt);
    m.update(dt);

    // Health: recover after a quiet spell.
    this.sinceHit += dt;
    if (this.sinceHit > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 9);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.suppress = Math.max(0, this.suppress - dt * 0.35);
    const hurt = 1 - this.hp / 100;
    this.engine.setFeedback(Math.min(1, hurt * 0.9 + this.suppress * 0.25), Math.min(1, hurt * hurt * 0.8 + this.suppress * 0.3), this.flash);
    this.audio.setMuffle(Math.max(hurt > 0.65 ? (hurt - 0.65) * 2.4 : 0, this.suppress * 0.5));
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, p.yaw);

    // Interaction.
    const it = m.interact;
    if (it && Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z) < 2.4) {
      if (this.input.held("KeyF")) {
        this.holdT += dt;
        if (this.holdT >= it.seconds) {
          this.holdT = 0;
          this.audio.ui("confirm");
          it.done();
        }
      } else this.holdT = 0;
      this.hud.prompt(it.label, "F", this.holdT / it.seconds);
    } else if (inCamp && Math.hypot(CAMP_AMMO.x - p.pos.x, CAMP_AMMO.z - p.pos.z) < 3.2) {
      const full = this.weapon.reserve >= this.weapon.def.reserve && this.weapon.ammo >= this.weapon.def.magSize && this.nades >= 3;
      if (!full && this.input.held("KeyF")) {
        this.holdT += dt;
        if (this.holdT >= 1) {
          this.holdT = 0;
          this.weapon.ammo = this.weapon.def.magSize;
          this.weapon.reserve = this.weapon.def.reserve;
          this.nades = 3;
          this.audio.foley("magIn");
          this.hud.feed("Ammunition and grenades drawn");
        }
      } else this.holdT = 0;
      this.hud.prompt(full ? "Fully stocked" : "Draw ammunition", "F", full ? -1 : this.holdT);
    } else {
      this.holdT = 0;
      this.hud.prompt(null);
    }

    // HUD.
    const h = this.hud;
    const bearing = THREE.MathUtils.radToDeg(-p.yaw);
    let objBearing: number | null = null;
    const mk = it ? it.pos : m.marker;
    if (mk) {
      const dx = mk.x - p.pos.x;
      const dz = mk.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      objBearing = THREE.MathUtils.radToDeg(Math.atan2(dx, -dz));
      _v.set(mk.x, mk.y + 2.4, mk.z).project(cam);
      const on = _v.z < 1 && Math.abs(_v.x) < 0.96 && Math.abs(_v.y) < 0.92 && dist > 6;
      h.marker(on, (_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight, dist);
    } else h.marker(false, 0, 0, 0);
    h.compass(bearing, objBearing);
    h.objective(m.op, m.title, m.detail);
    h.timer(m.timer);
    h.health(this.hp);
    h.setStance(p.stance === "crouch", p.sprinting);
    h.weapon(this.weapon.def.name, this.weapon.ammo, this.weapon.reserve, this.weapon.auto, this.weapon.reloading, this.nades, this.weapon.def.magSize);
    h.crosshair(this.weapon.spread, cam.fov, this.weapon.ads < 0.5 && !p.sprinting && !this.weapon.reloading);
    if (h.update(dt)) this.audio.radio(0.35);

    if (m.ended) this.end(m.ended === "win", m.endLine);
  }

  private menuCamera(dt: number): void {
    this.menuT += dt;
    const dur = 16;
    if (this.menuT > dur) {
      this.menuT = 0;
      this.menuShot = (this.menuShot + 1) % FLYBY.length;
    }
    const s = FLYBY[this.menuShot];
    const t = this.menuT / dur;
    const cam = this.engine.camera;
    cam.position.set(s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t, s.from[2] + (s.to[2] - s.from[2]) * t);
    cam.rotation.set(s.pitch, s.yaw + Math.sin(this.menuT * 0.2) * 0.03, 0, "YXZ");
    this.engine.setFov(58);
    const edge = Math.min(1, this.menuT / 1.2, (dur - this.menuT) / 1.2);
    this.engine.setFeedback(0, 0.15, 0);
    this.hud.fade.style.transition = "none";
    this.hud.fade.style.opacity = String(1 - edge);
  }

  /** Advance the simulation without rendering (automated play tests). */
  simulate(dt: number): void {
    if (this.state === "playing") this.play(dt);
    this.vfx.update(dt, this.engine.camera);
    this.input.endFrame();
  }

  frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === "playing") this.play(dt);
    else if (this.state === "ending") {
      this.endT -= dt;
      this.soldiers.update(dt);
      this.engine.camera.position.y -= dt * (this.hp <= 0 ? 0.5 : 0);
      this.engine.camera.rotation.z += dt * (this.hp <= 0 ? 0.25 : 0);
      if (this.endT <= 0) {
        this.state = "debrief";
        this.input.unlock();
        this.hud.show(false);
        this.weapon.setVisible(false);
        this.pendingDebrief?.();
        this.pendingDebrief = null;
      }
    } else if (this.state === "menu") this.menuCamera(dt);
    if (this.state !== "menu") {
      this.hud.fade.style.transition = "";
      this.hud.fade.style.opacity = "";
    }
    if (this.state !== "paused") {
      // Ambient motes drifting through the light near the camera.
      this.moteT -= dt;
      if (this.moteT <= 0) {
        this.moteT = 0.12;
        const c = this.engine.camera.position;
        this.vfx.mote(_v.set(c.x + (Math.random() - 0.5) * 14, c.y + (Math.random() - 0.3) * 4, c.z + (Math.random() - 0.5) * 14));
      }
      this.worldT += dt;
      for (const f of this.anim) f(this.worldT, dt);
      // Fires: flames every tick near the camera, smoke on a slower beat, and a flickering
      // light on the three nearest so they throw moving orange onto the wreckage around them.
      const cp = this.engine.camera.position;
      this.fireT -= dt;
      this.smokeT -= dt;
      const flame = this.fireT <= 0;
      const smoke = this.smokeT <= 0;
      if (flame) this.fireT = 0.055;
      if (smoke) this.smokeT = 0.3;
      const near: Array<[number, Fire]> = [];
      for (const f of this.fires) {
        const d = f.pos.distanceTo(cp);
        near.push([d, f]);
        if (d < 130 && (flame || smoke)) this.vfx.fire(f.pos, f.size, flame ? (d < 60 ? 2 : 1) : 0, smoke);
      }
      near.sort((a, b) => a[0] - b[0]);
      this.fireLights.forEach((l, i) => {
        const n = near[i];
        if (!n || n[0] > 70) {
          l.intensity = 0;
          return;
        }
        const t = this.worldT * 9 + i * 17;
        const flick = 0.72 + 0.16 * Math.sin(t) + 0.12 * Math.sin(t * 2.7 + 1.3) + (Math.random() - 0.5) * 0.12;
        l.position.set(n[1].pos.x, n[1].pos.y + 0.6, n[1].pos.z);
        l.intensity = 34 * n[1].size * flick;
      });
      for (const st of this.sentries) {
        st.pose.time = (st.pose.time ?? 0) + dt;
        st.pose.headYaw = Math.sin(st.pose.time * 0.23 + st.yaw) * 0.6;
        if (st.model.root.position.distanceToSquared(cp) < 90 * 90) st.model.pose(st.pose);
      }
      this.vfx.update(dt, this.engine.camera);
    }
    this.engine.render(this.state === "paused" ? 0 : dt);
    this.input.endFrame();
    this.frames++;
    requestAnimationFrame(this.frame);
  };
}
