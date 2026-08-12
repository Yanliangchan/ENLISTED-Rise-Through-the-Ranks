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
import { StrikeTargeting } from "@/ui/StrikeTargeting";
import { SafeZoneManager } from "@/world/SafeZone";
import { UAVSupport } from "@/world/UAVSupport";
import { AirstrikeSupport } from "@/world/AirstrikeSupport";
import { CarpetBombingSupport } from "@/world/CarpetBombingSupport";
import { MedKitController } from "@/player/MedKit";
import { Ambience } from "@/world/Ambience";
import { Vector3, Ray, Color3 } from "@babylonjs/core";
import { SPECIAL_ABILITY_LABELS, type AbilitySpecial } from "@/data/gamedata";
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
import { buildPasirPanjang, TERMINAL_SPAWN, type PasirPanjangHandles } from "@/world/PasirPanjang";
import { StrongpointMission } from "@/world/StrongpointMission";
import { StrongpointHUD } from "@/ui/StrongpointHUD";
import { PASIR_PANJANG_PROFILE, SINGAPORE_PROFILE, setActiveMap, activeMap } from "@/world/MapProfile";
import { isNavigable } from "@/world/Nav";

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
/** Flat award for taking all four Pasir Panjang objectives — a fixed mission bonus, not a per-wave economy change. */
const STRONGPOINT_CLEAR_BONUS = 5000;
/**
 * Ranger Gauntlet length. Long enough that finishing it is an endurance
 * result rather than a short challenge — and the exact number the server's
 * `ranger_tab` predicate checks `noResupplyWaveReached` against.
 */
const RANGER_GAUNTLET_WAVES = 18;

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
  // Pasir Panjang Terminal: shared night-dockyard geometry for both
  // Operations below. Built once, lazily, on whichever is entered first.
  let terminal: PasirPanjangHandles | null = null;
  // Strongpoint Assault: four layered objectives, decoupled from WaveManager
  // entirely (see StrongpointMission.ts) — the "not more endless waves" mode.
  // Note it therefore owns the enemyManager tick itself.
  let strongpointActive = false;
  let strongpointMission: StrongpointMission | null = null;
  // Ranger Gauntlet: the existing wave-survival loop, reused rather than
  // forked (weaponController/enemyManager only ever hit-detect against the
  // single global waveManager instance below), capped at RANGER_GAUNTLET_WAVES
  // with resupply withheld — see WaveManager.configureRun.
  let rangerActive = false;
  /** gameState.data.wave belongs to the survival campaign — saved/restored around a Ranger deployment so it never bleeds into that progress. */
  let rangerSavedWave = 1;
  // Private-room multiplayer: lobby menu (lazily built) + active in-match controller.
  let mpMenu: MultiplayerMenu | null = null;
  let netMatch: NetMatch | null = null;
  /** First-aid-kit count saved on entering a multiplayer match, restored on exit
   *  (MP gives a fixed per-life kit count without clobbering the survival save). */
  let mpSavedMedkits = 0;
  const MP_MEDKITS_PER_LIFE = 3;
  /** Survival throwable count saved on entering a multiplayer match, restored on exit —
   *  same reasoning as mpSavedMedkits: MP gets its own full charge without clobbering the survival save. */
  let mpSavedThrowableCount = 0;

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
      // A brief "WAVE N" slam as the countdown resolves, then the story beat.
      hud.setBigCountdown(isElite ? "ELITE WAVE" : "", `WAVE ${wave}`, isElite ? "#ff8f5a" : "#ffd08a", 1200);
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
    onCountdownTick: (secondsLeft, wave) => {
      hud.setBigCountdown(`WAVE ${wave} IN`, String(secondsLeft));
      audio.uiClick();
    },
    onPhaseChange: (phase) => {
      if (phase === "armoury") {
        armoury.show();
      } else {
        armoury.hide();
      }
      // The big centre countdown belongs to the countdown phase only — clearing
      // it on every other transition is what stops a stale "WAVE 6 IN 3" from
      // hanging around into combat or the death screen.
      if (phase !== "countdown") hud.setBigCountdown(null);
      if (phase === "combat") hud.setBigCountdown(null);
      if (phase === "gameover") {
        gameOverScreen.show(waveManager.wave, waveManager.restartOptions());
      }
    },
    onGameOver: (waveReached) => {
      audio.explosion();
      const match = stats.endRun(
        waveReached,
        rangerActive ? { missionType: "ranger_gauntlet" } : undefined
      );
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
    onMissionComplete: (wave) => {
      // Ranger Gauntlet's win condition — WaveManager already flipped to
      // "gameover" (onPhaseChange above popped the standard death-style
      // screen with a restart option), so this only needs to submit the
      // distinctly-flagged match for the badge check and call out the win.
      audio.waveClear();
      hud.showCenterMessage(`RANGER GAUNTLET COMPLETE — ${wave} WAVES, NO RESUPPLY, NO ARMOUR`, 5000);
      const match = stats.endRun(wave, { missionType: "ranger_gauntlet", noResupplyWaveReached: wave });
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

  // Credits reconciliation: purchases/rewards/Guardian edits must all agree on
  // one server-side money value. Purchases already write through GameState →
  // Backend.saveGameState (debounced PUT /api/save); a Guardian edit instead
  // writes straight to the DB out-of-band, so a client sitting in an active
  // session would never see it (and worse, its next autosave would silently
  // overwrite the Guardian's edit with its own stale local balance). Polling
  // here detects a genuine external change and folds it straight into the
  // live GameState/HUD/Armoury — no reconnect or new match required.
  if (backend) {
    setInterval(() => {
      void backend.reconcileCredits().then((serverCredits) => {
        if (serverCredits === null) return;
        gameState.data.credits = serverCredits;
        armoury.refreshDisplay();
      }).catch(() => {}); // transient network hiccup — next poll retries
    }, 6000);
  }

  const pauseMenu = new PauseMenu(uiRoot, settings, audio, player, gameState, backend?.profile.username, stats);
  const gameOverScreen = new GameOverScreen(uiRoot, gameState);
  const strongpointHud = new StrongpointHUD(uiRoot);
  strongpointHud.onReturnToBase = () => exitStrongpointAssaultToMenu();

  /** Full resupply on every spawn/redeploy — mags, reserve ammo, and throwables all come back to full. Withheld entirely under the Ranger Gauntlet's "no resupply" rule. */
  function resupplyOnSpawn(): void {
    if (waveManager.resupplyDisabled) return;
    weaponController.resetAllAmmo();
    gameState.data.loadout.throwableCount = maxThrowableCapacity(gameState);
    // Charges live on the save now: every deployment restores the free
    // allowance while anything bought above it carries forward.
    gameState.replenishStrikeChargesForDeployment();
    uav.reset();
    airstrike.reset();
    carpetBombing.reset();
    botty?.resetSmoke();
    botty?.resetAmmo();
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

  gameOverScreen.onRestart = (wave) => {
    gameOverScreen.hide();
    // restartRun fully rebuilds the run (enemies, wave, phase, timers, player
    // position/health) at the chosen wave; beginDeployment restores the
    // consumables on top of it.
    waveManager.restartRun(wave);
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

  // ---- Operations: shared entry/exit plumbing ---------------------------
  /** True while either Operation is running — the two share a map, a HUD treatment, and the no-friendly-AI rule. */
  function operationActive(): boolean {
    return strongpointActive || rangerActive;
  }

  /**
   * Swaps the world over to Pasir Panjang Terminal and strips the deployment
   * back to the player alone. Operations are meant to be finished on your own
   * positioning, weapons and decisions, so BOTTY is pulled off the field
   * entirely rather than merely told to hold — `enterX` calls this, and
   * `leaveTerminal` puts him back.
   */
  function enterTerminal(): PasirPanjangHandles {
    if (!terminal) terminal = buildPasirPanjang(game.scene); // lazy first-time build, shared by both Operations
    terminal.root.setEnabled(true);
    citadel?.root.setEnabled(false);
    setSurvivalWorldEnabled(false);
    setActiveMap(PASIR_PANJANG_PROFILE);
    landingPage.hide();
    game.renderingPaused = false;
    botty?.root.setEnabled(false);
    bottyMarker.hide();
    loadout.switchTo("primary");
    applyGearToPlayer(gameState, player);
    hud.setVisible(true);
    return terminal;
  }

  /** Tears an Operation down: city back on, standard profile, BOTTY returned, menu up. */
  function leaveTerminal(): void {
    waveManager.enemyManager.clearAll();
    terminal?.root.setEnabled(false);
    setSurvivalWorldEnabled(true);
    setActiveMap(SINGAPORE_PROFILE);
    botty?.root.setEnabled(true);
    strongpointHud.hide();
    hud.setVisible(true);
    hud.setWavePanelSuppressed(false);
    game.renderingPaused = true;
    document.exitPointerLock();
    applyGearToPlayer(gameState, player); // restores the armour pool the Ranger Gauntlet zeroed
    player.respawn(SPAWN_POINT);
    showMainMenu();
  }

  // ---- OPERATION: Strongpoint Assault (four layered objectives) ----------
  function enterStrongpointAssault(): void {
    const map = enterTerminal();
    strongpointActive = true;
    weaponController.resetAllAmmo();
    player.respawn(map.spawn);
    player.inSafeZone = false;
    player.spawnProtected = false;
    (player as unknown as { collider: { rotation: { y: number } } }).collider.rotation.y = 0;
    player.camera.rotation.x = 0;
    hud.setWavePanelSuppressed(true); // no WaveManager phase of its own — the objective panel (top-left) owns mission status instead
    waveManager.enemyManager.clearAll();
    stats.beginRun();
    const refreshObjectives = () => strongpointHud.updateObjectives(strongpointMission!.strongpoints);
    strongpointMission = new StrongpointMission(waveManager.enemyManager, map.strongpointDefs, {
      onStrongpointActivated: (sp) => {
        audio.waveStart();
        refreshObjectives();
        hud.showCenterMessage(`CONTACT — ${sp.name.toUpperCase()}`, 2000);
      },
      onPhaseAdvanced: (sp, phase) => {
        audio.uiClick();
        refreshObjectives();
        hud.showCenterMessage(`${sp.name.toUpperCase()} — PUSHING TO ${phase.label}`, 2200);
      },
      onGateOpened: (sp) => {
        audio.waveStart();
        refreshObjectives();
        hud.showCenterMessage(`TERMINAL CLEAR — ${sp.name.toUpperCase()} IS OPEN. MOVE NORTH.`, 5000);
      },
      onStrongpointCleared: (sp, cleared, total) => {
        audio.waveClear();
        refreshObjectives();
        hud.showCenterMessage(`${sp.name.toUpperCase()} SECURED — ${cleared}/${total}`, 2600);
      },
      onMissionClear: (seconds) => {
        audio.waveClear();
        const mins = Math.floor(seconds / 60);
        strongpointHud.showResult(true, `Terminal secured and Bukit Chandu taken in ${mins}m ${seconds % 60}s.`);
        gameState.addCredits(STRONGPOINT_CLEAR_BONUS);
        stats.recordCredits(STRONGPOINT_CLEAR_BONUS);
        const match = stats.endRun(waveManager.wave, {
          missionType: "strongpoint_assault",
          strongpointsCleared: strongpointMission?.clearedCount ?? 4,
        });
        if (backend) {
          void backend
            .submitMatch(match)
            .then((resp) => {
              stats.applyServerProfile(resp.profile.stats);
              strongpointHud.showBadges(resp.newBadges);
            })
            .catch(() => {});
        }
      },
      onMissionFail: (reason) => {
        audio.explosion();
        const held = strongpointMission?.clearedCount ?? 0;
        strongpointHud.showResult(
          false,
          reason === "timeout"
            ? `Operation timed out with ${held}/4 objectives taken.`
            : `Operator down with ${held}/4 objectives taken.`
        );
      },
      onTimerTick: (secondsLeft) => strongpointHud.updateTimer(secondsLeft),
    });
    strongpointHud.updateObjectives(strongpointMission.strongpoints);
    strongpointHud.show();
    hud.showCenterMessage(
      "STRONGPOINT ASSAULT — take the three terminal objectives, then Bukit Chandu. No support, no resupply.",
      5500
    );
    input.lockPointer();
  }

  function exitStrongpointAssaultToMenu(): void {
    strongpointActive = false;
    strongpointMission = null;
    leaveTerminal();
  }

  // ---- OPERATION: Ranger Gauntlet (18 waves, no resupply, no armour) -----
  function enterRangerGauntlet(): void {
    const map = enterTerminal();
    rangerActive = true;
    rangerSavedWave = gameState.data.wave; // beginRunAt below overwrites gameState.data.wave — restore it on exit so the survival campaign's progress is untouched
    // "No resupply and no armour equipped" — the badge's literal condition.
    // applyGearToPlayer (in enterTerminal) has just refilled the armour pool
    // from the equipped rig, so zero it after, not before.
    player.armour = 0;
    player.maxArmour = 0;
    waveManager.configureRun({ maxWave: RANGER_GAUNTLET_WAVES, resupplyDisabled: true }, map.spawn);
    waveManager.beginRunAt(1);
    beginDeployment();
    hud.showCenterMessage(
      `RANGER GAUNTLET — ${RANGER_GAUNTLET_WAVES} waves at Pasir Panjang Terminal. No resupply, no armour, no support.`,
      5500
    );
    input.lockPointer();
  }

  function exitRangerGauntletToMenu(): void {
    rangerActive = false;
    // Hand the shared WaveManager back to the survival campaign before the
    // teardown below: default ruleset, city spawn point, wave count restored.
    waveManager.configureRun({}, SPAWN_POINT);
    waveManager.beginArmoury();
    gameState.data.wave = rangerSavedWave;
    gameState.save();
    leaveTerminal();
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
    // Throwables (frag/smoke/flashbang/flare/tripflare/claymore) need the same
    // fresh-charge treatment as ammo: without this, a player who used up their
    // throwable count in single-player would enter multiplayer with 0 and be
    // unable to throw anything, flare included, until it was reset elsewhere
    // (which it never was). Snapshot the survival count first so MP never
    // clobbers the survival save, same as the medkit handling just below.
    mpSavedThrowableCount = gameState.data.loadout.throwableCount;
    gameState.data.loadout.throwableCount = maxThrowableCapacity(gameState);
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
    netMatch.onLocalRespawn = () => {
      gameState.data.medkitCount = MP_MEDKITS_PER_LIFE;
      // Same per-life refill for throwables, so a used flare/grenade comes back after death.
      gameState.data.loadout.throwableCount = maxThrowableCapacity(gameState);
    };
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
    gameState.data.loadout.throwableCount = mpSavedThrowableCount; // restore survival throwable count
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
        // Fold the equipped rig in FIRST: beginRunAt fills health/armour from
        // these pools, so a gear change made since the last run has to be live
        // before the spawn, not after it.
        applyGearToPlayer(gameState, player);
        waveManager.beginRunAt(startWave);
        beginDeployment();
        game.renderingPaused = false;
        input.lockPointer();
      };
      // Always a fresh Wave 1 start by default — a checkpoint jump is an
      // explicit choice, never a silent resume from wherever was last saved.
      if (gameState.data.highestWaveCleared >= 5) {
        waveSelect.show(gameState.data.highestWaveCleared, startDeployment, () => showMainMenu());
      } else {
        startDeployment(1);
      }
    };
    landingPage.onTrainingRange = () => enterTrainingRange();
    landingPage.onMultiplayer = () => openMultiplayer();
    landingPage.onStrongpointAssault = () => enterStrongpointAssault();
    landingPage.onRangerGauntlet = () => enterRangerGauntlet();
    if (profilePage) landingPage.onProfile = () => profilePage!.show();
    if (leaderboardPage) landingPage.onLeaderboards = () => leaderboardPage!.show();
  }
  showMainMenu();
  game.renderingPaused = true;

  // ---- Pause-menu actions -------------------------------------------------
  /** Persist everything that survives a session: economy/loadout, the current wave, and settings. */
  function saveAll(): void {
    // Ranger Gauntlet's wave count is mission-scoped, not the survival
    // campaign's — never let it overwrite the real saved wave.
    if (!rangerActive) gameState.data.wave = waveManager.wave; // capture the current wave, not just the last cleared one
    gameState.save();
    settings.save();
    backend?.flush();
  }
  function exitToMainMenu(): void {
    // Route through the mode-specific exit so the terminal's map profile/geometry
    // and the shared waveManager's Ranger config always get torn down —
    // otherwise ESC → Exit to Menu from a Ranger/Strongpoint deployment would
    // strand the player on the terminal's coordinates under the terminal's
    // (wrong) MapProfile the next time they deploy.
    if (strongpointActive) {
      exitStrongpointAssaultToMenu();
      pauseMenu.hide();
      return;
    }
    if (rangerActive) {
      exitRangerGauntletToMenu();
      pauseMenu.hide();
      return;
    }
    waveManager.enemyManager.clearAll();
    waveManager.beginArmoury();
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

  // Call-in charges are owned by the save, not by the ability classes, so the
  // Armoury, the HUD and the ability itself can never disagree about how many
  // are left. Each ability gets a thin view onto its own counter.
  const chargeStore = (id: AbilitySpecial) => ({
    charges: () => gameState.strikeChargesFor(id),
    consume: () => gameState.consumeStrikeCharge(id),
  });

  const uav = new UAVSupport(audio, chargeStore("uav"), {
    onActivate: () => {
      hud.showCenterMessage("HERMES 900 UAV OVERHEAD — press M for tactical map", 4000);
      stats.recordUavCall();
    },
    onUnavailable: (reason) =>
      hud.showCenterMessage(reason === "empty" ? "NO HERMES 900 UAV CHARGES REMAINING" : "HERMES 900 UAV RECHARGING", 1500),
  });
  const airstrike = new AirstrikeSupport(game.scene, audio, waveManager.enemyManager, player, chargeStore("airstrike"));
  const carpetBombing = new CarpetBombingSupport(game.scene, audio, waveManager.enemyManager, player, chargeStore("carpetbombing"));
  const strikeTargeting = new StrikeTargeting(uiRoot, buildingLayout);

  /**
   * Open the targeting overlay for a call-in and, only once the player has
   * confirmed a plan, fire it. Nothing is spent until confirmation, and the
   * overlay hands its callback back exactly once, so a strike can never be
   * called twice from one activation.
   */
  function beginStrikeTargeting(id: "airstrike" | "carpetbombing"): void {
    const ability = id === "airstrike" ? airstrike : carpetBombing;
    if (!ability.ready) {
      hud.showCenterMessage(
        ability.cooldownRemaining > 0
          ? `${SPECIAL_ABILITY_LABELS[id]} RECHARGING — ${Math.ceil(ability.cooldownRemaining)}s`
          : `NO ${SPECIAL_ABILITY_LABELS[id].toUpperCase()} CHARGES — buy more in the Armoury [B]`,
        2200
      );
      audio.uiClick();
      return;
    }
    document.exitPointerLock();
    strikeTargeting.begin(
      id === "carpetbombing" ? "carpet" : "precision",
      (plan) => {
        const ok = ability.callStrike(plan);
        input.lockPointer();
        if (!ok) return;
        if (id === "airstrike") stats.recordAirstrikeCall();
        audio.waveStart();
      },
      () => {
        input.lockPointer();
        hud.showCenterMessage("CALL-IN ABORTED", 1500);
      }
    );
  }

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
      waveSelect.visible ||
      tacticalMap.visible ||
      strikeTargeting.visible ||
      commandWheel.visible ||
      rangeUI.resultsOpen ||
      strongpointHud.resultVisible
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
    // The strike-targeting overlay is modal: it handles its own keys and must
    // not have them double-handled here.
    if (strikeTargeting.visible) return;
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
    if (e.code === "KeyM" && !landingPage.visible && !rangeActive && !citadelActive && !strongpointActive && waveManager.phase !== "gameover") {
      tacticalMap.toggle();
      if (tacticalMap.visible) document.exitPointerLock();
      else input.lockPointer();
    }
    // B opens the armoury/loadout. In the survival game that's the intro/armoury
    // phase; in multiplayer it's a 15s window after each (re)spawn so you can
    // swap your weapon before committing to the fight.
    const bAllowedSurvival = !citadelActive && !strongpointActive && (waveManager.phase === "countdown" || waveManager.phase === "armoury");
    const bAllowedMp = !!netMatch && (netMatch.canChangeWeapon() || armoury.visible);
    if (e.code === "KeyB" && (bAllowedSurvival || bAllowedMp)) {
      if (armoury.visible) {
        armoury.hide();
        // Closing the shop is the player saying they're done — roll straight
        // into the pre-wave countdown so the run always progresses rather than
        // stalling in an armoury phase with nothing driving it.
        if (!citadelActive && waveManager.phase === "armoury") waveManager.skipArmoury();
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
      !operationActive() && // no friendly AI to command in an Operation

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
      !tacticalMap.visible &&
      !strikeTargeting.visible
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
      } else if (special === "airstrike" || special === "carpetbombing") {
        beginStrikeTargeting(special);
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
      waveSelect.visible ||
      (mpMenu?.visible ?? false) ||
      tacticalMap.visible ||
      strikeTargeting.visible ||
      commandWheel.visible ||
      strongpointHud.resultVisible;

    if (!paused) {
      if (rangeActive || citadelActive) {
        // Range / Iron Citadel preview / multiplayer only need movement,
        // aiming/firing, and weapon-slot switching — no waves, crates, UAV,
        // safe zone, or ambience. First aid kits DO work in multiplayer.
        player.update(dt);
        loadout.update();
        weaponController.update(dt);
        // Throwables (frag/smoke/flashbang/flare/tripflare/claymore) are part
        // of "weapon-slot switching" too — the throwable slot (4) is selectable
        // in this mode, but this update() call was missing, so G silently did
        // nothing and every throwable (the illumination flare included) was
        // dead in Iron Citadel preview AND multiplayer.
        if (citadelActive) throwableController.update(dt);
        netMatch?.update(dt);
        if (netMatch) {
          medKit.update(dt); // Digit5 self-heal is available in multiplayer
          hud.updateMedkit(medKit.count);
        }
      } else {
        player.update(dt);
        ambience.update(dt);
        safeZone.update(dt); // reads activeMap() live, so this already tracks the terminal's own base/radius once setActiveMap(PASIR_PANJANG_PROFILE) is set
        loadout.update();
        weaponController.update(dt);
        throwableController.update(dt);
        // Strongpoint Assault has no WaveManager run of its own, so the
        // mission owns the OPFOR tick (see StrongpointMission.update); the
        // Ranger Gauntlet is a real wave run and still goes through WaveManager.
        if (strongpointActive) {
          strongpointMission?.update(dt, player);
        } else {
          waveManager.update(dt);
        }
        // The terminal has no supply-crate/medical-station props — ticking
        // these against Singapore's (hidden) prop positions would only risk a
        // confusing pickup prompt with nothing there to see. Withholding them
        // is also the point of an Operation: no resupply in the field.
        if (!operationActive()) {
          supplyCrates.update(dt);
          medicalStation.update(dt);
        }
        uav.update(dt);
        airstrike.update(dt);
        carpetBombing.update(dt);
        medKit.update(dt);
        // No friendly AI in Operations — BOTTY is disabled on entry and must
        // not tick, be healed, or be commanded while one is running.
        if (botty && !operationActive()) {
          botty.setWave(waveManager.wave, player.maxHealth); // scale accuracy/health with the fight
          botty.setUpgrades(gameState.data.bottyUpgrades); // pick up any Armoury purchases immediately
          botty.update(dt, player);
          updateBottyHeal();
        }
        if (strongpointActive || waveManager.phase === "combat") {
          stats.addPlaytime(dt);
          if (!strongpointActive) updateReconTouch(dt);
        }
      }
    }

    if (tacticalMap.visible) {
      tacticalMap.update(player, waveManager.enemyManager.intel(player.position, uav.active));
    }
    if (strikeTargeting.visible) {
      // Targeting always sees every live contact: the player is choosing where
      // to drop ordnance, and the preview promises to show the enemies caught
      // inside the footprint.
      strikeTargeting.update(dt, player, waveManager.enemyManager.intel(player.position, true));
    }

    damageNumbers.update(game.scene);
    if (!rangeActive && !citadelActive) {
      // In an Operation there is no BOTTY and no field resupply, so none of
      // those prompts/markers should reach the HUD at all.
      const inOp = operationActive();
      hud.update(
        input.isPointerLocked,
        waveManager.enemyManager.livePositions(),
        inOp ? null : bottyHealPrompt() ?? medicalStation.promptText ?? supplyCrates.promptText,
        inOp ? [] : supplyCrates.liveCrates(),
        botty && !inOp ? { x: botty.position.x, z: botty.position.z, isDown: botty.isDown } : null
      );
      // Top-centre support line reflects the equipped SPECIAL ability only.
      const special = gameState.data.loadout.special;
      if (special === "uav") {
        hud.updateUAV(uav.active, uav.secondsRemaining, uav.chargesRemaining, uav.cooldownRemaining);
      } else if (special === "airstrike") {
        if (airstrike.inbound) hud.setSupportLine(`STRIKE INBOUND — ${Math.ceil(airstrike.secondsToImpact)}s`, "#ff8f5a");
        else if (airstrike.cooldownRemaining > 0) hud.setSupportLine(`PRECISION STRIKE × ${airstrike.chargesRemaining} — recharging ${Math.ceil(airstrike.cooldownRemaining)}s`, "#8a9a84");
        else hud.setSupportLine(`PRECISION STRIKE × ${airstrike.chargesRemaining} [Z]`, airstrike.chargesRemaining > 0 ? "#e0a15a" : "#8a9a84");
      } else if (special === "carpetbombing") {
        if (carpetBombing.inbound) hud.setSupportLine(`BOMBING RUN INBOUND — ${Math.ceil(carpetBombing.secondsToImpact)}s`, "#ff8f5a");
        else if (carpetBombing.running) hud.setSupportLine("BOMBING RUN IN PROGRESS", "#ff8f5a");
        else if (carpetBombing.cooldownRemaining > 0) hud.setSupportLine(`CARPET BOMB × ${carpetBombing.chargesRemaining} — recharging ${Math.ceil(carpetBombing.cooldownRemaining)}s`, "#8a9a84");
        else hud.setSupportLine(`CARPET BOMB × ${carpetBombing.chargesRemaining} [Z]`, carpetBombing.chargesRemaining > 0 ? "#e0a15a" : "#8a9a84");
      } else {
        hud.setSupportLine(null);
      }

      // Inbound call-ins own the big centre countdown while they run — but only
      // outside the pre-wave countdown, which has the stronger claim on it.
      if (waveManager.phase !== "countdown") {
        const inboundSecs = airstrike.inbound
          ? airstrike.secondsToImpact
          : carpetBombing.inbound
            ? carpetBombing.secondsToImpact
            : null;
        if (inboundSecs !== null) {
          hud.setBigCountdown("TARGET LOCKED", String(Math.max(1, Math.ceil(inboundSecs))), "#ff8f5a");
        } else if (carpetBombing.running) {
          hud.setBigCountdown("IMPACT", "", "#ff8f5a");
        } else {
          hud.setBigCountdown(null);
        }
      }
      hud.updateMedkit(medKit.count);
      hud.updateBotty(
        botty ? { health: botty.health, maxHealth: botty.maxHealth, command: botty.command, isDown: botty.isDown } : null
      );
    }

    if (botty && !paused && !rangeActive && !citadelActive && !operationActive()) {
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
      enterStrongpointAssault,
      exitStrongpointAssaultToMenu,
      enterRangerGauntlet,
      exitRangerGauntletToMenu,
      strongpointMission: () => strongpointMission,
      terminal: () => terminal,
      activeMapId: () => activeMap().id,
      /**
       * Test helper: sample isNavigable over a grid of the active map and
       * report coverage plus the biggest fully-blocked pocket. Used to catch
       * dead zones and unreachable objectives in the terminal's geometry
       * without having to walk it by hand.
       */
      navSweep: (half = 120, step = 4) => {
        const cols: boolean[][] = [];
        let open = 0;
        let total = 0;
        for (let x = -half; x <= half; x += step) {
          const row: boolean[] = [];
          for (let z = -half; z <= half; z += step) {
            const ok = isNavigable(game.scene, new Vector3(x, 0, z));
            row.push(ok);
            total++;
            if (ok) open++;
          }
          cols.push(row);
        }
        // Flood fill from the deploy point to find what is actually reachable —
        // open ground behind a sealed wall is still a dead zone.
        const w = cols.length;
        const h = cols[0].length;
        const idx = (v: number) => Math.round((v + half) / step);
        const seen = cols.map((r) => r.map(() => false));
        const sx = idx(TERMINAL_SPAWN.x);
        const sz = idx(TERMINAL_SPAWN.z);
        const queue: Array<[number, number]> = [];
        if (cols[sx]?.[sz]) {
          queue.push([sx, sz]);
          seen[sx][sz] = true;
        }
        let reached = 0;
        while (queue.length) {
          const [cx, cz] = queue.pop()!;
          reached++;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
            if (seen[nx][nz] || !cols[nx][nz]) continue;
            seen[nx][nz] = true;
            queue.push([nx, nz]);
          }
        }
        return { total, open, reached, openPct: Math.round((open / total) * 100), reachedPct: Math.round((reached / open) * 100) };
      },
      /** Test helper: is a world point reachable from the deploy point? */
      navAt: (x: number, z: number) => isNavigable(game.scene, new Vector3(x, 0, z)),
      /**
       * Test helper: replicates WeaponController.raycastShot's exact hit-test
       * (same predicate, same pickWithRay call) from an arbitrary origin/target,
       * without touching ammo, cooldowns or damage. Used to verify a shot from
       * a given standoff point actually reaches an enemy instead of being eaten
       * by non-colliding dressing along the way.
       */
      weaponRaycastTest: (ox: number, oy: number, oz: number, tx: number, ty: number, tz: number) => {
        const origin = new Vector3(ox, oy, oz);
        const dir = new Vector3(tx, ty, tz).subtract(origin).normalize();
        const ray = new Ray(origin, dir, 1000);
        const pick = game.scene.pickWithRay(ray, (mesh) => mesh.isPickable && !mesh.metadata?.isSmoke);
        return {
          hit: !!pick?.hit,
          hitMesh: pick?.pickedMesh?.name ?? null,
          hitEnemy: !!pick?.pickedMesh?.metadata?.damageable,
          distance: pick?.distance ?? null,
        };
      },
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
      applyGearToPlayer,
      waveSelect,
      landingPage: () => landingPage,
      airstrike,
      carpetBombing,
      strikeTargeting,
      uav,
      beginStrikeTargeting,
      botty: () => botty,
      spawnBotty,
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
