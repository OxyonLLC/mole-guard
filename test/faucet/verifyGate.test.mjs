process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';
// getFaucetConfig() validates the faucet env. Only WINLEW_MINT is mandatory
// and nothing here depends on its value, so provide one rather than making the
// test depend on a populated .env.
process.env.WINLEW_MINT ||= 'So11111111111111111111111111111111111111112';

// Covers the "verify after N claims" gate in src/faucet/eligibility.js, at the
// level that matters: the counting rule.
//
// Decided 2026-08-02 — existing heavy claimers are NOT grandfathered. The
// accounts worth asking to verify are exactly the ones that have claimed the
// most, so exempting them would defeat the point. Measured against the real
// store at the time: one wallet was already past 10, so this is a targeted
// ask, not a mass refusal.
//
// The count is the HIGHER of per-wallet and per-Discord-account. Both are
// needed and for different reasons:
//   - per-wallet alone is reset for free by generating a new keypair;
//   - per-account alone silently forgets legacy migrated claims, which carry
//     discordUserId: null.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { countClaimsForGate } = await import('../../src/faucet/claimStore.js');
const { getFaucetConfig } = await import('../../src/faucet/config.js');
const { ELIGIBILITY_REASONS } = await import('../../src/faucet/eligibility.js');
const fs = await import('node:fs');

describe('countClaimsForGate', () => {
  test('is exported and callable with neither identifier', async () => {
    const counts = await countClaimsForGate({});
    assert.equal(counts.byWallet, 0);
    assert.equal(counts.byUser, 0);
    assert.equal(counts.highest, 0);
  });

  test('an unknown wallet and user count zero, so a newcomer is never gated', async () => {
    const counts = await countClaimsForGate({
      wallet: 'So11111111111111111111111111111111111111112',
      discordUserId: 'no-such-user-for-tests',
    });
    assert.equal(counts.highest, 0);
  });

  test('highest is the max of the two, never their sum', async () => {
    // Summing would double-count a normal user, whose every claim increments
    // both counters, and would gate them at five real claims instead of ten.
    const counts = await countClaimsForGate({
      wallet: 'So11111111111111111111111111111111111111112',
      discordUserId: 'no-such-user-for-tests',
    });
    assert.equal(counts.highest, Math.max(counts.byWallet, counts.byUser));
  });
});

describe('the gate threshold', () => {

  test('defaults to 10 lifetime confirmed claims', () => {
    assert.equal(getFaucetConfig().verifyAfterClaims, 10);
  });

  test('is disabled by 0 and clamped against nonsense', async () => {
    const original = process.env.FAUCET_VERIFY_AFTER_CLAIMS;
    try {
      process.env.FAUCET_VERIFY_AFTER_CLAIMS = '0';
      assert.equal(getFaucetConfig().verifyAfterClaims, 0, '0 turns the gate off');
      process.env.FAUCET_VERIFY_AFTER_CLAIMS = '-5';
      assert.equal(getFaucetConfig().verifyAfterClaims, 0, 'negative cannot mean "gate everyone"');
      process.env.FAUCET_VERIFY_AFTER_CLAIMS = 'banana';
      assert.equal(getFaucetConfig().verifyAfterClaims, 0);
      process.env.FAUCET_VERIFY_AFTER_CLAIMS = '3';
      assert.equal(getFaucetConfig().verifyAfterClaims, 3);
    } finally {
      if (original === undefined) delete process.env.FAUCET_VERIFY_AFTER_CLAIMS;
      else process.env.FAUCET_VERIFY_AFTER_CLAIMS = original;
    }
  });
});

describe('the reason code', () => {

  test('verification_required exists and is distinct from a ban', () => {
    assert.equal(ELIGIBILITY_REASONS.VERIFICATION_REQUIRED, 'verification_required');
    assert.notEqual(ELIGIBILITY_REASONS.VERIFICATION_REQUIRED, ELIGIBILITY_REASONS.WALLET_BANNED);
  });

  test('both interfaces have copy for it, so neither leaks a bare reason code', () => {
    const web = fs.readFileSync(new URL('../../src/public/faucet/js/app.js', import.meta.url), 'utf8');
    const bot = fs.readFileSync(new URL('../../src/faucet/bot.js', import.meta.url), 'utf8');
    assert.match(web, /verification_required:/, 'web faucet must explain it');
    assert.match(bot, /case 'verification_required'/, 'Discord adapter must explain it');
    // The point of this gate is that it is clearable — both must say where.
    assert.match(web, /\/verify\//);
    assert.match(bot, /winlew\.co\/verify\//);
  });
});
