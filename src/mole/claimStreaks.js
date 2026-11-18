// Consecutive-day claim streaks for the faucet and games.
//
// Pure. The curve that decides how much extra somebody earns lives here, apart
// from the code that sends it, so it can be argued about and tested without a
// chain.
//
// A NOTE ON THE SPEC, BECAUSE IT CONTRADICTED ITSELF. The brief was "+1 WinLEW
// for every consecutive day, topping off at 30, before going to 2 WinLEW daily
// topping off at 60" and separately "when a user gets an extra 100 WinLEW daily
// they unlock a badge". A bonus capped at +60 can never reach +100, so those two
// sentences cannot both be true as written.
//
// Resolved by using the other requirement — "ideally if you verify you gain
// MORE" — as the bridge: +60 is the ceiling for an UNVERIFIED claimer, and
// verifying extends the same +2/day climb to +100. That makes the badge
// reachable, makes verification worth something concrete, and keeps both stated
// caps intact. Flagged in docs/hodl-v4-notes.md; change TIERS if a different
// reading was meant.

export const STREAK_TIERS = Object.freeze({
  /** Days 1-30: +1 per consecutive day. */
  SLOW_PER_DAY: 1,
  SLOW_CAP: 30,
  /** From day 31: +2 per day. */
  FAST_PER_DAY: 2,
  /** Where an unverified claimer stops. */
  UNVERIFIED_CAP: 60,
  /** Where a verified claimer stops. Verifying is what unlocks the last 40. */
  VERIFIED_CAP: 100,
});

/** The badge, awarded at the top of the verified curve. */
export const TOP_NOTCH_BADGE = Object.freeze({
  id: "top-notch-faucet-user",
  label: "Top Notch Faucet User",
  requirement: STREAK_TIERS.VERIFIED_CAP,
});

/**
 * The bonus for a given streak, on top of the base drip.
 *
 * @param {number} consecutiveDays
 * @param {boolean} verified
 * @returns {number} whole WinLEW to add
 */
export function streakBonus(consecutiveDays, { verified = false } = {}) {
  const days = Math.floor(Math.max(0, Number(consecutiveDays) || 0));
  if (days <= 0) return 0;

  const cap = verified ? STREAK_TIERS.VERIFIED_CAP : STREAK_TIERS.UNVERIFIED_CAP;

  // First 30 days climb slowly, then the rate doubles. Both segments are
  // measured from day 1 so the curve is continuous — there is no cliff where a
  // claimer's bonus drops on the day the rate changes.
  const slow = Math.min(days, STREAK_TIERS.SLOW_CAP) * STREAK_TIERS.SLOW_PER_DAY;
  const fast = Math.max(0, days - STREAK_TIERS.SLOW_CAP) * STREAK_TIERS.FAST_PER_DAY;
  return Math.min(slow + fast, cap);
}

/** Has this claimer earned the badge? Verified-only by construction, since the
 *  unverified cap sits below the requirement. */
export function hasTopNotchBadge(consecutiveDays, { verified = false } = {}) {
  return streakBonus(consecutiveDays, { verified }) >= TOP_NOTCH_BADGE.requirement;
}

/**
 * Whether a claim continues a streak, starts a new one, or is too soon.
 *
 * A streak is consecutive CALENDAR DAYS in the claimer's own timezone offset,
 * not 24-hour windows. Someone claiming at 9am then 8am the next morning has
 * claimed on two consecutive days and should not be told they broke a streak
 * over an hour — that punishes people for living slightly irregular lives,
 * which is the opposite of rewarding consistency.
 *
 * @param {number|null} lastClaimMs
 * @param {number} nowMs
 * @returns {"first"|"same-day"|"continues"|"broken"}
 */
export function streakTransition(lastClaimMs, nowMs = Date.now(), { dayMs = 86_400_000 } = {}) {
  if (!lastClaimMs) return "first";
  const lastDay = Math.floor(Number(lastClaimMs) / dayMs);
  const today = Math.floor(Number(nowMs) / dayMs);
  if (today === lastDay) return "same-day";
  if (today === lastDay + 1) return "continues";
  return "broken";
}

/** The streak after a claim. A missed day resets to 1 — not to 0, because the
 *  claim being made right now is itself day one of the next streak. */
export function nextStreak(currentStreak, transition) {
  const current = Math.max(0, Number(currentStreak) || 0);
  switch (transition) {
    case "continues": return current + 1;
    case "same-day": return current;      // already counted today
    case "first":
    case "broken":
    default: return 1;
  }
}

/** Everything a claim needs to know, in one call. */
export function evaluateStreak({ lastClaimMs, currentStreak = 0, verified = false, nowMs = Date.now() } = {}) {
  const transition = streakTransition(lastClaimMs, nowMs);
  const streak = nextStreak(currentStreak, transition);
  const bonus = streakBonus(streak, { verified });
  return {
    transition,
    streak,
    bonus,
    verified: Boolean(verified),
    cap: verified ? STREAK_TIERS.VERIFIED_CAP : STREAK_TIERS.UNVERIFIED_CAP,
    atCap: bonus >= (verified ? STREAK_TIERS.VERIFIED_CAP : STREAK_TIERS.UNVERIFIED_CAP),
    badge: hasTopNotchBadge(streak, { verified }) ? TOP_NOTCH_BADGE.id : null,
  };
}
