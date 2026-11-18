// Real engine play + real guarded backend. No injected scores or forced wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startLocalStaging } from '../support/localStaging.mjs';
test('completed practice rounds bank only synthetic server-authoritative rewards', { timeout: 220000 }, async t => {
  const { base, request, accounts: [A, B], evidence } = await startLocalStaging(t);
  const endpoints = JSON.parse(process.env.WINLEW_TEST_BROWSERS);
  const browser = await chromium.connect(endpoints.find(entry => entry.name === 'chrome').endpoint);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  // Reproducible layouts/deals, not altered rules or a forced result.
  await context.addInitScript(() => {
    let seed = 123456789;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  });
  const failures = [], errors = [], rounds = [];
  t.after(async () => {
    await context.close(); await browser.close();
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, 'practice-lifecycle.json'), JSON.stringify({ rounds, failures, errors, evidence }, null, 2));
    assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const allowedPosts = ['/api/rewards/claim', '/api/rewards/reconcile', '/api/session/logout'];
    if (url.origin !== base || !(['GET', 'HEAD'].includes(req.method()) || (req.method() === 'POST' && allowedPosts.includes(url.pathname)))) {
      failures.push({ host: url.hostname, path: url.pathname, method: req.method() }); await route.abort(); return;
    }
    if (url.pathname === '/mole-hub/js/games/tunnel-tap.js') {
      const source = fs.readFileSync('src/public/mole-hub/js/games/tunnel-tap.js', 'utf8');
      const marker = 'return { startOrResume, reset, renderAll, draw };';
      assert.equal(source.split(marker).length, 2);
      // Read-only test oracle for hazard avoidance. State/scoring/timer code
      // remains original; no test hooks are shipped or written to the repo.
      const hook = 'window.WinLEWPracticeInspect = () => state && ({ lane: state.lane, over: state.over, time: state.time, hazards: state.hazards.map(h => ({lane:h.lane,y:h.y,type:h.type,dead:h.dead})) }); ';
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(marker, hook + marker) }); return;
    }
    if (url.pathname === '/mole-hub/js/games/grub-drop.js') {
      const source = fs.readFileSync('src/public/mole-hub/js/games/grub-drop.js', 'utf8');
      const marker = 'return { startOrResume, reset, renderAll, draw, start };';
      assert.equal(source.split(marker).length, 2);
      const hook = 'window.WinLEWPracticeGrubInspect = () => state && ({grid:state.grid.map(row=>row.slice()),over:state.over,locked:inputLocked||!!anim,OX,OY,CELL}); ';
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(marker, hook + marker) }); return;
    }
    if (url.pathname === '/mole-hub/js/games/root-glide.js') {
      const source = fs.readFileSync('src/public/mole-hub/js/games/root-glide.js', 'utf8');
      const marker = 'return { startOrResume, reset, renderAll, draw };';
      assert.equal(source.split(marker).length, 2);
      const hook = 'window.WinLEWPracticeGlideInspect = () => state && ({y:state.y,vy:state.vy,over:state.over,paused:state.paused,height:H,obstacles:state.obstacles.map(o=>({x:o.x,width:o.width,...getOpenGapBounds(o)}))}); ';
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(marker, hook + marker) }); return;
    }
    await route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto(base + '/mole-hub/?game=tunneltap'); await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.setItem('winlew.hub.guest', 'integration-browser-guest'));
  await page.locator('#gameLaunchGo').click();
  await page.evaluate(() => {
    window.practicePilot = setInterval(() => {
      const state = window.WinLEWPracticeInspect?.(); if (!state || state.over || state.time <= 0) return;
      const blocked = new Set(state.hazards.filter(h => !h.dead && h.type !== 'coin' && h.y > 650 && h.y < 1100).map(h => h.lane));
      const target = [state.lane, 0, 1, 2].find(lane => !blocked.has(lane));
      if (target !== undefined && target !== state.lane) window.dispatchEvent(new KeyboardEvent('keydown', { key: target < state.lane ? 'ArrowLeft' : 'ArrowRight' }));
    }, 50);
  });
  for (let i = 0; i < 7 && !await page.locator('#rewardOverlay').isVisible(); i++) await page.clock.runFor(5000);
  await page.evaluate(() => clearInterval(window.practicePilot));
  assert.equal(await page.locator('#rewardOverlay').isVisible(), true, '30-second tunnel completed by legal steering');
  assert.match(await page.locator('#rewardTitle').textContent(), /Burrow 1 Reached/);
  await page.locator('.rewardBoxBtn').first().click();
  await page.waitForFunction(() => document.querySelector('[data-reward-sync]')?.textContent === 'Saved to your profile history.');
  rounds.push({ game: 'tunneltap', completed: true, method: 'full timer, legal keyboard steering, read-only hazard oracle' });
  const before = await request('/api/rewards/history?guest=integration-browser-guest');
  assert.equal(before.data.history.length, 1); assert.ok(before.data.summary.totalPayout > 0);
  await page.goto(base + '/mole-hub/?game=molespades'); await page.waitForLoadState('load');
  await page.locator('#gameLaunchGo').click();
  await page.evaluate(() => {
    window.practicePilot = setInterval(() => {
      if (!document.getElementById('rewardOverlay').classList.contains('hidden')) return;
      const lock = document.getElementById('moleSpadesLock'), next = document.getElementById('moleSpadesNext');
      if (lock) { lock.click(); return; } if (next) { next.click(); return; }
      const cards = [...document.querySelectorAll('.ms-hand button.playable:not([disabled])')];
      cards.sort((a, b) => Number(b.dataset.card.split('-')[1]) - Number(a.dataset.card.split('-')[1]));
      cards[0]?.click();
    }, 100);
  });
  for (let i = 0; i < 80 && !await page.locator('#rewardOverlay').isVisible(); i++) await page.clock.runFor(10000);
  await page.evaluate(() => clearInterval(window.practicePilot));
  assert.equal(await page.locator('#rewardOverlay').isVisible(), true, 'complete legal-card match reached real settlement');
  assert.match(await page.locator('#rewardTitle').textContent(), /Champion|Match Complete/);
  await page.locator('.rewardBoxBtn').first().click();
  await page.waitForFunction(() => document.querySelector('[data-reward-sync]')?.textContent === 'Saved to your profile history.');
  rounds.push({ game: 'molespades', completed: true, method: 'legal cards, real bot turns/tricks/contracts until target score' });
  await page.goto(base + '/mole-hub/?game=grubdrop'); await page.waitForLoadState('load');
  await page.locator('#gameLaunchGo').click();
  await page.evaluate(() => {
    window.practicePilot = setInterval(() => {
      const s = window.WinLEWPracticeGrubInspect?.(); if (!s || s.over || s.locked) return;
      const seen = new Set(); let best = [];
      for (let r = 0; r < s.grid.length; r++) for (let c = 0; c < s.grid[r].length; c++) {
        if (s.grid[r][c] < 0 || seen.has(r + ',' + c)) continue;
        const group = [], todo = [[r, c]], type = s.grid[r][c];
        while (todo.length) {
          const [y, x] = todo.pop(), key = y + ',' + x;
          if (seen.has(key) || s.grid[y]?.[x] !== type) continue;
          seen.add(key); group.push([y, x]); todo.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]);
        }
        if (group.length > best.length) best = group;
      }
      if (best.length < 2) return;
      const canvas = document.getElementById('grubDropCanvas'), rect = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
      const left = parseFloat(style.borderLeftWidth) || 0, right = parseFloat(style.borderRightWidth) || 0;
      const top = parseFloat(style.borderTopWidth) || 0, bottom = parseFloat(style.borderBottomWidth) || 0;
      const w = rect.width - left - right, h = rect.height - top - bottom, scale = Math.min(w / canvas.width, h / canvas.height);
      const [r, c] = best[0];
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0,
        clientX: rect.left + left + (w - canvas.width * scale) / 2 + (s.OX + (c + .5) * s.CELL) * scale,
        clientY: rect.top + top + (h - canvas.height * scale) / 2 + (s.OY + (r + .5) * s.CELL) * scale }));
    }, 150);
  });
  for (let i = 0; i < 80 && !await page.locator('#rewardOverlay').isVisible(); i++) await page.clock.runFor(1000);
  await page.evaluate(() => clearInterval(window.practicePilot));
  assert.equal(await page.locator('#rewardOverlay').isVisible(), true, 'legal matching-cluster taps exhausted a complete puzzle session');
  await page.locator('.rewardBoxBtn').first().click();
  await page.waitForFunction(() => document.querySelector('[data-reward-sync]')?.textContent === 'Saved to your profile history.');
  rounds.push({ game: 'grubdrop', completed: true, method: 'legal connected-cluster pointer taps until real session completion' });
  await page.goto(base + '/mole-hub/?game=rootglide'); await page.waitForLoadState('load');
  await page.locator('#gameLaunchGo').click();
  await page.evaluate(() => {
    window.practicePilot = setInterval(() => {
      const s = window.WinLEWPracticeGlideInspect?.(); if (!s || s.over || s.paused) return;
      const next = s.obstacles.filter(o => o.x + o.width > 160).sort((a, b) => a.x - b.x)[0];
      const target = next ? (next.top + next.bottom) / 2 : s.height / 2;
      if (s.vy > 0 && s.y + s.vy * .15 > target) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
    }, 30);
  });
  for (let i = 0; i < 30 && !await page.locator('#rewardOverlay').isVisible(); i++) await page.clock.runFor(5000);
  await page.evaluate(() => clearInterval(window.practicePilot));
  assert.equal(await page.locator('#rewardOverlay').isVisible(), true, 'legal flap inputs reached the actual distance checkpoint');
  await page.locator('.rewardBoxBtn').first().click();
  await page.waitForFunction(() => document.querySelector('[data-reward-sync]')?.textContent === 'Saved to your profile history.');
  rounds.push({ game: 'rootglide', completed: true, method: 'legal flap controls, read-only opening geometry, real distance checkpoint' });
  await page.goto(base + '/mole-hub/?game=diglew'); await page.waitForLoadState('load');
  await page.locator('#gameLaunchGo').click();
  for (let i = 0; i < 12 && !await page.locator('#rewardOverlay').isVisible(); i++) await page.clock.runFor(5000);
  assert.equal(await page.locator('#rewardOverlay').isVisible(), true, 'normal runner timer reached the actual checkpoint');
  await page.locator('.rewardBoxBtn').first().click();
  await page.waitForFunction(() => document.querySelector('[data-reward-sync]')?.textContent === 'Saved to your profile history.');
  rounds.push({ game: 'diglew', completed: true, method: 'normal auto-run to actual checkpoint, no forced state or score' });
  const history = await request('/api/rewards/history?guest=integration-browser-guest');
  assert.equal(history.data.history.length, 5);
  const total = history.data.summary.totalPayout;
  for (let i = 0; i < 2; i++) assert.equal((await request('/api/rewards/reconcile', { guestId: 'integration-browser-guest', localTotal: total }, A.session)).data.total, total);
  assert.equal((await request('/api/profile/me', undefined, A.session)).data.games.history.length, 5);
  assert.equal((await request('/api/profile/me', undefined, B.session)).data.games.history.length, 0);
});
