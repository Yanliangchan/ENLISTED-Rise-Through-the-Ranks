import { Vector3, Color4 } from "@babylonjs/core";
import { GameEngine } from "@/core/Engine";
import { InputManager } from "@/core/InputManager";
import { PlayerController } from "@/player/PlayerController";
import { buildLevel } from "@/world/Level";
import { HUD } from "@/ui/HUD";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLDivElement;

const game = new GameEngine(canvas);
game.scene.clearColor = new Color4(0.55, 0.65, 0.75, 1);
game.scene.collisionsEnabled = true;
game.scene.gravity = new Vector3(0, -0.5, 0); // unused: PlayerController drives its own gravity

buildLevel(game.scene);

const input = new InputManager(canvas);
const player = new PlayerController(game.scene, input, new Vector3(0, 2, 0));
const hud = new HUD(uiRoot, player);

game.onUpdate((deltaSeconds) => {
  player.update(deltaSeconds);
  hud.update(input.isPointerLocked);
  input.resetFrame();
});

game.start();
