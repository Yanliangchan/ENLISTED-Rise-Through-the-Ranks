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

interface Heli {
  x: number; y: number; dir: number; speed: number;
  strobe: number; rotor: number; searchlight: boolean;
}

interface SmokeParticle { x: number; y: number; r: number; alpha: number; vx: number; vy: number; }

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
  private smoke: SmokeParticle[] = [];
  private smokeEmitters: Array<{ x: number; y: number; clock: number }> = [];
  private twinkles: Array<{ x: number; y: number; phase: number }> = [];

  private heli: Heli | null = null;
  private nextHeliIn = 6;
  private time = 0;
  private reducedMotion: boolean;

  /** Fired when a helicopter starts crossing — lets the ambience audio play the rotor flyby. */
  onHelicopter?: (durationSec: number, fromPan: number, toPan: number) => void;

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
      grad.addColorStop(0, "#02040a");
      grad.addColorStop(0.55, "#050b0d");
      grad.addColorStop(0.85, "#0a1410");
      grad.addColorStop(1, "#0c1712");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      this.twinkles = [];
      for (let i = 0; i < 130; i++) {
        const x = rand() * w;
        const y = rand() * h * 0.55;
        const a = 0.15 + rand() * 0.5;
        ctx.fillStyle = `rgba(200, 225, 205, ${a})`;
        ctx.fillRect(x, y, 1, 1);
        if (i % 9 === 0) this.twinkles.push({ x, y, phase: rand() * Math.PI * 2 });
      }
      // A sliver of moon haze high in the frame.
      const moonX = w * 0.78;
      const moonY = h * 0.14;
      const glow = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, h * 0.16);
      glow.addColorStop(0, "rgba(190, 215, 190, 0.16)");
      glow.addColorStop(1, "rgba(190, 215, 190, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(moonX - h * 0.2, moonY - h * 0.2, h * 0.4, h * 0.4);
    });

    // --- Far skyline: short dark silhouettes, sparse dim windows.
    const farBase = h * 0.86;
    this.farLayer = this.makeLayer(w, h, (ctx) => {
      ctx.fillStyle = "#04080a";
      let x = -20;
      while (x < w + 40) {
        const bw = 24 + rand() * 60;
        const bh = h * (0.06 + rand() * 0.14);
        ctx.fillRect(x, farBase - bh, bw, bh);
        ctx.fillStyle = "rgba(150, 165, 120, 0.16)";
        const cols = Math.floor(bw / 8);
        const rows = Math.floor(bh / 9);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            if (rand() < 0.14) ctx.fillRect(x + 3 + c * 8, farBase - bh + 4 + r * 9, 1.6, 2.2);
          }
        }
        ctx.fillStyle = "#04080a";
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
        ctx.fillStyle = randMid() < 0.5 ? "#060b09" : "#081009";
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
              ctx.fillStyle = warm ? "rgba(205, 185, 120, 0.5)" : "rgba(150, 200, 170, 0.42)";
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
        ctx.fillStyle = "rgba(160, 200, 175, 0.35)";
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
      ctx.fillStyle = "rgba(190, 220, 190, 0.4)";
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
        ctx.fillStyle = warm ? "rgba(200, 180, 115, 0.07)" : "rgba(140, 195, 165, 0.06)";
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
        g.addColorStop(0, "rgba(120, 140, 125, 0.16)");
        g.addColorStop(1, "rgba(120, 140, 125, 0)");
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
    this.searchlights = [
      { x: w * 0.2, phase: 0.6, speed: 0.11, spread: 0.05 },
      { x: w * 0.83, phase: 3.4, speed: 0.08, spread: 0.04 },
    ];
    this.smokeEmitters = [
      { x: w * 0.31, y: h * 0.83, clock: 0 },
      { x: w * 0.9, y: h * 0.86, clock: 0.4 },
    ];
    this.smoke = [];
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
      ctx.fillStyle = `rgba(210, 235, 215, ${a})`;
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
      grad.addColorStop(0, "rgba(180, 220, 190, 0.13)");
      grad.addColorStop(1, "rgba(180, 220, 190, 0)");
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

    this.updateSmoke(dt, t);
    this.updateHeli(dt, t, mx, my);

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

  private updateSmoke(dt: number, _t: number): void {
    const { ctx } = this;
    if (!this.reducedMotion) {
      for (const em of this.smokeEmitters) {
        em.clock -= dt;
        if (em.clock <= 0 && this.smoke.length < 70) {
          em.clock = 0.28 + Math.random() * 0.2;
          this.smoke.push({
            x: em.x + (Math.random() - 0.5) * 8, y: em.y,
            r: 4 + Math.random() * 5, alpha: 0.12 + Math.random() * 0.06,
            vx: 3 + Math.random() * 5, vy: -(6 + Math.random() * 7),
          });
        }
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += dt * 7;
      p.alpha -= dt * 0.018;
      if (p.alpha <= 0.005) { this.smoke.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(30, 36, 30, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateHeli(dt: number, t: number, mx: number, my: number): void {
    const { ctx, w, h } = this;
    if (!this.heli) {
      if (this.reducedMotion) return;
      this.nextHeliIn -= dt;
      if (this.nextHeliIn <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const speed = w / (13 + Math.random() * 6);
        this.heli = {
          x: dir === 1 ? -60 : w + 60, y: h * (0.16 + Math.random() * 0.2),
          dir, speed, strobe: 0, rotor: 0, searchlight: Math.random() < 0.55,
        };
        const durSec = (w + 120) / speed;
        this.onHelicopter?.(durSec, -dir, dir);
      }
      return;
    }

    const heli = this.heli;
    heli.x += heli.dir * heli.speed * dt;
    heli.y += Math.sin(t * 0.9) * dt * 4;
    heli.rotor += dt * 40;
    if ((heli.dir === 1 && heli.x > w + 80) || (heli.dir === -1 && heli.x < -80)) {
      this.heli = null;
      this.nextHeliIn = 16 + Math.random() * 18;
      return;
    }

    const hx = heli.x + mx * -18;
    const hy = heli.y + my * -8;
    const s = w / 1400; // scale with viewport

    // Searchlight cone sweeping the ground below.
    if (heli.searchlight) {
      const swing = Math.sin(t * 0.7) * 30 * s;
      const groundY = h * 0.88;
      const grad = ctx.createLinearGradient(hx, hy, hx + swing, groundY);
      grad.addColorStop(0, "rgba(210, 235, 200, 0.16)");
      grad.addColorStop(1, "rgba(210, 235, 200, 0.01)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(hx, hy + 4 * s);
      ctx.lineTo(hx + swing - 26 * s, groundY);
      ctx.lineTo(hx + swing + 26 * s, groundY);
      ctx.closePath();
      ctx.fill();
    }

    // Silhouette: fuselage + tail boom + spinning rotor disc.
    ctx.fillStyle = "#070c09";
    ctx.beginPath();
    ctx.ellipse(hx, hy, 13 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(hx - heli.dir * 26 * s, hy - 1.6 * s, heli.dir * 16 * s, 2.6 * s);
    ctx.fillRect(hx - heli.dir * 27 * s, hy - 6 * s, heli.dir * 2.4 * s, 6 * s);
    const rotorLen = 17 * s * Math.abs(Math.sin(heli.rotor));
    ctx.strokeStyle = "rgba(10, 16, 12, 0.85)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx - rotorLen, hy - 6.5 * s);
    ctx.lineTo(hx + rotorLen, hy - 6.5 * s);
    ctx.stroke();

    // Anti-collision strobe (red) + nav light (green, side-dependent).
    heli.strobe += dt;
    if (heli.strobe % 1.1 < 0.08) {
      ctx.fillStyle = "rgba(255, 70, 60, 0.95)";
      ctx.beginPath();
      ctx.arc(hx, hy - 8 * s, 2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(90, 230, 110, 0.8)";
    ctx.beginPath();
    ctx.arc(hx + heli.dir * 11 * s, hy, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
