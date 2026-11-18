// The review queue's safety valve.
//
// The owner's objection to hold-for-review: "i would hate not to see something
// and it never get reviewed and then..." He was right. A hold that needs a human
// is fail-CLOSED if no human turns up — the participant is never paid, never
// told, and nothing says so.
//
// So the property under test is not "does it hold the right things". It is:
// NOTHING CAN SIT IN THIS QUEUE FOREVER WITHOUT EITHER PAYING OUT OR SHOUTING.
const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyHold, isHardHold, dueForEscalation, formatDigest, formatEscalation,
  sweepReviewQueue, resolveReviewConfig, HARD_SIGNALS,
} = require('../../src/quiz/reviewQueue');

const HOUR = 60 * 60 * 1000;
const NOW = 1786678391085;
const CONFIG = resolveReviewConfig({});

function held({ ageHours = 0, signals = ['shared_device'], provenance = null, id = 'r1', noTimestamp = false } = {}) {
  return {
    id, userId: 'u1', amount: 1500, kind: 'cycle_payout', status: 'pending', decision: 'held',
    heldTs: noTimestamp ? 0 : NOW - ageHours * HOUR,
    risk: { band: 'held', score: 80, signals, rulesVersion: 'participation-trust/1.0.0' },
    firstPayoutCheck: provenance,
  };
}

describe('nothing sits in the queue forever', () => {
  test('a soft hold nobody reviewed is released once the deadline passes', () => {
    const verdict = classifyHold(held({ ageHours: CONFIG.slaHours + 1 }), { now: NOW, config: CONFIG });
    assert.equal(verdict.action, 'release',
      'a payout nobody reviewed would have been withheld indefinitely');
  });

  test('inside the deadline it waits quietly', () => {
    assert.equal(classifyHold(held({ ageHours: 1 }), { now: NOW, config: CONFIG }).action, 'wait');
  });

  test('with auto-release switched off it escalates instead of going quiet', () => {
    // The operator has chosen to hold indefinitely. The least the system can do
    // is refuse to be silent about money it is sitting on.
    const config = resolveReviewConfig({ QUIZ_REVIEW_AUTO_RELEASE_ENABLED: 'false' });
    const verdict = classifyHold(held({ ageHours: config.slaHours + 1 }), { now: NOW, config });
    assert.equal(verdict.action, 'escalate');
    assert.equal(verdict.reason, 'overdue_auto_release_disabled');
  });

  test('a hold with no timestamp cannot be aged, so it is escalated not released', () => {
    // Releasing on a guess would be paying out on missing data; staying silent
    // is the original bug. Escalating is the only honest option left.
    const verdict = classifyHold(held({ noTimestamp: true }), { now: NOW, config: CONFIG });
    assert.equal(verdict.action, 'escalate');
    assert.equal(verdict.reason, 'no_held_timestamp');
  });

  test('auto-release is ON by default', () => {
    // Enforcement without this valve is a money black hole. If someone flips
    // this default, that is the thing to argue about.
    assert.equal(resolveReviewConfig({}).autoReleaseEnabled, true);
  });
});

describe('what a timer must never overrule', () => {
  test('a ban-linked hold never auto-releases', () => {
    for (const signal of HARD_SIGNALS) {
      const verdict = classifyHold(held({ ageHours: 1000, signals: [signal] }), { now: NOW, config: CONFIG });
      assert.notEqual(verdict.action, 'release',
        `${signal} was released on a timer — that overrules a human's ban decision`);
      assert.equal(verdict.action, 'escalate');
    }
  });

  test('a hard signal from the provenance check counts too', () => {
    const rec = held({
      signals: [],
      ageHours: 1000,
      provenance: { findings: [{ signal: 'funded_by_banned_wallet', weight: 100, note: '' }] },
    });
    assert.equal(isHardHold(rec), true);
    assert.equal(classifyHold(rec, { now: NOW, config: CONFIG }).action, 'escalate');
  });

  test('a zero-weight provenance finding is not a hard signal', () => {
    const rec = held({
      signals: [],
      provenance: { findings: [{ signal: 'funded_by_known_participant', weight: 0, note: '' }] },
    });
    assert.equal(isHardHold(rec), false);
  });

  test('there is no path to an automatic rejection', () => {
    // The timer only ever runs in the participant's favour.
    const actions = new Set();
    for (const ageHours of [0, 1, 100, 10000]) {
      for (const signals of [[], ['shared_device'], ['linked_to_banned_wallet']]) {
        actions.add(classifyHold(held({ ageHours, signals }), { now: NOW, config: CONFIG }).action);
      }
    }
    assert.deepEqual([...actions].sort(), ['escalate', 'release', 'wait']);
  });
});

describe('reminders that stay readable', () => {
  test('a never-escalated record is due immediately', () => {
    assert.equal(dueForEscalation(held({}), { now: NOW, config: CONFIG }), true);
  });

  test('one escalated an hour ago is not due again yet', () => {
    const rec = { ...held({}), lastEscalatedTs: NOW - HOUR };
    assert.equal(dueForEscalation(rec, { now: NOW, config: CONFIG }), false);
  });

  test('the reminder changes as it repeats', () => {
    const rec = held({ ageHours: 100 });
    const verdict = classifyHold(rec, { now: NOW, config: CONFIG });
    const first = formatEscalation({ ...rec, escalations: 0 }, verdict);
    const tenth = formatEscalation({ ...rec, escalations: 9 }, verdict);
    assert.notEqual(first, tenth, 'an alert that reads identically every time stops being read');
    assert.match(tenth, /reminder #10/);
  });

  test('a hard hold says plainly that it will not resolve itself', () => {
    const rec = held({ ageHours: 100, signals: ['linked_to_banned_wallet'] });
    const message = formatEscalation(rec, classifyHold(rec, { now: NOW, config: CONFIG }));
    assert.match(message, /will NOT auto-release/);
    assert.match(message, /points are intact/i);
  });

  test('the digest warns loudly when auto-release is off', () => {
    const config = resolveReviewConfig({ QUIZ_REVIEW_AUTO_RELEASE_ENABLED: 'false' });
    const rec = held({ ageHours: 10 });
    const digest = formatDigest([{ rec, verdict: classifyHold(rec, { now: NOW, config }) }], { now: NOW, config });
    assert.match(digest, /Auto-release is DISABLED/);
  });

  test('an empty queue produces no digest — silence should mean nothing is waiting', () => {
    assert.equal(formatDigest([], { now: NOW, config: CONFIG }), null);
  });
});

describe('a sweep of the whole queue', () => {
  function fakeDb(records) {
    const state = { records, digestTs: 0, released: [], escalated: [] };
    return {
      state,
      listHeldRedemptions: () => state.records,
      autoReleaseHeldRedemption: ({ id }) => { state.released.push(id); return { ok: true }; },
      noteHoldEscalation: ({ id }) => { state.escalated.push(id); return { ok: true }; },
      getReviewDigestTs: () => state.digestTs,
      setReviewDigestTs: (ts) => { state.digestTs = ts; },
    };
  }

  test('releases the stale, escalates the ban-linked, leaves the fresh alone', async () => {
    const db = fakeDb([
      held({ id: 'stale', ageHours: CONFIG.slaHours + 5 }),
      held({ id: 'banned', ageHours: CONFIG.slaHours + 5, signals: ['linked_to_banned_wallet'] }),
      held({ id: 'fresh', ageHours: 1 }),
    ]);
    const sent = [];
    const result = await sweepReviewQueue({ db, announce: async (m) => sent.push(m), now: NOW, config: CONFIG });

    assert.deepEqual(db.state.released, ['stale']);
    assert.deepEqual(db.state.escalated, ['banned']);
    assert.equal(result.waiting, 1);
    assert.equal(result.hard, 1);
  });

  test('an auto-release is announced, not quietly done', async () => {
    // The operator should have to see that a payout went out unreviewed. It is
    // the system telling them the queue is unattended.
    const db = fakeDb([held({ ageHours: CONFIG.slaHours + 5 })]);
    const sent = [];
    await sweepReviewQueue({ db, announce: async (m) => sent.push(m), now: NOW, config: CONFIG });
    assert.ok(sent.some((m) => /Auto-released/.test(m)), 'a payout was released with nobody told');
    assert.ok(sent.some((m) => /Nobody reviewed this/.test(m)));
  });

  test('the digest fires on schedule even when nothing changed', async () => {
    const db = fakeDb([held({ ageHours: 2 })]);
    const sent = [];
    // Nothing to release, nothing due for escalation — the queue would
    // otherwise be silent precisely while it is being ignored.
    db.state.digestTs = NOW - (CONFIG.digestHours + 1) * HOUR;
    db.state.records[0].lastEscalatedTs = NOW;
    const result = await sweepReviewQueue({ db, announce: async (m) => sent.push(m), now: NOW, config: CONFIG });
    assert.equal(result.digested, true);
    assert.ok(sent.some((m) => /review queue/.test(m)));
  });

  test('a released record is not carried into the digest', async () => {
    const db = fakeDb([held({ id: 'gone', ageHours: CONFIG.slaHours + 5 })]);
    db.state.digestTs = NOW - (CONFIG.digestHours + 1) * HOUR;
    const sent = [];
    const result = await sweepReviewQueue({ db, announce: async (m) => sent.push(m), now: NOW, config: CONFIG });
    assert.equal(result.digested, false, 'a payout that just went out was listed as still waiting');
  });

  test('a database failure is reported, never thrown — payouts must not stop', async () => {
    const broken = {
      listHeldRedemptions: () => { throw new Error('db locked'); },
    };
    const result = await sweepReviewQueue({ db: broken, now: NOW, config: CONFIG });
    assert.equal(result.held, 0);
    assert.match(result.errors[0], /list_failed/);
  });

  test('one record failing to release does not abandon the rest', async () => {
    const db = fakeDb([
      held({ id: 'bad', ageHours: CONFIG.slaHours + 5 }),
      held({ id: 'good', ageHours: CONFIG.slaHours + 5 }),
    ]);
    db.autoReleaseHeldRedemption = ({ id }) => {
      if (id === 'bad') return { ok: false, error: 'gone' };
      db.state.released.push(id);
      return { ok: true };
    };
    const result = await sweepReviewQueue({ db, announce: async () => {}, now: NOW, config: CONFIG });
    assert.deepEqual(db.state.released, ['good']);
    assert.match(result.errors[0], /release_failed:bad/);
  });
});
