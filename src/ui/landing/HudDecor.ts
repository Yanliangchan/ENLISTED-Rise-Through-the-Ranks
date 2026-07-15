/**
 * Military-software HUD chrome framing the landing page: classification
 * strip, operation ident, live UTC clock + Singapore lat/long grid, signal
 * bars, threat level, radio frequency, mission standby timer, a sweeping
 * radar scope, a scrolling compass tape, a comms log cycling SAF-flavoured
 * radio traffic, and a data ticker along the bottom edge. Everything is
 * data-driven off one `frame()` tick from the page's single rAF loop.
 */

const CHATTER_LINES = [
  "SUNRAY, this is BRAVO-2. Sector 7 clear, over.",
  "Contact report — movement grid 4832 1178, wait out.",
  "ALPHA-1 holding at RV CHARLIE. Ammunition green, over.",
  "This is ZERO. Air asset on station, callsign HORNET-3.",
  "BRAVO-2, push to checkpoint LIMA. Acknowledge, over.",
  "Wind 040 at 12 knots. Haze inbound from the strait.",
  "All stations, radio check… OK, out.",
  "SIERRA-4, hold the underpass. Do not advance, over.",
  "Sitrep: OPFOR probing the cargo terminal fence line.",
  "Request illum on my mark… mark. Out.",
];

const TICKER_ITEMS = [
  "SAT-LINK 98.2%", "ENC AES-256 ACTIVE", "GRID 48N 372889 145223", "IFF INTERROGATOR ONLINE",
  "UAV FEED: STANDBY", "MET: 27°C / HUM 88%", "TIDE: EBB 0.4M", "EW SWEEP NEGATIVE",
  "LOGPAC 0300 CONFIRMED", "MEDEVAC CH 3 OPEN", "ROE CARD BRAVO IN EFFECT", "COMSEC ROLLOVER 0000Z",
];

export class HudDecor {
  private root: HTMLDivElement;
  private clockEl: HTMLSpanElement;
  private dateEl: HTMLSpanElement;
  private timerEl: HTMLSpanElement;
  private signalEl: HTMLSpanElement;
  private commsEl: HTMLDivElement;
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;
  private compassStrip: HTMLDivElement;

  private startedAt = performance.now();
  private lastSecond = -1;
  private chatterIdx = 0;
  private chatterChar = 0;
  private chatterCooldown = 1.2;
  private radarBlips: Array<{ angle: number; dist: number; age: number }> = [];
  private radarAngle = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "lp-hud";
    this.root.setAttribute("aria-hidden", "true");

    const classification = el("div", "lp-classification");
    classification.textContent = "RESTRICTED — EXERCISE USE ONLY";
    this.root.appendChild(classification);

    // Corner brackets.
    for (const c of ["tl", "tr", "bl", "br"]) {
      this.root.appendChild(el("div", `lp-corner lp-corner-${c}`));
    }

    // Top-left: operation ident.
    const tl = el("div", "lp-hud-panel lp-hud-tl");
    tl.innerHTML = `
      <div class="lp-hud-title">OP SENTINEL SHIELD</div>
      <div>SAF INFANTRY — <span class="lp-hud-strong">3 SIR</span></div>
      <div class="lp-hud-dim">HQ 7 SIB · SECTOR SIERRA</div>
      <div>AUTH LEVEL <span class="lp-hud-strong">2</span> · NET <span class="lp-hud-strong">243.00 MHZ</span></div>
    `;
    this.root.appendChild(tl);

    // Top-right: clock, position, signal, threat.
    const tr = el("div", "lp-hud-panel lp-hud-tr");
    this.clockEl = document.createElement("span");
    this.clockEl.className = "lp-hud-strong";
    this.dateEl = document.createElement("span");
    this.signalEl = document.createElement("span");
    this.signalEl.className = "lp-signal";
    tr.append(this.clockEl, document.createElement("br"), this.dateEl, document.createElement("br"));
    const pos = document.createElement("span");
    pos.innerHTML = `LAT <span class="lp-hud-strong">1.3521°N</span> · LON <span class="lp-hud-strong">103.8198°E</span>`;
    tr.appendChild(pos);
    tr.appendChild(document.createElement("br"));
    const sigLine = document.createElement("span");
    sigLine.append("SIGNAL", this.signalEl);
    tr.appendChild(sigLine);
    tr.appendChild(document.createElement("br"));
    const threat = document.createElement("span");
    threat.innerHTML = `THREAT LEVEL: <span class="lp-threat">ELEVATED</span>`;
    tr.appendChild(threat);
    this.root.appendChild(tr);

    // Bottom-left: comms log with typewriter chatter.
    const bl = el("div", "lp-hud-panel lp-hud-bl");
    const commsTitle = el("div", "lp-hud-title");
    commsTitle.textContent = "COMMS — NET 1 (SECURE)";
    this.commsEl = el("div", "") as HTMLDivElement;
    this.commsEl.style.minHeight = "34px";
    bl.append(commsTitle, this.commsEl);
    this.root.appendChild(bl);

    // Bottom-right: radar scope + standby timer.
    const br = el("div", "lp-hud-panel lp-hud-br");
    const timerWrap = document.createElement("div");
    const timerTitle = el("div", "lp-hud-title");
    timerTitle.textContent = "STANDBY";
    this.timerEl = document.createElement("span");
    this.timerEl.className = "lp-hud-strong";
    this.timerEl.style.fontSize = "16px";
    timerWrap.append(timerTitle, this.timerEl);
    this.radarCanvas = document.createElement("canvas");
    this.radarCanvas.width = 92;
    this.radarCanvas.height = 92;
    this.radarCanvas.style.cssText = "display:block; border-radius:50%; border:1px solid rgba(110,190,120,0.3); background:rgba(4,10,5,0.75);";
    this.radarCtx = this.radarCanvas.getContext("2d")!;
    br.append(timerWrap, this.radarCanvas);
    this.root.appendChild(br);

    // Compass tape across the top centre.
    const compass = el("div", "lp-compass");
    this.compassStrip = el("div", "lp-compass-strip") as HTMLDivElement;
    const points = ["N", "030", "NE", "060", "E", "120", "SE", "150", "S", "210", "SW", "240", "W", "300", "NW", "330"];
    let ticks = "";
    for (let rep = 0; rep < 3; rep++) {
      for (const p of points) ticks += `<span class="lp-compass-tick">${p}</span>`;
    }
    this.compassStrip.innerHTML = ticks;
    compass.append(this.compassStrip, el("div", "lp-compass-needle"));
    this.root.appendChild(compass);

    // Bottom data ticker (content doubled for a seamless CSS marquee loop).
    const ticker = el("div", "lp-ticker");
    const inner = el("div", "lp-ticker-inner");
    const line = TICKER_ITEMS.map((s) => `▌ ${s}`).join("  ") + "  ";
    inner.textContent = line + line;
    ticker.appendChild(inner);
    this.root.appendChild(ticker);

    for (let i = 0; i < 5; i++) {
      this.radarBlips.push({ angle: Math.random() * Math.PI * 2, dist: 0.3 + Math.random() * 0.6, age: Math.random() * 4 });
    }

    parent.appendChild(this.root);
  }

  /** One tick from the page's rAF loop. mx in [-1,1] drives the compass tape. */
  frame(dt: number, mx: number): void {
    const now = performance.now();
    const second = Math.floor(now / 1000);
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      this.clockEl.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
      this.dateEl.textContent = `${pad(d.getUTCDate())} ${d.toLocaleString("en-SG", { month: "short" }).toUpperCase()} ${d.getUTCFullYear()}`;
      const elapsed = Math.floor((now - this.startedAt) / 1000);
      this.timerEl.textContent = `${pad(Math.floor(elapsed / 3600))}:${pad(Math.floor((elapsed / 60) % 60))}:${pad(elapsed % 60)}`;
      // Signal strength: random-walking 3–5 of 5 bars.
      const bars = 3 + Math.floor(Math.random() * 3);
      this.signalEl.innerHTML = [1, 2, 3, 4, 5]
        .map((b) => `<i style="height:${b * 2}px" class="${b <= bars ? "" : "lp-sig-off"}"></i>`)
        .join("");
    }

    this.tickChatter(dt);
    this.drawRadar(dt);
    this.compassStrip.style.transform = `translateX(${-704 + mx * -60}px)`;
  }

  /** Typewriter-cycle through radio traffic in the comms panel. */
  private tickChatter(dt: number): void {
    this.chatterCooldown -= dt;
    if (this.chatterCooldown > 0) return;
    const line = CHATTER_LINES[this.chatterIdx % CHATTER_LINES.length];
    if (this.chatterChar < line.length) {
      this.chatterChar = Math.min(line.length, this.chatterChar + Math.max(1, Math.floor(dt / 0.024)));
      this.commsEl.innerHTML = `<span class="lp-hud-dim">&gt;</span> ${line.slice(0, this.chatterChar)}<span class="lp-cursor"></span>`;
      this.chatterCooldown = 0.024;
    } else {
      // Hold the finished line, then move to the next transmission.
      this.chatterIdx++;
      this.chatterChar = 0;
      this.chatterCooldown = 4.5 + Math.random() * 3;
    }
  }

  private drawRadar(dt: number): void {
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const c = size / 2;
    this.radarAngle = (this.radarAngle + dt * 1.5) % (Math.PI * 2);
    ctx.clearRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(110, 190, 120, 0.25)";
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66, 0.98]) {
      ctx.beginPath();
      ctx.arc(c, c, c * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, 2); ctx.lineTo(c, size - 2);
    ctx.moveTo(2, c); ctx.lineTo(size - 2, c);
    ctx.stroke();

    // Sweep wedge with fading trail.
    for (let i = 0; i < 14; i++) {
      const a = this.radarAngle - i * 0.055;
      ctx.strokeStyle = `rgba(120, 240, 130, ${0.4 * (1 - i / 14)})`;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a) * (c - 3), c + Math.sin(a) * (c - 3));
      ctx.stroke();
    }

    // Blips light up as the sweep passes them, then fade.
    for (const b of this.radarBlips) {
      b.age += dt;
      const delta = Math.abs((((this.radarAngle - b.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      if (delta < 0.1) b.age = 0;
      if (b.age > 6) {
        b.angle = Math.random() * Math.PI * 2;
        b.dist = 0.3 + Math.random() * 0.6;
        b.age = 3;
      }
      const alpha = Math.max(0, 1 - b.age / 2.4);
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(255, 110, 80, ${alpha})`;
      ctx.beginPath();
      ctx.arc(c + Math.cos(b.angle) * c * b.dist, c + Math.sin(b.angle) * c * b.dist, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (className) e.className = className;
  return e;
}
