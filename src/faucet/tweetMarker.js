// Where the "last tweet posted to Discord" marker should move to.
//
// Pure, and separate from bot.js, because the rule is easy to state and easy to
// get wrong in a way nobody notices for weeks — this module exists so the rule
// has tests instead of a comment.
//
// THE TWO FAILURE MODES, both of which have actually happened here:
//
//   LOST — the marker advances past tweets that were never delivered. The
//   original loop did this: with no webhook configured it skipped every tweet
//   and then marked them all seen, so announcements vanished permanently and
//   the watcher reported nothing wrong.
//
//   REPEATED — the marker refuses to advance at all after any failure. The fix
//   for "lost" introduced this: with five new tweets, a failure on the fourth
//   left the marker untouched, so the three that HAD posted were posted again
//   on the next tick, and again after that, for as long as the fourth kept
//   failing. Reported from Discord as "the bot sends the same tweets".
//
// Both are avoided by the same rule: the marker advances to the last tweet that
// was actually delivered, and no further.

/**
 * @param {object} outcome
 * @param {string|null} outcome.lastDeliveredId  newest id confirmed posted this run
 * @param {boolean} outcome.failed               did a delivery fail this run
 * @param {string|null} outcome.newestId         newest id in the batch overall
 * @param {string|null} outcome.currentMarker    marker before this run
 * @returns {{ marker: string|null, changed: boolean }}
 */
export function nextTweetMarker({ lastDeliveredId = null, failed = false, newestId = null, currentMarker = null } = {}) {
  // Everything delivered: jump to the newest tweet the API reported, which may
  // be ahead of the last delivered one when the batch was already filtered.
  if (!failed && newestId) {
    return { marker: String(newestId), changed: String(newestId) !== String(currentMarker ?? "") };
  }
  // Partial delivery: advance only as far as delivery actually reached, so the
  // failed tweet is still the next one up on the retry.
  if (lastDeliveredId) {
    return { marker: String(lastDeliveredId), changed: String(lastDeliveredId) !== String(currentMarker ?? "") };
  }
  // Nothing delivered — the marker must not move, or the batch is lost.
  return { marker: currentMarker == null ? null : String(currentMarker), changed: false };
}

// A THIRD FAILURE MODE, from a stale marker: the repository used to ship
// lastTweet.json with a months-old id, so every fresh install (a deploy, a test
// copy) re-announced months of old tweets as "new". A tweet older than this is
// never announced, whatever the marker says; the marker still moves past it.
// A week, not a day: a Discord or X outage of a day or two must not swallow a
// real announcement, while a months-old marker is still stopped.
export const MAX_ANNOUNCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The tweets recent enough to announce. Without a readable created_at, a tweet
 *  is not announced: a missing date must not turn an old tweet into news. */
export function announceable(tweets = [], now = Date.now(), maxAgeMs = MAX_ANNOUNCE_AGE_MS) {
  return tweets.filter((t) => {
    const at = Date.parse(t?.created_at ?? "");
    return Number.isFinite(at) && now - at <= maxAgeMs;
  });
}

/** Oldest first, by numeric id. Tweet ids exceed Number.MAX_SAFE_INTEGER, so
 *  they are compared as BigInt — a plain numeric sort silently misorders them. */
export function oldestFirst(tweets = []) {
  return [...tweets].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}
