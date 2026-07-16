import { injectLandingStyles } from "./landing/styles";
import { SkylineBackground } from "./landing/SkylineBackground";
import { AmbienceAudio } from "./landing/AmbienceAudio";
import { HudDecor } from "./landing/HudDecor";
import { TerminalBoot } from "./landing/TerminalBoot";

const SLOGAN = "EVERY DECISION MATTERS";
const SUBLINE = "One mission.\nOne chance.";

const KEY_BINDINGS: Array<[string, string]> = [
  ["W A S D", "Move"],
  ["Shift / C", "Sprint / Crouch"],
  ["Mouse / L-Click", "Look / Fire"],
  ["R-Click", "Aim down sights"],
  ["R / G", "Reload / Throwable"],
  ["Q", "UAV recon (reveals enemies 20s)"],
  ["F / H", "Collect crate / M203"],
  ["1 2 3 4", "Weapon slots"],
  ["B / M", "Armoury / Tactical map"],
  ["Tab / Esc", "Controls list / Pause"],
];

/**
 * Cinematic landing page — the player's first contact with the game, styled
 * as an SAF operations terminal over a live night view of the Singapore
 * skyline. Composed from the modules in `./landing/`: animated skyline
 * canvas, synthesised ambience, military HUD chrome, and the DEPLOY →
 * glitch → secure-terminal boot sequence. One rAF loop drives everything
 * (background, HUD, parallax smoothing, button magnetism); the loop stops
 * the moment the page hands off to the game.
 */
export class LandingPage {
  private root: HTMLDivElement;
  private zoomWrap: HTMLDivElement;
  private fxLayer: HTMLDivElement;
  private deployBtn: HTMLButtonElement;
  private background: SkylineBackground;
  private audio: AmbienceAudio;
  private hud: HudDecor;

  visible = true;
  onDeploy?: () => void;
  onProfile?: () => void;

  private targetMx = 0;
  private targetMy = 0;
  private mx = 0;
  private my = 0;
  private rafId = 0;
  private lastFrame = 0;
  private lastTrailPulse = 0;
  private deployRect: DOMRect | null = null;
  private deploying = false;
  private disposed = false;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(container: HTMLElement) {
    injectLandingStyles();

    this.root = document.createElement("div");
    this.root.className = "lp-root lp-flicker";

    // Outer wrap: hover "camera zoom". Inner wrap: slow breathing drift.
    this.zoomWrap = document.createElement("div");
    this.zoomWrap.className = "lp-zoom";
    const breathe = document.createElement("div");
    breathe.className = "lp-breathe";
    this.zoomWrap.appendChild(breathe);
    this.root.appendChild(this.zoomWrap);

    this.background = new SkylineBackground(breathe);
    this.audio = new AmbienceAudio();
    this.background.onHelicopter = (dur, from, to) => this.audio.heliFlyby(dur, from, to);

    for (const cls of ["lp-scanlines", "lp-vignette", "lp-interference"]) {
      const overlay = document.createElement("div");
      overlay.className = cls;
      breathe.appendChild(overlay);
    }

    this.hud = new HudDecor(this.zoomWrap);
    this.buildAudioToggle();
    this.buildProfileButton();
    this.buildContent(breathe);

    this.fxLayer = document.createElement("div");
    this.fxLayer.className = "lp-fx-layer";
    this.root.appendChild(this.fxLayer);

    this.deployBtn = this.root.querySelector(".lp-deploy") as HTMLButtonElement;

    container.appendChild(this.root);

    window.addEventListener("mousemove", this.onMouseMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.refreshDeployRect);

    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
    requestAnimationFrame(this.refreshDeployRect);
    this.animateHeroIn();
  }

  // =========================================================================
  // DOM construction
  // =========================================================================

  private buildContent(parent: HTMLElement): void {
    const scroll = document.createElement("div");
    scroll.className = "lp-scroll";
    scroll.addEventListener("scroll", this.refreshDeployRect, { passive: true });

    const hero = document.createElement("section");
    hero.className = "lp-hero";
    hero.setAttribute("aria-label", "Enlisted — mission start");

    const kicker = document.createElement("div");
    kicker.className = "lp-kicker";
    kicker.textContent = "SINGAPORE ARMED FORCES PRESENT";

    const title = document.createElement("h1");
    title.className = "lp-title lp-title-in";
    title.textContent = "ENLISTED";

    const slogan = document.createElement("div");
    slogan.className = "lp-slogan";
    slogan.setAttribute("aria-label", SLOGAN);
    [...SLOGAN].forEach((ch, i) => {
      const span = document.createElement("span");
      span.textContent = ch === " " ? " " : ch;
      span.style.animationDelay = `${0.9 + i * 0.045}s`;
      span.setAttribute("aria-hidden", "true");
      slogan.appendChild(span);
    });

    const subline = document.createElement("div");
    subline.className = "lp-subline";

    const deployWrap = document.createElement("div");
    deployWrap.className = "lp-deploy-wrap";
    const deploy = document.createElement("button");
    deploy.className = "lp-deploy lp-interactive";
    deploy.setAttribute("aria-label", "Deploy — commence Operation Sentinel Shield");
    deploy.innerHTML = `
      <span class="lp-deploy-label">DEPLOY</span>
      <span class="lp-deploy-sub">COMMENCE OPERATION SENTINEL SHIELD</span>
      <span class="lp-tick lp-tick-tl"></span><span class="lp-tick lp-tick-tr"></span>
      <span class="lp-tick lp-tick-bl"></span><span class="lp-tick lp-tick-br"></span>
    `;
    deploy.addEventListener("mouseenter", () => {
      if (this.deploying) return;
      this.audio.uiHover();
      this.zoomWrap.classList.add("lp-zoomed");
      this.spawnPulse(this.deployRectCenterX(), this.deployRectCenterY(), true);
    });
    deploy.addEventListener("mouseleave", () => this.zoomWrap.classList.remove("lp-zoomed"));
    deploy.addEventListener("click", () => this.startDeploySequence());
    deployWrap.appendChild(deploy);

    const hint = document.createElement("div");
    hint.className = "lp-deploy-hint";
    hint.textContent = "AUDIO ADVISED · HEADSET COMMS PREFERRED";
    deployWrap.appendChild(hint);

    const scrollHint = document.createElement("div");
    scrollHint.className = "lp-scroll-hint";
    scrollHint.textContent = "▼ OPERATIONAL BRIEF";

    hero.append(kicker, title, slogan, subline, deployWrap, scrollHint);

    const briefing = document.createElement("section");
    briefing.className = "lp-briefing";
    briefing.setAttribute("aria-label", "Operational brief");
    briefing.append(
      this.buildCard("SITUATION REPORT", "DOC 01", `
        <p>At dawn, a hostile coalition — designated <strong>OPFOR</strong> — strikes Singapore
        across multiple axes, seizing coastal sectors and an industrial port before pushing
        inland toward the urban estates. The SAF mobilises within hours.</p>
        <p>You are an SAF infantryman dug in at a concealed forward deployment point on the
        sector's edge, issued a <strong>SAR 21</strong> and <strong>H&amp;K P30</strong>.
        Credits recovered from cleared ground resupply you at the Field Armoury.</p>
        <p class="lp-phase">W1–4 DEFENCE · W5–9 HOLDING ACTION · W10–14 COUNTER-ATTACK · W15+ RETAKE</p>
      `),
      this.buildCard("MISSION OBJECTIVE", "DOC 02", `
        <p>Survive as many waves as you can. Kills and cleared waves bank credits — spend them
        at the Field Armoury (<strong>B</strong>) on weapons, attachments, throwables, and armour.</p>
        <p>Scout the sector in the 30-second window before Wave 1. Hidden supply crates top up
        ammunition and health. Call the <strong>UAV (Q)</strong> and read the tactical map
        (<strong>M</strong>) to fix enemy positions.</p>
        <p>If you fall, credits and unlocks are kept — you redeploy from camp and re-gear.</p>
      `),
      this.buildKeysCard()
    );

    scroll.append(hero, briefing);
    parent.appendChild(scroll);

    // Typed sub-line under the slogan, after the slogan letters land.
    window.setTimeout(() => this.typeSubline(subline), 2100);
  }

  private buildCard(title: string, id: string, bodyHtml: string): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "lp-card lp-interactive";
    card.innerHTML = `<h3>${title}<span class="lp-card-id">${id}</span></h3>${bodyHtml}`;
    this.attachTilt(card);
    return card;
  }

  private buildKeysCard(): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "lp-card lp-interactive";
    const rows = KEY_BINDINGS.map(([k, d]) => `<b>${k}</b><span>${d}</span>`).join("");
    card.innerHTML = `
      <h3>CONTROLS<span class="lp-card-id">DOC 03</span></h3>
      <div class="lp-keys">${rows}</div>
      <p style="margin-top:10px;" class="lp-hud-dim">Full reference in-theatre: hold TAB.</p>
    `;
    this.attachTilt(card);
    return card;
  }

  /** Perspective tilt toward the cursor while hovering a card. */
  private attachTilt(card: HTMLDivElement): void {
    if (this.reducedMotion) return;
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty("--lp-ry", `${nx * 5}deg`);
      card.style.setProperty("--lp-rx", `${-ny * 5}deg`);
    });
    card.addEventListener("mouseleave", () => {
      card.style.setProperty("--lp-ry", "0deg");
      card.style.setProperty("--lp-rx", "0deg");
    });
    card.addEventListener("mouseenter", (e) => this.spawnPulse(e.clientX, e.clientY, false));
  }

  private buildAudioToggle(): void {
    const btn = document.createElement("button");
    btn.className = "lp-audio-toggle lp-interactive";
    btn.textContent = "AUDIO: STANDBY";
    btn.setAttribute("aria-label", "Toggle ambience audio");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      btn.textContent = this.audio.muted ? "AUDIO: OFF" : "AUDIO: ON";
    });
    this.zoomWrap.appendChild(btn);
    // Reflect the automatic unlock that happens on first click/keypress.
    const sync = () => { if (!this.audio.muted) btn.textContent = "AUDIO: ON"; };
    window.addEventListener("pointerdown", sync, { once: true });
    window.addEventListener("keydown", sync, { once: true });
  }

  private buildProfileButton(): void {
    const btn = document.createElement("button");
    btn.className = "lp-audio-toggle lp-interactive";
    btn.style.right = "auto";
    btn.style.left = "24px";
    btn.textContent = "OPERATOR PROFILE";
    btn.setAttribute("aria-label", "Open operator profile");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onProfile?.();
    });
    this.zoomWrap.appendChild(btn);
  }

  private animateHeroIn(): void {
    // The kicker + deploy button fade in staged after the title lands.
    const stage = (selector: string, delayMs: number) => {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.style.opacity = "0";
      el.style.transition = "opacity 0.9s ease";
      window.setTimeout(() => { el.style.opacity = "1"; }, delayMs);
    };
    stage(".lp-kicker", 350);
    stage(".lp-deploy-wrap", 1500);
    stage(".lp-scroll-hint", 2600);
  }

  private typeSubline(el: HTMLElement): void {
    let i = 0;
    const tick = () => {
      if (this.disposed) return;
      i = Math.min(SUBLINE.length, i + 1);
      el.innerHTML =
        SUBLINE.slice(0, i).replace("\n", "<br>") + `<span class="lp-cursor"></span>`;
      if (i < SUBLINE.length) window.setTimeout(tick, 55 + Math.random() * 45);
    };
    tick();
  }

  // =========================================================================
  // Input + frame loop
  // =========================================================================

  private onMouseMove = (e: MouseEvent): void => {
    this.targetMx = (e.clientX / window.innerWidth) * 2 - 1;
    this.targetMy = (e.clientY / window.innerHeight) * 2 - 1;

    // Sparse scan-pulse trail behind the cursor.
    const now = performance.now();
    if (now - this.lastTrailPulse > 340) {
      this.lastTrailPulse = now;
      this.spawnPulse(e.clientX, e.clientY, false);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.audio.unlock();
    this.spawnPulse(e.clientX, e.clientY, true);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.audio.unlock();
    if ((e.code === "Enter" || e.code === "Space") && document.activeElement === this.deployBtn) return; // native click fires
    if (e.code === "Enter" && !this.deploying) this.startDeploySequence();
  };

  private spawnPulse(x: number, y: number, big: boolean): void {
    if (this.reducedMotion || this.disposed) return;
    const p = document.createElement("div");
    p.className = big ? "lp-pulse lp-pulse-big" : "lp-pulse";
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.fxLayer.appendChild(p);
    window.setTimeout(() => p.remove(), 950);
  }

  private refreshDeployRect = (): void => {
    this.deployRect = this.deployBtn?.getBoundingClientRect() ?? null;
  };

  private deployRectCenterX(): number {
    return this.deployRect ? this.deployRect.left + this.deployRect.width / 2 : window.innerWidth / 2;
  }

  private deployRectCenterY(): number {
    return this.deployRect ? this.deployRect.top + this.deployRect.height / 2 : window.innerHeight / 2;
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // Smoothed parallax shared by the canvas and (via CSS vars) the DOM.
    const ease = Math.min(1, dt * 4.5);
    this.mx += (this.targetMx - this.mx) * ease;
    this.my += (this.targetMy - this.my) * ease;
    if (!this.reducedMotion) {
      this.root.style.setProperty("--lp-mx", this.mx.toFixed(4));
      this.root.style.setProperty("--lp-my", this.my.toFixed(4));
      this.background.frame(dt, this.mx, this.my);
    }
    this.hud.frame(dt, this.mx);
    this.applyDeployMagnetism();

    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Cursor magnetism: the deploy button leans a few pixels toward a nearby cursor. */
  private applyDeployMagnetism(): void {
    if (!this.deployRect || this.reducedMotion || this.deploying) return;
    const cx = this.deployRectCenterX();
    const cy = this.deployRectCenterY();
    const px = ((this.targetMx + 1) / 2) * window.innerWidth;
    const py = ((this.targetMy + 1) / 2) * window.innerHeight;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    const reach = 190;
    if (dist < reach && dist > 1) {
      const pull = (1 - dist / reach) * 7;
      this.deployBtn.style.translate = `${(dx / dist) * pull}px ${(dy / dist) * pull}px`;
    } else {
      this.deployBtn.style.translate = "0px 0px";
    }
  }

  // =========================================================================
  // Deploy → boot → hand-off
  // =========================================================================

  private startDeploySequence(): void {
    if (this.deploying || this.disposed) return;
    this.deploying = true;
    this.deployBtn.disabled = true;
    this.audio.unlock();
    this.audio.deployAlarm();
    this.zoomWrap.classList.remove("lp-zoomed");

    const boot = new TerminalBoot();
    void boot.run(this.root, this.zoomWrap, this.audio).then(() => {
      if (this.disposed) return;
      // Resolved inside the player's final click — a fresh user gesture, so
      // the game's pointer lock + audio start reliably right here.
      this.visible = false;
      this.onDeploy?.();
      boot.fadeOut();
      this.hide();
    });
  }

  hide(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visible = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.refreshDeployRect);
    this.audio.dispose();
    this.root.classList.add("lp-exit");
    window.setTimeout(() => {
      this.hud.dispose();
      this.background.dispose();
      this.root.remove();
    }, 1000);
  }
}
