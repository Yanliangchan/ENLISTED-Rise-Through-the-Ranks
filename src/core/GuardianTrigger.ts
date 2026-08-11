import { guardianGrantAccess } from "@/core/Backend";

/**
 * Hidden trigger that grants the *persistent* Guardian permission flag to an
 * account (server/routes/guardian.ts POST /grant, gated by the GUARDIAN_CODE
 * env var). Deliberately undocumented and unreferenced from any menu/help
 * text — mirrors src/core/AdminMode.ts's pattern, but this unlock is a real
 * database flag rather than a client-session unlock, since Guardian access
 * needs to persist and be revocable. Once granted, the Guardian tab appears
 * automatically for that account on next profile load.
 */
function showPrompt(currentUsername: string): void {
  if (document.getElementById("__gtv")) return;
  const overlay = document.createElement("div");
  overlay.id = "__gtv";
  overlay.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 999;
    background: rgba(4,8,6,0.96); border: 1px solid #2f3a28; padding: 14px 16px;
    font-family: Consolas, monospace; font-size: 12px; color: #9aa882; display: flex; flex-direction: column; gap: 8px;
  `;
  const label = document.createElement("div");
  label.textContent = `Grant Guardian access to: ${currentUsername}`;
  overlay.appendChild(label);
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "code";
  input.style.cssText = "background:#0e130c; border:1px solid #26301f; color:#d5ddc8; padding:6px 8px; font-family:inherit; outline:none;";
  overlay.appendChild(input);
  document.body.appendChild(overlay);
  input.focus();

  const close = () => overlay.remove();
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
    if (e.key === "Enter") {
      void guardianGrantAccess(currentUsername, input.value).then((result) => {
        label.textContent = result.ok ? "Granted — reload to see the Guardian tab." : `Failed: ${result.error ?? "unknown error"}`;
        window.setTimeout(close, 1500);
      });
    }
  });
  window.setTimeout(() => {
    if (document.body.contains(overlay)) close();
  }, 8000);
}

export function armGuardianTrigger(getCurrentUsername: () => string | null): void {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyG") {
      const username = getCurrentUsername();
      if (!username) return;
      e.preventDefault();
      showPrompt(username);
    }
  });
}
