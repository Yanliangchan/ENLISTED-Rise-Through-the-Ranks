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
  /** Kills by specific weapon id (SAR-21, BR18, ...) — feeds the per-weapon Combat Skills badge track. Never includes the MATADOR (it's a launcher, never a hitscan kill). */
  killsByWeapon: Record<string, number>;
  /** Kills scored by grenades, M203 HE, MATADOR and claymores combined — feeds the EOD badge track. */
  explosiveKills: number;
  /** Times BOTTY was healed with a First Aid Kit — feeds the Paramedic badge. */
  bottyHeals: number;
  /** Air strikes actually called in (impact confirmed) — feeds the ADSS badge. */
  airstrikeCalls: number;
  /** UAV recon sweeps activated — feeds the AIIE badge. */
  uavCalls: number;
  /** Times the player got within arm's reach of an enemy that never noticed them — feeds the Recon badge. */
  reconTouches: number;
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
    killsByWeapon: {} as Record<string, number>,
    explosiveKills: 0,
    bottyHeals: 0,
    airstrikeCalls: 0,
    uavCalls: 0,
    reconTouches: 0,
    startedAt: 0,
  };

  /** Call when a fresh deployment begins (landing page DEPLOY, or redeploy after death). */
  beginRun(): void {
    this.run = {
      kills: 0, headshots: 0, shotsFired: 0, shotsHit: 0, creditsEarned: 0,
      killsByClass: {}, killsByWeapon: {}, explosiveKills: 0, bottyHeals: 0,
      airstrikeCalls: 0, uavCalls: 0, reconTouches: 0, startedAt: performance.now(),
    };
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

  recordKill(weaponClass: string, weaponId: string): void {
    this.run.kills++;
    this.data.kills++;
    this.run.killsByClass[weaponClass] = (this.run.killsByClass[weaponClass] ?? 0) + 1;
    this.run.killsByWeapon[weaponId] = (this.run.killsByWeapon[weaponId] ?? 0) + 1;
  }

  recordExplosiveKills(count: number): void {
    this.run.explosiveKills += count;
  }

  recordBottyHeal(): void {
    this.run.bottyHeals++;
  }

  recordAirstrikeCall(): void {
    this.run.airstrikeCalls++;
  }

  recordUavCall(): void {
    this.run.uavCalls++;
  }

  recordReconTouch(): void {
    this.run.reconTouches++;
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
      killsByWeapon: this.run.killsByWeapon,
      explosiveKills: this.run.explosiveKills,
      bottyHeals: this.run.bottyHeals,
      airstrikeCalls: this.run.airstrikeCalls,
      uavCalls: this.run.uavCalls,
      reconTouches: this.run.reconTouches,
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
