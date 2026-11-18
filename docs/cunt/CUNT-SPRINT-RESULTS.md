# $CUNT Master Sprint — Results

**2026-08-08 to 2026-08-09. 37 commits. 1039/1039 tests passing.**

**Nothing was deployed. No token exists. Zero mainnet transactions.**

Format per §68.

---

## Where this stands

| | |
|---|---|
| Documents | 16 |
| Off-chain modules | 7 |
| Tools | 6 |
| Tests | 185 CUNT/CI, 1039 in the full suite |
| Mainnet gate | **5 done · 3 partial · 14 todo · 3 blocked** |
| `mainnet_approved` | **false**, and test-enforced |

Two phases. **08-08** produced the design: documents, simulators, the manifest,
CI, the authority matrix. **08-09** did the part that could not be reasoned
about — it ran a multisig on a validator, then created and proved three real
signer keys on three real devices.

The second day is the one that found things, because reality disagreed with the
plan five separate times. Those are §16a.

## 1. Executive summary

The sprint delivered 17 documents, 7 off-chain modules and 185 tests, and
stopped at the approval gate as §61 Phase I requires.

Its most valuable output was not a document. It was **findings that contradict
assumptions the sprint itself was built on**:

1. **There is no vanity grinder to audit** — §3/§4 assume one exists. Both keys
   came from Anza's CLI, which is the *mitigation* for the disaster §23 warns
   about, not a gap.
2. **The staged release takes 47 years** at a plausible reward size. It needs
   ~17,500 CUNT per claim to clear BELLY in a year, or the staged model is
   decorative.
3. **The safe vanity-service design does not exist on Solana.** Split-key
   generation works on secp256k1 because the private key *is* the scalar; on
   Ed25519 the importable half is a seed and the scalar is a one-way hash of
   it. If we do the compute, we hold the key. No exceptions.
4. **Upgrade authority dominates every other control.** Every "no human can do
   X" guarantee actually reads "no human can do X without first upgrading the
   program."
5. **A vanity suffix is not authentication.** A bare `…CUNT` costs **44.7
   seconds** of laptop CPU. Publishing "ends in CUNT = official" would build a
   phishing kit and price it at under a minute.
6. **The SPL signer set is immutable.** There is no add-, remove- or
   replace-signer instruction — proven by attempting it (`account or token
   already in use`, `0x6`). A key that cannot sign is therefore a *permanent*
   dead slot, which turns proof-of-possession from good practice into a
   precondition.

## 2. What existed before this sprint

- A `/cunt/` teaser page, `noindex`, with no Solana tokenomics stated
- A Discord bot scaffold (`src/cunt/commands.js`) with `CUNT_MINT = null`,
  never registered and never started
- Two banked vanity keypairs at `~/winlew-vanity/`
- A prior plan that chose **Streamflow over a custom program** and recorded the
  third 10% bucket as a community-owned lock
- No Rust, no Anchor, no CI, no `docs/cunt/`

## 3. What was verified

Everything below was checked, not assumed:

- Both reserved vanity addresses — **0 transactions, no account** — re-checked
  on-chain today
- No private key material anywhere in git; the only 64-byte arrays in tracked
  files are RIPEMD-160 tables in vendored JS
- `solana-keygen` 4.1.1 behaviour, by running a throwaway grind and destroying it
- Raydium's real fee structure and WinLEW's real pool composition
- Devnet reachable, `4.2.0-rc.0` — **ahead of mainnet's 4.1.0**
- The live site's `/cunt/` posture: guard stub, `noindex`, 0 nav references,
  READMEs 404

## 4. What was changed

- The third 10% bucket: **protocol-locked → market/liquidity**, moving the
  community share from 90% to 80% (owner-confirmed, recorded per §55)
- Eligibility: **verified wallets only**, with claims keyed by identity
- Dependencies: 26 advisories → 11, `axios` removed, **yarn removed entirely**
- CI added: secret scan, tests, audit gate, import verification
- One test race fixed (fixed-timeout navigation assertion)

## 5. What was created

**17 documents** — master audit, tokenomics, authority matrix, weekly protocol,
proof of tuesday, simulators, security model, dependency review, vanity grinder
audit, vanity service threat model, liquidity policy, testnet plan, mainnet gate,
brand identity, multisig design, key ceremony.

**7 modules** — `epoch.js` (reference protocol), `proofOfTuesday.js`,
`liquiditySim.js`, `releaseSim.js`, `vanityEstimate.js`, `multisigVerify.js`,
plus the bot scaffold.

**6 tools** — `scan-secrets`, `audit-gate`, `verify-imports`, `vanity`,
`cunt:multisig-verify`, `cunt:sign-page`.

**196 tests** across the CUNT and CI areas; 1159 in the full suite.
<!-- 192 -> 195 on 2026-08-11. Not sprint work: a mutation sweep during the
     site QA audit found three guards in test/cunt/ that still passed when the
     file they protect was emptied — an assertion of the form "must NOT contain
     X" is satisfied by a file containing nothing. Each gained a presence
     assertion, which is the +3. The sprint itself remains halted at §61. -->

`cunt-project.json` is the §48 manifest and the single source of truth — every
document is checked against it by test.

## 6. Current vanity search status

| Target | Status |
|---|---|
| `…CUNT` (Community) | **banked** |
| `W…CUNT` (Weekly) | **banked** — 20.9 billion keys, 24h, 1.85× expected |
| `wen…CUNT` / `Wen…CUNT` (Mint) | **not found.** 38,042,681,545,262 expected keys — 4.8 years CPU, days on GPU |

**No grind is running.** §4 forbids starting one without approval. Owner
decision: either case accepted, run both concurrently.

## 7. Public vanity addresses found

Public keys only.

```
13CrW3Tc2mCxyxYo86qQTcPGUYqrGbYiFF4TpvX3CUNT   Community CUNT   44 chars
WhPApnQQXf33cJsfboHAijwQqSmfhLAudeBm4aNCUNT    Weekly CUNT      43 chars
```

Both re-derived from their files rather than read off filenames. The 43-char
length is not a defect — `W` can only lead a 43-character pubkey, which is the
same fact that makes it 59× more expensive to find.

## 8. Secret storage status

No secret content. Status only.

- Keys live at `~/winlew-vanity/` — **outside the repository**, on ext4, dir
  `700`, files `600`
- Deliberately **not** in §3's proposed `vanity/secrets/`: this repo is on
  v9fs where `chmod` is a no-op, so an in-repo secrets directory would be
  world-readable while appearing protected
- A secret scanner runs in CI on every push, reports location only, and never
  prints matched text — verified by planting a keypair, a byte array and a
  mnemonic

## 9. Tokenomics verification (§63)

Run, not asserted:

```
✓ allocations = exactly 1,000,000,000
✓ community releases = exactly 800,000,000
✓ team never exceeds 100M          ✓ market never exceeds 100M
✓ releases not sized to the market bucket
✓ no extra team-controlled bucket  ✓ only 3 vanity identities
✓ mint address still null          ✓ deployment_status NOT_DEPLOYED
✓ mainnet_gate.passed === false    ✓ no authority marked revoked
```

**Decimals remain `null`** — not a canonical fact in the spec, so not invented.

## 10. Community release model

300M → 500M → 700M → 800M across BELLY / CRAWL / RUN / FINAL TUESDAY. Sums
exactly; invariant-tested.

**Triggers are undefined on purpose.** The simulator demonstrated §8's warning
rather than restating it: a volume trigger fires in **week one** for an attacker
with two sybil identities and no community. An objective trigger (unique
claimers, elapsed time, distribution, concentration ceiling, sybil-share
ceiling) never fires for that population.

## 11. Team vesting recommendation

2 × 50M. **Time-based or milestone-based, never price-based** (§9). Enforce with
Streamflow — that *is* a schedule, and reusing audited software beats writing
our own. Triggers remain `null` pending approval.

## 12. Liquidity recommendation

**Burn the genesis LP.** A time-lock says "we promise not to for N years"; a
burn says "we cannot". The cost is real and stated: the SOL is gone, and burned
LP is stranded if the venue dies.

**Single venue at birth (Raydium).** Splitting a fixed SOL amount across two
pools roughly doubles slippage in each — tested, not asserted.

Grounding: WinLEW's own pool is **53.66% LP-held by the Developer Reserve**,
0.05% burned, earning **$6.87/year**. That is what unlocked liquidity looks
like, and why "we provided liquidity" is not a commitment that it stays.

## 13. Weekly CUNT program status

**Specified, not written.** No Rust, by decision.

`src/cunt/epoch.js` is an executable specification — 32 tests covering §42
invariants 5 and 6 plus the Phase F list. Whatever the program becomes, it must
pass these.

Two design points worth carrying forward:

- **PDA seeds must be fixed-width.** Solana concatenates seeds without
  separators, so `("ab","c")` and `("a","bc")` derive the same address.
- **The ClaimRecord PDA's existence *is* the double-claim guard** — enforced by
  the runtime before program logic runs.

## 14. Proof of Tuesday status

**Derived, never stored** — computed from claim records, so there is nothing to
forge, edit or adjust. §37's ban on editing claim history has nothing to point
at.

**Must never be a transferable token.** A sellable streak makes the most
decorated participant whoever paid most, which is Proof of Wealth in costume.

Stated limits: 100 verified identities still yield 100 records, a cron job
builds a perfect streak, and it rewards *availability* — a different bias from
wealth, not the absence of one.

## 15. Treasury / multisig status

**Migrate to multisig before funding, not after.** Moving a funded treasury is
strictly riskier than re-pointing an empty designation.

### The mechanism was proven, not reasoned about

On a local validator (`solana-test-validator` 4.1.1 — closer to mainnet's 4.1.0
than devnet's `4.2.0-rc.0`, and devnet's faucet was returning 429/403):

| Test | Result |
|---|---|
| One of three signers mints | **REJECTED** — `Error: MissingRequiredSignature` |
| Two of three (A+B) | **ACCEPTED** |
| A different pair (B+C) | **ACCEPTED** — any two work, not just the first two |
| Revoke mint authority, then mint | **REJECTED** |

The rejection reason was read from the **program logs**, not inferred from a
generic failure — a "simulation failed" could have been a fee or a blockhash.

### The signer set now exists and every key is proven

| | Key | Path | Where | Proven |
|---|---|---|---|---|
| **A** | Ledger 1 + steel | `m/44'/501'/0'` | home | ✓ |
| **B** | Ledger 2 + steel | `m/44'/501'/0'` | daughter's house | ✓ |
| **C** | **steel only**, phone wiped | `m/44'/501'/0'/0'` | bank deposit box | ✓ |

Each proved possession with a nonce-bound signature verified offline. Each
carries its derivation path. All three device identities are distinct. C's
plate was restored and re-derived, which is the §59 recovery test.

```
distinct locations              3
distinct devices                3
MOST KEYS AT ONE LOCATION       1
keys with online exposure       0
PASS  no single location or device is fatal to signing or to theft
```

**The multisig account still does not exist.** `multisig_tested` stays
`partial`: creating it is a mainnet action behind the §61 gate. Keys existing
is not the multisig existing, and a test asserts that sentence cannot be
written by accident.

### How the chain identifies signers

`InitializeMultisig` writes the signer **public keys** into a 355-byte account
owned by the SPL Token program — `m`, `n`, and 11 slots of which 3 are used.
The program reads that list on every instruction and counts matching signers.

**The chain knows three public keys and a number.** Nothing about Ledgers,
safes or bank boxes is on-chain: every placement decision in this sprint is
off-chain policy the chain cannot enforce, which is worth stating plainly.

## 16. Security findings

**CRITICAL: none.** No key exposed, no live transaction, both vanity addresses
unclaimed.

**HIGH — 2 found, 2 closed:**
- No CI → **closed**. Scan, tests, audit gate, import check on every push.
- 26 dependency advisories → **closed**. 12 highs → 4, all accepted in writing
  and gate-enforced. `npm audit fix --force` would have **downgraded
  `@solana/web3.js` from 1.98.4 to 0.0.3** while reporting a security
  improvement.

**HIGH — structural, cannot be closed by us:**
- Upgrade authority dominates every `program_controlled` guarantee.

**MEDIUM — 1 closed structurally:**
- Single-key custody of the `13Cr…CUNT` treasury → **closed**, and by removing
  the key rather than guarding it. The obvious fix ("migrate to a multisig
  later") *does not exist*: migrating means moving funds to a different address,
  which discards the vanity. Instead the token account is created **at** that
  address with `owner` = the multisig, so the vanity keypair signs
  `createAccount` once and is then inert. Proven on a local validator: the
  vanity key attempting to spend is rejected with `Error: owner does not match`
  (`0x4`), 1-of-3 with `MissingRequiredSignature`, 2-of-3 accepted.

**MEDIUM — open:** mint generate→mint window, the whole backend on one ngrok
tunnel, the registration authority's ability to admit sybils silently, and the
serving machine possibly running older code.

**Not assessed → assessed:** the vanity service, now recommended against.

## 16a. What running it found that designing it did not

Five things, each of which would have been invisible until it was expensive.

| Finding | Why it mattered |
|---|---|
| **One Ledger, two addresses** | Ledger Live derives `m/44'/501'/0'`, Phantom `m/44'/501'/0'/0'`. The same device showed `C9FQV…` and `C5se…`. An address without its path is ambiguous, and "signer A" meaning two things is how a dead slot is committed. |
| **Two signers can share one seed** | A candidate for B sat in the same Ledger Live list as A, named `CUNT-2` — exactly what "Add account" produces on *one* device. Two keys from one phrase at a threshold of 2 is the whole treasury behind one plate, and it is **cryptographically invisible** from the public keys. Only the device identifier distinguishes it. |
| **Two locations cannot hold three keys** | At `m=2`, whichever place holds two both hands a burglar the threshold and takes recovery if lost. The first arrangement measured `sign? NO / stolen? YES` on one row. That is arithmetic, not preference — it is why the bank box exists. |
| **The verifier rejected a valid signature** | `solana sign-offchain-message` signs a wrapped envelope (`\xffsolana offchain` + version + format + length); browser wallets sign raw bytes. The tool knew only the raw form. A false negative in a verification tool is the worst kind — it is indistinguishable from broken hardware. |
| **Signing on a device does not verify the backup** | For C the steel plate is the only copy. Signing in Phantom would prove the *phone* held a key and nothing about the handwriting. Reading the words **from the plate** proved possession, verified the plate and satisfied §59 in one act. |

The pattern is worth naming: **every one of these produces a working-looking
result.** A PDA signer, a same-seed pair, a two-location layout and a mistyped
plate all pass casual inspection. They fail only on the day the treasury is
needed, which is the day nobody wants to be debugging.

**No independent review has happened.** Everything above is internal. §38 is
explicit that an internal review must never be described as a third-party
audit, and `independent review complete` remains an open mainnet-gate item —
enforced by test, so it cannot be quietly marked done.

## 17. Test results

**1039/1039 passing, 0 skipped.** 185 of them are CUNT/CI tests.

Several were verified **non-vacuous by planting a violation** — a keypair file,
a third-party CI action, a `secrets.*` reference, a fourth allocation bucket, a
softened vault rule, a smuggled capability, a disabled coverage test, a signer
moved into an occupied location, a second signer given the first's device id.

### Guards that were wrong, and fixed rather than weakened

This is the honest list, because a test that gets quietly relaxed is worse than
no test:

| Guard | What was wrong |
|---|---|
| Prose matching | a code *comment* could satisfy it |
| Long-base58 secret rule | flagged 219 transaction signatures — a signature is also 64 bytes, so length cannot distinguish them. Deleted, not tuned. |
| Cross-newline regex | reported an entire test body as a module name |
| `enforcement_proven === false` | failed the moment the proof was run. Rewritten to check value/evidence *agreement*. |
| `possession_proven === false` for all | same shape — the invariant is "creation waits until all three are proven", not "nothing is proven" |
| Inferring phrase-only from an empty `wallet_app` | broke when C had a *generator* app that gets wiped. "Generated by" and "lives on" are different facts and needed different fields. |
| Word-scan for "seed phrase" | flagged the manifest's own warnings *about* seed phrases. Replaced with a field whitelist; secret **shapes** are `scan-secrets`' job. |
| "No signer pubkey anywhere in the repo" | conflated *public key* with *secret*. All three become permanently public the moment the multisig exists, and the rule would have forced the ceremony to keep no record of itself. |
| Base58 encoder in the signing page | the naive version emits a spurious `1` for zero-valued input — 851 mismatches in 20,000. Caught by fuzzing against `bs58` **before** shipping; it would have produced signatures that fail to verify for a reason indistinguishable from a broken key. |

Two operational bugs of my own are worth recording too: the signing page
initially bound **port 8787**, which is the WinLEW site's own port — making a
local tool look like it had been added to winlew.co — and `pkill -f` repeatedly
killed the shell running it, because the pattern matched its own command line.

## 18. Transparency status

`cunt-project.json` exists and is enforced. **`/cunt/transparency/` does not.**
The teaser page is live-but-unlisted and says "Not minted yet".

## 19. Mainnet readiness

**NOT READY. 5 done · 3 partial · 14 todo · 3 blocked, of 25.** The gate is
enforced by test: `passed` cannot be true while anything is incomplete, and
`deployment_status` cannot leave `NOT_DEPLOYED` while `passed` is false.

## 20. Blockers

| Blocker | Blocks | Change |
|---|---|---|
| No SOL figure for liquidity | the entire opening-price decision | — |
| ~~No signer keys exist~~ | ~~treasury custody~~ | **cleared** — three proven keys, three devices, three locations |
| Multisig account not created | seven authority rows | now a **gated action**, not a missing prerequisite |
| `wen…CUNT` not found | the official mint identity | — (4.8-year CPU search; `WhPApnQQ…aNCUNT` is a fine fallback) |
| No program | everything Tuesday-related on-chain | — |

The multisig line is the meaningful change. It was *"we cannot do this yet"*;
it is now *"we are choosing not to until the gate opens"* — everything needed
to create it exists and has been verified.

## 20a. Outstanding physical steps

Not code, and not blocked on anything:

- Wipe Phantom from the phone that generated C
- Steel plates to `home`, `daughters-house`, `bank-deposit-box`
- **A's and B's plates have never been restored.** C's was, which is what set
  `last_recovery_test`. Test theirs within 180 days or `plan` starts warning —
  §59 applies to all three, not just the one that forced the issue.

## 21. Questions requiring human decision

1. **How much SOL is available for liquidity?** — gates the most
2. ~~**Who are the multisig signers?**~~ — **answered.** The owner, on three
   devices in three locations, all three keys proven. Recorded as
   `control_model: KEY_SECURITY_ONLY`, `independent_signers: 0` — this protects
   against key loss and device compromise, **not against the owner**, and must
   never be published as distributed control (§43).
3. **`reward_per_claim`** — ~17,500, or the schedule is decorative
4. **Burn, lock, or retain the LP?**
5. **Token decimals** — 6 to match WinLEW?
6. **Claim window timezone** — UTC recommended
7. **FCFS or pro-rata rewards?** — simplicity vs fairness
8. **Does `pause` exist at all?** — it is also a censorship power
9. **Is a client-side-only vanity grinder still a viable product?**
10. **Write Rust next sprint, or keep specifying?**

## 22. Recommended next sprint

**Do not start it.** §61 Phase I: stop and wait for approval.

When approved, in this order:

1. **Answer the remaining questions**, above all the SOL figure. They are
   decisions, not work, and everything else is shaped by them.
2. **Create the multisig on devnet with the real signers.** The mechanism is
   proven and the keys exist and are verified — this is now assembly, not
   discovery. Then the treasury token account at `13Cr…CUNT` with `owner` set
   to it.
3. **Then decide Rust.** With the spec, the state model and 32 tests already
   written, implementation is the smaller half of the work.
4. **Build `/cunt/transparency/`** against devnet before mainnet, so the page
   proves itself against a chain that does not matter yet.

Do **not** grind `wen…CUNT` until the GPU machine is free and the case is
confirmed — and remember that if it is never found, `WhPApnQQ…aNCUNT` is a
perfectly good mint address and nothing is blocked.

---

**STOP.** No mainnet deployment. Awaiting human approval.
