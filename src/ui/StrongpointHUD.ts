import { SAF } from "@/ui/saf";
import { injectTheme } from "@/ui/theme";
import type { Strongpoint } from "@/world/StrongpointMission";

/**
 * Objective HUD for Strongpoint Assault: a fixed panel listing all four
 * strongpoints with their locked/active/cleared state, plus the mission
 * timer. Styled through the shared SAF theme (flat panel, camo-backed top
 * rule, condensed uppercase labels) — the same visual language as
 * StrikeTargeting's fire-mission board, not the pre-rework inline styling
 * still on Iron Citadel's exit button.
 */
export class StrongpointHUD {
  private root: HTMLDivElement;
  private listEl: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private resultOverlay: HTMLDivElement;
  onReturnToBase?: () => void;

  constructor(container: HTMLElement) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed; top:clamp(10px,1.8vh,24px); left:clamp(12px,2vw,30px); z-index:15; display:none;" +
      "width:260px; pointer-events:none;";

    const panel = document.createElement("div");
    panel.className = "mil-panel";
    panel.style.cssText = "padding:12px 14px;";

    const title = document.createElement("div");
    title.className = "mil-title";
    title.textContent = "STRONGPOINT ASSAULT";
    title.style.fontSize = "13px";

    this.timerEl = document.createElement("div");
    this.timerEl.style.cssText = `font-family:${SAF.fontMono}; font-size:22px; color:${SAF.amber}; margin:8px 0 10px; letter-spacing:2px;`;

    this.listEl = document.createElement("div");
    this.listEl.style.cssText = "display:flex; flex-direction:column; gap:5px;";

    panel.appendChild(title);
    panel.appendChild(this.timerEl);
    panel.appendChild(this.listEl);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.resultOverlay = document.createElement("div");
    this.resultOverlay.className = "mil-overlay";
    this.resultOverlay.style.cssText = "background: rgba(7,10,6,0.9); z-index: 40; text-align: center;";
    container.appendChild(this.resultOverlay);
  }

  get resultVisible(): boolean {
    return this.resultOverlay.style.display === "flex";
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
    this.resultOverlay.style.display = "none";
  }

  /** Full-screen mission-clear or mission-fail overlay with a return-to-base action. */
  showResult(won: boolean, detail: string): void {
    this.resultOverlay.innerHTML = "";
    const wrap = document.createElement("div");

    const title = document.createElement("div");
    title.textContent = won ? "OPERATION SUCCESSFUL" : "OPERATION FAILED";
    title.style.cssText = `font-size:34px; font-weight:700; letter-spacing:6px; color:${won ? SAF.sage : SAF.red}; margin-bottom:10px; text-shadow:2px 2px 3px rgba(0,0,0,0.95);`;

    const sub = document.createElement("div");
    sub.textContent = detail;
    sub.style.cssText = `font-size:13px; color:${SAF.textDim}; margin-bottom:22px; letter-spacing:1px;`;

    const btn = document.createElement("button");
    btn.textContent = "RETURN TO BASE";
    btn.className = "mil-btn mil-btn-primary";
    btn.style.cssText = "padding:12px 26px; font-size:14px;";
    btn.onclick = () => this.onReturnToBase?.();

    wrap.appendChild(title);
    wrap.appendChild(sub);
    wrap.appendChild(btn);
    this.resultOverlay.appendChild(wrap);
    this.resultOverlay.style.display = "flex";
    document.exitPointerLock();
  }

  updateTimer(secondsLeft: number): void {
    const m = Math.floor(secondsLeft / 60);
    const s = Math.floor(secondsLeft % 60);
    this.timerEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    this.timerEl.style.color = secondsLeft <= 60 ? SAF.red : SAF.amber;
  }

  updateObjectives(strongpoints: Strongpoint[]): void {
    this.listEl.innerHTML = strongpoints
      .map((sp, i) => {
        const colour = sp.state === "cleared" ? SAF.sage : sp.state === "active" ? SAF.amber : SAF.textFaint;
        const mark = sp.state === "cleared" ? "✓" : sp.state === "active" ? "▸" : String(i + 1);
        return (
          `<div style="display:flex; gap:8px; align-items:baseline; font-size:12px; color:${colour};">` +
          `<span style="font-family:${SAF.fontMono}; width:14px;">${mark}</span>` +
          `<span style="letter-spacing:1px; text-transform:uppercase; ${sp.state === "cleared" ? "text-decoration:line-through;" : ""}">${sp.name}</span>` +
          `</div>`
        );
      })
      .join("");
  }
}
