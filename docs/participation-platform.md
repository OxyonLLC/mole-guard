# Participation Platform — Version 2.3

Date: 2026-07-15
Scope: give the Dashboard honest reasons to come back tomorrow, using only signals the platform already computes. No new scoring engine, no new profile, no new auth flow, no new API routes.

## 1. What this is (and isn't)

Version 2.3 answers "why should I come back tomorrow?" by surfacing information that already exists but wasn't connected together on the Dashboard:

- **Quiz streak** — already computed by Proof of Value (2.1)/the Dashboard (2.2). Just displayed with retention framing.
- **Faucet claim streak** — new: `computeFaucetStreak()` derives a consecutive-day streak from the faucet claim history the Dashboard already fetches. No new storage.
- **This week** — new: `buildWeeklySummary()` filters the same already-fetched faucet/game records to the last 7 days.
- **Progress to the next Proof of Value tier** — new: `tierProgress()`, added to `proofOfValue.js` itself, reusing the exact same `TIERS` thresholds `tierForScore()` already uses.
- **Progress to the next milestone** — existing `milestones.js` items gained a `progress` (0..1) field, computed from the same raw values that already decide `achieved`. `closestUnachievedMilestone()` picks the single most-relevant one.

**Explicitly not built**: a points/XP system, a mission board, notifications/reminders (no email or push infrastructure exists anywhere in this codebase — confirmed by inspection, not assumed; per the brief's own "if infrastructure already exists" condition, this was skipped rather than built from scratch), or any second scoring concept. Proof of Value v1 remains the only participation score.

## 2. Where the numbers come from (and where they deliberately don't)

| Signal | Source | Why this and not something else |
|---|---|---|
| Quiz current streak | `quiz.currentStreak` (already in the Dashboard payload since 2.2) | No new computation |
| Faucet claim streak | `computeFaucetStreak()` over `faucetHistoryResult.data.claims` (already fetched for Proof of Value/Recent Activity) | Same records, new lens: consecutive UTC calendar days with a confirmed claim |
| This week — faucet | `buildWeeklySummary()`, same claims array, filtered to `createdAt >= now - 7d` | Real per-claim timestamps exist, so this is an honest window |
| This week — games | `buildWeeklySummary()`, `gameHistory` (already fetched), filtered by `claimedAt` | Same reasoning |
| This week — quiz | **Not included.** | Quiz has no per-answer timestamp log — only a single `lastActiveTs` per platform bucket. A "quiz points this week" number would have to be estimated or fabricated. Rather than do that, quiz's already-correct "current cycle" figures (shown elsewhere on the Dashboard) are left as the honest answer to "how much quiz have I done lately." |
| Next PoV tier progress | `tierProgress(povScore)` | Reuses `proofOfValue.js`'s own `TIERS` array — cannot drift from what tier a score actually lands in, because it's the same threshold list |
| Next milestone | `closestUnachievedMilestone(milestones.items)` | Only surfaces a milestone if something has genuine partial progress (`progress > 0`); returns `null` rather than inventing a "closest" one when nothing has started |

## 3. Product philosophy, applied concretely

The brief asked for encouragement without manipulation. Concrete decisions that follow from that:

- **No streak-loss framing.** `computeFaucetStreak()`'s doc comment and the UI copy both avoid "don't lose your streak!" language — the streak count itself already communicates momentum; adding urgency copy on top of it would cross into manipulative-notification territory.
- **`closestUnachievedMilestone()` returns `null`, not a forced suggestion.** A user with zero partial progress anywhere (e.g. someone who has only ever done one thing) gets no "closest milestone" nudge at all, rather than an arbitrary one being manufactured to fill the space.
- **The faucet-fetch-failure case never shows a fake "0-day streak."** If `getClaimHistoryForUser` fails, `participation.faucetDataOk` is `false` and the UI shows "Unavailable right now" for the streak/weekly-faucet fields specifically — a `0` here would read as "you have no streak," which is a false claim about the user, not just a missing number.
- **No new engagement mechanics** (badges-for-clicking, countdown timers, points-for-visiting) — every number shown already meant something before this milestone; 2.3 only decided which of those numbers deserve a "keep going" framing on the Dashboard.

## 4. Payload structure

`buildProfilePayload()` gained one new top-level field:

```
participation: {
  ok: true,
  faucetDataOk: boolean,        // false only if the faucet claim-history fetch itself failed
  faucetStreak: { currentStreakDays, claimedToday },
  weeklySummary: { windowDays: 7, faucetClaimCount, faucetAmount, gameClaimCount, gamePayout },
  quizCurrentStreak: number,
  povTierProgress: { tier, nextTier, pointsToNextTier } | null,
  nextMilestone: { id, label, achieved: false, progress } | null,
} | { ok: false, error }
```

**Owner-only.** `participation` is not included in `buildPublicProfilePayload()` at all — personal momentum/streak information about a user is not something a public profile viewer needs, matching the same reasoning already applied to Recent Activity in Version 2.2.

**No duplicate fetches.** Every input (`faucetHistoryResult.data.claims`, `gameHistory`, `quiz.currentStreak`, the already-computed `proofOfValue`/`milestones` results) was already being fetched/computed earlier in `buildProfilePayload()` for other sections. `participation` is pure post-processing over data already in hand.

## 5. New files

- `src/mole/participation.js` — `computeFaucetStreak()`, `buildWeeklySummary()`, `closestUnachievedMilestone()`. Pure, no I/O, mirrors `milestones.js`/`dashboardActivity.js`'s Version 2.2 pattern.
- `proofOfValue.js` gained one new export, `tierProgress()` — no change to any existing scoring function.
- `milestones.js`'s `computeMilestones()` gained a `progress` field per item (and a `povScore` parameter to compute it for the Proof-of-Value-tier milestone) — `achieved` logic is completely unchanged.

## 6. A bug found and fixed while building this

`computeFaucetStreak()`'s first draft trusted its caller to pass only confirmed claims (matching its parameter name at the time, `confirmedClaims`). It didn't actually filter by `status === 'confirmed'` itself, unlike `buildWeeklySummary()` (in the same file) and `summarizeClaimHistory()` (`claimStore.js`, Version 2.1), both of which do their own filtering rather than trusting callers. A dedicated test caught this immediately (a reserved/failed claim was incorrectly extending the streak). Fixed by filtering inside the function, matching the established pattern in this codebase of aggregate functions being self-contained rather than trusting pre-filtered input.

## 7. Full product review

Walked the platform end to end (desktop + mobile, owner + public view) with Playwright while building this milestone: zero console errors, zero unexpected 404s, no horizontal overflow at 390/768/1440px, and the new "Keep going"/"This week" cards are correctly hidden in public view. No unrelated friction was found during this pass worth logging beyond what Version 2.2's report already noted (the pre-existing `test/faucet/service.test.mjs` flakiness, and `src/public/discord-bots/index.html`'s pre-existing unrelated whitespace diff — both still present, still out of scope here).

## 8. Known limitations / future extension points

- **Faucet streak resets are visible, not celebrated or mourned.** There is no "your streak reset" notification — the number simply reflects reality on next load. If a gentler re-engagement message is wanted later, it would read the same `faucetStreak` data, not require new computation.
- **No daily check-in reminder system.** Would require building new notification infrastructure (push, email, or a Discord DM bot flow) — explicitly out of scope per the brief's own conditional, and a meaningfully larger project than this milestone.
- **Weekly summary window is fixed at 7 days**, not configurable per user — `buildWeeklySummary()`'s `windowMs` parameter already supports changing this without new logic if ever needed.
