# Multisig Design (§18, §50)

**Status: SIGNERS EXIST AND ARE PROVEN. THE MULTISIG ACCOUNT DOES NOT.**

Seven authority-matrix rows assume one. As of 2026-08-09:

| | |
|---|---|
| Design | complete |
| Enforcement | **proven** on a local validator — §4 |
| Signer keys | **three, on three devices, all possession-proven** — §2 |
| The multisig account | **does not exist on any network** |

That last line is the whole remaining gap, and it is a **§61-gated mainnet
action** rather than outstanding work. Keys existing is not the multisig
existing, and a test asserts that sentence cannot be written by accident.

---

## 1. The distinction that decides everything

Owner's answer 2026-08-08: signers would be *"me, the dev"*, with a **separate
wallet** for the second key.

The separate wallet is a real improvement and worth doing. But it is worth
being exact about what it buys, because the two things get conflated and only
one of them can be published:

| | Protects against | Does the separate wallet help? |
|---|---|---|
| **Key-security multisig** | one key stolen, one key lost, one machine compromised | **Yes — completely** |
| **Governance multisig** | one *person* acting unilaterally | **No — not at all** |

If both keys are held by the same person, no arrangement of them prevents that
person from signing twice. N keys, one human, one decision.

**That is fine.** Key-security is the more likely failure by a wide margin — a
compromised laptop is a far more probable way to lose a treasury than a founder
deciding to take it. A 2-of-3 the owner fully controls is a genuine and
worthwhile upgrade on a single key.

**What is not fine is describing it as the other thing.** §43 forbids
manufactured decentralisation. "Treasury secured by 2-of-3 multisig" reads to
almost everyone as *distributed control*. If one person holds every key, the
honest sentence is:

> "The treasury is held in a 2-of-3 multisig. All three keys are currently
> controlled by the project owner on separate devices, so this protects against
> key loss and device compromise — not against the owner."

If that sentence is unacceptable to publish, the fix is a genuinely independent
signer, not a softer sentence.

## 2. 2-of-3 — built 2026-08-09

Addresses live in `cunt-project.json`, not here, so there is one place to read
them and one place they can drift from.

| Key | Held on | Derivation | Location | Proven |
|---|---|---|---|---|
| **A** | Ledger 1 + steel | `m/44'/501'/0'` | home | ✅ |
| **B** | Ledger 2 + steel | `m/44'/501'/0'` | daughter's house | ✅ |
| **C** | **steel only** — generated in Phantom on a clean Android phone, device then wiped | `m/44'/501'/0'/0'` | bank deposit box | ✅ |

```
distinct locations              3
distinct devices                3
MOST KEYS AT ONE LOCATION       1
keys with online exposure       0
PASS  no single location or device is fatal to signing or to theft
```

**2-of-3, not 2-of-2.** A 2-of-2 has no recovery: lose either key and the
treasury is frozen permanently. 2-of-3 survives losing any one key, which is
the failure this is mostly defending against.

### Three things this arrangement records that a key list would not

**Every address carries its derivation path.** One Ledger showed *two different
addresses* depending on the app asking — Ledger Live derives `m/44'/501'/0'`,
Phantom `m/44'/501'/0'/0'`. Both are real keys from one seed. An address without
its path is ambiguous, and "signer A" meaning two different things is how a dead
slot gets committed.

**Every signer carries a device identity.** Two signers on one device is two
accounts on **one seed** — a 2-of-3 that is really a 1-of-2 — and it is
**cryptographically invisible** from the public keys. Only the device
identifier distinguishes it. A test asserts no two signers share one.

**C is phrase-only, deliberately.** Three Ledgers would have meant one vendor,
one firmware, one update channel. That cannot be engineered away at a threshold
of 2 — any vendor holding two devices has the threshold — but C having no live
device at all means no remote software compromise can reach all three keys.
Generating it on a phone that had never run a wallet was the owner's call, and a
better one than a third Ledger: A and B came off Ledger firmware, C off an
entirely different stack.

### The one hard rule about the third key

**Key C must not live on the serving machine**, and must not be an existing
system/automation wallet.

That was the specific problem with *"we could use the system wallets"*: those
keys already exist, already sit on the machine that runs the bots, and are used
by automation. Reusing one means an attacker who compromises that machine
obtains **two signatures at once** — which is precisely the event a multisig
exists to survive. It converts a 2-of-3 into a 1-of-1 for anyone who gets in.

## 3. Two different multisigs are needed

This is a technical finding, not a preference. Verified against
`@solana/spl-token`:

### SPL Token native multisig — for token authorities

`createInitializeMultisigInstruction` exists in the **SPL Token program
itself**. No external program, no upgrade authority, no additional trust.

Verified offline (no funds needed):

```
program              SPL Token (native)
account size         355 bytes
threshold m=2        encodes correctly with 3 signers
rent-exempt cost     0.00336168 SOL, one-off
max signers          11
```

It can hold **mint authority** and **freeze authority** directly, which are the
two most dangerous token-level powers.

**But it only authorises SPL Token instructions.** It cannot approve a program
upgrade, manage an LP position, or sign an arbitrary transaction.

### General-purpose multisig — for everything else

Program upgrade authority, LP management and treasury transfers of anything
that is not a plain SPL transfer need a general-purpose multisig (Squads is the
usual Solana choice).

**Not verified here** — it is third-party software and would need its own
review before holding value. Recorded as a decision, not a recommendation.

### Which covers what

| Authority | Multisig type |
|---|---|
| Mint authority | SPL native — then **revoked entirely** after genesis |
| Freeze authority | never set (§21) — no multisig needed |
| Community treasury | SPL native — a **token account at `13Cr…CUNT` owned by the multisig** (§4a) |
| Tuesday vault funding | SPL native |
| LP position | general-purpose |
| Program upgrade | general-purpose — the most powerful row |
| Registration authority | general-purpose |

## 4. Enforcement — PROVEN 2026-08-08

Run, not reasoned about. §60's exit criterion was **a failed M−1 attempt**, and
that is what this is.

**Environment:** a **local validator** (`solana-test-validator` **4.1.1**), not
devnet. Devnet's faucet returned 429 repeatedly and Alchemy devnet 403. The
substitution is arguably an improvement: the local validator runs **4.1.1**,
while devnet runs **4.2.0-rc.0** — a release candidate *ahead* of mainnet's
**4.1.0**. Throwaway keys, ledger destroyed afterwards.

| # | Test | Result |
|---|---|---|
| 1 | Create 2-of-3 | `m=2`, `n=3`, initialized |
| 2 | Mint authority = the multisig | ✓, freeze authority `None` at creation (§21) |
| 3 | **ONE of three signers mints** | **REJECTED**, supply stayed 0 |
| 4 | **TWO of three (A+B) mints** | **ACCEPTED**, supply 1 |
| 5 | **A different pair (B+C) mints** | **ACCEPTED**, supply 2 |
| 6 | Revoke mint authority, then mint | **REJECTED** |

### Why it was rejected matters as much as that it was

A generic "simulation failed" proves nothing — it could be a fee, a blockhash,
a malformed account. The program logs were read:

```
Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]
Program log: Error: MissingRequiredSignature
Program ...failed: missing required signature for instruction
```

That is the **SPL Token program itself** refusing for the **correct reason**.

Test 5 matters independently: it shows *any* two signers work, not just the
first two. A design where only one specific pair functions would have passed
test 4 and still been broken.

Test 6 was not planned and proves a second gate item: **mint authority
revocation actually works**, and minting is impossible afterwards.

### What this does NOT prove

**Our multisig does not exist.** Three real keys on three devices have not been
created on any network. This proves the *mechanism* enforces — not that we have
configured one. The gate item is `partial`, not `done`, for exactly that
reason.

## 4a. The treasury keeps its vanity address — PROVEN 2026-08-08

`13Cr…CUNT` was recorded as `custody: SINGLE_KEY`, a MEDIUM finding. The
obvious fix — "migrate it to a multisig later" — **is not available**: migrating
means moving funds to a *different* address, which discards the vanity.

The real fix is to create an SPL **token account at that address** whose `owner`
field is the 2-of-3. The vanity keypair signs `SystemProgram.createAccount`
once and is then inert, exactly like a mint keypair.

Run on a local validator, logs read rather than inferred:

| # | Test | Result |
|---|---|---|
| 1 | Token account created **at** the vanity address | ✓ not an ATA |
| 2 | Owner is the 2-of-3 multisig | ✓ |
| 3 | **The vanity key tries to spend** | **REJECTED** — `Error: owner does not match` (`0x4`) |
| 4 | One of three signers spends | **REJECTED** — `MissingRequiredSignature` |
| 5 | A different pair (B+C) spends | **ACCEPTED** |

This **closes** the finding rather than mitigating it: the key stops mattering
instead of being better guarded.

Two caveats that must travel with the decision:

- A token account is **mint-specific**. This address holds `$CUNT` and nothing
  else — no SOL, no other tokens. A general wallet here would mean keeping the
  key forever, which reopens the finding.
- It is **not an ATA**. Senders must use this literal address; anything
  deriving an ATA from the multisig computes a different one.

## 5. Sequence

The full procedure is **`CUNT-KEY-CEREMONY.md`**, with `npm run
cunt:multisig-verify` checking each step. In outline:

| | Step | |
|---|---|---|
| ✅ | **1.** Create the three keys **on three devices**. Never all on one machine, even temporarily — and never all from one seed phrase at different derivation paths, which looks unrelated on-chain and is a 1-of-1. | done |
| ✅ | **2.** `check` the three public keys: off-curve (a PDA silently makes this a 2-of-2), near-duplicates, reuse of any WinLEW address. | done |
| ✅ | **3.** `possession` — prove each device can actually sign. An address written down is not a key you can use. | done, all three |
| ✅ | **4.** `plan` — measure loss **and** compromise separately. Two keys in one place fails both. | passes, exit 0 |
| ◐ | **5.** Test recovery from the backup **before** it matters (§59). | **C only.** A's and B's plates have never been restored — owner scheduled **2026-08-15**. |
| ☐ | **6.** Create the multisig, then the treasury token account at `13Cr…CUNT`. | §61-gated |
| ☐ | **7.** **Migrate the treasury designation before funding**, not after. | §61-gated |
| ☐ | **8.** Publish the arrangement, including who holds what, per §19. | after 6–7 |

Steps 6–8 are mainnet actions and stay behind the §61 gate. Steps 1–5 sign
nothing on-chain.

**Step 5 is the one that is genuinely incomplete.** C's plate was restored and
re-derived — it had to be, since once the phone was wiped the plate became the
only copy. A's and B's are *untested backups of keys that currently work*, which
is exactly the situation §59 describes: a backup that has never been restored is
a hope. `plan` warns past 180 days.

### Step 3 is a precondition, not a formality

Because the signer set is **immutable**. Proven by trying it:

```
Program log: Error: account or token already in use
Program ...failed: custom program error: 0x6
```

There is no add-, remove- or replace-signer instruction. Rotating a signer means
creating a **new multisig and transferring every authority to it**. So a public
key that cannot sign becomes a *permanent* dead slot — and a 2-of-3 with a dead
slot is a 2-of-2 with no recovery.

That is why possession is proven before creation rather than discovered after.

## 6. Settled: this is key-security only

Owner, 2026-08-08: **"it's just me, no dev."**

So all three keys are held by one person. That closes the question in §1 and
fixes the disclosure:

> **This is a key-security multisig, not a governance one.** It protects
> against key loss, key theft and device compromise. It does not protect
> against the owner, and must never be published as distributed control.

**Independent signers: 0.** That is recorded in the manifest as a number rather
than as prose, so adding one is a deliberate change rather than a gradual
reinterpretation.

It is still worth building. A single key is one bad laptop away from losing the
treasury; a 2-of-3 across three devices is not. That is the realistic threat,
and this closes it.

## 7. Open

- **Create the multisig account.** The only remaining step of the design, and a
  §61-gated mainnet action. Everything it needs exists and is verified.
- **Restore A's and B's steel plates.** Step 5 above. Scheduled 2026-08-15; on a 180-day clock thereafter.
- Whether to introduce a genuinely independent signer later. Only then may
  `control_model` change from `KEY_SECURITY_ONLY`, and only then may the
  disclosure sentence be rewritten.
- Whether to adopt Squads for the general-purpose role, and reviewing it if so.
- 2-of-3 now; revisit 3-of-5 if the signer set ever becomes genuinely
  independent.

## 8. What this design still does not defend against

Stated here rather than left to inference, because a document that only lists
strengths is marketing.

| Threat | Status |
|---|---|
| **The owner** | Not defended against, by design. Three keys, one person. §6. |
| **Coercion** | Not defended against. A 2-of-3 held by one person is one conversation, and the locations are known to that person. |
| **Vendor concentration** | Accepted and named. At `m=2` any vendor with two devices has the threshold; C being phrase-only is the free mitigation, not a cure. |
| **Upgrade authority** | Untouched by any of this. Every `program_controlled` guarantee still reads "no human can do X *without first upgrading the program*" — see the authority matrix §2.1. A multisig on the upgrade authority changes who, not what. |
| **A's and B's untested plates** | Open. Step 5. |

The honest summary is the one §6 already gives: this converts *"one bad laptop
loses the treasury"* into *"one bad laptop loses nothing."* That is a real and
worthwhile change. It is not decentralisation, and §43 forbids describing it as
any.
