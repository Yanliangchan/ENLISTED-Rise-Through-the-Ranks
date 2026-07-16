import { GameEngine } from "@/core/Engine";
import { attachCinematicPipeline } from "@/core/Postprocess";
import { InputManager } from "@/core/InputManager";
import { GameState } from "@/core/GameState";
import { Settings } from "@/core/Settings";
import { AudioManager } from "@/core/AudioManager";
import { AccountManager, type AccountRecord } from "@/core/AccountManager";
import { PlayerStats, defaultStats } from "@/core/PlayerStats";
import { AccountScreen } from "@/ui/AccountScreen";
import { PlayerController } from "@/player/PlayerController";
import { applyGearToPlayer, maxThrowableCapacity } from "@/player/Gear";
import { buildLevel, applyWaveArcLighting, generateBuildingLayout, CAMP_POSITION } from "@/world/Level";
import { WaveManager } from "@/world/WaveManager";
import { WeaponController } from "@/weapons/WeaponController";
import { Loadout } from "@/weapons/Loadout";
import { ThrowableController } from "@/weapons/ThrowableController";
import { HUD } from "@/ui/HUD";
import { DamageNumbers } from "@/ui/DamageNumbers";
import { Armoury } from "@/ui/Armoury";
import { PauseMenu } from "@/ui/PauseMenu";
import { GameOverScreen } from "@/ui/GameOverScreen";
import { ControlsOverlay } from "@/ui/ControlsOverlay";
import { SupplyCrateManager } from "@/world/SupplyCrates";
import { LandingPage } from "@/ui/LandingPage";
import { ScopeOverlay } from "@/ui/ScopeOverlay";
import { TacticalMap } from "@/ui/TacticalMap";
import { SafeZoneManager } from "@/world/SafeZone";
import { UAVSupport } from "@/world/UAVSupport";
import { Ambience } from "@/world/Ambience";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLDivElement;

const SPAWN_POINT = CAMP_POSITION;
const STORY_BEATS: Array<[number, string]> = [
  [1, "DEFENCE — Hold the strongpoint"],
  [5, "HOLDING ACTION — Marksmen and drones inbound"],
  [10, "COUNTER-ATTACK — Heavies moving in. MATADOR earns its keep"],
  [15, "RETAKE — Push OPFOR back"],
];

const DEBUG = new URLSearchParams(location.search).has("debug");

/**
 * Resolve the active account before building the game: auto-login the remembered
 * operator, otherwise show the create/select screen. Falls back to a
 * localStorage-backed anonymous session if IndexedDB is unavailable, so the game
 * never fails to start.
 */
async function resolveAccount(): Promise<{ accounts: AccountManager | null; account: AccountRecord | null }> {
  let accounts: AccountManager;
  try {
    accounts = await AccountManager.open();
  } catch {
    return { accounts: null, account: null }; // no DB — anonymous mode
  }

  // Headless/debug: skip the login screen with a throwaway operator.
  if (DEBUG) {
    const existing = await accounts.get("debug");
    const account = existing ?? (await accounts.create("Debug"));
    await accounts.login(account);
    return { accounts, account };
  }

  const remembered = accounts.getRememberedUsername();
  if (remembered) {
    const account = await accounts.get(remembered);
    if (account) {
      await accounts.login(account);
      return { accounts, account };
    }
  }
  const account = await new AccountScreen(uiRoot).resolve(accounts);
  await accounts.login(account);
  return { accounts, account };
}

async function boot(): Promise<void> {
  const { accounts, account } = await resolveAccount();

  const game = new GameEngine(canvas);
  game.scene.collisionsEnabled = true;

  buildLevel(game.scene);
  const buildingLayout = generateBuildingLayout();

  const input = new InputManager(canvas);

  // Account-backed persistence when we have a live account, else the classic
  // standalone localStorage behaviour.
  const persist = () => accounts?.persistActive();
  const gameState = account
    ? new GameState(account.save, (data) => {
        account.save = data;
        persist();
      })
    : new GameState();
  const settings = account
    ? new Settings(account.settings, (data) => {
        account.settings = data;
        persist();
      })
    : new Settings();
  const stats = account
    ? new PlayerStats(account.stats, () => persist())
    : new PlayerStats(defaultStats(), () => {}); // anonymous session — stats aren't persisted
  // A brand-new account starts with a null save; capture GameState's seeded
  // defaults (or migrated legacy localStorage save) into the record right away.
  if (account && account.save === null) {
    account.save = gameState.data;
    accounts?.persistActive();
  }

  const audio = new AudioManager();
  audio.setVolume(settings.data.volume);

  const player = new PlayerController(game.scene, input, SPAWN_POINT, audio);
  attachCinematicPipeline(game.scene, player.camera);
  player.sensitivityMult = settings.data.sensitivity;
  applyGearToPlayer(gameState, player);
  player.health = player.maxHealth;
  player.armour = player.maxArmour;

  const damageNumbers = new DamageNumbers(uiRoot);

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
      stats.recordWaveCleared(wave);
      stats.recordCredits(bonus);
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
      stats.recordDeath();
      stats.flush();
    },
  });

  // Blast/splash hits also pop damage numbers.
  waveManager.enemyManager.onEnemyDamaged = (pos, amount) => damageNumbers.add(pos, amount, "body");

  const scopeOverlay = new ScopeOverlay(uiRoot);
  const weaponController = new WeaponController(
    game.scene,
    player,
    input,
    audio,
    gameState,
    waveManager.enemyManager,
    {
      onFire: () => {
        hud.notifyShotFired();
        stats.recordShot();
      },
      onHit: (_dmg, headshot) => {
        hud.notifyHit();
        stats.recordHit(headshot);
      },
      onKill: () => stats.recordKill(),
      onDamageNumber: (pos, amount, zone) => damageNumbers.add(pos, amount, zone),
    },
    scopeOverlay
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
  armoury.onStartWave = () => {
    waveManager.skipArmoury();
    input.lockPointer();
  };

  const pauseMenu = new PauseMenu(uiRoot, settings, audio, player, gameState, account?.username, stats);
  const gameOverScreen = new GameOverScreen(uiRoot, gameState);

  /** Full resupply on every spawn/redeploy — mags, reserve ammo, and throwables all come back to full. */
  function resupplyOnSpawn(): void {
    weaponController.resetAllAmmo();
    gameState.data.loadout.throwableCount = maxThrowableCapacity(gameState);
    uav.reset();
    gameState.save();
  }

  gameOverScreen.onRestart = () => {
    gameOverScreen.hide();
    waveManager.restartRun(SPAWN_POINT);
    resupplyOnSpawn();
  };
  const controlsOverlay = new ControlsOverlay(uiRoot);
  const supplyCrates = new SupplyCrateManager(game.scene, player, weaponController, input, audio);

  const ambience = new Ambience(game.scene, audio, player);
  const safeZone = new SafeZoneManager(player);
  safeZone.onEnter = () => hud.showCenterMessage("SAFE ZONE — protected", 2000);
  safeZone.onExit = () => hud.showCenterMessage("LEAVING SAFE ZONE", 2200);

  applyWaveArcLighting(game.scene, waveManager.wave);

  const landingPage = new LandingPage(uiRoot);
  landingPage.onDeploy = () => {
    hud.showCenterMessage("OPERATION SENTINEL SHIELD — Scout the sector before OPFOR forms up", 4000);
    waveManager.beginIntro();
    resupplyOnSpawn();
    input.lockPointer();
  };

  const tacticalMap = new TacticalMap(uiRoot, buildingLayout);

  const uav = new UAVSupport(input, audio, {
    onActivate: () => hud.showCenterMessage("UAV OVERHEAD — press M for tactical map", 4000),
    onUnavailable: (reason) =>
      hud.showCenterMessage(reason === "empty" ? "NO UAV CHARGES REMAINING" : "UAV RECHARGING", 1500),
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      pauseMenu.toggle();
      if (!pauseMenu.visible) input.lockPointer();
    }
    if (e.code === "Tab") {
      e.preventDefault();
      controlsOverlay.toggle();
    }
    if (e.code === "KeyM" && !landingPage.visible && waveManager.phase !== "gameover") {
      tacticalMap.toggle();
      if (tacticalMap.visible) document.exitPointerLock();
      else input.lockPointer();
    }
    if (e.code === "KeyB" && (waveManager.phase === "intro" || waveManager.phase === "armoury")) {
      armoury.visible ? armoury.hide() : armoury.show();
      if (!armoury.visible) input.lockPointer();
    }
  });

  // Persist any pending account writes when the player leaves/hides the tab.
  const flushAll = () => {
    stats.flush();
    accounts?.flush();
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
  window.addEventListener("beforeunload", flushAll);

  game.onUpdate((deltaSeconds) => {
    const dt = Math.min(deltaSeconds, 0.05);
    const paused =
      pauseMenu.visible || armoury.visible || gameOverScreen.visible || landingPage.visible || tacticalMap.visible;

    if (!paused) {
      player.update(dt);
      ambience.update(dt);
      safeZone.update(dt);
      loadout.update();
      weaponController.update(dt);
      throwableController.update(dt);
      waveManager.update(dt);
      supplyCrates.update(dt);
      uav.update(dt);
      if (waveManager.phase === "combat") stats.addPlaytime(dt);
    }

    if (tacticalMap.visible) {
      tacticalMap.update(player, waveManager.enemyManager.intel(player.position, uav.active));
    }

    damageNumbers.update(game.scene);
    hud.update(input.isPointerLocked, waveManager.enemyManager.livePositions(), supplyCrates.promptText);
    hud.updateUAV(uav.active, uav.secondsRemaining, uav.chargesRemaining, uav.cooldownRemaining);
    input.resetFrame();
  });

  game.start();

  if (DEBUG) {
    (window as unknown as Record<string, unknown>).__debug = {
      teleport: (x: number, y: number, z: number, yaw = 0, pitch = 0) => {
        player.position.set(x, y, z);
        (player as unknown as { collider: { rotation: { y: number } } }).collider.rotation.y = yaw;
        player.camera.rotation.x = pitch;
      },
      player,
      waveManager,
      game,
      stats,
    };
  }
}

void boot();
