import { GameEngine } from "@/core/Engine";
import { attachCinematicPipeline } from "@/core/Postprocess";
import { InputManager } from "@/core/InputManager";
import { GameState } from "@/core/GameState";
import { Settings } from "@/core/Settings";
import { AudioManager } from "@/core/AudioManager";
import { Backend } from "@/core/Backend";
import { PlayerStats, emptyStats } from "@/core/PlayerStats";
import { AccountScreen } from "@/ui/AccountScreen";
import { ProfilePage } from "@/ui/ProfilePage";
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
import { MedKitController } from "@/player/MedKit";
import { Ambience } from "@/world/Ambience";
import { Vector3, Ray, Color3 } from "@babylonjs/core";
import { buildTrainingRange, RANGE_FIRING_LINE, RANGE_DISTANCES_M } from "@/world/TrainingRange";
import { buildIronCitadel, type IronCitadelHandles } from "@/world/IronCitadel";
import { MultiplayerMenu, type MatchStartInfo } from "@/ui/MultiplayerMenu";
import { NetMatch, Avatar as NetAvatar } from "@/net/NetMatch";
import type { NetClient } from "@/net/NetClient";
import { RangeTargetController } from "@/world/RangeTarget";
import { TrainingRangeUI, type RangeWeaponOption } from "@/ui/TrainingRangeUI";
import { WEAPONS } from "@/data/weapons";
import { armAdminTrigger } from "@/core/AdminMode";
import { armGuardianTrigger } from "@/core/GuardianTrigger";
import { MedicalStation } from "@/world/MedicalStation";
import { BottyController, BOTTY_MAX_HEALTH } from "@/companion/Botty";
import { BottyMarker } from "@/ui/BottyMarker";
import { CommandWheel } from "@/ui/CommandWheel";

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
 * Resolve the logged-in operator before building the game: auto-login via a
 * remembered token, otherwise show the create/login screen. Debug/headless
 * runs skip straight to a throwaway "Debug" operator. Returns null only if
 * the backend is genuinely unreachable, in which case the game still runs
 * with in-memory-only progress rather than failing to start.
 */
async function resolveBackend(): Promise<Backend | null> {
  const resumed = await Backend.tryResume();
  if (resumed) return resumed;

  if (DEBUG) {
    try {
      return await Backend.login("Debug");
    } catch {
      return null;
    }
  }

  try {
    return await new AccountScreen(uiRoot).resolve();
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  const backend = await resolveBackend();

  const game = new GameEngine(canvas);
  game.scene.collisionsEnabled = true;

  buildLevel(game.scene);
  const buildingLayout = generateBuildingLayout();
  const rangeAssets = buildTrainingRange(game.scene);

  const input = new InputManager(canvas);

  // Postgres-backed persistence when the login succeeded; otherwise the
  // classic standalone localStorage behaviour, so a backend outage degrades
  // to "progress doesn't survive a refresh" instead of "game won't load".
  const gameState = backend
    ? new GameState(backend.profile.save, (data) => backend.saveGameState(data))
    : new GameState();
  const settings = backend
    ? new Settings(backend.profile.settings, (data) => backend.saveSettings(data))
    : new Settings();
  const stats = new PlayerStats(backend?.profile.stats ?? emptyStats());

  // A brand-new account has save/settings = null server-side; push GameState's
  // freshly-seeded defaults (or a migrated legacy localStorage save) back
  // immediately rather than waiting for the first natural mutation.
  if (backend && backend.profile.save === null) backend.saveGameState(gameState.data);
  if (backend && backend.profile.settings === null) backend.saveSettings(settings.data);
  armAdminTrigger(gameState);
  armGuardianTrigger(() => backend?.profile.username ?? null);

  const audio = new AudioManager();
  audio.setVolume(settings.data.volume);

  // Training Range mode flag — declared early since several callbacks built
  // below (weapon fire, the update loop, key handlers) all need to branch on
  // it, but the range's own controller/UI aren't constructed until later.
  let rangeActive = false;
  // Iron Citadel free-roam preview flag + lazily-built handles. Same "movement
  // + weapon only, no waves" treatment as the range. Built on first entry so
  // the wave-survival players never pay for its geometry.
  let citadelActive = false;
  let citadel: IronCitadelHandles | null = null;
  // Private-room multiplayer: lobby menu (lazily built) + active in-match controller.
  let mpMenu: MultiplayerMenu | null = null;
  let netMatch: NetMatch | null = null;

  const player = new PlayerController(game.scene, input, SPAWN_POINT, audio);
  attachCinematicPipeline(game.scene, player.camera);
  player.sensitivityMult = settings.data.sensitivity;
  player.adsSensitivitySetting = settings.data.adsSensitivity;
  applyGearToPlayer(gameState, player);
  player.health = player.maxHealth;
  player.armour = player.maxArmour;

  const damageNumbers = new DamageNumbers(uiRoot);

  const waveManager = new WaveManager(game.scene, player, gameState, audio, SPAWN_POINT, {
    onKillFeed: (name, headshot) => hud.notifyKill(name, headshot),
    onPlayerDamaged: (dmg, sourcePos) => {
      const bearing = Math.atan2(sourcePos.x - player.position.x, sourcePos.z - player.position.z);
      hud.notifyDamageFrom(bearing);
      hud.notifyPlayerHurt(dmg);
      player.shakeCamera(dmg);
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
      if (phase === "gameover") {
        gameOverScreen.show(waveManager.wave);
      }
    },
    onGameOver: (waveReached) => {
      audio.explosion();
      const match = stats.endRun(waveReached);
      if (backend) {
        void backend
          .submitMatch(match)
          .then((resp) => {
            stats.applyServerProfile(resp.profile.stats);
            gameOverScreen.showMatchResult(resp.xpGained, resp.rankUp, resp.newBadges);
          })
          .catch(() => gameOverScreen.showSyncError());
      }
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
        if (rangeActive) {
          rangeTarget.notifyShotFired();
        } else {
          hud.notifyShotFired();
          stats.recordShot();
        }
      },
      onHit: (_dmg, headshot) => {
        hud.notifyHit(headshot);
        stats.recordHit(headshot);
      },
      onKill: (_targetId, weaponClass) => stats.recordKill(weaponClass),
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

  const pauseMenu = new PauseMenu(uiRoot, settings, audio, player, gameState, backend?.profile.username, stats);
  const gameOverScreen = new GameOverScreen(uiRoot, gameState);

  /** Full resupply on every spawn/redeploy — mags, reserve ammo, and throwables all come back to full. */
  function resupplyOnSpawn(): void {
    weaponController.resetAllAmmo();
    gameState.data.loadout.throwableCount = maxThrowableCapacity(gameState);
    uav.reset();
    gameState.data.medkitCount = gameState.startingMedkitCount();
    gameState.save();
  }

  /** Called at the start of every fresh deployment — first ever, and every redeploy after death. */
  function beginDeployment(): void {
    stats.beginRun();
    resupplyOnSpawn();
    if (botty) {
      botty.heal(BOTTY_MAX_HEALTH);
      botty.root.position = player.position.add(new Vector3(-1.6, 0, -1.2));
      botty.setCommand("default");
    }
  }

  gameOverScreen.onRestart = () => {
    gameOverScreen.hide();
    waveManager.restartRun(SPAWN_POINT);
    beginDeployment();
    // The Redeploy click is a user gesture — grab the pointer right here so
    // the player spawns already in control instead of having to click again.
    input.lockPointer();
  };
  const controlsOverlay = new ControlsOverlay(uiRoot);
  const medKit = new MedKitController(input, audio, gameState, player, {
    onUse: () => hud.showCenterMessage("FIRST AID KIT USED", 1500),
    onEmpty: () => hud.showCenterMessage("NO FIRST AID KITS REMAINING", 1500),
    onFullHealth: () => hud.showCenterMessage("ALREADY AT FULL HEALTH", 1500),
  });
  const supplyCrates = new SupplyCrateManager(game.scene, player, weaponController, input, audio, medKit);
  const medicalStation = new MedicalStation(player, input, audio, medKit);

  // ---- BOTTY (purchasable AI squadmate) ---------------------------------
  let botty: BottyController | null = null;
  const BOTTY_HEAL_RADIUS = 3;
  const BOTTY_HEAL_FRACTION = 0.5; // one kit restores half of BOTTY's max health, matching the player's medkit

  function spawnBotty(): void {
    if (botty) return;
    const offset = new Vector3(-1.6, 0, -1.2);
    botty = new BottyController(game.scene, player.position.add(offset), waveManager.enemyManager, audio);
  }

  if (gameState.data.hasBotty) spawnBotty();

  const bottyMarker = new BottyMarker(uiRoot);

  armoury.onBuyBotty = () => spawnBotty();

  const commandWheel = new CommandWheel(uiRoot);
  commandWheel.onSelect = (command) => {
    botty?.setCommand(command);
  };
  commandWheel.onClose = () => input.lockPointer();

  /** Press F near a wounded/downed BOTTY to spend one First Aid Kit healing him. */
  function bottyHealPrompt(): string | null {
    if (!botty || botty.health >= botty.maxHealth) return null;
    if (Vector3.Distance(player.position, botty.position) > BOTTY_HEAL_RADIUS) return null;
    return botty.isDown ? "Press F — revive BOTTY (uses 1 First Aid Kit)" : "Press F — heal BOTTY (uses 1 First Aid Kit)";
  }

  function updateBottyHeal(): void {
    const prompt = bottyHealPrompt();
    if (!prompt) return;
    if (!input.wasPressed("KeyF")) return;
    if (medKit.count <= 0) {
      hud.showCenterMessage("NO FIRST AID KITS REMAINING", 1500);
      return;
    }
    const wasDown = botty!.isDown;
    gameState.data.medkitCount -= 1;
    gameState.save();
    botty!.heal(BOTTY_MAX_HEALTH * BOTTY_HEAL_FRACTION);
    audio.medkit();
    hud.showCenterMessage(wasDown ? "BOTTY REVIVED" : "BOTTY HEALED", 1500);
  }

  const ambience = new Ambience(game.scene, audio, player);
  const safeZone = new SafeZoneManager(player);
  safeZone.onEnter = () => hud.showCenterMessage("SAFE ZONE — protected", 2000);
  safeZone.onExit = () => hud.showCenterMessage("LEAVING SAFE ZONE", 2200);

  applyWaveArcLighting(game.scene, waveManager.wave);

  // ---- Training Range --------------------------------------------------
  const rangeTarget = new RangeTargetController(game.scene, rangeAssets.targetCarriage, RANGE_DISTANCES_M[0]);
  let currentRangeWeaponId = gameState.data.loadout.primary;

  /** Only hitscan weapons make sense on the range — MATADOR/M203 don't raycast through `onImpact`. */
  function rangeWeaponOptions(): RangeWeaponOption[] {
    return gameState.data.ownedWeapons
      .map((id) => WEAPONS[id])
      .filter((w): w is NonNullable<typeof w> => !!w && !w.isProjectile)
      .map((w) => ({ id: w.id, name: w.name }));
  }

  const rangeUI = new TrainingRangeUI(uiRoot, {
    onRetry: () => startRangeSession(currentRangeWeaponId, rangeTarget.distanceM),
    onChangeWeapon: (id) => startRangeSession(id, rangeTarget.distanceM),
    onChangeDistance: (m) => startRangeSession(currentRangeWeaponId, m),
    onResetTarget: () => startRangeSession(currentRangeWeaponId, rangeTarget.distanceM),
    onReturnToMenu: () => exitTrainingRangeToMenu(),
  });

  rangeTarget.onShotResolved = (shotsSoFar) => rangeUI.updateShotCount(shotsSoFar);
  rangeTarget.onSessionComplete = (result) => {
    document.exitPointerLock();
    rangeUI.showResults(result, WEAPONS[currentRangeWeaponId]?.name ?? currentRangeWeaponId);
  };

  /** Fresh 10-round session: equips the chosen weapon (full ammo), relocates the target, clears prior hits. */
  function startRangeSession(weaponId: string, distanceM: number): void {
    currentRangeWeaponId = weaponId;
    weaponController.equip(weaponId);
    weaponController.resetAllAmmo();
    rangeTarget.setDistance(distanceM);
    rangeTarget.reset();
    rangeUI.setWeaponOptions(rangeWeaponOptions(), weaponId);
    rangeUI.setDistanceOptions(RANGE_DISTANCES_M, distanceM);
    rangeUI.updateShotCount(0);
    input.lockPointer();
  }

  function enterTrainingRange(): void {
    landingPage.hide();
    game.renderingPaused = false;
    rangeActive = true;
    hud.setVisible(false);
    player.respawn(new Vector3(RANGE_FIRING_LINE.x, 2, RANGE_FIRING_LINE.z - 2));
    // SafeZoneManager isn't ticked in range mode (see the update loop below),
    // so its "player starts inside the safe zone" default never clears —
    // and hits deliberately can't register while inSafeZone (city rule
    // "no damage from inside the safe zone"). The range is nowhere near it.
    player.inSafeZone = false;
    player.spawnProtected = false;
    (player as unknown as { collider: { rotation: { y: number } } }).collider.rotation.y = 0;
    player.camera.rotation.x = 0;
    const defaultWeapon = rangeWeaponOptions()[0]?.id ?? currentRangeWeaponId;
    startRangeSession(defaultWeapon, RANGE_DISTANCES_M[0]);
    rangeUI.show();
  }

  function exitTrainingRangeToMenu(): void {
    rangeActive = false;
    rangeUI.hide();
    hud.setVisible(true);
    game.renderingPaused = true;
    document.exitPointerLock();
    player.respawn(SPAWN_POINT);
    showMainMenu();
  }

  // ---- Iron Citadel free-roam preview (multiplayer-map WIP) --------------
  let citadelExitBtn: HTMLButtonElement | null = null;
  function enterIronCitadel(): void {
    if (!citadel) citadel = buildIronCitadel(game.scene); // lazy first-time build
    landingPage.hide();
    game.renderingPaused = false;
    citadelActive = true;
    // Hide the wave-mode HUD chrome (wave panel, safe-zone chip, radar) — this
    // is a clean spatial walk-through of the multiplayer map, not a match.
    hud.setVisible(false);
    loadout.switchTo("primary");
    weaponController.resetAllAmmo();
    player.respawn(citadel.spawn);
    // No safe zone / waves here — treat the player as fully "live" so weapons
    // behave normally (safe-zone rule otherwise suppresses all hit damage).
    player.inSafeZone = false;
    player.spawnProtected = false;
    (player as unknown as { collider: { rotation: { y: number } } }).collider.rotation.y = 0;
    player.camera.rotation.x = 0;

    if (!citadelExitBtn) {
      const btn = document.createElement("button");
      btn.textContent = "◀ EXIT MULTIPLAYER";
      btn.style.cssText =
        "position:fixed; top:14px; left:14px; z-index:70; background:rgba(20,26,20,0.85); color:#cfe6c0;" +
        "border:1px solid #3c4a34; padding:8px 14px; font-family:Consolas,monospace; font-size:12px; letter-spacing:1px; cursor:pointer;";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        exitIronCitadelToMenu();
      });
      uiRoot.appendChild(btn);
      citadelExitBtn = btn;
    }
    citadelExitBtn.style.display = "block";
    hud.showCenterMessage("MULTIPLAYER — OPERATION IRON CITADEL · map exploration (matches coming soon) · ESC to exit", 5000);
    input.lockPointer();
  }

  function exitIronCitadelToMenu(): void {
    citadelActive = false;
    if (citadelExitBtn) citadelExitBtn.style.display = "none";
    hud.setVisible(true);
    game.renderingPaused = true;
    document.exitPointerLock();
    player.respawn(SPAWN_POINT);
    showMainMenu();
  }

  // ---- Private-room multiplayer (1v1 / 2v2) -----------------------------
  function openMultiplayer(): void {
    if (!mpMenu) {
      mpMenu = new MultiplayerMenu(uiRoot, {
        token: backend?.sessionToken,
        name: backend?.profile.username ?? "Recruit",
        rankInsignia: backend?.profile.rank.insignia ?? "REC",
        rankName: backend?.profile.rank.name ?? "Recruit",
      });
      mpMenu.onClose = () => showMainMenu();
      mpMenu.onViewProfile = () => profilePage?.show();
      mpMenu.onStartMatch = (net, info) => enterNetMatch(net, info);
    }
    landingPage.hide();
    mpMenu.open();
  }

  function enterNetMatch(net: NetClient, info: MatchStartInfo): void {
    if (!citadel) citadel = buildIronCitadel(game.scene);
    landingPage.hide();
    game.renderingPaused = false;
    citadelActive = true; // reuse the "movement + weapons only, no waves" update branch
    hud.setVisible(true); // multiplayer wants the health/ammo HUD
    loadout.switchTo("primary");
    weaponController.resetAllAmmo();
    player.inSafeZone = false;
    player.spawnProtected = false;
    (player as unknown as { collider: { rotation: { y: number } } }).collider.rotation.y = 0;
    player.camera.rotation.x = 0;
    netMatch = new NetMatch(game.scene, player, weaponController, net, info, uiRoot);
    netMatch.onExit = () => exitNetMatch();
    // Persist results before returning to the lobby: XP/rank/badges server-side,
    // currency applied to the local economy save (auto-persists).
    netMatch.onSubmitResult = async ({ mode, won, result }) => {
      if (!backend) return null;
      try {
        const resp = await backend.submitMultiplayerMatch({
          mode, won,
          kills: result.kills, deaths: result.deaths, assists: result.assists,
          headshots: result.headshots, shotsFired: result.shotsFired, shotsHit: result.shotsHit,
          durationSec: Math.round(info.settings.timeLimitSec),
        });
        gameState.addCredits(resp.currency);
        stats.applyServerProfile(resp.profile.stats);
        return { xpGained: resp.xpGained, currency: resp.currency, rankUp: resp.rankUp };
      } catch (e) {
        console.warn("[mp] result submit failed", e);
        return null;
      }
    };
    hud.showCenterMessage(`MULTIPLAYER — ${info.settings.mode === "tdm" ? "TEAM DEATHMATCH" : "ELIMINATION"} · hold TAB for scoreboard`, 4000);
    input.lockPointer();
  }

  function exitNetMatch(): void {
    netMatch?.dispose();
    netMatch = null;
    citadelActive = false;
    game.renderingPaused = true;
    document.exitPointerLock();
    player.respawn(SPAWN_POINT);
    player.health = 100;
    // reopen the lobby menu so players can run another round
    if (mpMenu) mpMenu.open();
    else showMainMenu();
  }

  // ---- Main menu (landing page) -----------------------------------------
  let profilePage: ProfilePage | undefined;
  if (backend) profilePage = new ProfilePage(uiRoot, backend);

  let landingPage: LandingPage;
  function showMainMenu(): void {
    landingPage = new LandingPage(uiRoot, settings, audio, player);
    landingPage.onDeploy = () => {
      hud.showCenterMessage("OPERATION SENTINEL SHIELD — Scout the sector before OPFOR forms up", 4000);
      loadout.switchTo("primary"); // guarantee the real loadout weapon, not whatever the range last had equipped
      waveManager.beginIntro();
      beginDeployment();
      game.renderingPaused = false;
      input.lockPointer();
    };
    landingPage.onTrainingRange = () => enterTrainingRange();
    landingPage.onMultiplayer = () => openMultiplayer();
    if (profilePage) {
      landingPage.onProfile = () => profilePage!.show();
      landingPage.onLeaderboards = () => profilePage!.show();
    }
  }
  showMainMenu();
  game.renderingPaused = true;

  // ---- Pause-menu actions -------------------------------------------------
  /** Persist everything that survives a session: economy/loadout, the current wave, and settings. */
  function saveAll(): void {
    gameState.data.wave = waveManager.wave; // capture the current wave, not just the last cleared one
    gameState.save();
    settings.save();
    backend?.flush();
  }
  function exitToMainMenu(): void {
    waveManager.enemyManager.clearAll();
    waveManager.beginIntro();
    hud.setVisible(true);
    showMainMenu(); // landingPage.visible becomes true before we hide the pause menu
    pauseMenu.hide();
    game.renderingPaused = true;
    document.exitPointerLock();
  }
  pauseMenu.onSaveGame = () => saveAll();
  pauseMenu.onSaveAndExit = () => {
    saveAll();
    exitToMainMenu();
  };
  pauseMenu.onExitToMenu = () => exitToMainMenu();

  const tacticalMap = new TacticalMap(uiRoot, buildingLayout);

  const uav = new UAVSupport(input, audio, {
    onActivate: () => hud.showCenterMessage("UAV OVERHEAD — press M for tactical map", 4000),
    onUnavailable: (reason) =>
      hud.showCenterMessage(reason === "empty" ? "NO UAV CHARGES REMAINING" : "UAV RECHARGING", 1500),
  });

  // ---- Focus keeper -------------------------------------------------------
  // The game should always own the mouse while actually in play: any click or
  // key press with no menu open re-acquires pointer lock (both are user
  // gestures, so the browser allows it), so the player never has to click the
  // canvas manually after closing a menu, respawning, or interacting with UI.
  function anyMenuOpen(): boolean {
    return (
      pauseMenu.visible ||
      armoury.visible ||
      gameOverScreen.visible ||
      landingPage.visible ||
      tacticalMap.visible ||
      commandWheel.visible ||
      rangeUI.resultsOpen
    );
  }
  window.addEventListener("mousedown", (e) => {
    // Only clicks on the game itself — clicking a button/select (range status
    // bar, overlays) must not steal the cursor mid-interaction.
    if (e.target === canvas && !anyMenuOpen() && !input.isPointerLocked) input.lockPointer();
  });
  pauseMenu.onHide = () => {
    if (!anyMenuOpen()) input.lockPointer();
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      // In the Iron Citadel preview, ESC leaves straight back to the menu
      // rather than opening the wave-mode pause menu.
      if (citadelActive) {
        exitIronCitadelToMenu();
        return;
      }
      pauseMenu.toggle();
      if (!pauseMenu.visible) input.lockPointer();
    }
    // Movement/action keys while unlocked and un-menued (e.g. right after a
    // respawn or closing an overlay) snap focus straight back to the game.
    if (!anyMenuOpen() && !input.isPointerLocked && !e.ctrlKey && !e.altKey && !e.metaKey && e.code !== "Escape") {
      input.lockPointer();
    }
    if (e.code === "Tab") {
      e.preventDefault();
      controlsOverlay.toggle();
    }
    if (e.code === "KeyM" && !landingPage.visible && !rangeActive && !citadelActive && waveManager.phase !== "gameover") {
      tacticalMap.toggle();
      if (tacticalMap.visible) document.exitPointerLock();
      else input.lockPointer();
    }
    if (e.code === "KeyB" && !citadelActive && (waveManager.phase === "intro" || waveManager.phase === "armoury")) {
      armoury.visible ? armoury.hide() : armoury.show();
      if (!armoury.visible) input.lockPointer();
    }
    if (
      e.code === "KeyQ" &&
      botty &&
      !landingPage.visible &&
      !rangeActive &&
      !citadelActive &&
      waveManager.phase !== "gameover" &&
      !armoury.visible
    ) {
      commandWheel.toggle();
    }
  });

  // Persist any pending account writes when the player leaves/hides the tab.
  const flushAll = () => backend?.flush();
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
  window.addEventListener("beforeunload", flushAll);

  game.onUpdate((deltaSeconds) => {
    const dt = Math.min(deltaSeconds, 0.05);
    const paused =
      pauseMenu.visible ||
      armoury.visible ||
      gameOverScreen.visible ||
      (landingPage.visible && !netMatch) ||
      (mpMenu?.visible ?? false) ||
      tacticalMap.visible ||
      commandWheel.visible;

    if (!paused) {
      if (rangeActive || citadelActive) {
        // Range / Iron Citadel preview / multiplayer only need movement,
        // aiming/firing, and weapon-slot switching — no waves, crates, UAV,
        // medkits, safe zone, or rain ambience.
        player.update(dt);
        loadout.update();
        weaponController.update(dt);
        netMatch?.update(dt);
      } else {
        player.update(dt);
        ambience.update(dt);
        safeZone.update(dt);
        loadout.update();
        weaponController.update(dt);
        throwableController.update(dt);
        waveManager.update(dt);
        supplyCrates.update(dt);
        medicalStation.update(dt);
        uav.update(dt);
        medKit.update(dt);
        if (botty) {
          botty.update(dt, player);
          updateBottyHeal();
        }
        if (waveManager.phase === "combat") stats.addPlaytime(dt);
      }
    }

    if (tacticalMap.visible) {
      tacticalMap.update(player, waveManager.enemyManager.intel(player.position, uav.active));
    }

    damageNumbers.update(game.scene);
    if (!rangeActive && !citadelActive) {
      hud.update(
        input.isPointerLocked,
        waveManager.enemyManager.livePositions(),
        bottyHealPrompt() ?? medicalStation.promptText ?? supplyCrates.promptText,
        supplyCrates.liveCrates(),
        botty ? { x: botty.position.x, z: botty.position.z, isDown: botty.isDown } : null
      );
      hud.updateUAV(uav.active, uav.secondsRemaining, uav.chargesRemaining, uav.cooldownRemaining);
      hud.updateMedkit(medKit.count);
      hud.updateBotty(
        botty ? { health: botty.health, maxHealth: botty.maxHealth, command: botty.command, isDown: botty.isDown } : null
      );
    }

    if (botty && !paused && !rangeActive && !citadelActive) {
      bottyMarker.update(game.scene, player.camera, botty.position.add(new Vector3(0, 1.75, 0)), botty.isDown);
    } else {
      bottyMarker.hide();
    }
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
      /** Test helper: orient the player to look directly at a world point (yaw + pitch). */
      aimAt: (x: number, y: number, z: number) => {
        const camPos = player.camera.globalPosition;
        const dx = x - camPos.x;
        const dz = z - camPos.z;
        const horiz = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const pitch = Math.atan2(camPos.y - y, horiz);
        (player as unknown as { collider: { rotation: { y: number } } }).collider.rotation.y = yaw;
        player.camera.rotation.x = pitch;
      },
      player,
      waveManager,
      game,
      stats,
      backend,
      medKit,
      gameState,
      supplyCrates,
      hud,
      rangeTarget,
      rangeUI,
      enterTrainingRange,
      exitTrainingRangeToMenu,
      enterIronCitadel,
      exitIronCitadelToMenu,
      citadel: () => citadel,
      /** Test helper: spawn soldier avatars near a world point to verify netplay rendering. */
      spawnTestSoldiers: (x: number, y: number, z: number) => {
        const mk = (team: "blue" | "red", num: number, dx: number) => {
          const color = team === "blue" ? new Color3(0.3, 0.56, 0.85) : new Color3(0.85, 0.36, 0.3);
          const info = { id: `t${num}`, name: team === "blue" ? "Yanliang" : "OPFOR", rankInsignia: team === "blue" ? "ME4" : "CPL", rankName: "", team, ready: true, isHost: num === 1, ping: 20 };
          const av = new NetAvatar(game.scene, info, color, num, new Vector3(0, 0, 0));
          av.root.position.set(x + dx, y, z);
          av.root.rotation.y = Math.PI;
        };
        mk("blue", 1, -1.2);
        mk("red", 2, 1.2);
      },
      weaponController,
      input,
      botty: () => botty,
      /** Test helper: current player physics state (grounded/moving/aiming). */
      debugPlayerState: () => ({
        grounded: player.grounded,
        isMoving: player.isMoving,
        currentSpreadDegrees: weaponController.currentSpreadDegrees,
        isAiming: weaponController.isAiming,
        inSafeZone: player.inSafeZone,
        spawnProtected: (player as unknown as { spawnProtected: boolean }).spawnProtected,
      }),
      /** Test helper: what does the current camera aim direction actually hit? */
      debugRaycast: () => {
        const cam = player.camera;
        const dir = cam.getDirection(new Vector3(0, 0, 1));
        const ray = new Ray(cam.globalPosition, dir, 1000);
        const pick = game.scene.pickWithRay(ray, (m) => m.isPickable);
        return {
          camPos: { x: cam.globalPosition.x, y: cam.globalPosition.y, z: cam.globalPosition.z },
          dir: { x: dir.x, y: dir.y, z: dir.z },
          hitMesh: pick?.pickedMesh?.name ?? null,
          distance: pick?.distance ?? null,
          point: pick?.pickedPoint ? { x: pick.pickedPoint.x, y: pick.pickedPoint.y, z: pick.pickedPoint.z } : null,
        };
      },
    };
  }
}

void boot();
