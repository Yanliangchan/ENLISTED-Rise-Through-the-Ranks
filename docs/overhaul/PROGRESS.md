# FPS Graphics Overhaul — Progress Tracker

This file is the single source of truth for where the overhaul stands.
**Every phase ends by updating this file, committing, and pushing.** A new
session resumes by reading this file first, then the docs it links.

Branch: `claude/game-creation-hbdyq5`

## Phase status

| # | Phase | Status | Deliverable |
|---|---|---|---|
| 1 | Audit | IN PROGRESS | `docs/overhaul/AUDIT.md` |
| 2 | Art direction + benchmarks | not started | `docs/overhaul/ART_DIRECTION.md` |
| 3/4 | Workstream rebuilds | not started | see workstream table |
| 6 | QA | not started | `docs/overhaul/QA.md` |
| 7 | Polish | not started | |
| 8 | Acceptance gate | not started | `docs/overhaul/FINAL_REPORT.md` |

## Resume instructions

1. `npm ci && npm run build`
2. `node scripts/capture.mjs <label>`: headless screenshots + perf numbers
   from fixed camera positions, written to `docs/overhaul/shots/<label>/`.
3. Read the most recent log entry below and continue from "Next".

## Log
