# Backup Burn-History Scanner

Date: 2026-07-25
Scope: `src/mole/evidence/*`, `src/scripts/burn-scan.js`

## 1. Why this exists

`src/mole/burnEvents.js` (the canonical burn ledger `/burn/` displays) is populated by a maintainer manually fetching one transaction at a time from Solana and reading its instruction data — see `docs/burn-program.md`. That's exactly how the ~22.9M post-graduation gap (`burn-2026-07-pumpfun-boost`) was found and verified in a 2026-07-24 session: paginate a wallet's signature history, fetch each transaction, look for a `burn`/`burnChecked` instruction, check its mint.

This module formalizes and automates that exact process so it can be re-run on demand — as a **backup/verification path**, not a replacement. `BURN_EVENTS` stays the source of truth for what the site displays; the scanner exists to double-check it and surface anything it might have missed.

## 2. RPC configuration (env vars — placeholder values only)

This repo has **no separate paid/private RPC configured today** — checked `src/mole/config.js`, `src/faucet/config.js`, and every `.env` file. `SOLANA_RPC` (the one RPC env var this repo already uses, see `src/mole/solana.js`) is currently set to the public `api.mainnet-beta.solana.com` endpoint itself.

The scanner's RPC chain is built to slot a real paid endpoint in later without any code changes:

```bash
# .env — already-existing var, reused as the scanner's primary source
SOLANA_RPC=https://your-configured-rpc.example/replace-me

# .env — optional, not currently set anywhere in this repo
SOLANA_RPC_FALLBACK=https://your-secondary-rpc.example/replace-me
```

Fallback order (`src/mole/evidence/solanaRpcClient.js`):

1. `SOLANA_RPC` — labeled `primary-configured-rpc`
2. `SOLANA_RPC_FALLBACK`, if set — labeled `configured-fallback-rpc`
3. `https://api.mainnet-beta.solana.com` (hardcoded) — labeled `solana-public-rpc`

Identical URLs are de-duplicated, so today's reality (`SOLANA_RPC` already pointing at the public endpoint) never double-hits the same host. **No RPC URL, host, or credential ever appears in a log line, API response, or error message** — only these three short labels do. See `test/mole/burnRpcClient.test.mjs`'s secret-redaction tests.

Each endpoint gets up to 3 attempts with exponential backoff + jitter for *retryable* failures (429, 5xx, network/timeout, invalid JSON, a small set of transient JSON-RPC error codes). A *permanent* failure (4xx, an unrecognized JSON-RPC error) skips straight to the next endpoint instead of burning retries on it.

## 3. Running it

```bash
npm run burn:scan                     # incremental (default)
npm run burn:scan -- --full           # full re-walk, ignores existing checkpoint cursor
npm run burn:scan -- --verify-only    # scan + reconcile, never writes the checkpoint
npm run burn:scan -- --rpc=primary    # force one specific endpoint in the chain
npm run burn:scan -- --rpc=fallback
```

This is the **only** way a full historical scan runs. `/api/burn/status` (`src/mole/web.js`) only ever *reads* the last checkpoint this command wrote — a public request can never trigger a live scan.

The scanned address defaults to the known burn wallet (`BURN_WALLET_ADDRESS`), not the WinLEW mint itself. Scanning the mint's own signature history was tried and ruled out as a default: it's enormous (confirmed empirically — 1,000 signatures covered only ~1.5 days of trading, since every swap references the mint via `transferChecked`). A specific known wallet's history is tractable; the raw mint's isn't.

## 4. How a burn is verified

For each transaction (`src/mole/evidence/burnScanner.js`):

1. `meta.err` must be `null` — a failed transaction is never a burn, no matter what it parses as.
2. Both outer (`transaction.message.instructions`) and inner (`meta.innerInstructions[*].instructions`) instructions are scanned.
3. Only `parsed.type === "burn"` or `"burnChecked"` from the SPL Token program is accepted.
4. `parsed.info.mint` must equal the WinLEW mint exactly.
5. The amount is read from either `info.amount` or `info.tokenAmount.amount` (+ its own `decimals`), whichever the instruction provides — never assumed.
6. Decimals otherwise come from a live `getTokenSupply` call, with the documented `6` constant only as a fallback if that call fails.
7. All arithmetic uses `BigInt` on raw base-unit strings — nothing here ever does floating-point math on a token amount.
8. Each record's id is `signature:location:outerIndex:innerIndex` — dedup is by *instruction*, not just signature, so a transaction with two distinct burns keeps both.

A `null` or unfetchable transaction is recorded as **unresolved**, never treated as evidence a burn didn't happen there.

## 5. Staged vs. permanently burned

Tokens sent to `burn.winlew.sol` (the burn wallet) are **not** counted as burned by this scanner — only a real `burn`/`burnChecked` instruction reduces mint supply. `getOwnerTokenSnapshot()`'s live wallet balance (already used by `/burn/`'s "Awaiting burn" figure) is what tracks staged-but-not-yet-destroyed tokens; this scanner only ever counts actual destruction.

## 6. Persistence and checkpoints

`src/mole/evidence/burnCheckpoint.js` — a plain JSON file under `DATA_DIR` (same file-store pattern as `src/mole/contributions.js`; no new database dependency), gitignored like the rest of `data/`.

- **Atomic writes**: build the full new state, write to a `.tmp-<pid>-<timestamp>` file, then `rename()` over the canonical path. A crash or an invalid result never leaves a truncated or partial checkpoint — `saveBurnScanCheckpoint()` validates the shape first and throws (refusing to write) rather than persisting garbage.
- **Incremental refresh**: an incremental run passes the checkpoint's `newestIndexedSignature` as `until`, so only genuinely new signatures get scanned; `mergeBurnScanResult()` unions the new records into the existing set by record id (no re-scanning known history, no silent loss of prior finds).

One quirk worth knowing: `DATA_DIR` (default `./data`) resolves relative to whatever the process's cwd is — every long-running service in this repo (`src/runner.js`, `ecosystem.config.cjs`) sets `cwd` to the entry file's own directory (`src/`) for exactly this reason, so `winlew-mole`'s real data lives at `src/data/`, not a repo-root `data/`. `src/scripts/burn-scan.js` `chdir()`s to `src/` itself (after loading `.env` by absolute path, before anything else) so its checkpoint lands in the same place `/api/burn/status` looks — running it from any directory produces the same result.

## 7. Reconciliation

`reconcileBurnRecords(scanResult, storedEvents, unresolvedSignatures)` compares scanner output against `BURN_EVENTS` by transaction signature (never mutates either side):

- **matched** — signature found, amount agrees.
- **amountMismatches** — signature found, amount disagrees. Never silently "corrected."
- **missingFromRpcScan** — a stored, signed event whose transaction *was* fetched but contains no matching burn. A real discrepancy worth investigating.
- **missingButUnresolved** — a stored event whose transaction the scan simply couldn't fetch this run (rate-limited, pruned, network error). Deliberately reported separately from the above — conflating the two would let a rate-limited public RPC make a previously-verified burn look disputed. (Confirmed live: `burn-2025-08-02` showed up here, not as a real gap, during a rate-limited run against the free public endpoint.)
- **missingFromStoredHistory** — the scan found a real burn with no ledger entry at all. Candidate for a new `BURN_EVENTS` entry.
- **duplicateStoredRecords** / **duplicateRpcRecords** — the same signature appearing twice on either side.

A stored event with no `signature` (e.g. `burn-2026-07-pumpfun-boost`, recorded from a supply-delta reconciliation rather than a located transaction) is correctly skipped, not flagged as missing — it was never claimed to be locatable by signature.

`/api/burn/status`'s `backupScan` field surfaces a summary of the *last locally-run* scan's reconciliation counts — `null` until someone has run `npm run burn:scan` at least once. It's informational only; nothing on `/burn/` currently changes based on it, and nothing here ever auto-edits `BURN_EVENTS`.

## 8. Known limitation: the public RPC rate-limits under load

Confirmed live (2026-07-24): a real scan of the burn wallet's 27-transaction history hit `429 Too Many Requests` on 17 of them against `api.mainnet-beta.solana.com` under this scanner's default concurrency (5). This is expected free-tier behavior, not a scanner bug — the rate-limited transactions correctly show up as `unresolved`, and any ledger event whose signature falls in that set correctly reports as `missingButUnresolved` rather than a false discrepancy. Once a real paid `SOLANA_RPC` (or `SOLANA_RPC_FALLBACK`) is configured, this goes away — no code changes needed, just the env var.

## 9. Tests

`test/mole/burnScanner.test.mjs`, `test/mole/burnRpcClient.test.mjs`, `test/mole/burnCheckpoint.test.mjs` — 61 tests total, all against mocked RPC/fixture data, zero live network dependency. Covers: outer/inner/both-amount-shape burn detection, wrong-mint and failed-tx rejection, `null`-transaction handling, instruction-level dedup, multi-burn-per-tx, exact `BigInt` arithmetic, `before`/`until` pagination, retry/backoff, primary→fallback→public failover, secret redaction, atomic-write/no-overwrite-on-failure, incremental merge, and reconciliation (including the unresolved-vs-genuinely-missing distinction).
