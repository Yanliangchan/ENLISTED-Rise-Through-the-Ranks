import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type {
  ClientMsg,
  ServerMsg,
  RoomSettings,
  Team,
  LobbyPlayer,
  RoomState,
  PlayerNetState,
  MatchPlayerResult,
} from "./protocol.js";
import { DEFAULT_SETTINGS, MAX_PLAYERS } from "./protocol.js";

/**
 * Authoritative private-room server for 1v1 / 2v2 matches.
 *
 * Scope of authority: the server owns room lifecycle, lobby state, team
 * assignment, match start, scoring and win conditions. During a match it
 * relays player transforms (snapshot fan-out) and validates kills/scores from
 * client hit-claims (a pragmatic model for trusted private lobbies — full
 * lag-compensated hit-scan validation is a future upgrade the protocol already
 * leaves room for). Clients never decide scores or round wins.
 */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
const SNAPSHOT_HZ = 20;

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  rankInsignia: string;
  rankName: string;
  team: Team;
  ready: boolean;
  ping: number;
  room: Room | null;
  // per-match state (server-authoritative)
  hp: number;
  armor: number;
  alive: boolean;
  last: PlayerNetState | null;
  stats: MatchPlayerResult;
}

interface Room {
  code: string;
  hostId: string;
  settings: RoomSettings;
  members: Client[];
  inMatch: boolean;
  blue: number;
  red: number;
  round: number;
  snapshotTimer: ReturnType<typeof setInterval> | null;
}

function genCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = "";
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!existing.has(c)) return c;
  }
  return `${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function freshStats(id: string, name: string, insignia: string, team: Team): MatchPlayerResult {
  return { id, name, rankInsignia: insignia, team, kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, shotsFired: 0, shotsHit: 0, mvp: false };
}

export function attachRoomServer(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/mp" });
  const rooms = new Map<string, Room>();
  let nextId = 1;

  const send = (c: Client, msg: ServerMsg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const err = (c: Client, code: string, message: string) => send(c, { t: "error", code, message });

  const roomState = (r: Room): RoomState => ({
    code: r.code,
    hostId: r.hostId,
    settings: r.settings,
    players: r.members.map(
      (m): LobbyPlayer => ({ id: m.id, name: m.name, rankInsignia: m.rankInsignia, rankName: m.rankName, team: m.team, ready: m.ready, isHost: m.id === r.hostId, ping: m.ping }),
    ),
    inMatch: r.inMatch,
  });
  const broadcastRoom = (r: Room) => {
    const msg: ServerMsg = { t: "roomState", room: roomState(r) };
    for (const m of r.members) send(m, msg);
  };

  const teamCount = (r: Room, team: Team) => r.members.filter((m) => m.team === team).length;
  const smallerTeam = (r: Room): Team => (teamCount(r, "blue") <= teamCount(r, "red") ? "blue" : "red");

  const spawnFor = (team: Team, index: number) => {
    // Iron Citadel local spawns (mirrored per team); the client offsets to BASE.
    const z = team === "blue" ? -38 : 40;
    return { x: -6 + index * 12, y: 1.2, z };
  };

  const leaveRoom = (c: Client) => {
    const r = c.room;
    if (!r) return;
    r.members = r.members.filter((m) => m !== c);
    c.room = null;
    if (r.members.length === 0) {
      if (r.snapshotTimer) clearInterval(r.snapshotTimer);
      rooms.delete(r.code);
      return;
    }
    if (r.hostId === c.id) r.hostId = r.members[0].id; // migrate host
    broadcastRoom(r);
  };

  const startMatch = (r: Room) => {
    const blue = teamCount(r, "blue");
    const red = teamCount(r, "red");
    if (blue < 1 || red < 1) return;
    r.inMatch = true;
    r.blue = 0;
    r.red = 0;
    r.round = 1;
    const byTeam: Record<Team, number> = { blue: 0, red: 0 };
    for (const m of r.members) {
      m.hp = 100;
      m.armor = 100;
      m.alive = true;
      m.last = null;
      m.stats = freshStats(m.id, m.name, m.rankInsignia, m.team);
      const idx = byTeam[m.team]++;
      send(m, { t: "matchStart", settings: r.settings, you: { team: m.team, spawn: spawnFor(m.team, idx) }, players: roomState(r).players });
    }
    if (r.snapshotTimer) clearInterval(r.snapshotTimer);
    r.snapshotTimer = setInterval(() => {
      const players: PlayerNetState[] = r.members.filter((m) => m.last).map((m) => m.last as PlayerNetState);
      const msg: ServerMsg = { t: "snapshot", players };
      for (const m of r.members) send(m, msg);
    }, 1000 / SNAPSHOT_HZ);
    broadcastRoom(r);
  };

  const endMatch = (r: Room, winner: Team | "draw") => {
    if (r.snapshotTimer) { clearInterval(r.snapshotTimer); r.snapshotTimer = null; }
    r.inMatch = false;
    // MVP = most kills, tiebreak fewest deaths.
    const results = r.members.map((m) => m.stats).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (results[0]) results[0].mvp = true;
    const msg: ServerMsg = { t: "matchEnd", winner, blue: r.blue, red: r.red, results };
    for (const m of r.members) { m.ready = false; send(m, msg); }
    broadcastRoom(r);
  };

  const registerScore = (r: Room, scoringTeam: Team) => {
    if (scoringTeam === "blue") r.blue++; else r.red++;
    for (const m of r.members) send(m, { t: "scores", blue: r.blue, red: r.red, round: r.round });
    if (r.settings.mode === "tdm") {
      if (r.blue >= r.settings.scoreLimit) return endMatch(r, "blue");
      if (r.red >= r.settings.scoreLimit) return endMatch(r, "red");
    }
    if (r.settings.mode === "elim") {
      const need = Math.floor(r.settings.roundLimit / 2) + 1;
      if (r.blue >= need) return endMatch(r, "blue");
      if (r.red >= need) return endMatch(r, "red");
      // round advances when one team is wiped (handled in death handler)
    }
  };

  const handle = (c: Client, msg: ClientMsg) => {
    switch (msg.t) {
      case "hello":
        c.name = String(msg.name || "Recruit").slice(0, 20);
        c.rankInsignia = String(msg.rankInsignia || "REC").slice(0, 6);
        c.rankName = String(msg.rankName || "Recruit").slice(0, 32);
        send(c, { t: "welcome", playerId: c.id });
        break;
      case "create": {
        if (c.room) leaveRoom(c);
        const settings: RoomSettings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(msg.settings) };
        const code = genCode(new Set(rooms.keys()));
        const room: Room = { code, hostId: c.id, settings, members: [c], inMatch: false, blue: 0, red: 0, round: 0, snapshotTimer: null };
        c.room = room; c.team = "blue"; c.ready = false;
        rooms.set(code, room);
        broadcastRoom(room);
        break;
      }
      case "join": {
        if (c.room) leaveRoom(c);
        const room = rooms.get(String(msg.code || "").toUpperCase().trim());
        if (!room) return err(c, "no_room", "Room not found. Check the code and try again.");
        if (room.inMatch) return err(c, "in_match", "That match is already in progress.");
        if (room.members.length >= room.settings.maxPlayers) return err(c, "full", "That room is full.");
        c.room = room; c.team = smallerTeam(room); c.ready = false;
        room.members.push(c);
        broadcastRoom(room);
        break;
      }
      case "leave":
        leaveRoom(c);
        break;
      case "team": {
        const r = c.room; if (!r || r.inMatch) return;
        const target = msg.team === "red" ? "red" : "blue";
        if (target !== c.team && teamCount(r, target) >= Math.floor(r.settings.maxPlayers / 2)) return err(c, "team_full", "That team is full.");
        c.team = target; c.ready = false;
        broadcastRoom(r);
        break;
      }
      case "ready": {
        const r = c.room; if (!r || r.inMatch) return;
        c.ready = !!msg.ready;
        broadcastRoom(r);
        break;
      }
      case "settings": {
        const r = c.room; if (!r || r.hostId !== c.id || r.inMatch) return;
        r.settings = { ...r.settings, ...sanitizeSettings(msg.settings) };
        // shrinking maxPlayers can't drop players mid-lobby; just clamp future joins
        broadcastRoom(r);
        break;
      }
      case "kick": {
        const r = c.room; if (!r || r.hostId !== c.id) return;
        const victim = r.members.find((m) => m.id === msg.playerId && m.id !== c.id);
        if (victim) { send(victim, { t: "kicked" }); leaveRoom(victim); }
        break;
      }
      case "start": {
        const r = c.room; if (!r || r.hostId !== c.id || r.inMatch) return;
        startMatch(r);
        break;
      }
      case "state": {
        const r = c.room; if (!r || !r.inMatch) return;
        c.last = { id: c.id, ...msg.p };
        c.hp = msg.p.hp; c.armor = msg.p.armor;
        break;
      }
      case "fire": {
        const r = c.room; if (!r || !r.inMatch) return;
        c.stats.shotsFired++;
        const out: ServerMsg = { t: "fire", from: c.id, weapon: msg.weapon, ox: msg.ox, oy: msg.oy, oz: msg.oz, dx: msg.dx, dy: msg.dy, dz: msg.dz };
        for (const m of r.members) if (m !== c) send(m, out);
        break;
      }
      case "hit": {
        const r = c.room; if (!r || !r.inMatch) return;
        const victim = r.members.find((m) => m.id === msg.targetId);
        if (!victim || !victim.alive) return;
        if (victim.team === c.team && !r.settings.friendlyFire) return; // FF off
        c.stats.shotsHit++;
        const dmg = Math.max(0, Math.min(150, msg.damage));
        c.stats.damage += dmg;
        if (msg.headshot) c.stats.headshots++;
        // apply to armour then health (server-authoritative)
        let d = dmg;
        if (victim.armor > 0) { const a = Math.min(victim.armor, d * 0.5); victim.armor -= a; d -= a; }
        victim.hp -= d;
        if (victim.hp <= 0) resolveKill(r, c, victim, msg.headshot);
        else send(victim, { t: "hurt", hp: Math.max(0, Math.round(victim.hp)), armor: Math.round(victim.armor), fromId: c.id });
        break;
      }
      case "death": {
        const r = c.room; if (!r || !r.inMatch) return;
        const killer = msg.killerId ? r.members.find((m) => m.id === msg.killerId) ?? null : null;
        resolveKill(r, killer, c, false);
        break;
      }
      case "ping":
        send(c, { t: "pong", ts: msg.ts });
        break;
    }
  };

  const resolveKill = (r: Room, killer: Client | null, victim: Client, headshot: boolean) => {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.stats.deaths++;
    if (killer && killer !== victim) killer.stats.kills++;
    for (const m of r.members) send(m, { t: "kill", killerId: killer ? killer.id : null, victimId: victim.id, headshot });

    if (r.settings.mode === "tdm") {
      // score the killer's team, respawn the victim after a delay
      if (killer && killer !== victim) registerScore(r, killer.team);
      if (!r.inMatch) return; // match may have ended on score
      setTimeout(() => {
        if (!r.inMatch || victim.room !== r) return;
        victim.alive = true; victim.hp = 100; victim.armor = 100;
        const idx = r.members.filter((m) => m.team === victim.team).indexOf(victim);
        const spawn = spawnFor(victim.team, Math.max(0, idx));
        for (const m of r.members) send(m, { t: "respawn", playerId: victim.id, spawn });
      }, 3000);
    } else {
      // elimination: no respawn; if a team is wiped, the other scores the round
      const blueAlive = r.members.filter((m) => m.team === "blue" && m.alive).length;
      const redAlive = r.members.filter((m) => m.team === "red" && m.alive).length;
      if (blueAlive === 0 || redAlive === 0) {
        const winner: Team = blueAlive === 0 ? "red" : "blue";
        registerScore(r, winner);
        if (!r.inMatch) return;
        r.round++;
        setTimeout(() => {
          if (!r.inMatch || r.members.length === 0) return;
          const byTeam: Record<Team, number> = { blue: 0, red: 0 };
          for (const m of r.members) {
            m.alive = true; m.hp = 100; m.armor = 100;
            const idx = byTeam[m.team]++;
            send(m, { t: "respawn", playerId: m.id, spawn: spawnFor(m.team, idx) });
          }
        }, 3500);
      }
    }
  };

  wss.on("connection", (ws) => {
    const c: Client = {
      id: `p${nextId++}`, ws, name: "Recruit", rankInsignia: "REC", rankName: "Recruit",
      team: "blue", ready: false, ping: 0, room: null, hp: 100, armor: 100, alive: true, last: null,
      stats: freshStats("", "", "", "blue"),
    };
    ws.on("message", (data) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return; }
      try { handle(c, msg); } catch (e) { console.error("[mp] handler error", e); }
    });
    ws.on("close", () => leaveRoom(c));
    ws.on("error", () => {});
  });

  console.log("[mp] room server listening on /mp");
}

function sanitizeSettings(s: Partial<RoomSettings> | undefined): Partial<RoomSettings> {
  const out: Partial<RoomSettings> = {};
  if (!s) return out;
  if (s.mode === "tdm" || s.mode === "elim") out.mode = s.mode;
  if (typeof s.map === "string") out.map = s.map.slice(0, 40);
  if (s.maxPlayers === 2 || s.maxPlayers === 4) out.maxPlayers = s.maxPlayers;
  if (typeof s.friendlyFire === "boolean") out.friendlyFire = s.friendlyFire;
  if (typeof s.roundLimit === "number") out.roundLimit = Math.max(1, Math.min(15, Math.round(s.roundLimit)));
  if (typeof s.scoreLimit === "number") out.scoreLimit = Math.max(5, Math.min(100, Math.round(s.scoreLimit)));
  if (typeof s.timeLimitSec === "number") out.timeLimitSec = Math.max(60, Math.min(1800, Math.round(s.timeLimitSec)));
  void MAX_PLAYERS;
  return out;
}
