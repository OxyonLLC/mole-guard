# WinLEW Governance v1.1 — Gap Closure and Hardening

Date: 2026-07-12
Closes three confirmed gaps from the Governance v1 report: no point-in-time eligibility snapshot, no community proposal-submission review queue, and RPC-failure behavior that had not been independently forced in live validation. Governance v1's design (`docs/governance-v1.md`) was not redesigned — this is additive hardening only.

## 1. Point-in-time eligibility snapshot

**What it is:** each proposal has a snapshot boundary — `proposal.snapshotAtIso`, defaulting to `votingStartIso` if unset (`resolveSnapshotBoundaryIso()` in `src/mole/governanceData.js`). The *first* successful eligibility check for a given wallet on a given proposal, performed at or after that boundary, is recorded immutably in `governance_eligibility_snapshots.json` (`src/mole/governanceSnapshot.js`) and reused for every later check on that same proposal+wallet pair. A later balance change — up or down — never alters the recorded result.

**What it is honestly NOT:** this is **not** a full chain-wide historical holder snapshot. This repository has no indexer capable of answering "what did every wallet hold at block N" after the fact. Concretely:

- A wallet that is never checked (via the eligibility endpoint or a vote) before a proposal's snapshot boundary passes, and is also never checked after, simply never gets a recorded snapshot — the standing per-proposal eligibility check still uses the boundary/lock-in logic, but nothing is retroactively computed for wallets that were never observed.
- The snapshot is only as good as whichever moment the *first* check happens to land on — if a wallet's balance genuinely fluctuates around the boundary moment and the first check happens a few seconds after real acquisition, that's the value that locks in, not necessarily "balance exactly at `snapshotAtIso`."
- Switching to a different wallet is treated as a different identity entirely — a user cannot "carry over" an old wallet's locked-in eligibility to a new one; the new wallet gets its own fresh first-check.

**Failure safety:** a failed (RPC-unavailable) check is **never** recorded as a snapshot — `resolveSnapshotEligibility()` returns `{ eligible: null, snapshot: null }` and leaves the door open for the next attempt (by the same or a different concurrent caller) to try again fresh.

**Concurrency:** two simultaneous first-checks for the same proposal+wallet cannot both win — `resolveSnapshotEligibility()` re-reads the store immediately before writing (no `await` in between), so whichever call's live balance check resolves first commits the record; the other observes and returns that same winning record instead of overwriting it. This mirrors the same synchronous read-check-write reasoning `governanceStore.js`'s `castVote()` already relies on.

**Where it's visible:** `GET /api/governance/eligibility/:id` returns `preview: true/false` and a `snapshot` object (`{ snapshotAtIso, recordedAtIso, source }`) whenever one exists. The proposal detail page (`/governance/proposal/`) renders this as a note under "Your status": either "Live preview — hasn't reached its snapshot boundary yet" or "Locked in at \<time\> (boundary: \<time\>)."

**Tests:** `test/mole/governanceSnapshot.test.mjs` (13 cases) — balance above/below threshold at snapshot time, later balance changes not affecting the locked result (both directions), repeated checks returning the identical record, wallet-switch independence, concurrent first-checks, RPC failure never recording, retry-after-failure succeeding, the record being immune to being overwritten by a later call even with a different live result, and per-proposal isolation for the same wallet.

## 2. Community proposal submission review queue

**What it is:** `/governance/submit/` lets any authenticated user with a verified linked wallet submit a proposal idea. `POST /api/governance/submissions` creates a record with status `submitted` — **never** anything more. There is no code path anywhere in `src/mole/governanceSubmissions.js` or its routes that can set a submission's `published` flag to `true` or insert it into the canonical `PROPOSALS` array. Turning an `approved-for-drafting` submission into a real, votable proposal is a manual, out-of-band maintainer action (editing `src/mole/governanceData.js`, exactly like every other v1 proposal) — see `docs/governance-submission-review-workflow.md` for the full lifecycle and the maintainer's side of it.

**Identity and safety:**
- Requires an authenticated WinLEW session and a verified linked wallet, both resolved server-side (never trusted from the client body).
- Field limits enforced server-side (title 200 chars, summary 1000, problem/outcome 3000, others 1000–2000).
- Content is rejected outright (never silently stripped) if it matches a pattern for raw HTML/tags, `javascript:`/`data:text/html` links, PEM private-key blocks, seed/recovery/mnemonic phrase mentions, API/secret key assignments, byte-array-shaped private key dumps, long base58 blobs, or treasury-transfer/burn-execution instruction phrasing. **This is pattern-based, not a guarantee** — a sufficiently obfuscated secret could still slip past regex matching. It is a floor, not a substitute for "never paste a secret into a web form."
- Duplicate protection: the same user resubmitting an identical (normalized) title within 24 hours is rejected as a duplicate.
- Volume/spam protection: a user capped at 5 simultaneously-open submissions (`submitted`/`under-review`/`revision-requested`), plus a per-IP route rate limit (6 requests/minute) independent of the per-user cap.
- Ownership: `GET /api/governance/submissions/:id` returns 404 (not 403) for a non-owner, non-maintainer caller — existence of another user's submission is never distinguishable from it not existing at all.

**Review lifecycle:** `submitted → under-review → {revision-requested → under-review, approved-for-drafting, rejected} → archived` (plus `withdrawn`, owner-only, from `submitted`/`revision-requested`). Every transition is validated against an explicit map (`VALID_SUBMISSION_TRANSITIONS`) — no skipping straight from `submitted` to `approved-for-drafting`. `rejected` and `revision-requested` both require a non-empty `reason`; every transition appends an entry to `statusHistory` (status, timestamp, acting maintainer's Discord id, reason) rather than overwriting the prior state — this is the audit trail.

**Maintainer auth:** reuses `MOD_IDS` (`.env`), the same Discord-id allowlist `src/faucet/bot.js`'s moderator commands already gate on — no new admin mechanism was invented.

**Tests:** `test/mole/governanceSubmissions.test.mjs` (26 module-level cases: field validation, unsafe-content patterns, duplicate/spam protection, ownership, review transitions, reason requirements, no-auto-publish assertions) and `test/mole/governanceSubmissionsRoutes.test.mjs` (12 HTTP-level cases against a live, isolated instance of the real server: unauthenticated rejection, unverified-wallet rejection, a valid submission receipt, unsafe-content rejection at the route, per-IP rate limiting, ownership boundaries on both the detail and "mine" endpoints, maintainer-only gating on list/review, rejection-reason enforcement, and owner-only withdrawal).

**Not yet built:** a dedicated maintainer review admin page. The review API is complete and tested; maintainers currently act on it directly rather than through a UI. Flagged as a real, honest gap for a future iteration — not built this sprint, since it wasn't one of the three confirmed gaps this sprint was scoped to close.

## 3. RPC failure — independently validated

Fault injection uses **dependency injection**, not a fake endpoint pointed at from production code. `checkLiveWinlewEligibility()` and `resolveGovernanceEligibility()` (`src/mole/web.js`) accept an optional `getBalance` override that defaults to the real `getOwnerTokenSnapshot` import; production code paths never supply an override, only tests do.

**A real bug found and fixed during this hardening pass:** the pre-existing v1 eligibility cache stored *both* successful and failed lookups for the same 60-second TTL. That meant a real RPC outage, once observed, would keep reporting "unavailable" for up to 60 seconds after the outage actually cleared — undermining "retry succeeds once the fault clears." Fixed: only successful checks are cached now; a failed check is never cached, so the very next call after a fault clears performs a fresh live check.

**Automated coverage** (`test/mole/governanceRpcFailure.test.mjs`, 6 cases, using a stub `getBalance` that throws a realistic error including a fake RPC URL and stack trace): confirms `eligible` resolves to `null` (never `false`), `balance` resolves to `null` (never a false `0`), `balanceCheckOk` is `false` with reason `balance_check_unavailable`, none of the injected URL/stack-trace/error text appears anywhere in the JSON-serialized result, a failed check is never cached (immediate retry with a working stub succeeds), and a successful check *is* still cached as expected.

**Live local walkthrough:** ran the real server (`startWeb()`) against an isolated scratch data directory with `SOLANA_RPC` pointed at an unreachable local port, and separately at a valid public endpoint that this sandbox could not reliably reach within the 8-second RPC timeout ceiling (`RPC_TIMEOUT_MS` in `src/mole/solana.js`) — both are genuine failure conditions the real `getOwnerTokenSnapshot()` code hit unmodified, not a stub. Confirmed live, over real HTTP requests to the real routes:

- `GET /api/governance/eligibility/:id` returns HTTP 200 with `eligible: null`, `balance: null`, `balanceCheckOk: false` — never a 500, never a false negative.
- `POST /api/governance/vote` returns HTTP 503 with `{ error: "eligibility_check_unavailable" }` — voting is blocked, never silently treated as "not eligible."
- `GET /api/governance/proposals` (public proposal list/results) returns HTTP 200 normally — an RPC outage on the eligibility path does not take down unrelated public data.
- No RPC URL, stack trace, or raw error text appeared in any response body.

**Honest limitation of the walkthrough itself:** the "fault clears, retry succeeds" half of the walkthrough could not be conclusively demonstrated live in this sandboxed execution environment — the real public Solana RPC endpoint this project is configured with (`SOLANA_RPC` in `.env`) was itself slow/unreachable from within this specific sandbox for the exact `getParsedTokenAccountsByOwner` call, independent of anything in this sprint's code (a direct `curl` to the same endpoint from the same sandbox responded in under half a second for a *different* RPC method, so this looks like an environment-specific network characteristic, not a code defect). That positive "recovery" path **is** conclusively proven, deterministically, by the automated test's dedicated "retry succeeds once the fault clears" case, which uses a controlled stub with no third-party dependency. Recommended: re-run the live walkthrough once in a normal (non-sandboxed) deployment environment to close this out with an unambiguous live positive result too.

## Future consideration (explicitly not built this sprint)

The user separately raised the idea that "anything done on the website should send a log to the log channel" (a general website-wide audit-log-to-Discord feature). That is a real, reasonable idea, but this sprint was explicitly scoped to only the three gaps above — it has not been designed or implemented, and is noted here purely so it isn't lost, not as a commitment to build it next.

## Remaining, permanent limitations (carried forward from v1, still true)

- No full chain-wide historical holder snapshot (narrowed but not eliminated by gap 1 above).
- No on-chain execution automation, by design — no signing, treasury access, or burn-execution capability exists anywhere in Governance code, v1 or v1.1.
- No admin UI for either proposal-status transitions or submission review (both remain API/file-edit driven).
