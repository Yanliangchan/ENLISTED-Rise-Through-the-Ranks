import type { Backend, CareerPath } from "@/core/Backend";
import type { Track } from "@/data/ranks";
import { BADGES } from "@/data/badges";
import { GuardianPage } from "@/ui/GuardianPage";
import { RARITY_COLOR, RARITY_TIERS, statTile, escapeHtml, type DisplayBadge } from "@/ui/profileShared";

const CAREER_PATH_CHOICES: Array<{ key: CareerPath; label: string; blurb: string }> = [
  { key: "officer", label: "Officer", blurb: "OCT → 2LT → LTA → CPT → MAJ → LTC → COL" },
  { key: "specialist", label: "Specialist (WOSpec)", blurb: "3SG → 2SG → 1SG → SSG → MSG → 3WO → 2WO → 1WO → MWO → SWO → CWO" },
  { key: "me", label: "Military Expert", blurb: "ME1 → ME2 → ME3 → ME4 → ME5 → ME6 → ME7 → ME8" },
];

/**
 * The server's badge catalogue (server/migrations) and the reference SAF
 * Challenge Ops catalogue (src/data/badges.ts) use different id namespaces —
 * this maps the 5 qualification-badge server codes onto their matching
 * Challenge Op entry, so the profile can show the real "how to earn it" text
 * alongside the live earned/locked state.
 */
const CODE_TO_CHALLENGE_BADGE: Record<string, string> = {
  ranger_tab: "ranger",
  guards_tab: "guards",
  airborne_tab: "parachutist",
  commando_recognition: "commando",
  master_marksman: "sniper",
};

/**
 * The other half of the "premium" showcase: genuinely-earnable skill badges
 * (server/migrations/0004_skill_badges.sql) tracked from real lifetime stats
 * rather than manually granted. These sit alongside the SAF qualification
 * badges above — same prominent placement, same card treatment — using the
 * server's own `description` text since they don't have a Challenge Op entry.
 */
const SKILL_BADGE_CODES = new Set([
  "combat_skills_basic", "combat_skills_advanced", "combat_skills_master",
  "sniper_basic", "sniper_advance", "sniper_master",
  "recon",
  "eod_basic", "eod_advanced", "eod_senior",
  "paramedic", "adss", "aiie",
]);

/**
 * Which row of the reference ladder to highlight as "YOUR TRACK". Must be
 * derived from the player's actual chosen `careerPath` (officer/specialist/me)
 * plus their current rank name — NOT from `Profile.careerTrack`, which is a
 * completely different field (a weapon-usage label like "Rifleman" or
 * "Marksman", derived from kills-by-class).
 */
export function resolveDisplayTrack(careerPath: CareerPath | null, rankName: string): Track {
  if (careerPath === "officer") return "officer";
  if (careerPath === "me") return "military_expert";
  if (careerPath === "specialist") return rankName.toLowerCase().includes("warrant") ? "warrant" : "specialist";
  return "enlistee";
}

/**
 * Operator profile page — accessible from the main menu. Shows identity,
 * rank/XP progress, career track, and ONLY the badges you've actually
 * earned (no greyed-out locked rows — see LeaderboardPage for the full
 * catalogue with explanations of how to earn everything). Reads from
 * `backend.profile` (kept fresh by every match submission) with a manual
 * REFRESH that re-fetches from the server.
 */
export class ProfilePage {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private guardianPage: GuardianPage;
  visible = false;

  /** Opens the dedicated Leaderboard & Badge Guide page — wired by main.ts. */
  onOpenGuide?: () => void;

  constructor(container: HTMLElement, private readonly backend: Backend) {
    this.guardianPage = new GuardianPage(container, backend);

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

      ${renderEarnedPremiumBadges(p.badges)}
      ${renderEarnedBadges(p.badges)}

      <button id="open-guide" style="
        width:100%; text-align:left; background:none; border:1px solid #2c3a26; color:#7f9a72;
        font-family:inherit; font-size:11px; letter-spacing:2px; padding:10px 12px; margin-bottom:26px; cursor:pointer;
      ">VIEW LEADERBOARD &amp; BADGE GUIDE →</button>
    `;

    this.body.querySelector<HTMLButtonElement>("#open-guardian")?.addEventListener("click", () => this.guardianPage.show());
    this.body.querySelector<HTMLButtonElement>("#open-guide")?.addEventListener("click", () => this.onOpenGuide?.());
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
  }
}

/**
 * Prominent, high-placed showcase for the "premium" badge set: the SAF
 * qualification badges (Ranger, Guards, Airborne, Commando, Marksmanship)
 * plus the genuinely-earnable skill badges (Combat Skills, Sniper, EOD,
 * Recon, Paramedic, ADSS, AIIE) — earned ones only. See LeaderboardPage for
 * the full catalogue including what you haven't earned yet.
 */
export function renderEarnedPremiumBadges(badges: DisplayBadge[]): string {
  const list = badges.filter((b) => b.unlocked && (CODE_TO_CHALLENGE_BADGE[b.code] || SKILL_BADGE_CODES.has(b.code)));
  if (!list.length) return "";
  const cards = list
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => {
      const ref = BADGES[CODE_TO_CHALLENGE_BADGE[b.code]];
      const col = RARITY_COLOR[b.rarity] ?? "#9fb59a";
      const howToEarn = ref ? ref.howToEarn : b.description;
      return `
        <div style="flex:1; min-width:210px; background:#0e1610; border:1px solid ${col}; padding:10px 12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:22px;">${b.icon}</span>
            <div>
              <div style="font-weight:bold; font-size:13px; color:${col};">${escapeHtml(b.name)}</div>
              <div style="font-size:9px; letter-spacing:1px; color:#6a8562; text-transform:uppercase;">${escapeHtml(b.rarity)}</div>
            </div>
          </div>
          <div style="font-size:10px; color:#7fae68; margin-top:8px;"><span style="color:#5a7a52;">HOW TO EARN:</span> ${escapeHtml(howToEarn)}</div>
        </div>`;
    })
    .join("");
  return `
    <div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin-bottom:10px;">PREMIUM BADGES (${list.length})</div>
    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:26px;">${cards}</div>`;
}

/** Render only the badges the operator has actually earned, grouped by rarity tier. */
export function renderEarnedBadges(badges: DisplayBadge[]): string {
  const earnedBadges = badges.filter((b) => b.unlocked);
  const heading = `<div style="font-size:13px; letter-spacing:2px; color:#9fc78a; margin-bottom:10px;">BADGES EARNED (${earnedBadges.length})</div>`;
  if (!earnedBadges.length) {
    return `${heading}<div style="color:#6f8566; font-size:13px; margin-bottom:26px;">No badges earned yet — see the Leaderboard &amp; Badge Guide for how to earn one.</div>`;
  }
  const sections = RARITY_TIERS.map((rarity) => {
    const list = earnedBadges.filter((b) => b.rarity === rarity).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return "";
    const col = RARITY_COLOR[rarity] ?? "#9fb59a";
    return `
      <div style="margin-bottom:14px;">
        <div style="font-size:10px; letter-spacing:1px; color:${col}; margin-bottom:6px;">${rarity.toUpperCase()} <span style="color:#54654c;">(${list.length})</span></div>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">${list.map(earnedBadgeChip).join("")}</div>
      </div>`;
  }).join("");
  return `${heading}<div style="margin-bottom:26px;">${sections}</div>`;
}

function earnedBadgeChip(b: DisplayBadge): string {
  const col = RARITY_COLOR[b.rarity] ?? "#9fb59a";
  return `
    <div title="${escapeHtml(`${b.name} — ${b.description}`)}" style="
      display:flex; align-items:center; gap:8px; min-width:132px;
      background:#0e1610; border:1px solid ${col}; padding:6px 10px;
    ">
      <span style="font-size:20px;">${b.icon}</span>
      <div style="line-height:1.25;">
        <div style="font-weight:bold; font-size:12px; color:${col};">${escapeHtml(b.name)}</div>
        <div style="font-size:9px; letter-spacing:1px; color:#7f9a72; text-transform:uppercase;">${escapeHtml(b.rarity)}</div>
      </div>
    </div>`;
}
