# WinLEW Governance Module v1

> **⚠ PUBLISHED COPY: `src/public/governance/rules/index.html`.**
> This document is the source of truth, but a public version is served at
> <https://winlew.co/governance/rules/> and is cited from the Governance page
> itself. **Any policy change here must be made there too**, or the public
> rules stop matching the rules actually in force. The published copy
> deliberately omits references to internal-only documents (this file's
> `docs/*.md` siblings, `PRODUCT_BOUNDARIES.md`, sprint artifacts) so that it
> creates no links a reader cannot follow — the *policy* content is otherwise
> complete and unchanged. Added 2026-08-04, when it was found that the public
> page linked these docs on a private GitHub repo and 404'd for every visitor.

Date: 2026-07-20 (see `docs/governance-v1.1-hardening.md` for the 2026-07-12 v1.1 gap-closure update — eligibility snapshots, the proposal submission queue, and independently-validated RPC failure handling)
Route: `/governance/`, `/governance/proposal/?id=<id>`, `/governance/submit/`
Data model: `src/mole/governanceData.js`. Vote storage: `src/mole/governanceStore.js`. Eligibility snapshots: `src/mole/governanceSnapshot.js`. Submission queue: `src/mole/governanceSubmissions.js`. (All backed by `src/mole/storage.js`.)

## Purpose

Gives verified $WinLEW holders a structured, server-verified, permanent, public way to weigh in on community, feature, reward, and burn-program decisions — fulfilling the original roadmap's Phase 5 promise ("$WinLEW holders vote on feature proposals," "$WinLEW holders vote on token-burn schedules") without pretending a website vote executes a treasury or burn transaction by itself.

## Scope

Governance v1 applies to **WinLEW community matters only** — see `PRODUCT_BOUNDARIES.md` (from the prior Product Lead review) for the full reasoning. It explicitly does **not** govern:

- GeoWallet custody or signing architecture
- GeoAgora marketplace policy
- GeoJustice adjudication systems
- Oxyon architecture or philosophy
- Private keys, security controls, legal compliance obligations
- Emergency responses to active threats
- Infrastructure secrets
- Individual moderation cases
- Any decision belonging to an independent product

## Eligibility

Checked **server-side, every time** — never trusted from the browser, never cached indefinitely (60s TTL only, to avoid hammering RPC). Default v1 rule (see `GOVERNANCE_CONFIG` in `governanceData.js` — the one canonical place this lives):

1. Authenticated with the shared WinLEW session (same login as Dashboard/Quiz/Faucet — no second auth flow).
2. A verified, linked Solana wallet — reuses `getLinkedWalletRecord()`/`getWalletVerificationStatus()` from `src/mole/walletLink.js`, the exact function the Dashboard already uses (and the same link that unlocks Discord's `Verified WinLEW Holders` Linked Role — see `/governance/`'s own "How to unlock voting" section for the `/mole link` → `/verify/` → select-role walkthrough, with screenshots). No new wallet connector was built.
3. That wallet currently holds at least **1,000,000 WinLEW** (raised from 1 WinLEW on 2026-07-17, per the project owner's explicit request — the old figure was a near-zero formality, not a meaningful bar) — checked via `getOwnerTokenSnapshot()` from `src/mole/solana.js`, the exact function the Transparency Center and Burn Center already use for live balances.
4. One verified wallet = one vote.

A failed RPC balance check returns `eligible: null` (not `false`) — the frontend renders "Eligibility temporarily unavailable," never a false "not eligible." See "Failure handling" below. **v1.1 update:** once a proposal reaches its snapshot boundary, the first successful eligibility check for a wallet on that proposal is recorded immutably and reused for every later check — see "Token snapshot decision" and `docs/governance-v1.1-hardening.md`.

## Voting method and weighting

> **⚠ CORRECTED 2026-08-04 — this section was out of date.** It said "One
> verified wallet = one vote. No token-weighting in v1." That stopped being
> true on **2026-07-28**, when capped pay-per-vote weight shipped, and the
> section was never updated. `src/mole/web.js`'s vote route computes
> `totalWeight = 1 + voteWeight.purchasedWeight` **for every proposal**,
> `castVote()` stores that weight, and `computeResults()` tallies by it. Found
> during the public-content audit, after the stale text had already been
> published to `/governance/rules/`; both are now corrected.

**Every eligible verified wallet gets one free vote per proposal**, plus **up to
`MAX_PURCHASED_VOTES_PER_PROPOSAL` (10) purchased votes** on the same proposal —
a hard ceiling of **11 total weight** per wallet per proposal
(`MAX_TOTAL_WEIGHT = 1 + MAX_PURCHASED_VOTES_PER_PROPOSAL` in
`governanceStore.js`). Additional votes are `USD_PER_VOTE = $1` each, converted
to WinLEW by `governancePricing.js` from a 3-day sample window, falling back to
the more conservative of two sources when they diverge by more than
`DIVERGENCE_THRESHOLD` (15%).

The cap is enforced in `castVote()` itself (`safeWeight = Math.min(
MAX_TOTAL_WEIGHT, ...)`), not only where weight is allocated, so a bad caller
cannot smuggle a larger weight into a stored vote record.

**Note for maintainers:** the one seeded proposal still carries
`votingMethod: "one-wallet-one-vote"`, and the proposal detail page renders that
field as "Voting method" — so it currently displays a rule the vote path does
not follow. That record needs updating.

### Token snapshot decision

This repository has no historical-balance *indexer* — there is no way to answer "what did every wallet hold at block N" after the fact. Every live-balance feature (Transparency Center, Burn Center, this module) reads the *current* on-chain balance via `getOwnerTokenSnapshot()`. Given that honest constraint, the choices were:

1. **Unlimited token-weighted voting on current balance** — rejected. This would let one large holder trivially control every decision, and doing that by default (rather than as an explicit, examined choice) is exactly what the sprint's own instructions warn against.
2. **Capped token-weighted voting** — considered, adds real complexity (defining a cap, justifying the number) for marginal benefit over the simpler option below.
3. **One-wallet-one-vote after server-side holder verification (chosen)** — simplest, safest, and matches "Preferred order" item 1 from the sprint spec. A future version may reconsider capped weighting as a separate, explicit governance-rules proposal — not a default anyone backed into.

**v1.1 (2026-07-12):** eligibility is no longer purely "live at whatever moment you happen to check." Each proposal has a snapshot boundary (`snapshotAtIso`, defaulting to `votingStartIso`); the *first* successful eligibility check for a wallet on that proposal, at or after the boundary, is recorded immutably (`src/mole/governanceSnapshot.js`) and reused for every later check on that same proposal+wallet pair — a wallet can no longer change its own recorded eligibility by acquiring or disposing of tokens after that first check. This is still **not** a full chain-wide historical snapshot (a wallet never checked before voting closes simply never gets one) — see `docs/governance-v1.1-hardening.md` for the precise guarantee and its limits.

## Proposal lifecycle

`PROPOSAL_STATUSES` (17 states) with an explicit `VALID_STATUS_TRANSITIONS` map in `governanceData.js` — a proposal can never jump silently between states (e.g. `draft` → `executed` is not a valid transition; it must pass through `review`, `discussion`, `scheduled`, `active`, `passed`, `awaiting-ratification`/`approved-for-execution`, `executing`, `executed`). `archived` is a true terminal state.

Every status change should record a timestamp, actor/system, previous status, new status, and reason — for v1 (no admin UI, see "Proposal publishing" below) this is a maintainer's own commit history and message, not a separate audit-log feature.

## Proposal categories

Fixed, controlled enum (`PROPOSAL_CATEGORIES`) — 14 categories: Community, Features, Quiz, Faucet, Games, Events, Rewards, Proof of Value, Burn Program, Treasury Allocation, Partnerships, Grants, Governance Rules, Platform Policy. No free-form categories, so terminology never fragments across proposals.

## Governance modes

Every proposal declares one of four modes (`GOVERNANCE_MODES`) — never presented as uniformly "binding":

- **advisory** — informs a maintainer decision, no other effect.
- **community-approved** — the community's approval is the deciding factor for a low-stakes action a maintainer then carries out.
- **maintainer-ratified** — passing is necessary but not sufficient; a maintainer still ratifies before anything happens.
- **binding-within-defined-policy** — the closest to "binding" v1 offers, and even this never means automatic execution — see "Execution boundaries."

## Vote privacy

- Individual vote **choice is never made public** — not during voting, not after close (`voteChoicePrivacy: "private-until-never"` in `GOVERNANCE_CONFIG`). Only the authenticated voter can see their own choice (`GET /api/governance/my-vote/:id`).
- Aggregate results (counts, percentages, quorum, outcome) are always public.
- `computeResults()` never returns a per-wallet mapping — tested directly (`test/mole/governanceStore.test.mjs`'s privacy test asserts no wallet address ever appears in a serialized results payload).
- Never exposed anywhere in this module: session tokens, Discord OAuth data, IP addresses, device identifiers, internal anti-abuse markers, private moderation data.

## Vote-change rule

A voter **may update their choice until voting closes** — the latest valid choice replaces the prior one. Enforced by construction: votes are stored keyed by `walletAddress` within a proposal (`{ [proposalId]: { [walletAddress]: {...} } }`), so a second vote from the same wallet overwrites the first entry rather than needing separate duplicate-detection logic. `castAtIso` (first vote time) is preserved across updates; `updatedAtIso` reflects the latest change.

## Quorum

Proposal-specific (`quorumRule.minVotes`, a fixed eligible-vote count), never a percentage of all holders — this repository doesn't have reliable total-holder-count data, and inventing one would violate the sprint's own explicit instruction not to fabricate that figure.

## Approval threshold

- Simple proposals: **greater than 50%** of valid votes cast (`GOVERNANCE_CONFIG.defaultApprovalThreshold = 0.5`, strictly-greater-than — a 50/50 tie does not pass, tested directly).
- Governance-rules category proposals: **at least two-thirds** (`GOVERNANCE_CONFIG.governanceRuleChangeApprovalThreshold = 2/3`, also strictly-greater-than — exactly two-thirds does not pass, tested directly).
- A proposal may set `approvalThresholdOverride` to an explicit number if a specific proposal genuinely needs a different bar; absent that, the two rules above are the only defaults, defined in exactly one place (`computeApprovalThreshold()`).

## Anti-abuse and uniqueness

- **Duplicate votes**: impossible by construction (wallet-keyed storage, see "Vote-change rule").
- **Voting for another user**: impossible — the wallet is always resolved server-side from the session, never accepted from the client body.
- **Session replay / client-side eligibility bypass**: eligibility is re-checked server-side on every single vote request, not cached client-side or trusted from a prior response.
- **Concurrent submissions**: every read-modify-write in `governanceStore.js` happens synchronously within one Express request handler (no `await` between the read and the write), so two near-simultaneous requests cannot interleave mid-function — the same reasoning `src/quiz/db.js`'s `mutateDb()` already relies on. Tested directly with two concurrent votes from different wallets on the same proposal (both preserved) and two concurrent votes from the *same* wallet (exactly one survives, as expected — vote-change, not duplication).
- **Voting outside the active window / on a cancelled proposal**: `castVote()` checks `VOTABLE_STATUSES` and the `votingStartIso`/`votingEndIso` window independently of what the frontend believes.
- **Malformed choices**: `castVote()` rejects any choice not in the proposal's own `choices` array.
- **Duplicate proposal IDs**: `findDuplicateProposalIds()`, tested against the seeded data.
- **Result manipulation by frontend code**: impossible — `computeResults()` is the only source of truth and runs server-side; the frontend only ever displays what the API returns.

## Proposal publishing (v1)

No CMS, no unauthenticated public proposal-creation endpoint. `PROPOSALS` is still a maintainer-edited array in `src/mole/governanceData.js`, published the same way `BURN_EVENTS`/`PARTNERS`/`EVENTS` already are: edit the file, run `node --test test/mole/governanceData.test.mjs` to confirm the record validates, commit, push. **v1.1 adds a community submission review queue** (`/governance/submit/`, `src/mole/governanceSubmissions.js`) that lets anyone with a verified wallet submit a proposal *idea* for maintainer review — but a submission can never publish itself; turning an approved submission into a real `PROPOSALS` entry is still this exact same manual, maintainer-owned step. See `docs/governance-v1.1-hardening.md` and `docs/governance-submission-review-workflow.md`.

**Discord notification (added 2026-07-17):** every successful `POST /api/governance/submissions` also best-effort-posts a summary to a Discord webhook (`cfg.GOVERNANCE_WEBHOOK_URL`, optional — silently skipped if unset, same as every other webhook in this codebase). `sendGovernanceSubmissionMessage()` (`src/mole/web.js`) sends it — a webhook outage never fails the submission itself, since the record is already durably written before the notification is attempted. Because `title`/`summary` are user-supplied free text (unlike every other value this codebase's webhook messages interpolate — Discord ids, wallet addresses, balances are all server-resolved), the payload sets `allowed_mentions: { parse: [], users: [submitterDiscordId] }` explicitly: this blocks a submitter from embedding `@everyone`/`@here`/a role mention in their own title/summary and having it actually fire, while still allowing the one legitimate, system-controlled "credit the submitter" mention. Covered by `test/mole/governanceSubmissionWebhook.test.mjs`.

## Burn proposal handling

A `burn-program` category proposal must carry a `burnDetails` object (proposed amount, source, benchmark/date, reason, effect on the 100M goal, execution authority, execution deadline) — enforced by `validateProposalRecord()`. The proposal detail page fetches the **canonical, live** Burn Center totals via `GET /api/burn/status` (never a second hardcoded figure) to show current verified-burned, staged, and remaining-to-target alongside the proposal's own ask.

**A successful vote never executes a burn.** The lifecycle is exactly:

```
Proposal → Vote → Result → Maintainer safety review → Approved for execution
  → Separate, manually authorized burn transaction (outside this codebase)
  → On-chain confirmation → Burn Center event (BURN_EVENTS entry) → Governance execution record
```

No signing capability, private key handling, or transaction-broadcast code exists anywhere in Governance v1 — see "Execution boundaries" below. "Donate to Burn" is explicitly **not** implemented this milestone (see Remaining Gaps in the sprint report).

## Feature proposal handling

A `features` category proposal captures problem/proposed change/community benefit/affected systems/scope/risks/estimated effort/dependencies/alternatives/success criteria/maintainer feasibility review as free-text fields on the proposal record. A vote never forces an unsafe or impossible implementation — after passage, a maintainer classifies it (accepted / accepted-pending-prerequisites / requires-revision / unable-to-execute / rejected-on-safety-or-legal-grounds) via the `finalDecision`/`maintainerPosition` fields, with any refusal requiring a public reason (`cancellationOrRejectionReason`).

## Maintainer ratification

`maintainer-ratified` and `binding-within-defined-policy` modes both require a human decision after a vote closes — reflected in the `awaiting-ratification` → `approved-for-execution` status transition. There is no code path that skips this step.

## Emergency boundaries

Governance has no relationship to incident response. An active security threat is handled entirely outside this module, by maintainers, exactly as established platform-wide — a vote-gated emergency response would be a contradiction (emergencies need speed, not a multi-day voting window).

## Execution boundaries

**No signing, no treasury access, no burn-execution capability exists anywhere in Governance v1.** Concretely:

- `POST /api/governance/vote` only ever writes to `governance_votes.json` via `governanceStore.js`. It has no import of `@solana/web3.js`'s signing path, no access to any keypair, and no code path that constructs or broadcasts a transaction.
- Every route in `src/mole/web.js`'s Governance block is read-only against on-chain state (`getOwnerTokenSnapshot` for eligibility, `GET /api/burn/status` for the canonical burn totals) or read/write only against the local vote store.
- A passed proposal's `executionStatus`/`executionEvidence` fields are populated **after the fact**, once a maintainer has manually executed something *outside this codebase* and supplied evidence (a transaction signature, a commit link) — the same pattern the Burn Center already uses for its own confirmed events.

## Historical archive

Rejected, quorum-not-met, and cancelled proposals are **never deleted** — they remain visible in the `/governance/` archive tab exactly like passed/executed ones. Governance credibility requires preserving unsuccessful decisions too.

## Security model

- All identity/wallet resolution reuses existing, already-audited-by-use infrastructure (`getSession`, `getLinkedWalletRecord`, `getWalletVerificationStatus`, `getOwnerTokenSnapshot`) — no second implementation of any of these.
- Rate limiting on every route (`simpleRateLimit`, matching every other mutating route on the site).
- Content-safety floor in `validateProposalRecord()` rejects raw `<script` in text fields at the data-model level (defense in depth — the render layer escapes everything regardless).
- Tests confirm no sensitive field (private key, secret key, seed phrase, keypair, Discord token, bot token, session token, IP address) ever appears in a vote-cast or results response.

## Security hardening review (2026-07-17)

Prompted by the project owner's explicit request to audit the module for exploit vectors ("evidence over assumptions") rather than trust the design docs at face value. Findings, verified against the actual code (not just this document's prior claims):

- **Verified solid, not just asserted:** `castVote()`/`createSubmission()` really do read-check-write synchronously with no `await` between (tested directly — `governanceStore.test.mjs`, `governanceSnapshot.test.mjs` both have concurrent-write tests, not just a comment claiming safety). IDOR-checked: submission detail/withdraw routes return `submission_not_found` (never a distinguishing "not yours") to non-owners. Maintainer gate (`isGovernanceMaintainer`/`MOD_IDS`) has no bypass path, and maintainers vote through the identical eligibility path as anyone else — no special-cased privilege. RPC-failure handling never collapses to a false "ineligible" and never caches a failure.
- **Fixed:** the new proposal-submission Discord webhook (see "Proposal publishing" above) explicitly guards against mention-injection from user-supplied free text via `allowed_mentions`.
- **Not fixed, deliberately — documented instead:** `src/mole/walletLink.js`'s `completeLink()` has no check preventing a Discord account from relinking to a different wallet at any time, and the v1.1 snapshot lock-in only records the *first* balance check at/after a proposal's boundary — it has no minimum holding-duration. In principle, a wallet could be funded briefly right at a proposal's snapshot boundary and drained afterward. **Raising the minimum balance to 1,000,000 WinLEW raises the real cost of this, it does not close it.** A duration-based fix isn't buildable without a historical-balance indexer this repository doesn't have (see "Token snapshot decision" above) — rather than ship a partial heuristic that could falsely exclude a genuine holder who happens to re-verify near a snapshot boundary, this limitation is now stated plainly on the public `/governance/` page itself (its "Voting eligibility" section), not left implicit in this doc alone.
- **Structural, not a bug:** wallet-based one-vote can never fully prevent one person controlling multiple funded wallets and Discord accounts — no KYC exists or is planned. This was already true before this review; it's now stated explicitly on the public page rather than only in this document.

## Known limitations

1. **No full chain-wide historical holder snapshot.** v1.1 added a narrower, honest per-proposal eligibility lock-in (see "Token snapshot decision") — but there is still no indexer that can answer "what did every wallet hold at block N." A wallet never checked before voting closes never gets a recorded snapshot at all. See `docs/governance-v1.1-hardening.md` for the exact guarantee.
2. **No maintainer review UI (yet) for the submission queue.** v1.1's `/governance/submit/` lets the community submit and track their own drafts, and the review API (`/api/governance/submissions/:id/review`) is fully built and tested — but there is no dedicated admin page for it yet; maintainers act via the API directly. See `docs/governance-submission-review-workflow.md`.
3. **No on-chain execution automation, by design** — see "Execution boundaries." This is a permanent v1 boundary, not a temporary gap.
4. **No admin UI for status transitions.** Status changes are git commits, not a dashboard action — matches how `BURN_EVENTS`/`PARTNERS`/`EVENTS` already work.
5. **Only one real, seeded proposal exists at launch** (the Governance Launch record itself, informational) — no fabricated voting history. The first real community vote will be the platform's actual first governance test.
