# Audit: UI, HUD, Menus

Read-only audit, 2026-10-20. Line refs are to the tree at commit `4e29122`.
UI is DOM-based (HTML/CSS built in TypeScript).

## Inventory

| Screen | File | V | T | Rec. | Pri |
|---|---|---|---|---|---|
| Combat HUD | HUD.ts | 4 | 4 | Improve: DPR radar, HP number, off-palette greens | P2 |
| Landing page | LandingPage.ts, landing/* | 4 | 3 | Improve: bright-green nav, Enter-anywhere deploys, modals lack Esc | P1 |
| Armoury | Armoury.ts | 3 | 2 | Improve: ~74 hardcoded hex, dead `styleButton` branch (:951-952), selected = affordable look | P1 |
| Pause menu | PauseMenu.ts | 4 | 3 | Improve: slider values, native `confirm()` | P3 |
| Game over | GameOverScreen.ts | 4 | 4 | Retain | P3 |
| Account/login | AccountScreen.ts | 2 | 3 | Reskin (off-system) | P1 |
| Wave select | WaveSelect.ts | 2 | 3 | Reskin | P2 |
| Profile | ProfilePage.ts | 2 | 2 | Rebuild ("REDACTED" placeholder avatar, greys) | P1 |
| Leaderboard | LeaderboardPage.ts | 2 | 2 | Rebuild (duplicated constants, close button ×3) | P1 |
| Multiplayer menu | MultiplayerMenu.ts | 2 | 3 | Reskin (own bright-green/blue sheet, min-width 420) | P1 |
| Scope overlay | ScopeOverlay.ts | 4 | 3 | Retain | P3 |
| Strike targeting | StrikeTargeting.ts | 4 | 4 | Retain | — |
| Strongpoint HUD | StrongpointHUD.ts | 4 | 3 | Improve: overlaps kill feed top-left | P2 |
| Tactical map | TacticalMap.ts | 4 | 3 | Improve: resize/DPR | P3 |
| Training range UI | TrainingRangeUI.ts | 2 | 3 | Reskin | P2 |
| Command wheel | CommandWheel.ts | 3 | 3 | Improve | P3 |
| Damage numbers | DamageNumbers.ts | 3 | 3 | Fix render-px vs CSS-px | P2 |
| BOTTY marker | BottyMarker.ts | 2 | 2 | **Broken markup** (nested quotes, :25) | P1 |
| Controls overlay | ControlsOverlay.ts | 3 | 2 | Improve | P3 |
| Guardian (admin) | GuardianPage.ts | 2 | 3 | Retain (internal) | P4 |
| Citadel exit button | main.ts:611-621 | 1 | 2 | Remove/rebuild | P2 |

## Design system

Tokens in `saf.ts:201-226` (aliased as `THEME` in `theme.ts`):
backgrounds `#0b0f0a #111710 #161d14 #1c2519 #0e130c`; lines `#2f3a28 #465237`;
text `#d5ddc8 #8f9a80 #67725c`; accents olive `#5b6b3f`, green `#4a6135`, sage
`#9aa882`, tan `#a8996d`, brown `#6b5b3e`, amber `#c9a227`, red `#a83828`.
Classes `.mil-*` in `theme.ts:40-153`. No spacing/size/z-index tokens, no
`:focus-visible` styles.

**Critical: Roboto Condensed is never loaded** (no `<link>`/`@font-face`), and
`index.html` sets body to Consolas.

Screens hardcoding their own styles: AccountScreen, WaveSelect, ProfilePage,
LeaderboardPage, GuardianPage, MultiplayerMenu, TrainingRangeUI,
DamageNumbers, BottyMarker, profileShared `statTile`, main.ts citadel button.
At least six separate button systems. Off-brief bright greens in landing nav,
MP menu, range UI, account title, Armoury "equipped", HUD.

## Player-visible placeholder / WIP text

- main.ts:624 "map exploration (matches coming soon)" + inline exit button
  (debug path only).
- ProfilePage.ts:131-138 "REDACTED" avatar placeholder.
- LandingPage.ts:420 QUIT/"CLOSE TAB" that does nothing in normal tabs.
- HudDecor fake telemetry and real unit designations ("3 SIR", "HQ 7 SIB").
- index.html title "Operation Sentinel Shield" (brand is ENLISTED).
- Native `confirm()` dialogs; emoji used as icons (☠, 🔒, badges).
- PROFILE/LEADERBOARDS do nothing offline with no message.

## Responsiveness

Fixed px everywhere (radar 140 px not DPR-scaled, wheel 326 px, MP panel
min-width 420). At 1280×720 the landing hero overflows (~900 px) and overlaps
the comms panel/ticker; Strongpoint panel overlaps kill feed. Ultrawide: HUD
pinned to extreme corners. Narrow: grids don't collapse. DamageNumbers and
BottyMarker mis-position under hardware scaling 1.28.

## Contracts to preserve

HUD per-frame API: `update(...)`, `updateUAV`, `setSupportLine`,
`setBigCountdown`, `updateMedkit`, `updateBotty`; events `notifyHit`,
`notifyPlayerHurt`, `notifyShotFired`, `notifyKill`, `notifyDamageFrom`,
`flashWhite`, `showCenterMessage`, `setVisible`, `setWavePanelSuppressed`.
Keep the `__hudCache` write-caching and throttles. `DAMAGE_FEEDBACK_Z=20` above
ScopeOverlay z 12. `visible` flags read by pause/input gates;
`strongpointHud.resultVisible` relies on `display === "flex"`. Landing
callbacks and `onDeploy` inside the click gesture (pointer lock). See the full
callback table in the original agent report summarised here; IDs
`#renderCanvas`, `#ui-root`, style IDs `mil-theme`, `lp-styles`, `mp-styles`.

Bugs to fix (not preserve): Enter-anywhere deploy (LandingPage.ts:544);
modals lack Esc; Armoury dead branch; MP `onViewProfile` opens under z60.

## Accessibility

textFaint on panel 3.4:1 used for 9-10 px labels (fails AA); red on panel
2.7:1; heavy 9-11 px uppercase text; colour-only signals (affordability, radar
hues, ready dot); no focus styles; no reduced-flash option in game.
