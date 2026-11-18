# Mole Hub: cross-game fairness playtest (2026-07-19)

User's ask: playtest and fine-tune all 5 Gaming Hub games for equality and
fairness, framed explicitly around retention ("a returning user is better
than a lost one") and finding the weakest link in the portfolio. Followed
the same evidence-based approach used for Grub Drop's spawn tuning earlier
the same day: read each game's actual mechanics, and wherever the mechanic
is simulate-able, build a faithful extraction of the real algorithm and run
it hundreds/thousands of times rather than guessing from a few manual plays.

## Summary verdict, most severe first

1. **Root Glide — real bug, fixed.** The only one of the 5 games with a
   pure one-hit-death model. Simulated with a predictive (not perfect,
   not naive) bot across 500 runs/round: survival collapsed 95% (round
   1) → 55% (round 2) → 11% (round 3) → 0.2% (round 4) → 0% (round 5+),
   even for near-optimal play. Root-caused to round length
   (`targetDistance`) growth compounding with zero error tolerance —
   isolating each lever showed `targetDistance` alone accounted for most
   of the cliff (freezing it at round 4's other settings recovered
   0.2%→22.6%). Fixed with two changes, verified together: (a) a 3-heart
   buffer matching DigLEW/Burrow Blaster's sibling design (a hit now
   costs a heart with brief invulnerability instead of ending the run
   outright), (b) halved `targetDistance` growth (+60m/round instead of
   +120m/round). Re-simulated: 100%/100%/91%/41%/7%/0% across rounds
   1-6 — round 4 is now a real, earnable challenge instead of a near-
   guaranteed wall, and round 6+ is a legitimate high-skill ceiling
   rather than the game becoming unplayable three rounds after the
   tutorial.
2. **DigLEW — real bug, fixed.** Two "skill gate" patterns
   (`charge_dash_gate_forced`, `late_round_pressure_gate`) place a rock
   obstacle in the ONLY hazard-free lane, so dashing through it isn't
   optional. Each pattern also spawns a `dash` pickup in that same lane
   specifically to guarantee the player can clear it — but the pickup
   only *reduced* dash cooldown by a fixed amount rather than resetting
   it, so a player who'd dashed shortly before entering the pattern
   could still be on cooldown when they reached the rock, taking an
   unavoidable hit the game's own design explicitly tried to prevent
   (and losing the 0-hits Perfect Road/S-grade bonus through no fault of
   their own). Fixed: the dash pickup now fully resets cooldown to 0.
   Verified programmatically that these are the ONLY 2 of 18 patterns
   where a rock sits in the sole safe lane — every other rock is in an
   optional bonus route with a genuinely hazard-free lane always
   available, so the fix is scoped to exactly the patterns that needed
   it. (DigLEW's stage-persistence was also checked — unlike Root Glide/
   Burrow Blaster's original bug, DigLEW's `currentStage()` is already
   derived from cumulative lifetime checkpoints, not current-run
   progress, so it already resumed correctly on failure — no fix needed
   there.)
3. **Grub Drop — real bug, fixed earlier the same day** (see
   `docs/grub-drop-visual-rebrand.md`'s spawn-mechanic section). Rare/
   epic collectibles only cleared 30-62% of the time under independent
   weighted spawn; fixed by switching to guaranteed adjacent pairs,
   verified at 89-94% clear rates across all types.
4. **Burrow Blaster — no severe bug found.** Already the most defensively
   engineered of the 5 before this pass: hazard/warning spawns are
   position-aware (never spawn on top of the player), conflict-checked
   (no stacked/overlapping threats), have a "low-life mercy" system (at
   ≤2 lives, a chance to just skip spawning a new threat rather than
   pile on), hit invulnerability, shield-charge absorption before lives
   are touched, and every difficulty lever (spawn rate, threat caps,
   speed) scales via `Math.min(...)`-capped linear formulas with no
   cliffs. Boss attacks route through the same safety-checked spawn
   functions as regular hazards, so they inherit the same protections.
   The only real gap here was the save/resume "always restart at round
   1" bug, already fixed earlier this session (`nextUnlockedRound()`,
   same as Root Glide's).
5. **Pac-Mole — no severe bug found.** Enemies use real BFS shortest-path
   chase (no mistakes), but this is counterbalanced structurally: the
   player is faster than every enemy at every level (player move
   interval floors at 0.085s/tile vs. enemies' 0.095s/tile — checked the
   actual formulas, not assumed), the beetle den is always placed away
   from the player's spawn corner, and — critically — a hit resets BOTH
   the player *and every enemy* to their home positions with a 1.15s
   grace period, so a bad moment can never chain into a second hit or
   leave the player freshly-spawned next to a beetle. The maze-grammar
   fix from earlier the same day (dead-end reduction) also structurally
   reduces the "cornered with no escape" risk, since a true dead end is
   the easiest place to get trapped. Not empirically simulated with a
   bot to the same depth as Root Glide/Grub Drop (a faithful bot would
   need to model power-mode timing and the dash/burrow escape mechanic
   to be trustworthy) — this conclusion rests on code-level structural
   evidence, flagged as a lighter-weight review than the other four.

## Why the two real bugs are related

Both Root Glide and DigLEW's bugs share the same shape: a mechanic
(dashing through a rock; surviving without a hit) that the game's own
design clearly intended to be *achievable* — DigLEW literally places a
dash pickup right before the obstacle that needs it — but wasn't
*guaranteed* achievable under real play conditions. In both cases the fix
was to make the guarantee actually hold (full cooldown reset; a forgiveness
buffer sized to survive a full run's worth of gaps) rather than adjusting
a difficulty number and hoping. This mirrors the Grub Drop fix from
earlier the same day: the mechanic's *intent* (rare pulls should be
matchable; skill-gate pickups should be usable; a good run should be able
to survive one mistake) was right — the *implementation* just fell short
of guaranteeing it under real-world timing/randomness.

## Verification

- Root Glide: hearts confirmed live via Playwright — decrements 3→2→1→0
  with correct ~1s invulnerability spacing between hits, game only ends
  at 0 hearts, not on first contact.
- All 5 games re-launched on both a mobile (390×844) and desktop
  (1440×900) viewport after every change in this document: zero page
  errors.
- Full `npm test` suite: passing (see the session's final run).
