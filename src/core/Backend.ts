import type { SaveData } from "@/core/GameState";
import type { SettingsData } from "@/core/Settings";

export interface ProfileStats {
  gamesPlayed: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  wavesCleared: number;
  highestWave: number;
  bestGameKills: number;
  deaths: number;
  creditsEarned: number;
  playtimeSec: number;
}

export interface RankProgress {
  name: string;
  /** Short rank-insignia abbreviation, e.g. "CPT", "ME4", "3SG" — shown before the username on leaderboards/nameplates. */
  insignia: string;
  index: number;
  xp: number;
  xpIntoRank: number;
  xpForNextRank: number | null;
  /** True once the player has reached Corporal First Class and must pick a career path to rank further. */
  atCareerGate: boolean;
}

export type CareerPath = "officer" | "specialist" | "me";

export interface BadgeInfo {
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  unlockedAt: string;
}

export interface Profile {
  username: string;
  save: SaveData | null;
  settings: SettingsData | null;
  stats: ProfileStats;
  accuracyPct: number;
  rank: RankProgress;
  careerTrack: string;
  careerPath: CareerPath | null;
  guardian: boolean;
  badges: BadgeInfo[];
}

export type PublicProfile = Omit<Profile, "save" | "settings">;

export interface MatchResult {
  waveReached: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  creditsEarned: number;
  durationSec: number;
  killsByClass: Record<string, number>;
}

export interface MatchSubmitResponse {
  xpGained: number;
  newBadges: Array<{ code: string; name: string; icon: string }>;
  rankUp: { from: string; to: string } | null;
  profile: Profile;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  value: number;
  rankInsignia: string;
  rankName: string;
}

const TOKEN_KEY = "enlisted.token";

/** Username rules: 3-16 chars, letters/numbers/_/- — mirrors the server-side validator. */
export function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 3) return "Username must be at least 3 characters.";
  if (trimmed.length > 16) return "Username must be at most 16 characters.";
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "Use only letters, numbers, _ or -.";
  return null;
}

/**
 * Client for the PostgreSQL-backed account API. Login is username-only (no
 * password — see server/auth.ts for the reasoning); the server returns a JWT
 * this class stores in localStorage and attaches to every subsequent request,
 * which is what lets a returning player skip the login screen entirely.
 *
 * `save`/`settings` writes are debounced (mirrors the old IndexedDB
 * AccountManager's behaviour) so rapid changes — spending credits, fitting
 * attachments — collapse into one network write rather than one per change.
 */
export class Backend {
  profile: Profile;

  private constructor(private readonly token: string, profile: Profile) {
    this.profile = profile;
  }

  /** Session token, for authenticating side channels such as the multiplayer socket. */
  get sessionToken(): string {
    return this.token;
  }

  /** Auto-login: if a token is remembered, validate it against the server and load the profile. Returns null if none/invalid. */
  static async tryResume(): Promise<Backend | null> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      const profile = await Backend.rawRequest<Profile>("GET", "/api/profile", token);
      return new Backend(token, profile);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
  }

  /** Find-or-create login by username. Throws with a user-facing message on failure. */
  static async login(username: string): Promise<Backend> {
    const resp = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error ?? `Login failed (HTTP ${resp.status}).`);
    const { token, profile } = body as { token: string; profile: Profile };
    localStorage.setItem(TOKEN_KEY, token);
    return new Backend(token, profile);
  }

  private static async rawRequest<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    const resp = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) throw new Error(`${method} ${path} failed (HTTP ${resp.status}).`);
    return resp.json() as Promise<T>;
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return Backend.rawRequest<T>(method, path, this.token, body);
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: SaveData | null = null;

  /** Debounced (~400ms) full-snapshot upsert of the economy/loadout blob. */
  saveGameState(data: SaveData): void {
    this.pendingSave = data;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const d = this.pendingSave;
      this.pendingSave = null;
      if (d) void this.request("PUT", "/api/save", { save: d }).catch((e) => console.warn("[backend] save failed", e));
    }, 400);
  }

  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSettings: SettingsData | null = null;

  saveSettings(data: SettingsData): void {
    this.pendingSettings = data;
    if (this.settingsTimer) return;
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      const d = this.pendingSettings;
      this.pendingSettings = null;
      if (d) void this.request("PUT", "/api/settings", { settings: d }).catch((e) => console.warn("[backend] settings save failed", e));
    }, 400);
  }

  /** Push any pending debounced writes out immediately (tab hide/close). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.pendingSave) void this.request("PUT", "/api/save", { save: this.pendingSave }).catch(() => {});
      this.pendingSave = null;
    }
    if (this.settingsTimer) {
      clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
      if (this.pendingSettings) void this.request("PUT", "/api/settings", { settings: this.pendingSettings }).catch(() => {});
      this.pendingSettings = null;
    }
  }

  /** Re-fetch the full profile from the server (e.g. to refresh the Profile page on demand). */
  async refreshProfile(): Promise<Profile> {
    this.profile = await this.request<Profile>("GET", "/api/profile");
    return this.profile;
  }

  /** Save one completed deployment's results; updates `this.profile` from the authoritative server response. */
  async submitMatch(result: MatchResult): Promise<MatchSubmitResponse> {
    const resp = await this.request<MatchSubmitResponse>("POST", "/api/matches", result);
    this.profile = resp.profile;
    return resp;
  }

  async fetchLeaderboard(category: string, limit = 50): Promise<LeaderboardEntry[]> {
    const resp = await fetch(`/api/leaderboard/${category}?limit=${limit}`);
    if (!resp.ok) throw new Error(`Leaderboard fetch failed (HTTP ${resp.status}).`);
    const body = (await resp.json()) as { entries: LeaderboardEntry[] };
    return body.entries;
  }

  async fetchPublicProfile(username: string): Promise<PublicProfile> {
    const resp = await fetch(`/api/profile/${encodeURIComponent(username)}`);
    if (!resp.ok) throw new Error(`No such operator (HTTP ${resp.status}).`);
    return resp.json() as Promise<PublicProfile>;
  }

  /** One-time SAF career-path choice, allowed once Corporal First Class is reached. */
  async chooseCareerPath(path: CareerPath): Promise<Profile> {
    const resp = await this.request<{ profile: Profile }>("POST", "/api/profile/career-path", { path });
    this.profile = resp.profile;
    return this.profile;
  }

  // --- Guardian (hidden dev/mod/tester tooling; gated by the persisted
  // `guardian` flag on this account — see server/routes/guardian.ts) ---

  guardianLookup(username: string): Promise<PublicProfile & { guardian: boolean }> {
    return this.request("GET", `/api/guardian/lookup/${encodeURIComponent(username)}`);
  }

  guardianListBadges(
    username: string
  ): Promise<{ badges: Array<{ code: string; name: string; description: string; icon: string; category: string; rarity: string; unlocked: boolean }> }> {
    return this.request("GET", `/api/guardian/badges/${encodeURIComponent(username)}`);
  }

  guardianGrantBadge(username: string, code: string): Promise<{ ok: boolean; badge: BadgeInfo }> {
    return this.request("POST", "/api/guardian/badges/grant", { username, code });
  }

  guardianAdjustXp(username: string, delta: number): Promise<{ ok: boolean; xp: number }> {
    return this.request("POST", "/api/guardian/xp", { username, delta });
  }

  guardianSetCareerPath(username: string, path: CareerPath): Promise<{ ok: boolean }> {
    return this.request("POST", "/api/guardian/career-path", { username, path });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/** Grant Guardian access to a username (code-gated; no auth needed to bootstrap the very first Guardian). */
export async function guardianGrantAccess(username: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch("/api/guardian/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, code }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: body.error ?? `HTTP ${resp.status}` };
  return { ok: true };
}
