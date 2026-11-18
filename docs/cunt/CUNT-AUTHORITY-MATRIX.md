# CUNT Authority Matrix

**Status: INCUBATION.** Nothing here is deployed. 15 of the 18 actions below
act on something that does not exist yet.

> Machine-readable source: `authority_matrix` in
> [`cunt-project.json`](../../cunt-project.json). This document explains it and
> states nothing it does not contain — `test/cunt/authorityMatrix.test.mjs`
> fails the build if they disagree (§27), including the headline counts in §4.

§49 says this exercise "will expose hidden trust assumptions." It did. The
four it found are in §2, before the table, because they matter more than the
table.

---

## 1. How to read this

Vocabulary is fixed and validated by test — free text would drift into
meaninglessness:

| Value | Meaning |
|---|---|
| `NOBODY` | No key and no program can do this. The strongest state. |
| `NOT_YET_EXISTS` | The thing acted on has not been created. |
| `OWNER_SINGLE_KEY` | One private key, one person. A single point of failure. |
| `MULTISIG` | M-of-N signers. **Does not exist yet.** |
| `PROGRAM_PDA` | Enforced by on-chain logic. No human key can do it. |
| `ANY_PARTICIPANT` | Permissionless, acting only for itself. |
| `GOVERNANCE` | A community process. Does not exist for $CUNT. |

---

## 2. The four hidden trust assumptions

### 2.1 Upgrade authority dominates every other row

This is the big one, and it is easy to miss because it looks like one row
among eighteen.

**Whoever can upgrade the program can replace the claim logic, the vault
rules, and the guarantees in this matrix.** Every row marked
`program_controlled: true` is therefore not a guarantee about the protocol — it
is a guarantee about *the bytecode deployed right now*.

So "no human can empty the Tuesday vault" honestly reads:

> No human can empty the Tuesday vault **without first upgrading the program**.

That is still a meaningful protection — an upgrade is public, slow, and
visible on-chain — but it is a materially weaker claim, and stating the strong
version would be the kind of thing §64 exists to catch.

Consequences:

- Upgrade authority must be the **most tightly held** authority, not an
  afterthought.
- The §50 lifecycle (developer → multisig → restricted/immutable) is the real
  decentralisation timeline. The token is exactly as trustless as that row.
- **Do not make the program immutable before it is tested.** An immutable
  program with a claim bug is unfixable, and the funds are stuck forever.

### 2.2 One key can move the entire community treasury today

`13CrW3Tc…X3CUNT` is a **single keypair**, held by one person, on one machine.
It is designated the Community CUNT Treasury — 800,000,000 tokens' worth of
future authority.

It holds nothing today, so the current exposure is zero. That is the *only*
reason this is MEDIUM and not CRITICAL, and it stops being true the moment it
is funded.

§18 requires multisig or program-enforced custody. **The migration must happen
before funding, not after** — moving a funded treasury is a strictly riskier
operation than moving an empty designation.

#### The fix is designed and proven — and deliberately not yet applied

**`current` still reads `OWNER_SINGLE_KEY`, and that is correct.** This matrix
records what is true, not what is planned. A row that upgraded itself on the
strength of a design would be exactly the drift this document exists to prevent.

What changed on 2026-08-09 is that the fix stopped being an aspiration:

- **The straightforward version does not exist.** "Migrate it to a multisig
  later" is unavailable for a *vanity* address — migrating means moving funds to
  a **different** address, discarding the vanity — and a ground key can never
  live on a hardware wallet. This row could not be fixed by better custody.
- **The key is instead made irrelevant.** The treasury becomes an SPL token
  account created **at** that address with `owner` = the 2-of-3. The vanity
  keypair signs `createAccount` once and can never authorise anything again.
- **Proven on a local validator**, logs read rather than inferred: the vanity
  key attempting to spend is rejected with `Error: owner does not match`
  (`0x4`), 1-of-3 with `MissingRequiredSignature`, 2-of-3 accepted.
- **The signers exist.** Three keys, three devices, three locations, each
  possession-proven by a nonce-bound signature verified offline.

So the gap between `current` and `future` is now a **single gated action**
rather than an open problem. Creating the account is a mainnet operation behind
the §61 gate, which is why this row has not moved.

### 2.3 Liquidity is withdrawable by whoever holds the LP tokens

Not theory. Measured on WinLEW's own Raydium pool on 2026-08-08: the LP mint's
409.13 supply is held **53.66% by the Developer Reserve**, 43.82% and 2.52% by
two outside wallets. That pool's 35.5M WinLEW is withdrawable at any time, with
no cliff.

The same will be true of $CUNT's 100M market/liquidity allocation unless the LP
position is explicitly locked. "We provided liquidity" is not a commitment that
it stays. Whether to lock it, and for how long, is an open decision for
`CUNT-LIQUIDITY-POLICY.md` (§12).

### 2.4 The registration authority can admit a sybil

Added 2026-08-08 with the verified-wallet-gating decision, because that decision
*creates* an authority that did not exist before.

A chain cannot see Discord. So the wallet-to-identity binding that makes the
sybil gate work has to be **attested on-chain by someone**. That someone
decides who may claim.

It cannot mint, move or steal anything. But it can do two things worth naming:

- **Exclude** a genuine participant by declining to register them.
- **Admit a sybil** by registering fabricated identities.

The second is the one that matters, because it is silent. The gate is exactly
as strong as the honesty of this authority — which is why it is a `MULTISIG`
row and not a single key, and why the registry must be publicly auditable so an
implausible burst of registrations is visible to everyone.

---

## 3. The matrix

`R?` = can be revoked · `SR?` = should be revoked · `MS` = multisig ·
`PDA` = program-controlled · `Ver` = publicly verifiable

### Token authorities

| Action | Current | Future | R? | SR? | MS | PDA | Ver |
|---|---|---|---|---|---|---|---|
| Mint new $CUNT | `NOT_YET_EXISTS` | **`NOBODY`** | ✅ | ✅ | — | — | ✅ |
| Freeze / thaw a holder's account | `NOT_YET_EXISTS` | **`NOBODY`** | ✅ | ✅ | — | — | ✅ |

**Mint authority** (§20): revoke immediately **after** genesis allocation.
Revoking first makes the supply unmintable. Irreversible — which is the point.

**Freeze authority** (§21): prefer setting it to `None` **at creation** rather
than revoking later. "Revoke later" leaves a window in which it existed and
could have been used, and nobody auditing later can prove it wasn't. A freeze
authority is the power to confiscate by immobilisation.

### Treasury and allocations

| Action | Current | Future | R? | SR? | MS | PDA | Ver |
|---|---|---|---|---|---|---|---|
| Move the Community treasury | **`OWNER_SINGLE_KEY`** | `MULTISIG` | ❌ | ❌ | ✅ | — | ✅ |
| Withdraw team tokens | `NOT_YET_EXISTS` | `PROGRAM_PDA` | ❌ | ❌ | — | ✅ | ✅ |
| Authorize a community release | `NOT_YET_EXISTS` | `PROGRAM_PDA` | ❌ | ❌ | — | ✅ | ✅ |

Custody cannot be "revoked" — it has to be *replaced*. That is why those rows
are ❌ / ❌ rather than an oversight.

### Tuesday protocol

| Action | Current | Future | R? | SR? | MS | PDA | Ver |
|---|---|---|---|---|---|---|---|
| Register a verified participant | `NOT_YET_EXISTS` | `MULTISIG` | ❌ | ❌ | ✅ | — | ✅ |
| Fund the reward vault | `NOT_YET_EXISTS` | `MULTISIG` | ❌ | ❌ | ✅ | — | ✅ |
| **Withdraw from the vault** | `NOT_YET_EXISTS` | **`NOBODY`** | ❌ | ❌ | — | ✅ | ✅ |
| Open an epoch | `NOT_YET_EXISTS` | `PROGRAM_PDA` | ❌ | ❌ | — | ✅ | ✅ |
| Close / finalize an epoch | `NOT_YET_EXISTS` | `PROGRAM_PDA` | ❌ | ❌ | — | ✅ | ✅ |
| Claim | `NOT_YET_EXISTS` | `ANY_PARTICIPANT` | ❌ | ❌ | — | ✅ | ✅ |
| Set reward per claim | `NOT_YET_EXISTS` | `MULTISIG` | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Edit claim history** | `NOT_YET_EXISTS` | **`NOBODY`** | ❌ | ❌ | — | ✅ | ✅ |
| Pause the protocol | `NOT_YET_EXISTS` | `MULTISIG` | ✅ | ❌ | ✅ | ✅ | ✅ |

Three things here are deliberate and load-bearing:

**Funding in is human-authorised; funding out is impossible.** Adding to the
vault can only ever increase what participants can claim, so it is safe for a
multisig to do. The dangerous direction is out. §16 is explicit: no human key
may empty the vault — so there must be **no instruction that does it**. Not
multisig-gated. Absent.

**`set_reward_per_claim` must be bounded** (§37). Adjustable only within limits
fixed at deployment. An unbounded setter is equivalent to draining the vault
slowly, and would make the row above meaningless.

**Opening and closing epochs should follow the clock, not an operator.** If a
human has to open each Tuesday, a missed press cancels everyone's week; if a
human can close early, that is a denial-of-claim power. Neither belongs to a
person.

**Pause** (§51) may halt *new claims only*. It must never move or confiscate
user funds. Whether it should exist at all is still open — a pause is also a
censorship power, and it is listed as ✅ revocable precisely so it can be given
up once the protocol is proven.

### Program and infrastructure

| Action | Current | Future | R? | SR? | MS | PDA | Ver |
|---|---|---|---|---|---|---|---|
| **Upgrade the program** | `NOT_YET_EXISTS` | `MULTISIG` | ✅ | ✅ | ✅ | — | ✅ |
| Add / remove liquidity | `NOT_YET_EXISTS` | `MULTISIG` | ❌ | ❌ | ✅ | — | ✅ |
| Change `cunt-project.json` | **`OWNER_SINGLE_KEY`** | `OWNER_SINGLE_KEY` | ❌ | ❌ | — | — | ✅ |
| Run the Discord bot | **`OWNER_SINGLE_KEY`** | `OWNER_SINGLE_KEY` | ❌ | ❌ | — | — | ❌ |

The manifest is off-chain **and intentionally so**. It *describes* reality; it
cannot change it. If the manifest and the chain disagree, the chain wins (§64).
Its audit trail is git history.

The bot is the only row that is not publicly verifiable — which is exactly why
§29 forbids it being authoritative. It reports; the chain enforces. It holds no
treasury key, and if it dies nothing about the token changes.

---

## 4. Where the trust sits today

| State | Actions |
|---|---|
| `NOT_YET_EXISTS` | 15 |
| `OWNER_SINGLE_KEY` | 3 |

The three single-key actions today are: **move the community treasury**
(currently empty), **change the manifest** (describes, cannot enact), and **run
the bot** (reports, cannot enact).

Only one of the three touches value, and it holds nothing yet. That is a
genuinely clean starting position — and the entire value of writing this down
now is that it stays checkable as things get funded.

### What the seven MULTISIG rows now cost

Seven of the 18 rows resolve to `MULTISIG`. The instinct is that this means
seven arrangements to build; it does not. **All seven are served by one
2-of-3**, and the same three signers cover both the SPL native multisig (token
authorities) and the general-purpose one (upgrade, LP, registration) — separate
signer sets buy nothing when `independent_signers` is 0 and the threat is key
loss rather than collusion.

Counting the whole matrix that way gives **four secrets held forever**: signers
A, B and C, plus one disposable operational hot wallet. Not eighteen. PDAs
(4 rows) have no private key at all, revoked authorities (4 rows) have no
holder, `publish_manifest` is git rather than a chain key, and `claim_tuesday`
belongs to participants.

**The keys exist and are proven.** What does not exist is the multisig account —
creating it is a §61-gated action.

## 5. Target end state

Four actions must become impossible **for everyone, including us**:

1. Minting new $CUNT
2. Freezing anyone's tokens
3. Removing tokens from the Tuesday vault other than by a claim
4. Editing claim history

Achieving 1 and 2 is cheap and permanent: revoke mint authority after genesis,
never set freeze authority. 3 and 4 are achieved by **not writing the
instruction** — the safest kind of guarantee, and one no upgrade can quietly
weaken without the diff being public.

<!--
authority-matrix-rows: mint_new_tokens, freeze_token_account,
move_community_treasury, access_team_vesting, release_community_tranche,
register_participant, fund_tuesday_vault, withdraw_tuesday_vault, open_epoch,
close_epoch,
claim_tuesday, set_reward_per_claim, override_claim_history, pause_protocol,
upgrade_program, modify_liquidity, publish_manifest, operate_bot

Coverage marker, checked by test/cunt/authorityMatrix.test.mjs. It must list
exactly the ids in cunt-project.json's authority_matrix. Adding a capability to
the manifest without explaining it here fails the build — which is the point:
a capability nobody documented is a capability nobody reviewed.
-->

## 6. Open decisions

- ~~Multisig topology and **who the signers are**.~~ — **SETTLED 2026-08-09.**
  **2-of-3**, all three keys held by the project owner on three separate
  devices in three separate locations, each possession-proven. Recorded as
  `control_model: KEY_SECURITY_ONLY`, `independent_signers: 0`.
  **This protects against key loss, theft and device compromise — not against
  the owner**, and must never be published as distributed control (§43). §18 is
  satisfied because these are real identities, not invented ones. Revisit
  3-of-5 only if the signer set ever becomes genuinely independent.
- Whether `pause` exists at all.
- The upgrade-authority timeline: when developer → multisig, and whether
  immutable is ever the destination.
- Whether the LP position is locked, by what, and for how long (§12).
- The bounds on `reward_per_claim`.

None of these can be settled by writing more documentation. They need people
and dates.
