const el = (cls: string, parent: HTMLElement, html = ""): HTMLDivElement => {
  const d = document.createElement("div");
  d.className = cls;
  if (html) d.innerHTML = html;
  parent.appendChild(d);
  return d;
};

const PX_PER_DEG = 3.4;

/** Reticles as SVG on a 200-unit square that spans the scope's field. */
const RETICLES: Record<"mil" | "sar" | "dot", string> = {
  // M110: thin duplex crosshair with mil-dots, heavy posts toward the edge.
  mil: (() => {
    let d = "";
    for (let i = -4; i <= 4; i++) if (i) d += `<circle cx="${100 + i * 9}" cy="100" r="1.1"/><circle cx="100" cy="${100 + i * 9}" r="1.1"/>`;
    return `<path d="M0 100H200M100 0V200" stroke="#0a0a0a" stroke-width=".45" fill="none"/><path d="M0 100H58M142 100H200M100 142V200M100 0V58" stroke="#0a0a0a" stroke-width="2.2"/><g fill="#0a0a0a">${d}</g>`;
  })(),
  // SAR 21: open ring, a post rising from below, bars in from the sides, a centre dot.
  // Red dot seen through the 3× magnifier: ring and dot, both glowing.
  dot: `<circle cx="100" cy="100" r="34" stroke="#ff3a24" stroke-width="1.1" fill="none" opacity=".85"/><circle cx="100" cy="100" r="1.8" fill="#ff4a30"/><circle cx="100" cy="100" r="4" fill="#ff4a30" opacity=".25"/>`,
  sar: `<circle cx="100" cy="100" r="15" stroke="#0a0a0a" stroke-width="1.2" fill="none"/><path d="M100 118V200M0 100H82M118 100H200" stroke="#0a0a0a" stroke-width="2"/><circle cx="100" cy="100" r="1.4" fill="#c8241a"/>`,
};

/** In-game heads-up display. Every setter caches its last value, so calling them each frame costs nothing. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly tape: HTMLDivElement;
  private readonly objMark: HTMLDivElement;
  private readonly bearing: HTMLDivElement;
  private readonly obj: HTMLDivElement;
  private readonly vit: HTMLDivElement;
  private readonly hpBar: HTMLElement;
  private readonly hpNum: HTMLElement;
  private readonly stance: HTMLDivElement;
  private readonly wpn: HTMLDivElement;
  private readonly xh: HTMLDivElement;
  private readonly xhParts: HTMLElement[];
  private readonly hm: HTMLDivElement;
  private readonly dmg: HTMLElement[] = [];
  private readonly dmgT = [0, 0, 0, 0];
  private readonly dmgA = [0, 0, 0, 0];
  private dmgI = 0;
  private readonly feedEl: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private subT = 0;
  private readonly subQueue: Array<[string, string, number]> = [];
  private readonly promptEl: HTMLDivElement;
  private readonly mk: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  readonly fade: HTMLDivElement;
  private scopeEl!: HTMLDivElement;
  private readonly marks: HTMLDivElement[] = [];
  private readonly ticks: HTMLDivElement[] = [];
  private cache: Record<string, string | number | boolean> = {};

  constructor(parent: HTMLElement) {
    this.root = el("hud", parent);
    const compass = el("compass", this.root);
    this.tape = el("tape", compass);
    const cards: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
    let html = "";
    for (let d = -360; d <= 720; d += 5) {
      const x = d * PX_PER_DEG;
      const n = ((d % 360) + 360) % 360;
      html += `<i class="tk${n % 15 === 0 ? " maj" : ""}" style="left:${x}px"></i>`;
      if (n % 45 === 0) html += `<span class="lb card" style="left:${x}px">${cards[n]}</span>`;
      else if (n % 15 === 0) html += `<span class="lb mono" style="left:${x}px;font-size:11px;top:15px">${String(n).padStart(3, "0")}</span>`;
    }
    this.tape.innerHTML = html;
    el("compass-needle", this.root);
    this.objMark = el("compass-obj", compass);
    this.bearing = el("bearing mono", this.root);
    this.obj = el("obj", this.root, `<div class="op"></div><div class="ti"></div><div class="de"></div><div class="rule"></div>`);
    const status = el("status", this.root);
    this.vit = el("vit", status, `<div class="row"><span>VITALS</span><b>100</b></div><div class="bar"><i></i></div>`);
    this.hpBar = this.vit.querySelector("i")!;
    this.hpNum = this.vit.querySelector("b")!;
    this.stance = el("stance", status, "STANDING");
    this.wpn = el("wpn", this.root, `<div class="nm"></div><div class="am"><b>30</b><span>150</span></div><div class="mt"><div class="fm"></div><div class="gr"></div></div><div class="slots"></div>`);
    this.scopeEl = el("scope", this.root, `<svg class="ret" viewBox="0 0 200 200"></svg><div class="zm mono"></div><div class="br"><b></b><span>SHIFT  HOLD BREATH</span></div>`);
    const marks = el("marks", this.root);
    for (let i = 0; i < 10; i++) this.marks.push(el("em", marks));
    for (let i = 0; i < 8; i++) this.ticks.push(el("ct", this.tape.parentElement as HTMLDivElement));
    this.xh = el("xh", this.root, `<i class="l"></i><i class="r"></i><i class="u"></i><i class="d"></i><i class="c"></i>`);
    this.xhParts = Array.from(this.xh.querySelectorAll("i"));
    this.hm = el("hm", this.root);
    const dmg = el("dmg", this.root);
    for (let i = 0; i < 4; i++) {
      const d = document.createElement("i");
      dmg.appendChild(d);
      this.dmg.push(d);
    }
    this.feedEl = el("feed", this.root);
    this.sub = el("sub", this.root);
    this.promptEl = el("prompt", this.root, `<div class="tx"></div><div class="pg"><i></i></div>`);
    this.mk = el("mk", this.root, `<div class="d"></div><div class="m"></div>`);
    this.bannerEl = el("banner", this.root, `<div class="a"></div><div class="b"></div>`);
    this.timerEl = el("timer", this.root);
    this.fade = el("fade", parent);
  }

  private set(key: string, v: string | number | boolean): boolean {
    if (this.cache[key] === v) return false;
    this.cache[key] = v;
    return true;
  }

  show(on: boolean): void {
    this.root.classList.toggle("on", on);
  }

  reset(): void {
    this.feedEl.innerHTML = "";
    this.subQueue.length = 0;
    this.subT = 0;
    this.sub.classList.remove("on");
    this.prompt(null);
    this.timer(null);
    this.marker(false, 0, 0, 0);
  }

  /** `bearing` and `objBearing` in degrees, 0 = north, clockwise. */
  compass(bearing: number, objBearing: number | null): void {
    const b = ((bearing % 360) + 360) % 360;
    if (this.set("cb", Math.round(b * 4))) {
      this.tape.style.transform = `translateX(${(-b * PX_PER_DEG).toFixed(1)}px)`;
      this.bearing.textContent = String(Math.round(b) % 360).padStart(3, "0");
    }
    if (objBearing === null) {
      if (this.set("co", "x")) this.objMark.style.display = "none";
    } else {
      let d = ((objBearing - b + 540) % 360) - 180;
      d = Math.max(-58, Math.min(58, d));
      if (this.set("co", Math.round(d * 4))) {
        this.objMark.style.display = "";
        this.objMark.style.transform = `translateX(${(d * PX_PER_DEG).toFixed(1)}px)`;
      }
    }
  }

  objective(op: string, title: string, detail: string): void {
    if (this.set("op", op)) this.obj.children[0].textContent = op;
    if (this.set("ot", title)) {
      this.obj.children[1].textContent = title;
      this.obj.classList.remove("flash");
      void this.obj.offsetWidth;
      this.obj.classList.add("flash");
    }
    if (this.set("od", detail)) this.obj.children[2].textContent = detail;
  }

  health(hp: number): void {
    const v = Math.max(0, Math.ceil(hp));
    if (!this.set("hp", v)) return;
    this.hpBar.style.transform = `scaleX(${v / 100})`;
    this.hpNum.textContent = String(v);
    this.vit.classList.toggle("low", v < 35);
  }

  setStance(stance: "stand" | "crouch" | "prone", sprint: boolean): void {
    const s = sprint ? "SPRINT" : stance === "prone" ? "PRONE" : stance === "crouch" ? "CROUCHED" : "STANDING";
    if (this.set("st", s)) this.stance.textContent = s;
  }

  weapon(name: string, ammo: number, reserve: number, mode: string, reloading: boolean, nades: number, magSize: number): void {
    if (this.set("wn", name)) this.wpn.children[0].textContent = name;
    if (this.set("wa", `${ammo}/${reserve}/${reloading}`)) {
      this.wpn.children[1].innerHTML = reloading ? `<b style="font-size:26px;letter-spacing:.1em">RELOADING</b>` : `<b>${String(ammo).padStart(2, "0")}</b><span>${String(reserve).padStart(3, "0")}</span>`;
      this.wpn.classList.toggle("low", ammo > 0 && ammo <= magSize * 0.27);
      this.wpn.classList.toggle("empty", ammo === 0);
    }
    if (this.set("wf", mode)) this.wpn.querySelector(".fm")!.innerHTML = mode === "SAFE" ? `<em style="color:var(--amber)">WEAPONS SAFE</em>` : `<em>${mode}</em>`;
    if (this.set("wg", nades)) {
      let p = "";
      for (let i = 0; i < 3; i++) p += `<i class="${i < nades ? "" : "off"}"></i>`;
      this.wpn.querySelector(".gr")!.innerHTML = `FRAG<span class="pips">${p}</span>`;
    }
  }

  /** Carried weapons, the active slot highlighted. */
  slots(names: string[], active: number): void {
    if (!this.set("sl", names.join("|") + active)) return;
    this.wpn.querySelector(".slots")!.innerHTML = names.map((n, i) => `<span class="${i === active ? "on" : ""}"><b>${i + 1}</b>${n}</span>`).join("");
  }

  scope(v: { style: "mil" | "sar" | "dot"; mag: number; breath: number } | null): void {
    if (this.set("sc", !!v)) this.scopeEl.classList.toggle("on", !!v);
    if (!v) return;
    if (this.set("ss", v.style)) {
      this.scopeEl.querySelector(".ret")!.innerHTML = RETICLES[v.style];
      this.scopeEl.classList.toggle("wide", v.style !== "mil");
    }
    if (this.set("sm", v.mag)) this.scopeEl.querySelector(".zm")!.textContent = `${v.mag.toFixed(1)}×`;
    const b = Math.round(v.breath * 40);
    if (this.set("sb", b)) (this.scopeEl.querySelector(".br b") as HTMLElement).style.width = `${b * 2.5}%`;
  }

  /** Spotted enemies: screen position (px) and fade, nearest first. */
  enemyMarks(items: Array<[number, number, number]>): void {
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      const it = items[i];
      if (!it) {
        if (m.style.display !== "none") m.style.display = "none";
        continue;
      }
      m.style.display = "block";
      m.style.transform = `translate(${it[0].toFixed(0)}px,${it[1].toFixed(0)}px)`;
      m.style.opacity = it[2].toFixed(2);
    }
  }

  /** Red ticks on the compass for enemies that are shooting at you or have been spotted. */
  threats(bearings: number[], heading: number): void {
    const h = ((heading % 360) + 360) % 360;
    for (let i = 0; i < this.ticks.length; i++) {
      const t = this.ticks[i];
      if (i >= bearings.length) {
        if (t.style.display !== "none") t.style.display = "none";
        continue;
      }
      const d = ((bearings[i] - h + 540) % 360) - 180;
      if (Math.abs(d) > 64) {
        t.style.display = "none";
        continue;
      }
      t.style.display = "block";
      t.style.transform = `translateX(${(d * PX_PER_DEG).toFixed(1)}px)`;
    }
  }

  /** Spread half-angle in degrees → crosshair gap in pixels for the current vertical FOV. */
  crosshair(spreadDeg: number, fovDeg: number, visible: boolean): void {
    if (this.set("xv", visible)) this.xh.style.opacity = visible ? "1" : "0";
    if (!visible) return;
    const px = Math.max(5, (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan((fovDeg * Math.PI) / 360)) * (window.innerHeight / 2));
    const g = Math.round(px);
    if (!this.set("xg", g)) return;
    const [l, r, u, d] = this.xhParts;
    l.style.left = `${-g - 8}px`;
    r.style.left = `${g}px`;
    u.style.top = `${-g - 8}px`;
    d.style.top = `${g}px`;
  }

  hitmarker(kill: boolean): void {
    this.hm.classList.remove("go");
    this.hm.classList.toggle("kill", kill);
    void this.hm.offsetWidth;
    this.hm.classList.add("go");
  }

  /** `angle`: direction of the attacker relative to where the player looks, radians clockwise. */
  damageFrom(angle: number): void {
    const i = this.dmgI++ % 4;
    this.dmgT[i] = 1.4;
    this.dmgA[i] = angle;
  }

  feed(text: string, tag = ""): void {
    const d = document.createElement("div");
    d.innerHTML = `${text}${tag ? `<b>${tag}</b>` : ""}`;
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild!.remove();
    setTimeout(() => d.remove(), 5100);
  }

  subtitle(speaker: string, text: string, seconds = 4.5): void {
    this.subQueue.push([speaker, text, seconds]);
  }

  prompt(text: string | null, key = "F", progress = -1): void {
    if (this.set("pt", text ?? "")) {
      this.promptEl.classList.toggle("on", text !== null);
      if (text !== null) this.promptEl.children[0].innerHTML = `<kbd>${key}</kbd>${text}`;
    }
    const p = Math.round(Math.max(0, progress) * 100);
    if (this.set("pp", progress < 0 ? -1 : p)) {
      (this.promptEl.children[1] as HTMLElement).style.visibility = progress < 0 ? "hidden" : "visible";
      (this.promptEl.children[1].firstChild as HTMLElement).style.width = `${p}%`;
    }
  }

  marker(visible: boolean, x: number, y: number, metres: number): void {
    if (this.set("mv", visible)) this.mk.style.display = visible ? "" : "none";
    if (!visible) return;
    this.mk.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
    const m = Math.round(metres);
    if (this.set("mm", m)) this.mk.children[1].textContent = `${m} m`;
  }

  banner(kicker: string, title: string): void {
    this.bannerEl.children[0].textContent = kicker;
    this.bannerEl.children[1].textContent = title;
    this.bannerEl.classList.remove("go");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("go");
  }

  timer(seconds: number | null): void {
    const s = seconds === null ? -1 : Math.ceil(seconds);
    if (!this.set("tm", s)) return;
    this.timerEl.classList.toggle("on", s >= 0);
    if (s >= 0) this.timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  update(dt: number): boolean {
    let spoke = false;
    for (let i = 0; i < 4; i++) {
      if (this.dmgT[i] <= 0) continue;
      this.dmgT[i] -= dt;
      const o = Math.max(0, Math.min(1, this.dmgT[i]));
      this.dmg[i].style.opacity = o.toFixed(2);
      this.dmg[i].style.transform = `rotate(${this.dmgA[i].toFixed(3)}rad)`;
    }
    this.subT -= dt;
    if (this.subT <= 0) {
      const next = this.subQueue.shift();
      if (next) {
        this.sub.innerHTML = `<b>${next[0]}</b>${next[1]}`;
        this.sub.classList.add("on");
        this.subT = next[2];
        spoke = true;
      } else this.sub.classList.remove("on");
    }
    return spoke;
  }
}
