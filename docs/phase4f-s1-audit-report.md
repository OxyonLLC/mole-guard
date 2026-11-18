# Phase 4F-S1: protected fingerprint audit boundary

Date: 2026-10-11. Scope: test harness and audit only.

Follow-up: [Phase 4F-S2 evidence and stopped reconstruction](phase4f-s2-approval-a-report.md).
The S1 results below remain unchanged; S2 does not establish Approval A reproduction.

Branch before/after: `xl1-control-center`.
HEAD before/after: `23e3d4bd4eb5eea362fb0439fe4111230c4b0070`.
The starting dirty worktree was recorded in the session before edits. Existing
production, UI, mobile, Phase 4F-R and Phase 4F-S changes were retained. No
production source file was edited in S1. No commit, reset, stash, cleanup, push,
deployment or production request was performed.

## Exact S1 file changes

| File | Purpose |
| --- | --- |
| `test/mole/profilePrefsIsolation.test.mjs` | Remove protected-file fingerprinting; retain disposable-store assertions; require isolated execution. |
| `test/quiz/quizStorageIsolation.test.mjs` | Same boundary correction for quiz/faucet/mirror integration tests. |
| `test/quiz/db-platform-stats.test.cjs` | Move the identical third fingerprint pattern out of guarded tests; retain its 64 functional assertions/tests. |
| `test/support/run-isolated.cjs` | Route the existing npm isolation entrypoint through fixed audited stages. |
| `test/support/isolation-policy.cjs` | Align protected reads with the auditor's fixed paths; limit subprocesses to the two existing import programs with the guard inherited. |
| `test/support/isolation-guard.cjs` | Distinguish expected probes; terminate on unexpected violations; emit guard/Mongo audit summaries; guard mkdtemp; handle Node's normalized socket arguments. |
| `test/support/isolationGuard.test.cjs` | Add metadata-comparison coverage and reject importing the auditor as a protected-read API. |
| `tools/test-audit/policy.cjs` | Fixed protected files/trees and reviewed stage manifests; no arbitrary CLI paths. |
| `tools/test-audit/run.cjs` | Standalone read-only integrity supervisor with pre/post snapshots, sanitized child environment, serial disposable runs, failure/interrupt handling and reports. |
| `tools/test-audit/compare.cjs` | Pure comparison of snapshot metadata; no filesystem access. |
| `tools/test-audit/fixtures/failure.cjs` | Intentional assertion failure to exercise supervisor finalization. |
| `tools/test-audit/fixtures/exit.cjs` | Intentional abrupt child termination to exercise supervisor finalization. |
| `docs/phase4f-s1-audit-report.md` | This report, commands, provenance and limitations. |

Generated evidence is retained under `.test-tmp/audit-*`; these are disposable
test artifacts, not production data. No historical claim temporary was removed
or rewritten.

## Boundary and reproduction

Run from the repository root:

```text
npm run test:isolated -- A
npm run test:isolated -- B
```

The supervisor hashes only the fixed files/trees in `tools/test-audit/policy.cjs`.
It records directory/file/missing state, SHA-256, size, modification time and
mode. Symlinks/junctions in audited paths are refused. Missing paths are recorded
explicitly, so later creation is an integrity failure. Snapshot errors also fail
verification. Protected bytes are never printed, exported or passed to tests.

Each test file gets a separate disposable root. `TEMP`, `TMP`, `TMPDIR`,
`DATA_DIR`, quiz/faucet stores and linked-wallet mirrors resolve below that root.
The child inherits only selected OS variables, synthetic application values,
Mongo disabled, loopback RPC URLs and the guard preload. It does not inherit
shell credentials, proxies or arbitrary Node preload options.

The external auditor cannot be imported by tests, accepts only reviewed stage
names, and offers no path/read API. Guarded tests still cannot fingerprint or
read protected files. Reports are outside each child's writable root. The two
approved service probes inherit the guard and must match their exact import-only
programs. Unexpected violations exit the child immediately with code 86; the
supervisor stops scheduling files and completes the post-test comparison.

## Results

| Stage | Passed | Failed | Test-runner skipped | Outcome |
| --- | ---: | ---: | ---: | --- |
| A: guard and comparator self-tests | 6 | 0 | 0 | PASS; clean integrity audit |
| B: previous isolation/storage tests | 166 | 0 | 0 | PASS; clean integrity audit |
| C: Approval A regression | — | — | — | Not run: exact original 38-test manifest/result not recovered |
| D: broader suite | — | — | — | Not run: Stage C prerequisite remains unmet |

Stage B counts: profile preferences 1; quiz/faucet/mirror isolation 5;
quiz database/platform tests 64; managed-write durability 12; ban-storage pins 8;
faucet claim store 37; faucet service 6; user bans 12; wallet bans 21.

Five deliberate guard violations were caught in Stage A: outside-root write,
credential metadata read, persistent-data read, external TCP connection and
unapproved subprocess. They are marked `[isolation:expected]`. Unexpected guard
violations in A/B: **0**. Stage A additionally verifies the pure comparator's
content/addition/removal/metadata handling and that tests cannot import the auditor.

Supervisor probes are separate from application test counts:

```text
node tools/test-audit/run.cjs audit-failure
node tools/test-audit/run.cjs audit-exit
```

Both deliberately return nonzero. The first contains one intentionally failed
assertion; the second sends SIGTERM to itself before test teardown (Windows
reported child exit 1). Both still wrote `after.json`, compared protected state,
and reported `integrity: unchanged`. A prior Stage A launch failed before tests
because of Windows NODE_OPTIONS path escaping; its post-audit also completed.
That path was corrected before the passing runs.

Final evidence:

- [Stage A report](../.test-tmp/audit-A-WvTKf9/report.json)
- [Stage B report](../.test-tmp/audit-B-k3JnmB/report.json)
- [Intentional assertion-failure report](../.test-tmp/audit-audit-failure-sX4ZUh/report.json)
- [Abrupt-child-exit report](../.test-tmp/audit-audit-exit-tjdlV9/report.json)
- [Final Stage B baseline](../.test-tmp/audit-B-k3JnmB/before.json)
- [Final Stage B post-test snapshot](../.test-tmp/audit-B-k3JnmB/after.json)

All audited runs found **69 protected files unchanged**, **one explicitly missing
path still absent**, and **zero additions/removals/metadata/content differences**.
All **16 historical `claims_v3.json.tmp-*` files** remain hash-identical.
The first session audit baseline and final Stage B snapshot also match.

Across passing A/B runs, guard audit events recorded zero allowed network
connections. The intentional external connection probe was blocked before
connection. Stage B approved exactly two import-probe children; both emitted
their own guard summaries. All normal test and import-probe summaries reported
Mongo disabled. No production signatures, claims, payouts, transfers or
reconciliation ran; claim/redemption tests used synthetic disposable records.

## Approval A provenance and coverage

**HISTORICALLY REPORTED PASS — NOT REPRODUCED IN THIS SESSION.**

Repository tests, ignored audit artifacts, available Codex session JSONL files,
history, and temporary session locations were searched. A related integration
script was recovered:
`src/public/.tmp-audit/phase4fr-isolated-verification.mjs`.
SHA-256: `ccba65a4e6e5a33fe73c2e7414673e5da269ae9f5ccf901fff3faec0d2d4ee11`.
Its recorded command was `node .tmp-audit/phase4fr-isolated-verification.mjs`
from `src/public` in session
`rollout-2026-10-08T21-12-36-01a11ea5-fb1a-7a71-8770-2648855e0cc8.jsonl`.

Recovered executions failed private-profile assertions, ultimately identifying
`mkdirSync:src/quiz/data`. They recorded zero reconciliation POSTs. No successful
38-test transcript or manifest was found. This script is therefore an earlier
related artifact, not evidence establishing the reported 38/38 run. It still
fingerprints production paths in-process, installs its own temporary guard and
suppresses intervals. It was preserved and not executed or modified in S1.

| Reported behavior | Recoverable automation | S1 verification status |
| --- | --- | --- |
| Ed25519 login, invalid signature, replay | Recovered integration script; valid signature flow also in `accountSyncRoutes.test.mjs` | Not rerun; earlier script logs show those paths before profile failure |
| Synthetic A/B profile isolation | Recovered script; `profileByWalletPrivacy.test.mjs` covers route ownership | Only preferences storage isolation reproduced in B; HTTP authorization not reverified |
| Private and guest history isolation | Recovered script; `rewardIdentitySync.test.mjs` covers synthetic guest history | Not rerun; no guest HTTP-history isolation proof from S1 |
| Reconciliation idempotency | Recovered two-POST script; `rewardIdentitySync.test.mjs` covers storage-level repeat/retry | Not rerun; storage tests are not equivalent to the two-POST scenario |
| Session expiry and revocation | Recovered script; `nativeHandoff.test.mjs` and `webHandoff.test.mjs` contain session/handoff tests | Not rerun |
| Disposable execution and Mongo off | Fixed audited A/B manifests | Reproduced; A/B required no network sockets |

## Limits and recommendation

The integrity conclusion applies to the fixed reviewed paths and the executed
tests. It does not reconstruct the omitted post-audit from the preceding 4F-S
session. Persistent additions outside the fixed trees/files are not inventoried.

The Node guard is an application-level regression tripwire, not an OS security
sandbox against hostile code. This phase does not prove complete coverage of
native bindings, workers, all descriptor/symlink cases, unconnected UDP or DNS
APIs. No OS packet trace was collected; zero-network findings refer to the
instrumented executed paths. The legacy `npm test` command is not an audited
entrypoint and is not approved by this report.

The supervisor runs its post-audit for ordinary child failure, child abrupt exit,
timeout and handled parent termination. Force-killing the supervisor itself or
losing power cannot guarantee finalization; an absent final report must be
treated as incomplete verification. Hard termination can also omit a child's
guard summary; normal verification requires that summary to pass.

**GO for the S1 fingerprint-boundary correction and the reviewed A/B runs.**
**NO-GO for broader-suite or next-phase clearance** until Approval A provenance
is recovered or a separately identified replacement regression is authorized,
reviewed and run. No equivalence to the reported 38 tests is claimed.
