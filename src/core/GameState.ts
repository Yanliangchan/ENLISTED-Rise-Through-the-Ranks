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
}

const SAVE_KEY = "sentinelShield.save.v1";

function defaultSave(): SaveData {
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
  };
}

/**
 * Central persisted game state: economy, ownership, loadout, wave progress.
 * Single source of truth read by the armoury shop, weapon/loadout systems,
 * and the wave manager; persisted to localStorage between sessions.
 */
export class GameState {
  data: SaveData;

  constructor() {
    this.data = this.load() ?? defaultSave();
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
  }

  spendCredits(amount: number): boolean {
    if (this.data.credits < amount) return false;
    this.data.credits -= amount;
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
