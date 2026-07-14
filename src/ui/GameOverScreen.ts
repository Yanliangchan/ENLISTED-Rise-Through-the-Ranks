import type { GameState } from "@/core/GameState";

/** Shown when the player dies: wave reached, credits banked, restart. */
export class GameOverScreen {
  private root: HTMLDivElement;
  onRestart?: () => void;
  visible = false;

  constructor(container: HTMLElement, private readonly gameState: GameState) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(10,4,4,0.85); font-family: Consolas, "Courier New", monospace; color: #f0e6e0;
      z-index: 40; text-align: center;
    `;
    container.appendChild(this.root);
  }

  show(waveReached: number): void {
    this.root.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = "SECTOR OVERRUN";
    title.style.cssText = "font-size:36px; font-weight:bold; letter-spacing:4px; color:#c0392b; margin-bottom:12px;";
    const sub = document.createElement("div");
    sub.textContent = `You held out to Wave ${waveReached}. Credits banked: ${this.gameState.data.credits}.`;
    sub.style.cssText = "font-size:16px; margin-bottom:24px;";
    const btn = document.createElement("button");
    btn.textContent = "Redeploy";
    btn.style.cssText = `
      background:#3c6b32; color:#eaf0e6; border:1px solid rgba(255,255,255,0.2);
      padding:12px 28px; font-family:inherit; font-size:16px; cursor:pointer;
    `;
    btn.onclick = () => this.onRestart?.();

    const wrap = document.createElement("div");
    wrap.appendChild(title);
    wrap.appendChild(sub);
    wrap.appendChild(btn);
    this.root.appendChild(wrap);
    this.root.style.display = "flex";
    this.visible = true;
    document.exitPointerLock();
  }

  hide(): void {
    this.root.style.display = "none";
    this.visible = false;
  }
}
