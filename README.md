# Operation Sentinel Shield

Single-player, browser-based FPS: a Singapore Armed Forces soldier defends
against a generic OPFOR invasion in a wave-survival shooter with an armoury
shop between waves.

Stack: Babylon.js + TypeScript + Vite. Static-hostable, no backend.

## Status

**Milestone 1** — engine bootstrap: render loop, Pointer Lock mouse-look,
WASD/sprint/crouch/jump movement with gravity and collision, a blockout
level, and a minimal HUD shell (crosshair + health/armour). No weapons,
enemies, or waves yet — those are later phases.

## Data files

`src/data/weapons.ts`, `src/data/attachments.ts`, and `src/data/gamedata.ts`
are the authoritative source for all weapon, attachment, throwable, gear,
enemy, and economy stats. Real-world fields (calibre, magazine size, fire
modes, effective range) are accurate to actual SAF equipment; `damage`,
`recoil`, `spread`, and prices are balanced game values. Game logic should
read from these files, not hardcode numbers.

## Development

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build locally
```

Click the canvas to engage Pointer Lock. WASD to move, Shift to sprint,
Ctrl to crouch, Space to jump, mouse to look.

## Project layout

- `src/core` — engine/render loop, input, (audio/save land here later)
- `src/player` — movement, camera, health/armour
- `src/weapons` — weapon controller, recoil, ADS, reload, projectiles (later phase)
- `src/enemies` — AI FSM, spawner (later phase)
- `src/world` — levels, collision, waves
- `src/ui` — HUD, armoury, menus
- `src/data` — authoritative weapon/attachment/gamedata files
