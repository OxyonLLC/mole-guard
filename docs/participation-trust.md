# Participation trust layer

Built 2026-08-14, after a participant bought a fraction of a token, redeemed
1,500 WinLEW three times inside four hours, moved each payout to a fresh wallet,
and repeated.

The anti-abuse system built for the faucet — ban list, funding-cluster walk,
holder minimum — **had never been wired to the quiz path**. `src/quiz/` imported
none of it. The gate was `balance > 0`, and a comment claimed parity with the
faucet that did not exist.

Two things fixed that floor: `7c89995` wired the faucet's gates in, and `973ab0e`
made payouts system-only by default. The second matters more. Any *per-wallet*
limit is beaten by owning another wallet; what cannot be bought is control over
**when** the system pays. Everything documented below sits on top of that and
does a different job: making the remaining abuse **visible, attributable and
reviewable**.

---

## The six switches

Collection, decision, enforcement and anchoring are four separate ideas, so they
are four separate switches. Each can be deployed and reverted alone, and none of
them implies the next.

| Stage | Flag | Does |
|---|---|---|
| 1 | *none — correctness* | Payout intent + startup reconcile |
| 2 | `PARTICIPATION_SIGNALS_ENABLED` | Collects hashed signals. Used by nothing |
| 3 | `QUIZ_RISK_ENGINE_ENABLED` | Scores in shadow. Decides nothing |
| 4 | `QUIZ_RISK_ENFORCEMENT_ENABLED` | Holds top-band payouts for review |
| 5 | `GEOPROOF_RECEIPTS_ENABLED` | Issues replayable payout receipts |
| 6 | `GEOPROOF_ANCHORING_ENABLED` | Publishes a commitment to the decision hash |
| — | `QUIZ_FIRST_PAYOUT_CHECK_ENABLED` | Provenance check on a first payout |
| — | `QUIZ_WATCHLIST_GATE_ENABLED` | Gates a *second* payout to someone flagged |

Two secrets have no default and no fallback: `PARTICIPATION_HASH_SALT` and
`PAYOUT_RECEIPT_SALT`. **Unset means the feature does nothing, never that it runs
unsalted.** A `/24` has 256 values in it; an unsalted hash of one is a lookup
table, not a protection.

---

## What is stored, and what is never stored

| Data | Stored as | Retention | Ever public? |
|---|---|---|---|
| Device fingerprint | salted SHA-256, 7 allowlisted fields | 90 days | never |
| Client IP | `/24` (v4) or `/48` (v6) network, salted hash | 90 days | never |
| Answer timing | coarse buckets (`under_1s`, …) | 90 days | never |
| Risk band + signal names | plain (`elevated`, `shared_device`) | with the payout | band only, on request |
| Decision + rules version | plain | permanent | yes |
| Decision hash (receipt) | SHA-256 of the canonical payload | permanent | yes, if anchored |

Raw IP addresses, raw fingerprint values, GPS coordinates and session identifiers
are **never stored and never anchored**. `hashDeviceFingerprint()` reads a
positive allowlist rather than filtering a denylist, so a client posting extra
keys cannot widen what we keep, and a new field added upstream cannot leak by
being forgotten about.

Rotating a salt deliberately breaks correlation with every older record. That is
the expiry mechanism, not a side effect — and it is also the one honest cause of
a `receipts:verify` mismatch (see below).

---

## Deliberate non-signals

These look like oversights and are not. Do not "strengthen" them.

**A shared network is worth 2 points out of 100.** Families, flatmates, offices
and entire mobile carriers behind CGNAT share a `/24`. It is recorded so a
reviewer can see it was considered, and weighted so it can never move a band on
its own. Two accounts on one network with different devices score `normal`, and
a test pins that.

**No signal scores clean.** Someone who plays entirely through Discord, or blocks
everything a browser can be asked about, produces nothing. This must never become
"you didn't let us fingerprint you, so you're a suspect."

**A held payout stays `pending`, never `failed`.** Held is a pause with a human at
the end of it; the points stay earned. `failed` would stop retries and read to the
participant as an error they caused.

**The wallet-swap signal currently scores 0.** Its input lives in Mole Guard's
store rather than the quiz DB, so it is passed `[]` on purpose. An unavailable
signal must not invent a verdict. Not plumbed yet, not a bug.

**Quiz redemption gives the same refusal for a direct ban and a linked one.**
Identical wording denies a prober the information about which wallet to stop
funding from.

---

## Fail open, fail closed

| Failure | Behaviour | Why |
|---|---|---|
| Signals unavailable | **open** | Earning must never depend on telemetry |
| Risk engine throws | **open**, logged loudly | A scoring bug must not freeze payouts |
| Funding-cluster RPC down | **open** | Matches the faucet's existing behaviour |
| Balance unreadable | **closed** | "Cannot verify" must never mean "eligible" |
| GeoProof unreachable | **open** | Receipts are evidence, not a gate |
| Crash between send and record | **reconcile from the intent** | Waiting is recoverable; paying twice is not |

That last row is the one that could have cost real money. `sendWinlew()` used to
return before anything was persisted, so a crash in that window left the record
`pending` and the next scan sent again. The signature is now written as a
`payoutIntent` *before* confirmation, and `reconcilePayoutIntents()` asks the
chain what happened before any transfer goes out. An `unknown` answer leaves the
record stuck **on purpose**.

---

## Receipts (Stage 5)

A receipt answers "why did this payout happen?" in a form someone can check
without trusting our database, our screenshots, or our payout worker.

`src/mole/payoutReceipt.js` builds a canonical payload — sorted keys at every
depth, so an identical decision always serialises identically — and hashes it.
Participant and wallet appear only as **salted references**: a reviewer holding
the database can confirm one matches a user; a stranger holding the receipt
learns nothing about who was paid. The risk verdict is copied with its rules
version, so re-tuning thresholds later cannot retroactively change what a receipt
says was decided.

**WinLEW does not depend on `@xyo-network`.** GeoProof's reference implementation
needs 7.x and runs TypeScript directly in another workspace; adding it here would
put a version conflict or a broken install in the payout path. The hashing is
`node:crypto` only, and the XYO half lives behind `GEOPROOF_SERVICE_URL` as a
separate local service. If that service is down, payouts continue and the receipt
is simply unattested — still locally valid, still replayable.

### Checking one

```bash
npm run receipts:verify              # every receipted payout
npm run receipts:verify -- --days=7 --verbose
npm run receipts:verify -- --json    # ids and hashes only, safe to paste
```

Exit code 1 on any mismatch, so it can be a cron gate rather than something
somebody has to remember to read.

A mismatch means the record changed after the money moved — amount, wallet, risk
verdict or rules version is no longer what was paid under. **The one honest false
positive is a rotated `PAYOUT_RECEIPT_SALT`**, which invalidates every earlier
receipt by design. If everything mismatches at once, suspect the salt before
suspecting the database.

## Anchoring (Stage 6)

Anchoring publishes a **commitment to the decision hash**. It never publishes the
evidence, and it cannot: only `{decisionHash, receiptVersion, anchor}` crosses
the wire, a test asserts that set exactly, and turning anchoring on does not
widen it. Commitment → private evidence, never the reverse. A public chain is
irreversible, and an IP address or a device hash put there stays there.

---

## The first payout (2026-08-14)

**There is no holder minimum, deliberately.** The owner considered
`QUIZ_MIN_HOLDER_BALANCE=1500` and rejected it: any holder should be able to
earn. A minimum taxes every honest small holder to inconvenience one farmer who
can just buy more of the token.

What replaced it is a check on the **first payout to a Discord account** — the
moment money first leaves the system to a person. It asks the four questions the
owner asked for: who funded this wallet, do they play here, do they still hold
anything, and is this the same person on a second wallet or a friend?

Keyed on the **account, not the wallet**. Keying on the wallet would make every
new wallet a clean slate, which is precisely the loophole. Runs once, then never
again for that person.

### The first payout is always paid

**A flagged first payout still settles, in full, immediately.** There is no
switch that changes that, and a test asserts no `firstPayoutEnforcementEnabled`
ever comes back.

The owner's correction on being shown the original design — *"so now new wallets
need to wait 3 days? lets pay out the First one instant, and put them on a
list"* — is right on both counts. Making a brand new participant wait days for
money they earned, on circumstantial evidence, to catch a farmer who will simply
wait too, costs every honest newcomer and stops nobody.

So a flag puts them on the **watchlist**, which gates their **second** payout
(`QUIZ_WATCHLIST_GATE_ENABLED`). One payout is a cheap price for real evidence,
and the pattern this exists to catch — redeem, move, relink, redeem again — only
becomes visible on the repeat anyway. An admin who clears the flag before then
costs that person nothing at all.

Even the second payout is not a dead end: anything the gate holds still
auto-releases on the review SLA, and `!quizclear` frees it in the same write
that clears the flag.

| | First payout | Second, still flagged |
|---|---|---|
| Verdict `clear` | paid | paid |
| Verdict `review` | **paid**, watchlisted | held, auto-releases at 72h |

`src/mole/payoutProvenance.js` refuses three things on purpose:

1. **It never rejects.** The worst verdict is `review`, and on a first payout
   that does not even delay the money. A machine does not get the last word on
   whether someone is paid.
2. **It fails open.** An unreachable chain, a truncated walk or any throw
   produces `clear` with the reason recorded. A first payout lands on someone
   with no history to argue with; "we could not check" must never read as "you
   look guilty".
3. **It does not mistake infrastructure for a person.** A wallet that has funded
   several others is an exchange, a router or a bonding curve. Being downstream
   of one is how people buy tokens — `INFRASTRUCTURE_FANOUT` suppresses every
   finding from such a funder. Without it the check flags nearly everybody.

What actually earns a review: funded by **this same account's** earlier payout
(weight 100 — the 2026-08-14 pattern exactly), funded by a **banned** wallet
(100), funded by another participant's payout (60), and a funder that emptied out
after funding (25, a pass-through shape). Being funded by a friend who plays here
is weighted **zero** and recorded only so a reviewer sees the relationship.

### Who can act, and how

`QUIZ_REVIEWER_ROLE_IDS` defaults to the server's **Admin** role, so every admin
can decide without any configuration — a review queue only one person can clear
is the same hole as one nobody reads. `MOD_IDS` still works alongside it.

```
!quizwatch                     everyone flagged, oldest first
!quizwatch <userId>            the evidence for one
!quizclear <userId> <note>     clear them — a note is required
```

Every announcement about a flag **includes the exact command**, pings the
reviewer role, and says plainly whether anything was actually withheld. A note is
required on `!quizclear` for the same reason `!quizreject` requires a reason:
it is a decision about somebody's money, and it should not be possible to make
one without leaving a record of why. Cleared entries are kept, not deleted —
the entry *is* the evidence that somebody looked.

`!quizreview <id>` prints the funding wallets and every finding with its weight,
so a reviewer can disagree with the scoring rather than rubber-stamp a verdict. The
channel announcement names the signals but **not** the wallets — a public post
tying a Discord handle to specific addresses is a privacy problem regardless of
what the person did. Users are told about the check on `/quiz/` before it can
ever surprise them.

## A hold is a timer, not a state

The owner's objection on being shown the review queue: *"i would hate not to see
something and it never get reviewed and then..."*

He was right, and it was a real hole. A payout held pending human review is only
fail-open **if a human turns up**. If nobody reads the channel that week, the
participant is never paid, never told why, and nothing anywhere says so. That is
fail-*closed* wearing a fail-open costume, and it is worse than not holding at
all — at least an outright refusal is visible.

`src/quiz/reviewQueue.js` runs at the top of every payout scan:

1. **Auto-release.** A soft hold nobody touched by its deadline
   (`QUIZ_REVIEW_SLA_HOURS`, 72h) is released and paid — and **announced**, so
   the operator has to see that a payout went out unreviewed. Recorded as
   `auto_released`, never `approved`: an unattended queue must not be able to
   masquerade as a reviewed one. **On by default.** Enforcement without this
   valve is a money black hole.
2. **Escalation.** A waiting hold is re-announced as it ages, and the reminder
   *changes* each time — an alert that reads identically the tenth time is one
   nobody reads the tenth time.
3. **Digest.** Everything held, with ages and deadlines, on a schedule even when
   nothing changed. Silence should mean "nothing is waiting", and that is only
   true if a non-empty queue is never silent.

**Nothing here can auto-reject.** The timer only ever runs in the participant's
favour. The one thing that never auto-releases is a hold linked to a **banned**
wallet — a human banned that on purpose, and a timer must not overrule them.
Those escalate forever instead.

### Two bugs this uncovered

`noteRiskAssessment()` set `heldTs = Date.now()` unconditionally, and the worker
re-scores pending records every 45 seconds. A record held for a week looked 45
seconds old forever, so **no hold could ever age out** and the valve would never
have fired for anybody. `heldTs` is now set once.

That was hidden behind a comment claiming `nextAttemptTs = null` parked the
record. It does not — `listAutoSettlementCandidates()` only skips a *future*
`nextAttemptTs`, so `null` means "eligible right now". Held records were being
re-scored and re-announced on every single scan. They are now genuinely parked
on `decision === 'held'`, and `approved` / `auto_released` both leave that state.

## Honest limits

Device hashes are **not identity**. A farmer with a second phone, or one who
clears and randomises their browser, defeats the device signal. This raises the
cost of abuse and creates evidence about it; it does not make abuse impossible.

The strongest control remains the one already shipped: **the system decides when
payouts happen.**
