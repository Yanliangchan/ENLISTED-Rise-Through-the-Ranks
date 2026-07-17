-- Persistent SAF career-path selection, chosen once a player reaches Corporal
-- First Class (see server/ranks.ts). NULL until chosen; caps rank progression
-- at CFC until set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS career_path TEXT;

-- Guardian permission flag: hidden dev/mod/tester tooling, granted out-of-band
-- (see POST /api/guardian/grant, gated by GUARDIAN_CODE) — never
-- self-service. Client renders the Guardian tab only when this is true.
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian BOOLEAN NOT NULL DEFAULT FALSE;

-- Richer badge metadata for the expanded catalogue below.
ALTER TABLE badges ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'combat';
ALTER TABLE badges ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common';

-- Backfill category/rarity on the original 8 badges seeded by 0001_init.
UPDATE badges SET category = 'combat', rarity = 'common' WHERE code = 'first_blood';
UPDATE badges SET category = 'progression', rarity = 'uncommon' WHERE code = 'century';
UPDATE badges SET category = 'combat', rarity = 'uncommon' WHERE code = 'marksman';
UPDATE badges SET category = 'combat', rarity = 'rare' WHERE code = 'sharpshooter';
UPDATE badges SET category = 'combat', rarity = 'common' WHERE code = 'survivor';
UPDATE badges SET category = 'combat', rarity = 'rare' WHERE code = 'deep_strike';
UPDATE badges SET category = 'combat', rarity = 'rare' WHERE code = 'one_man_army';
UPDATE badges SET category = 'progression', rarity = 'epic' WHERE code = 'veteran';

-- Expanded badge catalogue (Combat / Support / Progression / Special), per the
-- gameplay-improvements spec. Not every badge has an automatic unlock check
-- yet (see server/badges.ts BADGE_CHECKS) — several Support and Special
-- badges require data the client doesn't submit yet (killstreak windows,
-- resupply/revive counts) or are manually granted (Guardian, Alpha Tester,
-- Founder, Event Winner). Seeding them now means the catalogue, icons and
-- Guardian-tab manual-grant tooling can reference a stable `code` immediately;
-- automatic checks can be filled in behind BADGE_CHECKS without another
-- migration.
INSERT INTO badges (code, name, description, icon, category, rarity) VALUES
  -- Combat
  ('double_kill', 'Double Kill', 'Take down 2 enemies within a few seconds of each other.', '🎯', 'combat', 'common'),
  ('triple_kill', 'Triple Kill', 'Take down 3 enemies within a few seconds of each other.', '🎯', 'combat', 'uncommon'),
  ('quad_kill', 'Quad Kill', 'Take down 4 enemies within a few seconds of each other.', '🎯', 'combat', 'rare'),
  ('killstreak_5', 'Killstreak: 5', 'Get 5 kills in a single life without dying.', '🔥', 'combat', 'common'),
  ('killstreak_10', 'Killstreak: 10', 'Get 10 kills in a single life without dying.', '🔥', 'combat', 'uncommon'),
  ('killstreak_25', 'Killstreak: 25', 'Get 25 kills in a single life without dying.', '🔥', 'combat', 'epic'),
  ('headhunter', 'Headhunter', 'Land 500 lifetime headshots.', '🎖', 'combat', 'rare'),
  ('untouchable', 'Untouchable', 'Finish a deployment without taking damage.', '🛡', 'combat', 'rare'),
  ('last_man_standing', 'Last Man Standing', 'Win a deployment with BOTTY down and no reinforcements.', '🪖', 'combat', 'epic'),
  -- Support
  ('medic', 'Medic', 'Heal yourself or an ally 25 times.', '⛑', 'support', 'common'),
  ('resupplier', 'Resupplier', 'Resupply BOTTY or an ally 25 times.', '📦', 'support', 'common'),
  ('engineer', 'Engineer', 'Repair or reinforce cover 15 times.', '🔧', 'support', 'uncommon'),
  ('defender', 'Defender', 'Hold a position across 10 full waves without falling back.', '🏰', 'support', 'uncommon'),
  ('guardian_badge', 'Guardian', 'Serve as a Guardian: moderate, assist and keep the operation running smoothly.', '⚖', 'support', 'epic'),
  -- Progression
  ('kills_500', '500 Kills', 'Reach 500 lifetime kills.', '💯', 'progression', 'uncommon'),
  ('kills_1000', '1,000 Kills', 'Reach 1,000 lifetime kills.', '💯', 'progression', 'rare'),
  ('kills_5000', '5,000 Kills', 'Reach 5,000 lifetime kills.', '💯', 'progression', 'epic'),
  ('kills_10000', '10,000 Kills', 'Reach 10,000 lifetime kills.', '💯', 'progression', 'legendary'),
  -- Special
  ('airborne_tab', 'Airborne Tab', 'Complete Airborne qualification.', '🪂', 'special', 'epic'),
  ('ranger_tab', 'Ranger Tab', 'Complete Ranger qualification.', '🎖', 'special', 'epic'),
  ('guards_tab', 'Guards Tab', 'Complete Guards qualification.', '🎖', 'special', 'epic'),
  ('commando_recognition', 'Commando Recognition', 'Earn Commando recognition.', '🗡', 'special', 'legendary'),
  ('master_marksman', 'Master Marksman', 'Earn the Master Marksman award.', '🏅', 'special', 'legendary'),
  ('event_veteran', 'Veteran (Event)', 'Complete a limited-time operation.', '🪖', 'special', 'rare'),
  ('alpha_tester', 'Alpha Tester', 'Helped test the operation before launch.', '🧪', 'special', 'legendary'),
  ('founder', 'Founder', 'Among the first operators to deploy.', '🏛', 'special', 'legendary'),
  ('event_winner', 'Event Winner', 'Won a limited-time competitive event.', '🏆', 'special', 'legendary')
ON CONFLICT (code) DO NOTHING;
