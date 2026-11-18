// Startup configuration parsing, pinned. Written for the zod 3 -> 4 migration
// (2026-11-12): 16 env vectors x the mole, shared and watchdog schemas gave
// identical results on zod 3.25.76 and 4.6.7. Only log wording differed.
// These assertions are version-independent, so a future zod change that
// alters a decision fails here instead of at a production restart.
import test from "node:test";
import assert from "node:assert/strict";

const REQ = { DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "c", DISCORD_CLIENT_SECRET: "s",
  DISCORD_REDIRECT_URI: "https://winlew.co/callback", WINLEW_MINT: "So11111111111111111111111111111111111111112" };
const mole = await import("../../src/mole/config.js");
const shared = await import("../../src/shared/config.js");

function withEnv(env, fn) {
  const saved = process.env; const err = console.error;
  process.env = { ...env }; console.error = () => {};
  try { return fn(); } finally { process.env = saved; console.error = err; }
}
const ok = (env) => withEnv(env, () => mole.getConfig());
const fails = (env) => assert.throws(() => withEnv(env, () => mole.getConfig()), /Invalid configuration/);

test("minimal env parses with the documented defaults", () => {
  const c = ok(REQ);
  assert.equal(c.PORT, 8787);
  assert.equal(c.SITE_BASE_URL, "https://winlew.co");
  assert.equal(c.PUBLIC_BASE_URL, "https://REPLACE_WITH_YOUR_API_DOMAIN");
  assert.equal(c.THRESHOLD_1M, 1_000_000);
  assert.equal(c.DATA_DIR, "./data");
});

test("numbers are coerced from strings", () => {
  const c = ok({ ...REQ, PORT: "8790", THRESHOLD_10M: "5", HEARTBEAT_INTERVAL_SEC: "30" });
  assert.equal(c.PORT, 8790); assert.equal(c.THRESHOLD_10M, 5); assert.equal(c.HEARTBEAT_INTERVAL_SEC, 30);
});

test("invalid values are rejected", () => {
  fails({ DISCORD_TOKEN: "t" });                         // required keys missing
  fails({ ...REQ, DISCORD_TOKEN: "" });                  // min(1)
  fails({ ...REQ, DISCORD_REDIRECT_URI: "winlew.co/cb" }); // not a URL
  fails({ ...REQ, PORT: "abc" });
  fails({ ...REQ, PORT: "0" });                          // positive()
  fails({ ...REQ, PORT: "80.5" });                       // int()
  fails({ ...REQ, VERIFICATION_WEBHOOK_URL: "" });       // optional URL: "" is not a URL
});

test("an empty value is allowed where the schema says so", () => {
  assert.equal(ok({ ...REQ, GOVERNANCE_WEBHOOK_URL: "" }).GOVERNANCE_WEBHOOK_URL, "");
});

test("local URLs are accepted (staging and the relay)", () => {
  const c = ok({ ...REQ, DISCORD_REDIRECT_URI: "http://localhost:8787/callback", PUBLIC_BASE_URL: "http://127.0.0.1:8787" });
  assert.equal(c.PUBLIC_BASE_URL, "http://127.0.0.1:8787");
});

test("unknown keys are stripped by the mole schema and kept by the shared one", () => {
  assert.equal("UNRELATED_VAR" in ok({ ...REQ, UNRELATED_VAR: "x" }), false);
  const s = withEnv({ UNRELATED_VAR: "x", PORT: "9" }, () => shared.getConfig());
  assert.equal(s.UNRELATED_VAR, "x"); assert.equal(s.PORT, 9);
});
