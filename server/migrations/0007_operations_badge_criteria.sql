-- The Ranger and Guards tabs are now earned through Operations at Pasir
-- Panjang Terminal (see server/badges.ts BADGE_CHECKS, and the client's
-- PasirPanjang.ts / RANGER_GAUNTLET_WAVES). 0003 gave them accurate real-world
-- context but no in-game unlock criteria, because at the time there was no way
-- to earn them. Append the criteria so the Profile page tells a player exactly
-- what to go and do.
UPDATE badges SET description =
  'SAF Ranger tab — an elite volunteer course in small-unit tactics, survival and combat endurance; one of the toughest schools in the SAF. Real life: earned by passing Ranger selection and the full course. Worn as a shoulder tab, left sleeve. In game: hold Pasir Panjang Terminal through all 18 waves of Operation: Ranger Gauntlet, with no resupply, no armour and no BOTTY.'
  WHERE code = 'ranger_tab';

UPDATE badges SET description =
  'Guards tab — awarded on conversion into a Guards unit, recognised for rapid, aggressive light-infantry doctrine. Real life: earned by completing Guards conversion training. Worn as a shoulder tab, left sleeve. In game: take all four layered objectives of Operation: Strongpoint Assault at Pasir Panjang Terminal — Keppel Distripark, the Pasir Panjang Wharves, the Power Station, and finally Bukit Chandu — inside the mission clock.'
  WHERE code = 'guards_tab';
