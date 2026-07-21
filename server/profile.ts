import { queryOne, query } from "./db.js";
import { rankForXp, careerTrackFor, type RankProgress, type CareerPath } from "./ranks.js";

export interface PlayerStatsRow {
  games_played: number;
  kills: number;
  headshots: number;
  shots_fired: number;
  shots_hit: number;
  waves_cleared: number;
  highest_wave: number;
  best_game_kills: number;
  deaths: number;
  credits_earned: number;
  playtime_sec: number;
  career_kills_by_class: Record<string, number>;
}

const EMPTY_STATS: PlayerStatsRow = {
  games_played: 0,
  kills: 0,
  headshots: 0,
  shots_fired: 0,
  shots_hit: 0,
  waves_cleared: 0,
  highest_wave: 0,
  best_game_kills: 0,
  deaths: 0,
  credits_earned: 0,
  playtime_sec: 0,
  career_kills_by_class: {},
};

export interface ProfileDTO {
  username: string;
  save: unknown | null;
  settings: unknown | null;
  stats: {
    gamesPlayed: number;
    kills: number;
    headshots: number;
    shotsFired: number;
    shotsHit: number;
    wavesCleared: number;
    highestWave: number;
    bestGameKills: number;
    deaths: number;
    creditsEarned: number;
    playtimeSec: number;
  };
  accuracyPct: number;
  rank: RankProgress;
  careerTrack: string;
  careerPath: CareerPath | null;
  guardian: boolean;
  badges: Array<{ code: string; name: string; description: string; icon: string; category: string; rarity: string; unlocked: boolean; unlockedAt: string | null }>;
}

/** Assemble the full profile DTO the client's Profile page / login response uses. */
export async function loadProfile(userId: number): Promise<ProfileDTO | null> {
  const user = await queryOne<{ username: string; save_data: unknown; settings: unknown; career_path: CareerPath | null; guardian: boolean }>(
    "SELECT username, save_data, settings, career_path, guardian FROM users WHERE id = $1",
    [userId]
  );
  if (!user) return null;

  const statsRow = (await queryOne<PlayerStatsRow>("SELECT * FROM player_stats WHERE user_id = $1", [userId])) ?? EMPTY_STATS;
  const progression = await queryOne<{ xp: string }>("SELECT xp FROM progression WHERE user_id = $1", [userId]);
  const xp = progression ? Number(progression.xp) : 0;

  // Full badge catalogue with each badge's earned state for THIS user, so the
  // profile can render locked badges greyed out alongside earned ones. Order is
  // finalised client-side (category → rarity); we just fetch the set here.
  const badges = await query<{ code: string; name: string; description: string; icon: string; category: string; rarity: string; unlocked_at: string | null }>(
    `SELECT b.code, b.name, b.description, b.icon, b.category, b.rarity, ub.unlocked_at
     FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
     ORDER BY b.category, b.rarity, b.name`,
    [userId]
  );

  const shotsFired = statsRow.shots_fired;
  const accuracyPct = shotsFired === 0 ? 0 : Math.round((statsRow.shots_hit / shotsFired) * 100);

  return {
    username: user.username,
    save: user.save_data,
    settings: user.settings,
    careerPath: user.career_path,
    guardian: user.guardian,
    stats: {
      gamesPlayed: statsRow.games_played,
      kills: statsRow.kills,
      headshots: statsRow.headshots,
      shotsFired: statsRow.shots_fired,
      shotsHit: statsRow.shots_hit,
      wavesCleared: statsRow.waves_cleared,
      highestWave: statsRow.highest_wave,
      bestGameKills: statsRow.best_game_kills,
      deaths: statsRow.deaths,
      creditsEarned: statsRow.credits_earned,
      playtimeSec: statsRow.playtime_sec,
    },
    accuracyPct,
    rank: rankForXp(xp, user.career_path),
    careerTrack: careerTrackFor(statsRow.career_kills_by_class ?? {}),
    badges: badges.map((b) => ({
      code: b.code,
      name: b.name,
      description: b.description,
      icon: b.icon,
      category: b.category,
      rarity: b.rarity,
      unlocked: b.unlocked_at != null,
      unlockedAt: b.unlocked_at,
    })),
  };
}
