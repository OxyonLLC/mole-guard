// Synthetic HTTP security regressions. Run only through the integrity supervisor.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
assert.equal(process.env.WINLEW_TEST_ISOLATED, '1');
assert.equal(process.env.MONGO_ENABLED, 'false');
assert.equal(process.env.WINLEW_TEST_FILE, 'test/mole/completionSecurity.test.mjs');
const identity = label => {
  const key = nacl.sign.keyPair.fromSeed(createHash('sha256').update(`completion-synthetic:${label}`).digest());
  return { key, wallet: bs58.encode(key.publicKey), id: `completion-${label}` };
};
const A = identity('A'), B = identity('B');
const sign = (message, key) => JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey)));

test('completion security: profile writes, concurrency and public files', async t => {
  const evidence = { http: [], rpc: {}, unexpectedRpc: [] };
  let server;
  const rpc = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const allowed = ['getAccountInfo', 'getBalance', 'getTokenAccountsByOwner', 'getSignaturesForAddress'];
    if (!allowed.includes(request.method)) evidence.unexpectedRpc.push(request.method);
    evidence.rpc[request.method] = (evidence.rpc[request.method] || 0) + 1;
    const result = request.method === 'getSignaturesForAddress' ? [] : { context: { slot: 1 },
      value: request.method === 'getBalance' ? 0 : request.method === 'getAccountInfo' ? null : [] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  t.after(async () => {
    for (const listener of [server, rpc]) if (listener?.listening) await new Promise(resolve => {
      listener.close(resolve); listener.closeAllConnections();
    });
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, 'completion-security-evidence.json'), JSON.stringify(evidence, null, 2));
    assert.deepEqual(evidence.unexpectedRpc, []);
  });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  process.env.SOLANA_RPC = `http://127.0.0.1:${rpc.address().port}`;
  process.env.RPC_URL = process.env.SOLANA_RPC;
  process.env.WEB_HOST = process.env.HOST = '127.0.0.1';
  process.env.PORT = '18788'; process.env.PUBLIC_BASE_URL = 'http://127.0.0.1';
  const { issueChallenge, completeLink } = await import('../../src/mole/walletLink.js');
  const { createSession } = await import('../../src/mole/sessions.js');
  const { saveProfilePrefs, getProfilePrefsByUser } = await import('../../src/mole/profilePrefs.js');
  const { recordRewardClaim, listRewardClaims, getRewardSummary } = await import('../../src/mole/rewardHistory.js');
  for (const account of [A, B]) {
    const challenge = issueChallenge(account.id);
    completeLink({ discordUserId: account.id, wallet: account.wallet, message: challenge.message, signature: sign(challenge.message, account.key) });
    saveProfilePrefs({ discordUserId: account.id, wallet: account.wallet, displayName: `Synthetic ${account.id}` });
    account.session = createSession(account.id, 3600);
  }
  const { startWeb } = await import('../../src/mole/web.js');
  const listen = http.Server.prototype.listen;
  const listenMock = t.mock.method(http.Server.prototype, 'listen', function (_port, host, cb) {
    assert.equal(host, '127.0.0.1'); server = this; return listen.call(this, 0, host, cb);
  });
  try { await startWeb(); } finally { listenMock.mock.restore(); }
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, body, session) {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (session) headers['x-winlew-session'] = session;
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    evidence.http.push({ path: url, method: body ? 'POST' : 'GET', status: response.status });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  await t.test('session profile writes reject missing, invalid and expired sessions without mutation', async child => {
    const before = getProfilePrefsByUser(A.id);
    for (const session of [undefined, 'invalid']) assert.equal((await request('/api/profile/update', { session, displayName: 'forged', discordUserId: A.id })).status, 401);
    let now = Date.now(); const clock = child.mock.method(Date, 'now', () => now);
    try {
      const expired = createSession(A.id, 1); now += 2000;
      assert.equal((await request('/api/profile/update', { session: expired, displayName: 'forged' })).status, 401);
    } finally { clock.mock.restore(); }
    assert.deepEqual(getProfilePrefsByUser(A.id), before);
  });
  await t.test('session write uses authenticated identity despite forged owner and wallet', async () => {
    const beforeB = getProfilePrefsByUser(B.id);
    const result = await request('/api/profile/update', { session: A.session, discordUserId: B.id,
      wallet: B.wallet, displayName: 'Synthetic owner update', bio: 'Disposable test' }, A.session);
    assert.equal(result.status, 200);
    assert.equal(getProfilePrefsByUser(A.id).displayName, 'Synthetic owner update');
    assert.deepEqual(getProfilePrefsByUser(B.id), beforeB);
  });
  await t.test('signed profile writes bind signer and payload and reject replay', async () => {
    const payload = { wallet: A.wallet, displayName: 'Synthetic signed update', bio: 'Signed disposable fixture', avatarUrl: '' };
    const challenge = await request('/api/profile/challenge', payload);
    assert.equal(challenge.status, 200);
    const before = getProfilePrefsByUser(A.id);
    assert.equal((await request('/api/profile/update-signed', { ...payload, message: challenge.data.message, signature: sign(challenge.data.message, B.key) })).status, 400);
    assert.deepEqual(getProfilePrefsByUser(A.id), before);
    assert.equal((await request('/api/profile/update-signed', { ...payload, bio: 'Altered', message: challenge.data.message, signature: sign(challenge.data.message, A.key) })).status, 400);
    assert.deepEqual(getProfilePrefsByUser(A.id), before);
    const signed = { ...payload, message: challenge.data.message, signature: sign(challenge.data.message, A.key) };
    const result = await request('/api/profile/update-signed', signed);
    assert.equal(result.status, 200);
    assert.equal(getProfilePrefsByUser(A.id).displayName, payload.displayName);
    assert.equal((await request('/api/profile/update-signed', signed)).status, 400);
    const grant = result.data.editGrant;
    assert.equal(typeof grant.token, 'string');
    const beforeB = getProfilePrefsByUser(B.id);
    assert.equal((await request('/api/profile/update-authorized', { wallet: B.wallet, editToken: grant.token, displayName: 'forged' })).status, 400);
    assert.deepEqual(getProfilePrefsByUser(B.id), beforeB);
    assert.equal((await request('/api/profile/update-authorized', { wallet: A.wallet, editToken: grant.token, displayName: 'Synthetic granted update' })).status, 200);
    assert.equal(getProfilePrefsByUser(A.id).displayName, 'Synthetic granted update');
  });
  await t.test('four concurrent reconciliation requests move one row and credit one exact gap', async () => {
    const owner = 'completion-concurrency'; const guest = 'completion-concurrent-guest';
    const session = createSession(owner, 3600);
    assert.equal((await recordRewardClaim({ discordUserId: `guest:${guest}`, game: 'concurrent-fixture', roundKey: 'completion:once', payout: 9, baseReward: 9 })).ok, true);
    const results = await Promise.all(Array.from({ length: 4 }, () => request('/api/rewards/reconcile', { guestId: guest, localTotal: 20 }, session)));
    for (const result of results) assert.equal(result.status, 200);
    assert.equal(results.reduce((sum, result) => sum + result.data.movedRows, 0), 1);
    assert.equal(results.reduce((sum, result) => sum + result.data.migrationCredit, 0), 11);
    const rows = await listRewardClaims(owner, 100);
    assert.equal(rows.length, 2); assert.equal(rows.filter(row => row.game === 'migration').length, 1);
    assert.equal(Number((await getRewardSummary(owner)).totalPayout), 20);
    assert.equal(Number((await getRewardSummary(`guest:${guest}`)).totalPayout), 0);
    assert.equal((await request('/api/rewards/reconcile', { guestId: guest, localTotal: 20 }, session)).data.migrationCredit, 0);
  });
  await t.test('static server denies audit and credential paths while retaining all journey routes', async () => {
    for (const url of ['/.tmp-audit/phase4fr-isolated-verification.mjs', '/%2etmp-audit/PHASE4F-CHECKPOINT.json', '/verify/api-proxy-secret.php', '/xl1/verify/api-proxy-upstream.php', '/log/example.log']) {
      assert.equal((await request(url)).status, 404, url);
    }
    for (const url of ['/', '/play/', '/earn/', '/community-hub/', '/token/', '/proof/', '/build/', '/mole-hub/', '/community/']) assert.equal((await request(url)).status, 200, url);
  });
});
