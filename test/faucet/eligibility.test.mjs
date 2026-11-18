process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWalletAddress,
  checkEligibility,
  ELIGIBILITY_REASONS,
  identityCooldownTargets,
  pickBlockingStatus,
} from '../../src/faucet/eligibility.js';

// No claimStore cleanup here on purpose: checkEligibility() only calls
// claimStore's getStatusForUser/getStatusForWallet, both pure reads (no lock
// acquisition, no write — see fileGetStatusForKey in claimStore.js) — this
// file never creates or touches src/faucet/data/claims_v3.json. It used to
// carry a defensive `after()` that unlinked FILE_STORE_PATH/FILE_LOCK_PATH
// "just in case"; that was actually harmful, not just redundant — node --test
// runs test files concurrently by default, and that cleanup raced the real
// writers (test/faucet/claimStore.test.mjs) over the same shared,
// non-configurable path, intermittently throwing ENOENT when this file's
// unlink lost the race against theirs. Only files that actually call
// reserveClaim()/migrateLegacyV2IfNeeded() should touch those paths at all.
const REQUIRED_ENV = {
  WINLEW_MINT: 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump',
  DRIP_AMOUNT: '1000',
  BOT_KEYPAIR_PATH: './bot-keypair.json', // never read in this test — only its presence (non-empty) is checked
};
for (const [k, v] of Object.entries(REQUIRED_ENV)) {
  if (!process.env[k]) process.env[k] = v;
}

describe('eligibility: normalizeWalletAddress', () => {
  test('accepts a valid base58 address and returns it unchanged (never lowercased)', () => {
    const addr = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';
    assert.equal(normalizeWalletAddress(addr), addr);
  });
  test('rejects a malformed address', () => {
    assert.throws(() => normalizeWalletAddress('not-a-real-wallet!!!'), /wallet_not_base58/);
  });
  test('rejects an empty address', () => {
    assert.throws(() => normalizeWalletAddress(''), /wallet_empty/);
  });
});

describe('eligibility: checkEligibility branches that need no network access', () => {
  test('FAUCET_DISABLED short-circuits to not_enabled before touching wallet resolution', async () => {
    process.env.FAUCET_DISABLED = 'true';
    try {
      const result = await checkEligibility({ discordUserId: 'anyUser' });
      assert.equal(result.eligible, false);
      assert.equal(result.reason, ELIGIBILITY_REASONS.NOT_ENABLED);
    } finally {
      delete process.env.FAUCET_DISABLED;
    }
  });

  test('a Discord user with no linked faucet wallet gets no_wallet', async () => {
    const result = await checkEligibility({ discordUserId: '__definitely_unlinked_test_user__' });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, ELIGIBILITY_REASONS.NO_WALLET);
  });

  test('an explicit but malformed wallet override is rejected as invalid_wallet', async () => {
    const result = await checkEligibility({ discordUserId: 'anyUser', wallet: 'garbage' });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, ELIGIBILITY_REASONS.INVALID_WALLET);
  });
});

// ── One claim per person, not per wallet (2026-08-20) ─────────────────────
//
// The rule in the owner's words: "one claim per person, no matter how many
// wallets they have." The cooldown was already keyed by Discord account AND by
// wallet, which stopped the same account claiming twice — but not the shape it
// was meant to stop: claim with wallet A, verify wallet B, claim again.
//
// Both halves are pure functions precisely so this can be pinned without a
// chain, a claim store or a Discord session.
describe('eligibility: identity-wide cooldown', () => {
  const A = 'AX7cMx4GMxwNt72ZqztYh9zqkZspvdxgVAmTBYcHNVhk';
  const B = '6Y4MJPHpG66bRizdy99mEZnaaiwvEx9Q1aD6wh8PQB5v';
  const C = '23nSNTRJJMqEm8X2MYpnxG4iRtkgPW4yFkwauSsLhaig';
  const FUTURE = Math.floor(Date.now() / 1000) + 10_000;

  const ownerOf = (wallets, discordUserId = '111') => ({
    discordUserId,
    record: {
      verified_wallets: Object.fromEntries(
        wallets.map((w) => [w, { verified_at: FUTURE - 1000, expires_at: FUTURE }]),
      ),
    },
  });

  test('the claiming wallet is not checked against itself', () => {
    const { siblingWallets } = identityCooldownTargets({
      wallet: A, owner: ownerOf([A, B, C]), discordUserId: '111',
    });
    assert.deepEqual(siblingWallets.sort(), [B, C].sort());
  });

  test('an unlinked wallet has no siblings and no owner to check', () => {
    const targets = identityCooldownTargets({ wallet: A, owner: null, discordUserId: '111' });
    assert.deepEqual(targets.siblingWallets, []);
    assert.equal(targets.ownerUserId, null);
  });

  test("the owning account is checked when the claim arrives under a different id", () => {
    // A wallet-only web session's id is a hash of the wallet, not a Discord
    // account — without this the person's own cooldown would never be consulted.
    const { ownerUserId } = identityCooldownTargets({
      wallet: A, owner: ownerOf([A], '111'), discordUserId: 'sha256-of-wallet',
    });
    assert.equal(ownerUserId, '111');
  });

  test('the owning account is not double-checked when it is the requester', () => {
    const { ownerUserId } = identityCooldownTargets({
      wallet: A, owner: ownerOf([A], '111'), discordUserId: '111',
    });
    assert.equal(ownerUserId, null, 'an extra identical lookup is a wasted round trip, not a second signal');
  });

  test("every account the same person holds is checked, not just the one that claimed", () => {
    // The reported bug, in one assertion: a person with a Discord login AND an
    // X login was two accounts, so yesterday's claim under one of them was
    // invisible to today's check on the other and the faucet paid twice inside
    // one cooldown. The merge map is injected here so the rule is tested
    // without a store on disk.
    const accountIdsFor = (id) => (['111', 'x:same-person'].includes(id) ? ['111', 'x:same-person'] : [id]);
    const { siblingUserIds } = identityCooldownTargets({
      wallet: A, owner: ownerOf([A], '111'), discordUserId: '111', accountIdsFor,
    });
    assert.deepEqual(siblingUserIds, ['x:same-person']);
  });

  test('no id is looked up twice, however many doors resolve to it', () => {
    const accountIdsFor = () => ['111', 'x:same-person', '111'];
    const { siblingUserIds } = identityCooldownTargets({
      wallet: A, owner: ownerOf([A], '111'), discordUserId: 'sha256-of-wallet', accountIdsFor,
    });
    // '111' is already covered by ownerUserId, so only the other door is left.
    assert.deepEqual(siblingUserIds, ['x:same-person']);
  });

  test('a sibling account on cooldown blocks the claim', () => {
    const blocked = { blocked: true, nextEligibleAt: Date.now() + 3600_000, lastClaim: { source: 'web' } };
    const result = pickBlockingStatus({
      userStatus: { blocked: false },
      walletStatus: { blocked: false },
      ownerStatus: { blocked: false },
      siblingUserStatuses: [blocked],
    });
    assert.equal(result.status, blocked);
    assert.equal(result.fromSibling, true, 'it was another of their accounts, not this wallet');
  });

  test('a sibling wallet on cooldown blocks this one, and is reported as a sibling', () => {
    const blocked = { blocked: true, nextEligibleAt: Date.now() + 3600_000, lastClaim: { source: 'discord' } };
    const result = pickBlockingStatus({
      userStatus: { blocked: false },
      walletStatus: { blocked: false },
      ownerStatus: { blocked: false },
      siblingStatuses: [{ blocked: false }, blocked],
    });
    assert.equal(result.status, blocked);
    assert.equal(result.fromSibling, true);
  });

  test("this wallet's own cooldown is never reported as someone else's", () => {
    const mine = { blocked: true, nextEligibleAt: Date.now() + 60_000, lastClaim: { source: 'web' } };
    const result = pickBlockingStatus({
      userStatus: { blocked: false },
      walletStatus: mine,
      ownerStatus: { blocked: false },
      siblingStatuses: [{ blocked: true }],
    });
    assert.equal(result.status, mine, 'the wallet the person is actually using wins the explanation');
    assert.equal(result.fromSibling, false);
  });

  test('nothing blocked means no block', () => {
    const result = pickBlockingStatus({
      userStatus: { blocked: false }, walletStatus: { blocked: false },
      ownerStatus: { blocked: false }, siblingStatuses: [{ blocked: false }],
    });
    assert.equal(result.status, null);
    assert.equal(result.fromSibling, false);
  });

  test('an expired sibling verification stops being a sibling', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const owner = {
      discordUserId: '111',
      record: {
        verified_wallets: {
          [A]: { verified_at: past - 1000, expires_at: FUTURE },
          [B]: { verified_at: past - 5000, expires_at: past },
        },
      },
    };
    const { siblingWallets } = identityCooldownTargets({ wallet: A, owner, discordUserId: '111' });
    assert.deepEqual(siblingWallets, [], 'a lapsed wallet is not part of the identity for this purpose');
  });
});
