# The WinLEW Whitepaper

**$WinLEW — "Let's EveryOne Win"**
Version 1.0 · Built on Solana
Last updated: 2026-08-01. This is a living document — see §14.

---

## 1. Why WinLEW Exists

WinLEW did not start as a token with a community bolted on afterward. It started as a Discord server and a simple idea: **participation should create value.** Knowledge should have value. Showing up, contributing, and learning should be rewarded — not just holding a large wallet.

Most token projects launch a chart first and a community second, if at all. WinLEW built in the opposite direction: community and utility first, token mechanics layered on top of things people were already doing — answering trivia, playing games, helping each other verify wallets, showing up daily.

This document exists because that history matters, and because a project built on transparency should be willing to write down exactly how it works, including the parts that are still incomplete.

## 2. Project History and Evolution

WinLEW's features were not planned in a single design document and then built in order. They grew in response to what the community was already doing, roughly in this sequence:

1. **Community** — a Discord server organized around the $WinLEW token and its holders.
2. **Discord Utility Bot** — market data commands (price, supply, DexScreener/GeckoTerminal/Pump.fun/Raydium/Solscan lookups), wallet tools, and general server utility.
3. **Daily Faucet** — a way for holders to claim a small amount of $WinLEW directly in Discord (`!faucet` / `!drip`), with a cooldown to keep it sustainable.
4. **Educational Quiz** — trivia questions about crypto, Solana, and the ecosystem, rewarding correct answers with points that convert to $WinLEW each payout cycle.
5. **Games** — browser-based mini-games (DigLEW, Pac-Mole, Root Glide, Burrow Blaster, Grub Drop) at the Mole Hub, extending "play to earn small amounts" beyond trivia.
6. **Wallet Verification** — a linked-roles flow (`/mole link`) so a Discord identity and a Solana wallet can be cryptographically tied together, unlocking holder-tier roles and letting the faucet/quiz/games pay the right person.
7. **Web Platform** — the same faucet and quiz mechanics, rebuilt as first-party website pages (`/faucet/`, `/quiz/`) sharing the exact same cooldowns, points, and eligibility rules as their Discord counterparts, so a claim or a quiz answer counts the same regardless of where it happened.
8. **Dashboard** — a single unified dashboard now exists at [/verify/profile.html](/verify/profile.html): wallet identity, verification, live holdings, Proof of Value, quiz, faucet, and game activity in one place, reusing the same shared authentication as everywhere else on the site rather than a second login. See §11.
9. **Proof of Value** — the philosophy that ties all of the above together: rewards should track participation, consistency, and contribution — not wallet size. A Proof of Value engine is live: a single 0–100 score, balanced across Quiz, Faucet, Games, and Wallet Verification with a small streak bonus, shown on the Dashboard alongside real-data milestones and a weekly activity summary. See §11.
10. **Governance** — a live, on-chain-eligibility proposal-voting system ([/governance/](/governance/)). Verified holders above a WinLEW threshold vote on community proposals; eligibility is checked against live on-chain balances using the same wallet-verification layer as the rest of the platform, and every vote is recorded transparently. See §13.
11. **Contributions** — a real, on-chain way to give back ([/contribute/](/contribute/)): send $WinLEW to the Dev, Faucet, X Faucet, or Burn reserve directly from your own wallet. Each contribution is independently re-verified on-chain before it's recorded and ranks you on a public Clout leaderboard.

This whitepaper is being published at a point where the great majority of the above is live and working: the Transparency Center (§5) is public, and the unified dashboard, Proof of Value engine, Governance, and Contributions described above are all live. What remains unbuilt is the broader quests/seasonal-ladder/skill-bracket layer described in the Roadmap (§13) — genuinely locked, not yet started.

This history now includes a new market milestone. On **July 22, 2026**, the verified post-graduation PumpSwap market for the permanent WinLEW mint went live. What changed was the active market structure, not the token identity: the mint remained `DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump`, existing holders kept the same token, the established Raydium pool remained available, and the launch-stage pump.fun infrastructure is preserved as historical documentation rather than erased. Search for `$WinLEW`, `WinLEW`, or verify with the official mint; availability varies by platform.

## 3. Tokenomics

| Property | Value |
|---|---|
| Token | $WinLEW |
| Network | Solana (SPL Token) |
| Mint address | `DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump` |
| Decimals | 6 |
| Total supply | 949,999,960.615828 $WinLEW (read from the mint 2026-08-19; falls whenever a holder burns) |
| Mint authority | None (renounced — no further tokens can ever be minted) |
| Freeze authority | None |

These token-identity fields were last manually checked against the mint on **August 1, 2026**. For live confirmation, verify on-chain: [Solscan](https://solscan.io/token/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump), [DexScreener (Raydium)](https://dexscreener.com/solana/5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx), [GeckoTerminal](https://www.geckoterminal.com/solana/pools/Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL), [RugCheck](https://rugcheck.xyz/tokens/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump).

Because mint authority is renounced, the total supply figure above is a hard ceiling — it can only go down (via burns, §4), never up.

**Always verify the mint. Symbols and names can be copied.**

### Where tokens go

$WinLEW moves through the ecosystem in a few ways:

- **Circulating supply** — held by the community, traded via the post-graduation PumpSwap market and the established Raydium pool.
- **Liquidity, locks, and reserves** — several distinct components, not one wallet, discussed in §5.
- **Burn wallet** — tokens permanently removed from supply, discussed in §4.
- **Reward payouts** — a day-to-day operational wallet (separate from the locked treasury) funds faucet claims, quiz cycle payouts, and daily game-winnings batches. This wallet is the signer the bot uses to actually send tokens; it is deliberately kept out of the reach of the public web process (see §10, Security).

### Original launch allocation (historical)

At launch, the project communicated an intended allocation through a community tokenomics graphic. It was shared explicitly as an approximate, illustrative breakdown — *"not 100% accurate, but at least an attempt"* — and is preserved here as historical context, **not** as a current, verified statement of holdings. Allocations have evolved since; the live, on-chain, independently-verifiable components are in §5 and at the [Transparency Center](/transparency/).

| Segment (as communicated at launch) | Share |
|---|---|
| Community / Utility allocation (≈700,000,000 $WinLEW) | ~70% |
| Locked liquidity | ~10% |
| Burn reserve (long-term 100M target — see §4) | ~10% |
| Faucet reserve | ~5% |
| Dev & partnerships (incl. 2BRZ, the first partner — 1% sent) | ~5% |
| Treasury reserve | ~5% |

**On the figures.** As drawn, the launch graphic's segments add to roughly 105%, not a clean 100% — a reflection of its own stated approximate nature, not a precise ledger. It is reproduced here as intent and history rather than silently "corrected." For the actual current state of every liquidity, lock, and reserve component — read live from Solana, address by address — see §5 and the [Transparency Center](/transparency/).

## 4. Burn History

WinLEW's original tokenomics set aside a **10% burn allocation**, with a long-term goal of permanently burning **100,000,000 $WinLEW** total. Full live status, verified burn events, and progress toward that goal now live at the dedicated **[Burn Center](/burn/)** — this section is a summary, not the canonical source.

- **Burn wallet address:** `EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74` (`burn.winlew.sol`)
- **Verify independently:** [Solscan](https://solscan.io/account/EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74)

**Two things are tracked separately, not collapsed into one number:** tokens currently *held* in the burn wallet (**50,000,000** as of August 1, 2026 — still part of total supply, not yet destroyed) versus tokens *independently verified as permanently destroyed* via Solana's actual token `burn` instruction (**~49.71M** confirmed across 32 verified transactions, each checked directly against its own on-chain instruction data — not assumed from "sent to the burn wallet"). See the [Burn Center](/burn/) for the full breakdown, verified transaction links, and progress toward the 100M target.

On **August 1, 2026**, the project executed a burn of **14,878,231.210253 $WinLEW** ([`2ixvHEKg…noPHcD1`](https://solscan.io/tx/2ixvHEKgdq71C41QKy6Fr4JNCeuh8Borsq2YLLUdLEG3VYg9Y5NTCa824oa7KiSu7EikQsfCk1wvU2q7AnoPHcD1)) — an amount chosen to bring total supply to a round **950,000,000**, confirmed by reading the mint's supply after the fact rather than assuming it. That burn brings verified lifetime destruction to **~49.71M**, just under half the 100M long-term target.

**Reconciling that with the chain:** the mint's total supply read **949,999,960.615828** on 2026-08-19, so **50,000,039.384172** has been destroyed in total. The project's own ledger accounts for **49,707,077.187484** of it, every token tied to a transaction it executed. A further **100,830.472170** is now proven to have been burned by holders themselves — six transactions, each with a signature, found by walking the wallets the project's own giveaway ledger names. The remaining **192,131.724518** is holders this project cannot enumerate: buyers on the open market burning outright, and accounts closing with remainders. All three figures are correct and they measure different things: what the project did, what its known recipients did, and what happened to the supply. Supply can only fall via a burn instruction, so every part of the difference is destroyed tokens by definition.

This burn was **already planned before** the #1 holder's 50,000,000 donation arrived on July 25 — the donation did not prompt it and was not its purpose. The burn was executed with Sol Incinerator, which destroys a token account's *entire* balance and offers no partial option, so tokens not being burned had to be moved out first and the account was emptied in the process. Immediately afterward the project transferred a **matching 50,000,000** back in, so the burn wallet once again holds a full 50,000,000 attributable to that donation, keeping the donor's intent and provenance whole. Those 50,000,000 are **staged, not destroyed**, and the project's stated intent is to decide the next burn at the one-year anniversary.

**Community contributions to the burn wallet.** Two holders have voluntarily sent tokens there, unprompted: **FreeCryptoA** (4,000,000 on May 30, 2026) and **millerknoll**, WinLEW's #1 holder (50,000,000 on July 25, 2026). Both are **staged, not destroyed** — they raise the "awaiting burn" balance but move nothing on the verified-progress bar until a real burn instruction executes. The project has also run **buy-and-burn** purchases, acquiring **2,702,442.845862** on the open market into the burn wallet across two buys (77,932.510911 on February 22, 2025 and 2,624,510.334951 on January 6, 2026); buying is likewise not burning, and those count only once a burn transaction destroys them.

**What happened before this ledger existed is recorded as unknown.** A standard pump.fun launch mints 1,000,000,000. Current supply plus every verified burn implies an original of 999,707,077.187484, leaving roughly **192,131 tokens (~0.019%) unaccounted for** (it was 292,922 until 2026-08-19, when 100,830.472170 of it was traced to six community burns — see `docs/burn-program.md` §7c). That gap is not reconstructible and is not guessed at: $WinLEW was distributed early, including giveaways on X, and some recipients burned their own tokens from their own wallets — real reductions in supply, scattered across arbitrary addresses, with no reason to touch the project's burn wallet or announce themselves. Inventing entries to make the arithmetic close would defeat the purpose of keeping a verifiable ledger at all. This is the same boundary the rest of the project uses — Discord activity counts from when the bot began recording, web activity from when the site did — and it is precisely *why* the burn ledger was built: not to reconstruct an unknowable past, but to ensure every claim from here forward has a signature behind it. Note this affects only the *attribution* of historical reductions, never the supply itself: **current total supply is read live from the mint and was 949,999,960.615828 on 2026-08-19** — no longer a round 950,000,000, because two holders burned 39.384172 between them on 2026-08-18.

These figures change over time as more tokens are burned. The Burn Center reads the burn wallet's balance live from Solana on every request, so the "awaiting burn" number is never a stale snapshot. The verified-destroyed total is deliberately different: it comes from a curated log in which every entry was individually confirmed to be a real on-chain `burn` instruction, because proving destruction requires checking a specific transaction — not inferring it from a balance going down.

## 5. Ecosystem Architecture: Liquidity, Locks, and Reserves

WinLEW is not held in one wallet. Earlier drafts of this document described a single "treasury" — that framing was inaccurate and has been corrected. In reality, supply is distributed across several distinct, independently-verifiable on-chain components, each with a different job. All of them are documented — with live balances read directly from Solana, not typed in as static numbers — at **[`/transparency/`](https://winlew.co/transparency/)**, this project's Transparency Center.

Public trading now spans two current, verified market surfaces: the post-graduation PumpSwap market tied to the permanent mint, plus the established Raydium pool below. The original pump.fun launch-stage market remains documented historically at the Transparency Center rather than being silently relabeled as the active venue.

| Component | Purpose | Mechanism |
|---|---|---|
| **Liquidity** (Raydium pool `5nTz6…92Lx`) | Lets anyone buy or sell $WinLEW on-chain, no centralized order book | Standard Raydium CPMM pool |
| **50M Token Lock** | Long-term supply lock | Jupiter Lock — vests 10M/year, Apr 25 2025 → Apr 24 2030 |
| **15M Team Lock** | Team allocation, locked rather than liquid at launch | Jupiter Lock — vests 7.5M/year, Mar 1 2025 → Mar 1 2027 |
| **Streamflow Lock (22M)** | Additional supply under vesting | Streamflow on-chain vesting contract — full cliff unlock, 0% until Oct 29 2035; ~22.07M locked |
| **Streamflow Lock (7M)** | A second, separate supply lock | Streamflow on-chain vesting contract — full cliff unlock, 0% until Oct 29 2030; ~7.01M locked |
| **Burn Wallet** (`EX5nx…aZ74`, `burn.winlew.sol`) | Permanent removal of supply | Standard wallet — tokens sent here are irrecoverable (§4) |
| **X (Twitter) Faucet Reserve** (`GFxz4…EhAp`, `winlew.sol`) | Funds the separate X/Twitter faucet program run via @WinLewToken — *not* the website faucet | Standard wallet |
| **Discord & Web Faucet Reserve** (`FcEtZ…PPjE`, `diglew.sol`) | Funds rewards distributed through *both* the Discord Faucet Bot and the website faucet (§6) — they share one treasury keypair, not two separate reserves. Currently also the signer that pays out quiz and game rewards. | Standard wallet |
| **Developer Reserve** (`D6d5b…FRkZ`) | Development and ecosystem funding | Standard wallet |

Every address above was independently verified against Solana mainnet (two RPC providers) before being published here or on the Transparency Center — including confirming each lock's actual on-chain balance matches its stated amount (the 50M and 15M locks resolve to token accounts holding exactly 50,000,000 and 15,000,000 $WinLEW respectively; the two Streamflow contracts resolve to ~22.07M and ~7.01M, ~29.08M combined).

**Public accountability.** The point of documenting all of this by address, not just by category, is that none of it has to be taken on faith. Every row in the table above links to Solscan on the Transparency Center; anyone can independently confirm balances, lock schedules, and transaction history themselves.

**On historical figures.** The tokenomics graphic communicated at launch represents the original allocation and is preserved as historical documentation rather than edited retroactively (§3, §13). Allocations have evolved since — the components above reflect the current, real state. Where the two differ, this document says so rather than quietly reconciling them.

Two separate 90-day Raydium liquidity farms ran historically and back-to-back (the first March–June 2025, the second June 16 → September 14 2025) — LP providers staked WinLEW/SOL LP tokens to share a scheduled WinLEW reward pool on top of ordinary trading fees. Both programs have ended; they are documented as historical, not currently active, at [Sponsors & Partners](/partners/), alongside the project's community-partnership history.

## 6. Faucet

The faucet lets eligible holders claim a small amount of $WinLEW on a rolling cooldown (default 24 hours, configurable), either through Discord (`!faucet` / `!drip`) or the website (`/faucet/`).

The important design point: **both surfaces share one cooldown.** A claim from Discord blocks a claim from the website for the same identity and wallet, and vice versa — there is one claim record per person per cooldown window, not two independent systems that could be played against each other. Claims are reserved atomically (a claim is either fully reserved or not reserved at all, with no window where two simultaneous claims could both succeed), and token amounts are computed with exact decimal arithmetic rather than floating-point math, to avoid rounding drift in either direction.

Eligibility can require a minimum holder balance (configurable, default enabled at a low floor) so the faucet is a benefit for people who actually hold the token, not an open tap for outside wallets.

### How much has actually been given away

As of **August 1, 2026**, the faucet reserve wallet has distributed **1,287,846.66 $WinLEW** across **1,001 payouts** to **41 distinct wallets**, beginning with its first payout on **May 18, 2025**.

That figure is read from the chain, not from this project's own records, and it is **verified complete**: every transaction the wallet has ever had was fetched and decoded, and total received minus total sent equals its live on-chain balance exactly. Nothing is missing from it. Anyone can reproduce the check against [the wallet on Solscan](https://solscan.io/account/FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE#transfers).

**Two different numbers are published, deliberately.** The `/faucet/` page also shows a claim counter sourced from this platform's own records — that one counts claims *this codebase processed and confirmed*, and it is far smaller: **63 claims totalling 64,500** against 1,001 on-chain payouts.

**That gap is fully accounted for.** It was investigated transaction by transaction in August 2026, and three things make it up:

- **No claim recording existed before July 10, 2026.** The claim store and the shared Discord/web claim flow shipped that day. For the ~14 months before it, the bot sent drips directly and wrote no record. The counter's earliest entry (2025-05-25) comes from a one-time import of legacy cooldown timestamps, which is also why 20 of its rows carry no amount at all.
- **Quiz and game rewards are signed by the same wallet** (§3, "Reward payouts") and are not faucet claims, so they appear in the on-chain total and never in the claim counter.
- **A `!drip` race double-paid 28 times**, sending **41,500 $WinLEW** more than was owed between May 2025 and April 2026. The cause was two copies of the bot running under different process supervisors, each answering the same command. Both the cause and a startup guard preventing it are fixed; the full transaction-level accounting is in `docs/faucet-double-drip-incident.md`.

Since recording began, **every real user claim has a record.** A reverse check of every on-chain payout against the claim store found zero unexplained: one claim whose transfer had landed but whose confirmation timed out (since credited), one payout made eight hours before the recording code shipped, and one self-send to the project's own wallet.

This is the §4 discipline applied to distribution rather than burns: the on-chain figure is the one backed by signatures, and it is the one to trust — but the difference is explained rather than left hanging.

Like the supply figure in §3, the total above is a **point-in-time snapshot** and rises with every payout. The live values are on [`/faucet/`](/faucet/), the [Transparency Center](/transparency/), and [`/leaderboards/`](/leaderboards/#faucetBoard), each stamped with when it was last checked.

## 7. Quiz Platform

The quiz rewards correct answers to crypto/Solana/ecosystem trivia with points, which convert to $WinLEW at the end of each payout cycle. Like the faucet, it exists in two places that share the same underlying state:

- **Discord**: `/startquiz [level]`, `/sponsorquiz sponsor:<xyo|winlew>`, `/leaderboard`, `/mypoints`, `/cycleinfo`.
- **Website** (`/quiz/`): the same question pools, presented as four tiles — Easy, Medium, Hard, and Sponsor — each showing your own accuracy for that tier.

Sponsor questions (currently XYO- and WinLEW-branded pools) are playable from either surface and credit the same per-sponsor breakdown either way. The website additionally shows a Web-vs-Discord comparison — informational only, and never a factor in payout-eligible points, which are tracked once regardless of platform.

Anti-farm measures include a per-question timer, one submission per question instance, answer-once-per-cycle enforcement, and a daily cap on scored answers.

## 8. Games

The Mole Hub (`/mole-hub/`) hosts a small catalog of browser games — DigLEW, Pac-Mole, Root Glide, Burrow Blaster, and Grub Drop — built around short, skill-based sessions rather than passive holding. Winnings are earned in-session and paid out in a daily batch, with reward caps and anti-farm guardrails in place to keep payouts sustainable and resistant to scripted play. Guest play is supported (winnings save locally) and reconciled into your account once you connect a wallet, so trying a game doesn't require signing anything up front.

## 9. Wallet Verification

Verification (`/verify/`, or `/mole link` in Discord) ties a Discord identity to a Solana wallet through a signed-message challenge — the wallet proves ownership by signing a message, not by sharing a private key or seed phrase. Once linked, that wallet becomes the identity the faucet, quiz, and games all pay out to, and it unlocks Discord roles:

- **Verified Wallet** — base role for anyone with a linked wallet.
- **Verified Holders** — for wallets holding $WinLEW.
- **LewCREW 1 Million Club / 10 Million Club / 100 Million Club** — holder-tier roles at increasing balance thresholds.

`.sol` domain names (SNS) are supported as an alternative to pasting a raw address, on the faucet, quiz, and verification flows alike.

## 10. Security

A few concrete measures, described honestly rather than as generic reassurance:

- **Treasury key isolation.** The keypair that actually signs and sends tokens is loaded only by the Discord bot process and the dedicated payout-worker process — never by the public-facing web server. Website faucet claims are *reserved* by the web process and *executed* by a separate worker that is the only other process with access to the signing key.
- **Atomic claim reservation.** Faucet claims use a locking mechanism (file-lock or database transaction, depending on deployment) so two simultaneous claim attempts for the same identity can't both succeed — one wins, the other is correctly told "already claimed."
- **Exact decimal math.** Token amounts are computed with exact base-unit arithmetic, not floating-point numbers, to eliminate a class of rounding bugs that have caused real problems for other projects' payout systems.
- **Watchdog.** A separate bot service monitors the server for impersonation attempts (auto-flag/auto-ban on suspicious display-name patterns), common scam text patterns (e.g. "buying aged wallets" / seed-phrase-harvesting messages), and sends heartbeat/health signals so downtime is noticed quickly.
- **Live health checks.** Beyond the Watchdog's heartbeat, a public status endpoint (`GET /api/health/status`, surfaced on the [/health/](/health/) page) actively probes each first-party page and data API on demand and reports per-route latency. For the JSON APIs it goes a level deeper than an HTTP 200 — it parses each response and requires `ok: true` before calling that service healthy. Anyone can load [/health/](/health/) to read the current, live status rather than a claimed one.
- **Anti-farm guardrails.** Present throughout the reward systems described above — cooldowns, daily caps, answer-once enforcement, holder-balance floors — because a rewards system that can be trivially scripted stops being a rewards system for the community that plays fair.

Security is an ongoing practice, not a one-time claim. This section will be updated as the system evolves.

## 11. Proof of Value — The Community Philosophy

Everything above is in service of one idea: **rewards should track participation, consistency, and contribution — not the size of your wallet.** A large holder and a small holder answering the same quiz question correctly earn the same points for that answer. A faucet claim is the same claim whether it comes from Discord or the website. This is why WinLEW is not organized around trading mechanics — it's organized around things people actually do.

The "Proof of Value Engine" is live: a unified 0–100 score computed from Quiz, Faucet, Games, and Wallet Verification (balanced ~25% weight each, plus a small streak bonus), shown on the Dashboard with a full component breakdown, real-data milestones, a faucet claim streak, and a weekly activity summary — see [/verify/profile.html](/verify/profile.html). What's genuinely still unbuilt is the broader quests/seasonal-ladder/skill-bracket layer described in the Roadmap below — that remains locked, not staged or in progress.

## 12. Community-First Development

WinLEW's feature history (§2) reflects how it's actually built: in response to what the Discord community was already doing, not from a roadmap decided in isolation. Development priorities have consistently favored things that make the existing community's experience better and more trustworthy — fixing a broken mobile menu, unifying a faucet cooldown so it can't be gamed across platforms, adding a wallet picker so mobile users aren't stuck — over adding entirely new surface area. This whitepaper itself, and the Transparency Center described in §5, exist because the community and project maintainers agreed that visibility and transparency were overdue, not because either was required by any external party.

## 13. Roadmap

WinLEW's public roadmap (visible at [winlew.co/#roadmap](https://winlew.co/#what)) is organized into four phases:

| Phase | Focus | Status |
|---|---|---|
| **Phase 1 — Foundation & Tokenomics** | Core site, link hub, live market stats, verified contract/pool references | **Live** |
| **Phase 2 — Core Infrastructure / Proof of Value Engine** | Contribution-signal tracking, unified Proof of Value score, transparency logs, unified Dashboard | **Live** |
| **Phase 3 — Engagement & Mechanism Rollout** | Games & Trivia Layer (**live**); on-chain Governance proposal voting (**live**, [/governance/](/governance/)); on-chain Contributions & Clout leaderboard (**live**, [/contribute/](/contribute/)); milestone/streak/weekly-activity visibility (**live**); seasonal ladders, skill brackets (**locked / staged rollout**) | **Partially live** |
| **Phase 4 — Expansion & Sustainability** | Utility Expansion (automation, integrations); Community Ops (events, coordination tooling) | **Coming soon** |

Separately, this document and the accompanying engineering work track three additional near-term milestones that don't change token mechanics but materially affect the platform experience:

1. **This whitepaper** — the definitive public description of the project (this document).
2. **A Transparency Center** — live on-chain visibility into every liquidity, lock, and reserve component described in §5, not a single wallet.
3. **Unified authentication** — one shared wallet-connect module ([`/assets/wallet-auth.js`](https://winlew.co/assets/wallet-auth.js)) now backs Mole Hub, Faucet, Quiz, and the profile editor, replacing what were several independent copies of the same logic. Connecting on any of those apps carries over to the others automatically — no reconnect required — via the same shared session already used by all of them. Full details, including the one deliberate exception (Verify's own first-time wallet-linking flow, which solves a different problem and keeps its own implementation), are in `docs/unified-authentication.md`.

## 14. A Note on Transparency

Parts of this document describe things that are still incomplete — the treasury's on-chain visibility, the unified dashboard, the Proof of Value Engine's more advanced scoring. That's intentional. A whitepaper that only describes finished, polished features isn't transparent, it's marketing. This one will be updated as those pieces ship. The project's codebase was open-source through version 3.3.3; the repository is currently private while active development continues, and this document's update history is tracked internally rather than silently edited.

---

*This whitepaper is a living document. For the most current on-chain figures, verify directly against the addresses listed above rather than relying on any number printed here.*
