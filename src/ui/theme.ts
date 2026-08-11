import { SAF, safCamoDataUrl, safFabricDataUrl, safWearDataUrl } from "@/ui/saf";

/**
 * Shared SAF field-equipment UI theme — one injected stylesheet every
 * menu/overlay draws from.
 *
 * The design brief is a military equipment and training interface, not a
 * spaceship computer: flat panels, thin borders, muted olive/forest greens,
 * condensed uppercase labelling, and a subtle camouflage texture behind the
 * major surfaces. There is deliberately no glow, no glassmorphism, no heavy
 * rounding and no cyan — signal colour is limited to amber and red, and only
 * where the player genuinely needs to be alerted.
 */

export const THEME = {
  font: SAF.fontUi,
  mono: SAF.fontMono,
  text: SAF.text,
  dim: SAF.textDim,
  accent: SAF.sage,
  green: SAF.green,
  gold: SAF.amber,
  red: SAF.red,
  line: SAF.line,
  panel: SAF.panel,
  inset: SAF.inset,
} as const;

let injected = false;

/** Idempotent — safe to call from every component's constructor. */
export function injectTheme(): void {
  if (injected || document.getElementById("mil-theme")) return;
  injected = true;
  const camo = safCamoDataUrl();
  const fabric = safFabricDataUrl();
  const wear = safWearDataUrl();
  const style = document.createElement("style");
  style.id = "mil-theme";
  style.textContent = `
    .mil-overlay {
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(7, 10, 6, 0.86);
      font-family: ${SAF.fontUi}; color: ${SAF.text};
      animation: milFade 0.12s linear;
    }
    @keyframes milFade { from { opacity: 0; } to { opacity: 1; } }

    /*
     * Panels are painted metal / stencilled board: flat fill, hard edges, a
     * washed-out camo backing and a fabric tooth over the top. The top edge
     * carries a single olive rule the way issued equipment carries a printed
     * band — the only ornament on the panel.
     */
    .mil-panel {
      position: relative;
      background-color: ${SAF.panel};
      background-image:
        linear-gradient(rgba(17, 23, 16, 0.93), rgba(13, 18, 12, 0.95)),
        url("${camo}");
      background-size: auto, 200px 200px;
      background-repeat: no-repeat, repeat;
      border: 1px solid ${SAF.line};
      border-top: 3px solid ${SAF.olive};
      box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
      border-radius: 0;
      padding: 18px 22px;
      box-sizing: border-box;
    }
    /* Fabric weave + dust, so the surface never reads as flat vector UI. */
    .mil-panel::after {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      background-image: url("${fabric}"), url("${wear}");
      background-size: 64px 64px, 256px 256px;
      opacity: 0.16;
    }
    .mil-panel > * { position: relative; z-index: 1; }

    .mil-title {
      font-size: clamp(15px, 2vw, 19px); font-weight: 700; letter-spacing: 3px;
      color: ${SAF.text}; text-transform: uppercase;
    }
    /* Stencil-style rule instead of the old "// " sci-fi prefix. */
    .mil-title::after {
      content: ""; display: block; width: 42px; height: 2px;
      background: ${SAF.olive}; margin-top: 6px;
    }
    .mil-kicker {
      font-size: 10px; letter-spacing: 2.5px; color: ${SAF.textDim}; text-transform: uppercase;
      margin-bottom: 6px;
    }
    /* Small uppercase field label — the workhorse for equipment captions. */
    .mil-label {
      font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: ${SAF.textFaint};
    }
    .mil-value { font-family: ${SAF.fontMono}; color: ${SAF.text}; }

    /*
     * Buttons: stamped plates. Square corners, a hard olive left edge that
     * fills in on hover, no glow and no lift animation.
     */
    .mil-btn {
      background: ${SAF.panelHi}; color: ${SAF.text};
      border: 1px solid ${SAF.line};
      border-left: 3px solid ${SAF.line};
      padding: 7px 14px; font-family: inherit; font-size: 12px; cursor: pointer;
      border-radius: 0; letter-spacing: 1.4px; text-transform: uppercase;
      transition: background 0.1s linear, border-color 0.1s linear, color 0.1s linear;
    }
    .mil-btn:hover:not(:disabled) { background: #24301e; border-left-color: ${SAF.olive}; }
    .mil-btn:active:not(:disabled) { background: #1a2415; }
    .mil-btn:disabled { opacity: 0.4; cursor: default; }

    .mil-btn-primary { background: ${SAF.green}; border-color: #5c7543; border-left-color: ${SAF.sage}; color: #eef2e4; }
    .mil-btn-primary:hover:not(:disabled) { background: #56703d; border-left-color: ${SAF.sage}; }
    .mil-btn-danger { background: #4a231b; border-left-color: #7a3a2c; }
    .mil-btn-danger:hover:not(:disabled) { background: #5a2c22; border-left-color: ${SAF.red}; }
    .mil-btn-active { background: ${SAF.olive}; border-left-color: ${SAF.sage}; color: #f0f4e6; }

    /* Manifest row — a line item on a kit list. */
    .mil-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px;
      border: 1px solid #232c1d; border-radius: 0;
      background: rgba(12, 17, 11, 0.6);
      transition: background 0.1s linear, border-color 0.1s linear;
    }
    .mil-row:hover { background: rgba(28, 37, 25, 0.7); border-color: ${SAF.line}; }

    .mil-inset {
      background: ${SAF.inset}; border: 1px solid #26301f; border-radius: 0;
      padding: 12px 14px;
    }

    .mil-hr { border: none; border-top: 1px solid #232c1d; margin: 14px 0; }

    /* Stencilled tag — issue markings, status chips. Use sparingly. */
    .mil-tag {
      display: inline-block; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
      padding: 2px 7px; border: 1px solid ${SAF.line}; color: ${SAF.textDim};
    }
    .mil-tag-on { color: ${SAF.sage}; border-color: ${SAF.olive}; }
    .mil-tag-warn { color: ${SAF.amber}; border-color: #6d5a1b; }
    .mil-tag-off { color: ${SAF.textFaint}; }

    input[type="range"].mil-slider {
      -webkit-appearance: none; appearance: none; width: 100%; height: 3px;
      background: #2a3323; border-radius: 0; outline: none;
    }
    input[type="range"].mil-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none; width: 12px; height: 16px;
      background: ${SAF.olive}; border: 1px solid ${SAF.lineHi}; border-radius: 0; cursor: pointer;
    }
    input[type="range"].mil-slider::-webkit-slider-thumb:hover { background: ${SAF.sage}; }
  `;
  document.head.appendChild(style);
}
