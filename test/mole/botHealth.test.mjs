// The red/green/grey light. The failure mode that matters is a light that
// says "fine" during an outage — so the tests below care most about what
// makes something GREEN, and about keeping "never reported" distinct from
// "stopped reporting".
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_HEALTH_STATES,
  STALE_AFTER_SEC,
  FORGET_AFTER_SEC,
  KNOWN_SERVICES,
  botHealthPayload,
  describeBotHealth,
  isKnownService,
  recordBotHeartbeat,
  serviceHealth,
  _resetBotHealth,
} from "../../src/mole/botHealth.js";

const NOW = 1_760_000_000;
const UTILITY = "winlew-utility-bot";

test.beforeEach(() => _resetBotHealth());

test("a service that has never reported is UNKNOWN, not down and never up", () => {
  const h = serviceHealth(UTILITY, NOW);
  assert.equal(h.state, BOT_HEALTH_STATES.UNKNOWN);
  assert.equal(h.lastSeenAtSec, null);
  // The whole point: nothing is green until the bot itself says so.
  assert.notEqual(h.state, BOT_HEALTH_STATES.UP);
});

test("a recent heartbeat is UP", () => {
  recordBotHeartbeat({ service: UTILITY }, NOW - 10);
  const h = serviceHealth(UTILITY, NOW);
  assert.equal(h.state, BOT_HEALTH_STATES.UP);
  assert.equal(h.ageSec, 10);
});

test("a heartbeat older than the stale window is DOWN", () => {
  recordBotHeartbeat({ service: UTILITY }, NOW - (STALE_AFTER_SEC + 1));
  assert.equal(serviceHealth(UTILITY, NOW).state, BOT_HEALTH_STATES.DOWN);
});

test("the boundary is inclusive — exactly at the limit is still UP", () => {
  // Off-by-one here would flip the light red once per interval on a bot that
  // reports exactly on the stale boundary, which reads as flapping.
  recordBotHeartbeat({ service: UTILITY }, NOW - STALE_AFTER_SEC);
  assert.equal(serviceHealth(UTILITY, NOW).state, BOT_HEALTH_STATES.UP);
});

test("DOWN and UNKNOWN stay distinct — an abandoned service reverts to UNKNOWN", () => {
  // A bot nobody has run for a week is not "down", it is gone. A permanent red
  // light is indistinguishable from a broken one, and people stop reading it.
  recordBotHeartbeat({ service: UTILITY }, NOW - (FORGET_AFTER_SEC + 1));
  assert.equal(serviceHealth(UTILITY, NOW).state, BOT_HEALTH_STATES.UNKNOWN);

  recordBotHeartbeat({ service: UTILITY }, NOW - (STALE_AFTER_SEC + 60));
  assert.equal(serviceHealth(UTILITY, NOW).state, BOT_HEALTH_STATES.DOWN);
});

test("an unknown service id is rejected, not silently created", () => {
  // A typo in a bot's config must surface as a failed heartbeat, not as a
  // second light nobody is watching.
  assert.equal(isKnownService("winlew-utillity-bot"), false);
  assert.throws(() => recordBotHeartbeat({ service: "winlew-utillity-bot" }, NOW), /unknown_service/);
  assert.throws(() => recordBotHeartbeat({ service: "" }, NOW), /unknown_service/);
});

test("the payload lists every known service in a stable order", () => {
  const ids = botHealthPayload(NOW).services.map((s) => s.service);
  assert.deepEqual(ids, Object.keys(KNOWN_SERVICES), "lights must not reshuffle between polls");
  // Unreported services still appear — an absent light is worse than a grey one.
  assert.equal(botHealthPayload(NOW).services.every((s) => s.state === BOT_HEALTH_STATES.UNKNOWN), true);
});

test("one bot reporting does not turn another one green", () => {
  recordBotHeartbeat({ service: "the-mole-guard" }, NOW);
  const byId = Object.fromEntries(botHealthPayload(NOW).services.map((s) => [s.service, s.state]));
  assert.equal(byId["the-mole-guard"], BOT_HEALTH_STATES.UP);
  assert.equal(byId[UTILITY], BOT_HEALTH_STATES.UNKNOWN, "the web server being up says nothing about the utility bot");
});

test("the payload carries no secrets", () => {
  recordBotHeartbeat({ service: UTILITY, version: "1.2.3" }, NOW);
  const json = JSON.stringify(botHealthPayload(NOW)).toLowerCase();
  for (const leak of ["token", "secret", "bearer", "mongodb", "http://", "keypair"]) {
    assert.ok(!json.includes(leak), `public bot-health payload must not contain "${leak}"`);
  }
});

test("the grey tooltip says 'not wired up', not 'outage'", () => {
  const text = describeBotHealth(serviceHealth(UTILITY, NOW));
  assert.match(text, /not been wired/i, "grey is a configuration gap; calling it an outage cries wolf");
  assert.doesNotMatch(text, /offline|down/i);
});
