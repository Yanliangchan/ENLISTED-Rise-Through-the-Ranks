import type { Backend } from "@/core/Backend";

const LEADERBOARD_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "highest_wave", label: "HIGHEST WAVE" },
  { key: "total_kills", label: "TOTAL KILLS" },
  { key: "best_game_kills", label: "BEST GAME KILLS" },
];

/**
 * Operator profile page — accessible from the main menu. Shows identity,
 * rank/XP progress, career track, badges, lifetime stats, and a leaderboard
 * browser. Reads from `backend.profile` (kept fresh by every match submission)
 * with a manual REFRESH that re-fetches from the server.
 */
export class ProfilePage {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  visible = false;

  constructor(container: HTMLElement, private readonly backend: Backend) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 55; display: none;
      background: rgba(4,8,6,0.94); overflow-y: auto;
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
    `;

    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width: 760px; margin: 40px auto 60px; padding: 0 20px;";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ CLOSE";
    closeBtn.style.cssText = `
      position: fixed; top: 20px; right: 28px; z-index: 56;
      background: rgba(20,30,20,0.9); color: #d7e8d0; border: 1px solid #3c4a34;
      padding: 8px 14px; font-family: inherit; font-size: 13px; cursor: pointer; letter-spacing: 1px;
    `;
    closeBtn.onclick = () => this.hide();
    this.root.appendChild(closeBtn);

    this.body = document.createElement("div");
    wrap.appendChild(this.body);
    this.root.appendChild(wrap);
    container.appendChild(this.root);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "block";
    this.render();
    void this.backend
      .refreshProfile()
      .then(() => this.render())
      .catch(() => {
        /* keep showing the cached profile — offline is non-fatal here */
      });
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  private render(): void {
    const p = this.backend.profile;
    const s = p.stats;
    const mins = Math.floor(s.playtimeSec / 60);
    const hrs = Math.floor(mins / 60);
    const playtimeStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;

    const badgesHtml = p.badges.length
      ? p.badges
          .map(
            (b) => `
        <div style="display:flex; align-items:center; gap:10px; background:#0e1610; border:1px solid #2c3a26; padding:8px 12px; margin-bottom:6px;">
          <span style="font-size:20px;">${b.icon}</span>
          <div>
            <div style="font-weight:bold; color:#bfe0ab;">${escapeHtml(b.name)}</div>
            <div style="font-size:11px; color:#8fa585;">${escapeHtml(b.description)}</div>
          </div>
        </div>`
          )
          .join("")
      : `<div style="color:#6f8566; font-size:13px;">No badges unlocked yet — get out there, operator.</div>`;

    const rankPct = p.rank.xpForNextRank ? Math.min(100, Math.round((p.rank.xpIntoRank / p.rank.xpForNextRank) * 100)) : 100;

    this.body.innerHTML = `
      <div style="display:flex; gap:22px; align-items:flex-start; margin: 30px 0 24px;">
        <div style="
          width:110px; height:110px; flex-shrink:0; background:repeating-linear-gradient(45deg,#111 0,#111 6px,#1c1c1c 6px,#1c1c1c 12px);
          border:2px solid #444; display:flex; align-items:center; justify-content:center; position:relative;
        ">
          <span style="
            background:#000; color:#e5e5e5; font-weight:800; letter-spacing:2px; font-size:13px;
            padding:6px 8px; transform:rotate(-8deg); border:1px solid #555;
          ">REDACTED</span>
        </div>
        <div style="flex:1;">
          <div style="font-size:26px; font-weight:800; letter-spacing:2px; color:#eaf4e4;">${escapeHtml(p.username)}</div>
          <div style="font-size:13px; color:#9fc78a; letter-spacing:1px; margin-top:2px;">${escapeHtml(p.rank.name)} — ${escapeHtml(p.careerTrack)}</div>
          <div style="margin-top:10px; background:#0a120a; border:1px solid #2c3a26; height:16px; position:relative;">
            <div style="height:100%; width:${rankPct}%; background:#3c6b32;"></div>
            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:10px; color:#eaf4e4;">
              ${p.rank.xpForNextRank ? `${p.rank.xpIntoRank} / ${p.rank.xpForNextRank} XP to next rank` : `${p.rank.xp} XP — top rank`}
            </div>
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:24px;">
        ${statTile("Deployments", s.gamesPlayed)}
        ${statTile("Total Kills", s.kills)}
        ${statTile("Headshots", s.headshots)}
        ${statTile("Accuracy", `${p.accuracyPct}%`)}
        ${statTile("Highest Wave", s.highestWave)}
        ${statTile("Best Game Kills", s.bestGameKills)}
        ${statTile("Total Playtime", playtimeStr)}
        ${statTile("XP", p.rank.xp)}
      </div>

      <div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin-bottom:8px;">BADGES EARNED (${p.badges.length})</div>
      <div style="margin-bottom:26px;">${badgesHtml}</div>

      <div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin-bottom:8px;">LEADERBOARD</div>
      <div id="lb-tabs" style="display:flex; gap:6px; margin-bottom:10px;">
        ${LEADERBOARD_CATEGORIES.map(
          (c, i) =>
            `<button data-cat="${c.key}" style="
              background:${i === 0 ? "#2c4a26" : "#141d12"}; color:#d7e8d0; border:1px solid #2c3a26;
              padding:6px 12px; font-family:inherit; font-size:12px; cursor:pointer; letter-spacing:1px;
            ">${c.label}</button>`
        ).join("")}
      </div>
      <div id="lb-body" style="font-size:13px;">Loading…</div>
    `;

    const lbBody = this.body.querySelector<HTMLDivElement>("#lb-body")!;
    const tabButtons = this.body.querySelectorAll<HTMLButtonElement>("#lb-tabs button");
    const loadCategory = (cat: string) => {
      tabButtons.forEach((b) => (b.style.background = b.dataset.cat === cat ? "#2c4a26" : "#141d12"));
      lbBody.textContent = "Loading…";
      void this.backend
        .fetchLeaderboard(cat, 10)
        .then((entries) => {
          if (!entries.length) {
            lbBody.textContent = "No entries yet.";
            return;
          }
          lbBody.innerHTML = entries
            .map(
              (e) => `
            <div style="display:flex; justify-content:space-between; padding:5px 10px; ${
              e.username === p.username ? "background:#1c2c18; border-left:2px solid #6ea24a;" : ""
            }">
              <span>#${e.rank} ${escapeHtml(e.username)}</span><span>${e.value}</span>
            </div>`
            )
            .join("");
        })
        .catch(() => {
          lbBody.textContent = "Leaderboard unavailable.";
        });
    };
    tabButtons.forEach((b) => b.addEventListener("click", () => loadCategory(b.dataset.cat!)));
    loadCategory(LEADERBOARD_CATEGORIES[0].key);
  }
}

function statTile(label: string, value: string | number): string {
  return `
    <div style="background:#0e1610; border:1px solid #2c3a26; padding:10px 12px;">
      <div style="font-size:10px; letter-spacing:1px; color:#7f9a72;">${label.toUpperCase()}</div>
      <div style="font-size:20px; font-weight:bold; color:#eaf4e4;">${value}</div>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
