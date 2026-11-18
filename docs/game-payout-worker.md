# Game Payout Worker

Date: 2026-07-18
Service: `gamepayouts` (`src/games/payout-worker.js`), scheduled via `src/runner.js`.

## What this does

In-app game winnings (Mole Hub games — DigLEW, Pac-Mole, Root Glide, Burrow Blaster, Grub Drop) accrue through `POST /api/rewards/claim` and are recorded, unpaid, via `recordRewardClaim()` in `src/mole/rewardHistory.js`. They are **not** paid immediately — a separate nightly worker sums each player's unpaid claims and sends WinLEW in bundled transactions (multiple recipients per tx, to save gas), once a day at `GAME_PAYOUT_CRON` (default `1 0 0 * * *`, 00:00:01 UTC).

This is a deliberate design choice, not a bug by itself: the faucet is separate and pays out immediately; only in-app game winnings batch overnight. See `src/games/payoutPlanner.js` for the pure planning logic (dust threshold, wallet resolution, bundling) and `docs/` — well, until this file, nothing else documented this system; see the module's own header comments and `POST /api/rewards/claim`'s handler in `src/mole/web.js` for the write side.

## Incident: nightly runs always reported "No eligible winnings" (found 2026-07-18)

The project owner reported that game winnings ("Game WinLEW earned" / "Pending redemption" on the Dashboard) never converted to WinLEW after a nightly run — the Watchdog's `#the-logs` summary consistently read *"Game payouts `gp-...`: No eligible winnings to pay out this run."*, with no `🧪 DRY RUN` prefix (i.e. this was the LIVE-mode message, not the expected dry-run notice), regardless of how large the pending balance was.

### Root cause

`resolveWallet(discordUserId)` (in `payout-worker.js`) calls `getLinkedWalletRecord()` from `src/mole/walletLink.js`, which reads wallet-link data via `src/mole/storage.js`'s "managed JSON" cache (`linked_wallets.json`). That cache is **only ever synced from MongoDB by `initMoleStorage()`** — and `initMoleStorage()` was called **only by the main `mole` service** (`src/index.js`'s `main()`), never by `gamepayouts`, which runs as a fully separate, standalone process (own cron schedule, own long-lived lifetime).

Without that bootstrap call, `storage.js`'s `readJson('linked_wallets.json', {})` found an empty in-process cache and fell through to reading a **local on-disk file this process never itself populated** — returning `{}` every time. `resolveWallet()` therefore returned `null` for every single user, `buildPayoutPlan()` skipped every claim with reason `no_wallet`, and `plan.userCount` was always `0` — regardless of how much was genuinely pending in Mongo.

**Verified against live production data before fixing** (read-only, with the project owner's explicit go-ahead): 39 real unpaid claim rows and 7 real, correctly-maintained linked-wallet records existed in Mongo the entire time. The data was never missing — the worker process simply never looked at the right copy of it.

A second, related bug was found while writing a regression test for the fix: `src/mole/rewardHistory.js`'s **local-file fallback** (used only when Mongo is disabled or unreachable) hardcoded its path to `src/data/game_reward_history.json`, computed once at module load, completely ignoring the `DATA_DIR` config value that `storage.js`'s own file-fallback already respects. This is moot in production (Mongo is enabled and working there, so the file-fallback path is dead code), but made the failure mode harder to test in isolation and was inconsistent with the rest of the codebase's storage conventions.

### Fix

- `src/games/payout-worker.js`: `runPayoutBatch()` now calls `await initMoleStorage()` as its first step — idempotent (cached `bootPromise` in `storage.js`), so this is a correctness fix with no behavior change for the `mole` service, which already called it. `start()` also calls it once at boot (best-effort, logged, non-fatal) so a Mongo connectivity problem surfaces immediately in the service logs rather than silently at the first cron fire, which could be hours away.
- `src/mole/rewardHistory.js`: the local-file fallback path now resolves `DATA_DIR` from `getConfig()` on every access, exactly like `storage.js`'s own `filePath()` — same source of truth, same resolution behavior, no more hardcoded module-load-time path.

### Regression coverage

`test/games/payoutWorker.test.mjs` (new) reproduces the exact failure shape — wallet-link and reward-history data written directly to disk (Mongo disabled, isolated `DATA_DIR`), simulating data another process wrote previously, with this test's own process cache never separately warmed. Asserts `runPayoutBatch()` correctly resolves a real linked wallet and plans the payout without the caller needing to know to call `initMoleStorage()` itself, and that `no_wallet`/`below_min` skip reasons still work correctly for the cases that should genuinely be skipped.

## Other services sharing this class of risk

Any other standalone service that reads `storage.js`'s managed-JSON collections (`linked_wallets.json`, `sessions.json`, `oauth_tokens.json`, `wallet_challenges.json`, the governance files) without itself calling `initMoleStorage()` has the same latent bug. Checked at the time of this fix: `src/quiz/payout-worker.js` resolves wallets through a *different*, independent module (`src/quiz/wallets.js`, plain local-file reads, no `storage.js`/Mongo-cache dependency) — not affected by this specific failure mode, though not audited further here. `src/faucet/payout-worker-main.js`/`payoutExecutor.js` likewise use the faucet's own separate wallet-resolution path. If a future service is added that imports `getLinkedWalletRecord` (or anything else backed by `storage.js`'s managed JSON) outside the `mole` process, it must call `initMoleStorage()` itself — this is not automatic.

## Currently DRY RUN in some environments

`GAME_PAYOUTS_DRY_RUN` defaults to `true` (send nothing, log + write the audit ledger only). Check the live environment's actual value before assuming winnings will be sent even after this fix — flip to `false` only once the payable-user/amount logs look correct for a night or two.
