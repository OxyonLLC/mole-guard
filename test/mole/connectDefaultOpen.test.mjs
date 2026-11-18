// The connect gate must be OFF unless someone turns it on (2026-08-20).
//
// It shipped enabled and spent a day refusing real people with
// "Connect refused — no account behind this wallet", pointing them at a sign-in
// that does not exist anywhere in the site's navigation. The owner's report was
// the whole problem in one line: "I dont even SEE WHERE ONE CAN LOGIN AT."
//
// This test exists so the default cannot drift back before that door is built.
// The gate itself is still fully tested in connectRequiresAccount.test.mjs,
// which opts in explicitly.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-default-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8817;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);
// Deliberately NOT set — this file is about what happens with no configuration.
delete process.env.HUB_REQUIRE_LOGIN_BEFORE_CONNECT;

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE = `http://127.0.0.1:${PORT}`;
const kp = nacl.sign.keyPair();
const WALLET = bs58.encode(kp.publicKey);

let web;
before(async () => {
  web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});
after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});

describe('/api/hub/wallet-login: anonymous connect works out of the box', () => {
  test('an unknown wallet connects and gets a session', async () => {
    const chRes = await fetch(`${BASE}/api/hub/wallet-login/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET }),
    });
    const ch = await chRes.json();
    assert.ok(ch?.message, 'challenge should be issued');

    const signature = JSON.stringify(
      Array.from(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)),
    );
    const res = await fetch(`${BASE}/api/hub/wallet-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET, signature, message: ch.message }),
    });
    const body = await res.json().catch(() => ({}));

    assert.notEqual(body.error, 'login_required',
      'with no configuration the gate must not refuse — the sign-in it points at is not reachable yet');
    assert.equal(res.status, 200);
    assert.ok(body.session, 'anonymous play is the documented default in web.js');
  });
});
