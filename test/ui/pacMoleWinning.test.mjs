import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementBrowser } from '../support/browserSettlement.mjs';

test('PacMole real maze clear, calculated score, member settlement and next level', { timeout: 560000 }, async t => {
  const game = { id:'pacmole',file:'pac-mole.js',frameMs:40,
    marker:'return { renderAll, draw, startOrResume: startOrResumePac, start, resetRun };',
    snapshot:'state && ({num:state.num,map:state.map.map(r=>[...r]),player:{...state.player},enemies:state.enemies.map(e=>({x:e.x,y:e.y,vulnerable:e.vulnerable})),worms:state.worms.map(w=>({...w})),powers:state.powers.map(p=>({...p})),score:state.score,lives:state.lives,left:state.wormsLeft,cleared:state.cleared,over:state.over,power:state.powerTimer,beetles:state.beetlesEaten,dashes:state.dashUsed,cooldown:state.dashCooldown})',
    summary:s=>({level:s.num,score:s.score,lives:s.lives,left:s.left,cleared:s.cleared,over:s.over,
      ...(s.left<13?{player:s.player,remaining:[...s.worms,...s.powers].filter(w=>!w.eaten),enemies:s.enemies}:{})}) };
  const { page, observe, settleAndVerify,audit } = await settlementBrowser(t,game);
  const initial=await observe(); assert.equal(initial.num,1); assert.ok(initial.left>0);
  const reachable=new Set(),todo=[initial.player];
  while(todo.length){const p=todo.pop(),key=p.x+','+p.y;if(reachable.has(key))continue;reachable.add(key);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=p.x+dx,y=p.y+dy,c=initial.map[y]?.[x];if(c&&c!=='#'&&c!=='X'&&!reachable.has(x+','+y))todo.push({x,y});}}
  const unreachable=[...initial.worms,...initial.powers].filter(w=>!reachable.has(w.x+','+w.y));
  audit.mazeConnectivity={reachable:reachable.size,unreachable};assert.deepEqual(unreachable,[]);
  // The starting tile is collectible too. Allow the original movement/eat
  // tick to run while the mole is stationary before choosing its first route.
  await page.clock.runFor(200);
  await page.evaluate(()=>{
    window.pacWinPilot=setInterval(()=>{
      const s=window.WinLEWWinningInspect(); if(!s||s.over||s.cleared)return;
      const dirs=[[0,-1,'ArrowUp'],[0,1,'ArrowDown'],[-1,0,'ArrowLeft'],[1,0,'ArrowRight']];
      const goal=new Map([...s.worms.filter(w=>!w.eaten).map(w=>[w.x+','+w.y,false]),...s.powers.filter(w=>!w.eaten).map(w=>[w.x+','+w.y,true])]);
      const dangerous=s.enemies.filter(e=>!e.vulnerable);
      const canDash=s.cooldown<=0&&s.worms.length+s.powers.length-s.left>s.dashes;
      const queue=[{x:s.player.x,y:s.player.y,cost:0,first:null}],seen=new Set();
      let best=null;
      while(queue.length){
        queue.sort((a,b)=>a.cost-b.cost);const p=queue.shift(),key=p.x+','+p.y;
        if(seen.has(key))continue;seen.add(key);
        if(p.first&&goal.has(key)){best=p;break;}
        for(const [dx,dy,input] of dirs){
          const x=p.x+dx,y=p.y+dy,cell=s.map[y]?.[x],k=x+','+y;
          if(cell&&cell!=='#'&&cell!=='X'&&!seen.has(k)){
            const risk=dangerous.reduce((sum,e)=>sum+(Math.abs(e.x-x)+Math.abs(e.y-y)<3?35:0),0);
            queue.push({x,y,cost:p.cost+1+risk,first:p.first||{key:input,dash:false}});
          }
          // Normal SPACE burrow crosses one/two walls to the first landing.
          // The engine still enforces fuel and its 3.2-second cooldown.
          if(canDash&&!p.first){
            let walls=0;
            for(let step=1;step<=3;step++){
              const xx=p.x+dx*step,yy=p.y+dy*step,c=s.map[yy]?.[xx];if(!c)break;
              if(c==='#'||c==='X'){walls++;if(walls>2)break;continue;}
              if(walls>0&&!seen.has(xx+','+yy)){
                const risk=dangerous.reduce((sum,e)=>sum+(Math.abs(e.x-xx)+Math.abs(e.y-yy)<3?35:0),0);
                queue.push({x:xx,y:yy,cost:p.cost+2+risk,first:p.first||{key:input,dash:true}});
              }break;
            }
          }
        }
      }
      if(best){window.dispatchEvent(new KeyboardEvent('keydown',{key:best.first.key}));
        if(best.first.dash)window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space'}));}
    },80);
  });
  let won;
  for(let i=0;i<140;i++){
    await page.clock.runFor(1000);won=await observe();if(won.cleared||won.over)break;
  }
  await page.evaluate(()=>clearInterval(window.pacWinPilot));
  audit.mazeEnd={player:won.player,remaining:[...won.worms,...won.powers].filter(w=>!w.eaten),map:won.map};
  assert.equal(won.cleared,true,'all actual maze worms and power globes collected');
  assert.equal(won.left,0);assert.ok(won.lives>0);
  assert.equal(won.score,initial.worms.length*10+initial.powers.length*50+won.beetles*200-won.dashes*5+won.lives*100);
  await settleAndVerify();
  const next=await observe();assert.equal(next.num,2);assert.equal(next.over,false);assert.ok(next.left>0);
});
