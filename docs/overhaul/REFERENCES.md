# SAF Reference Library

Shared reference packs for every SAF-inspired asset (Authenticity Directive,
Rules 1-2). Every agent consults this file before building an asset, and adds
to it.

## Research constraints (read this first)

This sandbox **cannot fetch web pages or images**: DNS resolution fails for
mindef.gov.sg, army.gov.sg and wikipedia.org. Only web *search summaries*
come through. As a result:

- Reference packs below are **textual**: key facts, proportions and features
  with their source URLs. They contain no photographs.
- Every asset approved from these packs is marked **"authenticity: text-verified"**.
  A human with photo access should do a final silhouette check against real
  photographs (see the open items list at the end).
- Where search could not confirm a detail (e.g. exact equipment colours), the
  pack says so, and the asset uses a defensible neutral choice.

Starting references named by the directive (unreachable from this sandbox,
listed for human verification):
- https://www.army.gov.sg/our-forces/formations/infantry/
- https://www.mindef.gov.sg/news-and-events/latest-releases/6jul2012-coi-001/
- https://www.mindef.gov.sg/news-and-events/latest-releases/02dec20_fs/
- https://www.cmpb.gov.sg/docs/default-source/beforenspdf/list-of-items-issued-saf.pdf

---

## R-01 SAR 21 assault rifle (standard variant, integral optic)

Sources: [MINDEF SAR 21 article](https://mindef.gov.sg/army/army-news-and-resources/army-news/sar-21),
[MINDEF NS55 evolution of weapons](https://www.mindef.gov.sg/army/army-news-and-resources/army-news/ns55---evolution-of-weapons-(m-16-and-sar-21-rifles)),
[Small Arms Review](https://smallarmsreview.com/sar-21-singapores-bullpup-assault-rifle/),
[pmulcahy Singaporean assault rifles](https://www.pmulcahy.com/assault_rifles/singapore_assault_rifles.htm),
[Wikipedia SAR 21](https://en.wikipedia.org/wiki/SAR_21) (search summaries only).

| Item | Value | Confidence |
|---|---|---|
| Layout | Bullpup: magazine and action **behind** the pistol grip | Confirmed (MINDEF) |
| Overall length | **805 mm** | Confirmed (MINDEF) |
| Barrel length | 508 mm | Confirmed (MINDEF) |
| Weight | 3.98 kg (MINDEF), ~4 kg | Confirmed |
| Calibre | 5.56×45 mm | Confirmed |
| Optic | **Integral 1.5× scope built into the carrying handle**; backup iron sights on top of the handle tube; 3× version for sharpshooter | Confirmed (multiple) |
| Laser aiming device | Integral LAD, single AA battery, in the fore-end; left-thumb pressure switch | Confirmed |
| Magazine | 30-round, **translucent (see-through) plastic** | Confirmed |
| Body | Polymer receiver halves, steel reinforcement at stress points | Confirmed |
| Cheek plate | Composite cheek plate; barrel-extension vent directs gas away | Confirmed |
| Fire selector | At the butt (rear) | Confirmed (criticism noted) |
| Finish colour | Not confirmed by any search source. Commonly seen in service as dark olive-green polymer; black also exists | **Unverified**: use dark olive-green body with black furniture details; flag for photo check |
| P-Rail / RIS variants | Replace carry handle with a Picatinny top rail, no integral sight | Confirmed |

Defining silhouette (what must survive in first person and at distance):
1. Tall carry-handle optic running along the top of the receiver, the dominant hump.
2. Large one-piece trigger guard that encloses the whole grip hand from the
   pistol grip forward to the fore-end (a "full hand guard"), the most
   recognisable SAR 21 feature from the side.
3. Short overall length with the magazine well behind the grip and a long
   smooth flat-sided butt section.
4. Fore-end with the LAD housing underneath the barrel shroud; short barrel
   protruding with a birdcage flash hider.
5. Translucent magazine.

Game simplifications allowed: merged meshes, bevel approximated with chamfered
profiles, no internal mechanism.

## R-02 BR18 bullpup rifle

Sources: [Wikipedia BR18](https://en.wikipedia.org/wiki/BR18),
[TFB 2018](https://www.thefirearmblog.com/blog/2018/03/05/st-kinetics-updates-bullpup-line-br18-rifle),
[Army Recognition 2018](https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2018/new-st-kinetics-br18-5-56mm-caliber-bullpup-assault-rifle-at-singapore-airshow-2018),
[modernfirearms.net](https://modernfirearms.net/en/assault-rifles/bmcr-br18-2/).

- Bullpup, gas-operated, 5.56×45 mm, ST Engineering (ST Kinetics).
- **Picatinny rails at four positions**; flat full-length top rail; **no
  integral optic** (SAF fits a separate optic).
- Fully ambidextrous; **forward ejection**; side-mounted charging handle.
- Carbon-fibre cheek rest.
- Stated purpose: replace the SAR 21. Formal SAF adoption date not confirmed
  by search.
- Colour: unconfirmed. Use black/dark-grey with a dark olive option.

Defining silhouette: angular modern bullpup, flat rail top (no carry handle),
long railed fore-end, conventional trigger guard (not the SAR 21 full guard).

## R-03 SAF Army No. 4 pixelised combat uniform

Sources: [MINDEF design article](https://www.mindef.gov.sg/news-and-events/latest-releases/6jul2012-coi-001/),
[MINDEF Navy/Air Force No.4 fact sheet](https://www.mindef.gov.sg/news-and-events/latest-releases/2012may17-news-releases-01954/),
[Pioneer: Uniform in pixels](https://www.defencepioneer.sg/pioneer-articles/UNIFORM-IN-PIXELS),
[Camopedia Singapore](http://camopedia.org/index.php/Singapore),
[Mothership 2024](https://mothership.sg/2024/02/sell-saf-uniform-online-us/).

- Introduced 2008 (some sources: 2009). Computer-generated pixelised print.
- **Four colours**: black, foliage green and moss green pixels **on a brown
  base** (Camopedia's description of the standard temperate pattern).
- "Micro-patterns within macro-patterns": small pixels clustered into larger
  rectilinear shapes.
- Army green version optimised for vegetated terrain. Navy and Air Force use
  two greyish-blue recolours (not used in this game).
- Exact RGB values: **not published** in any source found.

Design decision (documented uncertainty): palette tuned to read as the
green-dominant Army pattern under daylight, with a true brown base, two
greens and black. Pixel clusters are crisp and rectilinear (no rounded
blobs). Pixel scale: ~1 cm squares on fabric, clustered into 4-12 cm macro
shapes. The previous in-game generator (`saf.ts`) used five near-black olives
with rounded smoothing; it fails this reference.

## R-04 SAF helmet and load-bearing equipment

Sources: [MINDEF fact sheet Dec 2020](https://www.mindef.gov.sg/news-and-events/latest-releases/02dec20_fs/),
[Pioneer Dec 2020](https://mindef.gov.sg/web/portal/pioneer/article/cover-article-detail/ops-and-training/2020-Q4/02dec20_news1),
[Janes](https://www.janes.com/defence-intelligence-insights/defence-news/singapore-army-unveils-next-generation-personal-equipment),
[Milipol/CNA Sep 2020](https://www.milipolasiapacific.com/?p=2078).

- **Helmet**: since Oct 2019, NSFs receive a **high-cut** helmet (about 10%
  lighter, adjustable padding, cut to fit comms headsets and NVGs). Older
  helmets were a localised PASGT derivative (still used by NSmen).
- **Load-bearing**: integrated Load Bearing Vest (iLBV) from 2009, being
  replaced from 2020 by the Load Bearing System (LBS), Standard and Enhanced
  variants.
- Colours: not confirmed by search. Defensible choice: helmet with a No. 4
  fabric cover (common for SAF); vest and pouches in solid olive-green,
  distinct from the printed uniform.

Coherent equipment set chosen for this game (Rule 4: one generation): **2020
generation**: No. 4 uniform + high-cut helmet with No. 4 cover + LBS-style
plate carrier/vest in solid olive with magazine pouches + SAR 21 (BR18 as the
newer option). This matches the game's "FAST Helmet" and LBV gear items.

## R-05 Other weapons in the roster

| Weapon | Defining features (search-confirmed) | Unverified |
|---|---|---|
| Ultimax 100 | Singapore LMG; **100-round plastic drum** under the receiver; constant-recoil; forward vertical grip; quick-change barrel. Mk 9 can be belt or STANAG fed | drum shape detail, finish |
| MATADOR | 90 mm man-portable disposable anti-armour/anti-structure weapon (Germany/Israel/Singapore) | tube finish (olive assumed), sight unit shape |
| FN MAG | Belt-fed GPMG; gas cylinder under barrel; carry handle on barrel; ladder rear sight | SAF-specific fittings |
| H&K P30, MP5K, FN P90, M110, TRG-22, Colt IAR | Well-documented commercial designs; model from standard manufacturer configurations | SAF service status of each (game roster, not a claim of issue) |

The game presents these as an armoury roster. It does **not** claim each is
current SAF issue; the UI should not label non-SAF-issue weapons as SAF issue.

## R-06 Singapore camp and environment characteristics

Sources: [List of SAF bases](https://en.wikipedia.org/wiki/List_of_Singapore_Armed_Forces_bases),
[Pasir Laba Camp](https://en.wikipedia.org/wiki/Pasir_Laba_Camp),
[Remember Singapore: Woodlands/Kranji](https://remembersingapore.org/woodlands-camp-kranji-army-barracks/).
Specific barrack-block architecture could not be confirmed by search.

Design language used (general Singapore built-environment knowledge,
documented as such, not a replica of any real camp):
- Tropical: dense secondary forest edges, lalang grass, rain trees, palms;
  heavy humidity haze; frequent wet surfaces.
- Concrete low-rise blocks painted in pale cream/off-white with green or
  maroon trims; covered walkways with metal roofs; open-sided staircases;
  monsoon drains (U-channel concrete drains) beside every road; kerbs
  painted black-and-white near guard posts.
- Weathering: dark rain streaks below ledges, algae/moss on north faces and
  drain walls, stained concrete bases.
- Fencing: chain-link with barbed-wire top; guard post at gate with boom
  barrier.
- Pasir Panjang Terminal: PSA container terminal; quay cranes, stacked
  containers, prime movers. Bukit Chandu is a real WWII battle site (1942).

## Open items for human verification (photo access needed)

1. SAR 21 body colour in current service (olive vs black).
2. No. 4 exact colour values against a fabric photo.
3. High-cut helmet: cover pattern and colour.
4. LBS vest colour and pouch layout.
5. MATADOR tube finish and sight unit.
