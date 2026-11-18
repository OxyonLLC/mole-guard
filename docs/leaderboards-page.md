# Leaderboards page (2026-07-19)

New page: `/leaderboards/`. Ranks players across Quiz, Faucet, and the
Gaming Hub — Web and Discord tabs wherever both exist, "Coming Soon" for
Games' Discord tab (the mini-games don't exist on Discord yet).

## Why "earned + a second signal," not raw score

A pure score leaderboard floods with whoever grinds hardest. Every board
here ranks by **real WinLEW earned/claimed** first, plus one secondary
signal so the board also tells you *how* someone got there:

- **Quiz**: points (informational Web-vs-Discord tracker — unrelated to
  the payout-linked cycle leaderboard already on `/quiz/`), plus accuracy
  and best streak.
- **Faucet**: total confirmed WinLEW claimed, plus claim count.
- **Games**: total WinLEW earned in that game, plus **top level/round**
  reached for progression games (Root Glide, Burrow Blaster, Pac-Mole,
  DigLEW) or **top score** for Grub Drop, which has no level concept — it's
  a session-scored puzzle, not a progression game.

## What already existed vs. what's new

Almost nothing needed to be built from scratch. Every game reward claim
already gets recorded server-side (`src/mole/rewardHistory.js`,
`recordRewardClaim` — called from every game's `postRewardClaim()`) with
`{discordUserId, game, payout, meta}`, where `meta` already carries
`round`/`level` (Root Glide, Burrow Blaster, DigLEW use `meta.round`;
Pac-Mole uses `meta.level`) or `score` (Grub Drop). Quiz already had a
per-platform leaderboard (`/api/quiz/leaderboard/platform`,
`quizDb.topUsersByPlatform`). The only real gaps were: (1) nothing
aggregated reward-history rows *across all users* for one game, and (2)
Faucet had global totals (`getGlobalFaucetStats`) but no per-user ranking.

**New backend**:
- `src/mole/rewardHistory.js` — `getGameLeaderboard({game, limit})` (groups
  all claims for one game by user: sum payout, max round/level, max score)
  and `getGamePopularity()` (claim counts per game across all users — the
  real signal behind "most played," for the hub's future popularity
  ordering). Both dual Mongo-aggregation/file-fallback, matching every
  other function in the file. `getGamePopularity()` explicitly excludes the
  `"migration"` game key — an internal bookkeeping marker used by the
  guest-reconcile route for one-time local-winnings credits, not a real
  game; without the exclusion it polluted the popularity ranking (confirmed
  against live production data before fixing).
- `src/faucet/claimStore.js` — `getFaucetLeaderboard(limit, source)`, an
  optional `source` ('web'/'discord') filter mirroring Quiz's platform
  split. Splitting by source here is safe (it's just "which interface did
  this claim come in through," the same field `getGlobalFaucetStats`
  already buckets by) — unlike splitting by *user identity*, which would be
  wrong since web+Discord share one cooldown/treasury per person.
- `src/mole/web.js` — three new routes: `GET /api/games/leaderboard?game=`,
  `GET /api/games/popularity` (60s-cached, since it scans the whole
  reward-history store), `GET /api/faucet/leaderboard?source=`. All reuse
  the existing `quizDisplayName()` privacy model (profile displayName, or a
  masked `Player ••1234` handle — no raw Discord IDs ever returned).

**New frontend**: `src/public/leaderboards/index.html` + `js/app.js`,
self-contained (own inline CSS, matching `/health/`'s pattern) — 3 sections,
each with Web/Discord tabs (Games selects a game first; its Discord tab is
disabled with a "Coming Soon" message). Added to `src/public/assets/nav.js`
(both `NAV_GROUPS` and a `NAV_PAGE_IDENTITY` entry, 🏆 avatar) and to
`test/nav/site-nav.e2e.test.mjs`'s page list.

## Verification

Unit-level: seeded synthetic reward-history/faucet-claim data (isolated
`DATA_DIR`, file-fallback path) and confirmed `getGameLeaderboard`,
`getGamePopularity`, and `getFaucetLeaderboard(source)` all group, sum, and
sort correctly, including the Grub Drop top-score-instead-of-top-level
case and the web+Discord-combined-per-identity case for Faucet.

Live: briefly started the real `mole` service (already connected to
production Mongo + the real Discord bot before I noticed — read-only GET
requests only, then shut back down) and confirmed all three new endpoints
against real data: Root Glide's leaderboard showed real players ranked
correctly by earnings with real top-level values; Faucet's web leaderboard
showed real claim totals; the popularity endpoint's `"migration"` leak was
caught and fixed against this real data before considering it done.

## Known gap, not yet built

The hub's game catalog (`/mole-hub/`) still orders games by a hardcoded
`featuredOrder` field, not by `/api/games/popularity`'s real play counts —
that was explicitly deferred to build the leaderboard infrastructure first
(user's own call: build the real backend, then hub sorting becomes trivial
on top of it rather than throwaway client-only work). Next step: fetch
`/api/games/popularity` in `mole-hub/js/app.js` and use it to order/badge
the catalog cards instead of (or blended with) `featuredOrder`.
