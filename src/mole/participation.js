// Version 2.3 — Participation Platform: "why come back tomorrow?" signals,
// computed entirely from data the platform already tracks and already
// fetches for the dashboard (Version 2.2). No new storage, no new scoring
// engine, no new API routes — this is post-processing over records
// buildProfilePayload() already has in hand. See docs/participation-platform.md.
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEK_MS = 7 * DAY_MS;

function utcDayKey(msOrIso) {
  const ms = typeof msOrIso === "number" ? msOrIso : Date.parse(msOrIso || "");
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/**
 * Current consecutive-day faucet claim streak, walking backward from
 * `now`. A day counts if at least one confirmed claim happened in it (UTC
 * calendar day, matching how the rest of the platform reasons about
 * "daily"). Breaks on the first gap. Today not having a claim yet does NOT
 * break the streak (the day isn't over) — it just means today doesn't
 * count *yet*.
 */
export function computeFaucetStreak(claims = [], { now = Date.now() } = {}) {
  const dayKeys = new Set(
    claims
      .filter((c) => c.status === "confirmed")
      .map((c) => utcDayKey(c.createdAt))
      .filter(Boolean)
  );
  if (dayKeys.size === 0) {
    return { currentStreakDays: 0, claimedToday: false };
  }

  const todayKey = utcDayKey(now);
  const claimedToday = dayKeys.has(todayKey);

  let streak = 0;
  let cursor = now;
  if (!claimedToday) cursor -= DAY_MS; // start counting from yesterday instead
  while (dayKeys.has(utcDayKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return { currentStreakDays: streak, claimedToday };
}

/**
 * Rolling last-7-day totals for faucet and game activity — both have real
 * per-event timestamps, so this is an honest window, not an estimate.
 * Quiz is deliberately NOT included here: there is no timestamped
 * per-answer log to filter by date, only a single `lastActiveTs` per
 * platform bucket, so a "quiz points this week" figure cannot be computed
 * without fabricating it (see docs/participation-platform.md). Quiz's own
 * "this cycle" figures are surfaced separately, correctly labeled.
 */
export function buildWeeklySummary({ faucetClaims = [], gameHistory = [] } = {}, { now = Date.now(), windowMs = DEFAULT_WEEK_MS } = {}) {
  const since = now - windowMs;

  const faucetInWindow = faucetClaims.filter((c) => c.status === "confirmed" && Number(c.createdAt || 0) >= since);
  const faucetClaimCount = faucetInWindow.length;
  const faucetAmount = faucetInWindow.reduce((sum, c) => sum + (Number(c.amountDisplay) || 0), 0);

  const gameInWindow = gameHistory.filter((r) => {
    const ms = Date.parse(r.claimedAt || "");
    return Number.isFinite(ms) && ms >= since;
  });
  const gameClaimCount = gameInWindow.length;
  const gamePayout = gameInWindow.reduce((sum, r) => sum + (Number(r.payout) || 0), 0);

  return {
    windowDays: Math.round(windowMs / DAY_MS),
    faucetClaimCount,
    faucetAmount: Number(faucetAmount.toFixed(4)),
    gameClaimCount,
    gamePayout: Number(gamePayout.toFixed(2)),
  };
}

/**
 * Of the milestones NOT yet achieved, the one with the highest progress —
 * "closest to done" for a single, honest "you're close to..." message.
 * Returns null if every milestone is already achieved, or none have
 * meaningful (>0) progress yet.
 */
export function closestUnachievedMilestone(milestoneItems = []) {
  const candidates = milestoneItems.filter((m) => !m.achieved && Number(m.progress || 0) > 0);
  if (!candidates.length) return null;
  return candidates.reduce((best, m) => (Number(m.progress) > Number(best.progress) ? m : best));
}
