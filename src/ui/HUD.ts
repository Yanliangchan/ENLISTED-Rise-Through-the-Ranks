import type { PlayerController } from "@/player/PlayerController";

/**
 * Milestone-1 HUD shell: crosshair + health/armour readout. Ammo, weapon
 * name, credits, wave, hitmarkers, kill feed, etc. are added in later phases
 * once weapons/enemies/waves exist.
 */
export class HUD {
  private root: HTMLDivElement;
  private healthEl: HTMLDivElement;
  private armourEl: HTMLDivElement;
  private lockHintEl: HTMLDivElement;

  constructor(container: HTMLElement, private readonly player: PlayerController) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; pointer-events: none;
      color: #d7e8d0; font-family: Consolas, "Courier New", monospace;
      user-select: none;
    `;

    const crosshair = document.createElement("div");
    crosshair.style.cssText = `
      position: absolute; top: 50%; left: 50%; width: 6px; height: 6px;
      transform: translate(-50%, -50%); border-radius: 50%;
      background: rgba(255,255,255,0.85); box-shadow: 0 0 2px rgba(0,0,0,0.8);
    `;

    const statsPanel = document.createElement("div");
    statsPanel.style.cssText = `
      position: absolute; bottom: 24px; left: 24px; font-size: 18px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9); line-height: 1.5;
    `;
    this.healthEl = document.createElement("div");
    this.armourEl = document.createElement("div");
    statsPanel.appendChild(this.healthEl);
    statsPanel.appendChild(this.armourEl);

    this.lockHintEl = document.createElement("div");
    this.lockHintEl.textContent = "Click to engage";
    this.lockHintEl.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, 40px);
      font-size: 16px; text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
    `;

    this.root.appendChild(crosshair);
    this.root.appendChild(statsPanel);
    this.root.appendChild(this.lockHintEl);
    container.appendChild(this.root);
  }

  update(isPointerLocked: boolean): void {
    this.healthEl.textContent = `HP  ${Math.ceil(this.player.health)}`;
    this.armourEl.textContent = `ARM ${Math.ceil(this.player.armour)}`;
    this.lockHintEl.style.display = isPointerLocked ? "none" : "block";
  }
}
