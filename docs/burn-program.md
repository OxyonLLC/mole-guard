# Burn Program — Burn Center

Date: 2026-07-16
Route: `/burn/`
Scope: a permanent, verifiable, on-chain transparency record of WinLEW's burn program — not a hype page, and not a system that executes burns.

## 1. Security boundary (read this first)

**The website does not execute burns.** `src/mole/burnEvents.js`, `/api/burn/status`, and `/burn/` are all pure data/read paths — none of them contain signing capability, private key material, or any code path that can send a Solana transaction. Adding a burn event to `BURN_EVENTS` after a real burn happens is a documentation update, not an action that causes anything to happen on-chain. Any future on-chain burn transaction must be executed separately, outside this codebase, and explicitly authorized by the project owner after the exact amount, source wallet, transaction procedure, and date are reviewed — matching this sprint's own non-negotiable instruction.

## 2. Original roadmap wording and burn philosophy

WinLEW's original tokenomics set aside a **10% burn allocation** at launch — supply intentionally earmarked for permanent removal over time, kept separate from circulating supply, liquidity, and reserves. The project's stated long-term goal is to burn **100,000,000 WinLEW** total. This page treats burning as a **supply mechanic**, not a price promise: it never claims a burn will raise price, increase market cap, guarantee scarcity value, or provide investment returns. That framing is deliberate — see `src/public/burn/index.html`'s overview section.

## 3. Current burn wallet

```
EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74
```

Also reachable via its `.sol` domain alias, `burn.winlew.sol` (already referenced in the Whitepaper §4; added to `/burn/`'s own address row 2026-07-17 as an easy lookup — display-only text, not a live domain-resolution check).

This is the same address already documented as the "burn" component in the Transparency Center (`src/mole/web.js`'s `TRANSPARENCY_COMPONENTS`). The Burn Center's `/api/burn/status` route reuses the exact same `getOwnerTokenSnapshot()` function the Transparency Center calls for this wallet — no duplicate Solana query logic exists between the two pages.

## 4. The critical distinction: transfer vs. destruction

A "burn wallet," by itself, is just a wallet — tokens sitting in it are still part of total supply and are, in principle, still moveable unless something more specific has happened to them. This project is precise about the difference:

- **`transferred-to-burn-wallet` / `queued`** — WinLEW has been sent to the burn wallet, but no `burn` instruction has been executed on it yet. It is still part of total mint supply. This is what the Whitepaper's §4 "current burn wallet balance" figure (and this page's "Awaiting burn" figure) represents.
  - **Implementation note (fixed 2026-07-17):** the page's "Awaiting burn" figure is sourced directly from the burn wallet's live on-chain balance (`wallet.winlewBalance` from `getOwnerTokenSnapshot()`), not from summing `BURN_EVENTS` entries marked `transferred-to-burn-wallet`/`queued`. No such event has ever been added to `BURN_EVENTS` (both seeded events are `confirmed-burn`), so `summarizeBurnEvents()`'s `stagedBaseUnits` — a legitimate but currently-empty separate figure — was previously wired to the "Awaiting burn" UI by mistake, always showing a false 0 regardless of the wallet's real balance (~6.62M). See `src/public/burn/js/app.js` and `src/public/governance/proposal/js/app.js`.
- **`confirmed-burn`** — an actual Solana SPL Token **`burn`** instruction was executed, authorized by the wallet holding the tokens, on the WinLEW mint. This **permanently and irreversibly reduces the mint's total supply** — verifiable by reading the mint's `getTokenSupply` before/after, or (as done here) by reading the transaction's own parsed instruction data and confirming it is a `burn` instruction, not a `transfer`.

**This distinction was independently verified for this sprint, not assumed.** Both of the two known burn transactions were fetched from Solana mainnet and their parsed instructions inspected directly — both are genuine `spl-token` `burn` instructions on the WinLEW mint (`DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump`), authorized by the burn wallet itself. Neither is a `transfer`. See §6 for the raw verification data.

## 5. Event-status definitions

Defined in `src/mole/burnEvents.js`'s `BURN_EVENT_STATUSES`:

| Status | Meaning | Counts toward verified progress? |
|---|---|---|
| `confirmed-burn` | A real `burn` instruction, permanently destroying supply | Yes |
| `transferred-to-burn-wallet` | Tokens moved to the burn wallet, not yet burned | No — shown separately as "staged" |
| `queued` | Publicly announced/committed but not yet transferred | No |
| `pending-verification` | Claimed, not yet independently checked | No |
| `disputed` | Conflicting evidence | No |
| `unknown` | Insufficient information to classify | No |

Progress toward the 100M target (`computeBurnProgress()`) is computed **only** from `confirmed-burn` events — it never mixes in staged, locked, or distributed tokens. See `src/mole/burnEvents.js`'s `PROGRESS_COUNTED_STATUSES`.

## 6. Known transactions — verification method and raw data

Both supplied transaction signatures were independently fetched via `getTransaction` (jsonParsed encoding) against Solana mainnet (`api.mainnet-beta.solana.com`) on 2026-07-16 and their instruction lists inspected directly — not transcribed from the narrative claim.

**Event `burn-2025-02-22`** — [`3NTpyg1h…Tta5Br`](https://solscan.io/tx/3NTpyg1haByfK74zJp8dNnYtRRUZqNHHydaFgDHZkB1hYFCRTSNnKqVHKEmXTSsbgZSMqTs6vFPKBoYePMjTa5Br)
- Block time: 2025-02-22T03:59:00Z
- Instruction: `spl-token` `burn`, `amount: 1829373210000` base units (6 decimals) = **1,829,373.21 WinLEW**
- Authority: `EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74` (the burn wallet itself)
- Publicly referenced historically as part of an approximate "2M burned" community statement. The verified amount (~1.83M) is close to but not exactly 2M — the earlier figure was a narrative approximation, not a correction to this transaction; no second nearby transaction was found that would account for the remaining ~0.17M (see the reconstruction note below).

**Event `burn-2025-08-02`** — [`2KmuXS7C…GspkoNY`](https://solscan.io/tx/2KmuXS7CWQskiU6MxyuwfhYfjvyfckQ47u9obQeLpLRWUz4t2eXZwMeU24gNoFp4P4KZDH43FGikhwdWfGspkoNY)
- Block time: 2025-08-02T01:07:53Z (the day after the August 1 benchmark date)
- Instruction: `spl-token` `burn`, `amount: 10077932510911` base units = **10,077,932.510911 WinLEW**
- Authority: same burn wallet
- Consistent with the "~10M sent to the burn address" community statement.

**Independent on-chain reconstruction beyond the two supplied signatures.** The burn wallet's *entire* transaction history was fetched (`getSignaturesForAddress`, no limit reached — all 27 signatures the wallet has ever had, as of 2026-07-16) and every transaction checked for a `burn` instruction on the WinLEW mint. **Exactly two were found — the two above.** No third, undiscovered burn transaction exists on this wallet. This does not rule out a burn executed through some entirely different wallet or mechanism, but there is no unaccounted-for burn transaction on the known burn wallet.

**Wallet state as cross-checked 2026-07-16** (retained as the dated record behind the reconstruction above — see the refresh below for current values):
- Burn wallet WinLEW balance at that time: **6,624,510.334951** — matched the Whitepaper's then-current §4 figure almost exactly, and the owner-supplied "~6.62M ready for a future burn" statement. This is tokens **awaiting burn**, not yet destroyed.
- Mint total supply at that time: **987,799,895.13425** — matched the Transparency Center exactly.
- Implied original supply (supply + verified confirmed burns): ~999,707,200.86 — consistent with a standard ~1B launch supply.

**Refreshed 2026-08-01, immediately BEFORE that day's burn** (`getAccountInfo` on the mint, `getTokenAccountsByOwner` on the burn wallet, Solana mainnet via Alchemy RPC):
- Burn wallet WinLEW balance: **57,424,510.334951** (ATA `3caeRiCfwEhwqR9AZsMpD9x3syMknqM5U5R3DB2xeEyP`). Up exactly **50,800,000** from the 2026-07-16 reading — tokens *staged* into the burn wallet, still part of total supply and not yet destroyed.
- Mint total supply: **964,878,231.210253**. The **22,921,663.92** decrease since 2026-07-16 is the pump.fun BOOST buyback-and-burn resolved in §7 (`burn-2026-07-22-boost-01` … `-29`), which had been recorded in `src/mole/burnEvents.js` but not yet reflected in this figure or the Whitepaper's.
- Implied original supply (supply + verified confirmed burns of 34,828,845.977231): **999,707,077.187484**. This holds to within **123.67 WinLEW** of the 2026-07-16 implied figure — accounted for by the documented ~96.54 BOOST sliver (§7) plus rounding in the earlier approximation. The ~1B launch-supply invariant survives the BOOST reconciliation intact, which is an independent check that the 29 recovered burns are neither double-counted nor invented.

**Refreshed 2026-08-01, AFTER that day's burn and the restock transfer** (same methods):
- Mint total supply: **950,000,000.000000** exactly (`950000000000000` base units). Down **14,878,231.210253** — see `burn-2026-08-01` in §6a.
- Burn wallet WinLEW balance: **50,000,000.000000** exactly, all of it *staged* and none of it destroyed (see `transfer-2026-08-01-restock-burn-wallet` in §6a).
- Implied original supply (supply + verified confirmed burns of 49,707,077.187484): **999,707,077.187484** — **unchanged to the last decimal** from the pre-burn figure above, exactly as it must be if the new burn was recorded at its true on-chain amount and nothing else moved. This invariant is the cheapest available check that the event log has not drifted from the chain.

## 6a. August 1, 2026 — benchmark burn and restock

Two transactions, seven minutes apart, verified the same way as every entry in §6: by fetching each transaction and reading its own parsed instruction data. **They are deliberately recorded with different statuses, and only the first counts toward Verified Progress.**

**Event `burn-2026-08-01`** — [`2ixvHEKg…noPHcD1`](https://solscan.io/tx/2ixvHEKgdq71C41QKy6Fr4JNCeuh8Borsq2YLLUdLEG3VYg9Y5NTCa824oa7KiSu7EikQsfCk1wvU2q7AnoPHcD1)
- Block time: 2026-08-01T06:53:15Z — the first burn executed *on* the August 1 benchmark date itself (the 2025 one landed 2025-08-02, the day after).
- Instruction: `spl-token` `burn`, `amount: 14878231210253` base units = **14,878,231.210253 WinLEW**
- Authority: the burn wallet `EX5nx…GaZ74`, burning from its own token account.
- Status: `confirmed-burn` — a real `burn` instruction, so these tokens are permanently destroyed.
- **Target landing verified, not assumed.** The amount was chosen to bring total supply to a round 950,000,000. A post-burn `getTokenSupply` returned exactly `950000000000000` base units, confirming it landed precisely rather than inferring it from arithmetic.

**Event `transfer-2026-08-01-restock-burn-wallet`** — [`RumMGACZ…zK1G1o`](https://solscan.io/tx/RumMGACZzogcAsMhP4qwHzocC4qj6Puf2mmMP7zXNhiW2cnCsiR7XfdwNwf9Ce3ZUNQq2SXDnmpaNyAFZzK1G1o)
- Block time: 2026-08-01T07:00:17Z (7 minutes after the burn).
- Instruction: `spl-token` `transferChecked`, **exactly 50,000,000.000000 WinLEW**, from the project wallet `Winlew.sol` (`GFxz42bib…C7EhAp`) into the burn wallet.
- Status: `transferred-to-burn-wallet` — **staged, NOT destroyed.** Per §4 this does not move Verified Progress; only a real `burn` instruction executed against it would.
- The transaction also re-created the burn wallet's WinLEW associated token account (`3caeRiCf…2xeEyP`), because the burn had emptied and closed it. The ATA address is unchanged since ATA addresses are deterministically derived from owner + mint.
- Stated intent: decide the next burn at the one-year anniversary.

### Why tokens were moved out and back — tooling, not sleight of hand

Two things about this sequence are easy to misread, so they are stated plainly.

**1. The shuffle is an artifact of the burn tool.** The burn was executed with **Sol Incinerator, which burns a token account's *entire* balance** — it has no "burn only this amount" option. To burn a specific figure, the project had to move everything *not* being burned out of the account first, leaving exactly the target amount isolated, then burn. The 42,546,279.124698 that moved out beforehand was never at risk and was never part of the burn; it is simply what the tool's all-or-nothing behaviour forced.

**2. The 50,000,000 restock exists to protect the #1 holder's donation, and the burn predates it.** Per the project, the August 1 burn **was already planned before millerknoll's 2026-07-25 transfer of exactly 50,000,000 arrived** (§10a). The donation did not prompt the burn and was not its purpose. Because the tool required emptying the account anyway, the project transferred a **matching 50,000,000** straight back in, so the burn wallet visibly still holds a full 50,000,000 attributable to that contribution — leaving the donor's intent, purpose, and provenance whole.

**What is and is not provable here.** The transaction amounts, timestamps, and the resulting 50,000,000 balance are all verifiable on-chain and were checked directly. The *ordering of intent* — that the burn was planned first — is a project statement, recorded as such and not dressed up as chain evidence. And because SPL tokens are fungible, **no on-chain data can identify which individual units were destroyed**; a claim that "none of the donated tokens were burned" would not be provable and is deliberately not made. What is claimed, and is true, is narrower and checkable: the burn was independently planned, and the burn wallet was restored to a full 50,000,000 matching the donation.

**Aggregation caveat.** `summarizeBurnEvents()`'s staged figure (`stagedInflowBaseUnits`, with `stagedBaseUnits` kept as a deprecated alias) now sums this 50M with the 2026-07-25 millerknoll 50M for 100M, while the burn wallet actually holds 50,000,000. This is not a defect in the figures but a reminder that **staged tokens are a live balance, not a running total of transfers.** It is exactly why the Burn Center and the governance proposal page both read `wallet.winlewBalance` rather than `summary.stagedDisplay` (see the implementation note in §4).

The recorded figure diverges from reality in **both** directions, and both are expected:

- **Below** true lifetime inflow, because arrivals are only recorded from the point this ledger existed. Every inflow found by reconciling the wallet is now seeded, but the ~6.62M present before 2026-07-16 predates any record and is deliberately not invented as an event — see §7a.
- **Above** the current balance, because burns and outbound moves are not modelled as events at all.

**Reconciliation scan.** Every signature touching the burn wallet's token account between 2026-07-16 and the 2026-08-01 restock was fetched and checked. Exactly four movements exist, and all four are now recorded:

| When (UTC) | What | Amount | Status |
|---|---|---|---|
| 2026-07-25T05:57:28Z | Contribute-flow transfer from `Winlew.sol` ([`KSuN7BPB…kShJt`](https://solscan.io/tx/KSuN7BPB5iarpH3yDPjRn4HD2UrfYFdVv1amDqVATT1tzJVf1HB3HCWw2VjTcTGx98e9FsGUF4Fr1fU7K3kShJt)) | 800,000 | staged |
| 2026-07-25T06:05:02Z | #1-holder donation (§10a) | 50,000,000 | staged |
| 2026-08-01T06:53:15Z | Benchmark burn | 14,878,231.210253 | **destroyed** |
| 2026-08-01T07:00:17Z | Restock from `Winlew.sol` | 50,000,000 | staged |

The 800,000 was the project owner testing the website's Contribute flow through Phantom against the `burn` cause, so it also appears in the contributions store; the entry in `BURN_EVENTS` is the burn-ledger counterpart, not a second contribution. It was seeded rather than documented as an exception, so the staged total stops silently omitting a known inflow. Nothing else touched the wallet in that window.

## 7. Unresolved historical gaps

- **The final/complete lifetime burn log has not been supplied.** The independent reconstruction in §6 gives high confidence that no additional burn exists *on this specific wallet*, but "a final burn log" implies a broader authoritative record this project may intend to publish later. This page's `historyNotice` field explicitly discloses that the shown entries are verified but may not represent the complete lifetime history.
- **The ~0.17M gap between the "~2M" narrative statement and the verified ~1.83M first burn** is unresolved — no second transaction was found to account for it. Documented as an open discrepancy, not silently rounded away.
- **The ~22.92M post-graduation gap — RESOLVED 2026-07-25 (event `burn-2026-07-22-boost-01` through `-29`).** Originally recorded 2026-07-24 as a single `PENDING_VERIFICATION` placeholder (supply-delta only, no signature). Root cause found the next day: BOOST doesn't burn through a separate vault at all — it executes as 29 individual `spl-token burn` instructions, each bundled inside a TWAP buy-swap transaction, all sharing the same authority (the WinLEW/SOL PumpSwap pool itself, `Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL`) burning directly out of its own WinLEW reserve token account (`9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci`, created at graduation). That's exactly why the two originally-checked locations (the graduation tx itself, and the bonding-curve reserve account) never showed it — neither is the pool's own reserve account. All 29 transactions land within a single ~5m15s window (2026-07-22T15:59:27Z–T16:04:42Z), matching BOOST's documented "first five minutes, TWAP-spread" mechanism. Found via a full transaction scan of the WinLEW mint's signature history restricted to that window (Solana mainnet, Alchemy RPC), independently cross-checked against a second manual search. Sum: 22,921,540.25632 WinLEW — within 96.54 WinLEW (0.0004%) of the original supply-delta estimate (22,921,636.800396); that tiny residual is presumed to be one or two further burn instructions in the same window this session's RPC scan couldn't fetch (rate-limited) and is left as a documented open sliver rather than rounded away. All 29 promoted to `status: CONFIRMED_BURN` in `src/mole/burnEvents.js`, each with its own independently-verifiable signature and `explorerUrl`, per §8 below.

### 7a. The pre-ledger period is UNKNOWN, on purpose

This is the most important epistemic boundary on the page, and it is stated rather than smoothed over.

**The arithmetic (updated 2026-08-19).** pump.fun launches mint a standard **1,000,000,000** supply. Current mint supply is **949,999,960.615828** — no longer the round 950,000,000, see §7c — so **50,000,039.384172** has been destroyed in total. This project's own verified burns account for **49,707,077.187484** of it and the community burns in §7c for a further **100,830.472170**, leaving **192,131.724518** unaccounted for, about **0.0192%** of launch.

That residual was **292,922.812516** until the community burns below were found. The figure moved because evidence arrived, not because the estimate was revised.

**Why that gap cannot be closed, and should not be guessed at.** $WinLEW was distributed early, including giveaways on X. Recipients own their tokens outright, and some of them **burned their own tokens independently** — real `burn` instructions, authorized by their own wallets, permanently reducing total supply, with no reason to ever touch the project's burn wallet or announce themselves. There is no list of who did this and no way to build one after the fact: the search space is every wallet that ever held the token, not one address. The 29 pump.fun BOOST burns in §7 are the proof of concept — they were invisible for months precisely because they executed from an address nobody thought to check, and they were only found because a specific supply delta pointed at a specific five-minute window. A 292,922 residual scattered across arbitrary holders offers no such thread to pull.

**So the honest value is "unknown", not zero and not an estimate.** This ledger records from the point it existed. Anything before that is outside its knowledge, and inventing entries to make the arithmetic close would be exactly the kind of narrative-fitting this whole document exists to avoid. Compare §6's earlier discipline: the "~2M" community figure was left as a documented discrepancy against the verified ~1.83M rather than quietly rounded, and the ~96.54 BOOST sliver was left as an open residual rather than absorbed.

**This is the reason the system was built.** The same boundary already applies elsewhere in the project — Discord activity is only counted from when the bot started recording it, web activity only from when the site did — and the burn ledger is no different. The point was never to reconstruct an unknowable past; it was to make sure that from this point forward every claim about destroyed supply has a signature behind it that anyone can check themselves. The pre-ledger gap is not a flaw in the system. It is the thing that motivated building it.

**What this does NOT put in doubt.** Current total supply is not an estimate and never has been — it is read live from the mint and was **949,999,960.615828** on 2026-08-19. Every burn recorded here is individually verified against its own transaction. What is unknown is only the *attribution* of supply reductions that happened before this ledger existed — not the supply itself, and not anything recorded since.

**Correction — the ~6.62M is NOT one of these unknowns.** Earlier drafts of this page described the 6,624,510.334951 sitting in the burn wallet at the 2026-07-16 reading as having no recorded origin. That was wrong, and a full scan of the wallet's token-account history on 2026-08-01 reconstructed it exactly. It is two events, both now seeded in `BURN_EVENTS`:

| Date (UTC) | Amount | Source | What it is |
|---|---|---|---|
| 2026-01-06T04:01:04Z | 2,624,510.334951 | pump.fun bonding curve | **Buy-and-burn purchase** — signed by the burn wallet itself ([`2Ziq7etj…GroNrUkE`](https://solscan.io/tx/2Ziq7etjuG1SeMo7FWZ4kns1FckqXVU4Ru4srb99xT3jUJiwqR99AcuTaEShyarmq9kN8UWEcRmtLuTUGroNrUkE)) |
| 2026-05-30T14:31:09Z | 4,000,000 | `64SpqFh6…umR3kTp` | **FreeCryptoA donation** ([`2xrrhuvR…hJXi62ec`](https://solscan.io/tx/2xrrhuvRHaUqeEevgHiREAEmmhxFFZQiXYHP8kbHueBMtBWG5h5QGSNqru1cmyYuVXhGG3YKEK9MALEzhJXi62ec)) |

2,624,510.334951 + 4,000,000 = **6,624,510.334951**, matching the on-chain reading to the last decimal.

**Buying is not burning.** The 2026-01-06 entry is the *acquisition* half of a buy-and-burn: tokens bought off the open market expressly to take them out of circulation. Purchased supply sits in the burn wallet exactly like a donation does — still part of total supply, still moveable — until a real `burn` instruction destroys it. It is therefore recorded `transferred-to-burn-wallet`, never `confirmed-burn`. Collapsing the buy and the burn into one event would let a purchase masquerade as a destruction, which is the precise failure mode §4 exists to prevent.

**Attribution rule.** Any transfer into `burn.winlew.sol` from `64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp` is **FreeCryptoA** (owner-supplied, 2026-08-01) and should be credited to them without re-confirmation. As of that date a full history scan found exactly one. Note the chain proves the wallet, amount, and timing — never the human identity behind an address; donor names here come from the project owner and are recorded as such.

So the genuinely unknown pre-ledger quantity is the **192,131.724518 supply residual** described above — not anything about the burn wallet's own balance, which is now fully reconstructed from 2025-02-16 onward.

### 7c. Community burns — part of that residual, found 2026-08-19

§7a said this could not be done: *"There is no list of who did this and no way to build one after the fact: the search space is every wallet that ever held the token, not one address."*

That was right about the search space and wrong about there being no thread. The [Giveaway Records](../src/mole/giveawayRecords.js) reconstructed every wallet the X Faucet Reserve ever paid — **21 addresses**. Those are wallets this project put tokens *into*, which is precisely the population §7a described, and 21 is short enough to walk. Every one of their WinLEW token accounts was scanned for `burn` instructions, along with two further wallets the owner supplied.

**Six burns, 100,830.472170 WinLEW**, each with its own signature, seeded in `COMMUNITY_BURNS` in `src/mole/burnEvents.js`:

| Date (UTC) | Amount | Authority | Signature |
|---|---|---|---|
| 2025-01-03 | 100,000.000000 | `6Y4MJPHp…PQB5v` | [`TVegUSjU…4PYGKy`](https://solscan.io/tx/TVegUSjUPK7tkNu9gLCQANpeEWyTwacgDuaWXiJt4Zm6vCzYhVRB7SUqKR1fTit4DZ2GQiuQeEd9bV7Nu4PYGKy) |
| 2025-11-22 | 0.000006 | `2yupCJfQ…eJqSA` | [`4uG5snzf…j8HS9`](https://solscan.io/tx/4uG5snzfrt5E7B9aEvQ7PkWZqfVc1f2wmXhtEE6bFLFBqpN2w3DfgHzSjC74xwTuhbxqJzVTxWun2Aw64Nzj8HS9) |
| 2026-04-30 | 78.367222 | `2yupCJfQ…eJqSA` | [`4VLPy9BN…1nWkN`](https://solscan.io/tx/4VLPy9BNqhr7nxEaSupi7Z5FBgELUTxV6FtySJQu4VjSSkLcbFrLHvyneQi8caY8w7jeGHxMJvNjd3MA4G41nWkN) |
| 2026-07-03 | 712.720770 | `2yupCJfQ…eJqSA` | [`hbe3r3Rv…te38R`](https://solscan.io/tx/hbe3r3RvusqCzn4CGjoT86WFuEKsETVst33xuVkqY5KUwDqaZLCtpoz35KjcpEN9gXkZZMnqaaty5wuRNkte38R) |
| 2026-08-18 | 27.904172 | `Dspk6Zxb…pFrz` | [`2NJvFgeY…pBDgg`](https://solscan.io/tx/2NJvFgeYR5a4YeHi5XQPoC9VqZfaaZjqzgW7Mtrj1hVGPzKjxyuKMycWztXnuTpRixSobnXsNP62KRCc8nnpBDgg) |
| 2026-08-18 | 11.480000 | `5Ss77nYw…CGrBw` | [`5mZ2V8fC…rwDrx`](https://solscan.io/tx/5mZ2V8fCx1eTwx54EHEUwPDjaFeGZh1wq3Kk7ESHruv94wv7pjNVpySjnyZu3j6G1JZA25HJqFJipxiPTxPrwDrx) |

**Not complete, and it never can be.** This covers wallets the project itself paid. Anyone who bought on the open market and burned remains invisible, and §7a's argument still holds for them. The figure is a **floor**; `summarizeCommunityBurns()` returns `complete: false` so no caller can present it otherwise.

**Not progress toward the 100M target, and not counted as such.** That target measures what this project destroys. These stay in a separate export for exactly that reason.

**What they actually are.** Every one is a "burn all and close account" sweep through an incinerator tool, which destroys a leftover balance to reclaim the ~0.002 SOL of account rent. The 100,000 burned two other tokens in the same transaction. The two 2026-08-18 rows are dust left behind by wallets already on the sybil ban list, moments after they moved 5,000 and swapped out 18,100. These are people clearing out wallets — calling them community support would be inventing a motive the chain cannot show.

**The 100,000 connects to a giveaway.** That wallet received exactly 100,000 from the X Faucet Reserve on 2025-01-01 — one of the eighteen payouts on `/giveaways/` with no announcement attached — and destroyed exactly 100,000 two days later. The transfer and the burn are both proven; that the second followed from the first is inference from timing and an exact amount match, and is recorded as inference.

### 7d. Total supply is no longer a round 950,000,000

The two 2026-08-18 burns above are why:

```
950,000,000.000000   the figure this site published from 2026-08-01
949,999,960.615828   read from the mint on 2026-08-19
        39.384172   difference  =  27.904172 + 11.480000   exactly
```

Nothing else moved. **The holder snapshots are unaffected** — `docs/holder-snapshots/` was taken at slots 439802487 and 439971290, both before slot 439985761, and their balances still sum to exactly 950,000,000 at those slots. A snapshot is a statement about a slot, and stays true.

What this does invalidate is any *present-tense* claim that supply is 950,000,000. The August 1 burn was still chosen to land on a round number and did; supply simply did not stay there, because holders can burn and this project cannot stop them — nor should it want to.

### 7b. Complete burn-wallet reconstruction — and it closes exactly

On 2026-08-01 every signature the burn wallet's token account has ever had was fetched and decoded. All nine inflows are now seeded in `BURN_EVENTS`; nothing is inferred.

| Date (UTC) | Amount | Source | Kind |
|---|---|---|---|
| 2025-02-16 | 300,000 | Developer Reserve | project reserve transfer |
| 2025-02-22 | 1,529,373.210000 | `Winlew.sol` | project reserve transfer |
| *2025-02-22* | *(1,829,373.210000)* | — | **burn — destroyed** |
| 2025-02-22 | 77,932.510911 | pump.fun bonding curve | **buy-and-burn purchase** |
| 2025-04-03 | 10,000,000 | Developer Reserve | project reserve transfer |
| *2025-08-02* | *(10,077,932.510911)* | — | **burn — destroyed** |
| 2026-01-06 | 2,624,510.334951 | pump.fun bonding curve | **buy-and-burn purchase** |
| 2026-05-30 | 4,000,000 | `64SpqFh6…umR3kTp` | **FreeCryptoA donation** |
| 2026-07-25 | 800,000 | `Winlew.sol` | Contribute-flow transfer |
| 2026-07-25 | 50,000,000 | `D8oJSdqo…A5ZEz` | **millerknoll donation** |
| *2026-08-01* | *(42,546,279.124698)* | — | moved out (Sol Incinerator needs a whole account) |
| *2026-08-01* | *(14,878,231.210253)* | — | **burn — destroyed** |
| 2026-08-01 | 50,000,000 | `Winlew.sol` | restock |

**Two independent checks fall out of this, and both hold exactly.**

**1. Each 2025 burn destroyed precisely the inflows that preceded it.**

```
300,000 + 1,529,373.210000            = 1,829,373.210000  = burn-2025-02-22   ✓
77,932.510911 + 10,000,000            = 10,077,932.510911 = burn-2025-08-02   ✓
```

**2. The whole wallet closes against its live balance.**

```
recorded inflow                119,331,816.055862
- burns authorized by wallet    26,785,536.931164
- outflow before Aug 1 burn     42,546,279.124698
= implied balance               50,000,000.000000   ← matches on-chain exactly
```

"Burns authorized by wallet" is the three burns this wallet actually signed. It deliberately excludes the 29 pump.fun BOOST burns (§7), which the PumpSwap pool executed against its own reserve — they reduced total supply without ever touching this wallet, which is exactly why they stayed invisible for months.

**Why this matters more than the individual entries.** Any fabricated, duplicated, or mis-transcribed amount anywhere in this history would break one of the two checks above. That they both resolve to the last decimal, against a balance read live from the chain, is stronger evidence than any single transaction lookup — and it is reproducible by anyone with an RPC endpoint.

## 8. Process for adding a future burn event

1. Obtain the transaction signature.
2. Fetch it via `getTransaction` (jsonParsed) and confirm it contains a genuine `spl-token` `burn` instruction (not a `transfer`) on the WinLEW mint, authorized by a wallet the project controls.
3. Add a new entry to `BURN_EVENTS` in `src/mole/burnEvents.js` with `status: BURN_EVENT_STATUSES.CONFIRMED_BURN`, the exact base-unit amount as a **string**, the signature, and an `evidenceSource` describing how it was verified.
4. Run `npm test` — `test/mole/burnEvents.test.mjs` validates every event's shape automatically.
5. No other file needs to change — the API route and frontend both read `BURN_EVENTS` directly.

If a burn is announced but not yet executed, add it with `status: QUEUED` or `TRANSFERRED_TO_BURN_WALLET` instead — it will correctly show as "staged," not count toward verified progress, and not be presented as a completed burn.

### 8a. Governance cross-link (added 2026-07-20)

Governance Module v1 (`/governance/`, `docs/governance-v1.md`) can host `burn-program`-category proposals — the community can vote to recommend a burn's amount, source, and timing. **A passed vote never adds an entry to `BURN_EVENTS` by itself.** The process above (steps 1–4) still applies unchanged after a passed proposal: a maintainer independently verifies the real on-chain transaction and adds the event, exactly as before. A governance proposal's `executionEvidence` should link back to the resulting `BURN_EVENTS` entry / Burn Center record once that happens, closing the loop between the vote and the verified outcome.

## 9. August 1 benchmark

Modeled as `BURN_BENCHMARK` in `src/mole/burnEvents.js` — an **annual project benchmark**, explicitly not a scheduled transaction with a committed amount. The Burn Center's timeline renders it in a visually distinct "Planned / Benchmark" category, separate from "Completed" events, so it can never be mistaken for a guaranteed transaction.

This framing is unchanged by the fact that **2026-08-01 is the first year a burn actually executed on the benchmark date** (§6a; the 2025 burn landed 2025-08-02, the day after). A benchmark that has been met twice running is still a benchmark, not a commitment — no amount or date is promised for any future year.

## 10. 100M long-term goal

`BURN_TARGET_BASE_UNITS` in `src/mole/burnEvents.js` — 100,000,000 WinLEW. Progress is currently **49.71%** using only verified confirmed burns (49,707,077.187484 / 100,000,000), following the 2026-08-01 benchmark burn (§6a). Remaining to target: 50,292,922.812516.

## 10a. Milestone: #1 holder voluntary transfer (2026-07-25)

millerknoll, WinLEW's #1 holder, sent **50,000,000 WinLEW** to the burn wallet (`burn.winlew.sol`) on their own initiative — unprompted, unannounced, and unrelated to BOOST. Verified on-chain: a single clean `spl-token transferChecked` instruction for exactly 50,000,000.000000 WinLEW at 2026-07-25T06:05:02Z ([`4iBFXv2N…nCSfw4`](https://solscan.io/tx/4iBFXv2NJvy6ejznafRngZgyz3L5ZbY1kpnqHUVTY28JkeHKoKidM4og36jsLmEMdietLsnzfmkUA9EPk2nCSfw4)), landing in the burn wallet's own WinLEW token account. Recorded in `BURN_EVENTS` as `transfer-2026-07-25-holder-to-burn-wallet` with `status: TRANSFERRED_TO_BURN_WALLET` — per §4's transfer-vs-destruction distinction, this is staged, not yet destroyed, so it raised the live "awaiting burn" figure but did **not** move the Verified Progress bar on its own.

**Subsequent history — and why the donation is still whole.** The 2026-08-01 benchmark burn (§6a) required emptying the burn wallet's token account, because Sol Incinerator burns an account's entire balance and offers no partial option. That burn **had already been planned before this donation arrived**; it was not prompted by it and not drawn from it in intent. Immediately afterward the project transferred a **matching 50,000,000** back into the burn wallet, so the wallet once again holds a full 50,000,000 attributable to millerknoll's contribution — the donor's purpose and provenance preserved intact. The entry above remains an accurate historical record of what millerknoll did on 2026-07-25; it is not a claim about the wallet's present balance, which is always read live.

## 11. Data sources

- Live burn-wallet balance: `getOwnerTokenSnapshot()` (`src/mole/solana.js`) — the same function the Transparency Center's "burn" component uses.
- Verified events, target, and benchmark: `src/mole/burnEvents.js` (static, hand-verified, see §6).
- No new Solana query logic was written for this feature — everything reuses functions that existed before this sprint.

## 12. What this page does NOT do

No wallet connect, no signing, no transaction construction, no private key handling anywhere in `src/public/burn/`, `src/mole/burnEvents.js`, or the `/api/burn/status` route. This is stated explicitly in the page's own footer.
