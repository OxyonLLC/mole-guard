// Regression test for the 2026-07-18 fix: runPayoutBatch() previously never
// synced storage.js's managed-JSON cache from Mongo (initMoleStorage() was
// only ever called by the main `mole` service, src/index.js), so this
// standalone worker process's wallet-link lookups always fell through to a
// local file THIS process never populated — resolveWallet() returned null
// for every user, every claim got skipped as "no_wallet", and the nightly
// summary always read "No eligible winnings" regardless of real pending
// balances. Confirmed live against production Mongo before fixing: 39 real
// unpaid claims and 7 real linked wallets existed the whole time.
//
// This test reproduces the exact failure shape: wallet-link and reward-
// history data written directly to disk (simulating data another process
// wrote previously), with THIS process's storage.js cache never separately
// warmed — proving runPayoutBatch() bootstraps it itself, without the
// caller needing to know to call initMoleStorage() first.
import "dotenv/config";

process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "game-payout-test-"));
process.env.DATA_DIR = scratchDir;
process.env.GAME_PAYOUTS_DRY_RUN = "true"; // never send a real transaction in a test
process.env.GAME_PAYOUT_MIN = "100";
process.env.WINLEW_MINT = "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";

const PAYABLE_USER = "999888777";
const PAYABLE_WALLET = "FakeWa11etAddressForTestingOnly1111111111";
const NO_WALLET_USER = "111222333";
const DUST_USER = "444555666";
const DUST_WALLET = "FakeWa11etAddressForTestingOnly2222222222";

// Simplest legacy shape (a plain string value) — normalizeLinkedWalletRecord
// in src/mole/walletLink.js upgrades this to a full { wallets: { verified:
// {...} } } record on read, so this alone is enough to prove resolution.
fs.writeFileSync(
  path.join(scratchDir, "linked_wallets.json"),
  JSON.stringify({ [PAYABLE_USER]: PAYABLE_WALLET, [DUST_USER]: DUST_WALLET }),
);

function claimRow(discordUserId, roundKey, payout) {
  return {
    discordUserId, app: "mole", game: "diglew", roundKey,
    roundLabel: "Test round", baseReward: payout, multiplier: 1, payout,
    wallet: null, meta: {}, claimedAt: new Date().toISOString(), paid: false,
  };
}
fs.writeFileSync(
  path.join(scratchDir, "game_reward_history.json"),
  JSON.stringify([
    claimRow(PAYABLE_USER, "round-1", 6169.03), // above min, has a wallet — must be paid
    claimRow(NO_WALLET_USER, "round-2", 500), // above min, NO linked wallet — must skip
    claimRow(DUST_USER, "round-3", 5), // below GAME_PAYOUT_MIN=100 — must skip
  ]),
);

const { runPayoutBatch } = await import("../../src/games/payout-worker.js");

describe("runPayoutBatch — storage bootstrap regression (fixed 2026-07-18)", () => {
  test("resolves a real linked wallet for a payable claim without the caller separately calling initMoleStorage()", async () => {
    const result = await runPayoutBatch();
    assert.equal(result.dryRun, true);
    assert.equal(result.plan.userCount, 1, "exactly the one payable user should be planned — not 0, which was the bug");

    const entry = result.plan.entries[0];
    assert.equal(entry.discordUserId, PAYABLE_USER);
    assert.equal(entry.wallet, PAYABLE_WALLET);
    assert.equal(entry.amount, 6169.03);
  });

  test("a user with no linked wallet is skipped with reason no_wallet, not silently dropped", async () => {
    const result = await runPayoutBatch();
    const skip = result.plan.skipped.find((s) => s.discordUserId === NO_WALLET_USER);
    assert.ok(skip, "the no-wallet user should appear in skipped, not vanish");
    assert.equal(skip.reason, "no_wallet");
  });

  test("a below-minimum claim is skipped with reason below_min, carried forward", async () => {
    const result = await runPayoutBatch();
    const skip = result.plan.skipped.find((s) => s.discordUserId === DUST_USER);
    assert.ok(skip, "the dust claim should appear in skipped");
    assert.equal(skip.reason, "below_min");
  });
});

// ── The held-payout alert must say WHY (2026-08-20) ────────────────────────
//
// Live batch gp-2026-08-20232052 announced a BANNED wallet to Discord as
// "1417.92 WinLEW (15 claims), over the undefined/user cap" and then advised
// raising GAME_PAYOUT_MAX_PER_USER or paying it manually. Both halves were
// wrong: the cap was not what held it, and following that advice would have
// paid a wallet on the sybil ban list.
//
// The "undefined" was the tell. payoutPlanner pushes a blocklist hold as
// { ...base, wallet, reason } with NO maxPayoutPerUser, while a cap hold
// carries it — and the message interpolated that field regardless of reason.
describe('buildHeldAlert: a blocked payout must never read as a cap problem', () => {
  const blockedRow = {
    discordUserId: 'wallet:94943b30aef10c3ee81387feceda439e',
    amount: 1417.92,
    claimCount: 15,
    reason: 'wallet_banned',
  };
  const cappedRow = {
    discordUserId: '1220049423548026952',
    amount: 40000,
    claimCount: 9,
    reason: 'over_max',
    maxPayoutPerUser: 25000,
  };

  test('a blocklist hold never prints "undefined", and never prints a cap', async () => {
    const { buildHeldAlert } = await import('../../src/games/payout-worker.js');
    const msg = buildHeldAlert('gp-test', [blockedRow]);
    assert.ok(!/undefined/.test(msg), `message leaked undefined:\n${msg}`);
    assert.ok(!/\/user cap/.test(msg), 'the cap is not what is holding this row');
    assert.match(msg, /BLOCKED/);
    assert.match(msg, /ban list/i, 'say which list it is on');
  });

  test('a blocklist hold must NOT advise raising the cap or paying manually', async () => {
    // This is the whole point. The old copy told a human to do exactly the one
    // thing that releases funds to a banned wallet.
    const { buildHeldAlert } = await import('../../src/games/payout-worker.js');
    const msg = buildHeldAlert('gp-test', [blockedRow]);
    assert.ok(!/raise .GAME_PAYOUT_MAX_PER_USER. for one run or pay manually/.test(msg),
      `blocked rows must not carry the cap remedy:\n${msg}`);
    assert.match(msg, /Do NOT pay them manually/);
  });

  test('a genuine cap hold still gets the cap remedy, with the real number', async () => {
    const { buildHeldAlert } = await import('../../src/games/payout-worker.js');
    const msg = buildHeldAlert('gp-test', [cappedRow]);
    assert.match(msg, /over the 25000\/user cap/);
    assert.match(msg, /raise `GAME_PAYOUT_MAX_PER_USER`/);
    assert.ok(!/BLOCKED/.test(msg));
  });

  test('a mixed batch keeps the two remedies apart', async () => {
    const { buildHeldAlert } = await import('../../src/games/payout-worker.js');
    const msg = buildHeldAlert('gp-test', [blockedRow, cappedRow]);
    assert.match(msg, /1 of these are BLOCKED/);
    assert.match(msg, /For the 1 cap hold/);
    assert.ok(!/undefined/.test(msg));
  });
});

// ── A confirmed ban is terminal (2026-08-21) ──────────────────────────────
//
// The planner HOLDS a blocked row so a human sees it. Correct the first time,
// noise every night after: the row returns to the queue on every run, and the
// owner watched the same banned wallet reappear night after night — "if he is
// on the ban list; dont pay him."
//
// So a real ban now takes the claims out of the queue for good. The two
// properties that matter are that it is NOT recorded as paid, and that it never
// fires on `blocklist_unavailable`.
describe('buildHeldAlert: a permanently withheld ban stops nagging', () => {
  const banned = {
    discordUserId: 'wallet:94943b30aef10c3ee81387feceda439e',
    amount: 1417.92, claimCount: 15, reason: 'wallet_banned',
  };

  test('the alert says the claims were withheld, and that nothing was paid', async () => {
    const { buildHeldAlert } = await import('../../src/games/payout-worker.js');
    const msg = buildHeldAlert('gp-test', [banned], [{ ...banned, updated: 15 }]);
    assert.match(msg, /withheld permanently/);
    assert.match(msg, /will NOT be reported again/);
    assert.match(msg, /marked withheld, not paid/, 'the ledger distinction has to be stated');
    assert.match(msg, /releaseWithheldClaims/, 'a permanent action must name its reversal');
  });

  test('a block that was NOT withheld still gets the investigate-first warning', async () => {
    const { buildHeldAlert } = await import('../../src/games/payout-worker.js');
    const msg = buildHeldAlert('gp-test', [{ ...banned, reason: 'blocklist_unavailable' }], []);
    assert.match(msg, /Do NOT pay them manually/);
    assert.ok(!/withheld permanently/.test(msg));
  });
});

describe('rewardHistory: withheld is not paid', () => {
  test('markClaimsWithheld sets withheld, and never sets paid', async () => {
    const src = readFileSync(new URL('../../src/mole/rewardHistory.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function markClaimsWithheld'), src.indexOf('export async function releaseWithheldClaims'));
    assert.match(fn, /withheld: true/);
    assert.ok(!/paid:\s*true/.test(fn),
      'marking a banned wallet paid would put a lie in the ledger the dashboard reads');
  });

  test('the unpaid queue excludes withheld rows in BOTH the mongo and file paths', async () => {
    const src = readFileSync(new URL('../../src/mole/rewardHistory.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function listUnpaidClaims'), src.indexOf('export async function reassignClaims'));
    assert.match(fn, /withheld:\s*\{\s*\$ne:\s*true\s*\}/, 'mongo path');
    assert.match(fn, /r\.withheld\s*!==\s*true/, 'file fallback path');
  });

  test('withholding is only wired to CONFIRMED bans, never to an unreadable list', async () => {
    // blocklist_unavailable means the ban list could not be READ. Withholding
    // on it would let one Mongo outage permanently void everyone's rewards.
    const src = readFileSync(new URL('../../src/games/payout-worker.js', import.meta.url), 'utf8');
    const guard = src.slice(src.indexOf('const terminalBlocks'), src.indexOf('const withheld = []'));
    assert.match(guard, /WALLET_BANNED/);
    assert.match(guard, /ACCOUNT_BANNED/);
    assert.ok(!/BLOCKLIST_UNAVAILABLE/.test(guard),
      'an unreadable blocklist must keep holding and retry, never withhold');
    assert.ok(!/NEEDS_IDENTITY_SYNC/.test(guard),
      'not syncing yet is a step not taken, not a ban — it must keep holding so it clears the moment they sync');
  });
});
