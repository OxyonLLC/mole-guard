// A session id is not necessarily a Discord id, and two stores forgot.
//
// Since the identity layer landed (5270f50 "the wallet is the account",
// fd6095a "sign in with X") a session's account id can be a Discord snowflake,
// `wallet:<hash>` or `x:<hash>`. Both the role-connection push and the faucet
// linkage store are keyed by SNOWFLAKE, and both were handed the raw account
// id. The faucet answered `no_wallet` — "you never registered" — to people who
// had been verified for months, and /verify/ answered `no_oauth_tokens`.
//
// These tests pin the resolver that closes that gap, and the distinction the
// faucet reason codes now draw.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-resolution-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
// The synced-identities store writes through mole storage, which validates the
// whole config on every read. None of these are exercised here.
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
process.env.DISCORD_REDIRECT_URI = 'http://127.0.0.1:8787/discord-oauth-callback';
process.env.WINLEW_MINT = 'So11111111111111111111111111111111111111112';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  discordUserIdForAccount,
  syncIdentity,
  canBePaid,
  IDENTITY_PROVIDERS,
} from '../../src/mole/syncedIdentities.js';
import { ELIGIBILITY_REASONS } from '../../src/faucet/eligibility.js';

describe('discordUserIdForAccount', () => {
  test('a snowflake is its own answer', () => {
    // Every account that predates the identity store IS its Discord id, with
    // no record anywhere. Requiring them to re-sync would have locked out the
    // entire existing community.
    assert.equal(discordUserIdForAccount('248525967377694720'), '248525967377694720');
  });

  test('a wallet-rooted account resolves through its synced Discord identity', () => {
    const accountId = 'wallet:b78d3201498c27e0e86f85243dcd228e';
    syncIdentity({
      accountId,
      provider: IDENTITY_PROVIDERS.DISCORD,
      providerUserId: '123456789012345678',
    });
    assert.equal(discordUserIdForAccount(accountId), '123456789012345678');
  });

  test('a wallet-rooted account with nothing synced resolves to null, not a throw', () => {
    // This is the exact id shape from the reported failure — it appeared on
    // screen inside a field labelled "Discord:".
    assert.equal(discordUserIdForAccount('wallet:0000000000000000000000000000dead'), null);
  });

  test('an X-only account has no Discord id even though it CAN be paid', () => {
    // The two questions are genuinely different, and conflating them is what
    // made the faucet tell an X user to go run a Discord command. canBePaid()
    // asks "is there a person here"; this asks "which Discord person".
    const accountId = 'x:1111111111111111111111111111beef';
    syncIdentity({
      accountId,
      provider: IDENTITY_PROVIDERS.X,
      providerUserId: '4400',
      handle: 'someone',
    });
    assert.equal(canBePaid(accountId), true);
    assert.equal(discordUserIdForAccount(accountId), null);
  });

  test('empty and junk ids resolve to null rather than throwing', () => {
    // This runs on the payout-adjacent path; a throw here would be an outage.
    for (const bad of ['', null, undefined, '   ', 'wallet:']) {
      assert.equal(discordUserIdForAccount(bad), null);
    }
  });
});

describe('the faucet linkage store is account-keyed', () => {
  // The near-miss this suite exists to prevent. completeLink() writes under the
  // SESSION id, so a wallet- or X-rooted account that verified a wallet on the
  // site is filed under `wallet:<hash>` / `x:<hash>` — and live data already
  // contains such keys. A faucet lookup that resolved to a Discord snowflake
  // and stopped would tell those people to attach Discord while their wallet
  // sat in the store under the id it had just been handed.
  test('getLinkedWallet accepts a non-snowflake account key', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const wallets = require('../../src/quiz/wallets.js');
    // A plain string lookup — no snowflake validation anywhere in it. If this
    // ever grows one, the account-keyed records become unreachable.
    const src = await fs.promises.readFile(
      path.resolve('src/quiz/wallets.js'), 'utf8',
    );
    assert.ok(
      typeof wallets.getLinkedWallet === 'function',
      'getLinkedWallet must stay the shared reader',
    );
    assert.ok(
      !/isDiscordId|isDiscordSnowflake|\\d\{5,25\}/.test(src),
      'wallets.js has grown a snowflake guard, which would orphan account-keyed links',
    );
  });

  test('web.js resolves the faucet lookup id account-first, not Discord-only', async () => {
    const webJs = await fs.promises.readFile(path.resolve('src/mole/web.js'), 'utf8');
    assert.ok(
      webJs.includes('function faucetLookupId('),
      'the faucet routes must go through faucetLookupId()',
    );
    // Both faucet routes, and neither of them calling the Discord-only
    // resolver directly.
    assert.equal(
      (webJs.match(/faucetLookupId\(s\.discordUserId\)/g) || []).length, 2,
      'both /api/faucet/status and /api/faucet/claim must use faucetLookupId()',
    );
  });
});

describe('faucet reason codes', () => {
  test('needs_discord_link is distinct from no_wallet', () => {
    // They mean different things and must never collapse: no_wallet is "this
    // Discord account has no wallet", needs_discord_link is "we could not work
    // out which Discord account you are". Only the first justifies telling
    // someone to register a wallet.
    assert.equal(ELIGIBILITY_REASONS.NEEDS_DISCORD_LINK, 'needs_discord_link');
    assert.notEqual(ELIGIBILITY_REASONS.NEEDS_DISCORD_LINK, ELIGIBILITY_REASONS.NO_WALLET);
  });

  test('every reason that falls through to REASON_COPY has an entry', async () => {
    // A reason code with no entry renders as a bare
    // "Not eligible right now (needs_discord_link)", which is worse than the
    // wrong message it replaced.
    //
    // `cooldown` and `below_holder_minimum` are excluded because they are
    // handled by dedicated branches ABOVE the REASON_COPY lookup (they need
    // a countdown and a buy-links block respectively), so they legitimately
    // have no entry in the map.
    const HANDLED_EARLIER = new Set(['cooldown', 'below_holder_minimum']);
    const appJs = await fs.promises.readFile(
      path.resolve('src/public/faucet/js/app.js'), 'utf8',
    );
    for (const reason of Object.values(ELIGIBILITY_REASONS)) {
      if (HANDLED_EARLIER.has(reason)) {
        assert.ok(appJs.includes(`reason === '${reason}'`), `"${reason}" claims a dedicated branch but has none`);
        continue;
      }
      assert.ok(
        appJs.includes(`${reason}:`),
        `REASON_COPY is missing an entry for "${reason}"`,
      );
    }
  });

  test('the faucet no longer cites a /verify slash command that does not exist', async () => {
    // The only registered slash commands are /mole and /game. "/verify" is a
    // website path, and the old copy sent people hunting through Discord for a
    // command that has never existed.
    const appJs = await fs.promises.readFile(
      path.resolve('src/public/faucet/js/app.js'), 'utf8',
    );
    assert.ok(!appJs.includes('<code>/verify</code>'), 'faucet copy still advertises a /verify slash command');
  });
});
