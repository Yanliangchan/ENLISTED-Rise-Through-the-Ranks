import { WEAPONS } from "@/data/weapons";
import { ATTACHMENTS } from "@/data/attachments";
import { THROWABLES, GEAR } from "@/data/gamedata";
import type { GameState } from "@/core/GameState";

/** Set once verified — a few runtime systems (support-ability charges) check this to go unlimited. */
let unlocked = false;

export function isUnlocked(): boolean {
  return unlocked;
}

function applyUnlocks(gameState: GameState): void {
  const d = gameState.data;
  d.ownedWeapons = Object.keys(WEAPONS);
  d.ownedAttachments = Object.keys(ATTACHMENTS);
  d.ownedGear = Object.keys(GEAR);
  d.ownedThrowables = Object.keys(THROWABLES);
  d.credits = 999_999_999;
  d.medkitCount = 99;
  gameState.save();
  unlocked = true;
}

async function tryVerify(code: string, gameState: GameState, onResult: (ok: boolean) => void): Promise<void> {
  try {
    const resp = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await resp.json().catch(() => ({}))) as { ok?: boolean };
    if (body.ok) applyUnlocks(gameState);
    onResult(!!body.ok);
  } catch {
    onResult(false);
  }
}

function showPrompt(gameState: GameState): void {
  if (document.getElementById("__amv")) return;
  const overlay = document.createElement("div");
  overlay.id = "__amv";
  overlay.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 999;
    background: rgba(4,8,6,0.96); border: 1px solid #3c4a34; padding: 14px 16px;
    font-family: Consolas, monospace; font-size: 12px; color: #9fc78a;
  `;
  const input = document.createElement("input");
  input.type = "password";
  input.style.cssText = "background:#0a120a; border:1px solid #2c3a26; color:#d7e8d0; padding:6px 8px; font-family:inherit; outline:none;";
  overlay.appendChild(input);
  document.body.appendChild(overlay);
  input.focus();

  const close = () => overlay.remove();
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
    if (e.key === "Enter") {
      void tryVerify(input.value, gameState, () => close());
    }
  });
  window.setTimeout(() => {
    if (document.body.contains(overlay)) close();
  }, 8000);
}

/**
 * Wires the hidden trigger. Deliberately undocumented and unreferenced from
 * any menu/help text — this module is the only place the sequence exists.
 */
export function armAdminTrigger(gameState: GameState): void {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "Digit0") {
      e.preventDefault();
      showPrompt(gameState);
    }
  });
}
