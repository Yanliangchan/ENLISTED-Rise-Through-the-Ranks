/**
 * Cinematic animated night view of a Singapore-inspired skyline, rendered to
 * a single full-screen 2D canvas. Layers (far skyline → landmark/mid skyline
 * → clouds → fog) are pre-rendered to offscreen canvases on resize and
 * composited each frame with mouse-parallax offsets, so the per-frame cost is
 * a handful of drawImage calls plus the live effects: flickering windows,
 * blinking aircraft-warning lights, sweeping searchlights, drifting smoke,
 * and the occasional helicopter crossing the skyline (which notifies the
 * ambience audio so you *hear* the flyby too).
 */

interface Building {
  x: number; w: number; h: number;
  windows: Array<{ x: number; y: number }>;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIN_W = 2.4;
const WIN_H = 3.2;

export class SkylineBackground {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  private skyLayer!: HTMLCanvasElement;
  private farLayer!: HTMLCanvasElement;
  private midLayer!: HTMLCanvasElement;
  private cloudSprite!: HTMLCanvasElement;

  private midBuildings: Building[] = [];
  private flickerWindows: Array<{ x: number; y: number; phase: number; speed: number }> = [];
  private warningLights: Array<{ x: number; y: number; phase: number }> = [];
  private searchlights: Array<{ x: number; phase: number; speed: number; spread: number }> = [];
  private clouds: Array<{ x: number; y: number; scale: number; speed: number; depth: number; alpha: number }> = [];
  private fogBands: Array<{ y: number; phase: number; speed: number; alpha: number }> = [];
  private twinkles: Array<{ x: number; y: number; phase: number }> = [];

  private time = 0;
  private reducedMotion: boolean;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "lp-bg-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = Math.min(Math.floor(window.innerWidth * dpr), 2200);
    this.h = Math.floor(this.w * (window.innerHeight / Math.max(1, window.innerWidth)));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.prerender();
    if (this.reducedMotion) this.frame(0, 0, 0); // static single frame
  };

  // =========================================================================
  // Pre-rendered layers
  // =========================================================================

  private prerender(): void {
    const { w, h } = this;
    const rand = mulberry32(90210);

    // --- Sky: near-black night gradient with a faint green NVG cast + stars.
    this.skyLayer = this.makeLayer(w, h, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      // Humid tropical night: olive-black overhead warming into haze at the
      // horizon. The old top stop was blue-black, which pushed the whole page
      // cold and sci-fi.
      grad.addColorStop(0, "#060805");
      grad.addColorStop(0.55, "#0a0e08");
      grad.addColorStop(0.85, "#12160d");
      grad.addColorStop(1, "#181c11");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      this.twinkles = [];
      // Most stars are baked static into this layer (zero per-frame cost); only
      // a sparse subset animates (drawn live each frame in `frame()`).
      for (let i = 0; i < 80; i++) {
        const x = rand() * w;
        const y = rand() * h * 0.55;
        const a = 0.15 + rand() * 0.5;
        ctx.fillStyle = `rgba(202, 208, 182, ${a})`;
        ctx.fillRect(x, y, 1, 1);
        if (i % 14 === 0) this.twinkles.push({ x, y, phase: rand() * Math.PI * 2 });
      }
      // A sliver of moon haze high in the frame.
      const moonX = w * 0.78;
      const moonY = h * 0.14;
      const glow = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, h * 0.16);
      glow.addColorStop(0, "rgba(198, 200, 168, 0.13)");
      glow.addColorStop(1, "rgba(198, 200, 168, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(moonX - h * 0.2, moonY - h * 0.2, h * 0.4, h * 0.4);
    });

    // --- Far skyline: short dark silhouettes, sparse dim windows.
    const farBase = h * 0.86;
    this.farLayer = this.makeLayer(w, h, (ctx) => {
      ctx.fillStyle = "#070a06";
      let x = -20;
      while (x < w + 40) {
        const bw = 24 + rand() * 60;
        const bh = h * (0.06 + rand() * 0.14);
        ctx.fillRect(x, farBase - bh, bw, bh);
        ctx.fillStyle = "rgba(150, 158, 118, 0.14)";
        const cols = Math.floor(bw / 8);
        const rows = Math.floor(bh / 9);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (rand() < 0.14) ctx.fillRect(x + 3 + c * 8, farBase - bh + 4 + r * 9, 1.6, 2.2);
          }
        }
        ctx.fillStyle = "#070a06";
        x += bw + 2 + rand() * 10;
      }
      ctx.fillRect(0, farBase, w, h - farBase);
    });

    // --- Mid skyline: taller towers + a Marina-Bay-Sands-style landmark.
    const midBase = h * 0.95;
    this.midBuildings = [];
    this.flickerWindows = [];
    this.warningLights = [];
    const randMid = mulberry32(4711);
    this.midLayer = this.makeLayer(w, h, (ctx) => {
      let x = -30;
      const landmarkX = w * 0.6;
      while (x < w + 60) {
        // Leave a gap for the landmark.
        if (x > landmarkX - 40 && x < landmarkX + w * 0.13) { x = landmarkX + w * 0.13; continue; }
        const bw = 34 + randMid() * 74;
        const bh = h * (0.16 + randMid() * 0.3);
        const b: Building = { x, w: bw, h: bh, windows: [] };
        ctx.fillStyle = randMid() < 0.5 ? "#090c07" : "#0b0f08";
        ctx.fillRect(x, midBase - bh, bw, bh);
        // Rooftop detail: lift motor room / antenna.
        ctx.fillRect(x + bw * 0.3, midBase - bh - 6, bw * 0.25, 6);
        if (randMid() < 0.5) {
          ctx.fillRect(x + bw * 0.5, midBase - bh - 18, 1.5, 18);
          this.warningLights.push({ x: x + bw * 0.5 + 0.75, y: midBase - bh - 19, phase: randMid() * Math.PI * 2 });
        }
        const cols = Math.floor((bw - 6) / 7);
        const rows = Math.floor((bh - 8) / 10);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (randMid() < 0.32) {
              const wx = x + 4 + c * 7;
              const wy = midBase - bh + 5 + r * 10;
              b.windows.push({ x: wx, y: wy });
              const warm = randMid() < 0.7;
              ctx.fillStyle = warm ? "rgba(206, 178, 110, 0.5)" : "rgba(176, 186, 150, 0.36)";
              ctx.fillRect(wx, wy, WIN_W, WIN_H);
              if (randMid() < 0.09) {
                this.flickerWindows.push({ x: wx, y: wy, phase: randMid() * Math.PI * 2, speed: 2 + randMid() * 7 });
              }
            }
          }
        }
        this.midBuildings.push(b);
        x += bw + 3 + randMid() * 14;
      }

      // Landmark: three towers with a sky-deck spanning the top.
      const lw = w * 0.115;
      const towerW = lw * 0.24;
      const lh = h * 0.34;
      ctx.fillStyle = "#0a120c";
      for (let t = 0; t < 3; t++) {
        const tx = landmarkX + t * (lw * 0.38);
        ctx.fillRect(tx, midBase - lh, towerW, lh);
        ctx.fillStyle = "rgba(170, 180, 145, 0.3)";
        for (let r = 0; r < Math.floor(lh / 9); r++) {
          if (randMid() < 0.5) ctx.fillRect(tx + towerW * 0.2, midBase - lh + 4 + r * 9, towerW * 0.6, 1.6);
        }
        ctx.fillStyle = "#0a120c";
      }
      // Sky deck — longer than the tower row, prow overhanging.
      ctx.fillStyle = "#0d1710";
      ctx.beginPath();
      ctx.moveTo(landmarkX - lw * 0.16, midBase - lh - 4);
      ctx.lineTo(landmarkX + lw * 1.06, midBase - lh - 4);
      ctx.lineTo(landmarkX + lw * 0.98, midBase - lh - 14);
      ctx.lineTo(landmarkX - lw * 0.06, midBase - lh - 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(186, 194, 160, 0.35)";
      ctx.fillRect(landmarkX - lw * 0.1, midBase - lh - 8, lw * 1.1, 1.2);
      this.warningLights.push(
        { x: landmarkX + lw * 0.12, y: midBase - lh - 15, phase: 0.4 },
        { x: landmarkX + lw * 0.94, y: midBase - lh - 15, phase: 2.5 }
      );

      // Waterfront strip with smeared light reflections — reads as the bay.
      ctx.fillStyle = "#050a07";
      ctx.fillRect(0, midBase, w, h - midBase);
      for (let i = 0; i < 60; i++) {
        const rx = randMid() * w;
        const ry = midBase + randMid() * (h - midBase);
        const rl = 6 + randMid() * 26;
        const warm = randMid() < 0.6;
        ctx.fillStyle = warm ? "rgba(200, 178, 112, 0.07)" : "rgba(168, 178, 140, 0.05)";
        ctx.fillRect(rx, ry, rl, 1.2);
      }
    });

    // --- Soft cloud sprite reused for clouds and fog bands.
    this.cloudSprite = this.makeLayer(280, 120, (ctx) => {
      for (let i = 0; i < 9; i++) {
        const cx = 40 + rand() * 200;
        const cy = 40 + rand() * 44;
        const cr = 26 + rand() * 34;
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, cr);
        g.addColorStop(0, "rgba(128, 134, 108, 0.15)");
        g.addColorStop(1, "rgba(128, 134, 108, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
      }
    });

    this.clouds = [];
    for (let i = 0; i < 8; i++) {
      const depth = i < 4 ? 0.4 : 0.75;
      this.clouds.push({
        x: rand() * w, y: h * (0.06 + rand() * 0.3), scale: (0.9 + rand() * 1.8) * (w / 1400),
        speed: (2.5 + rand() * 5) * depth, depth, alpha: 0.35 + rand() * 0.45,
      });
    }
    this.fogBands = [
      { y: h * 0.78, phase: 0, speed: 5, alpha: 0.4 },
      { y: h * 0.85, phase: 2.4, speed: -3.4, alpha: 0.5 },
      { y: h * 0.92, phase: 4.1, speed: 4.2, alpha: 0.6 },
    ];
    // One slow, dim beam instead of two sweeping ones — enough to suggest an
    // exercise going on over the horizon without the searchlight-show look.
    this.searchlights = [{ x: w * 0.78, phase: 3.4, speed: 0.05, spread: 0.035 }];
  }

  private makeLayer(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    return c;
  }

  // =========================================================================
  // Per-frame composite
  // =========================================================================

  /** Advance and draw one frame. mx/my are smoothed mouse parallax in [-1, 1]. */
  frame(dt: number, mx: number, my: number): void {
    const { ctx, w, h } = this;
    this.time += dt;
    const t = this.time;

    ctx.drawImage(this.skyLayer, mx * -5, my * -3);

    // Twinkling stars over the static field.
    for (const s of this.twinkles) {
      const a = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.7 + s.phase));
      ctx.fillStyle = `rgba(206, 212, 186, ${a})`;
      ctx.fillRect(s.x + mx * -5, s.y + my * -3, 1.4, 1.4);
    }

    // Searchlight beams sweep the sky from behind the far skyline.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const sl of this.searchlights) {
      const angle = -Math.PI / 2 + Math.sin(t * sl.speed * Math.PI * 2 + sl.phase) * 0.55;
      const ox = sl.x + mx * -8;
      const oy = h * 0.86;
      const len = h * 0.95;
      const half = sl.spread;
      const tipX = ox + Math.cos(angle) * len;
      const tipY = oy + Math.sin(angle) * len;
      const grad = ctx.createLinearGradient(ox, oy, tipX, tipY);
      grad.addColorStop(0, "rgba(196, 190, 150, 0.055)");
      grad.addColorStop(1, "rgba(196, 190, 150, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(angle - half) * len, oy + Math.sin(angle - half) * len);
      ctx.lineTo(ox + Math.cos(angle + half) * len, oy + Math.sin(angle + half) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Deep clouds behind the skyline.
    for (const c of this.clouds) {
      if (c.depth > 0.5) continue;
      this.drawCloud(c, t, mx);
    }

    ctx.drawImage(this.farLayer, mx * -12, my * -6);
    ctx.drawImage(this.midLayer, mx * -24, my * -12);

    // Flickering city windows (drawn over the static lit set).
    const fx = mx * -24;
    const fy = my * -12;
    for (const win of this.flickerWindows) {
      const a = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(t * win.speed + win.phase));
      ctx.fillStyle = `rgba(215, 195, 130, ${a})`;
      ctx.fillRect(win.x + fx, win.y + fy, WIN_W, WIN_H);
    }

    // Aircraft warning lights — slow red blink on the tallest structures.
    for (const wl of this.warningLights) {
      const blink = 0.5 + 0.5 * Math.sin(t * 2.4 + wl.phase);
      if (blink < 0.45) continue;
      const a = (blink - 0.45) * 1.6;
      ctx.fillStyle = `rgba(255, 60, 50, ${a})`;
      ctx.beginPath();
      ctx.arc(wl.x + fx, wl.y + fy, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 60, 50, ${a * 0.25})`;
      ctx.beginPath();
      ctx.arc(wl.x + fx, wl.y + fy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Near clouds and fog drift over everything.
    for (const c of this.clouds) {
      if (c.depth <= 0.5) continue;
      this.drawCloud(c, t, mx);
    }
    for (const f of this.fogBands) {
      const drift = Math.sin(t * 0.05 + f.phase) * 40 + t * f.speed;
      const x = ((drift % (w + 600)) + w + 600) % (w + 600) - 300;
      ctx.globalAlpha = f.alpha;
      ctx.drawImage(this.cloudSprite, x + mx * -30, f.y + my * -10, w * 0.7, h * 0.16);
      ctx.drawImage(this.cloudSprite, x - w * 0.65 + mx * -30, f.y + 8 + my * -10, w * 0.75, h * 0.14);
      ctx.globalAlpha = 1;
    }
  }

  private drawCloud(c: { x: number; y: number; scale: number; speed: number; depth: number; alpha: number }, _t: number, mx: number): void {
    const { ctx, w } = this;
    const cw = 280 * c.scale;
    const ch = 120 * c.scale;
    ctx.globalAlpha = c.alpha;
    ctx.drawImage(this.cloudSprite, c.x + mx * -34 * c.depth, c.y, cw, ch);
    ctx.globalAlpha = 1;
    if (!this.reducedMotion) {
      c.x += c.speed * 0.016;
      if (c.x > w + 100) c.x = -cw - 60;
    }
  }


  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
