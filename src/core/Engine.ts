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

  start(): void {
    this.engine.runRenderLoop(() => {
      const deltaSeconds = this.engine.getDeltaTime() / 1000;
      for (const cb of this.updateCallbacks) cb(deltaSeconds);
      if (!this.renderingPaused) this.scene.render();
    });
  }

  dispose(): void {
    this.engine.dispose();
  }
}
