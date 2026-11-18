# Faucet web expansion — shared Discord + web claim

**This feature transfers real economic value ($WinLEW tokens).** Read this
whole document before changing anything in `src/faucet/`.

## 1. Relationship to the reference implementation

There was no actual `faucet.zip` — the reference implementation is
`src/faucet/`, the pre-existing standalone Discord faucet bot (its own
`package.json`, own Discord client, own `.env`/`bot-keypair.json`). This
work does **not** create a second faucet or a second treasury. It extracts
`src/faucet/`'s proven behavior into a shared service, repairs its unsafe
claim flow, and gives it a second front end.

## 2. Original standalone architecture

- `src/faucet/bot.js` — Discord bot. Commands: `!faucet`/`!drip` (accepts an
  optional direct wallet/domain argument), `!register`/`!save`/`!setwallet`/
  `!linkwallet`, `!mywallet`/`!savedwallet`, `!whoami`/`!me`,
  `!unlinkwallet`/`!forgetwallet`, `!faucetstatus`, `!balance`, `!reverse`,
  `!send` (mod-only).
- `src/faucet/faucet.js` — `dripTokens(connection, payerKeypair,
  recipientPubkey)`, the actual SPL transfer.
- `src/faucet/storage.js` — file-backed JSON with an async whole-document
  Mongo mirror (collection `faucet_claims`, keyed by a single `_id: 'global'`
  document). **Not** a per-claim atomic store.
- Claim state: `src/faucet/faucet_claims.json`, `{version:2, wallets:{addr:
  ms}, users:{id:ms}}` (still tracked in git — timestamps and addresses
  only, no secrets).
- Wallet resolution: `getLinkedWallet()` in `bot.js`, reading
  `wallet_links.json`, `../data/linked_wallets.json`, legacy
  `registrations.json`/`airdrops.json`, intent priority `faucet ↔ payout →
  verified → airdrop`, most-recently-updated wins.

## 3. Current integrated architecture

```
src/faucet/
├── amount.js          pure exact decimal→BigInt base-unit conversion
├── config.js           single source of truth for faucet env config
├── claimStore.js       atomic (user, wallet) reservation + claim ledger
├── eligibility.js       wallet resolution + holder check + cooldown check
├── service.js           claimFaucet() — the ONE entry point both adapters call
├── keypair.js           LAZY treasury keypair load (no import-time side effect)
├── payoutExecutor.js     actual token transfer (bot.js + payout worker only)
├── mintInfo.js           side-effect-free mint-decimals lookup (web-safe)
├── payout-worker.js       poll-and-process logic for WEB claims (no side effects on import)
├── payout-worker-main.js  the real `faucetpayouts` process entry point
├── bot.js                Discord adapter — calls service.js
├── faucet.js              dripTokens(), now using amount.js internally
└── faucet_claims.json     legacy v2 data, read once at boot for migration, never deleted

src/mole/web.js: GET/POST /api/faucet/* — calls service.js
src/public/faucet/: the website, calls the API above
```

Both adapters call `claimFaucet({discordUserId, source, requestId,
requestedWallet})` in `service.js` — neither talks to `claimStore.js`,
`eligibility.js`, or the treasury directly.

## 4. Files adopted vs. not adopted

**Adopted (kept, still authoritative)**: `bot.js`'s command surface and
wording, `faucet_claims.json`'s v2 shape (migrated, not replaced), SNS
resolution (`resolveSolanaName`/`resolveSolanaAddress` in `bot.js`), the
holder-balance summation logic, the design assets.

**Not adopted**: `src/faucet/storage.js`'s whole-document Mongo mirror
pattern (not atomic — a new dedicated `faucet_locks`/`faucet_claims`
Mongo collection pair was built instead). `src/faucet/sns.js` (a second,
unused SNS implementation — `bot.js`'s own inline version is the one
actually wired up; left as dead code, not deleted, out of scope for this
change). The float-based amount conversion in `faucet.js` (fixed in place,
not replaced with a new file, since Discord and web must use the identical
corrected function).

## 5. The shared cooldown invariant

> One eligible Discord-linked identity and its verified faucet wallet may
> receive only one faucet payout during the configured rolling cooldown,
> regardless of whether the claim originates from Discord or the website.

Enforced by `claimStore.reserveClaim()` atomically locking **both** a
`user:<discordUserId>` key and a `wallet:<address>` key to the same claim,
before any token transfer. A claim on either platform blocks the other —
proven in `test/faucet/claimStore.test.mjs` and, live, in the manual
verification log below.

## 6. Rolling cooldown

`FAUCET_COOLDOWN_HOURS` (default 24) × 3600000 = `cooldownMs`. Rolling from
the reservation timestamp, not a calendar/midnight reset — matches the
original bot.js exactly. `getFaucetConfig()` is the one place this is
computed; both `service.js` and `bot.js`'s `!whoami`/`!faucetstatus` read it
from there (via `claimStore.getStatusForUser`/`getStatusForWallet`, which is
seeded by the same config).

## 7. Wallet resolution order

Unchanged from the original, and now literally the same function: `service.js`
resolves the web wallet via `src/quiz/wallets.js`'s `getLinkedWallet(id,
'faucet')` (already read by quiz payouts — this reuses it rather than adding
a third copy). Priority: `wallet_links.json` → `src/data/linked_wallets.json`
→ project-root `data/linked_wallets.json` → legacy `registrations.json` →
legacy `airdrops.json`, most-recently-updated candidate wins, intent
`faucet ↔ payout` fallback preserved.

The website **never** accepts a wallet from the browser — only the
canonical resolved address is ever used for a web claim. Discord's
`!faucet <address-or-domain>` direct-argument compatibility is preserved
(resolved via the existing SNS-aware `resolveSolanaAddress`), and still goes
through the same cooldown/reservation as every other claim.

## 8. Holder-floor behavior

`FAUCET_MIN_HOLDER_BALANCE` (default 1), `DISABLE_FAUCET_HOLDER_CHECK`.
Balance = sum of `uiAmount` across every token account the wallet owns for
`WINLEW_MINT` (unchanged summation logic). Web reads balance via
`src/mole/solana.js`'s `getSplBalance()` (already canonical elsewhere in
this repo); Discord keeps its own existing RPC connection for this specific
read. Both compare against the exact same `FAUCET_MIN_HOLDER_BALANCE`/
`DISABLE_FAUCET_HOLDER_CHECK` values (`config.js` is the single source).
An RPC failure during the holder check returns `holder_check_unavailable`,
**not** a zero balance — fails closed, never silently denies as "you have
0 tokens."

## 9. Exact token-unit conversion

`src/faucet/amount.js`: `DRIP_AMOUNT` is read as a **string**, never coerced
through `Number()` before the base-unit conversion. `parseDecimalAmountToBaseUnits`
does the integer/fraction split and BigInt math entirely in string/BigInt
space — no floating point anywhere in the path. Rejects (rather than
rounds/truncates): scientific notation, negative, zero, more fractional
digits than the mint's decimals, non-numeric input, and (via
`assertSafeDecimalAmount`) a catastrophically large configured amount. This
replaced `faucet.js`'s old `BigInt(Math.round(DRIP_AMOUNT * (10 **
decimals)))` in place — same function signature, same call sites, exact math.

## 10. Claim state machine

`reserved → processing → submitted → confirmed`, with failure branches
`known_failed` (certain — no signature was ever produced, cooldown safely
released) and `reconciling` (uncertain — a timeout/expiry error occurred
around send/confirm; the transaction *may* have landed; cooldown is **not**
released, requires admin investigation — see §17). `administratively_released`
marks a claim an admin has manually resolved. Every claim has a durable
record (`claimStore`) before any transfer is attempted.

## 11. Atomic reservation method

Two backends behind one interface (`src/faucet/claimStore.js`):

- **File mode** (no Mongo): a single JSON file
  (`src/faucet/data/claims_v3.json`) mutated only inside an exclusive-create
  lockfile critical section (`fs.openSync(path, 'wx')`, retry-with-backoff
  on `EEXIST`) — the same pattern already proven in production by
  `src/quiz/db.js`. Verified live with **8 genuinely separate OS processes**
  racing for the same reservation simultaneously: exactly 1 won, 7 correctly
  blocked (see §22). Cross-process safe on one host; **not** safe across
  multiple hosts — see §14.
- **Mongo mode**: a `faucet_locks` collection (unique index on `key`) plus
  `faucet_claims`. Reservation runs both the `user:` and `wallet:` key
  upserts inside one `session.withTransaction()` — if either key already has
  an unexpired lock, the whole transaction aborts, so a partial reservation
  can never be left behind. This project's root `.env` has `MONGO_ENABLED`/
  `MONGO_URI` configured for production Mongo Atlas — meaning **Mongo mode
  is what actually runs in production**, not the file-mode fallback. The
  Mongo path was implemented and code-reviewed following standard
  upsert-if-expired idioms, but could not be live-tested against a
  non-production Mongo instance in this environment — flagged explicitly in
  §24 as implemented-but-not-externally-verified.

## 12. JSON-mode limitations

File-mode locking guarantees mutual exclusion between processes **on the
same host and filesystem**. It provides **no** guarantee across multiple
hosts or multiple filesystem mounts. If you ever run the `mole`, `faucet`,
and `faucetpayouts` processes on different machines without Mongo enabled,
double-claims become possible again. Production should always run with
`MONGO_ENABLED=true` for this reason — do not disable Mongo in production
to "simplify" without understanding this tradeoff.

## 13. Idempotency

Every `reserveClaim()` call accepts an optional `requestId`. A repeat call
with the same `requestId` returns the **existing** claim instead of
reserving again — proven in tests. The web API always sends one (client- or
server-generated); Discord uses the triggering `message.id`. Once a
transaction signature exists on a claim (`markSubmitted`), nothing in this
codebase ever re-sends for that claim — the payout worker only ever acts on
claims in `status: 'reserved'`, and a claim only reaches `reserved` once,
at creation.

## 14. Payout execution

- **Discord**: executed **inline**, in `bot.js`'s own process, immediately
  after reservation — `bot.js` already legitimately holds the treasury
  keypair for its other admin commands (`!send`), so this preserves the
  original immediate "Sent X WinLEW! Tx: ..." reply.
- **Web**: reservation-only in the `mole` process. A **separate** process,
  `faucetpayouts` (`src/faucet/payout-worker-main.js`, new entry in
  `src/runner.js`), polls for `status: 'reserved'` claims with `source:
  'web'` and executes them. The `mole` web process's import graph
  (`eligibility.js` → `claimStore.js`/`config.js`/`mintInfo.js`/
  `../quiz/wallets.js`; `service.js` → the above + a **dynamic** `import()`
  of `payoutExecutor.js` that only ever fires on the `'discord'` branch)
  never loads `src/faucet/faucet.js`, `keypair.js`, or `src/faucet/.env` —
  proven with an automated test (`test/faucet/service.test.mjs`) that boots
  a fresh process with `WINLEW_MINT` unset and confirms the import succeeds
  (if `faucet.js` had been loaded, it throws immediately without that var).
  This is a structural guarantee, not a policy promise: the treasury
  keypair literally cannot enter the process that's reachable from the
  public internet.

## 15. Failure states & reconciliation procedure

`categorizeTransferError()` (`payoutExecutor.js`) checks the error
shape: messages matching timeout/expired/blockhash-not-found/block-height-
exceeded → `reconciling` (uncertain); everything else → `known_failed`
(certain, cooldown auto-released). This is best-effort, not perfect — when a
claim is stuck in `reconciling`:

1. Note the claim's wallet + approximate timestamp from `claimStore`
   (`getClaimById`, or the raw `claims_v3.json`/`faucet_claims`
   collection).
2. Check Solscan (or your RPC) for a transfer from the treasury wallet to
   that recipient around that time — see §18.
3. If found: the transfer succeeded. Manually call
   `markSubmitted(claimId, signature)` then `markConfirmed(claimId)` (a
   one-off script or REPL against `claimStore.js` — there is no admin UI for
   this).
4. If not found after a reasonable window: call
   `releaseReservationAdministratively(claimId, 'confirmed_not_sent')`, which
   frees the user's cooldown so they can try again.

## 16. Web authentication & CSRF/origin controls

Reuses the existing wallet-verified session system exactly (`getSession()`
in `src/mole/sessions.js`, the same `/api/hub/wallet-login` challenge/sign
flow mole-hub and quiz already use). `discordUserId` is **always** derived
from the session record server-side — never from any request field. Origin
protection is whatever already exists repo-wide (`simpleRateLimit` +
CORS allow-list in `web.js`) — there is **no** CSRF token mechanism
anywhere in this codebase yet (pre-existing, not introduced or fixed by
this change); mitigated by requiring a valid signed-wallet session (an
attacker would need to already have stolen a live session token, at which
point CSRF is not the weakest link). Flagged as a pre-existing gap in §25.

## 17. API endpoints

**Session transport changed 2026-08-13 (content-audit register #28).** These
calls now carry the session in an **`X-WinLEW-Session` header**, attached
centrally by `hubApiFetch` in `wallet-auth.js`; `?session=` was deleted from
every call site because a query string lands in the shared host's access log,
the backend's own logs, `Referer` headers and anything that copies a URL.

The server still accepts the old forms — `sessionFromRequest()` reads header,
then body, then query — and that is deliberate, not leftover: `hubApiFetch`
retries once with `?session=` if a 401 suggests the header was dropped, which is
what makes the hand-uploaded `api-proxy.php` safe to deploy in any order. POST
bodies still carry `session` too, and that is fine: a request body reaches none
of the places a URL does.

The `?session=` shown below is therefore still *accepted*, but is no longer what
the site sends.

- `GET /api/faucet/status?session=` — sanitized status for the
  authenticated user (discord name, masked wallet, faucet config,
  eligibility, cooldown).
- `POST /api/faucet/claim` — body `{session, requestId?}` only. No wallet,
  amount, Discord ID, or source field is ever read from the body. Rate
  limited to 6/15s.
- `GET /api/faucet/claim/:id?session=` — poll a specific claim's progress;
  ownership-checked (404s if the claim doesn't belong to the caller's
  session), so claim IDs can't be used to snoop on other users.
- `GET /api/faucet/history?session=` (added 2026-07-18) — the caller's own
  past claims (up to 100, oldest-first internally, newest-first on the page),
  plus a summary (count, confirmed count, total confirmed amount). Thin
  wrapper around `getClaimHistoryForUser()` (`src/faucet/claimStore.js`),
  which already existed for the Proof of Value engine — no new aggregation
  logic, just a new route exposing it to the Faucet page itself.
- `GET /api/faucet/global-stats` (added 2026-07-18) — public, no session
  required. All-users, all-time confirmed-claim totals, split by source
  (web/discord) for the page's "Total given away" section. Confirmed claims
  only — a reserved/failed/reconciling claim never counts. 60s in-memory
  cache (matches the Burn Center/Transparency Center pattern) since this
  scans the full confirmed-claims set.

## 18. Frontend states (`/faucet/`)

Loading, signed-out, no-wallet, invalid-wallet, below-holder-minimum,
holder-check-unavailable, faucet-disabled, eligible, reserving, processing/
submitted (polled), confirmed (with a Solscan link), reconciling, known
failure, rate-limited, network/unexpected error — all rendered from one
`renderClaimState()` function in `src/public/faucet/js/app.js` keyed off
`/api/faucet/status` and `/api/faucet/claim/:id` responses. The claim button
is disabled immediately on click and stays disabled until a terminal state,
preventing double-submission client-side (the real protection is
server-side, via the atomic reservation — this is just UX).

**Added 2026-07-18, per the project owner's own request** ("could we add
more? maybe past history... start recording how much has been given away"):
- **"Total given away"** section — public, always visible, no sign-in
  required. Total confirmed WinLEW distributed all-time, plus a Web vs
  Discord split, mirroring the Quiz page's existing platform-comparison
  pattern (`/quiz/`'s `platformCard`) but as a plain stat grid rather than a
  tabbed leaderboard, since there's no per-user faucet leaderboard to switch
  between — just the aggregate comparison that was actually asked for.
- **"Your claim history"** section — signed-in only, hidden otherwise. Every
  past claim (web and Discord together, since they've always shared one
  cooldown), newest-first, with source tag, amount, status, and a Solscan
  link for confirmed ones.

## 19. Visual assets

`src/faucet/assets/WinLew-Faucet.jpg` copied to
`src/public/faucet/assets/WinLew-Faucet.jpg` as the hero image (1024×1024,
925KB, constrained via CSS `aspect-ratio: 1/1; object-fit: cover` so it's
never stretched). `WinLew-Found.jpg`/`WinLew-Passion.jpg` were **not**
copied — the page didn't have a natural second section for them without
adding clutter; they remain available in `src/faucet/assets/` if a future
redesign wants them. **Not optimized/compressed** — no image tooling
(`jpegoptim`/`imagemagick`/`cwebp`) was available in the build environment;
copied at full original quality/size rather than risk a lossy re-encode
that couldn't be visually verified. Recommended follow-up: run it through
whatever image pipeline the rest of `src/public/images/` uses, if any.

**Updated 2026-07-18:** the hero image is now `WinLew-Faucet-banner.png`
(1254×1254, ~2.6MB, project-owner-supplied — same CSS constraint applies,
still never stretched). The old `WinLew-Faucet.jpg` was left in place, not
deleted, in case anything else still references it. The new banner has its
own baked-in illustrative numbers ("Your balance: 12,540," "Lifetime earned:
125,300," a countdown clock) — these are decorative marketing copy, not live
data, and are unrelated to the real live figures the page renders separately
via `/api/faucet/status` and the new `/api/faucet/global-stats`. Also not
optimized/compressed, same reasoning as above.

## 20. Legacy data migration

`bot.js` calls `claimStore.migrateLegacyV2IfNeeded()` once at boot (right
after `initFaucetStorage()`), passing the already-normalized v2 data from
`getClaimState()` and the current `cooldownMs`. Idempotent (a `meta`
marker prevents re-import), never deletes or modifies
`faucet_claims.json`, never moves a lock to an *earlier* expiry than one
already recorded. **Verified against the real production
`faucet_claims.json`** (12 wallets, 7 users) in a throwaway store — all 12+7
imported correctly, second run correctly no-op'd, and `md5sum` confirmed
the original file was byte-identical before and after (see §22).

**Rollback**: the new store (`src/faucet/data/claims_v3.json` file-mode, or
the `faucet_locks`/`faucet_claims` Mongo collections) can be deleted/dropped
entirely at any time — `faucet_claims.json` remains the untouched source of
truth and migration will simply re-run cleanly on next boot. Nothing about
this migration is destructive to existing data.

## 21. Environment variables

No new *required* variables. Same names/defaults as the original bot:
`DRIP_AMOUNT` (1000), `FAUCET_COOLDOWN_HOURS` (24),
`FAUCET_MIN_HOLDER_BALANCE` (1), `DISABLE_FAUCET_HOLDER_CHECK`,
`WINLEW_MINT`, `RPC_URL`, `BOT_KEYPAIR_PATH`, `TOKEN_SYMBOL`. New optional:
`FAUCET_DISABLED` (kill switch, default off), `FAUCET_TREASURY_PUBKEY`
(optional — lets eligibility reject self-send to the treasury without any
process needing to read the keypair file; recommended hardening, not
required). New for the payout worker: `FAUCET_PAYOUT_SCAN_MS` (5000),
`FAUCET_PAYOUT_MAX_BATCH` (10), `FAUCET_PAYOUTS_DRY_RUN`.

**Deployment requirement**: `DRIP_AMOUNT`/`FAUCET_COOLDOWN_HOURS`/
`FAUCET_MIN_HOLDER_BALANCE`/`DISABLE_FAUCET_HOLDER_CHECK`/`WINLEW_MINT`
must be set in **root `.env`** (not only `src/faucet/.env`) — `src/runner.js`
already merges root `.env` first into every spawned service's environment
(its own comment: "shared values like WINLEW_MINT and SOLANA_RPC are
available to all services"), which is what keeps Discord and web policy
identical. If these only live in `src/faucet/.env`, the web process (which
only loads root `.env`) will silently fall back to this code's defaults
instead of your configured values.

## 22. Deployment topology

`mole` (`src/index.js`, hosts `startWeb()` + the main Discord bot) and
`faucet` (`src/faucet/bot.js`) are already separate OS processes per
`src/runner.js`. This change adds one more: `faucetpayouts`
(`src/faucet/payout-worker-main.js`). All three must share the same claim
store — either the same Mongo cluster (`MONGO_URI` set identically for all
three, which is how this repo is already configured — see §21) or, in
file-mode dev, the same filesystem (they already do, since they all run
from the same checkout).

## 23. Test commands

```bash
npm test                                    # runs test/**/*.test.{cjs,mjs}
node --check src/faucet/claimStore.js       # syntax-check any file you edit
node src/runner.js faucetpayouts            # run the worker standalone
FAUCET_PAYOUTS_DRY_RUN=true node src/runner.js faucetpayouts   # dry run, no real transfers
```

`test/faucet/*.test.mjs` covers: exact amount conversion (incl. the classic
`0.1` float-imprecision case), reservation/blocking/replay, the
cross-platform invariant directly, state transitions, status queries,
legacy migration (synthetic data), the payout worker's dry-run + source
filtering, and — critically — 20-way and mixed-source concurrent-reservation
races (exactly one winner every time). All tests force
`MONGO_ENABLED=false` explicitly at the top of the file, since other faucet
modules load real `.env` files as an import-time side effect and could
otherwise flip a test from file-mode to (unreachable, production) Mongo
mode mid-run — this bit me once during development; see the comment in
`test/faucet/claimStore.test.mjs`.

## 24. Manual live verification performed

Using throwaway dummy credentials (never `src/faucet/bot-keypair.json`,
never a real Discord token) and the real dev `src/faucet/faucet_claims.json`
(read-only, backed up and byte-verified unchanged after):

- Booted `src/mole/web.js`'s `startWeb()` with dummy config; hit
  `/api/faucet/status` and `/api/faucet/claim` — TODO fill in exact output
  once run (see the engineering report for the actual transcript).
- Ran the cross-process race test directly: 8 separate `node` processes
  launched simultaneously, all reserving the same (user, wallet) — exactly
  1 succeeded, 7 correctly blocked with `blockedBy: 'user'`.
- Ran the legacy migration against the real 12-wallet/7-user
  `faucet_claims.json` — correct counts, idempotent on rerun, original file
  `md5sum`-identical before/after.
- **Not verified**: Mongo-mode reservation against a live, non-production
  Mongo instance (none was safely available in this environment) — the
  Mongo transaction code follows standard, well-documented MongoDB atomic
  upsert idioms and was carefully reviewed, but is implemented-but-not-
  externally-verified. Recommended next step: stand up a disposable local
  `mongod` (or a test Atlas database, never the production one) and re-run
  the race test with `MONGO_ENABLED=true`.

## 25. Known limitations & remaining sybil risk

- **No CSRF token mechanism** anywhere in this app (pre-existing). Mitigated
  by requiring a signed-wallet session; not eliminated.
- **Sybil resistance is NOT complete.** This system stops one Discord
  identity + one wallet from double-claiming, and stops wallet-swapping or
  re-linking from bypassing cooldown. It does **not** stop someone from
  creating multiple Discord accounts, each verifying a different wallet, and
  claiming once per account — that was already true of the original bot and
  is unchanged here. The holder-balance floor raises the cost of this but
  doesn't eliminate it.
- **File-mode is single-host only** (§12) — production must run Mongo.
- **Mongo-mode reservation untested live** (§24).
- **SNS display name is best-effort** — if it fails or times out, the page
  just omits it; the payout destination is always the resolved public key,
  never the SNS name itself.
- **Reconciliation is manual** (§15) — there's no automated re-check of
  `reconciling` claims. A scheduled sweep that checks the chain directly
  would be a reasonable future hardening step.
