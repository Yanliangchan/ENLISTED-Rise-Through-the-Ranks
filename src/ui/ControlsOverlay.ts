const BINDINGS: Array<[string, string]> = [
  ["W A S D", "Move"],
  ["Shift", "Sprint"],
  ["C", "Crouch (deploy bipod if fitted)"],
  ["Space", "Jump"],
  ["Mouse", "Look"],
  ["Left Click", "Fire"],
  ["Right Click", "Aim down sights"],
  ["R", "Reload"],
  ["G", "Throw equipped throwable"],
  ["F", "Collect supply crate (ammo/medical)"],
  ["H", "Fire underbarrel M203 (if fitted)"],
  ["1 / 2 / 3 / 4", "Primary / Secondary / Special / Throwable"],
  ["5", "Use first aid kit (heals 50% max health)"],
  ["Mouse Wheel", "Cycle equipped slots"],
  ["Z", "Launch UAV recon (reveals enemies 20s)"],
  ["Q", "BOTTY command wheel (if deployed)"],
  ["B", "Open armoury (between waves)"],
  ["M", "Tactical map"],
  ["Tab", "Toggle this controls list"],
  ["Escape", "Pause / settings"],
];

/**
 * Reference card for the keybindings — auto-shown during the pre-Wave-1
 * intro scouting window, and toggle-able any time with `Tab`.
 */
import { injectTheme } from "@/ui/theme";

export class ControlsOverlay {
  private root: HTMLDivElement;
  visible = false;

  constructor(container: HTMLElement) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-panel";
    this.root.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      display: none; z-index: 15; pointer-events: none;
      background: rgba(12, 18, 11, 0.9); min-width: 320px; max-height: 88vh; overflow-y: auto;
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
    `;

    const title = document.createElement("div");
    title.textContent = "CONTROLS";
    title.className = "mil-title";
    title.style.cssText = "font-size:16px; margin-bottom:10px;";
    this.root.appendChild(title);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid; grid-template-columns: auto 1fr; gap:4px 18px; font-size:13px;";
    for (const [key, desc] of BINDINGS) {
      const keyEl = document.createElement("div");
      keyEl.textContent = key;
      keyEl.style.cssText = "color:#e0c15a; white-space:nowrap;";
      const descEl = document.createElement("div");
      descEl.textContent = desc;
      grid.appendChild(keyEl);
      grid.appendChild(descEl);
    }
    this.root.appendChild(grid);

    const hint = document.createElement("div");
    hint.textContent = "Tab to hide";
    hint.style.cssText = "margin-top:10px; font-size:11px; color:#8a9a84; text-align:right;";
    this.root.appendChild(hint);

    container.appendChild(this.root);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "block";
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
}
