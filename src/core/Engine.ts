import { Engine as BabylonEngine, Scene } from "@babylonjs/core";

/**
 * Thin wrapper around the Babylon engine/scene/render-loop. Everything else
 * (player, world, weapons, UI) is wired up by main.ts and ticked from here.
 */
export class GameEngine {
  readonly engine: BabylonEngine;
  readonly scene: Scene;
  private updateCallbacks: Array<(deltaSeconds: number) => void> = [];

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
      this.scene.render();
    });
  }

  dispose(): void {
    this.engine.dispose();
  }
}
