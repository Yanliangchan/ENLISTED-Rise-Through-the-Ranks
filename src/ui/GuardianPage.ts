import type { Backend, CareerPath, Profile, PublicProfile } from "@/core/Backend";

/** A looked-up operator: the public profile plus the spendable credits the panel edits. */
type Target = (PublicProfile | Profile) & { guardian?: boolean };

/** Editable combat-stat fields → their label + Profile.stats key. */
const STAT_FIELDS: Array<{ key: keyof Profile["stats"]; label: string }> = [
  { key: "kills", label: "Kills" },
  { key: "headshots", label: "Headshots" },
  { key: "deaths", label: "Deaths" },
  { key: "gamesPlayed", label: "Matches" },
  { key: "highestWave", label: "Highest Wave" },
  { key: "bestGameKills", label: "Best Game Kills" },
  { key: "shotsFired", label: "Shots Fired" },
  { key: "shotsHit", label: "Shots Hit" },
];

const CAREER_PATH_OPTIONS: Array<{ key: CareerPath; label: string }> = [
  { key: "officer", label: "Officer" },
  { key: "specialist", label: "Specialist (WOSpec)" },
  { key: "me", label: "Military Expert" },
];

/** Quick money adjustments — one click each side of the SET field. */
const CREDIT_QUICK_STEPS = [1000, 10000, 100000];

/**
 * Guardian tab — hidden dev/mod/tester panel. Only ever constructed/shown when
 * `backend.profile.guardian` is true (checked by the caller); every request it
 * makes is additionally re-checked server-side by requireGuardian
 * (server/routes/guardian.ts), so a stale/forged client state can't bypass it.
 *
 * Player management: lookup, credits (money) editing, XP/rank + career path,
 * combat statistics, add/remove badges, and account resets. Every mutation
 * re-renders the panel from the server's response so the displayed money, XP,
 * stats and badges update immediately — no re-lookup or reconnect needed.
 */
export class GuardianPage {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  visible = false;

  /** Current lookup context, kept so mutations can refresh the same operator. */
  private username = "";
  private credits = 0;

  constructor(container: HTMLElement, private readonly backend: Backend) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 60; display: none;
      background: rgba(6,4,4,0.96); overflow-y: auto;
      font-family: Consolas, "Courier New", monospace; color: #e8d0d0;
    `;

    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width: 660px; margin: 40px auto 60px; padding: 0 20px;";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ CLOSE";
    closeBtn.style.cssText = `
      position: fixed; top: 20px; right: 28px; z-index: 61;
      background: rgba(30,20,20,0.9); color: #e8d0d0; border: 1px solid #4a3c3c;
      padding: 8px 14px; font-family: inherit; font-size: 13px; cursor: pointer; letter-spacing: 1px;
    `;
    closeBtn.onclick = () => this.hide();
    this.root.appendChild(closeBtn);

    const title = document.createElement("div");
    title.textContent = "GUARDIAN";
    title.style.cssText = "font-size:22px; font-weight:800; letter-spacing:3px; color:#e0a8a8; margin: 30px 0 4px;";
    wrap.appendChild(title);
    const sub = document.createElement("div");
    sub.textContent = "Restricted operator tooling. Actions here are logged server-side.";
    sub.style.cssText = "font-size:11px; color:#a58f8f; margin-bottom:20px;";
    wrap.appendChild(sub);

    this.body = document.createElement("div");
    wrap.appendChild(this.body);
    this.root.appendChild(wrap);
    container.appendChild(this.root);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "block";
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  private render(): void {
    this.body.innerHTML = `
      <div style="margin-bottom:10px;">
        <label style="font-size:11px; letter-spacing:1px; color:#c79f9f;">OPERATOR USERNAME</label><br/>
        <input id="g-username" type="text" placeholder="username" style="
          width:100%; box-sizing:border-box; background:#150e0e; border:1px solid #4a3c3c; color:#e8d0d0;
          padding:8px 10px; font-family:inherit; margin-top:4px; outline:none;
        "/>
      </div>
      <button id="g-lookup" style="
        background:#3a1e1e; color:#e8d0d0; border:1px solid #6b3c3c; padding:8px 14px;
        font-family:inherit; font-size:12px; cursor:pointer; letter-spacing:1px; margin-bottom:18px;
      ">LOOK UP</button>
      <div id="g-panel"></div>
    `;

    const usernameInput = this.body.querySelector<HTMLInputElement>("#g-username")!;
    const doLookup = () => {
      const username = usernameInput.value.trim();
      if (!username) return;
      this.panel().innerHTML = `<div style="font-size:12px; color:#c79f9f;">Looking up…</div>`;
      void this.lookup(username);
    };
    this.body.querySelector<HTMLButtonElement>("#g-lookup")!.addEventListener("click", doLookup);
    usernameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") doLookup();
    });
  }

  private panel(): HTMLDivElement {
    return this.body.querySelector<HTMLDivElement>("#g-panel")!;
  }

  /** Fetch an operator and render the full management panel. */
  private async lookup(username: string): Promise<void> {
    try {
      const p = await this.backend.guardianLookup(username);
      this.username = username;
      this.credits = p.credits;
      this.renderPanel(p);
    } catch {
      this.panel().innerHTML = `<div style="font-size:12px; color:#e08a8a;">No such operator.</div>`;
    }
  }

  /** Apply a mutation that returns a fresh profile (+ maybe credits), then re-render the whole panel. */
  private applyMutation(label: string, promise: Promise<{ profile: Profile; credits?: number }>): void {
    this.setStatus(`${label}…`);
    void promise
      .then((r) => {
        // credits comes from the explicit field, or the returned save blob, else unchanged.
        this.credits = r.credits ?? r.profile.save?.credits ?? this.credits;
        this.renderPanel(r.profile);
        this.setStatus(`${label} — done.`);
      })
      .catch(() => this.setStatus(`${label} failed.`));
  }

  private setStatus(msg: string): void {
    const el = this.panel().querySelector<HTMLDivElement>("#g-status");
    if (el) el.textContent = msg;
  }

  private renderPanel(p: Target): void {
    const s = p.stats;
    const earned = p.badges.filter((b) => b.unlocked).length;
    const section = (t: string) => `<div style="font-size:12px; letter-spacing:1px; color:#c79f9f; margin: 22px 0 8px;">${t}</div>`;
    const inputStyle =
      "background:#150e0e; border:1px solid #4a3c3c; color:#e8d0d0; padding:7px 9px; font-family:inherit; outline:none;";
    const btnStyle =
      "background:#3a1e1e; color:#e8d0d0; border:1px solid #6b3c3c; padding:7px 12px; font-family:inherit; font-size:12px; cursor:pointer;";
    const chip =
      "background:#241717; color:#e8d0d0; border:1px solid #4a3c3c; padding:6px 10px; font-family:inherit; font-size:11px; cursor:pointer;";

    this.panel().innerHTML = `
      <div style="background:#150e0e; border:1px solid #4a3c3c; padding:12px 14px;">
        <div style="font-size:15px; font-weight:bold; color:#eadada;">${escapeHtml(p.username)}${p.guardian ? "  —  GUARDIAN" : ""}</div>
        <div style="margin-top:4px; color:#e0a8a8;">${escapeHtml(p.rank.name)} · ${escapeHtml(p.careerTrack)}${p.careerPath ? ` (${escapeHtml(p.careerPath)})` : ""}</div>
        <div style="margin-top:6px; display:flex; gap:16px; flex-wrap:wrap;">
          <span style="color:#e8c86a; font-weight:bold;">💰 ${this.credits.toLocaleString()} cr</span>
          <span>XP ${p.rank.xp}</span>
          <span>Badges ${earned}/${p.badges.length}</span>
        </div>
        <div style="margin-top:4px; color:#c8b0b0;">Kills ${s.kills} · HS ${s.headshots} · Deaths ${s.deaths} · Acc ${p.accuracyPct}% · Matches ${s.gamesPlayed} · Highest Wave ${s.highestWave}</div>
      </div>

      ${section("MONEY (SPENDABLE CREDITS)")}
      <div style="display:flex; gap:8px; margin-bottom:6px; flex-wrap:wrap; align-items:center;">
        <input id="g-credits" type="number" min="0" value="${this.credits}" style="flex:1; min-width:150px; ${inputStyle}"/>
        <button id="g-credits-btn" style="${btnStyle}">SET MONEY</button>
      </div>
      <div style="display:flex; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
        ${CREDIT_QUICK_STEPS.map((n) => `<button class="g-cred-minus" data-n="${n}" style="${chip}">−${n.toLocaleString()}</button>`).join("")}
        ${CREDIT_QUICK_STEPS.map((n) => `<button class="g-cred-plus" data-n="${n}" style="${chip}">+${n.toLocaleString()}</button>`).join("")}
      </div>

      ${section("RANK / XP")}
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:center;">
        <label style="font-size:11px; color:#a58f8f; width:44px;">XP</label>
        <input id="g-xp-set" type="number" value="${p.rank.xp}" style="flex:1; min-width:140px; ${inputStyle}"/>
        <button id="g-xp-set-btn" style="${btnStyle}">SET</button>
        <input id="g-xp-delta" type="number" placeholder="± delta" style="width:110px; ${inputStyle}"/>
        <button id="g-xp-delta-btn" style="${btnStyle}">ADJUST</button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
        ${CAREER_PATH_OPTIONS.map(
          (o) => `<button data-path="${o.key}" class="g-path-btn" style="${chip}">SET ${o.label.toUpperCase()}</button>`
        ).join("")}
      </div>

      ${section("COMBAT STATISTICS")}
      <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:8px;">
        ${STAT_FIELDS.map(
          (f) => `<div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:10px; color:#a58f8f; flex:1;">${f.label}</label>
            <input class="g-stat" data-key="${f.key}" type="number" value="${s[f.key]}" style="width:96px; ${inputStyle}"/>
          </div>`
        ).join("")}
      </div>
      <button id="g-stats-save" style="${btnStyle}">SAVE STATISTICS</button>

      ${section(`BADGES (${earned}/${p.badges.length})`)}
      <div style="font-size:10px; color:#8a7373; margin-bottom:6px;">Click ADD to award or REMOVE to strip a badge — applies instantly.</div>
      <div id="g-badges" style="font-size:11px; color:#a58f8f;">Loading catalogue…</div>

      ${section("ACCOUNT")}
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
        <button id="g-reset-stats" style="background:#241717; color:#e8d0d0; border:1px solid #6b3c3c; padding:7px 12px; font-family:inherit; font-size:11px; cursor:pointer;">RESET STATISTICS</button>
        <button id="g-reset-prog" style="background:#3a1414; color:#ffd0d0; border:1px solid #8b3c3c; padding:7px 12px; font-family:inherit; font-size:11px; cursor:pointer;">RESET PROGRESSION (XP+STATS+BADGES)</button>
      </div>

      ${section("STATUS")}
      <div id="g-status" style="font-size:11px; color:#8fbf8f; min-height:14px;"></div>
    `;

    this.wirePanel(p);
  }

  private wirePanel(p: Target): void {
    const panel = this.panel();
    const username = this.username;

    // --- Money ---
    const creditsInput = panel.querySelector<HTMLInputElement>("#g-credits")!;
    panel.querySelector<HTMLButtonElement>("#g-credits-btn")!.addEventListener("click", () => {
      const c = Number(creditsInput.value);
      if (Number.isFinite(c) && c >= 0) this.applyMutation("Set money", this.backend.guardianSetCredits(username, Math.round(c)));
    });
    const bump = (delta: number) => {
      const next = Math.max(0, Math.round(this.credits + delta));
      this.applyMutation(delta >= 0 ? `+${delta} money` : `${delta} money`, this.backend.guardianSetCredits(username, next));
    };
    panel.querySelectorAll<HTMLButtonElement>(".g-cred-plus").forEach((b) => b.addEventListener("click", () => bump(Number(b.dataset.n))));
    panel.querySelectorAll<HTMLButtonElement>(".g-cred-minus").forEach((b) => b.addEventListener("click", () => bump(-Number(b.dataset.n))));

    // --- XP / rank ---
    panel.querySelector<HTMLButtonElement>("#g-xp-set-btn")!.addEventListener("click", () => {
      const xp = Number(panel.querySelector<HTMLInputElement>("#g-xp-set")!.value);
      if (Number.isFinite(xp) && xp >= 0) this.applyMutation("Set XP", this.backend.guardianSetXp(username, Math.round(xp)));
    });
    panel.querySelector<HTMLButtonElement>("#g-xp-delta-btn")!.addEventListener("click", () => {
      const delta = Number(panel.querySelector<HTMLInputElement>("#g-xp-delta")!.value);
      if (Number.isFinite(delta) && delta !== 0) {
        this.setStatus("Adjust XP…");
        void this.backend
          .guardianAdjustXp(username, Math.round(delta))
          .then((r) => this.applyMutation("Adjust XP", this.backend.guardianSetXp(username, r.xp)))
          .catch(() => this.setStatus("XP adjustment failed."));
      }
    });
    panel.querySelectorAll<HTMLButtonElement>(".g-path-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        this.applyMutation(`Set path ${btn.dataset.path}`, this.backend.guardianSetCareerPath(username, btn.dataset.path as CareerPath))
      );
    });

    // --- Stats ---
    panel.querySelector<HTMLButtonElement>("#g-stats-save")!.addEventListener("click", () => {
      const stats: Record<string, number> = {};
      panel.querySelectorAll<HTMLInputElement>(".g-stat").forEach((inp) => {
        const v = Number(inp.value);
        if (Number.isFinite(v) && v >= 0) stats[inp.dataset.key!] = Math.round(v);
      });
      this.applyMutation("Save statistics", this.backend.guardianSetStats(username, stats));
    });

    // --- Resets ---
    panel.querySelector<HTMLButtonElement>("#g-reset-stats")!.addEventListener("click", () => {
      if (confirm(`Reset ALL combat statistics for ${username}?`)) this.applyMutation("Reset statistics", this.backend.guardianResetStats(username));
    });
    panel.querySelector<HTMLButtonElement>("#g-reset-prog")!.addEventListener("click", () => {
      if (confirm(`Full progression wipe (XP + stats + badges) for ${username}? This cannot be undone.`))
        this.applyMutation("Reset progression", this.backend.guardianResetProgression(username));
    });

    // --- Badges (add / remove) ---
    this.renderBadges(p);
  }

  private renderBadges(p: Target): void {
    const badgesEl = this.panel().querySelector<HTMLDivElement>("#g-badges");
    if (!badgesEl) return;
    void this.backend
      .guardianListBadges(this.username)
      .then((r) => {
        badgesEl.innerHTML = r.badges
          .map(
            (b) => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#150e0e; border:1px solid ${b.unlocked ? "#3c5a3c" : "#3a2c2c"}; padding:6px 10px; margin-bottom:4px;">
            <span>${b.icon} ${escapeHtml(b.name)} <span style="color:#7a6363;">(${b.category}/${b.rarity})</span>${b.unlocked ? ` <span style="color:#8fbf8f;">· owned</span>` : ""}</span>
            <button data-code="${b.code}" data-owned="${b.unlocked ? "1" : "0"}" class="g-badge-btn" style="
              background:${b.unlocked ? "#3a1414" : "#173017"}; color:${b.unlocked ? "#ffd0d0" : "#d0ffd0"};
              border:1px solid ${b.unlocked ? "#8b3c3c" : "#3c8b3c"}; padding:4px 10px; font-family:inherit; font-size:10px; cursor:pointer;
            ">${b.unlocked ? "REMOVE" : "ADD"}</button>
          </div>`
          )
          .join("");
        badgesEl.querySelectorAll<HTMLButtonElement>(".g-badge-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.dataset.code!;
            const owned = btn.dataset.owned === "1";
            const call = owned ? this.backend.guardianRevokeBadge(this.username, code) : this.backend.guardianGrantBadge(this.username, code);
            this.setStatus(`${owned ? "Removing" : "Adding"} ${code}…`);
            void call
              .then(() => {
                this.setStatus(`${owned ? "Removed" : "Added"} ${code}.`);
                // Refresh the whole panel so the badge count + list reflect the change immediately.
                void this.lookup(this.username);
              })
              .catch(() => this.setStatus(`Badge ${owned ? "removal" : "grant"} failed.`));
          });
        });
      })
      .catch(() => {
        badgesEl.textContent = "Badge catalogue unavailable.";
      });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
