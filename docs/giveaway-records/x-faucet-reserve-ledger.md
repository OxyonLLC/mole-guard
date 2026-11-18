# X Faucet Reserve — complete outbound ledger

Wallet `GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp`, token account `B8M8QjTYijSkproiSZdbYAcvjXjJJ8rBAjFZUGHfFhHe`.

Its **entire** WinLEW history is 82 signatures reaching back to 2024-12-09, two days after
launch — small enough to walk completely rather than sample, so this is the whole record and not a
selection. Read from `getTransaction` token-balance deltas on 2026-08-18, never from a screenshot.
Reconstructed because the records were not kept at the time. The chain kept them anyway.

## Totals

| | amount |
|---|---:|
| received | 104,193,067.902333 |
| **given to people** | **12,228,500** across 21 wallets |
| sent to locks / programs (NOT giveaways) | 25,040,000 |
| moved internally (burn, faucet, dev) | 60,079,373.21 |

### A correction, kept rather than quietly fixed

The first version of this file reported **37,268,500 given to the public across 23 wallets**.
That was wrong. It counted every non-internal recipient as a person, and two were not:
a 25,000,000 **token lock** (2026-08-08) and a 40,000 transfer to a **Pump.fun bonding-curve**
account (2025-04-30), which is a sale rather than a gift. Recipients are now classified against
the campaign holder snapshot, which had already identified both without being told.

The real figure is **12,228,500 to 21 wallets**. Still a great deal of giving; just a true number.

## Every outbound transfer

| date (UTC) | amount | to | classification |
|---|---:|---|---|
| 2024-12-13 16:35:47 | 50,000 | `Gg9Cng6EF9aU…` | to a person |
| 2024-12-19 01:06:04 | 50,000 | `D8oJSdqoYk6h…` | to a person |
| 2024-12-26 02:14:43 | 100,000 | `AX7cMx4GMxwN…` | to a person |
| 2025-01-01 19:47:27 | 100,000 | `6Y4MJPHpG66b…` | to a person |
| 2025-01-04 03:59:22 | 100,000 | `HJRHtdz94Lcj…` | to a person |
| 2025-02-01 20:28:23 | 200,000 | `4u12XCpdz43i…` | to a person |
| 2025-02-08 00:41:43 | 100,000 | `89B84My2MA3S…` | to a person |
| 2025-02-21 02:46:51 | 500,000 | `FDhcxnSo1wB2…` | to a person |
| 2025-02-21 03:01:00 | 1,000,000 | `9JGvjo1bu4WA…` | to a person |
| 2025-02-21 05:26:08 | 100,000 | `23nSNTRJJMqE…` | to a person |
| 2025-02-22 03:54:45 | 1,529,373.21 | `EX5nxVKgRKaJ…` | internal — Burn Wallet |
| 2025-03-17 01:11:21 | 200,000 | `9JGvjo1bu4WA…` | to a person |
| 2025-03-17 01:11:21 | 800,000 | `2qo1zLvwbMEo…` | to a person |
| 2025-04-01 20:15:30 | 3,500,000 | `AqwHdem1xsrL…` | to a person |
| 2025-04-02 00:27:51 | 500,000 | `9JGvjo1bu4WA…` | to a person |
| 2025-04-02 00:36:16 | 500,000 | `FDhcxnSo1wB2…` | to a person |
| 2025-04-02 01:44:57 | 200,000 | `DEFFtTTL7rLm…` | to a person |
| 2025-04-02 01:45:45 | 200,000 | `FDhcxnSo1wB2…` | to a person |
| 2025-04-02 01:46:32 | 200,000 | `9JGvjo1bu4WA…` | to a person |
| 2025-04-02 01:47:36 | 200,000 | `64SpqFh68V3Y…` | to a person |
| 2025-04-02 01:48:27 | 200,000 | `D8oJSdqoYk6h…` | to a person |
| 2025-04-02 01:49:06 | 200,000 | `5gKXS4bT1mdW…` | to a person |
| 2025-04-02 01:49:45 | 200,000 | `D6d5byBxBcdd…` | internal — Dev Reserve |
| 2025-04-11 02:38:33 | 500,000 | `5gKXS4bT1mdW…` | to a person |
| 2025-04-14 12:45:21 | 400,000 | `FmwUvfBHmv1M…` | to a person |
| 2025-04-30 01:15:57 | 40,000 | `H3HoYtV5tg6a…` | NOT a giveaway — program-controlled (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P) |
| 2025-05-02 23:43:20 | 125,000 | `FokLS7aBXkRn…` | to a person |
| 2025-05-03 02:03:11 | 200,000 | `FhFBZ6DbbJ8E…` | to a person |
| 2025-05-22 04:31:53 | 1,000 | `9crcXyZaJG5r…` | to a person |
| 2025-08-15 15:25:20 | 1,500 | `2yupCJfQKvDz…` | to a person |
| 2026-01-30 16:58:24 | 450,000 | `FcEtZqVowuhF…` | internal — Faucet Reserve |
| 2026-06-14 04:03:49 | 1,000 | `9Wgko8Nr58B6…` | to a person |
| 2026-07-25 05:50:56 | 2,000,000 | `FcEtZqVowuhF…` | internal — Faucet Reserve |
| 2026-07-25 05:57:00 | 100,000 | `FcEtZqVowuhF…` | internal — Faucet Reserve |
| 2026-07-25 05:57:28 | 800,000 | `EX5nxVKgRKaJ…` | internal — Burn Wallet |
| 2026-07-27 00:19:58 | 1,000,000 | `D8oJSdqoYk6h…` | to a person |
| 2026-07-27 00:20:42 | 1,000,000 | `9JGvjo1bu4WA…` | to a person |
| 2026-08-01 07:00:17 | 50,000,000 | `EX5nxVKgRKaJ…` | internal — Burn Wallet |
| 2026-08-07 19:15:16 | 5,000,000 | `FcEtZqVowuhF…` | internal — Faucet Reserve |
| 2026-08-08 04:57:42 | 25,000,000 | `8jr1Zov74Vbb…` | NOT a giveaway — token lock program |
