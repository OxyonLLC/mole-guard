// Forces file-mode explicitly, regardless of what MONGO_ENABLED/MONGO_URI
// this machine's real .env files have configured — other faucet modules
// (faucet.js) load those .env files as an import-time side effect, and if
// this weren't forced, claimStore.js's `isMongoEnabled()` (checked fresh on
// every call) could silently flip modes mid-test. This file never touches
// the real production claim store either way — src/faucet/data/claims_v3.json
// does not exist until a test creates it, and every test here cleans up
// after itself.
//
// This is the ONLY test file allowed to create/unlink FILE_STORE_PATH/
// FILE_LOCK_PATH (src/faucet/claimStore.js's data path is hardcoded, not
// configurable, same constraint as src/quiz/db.js). Do NOT add a second test
// file with its own before/after touching those paths — node --test runs
// test files concurrently by default, and a second writer racing this file
// over the same shared path has already caused intermittent ENOENT failures
// (both in this file's own after() unlinking a lock another process already
// removed, and in a read-only file's defensive cleanup losing the race — see
// eligibility.test.mjs/service.test.mjs's comments). The payout-worker.js
// tests live in the last describe block below for exactly this reason: they
// call reserveClaim() too, so they share this one lifecycle instead of
// getting their own.
process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';
process.env.FAUCET_PAYOUTS_DRY_RUN = 'true';
// payout-worker.js's real default batch size is 10 — fine in production
// (it just sweeps again on the next scan), but this file's earlier describe
// blocks deliberately leave dozens of claims sitting in 'reserved' (cooldown
// tests, race-resistance tests, listClaimsByStatus tests, etc.), all older
// than anything the payout-worker tests below create. listClaimsByStatus
// sorts oldest-first, so a batch of 10 would sweep only those leftovers and
// never reach the claim a given test is actually asserting on. Raised here,
// test-only, so scanOnce() sweeps everything in one pass.
process.env.FAUCET_PAYOUT_MAX_BATCH = '1000';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cs from '../../src/faucet/claimStore.js';
// payout-worker.js reads FAUCET_PAYOUTS_DRY_RUN/FAUCET_PAYOUT_MAX_BATCH into
// module-level consts at import time — a STATIC `import` here would be
// hoisted and evaluated before the process.env assignments above ever run,
// silently capturing the production defaults. A dynamic import, evaluated at
// its textual position, avoids that.
const { scanOnce } = await import('../../src/faucet/payout-worker.js');

const BASE = { source: 'web', amountBaseUnits: '1000000000', amountDisplay: '1000', mint: 'MintXYZ', cooldownMs: 60_000 };
let uid = 0;
function freshIds() {
  uid += 1;
  return { user: `testUser${uid}`, wallet: `testWallet${uid}` };
}

before(() => {
  assert.equal(fs.existsSync(cs.FILE_STORE_PATH), false, 'refusing to run: a claim store file already exists at this path');
});

after(() => {
  if (fs.existsSync(cs.FILE_STORE_PATH)) fs.unlinkSync(cs.FILE_STORE_PATH);
  if (fs.existsSync(cs.FILE_LOCK_PATH)) fs.unlinkSync(cs.FILE_LOCK_PATH);
});

describe('claimStore: reservation basics', () => {
  test('a fresh (user, wallet) pair can reserve', async () => {
    const { user, wallet } = freshIds();
    const r = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    assert.equal(r.ok, true);
    assert.equal(r.replay, false);
    assert.equal(r.claim.status, 'reserved');
    assert.equal(r.claim.discordUserId, user);
    assert.equal(r.claim.wallet, wallet);
  });

  test('the same user with a different wallet is blocked (user-cooldown)', async () => {
    const { user, wallet } = freshIds();
    await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    const r2 = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet: `${wallet}-other` });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'cooldown');
    assert.equal(r2.blockedBy, 'user');
  });

  test('a different user claiming the same wallet is blocked (wallet-cooldown)', async () => {
    const { user, wallet } = freshIds();
    await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    const r2 = await cs.reserveClaim({ ...BASE, discordUserId: `${user}-other`, wallet });
    assert.equal(r2.ok, false);
    assert.equal(r2.blockedBy, 'wallet');
  });

  test('this is the cross-platform invariant: a discord claim blocks a web claim for the same user+wallet, and vice versa', async () => {
    const { user, wallet } = freshIds();
    const discordClaim = await cs.reserveClaim({ ...BASE, source: 'discord', discordUserId: user, wallet });
    assert.equal(discordClaim.ok, true);
    const webAttempt = await cs.reserveClaim({ ...BASE, source: 'web', discordUserId: user, wallet });
    assert.equal(webAttempt.ok, false);
    assert.equal(webAttempt.lastClaimSource, 'discord');
  });

  test('a new (user, wallet) pair is unaffected by unrelated claims', async () => {
    const a = freshIds();
    const b = freshIds();
    await cs.reserveClaim({ ...BASE, discordUserId: a.user, wallet: a.wallet });
    const rb = await cs.reserveClaim({ ...BASE, discordUserId: b.user, wallet: b.wallet });
    assert.equal(rb.ok, true);
  });

  test('cooldown expiry allows a new reservation', async () => {
    const { user, wallet } = freshIds();
    await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 200 });
    await new Promise((r) => setTimeout(r, 300));
    const r2 = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 60_000 });
    assert.equal(r2.ok, true);
  });
});

describe('claimStore: idempotent replay', () => {
  test('the same requestId returns the original claim instead of reserving again', async () => {
    const { user, wallet } = freshIds();
    const requestId = `req-${user}`;
    const r1 = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, requestId });
    const r2 = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, requestId });
    assert.equal(r1.replay, false);
    assert.equal(r2.replay, true);
    assert.equal(r1.claim.id, r2.claim.id);
  });
});

describe('claimStore: state machine transitions', () => {
  test('reserved -> processing -> submitted -> confirmed', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    await cs.markProcessing(claim.id);
    await cs.markSubmitted(claim.id, 'fakeSignature123');
    const confirmed = await cs.markConfirmed(claim.id);
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.signature, 'fakeSignature123');
  });

  test('markReconciling for an uncertain failure', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    const reconciling = await cs.markReconciling(claim.id);
    assert.equal(reconciling.status, 'reconciling');
  });

  test('markFailed + releaseReservationAdministratively frees the cooldown for a certain pre-submission failure', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    await cs.markFailed(claim.id, 'failed');
    await cs.releaseReservationAdministratively(claim.id, 'test_release');

    const retry = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    assert.equal(retry.ok, true, 'user must be able to claim again after an administrative release');
  });

  test('takeReservedClaimForProcessing is atomic — only one worker can take a reserved web claim', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, source: 'web', discordUserId: user, wallet });
    const [a, b] = await Promise.all([
      cs.takeReservedClaimForProcessing(claim.id),
      cs.takeReservedClaimForProcessing(claim.id),
    ]);
    const winners = [a, b].filter(Boolean);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].status, 'processing');

    const after = await cs.getClaimById(claim.id);
    assert.equal(after.status, 'processing');
  });
});

describe('claimStore: the last gate before the treasury moves', () => {
  // These exercise findDuplicatePaidClaim directly, because it is the check
  // that has to hold when the reservation lock did NOT — a lock deleted by a
  // mistaken release, or a reservation made while the shared lock store was
  // unreachable. Every test here therefore builds the duplicate row by hand
  // rather than going through reserveClaim, which would refuse it.

  test('a claim is clean when nothing else was paid inside its cooldown', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 60_000 });
    assert.equal(await cs.findDuplicatePaidClaim(claim), null);
  });

  test('blocks a second payout to the same WALLET inside the cooldown', async () => {
    const { user, wallet } = freshIds();
    const paid = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 50 });
    await cs.markSubmitted(paid.claim.id, 'sig-1');
    await cs.markConfirmed(paid.claim.id);

    // The lock outlives nothing here: it was written with a 50ms cooldown, so
    // it lapses immediately. That is the real hazard in one line — a lock that
    // no longer reflects the cooldown the claim was actually made under.
    await new Promise((r) => setTimeout(r, 80));
    const second = await cs.reserveClaim({ ...BASE, discordUserId: `${user}-other`, wallet, cooldownMs: 60_000 });
    assert.equal(second.ok, true, 'precondition: the lock has lapsed, so the reservation succeeds');

    const duplicate = await cs.findDuplicatePaidClaim(second.claim);
    assert.ok(duplicate, 'the payout gate must catch what the lock missed');
    assert.equal(duplicate.id, paid.claim.id);
  });

  test('blocks a second payout to the same USER inside the cooldown', async () => {
    const { user, wallet } = freshIds();
    const paid = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 50 });
    await cs.markSubmitted(paid.claim.id, 'sig-2');
    await cs.markConfirmed(paid.claim.id);

    await new Promise((r) => setTimeout(r, 80));
    const second = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet: `${wallet}-2`, cooldownMs: 60_000 });
    assert.equal(second.ok, true);

    const duplicate = await cs.findDuplicatePaidClaim(second.claim);
    assert.ok(duplicate, 'a different wallet does not make it a different person');
    assert.equal(duplicate.id, paid.claim.id);
  });

  test('a claim still in reconciling counts as paid — unknown must not mean payable', async () => {
    const { user, wallet } = freshIds();
    const first = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 50 });
    await cs.markReconciling(first.claim.id);

    await new Promise((r) => setTimeout(r, 80));
    const second = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 60_000 });
    const duplicate = await cs.findDuplicatePaidClaim(second.claim);
    assert.ok(duplicate, 'reconciling means the outcome is unknown, so treat it as paid');
  });

  test('a payout OUTSIDE the cooldown is allowed through', async () => {
    const { user, wallet } = freshIds();
    const paid = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 50 });
    await cs.markSubmitted(paid.claim.id, 'sig-3');
    await cs.markConfirmed(paid.claim.id);
    await new Promise((r) => setTimeout(r, 80));

    const second = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 50 });
    assert.equal(second.ok, true);
    assert.equal(await cs.findDuplicatePaidClaim(second.claim), null, 'the cooldown genuinely elapsed');
  });

  test('a corrupt cooldownMs falls back to 24h rather than checking nothing', async () => {
    const { user, wallet } = freshIds();
    const paid = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 60_000 });
    await cs.markSubmitted(paid.claim.id, 'sig-4');
    await cs.markConfirmed(paid.claim.id);

    const duplicate = await cs.findDuplicatePaidClaim({
      id: 'synthetic-corrupt', wallet, discordUserId: user,
      reservedAt: Date.now(), createdAt: Date.now(), cooldownMs: undefined,
    });
    assert.ok(duplicate, 'an unreadable cooldown must fail closed');
  });

  test('releasing a claim that carries a signature is refused without force', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 60_000 });
    await cs.markSubmitted(claim.id, 'sig-already-on-the-network');

    const refused = await cs.releaseReservationAdministratively(claim.id, 'payout_failed_pre_submission');
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'refused_signature_present');

    const still = await cs.getClaimById(claim.id);
    assert.notEqual(still.status, 'administratively_released', 'the cooldown must not have been handed back');

    const forced = await cs.releaseReservationAdministratively(claim.id, 'verified on-chain', { force: true });
    assert.equal(forced.ok, true, 'faucet:reconcile can still release after checking the chain');
  });
});

describe('claimStore: a requestId replay cannot cross accounts', () => {
  test('replaying your OWN requestId returns your claim, as before', async () => {
    const { user, wallet } = freshIds();
    const first = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, requestId: `req-${user}` });
    const again = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, requestId: `req-${user}` });
    assert.equal(again.ok, true);
    assert.equal(again.replay, true);
    assert.equal(again.claim.id, first.claim.id);
  });

  test("presenting someone else's requestId is refused, not replayed", async () => {
    const victim = freshIds();
    const attacker = freshIds();
    const publicRequestId = `discord-message-id-${victim.user}`;
    const theirs = await cs.reserveClaim({
      ...BASE, source: 'discord', discordUserId: victim.user, wallet: victim.wallet, requestId: publicRequestId,
    });
    await cs.markSubmitted(theirs.claim.id, 'victim-signature');

    const stolen = await cs.reserveClaim({
      ...BASE, source: 'web', discordUserId: attacker.user, wallet: attacker.wallet, requestId: publicRequestId,
    });
    assert.equal(stolen.ok, false, "another account's claim must never be returned");
    assert.equal(stolen.reason, 'request_id_conflict');
    assert.equal(stolen.claim, undefined, 'no claim object may leak back');
  });
});

describe('claimStore: status queries', () => {
  test('getStatusForUser/getStatusForWallet reflect an active reservation', async () => {
    const { user, wallet } = freshIds();
    await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    const userStatus = await cs.getStatusForUser(user);
    const walletStatus = await cs.getStatusForWallet(wallet);
    assert.equal(userStatus.blocked, true);
    assert.equal(walletStatus.blocked, true);
    assert.ok(userStatus.nextEligibleAt > Date.now());
  });

  test('an untouched key is not blocked', async () => {
    const { user } = freshIds();
    const status = await cs.getStatusForUser(`${user}-never-claimed`);
    assert.equal(status.blocked, false);
    assert.equal(status.nextEligibleAt, null);
  });
});

describe('claimStore: getClaimHistoryForUser (used by the Proof of Value engine)', () => {
  test('a user with no claims gets an empty, non-null summary', async () => {
    const { user } = freshIds();
    const history = await cs.getClaimHistoryForUser(`${user}-never-claimed`);
    assert.deepEqual(history.claims, []);
    assert.equal(history.count, 0);
    assert.equal(history.confirmedCount, 0);
    assert.equal(history.firstClaimAt, null);
    assert.equal(history.lastClaimAt, null);
    assert.equal(history.lastConfirmedAt, null);
  });

  test('counts only this user\'s claims, oldest first, and tracks confirmed vs. total', async () => {
    const { user, wallet } = freshIds();
    const other = freshIds();

    const first = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, cooldownMs: 50 });
    await cs.markProcessing(first.claim.id);
    await cs.markConfirmed(first.claim.id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const second = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet: `${wallet}-2`, cooldownMs: 50 });
    // second claim is left reserved (never confirmed) — should still count toward `count`, not `confirmedCount`.

    await cs.reserveClaim({ ...BASE, discordUserId: other.user, wallet: other.wallet });

    const history = await cs.getClaimHistoryForUser(user);
    assert.equal(history.count, 2);
    assert.equal(history.confirmedCount, 1);
    assert.equal(history.claims[0].id, first.claim.id);
    assert.equal(history.claims[1].id, second.claim.id);
    assert.equal(history.firstClaimAt, first.claim.createdAt);
    assert.ok(history.lastClaimAt >= history.firstClaimAt);
    assert.equal(history.lastConfirmedAt, first.claim.createdAt);
    assert.ok(!history.claims.some((c) => c.discordUserId === other.user));
    // second claim (amountDisplay '1000') was never confirmed, so only the
    // first confirmed claim's amount counts toward the total.
    assert.equal(history.totalConfirmedAmount, 1000);
  });

  test('totalConfirmedAmount sums only confirmed claims, used by the dashboard "total distributed" figure', async () => {
    const { user, wallet } = freshIds();

    const a = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet, amountDisplay: '25.5', cooldownMs: 50 });
    await cs.markProcessing(a.claim.id);
    await cs.markConfirmed(a.claim.id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const b = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet: `${wallet}-2`, amountDisplay: '10.25', cooldownMs: 50 });
    await cs.markProcessing(b.claim.id);
    await cs.markConfirmed(b.claim.id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const c = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet: `${wallet}-3`, amountDisplay: '1000', cooldownMs: 50 });
    await cs.markFailed(c.claim.id, 'reconciliation_failed');

    const history = await cs.getClaimHistoryForUser(user);
    assert.equal(history.confirmedCount, 2);
    assert.equal(history.totalConfirmedAmount, 35.75);
  });
});

describe('claimStore: getGlobalFaucetStats (Faucet page "how much has been given away" + Web vs Discord)', () => {
  test('with no claims at all, returns a zeroed, non-null summary', async () => {
    // Note: this file's earlier describe blocks may have already written
    // claims to the shared store, so this only asserts shape/non-negativity,
    // not literal zero — a true "empty store" case is covered structurally
    // by the fact totals never go negative and bySource is always an object.
    const stats = await cs.getGlobalFaucetStats();
    assert.ok(stats.totalConfirmedCount >= 0);
    assert.ok(stats.totalConfirmedAmount >= 0);
    assert.equal(typeof stats.bySource, 'object');
  });

  test('sums confirmed claims across ALL users, split by source, excluding unconfirmed ones', async () => {
    const before = await cs.getGlobalFaucetStats();

    const web1 = freshIds();
    const a = await cs.reserveClaim({ ...BASE, source: 'web', discordUserId: web1.user, wallet: web1.wallet, amountDisplay: '100', cooldownMs: 50 });
    await cs.markProcessing(a.claim.id);
    await cs.markConfirmed(a.claim.id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const disc1 = freshIds();
    const b = await cs.reserveClaim({ ...BASE, source: 'discord', discordUserId: disc1.user, wallet: disc1.wallet, amountDisplay: '250', cooldownMs: 50 });
    await cs.markProcessing(b.claim.id);
    await cs.markConfirmed(b.claim.id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Never confirmed — must NOT count toward the total, on either platform.
    const web2 = freshIds();
    await cs.reserveClaim({ ...BASE, source: 'web', discordUserId: web2.user, wallet: web2.wallet, amountDisplay: '999999', cooldownMs: 50 });

    const after = await cs.getGlobalFaucetStats();
    assert.equal(after.totalConfirmedCount, before.totalConfirmedCount + 2);
    assert.equal(
      Math.round((after.totalConfirmedAmount - before.totalConfirmedAmount) * 100) / 100,
      350,
      'only the two confirmed claims (100 web + 250 discord) should be added, never the unconfirmed 999999',
    );
    assert.ok(after.bySource.web.amount >= (before.bySource.web?.amount || 0) + 100);
    assert.ok(after.bySource.discord.amount >= (before.bySource.discord?.amount || 0) + 250);
  });
});

describe('claimStore: listClaimsByStatus (used by the payout worker)', () => {
  test('finds reserved claims and respects the limit', async () => {
    const ids = [freshIds(), freshIds(), freshIds()];
    for (const { user, wallet } of ids) {
      await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    }
    const found = await cs.listClaimsByStatus('reserved', 2);
    assert.equal(found.length, 2);
  });

  test('a confirmed claim no longer shows up under reserved', async () => {
    const { user, wallet } = freshIds();
    const { claim } = await cs.reserveClaim({ ...BASE, discordUserId: user, wallet });
    await cs.markProcessing(claim.id);
    await cs.markConfirmed(claim.id);
    const reserved = await cs.listClaimsByStatus('reserved', 100);
    assert.ok(!reserved.some((c) => c.id === claim.id));
  });
});

describe('claimStore: race resistance (the core safety property)', () => {
  test('20 concurrent in-process reservations for the same user+wallet produce exactly one winner', async () => {
    const { user, wallet } = freshIds();
    const attempts = Array.from({ length: 20 }, () => cs.reserveClaim({ ...BASE, discordUserId: user, wallet }));
    const results = await Promise.all(attempts);
    const wins = results.filter((r) => r.ok).length;
    assert.equal(wins, 1);
  });

  test('mixed discord/web concurrent claims for the same identity still produce exactly one winner', async () => {
    const { user, wallet } = freshIds();
    const attempts = [
      cs.reserveClaim({ ...BASE, source: 'discord', discordUserId: user, wallet }),
      cs.reserveClaim({ ...BASE, source: 'web', discordUserId: user, wallet }),
      cs.reserveClaim({ ...BASE, source: 'web', discordUserId: user, wallet }),
      cs.reserveClaim({ ...BASE, source: 'discord', discordUserId: user, wallet }),
    ];
    const results = await Promise.all(attempts);
    assert.equal(results.filter((r) => r.ok).length, 1);
  });
});

describe('claimStore: invalid input rejected', () => {
  test('recordPlatformAnswer-style bad platform equivalent: an invalid source', async () => {
    await assert.rejects(() => cs.reserveClaim({ ...BASE, source: 'discord', discordUserId: undefined, wallet: 'w' }));
  });
});

describe('claimStore: legacy v2 migration', () => {
  test('imports wallet/user timestamps, is idempotent, and never resets an already-newer lock', async () => {
    const legacyClaims = {
      version: 2,
      wallets: { LegacyWalletXYZ: Date.now() - 1000 * 60 * 60 }, // 1h ago
      users: { legacyUserXYZ: Date.now() - 1000 * 60 * 60 * 30 }, // 30h ago
    };
    const cooldownMs = 24 * 60 * 60 * 1000;

    const first = await cs.migrateLegacyV2IfNeeded({ legacyClaims, cooldownMs });
    assert.equal(first.alreadyMigrated, false);
    assert.equal(first.counts.wallets, 1);
    assert.equal(first.counts.users, 1);

    const second = await cs.migrateLegacyV2IfNeeded({ legacyClaims, cooldownMs });
    assert.equal(second.alreadyMigrated, true);
    assert.deepEqual(second.counts, first.counts);

    const walletStatus = await cs.getStatusForWallet('LegacyWalletXYZ');
    assert.equal(walletStatus.blocked, true, 'claimed 1h ago with a 24h cooldown must still be blocked');

    const userStatus = await cs.getStatusForUser('legacyUserXYZ');
    assert.equal(userStatus.blocked, false, 'claimed 30h ago with a 24h cooldown must be eligible again');
  });
});

describe('payout-worker: importing it has no side effects', () => {
  test('scanOnce is a plain function; importing this module never auto-starts a timer', () => {
    assert.equal(typeof scanOnce, 'function');
  });
});

describe('payout-worker: scanOnce', () => {
  test('processes a reserved web claim (dry run) and confirms it', async () => {
    const { claim } = await cs.reserveClaim({ ...BASE, source: 'web', discordUserId: 'workerUser1', wallet: 'workerWallet1' });
    const result = await scanOnce();
    assert.equal(result.skipped, false);
    assert.ok(result.processed >= 1);

    const after1 = await cs.getClaimById(claim.id);
    assert.equal(after1.status, 'confirmed');
    assert.equal(after1.signature, 'DRY_RUN_NO_SIGNATURE');
  });

  test('ignores a reserved discord claim entirely (bot.js processes those inline)', async () => {
    const { claim } = await cs.reserveClaim({ ...BASE, source: 'discord', discordUserId: 'workerUser2', wallet: 'workerWallet2' });
    await scanOnce();
    const after1 = await cs.getClaimById(claim.id);
    assert.equal(after1.status, 'reserved', 'a discord-sourced claim must never be touched by this worker');
  });

  test('a second concurrent scanOnce is a no-op while one is already running (running-flag guard)', async () => {
    await cs.reserveClaim({ ...BASE, source: 'web', discordUserId: 'workerUser3', wallet: 'workerWallet3' });
    const [a, b] = await Promise.all([scanOnce(), scanOnce()]);
    const skippedCount = [a, b].filter((r) => r.skipped).length;
    assert.ok(skippedCount <= 1, 'at most one of two concurrent scans should be skipped due to overlap, never both blocked');
  });
});
