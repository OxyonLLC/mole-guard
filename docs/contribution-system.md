# Contribution system (2026-07-19)

A holder can send real WinLEW directly to one of three reserve wallets (Dev, Faucet, Burn) as a
recorded, ranked act of support. Every contribution is a real, independently-verified on-chain
transfer — never a self-reported number, matching this project's standing "evidence over
assumptions" rule (same standard as burn events, quiz payouts, governance eligibility).

## Why this design

The user explicitly chose the real-transaction flow over a manual/self-reported one: the server
builds the exact transfer, the connected wallet pops up asking the user to approve it (same as any
dApp), and the server independently re-verifies the confirmed result on-chain before recording
anything. No client-claimed amount is ever trusted.

## Flow

1. `/contribute/` — pick a cause (Dev / Faucet / X Faucet / Burn), pick a preset (100K / 1M / 5M)
   or a custom amount.
2. `POST /api/contribute/build` — resolves the caller's verified wallet (`getLinkedWalletRecord` +
   `getWalletVerificationStatus`, same as governance eligibility), calls
   `buildContributionTransaction()` in `src/mole/contributions.js`, which builds an **unsigned**
   SPL-token transfer (a single transfer instruction — see "Phantom flagged the transaction as
   malicious" below for why there's no ATA-create instruction), fee payer = the user's own wallet
   (they cover their own network fee — this is a contribution, not a payout). Returns a base64
   transaction.
3. Client deserializes it with `@solana/web3.js` (loaded via the official CDN build,
   `unpkg.com/@solana/web3.js@1/lib/index.iife.min.js`, only on this page — first time this site
   has needed client-side transaction signing at all) and calls
   `provider.signAndSendTransaction(transaction)` via `window.WinLEWAuth.connectHubWalletProvider()`
   (already existed, already returns the raw provider — just never used for anything beyond
   `signMessage()` before this).
4. `POST /api/contribute/confirm` — `confirmContribution()` independently re-fetches the signature
   from the RPC and verifies: the transaction succeeded, the signer matches the caller's own
   verified wallet, the destination + token mint match the claimed cause, and reads the **actual**
   transferred amount from the transaction's own pre/post token-balance delta — never the
   client-supplied amount, which is only ever a UI hint for step 2. Only then does it record the
   contribution.

## Storage

`src/mole/contributions.js` mirrors `src/mole/rewardHistory.js`'s exact dual Mongo/file-fallback
pattern — same `DATA_DIR`/collection-name-via-env conventions, same
try-Mongo-then-fall-back-to-file shape on every function. Dedupe key is the transaction signature
(a signature can only ever be recorded once — this is what actually prevents double-crediting, not
anything client-side).

## Destination wallets

Reused, not re-derived — the same 4 addresses already independently verified and shown on
`/transparency/`:

- **Dev**: `D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ`
- **Faucet** (Discord + web `/faucet/`, shared treasury keypair): `FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE`
- **X Faucet** (separate `@WinLewToken` X/Twitter faucet program, added 2026-07-19): `GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp`
- **Burn**: `EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74` (also `src/mole/burnEvents.js`'s
  `BURN_WALLET_ADDRESS`)

These live inside `web.js`'s `TRANSPARENCY_COMPONENTS` closure (not a module-level export), so
`contributions.js` carries its own small copy in `CONTRIBUTION_CAUSES` — if those addresses ever
change, both places need updating.

### On-page display (2026-07-19)

Each cause card on `/contribute/` shows its destination directly (`.destWallet` block): the
`.sol` names, the truncated raw address with a copy button, a Solscan link, and a deep link to
that wallet's `/transparency/` component entry. Every `.sol` name was verified to resolve
on-chain to the exact address before being published (Bonfida SNS resolver, checked
2026-07-19):

- `dev.winlew.sol` and `lewsales.sol` → Dev
- `diglew.sol` → Faucet (Discord + web)
- `winlew.sol` → X Faucet
- `burn.winlew.sol` → Burn

If a `.sol` domain is ever transferred or re-pointed, the page copy goes stale silently —
re-verify resolution before trusting these names anywhere new.

Each card also names WHO holds the wallet, with links (added same day, per the owner's Discord
`!wallet`/`!devwallet`/`!xwallet` bot commands which publish the same associations): Dev →
[@LewSales](https://x.com/LewSales); Faucet → the faucet bot's own Discord account (user ID
`1465588126515990692`) + the server invite; Burn → `/burn/` + [@LetEveryOneWin](https://x.com/LetEveryOneWin);
X Faucet → [@WinLewToken](https://x.com/WinLewToken).

## Manual send + signature claim (2026-07-19)

Every cause card has a **"Manually send"** button next to Contribute, expanding a panel with:
the full destination address and WinLEW mint (both copyable), a `solana:<address>?spl-token=<mint>`
deep link for mobile wallet apps, and a signature-paste box ("Verify & claim").

The claim posts the pasted signature to the **existing** `/api/contribute/confirm` — no new
backend. That endpoint was already provenance-agnostic: it re-fetches the transaction from RPC
and checks (1) the session's verified wallet is a signer, (2) the destination + mint token-balance
delta is positive (amount read from the chain, never the client), (3) the signature isn't already
recorded. A transfer built by the user's own wallet Send screen passes identically to one built
by `buildContributionTransaction()`, so this path adds zero new trust surface.

Why it exists: genuine transparency (users never have to approve a dApp transaction to
contribute), and it also happens to be unaffected by the Phantom domain false-positive above —
a wallet-native send involves no dApp request for Phantom to evaluate. Client error codes from
confirm are mapped to human text in `app.js`'s `CONFIRM_ERROR_TEXT`.

## External growth actions (2026-07-19) — link-out + review queue, not verified transfers

Locking, vesting, staking, and adding liquidity (Jupiter Lock, Streamflow Token Lock/Vesting/
Staking, Raydium Add Liquidity) all happen on third-party programs we don't control. There is no
reserve wallet of ours to build a transaction against or check a balance delta on, so these are
**not** part of `CONTRIBUTION_CAUSES` and never touch the Clout leaderboard.

Instead, `/contribute/`'s "🌱 Grow the Ecosystem" section link out to each platform (opening in a
new tab); clicking reveals a reminder to save the resulting contract/lock/stream/LP address. A
small form below lets the user submit that address (+ optional note) via
`POST /api/contribute/external-submit` (session + verified-wallet required, rate-limited 6/min),
which calls `recordExternalSubmission()` in `src/mole/contributions.js`:
- Validates the link id is known and the address is a plausible base58 Solana address (shape check
  only — not a guarantee).
- Stores a `status: "pending_review"` record (same dual Mongo/file pattern, collection
  `mole_external_contributions` / file `external-contributions.json`) — this is a queue, not a
  verified fact.
- Posts a Discord log via `sendContributionLogMessage()` so a maintainer sees it.

**Nothing here automatically adds anything to `/transparency/`.** A maintainer checks the
submitted address on-chain and, only if it holds up, hand-adds it to `TRANSPARENCY_COMPONENTS` —
same manual process every other transparency entry already goes through.

## Dashboard integration

- `computeMilestones()` (`src/mole/milestones.js`) gained one more item, `cause_contributor`
  (label "Contributor"), achieved when the user has ≥1 confirmed contribution — carries a new,
  purely additive `variant: "contribution"` field.
- `renderMilestones()` (`src/public/verify/profile.js`) sorts that item first and gives it a
  distinct purple `.pillTagContribution` treatment, standing apart from the green participation
  milestones around it.
- A new "💜 Your Contributions" card on the Dashboard (owner-only, next to Milestones inside the
  Overview card) shows per-cause totals + overall Clout rank, fed by `GET /api/contribute/mine`.

## Burn page entry point

`/burn/` got a "🔥 Contribute to the Burn" card (100K/1M/5M presets + a custom-amount link) that
deep-links to `/contribute/?cause=burn&amount=<value>` — pure navigation, no new logic on the Burn
page itself.

## A real bug found and fixed along the way

Building this page exposed a genuine, pre-existing overlap bug in the shared nav shell: `.navPrimary`'s
pill children had no `min-width:0`, so on any page with a long-labeled 5-link primary row (Burn,
the new Contribute page) at moderately-wide-but-not-huge viewports (~1440px), the primary row
overflowed its own container and visually overlapped the account area instead of shrinking. Fixed
in `nav.css` with `min-width:0` + `overflow:hidden`/`text-overflow:ellipsis` on `.navPrimary .pill`
— inert (never visibly truncates) at genuinely wide viewports, graceful ellipsis instead of overlap
at tighter ones.

## Phantom flagged the transaction as malicious (2026-07-19)

First real-world attempt: Phantom blocked the sign request outright with "Request blocked — This
dApp could be malicious." Root cause: `buildContributionTransaction()` originally included a
`createAssociatedTokenAccountIdempotentInstruction(ownerKey, destAta, destKey, mint)` ahead of the
transfer — the fee payer creating a token account for a *different* pubkey is exactly the
instruction shape drainer/scam kits use, which wallet security scanners (Phantom/Blowfish) flag.
It was also unnecessary: all 3 reserve wallets already hold confirmed WinLEW balances (see
`/transparency/`), so their ATAs are guaranteed to already exist. Removed the instruction entirely
— the transaction is now a single transfer instruction. Not yet re-tested against a live wallet
since the fix; do that before announcing the feature.

## Discord operational logging (2026-07-19)

`web.js` posts to the same "the-logs" channel webhook `src/games/payout-worker.js` already uses
(`GAME_PAYOUT_LOG_WEBHOOK_URL`, now also read via `getConfig()` instead of only
`process.env` directly) for:
- Every `/api/contribute/confirm` outcome — success, rejection (with reason), or thrown error.
- `POST /api/contribute/log-client-error` — a new, unauthenticated-but-rate-limited endpoint the
  client calls when the flow fails *before* ever reaching `/confirm` (e.g. the wallet itself
  blocking or rejecting the signing request, like the Phantom incident above). `app.js` tracks
  which `stage` it was in (`connect_wallet` / `build` / `sign_and_send` / `confirm`) and reports
  that alongside the error message, still capped/truncated, never blocking the UI error path.
- Never throws or blocks the request/response flow it's attached to — same try/catch +
  `console.warn` discipline as `sendGovernanceSubmissionMessage()`.

## Verification

- `test/mole/contributions.test.mjs` — 10 fault-injection tests covering every rejection path
  (unknown cause, missing signature, already-recorded, signature not found, failed transaction,
  wrong signer, wrong destination, wrong mint, no positive transfer, RPC failure) — same
  dependency-injection pattern as `test/mole/governanceRpcFailure.test.mjs`, zero real RPC or
  storage I/O.
- `test/mole/milestones.test.mjs` — 2 new tests for `cause_contributor`'s independence and
  `variant` field; 1 existing test updated to include `hasContributed: true` in its "everything
  achieved" fixture.
- `test/nav/site-nav.e2e.test.mjs` — `/contribute/` added to the page list (66 tests now, was 63).
- Full `npm test` + nav e2e suite passing before considering this done.
- **Not yet done**: a real end-to-end smoke test against devnet or a small real mainnet amount —
  this moves real money, so a Playwright click-through alone isn't sufficient confidence for the
  signing/RPC-verification path specifically. Do this before announcing the feature publicly.
