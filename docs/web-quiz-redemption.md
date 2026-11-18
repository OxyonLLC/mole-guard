# Web Quiz Point Redemption

Date: 2026-07-16
Route: `POST /api/quiz/redeem` (session-authenticated), UI at `/quiz/` ("Redeem points" card), cross-linked from `/verify/profile.html` ("💸 Redeem Points").

Closes the one confirmed gap from `docs/discord-to-web-migration.md`'s original audit: converting earned quiz points into WinLEW previously required Discord's `/redeem` slash command. A signed-in web user can now do the same thing from winlew.co.

## Canonical source of truth

There is exactly one redemption service: `redeemQuizPoints({ userId, amount, source })` in `src/quiz/redemption.js`. Both Discord's `/redeem` command handler (`src/quiz/index.js`) and the web route (`src/mole/web.js`) call it — neither duplicates eligibility, validation, or record-creation logic. It in turn calls the same `db.redeemPoints(userId, amount, requestSource)` (`src/quiz/db.js`) that has always backed Discord's `/redeem`, so:

- **Balance**: one field, `db.users[userId].points` — the same balance both Discord and web spend from.
- **Records**: one `redemptions` array, one `kind: 'user_redeem'` shape. A new `requestSource` field (`'discord'` or `'web'`, `null` for pre-existing records) was added so a redemption's origin is visible in history, without changing anything that eligibility/settlement logic reads.
- **Settlement**: unchanged. `src/quiz/payout-worker.js` — a separate process — is still the *only* code that ever executes a real WinLEW transfer (`sendWinlew()`, using the payout keypair). The web route never touches that keypair, never imports `@solana/web3.js`'s signing path, and cannot trigger an on-chain transaction directly. It only ever creates a `status: 'pending'` record; the worker (or an admin via `/markredeempaid`) settles it later exactly as it already did for Discord-originated redemptions.

## Discord/web parity

Identity: the web route uses `getSession(session).discordUserId` — the exact same identity field `/api/quiz/play/answer` and `/api/quiz/me` already key all quiz activity to (real Discord ID for OAuth-linked users, or a synthetic wallet-derived ID for wallet-only logins — quiz points already treat both uniformly; this is not new to redemption). No web request ever supplies its own user/wallet identity — that would let one session redeem on behalf of another user.

## Eligibility rules (reused, not reinvented)

- Amount must be a positive whole number of points (`Number.isInteger`, `> 0`). At the time this doc was written that was the only validation Discord's `/redeem` had ever enforced. **Update 2026-07-30:** a redemption floor now exists — `QUIZ_MIN_REDEMPTION_WINLEW` (default 1500, matched to the faucet's `DRIP_AMOUNT`) — enforced identically on both surfaces inside the shared `redeemQuizPoints()` service (structured code `below_minimum`) and again as a backstop in `db.redeemPoints()`. Cycle close carries below-floor balances into the open cycle instead of settling dust.
- `amount <= db.users[userId].points` (the user's current unpaid/redeemable point balance), enforced inside the same file-locked (`acquireLock`/`mutateDb`) mutation Discord uses.
- No cooldown exists on `/redeem` today, so none was added for web parity.
- No wallet is required *to request* a redemption (matches Discord — the worker resolves a wallet later, at settlement time). The UI does show a live preview of the wallet the worker would use (`quizWallets.getLinkedWallet(userId, 'payout')`, read-only) and a clear "no linked wallet yet" state, so a user isn't surprised when settlement stalls.

## Conversion rules

`estimatedWinlew = amount * db.getPayoutRate()` (env `QUIZ_WINLEW_PER_POINT`/`WINLEW_PER_POINT`, default 1) — identical formula and identical rate Discord has always used and displayed.

## Payout lifecycle (unchanged)

1. `pending` — created by either `/redeem` (Discord) or `POST /api/quiz/redeem` (web). Points already deducted from the balance at this step (matches Discord's pre-existing semantics: the balance moves at request time, not at settlement time).
2. Settlement worker (`src/quiz/payout-worker.js`, `QUIZ_AUTO_PAYOUT_REDEEMS=true` to auto-settle; disabled by default) or an admin via `/markredeempaid` executes the real transfer and marks `status: 'paid'`, `tx: <signature>`.
3. On repeated failure the worker marks `status: 'failed'` after `maxAttempts`; `/requeueredeem` (admin) reopens it.
4. `/rejectredeem` (admin) can reject a pending/failed record, refunding points to the user.

None of this changed. The web route only ever *creates* step 1's record — it has no code path that reaches steps 2–4.

## Reservation / idempotency

Each successful call creates exactly one new redemption record (matches Discord — there was never a "one pending redemption per user" lock in this system, on either surface). Cross-surface safety comes from the *balance check*, not a lock on the redemption action itself: `db.redeemPoints()` runs inside `mutateDb()`, which is serialized by `db.json`'s own file lock (`acquireLock`/`releaseLock`, the same mechanism every other quiz-db write already uses). Two requests — one from Discord, one from web, or two from web — racing for the same balance are resolved by that lock: whichever wins the file lock first spends the points; the second sees the reduced balance and fails with `"Not enough points."` if there isn't enough left. This is tested directly in `test/quiz/redemption.test.cjs` (`simultaneous web + Discord requests racing for the same balance: exactly one wins`).

## Failure recovery

- Insufficient points / invalid amount / invalid source → `400` with a specific error message, no record created, no balance touched.
- No session / expired session → `401 session_expired` — identical to every other authenticated route on this site (`/api/quiz/me`, `/api/quiz/play/*`, `/api/profile/me`).
- Unexpected server error → `500`, no partial state (the mutation is all-or-nothing inside the file lock).
- A redemption that fails at *settlement* (missing wallet, RPC error) is unaffected by which surface created it — the worker's retry/backoff logic already treats every `user_redeem` record identically regardless of origin.

## Authentication & security boundary

- Session-only: `getSession(String(req.body?.session || ""))`, exactly the pattern `/api/quiz/play/next`, `/api/quiz/play/answer`, and `/api/profile/me` already use.
- No wallet or user id is ever accepted from the request body — only `amount`.
- Unreachable from public-profile mode: `/api/profile/public` and `/api/profile/by-wallet` (the no-session, view-only routes) have no relationship to this route at all; there is no code path from either into `redeemQuizPoints()`.
- Rate-limited (`simpleRateLimit`, 8 requests / 15s) like every other mutating route on this site.
- The response body is checked (in tests) to never contain any private key / secret key / seed phrase / bot token field — there is none to leak, since this route never touches the payout keypair.
- **No token burn, no transaction signing, and no private key handling exists anywhere in this route or the shared service it calls.** The only file in this codebase that ever signs a WinLEW transfer for quiz redemptions is `src/quiz/payout-worker.js`, unchanged by this work.

## UI

`/quiz/`'s "Redeem points" card (visible once signed in) shows: redeemable points, conversion rate, a live linked-wallet preview, an amount input with a live WinLEW estimate, an explicit confirm step (no action is taken on the first click — a second, separate "Confirm redemption" button is required), a submitting state, and a history table of past redemptions (date, points, estimated WinLEW, status, source, tx link when settled). `/verify/profile.html`'s Quick Actions gained a "💸 Redeem Points" link into the same card. No second/standalone redemption app was built.

## Testing

`test/quiz/redemption.test.cjs` (16 tests, integration against the real `src/quiz/db.js` with backup/restore, following the same pattern as `test/quiz/db-platform-stats.test.cjs`): missing user, invalid source, insufficient points, zero/negative/non-integer amount, a never-played user, exact-minimum success, successful web and Discord-sourced redemptions, duplicate submissions (both the legitimate two-redemptions-covering-the-full-balance case and the over-balance-rejected case), the simultaneous web+Discord race, lifetime-points isolation, no-secrets-in-response, and a missing-linked-wallet preview.

In addition, a full authenticated live-server walkthrough was run against the actual running Express app (real wallet-signature login via `tweetnacl`, real session, real seeded points, real HTTP calls to `/api/quiz/me` and `/api/quiz/redeem`, real Playwright screenshots of the form/confirm/success states at a 420px mobile-ish width) to verify the entire flow end-to-end, not just the underlying function. All synthetic test data (wallet, session, profile, redemption record) was removed afterward; `git status` on every touched data directory returned clean.

## Known limitations

- ~~No minimum redemption amount exists~~ **Superseded 2026-07-30**: that product decision was made — see `QUIZ_MIN_REDEMPTION_WINLEW` above. The floor applies equally to Discord and web, so the two surfaces remain in exact parity.
- No cooldown exists between redemption requests (matches Discord).
- Settlement itself (the actual WinLEW transfer) is disabled by default in this repository's configuration (`QUIZ_AUTO_PAYOUT_REDEEMS` defaults to `false`) — pending redemptions wait for either that flag or manual `/markredeempaid` admin action, identical to Discord's existing behavior. This sprint does not change that configuration.
- A pre-existing (not introduced by this work) interaction between manual `/redeem` and cycle-close payouts is documented, not fixed: `closeCycle()` creates a `cycle_payout` record for a user's *entire* cycle point total regardless of how much of that total was already spent via `/redeem` during the cycle. This exists identically on both Discord and web (since both now share the same `points` balance and the same `closeCycle()`), and predates this sprint — it is out of scope to change payout economics as part of a parity fix.
