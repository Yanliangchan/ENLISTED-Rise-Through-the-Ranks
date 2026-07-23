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
import { LeaderboardPage } from "@/ui/LeaderboardPage";
import { WaveSelect } from "@/ui/WaveSelect";
import { PlayerController } from "@/player/PlayerController";
import { applyGearToPlayer, maxThrowableCapacity } from "@/player/Gear";
import { buildLevel, applyWaveArcLighting, generateBuildingLayout, CAMP_POSITION, admitLightToFrozenWorld, isNightMode } from "@/world/Level";
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
import { AirstrikeSupport } from "@/world/AirstrikeSupport";
import { CarpetBombingSupport } from "@/world/CarpetBombingSupport";
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

  // Snapshot the survival-world meshes (city + range + ground/skybox) right
  // after they're built and before the player/weapon/citadel exist. In the
  // multiplayer/Iron-Citadel mode these are all off-map and only cost culling +
  // shadow-casting time, so we disable the whole set while the complex is active
  // and re-enable it on the way back to the survival game. Perf win with zero
  // visual change (the complex is a fully sealed interior).
  // Keep the infinite-distance skybox enabled always — the sealed complex's
  // skylights and glazing still read the sky through it.
  const survivalWorldMeshes = game.scene.meshes.filter((m) => !m.infiniteDistance);
  function setSurvivalWorldEnabled(on: boolean): void {
    for (const m of survivalWorldMeshes) if (!m.isDisposed()) m.setEnabled(on);
  }

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
  /** First-aid-kit count saved on entering a multiplayer match, restored on exit
   *  (MP gives a fixed per-life kit count without clobbering the survival save). */
  let mpSavedMedkits = 0;
  const MP_MEDKITS_PER_LIFE = 3;

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
    onWaveStart: (wave, isElite) => {
      applyWaveArcLighting(game.scene, wave);
      const beat = [...STORY_BEATS].reverse().find(([w]) => wave === w);
      if (isElite) {
        hud.showCenterMessage(`⚠ ELITE WAVE ${wave} — reinforced OPFOR, bigger payout`, 3500);
      } else {
        hud.showCenterMessage(beat ? beat[1] : `WAVE ${wave}`, 3000);
      }
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
      onKill: (_targetId, weaponClass, weaponId) => stats.recordKill(weaponClass, weaponId),
      onExplosiveKill: (count) => stats.recordExplosiveKills(count),
      onDamageNumber: (pos, amount, zone) => damageNumbers.add(pos, amount, zone),
    },
    scopeOverlay
  );
  // The flashlight SpotLight only exists from here on — let the world's
  // frozen materials pick it up once so toggling it actually lights buildings
  // and terrain, not just dynamic actors.
  admitLightToFrozenWorld(game.scene);

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
  throwableController.onExplosiveKills = (count) => stats.recordExplosiveKills(count);

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
    airstrike.reset();
    carpetBombing.reset();
    botty?.resetSmoke();
    gameState.data.medkitCount = gameState.startingMedkitCount();
    gameState.save();
  }

  /** Called at the start of every fresh deployment — first ever, and every redeploy after death. */
  function beginDeployment(): void {
    stats.beginRun();
    resupplyOnSpawn();
    reconTouchedThisRun = false;
    reconDwellTimer = 0;
    if (botty) {
      botty.heal(BOTTY_MAX_HEALTH);
      botty.root.position = player.position.add(new Vector3(-1.6, 0, -1.2));
      botty.setCommand("default");
    }
  }

  // ---- Recon badge: hold true arm's reach of an unaware enemy, crouched and
  // still, for a sustained beat — not just a passing brush. Genuinely hard to
  // pull off with OPFOR's hearing/sight cones active around it.
  const STEALTH_TOUCH_RADIUS_M = 1.2;
  const STEALTH_TOUCH_HOLD_SEC = 1.5;
  let reconDwellTimer = 0;
  let reconTouchedThisRun = false;
  function updateReconTouch(dt: number): void {
    if (reconTouchedThisRun) {
      reconDwellTimer = 0;
      return;
    }
    const inRange = player.crouching && !player.isMoving && waveManager.enemyManager
      .getAliveEnemies()
      .some((e) => (e.state === "idle" || e.state === "patrol") && Vector3.Distance(player.position, e.root.position) <= STEALTH_TOUCH_RADIUS_M);
    if (!inRange) {
      reconDwellTimer = 0;
      return;
    }
    reconDwellTimer += dt;
    if (reconDwellTimer < STEALTH_TOUCH_HOLD_SEC) return;
    reconTouchedThisRun = true;
    stats.recordReconTouch();
    hud.showCenterMessage("CONTACT UNAWARE — RECON TOUCH", 2000);
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
    botty.setUpgrades(gameState.data.bottyUpgrades);
  }

  if (gameState.data.hasBotty) spawnBotty();

  const bottyMarker = new BottyMarker(uiRoot);

  armoury.onBuyBotty = () => spawnBotty();

  const commandWheel = new CommandWheel(uiRoot);
  const BOTTY_ORDER_LABEL: Record<string, string> = {
    followMe: "FOLLOW ME", coverMe: "COVER ME", engage: "ENGAGE", retreat: "RETREAT", goDark: "GO DARK", default: "AT EASE",
  };
  commandWheel.onSelect = (command) => {
    botty?.setCommand(command);
    // Visible acknowledgement so it's clear BOTTY received (and will act on) the order.
    if (botty) hud.showCenterMessage(`BOTTY — ${BOTTY_ORDER_LABEL[command] ?? command.toUpperCase()}`, 1600);
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
    stats.recordBottyHeal();
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
    citadel.root.setEnabled(true); // show the complex; hide the survival city
    setSurvivalWorldEnabled(false);
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
    citadel?.root.setEnabled(false);
    setSurvivalWorldEnabled(true);
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
    citadel.root.setEnabled(true);
    setSurvivalWorldEnabled(false); // the complex is a sealed interior — drop the survival city entirely
    botty?.root.setEnabled(false); // BOTTY is single-player only — never present in multiplayer
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
    // First aid kits in multiplayer: a fixed count per life, refilled on respawn.
    // Snapshot the survival count first so MP never overwrites it on the save.
    mpSavedMedkits = gameState.data.medkitCount;
    gameState.data.medkitCount = MP_MEDKITS_PER_LIFE;
    netMatch = new NetMatch(game.scene, player, weaponController, net, info, hud, () => input.isPointerLocked, uiRoot);
    netMatch.onExit = () => exitNetMatch();
    netMatch.onLocalRespawn = () => { gameState.data.medkitCount = MP_MEDKITS_PER_LIFE; };
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
    hud.showCenterMessage(`MULTIPLAYER — ${info.settings.mode === "tdm" ? "TEAM DEATHMATCH" : "ELIMINATION"}`, 4000);
    input.lockPointer();
  }

  function exitNetMatch(): void {
    netMatch?.dispose();
    netMatch = null;
    citadelActive = false;
    citadel?.root.setEnabled(false);
    setSurvivalWorldEnabled(true);
    botty?.root.setEnabled(true); // restore BOTTY for the survival game
    gameState.data.medkitCount = mpSavedMedkits; // restore survival first-aid count
    gameState.save();
    game.renderingPaused = true;
    document.exitPointerLock();
    player.respawn(SPAWN_POINT);
    player.health = 100;
    player.armour = 0; player.maxArmour = 0; // clear the MP plate carrier
    // reopen the lobby menu so players can run another round
    if (mpMenu) mpMenu.open();
    else showMainMenu();
  }

  // ---- Main menu (landing page) -----------------------------------------
  let profilePage: ProfilePage | undefined;
  let leaderboardPage: LeaderboardPage | undefined;
  if (backend) {
    profilePage = new ProfilePage(uiRoot, backend);
    leaderboardPage = new LeaderboardPage(uiRoot, backend);
    profilePage.onOpenGuide = () => leaderboardPage!.show();
  }

  const waveSelect = new WaveSelect(uiRoot);

  let landingPage: LandingPage;
  function showMainMenu(): void {
    landingPage = new LandingPage(uiRoot, settings, audio, player);
    landingPage.onDeploy = () => {
      const startDeployment = (startWave: number) => {
        const timeOfDay = isNightMode() ? "NIGHT" : "DAY";
        hud.showCenterMessage(`OPERATION SENTINEL SHIELD — ${timeOfDay} DEPLOYMENT. Scout the sector before OPFOR forms up`, 4000);
        loadout.switchTo("primary"); // guarantee the real loadout weapon, not whatever the range last had equipped
        waveManager.beginRunAt(startWave);
        beginDeployment();
        game.renderingPaused = false;
        input.lockPointer();
      };
      // Always a fresh Wave 1 start by default — a checkpoint jump is an
      // explicit choice, never a silent resume from wherever was last saved.
      if (gameState.data.highestWaveCleared >= 5) {
        waveSelect.show(gameState.data.highestWaveCleared, startDeployment);
      } else {
        startDeployment(1);
      }
    };
    landingPage.onTrainingRange = () => enterTrainingRange();
    landingPage.onMultiplayer = () => openMultiplayer();
    if (profilePage) landingPage.onProfile = () => profilePage!.show();
    if (leaderboardPage) landingPage.onLeaderboards = () => leaderboardPage!.show();
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

  const uav = new UAVSupport(audio, {
    onActivate: () => {
      hud.showCenterMessage("HERMES 900 UAV OVERHEAD — press M for tactical map", 4000);
      stats.recordUavCall();
    },
    onUnavailable: (reason) =>
      hud.showCenterMessage(reason === "empty" ? "NO HERMES 900 UAV CHARGES REMAINING" : "HERMES 900 UAV RECHARGING", 1500),
  });
  const airstrike = new AirstrikeSupport(game.scene, audio, waveManager.enemyManager);
  const carpetBombing = new CarpetBombingSupport(game.scene, audio, waveManager.enemyManager, player);

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
    // B opens the armoury/loadout. In the survival game that's the intro/armoury
    // phase; in multiplayer it's a 15s window after each (re)spawn so you can
    // swap your weapon before committing to the fight.
    const bAllowedSurvival = !citadelActive && (waveManager.phase === "intro" || waveManager.phase === "armoury");
    const bAllowedMp = !!netMatch && (netMatch.canChangeWeapon() || armoury.visible);
    if (e.code === "KeyB" && (bAllowedSurvival || bAllowedMp)) {
      if (armoury.visible) {
        armoury.hide();
        input.lockPointer();
      } else {
        armoury.show(); // show() releases the pointer for the shop UI
      }
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
    // Z fires the equipped SPECIAL ability (mutually exclusive with the MATADOR):
    // Hermes 900 UAV recon, Precision Strike, or Carpet Bombing (the latter two
    // open the map to pick an impact point / target zone).
    if (
      e.code === "KeyZ" &&
      !landingPage.visible &&
      !rangeActive &&
      !citadelActive &&
      waveManager.phase !== "gameover" &&
      !armoury.visible &&
      !tacticalMap.visible
    ) {
      const special = gameState.data.loadout.special;
      if (
        (special === "uav" || special === "airstrike" || special === "carpetbombing") &&
        !gameState.ownsAbility(special)
      ) {
        // Stale save from before ability unlocks existed — clear it silently.
        gameState.data.loadout.special = null;
      } else if (special === "uav") {
        uav.activate();
      } else if (special === "airstrike") {
        if (airstrike.ready) {
          hud.showCenterMessage("PRECISION STRIKE — click an impact point on the map", 3000);
          tacticalMap.beginTargeting((x, z) => {
            const ok = airstrike.callStrike(x, z);
            tacticalMap.hide();
            input.lockPointer();
            if (ok) {
              stats.recordAirstrikeCall();
              hud.showCenterMessage(`STRIKE INBOUND — impact in ${Math.ceil(airstrike.secondsToImpact)}s`, 2500);
            }
          });
          document.exitPointerLock();
        } else {
          hud.showCenterMessage(airstrike.cooldownRemaining > 0 ? "AIR STRIKE RECHARGING" : "NO AIR STRIKE CHARGES", 1500);
        }
      } else if (special === "carpetbombing") {
        if (carpetBombing.ready) {
          hud.showCenterMessage("CARPET BOMBING — click a target zone on the map", 3000);
          tacticalMap.beginTargeting((x, z) => {
            const ok = carpetBombing.callStrike(x, z);
            tacticalMap.hide();
            input.lockPointer();
            if (ok) {
              hud.showCenterMessage(`BOMBING RUN INBOUND — impact in ${Math.ceil(carpetBombing.secondsToImpact)}s`, 3000);
            }
          });
          document.exitPointerLock();
        } else {
          hud.showCenterMessage(
            carpetBombing.cooldownRemaining > 0 ? "CARPET BOMBING RECHARGING" : "NO CARPET BOMBING CHARGES",
            1500
          );
        }
      }
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
        // safe zone, or ambience. First aid kits DO work in multiplayer.
        player.update(dt);
        loadout.update();
        weaponController.update(dt);
        netMatch?.update(dt);
        if (netMatch) {
          medKit.update(dt); // Digit5 self-heal is available in multiplayer
          hud.updateMedkit(medKit.count);
        }
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
        airstrike.update(dt);
        carpetBombing.update(dt);
        medKit.update(dt);
        if (botty) {
          botty.setWave(waveManager.wave, player.maxHealth); // scale accuracy/health with the fight
          botty.setUpgrades(gameState.data.bottyUpgrades); // pick up any Armoury purchases immediately
          botty.update(dt, player);
          updateBottyHeal();
        }
        if (waveManager.phase === "combat") {
          stats.addPlaytime(dt);
          updateReconTouch(dt);
        }
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
      // Top-centre support line reflects the equipped SPECIAL ability only.
      const special = gameState.data.loadout.special;
      if (special === "uav") {
        hud.updateUAV(uav.active, uav.secondsRemaining, uav.chargesRemaining, uav.cooldownRemaining);
      } else if (special === "airstrike") {
        if (airstrike.inbound) hud.setSupportLine(`STRIKE INBOUND — ${Math.ceil(airstrike.secondsToImpact)}s`, "#ff8f5a");
        else if (airstrike.cooldownRemaining > 0) hud.setSupportLine(`Precision Strike recharging — ${Math.ceil(airstrike.cooldownRemaining)}s`, "#8a9a84");
        else hud.setSupportLine(`Precision Strike ready ×${airstrike.chargesRemaining} [Z]`, airstrike.chargesRemaining > 0 ? "#e0a15a" : "#8a9a84");
      } else if (special === "carpetbombing") {
        if (carpetBombing.inbound) hud.setSupportLine(`BOMBING RUN INBOUND — ${Math.ceil(carpetBombing.secondsToImpact)}s`, "#ff8f5a");
        else if (carpetBombing.running) hud.setSupportLine("BOMBING RUN IN PROGRESS", "#ff8f5a");
        else if (carpetBombing.cooldownRemaining > 0) hud.setSupportLine(`Carpet Bombing recharging — ${Math.ceil(carpetBombing.cooldownRemaining)}s`, "#8a9a84");
        else hud.setSupportLine(`Carpet Bombing ready ×${carpetBombing.chargesRemaining} [Z]`, carpetBombing.chargesRemaining > 0 ? "#e0a15a" : "#8a9a84");
      } else {
        hud.setSupportLine(null);
      }
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
