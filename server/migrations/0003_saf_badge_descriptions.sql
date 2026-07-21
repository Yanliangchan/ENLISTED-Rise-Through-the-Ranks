-- Replace the placeholder descriptions on the SAF qualification-flavoured
-- "special" badges with accurate real-world references + how they're earned,
-- so the Profile page's Challenge Ops section can show genuine SAF context
-- instead of generic "Complete X qualification." text.
UPDATE badges SET description =
  'Basic Airborne Course (BAC) wings — the SAF''s static-line parachute qualification. Real life: earned by completing static-line jump training at the Airborne School. Worn left chest, above the pocket.'
  WHERE code = 'airborne_tab';

UPDATE badges SET description =
  'SAF Ranger tab — an elite volunteer course in small-unit tactics, survival and combat endurance; one of the toughest schools in the SAF. Real life: earned by passing Ranger selection and the full course. Worn as a shoulder tab, left sleeve.'
  WHERE code = 'ranger_tab';

UPDATE badges SET description =
  'Guards tab — awarded on conversion into a Guards unit, recognised for rapid, aggressive light-infantry doctrine. Real life: earned by completing Guards conversion training. Worn as a shoulder tab, left sleeve.'
  WHERE code = 'guards_tab';

UPDATE badges SET description =
  'Commando maroon beret — SAF Commando Formation, among the most selective units in the SAF. Real life: earned by passing Commando selection and the full commando course. Beret colour denotes the formation.'
  WHERE code = 'commando_recognition';

UPDATE badges SET description =
  'SAF Marksmanship award — top shooting proficiency recognition. Real life: earned through live-fire qualification scoring in the top marksmanship band during range practice.'
  WHERE code = 'master_marksman';
