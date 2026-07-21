import type { Backend, CareerPath, Profile, PublicProfile } from "@/core/Backend";

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

/**
 * Guardian tab — hidden dev/mod/tester panel. Only ever constructed/shown
 * when `backend.profile.guardian` is true (checked by the caller); every
 * request it makes is additionally re-checked server-side by requireGuardian
 * (server/routes/guardian.ts), so a stale/forged client state can't bypass it.
 *
 * Scope: player lookup, manual badge grants (for Special/Support badges with
 * no automatic unlock check), XP/rank adjustment, and career-path override —
 * the subset of "player moderation / rank management / economy" from the
 * spec that maps cleanly onto data this game already tracks server-side.
 */
export class GuardianPage {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  visible = false;

  constructor(container: HTMLElement, private readonly backend: Backend) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 60; display: none;
      background: rgba(6,4,4,0.96); overflow-y: auto;
      font-family: Consolas, "Courier New", monospace; color: #e8d0d0;
    `;

    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width: 640px; margin: 40px auto 60px; padding: 0 20px;";

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
      <div id="g-result" style="font-size:12px; color:#c79f9f; margin-bottom:24px;"></div>
      <div id="g-tools" style="display:none;"></div>
    `;

    const usernameInput = this.body.querySelector<HTMLInputElement>("#g-username")!;
    const resultEl = this.body.querySelector<HTMLDivElement>("#g-result")!;
    const toolsEl = this.body.querySelector<HTMLDivElement>("#g-tools")!;

    const showProfile = (p: PublicProfile & { guardian: boolean }, username: string) => {
      const earned = p.badges.filter((b) => b.unlocked).length;
      resultEl.innerHTML = `
        <div style="background:#150e0e; border:1px solid #4a3c3c; padding:12px 14px;">
          <div style="font-size:15px; font-weight:bold; color:#eadada;">${escapeHtml(p.username)}${p.guardian ? "  —  GUARDIAN" : ""}</div>
          <div style="margin-top:4px; color:#e0a8a8;">${escapeHtml(p.rank.name)} · ${escapeHtml(p.careerTrack)}${p.careerPath ? ` (${escapeHtml(p.careerPath)})` : ""}</div>
          <div style="margin-top:4px;">XP ${p.rank.xp} · Kills ${p.stats.kills} · HS ${p.stats.headshots} · Deaths ${p.stats.deaths} · Acc ${p.accuracyPct}%</div>
          <div style="margin-top:4px;">Matches ${p.stats.gamesPlayed} · Highest Wave ${p.stats.highestWave} · Best Game ${p.stats.bestGameKills} · Badges ${earned}/${p.badges.length}</div>
        </div>`;
    };
    const doLookup = () => {
      const username = usernameInput.value.trim();
      if (!username) return;
      resultEl.textContent = "Looking up…";
      toolsEl.style.display = "none";
      void this.backend
        .guardianLookup(username)
        .then((p) => {
          showProfile(p, username);
          // Mutations return a fresh Profile; fold it back into the header so the
          // panel reflects the change with no restart.
          this.renderTools(toolsEl, username, p, (updated) => showProfile({ ...updated, guardian: p.guardian }, username));
          toolsEl.style.display = "block";
        })
        .catch(() => {
          resultEl.textContent = "No such operator.";
        });
    };
    this.body.querySelector<HTMLButtonElement>("#g-lookup")!.addEventListener("click", doLookup);
    usernameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") doLookup();
    });
  }

  private renderTools(
    toolsEl: HTMLDivElement,
    username: string,
    profile: PublicProfile,
    onUpdate: (p: Profile) => void
  ): void {
    const s = profile.stats;
    const section = (t: string) => `<div style="font-size:12px; letter-spacing:1px; color:#c79f9f; margin: 20px 0 8px;">${t}</div>`;
    const inputStyle = "background:#150e0e; border:1px solid #4a3c3c; color:#e8d0d0; padding:7px 9px; font-family:inherit; outline:none;";
    const btnStyle = "background:#3a1e1e; color:#e8d0d0; border:1px solid #6b3c3c; padding:7px 12px; font-family:inherit; font-size:12px; cursor:pointer;";
    toolsEl.innerHTML = `
      ${section("RANK &amp; ECONOMY")}
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:center;">
        <label style="font-size:11px; color:#a58f8f; width:60px;">XP</label>
        <input id="g-xp-set" type="number" value="${profile.rank.xp}" style="flex:1; min-width:140px; ${inputStyle}"/>
        <button id="g-xp-set-btn" style="${btnStyle}">SET</button>
        <input id="g-xp-delta" type="number" placeholder="± delta" style="width:110px; ${inputStyle}"/>
        <button id="g-xp-delta-btn" style="${btnStyle}">ADJUST</button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:center;">
        <label style="font-size:11px; color:#a58f8f; width:60px;">CURRENCY</label>
        <input id="g-credits" type="number" placeholder="credits" style="flex:1; min-width:140px; ${inputStyle}"/>
        <button id="g-credits-btn" style="${btnStyle}">SET</button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
        ${CAREER_PATH_OPTIONS.map(
          (o) => `<button data-path="${o.key}" class="g-path-btn" style="background:#241717; color:#e8d0d0; border:1px solid #4a3c3c; padding:7px 12px; font-family:inherit; font-size:11px; cursor:pointer;">SET ${o.label.toUpperCase()}</button>`
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
      <button id="g-stats-save" style="${btnStyle} margin-bottom:4px;">SAVE STATISTICS</button>

      ${section("MANUAL BADGE GRANT")}
      <div id="g-badges" style="font-size:11px; color:#a58f8f; margin-bottom:8px;">Loading catalogue…</div>

      ${section("ACCOUNT")}
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
        <button id="g-reset-stats" style="background:#241717; color:#e8d0d0; border:1px solid #6b3c3c; padding:7px 12px; font-family:inherit; font-size:11px; cursor:pointer;">RESET STATISTICS</button>
        <button id="g-reset-prog" style="background:#3a1414; color:#ffd0d0; border:1px solid #8b3c3c; padding:7px 12px; font-family:inherit; font-size:11px; cursor:pointer;">RESET PROGRESSION (XP+STATS+BADGES)</button>
      </div>

      ${section("STATUS")}
      <div id="g-status" style="font-size:11px; color:#8fbf8f;"></div>
    `;

    const statusEl = toolsEl.querySelector<HTMLDivElement>("#g-status")!;
    const setStatus = (msg: string) => {
      statusEl.textContent = msg;
    };
    /** Apply a mutation, fold the returned profile back into the header + re-render tools. */
    const apply = (label: string, promise: Promise<{ ok: boolean; profile: Profile }>) => {
      setStatus(`${label}…`);
      void promise
        .then((r) => {
          onUpdate(r.profile);
          this.renderTools(toolsEl, username, r.profile, onUpdate);
          const st = toolsEl.querySelector<HTMLDivElement>("#g-status");
          if (st) st.textContent = `${label} — done.`;
        })
        .catch(() => setStatus(`${label} failed.`));
    };

    toolsEl.querySelector<HTMLButtonElement>("#g-xp-set-btn")!.addEventListener("click", () => {
      const xp = Number(toolsEl.querySelector<HTMLInputElement>("#g-xp-set")!.value);
      if (Number.isFinite(xp)) apply("Set XP", this.backend.guardianSetXp(username, Math.round(xp)));
    });
    toolsEl.querySelector<HTMLButtonElement>("#g-xp-delta-btn")!.addEventListener("click", () => {
      const delta = Number(toolsEl.querySelector<HTMLInputElement>("#g-xp-delta")!.value);
      if (Number.isFinite(delta) && delta !== 0) {
        void this.backend
          .guardianAdjustXp(username, Math.round(delta))
          .then((r) => apply("Adjust XP", this.backend.guardianSetXp(username, r.xp)))
          .catch(() => setStatus("XP adjustment failed."));
      }
    });
    toolsEl.querySelector<HTMLButtonElement>("#g-credits-btn")!.addEventListener("click", () => {
      const c = Number(toolsEl.querySelector<HTMLInputElement>("#g-credits")!.value);
      if (Number.isFinite(c) && c >= 0) apply("Set currency", this.backend.guardianSetCredits(username, Math.round(c)));
    });
    toolsEl.querySelector<HTMLButtonElement>("#g-stats-save")!.addEventListener("click", () => {
      const stats: Record<string, number> = {};
      toolsEl.querySelectorAll<HTMLInputElement>(".g-stat").forEach((inp) => {
        const v = Number(inp.value);
        if (Number.isFinite(v) && v >= 0) stats[inp.dataset.key!] = Math.round(v);
      });
      apply("Save statistics", this.backend.guardianSetStats(username, stats));
    });
    toolsEl.querySelector<HTMLButtonElement>("#g-reset-stats")!.addEventListener("click", () => {
      if (confirm(`Reset ALL combat statistics for ${username}?`)) apply("Reset statistics", this.backend.guardianResetStats(username));
    });
    toolsEl.querySelector<HTMLButtonElement>("#g-reset-prog")!.addEventListener("click", () => {
      if (confirm(`Full progression wipe (XP + stats + badges) for ${username}? This cannot be undone.`))
        apply("Reset progression", this.backend.guardianResetProgression(username));
    });

    toolsEl.querySelectorAll<HTMLButtonElement>(".g-path-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        apply(`Set path ${btn.dataset.path}`, this.backend.guardianSetCareerPath(username, btn.dataset.path as CareerPath));
      });
    });

    const badgesEl = toolsEl.querySelector<HTMLDivElement>("#g-badges")!;
    void this.backend
      .guardianListBadges(username)
      .then((r) => {
        badgesEl.innerHTML = r.badges
          .map(
            (b) => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#150e0e; border:1px solid #3a2c2c; padding:6px 10px; margin-bottom:4px;">
            <span>${b.icon} ${escapeHtml(b.name)} <span style="color:#7a6363;">(${b.category}/${b.rarity})</span></span>
            ${
              b.unlocked
                ? `<span style="color:#8fbf8f;">OWNED</span>`
                : `<button data-code="${b.code}" class="g-grant-btn" style="background:#241717; color:#e8d0d0; border:1px solid #4a3c3c; padding:4px 8px; font-family:inherit; font-size:10px; cursor:pointer;">GRANT</button>`
            }
          </div>`
          )
          .join("");
        badgesEl.querySelectorAll<HTMLButtonElement>(".g-grant-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            void this.backend
              .guardianGrantBadge(username, btn.dataset.code!)
              .then(() => {
                setStatus(`Granted ${btn.dataset.code}.`);
                // Refresh profile (badge count) + re-render tools with the new state.
                void this.backend
                  .guardianLookup(username)
                  .then((p) => {
                    onUpdate({ ...p, save: null, settings: null } as Profile);
                    this.renderTools(toolsEl, username, p, onUpdate);
                  })
                  .catch(() => {});
              })
              .catch(() => setStatus("Badge grant failed."));
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
