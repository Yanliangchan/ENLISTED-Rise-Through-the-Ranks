import { safCamoDataUrl, safFabricDataUrl, SAF } from "@/ui/saf";

/**
 * All landing-page CSS, injected once. Class names are prefixed `lp-` so
 * nothing collides with in-game HUD styles. Animations are transform/opacity
 * only (compositor-friendly) and everything heavy is gated behind
 * `prefers-reduced-motion`.
 */
let injected = false;

export function injectLandingStyles(): void {
  if (injected) return;
  injected = true;
  const camo = safCamoDataUrl();
  const fabric = safFabricDataUrl();
  const style = document.createElement("style");
  style.id = "lp-styles";
  style.textContent = `
:root { --lp-mx: 0; --lp-my: 0; }

.lp-root {
  position: fixed; inset: 0; z-index: 50; overflow: hidden;
  background: #030604;
  font-family: ${SAF.fontUi};
  color: ${SAF.text};
  user-select: none;
  transition: opacity 0.9s ease;
}
.lp-root.lp-exit { opacity: 0; pointer-events: none; }

/* Outer wrap takes the hover "camera zoom", inner wrap the slow breathing. */
.lp-zoom {
  position: absolute; inset: 0;
  transition: transform 1.1s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.lp-zoom.lp-zoomed { transform: scale(1.016); }
.lp-breathe {
  position: absolute; inset: 0;
  animation: lp-breathe 9s ease-in-out infinite;
  will-change: transform;
}
@keyframes lp-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.007); }
}

.lp-bg-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

/* --- Grade overlays. The old CRT scanline/interference/flicker stack read as
   a sci-fi terminal; what replaces it is a fabric tooth and a plain vignette,
   so the page looks like printed material under field light. --- */
.lp-scanlines {
  position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background-image: url(${fabric});
  background-size: 64px 64px;
  opacity: 0.14;
}
.lp-vignette {
  position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(3, 6, 3, 0.78) 100%);
}
.lp-interference { display: none; }
.lp-flicker { }

/* --- HUD chrome --- */
.lp-hud { position: absolute; inset: 0; pointer-events: none; z-index: 10; font-size: 11px; letter-spacing: 1px; }
.lp-hud-panel {
  position: absolute; padding: 10px 14px; line-height: 1.7;
  color: ${SAF.textDim};
  background: rgba(10, 15, 9, 0.8);
  border: 1px solid rgba(80, 96, 66, 0.4);
  transform: translate3d(calc(var(--lp-mx) * var(--lp-tilt, 6px)), calc(var(--lp-my) * var(--lp-tilt, 6px)), 0);
  will-change: transform;
}
.lp-hud-panel .lp-hud-strong { color: ${SAF.text}; }
.lp-hud-panel .lp-hud-dim { color: ${SAF.textFaint}; }
.lp-hud-title { font-size: 11px; letter-spacing: 2.5px; color: ${SAF.sage}; margin-bottom: 4px; }
.lp-hud-tl { top: 18px; left: 20px; --lp-tilt: 7px; }
.lp-hud-tr { top: 18px; right: 20px; text-align: right; --lp-tilt: -7px; }
.lp-hud-bl { bottom: 46px; left: 20px; max-width: 330px; --lp-tilt: 5px; }
.lp-hud-br { bottom: 46px; right: 20px; text-align: right; --lp-tilt: -5px; display: flex; gap: 12px; align-items: flex-end; }

.lp-classification {
  position: absolute; top: 0; left: 0; right: 0; height: 18px; z-index: 11;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; letter-spacing: 6px; color: ${SAF.tan};
  background: rgba(16, 14, 8, 0.85); border-bottom: 1px solid rgba(140, 122, 78, 0.3);
  pointer-events: none;
}
.lp-threat { color: ${SAF.amber}; }

.lp-signal { display: inline-flex; gap: 2px; align-items: flex-end; height: 10px; margin-left: 6px; }
.lp-signal i { width: 3px; background: ${SAF.sage}; display: block; }
.lp-signal i.lp-sig-off { background: #2d3728; }

.lp-corner { position: absolute; width: 34px; height: 34px; z-index: 10; pointer-events: none; opacity: 0.7; }
.lp-corner::before, .lp-corner::after { content: ""; position: absolute; background: rgba(120, 138, 100, 0.45); }
.lp-corner::before { width: 100%; height: 1px; }
.lp-corner::after { width: 1px; height: 100%; }
.lp-corner-tl { top: 26px; left: 12px; }
.lp-corner-tr { top: 26px; right: 12px; transform: scaleX(-1); }
.lp-corner-bl { bottom: 12px; left: 12px; transform: scaleY(-1); }
.lp-corner-br { bottom: 12px; right: 12px; transform: scale(-1); }

.lp-compass {
  position: absolute; top: 30px; left: 50%; transform: translateX(-50%); z-index: 10;
  width: min(420px, 46vw); height: 26px; overflow: hidden; pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}
.lp-compass-strip {
  position: absolute; top: 0; height: 100%; white-space: nowrap;
  font-size: 10px; color: ${SAF.textDim}; letter-spacing: 0;
  will-change: transform;
}
.lp-compass-tick { display: inline-block; width: 44px; text-align: center; border-left: 1px solid rgba(120, 140, 100, 0.25); padding-top: 8px; }
.lp-compass-needle {
  position: absolute; left: 50%; top: 0; width: 1px; height: 100%;
  background: ${SAF.sage};
}

.lp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 26px; z-index: 11;
  display: flex; align-items: center; overflow: hidden; pointer-events: none;
  background: rgba(9, 13, 8, 0.86); border-top: 1px solid rgba(80, 96, 66, 0.35);
  font-size: 10px; color: ${SAF.textFaint}; letter-spacing: 1px;
}
.lp-ticker-inner { white-space: nowrap; animation: lp-ticker 48s linear infinite; will-change: transform; padding-left: 100vw; }
@keyframes lp-ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

/* --- Content / hero --- */
.lp-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; z-index: 8; scrollbar-width: thin; scrollbar-color: #3c4a34 transparent; }
.lp-hero {
  min-height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  padding: 70px 20px 60px; box-sizing: border-box; position: relative;
}

.lp-kicker {
  font-size: 11px; letter-spacing: 7px; color: ${SAF.textDim}; margin-bottom: 18px;
  display: flex; align-items: center; gap: 14px;
}
.lp-kicker::before, .lp-kicker::after { content: ""; width: 56px; height: 1px; background: linear-gradient(90deg, transparent, rgba(120, 138, 100, 0.6)); }
.lp-kicker::after { transform: scaleX(-1); }

.lp-title {
  font-family: "Arial Narrow", Impact, "Franklin Gothic Bold", sans-serif;
  font-size: clamp(64px, 15vw, 178px); font-weight: 700;
  line-height: 0.94; margin: 0; letter-spacing: 0.13em; padding-left: 0.13em;
  /* The camo IS the title fill — the pattern is the identity, so it gets the
     largest surface on the page. Washed just enough to stay legible. */
  background-image: linear-gradient(180deg, rgba(206, 216, 192, 0.34) 10%, rgba(112, 132, 100, 0.42) 80%), url(${camo});
  background-size: auto, 215px 215px;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(8, 14, 8, 0.95));
  transform: translate3d(calc(var(--lp-mx) * -8px), calc(var(--lp-my) * -5px), 0);
  will-change: transform;
}
.lp-title-in { animation: lp-title-in 1.1s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes lp-title-in {
  0% { opacity: 0; letter-spacing: 0.3em; }
  100% { opacity: 1; letter-spacing: 0.13em; }
}

.lp-slogan {
  margin-top: 20px; font-size: clamp(13px, 2vw, 19px); letter-spacing: 0.52em; padding-left: 0.52em;
  color: ${SAF.textDim};
}
.lp-slogan span { opacity: 0; display: inline-block; animation: lp-letter-in 0.5s ease both; }
@keyframes lp-letter-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Spec strip: three tactical readout chips under the slogan. */
.lp-specs { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; }
.lp-spec {
  display: inline-flex; align-items: baseline; gap: 8px;
  font-size: 10px; letter-spacing: 2.4px; color: ${SAF.text};
  padding: 6px 12px;
  border: 1px solid rgba(90, 108, 72, 0.5);
  background: rgba(14, 20, 12, 0.8);
}
.lp-spec b { font-weight: 700; font-size: 9px; letter-spacing: 2px; color: ${SAF.textFaint}; }

.lp-subline { margin-top: 16px; font-size: 12px; letter-spacing: 3px; color: ${SAF.textFaint}; min-height: 36px; line-height: 1.6; }

/* Unofficial-project notice — quiet, but backed so it stays legible over
   the animated skyline behind the hero. */
.lp-disclaimer {
  margin-top: 22px; max-width: 60ch;
  font-size: 10px; letter-spacing: 1.3px; line-height: 1.7;
  color: ${SAF.textDim}; text-transform: uppercase;
  padding: 8px 14px;
  background: rgba(9, 13, 8, 0.82);
  border: 1px solid rgba(80, 96, 66, 0.4);
}
.lp-cursor { display: inline-block; width: 7px; height: 12px; background: ${SAF.sage}; margin-left: 3px; vertical-align: -1px; animation: lp-blink 1.05s steps(1) infinite; }
@keyframes lp-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

/* --- Deploy button --- */
.lp-deploy-wrap { margin-top: 44px; position: relative; }
.lp-deploy {
  position: relative; overflow: hidden; cursor: pointer;
  font-family: inherit; letter-spacing: 6px; padding: 0;
  background: rgba(28, 38, 24, 0.92);
  border: 1px solid ${SAF.olive}; border-left: 4px solid ${SAF.olive};
  color: ${SAF.text}; width: min(340px, 82vw); height: 72px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  transition: background 0.12s linear, border-color 0.12s linear;
}
.lp-deploy::before {
  content: ""; position: absolute; inset: 0;
  background: url(${camo}); background-size: 150px 150px; opacity: 0.3;
}
.lp-deploy:hover, .lp-deploy:focus-visible {
  background: rgba(40, 54, 34, 0.95); border-color: ${SAF.sage}; outline: none;
}
.lp-deploy:active { background: rgba(22, 30, 18, 0.95); }
.lp-deploy .lp-deploy-label {
  position: relative; display: block; font-size: 25px; font-weight: 700; letter-spacing: 10px; padding-left: 10px;
  color: #eef2e4; text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.9);
}
.lp-deploy .lp-deploy-sub { position: relative; display: block; font-size: 9px; letter-spacing: 3px; color: ${SAF.sage}; margin-top: 5px; }
.lp-deploy .lp-tick { position: absolute; width: 9px; height: 9px; border: 1px solid rgba(154, 168, 130, 0.65); }
.lp-deploy .lp-tick-tl { top: 5px; left: 5px; border-right: none; border-bottom: none; }
.lp-deploy .lp-tick-tr { top: 5px; right: 5px; border-left: none; border-bottom: none; }
.lp-deploy .lp-tick-bl { bottom: 5px; left: 5px; border-right: none; border-top: none; }
.lp-deploy .lp-tick-br { bottom: 5px; right: 5px; border-left: none; border-top: none; }
.lp-deploy-hint { margin-top: 14px; font-size: 10px; letter-spacing: 3px; color: ${SAF.textFaint}; }

.lp-scroll-hint {
  position: absolute; bottom: 38px; left: 50%; transform: translateX(-50%);
  font-size: 10px; letter-spacing: 4px; color: #5c7455;
  animation: lp-bob 2.4s ease-in-out infinite;
}
@keyframes lp-bob { 0%, 100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, 6px); } }

/* --- Primary nav row --- */
.lp-nav {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;
  margin-top: 26px; max-width: 620px;
}
.lp-nav-btn {
  font-family: inherit; letter-spacing: 2px; font-size: 11px; padding: 11px 16px;
  background: rgba(8, 16, 9, 0.72); border: 1px solid rgba(110, 190, 120, 0.3);
  color: #b9d8a8; cursor: pointer; transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}
.lp-nav-btn:hover, .lp-nav-btn:focus-visible {
  border-color: rgba(170, 250, 160, 0.7); color: #eaf4e4; background: rgba(20, 40, 20, 0.8); outline: none;
}

/* --- Briefing cards (collapsible) --- */
.lp-briefing-toggle {
  margin-top: 34px; font-family: inherit; letter-spacing: 3px; font-size: 11px;
  background: none; border: none; color: ${SAF.textFaint}; cursor: pointer; padding: 8px;
  display: flex; align-items: center; gap: 8px; text-transform: uppercase;
}
.lp-briefing-toggle:hover { color: ${SAF.text}; }
.lp-briefing-toggle .lp-briefing-chevron { display: inline-block; transition: transform 0.25s ease; }
.lp-briefing-toggle.lp-open .lp-briefing-chevron { transform: rotate(180deg); }
.lp-briefing-wrap {
  max-height: 0; overflow: hidden; transition: max-height 0.35s ease;
}
.lp-briefing-wrap.lp-open { max-height: 2400px; }
.lp-briefing {
  display: flex; gap: 18px; justify-content: center; align-items: stretch; flex-wrap: wrap;
  padding: 30px 26px 90px; max-width: 1180px; margin: 0 auto;
}
.lp-card {
  /* Briefing sheets pinned to a board: flat, square, camo-backed, no tilt. */
  flex: 1 1 300px; max-width: 380px; text-align: left; padding: 18px 20px 22px;
  background-image: linear-gradient(rgba(13, 18, 12, 0.93), rgba(11, 15, 10, 0.95)), url(${camo});
  background-size: auto, 170px 170px;
  border: 1px solid rgba(80, 96, 66, 0.45); position: relative;
  transition: border-color 0.12s linear;
}
.lp-card:hover { border-color: ${SAF.olive}; }
.lp-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: ${SAF.olive};
}
.lp-card h3 { font-size: 11px; letter-spacing: 3px; color: ${SAF.sage}; margin: 4px 0 12px; border-bottom: 1px solid rgba(80, 96, 66, 0.4); padding-bottom: 8px; text-transform: uppercase; }
.lp-card h3 .lp-card-id { float: right; color: ${SAF.textFaint}; letter-spacing: 1px; }
.lp-card p { font-size: 12px; line-height: 1.75; color: ${SAF.textDim}; margin: 0 0 10px; }
.lp-card p strong { color: ${SAF.tan}; font-weight: 700; }
.lp-card .lp-phase { color: ${SAF.tan}; }
.lp-keys { display: grid; grid-template-columns: auto 1fr; gap: 3px 16px; font-size: 11px; line-height: 1.65; }
.lp-keys b { color: ${SAF.tan}; font-weight: 700; white-space: nowrap; }
.lp-keys span { color: ${SAF.textDim}; }

/* --- Cursor FX --- */
.lp-fx-layer { position: absolute; inset: 0; z-index: 30; pointer-events: none; overflow: hidden; }
.lp-pulse {
  position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
  border: 1px solid rgba(154, 168, 130, 0.4);
  animation: lp-pulse 0.7s ease-out forwards;
}
.lp-pulse-big { width: 60px; height: 60px; margin: -30px 0 0 -30px; animation-duration: 0.9s; border-color: rgba(154, 168, 130, 0.55); }
@keyframes lp-pulse { 0% { transform: scale(0.25); opacity: 0.9; } 100% { transform: scale(1.7); opacity: 0; } }

/* --- Terminal boot overlay --- */
.lp-boot {
  position: fixed; inset: 0; z-index: 70; background: #020503;
  display: flex; align-items: center; justify-content: center;
  font-family: ${SAF.fontMono};
  opacity: 0; transition: opacity 0.3s ease;
}
.lp-boot.lp-boot-on { opacity: 1; }
.lp-boot-term {
  width: min(680px, 90vw); font-size: 14px; line-height: 1.9; letter-spacing: 1px;
  color: ${SAF.textDim};
  white-space: pre-wrap;
}
.lp-boot-term .lp-boot-ok { color: ${SAF.sage}; }
.lp-boot-term .lp-boot-warn { color: ${SAF.amber}; }
.lp-boot-commence {
  margin-top: 26px; font-size: 15px; letter-spacing: 5px; color: ${SAF.text};
  opacity: 0; transition: opacity 0.4s ease; cursor: pointer;
}
.lp-boot-commence.lp-on { opacity: 1; }
/* Digital-distortion glitch layers removed — they read as sci-fi, not field kit. */
.lp-glitch-slice { display: none; }
.lp-glitching { }

/* --- Lightweight modal (settings / quit) --- */
.lp-modal-backdrop {
  position: fixed; inset: 0; z-index: 60; background: rgba(2, 5, 3, 0.82);
  display: flex; align-items: center; justify-content: center;
}
.lp-modal {
  width: min(380px, 90vw); background: ${SAF.panel}; border: 1px solid ${SAF.line}; border-top: 3px solid ${SAF.olive};
  padding: 24px 26px; color: ${SAF.text};
}
.lp-modal h3 { font-size: 12px; letter-spacing: 3px; color: ${SAF.sage}; margin: 0 0 18px; text-transform: uppercase; }
.lp-modal-row { margin-bottom: 16px; font-size: 12px; }
.lp-modal-row label { display: flex; justify-content: space-between; margin-bottom: 6px; color: ${SAF.textDim}; letter-spacing: 1px; }
.lp-modal-row input[type="range"] { width: 100%; }
.lp-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
.lp-modal-actions button {
  font-family: inherit; letter-spacing: 2px; font-size: 11px; padding: 9px 16px; cursor: pointer;
  background: ${SAF.panelHi}; border: 1px solid ${SAF.line}; color: ${SAF.text}; text-transform: uppercase;
}
.lp-modal-actions button:hover { background: #24301e; border-color: ${SAF.olive}; }

/* --- Audio toggle --- */
.lp-audio-toggle {
  position: absolute; top: 152px; right: 20px; z-index: 12; pointer-events: auto;
  background: rgba(10, 15, 9, 0.75); border: 1px solid rgba(80, 96, 66, 0.45);
  color: ${SAF.textDim}; font-family: inherit; font-size: 10px; letter-spacing: 2px;
  padding: 5px 10px; cursor: pointer; transition: border-color 0.12s linear, color 0.12s linear;
}
.lp-audio-toggle:hover { border-color: ${SAF.olive}; color: ${SAF.text}; }

@media (max-width: 760px) {
  .lp-hud-bl, .lp-compass, .lp-corner { display: none; }
  .lp-hud-tl { font-size: 10px; }
  .lp-hud-tr { top: 24px; }
  .lp-audio-toggle { top: 96px; }
  .lp-deploy { height: 68px; }
}

@media (prefers-reduced-motion: reduce) {
  .lp-breathe, .lp-interference, .lp-flicker, .lp-scroll-hint, .lp-ticker-inner,
  .lp-threat, .lp-boot-commence { animation: none !important; }
  .lp-zoom, .lp-title, .lp-hud-panel, .lp-card { transition: none; transform: none !important; }
}
`;
  document.head.appendChild(style);
}
