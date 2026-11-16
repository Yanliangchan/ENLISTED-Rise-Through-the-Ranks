import * as THREE from "three";
import { Engine, type Quality } from "~/core/engine";
import { buildMaterials } from "~/gfx/materials";
import { buildEstate } from "~/world/estate";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const engine = new Engine(canvas, { sunAzimuth: 128, sunElevation: 26, cloudCover: 0.5 }, (params.get("q") as Quality) ?? "high");
const lib = buildMaterials(engine);

buildEstate(engine, lib);

const cam = (params.get("cam") ?? "0,2.2,9,0,-0.1").split(",").map(Number);
engine.camera.position.set(cam[0], cam[1], cam[2]);
engine.camera.rotation.set(cam[4] ?? 0, cam[3] ?? 0, 0);

let last = performance.now();
let frames = 0;
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  engine.render(dt);
  frames++;
  (window as unknown as Record<string, unknown>).__frames = frames;
  requestAnimationFrame(loop);
}
loop();
(window as unknown as Record<string, unknown>).__engine = engine;
void THREE;
