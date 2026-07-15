import type { PlayerController } from "@/player/PlayerController";
import type { BuildingFootprint } from "@/world/Level";
import { CAMP_POSITION } from "@/world/Level";
import type { EnemyIntel } from "@/enemies/EnemySpawner";

const WORLD_SPAN = 200; // map covers roughly ±100m

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
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 40; display: none;
      background: rgba(4,8,6,0.92); align-items: center; justify-content: center;
      font-family: Consolas, "Courier New", monospace; color: #cfe6c8;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:10px;";

    const title = document.createElement("div");
    title.textContent = "TACTICAL MAP";
    title.style.cssText = "font-size:20px; font-weight:bold; letter-spacing:3px; color:#9fc78a;";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "border:1px solid #3c4a34; background:#0c130c;";
    this.ctx = this.canvas.getContext("2d")!;

    const legend = document.createElement("div");
    legend.style.cssText = "font-size:13px; display:flex; gap:22px; color:#b8ccb0;";
    legend.innerHTML = `
      <span style="color:#8fe08f;">▲ You</span>
      <span style="color:#ff5540;">● Confirmed contact</span>
      <span style="color:#e0a53a;">◇ Suspected (last known)</span>
      <span style="color:#9fc78a;">▣ Base</span>
      <span style="color:#8a8f82;">Press M to close</span>
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
    ctx.fillStyle = "#0c130c";
    ctx.fillRect(0, 0, size, size);

    // Grid.
    ctx.strokeStyle = "rgba(120,150,110,0.12)";
    ctx.lineWidth = 1;
    for (let g = -100; g <= 100; g += 20) {
      ctx.beginPath(); ctx.moveTo(toX(g), 0); ctx.lineTo(toX(g), size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toY(g)); ctx.lineTo(size, toY(g)); ctx.stroke();
    }

    // Buildings.
    ctx.fillStyle = "rgba(150,160,140,0.4)";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    for (const b of this.buildingLayout) {
      const w = b.size * scale;
      ctx.fillRect(toX(b.x) - w / 2, toY(b.z) - w / 2, w, w);
      ctx.strokeRect(toX(b.x) - w / 2, toY(b.z) - w / 2, w, w);
    }

    // Base marker.
    const baseR = 12 * scale;
    ctx.fillStyle = "rgba(80,150,90,0.25)";
    ctx.strokeStyle = "#9fc78a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(toX(CAMP_POSITION.x) - baseR, toY(CAMP_POSITION.z) - baseR, baseR * 2, baseR * 2);
    ctx.fill();
    ctx.stroke();

    // Suspected contacts (draw first so confirmed sit on top).
    for (const c of intel) {
      if (c.status !== "suspected") continue;
      const x = toX(c.x), y = toY(c.z), r = 6;
      ctx.strokeStyle = "#e0a53a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.stroke();
    }
    // Confirmed contacts.
    for (const c of intel) {
      if (c.status !== "confirmed") continue;
      ctx.fillStyle = "#ff5540";
      ctx.beginPath();
      ctx.arc(toX(c.x), toY(c.z), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player triangle (rotated to facing).
    const px = toX(player.position.x), py = toY(player.position.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(player.yaw);
    ctx.fillStyle = "#8fe08f";
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(-6, 7);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
