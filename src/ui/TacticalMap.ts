import type { PlayerController } from "@/player/PlayerController";
import type { BuildingFootprint } from "@/world/Level";
import { CAMP_POSITION } from "@/world/Level";
import type { EnemyIntel } from "@/enemies/EnemySpawner";
import { injectTheme } from "@/ui/theme";
import { SAF } from "@/ui/saf";

const WORLD_SPAN = 200; // map covers roughly ±100m
/**
 * Metres per lettered/numbered map square. Matches StrikeTargeting's grid so a
 * player can read a reference off this map and call a fire mission by it — the
 * two boards speak the same language instead of each inventing a coordinate
 * system.
 */
const GRID_SQUARE_M = 20;

/**
 * Full-screen tactical map (toggled with M). Draws the street grid, the base,
 * the player (with facing), confirmed enemy contacts (solid red), and
 * suspected/last-known contacts (hollow amber diamonds). Contacts refresh
 * each frame it's open from EnemyManager.intel().
 */
export class TacticalMap {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  visible = false;

  constructor(
    container: HTMLElement,
    private readonly buildingLayout: BuildingFootprint[]
  ) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-overlay";
    this.root.style.cssText = "background: rgba(4,8,6,0.92); z-index: 40;";

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:10px;";

    const title = document.createElement("div");
    title.textContent = "TACTICAL MAP";
    title.className = "mil-title";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = `border:1px solid ${SAF.line}; border-top:2px solid ${SAF.olive}; border-radius:0; background:${SAF.inset}; max-width:92vw; max-height:78vh;`;
    this.ctx = this.canvas.getContext("2d")!;
    // Call-in targeting lives in StrikeTargeting now — this map is view-only.

    const legend = document.createElement("div");
    legend.style.cssText = `font-size:10px; letter-spacing:1.5px; display:flex; gap:20px; color:${SAF.textDim};`;
    legend.innerHTML = `
      <span style="color:${SAF.sage};">▲ OWN POSITION</span>
      <span style="color:#8f4a34;">■ CONFIRMED CONTACT</span>
      <span style="color:#8a7a4a;">◇ SUSPECTED</span>
      <span style="color:${SAF.sage};">▣ BASE</span>
      <span style="color:${SAF.textFaint};">M TO CLOSE</span>
    `;

    panel.appendChild(title);
    panel.appendChild(this.canvas);
    panel.appendChild(legend);
    this.root.appendChild(panel);
    container.appendChild(this.root);
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "flex";
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.82;
    this.canvas.width = size;
    this.canvas.height = size;
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  /** Redraw with the latest player position/facing and enemy intel. */
  update(player: PlayerController, intel: EnemyIntel[]): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    const size = this.canvas.width;
    const scale = size / WORLD_SPAN;
    const toX = (wx: number) => size / 2 + wx * scale;
    const toY = (wz: number) => size / 2 - wz * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#121a10";
    ctx.fillRect(0, 0, size, size);

    // Lettered/numbered map squares, drawn like a printed chart.
    ctx.strokeStyle = "rgba(120,140,100,0.14)";
    ctx.lineWidth = 1;
    for (let g = -100; g <= 100; g += GRID_SQUARE_M) {
      ctx.beginPath(); ctx.moveTo(toX(g), 0); ctx.lineTo(toX(g), size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toY(g)); ctx.lineTo(size, toY(g)); ctx.stroke();
    }
    const squarePx = GRID_SQUARE_M * scale;
    const squares = Math.floor(WORLD_SPAN / GRID_SQUARE_M);
    ctx.fillStyle = "rgba(150,168,130,0.4)";
    ctx.font = "9px \"DejaVu Sans Mono\", Consolas, monospace";
    for (let i = 0; i < squares; i++) {
      ctx.textAlign = "center";
      ctx.fillText(String.fromCharCode(65 + i), i * squarePx + squarePx / 2, 11);
      ctx.textAlign = "left";
      ctx.fillText(String(i + 1), 3, i * squarePx + squarePx / 2 + 3);
    }
    ctx.textAlign = "start";

    // Buildings.
    ctx.fillStyle = "rgba(126,136,108,0.62)";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    for (const b of this.buildingLayout) {
      const w = b.size * scale;
      ctx.fillRect(toX(b.x) - w / 2, toY(b.z) - w / 2, w, w);
      ctx.strokeRect(toX(b.x) - w / 2, toY(b.z) - w / 2, w, w);
    }

    // Base marker.
    const baseR = 12 * scale;
    ctx.fillStyle = "rgba(74,97,53,0.22)";
    ctx.strokeStyle = SAF.sage;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(toX(CAMP_POSITION.x) - baseR, toY(CAMP_POSITION.z) - baseR, baseR * 2, baseR * 2);
    ctx.fill();
    ctx.stroke();

    // Suspected contacts (draw first so confirmed sit on top).
    for (const c of intel) {
      if (c.status !== "suspected") continue;
      const x = toX(c.x), y = toY(c.z), r = 6;
      ctx.strokeStyle = "#8a7a4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.stroke();
    }
    // Confirmed contacts.
    for (const c of intel) {
      if (c.status !== "confirmed") continue;
      // Standard filled-square hostile symbol, matching the targeting board.
      ctx.fillStyle = "#8f4a34";
      ctx.fillRect(toX(c.x) - 4, toY(c.z) - 4, 8, 8);
    }

    // Player triangle (rotated to facing).
    const px = toX(player.position.x), py = toY(player.position.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(player.yaw);
    ctx.fillStyle = SAF.sage;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(-6, 7);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
