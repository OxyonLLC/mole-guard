// One account per person — /api/hub/wallet-login (2026-08-20).
//
// Signing a message proves control of a wallet, and a wallet costs nothing to
// generate, so a wallet-only sign-in was an identity anyone could mint on
// demand. The 2026-08-16 run minted 19 in forty minutes. This route now refuses
// to create a NEW anonymous identity while still letting a wallet that already
// belongs to a Discord account connect straight through — the mobile app
// depends on that, and making a known member redo OAuth buys nothing.
//
// Starts the REAL server against an isolated scratch DATA_DIR with Mongo
// disabled, matching profileByWalletPrivacy.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-gate-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8815;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);
// EXPLICIT, because the default is now OFF. The gate shipped enabled on
// 2026-08-20 and refused real people all day with no reachable way to comply —
// there is no sign-in control in the site navigation, so the remedy the
// refusal names cannot be found. The rule still works and is still tested; it
// is simply opt-in until the door it points at exists.
process.env.HUB_REQUIRE_LOGIN_BEFORE_CONNECT = 'true';

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { writeJson } from '../../src/mole/storage.js';

const BASE = `http://127.0.0.1:${PORT}`;

/** A real keypair — the route verifies the signature before it ever reaches
 *  the account check, so a fake one would test the wrong refusal. */
function keypair() {
  const kp = nacl.sign.keyPair();
  return { wallet: bs58.encode(kp.publicKey), secret: kp.secretKey };
}

const LINKED = keypair();
const STRANGER = keypair();

function seedLinkedWallet() {
  const nowSec = Math.floor(Date.now() / 1000);
  writeJson('linked_wallets.json', {
    '1220049423548026952': {
      wallet: LINKED.wallet,
      last_verified_wallet: LINKED.wallet,
      wallets: { verified: { address: LINKED.wallet } },
      verified_at: nowSec,
      verification_expires_at: nowSec + 90 * 86400,
    },
  });
}

async function attemptConnect({ wallet, secret }) {
  const chRes = await fetch(`${BASE}/api/hub/wallet-login/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet }),
  });
  const ch = await chRes.json();
  if (!ch?.message) return { status: chRes.status, json: ch, stage: 'challenge' };

  const signature = JSON.stringify(
    Array.from(nacl.sign.detached(new TextEncoder().encode(ch.message), secret)),
  );
  const res = await fetch(`${BASE}/api/hub/wallet-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, signature, message: ch.message }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})), stage: 'login' };
}

let web;

before(async () => {
  seedLinkedWallet();
  web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});

after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});

describe('/api/hub/wallet-login: a wallet with no account behind it must log in first', () => {
  test('an unknown wallet is refused, and told exactly where to go', async () => {
    const { status, json } = await attemptConnect(STRANGER);
    assert.equal(status, 403);
    assert.equal(json.error, 'login_required');
    assert.equal(json.loginUrl, '/linked-role/mole');
    assert.match(json.message, /Discord/i);
    assert.ok(!json.session, 'no session may be issued — that is the whole point');
  });

  test('the refusal does not depend on a bad signature', async () => {
    // Guards against this test passing for the wrong reason: a signature
    // failure returns 400, so a 403 proves the account rule fired.
    const { status } = await attemptConnect(STRANGER);
    assert.notEqual(status, 400);
  });

  test('a wallet already linked to a Discord account still connects', async () => {
    const { status, json } = await attemptConnect(LINKED);
    assert.equal(status, 200, 'the mobile app and every existing member depend on this path');
    assert.ok(json.session, 'a known member gets their session without redoing OAuth');
    assert.equal(json.discordUserId, '1220049423548026952');
  });
});

describe('/api/wallet/payout: choosing which wallet gets paid', () => {
  test('without a session it says nothing at all', async () => {
    const res = await fetch(`${BASE}/api/wallet/payout`);
    assert.equal(res.status, 401, 'the list of a person\'s wallets is not public');
  });

  test('a wallet this account never verified is refused on authority', async () => {
    const { json } = await attemptConnect(LINKED);
    const res = await fetch(`${BASE}/api/wallet/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': json.session },
      body: JSON.stringify({ wallet: STRANGER.wallet }),
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 403, 'otherwise rewards could be pointed at any address');
    assert.equal(body.error, 'wallet_not_verified_for_user');
  });

  test('a verified wallet can be nominated and reads back', async () => {
    const { json } = await attemptConnect(LINKED);
    const post = await fetch(`${BASE}/api/wallet/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': json.session },
      body: JSON.stringify({ wallet: LINKED.wallet }),
    });
    assert.equal(post.status, 200);
    const get = await fetch(`${BASE}/api/wallet/payout`, { headers: { 'x-winlew-session': json.session } });
    const body = await get.json();
    assert.equal(body.payoutWallet, LINKED.wallet);
    assert.ok(body.wallets.some((w) => w.wallet === LINKED.wallet));
  });
});
