/**
 * Full CoD-style "looking through the scope" overlay: a black vignette with
 * a circular window (CSS box-shadow trick, no canvas/SVG needed) plus a
 * crosshair/mil-dot reticle drawn inside it. WeaponController shows this —
 * and fully hides the gun viewmodel — once ADS blend is high on any optic
 * with meaningful zoom (reflex/iron sights stay as in-world geometry).
 */
export class ScopeOverlay {
  private root: HTMLDivElement;
  private circle: HTMLDivElement;
  private minDimVmin = 100;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; display: none; pointer-events: none; z-index: 12;
    `;

    this.circle = document.createElement("div");
    this.circle.style.cssText = `
      position: absolute; top: 50%; left: 50%; border-radius: 50%;
      transform: translate(-50%, -50%);
      background: transparent;
    `;

    const reticle = document.createElement("div");
    reticle.style.cssText = `
      position: absolute; top: 50%; left: 50%; width: 1px; height: 1px;
    `;
    reticle.innerHTML = `
      <div style="position:absolute; left:-1px; top:-140px; width:2px; height:110px; background:rgba(10,10,10,0.85);"></div>
      <div style="position:absolute; left:-1px; top:30px; width:2px; height:110px; background:rgba(10,10,10,0.85);"></div>
      <div style="position:absolute; top:-1px; left:-140px; height:2px; width:110px; background:rgba(10,10,10,0.85);"></div>
      <div style="position:absolute; top:-1px; left:30px; height:2px; width:110px; background:rgba(10,10,10,0.85);"></div>
      <div style="position:absolute; left:-2px; top:-2px; width:4px; height:4px; border-radius:50%; background:rgba(10,10,10,0.85);"></div>
    `;

    // Thin rangefinder tick marks along the vertical stadia line, purely decorative.
    for (let i = 1; i <= 3; i++) {
      const tick = document.createElement("div");
      tick.style.cssText = `
        position:absolute; left:-8px; top:${30 + i * 24}px; width:16px; height:1.5px;
        background:rgba(10,10,10,0.7);
      `;
      reticle.appendChild(tick);
    }

    this.root.appendChild(this.circle);
    this.root.appendChild(reticle);
    container.appendChild(this.root);
  }

  /** blend 0 = fully open/off-screen circle (hidden), 1 = tight scope window. */
  update(active: boolean, blend: number): void {
    if (!active || blend <= 0.01) {
      this.root.style.display = "none";
      return;
    }
    this.root.style.display = "block";
    const openRadius = this.minDimVmin * 0.75;
    const scopedRadius = this.minDimVmin * 0.33;
    const radius = openRadius + (scopedRadius - openRadius) * blend;
    this.circle.style.width = `${radius * 2}vmin`;
    this.circle.style.height = `${radius * 2}vmin`;
    this.circle.style.boxShadow = `0 0 0 100vmax rgba(2,2,2,${0.92 * blend})`;
  }
}
