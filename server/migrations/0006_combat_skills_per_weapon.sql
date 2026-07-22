-- Advanced/Master Combat Badge were checking total lifetime kills, which let
-- players clear them by dumping everything into one favourite gun. Both now
-- require EVERY weapon in the roster to individually clear the bar — see
-- server/badges.ts BADGE_CHECKS.combat_skills_advanced/master. Description
-- text updated to match.
UPDATE badges SET description =
  'Land at least 500 kills with EVERY carried weapon individually (SAR-21, BR18, P30, MP5K, M110, TRG22, FN MAG GPMG, Colt IAR) — not 500 combined. Excludes the MATADOR launcher.'
  WHERE code = 'combat_skills_advanced';

UPDATE badges SET description =
  'Land at least 1,500 kills with EVERY carried weapon individually, plus 100 lifetime explosive kills (grenade, M203, MATADOR). Excludes the MATADOR from the per-weapon requirement — it''s a launcher, not a hitscan kill.'
  WHERE code = 'combat_skills_master';
