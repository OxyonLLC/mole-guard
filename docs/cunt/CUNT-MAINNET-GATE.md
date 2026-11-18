# Mainnet Gate (§60)

> **STATUS: NOT PASSED. 5 of 25 items are done.**
>
> **Nothing is deployed. No token exists. No mainnet transaction has been made.**

Machine-readable source: `mainnet_gate` in
[`cunt-project.json`](../../cunt-project.json).
`test/cunt/mainnetGate.test.mjs` **refuses to let `passed` be true while any
item is incomplete**, and refuses to let `deployment_status` leave
`NOT_DEPLOYED` while `passed` is false. This is a gate, not a checklist.

---

## 1. What is live, and what is not

Asked directly during the sprint, so it is answered directly. Verified on-chain
and against the live site on 2026-08-08.

### $CUNT — nothing is live

| | |
|---|---|
| Token / mint | **Does not exist.** Manifest mint address is `null`. |
| Community CUNT `13CrW3Tc…X3CUNT` | account: none · **0 transactions** |
| Weekly CUNT `WhPApnQQ…aNCUNT` | account: none · **0 transactions** |
| Liquidity pool | none |
| Program | none — spec and an off-chain model only |
| Mainnet transactions this sprint | **zero** |

The two reserved keys have never been touched. Nothing was created.

### The page *is* live — deliberately, and unlisted

`winlew.co/cunt/future/` returns 200. That was the intent: **live but
undiscoverable**. Verified in production:

> **2026-08-09:** the whole host is returning **403 on every path**, including
> ones that do not exist (which should 404) — with FTP down at the same time.
> That is a hosting-account or document-root permission failure, not a change
> to the site, and nothing in this sprint touched `src/public/`. The
> verification below stands from 08-08; re-check it once the host is restored.

- `/cunt/` → guard stub, `noindex, nofollow`, redirects to `/no-thank-you/`
- `/cunt/future/` → `noindex, nofollow`, says **"Not minted yet"**
- **0** mentions of it on the live homepage, **0** in the live `nav.js`
- `/cunt/README.md` and `/cunt/future/README.md` → **404** (the internal
  checklist leak is closed)

### What *did* go live today — WinLEW, not CUNT

So "are we only running tests" is not a blanket yes, and it should not be:

- The backend restart shipped the governance split gate, the 25M lock and the
  Raydium vault components — confirmed serving real data
- The price-widget fixes, `!data`'s Raydium row, and comma formatting
- **CI now runs on every push** — that is live automation
- `package-lock.json` changed, so the serving machine needs `npm ci` next pull

Everything in the **$CUNT sprint** is documents, off-chain models and tests.
Everything **WinLEW** is production, and always was.

## 2. The gate

**5 done · 5 partial · 12 todo · 3 blocked**

Two items moved `todo` → `partial` on 2026-08-09. **Neither moved to done**, for
the same reason both times: what remains is a mainnet action or an untested
steel plate — not a missing piece of work.

### ✅ Done (5)

| Item | Evidence |
|---|---|
| supply finalized | 1,000,000,000, invariant-tested. *Decimals still `null`.* |
| allocations finalized | 800M/100M/100M, sums to exactly 1B, invariant-tested |
| machine-readable registry complete | `cunt-project.json`, checked against the docs by test |
| all project wallets labeled | both reserved identities disclosed |
| no secret leakage | scanner in CI every push; keys on ext4 outside the repo; verified by planting one |

### ◐ Partial (5)

| Item | State |
|---|---|
| multisig tested | **MECHANISM PROVEN** on a local validator: 1-of-3 rejected with `MissingRequiredSignature`, 2-of-3 accepted, either pair works, revocation kills minting. **SIGNER SET COMPLETE 2026-08-09** — three keys, three devices, three locations, each possession-proven by a nonce-bound signature verified offline, each with its derivation path recorded, all device identities distinct. PARTIAL because the multisig *account* does not exist on any network. Control model `KEY_SECURITY_ONLY`. |
| …CUNT treasury custody finalized | **DESIGN PROVEN, NOT APPLIED.** Still one key today. The straightforward fix does not exist for a vanity address, so the key is made *irrelevant* instead: a token account at `13Cr…CUNT` with `owner` = the 2-of-3. Validator-proven — the vanity key cannot spend (`Error: owner does not match`, `0x4`). PARTIAL because creating the account is a mainnet action. |
| backups tested | **ONE OF THREE.** C's steel plate was restored — words read *from the plate* derived the expected pubkey. A's and B's have **never** been restored: untested backups of keys that currently work, which is exactly what §59 warns about. Covers key backups only; no project/data restore has been tested at all. |
| release controller tested | Simulated off-chain; not implemented. |
| security audit complete | Internal model done, 2 HIGHs closed, 1 MEDIUM closed structurally. NOT an audit (§38). |

### ☐ To do (12)

| Item | State |
|---|---|
| W…CUNT role finalized | Key banked and unclaimed. Its technical role is undecided — a vanity keypair is not a program ID. |
| team vesting finalized | 2x50M proposed; triggers null. Must not unlock on price. |
| community-release conditions finalized | Objective trigger simulated; thresholds not chosen. reward_per_claim must be ~17,500 or the schedule takes 47 years. |
| liquidity amount finalized | 100M bucket agreed; SOL side unknown and gates the opening price. |
| LP control finalized | Recommendation is burn. Not decided. |
| mint authority policy finalized | Policy REVOKE_AFTER_GENESIS recorded; decided=false. |
| freeze authority policy finalized | Policy NEVER_SET recorded; decided=false. |
| upgrade authority policy finalized | Dominates every other control. Lifecycle undecided. |
| independent review complete | None. Must never be conflated with the internal one. |
| transparency site complete | /cunt/future/ is a teaser. No /cunt/transparency/ exists. |
| deployment runbook reviewed | No mainnet runbook written — deliberately. |
| final human approval received | Not given. The sprint stops here (§61 Phase I). |

### ⛔ Blocked (3)

| Item | Blocked by |
|---|---|
| wen…CUNT role finalized | Not found. 4.8y CPU / days on GPU. Either case accepted. |
| initial SOL liquidity finalized | Owner 2026-08-08: not going live for a few months; SOL figure unknown at this time. Remains the gate on the opening price. |
| Tuesday program tested | No program. Spec + 32-test reference model only. |

## 3. The four decisions that unblock the most

Ranked by how much they unlock, not by effort.

1. **How much SOL is available for liquidity.** Gates the opening price, the
   slippage, the FDV, and the entire §3 table of the liquidity policy. Nothing
   downstream can be chosen first.
2. ~~**Who the multisig signers are.**~~ — **ANSWERED 2026-08-09.** 2-of-3, all
   three keys held by the owner on three devices in three locations, each
   possession-proven. §18 is satisfied: real identities, not invented ones.
   Seven authority rows are unblocked in design. **It must still exist before
   the treasury is funded** — creating the account is the remaining step, and
   it is a mainnet action.

   Replaced in this ranking by: **the upgrade-authority lifecycle**, which now
   dominates the list. Every `program_controlled` guarantee reads "no human can
   do X *without first upgrading the program*", and nothing about the multisig
   changes that.
3. **`reward_per_claim`.** The simulator found the staged release takes **47
   years** at 1,000 CUNT/claim. It needs to be ~17,500 to clear BELLY in a
   year, or the staged model is decorative.
4. **Burn, lock, or retain the LP.** The credibility decision. Recommendation
   is burn; the cost is that the SOL is gone and does not come back.

## 4. What must never be marked done casually

- **`independent_review`** — §38. An internal review is not a third-party
  audit, and a test asserts this one is not recorded as done.
- **`human_approval`** — §61 Phase I. If this is ever `done` without the owner
  saying so, the sprint has approved itself. A test asserts it cannot be done
  while the gate has not passed.
- **`no_secret_leakage`** — currently done and worth keeping that way. It is
  the only item whose failure is unrecoverable.

## 5. The order of operations at mainnet

Not a runbook — deliberately, since §40 forbids one this sprint. But two
sequencing facts are easy to get backwards and expensive:

1. **Revoke mint authority AFTER genesis allocation.** Revoking first makes the
   supply unmintable and the project unrecoverable.
2. **Set freeze authority to `None` AT CREATION**, not later. Revoking later
   leaves a window in which it existed and nobody auditing can prove it was
   unused.

And one that is not sequencing but is the same class of mistake: **migrate the
treasury to multisig before funding it**, not after. Moving a funded treasury
is strictly riskier than re-pointing an empty designation.

## 6. Stopping here

§61 Phase I: *"DO NOT DEPLOY MAINNET. Produce final sprint report. WAIT FOR
HUMAN APPROVAL."*

That is where this sprint ends. The gate exists so the next person — including
a future me — cannot mistake a green test suite for permission.
