-- New lifetime counters needed to auto-unlock the skill-progression badges
-- below (per-weapon kills, explosive kills, BOTTY heals, support-ability
-- calls, stealth "recon touch"). All additive, merged the same way
-- career_kills_by_class already is.
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS career_kills_by_weapon JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS explosive_kills INT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS botty_heals INT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS airstrike_calls INT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS uav_calls INT NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS recon_touches INT NOT NULL DEFAULT 0;

-- Skill-progression badges — genuinely earnable from gameplay stats already
-- tracked (or newly tracked above), unlike the manually-granted SAF
-- qualification badges. See server/badges.ts BADGE_CHECKS for the unlock
-- predicates.
INSERT INTO badges (code, name, description, icon, category, rarity) VALUES
  ('combat_skills_basic', 'Combat Skills Badge', 'Land at least 100 kills with every carried weapon (SAR-21, BR18, P30, MP5K, M110, TRG22, FN MAG, Colt IAR) — excludes the MATADOR launcher.', '🎖', 'combat', 'uncommon'),
  ('combat_skills_advanced', 'Advanced Combat Badge', 'Reach 500 lifetime kills.', '🎖', 'combat', 'rare'),
  ('combat_skills_master', 'Master Combat Badge', 'Reach 1,500 lifetime kills, including at least 100 explosive kills (grenade, M203, MATADOR).', '🎖', 'combat', 'epic'),
  ('sniper_basic', 'Sniper Badge (Basic)', 'Land 500 lifetime kills with a sniper-class rifle.', '🎯', 'combat', 'uncommon'),
  ('sniper_advance', 'Sniper Badge (Advance)', 'Land 1,000 lifetime kills with a sniper-class rifle.', '🎯', 'combat', 'rare'),
  ('sniper_master', 'Sniper Badge (Master)', 'Land 2,000 lifetime kills with a sniper-class rifle.', '🎯', 'combat', 'epic'),
  ('recon', 'Recon Badge', 'Get within arm''s reach of an OPFOR soldier without them ever noticing you.', '🕵', 'special', 'rare'),
  ('eod_basic', 'Explosive Ordnance Disposal (Basic)', 'Score 250 lifetime kills with grenades, M203 HE, MATADOR or claymores.', '💣', 'combat', 'uncommon'),
  ('eod_advanced', 'Explosive Ordnance Disposal (Advanced)', 'Score 500 lifetime explosive kills.', '💣', 'combat', 'rare'),
  ('eod_senior', 'Explosive Ordnance Disposal (Senior)', 'Score 1,000 lifetime explosive kills.', '💣', 'combat', 'epic'),
  ('paramedic', 'Paramedic', 'Heal or revive BOTTY 200 times.', '⛑', 'support', 'uncommon'),
  ('adss', 'Air Defence Systems Specialist (ADSS)', 'Call in 200 confirmed air strikes.', '✈', 'support', 'rare'),
  ('aiie', 'Air Imagery Intelligence Expert (AIIE)', 'Call in 300 UAV recon sweeps.', '🛰', 'support', 'rare')
ON CONFLICT (code) DO NOTHING;
