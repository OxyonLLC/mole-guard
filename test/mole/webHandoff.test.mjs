// Covers src/mole/webHandoff.js — the desktop-to-phone hand-off for /verify/.
//
// The property that matters most is the one the old design got wrong: the LINK
// MUST BE INERT ON ITS OWN. The previous hand-off link was
// /verify/?session=<live token>, and the page's "Phantom handoff" / "Solflare
// handoff" buttons wrapped it into an HTTPS request to phantom.app and
// solflare.com — putting a live session token into a third party's access
// logs. Several tests here exist purely to prove the replacement cannot leak
// the same way: the id never redeems anything by itself, and no session token
// is ever stored in or recoverable from the hand-off record.
//
// Same isolation as test/mole/nativeHandoff.test.mjs, and for the same
// reasons: this repository's .env points at a live Mongo cluster and a real
// DATA_DIR, so both are redirected BEFORE the module under test is imported.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winlew-webhandoff-test-'));
process.env.DATA_DIR = TMP_DATA_DIR;

const {
  startWebHandoff,
  claimWebHandoff,
  peekWebHandoff,
  normalizePairingCode,
  HANDOFF_MODES,
  WEB_HANDOFF_TTL_SEC,
  WEB_HANDOFF_DIRECT_TTL_SEC,
  HANDOFF_SESSION_MAX_TTL_SEC,
  __testing,
} = await import('../../src/mole/webHandoff.js');
const { createSession, getSession, revokeSession } = await import('../../src/mole/sessions.js');
const { readJson, writeJson } = await import('../../src/mole/storage.js');

after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

const DISCORD_ID = '1220049423548026952';

/** A live desktop session, as /mole link would have produced. */
function desktopSession(ttlSec = 3600) {
  return createSession(DISCORD_ID, ttlSec);
}

function records() {
  return readJson(__testing.HANDOFF_FILE, {});
}

describe('webHandoff: starting a hand-off', () => {
  test('requires a live session', () => {
    assert.throws(() => startWebHandoff({}), /session_required/);
    assert.throws(() => startWebHandoff({ session: '' }), /session_required/);
    assert.throws(() => startWebHandoff({ session: 'not-a-real-token' }), /session_invalid/);
  });

  test('a revoked session cannot mint a hand-off', () => {
    const session = desktopSession();
    revokeSession(session);
    assert.throws(() => startWebHandoff({ session }), /session_invalid/);
  });

  test('returns an id and a six-digit code, and stores only the hash', () => {
    const { handoffId, pairingCode, ttlSec } = startWebHandoff({ session: desktopSession() });
    assert.match(handoffId, /^[A-Za-z0-9_-]{32}$/);
    assert.match(pairingCode, /^\d{6}$/);
    assert.equal(ttlSec, WEB_HANDOFF_TTL_SEC);

    const rec = records()[handoffId];
    assert.equal(rec.code_hash, __testing.sha256Hex(pairingCode));
    // The clear code must not survive anywhere in the record.
    assert.equal(JSON.stringify(rec).includes(pairingCode), false);
  });

  test('the stored record contains no session token at all', () => {
    // The whole point of minting a fresh session at claim time: even a full
    // read of this store yields nothing that can be replayed as a session.
    const session = desktopSession();
    const { handoffId } = startWebHandoff({ session });
    const rec = records()[handoffId];
    assert.equal(JSON.stringify(rec).includes(session), false);
    assert.equal('session' in rec, false);
    assert.equal(rec.discord_user_id, DISCORD_ID);
  });
});

describe('webHandoff: claiming', () => {
  test('the id alone is worthless — this is the leak the design exists to stop', () => {
    // If this ever passes with a wrong/absent code, the "Phantom handoff"
    // button is back to handing a working credential to a third party.
    const { handoffId } = startWebHandoff({ session: desktopSession() });
    assert.throws(() => claimWebHandoff({ handoffId }), /pairing_code_required/);
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode: '' }), /pairing_code_required/);
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode: '000000' }), /pairing_code_mismatch|handoff_not_found/);
  });

  test('the right code returns a working session for the same Discord user', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const out = claimWebHandoff({ handoffId, pairingCode });
    assert.equal(out.ok, true);
    const rec = getSession(out.session);
    assert.ok(rec, 'claimed session should be live');
    assert.equal(rec.discordUserId, DISCORD_ID);
  });

  test('the phone gets a DIFFERENT token from the desktop', () => {
    // The desktop's own token must never travel. Revoking the phone must also
    // not kill the desktop.
    const session = desktopSession();
    const { handoffId, pairingCode } = startWebHandoff({ session });
    const { session: phone } = claimWebHandoff({ handoffId, pairingCode });
    assert.notEqual(phone, session);
    revokeSession(phone);
    assert.ok(getSession(session), 'revoking the phone must not revoke the desktop');
  });

  test('single use — a second claim is refused', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    claimWebHandoff({ handoffId, pairingCode });
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode }), /handoff_already_claimed/);
  });

  test('wrong codes burn the record after the attempt cap', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const wrong = pairingCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < __testing.MAX_CLAIM_ATTEMPTS - 1; i++) {
      assert.throws(() => claimWebHandoff({ handoffId, pairingCode: wrong }), /pairing_code_mismatch/);
    }
    // The cap-hitting attempt deletes the record...
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode: wrong }), /pairing_code_mismatch/);
    // ...so even the CORRECT code no longer works.
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode }), /handoff_not_found/);
  });

  test('spaces and dashes in the code are tolerated', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const spaced = `${pairingCode.slice(0, 3)} ${pairingCode.slice(3)}`;
    assert.equal(normalizePairingCode(spaced), pairingCode);
    assert.equal(claimWebHandoff({ handoffId, pairingCode: spaced }).ok, true);
  });

  test('an expired hand-off cannot be claimed', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const d = records();
    d[handoffId].expires_at = Math.floor(Date.now() / 1000) - 1;
    writeJson(__testing.HANDOFF_FILE, d);
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode }), /handoff_not_found/);
  });
});

describe('webHandoff: the granted session cannot outlive its source', () => {
  test('inherits the remaining life of the originating session', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession(120) });
    const { expiresInSec } = claimWebHandoff({ handoffId, pairingCode });
    assert.ok(expiresInSec <= 120, `granted ${expiresInSec}s from a 120s session`);
    assert.ok(expiresInSec > 0);
  });

  test('capped even when the source session is very long-lived', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession(30 * 24 * 3600) });
    const { expiresInSec } = claimWebHandoff({ handoffId, pairingCode });
    assert.equal(expiresInSec, HANDOFF_SESSION_MAX_TTL_SEC);
  });

  test('a source session that dies before the phone arrives grants nothing', () => {
    // Chaining hand-offs must not be a way to renew authority indefinitely.
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const d = records();
    d[handoffId].grant_ttl_sec = 0;
    writeJson(__testing.HANDOFF_FILE, d);
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode }), /handoff_expired/);
  });
});

describe('webHandoff: peek', () => {
  test('reports pending, then claimed', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    assert.equal(peekWebHandoff({ handoffId, pairingCode }).status, 'pending');
    claimWebHandoff({ handoffId, pairingCode });
    const after = peekWebHandoff({ handoffId, pairingCode });
    assert.equal(after.status, 'claimed');
    assert.ok(after.claimedAt > 0);
  });

  test('never returns a session', () => {
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    claimWebHandoff({ handoffId, pairingCode });
    const out = peekWebHandoff({ handoffId, pairingCode });
    assert.equal('session' in out, false);
  });

  test('the id alone cannot probe whether a hand-off exists or was used', () => {
    // Regression guard for a bug in the first draft of this module: peek
    // returned "claimed" before checking the code, so holding the id alone was
    // enough to learn a hand-off had existed and been used.
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const wrong = pairingCode === '000000' ? '111111' : '000000';
    assert.throws(() => peekWebHandoff({ handoffId, pairingCode: wrong }), /pairing_code_mismatch/);
    claimWebHandoff({ handoffId, pairingCode });
    assert.throws(() => peekWebHandoff({ handoffId, pairingCode: wrong }), /pairing_code_mismatch/);
  });

  test('unknown and expired are indistinguishable', () => {
    assert.equal(peekWebHandoff({ handoffId: 'nope', pairingCode: '123456' }).status, 'expired');
  });
});

describe('webHandoff: pairing code quality', () => {
  test('codes are uniformly distributed six-digit strings', () => {
    // crypto.randomInt rather than randomBytes % 1e6, which would bias low
    // values. A chi-square-ish sanity check on the leading digit is enough to
    // catch a rewrite that reintroduces modulo bias.
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 6000; i++) {
      const code = __testing.mintPairingCode();
      assert.match(code, /^\d{6}$/);
      counts[Number(code[0])]++;
    }
    for (const [digit, n] of counts.entries()) {
      assert.ok(n > 400 && n < 800, `leading digit ${digit} appeared ${n} times in 6000 — expected ~600`);
    }
  });

  test('codes differ between hand-offs', () => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) seen.add(startWebHandoff({ session: desktopSession() }).pairingCode);
    assert.ok(seen.size > 30, `only ${seen.size} distinct codes in 40 hand-offs`);
  });
});

describe('webHandoff: DIRECT mode (same-device wallet browser)', () => {
  const direct = (ttl = 3600) =>
    startWebHandoff({ session: desktopSession(ttl), mode: HANDOFF_MODES.DIRECT });

  test('mints no pairing code and stores no hash', () => {
    // Minting a code and then ignoring it on the claim path would be worse than
    // having none: the record would look like it had a second factor.
    const out = direct();
    assert.equal(out.pairingCode, '');
    assert.equal(out.mode, HANDOFF_MODES.DIRECT);
    assert.equal(records()[out.handoffId].code_hash, '');
  });

  test('lives for a fraction of a PAIRED hand-off', () => {
    assert.equal(direct().ttlSec, WEB_HANDOFF_DIRECT_TTL_SEC);
    assert.ok(WEB_HANDOFF_DIRECT_TTL_SEC < WEB_HANDOFF_TTL_SEC);
  });

  test('the id alone claims — this is the accepted, documented weakness', () => {
    const { handoffId } = direct();
    const out = claimWebHandoff({ handoffId });
    assert.equal(out.ok, true);
    assert.ok(getSession(out.session));
  });

  test('…but exactly once, so a leaked id is a race and not a key', () => {
    // The whole security argument for DIRECT rests on this line.
    const { handoffId } = direct();
    claimWebHandoff({ handoffId });
    assert.throws(() => claimWebHandoff({ handoffId }), /handoff_already_claimed/);
  });

  test('an unknown mode is refused rather than silently treated as direct', () => {
    assert.throws(() => startWebHandoff({ session: desktopSession(), mode: 'nope' }), /invalid_handoff_mode/);
    assert.throws(() => startWebHandoff({ session: desktopSession(), mode: '' }), /invalid_handoff_mode/);
  });

  test('peek is refused for direct hand-offs', () => {
    // There is no code to authenticate with, so answering would let anyone
    // holding the id watch it.
    const { handoffId } = direct();
    assert.throws(() => peekWebHandoff({ handoffId, pairingCode: '123456' }), /peek_unsupported/);
  });

  test('still cannot outlive the session it came from', () => {
    const { handoffId } = direct(90);
    const { expiresInSec } = claimWebHandoff({ handoffId });
    assert.ok(expiresInSec <= 90 && expiresInSec > 0);
  });
});

describe('webHandoff: DIRECT must not weaken PAIRED', () => {
  test('a paired hand-off is never claimable without its code', () => {
    // The regression that would quietly undo the desktop fix: if the mode check
    // were inverted or defaulted wrong, every paired link becomes bearer again.
    const { handoffId } = startWebHandoff({ session: desktopSession(), mode: HANDOFF_MODES.PAIRED });
    assert.throws(() => claimWebHandoff({ handoffId }), /pairing_code_required/);
    assert.throws(() => claimWebHandoff({ handoffId, pairingCode: '  ' }), /pairing_code_required/);
  });

  test('a record with no mode field is treated as paired, not direct', () => {
    // Records written before DIRECT existed have no `mode`. The safe reading of
    // a missing field is "requires a code".
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    const d = records();
    delete d[handoffId].mode;
    writeJson(__testing.HANDOFF_FILE, d);
    assert.throws(() => claimWebHandoff({ handoffId }), /pairing_code_required/);
    assert.equal(claimWebHandoff({ handoffId, pairingCode }).ok, true);
  });

  test('a missing code never burns an attempt', () => {
    // wallet-auth.js probes every ?h= it sees without a code. If that counted,
    // five page loads would destroy a hand-off the user was about to complete.
    const { handoffId, pairingCode } = startWebHandoff({ session: desktopSession() });
    for (let i = 0; i < __testing.MAX_CLAIM_ATTEMPTS + 3; i++) {
      assert.throws(() => claimWebHandoff({ handoffId }), /pairing_code_required/);
    }
    assert.equal(records()[handoffId].attempts, 0);
    assert.equal(claimWebHandoff({ handoffId, pairingCode }).ok, true);
  });

  test('an attacker cannot downgrade a paired record by claiming mode', () => {
    // The mode lives in the server-side record, never in the claim request.
    const { handoffId } = startWebHandoff({ session: desktopSession(), mode: HANDOFF_MODES.PAIRED });
    assert.throws(
      () => claimWebHandoff({ handoffId, mode: HANDOFF_MODES.DIRECT }),
      /pairing_code_required/
    );
  });
});

describe('webHandoff: housekeeping', () => {
  test('expired records are swept on the next operation', () => {
    const { handoffId } = startWebHandoff({ session: desktopSession() });
    const d = records();
    d[handoffId].expires_at = Math.floor(Date.now() / 1000) - 1;
    writeJson(__testing.HANDOFF_FILE, d);
    startWebHandoff({ session: desktopSession() });
    assert.equal(handoffId in records(), false, 'expired record should have been swept');
  });
});
