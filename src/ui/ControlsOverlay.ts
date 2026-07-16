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
  ["F", "Collect supply crate (ammo/health)"],
  ["H", "Fire underbarrel M203 (if fitted)"],
  ["1 / 2 / 3 / 4", "Primary / Secondary / Special / Throwable"],
  ["Mouse Wheel", "Cycle equipped slots"],
  ["Q", "Launch UAV recon (reveals enemies 20s)"],
  ["B", "Open armoury (between waves)"],
  ["M", "Tactical map"],
  ["Tab", "Toggle this controls list"],
  ["Escape", "Pause / settings"],
];

/**
 * Reference card for the keybindings — auto-shown during the pre-Wave-1
 * intro scouting window, and toggle-able any time with `Tab`.
 */
export class ControlsOverlay {
  private root: HTMLDivElement;
  visible = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      display: none; z-index: 15; pointer-events: none;
      background: rgba(10,16,10,0.72); border: 1px solid rgba(255,255,255,0.15);
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
      padding: 18px 24px; min-width: 320px;
    `;

    const title = document.createElement("div");
    title.textContent = "CONTROLS";
    title.style.cssText = "font-size:16px; font-weight:bold; letter-spacing:2px; margin-bottom:10px; color:#9fc78a;";
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
