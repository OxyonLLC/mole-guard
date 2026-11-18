# Phase 4F-S2: Approval A reconstruction — STOPPED

Follow-up: [S2R hotfix verification](phase4f-s2r-hotfix-report.md) corrected the
resolver defect and passed the reconstructed suite. The historical 38/38 remains
unreproduced.

Date: 2026-10-11. **Approval A is NOT reproduced.** The historical 38/38 remains
**HISTORICALLY REPORTED PASS — NOT REPRODUCED IN THIS SESSION**. This replacement
suite is separately identified; its count is not intended to match 38.

## Baseline and exact changes

Branch before changes and after testing: `xl1-control-center`.
HEAD: `23e3d4bd4eb5eea362fb0439fe4111230c4b0070`.
Initial `git status --short` showed 47 modified tracked files (mobile launcher,
package script, earlier faucet/mole/quiz isolation changes and tests, Phase 3B
artifacts, public UI and GeoAgora assets), plus existing untracked audit tools,
isolation tests, S1 report, `.test-tmp/` and Phase 3B SFTP helper. All existing
modifications were preserved. These are not S2 changes.

S2 changed these six source/documentation files only:

- `test/mole/approvalAReconstructed.test.mjs`: new synthetic HTTP regression,
  17 named leaf checks plus one parent; currently unverified.
- `tools/test-audit/policy.cjs`: fixed one-file Stage C manifest; protected
  files/trees unchanged; no Stage D manifest.
- `tools/test-audit/run.cjs`: usage message includes C; supervisor logic unchanged.
- `test/support/run-isolated.cjs`: accept C, delegate to the same supervisor.
- `docs/phase4f-s2-approval-a-report.md`: this report.
- `docs/phase4f-s1-audit-report.md`: forward reference to this report.

Runtime artifacts are confined to the three new `.test-tmp/audit-*` directories
below. No application/production code, guard rule, production default, wallet
ownership, session, scoring or reward semantics changed. No reset, clean, stash,
checkout, commit, push, deployment or dependency installation occurred. The 16
historical claim temporary files were not modified or deleted.

## Historical evidence and failure diagnosis

Reviewed the S1 report/coverage map, recovered script, relevant tests/application
sources and available session evidence. Recovered artifact:
`src/public/.tmp-audit/phase4fr-isolated-verification.mjs`.
SHA-256: `ccba65a4e6e5a33fe73c2e7414673e5da269ae9f5ccf901fff3faec0d2d4ee11`.
It was not edited or executed. Historical command:
`node .tmp-audit/phase4fr-isolated-verification.mjs`, working directory `src/public`.
Session provenance:
`C:/Users/Lando/.codex/sessions/2026/10/08/rollout-2026-10-08T21-12-36-01a11ea5-fb1a-7a71-8770-2648855e0cc8.jsonl`.

Recovered outputs show successful signed login and invalid/replayed signature
rejection, then profile failures; zero reconciliation POSTs were recorded. No
successful complete 38-test manifest/transcript was recovered. A related failed
script does not establish the historically reported successful run.

| Candidate cause | Evidence-based classification |
| --- | --- |
| Environment / isolation paths | Established setup problem: old script omitted current quiz and linked-wallet mirror overrides. Logs reached faucet protected reads, ultimately `mkdirSync:src/quiz/data`. |
| Temporary/RPC fixtures | Old mint was an invalid public-key placeholder and RPC used an unserved loopback port; additional setup defects, not application-defect proof. |
| Invocation | Historical command and working directory recovered; no evidence invocation explains the profile failures. |
| Missing dependencies | No recovered missing-package error establishes this cause. S2 instead blocks an installed dependency's static data. |
| Actual application defect | Not established by these setup failures. Current Approval A behaviors remain unverified. |

The old script fingerprints production files in-process, installs a partial
guard, suppresses intervals and forces exit. It is not safe to execute as the
current verification entrypoint. The reconstruction uses supervisor-preloaded
guarding, sanitized environment, disposable stores, synthetic message-signing
keys, and a deterministic loopback JSON-RPC server. Only read-only RPC methods
are implemented; no transaction submission or external fallback is provided.
Application authentication/session/reconciliation implementations stay real.

## Behavior coverage matrix

VERIFIED requires reproducible passing automation. PARTIAL means related tests
exist but do not establish the full behavior. HISTORICAL means previously
reported but not currently reproduced; MISSING means no adequate test evidence.
All seven required groups remain PARTIAL. The overall historical 38/38 claim is
HISTORICAL. No required Approval A group is VERIFIED in this S2 run.

All new checks below are in `test/mole/approvalAReconstructed.test.mjs`.
Exact command for every row: `node tools/test-audit/run.cjs C`, repository root.
Evidence for every row: `.test-tmp/audit-C-vs0NuO/report.json` and `test-0.tap`.
Counts are planned leaf checks, NOT executed test or assertion counts.

| Behavior | Classification | Planned checks and lines | Result / limitations |
| --- | --- | --- | --- |
| Ed25519 authentication/signature validation | PARTIAL | Valid A/B login, wrong signer, malformed signature: 3; lines 144, 166, 181 | NOT RUN. Related `accountSyncRoutes.test.mjs` and old script are not current passing proof. |
| Replay and altered-message rejection | PARTIAL | Replay, altered message: 2; lines 160, 174 | NOT RUN. No wallet-challenge-expiration claim. |
| A/B profile authorization/isolation | PARTIAL | Forged selectors, anonymous/invalid sessions, owner/public view: 3; lines 187, 197, 204 | NOT RUN. `profileByWalletPrivacy.test.mjs` is related; passing preference storage tests do not prove HTTP authorization. |
| Private history separation | PARTIAL | Session-authoritative A/B history: 1; line 217 | NOT RUN. Forged account/guest selectors must not redirect authenticated history. |
| Guest history separation | PARTIAL | Guest A/B/member namespaces: 1; line 225 | NOT RUN. Namespace separation, not secret guest ownership authentication. |
| Session expiration/revocation | PARTIAL | Controlled clock and HTTP logout: 2; lines 233, 247 | NOT RUN. `nativeHandoff.test.mjs`/`webHandoff.test.mjs` are related but not S2 proof. |
| Reconciliation idempotency/accounting | PARTIAL | Invalid requests, capped/repeated POSTs, additional guest, independent below-cap B credit: 4; lines 257, 264, 280, 287 | NOT RUN. Exact intended totals: A 4518 then 4523; B 42, including gap credit 7. Related `rewardIdentitySync.test.mjs` is not current HTTP proof. |
| Fixture prerequisites (additional) | PARTIAL | Read-only RPC used and Mongo disabled: 1; line 300 | NOT RUN. |
| Existing guard/storage regression | VERIFIED | Fixed A/B manifests | 6 + 166 passed; not equivalent to Approval A. |

Syntax passed: `node --check test/mole/approvalAReconstructed.test.mjs`.
New test SHA-256:
`a2e28736192af4a2e6ad852a224ca9e96ff6743a777d212b254b04146651969e`.
The test is unvalidated beyond syntax/import startup; subsequent fixture or
assertion defects may exist. Intended outcomes are not passing evidence.

Privacy limits found by inspection: the existing public wallet profile includes
a bounded game-history preview and aggregates. These checks do not claim all
game history is secret on every public surface. Guest IDs are namespace
selectors, not independently authenticated owner credentials. Neither behavior
was changed or represented as a stronger authorization guarantee.

## Staged execution and exact stop

Commands executed in order from repository root:

```text
node --check test/mole/approvalAReconstructed.test.mjs
node tools/test-audit/run.cjs A
node tools/test-audit/run.cjs B
node tools/test-audit/run.cjs C
```

| Stage | Pass | Assertion failures | TAP skipped | Outcome / evidence directory |
| --- | ---: | ---: | ---: | --- |
| A | 6 | 0 | 0 | PASS; `.test-tmp/audit-A-ZohCqG/` |
| B | 166 | 0 | 0 | PASS; `.test-tmp/audit-B-ZO8NxM/` |
| C | 0 | 0 | 0 | STOP / failed verification before leaf tests; `.test-tmp/audit-C-vs0NuO/` |
| Broader suite | — | — | — | NOT ATTEMPTED |

Stage B exact file counts: `test/mole/profilePrefsIsolation.test.mjs` 1;
`test/quiz/quizStorageIsolation.test.mjs` 5;
`test/quiz/db-platform-stats.test.cjs` 64;
`test/shared/managedWriteDurability.test.mjs` 12;
`test/faucet/storageBanWipe.test.mjs` 8;
`test/faucet/claimStore.test.mjs` 37;
`test/faucet/service.test.mjs` 6;
`test/faucet/userBans.test.mjs` 12;
`test/faucet/walletBans.test.mjs` 21.

C started `2026-10-11T17:48:58.672Z`; final post-audit completed
`2026-10-11T17:49:05.504Z`. Exact unexpected violation:

```text
kind: protected read
path: C:\Users\Lando\Documents\Projects\2027\2028\WinLEW\Mole-Guard\node_modules\mime-db\db.json
operation: fs.realpathSync during Node CommonJS module resolution
guard: test/support/isolation-guard.cjs:45 (checkRead), :55 (wrapper)
rule: test/support/isolation-policy.cjs:26, :33 (protected basename db.json)
```

Read-only dependency trace after stopping:
`express/lib/request.js:16` -> `accepts/index.js:16` ->
`mime-types/index.js:15` -> `mime-db/index.js:12` -> `./db.json`.
The static MIME dependency database collides with all-locations basename
protection. It is not a member-store request, but the protected boundary was
reached and execution stopped. C report: `signal: SIGTERM`, no timeout, one
unexpected violation, `guardVerified: false`. Zero TAP failures is NOT success;
all 17 intended leaf checks remain unexecuted, not TAP-skipped.

No exception, dependency copy, preload bypass, broad `node_modules` permission,
guard edit or rerun was attempted. Further execution requires approval to resolve
this dependency-data boundary narrowly while preserving persistent-read protections.

## Protected-data, network and subprocess audit

All three post-audits completed, including after the terminated C child:
`complete: true`, `integrity: unchanged`, `differences: []`. Each inventory has
69 files, 6 directories and 1 missing path (76 entries). Per-file content hashes,
size, mtime and mode are unchanged; no protected additions/removals. All 16
historical `claims_v3.json.tmp-*` files are included and unchanged.

All six saved `before.json`/`after.json` snapshots are byte-identical, including
across stages. SHA-256 of each inventory artifact:

`cdfc8ab9a05c08977d4a2772b50a69c8818b22f66340c38cedd70ee8a23cd852`

This hashes the inventory containing per-file hashes, not concatenated protected
contents. Exact before/after file hashes are saved in each evidence directory.
No protected contents were printed or made available to guarded tests.

| Stage | Deliberate blocked probes | Unexpected violations | Instrumented socket connections | Approved guarded child processes | Mongo |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 5 | 0 | 0 | 0 | Disabled |
| B | 0 | 0 | 0 | 2 exact service import probes, inherited guard | Disabled |
| C | 0 | 1 protected-read block | 0 | 0 | Disabled |

A probes cover outside writes, `.env` reads, persistent reads, external network
and unapproved children. Supervisor launches (one A, nine B, one C) are separate
from guarded child counts and use fixed reviewed manifests. C created a test-owned
loopback RPC listener before the import block, but made no connection to it and
never reached the application listener. The OS reclaimed it on child termination.

No production request, real wallet signature, payout, claim, transfer or
production reconciliation occurred. C's synthetic signatures/reward fixtures
were not reached; B uses only disposable fixtures. A's deliberate external probe
was blocked before connection. No OS packet capture was collected; network
conclusions refer to instrumented executed paths, not global host traffic.

## Limitations and recommendation

The guard remains a Node regression tripwire, not a hostile-code OS sandbox.
S1 limitations remain for native bindings, workers, descriptor/symlink edges,
unconnected UDP/DNS, fixed audit inventory and forced supervisor termination.
An absent final audit report means incomplete verification. S1 failure/abrupt-exit
audit results were not rerun; C provides a new completed post-audit after termination.

**NO-GO for broader-suite testing or claiming Approval A reproduced.** A/B and
protected integrity passed; C is blocked and provides no passing behavioral
evidence. Approval is needed before resolving the dependency-data boundary and
rerunning. Do not use unguarded `npm test` or the historical script as a workaround.
