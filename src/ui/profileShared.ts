/**
 * Small shared helpers between ProfilePage (your own identity/stats/earned
 * badges) and LeaderboardPage (the full leaderboard + badge reference guide).
 * Kept in one place so both pages render badge chips/stat tiles identically.
 */
export interface DisplayBadge {
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  unlocked: boolean;
}

export const RARITY_COLOR: Record<string, string> = {
  legendary: "#e6b84d", epic: "#c07de0", rare: "#4da6e6", uncommon: "#5bd07a", common: "#9fb59a",
};
export const RARITY_TIERS = ["legendary", "epic", "rare", "uncommon", "common"];

export function statTile(label: string, value: string | number): string {
  return `
    <div style="background:#0e1610; border:1px solid #26301f; padding:10px 12px;">
      <div style="font-size:10px; letter-spacing:1px; color:#67725c;">${label.toUpperCase()}</div>
      <div style="font-size:20px; font-weight:bold; color:#eaf4e4;">${value}</div>
    </div>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
