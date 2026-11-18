import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startLocalStaging } from '../support/localStaging.mjs';
import { createLocalGateway } from '../../tools/staging/gateway.mjs';

test('real mobile staging account/reward journeys remain isolated and repeatable', {timeout:220000}, async t=>{
  const staging=await startLocalStaging(t,{funded:true}), gateway=await createLocalGateway(staging);
  t.after(()=>gateway.close());
  const {request,accounts:[A,B]}=staging;
  const browser=await chromium.connect(JSON.parse(process.env.WINLEW_TEST_BROWSERS).find(row=>row.name==='chrome').endpoint);
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const evidence={blocked:[],errors:[],journeys:[]};
  let delayHistory=null, interruptClaim=false, lastClaimBody, lastAnswerBody;
  t.after(async()=>{delayHistory?.release?.();await context.close();await browser.close();
    fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT,'staging-account-journey.json'),JSON.stringify(evidence,null,2));
    assert.deepEqual(evidence.blocked,[]);assert.deepEqual(evidence.errors,[]);});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    const target=url.pathname==='/verify/api-proxy.php'?url.searchParams.get('path')?.split('?')[0]:url.pathname;
    const posts=['/api/rewards/reconcile','/api/session/logout','/api/faucet/claim','/api/quiz/play/next','/api/quiz/play/answer'];
    if(url.origin!==gateway.base||!(['GET','HEAD'].includes(req.method())||(req.method()==='POST'&&posts.includes(target)))){
      evidence.blocked.push({host:url.hostname,path:url.pathname,method:req.method()});await route.abort();return;
    }
    if(req.method()==='POST'&&target==='/api/quiz/play/answer')lastAnswerBody=req.postDataJSON();
    if(req.method()==='POST'&&target==='/api/faucet/claim'){
      lastClaimBody=req.postDataJSON();
      if(interruptClaim){interruptClaim=false;const response=await route.fetch();await response.body();await route.abort('failed');
        evidence.expectedInterruptions=[{path:target,kind:'response lost after durable reservation'}];return;}
    }
    if(delayHistory&&!delayHistory.held&&target==='/api/rewards/history'&&req.headers()['x-winlew-session']===A.session){
      delayHistory.held=true;const response=await route.fetch();await response.body();delayHistory.ready();
      await delayHistory.wait;await route.fulfill({response});return;
    }
    await route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
  // Read-only diagnostics for the intermittent CI failure "15 !== 25" (the +10
  // legacy migration credit missing). Passive listeners only: they never change
  // routing, timing or server state, and they only print when an assertion fails.
  const who=s=>s===A.session?'A':s===B.session?'B':s?'other':'none';
  const t0=Date.now();evidence.reconciles=[];evidence.console=[];
  page.on('console',m=>{if(/reconcile|wallet/i.test(m.text()))evidence.console.push({ms:Date.now()-t0,type:m.type(),text:m.text().slice(0,200)});});
  page.on('response',async r=>{
    const u=new URL(r.url()),target=u.pathname==='/verify/api-proxy.php'?u.searchParams.get('path')?.split('?')[0]:u.pathname;
    if(target!=='/api/rewards/reconcile')return;
    let body=null,json=null;try{body=r.request().postDataJSON();}catch{}try{json=await r.json();}catch{}
    evidence.reconciles.push({ms:Date.now()-t0,status:r.status(),as:who(body?.session),guestId:body?.guestId,localTotal:body?.localTotal,
      migrationCredit:json?.migrationCredit,movedRows:json?.movedRows,total:json?.total,error:json?.error});
  });
  async function diagnostics(label){
    const out={label,reconciles:evidence.reconciles.slice(-8),console:evidence.console.slice(-8)};
    try{out.storage=await page.evaluate(()=>Object.fromEntries(['winlew.wallet','winlew.wallet.owner','winlew.hub.guest','winlew.hub.reconciled'].map(k=>[k,localStorage.getItem(k)])));}catch(e){out.storage=String(e?.message||e);}
    try{const {listRewardClaims}=await import('../../src/mole/rewardHistory.js');
      const {listAccountIdsForUser}=await import('../../src/mole/userAccounts.js');out.accountIdsA=listAccountIdsForUser(String(A.id));
      out.rowsA=(await listRewardClaims(A.id,20)).map(r=>({id:r.discordUserId,game:r.game,roundKey:r.roundKey,payout:r.payout,migration:r.meta?.migration?{guestId:r.meta.migration.guestId,localTotal:r.meta.migration.localTotal,credited:r.meta.migration.credited}:undefined}));
    }catch(e){out.rowsA=String(e?.message||e);}
    evidence.diagnostics=[...(evidence.diagnostics||[]),out];
    return out;
  }
  async function expectTotalA(expected,label){
    const total=(await request('/api/profile/me',undefined,A.session)).data.games.summary.totalPayout;
    if(total!==expected){const d=await diagnostics(label);console.error('[stage-j-diagnostics] '+JSON.stringify(d));
      assert.fail(`${label}: A total ${total} !== ${expected}. Diagnostics: ${JSON.stringify(d)}`);}
  }
  const claim=await request('/api/rewards/claim',{session:A.session,game:'diglew',roundKey:'staging-A-only',baseReward:20,multiplier:1},A.session);
  assert.equal(claim.status,200);const banked=claim.data.payout;
  async function persona(name){await page.goto(gateway.base+'/__staging/');await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(n=>document.getElementById('displayName')?.textContent===n,name);}
  await persona(A.name);
  await page.evaluate(()=>localStorage.setItem('winlew.hub.guest','staging-shared-browser-guest'));
  await page.goto(gateway.base+'/mole-hub/');
  await page.waitForFunction(amount=>Number(localStorage.getItem('winlew.wallet'))===amount,banked);
  evidence.journeys.push('A real profile and server balance');
  await persona(B.name);
  const reconciled=page.waitForResponse(r=>r.url()===gateway.base+'/api/rewards/reconcile'&&r.request().method()==='POST');
  await page.goto(gateway.base+'/mole-hub/');await reconciled;
  const other=await request('/api/profile/me',undefined,B.session);
  assert.equal(other.data.games.summary.totalPayout,0,'B must never receive migration credit from A’s local member mirror');
  assert.equal(other.data.games.history.length,0);
  assert.equal((await request('/api/profile/me',undefined,A.session)).data.games.summary.totalPayout,banked);
  await page.waitForFunction(()=>Number(localStorage.getItem('winlew.wallet'))===0);
  evidence.journeys.push('B switch keeps own empty history and zero balance');
  await t.test('member reloads never become guest migration credits',async()=>{
    await persona(A.name);await page.goto(gateway.base+'/mole-hub/');
    await page.waitForFunction(amount=>Number(localStorage.getItem('winlew.wallet'))===amount,banked);
    for(let i=0;i<2;i++){const done=page.waitForResponse(r=>r.url()===gateway.base+'/api/rewards/reconcile');await page.reload();await done;}
    assert.equal((await request('/api/profile/me',undefined,A.session)).data.games.summary.totalPayout,banked);
    evidence.journeys.push('member reload remains idempotent');
  });
  await t.test('unlabelled legacy guest cache still reconciles once',async()=>{
    await page.evaluate(()=>{localStorage.setItem('winlew.hub.guest','staging-legacy-only');localStorage.setItem('winlew.wallet','10');localStorage.removeItem('winlew.wallet.owner');});
    const done=page.waitForResponse(r=>r.url()===gateway.base+'/api/rewards/reconcile');await page.reload();await done;
    try{await page.waitForFunction(amount=>Number(localStorage.getItem('winlew.wallet'))===amount,banked+10,{timeout:30000});}
    catch(e){const d=await diagnostics('legacy wallet wait');console.error('[stage-j-diagnostics] '+JSON.stringify(d));throw e;}
    await expectTotalA(banked+10,'after legacy reconcile (before second reload)');
    const again=page.waitForResponse(r=>r.url()===gateway.base+'/api/rewards/reconcile');await page.reload();await again;
    await expectTotalA(banked+10,'legacy reconcile not duplicated');
    evidence.journeys.push('legacy guest migration preserved, not duplicated');
  });
  await t.test('real quiz UI scores once and only for its account',async()=>{
    await page.goto(gateway.base+'/quiz/');await page.locator('[data-level="easy"]').click();
    await page.waitForFunction(()=>document.getElementById('qText')?.textContent&&document.querySelectorAll('#qChoices button').length>0);
    const require=createRequire(import.meta.url),pool=require('../../src/quiz/questions.js').getPool('easy');
    const text=await page.locator('#qText').textContent(),q=pool.find(row=>row.q===text);assert.ok(q);
    const answer=q.choices[q.answerIndex],buttons=page.locator('#qChoices button');
    let index=-1;for(let i=0;i<await buttons.count();i++)if((await buttons.nth(i).textContent()).slice(1)===answer)index=i;
    assert.ok(index>=0);const done=page.waitForResponse(r=>r.url()===gateway.base+'/api/quiz/play/answer');await buttons.nth(index).click();
    const result=await(await done).json();assert.equal(result.correct,true);assert.ok(result.awarded>0);
    assert.match(await page.locator('#qResultText').textContent(),/Correct/);
    assert.equal((await request('/api/quiz/play/answer',lastAnswerBody,A.session)).status,400);
    assert.equal((await request('/api/profile/me',undefined,A.session)).data.quiz.lifetimePoints,result.awarded);
    assert.equal((await request('/api/profile/me',undefined,B.session)).data.quiz.lifetimePoints,0);
    evidence.journeys.push('real quiz score, replay rejection and private attribution');
  });
  await t.test('lost faucet response and retry reserve exactly one unsigned claim',async()=>{
    await page.goto(gateway.base+'/faucet/');await page.waitForFunction(()=>!document.getElementById('claimBtn')?.disabled);
    interruptClaim=true;await page.locator('#claimBtn').click();
    await page.waitForFunction(()=>!document.getElementById('claimBtn')?.disabled);
    assert.ok(lastClaimBody);
    const reservedRequestId=lastClaimBody.requestId;
    const {listClaimsSince}=await import('../../src/faucet/claimStore.js');
    const rows=async()=> (await listClaimsSince()).filter(row=>String(row.discordUserId)===A.id);
    assert.equal((await rows()).length,1);
    const retry=page.waitForResponse(r=>r.url()===gateway.base+'/api/faucet/claim');await page.locator('#claimBtn').click();await retry;
    assert.equal(lastClaimBody.requestId,reservedRequestId,'transport retry keeps its original request identity');
    const owned=await rows();assert.equal(owned.length,1);assert.equal(owned[0].status,'reserved');assert.equal(owned[0].signature??null,null);
    assert.equal((await request('/api/faucet/claim/'+owned[0].id,undefined,B.session)).status,404);
    evidence.journeys.push('interrupted faucet response, safe retry, no signatures or payouts');
  });
  await t.test('late history from A cannot overwrite live B state',async()=>{
    let ready,release;const prepared=new Promise(resolve=>ready=resolve),wait=new Promise(resolve=>release=resolve);
    delayHistory={ready,release,wait,held:false};await page.goto(gateway.base+'/mole-hub/');await prepared;
    await page.evaluate(({session,wallet})=>{localStorage.setItem('winlew.verify.session',session);localStorage.setItem('winlew.verify.wallet',wallet);},{session:B.session,wallet:B.wallet});
    await page.evaluate(()=>window.syncServerWallet());assert.equal(await page.evaluate(()=>Number(localStorage.getItem('winlew.wallet'))),0);
    release();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));
    assert.equal(await page.evaluate(()=>Number(localStorage.getItem('winlew.wallet'))),0);
    assert.equal((await request('/api/profile/me',undefined,B.session)).data.games.history.length,0);
    delayHistory=null;evidence.journeys.push('late previous-account response discarded');
  });
  await t.test('expired URL session is removed and recovery keeps private history',async()=>{
    const {createSession}=await import('../../src/mole/sessions.js');const expired=createSession(B.id,1),now=Date.now();
    const clock=t.mock.method(Date,'now',()=>now+3000);
    try{
      await page.goto(gateway.base+'/mole-hub/?session='+expired+'&app=mole');
      await page.waitForFunction(()=>!localStorage.getItem('winlew.verify.session'));
      assert.equal(new URL(page.url()).searchParams.has('session'),false);
      assert.match(await page.locator('#yourPlayConnection').textContent(),/Guest/i);
    }finally{clock.mock.restore();}
    await persona(A.name);await page.goto(gateway.base+'/verify/profile.html');
    await page.waitForFunction(n=>document.getElementById('displayName')?.textContent===n,A.name);
    await expectTotalA(banked+10,'expired-session recovery');
    evidence.journeys.push('expired-session recovery restores only owner records');
  });
  await t.test('profile disconnect revokes the server session, not only browser storage',async()=>{
    await page.locator('#disconnectBtn').click();await page.waitForURL('**/verify/');
    assert.equal((await request('/api/profile/me',undefined,A.session)).status,401);
    assert.equal(await page.evaluate(()=>localStorage.getItem('winlew.verify.session')),null);
    evidence.journeys.push('real profile disconnect revokes its copied session');
  });
});
