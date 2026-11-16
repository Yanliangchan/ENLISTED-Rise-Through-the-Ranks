import * as THREE from "three";
import type { Quality } from "~/core/engine";
import { Game } from "~/play/game";
import type { Mode } from "~/ui/menus";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;

// Let the loading screen paint before the (synchronous) world build.
requestAnimationFrame(() =>
  setTimeout(() => {
    const game = new Game(canvas, ui, (params.get("q") as Quality) ?? undefined);
    const w = window as unknown as Record<string, unknown>;
    w.__game = game;
    w.__THREE = THREE;
    game.menus.loaded();

    // Development hooks: ?auto=operation|holdout starts immediately; ?cam=x,y,z,yaw,pitch pins a free camera.
    const auto = params.get("auto") as Mode | null;
    if (auto) game.deploy(auto);
    const cam = params.get("cam");
    if (cam) {
      const c = cam.split(",").map(Number);
      game.menus.hide();
      game.state = "debrief";
      game.engine.setFov(Number(params.get("fov") ?? 74));
      game.engine.camera.position.set(c[0], c[1], c[2]);
      game.engine.camera.rotation.set(c[4] ?? 0, c[3] ?? 0, 0, "YXZ");
    }
    const loop = game.frame;
    game.frame = () => {
      loop();
      w.__frames = game.frames;
    };
    game.frame();
  }, 30)
);
