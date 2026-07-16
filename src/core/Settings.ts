export interface SettingsData {
  sensitivity: number; // multiplier, 1 = default
  volume: number; // 0..1
}

const KEY = "sentinelShield.settings.v1";

export class Settings {
  data: SettingsData;

  /**
   * Standalone (localStorage) when constructed with no args; account-backed when
   * given the account's `settings` object plus a `persist` hook, which routes
   * saves into the AccountManager's IndexedDB record instead.
   */
  constructor(initial?: SettingsData | null, private readonly persist?: (data: SettingsData) => void) {
    this.data = initial ?? this.load() ?? { sensitivity: 1, volume: 0.6 };
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
