import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementBrowser } from '../support/browserSettlement.mjs';

test('BurrowBlaster six real waves, exact scoring, member settlement and next round', { timeout:560000 }, async t=>{
  const game={id:'burrowblaster',file:'burrow-blaster.js',frameMs:40,
    marker:'return { startOrResume, reset, renderAll, draw };',
    scoreTrace:"function addScore(points, x, y, label = null, color = '#ffd86a') {",
    snapshot:'state && ({width:W,height:H,player:{...state.player},enemies:state.enemies.map(e=>({...e})),hazards:state.hazards.map(h=>({...h})),powers:state.powerups.map(p=>({...p})),over:state.over,pending:state.rewardPending,lives:state.lives,wave:state.wave,round:state.round,kills:state.kills,score:state.score,shards:state.shardsRecovered,near:state.nearMisses,combo:state.bestCombo,damage:state.damageTaken,bosses:state.bossDefeated})',
    summary:s=>({wave:s.wave,round:s.round,lives:s.lives,kills:s.kills,score:s.score,pending:s.pending,over:s.over})};
  const {page,observe,settleAndVerify,audit}=await settlementBrowser(t,game);
  assert.equal((await observe()).wave,1);
  await page.evaluate(()=>{
    window.blasterWinPilot=setInterval(()=>{
      const s=window.WinLEWWinningInspect();if(!s||s.over)return;
      const enemies=s.enemies.filter(e=>!e.dead).sort((a,b)=>b.y-a.y);
      const e=enemies[0],power=s.powers.find(p=>p.life>0);
      const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
      let desiredX=s.width/2,desiredY=s.height-170;
      if(e){
        const travel=.2;
        const vx=e.chargeState==='dash'?e.chargeVx:(e.vx||0)+(e.type==='scout'?Math.sin(e.phase)*65:e.type==='carrier'?Math.sin(e.phase*1.8)*82:0);
        desiredX=clamp(e.x+vx*travel,40,s.width-40);desiredY=clamp(e.y+200,300,s.height-58);
      }else if(power){desiredX=power.x;desiredY=power.y;}
      function risk(x,y){
        let r=0;
        for(const enemy of enemies){
          const yy=enemy.y+(enemy.chargeState==='dash'?(enemy.chargeVy||0):(enemy.vy||0))*.2;
          if(Math.hypot(x-enemy.x,y-yy)<(enemy.r||25)+70)r+=10000;
        }
        for(const h of s.hazards){
          const xx=h.x+(h.vx||0)*.2,yy=h.y+(h.vy||0)*.2;
          if(h.kind==='rock'&&Math.hypot(x-xx,y-yy)<h.r+65)r+=10000;
          if(h.kind==='beam'){
            const hit=h.orientation==='vertical'?Math.abs(x-xx)<h.width/2+55&&y>yy-55&&y<yy+h.height+55:
              Math.abs(y-yy)<h.height/2+55&&x>xx-55&&x<xx+h.width+55;
            if(hit)r+=10000;
          }
          if(h.kind==='root'&&Math.abs(y-yy)<h.height/2+65&&Math.abs(x-xx)<h.width+65)r+=10000;
        }
        return r;
      }
      let target={x:desiredX,y:desiredY,value:Infinity};
      for(const dx of [0,-55,55,-110,110])for(const dy of [0,90,-90]){
        const x=clamp(desiredX+dx,40,s.width-40),y=clamp(desiredY+dy,76,s.height-58);
        const value=risk(x,y)+Math.abs(dx)*2+Math.abs(dy)+Math.hypot(s.player.x-x,s.player.y-y)*.05;
        if(value<target.value)target={x,y,value};
      }
      const canvas=document.getElementById('blasterCanvas'),rect=canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.left+target.x/s.width*rect.width,clientY:rect.top+target.y/s.height*rect.height}));
    },80);
  });
  let won;
  for(let i=0;i<180;i++){await page.clock.runFor(1000);won=await observe();if(won.over)break;}
  await page.evaluate(()=>clearInterval(window.blasterWinPilot));
  assert.equal(won.pending,true,'all six original waves completed without forced victory');
  assert.equal(won.wave,6);assert.ok(won.lives>0);assert.ok(won.kills>0);
  const points=await page.evaluate(()=>window.WinLEWScoreObservations||[]);
  assert.equal(won.score,points.reduce((sum,n)=>sum+n,0),'score equals the actual unmodified scoring events');
  await settleAndVerify();
  const performance=won.kills*9+won.shards*8+won.near*6+won.combo*3+won.bosses*90-won.damage*38;
  const bonus=performance>=620?.30:performance>=460?.22:performance>=330?.15:performance>=210?.08:0;
  assert.equal(audit.claims[0].baseReward,Number(((50+6*5+won.shards*2+Math.floor(won.kills/3))*(1+bonus)).toFixed(2)));
  const next=await observe();assert.equal(next.round,2);assert.equal(next.wave,1);assert.equal(next.over,false);
});
