/**
 * Shared military UI theme — one injected stylesheet that every menu/overlay
 * draws from, so colours, typography, spacing, hover states and transitions
 * stay consistent across the whole interface instead of each screen carrying
 * its own slightly-different inline styles.
 *
 * Palette (matches the in-world SAF green/olive look):
 *   bg      #0c120b   panel   #10160f   inset  #0a120a
 *   line    #3c4a34   accent  #9fc78a   green  #4a7a3c
 *   text    #d7e8d0   dim     #8fa585   gold   #e0c15a   red #c0392b
 */

export const THEME = {
  font: `Consolas, "Courier New", monospace`,
  text: "#d7e8d0",
  dim: "#8fa585",
  accent: "#9fc78a",
  green: "#4a7a3c",
  gold: "#e0c15a",
  red: "#c0392b",
  line: "#3c4a34",
  panel: "#10160f",
  inset: "#0a120a",
} as const;

let injected = false;

/** Idempotent — safe to call from every component's constructor. */
export function injectTheme(): void {
  if (injected || document.getElementById("mil-theme")) return;
  injected = true;
  const style = document.createElement("style");
  style.id = "mil-theme";
  style.textContent = `
    .mil-overlay {
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(5, 10, 5, 0.78);
      font-family: ${THEME.font}; color: ${THEME.text};
      animation: milFade 0.14s ease-out;
    }
    @keyframes milFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes milRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .mil-panel {
      background: linear-gradient(160deg, #121a11, ${THEME.panel});
      border: 1px solid ${THEME.line};
      border-top: 2px solid ${THEME.green};
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.65);
      border-radius: 3px;
      padding: 20px 24px;
      animation: milRise 0.16s ease-out;
      box-sizing: border-box;
    }

    .mil-title {
      font-size: clamp(16px, 2.2vw, 21px); font-weight: bold; letter-spacing: 3px;
      color: #eef5e8; text-transform: uppercase;
    }
    .mil-title::before { content: "// "; color: ${THEME.green}; }
    .mil-kicker {
      font-size: 11px; letter-spacing: 2px; color: ${THEME.accent}; text-transform: uppercase;
      margin-bottom: 6px;
    }

    .mil-btn {
      background: rgba(42, 51, 36, 0.5); color: #eaf0e6;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-left: 3px solid transparent;
      padding: 7px 14px; font-family: inherit; font-size: 13px; cursor: pointer;
      border-radius: 2px; letter-spacing: 0.4px;
      transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
    }
    .mil-btn:hover:not(:disabled) {
      background: rgba(74, 122, 60, 0.45); border-left-color: ${THEME.accent};
    }
    .mil-btn:active:not(:disabled) { transform: translateY(1px); }
    .mil-btn:disabled { opacity: 0.45; cursor: default; }

    .mil-btn-primary { background: #3c6b32; border-left-color: ${THEME.accent}; }
    .mil-btn-primary:hover:not(:disabled) { background: ${THEME.green}; }
    .mil-btn-danger { background: #5a2c26; }
    .mil-btn-danger:hover:not(:disabled) { background: #6b3232; border-left-color: #e08a6a; }
    .mil-btn-active { background: ${THEME.green}; border-left-color: ${THEME.accent}; }

    .mil-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px;
      border: 1px solid #23291f; border-radius: 2px;
      background: rgba(10, 18, 10, 0.35);
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .mil-row:hover { background: rgba(30, 42, 26, 0.5); border-color: ${THEME.line}; }

    .mil-inset {
      background: ${THEME.inset}; border: 1px solid #2c3a26; border-radius: 2px;
      padding: 12px 14px;
    }

    .mil-hr { border: none; border-top: 1px solid #23291f; margin: 14px 0; }

    input[type="range"].mil-slider {
      -webkit-appearance: none; appearance: none; width: 100%; height: 4px;
      background: #23291f; border-radius: 2px; outline: none;
    }
    input[type="range"].mil-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
      background: ${THEME.accent}; border-radius: 2px; cursor: pointer;
      transition: background 0.12s ease;
    }
    input[type="range"].mil-slider::-webkit-slider-thumb:hover { background: #c6e6b0; }
  `;
  document.head.appendChild(style);
}
