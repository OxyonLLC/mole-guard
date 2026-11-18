/**
 * Liveness for the Discord bots, as a red/green/grey light.
 *
 * WHY THIS IS NOT JUST A COLOURED DOT
 *
 * `/api/discord-bots/status` already refuses to report on these two, and its
 * note says exactly why:
 *
 *   "The Mole Guard and WinLEW Utility Bot are intentionally absent — there is
 *    nothing honest to check for them today."
 *
 * That was correct. Port-reachability does not mean a bot is connected to
 * Discord, and a light that is green whenever the web server is up would be
 * worse than no light: it would say "fine" during exactly the outage someone
 * built it to notice.
 *
 * So this reports on a signal the bot itself sends. No heartbeat, no green —
 * the light goes GREY (unknown), never green-by-default.
 *
 * THREE STATES, AND THE MIDDLE ONE MATTERS
 *
 *   green   a heartbeat arrived within STALE_AFTER_SEC
 *   red     a heartbeat arrived once, but not recently — it WAS up, it is not now
 *   grey    nothing has ever been heard from this service
 *
 * Red and grey are different facts and must not be merged. Red means "it
 * stopped" — actionable, alarming. Grey means "nobody wired the heartbeat up",
 * which is a configuration gap, not an outage. Collapsing grey into red trains
 * everyone to ignore the light on day one, before the bot has ever reported.
 *
 * This is deliberately separate from the watchdog's own heartbeat store
 * (src/watchdog/index.js `POST /heartbeat`, which drives its 🟢/🔴 Discord
 * alerts). That store lives in a process the website cannot read, is
 * local-only, and may not be running at all. This one lives in the web server
 * that already serves the page.
 */

const DAY_SEC = 86400;

/** A service that has not checked in for this long is reported DOWN. */
export const STALE_AFTER_SEC = Math.max(
  60,
  Number(process.env.BOT_HEALTH_STALE_AFTER_SEC) || 300
);

/**
 * Records older than this are dropped rather than shown as a very stale red.
 * A bot nobody has run for a week is not "down", it is gone, and a permanent
 * red light is indistinguishable from a broken light.
 */
export const FORGET_AFTER_SEC = Math.max(
  STALE_AFTER_SEC,
  Number(process.env.BOT_HEALTH_FORGET_AFTER_SEC) || 7 * DAY_SEC
);

export const BOT_HEALTH_STATES = Object.freeze({
  UP: "up",
  DOWN: "down",
  UNKNOWN: "unknown",
});

/**
 * The services this light knows about. A service absent from here is rejected
 * rather than silently created, so a typo in a bot's config shows up as a
 * failed heartbeat instead of a second phantom light nobody notices.
 */
export const KNOWN_SERVICES = Object.freeze({
  "winlew-utility-bot": "WinLEW Utility Bot",
  "the-mole-guard": "The Mole Guard",
});

const beats = new Map();

/** Test seam. */
export function _resetBotHealth() {
  beats.clear();
}

export function isKnownService(service) {
  return Object.prototype.hasOwnProperty.call(KNOWN_SERVICES, String(service || "").trim());
}

/**
 * Record a heartbeat. Returns the stored record, or throws for an unknown
 * service id.
 *
 * `nowSec` is injected so tests do not have to sleep.
 */
export function recordBotHeartbeat({ service, kind = "heartbeat", version = null } = {}, nowSec = Math.floor(Date.now() / 1000)) {
  const id = String(service || "").trim();
  if (!isKnownService(id)) throw new Error(`unknown_service:${id.slice(0, 40)}`);
  const record = {
    service: id,
    lastSeenAtSec: nowSec,
    kind: String(kind || "heartbeat").slice(0, 32),
    version: version == null ? null : String(version).slice(0, 40),
  };
  beats.set(id, record);
  return record;
}

/** State for one service. */
export function serviceHealth(service, nowSec = Math.floor(Date.now() / 1000)) {
  const id = String(service || "").trim();
  const label = KNOWN_SERVICES[id] || id;
  const record = beats.get(id);

  if (!record || nowSec - record.lastSeenAtSec > FORGET_AFTER_SEC) {
    return { service: id, label, state: BOT_HEALTH_STATES.UNKNOWN, lastSeenAtSec: null, ageSec: null };
  }

  const ageSec = Math.max(0, nowSec - record.lastSeenAtSec);
  return {
    service: id,
    label,
    state: ageSec <= STALE_AFTER_SEC ? BOT_HEALTH_STATES.UP : BOT_HEALTH_STATES.DOWN,
    lastSeenAtSec: record.lastSeenAtSec,
    ageSec,
    version: record.version,
  };
}

/** Every known service, in a stable order so the lights do not reshuffle. */
export function botHealthPayload(nowSec = Math.floor(Date.now() / 1000)) {
  const services = Object.keys(KNOWN_SERVICES).map((id) => serviceHealth(id, nowSec));
  return {
    generatedAt: new Date(nowSec * 1000).toISOString(),
    staleAfterSec: STALE_AFTER_SEC,
    services,
  };
}

/** Short human line for a tooltip. */
export function describeBotHealth(entry) {
  if (!entry) return "No data.";
  switch (entry.state) {
    case BOT_HEALTH_STATES.UP:
      return `Online — last check-in ${entry.ageSec}s ago.`;
    case BOT_HEALTH_STATES.DOWN:
      return `Not responding — last check-in ${Math.round(entry.ageSec / 60)} min ago.`;
    default:
      // Says the light is unconfigured rather than implying an outage.
      return "No check-in received yet — this bot has not been wired to report status.";
  }
}
