# Operation Sentinel Shield

Single-player, browser-based FPS: a Singapore Armed Forces soldier defends
against a generic OPFOR invasion in a wave-survival shooter with an armoury
shop between waves.

Stack: Babylon.js + TypeScript + Vite. Static-hostable, no backend.

## Status

Feature-complete first playable pass covering all master-prompt phases:

- **Movement & camera** — Pointer Lock mouse-look, WASD, sprint, crouch, jump, gravity/collision.
- **Shooting core** — hitscan raycasting, per-weapon recoil pattern + recovery, dynamic hip/ADS spread (widens moving/hipfire), damage falloff over range, headshot multiplier, mag/reserve ammo, reload, ADS zoom/FOV — all read from `weapons.ts`.
- **Weapon roster** — every weapon in `weapons.ts` (SAR 21, BR18, P30, M110, TRG-22, FN MAG, MATADOR) with a low-poly viewmodel per class and slot-based switching (1/2/3/4 + mouse wheel).
- **Attachments** — slot system from `attachments.ts` with stat deltas; SAR 21 P-Rail gates its optic/underbarrel slots; suppressors quiet gunshots for AI hearing; bipod cuts recoil/spread when deployed prone/crouched; M203 underbarrel HE secondary fire (`H`).
- **Enemies** — OPFOR grunt/marksman/heavy with an FSM (Idle→Patrol→Alerted→Chase→Attack→Suppressed→Dead), line-of-sight + gunshot-hearing, headshot-tagged hit meshes, credits on kill.
- **Waves & economy** — wave manager scaling enemy count/health per `WAVES`, boss waves, scaling wave-clear bonus, between-wave armoury shop, localStorage save/load.
- **Throwables & launchers** — SFG 87 frag (blast falloff), 4 smoke colours (blocks AI LOS), flashbang (screen whiteout + AI stun), flare, tripflare, plus MATADOR travel-time projectile + blast.
- **Gear** — FAST helmet + No.4 SAF-camo skin, LBV carry bonus, armour plate pool that absorbs damage before health.
- **HUD** — health/armour, ammo, weapon + fitted attachments, throwable count, credits, wave/objective, dynamic-spread crosshair, hitmarkers, damage-direction indicators, kill feed, top-down radar.
- **Polish** — wave-arc story beats (defence → holding → counter-attack → retake) with lighting shifts, procedural WebAudio SFX, pause/settings menu (sensitivity, volume), game-over/redeploy screen.

Art is clean low-poly geometry built in code (recognisable silhouettes per
weapon class); swap in real `.glb` models via GLTFLoader later without
touching game logic.

## Data files

`src/data/weapons.ts`, `src/data/attachments.ts`, and `src/data/gamedata.ts`
are the authoritative source for all weapon, attachment, throwable, gear,
enemy, and economy stats. Real-world fields (calibre, magazine size, fire
modes, effective range) are accurate to actual SAF equipment; `damage`,
`recoil`, `spread`, and prices are balanced game values. Game logic reads
from these files rather than hardcoding numbers.

## Development

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build locally
```

Click the canvas to engage Pointer Lock.

- `WASD` move, `Shift` sprint, `Ctrl` crouch, `Space` jump
- `LMB` fire, `RMB` ADS, `R` reload, `G` throw equipped throwable
- `1`/`2`/`3`/`4` select primary/secondary/special/throwable, mouse wheel cycles
- `H` fire underbarrel M203 (if fitted)
- `Escape` pause/settings

## Project layout

- `src/core` — engine/render loop, input, audio (procedural WebAudio SFX), save/settings
- `src/player` — movement, camera, health/armour, gear stat application
- `src/weapons` — weapon controller, ballistics/attachment deltas, viewmodels, throwables, projectiles, loadout switching
- `src/enemies` — AI FSM, spawner
- `src/world` — level blockout, wave manager
- `src/ui` — HUD, armoury shop, pause menu, game-over screen
- `src/data` — authoritative weapon/attachment/gamedata files

## Hosting

`npm run build` produces a static `/dist` — deploy to Cloudflare Pages,
Netlify, Vercel, or GitHub Pages. No server or database required.
