import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { Atmosphere, SKY, installFog, type AtmosphereConfig } from "~/gfx/atmosphere";
import { noiseTex } from "~/gfx/textures";

export type Quality = "low" | "medium" | "high" | "ultra";

interface QualityPreset {
  pixelRatio: number;
  cascades: number;
  shadowSize: number;
  shadowFar: number;
  ao: boolean;
  aoHalfRes: boolean;
  smaa: boolean;
  bloom: boolean;
}

const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.8, cascades: 2, shadowSize: 1024, shadowFar: 90, ao: false, aoHalfRes: true, smaa: false, bloom: true },
  medium: { pixelRatio: 1, cascades: 3, shadowSize: 1536, shadowFar: 130, ao: true, aoHalfRes: true, smaa: true, bloom: true },
  high: { pixelRatio: 1.25, cascades: 3, shadowSize: 2048, shadowFar: 170, ao: true, aoHalfRes: true, smaa: true, bloom: true },
  ultra: { pixelRatio: 1.5, cascades: 4, shadowSize: 2048, shadowFar: 220, ao: true, aoHalfRes: false, smaa: true, bloom: true },
};

/**
 * Uniforms shared by every world material. They are injected by reference in
 * `Engine.lit()`, so updating a value here updates every compiled program.
 */
export const shared = {
  /** Baked light volume: R = sky visibility, G = artificial (lamp) light. */
  uVisTex: { value: null as THREE.Data3DTexture | null },
  uVisMin: { value: new THREE.Vector3() },
  uVisInv: { value: new THREE.Vector3(1, 1, 1) },
  uLamp: { value: new THREE.Color(1.0, 0.86, 0.66) },
  uMacro: { value: null as THREE.Texture | null },
  uTime: { value: 0 },
  uWet: { value: 0 },
};

export interface LitOpts {
  /** Large-scale grime/colour variation from world position (breaks up texture tiling). */
  macro?: number;
  /** Vertex sway for foliage: needs a float `aWind` attribute (0 = rooted, 1 = free). */
  wind?: boolean;
  /** First-person geometry: squeeze into the front of the depth range so it never clips into walls. */
  viewmodel?: boolean;
  /** Skip the baked light volume (emissive / unlit-ish things). */
  noVis?: boolean;
}

/** Final colour grade + screen-space combat feedback, applied after tone mapping. */
class GradeEffect extends Effect {
  constructor() {
    super(
      "GradeEffect",
      /* glsl */ `
uniform float uDamage;
uniform float uDesat;
uniform float uFlash;
uniform float uTimeG;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Split tone: cool olive shadows, warm highlights (humid late-afternoon film stock).
  c += vec3(-0.012, 0.004, 0.012) * (1.0 - smoothstep(0.0, 0.35, l));
  c += vec3(0.022, 0.008, -0.022) * smoothstep(0.55, 1.0, l);
  // Gentle S-curve.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
  // Saturation, pulled further down when hurt.
  float sat = 1.06 - uDesat * 0.7;
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, sat);
  // Vignette, reddened by damage.
  vec2 q = uv - 0.5;
  float v = dot(q, q);
  c *= 1.0 - v * 0.62;
  c = mix(c, vec3(0.42, 0.02, 0.01), clamp(uDamage * smoothstep(0.08, 0.5, v) * 1.6, 0.0, 0.85));
  c = mix(c, vec3(1.0), uFlash);
  // Fine grain hides banding in the sky and fog gradients.
  c += (hash12(uv * vec2(1920.0, 1080.0) + uTimeG * 60.0) - 0.5) * 0.022;
  outputColor = vec4(c, inputColor.a);
}`,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map<string, THREE.Uniform>([
          ["uDamage", new THREE.Uniform(0)],
          ["uDesat", new THREE.Uniform(0)],
          ["uFlash", new THREE.Uniform(0)],
          ["uTimeG", new THREE.Uniform(0)],
        ]),
      }
    );
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly atmosphere: Atmosphere;
  readonly csm: CSM;
  readonly grade = new GradeEffect();
  quality: Quality;
  time = 0;
  private composer!: EffectComposer;
  private ao: N8AOPostPass | null = null;
  private readonly litMaterials = new Set<THREE.Material>();

  constructor(readonly canvas: HTMLCanvasElement, atmo: AtmosphereConfig, quality: Quality) {
    this.quality = quality;
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 0.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 1600);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    this.atmosphere = new Atmosphere(atmo);
    installFog(this.atmosphere, 0.022);
    this.scene.fog = new THREE.FogExp2(this.atmosphere.fogColor, 0.0034);
    this.scene.add(this.atmosphere.dome);
    this.scene.environment = this.atmosphere.buildEnvironment(this.renderer);
    this.scene.environmentIntensity = 1.35;
    // Warm ground bounce + cool sky fill, so shade is readable rather than black.
    this.scene.add(new THREE.HemisphereLight(0xa9c4ee, 0x9a8466, 0.85));

    shared.uMacro.value = noiseTex(256, 3, 5, 77);
    const blank = new THREE.Data3DTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, 1);
    blank.format = THREE.RGBAFormat;
    blank.needsUpdate = true;
    shared.uVisTex.value = blank;

    this.csm = new CSM({
      maxFar: q.shadowFar,
      cascades: q.cascades,
      mode: "practical",
      parent: this.scene,
      shadowMapSize: q.shadowSize,
      lightDirection: this.atmosphere.sunDir.clone().multiplyScalar(-1),
      camera: this.camera,
      lightIntensity: 6.2,
      lightNear: 1,
      lightFar: 600,
      lightMargin: 120,
      shadowBias: -0.00015,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.color.copy(SKY.sunLight);
      l.shadow.normalBias = 0.045;
    }

    this.buildComposer();
    window.addEventListener("resize", () => this.resize());
  }

  private buildComposer(): void {
    const q = QUALITY[this.quality];
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 3.2;
      ao.configuration.aoSamples = 12;
      ao.configuration.denoiseSamples = 6;
      ao.configuration.denoiseRadius = 10;
      ao.configuration.halfRes = q.aoHalfRes;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.color = new THREE.Color(0.02, 0.025, 0.03);
      composer.addPass(ao);
      this.ao = ao;
    }
    const effects: Effect[] = [];
    if (q.bloom) {
      effects.push(new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.55, radius: 0.72 }));
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    effects.push(this.grade);
    composer.addPass(new EffectPass(this.camera, ...effects));
    if (q.smaa) composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer = composer;
  }

  /**
   * Register a world material: gives it cascaded shadows, the baked light
   * volume, macro variation and optional wind / viewmodel depth handling.
   * Every lit surface in the game goes through here.
   */
  lit<T extends THREE.Material>(mat: T, opts: LitOpts = {}): T {
    if (this.litMaterials.has(mat)) return mat;
    this.litMaterials.add(mat);
    this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile.bind(mat);
    const macro = opts.macro ?? 0;
    const key = `enl:${macro > 0 ? macro.toFixed(2) : 0}:${opts.wind ? 1 : 0}:${opts.viewmodel ? 1 : 0}:${opts.noVis ? 1 : 0}`;
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = (shader, renderer) => {
      csmHook(shader, renderer);
      shader.uniforms.uVisTex = shared.uVisTex;
      shader.uniforms.uVisMin = shared.uVisMin;
      shader.uniforms.uVisInv = shared.uVisInv;
      shader.uniforms.uLamp = shared.uLamp;
      shader.uniforms.uMacro = shared.uMacro;
      shader.uniforms.uTime = shared.uTime;

      if (opts.wind) {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\nattribute float aWind;\nuniform float uTime;`)
          .replace(
            "#include <begin_vertex>",
            /* glsl */ `#include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec3 wOrigin = instanceMatrix[3].xyz;
    #else
      vec3 wOrigin = modelMatrix[3].xyz;
    #endif
    float wPhase = wOrigin.x * 0.37 + wOrigin.z * 0.51;
    float gust = sin(uTime * 0.7 + wPhase) * 0.6 + sin(uTime * 1.9 + wPhase * 2.3 + position.y * 0.8) * 0.4;
    float flutter = sin(uTime * 5.3 + position.x * 3.1 + position.z * 2.7 + wPhase) * 0.25;
    transformed.x += (gust * 0.09 + flutter * 0.02) * aWind;
    transformed.z += (gust * 0.05 - flutter * 0.02) * aWind;
  }`
          );
      }
      if (opts.viewmodel) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <project_vertex>",
          `#include <project_vertex>\n  gl_Position.z = (gl_Position.z / gl_Position.w * 0.04 - 0.96) * gl_Position.w;`
        );
      }

      let frag = shader.fragmentShader.replace(
        "#include <common>",
        /* glsl */ `#include <common>
precision highp sampler3D;
uniform sampler3D uVisTex;
uniform vec3 uVisMin;
uniform vec3 uVisInv;
uniform vec3 uLamp;
uniform sampler2D uMacro;`
      );
      if (macro > 0) {
        frag = frag.replace(
          "#include <map_fragment>",
          /* glsl */ `#include <map_fragment>
  {
    vec3 mp = vFogWorld;
    float mA = texture2D(uMacro, mp.xz * 0.037 + mp.y * 0.019).r;
    float mB = texture2D(uMacro, mp.xz * 0.009 + mp.y * 0.006).g;
    float mC = texture2D(uMacro, vec2(mp.x + mp.z, mp.y) * 0.11).b;
    float mK = ${macro.toFixed(3)};
    diffuseColor.rgb *= 1.0 + ((mA - 0.5) * 0.5 + (mB - 0.5) * 0.36 + (mC - 0.5) * 0.14) * mK;
  }`
        );
      }
      if (!opts.noVis) {
        frag = frag.replace(
          "#include <lights_fragment_end>",
          /* glsl */ `#include <lights_fragment_end>
  {
    vec3 wN = inverseTransformDirection(normal, viewMatrix);
    vec3 vp = (vFogWorld + wN * 0.5 - uVisMin) * uVisInv;
    vec4 vis = texture(uVisTex, clamp(vp, 0.0, 1.0));
    float skyV = vis.r;
    reflectedLight.indirectDiffuse *= skyV;
    reflectedLight.indirectSpecular *= mix(0.18, 1.0, skyV);
    reflectedLight.indirectDiffuse += vis.g * 2.4 * uLamp * BRDF_Lambert(material.diffuseColor);
  }`
        );
      }
      shader.fragmentShader = frag;
    };
    return mat;
  }

  setQuality(qual: Quality): void {
    this.quality = qual;
    const q = QUALITY[qual];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);
    this.composer.dispose();
    this.buildComposer();
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.csm.updateFrustums();
  }

  setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.csm.updateFrustums();
  }

  render(dt: number): void {
    this.time += dt;
    shared.uTime.value = this.time;
    this.atmosphere.update(this.time);
    (this.grade.uniforms.get("uTimeG") as THREE.Uniform).value = this.time;
    this.camera.updateMatrixWorld();
    this.csm.update();
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  /** Feedback uniforms for the grade pass (0..1 each). */
  setFeedback(damage: number, desat: number, flash: number): void {
    (this.grade.uniforms.get("uDamage") as THREE.Uniform).value = damage;
    (this.grade.uniforms.get("uDesat") as THREE.Uniform).value = desat;
    (this.grade.uniforms.get("uFlash") as THREE.Uniform).value = flash;
  }
}
