// USER > ACCOUNT(S) > WALLET — the layer that says two logins are one person.
//
// The bugs this pins are the two that were reported from the live site:
//
//   * "ALREADY LINKED" — syncing X to the Discord account was refused because
//     the X login already rooted an account of its own, with no way forward.
//   * two claims inside one 24h cooldown — one wallet on the Discord account,
//     one on the X account, and neither check could see the other.
//
// Both come from the same mistake: treating the ACCOUNT as the person. These
// tests are about the person.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-accounts-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import 'dotenv/config';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveAccountId, listAccountIdsForUser, linkAccounts, unlinkAccount,
  preferredCanonical, accountRank, listMerges,
} = await import('../../src/mole/userAccounts.js');
const { mergeLinkedWalletRecords } = await import('../../src/mole/walletLink.js');
const { refreshManagedFile } = await import('../../src/mole/storage.js');

const MERGE_FILE = path.join(scratchDataDir, 'account_merges.json');

// account_merges.json is a MANAGED file, so reads come from an in-process
// cache — writing the file alone would not be seen. refreshManagedFile() is the
// supported way to make the process re-read it, and it is also how a running
// deployment picks up a merge performed by the CLI in another process.
async function setMerges(map) {
  fs.writeFileSync(MERGE_FILE, JSON.stringify(map));
  await refreshManagedFile('account_merges.json');
}

const resetMerges = () => setMerges({});

const DISCORD = '248525967377694720';
const X_ACCOUNT = 'x:9f2c8a1b';
const WALLET_ACCOUNT = 'wallet:1a4b7c9d';

describe('userAccounts: which account survives', () => {
  beforeEach(resetMerges);

  test('a Discord snowflake outranks an X account, which outranks a wallet', () => {
    assert.ok(accountRank(DISCORD) > accountRank(X_ACCOUNT));
    assert.ok(accountRank(X_ACCOUNT) > accountRank(WALLET_ACCOUNT));
    assert.equal(preferredCanonical(WALLET_ACCOUNT, DISCORD), DISCORD);
    assert.equal(preferredCanonical(DISCORD, X_ACCOUNT), DISCORD);
  });

  test('a tie keeps the account the caller was already working with', () => {
    assert.equal(preferredCanonical('x:aaa', 'x:bbb'), 'x:aaa');
  });

  test('merging is idempotent — a repeated OAuth callback is not an error', () => {
    const first = linkAccounts(WALLET_ACCOUNT, DISCORD);
    assert.deepEqual(
      { userId: first.userId, absorbed: first.absorbed, changed: first.changed },
      { userId: DISCORD, absorbed: WALLET_ACCOUNT, changed: true },
    );
    const second = linkAccounts(WALLET_ACCOUNT, DISCORD);
    assert.equal(second.changed, false);
    assert.equal(second.userId, DISCORD);
  });
});

describe('userAccounts: resolving', () => {
  beforeEach(resetMerges);

  test('an unmerged account resolves to itself, so every caller can wrap its lookups', () => {
    assert.equal(resolveAccountId(DISCORD), DISCORD);
    assert.deepEqual(listAccountIdsForUser(DISCORD), [DISCORD]);
  });

  test('a chain of merges resolves to the end', () => {
    linkAccounts(WALLET_ACCOUNT, X_ACCOUNT);   // wallet -> x
    linkAccounts(X_ACCOUNT, DISCORD);          // x      -> discord
    assert.equal(resolveAccountId(WALLET_ACCOUNT), DISCORD);
    assert.equal(resolveAccountId(X_ACCOUNT), DISCORD);
    assert.deepEqual(listAccountIdsForUser(WALLET_ACCOUNT).sort(), [DISCORD, WALLET_ACCOUNT, X_ACCOUNT].sort());
  });

  test('a corrupted store that points in a circle answers stably instead of hanging', async () => {
    // Only reachable by hand-editing or a half-written file. The requirement is
    // that a payout run gets AN answer, the same one every time — an answer
    // that flip-flops would move somebody's payouts between two reads.
    await setMerges({ 'x:aaa': 'wallet:bbb', 'wallet:bbb': 'x:aaa' });
    const first = resolveAccountId('x:aaa');
    assert.equal(first, resolveAccountId('x:aaa'));
    assert.equal(first, resolveAccountId('wallet:bbb'));
    assert.ok(['x:aaa', 'wallet:bbb'].includes(first));
  });

  test('unmerge puts the account back on its own', () => {
    linkAccounts(WALLET_ACCOUNT, DISCORD);
    assert.equal(unlinkAccount(WALLET_ACCOUNT), true);
    assert.equal(resolveAccountId(WALLET_ACCOUNT), WALLET_ACCOUNT);
    assert.deepEqual(listMerges(), {});
  });
});

describe('walletLink: folding two wallet records into one user', () => {
  const now = Math.floor(Date.now() / 1000);
  const live = (address, at) => ({
    verified_wallets: { [address]: { verified_at: at, expires_at: at + 86400, source: 'mole-verification' } },
    wallets: { verified: { address, linked_at: at }, payout: { address, linked_at: at } },
    wallet_history: [address],
    verified_at: at,
    verification_expires_at: at + 86400,
    wallet: address,
  });

  test('every verified wallet from both sides survives', () => {
    const merged = mergeLinkedWalletRecords(live('AAA', now - 100), live('BBB', now));
    assert.deepEqual(Object.keys(merged.verified_wallets).sort(), ['AAA', 'BBB']);
    assert.deepEqual(merged.wallet_history.sort(), ['AAA', 'BBB']);
  });

  test('exactly one payout address comes out, and it is a wallet that is still verified', () => {
    const merged = mergeLinkedWalletRecords(live('AAA', now - 100), live('BBB', now));
    assert.equal(merged.wallets.payout.address, 'AAA');
    assert.ok(merged.verified_wallets[merged.wallets.payout.address]);
  });

  test("a lapsed nomination falls through to the other side's valid one", () => {
    const stale = { ...live('AAA', now), wallets: { payout: { address: 'GONE', linked_at: now } } };
    const merged = mergeLinkedWalletRecords(stale, live('BBB', now));
    assert.equal(merged.wallets.payout.address, 'BBB');
  });

  test('a nomination nobody can verify any more is dropped, not guessed', () => {
    // Neither side nominates an address that is still verified. Keeping one
    // would pay an address whose proof expired; dropping it lets
    // getPayoutWallet() fall back to the most recently verified wallet, which
    // is the documented default.
    const stale = (address) => ({
      verified_wallets: {},
      wallets: { payout: { address, linked_at: now } },
      wallet_history: [address],
    });
    const merged = mergeLinkedWalletRecords(stale('GONE'), stale('ALSO-GONE'));
    assert.equal(merged.wallets.payout, undefined);
  });

  test('when both sides know an address, the longer-lived verification wins', () => {
    const older = live('AAA', now - 5000);
    const newer = live('AAA', now);
    const merged = mergeLinkedWalletRecords(older, newer);
    assert.equal(merged.verified_wallets.AAA.expires_at, now + 86400);
  });

  test('merging with nothing is a no-op in both directions', () => {
    const record = live('AAA', now);
    assert.equal(mergeLinkedWalletRecords(record, null).wallet, 'AAA');
    assert.equal(mergeLinkedWalletRecords(null, record).wallet, 'AAA');
  });
});
