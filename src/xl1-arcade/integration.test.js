import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseSenderCredential } from './sender.js';
import { verifiedXl1Wallet } from './verified-wallet.js';

const address = '1'.repeat(40);
test('only native XL1 signature records are accepted for the authenticated identity', () => {
  const record = { discordUserId: '123', updatedAt: '2026-09-20T12:00:00Z',
    xl1: { mode: 'wallet-signature', source: 'xl1-wallet-signature', xl1Address: address } };
  assert.equal(verifiedXl1Wallet({ users: { '123': record } }, '123'), address);
  assert.equal(verifiedXl1Wallet({ users: { '123': record } }, '456'), null);
  assert.equal(verifiedXl1Wallet({ users: { '123': { ...record, discordUserId: '456' } } }, '123'), null);
  assert.equal(verifiedXl1Wallet({ users: { '123': { ...record, xl1: { ...record.xl1, source: 'discovery' } } } }, '123'), null);
  assert.equal(verifiedXl1Wallet({ users: { '123': { ...record, xl1: { ...record.xl1, xl1Address: 'typed address' } } } }, '123'), null);
});

test('Oxyon Wallet sign-in records (xl1-jwt / xl1-boundwitness) are accepted only when ownership was proven', () => {
  const record = { discordUserId: '123', updatedAt: '2026-10-17T12:00:00Z', verificationMethod: 'xl1-jwt',
    xl1: { xl1Status: 'found', ownershipVerified: true, checked: true, found: true, xl1Address: address, source: 'xl1-jwt' } };
  const db = r => ({ users: { '123': r } });
  assert.equal(verifiedXl1Wallet(db(record), '123'), address);
  assert.equal(verifiedXl1Wallet(db({ ...record, verificationMethod: 'xl1-boundwitness' }), '123'), address);
  assert.equal(verifiedXl1Wallet(db({ ...record, xl1: { ...record.xl1, ownershipVerified: false } }), '123'), null);
  assert.equal(verifiedXl1Wallet(db({ ...record, verificationMethod: undefined }), '123'), null);
  assert.equal(verifiedXl1Wallet(db({ ...record, verificationMethod: 'discovery' }), '123'), null);
  assert.equal(verifiedXl1Wallet(db({ ...record, discordUserId: '456' }), '123'), null);
});

test('sender assignment is parsed as data and never executed', () => {
  const phrase = Array(12).fill('test').join(' ');
  assert.equal(parseSenderCredential(`XL1_Sender="${phrase}"\n# address`), phrase);
  assert.throws(() => parseSenderCredential('XL1_Sender=process.env.SECRET'), /invalid/);
  assert.throws(() => parseSenderCredential('XL1_Sender="too short"'), /invalid/);
});

async function bridgeHarness(proxy = false, game = 'diglew') {
  const listeners = {};
  const elements = { 'reward-state': { textContent: '' }, 'game-name': {} };
  const requests = [];
  let sequence = 0;
  const win = { Response, location: { href: 'https://example.test/mole-hub/' },
    fetch: async (input, init) => {
      const url = new URL(input, win.location.href);
      const path = url.searchParams.get('path') || url.pathname;
      requests.push({ path, body: init?.body ? JSON.parse(init.body) : null });
      if (path.endsWith('/sessions')) return Response.json({ sessionId: `session-${++sequence}`, nonce: 'nonce' });
      if (path.endsWith('/complete')) return Response.json({ reward: { status: 'SIMULATED', actualXl1: '0.05' } });
      return Response.json({ ok: true });
    },
    WinLEWLaunchDebug: { startGameFromLaunchKey: async () => {} },
  };
  win.WinLEWAuth = { hubApiFetch: (path, init) => win.fetch(proxy ? `/verify/api-proxy.php?path=${encodeURIComponent(path)}` : path, init) };
  elements.game = { contentWindow: win, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const script = await readFile(new URL('../public/xl1/arcade/play/reward-bridge.js', import.meta.url), 'utf8');
  vm.runInNewContext(script, { URL, URLSearchParams, setTimeout, location: { search: `?game=${game}` },
    document: { getElementById: id => elements[id] } });
  await listeners.load();
  const claim = (roundKey, claimGame = game, meta = { score: 250 }) => win.WinLEWAuth.hubApiFetch('/api/rewards/claim', {
    method: 'POST', body: JSON.stringify({ game: claimGame, roundKey, meta }),
  });
  return { claim, requests, elements };
}

for (const proxy of [false, true]) test(`bridge isolates XL1 claims and deduplicates rounds (${proxy ? 'PHP proxy' : 'direct'})`, async () => {
  const h = await bridgeHarness(proxy);
  const [a, b] = await Promise.all([h.claim('round-1'), h.claim('round-1')]);
  assert.equal((await a.json()).xl1Reward.actualXl1, '0.05');
  assert.equal((await b.json()).xl1Reward.actualXl1, '0.05');
  assert.equal(h.requests.filter(r => r.path.endsWith('/complete')).length, 1);
  assert.equal(h.requests.some(r => r.path === '/api/rewards/claim'), false);
  await h.claim('round-2');
  const completions = h.requests.filter(r => r.path.endsWith('/complete'));
  assert.equal(completions.length, 2);
  assert.notEqual(completions[0].path, completions[1].path);
  await h.claim('wrong-game', 'pacmole');
  assert.equal(h.requests.filter(r => r.path.endsWith('/complete')).length, 2);
});

test('Grub Drop remains playable without creating rewards on either ledger', async () => {
  const h = await bridgeHarness(true, 'grubdrop');
  await h.claim('round-1');
  assert.equal(h.requests.length, 0);
});

const completedScores = h => h.requests.filter(r => r.path.endsWith('/complete')).map(r => r.body.rawScore);

test('running totals are scored per round, and a lower total starts a new run', async () => {
  const h = await bridgeHarness(false, 'pacmole');
  for (const [i, score] of [300, 900, 1500, 200, 650].entries()) await h.claim(`level-${i}`, 'pacmole', { score });
  // 300, then +600, +600; 200 is a new run; then +450. Never the whole run again.
  assert.deepEqual(completedScores(h), [300, 600, 600, 200, 450]);
});

test('Mole Ice is scored on each mine, Mole Spades on each match', async () => {
  const ice = await bridgeHarness(false, 'moleice');
  await ice.claim('mine-1', 'moleice', { round: 1, roundScore: 700 });
  await ice.claim('mine-2', 'moleice', { round: 2, roundScore: 1250 });
  const bad = await (await ice.claim('mine-3', 'moleice', { round: 3 })).json();
  assert.deepEqual(completedScores(ice), [700, 1250]);
  assert.equal(bad.error, 'claim_invalid');

  const spades = await bridgeHarness(false, 'molespades');
  await spades.claim('match-1', 'molespades', { won: true, score: 420 });
  await spades.claim('match-2', 'molespades', { won: false, score: 380 });
  assert.deepEqual(completedScores(spades), [420, 380]);
});

test('Root Glide and Burrow Blaster rounds reach the server (they report no score field)', async () => {
  // Before 2026-10-23 both were rejected in the browser: they send no meta.score.
  const glide = await bridgeHarness(false, 'rootglide');
  await glide.claim('round-1', 'rootglide', { round: 1, distance: 440, totalDistance: 440 });
  await glide.claim('round-2', 'rootglide', { round: 2, distance: 320, totalDistance: 760 });
  assert.deepEqual(completedScores(glide), [440, 320]);

  const blaster = await bridgeHarness(false, 'burrowblaster');
  await blaster.claim('round-1', 'burrowblaster', { round: 1, wave: 6, kills: 94 });
  await blaster.claim('round-2', 'burrowblaster', { round: 2, wave: 6, kills: 190 });
  assert.deepEqual(completedScores(blaster), [94, 96]);
});

test('Tunnel Tap, Mole Ice and Mole Spades open in the arcade', async () => {
  for (const game of ['tunneltap', 'moleice', 'molespades']) {
    const h = await bridgeHarness(false, game);
    assert.equal(h.elements['game-name'].textContent, { tunneltap: 'Tunnel Tap', moleice: 'Mole Ice', molespades: 'Mole Spades' }[game])
    assert.equal(h.requests.filter(r => r.path.endsWith('/sessions')).length, 1)
  }
});
