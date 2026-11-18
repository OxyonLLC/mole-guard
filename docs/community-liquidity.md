# Community Liquidity Providers — Transparency Center

Date: 2026-07-25 (last re-walked 2026-08-10)
Route: `/transparency/#community-liquidity`, `/transparency/#liquidity-farms`
Scope: `src/mole/communityLiquidity.js`, the `communityLiquidity` field of `/api/transparency/status`, and the corresponding sections of `src/public/transparency/index.html` / `js/app.js`.

## 1. What changed and why

The page previously tracked exactly 2 events (both from one wallet, "millerknoll") under "Community Liquidity Providers." The user flagged that this undercounted — real activity existed that wasn't being shown, both very recent (their own deposit ~15h before this was reported) and much older.

Investigation found the original 2 events were correct as far as they went, but incomplete: the pool's LP token mint's own signature history (only 63 signatures ever — deposits/withdrawals are rare relative to ordinary swaps, so this is fully tractable to walk in full, unlike the pool address's own swap-heavy history) revealed **58 real deposit/withdraw events across 11 distinct wallets** going back to February 2025, not 1.

## 2. Method

1. Looked up the tracked pool's LP mint via the Raydium public API (`api-v3.raydium.io/pools/info/ids`) — `8y5pTux9v3tPYrZXoq6muPo7gaUmfD8bzSBVYJ1uEnm4`.
2. Walked that mint's **entire** signature history (`getSignaturesForAddress`, no pagination needed — 63 total) via a paid Alchemy RPC endpoint (the free public RPC rate-limits hard under any real load — see the burn-program investigation for the same finding).
3. Classified every transaction as `mintTo` (deposit — WinLEW+SOL left the depositor's own wallet) or `burn` (withdraw — WinLEW+SOL returned), reading the actual pre/post token-balance delta on the signer's own wallet — never a rounded UI figure.
4. Separately walked both farm accounts' own signature histories (28 and 64 signatures — also fully tractable) and classified LP-token balance deltas on the signer to find who staked/unstaked into each farm.

This is the same evidence standard as `src/mole/burnEvents.js` and `docs/burn-program.md`: every figure traces to a real transaction, independently re-fetched and read, not transcribed from a screenshot or explorer UI.

## 3. What's tracked now

- **11 wallets total**: 10 third-party community wallets + the project's own dev/founder wallet (`dev.winlew.sol`, already disclosed elsewhere on `/transparency/` as the Developer Reserve). The founder's own liquidity activity is shown here too, clearly labeled `role: "founder"` — not hidden, and not blended into the "community" count.
- **60 events** (58 at the 2026-07-25 build, +2 on 2026-08-10 — see §7): every deposit and withdraw, each independently verified, each permanently on the record. A wallet that has since withdrawn everything still appears — status `withdrawn` plus the date of its last withdrawal — rather than disappearing. Only 3 of the 11 wallets currently hold nonzero LP tokens (`status: "active"`): the founder wallet, millerknoll, and one previously-undocumented single-deposit wallet.
- **Farm round tags** (`FARM_PARTICIPATION`): which of the two farms each wallet historically staked its LP tokens into, independent of whether they've since unstaked. This is what lets the page (and any future farm 3/4/5) honestly say "this wallet also contributed to round 1 / round 2" even after everything nets to zero.

### 3.1 A real bug caught during this build

The first draft of the per-wallet summary card showed a **net** figure (deposited minus withdrawn). Because LP positions earn a share of trading fees while held, a fully-withdrawn wallet's total-withdrawn can slightly *exceed* its total-deposited — correct AMM behavior, not a data error — which printed a confusing negative number (e.g. "-29,620.3 WinLEW") for exactly the providers who'd earned the most in fees. Fixed by showing **gross lifetime deposited** as the card's headline figure instead; the status pill already conveys active vs. withdrawn. Caught via a real-browser (Playwright) render check against the actual seeded data before this shipped, not left for a user to find.

## 4. The two farms

Both are Raydium Farm-program accounts (`FarmqiPv5eAj3j1GMdMCMUGXqPUvmquZtMy86QH6rzhG`), both use the tracked pool's own LP mint, both confirmed still live on-chain (not closed — `getAccountInfo` still returns a rent-exempt, program-owned account for each):

| | Address | Window | Status |
|---|---|---|---|
| Farm Round 1 | `5DAWnkAg2FE8Ws9ZbRdSXunc1SupJeaxBid1hX5qXjG9` | Mar 10 – Jul 25, 2025 | Closed / drained — $0 TVL |
| Farm Round 2 | `3ew3rB5UTgDNxuLNGm1Bvb4krBscBMzJjptvYbA8R8d7` | Jun 16, 2025 – Jul 2026 (residual activity) | Reopening — ~$17 residual TVL as of 2026-07-25; owner-confirmed planned reopen **Oct 1, 2026 → Dec 31, 2026 / Jan 1, 2027** (moved from Sept 1 on 2026-08-18 so the farm opens as the community campaign closes — see the comment in `FARM_PROGRAMS`) |

Both are documented on `/transparency/` under a new "🌾 Liquidity Farm Rounds" section, separate from the main component grid — matches the user's ask to surface these as reopenable, not archived.

### 4.1 Deposit/stake links — what's real and what isn't

- `depositUrl` on both farm entries points at the pool's own verified "Add Liquidity" page (`raydium.io/liquidity/increase/?mode=add&pool_id=...`) — reused from `src/faucet/bot.js`'s already-verified `WINLEW_MARKET_LINKS.raydiumLiquidity`, and independently re-confirmed live (HTTP 200, correct pool figures visible) via a real headless-browser check before publishing.
- `stakeUrl` is **deliberately `null`** on both. Checked directly: Raydium's current UI has no link anywhere to the legacy Farm program, and a `?farmid=...` query parameter on `/liquidity-pools/` is silently ignored (confirmed via a real browser render, not just an HTTP status code — a generic 200 on an SPA route proves nothing by itself). The frontend shows an honest "No live Raydium staking link found for this farm yet — check Discord for the current process" instead of a broken or misleading button. If a real staking entry point is found (or the project builds its own), fill in `stakeUrl` in `FARM_PROGRAMS` — no other code needs to change.

## 5. Process for adding a future event

Same as `docs/burn-program.md` §8, adapted:

1. **Walk the LP mint's signature history — do not just record the signature you were handed.** Diff it against the signatures already in `COMMUNITY_LIQUIDITY_EVENTS`; anything not present is a candidate. The 2026-08-10 re-walk (§7) is why this is step 1 rather than an optional cross-check: the owner reported one deposit and the walk found two.
2. Fetch it via `getTransaction` (jsonParsed), confirm the LP-mint `mintTo`/`burn` instruction and the signer's own WinLEW/SOL token-balance delta.
3. Add a new entry to `COMMUNITY_LIQUIDITY_EVENTS` in `src/mole/communityLiquidity.js` — base-unit amounts as strings, never numbers.
4. If the wallet staked into a farm, add/update its entry in `FARM_PARTICIPATION`.
5. Run `npm test` — `test/mole/communityLiquidity.test.mjs` validates shape and re-derives the seeded totals automatically. Update the pinned figures when the seeded data changes: the event count, the two lifetime deposited/withdrawn totals, and the founder wallet's net LP (which must be re-read from mainnet, not just recomputed from the ledger — the point of that one is that it comes from outside this repo).
6. No other file needs to change — the API route and frontend both read `COMMUNITY_LIQUIDITY_EVENTS` / `FARM_PROGRAMS` directly.

## 6. What this page does NOT do

No wallet connect, no signing, no transaction construction, no private key handling anywhere in `src/public/transparency/`, `src/mole/communityLiquidity.js`, or the `/api/transparency/status` route — same boundary as the Burn Program (`docs/burn-program.md` §1).

## 7. 2026-08-10 re-walk

The owner reported one new liquidity deposit and gave its signature. Re-walking
the LP mint from the 2026-07-25 baseline — rather than simply recording what was
reported — found **two** unrecorded founder deposits:

| Date | Signature | WinLEW in | SOL in | LP out |
|---|---|---|---|---|
| 2026-08-08T02:54:06Z | `JPd9H9ak…` | 4,809,185.037706 | 0.61425 | 54.079598156 |
| 2026-08-10T05:30:00Z | `5yFUvCu…` | 5,674,158.864165 | 0.784267496 | 66.372790510 |

Both from `D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ` (Developer Reserve,
`dev.winlew.sol`) into the tracked Raydium CPMM pool `5nTz…`. The 2026-08-08 one
had gone unrecorded for two days and nobody had noticed. **The ledger's
completeness cannot depend on someone remembering to mention a transaction** —
that is the whole reason step 1 of §5 is now "walk the mint."

The mint held 65 signatures against the ledger's 58. Of the 7 unrecorded, 5 are
correctly absent and stay absent:

- `3bF4bczz…`, `2vuzow9m…` — **failed** transactions (`InstructionError` /
  `Custom:1`). Nothing moved.
- `3KLL4vg9…`, `57BZUaTu…` — plain WinLEW transfers with no LP `mintTo`/`burn`.
- `3Arkrwvn…` — an LP token **transfer** between accounts. It moves a position
  without creating or destroying one, so it is not a deposit or a withdrawal.
  Worth being explicit about, because it is the one that most looks like an
  event and is not.

### Cross-check

After adding both events, `summarizeCommunityLiquidity()` derives the founder
wallet's net LP as **285,924,362,877** base units (285.924362877). The wallet's
real LP token balance read from mainnet in the same session is identical. That
equality is now pinned by a test — see "the founder wallet's net LP matches the
balance held on-chain" in `test/mole/communityLiquidity.test.mjs`. It going red
means liquidity moved and the ledger has not caught up.

### One thing this must never be called

These LP tokens sit in the Developer Reserve. They are **not locked and not
burned** — this liquidity is withdrawable at any time by the wallet that holds
it. It is a materially different thing from the two Streamflow locks that
`/transparency/` reports separately, and no page, post or summary may describe
it as "locked liquidity." The distinction is the reason the Transparency Center
labels program-owned escrows honestly rather than naming a person.
