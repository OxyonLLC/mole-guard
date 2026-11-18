import { getMongoDb, isMongoEnabled } from '../lib/mongo.js';
import { unitsToDecimal } from './config.js';
import { earnedTotals } from './ledger-totals.js';

export class MongoArcadeStore {
  constructor() { this.ready = null; }
  async collections() {
    if (!isMongoEnabled()) throw new Error('xl1_arcade_requires_mongodb');
    const db = await getMongoDb();
    if (!db) throw new Error('xl1_arcade_requires_mongodb');
    const sessions=db.collection(process.env.XL1_ARCADE_SESSIONS_COLLECTION||'xl1_arcade_sessions');
    const days=db.collection(process.env.XL1_ARCADE_LEDGER_COLLECTION||'xl1_arcade_reward_days');
    const walletDays=db.collection(process.env.XL1_ARCADE_WALLET_LEDGER_COLLECTION||'xl1_arcade_wallet_days');
    const decisions=db.collection(process.env.XL1_ARCADE_REVIEW_DECISIONS_COLLECTION||'xl1_arcade_review_decisions');
    if(!this.ready)this.ready=Promise.all([sessions.createIndex({identityId:1,state:1}),sessions.createIndex({expiresAt:1},{expireAfterSeconds:86400}),days.createIndex({identityId:1,rewardDay:1},{unique:true}),days.createIndex({rewardDay:1}),days.createIndex({'rewards.status':1})]);
    await this.ready; return {sessions,days,walletDays,decisions,health:db.collection('xl1_arcade_worker')};
  }
  async createSession(session){const{sessions}=await this.collections();await sessions.updateMany({identityId:session.identityId,state:'ACTIVE'},{$set:{state:'REJECTED',rejectionReason:'superseded',updatedAt:session.createdAt}});await sessions.insertOne(session);return session;}
  async getSession(id){const{sessions}=await this.collections();return sessions.findOne({_id:String(id)});}
  async getRewardBySession(id){const{days}=await this.collections();const doc=await days.findOne({'rewards.sessionId':String(id)},{projection:{rewards:{$elemMatch:{sessionId:String(id)}}}});return doc?.rewards?.[0]||null;}
  async reserveReward(input){
    const { sessions, days } = await this.collections();
    // Persist the first completion before touching the day ledger. Retries,
    // including ones crossing UTC midnight or a config change, reuse this input.
    const reservation = input.requestedUnits == null ? null : {
      rawScore: input.rawScore, eligiblePoints: input.eligiblePoints, elapsedMs: input.elapsedMs ?? null,
      requestedUnits: String(input.requestedUnits), capUnits: String(input.capUnits),
      rateUnits: String(input.rateUnits), day: input.day, status: input.status,
      mode: input.mode, network: input.network, chainId: input.chainId, now: input.now,
    };
    const claimed = await sessions.findOneAndUpdate({
      _id: input.session._id, identityId: input.session.identityId,
      nonce: input.session.nonce, state: { $in: ['ACTIVE', 'VALIDATING'] },
    }, [{ $set: { state: 'VALIDATING', reservation: { $ifNull: ['$reservation', { $literal: reservation }] } } }],
    { returnDocument: 'after' });
    if (!claimed) {
      const previous = await this.getRewardBySession(input.session._id);
      if (previous) return previous;
      throw new Error('session_not_active');
    }
    if (!claimed.reservation) throw new Error('reward_reservation_failed');
    input = { ...claimed.reservation, session: claimed,
      requestedUnits: BigInt(claimed.reservation.requestedUnits),
      capUnits: BigInt(claimed.reservation.capUnits), rateUnits: BigInt(claimed.reservation.rateUnits) };
    const requested=Number(input.requestedUnits<input.capUnits?input.requestedUnits:input.capUnits);const cap=Number(input.capUnits);const paused=input.status==='PAUSED';
    const base={sessionId:input.session._id,identityId:input.session.identityId,wallet:input.session.wallet,game:input.session.game,rawScore:input.rawScore,eligiblePoints:input.eligiblePoints,elapsedMs:input.elapsedMs??null,rateUnits:String(input.rateUnits),calculatedUnits:String(input.requestedUnits),rewardRate:unitsToDecimal(input.rateUnits),calculatedXl1:unitsToDecimal(input.requestedUnits),status:input.status,mode:input.mode,network:input.network,chainId:input.chainId,rewardDay:input.day,createdAt:input.now,paidAt:null,transactionHash:null};
    // The daily cap holds per WALLET as well as per account (owner, 2026-10-24): one wallet
    // verified on several Discord accounts must not collect the cap on each. The wallet's own
    // ledger is reserved first, atomically and once per session; the account reservation then
    // asks only for what the wallet allowed, and the wallet is settled down to what was actually
    // awarded. Every step is keyed by the session, so a retry never counts a round twice.
    const walletAllowed = paused ? 0 : await this.reserveWallet({ wallet: input.session.wallet, day: input.day, sessionId: input.session._id, requested, cap, now: input.now });
    const accountAsk = Math.min(requested, walletAllowed);
    const key=`${input.session.identityId}:${input.day}`;
    const reserve = () => days.findOneAndUpdate({_id:key,'rewards.sessionId':{$ne:input.session._id}},[
      {$set:{identityId:input.session.identityId,rewardDay:input.day,totalUnits:{$ifNull:['$totalUnits',0]},rewards:{$ifNull:['$rewards',[]]},__award:paused?0:{$min:[accountAsk,{$max:[0,{$subtract:[cap,{$ifNull:['$totalUnits',0]}]}]}]}}},
      {$set:{totalUnits:{$add:['$totalUnits','$__award']},rewards:{$concatArrays:['$rewards',[{$mergeObjects:[{$literal:base},{actualUnits:{$toString:{$toLong:'$__award'}},actualXl1:{$let:{vars:{whole:{$floor:{$divide:['$__award',1000000]}},fraction:{$mod:['$__award',1000000]}},in:{$toString:{$divide:['$__award',1000000]}}}}}]}]]},updatedAt:input.now}},{$unset:'__award'}
    ],{upsert:true,returnDocument:'after'});
    let result;
    try { result = await reserve(); }
    catch (error) {
      if (error?.code !== 11000) throw error;
      // An initial upsert can race a DIFFERENT game's first award that day.
      // A same-session race already has its result; otherwise retry the update.
      const previous = await this.getRewardBySession(input.session._id);
      if (!previous) result = await reserve();
    }
    let row=result?.rewards?.find(r=>r.sessionId===input.session._id)||await this.getRewardBySession(input.session._id);
    if(!row)throw new Error('reward_reservation_failed');
    // Normalize the display string from authoritative integer units rather than Mongo floating formatting.
    row={...row,actualXl1:unitsToDecimal(BigInt(row.actualUnits))};
    if (!paused) await this.settleWallet({ wallet: input.session.wallet, day: input.day, sessionId: input.session._id, awarded: Number(row.actualUnits) });
    await sessions.updateOne({_id:input.session._id,state:'VALIDATING'},{$set:{state:row.status,completedAt:input.now,rawScore:input.rawScore,eligiblePoints:input.eligiblePoints}});
    return row;
  }
  async summary(identityId,day,cap){const{days}=await this.collections();const doc=await days.findOne({_id:`${identityId}:${day}`});const used=BigInt(doc?.totalUnits||0);return{rewardDay:day,eligiblePoints:(doc?.rewards||[]).reduce((n,r)=>n+Number(r.eligiblePoints||0),0),earnedXl1:unitsToDecimal(used),remainingXl1:unitsToDecimal(BigInt(cap)-used>0n?BigInt(cap)-used:0n),recent:(doc?.rewards||[]).slice(-10).reverse().map(r=>({...r,actualXl1:unitsToDecimal(BigInt(r.actualUnits||0))}))};}
  // Every reward row that could count toward one day's recap (earned, cashed out or paid that day).
  async rewardsForRecap(day) {
    const { days } = await this.collections();
    const start = new Date(`${day}T00:00:00Z`), end = new Date(start.getTime() + 86400000);
    const docs = await days.aggregate([{ $unwind: '$rewards' }, { $match: { $or: [
      { 'rewards.rewardDay': day }, { 'rewards.cashedAt': { $gte: start, $lt: end } }, { 'rewards.paidAt': { $gte: start, $lt: end } },
    ] } }]).toArray();
    return docs.map(d => d.rewards);
  }
  // A wallet's share of the daily cap for one session: reserved once, and later settled to what the
  // account reservation actually awarded (it may be less, if the account's own cap was nearer).
  async reserveWallet({ wallet, day, sessionId, requested, cap, now }) {
    const { walletDays } = await this.collections();
    const _id = `${wallet}:${day}`;
    const field = `awards.${sessionId}`;
    const take = () => walletDays.findOneAndUpdate({ _id, [field]: { $exists: false } }, [
      { $set: { wallet, rewardDay: day, totalUnits: { $ifNull: ['$totalUnits', 0] }, awards: { $ifNull: ['$awards', {}] } } },
      { $set: { __take: { $min: [requested, { $max: [0, { $subtract: [cap, '$totalUnits'] }] }] } } },
      { $set: { totalUnits: { $add: ['$totalUnits', '$__take'] }, [field]: '$__take', updatedAt: now } },
      { $unset: '__take' },
    ], { upsert: true, returnDocument: 'after' });
    // E11000 means another round created the day's document first (or this session's share already
    // exists, on a retry): read the share back, or take it from the document that now exists.
    const attempt = async () => {
      try { return await take(); }
      catch (error) {
        if (error?.code !== 11000) throw error;
        return await walletDays.findOne({ _id, [field]: { $exists: true } }) || await take().catch(e => { if (e?.code === 11000) return walletDays.findOne({ _id }); throw e; });
      }
    };
    let doc = await attempt() || await walletDays.findOne({ _id });
    let share = doc?.awards?.[sessionId];
    // Short of the full ask: a round that stalled after taking its share (the server died, nobody
    // retried) would otherwise hold that allowance for the rest of the day. Release stale shares,
    // then take again. Only this session's own fresh share is never touched.
    if (Number.isFinite(share) && share < requested && share === doc.awards[sessionId] && !doc.settled?.[sessionId]) {
      if (await this.releaseStaleWalletShares({ wallet, day, keep: sessionId, now })) {
        await walletDays.updateOne({ _id, [`settled.${sessionId}`]: { $exists: false } }, [
          { $set: { __more: { $min: [requested - share, { $max: [0, { $subtract: [cap, '$totalUnits'] }] }] } } },
          { $set: { totalUnits: { $add: ['$totalUnits', '$__more'] }, [field]: { $add: [`$${field}`, '$__more'] } } },
          { $unset: '__more' },
        ]);
        share = (await walletDays.findOne({ _id }))?.awards?.[sessionId];
      }
    }
    if (!Number.isFinite(share)) throw new Error('reward_reservation_failed');
    return share;
  }
  // Unsettled shares whose round has not moved for 15 minutes are settled to what the round really
  // earned (its ledger row, else nothing). A live round settles within seconds, so this only ever
  // touches rounds that died between their two steps. True if any allowance came back.
  async releaseStaleWalletShares({ wallet, day, keep, now }) {
    const { walletDays, sessions } = await this.collections();
    const doc = await walletDays.findOne({ _id: `${wallet}:${day}` });
    let released = false;
    for (const sid of Object.keys(doc?.awards || {})) {
      if (sid === keep || doc.settled?.[sid]) continue;
      const s = await sessions.findOne({ _id: sid });
      const movedAt = new Date(s?.completedAt || s?.reservation?.now || s?.createdAt || 0).getTime();
      if (s?.state === 'VALIDATING' && now.getTime() - movedAt < 15 * 60_000) continue;
      const row = await this.getRewardBySession(sid);
      await this.settleWallet({ wallet, day, sessionId: sid, awarded: Number(row?.actualUnits || 0) });
      released = true;
    }
    return released;
  }
  async settleWallet({ wallet, day, sessionId, awarded }) {
    const { walletDays } = await this.collections();
    const field = `awards.${sessionId}`;
    await walletDays.updateOne({ _id: `${wallet}:${day}`, [`settled.${sessionId}`]: { $exists: false } }, [
      { $set: { totalUnits: { $subtract: ['$totalUnits', { $subtract: [`$${field}`, awarded] }] }, [field]: awarded, [`settled.${sessionId}`]: true } },
    ]);
  }
  // Layer 2: a player's rows, and any account's rows on their wallet(s), since a UTC day.
  async listForIntegrity(identityId, wallets, sinceDay) {
    const { days } = await this.collections();
    const who = { $or: [{ 'rewards.identityId': String(identityId) }, { 'rewards.wallet': { $in: wallets } }] };
    const docs = await days.aggregate([{ $match: { rewardDay: { $gte: sinceDay } } }, { $unwind: '$rewards' }, { $match: who }]).toArray();
    return docs.map(d => d.rewards);
  }
  async listByStatus(status, identityId = null) {
    const { days } = await this.collections();
    const docs = await days.aggregate([{ $match: { 'rewards.status': status, ...(identityId ? { identityId: String(identityId) } : {}) } },
      { $unwind: '$rewards' }, { $match: { 'rewards.status': status } }]).toArray();
    return docs.map(d => d.rewards);
  }
  // The first decision on a review wins, in one insert; a later click (the same decision retried, or
  // the other one) reads it back. decideReview then applies it, idempotently.
  async claimDecision({ id, to, by, now }) {
    const { decisions } = await this.collections();
    try { await decisions.insertOne({ _id: id, to, by: String(by), at: now }); return { to, by: String(by), at: now }; }
    catch (error) { if (error?.code !== 11000) throw error; const had = await decisions.findOne({ _id: id }); return { ...had, again: true }; }
  }
  // A moderator's decision on one flagged cash-out: FLAGGED -> QUEUED (paid) or DECLINED (never paid).
  async decideReview({ identityId, cashedAt, to, by, now }) {
    const { days } = await this.collections();
    const r = await days.updateMany({ identityId: String(identityId), rewards: { $elemMatch: { status: 'FLAGGED', cashedAt } } },
      { $set: { 'rewards.$[r].status': to, 'rewards.$[r].review.decidedBy': String(by), 'rewards.$[r].review.decidedAt': now, updatedAt: now } },
      { arrayFilters: [{ 'r.status': 'FLAGGED', 'r.cashedAt': cashedAt }] });
    return r.modifiedCount;
  }
  // Every reward row earned on the UTC days from..to (inclusive), for the weekly recap.
  async rewardsForDays(from, to) {
    const { days } = await this.collections();
    // Each day document is one player's UTC day, so the week is matched (on its index) before the
    // rows are unwound: the endpoint is public, and must not scan the whole ledger per call.
    const docs = await days.aggregate([{ $match: { rewardDay: { $gte: String(from), $lte: String(to) } } }, { $project: { rewards: 1 } },
      { $unwind: '$rewards' }, { $match: { 'rewards.rewardDay': { $gte: String(from), $lte: String(to) } } }]).toArray();
    return docs.map(d => d.rewards);
  }
  // Held rewards (not yet cashed out), oldest first. Dry-run holds SIMULATED rows, live holds HELD.
  async listHeld(identityId, mode) {
    const { days } = await this.collections();
    const status = mode === 'dry-run' ? 'SIMULATED' : 'HELD';
    const docs = await days.aggregate([
      { $match: { identityId, 'rewards.status': status } }, { $unwind: '$rewards' },
      { $match: { 'rewards.status': status, 'rewards.cashedAt': { $exists: false } } },
      { $sort: { 'rewards.createdAt': 1 } },
    ]).toArray();
    return docs.map(d => d.rewards);
  }
  // Conditional per row: a row already cashed out (a double click, a second tab) is skipped, never paid twice.
  // `to` FLAGGED (layer 2) holds a cash-out for a moderator: the payout worker pays QUEUED only.
  async markCashedOut(rows, { now, mode, to: toStatus = null, review = null }) {
    const { days } = await this.collections();
    const from = mode === 'dry-run' ? 'SIMULATED' : 'HELD';
    const to = mode === 'dry-run' ? 'SIMULATED' : (toStatus || 'QUEUED');
    const done = [];
    for (const r of rows) {
      const result = await days.updateOne(
        { _id: `${r.identityId}:${r.rewardDay}`, rewards: { $elemMatch: { sessionId: r.sessionId, status: from, cashedAt: { $exists: false } } } },
        { $set: { 'rewards.$.status': to, 'rewards.$.multiplier': r.multiplier, 'rewards.$.payoutUnits': String(r.payoutUnits),
          'rewards.$.payoutXl1': unitsToDecimal(BigInt(r.payoutUnits)), 'rewards.$.cashedAt': now, updatedAt: now,
          ...(review ? { 'rewards.$.review': review } : {}) } });
      if (result.modifiedCount) done.push(r);
    }
    return done;
  }
  async publicStats(day, capUnits, mode = 'dry-run') {
    const { days, health } = await this.collections();
    const docs = await days.find({}).toArray();
    const all = docs.flatMap(d => d.rewards || []);
    const paid = all.filter(r => r.status === 'PAID');
    const simulated = all.filter(r => r.status === 'SIMULATED');
    const rewards = mode === 'dry-run' ? simulated : paid;
    // Paid and cashed-out rows count what was (or would be) sent: the base reward times its hold multiplier.
    const sum = rows => rows.reduce((n, r) => n + BigInt(r.payoutUnits ?? r.actualUnits ?? 0), 0n);
    const walletTotals = [...rewards.filter(r => BigInt(r.actualUnits || 0) > 0n)
      .reduce((map, r) => map.set(r.wallet, (map.get(r.wallet) || 0n) + BigInt(r.actualUnits)), new Map()).values()]
      .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const byGame = Object.fromEntries([...new Set(rewards.map(r => r.game))]
      .map(game => [game, unitsToDecimal(sum(rewards.filter(r => r.game === game)))]));
    const capHits = docs.filter(d => BigInt(d.totalUnits || 0) >= BigInt(capUnits)).length;
    const worker = health ? await health.findOne({ _id: 'health' }) : null;
    return {
      distributedTodayXl1: unitsToDecimal(sum(paid.filter(r => r.paidAt && new Date(r.paidAt).toISOString().slice(0, 10) === day))),
      distributedLifetimeXl1: unitsToDecimal(sum(paid)),
      simulatedTodayXl1: unitsToDecimal(sum(simulated.filter(r => r.rewardDay === day))),
      simulatedLifetimeXl1: unitsToDecimal(sum(simulated)),
      rewardCount: rewards.length, uniqueRewardedWallets: walletTotals.length, byGame,
      ...earnedTotals(all, mode, day),
      averagePerRewardedWalletXl1: unitsToDecimal(walletTotals.length ? sum(rewards) / BigInt(walletTotals.length) : 0n),
      medianPerRewardedWalletXl1: unitsToDecimal(walletTotals.length ? walletTotals[Math.floor((walletTotals.length - 1) / 2)] : 0n),
      percentRewardDaysAtCap: docs.length ? Math.round(capHits / docs.length * 1000) / 10 : 0,
      distributorRunwayDays: null,
      distributorBalanceXl1: worker?.balanceAtto ? unitsToDecimal(BigInt(worker.balanceAtto) / 1000000000000n) : null,
      workerStatus: worker?.status || 'NOT_STARTED', workerCheckedAt: worker?.checkedAt || null,
      lowBalance: worker?.lowBalance ?? null,
      recent: all.filter(r => r.mode === mode).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10).map(r => ({ game: r.game, actualXl1: unitsToDecimal(BigInt(r.actualUnits || 0)),
          status: r.status, transactionHash: r.transactionHash || null, createdAt: r.createdAt })),
    };
  }
}
