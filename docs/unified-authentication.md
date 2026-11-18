# Unified Authentication — Phase 3

Date: 2026-07-11
Scope: consolidate wallet-connect and session logic across Mole Hub, Faucet, Quiz, and Verify's profile editor into one shared implementation.

## 1. What existed before

Every app that touches a wallet had grown its own copy of the same logic, at different points in time, with different levels of completeness:

| File | Lines | Provider detection | Mobile fallback | Notes |
|---|---|---|---|---|
| `mole-hub/js/app.js` | ~1560 | Full (Phantom/Solflare/GeoWallet, multi-provider try-in-order) | Yes (picker + deep link) | The most mature implementation — everything else was later ported *from* this one during earlier work this session. |
| `faucet/js/app.js` | ~475 | Full (ported from Mole Hub earlier this session) | Yes | |
| `quiz/js/app.js` | ~622 | Full (ported from Mole Hub earlier this session) | Yes | |
| `verify/link.js` | 580 | Full, but a separately-written implementation, not a copy of Mole Hub's | Yes | Solves a different problem — see §4. |
| `verify/profile.js` | 831 | Partial (Phantom + Solflare only, `getPhantom`/`getSolflare`/`getAutoProvider`) | **No** | Used only for re-authorizing profile edits; had the exact "dead-end on mobile" bug the rest of this work fixed elsewhere. |
| `src/public/link.js` | 507 | Full, feature-complete | Yes | **Referenced by zero pages.** An orphaned older/duplicate copy — deleted as part of this work. |

Session storage was already mostly consistent (`winlew.verify.session` / `winlew.verify.app` in every file), but the wallet *display* cache was split between two different keys (`winlew.verify.wallet` in Mole Hub/Verify, `winlew.hub.wallet` in Faucet/Quiz) — meaning a user who connected on one app and then visited another under a fresh page load could see "Connected ✓" instead of their actual wallet label, purely because the label cache was under a different key.

## 2. What changed

**`src/public/assets/wallet-auth.js`** (new) is now the single source of truth for:

- The API-base bridge (`hubApiFetch`/`hubApiUrl`) — routes `/api/*` calls through `/verify/api-proxy.php` on the winlew.co shared-hosting domain, direct otherwise. This was already identical across every app; now it's defined once.
- Wallet provider detection (`getHubWalletProviders`, `connectHubWalletProvider`, `providerWalletAddress`, `walletProviderHelp`) — Phantom, Solflare, GeoWallet, tried in order, each provider's own errors handled individually (a GeoWallet-specific `unsupported method: sol_connect` error doesn't block falling through to the next provider).
- The mobile deep-link picker (`showMobileWalletPicker`, `closeMobileWalletPicker`, `buildPhantomBrowseUrl`/`buildSolflareBrowseUrl`/`buildGeoWalletBrowseUrl`, `openMobileWalletBrowser`) — one modal, one set of deep-link URL builders, used identically everywhere it appears.
- The session/wallet-cache localStorage keys (`AuthKeys`), standardized on `winlew.verify.*` (already the majority convention) with a one-version read-compatibility shim for the old `winlew.hub.wallet` key so an existing session doesn't lose its wallet label on first load after this change.
- A high-level `walletLogin({ triggerBtn, onSuccess, onError })` — the full challenge → sign → store-session flow against `/api/hub/wallet-login[/challenge]`, used as-is by Faucet and Quiz (their post-login step is just "reload my status") and available to any future app that needs the same flow.

No bundler exists on this static site, so this is a plain classic `<script>` (matching `nav.js`'s existing pattern) exposing everything on `window.WinLEWAuth`, loaded before each app's own script tag.

## 3. How each app was migrated

- **Faucet** (`js/app.js`: 475 → 233 lines) and **Quiz** (`js/app.js`: 622 → 389 lines) — both had byte-for-byte identical copies of the wallet-connect block. Fully replaced with a two-line wrapper around the shared `walletLogin()`.
- **Mole Hub** (`js/app.js`: 1562 → 1441 lines) — kept its own `walletLogin()` function intact, since it has real extra steps interleaved with login (wallet-verification-status UI, guest-winnings reconciliation, server wallet sync) that don't fit the generic `onSuccess` callback shape cleanly, and a local `readHubApiJson` that also throws on a non-OK HTTP status — a stricter contract than the shared version, which four *other*, unrelated API calls in this file (profile, history, claim, reconcile) depend on. Migrated the parts that were pure, side-effect-free duplication (provider detection, the picker, deep-link builders, the API-base bridge) to the shared module; left the app-specific orchestration local. This is a deliberate, narrower consolidation than Faucet/Quiz got, chosen because the risk of subtly changing error-handling behavior on the platform's highest-traffic, real-money surface outweighed the benefit of a few more shared lines.
- **Verify's profile editor** (`profile.js`) — replaced `getPhantom`/`getSolflare`/`getAutoProvider` (Phantom + Solflare only, no mobile fallback) with the shared `connectHubWalletProvider()`. This is a straight upgrade: profile-edit re-authorization now supports GeoWallet and, on mobile, no longer dead-ends the way it used to.
- **`src/public/link.js`** — deleted. Confirmed via `grep` that no HTML file anywhere references it; it was dead code.

## 4. What was deliberately *not* touched: `verify/link.js`

Verify's own wallet flow (`/verify/`) solves a different problem than the other four apps: establishing a *brand-new* Discord ↔ wallet link via an OAuth-style linked-roles flow, with SNS (`.sol` domain) resolution and its own desktop-to-phone QR handoff already built in. It is not reading an existing session the way Mole Hub/Faucet/Quiz do — it's creating one.

It already has full provider coverage (Phantom/Solflare/GeoWallet) and mobile deep-link support, independently implemented rather than copy-pasted from Mole Hub, so it never had the dead-end bug this work set out to fix elsewhere. Rewriting the single most sensitive step in the entire funnel (first-time wallet verification) to share code with four other apps, for a benefit that's mostly aesthetic at this point, was judged not worth the regression risk. This is the one place in the codebase where "one wallet connection flow" doesn't literally mean "one function" — the low-level wallet-selection UI is the same *pattern* everywhere, but Verify's linking flow is legitimately a different operation from the other four apps' sign-in flow.

**Correction (2026-07-17):** the claim above — "it never had the dead-end bug" — was wrong, and the project owner caught it in production use, not this doc. `connectWallet()`/`signMessage()`'s no-provider branch *did* have the exact bug, just gated behind an extra layer: `isMobileDevice()`'s UA sniffing (checks `Android|iPhone|iPad|iPod|Mobile`, plus a `Macintosh`+touch special case for iOS "Request Desktop Website") doesn't recognize a *mobile* browser's own "Desktop site" mode, which strips those tokens from the UA on Android too. When that misfired, the code fell into the `else` branch: a bare `alert("Wallet not detected. Install Phantom/Solflare...")` — a real dead end, since browser extensions don't exist on mobile at all regardless of site mode. Separately, even on a correctly-detected mobile device, the auto-connect path's fallback (`openWalletBrowser("auto")`) silently redirected to Phantom's deep link only — GeoWallet was detected (`getGeoWallet()` existed and worked) but never reached from the primary "Connect wallet" button, only from the secondary manual-picker section below it.

**Fix:** `connectWallet()`/`signMessage()` no longer branch on `isMobileDevice()` at all to decide the fallback. Both now call a new `revealWalletPicker()` whenever `getProviderByKey()` returns null, full stop — it reveals the same `#mobileWalletActions` panel (GeoWallet/Phantom/Solflare/Jupiter, already built, already wired via `wireMobileButtons()`) regardless of any device-type guess. This is more robust than gating on `isMobileDevice()`, not just a patch to that function's regex — "no provider was found" is itself sufficient reason to offer the choice, and doesn't depend on correctly inferring device type at all, whether that guess would have been fooled by desktop-site mode, a future OS/browser UA change, or anything else. Regression-tested in `test/nav/verify-wallet-fallback.e2e.test.mjs` — including a test that explicitly reproduces the reported bug (a mobile viewport with a spoofed desktop UA, the "Desktop site" scenario) and asserts no `alert()` fires and the picker becomes visible.

## 5. What "connect once, stay connected everywhere" actually means here

There is no server-side cross-app session registry — the mechanism is the shared `winlew.verify.session` / `winlew.verify.app` localStorage keys, already used identically by every app before this change and unchanged by it. Because all of `winlew.co`'s first-party pages share one browser origin, a session written by any app is immediately readable by every other app on the next page load — no reconnect required, no code needed beyond what already existed. This work centralized the *code that writes and reads* those keys, and fixed the one place (the wallet display-name cache) where the key name itself had drifted.

## 6. Files changed

- `src/public/assets/wallet-auth.js` (new) — the shared module.
- `src/public/faucet/js/app.js`, `src/public/faucet/index.html`
- `src/public/quiz/js/app.js`, `src/public/quiz/index.html`
- `src/public/mole-hub/js/app.js`, `src/public/mole-hub/index.html`
- `src/public/verify/profile.js`, `src/public/verify/profile.html`
- `src/public/link.js` — deleted (orphaned, unreferenced).
- `src/public/verify/link.js` — untouched, deliberately (§4).

## 7. Verification

Manual + Playwright verification after each app's migration (not synthetic — real Chromium, real tap/click events, never forced):

- Mole Hub, Faucet, Quiz: mobile wallet picker opens correctly (no dead-end alert) after migration, matches pre-migration behavior.
- Quiz: full tile-picker → question → answer → result flow re-verified end-to-end against a mocked API after migration — identical behavior to before.
- Mole Hub: page loads with zero console errors, `window.WinLEWAuth` is present and correctly populated.
- Verify's profile.html: loads with zero console errors, `window.WinLEWAuth` present.
- Full nav regression suite (`test/nav/site-nav.e2e.test.mjs`): 36/36 passing across mobile/tablet/desktop on every page, unaffected by this change.
- Full repo test suite: 122/122 passing.

## 8. Known remaining duplication (documented, not hidden)

- `verify/link.js` still has its own copy of provider-detection/deep-link logic (§4) — an intentional exception, not an oversight.
- `mole-hub/js/app.js`'s `readHubApiJson` remains a local, stricter variant of the shared one (§3) — intentional, documented inline in the file itself.
