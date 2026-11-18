// Guarded real frontend + backend. Only read-only engine observations are injected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startLocalStaging } from './localStaging.mjs';

export async function settlementBrowser(t, game) {
  const staging = await startLocalStaging(t, { funded: true });
  const { base, request, accounts: [A, B] } = staging;
  const entries = JSON.parse(process.env.WINLEW_TEST_BROWSERS);
  const browser = await chromium.connect(entries.find(row => row.name === 'chrome').endpoint);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const audit = { game: game.id, observations: [], blocked: [], errors: [], claims: [] };
  if (game.frameMs) { assert.equal(game.frameMs, 40); audit.frameCadenceMs = 40; }
  let claimBody;
  await context.addInitScript(({ session, wallet, gameId }) => {
    let seed = 123456789;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    localStorage.setItem('winlew.verify.session', session);
    localStorage.setItem('winlew.verify.app', 'mole');
    localStorage.setItem('winlew.verify.wallet', wallet);
    localStorage.setItem('winlew.hub.guest', 'synthetic-win-' + gameId);
  }, { session: A.session, wallet: A.wallet, gameId: game.id });
  const page = await context.newPage();
  page.on('pageerror', e => audit.errors.push(e.message));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base || !(['GET', 'HEAD'].includes(req.method())
      || (req.method() === 'POST' && ['/api/rewards/claim', '/api/rewards/reconcile'].includes(url.pathname)))) {
      audit.blocked.push({ host: url.hostname, path: url.pathname, method: req.method() }); await route.abort(); return;
    }
    if (url.pathname === '/api/rewards/claim' && req.method() === 'POST') {
      claimBody = req.postDataJSON();
      const { session: _session, ...safe } = claimBody;
      audit.claims.push(safe);
    }
    if (game.frameMs && url.pathname === '/mole-hub/js/app.js') {
      // Install before makeGameDeps captures its bound browser API references.
      // Engine rendering, dt clamps, movement, collision and scoring remain.
      const source = fs.readFileSync('src/public/mole-hub/js/app.js', 'utf8');
      const cadence = 'window.WinLEWTestFrameTicks=0; window.requestAnimationFrame=fn=>window.setTimeout(()=>{window.WinLEWTestFrameTicks++;fn(performance.now());},40); window.cancelAnimationFrame=id=>window.clearTimeout(id);\n';
      await route.fulfill({ contentType:'text/javascript', body:cadence+source }); return;
    }
    if (url.pathname === '/mole-hub/js/games/' + game.file) {
      let source = fs.readFileSync('src/public/mole-hub/js/games/' + game.file, 'utf8');
      if (game.scoreTrace) {
        assert.equal(source.split(game.scoreTrace).length, 2);
        source = source.replace(game.scoreTrace, game.scoreTrace + ' (window.WinLEWScoreObservations ||= []).push(points); ');
      }
      assert.equal(source.split(game.marker).length, 2);
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(game.marker,
        'window.WinLEWWinningInspect = () => ' + game.snapshot + '; ' + game.marker) }); return;
    }
    await route.continue();
  });
  t.after(async () => {
    await context.close(); await browser.close();
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, game.id + '-winning.json'), JSON.stringify(audit, null, 2));
    assert.deepEqual(audit.blocked, []); assert.deepEqual(audit.errors, []);
  });
  await page.clock.install();
  await page.goto(base + '/mole-hub/?game=' + game.id); await page.waitForLoadState('load');
  await page.locator('#gameLaunchGo').click();
  async function observe() {
    const state = await page.evaluate(() => window.WinLEWWinningInspect());
    audit.observations.push(game.summary(state));
    return state;
  }
  async function settleAndVerify() {
    assert.equal(await page.locator('#rewardOverlay').isVisible(), true, 'real engine completion opened the reward overlay');
    await page.locator('.rewardBoxBtn').first().click();
    await page.waitForFunction(() => document.querySelector('[data-reward-sync]')?.textContent === 'Saved to your profile history.');
    assert.equal(claimBody.game, game.id);
    const history = await request('/api/rewards/history', undefined, A.session);
    assert.equal(history.data.history.length, 1); assert.ok(history.data.summary.totalPayout > 0);
    const banked = history.data.summary.totalPayout;
    const { GAME_REWARD_SCALES } = await import('../../src/mole/rewardRules.js');
    const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    // Established two-step rounding: balance the base first, then multiply.
    assert.equal(banked, round2(round2(claimBody.baseReward * GAME_REWARD_SCALES[game.id]) * claimBody.multiplier));
    const repeat = await request('/api/rewards/claim', claimBody, A.session);
    assert.equal(repeat.status, 200); assert.equal(repeat.data.duplicate, true); assert.equal(repeat.data.payout, banked);
    const altered = await request('/api/rewards/claim', { ...claimBody, baseReward: 9999, multiplier: 2, payout: 999999 }, A.session);
    assert.equal(altered.data.duplicate, true); assert.equal(altered.data.payout, banked);
    assert.equal((await request('/api/profile/me', undefined, A.session)).data.games.summary.totalPayout, banked);
    assert.equal((await request('/api/profile/me', undefined, B.session)).data.games.history.length, 0);
    assert.equal((await request('/api/rewards/history?guest=synthetic-win-' + game.id)).data.history.length, 0);
    audit.settlement = { banked, records: 1, duplicateVerified: true, owner: A.name, otherAccountRecords: 0 };
    await page.locator('#rewardContinueBtn').click();
    assert.equal(await page.locator('#rewardOverlay').isVisible(), false);
    return banked;
  }
  return { ...staging, page, context, audit, observe, settleAndVerify };
}
