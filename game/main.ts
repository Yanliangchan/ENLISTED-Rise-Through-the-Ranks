import * as THREE from "three";
import { Engine, type Quality } from "~/core/engine";
import { buildMaterials } from "~/gfx/materials";
import { buildEstate } from "~/world/estate";
import { buildGunMats, buildSar21 } from "~/player/sar21";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const engine = new Engine(canvas, { sunAzimuth: 128, sunElevation: 26, cloudCover: 0.5 }, (params.get("q") as Quality) ?? "high");
const lib = buildMaterials(engine);

buildEstate(engine, lib);

const vmMode = params.get("vm");
if (vmMode) {
  const gun = buildSar21(buildGunMats(engine));
  if (vmMode === "side" || vmMode === "three") {
    gun.root.position.set(4.5, 1.6, 30);
    if (vmMode === "three") gun.root.rotation.y = 0.9;
    engine.scene.add(gun.root);
  } else {
    const holder = new THREE.Group();
    holder.add(gun.root);
    gun.root.rotation.y = Math.PI / 2;
    const v = (params.get("off") ?? (vmMode === "ads" ? "0,-0.108,-0.2" : "0.085,-0.19,-0.13")).split(",").map(Number);
    // Gun-space point (x fwd, y up) -> camera space after the 90 degree turn: (z, y, -x).
    holder.position.set(v[0], v[1], v[2]);
    engine.camera.add(holder);
    if (vmMode === "ads") engine.setFov(50);
  }
}
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
