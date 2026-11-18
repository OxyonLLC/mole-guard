// The boot mirror must never erase a linkage it did not write.
//
// syncAllLinkedWalletMirrors() runs on every winlew-mole start (src/index.js)
// and rebuilt src/faucet/wallet_links.json from the mole store alone, writing
// the result over the file wholesale. But that file has a SECOND writer: the
// faucet bot's !register (src/faucet/bot.js setLinkedWallet), which writes the
// faucet's own store and never mole_linked_wallets.
//
// So anyone whose only linkage came from !register was in the file, absent from
// the rebuild, and erased on every restart — after which the faucet told them,
// accurately as far as it could see, that they had never registered.
//
// TESTED THROUGH THE PURE FUNCTION, DELIBERATELY. The mirror paths are fixed to
// the repo root (walletLink.js:23-25) and cannot be redirected by env, so a
// test that called syncAllLinkedWalletMirrors() would write real, gitignored,
// runtime linkage data — and `node --test` runs files concurrently, so an
// interrupted run could leave live data truncated. The merge rule is the part
// worth pinning; the file write is not.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergeFaucetLinks } from '../../src/mole/walletLink.js';

const registerOnly = {
  '999888777666555444': {
    input: 'faucetonly.sol',
    address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
    updatedAt: '2026-08-01T00:00:00.000Z',
    source: 'register',
  },
};

describe('mergeFaucetLinks', () => {
  test('a !register-only linkage survives a boot rebuild', () => {
    // The whole bug: this key is absent from the mole store, so the old
    // rebuild dropped it every single restart.
    const merged = mergeFaucetLinks(registerOnly, {});
    assert.ok(merged['999888777666555444'], 'a !register linkage was erased');
    assert.equal(merged['999888777666555444'].address, '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9');
  });

  test('the mole store wins where both know a user', () => {
    // Mole's record is signature-backed; the faucet's is a typed address.
    const merged = mergeFaucetLinks(
      { '123': { address: 'OLD', source: 'register' } },
      { '123': { address: 'NEW', source: 'verified-default' } },
    );
    assert.equal(merged['123'].address, 'NEW');
  });

  test('account-keyed entries are preserved alongside snowflakes', () => {
    // Live data already contains wallet:<hash> keys — see
    // test/mole/accountDiscordResolution.test.mjs for why.
    const merged = mergeFaucetLinks(
      { 'wallet:94943b30aef10c3ee81387feceda439e': { address: 'ACCOUNT' } },
      { '123456789012345678': { address: 'SNOWFLAKE' } },
    );
    assert.equal(merged['wallet:94943b30aef10c3ee81387feceda439e'].address, 'ACCOUNT');
    assert.equal(merged['123456789012345678'].address, 'SNOWFLAKE');
  });

  test('a corrupt or missing existing file degrades to the rebuild, never throws', () => {
    // The merge reads a file another process writes. If that read could take
    // the boot down, this fix would have traded data loss for an outage.
    for (const junk of [null, undefined, 'not an object', 42, ['an', 'array']]) {
      assert.doesNotThrow(() => mergeFaucetLinks(junk, { '123': { address: 'X' } }));
      assert.equal(mergeFaucetLinks(junk, { '123': { address: 'X' } })['123'].address, 'X');
    }
  });

  test('syncAllLinkedWalletMirrors actually routes through the merge', async () => {
    // Pinning the wiring, since the pure function above is only as useful as
    // its one caller. A future edit that inlines a plain overwrite here brings
    // the data loss straight back.
    const src = await fs.promises.readFile(path.resolve('src/mole/walletLink.js'), 'utf8');
    const fnBody = src.slice(src.indexOf('export function syncAllLinkedWalletMirrors'));
    assert.ok(fnBody.includes('mergeFaucetLinks('), 'the boot mirror no longer merges');
  });
});
