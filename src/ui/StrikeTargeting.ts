import type { PlayerController } from "@/player/PlayerController";
import type { BuildingFootprint } from "@/world/Level";
import { CAMP_POSITION } from "@/world/Level";
import type { EnemyIntel } from "@/enemies/EnemySpawner";
import { CARPET_BOMBING, PRECISION_STRIKE } from "@/data/gamedata";
import { carpetBoxCorners, carpetImpactPoints, carpetRunHead, type StrikePlan } from "@/world/strikePlan";
import { injectTheme } from "@/ui/theme";

const WORLD_SPAN = 200; // map covers roughly ±100m, matching the tactical map
/** Seconds the player gets to adjust placement/heading after the first click. */
const LOCK_WINDOW_SEC = 3;
const ROTATE_STEP_RAD = Math.PI / 12; // 15° per key press

export type StrikeMode = "precision" | "carpet";

/**
 * Full-screen call-in targeting overlay for Precision Strike and Carpet
 * Bombing. Nothing is committed while this is open: the player places a target,
 * gets a 3-second window to nudge it (and, for the bombing run, rotate the
 * strip), and only then does the ability spend a charge and start its own
 * 3-second inbound countdown.
 *
 * The preview draws from the SAME `StrikePlan` the callback hands back —
 * including the seed that fixes carpet bombing's scatter — so the impact
 * markers shown here are literally the points that will later detonate, not a
 * cosmetic approximation that can drift from the real run.
 */
export class StrikeTargeting {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private titleEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private hintEl: HTMLDivElement;

  visible = false;
  private mode: StrikeMode = "precision";
  private phase: "place" | "lock" = "place";
  private plan: StrikePlan | null = null;
  /** Where the cursor is hovering, in world coords — drives the un-placed ghost preview. */
  private hover: { x: number; z: number } | null = null;
  private lockRemaining = 0;
  private contactsInZone = 0;
  /**
   * Scatter seed for THIS targeting session, rolled once when the overlay
   * opens. The hover ghost, the committed plan and the eventual bombing run
   * all share it, so the impact pattern the player is reading never silently
   * re-rolls between moving the cursor, clicking, and the bombs landing.
   */
  private seed = 0;
  private heading = 0;

  private onConfirm: ((plan: StrikePlan) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly buildingLayout: BuildingFootprint[]
  ) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-overlay";
    this.root.style.cssText = "background: rgba(4,8,6,0.93); z-index: 45;";

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:8px;";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "mil-title";

    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText =
      "font-size:15px; letter-spacing:3px; min-height:22px; color:#e0a15a; font-family:Consolas,monospace;";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "border:1px solid #3c4a34; border-top:2px solid #c8722c; border-radius:3px; background:#0c130c;" +
      "box-shadow: 0 8px 40px rgba(0,0,0,0.65); max-width:92vw; max-height:70vh; cursor:crosshair;";
    this.ctx = this.canvas.getContext("2d")!;

    this.hintEl = document.createElement("div");
    this.hintEl.style.cssText = "font-size:12px; color:#8a9a84; display:flex; gap:20px; font-family:Consolas,monospace;";

    panel.appendChild(this.titleEl);
    panel.appendChild(this.statusEl);
    panel.appendChild(this.canvas);
    panel.appendChild(this.hintEl);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.canvas.addEventListener("mousemove", this.handleMouseMove);
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    window.addEventListener("keydown", this.handleKey);
  }

  // --- coordinate helpers ---------------------------------------------------
  private get scale(): number {
    return this.canvas.width / WORLD_SPAN;
  }
  private toX(wx: number): number {
    return this.canvas.width / 2 + wx * this.scale;
  }
  private toY(wz: number): number {
    return this.canvas.height / 2 - wz * this.scale;
  }
  private toWorld(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.canvas.getBoundingClientRect();
    const size = this.canvas.width;
    const cx = ((clientX - rect.left) / rect.width) * size;
    const cy = ((clientY - rect.top) / rect.height) * size;
    return { x: (cx - size / 2) / this.scale, z: -(cy - size / 2) / this.scale };
  }

  // --- input ----------------------------------------------------------------
  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.visible) return;
    this.hover = this.toWorld(e.clientX, e.clientY);
  };

  private handleClick = (e: MouseEvent): void => {
    if (!this.visible) return;
    const w = this.toWorld(e.clientX, e.clientY);
    if (!this.plan) {
      // First placement opens the adjust window. The seed carries over from the
      // hover ghost, so the pattern the player just aimed with is the one they
      // committed to.
      this.plan = { x: w.x, z: w.z, heading: this.heading, seed: this.seed };
      this.phase = "lock";
      this.lockRemaining = LOCK_WINDOW_SEC;
    } else {
      // Re-click inside the window relocates the same plan (seed preserved).
      this.plan.x = w.x;
      this.plan.z = w.z;
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.visible || this.mode !== "carpet") return;
    e.preventDefault();
    this.rotate(Math.sign(e.deltaY) * ROTATE_STEP_RAD);
  };

  private handleKey = (e: KeyboardEvent): void => {
    if (!this.visible) return;
    // Targeting owns the keyboard while it's up. Without this, the same
    // keypress would also reach main's global handler — ESC would cancel the
    // call-in AND open the pause menu, M would throw the tactical map over the
    // top, Q would pop the BOTTY wheel. This listener is registered before
    // main's, so stopping immediate propagation is what keeps the overlay modal.
    e.stopImmediatePropagation();
    if (e.code === "Escape") {
      e.preventDefault();
      this.cancel();
      return;
    }
    if (this.plan && (e.code === "Enter" || e.code === "Space")) {
      e.preventDefault();
      this.confirm();
      return;
    }
    if (this.mode === "carpet") {
      if (e.code === "KeyQ" || e.code === "ArrowLeft") {
        e.preventDefault();
        this.rotate(-ROTATE_STEP_RAD);
      } else if (e.code === "KeyE" || e.code === "ArrowRight") {
        e.preventDefault();
        this.rotate(ROTATE_STEP_RAD);
      }
    }
  };

  /** Turn the bombing run. Applied to the live plan when one is placed, and to the ghost otherwise. */
  private rotate(delta: number): void {
    this.heading += delta;
    if (this.plan) this.plan.heading = this.heading;
  }

  // --- lifecycle ------------------------------------------------------------
  /** Open targeting. `onConfirm` fires exactly once, and only for a confirmed plan. */
  begin(mode: StrikeMode, onConfirm: (plan: StrikePlan) => void, onCancel: () => void): void {
    this.mode = mode;
    this.phase = "place";
    this.plan = null;
    this.hover = null;
    this.lockRemaining = 0;
    this.contactsInZone = 0;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.heading = 0;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.titleEl.textContent = mode === "carpet" ? "CARPET BOMBING — TARGETING" : "PRECISION STRIKE — TARGETING";
    this.hintEl.innerHTML =
      mode === "carpet"
        ? `<span>CLICK — place / move</span><span style="color:#e0a15a;">Q / E · SCROLL — rotate run</span><span>ENTER — confirm now</span><span>ESC — abort</span>`
        : `<span>CLICK — place / move</span><span>ENTER — confirm now</span><span>ESC — abort</span>`;
    this.visible = true;
    this.root.style.display = "flex";
    const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.72);
    this.canvas.width = size;
    this.canvas.height = size;
  }

  private close(): void {
    this.visible = false;
    this.root.style.display = "none";
    this.plan = null;
    this.hover = null;
    this.onConfirm = null;
    this.onCancel = null;
  }

  private confirm(): void {
    if (!this.plan || !this.onConfirm) return;
    // Detach the callback before firing so a stray Enter+timer landing on the
    // same frame cannot fire the same call-in twice.
    const cb = this.onConfirm;
    const plan = this.plan;
    this.onConfirm = null;
    this.close();
    cb(plan);
  }

  private cancel(): void {
    const cb = this.onCancel;
    this.onCancel = null;
    this.close();
    cb?.();
  }

  /** Redraw + advance the lock countdown. Called every frame while open. */
  update(dt: number, player: PlayerController, intel: EnemyIntel[]): void {
    if (!this.visible) return;
    if (this.phase === "lock" && this.plan) {
      this.lockRemaining -= dt;
      if (this.lockRemaining <= 0) {
        this.confirm();
        return;
      }
    }
    this.draw(player, intel);
    this.renderStatus();
  }

  private renderStatus(): void {
    if (!this.plan) {
      this.statusEl.textContent = "SELECT TARGET AREA";
      this.statusEl.style.color = "#e0a15a";
      return;
    }
    const secs = Math.max(1, Math.ceil(this.lockRemaining));
    const contacts = `${this.contactsInZone} CONTACT${this.contactsInZone === 1 ? "" : "S"} IN ZONE`;
    this.statusEl.textContent = `TARGET LOCK IN ${secs}   ·   ${contacts}`;
    this.statusEl.style.color = this.contactsInZone > 0 ? "#ff8f5a" : "#e0a15a";
  }

  // --- drawing --------------------------------------------------------------
  private draw(player: PlayerController, intel: EnemyIntel[]): void {
    const ctx = this.ctx;
    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#0c130c";
    ctx.fillRect(0, 0, size, size);

    // Grid.
    ctx.strokeStyle = "rgba(120,150,110,0.12)";
    ctx.lineWidth = 1;
    for (let g = -100; g <= 100; g += 20) {
      ctx.beginPath(); ctx.moveTo(this.toX(g), 0); ctx.lineTo(this.toX(g), size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, this.toY(g)); ctx.lineTo(size, this.toY(g)); ctx.stroke();
    }

    // Buildings.
    ctx.fillStyle = "rgba(150,160,140,0.35)";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    for (const b of this.buildingLayout) {
      const w = b.size * this.scale;
      ctx.fillRect(this.toX(b.x) - w / 2, this.toY(b.z) - w / 2, w, w);
      ctx.strokeRect(this.toX(b.x) - w / 2, this.toY(b.z) - w / 2, w, w);
    }

    // Base.
    const baseR = 12 * this.scale;
    ctx.fillStyle = "rgba(80,150,90,0.22)";
    ctx.strokeStyle = "#9fc78a";
    ctx.lineWidth = 2;
    ctx.strokeRect(this.toX(CAMP_POSITION.x) - baseR, this.toY(CAMP_POSITION.z) - baseR, baseR * 2, baseR * 2);

    // The plan being aimed, or a translucent ghost under the cursor before the
    // first click so the player can see the footprint they're about to commit.
    const preview: StrikePlan | null =
      this.plan ?? (this.hover ? { x: this.hover.x, z: this.hover.z, heading: this.heading, seed: this.seed } : null);
    if (preview) this.drawFootprint(preview, this.plan !== null);

    // Enemy contacts, drawn over the footprint so "the enemy inside it" reads
    // clearly. Anything inside the lethal area is highlighted.
    this.contactsInZone = 0;
    for (const c of intel) {
      const inZone = preview ? this.isInLethalArea(preview, c.x, c.z) : false;
      if (inZone && this.plan) this.contactsInZone++;
      const x = this.toX(c.x), y = this.toY(c.z);
      if (inZone) {
        ctx.fillStyle = "#ff2a18";
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffd08a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      } else if (c.status === "confirmed") {
        ctx.fillStyle = "#ff5540";
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = "#e0a53a"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y);
        ctx.closePath(); ctx.stroke();
      }
    }

    // Player triangle (rotated to facing).
    ctx.save();
    ctx.translate(this.toX(player.position.x), this.toY(player.position.z));
    ctx.rotate(player.yaw);
    ctx.fillStyle = "#8fe08f";
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(-6, 7); ctx.lineTo(6, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** True when a world point falls inside the guaranteed-lethal footprint of `plan`. */
  private isInLethalArea(plan: StrikePlan, wx: number, wz: number): boolean {
    if (this.mode === "precision") {
      return Math.hypot(wx - plan.x, wz - plan.z) <= PRECISION_STRIKE.blastRadiusM;
    }
    // Project into the box's local frame so rotation is handled exactly.
    const dx = wx - plan.x;
    const dz = wz - plan.z;
    const c = Math.cos(plan.heading);
    const s = Math.sin(plan.heading);
    const along = dx * s + dz * c;
    const across = dx * c - dz * s;
    return (
      Math.abs(along) <= CARPET_BOMBING.areaLengthM / 2 && Math.abs(across) <= CARPET_BOMBING.areaWidthM / 2
    );
  }

  private drawFootprint(plan: StrikePlan, committed: boolean): void {
    const ctx = this.ctx;
    const alpha = committed ? 1 : 0.45;
    // Pulse only once committed, so the "locked in, adjust now" state reads
    // differently from the free-moving ghost.
    const pulse = committed ? 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 220)) : 0.5;

    if (this.mode === "precision") {
      const r = PRECISION_STRIKE.blastRadiusM * this.scale;
      const cx = this.toX(plan.x), cy = this.toY(plan.z);
      ctx.fillStyle = `rgba(255,60,40,${0.16 * alpha})`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,90,60,${pulse * alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // Outer splash band.
      ctx.strokeStyle = `rgba(255,150,90,${0.35 * alpha})`;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * PRECISION_STRIKE.outerSplashRadiusMult, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Crosshair through the aim point.
      ctx.strokeStyle = `rgba(255,220,180,${0.8 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - r - 8, cy); ctx.lineTo(cx + r + 8, cy);
      ctx.moveTo(cx, cy - r - 8); ctx.lineTo(cx, cy + r + 8);
      ctx.stroke();
      return;
    }

    // Carpet: rotated box + direction arrow + the exact impact points.
    const corners = carpetBoxCorners(plan);
    ctx.beginPath();
    corners.forEach((p, i) => {
      const x = this.toX(p.x), y = this.toY(p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(255,150,40,${0.13 * alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,170,60,${pulse * alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Run direction: a line up the long axis, with a chevron at the exit.
    const head = carpetRunHead(plan);
    const cx = this.toX(plan.x), cy = this.toY(plan.z);
    const hx = this.toX(head.x), hy = this.toY(head.z);
    ctx.strokeStyle = `rgba(255,210,120,${0.85 * alpha})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(hy - cy, hx - cx);
    ctx.fillStyle = `rgba(255,210,120,${0.95 * alpha})`;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - 12 * Math.cos(ang - 0.4), hy - 12 * Math.sin(ang - 0.4));
    ctx.lineTo(hx - 12 * Math.cos(ang + 0.4), hy - 12 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();

    // Every individual bomb impact, at the radius it actually kills within.
    const hitR = CARPET_BOMBING.directHitRadiusM * this.scale;
    for (const p of carpetImpactPoints(plan)) {
      const px = this.toX(p.x), py = this.toY(p.z);
      ctx.fillStyle = `rgba(255,90,40,${0.22 * alpha})`;
      ctx.beginPath(); ctx.arc(px, py, hitR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,230,190,${0.9 * alpha})`;
      ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
}
