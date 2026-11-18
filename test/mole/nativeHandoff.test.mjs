// Covers src/mole/nativeHandoff.js — the mobile wrapper's session hand-off.
// The properties asserted here are the security ones: that the deep-link id
// alone is worthless without the claim secret, that a hand-off is single-use,
// that a deposit can't be displaced, and that a dead session never comes back
// out. See docs/mobile-beta.md for the flow these enforce.
//
// src/mole/storage.js reads DATA_DIR from src/mole/config.js's zod-validated
// getConfig(), which expects a populated process.env — normally guaranteed by
// src/index.js's `import 'dotenv/config'`. This file never goes through
// index.js, so it loads .env the same way the other tests in this directory do.
import 'dotenv/config';

// Two isolations, both applied BEFORE anything under test is imported (static
// imports hoist, so these statements run after dotenv but before the dynamic
// imports below):
//
// 1. This repository's .env points MONGO_ENABLED/MONGO_URI at a real, live
//    MongoDB Atlas cluster and storage.js syncs every managed write there.
// 2. DATA_DIR is the real ./data at the repo root. Rather than the
//    backup/restore dance the older tests here use, this file redirects
//    DATA_DIR at a throwaway directory outright — nothing it writes can reach
//    real sessions.json or native_handoffs.json even if it crashes midway.
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winlew-handoff-test-'));
process.env.DATA_DIR = TMP_DATA_DIR;

const { startNativeHandoff, depositNativeHandoff, claimNativeHandoff, HANDOFF_TTL_SEC } =
  await import('../../src/mole/nativeHandoff.js');
const { createSession, revokeSession } = await import('../../src/mole/sessions.js');
const { readJson, writeJson } = await import('../../src/mole/storage.js');

after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const freshSecret = () => crypto.randomBytes(32).toString('hex');

/** Starts a hand-off the way the wrapper does, returning both halves. */
function startPair() {
  const claimSecret = freshSecret();
  const started = startNativeHandoff({ claimHash: sha256Hex(claimSecret) });
  return { claimSecret, ...started };
}

describe('startNativeHandoff', () => {
  test('rejects anything that is not a SHA-256 hex digest', () => {
    assert.throws(() => startNativeHandoff({ claimHash: 'nope' }), /invalid_claim_hash/);
    assert.throws(() => startNativeHandoff({}), /invalid_claim_hash/);
    assert.throws(() => startNativeHandoff({ claimHash: 'ab'.repeat(10) }), /invalid_claim_hash/);
    assert.throws(() => startNativeHandoff({ claimHash: 'z'.repeat(64) }), /invalid_claim_hash/);
  });

  test('issues an unguessable id with the documented TTL', () => {
    const { handoffId, ttlSec, expiresAt } = startPair();
    assert.equal(typeof handoffId, 'string');
    assert.ok(handoffId.length >= 20, `id too short to be unguessable: ${handoffId.length}`);
    assert.equal(ttlSec, HANDOFF_TTL_SEC);
    assert.equal(ttlSec, 900, 'a real first-time wallet round trip does not fit in five minutes');
    assert.ok(expiresAt > Math.floor(Date.now() / 1000));
  });

  test('two hand-offs never collide', () => {
    assert.notEqual(startPair().handoffId, startPair().handoffId);
  });
});

describe('the full round trip', () => {
  test('claim before deposit reports pending rather than failing', () => {
    const { handoffId, claimSecret } = startPair();
    const early = claimNativeHandoff({ handoffId, claimSecret });
    assert.equal(early.ok, true);
    assert.equal(early.pending, true);
    assert.equal(early.session, undefined);
  });

  test('deposit then claim returns the session exactly once', () => {
    const { handoffId, claimSecret } = startPair();
    const session = createSession('user-happy', 600);
    const wallet = 'So11111111111111111111111111111111111111112';

    depositNativeHandoff({ handoffId, session, wallet });
    const claimed = claimNativeHandoff({ handoffId, claimSecret });

    assert.equal(claimed.pending, false);
    assert.equal(claimed.session, session);
    assert.equal(claimed.wallet, wallet);

    // Single-use: the record is gone, so a replay of the same deep link is inert.
    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret }), /handoff_not_found/);
  });
});

describe('the claim secret is what actually gates the exchange', () => {
  // This is the property that makes it safe to send the hand-off id over a
  // custom-scheme deep link any app on the device can intercept.
  test('holding the id without the secret is worthless', () => {
    const { handoffId, claimSecret } = startPair();
    depositNativeHandoff({ handoffId, session: createSession('user-guard', 600) });

    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret: 'x'.repeat(64) }), /claim_secret_mismatch/);
    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret: '' }), /invalid_handoff_claim/);
    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret: sha256Hex('guess') }), /claim_secret_mismatch/);

    // A failed guess must not lock the legitimate holder out.
    assert.ok(claimNativeHandoff({ handoffId, claimSecret }).session);
  });

  test('sustained guessing burns the record instead of leaving it open', () => {
    const { handoffId, claimSecret } = startPair();
    depositNativeHandoff({ handoffId, session: createSession('user-burn', 600) });

    for (let i = 0; i < 4; i += 1) {
      assert.throws(() => claimNativeHandoff({ handoffId, claimSecret: 'y'.repeat(64) }), /claim_secret_mismatch/);
    }
    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret: 'y'.repeat(64) }), /claim_secret_mismatch/);
    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret }), /handoff_not_found/);
  });
});

describe('deposit rules', () => {
  test('only a real session can be deposited', () => {
    const { handoffId } = startPair();
    assert.throws(() => depositNativeHandoff({ handoffId, session: 'not-a-real-session' }), /session_invalid/);
    assert.throws(() => depositNativeHandoff({ handoffId, session: '' }), /invalid_handoff_deposit/);
  });

  test('an unknown hand-off id cannot be deposited into', () => {
    assert.throws(
      () => depositNativeHandoff({ handoffId: 'no-such-handoff', session: createSession('u', 600) }),
      /handoff_not_found/,
    );
  });

  test('a second deposit cannot displace the first', () => {
    const { handoffId, claimSecret } = startPair();
    const first = createSession('user-first', 600);
    depositNativeHandoff({ handoffId, session: first });

    assert.throws(
      () => depositNativeHandoff({ handoffId, session: createSession('user-second', 600) }),
      /handoff_already_deposited/,
    );
    assert.equal(claimNativeHandoff({ handoffId, claimSecret }).session, first);
  });

  test('the wallet hint is bounded and never required', () => {
    const { handoffId, claimSecret } = startPair();
    depositNativeHandoff({ handoffId, session: createSession('user-hint', 600), wallet: 'W'.repeat(500) });
    assert.equal(claimNativeHandoff({ handoffId, claimSecret }).wallet.length, 64);
  });
});

describe('a hand-off never outlives what it points at', () => {
  test('a session revoked between deposit and claim is not handed back', () => {
    const { handoffId, claimSecret } = startPair();
    const session = createSession('user-revoked', 600);
    depositNativeHandoff({ handoffId, session });
    revokeSession(session);
    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret }), /session_invalid/);
  });

  test('an expired hand-off is swept even with the right secret', () => {
    const { handoffId, claimSecret } = startPair();
    depositNativeHandoff({ handoffId, session: createSession('user-expiry', 600) });

    const d = readJson('native_handoffs.json', {});
    d[handoffId].expires_at = Math.floor(Date.now() / 1000) - 1;
    writeJson('native_handoffs.json', d);

    assert.throws(() => claimNativeHandoff({ handoffId, claimSecret }), /handoff_not_found/);
  });

  test('the claim secret is not recoverable from the stored record', () => {
    const { handoffId, claimSecret } = startPair();
    const stored = JSON.stringify(readJson('native_handoffs.json', {})[handoffId]);
    assert.ok(!stored.includes(claimSecret), 'the raw claim secret must never be persisted');
    assert.ok(stored.includes(sha256Hex(claimSecret)), 'only its digest should be');
  });
});
