# CUNT Tokenomics

**Status: INCUBATION.** Nothing here is deployed. No token exists on Solana.

> **The numbers in this document are not authored here.** They are read from
> [`cunt-project.json`](../../cunt-project.json), the canonical manifest (§48),
> and `test/cunt/tokenomicsInvariants.test.mjs` fails the build if this document
> and the manifest disagree. §27 asks for one source of truth; this is how that
> is enforced rather than merely intended.

---

## 1. Supply

**Total supply: 1,000,000,000 $CUNT** — one billion.

The round number is deliberate: it makes percentages checkable in your head.

| Share | Tokens |
|---|---|
| 1% | 10,000,000 |
| 5% | 50,000,000 |
| 10% | 100,000,000 |
| 80% | 800,000,000 |

**Decimals: not yet decided.** 6 would match $WinLEW, but the spec does not
state it, so it is not invented here (§65). It is `null` in the manifest.

> **Supply does not establish value.** A billion of something is not worth more
> than a million of something else. The opening price is set by the ratio of
> tokens to SOL in the liquidity pool, not by the supply number — see
> `CUNT-LIQUIDITY-POLICY.md` when written (§11).

## 2. Genesis allocation

| Bucket | Tokens | Share |
|---|---|---|
| **Community** | 800,000,000 | 80% |
| **Team** | 100,000,000 | 10% |
| **Market / Liquidity** | 100,000,000 | 10% |
| **Total** | **1,000,000,000** | **100%** |

### Team means team

The 10% team allocation is the **entire** team economic allocation. Not 10%
plus a marketing wallet, plus an operations wallet, plus a founder reserve.

**Maximum team allocation: 100,000,000 CUNT. No more.** This is asserted as
INVARIANT 2 and no code path may exceed it.

### 80% community does not mean 800M on day one

The community allocation is **released progressively** (§3 below). "Released"
means *authorized for use under approved community mechanisms* — not sent to
wallets, not dumped into circulation.

### What changed, and why (§55)

On 2026-08-07 the third 10% bucket was recorded as **protocol-locked**: a
community-owned permanent floor, which made the community share **90%**.

On 2026-08-08 it became **market / liquidity**, moving the community share to
**80%**. Both models are defensible, and this one is arguably more honest —
liquidity has to come from somewhere, and calling project-controlled liquidity
"community" would be exactly the relabelling §43 forbids.

This is recorded because it changes a stated number. The manifest carries the
same history in `$allocation_history`.

## 3. Community release model

800,000,000 released across four stages:

| Stage | Released | Cumulative | Remaining reserve |
|---|---|---|---|
| **BELLY** | 300,000,000 | 300,000,000 | 500,000,000 |
| **CRAWL** | +200,000,000 | 500,000,000 | 300,000,000 |
| **RUN** | +200,000,000 | 700,000,000 | 100,000,000 |
| **FINAL TUESDAY** | +100,000,000 | 800,000,000 | 0 |

`300M + 200M + 200M + 100M = 800M` — exactly the community bucket, and
**nothing else**. In particular these stages draw **only** from the 800M
community allocation. They are not liquidity, and the Market/Liquidity bucket
is untouched by them (§63 explicitly warns about confusing the two; INVARIANT 3
enforces it).

### Triggers are deliberately undefined

Every `trigger` in the manifest is `null`.

A release must **not** fire because "300M tokens were sold" — that is trivially
gameable by wash trading, circular transfers and self-dealing. §8 lists the
signals a real controller should weigh (remaining reserve, unique participants,
elapsed time, genuine participation, claim history, distribution limits,
governance, liquidity health), and requires a simulation before any of them is
chosen.

**No trigger rules are final. None are implemented.**

## 4. Team vesting

| Tranche | Tokens | Share | Trigger |
|---|---|---|---|
| First | 50,000,000 | 5% | not decided |
| Second | 50,000,000 | 5% | not decided |
| **Total** | **100,000,000** | **10%** | |

The second tranche must **not** unlock because price, volume or market cap
went up (§9). Preference is for time-based vesting, protocol maturity, or
predefined objective milestones.

The team allocation must be transparently visible, and must never be split
across anonymous wallets to manufacture the appearance of wider ownership
(§43).

## 5. Market / liquidity

100,000,000 CUNT, separate from the community allocation.

No pool exists. No pool will be created during this sprint (§10, §12). Current
architectural leaning is a **single primary venue at birth** (Raydium the
likely candidate) rather than splitting 50/50 across Raydium and Orca —
deeper liquidity, clearer price discovery, less fragmentation, simpler
transparency. Orca may follow later. **Not final.**

## 6. Invariants

Enforced by `test/cunt/tokenomicsInvariants.test.mjs`:

| # | Invariant | Enforced |
|---|---|---|
| 1 | community + team + market = total supply | ✅ test |
| 2 | team never exceeds 100,000,000 | ✅ test |
| 3 | community releases never exceed 800,000,000 | ✅ test |
| 4 | market allocation never exceeds 100,000,000 | ✅ test |
| 5 | one claim per identity per epoch | ⏳ protocol — see `CUNT-WEEKLY-PROTOCOL.md` |
| 6 | vault cannot exceed its epoch budget | ⏳ protocol — see `CUNT-WEEKLY-PROTOCOL.md` |
| 7 | project addresses are never counted as independent holders | ✅ partial (disclosure) + ⏳ analytics |

Invariants 5 and 6 govern on-chain behaviour that does not exist yet. They are
listed rather than silently dropped so the numbering stays aligned with §42 and
so the gap is visible.

## 7. Project-controlled addresses

Disclosed per §19. Both are reserved vanity identities; neither holds anything.

| Address | Role | Custody today | End state |
|---|---|---|---|
| `WhPApnQQXf33cJsfboHAijwQqSmfhLAudeBm4aNCUNT` | Weekly CUNT (reserved) | single key | role undecided |
| `13CrW3Tc2mCxyxYo86qQTcPGUYqrGbYiFF4TpvX3CUNT` | Community CUNT Treasury (reserved) | single key | **token account owned by a 2-of-3** |

### How the 800M will actually be held (decided 2026-08-09)

Single-key custody of the treasury was a **MEDIUM finding**. It is now closed in
design — and how it closed is worth stating, because the obvious route did not
exist.

**"Migrate it to a multisig later" is unavailable for a vanity address.**
Migrating means moving the tokens to a *different* address, which throws the
vanity away. And a ground key can never live on a hardware wallet — it is a
software keyfile by construction. So the finding could not be closed by holding
that key more carefully.

**Instead the key is made irrelevant.** The treasury is an SPL **token account
created at that address** whose `owner` is a 2-of-3 multisig. The vanity keypair
signs `createAccount` once and can never authorise anything again — exactly like
a mint keypair after `InitializeMint`.

Verified on a local validator: the vanity key attempting to spend is rejected
with `Error: owner does not match` (`0x4`); one of three signers is rejected
with `MissingRequiredSignature`; two of three succeed.

Two consequences that matter for tokenomics specifically:

- **That address can hold `$CUNT` and nothing else.** A token account is
  mint-specific — no SOL, no other tokens. Anything else the project holds needs
  a different address.
- **It is not an ATA.** Senders must use the literal address; anything deriving
  an associated token account from the multisig computes a different one.

The 2-of-3's three keys exist and are possession-proven. **The multisig account
itself does not exist yet** — creating it is a §61-gated mainnet action, which
is why `custody today` above still honestly reads *single key*.

### Burning

There is **no burn address, and no key for one.** Supply is reduced with the SPL
`burn` instruction, authorised by the multisig, executed directly from the
treasury — which permanently reduces the mint's total supply and is checkable
with `getTokenSupply`.

This follows WinLEW's own hard-won distinction (`docs/burn-program.md` §4): a
burn *wallet* is just a wallet, and tokens sitting in one are **still part of
total supply**. Burning from the treasury leaves no "is it actually burned?"
ambiguity to explain later.

**No burn amount, schedule or commitment exists.** This records a mechanism, not
a plan — any actual burn is a separate decision requiring explicit approval, on
the same terms WinLEW's burn program already follows.

The official mint (`wen…CUNT` / `Wen…CUNT`) has **not been found**. Its
manifest address is `null`, and it must stay `null` until a real mint exists —
never a placeholder.

## 8. The other CUNT

There is an earlier $CUNT on **Base**: `0x555cc44a50f228da3a48ea8b8ab0d4831bff0804`.

It is retired, it is **not** this token, and it is documented rather than
hidden — transparency is part of the joke (§1).

- **THE FIRST CUNT** — Base. Created drunk.
- **THE SECOND CUNT** — Solana. Engineered sober.

## 9. What this document does not promise

$CUNT is not an investment, and nothing here is a promise of return,
appreciation, income or listing. Community release mechanics are participation
mechanics, not yield. See §52 for the communication guardrails this project
holds itself to.
