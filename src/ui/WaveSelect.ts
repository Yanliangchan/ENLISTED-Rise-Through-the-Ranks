/**
 * Small modal shown right before deploying: lets the player start a fresh
 * run at Wave 1, or jump straight into a milestone (5/10/15/...) they've
 * already cleared. Only ever shown when the player has cleared at least
 * Wave 5 — otherwise deploy goes straight to Wave 1 with no extra step.
 */
export class WaveSelect {
  private root: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 60; display: none;
      align-items: center; justify-content: center;
      background: rgba(4,8,6,0.92);
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
    `;
    container.appendChild(this.root);
  }

  show(highestWaveCleared: number, onSelect: (wave: number) => void): void {
    const milestones: number[] = [];
    for (let w = 5; w <= highestWaveCleared; w += 5) milestones.push(w);

    const panel = document.createElement("div");
    panel.style.cssText = `
      background:#0e1610; border:1px solid #2c3a26; padding:26px 30px;
      max-width:440px; text-align:center;
    `;

    const title = document.createElement("div");
    title.textContent = "SELECT STARTING WAVE";
    title.style.cssText = "font-size:16px; letter-spacing:2px; color:#9fc78a; margin-bottom:6px;";
    panel.appendChild(title);

    const sub = document.createElement("div");
    sub.textContent = "Start fresh, or jump straight into a checkpoint you've already cleared.";
    sub.style.cssText = "font-size:11px; color:#7f9a72; margin-bottom:18px;";
    panel.appendChild(sub);

    const grid = document.createElement("div");
    grid.style.cssText = "display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:16px;";
    const makeBtn = (label: string, wave: number, primary: boolean): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = `
        background:${primary ? "#3c6b32" : "#1c2c18"}; color:#eaffe0; border:1px solid ${primary ? "#5c9a45" : "#3c4a34"};
        padding:10px 16px; font-family:inherit; font-size:13px; cursor:pointer; letter-spacing:1px;
      `;
      btn.onclick = () => {
        this.hide();
        onSelect(wave);
      };
      return btn;
    };
    grid.appendChild(makeBtn("WAVE 1 — FRESH START", 1, true));
    for (const w of milestones) grid.appendChild(makeBtn(`WAVE ${w}`, w, false));
    panel.appendChild(grid);

    const cancel = document.createElement("button");
    cancel.textContent = "CANCEL";
    cancel.style.cssText = "background:none; color:#7f9a72; border:1px solid #2c3a26; padding:6px 14px; font-family:inherit; font-size:11px; cursor:pointer; letter-spacing:1px;";
    cancel.onclick = () => this.hide();
    panel.appendChild(cancel);

    this.root.innerHTML = "";
    this.root.appendChild(panel);
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
