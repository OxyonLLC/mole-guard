// The blocklist check that stands in front of every fund release.
//
// The bug this exists to prevent is not subtle once seen: game payouts had NO
// ban check at all, so a wallet banned from the faucet for sybil abuse was
// still paid its winnings by a nightly worker that signs real transactions.
// The tests that matter most here are the fail-closed ones — an unreadable ban
// list must never behave like an empty one.
// The identity check reads a managed store, which resolves DATA_DIR through
// config.js's zod-validated getConfig(). This file never goes through
// src/index.js, so the keys that loader guarantees are stubbed here.
process.env.DISCORD_TOKEN ||= "test";
process.env.DISCORD_CLIENT_ID ||= "test";
process.env.DISCORD_CLIENT_SECRET ||= "test";
process.env.DISCORD_REDIRECT_URI ||= "http://localhost/cb";
process.env.WINLEW_MINT ||= "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";
process.env.MONGO_ENABLED = "false";

import test from "node:test";
import assert from "node:assert/strict";
import {
  PAYOUT_BLOCK_REASONS,
  checkAgainstBlocklist,
  describePayoutBlock,
  checkPayoutEligibility,
} from "../../src/services/payoutGate.js";
import { buildPayoutPlan } from "../../src/games/payoutPlanner.js";

const WALLET = "FakeWa11etAddressForTestingOnly1111111111";
const list = ({ wallets = [], users = [] } = {}) => ({ ok: true, wallets: new Set(wallets), users: new Set(users) });

test("a banned wallet is blocked", () => {
  const r = checkAgainstBlocklist({ wallet: WALLET, discordUserId: "u1" }, list({ wallets: [WALLET] }));
  assert.equal(r, PAYOUT_BLOCK_REASONS.WALLET_BANNED);
});

test("a banned account is blocked even when its wallet is clean", () => {
  // Banning the person has to outlive them switching wallets, which is the
  // entire reason account bans exist alongside wallet bans.
  const r = checkAgainstBlocklist({ wallet: WALLET, discordUserId: "u1" }, list({ users: ["u1"] }));
  assert.equal(r, PAYOUT_BLOCK_REASONS.ACCOUNT_BANNED);
});

test("a clean pair is allowed", () => {
  assert.equal(checkAgainstBlocklist({ wallet: WALLET, discordUserId: "u1" }, list()), null);
});

test("an unreadable blocklist BLOCKS — it must never read as an empty one", () => {
  // The live ban list was silently emptied on 2026-08-15 and every consumer
  // carried on as if it were simply clean. Treating a failed load as "nobody is
  // banned" reproduces that failure on the payout path, where it costs money
  // that cannot be recalled.
  for (const broken of [null, undefined, {}, { ok: false }, { ok: false, wallets: new Set(), users: new Set() }]) {
    assert.equal(
      checkAgainstBlocklist({ wallet: WALLET, discordUserId: "u1" }, broken),
      PAYOUT_BLOCK_REASONS.BLOCKLIST_UNAVAILABLE,
      `a blocklist of ${JSON.stringify(broken)} must block, not allow`
    );
  }
});

test("every block reason has a human explanation", () => {
  for (const reason of Object.values(PAYOUT_BLOCK_REASONS)) {
    const text = describePayoutBlock(reason);
    assert.ok(text && text !== "payout blocked", `${reason} needs its own line, not the fallback`);
  }
});

// ── Integration with the planner ──────────────────────────────────────────────

const row = (discordUserId, roundKey, payout) => ({ discordUserId, app: "mole", game: "diglew", roundKey, payout });

test("a blocked user is HELD, and their funds stay on the bot", () => {
  const plan = buildPayoutPlan([row("cheat", "r1", 5000)], () => WALLET, {
    minPayout: 100,
    isBlocked: () => PAYOUT_BLOCK_REASONS.WALLET_BANNED,
  });
  assert.equal(plan.userCount, 0, "a banned user must not be in the payable entries");
  assert.equal(plan.totalToPay, 0);
  const held = plan.held.find((h) => h.discordUserId === "cheat");
  assert.ok(held, "must be HELD, not skipped — a skip silently retries every night forever");
  assert.equal(held.reason, PAYOUT_BLOCK_REASONS.WALLET_BANNED);
  assert.equal(held.amount, 5000);
});

test("the block is checked before the min-payout floor", () => {
  // Otherwise a banned user under the floor is filed as "below_min" and never
  // shows up as a ban in any report.
  const plan = buildPayoutPlan([row("cheat", "r1", 5)], () => WALLET, {
    minPayout: 1500,
    isBlocked: () => PAYOUT_BLOCK_REASONS.WALLET_BANNED,
  });
  assert.equal(plan.held.length, 1);
  assert.equal(plan.held[0].reason, PAYOUT_BLOCK_REASONS.WALLET_BANNED);
  assert.equal(plan.skipped.length, 0, "must not be misfiled as below_min");
});

test("omitting isBlocked blocks EVERYONE rather than paying unchecked", () => {
  // The unsafe default is the whole point: a caller that forgets the blocklist
  // produces a run that pays nobody and is noticed immediately, instead of one
  // that quietly pays banned wallets — which is precisely the state this
  // parameter was added to end.
  const plan = buildPayoutPlan([row("anyone", "r1", 5000)], () => WALLET, { minPayout: 100 });
  assert.equal(plan.userCount, 0);
  assert.equal(plan.held.length, 1);
});

// ── The identity requirement (2026-08-21) ─────────────────────────────────
//
// The wallet is the account, and connecting one is free. Being PAID is what
// requires a person behind it: a wallet costs nothing to generate, so it can
// never be evidence of one, while a Discord or X account not already attached
// to another WinLEW account can be.
//
// checkPayoutEligibility() composes the ban check and the identity check.
// checkAgainstBlocklist() stays exactly what its name says — folding the
// identity rule into it broke "a clean pair is allowed", a test that was right
// to break, because a clean pair IS clean as far as the blocklist goes.
test("a ban outranks a missing identity — they need opposite responses", () => {
  const r = checkPayoutEligibility({ wallet: WALLET, discordUserId: "u1" }, list({ wallets: [WALLET] }));
  assert.equal(r, PAYOUT_BLOCK_REASONS.WALLET_BANNED,
    'a banned wallet with no identity synced must read as BANNED, not as an unfinished signup');
});

test("an account keyed by a Discord snowflake passes with no synced record", () => {
  // Every account predating this rule is keyed that way; the id is the proof.
  // Requiring them to re-sync would have locked out every current participant.
  assert.equal(checkPayoutEligibility({ wallet: WALLET, discordUserId: "1220049423548026952" }, list()), null);
});

test("a wallet-rooted account with nothing synced is held, not banned", () => {
  const r = checkPayoutEligibility({ wallet: WALLET, discordUserId: "wallet:94943b30aef10c3ee81387feceda439e" }, list());
  assert.equal(r, PAYOUT_BLOCK_REASONS.NEEDS_IDENTITY_SYNC);
  assert.notEqual(r, PAYOUT_BLOCK_REASONS.WALLET_BANNED);
  assert.notEqual(r, PAYOUT_BLOCK_REASONS.ACCOUNT_BANNED);
});

test("an unreadable blocklist still wins over the identity check", () => {
  // Failing closed on the ban list must not be downgraded to a friendlier
  // "just go and sync" message that invites someone to release the funds.
  const r = checkPayoutEligibility({ wallet: WALLET, discordUserId: "wallet:abc" }, { ok: false });
  assert.equal(r, PAYOUT_BLOCK_REASONS.BLOCKLIST_UNAVAILABLE);
});

test("the refusal explains itself as a step not taken, never as a ban", () => {
  const text = describePayoutBlock(PAYOUT_BLOCK_REASONS.NEEDS_IDENTITY_SYNC);
  assert.match(text, /synced/i);
  assert.ok(!/ban/i.test(text), 'calling this a ban would send a legitimate newcomer to an appeal form');
});
