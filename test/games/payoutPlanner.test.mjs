// Unit tests for buildPayoutPlan's defense-in-depth ceiling (2026-07-19 audit).
// The worker signs real transactions, so any single user over the per-user
// max is HELD (left unpaid) for review instead of auto-paid — a last line of
// defense even if a forged/bugged claim gets past the reward validator.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPayoutPlan } from "../../src/games/payoutPlanner.js";

const wallet = () => "FakeWa11etAddressForTestingOnly1111111111";
// buildPayoutPlan's isBlocked default REFUSES everything (see the comment on
// the parameter). These ceiling tests are about the cap, not the blocklist, so
// they opt in explicitly rather than relying on a default that must stay unsafe.
const allow = () => null;
function row(discordUserId, roundKey, payout) {
  return { discordUserId, app: "mole", game: "diglew", roundKey, payout };
}

describe("buildPayoutPlan: per-user payout ceiling", () => {
  test("a user over maxPayoutPerUser is HELD, not paid, and rows are not lost", () => {
    const plan = buildPayoutPlan(
      [row("cheater", "r1", 50000)],
      wallet,
      { minPayout: 100, maxPayoutPerUser: 25000, isBlocked: allow },
    );
    assert.equal(plan.userCount, 0, "over-cap user must NOT be in the payable entries");
    assert.equal(plan.entries.length, 0);
    const held = plan.held.find((h) => h.discordUserId === "cheater");
    assert.ok(held, "over-cap user must appear in held for review");
    assert.equal(held.reason, "over_max");
    assert.equal(held.amount, 50000);
  });

  test("a user at or under the ceiling is paid normally", () => {
    const plan = buildPayoutPlan(
      [row("honest", "r1", 6169.03)],
      wallet,
      { minPayout: 100, maxPayoutPerUser: 25000, isBlocked: allow },
    );
    assert.equal(plan.userCount, 1);
    assert.equal(plan.held.length, 0);
    assert.equal(plan.entries[0].amount, 6169.03);
  });

  test("the ceiling sums a user's claims — many small claims that total over the cap are held", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row("farmer", `r${i}`, 3000)); // 30000 total
    const plan = buildPayoutPlan(rows, wallet, { minPayout: 100, maxPayoutPerUser: 25000, isBlocked: allow });
    assert.equal(plan.userCount, 0);
    const held = plan.held.find((h) => h.discordUserId === "farmer");
    assert.ok(held);
    assert.equal(held.amount, 30000);
    assert.equal(held.claimCount, 10);
  });

  test("maxPayoutPerUser=0 disables the ceiling (opt-out)", () => {
    const plan = buildPayoutPlan(
      [row("whale", "r1", 999999)],
      wallet,
      { minPayout: 100, maxPayoutPerUser: 0, isBlocked: allow },
    );
    assert.equal(plan.userCount, 1);
    assert.equal(plan.held.length, 0);
  });

  test("held is always an array even when unused, so callers can iterate safely", () => {
    const plan = buildPayoutPlan([row("u", "r1", 500)], wallet, { minPayout: 100, isBlocked: allow });
    assert.ok(Array.isArray(plan.held));
    assert.equal(plan.held.length, 0);
  });
});

describe("buildPayoutPlan: canonical identities", () => {
  test("combines unpaid rows from merged aliases into one payout", () => {
    const canonical = (id) => id === "wallet:old" ? "discord:person" : id;
    const plan = buildPayoutPlan(
      [row("wallet:old", "old-1", 700), row("discord:person", "new-1", 900)],
      (id) => id === "discord:person" ? "wallet-address" : null,
      { minPayout: 100, isBlocked: allow, resolveAccountId: canonical },
    );
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].discordUserId, "discord:person");
    assert.equal(plan.entries[0].amount, 1600);
    assert.equal(plan.entries[0].claimCount, 2);
    assert.equal(plan.entries[0].rowKeys.length, 2);
  });
});
