# Testnet Plan (§40, §61 Phase F)

> §40: *"EVERY protocol mechanic must run on testnet/devnet before mainnet."*
> §40: *"No mainnet deployment during this sprint."*

**Almost nothing here has been executed.** This is the plan for when a program
exists; none does yet, by the specify-only decision.

**The exception is most of Phase 4, run on 2026-08-09** — and not on devnet.
See §2a: devnet's faucet was unavailable, and the substitution turned out to be
an improvement rather than a compromise.

---

## 1. What is already proven, and what devnet is actually for

A large part of §40's list is **already tested**, off-chain, against the
reference model in `src/cunt/epoch.js` — 32 tests, run on every push.

| §40 mechanic | Status |
|---|---|
| Tuesday opening / claim | ✅ modelled and tested |
| Double claim, replay | ✅ tested |
| Claim after closing / before opening | ✅ tested |
| Exhausted reward vault | ✅ tested (budget and vault as separate constraints) |
| New epoch, finalize | ✅ tested |
| Overflow / underflow | ✅ tested (BigInt, 10¹⁸ exact) |
| Clock boundaries | ✅ tested, inclusive/exclusive pinned |
| Duplicate registration | ✅ tested |
| Unauthorized signer / sybil gate | ✅ tested |
| Community release triggers | ✅ simulated (`releaseSim.js`) |

**Devnet is not for re-testing those.** It is for the class of failure a
JavaScript model *cannot* express, because they are properties of the Solana
runtime rather than of our logic:

| Only provable on-chain | Why the model cannot reach it |
|---|---|
| **Wrong-mint token account** | The model has no mints. A program that forgets to check a token account's mint accepts any token. |
| **Fake / spoofed accounts** | The model passes objects; a program is passed *addresses* an attacker chooses. |
| **Missing signer checks** | The model has no signatures. `is_signer` omissions are the classic Solana bug. |
| **Account-ownership confusion** | Passing an account owned by the wrong program. |
| **PDA substitution, for real** | The model tests key collisions; on-chain the risk is seed derivation and bump handling. |
| **Rent exemption** | An account below rent-exempt minimum gets reaped. 0.00203928 SOL per token account — verified on devnet today. |
| **Compute budget exhaustion** | A claim that runs out of compute mid-instruction. No analogue off-chain. |
| **CPI reentrancy** | Cross-program invocation. Does not exist in the model. |
| **Transaction size limits** | Account lists have a hard cap. |

That distinction is the point of this document: **devnet time should be spent
on the second table, not the first.**

## 2. Devnet is reachable and behaves — verified

Checked 2026-08-08:

```
devnet solana-core        4.2.0-rc.0
current slot              482,215,960
epoch                     1116  (432,000 slots)
rent-exempt, token acct   0.00203928 SOL   — identical to mainnet
```

## 2a. A local validator was used instead — and it is closer to mainnet

When Phase 4's multisig work actually ran (2026-08-09), **devnet was not
usable**: its public faucet returned `429` repeatedly and Alchemy's devnet
endpoint returned `403`. Without an airdrop there is no payer, and without a
payer there is no test.

`solana-test-validator` was used instead. That is not a downgrade:

```
local validator   4.1.1
mainnet-beta      4.1.0
devnet            4.2.0-rc.0     <- a release CANDIDATE, ahead of mainnet
```

**Devnet runs software mainnet has not shipped.** For anything whose behaviour
might change between releases — and SPL Token instruction semantics are exactly
that — the local validator is the *better* reference, because it is one patch
release from what mainnet actually runs.

What a local validator does **not** give you is in §5 and still applies: no
congestion, no real fee market, no other people's transactions, no unmodified
mainnet program set. It is a correctness environment, not a conditions one.

Throwaway keys throughout, never printed, ledger destroyed afterwards.

### ⚠ Devnet is not mainnet

| | mainnet | devnet |
|---|---|---|
| `solana-core` | **4.1.0** | **4.2.0-rc.0** |

**Devnet runs a release candidate that is ahead of mainnet.** So devnet can
exhibit behaviour mainnet does not yet have — and, more dangerously, can
*accept* something a mainnet validator would reject.

Devnet proves a program is **wrong**. It cannot prove it is **right**.

Other differences that matter:

- **Congestion is unrepresentative.** Devnet is usually idle; mainnet drops
  transactions. Retry and confirmation handling will look fine on devnet and
  fail in production. (`src/faucet/faucet.js`'s `confirmSignatureByPolling`
  exists because of exactly this.)
- **Free SOL** via `solana airdrop`, rate-limited — enough for testing, and it
  means cost is not a reason to skip anything.
- **No real users, no real liquidity, no MEV.**
- Devnet state is periodically reset. Treat every deployment as disposable.

## 3. Sequence

Each phase must pass before the next begins.

### Phase 1 — genesis allocation

- Create the mint with **6 decimals** (matching WinLEW unless decided otherwise)
- Mint exactly **1,000,000,000** to a treasury test wallet
- Verify total supply on-chain equals the manifest **exactly**
- Split 800M / 100M / 100M and verify each balance
- **Revoke mint authority**, then attempt to mint again and confirm it fails
- Set freeze authority to `None` at creation; confirm freezing is impossible

The revocation test is the one that matters — a policy that says "we revoked
it" is worth nothing until minting has been *attempted and refused*.

### Phase 2 — the program, happy path

Deploy, then: open an epoch, register a participant, claim, finalize.
Confirm `claims_completed`, `unique_claimers` and `remaining_budget` match the
model's predictions for identical inputs. **The model is the oracle** — a
divergence means one of them is wrong, and finding out which is the work.

### Phase 3 — Phase F, on-chain

Every attack, executed as a real transaction:

| Attack | Expected |
|---|---|
| Claim twice, same epoch | second fails — ClaimRecord PDA already exists |
| Claim before / after the window | rejected |
| Claim from an unregistered wallet | rejected |
| Register two wallets to one identity | second rejected |
| Claim with a **wrong-mint** token account | rejected |
| Claim with an account owned by the **wrong program** | rejected |
| Claim without a **signature** from the claimant | rejected |
| Claim with a **substituted PDA** (wrong seeds/bump) | rejected |
| Withdraw from the vault directly | **no such instruction exists** |
| Edit a claim record | **no such instruction exists** |
| Release a tranche without authority | rejected |
| Access team vesting early | rejected |
| Drain the treasury with a non-signer | rejected |
| Exhaust the epoch budget, then claim | rejected, budget floors at 0 |
| Replay a successful claim transaction | rejected |

The two "no such instruction" rows are verified by **inspecting the deployed
IDL**, not by calling something — absence is the property.

### Phase 4 — multisig and authorities — MOSTLY DONE 2026-08-09

Seven authority-matrix rows assume a multisig. Run on a local validator (§2a),
with the **program logs read** rather than a generic failure accepted:

| Step | Result |
|---|---|
| Create the multisig; verify M-of-N enforces M | ✅ `m=2`, `n=3`, initialized |
| **M−1 signatures must fail** | ✅ **REJECTED** — `Error: MissingRequiredSignature` |
| M signatures succeed | ✅ accepted |
| A *different* pair also succeeds | ✅ any two work, not only the first two |
| Transfer the treasury designation, verify the old key is powerless | ✅ token account at the vanity address, `owner` = multisig; **the vanity key cannot spend** — `Error: owner does not match` (`0x4`) |
| Revoke mint authority, then attempt to mint | ✅ **REJECTED** |
| **Bonus: attempt to change the signer set** | ✅ **REJECTED** — `account or token already in use` (`0x6`). There is no add/remove/replace instruction; rotation means a new multisig. |

Two steps remain, both needing things that do not exist yet:

- Fund the reward vault through it — no vault, no program
- Exercise the pause and confirm it halts **new claims only** — no program
- Rehearse an upgrade-authority transfer — no program to upgrade

**§60's exit criterion for this phase was a failed M−1 attempt. That is met.**

What is still *not* proven: **our** multisig. The mechanism enforces; the
account has never been created on any network. `multisig_tested` stays
`partial` for exactly that reason.

> The signer keys, by contrast, now exist and are all possession-proven — see
> `CUNT-KEY-CEREMONY.md`. That was not a devnet activity at all: it needed
> three physical devices and produced findings no test network could have
> surfaced.

### Phase 5 — adversarial

Attack it as if someone else wrote it (§61 Phase H). Time-shift epochs, run
concurrent claims from many wallets, drive the vault to exactly zero, submit
oversized transactions, and try to make `claims_completed` and
`unique_claimers` diverge — if they ever do, invariant 5 has broken.

### Phase 6 — integration

Point the bot and `/cunt/transparency/` at devnet. Confirm every published
number is read from chain and that the site and the chain agree. **If they
disagree, the chain wins** (§64) and the display is the bug.

## 4. Exit criteria

Devnet is complete when:

1. Every Phase 3 attack has been **executed and rejected** — not reasoned about
2. The program's behaviour matches the reference model on identical inputs
3. Supply accounting matches `cunt-project.json` exactly
4. ✅ Mint authority revocation is verified by a **failed mint attempt** —
   done 2026-08-08, though it must be re-done against the real mint
5. Freeze authority is `None`, verified by a **failed freeze attempt**
6. ✅ The multisig enforces M-of-N, verified by a **failed M−1 attempt** —
   done, `MissingRequiredSignature` read from the program logs
7. No instruction exists that empties the vault or edits claim history —
   verified from the IDL
8. Results are written up, including anything that surprised us

Two of eight are met, on a local validator and against throwaway keys rather
than the real mint. **They will need re-running against the actual artefacts**,
which is why neither closes a gate item on its own.

Criterion 8 has already earned its place. What surprised us was not in the
plan at all: `solana sign-offchain-message` signs a *wrapped envelope* while
browser wallets sign raw bytes, so a verifier that knows only one **rejects
valid signatures** — a false negative indistinguishable from broken hardware.
Nothing in Phases 1–6 would have found that, because it is a tooling property,
not a program property.

Every criterion is a *demonstrated failure of an attack*, not a passing happy
path. A test suite that only proves the good path proves very little.

## 5. What devnet cannot tell you

- That mainnet will accept the same program — **it runs older software**
- How it behaves under congestion
- Whether the economics work
- Whether anyone shows up
- Whether the key management around it is sound

An external review (§38) covers what devnet cannot, and **an internal devnet
campaign must never be described as an audit** (§38).
