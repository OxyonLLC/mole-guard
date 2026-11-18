# Weekly CUNT — Protocol Specification

**Status: SPECIFICATION ONLY.** No program exists. No Rust has been written,
by explicit decision — the spec, state model and invariants come first so the
rules can be attacked before anyone grows attached to an implementation.

> **Executable spec:** [`src/cunt/epoch.js`](../../src/cunt/epoch.js) is a pure,
> dependency-free reference model of everything below.
> [`test/cunt/weeklyProtocol.test.mjs`](../../test/cunt/weeklyProtocol.test.mjs)
> attacks it with the §61 Phase F list and the sybil gate — 32 tests. **Whatever the on-chain
> program eventually looks like, it must pass these.**

---

## 1. What this is, and what it is not

**Weekly CUNT** is a claim protocol. Every Tuesday an epoch opens, eligible
participants **actively claim**, and the epoch closes.

It is **not** yield, not passive income, not a promised return, and not an
investment product. Rewards are denominated in CUNT, never in "0.2 CUNT worth
of SOL" — pegging to a fiat or SOL value would require a price oracle and would
turn a participation mechanic into a payment obligation (§24).

Missing the window is not an error state. It is the product:

> **See You Next Tuesday.**

## 2. Why a program at all

The earlier plan chose Streamflow/Jupiter Lock and explicitly rejected writing
a custom program. That reasoning was sound *for what it addressed* — vesting —
and it is worth being precise about why it no longer suffices:

**Streamflow vests on a schedule. It cannot express a claim.** It has no
concept of "this wallet, this epoch, once, and only if it acts inside a
window." Every mechanic in §13–§15 needs exactly that.

So the choice is not "program vs. Streamflow." It is "a program, or no Tuesday
claims." Team vesting should still use Streamflow (§9) — that *is* a schedule,
and reusing audited software beats writing our own.

## 3. Epoch state model (§15)

Per epoch:

| Field | Type | Notes |
|---|---|---|
| `epoch_number` | u64 | monotonic, starts at 1 |
| `epoch_start` | i64 | unix seconds, **inclusive** |
| `epoch_end` | i64 | unix seconds, **exclusive** |
| `reward_budget` | u64 | base units authorized for this epoch |
| `reward_per_claim` | u64 | fixed for the epoch, bounded (§6) |
| `remaining_budget` | u64 | falls with each claim, never below zero |
| `claims_completed` | u32 | |
| `unique_claimers` | u32 | equal to `claims_completed` by construction |
| `status` | enum | `UPCOMING` → `OPEN` → `CLOSED` → `FINALIZED` |

`unique_claimers` and `claims_completed` are always equal **because** INVARIANT
5 holds. They are both kept anyway: if they ever diverge, INVARIANT 5 has been
broken, which makes the pair a cheap runtime canary. A test asserts they track.

### Status is derived from the clock, not set by an operator

`UPCOMING`/`OPEN`/`CLOSED` are computed from `epoch_start`/`epoch_end` and the
chain clock. Nobody opens or closes an epoch.

This is deliberate and matches the authority matrix (`open_epoch`,
`close_epoch` → `PROGRAM_PDA`): if a human has to open each Tuesday, a missed
press cancels everyone's week; if a human can close early, that is a
denial-of-claim power. Neither belongs to a person.

`FINALIZED` is the one transition that is an action, because it does something:
it releases unclaimed budget. It is only reachable from `CLOSED`, and only once.

## 4. Claim window (§14)

Users **actively claim**. Nothing is pushed to anyone. That choice:

- avoids paying transaction fees for wallets that never engage
- makes participation intentional and therefore measurable
- keeps `Proof of Tuesday` meaningful — a record of *acting*, not of existing

### Timezone — NOT DECIDED

§14 forbids choosing without approval. The three candidates:

| Option | Window | Trade-off |
|---|---|---|
| **UTC Tuesday** | 00:00–23:59:59 UTC Tue | Unambiguous, verifiable, trivially checkable. Falls on Monday afternoon in US Pacific and Wednesday morning in Auckland. |
| **Project timezone** | Tuesday in a fixed offset | Feels right for the core community. Introduces DST, which is a genuine source of off-by-one-hour bugs. |
| **Rolling 24h** | Any 24h period containing Tuesday | Most forgiving. Weakest identity — "Tuesday" stops being a specific thing. |

**Recommendation: UTC Tuesday.** DST is the reason. A protocol whose claim
window shifts by an hour twice a year, differently in each hemisphere, is one
whose users will miss claims through no fault of their own — and "See You Next
Tuesday" should be a joke, not a support burden.

### Boundary semantics

Start **inclusive**, end **exclusive** — `[start, end)`. Asserted by test at
all four boundary seconds. This removes any question about the final second.

### Clock drift is assumed, and bounded

Solana's `unix_timestamp` can drift from wall-clock by minutes. The protocol
therefore must never depend on second-level precision at the edge. A 24-hour
window means plausible drift moves the boundary slightly and **never moves a
whole epoch**. A test asserts the window is much larger than a 15-minute drift
tolerance, so nobody can later shorten it to something unsafe.

## 5. PDA architecture (§17)

| PDA | Seeds | Purpose |
|---|---|---|
| Global state | `["state"]` | config, current epoch pointer, bounds |
| Epoch | `["epoch", epoch_number as u64 LE]` | the table in §3 |
| Vault authority | `["vault"]` | signs transfers out of the reward vault |
| Registration | `["reg", wallet pubkey]` | wallet → hashed identity |
| Identity record | `["ident", identity_hash]` | stops one identity binding two wallets |
| Claim record | `["claim", epoch_number as u64 LE, identity_hash]` | **existence = claimed** |

Vanity keypairs are **not** PDAs (§2B). `WhPApnQQ…aNCUNT` is a reserved
identity for branding; the infrastructure above is deterministic and keyless.

### The claim record is the double-claim guard

There is no list to scan and no flag to check. The ClaimRecord PDA is
initialized as part of claiming, and **initializing an account that already
exists fails in the runtime** before program logic runs.

That makes INVARIANT 5 total rather than something we have to remember to
enforce, and it costs one account's rent per claim.

### ⚠ Seed encoding must be fixed-width

Solana concatenates PDA seeds **without separators**. With variable-length
seeds, `("ab", "c")` and `("a", "bc")` derive the *same* address — a real
vulnerability class, not a hypothetical.

So `epoch_number` is seeded as a **fixed 8-byte little-endian u64**, the wallet
as its **fixed 32-byte pubkey**, and `identity_hash` as a **fixed 32-byte
digest**. Never as decimal strings. The
reference model tests the equivalent property (prefixes, superstrings, and a
claimant containing the separator must not alias another claimant), but the
model's `:`-delimited string keys are *safe only because* the epoch is
constrained to an integer — the on-chain version has no such luxury and must
use fixed widths.

## 6. The reward vault (§16)

```
Community CUNT treasury
        │  approved funding  (multisig — human authorised)
        ▼
Tuesday Reward Vault PDA
        │  protocol-enforced claims only
        ▼
Eligible participants
```

**Funding in is human-authorised. Funding out does not exist.**

That asymmetry is the whole design. Adding to the vault can only ever increase
what participants can claim, so it is safe for a multisig to do. Removing is
the dangerous direction — so there is **no instruction that removes tokens
except by a valid claim**. Not multisig-gated. Absent.

> Worth being explicit about why "safe for a multisig to do" is a real claim
> here and not elsewhere in this document: it holds **regardless of who holds
> the keys**. Even a multisig entirely controlled by one person cannot use
> `fund_tuesday_vault` to take anything, because the instruction only moves
> tokens *in*. Compare `register_participant` in §9, where the same multisig
> buys much less.

A test asserts the reference module exports nothing matching
`withdraw|drain|sweep|rescue|emergency`. If someone adds one, the build fails
and they have to argue for it in a diff.

Same for claim history: nothing may edit or erase a claim record (§37).
Proof of Tuesday is worthless if it is editable.

### `reward_per_claim` must be bounded

Adjustable only within limits fixed at deployment (§37). An unbounded setter is
equivalent to draining the vault slowly, and would make everything above
decorative.

## 7. Invariants

| # | Invariant | Enforcement |
|---|---|---|
| **5** | One claim per identity per epoch | ClaimRecord PDA existence — runtime-enforced |
| **6** | An epoch never distributes more than `reward_budget` | `remaining_budget` checked **before** any mutation, `checked_sub` |

Both are checked before any state is written, so **a rejected claim mutates
nothing**. Partial mutation ahead of a failed check is how phantom claim
records and double-spends happen; a test drives four different rejection paths
and asserts vault, budget, counters and claim set are all untouched.

The vault balance is a **separate** constraint from the epoch budget: an epoch
may be authorized to pay more than the vault holds. That fails as
`VAULT_INSUFFICIENT`, distinctly from `BUDGET_EXHAUSTED`, because they are
different operational problems — one means "fund the vault", the other means
"this epoch is done."

## 8. Reward model — first-come-first-served, and its cost

The §15 fields (`reward_per_claim`, `remaining_budget`) describe a **fixed
reward, first-come-first-served** model: each claim pays the same amount until
the budget runs out.

It is simple, the claim is instant, and the arithmetic is checkable by anyone.
It has one real cost worth stating plainly:

> **If demand exceeds budget, it is a race.** Late claimants in a popular epoch
> get `BUDGET_EXHAUSTED`, and the winners are decided by transaction timing —
> which favours whoever is watching, automated, or paying priority fees.

That sits awkwardly beside *Proof of Tuesday > Proof of Wealth*.

The alternative is **claim-to-register, distribute pro-rata at finalize**: the
window records participants, and the budget divides among them at close.
Nobody races, everyone who showed up gets a share, and the share is only known
afterwards. It costs a second transaction and delays the reward.

**Not decided.** The honest framing is that FCFS optimises for simplicity and
pro-rata optimises for fairness, and the project's stated culture points at
fairness. Worth deciding deliberately rather than by inheriting §15's field
list.

## 9. Sybil resistance — DECIDED: verified wallets only

**Decision, 2026-08-08: only registered, verified wallets may claim.**

### The obvious reading of this decision is wrong

"Only verified wallets can claim" sounds like it means *prove you own the key*.
It cannot mean that, because:

> **Signing the claim transaction already proves you own the key.**

Every Solana transaction is signed. A sybil operator running 100 wallets
legitimately controls all 100 keys and would pass a key-ownership check 100
times. Key ownership proves *control*, not *uniqueness*, and only uniqueness
resists sybils.

### What actually does the work

The gate is the **binding of a wallet to something costlier to mass-produce
than a keypair**. For this project that is a Discord identity —
`wallet_links.json` is keyed by Discord user ID, so verification proves *"this
person's Discord account controls this wallet"*, not merely *"someone controls
this wallet"*.

Enforced as a 1:1 binding:

- one wallet may bind one identity
- **one identity may bind one wallet**

That second rule is the entire gate. Without it a single verified person
registers 100 wallets and nothing has been achieved.

Claim records are keyed by **identity**, not wallet. Today those are equivalent
under the 1:1 rule — this is defence in depth. If the binding is ever relaxed
(to allow rotating a compromised wallet, say), wallet-keyed records would
silently grant a second claim; identity-keyed records do not. A test pins this.

### What it costs

**A chain cannot see Discord.** So the binding must be attested on-chain by a
registration authority, and that authority is a genuinely new trust assumption:

> **Whoever can register decides who can claim.**

It cannot mint, move or steal. But it can **exclude** a real participant, and it
can **admit a sybil** by registering fabricated identities. The second is
silent, which makes it the one that matters. It is recorded as its own row in
the authority matrix (`register_participant`, `MULTISIG`) rather than buried
inside "eligibility", and the registry must be publicly auditable so an
implausible burst of registrations is visible.

Identities are stored **hashed**. A public on-chain registry of plaintext
Discord IDs would deanonymise every participant.

### The uncomfortable number

As of 2026-08-08, **5 wallets have ever completed verification** —
`wallet_links.json` holds 7 entries but only 5 are `source: verified-default`;
the other 2 are `manual-register`, which proves nothing.

Against 155 registrations, **gating on verification today would exclude about
97% of registrants.**

That is not an argument against the decision — it is an argument that
**verification has to be made easy and promoted well before the first Tuesday**,
or the first epoch will have five participants. The gate is right; the funnel
in front of it is currently the bottleneck, and it is a product problem rather
than a protocol one.

### What this does not solve

A determined attacker with 100 Discord accounts still gets 100 claims. This
raises the cost of a sybil from *free* to *the cost of aged, verifiable Discord
accounts*. That is a real improvement and not a solution, and the protocol
should never claim otherwise.

### The registration authority is multisig, and that means less than it sounds

`register_participant` resolves to `MULTISIG` in the authority matrix, and as of
2026-08-09 that multisig has three real, possession-proven keys. It is easy to
read that as *"admitting a sybil now requires two people to agree."*

**It does not.** `control_model` is `KEY_SECURITY_ONLY` and
`independent_signers` is **0** — all three keys are held by one person. Two
signatures from one human is one decision, made twice.

So the multisig protects the registration authority against **key theft and
device compromise**, which is worth having. It does **not** make sybil admission
accountable to anyone, and §43 forbids implying otherwise. The honest sentence
is:

> Registrations are gated by a key the project controls. The multisig means that
> key is hard to steal — not that admissions are reviewed.

Auditability has to come from somewhere else: a **publicly readable registration
registry**, where anyone can count admissions and spot a burst. That is the real
check, it is a §60 gate item, and it is still unbuilt.

## 10. Attack surface — Phase F

Covered by the reference tests:

| Attack | Result |
|---|---|
| Double claim / replay | `ALREADY_CLAIMED`, counters unmoved |
| Early claim | `BEFORE_WINDOW` |
| Late claim | `AFTER_WINDOW` |
| Claim on finalized epoch | `NOT_OPEN` |
| Budget exhaustion | `BUDGET_EXHAUSTED`, budget floors at ≥ 0 |
| Vault overdraw | `VAULT_INSUFFICIENT`, vault floors at ≥ 0 |
| Underflow | refused before mutation, never wraps |
| Overflow / precision | BigInt; 10¹⁸ base units exact, floats rejected outright |
| PDA / key substitution | prefixes, superstrings, cross-epoch and separator-injection all rejected |
| Unauthorized signer | `NOT_ELIGIBLE` before any payment |
| Duplicate epoch creation | rejected — recreating would reset the budget and let everyone claim again |
| Impossible epoch config | zero/negative/inverted windows and `reward_per_claim > budget` all rejected |
| Vault withdrawal instruction | asserted **not to exist** |
| Claim-history edit | asserted **not to exist** |

**Cannot be modelled off-chain**, and must be tested against a real program on
devnet: wrong-mint token accounts, fake/spoofed token accounts, missing signer
checks, account-ownership confusions, rent-exemption failures, compute-budget
exhaustion mid-claim, and CPI reentrancy. These are Solana-runtime concerns; a
JavaScript model cannot prove anything about them and should not pretend to.

## 11. Open decisions

1. ~~Sybil resistance~~ — **decided 2026-08-08**: verified wallets only (§9).
   Follow-on: how verification gets promoted, since the eligible base is 5.
2. **Timezone** (§4) — recommendation is UTC; needs approval.
3. **Reward model** (§8) — FCFS or pro-rata.
4. **Bounds on `reward_per_claim`** — what range, fixed at deployment.
5. **Epoch duration** — a full 24h Tuesday, or a shorter window inside it.
6. **What funds the vault, and how often** — per-epoch top-up or a larger
   authorization drawn down over time.
7. ~~Who holds the registration authority~~ — **the 2-of-3, whose keys now
   exist and are possession-proven.** Still open, and now the more important
   half: **how registrations are audited.** With `independent_signers: 0` the
   multisig is theft resistance, not review (§9) — so the public registry is
   the only thing that would make admissions checkable.
8. Whether unclaimed budget returns to the treasury or rolls into the next
   epoch. The model currently releases it; rolling it forward would make late
   Tuesdays richer than early ones, which may be desirable or may be a
   whale-timing incentive.
