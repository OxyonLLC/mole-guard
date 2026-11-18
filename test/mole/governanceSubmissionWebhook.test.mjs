// Governance hardening (2026-07-17 security audit) — proves the
// mention-injection guard on the new proposal-submission Discord webhook
// actually holds: submission `title`/`summary` are user-supplied free text,
// unlike every other interpolated value in this module's webhook messages
// (Discord ids, wallet addresses, balances — all server-resolved). Without
// `allowed_mentions`, a submitter embedding "@everyone" in their own title
// would actually ping the whole server the moment this posts to Discord.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendGovernanceSubmissionMessage } from '../../src/mole/web.js';

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123456789/fake-token-for-tests';

function withStubbedFetch(t, implementation) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return implementation ? implementation(url, init) : { ok: true, text: async () => '' };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}

describe('sendGovernanceSubmissionMessage — Discord mention-injection guard', () => {
  test('a title/summary containing @everyone/@here/a role mention never reaches allowed_mentions.parse', async (t) => {
    const calls = withStubbedFetch(t);
    await sendGovernanceSubmissionMessage({
      webhookUrl: DISCORD_WEBHOOK_URL,
      submission: {
        discordUserId: '111222333',
        category: 'community',
        title: '@everyone please vote for this <@&999888777>',
        summary: 'Also pinging @here for visibility.',
      },
    });

    assert.equal(calls.length, 1, 'exactly one webhook POST should be made');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.allowed_mentions.parse, [], 'no mention category may be broadly parsed');
  });

  test('the legitimate submitter credit mention is still explicitly allow-listed', async (t) => {
    const calls = withStubbedFetch(t);
    await sendGovernanceSubmissionMessage({
      webhookUrl: DISCORD_WEBHOOK_URL,
      submission: { discordUserId: '555666777', category: 'features', title: 'A real idea', summary: 'A real summary.' },
    });

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.allowed_mentions.users, ['555666777'], 'only the server-resolved submitter id is allow-listed, nothing from free text');
  });

  test('the raw free text is still included in the message content (not silently dropped)', async (t) => {
    const calls = withStubbedFetch(t);
    await sendGovernanceSubmissionMessage({
      webhookUrl: DISCORD_WEBHOOK_URL,
      submission: { discordUserId: '1', category: 'community', title: '@everyone Title Here', summary: 'Summary text here.' },
    });

    const body = JSON.parse(calls[0].init.body);
    assert.match(body.content, /Title Here/);
    assert.match(body.content, /Summary text here/);
  });

  test('a non-Discord webhook URL never triggers a fetch (Discord-only feature)', async (t) => {
    const calls = withStubbedFetch(t);
    await sendGovernanceSubmissionMessage({
      webhookUrl: 'https://example.com/not-discord',
      submission: { discordUserId: '1', category: 'community', title: 'x', summary: 'y' },
    });
    assert.equal(calls.length, 0);
  });

  test('no webhook URL configured is a silent no-op, never a throw', async (t) => {
    withStubbedFetch(t);
    await assert.doesNotReject(sendGovernanceSubmissionMessage({ webhookUrl: undefined, submission: { discordUserId: '1', category: 'community', title: 'x', summary: 'y' } }));
  });

  test('a failed webhook POST is caught internally, never rejects the caller', async (t) => {
    withStubbedFetch(t, () => { throw new Error('network unreachable'); });
    await assert.doesNotReject(sendGovernanceSubmissionMessage({
      webhookUrl: DISCORD_WEBHOOK_URL,
      submission: { discordUserId: '1', category: 'community', title: 'x', summary: 'y' },
    }));
  });
});
