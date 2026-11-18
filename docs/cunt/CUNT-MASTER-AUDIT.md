# CUNT Master Audit — Phase A

**Sprint status:** INCUBATION / "IN THE BELLY".
**This document changes no architecture.** §61 Phase A explicitly forbids that
until the audit is read.

Everything below was verified against the repository, the chain, or a live
request on 2026-08-08. Nothing is asserted from memory.

> **This is a point-in-time record and is not rewritten.** What each finding
> became is tracked in the `Now` columns and in §10, added 2026-08-09. An audit
> that gets edited to match later reality stops being evidence of anything —
> the value is in what was true when it was written, and in being able to see
> what moved.
>
> For current state read `cunt-project.json`; for the narrative read
> `CUNT-SPRINT-RESULTS.md`.

---

## 1. Executive summary

The sprint is buildable, but **three of its premises do not match the
repository**, and two of them are load-bearing. They are listed in §3 and §4
because getting them wrong would waste days of GPU time and produce documents
describing software that does not exist.

Headline findings:

| # | Finding | Severity | Now (2026-08-09) |
|---|---|---|---|
| 1 | **There is no vanity grinder to audit.** §3/§4/Phase C assume one exists. | HIGH — blocks Phase C as written | **Resolved as a non-gap.** Both keys came from Anza's CLI, which is the *mitigation* for the Profanity disaster, not an omission. A wrapper + estimator was built instead; we still write no key generator. |
| 2 | **There is no Rust/Anchor toolchain.** The Weekly CUNT program (§13–17, §37, §50) is a new language and build system in a pure-Node repo. | HIGH — largest scope item in the sprint | **Open, deliberately.** Specified not written: `src/cunt/epoch.js` is an executable specification with 32 tests any implementation must pass. |
| 3 | **The 10% "protocol-locked" bucket became "market/liquidity."** This silently changes the community share from 90% to 80%. | HIGH — a published claim depends on it | **Closed.** Owner-confirmed, recorded in `$allocation_history` per §55, and invariant-tested. |
| 4 | `wen` (lowercase) contradicts the `Wen` (capital) target every existing estimate was computed for. | MEDIUM — wrong case wastes the whole grind | **Closed.** Either case accepted, both to run concurrently. Moot for now: no grind is running and `WhPApnQQ…aNCUNT` is a viable fallback mint. |
| 5 | A custom on-chain program reverses a documented prior decision to use Streamflow/Jupiter instead. | MEDIUM — needs an explicit overrule, per §55 | **Closed as recorded.** The reversal is written down in the plan file rather than left implicit. Streamflow still recommended for team vesting, which genuinely *is* a schedule. |

No CRITICAL findings. Specifically, **§63's critical checks pass**: no private
key was exposed, and no live transaction was executed.

---

## 2. What was verified

### Secret handling — §3, §63 (PASS)

| Check | Result |
|---|---|
| Private key material in git | **None.** The only 64-byte arrays in tracked files are RIPEMD-160 permutation tables inside bundled third-party JS (`Uint8Array.from([7,4,13,1,10,…])`), plus wallet-library API surface naming `secretKey`. Not keys. |
| Grind-output-shaped `.json` in git | None. |
| Banked keypairs' location | `~/winlew-vanity/` — **outside the repository entirely**, dir `700`, files `600`, on ext4. |
| Public addresses in git | Only `A.i-Talks/vanity-grind-handoff.md`. Public keys only. |
| Anything reachable from the web root | No. Neither address appears anywhere under `src/public/`. |
| `.gitignore` coverage | `vanity/`, `**/vanity/`, `**/*keypair*`, `**/wallet*.json`. |

### The banked identities — §2

Re-derived from the keypair files (not read off the filenames), pattern-checked
case-sensitively, and re-checked on-chain today:

| Role (§2) | Address | On-chain |
|---|---|---|
| **Community CUNT** — `...CUNT` | `13CrW3Tc2mCxyxYo86qQTcPGUYqrGbYiFF4TpvX3CUNT` | no account, 0 txs — **unclaimed** |
| **Weekly CUNT** — `W...CUNT` | `WhPApnQQXf33cJsfboHAijwQqSmfhLAudeBm4aNCUNT` | no account, 0 txs — **unclaimed** |
| **Official Mint** — `wen...CUNT` | not found | — |

Two of the three identities in §2 already exist and map cleanly onto the roles
the sprint assigns. Neither has been squatted.

`W…CUNT` is 43 characters, not 44. That is not a defect — `W` can only lead a
43-digit pubkey, which is the same fact that makes it 17× more expensive to
find.

### Existing $CUNT assets

| Asset | State |
|---|---|
| Landing page | `src/public/cunt/future/index.html` — `noindex, nofollow`, not in nav, linked from nowhere, guarded by `/cunt/` redirect stub. Enforced by `test/nav/cuntPageUnlisted.test.mjs`. |
| Page build notes | `src/cunt/PAGE-NOTES.md` — deliberately outside the web root. |
| Discord scaffold | `src/cunt/commands.js` — `CUNT_MINT = null`; the disclaimer text switches automatically when a mint is set. Not wired into `runner.js`; the bot does not start. |
| Supply claims on the page | Effectively none. One narrative mention of "One billion supply" describing **the Base original**. No Solana tokenomics table exists yet to contradict §6. |
| Stage names | BELLY / CRAWL / RUN / TUESDAY already present in the page copy. |

That last row is fortunate: **§6's allocation can be published without
retracting anything**, because the page has never stated Solana tokenomics.

### Toolchain

| Capability | Present? |
|---|---|
| `@solana/web3.js` ^1.98.4, `@solana/spl-token` ^0.4.14 | yes |
| Anchor / Rust / `Cargo.toml` / `programs/` | **no — none** |
| Test runner | `node --test`, `test/**/*.test.{cjs,mjs}` — **962 passing** |
| Docs convention | `docs/` flat, kebab-case (`governance-v1.md`). §47 asks for `docs/cunt/` + numbered files; §62 names 16 `CUNT-*.md`. This file follows §62. |

---

## 3. Premise correction 1 — there is no vanity grinder

§3 says *"Audit all existing vanity-generator code before modifying it"* and §4
says *"Preserve working grinder functionality. Do not rewrite functioning
software simply for style."*

**No such software exists.** Searching the repo for `grind`/`vanity` returns
four hits, and all four are unrelated English (`// vanity domains printed
beside them`, `// grind — the last 25 points`, `missing perms / vanity URL`).

Both banked keys were produced by the **official Solana CLI**:

```
solana-keygen grind --starts-and-ends-with W:CUNT:1 --num-threads 16
```

So the twelve audit questions in §3 have a single answer: the implementation is
`solana-keygen` 4.1.1, CPU-only, and its security properties are Anza's, not
ours. Measured throughput on the laptop: **~253,000 keys/sec across 15.5 of 16
cores.**

**This is good news.** The Profanity disaster §23 alludes to happened because a
project used a *custom* generator with 32 bits of entropy. Using the official
CLI is the mitigation, not a gap.

**Consequence for Phase C:** there is nothing to preserve or refactor. The work
is a thin, auditable wrapper providing the `vanity estimate|start|status|stop|
results` command model of §4 — and critically, the **estimator**, which is where
the real value is and where the existing analysis already lives.

### Recommended deviation from §3's directory layout

§3 proposes `vanity/secrets/` inside the repo. **Recommend against**, for a
concrete local reason: this repo lives on `/mnt/c` (DrvFs), where **`chmod` is a
no-op** — `chmod 600` reports `777`. An in-repo secrets directory would be
world-readable on the Windows drive while *appearing* protected.

Keep secrets at `~/winlew-vanity/` on ext4 where `600` is real, and create only
`vanity/public/` in-repo (`addresses.json`, `benchmarks.json`, `jobs.json`).
This satisfies §3's separation requirement more strongly than the proposed
layout.

---

## 4. Premise correction 2 — `wen` vs `Wen`

§2A specifies prefix **`wen`**, lowercase, "exact case unless explicitly
changed."

Every existing estimate, and the handoff document on the GPU machine, targets
**`Wen`** with a capital W.

Difficulty is **identical** — both `w` and `W` fall in the `K`–`z` base58 band
that carries the 1-in-999 leading-character penalty, so either way:

```
58⁶ ÷ P(leading char) = 38,042,681,545,262 keys expected  (~38.0 trillion)
  laptop CPU (253k/s)  ≈ 4.7 years        — not viable
  GTX 1660 (est.)      ≈ 1.4–2.9 days     — viable
```

But they are **different searches**. A `Wen…CUNT` hit does not satisfy a
`wen…CUNT` target. Nothing is at risk today because §4 forbids starting a grind
without approval and none is running — but this must be settled before the GPU
box starts, or it costs days.

Recorded as an open question in §8 below.

---

## 5. Premise correction 3 — the 10% bucket changed meaning

This is the one with a published-claim dependency, so it is stated precisely.

| | Prior decision (2026-08-07, in the plan file) | This sprint (§6, §66) |
|---|---|---|
| Community | 800M | 800M |
| Team | 100M | 100M |
| Third bucket | 100M **protocol-locked** — "community/protocol-owned, a permanent floor" | 100M **market / liquidity** |
| Resulting community share | **90%** (800M released + 100M locked for the community) | **80%** |

The prior decision recorded an explicit reason: *"its lock beneficiary must NOT
be a team wallet, because '10% team / 90% community' depends on that being
verifiable on-chain."*

Under §6 that 100M is **project-controlled liquidity at genesis**, not a
community floor. Both models are defensible and §6 is arguably more honest —
liquidity has to come from somewhere, and pretending it is "community" would be
the kind of relabelling §43 forbids. But it is a **real change to a stated
number**, and §55 requires recording what changed, when, and why.

§6 is treated as canonical for this sprint because §66 restates it under
"CURRENT CANONICAL FACTS". Flagged for explicit confirmation in §8.

**Arithmetic verified (§63):**

```
800M + 100M + 100M            = 1,000,000,000   ✓ exactly 1B
300M + 200M + 200M + 100M     =   800,000,000   ✓ exactly the community bucket
team  100M  = 10%   never exceeded in any staged model  ✓
market 100M = 10%   never exceeded in any staged model  ✓
```

---

## 6. The largest scope item — a custom on-chain program

§13–17, §37 and §50 require a **Weekly CUNT Solana program**: PDAs for global
state, epochs, reward vault authority, participant registration and claim
records, plus an upgrade-authority lifecycle.

This **reverses a documented prior decision**, which chose Streamflow/Jupiter
Lock specifically to avoid writing novel financial code:

> *"A bespoke Anchor program would be novel financial code with an
> unrecoverable failure mode."*

Both positions are coherent, and §16 makes a genuinely strong argument the old
plan could not: *"Humans should not possess a private key capable of arbitrarily
emptying the Tuesday reward vault."* **Streamflow cannot express a Tuesday
claim.** It vests on a schedule; it does not gate a per-epoch, per-participant,
claim-once action. If Tuesday claims are real, a program is genuinely required —
the old decision was made before Tuesday claims existed as a requirement.

What it costs to say yes:

- Rust + Anchor + `cargo` added to a repo that is 100% Node today
- A new CI surface, new dependency-audit surface (§57), reproducible builds (§39)
- Upgrade-authority custody (§50) — a new trust assumption to disclose
- External security review before value enters (§38)

**Recommendation:** split the decision. Design and specify the program in this
sprint (`CUNT-WEEKLY-PROTOCOL.md`, PDA layout, state model, invariants, the
attack list in Phase F) **without** adding a Rust toolchain yet. That yields the
document, the data model and the tests that any implementation must satisfy, and
defers the toolchain commitment to a decision made with the spec in hand. The
sprint cannot reach mainnet anyway (§60), so nothing is lost by sequencing it.

---

## 7. Security findings (§36 classification)

| Sev | Finding | Status as audited (08-08) | Now (08-09) |
|---|---|---|---|
| — | Private keys in repo / logs / web root | **None found.** §63 passes. | Still none. Scanner runs in CI on every push and reports location only, never matched text. |
| — | Vanity keys squatted | **No.** Both unclaimed as of 2026-08-08. | Unchanged. |
| LOW | `A.i-Talks/vanity-grind-handoff.md` names `~/winlew-vanity/` | Acceptable. §3 warns against publishing secret *paths*; this is a local home directory in an internal doc, not a public one. Worth revisiting if that doc is ever published. | Unchanged, and still contingent on that doc staying internal. |
| MEDIUM | Single-key custody of Community CUNT | Exactly what §18 anticipates. No multisig exists. Must be resolved before the treasury holds value — architecture only this sprint, per §18. | **CLOSED, structurally.** Not mitigated — *removed*. The token account is created **at** `13Cr…CUNT` with `owner` = the 2-of-3, so the vanity keypair signs `createAccount` once and is then inert. Proven on a validator: it cannot spend (`Error: owner does not match`, `0x4`). See §10. |
| MEDIUM | Mint keypair generate→mint gap | The window between grinding and minting is the squat risk. §2 keys have been idle since 2026-08-07. Mitigation is unchanged: grind → mint in one session, never months apart. | **Open and unchanged.** No grind has run; the banked keys are now two days older. |
| INFO | `src/cunt/commands.js` not registered | The bot cannot leak anything because it does not run. `CUNT_MINT = null` makes the disclaimer say the token does not exist — correct today. | Unchanged. |

---

## 8. Questions requiring human decision (§68 item 21)

These block later phases. Phase A does not depend on them.

1. ~~**`wen` or `Wen`?**~~ — **answered:** either, run concurrently. (§4)
2. ~~**Confirm the 10% bucket is market/liquidity**~~ — **answered:** confirmed,
   community share is 80%, recorded per §55. (§5)
3. ~~**Write Rust this sprint, or specify-only?**~~ — **answered:**
   specify-only. `epoch.js` is the executable spec.
4. ~~**Deliverable order.**~~ — **answered and executed.** All 16 documents
   exist; the order used is §9's.

All four are closed. The open questions moved to
`CUNT-SPRINT-RESULTS.md` §21, where the live one is **how much SOL is
available for liquidity** — it gates the opening-price decision and therefore
most of what remains.

---

## 9. Recommended sequencing

Phase A is complete with this document. The highest-value next work, in order,
none of which requires the open questions to be settled:

1. `CUNT-TOKENOMICS.md` + `cunt-project.json` — the §27/§48 single source of
   truth, with the §42 invariants as executable tests. This kills documentation
   drift before it starts, and the invariant tests are cheap and permanent.
2. `CUNT-AUTHORITY-MATRIX.md` (§49) — the fastest way to expose hidden trust
   assumptions, and it needs no code.
3. `CUNT-WEEKLY-PROTOCOL.md` + `CUNT-PROOF-OF-TUESDAY.md` — the state model and
   epoch data model (§15, §35), specified and tested off-chain.
4. Simulators (§45, §11) — release controller and liquidity, pure functions,
   no chain access.
5. `CUNT-VANITY-GRINDER-AUDIT.md` + the `vanity` wrapper and estimator (§4).

Deferred until answered: anything requiring Rust, and any grind.

**All five were delivered in that order.** Nothing in the sequence had to be
re-ordered, which is the only real test of a plan like this.

---

## 10. What Phase A could not have found (added 2026-08-09)

Phase A audited the **repository**. The findings above are all of the form
"this file says X and that file says Y" — real, and cheap to find by reading.

A second day was spent doing the things that cannot be read: running a multisig
on a validator, and creating three real signer keys on three real devices. It
produced five findings of a completely different character, and **none of them
were discoverable by audit.**

| Finding | Why reading could not have found it |
|---|---|
| **One Ledger shows two addresses** | Ledger Live derives `m/44'/501'/0'`, Phantom `m/44'/501'/0'/0'`. Nothing in the repo mentions either. It appears only when a physical device is in your hand. |
| **Two signers can share one seed** | "Add account" in Ledger Live yields the next index on the *same* device. The resulting pubkeys are unrelated-looking and pass every structural check. **Cryptographically invisible** — only the device identifier distinguishes it. |
| **Two locations cannot hold three keys** | At `m=2`, whichever place holds two both hands a burglar the threshold *and* takes recovery. Arithmetic, but it only surfaces once real places are named. |
| **The SPL signer set is immutable** | No add/remove/replace instruction exists. Found by *attempting* it (`account or token already in use`, `0x6`). This turns proof-of-possession from good practice into a precondition. |
| **`sign-offchain-message` ≠ `signMessage`** | The CLI signs a wrapped envelope; browser wallets sign raw bytes. Our verifier knew only one and **rejected a valid signature** — a false negative indistinguishable from broken hardware. |

### The lesson worth keeping

Every one of these produces a **working-looking result.** A PDA in the signer
set, a same-seed pair, a two-location layout, a mistyped steel plate — all pass
inspection and fail only on the day the treasury is needed.

Phase A was right to be a reading exercise, and it caught what reading catches.
But **an audit of a system that has never been run is an audit of intentions.**
The gap between the two is where this project's real findings were.
