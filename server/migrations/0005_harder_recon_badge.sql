-- Recon badge tightened up (was a near-freebie: any 2m brush past an idle
-- enemy counted). Now requires crouched + stationary + 1.2m + a 1.5s hold,
-- and takes 3 successful touches lifetime instead of 1 — see
-- server/badges.ts BADGE_CHECKS.recon and src/main.ts updateReconTouch().
UPDATE badges SET description =
  'Crouch within true arm''s reach (1.2m) of an OPFOR soldier that hasn''t noticed you, hold still for 1.5 seconds, 3 times lifetime.'
  WHERE code = 'recon';
