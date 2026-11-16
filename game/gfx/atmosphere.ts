import * as THREE from "three";
import { noiseTex } from "./textures";

/**
 * Sky, sun and aerial perspective for a late-afternoon tropical sky: low warm
 * sun through humid haze, broken cumulus overhead and storm towers stacked on
 * the horizon. One shader draws the dome; the same colours are compiled into
 * the global fog chunk so distant geometry dissolves into exactly the sky that
 * is behind it (the cheapest and most convincing "depth" cue there is).
 */

export interface AtmosphereConfig {
  /** Sun azimuth in degrees, measured from +X towards +Z. */
  sunAzimuth: number;
  /** Sun elevation above the horizon in degrees. */
  sunElevation: number;
  cloudCover: number;
}

const glsl = (v: THREE.Vector3 | THREE.Color): string =>
  v instanceof THREE.Color ? `vec3(${v.r.toFixed(4)}, ${v.g.toFixed(4)}, ${v.b.toFixed(4)})` : `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

/** Linear HDR colours shared by the dome and the fog. */
export const SKY = {
  zenith: new THREE.Color(0.1, 0.24, 0.52),
  mid: new THREE.Color(0.3, 0.47, 0.7),
  horizon: new THREE.Color(0.74, 0.7, 0.62),
  sunGlow: new THREE.Color(1.25, 0.82, 0.46),
  sunLight: new THREE.Color(1.0, 0.83, 0.62),
  ground: new THREE.Color(0.12, 0.115, 0.1),
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 0.0);
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w; // pin to the far plane
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform float time;
uniform float cover;
uniform float envMode;
uniform sampler2D noiseTex;

const vec3 ZENITH = ${glsl(SKY.zenith)};
const vec3 MID = ${glsl(SKY.mid)};
const vec3 HORIZON = ${glsl(SKY.horizon)};
const vec3 SUNGLOW = ${glsl(SKY.sunGlow)};
const vec3 GROUND = ${glsl(SKY.ground)};

float cloudField(vec2 p, vec2 wind) {
  float n = texture2D(noiseTex, p * 0.011 + wind).r * 0.56
          + texture2D(noiseTex, p * 0.029 - wind * 0.6).g * 0.28
          + texture2D(noiseTex, p * 0.083 + wind * 1.7).b * 0.16;
  return n;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float sd = max(dot(d, sunDir), 0.0);
  float low = pow(1.0 - h, 6.0);

  vec3 col = mix(ZENITH, MID, pow(1.0 - h, 1.7));
  col = mix(col, HORIZON, low);
  // Forward scattering: the whole sky warms toward the sun, most in the haze layer.
  col += SUNGLOW * (pow(sd, 5.0) * 0.28 + pow(sd, 40.0) * 0.55) * (0.35 + 0.65 * low);

  // Storm towers on the horizon: a ragged skyline of cumulonimbus, lit from the sun side.
  float az = atan(d.z, d.x);
  vec2 tp = vec2(az * 1.9, d.y * 5.0);
  float ridge = texture2D(noiseTex, vec2(az * 0.16, 0.37)).r * 0.26 + texture2D(noiseTex, vec2(az * 0.47, 0.71)).g * 0.1;
  float billow = texture2D(noiseTex, tp * 0.35 + vec2(time * 0.0006, 0.0)).g * 0.09 + texture2D(noiseTex, tp * 0.9).b * 0.04;
  float tower = smoothstep(ridge - 0.05 + billow, ridge - 0.12 + billow, d.y) * smoothstep(-0.01, 0.02, d.y);
  float towerLit = clamp(0.35 + 0.65 * dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0, 1.0);
  float shade = smoothstep(0.0, ridge, d.y);
  vec3 towerCol = mix(vec3(0.44, 0.47, 0.54), vec3(1.05, 0.92, 0.78), towerLit * (0.35 + 0.65 * shade));
  towerCol = mix(HORIZON * 0.95, towerCol, smoothstep(0.0, 0.11, d.y));
  col = mix(col, towerCol, tower * 0.9);

  // Overhead cumulus on a flattened plane, self-shadowed by a second tap toward the sun.
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.16) * 60.0;
    vec2 wind = vec2(time * 0.0016, time * 0.0007);
    float n = cloudField(p, wind);
    float dens = smoothstep(cover, cover + 0.2, n);
    float nSun = cloudField(p + sunDir.xz * 9.0, wind);
    float lit = 1.0 - smoothstep(cover - 0.05, cover + 0.3, nSun) * 0.75;
    vec3 cLit = vec3(1.25, 1.1, 0.93);
    vec3 cShade = vec3(0.38, 0.42, 0.52);
    vec3 cCol = mix(cShade, cLit, lit);
    cCol += SUNGLOW * pow(sd, 10.0) * 0.6 * (1.0 - dens * 0.5);
    float fade = smoothstep(0.02, 0.2, d.y);
    col = mix(col, mix(HORIZON, cCol, fade), dens * fade * 0.94);
  }

  // Sun disc (left out of the reflection probe: the directional light supplies that highlight).
  float disc = smoothstep(0.99955, 0.9998, sd);
  col += vec3(1.0, 0.9, 0.7) * disc * 30.0 * (1.0 - envMode);

  // Below the horizon: what a reflection would see of the ground.
  col = mix(col, GROUND, smoothstep(0.0, -0.18, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Atmosphere {
  readonly sunDir = new THREE.Vector3();
  readonly dome: THREE.Mesh;
  readonly uniforms: { sunDir: { value: THREE.Vector3 }; time: { value: number }; cover: { value: number }; envMode: { value: number }; noiseTex: { value: THREE.Texture } };
  readonly noise: THREE.DataTexture;
  /** Fog colour looking away from the sun; the fog chunk blends toward `SKY.sunGlow` near it. */
  readonly fogColor = SKY.horizon.clone().multiplyScalar(0.92);

  constructor(cfg: AtmosphereConfig) {
    const az = THREE.MathUtils.degToRad(cfg.sunAzimuth);
    const el = THREE.MathUtils.degToRad(cfg.sunElevation);
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    this.noise = noiseTex(256, 4, 5, 11);
    this.uniforms = {
      sunDir: { value: this.sunDir },
      time: { value: 0 },
      cover: { value: 1 - cfg.cloudCover },
      envMode: { value: 0 },
      noiseTex: { value: this.noise },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.matrixAutoUpdate = false;
  }

  /** Prefiltered reflection/irradiance probe of this sky, used as the scene's image-based light. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const scene = new THREE.Scene();
    const probe = new THREE.Mesh(this.dome.geometry, this.dome.material);
    probe.frustumCulled = false;
    scene.add(probe);
    this.uniforms.envMode.value = 1;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(scene, 0, 0.1, 100).texture;
    this.uniforms.envMode.value = 0;
    pmrem.dispose();
    return env;
  }

  update(time: number): void {
    this.uniforms.time.value = time;
  }
}

/**
 * Replace three's fog with height-attenuated exponential fog that picks up the
 * sun's colour when you look toward it. Compiled into every lit material via
 * the shared shader chunks, so it must be installed before any material
 * compiles. Constants are baked in (one fixed time of day) which avoids having
 * to thread custom uniforms through every built-in material.
 */
export function installFog(atmo: Atmosphere, heightFalloff: number): void {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = -mvPosition.z;
  vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogV = vFogWorld - cameraPosition;
    float fogDist = length(fogV);
    vec3 fogDir = fogV / max(fogDist, 1e-4);
    float fogK = fogDir.y * ${heightFalloff.toFixed(5)} * fogDist;
    float fogInt = abs(fogK) > 1e-3 ? (1.0 - exp(-fogK)) / fogK : 1.0;
    float fogOd = fogDensity * exp(-max(cameraPosition.y, 0.0) * ${heightFalloff.toFixed(5)}) * fogDist * fogInt;
    float fogFactor = 1.0 - exp(-fogOd);
    float fogSun = pow(max(dot(fogDir, ${glsl(atmo.sunDir)}), 0.0), 6.0);
    vec3 fogCol = mix(fogColor, ${glsl(SKY.sunGlow)}, fogSun * 0.75);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFactor);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
}
