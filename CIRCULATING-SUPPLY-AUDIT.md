# Circulating Supply — Audit & Implementation

**Date:** 2026-08-13 · **Mint:** `DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump` ·
**Network:** Solana mainnet · **Page:** https://winlew.co/transparency/

---

# Executive Summary

The Transparency Center had no circulating-supply figure at all. It showed total
supply, and it showed every lock, reserve and pool as separate live cards — but
it never performed the subtraction, so a listing reviewer had to do the
arithmetic themselves and guess which balances qualified.

That subtraction is now performed server-side from the same live reads the cards
use, and rendered as a new **Circulating Supply** section directly beneath the
mint card.

**Reported circulating supply: 811,724,836.426356 $WinLEW (85.4447%).**

Only genuinely escrowed balances are deducted — six Jupiter Lock and Streamflow
contracts totalling 138,275,163.573644. Nothing else. The burn wallet, all three
reserve wallets and pool liquidity remain **counted as circulating**, each listed
on the page with the reason. That is the conservative direction: it reports a
*higher* circulating supply than a project inclined to flatter itself would.

One real contradiction was found and fixed elsewhere: the storefront's most
prominent supply tile was labelled "Circulating Supply" while being fed total
supply.

# Existing System Found

| Piece | State before |
|---|---|
| `TRANSPARENCY_COMPONENTS` (`src/mole/web.js`) | 12 components, each read live per request |
| `GET /api/transparency/status` | returned `mint`, `components`, `communityLiquidity`, `faucetDistribution` |
| `/transparency/` page | rendered total supply + one card per component |
| Circulating supply | **did not exist anywhere** |
| Lock metadata (schedules, providers, cliffs) | present only as prose in each component's `purpose` string |

**What already worked well and was left alone:** every component is a live RPC
read, no supply figure was hardcoded, a failed component renders "temporarily
unavailable" rather than zero, and the page already drew the distinctions this
task depends on — staged-for-burn vs burned, pool inventory vs locked supply.

**What was missing:** the calculation, the qualification criteria, the
machine-readable lock metadata, and any statement of what is deliberately *not*
deducted.

**What was ambiguous:** "reserve" was used for wallets with very different
control properties — two faucet reserves that pay users, a developer reserve, and
a burn wallet — with nothing saying which (if any) should be excluded.

**What could have misled:** the storefront tile described below.

# Data Sources Used

- `getTokenSupply` for the mint (total supply, decimals)
- `getTokenAccountsByOwner` for escrow PDAs and reserve wallets
- `getTokenAccountBalance` for the two Streamflow token accounts and the pool vault
- `src/mole/circulatingSupply.js` — the pure calculation, fed by the above
- Cross-checked against `WINLEW_FINAL_VERIFIED_FACTS.md` (2026-08-11 independent audit)

All balances below were re-read from mainnet on **2026-08-13**, not copied from
the register. One had drifted since: the Discord & Web Faucet Reserve moved
13,011,704.34 → 13,005,704.34 (6,000 paid out), which is exactly why the page
reads live rather than publishing a snapshot.

# Current Total Supply

**950,000,000.000000 $WinLEW** (`950000000000000` base units, 6 decimals).

Original supply 1,000,000,000; 50,000,000 destroyed. Supply can only fall via a
burn instruction, so the 50M delta is destroyed tokens by definition.

# Locked / Vested Supply Breakdown

| Lock | Amount | Provider | Type | Cliff / fully unlocked | Claimable today | Schedule source |
|---|---|---|---|---|---|---|
| 50M Token Lock<br>`E8Pu1WNF…KzSo` | 50,000,000.000000 | Jupiter Lock | Periodic, 10M/yr | — / 2030-04-24 | ~10,000,000 (one release elapsed, **unclaimed**) | project-reported |
| 25M Faucet Lock<br>`8jr1Zov7…f986` | 25,000,000.000000 | Jupiter Lock | Full cliff | 2031-09-01 / 2036-08-30 | none | project-reported |
| Streamflow (22M)<br>`4XnVM4G2…Ywv9` | 22,069,652.822552 | Streamflow | Full cliff | 2035-10-29 | none | project-reported |
| 19.19M Developer Lock<br>`AvJi2mKq…6R5m` | 19,192,210.751092 | Jupiter Lock | Cliff + 2M/yr | 2028-08-11 / 2033-08-10 | none | **on-chain decoded** |
| 15M Team Lock<br>`zLHYYpKt…8SWA` | 15,000,000.000000 | Jupiter Lock | Periodic, 7.5M/yr | — / 2027-03-01 | ~7,500,000 (one release elapsed, **unclaimed**) | project-reported |
| Streamflow (7M)<br>`B4GJSLCH…YJpz` | 7,013,300.000000 | Streamflow | Full cliff | 2030-10-29 | none | project-reported |
| **Total** | **138,275,163.573644** | | | | | |

**Disclosed rather than buried:** roughly **17.5M** of that total has vested and
is claimable today (the 50M and 15M locks each passed one annual release). It is
still deducted, because it remains in a program-owned escrow rather than a
spendable wallet — and the escrow balances still equal their original amounts,
which is the on-chain evidence that nothing has been claimed. If it is claimed,
the balance drops and the page follows automatically.

**Early withdrawal** is marked *Not publicly available* on five locks and
*Requires verification* on the 19.19M — its `cancel_mode` byte reads `0`, which
most likely means non-cancellable, but that enum was not confirmed against
Jupiter's program source. **No page claims any lock is irrevocable.**

# Other Non-Circulating Supply

**None.** No second deduction line exists. Every other balance is counted as
circulating.

# Reported Circulating Supply

**811,724,836.426356 $WinLEW — 85.4447% circulating, 14.5553% non-circulating.**

# Exact Formula Used

```
  950,000,000.000000   current total supply        (getTokenSupply)
− 138,275,163.573644   qualifying locked / vested  (6 escrow balances, summed)
─────────────────────
= 811,724,836.426356   reported circulating supply
```

Computed in **base units as BigInt**, never floats: `138275163.573644` and
`811724836.426356` are both unrepresentable as doubles, and summing the six locks
as floats does not add back to the total. A test pins this.

# Balances Intentionally NOT Excluded

| Balance | Amount | Why it stays counted |
|---|---|---|
| Burn wallet `EX5nxVKg…aZ74` | 50,000,000.000000 | Staged for burn is not burned. Still exists, still counted by the mint. |
| Raydium pool liquidity `61mr6d5j…vijB` | 40,548,341.315467 | Tradeable inventory, withdrawable by LP holders with no lock. |
| Discord & Web Faucet Reserve `FcEtZqVo…PPjE` | 13,005,704.340000 | Unlocked, and actively paid *out* to users. |
| Developer Reserve `D6d5byBx…FRkZ` | 10,000,000.000000 | Project-controlled but unlocked and freely transferable. |
| X (Twitter) Faucet Reserve `GFxz42bi…EhAp` | 6,845,194.692333 | Unlocked. Only the 25M locked *out* of it is excluded, under its own escrow address. |

**79,850,899.032333 sits in wallets the project controls** — the burn wallet
plus all three reserves — and is left inside the circulating figure. Excluding
those four would have reported **731,873,937.394023** instead: an 8.4% lower
circulating supply, available for the taking and declined.

Pool liquidity (40,548,341.315467) is not counted in that 79.85M, because only
part of it is project-reachable: the LP tokens are held roughly 53.66% by the
Developer Reserve and the rest by outside providers. It is left in circulating
regardless, being tradeable inventory.

# Burn Treatment

The burn wallet holds 50,000,000 **staged, not burned**. It is counted as
circulating, and the page says so in a callout. Burns leave supply only when a
Solana burn instruction destroys them; executed burns live on the Burn Center.
`SUPPLY_EXCLUSIONS` has no `burn` key and a test asserts it never gains one.

# Lock / Vesting Verification

Every lock row links `solscan.io/account/<escrow>`. Two carry their creation
transaction as well (the 19.19M and the 25M). The 19.19M's schedule was decoded
from the escrow's own bytes and **validated by reconstruction** — cliff
9,192,210.751092 + 2,000,000 × 5 = 19,192,210.751092, matching the transfer to
the base unit. The other five schedules are labelled *project-reported* on the
page, with a visible badge distinguishing them from the decoded one.

# Duplicate-Counting Checks

- Each of the six escrows is a distinct address; asserted unique by test.
- No excluded address also appears in the not-excluded list; asserted by test.
- Every owner queried returned **exactly one** WinLEW token account, so no
  balance is summed twice across accounts.
- The 25M faucet lock was funded *from* the X Faucet Reserve. The reserve's live
  balance already reflects the outflow, so the 25M is counted once, in escrow.
- Pool liquidity is counted once, in the vault, and is not deducted.
- Parts add back to the whole: circulating + non-circulating = total, exactly.

# Changes Made

1. **New** `src/mole/circulatingSupply.js` — pure, testable calculation plus the
   exclusion register and the not-excluded register, each entry carrying its
   reason, provider, schedule, source and verification link.
2. `src/mole/web.js` — `/api/transparency/status` now returns a
   `circulatingSupply` block; pump.fun price variable renamed off "circulating".
3. `src/public/transparency/index.html` — new Circulating Supply section
   (summary tiles, formula, excluded table, not-excluded table, burn callout,
   failure state) plus a no-mid-number-wrap rule.
4. `src/public/transparency/js/app.js` — renderer, `esc()`, `fmtExact()`.
5. `src/public/index.html` — storefront supply tile corrected.
6. **New** `test/mole/circulatingSupply.test.mjs` — 14 tests.

# Conflicting / Outdated Information Found Elsewhere

| Location | Verdict | Action |
|---|---|---|
| `src/public/index.html` tile labelled "Circulating Supply", fed `mint.supply` | **INCORRECT** — off by 138M on the site's front page | Now shows the computed figure; if it cannot be computed, shows total supply **and relabels the tile** |
| `src/mole/web.js` `const circulating = total_supply / 10**d` | **MISLEADING NAME**, correct math | Renamed `supplyForPrice`; divisor deliberately unchanged (pump.fun derives market cap from total supply) |
| `/burn/`, `docs/burn-program.md` "separate from circulating supply" | STATIC EXPLANATORY COPY about the 10% burn allocation | unchanged |
| `/whitepaper/`, `docs/whitepaper.md` "Circulating supply — held by the community" | STATIC EXPLANATORY COPY, no figure | unchanged |
| `WINLEW_FINAL_VERIFIED_FACTS.md`, `WINLEW_PUBLIC_FACT_AUDIT.md`, QA report | HISTORICAL records of past audits | unchanged, deliberately |
| `/transparency/` tokenomics paragraph | CURRENT and correct — names all six locks | unchanged |

# Third-Party Submission Readiness

A reviewer landing cold on `/transparency/` sees, without leaving the page: total
supply, the deduction, the circulating result, both percentages, the formula, all
six escrow addresses with provider/type/schedule, Solscan links per lock, two
lock-creation transactions, the list of balances deliberately *not* deducted with
reasons, and the calculation timestamp.

# Remaining Concerns

1. **Five of six lock schedules are project-reported, not decoded.** Balances are
   on-chain; timetables are not independently verified. Labelled as such.
2. **Cancellability is unproven.** No lock is claimed irrevocable.
3. **~17.5M is vested-but-unclaimed** and still deducted. Disclosed in the table.
   A reviewer applying a stricter rule would report ~829.2M circulating.
4. **The page needs the backend.** If `/api/transparency/status` is unreachable
   the section shows its failure state — correct, but it means the figure is not
   readable from static HTML.
5. **Not yet deployed.** Everything is committed; the static site is
   hand-uploaded.

# Tests Performed

14 unit tests (`test/mole/circulatingSupply.test.mjs`), all passing: exact
arithmetic, parts-add-to-whole, float-drift demonstration, duplicate-address
checks, exclusion criteria, burn-stays-in, reserves-and-liquidity-stay-in,
provenance on every exclusion, and **six separate failure cases** proving no
figure is published when a source is unreadable.

Browser-verified at 1440 / 1280 / 390 px: section renders, tiles and formula
agree, 6 + 5 rows, no console errors, no horizontal scroll, no figure wraps
mid-number, and the induced-failure state shows the problem while leaking no
number. Full suite: **1231/1231**.

# Final Verification

Traced end to end: the displayed `811,724,836.426356` comes from
`circulatingSupply.circulatingBaseUnits`, which is `getTokenSupply` minus the sum
of six `getTokenAccountsByOwner`/`getTokenAccountBalance` reads, each of whose
addresses is printed on the page and linked to Solscan. Recomputed independently
by a second method and matched to the base unit.

---

TOTAL SUPPLY:
950,000,000.000000 $WinLEW

QUALIFYING NON-CIRCULATING SUPPLY:
138,275,163.573644 $WinLEW

REPORTED CIRCULATING SUPPLY:
811,724,836.426356 $WinLEW

CIRCULATING PERCENTAGE:
85.4447% (non-circulating 14.5553%)

CALCULATION VERIFIED:
YES — recomputed independently, parts sum to total exactly, no address counted
twice, and every input traceable to a printed on-chain address.

READY FOR CMC/COINGECKO SUPPLY SUBMISSION:
YES, once deployed — with one disclosure to make in the submission itself.

The methodology deducts only third-party-escrowed balances. If a reviewer asks
whether any deducted tokens are already claimable, the answer is yes: roughly
17.5M across the 50M and 15M locks has vested and is unclaimed, and it is shown
on the page. A reviewer applying a stricter "vested equals circulating" rule
would arrive at ~829,224,836 circulating. Both figures are defensible; ours is
stated with its reasoning rather than presented as the only possible answer.

The only blocker is deployment — the page is hand-uploaded and this is not yet
live.
