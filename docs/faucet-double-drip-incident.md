# Faucet double-drip incident — findings of record

A `!drip` race in the Discord faucet sent **two or more transfers for a single claim**. Reconstructed from the chain on **2026-08-01** and recorded here so the numbers exist somewhere durable rather than in memory.

Companion to [`faucet-distribution-scanner.md`](./faucet-distribution-scanner.md).

---

## 1. Summary

| | |
|---|---|
| Distinct incidents | **28** |
| Wallets affected | **8** |
| Excess $WinLEW paid | **41,500** |
| First occurrence | 2025-05-19 |
| Last occurrence | **2026-04-24** |
| Occurrences since | **0** |

**Recollection at the time of investigation was "about 3 times."** The chain shows 28. That gap is the reason this file exists: the project had no record, so the only surviving evidence was on-chain and nobody had looked.

## 2. How the incidents were identified

The faucet enforces a rolling cooldown (default 24h) — **so two identical drips to the same wallet within minutes cannot both be legitimate.** Detection is therefore definitional rather than inferential:

> group every outbound faucet payout by *recipient token account + exact amount*, then flag any pair less than 15 minutes apart.

All 1,001 lifetime payouts from the faucet reserve were decoded and grouped this way. Chained bursts (A→B, B→C) were collapsed into single incidents, so a run of 4 transfers counts as **one** incident with 3 excess drips, not 3 incidents.

Excess is computed as `(transfers in burst − 1) × drip amount`, i.e. exactly one drip per burst was owed.

## 3. Incidents

| # | Date (UTC) | Recipient (ATA) | Transfers | Drip | Excess |
|---|---|---|---|---|---|
| 1 | 2025-05-19 10:43:23 | `8nGNUiTecrKH…` | 2 | 1,000 | 1,000 |
| 2 | 2025-05-22 10:28:08 | `8nGNUiTecrKH…` | 2 | 1,000 | 1,000 |
| 3 | 2025-05-23 05:23:38 | `7fWPVjyRVbMH…` | 2 | 1,000 | 1,000 |
| 4 | 2025-05-23 13:05:39 | `8nGNUiTecrKH…` | 2 | 1,000 | 1,000 |
| 5 | 2025-08-30 03:14:14 | `J83j7KojSkHh…` | 2 | 1,000 | 1,000 |
| 6 | 2025-08-31 08:43:59 | `HEqsUpobxind…` | 2 | 1,000 | 1,000 |
| 7 | 2025-08-31 13:17:46 | `7fWPVjyRVbMH…` | 2 | 1,000 | 1,000 |
| 8 | 2026-01-05 17:59:37 | `HpL3zqZPDacy…` | 2 | 1,500 | 1,500 |
| 9 | 2026-01-09 03:55:00 | `7fWPVjyRVbMH…` | **4** | 1,500 | **4,500** |
| 10 | 2026-01-14 21:32:10 | `UFmoKt91dpQj…` | 2 | 1,500 | 1,500 |
| 11 | 2026-03-29 14:49:17 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 12 | 2026-03-31 04:52:55 | `4hkzCEYUHFHY…` | 2 | 1,500 | 1,500 |
| 13 | 2026-04-01 03:02:37 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 14 | 2026-04-02 12:43:49 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 15 | 2026-04-02 14:05:21 | `J83j7KojSkHh…` | 2 | 1,500 | 1,500 |
| 16 | 2026-04-03 18:06:06 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 17 | 2026-04-05 02:02:39 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 18 | 2026-04-05 16:56:47 | `J83j7KojSkHh…` | 2 | 1,500 | 1,500 |
| 19 | 2026-04-06 10:22:47 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 20 | 2026-04-06 18:00:29 | `5uKK3apLjTnm…` | 2 | 1,500 | 1,500 |
| 21 | 2026-04-06 18:02:56 | `J83j7KojSkHh…` | 2 | 1,500 | 1,500 |
| 22 | 2026-04-09 00:36:26 | `8nGNUiTecrKH…` | 2 | 1,500 | 1,500 |
| 23 | 2026-04-12 13:20:04 | `J83j7KojSkHh…` | 2 | 1,500 | 1,500 |
| 24 | 2026-04-17 10:21:32 | `J83j7KojSkHh…` | 2 | 1,500 | 1,500 |
| 25 | 2026-04-24 09:35:12 | `UFmoKt91dpQj…` | 2 | 1,500 | 1,500 |
| 26 | 2026-04-24 13:16:21 | `7fWPVjyRVbMH…` | 2 | 1,500 | 1,500 |
| 27 | 2026-04-24 19:59:13 | `5uKK3apLjTnm…` | 2 | 1,500 | 1,500 |
| 28 | 2026-04-24 21:25:38 | `J83j7KojSkHh…` | 2 | 1,500 | 1,500 |

Concentration: `8nGNUiTecrKH…` 10 incidents / 13,500 · `J83j7KojSkHh…` 7 / 10,000 · `7fWPVjyRVbMH…` 4 / 8,000 · five others 7 / 10,000.

**No claw-back is proposed.** These were paid by the project's own bug, the amounts are small, and pursuing recipients would be both unjust and impractical. The figure is recorded so lifetime distribution can be explained, not to reopen anything.

## 4. Why it is fixed

`src/faucet/claimStore.js` states the invariant plainly: *before any token transfer, atomically reserve BOTH the user key and the wallet key.* Backed by a Mongo transaction (so a block on either key rolls back both) or, file-side, an exclusive-create lockfile (`fs.openSync(path, 'wx')`). A second concurrent `!drip` cannot reserve, so it cannot pay.

The Discord path runs through it: `bot.js:773 → claimFaucet() → reserveClaim()` (`service.js`). The website shares the same store and the same cooldown, so the two surfaces cannot be raced against each other either.

**One honest caveat.** That atomic reservation shipped **2026-07-10** (`84b8b0a`), but the last incident was **2026-04-24** — a ~2.5 month gap with no corresponding fix commit. The quiet stretch before the fix was most likely low usage rather than a repair. What is verifiable: the structural guarantee exists now, and there have been zero occurrences since.

## 5. Related finding — the claim store is complete for user claims

The same investigation compared every on-chain payout since claim-recording shipped against the claim store:

- **45** on-chain drips vs **42** confirmed rows → a 3-drip gap.
- 1 was a claim stuck in `reconciling` whose transfer had genuinely landed. Credited via `npm run faucet:reconcile` (see [`faucet-distribution-scanner.md`](./faucet-distribution-scanner.md) and §15 of `faucet-web-expansion.md`).
- 1 was sent at **2026-07-10 09:42:51Z**, **8.1 hours before** `84b8b0a` shipped — it predates recording entirely.
- 1 was sent to `B8M8QjTYij…`, which is **the project's own `Winlew.sol` token account** — a self-send, not a user claim.

**Unexplained user-facing claims: zero.** Every real drip since recording began has a record. The remaining difference between the claim counter and the on-chain total is the pre-2026-07-10 era, plus quiz/game rewards signed by the same wallet — exactly as described in the whitepaper §6.

Also checked and found empty: `known_failed` claims (so nothing was misfiled by `categorizeTransferError()`), and double-sends since 2026-07-10 (zero).

## 6. Reproducing this

Detection is a grouping pass over the faucet's payout history; no stored state is required, so anyone can redo it from a public RPC. The lifetime payout walk itself is `npm run faucet:scan -- --full`, which reconciles against the wallet's live balance before publishing anything.
