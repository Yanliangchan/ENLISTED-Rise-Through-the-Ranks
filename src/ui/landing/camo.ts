/**
 * Procedural SAF No.4-style pixelated camouflage, generated once to a data
 * URL and reused as a CSS background (title fill, deploy button, panel
 * accents). Real digital camo clusters same-colour cells into blobs rather
 * than pure noise, so the generator runs a majority-vote smoothing pass over
 * a seeded random field to get that chunky pixel-blob read.
 */

/** Deterministic PRNG (same shape as Level.ts) so the camo is identical on every load. */
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

/** SAF No.4 pixel-camo palette — deep olives and greens with sparse near-black. */
const CAMO_PALETTE = ["#3d4a2b", "#2a3120", "#55663a", "#1a1f14", "#4a5638"];

let cachedCamo: string | null = null;

export function camoDataUrl(): string {
  if (cachedCamo) return cachedCamo;
  const cells = 40;
  const cellPx = 5;
  const rand = mulberry32(6571);

  // Weighted random field — mid-olives dominate, black is the rare accent.
  const weights = [0.3, 0.24, 0.2, 0.1, 0.16];
  let field: number[] = [];
  for (let i = 0; i < cells * cells; i++) {
    let roll = rand();
    let idx = 0;
    for (let w = 0; w < weights.length; w++) {
      if (roll < weights[w]) { idx = w; break; }
      roll -= weights[w];
      idx = w;
    }
    field.push(idx);
  }

  // Two majority-vote smoothing passes cluster the noise into digital blobs.
  for (let pass = 0; pass < 2; pass++) {
    const next = field.slice();
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const counts = new Array(CAMO_PALETTE.length).fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = (x + dx + cells) % cells;
            const ny = (y + dy + cells) % cells;
            counts[field[ny * cells + nx]]++;
          }
        }
        let best = 0;
        for (let c = 1; c < counts.length; c++) if (counts[c] > counts[best]) best = c;
        next[y * cells + x] = best;
      }
    }
    field = next;
  }

  const canvas = document.createElement("canvas");
  canvas.width = cells * cellPx;
  canvas.height = cells * cellPx;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = CAMO_PALETTE[field[y * cells + x]];
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
  cachedCamo = canvas.toDataURL("image/png");
  return cachedCamo;
}
