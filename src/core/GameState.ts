import { WEAPONS } from "@/data/weapons";
import { ATTACHMENTS } from "@/data/attachments";
import { THROWABLES } from "@/data/gamedata";
import { STARTER_LOADOUT } from "@/data/weapons";

export interface Loadout {
  primary: string;
  secondary: string;
  special: string | null;
  throwable: string;
  throwableCount: number;
}

export interface SaveData {
  credits: number;
  wave: number;
  ownedWeapons: string[];
  ownedAttachments: string[];
  ownedGear: string[];
  ownedThrowables: string[];
  fittedAttachments: Record<string, string[]>; // weaponId -> attachment ids
  loadout: Loadout;
  highestWaveCleared: number;
  medkitCount: number;
}

const SAVE_KEY = "sentinelShield.save.v1";

/** First aid kits carried at the start of a deployment. */
export const STARTING_MEDKITS = 2;
/** Hard cap on carried first aid kits, picked up from health crates. */
export const MAX_MEDKITS = 5;

/** Fresh default save — exported so a new account can be seeded with it. */
export function defaultSave(): SaveData {
  return {
    credits: 0,
    wave: 1,
    ownedWeapons: [
      ...Object.values(WEAPONS)
        .filter((w) => w.unlockedByDefault)
        .map((w) => w.id),
    ],
    ownedAttachments: Object.values(ATTACHMENTS)
      .filter((a) => a.price === 0)
      .map((a) => a.id),
    ownedGear: ["fast_helmet", "no4_uniform"],
    ownedThrowables: ["sfg87"],
    fittedAttachments: {
      sar21: ["optic_sar21_1_5x"],
      m110: ["optic_variable_3_9x"],
      trg22: ["optic_precision_5_25x"],
      fnmag: [],
    },
    loadout: { ...STARTER_LOADOUT },
    highestWaveCleared: 0,
    medkitCount: STARTING_MEDKITS,
  };
}

/**
 * Central persisted game state: economy, ownership, loadout, wave progress.
 * Single source of truth read by the armoury shop, weapon/loadout systems,
 * and the wave manager; persisted to localStorage between sessions.
 */
export class GameState {
  data: SaveData;

  /**
   * With no args, behaves as before (loads/saves its own localStorage slot).
   * When an account backs it, pass the account's `save` object (or null for a
   * fresh account) plus a `persist` hook — GameState then mutates that shared
   * object in place and calls `persist` on every save, so the caller (the
   * backend API client) writes it through to Postgres. The old localStorage
   * save is migrated once on a brand-new (null) account so existing players
   * keep their progress.
   *
   * A loaded save is shallow-merged over a fresh `defaultSave()` rather than
   * used as-is: if a future update adds a new SaveData field, an old stored
   * blob that predates it still gets a sane default for that field instead of
   * `undefined` crashing whatever reads it first — the save schema can grow
   * without a migration.
   */
  constructor(initial?: SaveData | null, private readonly persist?: (data: SaveData) => void) {
    const loaded = persist ? initial ?? this.load() : this.load();
    this.data = loaded ? { ...defaultSave(), ...loaded } : defaultSave();
  }

  private load(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as SaveData;
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
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // localStorage unavailable (private browsing, quota) — non-fatal.
    }
  }

  resetRun(): void {
    this.data = defaultSave();
    this.save();
  }

  addCredits(amount: number): void {
    this.data.credits += amount;
    this.save();
  }

  spendCredits(amount: number): boolean {
    if (this.data.credits < amount) return false;
    this.data.credits -= amount;
    this.save();
    return true;
  }

  ownsWeapon(id: string): boolean {
    return this.data.ownedWeapons.includes(id);
  }

  buyWeapon(id: string): boolean {
    const weapon = WEAPONS[id];
    if (!weapon || this.ownsWeapon(id)) return false;
    if (!this.spendCredits(weapon.price)) return false;
    this.data.ownedWeapons.push(id);
    this.save();
    return true;
  }

  ownsAttachment(id: string): boolean {
    return this.data.ownedAttachments.includes(id);
  }

  buyAttachment(id: string): boolean {
    const attachment = ATTACHMENTS[id];
    if (!attachment || this.ownsAttachment(id)) return false;
    if (!this.spendCredits(attachment.price)) return false;
    this.data.ownedAttachments.push(id);
    this.save();
    return true;
  }

  ownsThrowable(id: string): boolean {
    return this.data.ownedThrowables.includes(id);
  }

  buyThrowable(id: string): boolean {
    const throwable = THROWABLES[id];
    if (!throwable || this.ownsThrowable(id)) return false;
    if (!this.spendCredits(throwable.price)) return false;
    this.data.ownedThrowables.push(id);
    this.save();
    return true;
  }

  fitAttachment(weaponId: string, attachmentId: string): void {
    const attachment = ATTACHMENTS[attachmentId];
    if (!attachment) return;
    const current = (this.data.fittedAttachments[weaponId] ??= []);
    const withoutSameSlot = current.filter((id) => ATTACHMENTS[id]?.slot !== attachment.slot);
    withoutSameSlot.push(attachmentId);
    this.data.fittedAttachments[weaponId] = withoutSameSlot;
    this.save();
  }

  unfitAttachment(weaponId: string, slot: string): void {
    const current = this.data.fittedAttachments[weaponId] ?? [];
    this.data.fittedAttachments[weaponId] = current.filter(
      (id) => ATTACHMENTS[id]?.slot !== slot
    );
    this.save();
  }

  getFittedAttachments(weaponId: string): string[] {
    return this.data.fittedAttachments[weaponId] ?? [];
  }
}
