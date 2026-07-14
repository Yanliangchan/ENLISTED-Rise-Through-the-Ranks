export interface SettingsData {
  sensitivity: number; // multiplier, 1 = default
  volume: number; // 0..1
}

const KEY = "sentinelShield.settings.v1";

export class Settings {
  data: SettingsData;

  constructor() {
    this.data = this.load() ?? { sensitivity: 1, volume: 0.6 };
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
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // ignore
    }
  }
}
