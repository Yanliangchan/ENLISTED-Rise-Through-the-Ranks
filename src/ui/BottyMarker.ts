import { Vector3, Matrix, Viewport, type Scene, type Camera } from "@babylonjs/core";

const MAX_LABEL_DIST_M = 45; // beyond this the overhead label fades out — the edge arrow takes over
const EDGE_MARGIN_PX = 42;

/**
 * BOTTY's on-screen presence: a floating "BOTTY" nameplate over his head when
 * he's in view and close enough to matter, and a clamped edge-of-screen arrow
 * pointing toward him whenever he's off-screen or behind the player — the
 * classic squadmate-locator pattern so he's never truly "lost".
 */
export class BottyMarker {
  private nameplate: HTMLDivElement;
  private edgeArrow: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.nameplate = document.createElement("div");
    this.nameplate.style.cssText = `
      position: fixed; transform: translate(-50%, -100%); display: none;
      pointer-events: none; z-index: 8; text-align: center;
    `;
    this.nameplate.innerHTML = `
      <div style="
        background: rgba(10,16,10,0.8); border: 1px solid #2e6ab8; border-radius: 0;
        color: #cfe0f2; font-family: "Roboto Condensed", "Arial Narrow", Arial, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
        letter-spacing: 1px; padding: 2px 8px; white-space: nowrap;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
      ">BOTTY</div>
      <div style="
        margin: 3px auto 0; width: 0; height: 0;
        border-left: 5px solid transparent; border-right: 5px solid transparent;
        border-bottom: 7px solid #2e6ab8;
      "></div>
    `;

    this.edgeArrow = document.createElement("div");
    this.edgeArrow.style.cssText = `
      position: fixed; display: none; pointer-events: none; z-index: 8;
      width: 0; height: 0; transform-origin: center;
      border-left: 9px solid transparent; border-right: 9px solid transparent;
      border-bottom: 16px solid #2e6ab8;
    `;

    container.appendChild(this.nameplate);
    container.appendChild(this.edgeArrow);
  }

  hide(): void {
    this.nameplate.style.display = "none";
    this.edgeArrow.style.display = "none";
  }

  /** Project BOTTY's head position onto screen space; falls back to the edge arrow when off-screen. */
  update(scene: Scene, camera: Camera, bottyHeadPos: Vector3, isDown: boolean): void {
    const engine = scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const viewport = new Viewport(0, 0, 1, 1);

    const toBotty = bottyHeadPos.subtract(camera.globalPosition);
    const dist = toBotty.length();
    const forward = camera.getDirection(Vector3.Forward());
    const inFront = Vector3.Dot(forward, toBotty) > 0;

    const screenPos = Vector3.Project(
      bottyHeadPos,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      viewport.toGlobal(w, h)
    );

    const onScreen = inFront && screenPos.x >= 0 && screenPos.x <= w && screenPos.y >= 0 && screenPos.y <= h;

    if (isDown) {
      // Downed BOTTY always shows the arrow (needs a revive) regardless of distance.
      this.nameplate.style.display = "none";
      this.showEdgeArrow(screenPos.x, screenPos.y, inFront, w, h, "#a83828");
      return;
    }

    if (onScreen && dist <= MAX_LABEL_DIST_M) {
      this.nameplate.style.display = "block";
      this.nameplate.style.left = `${screenPos.x}px`;
      this.nameplate.style.top = `${screenPos.y - 34}px`;
      this.edgeArrow.style.display = "none";
    } else {
      this.nameplate.style.display = "none";
      this.showEdgeArrow(screenPos.x, screenPos.y, inFront, w, h, "#2e6ab8");
    }
  }

  private showEdgeArrow(sx: number, sy: number, inFront: boolean, w: number, h: number, color: string): void {
    const cx = w / 2;
    const cy = h / 2;
    // Behind the camera: the projected point flips through the origin, so
    // mirror it back out — otherwise the arrow points the wrong way.
    let dx = sx - cx;
    let dy = sy - cy;
    if (!inFront) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy) || 1;
    const maxX = cx - EDGE_MARGIN_PX;
    const maxY = cy - EDGE_MARGIN_PX;
    // Clamp the direction vector to the screen's safe-zone rectangle.
    const scale = Math.min(maxX / Math.abs(dx || 1e-6), maxY / Math.abs(dy || 1e-6));
    const ex = cx + dx * Math.min(scale, len);
    const ey = cy + dy * Math.min(scale, len);
    const angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;

    this.edgeArrow.style.display = "block";
    this.edgeArrow.style.left = `${ex - 9}px`;
    this.edgeArrow.style.top = `${ey - 8}px`;
    this.edgeArrow.style.transform = `rotate(${angleDeg}deg)`;
    this.edgeArrow.style.borderBottomColor = color;
    this.edgeArrow.style.filter = `drop-shadow(0 0 3px ${color})`;
  }
}
