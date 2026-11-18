// App notifications — the scheduling decisions, tested away from the plugin.
//
// The thing worth guarding here is restraint. A notification system that fires
// slightly too little is a missed claim; one that fires too much gets the app
// uninstalled, and on Android a permission denial is close to permanent. So most
// of these assert that we DON'T buzz somebody's phone.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  computeSchedule, avoidQuietHours, ownedIds, getPlugin, applySchedule,
  disableNotifications, IDS, IDLE_FIRST_MS, IDLE_WEEK_MS, IDLE_WEEKLY_COUNT,
  QUIET_END_HOUR,
} from "../../src/public/app/notify.js";

// Fixed clock: 2026-08-14 12:00 local.
const NOW = new Date(2026, 7, 14, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const at = (plan, id) => plan.find((n) => n.id === id);

describe("what gets scheduled", () => {
  test("a signed-out visitor gets reminders but nothing about a claim", () => {
    const plan = computeSchedule({ now: NOW, signedIn: false });
    assert.equal(at(plan, IDS.FAUCET_READY), undefined,
      "a signed-out visitor was told about somebody else's claim");
    assert.ok(at(plan, IDS.IDLE_FIRST), "the come-back reminder should still apply");
  });

  test("signed in with a wallet and a future cooldown gets the claim alert", () => {
    const plan = computeSchedule({
      now: NOW, signedIn: true,
      faucet: { linkedWallet: 'W', cooldownStatusOk: true, nextClaimAt: new Date(NOW + 5 * HOUR).toISOString() },
    });
    assert.equal(at(plan, IDS.FAUCET_READY).at, NOW + 5 * HOUR);
  });

  test("a cooldown that already elapsed schedules nothing", () => {
    // Nothing to wait for. A notification saying "ready" about a time in the
    // past is just noise on the next app open.
    const plan = computeSchedule({
      now: NOW, signedIn: true,
      faucet: { linkedWallet: 'W', cooldownStatusOk: true, nextClaimAt: new Date(NOW - HOUR).toISOString() },
    });
    assert.equal(at(plan, IDS.FAUCET_READY), undefined);
  });

  test("an unreadable faucet status schedules nothing rather than guessing", () => {
    // cooldownStatusOk:false means the faucet's own lookup failed. Sending
    // someone to a refusal is worse than staying quiet.
    const plan = computeSchedule({
      now: NOW, signedIn: true,
      faucet: { linkedWallet: 'W', cooldownStatusOk: false, nextClaimAt: new Date(NOW + 5 * HOUR).toISOString() },
    });
    assert.equal(at(plan, IDS.FAUCET_READY), undefined);
  });

  test("no linked wallet means no claim alert", () => {
    const plan = computeSchedule({
      now: NOW, signedIn: true,
      faucet: { linkedWallet: null, cooldownStatusOk: true, nextClaimAt: new Date(NOW + 5 * HOUR).toISOString() },
    });
    assert.equal(at(plan, IDS.FAUCET_READY), undefined);
  });

  test("the quiz alert lands BEFORE the cycle closes, while it can still be acted on", () => {
    const endMs = NOW + 48 * HOUR;
    const plan = computeSchedule({ now: NOW, quiz: { endMs } });
    const quiz = at(plan, IDS.QUIZ_CYCLE);
    assert.ok(quiz.at < endMs, "the alert fired after the cycle had already paid out");
    // 6h before close is 06:00 here, inside quiet hours, so it shifts to 08:00 —
    // later than ideal but still four hours of warning, and not at dawn.
    assert.equal(new Date(quiz.at).getHours(), QUIET_END_HOUR);
  });

  test("a warning that quiet hours would push past the deadline is dropped", () => {
    // A cycle closing at 07:00 would otherwise be announced as "closes soon" at
    // 08:00 — an hour after it paid out. Nothing beats wrong.
    const endMs = new Date(2026, 7, 16, 7, 0, 0).getTime();
    const plan = computeSchedule({ now: NOW, quiz: { endMs } });
    assert.equal(at(plan, IDS.QUIZ_CYCLE), undefined);
  });

  test("a cycle closing within the hour gets no alert rather than a retroactive one", () => {
    const plan = computeSchedule({ now: NOW, quiz: { endMs: NOW + HOUR } });
    assert.equal(at(plan, IDS.QUIZ_CYCLE), undefined);
  });
});

describe("not nagging", () => {
  test("the come-back series is 48h then weekly, and it ends", () => {
    const plan = computeSchedule({ now: NOW });
    assert.equal(at(plan, IDS.IDLE_FIRST).at, NOW + IDLE_FIRST_MS);
    const weekly = plan.filter((n) => n.id >= IDS.IDLE_WEEKLY_BASE);
    assert.equal(weekly.length, IDLE_WEEKLY_COUNT, "the reminder series is unbounded");
    // Someone who ignored a month of these has answered the question.
    const last = Math.max(...weekly.map((n) => n.at));
    assert.ok(last <= NOW + IDLE_FIRST_MS + IDLE_WEEK_MS * IDLE_WEEKLY_COUNT + 24 * HOUR);
  });

  test("reminders are spaced a week apart, not stacked", () => {
    const weekly = computeSchedule({ now: NOW })
      .filter((n) => n.id >= IDS.IDLE_WEEKLY_BASE)
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < weekly.length; i += 1) {
      const gap = weekly[i].at - weekly[i - 1].at;
      assert.ok(gap >= 6 * 24 * HOUR, `reminders ${i - 1} and ${i} were ${gap / HOUR}h apart`);
    }
  });

  test("every ID is unique, so nothing silently replaces anything else", () => {
    const ids = computeSchedule({
      now: NOW, signedIn: true,
      faucet: { linkedWallet: 'W', cooldownStatusOk: true, nextClaimAt: new Date(NOW + HOUR).toISOString() },
      quiz: { endMs: NOW + 48 * HOUR },
    }).map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("ownedIds covers everything computeSchedule can produce", () => {
    // If it did not, a stale notification could never be cancelled.
    const produced = computeSchedule({
      now: NOW, signedIn: true,
      faucet: { linkedWallet: 'W', cooldownStatusOk: true, nextClaimAt: new Date(NOW + HOUR).toISOString() },
      quiz: { endMs: NOW + 48 * HOUR },
    }).map((n) => n.id);
    for (const id of produced) assert.ok(ownedIds().includes(id), `id ${id} can never be cancelled`);
  });
});

describe("not waking people at 4am", () => {
  const hourOf = (t) => new Date(t).getHours();

  test("the small hours are pushed to the morning", () => {
    const threeAm = new Date(2026, 7, 15, 3, 0, 0).getTime();
    const moved = avoidQuietHours(threeAm, { hourOf });
    assert.equal(new Date(moved).getHours(), QUIET_END_HOUR);
    assert.equal(new Date(moved).getDate(), 15, "it was pushed a whole day");
  });

  test("late evening rolls to the next morning", () => {
    const elevenPm = new Date(2026, 7, 14, 23, 30, 0).getTime();
    const moved = avoidQuietHours(elevenPm, { hourOf });
    assert.equal(new Date(moved).getDate(), 15);
    assert.equal(new Date(moved).getHours(), QUIET_END_HOUR);
  });

  test("a civilised hour is left exactly alone", () => {
    const twoPm = new Date(2026, 7, 14, 14, 15, 0).getTime();
    assert.equal(avoidQuietHours(twoPm, { hourOf }), twoPm);
  });

  test("quiet hours never move a notification earlier", () => {
    // Moving one earlier would fire it before the claim is actually ready.
    for (let h = 0; h < 24; h += 1) {
      const t = new Date(2026, 7, 14, h, 30, 0).getTime();
      assert.ok(avoidQuietHours(t, { hourOf }) >= t, `hour ${h} moved backwards`);
    }
  });
});

describe("degrading without the plugin", () => {
  test("a plain browser is detected as having no plugin", () => {
    assert.equal(getPlugin({}), null);
    assert.equal(getPlugin({ Capacitor: { Plugins: {} } }), null);
    // App 0.1.0: Capacitor is present, LocalNotifications is not.
    assert.equal(getPlugin({ Capacitor: { Plugins: { App: {} } } }), null);
  });

  test("applying a schedule without the plugin is a quiet no-op", async () => {
    const res = await applySchedule({ now: NOW }, { scope: {}, storage: null });
    assert.deepEqual(res, { scheduled: 0, reason: "no_plugin" });
  });

  test("a plugin that throws does not propagate", async () => {
    const scope = { Capacitor: { Plugins: { LocalNotifications: {
      schedule: async () => { throw new Error("boom"); },
      cancel: async () => {},
      checkPermissions: async () => ({ display: "granted" }),
      requestPermissions: async () => ({ display: "granted" }),
    } } } };
    const res = await applySchedule({ now: NOW }, { scope, storage: null });
    assert.match(res.reason, /^failed:/);
  });
});

describe("consent", () => {
  function fakePlugin(display = "granted") {
    const calls = { cancelled: [], scheduled: [], asked: 0 };
    return { calls, plugin: {
      schedule: async ({ notifications }) => { calls.scheduled.push(...notifications); },
      cancel: async ({ notifications }) => { calls.cancelled.push(...notifications.map((n) => n.id)); },
      checkPermissions: async () => ({ display }),
      requestPermissions: async () => { calls.asked += 1; return { display: "granted" }; },
    } };
  }

  test("a denied permission schedules nothing and does not re-prompt", async () => {
    const { calls, plugin } = fakePlugin("denied");
    const scope = { Capacitor: { Plugins: { LocalNotifications: plugin } } };
    const res = await applySchedule({ now: NOW }, { scope, storage: null });
    assert.equal(res.reason, "no_permission");
    assert.equal(calls.asked, 0, "it re-prompted after a denial — on Android that is close to permanent");
  });

  test("opting out clears what is already pending, not just future ones", async () => {
    const { calls, plugin } = fakePlugin();
    const store = new Map([["winlew.notify.optout", "1"]]);
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const scope = { Capacitor: { Plugins: { LocalNotifications: plugin } } };
    const res = await applySchedule({ now: NOW }, { scope, storage });
    assert.equal(res.reason, "opted_out");
    assert.deepEqual(calls.cancelled.sort((a, b) => a - b), ownedIds().sort((a, b) => a - b));
    assert.equal(calls.scheduled.length, 0);
  });

  test("disabling cancels everything we own", async () => {
    const { calls, plugin } = fakePlugin();
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    await disableNotifications({ scope: { Capacitor: { Plugins: { LocalNotifications: plugin } } }, storage });
    assert.equal(store.get("winlew.notify.optout"), "1");
    assert.deepEqual(calls.cancelled.sort((a, b) => a - b), ownedIds().sort((a, b) => a - b));
  });

  test("rescheduling cancels ours first, so opening ten times gives one set", async () => {
    const { calls, plugin } = fakePlugin();
    const scope = { Capacitor: { Plugins: { LocalNotifications: plugin } } };
    const storage = { getItem: () => null, setItem: () => {} };
    await applySchedule({ now: NOW }, { scope, storage });
    await applySchedule({ now: NOW }, { scope, storage });
    const ids = calls.scheduled.map((n) => n.id);
    assert.equal(new Set(ids).size * 2, ids.length, "a second open produced a different set");
    assert.ok(calls.cancelled.length >= ownedIds().length * 2);
  });
});

// ── The bug Jim reported: the faucet reminder never fired ────────────────────
//
// He was right, and it could not have fired for anybody. readState() in
// /app/index.html fetched /api/profile/me with a raw `fetch(..., {credentials:
// 'include'})`. The session travels in the `x-winlew-session` HEADER, not a
// cookie, so the call was unauthenticated, the endpoint answered 401,
// `signedIn` stayed false, and computeSchedule() skipped the faucet reminder —
// the one people actually want — while still scheduling the idle nudges, which
// need no server and therefore looked like the feature was working.
//
// Pinned in the page source because the fault was in how the call was made, not
// in the scheduling logic, which was correct all along.
test("the app fetches the profile through the authenticated helper", () => {
  const html = readFileSync(new URL("../../src/public/app/index.html", import.meta.url), "utf8");
  const mod = html.slice(html.indexOf('<script type="module">'), html.lastIndexOf("</script>"));

  assert.match(mod, /const A = window\.WinLEWAuth/,
    "the module block must declare its own A — the main script's lives in an IIFE and is out of scope here");
  assert.match(mod, /A\.hubApiFetch\(path\)/,
    "the profile fetch must go through hubApiFetch, which attaches x-winlew-session");

  const readState = mod.slice(mod.indexOf("async function readState"), mod.indexOf("function paintOn"));
  assert.ok(!/credentials:\s*'include'/.test(readState),
    "a cookie-credentialed fetch cannot authenticate here; the session is a header");
  assert.ok(!/fetch\(base \+ '\?path=\/api\/profile/.test(readState),
    "the profile call bypasses hubApiFetch again");
});
