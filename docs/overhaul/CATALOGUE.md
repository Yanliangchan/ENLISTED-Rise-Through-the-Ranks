# Approved Asset Catalogue

Every rebuilt asset gets two independent verdicts (ART_DIRECTION.md §12):
**Visual** and **SAF authenticity**: Approved / Revision required /
Rejected, with reasons. Both must be Approved for the asset to ship.
Authenticity verdicts are "text-verified" (REFERENCES.md: no photo access in
this sandbox) unless marked otherwise.

| Asset | Owner | Files | Ref | Visual | Authenticity | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| SAR 21 viewmodel + hands | B (lead) | `src/weapons/models/sar21.ts`, `hands.ts` | R-01, R-03 | Pending in-game review | Pending | `shots/bench/sar21_*` | See review log |

## Review log

### SAR 21 (benchmark weapon)

Pre-production review against R-01: defining features listed (carry-handle
optic, full trigger guard, magazine behind grip, LAD fore-end, translucent
magazine, 805 mm length).

Production review 1 (lookdev side view): silhouette correct and recognisable.
Revisions required and made: polymer grain read as camo blotches (texture
scale), magazine too straight (now curves forward), stray butt rib removed.

Production review 2 (three-quarter + first person): hands wrap the grip and
fore-end correctly; first-person framing failed (optic end-on against the
lens). Revised with a shoulder-ready hold (`hipRest`/`hipRot`). Sleeve camo
stretched on slanted cylinders, fixed with true-scale cylinder UVs. Eyecup
changed to rubber.

Open authenticity items: body colour (olive chosen; black also exists),
exact handle-post shapes, flash-hider slot pattern, sling points: all need a
photo check (REFERENCES.md open items).
