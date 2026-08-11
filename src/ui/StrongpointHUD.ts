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
  /** Rebuilt with the result panel each time; holds server-awarded badges once they land. */
  private badgeEl: HTMLDivElement | null = null;
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
    title.textContent = "PASIR PANJANG TERMINAL";
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
    this.badgeEl = document.createElement("div");
    this.badgeEl.style.cssText = `font-size:13px; color:${SAF.amber}; margin-bottom:20px; letter-spacing:1px; min-height:0;`;
    wrap.appendChild(this.badgeEl);
    wrap.appendChild(btn);
    this.resultOverlay.appendChild(wrap);
    this.resultOverlay.style.display = "flex";
    document.exitPointerLock();
  }

  /**
   * Appends any badges the server awarded for this run to the result panel.
   * Arrives after `showResult` because the award is decided server-side on
   * match submit, one network round trip later.
   */
  showBadges(badges: Array<{ code: string; name: string; icon: string }>): void {
    if (!this.badgeEl || badges.length === 0) return;
    this.badgeEl.innerHTML =
      `<div style="color:${SAF.textDim}; font-size:11px; letter-spacing:2px; margin-bottom:6px;">AWARDED</div>` +
      badges.map((b) => `${b.icon} ${b.name}`).join(" &nbsp;·&nbsp; ");
  }

  updateTimer(secondsLeft: number): void {
    const m = Math.floor(secondsLeft / 60);
    const s = Math.floor(secondsLeft % 60);
    this.timerEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    this.timerEl.style.color = secondsLeft <= 60 ? SAF.red : SAF.amber;
  }

  /**
   * Objective board: one row per strongpoint, plus — for whichever one is
   * being fought — its live defensive layer and how many are left behind it.
   * That second line is what tells the player a position has depth, so
   * clearing the outer screen reads as progress into it rather than a bug.
   */
  updateObjectives(strongpoints: Strongpoint[]): void {
    this.listEl.innerHTML = strongpoints
      .map((sp, i) => {
        const colour =
          sp.state === "cleared" ? SAF.sage : sp.state === "active" ? SAF.amber : SAF.textFaint;
        const mark =
          sp.state === "cleared" ? "✓" : sp.state === "active" ? "▸" : sp.state === "gated" ? "🔒" : String(i + 1);
        const strike = sp.state === "cleared" ? "text-decoration:line-through;" : "";
        let sub = "";
        if (sp.state === "active") {
          const phase = sp.phases[sp.phaseIndex];
          const left = sp.phases.length - sp.phaseIndex - 1;
          if (phase) {
            sub =
              `<div style="margin:1px 0 3px 22px; font-family:${SAF.fontMono}; font-size:10px; color:${SAF.textDim}; letter-spacing:1px;">` +
              `${phase.label}${left > 0 ? ` · +${left} LAYER${left > 1 ? "S" : ""}` : " · FINAL"}` +
              `</div>`;
          }
        } else if (sp.state === "gated") {
          sub = `<div style="margin:1px 0 3px 22px; font-size:10px; color:${SAF.textFaint}; letter-spacing:1px;">CLEAR THE TERMINAL FIRST</div>`;
        }
        return (
          `<div style="display:flex; gap:8px; align-items:baseline; font-size:12px; color:${colour};">` +
          `<span style="font-family:${SAF.fontMono}; width:14px;">${mark}</span>` +
          `<span style="letter-spacing:1px; text-transform:uppercase; ${strike}">${sp.name}</span>` +
          `</div>${sub}`
        );
      })
      .join("");
  }
}
