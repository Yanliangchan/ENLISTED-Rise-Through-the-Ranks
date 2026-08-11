import { WEAPONS, WEAPON_CATEGORIES, type Weapon } from "@/data/weapons";
import { ATTACHMENTS } from "@/data/attachments";
import {
  GEAR,
  THROWABLES,
  SPECIAL_ABILITY_LABELS,
  SPECIAL_ABILITY_PRICES,
  STRIKE_CHARGE_PRICES,
  STRIKE_MAX_CHARGES,
  ABILITY_SPECIALS,
  type GearItem,
} from "@/data/gamedata";
import { BOTTY_UPGRADE_CATEGORIES, BOTTY_UPGRADES, bottyUpgradePrice } from "@/data/bottyUpgrades";
import type { GameState } from "@/core/GameState";
import type { WeaponController } from "@/weapons/WeaponController";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";
import { applyGearToPlayer, maxThrowableCapacity } from "@/player/Gear";
import { getUnlockedSlots, isAttachmentCompatible } from "@/weapons/attachmentSlots";
import { BOTTY_PRICE } from "@/companion/Botty";
import { injectTheme } from "@/ui/theme";

type Tab = "loadout" | "weapons" | "attachments" | "gear" | "throwables" | "support";

/**
 * Between-wave field armoury cache: buy/unlock weapons, attachments, gear,
 * and throwables with credits earned from kills/wave-clears, and set the
 * primary/secondary/special/throwable loadout for the next wave.
 */
export class Armoury {
  private root: HTMLDivElement;
  private tabBar: HTMLDivElement;
  private content: HTMLDivElement;
  private creditsLabel: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer: number | null = null;
  private activeTab: Tab = "loadout";
  /** Which loadout weapon the Attachments tab is editing. */
  private attachmentTarget: "primary" | "secondary" = "primary";
  /** Category section keys the player has collapsed, in either the Buy Menu or Inventory. */
  private collapsedCategories: Set<string> = new Set();
  visible = false;

  onStartWave?: () => void;
  /** Set by main.ts — called right after BOTTY is purchased so the world can spawn him. */
  onBuyBotty?: () => void;

  constructor(
    container: HTMLElement,
    private readonly gameState: GameState,
    private readonly weaponController: WeaponController,
    private readonly player: PlayerController,
    private readonly audio: AudioManager
  ) {
    injectTheme();
    this.root = document.createElement("div");
    this.root.className = "mil-overlay";
    this.root.style.zIndex = "20";

    const panel = document.createElement("div");
    panel.className = "mil-panel";
    panel.style.cssText = "width: min(900px, 92vw); max-height: 86vh; overflow-y: auto;";

    const header = document.createElement("div");
    header.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;";
    const title = document.createElement("div");
    title.textContent = "FIELD ARMOURY CACHE";
    title.className = "mil-title";
    this.creditsLabel = document.createElement("div");
    this.creditsLabel.style.cssText = "font-size:17px; color:#e0c15a;";
    header.appendChild(title);
    header.appendChild(this.creditsLabel);

    this.toastEl = document.createElement("div");
    this.toastEl.style.cssText =
      "min-height:16px; font-size:12px; letter-spacing:1px; color:#a8e08a; opacity:0;" +
      "transition:opacity 200ms ease; margin-bottom:8px;";

    this.tabBar = document.createElement("div");
    this.tabBar.style.cssText = "display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;";

    this.content = document.createElement("div");

    const footer = document.createElement("div");
    footer.style.cssText = "margin-top:18px; display:flex; justify-content:flex-end;";
    const startBtn = document.createElement("button");
    startBtn.textContent = "DEPLOY — Start Wave";
    styleButton(startBtn, "#3c6b32");
    startBtn.onclick = () => {
      this.audio.uiClick();
      this.onStartWave?.();
    };
    footer.appendChild(startBtn);

    panel.appendChild(header);
    panel.appendChild(this.toastEl);
    panel.appendChild(this.tabBar);
    panel.appendChild(this.content);
    panel.appendChild(footer);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.renderTabs();
    this.renderContent();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "flex";
    document.exitPointerLock();
    this.renderContent();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  /**
   * Re-renders the currently-open panel from the live GameState — used when
   * credits change from OUTSIDE the normal buy/sell flow (a Guardian money
   * edit reconciled in from the server) so the balance and every buy button's
   * afford/can't-afford styling update immediately if the shop is open. Does
   * NOT call gameState.save() — nothing local changed, there's nothing to push.
   */
  refreshDisplay(): void {
    if (!this.visible) return;
    this.renderContent();
  }

  private setTab(tab: Tab): void {
    this.activeTab = tab;
    this.audio.uiClick();
    this.renderTabs();
    this.renderContent();
  }

  private renderTabs(): void {
    this.tabBar.innerHTML = "";
    const tabs: Array<[Tab, string]> = [
      ["loadout", "Loadout"],
      ["weapons", "Weapons"],
      ["attachments", "Attachments"],
      ["gear", "LBV / Armour"],
      ["throwables", "Throwables"],
      ["support", "Support Equipment"],
    ];
    for (const [id, label] of tabs) {
      const btn = document.createElement("button");
      btn.textContent = label;
      styleButton(btn, id === this.activeTab ? "#4a7a3c" : "#2a332480");
      btn.onclick = () => this.setTab(id);
      this.tabBar.appendChild(btn);
    }
  }

  /**
   * Re-derive every gear-dependent pool from the CURRENT equipped loadout and
   * repaint. Called after any purchase, equip, or unequip.
   *
   * Carried counts are re-clamped here, which is what makes unequipping
   * honest: taking off the medic pouch immediately drops any kits held above
   * the smaller cap instead of letting the removed item keep paying out.
   */
  private refresh(): void {
    applyGearToPlayer(this.gameState, this.player);
    this.gameState.data.medkitCount = Math.min(this.gameState.data.medkitCount, this.gameState.maxMedkitCount());
    this.gameState.data.loadout.throwableCount = Math.min(
      this.gameState.data.loadout.throwableCount,
      maxThrowableCapacity(this.gameState)
    );
    this.gameState.save();
    this.weaponController.refreshAttachments();
    this.renderContent();
  }

  /** Short confirmation line under the header — purchases and kit changes both report here. */
  private toast(text: string, tone: "good" | "bad" = "good"): void {
    this.toastEl.textContent = text;
    this.toastEl.style.color = tone === "good" ? "#a8e08a" : "#e08a6a";
    this.toastEl.style.opacity = "1";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.opacity = "0";
    }, 2200);
  }

  private renderContent(): void {
    this.creditsLabel.textContent = `Credits: ${this.gameState.data.credits.toLocaleString()}`;
    this.content.innerHTML = "";
    switch (this.activeTab) {
      case "loadout":
        this.renderLoadout();
        break;
      case "weapons":
        this.renderWeapons();
        break;
      case "attachments":
        this.renderAttachments();
        break;
      case "gear":
        this.renderGear();
        break;
      case "throwables":
        this.renderThrowables();
        break;
      case "support":
        this.renderSupport();
        break;
    }
  }

  private renderLoadout(): void {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid; grid-template-columns: 1fr 1fr; gap:16px;";

    const primaries = Object.values(WEAPONS).filter((w) => w.slot === "primary" && this.gameState.ownsWeapon(w.id));
    const secondaries = Object.values(WEAPONS).filter((w) => w.slot === "secondary" && this.gameState.ownsWeapon(w.id));
    const specials = Object.values(WEAPONS).filter((w) => w.slot === "special" && this.gameState.ownsWeapon(w.id));
    const throwables = Object.values(THROWABLES).filter((t) => this.gameState.ownsThrowable(t.id));

    wrap.appendChild(this.categoryWeaponPicker("inv:primary", "Primary", primaries, this.gameState.data.loadout.primary, (id) => {
      this.gameState.data.loadout.primary = id;
      this.refresh();
    }));
    wrap.appendChild(this.categoryWeaponPicker("inv:secondary", "Secondary", secondaries, this.gameState.data.loadout.secondary, (id) => {
      this.gameState.data.loadout.secondary = id;
      this.refresh();
    }));
    // Special slot: the MATADOR (a carried weapon) plus the two call-in abilities
    // (UAV, air strike) — abilities must be unlocked below before they show up
    // here. Only one can be equipped; abilities fire with Z.
    const specialOptions: Array<[string, string]> = [
      ...specials.map((w) => [w.id, w.name] as [string, string]),
      ...ABILITY_SPECIALS.filter((id) => this.gameState.ownsAbility(id)).map(
        (id) => [id, SPECIAL_ABILITY_LABELS[id]] as [string, string]
      ),
    ];
    wrap.appendChild(this.slotPicker("Special", specialOptions, this.gameState.data.loadout.special ?? "", (id) => {
      this.gameState.data.loadout.special = id || null;
      this.refresh();
    }, true));

    const lockedAbilities = ABILITY_SPECIALS.filter((id) => !this.gameState.ownsAbility(id));
    if (lockedAbilities.length > 0) {
      const unlockBox = document.createElement("div");
      unlockBox.className = "mil-inset";
      unlockBox.style.cssText = "padding:10px; grid-column: 1 / -1;";
      const unlockTitle = document.createElement("div");
      unlockTitle.textContent = "Unlock Support Abilities";
      unlockTitle.style.cssText = "font-weight:bold; margin-bottom:6px; color:#9fc78a; width:100%;";
      unlockBox.appendChild(unlockTitle);
      for (const id of lockedAbilities) {
        unlockBox.appendChild(
          this.shopRow(SPECIAL_ABILITY_LABELS[id], SPECIAL_ABILITY_PRICES[id], false, () => {
            if (this.gameState.buyAbility(id)) {
              this.audio.purchase();
              this.refresh();
            }
          })
        );
      }
      wrap.appendChild(unlockBox);
    }
    wrap.appendChild(this.slotPicker("Throwable", throwables.map((t) => [t.id, t.name]), this.gameState.data.loadout.throwable, (id) => {
      this.gameState.data.loadout.throwable = id;
      this.gameState.data.loadout.throwableCount = maxThrowableCapacity(this.gameState);
      this.refresh();
    }));

    this.content.appendChild(wrap);
  }

  private slotPicker(
    label: string,
    options: Array<[string, string]>,
    current: string,
    onSelect: (id: string) => void,
    allowNone = false
  ): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "mil-inset";
    box.style.cssText = "padding:10px; display:flex; flex-wrap:wrap; gap:6px; align-content:flex-start;";
    const title = document.createElement("div");
    title.textContent = label;
    title.style.cssText = "font-weight:bold; margin-bottom:4px; color:#9fc78a; width:100%;";
    box.appendChild(title);
    if (allowNone) {
      const noneBtn = document.createElement("button");
      noneBtn.textContent = "(none)";
      styleButton(noneBtn, current === "" ? "#4a7a3c" : "#2a332480");
      noneBtn.onclick = () => onSelect("");
      box.appendChild(noneBtn);
    }
    for (const [id, name] of options) {
      const btn = document.createElement("button");
      btn.textContent = name;
      styleButton(btn, id === current ? "#4a7a3c" : "#2a332480");
      btn.onclick = () => onSelect(id);
      box.appendChild(btn);
    }
    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "None owned yet.";
      empty.style.cssText = "color:#777; font-size:13px;";
      box.appendChild(empty);
    }
    return box;
  }

  private renderWeapons(): void {
    const container = document.createElement("div");
    container.style.cssText = "display:flex; flex-direction:column; gap:10px;";
    for (const category of WEAPON_CATEGORIES) {
      const weaponsInCategory = category.weaponIds
        .map((id) => WEAPONS[id])
        .filter((w): w is Weapon => !!w && !w.unlockedByDefault);
      if (weaponsInCategory.length === 0) continue;

      const list = document.createElement("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:8px;";
      for (const weapon of weaponsInCategory) {
        const owned = this.gameState.ownsWeapon(weapon.id);
        list.appendChild(
          this.shopRow(
            `${weapon.name} — ${weapon.realCaliber}, ${weapon.class.toUpperCase()}`,
            weapon.price,
            owned,
            () => {
              if (this.gameState.buyWeapon(weapon.id)) {
                this.audio.purchase();
                this.refresh();
              }
            }
          )
        );
      }
      container.appendChild(this.categorySection(`shop:${category.name}`, category.icon, category.name, list));
    }
    this.content.appendChild(container);
  }

  /** Collapsible, icon-labeled section wrapper shared by the Buy Menu and Inventory pickers. */
  private categorySection(key: string, icon: string, name: string, body: HTMLElement): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "border:1px solid #3a4234; border-radius:6px; overflow:hidden;";

    const collapsed = this.collapsedCategories.has(key);
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex; align-items:center; gap:8px; padding:8px 10px; background:#232b1e; cursor:pointer; user-select:none;";
    const arrow = document.createElement("span");
    arrow.textContent = collapsed ? "▶" : "▼";
    arrow.style.cssText = "font-size:11px; color:#9fc78a; width:12px;";
    const iconSpan = document.createElement("span");
    iconSpan.textContent = icon;
    const nameSpan = document.createElement("span");
    nameSpan.textContent = name;
    nameSpan.style.cssText = "font-weight:bold; color:#d8e8c8;";
    header.appendChild(arrow);
    header.appendChild(iconSpan);
    header.appendChild(nameSpan);

    const bodyWrap = document.createElement("div");
    bodyWrap.style.cssText = `padding:8px 10px; ${collapsed ? "display:none;" : ""}`;
    bodyWrap.appendChild(body);

    header.onclick = () => {
      if (this.collapsedCategories.has(key)) {
        this.collapsedCategories.delete(key);
        bodyWrap.style.display = "";
        arrow.textContent = "▼";
      } else {
        this.collapsedCategories.add(key);
        bodyWrap.style.display = "none";
        arrow.textContent = "▶";
      }
    };

    wrap.appendChild(header);
    wrap.appendChild(bodyWrap);
    return wrap;
  }

  /** Like slotPicker, but groups the owned weapons for a slot into collapsible WEAPON_CATEGORIES sections. */
  private categoryWeaponPicker(
    keyPrefix: string,
    label: string,
    weapons: Weapon[],
    current: string,
    onSelect: (id: string) => void
  ): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "mil-inset";
    box.style.cssText = "padding:10px;";
    const title = document.createElement("div");
    title.textContent = label;
    title.style.cssText = "font-weight:bold; margin-bottom:6px; color:#9fc78a;";
    box.appendChild(title);

    let any = false;
    for (const category of WEAPON_CATEGORIES) {
      const owned = weapons.filter((w) => category.weaponIds.includes(w.id));
      if (owned.length === 0) continue;
      any = true;
      const row = document.createElement("div");
      row.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; align-content:flex-start;";
      for (const w of owned) {
        const btn = document.createElement("button");
        btn.textContent = w.name;
        styleButton(btn, w.id === current ? "#4a7a3c" : "#2a332480");
        btn.onclick = () => onSelect(w.id);
        row.appendChild(btn);
      }
      box.appendChild(this.categorySection(`${keyPrefix}:${category.name}`, category.icon, category.name, row));
    }
    if (!any) {
      const empty = document.createElement("div");
      empty.textContent = "None owned yet.";
      empty.style.cssText = "color:#777; font-size:13px;";
      box.appendChild(empty);
    }
    return box;
  }

  private renderAttachments(): void {
    // Attachments can be fitted to the primary OR the secondary — a small
    // selector switches which loadout weapon the list below applies to.
    const loadout = this.gameState.data.loadout;
    if (this.attachmentTarget === "secondary" && !loadout.secondary) this.attachmentTarget = "primary";
    const weaponId = this.attachmentTarget === "secondary" ? loadout.secondary : loadout.primary;
    const weapon = WEAPONS[weaponId];
    const wrap = document.createElement("div");

    const picker = document.createElement("div");
    picker.style.cssText = "display:flex; gap:8px; margin-bottom:12px;";
    for (const target of ["primary", "secondary"] as const) {
      const id = target === "primary" ? loadout.primary : loadout.secondary;
      const w = WEAPONS[id];
      if (!w) continue;
      const btn = document.createElement("button");
      btn.textContent = `${target === "primary" ? "Primary" : "Secondary"} — ${w.name}`;
      styleButton(btn, target === this.attachmentTarget ? "#4a7a3c" : "#2a332480");
      btn.onclick = () => {
        this.attachmentTarget = target;
        this.audio.uiClick();
        this.renderContent();
      };
      picker.appendChild(btn);
    }
    wrap.appendChild(picker);

    if (weapon) {
      const heading = document.createElement("div");
      heading.textContent = `Attachments for ${weapon.name}`;
      heading.style.cssText = "font-weight:bold; margin-bottom:10px; color:#9fc78a;";
      wrap.appendChild(heading);

      const unlockedSlots = getUnlockedSlots(weapon, this.gameState.getFittedAttachments(weapon.id));
      const list = document.createElement("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:8px;";

      const compatible = Object.values(ATTACHMENTS).filter(
        (a) => weapon.attachmentSlots.includes(a.slot) && isAttachmentCompatible(weapon, a.id)
      );

      for (const attachment of compatible) {
        const locked = !unlockedSlots.includes(attachment.slot);
        const owned = this.gameState.ownsAttachment(attachment.id);
        const fitted = this.gameState.getFittedAttachments(weapon.id).includes(attachment.id);
        const row = document.createElement("div");
        row.className = "mil-row";
        const label = document.createElement("div");
        label.style.cssText = "flex:1; min-width:0; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
        const labelText = `${attachment.name} [${attachment.slot}]${locked ? " — locked (needs P-Rail)" : ""}`;
        label.title = labelText;
        label.textContent = labelText;
        row.appendChild(label);

        if (!owned) {
          const buyBtn = document.createElement("button");
          buyBtn.textContent = attachment.price > 0 ? `Buy — ${attachment.price}c` : "Free";
          styleButton(buyBtn, "#3c6b32");
          buyBtn.disabled = locked;
          buyBtn.onclick = () => {
            if (this.gameState.buyAttachment(attachment.id)) {
              this.audio.purchase();
              this.refresh();
            }
          };
          row.appendChild(buyBtn);
        } else {
          const fitBtn = document.createElement("button");
          fitBtn.textContent = fitted ? "Fitted" : "Fit";
          styleButton(fitBtn, fitted ? "#4a7a3c" : "#2a332480");
          fitBtn.disabled = locked;
          fitBtn.onclick = () => {
            if (fitted) {
              this.gameState.unfitAttachment(weapon.id, attachment.slot);
            } else {
              this.gameState.fitAttachment(weapon.id, attachment.id);
            }
            this.refresh();
          };
          row.appendChild(fitBtn);
        }
        list.appendChild(row);
      }
      wrap.appendChild(list);
    } else {
      wrap.textContent = "Select a primary weapon in Loadout first.";
    }
    this.content.appendChild(wrap);
  }

  /**
   * LBV / equipment loadout. Every item shows what it costs, what it actually
   * does, whether it's purchased, whether it's WORN, and the pouch capacity it
   * occupies — so the player can see at a glance why they can't have all of it
   * at once, and what they're giving up when they swap.
   */
  private renderGear(): void {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; flex-direction:column; gap:10px;";

    const capacity = this.gameState.pouchSlotCapacity();
    const used = this.gameState.pouchSlotsUsed();

    // Capacity bar — the constraint that makes the rig a decision.
    const header = document.createElement("div");
    header.className = "mil-inset";
    header.style.cssText = "padding:12px 14px;";
    const pips = capacity > 0
      ? "▮".repeat(used) + "▯".repeat(Math.max(0, capacity - used))
      : "—";
    header.innerHTML =
      `<div style="display:flex; justify-content:space-between; align-items:center;">` +
      `<span style="font-weight:bold; color:#9fc78a; letter-spacing:1px;">VEST CAPACITY</span>` +
      `<span style="letter-spacing:4px; color:${used > capacity ? "#e08a6a" : "#e0c15a"}; font-size:16px;">${pips}` +
      `<span style="font-size:12px; letter-spacing:1px; color:#9fae9c; margin-left:10px;">${used} / ${capacity} SLOTS</span></span></div>` +
      `<div style="font-size:11px; color:#8fa886; margin-top:6px;">` +
      (capacity > 0
        ? "Buy freely — but only what fits on the vest is worn. Unequipping removes its effect immediately."
        : "Purchase the Modular Load Bearing Vest to unlock pouch capacity.") +
      `</div>`;
    wrap.appendChild(header);

    for (const item of Object.values(GEAR)) {
      if (item.price === 0 && !item.alwaysEquipped) continue;
      wrap.appendChild(this.gearCard(item));
    }
    this.content.appendChild(wrap);
  }

  private gearCard(item: GearItem): HTMLDivElement {
    const owned = this.gameState.data.ownedGear.includes(item.id);
    const equipped = this.gameState.isGearEquipped(item.id);
    const needsLbv = !!item.lbvUpgrade && !this.gameState.data.ownedGear.includes("lbv");
    const affordable = this.gameState.data.credits >= item.price;

    const card = document.createElement("div");
    card.className = "mil-inset";
    card.style.cssText =
      "padding:12px 14px; display:flex; gap:14px; align-items:flex-start;" +
      `border-left:3px solid ${equipped ? "#4a7a3c" : owned ? "#3c4a34" : "#2a3324"};`;

    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";

    const titleRow = document.createElement("div");
    titleRow.style.cssText = "display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:4px;";
    const name = document.createElement("span");
    name.textContent = item.name;
    name.style.cssText = `font-weight:bold; color:${equipped ? "#cfe6b8" : "#b8ccb0"};`;
    titleRow.appendChild(name);

    const status = document.createElement("span");
    if (equipped) {
      status.textContent = item.alwaysEquipped ? "STANDARD ISSUE" : "EQUIPPED";
      status.style.cssText = "font-size:10px; letter-spacing:2px; color:#a8e08a; border:1px solid #4a7a3c; padding:2px 7px;";
    } else if (owned) {
      status.textContent = "IN LOCKER";
      status.style.cssText = "font-size:10px; letter-spacing:2px; color:#9fae9c; border:1px solid #3c4a34; padding:2px 7px;";
    } else {
      status.textContent = "LOCKED";
      status.style.cssText = "font-size:10px; letter-spacing:2px; color:#7f8a78; border:1px solid #2a3324; padding:2px 7px;";
    }
    titleRow.appendChild(status);

    if (item.slotCost) {
      const slots = document.createElement("span");
      slots.textContent = `${item.slotCost} SLOT${item.slotCost > 1 ? "S" : ""}`;
      slots.style.cssText = "font-size:10px; letter-spacing:1.5px; color:#e0c15a;";
      titleRow.appendChild(slots);
    }
    info.appendChild(titleRow);

    const effect = document.createElement("div");
    effect.textContent = item.effect ?? "—";
    effect.style.cssText = `font-size:12.5px; color:${equipped ? "#a8e08a" : "#c9d8bf"}; margin-bottom:4px;`;
    info.appendChild(effect);

    const notes = document.createElement("div");
    notes.textContent = item.realNotes;
    notes.style.cssText = "font-size:11px; color:#8a9a84; line-height:1.45;";
    info.appendChild(notes);

    if (needsLbv && !owned) {
      const req = document.createElement("div");
      req.textContent = "Requires the Modular Load Bearing Vest.";
      req.style.cssText = "font-size:11px; color:#c98a6a; margin-top:5px;";
      info.appendChild(req);
    }

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex; flex-direction:column; gap:6px; min-width:120px; align-items:stretch;";

    if (!owned) {
      const buy = document.createElement("button");
      buy.textContent = `${item.price}c`;
      styleButton(buy, needsLbv || !affordable ? "#5a3232" : "#3c6b32");
      buy.disabled = needsLbv;
      buy.onclick = () => {
        if (needsLbv) return;
        if (!this.gameState.spendCredits(item.price)) {
          this.toast(`Not enough credits for ${item.name}.`, "bad");
          this.audio.uiClick();
          return;
        }
        this.gameState.data.ownedGear.push(item.id);
        // Auto-wear on purchase when it fits, so buying something has an
        // immediate effect rather than quietly landing in the locker.
        const worn = this.gameState.equipGear(item.id);
        this.audio.purchase();
        this.toast(worn ? `${item.name} purchased and equipped.` : `${item.name} purchased — no free pouch slots, stored in locker.`);
        this.refresh();
      };
      actions.appendChild(buy);
    } else if (item.alwaysEquipped) {
      const fixed = document.createElement("button");
      fixed.textContent = "WORN";
      fixed.disabled = true;
      styleButton(fixed, "#4a7a3c");
      actions.appendChild(fixed);
    } else if (equipped) {
      const off = document.createElement("button");
      off.textContent = "UNEQUIP";
      styleButton(off, "#2a332480");
      off.onclick = () => {
        this.gameState.unequipGear(item.id);
        this.audio.uiClick();
        this.toast(`${item.name} unequipped — its effect is removed.`);
        this.refresh();
      };
      actions.appendChild(off);
    } else {
      const blocked = this.gameState.gearEquipBlockedReason(item.id);
      const on = document.createElement("button");
      on.textContent = "EQUIP";
      styleButton(on, blocked ? "#5a3232" : "#3c6b32");
      on.onclick = () => {
        if (!this.gameState.equipGear(item.id)) {
          this.toast(`Cannot equip ${item.name} — ${blocked ?? "unavailable"}.`, "bad");
          this.audio.uiClick();
          return;
        }
        this.audio.purchase();
        this.toast(`${item.name} equipped.`);
        this.refresh();
      };
      actions.appendChild(on);
      if (blocked) {
        const why = document.createElement("div");
        why.textContent = blocked;
        why.style.cssText = "font-size:10px; color:#c98a6a; text-align:center;";
        actions.appendChild(why);
      }
    }

    card.appendChild(info);
    card.appendChild(actions);
    return card;
  }

  private renderThrowables(): void {
    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; gap:8px;";
    for (const t of Object.values(THROWABLES)) {
      if (t.price === 0) continue;
      const owned = this.gameState.ownsThrowable(t.id);
      list.appendChild(
        this.shopRow(`${t.name} — ${t.realNotes.slice(0, 42)}…`, t.price, owned, () => {
          if (this.gameState.buyThrowable(t.id)) {
            this.audio.purchase();
            this.refresh();
          }
        })
      );
    }
    this.content.appendChild(list);
  }

  private renderSupport(): void {
    const wrap = document.createElement("div");

    // --- Call-in charges -----------------------------------------------------
    const owned = ABILITY_SPECIALS.filter((id) => this.gameState.ownsAbility(id));
    if (owned.length > 0) {
      const chargeHeading = document.createElement("div");
      chargeHeading.textContent = "Call-In Charges";
      chargeHeading.style.cssText = "font-weight:bold; margin-bottom:4px; color:#9fc78a;";
      wrap.appendChild(chargeHeading);
      const note = document.createElement("div");
      note.textContent =
        "Charges are spent when a strike is called. Buy replacements here — each deployment also restores the free allowance.";
      note.style.cssText = "font-size:11px; color:#8a9a84; margin-bottom:10px;";
      wrap.appendChild(note);

      for (const id of owned) {
        const held = this.gameState.strikeChargesFor(id);
        const max = STRIKE_MAX_CHARGES[id];
        const price = STRIKE_CHARGE_PRICES[id];
        const atCap = held >= max;
        const affordable = this.gameState.data.credits >= price;

        const row = document.createElement("div");
        row.className = "mil-row";

        const label = document.createElement("div");
        label.style.cssText = "flex:1; min-width:0; font-size:13px;";
        label.innerHTML =
          `<span>${SPECIAL_ABILITY_LABELS[id]}</span>` +
          `<span style="color:#e0a15a; font-weight:bold; margin-left:10px;">× ${held}</span>` +
          `<span style="color:#8a9a84; font-size:11px; margin-left:6px;">/ ${max} max</span>`;
        row.appendChild(label);

        const btn = document.createElement("button");
        btn.textContent = atCap ? "AT CAPACITY" : `+1 CHARGE — ${price}c`;
        styleButton(btn, atCap ? "#2a332480" : affordable ? "#3c6b32" : "#5a3232");
        btn.disabled = atCap;
        btn.onclick = () => {
          if (!this.gameState.buyStrikeCharge(id)) {
            this.toast(
              atCap ? "Already carrying the maximum charges." : `Not enough credits — ${price}c needed.`,
              "bad"
            );
            this.audio.uiClick();
            return;
          }
          this.audio.purchase();
          this.toast(`${SPECIAL_ABILITY_LABELS[id]} — charge purchased (× ${this.gameState.strikeChargesFor(id)}).`);
          this.refresh();
        };
        row.appendChild(btn);
        wrap.appendChild(row);
      }

      const hr = document.createElement("hr");
      hr.className = "mil-hr";
      wrap.appendChild(hr);
    }

    const heading = document.createElement("div");
    heading.textContent = "AI Squadmate";
    heading.style.cssText = "font-weight:bold; margin-bottom:10px; color:#9fc78a;";
    wrap.appendChild(heading);

    const hasBotty = this.gameState.data.hasBotty;
    const row = this.shopRow(
      "BOTTY — AI combat companion. Follows, suppresses, covers, and can be commanded via the wheel (Q).",
      BOTTY_PRICE,
      hasBotty,
      () => {
        if (this.gameState.buyBotty(BOTTY_PRICE)) {
          this.audio.purchase();
          this.onBuyBotty?.();
          this.toast("BOTTY deployed to your squad.");
          this.refresh();
        } else {
          this.toast(`Not enough credits — ${BOTTY_PRICE}c needed.`, "bad");
          this.audio.uiClick();
        }
      }
    );
    wrap.appendChild(row);

    if (hasBotty) {
      const note = document.createElement("div");
      note.textContent = "BOTTY is deployed with you. Use First Aid Kits to heal him if he goes down.";
      note.style.cssText = "color:#9fc78a; font-size:12px; margin-top:8px;";
      wrap.appendChild(note);

      const upgradeHeading = document.createElement("div");
      upgradeHeading.textContent = "BOTTY Upgrade Tree";
      upgradeHeading.style.cssText = "font-weight:bold; margin:18px 0 10px; color:#9fc78a;";
      wrap.appendChild(upgradeHeading);

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid; grid-template-columns: 1fr 1fr; gap:10px;";
      for (const category of BOTTY_UPGRADE_CATEGORIES) {
        grid.appendChild(this.bottyUpgradeCard(category));
      }
      wrap.appendChild(grid);
    }

    this.content.appendChild(wrap);
  }

  private bottyUpgradeCard(category: (typeof BOTTY_UPGRADE_CATEGORIES)[number]): HTMLDivElement {
    const def = BOTTY_UPGRADES[category];
    const level = this.gameState.bottyUpgradeLevel(category);
    const price = bottyUpgradePrice(category, level);

    const card = document.createElement("div");
    card.className = "mil-inset";
    card.style.cssText = "padding:10px;";

    const title = document.createElement("div");
    title.style.cssText = "display:flex; justify-content:space-between; align-items:center; font-weight:bold; color:#9fc78a; margin-bottom:4px;";
    const pips = "●".repeat(level) + "○".repeat(3 - level);
    title.innerHTML = `<span>${def.name}</span><span style="letter-spacing:2px; color:${level >= 3 ? "#e0c15a" : "#9fc78a"};">${pips}</span>`;
    card.appendChild(title);

    const desc = document.createElement("div");
    desc.textContent = level >= 3 ? "Maxed — " + def.summary : def.summary;
    desc.style.cssText = "font-size:12px; color:#c9d8bf; margin-bottom:8px;";
    card.appendChild(desc);

    if (price !== null) {
      const nextDesc = document.createElement("div");
      nextDesc.textContent = `Level ${level + 1}: ${def.levelDescriptions[level]}`;
      nextDesc.style.cssText = "font-size:11px; color:#7f9a72; margin-bottom:8px;";
      card.appendChild(nextDesc);

      const btn = document.createElement("button");
      btn.textContent = `Upgrade — ${price}c`;
      styleButton(btn, this.gameState.data.credits >= price ? "#3c6b32" : "#5a3232");
      btn.onclick = () => {
        if (this.gameState.buyBottyUpgrade(category)) {
          this.audio.purchase();
          this.refresh();
        }
      };
      card.appendChild(btn);
    } else {
      const maxed = document.createElement("button");
      maxed.textContent = "MAX LEVEL";
      maxed.disabled = true;
      styleButton(maxed, "#4a7a3c");
      card.appendChild(maxed);
    }
    return card;
  }

  private shopRow(label: string, price: number, owned: boolean, onBuy: () => void): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "mil-row";
    const labelEl = document.createElement("div");
    labelEl.style.cssText = "flex:1; min-width:0; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
    labelEl.title = label;
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const btn = document.createElement("button");
    if (owned) {
      btn.textContent = "Owned";
      styleButton(btn, "#4a7a3c");
      btn.disabled = true;
    } else {
      btn.textContent = `${price}c`;
      styleButton(btn, this.gameState.data.credits >= price ? "#3c6b32" : "#5a3232");
      btn.onclick = onBuy;
    }
    row.appendChild(btn);
    return row;
  }
}

/**
 * Maps the legacy colour arguments onto the shared theme classes so every
 * armoury button gets the same hover/active treatment as the rest of the UI.
 */
function styleButton(btn: HTMLButtonElement, bg: string): void {
  btn.className = "mil-btn";
  if (bg === "#3c6b32") btn.classList.add("mil-btn-primary");
  else if (bg === "#4a7a3c") btn.classList.add("mil-btn-active");
  else if (bg === "#5a3232") btn.classList.add("mil-btn-danger");
}
