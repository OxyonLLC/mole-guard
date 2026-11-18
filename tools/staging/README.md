# Isolated WinLEW staging

Run from the repository, with installed local dependencies:

```powershell
node tools/staging/run.cjs --smoke
node tools/staging/run.cjs
```

The second command prints its ephemeral loopback URL. Open `/__staging/`, select
Synthetic A or B, then use the real application routes. Ctrl+C stops the child
and performs the independent post-run protected-file comparison. Reports,
inventory hashes and disposable application stores remain under `.test-tmp/staging-*`.
Never start `src/index.js` as a substitute: it starts production-oriented services.

The fixed child runs with the existing isolation guard before application
imports. Environment construction rejects inherited credentials, Mongo,
proxy settings and Node injection options. RPC responses and identities are
synthetic. Fake balances exercise existing eligibility checks; they are not
funded accounts. No treasury key exists and no payout worker is started.
Faucet requests can reserve disposable records; they cannot issue transfers.
Do not connect a real wallet, enter credentials, or follow external providers.

The gateway emulates the PHP `/verify/api-proxy.php` transport using only the
same local backend. It blocks dot traversal, encoded traversal, arbitrary PHP
source serving and historical public audit paths. This is not an Apache test.

## Frozen release-candidate staging

```powershell
node tools/release/verify-integration.cjs
node tools/staging/run.cjs --candidate --smoke
node tools/staging/run.cjs --candidate
```

Run these from the **original reviewed repository**, not from an artifact's
runtime folder. The fixed latest integration pointer selects the candidate;
arbitrary paths are not accepted. Its `staging/` bundle contains the frozen
runtime source, public assets, entry and synthetic fixture. The supervisor
checks all bundle hashes and original guard/policy hashes before startup and
checks them again after orderly shutdown. The original guard is preloaded and
still protects the actual repository's production stores. A copied guard with
a different protected-root location is deliberately not used.

The bundle uses installed dependencies from this checkout, without installing
packages or starting its production `src/index.js`. Data is always newly
created outside the frozen bundle in approved `.test-tmp/staging-*` directories.
Protected-file post-comparison runs even on failure. Never host `staging/`,
`local-tooling/`, `runtime/`, checkpoints or reports as public content.

## Native PHP transport

```powershell
node tools/staging/php-smoke.cjs
```

Requires Docker and a locally cached `php:8.3-cli` image. The command does not
download images. It records the immutable image ID, mounts only disposable
copies of the two proxy scripts and synthetic fixtures, and runs with
`--network none`, read-only root filesystem, dropped capabilities and no host
credentials. Real PHP/cURL talks to loopback fixture servers inside that
container. The independent protected-file audit still runs on failure.
This verifies PHP transport, not production routing, TLS or live providers.

## Separate Android debug project

```powershell
node mobile/staging-config.cjs <printed-port> usb
# For USB, on a device owner has authorized for testing:
adb reverse tcp:<printed-port> tcp:<printed-port>
# Alternatively generate for the Android emulator:
node mobile/staging-config.cjs <printed-port> emulator
```

Generation produces `.test-tmp/android-staging-*` with a separate application
ID `co.winlew.app.staging`. Install local Capacitor tooling there and use
`cap add android`, `cap sync android`, and a debug-only build. No signing key,
production wallet storage or signed APK is copied. Cleartext is limited to
this separate local debug configuration; it is not a production config change.
The emulator uses `10.0.2.2`; USB uses loopback via adb reverse.

Device checklist: open synthetic persona page; navigate all seven primary
sections; launch each game; rotate/resume; return from games; view A profile;
switch to B and check history separation; logout and recover an expired
session; test empty/error views; inspect keyboard/focus and scrolling; stop
staging and confirm connection errors are safe. Do not use production wallet
providers. Physical-device and emulator PASS require actual device evidence.

The existing APK 0.2.1, metadata and production Capacitor configuration remain
unchanged. These tools are local tooling, never public assets or production
startup entry points. See the integration progress report for exact results.
