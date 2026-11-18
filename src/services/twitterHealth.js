/**
 * Failure classification and circuit breaker for the X (Twitter) API.
 *
 * WHY THIS EXISTS
 *
 * The tweet watcher in src/faucet/bot.js ran hourly with nothing but
 * `catch (e) { console.error(...) }`. When the X API account ran out of
 * credits it began returning 402 on every call, so the watcher stopped
 * announcing tweets and told nobody — it wrote a line to a log file once an
 * hour and carried on burning a request each time. Found 2026-08-16, by
 * probing the API by hand rather than by any alarm.
 *
 * A failing integration that reports nothing is worse than one that is
 * switched off, because you keep believing it works.
 *
 * This is a deliberate mirror of src/services/claude.js, which solved exactly
 * this shape of problem for the Anthropic API (a paid dependency that goes
 * quiet when the balance empties). Same vocabulary, same fatal/transient
 * split, same park-and-log-once behaviour — with one addition: a fatal state
 * is announced to Discord, because the whole failure here was that a human
 * never found out.
 */

/**
 * Why X said no, in one line a moderator can act on.
 *
 * `fatal` marks a state that will keep failing until a human changes something
 * — billing, credentials, permissions. Retrying those just burns requests
 * against a quota that is already the problem. Everything else is transient
 * and worth trying again on the next tick.
 *
 * twitter-api-v2 puts the HTTP status on `.code`, but plain fetch-style errors
 * carry `.status`, and callers sometimes hand us the response object itself.
 * Read all three rather than assuming one shape.
 */
export function describeTwitterError(error) {
  const status = Number(error?.code ?? error?.status ?? error?.response?.status) || null;
  const detail = String(
    error?.data?.detail || error?.data?.title || error?.detail || error?.message || ""
  ).trim();

  if (status === 402 || /credits?[ _-]?depleted|payment required/i.test(detail)) {
    return {
      fatal: true,
      code: "no_credit",
      summary:
        "X API credits are depleted — every request is returning 402 Payment Required. " +
        "This is the X developer account's own balance; a paid X/Premium subscription on " +
        "the @account does not fund it. Top up or change tier in the X Developer Portal " +
        "(developer.x.com → your project → Billing).",
    };
  }
  if (status === 401) {
    return { fatal: true, code: "bad_token", summary: "TWITTER_BEARER_TOKEN was rejected — invalid, revoked, or regenerated without updating .env." };
  }
  if (status === 403) {
    return { fatal: true, code: "no_access", summary: `X API access denied${detail ? ` — ${detail}` : "."} The app's tier may not include this endpoint.` };
  }
  if (status === 429) {
    return { fatal: false, code: "rate_limited", summary: "Rate limited by the X API." };
  }
  if (status && status >= 500) {
    return { fatal: false, code: "api_error", summary: `X API error (${status}).` };
  }
  return { fatal: false, code: "unknown_error", summary: detail || "X API request failed." };
}

/**
 * Circuit breaker.
 *
 * Longer default cooldown than claude.js's 30 minutes because the watcher is
 * hourly: a 30-minute park would expire before every single tick and defeat
 * the purpose. Six hours means a billing outage costs four probe requests a
 * day instead of twenty-four, while still recovering on its own once the
 * account is topped up — no restart needed.
 */
const COOLDOWN_MS = Math.max(60_000, Number(process.env.TWITTER_FAILURE_COOLDOWN_MS) || 6 * 60 * 60_000);

let paused = null;
let lastError = null;

/**
 * Record a failure. Returns `{ fatal, code, summary, firstOccurrence }`.
 *
 * `firstOccurrence` is true only when the state CHANGES, so the caller can
 * alert once per outage rather than once per tick. That distinction is the
 * entire point: an hourly alert is noise people mute, and a muted alert is the
 * same as no alert.
 */
export function noteTwitterFailure(error) {
  const described = describeTwitterError(error);
  lastError = { ...described, at: new Date().toISOString() };
  if (!described.fatal) return { ...described, firstOccurrence: false };

  const firstOccurrence = !paused || paused.code !== described.code;
  paused = { ...described, until: Date.now() + COOLDOWN_MS };
  if (firstOccurrence) {
    console.error(
      `[TWITTER] ${described.summary} Polling is parked for ` +
        `${Math.round(COOLDOWN_MS / 3_600_000)}h; it will retry automatically.`
    );
  }
  return { ...described, firstOccurrence };
}

/** Call after any successful request so the breaker closes on its own. */
export function noteTwitterSuccess() {
  if (paused) {
    console.log("[TWITTER] X API is responding again — resuming the tweet watcher.");
    paused = null;
  }
  lastError = null;
}

/** Current pause state, or null when X is usable. */
export function getTwitterPause() {
  if (paused && Date.now() >= paused.until) paused = null;
  return paused;
}

/** Gate polling on this. */
export function isTwitterAvailable() {
  return !getTwitterPause();
}

/** Health-surface snapshot. Safe to serialise — carries no token. */
export function getTwitterHealth() {
  const pause = getTwitterPause();
  return {
    ok: !pause,
    parked: Boolean(pause),
    code: pause?.code || lastError?.code || null,
    summary: pause?.summary || lastError?.summary || null,
    retryAt: pause ? new Date(pause.until).toISOString() : null,
  };
}

/** Test seam — resets module state between cases. */
export function _resetTwitterHealth() {
  paused = null;
  lastError = null;
}
