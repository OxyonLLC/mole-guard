process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';

// Covers src/faucet/coTiming.js — which accounts keep claiming the faucet
// together. Pure functions over claim records, so these tests pin the
// JUDGEMENT the detector encodes, not plumbing.
//
// The judgement that matters: a single shared burst must NOT be reported. A
// faucet announcement brings a crowd and everyone claims at once; flagging
// that would bury a real pattern in noise and point suspicion at innocent
// people. Only pairs that recur across separate days are surfaced.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupIntoBursts, findCoTimingPairs, dayKey, formatGap,
  DEFAULT_WINDOW_MS, DEFAULT_MIN_DAYS,
} from '../../src/faucet/coTiming.js';

const DAY = 24 * 60 * 60 * 1000;
const MON = Date.UTC(2026, 6, 6, 15, 0, 0); // a Monday, 15:00 UTC

/** One claim record, trimmed to the fields the detector reads. */
function claim(discordUserId, createdAt, wallet = `wallet-${discordUserId}`) {
  return { id: `${discordUserId}-${createdAt}`, discordUserId, wallet, createdAt, source: 'discord', status: 'confirmed' };
}

describe('groupIntoBursts', () => {
  test('claims within the window form one burst', () => {
    const bursts = groupIntoBursts([
      claim('a', MON), claim('b', MON + 60_000), claim('c', MON + 5 * 60_000),
    ]);
    assert.equal(bursts.length, 1);
    assert.equal(bursts[0].length, 3);
  });

  test('a gap larger than the window starts a new burst', () => {
    const bursts = groupIntoBursts([claim('a', MON), claim('b', MON + 30 * 60_000)]);
    assert.equal(bursts.length, 2);
  });

  test('a burst continues while each claim is close to the previous one', () => {
    // Nine minutes apart each, so 27 minutes end to end — still one burst,
    // because the run is unbroken. Cutting at a fixed offset from the start
    // would split a steady trickle arbitrarily.
    const bursts = groupIntoBursts([
      claim('a', MON), claim('b', MON + 9 * 60_000),
      claim('c', MON + 18 * 60_000), claim('d', MON + 27 * 60_000),
    ]);
    assert.equal(bursts.length, 1);
    assert.equal(bursts[0].length, 4);
  });

  test('unordered input is handled, and junk records are dropped', () => {
    const bursts = groupIntoBursts([
      claim('b', MON + 60_000), claim('a', MON),
      { discordUserId: 'x' }, { createdAt: MON }, null,
    ]);
    assert.equal(bursts.length, 1);
    assert.deepEqual(bursts[0].map((c) => c.discordUserId), ['a', 'b']);
  });
});

describe('findCoTimingPairs', () => {
  test('one shared burst is NOT reported — that is just a busy faucet', () => {
    const pairs = findCoTimingPairs([claim('a', MON), claim('b', MON + 60_000)]);
    assert.deepEqual(pairs, [], 'a single coincidence must never accuse anyone');
  });

  test('the same pair on two separate days is reported', () => {
    const pairs = findCoTimingPairs([
      claim('a', MON), claim('b', MON + 60_000),
      claim('a', MON + DAY), claim('b', MON + DAY + 90_000),
    ]);
    assert.equal(pairs.length, 1);
    assert.deepEqual(pairs[0].accounts, ['a', 'b']);
    assert.equal(pairs[0].dayCount, 2);
    assert.equal(pairs[0].tightestGapMs, 60_000, 'the closest approach, not the average');
  });

  test('two bursts on the SAME day still count as one day', () => {
    // Otherwise anyone claiming twice in a day looks twice as suspicious.
    const pairs = findCoTimingPairs([
      claim('a', MON), claim('b', MON + 60_000),
      claim('a', MON + 6 * 60 * 60_000), claim('b', MON + 6 * 60 * 60_000 + 60_000),
    ]);
    assert.deepEqual(pairs, [], 'same day twice is one day, below the 2-day floor');
  });

  test('three accounts together yield all three pairs', () => {
    const claims = [];
    for (const day of [0, 1]) {
      claims.push(claim('a', MON + day * DAY));
      claims.push(claim('b', MON + day * DAY + 60_000));
      claims.push(claim('c', MON + day * DAY + 120_000));
    }
    const pairs = findCoTimingPairs(claims);
    assert.equal(pairs.length, 3);
    assert.deepEqual(pairs.map((p) => p.accounts).sort(), [['a', 'b'], ['a', 'c'], ['b', 'c']]);
  });

  test('an account claiming twice in a burst is not paired with itself', () => {
    const pairs = findCoTimingPairs([
      claim('a', MON), claim('a', MON + 30_000),
      claim('a', MON + DAY), claim('a', MON + DAY + 30_000),
    ]);
    assert.deepEqual(pairs, []);
  });

  test('accounts that never overlap are never paired', () => {
    const claims = [];
    for (const day of [0, 1, 2]) {
      claims.push(claim('a', MON + day * DAY));
      claims.push(claim('b', MON + day * DAY + 3 * 60 * 60_000)); // three hours later
    }
    assert.deepEqual(findCoTimingPairs(claims), []);
  });

  test('results are ranked by days together, then by how close they arrive', () => {
    const claims = [];
    for (const day of [0, 1, 2]) { // a+b on three days
      claims.push(claim('a', MON + day * DAY));
      claims.push(claim('b', MON + day * DAY + 5 * 60_000));
    }
    for (const day of [0, 1]) {   // c+d on two, but tighter
      claims.push(claim('c', MON + day * DAY + 60 * 60_000));
      claims.push(claim('d', MON + day * DAY + 60 * 60_000 + 2_000));
    }
    const pairs = findCoTimingPairs(claims);
    assert.deepEqual(pairs[0].accounts, ['a', 'b'], 'more days outranks a tighter gap');
    assert.equal(pairs[0].dayCount, 3);
    assert.deepEqual(pairs[1].accounts, ['c', 'd']);
  });

  test('carries the wallets each account used, for the funding-graph follow-up', () => {
    const pairs = findCoTimingPairs([
      claim('a', MON, 'walletA'), claim('b', MON + 60_000, 'walletB'),
      claim('a', MON + DAY, 'walletA2'), claim('b', MON + DAY + 60_000, 'walletB'),
    ]);
    assert.deepEqual(pairs[0].wallets.a.sort(), ['walletA', 'walletA2']);
    assert.deepEqual(pairs[0].wallets.b, ['walletB']);
  });

  test('minDays is honoured', () => {
    const claims = [];
    for (const day of [0, 1, 2]) {
      claims.push(claim('a', MON + day * DAY));
      claims.push(claim('b', MON + day * DAY + 60_000));
    }
    assert.equal(findCoTimingPairs(claims, { minDays: 3 }).length, 1);
    assert.equal(findCoTimingPairs(claims, { minDays: 4 }).length, 0);
  });

  test('a narrower window can separate a pair that a wide one merges', () => {
    const claims = [];
    for (const day of [0, 1]) {
      claims.push(claim('a', MON + day * DAY));
      claims.push(claim('b', MON + day * DAY + 8 * 60_000));
    }
    assert.equal(findCoTimingPairs(claims, { windowMs: 10 * 60_000 }).length, 1);
    assert.equal(findCoTimingPairs(claims, { windowMs: 5 * 60_000 }).length, 0);
  });

  test('empty and tiny inputs are safe', () => {
    assert.deepEqual(findCoTimingPairs([]), []);
    assert.deepEqual(findCoTimingPairs([claim('a', MON)]), []);
  });
});

describe('helpers', () => {
  test('dayKey is UTC, so a reviewer’s timezone cannot change the answer', () => {
    assert.equal(dayKey(Date.UTC(2026, 6, 6, 23, 59, 59)), '2026-07-06');
    assert.equal(dayKey(Date.UTC(2026, 6, 7, 0, 0, 1)), '2026-07-07');
  });

  test('formatGap reads like a human wrote it', () => {
    assert.equal(formatGap(45_000), '45s');
    assert.equal(formatGap(60_000), '1m');
    assert.equal(formatGap(200_000), '3m 20s');
    assert.equal(formatGap(null), 'n/a');
  });

  test('the defaults are the documented ones', () => {
    assert.equal(DEFAULT_WINDOW_MS, 10 * 60 * 1000);
    assert.equal(DEFAULT_MIN_DAYS, 2);
  });
});
