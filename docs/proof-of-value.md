# Proof of Value — Version 2.1

Date: 2026-07-11
Scope: a unified, informational participation score computed across the four systems that already track user activity — Quiz, Faucet, Games, Wallet Verification.

## 1. What it is

A single 0–100 score (plus a tier label) that reflects how much a member has participated across the whole WinLEW ecosystem, not just one system in isolation. It is **purely informational**: it never reads or writes any payout-eligible field (quiz points/cycles, faucet claim reservations, game payouts), and no other system reads it back — nothing is gated on it. It exists to be displayed, not to decide anything.

It is **computed on read**, not persisted. There is no `proofOfValue` field stored anywhere; every request rebuilds it from live data in the four source systems. This was a deliberate choice over maintaining a synced/cached score field, specifically so it can never drift out of sync with the systems that feed it.

## 2. The four inputs and their weights

Balanced 25% each, defined in `POV_WEIGHTS` in `src/mole/proofOfValue.js`:

| Component | Signal used | Where it comes from |
|---|---|---|
| Quiz | Lifetime points | `src/quiz/db.js` (`getUser`) — the same payout-eligible total the quiz leaderboard uses, read-only |
| Faucet | Confirmed claim count | `src/faucet/claimStore.js` (`getClaimHistoryForUser`, new in this milestone) |
| Games | Total reward claims | `src/mole/rewardHistory.js` (`getRewardSummary`, pre-existing) |
| Wallet verification | Verified / previously-verified / never-linked | `src/mole/walletLink.js` (`getLinkedWalletRecord` + `getWalletVerificationStatus`, pre-existing) |

Each component maps its raw signal to a 0–100 sub-score via `sqrtScale(value, cap)` — square-root scaling against a cap constant (`CAPS` in `proofOfValue.js`), so the first units of participation matter most and no one is hard-capped out of the score once they cross the threshold. The four sub-scores are combined with `POV_WEIGHTS` into a `baseScore`.

### v2.4 retune (2026-07-19): the bar was too low

The owner reached the top tier (Legend) within their first week — the original caps
(`5000` quiz points / `30` faucet claims / `50` game claims, Legend at score 80) measured
"showed up," not sustained value, and the free 25 base points from verification plus a
one-session ×1.15 streak did the rest. Retuned:

| Constant | v1 | v2.4 | What 100/100 now takes |
|---|---|---|---|
| `quizLifetimePoints` | 5,000 | 25,000 | months of regular quiz play |
| `faucetConfirmedClaims` | 30 | 150 | ~5 months of daily claims (cooldown-gated) |
| `gameClaims` | 50 | 300 | months of Gaming Hub sessions |
| Tier floors | 80/60/40/20 | 90/70/45/20 | Legend is now the long-haul badge |
| Streak bonus | +15% max, 1%/answer | +10% max, 0.5%/answer | a 20-answer streak, not a lucky session |

The sqrt curve itself is unchanged on purpose — early participation should still feel
rewarding; it's the top that needed to move. A strong first week now lands mid-Contributor
(~45-55) instead of Legend.

Verification does not use `sqrtScale` — it is a fixed three-step function (`verificationSubScore`): 100 if currently verified, 40 if a wallet was verified before but has since expired (partial credit — the work was done once), 0 if never linked.

## 3. Streak multiplier

A small bonus (up to +10% as of v2.4, `STREAK_MAX_BONUS`) is applied on top of `baseScore`, sourced from the quiz system's `currentStreak` (max of Discord/web platform buckets — see `src/quiz/platform-stats.js`). This is a deliberate v1 scope choice, not an oversight: quiz is the only system that tracks a genuine consecutive-participation streak today. If a future system (faucet daily-claim streak, a cross-platform login streak, etc.) adds one, `computeStreakMultiplier` is the single place to extend.

The final `score = round(min(100, baseScore * streakMultiplier))` — clamped so the multiplier can never push a score over 100.

## 4. Why quiz accuracy isn't part of the quiz sub-score

`src/quiz/db.js` documents that per-platform stats (`user.platforms.discord/web`, including accuracy) intentionally start at zero for every pre-existing user as of the platform-stats feature shipping — there's no backfill of *which* platform earned a user's historical points. Weighting accuracy into the quiz component would have silently zeroed it out for every long-time player who accumulated points before that feature existed, while correctly scoring new players. Lifetime points alone avoids that trap and is available for every user regardless of when they joined.

## 5. Known v1 limitations

- **Games component caps at 1,000 claims** (was 100 — fixed in the v2.4 retune, exactly the trap this note warned about). `getRewardSummary` now calls `listRewardClaims(id, 1000)` and the clamp in `rewardHistory.js` was raised to match, so the new `CAPS.gameClaims = 300` can actually be reached. A user with more than 1,000 claims would still be counted from their most recent 1,000 — far past the sqrt ceiling, so harmless.
- **Verification has no tenure signal.** `verified_at` in `walletLink.js` is overwritten on every re-verification (it's "most recently verified," not "first ever verified") — there is no persisted first-verification timestamp anywhere. The verification component therefore rewards *current* status, not *how long* someone has been verified.
- **The streak multiplier is quiz-only** (see §3) — not a cross-ecosystem consistency signal yet, by design.

## 6. Where it's surfaced

No new page or endpoint was added. `buildProfilePayload` in `src/mole/web.js` (already the single function behind every profile route) now includes a best-effort `proofOfValue` block — `{ok:false, error}` on failure rather than throwing, so a Proof of Value failure never breaks the rest of the profile page (same honest-failure pattern used by the Transparency Center's `/api/transparency/status`).

- **Owner view** (`/verify/profile.html` with a session): full score, tier, per-component breakdown, and weights.
- **Public view** (`/verify/profile.html?wallet=...&public=1`): score and tier only — `buildPublicProfilePayload` deliberately strips the breakdown, matching the pattern already used for wallets/faucet detail on that payload (aggregate numbers are shared, underlying detail is not).

## 7. Testing

- `test/mole/proofOfValue.test.mjs` — pure-function tests against `combineProofOfValue`, `sqrtScale`, `tierForScore`, `verificationSubScore`, `computeStreakMultiplier`. No I/O, matching `src/quiz/platform-stats.js`'s existing test convention of testing the scoring math independent of storage.
- `test/faucet/claimStore.test.mjs` — two new tests for `getClaimHistoryForUser` (empty-history shape, correct per-user filtering and confirmed/total counting).
- A live smoke test (not checked in — run manually against `src/quiz/data/db.json`) confirmed `getProofOfValueScore` produces correct results end-to-end against real stored data, not just synthetic inputs.
