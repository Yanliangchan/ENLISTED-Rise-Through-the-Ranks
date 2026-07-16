-- Core accounts. Username uniqueness is enforced case-insensitively via
-- username_lower; the display username keeps whatever casing the player typed.
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  -- NULL (not '{}') until the client's first save — lets the frontend tell
  -- "brand-new account, seed local defaults" apart from "server has data".
  save_data JSONB,
  settings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (username_lower);

-- Lifetime aggregate counters, one row per user. Written only by the
-- /api/matches handler (incremented by each match's deltas) so there is a
-- single writer and no client-submitted numbers can desync it.
CREATE TABLE IF NOT EXISTS player_stats (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played INT NOT NULL DEFAULT 0,
  kills INT NOT NULL DEFAULT 0,
  headshots INT NOT NULL DEFAULT 0,
  shots_fired INT NOT NULL DEFAULT 0,
  shots_hit INT NOT NULL DEFAULT 0,
  waves_cleared INT NOT NULL DEFAULT 0,
  highest_wave INT NOT NULL DEFAULT 0,
  best_game_kills INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  credits_earned INT NOT NULL DEFAULT 0,
  playtime_sec INT NOT NULL DEFAULT 0,
  -- Kills per weapon class (e.g. {"rifle": 40, "sniper": 3}) — JSONB so new
  -- weapon classes/future breakdowns never require a migration. Drives the
  -- derived "career track" label on the profile.
  career_kills_by_class JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- XP/rank progression. Rank itself is derived from xp at read time (see
-- server/ranks.ts) rather than stored, so re-tuning the rank ladder is a code
-- change, never a schema/data migration.
CREATE TABLE IF NOT EXISTS progression (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Badge catalogue (definitions) + per-user unlocks.
CREATE TABLE IF NOT EXISTS badges (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '★'
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id INT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges (user_id);

-- Generic progress tracker for future challenges/achievements — a
-- (user, challenge_code) row with a progress/target pair, so adding new
-- challenges is a data change (new challenge_code values), not a schema one.
CREATE TABLE IF NOT EXISTS challenge_progress (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_code TEXT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  target INT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, challenge_code)
);

-- One row per completed deployment (run). player_stats aggregates are derived
-- by summing/maxing these, applied incrementally at insert time.
CREATE TABLE IF NOT EXISTS match_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_reached INT NOT NULL,
  kills INT NOT NULL,
  headshots INT NOT NULL,
  shots_fired INT NOT NULL,
  shots_hit INT NOT NULL,
  credits_earned INT NOT NULL,
  duration_sec INT NOT NULL,
  xp_gained INT NOT NULL DEFAULT 0,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_history_user_played ON match_history (user_id, played_at DESC);

-- Precomputed leaderboard rows per category, refreshed after each match save.
-- A cache table (rather than a live aggregate query on every request) keeps
-- GET /api/leaderboard cheap regardless of the read/write ratio; at larger
-- scale this refresh would move to a scheduled job instead of per-write.
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  category TEXT NOT NULL,
  rank INT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  value BIGINT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category, rank)
);

INSERT INTO badges (code, name, description, icon) VALUES
  ('first_blood', 'First Blood', 'Score your first kill.', '🎯'),
  ('century', 'Century', 'Reach 100 lifetime kills.', '💯'),
  ('marksman', 'Marksman', 'Land 100 lifetime headshots.', '🎖'),
  ('sharpshooter', 'Sharpshooter', 'Finish a deployment with 80%+ accuracy (20+ shots fired).', '🔫'),
  ('survivor', 'Survivor', 'Reach Wave 10 in a single deployment.', '🛡'),
  ('deep_strike', 'Deep Strike', 'Reach Wave 20 in a single deployment.', '⭐'),
  ('one_man_army', 'One-Man Army', 'Score 50+ kills in a single deployment.', '🔥'),
  ('veteran', 'Veteran', 'Complete 25 deployments.', '🪖')
ON CONFLICT (code) DO NOTHING;
