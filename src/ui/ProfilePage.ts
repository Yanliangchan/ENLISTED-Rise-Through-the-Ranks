import type { Backend, CareerPath, PublicProfile } from "@/core/Backend";
import { RANKS, type Track } from "@/data/ranks";
import { BADGES, CHALLENGE_OPS } from "@/data/badges";
import { GuardianPage } from "@/ui/GuardianPage";

const CAREER_PATH_CHOICES: Array<{ key: CareerPath; label: string; blurb: string }> = [
  { key: "officer", label: "Officer", blurb: "OCT → 2LT → LTA → CPT → MAJ → LTC → COL" },
  { key: "specialist", label: "Specialist (WOSpec)", blurb: "3SG → 2SG → 1SG → SSG → MSG → 3WO → 2WO → 1WO → MWO → SWO → CWO" },
  { key: "me", label: "Military Expert", blurb: "ME1 → ME2 → ME3 → ME4 → ME5 → ME6 → ME7 → ME8" },
];

const TRACK_LABELS: Record<Track, string> = {
  enlistee: "Enlistee (Other Ranks)",
  specialist: "Specialist (NCO)",
  warrant: "Warrant Officer",
  officer: "Officer (Commissioned)",
  military_expert: "Military Expert (MDES)",
};

/** Best-effort match from the server's free-text career-track string onto the reference ladder's Track type. */
function guessTrack(careerTrack: string): Track {
  const s = careerTrack.toLowerCase();
  if (s.includes("officer") || s.includes("lieutenant") || s.includes("captain") || s.includes("colonel") || s.includes("general")) return "officer";
  if (s.includes("warrant") || s.includes("wo")) return "warrant";
  if (s.includes("expert") || s.includes("mdes") || s.includes("me1") || s.includes("me2")) return "military_expert";
  if (s.includes("sergeant") || s.includes("specialist") || s.includes("sg")) return "specialist";
  return "enlistee";
}

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
  private guardianPage: GuardianPage;
  private viewerRoot: HTMLDivElement;
  private viewerBody: HTMLDivElement;
  visible = false;

  constructor(container: HTMLElement, private readonly backend: Backend) {
    this.guardianPage = new GuardianPage(container, backend);

    // Read-only "inspect another operator" overlay, opened from a leaderboard row click.
    this.viewerRoot = document.createElement("div");
    this.viewerRoot.style.cssText = `
      position: fixed; inset: 0; z-index: 58; display: none;
      background: rgba(4,8,6,0.96); overflow-y: auto;
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
    `;
    const viewerWrap = document.createElement("div");
    viewerWrap.style.cssText = "max-width: 640px; margin: 40px auto 60px; padding: 0 20px;";
    const viewerClose = document.createElement("button");
    viewerClose.textContent = "✕ CLOSE";
    viewerClose.style.cssText = `
      position: fixed; top: 20px; right: 28px; z-index: 59;
      background: rgba(20,30,20,0.9); color: #d7e8d0; border: 1px solid #3c4a34;
      padding: 8px 14px; font-family: inherit; font-size: 13px; cursor: pointer; letter-spacing: 1px;
    `;
    viewerClose.onclick = () => (this.viewerRoot.style.display = "none");
    this.viewerRoot.appendChild(viewerClose);
    this.viewerBody = document.createElement("div");
    viewerWrap.appendChild(this.viewerBody);
    this.viewerRoot.appendChild(viewerWrap);
    container.appendChild(this.viewerRoot);
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
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-size:26px; font-weight:800; letter-spacing:2px; color:#eaf4e4;">${escapeHtml(p.username)}</div>
            ${p.guardian ? `<button id="open-guardian" style="background:#3a1e1e; color:#e0a8a8; border:1px solid #6b3c3c; padding:4px 10px; font-family:inherit; font-size:11px; letter-spacing:1px; cursor:pointer;">GUARDIAN</button>` : ""}
          </div>
          <div style="font-size:13px; color:#9fc78a; letter-spacing:1px; margin-top:2px;">${escapeHtml(p.rank.name)} — ${escapeHtml(p.careerTrack)}</div>
          <div style="margin-top:10px; background:#0a120a; border:1px solid #2c3a26; height:16px; position:relative;">
            <div style="height:100%; width:${rankPct}%; background:#3c6b32;"></div>
            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:10px; color:#eaf4e4;">
              ${p.rank.xpForNextRank ? `${p.rank.xpIntoRank} / ${p.rank.xpForNextRank} XP to next rank` : `${p.rank.xp} XP — top rank`}
            </div>
          </div>
        </div>
      </div>

      ${
        p.rank.atCareerGate
          ? `
      <div style="background:#1c1608; border:1px solid #6b5a2c; padding:14px 16px; margin-bottom:24px;">
        <div style="font-size:13px; letter-spacing:1px; color:#e0c878; margin-bottom:6px;">CAREER PATH SELECTION</div>
        <div style="font-size:12px; color:#c7b487; margin-bottom:10px;">
          You've reached Corporal First Class. Choose a career path — this is permanent and determines every future promotion.
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${CAREER_PATH_CHOICES.map(
            (c) => `
            <button data-path="${c.key}" class="career-path-btn" style="
              text-align:left; background:#241d0e; color:#e8dcb8; border:1px solid #6b5a2c; padding:10px 12px;
              font-family:inherit; font-size:12px; cursor:pointer;
            "><div style="font-weight:bold;">${c.label}</div><div style="font-size:10px; color:#a89968; margin-top:2px;">${c.blurb}</div></button>`
          ).join("")}
        </div>
      </div>`
          : ""
      }

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

      ${this.buildCareerLadderSection(guessTrack(p.careerTrack))}

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
            <div class="lb-row" data-username="${escapeHtml(e.username)}" style="display:flex; justify-content:space-between; padding:5px 10px; cursor:pointer; ${
              e.username === p.username ? "background:#1c2c18; border-left:2px solid #6ea24a;" : ""
            }">
              <span>#${e.rank} ${escapeHtml(e.username)}</span><span>${e.value}</span>
            </div>`
            )
            .join("");
          lbBody.querySelectorAll<HTMLDivElement>(".lb-row").forEach((row) => {
            row.addEventListener("click", () => this.showPublicProfile(row.dataset.username!));
          });
        })
        .catch(() => {
          lbBody.textContent = "Leaderboard unavailable.";
        });
    };
    tabButtons.forEach((b) => b.addEventListener("click", () => loadCategory(b.dataset.cat!)));
    loadCategory(LEADERBOARD_CATEGORIES[0].key);

    this.body.querySelector<HTMLButtonElement>("#open-guardian")?.addEventListener("click", () => this.guardianPage.show());
    this.body.querySelectorAll<HTMLButtonElement>(".career-path-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        void this.backend
          .chooseCareerPath(btn.dataset.path as CareerPath)
          .then(() => this.render())
          .catch(() => {
            btn.disabled = false;
          });
      });
    });

    const ladderToggle = this.body.querySelector<HTMLButtonElement>("#ladder-toggle");
    const ladderBody = this.body.querySelector<HTMLDivElement>("#ladder-body");
    ladderToggle?.addEventListener("click", () => {
      const open = ladderBody!.style.display !== "none";
      ladderBody!.style.display = open ? "none" : "block";
      ladderToggle.textContent = open ? "SHOW FULL LADDER + CHALLENGE OPS ▾" : "HIDE FULL LADDER + CHALLENGE OPS ▴";
    });
  }

  /** Opens the read-only viewer overlay for another operator, clicked in from a leaderboard row. */
  private showPublicProfile(username: string): void {
    this.viewerRoot.style.display = "block";
    this.viewerBody.innerHTML = `<div style="margin-top:30px; color:#9fc78a;">Loading ${escapeHtml(username)}…</div>`;
    void this.backend
      .fetchPublicProfile(username)
      .then((p) => this.renderPublicProfile(p))
      .catch(() => {
        this.viewerBody.innerHTML = `<div style="margin-top:30px; color:#c78a8a;">Could not load that operator's profile.</div>`;
      });
  }

  private renderPublicProfile(p: PublicProfile): void {
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
      : `<div style="color:#6f8566; font-size:13px;">No badges unlocked yet.</div>`;

    this.viewerBody.innerHTML = `
      <div style="margin: 30px 0 20px;">
        <div style="font-size:24px; font-weight:800; letter-spacing:2px; color:#eaf4e4;">${escapeHtml(p.username)}</div>
        <div style="font-size:13px; color:#9fc78a; letter-spacing:1px; margin-top:2px;">
          ${escapeHtml(p.rank.name)} — ${escapeHtml(p.careerTrack)}${p.careerPath ? ` (${escapeHtml(p.careerPath)})` : ""}
        </div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:24px;">
        ${statTile("Deployments", s.gamesPlayed)}
        ${statTile("Total Kills", s.kills)}
        ${statTile("Deaths", s.deaths)}
        ${statTile("KDR", s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2))}
        ${statTile("Headshots", s.headshots)}
        ${statTile("Accuracy", `${p.accuracyPct}%`)}
        ${statTile("Highest Wave", s.highestWave)}
        ${statTile("Playtime", playtimeStr)}
      </div>
      <div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin-bottom:8px;">BADGES (${p.badges.length})</div>
      <div>${badgesHtml}</div>
    `;
  }

  /**
   * Reference/planning section: the full SAF-accurate multi-track rank
   * ladder and the badge/Challenge-Op catalog (src/data/ranks.ts,
   * src/data/badges.ts). This is presentation over the existing
   * server-authoritative rank/badges shown above — it doesn't (yet) replace
   * the live merit economy, since the two use different XP scales. Collapsed
   * by default since it's reference material, not something checked every visit.
   */
  private buildCareerLadderSection(track: Track): string {
    const tracks: Track[] = ["enlistee", "specialist", "warrant", "officer", "military_expert"];
    const rows = tracks
      .map((t) => {
        const ranksInTrack = RANKS.filter((r) => r.track === t).sort((a, b) => a.tier - b.tier);
        const isCurrent = t === track;
        return `
          <div style="margin-bottom:14px; ${isCurrent ? "border-left:2px solid #6ea24a; padding-left:10px;" : ""}">
            <div style="font-size:12px; letter-spacing:1px; color:${isCurrent ? "#bfe0ab" : "#7f9a72"}; margin-bottom:6px;">
              ${TRACK_LABELS[t]}${isCurrent ? " — YOUR TRACK" : ""}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${ranksInTrack
                .map(
                  (r) => `
                <div title="${escapeHtml(r.perk)}" style="
                  background:#0e1610; border:1px solid #2c3a26; padding:4px 8px; font-size:11px; color:#a9bfa0;
                ">${r.abbr}</div>`
                )
                .join("")}
            </div>
          </div>`;
      })
      .join("");

    const badgeRows = Object.values(BADGES)
      .map((b) => {
        const op = CHALLENGE_OPS[b.challengeId];
        return `
          <div style="background:#0e1610; border:1px solid #2c3a26; padding:8px 12px; margin-bottom:6px;">
            <div style="font-weight:bold; color:#bfe0ab; font-size:12px;">${escapeHtml(b.name)}</div>
            <div style="font-size:11px; color:#8fa585; margin-top:2px;">${escapeHtml(b.perk)}</div>
            <div style="font-size:10px; color:#6a8562; margin-top:4px;">${op ? escapeHtml(op.brief) : ""}</div>
          </div>`;
      })
      .join("");

    return `
      <button id="ladder-toggle" style="
        width:100%; text-align:left; background:none; border:1px solid #2c3a26; color:#7f9a72;
        font-family:inherit; font-size:11px; letter-spacing:2px; padding:8px 12px; margin-bottom:12px; cursor:pointer;
      ">SHOW FULL LADDER + CHALLENGE OPS ▾</button>
      <div id="ladder-body" style="display:none; margin-bottom:26px;">
        <div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin:14px 0 10px;">SAF CAREER LADDER</div>
        ${rows}
        <div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin:18px 0 10px;">CHALLENGE OPS (badge missions)</div>
        ${badgeRows}
      </div>`;
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
