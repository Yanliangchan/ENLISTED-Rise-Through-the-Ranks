import type { BottyCommand } from "@/companion/Botty";
import { injectTheme } from "@/ui/theme";

interface WheelEntry {
  command: BottyCommand;
  label: string;
  description: string;
}

const ENTRIES: WheelEntry[] = [
  { command: "followMe", label: "Follow Me", description: "Stay close, match my pace, hold formation." },
  { command: "coverMe", label: "Cover Me", description: "Suppress whoever's engaging me so I can move." },
  { command: "engage", label: "Engage", description: "Push and attack every detected threat." },
  { command: "retreat", label: "Retreat", description: "Smoke the threat and fall back to base." },
  { command: "goDark", label: "Go Dark", description: "Hold fire, stay hidden, follow quietly." },
];

const RADIUS = 118;

/**
 * Radial command menu for BOTTY (Q key). Exits pointer lock while open so the
 * real cursor can hover/click a wedge — same pattern as the tactical map and
 * armoury, which already unlock/relock around their own overlays.
 */
export class CommandWheel {
  private root: HTMLDivElement;
  visible = false;
  onSelect?: (command: BottyCommand) => void;
  onClose?: () => void;

  constructor(container: HTMLElement) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; display: none; z-index: 25;
      background: rgba(4,8,6,0.35); font-family: Consolas, "Courier New", monospace;
    `;

    const center = document.createElement("div");
    center.style.cssText = `
      position: absolute; top: 50%; left: 50%; width: ${RADIUS * 2 + 90}px; height: ${RADIUS * 2 + 90}px;
      transform: translate(-50%, -50%);
    `;

    const hub = document.createElement("div");
    hub.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 84px; height: 84px; border-radius: 50%;
      background: rgba(10,16,10,0.9); border: 1px solid #3c4a34;
      display: flex; align-items: center; justify-content: center; text-align: center;
      color: #9fc78a; font-size: 11px; padding: 6px; box-sizing: border-box;
    `;
    hub.textContent = "BOTTY";

    const desc = document.createElement("div");
    desc.style.cssText = `
      position: absolute; top: 100%; left: 50%; transform: translate(-50%, 14px);
      width: 260px; text-align: center; color: #d7e8d0; font-size: 13px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
    `;

    center.appendChild(hub);
    center.appendChild(desc);

    const n = ENTRIES.length;
    ENTRIES.forEach((entry, i) => {
      // Start at the top (-90deg) and go clockwise.
      const angle = (-Math.PI / 2) + (i / n) * Math.PI * 2;
      const x = Math.cos(angle) * RADIUS;
      const y = Math.sin(angle) * RADIUS;

      const wedge = document.createElement("button");
      wedge.textContent = entry.label;
      wedge.style.cssText = `
        position: absolute; top: 50%; left: 50%;
        transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px));
        width: 96px; height: 52px; border-radius: 4px;
        background: rgba(20,28,18,0.92); border: 1px solid #3c4a34; color: #d7e8d0;
        font-family: inherit; font-size: 12px; font-weight: bold; cursor: pointer;
        display: flex; align-items: center; justify-content: center; text-align: center;
        padding: 4px; letter-spacing: 0.4px;
        transition: background 0.1s ease, border-color 0.1s ease, transform 0.1s ease;
      `;
      wedge.onmouseenter = () => {
        wedge.style.background = "#4a7a3c";
        wedge.style.borderColor = "#9fc78a";
        wedge.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1.06)`;
        desc.textContent = entry.description;
      };
      wedge.onmouseleave = () => {
        wedge.style.background = "rgba(20,28,18,0.92)";
        wedge.style.borderColor = "#3c4a34";
        wedge.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      };
      wedge.onclick = () => {
        this.onSelect?.(entry.command);
        this.close();
      };
      center.appendChild(wedge);
    });

    this.root.appendChild(center);
    container.appendChild(this.root);

    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.visible) this.close();
    });
  }

  open(): void {
    this.visible = true;
    this.root.style.display = "block";
    document.exitPointerLock();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = "none";
    this.onClose?.();
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }
}
