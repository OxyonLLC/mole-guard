import test from 'node:test';
import assert from 'node:assert/strict';
import { isDiscordIdentity, makeStartVerification } from './verify-start.js';

const ID = '248525967377694720';
// The bot's PUBLIC_BASE_URL is winlew.co's PHP relay, so this is what its links look like.
const LINK = 'https://winlew.co/xl1/verify/api-proxy.php/verify/';
const ok = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

test('only a Discord identity can start XL1 wallet verification', async () => {
  assert.equal(isDiscordIdentity(ID), true);
  assert.equal(isDiscordIdentity('wallet:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), false);
  const start = makeStartVerification({ token: 't', fetchFn: () => assert.fail('must not call the bot') });
  await assert.rejects(start('wallet:abc'), /needs_identity_sync/);
});

test('the bot is asked with the secret, the Discord ID and the arcade as the return page', async () => {
  let seen;
  const start = makeStartVerification({ base: 'http://127.0.0.1:8793/', token: ' s3cret ', fetchFn: async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ url: `${LINK}AbCdEfGhIjKlMnOpQrStUvWxYz012345`, expiresAt: 'x' }) };
  } });
  assert.deepEqual(await start(ID), { url: `${LINK}AbCdEfGhIjKlMnOpQrStUvWxYz012345`, expiresAt: 'x' });
  assert.equal(seen.url, 'http://127.0.0.1:8793/api/web-verify-session');
  assert.equal(seen.init.headers.authorization, 'Bearer s3cret');
  assert.deepEqual(JSON.parse(seen.init.body), { discordUserId: ID, returnTo: 'https://winlew.co/xl1/arcade/' });
});

test('anything but a public verify link is refused, and failures read as unavailable', async () => {
  const id = 'AbCdEfGhIjKlMnOpQrStUvWx';
  for (const url of [`https://winlew.co/verify/${id}`, `http://winlew.co/xl1/verify/api-proxy.php/verify/${id}`,
    `https://winlew.co.evil.example/xl1/verify/api-proxy.php/verify/${id}`, `${LINK}${id}/../../phish`, `${LINK}${id}?x=1`,
    `https://evil.example/verify/${id}`, 'https://evil.example/phish', 'javascript:alert(1)', 42]) {
    await assert.rejects(makeStartVerification({ token: 't', fetchFn: ok({ url }) })(ID), /xl1_verify_unavailable/, String(url));
  }
  await assert.rejects(makeStartVerification({ token: 't', fetchFn: ok({ error: 'unauthorized' }, 401) })(ID), /xl1_verify_unavailable/);
  await assert.rejects(makeStartVerification({ token: 't', fetchFn: async () => { throw new Error('ECONNREFUSED'); } })(ID), /xl1_verify_unavailable/);
  await assert.rejects(makeStartVerification({ token: '', fetchFn: () => assert.fail('no secret, no call') })(ID), /xl1_verify_unavailable/);
});
