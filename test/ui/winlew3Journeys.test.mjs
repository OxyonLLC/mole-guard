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
const state = { summary: 'live', account: 'guest' };
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
      return state.account === 'connected' ? json(200, { profile: {}, verification: { verified: true, expires_at: Math.floor(Date.now() / 1000) + 3600 }, wallets: {} }) : json(401, { error: 'session_expired' });
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

test('WinLEW 3.0 local browser journeys', { timeout: 220000 }, async t => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
    assert.deepEqual(evidence.unexpectedRequests, []);
    assert.deepEqual(evidence.assetFailures, []);
    assert.equal(evidence.postRequests, 0);
  });
  const selected = process.env.WINLEW_TEST_UI_BROWSER;
  assert.ok(!selected || ['chrome', 'edge', 'firefox', 'webkit'].includes(selected));
  const endpoints = JSON.parse(process.env.WINLEW_TEST_BROWSERS).filter(entry => !selected || entry.name === selected);
  assert.ok(endpoints.filter(entry => !entry.unavailable).length >= (selected ? 1 : 2), 'reviewed browser tooling required');
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
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
        for (const route of routes) {
          state.summary = 'live'; const before = evidence.summaryRequests;
          assert.equal((await page.goto(base + route)).status(), 200);
          await page.waitForLoadState('load'); await page.waitForTimeout(150);
          assert.equal(await page.locator('h1').count(), 1, route);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflow at ${width}`);
          assert.equal(await page.locator('.navPrimary a').count(), 7);
          if (width === 1440) assert.equal(await page.locator('.navPrimary').isVisible(), true, 'desktop journeys visible');
          const toggle = page.locator('.navToggle');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          assert.equal(await page.locator('.navFullMenuPanel').isVisible(), false);
          await toggle.click();
          assert.equal(await page.locator('.navJourneys a').count(), 7);
          assert.equal(await page.locator('.navFullMenuPanel').isVisible(), true);
          await page.keyboard.press('Escape');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
          if (route === '/') assert.equal(evidence.summaryRequests - before, 1, 'one summary read');
          // Only pages with reviewed public markup are checked for local links.
          const links = await page.locator('main a[href]').evaluateAll(items => items.map(el => el.getAttribute('href')));
          for (const href of links.filter(value => value.startsWith('/') && !value.startsWith('//'))) {
            const target = new URL(href, base); let file = path.resolve(publicRoot, '.' + target.pathname);
            assert.ok(fs.existsSync(file), `missing destination ${target.pathname}`);
          }
          if (width === 1440 || width === 390) {
            await page.evaluate(async () => {
              for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
                scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 10));
              }
              scrollTo(0, 0);
            });
            await page.waitForTimeout(100);
            await page.screenshot({ path: path.join(output, `${entry.name}-${route === '/' ? 'home' : route.split('/')[1]}-${width}.png`), fullPage: true });
            if (route === '/') await page.screenshot({ path: path.join(output, `${entry.name}-home-first-screen-${width}.png`) });
          }
          result.routes.push({ route, width, pass: true });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      for (const variant of ['partial', 'stale', 'unavailable', 'malformed']) {
        state.summary = variant; await page.goto(base); await page.waitForLoadState('load'); await page.waitForTimeout(150);
        const status = await page.locator('[data-state]').allTextContents();
        if (variant === 'stale') assert.ok(status.every(value => value === 'Stale'));
        if (['unavailable', 'malformed'].includes(variant)) assert.ok(status.every(value => value === 'Unavailable'));
        if (variant === 'partial') assert.equal(await page.locator('[data-source-card="events"] [data-state]').textContent(), 'Unavailable');
        result.states.push(variant);
      }
      for (const route of ['/app/', '/jdid93hf8dh/']) {
        await page.goto(base + route); await page.waitForLoadState('load'); await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, route);
        assert.equal(await page.locator('a[href^="/jdid93hf8dh/"]').count() > 0, true);
        result.routes.push({ route, width: 390, pass: true });
      }
      const metadata = await context.request.get(base + '/jdid93hf8dh/latest.json');
      assert.equal(metadata.status(), 200);
      assert.equal((await metadata.json()).url, '/jdid93hf8dh/winlew-beta-0.2.1.apk');
      for (const game of games) {
        await page.goto(`${base}/mole-hub/?game=${game}`); await page.waitForLoadState('load'); await page.waitForTimeout(150);
        assert.ok(await page.locator('.view.active').count() > 0, game);
        assert.equal(await page.locator('#gameLaunchModal').isVisible(), true, game);
        assert.equal(await page.evaluate(() => ['diglew', 'pac', 'glide', 'blaster', 'grubdrop', 'moleice', 'tunneltap', 'molespades'].every(name => typeof window.WinLEWGameFactories?.[name] === 'function')), true, 'all eight engines registered');
        await page.keyboard.press('Escape');
        result.games.push(game);
      }
      await page.evaluate(() => { localStorage.setItem('winlew.hub.guest', 'synthetic-ui-guest'); });
      for (const [session, count] of [['synthetic-ui-A', 2], ['synthetic-ui-B', 3]]) {
        state.account = 'connected';
        await page.evaluate(session => { localStorage.setItem('winlew.verify.session', session); localStorage.setItem('winlew.verify.app', 'mole'); }, session);
        await page.goto(`${base}/mole-hub/`); await page.waitForLoadState('load'); await page.waitForTimeout(150);
        assert.equal(await page.locator('#yourPlayConnection').textContent(), 'Account session confirmed');
        assert.equal(await page.locator('#yourPlayVerification').textContent(), 'Wallet verification current');
        assert.equal(await page.locator('#yourPlayHistory').textContent(), `${count} server-confirmed records`);
        result.states.push(`account-switch-${session.endsWith('A') ? 'A' : 'B'}`);
      }
      state.account = 'unavailable';
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.equal(await page.locator('#yourPlayVerification').textContent(), 'Verification unavailable');
      assert.equal(await page.locator('#yourPlayHistory').textContent(), 'History unavailable');
      result.states.push('account-unavailable');
      state.account = 'expired';
      await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.equal(await page.locator('#yourPlayConnection').textContent(), 'Guest play active');
      assert.equal(await page.evaluate(() => localStorage.getItem('winlew.verify.session')), null);
      result.states.push('account-expired');
      state.account = 'guest';
      await page.setViewportSize({ width: 844, height: 390 });
      await page.goto(`${base}/play/`); await page.waitForLoadState('load'); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(result.errors, []);
    } finally { await context.close(); await browser.close(); }
  });
});
