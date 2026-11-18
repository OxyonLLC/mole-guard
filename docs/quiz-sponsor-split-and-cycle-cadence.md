# Quiz: per-sponsor tiles + quarterly→monthly cycle cadence (2026-07-18)

Two independent changes to the quiz system, made together: (1) the single
"Sponsor" tile is now three sponsor-specific tiles, and (2) payout cycles can
be switched from 91-day quarterly to 30-day monthly without losing or
renumbering historical cycle data. See `docs/quiz-web-expansion.md` for the
quiz system's baseline architecture — this document only covers what changed
on top of it.

## 1. Sponsor tile split (XYO / WinLEW / 2BRZ)

**Why**: one combined "Sponsor" tile mixed XYO and WinLEW questions in the
same pool, so a player couldn't choose which sponsor's questions to answer.
Splitting lets players pick a sponsor deliberately.

**What changed**:
- `src/public/quiz/index.html` — the sponsor tile is now a `.sponsorTileGroup`
  containing three sub-tiles: **XYO**, **WinLEW**, and **2BRZ** (disabled,
  labeled "🔜 Coming soon" — 2BRZ has no question pool yet, see below).
- `src/public/quiz/js/app.js` — `startQuestion(level, sponsor)` now takes an
  optional sponsor key; tile clicks pass `data-sponsor` through; all display
  text uses `questionDisplayLabel()` so a sponsor round shows "XYO" or
  "WinLEW", not the generic "Sponsor".
- `src/mole/web.js`'s `POST /api/quiz/play/next` accepts an optional
  `sponsor` field in the request body and filters the sponsor question pool
  to that sponsor (`quizSponsor.normalizeSponsorKey()`). Omitting it keeps
  the old behavior (any sponsor question).
- Answers are recorded into **both** the existing combined `sponsor` tier
  bucket and a new per-sponsor bucket (`sponsor-xyo` / `sponsor-winlew`) via
  `db.recordTierAnswer()`, so old aggregate stats keep working and the UI
  gets per-sponsor accuracy for free.
- `src/quiz/platform-stats.js`'s `TIERS` grew from 4 entries to 6:
  `easy, medium, hard, sponsor, sponsor-xyo, sponsor-winlew`.

**2BRZ is UI-only right now** — there is no `2brz` entry in
`src/quiz/sponsor.js`'s `SPONSOR_POOLS`, so the tile is rendered `disabled`
with a "Coming soon" label rather than wired to a real (and therefore empty
or fabricated) question pool. When a real 2BRZ question set exists, add a
`2brz` pool to `SPONSOR_POOLS`, add a fourth sub-tile matching the XYO/WinLEW
ones, and add `sponsor-2brz` to `TIERS`.

**Payouts are unaffected.** `addSponsorPoints()` still credits the same
payout-eligible `points` pool as every other question, regardless of which
sponsor tile was played — the split is purely informational/UX, matching how
`sponsor` vs `easy`/`medium`/`hard` was already payout-neutral.

## 2. Cycle cadence: 91-day quarterly → 30-day monthly

**Why**: quarterly payout cycles meant a 91-day wait to redeem cycle-based
points, which players found discouraging. Monthly cycles pay out roughly 3x
more often.

**The hard constraint**: cycle IDs (`C1`, `C2`, ...) are computed as
`Math.floor((nowMs - epochMs) / lengthMs)` against a single epoch. Changing
`cycleLengthDays` in place, against the *same* epoch and the *same* `C`
prefix, would silently renumber/collide with every already-closed historical
cycle — `C2` under the old 91-day math is not the same time window as `C2`
under new 30-day math. That's unacceptable for a system with real pending
payout records tied to specific cycle IDs.

**The fix — `switchCycleCadence()` in `src/quiz/db.js`**: a one-time,
explicit transition, not an in-place edit of the existing scheme:

1. Closes the current cycle first (reusing the existing `closeCycle()`,
   settling any pending points into redemption records exactly as a normal
   cycle close would).
2. Only then flips `db.meta.cyclePrefix`, `cycleEpochMs`, and
   `cycleLengthDays` to the new scheme, with `cycleEpochMs` reset to the
   switch moment — so the new scheme's `#1` cycle starts fresh, from zero,
   at the moment of the switch.
3. Requires a **new, never-before-used prefix** (1–4 letters, rejects the
   default `C` and anything already recorded in `cycleSchemeHistory`) — this
   is what makes old and new cycle IDs structurally impossible to collide,
   forever, even across multiple future cadence changes.
4. Appends a permanent record to `db.meta.cycleSchemeHistory`: old prefix,
   old length, new prefix, new length, timestamp, and an optional reason
   string. Old `C`-prefixed cycles, their `closedCycles` entries, and every
   redemption record tied to them are **never touched, renamed, or deleted**.

The actual production switch (91 days → 30 days) uses prefix `M` (for
"monthly"), triggered via the Discord slash command below — it has not been
run yet as of this document; `switchCycleCadence()` and its test coverage
exist and are verified, but the live cutover is a separate, deliberate
action for whenever it's decided to pull the trigger.

**Triggering it — `/cycleswitchmonthly [confirm:CONFIRM]`**
(`src/quiz/index.js`, `src/quiz/command-data.cjs`): Manage-Server gated.
Without `confirm:CONFIRM` it just previews what will happen (which cycle
closes) and does nothing. With `confirm:CONFIRM` it calls
`switchCycleCadence({ lengthDays: 30, prefix: 'M', reason: ... })` and
reports the closed cycle, how many pending redemption records were created
for it, and the new active cycle ID. This is a **one-time, irreversible**
action (you can switch cadence again later, but never back to a
previously-used prefix) — treat it like any other production cutover.

## 3. Test-isolation note (2026-07-18)

`test/quiz/db-platform-stats.test.cjs` is the **only** file allowed to
move/restore `src/quiz/data/db.json` (its data path is hardcoded, not
configurable). `switchCycleCadence()`'s integration tests live in that same
file, sharing its one before/after lifecycle, rather than as a separate test
file — a separate file doing its own backup/restore of the same real,
shared path raced this file under `node --test`'s default concurrent
file execution and intermittently corrupted the sequence (proven while
building this feature). See that file's header comment before adding new
`db.js` integration tests.

The same fix pattern was applied to `test/faucet/*`, which shares an
analogous constraint (`src/faucet/claimStore.js`'s data path is also
hardcoded): `test/faucet/claimStore.test.mjs` is now the only file that
touches `src/faucet/data/claims_v3.json`, and the payout-worker tests were
merged into it for the same reason.
