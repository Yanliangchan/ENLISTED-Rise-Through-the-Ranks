import { Engine as BabylonEngine, Scene } from "@babylonjs/core";

/**
 * Thin wrapper around the Babylon engine/scene/render-loop. Everything else
 * (player, world, weapons, UI) is wired up by main.ts and ticked from here.
 */
export class GameEngine {
  readonly engine: BabylonEngine;
  readonly scene: Scene;
  private updateCallbacks: Array<(deltaSeconds: number) => void> = [];
  /**
   * While true, the render loop still ticks update callbacks (so menu-time
   * bookkeeping keeps working) but skips `scene.render()` — the single most
   * expensive thing that happens each frame. Set false while a full-screen
   * DOM menu (landing page, profile) covers the canvas: the 3D world behind
   * it would otherwise keep rendering at full detail for nothing.
   */
  renderingPaused = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new BabylonEngine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.scene = new Scene(this.engine);
    // The game never uses hover picking (all shooting is explicit rays), so
    // skip the per-pointer-move scene pick — measurable CPU savings in a
    // scene with thousands of pickable meshes.
    this.scene.skipPointerMovePicking = true;

    window.addEventListener("resize", () => this.engine.resize());
  }

  /** Register a per-frame update callback (delta in seconds). */
  onUpdate(callback: (deltaSeconds: number) => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Milliseconds the last frame spent in game logic (every update callback),
   * excluding `scene.render()`. One timer pair per frame is far too cheap to
   * matter, and it's the only way to tell a CPU-bound frame from a GPU-bound
   * one without attaching a profiler — which is exactly the question that
   * decides whether an optimisation belongs in the simulation or the renderer.
   */
  lastUpdateMs = 0;

  start(): void {
    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;
      const t0 = performance.now();
      for (const cb of this.updateCallbacks) cb(deltaSeconds);
      this.lastUpdateMs = performance.now() - t0;
      if (!this.renderingPaused) this.scene.render();
    });
  }

  dispose(): void {
    this.engine.dispose();
  }
}
