import type { Settings } from "@/core/Settings";
import type { AudioManager } from "@/core/AudioManager";
import type { PlayerController } from "@/player/PlayerController";
import type { GameState } from "@/core/GameState";

/**
 * Escape-triggered pause overlay: sensitivity/volume settings + a reset-save
 * escape hatch. Releases Pointer Lock while open.
 */
export class PauseMenu {
  private root: HTMLDivElement;
  visible = false;

  constructor(
    container: HTMLElement,
    private readonly settings: Settings,
    private readonly audio: AudioManager,
    private readonly player: PlayerController,
    private readonly gameState: GameState
  ) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(5,10,5,0.8); font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
      z-index: 30;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
      width: min(420px, 90vw); background: #10160f; border: 1px solid #3c4a34;
      padding: 24px; box-shadow: 0 0 40px rgba(0,0,0,0.6);
    `;

    const title = document.createElement("div");
    title.textContent = "PAUSED";
    title.style.cssText = "font-size:22px; font-weight:bold; letter-spacing:2px; margin-bottom:18px;";
    panel.appendChild(title);

    panel.appendChild(this.slider("Mouse sensitivity", 0.3, 2.5, 0.05, settings.data.sensitivity, (v) => {
      settings.data.sensitivity = v;
      settings.save();
      player.sensitivityMult = v;
    }));

    panel.appendChild(this.slider("Volume", 0, 1, 0.05, settings.data.volume, (v) => {
      settings.data.volume = v;
      settings.save();
      audio.setVolume(v);
    }));

    const resumeBtn = document.createElement("button");
    resumeBtn.textContent = "Resume";
    resumeBtn.style.cssText = this.btnStyle("#3c6b32");
    resumeBtn.onclick = () => this.hide();
    panel.appendChild(resumeBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset Save";
    resetBtn.style.cssText = this.btnStyle("#6b3232");
    resetBtn.onclick = () => {
      if (confirm("Reset all progress (credits, unlocks, loadout)?")) {
        gameState.resetRun();
        location.reload();
      }
    };
    panel.appendChild(resetBtn);

    this.root.appendChild(panel);
    container.appendChild(this.root);
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:16px;";
    const labelEl = document.createElement("div");
    labelEl.textContent = label;
    labelEl.style.cssText = "font-size:13px; margin-bottom:6px; color:#9fc78a;";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.width = "100%";
    input.oninput = () => onChange(parseFloat(input.value));
    wrap.appendChild(labelEl);
    wrap.appendChild(input);
    return wrap;
  }

  private btnStyle(bg: string): string {
    return `background:${bg}; color:#eaf0e6; border:1px solid rgba(255,255,255,0.15); padding:8px 16px; font-family:inherit; font-size:14px; cursor:pointer; width:100%; margin-top:8px;`;
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "flex";
    document.exitPointerLock();
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
