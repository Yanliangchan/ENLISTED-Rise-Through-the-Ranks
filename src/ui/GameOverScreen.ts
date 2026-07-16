import type { GameState } from "@/core/GameState";
import { injectTheme } from "@/ui/theme";

/** Shown when the player dies: wave reached, credits banked, restart. */
export class GameOverScreen {
  private root: HTMLDivElement;
  private progressEl: HTMLDivElement | null = null;
  onRestart?: () => void;
  visible = false;

  constructor(container: HTMLElement, private readonly gameState: GameState) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-overlay";
    this.root.style.cssText += "background: rgba(12,4,4,0.85); z-index: 40; text-align: center;";
    container.appendChild(this.root);
  }

  show(waveReached: number): void {
    this.root.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = "SECTOR OVERRUN";
    title.style.cssText = "font-size:36px; font-weight:bold; letter-spacing:4px; color:#c0392b; margin-bottom:12px;";
    const sub = document.createElement("div");
    sub.textContent = `You held out to Wave ${waveReached}. Credits banked: ${this.gameState.data.credits}.`;
    sub.style.cssText = "font-size:16px; margin-bottom:12px;";

    // Populated asynchronously once the match result reaches the server —
    // starts as a quiet "saving" line so a slow/offline connection is visible
    // rather than looking like nothing happened.
    this.progressEl = document.createElement("div");
    this.progressEl.textContent = "Saving deployment record…";
    this.progressEl.style.cssText = "font-size:13px; color:#9fae9c; min-height:18px; margin-bottom:16px;";

    const btn = document.createElement("button");
    btn.textContent = "Redeploy";
    btn.className = "mil-btn mil-btn-primary";
    btn.style.cssText = "padding:12px 28px; font-size:16px;";
    btn.onclick = () => this.onRestart?.();

    const wrap = document.createElement("div");
    wrap.appendChild(title);
    wrap.appendChild(sub);
    wrap.appendChild(this.progressEl);
    wrap.appendChild(btn);
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
