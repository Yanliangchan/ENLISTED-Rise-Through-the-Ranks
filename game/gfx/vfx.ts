import * as THREE from "three";
import type { Engine } from "~/core/engine";
import { Surf } from "./builder";
import { canvasTex } from "./textures";
import { fbm, rng } from "./noise";

/**
 * Combat effects: billboard particles (smoke, dust, sparks, fire, blood),
 * tracers, bullet-hole decals, ejected brass and transient lights. Everything
 * is pooled and drawn instanced: a firefight spawns hundreds of effects a
 * second and none of them allocate or add a draw call.
 */

const CELLS = 4;
export const PC = { smoke0: 0, smoke1: 1, smoke2: 2, smoke3: 3, dust: 4, spark: 5, flash0: 6, flash1: 7, flash2: 8, chip: 9, blood: 10, fire0: 11, fire1: 12, ring: 13, glow: 14, leaf: 15 } as const;

function particleAtlas(): THREE.CanvasTexture {
  const C = 128;
  return canvasTex(C * CELLS, C * CELLS, (c) => {
    const at = (i: number): [number, number] => [(i % CELLS) * C, Math.floor(i / CELLS) * C];
    const puff = (i: number, seed: number, hard: number, color: [number, number, number]): void => {
      const [ox, oy] = at(i);
      const img = c.createImageData(C, C);
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const u = x / C;
        const v = y / C;
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const n = fbm(u, v, 3, 4, seed) * 0.7 + fbm(u, v, 9, 3, seed + 5) * 0.3;
        const a = Math.max(0, Math.min(1, (1 - d - (1 - n) * hard) * 2.4));
        const k = 0.72 + n * 0.5;
        const p = (y * C + x) * 4;
        img.data[p] = color[0] * k;
        img.data[p + 1] = color[1] * k;
        img.data[p + 2] = color[2] * k;
        img.data[p + 3] = a * a * 255;
      }
      c.putImageData(img, ox, oy);
    };
    for (let i = 0; i < 4; i++) puff(i, 10 + i * 13, 0.75, [255, 255, 255]);
    puff(PC.dust, 71, 0.95, [255, 255, 255]);
    puff(PC.blood, 83, 1.1, [255, 255, 255]);
    puff(PC.fire0, 91, 0.9, [255, 255, 255]);
    puff(PC.fire1, 97, 1.0, [255, 255, 255]);
    const radial = (i: number, stops: Array<[number, string]>): void => {
      const [ox, oy] = at(i);
      const g = c.createRadialGradient(ox + C / 2, oy + C / 2, 0, ox + C / 2, oy + C / 2, C / 2);
      for (const [t, col] of stops) g.addColorStop(t, col);
      c.fillStyle = g;
      c.fillRect(ox, oy, C, C);
    };
    radial(PC.spark, [[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,230,170,0.9)"], [1, "rgba(255,160,60,0)"]]);
    radial(PC.glow, [[0, "rgba(255,255,255,1)"], [0.4, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]);
    // Muzzle flashes: ragged star bursts.
    for (let f = 0; f < 3; f++) {
      const [ox, oy] = at(PC.flash0 + f);
      const r = rng(200 + f * 31);
      c.save();
      c.translate(ox + C / 2, oy + C / 2);
      const spikes = 5 + f;
      for (let pass = 0; pass < 2; pass++) {
        c.fillStyle = pass === 0 ? "rgba(255,170,70,0.75)" : "rgba(255,246,214,1)";
        c.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const a = (i / (spikes * 2)) * Math.PI * 2 + f;
          const rad = (i % 2 === 0 ? 0.42 + r() * 0.5 : 0.12 + r() * 0.1) * (pass === 0 ? 1 : 0.6) * (C / 2);
          c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        c.closePath();
        c.shadowColor = "rgba(255,180,80,1)";
        c.shadowBlur = 14;
        c.fill();
      }
      c.restore();
    }
    // Debris chip.
    {
      const [ox, oy] = at(PC.chip);
      c.fillStyle = "#fff";
      c.beginPath();
      c.moveTo(ox + 40, oy + 30);
      c.lineTo(ox + 96, oy + 44);
      c.lineTo(ox + 84, oy + 98);
      c.lineTo(ox + 34, oy + 80);
      c.closePath();
      c.fill();
    }
    // Shock ring.
    {
      const [ox, oy] = at(PC.ring);
      c.strokeStyle = "rgba(255,255,255,0.9)";
      c.lineWidth = 7;
      c.shadowColor = "#fff";
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(ox + C / 2, oy + C / 2, C / 2 - 12, 0, Math.PI * 2);
      c.stroke();
      c.shadowBlur = 0;
    }
    // Leaf.
    {
      const [ox, oy] = at(PC.leaf);
      c.fillStyle = "#fff";
      c.beginPath();
      c.ellipse(ox + C / 2, oy + C / 2, 44, 18, 0.5, 0, Math.PI * 2);
      c.fill();
    }
  });
}

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aData; // size, rotation, cell, stretch
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
  float c = cos(aData.y), s = sin(aData.y);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aData.x;
  mvPosition.xy += q;
  gl_Position = projectionMatrix * mvPosition;
  float cell = aData.z;
  vec2 cellUv = vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0));
  vUv = (cellUv + uv) * 0.25;
  vColor = aColor;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  if (gl_FragColor.a < 0.004) discard;
  #ifdef ADDITIVE
    gl_FragColor.rgb *= gl_FragColor.a;
  #else
    #include <fog_fragment>
  #endif
}`;

export interface Spawn {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size: number;
  /** Size multiplier reached at end of life. */
  grow?: number;
  r?: number; g?: number; b?: number;
  alpha?: number;
  cell: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** Seconds to fade in. */
  fadeIn?: number;
}

class Particles {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly data: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly misc: Float32Array; // size0, grow, gravity, drag
  private readonly misc2: Float32Array; // alpha, spin, fadeIn
  private cursor = 0;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(n: number, map: THREE.Texture, additive: boolean, scene: THREE.Scene) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.data = new Float32Array(n * 4);
    this.col = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.misc = new Float32Array(n * 4);
    this.misc2 = new Float32Array(n * 3);
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("uv", base.getAttribute("uv"));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aData", new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = n;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: "" } : {},
    });
    mat.uniforms.map.value = map;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 21 : 20;
    scene.add(this.mesh);
  }

  spawn(s: Spawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = s.x;
    this.pos[i * 3 + 1] = s.y;
    this.pos[i * 3 + 2] = s.z;
    this.vel[i * 3] = s.vx ?? 0;
    this.vel[i * 3 + 1] = s.vy ?? 0;
    this.vel[i * 3 + 2] = s.vz ?? 0;
    this.life[i] = s.life;
    this.max[i] = s.life;
    this.misc[i * 4] = s.size;
    this.misc[i * 4 + 1] = s.grow ?? 1;
    this.misc[i * 4 + 2] = s.gravity ?? 0;
    this.misc[i * 4 + 3] = s.drag ?? 0;
    this.misc2[i * 3] = s.alpha ?? 1;
    this.misc2[i * 3 + 1] = s.spin ?? 0;
    this.misc2[i * 3 + 2] = s.fadeIn ?? 0;
    this.data[i * 4] = s.size;
    this.data[i * 4 + 1] = Math.random() * 6.283;
    this.data[i * 4 + 2] = s.cell;
    this.col[i * 4] = s.r ?? 1;
    this.col[i * 4 + 1] = s.g ?? 1;
    this.col[i * 4 + 2] = s.b ?? 1;
    this.col[i * 4 + 3] = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        this.data[i * 4] = 0;
        continue;
      }
      const drag = Math.max(0, 1 - this.misc[i * 4 + 3] * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - this.misc[i * 4 + 2] * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.data[i * 4] = this.misc[i * 4] * (1 + (this.misc[i * 4 + 1] - 1) * Math.sqrt(t));
      this.data[i * 4 + 1] += this.misc2[i * 3 + 1] * dt;
      const fi = this.misc2[i * 3 + 2];
      const age = this.max[i] - this.life[i];
      const fadeIn = fi > 0 ? Math.min(1, age / fi) : 1;
      this.col[i * 4 + 3] = this.misc2[i * 3] * fadeIn * (1 - t) * (1 - t * t);
    }
    (this.geo.getAttribute("aPos") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aData") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; dist: number; t: number; speed: number; active: boolean }
interface Shell { pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; life: number; floor: number; bounced: number }
interface FlashLight { light: THREE.PointLight; life: number; max: number; power: number }

const SURF_DUST: Record<number, [number, number, number]> = {
  [Surf.Concrete]: [0.62, 0.6, 0.56],
  [Surf.Plaster]: [0.74, 0.72, 0.66],
  [Surf.Asphalt]: [0.28, 0.28, 0.29],
  [Surf.Dirt]: [0.42, 0.33, 0.24],
  [Surf.Grass]: [0.36, 0.34, 0.22],
  [Surf.Wood]: [0.5, 0.4, 0.28],
  [Surf.Tile]: [0.7, 0.68, 0.62],
  [Surf.Sandbag]: [0.6, 0.52, 0.38],
  [Surf.Metal]: [0.4, 0.4, 0.4],
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0, 1);

export class Vfx {
  private readonly smoke: Particles;
  private readonly glow: Particles;
  private readonly tracers: Tracer[] = [];
  private readonly decals: THREE.InstancedMesh;
  private decalCursor = 0;
  private readonly shellMesh: THREE.InstancedMesh;
  private readonly shells: Shell[] = [];
  private readonly lights: FlashLight[] = [];
  /** Sun colour used to light smoke; set once from the atmosphere. */
  private readonly lit = new THREE.Color(1.0, 0.9, 0.78);

  constructor(private readonly engine: Engine) {
    const atlas = particleAtlas();
    this.smoke = new Particles(1400, atlas, false, engine.scene);
    this.glow = new Particles(700, atlas, true, engine.scene);

    const tracerTex = canvasTex(64, 16, (c) => {
      const g = c.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, "rgba(255,200,120,0)");
      g.addColorStop(0.7, "rgba(255,220,150,0.9)");
      g.addColorStop(1, "rgba(255,255,240,1)");
      c.fillStyle = g;
      c.fillRect(0, 5, 64, 6);
    });
    const tmat = new THREE.MeshBasicMaterial({ map: tracerTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: new THREE.Color(3.0, 2.2, 1.2), side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tmat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 22;
      engine.scene.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, speed: 0, active: false });
    }

    const holeTex = canvasTex(64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, "rgba(6,6,6,1)");
      g.addColorStop(0.22, "rgba(14,13,12,0.95)");
      g.addColorStop(0.34, "rgba(120,116,108,0.75)");
      g.addColorStop(0.55, "rgba(60,58,54,0.3)");
      g.addColorStop(1, "rgba(40,40,40,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      const r = rng(4);
      c.strokeStyle = "rgba(20,20,20,0.6)";
      for (let i = 0; i < 7; i++) {
        const a = r() * 6.3;
        c.lineWidth = 0.6 + r();
        c.beginPath();
        c.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
        c.lineTo(32 + Math.cos(a) * (14 + r() * 12), 32 + Math.sin(a) * (14 + r() * 12));
        c.stroke();
      }
    });
    const dmat = engine.lit(new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dmat, 320);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    engine.scene.add(this.decals);

    const brass = engine.lit(new THREE.MeshStandardMaterial({ color: 0xc09a42, metalness: 1, roughness: 0.32 }));
    this.shellMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0056, 0.0056, 0.044, 7), brass, 60);
    this.shellMesh.count = 0;
    this.shellMesh.frustumCulled = false;
    this.shellMesh.castShadow = false;
    engine.scene.add(this.shellMesh);

    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffc880, 0, 18, 2);
      engine.scene.add(light);
      this.lights.push({ light, life: 0, max: 1, power: 0 });
    }
  }

  // ---- primitives ----------------------------------------------------------

  flashLight(pos: THREE.Vector3, power: number, life: number, color = 0xffc880, range = 16): void {
    let best = this.lights[0];
    for (const l of this.lights) if (l.life < best.life) best = l;
    best.light.position.copy(pos);
    best.light.color.setHex(color);
    best.light.distance = range;
    best.life = best.max = life;
    best.power = power;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, speed = 420): void {
    const t = this.tracers.find((x) => !x.active);
    if (!t) return;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 3) return;
    t.dir.multiplyScalar(1 / t.dist);
    t.t = 0;
    t.speed = speed;
    t.active = true;
  }

  decal(point: THREE.Vector3, normal: THREE.Vector3, size: number, shade = 1): void {
    const i = this.decalCursor;
    this.decalCursor = (this.decalCursor + 1) % 320;
    this.decals.count = Math.min(320, this.decals.count + 1);
    _q.setFromUnitVectors(_up, normal);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, Math.random() * 6.283));
    _m.compose(_v.copy(point).addScaledVector(normal, 0.004), _q, _s.set(size, size, size));
    this.decals.setMatrixAt(i, _m);
    this.decals.setColorAt(i, new THREE.Color(shade, shade, shade));
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  shell(pos: THREE.Vector3, vel: THREE.Vector3, floorY: number): void {
    if (this.shells.length >= 60) this.shells.shift();
    this.shells.push({ pos: pos.clone(), vel: vel.clone(), rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), spin: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30), life: 6, floor: floorY, bounced: 0 });
  }

  // ---- composite effects -----------------------------------------------------

  /** World-space muzzle blast (third-person shooters; the viewmodel has its own flash mesh). */
  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1, withFlash = true): void {
    if (withFlash) {
      this.glow.spawn({ x: pos.x + dir.x * 0.12, y: pos.y + dir.y * 0.12, z: pos.z + dir.z * 0.12, life: 0.05, size: 0.55 * scale, cell: PC.flash0 + Math.floor(Math.random() * 3), r: 3.2, g: 2.4, b: 1.4, alpha: 1.6 });
      this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.07, size: 1.3 * scale, cell: PC.glow, r: 2.0, g: 1.3, b: 0.6, alpha: 0.5 });
    }
    for (let i = 0; i < 2; i++) {
      const sp = 1.5 + Math.random() * 3;
      this.smoke.spawn({ x: pos.x + dir.x * 0.2, y: pos.y + dir.y * 0.2, z: pos.z + dir.z * 0.2, vx: dir.x * sp + (Math.random() - 0.5), vy: dir.y * sp + 0.4 + Math.random() * 0.5, vz: dir.z * sp + (Math.random() - 0.5), life: 0.7 + Math.random() * 0.5, size: 0.14 * scale, grow: 5, cell: PC.smoke0 + Math.floor(Math.random() * 4), r: 0.72, g: 0.7, b: 0.68, alpha: 0.22, drag: 3.2, spin: (Math.random() - 0.5) * 2 });
    }
  }

  /** Bullet strike on the world: dust/sparks by surface, chips, a decal. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surf: Surf): void {
    const dust = SURF_DUST[surf] ?? SURF_DUST[Surf.Concrete];
    const k = 0.9;
    const metal = surf === Surf.Metal;
    const soft = surf === Surf.Grass || surf === Surf.Dirt || surf === Surf.Sandbag || surf === Surf.Foliage;
    if (surf !== Surf.Water && surf !== Surf.Foliage) this.decal(point, normal, metal ? 0.07 : 0.11 + Math.random() * 0.05, metal ? 0.6 : 1);
    const puffs = metal ? 1 : soft ? 4 : 3;
    for (let i = 0; i < puffs; i++) {
      const sp = 0.8 + Math.random() * 2.4;
      this.smoke.spawn({
        x: point.x + normal.x * 0.05, y: point.y + normal.y * 0.05, z: point.z + normal.z * 0.05,
        vx: normal.x * sp + (Math.random() - 0.5) * 1.6, vy: normal.y * sp + (Math.random() - 0.3) * 1.6, vz: normal.z * sp + (Math.random() - 0.5) * 1.6,
        life: 0.5 + Math.random() * 0.6, size: 0.12, grow: 6 + Math.random() * 3, cell: PC.dust,
        r: dust[0] * this.lit.r * k, g: dust[1] * this.lit.g * k, b: dust[2] * this.lit.b * k, alpha: metal ? 0.25 : 0.55, drag: 3.5, gravity: -0.3, spin: (Math.random() - 0.5) * 3,
      });
    }
    const chips = metal ? 0 : 4;
    for (let i = 0; i < chips; i++) {
      const sp = 2 + Math.random() * 4;
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * sp + (Math.random() - 0.5) * 3, vy: normal.y * sp + Math.random() * 2.5, vz: normal.z * sp + (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.4, size: 0.02 + Math.random() * 0.03, cell: PC.chip, r: dust[0] * 0.8, g: dust[1] * 0.8, b: dust[2] * 0.8, alpha: 2.5, gravity: 9.8, drag: 0.4, spin: (Math.random() - 0.5) * 30,
      });
    }
    if (metal || (!soft && Math.random() < 0.3)) {
      const n = metal ? 7 : 3;
      for (let i = 0; i < n; i++) {
        const sp = 4 + Math.random() * 9;
        this.glow.spawn({
          x: point.x, y: point.y, z: point.z,
          vx: normal.x * sp + (Math.random() - 0.5) * 6, vy: normal.y * sp + (Math.random() - 0.2) * 6, vz: normal.z * sp + (Math.random() - 0.5) * 6,
          life: 0.12 + Math.random() * 0.22, size: 0.035, cell: PC.spark, r: 3.5, g: 2.4, b: 1.0, alpha: 2, gravity: 9, drag: 1.5,
        });
      }
      this.glow.spawn({ x: point.x, y: point.y, z: point.z, life: 0.05, size: 0.35, cell: PC.glow, r: 2.5, g: 1.8, b: 0.9, alpha: 0.7 });
    }
  }

  blood(point: THREE.Vector3, dir: THREE.Vector3): void {
    for (let i = 0; i < 5; i++) {
      const sp = 1 + Math.random() * 3;
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * sp + (Math.random() - 0.5) * 2, vy: dir.y * sp + (Math.random() - 0.3) * 2, vz: dir.z * sp + (Math.random() - 0.5) * 2,
        life: 0.35 + Math.random() * 0.25, size: 0.08, grow: 4, cell: PC.blood, r: 0.32, g: 0.02, b: 0.02, alpha: 0.75, drag: 4, gravity: 3,
      });
    }
  }

  /** High-explosive burst: flash, fireball, debris, ground dust ring and a lingering smoke column. */
  explosion(pos: THREE.Vector3, scale = 1): void {
    this.flashLight(_v.copy(pos).setY(pos.y + 1), 900 * scale, 0.35, 0xffb060, 40);
    this.glow.spawn({ x: pos.x, y: pos.y + 0.6, z: pos.z, life: 0.12, size: 9 * scale, cell: PC.glow, r: 4, g: 3, b: 1.8, alpha: 1.5 });
    this.glow.spawn({ x: pos.x, y: pos.y + 0.2, z: pos.z, life: 0.35, size: 2 * scale, grow: 5, cell: PC.ring, r: 1.2, g: 1.0, b: 0.8, alpha: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.283;
      const sp = 2 + Math.random() * 6;
      this.glow.spawn({ x: pos.x, y: pos.y + 0.4, z: pos.z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 6, vz: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.3, size: 1.2 * scale, grow: 2.6, cell: PC.fire0 + (i % 2), r: 3.4, g: 1.7, b: 0.5, alpha: 1.3, drag: 3.5, spin: (Math.random() - 0.5) * 4 });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283;
      const sp = 1 + Math.random() * 7;
      const up = i < 10;
      this.smoke.spawn({
        x: pos.x + Math.cos(a) * 0.5, y: pos.y + 0.3, z: pos.z + Math.sin(a) * 0.5,
        vx: Math.cos(a) * sp * (up ? 0.3 : 1), vy: up ? 3 + Math.random() * 5 : 0.4 + Math.random() * 1.5, vz: Math.sin(a) * sp * (up ? 0.3 : 1),
        life: 2.5 + Math.random() * 3.5, size: 1.0 * scale, grow: 4.5, cell: PC.smoke0 + (i % 4),
        r: up ? 0.16 : 0.42, g: up ? 0.15 : 0.38, b: up ? 0.14 : 0.32, alpha: 0.7, drag: 1.6, gravity: -0.5, spin: (Math.random() - 0.5) * 1.2, fadeIn: 0.12,
      });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.283;
      const sp = 4 + Math.random() * 12;
      this.smoke.spawn({ x: pos.x, y: pos.y + 0.2, z: pos.z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 11, vz: Math.sin(a) * sp, life: 1 + Math.random() * 1.2, size: 0.05 + Math.random() * 0.08, cell: PC.chip, r: 0.2, g: 0.19, b: 0.17, alpha: 3, gravity: 9.8, drag: 0.3, spin: (Math.random() - 0.5) * 30 });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.283;
      const sp = 8 + Math.random() * 16;
      this.glow.spawn({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 10, vz: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.5, size: 0.06, cell: PC.spark, r: 4, g: 2.4, b: 0.8, alpha: 2, gravity: 9, drag: 1 });
    }
  }

  /** One puff of a standing smoke column (burning wrecks, distant fires). Call on a timer. */
  smokePuff(pos: THREE.Vector3, size: number, dark = 0.14): void {
    this.smoke.spawn({ x: pos.x + (Math.random() - 0.5) * size * 0.4, y: pos.y, z: pos.z + (Math.random() - 0.5) * size * 0.4, vx: 0.5 + Math.random() * 0.6, vy: 1.6 + Math.random() * 1.2, vz: -0.3 + Math.random() * 0.4, life: 7 + Math.random() * 4, size, grow: 5, cell: PC.smoke0 + Math.floor(Math.random() * 4), r: dark, g: dark, b: dark * 0.95, alpha: 0.6, drag: 0.12, spin: (Math.random() - 0.5) * 0.5, fadeIn: 0.8 });
  }

  firePuff(pos: THREE.Vector3, size: number): void {
    this.glow.spawn({ x: pos.x + (Math.random() - 0.5) * size, y: pos.y, z: pos.z + (Math.random() - 0.5) * size, vy: 1 + Math.random() * 1.4, life: 0.5 + Math.random() * 0.4, size, grow: 0.5, cell: PC.fire0 + Math.floor(Math.random() * 2), r: 3, g: 1.5, b: 0.4, alpha: 0.9, spin: (Math.random() - 0.5) * 3, fadeIn: 0.08 });
  }

  /** Drifting motes: dust and ash hanging in the afternoon light near the camera. */
  mote(pos: THREE.Vector3): void {
    this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * 0.3 + 0.25, vy: (Math.random() - 0.5) * 0.12, vz: (Math.random() - 0.5) * 0.3, life: 5 + Math.random() * 4, size: 0.012 + Math.random() * 0.018, cell: PC.spark, r: 1.6, g: 1.4, b: 1.1, alpha: 0.5, fadeIn: 1.2 });
  }

  update(dt: number, camera: THREE.Camera): void {
    this.smoke.update(dt);
    this.glow.update(dt);
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt * t.speed;
      const head = Math.min(t.dist, t.t);
      const tail = Math.max(0, head - Math.min(14, t.dist * 0.5));
      if (t.t - 14 > t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const len = Math.max(0.01, head - tail);
      _v.copy(t.from).addScaledVector(t.dir, (head + tail) / 2);
      _side.subVectors(camera.position, _v).cross(t.dir).normalize();
      const nrm = new THREE.Vector3().crossVectors(t.dir, _side);
      const w = 0.035 + _v.distanceTo(camera.position) * 0.0016;
      _m.makeBasis(t.dir.clone().multiplyScalar(len), _side.clone().multiplyScalar(w), nrm).setPosition(_v);
      t.mesh.matrix.copy(_m);
      t.mesh.visible = true;
    }
    let n = 0;
    for (const s of this.shells) {
      s.life -= dt;
      if (s.bounced < 3) {
        s.vel.y -= 9.8 * dt;
        s.pos.addScaledVector(s.vel, dt);
        s.rot.x += s.spin.x * dt;
        s.rot.y += s.spin.y * dt;
        s.rot.z += s.spin.z * dt;
        if (s.pos.y < s.floor + 0.006) {
          s.pos.y = s.floor + 0.006;
          s.vel.y *= -0.35;
          s.vel.x *= 0.5;
          s.vel.z *= 0.5;
          s.spin.multiplyScalar(0.4);
          s.bounced++;
          if (s.bounced === 1) this.onShellLand?.(s.pos);
          if (s.bounced >= 3) s.rot.set(Math.PI / 2, s.rot.y, 0);
        }
      }
      _m.compose(s.pos, _q.setFromEuler(s.rot), _s.set(1, 1, 1));
      this.shellMesh.setMatrixAt(n++, _m);
    }
    this.shellMesh.count = n;
    this.shellMesh.instanceMatrix.needsUpdate = true;
    for (const l of this.lights) {
      if (l.life > 0) {
        l.life -= dt;
        l.light.intensity = l.power * Math.max(0, l.life / l.max);
      } else l.light.intensity = 0;
    }
  }

  onShellLand?: (pos: THREE.Vector3) => void;
}
