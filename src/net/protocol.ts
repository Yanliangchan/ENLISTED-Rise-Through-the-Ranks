/**
 * Shared wire protocol for private 1v1 / 2v2 multiplayer.
 *
 * IMPORTANT: this file is duplicated verbatim at `server/multiplayer/protocol.ts`
 * because the client (`src/**`, `@/` alias, DOM libs) and the server
 * (`server/**`, node libs) compile under separate tsconfigs. Keep the two
 * copies byte-identical. It is type-only + plain constants, so there is no
 * runtime logic to drift.
 */

export type Team = "blue" | "red";
export type GameMode = "tdm" | "elim";
export const MAX_PLAYERS = 4;

export interface RoomSettings {
  mode: GameMode;
  map: string; // map id, e.g. "iron-citadel"
  maxPlayers: 2 | 4;
  friendlyFire: boolean;
  roundLimit: number; // elimination: rounds to play (best-of); tdm: unused
  scoreLimit: number; // tdm: target team score
  timeLimitSec: number; // per match / per round
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: "tdm",
  map: "iron-citadel",
  maxPlayers: 4,
  friendlyFire: false,
  roundLimit: 5,
  scoreLimit: 25,
  timeLimitSec: 600,
};

export interface LobbyPlayer {
  id: string;
  name: string;
  rankInsignia: string;
  rankName: string;
  team: Team;
  ready: boolean;
  isHost: boolean;
  ping: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  settings: RoomSettings;
  players: LobbyPlayer[];
  inMatch: boolean;
}

/** Compact per-player state broadcast during a match (kept small on purpose). */
export interface PlayerNetState {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number; // bitfield: sprint/crouch/prone/ads/firing/dead — see NetFlag
  weapon: number; // weapon slot index
  hp: number;
  armor: number;
}

export enum NetFlag {
  Sprint = 1 << 0,
  Crouch = 1 << 1,
  Prone = 1 << 2,
  Ads = 1 << 3,
  Firing = 1 << 4,
  Reloading = 1 << 5,
  Dead = 1 << 6,
}

export interface MatchPlayerResult {
  id: string;
  name: string;
  rankInsignia: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  damage: number;
  shotsFired: number;
  shotsHit: number;
  mvp: boolean;
}

// ---- client -> server ------------------------------------------------------
export type ClientMsg =
  | { t: "hello"; token?: string; name: string; rankInsignia: string; rankName: string }
  | { t: "create"; settings: RoomSettings }
  | { t: "join"; code: string }
  | { t: "leave" }
  | { t: "team"; team: Team }
  | { t: "ready"; ready: boolean }
  | { t: "settings"; settings: Partial<RoomSettings> }
  | { t: "kick"; playerId: string }
  | { t: "start" }
  | { t: "state"; p: Omit<PlayerNetState, "id"> }
  | { t: "fire"; weapon: number; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  | { t: "hit"; targetId: string; damage: number; headshot: boolean }
  | { t: "death"; killerId: string | null }
  | { t: "ping"; ts: number };

// ---- server -> client ------------------------------------------------------
export type ServerMsg =
  | { t: "welcome"; playerId: string }
  | { t: "error"; code: string; message: string }
  | { t: "roomState"; room: RoomState }
  | { t: "kicked" }
  | { t: "matchStart"; settings: RoomSettings; you: { team: Team; spawn: { x: number; y: number; z: number } }; players: LobbyPlayer[] }
  | { t: "snapshot"; players: PlayerNetState[] }
  | { t: "fire"; from: string; weapon: number; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  | { t: "kill"; killerId: string | null; victimId: string; headshot: boolean }
  | { t: "respawn"; playerId: string; spawn: { x: number; y: number; z: number } }
  | { t: "hurt"; hp: number; armor: number; fromId: string }
  | { t: "scores"; blue: number; red: number; round: number }
  | { t: "matchEnd"; winner: Team | "draw"; blue: number; red: number; results: MatchPlayerResult[] }
  | { t: "pong"; ts: number };
