import { NetClient } from "@/net/NetClient";
import type { RoomState, RoomSettings, Team, ServerMsg, LobbyPlayer } from "@/net/protocol";
import { DEFAULT_SETTINGS } from "@/net/protocol";

export interface MatchStartInfo {
  settings: RoomSettings;
  team: Team;
  spawn: { x: number; y: number; z: number };
  players: LobbyPlayer[];
}

/**
 * Private-room multiplayer front-end: Create/Join → Lobby → team select →
 * ready → host starts. Owns the NetClient connection while the menu is open and
 * hands it off (still connected) to the match layer on match start.
 */
export class MultiplayerMenu {
  private root: HTMLDivElement;
  private net = new NetClient();
  private room: RoomState | null = null;
  private off: (() => void) | null = null;
  private pingRefresh: ReturnType<typeof setInterval> | null = null;
  visible = false;

  onClose?: () => void;
  onStartMatch?: (net: NetClient, info: MatchStartInfo) => void;
  onViewProfile?: (name: string) => void;

  constructor(
    parent: HTMLElement,
    private readonly identity: { token?: string; name: string; rankInsignia: string; rankName: string },
  ) {
    this.root = document.createElement("div");
    this.root.className = "mp-root";
    this.root.style.cssText =
      "position:fixed; inset:0; z-index:60; display:none; background:rgba(8,11,9,0.92); color:#cfe6c0;" +
      "font-family:Consolas,'Courier New',monospace; align-items:center; justify-content:center;";
    parent.appendChild(this.root);
    this.injectStyles();
  }

  private injectStyles(): void {
    if (document.getElementById("mp-styles")) return;
    const s = document.createElement("style");
    s.id = "mp-styles";
    s.textContent = `
      .mp-panel{background:rgba(18,24,18,0.96);border:1px solid #3c4a34;min-width:420px;max-width:900px;padding:26px 30px;box-shadow:0 12px 60px rgba(0,0,0,.6)}
      .mp-title{font-size:20px;letter-spacing:3px;color:#e8f2d8;margin:0 0 4px}
      .mp-sub{font-size:12px;color:#8fa47e;letter-spacing:1px;margin:0 0 20px}
      .mp-btn{display:block;width:100%;background:rgba(30,40,28,0.9);color:#cfe6c0;border:1px solid #4a5c3c;padding:13px;margin:8px 0;font-family:inherit;font-size:14px;letter-spacing:2px;cursor:pointer;transition:background .12s}
      .mp-btn:hover{background:rgba(52,70,44,0.95)}
      .mp-btn.primary{background:#3f6b2f;border-color:#5c9a45;color:#eaffdc}
      .mp-btn.primary:hover{background:#4d8039}
      .mp-btn.danger{border-color:#7a3a34;color:#e0b0aa}
      .mp-btn:disabled{opacity:.4;cursor:not-allowed}
      .mp-btn.sm{display:inline-block;width:auto;padding:6px 12px;font-size:11px;margin:0 4px 0 0}
      .mp-row{display:flex;justify-content:space-between;align-items:center;margin:9px 0;font-size:13px}
      .mp-input{background:#0e140d;border:1px solid #4a5c3c;color:#eaffdc;font-family:inherit;font-size:22px;letter-spacing:8px;text-align:center;padding:12px;width:100%;text-transform:uppercase}
      .mp-select{background:#0e140d;border:1px solid #4a5c3c;color:#cfe6c0;font-family:inherit;padding:6px 8px}
      .mp-err{color:#e0857a;font-size:12px;min-height:16px;margin:8px 0}
      .mp-code{font-size:30px;letter-spacing:10px;color:#eaffdc;background:#0e140d;border:1px dashed #5c9a45;padding:10px 18px;text-align:center;cursor:copy}
      .mp-teams{display:flex;gap:16px;margin:14px 0}
      .mp-team{flex:1;border:1px solid #3c4a34;padding:12px;min-height:180px}
      .mp-team.blue{border-top:3px solid #4d8fd6}
      .mp-team.red{border-top:3px solid #d65b4d}
      .mp-team h4{margin:0 0 10px;letter-spacing:2px;font-size:13px}
      .mp-pcard{display:flex;align-items:center;gap:8px;background:rgba(30,40,28,0.7);border:1px solid #33402c;padding:7px 9px;margin:6px 0;font-size:12px}
      .mp-ins{background:#2a3a22;border:1px solid #5c9a45;color:#d8f0c0;font-size:10px;padding:2px 5px;letter-spacing:1px}
      .mp-name{flex:1;cursor:pointer}
      .mp-name:hover{text-decoration:underline}
      .mp-ping{color:#8fa47e;font-size:10px}
      .mp-dot{width:9px;height:9px;border-radius:50%}
      .mp-dot.on{background:#5c9a45;box-shadow:0 0 6px #5c9a45}
      .mp-dot.off{background:#5a5a52}
      .mp-host{color:#e8c86a;font-size:9px}
    `;
    document.head.appendChild(s);
  }

  open(): void {
    this.visible = true;
    this.root.style.display = "flex";
    this.renderConnecting();
    this.net = new NetClient();
    this.off = this.net.on((m) => this.onServer(m));
    this.net.onClose = () => {
      if (this.visible && !this.room?.inMatch) this.renderError("Disconnected from the multiplayer server.");
    };
    this.net.connect(this.identity).then(() => this.renderMain()).catch((e) => this.renderError(e.message ?? "Connection failed."));
    if (!this.pingRefresh) this.pingRefresh = setInterval(() => { if (this.visible && this.room && !this.room.inMatch) this.updatePings(); }, 2000);
  }

  close(): void {
    this.visible = false;
    this.root.style.display = "none";
    this.off?.();
    this.net.send({ t: "leave" });
    this.net.disconnect();
    if (this.pingRefresh) { clearInterval(this.pingRefresh); this.pingRefresh = null; }
    this.room = null;
    this.onClose?.();
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case "roomState":
        this.room = m.room;
        if (!m.room.inMatch) this.renderLobby();
        break;
      case "error":
        this.showError(m.message);
        break;
      case "kicked":
        this.room = null;
        this.renderMain("You were removed from the room by the host.");
        break;
      case "matchStart":
        // hand the live socket to the match layer; menu steps aside.
        this.visible = false;
        this.root.style.display = "none";
        this.off?.();
        this.onStartMatch?.(this.net, { settings: m.settings, team: m.you.team, spawn: m.you.spawn, players: m.players });
        break;
    }
  }

  private me(): LobbyPlayer | undefined {
    return this.room?.players.find((p) => p.id === this.net.playerId);
  }
  private isHost(): boolean {
    return this.room?.hostId === this.net.playerId;
  }

  // ---- screens -------------------------------------------------------------
  private panel(build: (p: HTMLDivElement) => void): void {
    this.root.innerHTML = "";
    const p = document.createElement("div");
    p.className = "mp-panel";
    build(p);
    this.root.appendChild(p);
  }
  private h(p: HTMLElement, title: string, sub: string): void {
    const t = document.createElement("h2"); t.className = "mp-title"; t.textContent = title; p.appendChild(t);
    const s = document.createElement("p"); s.className = "mp-sub"; s.textContent = sub; p.appendChild(s);
  }
  private button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button"); b.className = `mp-btn ${cls}`; b.textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  private renderConnecting(): void {
    this.panel((p) => { this.h(p, "MULTIPLAYER", "Connecting to secure lobby server…"); });
  }
  private renderError(msg: string): void {
    this.panel((p) => {
      this.h(p, "MULTIPLAYER", "Connection problem");
      const e = document.createElement("p"); e.className = "mp-err"; e.textContent = msg; p.appendChild(e);
      p.appendChild(this.button("RETRY", "primary", () => this.open()));
      p.appendChild(this.button("BACK", "", () => this.close()));
    });
  }

  private renderMain(notice = ""): void {
    this.panel((p) => {
      this.h(p, "MULTIPLAYER", "Private matches · 1v1 & 2v2");
      if (notice) { const n = document.createElement("p"); n.className = "mp-err"; n.textContent = notice; p.appendChild(n); }
      p.appendChild(this.button("CREATE ROOM", "primary", () => this.renderCreate()));
      p.appendChild(this.button("JOIN ROOM", "", () => this.renderJoin()));
      p.appendChild(this.button("BACK", "", () => this.close()));
    });
  }

  private renderCreate(): void {
    const s: RoomSettings = { ...DEFAULT_SETTINGS };
    this.panel((p) => {
      this.h(p, "CREATE ROOM", "Host a private match");
      const sel = (label: string, opts: Array<[string, string]>, val: string, on: (v: string) => void) => {
        const row = document.createElement("div"); row.className = "mp-row";
        const l = document.createElement("span"); l.textContent = label; row.appendChild(l);
        const e = document.createElement("select"); e.className = "mp-select";
        for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === val) o.selected = true; e.appendChild(o); }
        e.addEventListener("change", () => on(e.value)); row.appendChild(e); p.appendChild(row);
      };
      sel("Game Mode", [["tdm", "Team Deathmatch"], ["elim", "Elimination"]], s.mode, (v) => (s.mode = v as RoomSettings["mode"]));
      sel("Map", [["iron-citadel", "Operation Iron Citadel"]], s.map, (v) => (s.map = v));
      sel("Max Players", [["2", "2 (1v1)"], ["4", "4 (2v2)"]], String(s.maxPlayers), (v) => (s.maxPlayers = Number(v) as 2 | 4));
      sel("Friendly Fire", [["off", "Off"], ["on", "On"]], s.friendlyFire ? "on" : "off", (v) => (s.friendlyFire = v === "on"));
      sel("Score Limit (TDM)", [["10", "10"], ["25", "25"], ["50", "50"]], String(s.scoreLimit), (v) => (s.scoreLimit = Number(v)));
      sel("Rounds (Elim, best of)", [["3", "3"], ["5", "5"], ["7", "7"]], String(s.roundLimit), (v) => (s.roundLimit = Number(v)));
      sel("Time Limit", [["300", "5 min"], ["600", "10 min"], ["900", "15 min"]], String(s.timeLimitSec), (v) => (s.timeLimitSec = Number(v)));
      p.appendChild(this.button("CREATE", "primary", () => this.net.send({ t: "create", settings: s })));
      p.appendChild(this.button("BACK", "", () => this.renderMain()));
    });
  }

  private errEl: HTMLParagraphElement | null = null;
  private showError(msg: string): void {
    if (this.errEl) this.errEl.textContent = msg;
  }

  private renderJoin(): void {
    this.panel((p) => {
      this.h(p, "JOIN ROOM", "Enter the room code your friend shared");
      const input = document.createElement("input");
      input.className = "mp-input"; input.maxLength = 8; input.placeholder = "CODE";
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
      p.appendChild(input);
      const err = document.createElement("p"); err.className = "mp-err"; this.errEl = err; p.appendChild(err);
      const join = () => {
        const code = input.value.toUpperCase().trim();
        if (code.length < 6) { this.showError("Room codes are 6 characters."); return; }
        this.net.send({ t: "join", code });
      };
      p.appendChild(this.button("JOIN", "primary", join));
      p.appendChild(this.button("BACK", "", () => this.renderMain()));
      setTimeout(() => input.focus(), 30);
    });
  }

  private pingEls = new Map<string, HTMLElement>();
  private updatePings(): void {
    const me = this.me();
    if (me) { const el = this.pingEls.get(me.id); if (el) el.textContent = `${this.net.ping}ms`; }
  }

  private renderLobby(): void {
    const room = this.room; if (!room) return;
    this.pingEls.clear();
    this.panel((p) => {
      this.h(p, "LOBBY", `${room.settings.mode === "tdm" ? "Team Deathmatch" : "Elimination"} · Max ${room.settings.maxPlayers}`);
      // room code
      const code = document.createElement("div"); code.className = "mp-code"; code.textContent = room.code;
      code.title = "Click to copy";
      code.addEventListener("click", () => { void navigator.clipboard?.writeText(room.code); code.textContent = "COPIED!"; setTimeout(() => (code.textContent = room.code), 900); });
      p.appendChild(code);

      const teams = document.createElement("div"); teams.className = "mp-teams";
      const half = Math.floor(room.settings.maxPlayers / 2);
      const buildTeam = (team: Team, label: string) => {
        const col = document.createElement("div"); col.className = `mp-team ${team}`;
        const hd = document.createElement("h4"); const cnt = room.players.filter((pl) => pl.team === team).length;
        hd.textContent = `${label}  (${cnt}/${half})`; col.appendChild(hd);
        for (const pl of room.players.filter((x) => x.team === team)) col.appendChild(this.playerCard(pl, room));
        col.addEventListener("click", () => { if (this.me()?.team !== team) this.net.send({ t: "team", team }); });
        return col;
      };
      teams.appendChild(buildTeam("blue", "BLUE TEAM"));
      teams.appendChild(buildTeam("red", "RED TEAM"));
      p.appendChild(teams);

      const me = this.me();
      const ready = this.button(me?.ready ? "✓ READY" : "READY UP", me?.ready ? "primary" : "", () => this.net.send({ t: "ready", ready: !me?.ready }));
      p.appendChild(ready);

      if (this.isHost()) {
        const blue = room.players.filter((x) => x.team === "blue").length;
        const red = room.players.filter((x) => x.team === "red").length;
        const allReady = room.players.length >= 2 && room.players.every((x) => x.ready || x.id === room.hostId);
        const canStart = blue >= 1 && red >= 1 && allReady;
        const start = this.button(canStart ? "START MATCH" : "WAITING FOR PLAYERS…", "primary", () => this.net.send({ t: "start" }));
        start.disabled = !canStart;
        p.appendChild(start);
      } else {
        const note = document.createElement("p"); note.className = "mp-sub"; note.style.marginTop = "10px";
        note.textContent = "Waiting for the host to start the match…"; p.appendChild(note);
      }
      p.appendChild(this.button("LEAVE ROOM", "danger", () => { this.net.send({ t: "leave" }); this.room = null; this.renderMain(); }));
    });
  }

  private playerCard(pl: LobbyPlayer, room: RoomState): HTMLDivElement {
    const card = document.createElement("div"); card.className = "mp-pcard";
    const ins = document.createElement("span"); ins.className = "mp-ins"; ins.textContent = pl.rankInsignia; card.appendChild(ins);
    const name = document.createElement("span"); name.className = "mp-name"; name.textContent = pl.name;
    name.addEventListener("click", (e) => { e.stopPropagation(); this.onViewProfile?.(pl.name); });
    card.appendChild(name);
    if (pl.isHost) { const hs = document.createElement("span"); hs.className = "mp-host"; hs.textContent = "HOST"; card.appendChild(hs); }
    const ping = document.createElement("span"); ping.className = "mp-ping"; ping.textContent = `${pl.ping}ms`; this.pingEls.set(pl.id, ping); card.appendChild(ping);
    const dot = document.createElement("span"); dot.className = `mp-dot ${pl.ready ? "on" : "off"}`; card.appendChild(dot);
    if (this.isHost() && pl.id !== room.hostId) {
      const kick = document.createElement("button"); kick.className = "mp-btn sm danger"; kick.textContent = "✕";
      kick.title = "Remove player";
      kick.addEventListener("click", (e) => { e.stopPropagation(); this.net.send({ t: "kick", playerId: pl.id }); });
      card.appendChild(kick);
    }
    return card;
  }
}
