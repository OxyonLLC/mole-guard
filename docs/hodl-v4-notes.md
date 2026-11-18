# v4.0.0 HODL Rewards — running notes, gaps and open questions

Kept deliberately as we go, at the owner's request: *"ensure we keep notes so we
can also add things where they may have been skipped."* Anything deferred,
assumed, or noticed-but-not-fixed lands here rather than in someone's memory.

Stage status: **A done** (epoch engine) · **B done** (preview, gap 1 closed) ·
**C done** — the send exists, dry-run by default, and the version is now
**4.0.0**. **D done** (`/hodl/` page) · **E done** (PoV + quiz cadence) · **F done** (governance + epoch admin) · **G — curve built and tested, WIRING DEFERRED**.

---

## Gaps found, not yet closed

### 1. ~~The verified-wallet count differs by source — 7 vs 9~~ CLOSED 2026-08-16

It was two separate things wearing one symptom.

**The mirror was stale.** `readJson()` serves a cache populated at boot, so a
long-running worker would decide a Tuesday payout from whatever the population
looked like when it started — a participant who verified on Monday would simply
be missing. `gatherIdentities()` now calls `refreshManagedFile()` first, and the
preview reports **9 considered** where it reported 7. Failing to refresh is a
BLOCKING problem in the preview, not a footnote: paying from a boot-time cache
silently shorts whoever joined since.

**The other two were never eligible anyway.** Both are `wallet:<hash>` ids from
the wallet-only sign-in path, with no Discord account behind them. Anyone can
mint one per wallet they own, so admitting them would hand back the exact Sybil
vector that identity-level qualification exists to close. They are now excluded
by an explicit rule (`WALLET_ONLY_PROFILE`) rather than by the accident of the
mirror not containing them — "correct by accident" stops being correct the
moment the mirror syncs, which is precisely what the first fix made it do.

### 2. Balance lookups will not scale as-is

`gatherIdentities()` reads one balance per identity at concurrency 4. Fine for 7.
At 900 participants that is 900 sequential-ish RPC reads against an endpoint
that is already rate limited, inside a job with a deadline. Options when it
matters: `getMultipleAccounts` batching, or a snapshot built incrementally
during the week rather than all at once on Tuesday morning.

### 3. Reserve wallet is derived, not configured

The preview resolves the reserve by loading the treasury keypair and taking its
public key, because no `HODL_RESERVE_PUBKEY` / `FAUCET_TREASURY_PUBKEY` is set.
That works and reads only the public half — but a payout worker should not need
a keypair present merely to answer "can we afford this". Set
`HODL_RESERVE_PUBKEY` explicitly before Stage C.

### 4. HODL will share the faucet's reserve unless told otherwise

`FcEtZqVo…` currently funds faucet **and** quiz **and** games. Adding HODL makes
four programs drawing on one wallet with no per-program accounting. A separate
HODL reserve, or at minimum a tracked allocation, would make "what did HODL
cost this epoch" answerable without reconstructing it from transactions.

---

## Decisions taken, with the reasoning

- **Weekly pool 10,000.** The spec's 100,000 example assumed ~100 wallets; there
  are 9. At 100k that pays more than a daily faucet claimer earns. See the plan.
- **Qualification per identity, not per wallet** (spec §12). Equal shares plus
  wallet-level qualification means three wallets is three shares.
- **Per-participant weekly cap 2,500.** Without it, one qualifier in a quiet
  week takes the entire pool.
- **The pool is a ceiling.** PoV bonuses redistribute within it; they never
  enlarge it.
- **Balance is a threshold, never a multiplier.** Tested explicitly.
- **`minHold` 1,000** — low on purpose. It means "a holder", not "wealthy".

---

## Deliberate behaviours that look like bugs

- **With very few qualifiers the per-head cap flattens the PoV bonus.** At two
  participants both hit the 2,500 cap and the tier cannot separate them.
  Protecting the pool outranks rewarding participation. Pinned by a test.
- **`undistributed` is usually non-zero.** Rounding down to whole tokens and the
  per-head cap both leave a remainder. It stays in the reserve rather than being
  forced onto someone.
- **An unreadable balance disqualifies.** The faucet fails open; a batch payout
  fails closed. Nobody is waiting at a keyboard on Tuesday, so waiting for a
  clean read costs nothing and guessing costs real tokens.

---

## Two reporting bugs found by writing the tests

Both were "the code disqualified correctly but lied about why", which matters
because an admin reading a snapshot months later has only the reason string.

1. **`Number(null)` is 0**, so a balance we failed to read looked like a real
   balance of zero and reported `below_min_hold` instead of `balance_unknown`.
2. **`verified: false` covers both "never verified" and "lapsed"**, so an expired
   verification reported `not_verified`. Different situations, different fixes —
   one person verifies, the other re-verifies. Now separated by inspecting the
   expiry.

---

## Still to build

| Stage | Work | Notes |
|---|---|---|
| C1 | ~~epoch storage + batch planner~~ **done** | stable transfer ids, resumable chunks, immutable paid records |
| C2 | ~~the send + v4.0.0~~ **done** | `npm run hodl:pay` (dry run) / `-- --apply`; reconcile runs before any send |
| D | ~~`/hodl/` page + Mole Link entry~~ **done** | nav needs **FIVE** edits, not four — see below |
| E | ~~PoV signal + quiz cadence~~ **done** | folded into the STREAK, not verification — see below. Cadence switch is armed but deliberately not fired |
| F | ~~Governance + epoch admin~~ **done** | a vote produces a DRAFT; out-of-range is REFUSED, never clamped |
| G | Streak curve + doc correction **done**; **wiring deferred** | see below — the amount is threaded through three files in the live faucet money path |

### Questions for the owner, when we circle back

1. Should HODL draw from a **separate reserve** (gap 4), or keep sharing the
   faucet's? Separate makes epoch accounting honest. **Still open.**
2. `minHold` is 1,000. Deliberately low — confirm that is the intent, since it
   means almost any holder qualifies.
3. Epoch 1 starts on the next payout weekday from whenever it is created
   (`hodl:epoch --create` shows the dates before committing to them). Should it
   instead align to a calendar quarter so epochs and quiz seasons share tidy
   boundaries? **Still open — decide before creating E1.**
4. What happens to a participant who qualifies for weeks 1–5, lapses, then
   re-verifies at week 9? Consecutive-week credit resets, or resumes?
5. ~~**The quiz cadence cutover.**~~ ANSWERED by the code: `switchCycleCadence()`
   CLOSES the current cycle, and closing settles payouts. So it must run just
   AFTER a cycle ends naturally, never during one. `npm run quiz:cadence`
   refuses `--apply` while a cycle is live. **W3 ends 2026-08-16 ~21:58 UTC —
   run it any time after that.**


---

## Stage C part 1 — what exists now, and what the send must respect

`src/mole/hodlBatch.js` (pure) and `src/mole/hodlStore.js` (persistence) are in.
The send is deliberately not, so these could be tested to destruction first.

**The contract the sender must honour:**

- `nextPendingChunk()` NEVER returns a SUBMITTED chunk. Submitted means a
  signature exists and the transaction may still land. It must be resolved
  against the chain by a reconcile pass — `unresolvedChunks()` lists them —
  and never simply retried.
- `markSubmitted()` is called BEFORE confirmation, so a crash in that gap
  leaves evidence instead of a silent re-send.
- `markFailed()` returns a chunk to pending and clears its signature. Only call
  it once the chain has confirmed the transaction did NOT land.
- `paidTransferIds()` is the guard: check it before sending anything.
- `batchProgress().paidAmount` counts CONFIRMED chunks only. Submitted money has
  not been proven to move.

**Chunk size is 8.** A Solana transaction has a hard 1232-byte limit, and a
chunk that is one instruction too greedy fails for every recipient in it.

**Still open for C2:** whether a chunk should create missing ATAs (an extra
instruction per recipient, which changes how many fit) — needs checking against
what the faucet's payoutExecutor already does.


---

## Stage C part 2 — the send

`npm run hodl:pay` (dry run) · `-- --apply` to execute · `-- --force` to bypass
the payout-day check for testing.

**Chunk size is 1, and that is deliberate.** A chunk stores exactly one
`signature`; a signature identifies exactly one transaction. Eight transfers
that become eight transactions would make that field a lie, and a restarted
worker could not tell which of the eight had gone out. Multi-recipient packing
is possible — the quiz worker already puts an ATA-creation instruction and a
transfer in one transaction — but it needs a size check against Solana's
1232-byte limit and a decision about one failing recipient taking down everyone
packed with them. At today's participation it would save six transactions a
week. Not worth being the first thing to move real tokens.

**Order of operations, which is the whole safety property:**

1. refresh the store — never decide from a boot-time cache
2. **reconcile every submitted-but-unconfirmed chunk against the chain**
3. only then send what is still pending

An UNKNOWN signature status is left stuck on purpose: not retried, not failed.
Waiting is recoverable; paying twice is not.

`test/mole/hodlPayOrdering.test.mjs` pins that ordering against the source,
because it cannot be unit tested without moving real tokens. Confirmed to fail
when reconcile is removed.

### What has NOT been exercised yet

The send path has never run against a chain. Before the first real Tuesday:

- run `--apply` against **one** qualified participant and confirm on-chain that
  exactly one transfer exists;
- kill the process between `markSubmitted` and confirmation, restart, and verify
  it reconciles rather than re-sends;
- re-run a completed batch and verify every chunk is skipped.

Until those three are done, treat Stage C as untested in the only way that
counts.

### Still open

- **No epoch exists yet.** `hodl:pay` correctly refuses until one is created and
  activated. That is Stage F's admin tooling, or a one-off script.
- ATA creation is inside the transfer transaction, so a recipient with no token
  account costs one extra instruction, not an extra transaction. Fine at chunk
  size 1; revisit when packing.


---

## Stage D — and a correction to the nav rule

Adding a nav route needs **FIVE** edits, not the four recorded earlier. The
fifth was caught by `indexingHygiene.test.mjs`, not by me:

1. `NAV_GROUPS` in `src/public/assets/nav.js`
2. an **exact** `PAGE_CONFIGS` entry (never extend another page's `match`)
3. `src/scripts/header-audit.mjs` path list
4. the `!pages` catalog in `src/shared/command-inventory.js`
5. **`npm run sitemap:build`** — `sitemap.xml` is generated output that happens
   to be committed, so it goes stale silently and a test fails rather than the
   page being quietly missing from search

`GET /api/hodl/status` is public and deliberately aggregate: counts, pools,
totals and transaction signatures — which are already public on-chain and are
the audit trail. **No Discord ids and no participant wallets.** A weekly list of
paid addresses would rebuild exactly the correlation data every other surface
here keeps private.

The page handles "no epoch yet" as a real state rather than rendering zeros,
because a program that has not started should not look like one that is broken.
That is what it shows today, since no epoch has been activated.

Copy discipline on the page: no staking, yield, APY, interest or return
language anywhere; "not staking" is said explicitly and early; the estimated
share is labelled as an estimate with the reason it can move; and it states
plainly that holding more does not pay more.


---

## Stage E — and where the plan was wrong about PoV

The plan said fold HODL consistency into the existing `verification` weight.
**That would have done nothing.** `verificationSubScore()` already returns 100
for a verified wallet, and every HODL participant is verified by definition —
there is no headroom in that bucket at all.

A fifth `POV_WEIGHTS` entry was the other option and is worse: it dilutes quiz,
faucet, games and verification from 0.25 to 0.20 each, silently changing
everyone's existing score to make room for a new program.

It belongs in the **streak multiplier**, and the code said so before I did:

> *"currentStreak is only tracked by the quiz system today — no other system
> records a consecutive-participation streak yet. Using it as the sole source
> is a deliberate v1 scope choice, not an oversight."*

HODL consecutive qualified weeks is the second such signal. It now shares the
**same capped +10%** as the quiz streak rather than adding a second bonus, so
the ceiling does not move and nobody's score inflates because v4 shipped. A week
is worth 20 answers' credit — weeks are scarce where answers are plentiful — so
a full quarter of unbroken qualification reaches the same cap a committed quiz
player does.

Tests enforce the two things that matter: a non-participant's score is
**unchanged**, and balance is not an input (a 1,000-holder and a 50,000,000-holder
with the same weeks score identically).

### The quiz cadence is armed, not fired

`npm run quiz:cadence` (dry run) · `-- --apply` after a cycle closes.

It refuses `--apply` while a cycle is live, because `switchCycleCadence()` closes
the current cycle and closing SETTLES PAYOUTS. Running it mid-cycle truncates
everyone's window and settles their points early. New prefix `E`, since `C`
(quarterly) and `W` (weekly) are both used and the function rejects a reused one.


---

## Stage F — governance, and the three things stopping a vote overspending

`src/mole/hodlGovernance.js` turns a passed proposal into a **draft** epoch.
Spec §8's rule is absolute — a vote must never authorise an unlimited payout —
so three separate mechanisms enforce it, because one is not enough for something
whose whole job is letting other people change how much money leaves:

1. **An allowlist.** Only `weeklyPool`, `minHold` and `povBonusTiers` are
   votable. Everything else in a proposal is ignored *and reported*, so a field
   nobody anticipated cannot become a setting nobody reviewed. A proposal
   setting `status: "active"` does not activate itself.
2. **Hard limits, and REFUSAL rather than clamping.** If the community votes
   50,000 and the ceiling is 25,000, quietly writing 25,000 pays out something
   nobody voted for while looking like the vote was honoured. It refuses, which
   forces someone to say out loud that the vote exceeded policy.
3. **Draft, never active.** A passed vote produces an epoch a human still has to
   activate, and `validateEpoch()` runs again at that moment.

The epoch records `decidedBy` — proposal id, title, mode — so the page can say
why the numbers are the numbers, and a reader can find the vote rather than take
it on trust.

### Epoch admin: `npm run hodl:epoch`

```
npm run hodl:epoch                                    list
npm run hodl:epoch -- --create --id=E1 --apply        create a draft
npm run hodl:epoch -- --activate=E1 --apply           make it live
npm run hodl:epoch -- --from-proposal=<id> --id=E2    draft from a vote
npm run hodl:epoch -- --close=E1 --apply              close it
```

Dry run by default. An epoch does not itself move tokens, but activating one is
what lets `hodl:pay` do so, which makes it the same class of decision.

**This unblocks the on-chain testing.** There is still no epoch, so `hodl:pay`
correctly refuses. Creating and activating E1 is the prerequisite for the three
unexercised checks recorded above.


---

## Stage G — built, tested, and deliberately NOT wired in

`src/mole/claimStreaks.js` is complete and tested. `/proof-of-value/` and the
`rewardMultipliers.js` header are corrected, so nothing on the site is false.

### The spec contradicted itself, and here is the reading used

The brief said the bonus caps at **+60**, and separately that a badge waits at
**+100 daily**. A bonus capped at 60 can never reach 100 — both cannot be true.

Resolved using the third requirement, *"ideally if you verify you gain MORE"*,
as the bridge:

| streak | unverified | verified |
|---|---|---|
| day 1 | +1 | +1 |
| day 30 | +30 | +30 |
| day 45 | **+60 (cap)** | +60 |
| day 65 | +60 | **+100 (cap)** 🏆 |

Both stated caps survive, the badge becomes reachable, and verification is worth
something concrete. **Change `STREAK_TIERS` if a different reading was meant.**

### Why the wiring is deferred rather than rushed

The bonus has to reach the payout, and the amount is currently fixed at three
points in the live faucet path: `service.js` computes `amountBaseUnits` and
`amountDisplay` for the claim RECORD, `executeFaucetPayout()` passes no amount,
and `dripTokens()` reads `DRIP_AMOUNT` directly. Threading a per-user amount
changes the claim record's shape as well as the transfer.

That is the **largest outflow in the project** — ~34,500/week, more than
everything else combined — and the same class of change as the HODL send, which
was also deliberately not rushed. It should be done with a full context budget,
in its own commit, with the reconcile/idempotency implications thought through:
a claim record that says 1,500 while 1,560 was sent is a silent accounting drift.

### Also not built: the games streak

The brief said *"write this for faucet and games"*. The curve is generic and
takes `verified` plus a day count, so games can reuse it unchanged — but games
rewards flow through `validateRewardClaim`/`recordRewardClaim`, a different path
with its own caps and a daily maximum. Applying a streak there needs those
interactions checked, not assumed.

### Economics, for when it is wired

At the +100 ceiling a daily claimer earns 1,600 instead of 1,500 — **+6.7%**.
With roughly seven daily claimers all at maximum that is ~+4,900/week on top of
~34,500, so about **+14%** at full adoption. Modest, and the cap is what keeps it
that way.

---

## 2026-08-16 — the three unexercised checks were run against mainnet

All three pass. Method: a throwaway epoch `E0-verify` (10 WinLEW pool, 1 week,
back-dated to Tue 2026-08-11) with `minHold` set to 50,000,000 so exactly one
verified identity qualified. Cost 20 WinLEW across two epochs. Both are closed;
their snapshots stay on record, which is the intended behaviour.

| Check | Result |
|---|---|
| 1. One participant, `--apply`, exactly one transfer on-chain | **PASS** — one transfer instruction, 10.000000, one signature touching the recipient ATA |
| 2. SIGKILL between submit and confirm, then restart | **PASS** — *"chunk 0: already landed — recorded, not resent"*, 0 chunks sent |
| 3. Re-run a completed batch | **PASS** — every chunk skipped |

Final on-chain state: **six payout runs, two sends, two transfers.** Not three.

### Check 3 found a real bug, and it was not the one being tested

Run 1 sent, confirmed, and recorded chunk 0 as paid. Run 2 opened with
`status: pending` and an unresolved chunk. The local file said `paid/confirmed`;
Mongo said `pending/submitted`.

`writeJson()` writes local disk synchronously and queues the Mongo push on a
background chain. Nothing exported could await that chain, and
`refreshHodlStore()` reads Mongo. So **any CLI that writes a managed file and
then calls `process.exit()` loses the write**, and the next run pulls the
pre-write state back over the correct local file.

That instance was recoverable only because reconcile asks the chain before
sending anything — the step exists for precisely this. The unrecoverable variant
is a SIGKILL between submit and confirm: the next run sees no signature and
sends a **second transaction**. An exit handler cannot help there, which is why
the fix makes the persist durable *at the point of submission*, not at exit.

Fixed in `e5e7038`: `flushManagedWrites()` in both storage layers, awaited inside
`hodl:pay`'s `save()` and on both exit paths, and in `hodl:epoch`.

### Still open: the same hazard elsewhere

This was found in the HODL path, but the storage layer is shared. **Any
short-lived script that writes a managed file and exits has the same hole.**
Only `hodl-pay.js` and `hodl-epoch.js` were audited and fixed. Worth sweeping:
`faucet-reconcile.js`, `clean-airdrop-list.js`, `quiz-cadence.js`, and the
SIGTERM path of the long-lived workers — a restart during a queued persist drops
it exactly the same way.

### `--start=YYYY-MM-DD` added to hodl:epoch

`nextPayoutDay()` only looks forward, so every epoch necessarily began on a
future Tuesday and none could be exercised on the day it was created. The flag
**refuses a start that is not on the payout weekday**: week boundaries are
counted from the start (`weekIndexFor`) while the payout day is checked against
the calendar (`isPayoutDay`), so an off-weekday start puts a payout in a
different week than the one it settles, permanently. It is also the mechanism
the "align epoch 1 to a calendar quarter" decision will need.

### What this does NOT prove

The batch ran with **one** chunk. Multi-chunk partial failure, the three-failure
stop, and resuming a half-paid batch are unit-tested but still unexercised on
chain. The first real epoch will be the first multi-participant run.

### The sweep — `ebad5f9`

The note above said the same hazard probably existed elsewhere. It did, in three
more places than expected, and the shared-storage guess was right.

**There are three layers with this pattern, not two.** `src/quiz/storage.js` has
its own `persistChains` map and had no flush at all.

Fixed: `src/quiz/storage.js` (the missing flush), `quiz-cadence.js`,
`src/faucet/bot.js`, `src/quiz/payout-worker.js`, and `src/index.js` — which had
**no shutdown handler whatsoever**, so SIGTERM killed the web and bot instantly
and dropped queued writes for sessions, governance votes, wallet links and merch
orders.

The faucet bot was the worst of them, and it is not a HODL problem at all: a
claim written moments before a `pm2 restart` could lose its Mongo push, and
`refreshManagedJson()` writes Mongo back over the local file within 30s of the
next boot. The claim vanishes and the cooldown goes with it, so the same user
can claim again. That is the repo's oldest bug shape, reached by a new route.

Checked and deliberately left alone: `clean-airdrop-list.js` (raw file writes,
bypasses the managed layer by design) and `faucet-reconcile.js` (writes through
`claimStore.js`, plain `fs.writeFileSync`, no Mongo mirror). Both are pinned by
tests so a future change to either trips the guard instead of going silent.
