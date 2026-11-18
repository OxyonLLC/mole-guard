// Browser driver inherits the guard. Browsers are explicit supervisor-owned
// tools connected over loopback; no guarded subprocess exception is granted.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { once } from 'node:events';
import { chromium, firefox, webkit } from 'playwright';
import { isPublicRequestPath } from '../../src/mole/publicFiles.js';
assert.equal(process.env.WINLEW_TEST_ISOLATED, '1');
const publicRoot = path.resolve('src/public');
const output = path.join(process.env.WINLEW_TEST_ROOT, 'browser-evidence');
fs.mkdirSync(output, { recursive: true });
const routes = ['/', '/play/', '/earn/', '/community-hub/', '/token/', '/proof/', '/build/'];
const games = ['diglew', 'pacmole', 'rootglide', 'burrowblaster', 'tunneltap', 'grubdrop', 'molespades', 'moleice'];
const state = { summary: 'live', account: 'guest', data: 'empty' };
const now = new Date().toISOString();
const fixture = () => {
  const item = fields => ({ state: state.summary === 'stale' ? 'stale' : 'live', sourceAt: now, ...fields });
  return { ok: true, schemaVersion: 1, items: {
    price: item({ priceUsd: .00012, liquidityUsd: 12000 }), burn: item({ percentOfTarget: 4 }),
    transparency: item({ circulatingSupplyOk: true, circulatingDisplay: 120000000 }),
    modules: item({ visibleCount: 8, liveCount: 5 }), quiz: item({ cycleEndMs: Date.now() + 60000 }),
    faucet: item({ totalConfirmedCount: 123 }), governance: item({ proposalCount: 1, activeCount: 0 }),
    events: item({ liveCount: 0, upcomingCount: 1 }), health: item({ reachableCount: 4, totalCount: 5 }),
  } };
};
const evidence = { browsers: [], unexpectedRequests: [], assetFailures: [], summaryRequests: 0, postRequests: 0, fixtureReconcileResponses: 0 };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET' && req.method !== 'HEAD') { evidence.postRequests++; res.writeHead(405); res.end(); return; }
  let api = url.pathname === '/verify/api-proxy.php' ? url.searchParams.get('path') : url.pathname;
  const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (api?.startsWith('/api/')) {
    if (state.data === 'error') return json(503, { error: 'synthetic_unavailable' });
    if (api === '/api/governance/proposals') return json(200, { ok: true, proposals: [], config: { minWinlewToVote: 1, minWinlewToPurchaseVotes: 1000000 } });
    if (api === '/api/quiz/leaderboard' || api === '/api/quiz/leaderboard/platform') return json(200, { entries: [] });
    if (api === '/api/faucet/history') return json(200, { claims: [], history: [] });
    if (api === '/api/transparency/status') return json(200, { ok: true, mint: { supply: 1000, decimals: 6, mintAuthority: null, freezeAuthority: null }, components: [] });
    if (api === '/api/faucet/status') return state.account === 'connected'
      ? json(200, { faucet: { amount: 1, tokenSymbol: 'synthetic', cooldownHours: 24 }, eligibility: { eligible: false, reason: 'cooldown' }, cooldown: { readyInMs: 60000 } })
      : json(401, { error: 'session_expired' });

    if (api === '/api/homepage/summary') {
      evidence.summaryRequests++;
      if (state.summary === 'unavailable') return json(503, { error: 'fixture_unavailable' });
      if (state.summary === 'malformed') return json(200, { ok: true, schemaVersion: 8 });
      const value = fixture();
      if (state.summary === 'partial') value.items.events = { state: 'unavailable' };
      return json(200, value);
    }
    if (api === '/api/profile/me') {
      if (state.account === 'unavailable') return json(503, { error: 'fixture_unavailable' });
      return state.account === 'connected' ? json(200, {
        profile: { displayName: req.headers['x-winlew-session'] === 'synthetic-ui-B' ? 'Synthetic B' : 'Synthetic A' },
        wallets: { primaryWallet: 'synthetic-wallet-' + (req.headers['x-winlew-session'] === 'synthetic-ui-B' ? 'B' : 'A') },
        verification: { verified: true, expires_at: Math.floor(Date.now() / 1000) + 3600 },
        games: { history: [], summary: { totalClaims: 0, totalPayout: 0 } },
        proofOfValue: { ok: true, score: 42, tier: 'Synthetic fixture', breakdown: {}, weights: {} }
      }) : json(401, { error: 'session_expired' });
    }
    if (api === '/api/rewards/history') {
      if (state.account === 'unavailable') return json(503, { error: 'fixture_unavailable' });
      const count = req.headers['x-winlew-session'] === 'synthetic-ui-A' ? 2 : req.headers['x-winlew-session'] === 'synthetic-ui-B' ? 3 : 0;
      return json(200, { history: Array.from({ length: count }, () => ({ game: 'synthetic-fixture' })), summary: { totalPayout: 0 } });
    }
    if (api === '/api/solana/balance') return json(200, { balance: 0 });
    if (api === '/api/account/providers') return json(200, { providers: [] });
    if (api === '/api/account/identities') return json(200, { providers: [], identities: [] });
    if (api === '/api/quiz/cycle') return json(200, { cycle: null });
    if (api === '/api/faucet/global-stats') return json(200, { totalConfirmedCount: 0 });
    // Existing pages can request optional reads; deterministic unavailable.
    return json(503, { error: 'fixture_not_connected' });
  }
  if (!isPublicRequestPath(url.pathname)) { res.writeHead(404); res.end(); return; }
  let file = path.resolve(publicRoot, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(publicRoot + path.sep) && file !== publicRoot) { res.writeHead(404); res.end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? '' : fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});

test('Phase 5 isolated product acceptance', { timeout: 220000 }, async t => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
    assert.deepEqual(evidence.unexpectedRequests, []);
    assert.deepEqual(evidence.assetFailures, []);
    assert.equal(evidence.postRequests, 0);
  });
  const endpoints = JSON.parse(process.env.WINLEW_TEST_BROWSERS);
  assert.ok(endpoints.filter(entry => !entry.unavailable).length >= 2, 'at least Chrome and Edge tooling required');
  for (const entry of endpoints) await t.test(entry.name, { skip: entry.unavailable }, async () => {
    const browser = await ({ chromium, firefox, webkit }[entry.type]).connect(entry.endpoint);
    const result = { browser: entry.name, version: browser.version(), routes: [], games: [], states: [], errors: [] };
    evidence.browsers.push(result);
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('**/*', async route => {
      const request = route.request();
      const target = new URL(request.url());
      const api = target.pathname === '/verify/api-proxy.php' ? target.searchParams.get('path') : target.pathname;
      if (target.origin === base && request.method() === 'POST' && api === '/api/rewards/reconcile') {
        const body = request.postDataJSON();
        if (['synthetic-ui-A', 'synthetic-ui-B'].includes(body?.session) && body?.guestId === 'synthetic-ui-guest') {
          evidence.fixtureReconcileResponses++;
          // Immutable, explicitly reviewed response only. No reconciliation
          // handler runs and no request reaches the fixture HTTP server.
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, movedRows: 0, migrationCredit: 0, total: 0 }) });
          return;
        }
      }
      if (target.origin !== base || !['GET', 'HEAD'].includes(request.method())) {
        evidence.unexpectedRequests.push({ host: target.hostname, method: request.method() });
        await route.abort(); return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => {
      if (/\[WinLEW\].*(?:Failed to initialize|Missing game factory|game module was not loaded)/.test(message.text())) result.errors.push(message.text());
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.status() >= 400 && /\.(?:js|css|png|webp|svg|ico)$/.test(url.pathname)) evidence.assetFailures.push({ path: url.pathname, status: response.status() });
    });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const game of games) {
        state.account = 'guest'; state.data = 'empty';
        await page.goto(`${base}/mole-hub/?game=${game}`); await page.waitForLoadState('load'); await page.waitForTimeout(150);
        await page.locator('#gameLaunchGo').click();
        await page.waitForTimeout(250);
        assert.equal(await page.locator('#gameLaunchModal').isVisible(), false, game + ' engine start');
        assert.equal(await page.evaluate(() => !!window.WinLEWLastLaunchError), false, game);
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('.view:not(.hidden) canvas, .view:not(.hidden) #moleSpadesBoard').count() > 0, true, game);
        result.games.push({ game, started: true, inputSmoke: true, fullRound: false });
        // End this disposable page before any game can complete/claim.
        await page.goto('about:blank');
      }
      for (const data of ['empty', 'error']) {
        state.data = data; state.account = 'guest';
        for (const route of ['/earn/', '/proof/', '/build/', '/faucet/', '/quiz/', '/proof-of-value/', '/transparency/', '/governance/', '/verify/profile.html']) {
          assert.equal((await page.goto(base + route)).status(), 200);
          await page.waitForLoadState('load'); await page.waitForTimeout(150);
          assert.equal(await page.locator('h1').count() > 0, true, route);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, route + ' ' + data);
          const text = await page.locator('body').innerText();
          if (route === '/governance/') assert.match(text, data === 'empty' ? /No .*proposals|Nothing open/ : /Could not load governance/);
          if (route === '/transparency/') assert.match(text, data === 'empty' ? /No component evidence returned/ : /Couldn't reach the transparency/);
          if (route === '/quiz/' && data === 'empty') assert.match(text, /No players yet/);
          if (route === '/build/') assert.equal(await page.locator('main a[href="https://oxyon.io/"]').count(), 1);
          result.routes.push({ route, width: 390, data, pass: true });
        }
      }
      state.data = 'empty'; state.account = 'connected';
      await page.evaluate(() => { localStorage.setItem('winlew.verify.session', 'synthetic-ui-A'); localStorage.setItem('winlew.verify.app', 'mole'); });
      await page.goto(base + '/verify/profile.html'); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.equal(await page.locator('#displayName').textContent(), 'Synthetic A');
      assert.equal(await page.locator('#povScore').textContent(), '42');
      result.states.push('private-profile-A-and-server-PoV');
      state.account = 'unavailable';
      await page.evaluate(() => localStorage.setItem('winlew.verify.session', 'synthetic-ui-B'));
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.notEqual(await page.locator('#displayName').textContent(), 'Synthetic A');
      result.states.push('account-B-error-no-A-cache');
      state.account = 'connected';
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.equal(await page.locator('#displayName').textContent(), 'Synthetic B');
      result.states.push('private-profile-B');
      state.account = 'expired';
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.notEqual(await page.locator('#displayName').textContent(), 'Synthetic B');
      result.states.push('expired-profile-no-private-cache');
      await page.screenshot({ path: path.join(output, entry.name + '-profile-expired-mobile.png'), fullPage: true });
      await page.goto(base + '/proof/'); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(output, entry.name + '-proof-mobile.png'), fullPage: true });
      assert.deepEqual(result.errors, []);
    } finally { await context.close(); await browser.close(); }
  });
});
