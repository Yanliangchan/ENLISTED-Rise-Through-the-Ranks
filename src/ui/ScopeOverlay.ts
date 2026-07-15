export type OpticKind = "none" | "scope" | "reddot";

/**
 * Screen-space optic overlay with two modes:
 *  - "scope": a circular vignette (CSS box-shadow) + a green military
 *    crosshair with a small centre aiming dot, for magnified optics.
 *  - "reddot": just a glowing red dot (and a faint ring) at screen centre,
 *    for red-dot / holographic sights — no vignette, so the view stays open.
 * The main camera's own FOV narrows for the magnification, so the sight
 * picture is a normal, undistorted perspective view.
 */
export class ScopeOverlay {
  private root: HTMLDivElement;
  private circle: HTMLDivElement;
  private scopeReticle: HTMLDivElement;
  private redDot: HTMLDivElement;
  private minDimVmin = 100;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; display: none; pointer-events: none; z-index: 12;
    `;

    this.circle = document.createElement("div");
    this.circle.style.cssText = `
      position: absolute; top: 50%; left: 50%; border-radius: 50%;
      transform: translate(-50%, -50%); background: transparent;
    `;

    this.scopeReticle = document.createElement("div");
    this.scopeReticle.style.cssText = `position: absolute; top: 50%; left: 50%; width: 1px; height: 1px; display: none;`;
    const bar = "background:#39ff6a; box-shadow:0 0 3px rgba(57,255,106,0.9);";
    this.scopeReticle.innerHTML = `
      <div style="position:absolute; left:-1px; top:-90px; width:2px; height:64px; ${bar}"></div>
      <div style="position:absolute; left:-1px; top:26px; width:2px; height:64px; ${bar}"></div>
      <div style="position:absolute; top:-1px; left:-90px; height:2px; width:64px; ${bar}"></div>
      <div style="position:absolute; top:-1px; left:26px; height:2px; width:64px; ${bar}"></div>
      <div style="position:absolute; left:-2px; top:-2px; width:4px; height:4px; border-radius:50%; ${bar}"></div>
    `;

    // Red dot: a glowing dot with a faint outer ring.
    this.redDot = document.createElement("div");
    this.redDot.style.cssText = `position: absolute; top: 50%; left: 50%; display: none;`;
    this.redDot.innerHTML = `
      <div style="position:absolute; transform:translate(-50%,-50%); width:60px; height:60px; border-radius:50%;
                  border:1px solid rgba(255,60,50,0.25); box-shadow:0 0 8px rgba(255,40,30,0.15) inset;"></div>
      <div style="position:absolute; transform:translate(-50%,-50%); width:6px; height:6px; border-radius:50%;
                  background:#ff2a20; box-shadow:0 0 6px 2px rgba(255,40,30,0.9);"></div>
    `;

    this.root.appendChild(this.circle);
    this.root.appendChild(this.scopeReticle);
    this.root.appendChild(this.redDot);
    container.appendChild(this.root);
  }

  /** kind selects the optic type; blend is 0..1 ADS progress. */
  update(kind: OpticKind, blend: number): void {
    if (kind === "none" || blend <= 0.02) {
      this.root.style.display = "none";
      return;
    }
    this.root.style.display = "block";

    if (kind === "scope") {
      this.scopeReticle.style.display = "block";
      this.redDot.style.display = "none";
      const openRadius = this.minDimVmin * 0.75;
      const scopedRadius = this.minDimVmin * 0.36;
      const radius = openRadius + (scopedRadius - openRadius) * blend;
      this.circle.style.width = `${radius * 2}vmin`;
      this.circle.style.height = `${radius * 2}vmin`;
      this.circle.style.boxShadow = `0 0 0 100vmax rgba(2,2,2,${0.92 * blend})`;
    } else {
      // reddot — no vignette, just fade the dot in with ADS.
      this.scopeReticle.style.display = "none";
      this.circle.style.boxShadow = "none";
      this.redDot.style.display = "block";
      this.redDot.style.opacity = String(Math.min(1, blend * 1.4));
    }
  }
}
