# WinLEW Roadmap Completion Sprint — Phases 1–3

> **ARCHIVED — Version 1.0 Complete.** Per the Version 2 roadmap (`docs/roadmap-v2.md`), Phases 1–3 below are historical milestones as of 2026-07-11. This document is preserved as-is and is not being modified or rewritten going forward; it is a record of what shipped, not a living spec. Ongoing work now lives under the Version 2 roadmap.

Status: **Phases 1–3 complete, tested, committed, and pushed.**
Commits: `9265ee8` (Phase 1), `54b4072` (Phase 2 — superseded, see addendum), `27b0f23` (Phase 3), `eb2fe2c` (Phase 2 revision + platform walkthrough).

This document preserves the original sprint brief verbatim, followed by a completion record showing exactly what was delivered against each requirement. Kept as the permanent paper trail for this sprint.

**Addendum:** Phase 2 was revised after initial delivery. The single-wallet "Treasury" framing was replaced with a "Transparency Center" (`/transparency/`) documenting every real on-chain component — liquidity, two Jupiter Lock vesting accounts, a Streamflow lock, the burn wallet, two separate faucet reserves (web + Discord), and a developer reserve. See the "Phase 2 revision" section near the end of this document for the full account.

---

## Original brief (verbatim)

> # WinLEW Roadmap Completion Sprint — Finish Phases 1–3 Before Expanding
>
> You are the Lead Engineer for the WinLEW ecosystem.
>
> Your objective is **NOT** to add new features.
>
> Your objective is to complete every unfinished item from the original roadmap and polish the existing platform until it feels like a single, cohesive application.
>
> Do not begin work on Phase 4 or Phase 5.
>
> Only move forward once Phases 1–3 are genuinely complete.
>
> ---
>
> # General Rules
>
> Work like a senior product engineer.
>
> Do not chase tickets.
>
> Do not rewrite working systems.
>
> Improve consistency.
>
> Reduce duplication.
>
> Make every user interaction feel intentional.
>
> Before making architectural changes:
>
> * inspect the existing implementation
> * reuse components whenever possible
> * consolidate duplicated logic
> * preserve backward compatibility
> * commit cleanly to GitHub after each completed milestone
>
> Every milestone should end in:
>
> • working implementation
> • tests where appropriate
> • documentation updates
> • commit
> • push
>
> ---
>
> # PHASE 1 — Publish the Whitepaper
>
> The original roadmap promised a whitepaper.
>
> Although the project has evolved significantly, one has never been officially published.
>
> Your task is to create the first official WinLEW Whitepaper.
>
> It should explain:
>
> • Why WinLEW exists
> • The project's history
> • The original vision
> • Tokenomics
> • Locked treasury
> • Burn history
> • Faucet
> • Quiz system
> • Proof of Value philosophy
> • Games
> • Dashboard
> • Wallet verification
> • Security
> • Community-first development
> • Roadmap (completed + future)
>
> The whitepaper should be professionally written.
>
> Avoid hype.
>
> Focus on transparency.
>
> Include diagrams where useful.
>
> Export as:
>
> * Markdown
> * PDF-ready format
> * Website page (/whitepaper)
>
> Add a permanent navigation item: Whitepaper
>
> ---
>
> # PHASE 2 — Treasury / Locked Tokens
>
> The treasury contract already exists on-chain.
>
> Contract: `6jzprDfyPxDYgdTxeLBdCL6tYsP8ViR66FSjNvoNhv41`
>
> The implementation exists. The visibility does not.
>
> Create a dedicated Treasury page.
>
> This page should explain:
>
> • why the treasury exists
> • why 100M tokens were locked
> • lock status
> • contract address
> • links to explorers
> • purpose of the treasury
> • transparency
> • future treasury usage
>
> Display on-chain information where possible instead of static text.
>
> Include:
>
> * current treasury balance
> * locked amount
> * explorer links
> * copy address
> * transaction history (if practical)
>
> Add a permanent navigation item: Treasury
>
> The page should build trust rather than advertise.
>
> ---
>
> # PHASE 3 — Unified Authentication
>
> This is the highest priority.
>
> Currently every application behaves differently. Examples include: Verify, Mole Hub, Faucet, Quiz, Dashboard, Future applications.
>
> Each one connects wallets differently. Each one manages sessions differently. Each one presents different UI.
>
> This should become ONE authentication system.
>
> Design and implement a shared authentication layer.
>
> Requirements:
>
> One wallet connection flow. One session manager. One authentication provider. One reusable wallet modal. One profile source. One logout flow. One reconnect flow. One error handling system.
>
> Every application should consume the same shared authentication package.
>
> Once connected, users should seamlessly move between Verify, Mole Hub, Faucet, Quiz, Dashboard, Future applications — without reconnecting wallets.
>
> The experience should feel like a modern SaaS product. The user should never wonder: "Why am I connecting my wallet again?"
>
> Consolidate duplicated code wherever possible. Use shared hooks, providers, components, and state.
>
> Standardize: wallet selection, connection UI, loading states, reconnect logic, session persistence, disconnect, account switching, error messaging.
>
> The authentication experience should become a platform service instead of something each application implements independently.
>
> ---
>
> # Product Polish
>
> After these milestones are complete, inspect the entire platform.
>
> Look for: inconsistent buttons, duplicate components, different loading animations, inconsistent typography, inconsistent spacing, repeated wallet code, duplicated APIs, repeated state management, navigation inconsistencies.
>
> Refactor carefully. Reduce technical debt where practical.
>
> The goal is not to redesign. The goal is cohesion. Everything should feel like one product built by one team.
>
> ---
>
> # Success Criteria
>
> Phase 1 is complete when the Whitepaper is publicly available.
>
> Phase 2 is complete when Treasury has its own permanent page with live on-chain transparency.
>
> Phase 3 is complete when every application shares the same authentication and wallet experience.
>
> Only after these three milestones are complete, polished, tested, committed, and pushed to GitHub should you report back for product review. At that point, I will decide whether we proceed to Phase 4 and Phase 5.

---

## Completion record

### Phase 1 — Whitepaper

| Requirement | Delivered |
|---|---|
| Why WinLEW exists, history, original vision | §1–2, `docs/whitepaper.md` |
| Tokenomics | §3 — mint address, supply, decimals, mint/freeze authority, all read live from Solana mainnet, cross-checked against two independent RPC providers |
| Locked treasury | §5 — see Phase 2 note below; deliberately qualitative pending address confirmation |
| Burn history | §4 — burn wallet address + live balance, verified on-chain |
| Faucet | §6 |
| Quiz system | §7 |
| Proof of Value philosophy | §11 |
| Games | §8 |
| Dashboard | §2 — described honestly as *not yet a single page* (profile + quiz standings + wallet chip today); this gap is exactly what Phase 3 improves toward |
| Wallet verification | §9 |
| Security | §10 — treasury key isolation, atomic claim reservation, exact decimal math, Watchdog, anti-farm guardrails |
| Community-first development | §12 |
| Roadmap (completed + future) | §13 — the real four-phase public roadmap already on the homepage, not a separate invented one |
| Professionally written, no hype, transparency-focused | Explicit "Note on Transparency" section (§14) calling out what's still incomplete rather than hiding it |
| Diagrams where useful | Tokenomics and roadmap presented as tables (the site's existing visual language uses tables/cards, not diagrams elsewhere — consistent with that, not a gap) |
| Markdown export | `docs/whitepaper.md` (source of truth) |
| PDF-ready format | `/whitepaper/` page includes a `@media print` stylesheet + a "Print / Save as PDF" button — no bundler/binary PDF generation exists in this stack, so browser print-to-PDF is the practical equivalent |
| Website page `/whitepaper/` | Live |
| Permanent nav item "Whitepaper" | Added to Home, Mole Hub, Quiz, Faucet, Verify |

**Commit:** `9265ee8` — tests: 3 new nav regression tests, 119/119 total passing at that point.

### Phase 2 — Treasury

| Requirement | Delivered |
|---|---|
| Why the treasury exists, why 100M was locked, purpose, transparency | `/treasury/` page body copy |
| Lock status, future treasury usage | Stated honestly: no formal lock mechanism or future-use plan has been finalized/confirmed yet — see note below, rather than inventing either |
| Contract address, explorer links, copy address | Present in the live-data state (`#treasuryAddress`, Solscan + Explorer links, copy button) |
| Current treasury balance, transaction history | Fetched live via `GET /api/treasury/status`, backed by `getWalletTreasurySnapshot()` in `src/mole/solana.js` |
| On-chain info instead of static text | Every number on the page comes from that live endpoint; zero hardcoded balances |
| Permanent nav item "Treasury" | Added to Home, Mole Hub, Quiz, Faucet, Verify, Whitepaper |
| Build trust, not advertise | **Open item, needs your input**: the address given for this phase (`6jzprDfyPxDYgdTxeLBdCL6tYsP8ViR66FSjNvoNhv41`) returned zero balance / no account data from two independent RPC providers (`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`) and no results from a web search. Cross-checked the lookup method itself against two known-good addresses (the WinLEW mint and the burn wallet), both of which resolved correctly — so the lookup works, the given address specifically does not appear to exist on mainnet yet. Rather than publish a fabricated balance, the page and whitepaper both render an honest "not yet configured" state (`TREASURY_WALLET_ADDRESS` unset in `.env`). The moment a confirmed address is set, live data appears with no code changes needed. |

**Commit:** `54b4072` — tests: 3 new nav regression tests, 122/122 total passing at that point.

### Phase 3 — Unified Authentication

| Requirement | Delivered |
|---|---|
| One wallet connection flow | `window.WinLEWAuth.walletLogin()` / `connectHubWalletProvider()` in `src/public/assets/wallet-auth.js`, consumed by Mole Hub, Faucet, Quiz |
| One reusable wallet modal | `showMobileWalletPicker()` — one implementation, one set of deep-link builders (Phantom/Solflare/GeoWallet) |
| One session manager / one profile source | `AuthKeys` standardized on `winlew.verify.*`; the wallet display-name cache (previously split between `winlew.verify.wallet` and `winlew.hub.wallet`) is now one key, with a one-version read-compat shim for the old key |
| One logout flow | `window.WinLEWAuth.logout()` |
| One reconnect flow | Same `walletLogin()` path handles both first connect and reconnect — no separate code path existed for this in any app, so nothing to duplicate-then-merge here |
| One error handling system | Centralized in `walletLogin()`'s `onError`/`catch` handling, including the GeoWallet-specific `unsupported method: sol_connect` case that previously had 3+ separate copies of the same regex check |
| "Connect once, stay connected everywhere" | Verified: the shared `winlew.verify.session` key was already used identically by every app before this change (same-origin localStorage); this work centralized the *code* that reads/writes it and fixed the one place (wallet-name cache) where the key had drifted |
| Consolidate duplicated code | Faucet: 475→233 lines. Quiz: 622→389 lines. Mole Hub: 1562→1441 lines (partial — see rationale below). Deleted an orphaned duplicate (`src/public/link.js`, referenced by zero pages). Verify's profile editor upgraded from Phantom/Solflare-only to full provider coverage. |
| "Dashboard" and "Future applications" | No dedicated Dashboard app exists yet (see Phase 1 note) — `wallet-auth.js` is written so any future app just adds two script tags and gets full parity from day one, rather than starting a sixth copy |

**Deliberate exceptions, not oversights (documented in `docs/unified-authentication.md`):**
- **Mole Hub kept its own `walletLogin()`** — it has real extra steps (wallet-verification UI, guest-winnings reconciliation, server wallet sync) interleaved with login, and a local `readHubApiJson` with a stricter throw-on-error contract that four *other*, unrelated API calls in the same file depend on. Migrated the pure, duplicated primitives (provider detection, picker, deep links, API-base bridge); left the app-specific orchestration local rather than risk the platform's highest-traffic, real-money surface for marginal additional consolidation.
- **`/verify/`'s own linking flow (`link.js`) was not migrated.** It solves a different problem — first-time OAuth-style Discord↔wallet linking, not signing into an existing session — already has full provider/mobile coverage independently, and is the single most sensitive step in the entire funnel. Rewriting it for a mostly-aesthetic benefit was judged not worth the regression risk.

**Commit:** `27b0f23` — tests: full nav regression suite (36 tests) + full repo suite (122 tests), all passing.

### Product Polish

Addressed opportunistically within each phase rather than as a separate pass, per "do not chase tickets" / "refactor carefully":
- Repeated wallet code → consolidated in Phase 3 (above).
- Duplicated APIs → the API-base bridge (`hubApiFetch`) was a 4th copy before Phase 3; now one.
- Navigation inconsistencies → Whitepaper and Treasury nav entries added consistently to the same six core pages, not an ad hoc subset.
- No visual redesign was performed anywhere — every new page (`/whitepaper/`, `/treasury/`) reuses the site's existing card/pill/nav visual language rather than introducing a new style.

---

## Phase 2 revision — Treasury → Transparency Center

After initial Phase 2 delivery, the premise changed: WinLEW does not have a single treasury wallet — it has liquidity, multiple vesting locks, a burn wallet, and several reserve wallets, each independently addressable on-chain. The single-wallet page was replaced entirely.

**What changed:**
- `/treasury/` is now a redirect stub to `/transparency/` (matching the site's existing pattern for moved pages, e.g. `winlew-forge.html`).
- `/transparency/` documents 8 components: the Liquidity pool, 50M Token Lock, 15M Team Lock, Streamflow Lock, Burn Wallet, Faucet Reserve (Web), Discord Faucet Reserve, and Developer Reserve — each with purpose, live balance where practical, explorer links, and a copy-address button.
- Every address was independently verified on-chain (two RPC providers, cross-checked against known-good addresses) before being used — including confirming the 50M and 15M locks hold exactly those amounts, and the Streamflow lock holds ~22.07M, all matching the figures given for this task.
- `src/mole/solana.js` gained three new read strategies beyond the original wallet-balance one: a direct-token-account reader (needed for Streamflow, whose given address *is* the token account rather than a wallet that owns one) and a program-account existence/ownership check (for the Raydium pool, whose reserves aren't reimplemented here — linked out to DexScreener instead, which already parses them correctly).
- Found and fixed a real bug during this work: the configured RPC (`solana-rpc.publicnode.com`) hangs indefinitely on `getParsedTokenAccountsByOwner` calls with a mint filter (reproduced consistently, multiple attempts). The original code silently caught that into a fake "0 balance." Fixed to add an 8-second timeout and let a real failure surface as "temporarily unavailable" per-component, never as a wrong number — the same transparency principle applied to our own failure modes, not just the data itself.
- `TREASURY_WALLET_ADDRESS` config was removed; the 8 component addresses are committed as constants in `src/mole/web.js` (same treatment as the mint and burn-wallet addresses already hardcoded elsewhere), since all 8 are now confirmed rather than pending.
- Whitepaper §5 rewritten from "Treasury and Locked Tokens" (single wallet) to "Ecosystem Architecture: Liquidity, Locks, and Reserves" (the real 8-component table), across all three copies (`docs/whitepaper.md`, the website page, and its markdown download).
- All 6 `/modules/*.html` roadmap-detail pages were found to have their own bespoke nav (no `nav.css`/`nav.js`, no mobile collapse, no Profile chip, an incomplete link set) during the modules audit this revision also required — retrofitted to the shared nav system, same as every other first-party page.

**Verification:** every address's on-chain type was determined empirically (not assumed) before choosing a read strategy — `getAccountInfo` was run against each one first to see whether it's a plain wallet, a direct token account, or a program-owned account, and the code path was chosen to match what was actually found. Full walkthrough performed after all changes: every page on the site loads with zero console errors, every internal link discovered across 17 pages resolves (the only two "broken" links found, `/linked-role/mole` and `/geoagora/profile`, are dynamic backend/proxy routes that 404 under static-file-only testing and are confirmed to exist as real Express routes in the source — not bugs), mobile wallet pickers still work on Mole Hub/Faucet/Quiz, and all 6 roadmap module cards on the homepage link correctly. 125/125 automated tests passing (122 + 3 new nav regression tests for the Transparency page and a representative module page).

## Open items before Phase 4/5

None. The Phase 2 treasury-address question from the original brief is resolved — it was superseded by the Transparency Center rework above, and every address now in use has been independently confirmed on-chain.
