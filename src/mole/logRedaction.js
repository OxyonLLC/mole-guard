/**
 * Keeps credentials out of the request log.
 *
 * `app.use(morgan("dev"))` logs the `:url` token, which is `req.originalUrl` —
 * the path AND the query string. More than twenty authenticated GET routes take
 * their session token as `?session=…`, and pm2 writes the process's stdout to
 * `logs/<service>.out.log` (ecosystem.config.cjs). So every authenticated GET
 * was writing a live session token to a file on disk.
 *
 * That is the most durable form of this leak. A log file outlives the session it
 * records, gets copied when someone debugs, gets pasted into a chat when someone
 * asks for help, and is exactly the sort of thing that ends up somewhere it was
 * never meant to be — the shared host's own access log was publicly downloadable
 * until 2026-08-03 for precisely that reason.
 *
 * This redacts the VALUE and keeps the KEY, so a log still shows that a request
 * carried a session (useful when reading a trace) without showing which one.
 *
 * It is containment, not the cure. The cure is not putting credentials in URLs
 * at all — see WINLEW_PUBLIC_CONTENT_AUDIT.md #28. Until then, this stops the
 * copies accumulating.
 */

/**
 * Query parameters whose values are credentials or capability tokens.
 *
 * Matched case-insensitively, and by SUBSTRING for the compound names, so
 * `claimSecret`, `claim_secret` and `pairingCode` are all covered without
 * needing to be listed individually. Over-redacting a log line costs nothing;
 * under-redacting one costs a session.
 */
export const SENSITIVE_QUERY_KEYS = Object.freeze([
  "session",
  "token",
  "secret",
  "password",
  "signature",
  "pairingcode",
  "claimsecret",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "code",
  // The desktop/mobile hand-off id. Short-lived and single-use, but a DIRECT
  // hand-off redeems on the id alone, so it is a credential for its lifetime.
  "h",
]);

export const REDACTED = "[redacted]";

/**
 * Lowercase, with `-` and `_` removed, so separator style cannot defeat a
 * match. `X-Api-Key`, `api_key` and `apiKey` all normalise to `apikey`.
 *
 * Found by a test: the list held `apikey` and `api_key`, and `X-Api-Key`
 * matched neither because of the hyphen. Normalising both sides is the fix that
 * does not depend on someone enumerating every spelling.
 */
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[-_]/g, "");
}

const NORMALIZED_SENSITIVE = SENSITIVE_QUERY_KEYS.map(normalizeKey);

function isSensitive(key) {
  const k = normalizeKey(key);
  // Short entries (`h`) must match exactly — substring-matching a single letter
  // would redact almost every parameter on the site.
  return NORMALIZED_SENSITIVE.some((s) => (s.length <= 2 ? k === s : k.includes(s)));
}

/**
 * Same URL with sensitive query values replaced.
 *
 * Deliberately string-based rather than `new URL()`: the input is a relative
 * originalUrl, and round-tripping through URL/URLSearchParams re-encodes and
 * reorders things, which makes logs disagree with what was actually requested.
 * Anything unparseable is returned with its whole query string removed rather
 * than passed through — failing closed matters more here than a pretty log.
 */
export function redactUrl(rawUrl) {
  const url = String(rawUrl == null ? "" : rawUrl);
  const q = url.indexOf("?");
  if (q === -1) return url;

  const path = url.slice(0, q);
  const rest = url.slice(q + 1);

  // Preserve a fragment if one somehow survived into the server-side URL.
  const hashAt = rest.indexOf("#");
  const query = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : rest.slice(hashAt);

  try {
    const redacted = query
      .split("&")
      .map((pair) => {
        if (!pair) return pair;
        const eq = pair.indexOf("=");
        if (eq === -1) return isSensitive(pair) ? `${pair}=${REDACTED}` : pair;
        const key = pair.slice(0, eq);
        return isSensitive(key) ? `${key}=${REDACTED}` : pair;
      })
      .join("&");
    return `${path}?${redacted}${hash}`;
  } catch {
    return `${path}?${REDACTED}`;
  }
}

/**
 * Installs the redacting `:url` token on a morgan instance.
 *
 * Overriding the built-in token rather than defining a new one is deliberate:
 * every predefined morgan format ("dev", "combined", …) and any format a future
 * edit chooses will use it. A bespoke `:safeUrl` token would only protect the
 * one format someone remembered to change.
 */
export function installMorganRedaction(morgan) {
  morgan.token("url", (req) => redactUrl(req.originalUrl || req.url || ""));
  return morgan;
}
