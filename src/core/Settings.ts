export interface SettingsData {
  sensitivity: number; // multiplier, 1 = default
  /** Separate multiplier applied ONLY while aiming down sights, on top of `sensitivity`. */
  adsSensitivity: number;
  volume: number; // 0..1
}

/** Defaults — merged over any loaded blob so older saves gain new fields safely. */
const DEFAULT_SETTINGS: SettingsData = { sensitivity: 1, adsSensitivity: 1, volume: 0.6 };

const KEY = "sentinelShield.settings.v1";

export class Settings {
  data: SettingsData;

  /**
   * Standalone (localStorage) when constructed with no args; account-backed when
   * given the account's `settings` object plus a `persist` hook, which routes
   * saves into the AccountManager's IndexedDB record instead.
   */
  constructor(initial?: SettingsData | null, private readonly persist?: (data: SettingsData) => void) {
    // Shallow-merge over defaults so a stored blob that predates a new field
    // (e.g. adsSensitivity) still gets a sane value instead of undefined.
    this.data = { ...DEFAULT_SETTINGS, ...(initial ?? this.load() ?? {}) };
  }

  private load(): SettingsData | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as SettingsData) : null;
    } catch {
      return null;
    }
  }

  save(): void {
    if (this.persist) {
      this.persist(this.data);
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // ignore
    }
  }
}
