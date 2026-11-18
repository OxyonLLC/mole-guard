# WinLEW 3.0 — Phase 5 final release readiness

Recommendation: **NO-GO for a controlled production launch until the mandatory
manual gates below pass.** Local implementation and isolated acceptance are
complete; no deployment, upload, Git commit/push, live OAuth, wallet signature,
reward operation or production record mutation was performed.

## Actual candidate, baseline and changes

Branch `xl1-control-center`, HEAD
`23e3d4bd4eb5eea362fb0439fe4111230c4b0070`, unchanged. The entire existing dirty
tree was preserved. Before editing, the actual B60Vfn candidate and all 596
public file hashes plus 36 implementation hashes were verified against disk
and current source. See `.test-tmp/phase5-checkpoint-TjyvGF/manifest.json` for
branch/HEAD/status and nine source backups. B60Vfn remains an immutable
pre-Phase-5 public rollback artifact, including the original game app.js.

The existing completion report was read directly, along with manifest, recorded
test code, public routing, PHP proxies, shared authentication and relevant game
engines. Its limitations were real: games had only reached launch dialogs,
profile page cache fallback was not covered, and the old artifact contained
only two backend references rather than a runtime assembly.

Phase 5 exact changed/new implementation paths:

- `src/public/verify/profile.js`: private snapshot/draft scopes tied to the
  current session; public snapshot scope tied to the public wallet and app.
  Unscoped legacy browser snapshots/drafts are no longer loaded. Guest drafts
  remain device-local and usable. Server authorization/session semantics are
  unchanged. No real browser storage was accessed or changed locally.
- `src/public/mole-hub/js/app.js`: gracefully skip optional Web Audio when its
  constructor is absent/unavailable, preserving supported audio and game logic.
- `src/public/faucet/index.html`, `src/public/quiz/index.html`: use local favicon
  paths rather than request production assets during local use.
- `src/public/transparency/js/app.js`: explicit empty component-evidence state
  rather than a blank grid; successful synthetic source and failed-source cases
  are tested separately. The original is retained in frozen B60Vfn.
- `src/public/.htaccess`: disable directory listings, explicit APK MIME/nosniff,
  no-store update metadata, revalidation for HTML/JS/CSS. Existing history/secret
  blocks and route redirects remain intact.
- `test/ui/profileCacheBoundary.test.mjs`, `audioCompatibility.test.mjs`,
  `phase5Acceptance.test.mjs`, `test/mole/phase5Release.test.mjs`: new targeted
  regressions and controlled product acceptance.
- `test/mole/runtimeAssembly.test.mjs`: assemble only into approved disposable
  storage; verify CommonJS dependencies/type markers and all source hashes
  without executing application modules.
- `test/ui/winlew3Journeys.test.mjs`: preserve matrix/assertions and replace
  global network-idle waiting with page-load readiness on polling surfaces;
  original copied to the Phase 5 checkpoint before editing.
- `test/ui/matrix/{chrome,edge,firefox,webkit}.test.mjs`: fixed browser wrappers
  keep the complete matrix sequential under independent guarded per-file
  deadlines instead of one timing-sensitive aggregate deadline. No assertions,
  browsers or guard restrictions were removed; the supervisor is unchanged.
- `tools/test-audit/policy.cjs`, `run.cjs`: fixed P5/U5 manifests and existing
  supervisor-owned browser lifecycle applied to U5. Guard and filesystem/network
  restrictions were not edited or relaxed; protected inventory is unchanged.
- `tools/release/phase5-checkpoint.cjs`, `runtime.cjs`, `package.cjs`: frozen
  baseline verification, source-only checkpoint, static runtime assembly and
  complete candidate manifest. Application code is never executed by assembly.
- `docs/phase5-release-readiness.md`: this single final readiness report.

## Release gates

| Gate | Result | Evidence / remaining action |
| --- | --- | --- |
| Frozen original candidate integrity | PASS | 596 public + 36 implementation hashes independently verified before editing |
| Seven primary journeys and existing deep links | PASS | Established four-browser matrix, local asset/link checks, canonical route tests |
| Eight games launch and accept input | PASS | Actual engine start, visible play surface, left/right input smoke in four browsers; not full-round certification |
| Faucet/quiz discovery and guest/empty/error presentation | PASS | Real frontend pages against read-only local fixtures; no claim/answer submitted |
| Synthetic private profile/history and PoV | PASS | A/B identity switching, score 42 supplied by fixture, expiry/error cache separation; server isolation verified by C/E |
| Snapshot and local-draft account isolation | PASS | Seven VM regressions and browser private-profile acceptance |
| Proof/transparency/governance discovery and unavailable states | PASS | Local empty/error fixtures and actual frontend rendering; no vote/burn/chain operation |
| Oxyon integration | PASS | Independent positioning and correct outbound destination; legacy redirects retained, no external navigation performed |
| Android APK checksum, metadata, download links and update logic | PASS | Existing 0.2.1/build 201 package unchanged; four deterministic compatibility regressions |
| Protected data and historical evidence preservation | PASS | Fixed supervisor inventory; 70 protected files unchanged; 130 historical files unchanged |
| Public sensitive-file exclusions / reviewed access rules | PASS | Manifest exclusions, static policy tests and existing Express HTTP tests; host enforcement is separate |
| Final public/runtime artifact hashes | PASS | Static assembly and source/lockfile hashes checked; final manifest verification accompanies handoff |
| Actual Apache/PHP/CDN/TLS behavior | NOT TESTED | Mandatory owner-controlled staging check; php/httpd not available in this local shell |
| Production backend environment / installed runtime compatibility | NOT TESTED | Mandatory staging configuration and deployment-baseline comparison; local code/fixtures do not establish live connectivity |
| Physical Android install/update/signing/handoff/notifications | NOT TESTED | Mandatory checklist below; no device evidence or APK rebuild |
| Complete game rounds / reward-flow integration | NOT TESTED | Required longer acceptance with disposable fixtures before release; smoke does not prove every scoring/completion path |
| Manual screen-reader / touch-device usability | NOT TESTED | Required owner acceptance; automated focus/overflow checks are not a substitute |
| Live Discord OAuth / wallet-provider integration | NOT TESTED | Mandatory owner-controlled acceptance, separately authorized; no production identities or role changes here |

No mandatory untested gate is counted as PASS. The historical 38/38 Approval A
result is not recovered or claimed. C remains reconstructed Approval A with
17 behavior leaves and one parent test.

## Test evidence and reproducibility

All application tests used the unchanged preloaded guard and independent
supervisor with synthetic identities, disposable storage and Mongo disabled.
Run from repository root:

```
node tools/test-audit/run.cjs A
node tools/test-audit/run.cjs B
node tools/test-audit/run.cjs C
node tools/test-audit/run.cjs E
node tools/test-audit/run.cjs P5
node tools/test-audit/run.cjs UI
node tools/test-audit/run.cjs U5
```

Final stage counts and evidence paths are recorded in the final evidence section.
P5 comprises seven cache/draft tests, three audio tests, five release-policy
tests and four guarded static-assembly tests. U5 has one parent plus four browser tests, including 32 engine starts,
72 mobile empty/error product-route cases, and private A/B/expired profile
states. UI preserves the earlier 120 route/viewport cases, eight game deep
links per browser, Android routes and homepage/account failure-state checks.

Two failed U5 attempts were retained, not hidden:
`audit-U5-PKsflN` failed a new test's incorrect .active visibility selector;
`audit-U5-klUmpB` passed Chrome/Edge but exposed missing Web Audio on WebKit and
a Firefox network-idle timeout. The selector now reflects the existing hidden
class contract. Product readiness uses page load and DOM assertions rather
than assuming a polling page must become globally network-idle. Web Audio was
fixed narrowly, with supported/unsupported regressions. Both failed runs
completed clean post-test audits, zero unexpected guard violations and zero
unexpected browser requests. These failures are not included as passing tests.
The original UI rerun `audit-UI-iz41le` also exceeded its 220-second parent
deadline after three browser passes (two cancelled tests, no assertion failures).
The same readiness correction was applied; its audit was clean as well.
`audit-UI-PUHMPo` again reached the aggregate deadline. The fixed browser files
now use the existing per-file supervisor mechanism and unchanged timeouts;
this demonstrated test scheduling defect required no isolation exceptions.

## Protected-data and request integrity

All accepted and failed supervised runs compared inventories before/after,
including additions/removals, content hashes and metadata. The protected-file
inventory digest remains:

`4befd7b9e57a46f5cf0ad4763fe5b9641893beb1ebefc3e8d06c1cc1da87f809`

Each audit directory's before.json/after.json contains all 70 individual file
SHA-256 values, never their contents. The one baseline-missing path remains
missing. Historical artifacts, 16 claim temporary files and faucet environment
backup remain untouched. Packaging rechecks all 130 historical fingerprints.

Browser interception is installed before page creation. Only loopback GET/HEAD
requests reach the fixture server. An existing, reviewed reconciliation fixture
can return a fixed result for explicitly synthetic sessions without executing
a handler; every other POST/external page request aborts and fails the test.
The product smoke runs do not complete games or submit claims. No real wallet
signature, claim, payout, transfer, governance vote or reconciliation occurred.

Native headless browsers are explicit parent-owned tools, not guarded child
exceptions, and are closed in finally. B retains its two exact reviewed service
children. The guard is a JavaScript regression barrier, not an OS sandbox:
native bindings, worker/descriptor edge cases, UDP/DNS and forced supervisor
termination limitations remain. Page-request audit does not certify all native
browser background packets; no OS packet capture was performed.

One unexpected guard event occurred in the new static assembly test,
`audit-P5-icawgS`: runtime.cjs:26 used copyFileSync(src/index.js, disposableTarget).
The existing guard conservatively requires BOTH copy arguments inside the
disposable write root, so it blocked the source argument as an outside write
and the supervisor stopped that child. The post-audit was completed: 70 files
unchanged. Read-only triage confirmed the source was already read by guarded
readFileSync and no source mutation occurred. The assembler now uses separately
guarded source reads and disposable-target writeFileSync, including package
markers/lockfile. No copy rule, read protection or write permission was relaxed.
Fresh verification is recorded below; this event is not relabelled an expected
guard self-test or omitted from the audit.

## Deployment dependencies and migration

The primary shared-host deployment requires PHP/cURL plus the Node backend:
frontend public reads and account APIs go through `/verify/api-proxy.php` on
winlew.co. The proxy needs explicitly reviewed `WINLEW_API_BASE` and
`WINLEW_PROXY_SECRET`. GeoHackers also needs `GEOHACKERS_API_BASE` (or its reviewed
fallback). Existing source contains an old WinLEW upstream fallback: it must
not be relied on for this launch. No upstream was contacted or credential read.
Configure server environment values; excluded PHP include files are not
installed by this artifact. Keep all credentials outside publicly served paths.

The homepage requires `/api/homepage/summary` and its existing source services;
missing/stale/failed sources remain visibly unavailable. Profile/history, quiz,
faucet and governance keep their existing APIs and eligibility checks. Static
Netlify hosting alone cannot execute these PHP proxies: do not treat the
redirect file as evidence of an operational API deployment there.

The runtime assembly includes the static literal-import closure of src/index.js
and locked package metadata, including extensionless CommonJS dependencies and
directory package type markers, not node_modules, credentials or persistent data.
Computed imports and files read dynamically are not proven complete by a static
graph. Compare against the owner’s existing full runtime before installing.
`src/index.js` starts bots, role diagnostics, mirrors and heartbeat senders:
never start it as a harmless preview or an unguarded acceptance server.

No database schema, member-store or reward-accounting migration is introduced
by Phase 5. Existing persistent data must stay in place and be independently
backed up by the owner. Legacy unscoped browser cache/draft contents are simply
not rendered under the new identity boundary; the server is still authoritative.
This is not evidence that an older production runtime has every prerequisite
from prior phases, nor certification of distributed Mongo concurrency.

HTML/JS/CSS now request revalidation. latest.json is no-store; native update
fetch already uses cache:no-store. APK has explicit content type and nosniff.
Verify these actual response headers through the real host/CDN, with a warm
browser cache and existing installed APK; source directives alone cannot prove
host modules or upstream caches honor them. Preserve noindex for Android beta
and private profile surfaces; six added public journeys use canonical URLs and
sitemap entries. Existing legacy 301/302 routes and Oxyon redirects stay intact.

## Historical public-data boundary

The source directory really is beneath the public tree. A generic static host
or upload of the raw working tree could serve historical reports, screenshots,
QA scripts and source snapshots. Robots/noindex is not access control.

Final packaging excludes .tmp-audit, .tmp-audit.zip, log directories, old
htaccess backups, hidden tooling and credential include files. Express checks
paths before static serving; Apache blocks audit directory/archive and sensitive
paths; Netlify forced 404 rules cover directory/archive. Directory listing is
disabled for Apache. No historical evidence was edited, deleted or imported.
Deploy only manifest-listed artifacts, never src/public wholesale or .test-tmp.
On staging, test direct, encoded and nested audit URLs as well as secret include
paths; responses must be denied even if an older host copy still exists.

## Exact physical Android acceptance checklist — NOT TESTED

Use a dedicated test phone and owner-approved synthetic/test identity; do not
use a funded member wallet or perform a real claim. Record device model, Android
version, WebView/browser version, APK hash, build, steps, screenshots and result.
The preserved APK is pinned to https://winlew.co/app/. A staging download URL
does not redirect its runtime to staging. Physical acceptance therefore needs
an owner-controlled isolated routing/interception setup for that origin, or
separately authorized live-system testing. Neither was available or attempted;
do not launch it against production under this directive.

1. Verify SHA-256 of downloaded `winlew-beta-0.2.1.apk` equals
   `cbe67a8de3f14a4dadde8019db24e30e052be94ae618ed2dd32a1a7d891d10d7`.
   Verify package ID co.winlew.app and signing certificate against the existing
   owner-approved release provenance. Do not trust a DM/forwarded APK.
2. Check /jdid93hf8dh/, latest.json (version 0.2.1, build 201, same URL/hash),
   APK HTTP MIME/nosniff and non-stale metadata on the intended staging host.
3. Install cleanly on a dedicated phone; record installer warnings. Restore the
   browser's unknown-source installation permission afterward. Existing source
   declares min SDK 22 and target/compile SDK 35; compiled-APK compatibility and
   old-device behavior still require verification, not an assumption.
4. Verify cold launch enters /app/, safe-area insets, hardware back, menu,
   Home/Build/Play return paths, portrait/landscape and touch controls.
5. Perform owner-approved test-wallet sign-in in Phantom/Solflare separately;
   confirm return/handoff completes once, cancel/reject safely, and manual app
   return can finish. Never enter a seed phrase or approve a transaction.
6. Close/reopen and background/resume; inspect preserved account session,
   correct profile/history, session expiry, logout and A/B switching. No cached
   private A profile or draft may appear under B or guest after failure.
7. Check no update prompt on build 201. On an owner-retained older beta, the
   update should open the system browser/Custom Tab, download the identical
   signed package, and upgrade in place without uninstalling or clearing data.
   Do not fabricate future metadata on the live site to trigger this test.
8. Check notification permission is opt-in. Allow/deny/toggle/restart/resume,
   then test scheduled reminders with synthetic local state and phone battery
   settings. Record whether manufacturer background restrictions suppress them.
9. Exercise all eight game starts and full practice rounds without submitting
   real rewards; verify unsupported audio never blocks play. Keep Ice marked
   experimental and non-playable concepts distinct.
10. Inspect faucet/quiz eligibility, offline/unavailable/expired-session states,
    and proof/transparency links. Do not click a real claim, payout or vote.
11. Test installation/update and sign-in failures: offline network, cancelled
    wallet handoff, missing wallet app, download cancellation and permission
    denial. Record visible errors and a usable return path.
12. Attach evidence and mark each row PASS/FAIL/NOT TESTED. No physical-device
    PASS is claimed by the local browser or plugin mock tests.

## Controlled deployment sequence — instructions only, not executed

1. Close every mandatory gate with owner evidence. Confirm exact artifact hash,
   runtime baseline, credentials placement, Node/dependency compatibility,
   PHP modules, DNS/TLS and backup/rollback ownership.
2. Preserve current release files and independent encrypted data/config backups;
   record hashes, process configuration and deployed version. Do not delete,
   overwrite or restore member records as part of the code deployment.
3. Assemble backend in a separate reviewed release directory; install dependencies
   from the provided lockfile using the approved deployment process. Restore
   required existing runtime resources/config outside the document root, not
   production data from this candidate. Do not execute maintenance/reward scripts.
4. Exercise controlled staging APIs with Mongo disabled/disposable fixtures and
   external services mocked. Verify summary/profile/history/proxy contracts and
   all denied paths, redirects, canonical URLs, headers and warm-cache behavior.
5. Only after separate production authorization, gracefully stop/drain the
   intended processes using their existing shutdown behavior and switch the
   backend release first. Health-check required endpoints without production
   writes; do not trigger role sync/reconciliation/payments as acceptance probes.
6. Publish only manifest-listed public assets, dependencies before entry HTML,
   or use the host's reviewed atomic release mechanism. Preserve existing APK
   bytes, URL and metadata; never upload historical directories/archive/logs.
7. Switch HTML and verify host cache headers and non-mutating health checks.
   Validate homepage unavailable handling and all legacy redirects. Record actual
   deployment time/version and monitor sanitized errors. Stop/rollback if gates
   fail; do not retry by relaxing security rules.

## Rollback instructions

Local: restore only Phase-5 hunks from checkpoint-TjyvGF; original game app.js
is the verified B60Vfn public copy. Preserve all pre-existing modifications.
Never reset/clean/stash the dirty workspace. Keep the Phase-4 completion
checkpoint and artifacts intact. No rollback or cleanup was performed.

Production, if separately deployed: switch back to the owner-retained previous
backend/public release and its compatible existing environment configuration.
Respect graceful shutdown/write flushing and the owner's managed-storage
procedure. Preserve current member data; code rollback is not database rollback.
Revalidate summary/profile/session behavior, route denies and cache handling;
leave the APK unchanged. If any actual data migration is discovered, stop until
the owner approves a separate data-aware rollback plan.

## Final evidence

| Stage | PASS | FAIL / skipped | Exact evidence directory under .test-tmp |
| --- | ---: | --- | --- |
| A | 8 | 0 / 0 | audit-A-yXkIfI |
| B | 166 | 0 / 0 | audit-B-r8EPe4 |
| C | 18 | 0 / 0 | audit-C-fG2vGy |
| E | 25 | 0 / 0 | audit-E-6QtPOH |
| P5 | 19 | 0 / 0 | audit-P5-NLckVX |
| UI | 8 | 0 / 0 | audit-UI-6QeBaN |
| U5 | 5 | 0 / 0 | audit-U5-Yn1UUX |

Accepted final stages: **249 passing TAP results**, including parents. UI now
has four fixed files with a parent + browser test each; this count change is
structural, not invented new behavioral coverage. All final stages are complete
and independently audited. Failed/cancelled attempts and the one unexpected
blocked guard event remain separately documented above.

Every final before/after inventory matches the digest quoted above. Per-file
hashes are in those audit directories. No final-stage guard violation, external
page request or unapproved child was recorded. Final UI screenshots are under
audit-UI-6QeBaN/test-0 through test-3/browser-evidence; U5 screenshots/results are
under audit-U5-Yn1UUX/test-0/browser-evidence. Chrome's expired-profile mobile
screenshot was visually inspected; it showed no prior synthetic private profile.

The final artifact is identified by `.test-tmp/phase5-final-artifact.json` and its
candidate manifest hash. Its manifest records all 596 public assets, 95 runtime
source/package files, exact implementation file hashes, exclusions and unchanged
Android metadata. Runtime source includes quiz CommonJS type/dependency markers
and has no unresolved literal resource references. Static assembly is not a
claim that every computed/runtime resource or deployed environment was tested.
Local tests ran on Node v22.16.0. The old B60Vfn, intermediate assembly artifacts
and all audit evidence were preserved, not overwritten or deleted.

Exact remaining blockers for GO: host/PHP/CDN/TLS and old-public-copy deny tests;
configured backend compatibility and production baseline review; physical APK
signing/install/update/handoff/notification evidence with safe origin routing;
complete game-round/reward-flow synthetic acceptance; manual assistive/touch
acceptance; and separately authorized OAuth/wallet-provider integration. No
production launch should proceed until the owner closes and records these gates.
