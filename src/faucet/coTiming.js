/**
 * Co-timing review — which accounts keep claiming the faucet together.
 *
 * Built 2026-08-01 because the owner spotted three claims inside five minutes
 * by eye. Eyes do not scale and do not remember last week, so this is the same
 * observation made automatically and, more importantly, made across DAYS.
 *
 * The signal is repetition, not proximity. Two people claiming a minute apart
 * once means nothing — a faucet announcement brings a crowd, and everybody
 * claims at once. The same two accounts arriving together on Monday, Thursday
 * and Saturday is a pattern that a coincidence has to work much harder to
 * explain. So a single burst is never reported; only pairs that recur on
 * `minDays` separate days are.
 *
 * This flags for REVIEW and nothing else. It never bans, and it cannot
 * distinguish one person with three wallets from three friends in a group chat
 * who ping each other when the faucet refills — that difference is not visible
 * in timing data, and pretending otherwise would get honest people refused.
 * Pair it with the funding-graph evidence (walletBans.js) and, best of all,
 * with whether the tokens later consolidate into one wallet: people who share
 * a chat keep their own tokens, and one person collecting from three wallets
 * usually does not.
 *
 * Pure functions over claim records — no storage, no RPC, no clock except what
 * is passed in, so the judgement encoded here is testable.
 */

/** Claims closer together than this are treated as one burst. */
export const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/** Separate days a pair must recur on before it is worth a human's attention. */
export const DEFAULT_MIN_DAYS = 2;

/** UTC calendar day, used to decide "a separate day". UTC rather than local
 *  time so the result does not shift with the reviewer's timezone. */
export function dayKey(timestamp) {
  return new Date(Number(timestamp) || 0).toISOString().slice(0, 10);
}

/**
 * Splits claims into bursts of activity. A burst continues while each next
 * claim is within `windowMs` of the one before it, so a steady trickle of
 * claims a few minutes apart stays one burst rather than being cut arbitrarily.
 */
export function groupIntoBursts(claims, { windowMs = DEFAULT_WINDOW_MS } = {}) {
  const sorted = [...claims]
    .filter((c) => c && c.discordUserId && Number.isFinite(Number(c.createdAt)))
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

  const bursts = [];
  let current = [];
  for (const claim of sorted) {
    if (!current.length) { current = [claim]; continue; }
    const previous = current[current.length - 1];
    if (Number(claim.createdAt) - Number(previous.createdAt) <= windowMs) current.push(claim);
    else { bursts.push(current); current = [claim]; }
  }
  if (current.length) bursts.push(current);
  return bursts;
}

/**
 * Pairs of accounts that claimed in the same burst on at least `minDays`
 * separate days, strongest first.
 *
 * Returns for each pair the days it happened, the wallets each account used,
 * and the tightest gap ever observed between them — a pair that is repeatedly
 * seconds apart reads very differently from one that is repeatedly nine
 * minutes apart.
 */
export function findCoTimingPairs(claims, {
  windowMs = DEFAULT_WINDOW_MS,
  minDays = DEFAULT_MIN_DAYS,
} = {}) {
  const bursts = groupIntoBursts(claims, { windowMs });
  const pairs = new Map();

  for (const burst of bursts) {
    // Collapse to one entry per account: somebody claiming twice in a burst is
    // not co-timing with themselves.
    const byUser = new Map();
    for (const claim of burst) {
      const id = String(claim.discordUserId);
      const existing = byUser.get(id);
      if (!existing || Number(claim.createdAt) < Number(existing.createdAt)) byUser.set(id, claim);
    }
    const users = [...byUser.keys()].sort();
    if (users.length < 2) continue;

    for (let i = 0; i < users.length; i += 1) {
      for (let j = i + 1; j < users.length; j += 1) {
        const a = byUser.get(users[i]);
        const b = byUser.get(users[j]);
        const key = `${users[i]}|${users[j]}`;
        const gapMs = Math.abs(Number(a.createdAt) - Number(b.createdAt));
        const day = dayKey(Math.min(Number(a.createdAt), Number(b.createdAt)));

        const entry = pairs.get(key) || {
          accounts: [users[i], users[j]],
          wallets: { [users[i]]: new Set(), [users[j]]: new Set() },
          days: new Set(),
          burstCount: 0,
          tightestGapMs: Infinity,
          lastSeenAt: 0,
        };
        if (a.wallet) entry.wallets[users[i]].add(a.wallet);
        if (b.wallet) entry.wallets[users[j]].add(b.wallet);
        entry.days.add(day);
        entry.burstCount += 1;
        entry.tightestGapMs = Math.min(entry.tightestGapMs, gapMs);
        entry.lastSeenAt = Math.max(entry.lastSeenAt, Number(a.createdAt), Number(b.createdAt));
        pairs.set(key, entry);
      }
    }
  }

  return [...pairs.values()]
    .filter((entry) => entry.days.size >= minDays)
    .map((entry) => ({
      accounts: entry.accounts,
      wallets: {
        [entry.accounts[0]]: [...entry.wallets[entry.accounts[0]]],
        [entry.accounts[1]]: [...entry.wallets[entry.accounts[1]]],
      },
      days: [...entry.days].sort(),
      dayCount: entry.days.size,
      burstCount: entry.burstCount,
      tightestGapMs: entry.tightestGapMs === Infinity ? null : entry.tightestGapMs,
      lastSeenAt: entry.lastSeenAt,
    }))
    // Most days together first; ties broken by who arrives closest together.
    .sort((x, y) => y.dayCount - x.dayCount || (x.tightestGapMs ?? Infinity) - (y.tightestGapMs ?? Infinity));
}

/** "3m 20s" / "45s", for a Discord line. */
export function formatGap(ms) {
  if (ms === null || ms === undefined) return 'n/a';
  const seconds = Math.round(Number(ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
