// Reusable real-backend fixture. No bot/worker entry, real env or member data.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
export async function startLocalStaging(t, { funded = false } = {}) {
  assert.equal(process.env.WINLEW_TEST_ISOLATED, '1');
  assert.equal(process.env.MONGO_ENABLED, 'false');
  assert.match(process.env.NODE_OPTIONS || '', /isolation-guard/);
  const evidence = { rpc: {}, unexpectedRpc: [], requests: [] };
  const accounts = ['A', 'B'].map((name, i) => {
    const key = nacl.sign.keyPair.fromSeed(createHash('sha256').update('integration-fixture-only:' + name).digest());
    return { name: 'Synthetic ' + name, id: String(900000000000000910n + BigInt(i)), key, wallet: bs58.encode(key.publicKey) };
  });
  const rpc = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const request = JSON.parse(text);
    const allowed = ['getAccountInfo', 'getBalance', 'getTokenAccountsByOwner', 'getSignaturesForAddress'];
    if (!allowed.includes(request.method)) evidence.unexpectedRpc.push(request.method);
    evidence.rpc[request.method] = (evidence.rpc[request.method] || 0) + 1;
    let result = request.method === 'getSignaturesForAddress' ? [] : { context: { slot: 1 },
      value: request.method === 'getBalance' ? 0 : request.method === 'getAccountInfo' ? null : [] };
    if (funded && request.method === 'getAccountInfo' && request.params?.[0] === process.env.WINLEW_MINT) {
      const mint = Buffer.alloc(82); mint.writeBigUInt64LE(1000000000000n, 36); mint[44] = 6; mint[45] = 1;
      result.value = { data: [mint.toString('base64'), 'base64'], executable: false, lamports: 1000000,
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch: 0 };
    }
    if (funded && request.method === 'getTokenAccountsByOwner') result.value = [{ pubkey: accounts[0].wallet,
      account: { executable: false, lamports: 1000000, rentEpoch: 0, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        data: { program: 'spl-token', space: 165, parsed: { type: 'account', info: { mint: process.env.WINLEW_MINT,
          owner: request.params[0], tokenAmount: { amount: '10000000', decimals: 6, uiAmount: 10, uiAmountString: '10' } } } } } }];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  let server;
  t.after(async () => {
    for (const listener of [server, rpc]) if (listener?.listening) await new Promise(resolve => {
      listener.close(resolve); listener.closeAllConnections();
    });
    assert.deepEqual(evidence.unexpectedRpc, []);
  });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  process.env.SOLANA_RPC = process.env.RPC_URL = `http://127.0.0.1:${rpc.address().port}`;
  process.env.WEB_HOST = process.env.HOST = '127.0.0.1';
  process.env.PORT = '18789'; process.env.PUBLIC_BASE_URL = 'http://127.0.0.1';
  if (funded) process.env.BOT_KEYPAIR_PATH = 'synthetic-never-read-treasury-sentinel.json';
  const { issueChallenge, completeLink } = await import('../../src/mole/walletLink.js');
  const { createSession } = await import('../../src/mole/sessions.js');
  const { saveProfilePrefs } = await import('../../src/mole/profilePrefs.js');
  for (const account of accounts) {
    const challenge = issueChallenge(account.id);
    const signature = JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), account.key.secretKey)));
    completeLink({ discordUserId: account.id, wallet: account.wallet, message: challenge.message, signature });
    saveProfilePrefs({ discordUserId: account.id, wallet: account.wallet, displayName: account.name });
    account.session = createSession(account.id, 3600);
  }
  const { startWeb } = await import('../../src/mole/web.js');
  const listen = http.Server.prototype.listen;
  const capture = t.mock.method(http.Server.prototype, 'listen', function (_port, host, callback) {
    assert.equal(host, '127.0.0.1'); server = this; return listen.call(this, 0, host, callback);
  });
  try { await startWeb(); } finally { capture.mock.restore(); }
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, body, session) {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (session) headers['x-winlew-session'] = session;
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    evidence.requests.push({ path: url.split('?')[0], method: body ? 'POST' : 'GET', status: response.status });
    return { status: response.status, data: await response.json() };
  }
  return { base, accounts, evidence, request };
}
