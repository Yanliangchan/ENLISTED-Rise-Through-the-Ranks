export interface PlayerStatsData {
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  wavesCleared: number;
  highestWave: number;
  deaths: number;
  creditsEarned: number;
  playtimeSec: number;
}

export function defaultStats(): PlayerStatsData {
  return {
    kills: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    wavesCleared: 0,
    highestWave: 0,
    deaths: 0,
    creditsEarned: 0,
    playtimeSec: 0,
  };
}

/**
 * Lifetime player statistics for the logged-in account. Mutated through small
 * record* helpers from the gameplay callbacks and persisted (debounced) via the
 * injected `persist` hook — the same account record the AccountManager stores
 * in IndexedDB, so the object reference is shared and writes are cheap.
 */
export class PlayerStats {
  constructor(
    readonly data: PlayerStatsData,
    private readonly persist: () => void
  ) {}

  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Coalesce rapid stat changes into one write ~1s later. */
  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.dirty = false;
        this.persist();
      }
    }, 1000);
  }

  recordShot(): void {
    this.data.shotsFired++;
    this.markDirty();
  }
  recordHit(headshot: boolean): void {
    this.data.shotsHit++;
    if (headshot) this.data.headshots++;
    this.markDirty();
  }
  recordKill(): void {
    this.data.kills++;
    this.markDirty();
  }
  recordWaveCleared(wave: number): void {
    this.data.wavesCleared++;
    this.data.highestWave = Math.max(this.data.highestWave, wave);
    this.markDirty();
  }
  recordDeath(): void {
    this.data.deaths++;
    this.markDirty();
  }
  recordCredits(amount: number): void {
    if (amount > 0) this.data.creditsEarned += amount;
    this.markDirty();
  }
  addPlaytime(seconds: number): void {
    this.data.playtimeSec += seconds;
    // Persisted lazily on the next other change / flush; don't thrash on every tick.
    this.dirty = true;
  }

  /** Force any pending write out now (e.g. on tab hide). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      this.persist();
    }
  }

  get accuracyPct(): number {
    return this.data.shotsFired === 0 ? 0 : Math.round((this.data.shotsHit / this.data.shotsFired) * 100);
  }
}
