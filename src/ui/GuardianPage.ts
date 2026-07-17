import type { Backend, CareerPath } from "@/core/Backend";

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

    const doLookup = () => {
      const username = usernameInput.value.trim();
      if (!username) return;
      resultEl.textContent = "Looking up…";
      toolsEl.style.display = "none";
      void this.backend
        .guardianLookup(username)
        .then((p) => {
          resultEl.innerHTML = `
            <div style="background:#150e0e; border:1px solid #4a3c3c; padding:12px 14px;">
              <div style="font-size:15px; font-weight:bold; color:#eadada;">${escapeHtml(p.username)} ${p.guardian ? " — GUARDIAN" : ""}</div>
              <div style="margin-top:4px;">${escapeHtml(p.rank.name)} — ${escapeHtml(p.careerTrack)}${p.careerPath ? ` (${escapeHtml(p.careerPath)})` : ""}</div>
              <div style="margin-top:4px;">XP: ${p.rank.xp} · Kills: ${p.stats.kills} · Headshots: ${p.stats.headshots} · Deaths: ${p.stats.deaths}</div>
              <div style="margin-top:4px;">Accuracy: ${p.accuracyPct}% · Highest Wave: ${p.stats.highestWave} · Badges: ${p.badges.length}</div>
            </div>`;
          this.renderTools(toolsEl, username);
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

  private renderTools(toolsEl: HTMLDivElement, username: string): void {
    toolsEl.innerHTML = `
      <div style="font-size:12px; letter-spacing:1px; color:#c79f9f; margin-bottom:8px;">RANK MANAGEMENT</div>
      <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
        <input id="g-xp-delta" type="number" placeholder="XP delta (e.g. 500 or -500)" style="
          flex:1; min-width:180px; background:#150e0e; border:1px solid #4a3c3c; color:#e8d0d0; padding:7px 9px; font-family:inherit; outline:none;
        "/>
        <button id="g-xp-apply" style="background:#3a1e1e; color:#e8d0d0; border:1px solid #6b3c3c; padding:7px 12px; font-family:inherit; font-size:12px; cursor:pointer;">APPLY</button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap;">
        ${CAREER_PATH_OPTIONS.map(
          (o) => `<button data-path="${o.key}" class="g-path-btn" style="
            background:#241717; color:#e8d0d0; border:1px solid #4a3c3c; padding:7px 12px; font-family:inherit; font-size:11px; cursor:pointer;
          ">SET ${o.label.toUpperCase()}</button>`
        ).join("")}
      </div>

      <div style="font-size:12px; letter-spacing:1px; color:#c79f9f; margin-bottom:8px;">MANUAL BADGE GRANT</div>
      <div id="g-badges" style="font-size:11px; color:#a58f8f; margin-bottom:8px;">Loading catalogue…</div>

      <div style="font-size:12px; letter-spacing:1px; color:#c79f9f; margin: 20px 0 8px;">STATUS</div>
      <div id="g-status" style="font-size:11px; color:#8fbf8f;"></div>
    `;

    const statusEl = toolsEl.querySelector<HTMLDivElement>("#g-status")!;
    const setStatus = (msg: string) => {
      statusEl.textContent = msg;
    };

    toolsEl.querySelector<HTMLButtonElement>("#g-xp-apply")!.addEventListener("click", () => {
      const delta = Number(toolsEl.querySelector<HTMLInputElement>("#g-xp-delta")!.value);
      if (!Number.isFinite(delta)) return;
      void this.backend
        .guardianAdjustXp(username, delta)
        .then((r) => setStatus(`XP now ${r.xp}.`))
        .catch(() => setStatus("XP adjustment failed."));
    });

    toolsEl.querySelectorAll<HTMLButtonElement>(".g-path-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const path = btn.dataset.path as CareerPath;
        void this.backend
          .guardianSetCareerPath(username, path)
          .then(() => setStatus(`Career path set to ${path}.`))
          .catch(() => setStatus("Career path override failed."));
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
                void this.backend.guardianListBadges(username).then((r2) => {
                  badgesEl.dataset.refreshed = "1";
                  this.renderTools(toolsEl, username);
                  void r2;
                });
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
