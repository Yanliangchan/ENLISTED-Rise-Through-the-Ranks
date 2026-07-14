import { Vector3 } from "@babylonjs/core";
import { GameEngine } from "@/core/Engine";
import { InputManager } from "@/core/InputManager";
import { GameState } from "@/core/GameState";
import { Settings } from "@/core/Settings";
import { AudioManager } from "@/core/AudioManager";
import { PlayerController } from "@/player/PlayerController";
import { applyGearToPlayer } from "@/player/Gear";
import { buildLevel, applyWaveArcLighting, generateBuildingLayout } from "@/world/Level";
import { WaveManager } from "@/world/WaveManager";
import { WeaponController } from "@/weapons/WeaponController";
import { Loadout } from "@/weapons/Loadout";
import { ThrowableController } from "@/weapons/ThrowableController";
import { HUD } from "@/ui/HUD";
import { Armoury } from "@/ui/Armoury";
import { PauseMenu } from "@/ui/PauseMenu";
import { GameOverScreen } from "@/ui/GameOverScreen";
import { ControlsOverlay } from "@/ui/ControlsOverlay";
import { SupplyCrateManager } from "@/world/SupplyCrates";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLDivElement;

const SPAWN_POINT = new Vector3(0, 2, 0);
const STORY_BEATS: Array<[number, string]> = [
  [1, "DEFENCE — Hold the strongpoint"],
  [5, "HOLDING ACTION — Marksmen and drones inbound"],
  [10, "COUNTER-ATTACK — Heavies moving in. MATADOR earns its keep"],
  [15, "RETAKE — Push OPFOR back"],
];

const game = new GameEngine(canvas);
game.scene.collisionsEnabled = true;

buildLevel(game.scene);
const buildingLayout = generateBuildingLayout();

const input = new InputManager(canvas);
const gameState = new GameState();
const settings = new Settings();
const audio = new AudioManager();
audio.setVolume(settings.data.volume);

const player = new PlayerController(game.scene, input, SPAWN_POINT, audio);
player.sensitivityMult = settings.data.sensitivity;
applyGearToPlayer(gameState, player);
player.health = player.maxHealth;
player.armour = player.maxArmour;

const waveManager = new WaveManager(game.scene, player, gameState, audio, {
  onKillFeed: (name, headshot) => hud.notifyKill(name, headshot),
  onPlayerDamaged: (_dmg, sourcePos) => {
    const bearing = Math.atan2(sourcePos.x - player.position.x, sourcePos.z - player.position.z);
    hud.notifyDamageFrom(bearing);
  },
  onWaveStart: (wave) => {
    applyWaveArcLighting(game.scene, wave);
    const beat = [...STORY_BEATS].reverse().find(([w]) => wave === w);
    hud.showCenterMessage(beat ? beat[1] : `WAVE ${wave}`, 3000);
  },
  onWaveClear: (wave, bonus) => {
    hud.showCenterMessage(`WAVE ${wave} CLEAR — +${bonus} credits`, 2000);
  },
  onPhaseChange: (phase) => {
    if (phase === "armoury") {
      armoury.show();
    } else {
      armoury.hide();
    }
    if (phase === "intro") {
      controlsOverlay.show();
    } else if (phase === "combat") {
      controlsOverlay.hide();
    }
    if (phase === "gameover") {
      gameOverScreen.show(waveManager.wave);
    }
  },
  onGameOver: () => {
    audio.explosion();
  },
});

const weaponController = new WeaponController(
  game.scene,
  player,
  input,
  audio,
  gameState,
  waveManager.enemyManager,
  {
    onHit: () => hud.notifyHit(),
  }
);

const loadout = new Loadout(input, gameState, weaponController);

const throwableController = new ThrowableController(
  game.scene,
  player,
  input,
  waveManager.enemyManager,
  gameState,
  audio
);
throwableController.onFlashbangScreen = (intensity) => hud.flashWhite(intensity);

const hud = new HUD(uiRoot, player, weaponController, loadout, gameState, waveManager, buildingLayout);
const armoury = new Armoury(uiRoot, gameState, weaponController, player, audio);
armoury.onStartWave = () => waveManager.skipArmoury();

const pauseMenu = new PauseMenu(uiRoot, settings, audio, player, gameState);
const gameOverScreen = new GameOverScreen(uiRoot, gameState);
gameOverScreen.onRestart = () => {
  // Credits/unlocks/gear already earned are kept in GameState (saved on the
  // fly) — redeploying only resets the wave/combat state, and drops the
  // player into the armoury so they can spend before the next Wave 1.
  gameOverScreen.hide();
  waveManager.restartRun(SPAWN_POINT);
};
const controlsOverlay = new ControlsOverlay(uiRoot);
const supplyCrates = new SupplyCrateManager(game.scene, player, weaponController, input, audio);

applyWaveArcLighting(game.scene, waveManager.wave);
hud.showCenterMessage("OPERATION SENTINEL SHIELD — Scout the sector before OPFOR forms up", 4000);
waveManager.beginIntro();

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") pauseMenu.toggle();
  if (e.code === "Tab") {
    e.preventDefault();
    controlsOverlay.toggle();
  }
  if (e.code === "KeyB" && (waveManager.phase === "intro" || waveManager.phase === "armoury")) {
    armoury.visible ? armoury.hide() : armoury.show();
  }
});

game.onUpdate((deltaSeconds) => {
  const dt = Math.min(deltaSeconds, 0.05);
  const paused = pauseMenu.visible || armoury.visible || gameOverScreen.visible;

  if (!paused) {
    player.update(dt);
    loadout.update();
    weaponController.update(dt);
    throwableController.update(dt);
    waveManager.update(dt);
    supplyCrates.update(dt);
  }

  hud.update(input.isPointerLocked, waveManager.enemyManager.livePositions(), supplyCrates.promptText);
  input.resetFrame();
});

game.start();
