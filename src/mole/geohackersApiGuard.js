// What the internet may ask the GeoHackers API through /geohackers-api.
//
// The API is written for callers on this machine: the bot and worker reach it on
// 127.0.0.1 with a write token, and several of its routes trust that. Through this
// proxy it is public, so the proxy answers only an allowlist and refuses the rest
// before anything is forwarded. Two rules, in this order:
//
//   1. The event records (/events and everything under it) are never public, in
//      any spelling. Their documents hold Discord IDs next to wallets, and
//      POST /events would let anyone queue on-chain anchoring with Oxyon's key.
//   2. Everything else must match the allowlist exactly, as written. A path that
//      needs decoding or tidying to match (%-escapes, backslashes, "//", "." or
//      ".." segments) is refused, not tidied: the API would route the raw path,
//      so the guard decides on the raw path too.
//
// The allowlist is what the public pages call (apps/web in GeoHackers: the faucet
// panel, CryptoSpades, wallet co-signing) plus the published /public summary, the
// health check and proof pages. Logs from 2026-08-01 on show no other public use.
// Member profiles (/u/:id) are deliberately absent: they show a Discord ID beside
// its verified wallet.

const PREFIX = "/geohackers-api";
const ID = "[A-Za-z0-9_-]{1,128}";
const READ = ["GET", "HEAD"];

export const PUBLIC_GEOHACKERS_ROUTES = Object.freeze([
  { methods: READ, pattern: "/health" },
  { methods: READ, pattern: "/public" },
  { methods: READ, pattern: "/faucet/info" },
  { methods: READ, pattern: `/proofs/${ID}` },
  { methods: READ, pattern: "/xl1balance" },
  { methods: READ, pattern: "/lookback" },
  { methods: READ, pattern: "/games/crypto-spades/leaderboard" },
  // Faucet claims stay public: the API itself requires a Discord role (through the
  // bot's token) before it pays, and applies the cooldowns and the daily cap.
  { methods: ["POST"], pattern: "/claim" },
  { methods: ["POST"], pattern: "/games/crypto-spades/sessions" },
  { methods: ["POST"], pattern: `/games/crypto-spades/sessions/${ID}/complete` },
  // Wallet co-signing; the API checks the signed invite token on both.
  { methods: ["POST"], pattern: `/cowitness/${ID}/prepare` },
  { methods: ["POST"], pattern: `/cowitness/${ID}/complete` },
].map((r) => Object.freeze({ ...r, regex: new RegExp(`^${r.pattern}/?$`, "i") })));

const NOT_PUBLIC = Object.freeze({ status: 404, body: { ok: false, error: "not_public" } });
const BAD_PATH = Object.freeze({ status: 400, body: { ok: false, error: "invalid_path" } });

// Undo every %-escape (several rounds, for double encoding), turn backslashes into
// slashes and squeeze repeated slashes. Used only to recognise the event family;
// null when the path cannot be decoded.
export function canonicalPath(rawPath) {
  let p = String(rawPath);
  for (let i = 0; i < 4 && /%[0-9a-f]{2}/i.test(p); i++) {
    try {
      p = decodeURIComponent(p);
    } catch {
      return null;
    }
  }
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
}

// Is this (prefix-stripped) path in the event family? Any first segment that begins
// with "events", after decoding and dropping "." segments, counts: "/events",
// "/EVENTS/", "/%65vents", "/./events/x", "/events;x" and "/eventsx" all do.
export function isEventFamily(rawPath) {
  const canon = canonicalPath(rawPath);
  if (canon === null) return true;
  const first = canon.split("/").filter((s) => s !== "" && s !== ".")[0] ?? "";
  return first.startsWith("events") || first === "..";
}

// The decision for one request. `rawUrl` is the URL as received (req.originalUrl):
// path plus optional query. Returns { allow: true } or { allow: false, status, body }.
export function geoHackersApiDecision(method, rawUrl) {
  const raw = String(rawUrl ?? "");
  const pathOnly = raw.split(/[?#]/, 1)[0];
  if (!pathOnly.toLowerCase().startsWith(PREFIX)) {
    // An odd spelling of the prefix ("//geohackers-api", "/%67eohackers-api") is
    // refused too, whether or not Express would have routed it to the proxy.
    const canon = canonicalPath(pathOnly);
    const odd = canon !== null && /^\/geohackers-api(?:\/|$)/.test(canon);
    return odd ? { allow: false, ...NOT_PUBLIC } : { allow: true };
  }
  const rest = pathOnly.slice(PREFIX.length);
  // "/geohackers-apix" is not this proxy's path; leave it to whatever follows.
  if (rest !== "" && rest[0] !== "/" && rest[0] !== "\\" && rest[0] !== "%") return { allow: true };
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { allow: false, ...BAD_PATH };
  if (isEventFamily(rest)) return { allow: false, ...NOT_PUBLIC };
  const m = String(method ?? "").toUpperCase();
  const route = PUBLIC_GEOHACKERS_ROUTES.find((r) => r.regex.test(rest));
  if (!route) return { allow: false, ...NOT_PUBLIC };
  // CORS preflight for an allowed path; the API's own cors() answers it.
  if (m === "OPTIONS" || route.methods.includes(m)) return { allow: true };
  return { allow: false, status: 405, body: { ok: false, error: "method_not_allowed" } };
}

// Express middleware. Mount it ahead of the /geohackers-api proxy.
export function geoHackersApiGuard() {
  return (req, res, next) => {
    const d = geoHackersApiDecision(req.method, req.originalUrl ?? req.url);
    if (d.allow) return next();
    res.set("Cache-Control", "no-store");
    return res.status(d.status).json(d.body);
  };
}
