# Changelog

All notable changes to WinLEW / Mole-Guard are recorded here.

## Unreleased

### Governance: verifying earns your vote again — the gate is split in two
- **Any verified wallet can vote again.** The bar to cast a vote is back to holding **1 WinLEW**, where it was until 2026-07-17. Verifying was always meant to be what earned you a voice; when the minimum was raised to 1,000,000 that incentive quietly disappeared for every holder under a million tokens, and published copy went on promising something the code no longer did.
- **1,000,000 WinLEW now gates *amplifying* a vote, not having one.** Buying additional weight on top of your free vote — paid for with governance contributions, and still capped at `MAX_PURCHASED_VOTES_PER_PROPOSAL` — requires holding at least 1,000,000. So both intents survive: a small holder always has a voice, and only a committed holder can raise theirs, never past the ceiling.
- Purchased weight is judged on the **same snapshot-locked balance** eligibility used, not a fresh live read, so weight can never be bought against a balance that differs from the one that qualified you. It fails closed: if no balance is available, you keep your free vote and get no purchased weight.
- **The honest trade-off, stated on `/governance/rules/` rather than left to be discovered:** while voting required 1,000,000, briefly funding a wallet at a proposal's snapshot boundary cost a million tokens per vote. It no longer does — a sybil vote now costs a Discord account and a verified wallet. What it buys is capped at one vote, purchased weight still needs the full 1,000,000 held, and quorum still applies.


## v3.3.6 — 2026-08-06

A full accuracy audit of every public page. 42 folders in `src/public/` were
checked line by line against the code, the chain, and a real browser — nothing
here was accepted because it sounded right. Two of the findings were security
issues, and both are fixed.

### Security: your dashboard was readable from your wallet address alone
- **`/api/profile/by-wallet` handed the full private payload to anyone who knew a wallet address.** No session, no proof of ownership — just an address in a URL returned the whole dashboard, including every other wallet linked to that account and the claim-cooldown state. It now returns a trimmed public view unless the request carries the owner's own session; the private response dropped from 42,718 bytes to 2,682. A regression test asserts a second linked wallet appears nowhere in the public body, and was confirmed to fail before the fix.

### Security: the verify hand-off link was being sent to a third party
- **`/verify/` was posting your session token to an outside QR service.** Opening the page from Discord puts a one-time session in the URL, and that token can complete a wallet link — which repoints the account's faucet and payout wallets. The desktop hand-off drew its QR code by handing that whole URL to `api.qrserver.com`, automatically, on every desktop load, including for people who never opened that section. The QR is gone; **Copy link and the Phantom/Solflare hand-offs are untouched**, and the page now says plainly that the link is a credential and must not be pasted into chat.
- A sibling proxy under `/geoagora/` accepted `..` in its path, which let it reach past its own prefix to any backend route — bypassing the allowlist `/verify/api-proxy.php` enforces for exactly that reason. Closed, and both proxies stopped publishing the tunnel URL in error responses.

### Navigation: eight pages in the menu wore the wrong identity
- **The seven `/ecosystem/` project pages and `/no-thank-you/promotions/` all rendered as the storefront** — its subtitle, its icon, and "Home" highlighted as the active link, on pages that are not Home. `PAGE_CONFIGS` matches paths exactly, so a page without its own entry silently falls back to the first one. This had already happened once before and been fixed by hand; it recurred because no test covered it. It is now covered: adding a page to the menu without giving it an identity fails the suite.

### Accuracy: figures that had quietly gone stale
- `/roadmap/` was missing **six** registry items, including Proof of Value — the project's central mechanism — and the Cross-Chain Bridge, which the code explicitly protects as retained-but-deferred. It also claimed "17 of 23 modules" (the registry has always had 24) and a version number that had been wrong twice in three weeks.
- `/transparency/` described **one** Streamflow vesting contract when there are two, understating locked supply by ~7M, and mislabelled a 2025 pump.fun pool as the original launch market when the Raydium pool predates it by five months.
- `/who-we-are/` still said 34.8M burned; the ledger says 49.71M. The gap is exactly the 2026-08-01 burn.
- `/proof-of-value/` claimed the engine "never touches a payout-eligible field" while tier bonuses were changing what Quiz and Mole Hub claims pay. The bonus is now stated with its caps, and the faucet correctly excluded.
- `/no-thank-you/promotions/` told readers a verified wallet earns a free governance vote. Voting needs 1,000,000 WinLEW, as every other page correctly says.
- Every corrected figure is now pinned by a test that reads the same source the page should have.

### Search: thin redirect pages could outrank the real ones
- **38 "redirecting…" stubs, 23 of them indexable**, competing in search results with the pages they point at — including `/verify.html`, `/health.html` and the root-level terms/privacy duplicates. All now `noindex`, with canonical tags added only where a stub genuinely is an alias of one real page.

### Readability and weight
- **Black-on-black button text fixed** on the Dashboard and Mole Hub. Buttons inherit neither colour nor font, so `.btn` rules that set only a background left the label at the browser's default black — measured at 1.08:1 against a 4.5:1 standard. All 64 pages were then measured in a browser; none carry dark-on-dark text.
- Large images that were being drawn into small boxes are gone: Mole Hub 10.43 MB → 1.26 MB, nav avatars 10.11 MB → 224 KB, the merch social card 3.9 MB → 118 KB.
- A build tool that had been living in the published web root, and 16 MB of leftover debug screenshots, were removed from the site.

### For operators
- `.env.example` now documents **every** environment variable the code reads, with each default taken from source rather than assumed.
- `FAUCET_PAYOUTS_DRY_RUN` is an allowlist (`1`/`true`/`yes`/`on`), **not** "any non-empty value" — anything else reads as false and sends real payouts. The previous wording could have cost tokens.
- New: `npm run header:audit` (moved out of the web root), plus tests covering nav coverage, redirect-stub hygiene, and the published figures on `/roadmap/`, `/transparency/`, `/who-we-are/` and the whitepaper.


## v3.3.5 — 2026-08-02

### Faucet: unlimited anonymous claims are over
- **After 10 claims, the faucet asks you to verify your wallet once.** Until now a wallet could claim forever without ever proving who was behind it. From the 10th lifetime claim onward, `!drip` and the web faucet ask for a one-time signature at <https://winlew.co/verify/> — no tokens move, nothing is spent, and your cooldown is unaffected. Verification already expires on the normal cycle, so this renews with it rather than being a one-off toll.
  - **Existing heavy claimers are included, deliberately.** The accounts worth asking are exactly the ones that have claimed most, so nobody is grandfathered. In practice this was one wallet at the time of writing, not a wave.
  - The count is the higher of *per wallet* and *per Discord account*, never the sum. Counting only the wallet would be reset for free by making a new one; counting only the account would forget older migrated claims. Tunable with `FAUCET_VERIFY_AFTER_CLAIMS` (0 disables).
- **`!drip <address>` now only pays a wallet you have registered.** Previously a claim could be aimed at any address, which left payouts with nothing tying them to a Discord account. Save it once with `!register <wallet-or-domain>`, then `!drip` on its own. Typing your own saved address still works; a stranger's does not. The refusal hands back the exact command to run.

### Faucet: claims show their proof again
- **`!drip` shows the transaction link even when the network is slow to confirm.** A slow RPC made successful claims report "still being verified on-chain" with no link at all — the tokens had gone out, and three such claims on 2026-08-01 were confirmed on-chain the whole time. The signature is now kept when confirmation times out, so you get the Solscan link labelled as awaiting confirmation instead of nothing. The web faucet does the same, and claim history rows link through automatically.
- A transaction that is confirmed but reverted on-chain is now reported as a failure rather than a success.

### Faucet: tools for spotting coordinated claiming (moderators)
- `!faucetcotiming` — accounts that keep claiming together **across separate days**. One shared burst is never reported, because a faucet announcement makes everyone claim at once; repetition is the signal.
- `!faucetcluster` — the on-chain funding cluster around a wallet, read-only. Distinguishes who actually *created* an account from who merely transacted with it early, so a ban is never aimed at the wrong one.
- `!faucetban` / `!faucetunban` / `!faucetbans` — a ban follows funding edges, so a banned user cannot simply move to a fresh wallet funded from the old one. `--review` records a suspicion without refusing anyone. Nothing is banned by default.
- These narrow *who is worth looking at*; they do not prove identity, and the tools say so where it matters.

### Mobile beta: Play-store ready, and wallet sign-in now returns to the app
- **The Android app targets API 35**, which Google Play now requires for new uploads. Android 15 forces edge-to-edge, so the app applies the system-bar insets itself instead of the site's CSS, which cannot see them on Android.
- **Connecting a wallet no longer leaves you logged out.** Signing happens in the wallet app's own browser, a separate storage context, so the session never made it back. It now returns through a one-time code exchange rather than putting a session token in the return URL, which any app on the device could read. If the return link is blocked, simply switching back to WinLEW completes the sign-in.
- iOS: fixed doubled padding under the notch, added the missing export-compliance and device-capability declarations that would have stalled a TestFlight upload, and stopped a white flash on launch.

### Watchdog: a broken Claude key no longer floods the logs
- **Fixed the Watchdog spamming a full error trace on every bot failure.** Watchdog asks Claude to explain failure-looking bot messages, and when the Anthropic API account ran out of credit it logged a complete stack trace for every single one — retrying something that could never succeed. The explanations themselves were never broken (Watchdog falls back to its own built-in explanations), only the noise. A problem a human has to fix — no credit, a bad key, revoked access, a bad model name — is now reported once, in one line that says what to do, and automatic requests pause for 30 minutes instead of hammering away. Temporary problems (rate limits, Anthropic outages) still retry as before.
- `!wd-ping` now says when Claude is paused and why. Previously a key that couldn't actually be used still reported "✅ API key loaded", which is exactly how this outage managed to look healthy. Typing `!wd` or `!wd-test` retries immediately and resumes normal operation the moment it works again.
- Fixed a latent bug that would have made upgrading the Claude model fail with a confusing error resembling a billing problem. Covered by new automated tests.

### Security: rate limits can no longer be bypassed by faking your IP
- **Closed a bypass that made every rate limit on the site optional.** The server sits behind an ngrok tunnel, so all traffic arrives from the local tunnel agent and visitors are told apart by a forwarded-IP header. The server trusted that header outright — and because the tunnel's address is publicly reachable, anyone could send a made-up IP with each request and get a brand-new allowance every time. Faucet challenges, quiz redemption, contribution submission and the wallet endpoints could all be hammered at will. The server now only believes the one hop it can actually verify (the address the tunnel itself observed), so invented IPs no longer buy anything.
- **Visitors coming through winlew.co still get their own individual limits.** The site's PHP proxy can vouch for the browser it saw by presenting a shared secret (`WINLEW_PROXY_SECRET` on the proxy, `WEB_PROXY_SHARED_SECRET` on the server). Without the secret nothing breaks — limits simply group all winlew.co visitors together rather than trusting an unverifiable claim.
- The trust setting is now configurable (`WEB_TRUSTED_PROXY_IPS`) for anyone fronting the server with a real reverse proxy, and deliberately cannot be set back to "trust everything". Covered by new automated tests that replay the original spoofing attack.

### Reward economy: 1500 minimum payout everywhere + Proof of Value is now a long game
- **Unified 1500-WinLEW minimum payout across every payout path, matched to the faucet's drip (`DRIP_AMOUNT=1500`)** — no payout is ever smaller than one faucet click. Prompted by a few users redeeming daily off 2-3 quiz questions or a couple of game rounds.
  - Quiz `/redeem` (Discord and web, same shared service) now rejects requests below `QUIZ_MIN_REDEMPTION_WINLEW` (default 1500) with a clear "keep stacking points" message and a structured `below_minimum` code. The web redeem card shows the minimum up front.
  - Weekly quiz cycle close no longer settles below-minimum balances into dust payouts — those points carry forward into the open cycle, untouched and still redeemable, and pay out once they cross the line.
  - Leaderboard residual payouts' floor is now at least the redemption minimum (was 500 points).
  - Nightly game payouts' dust threshold (`GAME_PAYOUT_MIN`) raised 100 → 1500; sub-threshold winnings already carried forward to a future night, and still do.
- **Proof of Value v2.5: reaching the top is now a months-long campaign, not a strong fortnight.** Two weeks in, the top score had already hit 67/100. The sub-score curve exponent softened from sqrt (0.5) to 0.75 and the faucet/games caps were re-anchored to ~6 months of daily participation (faucet 150 → 180 claims, games 300 → 1500 claims). Legend (90+) now takes roughly 4-6 months of genuinely daily play across quiz, faucet, games, and verification; two weeks of daily everything lands mid-Participant. Tier bands, weights, the streak bonus, and the tier reward multipliers are unchanged.

## v3.3.4 — 2026-07-26

### Onboarding: new landing page + hub split
- Split the site into a lean, plain-language landing page at `/` ("Participation becomes proof.") aimed at first-time visitors, and moved the full existing hub/dashboard experience to `/home/` for people who already know WinLEW.
- Added a `/no-thank-you/` page for visitors who decline to continue, and a `/landing.html` redirect for old links.
- Every nav entry, page header, and page icon across the site was reviewed and given consistent modern art (see below) so the whole experience feels like one product instead of a patchwork of pages added over time.

### Quiz: weekly cycles, redeem-anytime confirmed, and a real payout bug fixed
- **Switched quiz cycle payouts from quarterly (91 days) to weekly (7 days).** The old quarterly cycles (C1–C3) were closed out and settled; weekly cycles now run under a new "W" prefix starting from this release. Manual `/redeem` already worked independently of cycle length and continues to — players can redeem earned points for WinLEW on demand at any time, they don't have to wait for a cycle to close.
- **Fixed a real double-payout bug**: a player who manually redeemed points early could be paid again in full for the same points when their cycle later closed automatically, because the cycle-close payout and the manual redemption drew from the same pool without talking to each other. This was already confirmed to have happened once in production. Manual redemptions now correctly reduce what's still owed at the next cycle close, so this can't happen again. Covered by new automated tests.
- Closed out a cycle (C2) that had gone unclosed past its window, so no player's earned points were left stranded before the weekly switch.

### Faucet & quiz: holder-only redemption, with clear buy-WinLEW guidance
- Reverted web-based Faucet and Quiz redemption to token-holder-only (any WinLEW balance > 0), matching the existing Discord bot behavior, after abuse from accounts with zero WinLEW holdings.
- Added clear, direct messaging everywhere a claim can be rejected for this reason: why the requirement exists (creating a wallet's first token account has a real one-time Solana cost), framed as a fair trade — WinLEW happily keeps paying out faucet claims and quiz rewards after that, and the cost is typically recovered within about 10 redemptions.
- Added real purchase links (pump.fun, Raydium) directly in the rejection message on both the website and Discord bot, so a zero-balance user always has a clear next step.

### Contribute / Clout / Burn
- Added a missing on-chain contribution to the Contribute page and Clout leaderboard.
- Replaced the anonymized "WinLEW's #1 Holder" label with the real handle, `millerknoll`, on the Clout leaderboard and the `/burn/` page, matching how Bounties already credits this contributor.

### Verify page
- Fixed Jupiter wallet detection using the Solana Wallet Standard, so Jupiter is now recognized as a connected wallet provider instead of always falling back to a copy-link handoff.
- Fixed a dead-end "Session missing/expired" error by surfacing a working "Verify with Discord" link instead of leaving the user stuck.
- Added wallet nicknames so returning users can tell which linked wallet is which at a glance.
- Added a `dev:backup` script to prevent data loss when working across multiple machines.

### Mole Hub
- Fixed a Pac-Mole listing that was mislabeled as mobile when it's a web game.
- Replaced Grub Drop's placeholder thumbnail with real artwork.

### Visual refresh
- Added custom header banners and nav icons to every major page (about, burn, dashboard, discord bots, events, faucet, governance, health, modules, partners, policies, privacy, quiz, terms, transparency, verify, whitepaper, WinLEW Forge, and more), layered alongside each page's existing art rather than replacing it, for a more modern, consistent feel across the site.
