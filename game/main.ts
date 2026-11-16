import * as THREE from "three";
import { Engine, type Quality } from "~/core/engine";
import { buildMaterials } from "~/gfx/materials";
import { Builder, CollisionSoup } from "~/gfx/builder";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const engine = new Engine(canvas, { sunAzimuth: 128, sunElevation: 26, cloudCover: 0.5 }, (params.get("q") as Quality) ?? "high");
const lib = buildMaterials(engine);

// --- temporary look-dev scene: one of each surface --------------------------
const soup = new CollisionSoup();
const b = new Builder("test", lib.mats, soup);
b.box("asphalt", 0, -0.25, 0, 80, 0.5, 80);
const keys = ["concrete", "paint", "plaster", "pavers", "floortile", "walltile", "screed", "rooftile", "ribmetal", "paintmetal", "steel", "rust", "wood", "brick", "grass", "dirt", "drain", "sandbag", "canvas", "plastic"];
keys.forEach((k, i) => {
  const x = (i % 10) * 3.4 - 15;
  const z = Math.floor(i / 10) * -6 - 4;
  b.box(k, x, 1.5, z, 3, 3, 3);
  b.cyl(k, x, 3.6, z, 0.6, 1.2, 20);
});
b.box('concrete', 6, 3, 6, 0.4, 6, 0.4);
b.box('concrete', 4, 5.8, 6, 5, 0.3, 2);
engine.scene.add(b.build());

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
