process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';
process.env.WINLEW_MINT ||= 'So11111111111111111111111111111111111111112';

// `!drip <address>` may only target the wallet an account has already
// registered (src/faucet/service.js).
//
// Why, 2026-08-02: paying an arbitrary address on request left claims with no
// durable Discord-to-wallet link, which is what made a group of accounts hard
// to attribute. It also interacts badly with the verification gate — an
// unregistered wallet can never satisfy it, so such a claim would fail later
// and less clearly.
//
// These tests hit claimFaucet() directly rather than through Discord, which is
// the point: the rule lives in the shared service, so BOTH adapters get it and
// neither can drift.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { claimFaucet } = await import('../../src/faucet/service.js');

// A syntactically valid address that no test account has registered.
const UNREGISTERED = 'So11111111111111111111111111111111111111112';
const NOBODY = 'no-such-discord-user-for-tests';

describe('a claim aimed at an unregistered wallet', () => {
  test('is refused, and names the wallet so the reply can quote it back', async () => {
    const result = await claimFaucet({
      discordUserId: NOBODY,
      source: 'discord',
      requestedWallet: UNREGISTERED,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'wallet_not_registered');
    assert.equal(result.requestedWallet, UNREGISTERED,
      'the reply tells the user exactly what to !register');
    assert.equal(result.registeredWallet, null, 'this account has nothing saved');
  });

  test('is refused before any payout work happens', async () => {
    // The check sits ahead of eligibility, so it cannot reach the treasury,
    // the RPC, or a cooldown reservation. A wrong address costs nothing.
    const result = await claimFaucet({
      discordUserId: NOBODY,
      source: 'discord',
      requestedWallet: UNREGISTERED,
    });
    assert.equal(result.claim, undefined);
    assert.equal(result.eligibility, undefined);
  });

  test('a malformed address is still reported as invalid, not unregistered', async () => {
    const result = await claimFaucet({
      discordUserId: NOBODY,
      source: 'discord',
      requestedWallet: 'obviously-not-base58',
    });
    assert.equal(result.reason, 'invalid_wallet');
  });
});

describe('the rule cannot be sidestepped', () => {
  test('the web adapter still cannot name a wallet at all', async () => {
    await assert.rejects(
      () => claimFaucet({ discordUserId: NOBODY, source: 'web', requestedWallet: UNREGISTERED }),
      /web_source_cannot_specify_wallet/,
    );
  });

  test('source is validated, so no third caller can invent its own rules', async () => {
    await assert.rejects(
      () => claimFaucet({ discordUserId: NOBODY, source: 'api', requestedWallet: UNREGISTERED }),
      /invalid_source/,
    );
  });

  test('a claim with no wallet argument is unaffected by this rule', async () => {
    // It falls through to normal eligibility, which for an unknown account
    // means "no saved wallet" — NOT wallet_not_registered.
    const result = await claimFaucet({ discordUserId: NOBODY, source: 'discord' });
    assert.equal(result.ok, false);
    assert.notEqual(result.reason, 'wallet_not_registered');
  });
});

describe('the guidance matches the rule', () => {
  test('help text no longer advertises sending to a one-off address', async () => {
    const fs = await import('node:fs');
    const inventory = fs.readFileSync(
      new URL('../../src/shared/command-inventory.js', import.meta.url), 'utf8');
    assert.doesNotMatch(inventory, /only needed if it is not your linked wallet/,
      'the old "send somewhere else" guidance must be gone');
    assert.match(inventory, /no longer accept/i, 'and replaced by something that says so');
  });

  test('the Discord adapter explains how to fix it', async () => {
    const fs = await import('node:fs');
    const bot = fs.readFileSync(new URL('../../src/faucet/bot.js', import.meta.url), 'utf8');
    assert.match(bot, /case 'wallet_not_registered'/);
    assert.match(bot, /!register \$\{result\.requestedWallet\}/,
      'the reply should hand back a command they can copy');
  });
});
