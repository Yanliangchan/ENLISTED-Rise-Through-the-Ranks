import type { RangeSessionResult } from "@/world/RangeTarget";

export interface RangeWeaponOption {
  id: string;
  name: string;
}

export interface TrainingRangeUICallbacks {
  onRetry: () => void;
  onChangeWeapon: (weaponId: string) => void;
  onChangeDistance: (m: number) => void;
  onResetTarget: () => void;
  onReturnToMenu: () => void;
}

function el(tag: string, cssText: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.style.cssText = cssText;
  return e;
}

const BTN_STYLE = `
  font-family: Consolas, "Courier New", monospace; letter-spacing: 1.5px; font-size: 12px;
  background: rgba(10,18,10,0.82); border: 1px solid rgba(140,210,140,0.4); color: #dcecd2;
  padding: 9px 14px; cursor: pointer;
`;

/**
 * Range-specific HUD: a slim always-on status bar (shots remaining, weapon,
 * distance) plus a results panel that locks over the screen once the 10th
 * shot resolves. Entirely separate from the combat HUD — the two are never
 * visible at once.
 */
export class TrainingRangeUI {
  private root: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private shotsEl: HTMLDivElement;
  private weaponSelect: HTMLSelectElement;
  private distanceSelect: HTMLSelectElement;
  private resultsPanel: HTMLDivElement;
  visible = false;

  constructor(
    container: HTMLElement,
    private readonly callbacks: TrainingRangeUICallbacks
  ) {
    this.root = el("div", "position:fixed; inset:0; z-index:40; display:none; pointer-events:none; font-family: Consolas, 'Courier New', monospace; color:#d5ddc8;");

    this.statusBar = el("div", `
      position:absolute; top:20px; left:50%; transform:translateX(-50%); pointer-events:auto;
      display:flex; align-items:center; gap:16px; background:rgba(6,14,8,0.78); border:1px solid rgba(110,190,120,0.3);
      padding:10px 18px; font-size:12px; letter-spacing:1px;
    `);

    this.shotsEl = el("div", "font-weight:bold; color:#eaf4e4; min-width:110px;");
    this.shotsEl.textContent = "SHOT 0/10";
    this.statusBar.appendChild(this.shotsEl);

    this.weaponSelect = document.createElement("select");
    this.weaponSelect.style.cssText = BTN_STYLE;
    this.weaponSelect.addEventListener("change", () => this.callbacks.onChangeWeapon(this.weaponSelect.value));
    this.statusBar.appendChild(this.weaponSelect);

    this.distanceSelect = document.createElement("select");
    this.distanceSelect.style.cssText = BTN_STYLE;
    this.distanceSelect.addEventListener("change", () => this.callbacks.onChangeDistance(parseInt(this.distanceSelect.value, 10)));
    this.statusBar.appendChild(this.distanceSelect);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "RESET TARGET";
    resetBtn.style.cssText = BTN_STYLE;
    resetBtn.addEventListener("click", () => this.callbacks.onResetTarget());
    this.statusBar.appendChild(resetBtn);

    const menuBtn = document.createElement("button");
    menuBtn.textContent = "MAIN MENU";
    menuBtn.style.cssText = BTN_STYLE;
    menuBtn.addEventListener("click", () => this.callbacks.onReturnToMenu());
    this.statusBar.appendChild(menuBtn);

    this.root.appendChild(this.statusBar);

    this.resultsPanel = el("div", `
      position:absolute; inset:0; display:none; pointer-events:auto;
      background:rgba(3,6,4,0.88); align-items:center; justify-content:center;
    `);
    this.root.appendChild(this.resultsPanel);

    container.appendChild(this.root);
  }

  setWeaponOptions(options: RangeWeaponOption[], selectedId: string): void {
    this.weaponSelect.innerHTML = options.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
    this.weaponSelect.value = selectedId;
  }

  setDistanceOptions(distances: readonly number[], selected: number): void {
    this.distanceSelect.innerHTML = distances.map((d) => `<option value="${d}">${d}M</option>`).join("");
    this.distanceSelect.value = String(selected);
  }

  /** True while the end-of-session results card is up — the cursor must stay free for its buttons. */
  get resultsOpen(): boolean {
    return this.visible && this.resultsPanel.style.display !== "none";
  }

  updateShotCount(shotsSoFar: number): void {
    this.shotsEl.textContent = `SHOT ${Math.min(shotsSoFar, 10)}/10`;
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "block";
    this.resultsPanel.style.display = "none";
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  showResults(result: RangeSessionResult, weaponName: string): void {
    this.resultsPanel.style.display = "flex";
    const card = document.createElement("div");
    card.style.cssText = `
      width:min(480px, 92vw); background:rgba(8,16,9,0.96); border:1px solid rgba(110,190,120,0.35);
      padding:26px 30px; max-height:88vh; overflow-y:auto;
    `;
    card.innerHTML = `
      <div style="font-size:15px; letter-spacing:3px; color:#9aa882; margin-bottom:4px;">SESSION COMPLETE</div>
      <div style="font-size:11px; letter-spacing:1px; color:#67725c; margin-bottom:18px;">${weaponName} · ${result.distanceM}M</div>
      <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; margin-bottom:20px;">
        ${statTile("Score", `${result.score}/100`)}
        ${statTile("Accuracy", `${result.accuracyPct}%`)}
        ${statTile("Head Hits", result.headHits)}
        ${statTile("Body Hits", result.bodyHits)}
        ${statTile("Misses", result.misses)}
        ${statTile("Group Size", `${result.groupSizeCm.toFixed(1)} cm`)}
        ${statTile("Centre Offset", `${result.centreOffsetCm.toFixed(1)} cm`)}
        ${statTile("Avg Dist. from Centre", `${result.avgDistFromCentreCm.toFixed(1)} cm`)}
      </div>
      <div id="rng-actions" style="display:flex; flex-wrap:wrap; gap:10px;"></div>
    `;
    const actions = card.querySelector<HTMLDivElement>("#rng-actions")!;
    const retryBtn = document.createElement("button");
    retryBtn.textContent = "RETRY";
    retryBtn.style.cssText = BTN_STYLE;
    retryBtn.addEventListener("click", () => {
      this.callbacks.onRetry();
      this.resultsPanel.style.display = "none";
    });
    const menuBtn = document.createElement("button");
    menuBtn.textContent = "MAIN MENU";
    menuBtn.style.cssText = BTN_STYLE;
    menuBtn.addEventListener("click", () => this.callbacks.onReturnToMenu());
    actions.append(retryBtn, menuBtn);

    this.resultsPanel.innerHTML = "";
    this.resultsPanel.appendChild(card);
  }
}

function statTile(label: string, value: string | number): string {
  return `
    <div style="background:#0e1610; border:1px solid #26301f; padding:10px 12px;">
      <div style="font-size:10px; letter-spacing:1px; color:#67725c;">${label.toUpperCase()}</div>
      <div style="font-size:18px; font-weight:bold; color:#eaf4e4;">${value}</div>
    </div>`;
}
