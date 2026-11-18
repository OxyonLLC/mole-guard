# WinLEW 3.0 deployment component runbook

This is an **existing-host upgrade**, not a static-only site or a bootstrap of
every WinLEW service. No deployment commands below were executed locally.
Source baseline: verified frozen `winlew3-rc-wrU4UK`; APK 0.2.1/build 201 unchanged.

## Architecture and required resources

Apache serves `public/` at the existing HTTPS winlew.co document root. PHP/cURL
executes `/verify/api-proxy.php`, `/xl1/verify/api-proxy.php` and GeoAgora proxies.
Enable PATH_INFO, mod_rewrite, mod_headers, mod_mime and applicable AllowOverride;
retain supplied nested .htaccess and legacy redirects. `_redirects` is not PHP
execution and static hosting alone is insufficient. Existing proxy timeouts are
5-second connect/25-second overall; preserve them and the circuit breaker.

The private Node component runs `src/index.js` with its existing process manager.
It also starts bots, diagnostics and heartbeat: NEVER start it for a preview.
The package carries its 96-file static source closure, package lock/type markers
and the same public tree at backend/src/public (required by the backend).
Use the locally verified Node 22 major; exact tested version was 22.16.0.
Dependencies must be installed with the existing approved locked deployment
process in a private directory. No node_modules or installation is bundled.
Review package lifecycle scripts before installation; `npm ci --omit=dev
--ignore-scripts` avoids lifecycle execution but still requires owner-authorized
registry access and a host dependency check. No install was performed here.

Retain the existing faucet/quiz/game payout workers, bots, watchdog, public
server, GeoHackers/GeoAgora services and tunnel configuration. This package
does not replace their source closures or enable new workers. Never run
`pm2 start ecosystem.config.cjs` as an upgrade shortcut: it starts the stack,
including payouts. No computed-resource closure or fresh full-stack install is
claimed. Apply the backend overlay to an owner-backed-up clone of the existing
private runtime, preserving required resources and auxiliary files.

Mole PHP needs WINLEW_API_BASE; GeoHackers needs GEOHACKERS_API_BASE; GeoAgora
needs GEOAGORA_API_BASE (including its appropriate /geoagora-api suffix).
Set all explicitly: do not depend on historical tunnel fallbacks. PHP proxy
secret and Node WEB_PROXY_SHARED_SECRET must match. Configure the actual PHP
worker environment, not merely an interactive shell. CLI PHP environment checks
do not establish FPM/control-panel environment propagation.

`hosting.env.example` contains placeholders only. Retain existing private
credentials, OAuth app IDs/secrets, TOKEN_PEPPER, mint/RPC, thresholds, cooldowns,
reward scales and payout references. Required schema includes DISCORD_TOKEN,
DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI and WINLEW_MINT.
The generated environment-names.json inventories direct process.env names, not
every config schema key or values. No credentials were read to generate it.
Use existing approved same-origin OAuth callbacks; verify registration against
the backend/app selection. Preserve native /app/ handoff and all legacy routes.

Do not relocate data merely by switching cwd. Retain absolute DATA_DIR,
FAUCET_DATA_DIR and QUIZ_DATA_DIR and all existing linked-wallet/game/Mongo
resources. Faucet files default beside its module; quiz uses its local data
directory, and Mole DATA_DIR defaults relative to cwd. Preserve all existing
stores, lock files and historical temps. Mongo topology must remain as deployed:
local Mongo-disabled evidence does not certify Mongo/distributed operation.
Never run two JSON-backed writers against copied divergent data. No schema or
data migration is introduced by this component package.

## Repeatable packaging and offline preflight

From the original repository:

```
node tools/deploy/build.cjs
node tools/test-audit/run.cjs DEP
```

Builder uses a fixed trusted candidate manifest; rejects file changes and
symlinks, copies only hash-listed public/API runtime and private operations
files, inventories every output byte, and always performs independent protected
pre/post fingerprints. It does not replace the existing candidate pointer.
Release ID is deterministic from sorted file content hashes, not a guessed
version/date. Identical inputs yield identical release.json and file hashes.
Builder emits package path, trusted release.json SHA-256 and evidence path.
Keep these outside the web root and with the backup record.

Copy host-plan.example.json to a private owner acceptance record. Populate
actual upstreams and set gates true only with evidence. No secrets belong in
that JSON. Run from the package operations directory:

```
node preflight.cjs RELEASE_ROOT PRIVATE_HOST_PLAN.json EXPECTED_MANIFEST_SHA256
php host-check.php
```

Preflight checks complete inventory (additions/removals/changes), links, APK
hash and trusted manifest, and fails closed on unverified host gates. Neither
command starts a backend or connects anywhere. PHP check must run with the
PHP worker's approved configuration and emits booleans only. Explicit gate
attestations are owner evidence, not automated proof of host functionality.

## Backup, ordering and rollback

1. Record current release/version/hash, process-manager names, cwd, dependency
   lock and private configuration locations. Owner takes encrypted, consistent
   backups of persistent data/config and retained auxiliary source. Protect
   access logs and sessions; never include them in public release artifacts.
   Coordinate graceful draining/write flush and managed Mongo consistency with
   all writers; test restore into a separate disposable location, not live data.
2. Assemble a private sibling of the existing runtime and apply only manifest
   backend paths. Maintain absolute existing data references. Prepare previous
   and new public trees separately; retain old public evidence privately.
   No rsync --delete, recursive cleanup or public upload of the repository.
3. Validate private environment/dependencies and isolated host staging. Apply
   `apache-deny.conf` to the host and preserve root/nested rewrite rules. Ensure
   old .tmp-audit/archive/log/secret copies are denied, even if still on disk.
   Probe.php and upstream example PHP are omitted from this package; omission
   alone does NOT deny an old deployed copy. Never delete historical evidence.
4. After separate live authorization, gracefully switch ONLY the intended
   Mole API process first, retaining other services and their current settings.
   Verify health in approved host staging; startup itself has service effects
   and is not a read-only acceptance operation. Do not activate payouts, role
   changes or maintenance/reconciliation scripts as deployment probes.
5. Switch public assets atomically where supported; otherwise dependencies and
   PHP first, entry HTML last. Preserve APK URL/bytes/metadata. Verify HTTP
   routing, revalidation, latest.json no-store, APK MIME/nosniff, TLS and CDN
   behavior, and OAuth/provider contracts. Do not upload operations/ or backend/.
6. Record release ID/manifest hash, host gate evidence, previous version and
   switch time in a private deployment ledger. No public private-path leakage.

Rollback: gracefully drain the intended new API process, switch to the retained
previous compatible private runtime and previous public tree; retain current
member data and existing environment. Roll back scripts and their HTML cache
versions together, revalidate routes/cache/denies, preserve APK. Code rollback
is NOT data restore. Unexpected storage migration or accounting discrepancy
requires a separate data-aware incident plan, never overwriting newer records.

## Read-only post-deployment smoke and manual gates

`operations/smoke.cjs` permits loopback by default. On a separately authorized
host only: `node smoke.cjs https://winlew.co --owner-authorized-host`.
It sends only fixed unauthenticated GETs, never follows redirects or performs
challenge/sign-in/claims/votes/reconciliation/logout. It checks primary routes,
Android metadata and historical/secret/probe denies; it prints statuses only.
No live invocation was performed here. A 200 alone is not full backend health.

In isolated host staging additionally verify real PHP proxy health, unauthenticated
private profile 401, header forwarding, public supply CORS and callback redirects
against synthetic providers; no live OAuth or payout. Native PHP transport
already has network-disabled container evidence. Apache/FPM/CDN/TLS must still
be checked on the actual host, including PATH_INFO and encoded deny paths.
Verify APK HEAD content type/nosniff and downloaded SHA-256 with a separately
authorized tool; smoke metadata alone is not downloaded binary verification.

External gates: owner host/runtime/config/data-baseline validation, consistent
backup/rollback rehearsal, actual Apache/FPM/CDN/TLS, approved provider/OAuth
acceptance, physical APK signing/install/update/native handoff and manual
screen-reader/touch review. APK remains pinned to production /app/: local
synthetic debug project is separate and cannot prove signed production APK
device behavior. Existing automated four-browser/responsive/keyboard evidence
and eight full game flows remain applicable; not redundantly rerun here.
