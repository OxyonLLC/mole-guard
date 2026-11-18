# WinLEW 3.0 — eight-game and staging completion increment

Extends `.test-tmp/winlew3-rc-t0dwsj/`; does not replace or inflate its baseline
results. Branch `xl1-control-center`, HEAD
`23e3d4bd4eb5eea362fb0439fe4111230c4b0070` unchanged. Existing unrelated dirty
work preserved. No commit, push, deployment, production request or real wallet
operation. Historical Approval A 38/38 remains unsubstantiated.

## Completed game acceptance

| Game | Real completion and settlement | Score / replay / attribution evidence |
| --- | --- | --- |
| DigLEW | Normal runner reaches checkpoint; actual box and server record | L; all-game accounting I baseline |
| TunnelTap | Full survival timer with legal hazard steering | L; all-game accounting I baseline |
| RootGlide | Full distance checkpoint using legal flaps | L; all-game accounting I baseline |
| GrubDrop | Legal matching-cluster taps until session finishes | L; all-game accounting I baseline |
| MoleSpades | Legal cards and contracts through complete match | L; all-game accounting I baseline |
| PacMole | Every real maze collectible collected; legal SPACE burrows | GPAC: exact worm/power/beetle/dash/life-bonus score, immutable replay, A only, next level |
| BurrowBlaster | Six real waves cleared through aiming and hazard avoidance | GBLAST: scoring-event sum and existing rank/base formula, immutable replay, A only, next round |
| Mole Ice | Reachable paths, legal ice shots and obstructing-ice shatter | GICE: actual crush-chain/shatter/clear score, immutable replay, A only, next mine |

No shipping engine was edited. Each test-only snapshot returns copied state;
it does not set scores, lives, positions, victory flags or reward eligibility.
Blaster score instrumentation observes existing `addScore` calls without
changing their arguments, return or effects. A fixed pseudorandom seed and
virtual clock make layouts/timing controlled. PacMole/Blaster additionally
use a 40 ms animation cadence installed before the dependency bag captures
browser APIs. Original rendering, dt clamps, physics and collisions still run.
This is synthetic 25 Hz device scheduling, not physical mobile-device evidence.

The F stage verifies actual loss, UI restart, no reward overlay and zero server
records for DigLEW, RootGlide, TunnelTap, PacMole, BurrowBlaster and Mole Ice.
DigLEW uses a returning-player save with two previously cleared practice
checkpoints: onboarding round one can finish even with incautious steering.
No current-run score, lives, state or wallet balance is overwritten.
GrubDrop has session completion rather than a separate defeat mode; MoleSpades
may settle a completed losing match under its existing rules. Neither was
misrepresented as a mandatory zero-reward defeat. Mole Ice remains experimental.

## Reproduced and corrected frontend defects

1. **Member mirror migrated into another account:** the real staging journey
   gave B 15 credits from A's browser mirror. Cache ownership now separates
   member mirrors from guest migration. Matching-session responses only may
   update the visible balance/history; late A responses cannot overwrite B.
   Unlabelled legacy guest migration remains backward compatible and capped
   by the existing server rules. Its legacy provenance is not cryptographically
   knowable; this correction does not redesign that historical trust model.
2. **Expired URL credential survived storage clearing:** after an actual 401,
   the matching stale `session` URL parameter is removed, member display cache
   is reset and guest history is refreshed. Backend expiry/ownership unchanged.
3. **Lost faucet response left Claim disabled:** the frontend catches transport
   failure, explains that reservation may already exist, and retries with the
   same account-bound request ID. A deliberate response loss after durable
   reservation plus retry leaves exactly one unsigned reserved claim.
   Pending copy says waiting for processing, not that tokens were sent.
4. **Profile Disconnect did not revoke:** browser storage was cleared but its
   copied token still returned private profile 200. Disconnect now calls the
   already-established shared keepalive logout, while retaining explicit cookie,
   sessionStorage and profile-cache cleanup. The old token now gets 401.

No backend authentication/session semantics, scoring, scales, cooldowns,
eligibility, payouts or reconciliation rules changed in this increment.
Script URLs are versioned for the three affected frontend surfaces.

## Current focused verification

| Command | Pass / fail / skip | Independent evidence |
| --- | --- | --- |
| `node tools/test-audit/run.cjs A` | 8 / 0 / 0 | `.test-tmp/audit-A-BN3yFq/report.json` |
| `node tools/test-audit/run.cjs GICE` | 1 / 0 / 0 | `.test-tmp/audit-GICE-3AKhIn/report.json` |
| `node tools/test-audit/run.cjs GPAC` | 1 / 0 / 0 | `.test-tmp/audit-GPAC-bP7fks/report.json` |
| `node tools/test-audit/run.cjs GBLAST` | 1 / 0 / 0 | `.test-tmp/audit-GBLAST-upNfhM/report.json` |
| `node tools/test-audit/run.cjs L` | 1 / 0 / 0 | `.test-tmp/audit-L-zG5ReZ/report.json` |
| `node tools/test-audit/run.cjs F` | 7 / 0 / 0 | `.test-tmp/audit-F-4wUguB/report.json` |
| `node tools/test-audit/run.cjs J` | 8 / 0 / 0 | `.test-tmp/audit-J-iNc6xr/report.json` |
| `node tools/test-audit/run.cjs R` | 5 / 0 / 0 | `.test-tmp/audit-R-I7VItM/report.json` |
| `node tools/staging/run.cjs --smoke` | 5 grouped checks PASS | `.test-tmp/staging-eNQy6K/report.json` |

32 passing TAP results, including nested parents—not 32 independent behaviors
or a manufactured historical count. Failed development attempts remain intact
and are not counted as passes. All completed attempts also performed their
post-test integrity comparison. No broad-suite or full historical audit rerun.
The two long simulations have a fixed 600-second supervisor bound; all other
stages retain 240 seconds. Unexpected guard events still terminate immediately.

J runs the real frontend at 390×844 through the CLI's shared loopback gateway
and actual guarded backend: A/B private profile/balance separation, repeated
reloads, preserved single legacy migration, actual quiz scoring and rejected
answer replay, interrupted faucet transport and same-ID retry, late A response
discard, expired URL-session recovery and server-revoking profile disconnect.
It never starts payout workers or supplies a signing key. Existing guarded I
coverage includes all-game pricing, concurrent reconciliation and faucet/quiz
accounting; the prior native PHP/cURL 15-check evidence remains applicable
because neither PHP proxy nor its fixture changed in this increment.

## Staging and release artifact

The CLI and browser journeys share `tools/staging/gateway.mjs`; no duplicate
gateway implementation or production upstream is used. The gateway emulates
PHP transport, not Apache. Real PHP/cURL proxy behavior remains separately
verified inside the reviewed network-disabled container from the prior pass.

Frozen startup exposed a concrete packaging defect: direct
`createRequire(import.meta.url)('../shared/solanaRpcFetch.cjs')` calls were
omitted by the literal-import collector. The source-only collector now includes
that exact static syntax without executing it. R adds a resolution regression;
the adapter itself and its no-retry-on-send rules are unchanged. The failed
startup `.test-tmp/staging-5ZzeIJ/report.json` has a clean protected-data audit
and zero unexpected guard events. Runtime/staging file counts now include the
previously missing adapter; the earlier 95-file baseline is not overstated as
an executed standalone backend.

`node tools/release/verify-integration.cjs` builds and hashes the new candidate.
The fixed pointer `.test-tmp/integration-final-artifact.json` identifies it and
its manifest SHA-256; the Phase 5 pointer and prior candidate remain intact.
The manifest includes public/runtime/local-tooling hashes and a runnable frozen
`staging/` source bundle. Use `node tools/staging/run.cjs --candidate --smoke`
or `--candidate` from the original repository. It checks every staged source
and original trusted guard/policy hash before execution, preloads that guard,
and uses newly disposable data. It does not use a relocated guard that might
lose protection for the real repository. Existing local dependencies required;
no package installation or production `src/index.js` startup occurs.

Only `public/` is eligible for separately approved public hosting. Never expose
runtime, staging, local tooling, checkpoints or reports. Historical `.tmp-audit`
and its archive, logs, credential includes and private data remain excluded.
The package verifier additionally requires all eight engines and APK/metadata
to match the original frozen Phase 5 hashes. APK 0.2.1 / build 201 remains:
`cbe67a8de3f14a4dadde8019db24e30e052be94ae618ed2dd32a1a7d891d10d7`.

## Integrity and audit boundaries

Every listed supervisor reports **70 protected files unchanged**, zero added,
removed or changed protected entries. Its `before.json` and `after.json`
contain every protected SHA-256, including the faucet environment backup and
historical claim temps. Package verification also checks all 130 historical
files against the preserved checkpoint. Neither historical scripts nor the
16 claim temp files were executed, modified or deleted.

Mongo remains disabled. Guarded application children spawn no subprocesses.
Their connections are loopback only; browser requests are constrained before
navigation. Browser tools remain explicit parent-owned tools. The faucet
response abort is a named deliberate fault, not an unexpected guard violation.
No real credentials, wallets, signatures, token transfers, claims or payouts
were used. Synthetic Ed25519 sign-in challenges are intentionally signed.

The JavaScript guard is not an OS sandbox; native bindings/descriptors and
browser background packets remain its documented limits. No OS-wide packet
capture or absolute isolation against malicious native code is claimed.
Games remain client-authoritative: tests prove real-play integration; existing
server pricing/caps/idempotence are not cryptographic anti-cheat attestation.

## Exact implementation and rollback scope

Production surfaces: `src/public/mole-hub/js/app.js`,
`src/public/mole-hub/index.html`, `src/public/faucet/js/app.js`,
`src/public/faucet/index.html`, `src/public/verify/profile.js`,
`src/public/verify/profile.html`.

Tests/fixtures: `test/support/browserSettlement.mjs`,
`test/ui/moleIceWinning.test.mjs`, `test/ui/pacMoleWinning.test.mjs`,
`test/ui/blasterWinning.test.mjs`, `test/ui/stagingAccountJourney.test.mjs`,
`test/ui/practiceFailureRecovery.test.mjs`.
Affected packaging regression: `test/mole/runtimeAssembly.test.mjs`.

Tools: `tools/test-audit/policy.cjs`, `tools/test-audit/run.cjs`,
`tools/staging/server.mjs`, `tools/staging/gateway.mjs`,
`tools/staging/candidate.cjs`, `tools/staging/run.cjs`,
`tools/release/game-checkpoint.cjs`, `tools/release/staging.cjs`,
`tools/release/package.cjs`, `tools/release/verify-integration.cjs`.
Dependency collector: `tools/release/runtime.cjs`.
Documentation: this report, integration progress and staging README.

Rollback source checkpoints: NM7zm5 (initial supervisor/tools), oThDmB
(pre-account-cache), JvTbgQ (pre-faucet recovery), fxlflu (pre-disconnect),
all under `.test-tmp/game-checkpoint-*`. The xQMQvL checkpoint preserves the
pre-fix runtime collector and test. The previous frozen candidate supplies
additional pre-increment sources. Reverse only this increment's hunks against
those copies; preserve unrelated work. Revert HTML cache-busters with their
scripts. Stop staging and choose the prior verified bundle if needed; never
reset/clean/stash, delete history or overwrite production data. No rollback ran.

## Remaining acceptance outside this local increment

Physical Android installation/update, native external wallet handoff, real
Discord/OAuth providers, manual assistive-technology review, production Apache/
CDN/TLS configuration and controlled deployment/provider acceptance remain
manual gates. JSON-backed staging is verified; Mongo/distributed deployment
is not certified with Mongo disabled. Real payouts/transfers remain prohibited
and untested here. APK signing provenance/device behavior require owner evidence.

Local engineering increment is ready for frozen-candidate acceptance once its
package and `--candidate --smoke` supervisors pass. Production launch is not
authorized or claimed. No ordinary development approval is requested.
