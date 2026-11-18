# WinLEW Mobile App Beta

Date: 2026-07-16
Location: `mobile/` (a self-contained Capacitor project, separate from the Node/Express server code in `src/`).

## Architecture

The mobile app is a **native wrapper around the live winlew.co website** — not a second product. It has:

- **No separate frontend.** `mobile/capacitor.config.json` sets `server.url: "https://winlew.co"`, so on launch the native shell loads the exact same pages `src/public/` already serves — including this sprint's `/quiz/` redemption card. There is nothing in `mobile/` that duplicates HTML/CSS/JS from `src/public/`.
- **No separate business logic.** Authentication, quiz, faucet, dashboard, Proof of Value, redemption, burn, partners — all of it is the existing web app, unchanged. The only new code this milestone added to the *website itself* is a small, always-inert-unless-native "native bridge" appended to the already-shared `src/public/assets/nav.js` / `nav.css` (see "Native bridge" below).
- **No separate authentication.** Session cookies/localStorage inside the wrapper's WebView work exactly like a mobile browser tab — the same `winlew.verify.session` mechanism `src/public/assets/wallet-auth.js` already uses.

### Bundled vs. remote vs. hybrid — and why remote

| Approach | Tradeoff |
|---|---|
| **Bundled static assets** | Every content/bugfix update requires a new app-store release and user update. Risks the app silently drifting out of sync with the live site (two copies of `src/public/` to keep identical). |
| **Remote hosted (chosen)** | Always shows the current live site — a fix shipped to `winlew.co` is live in the app immediately, no store review needed for content/logic changes. Requires network connectivity on launch (see "Known limitations"). This is the only approach that satisfies the sprint's explicit "no duplicated frontend" rule without extra sync tooling. |
| **Hybrid** | Adds real complexity (service-worker-style caching, versioning, offline bundle updates) for a beta that doesn't yet need offline support. Deferred — noted as a natural next step if offline becomes a real requirement. |

`mobile/www/index.html` still exists (Capacitor's CLI requires `webDir` to contain real content for `cap sync`) but is not shown in normal use — `server.url` takes over on launch.

**Security/update tradeoff of remote-hosted**: the app trusts `winlew.co` at request time on every launch, same as a browser tab — there is no bundled fallback if the domain is ever compromised or DNS-hijacked, which a bundled app would partially resist. This is an accepted tradeoff for a beta prioritizing update velocity; documented, not hidden.

## Supported platforms

- **Android**: fully built and validated this sprint (see Validation below) — a real, installable debug APK exists at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`, built via the project's own Gradle wrapper against the Android SDK (platforms 33–35, build-tools 35.0.0) already present in this environment. It targets API 35, which Google Play now requires — see "Android SDK levels and toolchain".
- **iOS**: project structurally scaffolded (`mobile/ios/`, a real Xcode project with `co.winlew.app` bundle id, generated app icons/splash screens) but **not built or run** — this environment has no macOS/Xcode/CocoaPods, so `pod install` and any Xcode build step were skipped by Capacitor's own tooling. Reported as **Blocked**, not passed. See "iOS build instructions" for what a macOS machine needs to do next.

## Supported features

Every feature already on `winlew.co` is reachable identically inside the wrapper, since it's the same site: Home, Dashboard, Wallet verification, Quiz (including this sprint's on-web redemption), Faucet, Mole Hub, Proof of Value, Participation cards, Burn Center, Transparency Center, Whitepaper, Sponsors & Partners, public profile, Terms/Privacy pages. Nothing was disabled or hidden in the wrapper.

## Native bridge (`src/public/assets/nav.js`, appended section)

Capacitor auto-injects a `window.Capacitor` global into any page it renders — including this remote one — so the bridge is plain JS with **no build step, no bundler, no import**. Every line is gated behind `window.Capacitor.isNativePlatform()`, which is only `true` inside the native wrapper; on a normal desktop/mobile browser visit this code never executes (verified — see Validation).

- **Safe-area / status bar**: `StatusBar.setOverlaysWebView({overlay:true})` + CSS `env(safe-area-inset-*)` padding (`.nav{padding-top:...}`, `body{padding-bottom:...}`, `nav.css`) rather than letting the OS push content down. `viewport-fit=cover` is on the viewport meta tag of **every** page under `src/public/` so `env()` actually resolves instead of defaulting to 0. **This covers iOS only.** WKWebView reports real inset values for the notch/Dynamic Island and home indicator; Android's WebView only ever reports a safe area for a physical *display cutout* and never for the status or navigation bars, so on Android these values are 0px on any phone without a notch. Android's insets are handled natively instead — see "Edge-to-edge on Android 15" below. It started as the primary journey pages only (Home, Verify, Dashboard, Quiz, Faucet, Mole Hub, Partners, Burn, Transparency, Whitepaper); 2026-08-01 swept the remaining 43 — including real nav destinations that had been missed (Contribute, Leaderboards, Profile, Sponsors, Community, Policies, Discord Bots and its terms/privacy set, Health, Wallet, Modules, Mole Link, WinLEW Forge). Without it the bridge's safe-area padding silently computes to 0 on that page. The attribute is inert in a normal browser, so new pages should just include it by default. The only exclusions are the three pre-launch `/geoagora/` holding stubs (~800-byte redirect pages, not in nav).
- **Android back button**: closes an open nav menu first, then falls back to `history.back()`, then `App.exitApp()` only when there's nowhere left to go.
- **External-link handling**: any link whose origin differs from `winlew.co` (Discord, X, Solscan, DexScreener, RugCheck, GeckoTerminal) opens via `@capacitor/browser`'s `Browser.open()` (a Custom Tab / SFSafariViewController) instead of navigating the app's own WebView away.
  - **Wallet links are excluded, and this matters.** An earlier version of this document claimed `Browser.open()` "is what lets the OS resolve a wallet's universal link into the actual wallet app". **That is false, and acting on it broke wallet connect on a real device (2026-08-02):** a Custom Tab is a browser, so `phantom.app/ul/browse/…` renders as Phantom's marketing page offering to install the app the user already has. What actually launches the wallet is a plain navigation — `window.location.href`. Capacitor's `BridgeWebViewClient.shouldOverrideUrlLoading` passes it to `Bridge.launchIntent()`, which fires `new Intent(Intent.ACTION_VIEW, url)` for any off-origin host and returns `true`, so Android resolves it to the installed wallet **and the WebView does not navigate** — the app stays put, still holding the pending hand-off. `WALLET_APP_HOSTS` in nav.js keeps wallet domains out of the Custom Tab path.
- **Deep-link return (`appUrlOpen`)**: receives `co.winlew.app://auth-callback?handoff=<id>` and drives the wallet session hand-off, alongside a foreground-resume retry that completes the same exchange when the deep link never arrives. Nothing from the URL is stored — the id is only checked against the one this app itself started. See "Session hand-off (the wallet round trip)".
- **Offline banner**: standard `navigator.onLine`/`online`/`offline` browser events (no extra plugin needed) — shown even in a plain mobile browser tab, not just the wrapper.
- **App lifecycle resume**: dispatches a `winlew:native-resume` DOM event any page's own `app.js` may opt into later; not wired into every page this beta (documented extension point, not forced onto pages that don't need it).
- **Splash screen**: hidden on `DOMContentLoaded` via `@capacitor/splash-screen`.

## Mobile wallet experience

The existing wallet-connect flow (`src/public/assets/wallet-auth.js`) is unchanged. On mobile it already opens a "browse" universal link (`phantom.app/ul/browse/...`, `solflare.com/ul/v1/browse/...`) that hands the current page off to the wallet app's own in-app browser — this is standard for mobile dApps and was not modified.

### Session hand-off (the wallet round trip)

The structural problem: tapping "Connect wallet" in the wrapper opens
Phantom/Solflare/GeoWallet, and the user signs inside *that app's* in-app
browser — a separate storage context. The session created over there is
invisible to the wrapper's WebView, so the user used to come back still logged
out. This is what closes that.

The exchange is deliberately shaped like OAuth's authorization code, **not**
"put the session token in the return URL". The return trip is a custom-scheme
deep link, and a custom scheme is claimable by any app on the device (on Android
a second registrant produces a chooser; on iOS which app wins is undefined), so
anything in that URL must be assumed readable by an attacker.

| Step | Who | What |
|---|---|---|
| `POST /api/hub/native-handoff/start` | the wrapper, before opening the wallet | invents a 256-bit claim secret, registers only its SHA-256 hash, gets back a hand-off id |
| — | the wrapper | opens the wallet's browse URL with `?native_handoff=<id>` appended |
| `POST /api/hub/native-handoff/deposit` | the page inside the wallet's browser, after signing | attaches its session token to that id (rejected without a valid session) |
| `POST /api/hub/native-handoff/claim` | the wrapper, on return | presents the id **and** the secret; the session comes back exactly once and the record is deleted |

The deep link carries only the hand-off id. An app that intercepts it holds an
identifier it cannot redeem, because the claim secret never left the wrapper.
Server side is `src/mole/nativeHandoff.js` (five-minute TTL, single-use, one
deposit per hand-off, five wrong guesses burns the record, the session is
re-validated at claim time so a revoked one is never handed back); client side
is the native-handoff section of `src/public/assets/wallet-auth.js` and
`setupDeepLinkReturn`/`setupResumeHandoffClaim` in `src/public/assets/nav.js`.
Covered by `test/mole/nativeHandoff.test.mjs`.

**What the first device test found (2026-08-02).** The hand-off got exactly one
step in. A record was created — so the app registered it and opened Phantom
correctly — but `deposited` stayed `NO`, meaning the page inside the wallet's
browser never handed its session back, and the app therefore had nothing to
claim. The symptom from the outside was "everything works in Phantom, then
nothing syncs when I go back".

Two mistakes in the original implementation, both now fixed:

- **The hand-off id lived only in the URL.** It is attached to the page the
  wallet opens, so the moment the user navigates anywhere — to `/verify/`, to
  the dashboard, to anything — it was gone, and with it any chance of handing
  the session back. It is now persisted in the wallet browser's own storage, so
  the hand-off survives a journey rather than a single page view. Only the id
  is stored there, never the claim secret.
- **The deposit was hooked only into `walletLogin()`.** `/verify/` never calls
  it: that flow arrives with a session already in the URL from Discord OAuth
  and runs its own challenge/signature. So a user who went to *verify* — the
  most likely thing to do in the app — completed everything inside the wallet
  browser and handed nothing back. The deposit now watches for a session to
  exist at all, whatever produced it, bounded to three minutes and only while a
  hand-off is actually in progress.

**Three ways back, because the deep link is the fast path and not a dependable
one.** Wallet in-app browsers frequently refuse to navigate to a custom scheme,
in which case no URL is ever delivered. So: the deep link is attempted; a
visible "Return to WinLEW" button is rendered; and the wrapper re-attempts the
claim (a short backoff poll) every time it returns to the foreground. Any one of
the three completing is enough, and **the resume poll alone is sufficient** —
the user simply switching back to the app by hand completes the login.

**Residual risk, stated rather than hidden.** An attacker who learned a pending
hand-off id *before* the legitimate deposit could attach their own session to it
and land the wrapper in the attacker's account — a login-CSRF / session-fixation
shape. The id is 32 characters of `nanoid`, lives five minutes, and appears only
in one wallet-browser URL; OAuth's `state` parameter has the same property. It
is nonetheless the reason the id must never be logged, shortened, put in a QR
code, or otherwise widened beyond the two parties.

**A related bug fixed on the way.** In the wrapper, the mobile wallet picker
navigated with `window.location.href`, which the external-link handler in
`nav.js` never sees — it only intercepts clicks on `a[href]`. So choosing a
wallet navigated WinLEW's *own* WebView to `phantom.app`, leaving nothing behind
to hand a session back to. It now goes out through the shared
`openMobileWalletBrowser()` in the wrapper (a plain `location.href`, which
Capacitor turns into an app-launching intent — see the external-link note
above). The previous version of this document described that path as already
using `Browser.open`; it did not.

- Wallet not installed: the universal link falls back to each provider's own web install page — existing behavior, untouched.
- Returning from an external wallet: works today for the plain mobile-browser case (unchanged); inside the native wrapper the hand-off above carries the session across, and switching back manually is one of the three supported return paths rather than a dead end.
- Session restoration / account switching / disconnect / expired session / failed signature / user cancellation: all existing `wallet-auth.js` behavior, unchanged and exercised identically inside the WebView as in a mobile browser tab.
- No private-key custody, no seed-phrase handling, and no wallet-provider availability is faked anywhere in this app — the wrapper never touches key material; it only ever navigates to `winlew.co` and to each wallet provider's own official domain.

## Permissions

The built Android app requests exactly one permission: `android.permission.INTERNET` (plus the standard Android-13+ auto-added `co.winlew.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, not a runtime-dangerous permission). No location, contacts, microphone, camera, or broad file access — verified via `aapt dump badging` against the built APK.

## Android SDK levels and toolchain

| Setting | Value | Where |
|---|---|---|
| `minSdkVersion` | 22 (Android 5.1) | `mobile/android/variables.gradle` |
| `compileSdkVersion` | 35 (Android 15) | same |
| `targetSdkVersion` | 35 (Android 15) | same |
| Android Gradle plugin | 8.10.1 | `mobile/android/build.gradle` |
| Gradle | 8.13 | `mobile/android/gradle/wrapper/gradle-wrapper.properties` |
| JDK | 17 | Capacitor's generated `sourceCompatibility`/`targetCompatibility` |

Capacitor 6 generates 34/34 with AGP 8.2.1, which is below Google Play's current
floor — **Play rejects new uploads that don't target API 35**, so 34 was a hard
blocker for any store submission regardless of how the app behaved. AGP 8.2.1
refuses to build against `compileSdk 35` at all (8.6 is the first release that
accepts it), so the plugin and the Gradle wrapper had to move with it. The
Capacitor plugin modules under `mobile/node_modules/@capacitor/*/android` pin
AGP 8.2.1 in their own `buildscript` blocks; that's ignored — the root
classpath wins — and they compile against 35 unmodified, because each one reads
`compileSdkVersion`/`targetSdkVersion` from `rootProject.ext` (the values in
`variables.gradle`) and only falls back to its own 34 default when unset.
`androidx.core` moved 1.12.0 → 1.13.1 at the same time, the first release built
with Android 15 in mind.

### Edge-to-edge on Android 15

This is the one behavioural change targeting 35 forces, and it needed real code
rather than a version bump. Up to targetSdk 34 the system inset the window for
the status and navigation bars. Targeting 35 stops doing that: the window is
laid out edge-to-edge, and `android:statusBarColor`/`navigationBarColor` become
no-ops. Left alone, winlew.co's header would render underneath the clock and the
gesture bar would sit on top of the page footer.

The site's CSS `env(safe-area-inset-*)` padding does **not** rescue this on
Android, for the reason given under "Native bridge" above — the WebView reports
0px for the system bars. So `mobile/android/app/src/main/java/co/winlew/app/MainActivity.java`
(previously an empty `BridgeActivity`) now applies `systemBars() | displayCutout()`
insets as padding on the content view, and paints that view with
`@color/winlewSystemBars` (`#130b08`, the site's own page background) so the bar
strips read as part of the app instead of exposing the splash drawable behind
them. Keep that colour in step with the `wl-bg` token in
`src/public/assets/nav.css`.

Deliberate choices worth knowing:

- **No `android:windowOptOutEdgeToEdgeEnforcement`.** That manifest flag would
  restore the old behaviour with one line, but it's temporary — ignored from
  Android 16 — so it only moves the same work to a later release.
- **IME insets are not folded into the padding.** The window still pans for the
  keyboard exactly as it did before; adding `Type.ime()` here would move the
  content twice.
- **The iOS CSS path is untouched and still correct**, and the two don't stack:
  once the WebView is padded clear of a cutout, the inset the WebView itself
  reports drops to 0.

**Not yet verified on a physical device or emulator** — this environment has
neither. The APK builds clean, lint reports no errors, and the inset wiring is
confirmed present in the shipped bytecode, but how the bars actually look on an
Android 15 handset is unconfirmed. That is the first thing to check on real
hardware.

## iOS deployment target and store readiness

| Setting | Value | Where |
|---|---|---|
| `IPHONEOS_DEPLOYMENT_TARGET` | 13.0 | `mobile/ios/App/App.xcodeproj/project.pbxproj` (4 places) and `platform :ios` in `mobile/ios/App/Podfile` |
| `TARGETED_DEVICE_FAMILY` | `1,2` (iPhone + iPad) | project.pbxproj |
| `SWIFT_VERSION` | 5.0 | project.pbxproj |
| `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | 0.1.0 / 100 | project.pbxproj (see "App versioning") |

iOS has no equivalent of Play's target-API floor — Apple gates on the **SDK the
build machine used**, not on a value stored in the repo. App Store Connect
requires uploads built with the iOS 18 SDK, i.e. Xcode 16 or newer, so that's a
requirement on whoever runs the Mac build; nothing here pins it. The deployment
target stays at 13.0, which is Capacitor 6's own minimum — raising it would only
drop users and gains nothing.

What did need changing, all in `mobile/ios/App/App/Info.plist` unless noted:

- **`contentInset` `always` → `never`** (`mobile/capacitor.config.json`). This is
  the iOS twin of the Android edge-to-edge bug and it points the other way —
  double padding rather than none. Capacitor maps `ios.contentInset` to the
  WKWebView scroll view's `contentInsetAdjustmentBehavior`, and `always` makes
  the scroll view inset content for the safe area on its own. Because
  `CAPBridgeViewController` makes the WKWebView the root view (`view = webView`),
  it is already full-bleed and `viewport-fit=cover` already resolves
  `env(safe-area-inset-*)` correctly — so the generated `always` stacked a
  second inset on top of the CSS padding, roughly doubling the gap under the
  notch. `never` is the setting that pairs with `viewport-fit=cover`.
- **`ios.backgroundColor` `#130b08`.** With no background set, Capacitor falls
  back to `UIColor.systemBackground` — white on a light-mode device — which
  shows as a white flash on a dark site before the page paints. Same colour and
  same reason as `@color/winlewSystemBars` on Android; keep the two in step.
- **`UIRequiredDeviceCapabilities` `armv7` → `arm64`.** Capacitor's generated
  default declares a 32-bit capability no device that can run this app has: the
  deployment target is 13.0 and iOS dropped 32-bit hardware at 11.
- **`ITSAppUsesNonExemptEncryption` = `false`, added.** The wrapper ships no
  crypto of its own; it loads winlew.co over the system's HTTPS/TLS, which is
  exempt. Without the key, every TestFlight upload parks in "Missing Compliance"
  until the same question is answered by hand in App Store Connect. **This is a
  legal declaration in your name — re-check it if the app ever gains native
  cryptography beyond HTTPS.**
- **`UIStatusBarStyle` = `UIStatusBarStyleLightContent`, added.** Applies during
  launch, before any view controller exists, so the clock stays readable over
  the dark splash. `UIViewControllerBasedStatusBarAppearance` stays `true`, so
  once the bridge is up the plugin's `setStyle({style:'DARK'})` (Capacitor's
  "DARK" = light text for a dark background) takes over unchanged.

No app-level `PrivacyInfo.xcprivacy` was added: Capacitor's own pods ship theirs
(`node_modules/@capacitor/ios/.../PrivacyInfo.xcprivacy`), the app target adds no
Swift of its own beyond the stock `AppDelegate`, and so it uses no required-reason
API directly. Revisit if native code is ever added to the target.

**None of this is compiled or verified.** There is still no macOS/Xcode here, so
these are reviewed changes to project inputs, not a build. Both files were
parse-checked (`plistlib`, `json`) and the config was propagated with
`npx cap copy ios`, which is as far as this environment goes.

## Android build instructions

```
cd mobile
npm install
npx cap sync android
cd android
echo "sdk.dir=/path/to/your/Android/sdk" > local.properties   # not committed
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## iOS build instructions (requires macOS)

```
cd mobile
npm install
npx cap sync ios
cd ios/App
pod install                 # requires CocoaPods (gem install cocoapods)
open App.xcworkspace        # build/run from Xcode, or:
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' build
```

## Environment configuration

`mobile/capacitor.config.json`'s `server.url` is the single place that decides what the app loads. It currently points at production (`https://winlew.co`). To point a local build at a staging/dev server instead, change that one value and re-run `npx cap sync`.

## App versioning

`mobile/package.json`'s `version` is the single source of truth for the **wrapper's** version. This is deliberately *not* the root `package.json` site version (`3.3.4` etc.) — the shell ships on its own cadence, and winlew.co updates reach users without a new APK, so tying the two together would inflate the app version on releases that never produced a build.

- **Android** derives both values at configure time in `mobile/android/app/build.gradle`: `versionName` is the raw string, `versionCode` is `major*10000 + minor*100 + patch` (so `0.1.0` → `100`). A non-semver value fails the build with a clear message rather than shipping a wrong number. Capacitor's generated default was a hardcoded `versionCode 1` / `versionName "1.0"`, which had already drifted from `package.json`.
- **iOS** can't read `package.json` without an Xcode run-script phase, which can't be verified in this environment — so `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `mobile/ios/App/App.xcodeproj/project.pbxproj` are set to the matching values by hand (`0.1.0` / `100`). **Bumping `mobile/package.json` requires updating those two settings too** (each appears twice, Debug and Release).

Google Play rejects an upload whose `versionCode` is not higher than the previous one, so bump `mobile/package.json` before every store build.

## Signing requirements

No signing keys, keystores, or provisioning profiles are committed — `mobile/.gitignore` and `mobile/android/.gitignore` exclude `*.jks`, `*.keystore`, `*.p12`, `*.mobileprovision`, and (added 2026-08-02) `keystore.properties`, which holds the password. Only `*.jks` was covered before that; the credentials file would have been committed.

**Android release signing (set up 2026-08-02).** An upload keystore now exists *locally* at `mobile/android/winlew-upload.jks` — 4096-bit RSA, alias `winlew-upload`, 10000-day validity, `CN=WinLEW`, certificate SHA-256 `93b567cc…f877a6`. Its credentials live in `mobile/android/keystore.properties`. **Both are gitignored and exist on one machine only.**

> ⚠️ **Losing either one is unrecoverable.** Play identifies an app by its signing key; there is no reset and no appeal. If they are lost, `co.winlew.app` can never be updated again — only republished as a different app, losing installs, reviews and listing. Back both up somewhere that survives the loss of the build machine.

`app/build.gradle` reads those credentials and signs `assembleRelease` with them, enabling v1, v2 **and v3** signing. v3 carries the proof-of-rotation record and only helps if present from the first published build — a rotation path cannot be added retroactively, which is the mitigation for the paragraph above. A clone without the keystore still builds debug normally, and `assembleRelease` produces an *unsigned* apk rather than failing; the build prints which of the two happened, because an unsigned release that looks successful is exactly what gets uploaded by mistake.

Verified on the first signed build: 25.8 MB (vs 41 MB debug), `application-debuggable` absent, `targetSdkVersion 35`, all three signature schemes verifying.

iOS still has no signing material — a real Apple certificate and provisioning profile have to be created on a macOS machine.

## TestFlight / Play Internal Testing path (not executed this sprint)

Both require a paid developer account (Apple Developer Program, Google Play Console) this environment has no access to and this sprint was not asked to create. The path once a release build exists:

- **Android**: `./gradlew bundleRelease` → signed `.aab` → upload via Google Play Console → Internal Testing track → add testers by email.
- **iOS**: archive in Xcode → upload via Xcode Organizer/Transporter → TestFlight → add internal/external testers.

Nothing was published to either store. `npx cap add`/`sync`/`build` never touch app-store credentials.

## Known limitations

1. **The wallet session hand-off is built but has never run on a phone.** The exchange is implemented end to end and its server half is covered by `test/mole/nativeHandoff.test.mjs`, but no part of the device path — the wallet app opening, the deep link arriving (or being blocked), the resume poll firing — has been exercised on real hardware, because this environment has none. It is the thing to test first, and the resume poll is what to watch if the deep link turns out to be swallowed. See "Session hand-off" above.

   **What a device test needs (checked 2026-08-02):** the site half is deployed and current — `winlew.co` serves the shipped `nav.js` / `wallet-auth.js` byte-for-byte, from its own host (`Server: openresty`), independently of the bot machine. The remaining dependency is the **API**, which reaches the Node backend only through `winlew.co/verify/api-proxy.php` → the ngrok tunnel. With the tunnel down, `/api/hub/native-handoff/*` returns `ERR_NGROK_3200` and the hand-off cannot complete — as will every other API call, so this is not specific to mobile. Confirm the tunnel is up before concluding anything about the hand-off itself.

   **Interaction with the v3.3.5 verification gate, worth knowing before testing.** Past 10 lifetime claims the faucet asks the user to verify, and verifying means signing — which inside the wrapper is the very flow this hand-off exists to make work. So a mobile user over the threshold depends on the untested path to clear a gate that is blocking them. It is not a hard lock: verifying in an ordinary mobile browser (outside the app) works today and is unaffected. But test the hand-off with an account **under** 10 claims first, or the two unknowns will be tangled together.
2. **No offline bundle / custom offline screen.** If the device has no network on launch, the native WebView shows its own default "can't connect" error page (real, visible — not a silent failure) rather than a branded WinLEW offline screen. Building a custom native offline screen requires writing platform-specific (Kotlin/Swift) code beyond a JS bridge, deferred.
3. **iOS is unbuilt and unverified** in this environment — structurally complete, not validated. Needs a real macOS machine to confirm it actually compiles and runs. That now covers the store-readiness and safe-area fixes in "iOS deployment target and store readiness" too: they are reviewed changes to project inputs, never compiled.
4. **Android 15 edge-to-edge is unverified on real hardware** — it builds and lints clean, but no device or emulator here could confirm how the status/navigation bar strips actually render (see "Edge-to-edge on Android 15").
5. **Generated icon/splash assets are large** (~90 MB across both platforms' density sets) — normal for a two-platform Capacitor app with full icon/splash coverage, but worth knowing before cloning this repo on a constrained connection.
6. **No app-store listing work** (screenshots, descriptions, privacy-nutrition labels) — out of scope for a beta.

## Security boundaries

- The wrapper has no code path that signs a transaction, holds a private key, or moves funds — it only ever navigates to `winlew.co` and to wallet providers' own domains.
- `server.url` is the one and only content source; there is no bundled copy of the site that could silently drift out of date or diverge in behavior from the live, audited web app.

## Beta feedback process

Feedback on this beta should go through the same channels as the rest of the platform — the WinLEW Discord (linked from every page's footer) or the project's existing GitHub issue process. No separate feedback mechanism was built for the mobile app specifically.


---

# Notifications (0.2.0, 2026-08-14)

Asked for by the owner after Jim — contributor #2, and the only person outside
the team running the APK — suggested it. The brief: tell people when a faucet
claim or a quiz payout is ready, nudge at 48 hours of silence, then weekly.

## Local, not push

Every one of those is **predictable on the device**. A faucet cooldown ends at a
known time, a quiz cycle closes at a known time, and "48 hours since you last
opened this" is a clock. So `@capacitor/local-notifications` does all of it and
there is **no Firebase project, no push token, no delivery service, and nothing
about a device stored on a server**.

Push (FCM) would only be needed for something we cannot predict — a held payout
being approved, say. Nothing on the list is that, so it was not built. If it ever
is, it is additive and the scheduling logic here does not change.

## The constraint that shapes the design

**A local notification can only be scheduled while the app is open.** Nothing can
be armed, cancelled or corrected once it closes. Two consequences:

- Every app open (including returning from background, via `appStateChange`)
  cancels our whole set and lays it down again from current facts. That is the
  only chance to correct anything.
- The weekly reminders are a **bounded series of four**, not a repeat. An endless
  chain cannot be scheduled, and the next open would silence it anyway. Someone
  who has ignored a month of reminders has answered the question.

## What is scheduled

| ID | When | Condition |
|---|---|---|
| 1 | faucet `nextClaimAt` | signed in, wallet linked, status readable |
| 2 | 6h before the quiz cycle closes | a future cycle end is known |
| 10 | now + 48h | always |
| 11–14 | weekly after that, ×4 | always |

Fixed IDs, so rescheduling **replaces** rather than stacks — that is what stops
someone who opens the app ten times getting ten reminders.

## Deliberate restraint

A notification system that fires slightly too little costs a missed claim; one
that fires too much gets the app uninstalled. On Android a permission denial is
close to permanent, so most of the logic is about **not** buzzing someone:

- **Opt-in, and the prompt is fired by a button** — never on first paint. A
  dialog thrown at someone who has just opened an app is how you earn a denial.
- **A denial is never re-prompted.** `ensurePermission()` returns false and stops.
- **Quiet hours 22:00–08:00.** Anything landing in the dead zone moves to the
  morning, never earlier — moving a claim alert earlier would fire it before the
  claim exists.
- **A deadline warning that quiet hours would push past its deadline is dropped.**
  A cycle closing at 07:00 would otherwise be announced as "closes soon" at 08:00,
  an hour after it paid out. Nothing beats wrong.
- **An unreadable faucet status schedules nothing.** `cooldownStatusOk: false`
  means the faucet's own lookup failed; guessing sends someone to a refusal.
- **Signed-out visitors get no claim alerts** — that would be telling them about
  somebody else's claim.
- **Opting out cancels what is already pending**, not just future ones.

## What it looks like when it cannot work

`getPlugin()` returns null in any browser and in **app 0.1.0, which shipped
without the plugin**. The card is then hidden entirely — a dead toggle is worse
than no toggle — and `applySchedule()` is a quiet no-op. No errors, no console
noise. The app is a website first.

**This is why 0.1.0 can never show a notification, and why 0.2.0 exists.**

## Two runtime traps avoided

- **No `allowWhileIdle`.** It maps to `setExactAndAllowWhileIdle`, which needs
  `SCHEDULE_EXACT_ALARM` on Android 12+ — a permission we do not declare and
  should not want. These are reminders; arriving a few minutes late out of Doze
  costs nothing, and an exact-alarm prompt is both alarming and a Play policy
  question.
- **No `smallIcon`.** Naming a drawable that does not exist in `res/` yields a
  blank or failed notification. Capacitor falls back to the app icon, which is
  correct until somebody draws a proper status icon.

`POST_NOTIFICATIONS` comes from the plugin's own manifest and merges in; the app
manifest still declares only `INTERNET`.

## Testing

`test/app/notify.test.mjs` — 23 cases, mostly asserting restraint. `notify.js` is
an ES module so Node imports it directly; the plugin is injected as a fake, so
none of it needs a device.

## Distribution

0.2.0 is signed with **the same key as 0.1.0** (verified: certificate SHA-256
`93b567cc…f877a6`), so it upgrades in place — no uninstall, nothing lost.

The update banner that tells 0.1.0 users about it already existed and needed no
change. That ordering matters: without it, a build carrying notifications would
have had no way to reach the people running the build that cannot notify.
