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
  let ssao: SSAO2RenderingPipeline | null = null;
  try {
    if (scene.getEngine().getCaps().drawBuffersExtension) {
      ssao = new SSAO2RenderingPipeline("ssao", scene, 0.5, [camera]);
      ssao.samples = 8;
      ssao.radius = 1.6;
      ssao.totalStrength = 0.9;
      ssao.expensiveBlur = false;
    }
  } catch {
    // Prerequisites missing (depth renderer/WebGL2) — AO is a polish layer, skip.
  }

  attachAdaptiveQuality(scene, camera, pipeline, ssao);

  return pipeline;
}

/**
 * Adaptive quality: post-FX are polish, holding frame rate is not. Samples the
 * engine's moving-average FPS every few seconds and, while it stays under
 * target, sheds the most expensive effects one step at a time — SSAO first,
 * then sharpen/grain, then bloom, then renders at reduced internal resolution.
 * Steps are one-way (no oscillating back and forth on the threshold), so a
 * weak machine settles at whatever tier it can actually sustain.
 */
function attachAdaptiveQuality(
  scene: Scene,
  camera: Camera,
  pipeline: DefaultRenderingPipeline,
  ssao: SSAO2RenderingPipeline | null
): void {
  const engine = scene.getEngine();
  const TARGET_FPS = 42;
  let tier = 0;
  let clockMs = 0;
  let warmupMs = 6000; // ignore load/shader-compile stutter right after start

  scene.onBeforeRenderObservable.add(() => {
    const dtMs = engine.getDeltaTime();
    if (warmupMs > 0) {
      warmupMs -= dtMs;
      return;
    }
    clockMs += dtMs;
    if (clockMs < 4000) return;
    clockMs = 0;
    if (engine.getFps() >= TARGET_FPS || tier >= 4) return;

    tier++;
    // Each shed step is best-effort: a failure to remove one effect must never
    // take down the render loop or stop the remaining tiers from applying.
    try {
      if (tier === 1 && ssao) {
        scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", camera);
      } else if (tier === 2) {
        pipeline.sharpenEnabled = false;
        pipeline.grainEnabled = false;
      } else if (tier === 3) {
        pipeline.bloomEnabled = false;
      } else if (tier === 4) {
        // Last resort: render at ~78% internal resolution (FXAA hides most of it).
        engine.setHardwareScalingLevel(Math.max(engine.getHardwareScalingLevel(), 1.28));
      }
    } catch {
      // Effect already gone or unsupported on this device — move on.
    }
  });
}
