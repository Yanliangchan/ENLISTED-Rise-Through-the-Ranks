import { Paint, shade, mixHex, type TexSet } from "./textures";
import { fbm, field, rng, rr, worley } from "./noise";

/**
 * The surface library: every world material's albedo / normal / ORM set,
 * painted procedurally. Light, near-neutral bases are deliberate for anything
 * that gets tinted per part through vertex colour (painted walls, metal,
 * plastic), so one texture set serves many colours.
 */

const S = 512;
const fieldCache = new Map<string, Float32Array>();

/** Cached tileable fractal field sampled by (u, v). */
function F(period: number, octaves: number, seed: number, gain = 0.5): (u: number, v: number) => number {
  const key = `${period}:${octaves}:${seed}:${gain}`;
  let f = fieldCache.get(key);
  if (!f) {
    f = field(S, (u, v) => fbm(u, v, period, octaves, seed, gain));
    fieldCache.set(key, f);
  }
  const ff = f;
  return (u, v) => ff[((Math.floor(v * S) % S + S) % S) * S + ((Math.floor(u * S) % S + S) % S)];
}

const sm = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Wandering crack polylines, drawn into colour and height together. */
function cracks(p: Paint, count: number, color: string, width: number, len: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    let x = r() * p.size;
    let y = r() * p.size;
    let ang = r() * Math.PI * 2;
    const pts: number[][] = [[x, y]];
    const steps = Math.floor(len * (0.5 + r()));
    for (let s = 0; s < steps; s++) {
      ang += (r() - 0.5) * 1.1;
      x += Math.cos(ang) * 7;
      y += Math.sin(ang) * 7;
      pts.push([x, y]);
    }
    p.wrap((ox, oy) => {
      p.all(color, 0.2, 0.95, (c) => {
        c.lineWidth = width * (0.6 + r() * 0.8);
        c.lineJoin = "round";
        c.beginPath();
        c.moveTo(pts[0][0] + ox, pts[0][1] + oy);
        for (const q of pts) c.lineTo(q[0] + ox, q[1] + oy);
        c.stroke();
      });
    });
  }
}

/** Vertical rain streaks: noise stretched hard along V. */
function streakMask(seed: number, density: number): (u: number, v: number) => number {
  const a = F(48, 2, seed);
  const b = F(6, 3, seed + 5);
  return (u, v) => sm(1 - density, 1, a(u, v * 0.06) * 0.75 + b(u, v) * 0.25) * (0.55 + 0.45 * b(u * 0.5, v));
}

export function buildSurfaces(): Record<string, TexSet> {
  const T: Record<string, TexSet> = {};
  const big = F(3, 4, 21);
  const mid = F(8, 4, 33);
  const fine = F(32, 3, 47);
  const blot = F(5, 5, 59, 0.6);

  // ---- bare concrete: form-panel seams, tie holes, water staining -------
  {
    const p = new Paint(S, "#a39f96", { rough: 0.9, seed: 2 });
    p.grain(0.16, 4, 5, 3).speckle(0.07, 5);
    p.stain("#6f6d66", (u, v) => sm(0.56, 0.8, blot(u, v)) * 0.45);
    p.stain("#c2bfb6", (u, v) => sm(0.6, 0.85, big(u + 0.3, v + 0.7)) * 0.3);
    p.stain("#55584a", streakMask(8, 0.22), { rough: 0.95 });
    // Form panel joints every half tile, with tie holes.
    for (const k of [0, S / 2]) {
      p.all("rgba(60,60,56,0.4)", 0.4, 0.95, (c) => {
        c.fillRect(0, k - 1, S, 2);
        c.fillRect(k - 1, 0, 2, S);
      });
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      p.all("#4c4b47", 0.12, 0.95, (c) => {
        c.beginPath();
        c.arc(S / 8 + (i * S) / 4, S / 8 + (j * S) / 4, 3, 0, Math.PI * 2);
        c.fill();
      });
    }
    cracks(p, 1, "rgba(70,70,64,0.6)", 0.9, 14, 9);
    T.concrete = p.finish({ normal: 1.6, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.05 + (mid(u, v) - 0.5) * 0.04) });
  }

  // ---- painted facade (tint via vertex colour) ---------------------------
  {
    const p = new Paint(S, "#e6e3da", { rough: 0.82, seed: 4 });
    p.grain(0.07, 5, 4, 13).speckle(0.035, 7);
    p.stain("#b9b6a8", (u, v) => sm(0.5, 0.9, blot(u + 0.2, v)) * 0.35);
    p.stain("#7d8270", streakMask(18, 0.2), { rough: 0.92 });
    p.stain("#f4f2ec", (u, v) => sm(0.62, 0.9, big(u, v + 0.4)) * 0.4);
    cracks(p, 2, "rgba(120,118,108,0.7)", 1, 18, 31);
    T.paint = p.finish({ normal: 0.9, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.06) });
  }

  // ---- old plaster: mottled, peeled patches down to the render ----------
  {
    const p = new Paint(S, "#dedacd", { rough: 0.88, seed: 6 });
    p.grain(0.12, 6, 5, 23).speckle(0.05, 9);
    const peel = F(7, 4, 77, 0.55);
    p.stain("#8f8a7c", (u, v) => sm(0.66, 0.7, peel(u, v)), { rough: 0.96, height: -0.12 });
    p.stain("#6a6f5c", (u, v) => sm(0.55, 0.85, mid(u, v)) * 0.3 * sm(0.35, 0.8, big(u, v)));
    p.stain("#59604e", streakMask(41, 0.3), { rough: 0.94 });
    cracks(p, 5, "rgba(70,68,60,0.8)", 1.2, 22, 53);
    T.plaster = p.finish({ normal: 1.8, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.08 + (mid(u, v) - 0.5) * 0.05) });
  }

  // ---- asphalt: aggregate, repairs, cracks, damp patches -----------------
  {
    const p = new Paint(S, "#4b4c4e", { rough: 0.9, seed: 8 });
    p.grain(0.2, 5, 5, 61);
    const r = rng(12);
    for (let i = 0; i < 9000; i++) {
      const g = 40 + r() * 110;
      p.a.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + r() * 0.5})`;
      p.a.fillRect(r() * S, r() * S, 1 + r() * 1.6, 1 + r() * 1.6);
    }
    p.stain("#3a3b3d", (u, v) => sm(0.55, 0.75, blot(u, v)) * 0.6);
    p.stain("#5c5c59", (u, v) => sm(0.6, 0.9, big(u + 0.5, v)) * 0.4);
    // Damp sheen where water sits: low roughness reads as a wet road in the reflections.
    p.stain("#3c3d3f", (u, v) => sm(0.56, 0.8, mid(u + 0.1, v + 0.6)) * 0.6, { rough: 0.5 });
    cracks(p, 2, "rgba(18,18,19,0.8)", 1.0, 22, 71);
    T.asphalt = p.finish({ normal: 1.3, height: field(S, (u, v) => (fbm(u, v, 64, 2, 5) - 0.5) * 0.16) });
  }

  // ---- precinct pavers: herringbone clay brick --------------------------
  {
    const p = new Paint(S, "#4a443d", { rough: 0.9, height: 0.3, seed: 10 });
    const r = rng(14);
    const bw = S / 8;
    const bh = S / 16;
    const cols = ["#8f6f5e", "#876a5a", "#957664", "#7f6a5e", "#7a6d63", "#8a7163"];
    const brick = (x: number, y: number, w: number, h: number): void => {
      const col = shade(cols[Math.floor(r() * cols.length)], 0.86 + r() * 0.24);
      p.wrap((ox, oy) => {
        p.all(col, 0.52 + r() * 0.06, 0.82 + r() * 0.12, (c) => c.fillRect(x + ox + 1.5, y + oy + 1.5, w - 3, h - 3));
      });
    };
    // Running bond: every course offset by half a brick, so the surface is fully covered.
    for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) brick(i * bw + (j % 2 ? bw / 2 : 0), j * bh, bw, bh);
    p.grain(0.14, 6, 4, 81).speckle(0.06, 11);
    p.stain("#3b3d33", (u, v) => sm(0.58, 0.85, blot(u, v)) * 0.5);
    T.pavers = p.finish({ normal: 2.4, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.05) });
  }

  // ---- ceramic floor tile (hawker centre, coffee shop) --------------------
  {
    const p = new Paint(S, "#6f6a5f", { rough: 0.7, height: 0.35, seed: 16 });
    const r = rng(18);
    const n = 4;
    const t = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const base = mixHex("#cfc5ad", "#bdb198", r());
      p.all(shade(base, 0.92 + r() * 0.14), 0.55, 0.3 + r() * 0.12, (c) => c.fillRect(i * t + 2, j * t + 2, t - 4, t - 4));
    }
    p.grain(0.08, 10, 4, 91).speckle(0.03, 13);
    p.stain("#59523f", (u, v) => sm(0.55, 0.85, blot(u, v)) * 0.45, { rough: 0.75 });
    p.stain("#3f3a2e", (u, v) => sm(0.7, 0.8, mid(u, v)) * 0.4, { rough: 0.85 });
    T.floortile = p.finish({ normal: 1.6 });
  }

  // ---- white glazed wall tile ---------------------------------------------
  {
    const p = new Paint(S, "#8f8e86", { rough: 0.6, height: 0.3, seed: 20 });
    const r = rng(22);
    const n = 8;
    const t = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      p.all(shade("#e9e7df", 0.94 + r() * 0.1), 0.56, 0.16 + r() * 0.08, (c) => c.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3));
    }
    p.stain("#8a8468", (u, v) => sm(0.6, 0.9, blot(u, v)) * 0.35, { rough: 0.6 });
    T.walltile = p.finish({ normal: 1.4 });
  }

  // ---- cement screed (void deck floors) -----------------------------------
  {
    const p = new Paint(S, "#8d8a83", { rough: 0.62, seed: 24 });
    p.grain(0.12, 5, 5, 101).speckle(0.04, 15);
    p.stain("#6c6a64", (u, v) => sm(0.5, 0.8, blot(u, v)) * 0.5, { rough: 0.5 });
    p.stain("#a5a29a", (u, v) => sm(0.6, 0.9, big(u, v)) * 0.4, { rough: 0.72 });
    p.all("rgba(50,50,48,0.7)", 0.3, 0.9, (c) => {
      c.fillRect(0, 0, S, 2);
      c.fillRect(0, 0, 2, S);
    });
    cracks(p, 2, "rgba(54,54,50,0.8)", 1.1, 22, 111);
    T.screed = p.finish({ normal: 0.9, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.03) });
  }

  // ---- clay roof tiles ----------------------------------------------------
  {
    const p = new Paint(S, "#5a3324", { rough: 0.85, height: 0.2, seed: 26 });
    const r = rng(28);
    const cols = 8;
    const rows = 6;
    const cw = S / cols;
    const rh = S / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const col = shade(mixHex("#a8553a", "#8a4a36", r()), 0.8 + r() * 0.35);
        const x = i * cw;
        const y = j * rh;
        // Barrel tile: bright ridge down the middle, dark valleys between.
        const g = p.h.createLinearGradient(x, 0, x + cw, 0);
        g.addColorStop(0, "#222");
        g.addColorStop(0.5, "#e8e8e8");
        g.addColorStop(1, "#222");
        p.h.fillStyle = g;
        p.h.fillRect(x, y, cw, rh);
        p.a.fillStyle = col;
        p.a.fillRect(x + 1, y, cw - 2, rh);
        p.a.fillStyle = "rgba(0,0,0,0.38)";
        p.a.fillRect(x, y + rh - 4, cw, 4);
        p.h.fillStyle = "rgba(0,0,0,0.5)";
        p.h.fillRect(x, y + rh - 3, cw, 3);
      }
    }
    p.grain(0.2, 6, 4, 121).speckle(0.06, 17);
    p.stain("#2f3326", (u, v) => sm(0.5, 0.8, blot(u, v)) * 0.6);
    p.stain("#1e1f1a", streakMask(131, 0.25));
    T.rooftile = p.finish({ normal: 2.6 });
  }

  // ---- ribbed metal sheet (roofs, hoarding, shutters); tinted ------------
  {
    const p = new Paint(S, "#d9d9d6", { rough: 0.5, seed: 30 });
    const ribs = 8;
    const w = S / ribs;
    for (let i = 0; i < ribs; i++) {
      const g = p.h.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      g.addColorStop(0, "#3a3a3a");
      g.addColorStop(0.18, "#d8d8d8");
      g.addColorStop(0.42, "#d8d8d8");
      g.addColorStop(0.6, "#3a3a3a");
      g.addColorStop(1, "#3a3a3a");
      p.h.fillStyle = g;
      p.h.fillRect(i * w, 0, w, S);
      p.a.fillStyle = "rgba(0,0,0,0.12)";
      p.a.fillRect(i * w + w * 0.6, 0, w * 0.4, S);
    }
    p.grain(0.08, 6, 4, 141);
    p.stain("#6e4a33", (u, v) => sm(0.62, 0.8, blot(u, v)) * sm(0.4, 0.7, mid(u, v)) * 0.7, { rough: 0.9 });
    p.stain("#8a8b86", streakMask(151, 0.2), { rough: 0.7 });
    T.ribmetal = p.finish({ normal: 2.2, metal: 0.55 });
  }

  // ---- painted metal: smooth coat, chipped to rust; tinted ---------------
  {
    const p = new Paint(S, "#dcdcd8", { rough: 0.45, seed: 32 });
    p.grain(0.06, 6, 4, 161);
    const chip = F(24, 3, 171, 0.6);
    p.stain("#5b3a28", (u, v) => sm(0.7, 0.73, chip(u, v) * 0.7 + blot(u, v) * 0.3), { rough: 0.92, height: -0.1 });
    p.stain("#2b2422", (u, v) => sm(0.76, 0.78, chip(u, v) * 0.7 + blot(u, v) * 0.3), { rough: 0.6 });
    p.stain("#9c9a92", streakMask(181, 0.14), { rough: 0.6 });
    T.paintmetal = p.finish({ normal: 1.2, metal: 0.25 });
  }

  // ---- bare / galvanised steel -------------------------------------------
  {
    const p = new Paint(S, "#9a9c9d", { rough: 0.38, seed: 34 });
    const brush = F(64, 2, 191);
    p.stain("#c4c6c7", (u, v) => brush(u * 0.04, v) * 0.5, { rough: 0.3 });
    p.stain("#6f7273", (u, v) => sm(0.5, 0.8, blot(u, v)) * 0.5, { rough: 0.5 });
    // Spangle: the crystalline look of hot-dip galvanising.
    p.stain("#b4b6b7", (u, v) => sm(0.2, 0.5, worley(u, v, 22, 3)[0]) * 0.3);
    T.steel = p.finish({ normal: 0.5, metal: 1, height: field(S, (u, v) => (brush(u * 0.04, v) - 0.5) * 0.03) });
  }

  // ---- heavy rust ---------------------------------------------------------
  {
    const p = new Paint(S, "#6b4530", { rough: 0.95, seed: 36 });
    p.grain(0.3, 8, 5, 201).speckle(0.1, 19);
    p.stain("#8f5a34", (u, v) => sm(0.5, 0.75, mid(u, v)) * 0.7);
    p.stain("#3a2a22", (u, v) => sm(0.55, 0.7, blot(u, v)) * 0.8);
    p.stain("#b0733d", (u, v) => sm(0.7, 0.85, fine(u, v)) * 0.5);
    T.rust = p.finish({ normal: 2.4, metal: 0.3, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.2 + (mid(u, v) - 0.5) * 0.1) });
  }

  // ---- timber planks; tinted ----------------------------------------------
  {
    const p = new Paint(S, "#b89a78", { rough: 0.78, seed: 38 });
    const r = rng(40);
    const planks = 6;
    const ph = S / planks;
    const grainF = F(96, 3, 211);
    for (let j = 0; j < planks; j++) {
      p.a.fillStyle = shade("#b89a78", 0.82 + r() * 0.3);
      p.a.fillRect(0, j * ph, S, ph);
      p.all("rgba(40,28,18,0.85)", 0.22, 0.9, (c) => c.fillRect(0, j * ph, S, 2.5));
      const off = r() * S;
      p.all("rgba(40,28,18,0.7)", 0.25, 0.9, (c) => c.fillRect(off, j * ph, 2, ph));
    }
    p.stain("#6f5237", (u, v) => sm(0.35, 0.75, grainF(u * 0.05, v)) * 0.6);
    p.stain("#4a3524", (u, v) => sm(0.62, 0.8, blot(u, v)) * 0.45);
    p.speckle(0.05, 21);
    T.wood = p.finish({ normal: 1.8, height: field(S, (u, v) => (grainF(u * 0.05, v) - 0.5) * 0.1) });
  }

  // ---- red brick ----------------------------------------------------------
  {
    const p = new Paint(S, "#8f887b", { rough: 0.92, height: 0.28, seed: 42 });
    const r = rng(44);
    const rows = 12;
    const bh = S / rows;
    const bw = S / 4;
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? bw / 2 : 0;
      for (let i = -1; i < 5; i++) {
        const col = shade(mixHex("#93513c", "#7a4636", r()), 0.8 + r() * 0.4);
        p.wrap((ox) => p.all(col, 0.55 + r() * 0.08, 0.85 + r() * 0.1, (c) => c.fillRect(i * bw + off + ox + 2, j * bh + 2, bw - 4, bh - 4)));
      }
    }
    p.grain(0.16, 8, 4, 221).speckle(0.07, 23);
    p.stain("#3d3a30", (u, v) => sm(0.55, 0.85, blot(u, v)) * 0.5);
    p.stain("#c9c3b4", (u, v) => sm(0.68, 0.85, mid(u, v)) * 0.35);
    T.brick = p.finish({ normal: 2.6, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.08) });
  }

  // ---- lawn ----------------------------------------------------------------
  {
    const p = new Paint(S, "#4b5a2c", { rough: 0.95, seed: 46 });
    const r = rng(48);
    for (let i = 0; i < 14000; i++) {
      const x = r() * S;
      const y = r() * S;
      const l = 3 + r() * 7;
      const a = -Math.PI / 2 + (r() - 0.5) * 1.4;
      const g = r();
      p.a.strokeStyle = g < 0.12 ? `rgba(150,140,80,${0.3 + r() * 0.3})` : `rgba(${50 + g * 60},${80 + g * 70},${30 + g * 30},${0.35 + r() * 0.4})`;
      p.a.lineWidth = 0.8 + r();
      p.a.beginPath();
      p.a.moveTo(x, y);
      p.a.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      p.a.stroke();
    }
    p.grain(0.22, 5, 5, 231);
    p.stain("#6b5a3a", (u, v) => sm(0.66, 0.82, blot(u, v)) * 0.7);
    p.stain("#33451f", (u, v) => sm(0.55, 0.85, big(u, v)) * 0.5);
    T.grass = p.finish({ normal: 2, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.3 + (mid(u, v) - 0.5) * 0.2) });
  }

  // ---- bare earth / laterite ------------------------------------------------
  {
    const p = new Paint(S, "#7b5f42", { rough: 0.96, seed: 50 });
    p.grain(0.24, 6, 5, 241).speckle(0.09, 25);
    p.stain("#5c452f", (u, v) => sm(0.5, 0.75, blot(u, v)) * 0.6);
    p.stain("#9a7a55", (u, v) => sm(0.6, 0.85, mid(u, v)) * 0.5);
    const r = rng(52);
    for (let i = 0; i < 420; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 0.7 + r() * r() * 2.6;
      const g = 95 + r() * 60;
      p.wrap((ox, oy) => p.all(`rgba(${g},${g - 10},${g - 26},0.8)`, 0.6, 0.85, (c) => {
        c.beginPath();
        c.ellipse(x + ox, y + oy, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
        c.fill();
      }));
    }
    T.dirt = p.finish({ normal: 2.4, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.25 + (mid(u, v) - 0.5) * 0.25) });
  }

  // ---- monsoon drain concrete: algae line, silt -----------------------------
  {
    const p = new Paint(S, "#99968c", { rough: 0.9, seed: 54 });
    p.grain(0.16, 5, 5, 251).speckle(0.07, 27);
    p.stain("#3f4a2e", (u, v) => sm(0.45, 0.8, blot(u, v) * 0.6 + (1 - v) * 0.5) * 0.85, { rough: 0.7 });
    p.stain("#2a2f22", streakMask(261, 0.35));
    p.stain("#5d5a50", (u, v) => sm(0.55, 0.8, mid(u, v)) * 0.5);
    cracks(p, 4, "rgba(40,40,36,0.85)", 1.3, 24, 271);
    T.drain = p.finish({ normal: 1.8, height: field(S, (u, v) => (fine(u, v) - 0.5) * 0.08) });
  }

  // ---- hessian sandbag -------------------------------------------------------
  {
    const p = new Paint(S, "#a08c66", { rough: 0.97, seed: 56 });
    const weave = field(S, (u, v) => (Math.sin(u * Math.PI * 2 * 96) * 0.5 + 0.5) * 0.5 + (Math.sin(v * Math.PI * 2 * 96) * 0.5 + 0.5) * 0.5);
    p.stain("#7d6b4c", (u, v) => weave[Math.floor(v * S) * S + Math.floor(u * S)] * 0.55);
    p.grain(0.2, 6, 5, 281).speckle(0.08, 29);
    p.stain("#5a4d38", (u, v) => sm(0.5, 0.8, blot(u, v)) * 0.55);
    p.stain("#b9a882", (u, v) => sm(0.62, 0.9, big(u, v)) * 0.4);
    T.sandbag = p.finish({ normal: 2, height: weave.map((x) => (x - 0.5) * 0.12) });
  }

  // ---- canvas / tarpaulin; tinted --------------------------------------------
  {
    const p = new Paint(S, "#d2d0c4", { rough: 0.9, seed: 58 });
    const weave = field(S, (u, v) => (Math.sin(u * Math.PI * 2 * 128) * 0.5 + 0.5) * (Math.sin(v * Math.PI * 2 * 128) * 0.5 + 0.5));
    p.stain("#a8a698", (u, v) => weave[Math.floor(v * S) * S + Math.floor(u * S)] * 0.4);
    p.grain(0.12, 5, 5, 291);
    p.stain("#8c8a7a", (u, v) => sm(0.5, 0.85, blot(u, v)) * 0.45);
    const fold = F(4, 3, 301);
    T.canvas = p.finish({ normal: 2.2, height: field(S, (u, v) => (fold(u, v) - 0.5) * 0.5 + weave[Math.floor(v * S) * S + Math.floor(u * S)] * 0.04) });
  }

  // ---- smooth moulded plastic; tinted ------------------------------------------
  {
    const p = new Paint(256, "#e4e4e0", { rough: 0.42, seed: 60 });
    p.grain(0.05, 6, 3, 311);
    p.stain("#a9a79c", (u, v) => sm(0.6, 0.9, blot(u, v)) * 0.35, { rough: 0.6 });
    T.plastic = p.finish({ normal: 0.4 });
  }

  // ---- tyre rubber ---------------------------------------------------------------
  {
    const p = new Paint(256, "#1c1c1d", { rough: 0.9, seed: 62 });
    for (let i = 0; i < 16; i++) {
      p.all("#0d0d0e", 0.2, 0.95, (c) => c.fillRect(0, i * 16 + 6, 256, 4));
    }
    p.grain(0.25, 8, 4, 321).speckle(0.1, 31);
    p.stain("#5a5144", (u, v) => sm(0.55, 0.85, blot(u, v)) * 0.4);
    T.rubber = p.finish({ normal: 2 });
  }

  void rr;
  return T;
}
