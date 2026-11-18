// Merging two accounts into one user — the whole move, against the real stores.
//
// The scenario is the one the owner reported, in order:
//
//   1. They sign in with Discord and verify wallet A.
//   2. Another day they sign in with X — a different account — and verify B.
//   3. Both wallets claim inside one 24h cooldown, because nothing could see
//      that the two accounts were one person.
//   4. They try to sync X onto the Discord account: "ALREADY LINKED".
//
// After the merge, step 4 is what FIXES step 3: one user, both wallets, one
// payout address, one claim slot.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-merge-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import 'dotenv/config';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const { mergeAccounts } = await import('../../src/mole/accountMerge.js');
const { resolveAccountId, listAccountIdsForUser } = await import('../../src/mole/userAccounts.js');
const {
  getLinkedWalletRecord, listVerifiedWallets, getPayoutWallet, listLinkedProfiles,
  findLinkedProfileByWallet,
} = await import('../../src/mole/walletLink.js');
const { syncIdentity, listSyncedIdentities, canBePaid, IDENTITY_PROVIDERS } =
  await import('../../src/mole/syncedIdentities.js');
const { writeJson } = await import('../../src/mole/storage.js');

// Ids chosen so neither exists in any real store — profilePrefs reads from the
// repo's own src/data, which this test must never write into.
const DISCORD_ACCOUNT = '900000000000000001';
const X_ACCOUNT = 'x:merge-test-abc';
const WALLET_A = 'AaaaWalletOnTheDiscordAccount';
const WALLET_B = 'BbbbWalletOnTheXAccount';

const now = Math.floor(Date.now() / 1000);
const CYCLE = 91 * 24 * 60 * 60;

function recordFor(address, verifiedAt) {
  return {
    wallet: address,
    input: address,
    linked_at: verifiedAt,
    verified_at: verifiedAt,
    verification_expires_at: verifiedAt + CYCLE,
    last_verified_wallet: address,
    wallets: {
      verified: { address, input: address, linked_at: verifiedAt, source: 'mole-verification' },
      payout: { address, input: address, linked_at: verifiedAt, source: 'verified-default' },
      faucet: { address, input: address, linked_at: verifiedAt, source: 'verified-default' },
    },
    verified_wallets: {
      [address]: { verified_at: verifiedAt, expires_at: verifiedAt + CYCLE, source: 'mole-verification' },
    },
    wallet_history: [address],
  };
}

before(() => {
  writeJson('linked_wallets.json', {
    [DISCORD_ACCOUNT]: recordFor(WALLET_A, now - 1000),
    [X_ACCOUNT]: recordFor(WALLET_B, now),
  });
  writeJson('account_merges.json', {});
  syncIdentity({ accountId: X_ACCOUNT, provider: IDENTITY_PROVIDERS.X, providerUserId: 'merge-test-x-id' });
});

describe('before the merge: two accounts, two claim slots', () => {
  test('each account sees only its own wallet — this is the double-claim hole', () => {
    assert.deepEqual(listVerifiedWallets(getLinkedWalletRecord(DISCORD_ACCOUNT)).map((w) => w.wallet), [WALLET_A]);
    assert.deepEqual(listVerifiedWallets(getLinkedWalletRecord(X_ACCOUNT)).map((w) => w.wallet), [WALLET_B]);
  });
});

describe('after the merge: one user', () => {
  before(() => {
    const result = mergeAccounts({ a: X_ACCOUNT, b: DISCORD_ACCOUNT, reason: 'test' });
    assert.equal(result.changed, true);
    // The Discord snowflake survives: every store already keyed by a snowflake
    // keeps resolving without a rewrite.
    assert.equal(result.userId, DISCORD_ACCOUNT);
    assert.equal(result.absorbed, X_ACCOUNT);
  });

  test('both account ids resolve to the one user', () => {
    assert.equal(resolveAccountId(X_ACCOUNT), DISCORD_ACCOUNT);
    assert.deepEqual(listAccountIdsForUser(X_ACCOUNT).sort(), [DISCORD_ACCOUNT, X_ACCOUNT].sort());
  });

  test('BOTH wallets are on the user, whichever door you ask through', () => {
    for (const door of [DISCORD_ACCOUNT, X_ACCOUNT]) {
      const wallets = listVerifiedWallets(getLinkedWalletRecord(door)).map((w) => w.wallet).sort();
      assert.deepEqual(wallets, [WALLET_A, WALLET_B].sort(), `via ${door}`);
    }
  });

  test('exactly one of them gets paid', () => {
    const payout = getPayoutWallet(getLinkedWalletRecord(DISCORD_ACCOUNT));
    assert.ok([WALLET_A, WALLET_B].includes(payout));
    assert.equal(payout, getPayoutWallet(getLinkedWalletRecord(X_ACCOUNT)));
  });

  test('a wallet from either half resolves to the same person', () => {
    // This is the lookup the faucet uses to find "whose claim is this", and it
    // is why the second wallet can no longer claim on its own.
    assert.equal(findLinkedProfileByWallet(WALLET_A).discordUserId, DISCORD_ACCOUNT);
    assert.equal(findLinkedProfileByWallet(WALLET_B).discordUserId, DISCORD_ACCOUNT);
  });

  test('the X identity followed the person, so payouts stay unlocked', () => {
    assert.ok(canBePaid(DISCORD_ACCOUNT));
    assert.deepEqual(listSyncedIdentities(DISCORD_ACCOUNT).map((i) => i.provider), ['x']);
  });

  test('one row per person in the list HODL pays from', () => {
    // Two rows here would be two payouts to one person — the same bug wearing
    // a different hat.
    const rows = listLinkedProfiles().filter((row) => [DISCORD_ACCOUNT, X_ACCOUNT].includes(row.discordUserId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].discordUserId, DISCORD_ACCOUNT);
  });

  test('merging again changes nothing', () => {
    const again = mergeAccounts({ a: DISCORD_ACCOUNT, b: X_ACCOUNT, reason: 'test-repeat' });
    assert.equal(again.changed, false);
    assert.equal(again.userId, DISCORD_ACCOUNT);
  });
});
