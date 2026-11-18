// WinLEW app notifications.
//
// Asked for on 2026-08-14: tell people when a faucet claim or a quiz payout is
// ready, nudge them at 48 hours of silence, then weekly.
//
// LOCAL NOTIFICATIONS, NOT PUSH. Every one of those is predictable on the
// device: a faucet cooldown ends at a known time, a quiz cycle closes at a known
// time, and "48 hours since you last opened this" is a clock. None of it needs
// Firebase, a push token, a delivery service, or us holding a device identifier
// on a server. Push would be required only for things we cannot predict — a held
// payout being approved, say — and nothing on the list is that.
//
// THE CONSEQUENCE THAT SHAPES EVERYTHING HERE: a local notification can only be
// scheduled while the app is open. Nothing can be armed, cancelled or corrected
// once it closes. So each time the app opens we cancel our whole set and lay it
// down again from current facts. That is also why the weekly reminders are a
// bounded series rather than a repeat — an endless chain cannot be scheduled,
// and would be silenced by the next open anyway.
//
// Degrades to nothing at all when the plugin is missing, which is the case in
// any browser and in app version 0.1.0. No errors, no console noise, no broken
// page — the app is a website first and the notifications are an extra.

/** Fixed IDs. Rescheduling with the same ID REPLACES rather than stacks, which
 *  is what stops a user who opens the app ten times getting ten reminders. */
export const IDS = Object.freeze({
  FAUCET_READY: 1,
  QUIZ_CYCLE: 2,
  // A bounded series: 48h, then weekly. See the header for why it is bounded.
  IDLE_FIRST: 10,
  IDLE_WEEKLY_BASE: 11,
});

export const IDLE_FIRST_MS = 48 * 60 * 60 * 1000;
export const IDLE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Four weekly nudges after the 48h one, then silence until they come back.
 *  Someone who has ignored a month of reminders has answered the question. */
export const IDLE_WEEKLY_COUNT = 4;

/** Nobody wants to be woken at 04:00 to be told about a faucet. Anything landing
 *  in the dead zone is pushed to the morning; a claim stays claimable, and a
 *  reminder is not urgent. Local hours, because the device's clock is the one
 *  the person is living in. */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

/**
 * Move a timestamp out of the small hours.
 *
 * Pure, and takes the hour-extraction as an argument so tests can drive it
 * without pretending to be in another timezone.
 */
export function avoidQuietHours(ts, { hourOf = (t) => new Date(t).getHours() } = {}) {
  const hour = hourOf(ts);
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return ts;

  const d = new Date(ts);
  // Late evening rolls to the next morning; the small hours stay on the same day.
  if (hour >= QUIET_START_HOUR) d.setDate(d.getDate() + 1);
  d.setHours(QUIET_END_HOUR, 0, 0, 0);
  return d.getTime();
}

/**
 * The whole notification plan, derived from current state.
 *
 * PURE — no plugin, no network, no clock of its own. Everything that decides
 * whether somebody's phone buzzes is in here, where it can be tested.
 *
 * @param {object} state
 * @param {number} state.now
 * @param {object} [state.faucet]  `{nextClaimAt, cooldownReady, cooldownStatusOk, linkedWallet}`
 * @param {object} [state.quiz]    `{endMs}` from /api/quiz/cycle
 * @param {boolean} [state.signedIn]
 * @returns {Array<{id:number,title:string,body:string,at:number}>}
 */
export function computeSchedule({ now = Date.now(), faucet = null, quiz = null, signedIn = false, hourOf } = {}) {
  const out = [];
  const opts = hourOf ? { hourOf } : undefined;
  const future = (at) => Number.isFinite(at) && at > now;

  // ── Faucet claim ready ───────────────────────────────────────────────────
  // Only for someone signed in with a wallet linked: telling a signed-out
  // visitor their claim is ready is telling them about somebody else's claim.
  //
  // cooldownStatusOk === false means the faucet's own status lookup failed. We
  // do NOT guess a time from that — a notification saying "ready now" when it
  // is not sends someone to a refusal, which is worse than staying quiet.
  if (signedIn && faucet && faucet.linkedWallet && faucet.cooldownStatusOk !== false) {
    const at = Date.parse(faucet.nextClaimAt || "");
    if (future(at)) {
      out.push({
        id: IDS.FAUCET_READY,
        title: "Your faucet claim is ready",
        body: "Tap to claim your WinLEW.",
        at: avoidQuietHours(at, opts),
      });
    }
  }

  // ── Quiz cycle closing ───────────────────────────────────────────────────
  // Points settle when the cycle closes, so the useful moment is shortly
  // before — while there is still time to answer — not after, when the payout
  // has already been decided and there is nothing to act on.
  if (quiz && Number.isFinite(Number(quiz.endMs))) {
    const endMs = Number(quiz.endMs);
    const at = avoidQuietHours(endMs - 6 * 60 * 60 * 1000, opts);
    // Quiet hours only ever move a notification LATER, which for a deadline
    // warning can push it past the deadline — a cycle closing at 07:00 would
    // otherwise be announced as "closes soon" at 08:00, an hour after it paid
    // out. Nothing is better than wrong.
    if (future(at) && at < endMs) {
      out.push({
        id: IDS.QUIZ_CYCLE,
        title: "Quiz cycle closes soon",
        body: "Last chance to bank points before this cycle pays out.",
        at,
      });
    }
  }

  // ── Come back ────────────────────────────────────────────────────────────
  // Measured from NOW, which is an app open — so an active user re-arms these
  // every session and never sees one.
  out.push({
    id: IDS.IDLE_FIRST,
    title: "There's WinLEW waiting",
    body: "Your faucet claim and quiz points are still there.",
    at: avoidQuietHours(now + IDLE_FIRST_MS, opts),
  });
  for (let i = 0; i < IDLE_WEEKLY_COUNT; i += 1) {
    out.push({
      id: IDS.IDLE_WEEKLY_BASE + i,
      title: "Still earning without you",
      body: "Claim from the faucet and answer a few questions.",
      at: avoidQuietHours(now + IDLE_FIRST_MS + IDLE_WEEK_MS * (i + 1), opts),
    });
  }

  return out;
}

/** Every ID this module owns. Used to clear our own notifications without
 *  touching anything else that might schedule one later. */
export function ownedIds() {
  const ids = [IDS.FAUCET_READY, IDS.QUIZ_CYCLE, IDS.IDLE_FIRST];
  for (let i = 0; i < IDLE_WEEKLY_COUNT; i += 1) ids.push(IDS.IDLE_WEEKLY_BASE + i);
  return ids;
}

/** The Capacitor plugin, or null in a browser and in app builds before 0.2.0. */
export function getPlugin(scope = globalThis) {
  const plugins = scope?.Capacitor?.Plugins;
  const ln = plugins?.LocalNotifications;
  return ln && typeof ln.schedule === "function" ? ln : null;
}

const PREF_KEY = "winlew.notify.optout";

export function hasOptedOut(storage = globalThis.localStorage) {
  try { return storage?.getItem(PREF_KEY) === "1"; } catch { return false; }
}

export function setOptedOut(value, storage = globalThis.localStorage) {
  try { storage?.setItem(PREF_KEY, value ? "1" : "0"); } catch { /* private mode */ }
}

/**
 * Ask for permission, once, and only when asked to.
 *
 * Never called on first paint. A permission dialog thrown at someone who has
 * just opened an app for the first time is the reason people tap "deny" — and
 * on Android a denial is close to permanent. The caller triggers this from a
 * deliberate action instead.
 */
export async function ensurePermission(plugin) {
  if (!plugin) return false;
  try {
    const current = await plugin.checkPermissions();
    if (current?.display === "granted") return true;
    if (current?.display === "denied") return false;
    const asked = await plugin.requestPermissions();
    return asked?.display === "granted";
  } catch {
    return false;
  }
}

/**
 * Lay the whole plan down, replacing whatever we scheduled before.
 *
 * NEVER THROWS. A notification failing is not worth breaking the app over, and
 * this runs on every open.
 *
 * @returns {Promise<{scheduled:number, reason?:string}>}
 */
export async function applySchedule(state, { scope = globalThis, storage } = {}) {
  const plugin = getPlugin(scope);
  if (!plugin) return { scheduled: 0, reason: "no_plugin" };
  if (hasOptedOut(storage ?? scope.localStorage)) {
    // Respect it properly: clear anything already pending rather than just
    // declining to add more.
    try { await plugin.cancel({ notifications: ownedIds().map((id) => ({ id })) }); } catch { /* ignore */ }
    return { scheduled: 0, reason: "opted_out" };
  }

  try {
    const granted = await ensurePermission(plugin);
    if (!granted) return { scheduled: 0, reason: "no_permission" };

    // Clear ours first. Without this a changed cooldown would leave the old
    // "claim ready" pending alongside the new one.
    await plugin.cancel({ notifications: ownedIds().map((id) => ({ id })) }).catch(() => {});

    const plan = computeSchedule(state);
    if (!plan.length) return { scheduled: 0, reason: "nothing_to_schedule" };

    await plugin.schedule({
      notifications: plan.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        // No allowWhileIdle: it maps to setExactAndAllowWhileIdle, which needs
        // SCHEDULE_EXACT_ALARM on Android 12+ — a permission we do not declare
        // and should not want. These are reminders; arriving a few minutes late
        // out of Doze costs nothing, and an exact-alarm prompt is both alarming
        // to the user and a Play policy question.
        //
        // No smallIcon either: naming a drawable that does not exist in res/
        // yields a blank or failed notification. Capacitor falls back to the
        // app icon, which is correct until someone draws a proper status icon.
        schedule: { at: new Date(n.at) },
        // Every one of these is "come and do a thing in the app", so they all
        // land on the app home rather than deep-linking somewhere stale.
        extra: { url: "/app/" },
      })),
    });
    return { scheduled: plan.length };
  } catch (error) {
    return { scheduled: 0, reason: `failed:${error?.message || "unknown"}` };
  }
}

/** Turn them off and clear anything pending. */
export async function disableNotifications({ scope = globalThis, storage } = {}) {
  setOptedOut(true, storage ?? scope.localStorage);
  const plugin = getPlugin(scope);
  if (!plugin) return;
  try { await plugin.cancel({ notifications: ownedIds().map((id) => ({ id })) }); } catch { /* ignore */ }
}
