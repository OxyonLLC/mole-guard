# Unified WinLEW Dashboard — Version 2.2

Date: 2026-07-11
Scope: one signed-in home that brings Wallet, Verification, Proof of Value, Quiz, Faucet, Games, Milestones, and Recent Activity together, using only real data from systems that already exist.

## 1. Route decision: evolve, don't duplicate

**`/verify/profile.html` became the dashboard.** No new `/dashboard/` route was created.

Before writing any code, the existing implementation was inspected:

- No `/dashboard` route or abandoned dashboard files existed anywhere in `src/public/`.
- `/verify/profile.html` + `src/mole/web.js`'s `buildProfilePayload()`/`buildPublicProfilePayload()` already had exactly the structure a dashboard needs: one aggregated payload, a working owner/public split (`.ownerOnly` CSS class toggled by `applyPublicViewState()` based on `isPublicView()`), and five of the eight required data sources already wired in (wallet, verification, holdings, faucet, quiz, games — Proof of Value was added in Version 2.1 on this same page).
- The shared authentication module (`src/public/assets/wallet-auth.js`, Version 2.1... actually Phase 3) was already the single wallet-connect/session system this page used.

Given that, creating a second `/dashboard/` route would have meant either duplicating `buildProfilePayload()` (a second, parallel data model — explicitly prohibited) or having two routes both call the same function (two URLs for the same content, with the well-known confusion that creates for bookmarks, the public-profile share link, and search/social previews). Evolving the existing page preserves every existing bookmark, every `?wallet=...&public=1` public-profile link already shared anywhere, and the entire owner/public boundary system as-is.

The page's framing was updated to reflect its new role — `<title>`, hero copy, and the site-wide nav pill (`👤 Profile` → `📊 Dashboard`, same URL, updated across all 28 pages that carry it) — without touching the URL, the auth system, or the payload shape apart from additive fields.

## 2. Reused systems (nothing new was built in parallel)

| Need | Reused as-is | Added |
|---|---|---|
| Wallet connect/session | `window.WinLEWAuth` (`wallet-auth.js`) | Nothing — Disconnect/Reconnect/Copy buttons call into the existing module, no second wallet modal |
| Wallet identity, verification, holdings | `getLinkedWalletRecord`, `getWalletVerificationStatus`, `getLiveHoldingsSnapshot` | Nothing |
| Proof of Value | `combineProofOfValue()` (Version 2.1, `src/mole/proofOfValue.js`) — untouched scoring logic | `quizSignalsForUser` exported (was already a private helper) so the dashboard's parallel-fetch path can reuse it instead of re-fetching via the `getProofOfValueScore()` convenience wrapper |
| Quiz | `src/quiz/db.js` (`getUser`, `getUserPlatformStats`, `listRedemptions`, `getCurrentCycle`, etc.) | `getUserRank(userId)` — no existing "my rank" query; reuses `topUsers()`'s exact sort order |
| Faucet | `src/faucet/claimStore.js` (`getStatusForUser`) | `getClaimHistoryForUser` (added in Version 2.1) extended with `totalConfirmedAmount`; `buildFaucetSnapshot` in `web.js` rewired onto `getStatusForUser` (see §5) |
| Games | `src/mole/rewardHistory.js` (`getRewardSummary`, `listRewardClaims`) | Nothing |
| Milestones | — | `src/mole/milestones.js` (new, pure, deterministic) |
| Recent activity | — | `src/mole/dashboardActivity.js` (new, pure, merges existing records) |

## 3. Payload structure

`buildProfilePayload(appKey, discordUserId)` in `src/mole/web.js` is still the one function behind every profile/dashboard route (`/api/profile/me`, `/api/profile/by-wallet`, `/api/profile/public`). It now returns, in addition to the Version 1/2.1 fields:

```
{
  generatedAt: "<ISO timestamp>",
  ...profile, wallets, holdings, discord, quiz, games, geoAgora as before...
  faucet: {
    ...(existing linkedWallet/cooldown fields),
    confirmedClaims, totalConfirmedAmount,   // null if the claim-history fetch failed
    historyOk: boolean,
  },
  proofOfValue: { ok: true, score, tier, breakdown, weights, streakMultiplier, ... } | { ok: false, error },
  milestones:   { ok: true, items: [{id, label, achieved}, ...] } | { ok: false, error },
  recentActivity: { ok: true, items: [{type, label, at, detail}, ...] } | { ok: false, error },
}
```

**Concurrency.** The independent subsystem reads (Discord profile, faucet status, game history, game summary, faucet claim history) now run via `Promise.all` instead of five sequential `await`s — this was a real, measured latency defect the dashboard's performance requirements surfaced (see §5). `holdings` still runs afterward since it depends on the resolved wallet.

**Reused, not re-fetched.** Proof of Value used to call its own `getProofOfValueScore()` wrapper, which internally re-fetched faucet claim history and game summary that `buildProfilePayload` had *already* fetched moments earlier. It's now built via `combineProofOfValue()` directly (the same untouched Version 2.1 scoring function) over data fetched exactly once. `getProofOfValueScore()` itself is untouched and still exported from `proofOfValue.js` as a convenience wrapper for any future caller that doesn't need the shared-fetch path.

## 4. Owner / public boundaries

| Field | Owner | Public | Why |
|---|---|---|---|
| `proofOfValue.score` / `.tier` | ✅ | ✅ | Aggregate number, not detail |
| `proofOfValue.breakdown` / `.weights` | ✅ | ❌ | Component-level detail — already the Version 2.1 rule, unchanged |
| `quiz.accuracy` / `.currentStreak` / `.bestStreak` / `.rank` | ✅ | ✅ | Explicitly listed as public quiz statistics |
| `faucet.cooldownReady` / `.nextClaimAt` / `.readyInMs` | ✅ | ❌ | Explicitly listed as owner-only ("faucet cooldown") — **this is a tightening**: the public payload previously exposed `cooldownReady` as a boolean; that's been removed |
| `faucet.registeredForAirdrops` | ✅ | ✅ | An intent flag, not timing/activity detail |
| `milestones.items` | ✅ | ✅ | Derived booleans — badges are meant to be seen |
| `recentActivity.items` | ✅ | ❌ | Explicitly listed as owner-only ("recent private activity") |
| `governance` (added 2026-07-20, Governance Module v1) | ✅ | ❌ | `myVotes` inside it carries the owner's own private vote choices — `buildPublicProfilePayload()` never copies this key at all (omission, same pattern as `recentActivity`), not just a filtered subset |

Nothing new exposes session tokens, Discord OAuth internals, challenge records, IPs, device identifiers, or internal error stack traces — `proofOfValue.error`/`milestones.error`/`recentActivity.error` (owner-only) carry only `err.message`, matching the pattern already established and accepted in Version 2.1.

## 10. Governance summary (added 2026-07-20)

`buildProfilePayload()` now also returns a `governance` field: `{ ok, eligible, eligibilityReason, activeCount, votableProposals, closingSoon, recentlyCompleted, myVotes }`. It's built by `buildGovernanceSnapshot()` plus a call to the shared `resolveGovernanceEligibility()` — the exact same function `/api/governance/*` uses, not a second implementation. Only a summary is shown on the Dashboard (per `docs/governance-v1.md`'s Deliverable 12 — "do not turn the Dashboard into the full Governance page"); the full proposal list, detail, and voting UI live at `/governance/`.

## 5. Failure handling

- **Faucet claim history** (`getClaimHistoryForUser`) is the one new call in the concurrent batch that can genuinely reject (a real Mongo failure) — it's wrapped in its own `.catch()`, converting a rejection into `{ok:false, error}` instead of taking down the whole `Promise.all` (and with it, quiz/games/holdings/wallets).
- If that fetch fails, **Proof of Value and Milestones both report `{ok:false}`** rather than silently treating the faucet component as zero — a partial PoV score built on a hidden zero would be worse than an honest "unavailable," consistent with the Version 2.1 principle of never faking a zero on failure.
- **Recent Activity degrades independently** — it's a best-effort list merge, not a score, so a faucet outage just means faucet items are missing from the feed, not that the whole feed disappears.
- `getDiscordProfileForUser`, `getLiveHoldingsSnapshot`, `listRewardClaims`, and `getRewardSummary` were already self-contained (internal try/catch, never throw, never fake a zero) before this milestone — confirmed by reading each definition, not assumed.
- `buildFaucetSnapshot()`'s cooldown fetch (`getStatusForUser`) is wrapped the same way, but with an extra guard caught during review: its first draft defaulted a failure to `blocked: false` — silently claiming the faucet was *ready* when the real answer was unknown, exactly the "false answer instead of an honest unavailable" mistake this milestone is meant to avoid elsewhere. Fixed by adding `cooldownStatusOk: boolean` to the returned object; the dashboard shows "Unavailable right now" for the cooldown row when it's false instead of a possibly-wrong "Ready now".

## 6. A real bug found and fixed while building this (not new scope)

`buildFaucetSnapshot()`'s cooldown/last-claim fields were being read from the legacy v2 `faucet_claims.json` file. That file is only ever *read* once at boot for a one-time migration (`migrateLegacyV2IfNeeded`, see `claimStore.js`) — both the Discord and web faucet adapters have exclusively written through `claimStore.js`'s v3 store (via `claimFaucet()` in `service.js`) since that migration shipped. This means the dashboard's "next eligibility / cooldown status" field — explicitly required by this milestone — would have been silently stale for any claim made after the migration. Confirmed via `grep` that no code writes to `faucet_claims.json` anymore. Fixed by switching `buildFaucetSnapshot()` onto `getStatusForUser()` (the v3 store, the actual source of truth), keeping the exact same output field names so no frontend consumer needed to change. This was a pre-existing bug the dashboard's own requirements exposed, not a tangential refactor — see the project's standing instruction not to revisit prior work "unless it exposes a confirmed integration defect."

## 7. Data sources, one by one

- **Wallet**: `wallets.primaryWallet` etc. — unchanged from Version 1.
- **Verification**: `getWalletVerificationStatus()` — unchanged from Version 1.
- **Proof of Value**: `combineProofOfValue()` — Version 2.1, untouched.
- **Quiz**: lifetime points/wins/cycles — Version 1. Accuracy/streak — `quizDb.getUserPlatformStats()`, only accurate since that feature shipped (pre-existing users show `accuracy: null`, not a fabricated 0%, if nothing's been tracked — see `src/quiz/db.js`'s own comment on the backfill gap). Rank — new `getUserRank()`.
- **Faucet**: cooldown/last-claim — now `getStatusForUser()` (v3). Confirmed claim count/total distributed — `getClaimHistoryForUser()` (Version 2.1, extended with `totalConfirmedAmount` here).
- **Games**: claim count/payout/most-recent/per-game breakdown — `getRewardSummary()`/`listRewardClaims()`, unchanged from Version 1.
- **Milestones**: `computeMilestones()` — six deterministic badges (Wallet Verified, First Quiz Completed, First Faucet Claim, First Game Reward, Proof of Value Contributor Tier+, two quiz-point thresholds). No new achievements storage.
- **Recent activity**: `buildRecentActivity()` — merges confirmed faucet claims, game reward claims, and quiz redemptions (all pre-existing records) into one sorted, capped list.

## 8. Known limitations

- **No verification or profile-edit events in Recent Activity.** Neither system keeps a history of past events — `walletLink.js` only stores the current `verified_at`/`expires_at`, and `profilePrefs.js` doesn't timestamp edits. Building that would mean adding new event storage, explicitly out of scope for this milestone. The feed only ever shows faucet/game/quiz events.
- **Quiz accuracy/streak are scoped to tracked activity, not lifetime.** Per-platform tracking (`src/quiz/platform-stats.js`) started at zero for every pre-existing user when that feature shipped — a long-time player's accuracy can legitimately show "not enough tracked data" despite thousands of lifetime points. This is the same honest-null choice Version 2.1 already made for the Proof of Value quiz component.
- **Games component of Proof of Value / the reward-claim count is capped at 100** by a pre-existing, unrelated clamp inside `listRewardClaims()` (`Math.min(100, limit)`), not something this milestone changed.
- **Route/payload-level integration tests were not added.** `buildProfilePayload()`/`buildPublicProfilePayload()` were briefly exported for direct testing, then reverted: importing `src/mole/web.js` (or even just `src/lib/mongo.js` in isolation) in this sandbox takes anywhere from ~15s to 45s+ and is not reliably bounded — traced to the `mongodb` npm package's own top-level import cost, not anything in this project's code. Building automated tests on a foundation that inconsistently exceeds any reasonable timeout would produce a flaky suite, so this was deliberately not done. Coverage instead comes from: pure-function tests for every new piece of logic (`milestones.js`, `dashboardActivity.js`, `getUserRank`, `getClaimHistoryForUser`'s `totalConfirmedAmount`), a real Playwright walkthrough of the rendered page (nav, mobile layout, console errors — see the test suite and the walkthrough notes below), and manual verification of `buildProfilePayload`'s wiring by direct code review. This also explains why `test/faucet/service.test.mjs` is intermittently slow/flaky in this sandbox (its own 30s `execFileSync` timeout against a fresh-process `mongodb` import) — pre-existing, unrelated to this milestone, reproduced in complete isolation with none of this milestone's code involved.
- **No leaderboard position for faucet or games** — only quiz has an existing leaderboard concept (`topUsers`) to rank against; faucet/games have no equivalent "leaderboard" notion in the product today.

## 9. Future extension points

- If a true unified event log is ever built (Version 2.3+ territory), Recent Activity should read from it instead of merging three separate record types — `buildRecentActivity()`'s input shape would need to change, but its consumers (the dashboard payload, the frontend renderer) would not.
- If verification/profile-edit history is added, they slot into `dashboardActivity.js` as two more item-source functions, same pattern as `faucetActivityItems`/`gameActivityItems`/`quizActivityItems`.
- `milestones.js`'s thresholds are plain exported constants — safe to tune without touching the scoring/rendering code.
