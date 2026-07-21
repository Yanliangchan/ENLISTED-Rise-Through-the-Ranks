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
} from "@babylonjs/core";
import type { AudioManager } from "@/core/AudioManager";
import type { PlayerController } from "@/player/PlayerController";

/**
 * Lightweight ambient world events for the night-time city — the battlefield
 * keeps living around the gameplay without costing meaningful frame time:
 *  - a helicopter orbiting high over the city (nav strobe blinking),
 *  - burning vehicle wrecks with fire + smoke plumes (bright against the dark),
 *  - distant explosions flashing on the horizon with a soft rumble.
 *
 * The old rain/weather system was removed: it cost particle + wet-surface time
 * for little gameplay value, and the map now runs a fixed night atmosphere
 * (see Level.ts night lighting) where flashlights matter instead.
 */
export class Ambience {
  private heli: TransformNode;
  private rotor: Mesh;
  private heliAngle = Math.random() * Math.PI * 2;
  private strobe: Mesh;
  private strobeClock = 0;

  // Distant-explosion state.
  private boomTimer = 12 + Math.random() * 18;
  private boomFlash: Mesh;
  private boomFlashLife = 0;

  constructor(
    private readonly scene: Scene,
    private readonly audio: AudioManager,
    private readonly player: PlayerController
  ) {
    const flake = particleTexture(scene);

    // --- Helicopter on a wide, high orbit.
    this.heli = new TransformNode("heli", scene);
    const heliMat = new StandardMaterial("heliMat", scene);
    heliMat.diffuseColor = new Color3(0.12, 0.13, 0.12);
    heliMat.emissiveColor = new Color3(0.03, 0.035, 0.03);
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
    hullMat.emissiveColor = new Color3(0.08, 0.04, 0.01); // ember glow, stronger at night
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
