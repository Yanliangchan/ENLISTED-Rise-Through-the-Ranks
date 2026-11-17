/** Keyboard + mouse with pointer lock. Polled once per frame by the game loop. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** When false, game input is ignored (menus own the keyboard). */
  enabled = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === "Tab" || e.code === "Space" || e.code === "KeyZ" || e.code.startsWith("Arrow") || (e.ctrlKey && e.code !== "KeyR")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // Browsers occasionally report one enormous delta (a warp when the lock engages or the
      // window regains focus); letting it through spins the view.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.pressed.add(code);
      this.down.add(code);
    });
    document.addEventListener("mouseup", (e) => this.down.delete(`Mouse${e.button}`));
    document.addEventListener("wheel", (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.down.clear();
      this.onLockChange?.(this.locked);
    });
  }

  onLockChange?: (locked: boolean) => void;

  lock(): void {
    if (this.locked) return;
    // Raw mouse input (no OS pointer acceleration) where the browser offers it: aim tracks the hand 1:1.
    type Lock = (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    const req = this.canvas.requestPointerLock.bind(this.canvas) as Lock;
    try {
      const p = req({ unadjustedMovement: true });
      if (p && typeof p.catch === "function") p.catch(() => void (req() as Promise<void> | undefined)?.catch?.(() => undefined));
    } catch {
      void (req() as Promise<void> | undefined)?.catch?.(() => undefined);
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  held(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  hit(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  /** Clear per-frame state. Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Test hook: synthesise a key state without a real device. */
  set(code: string, on: boolean): void {
    if (on) {
      this.down.add(code);
      this.pressed.add(code);
    } else this.down.delete(code);
  }
}
