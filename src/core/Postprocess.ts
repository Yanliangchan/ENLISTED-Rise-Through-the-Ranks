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

  // Bloom is pulled right back and its threshold raised: it exists to let a
  // muzzle flash read as hot, not to give the whole frame a neon halo. Heavy
  // bloom is one of the strongest "futuristic shooter" tells.
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.93;
  pipeline.bloomWeight = 0.09;
  pipeline.bloomKernel = 32;
  pipeline.bloomScale = 0.5;

  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  // The world renders PBR with sky IBL + a real sun now, so exposure sits
  // closer to neutral than the old flat-lit Standard-material tuning did.
  ip.exposure = 1.12;
  ip.contrast = 1.06;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.15;
  ip.vignetteColor = new Color4(0, 0, 0, 0);

  /*
   * Grade: humid Singapore field light, not the teal-and-orange blockbuster
   * look. The old curve pushed shadows to 210° (blue) and lifted saturation,
   * which is exactly what gives a scene that cold sci-fi cast. Shadows now sit
   * warm-olive and highlights carry a little sun, so greens read as vegetation
   * and uniform rather than as screen glow. Saturation is slightly under
   * neutral to keep the palette muted and earthy.
   */
  const curves = new ColorCurves();
  curves.globalSaturation = -6;
  curves.shadowsHue = 90; // olive-green shadows
  curves.shadowsDensity = 10;
  curves.midtonesHue = 70;
  curves.midtonesDensity = 5;
  curves.highlightsHue = 44; // warm tropical sun
  curves.highlightsDensity = 14;
  ip.colorCurvesEnabled = true;
  ip.colorCurves = curves;

  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.14;

  // A little more grain than before — dust and humidity in the air, and it
  // helps the flat procedural surfaces read as photographed rather than drawn.
  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 7;
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
  const TARGET_FPS = 45;
  let tier = 0;
  let clockMs = 0;
  let warmupMs = 3500; // ignore load/shader-compile stutter right after start

  scene.onBeforeRenderObservable.add(() => {
    const dtMs = engine.getDeltaTime();
    if (warmupMs > 0) {
      warmupMs -= dtMs;
      return;
    }
    clockMs += dtMs;
    // Re-evaluate every ~2s (was 4s) so a struggling machine reaches a
    // sustainable tier in seconds instead of nearly a minute.
    if (clockMs < 2000) return;
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
