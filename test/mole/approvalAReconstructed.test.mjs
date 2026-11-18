// Phase 4F-S2: independently reconstructed behaviors, not a historical manifest.
// Run ONLY through: node tools/test-audit/run.cjs C
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

assert.equal(process.env.WINLEW_TEST_ISOLATED, '1');
assert.equal(process.env.WINLEW_TEST_FILE, 'test/mole/approvalAReconstructed.test.mjs');
assert.match(process.env.NODE_OPTIONS || '', /isolation-guard\.cjs/);
assert.equal(process.env.MONGO_ENABLED, 'false');
assert.equal(process.env.MONGO_URI, '');

// These publicly reproducible keys are synthetic message-signing fixtures only.
// They must NEVER be funded, used on-chain, or used to sign transactions.
const key = label => nacl.sign.keyPair.fromSeed(createHash('sha256').update(`S2-test-only:${label}`).digest());
const A = { id: '900000000000000901', name: 'Synthetic A', key: key('A') };
const B = { id: '900000000000000902', name: 'Synthetic B', key: key('B') };
for (const account of [A, B]) account.wallet = bs58.encode(account.key.publicKey);
const mint = bs58.encode(key('mint').publicKey);
const guestA = 's2-guest-alpha';
const guestB = 's2-guest-bravo';
const guestC = 's2-guest-charlie';
const signature = (message, signer) => JSON.stringify(Array.from(
  nacl.sign.detached(new TextEncoder().encode(message), signer.secretKey),
));

test('Approval A reconstructed HTTP behaviors (synthetic, isolated)', async t => {
  const evidence = { version: 1, reconstructed: true, http: [], rpc: {}, unexpectedRpc: [], behaviors: [] };
  let appServer;
  let base;
  // Real localhost HTTP, deterministic read-only JSON-RPC responses. No proxy,
  // no external fallback, no transaction methods, and no production identities.
  const rpc = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let request;
    try { request = JSON.parse(body); } catch { request = {}; }
    const { method, params = [], id } = request;
    const walletMethods = ['getBalance', 'getTokenAccountsByOwner', 'getSignaturesForAddress'];
    const allowed = req.method === 'POST' && req.url === '/' && request.jsonrpc === '2.0'
      && (walletMethods.includes(method) || method === 'getAccountInfo')
      && (!walletMethods.includes(method) || [A.wallet, B.wallet].includes(params[0]))
      && (method !== 'getTokenAccountsByOwner' || params[1]?.mint === mint);
    res.setHeader('content-type', 'application/json');
    if (!allowed) {
      // Record method only, never request bodies, signatures or credentials.
      evidence.unexpectedRpc.push(String(method || 'invalid-request'));
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unreviewed fixture request' } }));
      return;
    }
    evidence.rpc[method] = (evidence.rpc[method] || 0) + 1;
    const result = method === 'getSignaturesForAddress' ? [] : {
      context: { slot: 1 },
      value: method === 'getBalance' ? 0 : method === 'getAccountInfo' ? null : [],
    };
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
  t.after(async () => {
    // Always close test-owned servers; do not force exit or suppress timers.
    for (const server of [appServer, rpc]) {
      if (!server?.listening) continue;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, 'approval-a-evidence.json'), JSON.stringify(evidence, null, 2));
    assert.deepEqual(evidence.unexpectedRpc, [], 'only reviewed read-only RPC methods requested');
  });
  rpc.listen(0, '127.0.0.1');
  await once(rpc, 'listening');
  process.env.SOLANA_RPC = `http://127.0.0.1:${rpc.address().port}`;
  process.env.RPC_URL = process.env.SOLANA_RPC;
  process.env.WINLEW_MINT = mint;
  process.env.WEB_HOST = '127.0.0.1';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '18787'; // schema requires positive port; listener uses OS-assigned port below
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1';

  // Every application import occurs AFTER the supervisor's guard preload and
  // explicit fixture environment. No dotenv and no production fingerprinting.
  const { issueChallenge, completeLink } = await import('../../src/mole/walletLink.js');
  const { createSession, getSession } = await import('../../src/mole/sessions.js');
  const { saveProfilePrefs } = await import('../../src/mole/profilePrefs.js');
  const { recordRewardClaim, getRewardSummary, listRewardClaims } = await import('../../src/mole/rewardHistory.js');
  const { startWeb } = await import('../../src/mole/web.js');
  for (const account of [A, B]) {
    const challenge = issueChallenge(account.id);
    assert.equal(completeLink({ discordUserId: account.id, wallet: account.wallet,
      message: challenge.message, signature: signature(challenge.message, account.key) }), account.wallet);
    saveProfilePrefs({ discordUserId: account.id, wallet: account.wallet, displayName: account.name });
  }
  for (const [owner, game, payout] of [[A.id, 'alpha', 11], [B.id, 'beta', 22],
    [`guest:${guestA}`, 'guest-alpha', 7], [`guest:${guestB}`, 'guest-bravo', 13], [`guest:${guestC}`, 'guest-charlie', 5]]) {
    assert.equal((await recordRewardClaim({ discordUserId: owner, app: 'mole', game,
      roundKey: `fixture:${game}`, baseReward: payout, payout, claimedAt: '2026-01-01T00:00:00.000Z' })).ok, true);
  }

  // startWeb has no server-return API. This scoped test-only interception
  // captures the real server and asks the OS for a free loopback port. Routes,
  // auth, rate limits, storage, session and reward implementations stay real.
  const listen = http.Server.prototype.listen;
  const listenMock = t.mock.method(http.Server.prototype, 'listen', function (port, host, callback) {
    assert.equal(port, 18787);
    assert.equal(host, '127.0.0.1');
    assert.equal(appServer, undefined);
    appServer = this;
    return listen.call(this, 0, host, callback);
  });
  try { await startWeb(); } finally { listenMock.mock.restore(); }
  assert.ok(appServer);
  if (!appServer.listening) await once(appServer, 'listening');
  base = `http://127.0.0.1:${appServer.address().port}`;

  async function request(url, { session, method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' };
    if (session) headers['x-winlew-session'] = session;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${url}`, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    evidence.http.push({ path: url.split('?')[0], method, status: response.status });
    return { status: response.status, data: await response.json() };
  }
  const post = (url, body, session) => request(url, { method: 'POST', body, session });
  const challengeFor = async account => {
    const response = await post('/api/hub/wallet-login/challenge', { wallet: account.wallet });
    assert.equal(response.status, 200);
    assert.equal(typeof response.data.message, 'string');
    return response.data.message;
  };
  const login = body => post('/api/hub/wallet-login', body);
  async function check(name, fn) {
    await t.test(name, async child => { await fn(child); evidence.behaviors.push(name); });
  }
  const total = async owner => Number((await getRewardSummary(owner)).totalPayout);
  const games = response => response.data.history.map(row => row.game);
  const reconcile = (guestId, localTotal, session, extra = {}) => post('/api/rewards/reconcile', { guestId, localTotal, ...extra }, session);
  let usedLogin;

  await check('auth: real Ed25519 login binds synthetic A and B to distinct sessions', async () => {
    for (const account of [A, B]) {
      const message = await challengeFor(account);
      const body = { wallet: account.wallet, message, signature: signature(message, account.key) };
      const response = await login(body);
      assert.equal(response.status, 200);
      assert.equal(response.data.ok, true);
      assert.equal(response.data.discordUserId, account.id);
      account.session = response.data.session;
      assert.equal(getSession(account.session)?.discordUserId, account.id);
      if (account === A) usedLogin = body;
    }
    assert.notEqual(A.session, B.session);
  });
  // Dependent HTTP assertions must never silently fall back to anonymous mode.
  assert.ok(A.session && B.session, 'both real login sessions are required');
  await check('auth: replay of consumed signed challenge is rejected', async () => {
    const response = await login(usedLogin);
    assert.equal(response.status, 400);
    assert.equal(response.data.error, 'challenge_used');
    assert.equal(response.data.session, undefined);
  });
  await check('auth: wrong signer is rejected without consuming valid challenge', async () => {
    const message = await challengeFor(B);
    const response = await login({ wallet: B.wallet, message, signature: signature(message, A.key) });
    assert.equal(response.status, 400);
    assert.equal(response.data.error, 'bad_signature');
    assert.equal(response.data.session, undefined);
    assert.equal((await login({ wallet: B.wallet, message, signature: signature(message, B.key) })).status, 200);
  });
  await check('auth: altered message with original signature is rejected', async () => {
    const message = await challengeFor(A);
    const response = await login({ wallet: A.wallet, message: `${message}\nAltered content`, signature: signature(message, A.key) });
    assert.equal(response.status, 400);
    assert.equal(response.data.error, 'bad_signature');
    assert.equal(response.data.session, undefined);
  });
  await check('auth: malformed signature length is rejected', async () => {
    const message = await challengeFor(A);
    const response = await login({ wallet: A.wallet, message,
      signature: JSON.stringify(Array.from(new Uint8Array(32))) });
    assert.equal(response.status, 400);
    assert.equal(response.data.error, 'bad_signature_size:32');
  });
  await check('profile: A and B see only their own authenticated profile despite forged selectors', async () => {
    for (const [account, other] of [[A, B], [B, A]]) {
      const response = await request(`/api/profile/me?accountId=${other.id}&discordUserId=${other.id}&wallet=${other.wallet}`, { session: account.session });
      assert.equal(response.status, 200);
      assert.equal(response.data.profile.discordUserId, account.id);
      assert.equal(response.data.profile.displayName, account.name);
      assert.doesNotMatch(JSON.stringify(response.data), new RegExp(other.name));
      assert.deepEqual(response.data.games.history.map(row => row.game), [account === A ? 'alpha' : 'beta']);
    }
  });
  await check('profile: missing and invalid sessions cannot access profile/me', async () => {
    for (const session of [undefined, 'invalid-synthetic-session']) {
      const response = await request('/api/profile/me', { session });
      assert.equal(response.status, 401);
      assert.equal(response.data.profile, undefined);
    }
  });
  await check('profile: wallet owner receives private view; other account receives public projection', async () => {
    const owner = await request(`/api/profile/by-wallet?wallet=${A.wallet}`, { session: A.session });
    const other = await request(`/api/profile/by-wallet?wallet=${A.wallet}`, { session: B.session });
    assert.equal(owner.status, 200);
    assert.equal(owner.data.profile.discordUserId, A.id);
    assert.equal(other.status, 200);
    assert.equal(other.data.publicView, true);
    assert.equal(other.data.profile.discordUserId, undefined);
    assert.equal(other.data.profile.editable, false);
    assert.deepEqual(other.data.wallets.knownWallets, []);
    assert.equal(other.data.recentActivity, undefined);
    // Public game preview is existing behavior, NOT a claim of full history secrecy.
  });
  await check('history: private A/B histories ignore forged account and guest selectors', async () => {
    for (const [account, other, expected] of [[A, B, 'alpha'], [B, A, 'beta']]) {
      const response = await request(`/api/rewards/history?accountId=${other.id}&discordUserId=${other.id}&guest=${guestB}`, { session: account.session });
      assert.equal(response.status, 200);
      assert.deepEqual(games(response), [expected]);
    }
    assert.equal((await request('/api/rewards/history')).status, 401);
  });
  await check('history: guest A/B namespaces are separate from each other and member IDs', async () => {
    for (const [guest, expected] of [[guestA, ['guest-alpha']], [guestB, ['guest-bravo']], [A.id, []], ['s2-unknown-guest', []]]) {
      const response = await request(`/api/rewards/history?guest=${guest}`);
      assert.equal(response.status, 200);
      assert.deepEqual(games(response), expected);
    }
    assert.equal((await request(`/api/rewards/history?guest=guest:${guestA}`)).status, 401);
  });
  await check('session: expiration rejects both profile and history using controlled clock', async child => {
    let now = Date.now();
    const clock = child.mock.method(Date, 'now', () => now);
    try {
      const session = createSession(A.id, 60);
      assert.equal(getSession(session)?.discordUserId, A.id);
      assert.equal((await request('/api/profile/me', { session })).status, 200);
      now += 61000; // production expiry comparison is strictly less than now
      assert.equal(getSession(session), null);
      assert.equal((await request('/api/profile/me', { session })).status, 401);
      assert.equal((await request('/api/rewards/history', { session })).status, 401);
      assert.equal(getSession(B.session)?.discordUserId, B.id);
    } finally { clock.mock.restore(); }
  });
  await check('session: HTTP logout revokes server session and repeat logout is harmless', async () => {
    const session = createSession(B.id, 600);
    assert.equal(getSession(session)?.discordUserId, B.id);
    assert.equal((await post('/api/session/logout', {}, session)).status, 200);
    assert.equal(getSession(session), null);
    assert.equal((await request('/api/profile/me', { session })).status, 401);
    assert.equal((await request('/api/rewards/history', { session })).status, 401);
    assert.equal((await post('/api/session/logout', {}, session)).status, 200);
    assert.equal(getSession(A.session)?.discordUserId, A.id);
  });
  await check('reconcile: unauthenticated and invalid-guest requests leave accounting unchanged', async () => {
    const owners = [A.id, B.id, `guest:${guestA}`, `guest:${guestB}`];
    const before = await Promise.all(owners.map(total));
    assert.equal((await reconcile(guestA, 10000)).status, 401);
    assert.equal((await reconcile('invalid:guest', 10000, A.session)).status, 400);
    assert.deepEqual(await Promise.all(owners.map(total)), before);
  });
  await check('reconcile: authoritative session, capped credit and repeat POST preserve exact totals', async () => {
    const first = await reconcile(guestA, 10000, A.session, { accountId: B.id, discordUserId: B.id });
    assert.equal(first.status, 200);
    assert.deepEqual(first.data, { ok: true, movedRows: 1, migrationCredit: 4500, total: 4518 });
    const second = await reconcile(guestA, 10000, A.session);
    assert.equal(second.status, 200);
    assert.deepEqual(second.data, { ok: true, movedRows: 0, migrationCredit: 0, total: 4518 });
    assert.equal(await total(`guest:${guestA}`), 0);
    assert.equal(await total(B.id), 22);
    assert.equal(await total(`guest:${guestB}`), 13);
    const rows = await listRewardClaims(A.id, 100);
    assert.equal(rows.length, 3);
    assert.equal(rows.reduce((sum, row) => sum + row.payout, 0), 4518);
    assert.equal(rows.filter(row => row.game === 'migration').length, 1);
    assert.equal(rows.find(row => row.game === 'migration').roundKey, 'migrate:legacy-local');
  });
  await check('reconcile: another guest moves real fixture rows but cannot mint a second credit', async () => {
    const response = await reconcile(guestC, 10000, A.session);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { ok: true, movedRows: 1, migrationCredit: 0, total: 4523 });
    assert.equal(await total(`guest:${guestC}`), 0);
    assert.equal((await listRewardClaims(A.id, 100)).filter(row => row.game === 'migration').length, 1);
  });
  await check('reconcile: below-cap gap is exact and independently deduplicated for B', async () => {
    const first = await reconcile(guestB, 20, B.session);
    assert.equal(first.status, 200);
    assert.deepEqual(first.data, { ok: true, movedRows: 1, migrationCredit: 7, total: 42 });
    const second = await reconcile(guestB, 20, B.session);
    assert.equal(second.status, 200);
    assert.deepEqual(second.data, { ok: true, movedRows: 0, migrationCredit: 0, total: 42 });
    assert.equal(await total(A.id), 4523);
    assert.equal(await total(`guest:${guestB}`), 0);
    const history = await request('/api/rewards/history', { session: B.session });
    assert.equal(history.status, 200);
    assert.equal(history.data.history.reduce((sum, row) => sum + row.payout, 0), 42);
  });
  await check('fixtures: profiles used reviewed localhost read-only RPC and Mongo stayed disabled', async () => {
    assert.deepEqual(evidence.unexpectedRpc, []);
    assert.ok(evidence.rpc.getTokenAccountsByOwner > 0);
    assert.ok(evidence.rpc.getBalance > 0);
    assert.ok(evidence.rpc.getSignaturesForAddress > 0);
    assert.equal(process.env.MONGO_ENABLED, 'false');
    assert.equal(process.env.MONGO_URI, '');
  });
});
