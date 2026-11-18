# Quiz web expansion — Discord vs Web leaderboards

This documents the quiz system as of this change: the pre-existing Discord bot
+ web-play system, and the new platform-attributed leaderboard/comparison
layer added on top of it. **Nothing about how points are earned or paid out
changed.** What's new is purely informational: separate Discord/Web
leaderboards, streaks, accuracy, and a Web-vs-Discord comparison.

## 0. Important context: most of "the web quiz" already existed

Before this change, `src/mole/web.js` + `src/public/quiz/` already implemented
a complete, server-authoritative web quiz: a play UI with a timer, five API
routes (`/api/quiz/cycle`, `/api/quiz/leaderboard`, `/api/quiz/me`,
`/api/quiz/play/next`, `/api/quiz/play/answer`), and solid anti-cheat (session
gated to a real Discord-linked identity, correct answer held server-side only,
30s TTL, one submit per question instance, daily cap, answer-once-per-cycle
dedupe, rate limiting). This change did not rebuild any of that — it only adds
platform attribution on top.

## 1. Existing Discord quiz architecture (unchanged)

- **Bot**: `src/quiz/index.js` — a discord.js client with slash commands
  (`/startquiz`, `/sponsorquiz`, `/leaderboard`, `/cycleboard`, `/mypoints`,
  `/redeem`, admin commands, etc. — see `src/quiz/command-data.cjs`).
- **Questions**: `src/quiz/questions.js` (`EASY`/`MEDIUM`/`HARD`, ~108
  questions) and `src/quiz/sponsor.js` (sponsor pools). Shape:
  `{ q, choices: [4 strings], answerIndex: 0-3, tags?: [] }`.
- **Question selection**: `pickQuestion()` avoids repeating a question seen in
  the last 12 rounds per channel (`src/quiz/recent-history.js`). Choices are
  reshuffled per question (`shuffleQuestion()`).
- **Scoring**: a button click locks in `quiz.answered.set(userId, choice)`.
  When the 15s timer (`QUIZ_TIME_MS`) ends, `endQuestion()` in
  `src/quiz/index.js` awards `db.addPoints(userId, points)` (or
  `db.addSponsorPoints` for sponsor rounds) to everyone who answered
  correctly. Points by difficulty: easy=100, medium=150, hard=225
  (`BASE_POINTS` × a difficulty multiplier). No partial credit, no speed
  bonus. There is no streak system in the *payout* path — that's new here,
  and only tracked informationally (see §3).
- **Storage**: `src/quiz/db.js`, file-backed at `src/quiz/data/db.json`
  (optionally mirrored to MongoDB, collection `quiz_db`, via
  `src/quiz/storage.js`). Per-user record:
  `{ points, redeemed, sponsor, cycles, cycleQuestions, lifetimePoints,
  questionWins, web: { answeredByCycle, daily } }`. `points`/`cycles`/
  `lifetimePoints` are the **payout-eligible pool** — untouched by this
  change.
- **Payouts**: real `$WinLEW` SPL-token transfers happen in
  `src/quiz/payout-worker.js` (separate process, `quizpayouts` service in
  `src/runner.js`), triggered by `/cycleclose` (91-day cycle payout) or
  `/leaderboardpayout` (lifetime-points payout, 500-point floor) or a user's
  own `/redeem`. `WINLEW_PER_POINT` env sets the conversion rate (default 1).

## 2. What already existed on the web side (unchanged)

- `src/public/quiz/index.html` + `js/app.js` + `css/quiz.css` — a page that
  reuses the mole-hub Discord-wallet session (`winlew.verify.session` /
  `winlew.verify.app` in localStorage — same login as `/mole-hub/`). It shows
  the cycle countdown, the (existing, payout-linked) cycle/all-time
  leaderboard, "your standings," and a full play flow.
- **Web play** (`src/mole/web.js:2135-2222`, unchanged except for one new
  line — see §3): `POST /api/quiz/play/next` hands back a shuffled question
  `{q, choices}` from an in-memory `quizInstances` map — **the correct index
  never leaves the server**. `POST /api/quiz/play/answer` validates the
  instance belongs to the caller, hasn't been consumed, isn't expired, checks
  the choice against the server-held index, and (if correct, not already
  answered this cycle, and under the daily cap) calls the *same*
  `quizDb.addPoints()` Discord uses. This is why, before this change, the
  code comment in `db.js` said "web points are identical to Discord points" —
  by original design, web-earned points already feed the same payout pool as
  Discord-earned points.

## 3. What's new: platform-attributed stats

**Design decision**: the payout-eligible pool (`points`/`cycles`/
`lifetimePoints`, and everything `payout-worker.js` reads) stays exactly as
it was — both platforms still earn real, spendable points into one shared
pool, same as before this change. Restructuring that would be a live
economic change to a system that already had real users and real payouts
running through it, which was out of scope. Instead, a **new, additive**
per-platform stats layer was added purely for display:

- `src/quiz/platform-stats.js` — pure functions, no file I/O: applying an
  answer outcome to a stat bucket (`applyAnswerToBucket`), computing
  accuracy, ranking users by platform (`rankUsersByPlatform`), and building
  the Web-vs-Discord aggregate (`buildPlatformComparison`). This is the
  "shared quiz engine" piece — both the Discord bot and the web API call
  into the same logic via `src/quiz/db.js`, so streak/accuracy rules are
  defined exactly once.
- `src/quiz/db.js` additions: `recordPlatformAnswer(userId, platform,
  {correct, points})`, `getUserPlatformStats(userId)`,
  `topUsersByPlatform(platform, limit)`, `getPlatformComparisonStats()`. Each
  user record gained a new `platforms: { discord: {...}, web: {...} }`
  field, lazily added by `ensureUser()` — every existing mutator already
  calls `ensureUser()`, so no migration script was needed.
- Each bucket: `{ points, correct, total, currentStreak, bestStreak,
  lastActiveTs }`. A correct answer increments `correct`/`points`/streak; a
  wrong answer resets `currentStreak` to 0 but still counts toward `total`
  (for accuracy). `bestStreak` only ever grows.
- **Hook points** (the only two places platform tracking was wired in):
  - `src/quiz/index.js`, `endQuestion()` — one new line per answered user,
    right next to the existing `addPoints`/`addSponsorPoints` call:
    `db.recordPlatformAnswer(userId, 'discord', {correct, points})`.
  - `src/mole/web.js`, `/api/quiz/play/answer` — one new line right before
    the response: `quizDb.recordPlatformAnswer(userId, "web", {correct,
    points: awarded})`.

  Neither hook changes any existing line — they're pure additions next to
  the pre-existing scoring calls.

### Historical data — documented limitation

No per-answer platform tag was ever recorded before this change, and web
play already existed and was live, so it's **not possible** to reliably
split any user's existing `points`/`lifetimePoints` into "earned via Discord"
vs "earned via web." Per the instruction to not misattribute uncertain
history, pre-existing totals are **not** backfilled into either new platform
bucket — every user starts both platform leaderboards at zero as of this
deploy. The existing combined `lifetimePoints` (and the real payout ledger)
are completely unaffected and keep their full history.

## 4. API endpoints

Existing (unchanged contract):
- `GET /api/quiz/cycle`
- `GET /api/quiz/leaderboard?scope=cycle|alltime&limit=` — the original,
  payout-linked leaderboard.
- `GET /api/quiz/me?app=` — now also returns a `platformStats` field
  (the session moved to the `X-WinLEW-Session` header on 2026-08-13, register
  #28; `?session=` is still accepted but no longer sent). Additive; old clients that ignore unknown fields are unaffected.
- `POST /api/quiz/play/next` — body `{session}`.
- `POST /api/quiz/play/answer` — body `{session, instanceId, choice}`.

New:
- `GET /api/quiz/leaderboard/platform?platform=web|discord&limit=` — ranked
  by that platform's `points` bucket. 400 if `platform` isn't exactly `web`
  or `discord`. Same display-name masking as the existing leaderboard
  (`quizDisplayName()` — profile display name if set, else `Player ••1234`).
- `GET /api/quiz/compare` — `{ discord: {...}, web: {...}, leader }`
  aggregate totals (participants, totalAnswers, correctAnswers, totalPoints,
  correctRate) across all users. Never returns individual scores.

## 5. Identity model

Web quiz play requires a real session from the existing wallet-login flow
(`POST /api/hub/wallet-login/challenge` + `/api/hub/wallet-login`, shared
with the Gaming Hub) — this resolves to a real Discord user ID via
`getSession()` (`src/mole/sessions.js`), the same identity the Discord bot
uses. There is **no guest/anonymous quiz play** — this is intentional and
unchanged; a wallet must already be linked to a Discord account (via
`/verify` on Discord) to play the web quiz at all. Nothing about the browser
can set its own user ID, score, or platform — every quiz route re-derives
`discordUserId` from the server-side session record, never from request
body/query fields the client controls.

## 6. Anti-cheat (pre-existing, audited — not rebuilt)

Already present before this change, in `src/mole/web.js`'s
`/api/quiz/play/*` routes:
- Session-gated to a verified identity (not a client-supplied ID).
- Correct answer index lives only in an in-memory instance keyed by an
  unguessable, `crypto.randomBytes(12)`-derived instance ID — never sent to
  the browser.
- 30s server-side TTL (`QUIZ_WEB_TIME_LIMIT_SEC`); expired submissions score
  as incorrect regardless of the choice sent.
- One submit per instance (`inst.consumed` flag) — a second request against
  the same instance 400s with `already_answered`.
- Answer-once-per-question-per-cycle (`getWebAnsweredThisCycle`) and a daily
  scored-answer cap (`QUIZ_WEB_DAILY_CAP`, default 20/day UTC), both
  re-checked at award time (not just at question-issue time) to close a
  race-condition window.
- Rate limiting on every quiz route (`simpleRateLimit`).
- Display names sanitized (`escapeHtml()` in `app.js`, masked handles from
  `quizDisplayName()` server-side).

## 7. Reward decision

**Web token rewards are already live and stay enabled.** The instructions
that prompted this change say to default new web rewards to disabled "unless
the repository already contains an approved secure implementation." The
web-play path already met that bar (§6) before this change — it wasn't
something this change turned on. Disabling a live reward path that real
users already depend on would itself be a disruptive, silent economic
change, which the same instructions say to avoid. This determination is
worth a second pair of eyes if there's context not visible from the code —
flag it if you disagree.

The new platform-stat tracking (§3) is purely informational and has **no**
reward/payout logic of its own — it never calls anything in
`payout-worker.js` or touches `redemptions[]`.

## 8. Leaderboard separation

Three distinct leaderboard concepts now exist on `/quiz/`:

1. **Cycle / All-time** (existing, unchanged) — `#leaderboardCard`. This is
   the real, payout-linked leaderboard. Ranked by the shared `points`/
   `lifetimePoints` fields that both platforms have always contributed to.
2. **Web** / **Discord** (new) — `#platformCard`, tabs "Web" / "Discord".
   Informational only. Ranked by each platform's own `points` bucket. A user
   who only ever played Discord will not appear on the Web tab (and vice
   versa) — `rankUsersByPlatform` filters out `total === 0`.
3. **Web vs Discord** (new) — same card, "Web vs Discord" tab. Aggregate
   totals only, never an individual leaderboard; see §4.

Web activity cannot change a Discord-tab ranking and vice versa — they read
from entirely separate `platforms.discord`/`platforms.web` buckets.

## 9. Environment variables

No new required env vars. Existing ones relevant to this feature:
`BASE_POINTS`, `QUIZ_WEB_DAILY_CAP` (default 20), `QUIZ_WEB_TIME_LIMIT_SEC`
(default 30), `QUIZ_WINLEW_PER_POINT` / `WINLEW_PER_POINT` (default 1),
`QUIZ_DB_COLLECTION` (Mongo mirror name, default `quiz_db`), `MONGO_ENABLED`
/ `MONGO_URI`.

## 10. Local development

```bash
npm test                       # runs test/**/*.test.cjs (node's built-in runner)
node --check src/quiz/db.js    # syntax check any file you edit
npm run start:quiz             # Discord bot only
npm run start:all              # everything, via src/runner.js
```

The quiz DB path (`src/quiz/data/db.json`) is hardcoded, not
env-configurable — there is no isolated test database. Tests that need to
call real `db.js` functions back up that file first and restore it in an
`after()` hook (see `test/quiz/db-platform-stats.test.cjs`) — follow that
pattern for any new integration test rather than writing to it directly.

## 11. Admin how-tos

- **Add/edit/disable a question**: edit `src/quiz/questions.js` (regular
  pools) or `src/quiz/sponsor.js` (sponsor pools) directly and redeploy —
  there's no admin UI for this, on Discord or web, and this change didn't
  add one. To "disable" one, delete or comment out its entry. Run
  `node -e "console.log(require('./src/quiz/questions.js').validatePools())"`
  after editing to catch malformed entries before deploying (empty array =
  clean).
- **Review leaderboard records**: `/leaderboard`, `/cycleboard`,
  `/sponsorboard` on Discord, or query `src/quiz/data/db.json` directly (or
  the `quiz_db` Mongo collection if enabled). For the new platform stats,
  each user's `platforms.discord`/`platforms.web` sub-object.
- **Reset/correct an invalid web score**: there is no built-in
  correction command. Manually edit the user's entry in `db.json` (or the
  Mongo document) — back up the file first. For platform stats specifically
  (informational only, no payout risk), editing `platforms.web`/
  `platforms.discord` directly is safe; for `points`/`cycles`/
  `lifetimePoints`, be aware those feed real payouts.
- **Investigate suspicious quiz activity**: `console.log("[quiz-web] answer"
  ...)` in `src/mole/web.js` logs every web answer (`userId, questionId,
  level, correct, expired, awarded`) — check server logs. `redemptions[]` in
  `db.json` is the full payout audit trail.
- **Enable/disable web rewards**: not currently exposed as a toggle. To
  disable, the fastest safe option is short-circuiting
  `/api/quiz/play/next` in `src/mole/web.js` to always return `{done: true,
  reason: 'disabled'}` — this stops new points from being earned via web
  without touching any existing data.

## 12. Known limitations / deferred

- **No historical platform backfill** (§3) — by design, documented, not a
  bug.
- **No admin UI** for question management, leaderboard correction, or a web
  rewards toggle — all of these remain file-edit + redeploy, matching how
  the Discord side already worked before this change.
- **Automated HTTP-level tests were not added to the committed test suite.**
  `startWeb()` in `src/mole/web.js` is a single ~1100-line function that
  registers every route inline and requires a fully valid config (real-shaped
  `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/etc. via zod) just to boot, with no way
  to inject a test port/data-dir — booting it in CI would need either a
  refactor (out of scope: "do not rewrite what already works") or dummy
  secrets in CI config. Instead, this was verified **manually, once**: the
  real server was booted locally with throwaway (non-production) dummy
  credentials, and a full authenticated round-trip was driven against it
  (get question → wrong answer → duplicate-submit rejected → correct answer →
  platform stats/leaderboards/compare endpoint all updated with exactly the
  expected numbers → existing payout-linked leaderboard also updated,
  confirming it's untouched/still-shared as designed). The real dev database
  was backed up before and restored byte-identical after (verified via
  `md5sum`). See the engineering report for the exact commands and output.
  Expired-question behavior was traced by reading the code
  (`src/mole/web.js`'s `const expired = Date.now() > inst.expiresAt`) rather
  than waiting out a real 30s timer live.
- **Minor pre-existing asymmetry** (not introduced by this change, just
  documented): Discord only records an answer for users who click a button;
  the web frontend auto-submits `choice: -1` on timeout, so a web no-response
  counts toward `total`/streak while a Discord no-response doesn't. This
  reflects how each platform's timer already worked.
