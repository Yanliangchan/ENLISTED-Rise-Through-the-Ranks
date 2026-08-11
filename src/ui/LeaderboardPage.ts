import type { Backend, PublicProfile } from "@/core/Backend";
import { RANKS, type Track } from "@/data/ranks";
import { BADGES, CHALLENGE_OPS } from "@/data/badges";
import { RARITY_COLOR, RARITY_TIERS, statTile, escapeHtml, type DisplayBadge } from "@/ui/profileShared";
import { resolveDisplayTrack } from "@/ui/ProfilePage";

const TRACK_LABELS: Record<Track, string> = {
  enlistee: "Enlistee (Other Ranks)",
  specialist: "Specialist (NCO)",
  warrant: "Warrant Officer",
  officer: "Officer (Commissioned)",
  military_expert: "Military Expert (MDES)",
};

const LEADERBOARD_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "highest_wave", label: "HIGHEST WAVE" },
  { key: "total_kills", label: "TOTAL KILLS" },
  { key: "best_game_kills", label: "BEST GAME KILLS" },
];

/** Same qualification-badge mapping ProfilePage uses — see there for why the id namespaces differ. */
const CODE_TO_CHALLENGE_BADGE: Record<string, string> = {
  ranger_tab: "ranger",
  guards_tab: "guards",
  airborne_tab: "parachutist",
  commando_recognition: "commando",
  master_marksman: "sniper",
};
const SKILL_BADGE_CODES = new Set([
  "combat_skills_basic", "combat_skills_advanced", "combat_skills_master",
  "sniper_basic", "sniper_advance", "sniper_master",
  "recon",
  "eod_basic", "eod_advanced", "eod_senior",
  "paramedic", "adss", "aiie",
]);

/**
 * Dedicated full-screen page for the leaderboard and the complete badge
 * reference guide — every badge in the catalogue, earned or not, with a name,
 * rarity, and exactly how to earn it. Split out from ProfilePage so your own
 * profile only ever shows what you've actually earned, while this page is the
 * place to browse everything that exists and how to get it. Reuses
 * `backend.profile.badges` for the reference catalogue (it always contains
 * the full 48-badge list with each one's live unlocked state for you).
 */
export class LeaderboardPage {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private viewerRoot: HTMLDivElement;
  private viewerBody: HTMLDivElement;
  visible = false;

  constructor(container: HTMLElement, private readonly backend: Backend) {
    this.viewerRoot = document.createElement("div");
    this.viewerRoot.style.cssText = `
      position: fixed; inset: 0; z-index: 58; display: none;
      background: rgba(4,8,6,0.96); overflow-y: auto;
      font-family: Consolas, "Courier New", monospace; color: #d5ddc8;
    `;
    const viewerWrap = document.createElement("div");
    viewerWrap.style.cssText = "max-width: 640px; margin: 40px auto 60px; padding: 0 20px;";
    const viewerClose = document.createElement("button");
    viewerClose.textContent = "✕ CLOSE";
    viewerClose.style.cssText = `
      position: fixed; top: 20px; right: 28px; z-index: 59;
      background: rgba(20,30,20,0.9); color: #d5ddc8; border: 1px solid #2f3a28;
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
      font-family: Consolas, "Courier New", monospace; color: #d5ddc8;
    `;
    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width: 780px; margin: 40px auto 60px; padding: 0 20px;";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ CLOSE";
    closeBtn.style.cssText = `
      position: fixed; top: 20px; right: 28px; z-index: 56;
      background: rgba(20,30,20,0.9); color: #d5ddc8; border: 1px solid #2f3a28;
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
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  private render(): void {
    const p = this.backend.profile;

    this.body.innerHTML = `
      <div style="font-size:24px; font-weight:800; letter-spacing:2px; color:#eaf4e4; margin:30px 0 4px;">LEADERBOARD &amp; BADGE GUIDE</div>
      <div style="font-size:12px; color:#67725c; margin-bottom:24px;">See where you rank, the full SAF career ladder, and exactly how to earn every badge in the game.</div>

      <div style="font-size:13px; letter-spacing:2px; color:#9aa882; margin-bottom:8px;">LEADERBOARD</div>
      <div id="lb-tabs" style="display:flex; gap:6px; margin-bottom:10px;">
        ${LEADERBOARD_CATEGORIES.map(
          (c, i) =>
            `<button data-cat="${c.key}" style="
              background:${i === 0 ? "#2c4a26" : "#141d12"}; color:#d5ddc8; border:1px solid #26301f;
              padding:6px 12px; font-family:inherit; font-size:12px; cursor:pointer; letter-spacing:1px;
            ">${c.label}</button>`
        ).join("")}
      </div>
      <div id="lb-body" style="font-size:13px; margin-bottom:30px;">Loading…</div>

      <div style="font-size:13px; letter-spacing:2px; color:#9aa882; margin:14px 0 4px;">SAF CAREER LADDER</div>
      <div style="font-size:10px; color:#5a7a52; margin-bottom:10px;">
        Every operator starts Enlistee. At Corporal you pick a track (Specialist, Officer or Military Expert) — that choice is permanent. Your current track is highlighted.
      </div>
      ${this.buildCareerLadder(resolveDisplayTrack(p.careerPath, p.rank.name))}

      <div style="font-size:13px; letter-spacing:2px; color:#9aa882; margin:22px 0 4px;">PREMIUM BADGES — HOW TO EARN THEM</div>
      <div style="font-size:10px; color:#5a7a52; margin-bottom:10px;">
        SAF-referenced qualifications and genuinely-earnable skill badges. Earned ones are highlighted; the rest show exactly what it takes.
      </div>
      ${renderFullPremiumBadges(p.badges)}

      <div style="font-size:13px; letter-spacing:2px; color:#9aa882; margin:22px 0 10px;">FULL BADGE CATALOGUE</div>
      ${renderFullBadgeCatalogue(p.badges)}
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
              <span>#${e.rank} <span style="color:#7fae68; font-weight:bold;">${escapeHtml(e.rankInsignia)}</span> ${escapeHtml(e.username)}</span><span>${e.value}</span>
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
  }

  /** Opens the read-only viewer overlay for another operator, clicked in from a leaderboard row. Only shows badges they've actually earned. */
  private showPublicProfile(username: string): void {
    this.viewerRoot.style.display = "block";
    this.viewerBody.innerHTML = `<div style="margin-top:30px; color:#9aa882;">Loading ${escapeHtml(username)}…</div>`;
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
    const earned = p.badges.filter((b) => b.unlocked);

    this.viewerBody.innerHTML = `
      <div style="margin: 30px 0 20px;">
        <div style="font-size:24px; font-weight:800; letter-spacing:2px; color:#eaf4e4;">${escapeHtml(p.username)}</div>
        <div style="font-size:13px; color:#9aa882; letter-spacing:1px; margin-top:2px;">
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
      <div style="font-size:13px; letter-spacing:2px; color:#9aa882; margin-bottom:8px;">BADGES EARNED (${earned.length})</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${earned.length ? earned.map(badgeChipEarned).join("") : `<div style="color:#6f8566; font-size:13px;">No badges earned yet.</div>`}
      </div>
    `;
  }

  private buildCareerLadder(track: Track): string {
    const tracks: Track[] = ["enlistee", "specialist", "warrant", "officer", "military_expert"];
    return tracks
      .map((t) => {
        const ranksInTrack = RANKS.filter((r) => r.track === t).sort((a, b) => a.tier - b.tier);
        const isCurrent = t === track;
        return `
          <div style="margin-bottom:14px; ${isCurrent ? "border-left:2px solid #6ea24a; padding-left:10px;" : ""}">
            <div style="font-size:12px; letter-spacing:1px; color:${isCurrent ? "#bfe0ab" : "#67725c"}; margin-bottom:6px;">
              ${TRACK_LABELS[t]}${isCurrent ? " — YOUR TRACK" : ""}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${ranksInTrack
                .map(
                  (r) => `
                <div title="${escapeHtml(r.perk)}" style="
                  background:#0e1610; border:1px solid #26301f; padding:4px 8px; font-size:11px; color:#8f9a80;
                ">${r.abbr}</div>`
                )
                .join("")}
            </div>
          </div>`;
      })
      .join("");
  }
}

/** Full premium-badge reference: every SAF qualification + skill badge, earned or not, each with its "how to earn" text. */
function renderFullPremiumBadges(badges: DisplayBadge[]): string {
  const list = badges.filter((b) => CODE_TO_CHALLENGE_BADGE[b.code] || SKILL_BADGE_CODES.has(b.code));
  const cards = list
    .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || a.name.localeCompare(b.name))
    .map((b) => {
      const ref = BADGES[CODE_TO_CHALLENGE_BADGE[b.code]];
      const op = ref ? CHALLENGE_OPS[ref.challengeId] : undefined;
      const col = RARITY_COLOR[b.rarity] ?? "#9fb59a";
      const locked = !b.unlocked;
      const howToEarn = ref ? ref.howToEarn : b.description;
      return `
        <div style="
          flex:1; min-width:210px; background:${locked ? "#090d09" : "#0e1610"}; border:1px solid ${locked ? "#242c20" : col};
          padding:10px 12px; opacity:${locked ? "0.7" : "1"};
        ">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:22px; filter:${locked ? "grayscale(1)" : "none"};">${b.icon}</span>
            <div>
              <div style="font-weight:bold; font-size:13px; color:${locked ? "#8f9a80" : col};">${escapeHtml(b.name)}</div>
              <div style="font-size:9px; letter-spacing:1px; color:#67725c; text-transform:uppercase;">${locked ? "NOT YET EARNED" : "EARNED"} · ${escapeHtml(b.rarity)}</div>
            </div>
          </div>
          ${ref ? `<div style="font-size:10px; color:#8f9a80; margin-top:8px;">${escapeHtml(ref.realLife)}</div>` : ""}
          <div style="font-size:10px; color:#7fae68; margin-top:6px;"><span style="color:#5a7a52;">HOW TO EARN:</span> ${escapeHtml(howToEarn)}</div>
          ${op ? `<div style="font-size:9px; color:#54654c; margin-top:4px;">${escapeHtml(op.name)}</div>` : ""}
        </div>`;
    })
    .join("");
  return `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:10px;">${cards}</div>`;
}

/** Every badge in the catalogue, grouped by rarity tier, earned or not — with a description tooltip for how each works. */
function renderFullBadgeCatalogue(badges: DisplayBadge[]): string {
  if (!badges.length) return `<div style="color:#6f8566; font-size:13px;">No badges in the catalogue yet.</div>`;
  const sections = RARITY_TIERS.map((rarity) => {
    const list = badges
      .filter((b) => b.rarity === rarity)
      .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || a.name.localeCompare(b.name));
    if (!list.length) return "";
    const earned = list.filter((b) => b.unlocked).length;
    const col = RARITY_COLOR[rarity] ?? "#9fb59a";
    return `
      <div style="margin-bottom:14px;">
        <div style="font-size:10px; letter-spacing:1px; color:${col}; margin-bottom:6px;">${rarity.toUpperCase()} <span style="color:#54654c;">(${earned}/${list.length})</span></div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">${list.map(badgeChipWithLock).join("")}</div>
      </div>`;
  }).join("");
  return sections || `<div style="color:#6f8566; font-size:13px;">No badges yet.</div>`;
}

function badgeChipWithLock(b: DisplayBadge): string {
  const col = RARITY_COLOR[b.rarity] ?? "#9fb59a";
  const locked = !b.unlocked;
  const tip = `${b.name} — ${b.description}${locked ? "  (NOT YET EARNED)" : ""}`;
  return `
    <div title="${escapeHtml(tip)}" style="
      display:flex; align-items:center; gap:8px; min-width:132px;
      background:${locked ? "#090d09" : "#0e1610"}; border:1px solid ${locked ? "#242c20" : col};
      padding:6px 10px; opacity:${locked ? "0.55" : "1"};
    ">
      <span style="font-size:20px; filter:${locked ? "grayscale(1)" : "none"};">${b.icon}</span>
      <div style="line-height:1.25;">
        <div style="font-weight:bold; font-size:12px; color:${locked ? "#6f8566" : col};">${escapeHtml(b.name)}</div>
        <div style="font-size:9px; letter-spacing:1px; color:#67725c; text-transform:uppercase;">${escapeHtml(b.rarity)}</div>
      </div>
    </div>`;
}

function badgeChipEarned(b: DisplayBadge): string {
  const col = RARITY_COLOR[b.rarity] ?? "#9fb59a";
  return `
    <div title="${escapeHtml(`${b.name} — ${b.description}`)}" style="
      display:flex; align-items:center; gap:8px; min-width:132px;
      background:#0e1610; border:1px solid ${col}; padding:6px 10px;
    ">
      <span style="font-size:20px;">${b.icon}</span>
      <div style="line-height:1.25;">
        <div style="font-weight:bold; font-size:12px; color:${col};">${escapeHtml(b.name)}</div>
        <div style="font-size:9px; letter-spacing:1px; color:#67725c; text-transform:uppercase;">${escapeHtml(b.rarity)}</div>
      </div>
    </div>`;
}
