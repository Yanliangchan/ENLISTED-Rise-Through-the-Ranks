import type { Api, MatchResult } from "~/net/api";
import type { Quality } from "~/core/engine";

export interface Settings {
  sensitivity: number;
  volume: number;
  quality: Quality;
  fov: number;
}

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, volume: 0.8, quality: "medium", fov: 74 };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem("enlisted.settings3") ?? "{}") as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export type Mode = "operation" | "holdout";

export interface Debrief {
  mode: Mode;
  success: boolean;
  title: string;
  line: string;
  kills: number;
  headshots: number;
  accuracy: number;
  seconds: number;
  score: number;
  waves: number;
  objectives: number;
  result: Promise<MatchResult | null>;
}

export interface MenuHandlers {
  deploy(mode: Mode): void;
  resume(): void;
  abort(): void;
  settings(s: Settings): void;
  sound(kind: "hover" | "click" | "confirm" | "deny"): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Front end, pause and debrief screens. Plain DOM over the live 3D scene. */
export class Menus {
  private readonly root: HTMLDivElement;
  private readonly load: HTMLDivElement;
  private screen: "none" | "main" | "pause" | "debrief" = "none";
  private lastMode: Mode = "operation";

  constructor(parent: HTMLElement, private readonly api: Api, readonly settings: Settings, private readonly on: MenuHandlers) {
    this.root = document.createElement("div");
    this.root.className = "menu";
    parent.appendChild(this.root);
    this.load = document.createElement("div");
    this.load.className = "load";
    this.load.innerHTML = `<h1>ENLISTED</h1><p>PREPARING AREA OF OPERATIONS</p><div class="ln"><i></i></div>`;
    parent.appendChild(this.load);
    this.root.addEventListener("mouseover", (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "BUTTON" && !(e.relatedTarget && t.contains(e.relatedTarget as Node))) this.on.sound("hover");
    });
    this.root.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
      if (!t) return;
      this.on.sound("click");
      this.act(t.dataset.a!, t.dataset.v);
    });
  }

  get open(): boolean {
    return this.screen !== "none";
  }

  loaded(): void {
    this.load.classList.add("off");
    setTimeout(() => this.load.remove(), 900);
  }

  hide(): void {
    this.screen = "none";
    this.root.classList.remove("on");
    this.root.innerHTML = "";
  }

  private who(): string {
    const p = this.api.profile;
    if (!p) return `<div class="who"><span>Not signed in — progress will not be recorded.</span><a data-a="signin">Sign in with a callsign</a></div>`;
    return `<div class="who"><span class="ins">${esc(p.rank.insignia)}</span><b>${esc(p.username.toUpperCase())}</b><span>${esc(p.rank.name)}</span><a data-a="signout">Sign out</a></div>`;
  }

  showMain(panel = ""): void {
    this.screen = "main";
    this.root.className = "menu on";
    this.root.innerHTML = `<div class="shade"></div>
      <div class="col">
        <div class="brand"><div class="k">SINGAPORE ARMED FORCES · 3 SIR</div><h1>ENLISTED</h1>
        <p>Nee Soon Estate has been seized. Your section goes in on foot, block by block, to take it back.</p></div>
        <div class="nav">
          <button class="pri" data-a="deploy" data-v="operation">Operation Swift Lion<small>Retake the estate. Four objectives, one section.</small></button>
          <button data-a="deploy" data-v="holdout">Holdout<small>Hold the junction against wave after wave.</small></button>
          <button data-a="record">Service Record</button>
          <button data-a="board">Leaderboard</button>
          <button data-a="settings">Settings</button>
        </div>
      </div>${this.who()}
      <div class="ver">NEE SOON ESTATE · 1740H<br>SAR 21 · 5.56 MM</div>${panel}`;
  }

  showPause(): void {
    this.screen = "pause";
    this.root.className = "menu solid on";
    this.root.innerHTML = `<div class="shade"></div><div class="col"><div class="brand"><div class="k">PAUSED</div><h1 style="font-size:70px">STAND BY</h1></div>
      <div class="nav"><button class="pri" data-a="resume">Resume</button><button data-a="settings">Settings</button><button data-a="controls">Controls</button><button data-a="restart">Restart</button><button data-a="abort">Abort to Menu</button></div></div>`;
  }

  showDebrief(d: Debrief): void {
    this.screen = "debrief";
    this.lastMode = d.mode;
    this.root.className = "menu solid on";
    const third = d.mode === "holdout" ? ["WAVES HELD", String(d.waves)] : ["OBJECTIVES", `${d.objectives}/4`];
    this.root.innerHTML = `<div class="shade"></div><div class="panel center" style="width:min(600px,90vw)">
      <div class="kick">${d.success ? "MISSION COMPLETE" : d.mode === "holdout" ? "POSITION OVERRUN" : "MISSION FAILED"}</div><h2>${esc(d.title)}</h2><p>${esc(d.line)}</p>
      <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat"><div class="l">KILLS</div><div class="v">${d.kills}</div></div>
        <div class="stat"><div class="l">HEADSHOTS</div><div class="v">${d.headshots}</div></div>
        <div class="stat"><div class="l">ACCURACY</div><div class="v">${d.accuracy}%</div></div>
        <div class="stat"><div class="l">${third[0]}</div><div class="v">${third[1]}</div></div>
        <div class="stat"><div class="l">TIME</div><div class="v">${clock(d.seconds)}</div></div>
        <div class="stat"><div class="l">SCORE</div><div class="v">${d.score}</div></div>
      </div>
      <div id="career" style="margin-top:22px;min-height:64px"><p>${this.api.profile ? "Filing after-action report…" : "Sign in with a callsign from the main menu to record your career."}</p></div>
      <div class="acts"><button class="btn" data-a="deploy" data-v="${d.mode}">Redeploy</button><button class="btn sec" data-a="abort">Main Menu</button></div></div>`;
    void d.result.then((r) => {
      const c = this.root.querySelector("#career");
      if (!c || this.screen !== "debrief") return;
      if (!r) {
        if (this.api.profile) c.innerHTML = `<p>Report could not be filed — the record server is unreachable.</p>`;
        return;
      }
      const rk = r.profile?.rank;
      const pct = rk && rk.xpForNextRank ? Math.min(100, (rk.xpIntoRank / rk.xpForNextRank) * 100) : 100;
      c.innerHTML = `<div class="stat"><div class="l">${r.rankUp ? `PROMOTED · ${esc(r.rankUp.to.toUpperCase())}` : esc((rk?.name ?? "").toUpperCase())}</div><div class="v" style="color:var(--amber)">+${r.xpGained} XP</div></div>
        <div class="xp"><i style="width:0"></i></div>${r.newBadges.length ? `<p>Awarded: ${r.newBadges.map((b) => esc(b.name)).join(", ")}</p>` : ""}`;
      requestAnimationFrame(() => ((c.querySelector(".xp i") as HTMLElement).style.width = `${pct}%`));
      if (r.rankUp) this.on.sound("confirm");
    });
  }

  private panel(html: string): void {
    this.root.querySelector(".panel")?.remove();
    const d = document.createElement("div");
    d.className = "panel";
    d.innerHTML = `<div class="x" data-a="close">CLOSE</div>${html}`;
    this.root.appendChild(d);
  }

  private settingsPanel(): void {
    const s = this.settings;
    const seg = (q: string): string => `<button data-a="quality" data-v="${q}" class="${s.quality === q ? "on" : ""}">${q}</button>`;
    this.panel(`<div class="kick">CONFIGURATION</div><h2>Settings</h2>
      <div class="field"><label>Look sensitivity<span id="v-sens">${s.sensitivity.toFixed(2)}</span></label><input type="range" id="sens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"></div>
      <div class="field"><label>Field of view<span id="v-fov">${s.fov}</span></label><input type="range" id="fov" min="60" max="95" step="1" value="${s.fov}"></div>
      <div class="field"><label>Master volume<span id="v-vol">${Math.round(s.volume * 100)}</span></label><input type="range" id="vol" min="0" max="1" step="0.01" value="${s.volume}"></div>
      <div class="field"><label>Graphics quality</label><div class="seg">${seg("low")}${seg("medium")}${seg("high")}${seg("ultra")}</div></div>
      <p>Lower the quality if the frame rate struggles. Ultra adds sharper shadows and full-resolution ambient occlusion.</p>`);
    const bind = (id: string, apply: (v: number) => string): void => {
      const inp = this.root.querySelector<HTMLInputElement>(`#${id}`)!;
      inp.addEventListener("input", () => {
        this.root.querySelector(`#v-${id}`)!.textContent = apply(Number(inp.value));
        this.commit();
      });
    };
    bind("sens", (v) => ((s.sensitivity = v), v.toFixed(2)));
    bind("fov", (v) => ((s.fov = v), String(v)));
    bind("vol", (v) => ((s.volume = v), String(Math.round(v * 100))));
  }

  private commit(): void {
    try {
      localStorage.setItem("enlisted.settings3", JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.on.settings(this.settings);
  }

  private controlsPanel(): void {
    const k = (a: string, b: string): string => `<kbd>${a}</kbd><span>${b}</span>`;
    this.panel(`<div class="kick">FIELD MANUAL</div><h2>Controls</h2><div class="keys">
      ${k("W A S D", "Move")}${k("MOUSE", "Look")}${k("LMB", "Fire")}${k("RMB", "Aim down sights")}${k("SHIFT", "Sprint")}${k("C", "Crouch")}${k("Z", "Prone / crawl")}${k("SPACE", "Jump / vault")}
      ${k("Q  E", "Lean left / right")}${k("R", "Reload")}${k("1  2  3", "Primary / sidearm / launcher")}${k("V", "Fire selector")}${k("G", "Throw fragmentation grenade")}${k("F", "Interact")}${k("ESC", "Pause")}</div>`);
  }

  private recordPanel(): void {
    const p = this.api.profile;
    if (!p) {
      this.signinPanel();
      return;
    }
    const st = p.stats;
    const pct = p.rank.xpForNextRank ? Math.min(100, (p.rank.xpIntoRank / p.rank.xpForNextRank) * 100) : 100;
    const cell = (l: string, v: string | number): string => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`;
    const earned = p.badges.filter((b) => b.unlocked);
    this.panel(`<div class="kick">${esc(p.rank.insignia)} · ${esc(p.careerTrack.toUpperCase())}</div><h2>${esc(p.username)}</h2>
      <p>${esc(p.rank.name)}${p.rank.xpForNextRank ? ` — ${p.rank.xpIntoRank} / ${p.rank.xpForNextRank} XP to next rank` : " — highest rank attained"}</p><div class="xp"><i style="width:${pct}%"></i></div>
      <div class="grid">${cell("DEPLOYMENTS", st.gamesPlayed)}${cell("KILLS", st.kills)}${cell("HEADSHOTS", st.headshots)}${cell("ACCURACY", `${Math.round(p.accuracyPct)}%`)}${cell("BEST DEPLOYMENT", st.bestGameKills)}${cell("TIME IN FIELD", clock(st.playtimeSec))}</div>
      <p style="margin-top:18px">${earned.length ? `Badges: ${earned.map((b) => esc(b.name)).join(" · ")}` : "No skill badges earned yet."}</p>`);
  }

  private signinPanel(): void {
    this.panel(`<div class="kick">IDENTIFICATION</div><h2>Callsign</h2><p>Enter a callsign to keep a service record: rank, career statistics and leaderboard standing. No password is required.</p>
      <div class="field"><label>Callsign</label><input type="text" id="cs" maxlength="16" spellcheck="false" autocomplete="off" value="${esc(this.api.savedCallsign)}"></div>
      <div class="err" id="cs-err"></div><div class="acts"><button class="btn" data-a="login">Report for duty</button></div>`);
    const inp = this.root.querySelector<HTMLInputElement>("#cs")!;
    inp.focus();
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.act("login");
    });
  }

  private async boardPanel(): Promise<void> {
    this.panel(`<div class="kick">ALL UNITS</div><h2>Leaderboard</h2><p id="bd">Retrieving records…</p>`);
    const rows = await this.api.leaderboard("total_kills");
    const p = this.root.querySelector("#bd");
    if (!p) return;
    if (!rows) p.textContent = "The record server is unreachable.";
    else if (rows.length === 0) p.textContent = "No records filed yet. Be the first.";
    else p.outerHTML = `<p>Career kills, all soldiers.</p><table class="board">${rows.map((r) => `<tr><td>${String(r.rank).padStart(2, "0")}</td><td><span class="ins">${esc(r.rankInsignia)}</span>${esc(r.username)}</td><td>${r.value}</td></tr>`).join("")}</table>`;
  }

  private act(a: string, v?: string): void {
    switch (a) {
      case "deploy":
        this.on.deploy((v as Mode) ?? this.lastMode);
        break;
      case "restart":
        this.on.deploy(this.lastMode);
        break;
      case "resume":
        this.on.resume();
        break;
      case "abort":
        this.on.abort();
        break;
      case "settings":
        this.settingsPanel();
        break;
      case "controls":
        this.controlsPanel();
        break;
      case "record":
        this.recordPanel();
        break;
      case "board":
        void this.boardPanel();
        break;
      case "signin":
        this.signinPanel();
        break;
      case "signout":
        this.api.logout();
        this.showMain();
        break;
      case "close":
        this.root.querySelector(".panel")?.remove();
        break;
      case "quality":
        this.settings.quality = v as Quality;
        this.commit();
        this.settingsPanel();
        break;
      case "login": {
        const inp = this.root.querySelector<HTMLInputElement>("#cs");
        const err = this.root.querySelector("#cs-err");
        if (!inp || !err) return;
        err.textContent = "";
        this.api.login(inp.value.trim()).then(
          () => {
            this.on.sound("confirm");
            this.showMain();
          },
          (e: Error) => {
            this.on.sound("deny");
            err.textContent = e.message;
          }
        );
        break;
      }
    }
  }

  setMode(m: Mode): void {
    this.lastMode = m;
  }

  refreshMain(): void {
    if (this.screen === "main" && !this.root.querySelector(".panel")) this.showMain();
  }
}
