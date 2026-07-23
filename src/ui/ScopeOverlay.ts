import type { ReticleStyle } from "@/data/attachments";

export type OpticKind = "none" | "scope" | "reddot";

const GREEN = "#39ff6a";
const GREEN_GLOW = "rgba(57,255,106,0.9)";
const RED = "#ff2a20";
const RED_GLOW = "rgba(255,40,30,0.9)";

/**
 * Screen-space optic overlay. Each optic family draws a distinct reticle:
 *  - "reddot" kind (red dot / holo, low magnification): no vignette, just the
 *    dot/holo reticle so the view stays open for CQB.
 *  - "scope" kind (magnified glass): a circular vignette (CSS box-shadow) plus
 *    a reticle matched to the optic — duplex cross (low power), ACOG chevron
 *    (4×), mil-dot ladder (6× marksman), or a Christmas-tree grid (8×+ sniper).
 * The main camera's own FOV narrows for the exact magnification, so the sight
 * picture is a normal, undistorted perspective view.
 */
export class ScopeOverlay {
  private root: HTMLDivElement;
  private circle: HTMLDivElement;
  /** All reticle variants, keyed by style; exactly one is shown at a time. */
  private reticles: Record<ReticleStyle, HTMLDivElement>;
  private minDimVmin = 100;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `position: fixed; inset: 0; display: none; pointer-events: none; z-index: 12;`;

    this.circle = document.createElement("div");
    this.circle.style.cssText = `
      position: absolute; top: 50%; left: 50%; border-radius: 50%;
      transform: translate(-50%, -50%); background: transparent;
    `;
    this.root.appendChild(this.circle);

    this.reticles = {
      dot: this.buildDot(),
      holo: this.buildHolo(),
      duplex: this.buildDuplex(),
      chevron: this.buildChevron(),
      mildot: this.buildMilDot(),
      tree: this.buildTree(),
    };
    for (const el of Object.values(this.reticles)) this.root.appendChild(el);

    container.appendChild(this.root);
  }

  /** A centred, initially-hidden 1px anchor div the reticle marks hang off. */
  private anchor(html: string): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute; top:50%; left:50%; width:1px; height:1px; display:none;`;
    el.innerHTML = html;
    return el;
  }

  private buildDot(): HTMLDivElement {
    // Red dot / micro RDS — a tight glowing dot with a faint ring.
    return this.anchor(`
      <div style="position:absolute; transform:translate(-50%,-50%); width:40px; height:40px; border-radius:50%;
                  border:1px solid rgba(255,60,50,0.22); box-shadow:0 0 6px rgba(255,40,30,0.12) inset;"></div>
      <div style="position:absolute; transform:translate(-50%,-50%); width:3px; height:3px; border-radius:50%;
                  background:${RED}; box-shadow:0 0 4px 1px ${RED_GLOW};"></div>
    `);
  }

  private buildHolo(): HTMLDivElement {
    // Holographic / reflex — a wide open ring with a centre dot and a small
    // lower post (an EOTech-style circle-dot).
    const ring = `position:absolute; transform:translate(-50%,-50%); border-radius:50%;`;
    return this.anchor(`
      <div style="${ring} width:64px; height:64px; border:1.5px solid rgba(255,40,30,0.55); box-shadow:0 0 5px rgba(255,40,30,0.2);"></div>
      <div style="position:absolute; transform:translate(-50%,-50%); width:3px; height:3px; border-radius:50%; background:${RED}; box-shadow:0 0 4px 1px ${RED_GLOW};"></div>
      <div style="position:absolute; left:-1px; top:20px; width:2px; height:14px; background:${RED}; box-shadow:0 0 3px ${RED_GLOW};"></div>
    `);
  }

  private buildDuplex(): HTMLDivElement {
    // Low-power combat glass (1.5–3×) — a duplex cross: bold outer posts that
    // stop short of a small centre gap + a fine central dot.
    const post = `position:absolute; background:${GREEN}; box-shadow:0 0 3px ${GREEN_GLOW};`;
    return this.anchor(`
      <div style="${post} left:-1.5px; top:-78px; width:3px; height:60px;"></div>
      <div style="${post} left:-1.5px; top:18px;  width:3px; height:60px;"></div>
      <div style="${post} top:-1.5px; left:-78px; height:3px; width:60px;"></div>
      <div style="${post} top:-1.5px; left:18px;  height:3px; width:60px;"></div>
      <div style="position:absolute; left:-1.5px; top:-1.5px; width:3px; height:3px; border-radius:50%; background:${GREEN}; box-shadow:0 0 3px ${GREEN_GLOW};"></div>
    `);
  }

  private buildChevron(): HTMLDivElement {
    // 4× ACOG-style — an upward chevron whose tip sits exactly on the aimpoint,
    // a stadia post dropping below with ranging ticks, and horizontal wings.
    const tick = `position:absolute; background:${GREEN}; box-shadow:0 0 2px ${GREEN_GLOW};`;
    const ticks = [22, 40, 58].map((y, i) => {
      const w = 12 - i * 3;
      return `<div style="${tick} left:${-w / 2}px; top:${y}px; width:${w}px; height:2px;"></div>`;
    }).join("");
    return this.anchor(`
      <div style="position:absolute; left:0; top:0; transform:translate(-50%,0);
                  border-left:7px solid transparent; border-right:7px solid transparent; border-bottom:12px solid ${GREEN};
                  filter:drop-shadow(0 0 2px ${GREEN_GLOW});"></div>
      <div style="${tick} left:-1px; top:12px; width:2px; height:52px;"></div>
      ${ticks}
      <div style="${tick} top:-1px; left:-60px; width:44px; height:2px;"></div>
      <div style="${tick} top:-1px; left:16px;  width:44px; height:2px;"></div>
    `);
  }

  private buildMilDot(): HTMLDivElement {
    // 6× marksman — a fine full cross with a mil-dot ranging ladder on both axes.
    const line = `position:absolute; background:${GREEN}; box-shadow:0 0 2px ${GREEN_GLOW};`;
    const dot = `position:absolute; width:3px; height:3px; border-radius:50%; background:${GREEN}; box-shadow:0 0 2px ${GREEN_GLOW};`;
    const offsets = [-84, -64, -44, -24, 24, 44, 64, 84];
    const vDots = offsets.map((y) => `<div style="${dot} left:-1.5px; top:${y - 1.5}px;"></div>`).join("");
    const hDots = offsets.map((x) => `<div style="${dot} top:-1.5px; left:${x - 1.5}px;"></div>`).join("");
    return this.anchor(`
      <div style="${line} left:-0.5px; top:-100px; width:1px; height:88px;"></div>
      <div style="${line} left:-0.5px; top:12px;   width:1px; height:88px;"></div>
      <div style="${line} top:-0.5px; left:-100px; height:1px; width:88px;"></div>
      <div style="${line} top:-0.5px; left:12px;   height:1px; width:88px;"></div>
      ${vDots}${hDots}
    `);
  }

  private buildTree(): HTMLDivElement {
    // 8×+ sniper — a fine cross plus a Christmas-tree holdover grid: rows of
    // windage dots below the aimpoint that widen with drop, for long-range holds.
    const line = `position:absolute; background:${GREEN}; box-shadow:0 0 2px ${GREEN_GLOW};`;
    const dot = `position:absolute; width:2.5px; height:2.5px; border-radius:50%; background:${GREEN}; box-shadow:0 0 2px ${GREEN_GLOW};`;
    // Each row: [vertical offset px, half-width count of windage dots].
    const rows: Array<[number, number]> = [[26, 1], [42, 2], [58, 3], [74, 3], [90, 4]];
    let tree = "";
    for (const [y, n] of rows) {
      for (let i = -n; i <= n; i++) {
        const x = i * 11;
        tree += `<div style="${dot} left:${x - 1.25}px; top:${y - 1.25}px;"></div>`;
      }
    }
    return this.anchor(`
      <div style="${line} left:-0.5px; top:-104px; width:1px; height:92px;"></div>
      <div style="${line} left:-0.5px; top:14px;   width:1px; height:8px;"></div>
      <div style="${line} top:-0.5px; left:-104px; height:1px; width:92px;"></div>
      <div style="${line} top:-0.5px; left:12px;   height:1px; width:92px;"></div>
      <div style="position:absolute; left:-1.5px; top:-1.5px; width:3px; height:3px; border-radius:50%; background:${GREEN}; box-shadow:0 0 3px ${GREEN_GLOW};"></div>
      ${tree}
    `);
  }

  /** Falls back to a zoom-derived family when the optic didn't specify one. */
  private styleFor(kind: OpticKind, zoom: number, reticle?: ReticleStyle): ReticleStyle {
    if (reticle) return reticle;
    if (kind === "reddot") return zoom >= 1.2 ? "holo" : "dot";
    if (zoom >= 8) return "tree";
    if (zoom >= 6) return "mildot";
    if (zoom >= 4) return "chevron";
    return "duplex";
  }

  /** kind selects the optic type; blend is 0..1 ADS progress; zoom + reticle pick the sight picture. */
  update(kind: OpticKind, blend: number, zoom = 1, reticle?: ReticleStyle): void {
    if (kind === "none" || blend <= 0.02) {
      this.root.style.display = "none";
      return;
    }
    this.root.style.display = "block";

    const active = this.styleFor(kind, zoom, reticle);
    for (const [style, el] of Object.entries(this.reticles)) {
      el.style.display = style === active ? "block" : "none";
    }

    if (kind === "scope") {
      const openRadius = this.minDimVmin * 0.75;
      const scopedRadius = this.minDimVmin * 0.36;
      const radius = openRadius + (scopedRadius - openRadius) * blend;
      this.circle.style.width = `${radius * 2}vmin`;
      this.circle.style.height = `${radius * 2}vmin`;
      this.circle.style.boxShadow = `0 0 0 100vmax rgba(2,2,2,${0.92 * blend})`;
      // Reticle fades fully in with the scope-in so it never floats over the hip view.
      this.reticles[active].style.opacity = String(Math.min(1, blend * 1.5));
    } else {
      // reddot / holo — no vignette, just fade the reticle in with ADS.
      this.circle.style.boxShadow = "none";
      this.reticles[active].style.opacity = String(Math.min(1, blend * 1.4));
    }
  }
}
