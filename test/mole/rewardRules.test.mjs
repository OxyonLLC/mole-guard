// Security regression tests for the reward-claim validator (2026-07-19 audit).
// The headline finding: in `shadow` mode the CAPS were log-only, so a forged
// baseReward banked in full and got paid by the nightly worker. Default moved
// to `clamp`; these lock in that (a) injection is always closed and (b) clamp
// actually enforces the caps.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateRewardClaim, getRewardRulesConfig, resolveRewardMode, GAME_REWARD_SCALES } from "../../src/mole/rewardRules.js";

// An env with NOTHING set — proves the *default* is safe, since production
// relies on the default when the var is absent or typo'd.
const DEFAULT_CFG = getRewardRulesConfig({});

describe("rewardRules: safe default mode", () => {
  test("an unset REWARD_VALIDATION_MODE defaults to clamp, not shadow", () => {
    assert.equal(getRewardRulesConfig({}).mode, "clamp");
  });

  test("a garbage mode value falls back to clamp, never shadow", () => {
    assert.equal(getRewardRulesConfig({ REWARD_VALIDATION_MODE: "banana" }).mode, "clamp");
  });
});

describe("rewardRules: resolveRewardMode shadow guard", () => {
  test("shadow WITHOUT the ack env silently downgrades to clamp", () => {
    const r = resolveRewardMode({ REWARD_VALIDATION_MODE: "shadow" });
    assert.equal(r.requested, "shadow");
    assert.equal(r.effective, "clamp");
    assert.equal(r.acknowledged, false);
    // getRewardRulesConfig honors the downgrade too.
    assert.equal(getRewardRulesConfig({ REWARD_VALIDATION_MODE: "shadow" }).mode, "clamp");
  });

  test("shadow WITH REWARD_ALLOW_SHADOW=true is honored (deliberate rollout)", () => {
    const r = resolveRewardMode({ REWARD_VALIDATION_MODE: "shadow", REWARD_ALLOW_SHADOW: "true" });
    assert.equal(r.effective, "shadow");
    assert.equal(r.acknowledged, true);
  });

  test("clamp/reject are unaffected by the ack flag", () => {
    assert.equal(resolveRewardMode({ REWARD_VALIDATION_MODE: "reject" }).effective, "reject");
    assert.equal(resolveRewardMode({ REWARD_VALIDATION_MODE: "clamp", REWARD_ALLOW_SHADOW: "true" }).effective, "clamp");
  });
});

describe("rewardRules: payout injection is always closed", () => {
  test("a client payout wildly higher than base*mult is recomputed, never trusted", () => {
    // diglew's scale is 0.75, so base 100 * 0.75 * 1 = 75 is what gets banked.
    // (This comment previously said "diglew scale 0.08 ... = 8" — 0.08 is
    // grubdrop's scale, not diglew's. The assertion below is `< 100`, so the
    // test passed either way, but anyone tightening it to the documented 8
    // would have been chasing a phantom.)
    const v = validateRewardClaim(
      { game: "diglew", baseReward: 100, multiplier: 1, payout: 9_999_999 },
      DEFAULT_CFG,
    );
    assert.ok(v.flags.includes("payout_mismatch"));
    assert.ok(v.bankedPayout < 100, `banked ${v.bankedPayout} must ignore the forged payout`);
  });

  test("an unknown multiplier is snapped to the nearest allowed reward-box value", () => {
    const v = validateRewardClaim(
      { game: "diglew", baseReward: 100, multiplier: 999, payout: 0 },
      DEFAULT_CFG,
    );
    assert.ok(v.flags.includes("bad_multiplier"));
    assert.ok([0.5, 1, 1.5, 2].includes(v.serverMultiplier));
  });
});

describe("rewardRules: clamp mode enforces the caps (the fix)", () => {
  test("a forged huge baseReward is CLAMPED to the per-claim ceiling, not banked whole", () => {
    // The exact audit exploit: verified user posts an enormous baseReward.
    const v = validateRewardClaim(
      { game: "diglew", baseReward: 1_000_000, multiplier: 2, payout: 0,
        recentStats: { dailyPayout: 0, hourlyClaims: 0 } },
      getRewardRulesConfig({ REWARD_VALIDATION_MODE: "clamp" }),
    );
    assert.ok(v.flags.includes("base_over_cap"));
    // perClaimMaxPayout default 2500 — banked amount can never exceed it.
    assert.ok(v.bankedPayout <= 2500, `clamp must cap at 2500, got ${v.bankedPayout}`);
  });

  test("shadow mode does NOT clamp — proving why it was unsafe (documents the risk)", () => {
    // Must explicitly acknowledge shadow now, or the guard downgrades to clamp.
    const v = validateRewardClaim(
      { game: "diglew", baseReward: 1_000_000, multiplier: 2, payout: 0,
        recentStats: { dailyPayout: 0, hourlyClaims: 0 } },
      getRewardRulesConfig({ REWARD_VALIDATION_MODE: "shadow", REWARD_ALLOW_SHADOW: "true" }),
    );
    // Flags are raised but the full amount is still banked — this is the drain.
    assert.ok(v.flags.includes("base_over_cap"));
    assert.ok(v.bankedPayout > 2500, "shadow banks the whole forged amount — do not run it in prod");
  });

  test("honest play stays unflagged and unclamped under clamp mode", () => {
    // diglew base 200 (a normal mid-run), *1.5 box = 300, well under all caps.
    const v = validateRewardClaim(
      { game: "diglew", baseReward: 200, multiplier: 1.5, payout: round2(200 * 0.75 * 1.5),
        recentStats: { dailyPayout: 0, hourlyClaims: 0 } },
      getRewardRulesConfig({ REWARD_VALIDATION_MODE: "clamp" }),
    );
    assert.equal(v.flags.length, 0, `honest claim should have no flags, got ${v.flags}`);
    assert.ok(v.ok);
  });

  test("clamp also enforces the rolling daily cap", () => {
    // Already near the 4500 daily cap; a new legit claim is clamped to the remainder.
    const v = validateRewardClaim(
      { game: "diglew", baseReward: 1000, multiplier: 2, payout: 0,
        recentStats: { dailyPayout: 4400, hourlyClaims: 1 } },
      getRewardRulesConfig({ REWARD_VALIDATION_MODE: "clamp" }),
    );
    assert.ok(v.flags.includes("daily_cap"));
    assert.ok(v.bankedPayout <= 100, `only ~100 of the daily budget remained, got ${v.bankedPayout}`);
  });
});

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Added 2026-08-05 during the /mole-hub/ folder audit. GAME_REWARD_SCALES is
// declared TWICE — once here in rewardRules.js (the server, which decides what
// actually gets banked) and once in src/public/mole-hub/js/app.js (the browser,
// which decides the number the player is shown). Nothing tied them together, so
// editing one silently desynced the other: every claim would then arrive with a
// payout the server disagrees with, get flagged `payout_mismatch` and clamped,
// and players would see a number they never receive.
//
// Parsed rather than imported because app.js is a browser script, not a module.
describe("rewardRules: the client's copy of GAME_REWARD_SCALES cannot drift", () => {
  test("mole-hub/js/app.js declares exactly the same scales as the server", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const appJs = readFileSync(join(here, "../../src/public/mole-hub/js/app.js"), "utf8");

    const block = appJs.match(/GAME_REWARD_SCALES\s*=\s*Object\.freeze\(\{([^}]*)\}\)/);
    assert.ok(block, "could not find GAME_REWARD_SCALES in mole-hub/js/app.js");

    const clientScales = {};
    for (const [, key, value] of block[1].matchAll(/(\w+)\s*:\s*([0-9.]+)/g)) {
      clientScales[key] = Number(value);
    }

    assert.deepEqual(
      clientScales,
      { ...GAME_REWARD_SCALES },
      "mole-hub/js/app.js and src/mole/rewardRules.js disagree about GAME_REWARD_SCALES — " +
        "update BOTH, or players will be shown payouts the server will not bank",
    );
  });
});
