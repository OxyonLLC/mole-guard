import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS, EVENT_TYPES, EVENT_STATUSES,
  validateEventRecord, findDuplicateEventIds, getEventById,
  classifyEventBucket, groupEventsByBucket, getEventsForPartner,
} from '../../src/mole/eventsData.js';

describe('seeded EVENTS data integrity', () => {
  test('every seeded event passes validateEventRecord', () => {
    for (const event of EVENTS) {
      const result = validateEventRecord(event);
      assert.equal(result.ok, true, `${event.id} failed: ${result.errors.join(',')}`);
    }
  });

  test('no duplicate event ids in the seeded data', () => {
    assert.deepEqual(findDuplicateEventIds(EVENTS), []);
  });

  test('every seeded COMPLETED event has at least one evidence link', () => {
    for (const event of EVENTS) {
      if (event.status === EVENT_STATUSES.COMPLETED) {
        assert.ok(event.evidence.length > 0, `${event.id} claims completed with no evidence`);
      }
    }
  });

  test('the 2BRZ event references a real partner id, not a duplicated partner record', () => {
    const event = getEventById('2brz-partnership-announcement-2025');
    assert.equal(event.partnerId, '2brz');
    assert.equal(event.name, undefined, 'event must not duplicate partner-shaped fields like name');
  });
});

describe('validateEventRecord', () => {
  test('rejects a record with no id/title', () => {
    const result = validateEventRecord({ type: EVENT_TYPES.AMA, status: EVENT_STATUSES.UPCOMING });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('missing_id'));
    assert.ok(result.errors.includes('missing_title'));
  });

  test('rejects an invalid type or status', () => {
    const base = { id: 'x', title: 'X' };
    assert.equal(validateEventRecord({ ...base, type: 'not-a-type', status: EVENT_STATUSES.UPCOMING }).ok, false);
    assert.equal(validateEventRecord({ ...base, type: EVENT_TYPES.AMA, status: 'not-a-status' }).ok, false);
  });

  test('rejects endIso before startIso', () => {
    const result = validateEventRecord({
      id: 'x', title: 'X', type: EVENT_TYPES.AMA, status: EVENT_STATUSES.UPCOMING,
      startIso: '2026-01-10T00:00:00Z', endIso: '2026-01-01T00:00:00Z',
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('end_before_start'));
  });

  test('rejects a COMPLETED event with zero evidence (no unsupported "this happened" claim)', () => {
    const result = validateEventRecord({
      id: 'x', title: 'X', type: EVENT_TYPES.AMA, status: EVENT_STATUSES.COMPLETED, evidence: [],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('completed_status_requires_evidence'));
  });

  test('allows an UPCOMING event with zero evidence (nothing to prove yet)', () => {
    const result = validateEventRecord({
      id: 'x', title: 'X', type: EVENT_TYPES.AMA, status: EVENT_STATUSES.UPCOMING, evidence: [],
    });
    assert.equal(result.ok, true);
  });

  test('a valid minimal record passes', () => {
    const result = validateEventRecord({
      id: 'x', title: 'X', type: EVENT_TYPES.GIVEAWAY, status: EVENT_STATUSES.UPCOMING,
    });
    assert.equal(result.ok, true);
  });
});

describe('findDuplicateEventIds', () => {
  test('detects a duplicate id', () => {
    const events = [
      { id: 'a', title: 'A' },
      { id: 'a', title: 'A again' },
      { id: 'b', title: 'B' },
    ];
    assert.deepEqual(findDuplicateEventIds(events), ['a']);
  });

  test('empty list has no duplicates', () => {
    assert.deepEqual(findDuplicateEventIds([]), []);
  });
});

describe('getEventById', () => {
  test('finds a real seeded event', () => {
    assert.ok(getEventById('raydium-farm-2025'));
  });
  test('returns null for an unknown id', () => {
    assert.equal(getEventById('does-not-exist'), null);
  });
});

describe('classifyEventBucket', () => {
  const NOW = Date.parse('2026-07-16T00:00:00Z');

  test('explicit CANCELLED always wins regardless of dates', () => {
    const event = { status: EVENT_STATUSES.CANCELLED, startIso: '2020-01-01T00:00:00Z' };
    assert.equal(classifyEventBucket(event, NOW), 'cancelled');
  });

  test('explicit POSTPONED always wins regardless of dates', () => {
    const event = { status: EVENT_STATUSES.POSTPONED, startIso: '2099-01-01T00:00:00Z' };
    assert.equal(classifyEventBucket(event, NOW), 'postponed');
  });

  test('explicit COMPLETED always wins regardless of dates', () => {
    const event = { status: EVENT_STATUSES.COMPLETED, startIso: '2099-01-01T00:00:00Z' };
    assert.equal(classifyEventBucket(event, NOW), 'completed');
  });

  test('UPCOMING status with a future start date buckets as upcoming', () => {
    const event = { status: EVENT_STATUSES.UPCOMING, startIso: '2099-01-01T00:00:00Z' };
    assert.equal(classifyEventBucket(event, NOW), 'upcoming');
  });

  test('UPCOMING status whose window has actually started buckets as live (time-derived, not stale)', () => {
    const event = { status: EVENT_STATUSES.UPCOMING, startIso: '2026-07-15T00:00:00Z', endIso: '2026-07-20T00:00:00Z' };
    assert.equal(classifyEventBucket(event, NOW), 'live');
  });

  test('UPCOMING status whose window has already ended buckets as completed (time-derived, not stuck on upcoming)', () => {
    const event = { status: EVENT_STATUSES.UPCOMING, startIso: '2020-01-01T00:00:00Z', endIso: '2020-01-02T00:00:00Z' };
    assert.equal(classifyEventBucket(event, NOW), 'completed');
  });

  test('no startIso at all buckets as upcoming (announced but not scheduled)', () => {
    const event = { status: EVENT_STATUSES.UPCOMING, startIso: null };
    assert.equal(classifyEventBucket(event, NOW), 'upcoming');
  });

  test('a point-in-time event (no endIso) with a past start date is completed', () => {
    const event = { status: EVENT_STATUSES.UPCOMING, startIso: '2020-01-01T00:00:00Z', endIso: null };
    assert.equal(classifyEventBucket(event, NOW), 'completed');
  });
});

describe('groupEventsByBucket', () => {
  const NOW = Date.parse('2026-07-16T00:00:00Z');

  test('places every seeded event into exactly one bucket, none lost', () => {
    const groups = groupEventsByBucket(EVENTS, NOW);
    const total = groups.upcoming.length + groups.live.length + groups.completed.length + groups.cancelledOrPostponed.length;
    assert.equal(total, EVENTS.length);
  });

  test('the two real seeded (2025, ended) events land in completed', () => {
    const groups = groupEventsByBucket(EVENTS, NOW);
    assert.ok(groups.completed.some((e) => e.id === 'raydium-farm-2025'));
    assert.ok(groups.completed.some((e) => e.id === '2brz-partnership-announcement-2025'));
  });

  test('empty input produces all-empty groups, no crash', () => {
    const groups = groupEventsByBucket([], NOW);
    assert.deepEqual(groups, { upcoming: [], live: [], completed: [], cancelledOrPostponed: [] });
  });
});

describe('getEventsForPartner', () => {
  test('finds the event(s) referencing the 2brz partner id', () => {
    const events = getEventsForPartner('2brz', EVENTS);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, '2brz-partnership-announcement-2025');
  });

  test('returns an empty array for a partner id with no events', () => {
    assert.deepEqual(getEventsForPartner('no-such-partner', EVENTS), []);
  });
});
