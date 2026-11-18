# Proof of Tuesday

> **PROOF OF TUESDAY > PROOF OF WEALTH**

**Status: SPECIFICATION.** Derived, not deployed. No token, no NFT, no voting
weight.

> **Executable spec:** [`src/cunt/proofOfTuesday.js`](../../src/cunt/proofOfTuesday.js),
> attacked by [`test/cunt/proofOfTuesday.test.mjs`](../../test/cunt/proofOfTuesday.test.mjs)
> — 12 tests, including the three streak edge cases that are easy to get wrong
> and embarrassing in public.

---

## 1. The one property that matters

**Nothing is stored.**

Every figure below is computed from claim records that already exist on chain.
There is no Proof of Tuesday account, no balance, no counter that anyone writes
to.

That is not a performance choice, it is the security model:

- There is nothing to **forge** — the inputs are claim records, and a claim
  record only exists because someone claimed.
- There is nothing to **edit** — §37 forbids an instruction that edits claim
  history, and deriving the record means such an instruction would have nothing
  to point at.
- There is nothing an **authority can adjust**. No row in the authority matrix
  touches it, because there is no state to touch.

A stored Proof of Tuesday would need a writer, a writer needs an authority, and
that authority could quietly rewrite anyone's history. Derivation removes the
question.

It also decides where this runs: **off chain** (§29 — the chain enforces, the
bot and website report). Scanning every epoch for one identity is trivial in an
indexer and wasteful in a program, and nothing depends on the answer being
available on-chain — no reward, no gate, no weight.

## 2. Metrics (§35)

Keyed by **identity**, not wallet.

| Field | Meaning |
|---|---|
| `firstEpoch` | first Tuesday they ever claimed |
| `totalEligibleEpochs` | Tuesdays they could have claimed |
| `totalClaimedEpochs` | Tuesdays they did |
| `missedEpochs` | eligible, closed, unclaimed |
| `currentStreak` | consecutive Tuesdays up to now |
| `longestStreak` | best run ever |
| `totalClaimed` | CUNT received (BigInt) |
| `pendingEpoch` | an open Tuesday not yet claimed, if any |

### Why identity, not wallet

A rotated wallet keeps its history, and a second wallet cannot fork a clean
second record. Wallet-keyed history would reset on rotation — punishing someone
who did the right thing after a compromise — and would let anyone start over.
A test pins this.

## 3. The three edge cases

These are where a naive implementation gets it wrong.

### 3.1 An open Tuesday does not break a streak

It is Tuesday afternoon. You claimed the last four weeks and have not claimed
yet today. Your streak reads **4**, not 0.

An open, unclaimed epoch is **pending**, not missed. Breaking a streak while
the window is still running would be wrong on the merits, and it would also
make the number flap for anyone watching live. It becomes a miss only when the
epoch **closes** unclaimed.

### 3.2 Joining late costs you nothing

Register at epoch 50 and your record shows **zero** missed Tuesdays, not 49. An
epoch only counts as eligible if you had registered before it ended.

Showing someone 49 missed Tuesdays for the period before they arrived would be
a fabricated bad record, and it would discourage exactly the people the project
wants.

Registering **mid-epoch** still makes that epoch eligible — there was time left
to claim, so it counts.

### 3.3 The current streak counts back from the most recent *resolved* epoch

Computed backwards, skipping a pending epoch without extending or breaking, and
stopping at the first resolved-and-unclaimed one.

## 4. This must never be a transferable token

§35 says Proof of Tuesday is "NOT necessarily a token or NFT." It is stronger
than that:

> **A transferable Proof of Tuesday would destroy Proof of Tuesday.**

If a 52-week streak can be minted as an NFT, it can be **sold**. The moment it
is purchasable, the most decorated participant is whoever paid the most —
which is Proof of Wealth wearing the costume of Proof of Tuesday. The one thing
this concept exists to resist would have been rebuilt inside it.

If it is ever tokenised, it must be **non-transferable** (soulbound), and even
then the derived record stays canonical and the token stays decorative.

Deriving rather than minting sidesteps the whole question, which is the main
argument for doing it this way.

## 5. What this resists, and what it does not

**Resists:** buying rank. You cannot purchase a past Tuesday. Holding ten
million CUNT earns exactly as many Tuesdays as holding zero — a test asserts a
whale who showed up twice ranks below a regular who showed up ten times.

**Does not resist:**

- **Multiple identities.** 100 verified Discord accounts still yield 100
  parallel records. Identity gating raised the cost of a sybil from free to the
  cost of aged, verifiable accounts. That is an improvement, not a solution,
  and this document does not pretend otherwise.
- **Automation.** A script that claims every Tuesday builds a perfect streak
  with no human attention at all. Proof of Tuesday measures *a claim landing*,
  not *a person caring*. Nothing on chain can tell those apart.
- **The project itself.** Below — the one that matters most here.

### You cannot buy rank. The project can grant it.

Easy to miss, because §5's headline is the reassuring half.

Every record on this board begins with a **registration**, and
`register_participant` is held by the project. So while no amount of CUNT buys a
past Tuesday, the registration authority can admit identities that then accrue
histories legitimately, indistinguishably and forever. The record being
*derived* and *unforgeable* works exactly as well for a manufactured participant
as a real one — those properties protect the record's integrity, not its
provenance.

**A multisig does not fix this.** `register_participant` resolves to `MULTISIG`,
which reads like a check on admissions and is not one: `independent_signers` is
**0**, so two signatures are one person signing twice. The multisig makes that
key hard to *steal*; it does not make admissions *reviewed*. See
`CUNT-WEEKLY-PROTOCOL.md` §9.

This lands harder here than on the token, because the token never claimed to be
unbuyable and **this board's entire proposition is that rank must be earned week
by week.** A leaderboard whose issuer can seed it is measuring the issuer.

**The only real check is a publicly readable registration registry** — every
admission visible, so anyone can count them, date them, and notice a burst of
new identities appearing shortly before a snapshot. It is a §60 gate item and it
is **not built**.

Until it is, this document must not be cited as evidence that participation was
organic. It is evidence that claims were *made* — a smaller and more honest
claim.

### And it has its own bias

Proof of Tuesday rewards **availability**. Availability is not evenly
distributed: night shifts, unreliable connectivity, an awkward timezone, or a
week in hospital all cost streaks, and none of them reflect commitment.

So this is not a bias-free measure — it is a *different* bias from wealth. That
is worth stating plainly rather than letting "Proof of Tuesday > Proof of
Wealth" imply a fairness it does not have. A 24-hour window is the main
mitigation, and is one more reason not to shorten it.

## 6. The leaderboard

Ranked by Tuesdays claimed, ties broken by longest streak, then by who arrived
earlier — so being early and consistent beats arriving late and claiming hard.

Two deliberate omissions:

- **No balances.** A participation board that also prints holdings quietly
  becomes a rich list. A test asserts no balance, holdings or wallet field is
  exposed.
- **Non-participants are absent, not ranked last.** A board listing everyone
  who never claimed is a user list, not a leaderboard.

## 7. Not voting weight

§35: *"Do not implement voting weight based on this without separate review."*

**It has not been implemented, and should not be without that review.** The
reason is §5: a streak is automatable and multipliable across identities.
Governance weight derived from it would be governance weight derived from
running a cron job on N Discord accounts — strictly worse than the token-based
weighting it would replace, because it would *look* more egalitarian while
being easier to game.

Proof of Tuesday is a **cultural** artifact. Let it stay one until someone has
a concrete argument for more.

## 8. Open questions

1. Whether to surface it on-chain at all, or leave it entirely to the indexer.
   Derivation says indexer; a future mechanic that needs it in a program would
   change that.
2. Whether a soulbound token is ever worth minting for display.
3. Whether streaks should have any grace mechanic (one "skip" per N Tuesdays).
   It would soften §5's availability bias and would also make streaks less
   meaningful. Not decided; deliberately not built.
4. What the public leaderboard shows, given identities are hashes — a display
   name has to come from somewhere, and pulling Discord names back in
   re-introduces the deanonymisation problem hashing was meant to avoid.
5. **Whether the leaderboard should ship before the registration registry
   does.** §5 says a board whose issuer can seed it is measuring the issuer, and
   the registry is what makes that checkable. Shipping the board first is the
   more tempting order and the less honest one.
