// Regression test for a cross-process staleness bug shipped on 2026-08-02.
//
// Managed files (src/mole/storage.js) are cached in-process at boot and only
// updated by writes made in that same process. That is fine while a file has
// one writer. It breaks the moment one service must SEE what another wrote:
// linked_wallets.json is written by the Mole Guard process on `/mole link`, and
// read by the FAUCET process for its verification gate. A user verified
// successfully, the record landed in Mongo correctly, and the faucet kept
// refusing them — because the faucet was serving the snapshot it loaded when it
// started.
//
// refreshManagedFile() is the explicit re-read that fixes it. These tests
// reproduce the staleness first, so the assertion that the fix works is
// actually meaningful.
import 'dotenv/config';

// Force the local-file path (no Mongo): this repo's .env points at a live
// Atlas cluster, and the local branch is the one that can be tested
// hermetically. Both branches replace the cache the same way.
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winlew-managed-'));
process.env.DATA_DIR = TMP_DATA_DIR;

const FILE = 'linked_wallets.json';
const STORE = path.join(TMP_DATA_DIR, FILE);

const { readJson, refreshManagedFile } = await import('../../src/mole/storage.js');

/** Writes the file the way a *different* process would: straight to disk, with
 *  no involvement from this process's cache. */
function writeFromAnotherProcess(payload) {
  fs.writeFileSync(STORE, JSON.stringify(payload, null, 2));
}

before(() => {
  writeFromAnotherProcess({ 'user-1': { wallet: 'WalletA', verified_at: 0 } });
});

after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

describe('managed-file caching', () => {
  test('the first read populates the cache from disk', () => {
    const first = readJson(FILE, {});
    assert.equal(first['user-1'].wallet, 'WalletA');
  });

  test('a write by another process is INVISIBLE to a cached reader', () => {
    // This is the bug, asserted rather than described. If this ever starts
    // failing because reads became fresh by default, the refresh below is
    // redundant and this file should be revisited — not deleted quietly.
    writeFromAnotherProcess({ 'user-1': { wallet: 'WalletA', verified_at: 1785659870 } });
    assert.equal(readJson(FILE, {})['user-1'].verified_at, 0,
      'a cached reader still serves its boot-time snapshot');
  });

  test('refreshManagedFile picks the other process’s write up', () => {
    assert.equal(readJson(FILE, {})['user-1'].verified_at, 0, 'still stale going in');
    return refreshManagedFile(FILE).then((ok) => {
      assert.equal(ok, true);
      assert.equal(readJson(FILE, {})['user-1'].verified_at, 1785659870,
        'the freshly written value is now visible');
    });
  });

  test('later writes by the other process go stale again until refreshed', () => {
    // The fix is an explicit re-read, not a subscription — callers must ask.
    writeFromAnotherProcess({ 'user-1': { wallet: 'WalletB', verified_at: 999 } });
    assert.equal(readJson(FILE, {})['user-1'].wallet, 'WalletA');
    return refreshManagedFile(FILE).then(() => {
      assert.equal(readJson(FILE, {})['user-1'].wallet, 'WalletB');
    });
  });

  test('an unmanaged file name is a no-op rather than an error', async () => {
    assert.equal(await refreshManagedFile('not_a_managed_file.json'), false);
  });
});
