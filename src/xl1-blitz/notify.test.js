import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordNotifier } from './notify.js';

test('Discord log lines: plain amounts, masked wallet field, short hash, no secrets', () => {
  const posts = []; const n = discordNotifier('beta', 'live', e => posts.push(e));
  n({ kind: 'auto_approved', requestId: '5555c3ed-aaaa', units: '1302000', wallet: 'a'.repeat(40), reason: 'first_payout_discord_fast_track' });
  n({ kind: 'submitted', batchId: 'blitz-2026-11-26-0123456789abcdef', recipients: 1, totalUnits: '1302000', txHash: 'f'.repeat(64) });
  n({ kind: 'stopped', state: 'LOW_BALANCE' });
  assert.equal(posts[0].title, 'Blitz cash-out 1.302 XL1 auto-approved'); assert.equal(posts[0].source, 'BLITZ');
  assert.equal(posts[0].wallet, 'a'.repeat(40), 'siteLog masks it'); assert.equal(posts[0].trace, '5555c3ed');
  assert.equal(posts[1].title, 'Blitz payout sent: 1.302 XL1 to 1 wallet'); assert.match(posts[1].fields.Tx, /^`ffffffffff…ffffff`$/);
  assert.equal(posts[2].outcome, 'fail'); assert.match(posts[2].title, /Reserve too low/);
  assert.ok(!JSON.stringify(posts).match(/token|secret/i));
});
