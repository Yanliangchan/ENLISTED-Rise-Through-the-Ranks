/**
 * Simple, clean scope-in overlay: a circular vignette (CSS box-shadow trick,
 * no extra render target/camera) with a thin military-style crosshair drawn
 * inside it. The main camera's own FOV narrows for the magnification, so the
 * sight picture is a normal perspective view — no lens-disc distortion, no
 * render-target flip to get wrong, and no extra render pass cost.
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
    // Clean crosshair: four short thin bars with a gap at centre so the
    // target point itself is never obscured. No dot, no clutter.
    reticle.innerHTML = `
      <div style="position:absolute; left:-1px; top:-90px; width:2px; height:66px; background:rgba(15,15,15,0.88);"></div>
      <div style="position:absolute; left:-1px; top:24px; width:2px; height:66px; background:rgba(15,15,15,0.88);"></div>
      <div style="position:absolute; top:-1px; left:-90px; height:2px; width:66px; background:rgba(15,15,15,0.88);"></div>
      <div style="position:absolute; top:-1px; left:24px; height:2px; width:66px; background:rgba(15,15,15,0.88);"></div>
    `;

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
    const scopedRadius = this.minDimVmin * 0.36;
    const radius = openRadius + (scopedRadius - openRadius) * blend;
    this.circle.style.width = `${radius * 2}vmin`;
    this.circle.style.height = `${radius * 2}vmin`;
    this.circle.style.boxShadow = `0 0 0 100vmax rgba(2,2,2,${0.92 * blend})`;
  }
}
