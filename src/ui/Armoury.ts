import { WEAPONS, type Weapon } from "@/data/weapons";
import { ATTACHMENTS } from "@/data/attachments";
import { GEAR, THROWABLES } from "@/data/gamedata";
import type { GameState } from "@/core/GameState";
import type { WeaponController } from "@/weapons/WeaponController";
import type { PlayerController } from "@/player/PlayerController";
import type { AudioManager } from "@/core/AudioManager";
import { applyGearToPlayer, maxThrowableCapacity } from "@/player/Gear";
import { getUnlockedSlots, isAttachmentCompatible } from "@/weapons/attachmentSlots";
import { BOTTY_PRICE } from "@/companion/Botty";

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
  private activeTab: Tab = "loadout";
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
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
      background: rgba(5,10,5,0.75); font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
      z-index: 20;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
      width: min(900px, 92vw); max-height: 86vh; overflow-y: auto;
      background: #10160f; border: 1px solid #3c4a34; box-shadow: 0 0 40px rgba(0,0,0,0.6);
      padding: 20px 24px;
    `;

    const header = document.createElement("div");
    header.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;";
    const title = document.createElement("div");
    title.textContent = "FIELD ARMOURY CACHE";
    title.style.cssText = "font-size:20px; font-weight:bold; letter-spacing:2px;";
    this.creditsLabel = document.createElement("div");
    this.creditsLabel.style.cssText = "font-size:18px; color:#e0c15a;";
    header.appendChild(title);
    header.appendChild(this.creditsLabel);

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
      ["gear", "Gear"],
      ["throwables", "Throwables"],
      ["support", "Support"],
    ];
    for (const [id, label] of tabs) {
      const btn = document.createElement("button");
      btn.textContent = label;
      styleButton(btn, id === this.activeTab ? "#4a7a3c" : "#2a332480");
      btn.onclick = () => this.setTab(id);
      this.tabBar.appendChild(btn);
    }
  }

  private refresh(): void {
    this.gameState.save();
    applyGearToPlayer(this.gameState, this.player);
    this.weaponController.refreshAttachments();
    this.renderContent();
  }

  private renderContent(): void {
    this.creditsLabel.textContent = `Credits: ${this.gameState.data.credits}`;
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

    wrap.appendChild(this.slotPicker("Primary", primaries.map((w) => [w.id, w.name]), this.gameState.data.loadout.primary, (id) => {
      this.gameState.data.loadout.primary = id;
      this.refresh();
    }));
    wrap.appendChild(this.slotPicker("Secondary", secondaries.map((w) => [w.id, w.name]), this.gameState.data.loadout.secondary, (id) => {
      this.gameState.data.loadout.secondary = id;
      this.refresh();
    }));
    wrap.appendChild(this.slotPicker("Special", specials.map((w) => [w.id, w.name]), this.gameState.data.loadout.special ?? "", (id) => {
      this.gameState.data.loadout.special = id || null;
      this.refresh();
    }, true));
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
    box.style.cssText = "border:1px solid #2a3324; padding:10px;";
    const title = document.createElement("div");
    title.textContent = label;
    title.style.cssText = "font-weight:bold; margin-bottom:8px; color:#9fc78a;";
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
    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; gap:8px;";
    for (const weapon of Object.values(WEAPONS)) {
      if (weapon.unlockedByDefault) continue;
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
    this.content.appendChild(list);
  }

  private renderAttachments(): void {
    const weaponId = this.gameState.data.loadout.primary;
    const weapon = WEAPONS[weaponId];
    const wrap = document.createElement("div");

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
        row.style.cssText = "display:flex; align-items:center; gap:10px; padding:6px; border:1px solid #23291f;";
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

  private renderGear(): void {
    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; gap:8px;";
    for (const item of Object.values(GEAR)) {
      if (item.price === 0) continue;
      const owned = this.gameState.data.ownedGear.includes(item.id);
      const needsLbv = item.id === "armour_plate" && !this.gameState.data.ownedGear.includes("lbv");
      const row = this.shopRow(item.name, item.price, owned, () => {
        if (needsLbv) return;
        if (this.gameState.spendCredits(item.price)) {
          this.gameState.data.ownedGear.push(item.id);
          this.gameState.save();
          this.audio.purchase();
          this.refresh();
        }
      });
      if (needsLbv) {
        const note = document.createElement("span");
        note.textContent = " (requires LBV)";
        note.style.cssText = "color:#a55; font-size:12px; margin-left:8px;";
        row.appendChild(note);
      }
      list.appendChild(row);
    }
    this.content.appendChild(list);
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
    const heading = document.createElement("div");
    heading.textContent = "AI Squadmate";
    heading.style.cssText = "font-weight:bold; margin-bottom:10px; color:#9fc78a;";
    wrap.appendChild(heading);

    const owned = this.gameState.data.hasBotty;
    const row = this.shopRow(
      "BOTTY — AI combat companion. Follows, suppresses, covers, and can be commanded via the wheel (Q).",
      BOTTY_PRICE,
      owned,
      () => {
        if (this.gameState.buyBotty(BOTTY_PRICE)) {
          this.audio.purchase();
          this.onBuyBotty?.();
          this.refresh();
        }
      }
    );
    wrap.appendChild(row);

    if (owned) {
      const note = document.createElement("div");
      note.textContent = "BOTTY is deployed with you. Use First Aid Kits to heal him if he goes down.";
      note.style.cssText = "color:#9fc78a; font-size:12px; margin-top:8px;";
      wrap.appendChild(note);
    }

    this.content.appendChild(wrap);
  }

  private shopRow(label: string, price: number, owned: boolean, onBuy: () => void): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:10px; padding:8px; border:1px solid #23291f;";
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

function styleButton(btn: HTMLButtonElement, bg: string): void {
  btn.style.cssText = `
    background:${bg}; color:#eaf0e6; border:1px solid rgba(255,255,255,0.15);
    padding:6px 12px; font-family:inherit; font-size:13px; cursor:pointer;
  `;
}
