import {
  Scene,
  Camera,
  Color4,
  ColorCurves,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  SSAO2RenderingPipeline,
} from "@babylonjs/core";

/**
 * Cinematic post-processing on the gameplay camera — the single biggest
 * "looks like a real game, not flat blocks" upgrade available without new
 * assets. FXAA smooths the hard geometry edges, ACES tone mapping + a touch
 * of contrast gives materials a filmic response instead of raw flat shading,
 * gentle bloom lifts emissives (muzzle flashes, lights, tracers), and subtle
 * sharpen/grain/vignette tie the frame together. Everything is tuned low —
 * polish, not an Instagram filter — and it's all GPU-side full-screen work,
 * so the per-frame cost is flat regardless of scene complexity.
 */
export function attachCinematicPipeline(scene: Scene, camera: Camera): DefaultRenderingPipeline {
  const pipeline = new DefaultRenderingPipeline("cinematic", false, scene, [camera]);

  pipeline.fxaaEnabled = true;

  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.82;
  pipeline.bloomWeight = 0.2;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;

  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  // ACES crushes shadows hard on flat-lit low-poly scenes, so run it bright
  // and nearly contrast-neutral — the curve itself supplies the filmic feel.
  ip.exposure = 1.55;
  ip.contrast = 1.02;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.3;
  ip.vignetteColor = new Color4(0, 0, 0, 0);

  // Colour grading: gently teal-shifted shadows + warm highlights — the classic
  // military-FPS grade — with a touch of global saturation so the orange
  // enemies/props pop against the muted city.
  const curves = new ColorCurves();
  curves.globalSaturation = 12;
  curves.shadowsHue = 210;
  curves.shadowsDensity = 14;
  curves.highlightsHue = 40;
  curves.highlightsDensity = 12;
  ip.colorCurvesEnabled = true;
  ip.colorCurves = curves;

  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.16;

  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 5;
  pipeline.grain.animated = true;

  // SSAO: soft contact shading in corners/under props — the single biggest
  // "grounded, not floating" cue. Runs at half resolution with a small sample
  // count so it's cheap; requires WebGL2 (silently skipped otherwise).
  try {
    if (scene.getEngine().getCaps().drawBuffersExtension) {
      const ssao = new SSAO2RenderingPipeline("ssao", scene, 0.5, [camera]);
      ssao.samples = 8;
      ssao.radius = 1.6;
      ssao.totalStrength = 0.9;
      ssao.expensiveBlur = false;
    }
  } catch {
    // Prerequisites missing (depth renderer/WebGL2) — AO is a polish layer, skip.
  }

  return pipeline;
}
