/**
 * Snowflake decoding — Discord and X (Twitter).
 *
 * Both platforms encode a creation timestamp in the top 42 bits of their ids,
 * differing only in epoch. That makes a post id or an account id *self-dating*:
 * no API call, no rate limit, nothing to fail, and nothing a third party can
 * misreport. For a project whose whole pitch is checkable claims, it is the
 * cheapest evidence there is.
 *
 * WHY THIS FILE EXISTS
 *
 * `src/mole/identityAge.js` implemented the Discord half for the verification
 * gate. Then a date audit needed the X half, and rather than write a second
 * copy of a bit-twiddling function with a subtle trap in it, both live here.
 *
 * It immediately earned itself. `partnersData.js` and `eventsData.js` both
 * recorded the 2BRZ partnership announcement as 2025-04-01, citing an X post
 * whose id decodes to 2025-04-03T02:18:46Z — April 2 in the project owner's
 * own timezone. One wrong date, copied into two files, and the evidence needed
 * to catch it was sitting inside the URL both records already stored.
 *
 * THE TRAP
 *
 * Not `Number(id) >> 22`. JavaScript's `>>` coerces to INT32 first, so any real
 * 18-20 digit snowflake wraps and the expression returns roughly "the epoch plus
 * a few hundred milliseconds" — a garbage value that still looks like a
 * plausible date, which is the dangerous kind of wrong. Under Discord's epoch it
 * would make every account read as ~11 years old and sail through any age check.
 *
 * (Float division by 2^22 would in fact be correct — the precision Number loses
 * on a 64-bit snowflake sits below the bits the shift discards. BigInt is used
 * because it is exact by construction rather than by a coincidence that needs a
 * paragraph to explain.)
 */

/** Discord's epoch: 2015-01-01T00:00:00Z. */
export const DISCORD_EPOCH_MS = 1420070400000;

/** X/Twitter's epoch: 2010-11-04T01:42:54.657Z. */
export const X_EPOCH_MS = 1288834974657;

const TIMESTAMP_SHIFT = 22n;

/** Snowflakes are 17-20 digits in practice. Anything else is not one. */
function snowflakeMs(id, epochMs) {
  const raw = String(id ?? "").trim();
  if (!/^\d{15,20}$/.test(raw)) return null;
  try {
    return Number((BigInt(raw) >> TIMESTAMP_SHIFT) + BigInt(epochMs));
  } catch {
    return null;
  }
}

/** Creation time (ms) of a Discord id, or null if it is not a snowflake. */
export function discordCreatedAtMs(id) {
  return snowflakeMs(id, DISCORD_EPOCH_MS);
}

/** Creation time (ms) of an X/Twitter id, or null if it is not a snowflake. */
export function xCreatedAtMs(id) {
  return snowflakeMs(id, X_EPOCH_MS);
}

/**
 * Pull the status id out of an X URL and decode it.
 *
 * Accepts x.com and twitter.com, with or without query strings — the owner's
 * links usually carry `?t=…&s=19` from the mobile share sheet. Returns null
 * rather than throwing so a caller can treat "not an X link" as ordinary.
 */
export function xStatusCreatedAtMs(url) {
  const match = String(url || "").match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d{15,20})/i);
  return match ? xCreatedAtMs(match[1]) : null;
}

/**
 * ISO date (YYYY-MM-DD) for a snowflake in a given IANA zone.
 *
 * The zone argument is the point. A post made at 8:18 PM Mountain is stamped
 * the NEXT day in UTC, and recording the UTC day would put the project's own
 * announcements on dates nobody involved would recognise. Callers should pass
 * the timezone the event actually happened in, and say which they used.
 */
export function isoDateInZone(ms, timeZone = "UTC") {
  if (!Number.isFinite(ms)) return null;
  // en-CA formats as YYYY-MM-DD, which is the shape we want out.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
