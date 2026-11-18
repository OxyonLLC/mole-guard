# Faucet Distribution Scanner

Companion to [`burn-history-scanner.md`](./burn-history-scanner.md). Answers one question from the chain:

> **How much $WinLEW has the Faucet Reserve wallet actually paid out, ever?**

Run it with `npm run faucet:scan`.

---

## 1. Why this exists alongside the claim-store counter

The site already had a "Total given away" figure on `/faucet/`, served by `/api/faucet/global-stats` from `claimStore`. **That number is not wrong, and this one does not replace it.** They measure different things, and the difference is the point:

| | `totalConfirmedAmount` (claim store) | `onChain.totalDistributed` (this scanner) |
|---|---|---|
| Source | rows this platform wrote | the wallet's own transaction history |
| Counts | claims **this codebase** processed | **everything the wallet ever sent** |
| Includes pre-platform Discord payouts | ❌ | ✅ |
| Includes quiz-cycle and game-batch rewards | ❌ (not faucet claims) | ✅ (same wallet signs them) |

So `onChain ≥ platform`, always, and by a wide margin. Presenting either as the other would be the same category error as calling a transfer to the burn wallet a burn — see [`burn-program.md`](./burn-program.md) §4. Both figures are shown, each labelled for what it is.

The reserve wallet is `FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE` (`diglew.sol`), token account `Hghcb294nXPWmXtGtV7MAXx4M4NxXF26zDahFFSyUUqG`. Per [`whitepaper.md`](./whitepaper.md) §3 it is also the reward-payout signer, which is exactly why the on-chain figure is broader than "faucet claims."

## 2. The integrity gate — why a partial scan can never be published

Every persisted result must satisfy:

```
total received IN − total sent OUT − burned  ==  the token account's live balance
```

If it doesn't, the tally is missing transactions, and **nothing is written**. `saveFaucetDistributionCheckpoint()` rejects any object with `reconciles !== true`, so an unreconciled tally cannot even become a checkpoint, let alone reach a page.

This is not theoretical caution. Building this, three separate attempts produced three different "totals":

| Attempt | Reported | Why it was wrong |
|---|---|---|
| 1 | 508,070.66 | 9 rate-limited batches skipped silently |
| 2 | 952,795.66 | per-item `{error}` responses inside valid batches skipped |
| 3 | — | correct tally, but the balance lookup returned `undefined` → treated as 0 |
| 4 | **1,287,846.66** | complete, and it closes |

Attempts 1 and 2 looked entirely plausible. Neither reconciled. **A number that doesn't close is worse than no number**, because it will be quoted.

If you tally this by hand from Solscan's UI, note that partial pagination fails the same way and will under-report.

## 3. Usage

```bash
npm run faucet:scan            # incremental — only signatures newer than the last run
npm run faucet:scan -- --full  # rebuild from genesis
npm run faucet:scan -- --rpc=primary
```

The first full run walks ~1,000 transactions and takes a few minutes. After that, incremental runs stop at the last-seen signature and finish in seconds — the same pattern `burn:scan` uses.

Exit codes: `0` success, `1` incomplete or unreconciled (nothing written).

## 4. Where the result goes

The checkpoint lands at `DATA_DIR/faucet-distribution-checkpoint.json` (gitignored, runtime-generated — never committed). Like `burn:scan`, the script `chdir`s to `src/` so `DATA_DIR` resolves the same way the running service resolves it; otherwise the checkpoint would land where the API never looks.

**Public routes only ever READ this file.** No HTTP route triggers a scan — walking a thousand transactions per request would be absurd, and it is the same rule `/api/burn/status` follows with `backupScan`.

It surfaces in three places, all of which hide the section entirely when no scan has run (rather than rendering em-dashes that look like a broken feed):

- **`/transparency/`** — its own section above the component grid. The grid shows the wallet's *current balance*; a balance says nothing about how much has flowed *through* it.
- **`/faucet/`** — under the existing claim counter, explicitly framed as the larger lifetime figure.
- **`/leaderboards/#faucetBoard`** — a context line under the ranking, noting the rankings cover only platform-recorded claims.

## 5. Keeping it current

Nothing runs this automatically. Re-run it whenever the published figure should be refreshed — after a notable stretch of activity, or before pointing anyone at the numbers. The pages show a "last checked" date, so a stale figure is visibly stale rather than quietly wrong.

A cron/`/loop` job could keep it warm; deliberately not added, since an unattended writer that fails its reconciliation gate would just log errors nobody reads.

## 6. Reconciling stuck claims

`npm run faucet:reconcile` resolves claims left in `reconciling` — the manual chain-check that `faucet-web-expansion.md` §15 describes and notes has no admin UI, so it never got done.

```bash
npm run faucet:reconcile                 # DRY RUN — prints the plan, changes nothing
npm run faucet:reconcile -- --apply      # execute it
npm run faucet:reconcile -- --include-failed
```

It matches each stuck claim against the chain on recipient ATA + **exact** amount + a ±2h window, and only proposes a credit when **exactly one** transfer matches and that signature is not already credited to another claim. Ambiguity is reported for a human, never auto-resolved — crediting the wrong claim is worse than crediting none. Dry run is the default because this writes to records that decide who got paid.

The matching logic lives in `src/faucet/reconcileClaims.js` and is pure, so the rules are unit-tested without a database.

**First run, 2026-08-01:** 1 claim credited (its transfer had genuinely landed; only the confirmation timed out) and 1 cooldown released (no transfer ever sent). See [`faucet-double-drip-incident.md`](./faucet-double-drip-incident.md) §5 for the full accounting, which found **zero** unexplained user claims since recording began.

## 7. Safety

Read-only throughout: `getSignaturesForAddress`, `getTransaction`, `getTokenAccountBalance`. No keypair is imported, nothing is signed, and no code path can send a transaction — the same structural guarantee documented for the burn scanner.
