// Who counts as "the client" for per-IP rate limiting.
//
// The backend is not reachable directly: it binds 127.0.0.1 and is published
// through an ngrok tunnel, so *every* request arrives from the local ngrok
// agent and the socket address is always loopback. That means the only way to
// tell two visitors apart is a forwarded-IP header — and headers are written
// by whoever sent the request.
//
// The ngrok origin is publicly reachable, so "whoever sent the request" can be
// an attacker. With `trust proxy: true` express believed the *leftmost*
// X-Forwarded-For entry, which is entirely attacker-supplied: a fresh fake IP
// per request bought a fresh rate-limit budget on every route, i.e. no rate
// limiting at all.
//
// Two hops actually reach us, and they are trusted very differently:
//
//   browser ──▶ winlew.co (shared host, /verify/api-proxy.php)
//                      └──▶ ngrok edge ──▶ ngrok agent ──▶ this server
//   browser ──▶ ngrok edge ──▶ ngrok agent ──▶ this server   (direct, e.g. OAuth)
//
//   * The ngrok edge appends the address that actually opened the connection
//     to X-Forwarded-For. That last entry is the one hop we did not let the
//     sender write, so it is the only trustworthy one — `trustedProxySetting()`
//     keeps express to exactly that (trust loopback, stop).
//   * The PHP proxy sits behind that and knows the real browser IP, but from
//     the tunnel's point of view it is just another client, so its claim has
//     to be *authenticated* rather than believed: it presents a shared secret
//     alongside the IP. Without the secret we fall back to the tunnel-observed
//     address, which buckets all winlew.co visitors under the shared host —
//     coarse, but never forgeable.
//
// A spoofer therefore gets, at best, one bucket per real network path they can
// actually originate traffic from.
import crypto from "crypto";

/** Header the shared-host proxy uses to prove it is the shared-host proxy. */
export const PROXY_SECRET_HEADER = "x-winlew-proxy-secret";
/** Header carrying the browser IP that proxy observed. Only read if the secret matches. */
export const PROXY_CLIENT_IP_HEADER = "x-winlew-client-ip";

// Express's named subnets. Loopback alone covers the ngrok agent, which is the
// only thing that ever opens a socket to us; the rest are opt-in via env for
// deployments that put a LAN reverse proxy in front instead.
const DEFAULT_TRUSTED_PROXIES = ["loopback"];

/**
 * Build the value for `app.set("trust proxy", …)`.
 *
 * Deliberately never returns `true`: that trusts the whole X-Forwarded-For
 * chain, which is the bug this module exists to close.
 *
 * @param {string} [raw] comma-separated IPs/CIDRs/named subnets, or "false"/"off" to trust nothing.
 */
export function trustedProxySetting(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return [...DEFAULT_TRUSTED_PROXIES];
  if (/^(false|off|none|0)$/i.test(value)) return false;

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    // `true`/`*` would re-open the hole through configuration; drop them and
    // keep whatever else was listed.
    .filter((entry) => !/^(true|\*|all)$/i.test(entry));

  return entries.length ? entries : [...DEFAULT_TRUSTED_PROXIES];
}

/** IPv4-mapped IPv6 ("::ffff:1.2.3.4") and plain IPv4 must land in one bucket. */
export function normalizeIp(value) {
  const ip = String(value ?? "").trim().toLowerCase();
  if (!ip) return "";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  return mapped ? mapped[1] : ip;
}

/** Conservative IP-literal check — anything else is treated as "no IP given". */
export function isIpLiteral(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return ip.split(".").every((part) => part.length <= 3 && Number(part) <= 255);
  }
  // IPv6: hex groups and "::", nothing else. Good enough to reject header junk.
  return /^[0-9a-f:]+$/.test(ip) && ip.includes(":");
}

/** Length-independent constant-time comparison (timingSafeEqual throws on length mismatch). */
export function secretsMatch(presented, expected) {
  if (!presented || !expected) return false;
  const a = crypto.createHash("sha256").update(String(presented)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve the rate-limit identity for a request.
 *
 * @param {object} args
 * @param {string} args.reqIp   express `req.ip` — already narrowed by trustedProxySetting()
 * @param {object} [args.headers] raw lower-cased request headers
 * @param {string} [args.secret] configured shared secret; empty disables the forwarded path
 * @returns {string} an opaque bucket key
 */
export function resolveClientKey({ reqIp, headers = {}, secret = "" } = {}) {
  const observed = normalizeIp(reqIp) || "unknown";
  if (!secret) return observed;

  const presented = headers[PROXY_SECRET_HEADER];
  if (!secretsMatch(presented, secret)) return observed;

  // The proxy vouched for itself. Its claim is still only worth using when it
  // is actually an address; a malformed one falls back to the proxy's own
  // bucket rather than a shared "invalid" bucket everyone would share.
  const claimed = headers[PROXY_CLIENT_IP_HEADER];
  return isIpLiteral(claimed) ? normalizeIp(claimed) : observed;
}
