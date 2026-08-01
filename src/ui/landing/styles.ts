import { camoDataUrl } from "./camo";

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
  const camo = camoDataUrl();
  const style = document.createElement("style");
  style.id = "lp-styles";
  style.textContent = `
:root { --lp-mx: 0; --lp-my: 0; }

.lp-root {
  position: fixed; inset: 0; z-index: 50; overflow: hidden;
  background: #030604;
  font-family: Consolas, "Courier New", monospace;
  color: #cfe0c6;
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

/* --- Film-grade overlays: scanlines, vignette, interference flicker --- */
.lp-scanlines {
  position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 3px);
  opacity: 0.55; mix-blend-mode: multiply;
}
.lp-vignette {
  position: absolute; inset: 0; pointer-events: none; z-index: 5;
  background: radial-gradient(ellipse at center, transparent 52%, rgba(0, 4, 2, 0.72) 100%);
}
.lp-interference {
  position: absolute; inset: 0; pointer-events: none; z-index: 6;
  background: linear-gradient(180deg, transparent 0%, rgba(120,255,150,0.028) 48%, transparent 52%);
  background-size: 100% 340px;
  animation: lp-interference 7.5s linear infinite;
  opacity: 0.9;
}
@keyframes lp-interference {
  0% { background-position: 0 -340px; }
  100% { background-position: 0 110vh; }
}
.lp-flicker { animation: lp-flicker 11s steps(1) infinite; }
@keyframes lp-flicker {
  0%, 93.8%, 94.4%, 97.2%, 97.8%, 100% { opacity: 1; }
  94% { opacity: 0.86; }
  94.2% { opacity: 0.95; }
  97.4% { opacity: 0.9; }
}

/* --- HUD chrome --- */
.lp-hud { position: absolute; inset: 0; pointer-events: none; z-index: 10; font-size: 11px; letter-spacing: 1px; }
.lp-hud-panel {
  position: absolute; padding: 10px 14px; line-height: 1.7;
  color: #8fb083; text-shadow: 0 0 6px rgba(70, 220, 110, 0.25);
  background: linear-gradient(160deg, rgba(6, 14, 8, 0.82), rgba(6, 14, 8, 0.6));
  border: 1px solid rgba(110, 190, 120, 0.14);
  transform: translate3d(calc(var(--lp-mx) * var(--lp-tilt, 6px)), calc(var(--lp-my) * var(--lp-tilt, 6px)), 0);
  will-change: transform;
}
.lp-hud-panel .lp-hud-strong { color: #cfe8c0; }
.lp-hud-panel .lp-hud-dim { color: #5c7455; }
.lp-hud-title { font-size: 12px; letter-spacing: 2px; color: #b9d8a8; margin-bottom: 4px; }
.lp-hud-tl { top: 18px; left: 20px; --lp-tilt: 7px; }
.lp-hud-tr { top: 18px; right: 20px; text-align: right; --lp-tilt: -7px; }
.lp-hud-bl { bottom: 46px; left: 20px; max-width: 330px; --lp-tilt: 5px; }
.lp-hud-br { bottom: 46px; right: 20px; text-align: right; --lp-tilt: -5px; display: flex; gap: 12px; align-items: flex-end; }

.lp-classification {
  position: absolute; top: 0; left: 0; right: 0; height: 18px; z-index: 11;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; letter-spacing: 6px; color: #d8c27a;
  background: rgba(20, 18, 6, 0.75); border-bottom: 1px solid rgba(216, 194, 122, 0.25);
  pointer-events: none;
}
.lp-threat { color: #e0b34a; animation: lp-threat 2.2s ease-in-out infinite; }
@keyframes lp-threat { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

.lp-signal { display: inline-flex; gap: 2px; align-items: flex-end; height: 10px; margin-left: 6px; }
.lp-signal i { width: 3px; background: #79c977; display: block; }
.lp-signal i.lp-sig-off { background: #33452f; }

.lp-corner { position: absolute; width: 34px; height: 34px; z-index: 10; pointer-events: none; opacity: 0.7; }
.lp-corner::before, .lp-corner::after { content: ""; position: absolute; background: rgba(140, 220, 150, 0.5); }
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
  font-size: 10px; color: #8fb083; letter-spacing: 0;
  will-change: transform;
}
.lp-compass-tick { display: inline-block; width: 44px; text-align: center; border-left: 1px solid rgba(140, 200, 140, 0.25); padding-top: 8px; }
.lp-compass-needle {
  position: absolute; left: 50%; top: 0; width: 1px; height: 100%;
  background: #aef0a0; box-shadow: 0 0 6px rgba(140, 255, 140, 0.7);
}

.lp-ticker {
  position: absolute; bottom: 0; left: 0; right: 0; height: 26px; z-index: 11;
  display: flex; align-items: center; overflow: hidden; pointer-events: none;
  background: rgba(5, 12, 7, 0.8); border-top: 1px solid rgba(110, 190, 120, 0.18);
  font-size: 10px; color: #6f8f66; letter-spacing: 1px;
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
  font-size: 12px; letter-spacing: 7px; color: #8fb083; margin-bottom: 18px;
  display: flex; align-items: center; gap: 14px;
}
.lp-kicker::before, .lp-kicker::after { content: ""; width: 56px; height: 1px; background: linear-gradient(90deg, transparent, rgba(140, 210, 140, 0.6)); }
.lp-kicker::after { transform: scaleX(-1); }

.lp-title {
  font-family: Impact, "Arial Black", "Franklin Gothic Bold", sans-serif;
  font-size: clamp(64px, 15vw, 178px);
  line-height: 0.94; margin: 0; letter-spacing: 0.13em; padding-left: 0.13em;
  background-image: linear-gradient(180deg, rgba(226, 238, 216, 0.94) 18%, rgba(150, 172, 138, 0.82) 78%), url(${camo});
  background-size: auto, 240px 240px;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(10, 20, 10, 0.9)) drop-shadow(0 0 26px rgba(90, 255, 130, 0.14));
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
  color: #b9d8a8; text-shadow: 0 0 12px rgba(120, 240, 140, 0.3);
}
.lp-slogan span { opacity: 0; display: inline-block; animation: lp-letter-in 0.5s ease both; }
@keyframes lp-letter-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Spec strip: three tactical readout chips under the slogan. */
.lp-specs { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; }
.lp-spec {
  display: inline-flex; align-items: baseline; gap: 8px;
  font-size: 11px; letter-spacing: 2.4px; color: #cfe4c2;
  padding: 6px 12px;
  border: 1px solid rgba(140, 210, 140, 0.28);
  background: linear-gradient(180deg, rgba(18, 30, 18, 0.72), rgba(10, 18, 10, 0.72));
  box-shadow: inset 0 0 14px rgba(20, 60, 25, 0.28);
}
.lp-spec b { font-weight: 600; font-size: 9px; letter-spacing: 2px; color: #7fa872; }

.lp-subline { margin-top: 16px; font-size: 13px; letter-spacing: 3px; color: #7d9a72; min-height: 36px; line-height: 1.6; }

/* Unofficial-project notice — quiet, but backed so it stays legible over
   the animated skyline behind the hero. */
.lp-disclaimer {
  margin-top: 22px; max-width: 60ch;
  font-size: 10px; letter-spacing: 1.3px; line-height: 1.7;
  color: #8fae85; text-transform: uppercase;
  padding: 8px 14px;
  background: rgba(6, 12, 6, 0.72);
  border: 1px solid rgba(140, 210, 140, 0.2);
}
.lp-cursor { display: inline-block; width: 7px; height: 12px; background: #aef0a0; margin-left: 3px; vertical-align: -1px; animation: lp-blink 1.05s steps(1) infinite; }
@keyframes lp-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

/* --- Deploy button --- */
.lp-deploy-wrap { margin-top: 44px; position: relative; }
.lp-deploy {
  position: relative; overflow: hidden; cursor: pointer;
  font-family: inherit; letter-spacing: 6px; padding: 0;
  background: rgba(10, 18, 10, 0.82);
  border: 1px solid rgba(140, 210, 140, 0.45);
  color: #dcecd2; width: min(340px, 82vw); height: 76px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 14px 40px rgba(0, 0, 0, 0.55), inset 0 0 22px rgba(20, 60, 25, 0.35);
  transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.12s ease;
  will-change: transform;
}
.lp-deploy::before {
  content: ""; position: absolute; inset: 0;
  background: url(${camo}); background-size: 190px 190px; opacity: 0.16;
}
.lp-deploy::after { /* metallic sheen sweep */
  content: ""; position: absolute; top: -40%; bottom: -40%; width: 34%;
  left: -60%; transform: skewX(-22deg);
  background: linear-gradient(90deg, transparent, rgba(220, 255, 220, 0.22), rgba(255, 255, 255, 0.32), rgba(220, 255, 220, 0.22), transparent);
  transition: left 0.7s cubic-bezier(0.3, 0.7, 0.3, 1); pointer-events: none;
}
.lp-deploy:hover::after, .lp-deploy:focus-visible::after { left: 130%; }
.lp-deploy:hover, .lp-deploy:focus-visible {
  border-color: rgba(180, 255, 170, 0.9); outline: none;
  box-shadow: 0 0 0 1px rgba(120, 255, 140, 0.25), 0 0 34px rgba(90, 255, 120, 0.28), 0 14px 40px rgba(0, 0, 0, 0.6), inset 0 0 30px rgba(40, 110, 45, 0.5);
}
.lp-deploy:active { transform: translateY(2px) scale(0.995); }
.lp-deploy .lp-deploy-label {
  position: relative; display: block; font-size: 26px; font-weight: bold; letter-spacing: 10px; padding-left: 10px;
  color: #e8f4dd; text-shadow: 0 0 14px rgba(140, 255, 150, 0.5);
}
.lp-deploy .lp-deploy-sub { position: relative; display: block; font-size: 9px; letter-spacing: 3px; color: #86a878; margin-top: 5px; }
.lp-deploy .lp-tick { position: absolute; width: 9px; height: 9px; border: 1px solid rgba(180, 255, 180, 0.7); }
.lp-deploy .lp-tick-tl { top: 5px; left: 5px; border-right: none; border-bottom: none; }
.lp-deploy .lp-tick-tr { top: 5px; right: 5px; border-left: none; border-bottom: none; }
.lp-deploy .lp-tick-bl { bottom: 5px; left: 5px; border-right: none; border-top: none; }
.lp-deploy .lp-tick-br { bottom: 5px; right: 5px; border-left: none; border-top: none; }
.lp-deploy-hint { margin-top: 14px; font-size: 10px; letter-spacing: 3px; color: #5c7455; }

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
  background: none; border: none; color: #6a8562; cursor: pointer; padding: 8px;
  display: flex; align-items: center; gap: 8px;
}
.lp-briefing-toggle:hover { color: #a9bfa0; }
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
  flex: 1 1 300px; max-width: 380px; text-align: left; padding: 18px 20px 22px;
  background: linear-gradient(165deg, rgba(8, 16, 9, 0.88), rgba(8, 16, 9, 0.62));
  border: 1px solid rgba(110, 190, 120, 0.2); position: relative;
  transform: perspective(900px) rotateX(var(--lp-rx, 0deg)) rotateY(var(--lp-ry, 0deg));
  transition: transform 0.18s ease-out, border-color 0.25s ease, box-shadow 0.25s ease;
  will-change: transform;
}
.lp-card:hover { border-color: rgba(170, 250, 160, 0.5); box-shadow: 0 0 26px rgba(70, 220, 110, 0.12), 0 18px 40px rgba(0, 0, 0, 0.5); }
.lp-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: url(${camo}); background-size: 130px 130px; opacity: 0.85;
}
.lp-card h3 { font-size: 12px; letter-spacing: 3px; color: #b9d8a8; margin: 4px 0 12px; border-bottom: 1px solid rgba(110, 190, 120, 0.2); padding-bottom: 8px; }
.lp-card h3 .lp-card-id { float: right; color: #5c7455; letter-spacing: 1px; }
.lp-card p { font-size: 12px; line-height: 1.75; color: #a9bfa0; margin: 0 0 10px; }
.lp-card p strong { color: #d8c27a; font-weight: normal; }
.lp-card .lp-phase { color: #d8c27a; }
.lp-keys { display: grid; grid-template-columns: auto 1fr; gap: 3px 16px; font-size: 11px; line-height: 1.65; }
.lp-keys b { color: #d8c27a; font-weight: normal; white-space: nowrap; }
.lp-keys span { color: #a9bfa0; }

/* --- Cursor FX --- */
.lp-fx-layer { position: absolute; inset: 0; z-index: 30; pointer-events: none; overflow: hidden; }
.lp-pulse {
  position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
  border: 1px solid rgba(140, 255, 150, 0.55);
  animation: lp-pulse 0.7s ease-out forwards;
}
.lp-pulse-big { width: 60px; height: 60px; margin: -30px 0 0 -30px; animation-duration: 0.9s; border-color: rgba(180, 255, 180, 0.7); }
@keyframes lp-pulse { 0% { transform: scale(0.25); opacity: 0.9; } 100% { transform: scale(1.7); opacity: 0; } }

/* --- Terminal boot overlay --- */
.lp-boot {
  position: fixed; inset: 0; z-index: 70; background: #020503;
  display: flex; align-items: center; justify-content: center;
  font-family: Consolas, "Courier New", monospace;
  opacity: 0; transition: opacity 0.3s ease;
}
.lp-boot.lp-boot-on { opacity: 1; }
.lp-boot-term {
  width: min(680px, 90vw); font-size: 14px; line-height: 1.9; letter-spacing: 1px;
  color: #8ee08a; text-shadow: 0 0 8px rgba(90, 240, 110, 0.45);
  white-space: pre-wrap;
}
.lp-boot-term .lp-boot-ok { color: #d8f0c0; }
.lp-boot-term .lp-boot-warn { color: #e0b34a; }
.lp-boot-commence {
  margin-top: 26px; font-size: 15px; letter-spacing: 5px; color: #eaffe0;
  opacity: 0; transition: opacity 0.4s ease; cursor: pointer;
  animation: lp-threat 1.6s ease-in-out infinite;
}
.lp-boot-commence.lp-on { opacity: 1; }
.lp-glitch-slice {
  position: absolute; left: 0; right: 0; pointer-events: none;
  background: rgba(120, 255, 140, 0.09); mix-blend-mode: screen;
  animation: lp-glitch-slice 0.13s steps(2) infinite;
}
@keyframes lp-glitch-slice {
  0% { transform: translateX(-14px); opacity: 0.9; }
  50% { transform: translateX(11px); opacity: 0.35; }
  100% { transform: translateX(-6px); opacity: 0.8; }
}
.lp-glitching { animation: lp-glitch-shake 0.12s steps(2) infinite; }
@keyframes lp-glitch-shake {
  0% { transform: translate(-5px, 2px); filter: hue-rotate(12deg) saturate(1.6); }
  50% { transform: translate(4px, -3px); filter: hue-rotate(-14deg); }
  100% { transform: translate(-2px, 1px); filter: none; }
}

/* --- Lightweight modal (settings / quit) --- */
.lp-modal-backdrop {
  position: fixed; inset: 0; z-index: 60; background: rgba(2, 5, 3, 0.82);
  display: flex; align-items: center; justify-content: center;
}
.lp-modal {
  width: min(380px, 90vw); background: rgba(8, 16, 9, 0.96); border: 1px solid rgba(110, 190, 120, 0.3);
  padding: 24px 26px; color: #d7e8d0;
}
.lp-modal h3 { font-size: 13px; letter-spacing: 3px; color: #b9d8a8; margin: 0 0 18px; }
.lp-modal-row { margin-bottom: 16px; font-size: 12px; }
.lp-modal-row label { display: flex; justify-content: space-between; margin-bottom: 6px; color: #a9bfa0; letter-spacing: 1px; }
.lp-modal-row input[type="range"] { width: 100%; }
.lp-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
.lp-modal-actions button {
  font-family: inherit; letter-spacing: 2px; font-size: 11px; padding: 9px 16px; cursor: pointer;
  background: rgba(20, 40, 20, 0.7); border: 1px solid rgba(110, 190, 120, 0.35); color: #d7e8d0;
}
.lp-modal-actions button:hover { border-color: rgba(170, 250, 160, 0.7); }

/* --- Audio toggle --- */
.lp-audio-toggle {
  position: absolute; top: 152px; right: 20px; z-index: 12; pointer-events: auto;
  background: rgba(6, 14, 8, 0.6); border: 1px solid rgba(110, 190, 120, 0.25);
  color: #8fb083; font-family: inherit; font-size: 10px; letter-spacing: 2px;
  padding: 5px 10px; cursor: pointer; transition: border-color 0.2s, color 0.2s;
}
.lp-audio-toggle:hover { border-color: rgba(180, 255, 180, 0.7); color: #cfe8c0; }

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
