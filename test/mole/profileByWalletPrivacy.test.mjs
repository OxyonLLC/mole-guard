// /api/profile/by-wallet — ownership contract.
//
// Regression test for an IDOR found during the /profile/ folder audit
// (2026-08-05). The route used to return the FULL private dashboard payload to
// anyone who supplied a wallet address, with no session check at all.
//
// That mattered because wallet addresses are public by design on this site —
// they appear on /leaderboards/, the /contribute/ board, /burn/ and Solscan. So
// anyone could enumerate them and read each owner's Discord username and
// globalName, every linked wallet, live balance, faucet cooldown timing,
// governance participation and reward history. Confirmed against the live API
// at the time: 42,718 bytes with knownWallets populated and the
// faucet.cooldownReady / nextClaimAt fields that buildPublicProfilePayload
// exists specifically to strip.
//
// Supplying a wallet address is not evidence of controlling it, so the full
// payload is now released only when a valid session proves the caller owns that
// wallet. Everything else gets the same reduced payload /api/profile/public
// returns.
//
// Starts the REAL server against an isolated scratch DATA_DIR with Mongo
// disabled, matching governanceLeaderboardPrivacy.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-bywallet-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8801;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeJson } from '../../src/mole/storage.js';

const BASE = `http://127.0.0.1:${PORT}`;
const VICTIM_WALLET = 'TestVictimWallet1111111111111111111111111111';
const OTHER_WALLET = 'TestOtherWallet22222222222222222222222222222';

// Written through storage.js's writeJson so its in-memory managed-JSON cache —
// which the route reads from — is updated too; a raw fs write would be ignored
// by an already-warm cache.
function seedLinkedWallet() {
  writeJson('linked_wallets.json', {
    victim_discord_id: {
      wallet: VICTIM_WALLET,
      last_verified_wallet: VICTIM_WALLET,
      wallets: {
        verified: { address: VICTIM_WALLET },
        faucet: { address: OTHER_WALLET },
      },
      verified_at: '2026-07-01T00:00:00Z',
    },
  });
}

async function byWallet(query = '') {
  const res = await fetch(`${BASE}/api/profile/by-wallet?wallet=${encodeURIComponent(VICTIM_WALLET)}&app=mole${query}`);
  const json = await res.json().catch(() => ({}));
  return { res, json, raw: JSON.stringify(json) };
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
  // startWeb()'s listening server keeps the event loop alive and exposes no
  // handle to close — same forced exit the other route tests use, or the
  // full-suite runner hangs here.
  setImmediate(() => process.exit(0));
});

describe('/api/profile/by-wallet: a wallet address alone never unlocks the private payload', () => {
  test('with NO session, the response is the reduced public payload', async () => {
    const { res, json } = await byWallet();
    assert.equal(res.status, 200, 'a known wallet should still resolve, just not privately');
    assert.equal(json.publicView, true, 'response must be flagged as the public view');
  });

  test('with no session it carries none of the owner-only fields', async () => {
    const { json, raw } = await byWallet();

    assert.deepEqual(
      json.wallets?.knownWallets ?? [],
      [],
      'knownWallets must be emptied — it exposes every other wallet the person has linked',
    );

    const faucet = json.faucet || {};
    for (const ownerOnly of ['cooldownReady', 'nextClaimAt']) {
      assert.ok(
        !(ownerOnly in faucet),
        `faucet.${ownerOnly} is owner-only and must not appear without a session`,
      );
    }

    // The second linked wallet must not leak anywhere in the payload, in any
    // field — this is the check that catches a future field being added to the
    // public payload without thinking about it.
    assert.ok(
      !raw.includes(OTHER_WALLET),
      'a wallet the caller did not ask about must never appear in an unauthenticated response',
    );
  });

  test('an invalid or expired session does not unlock it either', async () => {
    const { json } = await byWallet('&session=not-a-real-session-token');
    assert.equal(json.publicView, true, 'an unrecognised session must be treated as no session');
    assert.deepEqual(json.wallets?.knownWallets ?? [], []);
  });

  test('an unknown wallet still 404s rather than confirming anything', async () => {
    const res = await fetch(`${BASE}/api/profile/by-wallet?wallet=NoSuchWalletAtAll&app=mole`);
    assert.equal(res.status, 404);
  });
});
