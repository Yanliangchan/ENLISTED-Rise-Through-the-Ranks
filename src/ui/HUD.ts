import type { PlayerController } from "@/player/PlayerController";
import type { WeaponController } from "@/weapons/WeaponController";
import type { Loadout } from "@/weapons/Loadout";
import type { GameState } from "@/core/GameState";
import type { WaveManager } from "@/world/WaveManager";
import { ATTACHMENTS } from "@/data/attachments";
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
  private ammoEl: HTMLDivElement;
  private weaponNameEl: HTMLDivElement;
  private throwableEl: HTMLDivElement;
  private creditsEl: HTMLDivElement;
  private waveEl: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private killFeedEl: HTMLDivElement;
  private damageIndicatorEl: HTMLDivElement;
  private flashOverlay: HTMLDivElement;
  private lockHintEl: HTMLDivElement;
  private centerMessageEl: HTMLDivElement;
  private interactPromptEl: HTMLDivElement;
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;

  private killFeed: KillFeedEntry[] = [];
  private damageIndicators: DamageIndicator[] = [];
  private hitmarkerUntil = 0;
  private flashIntensity = 0;
  private centerMessageUntil = 0;

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
      .ch-line { position: absolute; background: rgba(225,235,220,0.85); }
      .ch-top, .ch-bottom { left: 50%; width: 1.5px; height: 6px; margin-left: -0.75px; }
      .ch-left, .ch-right { top: 50%; height: 1.5px; width: 6px; margin-top: -0.75px; }
      .ch-top { top: 0; } .ch-bottom { bottom: 0; }
      .ch-left { left: 0; } .ch-right { right: 0; }
      .ch-dot {
        position: absolute; top: 50%; left: 50%; width: 1.5px; height: 1.5px;
        margin: -0.75px; border-radius: 50%; background: rgba(225,235,220,0.7);
      }
    `;
    this.root.appendChild(style);

    this.hitmarker = el("div", `
      position: absolute; top: 50%; left: 50%; width: 16px; height: 16px;
      transform: translate(-50%, -50%) rotate(45deg); opacity: 0;
      border: 2px solid #ff5533;
    `);

    const bottomLeft = el("div", "position:absolute; bottom:20px; left:24px; width:220px;");
    this.healthBar = makeBar("#c0392b");
    this.armourBar = makeBar("#5b8dd6");
    bottomLeft.appendChild(labeled("HP", this.healthBar));
    bottomLeft.appendChild(labeled("ARM", this.armourBar));

    const bottomRight = el("div", `
      position:absolute; bottom:20px; right:24px; text-align:right; font-size:16px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9); line-height:1.4;
    `);
    this.ammoEl = el("div", "font-size:26px; font-weight:bold;");
    this.weaponNameEl = el("div", "");
    this.throwableEl = el("div", "");
    bottomRight.appendChild(this.ammoEl);
    bottomRight.appendChild(this.weaponNameEl);
    bottomRight.appendChild(this.throwableEl);

    const topLeft = el("div", `
      position:absolute; top:20px; left:24px; font-size:15px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9); line-height:1.5;
    `);
    this.waveEl = el("div", "font-size:18px; font-weight:bold; letter-spacing:1px;");
    this.creditsEl = el("div", "");
    topLeft.appendChild(this.waveEl);
    topLeft.appendChild(this.creditsEl);

    this.killFeedEl = el("div", `
      position:absolute; top:20px; right:24px; text-align:right; font-size:13px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
    `);

    this.damageIndicatorEl = el("div", "position:absolute; inset:0;");

    this.flashOverlay = el("div", `
      position:absolute; inset:0; background:#fff; opacity:0; transition:none;
    `);

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

    this.radarCanvas = document.createElement("canvas");
    this.radarCanvas.width = 140;
    this.radarCanvas.height = 140;
    this.radarCanvas.style.cssText = `
      position:absolute; top:20px; left: 50%; transform: translateX(-50%);
      background: rgba(10,20,10,0.45); border: 1px solid rgba(255,255,255,0.25);
      border-radius: 50%;
    `;
    this.radarCtx = this.radarCanvas.getContext("2d")!;

    this.root.appendChild(this.crosshair);
    this.root.appendChild(this.hitmarker);
    this.root.appendChild(bottomLeft);
    this.root.appendChild(bottomRight);
    this.root.appendChild(topLeft);
    this.root.appendChild(this.killFeedEl);
    this.root.appendChild(this.damageIndicatorEl);
    this.root.appendChild(this.flashOverlay);
    this.root.appendChild(this.centerMessageEl);
    this.root.appendChild(this.lockHintEl);
    this.root.appendChild(this.interactPromptEl);
    this.root.appendChild(this.radarCanvas);
    container.appendChild(this.root);
  }

  notifyHit(): void {
    this.hitmarkerUntil = performance.now() + 150;
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
    interactPrompt: string | null = null
  ): void {
    const now = performance.now();

    this.interactPromptEl.textContent = interactPrompt ?? "";
    this.interactPromptEl.style.opacity = interactPrompt ? "1" : "0";

    this.healthBar.style.width = `${Math.max(0, (this.player.health / this.player.maxHealth) * 100)}%`;
    this.armourBar.style.width = this.player.maxArmour
      ? `${Math.max(0, (this.player.armour / this.player.maxArmour) * 100)}%`
      : "0%";

    const ammo = this.weaponController.ammo;
    this.ammoEl.textContent = this.weaponController.isReloading
      ? "RELOADING…"
      : `${ammo.mag} / ${ammo.reserve}`;
    const fitted = this.gameState.getFittedAttachments(this.weaponController.weapon.id);
    const attachNames = fitted.map((id) => ATTACHMENTS[id]?.name).filter(Boolean).join(", ");
    this.weaponNameEl.textContent = attachNames
      ? `${this.weaponController.weapon.name} — ${attachNames}`
      : this.weaponController.weapon.name;

    const throwableId = this.gameState.data.loadout.throwable;
    const throwableName = throwableId ? throwableId.toUpperCase() : "—";
    this.throwableEl.textContent = `${throwableName} ×${this.gameState.data.loadout.throwableCount}`;

    this.creditsEl.textContent = `Credits: ${this.gameState.data.credits}`;
    const phaseLabel = this.phaseLabel();
    this.waveEl.textContent = phaseLabel;

    this.crosshair.style.display = this.weaponController.isScopedIn ? "none" : "block";
    const spreadPx = 6 + this.currentSpreadDeg() * 4;
    this.applyCrosshairSpread(spreadPx);

    this.hitmarker.style.opacity = now < this.hitmarkerUntil ? "1" : "0";

    this.killFeed = this.killFeed.filter((k) => k.expiresAt > now);
    this.killFeedEl.innerHTML = this.killFeed.map((k) => `<div>${k.text}</div>`).join("");

    this.damageIndicators = this.damageIndicators.filter((d) => d.expiresAt > now);
    this.renderDamageIndicators();

    if (this.flashIntensity > 0) {
      this.flashOverlay.style.opacity = String(this.flashIntensity);
      this.flashIntensity = Math.max(0, this.flashIntensity - 0.02);
    } else {
      this.flashOverlay.style.opacity = "0";
    }

    this.centerMessageEl.style.opacity = now < this.centerMessageUntil ? "1" : "0";
    this.lockHintEl.style.display = isPointerLocked ? "none" : "block";

    this.renderRadar(enemyPositions);
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

  private currentSpreadDeg(): number {
    const w = this.weaponController;
    return w.isAiming ? w.effective.spreadAds : w.effective.spreadHip;
  }

  private applyCrosshairSpread(px: number): void {
    const lines = this.crosshair.querySelectorAll<HTMLDivElement>(".ch-line");
    const [top, bottom, left, right] = Array.from(lines);
    if (top) top.style.top = `${-px}px`;
    if (bottom) bottom.style.bottom = `${-px}px`;
    if (left) left.style.left = `${-px}px`;
    if (right) right.style.right = `${-px}px`;
  }

  private renderDamageIndicators(): void {
    const yaw = this.player.yaw;
    this.damageIndicatorEl.innerHTML = this.damageIndicators
      .map((d) => {
        const relative = normalizeAngle(d.angleRad - yaw);
        const deg = (relative * 180) / Math.PI;
        return `<div style="
          position:absolute; top:50%; left:50%; width:0; height:0;
          transform: translate(-50%, -50%) rotate(${deg}deg) translateY(-160px);
        "><div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:16px solid rgba(255,60,40,0.85);"></div></div>`;
      })
      .join("");
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

function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function el(tag: string, cssText: string): HTMLDivElement {
  const e = document.createElement("div");
  e.style.cssText = cssText;
  return e;
}

function makeBar(color: string): HTMLDivElement {
  const bar = document.createElement("div");
  bar.style.cssText = `height:100%; width:100%; background:${color}; transition: width 0.15s;`;
  return bar;
}

function labeled(label: string, bar: HTMLDivElement): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-bottom:6px;";
  const labelEl = document.createElement("div");
  labelEl.textContent = label;
  labelEl.style.cssText = "font-size:11px; margin-bottom:2px; text-shadow:1px 1px 2px rgba(0,0,0,0.9);";
  const track = document.createElement("div");
  track.style.cssText = "width:100%; height:10px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.2);";
  track.appendChild(bar);
  wrap.appendChild(labelEl);
  wrap.appendChild(track);
  return wrap;
}
