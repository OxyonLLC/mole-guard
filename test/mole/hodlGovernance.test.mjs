// HODL Rewards — turning a vote into an epoch.
//
// This is the mechanism by which people OTHER than the maintainers change how
// much money leaves the treasury. Spec §8's rule is absolute: a vote must never
// be capable of authorising an unlimited payout. Nearly every test here is an
// attempt to make it do exactly that.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { epochFromProposal, parseEpochProposal, describeEpochChange, EPOCH_PARAM_KEYS } from "../../src/mole/hodlGovernance.js";
import { LIMITS, EPOCH_STATUS, DEFAULT_EPOCH_PARAMS } from "../../src/mole/hodlEpochs.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const START = new Date(2026, 8, 1).getTime();
const OPTS = { id: "E2", startMs: START, endMs: START + 13 * WEEK };

const passed = (epochParams, over = {}) => ({
  id: "gov-hodl-e2", title: "HODL Rewards — epoch 2", status: "passed",
  governanceMode: "binding-within-defined-policy", epochParams, ...over,
});

describe("a vote cannot authorise an unlimited payout", () => {
  test("a pool above the hard ceiling is REFUSED, not clamped", () => {
    // Clamping would pay out something nobody voted for while looking like the
    // vote was honoured. Refusing forces someone to say out loud that the vote
    // exceeded policy.
    const res = epochFromProposal(passed({ weeklyPool: 1_000_000 }), OPTS);
    assert.equal(res.ok, false);
    assert.match(res.errors.join(" "), /above the hard ceiling/);
    assert.match(res.errors.join(" "), /NOT clamped/);
  });

  test("the ceiling itself is not votable", () => {
    // A proposal trying to raise the cap gets the cap ignored and the pool
    // judged against the real one.
    const res = epochFromProposal(passed({ weeklyPool: 999_999, MAX_WEEKLY_POOL: 1e9 }), OPTS);
    assert.equal(res.ok, false);
    assert.ok(res.ignored.includes("MAX_WEEKLY_POOL"));
  });

  test("a PoV tier above the ceiling is refused", () => {
    const res = epochFromProposal(passed({ povBonusTiers: [{ minScore: 0, multiplier: 3 }] }), OPTS);
    assert.equal(res.ok, false);
    assert.match(res.errors.join(" "), /exceeds/);
  });

  test("a pool exactly at the ceiling is allowed", () => {
    // The limit is a limit, not a fence to stay well clear of.
    const res = epochFromProposal(passed({ weeklyPool: LIMITS.MAX_WEEKLY_POOL }), OPTS);
    assert.equal(res.ok, true, res.errors?.join("; "));
  });

  test("a non-numeric pool is refused rather than coerced", () => {
    assert.equal(epochFromProposal(passed({ weeklyPool: "loads" }), OPTS).ok, false);
  });
});

describe("only an allowlist of parameters is votable", () => {
  test("unknown fields are ignored and reported, never applied", () => {
    // A field nobody anticipated must not become a setting nobody reviewed.
    const { params, ignored } = parseEpochProposal(passed({
      weeklyPool: 10_000, payoutDay: 5, status: "active", id: "hijacked", startMs: 0,
    }));
    assert.deepEqual(Object.keys(params), ["weeklyPool"]);
    assert.deepEqual(ignored.sort(), ["id", "payoutDay", "startMs", "status"]);
  });

  test("the allowlist is exactly what a community should decide", () => {
    assert.deepEqual([...EPOCH_PARAM_KEYS].sort(), ["minHold", "povBonusTiers", "weeklyPool"]);
  });

  test("a vote cannot set the epoch's status", () => {
    const res = epochFromProposal(passed({ weeklyPool: 10_000, status: "active" }), OPTS);
    assert.equal(res.epoch.status, EPOCH_STATUS.DRAFT, "a vote activated its own epoch");
  });
});

describe("a passed vote produces a DRAFT, never a live epoch", () => {
  test("the result is always a draft", () => {
    const res = epochFromProposal(passed({ weeklyPool: 12_000 }), OPTS);
    assert.equal(res.ok, true);
    assert.equal(res.epoch.status, EPOCH_STATUS.DRAFT);
  });

  test("the epoch records which vote decided it", () => {
    // So the page can say WHY these numbers are these numbers, and a reader can
    // find the vote instead of taking it on trust.
    const res = epochFromProposal(passed({ weeklyPool: 12_000 }), OPTS);
    assert.equal(res.epoch.decidedBy.proposalId, "gov-hodl-e2");
    assert.match(res.epoch.decidedBy.title, /epoch 2/);
  });

  test("unspecified parameters fall back to the defaults", () => {
    const res = epochFromProposal(passed({ weeklyPool: 12_000 }), OPTS);
    assert.equal(res.epoch.minHold, DEFAULT_EPOCH_PARAMS.minHold);
    assert.equal(res.epoch.payoutDay, DEFAULT_EPOCH_PARAMS.payoutDay);
  });
});

describe("only a decided vote counts", () => {
  test("a draft, active or rejected proposal cannot become an epoch", () => {
    for (const status of ["draft", "review", "discussion", "active", "rejected", "cancelled"]) {
      const res = epochFromProposal(passed({ weeklyPool: 10_000 }, { status }), OPTS);
      assert.equal(res.ok, false, `a "${status}" proposal was allowed to set an epoch`);
      assert.match(res.errors.join(" "), /only a passed vote/);
    }
  });

  test("passed and executed both count", () => {
    for (const status of ["passed", "executed"]) {
      assert.equal(epochFromProposal(passed({ weeklyPool: 10_000 }, { status }), OPTS).ok, true);
    }
  });

  test("a proposal with no parameters is refused", () => {
    const res = epochFromProposal({ id: "x", status: "passed" }, OPTS);
    assert.equal(res.ok, false);
    assert.match(res.errors.join(" "), /no epochParams/);
  });
});

describe("the review summary", () => {
  test("changes are shown against what is running now", () => {
    // "10,000" means nothing without knowing whether that is a rise or a fall.
    const lines = describeEpochChange(passed({ weeklyPool: 15_000, minHold: 1_000 }),
      { weeklyPool: 10_000, minHold: 1_000 });
    assert.match(lines.join("\n"), /10,000 WinLEW → 15,000 WinLEW/);
    assert.match(lines.join("\n"), /unchanged/);
  });

  test("ignored fields are surfaced to the reviewer", () => {
    const lines = describeEpochChange(passed({ weeklyPool: 10_000, payoutDay: 4 }));
    assert.match(lines.join("\n"), /Ignored \(not votable\): payoutDay/);
  });

  test("a proposal with nothing to change says so", () => {
    assert.match(describeEpochChange({ id: "x" }).join(""), /No epoch parameters/);
  });
});
