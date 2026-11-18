# WinLEW 3.0 integration progress

This pass extends the verified Phase 5 candidate; it does not replace its
historical results or claim a new historical Approval A count. No deployment,
push, commit, production request, member mutation or signed APK rebuild occurred.

## Implemented and verified

- Real guarded HTTP integration for all eight reward types, authoritative
  scaling, replay/duplicate handling, guest-to-member transfer, account
  separation, logout/recovery, quiz answers and faucet reservation/cooldown.
- Corrected a reproduced zero-gap reconciliation retry defect: after moving
  guest rows, their value must remain part of that guest's accounted amount
  for the same member. Previously a retry could credit that value again.
  The calculation now includes transferred rows; no eligibility/cap change.
- Duplicate claim responses now expose the original stored payout, rather
  than a recomputation from altered replay inputs. The immutable ledger was
  already correct; response consistency is now tested.
- Actual browser-driven full TunnelTap, MoleSpades, GrubDrop, RootGlide and DigLEW sessions,
  real settlement POSTs, resulting history, reconciliation and A/B separation.
  Test-only read-only engine snapshots guide legal inputs, not scores/wins.
  Layouts/deals use a fixed test-only pseudorandom seed for reproducibility.
- Real PacMole, BurrowBlaster and experimental Mole Ice terminal loss states,
  UI restart and zero reward records, driven by legal inputs toward hazards.
- Persistent loopback staging with synthetic accounts, local RPC fixtures,
  real guarded backend, safe proxy gateway, independent integrity supervisor,
  startup/shutdown and cache/denied-path smoke coverage.
- Native PHP/cURL proxy acceptance in an isolated network-disabled container.
  A real encoded-path validation defect was reproduced and fixed in both
  PHP proxy copies. No upstream, authentication or route allowlist expansion.
- Separate disposable Android staging project generation and validation.
  Production configuration and signed APK remain untouched.

## Focused evidence

| Command | Passing results | Evidence |
| --- | ---: | --- |
| `node tools/test-audit/run.cjs I` | 19 | `.test-tmp/audit-I-qj0fIL/report.json` |
| `node tools/test-audit/run.cjs E` | 25 | `.test-tmp/audit-E-P70a2f/report.json` |
| `node tools/test-audit/run.cjs C` | 18 | `.test-tmp/audit-C-ZnfN6F/report.json` |
| `node tools/test-audit/run.cjs L` (five completed sessions) | 1 | `.test-tmp/audit-L-dMWIUd/report.json` |
| `node tools/test-audit/run.cjs F` (three loss/restart journeys) | 4 | `.test-tmp/audit-F-x6Ybq8/report.json` |
| `node tools/staging/run.cjs --smoke` | 5 grouped checks | `.test-tmp/staging-Y6jqPI/report.json` |
| `node tools/staging/php-smoke.cjs` | 15 | `.test-tmp/php-staging-BQ2BcY/report.json` |

Counts are actual TAP results including nested parents where emitted, not
independent behavior counts and not a replacement for the 249-result baseline.
This table totals 82 passing results plus five grouped staging smoke checks,
including 43 repeated affected regressions (C/E). Final runs have zero failures
and zero skips. The earlier failed driver attempts are retained, not counted
as passes; their post-test protected inventories are unchanged.
All listed runs report 70 protected files unchanged. Before/after inventories
contain every individual SHA-256, including the faucet environment backup.
The final L stage's before/after inventory digest, computed as SHA-256 of
`JSON.stringify(JSON.parse(inventoryFile))`, is identical:
`fcd4b0492df5d825630a8ed51e42f3a0314ba5ebb7b7b864030f59b5e46dd83f`.
No unexpected guard violation was observed; Mongo remained disabled.
Assertion failures during driver development also completed clean audits.
The I stage includes four concurrent zero-gap reconciliation requests plus a
later retry: one transferred record, zero migration credit, unchanged owner
separation. It complements the existing positive-gap concurrency coverage.

Guarded application children opened loopback connections only and spawned no
children. Browser tools are explicitly parent-owned as in the existing
supervisor. PHP child processes run only inside the reviewed disposable
container, with its external network disabled. The one-time official PHP
image acquisition was tooling setup, not an application production request.
No OS-wide browser background packet capture is claimed.

## Exact implementation scope

Production fixes: `src/mole/rewardHistory.js`, `src/mole/web.js`,
`src/public/verify/api-proxy.php`, `src/public/xl1/verify/api-proxy.php`.

Fixtures/tests: `test/support/localStaging.mjs`,
`test/mole/syntheticRewardIntegration.test.mjs`,
`test/mole/stagingConfiguration.test.mjs`, `test/ui/practiceLifecycle.test.mjs`,
`test/ui/practiceFailureRecovery.test.mjs`.
The fixed stage manifests and browser-stage selection were added in
`tools/test-audit/policy.cjs` and `tools/test-audit/run.cjs`; guard rules unchanged.

Local tools: `tools/release/integration-checkpoint.cjs`, `tools/release/verify-integration.cjs`,
`mobile/staging-config.cjs`, all files under `tools/staging/`, and bounded
integration-mode additions to `tools/release/package.cjs`.
Documentation: this report and `tools/staging/README.md`.

Baseline branch/HEAD/status and source copies are in
`.test-tmp/integration-checkpoint-QYm3QZ/manifest.json`.
Existing uncommitted work is preserved. The frozen Phase 5 candidate remains
the pre-edit source reference. Rollback requires reversing only this pass's
identified hunks; do not replace whole dirty files or reset the worktree.

## Next implementation work and limitations

The continuation has now verified complete browser settlement for all eight
games, plus loss/restart/zero settlement for all six games with failure states.
PacMole, BurrowBlaster and Mole Ice use actual gameplay, exact scoring and
authenticated account attribution. See `docs/winlew-3-game-staging-report.md`
for current results, reproduced frontend defects, fixes and frozen staging.
Mole Ice remains experimental. Native PHP testing does not certify Apache,
CDN/TLS or production-host configuration. Android device runs, external wallet
provider/OAuth acceptance and manual assistive technology remain recorded
manual gates, not reasons to halt independent local implementation.
Mongo/distributed reconciliation is not verified with Mongo disabled.
The existing JavaScript guard is a regression boundary, not an OS sandbox.

Use `tools/staging/README.md` for local startup, shutdown and Android debug
instructions. Local integration can continue without ordinary approval loops;
no automatic production launch is authorized or claimed.

Package the current integration increment with
`node tools/release/verify-integration.cjs`. It builds a new frozen candidate,
verifies public/runtime/local-tooling hashes and preserves the old Phase 5
artifact pointer. The independent protected-file comparison always runs.
`local-tooling/` is source reference material, not public hosting content or
a standalone production distribution. The new `staging/` source bundle runs
through `node tools/staging/run.cjs --candidate` from the original reviewed
repository using its trusted guard and installed dependencies. The verifier's
report locates the new candidate and
records its manifest hash, exclusions, historical inventory and APK checksum.
