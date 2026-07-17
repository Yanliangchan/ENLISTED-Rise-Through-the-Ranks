import type { Settings } from "@/core/Settings";
import type { AudioManager } from "@/core/AudioManager";
import type { PlayerController } from "@/player/PlayerController";
import type { GameState } from "@/core/GameState";
import type { PlayerStats } from "@/core/PlayerStats";
import { injectTheme } from "@/ui/theme";

/**
 * Escape-triggered pause overlay: operator identity + lifetime stats,
 * sensitivity/volume settings, and a reset-save escape hatch. Releases Pointer
 * Lock while open.
 */
export class PauseMenu {
  private root: HTMLDivElement;
  private statsBody: HTMLDivElement | null = null;
  private settingsBox!: HTMLDivElement;
  private feedbackEl!: HTMLDivElement;
  visible = false;
  /** Fired on every hide — main.ts uses it to hand focus straight back to the game. */
  onHide?: () => void;
  /** Persist all progress (game state + settings + current wave). Returns a short status string. */
  onSaveGame?: () => void;
  /** Save everything, then return to the main menu. */
  onSaveAndExit?: () => void;
  /** Return to the main menu without an explicit save. */
  onExitToMenu?: () => void;

  constructor(
    container: HTMLElement,
    private readonly settings: Settings,
    private readonly audio: AudioManager,
    private readonly player: PlayerController,
    private readonly gameState: GameState,
    private readonly username?: string,
    private readonly stats?: PlayerStats
  ) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-overlay";
    this.root.style.zIndex = "30";

    const panel = document.createElement("div");
    panel.className = "mil-panel";
    panel.style.cssText = "width: min(420px, 90vw); max-height: 88vh; overflow-y: auto;";

    const title = document.createElement("div");
    title.textContent = this.username ? `PAUSED — ${this.username}` : "PAUSED";
    title.className = "mil-title";
    title.style.marginBottom = "18px";
    panel.appendChild(title);

    if (this.stats) {
      const statsBox = document.createElement("div");
      statsBox.className = "mil-inset";
      statsBox.style.cssText = "margin-bottom:18px; font-size:13px; line-height:1.7;";
      const heading = document.createElement("div");
      heading.textContent = "OPERATOR RECORD";
      heading.className = "mil-kicker";
      statsBox.appendChild(heading);
      this.statsBody = document.createElement("div");
      statsBox.appendChild(this.statsBody);
      panel.appendChild(statsBox);
    }

    // --- Settings section (toggled by the Settings button) ---
    this.settingsBox = document.createElement("div");
    this.settingsBox.className = "mil-inset";
    this.settingsBox.style.cssText = "margin-bottom:16px; display:none;";
    const setHeading = document.createElement("div");
    setHeading.textContent = "SETTINGS";
    setHeading.className = "mil-kicker";
    this.settingsBox.appendChild(setHeading);
    // Minimum mouse sensitivity lowered to 0.1 (was 0.3); max unchanged at 2.5.
    this.settingsBox.appendChild(this.slider("Mouse sensitivity", 0.1, 2.5, 0.05, settings.data.sensitivity, (v) => {
      settings.data.sensitivity = v;
      settings.save();
      player.sensitivityMult = v;
    }));
    // Separate ADS/scope sensitivity — only affects aiming, saved with settings.
    this.settingsBox.appendChild(this.slider("Scope (ADS) sensitivity", 0.1, 2.5, 0.05, settings.data.adsSensitivity, (v) => {
      settings.data.adsSensitivity = v;
      settings.save();
      player.adsSensitivitySetting = v;
    }));
    this.settingsBox.appendChild(this.slider("Volume", 0, 1, 0.05, settings.data.volume, (v) => {
      settings.data.volume = v;
      settings.save();
      audio.setVolume(v);
    }));
    panel.appendChild(this.settingsBox);

    // --- Menu actions ---
    panel.appendChild(this.actionBtn("Resume", "primary", () => this.hide()));
    panel.appendChild(this.actionBtn("Settings", "", () => {
      const showing = this.settingsBox.style.display !== "none";
      this.settingsBox.style.display = showing ? "none" : "block";
    }));
    panel.appendChild(this.actionBtn("Save Game", "", () => {
      this.onSaveGame?.();
      this.flash("Progress saved.");
    }));
    panel.appendChild(this.actionBtn("Save and Exit", "", () => {
      this.onSaveAndExit?.();
    }));
    panel.appendChild(this.actionBtn("Exit to Main Menu", "danger", () => {
      if (confirm("Exit to the main menu? Unsaved progress in this wave will be lost.")) {
        this.onExitToMenu?.();
      }
    }));

    // Save/confirmation feedback line.
    this.feedbackEl = document.createElement("div");
    this.feedbackEl.style.cssText = "min-height:16px; margin-top:10px; font-size:12px; color:#9fc78a; text-align:center;";
    panel.appendChild(this.feedbackEl);

    this.root.appendChild(panel);
    container.appendChild(this.root);
  }

  private actionBtn(label: string, kind: "primary" | "danger" | "", onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = `mil-btn${kind === "primary" ? " mil-btn-primary" : kind === "danger" ? " mil-btn-danger" : ""}`;
    btn.style.cssText = "width:100%; margin-top:8px; padding:10px 16px; font-size:14px;";
    btn.onclick = onClick;
    return btn;
  }

  private flash(msg: string): void {
    this.feedbackEl.textContent = msg;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      if (this.feedbackEl) this.feedbackEl.textContent = "";
    }, 2500);
  }

  private flashTimer = 0;

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
    input.className = "mil-slider";
    input.oninput = () => onChange(parseFloat(input.value));
    wrap.appendChild(labelEl);
    wrap.appendChild(input);
    return wrap;
  }

  private renderStats(): void {
    if (!this.stats || !this.statsBody) return;
    const s = this.stats.data;
    const row = (k: string, v: string) =>
      `<div style="display:flex; justify-content:space-between;"><span style="color:#8fa585;">${k}</span><span>${v}</span></div>`;
    const mins = Math.floor(s.playtimeSec / 60);
    this.statsBody.innerHTML =
      row("Deployments", String(s.gamesPlayed)) +
      row("Kills", String(s.kills)) +
      row("Headshots", String(s.headshots)) +
      row("Accuracy", `${this.stats.accuracyPct}%`) +
      row("Highest wave", String(s.highestWave)) +
      row("Best game kills", String(s.bestGameKills)) +
      row("Deaths", String(s.deaths)) +
      row("Credits earned", String(s.creditsEarned)) +
      row("Time in sector", `${mins} min`);
  }

  show(): void {
    this.visible = true;
    this.renderStats();
    this.root.style.display = "flex";
    document.exitPointerLock();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
    this.onHide?.();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
}
