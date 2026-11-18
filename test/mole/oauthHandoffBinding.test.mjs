// A session must only reach the browser that started the flow.
//
// These callbacks used to put a session token straight into the address bar.
// A session is a bearer credential and wallet-auth adopted a `?session=` from
// ANY url on ANY page, so `winlew.co/home/?session=<attacker's token>` was
// enough to run someone else's browser as the attacker's account — after which
// the victim's play, claims and connected wallet all accrue to an account whose
// payout wallet the attacker controls.
//
// The fix is the exchange nativeHandoff.js already implements, run in the
// direction that closes the gap that module documents as residual: the browser
// registers the HASH of its secret BEFORE the round trip, so a handoff id is
// bound from the moment it exists.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-handoff-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8871;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);
process.env.X_CLIENT_ID = 'test-x-client-id';
process.env.X_CLIENT_SECRET = 'test-x-client-secret';
process.env.X_REDIRECT_URI = `http://127.0.0.1:${PORT}/x-oauth-callback`;

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = `http://127.0.0.1:${PORT}`;
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

before(async () => {
  const web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});
after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});

describe('the claim hash rides the OAuth state', () => {
  test('a start call accepts one and still returns an authorize URL', async () => {
    const body = await (await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimHash: sha256('a-secret') }),
    })).json();
    assert.equal(body.ok, true);
    assert.ok(body.url.startsWith('https://x.com/i/oauth2/authorize'));
  });

  test('the hash never appears in anything the browser is handed', async () => {
    const hash = sha256('another-secret');
    const body = await (await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimHash: hash }),
    })).json();
    assert.ok(!body.url.includes(hash), 'the state is a server-side id; the blob stays on the server');
  });

  test('a malformed hash is treated as no binding, not as a failure', async () => {
    for (const bad of ['', 'nope', 'zz'.repeat(32), sha256('x').slice(0, 63)]) {
      const res = await fetch(`${BASE}/api/account/signin/x/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimHash: bad }),
      });
      assert.equal(res.status, 200, `a sign-in that fails closed on a typo is one nobody can complete (${bad})`);
    }
  });
});

describe('Discord-initiated linked-role is bounced to get bound', () => {
  test('no claim hash -> sent to our own origin to mint one', async () => {
    const res = await fetch(`${BASE}/linked-role/mole`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const target = new URL(res.headers.get('location'));
    assert.equal(target.searchParams.get('connect'), 'mole');
    assert.ok(!target.searchParams.get('session'), 'the whole point is that no session travels here');
    assert.ok(!/discord\.com/.test(target.host), 'it must not reach Discord unbound');
  });

  test('with a claim hash -> straight to Discord, as before', async () => {
    const res = await fetch(`${BASE}/linked-role/mole?claimHash=${sha256('s')}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^https:\/\/discord\.com\/oauth2\/authorize/);
  });

  test('the return path survives the bounce', async () => {
    const res = await fetch(`${BASE}/linked-role/mole?next=%2Fevents%2F`, { redirect: 'manual' });
    const target = new URL(res.headers.get('location'));
    assert.equal(target.searchParams.get('next'), '/events/');
  });

  test('it bounces AT MOST once — the two hops point at each other', async () => {
    // If a claim hash were ever lost in between (a proxy that drops the
    // parameter, an origin with no crypto.subtle), an unguarded pair of
    // redirects would ping-pong a visitor forever.
    const res = await fetch(`${BASE}/linked-role/mole?b=1`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^https:\/\/discord\.com\/oauth2\/authorize/,
      'the second pass must proceed, not bounce again');
  });

  test('the guard alone does not skip binding when a hash IS present', async () => {
    const res = await fetch(`${BASE}/linked-role/mole?b=1&claimHash=${sha256('s')}`, { redirect: 'manual' });
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    assert.ok(state, 'still a real authorize URL');
  });

  test('a hostile return path does not', async () => {
    const res = await fetch(`${BASE}/linked-role/mole?next=https%3A%2F%2Fevil.example`, { redirect: 'manual' });
    const target = new URL(res.headers.get('location'));
    assert.ok(!String(target.searchParams.get('next') || '').includes('evil.example'));
  });
});

describe('a hand-off cannot be redeemed without the secret', () => {
  test('the wrong secret is refused', async () => {
    const start = await (await fetch(`${BASE}/api/hub/native-handoff/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimHash: sha256('the-real-secret') }),
    })).json();
    assert.ok(start.handoffId);

    const res = await fetch(`${BASE}/api/hub/native-handoff/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoffId: start.handoffId, claimSecret: 'not-the-secret' }),
    });
    const body = await res.json().catch(() => ({}));
    assert.ok(!body.session, 'an intercepted id without the secret is worthless — the whole design');
    assert.match(String(body.error || ''), /claim_secret_mismatch/);
  });

  test('the right secret before any deposit reports pending, not failure', async () => {
    const secret = 'pending-secret';
    const start = await (await fetch(`${BASE}/api/hub/native-handoff/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimHash: sha256(secret) }),
    })).json();
    const body = await (await fetch(`${BASE}/api/hub/native-handoff/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoffId: start.handoffId, claimSecret: secret }),
    })).json();
    assert.equal(body.pending, true);
    assert.ok(!body.session);
  });
});
