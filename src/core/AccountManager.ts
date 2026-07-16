import type { SaveData } from "@/core/GameState";
import type { SettingsData } from "@/core/Settings";
import { defaultStats, type PlayerStatsData } from "@/core/PlayerStats";

/** One player account, persisted as a single IndexedDB record keyed by `usernameLower`. */
export interface AccountRecord {
  username: string; // display name as typed
  usernameLower: string; // unique key — prevents duplicate usernames
  save: SaveData | null; // null until GameState fills it with defaults
  settings: SettingsData;
  stats: PlayerStatsData;
  createdAt: number;
  lastLogin: number;
}

const DB_NAME = "sentinelShield";
const DB_VERSION = 1;
const STORE = "accounts";
const CURRENT_USER_KEY = "sentinelShield.currentUser";

/** Username rules: 3-16 chars, letters/numbers/_/- , used as the display name. */
export function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 3) return "Username must be at least 3 characters.";
  if (trimmed.length > 16) return "Username must be at most 16 characters.";
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return "Use only letters, numbers, _ or -.";
  return null;
}

/**
 * Persistent account store backed by IndexedDB — a real client-side database
 * (survives reloads, no server needed). Each account holds its own save,
 * settings and lifetime stats. Usernames are unique (the store is keyed by the
 * lower-cased name), so duplicates are rejected. The last logged-in username is
 * remembered in localStorage for automatic re-login.
 */
export class AccountManager {
  private constructor(private readonly db: IDBDatabase) {}

  active: AccountRecord | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  static async open(): Promise<AccountManager> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "usernameLower" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new AccountManager(db);
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  listUsernames(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const req = this.tx("readonly").getAll();
      req.onsuccess = () =>
        resolve((req.result as AccountRecord[]).sort((a, b) => b.lastLogin - a.lastLogin).map((r) => r.username));
      req.onerror = () => reject(req.error);
    });
  }

  get(usernameLower: string): Promise<AccountRecord | undefined> {
    return new Promise((resolve, reject) => {
      const req = this.tx("readonly").get(usernameLower);
      req.onsuccess = () => resolve(req.result as AccountRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  /** Create a new account. Rejects if the username already exists (case-insensitive). */
  async create(username: string): Promise<AccountRecord> {
    const usernameLower = username.trim().toLowerCase();
    const existing = await this.get(usernameLower);
    if (existing) throw new Error("That username is already taken.");
    const record: AccountRecord = {
      username: username.trim(),
      usernameLower,
      save: null,
      settings: { sensitivity: 1, volume: 0.6 },
      stats: defaultStats(),
      createdAt: Date.now(),
      lastLogin: Date.now(),
    };
    await this.put(record);
    return record;
  }

  put(record: AccountRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx("readwrite").put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Set the active account and remember it for auto-login. */
  async login(record: AccountRecord): Promise<void> {
    record.lastLogin = Date.now();
    this.active = record;
    await this.put(record);
    try {
      localStorage.setItem(CURRENT_USER_KEY, record.usernameLower);
    } catch {
      /* private mode — auto-login just won't stick */
    }
  }

  /** Username remembered from the last session, if any. */
  getRememberedUsername(): string | null {
    try {
      return localStorage.getItem(CURRENT_USER_KEY);
    } catch {
      return null;
    }
  }

  /** Debounced write-back of the active record (called after save/settings/stats mutate). */
  persistActive(): void {
    if (!this.active) return;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      if (this.active) void this.put(this.active);
    }, 400);
  }

  /** Flush any pending write immediately (e.g. on tab hide/close). */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.active) void this.put(this.active);
  }
}
