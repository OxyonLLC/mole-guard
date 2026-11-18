process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';

// Covers the faucet ban list and the funding-graph walk that makes a ban
// survive a wallet switch (src/faucet/walletBans.js, src/faucet/walletLinkage.js).
//
// Built 2026-08-01 after three claims landed within five minutes and two of
// the wallets proved to be the same hand — the third wallet's first
// transaction was signed and paid for by the second.
//
// No RPC is touched here: the linkage cache is pre-seeded through the same
// store the module reads, so these tests assert the graph logic rather than
// Solana's availability. The "chain unreachable" path is exercised by seeding
// nothing and letting the lookup fail.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';


// The isolated runner points storage.js at a disposable FAUCET_DATA_DIR before
// this module is imported. No production file is read, backed up, or restored.

const { banWallet, unbanWallet, listBans, getBan, isDirectlyBanned, findBannedLink, describeCluster } =
  await import('../../src/faucet/walletBans.js');
const { readLinkageRecord, knownFundedBy } = await import('../../src/faucet/walletLinkage.js');
// Seeding MUST go through this rather than fs.writeFileSync: storage.js
// memoizes each managed file in process, so a direct write to disk is invisible
// to the module and state leaks between tests.
const { writeManagedJson } = await import('../../src/faucet/storage.js');

// Real base58 addresses from the 2026-08-01 incident, so the fixtures are
// valid PublicKeys rather than invented strings.
const RAYAN = 'ES9LAdJHfeDjH6XVbW7TmtCbR8fmcrfBGHjpts6L2PQY';
const PARENT = '755qonxrda2RMGEo1f14U327eq2a7EfsLTpSngwxRntN';
const CHILD = 'Cz8webq82e7BaoAYiEnvyEXSKvRqfvbAb9iDcJGyXmGr';
const GRANDCHILD = '5rwECzbWfAURJGEi328RXvBXZHDXAm1dKwRKpEnWbVHy';
const UNRELATED = 'So11111111111111111111111111111111111111112';

/** Seeds the linkage cache so lookups resolve locally, with no RPC. Marked
 *  `truncated: false` so walletLinkage treats each record as a complete scan
 *  and never reaches for the chain to refresh it. */
function seedLinkage(edges) {
  const wallets = {};
  for (const [wallet, spec] of Object.entries(edges)) {
    const { funders = [], earlyCounterparties = [] } = Array.isArray(spec) ? { funders: spec } : spec;
    wallets[wallet] = {
      // schema 2 = funders means "created the account", separate from early
      // counterparties. A record without it is re-derived, which would send
      // these tests to the RPC.
      schema: 2,
      wallet, funders, earlyCounterparties, scannedSignatures: 10,
      truncated: false, oldestAt: Date.now(), scannedAt: Date.now(), error: null,
    };
  }
  writeManagedJson('wallet_linkage.json', { version: 1, wallets });
}

beforeEach(() => {
  writeManagedJson('wallet_bans.json', { version: 1, bans: {} });
  seedLinkage({
    [CHILD]: [PARENT],        // PARENT funded CHILD — the real observed edge
    [GRANDCHILD]: [CHILD],    // one hop further out
    [RAYAN]: [UNRELATED],     // funded by something unconnected
    [PARENT]: [],
  });
});

describe('the ban list itself', () => {
  test('bans, reads back, and unbans', () => {
    const ban = banWallet(PARENT, { reason: 'sybil cluster', bannedBy: 'LewSales' });
    assert.equal(ban.wallet, PARENT);
    assert.equal(ban.reason, 'sybil cluster');
    assert.equal(isDirectlyBanned(PARENT), true);
    assert.equal(unbanWallet(PARENT), true);
    assert.equal(isDirectlyBanned(PARENT), false);
    assert.equal(unbanWallet(PARENT), false, 'unbanning twice reports nothing removed');
  });

  test('a rejected address cannot be banned, and is never reported as banned', () => {
    assert.throws(() => banWallet('not-a-wallet'), /./);
    assert.equal(getBan('not-a-wallet'), null);
    assert.equal(isDirectlyBanned(''), false);
  });

  test('re-banning keeps the original bannedAt but updates the reason', () => {
    const first = banWallet(PARENT, { reason: 'first' });
    const second = banWallet(PARENT, { reason: 'second' });
    assert.equal(second.bannedAt, first.bannedAt);
    assert.equal(second.reason, 'second');
    assert.equal(listBans().length, 1, 'no duplicate row');
  });

  test('review-only records without refusing anything', () => {
    banWallet(PARENT, { reason: 'watching', reviewOnly: true });
    assert.ok(getBan(PARENT), 'the record exists');
    assert.equal(isDirectlyBanned(PARENT), false, 'but it does not block');
  });
});

describe('a ban follows the funding graph', () => {
  test('the banned wallet itself is refused', async () => {
    banWallet(PARENT, { reason: 'sybil' });
    const result = await findBannedLink(PARENT);
    assert.equal(result.banned, true);
    assert.deepEqual(result.path, [PARENT], 'a direct ban is a one-element path');
  });

  test('a wallet funded by a banned wallet is refused — the wallet-switch case', async () => {
    banWallet(PARENT, { reason: 'sybil' });
    const result = await findBannedLink(CHILD);
    assert.equal(result.banned, true);
    assert.equal(result.ban.wallet, PARENT);
    assert.deepEqual(result.path, [CHILD, PARENT], 'the path shows why, for an audit');
  });

  test('reaches two hops out but stops at the configured depth', async () => {
    banWallet(PARENT, { reason: 'sybil' });
    assert.equal((await findBannedLink(GRANDCHILD, { maxDepth: 2 })).banned, true);
    assert.equal((await findBannedLink(GRANDCHILD, { maxDepth: 1 })).banned, false,
      'depth 1 cannot see past CHILD');
  });

  test('the reverse edge is followed too: banning the child stops the parent', async () => {
    // Otherwise someone could get their funding wallet re-approved by having
    // only the downstream wallet banned.
    banWallet(CHILD, { reason: 'sybil' });
    const result = await findBannedLink(PARENT);
    assert.equal(result.banned, true);
    assert.equal(result.ban.wallet, CHILD);
  });

  test('an unrelated wallet is left alone', async () => {
    banWallet(PARENT, { reason: 'sybil' });
    const result = await findBannedLink(RAYAN);
    assert.equal(result.banned, false, 'sharing a faucet is not sharing a funder');
    assert.equal(result.ban, null);
  });

  test('an empty ban list refuses nobody', async () => {
    for (const w of [PARENT, CHILD, GRANDCHILD, RAYAN]) {
      assert.equal((await findBannedLink(w)).banned, false, w);
    }
  });

  test('a review-only ban does not propagate to the cluster either', async () => {
    banWallet(PARENT, { reason: 'watching', reviewOnly: true });
    assert.equal((await findBannedLink(CHILD)).banned, false);
  });

  test('an invalid address is never banned rather than throwing on the claim path', async () => {
    const result = await findBannedLink('not-a-wallet');
    assert.equal(result.banned, false);
  });
});

describe('early counterparties are not parentage', () => {
  // The distinction this pins, from 2026-08-02: a wallet that merely
  // transacted with a young account early on was being reported as having
  // created it — v1 read the signers of the oldest THREE transactions as
  // funders. On an account with ten transactions those are ordinary
  // transfers, and it presented one claimant as the parent of another's
  // wallet when a third address was the real creator. A ban must never travel
  // along that edge.
  beforeEach(() => {
    seedLinkage({
      [CHILD]: { funders: [PARENT], earlyCounterparties: [RAYAN] },
      [PARENT]: { funders: [] },
      [RAYAN]: { funders: [] },
    });
  });

  test('banning an early counterparty does not refuse the wallet', async () => {
    banWallet(RAYAN, { reason: 'suspected' });
    const result = await findBannedLink(CHILD);
    assert.equal(result.banned, false, 'transacting early is not creating');
  });

  test('banning the actual creator still refuses it', async () => {
    banWallet(PARENT, { reason: 'sybil' });
    assert.equal((await findBannedLink(CHILD)).banned, true);
  });

  test('the reverse edge ignores counterparties too', async () => {
    banWallet(CHILD, { reason: 'sybil' });
    // RAYAN transacted with CHILD early; that must not make RAYAN refusable.
    assert.equal((await findBannedLink(RAYAN)).banned, false);
    // PARENT created CHILD, so it stays caught.
    assert.equal((await findBannedLink(PARENT)).banned, true);
  });

  test('the cluster shows counterparties, marked weak and never expanded', async () => {
    const cluster = await describeCluster(CHILD, { maxDepth: 2 });
    const byWallet = Object.fromEntries(cluster.members.map((m) => [m.wallet, m]));
    assert.equal(byWallet[PARENT].weak, false, 'the creator is a real edge');
    assert.equal(byWallet[RAYAN].weak, true, 'the counterparty is context only');
    assert.match(byWallet[RAYAN].via, /early counterparty/);
  });
});

describe('behaviour when the chain is unreachable', () => {
  test('a direct ban still holds with no linkage data at all', async () => {
    writeManagedJson('wallet_linkage.json', { version: 1, wallets: {} });
    banWallet(PARENT, { reason: 'sybil' });
    const result = await findBannedLink(PARENT);
    assert.equal(result.banned, true, 'the direct check is local and must never depend on RPC');
    assert.equal(result.degraded, false, 'it never even needed the chain');
  });
});

describe('describeCluster, for a human to look at before acting', () => {
  test('lists the cluster with depths and marks who is banned', async () => {
    banWallet(PARENT, { reason: 'sybil' });
    const cluster = await describeCluster(CHILD, { maxDepth: 2 });
    const byWallet = Object.fromEntries(cluster.members.map((m) => [m.wallet, m]));

    assert.equal(byWallet[CHILD].depth, 0, 'the subject is depth 0');
    assert.ok(byWallet[PARENT], 'its funder is included');
    assert.equal(byWallet[PARENT].banned, true);
    assert.equal(byWallet[PARENT].banReason, 'sybil');
    assert.equal(byWallet[CHILD].banned, false);
  });

  test('includes wallets the subject funded, not only its funders', async () => {
    const cluster = await describeCluster(PARENT, { maxDepth: 1 });
    assert.ok(cluster.members.some((m) => m.wallet === CHILD), 'reverse edge present');
  });
});

describe('the cached graph', () => {
  test('knownFundedBy is the inverse of the funder edge', () => {
    assert.deepEqual(knownFundedBy(PARENT), [CHILD]);
    assert.deepEqual(knownFundedBy(UNRELATED), [RAYAN]);
    assert.deepEqual(knownFundedBy(GRANDCHILD), []);
  });

  test('a seeded record reads back with its funders', () => {
    assert.deepEqual(readLinkageRecord(CHILD).funders, [PARENT]);
    assert.equal(readLinkageRecord('never-scanned'), null);
  });
});
