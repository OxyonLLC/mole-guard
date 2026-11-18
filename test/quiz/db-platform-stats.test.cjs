'use strict';

// Integration test against the REAL src/quiz/db.js, pointed at a disposable
// QUIZ_DATA_DIR (plus FAUCET_DATA_DIR / LINKED_WALLETS_DIRS for the wallet
// lookups redemption.js performs) so it never reads, moves or writes the real
// src/quiz/data/db.json. It used to move that file aside and restore it,
// which corrupted real data twice when another file raced the swap.
//
// switchCycleCadence() tests below mutate GLOBAL cycle state; that is safe
// here only because the whole store is a fresh temp directory.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const os = require('node:os');

// Protected db.json integrity belongs to the external pre/post audit wrapper.
assert.equal(process.env.WINLEW_TEST_ISOLATED, '1', 'run through the isolated audit wrapper');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'winlew-quiz-db-test-'));
process.env.QUIZ_DATA_DIR = path.join(TEMP_ROOT, 'quiz');
process.env.FAUCET_DATA_DIR = path.join(TEMP_ROOT, 'faucet');
process.env.LINKED_WALLETS_DIRS = [path.join(TEMP_ROOT, 'src-data'), path.join(TEMP_ROOT, 'root-data')].join(path.delimiter);
process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';
const DB_PATH = path.join(process.env.QUIZ_DATA_DIR, 'db.json');


let db;
let redemption;
const TEST_USER = `__test_platform_stats_${Date.now()}_${Math.random().toString(16).slice(2)}__`;

before(() => {
  delete require.cache[require.resolve(path.join('..', '..', 'src', 'quiz', 'db.js'))];
  delete require.cache[require.resolve(path.join('..', '..', 'src', 'quiz', 'redemption.js'))];
  db = require(path.join('..', '..', 'src', 'quiz', 'db.js'));
  redemption = require(path.join('..', '..', 'src', 'quiz', 'redemption.js'));
  // db.js's own init() creates a fresh default db.json in QUIZ_DATA_DIR the
  // first time anything reads/writes.
});

after(() => {
  assert.ok(TEMP_ROOT.startsWith(os.tmpdir()), 'cleanup target must stay inside the OS temp directory');
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

test('recordPlatformAnswer persists and accumulates correctly for one platform', () => {
  const first = db.recordPlatformAnswer(TEST_USER, 'web', { correct: true, points: 100 });
  assert.equal(first.points, 100);
  assert.equal(first.total, 1);
  assert.equal(first.currentStreak, 1);

  const second = db.recordPlatformAnswer(TEST_USER, 'web', { correct: false });
  assert.equal(second.points, 100, 'wrong answer must not add points');
  assert.equal(second.total, 2);
  assert.equal(second.currentStreak, 0, 'streak resets on a wrong answer');
  assert.equal(second.bestStreak, 1);
});

test('discord and web buckets are tracked independently for the same user', () => {
  db.recordPlatformAnswer(TEST_USER, 'discord', { correct: true, points: 225 });
  const stats = db.getUserPlatformStats(TEST_USER);
  assert.equal(stats.discord.points, 225);
  assert.ok(stats.web.points > 0, 'web points from the previous test must still be there');
  assert.notEqual(stats.discord.points, stats.web.points, 'the two platforms must not be merged');
});

test('recordPlatformAnswer rejects an invalid platform name', () => {
  assert.throws(() => db.recordPlatformAnswer(TEST_USER, 'mobile', { correct: true }));
});

test('topUsersByPlatform surfaces the test user with correct rank fields', () => {
  const rows = db.topUsersByPlatform('web', 100);
  const mine = rows.find((r) => r.userId === TEST_USER);
  assert.ok(mine, 'test user must appear in the web leaderboard');
  assert.ok(mine.rank >= 1);
  assert.equal(mine.total, 2);
  assert.equal(mine.correct, 1);
  assert.equal(mine.accuracy, 0.5);
});

test('getPlatformComparisonStats includes the test user in both platform totals', () => {
  const cmp = db.getPlatformComparisonStats();
  assert.ok(cmp.web.participants >= 1);
  assert.ok(cmp.discord.participants >= 1);
  assert.ok(cmp.web.totalPoints >= 100);
  assert.ok(cmp.discord.totalPoints >= 225);
});

test('recordPlatformAnswer never touches the payout-eligible points/cycles fields', () => {
  const before1 = db.getUser(TEST_USER);
  db.recordPlatformAnswer(TEST_USER, 'web', { correct: true, points: 999 });
  const after1 = db.getUser(TEST_USER);
  assert.equal(before1.points, after1.points, 'payout-eligible points must be unaffected by platform tracking');
  assert.equal(before1.lifetimePoints, after1.lifetimePoints);
});

test('recordTierAnswer persists and accumulates correctly for one tier', () => {
  const first = db.recordTierAnswer(TEST_USER, 'easy', { correct: true, points: 100 });
  assert.equal(first.points, 100);
  assert.equal(first.total, 1);
  assert.equal(first.currentStreak, 1);

  const second = db.recordTierAnswer(TEST_USER, 'easy', { correct: false });
  assert.equal(second.points, 100, 'wrong answer must not add points');
  assert.equal(second.total, 2);
  assert.equal(second.currentStreak, 0);
});

test('each tier bucket is tracked independently for the same user', () => {
  db.recordTierAnswer(TEST_USER, 'hard', { correct: true, points: 225 });
  db.recordTierAnswer(TEST_USER, 'sponsor', { correct: true, points: 125 });
  const stats = db.getUserTierStats(TEST_USER);
  assert.equal(stats.easy.total, 2, 'from the previous test');
  assert.equal(stats.hard.points, 225);
  assert.equal(stats.sponsor.points, 125);
  assert.equal(stats.medium.total, 0, 'never answered — must stay zeroed, not undefined');
});

test('recordTierAnswer rejects an invalid tier name', () => {
  assert.throws(() => db.recordTierAnswer(TEST_USER, 'impossible', { correct: true }));
});

test('recordTierAnswer never touches the payout-eligible points/cycles fields', () => {
  const before1 = db.getUser(TEST_USER);
  db.recordTierAnswer(TEST_USER, 'easy', { correct: true, points: 999 });
  const after1 = db.getUser(TEST_USER);
  assert.equal(before1.points, after1.points, 'payout-eligible points must be unaffected by tier tracking');
  assert.equal(before1.lifetimePoints, after1.lifetimePoints);
});

test('addSponsorPoints still credits the same payout-eligible points pool as addPoints', () => {
  const before1 = db.getUser(TEST_USER);
  db.addSponsorPoints(TEST_USER, 'xyo', 125);
  const after1 = db.getUser(TEST_USER);
  assert.equal(after1.points, before1.points + 125, 'sponsor points must count toward the same payout pool');
  assert.equal(after1.sponsor.xyo, 125, 'and also keep the per-sponsor breakdown');
});

test('the suite writes only to the temp QUIZ_DATA_DIR, never the real db.json', () => {
  assert.ok(fs.existsSync(DB_PATH), 'the synthetic store must live in the temp directory');
});

// getUserRank (Version 2.2 dashboard) — kept in THIS file rather than a
// separate one deliberately: node --test runs test files concurrently by
// default, and a second file doing its own backup/restore dance against
// this same real, non-configurable db.json path raced with this file's
// sequence and corrupted it (proven while building this feature — the
// symptom was "web points from the previous test must still be there"
// failing intermittently). One file, one shared before/after lifecycle,
// distinct synthetic user IDs — no race possible.
const RANK_HIGH_USER = `__test_rank_high_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
const RANK_LOW_USER = `__test_rank_low_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
const RANK_NEVER_PLAYED_USER = `__test_rank_never_${Date.now()}_${Math.random().toString(16).slice(2)}__`;

test('getUserRank: a user with no lifetime points is not ranked (null, not a misleading number)', () => {
  assert.equal(db.getUserRank(RANK_NEVER_PLAYED_USER), null);
});

test('getUserRank: a real playing user gets a rank and a totalRankedPlayers count', () => {
  db.addPoints(RANK_HIGH_USER, 5000);
  const result = db.getUserRank(RANK_HIGH_USER);
  assert.ok(result, 'a user with lifetime points must be ranked');
  assert.ok(result.rank >= 1);
  assert.ok(result.totalRankedPlayers >= 1);
});

test('getUserRank: higher lifetime points ranks better (lower rank number), matching topUsers order', () => {
  db.addPoints(RANK_HIGH_USER, 10_000);
  db.addPoints(RANK_LOW_USER, 10);

  const high = db.getUserRank(RANK_HIGH_USER);
  const low = db.getUserRank(RANK_LOW_USER);
  assert.ok(high.rank < low.rank, 'the higher-scoring user must have a numerically better (lower) rank');

  const top = db.topUsers(1);
  assert.equal(top[0].userId, RANK_HIGH_USER, 'the #1 topUsers entry must agree with rank #1');
});

test('getUserRank: rank agrees exactly with topUsers ordering for both test users', () => {
  const all = db.topUsers(1000);
  const expectedHighRank = all.findIndex((u) => u.userId === RANK_HIGH_USER) + 1;
  const expectedLowRank = all.findIndex((u) => u.userId === RANK_LOW_USER) + 1;
  assert.equal(db.getUserRank(RANK_HIGH_USER).rank, expectedHighRank);
  assert.equal(db.getUserRank(RANK_LOW_USER).rank, expectedLowRank);
});

// These exercise the ON-DEMAND redemption path, which became system-only by
// default on 2026-08-14 (see QUIZ_MANUAL_REDEEM_ENABLED). They still describe
// real behaviour — the gates below are what runs whenever manual redeeming is
// deliberately re-opened — so they declare the mode rather than being deleted.
// Set here rather than globally so a test that forgets is a test that fails.
process.env.QUIZ_MANUAL_REDEEM_ENABLED = 'true';

// Web quiz-point redemption (redeemQuizPoints, src/quiz/redemption.js) — kept
// in THIS file for the exact same reason getUserRank's tests are: one
// shared before/after lifecycle against the real, non-configurable db.json,
// distinct synthetic user IDs, no cross-file lock-cleanup race. A separate
// redemption.test.cjs file with its own backup/restore raced this file's
// after() hook over the same db.json.lock (both try to unlinkSync it),
// intermittently throwing ENOENT — proven while building this feature.
const redeemUid = (label) => `__test_redeem_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}__`;

// Holder-only gate (2026-07-26, see src/quiz/redemption.js) — every test
// below that needs a redemption to actually SUCCEED must inject a wallet +
// a passing balance, since the real getLinkedWallet()/getSplBalance() would
// otherwise either find no linked wallet for a synthetic test user, or make
// a real Solana RPC call. Tests exercising a REJECTION path (bad input,
// insufficient points, no wallet, zero balance, RPC failure) either don't
// need an override or deliberately pass one that fails, per the same
// dependency-injection pattern already used by
// src/mole/contributions.js's confirmContribution() tests.
const HOLDER_OK = {
  resolveLinkedWallet: () => ({ address: 'Test1WalletAddressXXXXXXXXXXXXXXXXXXXXXXXXX', source: 'test' }),
  getBalance: async () => 1000,
};

test('redeemQuizPoints: unauthenticated/missing user id is rejected', async () => {
  const res = await redemption.redeemQuizPoints({ userId: '', amount: 10, source: 'web' });
  assert.equal(res.ok, false);
});

test('redeemQuizPoints: invalid source is rejected (only discord/web are valid callers)', async () => {
  const user = redeemUid('badsource');
  db.addPoints(user, 500);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 10, source: 'mobile-app' });
  assert.equal(res.ok, false);
  assert.match(res.error, /source/i);
});

test('redeemQuizPoints: insufficient points is rejected with the same message Discord has always shown', async () => {
  const user = redeemUid('poor');
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Not enough points.');
});

test('redeemQuizPoints: zero or negative amount is rejected', async () => {
  const user = redeemUid('zero');
  db.addPoints(user, 500);
  assert.equal((await redemption.redeemQuizPoints({ userId: user, amount: 0, source: 'web' })).ok, false);
  assert.equal((await redemption.redeemQuizPoints({ userId: user, amount: -10, source: 'web' })).ok, false);
});

test('redeemQuizPoints: non-integer / malformed amount is rejected (NaN, string, float)', async () => {
  const user = redeemUid('malformed');
  db.addPoints(user, 500);
  assert.equal((await redemption.redeemQuizPoints({ userId: user, amount: NaN, source: 'web' })).ok, false);
  assert.equal((await redemption.redeemQuizPoints({ userId: user, amount: 'lots', source: 'web' })).ok, false);
  assert.equal((await redemption.redeemQuizPoints({ userId: user, amount: 10.5, source: 'web' })).ok, false);
});

test('redeemQuizPoints: a brand-new user (never played, malformed/empty stored data) fails safely, not with a crash', async () => {
  const user = redeemUid('never-played');
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Not enough points.');
});

test('redeemQuizPoints: enough points but no linked wallet is rejected (holder-only gate, points are never deducted)', async () => {
  const user = redeemUid('no-wallet');
  db.addPoints(user, 2000);
  const before = db.getUser(user);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 1600, source: 'web' });
  assert.equal(res.ok, false);
  assert.match(res.error, /link a wallet/i);
  const after = db.getUser(user);
  assert.equal(after.unpaidPoints, before.unpaidPoints, 'a rejected redemption must never deduct points');
});

test('redeemQuizPoints: linked wallet with zero WinLEW balance is rejected (holder-only gate, points are never deducted)', async () => {
  const user = redeemUid('zero-balance');
  db.addPoints(user, 2000);
  const before = db.getUser(user);
  const res = await redemption.redeemQuizPoints({
    userId: user,
    amount: 1600,
    source: 'web',
    resolveLinkedWallet: () => ({ address: 'Test2WalletAddressXXXXXXXXXXXXXXXXXXXXXXXXX', source: 'test' }),
    getBalance: async () => 0,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /holder-only/i);
  const after = db.getUser(user);
  assert.equal(after.unpaidPoints, before.unpaidPoints, 'a rejected redemption must never deduct points');
});

test('redeemQuizPoints: a balance-check RPC failure fails closed (rejected, not treated as eligible)', async () => {
  const user = redeemUid('rpc-fail');
  db.addPoints(user, 2000);
  const res = await redemption.redeemQuizPoints({
    userId: user,
    amount: 1600,
    source: 'web',
    resolveLinkedWallet: () => ({ address: 'Test3WalletAddressXXXXXXXXXXXXXXXXXXXXXXXXX', source: 'test' }),
    getBalance: async () => { throw new Error('rpc_timeout'); },
  });
  assert.equal(res.ok, false);
});

test('redeemQuizPoints: below the redemption floor is rejected with a structured below_minimum code, points untouched (2026-07-30)', async () => {
  const user = redeemUid('below-min');
  const min = db.getMinRedemptionPoints();
  db.addPoints(user, min + 500);
  const before = db.getUser(user);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: min - 1, source: 'web', ...HOLDER_OK });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'below_minimum');
  assert.equal(res.minPoints, min);
  assert.match(res.error, /minimum redemption/i);
  assert.equal(db.getUser(user).unpaidPoints, before.unpaidPoints, 'a rejected redemption must never deduct points');
});

test('redeemQuizPoints: exactly the redemption floor succeeds when eligible', async () => {
  const user = redeemUid('exact-min');
  const min = db.getMinRedemptionPoints();
  db.addPoints(user, min + 500);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: min, source: 'web', ...HOLDER_OK });
  assert.equal(res.ok, true);
  assert.equal(res.amount, min);
});

test('redeemQuizPoints: successful web redemption deducts points once, creates one pending record, tags requestSource', async () => {
  const user = redeemUid('success');
  db.addPoints(user, 3000);
  const before1 = db.getUser(user);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK });
  assert.equal(res.ok, true);
  assert.equal(res.amount, 2000);
  assert.equal(res.estimatedWinlew, db.estimateWinlewForPoints(2000));
  assert.equal(res.redemption.status, 'pending');
  assert.equal(res.redemption.kind, 'user_redeem');
  assert.equal(res.redemption.requestSource, 'web');
  assert.equal(res.linkedWallet.address, HOLDER_OK.resolveLinkedWallet().address);

  const after1 = db.getUser(user);
  assert.equal(after1.unpaidPoints, before1.unpaidPoints - 2000, 'points deducted exactly once');

  const rows = db.listRedemptions(user);
  const redeemRows = rows.filter((r) => r.kind === 'user_redeem');
  assert.equal(redeemRows.length, 1, 'no double record created');
});

test('redeemQuizPoints: successful discord-sourced redemption tags requestSource=discord (Discord command now calls the same service)', async () => {
  const user = redeemUid('discord-source');
  db.addPoints(user, 3000);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'discord', ...HOLDER_OK });
  assert.equal(res.ok, true);
  assert.equal(res.redemption.requestSource, 'discord');
});

test('redeemQuizPoints: two legitimate redemptions covering the full balance both succeed as distinct records (matches existing Discord semantics — no artificial single-pending-per-user lock)', async () => {
  const user = redeemUid('two-legit');
  db.addPoints(user, 4000);
  const first = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK });
  const second = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.redemption.id, second.redemption.id);
  const after1 = db.getUser(user);
  assert.equal(after1.unpaidPoints, 0);
});

test('redeemQuizPoints: duplicate submission beyond the real balance — the second one is rejected, at most one redemption wins', async () => {
  const user = redeemUid('dup-reject');
  db.addPoints(user, 2000);
  const first = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK });
  const second = await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'Not enough points.');
});

test('redeemQuizPoints: simultaneous web + Discord requests racing for the same balance — exactly one wins (same file-lock serialization every other quiz db write already uses)', async () => {
  const user = redeemUid('race');
  db.addPoints(user, 2000);
  const [webResult, discordResult] = await Promise.all([
    redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK }),
    redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'discord', ...HOLDER_OK }),
  ]);
  const oks = [webResult, discordResult].filter((r) => r.ok);
  assert.equal(oks.length, 1, 'exactly one of the two simultaneous redemptions must succeed');
  const after1 = db.getUser(user);
  assert.equal(after1.unpaidPoints, 0, 'balance must reflect only the one winning redemption');
});

test('redeemQuizPoints: redemption never touches lifetimePoints (only unpaid/redeemable points move)', async () => {
  const user = redeemUid('lifetime-stable');
  db.addPoints(user, 3000);
  const before1 = db.getUser(user);
  await redemption.redeemQuizPoints({ userId: user, amount: 2000, source: 'web', ...HOLDER_OK });
  const after1 = db.getUser(user);
  assert.equal(after1.lifetimePoints, before1.lifetimePoints, 'lifetime points must be unaffected by redemption');
});

test('redeemQuizPoints: response never includes any secret material (keypair, token, private key fields)', async () => {
  const user = redeemUid('no-secrets');
  db.addPoints(user, 2000);
  const res = await redemption.redeemQuizPoints({ userId: user, amount: 1600, source: 'web', ...HOLDER_OK });
  const serialized = JSON.stringify(res).toLowerCase();
  assert.doesNotMatch(serialized, /privatekey|secretkey|seedphrase|keypair|discord_token|bottoken/);
});

// switchCycleCadence (2026-07-18 quarterly->monthly cycle-cadence switch) —
// kept in THIS file for the exact same reason getUserRank's and
// redeemQuizPoints's tests are (see the file-header comment): one shared
// before/after lifecycle against the real, non-configurable db.json. This is
// doubly important here since switchCycleCadence() closes the CURRENT cycle
// and rewrites GLOBAL meta (cyclePrefix/cycleEpochMs/cycleLengthDays) — unlike
// every other test above, which only touches distinct synthetic user records,
// this one would settle real pending points into real redemptions for every
// real user if it ever ran against the real file, even for a moment. A
// separate db-cycle-cadence.test.cjs file with its own move-aside dance
// raced this file's before/after over the same db.json — proven while
// building this feature (this file's after() threw ENOENT trying to restore
// `db.json.test-backup`, which the other file had swapped out from under it).
const TEST_PREFIX = 'ZQ'; // not a real cycle-scheme prefix ever used in production
const CADENCE_TEST_USER = `__test_cadence_${Date.now()}_${Math.random().toString(16).slice(2)}__`;

// Regression coverage for a real double-payout bug found in production data
// (2026-07-26): closeCycle() pays out user.cycles[cycleId] directly, and
// redeemPoints() used to only decrement user.points/redeemed — never
// user.cycles[cycleId] — so a user who manually /redeem'd early was paid
// again in full when their cycle later closed. Deliberately does NOT call
// closeCycle() or switchCycleCadence() itself, so it can never race the
// switchCycleCadence block below over what "the current cycle" is.
describe('redeemPoints — must draw down the open cycle ledger so a later cycle close cannot pay the same points twice', () => {
  test('a full manual redemption drains the open cycle balance to zero', async () => {
    const user = `__test_drawdown_full_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, 2000);
    const cycleId = db.getCurrentCycle().id;
    assert.equal(db.getUserCyclePoints(user, cycleId), 2000);

    const result = await db.redeemPoints(user, 2000);
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(
      db.getUserCyclePoints(user, cycleId),
      0,
      'the open cycle balance must be drawn down by the redeemed amount, or a later cycle close would pay it again in full'
    );
  });

  test('a partial manual redemption only drains what was actually redeemed', async () => {
    const user = `__test_drawdown_partial_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, 3000);
    const cycleId = db.getCurrentCycle().id;

    const result = await db.redeemPoints(user, 1600);
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.equal(
      db.getUserCyclePoints(user, cycleId),
      1400,
      'only the redeemed 1600 should be drawn down, leaving the true remainder still owed at cycle close'
    );
  });

  test('redeeming the whole balance still succeeds and never drives the cycle balance negative', async () => {
    const user = `__test_drawdown_overdraw_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, 1500); // lifetime/points balance can exceed any single open cycle's contribution
    const cycleId = db.getCurrentCycle().id;

    const result = await db.redeemPoints(user, 1500);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(db.getUserCyclePoints(user, cycleId), 0);
  });

  test('redeemPoints backstop: below the redemption floor is rejected even when called directly (not via redeemQuizPoints)', async () => {
    const user = `__test_drawdown_floor_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, 2000);
    const result = await db.redeemPoints(user, db.getMinRedemptionPoints() - 1);
    assert.equal(result.ok, false);
    assert.match(result.error, /minimum redemption/i);
  });
});

describe('switchCycleCadence — input validation (no db mutation)', () => {
  test('rejects a non-positive lengthDays', () => {
    const before2 = db.getCurrentCycle();
    const result = db.switchCycleCadence({ lengthDays: 0, prefix: 'AB' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_length_days');
    assert.equal(db.getCurrentCycle().id, before2.id, 'a rejected call must never change the active cycle');
  });

  test('rejects a prefix that is not 1-4 letters', () => {
    assert.equal(db.switchCycleCadence({ lengthDays: 30, prefix: '' }).ok, false);
    assert.equal(db.switchCycleCadence({ lengthDays: 30, prefix: '12' }).ok, false);
    assert.equal(db.switchCycleCadence({ lengthDays: 30, prefix: 'TOOLONG' }).ok, false);
  });

  test('rejects reusing the default "C" prefix — the collision this whole feature exists to prevent', () => {
    const result = db.switchCycleCadence({ lengthDays: 30, prefix: 'C' });
    assert.equal(result.ok, false);
    assert.match(result.error, /prefix_already_used/);
  });
});

describe('switchCycleCadence — the actual transition', () => {
  test('closes the previous cycle, settling any pending points into a redemption, then activates the new scheme', () => {
    // Bank real points for the test user under whatever scheme is currently
    // active, so closeCycle() has something concrete to settle. Must be at
    // least the redemption floor (default 1500 points) or the close would
    // carry the balance forward instead of settling it.
    db.addPoints(CADENCE_TEST_USER, 2000);
    const cycleBefore = db.getCurrentCycle();
    const redemptionsBefore = db.listRedemptions(CADENCE_TEST_USER).length;

    const result = db.switchCycleCadence({ lengthDays: 30, prefix: TEST_PREFIX, reason: 'test: quarterly -> monthly' });
    assert.equal(result.ok, true, JSON.stringify(result));

    // The old cycle was actually settled, not skipped.
    assert.equal(result.closedPreviousCycle.id, cycleBefore.id);
    assert.equal(result.previousScheme.prefix, cycleBefore.id.replace(/\d+$/, ''));

    // The new scheme is active immediately.
    assert.equal(result.newScheme.prefix, TEST_PREFIX);
    assert.equal(result.newScheme.lengthDays, 30);
    assert.ok(result.firstNewCycleId.startsWith(TEST_PREFIX));

    const cycleAfter = db.getCurrentCycle();
    assert.ok(cycleAfter.id.startsWith(TEST_PREFIX), `expected the new active cycle to use the new prefix, got ${cycleAfter.id}`);
    assert.notEqual(cycleAfter.id, cycleBefore.id, 'switching schemes must never keep reusing the exact same cycle id');

    assert.ok(db.listRedemptions(CADENCE_TEST_USER).length > redemptionsBefore, 'closing the previous cycle must create a real redemption record for the banked points');
  });

  test('a second switch to an already-used prefix (even the one just activated) is rejected — no silent collision', () => {
    const result = db.switchCycleCadence({ lengthDays: 7, prefix: TEST_PREFIX });
    assert.equal(result.ok, false);
    assert.match(result.error, /prefix_already_used/);
  });

  test('the transition is recorded permanently in cycleSchemeHistory, not just applied silently', () => {
    const raw = db.readDb();
    const entry = raw.meta.cycleSchemeHistory.find((h) => h.prefix === TEST_PREFIX);
    assert.ok(entry, 'the switch must leave a permanent audit record');
    assert.equal(entry.lengthDays, 30);
    assert.equal(entry.reason, 'test: quarterly -> monthly');
    assert.ok(entry.startedAtMs > 0);
  });

  test('points earned after the switch accrue under the new prefix, never the retired one', () => {
    const cycleId = db.getCurrentCycle().id;
    assert.ok(cycleId.startsWith(TEST_PREFIX));
    db.addPoints(CADENCE_TEST_USER, 40);
    const pts = db.getUserCyclePoints(CADENCE_TEST_USER, cycleId);
    assert.equal(pts, 40, 'a fresh cycle under the new scheme must start from zero, not inherit the old cycle\'s balance');
  });
});

// Redemption floor at cycle close (2026-07-30): balances below
// getMinRedemptionPoints() must NOT settle into dust payouts — they carry
// forward into the next open cycle and pay later, once past the floor.
// Runs LAST on purpose: it closes the current (post-switch, ZQ-prefixed)
// cycle, and every earlier block assumes the cycle it banked points into is
// still open while it runs.
describe('closeCycle — below-floor balances carry forward instead of settling dust', () => {
  test('above-floor settles into a cycle_payout; below-floor carries into the next cycle, points intact', () => {
    const bigUser = `__test_carry_big_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    const dustUser = `__test_carry_dust_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    const floor = db.getMinRedemptionPoints();
    db.addPoints(bigUser, floor + 500);
    db.addPoints(dustUser, floor - 700);

    const cur = db.getCurrentCycle();
    const res = db.closeCycle(cur.id);
    assert.equal(res.ok, true, JSON.stringify(res));

    // The above-floor user settled normally.
    const bigRows = db.listRedemptions(bigUser).filter((r) => r.kind === 'cycle_payout' && r.cycleId === cur.id);
    assert.equal(bigRows.length, 1);
    assert.equal(bigRows[0].amount, floor + 500);

    // The below-floor user got NO payout record — no dust settlement.
    const dustRows = db.listRedemptions(dustUser).filter((r) => r.kind === 'cycle_payout');
    assert.equal(dustRows.length, 0, 'a below-floor balance must never settle into a payout record');
    assert.ok(res.carriedCount >= 1);
    assert.ok(res.carryCycleId, 'the close result must say where carried balances went');

    // The points moved into the carry cycle — nothing was destroyed or left
    // stranded in the closed cycle.
    assert.equal(db.getUserCyclePoints(dustUser, cur.id), 0);
    assert.equal(db.getUserCyclePoints(dustUser, res.carryCycleId), floor - 700);
    assert.equal(db.getUser(dustUser).unpaidPoints, floor - 700, 'carrying forward must never change the user\'s redeemable balance');
  });
});

// ── Payout intent — a crash between sending and recording must not pay twice ──
//
// settleRecord() in src/quiz/payout-worker.js used to do:
//
//     const tx = await sendWinlew(...)      // money leaves
//     db.markRedemptionPaidById({ ... })    // crash here -> still 'pending'
//                                           //            -> next run re-sends
//
// Nothing was persisted between those two lines, so a restart in that window
// sent a second transfer of real tokens. Distinct from the confirmation timeout
// fixed in f9646f5 — raising that timeout did not close this window.
//
// Lives in THIS file rather than its own, per the rule at the top: exactly one
// test file owns src/quiz/data/db.json's lifecycle, or the files race.
describe('payout intent — the crash window between send and record', () => {
  async function queued(points = 1500) {
    const user = `__test_intent_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, points);
    const res = await db.redeemPoints(user, points);
    assert.equal(res.ok, true, JSON.stringify(res));
    return { user, id: res.redemption.id };
  }

  test('an intent survives to be seen by a restarted worker', async () => {
    const { id } = await queued();
    assert.equal(db.notePayoutIntent({ id, signature: 'SigA1111111111111111111111111111111111111111', lastValidBlockHeight: 987 }).ok, true);

    // listPayoutIntents() reads from disk — this is exactly what a worker sees
    // after a restart, and it is the difference between reconciling and
    // re-sending.
    const found = db.listPayoutIntents().find((r) => r.id === id);
    assert.ok(found, 'a restarted worker could not tell a transfer had already been sent');
    assert.equal(found.payoutIntent.signature, 'SigA1111111111111111111111111111111111111111');
    assert.equal(found.payoutIntent.lastValidBlockHeight, 987);
    assert.ok(found.payoutIntent.sentAt > 0);
  });

  test('a record can only be settled once, whatever the intent says', async () => {
    const { id } = await queued();
    db.notePayoutIntent({ id, signature: 'SigB2222222222222222222222222222222222222222' });

    const first = db.markRedemptionPaidById({ id, winlewSent: 1500, tx: 'SigB2222222222222222222222222222222222222222', settlementMode: 'auto_worker_reconciled' });
    assert.equal(first.ok, true);

    // The status guard is the second line of defence: once paid the record is
    // neither pending nor failed, so no later run can pay it again.
    const second = db.markRedemptionPaidById({ id, winlewSent: 1500, tx: 'SigC3333333333333333333333333333333333333333' });
    assert.equal(second.ok, false, 'a paid record was settled a second time');
  });

  test('clearing an intent frees the record for a genuine retry', async () => {
    const { id } = await queued();
    db.notePayoutIntent({ id, signature: 'SigD4444444444444444444444444444444444444444' });
    db.clearPayoutIntent({ id, reason: 'previous attempt expired unconfirmed' });
    assert.ok(!db.listPayoutIntents().some((r) => r.id === id),
      'an expired attempt must not block its record forever');
  });

  test('a settled record stops appearing as outstanding work', async () => {
    const { id } = await queued();
    db.notePayoutIntent({ id, signature: 'SigE5555555555555555555555555555555555555555' });
    db.markRedemptionPaidById({ id, winlewSent: 1500, tx: 'SigE5555555555555555555555555555555555555555' });
    assert.ok(!db.listPayoutIntents().some((r) => r.id === id),
      'a paid record is still being offered to the reconciler');
  });
});

// ── Payout receipts must replay against what is STORED ────────────────────────
//
// The whole value of a receipt is that someone can recompute it from the
// database and get the same hash. That breaks the moment the receipt is built
// from anything other than the persisted record.
//
// It was: settleRecord() built the receipt from its in-memory `record`, spread
// with a fresh `paidTs: Date.now()`. That copy was read BEFORE assessRisk() and
// markRedemptionPaidById() wrote to the database, so it carried no risk verdict
// and a timestamp a few milliseconds off the stored one. Every receipt would
// have failed `npm run receipts:verify` — reporting tampering on payouts that
// were perfectly honest, which is worse than having no receipts at all.
describe('payout receipts replay against the database', () => {
  async function paid(points = 1500) {
    const user = `__test_receipt_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, points);
    const res = await db.redeemPoints(user, points);
    assert.equal(res.ok, true, JSON.stringify(res));
    return { user, id: res.redemption.id };
  }

  test('a receipt issued at settlement still verifies when replayed from disk', async () => {
    process.env.PAYOUT_RECEIPT_SALT = 'db-roundtrip-salt';
    process.env.GEOPROOF_RECEIPTS_ENABLED = 'true';
    delete process.env.GEOPROOF_SERVICE_URL;
    const receipts = await import('../../src/mole/payoutReceipt.js');

    const { id } = await paid();

    // The worker's real order: score first, then settle.
    db.noteRiskAssessment({
      id,
      risk: { band: 'elevated', score: 32, signals: ['shared_device'], rulesVersion: 'participation-trust/1.0.0' },
      decision: 'settle',
    });
    const result = db.markRedemptionPaidById({
      id, winlewSent: 1500, tx: 'SigR1111111111111111111111111111111111111111',
      walletAddress: '7sf9u22pUvCaVN1ntxZCJCgMDN8ede9PUQzkbuVxApBp',
      settlementMode: 'auto_worker',
    });
    assert.equal(result.ok, true);

    // Built from the PERSISTED record, which is the fix.
    const receipt = await receipts.issuePayoutReceipt(result.rec);
    assert.ok(receipt, 'no receipt was issued');
    db.notePayoutReceipt({ id, receipt });

    // Now replay it the way `npm run receipts:verify` does: re-read from disk.
    const stored = db.listRedemptionsWithReceipts().find((r) => r.id === id);
    assert.ok(stored, 'a receipted payout is invisible to receipts:verify');
    const replay = receipts.replayPayoutDecision(stored, stored.receipt);
    assert.equal(replay.matches, true,
      'a receipt issued at settlement does not verify against the stored record');
    assert.equal(replay.decision.riskBand, 'elevated',
      'the risk verdict recorded before settlement is missing from the receipt');
  });

  test('building from the pre-settlement record is what used to break it', async () => {
    process.env.PAYOUT_RECEIPT_SALT = 'db-roundtrip-salt';
    process.env.GEOPROOF_RECEIPTS_ENABLED = 'true';
    const receipts = await import('../../src/mole/payoutReceipt.js');

    const { id } = await paid();
    db.noteRiskAssessment({
      id,
      risk: { band: 'suspicious', score: 55, signals: ['linked_to_banned_wallet'], rulesVersion: 'participation-trust/1.0.0' },
      decision: 'settle',
    });
    const result = db.markRedemptionPaidById({
      id, winlewSent: 1500, tx: 'SigR2222222222222222222222222222222222222222',
      walletAddress: '7sf9u22pUvCaVN1ntxZCJCgMDN8ede9PUQzkbuVxApBp',
      settlementMode: 'auto_worker',
    });

    // The old code's input: the record as it looked before scoring and
    // settlement, with a timestamp of its own.
    const stale = { id, kind: 'on_demand', userId: result.rec.userId, amount: 1500,
      winlewSent: 1500, payoutWallet: '7sf9u22pUvCaVN1ntxZCJCgMDN8ede9PUQzkbuVxApBp',
      paidTs: Date.now() };
    const staleReceipt = await receipts.issuePayoutReceipt(stale);

    const replay = receipts.replayPayoutDecision(result.rec, staleReceipt);
    assert.equal(replay.matches, false,
      'a receipt built before the risk verdict was recorded should not verify — ' +
      'if this passes, the receipt is not actually committing to the decision');
  });
});

// ── A hold is a timer, and re-holding must not restart it ─────────────────────
//
// The payout worker re-scores pending records every scan. noteRiskAssessment()
// set `heldTs = Date.now()` unconditionally, so a record held for a week looked
// 45 seconds old forever and could never age past the review SLA — the
// auto-release valve in reviewQueue.js would never fire for anybody.
//
// It was hidden by a comment claiming `nextAttemptTs = null` parked the record.
// It does not: listAutoSettlementCandidates only skips a FUTURE nextAttemptTs,
// so null means "eligible right now".
describe('held records are genuinely parked', () => {
  async function queued(points = 1500) {
    const user = `__test_hold_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
    db.addPoints(user, points);
    const res = await db.redeemPoints(user, points);
    assert.equal(res.ok, true, JSON.stringify(res));
    return { user, id: res.redemption.id };
  }

  const hold = (id, signals = ['shared_device']) => db.noteRiskAssessment({
    id, decision: 'held', heldReason: 'test',
    risk: { band: 'held', score: 80, signals, rulesVersion: 'participation-trust/1.0.0' },
  });

  test('re-holding does not restart the review clock', async () => {
    const { id } = await queued();
    const first = hold(id).rec.heldTs;
    assert.ok(first > 0);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(hold(id).rec.heldTs, first,
      're-scoring reset heldTs — a hold could never age out and would never auto-release');
  });

  test('a held record is not re-offered to the settlement worker', async () => {
    const { id } = await queued();
    hold(id);
    const offered = db.listAutoSettlementCandidates({ limit: 500 }).some((r) => r.id === id);
    assert.equal(offered, false,
      'a held record was still being settled — the hold only ever existed in the log');
  });

  test('approving puts it straight back in the queue', async () => {
    const { id } = await queued();
    hold(id);
    assert.equal(db.approveHeldRedemption({ id, byDiscordUserId: 'mod' }).ok, true);
    assert.ok(db.listAutoSettlementCandidates({ limit: 500 }).some((r) => r.id === id),
      'an approved payout never re-entered the queue');
  });

  test('auto-release puts it back too, and records that nobody looked', async () => {
    const { id } = await queued();
    hold(id);
    const res = db.autoReleaseHeldRedemption({ id, reason: 'review_sla_expired', heldForMs: 99 });
    assert.equal(res.ok, true);
    // Distinct from `approved` on purpose: an unattended queue must not be able
    // to masquerade as a reviewed one.
    assert.equal(res.rec.decision, 'auto_released');
    assert.equal(res.rec.autoReleased.reviewedByHuman, false);
    assert.equal(res.rec.reviewedBy, null);
    assert.ok(db.listAutoSettlementCandidates({ limit: 500 }).some((r) => r.id === id));
  });

  test('auto-release cannot touch a payout that was never held', async () => {
    const { id } = await queued();
    assert.equal(db.autoReleaseHeldRedemption({ id }).ok, false);
  });
});

// ── Watchlist: pay the first, gate the second ────────────────────────────────
//
// The owner's correction, 2026-08-14, on being told a flagged first payout would
// wait for review: "so now new wallets need to wait 3 days? lets pay out the
// First one instant, and put them on a list."
//
// Right on both counts. Making a brand new participant wait days for money they
// earned, on circumstantial evidence, to catch a farmer who will simply wait
// too, costs every honest newcomer and stops nobody. One payout is a cheap
// price for real evidence — and redeem/move/relink/repeat only becomes visible
// on the repeat anyway.
describe('the payout watchlist', () => {
  const user = () => `__test_watch_${Date.now()}_${Math.random().toString(16).slice(2)}__`;

  async function queued(u, points = 1500) {
    db.addPoints(u, points);
    const res = await db.redeemPoints(u, points);
    assert.equal(res.ok, true, JSON.stringify(res));
    return res.redemption.id;
  }

  test('flagging someone does not withhold anything by itself', async () => {
    const u = user();
    const id = await queued(u);
    db.addToWatchlist({ userId: u, signals: ['funded_by_own_earlier_payout'], redemptionId: id });
    assert.equal(db.isWatchlisted(u), true);
    // The record is untouched — the first payout settles normally.
    assert.ok(db.listAutoSettlementCandidates({ limit: 500 }).some((r) => r.id === id),
      'being flagged held the first payout, which is the thing that was rejected');
  });

  test('re-flagging keeps the original evidence and does not restart anything', () => {
    const u = user();
    const first = db.addToWatchlist({ userId: u, signals: ['a'], wallet: 'W1' });
    assert.equal(first.alreadyListed, false);
    const again = db.addToWatchlist({ userId: u, signals: ['b'], wallet: 'W2' });
    assert.equal(again.alreadyListed, true);
    assert.deepEqual(again.entry.signals, ['a'], 'the evidence an admin was asked to look at was overwritten');
    assert.equal(again.entry.addedTs, first.entry.addedTs);
  });

  test('clearing releases whatever the flag was holding, in the same write', async () => {
    const u = user();
    db.addToWatchlist({ userId: u, signals: ['funded_by_own_earlier_payout'] });
    const second = await queued(u);
    db.noteRiskAssessment({ id: second, decision: 'held', heldReason: 'watchlist: funded_by_own_earlier_payout', risk: null });
    assert.equal(db.listAutoSettlementCandidates({ limit: 500 }).some((r) => r.id === second), false);

    const res = db.clearWatchlist({ userId: u, byDiscordUserId: 'admin-1', note: 'looks fine' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.released, [second]);
    assert.ok(db.listAutoSettlementCandidates({ limit: 500 }).some((r) => r.id === second),
      'the admin was told clearing ends the hold, and it did not');
  });

  test('clearing does not release a payout held for an unrelated reason', async () => {
    const u = user();
    db.addToWatchlist({ userId: u, signals: ['x'] });
    const id = await queued(u);
    db.noteRiskAssessment({ id, decision: 'held', heldReason: 'many_identities_one_device', risk: null });
    const res = db.clearWatchlist({ userId: u, byDiscordUserId: 'admin-1', note: 'ok' });
    assert.deepEqual(res.released, [],
      'clearing a first-payout flag silently overrode a separate risk hold');
  });

  test('a cleared user is no longer gated, and the record of the look survives', () => {
    const u = user();
    db.addToWatchlist({ userId: u, signals: ['x'] });
    db.clearWatchlist({ userId: u, byDiscordUserId: 'admin-1', note: 'friend funded them' });
    assert.equal(db.isWatchlisted(u), false);
    // Kept, not deleted: a cleared entry is the evidence that somebody looked.
    const entry = db.getWatchlistEntry(u);
    assert.equal(entry.clearedBy, 'admin-1');
    assert.equal(entry.note, 'friend funded them');
    assert.ok(!db.listWatchlist().some((e) => e.userId === u));
    assert.ok(db.listWatchlist({ includeCleared: true }).some((e) => e.userId === u));
  });

  test('clearing twice is refused rather than silently re-stamped', () => {
    const u = user();
    db.addToWatchlist({ userId: u, signals: ['x'] });
    db.clearWatchlist({ userId: u, byDiscordUserId: 'a', note: 'first' });
    const second = db.clearWatchlist({ userId: u, byDiscordUserId: 'b', note: 'second' });
    assert.equal(second.ok, false);
    assert.equal(db.getWatchlistEntry(u).clearedBy, 'a', 'the record of who actually looked was overwritten');
  });

  test('clearing someone who was never flagged is an error, not a no-op', () => {
    assert.equal(db.clearWatchlist({ userId: user(), byDiscordUserId: 'a', note: 'n' }).ok, false);
  });
});
