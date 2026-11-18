# Mole Hub: mobile/web parity audit (2026-07-19)

An audit of `src/public/mole-hub/` requested after reports that "the page
jumps down to the game" inconsistently, DigLEW's mobile controls overlapped
the canvas, Root Glide felt impossible to get past round 4, and Pac-Mole's
maze "felt unfair or broken." All four were investigated with live evidence
(a headless-Chromium harness serving `src/public` statically, driving real
clicks/taps at both a 390×844 mobile viewport and a 1440×900 desktop
viewport) rather than guessed from reading code — see the specific numbers
under each fix below.

## 1. Scroll-jump inconsistency after tapping "Go"

**Root cause**: after a game starts, `scrollGameIntoView()`
(`src/public/mole-hub/js/app.js`) scrolls `.play-area` into view so the
player doesn't have to scroll past the view's header manually. DigLEW
already had mobile-only CSS (`.diglew-active-run .sidebar, .rightbar {
display:none }`, injected by `diglew.js`) that hides its sidebar/rightbar
while a run is active, so on mobile its `.play-area` sits almost at the top
of the view. Root Glide, Burrow Blaster, Pac-Mole, and Grub Drop never got
the same treatment, so their full sidebars (title, description, stats,
upgrades, "How it works" text) stayed stacked above `.play-area` on mobile's
single-column layout.

Measured before the fix (`scrollY` after tapping "Go", mobile 390×844):

| Game | scrollY |
|---|---|
| DigLEW | 186 |
| Pac-Mole | 1019 |
| Grub Drop | 1012 |
| Root Glide | 1034 |
| Burrow Blaster | 1199 |

Desktop was already consistent (~145 for every game) since the sidebar sits
*beside*, not above, `.play-area` in the 3-column desktop grid — the bug was
mobile-only.

**Fix**: extended DigLEW's existing pattern to the other four games. Each
game's `renderAll()` now toggles a shared `.hub-active-run` class on its view
element (`views.rootglide` / `views.blaster` / `views.pac` / `views.grubdrop`
`.classList.toggle('hub-active-run', Boolean(state && !state.over))`,
mirroring DigLEW's own `run && !run.over` check), and `styles.css` has one
shared `@media (pointer:coarse), (max-width:860px)` block hiding
`.sidebar`/`.rightbar` for `.view.hub-active-run` (below DigLEW's own
pre-existing `.diglew-active-run` block, which is untouched). DigLEW's own
implementation was left as-is — the fix only added the same behavior to the
other four.

Measured after the fix: **all 5 games land at scrollY=186 on mobile**,
desktop unchanged at 145.

## 2. DigLEW's mobile Road Up / Dash / Road Down buttons covering the canvas

**Root cause**: `.play-area` had no `position` set (defaulted to `static`).
DigLEW's mobile touch controls (`.diglew-touch-controls-v47`, injected by
`diglew.js`) are `position:absolute; bottom:14px`, intended to anchor to the
bottom of `.play-area`. Without `.play-area` being a positioning context,
they anchored to a distant ancestor instead — measured directly overlapping
the canvas (controls at viewport y=586–644, canvas at y=571–814, ~73px of
vertical overlap), and spanning the full viewport width instead of
`.play-area`'s inset bounds.

**Fix**: added `position: relative` to the shared `.play-area` rule in
`styles.css`. Confirmed no other game has any `position:absolute` children
inside `.play-area`, so this only changes DigLEW's behavior. Re-measured
after the fix: controls now sit cleanly below the HUD strip (y=977–1035,
canvas y=571–814, HUD strip y=828–944) — no overlap.

## 3. Root Glide: "can't get past round 4"

**Root cause was not an impossible obstacle.** `getRoundConfig()`'s gap-size
formula has multiple redundant safety floors (`gapMin`, a 150px minimum
visual opening in `getOpenGapBounds()`, clamped jut insets) that prevent a
literally unpassable gap at any round. The real cause: **any collision
anywhere restarted the run at Round 1** (`flap()`/`startOrResume()` both
called `start(1)` on death, unconditionally) with zero persistent progress —
`meta.bestRound` was tracked and displayed as a stat but never used to
resume. Each round is meaningfully longer and faster than the last
(`targetDistance: 320 + progress*120`, so Round 4 requires 680m vs Round 1's
320m, roughly double the sustained mistake-free obstacle count), so reaching
Round 4 required an unbroken, flawless run through 1–3 *every single life* —
and Round 4 is the first round long enough to make that compounding
probability of survival genuinely rare. This is what read as "impossible":
not Round 4 itself, but needing to re-clear 1–3 perfectly before every single
attempt at it.

**Fix**: added `nextUnlockedRound()` (`Math.max(1, (meta.bestRound||0)+1)`)
and pointed all four `start(1)` restart call sites at it instead. This
brings Root Glide in line with Pac-Mole, which already persists progress the
same way (`saveState.unlocked`) — not a new pattern, just applying an
existing, working one. "Reset Progress" still hard-resets `meta.bestRound`
to 0. Verified live: seeding `bestRound:3` in localStorage and tapping
"Start" now begins at Round 4 (`Beacon Run — Round 4`, target 680m) instead
of Round 1; a fresh player with no saved state still starts at Round 1
(no regression).

## 4. Pac-Mole: "maze/level feels unfair or broken"

**Root cause**: `applyPacMazeGrammar()` — a ~200-line function implementing
exactly the rules described in `docs/../PACMOLE_V48_STEP5_MAP_VALIDATOR.md`
(one-tile border enforcement, isolated 1-tile wall islands removed, 3×3 solid
stone chunks broken up, dead ends carved into loops, 2×2 open blobs reduced)
— was fully written but **never called from `makeLevel()`**. Every live
level only ran `ensureReachable()` (patches unreachable cells) and
`fillPacEmptyPaths()` (fills worms/globes, its own lighter grammar pass);
the dedicated fairness/grammar pass was dead code.

Verified this was a real, visible defect, not just a missing safety net:
generating all 20 levels *without* the wiring produced a leftover 3×3+ solid
stone block in 3 of 20 levels (8, 13, 14) — exactly what this pass exists to
eliminate. No level had unreachable worms/powers even without it (the other
two functions' own protections already covered that), but the maze did have
visibly un-cleaned-up "chunky" stone artifacts in ~15% of levels.

**Fix**: `makeLevel()` now calls `applyPacMazeGrammar(temp, num,
playerSpawn)` before `ensureReachable()`. Ordering matters: the grammar
pass's one wall-*adding* step (`removeOpen2x2Blobs`) doesn't independently
re-verify connectivity the way `fillPacEmptyPaths`'s `canBecomeWall` does —
but running it *before* `ensureReachable()` means any cell it accidentally
strands gets carved back open automatically, so full reachability is still
guaranteed by construction, not by hoping the grammar pass never over-walls
anything.

Verified across all 20 levels after the fix, via an independent BFS
reachability check (with the same horizontal wraparound the beetle
pathfinding uses) run against the live generated grid, not just re-reading
the source: **0 unreachable worms, 0 unreachable power globes, 0 isolated
wall singles, 0 leftover 3×3+ stone blocks, in all 20 levels** — including
levels 8, 13, and 14, which previously had the stone-block defect.

## 5. Other findings, not acted on

- `src/public/mole-hub/js/legacy-app.js` and the entire `js/gateway/`
  directory (`init.js`, `catalog-data.js`, `catalog-ui.js`) are not
  referenced from `index.html` or `app.js` — confirmed dead code via a
  repo-wide grep (only referenced from `ROADMAP.md`/a build-manifest doc).
  Left in place; not deleted, since removal wasn't requested.
- Console/network audit across both viewports found exactly one recurring
  issue: a 404 on `/api/rewards/history`, expected in a static-file-only test
  harness with no backend (same class of false positive this repo's own
  `test/nav/site-nav.e2e.test.mjs` already allowlists for the same reason).
  No real console errors found.

## Regression check

- `node --test test/nav/site-nav.e2e.test.mjs` — 57/57 passing (mobile,
  tablet, desktop × 19 pages, including `/mole-hub/`).
- All 5 games launch cleanly on both a mobile and a desktop viewport with
  zero page errors after every change in this document.
