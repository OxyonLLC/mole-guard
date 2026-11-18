import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementBrowser } from '../support/browserSettlement.mjs';

test('Mole Ice first mine: legal ice pushes, score, member settlement, duplicates and next mine', { timeout: 180000 }, async t => {
  const game = { id: 'moleice', file: 'mole-ice.js',
    marker: 'return { startOrResume, reset, renderAll, draw, start };',
    snapshot: '({board:board?.map(r=>r.slice()),player:player&&{...player},bugs:bugs?.map(b=>({x:b.x,y:b.y})),slide:!!slide,score,lives,round,crushes,phase:uiPhase})',
    summary: s => ({ score:s.score,lives:s.lives,round:s.round,crushes:s.crushes,bugs:s.bugs,player:s.player,phase:s.phase }) };
  const { page, observe, settleAndVerify } = await settlementBrowser(t, game);
  const initial = await observe(); assert.equal(initial.bugs.length, 3); assert.equal(initial.phase, 'playing');
  let earned = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await observe(); if (!state.bugs.length) break;
    assert.equal(state.lives, 3, 'legal route never touches a bug');
    const planned = await page.evaluate(() => {
      const s = window.WinLEWWinningInspect(), dirs = [[0,-1,'ArrowUp'],[0,1,'ArrowDown'],[-1,0,'ArrowLeft'],[1,0,'ArrowRight']];
      const occupied = new Set(s.bugs.map(b=>b.x+','+b.y));
      const queue = [{x:s.player.x,y:s.player.y,keys:[]}], seen = new Set([s.player.x+','+s.player.y]);
      while (queue.length) {
        const p = queue.shift();
        for (const [dx,dy,key] of dirs) {
          let x=p.x+dx,y=p.y+dy;
          if (s.board[y]?.[x]!=='I') continue;
          let kills=0;
          while (s.board[y+dy]?.[x+dx]==='.') { x+=dx; y+=dy; if(occupied.has(x+','+y)) kills++; }
          if (kills) {
            for (const k of [...p.keys,key]) window.dispatchEvent(new KeyboardEvent('keydown',{key:k}));
            window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space'}));
            return { keys:p.keys.length,expectedKills:kills,shatter:false };
          }
        }
        for (const [dx,dy,key] of dirs) {
          const x=p.x+dx,y=p.y+dy,k=x+','+y;
          if(s.board[y]?.[x]!=='.'||occupied.has(k)||seen.has(k)) continue;
          seen.add(k); queue.push({x,y,keys:[...p.keys,key]});
        }
      }
      // Some firing positions are enclosed by ice. Plan a normal ice-clearing
      // move toward such a position, rather than teleporting the player.
      const shots=[];
      for(let y=1;y<s.board.length-1;y++) for(let x=1;x<s.board[y].length-1;x++) for(const [dx,dy,key] of dirs) {
        if(s.board[y]?.[x]!=='I'||s.board[y-dy]?.[x-dx]!=='.'||occupied.has((x-dx)+','+(y-dy))) continue;
        let xx=x,yy=y,kills=0;
        while(s.board[yy+dy]?.[xx+dx]==='.') {xx+=dx;yy+=dy;if(occupied.has(xx+','+yy))kills++;}
        if(kills) shots.push((x-dx)+','+(y-dy));
      }
      const pending=[{x:s.player.x,y:s.player.y,cost:0,path:[]}], costs=new Map();
      while(pending.length) {
        pending.sort((a,b)=>a.cost-b.cost); const p=pending.shift(),pk=p.x+','+p.y;
        if(costs.has(pk))continue; costs.set(pk,p.cost);
        if(shots.includes(pk)) {
          const blocking=p.path.findIndex(step=>s.board[step.y][step.x]==='I');
          if(blocking<0)continue;
          const step=p.path[blocking], [dx,dy]=dirs.find(d=>d[2]===step.key);
          for(const v of p.path.slice(0,blocking+1))window.dispatchEvent(new KeyboardEvent('keydown',{key:v.key}));
          window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space'}));
          const next=s.board[step.y+dy]?.[step.x+dx];
          return {keys:blocking,expectedKills:0,shatter:next==='#'||next==='I'};
        }
        for(const [dx,dy,key] of dirs) {
          const x=p.x+dx,y=p.y+dy,cell=s.board[y]?.[x];
          if(!cell||cell==='#'||occupied.has(x+','+y)||costs.has(x+','+y))continue;
          pending.push({x,y,cost:p.cost+(cell==='I'?10:1),path:[...p.path,{x,y,key}]});
        }
      }
      return null;
    });
    assert.ok(planned, 'reachable legal ice shot exists');
    for (let i = 0; i < 30; i++) { await page.clock.runFor(20); if (!(await page.evaluate(()=>window.WinLEWWinningInspect().slide))) break; }
    const after = await observe(), kills = after.crushes-state.crushes;
    earned += planned.shatter ? 25 : [0,100,400,1150,3150][kills];
  }
  await page.clock.runFor(500);
  const won = await observe();
  assert.equal(won.bugs.length, 0); assert.equal(won.crushes, 3); assert.equal(won.phase, 'roundclear');
  assert.equal(won.score, earned+500, 'established crush-chain/shatter points plus mine-one clear bonus');
  await settleAndVerify();
  const continued = await observe(); assert.equal(continued.round, 2); assert.equal(continued.phase, 'playing');
  assert.equal(continued.bugs.length, 4);
});
