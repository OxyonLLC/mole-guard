import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeIpBanTarget, parseIpBanTtl, __testing } from '../../src/shared/ipDenylist.js';

test('normalizeIpBanTarget normalizes ipv4-mapped ipv6', () => {
  assert.equal(normalizeIpBanTarget('::ffff:203.0.113.9'), '203.0.113.9');
});

test('normalizeIpBanTarget rejects non-ip input', () => {
  assert.throws(() => normalizeIpBanTarget('not-an-ip'), /not_an_ip_address/);
});

test('parseIpBanTtl parses compact duration strings', () => {
  assert.equal(parseIpBanTtl('15m'), 15 * 60_000);
  assert.equal(parseIpBanTtl('2h'), 2 * 3_600_000);
});

test('purgeExpired removes expired entries and keeps active ones', () => {
  const now = Date.now();
  const state = {
    version: 1,
    bans: {
      '203.0.113.9': { ip: '203.0.113.9', expiresAt: now - 1 },
      '203.0.113.10': { ip: '203.0.113.10', expiresAt: now + 60_000 },
      '203.0.113.11': { ip: '203.0.113.11', expiresAt: null },
    },
  };

  const changed = __testing.purgeExpired(state, now);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(state.bans).sort(), ['203.0.113.10', '203.0.113.11']);
});
