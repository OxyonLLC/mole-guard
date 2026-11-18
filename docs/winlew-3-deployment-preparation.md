# WinLEW 3.0 deployment engineering completion

Local release preparation PASS; no deployment, push, commit, production request,
credential change, real wallet operation or production data mutation.
Branch `xl1-control-center`, HEAD `23e3d4bd4eb5eea362fb0439fe4111230c4b0070`.
Existing dirty work, signed APK, historical evidence and prior candidates retained.

## Deliverable

Package: `.test-tmp/deployment-preparation-5DB0Ij/release/`.
Release ID: `winlew3-75736c899e1a6603`.
Trusted release.json SHA-256:
`a4eccf47f2be4ba1fbd3c36784900ef5d5187a1b35c866bafc0384c5cfc1d2d7`.
Source candidate remains `.test-tmp/winlew3-rc-wrU4UK/`, with original manifest
`b4c343cf7304905c6e91267ae9275aeafcb3a5da19dfbfdc037854c863a43e31`.

The deployment package has 1,293 hash-listed files: 594 public assets,
96 API runtime files, a matching 594-file backend public tree, and nine private
operations files. Public/runtime bytes come from the verified frozen candidate;
no application or game engine was changed in this phase. package.json and lock
are preserved. No dependencies were installed, application entry started, or
auxiliary worker activated by packaging.

This is a precise frontend/Mole API **upgrade overlay onto the retained existing
private runtime**, not a standalone bootstrap of the whole ecosystem. Existing
workers, data, config and computed resources must be retained and verified on
the host. The package is deployment-ready within that explicitly defined scope.
It is not evidence that an uninspected live host is ready or authorized to launch.

Only public/ belongs in the document root. No reports, fixtures, local data,
staging personas, node_modules, credentials or audit scripts are included.
Historical probe.php and the public upstream example PHP are additionally
omitted; old host copies must be denied by reviewed host configuration, not
deleted. APK 0.2.1/build 201 and legacy routes remain unchanged.

## Repeatable operations

```
node tools/deploy/build.cjs
node tools/deploy/verify.cjs
node tools/test-audit/run.cjs DEP
```

Build pins and checks the verified candidate, inventories output and fingerprints
the fixed protected set independently. verify builds twice, compares manifest
hashes/release IDs, checks packaged CLI fail-closed behavior, and runs private
PHP syntax/negative/positive configuration checks in the cached network-disabled
PHP container. Neither tool starts production-oriented application code.

Packaged preflight:

```
node operations/preflight.cjs RELEASE_ROOT PRIVATE_HOST_PLAN.json a4eccf47f2be4ba1fbd3c36784900ef5d5187a1b35c866bafc0384c5cfc1d2d7
```

The example host plan intentionally FAILS readiness. Owner host attestations
must have evidence; the checker does not fabricate it. The private PHP check
prints booleans only and cannot be invoked over HTTP. Fixed read-only smoke
defaults to loopback; live winlew.co invocation requires an explicit owner flag
and separate live authorization. It was not invoked against production.

## Verification evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Final guarded deployment contract tests | 6 PASS / 0 FAIL / 0 SKIP | `.test-tmp/audit-DEP-xPJns1/report.json` |
| Preserved Android compatibility regressions | 4 PASS / 0 FAIL / 0 SKIP | Same supervisor, second fixed file |
| Local primary/legacy journeys, metadata and sensitive-path deny smoke | 18 fixed probes PASS; unauthenticated profile 401 | First deployment test file, real local gateway/backend |
| Two independent byte-identical release builds | PASS | `.test-tmp/deployment-verification-uljM3H/report.json` |
| Complete package inventory/hash verification | 1,293 files PASS | Same verifier and both build reports |
| Packaged preflight with incomplete host template | Expected blocked, exit 1 | Same verifier; not a test failure |
| Native private PHP check | Syntax PASS, missing config expected FAIL, synthetic config PASS | Cached image `sha256:aafe21201943a8a6e497ddfb471e2ce68ada76adede38c7d61fede8918b24319`, network none |
| Protected persistent integrity | All 70 unchanged | before.json/after.json beside each supervisor/build/verifier report |
| Historical integrity | All 130 match preserved baseline | Both build reports |

10 focused passing test results include four reused Android regressions; this
is not a new aggregate total or a rerun of the full historical baseline.
Existing eight-game, reward/account, four-browser, responsive/keyboard and
native PHP transport evidence remains applicable because production source is
unchanged. No additional accessibility PASS is invented from packaging checks.

An initial new DEP run timed out with a clean integrity comparison:
`.test-tmp/audit-DEP-QepL5g/report.json`. Its test used the incorrect private
route `/api/me/profile` (404 rather than the real `/api/profile/me`) and the
wrong gateway teardown handle. These test defects were corrected; no backend
contract or application behavior was changed. The first corrected pass is
`audit-DEP-nbJxaw`; final xPJns1 uses the supplementary fixed manifest.
There were zero unexpected guard violations, not hidden or reclassified.

Guarded application connections were loopback only (16 recorded connection
events), Mongo disabled, approved application subprocesses zero. PHP native
tools were explicitly parent-owned with network none and a read-only disposable
operations mount. Build and offline preflight made no network requests.
JavaScript guard/native browser/OS limitations remain as previously documented;
no packet capture or adversarial OS-sandbox claim.

## Exact implementation manifest

New: tools/deploy/{lib.cjs, build.cjs, verify.cjs, preflight.cjs, smoke.cjs,
host-plan.example.json, hosting.env.example, host-check.php, apache-deny.conf};
test/mole/deploymentPreparation.test.mjs;
tools/test-audit/deployment-policy.cjs;
docs/winlew-3-deployment-runbook.md; this report.

Changed: tools/test-audit/run.cjs adds only the explicit supplementary DEP
manifest and usage name. The established tools/test-audit/policy.cjs was restored
byte-for-byte after the initial temporary DEP entry; the fixed protected-file
inventory and both guard policy implementations are unchanged. No rule exception,
network/subprocess allowance or production security bypass was introduced.
Keeping new test configuration separate preserves the old frozen staging trust
anchor instead of weakening its hash check. No unrelated edits were overwritten.

## Host requirements and remaining external gates

See packaged operations/RUNBOOK.md or docs/winlew-3-deployment-runbook.md for
exact environment names, PATH_INFO/cURL/proxy requirements, private baseline
assembly, backup consistency, dependency review, single-writer/data-path gates,
backend-first/public-entry-last ordering, release ledger and code-only rollback.
No data migration is introduced. Root PM2 all-stack startup is explicitly
forbidden as an upgrade shortcut because it includes payout workers and bots.

External-only gates: actual Apache/FPM/CDN/TLS/cache/old-copy denial enforcement;
owner upstream and environment propagation; retained runtime/service/data
baseline and backup/rollback rehearsal; actual provider/OAuth acceptance;
physical signed APK install/update/signing/native wallet handoff; manual
assistive-technology/touch acceptance. Mongo/distributed topology requires its
own host evidence if deployed that way. No live reward operation is used as a
smoke probe. Host attestation is not automatically satisfied by local fixtures.

Recommendation: proceed to owner-controlled host staging/acceptance with this
repeatable package. Local engineering preparation is complete for the scoped
upgrade; production GO still requires the explicit host/manual gates and
separate deployment authorization. No deployment performed or requested here.
