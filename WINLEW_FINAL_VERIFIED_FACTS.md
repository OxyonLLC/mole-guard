# WinLEW — Final Verified Facts

**Established: 2026-08-11.** Second, independent audit ("audit the auditor").

Every figure below was re-derived from Solana mainnet or from source in this
repository **during this pass**. Nothing was copied from
`WINLEW_PUBLIC_FACT_AUDIT.md` or from the previous audit's conclusions. Where a
fact could not be verified it is listed as unverified rather than omitted or
guessed.

RPC: Alchemy Solana mainnet. Method named per row.

---

## 1. Identity

| Fact | Value | Evidence |
|---|---|---|
| Mint | `DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump` | `getTokenSupply` returns a valid supply for it |
| Decimals | 6 | `getTokenSupply` |
| Domain | `winlew.co` | fetched live this session, HTTP 200 |
| Launch date | 2024-12-07 | ⚠️ **owner-stated, not independently verified.** Corroborated only indirectly: the oldest pool (`5nTz…`) was created 2025-02-10, so trading pre-dates that via the bonding curve. Consistent with, but not proof of, that date. |

## 2. Supply

| Fact | Value | Evidence |
|---|---|---|
| **Current total supply** | **950,000,000.000000** | `getTokenSupply` → `950000000000000` base units |
| Original supply | 1,000,000,000 | owner-stated; consistent with the destroyed figure below |
| **Total destroyed** | **50,000,000.000000** | 1,000,000,000 − 950,000,000. Supply can only fall via a burn instruction, so this is destroyed tokens by definition |
| — of which project-executed | 49,707,077.187484 | `src/mole/burnEvents.js` ledger, each event tied to a signature |
| — of which burned by holders | 292,922.812516 | the remainder; owner-confirmed as airdrop recipients burning outright and accounts closing with remainders |

**Both numbers are true and measure different things.** Owner decision
2026-08-11: public pages lead with the on-chain **50,000,000** and show the split
beneath it, so a reader reconciles with Solscan in one click.

## 3. Burns

| Fact | Value | Evidence |
|---|---|---|
| Latest burn | **14,878,231.210253** on **2026-08-01** | tx `2ixvHEKgdq71C41QKy6Fr4JNCeuh8Borsq2YLLUdLEG3VYg9Y5NTCa824oa7KiSu7EikQsfCk1wvU2q7AnoPHcD1`; chosen to land supply on a round 950,000,000, confirmed by reading supply after the fact |
| Burn wallet | `EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74` | `getTokenAccountsByOwner` |
| **Burn wallet balance** | **50,000,000.000000** | verified 2026-08-11 — the retained half is physically held here, **not yet burned** |
| Long-term framework | 100M | 50M destroyed, 50M retained |

**Wording rule (owner decision 2026-08-11):** the retained 50M is **an open
annual decision, not a commitment**. No page may say "50M remaining to burn" or
imply the other half is already promised. Correct framing: *retained within the
original 100M framework; each annual burn is decided on its own.*

## 4. Locks — recomputed from chain

| Component | On-chain WinLEW | Listed on site? |
|---|---|---|
| 50M Token Lock (`E8Pu1WNF…`) | 50,000,000 | yes |
| 15M Team Lock (`zLHYYpKt…`) | 15,000,000 | yes |
| 25M Faucet Lock (`8jr1Zov7…`) | 25,000,000 | yes |
| Streamflow 22M (`4XnVM4G2…`) | 22,069,652.822552 | yes |
| Streamflow 7M (`B4GJSLCH…`) | 7,013,300 | yes |
| **Jupiter Lock 2026-08-11 (`AvJi2mKq…`)** | **19,192,210.751092** | ❌ **NO — this is the gap** |
| **TOTAL LOCKED** | **138,275,163.573644** | site totals 119,082,952.82 |

### The new lock, decoded and validated

Program `LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn` (Jupiter Lock), escrow
`AvJi2mKqeUz3oRbY8GjSBkWEk3VQdjXaZ9XFnG7S6R5m`, created by tx
`2c1Ltdm36wGXrQEigBq4CFoALmcfjdYL2V7Pnn15weKnxG8QPJ2Fd62MmMHyJAEtRXEdaqfoXS7fMjzdV7RJk84H`
at **2026-08-11T02:08:32Z**, `err: null`.

| Field | Value |
|---|---|
| Amount | **19,192,210.751092** |
| Cliff | **2028-08-11T02:05:02Z**, releasing 9,192,210.751092 |
| Then | 2,000,000 per period × 5 periods, frequency 31,536,000s (365 days) |
| Fully unlocked | **2033-08-10** |
| Claimed so far | 0 |
| Recipient / creator | `D6d5byBx…` (Developer Reserve) — a **self-lock** |

**How the layout was trusted:** not by assuming a struct. The account's byte
layout was anchored empirically (mint found at offset 40, Dev Reserve at 8 and
72), then validated by reconstruction — `cliff_unlock 9,192,210.751092 +
2,000,000 × 5 = 19,192,210.751092`, which equals the transferred amount to the
base unit. A layout that reproduces an independently known total is confirmed;
one that doesn't would have been discarded.

**Unverified:** `cancel_mode` reads `0`. That most likely means the lock cannot
be cancelled, but the enum meaning was not confirmed against Jupiter's program
source, so **no page may yet claim it is irrevocable.**

**Correction to an earlier figure in this session:** first reported as
`19,192,210.751`. The exact amount is `19,192,210.751092`; the first read came
from a rounded display.

## 5. Reserves — recomputed from chain

| Wallet | On-chain WinLEW |
|---|---|
| Developer Reserve `D6d5byBx…` | 10,000,000 |
| Discord & Web Faucet Reserve `FcEtZqVo…` | 13,011,704.34 |
| X (Twitter) Faucet Reserve `GFxz42bi…` | 6,845,194.692333 |

## 6. Markets — both live, one dominant

| Pool | Program | Reserves | Classification |
|---|---|---|---|
| `Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL` | `pAMMBay6…` **PumpSwap** | 358,614,201.938 WinLEW + **31.642 wSOL** | **CURRENT — primary market** |
| `5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx` | `CPMMoo8L…` **Raydium CPMM** | 40,548,341.32 WinLEW + **5.647 wSOL** | **CURRENT — secondary, actively funded** |

The site labels PumpSwap the active market. **That label is correct** — PumpSwap
holds ~5.6× the SOL-side liquidity. A suspected HIGH finding was raised and
**cleared on evidence**.

Raydium received two deposits this week (2026-08-08: 4,809,185.04 WinLEW +
0.61425 SOL; 2026-08-10: 5,674,158.86 + 0.784267 SOL), both recorded in
`src/mole/communityLiquidity.js`. Those LP tokens sit in the Developer Reserve —
**withdrawable, not locked or burned**, and must never be described as locked
liquidity.

Pump.fun's bonding curve is **HISTORICAL**. It is the launch venue, not today's
market, and must be preserved as history while never implying it is current.

## 7. Open discrepancy driving the audit

`src/public/whitepaper/whitepaper.md:88` and its `index.html` twin state lifetime
destruction as **~49.71M** while the chain says **50,000,000**. Flagged as an
open follow-up by the previous audit (register item 1) and never resolved. It is
the single most likely thing a third-party listing reviewer would catch, because
Solscan shows 950,000,000 in one click.

---

## Method notes

- A first run of the balance sweep reported **zero WinLEW everywhere**. The
  cause was mine: `RPC` was passed as an argv rather than an env var, every
  fetch threw, and the `catch` rendered the failure as "no WinLEW". It now
  aborts when `RPC` is unset rather than reporting zeros. Recorded because a
  false clean result is the most dangerous output an audit script can produce.
- Balances are point-in-time (2026-08-11) and will drift. They are recorded as
  **verification evidence**, not as figures to hardcode into pages — live
  components already read these addresses at request time.
