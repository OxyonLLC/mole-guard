# CUNT Security Model

**Status: INCUBATION.** No token, no program, no pool, no funds at risk *in
$CUNT*. Several surfaces below are shared with $WinLEW, which **does** hold
value today — where that is true it is said explicitly, because a finding that
is theoretical for CUNT may be live for WinLEW.

Assessed 2026-08-08 against the repository, the chain and the running system.
**Reassessed 2026-08-09** after a 2-of-3 was run on a validator and three real
signer keys were created and proven on three devices. Everything is
evidence-based; where something could not be verified from this machine it says
so.

The 08-09 pass matters to this document specifically, because a security model
written against a system that has never been run is a model of *intentions*.
Three of the findings below changed, and §8 records a class of threat the first
pass could not see at all: **physical key custody.**

---

## 1. Severity scale

| | Meaning |
|---|---|
| **CRITICAL** | Funds or keys can be taken now, or a secret is already exposed |
| **HIGH** | A realistic path to loss, or a control the sprint explicitly requires that is absent |
| **MEDIUM** | Real weakness, currently bounded by something circumstantial (e.g. "the account is empty") |
| **LOW** | Defence-in-depth, or a weakness with no plausible path today |

A MEDIUM that is bounded only by "it holds nothing yet" becomes HIGH or
CRITICAL on the day it is funded. Those are marked **⏳**.

## 2. Summary

**No CRITICAL findings.** No private key is exposed, no live transaction has
been made, and both banked vanity addresses were re-checked on-chain and remain
unclaimed.

| Surface | Severity | One line |
|---|---|---|
| CI/CD | ~~HIGH~~ **CLOSED 2026-08-08** | Workflow added: secret scan, full test suite, dependency audit, on every push. |
| Dependencies | ~~HIGH~~ **CLOSED 2026-08-08** | 26 → 11 advisories, high 12 → 4. Remainder accepted in writing and gate-enforced. |
| Program upgrade authority | **HIGH** | Structurally dominates every other control. |
| Treasury custody | ~~MEDIUM ⏳~~ **CLOSED 2026-08-09** | The key is made *irrelevant*, not better guarded. See §4.1. |
| Signer key custody | **NEW — LOW** | Three keys, three devices, three locations, all possession-proven. No single point of failure. See §8. |
| Mint keypair | MEDIUM | Squat window between grinding and minting. |
| Backend availability | MEDIUM | A single ngrok tunnel is the entire backend's reachability. Demonstrated down today. |
| Registration authority | MEDIUM | Can admit sybils silently. |
| Vanity grinder | LOW | Official Anza CLI; no custom crypto. |
| Vanity user service | **ASSESSED 2026-08-08 — DO NOT BUILD AS DESCRIBED** | The construction that would make it safe does not exist on Ed25519. See `CUNT-VANITY-SERVICE-THREAT-MODEL.md`. |
| Bot | LOW | Holds no treasury key; reports rather than enforces. |
| Website | LOW | Static; all state comes from the API. |
| Deployment keys | LOW | On ext4, mode 600, outside the repo. |
| RPC | LOW | Read-only; no key ever transmitted. |
| Vanity suffix as identity | **NEW — MEDIUM if published as authentication** | A bare `…CUNT` costs 44.7 seconds. See §5.5. |
| Multisig | **MECHANISM PROVEN, ACCOUNT NOT CREATED** | Enforcement demonstrated on a validator; signer set complete and proven. Creating the account is a §61-gated action. |

---

## 3. HIGH findings

### 3.1 ~~There is no CI~~ — CLOSED 2026-08-08

**Resolved.** `.github/workflows/ci.yml` now runs on every push and pull
request: a secret scan, the full test suite plus `modules:validate`, and a
dependency audit.

Three properties worth recording, each guarded by
`test/ci/workflowHygiene.test.mjs`:

- **Least privilege** — `permissions: contents: read`, so the write-capable
  default token is never handed to a job.
- **No secrets** — no step references `secrets.*`. These checks run on public
  code; a CI job holding a credential is a place one can leak from.
- **No third-party actions** — only `actions/checkout` and
  `actions/setup-node`. The secret scanner is our own dependency-free script,
  and its job deliberately has **no `npm ci`**, so a malicious package install
  cannot compromise the job that looks for leaked keys.

The scanner (`npm run scan:secrets`) reports rule name and location only and
**never prints matched text** — a scanner that echoes a secret into a public
build log has published the thing it guards. A test asserts no `console.log`
interpolates a match.

Building it found something worth keeping: the first version flagged **219
false positives** on a clean repository, because it treated any 60+ character
base58 run as a possible key — and a Solana **transaction signature is also 64
bytes**, hence also ~88 base58 characters. Length cannot separate a signature
from a secret key. That rule was removed rather than tuned; secrets are caught
by variable name and by filename shape (`solana-keygen grind` names its output
after the pubkey, so a live mint key lands as an ordinary-looking `.json`).

Verified by planting a keypair file, an inline 64-byte array and a quoted
mnemonic: all caught, nothing leaked into the output.

The original finding is preserved below because the reasoning still applies to
anything CI does not yet cover.

> **(Original finding.)** Nothing ran automatically on push. §56 asks for checks
> on secret files, key patterns, mnemonics, test failures, static analysis,
> dependency vulnerabilities and tokenomics invariants. All of those existed as
> code and none was enforced — the only thing between a keypair and a public
> repo was `.gitignore` plus manual review. That worked, and "it worked because
> someone checked" is not a control.

**Still not covered:** static analysis and formatting (§56) — no linter is
installed, and adding one is a separate decision.

### 3.2 ~~Dependency advisories~~ — CLOSED 2026-08-08

**Resolved.** 26 → 11 advisories, high 12 → 4. `axios` was removed entirely as
an unused direct dependency, non-breaking patches were applied, and the four
remaining highs are accepted in writing and enforced by `npm run audit:gate`.
Full detail in [`CUNT-DEPENDENCY-REVIEW.md`](CUNT-DEPENDENCY-REVIEW.md),
including the finding that `npm audit fix --force` would DOWNGRADE
@solana/web3.js from 1.98.4 to 0.0.3 while reporting a security improvement.

The original finding follows.

#### (Original) 26 advisories, of which 12 high

Measured with `npm audit`, not assumed. 0 critical, 12 high, 14 moderate.
**Five are direct dependencies**, not transitive.

The one worth naming:

> **`bigint-buffer` — buffer overflow via `toBigIntLE()`.**

Reachability was checked rather than assumed. The exact chain:

```
the-mole-guard
└─┬ @solana/spl-token@0.4.14        ← DIRECT dependency
  └─┬ @solana/buffer-layout-utils@0.2.0
    └── bigint-buffer@1.1.5          ← the advisory
```

and `buffer-layout-utils/lib/*/bigint.js` is exactly the module that decodes
u64/u128 fields — token amounts and balances. `@solana/spl-token` is used by
the faucet for real transfers today, so this is not a dormant transitive
package: it is in the live path every time a balance is parsed. It is the
advisory on this list with the most direct relationship to what the code does.

Others of note: `lodash` code injection via `_.template`, `ws` uninitialized
memory disclosure, `axios` NO_PROXY bypass, `http-proxy-middleware` multipart
field injection.

**This is live for $WinLEW today**, not just future CUNT — the faucet holds a
funded keypair and runs on these packages.

**Mitigation:** §57 asks for a documented dependency review with pinned
production versions. Do that before the program work, not after. Note §57's own
warning too: do not blind-upgrade during security-sensitive work — each of
these needs checking for a breaking change in the Solana packages.

### 3.3 Upgrade authority dominates every other control

Covered in full in `CUNT-AUTHORITY-MATRIX.md` §2.1 and repeated here because a
security model that omitted it would be misleading.

Every `PROGRAM_PDA` guarantee is a guarantee about *the currently deployed
bytecode*. "No human can empty the Tuesday vault" means "no human can empty it
without first upgrading the program."

**Mitigation:** the §50 lifecycle — developer → multisig → restricted — is the
real decentralisation timeline, and upgrade authority must be the most tightly
held key in the project. Do **not** make the program immutable before it is
tested: an immutable program with a claim bug strands the funds permanently.

---

## 4. MEDIUM findings

### 4.1 ~~Treasury custody is one key on one machine~~ — CLOSED 2026-08-09

**As found (08-08):** `13CrW3Tc…X3CUNT` was a single keypair. MEDIUM only
because it held nothing; CRITICAL the moment it was funded.

**Why the obvious fix did not exist.** "Migrate it to a multisig later" is not
available for a *vanity* address: migrating means moving funds to a **different
address**, which throws the vanity away. And a ground key can never live on a
hardware wallet — it is a software keyfile by construction. So the finding could
not be closed by better custody of that key.

**What was done instead: the key was made irrelevant.** The treasury is an SPL
**token account created at that address** whose `owner` field is the 2-of-3
multisig. The vanity keypair signs `SystemProgram.createAccount` once and can
never authorise anything again — exactly like a mint keypair after
`InitializeMint`.

Verified on a local validator, logs read rather than inferred:

| Test | Result |
|---|---|
| Token account created **at** the vanity address | ✓ (not an ATA) |
| Its `owner` is the 2-of-3 multisig | ✓ |
| **The vanity key attempts to spend** | **REJECTED** — `Error: owner does not match` (`0x4`) |
| One of three signers spends | **REJECTED** — `MissingRequiredSignature` |
| A different pair (B+C) spends | **ACCEPTED** |

**This is a closure, not a mitigation.** There is no longer a single key whose
compromise matters, so there is nothing left to guard.

Two caveats that travel with it, because they are real costs:

- A token account is **mint-specific**. That address can hold `$CUNT` and
  nothing else — no SOL, no other tokens. A general-purpose wallet there would
  mean keeping the key forever and reopening the finding.
- It is **not an ATA**. Senders must use the literal address; anything deriving
  an ATA from the multisig computes a different one.

**Still true:** establish the multisig **before** funding. Moving a funded
treasury is strictly riskier than re-pointing an empty designation.

### 4.2 The mint keypair's generate→mint window

A mint keypair only makes an address exist — mint and freeze authority are
separate pubkeys chosen at creation, so a leaked mint key cannot mint or freeze
anything. The real risk is **address squatting**: anyone who derives the key
before the mint is created can create it first and own the address.

Both banked keys have been idle since 2026-08-07 and were re-verified unclaimed
today.

**Mitigation:** grind → create the mint **in one session**. Do not grind in
September and mint in October. Never reuse a mint keypair for anything else; it
signs one transaction in its life.

### 4.3 The whole backend hangs off one ngrok tunnel

Not theoretical — demonstrated today. The Discord verification flow failed with
`ERR_NGROK_8012` because Node was not yet listening on `localhost:8787`, and
every `/api/*` path on `winlew.co` returns 404 by design: the only route to the
backend is `/verify/api-proxy.php` forwarding to the tunnel.

So the tunnel, the PHP proxy and one Node process are a **three-link chain with
no redundancy**, and the site's live data, verification and claims all depend on
all three.

For $CUNT this matters more than for a static page: a Tuesday claim window is
24 hours, and an outage inside it costs people a claim they cannot get back.

**Mitigation (design note, not this sprint):** claims must be **on-chain
transactions signed by the user**, not API calls through this chain. If the
website is down and the program is up, a claim must still be possible. That is
an argument for the program-enforced design and against any claim path that
routes through our infrastructure.

### 4.4 The registration authority can admit sybils

Created by the verified-wallet decision. It cannot mint, move or steal, but it
can exclude a real participant and — more importantly, because it is silent —
admit fabricated identities.

**Mitigation:** multisig, plus a **publicly auditable registry** so an
implausible burst of registrations is visible to everyone rather than only to
us.

### 4.5 The serving machine may run older code

The watchdog has previously been observed running from a separate, older
checkout. Could not be verified from this machine.

If true generally, security fixes merged to `main` do not necessarily reach the
running system, and "we fixed that" can be true of the repo and false of
production.

**Mitigation:** verify what commit each pm2 process is actually running before
relying on any fix. The deploy runbook's post-restart checks exist for this.

---

## 5. LOW findings, and what is already right

**The vanity grinder is not ours.** Both keys came from Anza's `solana-keygen`.
The 2022 Profanity disaster — 32 bits of entropy, every address brute-forceable,
~$3.3M drained — happened because a project used a *custom* generator. Using
the official CLI is the mitigation, and there is no bespoke key-generation code
in this repo to review.

**Key storage is correct, for a non-obvious reason.** Keys live at
`~/winlew-vanity/` on ext4, dir 700, files 600. They are deliberately **not**
in the repo, and specifically not in the `vanity/secrets/` layout §3 proposes —
because this repo sits on `/mnt/c`, where **`chmod` is a no-op**: `chmod 600`
reports `777`. An in-repo secrets directory would be world-readable while
appearing protected. This is the single most valuable local detail in this
document.

**No secret material in git.** Verified: no keypair-shaped byte arrays in
tracked files (the only 64-byte arrays are RIPEMD-160 tables in bundled
third-party JS), no grind-output `.json`, and the two public addresses appear
only in an internal doc.

**The bot cannot lose funds.** It holds no treasury key, it is not registered,
and §29 confines it to reporting. If it is compromised it can lie to users —
which is a reputational problem, not a financial one — and the chain remains the
record.

**No admin panel.** No `/admin` routes exist. There is no privileged web
surface to attack.

**RPC never sees a key.** All signing is local; RPC transports signed
transactions only. No mainnet financial transaction has been made this sprint.

### 5.5 The vanity suffix is not authentication — MEDIUM if ever published as one

Measured, not estimated. A bare `…CUNT` suffix is `58⁴ = 11,316,496` keys:

```
EXPECTED TIME  44.7 seconds     MEDIAN  31.0 seconds
```

**Forty-five seconds of laptop CPU.** So publishing *"an address ending in CUNT
is official"* would hand every scammer a matching address before their coffee
cooled, having first trained the community to trust it. The failure is an
inversion: the harder the pattern is leaned on as proof, the more valuable
forging it becomes, and it never gets more expensive to forge.

The `W…CUNT` key cost 24 hours only because of the leading `W` (1 in 999). The
suffix contributes almost nothing.

**Therefore:** the vanity suffix is a **mnemonic**. The credential is a short,
closed, published address list that a person can check against the chain. Two
vanity addresses is the ceiling, and both are already banked.

The same applies more strongly to `.sol` domains: a domain can be **re-pointed
or transferred**, an address cannot. Compromise the domain owner and everything
sent "to burn.winlew.sol" goes to the attacker. A domain is therefore a *weaker*
identity claim than a vanity address, not a stronger one — the address stays
canonical and the domain is a convenience alias.

---

## 6. The vanity wallet service — assessed, and recommended against

Full analysis in [`CUNT-VANITY-SERVICE-THREAT-MODEL.md`](CUNT-VANITY-SERVICE-THREAT-MODEL.md).

The hoped-for mitigation was "user-supplied entropy the server never learns" —
split-key generation, the construction that makes paid vanity services
defensible on Bitcoin. **It does not transfer to Solana.** On secp256k1 the
private key IS the scalar, so a user secret and a service offset combine into a
usable key the service never sees. On Ed25519 the importable private half is a
32-byte SEED and the signing scalar is a one-way hash of it, so the combined
scalar has no seed and no standard wallet can import the result.

Consequence, and it is structural rather than an implementation detail:

> **If we perform the computation, we hold the key.**

So "careful custodial" is the only custodial option, and it still means holding
customer keys — with a blast radius that grows with every sale and never
shrinks. Recommendation is to sell the **grinder**, not the key: client-side
generation, open source, nothing transmitted.

A test asserts the structural facts the finding rests on, so if Solana's key
format ever changes the conclusion is revisited rather than silently
inherited.

## 7. Before mainnet

Security preconditions, feeding `CUNT-MAINNET-GATE.md`:

1. ~~CI running tests, `npm audit` and a secret scan on every push.~~ **DONE.**
   Gate ratcheted from `critical` to high-with-written-exceptions.
2. ~~Dependency review complete, production versions pinned.~~ **DONE.**
   `bigint-buffer` chain remains unresolved upstream and is accepted in
   writing — re-check whenever @solana/spl-token publishes.
3. Multisig created and **tested**. **Mechanism proven 2026-08-09** on a
   validator — 1-of-3 rejected with `MissingRequiredSignature`, 2-of-3
   accepted, either pair works, revocation kills minting. The **signer set is
   complete and every key possession-proven** (§8). What remains is creating
   the account, which is a §61-gated mainnet action, not an unknown.
4. Treasury migrated to multisig **before** funding.
5. Mint created in the same session as the grind that produced it.
6. Freeze authority set to `None` at creation.
7. Mint authority revoked after genesis and verified on-chain.
8. Registration registry publicly auditable.
9. Program tested on devnet against the full Phase F list, including the
   Solana-runtime attacks the off-chain model cannot cover — wrong mint, fake
   token accounts, missing signer checks, account-ownership confusion, rent
   exemption, compute exhaustion, CPI reentrancy.
10. Independent external review. **Never** describe an internal review as a
    third-party audit (§38).
11. **Re-test A's and B's steel plates.** Only C's has been restored. §59
    applies to all three; `plan` warns past 180 days.

---

## 8. Physical key custody (added 2026-08-09) — LOW

The first pass could not assess this: there were no keys. There are now three,
and their security is **physical and procedural**, not cryptographic. Nothing
below is enforceable by the chain — §15 of the sprint results states plainly
that the chain knows three public keys and a number, and nothing else.

### Current posture

| | Key | Path | Where | Online? |
|---|---|---|---|---|
| **A** | Ledger 1 + steel | `m/44'/501'/0'` | home | no |
| **B** | Ledger 2 + steel | `m/44'/501'/0'` | daughter's house | no |
| **C** | **steel only**, generator wiped | `m/44'/501'/0'/0'` | bank deposit box | no |

```
distinct locations              3
distinct devices                3
MOST KEYS AT ONE LOCATION       1
keys with online exposure       0
PASS  no single location or device is fatal to signing or to theft
```

### Loss and compromise are different questions

The measurement most setups skip. A key survives losing a location only if its
backup is **elsewhere** (AND); it is exposed if **either** location is breached
(OR).

> **Every backup you add makes loss less likely and theft more likely.**

A setup can pass one and fail the other. An earlier arrangement here — three
keys, three devices, three location *names* — had one row reading `sign? yes /
stolen? YES`, because two keys sat in the same safe.

### Threats this configuration accepts

| Threat | Status |
|---|---|
| **The owner** | **Not defended against, by design.** Three keys, one holder, `independent_signers: 0`. This is `KEY_SECURITY_ONLY` and must never be published as distributed control (§43). |
| **Vendor concentration** | Accepted. At `m=2`, any vendor holding 2 devices has the threshold, so eliminating it needs 3 vendors. Taken because a Ledger secure-element break has not happened in the wild while phone wallets are drained routinely. Mitigated free: **C is phrase-only**, no firmware, no update channel — so no remote software compromise reaches all three. |
| **Coercion** | Not defended against. A 2-of-3 held by one person is one conversation. |
| **A's and B's plates untested** | Only C's has been restored and re-derived. Open, and on a 180-day clock. |

### Threats it defeats, and how they were caught

Each of these produces a **working-looking** result and would have failed only
when the treasury was needed:

| Threat | Control |
|---|---|
| A PDA in the signer set — no private key, silently making a 2-of-3 into a **2-of-2 with no recovery** | on-curve check |
| **Two signers from one seed** — "Add account" gives the next index on the *same* device. Cryptographically invisible from the public keys. | `device_id` recorded per signer and asserted distinct |
| Wrong derivation path — one Ledger shows different addresses in Ledger Live and Phantom | `derivation_path` recorded beside every address, and required |
| A key that cannot actually sign | nonce-bound challenge, verified offline, **before** creation — the signer set is **immutable**, so a dead slot is permanent |
| A mistyped steel plate | C's plate was read **from the plate**, not the phone, and re-derived the expected address |

### The tooling holds no secret

`npm run cunt:multisig-verify` takes only public addresses and signatures. It is
enforced read-only by test: it may not reference `Keypair.generate`,
`secretKey`, `sendTransaction` or `createMultisig`. Key generation happened on
the devices; nothing generated a key on this machine, which is on `/mnt/c` where
`chmod` is a no-op.

One verification bug is worth recording because of its shape: the verifier
initially knew only raw-bytes signatures and **rejected a valid Ledger
signature**, which uses Solana's off-chain message envelope. A false negative in
a verification tool is the most dangerous kind — it is indistinguishable from
broken hardware, and the natural response is to distrust the device rather than
the tool.
