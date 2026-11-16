import * as THREE from "three";
import { canvasTex } from "./textures";
import { fbm, rng } from "./noise";

/**
 * Flat detail that sits on top of surfaces: road paint, manholes, stains,
 * puddles, scorch marks, and every sign in the estate. These are what stop a
 * tiled surface from looking tiled — unique, placed marks over a repeating base.
 */

/** UV rectangle inside an atlas: [u0, v0, u1, v1] with v up. */
export type UVRect = [number, number, number, number];

/** Worn road paint: opaque white with chipped-out alpha, tinted per marking. */
export function paintLineTex(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (c, w, h) => {
      const img = c.createImageData(w, h);
      const r = rng(5);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const n = fbm(x / w, y / h, 10, 4, 3) * 0.7 + fbm(x / w, y / h, 48, 2, 9) * 0.3;
          const i = (y * w + x) * 4;
          const v = 205 + r() * 40;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v - 6;
          img.data[i + 3] = n > 0.36 ? 255 : n > 0.31 ? 120 : 0;
        }
      }
      c.putImageData(img, 0, 0);
    },
    { repeat: true }
  );
}

const CELL = 256;
const GRID = 4;

/** Ground decal atlas cells. */
export const DECAL = {
  manhole: 0,
  grate: 1,
  oil: 2,
  scorch: 3,
  puddle: 4,
  leaves: 5,
  arrow: 6,
  arrowTurn: 7,
  crack: 8,
  patch: 9,
  rubble: 10,
  tyres: 11,
  blood: 12,
  holes: 13,
  slow: 14,
  drainCover: 15,
} as const;

export function decalUV(cell: number): UVRect {
  const cx = cell % GRID;
  const cy = Math.floor(cell / GRID);
  const e = 0.004;
  return [cx / GRID + e, 1 - (cy + 1) / GRID + e, (cx + 1) / GRID - e, 1 - cy / GRID - e];
}

export function decalAtlasTex(): THREE.CanvasTexture {
  return canvasTex(CELL * GRID, CELL * GRID, (c) => {
    const cell = (i: number, draw: (r: () => number) => void): void => {
      c.save();
      c.translate((i % GRID) * CELL, Math.floor(i / GRID) * CELL);
      c.beginPath();
      c.rect(0, 0, CELL, CELL);
      c.clip();
      draw(rng(100 + i * 7));
      c.restore();
    };
    /** Soft organic blotch built from many translucent discs. */
    const blot = (r: () => number, color: string, n: number, spread: number, size: number, alpha: number): void => {
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2;
        const d = Math.pow(r(), 0.7) * spread;
        const x = 128 + Math.cos(a) * d;
        const y = 128 + Math.sin(a) * d;
        const rad = size * (0.3 + r());
        const g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, color.replace("A", String(alpha)));
        g.addColorStop(1, color.replace("A", "0"));
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, rad, 0, Math.PI * 2);
        c.fill();
      }
    };

    cell(DECAL.manhole, (r) => {
      c.fillStyle = "#2e2c29";
      c.beginPath();
      c.arc(128, 128, 120, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#4a4640";
      c.beginPath();
      c.arc(128, 128, 108, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#2a2826";
      c.lineWidth = 5;
      for (let i = -5; i <= 5; i++) {
        c.beginPath();
        c.moveTo(128 + i * 20, 30);
        c.lineTo(128 + i * 20, 226);
        c.stroke();
        c.beginPath();
        c.moveTo(30, 128 + i * 20);
        c.lineTo(226, 128 + i * 20);
        c.stroke();
      }
      c.fillStyle = "#4a4640";
      c.fillRect(70, 110, 116, 36);
      c.fillStyle = "#26241f";
      c.font = "bold 22px sans-serif";
      c.textAlign = "center";
      c.fillText("PUB", 128, 136);
      blot(r, "rgba(110,70,40,A)", 30, 100, 26, 0.25);
    });

    cell(DECAL.grate, () => {
      c.fillStyle = "#3b3936";
      c.fillRect(8, 40, 240, 176);
      c.fillStyle = "#0c0c0c";
      for (let i = 0; i < 11; i++) c.fillRect(22 + i * 20, 52, 11, 152);
      c.strokeStyle = "#55524c";
      c.lineWidth = 4;
      c.strokeRect(10, 42, 236, 172);
    });

    cell(DECAL.oil, (r) => {
      blot(r, "rgba(8,8,10,A)", 60, 70, 46, 0.5);
      blot(r, "rgba(30,24,40,A)", 20, 50, 26, 0.3);
    });

    cell(DECAL.scorch, (r) => {
      blot(r, "rgba(6,5,4,A)", 90, 80, 50, 0.6);
      blot(r, "rgba(60,54,46,A)", 40, 105, 20, 0.4);
      c.strokeStyle = "rgba(10,8,6,0.5)";
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2;
        c.lineWidth = 1 + r() * 3;
        c.beginPath();
        c.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
        c.lineTo(128 + Math.cos(a) * (70 + r() * 50), 128 + Math.sin(a) * (70 + r() * 50));
        c.stroke();
      }
    });

    cell(DECAL.puddle, (r) => {
      // Alpha is the water mask; the puddle material supplies colour and gloss.
      blot(r, "rgba(255,255,255,A)", 26, 60, 60, 0.9);
      c.globalCompositeOperation = "destination-in";
      const img = c.getImageData(DECAL.puddle * 0 + (DECAL.puddle % GRID) * CELL, Math.floor(DECAL.puddle / GRID) * CELL, CELL, CELL);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 150 ? 255 : img.data[i] > 110 ? (img.data[i] - 110) * 6 : 0;
      c.globalCompositeOperation = "source-over";
      c.putImageData(img, (DECAL.puddle % GRID) * CELL, Math.floor(DECAL.puddle / GRID) * CELL);
    });

    cell(DECAL.leaves, (r) => {
      for (let k = 0; k < 150; k++) {
        const x = 20 + r() * 216;
        const y = 20 + r() * 216;
        const t = r();
        c.fillStyle = t < 0.4 ? `rgba(${120 + r() * 50},${90 + r() * 40},40,0.9)` : t < 0.75 ? `rgba(${90 + r() * 30},${70 + r() * 20},45,0.9)` : `rgba(70,${90 + r() * 40},40,0.9)`;
        c.save();
        c.translate(x, y);
        c.rotate(r() * 6.3);
        c.beginPath();
        c.ellipse(0, 0, 3 + r() * 5, 1.5 + r() * 2.5, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    });

    const arrow = (turn: boolean): void => {
      c.fillStyle = "#e8e6de";
      c.beginPath();
      if (!turn) {
        c.moveTo(128, 10);
        c.lineTo(190, 100);
        c.lineTo(146, 100);
        c.lineTo(146, 246);
        c.lineTo(110, 246);
        c.lineTo(110, 100);
        c.lineTo(66, 100);
      } else {
        c.moveTo(120, 246);
        c.lineTo(120, 130);
        c.quadraticCurveTo(120, 90, 160, 90);
        c.lineTo(160, 120);
        c.lineTo(236, 72);
        c.lineTo(160, 24);
        c.lineTo(160, 54);
        c.quadraticCurveTo(84, 54, 84, 130);
        c.lineTo(84, 246);
      }
      c.closePath();
      c.fill();
    };
    const wear = (i: number, amount: number): void => {
      const ox = (i % GRID) * CELL;
      const oy = Math.floor(i / GRID) * CELL;
      const img = c.getImageData(ox, oy, CELL, CELL);
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const n = fbm(x / CELL, y / CELL, 9, 4, 40 + i);
        if (n < amount) img.data[(y * CELL + x) * 4 + 3] = 0;
      }
      c.putImageData(img, ox, oy);
    };
    cell(DECAL.arrow, () => arrow(false));
    wear(DECAL.arrow, 0.36);
    cell(DECAL.arrowTurn, () => arrow(true));
    wear(DECAL.arrowTurn, 0.36);

    cell(DECAL.crack, (r) => {
      c.strokeStyle = "rgba(12,12,12,0.85)";
      for (let k = 0; k < 5; k++) {
        let x = 128 + (r() - 0.5) * 40;
        let y = 128 + (r() - 0.5) * 40;
        let a = r() * 6.3;
        c.lineWidth = 1 + r() * 2;
        c.beginPath();
        c.moveTo(x, y);
        for (let s = 0; s < 22; s++) {
          a += (r() - 0.5) * 1.2;
          x += Math.cos(a) * 7;
          y += Math.sin(a) * 7;
          if (x < 12 || x > 244 || y < 12 || y > 244) break;
          c.lineTo(x, y);
        }
        c.stroke();
      }
    });

    cell(DECAL.patch, (r) => {
      c.fillStyle = "rgba(28,28,30,0.88)";
      c.beginPath();
      c.moveTo(30 + r() * 20, 40 + r() * 20);
      c.lineTo(220 - r() * 20, 30 + r() * 20);
      c.lineTo(230 - r() * 20, 210 - r() * 20);
      c.lineTo(40 + r() * 20, 226 - r() * 20);
      c.closePath();
      c.fill();
      c.strokeStyle = "rgba(10,10,10,0.9)";
      c.lineWidth = 4;
      c.stroke();
    });

    cell(DECAL.rubble, (r) => {
      blot(r, "rgba(120,114,104,A)", 40, 80, 40, 0.45);
      for (let k = 0; k < 260; k++) {
        const a = r() * Math.PI * 2;
        const d = Math.pow(r(), 0.8) * 110;
        const g = 90 + r() * 90;
        c.fillStyle = `rgba(${g},${g - 6},${g - 14},0.95)`;
        c.save();
        c.translate(128 + Math.cos(a) * d, 128 + Math.sin(a) * d);
        c.rotate(r() * 6.3);
        const s = 1.5 + r() * r() * 9;
        c.fillRect(-s / 2, -s / 2, s, s * (0.5 + r() * 0.6));
        c.restore();
      }
    });

    cell(DECAL.tyres, (r) => {
      for (const ox of [70, 186]) {
        c.strokeStyle = "rgba(10,10,10,0.55)";
        c.lineWidth = 26;
        c.beginPath();
        c.moveTo(ox, 0);
        c.bezierCurveTo(ox + 20, 90, ox - 26, 170, ox + 8, 256);
        c.stroke();
      }
      void r;
    });
    wear(DECAL.tyres, 0.42);

    cell(DECAL.blood, (r) => {
      blot(r, "rgba(60,4,4,A)", 40, 46, 34, 0.7);
      blot(r, "rgba(30,2,2,A)", 26, 80, 9, 0.9);
    });

    cell(DECAL.holes, (r) => {
      for (let k = 0; k < 22; k++) {
        const x = 30 + r() * 196;
        const y = 30 + r() * 196;
        const rad = 3 + r() * 6;
        const g = c.createRadialGradient(x, y, 0, x, y, rad * 2.6);
        g.addColorStop(0, "rgba(8,8,8,1)");
        g.addColorStop(0.35, "rgba(30,28,26,0.9)");
        g.addColorStop(0.5, "rgba(170,165,155,0.7)");
        g.addColorStop(1, "rgba(170,165,155,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, rad * 2.6, 0, Math.PI * 2);
        c.fill();
      }
    });

    cell(DECAL.slow, () => {
      c.fillStyle = "#e8e6de";
      c.font = "bold 150px 'Arial Narrow', Arial, sans-serif";
      c.textAlign = "center";
      c.save();
      c.translate(128, 128);
      c.scale(0.62, 1.5);
      c.fillText("SLOW", 0, 52);
      c.restore();
    });
    wear(DECAL.slow, 0.38);

    cell(DECAL.drainCover, () => {
      c.fillStyle = "#77746c";
      c.fillRect(0, 60, 256, 136);
      c.fillStyle = "#1a1a19";
      for (let i = 0; i < 4; i++) c.fillRect(20 + i * 62, 96, 34, 14);
      for (let i = 0; i < 4; i++) c.fillRect(20 + i * 62, 146, 34, 14);
      c.fillStyle = "rgba(40,40,38,0.9)";
      c.fillRect(0, 60, 3, 136);
      c.fillRect(253, 60, 3, 136);
    });
  });
}

/**
 * Sign atlas: every piece of text in the world (shop fronts, block numbers,
 * road signs, notices) is drawn into one shared texture and referenced by UV
 * rectangle, so all signage costs a single material.
 */
export class SignAtlas {
  readonly size = 2048;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private x = 0;
  private y = 0;
  private rowH = 0;
  private readonly cache = new Map<string, UVRect>();

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  /** Draw a w×h pixel sign once (keyed) and return where it landed. */
  add(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): UVRect {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pad = 4;
    if (this.x + w + pad > this.size) {
      this.x = 0;
      this.y += this.rowH + pad;
      this.rowH = 0;
    }
    if (this.y + h > this.size) throw new Error("Sign atlas full");
    const c = this.ctx;
    c.save();
    c.translate(this.x, this.y);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    draw(c, w, h);
    c.restore();
    const uv: UVRect = [this.x / this.size, 1 - (this.y + h) / this.size, (this.x + w) / this.size, 1 - this.y / this.size];
    this.x += w + pad;
    this.rowH = Math.max(this.rowH, h);
    this.cache.set(key, uv);
    this.texture.needsUpdate = true;
    return uv;
  }

  /** A flat coloured sign with centred text lines: the common case. */
  text(key: string, w: number, h: number, bg: string, fg: string, lines: Array<[string, number]>, opts: { border?: string; font?: string; weight?: string; grime?: number } = {}): UVRect {
    return this.add(key, w, h, (c) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      if (opts.border) {
        c.strokeStyle = opts.border;
        c.lineWidth = Math.max(3, h * 0.035);
        c.strokeRect(c.lineWidth, c.lineWidth, w - c.lineWidth * 2, h - c.lineWidth * 2);
      }
      c.fillStyle = fg;
      c.textAlign = "center";
      c.textBaseline = "middle";
      const total = lines.reduce((s, l) => s + l[1] * 1.15, 0);
      let y = (h - total) / 2;
      for (const [str, px] of lines) {
        c.font = `${opts.weight ?? "bold"} ${px}px ${opts.font ?? "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"}`;
        y += (px * 1.15) / 2;
        const m = c.measureText(str).width;
        c.save();
        c.translate(w / 2, y);
        if (m > w * 0.92) c.scale((w * 0.92) / m, 1);
        c.fillText(str, 0, 0);
        c.restore();
        y += (px * 1.15) / 2;
      }
      // Sun-fade and dirt so signs do not look freshly printed.
      const g = opts.grime ?? 0.25;
      const r = rng(key.length * 31 + w);
      for (let k = 0; k < 40; k++) {
        c.fillStyle = `rgba(${40 + r() * 30},${38 + r() * 26},30,${r() * g * 0.35})`;
        const sx = r() * w;
        c.fillRect(sx, 0, 1 + r() * 5, h * (0.3 + r() * 0.7));
      }
      const grad = c.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(0,0,0,${g * 0.3})`);
      grad.addColorStop(0.3, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(60,50,30,${g * 0.25})`);
      c.fillStyle = grad;
      c.fillRect(0, 0, w, h);
    });
  }
}
