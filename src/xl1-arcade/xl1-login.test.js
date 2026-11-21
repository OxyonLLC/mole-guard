import test from 'node:test';
import assert from 'node:assert/strict';
import { createXl1Login, makeXl1Balance, normalizeXl1Address, xl1AccountId, xl1WalletOf, isWalletOnlyIdentity, isCanonicalJwtSignature } from './xl1-login.js';
import { discordIdForXl1Wallet } from './verified-wallet.js';
import { ArcadeRewardService, MemoryArcadeStore, GAME_RULES } from './reward-engine.js';
import { getArcadeConfig } from './config.js';

const A = 'ab'.repeat(20);
const SIG = 'A'.repeat(85) + 'A'; // canonical 64-byte base64url signature segment
const tokenFor = claims => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${SIG}`;
// Stand-in for the SDK's Account.verifyJwt: the payload is whatever the test signs. The real SDK path is exercised
// against real signatures in the owner's workspace (see the PR); here we test every rule this module adds on top.
const fakeAccount = { verifyJwt: async (token, { audience, now }) => {
  const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return p.__bad ? { ok: false } : { ok: true, header: { alg: 'ES256K', typ: 'JWT', kid: p.iss }, payload: { aud: audience, iat: now, exp: now + 300, ...p } };
} };

function setup() {
  let t = Date.UTC(2026, 10, 21, 20);
  const login = createXl1Login({ audience: 'https://winlew.co/xl1/login', loadAccount: async () => fakeAccount, now: () => t });
  const sign = (ch, extra = {}) => tokenFor({ ...ch.signingOptions.claims, schema: 'network.xyo.auth.signin', iss: ch.address, origin: 'https://winlew.co', ...extra });
  return { login, sign, advance: ms => { t += ms; } };
}

test('addresses and wallet-only ids', () => {
  assert.equal(normalizeXl1Address('0x' + A.toUpperCase()), A);
  assert.equal(normalizeXl1Address('not an address'), null);
  assert.equal(xl1AccountId(A), `xl1:${A}`); assert.equal(xl1WalletOf(`xl1:${A}`), A);
  assert.equal(isWalletOnlyIdentity('123456789012345678'), false); assert.equal(isWalletOnlyIdentity(`wallet:${'c'.repeat(32)}`), false);
  assert.equal(isCanonicalJwtSignature(`a.b.${SIG}`), true); assert.equal(isCanonicalJwtSignature(`a.b.${SIG}x`), false);
});

test('a correct signature signs in once; replay, wrong wallet, other site, expiry and tampering are refused', async () => {
  const { login, sign, advance } = setup();
  const ch = login.start(A);
  assert.equal(ch.signingOptions.audience, 'https://winlew.co/xl1/login'); assert.equal(ch.signingOptions.claims.address, A);
  const ok = await login.complete({ challengeId: ch.challengeId, token: sign(ch) });
  assert.equal(ok.address, A); assert.match(ok.proofHash, /^[a-f0-9]{64}$/);
  await assert.rejects(login.complete({ challengeId: ch.challengeId, token: sign(ch) }), /xl1_login_expired/, 'one-time');
  const c2 = login.start(A);
  await assert.rejects(login.complete({ challengeId: c2.challengeId, token: sign(c2, { iss: 'cd'.repeat(20) }) }), /xl1_signature_mismatch/, 'another wallet');
  const c3 = login.start(A);
  await assert.rejects(login.complete({ challengeId: c3.challengeId, token: sign(c3, { origin: 'https://phish.example' }) }), /xl1_signature_mismatch/, 'signed on another site');
  const c4 = login.start(A);
  await assert.rejects(login.complete({ challengeId: c4.challengeId, token: sign(c4, { nonce: 'x' }) }), /xl1_signature_mismatch/, 'claims must match');
  const c5 = login.start(A);
  await assert.rejects(login.complete({ challengeId: c5.challengeId, token: sign(c5, { __bad: true }) }), /xl1_signature_invalid/, 'SDK says invalid');
  const c6 = login.start(A); advance(301_000);
  await assert.rejects(login.complete({ challengeId: c6.challengeId, token: sign(c6) }), /xl1_login_expired/, '5-minute challenge');
  const c7 = login.start(A);
  await assert.rejects(login.complete({ challengeId: c7.challengeId, token: 'a.b.c' }), /xl1_signature_invalid/, 'non-canonical signature');
  assert.throws(() => login.start('nope'), /xl1_address_invalid/);
});

test('a wallet already verified to Discord through GeoHackers signs into that Discord account', () => {
  const db = { users: {
    '175928847299117063': { discordUserId: '175928847299117063', verificationMethod: 'xl1-jwt', updatedAt: '2026-10-01T00:00:00Z', xl1: { ownershipVerified: true, xl1Address: A } },
    '275928847299117063': { discordUserId: '275928847299117063', updatedAt: '2026-11-01T00:00:00Z', xl1: { mode: 'typed', xl1Address: 'ef'.repeat(20) } },
  } };
  assert.equal(discordIdForXl1Wallet(db, '0x' + A), '175928847299117063');
  assert.equal(discordIdForXl1Wallet(db, 'ef'.repeat(20)), null, 'a typed (unsigned) address never links');
  assert.equal(discordIdForXl1Wallet(db, '12'.repeat(20)), null);
});

test('balance reader parses the XL1 RPC answer', async () => {
  const fetchImpl = async (_u, o) => ({ ok: true, json: async () => ({ result: [{ [JSON.parse(o.body).params[0][0]]: '8ac7230489e80000' }, { head: 'x' }] }) });
  assert.equal(await makeXl1Balance({ rpcUrl: 'https://rpc.example', fetchImpl })(A), 10n ** 19n); // 10 XL1
  await assert.rejects(makeXl1Balance({ rpcUrl: 'https://rpc.example', fetchImpl: async () => ({ ok: false }) })(A), /xl1_balance_unavailable/);
});

// The arcade side: wallet-only tier (owner-approved: 5 XL1/day, 10 XL1 held to cash out), Discord players unchanged.
function arcade({ balanceAtto = 0n } = {}) {
  let now = new Date('2026-11-21T12:00:00Z'), seq = 0;
  const service = new ArcadeRewardService({ store: new MemoryArcadeStore(), now: () => now, id: () => `s${++seq}`,
    config: getArcadeConfig({ XL1_REWARD_MODE: 'dry-run', XL1_REWARD_PER_POINT: '0.05', XL1_DAILY_REWARD_CAP: '20' }), // Discord age rule ON (30 days)
    walletBalance: async () => balanceAtto });
  const earn = async (identityId, wallet, seconds) => {
    const s = await service.start({ identityId, wallet, game: 'diglew' }); now = new Date(now.getTime() + seconds * 1000);
    return service.complete({ identityId, sessionId: s._id, nonce: s.nonce, rawScore: Math.ceil(seconds * GAME_RULES.diglew.minScorePerSecond * 2) });
  };
  return { service, earn, advance: ms => { now = new Date(now.getTime() + ms); } };
}

test('wallet-only players can play without Discord, at the 5 XL1 daily cap', async () => {
  const { service, earn } = arcade();
  const id = `xl1:${A}`;
  const r1 = await earn(id, A, 300); // 300 s x 0.05 = 15 XL1 requested
  assert.equal(r1.actualXl1, '5', 'capped at 5 XL1 for wallet-only');
  const s = await service.summary(id);
  assert.equal(s.tier, 'wallet'); assert.equal(s.dailyCapXl1, '5'); assert.equal(s.minBalanceXl1, '10');
  await assert.rejects(service.start({ identityId: String((BigInt(Date.UTC(2026, 10, 19)) - 1420070400000n) << 22n), wallet: A, game: 'diglew' }), /discord_account_too_new/,
    'the Discord-age rule still applies to brand-new Discord accounts');
  assert.equal(service.publicConfig().walletOnlyDailyCap, '5');
});

test('wallet-only cash-out needs 10 XL1 held in the wallet; Discord players are not asked', async () => {
  const poor = arcade({ balanceAtto: 9n * 10n ** 18n });
  await poor.earn(`xl1:${A}`, A, 60); poor.advance(25 * 3600_000);
  await assert.rejects(poor.service.cashout(`xl1:${A}`, { wallet: A }), /xl1_balance_below_minimum/);
  const ok = arcade({ balanceAtto: 10n * 10n ** 18n });
  await ok.earn(`xl1:${A}`, A, 60); ok.advance(25 * 3600_000);
  assert.equal((await ok.service.cashout(`xl1:${A}`, { wallet: A })).status, 'SIMULATED');
  const down = new ArcadeRewardService({ store: new MemoryArcadeStore(), config: getArcadeConfig({ XL1_REWARD_MODE: 'dry-run', XL1_MIN_DISCORD_AGE_DAYS: '0' }),
    walletBalance: async () => { throw new Error('rpc down'); } });
  const s = await down.start({ identityId: `xl1:${A}`, wallet: A, game: 'diglew' });
  assert.ok(s, 'an RPC outage never blocks playing, only the cash-out check');
});
