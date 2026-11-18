import assert from 'node:assert/strict';
import test from 'node:test';
import { cashoutFlags, parseReviewId, reviewId, REVIEW_DEFAULTS } from './integrity.js';
import { ArcadeRewardService, MemoryArcadeStore } from './reward-engine.js';
import { getArcadeConfig } from './config.js';

const now = new Date('2026-10-24T12:00:00Z');
const OLD = '1100000000000000000';                       // a Discord account from 2023
const snowflakeAt = d => String((BigInt(d.getTime()) - 1420070400000n) << 22n);
const row = (o = {}) => ({ identityId: OLD, wallet: 'w', game: 'diglew', eligiblePoints: 60 + (o.i || 0) * 7 % 200, rawScore: 20000, actualUnits: '240000', rewardDay: '2026-10-23', createdAt: new Date(now.getTime() - (o.i || 0) * 600000), ...o });
const base = { identityId: OLD, pay: [{ payoutUnits: '1000000' }], walletRows: [], now, capUnits: 20_000_000n };

test('no flag for full-length rounds, fixed-length games, new-but-eligible accounts, or rows without a real duration', () => {
  assert.deepEqual(cashoutFlags({ ...base, history: Array.from({ length: 30 }, (_, i) => row({ i, eligiblePoints: 300, elapsedMs: 330000 })) }), []);
  assert.deepEqual(cashoutFlags({ ...base, history: Array.from({ length: 30 }, (_, i) => row({ i, game: 'tunneltap', eligiblePoints: 31, elapsedMs: 31000, rawScore: 2000 })) }), [], 'Tunnel Tap rounds are 30 s for everyone');
  assert.deepEqual(cashoutFlags({ ...base, identityId: snowflakeAt(new Date('2026-09-10T00:00:00Z')), history: [] }), [], 'the 30-day earning gate handles new accounts');
  // Paid seconds are bounded by the score, so without elapsedMs the "barely" rule would always fire.
  assert.deepEqual(cashoutFlags({ ...base, history: Array.from({ length: 12 }, (_, i) => row({ i, eligiblePoints: 100, rawScore: 1500 })) }), []);
});

test('an ordinary player is not flagged', () => {
  const history = Array.from({ length: 30 }, (_, i) => row({ i }));
  assert.deepEqual(cashoutFlags({ ...base, history, walletRows: history }), []);
});

test('each pattern is flagged on its own', () => {
  const at = (flags, re) => assert.ok(flags.some(f => re.test(f)), `expected ${re} in ${JSON.stringify(flags)}`);
  at(cashoutFlags({ ...base, history: [], walletRows: [row({ identityId: '1200000000000000000' })] }), /also earned under 1 other account/);
  // DigLEW's minimum is 15 points a second of real round time: 15.5 a second, round after round, is "barely".
  at(cashoutFlags({ ...base, history: Array.from({ length: 12 }, (_, i) => row({ i, eligiblePoints: 100 + i * 20, elapsedMs: (100 + i * 20) * 1000, rawScore: Math.round((100 + i * 20) * 15.5) })) }), /12 of the last 12 rounds scored just above the minimum the game accepts for their length/);
  const capped = ['2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20'].map((d, i) => row({ i, rewardDay: d, actualUnits: '20000000' }));
  at(cashoutFlags({ ...base, history: capped }), /Reached the daily cap on 5 of the last 7 days/);
  at(cashoutFlags({ ...base, history: [], pay: [{ payoutUnits: String(REVIEW_DEFAULTS.bigCashoutUnits) }] }), /A large cash-out: 200 XL1/);
});

test('review ids round-trip, and junk is refused', () => {
  const id = reviewId(OLD, now);
  assert.deepEqual(parseReviewId(id), { identityId: OLD, cashedAt: now });
  for (const bad of ['', 'x', `${OLD}:`, `${OLD}:abc`, '../../etc:123']) assert.equal(parseReviewId(bad), null, bad);
});

test('a flagged live cash-out waits for a moderator; approve queues it, decline never pays, once only', async () => {
  let t = new Date('2026-10-20T12:00:00Z'); let n = 0;
  const config = { ...getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0', XL1_REWARD_MODE: 'dry-run', XL1_REWARD_PER_POINT: '0.05', XL1_DAILY_REWARD_CAP: '10' }), mode: 'live' };
  const store = new MemoryArcadeStore();
  const service = new ArcadeRewardService({ store, config, now: () => t, id: () => `r${++n}` });
  const young = snowflakeAt(new Date('2026-09-01T00:00:00Z'));   // flagged: under 60 days at cash-out
  const play = async (identityId) => { const s = await service.start({ identityId, wallet: '5'.repeat(40), game: 'diglew' }); t = new Date(t.getTime() + 60000); return service.complete({ identityId, sessionId: s._id, nonce: s.nonce, rawScore: 9000 }) };
  await play(young);
  await play(OLD);   // the same wallet under another account: OLD is flagged too
  t = new Date('2026-10-22T12:00:00Z');
  const a = await service.cashout(young);
  assert.equal(a.status, 'REVIEW');
  assert.equal(store.rewards.get('r1').status, 'FLAGGED', 'the worker only pays QUEUED, so nothing is sent');
  assert.equal((await service.balance(young)).inReviewXl1, a.cashedOutXl1);
  const b = await service.cashout(OLD);
  assert.equal(b.status, 'REVIEW');

  const reviews = await service.reviews();
  assert.equal(reviews.length, 2);
  const mine = reviews.find(r => r.identityId === young);
  assert.ok(mine.flags.some(f => /other account/.test(f)), JSON.stringify(mine.flags));
  assert.equal(mine.payoutXl1, a.cashedOutXl1);

  const MOD = '876543210987654321';
  await assert.rejects(() => service.decide(mine.id, 'approve', 'not-a-mod'), /moderator_required/);
  await assert.rejects(() => service.decide(mine.id, 'maybe', MOD), /decision_invalid/);
  assert.equal((await service.decide(mine.id, 'approve', MOD)).rewards, 1);
  await assert.rejects(() => service.decide(mine.id, 'approve', MOD), /review_not_found/, 'approving again finds nothing left to approve');
  assert.equal(store.rewards.get('r1').status, 'QUEUED');
  assert.equal(store.rewards.get('r1').review.decidedBy, MOD);
  await assert.rejects(() => service.decide(mine.id, 'decline', MOD), /review_already_decided/, 'the other decision is refused: no split cash-outs');
  const other = reviews.find(r => r.identityId === OLD);
  await service.decide(other.id, 'decline', MOD);
  assert.equal(store.rewards.get('r2').status, 'DECLINED');
  assert.equal((await service.reviews()).length, 0);
});

test('review is off in dry run and when XL1_REVIEW=off', async () => {
  for (const [mode, env] of [['dry-run', {}], ['live', { XL1_REVIEW: 'off' }]]) {
    let t = new Date('2026-10-20T12:00:00Z'); let n = 0;
    const config = { ...getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0', XL1_REWARD_MODE: 'dry-run', ...env }), mode };
    const store = new MemoryArcadeStore();
    const service = new ArcadeRewardService({ store, config, now: () => t, id: () => `s${++n}` });
    const id = snowflakeAt(new Date('2026-09-20T00:00:00Z'));
    const s = await service.start({ identityId: id, wallet: '6'.repeat(40), game: 'diglew' });
    t = new Date(t.getTime() + 60000);
    await service.complete({ identityId: id, sessionId: s._id, nonce: s.nonce, rawScore: 9000 });
    t = new Date('2026-10-22T12:00:00Z');
    assert.notEqual((await service.cashout(id)).status, 'REVIEW', mode);
  }
});

test('approving re-checks the payout gate: a player blocked since the cash-out is not paid', async () => {
  let t = new Date('2026-10-20T12:00:00Z'); let n = 0; let blocked = false;
  const config = { ...getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0', XL1_REWARD_MODE: 'dry-run', XL1_REVIEW_CASHOUT_XL1: '0.01' }), mode: 'live' };
  const store = new MemoryArcadeStore();
  const service = new ArcadeRewardService({ store, config, now: () => t, id: () => `g${++n}`, gate: async () => (blocked ? 'xl1_blocked' : null) });
  const s = await service.start({ identityId: OLD, wallet: '7'.repeat(40), game: 'diglew' });
  t = new Date(t.getTime() + 60000);
  await service.complete({ identityId: OLD, sessionId: s._id, nonce: s.nonce, rawScore: 9000 });
  t = new Date('2026-10-22T12:00:00Z');
  assert.equal((await service.cashout(OLD)).status, 'REVIEW', 'a big-enough cash-out is reviewed');
  const [r] = await service.reviews();
  blocked = true;
  await assert.rejects(() => service.decide(r.id, 'approve', '876543210987654321'), /xl1_rewards_blocked/);
  assert.equal(store.rewards.get('g1').status, 'FLAGGED', 'still held, never queued');
});

test('a review token under 32 characters keeps the review routes closed', () => {
  assert.equal(getArcadeConfig({ XL1_ARCADE_REVIEW_TOKEN: 'short' }).reviewToken, '');
  assert.equal(getArcadeConfig({ XL1_ARCADE_REVIEW_TOKEN: 'x'.repeat(32) }).reviewToken.length, 32);
});
