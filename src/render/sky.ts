import { Color3, Effect, Mesh, MeshBuilder, ReflectionProbe, Scene, ShaderMaterial, Vector3 } from "@babylonjs/core";

/**
 * Procedural sky dome (ART_DIRECTION.md §7). Colour is computed per pixel
 * from the view direction — zenith-to-horizon gradient, humid horizon haze,
 * a sun disc and glow placed exactly along the scene's sun light, a soft
 * cumulus band near the horizon, and stars at night. Because nothing is
 * painted onto faces there are no seams and exactly one sun, wherever the
 * light actually comes from. The same dome feeds the PBR environment via a
 * reflection probe, so metal and glass reflect the sky the player sees.
 */

const VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;      // direction TOWARDS the sun
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunColor;
uniform float sunSize;    // cos of disc angular radius
uniform float night;      // 0 day .. 1 night
uniform float cloudCover;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Gradient: haze is thick near the horizon (tropical humidity), clean blue overhead.
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(horizon, zenith, t);
  // Below the horizon fades to a dim ground tone (only visible from heights).
  col = mix(col, ground, smoothstep(0.0, -0.18, h));

  float cosSun = dot(d, normalize(sunDir));
  // Mie-like forward glow around the sun, stronger in haze near the horizon.
  float glow = pow(max(cosSun, 0.0), 8.0) * 0.35 + pow(max(cosSun, 0.0), 64.0) * 0.6;
  col += sunColor * glow * (1.0 - 0.75 * night);

  // Cumulus band: projected onto a flat cloud layer so clouds shrink toward the horizon.
  if (h > 0.01) {
    vec2 uv = d.xz / (h + 0.08) * 1.6;
    float c = fbm(uv * 0.9 + 3.1);
    float band = smoothstep(0.55 - cloudCover * 0.25, 0.85, c) * smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.35, 0.8, h));
    vec3 lit = mix(vec3(0.92, 0.93, 0.95), sunColor, 0.25) * (1.0 - 0.85 * night) + vec3(0.03, 0.035, 0.04) * night;
    vec3 shade = mix(horizon * 0.82, vec3(0.05, 0.06, 0.07), night);
    vec3 cloud = mix(shade, lit, clamp(0.5 + 0.5 * cosSun, 0.0, 1.0) * 0.6 + 0.4 * (1.0 - c));
    col = mix(col, cloud, band * 0.85);
  }

  // Sun or moon disc with a soft limb.
  float disc = smoothstep(sunSize - 0.00004, sunSize + 0.00002, cosSun);
  col = mix(col, sunColor * (night > 0.5 ? 1.2 : 6.0), disc);

  // Stars at night, faded by horizon haze.
  if (night > 0.0 && h > 0.0) {
    vec2 sp = floor(d.xz / (h + 0.3) * 260.0);
    float s = step(0.9975, hash(sp)) * smoothstep(0.05, 0.4, h);
    col += vec3(s) * 0.8 * night;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

Effect.ShadersStore["enlistedSkyVertexShader"] = VERT;
Effect.ShadersStore["enlistedSkyFragmentShader"] = FRAG;

export interface SkyPreset {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
  sunColor: Color3;
  /** Angular radius of the disc, degrees. */
  sunDeg: number;
  night: number;
  cloudCover: number;
}

export const SKY_DAY: SkyPreset = {
  zenith: Color3.FromHexString("#4f80b8"),
  horizon: Color3.FromHexString("#cdd6d6"),
  ground: Color3.FromHexString("#6d7064"),
  sunColor: Color3.FromHexString("#fff1d6"),
  sunDeg: 0.9,
  night: 0,
  cloudCover: 0.55,
};

export const SKY_NIGHT: SkyPreset = {
  zenith: Color3.FromHexString("#03060b"),
  horizon: Color3.FromHexString("#18211f"),
  ground: Color3.FromHexString("#050706"),
  sunColor: Color3.FromHexString("#c9d6ec"),
  sunDeg: 0.7,
  night: 1,
  cloudCover: 0.45,
};

export interface Sky {
  mesh: Mesh;
  material: ShaderMaterial;
  probe: ReflectionProbe;
  /** Re-point the disc (pass the light's direction, i.e. FROM the sun) and re-render the environment. */
  setSun(lightDirection: Vector3): void;
  setPreset(p: SkyPreset): void;
}

export function buildSky(scene: Scene, lightDirection: Vector3, preset: SkyPreset): Sky {
  const mesh = MeshBuilder.CreateSphere("skyDome", { diameter: 1000, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.applyFog = false;
  const material = new ShaderMaterial("skyMat", scene, { vertex: "enlistedSky", fragment: "enlistedSky" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "sunDir", "zenith", "horizon", "ground", "sunColor", "sunSize", "night", "cloudCover"],
  });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  mesh.material = material;
  mesh.renderingGroupId = 0;

  // Environment for PBR reflections: render the dome alone, once per change.
  const probe = new ReflectionProbe("skyProbe", 128, scene);
  probe.renderList!.push(mesh);
  probe.refreshRate = 0; // RENDER_ONCE; re-armed by setSun/setPreset
  scene.environmentTexture = probe.cubeTexture;

  const apply = (p: SkyPreset) => {
    material.setColor3("zenith", p.zenith.toLinearSpace());
    material.setColor3("horizon", p.horizon.toLinearSpace());
    material.setColor3("ground", p.ground.toLinearSpace());
    material.setColor3("sunColor", p.sunColor.toLinearSpace());
    material.setFloat("sunSize", Math.cos((p.sunDeg * Math.PI) / 180));
    material.setFloat("night", p.night);
    material.setFloat("cloudCover", p.cloudCover);
    probe.refreshRate = 0;
  };
  const setSun = (dir: Vector3) => {
    material.setVector3("sunDir", dir.normalizeToNew().scale(-1));
    probe.refreshRate = 0;
  };
  apply(preset);
  setSun(lightDirection);
  return { mesh, material, probe, setSun, setPreset: apply };
}
