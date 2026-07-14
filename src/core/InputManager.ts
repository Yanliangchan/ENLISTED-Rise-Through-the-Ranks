/**
 * InputManager — tracks keyboard/mouse state and owns Pointer Lock.
 * Other systems poll `isDown()` / read `mouseDeltaX/Y` each frame; call
 * `resetFrame()` once per tick after consuming the mouse delta.
 */
export class InputManager {
  private keys = new Set<string>();
  private keysPressedThisFrame = new Set<string>();

  mouseDeltaX = 0;
  mouseDeltaY = 0;
  wheelDelta = 0;
  isPointerLocked = false;

  leftMouseDown = false;
  rightMouseDown = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("click", this.requestPointerLock);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("wheel", this.onWheel, { passive: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onWheel = (e: WheelEvent) => {
    this.wheelDelta += e.deltaY;
  };

  private requestPointerLock = () => {
    this.canvas.requestPointerLock();
  };

  private onPointerLockChange = () => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (!this.keys.has(code)) this.keysPressedThisFrame.add(code);
    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.leftMouseDown = true;
    if (e.button === 2) this.rightMouseDown = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.leftMouseDown = false;
    if (e.button === 2) this.rightMouseDown = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isPointerLocked) return;
    this.mouseDeltaX += e.movementX;
    this.mouseDeltaY += e.movementY;
  };

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the tick the key transitioned from up to down. */
  wasPressed(code: string): boolean {
    return this.keysPressedThisFrame.has(code);
  }

  /** Call once per render tick after all systems have read this frame's input. */
  resetFrame(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
    this.keysPressedThisFrame.clear();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
  }
}
