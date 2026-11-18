// Site activity log — a Discord record of what happens on the website.
//
// The reason, in the owner's words: Discord has eyes on it, and abuse there is
// witnessed. The website has nobody watching. Actions that would be noticed in
// a channel — claiming, redeeming, linking a wallet, changing a profile, buying
// merch — happen on the site in silence. This puts them where people can see
// them.
//
// THREE RULES, and they are not negotiable:
//
//   1. Never log a secret. No session tokens, no signatures, no API keys, no
//      request bodies. Everything posted here is either public on-chain data or
//      a fact about an action, never the credential that authorised it.
//   2. Never log a vote choice. Governance deliberately posts "a vote was cast"
//      and nothing more (src/mole/web.js sendGovernanceVoteMessage). A general
//      activity log must not become the leak that undoes it.
//   3. Never break the request. Every call is fire-and-forget. A Discord outage,
//      a bad webhook or a rate limit must not fail a faucet claim.

// The channel the owner nominated for site activity. A webhook is preferred —
// it needs no bot permissions and cannot read anything — but a webhook URL is a
// secret that has to be created by hand, so the bot-token path exists as a
// fallback that works with credentials already configured.
export const DEFAULT_SITE_LOG_CHANNEL_ID = "1350969543480180817";

// Discord hard-limits messages to 2000 characters. Truncating at the boundary
// would silently drop the end of a line; this leaves a visible marker instead.
const MAX_CONTENT = 1900;

// Per-event-type throttle. Without it a script hammering /api/faucet/claim turns
// the channel into the abuse rather than the record of it. Suppressed events are
// counted and reported on the next post through, so a burst is visible as a
// burst instead of vanishing.
const THROTTLE_MS = 3_000;
const _lastSent = new Map();
const _suppressed = new Map();

let _queue = Promise.resolve();

function maskWallet(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

/** Is this a real Discord snowflake, or one of our synthetic wallet-profile
 *  ids (`wallet:…`)? Exported because callers must describe the account the
 *  same way this renders it — see the `Linked:` contradiction below. */
export function isDiscordId(value) {
  return /^\d{5,25}$/.test(String(value || "").trim());
}

/** A Discord mention when we have a real id, never a raw id in prose.
 *
 *  Wallet-only sessions carry a synthetic `wallet:<addr>` id, which is not
 *  mentionable. Rendering that as "—" beside a field saying "known Discord
 *  account" is how the log ended up contradicting itself (reported with a
 *  screenshot, 2026-08-15). Callers now derive that field from isDiscordId()
 *  so the two cannot disagree. */
function mention(discordUserId) {
  const id = String(discordUserId || "").trim();
  return isDiscordId(id) ? `<@${id}>` : "wallet-only session";
}

/**
 * Which part of the site an event came from.
 *
 * Added on Jim's feedback, 2026-08-15: the channel was a flat stream where a
 * faucet claim, a quiz redemption and a game payout all read alike, so you
 * could not scan for the one you cared about. A tag is scannable in a way an
 * emoji alone is not — you can Ctrl-F `[FAUCET]`, and you cannot Ctrl-F 🚰
 * reliably on every keyboard.
 */
export const SOURCES = Object.freeze({
  FAUCET: "FAUCET",
  QUIZ: "QUIZ",
  GAMES: "GAMES",
  WALLET: "WALLET",
  MERCH: "MERCH",
  ROLES: "ROLES",
  SYSTEM: "SYSTEM",
});

/** Short, non-secret handle for one event, so a report of "it broke at about
 *  half nine" can be tied to a specific line. Not an id anything looks up —
 *  purely a label to quote back. */
function traceId() {
  return Math.random().toString(36).slice(2, 8);
}

function truncate(text) {
  const s = String(text || "");
  return s.length <= MAX_CONTENT ? s : `${s.slice(0, MAX_CONTENT)}\n… (truncated)`;
}

async function deliver(content) {
  // Read straight from process.env rather than getConfig(). getConfig()
  // validates the WHOLE schema and throws if anything unrelated is missing, so
  // routing logging through it would mean one bad env var silently disables the
  // audit trail — and worse, would have made the "never breaks the request"
  // tests below pass for the wrong reason. These four values are optional
  // strings that need no validation.
  const webhookUrl = process.env.SITE_LOG_WEBHOOK_URL;
  const body = {
    content: truncate(content),
    // Nothing this log posts should ever ping anyone. A channel that pings on
    // every faucet claim gets muted, and a muted channel is not oversight.
    allowed_mentions: { parse: [] },
  };

  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`site_log_webhook_${res.status}`);
    return;
  }

  const token = process.env.MOLE_DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.SITE_LOG_CHANNEL_ID || DEFAULT_SITE_LOG_CHANNEL_ID;
  if (!token || !channelId) return; // not configured — silently inert, by design

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`site_log_channel_${res.status}`);
}

/**
 * Record something that happened on the website.
 *
 * Fire-and-forget: callers use `void logSiteEvent(...)` and never await it.
 * Returns a promise only so tests can.
 *
 * @param {object} event
 * @param {string} event.type   short machine-ish key, used for throttling
 * @param {string} event.icon   one emoji
 * @param {string} event.title  what happened, in plain words
 * @param {object} [event.fields] label -> value; values are printed as-is, so
 *                                the CALLER is responsible for never putting a
 *                                secret in one
 * @param {string} [event.discordUserId]
 * @param {string} [event.wallet] masked before sending
 */
export function logSiteEvent({ type, icon = "•", title, fields = {}, discordUserId, wallet, source, outcome, trace } = {}) {
  // Throttle per type AND outcome: a burst of successful claims must never
  // suppress the one refusal in the middle of it, which is the event anybody
  // looking at this channel actually needs to see.
  const key = `${String(type || "unknown")}:${outcome || "ok"}`;
  const now = Date.now();
  const last = _lastSent.get(key) || 0;

  if (now - last < THROTTLE_MS) {
    _suppressed.set(key, (_suppressed.get(key) || 0) + 1);
    return Promise.resolve({ ok: true, throttled: true });
  }
  _lastSent.set(key, now);

  const held = _suppressed.get(key) || 0;
  _suppressed.delete(key);

  // Outcome first in the icon slot. Jim's point, 2026-08-15: these should read
  // as "true debug logs" — and a log that only ever shows successes cannot be
  // debugged with, because the thing you are chasing is the refusal.
  const mark = outcome === "fail" ? "❌" : outcome === "refused" ? "⛔" : icon;
  const tag = source ? ` \`[${source}]\`` : "";
  const id = trace || traceId();

  const lines = [`${mark}${tag} **${title}**`];
  if (discordUserId) lines.push(`• User: ${mention(discordUserId)}`);
  if (wallet) lines.push(`• Wallet: \`${maskWallet(wallet)}\``);
  for (const [label, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`• ${label}: ${value}`);
  }
  // Last line, dim, so it never competes with the content but is always there
  // to quote in a bug report.
  lines.push(`• _trace \`${id}\`_`);
  if (held > 0) lines.push(`• _${held} similar event${held === 1 ? "" : "s"} in the last few seconds not shown_`);

  const content = lines.join("\n");

  // Serialised so a burst cannot interleave or exceed Discord's rate limit, and
  // chained off the previous send so ordering in the channel matches ordering on
  // the site.
  _queue = _queue
    .then(() => deliver(content))
    .catch((error) => {
      // Logged locally and swallowed. A failure to RECORD an action must never
      // become a failure to PERFORM it.
      console.warn("[site-log] delivery failed:", error?.message || error);
    });
  return _queue.then(() => ({ ok: true }));
}

/** Test seam — clears throttle state between cases. */
export function _resetSiteLogThrottle() {
  _lastSent.clear();
  _suppressed.clear();
}
