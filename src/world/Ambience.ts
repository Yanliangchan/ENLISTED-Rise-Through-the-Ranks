import {
  Scene,
  Vector3,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  ParticleSystem,
  DynamicTexture,
  HemisphericLight,
  DirectionalLight,
} from "@babylonjs/core";
import type { AudioManager } from "@/core/AudioManager";
import type { PlayerController } from "@/player/PlayerController";

/**
 * Lightweight ambient world events — the battlefield keeps living around the
 * gameplay without costing meaningful frame time:
 *  - a weather cycle (clear → overcast rain squalls with thunder + a rain bed),
 *  - a helicopter orbiting high over the city,
 *  - burning vehicle wrecks with fire + smoke plumes,
 *  - distant explosions flashing on the horizon with a soft rumble.
 * Everything is particles, one small orbiting mesh group, and light tweaks —
 * no extra lights, no shadow casters, no per-frame allocations of note.
 */
export class Ambience {
  private rain: ParticleSystem;
  private rainEmitter: Mesh;
  private heli: TransformNode;
  private rotor: Mesh;
  private heliAngle = Math.random() * Math.PI * 2;
  private strobe: Mesh;
  private strobeClock = 0;

  // Weather state machine.
  private raining = false;
  private weatherTimer = 30 + Math.random() * 30; // first squall arrives early-ish
  private thunderTimer = 0;
  private flashTimer = 0;

  // Distant-explosion state.
  private boomTimer = 12 + Math.random() * 18;
  private boomFlash: Mesh;
  private boomFlashLife = 0;

  private readonly hemi: HemisphericLight | null;
  private readonly sun: DirectionalLight | null;
  private readonly baseHemi: number;
  private readonly baseSun: number;
  private readonly baseFog: { start: number; end: number; color: Color3 };

  constructor(
    private readonly scene: Scene,
    private readonly audio: AudioManager,
    private readonly player: PlayerController
  ) {
    this.hemi = scene.getLightByName("hemiLight") as HemisphericLight | null;
    this.sun = scene.getLightByName("sunLight") as DirectionalLight | null;
    this.baseHemi = this.hemi?.intensity ?? 0.65;
    this.baseSun = this.sun?.intensity ?? 0.9;
    this.baseFog = { start: scene.fogStart, end: scene.fogEnd, color: scene.fogColor.clone() };

    const flake = particleTexture(scene);

    // --- Rain: stretched streaks falling in a volume that rides above the camera.
    this.rainEmitter = MeshBuilder.CreateBox("rainEmitter", { size: 0.1 }, scene);
    this.rainEmitter.isVisible = false;
    this.rainEmitter.isPickable = false;
    this.rain = new ParticleSystem("rain", 900, scene);
    this.rain.particleTexture = flake;
    this.rain.emitter = this.rainEmitter;
    this.rain.minEmitBox = new Vector3(-16, 0, -16);
    this.rain.maxEmitBox = new Vector3(16, 2, 16);
    this.rain.direction1 = new Vector3(-0.4, -22, -0.2);
    this.rain.direction2 = new Vector3(0.4, -26, 0.2);
    this.rain.minLifeTime = 0.5;
    this.rain.maxLifeTime = 0.7;
    this.rain.emitRate = 0; // off until a squall starts
    this.rain.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    this.rain.minScaleX = 0.02;
    this.rain.maxScaleX = 0.035;
    this.rain.minScaleY = 0.5;
    this.rain.maxScaleY = 0.8;
    this.rain.color1 = new Color4(0.65, 0.72, 0.8, 0.5);
    this.rain.color2 = new Color4(0.7, 0.78, 0.86, 0.35);
    this.rain.colorDead = new Color4(0.6, 0.7, 0.8, 0);
    this.rain.updateSpeed = 0.016;
    this.rain.start();

    // --- Helicopter on a wide, high orbit.
    this.heli = new TransformNode("heli", scene);
    const heliMat = new StandardMaterial("heliMat", scene);
    heliMat.diffuseColor = new Color3(0.16, 0.18, 0.16);
    heliMat.emissiveColor = new Color3(0.05, 0.055, 0.05);
    heliMat.specularColor = Color3.Black();
    const fuselage = MeshBuilder.CreateBox("heliBody", { width: 1.4, height: 1.3, depth: 4.6 }, scene);
    fuselage.material = heliMat;
    fuselage.parent = this.heli;
    fuselage.isPickable = false;
    const tail = MeshBuilder.CreateBox("heliTail", { width: 0.4, height: 0.5, depth: 3.4 }, scene);
    tail.position.set(0, 0.35, -3.6);
    tail.material = heliMat;
    tail.parent = this.heli;
    tail.isPickable = false;
    this.rotor = MeshBuilder.CreateBox("heliRotor", { width: 9, height: 0.06, depth: 0.4 }, scene);
    this.rotor.position.y = 0.85;
    this.rotor.material = heliMat;
    this.rotor.parent = this.heli;
    this.rotor.isPickable = false;
    const strobeMat = new StandardMaterial("heliStrobeMat", scene);
    strobeMat.emissiveColor = new Color3(1, 0.15, 0.1);
    strobeMat.disableLighting = true;
    this.strobe = MeshBuilder.CreateSphere("heliStrobe", { diameter: 0.25 }, scene);
    this.strobe.position.set(0, -0.75, 0);
    this.strobe.material = strobeMat;
    this.strobe.parent = this.heli;
    this.strobe.isPickable = false;

    // --- Burning wrecks (fixed, on-road positions clear of buildings).
    for (const [x, z] of [[-22, 50], [44, 22], [22, -44]] as Array<[number, number]>) {
      this.buildBurningWreck(x, z, flake);
    }

    // --- Distant-explosion flash sphere, reused across events.
    const boomMat = new StandardMaterial("boomFlashMat", scene);
    boomMat.emissiveColor = new Color3(1, 0.6, 0.25);
    boomMat.disableLighting = true;
    boomMat.alpha = 0;
    this.boomFlash = MeshBuilder.CreateSphere("boomFlash", { diameter: 6, segments: 8 }, scene);
    this.boomFlash.material = boomMat;
    this.boomFlash.isPickable = false;
    this.boomFlash.applyFog = false;
    this.boomFlash.setEnabled(false);
  }

  /** A charred hull on the roadside with a low fire and a leaning smoke column. */
  private buildBurningWreck(x: number, z: number, tex: DynamicTexture): void {
    const hullMat = new StandardMaterial(`wreckMat_${x}_${z}`, this.scene);
    hullMat.diffuseColor = new Color3(0.08, 0.08, 0.08);
    hullMat.emissiveColor = new Color3(0.06, 0.03, 0.01); // faint ember glow
    hullMat.specularColor = Color3.Black();
    const hull = MeshBuilder.CreateBox(`wreck_${x}_${z}`, { width: 1.9, height: 0.85, depth: 4.4 }, this.scene);
    hull.position.set(x, 0.45, z);
    hull.rotation.y = Math.atan2(x, z) + 0.5; // skewed across the lane
    hull.material = hullMat;
    hull.checkCollisions = true;

    const fire = new ParticleSystem(`wreckFire_${x}_${z}`, 60, this.scene);
    fire.particleTexture = tex;
    fire.emitter = new Vector3(x, 0.9, z);
    fire.minEmitBox = new Vector3(-0.5, 0, -1.2);
    fire.maxEmitBox = new Vector3(0.5, 0.2, 1.2);
    fire.direction1 = new Vector3(-0.15, 1.6, -0.15);
    fire.direction2 = new Vector3(0.15, 2.4, 0.15);
    fire.color1 = new Color4(1, 0.62, 0.12, 0.9);
    fire.color2 = new Color4(1, 0.3, 0.05, 0.8);
    fire.colorDead = new Color4(0.4, 0.05, 0, 0);
    fire.minSize = 0.35;
    fire.maxSize = 0.85;
    fire.minLifeTime = 0.35;
    fire.maxLifeTime = 0.7;
    fire.emitRate = 26;
    fire.blendMode = ParticleSystem.BLENDMODE_ADD;
    fire.start();

    const smoke = new ParticleSystem(`wreckSmoke_${x}_${z}`, 40, this.scene);
    smoke.particleTexture = tex;
    smoke.emitter = new Vector3(x, 1.4, z);
    smoke.minEmitBox = new Vector3(-0.4, 0, -0.8);
    smoke.maxEmitBox = new Vector3(0.4, 0.3, 0.8);
    smoke.direction1 = new Vector3(0.25, 1.4, 0.1); // drifts with the wind
    smoke.direction2 = new Vector3(0.7, 2.2, 0.35);
    smoke.color1 = new Color4(0.12, 0.12, 0.12, 0.35);
    smoke.color2 = new Color4(0.2, 0.2, 0.2, 0.25);
    smoke.colorDead = new Color4(0.25, 0.25, 0.25, 0);
    smoke.minSize = 1.0;
    smoke.maxSize = 2.6;
    smoke.minLifeTime = 2.2;
    smoke.maxLifeTime = 4.0;
    smoke.emitRate = 9;
    // Alpha-blended, NOT the default additive — additive grey glows white.
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    smoke.start();
  }

  update(dt: number): void {
    // Rain volume follows the player.
    const p = this.player.position;
    this.rainEmitter.position.set(p.x, p.y + 13, p.z);

    // Weather cycle.
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.raining = !this.raining;
      this.weatherTimer = this.raining ? 28 + Math.random() * 18 : 50 + Math.random() * 35;
      this.rain.emitRate = this.raining ? 750 : 0;
      this.audio.setRain(this.raining);
      if (this.raining) this.thunderTimer = 3 + Math.random() * 6;
    }
    // Blend light/fog toward the squall look and back.
    const t = Math.min(1, dt * 0.8);
    const wantHemi = this.raining ? this.baseHemi * 0.72 : this.baseHemi;
    const wantSun = this.raining ? this.baseSun * 0.6 : this.baseSun;
    const wantStart = this.raining ? 40 : this.baseFog.start;
    const wantEnd = this.raining ? 150 : this.baseFog.end;
    if (this.hemi) this.hemi.intensity += (wantHemi - this.hemi.intensity) * t;
    if (this.sun) this.sun.intensity += (wantSun - this.sun.intensity) * t;
    this.scene.fogStart += (wantStart - this.scene.fogStart) * t;
    this.scene.fogEnd += (wantEnd - this.scene.fogEnd) * t;

    // Thunder during rain: audio roll + a two-frame sky flash.
    if (this.raining) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = 7 + Math.random() * 12;
        this.audio.thunder();
        this.flashTimer = 0.12;
      }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.hemi) this.hemi.intensity = this.baseHemi * 1.8;
    }

    // Helicopter orbit + rotor spin + blinking strobe.
    this.heliAngle += dt * 0.045;
    const r = 78;
    this.heli.position.set(Math.cos(this.heliAngle) * r, 54, Math.sin(this.heliAngle) * r);
    this.heli.rotation.y = -this.heliAngle - Math.PI / 2; // nose along the orbit
    this.rotor.rotation.y += dt * 18;
    this.strobeClock += dt;
    this.strobe.setEnabled(this.strobeClock % 1.2 < 0.12);

    // Distant explosions on the horizon.
    this.boomTimer -= dt;
    if (this.boomTimer <= 0) {
      this.boomTimer = 16 + Math.random() * 22;
      const a = Math.random() * Math.PI * 2;
      this.boomFlash.position.set(Math.cos(a) * 150, 3 + Math.random() * 6, Math.sin(a) * 150);
      this.boomFlash.scaling.setAll(0.6);
      this.boomFlash.setEnabled(true);
      this.boomFlashLife = 0.7;
      this.audio.distantExplosion();
    }
    if (this.boomFlashLife > 0) {
      this.boomFlashLife -= dt;
      const k = Math.max(0, this.boomFlashLife / 0.7);
      this.boomFlash.scaling.setAll(0.6 + (1 - k) * 2.2);
      (this.boomFlash.material as StandardMaterial).alpha = k * 0.9;
      if (this.boomFlashLife <= 0) this.boomFlash.setEnabled(false);
    }
  }
}

/** Tiny shared radial-blob texture for every particle system here. */
function particleTexture(scene: Scene): DynamicTexture {
  const size = 32;
  const tex = new DynamicTexture("ambientParticleTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}
