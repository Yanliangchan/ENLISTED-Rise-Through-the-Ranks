import type { GameState } from "@/core/GameState";
import { injectTheme } from "@/ui/theme";

/**
 * Shown when the player dies: wave reached, credits banked, and a choice of
 * where to restart.
 *
 * The restart options matter — a player who deliberately started at Wave 10
 * should not be silently dropped back to Wave 1. The caller supplies the
 * checkpoints this run is entitled to (Wave 1 plus every milestone up to where
 * it began) and the choice is handed straight back, so the selected start wave
 * survives death for as long as the player keeps redeploying.
 */
export class GameOverScreen {
  private root: HTMLDivElement;
  private progressEl: HTMLDivElement | null = null;
  /** Called with the wave the player chose to restart from. */
  onRestart?: (wave: number) => void;
  visible = false;

  constructor(container: HTMLElement, private readonly gameState: GameState) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-overlay";
    this.root.style.cssText += "background: rgba(12,4,4,0.88); z-index: 40; text-align: center;";
    container.appendChild(this.root);
  }

  show(waveReached: number, restartOptions: number[] = [1]): void {
    this.root.innerHTML = "";

    const title = document.createElement("div");
    title.textContent = "MISSION FAILED";
    title.style.cssText =
      "font-size:40px; font-weight:bold; letter-spacing:6px; color:#c0392b; margin-bottom:6px;" +
      "text-shadow: 0 0 24px rgba(192,57,43,0.45);";

    const sub = document.createElement("div");
    sub.textContent = `Sector overrun on Wave ${waveReached}. Credits banked: ${this.gameState.data.credits}.`;
    sub.style.cssText = "font-size:15px; color:#d7c9c4; margin-bottom:14px;";

    // Populated asynchronously once the match result reaches the server —
    // starts as a quiet "saving" line so a slow/offline connection is visible
    // rather than looking like nothing happened.
    this.progressEl = document.createElement("div");
    this.progressEl.textContent = "Saving deployment record…";
    this.progressEl.style.cssText = "font-size:13px; color:#9fae9c; min-height:18px; margin-bottom:22px;";

    const prompt = document.createElement("div");
    prompt.textContent = "START AGAIN";
    prompt.style.cssText =
      "font-size:13px; letter-spacing:4px; color:#9fc78a; margin-bottom:12px;" +
      "border-top:1px solid rgba(159,199,138,0.25); padding-top:16px;";

    const grid = document.createElement("div");
    grid.style.cssText = "display:flex; flex-wrap:wrap; gap:10px; justify-content:center;";
    // Ascending, de-duplicated — the highest option is the one the player
    // actually chose for this run, so it reads as the natural "carry on" pick.
    const options = [...new Set(restartOptions)].sort((a, b) => a - b);
    for (const wave of options) {
      const btn = document.createElement("button");
      btn.textContent = `WAVE ${wave}`;
      btn.className = "mil-btn";
      // Highlight the run's own entry point when there is a real choice.
      if (options.length > 1 && wave === options[options.length - 1]) btn.classList.add("mil-btn-primary");
      btn.style.cssText = "padding:14px 30px; font-size:16px; letter-spacing:2px;";
      btn.onclick = () => this.onRestart?.(wave);
      grid.appendChild(btn);
    }

    const wrap = document.createElement("div");
    wrap.appendChild(title);
    wrap.appendChild(sub);
    wrap.appendChild(this.progressEl);
    wrap.appendChild(prompt);
    wrap.appendChild(grid);
    this.root.appendChild(wrap);
    this.root.style.display = "flex";
    this.visible = true;
    document.exitPointerLock();
  }

  /** Called once the match-save request resolves — reports XP earned, any rank-up, and newly unlocked badges. */
  showMatchResult(
    xpGained: number,
    rankUp: { from: string; to: string } | null,
    newBadges: Array<{ name: string; icon: string }>
  ): void {
    if (!this.progressEl) return;
    const parts = [`+${xpGained} XP`];
    if (rankUp) parts.push(`Promoted: ${rankUp.from} → ${rankUp.to}`);
    for (const b of newBadges) parts.push(`New badge: ${b.icon} ${b.name}`);
    this.progressEl.textContent = parts.join("  ·  ");
    this.progressEl.style.color = rankUp || newBadges.length ? "#e0d15a" : "#9fae9c";
  }

  showSyncError(): void {
    if (!this.progressEl) return;
    this.progressEl.textContent = "Could not save this deployment — check your connection.";
    this.progressEl.style.color = "#e08a6a";
  }

  hide(): void {
    this.root.style.display = "none";
    this.visible = false;
  }
}
