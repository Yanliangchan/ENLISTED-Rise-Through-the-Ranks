import type { PlayerController } from "@/player/PlayerController";
import type { BuildingFootprint } from "@/world/Level";
import { CAMP_POSITION } from "@/world/Level";
import type { EnemyIntel } from "@/enemies/EnemySpawner";
import { CARPET_BOMBING, PRECISION_STRIKE } from "@/data/gamedata";
import { carpetBoxCorners, carpetImpactPoints, carpetRunHead, type StrikePlan } from "@/world/strikePlan";
import { injectTheme } from "@/ui/theme";
import { SAF, safCamoBacking } from "@/ui/saf";

const WORLD_SPAN = 200; // map covers roughly ±100m, matching the tactical map
/** Metres per lettered/numbered map square — the grid the player calls the target by. */
const GRID_SQUARE_M = 20;
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
  private slipEl: HTMLDivElement;

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
    this.root.style.cssText = "background: rgba(6,9,5,0.92); z-index: 45;";

    const panel = document.createElement("div");

    this.titleEl = document.createElement("div");
    this.titleEl.className = "mil-title";

    this.statusEl = document.createElement("div");
    this.statusEl.style.cssText =
      `font-size:12px; letter-spacing:2px; min-height:18px; color:${SAF.textDim}; font-family:${SAF.fontMono};`;

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      `border:1px solid ${SAF.line}; background:${SAF.inset};` +
      "max-width:58vw; max-height:74vh; cursor:crosshair; display:block;";
    this.ctx = this.canvas.getContext("2d")!;

    // --- Fire-mission slip: the readout a player would actually call in from.
    // Grid reference, bearing and time-to-impact, printed on the board rather
    // than floating as a holographic overlay.
    this.slipEl = document.createElement("div");
    this.slipEl.className = "mil-inset";
    this.slipEl.style.cssText =
      `width:230px; padding:14px 16px; font-family:${SAF.fontMono}; align-self:stretch;`;

    this.hintEl = document.createElement("div");
    this.hintEl.style.cssText =
      `font-size:10px; letter-spacing:1.5px; color:${SAF.textFaint}; display:flex; gap:18px;` +
      `font-family:${SAF.fontUi}; text-transform:uppercase; margin-top:10px;`;

    const board = document.createElement("div");
    board.style.cssText = "display:flex; gap:16px; align-items:stretch;";
    const mapCol = document.createElement("div");
    mapCol.style.cssText = "display:flex; flex-direction:column;";
    mapCol.appendChild(this.canvas);
    mapCol.appendChild(this.hintEl);
    board.appendChild(mapCol);
    board.appendChild(this.slipEl);

    const header = document.createElement("div");
    header.style.cssText = "display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px;";
    const headLeft = document.createElement("div");
    headLeft.appendChild(this.titleEl);
    headLeft.appendChild(this.statusEl);
    const headRight = document.createElement("div");
    headRight.className = "mil-label";
    headRight.textContent = "FIRE MISSION — SECTOR SIERRA";
    header.appendChild(headLeft);
    header.appendChild(headRight);

    panel.className = "mil-panel";
    panel.style.cssText = "display:block; max-width:94vw;";
    panel.appendChild(header);
    panel.appendChild(board);
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
    this.titleEl.textContent = mode === "carpet" ? "AIR SUPPORT — CARPET BOMB" : "AIR SUPPORT — PRECISION";
    this.hintEl.innerHTML =
      mode === "carpet"
        ? `<span>CLICK · MARK GRID</span><span style="color:${SAF.sage};">Q / E · SCROLL · RUN HEADING</span><span>ENTER · SEND</span><span>ESC · ABORT</span>`
        : `<span>CLICK · MARK GRID</span><span>ENTER · SEND</span><span>ESC · ABORT</span>`;
    this.visible = true;
    this.root.style.display = "flex";
    const size = Math.min(window.innerWidth * 0.55, window.innerHeight * 0.68);
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
    this.renderSlip(player);
  }

  /**
   * Fire-mission slip. Reads like a call for fire written on a board: what is
   * being fired, at which grid square, on what bearing, and how long until it
   * lands. No holograms, no glow — just the numbers a section commander needs.
   */
  private renderSlip(player: PlayerController): void {
    const mode = this.mode === "carpet" ? "CARPET BOMB" : "PRECISION";
    const rows: Array<[string, string, string?]> = [];

    if (!this.plan) {
      this.statusEl.textContent = "SELECT TARGET AREA ON GRID";
      rows.push(["MISSION", mode]);
      rows.push(["TARGET", "— — —"]);
      rows.push(["BEARING", "— — —"]);
      rows.push(["RANGE", "— — —"]);
      rows.push(["STATUS", "AWAITING GRID", SAF.textDim]);
    } else {
      const p = this.plan;
      const secs = Math.max(1, Math.ceil(this.lockRemaining));
      this.statusEl.textContent = "ADJUST — LOCK ON TIMEOUT";
      rows.push(["MISSION", mode]);
      rows.push(["GRID", this.gridRef(p.x, p.z), SAF.sage]);
      rows.push(["BEARING", `${String(this.bearingFrom(player.position.x, player.position.z, p.x, p.z)).padStart(3, "0")}°`]);
      rows.push(["RANGE", `${this.rangeFrom(player.position.x, player.position.z, p.x, p.z)} M`]);
      if (this.mode === "carpet") {
        rows.push(["RUN HDG", `${String(Math.round(((p.heading * 180) / Math.PI + 360) % 360)).padStart(3, "0")}°`]);
      }
      rows.push([
        "IN ZONE",
        `${this.contactsInZone} CONTACT${this.contactsInZone === 1 ? "" : "S"}`,
        this.contactsInZone > 0 ? SAF.amber : SAF.textDim,
      ]);
      rows.push(["LOCK IN", String(secs).padStart(2, "0"), SAF.amber]);
    }

    this.slipEl.innerHTML =
      `<div class="mil-label" style="margin-bottom:10px; color:${SAF.textDim};">FIRE MISSION</div>` +
      rows
        .map(
          ([k, v, colour]) =>
            `<div style="display:flex; justify-content:space-between; gap:10px; padding:5px 0;` +
            ` border-bottom:1px solid #1e2718; font-size:12px;">` +
            `<span style="color:${SAF.textFaint}; letter-spacing:1.5px;">${k}</span>` +
            `<span style="color:${colour ?? SAF.text};">${v}</span></div>`
        )
        .join("") +
      (this.plan
        ? `<div style="margin-top:14px; text-align:center;">` +
          `<div class="mil-label" style="color:${SAF.textFaint};">CONFIRM</div>` +
          `<div style="font-size:30px; line-height:1.2; color:${SAF.amber}; letter-spacing:2px;">` +
          `${String(Math.max(1, Math.ceil(this.lockRemaining))).padStart(2, "0")}</div>` +
          `<div class="mil-label" style="color:${SAF.textFaint};">ENTER TO SEND</div></div>`
        : "");
  }

  // --- drawing --------------------------------------------------------------
  private draw(player: PlayerController, intel: EnemyIntel[]): void {
    const ctx = this.ctx;
    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#121a10";
    ctx.fillRect(0, 0, size, size);

    // Lettered/numbered map squares — the reference the fire mission is called
    // by, drawn like a printed chart rather than a glowing scanner grid.
    const squarePx = GRID_SQUARE_M * this.scale;
    ctx.strokeStyle = "rgba(120, 140, 100, 0.14)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= WORLD_SPAN; g += GRID_SQUARE_M) {
      const p0 = g * this.scale;
      ctx.beginPath(); ctx.moveTo(p0, 0); ctx.lineTo(p0, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p0); ctx.lineTo(size, p0); ctx.stroke();
    }
    ctx.fillStyle = "rgba(150, 168, 130, 0.4)";
    ctx.font = `9px ${SAF.fontMono}`;
    const squares = Math.floor(WORLD_SPAN / GRID_SQUARE_M);
    for (let i = 0; i < squares; i++) {
      ctx.textAlign = "center";
      ctx.fillText(String.fromCharCode(65 + i), i * squarePx + squarePx / 2, 11);
      ctx.textAlign = "left";
      ctx.fillText(String(i + 1), 3, i * squarePx + squarePx / 2 + 3);
    }

    // Buildings: solid blocks, the way structures print on a military map.
    ctx.fillStyle = "rgba(126, 136, 108, 0.5)";
    ctx.strokeStyle = "rgba(10, 14, 8, 0.7)";
    for (const b of this.buildingLayout) {
      const w = b.size * this.scale;
      ctx.fillRect(this.toX(b.x) - w / 2, this.toY(b.z) - w / 2, w, w);
      ctx.strokeRect(this.toX(b.x) - w / 2, this.toY(b.z) - w / 2, w, w);
    }

    // Friendly base — hatched box with a stencilled label.
    const baseR = 12 * this.scale;
    ctx.strokeStyle = SAF.sage;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.toX(CAMP_POSITION.x) - baseR, this.toY(CAMP_POSITION.z) - baseR, baseR * 2, baseR * 2);
    ctx.fillStyle = SAF.sage;
    ctx.font = `8px ${SAF.fontUi}`;
    ctx.textAlign = "center";
    ctx.fillText("BASE", this.toX(CAMP_POSITION.x), this.toY(CAMP_POSITION.z) + baseR + 10);

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
      // Hostile contacts print as the standard filled square; suspected ones
      // as an open square. Anything inside the footprint is boxed for emphasis.
      if (c.status === "confirmed" || inZone) {
        ctx.fillStyle = inZone ? "#c4432c" : "#8f4a34";
        ctx.fillRect(x - 4, y - 4, 8, 8);
      } else {
        ctx.strokeStyle = "#8a7a4a"; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 4, y - 4, 8, 8);
      }
      if (inZone) {
        ctx.strokeStyle = SAF.amber; ctx.lineWidth = 1;
        ctx.strokeRect(x - 8, y - 8, 16, 16);
      }
    }

    // Player triangle (rotated to facing).
    ctx.save();
    ctx.translate(this.toX(player.position.x), this.toY(player.position.z));
    ctx.rotate(player.yaw);
    ctx.fillStyle = SAF.sage;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(-5, 6); ctx.lineTo(5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /**
   * Map-square reference for a world point, e.g. "F7". Columns are lettered
   * west→east, rows numbered north→south, exactly how a target would be called
   * off a printed grid — this is the game's substitute for a sci-fi coordinate
   * readout.
   */
  private gridRef(wx: number, wz: number): string {
    const half = WORLD_SPAN / 2;
    const col = Math.floor((wx + half) / GRID_SQUARE_M);
    const row = Math.floor((half - wz) / GRID_SQUARE_M);
    const cols = Math.floor(WORLD_SPAN / GRID_SQUARE_M);
    const c = Math.min(cols - 1, Math.max(0, col));
    const r = Math.min(cols - 1, Math.max(0, row));
    return `${String.fromCharCode(65 + c)}${r + 1}`;
  }

  /** Compass bearing (degrees, 0 = north/+Z) from the player to the target. */
  private bearingFrom(px: number, pz: number, tx: number, tz: number): number {
    const deg = (Math.atan2(tx - px, tz - pz) * 180) / Math.PI;
    return Math.round((deg + 360) % 360);
  }

  /** Ground distance in metres, for the fire-mission slip. */
  private rangeFrom(px: number, pz: number, tx: number, tz: number): number {
    return Math.round(Math.hypot(tx - px, tz - pz));
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
    const alpha = committed ? 1 : 0.4;
    // Committed targets get a solid outline, uncommitted ghosts a dashed one.
    // A hard state change rather than a pulsing glow — this is a chinagraph
    // mark on a map board, not an animated hologram.
    const stroke = committed ? "rgba(200, 120, 40, 0.95)" : "rgba(170, 160, 120, 0.7)";

    if (this.mode === "precision") {
      const r = PRECISION_STRIKE.blastRadiusM * this.scale;
      const cx = this.toX(plan.x), cy = this.toY(plan.z);
      ctx.fillStyle = `rgba(190, 90, 40, ${0.14 * alpha})`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      if (!committed) ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // Outer splash band.
      ctx.strokeStyle = `rgba(170, 140, 90, ${0.4 * alpha})`;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * PRECISION_STRIKE.outerSplashRadiusMult, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Registration cross through the aim point.
      ctx.strokeStyle = `rgba(220, 210, 180, ${0.85 * alpha})`;
      ctx.lineWidth = 1;
      const tick = r + 10;
      ctx.beginPath();
      ctx.moveTo(cx - tick, cy); ctx.lineTo(cx - r * 0.35, cy);
      ctx.moveTo(cx + r * 0.35, cy); ctx.lineTo(cx + tick, cy);
      ctx.moveTo(cx, cy - tick); ctx.lineTo(cx, cy - r * 0.35);
      ctx.moveTo(cx, cy + r * 0.35); ctx.lineTo(cx, cy + tick);
      ctx.stroke();
      if (committed) {
        ctx.fillStyle = "rgba(220, 210, 180, 0.9)";
        ctx.font = `9px ${SAF.fontMono}`;
        ctx.textAlign = "center";
        ctx.fillText(this.gridRef(plan.x, plan.z), cx, cy - tick - 5);
      }
      return;
    }

    // Carpet: rotated box + run direction + the exact impact points.
    const corners = carpetBoxCorners(plan);
    ctx.beginPath();
    corners.forEach((p, i) => {
      const x = this.toX(p.x), y = this.toY(p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(190, 120, 40, ${0.12 * alpha})`;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    if (!committed) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Run-in axis with a plain arrowhead at the exit.
    const head = carpetRunHead(plan);
    const cx = this.toX(plan.x), cy = this.toY(plan.z);
    const hx = this.toX(head.x), hy = this.toY(head.z);
    ctx.strokeStyle = `rgba(210, 200, 165, ${0.8 * alpha})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(hy - cy, hx - cx);
    ctx.fillStyle = `rgba(210, 200, 165, ${0.9 * alpha})`;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - 11 * Math.cos(ang - 0.42), hy - 11 * Math.sin(ang - 0.42));
    ctx.lineTo(hx - 11 * Math.cos(ang + 0.42), hy - 11 * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
    if (committed) {
      ctx.fillStyle = "rgba(220, 210, 180, 0.9)";
      ctx.font = `9px ${SAF.fontMono}`;
      ctx.textAlign = "center";
      ctx.fillText(`${this.gridRef(plan.x, plan.z)}  ${String(Math.round(((plan.heading * 180) / Math.PI + 360) % 360)).padStart(3, "0")}°`, cx, cy - 8);
    }

    // Every individual bomb impact, at the radius it actually kills within.
    const hitR = CARPET_BOMBING.directHitRadiusM * this.scale;
    for (const p of carpetImpactPoints(plan)) {
      const px = this.toX(p.x), py = this.toY(p.z);
      ctx.fillStyle = `rgba(180, 80, 35, ${0.2 * alpha})`;
      ctx.beginPath(); ctx.arc(px, py, hitR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(200, 130, 60, ${0.35 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, hitR, 0, Math.PI * 2); ctx.stroke();
      // Plain cross at each aim point.
      ctx.strokeStyle = `rgba(225, 215, 185, ${0.75 * alpha})`;
      ctx.beginPath();
      ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py);
      ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3);
      ctx.stroke();
    }
  }
}
