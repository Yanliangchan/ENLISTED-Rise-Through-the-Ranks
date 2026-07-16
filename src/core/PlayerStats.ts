import type { ProfileStats } from "@/core/Backend";

/** Lifetime totals shown for display, hydrated from the server profile — never written to directly by gameplay. */
export function emptyStats(): ProfileStats {
  return {
    gamesPlayed: 0,
    kills: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    wavesCleared: 0,
    highestWave: 0,
    bestGameKills: 0,
    deaths: 0,
    creditsEarned: 0,
    playtimeSec: 0,
  };
}

export interface RunResult {
  waveReached: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  creditsEarned: number;
  durationSec: number;
  killsByClass: Record<string, number>;
}

/**
 * Tracks the CURRENT deployment's combat counters (reset every `beginRun`)
 * and mirrors the server's lifetime totals for instant display (pause menu /
 * profile) between network round trips. The server's `player_stats` table is
 * the single source of truth for lifetime numbers — this class never
 * persists anything itself; `endRun()` hands the caller a summary to POST to
 * `/api/matches`, and `applyServerProfile()` re-syncs `data` from the
 * authoritative response.
 */
export class PlayerStats {
  data: ProfileStats;

  constructor(initial: ProfileStats) {
    this.data = initial;
  }

  private run = {
    kills: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    creditsEarned: 0,
    killsByClass: {} as Record<string, number>,
    startedAt: 0,
  };

  /** Call when a fresh deployment begins (landing page DEPLOY, or redeploy after death). */
  beginRun(): void {
    this.run = { kills: 0, headshots: 0, shotsFired: 0, shotsHit: 0, creditsEarned: 0, killsByClass: {}, startedAt: performance.now() };
  }

  recordShot(): void {
    this.run.shotsFired++;
    this.data.shotsFired++; // optimistic mirror bump; corrected by the next server sync
  }

  recordHit(headshot: boolean): void {
    this.run.shotsHit++;
    this.data.shotsHit++;
    if (headshot) {
      this.run.headshots++;
      this.data.headshots++;
    }
  }

  recordKill(weaponClass: string): void {
    this.run.kills++;
    this.data.kills++;
    this.run.killsByClass[weaponClass] = (this.run.killsByClass[weaponClass] ?? 0) + 1;
  }

  recordCredits(amount: number): void {
    if (amount <= 0) return;
    this.run.creditsEarned += amount;
    this.data.creditsEarned += amount;
  }

  /** Optimistic instant-feedback bump; the server recomputes the true value from wave-reached on match save. */
  recordWaveCleared(wave: number): void {
    this.data.wavesCleared++;
    this.data.highestWave = Math.max(this.data.highestWave, wave);
  }

  addPlaytime(seconds: number): void {
    this.data.playtimeSec += seconds;
  }

  /** Finalize the run into a payload for POST /api/matches. Does not reset — call `beginRun()` for the next deployment. */
  endRun(waveReached: number): RunResult {
    return {
      waveReached,
      kills: this.run.kills,
      headshots: this.run.headshots,
      shotsFired: this.run.shotsFired,
      shotsHit: this.run.shotsHit,
      creditsEarned: this.run.creditsEarned,
      durationSec: Math.round((performance.now() - this.run.startedAt) / 1000),
      killsByClass: this.run.killsByClass,
    };
  }

  /** Re-sync the display mirror from an authoritative server profile (after login or a match save). */
  applyServerProfile(stats: ProfileStats): void {
    this.data = stats;
  }

  get accuracyPct(): number {
    return this.data.shotsFired === 0 ? 0 : Math.round((this.data.shotsHit / this.data.shotsFired) * 100);
  }
}
