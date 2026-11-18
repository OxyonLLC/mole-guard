// The tweet watcher failed silently for as long as the X account was out of
// credits. These tests pin the two behaviours that would have caught it: a
// billing failure is classified as FATAL (so it parks instead of retrying
// hourly), and it announces itself exactly ONCE per outage (so the alert does
// not become hourly noise that gets muted, which is the same as no alert).
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeTwitterError,
  noteTwitterFailure,
  noteTwitterSuccess,
  isTwitterAvailable,
  getTwitterHealth,
  _resetTwitterHealth,
} from "../../src/services/twitterHealth.js";

test.beforeEach(() => _resetTwitterHealth());

test("402 credits-depleted is fatal and names the right balance", () => {
  // The real payload, as returned by api.x.com on 2026-08-16.
  const d = describeTwitterError({ code: 402, data: { detail: "credits depleted", title: "Payment Required" } });
  assert.equal(d.fatal, true);
  assert.equal(d.code, "no_credit");
  // The wrong mental model costs a support round-trip: people assume their paid
  // X subscription funds the developer account. It does not.
  assert.match(d.summary, /developer account/i);
});

test("credits-depleted is recognised from the message when no status is attached", () => {
  // Some twitter-api-v2 rejections surface the body without a numeric code.
  const d = describeTwitterError(new Error("Request failed: credits depleted"));
  assert.equal(d.fatal, true);
  assert.equal(d.code, "no_credit");
});

test("the HTTP status is read from code, status, or response.status", () => {
  // twitter-api-v2 uses .code; fetch-style errors use .status; some callers
  // hand over the response itself. Reading only one shape silently downgrades
  // a fatal error to "unknown", which un-parks the breaker.
  for (const shape of [{ code: 401 }, { status: 401 }, { response: { status: 401 } }]) {
    const d = describeTwitterError(shape);
    assert.equal(d.fatal, true, `401 must be fatal for shape ${JSON.stringify(shape)}`);
    assert.equal(d.code, "bad_token");
  }
});

test("403 is fatal, 429 and 5xx are not", () => {
  assert.equal(describeTwitterError({ code: 403 }).fatal, true);
  // Rate limiting and outages resolve on their own — parking for six hours on
  // a 429 would turn a ten-minute blip into most of a day of missed tweets.
  assert.equal(describeTwitterError({ code: 429 }).fatal, false);
  assert.equal(describeTwitterError({ code: 500 }).fatal, false);
  assert.equal(describeTwitterError({ code: 503 }).fatal, false);
});

test("an unrecognised failure is transient, not fatal", () => {
  // Fail-safe direction: an unknown error should retry, not silently park the
  // watcher forever on something that might be a one-off network blip.
  const d = describeTwitterError(new Error("socket hang up"));
  assert.equal(d.fatal, false);
});

test("a fatal failure parks polling; a transient one does not", () => {
  assert.equal(isTwitterAvailable(), true);

  noteTwitterFailure({ code: 429 });
  assert.equal(isTwitterAvailable(), true, "a rate limit must not park the watcher");

  noteTwitterFailure({ code: 402, data: { detail: "credits depleted" } });
  assert.equal(isTwitterAvailable(), false, "a billing failure must stop further requests against the quota that IS the problem");
});

test("the outage is announced once, not once per hourly tick", () => {
  const first = noteTwitterFailure({ code: 402, data: { detail: "credits depleted" } });
  assert.equal(first.firstOccurrence, true);

  for (let i = 0; i < 24; i++) {
    const again = noteTwitterFailure({ code: 402, data: { detail: "credits depleted" } });
    assert.equal(again.firstOccurrence, false, "a full day of ticks must produce exactly one alert");
  }
});

test("a different fatal cause re-announces", () => {
  noteTwitterFailure({ code: 402, data: { detail: "credits depleted" } });
  const changed = noteTwitterFailure({ code: 401 });
  assert.equal(changed.firstOccurrence, true, "credits topped up but the token now rejected is new information");
});

test("success closes the breaker without a restart", () => {
  noteTwitterFailure({ code: 402, data: { detail: "credits depleted" } });
  assert.equal(isTwitterAvailable(), false);
  noteTwitterSuccess();
  assert.equal(isTwitterAvailable(), true, "topping up must recover on its own — needing a restart is how this stays broken");
});

test("the health snapshot reports the park and carries no token", () => {
  noteTwitterFailure({ code: 402, data: { detail: "credits depleted" } });
  const h = getTwitterHealth();
  assert.equal(h.ok, false);
  assert.equal(h.parked, true);
  assert.equal(h.code, "no_credit");
  assert.ok(h.retryAt, "must say when it will try again");
  assert.ok(!JSON.stringify(h).toLowerCase().includes("bearer"), "never serialise credentials into a health surface");

  noteTwitterSuccess();
  assert.equal(getTwitterHealth().ok, true);
});
