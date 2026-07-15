const BINDINGS: Array<[string, string]> = [
  ["W A S D", "Move"],
  ["Shift", "Sprint"],
  ["Ctrl", "Crouch (deploy bipod if fitted)"],
  ["Space", "Jump"],
  ["Mouse", "Look"],
  ["Left Click", "Fire"],
  ["Right Click", "Aim down sights"],
  ["R", "Reload"],
  ["G", "Throw equipped throwable"],
  ["H", "Fire underbarrel M203 (if fitted)"],
  ["F", "Collect supply crate (ammo/health)"],
  ["1 / 2 / 3 / 4", "Primary / Secondary / Special / Throwable"],
  ["Mouse Wheel", "Cycle equipped slots"],
  ["B", "Open armoury (between waves)"],
  ["M", "Tactical map"],
  ["Tab", "Toggle controls list"],
  ["Escape", "Pause / settings"],
];

/**
 * Full-screen title/briefing page shown before anything else — story, the
 * mission objective, and the full control scheme, gated behind a DEPLOY
 * button so the intro phase and Pointer Lock don't start until the player
 * is actually ready.
 */
export class LandingPage {
  private root: HTMLDivElement;
  visible = true;
  onDeploy?: () => void;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at center, #1a2318 0%, #0a0d08 100%);
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
      overflow-y: auto; padding: 40px 20px;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
      width: min(820px, 94vw); background: rgba(10,16,10,0.9);
      border: 1px solid #3c4a34; box-shadow: 0 0 60px rgba(0,0,0,0.7);
      padding: 32px 40px 40px;
    `;

    const title = document.createElement("div");
    title.textContent = "OPERATION SENTINEL SHIELD";
    title.style.cssText = `
      font-size: 32px; font-weight: bold; letter-spacing: 3px; text-align: center;
      color: #eaf0e6; text-shadow: 0 0 12px rgba(120,180,100,0.4);
    `;
    const subtitle = document.createElement("div");
    subtitle.textContent = "SINGAPORE ARMED FORCES — HOMELAND DEFENCE";
    subtitle.style.cssText = "font-size: 13px; letter-spacing: 2px; text-align: center; color: #9fc78a; margin-top: 6px; margin-bottom: 26px;";

    const storyHeading = sectionHeading("SITUATION REPORT");
    const story = document.createElement("div");
    story.style.cssText = "font-size: 14px; line-height: 1.7; color: #c8d6c0; margin-bottom: 22px;";
    story.innerHTML = `
      <p>In the near future, an unnamed hostile coalition — designated <strong>OPFOR</strong>
      throughout — launches a surprise multi-axis assault on Singapore. Amphibious and airborne
      elements strike at dawn, seizing coastal sectors, an industrial port, and pushing inland
      toward the urban estates. The Singapore Armed Forces mobilise within hours.</p>
      <p>You are an SAF infantryman thrown into the defence, issued standard kit — a
      <strong>SAR 21</strong> rifle and an <strong>H&amp;K P30</strong> sidearm — and dug in at a
      concealed forward deployment point on the sector's edge. As you hold the line, credits
      recovered from cleared ground let you resupply at the <strong>Field Armoury</strong>,
      drawing progressively heavier weapons, optics, and gear as the battle escalates:</p>
      <p style="color:#e0c15a; margin-left: 12px;">
        Waves 1&ndash;4 — <em>Defence</em>: hold the urban strongpoint.<br>
        Waves 5&ndash;9 — <em>Holding action</em>: marksmen and heavier OPFOR probe your lines.<br>
        Waves 10&ndash;14 — <em>Counter-attack</em>: heavies push hard; the MATADOR earns its keep.<br>
        Wave 15+ — <em>Retake</em>: escalating boss waves as you push OPFOR back out.
      </p>
    `;

    const objectiveHeading = sectionHeading("MISSION OBJECTIVE");
    const objective = document.createElement("div");
    objective.style.cssText = "font-size: 14px; line-height: 1.7; color: #c8d6c0; margin-bottom: 22px;";
    objective.innerHTML = `
      <p>Survive as many waves as you can. Every kill and every wave cleared banks credits —
      spend them at the Field Armoury (press <strong>B</strong>, or wait for it to open
      automatically between waves) on new weapons, attachments, throwables, and armour. Scout the
      sector during the 30-second window before Wave 1 forms up. Hidden supply crates tucked
      around the map top up ammo and health — worth the detour. If you go down, your credits and
      unlocks are kept; you redeploy from the camp and can re-gear before the next wave.</p>
    `;

    const controlsHeading = sectionHeading("CONTROLS");
    const controlsGrid = document.createElement("div");
    controlsGrid.style.cssText = "display:grid; grid-template-columns: auto 1fr; gap: 4px 20px; font-size: 13px; margin-bottom: 28px;";
    for (const [key, desc] of BINDINGS) {
      const keyEl = document.createElement("div");
      keyEl.textContent = key;
      keyEl.style.cssText = "color:#e0c15a; white-space:nowrap;";
      const descEl = document.createElement("div");
      descEl.textContent = desc;
      descEl.style.cssText = "color:#c8d6c0;";
      controlsGrid.appendChild(keyEl);
      controlsGrid.appendChild(descEl);
    }

    const deployBtn = document.createElement("button");
    deployBtn.textContent = "DEPLOY";
    deployBtn.style.cssText = `
      display: block; margin: 0 auto; background:#3c6b32; color:#eaf0e6;
      border:1px solid rgba(255,255,255,0.2); padding:14px 48px;
      font-family:inherit; font-size:18px; font-weight:bold; letter-spacing:2px; cursor:pointer;
    `;
    deployBtn.onclick = () => {
      this.hide();
      this.onDeploy?.();
    };

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(storyHeading);
    panel.appendChild(story);
    panel.appendChild(objectiveHeading);
    panel.appendChild(objective);
    panel.appendChild(controlsHeading);
    panel.appendChild(controlsGrid);
    panel.appendChild(deployBtn);
    this.root.appendChild(panel);
    container.appendChild(this.root);
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }
}

function sectionHeading(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = "font-size: 14px; font-weight: bold; letter-spacing: 2px; color: #9fc78a; border-bottom: 1px solid #2a3324; padding-bottom: 6px; margin-bottom: 10px;";
  return el;
}
