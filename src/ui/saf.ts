/**
 * SAF No. 4 visual identity — the shared source of the game's look.
 *
 * Everything here is generated once to a data URL and reused as a CSS
 * background (or a Babylon texture), so the whole interface and the in-world
 * equipment read as the same issued kit rather than each screen inventing its
 * own palette.
 *
 * The camouflage is the signature. Real SAF No. 4 is a pixelised pattern built
 * from a handful of muted, earthy greens — not a bright or neon green, and not
 * generic uniform-sized digital noise. Two things give it its character and
 * both are modelled here:
 *
 *  1. Clustering. Same-colour cells group into irregular blobs rather than
 *     scattering, which is what makes it read as dyed fabric instead of TV
 *     static. A majority-vote smoothing pass over a seeded random field does
 *     this cheaply.
 *  2. Multi-scale. Large disruptive shapes carry the silhouette-breaking work
 *     while a finer pixel layer sits on top of them. A single cell size looks
 *     like a computer texture; two layered sizes look like cloth.
 */

/** Deterministic PRNG (same shape as Level.ts) so the pattern is identical on every load. */
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

/**
 * SAF No. 4 palette: pale sage through forest green to near-black, with one
 * olive-brown. Deliberately desaturated and dark — bright greens are the main
 * thing that makes camo read as a video-game texture rather than uniform.
 */
export const SAF_CAMO_COLORS = ["#79805f", "#55663f", "#3a4a31", "#26301f", "#151b11"] as const;
/** Sparse olive-brown, used at low frequency the way the real pattern carries a little earth tone. */
const SAF_CAMO_BROWN = "#5c5738";

/** Named tones for anything that isn't camouflage — panels, webbing, metal, markings. */
export const SAF = {
  /** Backgrounds, darkest first. */
  black: "#0b0f0a",
  bg: "#111710",
  panel: "#161d14",
  panelHi: "#1c2519",
  inset: "#0e130c",
  /** Structure. */
  line: "#2f3a28",
  lineHi: "#465237",
  /** Text. */
  text: "#d5ddc8",
  textDim: "#8f9a80",
  textFaint: "#67725c",
  /** Accents — practical signal colours only. */
  olive: "#5b6b3f",
  green: "#4a6135",
  sage: "#9aa882",
  tan: "#a8996d",
  brown: "#6b5b3e",
  amber: "#c9a227",
  red: "#a83828",
  /** Typography stacks. Condensed and plain — equipment labelling, not sci-fi. */
  fontUi: `"Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif`,
  fontMono: `"DejaVu Sans Mono", Consolas, "Courier New", monospace`,
} as const;

interface CamoOptions {
  /** Pixel size of the fine layer. Larger = the pattern reads from further away. */
  cell?: number;
  /** Grid cells per side. cell * cells = texture size. */
  cells?: number;
  seed?: number;
  /** 0..1 — blends the whole pattern toward black, for use behind text. */
  darken?: number;
}

const camoCache = new Map<string, string>();

/**
 * A tileable SAF No. 4 camouflage PNG as a data URL.
 *
 * Built in two passes: a coarse field of large blobs establishes the big
 * disruptive shapes, then a finer field is stamped over it at partial
 * coverage, leaving the ragged pixel edges between colour regions that the
 * real pattern has. Both fields wrap, so the result tiles seamlessly.
 */
export function safCamoDataUrl(options: CamoOptions = {}): string {
  const { cell = 6, cells = 44, seed = 20260811, darken = 0 } = options;
  const key = `${cell}|${cells}|${seed}|${darken}`;
  const cached = camoCache.get(key);
  if (cached) return cached;

  const palette = [...SAF_CAMO_COLORS, SAF_CAMO_BROWN];
  // Mid greens dominate; near-black and brown are sparse accents.
  const weights = [0.16, 0.3, 0.26, 0.16, 0.06, 0.06];

  const buildField = (n: number, rng: () => number, passes: number): number[] => {
    let field: number[] = [];
    for (let i = 0; i < n * n; i++) {
      let roll = rng();
      let idx = 0;
      for (let w = 0; w < weights.length; w++) {
        idx = w;
        if (roll < weights[w]) break;
        roll -= weights[w];
      }
      field.push(idx);
    }
    // Majority vote over the wrapped neighbourhood clusters the noise into blobs.
    for (let pass = 0; pass < passes; pass++) {
      const next = field.slice();
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const counts = new Array(palette.length).fill(0);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              counts[field[((y + dy + n) % n) * n + ((x + dx + n) % n)]]++;
            }
          }
          let best = 0;
          for (let c = 1; c < counts.length; c++) if (counts[c] > counts[best]) best = c;
          next[y * n + x] = best;
        }
      }
      field = next;
    }
    return field;
  };

  const size = cell * cells;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Coarse layer: quarter resolution, heavily smoothed → the big shapes.
  const coarseN = Math.max(4, Math.round(cells / 4));
  const coarse = buildField(coarseN, mulberry32(seed), 3);
  const coarseCell = size / coarseN;
  for (let y = 0; y < coarseN; y++) {
    for (let x = 0; x < coarseN; x++) {
      ctx.fillStyle = palette[coarse[y * coarseN + x]];
      ctx.fillRect(x * coarseCell, y * coarseCell, coarseCell + 1, coarseCell + 1);
    }
  }

  // Fine layer: full resolution, lightly smoothed, stamped at partial coverage
  // so the coarse shapes still show through and the borders stay ragged.
  const fine = buildField(cells, mulberry32(seed ^ 0x9e3779b9), 2);
  const coverRng = mulberry32(seed ^ 0x5bf03635);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (coverRng() > 0.62) continue;
      ctx.fillStyle = palette[fine[y * cells + x]];
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  if (darken > 0) {
    ctx.fillStyle = `rgba(6, 10, 6, ${Math.min(1, darken)})`;
    ctx.fillRect(0, 0, size, size);
  }

  const url = canvas.toDataURL("image/png");
  camoCache.set(key, url);
  return url;
}

let fabricCache: string | null = null;

/**
 * Fine woven-fabric noise. Layered over panels at very low opacity it kills the
 * flat-digital look and gives surfaces a cloth tooth — the difference between
 * "UI panel" and "something printed on canvas".
 */
export function safFabricDataUrl(): string {
  if (fabricCache) return fabricCache;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(99173);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // A weave bias on alternating rows/columns plus per-texel noise.
      const weave = ((x % 2) ^ (y % 2)) * 10;
      const n = rng() * 26;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, weave + n);
    }
  }
  ctx.putImageData(img, 0, 0);
  fabricCache = canvas.toDataURL("image/png");
  return fabricCache;
}

let scratchCache: string | null = null;

/**
 * Sparse scuffs and dust specks. Used at low opacity on equipment cards and
 * major panels so kit reads as issued and used rather than showroom-clean.
 */
export function safWearDataUrl(): string {
  if (scratchCache) return scratchCache;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = mulberry32(4451);
  // Fine dust.
  for (let i = 0; i < 900; i++) {
    const a = 0.02 + rng() * 0.05;
    ctx.fillStyle = rng() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.6})`;
    ctx.fillRect(rng() * size, rng() * size, 1, 1);
  }
  // Longer scratches, mostly shallow angles like wear from webbing.
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 8 + rng() * 40;
    const ang = (rng() - 0.5) * 0.9 + (rng() > 0.5 ? 0 : Math.PI / 2);
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + rng() * 0.07})`;
    ctx.lineWidth = rng() > 0.7 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  scratchCache = canvas.toDataURL("image/png");
  return scratchCache;
}

/**
 * Full CSS declarations layering camouflage under a dark wash, for use behind
 * large panels. `strength` 0..1 controls how much pattern shows — keep it low:
 * the camo is an identity cue, not wallpaper, and text has to stay readable.
 */
export function safCamoBacking(strength = 0.1, sizePx = 190): string {
  const wash = 1 - strength;
  return (
    `background-image: linear-gradient(rgba(14, 19, 13, ${wash}), rgba(11, 15, 10, ${wash})),` +
    ` url("${safCamoDataUrl()}");` +
    ` background-size: auto, ${sizePx}px ${sizePx}px;` +
    ` background-repeat: no-repeat, repeat;`
  );
}
