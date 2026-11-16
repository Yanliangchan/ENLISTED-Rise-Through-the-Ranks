/** Client for the existing ENLISTED backend (accounts, career XP, leaderboards). Everything degrades to offline play. */

export interface Rank {
  name: string;
  insignia: string;
  index: number;
  xp: number;
  xpIntoRank: number;
  xpForNextRank: number | null;
}

export interface Profile {
  username: string;
  settings: unknown | null;
  stats: { gamesPlayed: number; kills: number; headshots: number; shotsFired: number; shotsHit: number; highestWave: number; bestGameKills: number; playtimeSec: number };
  accuracyPct: number;
  rank: Rank;
  careerTrack: string;
  badges: Array<{ code: string; name: string; description: string; unlocked: boolean }>;
}

export interface MatchReport {
  missionType: "wave_survival" | "strongpoint_assault";
  waveReached: number;
  strongpointsCleared: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  creditsEarned: number;
  durationSec: number;
  explosiveKills: number;
}

export interface MatchResult {
  xpGained: number;
  newBadges: Array<{ name: string; description?: string }>;
  rankUp: { from: string; to: string } | null;
  profile: Profile | null;
}

export interface BoardEntry {
  rank: number;
  username: string;
  value: number;
  rankInsignia: string;
}

const TOKEN_KEY = "enlisted.token";
const NAME_KEY = "enlisted.callsign";

export class Api {
  profile: Profile | null = null;
  private token: string | null = null;

  constructor() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  get savedCallsign(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON (e.g. dev server without the API) */
    }
    if (!res.ok || json === null) throw new Error((json as { error?: string } | null)?.error ?? "Service unavailable.");
    return json as T;
  }

  async login(username: string): Promise<Profile> {
    const r = await this.req<{ token: string; profile: Profile }>("POST", "/auth/login", { username });
    this.token = r.token;
    this.profile = r.profile;
    try {
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem(NAME_KEY, r.profile.username);
    } catch {
      /* ignore */
    }
    return r.profile;
  }

  /** Re-login silently with the remembered callsign. */
  async resume(): Promise<Profile | null> {
    const name = this.savedCallsign;
    if (!name) return null;
    try {
      return await this.login(name);
    } catch {
      return null;
    }
  }

  logout(): void {
    this.token = null;
    this.profile = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(NAME_KEY);
    } catch {
      /* ignore */
    }
  }

  async submit(m: MatchReport): Promise<MatchResult | null> {
    if (!this.token) return null;
    try {
      const r = await this.req<MatchResult>("POST", "/matches", { ...m, killsByClass: { rifle: m.kills - m.explosiveKills }, killsByWeapon: { sar21: m.kills - m.explosiveKills } });
      if (r.profile) this.profile = r.profile;
      return r;
    } catch {
      return null;
    }
  }

  async leaderboard(category: "highest_wave" | "total_kills" | "best_game_kills"): Promise<BoardEntry[] | null> {
    try {
      return (await this.req<{ entries: BoardEntry[] }>("GET", `/leaderboard/${category}?limit=12`)).entries;
    } catch {
      return null;
    }
  }

  saveSettings(settings: unknown): void {
    if (!this.token) return;
    void this.req("PUT", "/settings", { settings }).catch(() => undefined);
  }
}
