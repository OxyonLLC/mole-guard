# Deploy — 2026-08-14 · anti-abuse, payout safety, site logging

**For the assistant on the serving PC.** All committed and pushed to `main`
(`47d9093..b5a2408`). Read this before restarting anything.

**What happened.** On 2026-08-14 a participant bought a fraction of a token,
redeemed 1,500 WinLEW three times in four hours, moved each payout to another
wallet, and repeated. Two separate problems were found and fixed. One of them
could have paid people twice.

Four jobs. Order matters for the third.

1. Pull, then **upload 5 static files**
2. **Restart the backend and all three workers** — most of this is server-side
3. **Set env vars in the order below** — not all at once
4. Report back what the shadow run shows

---

## ⚠️ Before you pull

Same rule as always: `src/faucet/airdrops.json` and `registrations.json` are
written at runtime by `!register` **and** tracked in git.

**This range does not touch them** — verified, the only `src/faucet/` change in
`47d9093..b5a2408` is `bot.js`. A plain `git pull` is safe. `git reset --hard`,
`git checkout .` and `git stash` still discard runtime writes regardless of what
changed upstream.

---

## 1. Static upload (5 files)

```
quiz/js/app.js            transparency/index.html
verify/profile.html       transparency/js/app.js
verify/profile.js
```

`quiz/js/app.js` is the only one that matters for anti-abuse — it sends the
device fingerprint. The others are the Transparency dashboard rework and the
profile fixes.

## 2. Restart everything server-side

Twelve server files changed. Nothing below reaches production until the process
that loads it restarts.

| Restart | Why |
|---|---|
| Node backend | quiz redemption gates, site logging, signal capture |
| **quiz payout worker** | the double-pay fix — most important |
| **games payout worker** | same confirmation module |
| faucet bot | `!quizreview` / `!quizapprove` / `!quizreject` |

---

## 3. A correction to `3ef3ff8`, and why it mattered

Your commit "Avoid websocket-based Solana confirmations" was **right in
substance** — websocket confirmations do fail on some RPC providers and polling
is the correct answer. One number in it was not safe.

`confirmSignatureByPolling` had a **30-second** wall-clock timeout. A Solana
blockhash lives ~60–90 seconds, so that fired at roughly the *halfway point of
every blockhash*, while the transaction was still perfectly landable. Both payout
workers retry on a throw — `src/games/payout-worker.js` says so in a comment:
*"Leave these rows unpaid — they retry on the next nightly run."*

So a transaction confirming a few seconds after the timeout, followed by a retry,
**sent the tokens twice**. Not an edge case: the normal outcome of a congested
minute. That risk did not exist before, because `spl-token`'s `transfer()` gave
up on blockhash expiry, and expiry means the transaction can never land — so
retrying was safe.

Fixed in `f9646f5`: timeout raised to **120s**, so blockhash expiry is the
terminating condition again and the timeout is only a backstop against a wedged
RPC. A timeout now throws `SignatureUnconfirmedError` carrying the signature and
saying "may yet land — do not re-send". A test fails if the timeout is ever set
to 90s or below.

**A second, deeper hole was found in the same area** (`86b5563`), unrelated to
your change and present long before it:

```js
const tx = await sendWinlew(...)      // money leaves
db.markRedemptionPaidById({ ... })    // crash here -> still 'pending' -> re-sends
```

Nothing was persisted between those two lines. A crash or restart in that window
meant a second transfer. The signature is now written as a `payoutIntent`
*before* confirmation, and `reconcilePayoutIntents()` runs at the top of every
scan — a restarted worker asks the chain what happened before sending anything.
`unknown` leaves the record stuck on purpose: **waiting is recoverable, paying
twice is not.**

**This is why the worker restart matters more than the upload.**

---

## 4. Env vars — set these in stages, not all at once

### Now, safe immediately

```bash
QUIZ_MANUAL_REDEEM_ENABLED=false     # or just leave unset — this is the default
```

On-demand redeeming is now off by default: points accrue and are paid at cycle
close. That is what removes the farmer's control over *timing*, which was the
real lever — any per-wallet limit is beaten by owning another wallet.

### ⚠️ Correction — do NOT set `QUIZ_MIN_HOLDER_BALANCE`

An earlier version of this note suggested `QUIZ_MIN_HOLDER_BALANCE=1500`. **The
owner has since decided against it: "any holder should be able to get it."**
Leave it unset — it inherits the faucet's 1 WinLEW and that is intended. A
holder minimum taxes every honest small holder to inconvenience one farmer who
can simply buy more.

What replaced it is the first-payout provenance check in §10 below.

### Then, collection only — changes nothing for users

```bash
PARTICIPATION_SIGNALS_ENABLED=true
PARTICIPATION_HASH_SALT=$(openssl rand -hex 32)
```

**Both are required.** An unset salt means *no* hashing rather than weak hashing —
a /24 is trivially reversed unsalted, so the correct failure is to collect
nothing. Treat the salt as a secret; rotating it deliberately breaks correlation
with older records, which is the retention mechanism alongside a 90-day prune.

### Then, shadow mode — scores, holds nothing

```bash
QUIZ_RISK_ENGINE_ENABLED=true
```

### NOT YET

```bash
QUIZ_RISK_ENFORCEMENT_ENABLED=false   # leave false until the owner reviews shadow output
```

### Optional, separate feature

```bash
SITE_LOG_WEBHOOK_URL=      # create a webhook in 1350969543480180817
```

Posts website activity — faucet claims, redemptions, wallet sign-ins, merch
captures, role syncs — to Discord. The owner's reasoning: Discord has eyes on it,
the website has nobody watching. Unset means inert, never an error. Note that
channel is already `WATCHDOG_ALERT_CHANNEL_ID`.

---

## 5. What to look for after the shadow run

In the worker logs:

```
[payout][risk] <id> band=elevated score=32 signals=shared_device SHADOW — settling regardless
```

`SHADOW — settling regardless` means the engine scored it and **paid it anyway**.
That is correct in shadow mode. Collect a full cycle of these before anyone
considers enforcement.

Also watch for:

```
[payout][reconcile] checked=N settled=N cleared=N unresolved=N
```

`settled` here means a transfer had already landed and was recorded instead of
being sent again — **each one is a double-payment that did not happen.**
`unresolved` means the chain could not say; those records are held deliberately
and will retry next scan.

---

## 6. Things that look wrong and are not

- **A household scores `shared_network_only`.** Same network is worth **2 points**
  out of 100 and can never move a band on its own. Families, flatmates and CGNAT
  carriers share a /24. Do not "strengthen" this.
- **`no_signal` scores clean.** Discord-only players and people who block
  everything produce no signals. This must never become "you didn't let us
  fingerprint you, so you're a suspect."
- **A held payout stays `pending`, not `failed`.** Held is a pause; points stay
  earned. `failed` would stop retries and read as an error.
- **The wallet-swap signal always scores 0.** Its input lives in Mole Guard's
  store, not the quiz DB, so it is passed `[]` on purpose — an unavailable signal
  must not invent a verdict. Not a bug; not yet plumbed.
- **Quiz redemption refuses with "not eligible" for both a direct ban and a
  linked one.** Identical wording is deliberate: distinguishing them tells a
  prober which wallet to stop funding from.

## 7. Commands the owner now has

```
!quizreview             list payouts held for review
!quizreview <id>        the evidence behind one
!quizapprove <id>       back into the settlement queue
!quizreject <id> <why>  the only action that removes a payout — reason required
!faucetcluster <wallet> funding cluster (now also blocks quiz redemption)
!faucetban <wallet> --review
```

## 8. Report back here

- Did all four processes restart cleanly?
- Any `[payout][reconcile] settled=` lines? Those are real saves — say how many.
- After one cycle: how many payouts scored above `normal`, and what bands?
- `QUIZ_MIN_HOLDER_BALANCE` — confirm it is **not** set (see the correction in §4)
- Any `[payout][provenance]` lines, if you enabled §10?

**No values from `.env` in your reply** — say `set` / `not set`.

## 9. GeoProof receipts — built, off by default

Stages 5 and 6 landed after the section above was written. **Nothing in sections
1–8 depends on them, and they change nothing until you set a flag.** Do the
shadow run first; this can wait until after you report back.

`@xyo-network` was deliberately **not** added to this repo. The reference
implementation needs 7.x and runs TypeScript directly in another workspace, so a
version conflict or a broken install would sit in the payout path. WinLEW builds
and hashes the receipt with `node:crypto` alone; the XYO half is a separate local
service reached over HTTP, and if it is down payouts continue unattested.

```bash
GEOPROOF_RECEIPTS_ENABLED=true
PAYOUT_RECEIPT_SALT=$(openssl rand -hex 32)   # SECRET. required. see below
GEOPROOF_SERVICE_URL=                          # optional, none running yet
GEOPROOF_ANCHORING_ENABLED=false               # leave false
```

**Do not lose or rotate `PAYOUT_RECEIPT_SALT` casually.** Every receipt's
participant and wallet references are salted with it, so rotating it invalidates
all earlier receipts by design — same retention mechanism as
`PARTICIPATION_HASH_SALT`. Unset means no receipts at all rather than unsalted
ones. Back it up wherever the other secrets live.

A receipt is **evidence produced alongside a payout, never a gate on one**. It is
issued after the payout is recorded, and a failure there is logged and swallowed.

To check them:

```bash
npm run receipts:verify              # exit 1 if any record no longer matches
npm run receipts:verify -- --json    # ids and hashes only, safe to paste here
```

A mismatch means a paid record changed after the fact. If *everything* mismatches
at once, the salt changed — suspect that before suspecting the database.

Full write-up, including the privacy table and the deliberate non-signals:
`docs/participation-trust.md`.

---

## 10. First-payout provenance check (added after §9)

The owner's replacement for a holder minimum. **Any holder can earn**; what gets
checked is the first time money leaves the system *to a given Discord account*.
It answers: who funded this wallet, do they play here, do they still hold
anything, and does this look like the same person on a second wallet or a friend?

Keyed on the **account**, not the wallet — keying on the wallet would make every
new wallet a clean slate, which is the loophole itself. Runs once per person.

```bash
QUIZ_FIRST_PAYOUT_CHECK_ENABLED=true   # logs and flags; withholds nothing
QUIZ_WATCHLIST_GATE_ENABLED=false      # LEAVE FALSE until the owner reviews
QUIZ_REVIEWER_ROLE_IDS=1350888808283115630   # already the default, set it anyway
```

**A flagged first payout is still paid, in full, immediately.** There is no
switch that changes that — the owner ruled it out: making a new participant wait
days on circumstantial evidence, to catch a farmer who will just wait too, costs
every honest newcomer and stops nobody. A flag adds them to a **watchlist** that
gates their *second* payout, and that gate is what `QUIZ_WATCHLIST_GATE_ENABLED`
controls. Even then the review SLA in §11 releases it, and `!quizclear` frees it
instantly.

`QUIZ_REVIEWER_ROLE_IDS` is the server Admin role, so **all admins** can act —
not just people listed in `MOD_IDS`. Every alert pings that role and prints the
exact command to run.

In the logs:

```
[payout][provenance] <id> first payout — verdict=clear score=0 funders=1 SHADOW — settling regardless
```

**Things that look wrong and are not:**

- **A funder marked `exchange/router` produces no findings.** A wallet that has
  funded several others is infrastructure — an exchange hot wallet, a Jupiter
  router, a pump.fun curve. Being downstream of one is how people buy tokens.
  Without this the check would flag nearly every user.
- **"funded by a known participant" is weighted zero.** Someone buying their
  mate a bag is ordinary. It is recorded so a reviewer sees the relationship,
  not because it is evidence.
- **A degraded check clears.** An RPC outage or a truncated walk settles the
  payout and records the reason. "We could not check" must never become "you
  look guilty" — especially on a first payout, which lands on someone with no
  history to argue with.
- **There is no verdict worse than `review`.** The check cannot reject anybody.
  A held payout keeps its points and waits for `!quizapprove` / `!quizreject`.

New commands, open to anyone with the reviewer role:

```
!quizwatch                     everyone flagged on a first payout
!quizwatch <userId>            the evidence for one
!quizclear <userId> <note>     clear them; releases any held payout immediately
```

`!quizreview <id>` now prints the funding wallets and every finding with its
weight, so a reviewer can disagree with the machine rather than rubber-stamp it. The
channel announcement deliberately does **not** name the funding wallets — that
would tie a Discord handle to specific addresses in public.

Also fixed in the same pass: `assessRisk()` in the payout worker passed
`clusterHit: false` unconditionally, so the funding-cluster walk — the one signal
already proven against real abuse on this project, and one quiz *redemption* has
always consulted — was dead weight on the *settlement* path. It is now wired, and
fails open like the faucet's own call.

**Static upload for this section:** `quiz/index.html` (it tells users about the
first-payout check before it can ever surprise them).

---

## 11. The review queue pays out on its own if nobody reviews it

Added after §10, on the owner's objection: a hold that needs a human is
fail-CLOSED if no human turns up.

**You do not need to set any of these** — the defaults are the safe ones and the
valve is ON. They are listed so you know what the worker is doing.

```bash
QUIZ_REVIEW_SLA_HOURS=72              # default
QUIZ_REVIEW_AUTO_RELEASE_ENABLED=true # DEFAULT ON — do not turn this off
QUIZ_REVIEW_DIGEST_HOURS=24           # default
QUIZ_REVIEW_ESCALATE_HOURS=24         # default
```

A soft hold nobody reviews inside 72h is **released and paid**, and announced so
it cannot happen unnoticed. Holds linked to a banned wallet never auto-release —
they escalate instead. Nothing can auto-reject.

New log line, once per scan when anything is held:

```
[payout][review] held=2 released=1 escalated=1 waiting=0 hard=1
```

`released=` is somebody being paid without a review having happened. If you see
those regularly, that is the system telling the owner the queue is unattended —
either review them or turn enforcement back off.

**Two real bugs fixed here, both pre-existing:**

- `noteRiskAssessment()` reset `heldTs` on every re-score, so a record held for a
  week looked 45 seconds old forever. Nothing could ever age out.
- Held records were never actually parked. The comment said `nextAttemptTs = null`
  did it; `listAutoSettlementCandidates()` only skips a *future* timestamp, so
  `null` meant "settle me now" and every held payout was re-scored and
  re-announced on every scan. If the announce channel has been noisy about the
  same held record over and over, that was why.

`!quizreview` now shows how long each has been held and when it auto-releases.

---

## 12. Shadow run — NOT yet on in production

> **Correction, 2026-08-14 evening.** An earlier version of this section said the
> shadow run was enabled. It was enabled on the owner's **development** checkout,
> which does not run the backend, so production is unchanged.
>
> **See `A.i-Talks/shadow-run-enable.md`** — it has the timestamp test for
> working out whether you are on the serving machine, and the steps to follow if
> you are. Read that instead of the rest of this section.

Intended settings (apply on the SERVING machine only):

```bash
PARTICIPATION_SIGNALS_ENABLED=true
PARTICIPATION_HASH_SALT=<64 hex chars — SECRET, see below>
QUIZ_RISK_ENGINE_ENABLED=true
QUIZ_RISK_ENFORCEMENT_ENABLED=false     # still false. Nothing withholds money.
```

### ⚠️ The salt is not in this file, and must not be put in it

`PARTICIPATION_HASH_SALT` is a secret and this document is in git. **Ask the
owner for the value.** Do not paste it into any tracked file, any commit
message, or any Discord channel — `npm run scan:secrets` runs over 767 tracked
files and this would be a real finding, not a false one.

**It must be byte-identical everywhere.** Every process that hashes or reads a
hash — the web process and the payout worker, on every machine — has to share
it. Two machines with different salts see unrelated device hashes, correlate
nothing, and the risk engine quietly scores everyone clean. That failure is
silent: no error, no log line, just an engine that never finds anything. If
shadow output is suspiciously empty after a full cycle, check this first.

Rotating it deliberately breaks correlation with all older records. That is the
retention mechanism, not an accident — but do it on purpose, not by accident.

### Both processes need restarting

| Restart | Why |
|---|---|
| Node backend / web | `collectSignals()` runs on the answer route |
| quiz payout worker | the risk engine runs at settlement |

Collection happens on one and scoring on the other. Restarting only the worker
gives you an engine with nothing to score.

### What you should start seeing

```
[payout][risk] <id> band=elevated score=32 signals=shared_device SHADOW — settling regardless
```

`SHADOW — settling regardless` means it scored and **paid anyway**. Correct.
Only lines above `normal` are printed, so a quiet log means everyone scored
clean — plausible on a small user base, but see the salt warning above.

Collect a full cycle before anyone discusses `QUIZ_RISK_ENFORCEMENT_ENABLED`.
Report back: how many payouts scored above `normal`, and in what bands.
