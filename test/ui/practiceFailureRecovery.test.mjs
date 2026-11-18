import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startLocalStaging } from '../support/localStaging.mjs';

test('remaining practice engines reach honest failure states and restart without rewards', { timeout: 220000 }, async t => {
  const { base, request } = await startLocalStaging(t);
  const endpoints = JSON.parse(process.env.WINLEW_TEST_BROWSERS);
  const browser = await chromium.connect(endpoints.find(entry => entry.name === 'chrome').endpoint);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const failures = [], errors = [], rounds = [];
  await context.addInitScript(() => {
    let seed = 123456789;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    localStorage.setItem('winlew.hub.guest', 'integration-loss-guest');
    if(new URL(location.href).searchParams.get('game')==='diglew'){
      // Returning-player save fixture: two prior practice checkpoints. No
      // score, hearts, current run state or rewards are overridden.
      localStorage.setItem('winlew.diglew.progress',JSON.stringify({checkpoints:2}));
    }
  });
  t.after(async () => {
    await context.close(); await browser.close();
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, 'practice-failure-recovery.json'), JSON.stringify({ rounds, failures, errors }, null, 2));
    assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  });
  const games = [
    { id: 'diglew', file: 'diglew.js', button: 'diglewStartBtn', marker: 'return { renderAll, draw, startRun, resetProgress, bankRun: completeCheckpoint, togglePause };', snapshot: 'run && ({over:run.over,won:run.won,lane:run.player.targetLane,targets:run.objects.filter(o=>!o.hit&&!o.collected&&(o.type==="spikes"||o.type==="rock")).map(o=>({x:o.x,lane:o.lane}))})' },
    { id: 'rootglide', file: 'root-glide.js', button: 'glideStartBtn', marker: 'return { startOrResume, reset, renderAll, draw };', snapshot: 'state && ({over:state.over,won:state.rewardPending})' },
    { id: 'tunneltap', file: 'tunnel-tap.js', button: 'tunnelTapStartBtn', marker: 'return { startOrResume, reset, renderAll, draw };', snapshot: 'state && ({over:state.over,won:!state.running&&!state.over,lane:state.lane,targets:state.hazards.filter(h=>!h.dead&&h.type!=="coin").map(h=>({y:h.y,lane:h.lane}))})' },
    { id: 'pacmole', file: 'pac-mole.js', button: 'pacStartBtn', marker: 'return { renderAll, draw, startOrResume: startOrResumePac, start, resetRun };', snapshot: 'state && ({over:state.over,won:state.cleared,player:{...state.player},targets:state.enemies.map(e=>({x:e.x,y:e.y})),map:state.map.map(r=>[...r])})' },
    { id: 'burrowblaster', file: 'burrow-blaster.js', button: 'blasterStartBtn', marker: 'return { startOrResume, reset, renderAll, draw };', snapshot: 'state && ({over:state.over,won:state.rewardPending,player:{x:state.player.x,y:state.player.y},targets:state.enemies.map(e=>({x:e.x,y:e.y}))})' },
    { id: 'moleice', file: 'mole-ice.js', button: 'moleiceStartBtn', marker: 'return { startOrResume, reset, renderAll, draw, start };', snapshot: '({over:uiPhase==="over",hit:uiPhase==="hit",won:uiPhase==="roundclear",player:player&&{...player},targets:bugs?.map(b=>({x:b.x,y:b.y})),map:board?.map(r=>r.slice())})' },
  ];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base || !['GET', 'HEAD'].includes(req.method())) {
      failures.push({ host: url.hostname, path: url.pathname, method: req.method() }); await route.abort(); return;
    }
    const game = games.find(g => url.pathname === '/mole-hub/js/games/' + g.file);
    if (game) {
      const source = fs.readFileSync('src/public/mole-hub/js/games/' + game.file, 'utf8');
      assert.equal(source.split(game.marker).length, 2);
      const hook = `window.WinLEWFailureInspect ||= {}; window.WinLEWFailureInspect.${game.id} = () => ${game.snapshot}; `;
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(game.marker, hook + game.marker) }); return;
    }
    await route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.clock.install();
  for (const game of games) await t.test(game.id + ' failure and restart', async () => {
    await page.goto(base + '/mole-hub/?game=' + game.id); await page.waitForLoadState('load');
    await page.locator('#gameLaunchGo').click();
    await page.evaluate(id => {
      window.failurePilot = setInterval(() => {
        const s = window.WinLEWFailureInspect[id](); if (!s || s.over || s.hit || s.won) return;
        if (id === 'diglew' || id === 'tunneltap') {
          const target = id === 'diglew' ? s.targets.filter(h=>h.x>150&&h.x<700).sort((a,b)=>a.x-b.x)[0]
            : s.targets.filter(h=>h.y>600&&h.y<1160).sort((a,b)=>b.y-a.y)[0];
          if(target&&target.lane!==s.lane){const key=id==='diglew'
            ?(target.lane<s.lane?'ArrowUp':'ArrowDown'):(target.lane<s.lane?'ArrowLeft':'ArrowRight');
            window.dispatchEvent(new KeyboardEvent('keydown',{key,code:key}));}
          return;
        }
        if (id === 'rootglide') return; // natural gravity produces the loss
        if (!s.player) return;
        if (id === 'burrowblaster') {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); return;
        }
        const dirs = [[0,-1,'ArrowUp'],[0,1,'ArrowDown'],[-1,0,'ArrowLeft'],[1,0,'ArrowRight']];
        const queue = [{x:s.player.x,y:s.player.y,first:null}], seen = new Set([s.player.x+','+s.player.y]);
        const targets = new Set(s.targets.map(p=>p.x+','+p.y));
        while (queue.length) {
          const cur = queue.shift();
          if (cur.first && targets.has(cur.x+','+cur.y)) { window.dispatchEvent(new KeyboardEvent('keydown', {key:cur.first})); return; }
          for (const [dx,dy,key] of dirs) {
            let x=cur.x+dx,y=cur.y+dy;
            if (id==='pacmole') x=(x+s.map[0].length)%s.map[0].length;
            const cell=s.map[y]?.[x], visited=x+','+y;
            if (!cell || cell==='#' || cell==='X' || (id==='moleice' && cell!=='.') || seen.has(visited)) continue;
            seen.add(visited); queue.push({x,y,first:cur.first||key});
          }
        }
      }, 100);
    }, game.id);
    let state;
    for (let i = 0; i < 40; i++) {
      await page.clock.runFor(1000);
      state = await page.evaluate(id => window.WinLEWFailureInspect[id](), game.id);
      if (state?.over || state?.won) break;
      if (state?.hit) await page.locator('#' + game.button).click();
    }
    await page.evaluate(() => { clearInterval(window.failurePilot); window.dispatchEvent(new KeyboardEvent('keyup', {key:'ArrowUp'})); });
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, game.id + '-terminal.json'), JSON.stringify({game:game.id,over:state?.over,won:state?.won,hit:state?.hit}, null, 2));
    assert.equal(state?.over, true, game.id + ' reaches a real terminal failure without forced state');
    assert.notEqual(state?.won, true);
    assert.equal(await page.locator('#rewardOverlay').isVisible(), false);
    await page.locator('#' + game.button).click();
    const restarted = await page.evaluate(id => window.WinLEWFailureInspect[id](), game.id);
    assert.equal(restarted.over, false);
    assert.equal((await request('/api/rewards/history?guest=integration-loss-guest')).data.history.length, 0);
    rounds.push({ game: game.id, outcome: 'loss', restarted: true, rewards: 0, method: 'normal timers and legal movement toward hazards; UI restart after actual terminal state' });
  });
});
