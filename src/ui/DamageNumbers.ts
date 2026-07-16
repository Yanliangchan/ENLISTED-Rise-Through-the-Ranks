import { Scene, Vector3, Matrix } from "@babylonjs/core";
import type { HitZone } from "@/weapons/Damageable";

interface FloatingNumber {
  el: HTMLDivElement;
  origin: Vector3; // world position of the hit
  bornAt: number;
  active: boolean;
}

const LIFETIME_MS = 850;
const RISE_M = 0.9; // how far the number floats up in world space over its life

/**
 * Floating combat damage numbers. Each damaging hit spawns a short-lived label
 * anchored to the hit point in the world and projected to screen every frame,
 * so it rises off the target and fades. Head hits read big and red, body hits
 * white, limb hits dimmer — instant, readable feedback for every shot. DOM
 * elements are pooled (no per-hit allocation) and it all lives in the HUD
 * overlay, so there's no 3D/material cost.
 */
export class DamageNumbers {
  private container: HTMLDivElement;
  private pool: FloatingNumber[] = [];

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute; inset:0; pointer-events:none; overflow:hidden;";
    parent.appendChild(this.container);
  }

  add(worldPos: Vector3, amount: number, zone: HitZone): void {
    const fn = this.pool.find((n) => !n.active) ?? this.createOne();
    fn.active = true;
    fn.origin = worldPos.clone();
    fn.bornAt = performance.now();
    const rounded = Math.max(1, Math.round(amount));
    fn.el.textContent = zone === "head" ? `${rounded}!` : `${rounded}`;
    const [color, size, weight] =
      zone === "head"
        ? ["#ff5a3c", "26px", "800"]
        : zone === "body"
        ? ["#ffffff", "20px", "700"]
        : ["#c7d0c2", "16px", "600"];
    fn.el.style.color = color;
    fn.el.style.fontSize = size;
    fn.el.style.fontWeight = weight;
    fn.el.style.display = "block";
  }

  private createOne(): FloatingNumber {
    const el = document.createElement("div");
    el.style.cssText = `
      position:absolute; left:0; top:0; transform:translate(-50%,-50%);
      font-family: Consolas, "Courier New", monospace;
      text-shadow: 0 0 4px rgba(0,0,0,0.95), 1px 1px 2px rgba(0,0,0,0.9);
      display:none; will-change: transform, opacity;
    `;
    this.container.appendChild(el);
    const fn: FloatingNumber = { el, origin: new Vector3(), bornAt: 0, active: false };
    this.pool.push(fn);
    return fn;
  }

  /** Project every live number to the screen and advance its rise/fade. */
  update(scene: Scene): void {
    const camera = scene.activeCamera;
    if (!camera) return;
    const engine = scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const transform = scene.getTransformMatrix();
    const viewport = camera.viewport.toGlobal(w, h);
    const now = performance.now();

    for (const fn of this.pool) {
      if (!fn.active) continue;
      const age = now - fn.bornAt;
      if (age >= LIFETIME_MS) {
        fn.active = false;
        fn.el.style.display = "none";
        continue;
      }
      const t = age / LIFETIME_MS;
      const world = fn.origin.add(new Vector3(0, RISE_M * t, 0));
      const p = Vector3.Project(world, Matrix.Identity(), transform, viewport);
      // p.z outside [0,1] means the point is behind the camera / clipped.
      if (p.z < 0 || p.z > 1) {
        fn.el.style.display = "none";
        continue;
      }
      fn.el.style.display = "block";
      const pop = 1 + 0.25 * Math.max(0, 1 - t * 5); // brief scale-up on spawn
      fn.el.style.transform = `translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      fn.el.style.left = `${p.x.toFixed(1)}px`;
      fn.el.style.top = `${p.y.toFixed(1)}px`;
      fn.el.style.opacity = (1 - t * t).toFixed(3); // ease-out fade
    }
  }
}
