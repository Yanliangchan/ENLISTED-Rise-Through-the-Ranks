import type { PlayerController } from "@/player/PlayerController";
import type { WeaponController } from "@/weapons/WeaponController";
import type { Loadout } from "@/weapons/Loadout";
import type { GameState } from "@/core/GameState";
import type { WaveManager } from "@/world/WaveManager";
import { ATTACHMENTS } from "@/data/attachments";
import { isAbilitySpecial, SPECIAL_ABILITY_LABELS } from "@/data/gamedata";
import type { BuildingFootprint } from "@/world/Level";

interface KillFeedEntry {
  text: string;
  expiresAt: number;
}

interface DamageIndicator {
  angleRad: number; // relative to player facing, world-space bearing to the source
  expiresAt: number;
}

/**
 * Full in-combat HUD: health/armour, ammo, weapon + fitted attachments,
 * throwable count, credits, wave/objective, dynamic-spread crosshair,
 * hitmarkers, damage-direction indicators, kill feed, and a top-down radar.
 */
export class HUD {
  private root: HTMLDivElement;
  private healthBar: HTMLDivElement;
  private armourBar: HTMLDivElement;
  private armourValueEl: HTMLSpanElement;
  private bottyBar: HTMLDivElement;
  private bottyWrap: HTMLDivElement;
  private bottyCommandEl: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private weaponNameEl: HTMLDivElement;
  private throwableEl: HTMLDivElement;
  private specialEl: HTMLDivElement;
  private creditsEl: HTMLDivElement;
  private waveEl: HTMLDivElement;
  private uavEl: HTMLDivElement;
  private medkitEl: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private m203Sight: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private killFeedEl: HTMLDivElement;
  private damageIndicatorEl: HTMLDivElement;
  private flashOverlay: HTMLDivElement;
  private lockHintEl: HTMLDivElement;
  private centerMessageEl: HTMLDivElement;
  private interactPromptEl: HTMLDivElement;
  private safeZoneEl: HTMLDivElement;
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;

  private killFeed: KillFeedEntry[] = [];
  private damageIndicators: DamageIndicator[] = [];
  private hitmarkerUntil = 0;
  private flashIntensity = 0;
  private hurtFlashIntensity = 0;
  private hurtOverlay: HTMLDivElement;
  private bloodFlashIntensity = 0;
  private bloodOverlay: HTMLDivElement;
  private centerMessageUntil = 0;
  private shotKickUntil = 0;

  // Perf: DOM writes and canvas repaints are throttled — most HUD text only
  // changes on discrete events, and setting identical innerHTML every frame
  // still forces the browser to re-parse it. Slow text runs at ~10Hz, the
  // radar repaints at ~15Hz, and innerHTML fields only write on change.
  private nextSlowUpdate = 0;
  private nextRadarUpdate = 0;
  private lastKillFeedHtml = "";
  private lastDamageHtml = "";
  private crosshairLines: HTMLDivElement[] | null = null;
  private cratePositions: Array<{ x: number; z: number; type: "ammo" | "health" }> = [];
  private bottyPos: { x: number; z: number; isDown: boolean } | null = null;

  constructor(
    container: HTMLElement,
    private readonly player: PlayerController,
    private readonly weaponController: WeaponController,
    private readonly loadout: Loadout,
    private readonly gameState: GameState,
    private readonly waveManager: WaveManager,
    private readonly buildingLayout: BuildingFootprint[] = []
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; pointer-events: none;
      color: #d7e8d0; font-family: Consolas, "Courier New", monospace;
      user-select: none;
    `;

    this.crosshair = el("div", `
      position: absolute; top: 50%; left: 50%; width: 16px; height: 16px;
      transform: translate(-50%, -50%);
    `);
    this.crosshair.innerHTML = `
      <div class="ch-line ch-top"></div><div class="ch-line ch-bottom"></div>
      <div class="ch-line ch-left"></div><div class="ch-line ch-right"></div>
      <div class="ch-dot"></div>
    `;
    const style = document.createElement("style");
    style.textContent = `
      .ch-line {
        position: absolute; background: #ffffff;
        box-shadow: 0 0 2px rgba(0,0,0,0.95), 0 0 1px 0.5px rgba(0,0,0,0.9);
      }
      .ch-top, .ch-bottom { left: 50%; width: 1.5px; height: 5px; margin-left: -0.75px; }
      .ch-left, .ch-right { top: 50%; height: 1.5px; width: 5px; margin-top: -0.75px; }
      .ch-top { top: 0; } .ch-bottom { bottom: 0; }
      .ch-left { left: 0; } .ch-right { right: 0; }
      .ch-dot {
        position: absolute; top: 50%; left: 50%; width: 1.5px; height: 1.5px;
        margin: -0.75px; border-radius: 50%; background: #ffffff;
        box-shadow: 0 0 2px rgba(0,0,0,0.95), 0 0 1px 0.5px rgba(0,0,0,0.9);
      }
    `;
    this.root.appendChild(style);

    // z-index 20: above the scope overlay's vignette (z-index 12) — the
    // hitmarker, blood splatter, hurt vignette, and damage-direction arrows
    // must stay visible even while the player is fully scoped in, otherwise
    // taking damage while aiming down sights is invisible (the near-opaque
    // scope vignette painted over them at the same DOM depth).
    const DAMAGE_FEEDBACK_Z = "z-index: 20;";

    this.hitmarker = el("div", `
      position: absolute; top: 50%; left: 50%; width: 16px; height: 16px;
      transform: translate(-50%, -50%) rotate(45deg); opacity: 0;
      border: 2px solid #ff5533; ${DAMAGE_FEEDBACK_Z}
    `);

    // Edge insets scale with the viewport but never crowd the very corner —
    // a simple safe-zone margin that holds up from tiny windows to 4K.
    const bottomLeft = el("div", `
      position:absolute; bottom:clamp(12px,2.4vh,30px); left:clamp(12px,2vw,30px);
      width:min(230px, 32vw); padding:12px 14px;
      background: linear-gradient(135deg, rgba(10,16,10,0.72), rgba(8,12,8,0.55));
      border: 1px solid rgba(159,199,138,0.28); border-left: 3px solid #4a7a3c;
      border-radius: 3px; backdrop-filter: blur(2px);
    `);
    this.healthBar = makeBar("#c0392b");
    this.armourBar = makeBar("#5b8dd6");
    const hpLabeled = labeled("HP", this.healthBar);
    const armLabeled = labeled("ARM", this.armourBar);
    bottomLeft.appendChild(hpLabeled.wrap);
    bottomLeft.appendChild(armLabeled.wrap);
    this.armourValueEl = document.createElement("span");
    armLabeled.labelEl.appendChild(this.armourValueEl);

    this.bottyBar = makeBar("#3aa0c8");
    const bottyLabeled = labeled("BOTTY", this.bottyBar);
    this.bottyWrap = bottyLabeled.wrap;
    this.bottyWrap.style.display = "none";
    this.bottyCommandEl = el("div", "font-size:11px; color:#8fc7e0; margin-top:-4px; margin-bottom:6px; text-shadow:1px 1px 2px rgba(0,0,0,0.9);");
    this.bottyWrap.appendChild(this.bottyCommandEl);
    bottomLeft.appendChild(this.bottyWrap);

    const bottomRight = el("div", `
      position:absolute; bottom:clamp(12px,2.4vh,30px); right:clamp(12px,2vw,30px);
      text-align:right; font-size:15px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9); line-height:1.45; min-width:min(200px, 34vw);
      padding:12px 14px;
      background: linear-gradient(225deg, rgba(10,16,10,0.72), rgba(8,12,8,0.55));
      border: 1px solid rgba(159,199,138,0.28); border-right: 3px solid #4a7a3c;
      border-radius: 3px; backdrop-filter: blur(2px);
    `);
    this.ammoEl = el("div", "font-size:28px; font-weight:bold; letter-spacing:1px; color:#eef5e8;");
    this.weaponNameEl = el("div", "font-size:13px; color:#9fc78a; text-transform:uppercase; letter-spacing:0.5px; margin-top:2px;");
    this.throwableEl = el("div", "font-size:13px; color:#c9d8bf; margin-top:6px;");
    this.specialEl = el("div", "font-size:13px; color:#e0a15a; margin-top:2px;");
    bottomRight.appendChild(this.ammoEl);
    bottomRight.appendChild(this.weaponNameEl);
    bottomRight.appendChild(this.throwableEl);
    bottomRight.appendChild(this.specialEl);

    // Wave / objective status: TOP CENTRE, above the crosshair. Centred as its
    // own cluster (the minimap now lives top-right).
    const topCentre = el("div", `
      position:absolute; top:clamp(10px,1.8vh,24px); left:50%; transform:translateX(-50%);
      text-align:center; font-size:13px; max-width:min(340px, 46vw);
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9); line-height:1.5;
      padding:8px 16px;
      background: linear-gradient(135deg, rgba(10,16,10,0.6), rgba(8,12,8,0.4));
      border: 1px solid rgba(159,199,138,0.22); border-radius: 3px;
    `);
    this.waveEl = el("div", "font-size:15px; font-weight:bold; letter-spacing:1px; color:#eef5e8; text-transform:uppercase;");
    this.creditsEl = el("div", "color:#e0c15a; margin-top:2px;");
    this.uavEl = el("div", "color:#7fd0ff; font-size:13px; margin-top:4px;");
    this.medkitEl = el("div", "color:#8fd68f; font-size:13px;");
    topCentre.appendChild(this.waveEl);
    topCentre.appendChild(this.creditsEl);
    topCentre.appendChild(this.uavEl);
    topCentre.appendChild(this.medkitEl);

    // Notifications / kill feed: UPPER LEFT.
    this.killFeedEl = el("div", `
      position:absolute; top:clamp(10px,1.8vh,24px); left:clamp(12px,2vw,30px);
      text-align:left; font-size:13px; max-width:min(300px, 34vw);
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
    `);

    this.damageIndicatorEl = el("div", `position:absolute; inset:0; ${DAMAGE_FEEDBACK_Z}`);

    this.flashOverlay = el("div", `
      position:absolute; inset:0; background:#fff; opacity:0; transition:none;
    `);

    // Red edge vignette for incoming damage — only the screen border tints,
    // the centre stays clear so aim is never obstructed.
    this.hurtOverlay = el("div", `
      position:absolute; inset:0; opacity:0; pointer-events:none;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(190,30,20,0.55) 100%);
      ${DAMAGE_FEEDBACK_Z}
    `);

    // Blood-splatter: a handful of dark-red blobs scattered near the edges,
    // punchier and shorter-lived than the vignette — the "you just got hit
    // hard" read. Built once and re-randomized/faded via opacity per hit.
    this.bloodOverlay = el("div", `
      position:absolute; inset:0; opacity:0; pointer-events:none; ${DAMAGE_FEEDBACK_Z}
    `);
    this.bloodOverlay.innerHTML = BLOOD_BLOBS_HTML;

    this.centerMessageEl = el("div", `
      position:absolute; top:38%; left:50%; transform:translate(-50%,-50%);
      font-size:28px; font-weight:bold; text-align:center; letter-spacing:2px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.9); opacity:0;
    `);

    this.lockHintEl = el("div", `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, 40px);
      font-size: 16px; text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
    `);
    this.lockHintEl.textContent = "Click to engage";

    this.interactPromptEl = el("div", `
      position: absolute; top: 62%; left: 50%; transform: translate(-50%, 0);
      font-size: 15px; color: #e0c15a; text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
      opacity: 0;
    `);

    this.safeZoneEl = el("div", `
      position:absolute; top:172px; left:50%; transform:translateX(-50%);
      font-size:13px; font-weight:bold; letter-spacing:2px; padding:5px 16px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9); opacity:0; white-space:nowrap;
    `);

    this.radarCanvas = document.createElement("canvas");
    this.radarCanvas.width = 140;
    this.radarCanvas.height = 140;
    // Minimap: TOP RIGHT.
    this.radarCanvas.style.cssText = `
      position:absolute; top:clamp(10px,1.8vh,24px); right:clamp(12px,2vw,30px);
      background: rgba(10,20,10,0.55); border: 2px solid rgba(159,199,138,0.4);
      border-radius: 50%; box-shadow: 0 0 12px rgba(0,0,0,0.5);
    `;
    this.radarCtx = this.radarCanvas.getContext("2d")!;

    // Dedicated M203 grenade-launcher sight: an amber ring with elevation
    // ladder ticks, shown instead of the rifle crosshair while the M203 is
    // toggled active — a clear "you're lobbing a grenade now" read.
    this.m203Sight = el("div", `
      position: absolute; top: 50%; left: 50%; width: 90px; height: 90px;
      transform: translate(-50%, -50%); display: none; opacity: 0;
    `);
    this.m203Sight.innerHTML = `
      <div style="position:absolute; inset:0; border:2px solid #e0a83a; border-radius:50%; box-shadow:0 0 6px rgba(224,168,58,0.6);"></div>
      <div style="position:absolute; top:50%; left:50%; width:4px; height:4px; margin:-2px; border-radius:50%; background:#e0a83a;"></div>
      ${[0.2, 0.4, 0.6, 0.8].map((f) => `
        <div style="position:absolute; left:50%; top:${50 - f * 42}%; width:14px; height:1.5px; margin-left:-7px; background:#e0a83a; opacity:${0.55 + f * 0.3};"></div>
      `).join("")}
      <div style="position:absolute; top:100%; left:50%; transform:translate(-50%,4px); font-size:10px; letter-spacing:1px; color:#e0a83a; white-space:nowrap; text-shadow:1px 1px 2px rgba(0,0,0,0.9);">M203 — LMB TO FIRE</div>
    `;

    this.root.appendChild(this.crosshair);
    this.root.appendChild(this.m203Sight);
    this.root.appendChild(this.hitmarker);
    this.root.appendChild(bottomLeft);
    this.root.appendChild(bottomRight);
    this.root.appendChild(topCentre);
    this.root.appendChild(this.killFeedEl);
    this.root.appendChild(this.damageIndicatorEl);
    this.root.appendChild(this.flashOverlay);
    this.root.appendChild(this.hurtOverlay);
    this.root.appendChild(this.bloodOverlay);
    this.root.appendChild(this.centerMessageEl);
    this.root.appendChild(this.lockHintEl);
    this.root.appendChild(this.interactPromptEl);
    this.root.appendChild(this.safeZoneEl);
    this.root.appendChild(this.radarCanvas);
    container.appendChild(this.root);
  }

  /** Reflect UAV recon state: live countdown while overhead, otherwise charge/cooldown readiness. */
  updateUAV(active: boolean, secondsRemaining: number, charges: number, cooldownRemaining: number): void {
    if (active) {
      this.uavEl.textContent = `UAV ACTIVE — ${Math.ceil(secondsRemaining)}s (press M)`;
      this.uavEl.style.color = "#7fd0ff";
    } else if (cooldownRemaining > 0) {
      this.uavEl.textContent = `UAV recharging — ${Math.ceil(cooldownRemaining)}s`;
      this.uavEl.style.color = "#8a9a84";
    } else {
      this.uavEl.textContent = `UAV ready ×${charges} [Z]`;
      this.uavEl.style.color = charges > 0 ? "#7fd0ff" : "#8a9a84";
    }
  }

  /** Generic support-ability readout (top-centre) — used for the air strike and to
   *  clear the line when the equipped special isn't a call-in ability. */
  setSupportLine(text: string | null, color = "#e0a15a"): void {
    this.uavEl.textContent = text ?? "";
    this.uavEl.style.color = color;
  }

  /** Hide/show the whole combat HUD — used while a different full-screen mode (e.g. the Training Range) owns the view. */
  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "" : "none";
  }

  private static readonly COMMAND_LABELS: Record<string, string> = {
    default: "Standing by",
    followMe: "Follow Me",
    goDark: "Go Dark",
    coverMe: "Cover Me",
    engage: "Engage",
    retreat: "Retreat",
  };

  /** Reflect BOTTY's health + active command — hidden entirely if not deployed. */
  updateBotty(status: { health: number; maxHealth: number; command: string; isDown: boolean } | null): void {
    if (!status) {
      this.bottyWrap.style.display = "none";
      return;
    }
    this.bottyWrap.style.display = "block";
    this.bottyBar.style.width = `${Math.max(0, (status.health / status.maxHealth) * 100)}%`;
    this.bottyBar.style.background = status.isDown ? "#5a5a5a" : "#3aa0c8";
    this.bottyCommandEl.textContent = status.isDown
      ? "DOWN — needs a First Aid Kit"
      : HUD.COMMAND_LABELS[status.command] ?? status.command;
  }

  /** Reflect carried first aid kit count. */
  updateMedkit(count: number): void {
    this.medkitEl.textContent = `First Aid ×${count} [5]`;
    this.medkitEl.style.color = count > 0 ? "#8fd68f" : "#8a9a84";
  }

  notifyHit(headshot = false): void {
    this.hitmarkerUntil = performance.now() + (headshot ? 220 : 150);
    // Headshots get a gold, slightly larger marker so lethal hits read
    // differently from body hits without looking at the damage numbers.
    this.hitmarker.style.borderColor = headshot ? "#ffd75a" : "#ff5533";
    this.hitmarker.style.width = headshot ? "20px" : "16px";
    this.hitmarker.style.height = headshot ? "20px" : "16px";
  }

  /**
   * Damage feedback bundle for one hit: red edge vignette (always) plus a
   * blood-splatter flash that scales with how much damage landed — a grazing
   * hit barely shows blood, a heavy hit paints the edges hard. Both stay
   * visible while scoped (see DAMAGE_FEEDBACK_Z above the scope overlay).
   */
  notifyPlayerHurt(damage = 20): void {
    this.hurtFlashIntensity = Math.min(0.55, this.hurtFlashIntensity + 0.35);
    const bloodKick = Math.min(0.85, 0.15 + damage / 60);
    this.bloodFlashIntensity = Math.min(0.9, this.bloodFlashIntensity + bloodKick);
  }

  /** Brief crosshair kick on every shot — subtle visual feedback, decays fast. */
  notifyShotFired(): void {
    this.shotKickUntil = performance.now() + 130;
  }

  notifyKill(enemyName: string, headshot: boolean): void {
    this.killFeed.unshift({
      text: `${headshot ? "☠ HEADSHOT — " : ""}${enemyName} eliminated`,
      expiresAt: performance.now() + 4000,
    });
    this.killFeed = this.killFeed.slice(0, 5);
  }

  notifyDamageFrom(bearingRad: number): void {
    this.damageIndicators.push({ angleRad: bearingRad, expiresAt: performance.now() + 1200 });
  }

  flashWhite(intensity: number): void {
    this.flashIntensity = Math.max(this.flashIntensity, intensity);
  }

  showCenterMessage(text: string, durationMs = 2500): void {
    this.centerMessageEl.textContent = text;
    this.centerMessageUntil = performance.now() + durationMs;
  }

  update(
    isPointerLocked: boolean,
    enemyPositions: Array<{ x: number; z: number }>,
    interactPrompt: string | null = null,
    cratePositions: Array<{ x: number; z: number; type: "ammo" | "health" }> = [],
    bottyPos: { x: number; z: number; isDown: boolean } | null = null
  ): void {
    const now = performance.now();
    this.cratePositions = cratePositions;
    this.bottyPos = bottyPos;

    this.interactPromptEl.textContent = interactPrompt ?? "";
    this.interactPromptEl.style.opacity = interactPrompt ? "1" : "0";

    this.healthBar.style.width = `${Math.max(0, (this.player.health / this.player.maxHealth) * 100)}%`;
    this.armourBar.style.width = this.player.maxArmour
      ? `${Math.max(0, (this.player.armour / this.player.maxArmour) * 100)}%`
      : "0%";
    this.armourValueEl.textContent = `${Math.round(this.player.armour)}/${this.player.maxArmour}`;

    const ammo = this.weaponController.ammo;
    this.ammoEl.textContent = this.weaponController.isReloading
      ? "RELOADING…"
      : `${ammo.mag} / ${ammo.reserve}`;

    // Slow-changing text at ~10Hz — none of it changes mid-frame, and writing
    // identical strings every frame still costs layout/parse time.
    if (now >= this.nextSlowUpdate) {
      this.nextSlowUpdate = now + 100;
      const fitted = this.gameState.getFittedAttachments(this.weaponController.weapon.id);
      const attachNames = fitted.map((id) => ATTACHMENTS[id]?.name).filter(Boolean).join(", ");
      this.weaponNameEl.textContent = attachNames
        ? `${this.weaponController.weapon.name} — ${attachNames}`
        : this.weaponController.weapon.name;

      const throwableId = this.gameState.data.loadout.throwable;
      const throwableName = throwableId ? throwableId.toUpperCase() : "—";
      this.throwableEl.textContent = `${throwableName} ×${this.gameState.data.loadout.throwableCount}`;

      // Special slot: the MATADOR launcher shows carried charges; the call-in
      // abilities (UAV / air strike) show their name here and their live
      // charge/cooldown state on the top-centre support line instead.
      const specialId = this.gameState.data.loadout.special;
      if (specialId && isAbilitySpecial(specialId)) {
        this.specialEl.textContent = SPECIAL_ABILITY_LABELS[specialId];
        this.specialEl.style.display = "block";
      } else if (specialId) {
        const charges = this.weaponController.chargesFor(specialId);
        this.specialEl.textContent = `${specialId.toUpperCase()} ×${charges}`;
        this.specialEl.style.display = "block";
      } else {
        this.specialEl.style.display = "none";
      }

      this.creditsEl.textContent = `Credits: ${this.gameState.data.credits}`;
      this.waveEl.textContent = this.phaseLabel();
    }

    // Cross-fades between the rifle crosshair and the M203 sight over the
    // toggle's ease-in/out (weaponController.m203Blend) rather than a hard
    // cut, so flipping modes reads as a deliberate handling beat.
    const m203Blend = this.weaponController.m203Blend;
    const scoped = this.weaponController.isScopedIn;
    this.crosshair.style.display = scoped || m203Blend >= 0.995 ? "none" : "block";
    this.crosshair.style.opacity = String(1 - m203Blend);
    this.m203Sight.style.display = m203Blend <= 0.005 ? "none" : "block";
    this.m203Sight.style.opacity = String(m203Blend);
    // Small, sharp, and mostly static — a light touch of dynamic spread (tracking
    // the weapon's actual live spread cone, not just a static per-weapon stat)
    // plus a brief per-shot kick reads as feedback without the crosshair
    // ballooning across the screen while moving/firing.
    const shotKick = Math.max(0, (this.shotKickUntil - now) / 130) * 3;
    const spreadPx = 3.5 + Math.min(8, this.weaponController.currentSpreadDegrees * 1.1) + shotKick;
    this.applyCrosshairSpread(spreadPx);

    if (this.player.inSafeZone) {
      this.safeZoneEl.textContent = "SAFE ZONE";
      this.safeZoneEl.style.color = "#baf0ba";
      this.safeZoneEl.style.background = "rgba(20,60,25,0.75)";
      this.safeZoneEl.style.border = "1px solid rgba(140,220,140,0.6)";
      this.safeZoneEl.style.opacity = "1";
    } else if (this.player.spawnProtected) {
      this.safeZoneEl.textContent = "SPAWN PROTECTED";
      this.safeZoneEl.style.color = "#f0dc9a";
      this.safeZoneEl.style.background = "rgba(60,48,15,0.75)";
      this.safeZoneEl.style.border = "1px solid rgba(220,190,110,0.6)";
      this.safeZoneEl.style.opacity = "1";
    } else {
      this.safeZoneEl.style.opacity = "0";
    }

    this.hitmarker.style.opacity = now < this.hitmarkerUntil ? "1" : "0";

    this.killFeed = this.killFeed.filter((k) => k.expiresAt > now);
    const killHtml = this.killFeed.map((k) => `<div>${k.text}</div>`).join("");
    if (killHtml !== this.lastKillFeedHtml) {
      this.lastKillFeedHtml = killHtml;
      this.killFeedEl.innerHTML = killHtml;
    }

    this.damageIndicators = this.damageIndicators.filter((d) => d.expiresAt > now);
    this.renderDamageIndicators();

    if (this.flashIntensity > 0) {
      this.flashOverlay.style.opacity = String(this.flashIntensity);
      this.flashIntensity = Math.max(0, this.flashIntensity - 0.02);
    } else {
      this.flashOverlay.style.opacity = "0";
    }

    if (this.hurtFlashIntensity > 0.005) {
      this.hurtOverlay.style.opacity = String(this.hurtFlashIntensity);
      this.hurtFlashIntensity *= 0.92; // fast exponential fade
    } else if (this.hurtFlashIntensity !== 0) {
      this.hurtFlashIntensity = 0;
      this.hurtOverlay.style.opacity = "0";
    }

    if (this.bloodFlashIntensity > 0.005) {
      this.bloodOverlay.style.opacity = String(this.bloodFlashIntensity);
      this.bloodFlashIntensity *= 0.9; // slightly slower fade than the vignette — blood lingers
    } else if (this.bloodFlashIntensity !== 0) {
      this.bloodFlashIntensity = 0;
      this.bloodOverlay.style.opacity = "0";
    }

    this.centerMessageEl.style.opacity = now < this.centerMessageUntil ? "1" : "0";
    this.lockHintEl.style.display = isPointerLocked ? "none" : "block";

    // Radar repaint at ~15Hz — a full canvas redraw with every building
    // footprint per frame was pure waste for a minimap.
    if (now >= this.nextRadarUpdate) {
      this.nextRadarUpdate = now + 66;
      this.renderRadar(enemyPositions);
    }
  }

  private phaseLabel(): string {
    const wm = this.waveManager;
    if (wm.phase === "intro") {
      return `SCOUT THE SECTOR — Wave ${wm.wave} begins in ${Math.max(0, Math.ceil(wm.introTimeRemaining))}s`;
    }
    if (wm.phase === "armoury") {
      return `ARMOURY — Wave ${wm.wave} in ${Math.max(0, Math.ceil(wm.armouryTimeRemaining))}s`;
    }
    return `WAVE ${wm.wave} — ${wm.enemyManager.totalForWaveRemaining} OPFOR remaining`;
  }

  private applyCrosshairSpread(px: number): void {
    // Cache the four line elements — querySelectorAll every frame is waste.
    if (!this.crosshairLines) {
      this.crosshairLines = Array.from(this.crosshair.querySelectorAll<HTMLDivElement>(".ch-line"));
    }
    const [top, bottom, left, right] = this.crosshairLines;
    if (top) top.style.top = `${-px}px`;
    if (bottom) bottom.style.bottom = `${-px}px`;
    if (left) left.style.left = `${-px}px`;
    if (right) right.style.right = `${-px}px`;
  }

  private renderDamageIndicators(): void {
    const yaw = this.player.yaw;
    const html = this.damageIndicators
      .map((d) => {
        const relative = normalizeAngle(d.angleRad - yaw);
        const deg = (relative * 180) / Math.PI;
        return `<div style="
          position:absolute; top:50%; left:50%; width:0; height:0;
          transform: translate(-50%, -50%) rotate(${deg}deg) translateY(-160px);
        "><div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:16px solid rgba(255,60,40,0.85);"></div></div>`;
      })
      .join("");
    // Almost always empty — skip the innerHTML re-parse when nothing changed.
    if (html !== this.lastDamageHtml) {
      this.lastDamageHtml = html;
      this.damageIndicatorEl.innerHTML = html;
    }
  }

  private renderRadar(enemyPositions: Array<{ x: number; z: number }>): void {
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const range = 100; // metres shown edge-to-edge
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-this.player.yaw);

    ctx.fillStyle = "rgba(140,150,120,0.55)";
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    for (const b of this.buildingLayout) {
      const dx = b.x - this.player.position.x;
      const dz = b.z - this.player.position.z;
      const rx = (dx / range) * size;
      const rz = (dz / range) * size;
      const rsize = (b.size / range) * size;
      if (Math.abs(rx) - rsize > size / 2 || Math.abs(rz) - rsize > size / 2) continue;
      ctx.fillRect(rx - rsize / 2, -rz - rsize / 2, rsize, rsize);
      ctx.strokeRect(rx - rsize / 2, -rz - rsize / 2, rsize, rsize);
    }

    // Supply crates: a distinct diamond with a cross so they're unmistakable
    // against the round enemy blips — cyan for ammo, green for medical.
    for (const c of this.cratePositions) {
      const dx = c.x - this.player.position.x;
      const dz = c.z - this.player.position.z;
      const rx = (dx / range) * size;
      const rz = (dz / range) * size;
      if (Math.abs(rx) > size / 2 || Math.abs(rz) > size / 2) continue;
      const cy = -rz;
      ctx.save();
      ctx.translate(rx, cy);
      ctx.fillStyle = c.type === "ammo" ? "#39c7d8" : "#5be07a";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(4.5, 0);
      ctx.lineTo(0, 4.5);
      ctx.lineTo(-4.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Small centre cross (supply marker).
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(2, 0);
      ctx.moveTo(0, -2);
      ctx.lineTo(0, 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = "#ff5540";
    for (const p of enemyPositions) {
      const dx = p.x - this.player.position.x;
      const dz = p.z - this.player.position.z;
      const rx = (dx / range) * size;
      const rz = (dz / range) * size;
      if (Math.abs(rx) > size / 2 || Math.abs(rz) > size / 2) continue;
      ctx.beginPath();
      ctx.arc(rx, -rz, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // BOTTY: a distinct blue triangle (grey when downed) so he's never
    // confused with a hostile red dot.
    if (this.bottyPos) {
      const dx = this.bottyPos.x - this.player.position.x;
      const dz = this.bottyPos.z - this.player.position.z;
      const rx = (dx / range) * size;
      const rz = (dz / range) * size;
      if (Math.abs(rx) <= size / 2 && Math.abs(rz) <= size / 2) {
        ctx.save();
        ctx.translate(rx, -rz);
        ctx.fillStyle = this.bottyPos.isDown ? "#8a8a8a" : "#3aa0c8";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(4, 4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

    ctx.fillStyle = "#8fe08f";
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 6);
    ctx.lineTo(size / 2 - 5, size / 2 + 5);
    ctx.lineTo(size / 2 + 5, size / 2 + 5);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * A handful of dark-red radial blobs clustered toward the screen edges (never
 * the centre, so aim is never obstructed) — built once as static HTML; only
 * the container's opacity animates per hit, which is far cheaper than
 * regenerating blob markup on every hit.
 */
const BLOOD_BLOBS_HTML = (() => {
  const blobs = [
    { x: 4, y: 12, r: 26 }, { x: 92, y: 18, r: 22 }, { x: 8, y: 82, r: 30 },
    { x: 90, y: 78, r: 24 }, { x: 50, y: 3, r: 18 }, { x: 50, y: 97, r: 20 },
    { x: 1, y: 50, r: 20 }, { x: 98, y: 50, r: 18 },
  ];
  return blobs
    .map(
      (b) => `<div style="
        position:absolute; left:${b.x}%; top:${b.y}%; width:${b.r * 2}vmin; height:${b.r * 2}vmin;
        transform:translate(-50%,-50%); border-radius:50%;
        background: radial-gradient(circle, rgba(120,8,8,0.85) 0%, rgba(90,4,4,0.4) 45%, rgba(90,4,4,0) 75%);
      "></div>`
    )
    .join("");
})();

function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function el(tag: string, cssText: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.style.cssText = cssText;
  return e;
}

function makeBar(color: string): HTMLDivElement {
  const bar = document.createElement("div");
  bar.style.cssText = `height:100%; width:100%; background:${color}; transition: width 0.15s;`;
  return bar;
}

/** Returns the wrapping element plus the label's own text node target, so callers can append a live "42/65" value readout next to the label (e.g. armour, whose max changes as gear is bought). */
function labeled(label: string, bar: HTMLDivElement): { wrap: HTMLDivElement; labelEl: HTMLDivElement } {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-bottom:8px;";
  const labelEl = document.createElement("div");
  labelEl.textContent = label;
  labelEl.style.cssText = "font-size:10px; font-weight:bold; letter-spacing:1.5px; color:#9fc78a; margin-bottom:3px; text-shadow:1px 1px 2px rgba(0,0,0,0.9); display:flex; justify-content:space-between;";
  const track = document.createElement("div");
  track.style.cssText = "width:100%; height:8px; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.18); border-radius:1px; overflow:hidden;";
  track.appendChild(bar);
  wrap.appendChild(labelEl);
  wrap.appendChild(track);
  return { wrap, labelEl };
}
