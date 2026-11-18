// HODL participation counter (owner policy 2026-11-13).
//
// activeDays = the number of DISTINCT UTC calendar days, within the 7 complete UTC
// days before the snapshot day, on which a verified identity did at least one of:
//   - a CONFIRMED faucet claim        (claim.createdAt, server time)
//   - a validated game reward claim   (claimedAt, server time; the one-off
//                                      "migration" credit is not play and does not count)
//   - a web quiz answer               (the quiz's own server-side UTC day log)
//   - a /mole checkin                 (hodl_checkins.json, server time only)
// Several activities on one day are one day. Nothing here creates a reward or a
// reward record; it only feeds `activeDays` into hodlEpochs' balance-rate table.
//
// Replay safety: every source is a server-written timestamp or server UTC day
// key, filtered to the window, so an old activity can only count for the week it
// actually happened in. Missing a day costs that day only.
const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayKey(msOrIso) {
  const ms = typeof msOrIso === "number" ? msOrIso : Date.parse(msOrIso || "");
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The 7 complete UTC days before the snapshot's UTC day: [startMs, endMs). */
export function activeDaysWindow(snapshotAtMs) {
  const d = new Date(snapshotAtMs);
  const endMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { startMs: endMs - 7 * DAY_MS, endMs };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: count distinct UTC days in the window, and say which sources contributed. */
export function countActiveDays({ faucetClaims = [], gameClaims = [], quizDaily = {}, checkinDays = [] } = {}, { startMs, endMs }) {
  const inWindowKey = (key) => {
    if (!key || !DAY_KEY.test(key)) return false;
    const ms = Date.parse(`${key}T00:00:00Z`);
    return Number.isFinite(ms) && ms >= startMs && ms < endMs;
  };
  const bySource = { faucet: new Set(), games: new Set(), quiz: new Set(), checkin: new Set() };

  for (const c of faucetClaims) {
    if (c?.status !== "confirmed") continue;
    const k = utcDayKey(Number(c.createdAt));
    if (inWindowKey(k)) bySource.faucet.add(k);
  }
  for (const r of gameClaims) {
    if (!r || r.game === "migration") continue;
    const k = utcDayKey(r.claimedAt);
    if (inWindowKey(k)) bySource.games.add(k);
  }
  for (const [k, n] of Object.entries(quizDaily || {})) {
    if (Number(n) > 0 && inWindowKey(k)) bySource.quiz.add(k);
  }
  for (const k of checkinDays) if (inWindowKey(k)) bySource.checkin.add(k);

  const days = new Set([...bySource.faucet, ...bySource.games, ...bySource.quiz, ...bySource.checkin]);
  return {
    activeDays: Math.min(7, days.size),
    days: [...days].sort(),
    bySource: Object.fromEntries(Object.entries(bySource).map(([s, set]) => [s, [...set].sort()])),
  };
}

/**
 * Build a getActiveDays(discordUserId) for gatherIdentities from injected readers,
 * so the scripts pass the real stores and tests pass fixtures.
 *
 * A reader that fails is NOT silently treated as "no activity": that would pay
 * the person a lower rate than they earned. The count still uses what could be
 * read, but `errors` names every source that failed, so the preview shows it
 * and hodl-pay refuses to build a payout from an incomplete count.
 * `globalErrors` (e.g. a failed check-in refresh) is added to every result.
 */
export function makeActiveDaysReader({ snapshotAtMs = Date.now(), readFaucetClaims, readGameClaims, readQuizDaily, readCheckinDays, globalErrors = [] } = {}) {
  const window = activeDaysWindow(snapshotAtMs);
  return async (discordUserId) => {
    const errors = [...globalErrors];
    const read = async (source, fn, fallback) => {
      try { return (await fn?.()) ?? fallback; } catch (error) {
        errors.push(`${source}: ${error?.message || "read_failed"}`);
        return fallback;
      }
    };
    const [faucetClaims, gameClaims, quizDaily, checkinDays] = await Promise.all([
      read("faucet", () => readFaucetClaims?.(discordUserId), []),
      read("games", () => readGameClaims?.(discordUserId), []),
      read("quiz", () => readQuizDaily?.(discordUserId), {}),
      read("checkin", () => readCheckinDays?.(discordUserId), []),
    ]);
    return { ...countActiveDays({ faucetClaims, gameClaims, quizDaily, checkinDays }, window), errors };
  };
}
