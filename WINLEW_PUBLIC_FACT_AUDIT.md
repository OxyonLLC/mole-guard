# WinLEW Public Fact Register

Working reference for the public-directory content audit. **Not a public page.**

Every figure here was verified against the source named beside it on the date
shown. Where a claim could not be verified it says so — an unverified entry is
worth more than a confident guess, because the whole point of this register is
that pages stop disagreeing with each other by copying the same wrong number.

Verification priority used throughout: implementation code → on-chain records →
project data files → live winlew.co → third-party sources.

Established 2026-08-03.

---

## Identity

| Fact | Value | Source | Confidence |
|---|---|---|---|
| Launch | 2024-12-07 | owner-stated | MEDIUM — not independently verified here |
| Domain | winlew.co | live | HIGH |
| Mint | `DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump` | `src/mole/burnEvents.js:17`, `.env`, chain | HIGH |
| Decimals | 6 | `burnEvents.js:18` | HIGH |
| Burn wallet | `EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74` | `burnEvents.js:19` | HIGH |
| Faucet reserve | `FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE` | `src/mole/contributions.js:28` | HIGH |

## Supply

| Fact | Value | Source | Confidence |
|---|---|---|---|
| Original supply | **1,000,000,000** | reconciles exactly with chain; owner-confirmed | HIGH |
| Current total supply | **950,000,000.000000** (raw `950000000000000`) | `getTokenSupply` RPC, 2026-08-03 | HIGH |
| Total destroyed, all sources | **50,000,000.000000** | 1B − current supply | HIGH |
| — of which project burns | 49,707,077.187484 | `burnEvents.js` | HIGH |
| — of which community burns | **292,922.812516** | the remainder | HIGH |

✅ **Previously flagged as a discrepancy; now resolved.** The gap is not an
accounting error — it is **tokens burned by holders themselves**, which the
project ledger has no way to enumerate. The owner confirms users have burned
airdropped amounts outright (one recipient burned 100,000 immediately) and that
closing accounts commonly burn small remainders. An SPL token's supply can only
decrease through a burn instruction, so the 1B → 950M delta *is* destroyed
tokens by definition.

**This has a publishable consequence.** `/burn/` reports 49.7%, counting only
burns the project can independently evidence — a deliberate and correct choice.
But measured on-chain, total destruction is exactly **50,000,000 = 50.0%** of the
100M framework. Both numbers are true and they measure different things:

- **49,707,077.187484** — burns the project executed and can evidence per-transaction
- **50,000,000** — every WinLEW destroyed by anyone, project and community together

Showing both is more transparent than showing either alone, and it credits burns
the community paid for. Neither figure should be presented as the other.

## Burns — all HIGH confidence

Source: `src/mole/burnEvents.js` (`summarizeBurnEvents()`, `computeBurnProgress()`),
each event carrying an on-chain signature.

| Fact | Value |
|---|---|
| Confirmed burned | **49,707,077.187484** |
| Target framework | 100,000,000 |
| Progress | **49.7%** |
| Remaining to target | **50,292,922.812516** |
| Confirmed burn events | 32 (of 41 ledger entries) |
| Latest burn | **14,878,231.210253** on 2026-08-01 (`burn-2026-08-01`) |
| Also 2026-08-01 | 50,000,000 **transferred into** the burn wallet — staged, **NOT destroyed** |
| Annual benchmark | August 1 — a recurring reference point, explicitly **not** a committed scheduled amount (`BURN_BENCHMARK`) |

**Wording rules.** ~50M is burned and permanently gone. The remaining ~50M of the
100M framework is **not** promised to burn on any date — `BURN_BENCHMARK`'s own
description says the benchmark "is not a guaranteed scheduled transaction with a
committed amount". Tokens sitting in the burn wallet are **staged, not burned**:
buying or transferring tokens does not destroy them, only an `spl-token` burn
instruction does.

## Market

| Fact | Value | Confidence |
|---|---|---|
| Origin | Launched via Pump.fun bonding curve, since **graduated** | owner-stated, MEDIUM |
| Active pair | `Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL` (PumpSwap) | **CONFIRMED 2026-08-04** — GeckoTerminal resolves it to a WinLEW/SOL pool on `pumpswap`, created 2026-07-22T15:59:15Z. HIGH |
| Pool timeline | Raydium `5nTz…` 2025-02-10 · pump.fun AMM `H3Ho…` 2025-07-19 · PumpSwap `Hmif…` 2026-07-22 | verified 2026-08-04, GeckoTerminal. NB: `H3Ho…` is **not** the launch market — it post-dates Raydium by 5 months. HIGH |
| `H3Ho…` liquidity | $0.00 | verified 2026-08-04. HIGH |
| `winlew.token` domain | **No longer resolves.** Worked once (screenshot evidence, Domain Owner = the mint) via a RugCheck-paid package the owner says lapsed >1yr ago; AllDomains' current 48-TLD list has no `.token` | owner-stated + TLD list checked 2026-08-04. MEDIUM-HIGH |
| Mint on graduation | unchanged | HIGH |
| Price/market cap | server-side `GET /api/price/status` | HIGH |

**Wording rule.** Never describe the bonding curve as the current active market.
Historical framing is correct and worth keeping: "originally launched through
Pump.fun and later graduated to its active post-bonding market."

## Features — verified against code

| Feature | Verified fact | Source |
|---|---|---|
| Quiz bank | **242 questions** — 115 regular (easy 40 / medium 35 / hard 40) + 127 sponsor (xyo 72, winlew 55) | `questions.js`, `sponsor.js` |
| Quiz redemption | Holder-only; minimum 1500 WinLEW (`QUIZ_MIN_REDEMPTION_WINLEW`); below-minimum carries forward | `src/quiz/db.js:41`, `redemption.js` |
| Quiz cycle length | **Cannot be read off-box** — reads come from the live machine's local `db.json`, not Mongo | `src/quiz/storage.js` |
| Faucet drip | `DRIP_AMOUNT` (1500), cooldown 24h, holder minimum applies | `src/faucet/config.js` |
| Faucet verification gate | Required past **10 lifetime claims**, higher of per-wallet/per-account, no grandfathering | `src/faucet/eligibility.js` |
| Faucet wallet rule | `!drip` pays only a wallet already registered to the account | `src/faucet/service.js` |
| Modules | 24 records: 17 live, 1 partial, 1 beta, 1 internal, 1 deferred, 1 planned, 2 historical | `src/mole/modulesData.js` |
| Mobile | Signed release APK, targetSdk 35; iOS never compiled | `mobile/`, `docs/mobile-beta.md` |
| Total supply | **950,000,000** (orig 1,000,000,000; 50,000,000 destroyed) — read live, never hardcode it into a page | on-chain `getTokenSupply`, 2026-08-05 |
| Mint / freeze authority | **Both renounced (null)** — verified directly on-chain, not from the site | `getAccountInfo` jsonParsed, 2026-08-05 |
| Locks | 50,000,000.00 Jupiter · 15,000,000.00 Jupiter team · 22,069,652.82 Streamflow · **7,013,300.00 second Streamflow** = 94.08M. There are TWO Streamflow contracts — prose that says one under-counts by ~7M | on-chain, 2026-08-05 |
| Burn wallet | Holds 50,000,000 — **staged, NOT destroyed**. Same figure as the amount already destroyed, so never add them or call the balance "burned" | on-chain, 2026-08-05 |
| `.sol` names | `burn.winlew.sol`, `winlew.sol`, `diglew.sol`, `dev.winlew.sol`, `lewsales.sol` all resolve to their listed addresses | SNS on-chain, 2026-08-05 |
| Markets | PumpSwap `Hmif…` created 2026-07-22T15:59:15Z, depth ~$5,603 · Raydium `5nTz…` created 2025-02-10, depth ~$601 · pump.fun `H3Ho…` depth $0. **All three had $0 24h volume** | GeckoTerminal, 2026-08-05 |
| Governance | Full voting from Discord (`/mole proposals|vote|myvote|votes|propose`); vote choices private; board sealed under 5 voters | `src/mole/commands.js`, `governanceStore.js` |
| Roadmap phases | 5 phases; 1–4 complete, **Phase 5 ongoing** — never describe Phase 5 as finished | `ROADMAP_PHASES` |
| Cross-Chain Bridge | **Deferred, retained** by 2026-07-12 decision — never "live", "complete", "cancelled", nor absent from `/roadmap/`; guarded in `validateModulesRegistry()` **and** `test/mole/roadmapPageRegistry.test.mjs` | `modulesData.js:761, 844-860` |
| XL1 integration | **Read-only, and not started.** The sole touchpoint reads a linked XL1 wallet from the GeoAgora ownership summary to build a profile link. Nothing writes WinLEW records to XL1, and no public bridging mechanism exists. Never say "continue integrating" | `src/mole/web.js:270` |
| Release version | Read from `package.json` — currently **3.3.6**. Never hardcode a version into a static page; `/roadmap/` did and was wrong twice in three weeks | `package.json`, `src/shared/command-inventory.js:10` |

## Partnerships

Nothing in this repository establishes an **official** XYO partnership. Sponsor
quiz pools named `xyo` are project-authored content about XYO, not evidence of
an agreement. Until an authoritative record exists, XYO/XL1 must be described as
independent development, community participation, or alignment work — **never**
"official partner".

## Canonical routes — to be confirmed during the audit

`/` landing · `/home/` hub · `/about/` · `/who-we-are/` · `/whitepaper/` ·
`/burn/` · `/transparency/` · `/faucet/` · `/quiz/` · `/mole-hub/` (**confirmed
canonical** games route 2026-08-04 — `/game-hub/`, `/gamehub/`, `/gaming-hub/`
and their root `.html` twins are all redirect stubs to it, now `noindex`; zero
internal references point to them) · `/governance/` · `/modules/` · `/roadmap/` ·
`/policies/` · `/policies/abuse/` · `/verify/` · `/app/` (mobile app home).
