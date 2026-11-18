import test from 'node:test';import assert from 'node:assert/strict';import {ArcadeRewardService,MemoryArcadeStore,GAME_RULES,discordCreatedAt,discordOldEnough} from './reward-engine.js';import {getArcadeConfig} from './config.js';
function harness(){let now=new Date('2026-09-19T12:00:00Z');let seq=0;const store=new MemoryArcadeStore();const service=new ArcadeRewardService({store,config:getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'dry-run',XL1_REWARD_PER_POINT:'0.05',XL1_DAILY_REWARD_CAP:'10'}),now:()=>now,id:()=>`s${++seq}`});return{service,advance:ms=>{now=new Date(now.getTime()+ms)}}}
// One eligible point is one second of the round (reward-engine.js), backed by a score at twice
// the game's minimum rate -- what a real round easily scores.
const realScore=(game,seconds)=>Math.ceil(seconds*GAME_RULES[game].minScorePerSecond*2);
async function earn(h,seconds,game='diglew'){const s=await h.service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game});h.advance(seconds*1000);return h.service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:realScore(game,seconds)})}
for(const[seconds,xl1]of[[20,'1'],[60,'3'],[199,'9.95'],[200,'10'],[300,'10']])test(`${seconds} s played => ${xl1} XL1`,async()=>{const h=harness();assert.equal((await earn(h,seconds)).actualXl1,xl1)});
test('every game pays the same for the same time played',async()=>{for(const game of ['diglew','pacmole','rootglide','burrowblaster','tunneltap','moleice','molespades']){const h=harness();const r=await earn(h,120,game);assert.equal(r.eligiblePoints,120,game);assert.equal(r.actualXl1,'6',game)}});
test('a round counts at most the round cap',async()=>{let now=new Date('2026-09-19T12:00:00Z');const service=new ArcadeRewardService({store:new MemoryArcadeStore(),config:getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'dry-run',XL1_REWARD_PER_POINT:'0.01',XL1_DAILY_REWARD_CAP:'100',XL1_ROUND_CAP_SECONDS:'300'}),now:()=>now,id:()=> 'capped'});const s=await service.start({identityId:'u1',wallet:'1'.repeat(40),game:'diglew'});now=new Date(now.getTime()+840000);const r=await service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:100000});assert.equal(r.eligiblePoints,300);assert.equal(r.actualXl1,'3')});
test('idle time and scripted rounds earn only what the score backs',async()=>{const h=harness();const s=await h.service.start({identityId:'u1',wallet:'1'.repeat(40),game:'diglew'});h.advance(300000);const r=await h.service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:1});assert.equal(r.eligiblePoints,0);const b=await h.service.start({identityId:'u1',wallet:'1'.repeat(40),game:'burrowblaster'});h.advance(300000);const r2=await h.service.complete({identityId:'u1',sessionId:b._id,nonce:b.nonce,rawScore:10});assert.equal(r2.eligiblePoints,50)});
test('one active round per player across all games',async()=>{const h=harness();const a=await h.service.start({identityId:'u1',wallet:'1'.repeat(40),game:'diglew'});const b=await h.service.start({identityId:'u1',wallet:'1'.repeat(40),game:'pacmole'});h.advance(60000);await assert.rejects(()=>h.service.complete({identityId:'u1',sessionId:a._id,nonce:a.nonce,rawScore:5000}),/session_not_active/);assert.equal((await h.service.complete({identityId:'u1',sessionId:b._id,nonce:b.nonce,rawScore:5000})).eligiblePoints,60)});
test('a session expires 10 minutes after the round cap',async()=>{const h=harness();const s=await h.service.start({identityId:'u1',wallet:'1'.repeat(40),game:'diglew'});assert.equal(new Date(s.expiresAt)-new Date(s.createdAt),900000)});
test('a round with no score earns nothing',async()=>{const h=harness();const s=await h.service.start({identityId:'u1',wallet:'1'.repeat(40),game:'diglew'});h.advance(120000);const r=await h.service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:0});assert.equal(r.eligiblePoints,0);assert.equal(r.actualXl1,'0')});
test('the default rate is about 0.10 XL1 for a 4-minute round, and the round cap is validated',async()=>{const c=getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'dry-run'});const pub=new ArcadeRewardService({store:new MemoryArcadeStore(),config:c}).publicConfig();assert.equal(pub.rewardPerPoint,'0.0004');assert.equal(pub.rewardPerMinute,'0.024');assert.equal(pub.roundCapMinutes,5);for(const bad of ['10','5000','1.5','x'])assert.throws(()=>getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_ROUND_CAP_SECONDS:bad}),/XL1_ROUND_CAP_SECONDS_invalid/)});
test('daily cap spans sessions and games',async()=>{const h=harness();assert.equal((await earn(h,40)).actualXl1,'2');const s=await h.service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'pacmole'});h.advance(480000);const r=await h.service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:170*500});assert.equal(r.actualXl1,'8');assert.equal((await h.service.summary('u1')).remainingXl1,'0')});
test('duplicate completion is idempotent',async()=>{const h=harness();const s=await h.service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'diglew'});h.advance(40000);const input={identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:2500};const[a,b]=await Promise.all([h.service.complete(input),h.service.complete(input)]);assert.equal(a.sessionId,b.sessionId);assert.equal((await h.service.summary('u1')).earnedXl1,'2')});
test('rejects invalid wallet, speed and score envelope',async()=>{const h=harness();await assert.rejects(()=>h.service.start({identityId:'u1',wallet:'typed address',game:'diglew'}),/verified_xl1_wallet_required/);const s=await h.service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'diglew'});await assert.rejects(()=>h.service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:1}),/completion_too_fast/);h.advance(40000);await assert.rejects(()=>h.service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:999999}),/score_impossible/)});
test('kill switch records paused zero reward',async()=>{let now=new Date('2026-09-19T12:00:00Z');const service=new ArcadeRewardService({store:new MemoryArcadeStore(),config:getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'dry-run',XL1_GAME_REWARDS_ENABLED:'false'}),now:()=>now,id:()=> 'paused'});const s=await service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'diglew'});now=new Date(now.getTime()+40000);const r=await service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:2500});assert.equal(r.status,'PAUSED');assert.equal(r.actualXl1,'0')});
test('live mode refuses to boot without an explicit signer adapter',()=>assert.throws(()=>getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'live'}),/requires_XL1_REWARD_SIGNER_ADAPTER/));
test('historical entries retain the rate used when earned',async()=>{const h=harness();const first=await earn(h,20);const changed=new ArcadeRewardService({store:h.service.store,config:getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'dry-run',XL1_REWARD_PER_POINT:'0.01',XL1_DAILY_REWARD_CAP:'10'}),now:h.service.now,id:()=> 'changed-rate'});const session=await changed.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'diglew'});h.advance(40000);const second=await changed.complete({identityId:'u1',sessionId:session._id,nonce:session.nonce,rawScore:2500});assert.equal(first.rewardRate,'0.05');assert.equal(second.rewardRate,'0.01')});
test('UTC date change creates a fresh daily allowance',async()=>{let now=new Date('2026-09-19T23:55:00Z');let id=0;const service=new ArcadeRewardService({store:new MemoryArcadeStore(),config:getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE:'dry-run'}),now:()=>now,id:()=>`reset-${++id}`});let s=await service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'diglew'});now=new Date('2026-09-19T23:59:00Z');await service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:50000});s=await service.start({identityId:'u1',wallet:'1111111111111111111111111111111111111111',game:'diglew'});now=new Date('2026-09-20T00:00:20Z');const next=await service.complete({identityId:'u1',sessionId:s._id,nonce:s.nonce,rawScore:5000});assert.equal(next.rewardDay,'2026-09-20');assert.equal(next.actualXl1,'0.032')});

test('expired sessions cannot earn', async () => {
  const h = harness();
  const s = await h.service.start({ identityId: 'u1', wallet: '1'.repeat(40), game: 'diglew' });
  h.advance(7200000);
  await assert.rejects(() => h.service.complete({ identityId: 'u1', sessionId: s._id, nonce: s.nonce, rawScore: 250 }), /session_expired/);
});

test('replaced sessions are rejected and completed retries still require the nonce', async () => {
  const h = harness();
  const s = await h.service.start({ identityId: 'u1', wallet: '1'.repeat(40), game: 'diglew' });
  const current = await h.service.start({ identityId: 'u1', wallet: '1'.repeat(40), game: 'diglew' });
  h.advance(40000);
  await assert.rejects(() => h.service.complete({ identityId: 'u1', sessionId: s._id, nonce: s.nonce, rawScore: 250 }), /session_not_active/);
  await h.service.complete({ identityId: 'u1', sessionId: current._id, nonce: current.nonce, rawScore: 250 });
  await assert.rejects(() => h.service.complete({ identityId: 'u1', sessionId: current._id, nonce: 'wrong', rawScore: 250 }), /session_nonce_invalid/);
});

test('an arbitrary adapter string cannot enable live payouts', () => {
  assert.throws(() => getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_MODE: 'live', XL1_REWARD_SIGNER_ADAPTER: 'anything' }), /supported_signer_adapter/);
});

test('ledger configuration rejects unsafe integer amounts', () => {
  assert.throws(() => getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_DAILY_REWARD_CAP: '9007199254.740992' }), /out_of_range/);
  assert.throws(() => getArcadeConfig({XL1_MIN_DISCORD_AGE_DAYS:'0',XL1_REWARD_PER_POINT: '9007199254.740992' }), /out_of_range/);
});

test('the three new games have their own limits', async () => {
  const h = harness();
  const play = async (game, ms, score) => { const s = await h.service.start({ identityId: `u-${game}-${ms}-${score}`, wallet: '1'.repeat(40), game }); h.advance(ms); return h.service.complete({ identityId: `u-${game}-${ms}-${score}`, sessionId: s._id, nonce: s.nonce, rawScore: score }); };
  assert.equal((await play('tunneltap', 30000, 3000)).eligiblePoints, 30);
  await assert.rejects(() => play('tunneltap', 30000, 5000), /score_impossible/);
  await assert.rejects(() => play('tunneltap', 10000, 100), /completion_too_fast/);
  assert.equal((await play('moleice', 60000, 1500)).eligiblePoints, 60);
  assert.equal((await play('molespades', 180000, 500)).eligiblePoints, 180);
  await assert.rejects(() => play('molespades', 60000, 100), /completion_too_fast/);
});

test('cash-out: nothing before 24 h, then each reward at its hold tier, never twice', async () => {
  const h = harness();
  await earn(h, 20); // 1 XL1
  await assert.rejects(() => h.service.cashout('u1'), /nothing_to_cash_out/);
  let b = await h.service.balance('u1');
  assert.equal(b.heldXl1, '1'); assert.equal(b.cashableNowXl1, '0'); assert.equal(b.rewards[0].next.multiplier, 1);
  h.advance(4 * 86400000); // 4 days: x2
  b = await h.service.balance('u1');
  assert.equal(b.cashableBaseXl1, '1'); assert.equal(b.cashableNowXl1, '2');
  const [a, c] = await Promise.all([h.service.cashout('u1'), h.service.cashout('u1').catch(e => e)]);
  assert.equal(a.cashedOutXl1, '2'); assert.equal(a.status, 'SIMULATED');
  assert.match(String(c.message || c.cashedOutXl1), /nothing_to_cash_out|^0$/);
  await assert.rejects(() => h.service.cashout('u1'), /nothing_to_cash_out/);
  assert.equal((await h.service.balance('u1')).heldXl1, '0');
});

test('live cash-out moves HELD rows to QUEUED with the multiplied amount for the worker', async () => {
  const h = harness();
  h.service.config = { ...h.service.config, mode: 'live' };
  const r = await earn(h, 20);
  assert.equal(r.status, 'HELD');
  h.advance(8 * 86400000); // x5
  const out = await h.service.cashout('u1');
  assert.equal(out.status, 'QUEUED'); assert.equal(out.cashedOutXl1, '5');
  const row = h.service.store.rewards.get(r.sessionId);
  assert.equal(row.status, 'QUEUED'); assert.equal(row.payoutUnits, '5000000'); assert.equal(row.multiplier, 5);
});

test('blocked players cannot start a rewarded game or cash out; an unreadable list stops cash-out only', async () => {
  let why = null;
  const h = harness();
  h.service.gate = async () => why;
  await earn(h, 20);
  h.advance(2 * 86400000);
  why = 'xl1_blocked';
  await assert.rejects(() => h.service.start({ identityId: 'u1', wallet: '1'.repeat(40), game: 'diglew' }), /xl1_rewards_blocked/);
  await assert.rejects(() => h.service.cashout('u1'), /xl1_rewards_blocked/);
  why = 'account_banned';
  await assert.rejects(() => h.service.cashout('u1'), /xl1_rewards_blocked/);
  why = 'blocklist_unavailable';
  await h.service.start({ identityId: 'u1', wallet: '1'.repeat(40), game: 'diglew' });
  await assert.rejects(() => h.service.cashout('u1'), /blocklist_unavailable/);
  why = 'needs_identity_sync';
  await assert.rejects(() => h.service.cashout('u1'), /needs_identity_sync/);
  why = null;
  assert.equal((await h.service.cashout('u1')).cashedOutXl1, '1');
});

test('week recap: seconds, players, games and the longest play times, with no ids or wallets', async () => {
  const h = harness();
  await earn(h, 120, 'pacmole');
  await earn(h, 60, 'diglew');
  await earn(h, 30, 'pacmole');
  const r = await h.service.weekRecap('2026-09-19');
  assert.deepEqual([r.from, r.to, r.players, r.rounds, r.seconds, r.earnedXl1], ['2026-09-13', '2026-09-19', 1, 3, 210, '10'])
  assert.deepEqual(r.games.map(g => [g.label, g.seconds, g.rounds, g.players]), [['Pac-Mole', 150, 2, 1], ['DigLEW', 60, 1, 1]]);
  assert.deepEqual(r.topSeconds, [210]);
  assert.ok(!/1111|u1/.test(JSON.stringify(r)), 'no wallets or player ids');
  assert.equal((await h.service.weekRecap('2026-09-12')).rounds, 0, 'the week before is empty');
  await assert.rejects(() => h.service.weekRecap('last-week'), /day_invalid/);
});

test('day recap: earned, cashed out and paid on that UTC day, totals only', async () => {
  const h = harness();
  await earn(h, 20);
  await earn(h, 30);
  let r = await h.service.dayRecap('2026-09-19');
  assert.deepEqual([r.simulated, r.players, r.rewards, r.earnedXl1, r.cashouts], [true, 1, 2, '2.5', 0]);
  h.advance(4 * 86400000);
  await h.service.cashout('u1');
  r = await h.service.dayRecap(new Date(h.service.now()).toISOString().slice(0, 10));
  assert.deepEqual([r.rewards, r.cashouts, r.cashedOutXl1], [0, 1, '5']);
  assert.ok(!JSON.stringify(r).includes('1111'), 'no wallets in the recap');
  await assert.rejects(() => h.service.dayRecap('yesterday'), /day_invalid/);
});


// ── Integrity, layer 1 (owner, 2026-10-24) ──
const OLD = '1100000000000000000';           // a Discord ID from 2023
const snowflakeAt = d => String((BigInt(d.getTime()) - 1420070400000n) << 22n);
test('earning needs a Discord account at least 30 days old; play does not', async () => {
  let now = new Date('2026-10-24T12:00:00Z');
  const service = new ArcadeRewardService({ store: new MemoryArcadeStore(), config: getArcadeConfig({ XL1_REWARD_MODE: 'dry-run' }), now: () => now, id: () => 'age' });
  assert.equal(discordCreatedAt(OLD).getUTCFullYear(), 2023);
  const young = snowflakeAt(new Date('2026-10-10T12:00:00Z'));
  const month = snowflakeAt(new Date('2026-09-24T12:00:00Z'));
  await assert.rejects(() => service.start({ identityId: young, wallet: '1'.repeat(40), game: 'diglew' }), /discord_account_too_new/);
  await assert.rejects(() => service.start({ identityId: 'not-a-snowflake', wallet: '1'.repeat(40), game: 'diglew' }), /discord_account_too_new/);
  assert.ok(await service.start({ identityId: month, wallet: '1'.repeat(40), game: 'diglew' }), 'exactly 30 days old may earn');
  assert.ok(discordOldEnough(young, now, 0), 'XL1_MIN_DISCORD_AGE_DAYS=0 turns the check off');
  for (const bad of ['-1', '1.5', 'x', '4000']) assert.throws(() => getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: bad }), /XL1_MIN_DISCORD_AGE_DAYS_invalid/);
});

test('the daily cap holds per wallet: two accounts on one wallet share one cap', async () => {
  let now = new Date('2026-10-24T12:00:00Z'); let n = 0;
  const service = new ArcadeRewardService({ store: new MemoryArcadeStore(), config: getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0', XL1_REWARD_MODE: 'dry-run', XL1_REWARD_PER_POINT: '0.05', XL1_DAILY_REWARD_CAP: '10' }), now: () => now, id: () => `w${++n}` });
  const play = async (identityId, wallet, seconds) => { const s = await service.start({ identityId, wallet, game: 'diglew' }); now = new Date(now.getTime() + seconds * 1000); return service.complete({ identityId, sessionId: s._id, nonce: s.nonce, rawScore: 20000 }) };
  const W = '2'.repeat(40);
  assert.equal((await play('alt-1', W, 160)).actualXl1, '8');
  assert.equal((await play('alt-2', W, 160)).actualXl1, '2', 'the second account only gets what the wallet has left');
  assert.equal((await play('alt-3', W, 160)).actualXl1, '0');
  assert.equal((await play('alt-3', '3'.repeat(40), 160)).actualXl1, '8', 'another wallet has its own cap');
});

test('a 30-day-old Discord account earns through a whole round; a blank setting means 30, not off', async () => {
  let now = new Date('2026-10-24T12:00:00Z');
  const service = new ArcadeRewardService({ store: new MemoryArcadeStore(), config: getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '', XL1_REWARD_MODE: 'dry-run', XL1_REWARD_PER_POINT: '0.05', XL1_DAILY_REWARD_CAP: '10' }), now: () => now, id: () => 'whole' });
  assert.equal(getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '  ' }).minDiscordAgeDays, 30);
  assert.equal(getArcadeConfig({}).minDiscordAgeDays, 30);
  assert.equal(getArcadeConfig({ XL1_MIN_DISCORD_AGE_DAYS: '0' }).minDiscordAgeDays, 0);
  const s = await service.start({ identityId: OLD, wallet: '4'.repeat(40), game: 'diglew' });
  now = new Date(now.getTime() + 60000);
  assert.equal((await service.complete({ identityId: OLD, sessionId: s._id, nonce: s.nonce, rawScore: 2000 })).actualXl1, '3');
});
