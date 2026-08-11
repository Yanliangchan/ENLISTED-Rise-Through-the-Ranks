import { WEAPONS } from "@/data/weapons";
import { ATTACHMENTS } from "@/data/attachments";
import {
  GEAR,
  THROWABLES,
  SPECIAL_ABILITY_PRICES,
  STRIKE_BASE_CHARGES,
  STRIKE_CHARGE_PRICES,
  STRIKE_MAX_CHARGES,
  LBV_POUCH_SLOTS,
  ABILITY_SPECIALS,
  type AbilitySpecial,
} from "@/data/gamedata";
import { STARTER_LOADOUT } from "@/data/weapons";
import { BOTTY_UPGRADE_CATEGORIES, bottyUpgradePrice, type BottyUpgradeCategory } from "@/data/bottyUpgrades";

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
  hasBotty: boolean;
  /** BOTTY's personal upgrade tree — level 0-3 per category. */
  bottyUpgrades: Record<BottyUpgradeCategory, number>;
  /** Which owned plate type (hard/soft ballistic plates) is actually worn — null if neither owned/equipped yet. */
  equippedArmour: string | null;
  /**
   * Gear ids actually WORN, as opposed to merely owned. Owning a pouch no
   * longer applies its effect — it has to be equipped, and the vest only has
   * `LBV_POUCH_SLOTS` of capacity, so the rig is a real decision.
   */
  equippedGear: string[];
  /** Remaining call-in charges per ability. Spent on use, bought in the Armoury, topped up to the base allowance each deployment. */
  strikeCharges: Record<AbilitySpecial, number>;
}

function defaultStrikeCharges(): Record<AbilitySpecial, number> {
  return { ...STRIKE_BASE_CHARGES };
}

function defaultBottyUpgrades(): Record<BottyUpgradeCategory, number> {
  const levels = {} as Record<BottyUpgradeCategory, number>;
  for (const cat of BOTTY_UPGRADE_CATEGORIES) levels[cat] = 0;
  return levels;
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
      fnmag: ["under_bipod"],
    },
    loadout: { ...STARTER_LOADOUT },
    highestWaveCleared: 0,
    medkitCount: STARTING_MEDKITS,
    hasBotty: false,
    bottyUpgrades: defaultBottyUpgrades(),
    equippedArmour: null,
    equippedGear: ["fast_helmet", "no4_uniform"],
    strikeCharges: defaultStrikeCharges(),
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
    this.data.ownedThrowables = this.data.ownedThrowables.filter((id) => THROWABLES[id]);
    for (const cat of BOTTY_UPGRADE_CATEGORIES) this.data.bottyUpgrades[cat] ??= 0;
    // Migration: saves from before armour was switchable own exactly one plate
    // type — default straight to wearing it instead of showing bare-chested.
    if (this.data.equippedArmour === undefined || (this.data.equippedArmour && !this.data.ownedGear.includes(this.data.equippedArmour))) {
      this.data.equippedArmour = this.data.ownedGear.find((id) => GEAR[id]?.plateType) ?? null;
    }
    if (!THROWABLES[this.data.loadout.throwable]) {
      this.data.loadout.throwable = "smoke_red";
      this.data.loadout.throwableCount = 0;
    }
    this.migrateEquippedGear();
    for (const id of ABILITY_SPECIALS) this.data.strikeCharges[id] ??= STRIKE_BASE_CHARGES[id];
  }

  /**
   * Saves from before gear could be unequipped only recorded what was OWNED,
   * and every owned item was implicitly active. Seed `equippedGear` so those
   * players keep exactly the loadout they had: everything owned goes on, minus
   * the plate type they weren't wearing, and anything that no longer fits the
   * vest's slot budget is dropped from the back of the list rather than
   * silently exceeding capacity.
   */
  private migrateEquippedGear(): void {
    if (Array.isArray(this.data.equippedGear)) {
      // Drop stale ids and anything no longer owned, then re-validate capacity.
      this.data.equippedGear = this.data.equippedGear.filter(
        (id) => GEAR[id] && (this.data.ownedGear.includes(id) || GEAR[id].alwaysEquipped)
      );
    } else {
      this.data.equippedGear = this.data.ownedGear.filter((id) => {
        const item = GEAR[id];
        if (!item) return false;
        if (item.plateType) return id === this.data.equippedArmour;
        return true;
      });
    }
    // Base kit is always worn and never occupies capacity.
    for (const item of Object.values(GEAR)) {
      if (item.alwaysEquipped && this.data.ownedGear.includes(item.id) && !this.data.equippedGear.includes(item.id)) {
        this.data.equippedGear.push(item.id);
      }
    }
    // Trim to the slot budget (last-equipped loses out) and keep the legacy
    // `equippedArmour` field agreeing with reality for any older reader.
    const kept: string[] = [];
    let used = 0;
    for (const id of this.data.equippedGear) {
      const cost = GEAR[id]?.slotCost ?? 0;
      if (used + cost > this.pouchSlotCapacity()) continue;
      used += cost;
      kept.push(id);
    }
    this.data.equippedGear = kept;
    this.data.equippedArmour = kept.find((id) => GEAR[id]?.plateType) ?? null;
  }

  /** Total pouch capacity available — zero until the LBV platform itself is owned. */
  pouchSlotCapacity(): number {
    return this.data.ownedGear.includes("lbv") ? LBV_POUCH_SLOTS : 0;
  }

  /** Pouch slots currently consumed by worn upgrades. */
  pouchSlotsUsed(): number {
    return this.data.equippedGear.reduce((sum, id) => sum + (GEAR[id]?.slotCost ?? 0), 0);
  }

  isGearEquipped(id: string): boolean {
    return this.data.equippedGear.includes(id);
  }

  /** Why `equipGear(id)` would refuse — null when it would succeed. */
  gearEquipBlockedReason(id: string): string | null {
    const item = GEAR[id];
    if (!item) return "Unknown item";
    if (!this.data.ownedGear.includes(id)) return "Not purchased";
    if (this.isGearEquipped(id)) return null;
    if (item.lbvUpgrade && !this.data.ownedGear.includes("lbv")) return "Requires the LBV platform";
    const cost = item.slotCost ?? 0;
    // A plate swap frees the outgoing plate's slots, so measure against that.
    const freed = item.plateType
      ? this.data.equippedGear.reduce((sum, wid) => sum + (GEAR[wid]?.plateType ? GEAR[wid]?.slotCost ?? 0 : 0), 0)
      : 0;
    if (this.pouchSlotsUsed() - freed + cost > this.pouchSlotCapacity()) return "Not enough pouch slots";
    return null;
  }

  /**
   * Wear an owned item. Plate types are mutually exclusive (wearing one takes
   * the other off), and capacity is enforced — no silent over-equipping.
   */
  equipGear(id: string): boolean {
    if (this.gearEquipBlockedReason(id) !== null) return false;
    if (this.isGearEquipped(id)) return true;
    const item = GEAR[id]!;
    if (item.plateType) {
      this.data.equippedGear = this.data.equippedGear.filter((wid) => !GEAR[wid]?.plateType);
    }
    this.data.equippedGear.push(id);
    this.data.equippedArmour = this.data.equippedGear.find((wid) => GEAR[wid]?.plateType) ?? null;
    this.save();
    return true;
  }

  /** Take an item off. Base kit (helmet/uniform/vest platform) can't be removed. */
  unequipGear(id: string): boolean {
    const item = GEAR[id];
    if (!item || item.alwaysEquipped || !this.isGearEquipped(id)) return false;
    this.data.equippedGear = this.data.equippedGear.filter((wid) => wid !== id);
    this.data.equippedArmour = this.data.equippedGear.find((wid) => GEAR[wid]?.plateType) ?? null;
    this.save();
    return true;
  }

  /** Sum a numeric gear field across WORN items only — the single rule every gear effect goes through. */
  equippedGearBonus(field: "carryBonus" | "reserveAmmoBonus" | "medkitBonus"): number {
    return this.data.equippedGear.reduce((sum, id) => sum + (GEAR[id]?.[field] ?? 0), 0);
  }

  strikeChargesFor(id: AbilitySpecial): number {
    return this.data.strikeCharges[id] ?? 0;
  }

  /** Spend one charge. Returns false (and spends nothing) when the stock is empty. */
  consumeStrikeCharge(id: AbilitySpecial): boolean {
    if (this.strikeChargesFor(id) <= 0) return false;
    this.data.strikeCharges[id] -= 1;
    this.save();
    return true;
  }

  canBuyStrikeCharge(id: AbilitySpecial): boolean {
    return (
      this.ownsAbility(id) &&
      this.strikeChargesFor(id) < STRIKE_MAX_CHARGES[id] &&
      this.data.credits >= STRIKE_CHARGE_PRICES[id]
    );
  }

  /** Armoury purchase of one extra charge. Refuses when unaffordable, unowned, or already at the stock cap. */
  buyStrikeCharge(id: AbilitySpecial): boolean {
    if (!this.canBuyStrikeCharge(id)) return false;
    if (!this.spendCredits(STRIKE_CHARGE_PRICES[id])) return false;
    this.data.strikeCharges[id] = this.strikeChargesFor(id) + 1;
    this.save();
    return true;
  }

  /**
   * Deployment top-up: every ability comes back to at least its base allowance,
   * while anything bought above that carries forward untouched.
   */
  replenishStrikeChargesForDeployment(): void {
    for (const id of ABILITY_SPECIALS) {
      this.data.strikeCharges[id] = Math.max(this.strikeChargesFor(id), STRIKE_BASE_CHARGES[id]);
    }
    this.save();
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

  /** Call-in abilities (UAV Recon, Precision Air Strike) are one-time unlocks, tracked in ownedGear like any other gear id. */
  ownsAbility(id: AbilitySpecial): boolean {
    return this.data.ownedGear.includes(id);
  }

  buyAbility(id: AbilitySpecial): boolean {
    if (this.ownsAbility(id)) return false;
    if (!this.spendCredits(SPECIAL_ABILITY_PRICES[id])) return false;
    this.data.ownedGear.push(id);
    this.save();
    return true;
  }

  /** First Aid Kits carried at spawn; the WORN medic pouch expands this without affecting weapons. */
  startingMedkitCount(): number {
    return STARTING_MEDKITS + this.equippedGearBonus("medkitBonus");
  }

  maxMedkitCount(): number {
    return MAX_MEDKITS + this.equippedGearBonus("medkitBonus");
  }

  buyBotty(price: number): boolean {
    if (this.data.hasBotty) return false;
    if (!this.spendCredits(price)) return false;
    this.data.hasBotty = true;
    this.save();
    return true;
  }

  /** Switches which owned plate type (hard/soft ballistic plates) is actually worn. */
  equipArmour(id: string): void {
    if (!GEAR[id]?.plateType) return;
    this.equipGear(id);
  }

  bottyUpgradeLevel(category: BottyUpgradeCategory): number {
    return this.data.bottyUpgrades[category] ?? 0;
  }

  buyBottyUpgrade(category: BottyUpgradeCategory): boolean {
    if (!this.data.hasBotty) return false;
    const level = this.bottyUpgradeLevel(category);
    const price = bottyUpgradePrice(category, level);
    if (price === null) return false;
    if (!this.spendCredits(price)) return false;
    this.data.bottyUpgrades[category] = level + 1;
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
