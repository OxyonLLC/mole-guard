# Community Events

Date: 2026-07-16
Route: `/events/`, `GET /api/events/status`. Data model: `src/mole/eventsData.js`.

## Why this exists

The original roadmap promised live quiz tournaments, AMAs, trivia-sponsored hackathons, and community events/partnerships. The Sponsors & Partners page (`docs/sponsors-and-partners.md`) documents historical *relationships*, but a relationship record isn't an events calendar — this closes that gap with real infrastructure to announce, manage, and archive real events.

## Inspection — what was searched, what was found

Searched `docs/`, `src/quiz/`, and `src/mole/*.js` for any existing tournament/giveaway/AMA/hackathon/Spaces/community-event content. Found exactly two real, evidenced things, both already present in `src/mole/partnersData.js`:

1. **The Raydium WinLEW/SOL liquidity farm** (March 10 – June 8, 2025) — a real, dated, evidenced 90-day program. Classified as a **verified historical event**.
2. **The 2BRZ partnership announcement** (April 2025) — a real, dated, evidenced public announcement. Classified as a **verified historical event**.

Nothing else qualified. No verified quiz tournament, AMA, community meetup, sponsored trivia session, or hackathon has evidence in this repository or in the supplied project records. **These are not invented here.** No fake events were added to make the calendar look busier — the honest state of `/events/` on launch is two real completed events, an empty "upcoming" section with a clear explanation, and full infrastructure ready for the next real event whenever one happens.

**Update, 2026-07-16:** a second Raydium WinLEW/SOL farm (`raydium-farm-2025-2`, farm ID `3ew3rB5UTgDNxuLNGm1Bvb4krBscBMzJjptvYbA8R8d7`) was found — a 90-day program run back-to-back after the first (2025-06-16 → 2025-09-14, immediately following the first farm's 2025-03-10 → 2025-06-08). Both farms are now `completed` events; the second one's dates and reward figures are independently verified (Raydium API + the owner's own wallet screenshot), not owner-supplied-only like the first. See `docs/sponsors-and-partners.md` §7 for the full reward-total cross-check.

**Update, 2026-07-17:** two real, currently-`upcoming` (not-yet-triggered) giveaways were found, both milestone-conditional rather than date-scheduled:

1. **`leweveryonewin-500-follower-giveaway`** — @LetEveryOneWin's pinned March 29, 2025 announcement: 1,000,000 WinLEW to one random follower once the account hits 500 followers. Checked, not assumed: the account had 66 followers as of 2026-07-17 (independently confirmed via a live fetch of the account's own profile page, which matched the owner's separately-supplied figure exactly) — the milestone has not been reached, so this is correctly `upcoming`, not `completed`.
2. **`winlewtoken-holder-milestone-giveaways`** — @WinLewToken's pinned May 3, 2025 announcement: a giveaway at 100 holders, then another at 500 holders. The token had **75 holders on 2026-08-13**, counted directly on-chain rather than asked for: `getProgramAccounts` over the SPL Token program filtered to the WinLEW mint returns 226 token accounts, of which 151 are empty, leaving 75 — resolving to 75 distinct owner wallets. The balances sum to exactly 950,000,000, matching `getTokenSupply`, which is how we know the enumeration was complete. That count includes the liquidity pool, burn wallet and locked reserves, which are addresses rather than people. (Supersedes the earlier owner-supplied 65 of 2026-07-17, which could not be cross-checked because Solscan 403s automated access.) Neither milestone has been reached.

Both are modeled with `startIso: null` (no scheduled date exists — `classifyEventBucket()` already handles this correctly, bucketing a no-`startIso` record as "upcoming" rather than forcing a fake date onto a milestone-conditional giveaway). Whoever next edits `src/mole/eventsData.js` should update these two records' `status`/`results` once (if) either milestone is actually reached — do not mark either `completed` before that happens, per the same evidence rule every other record here already follows.

## Event model

`src/mole/eventsData.js` exports:

- `EVENT_TYPES`: `quiz-tournament`, `ama`, `community-meetup`, `game-competition`, `giveaway`, `sponsored-trivia`, `hackathon`, `partnership-event`, `announcement`, plus one addition — `liquidity-program`, added because the one real completed program (the Raydium farm) is a staking incentive, not an unconditional giveaway, and mislabeling it would misrepresent how it worked. This is the kind of small, honest extension the spec explicitly allows ("may be extensible, but do not over-engineer it") — one new type, not a redesign.
- `EVENT_STATUSES`: `upcoming`, `live`, `completed`, `cancelled`, `postponed`.
- An event record: `id`, `title`, `type`, `status`, `startIso`/`endIso`/`timezone`, `host`, `partnerId` (nullable — references a `src/mole/partnersData.js` record, never duplicates it), `description`, `eligibility`, `rewards`, `rules`, `participationUrl`, `evidence[]`, `results` (`summary`, `standingsUrl`, `winners`, `payoutStatus`), `quizTournament` (nullable sub-object, see below), `lastUpdatedIso`.

## Status lifecycle / display buckets

The page shows four buckets: Upcoming, Live, Completed, Cancelled/Postponed. `classifyEventBucket(event, nowMs)` (pure, unit-tested) computes the bucket:

- An explicit `cancelled`, `postponed`, or `completed` status always wins — an organizer's own record of what happened is authoritative.
- Otherwise the bucket is derived from `startIso`/`endIso` against the real current time, so an event manually marked `upcoming` doesn't keep showing as upcoming forever after its own end date has quietly passed — it moves to Completed automatically the next time the page loads.
- No `startIso` at all → `upcoming` ("announced but not yet scheduled").

## Creation / publishing process (no CMS, no unauthenticated write path)

Per the sprint's explicit instruction not to build broad admin/CMS tooling or expose unauthenticated event creation, this beta uses the same pattern `burnEvents.js`/`partnersData.js` already established: **a maintainer edits `src/mole/eventsData.js` directly, adds a record, runs `node --test test/mole/eventsData.test.mjs` to confirm it validates, and ships it in a normal commit.** `GET /api/events/status` is read-only. There is no `POST` route, no admin UI, and no unauthenticated write path for events — matching the explicit "prefer validated structured event data in the repository" option over building a CMS that doesn't exist elsewhere in this codebase.

## Quiz tournament integration

`quizTournament` (optional, on any `quiz-tournament`-typed event) is **descriptive metadata about a tournament's rules, not a second scoring engine**: `eligibleLevels`, `scoringRule` (always "reuses standard quiz points"), `leaderboardScope`, `rewardRule`, `participantEligibility`, `resultsStatus`, `payoutStatus`.

**Known limitation, stated plainly**: a true *event-scoped* leaderboard (e.g. "top scorers between March 1–7") isn't buildable from the existing quiz data today — `src/quiz/db.js` tracks aggregate counters (lifetime points, cycle points, per-tier accuracy) but not a per-answer timestamped history, so there's no way to filter "answers between two dates" after the fact without a real schema change to the quiz database. Building that schema change wasn't undertaken this sprint (it's exactly the kind of "major new scheduler/reward engine" the spec says to avoid forcing in for a beta). A real tournament today would need to either (a) align with an existing quiz cycle and reference the cycle's own leaderboard as its results, or (b) have an admin manually attest results using external observation (e.g. screen-recorded standings at a cutoff time) until per-answer history exists. No tournament has run yet, so this limitation is documented, not worked around with a fabricated example.

## Rewards

Any event's `rewards` field is a plain-text description read by a human — it never triggers a payout by itself. If a real tournament ever needs to actually pay WinLEW, it uses the *existing* redemption/payout infrastructure (`docs/web-quiz-redemption.md`, `docs/burn-program.md`'s neighboring payout-worker pattern) — this feature does not add a second reward-disbursement path.

## Privacy

`results.winners` is free text (a summary), not a raw list of Discord IDs/wallets — same display-name/public-profile privacy rules the rest of the platform already follows (see `docs/unified-dashboard.md`'s owner/public boundary). No seeded event currently lists individual winners (the two real events are program-level, not individual-winner events).

## Partner references (cross-linking, no duplication)

- An event may set `partnerId` to reference a `src/mole/partnersData.js` record (the 2BRZ event does this) — `GET /api/events/status` never duplicates the partner's own fields, only the event's own data.
- `GET /api/partners/status` (`src/mole/web.js`) now includes a computed, read-only `relatedEvents` array per partner (id/title/status only) via `getEventsForPartner()`, so the Partners page can link into `/events/` without a second data source or any editorial duplication.
- Referencing the 2BRZ event does **not** change the 2BRZ partner record's own `status` (`status-unconfirmed`) — an event happening doesn't retroactively make a partnership "active."

## Historical evidence rules

Same standard as `docs/sponsors-and-partners.md`'s partner-evidence rule: a `completed` event must carry at least one public evidence link (enforced in code — `validateEventRecord` rejects a `completed` event with zero evidence, mirroring `validatePartnerRecord`'s active-requires-evidence rule). `upcoming`/`live` events don't require evidence yet (there's nothing to prove until it happens).

## Cancellation / postponement handling

Set `status` to `cancelled` or `postponed` on the record — both display in one combined "Cancelled / Postponed" section on the page (matching the spec's own page-section grouping) rather than being silently removed, so a cancelled event's history isn't erased.

## Known limitations

1. No verified quiz tournament, AMA, or hackathon has run yet — the upcoming/live sections are honestly empty, not padded with placeholders.
2. Event-scoped quiz leaderboards aren't derivable from the current quiz database schema (see "Quiz tournament integration" above).
3. No admin UI/CMS — publishing is a direct code edit + test + commit, consistent with how burn/partners data already works in this codebase.
4. No notification/reminder system (e.g. emailing users about an upcoming event) — out of scope for this beta.

## Navigation / Whitepaper / Roadmap

`/events/` was added to the standard site nav (after Partners) on the same 17 pages Burn/Partners were added to previously, plus itself and Partners cross-linking. It was **not** added as a new roadmap module card on `/#roadmap`/`modules/index.html` — per the explicit instruction not to invent a new roadmap module merely to advertise a page; this sits alongside the phase structure as historical-transparency/participation-completeness work, the same category Burn/Partners already occupy.
