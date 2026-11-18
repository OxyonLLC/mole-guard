# WinLEW 3.0 local candidate completion report

Date: 2026-10-11 America/Denver (final audit timestamps cross into 2026-10-12 UTC).

Outcome: integrated local release candidate is ready for owner review. This is
not a production-readiness certification or permission to deploy. The existing
Android app remains part of WinLEW 3.0; no new APK was built or published.

## Baseline and preservation

Branch `xl1-control-center`; HEAD
`23e3d4bd4eb5eea362fb0439fe4111230c4b0070`. Existing dirty files were preserved,
including prior test-isolation changes, Mole Hub implementation, mobile wrapper,
historical QA and generated GeoAgora assets. Ownership was not inferred.

Checkpoint: `.test-tmp/completion-checkpoint-spUAJa/manifest.json`, containing
branch/HEAD/status, ten reviewed pre-edit source copies and fingerprints of all
130 historical audit files. Supplemental pre-edit copies of app/index.html,
.gitignore and the supervisor run.cjs are in that checkpoint. No credentials or
member-data copies were made. The historical directory and 16 claim temporary
files were neither edited nor deleted. No reset, clean, stash, checkout, staging,
commit, push, upload or deployment occurred.

## Routes and journeys

| Journey | Route | Integration and compatibility |
| --- | --- | --- |
| Home | `/` | Approved warm Phase 3C design, one public summary read, unavailable/stale states, no account-data read by homepage adapter |
| Play | `/play/` | All eight existing game routes; Mole Ice experimental; Market Rush clearly Coming, not playable |
| Earn | `/earn/` | Faucet, quiz, games, participation and records; local activity never guarantees an on-chain payout |
| Community | `/community-hub/` | Events, governance, contributions and community directory; established `/community/` registry unchanged |
| $WinLEW | `/token/` | Existing official mint and evidence links; total/circulating/locked quantities distinguished |
| Proof | `/proof/` | Philosophy, current server-produced PoV implementation and future work separated |
| Build | `/build/` | Modules, roadmap, tools, accurate independent Oxyon/XYO positioning, migration guidance and Android Beta |
| Android app | `/app/` | Existing native entry, sign-in/handoff, notification and update flows retained; download guidance added |
| Android distribution | `/jdid93hf8dh/` | Existing noindex tester download page, latest.json and APK unchanged |

Shared navigation leads with Home/Play/Earn/Community/$WinLEW/Proof/Build, keeps
Connect/Profile contextual and retains the full legacy directory under More &
records. Existing engines, wallet storage, reward rules and product deep links
were not rewritten. GeoWallet migration wording warns against clearing storage
or sending recovery phrases. WinLEW remains the community/economy; Oxyon remains
independent infrastructure, not a replacement or an implied XYO partnership.

Android package: `winlew-beta-0.2.1.apk`, build 201, 25,840,435 bytes.
SHA-256: `cbe67a8de3f14a4dadde8019db24e30e052be94ae618ed2dd32a1a7d891d10d7`.
It matches the existing latest.json and download-page checksum. Capacitor still
loads `https://winlew.co/app/`. The update regression uses a synthetic plugin
and loopback origin; it never installs, launches or signs with a real wallet.
The APK remains ignored by Git. Existing package signing claims were not newly
certified by a device or apksigner in this session.

## Exact implementation manifest

These are this completion pass's implementation files, not the entire dirty
tree. Existing modifications in overlapping files were retained. The release
manifest's `implementationFiles` records each resulting SHA-256; `publicFiles`
records the complete frozen public candidate.

- `.gitignore`: narrowly retain the public Build source route despite generic build/ exclusion.
- `src/mole/publicFiles.js`, `src/mole/web.js`: reject public historical/credential paths before static serving; no auth/reward changes.
- `src/public/.htaccess`, `src/public/_redirects`, `src/public/404.html`: public audit/log/credential restrictions, including historical audit zip; existing redirects preserved.
- `src/public/index.html`: integrate reviewed homepage, canonical metadata, honest data states, Android discovery.
- `src/public/app/index.html`: additive website/download-guidance links only; native logic unchanged.
- `src/public/play/index.html`, `earn/index.html`, `community-hub/index.html`, `token/index.html`, `proof/index.html`, `build/index.html` (all under src/public): six additive journeys.
- `src/public/assets/experience.css`, `homepage.css`, `homepage.js`, `homepage-data.js`, `journeys.css`: approved visual foundation, single summary adapter with validation, responsive/focus/reduced-motion states.
- `src/public/assets/nav.js`, `nav.css`: unified primary journeys and accessible grouped directory; existing identity semantics retained.
- `src/public/mole-hub/index.html`: eight-game metadata, local icon, honest guest/reward disclosure; engines untouched.
- `src/public/sitemap.xml`, `src/scripts/build-sitemap.mjs`: six routes added, historical audit directory excluded.
- `test/mole/publicFiles.test.mjs`, `completionSecurity.test.mjs`: public boundaries, profile-write authorization and disposable concurrent reconciliation.
- `test/ui/homepageData.test.mjs`, `androidCompatibility.test.mjs`, `winlew3Journeys.test.mjs`: data failure states, APK integrity/native update compatibility and controlled browser matrix.
- `tools/test-audit/policy.cjs`, `run.cjs`, `browsers.cjs`: explicit E/UI stages and parent-owned browser tooling; fixed protected inventory and guard rules unchanged.
- `tools/release/checkpoint.cjs`, `package.cjs`: recoverable local checkpoint and reviewed candidate packaging, including immutable Android checksum check.
- `docs/winlew-3-completion-progress.md`, `winlew-3-completion-report.md`: progress and handoff evidence.

No new implementation changes to authentication, ownership, sessions, scoring,
cooldowns, eligibility, payouts or reconciliation semantics were made. All other
dirty-tree files remain pre-existing work, not credited to this pass.

## Automated verification

Commands are run from repository root, always through the independent supervisor.
No broad npm test invocation or unguarded application test was used.

| Stage / command | Pass | Fail | Skip | Evidence directory under .test-tmp |
| --- | ---: | ---: | ---: | --- |
| `node tools/test-audit/run.cjs A` | 8 | 0 | 0 | `audit-A-9fF7wl` |
| `node tools/test-audit/run.cjs B` | 166 | 0 | 0 | `audit-B-N7RAbG` |
| `node tools/test-audit/run.cjs C` | 18 | 0 | 0 | `audit-C-ahsb8O` |
| `node tools/test-audit/run.cjs E` | 25 | 0 | 0 | `audit-E-6YAZlh` |
| `node tools/test-audit/run.cjs UI` | 5 | 0 | 0 | `audit-UI-9mdwIU` |

Total accepted TAP results: **222**, including parent tests. Stage C is
**Reconstructed Approval A — Verified**, 17 behavioral leaves plus parent, not
recovery of the historical 38/38. Its evidence is under `audit-C-ahsb8O`, from
`test/mole/approvalAReconstructed.test.mjs`: valid/invalid Ed25519 authentication,
replay and altered-message rejection, synthetic A/B profile/private-history
separation, guest history, expiry/revocation and idempotent accounting.

Stage E includes eight homepage summary checks, five adapter failure/validation
checks, two public-path checks, four Android compatibility checks, and six TAP
results for profile/security/concurrency. Four simultaneous synthetic
reconciliation requests move exactly one guest row, credit an exact gap of 11
once, reach account total 20, leave guest total zero and repeat without credit.
This proves the existing single-process JSON path, not distributed/Mongo races.

The supervisor failure probes are separate, deliberately failing commands:
`node tools/test-audit/run.cjs audit-failure` and `audit-exit` returned exit 1 as
expected. Both completed independent post-audits with unchanged protected data
(`audit-audit-failure-cnyufH`, `audit-audit-exit-zhEYV6`). They are not regressions
or included in the 222 passing results.

Targeted changed-file `git diff --check` passed. The whole dirty tree contains
pre-existing trailing whitespace in src/public/style.css; it was preserved.

## Browser evidence and performance

`audit-UI-9mdwIU/test-0/browser-evidence/results.json` records:

- Chrome 154.0.8037.98, Edge 155.0.4283.45, Firefox 153.0, WebKit 26.5.
- 120 route/viewport cases: seven journeys at 1440/768/390/320 widths per engine,
  plus /app/ and Android download page at mobile width per engine.
- 32 game deep-link cases with all eight factories registered and launch modals;
  an additional 844×390 landscape Play check per engine.
- Keyboard menu opening/Escape/focus return, desktop primary visibility, internal
  main-link existence and no horizontal overflow at the tested sizes.
- Partial/stale/unavailable/malformed homepage data, synthetic A/B account
  switching, unavailable history/verification and expired-session return to guest.
- 32 homepage summary requests (one per home visit), zero failed static assets,
  zero unexpected page requests, zero POSTs reaching the local HTTP fixture.

64 PNG screenshots are saved beside results.json, including desktop/mobile
first-screen images. Chrome first screens were visually inspected. Assets are
local; the existing Oxyon redirect is not used for artwork. Reduced-motion and
focus styles are present. The 2.74 MB existing hero PNG and inherited legacy
asset footprint remain performance limitations; no production Lighthouse score
or network-speed claim is made. The sitemap generator emitted 94 URLs with
historical audit material excluded. Old routes and host rewrite rules remain.

## Integrity, network and subprocess audit

Every accepted stage recorded the same 70 protected files, no additions,
removals or changes, plus the same missing-path state. All before.json and
after.json inventory digests are:

`4befd7b9e57a46f5cf0ad4763fe5b9641893beb1ebefc3e8d06c1cc1da87f809`

The inventories contain **every protected-file SHA-256**, not file contents.
They match the accepted S2R hotfix fingerprint. Each evidence directory has
before.json, after.json, report.json and per-file TAP logs. Historical 130-file
hash comparison also passed during packaging. Existing protected faucet env
backup, member stores and historical claim temps remain untouched.

Mongo was explicitly disabled in every guarded child. The established guard
preloads before application imports and blocks protected reads, writes outside
disposable roots, non-loopback network connections and unapproved children.
Zero unexpected guard violations occurred. B recorded its two exact reviewed
service children; C/E recorded no approved children. UI recorded no guarded
children: four fixed supervisor-owned headless browser process trees connected
over loopback and were closed in finally. Browser environments are sanitized.

Browser request interception was installed before page creation. All unexpected
external or non-read requests are aborted and fail verification. Only a fixed
synthetic-account reconciliation POST receives an immutable local response
(16 responses); no reconciliation handler or HTTP-server POST runs for it.
Actual concurrent reconciliation uses disposable fixtures in the guarded E test.
No production wallet signing, claims, payout, token transfer, OAuth or reward
reconciliation was performed. Production links were not followed.

Limits: the JavaScript guard is a regression barrier, not an OS sandbox. Native
bindings, workers, all descriptor edge cases, unconnected UDP/DNS and forcibly
killed supervisor remain known limits. Browsers themselves are parent-owned
native tools, not protected by Node fs/network wrappers. Page-request evidence
does not certify absence of every OS/browser background packet; no packet
capture was performed. No isolation exceptions or guard weakening were added.

## Local release candidate and rollback

Local artifact: see the final handoff for the latest `.test-tmp/winlew3-rc-*`
directory. `manifest.json` fingerprints all 596 frozen public files, the two
backend reference files and exact implementation paths. It includes Android
version/build/checksum. README marks it local review only, not a standalone
backend deployment. Rebuild with `node tools/release/package.cjs` on this
workspace while the referenced reviewed checkpoint remains present.

Packaging excludes .tmp-audit, .tmp-audit.zip, server logs, old htaccess copies,
local tooling and credential/upstream PHP includes. This is a bounded literal
credential scan, not certification of every legacy generated asset/binary.
Historical evidence remains intact in the repository, never in the candidate.
The copied backend files are integration references; deployment must include
the owner's existing runtime and separately reviewed configuration.

Rollback is a reviewed file-level operation using checkpoint pre-edit copies
and this implementation manifest, reversing only this pass's hunks. Do not use
reset/clean/stash or replace unrelated dirty files. For new routes/assets, stop
referencing them before any approved removal. Revert the publicFiles import
and middleware together if rolling back; preserve prior isolation changes.
The one-line sitemap-generator exclusion and narrow Build ignore exception
can be reversed separately. No rollback was executed.

## Remaining release gates and recommendation

**GO for owner review of the local candidate; NO-GO for automatic production
release.** Local integration and targeted automated/browser verification are
complete. No full-suite, complete game-round, physical Android installation,
notification/battery-manager, real wallet-provider handoff, external Discord
OAuth, manual screen-reader or production-host test is claimed.

Before any separately authorized release:

1. Review the candidate, preserved APK signing/provenance, exact manifest and
   changes relative to owner's existing dirty work.
2. Verify real Apache/Netlify protections, redirects, PHP proxy configuration
   and download MIME type on a controlled staging host; loopback static QA did
   not execute PHP or Apache rewrite rules.
3. Owner installs credential/upstream configuration outside public serving
   paths; assess rotation if historical exposure is suspected. Never upload
   .tmp-audit, its archive, logs, checkpoints or secret includes.
4. Perform physical Android beta installation/update, native wallet handoff,
   notifications and account-switching acceptance with owner-controlled test
   accounts; do not advertise a new 3.0 APK build.
5. Complete manual assistive-technology review, bandwidth/performance staging
   review, and longer interactive rounds for all games.
6. Review remaining legacy integration surfaces and any larger-suite manifest
   before execution. Distributed/Mongo reconciliation remains a separate gate.
7. Preserve protected inventories and an owner-approved rollback backup before
   release; deployment/push require separate authorization.

No ordinary development approval is requested. External/member-affecting gates
remain pending under the standing directive's hard boundaries.
