# NEWS_INVENTORY.md

> **Generated** by `npm run news:inventory` from the repository's own records.
> Do not hand-edit — re-run it instead. Generated 2026-08-16T23:01:59.349Z.

This is the §20 gate: everything discovered, before anything is published.

**Nothing in this file is live.** `PUBLISH` is a recommendation for the owner,
not an action taken.

## Where this came from

The historical document referenced in §1 has not been supplied. §18, however,
asks for the codebase itself to be searched — and it turns out to hold most of
the history already, in structured form with evidence attached:

| Source | Records | Evidence quality |
|---|---|---|
| `src/mole/burnEvents.js` | 41 | every one carries a transaction signature |
| `src/mole/eventsData.js` | 7 | X links, partner records |
| `src/mole/modulesData.js` | 25 dated | a live route |
| `src/mole/newsData.js` | 7 | already written |

## Totals

- **79** candidates
- By recommendation: **REVIEW** 63 · **PUBLISHED** 5 · **DRAFT** 2 · **YES** 9
- By confidence: **low** 9 · **high** 51 · **medium** 19

## How confidence was decided

Derived, never guessed. **high** = an on-chain signature or a decodable
X/Discord snowflake. **medium** = a dated record whose evidence is a page or a
label. **low** = the date is inferred or the evidence is a vague string.

A `launchDate` ending in `-01` is treated as **low**: those are month-granular
placeholders, and presenting one as the day something shipped would be
inventing precision the record does not have (§6).

## Candidates

| DATE | TITLE | CATEGORY | SOURCE | RELATED | CONF | PUBLISH? | NOTES |
|---|---|---|---|---|---|---|---|
| UNKNOWN | Buy & HODL or Add Liquidity — 1,000,000 WinLEW Draw | community | src/mole/eventsData.js | /events/ | low | **REVIEW** | status=upcoming. NO DATE — startIso is null, flagged per §6. |
| UNKNOWN | 500-Follower Giveaway — 1,000,000 WinLEW | community | src/mole/eventsData.js | /events/ | high | **REVIEW** | status=upcoming. X evidence decodes to 2025-03-29T23:22:50.221Z. NO DATE — startIso is null, flagged per §6. |
| UNKNOWN | Holder-Milestone Giveaways — 100 Holders, Then 500 Holders | community | src/mole/eventsData.js | /events/ | high | **REVIEW** | status=upcoming. X evidence decodes to 2025-05-04T01:58:21.054Z. NO DATE — startIso is null, flagged per §6. |
| 2026-12-07 | Two-Year Anniversary Airdrop | community | src/mole/eventsData.js | /events/ | medium | **REVIEW** | status=upcoming. |
| 2026-08-16 | The Guard Was Watching. | security | src/mole/newsData.js | /transparency/ /discord-bots/ /health/ | high | **PUBLISHED** | Live. |
| 2026-08-16 | Fine. Let's Make This More Interesting. | announcements | src/mole/newsData.js | /events/ /transparency/ /proof-of-value/ | high | **DRAFT** | Written, awaiting owner approval. |
| 2026-08-16 | Two Years. December 7. | milestones | src/mole/newsData.js | /events/ /who-we-are/ /transparency/ | high | **PUBLISHED** | Live. |
| 2026-08-16 | HODL Rewards Is Open. | development | src/mole/newsData.js | /hodl/ /proof-of-value/ /governance/ | high | **PUBLISHED** | Live. |
| 2026-08-16 | WinLEW v4.0.0 | development | src/mole/newsData.js |  | high | **DRAFT** | Written, awaiting owner approval. |
| 2026-08-01T07:00:17.000Z | 50,000,000 WinLEW — project restock transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **YES** | Movement, NOT destruction. status=transferred-to-burn-wallet. |
| 2026-08-01T06:53:15.000Z | 14,878,231.210253 WinLEW destroyed | burns | src/mole/burnEvents.js | /burn/ /transparency/ | high | **YES** | Real destruction via the SPL burn instruction — reduces total supply. |
| 2026-08-01 | Every WinLEW Burn, In Order. | burns | src/mole/newsData.js | /burn/ /transparency/ | high | **PUBLISHED** | Live. |
| 2026-07-30 | Merch goes PARTIAL | releases | src/mole/modulesData.js | /merch/ | medium | **REVIEW** | status=partial. |
| 2026-07-25T06:05:02.000Z | 50,000,000 WinLEW — holder voluntary transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **YES** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2026-07-25T05:57:28.000Z | 800,000 WinLEW — contribution flow transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2026-07-24 | Bug Bounties goes LIVE | releases | src/mole/modulesData.js | /bounties/ | medium | **REVIEW** | status=live. |
| 2026-07-22T16:04:42Z | 1,997,104.711857 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:04:31Z | 799,791.269015 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:04:20Z | 535,713.693864 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:04:09Z | 1,196,759.864953 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:03:58Z | 538,338.196113 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:03:47Z | 547,550.246888 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:03:35Z | 1,078,816.00586 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:03:24Z | 526,812.186726 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:03:13Z | 473,305.577233 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:03:02Z | 751,215.213837 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:02:51Z | 781,918.146573 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:02:40Z | 1,106,043.940301 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:02:29Z | 914,482.656209 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:02:18Z | 556,918.088133 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:02:06Z | 966,493.871265 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:01:55Z | 884,809.057154 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:01:44Z | 497,192.935107 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:01:31Z | 625,151.761267 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:01:20Z | 1,036,318.796638 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:01:09Z | 482,253.547704 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:00:57Z | 610,503.366563 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:00:46Z | 716,566.265219 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:00:35Z | 1,065,457.442313 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:00:24Z | 680,262.710683 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:00:11Z | 511,616.430153 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T16:00:00Z | 467,601.464934 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T15:59:49Z | 944,570.433457 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T15:59:39Z | 652,995.566531 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-22T15:59:27Z | 974,976.80977 WinLEW — pumpfun boost buyback burn | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=confirmed-burn. |
| 2026-07-19 | Policies & Legal goes LIVE | releases | src/mole/modulesData.js | /policies/ | medium | **REVIEW** | status=live. |
| 2026-07-19 | Contribution System goes LIVE | releases | src/mole/modulesData.js | /contribute/ | medium | **REVIEW** | status=live. |
| 2026-07-18 | Leaderboards goes LIVE | releases | src/mole/modulesData.js | /leaderboards/ | medium | **REVIEW** | status=live. |
| 2026-07-12 | Modules & Roadmap Status goes LIVE | releases | src/mole/modulesData.js | /modules/ | medium | **REVIEW** | status=live. |
| 2026-07-09 | Shared Navigation goes LIVE | releases | src/mole/modulesData.js | / | medium | **REVIEW** | status=live. |
| 2026-07-09 | Governance goes LIVE | releases | src/mole/modulesData.js | /governance/ | medium | **REVIEW** | status=live. |
| 2026-07-01 | Mobile App Beta goes BETA | releases | src/mole/modulesData.js |  | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-06-25 | Community Events goes LIVE | releases | src/mole/modulesData.js | /events/ | medium | **REVIEW** | status=live. |
| 2026-06-22 | WinLEW Forge goes PARTIAL | releases | src/mole/modulesData.js | /winlew-forge/ | medium | **REVIEW** | status=partial. |
| 2026-06-20 | Sponsors & Partners goes LIVE | releases | src/mole/modulesData.js | /partners/ | medium | **REVIEW** | status=live. |
| 2026-06-15 | Burn Center goes LIVE | releases | src/mole/modulesData.js | /burn/ | medium | **REVIEW** | status=live. |
| 2026-06-01 | Transparency Center goes LIVE | releases | src/mole/modulesData.js | /transparency/ | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-06-01 | Health & Status goes LIVE | releases | src/mole/modulesData.js | /health/ | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-05-30T14:31:09.000Z | 4,000,000 WinLEW — holder voluntary transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2026-05-15 | Discord ↔ Web Parity goes LIVE | releases | src/mole/modulesData.js | /discord-bots/ | medium | **REVIEW** | status=live. |
| 2026-05-01 | Proof of Value goes LIVE | releases | src/mole/modulesData.js | /modules/proof-of-value-engine.html | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-03-15 | Dashboard goes LIVE | releases | src/mole/modulesData.js | /verify/profile.html | medium | **REVIEW** | status=live. |
| 2026-03-01 | Mole Hub goes LIVE | releases | src/mole/modulesData.js | /mole-hub/ | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-02-15 | Wallet Verification goes LIVE | releases | src/mole/modulesData.js | /verify/ | medium | **REVIEW** | status=live. |
| 2026-02-01 | Quiz goes LIVE | releases | src/mole/modulesData.js | /quiz/ | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-01-15 | Faucet goes LIVE | releases | src/mole/modulesData.js | /faucet/ | medium | **REVIEW** | status=live. |
| 2026-01-06T04:01:04.000Z | 2,624,510.334951 WinLEW — buy and burn market buy | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2026-01-01 | Core Infrastructure goes LIVE | releases | src/mole/modulesData.js | /modules/core-infrastructure.html | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2026-01-01 | Whitepaper goes LIVE | releases | src/mole/modulesData.js | /whitepaper/ | low | **REVIEW** | launchDate ends in -01 and is probably month-granular, not the actual ship day. DATE REQUIRES CONFIRMATION. |
| 2025-08-02T01:07:53.000Z | 10,077,932.510911 WinLEW destroyed | burns | src/mole/burnEvents.js | /burn/ /transparency/ | high | **YES** | Real destruction via the SPL burn instruction — reduces total supply. |
| 2025-06-16 | WinLEW/SOL Raydium Liquidity Farm #2 | announcements | src/mole/eventsData.js | /events/ | medium | **YES** | status=completed. |
| 2025-04-03T03:48:32.000Z | 10,000,000 WinLEW — project reserve transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **YES** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2025-04-03 | 2BRZ / 2 Brotherz Community Partnership Announcement | announcements | src/mole/eventsData.js | /events/ | high | **YES** | status=completed. X evidence decodes to 2025-04-03T02:18:46.624Z. |
| 2025-04-02 | WinLEW x 2BRZ | ecosystem | src/mole/newsData.js | /partners/ /events/ | high | **PUBLISHED** | Live. |
| 2025-03-10 | WinLEW/SOL Raydium Liquidity Farm | announcements | src/mole/eventsData.js | /events/ | medium | **YES** | status=completed. |
| 2025-02-22T04:31:00.000Z | 77,932.510911 WinLEW — buy and burn market buy | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2025-02-22T03:59:00.000Z | 1,829,373.21 WinLEW destroyed | burns | src/mole/burnEvents.js | /burn/ /transparency/ | high | **YES** | Real destruction via the SPL burn instruction — reduces total supply. |
| 2025-02-22T03:54:45.000Z | 1,529,373.21 WinLEW — project reserve transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |
| 2025-02-16T04:49:54.000Z | 300,000 WinLEW — project reserve transfer | supply-locks | src/mole/burnEvents.js | /burn/ /transparency/ | high | **REVIEW** | Movement, NOT destruction. status=transferred-to-burn-wallet. Superseded. |

## Deliberately NOT proposed

- **Ordinary staging transfers.** Most `burnEvents.js` rows are movements
  between project wallets, not destruction. They are listed for completeness and
  marked REVIEW; turning each into an article would bury the 3 that
  actually destroyed supply.
- **Anything from `communityLiquidity.js`** (62 deposits). Individually they are
  ledger rows, not news. A single article about community-funded liquidity may be
  worth writing; 62 are not.
- **Manufactured history.** §15 of the original brief is explicit, and no article
  has been generated from prose found lying around the repository.

## Known gaps

- The supplied historical document (§1) — Discord and X history that exists
  nowhere in this repository.
- Anything before **2025-02-10**, the earliest date any data module records —
  including the launch itself on **2024-12-07**, evidenced only by the pump.fun
  coin page.
