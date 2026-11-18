// Rate-limit identity — the anti-spoofing contract.
//
// The backend is published through an ngrok tunnel whose origin is publicly
// reachable, and it binds loopback, so every request arrives from the local
// agent and visitors can only be told apart by a forwarded-IP header. Headers
// are written by the sender, so the rule is: believe exactly one hop (the one
// that opened the socket, which the sender did not get to write) and believe a
// forwarded claim only when it is authenticated with the shared secret.
//
// Regression guarded here: `trust proxy: true` made express take the LEFTMOST
// X-Forwarded-For entry — pure attacker input — so a fresh fake IP per request
// bought a fresh budget on every rate-limited route.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  trustedProxySetting,
  resolveClientKey,
  isIpLiteral,
  normalizeIp,
  secretsMatch,
  PROXY_SECRET_HEADER,
  PROXY_CLIENT_IP_HEADER,
} from '../../src/mole/clientIp.js';

const SECRET = 'a-long-random-proxy-secret';

test('trustedProxySetting defaults to loopback only and can never become `true`', () => {
  assert.deepEqual(trustedProxySetting(undefined), ['loopback']);
  assert.deepEqual(trustedProxySetting(''), ['loopback']);
  assert.deepEqual(trustedProxySetting('  '), ['loopback']);

  // The whole point of the fix: config must not be able to re-open the hole.
  assert.deepEqual(trustedProxySetting('true'), ['loopback']);
  assert.deepEqual(trustedProxySetting('*'), ['loopback']);
  assert.deepEqual(trustedProxySetting('all'), ['loopback']);
  assert.deepEqual(trustedProxySetting('true, 10.0.0.5'), ['10.0.0.5']);

  assert.equal(trustedProxySetting('false'), false);
  assert.equal(trustedProxySetting('off'), false);

  assert.deepEqual(trustedProxySetting('loopback, 10.0.0.0/8'), ['loopback', '10.0.0.0/8']);
});

test('express with the real setting takes the tunnel-observed hop, not attacker input', async () => {
  const app = express();
  app.set('trust proxy', trustedProxySetting(undefined));
  app.get('/whoami', (req, res) => res.json({ ip: req.ip }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // No forwarded header: the socket peer is the client.
    const direct = await (await fetch(`${base}/whoami`)).json();
    assert.equal(normalizeIp(direct.ip), '127.0.0.1');

    // One hop (what ngrok appends): that entry is the client.
    const oneHop = await (
      await fetch(`${base}/whoami`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })
    ).json();
    assert.equal(oneHop.ip, '203.0.113.9');

    // The attack: a forged chain in front of the entry ngrok appended. The
    // forged entries must be ignored — only the rightmost one survives.
    const forged = await (
      await fetch(`${base}/whoami`, {
        headers: { 'X-Forwarded-For': '1.2.3.4, 5.6.7.8, 203.0.113.9' },
      })
    ).json();
    assert.equal(forged.ip, '203.0.113.9', 'leftmost (attacker-written) entry must not win');

    // Same attacker, ten made-up IPs, still one bucket.
    const keys = new Set();
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${base}/whoami`, {
        headers: { 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.9` },
      });
      keys.add(resolveClientKey({ reqIp: (await res.json()).ip, headers: {}, secret: SECRET }));
    }
    assert.equal(keys.size, 1, 'spoofed X-Forwarded-For must not mint new rate-limit buckets');
  } finally {
    server.close();
  }
});

test('an unauthenticated forwarded-IP claim is ignored', () => {
  const observed = '198.51.100.7';

  // No secret configured at all: the header path is off entirely.
  assert.equal(
    resolveClientKey({
      reqIp: observed,
      headers: { [PROXY_CLIENT_IP_HEADER]: '1.2.3.4' },
      secret: '',
    }),
    observed
  );

  // Secret configured, none presented.
  assert.equal(
    resolveClientKey({
      reqIp: observed,
      headers: { [PROXY_CLIENT_IP_HEADER]: '1.2.3.4' },
      secret: SECRET,
    }),
    observed
  );

  // Wrong secret presented.
  assert.equal(
    resolveClientKey({
      reqIp: observed,
      headers: {
        [PROXY_SECRET_HEADER]: 'not-the-secret',
        [PROXY_CLIENT_IP_HEADER]: '1.2.3.4',
      },
      secret: SECRET,
    }),
    observed
  );
});

test('the authenticated proxy gets its visitors bucketed individually', () => {
  const sharedHost = '198.51.100.7';
  const headersFor = (ip) => ({
    [PROXY_SECRET_HEADER]: SECRET,
    [PROXY_CLIENT_IP_HEADER]: ip,
  });

  assert.equal(
    resolveClientKey({ reqIp: sharedHost, headers: headersFor('203.0.113.20'), secret: SECRET }),
    '203.0.113.20'
  );

  // Two visitors behind the one shared host must not share a budget.
  assert.notEqual(
    resolveClientKey({ reqIp: sharedHost, headers: headersFor('203.0.113.20'), secret: SECRET }),
    resolveClientKey({ reqIp: sharedHost, headers: headersFor('203.0.113.21'), secret: SECRET })
  );

  // A vouched-for but unusable claim falls back to the proxy's own bucket
  // rather than a shared "invalid" bucket everyone would land in.
  for (const junk of ['', 'not-an-ip', '999.1.1.1', 'localhost', '203.0.113.20; DROP']) {
    assert.equal(
      resolveClientKey({ reqIp: sharedHost, headers: headersFor(junk), secret: SECRET }),
      sharedHost,
      `junk claim ${JSON.stringify(junk)} must not be used as a key`
    );
  }
});

test('the same visitor lands in one bucket whichever path they take', () => {
  // req.ip arrives IPv4-mapped over an IPv6 socket; the proxy reports plain v4.
  const viaTunnel = resolveClientKey({ reqIp: '::ffff:203.0.113.20', headers: {}, secret: SECRET });
  const viaProxy = resolveClientKey({
    reqIp: '198.51.100.7',
    headers: { [PROXY_SECRET_HEADER]: SECRET, [PROXY_CLIENT_IP_HEADER]: '203.0.113.20' },
    secret: SECRET,
  });
  assert.equal(viaTunnel, '203.0.113.20');
  assert.equal(viaProxy, viaTunnel);
});

test('a missing req.ip still produces a stable key', () => {
  assert.equal(resolveClientKey({ reqIp: undefined, headers: {}, secret: SECRET }), 'unknown');
  assert.equal(resolveClientKey({}), 'unknown');
});

test('IP literals and secret comparison', () => {
  assert.ok(isIpLiteral('127.0.0.1'));
  assert.ok(isIpLiteral('::1'));
  assert.ok(isIpLiteral('::ffff:10.0.0.1'));
  assert.ok(!isIpLiteral('256.0.0.1'));
  assert.ok(!isIpLiteral('1.2.3'));
  assert.ok(!isIpLiteral(''));
  assert.ok(!isIpLiteral(null));

  assert.ok(secretsMatch(SECRET, SECRET));
  assert.ok(!secretsMatch(SECRET, `${SECRET}x`));
  assert.ok(!secretsMatch('', ''));
  assert.ok(!secretsMatch(undefined, SECRET));
});
