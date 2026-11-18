import crypto from 'node:crypto';
import { ArcadeRewardService, rewardDay } from './reward-engine.js';
import { MongoArcadeStore } from './mongo-store.js';
import { getArcadeConfig } from './config.js';
import { checkPayoutAllowed } from '../services/payoutGate.js';
import { isDiscordIdentity } from './verify-start.js';

// Who may be paid: WinLEW's own bans (the same gate as every Mole Guard payout) and the XL1
// rewards block list that GeoHackers moderators keep. An unreachable list is a reason, not a pass.
const XL1_BLOCKLIST_URL=(process.env.XL1_BLOCKLIST_URL||'http://127.0.0.1:8791').replace(/\/$/,'');
export async function rewardGate({identityId,wallet}){const winlew=checkPayoutAllowed({wallet,discordUserId:identityId});if(!winlew.allowed)return winlew.reason;try{const q=new URLSearchParams({wallet:wallet||'',discordUserId:identityId||''});const r=await fetch(`${XL1_BLOCKLIST_URL}/blocklist/check?${q}`,{signal:AbortSignal.timeout(5000)});if(!r.ok)return 'blocklist_unavailable';return (await r.json()).blocked?'xl1_blocked':null}catch{return 'blocklist_unavailable'}}

function errorStatus(message){if(message==='authentication_required'||message==='verified_xl1_wallet_required')return 401;if(message==='session_not_found')return 404;if(message==='nothing_to_cash_out')return 409;if(message==='xl1_rewards_blocked'||message==='needs_identity_sync'||message==='discord_account_too_new')return 403;if(message==='blocklist_unavailable')return 503;if(message.includes('requires_mongodb')||message==='xl1_verification_unavailable'||message==='xl1_verify_unavailable')return 503;return 400;}
export function registerXL1ArcadeRoutes(app,{getIdentity,getVerifiedWallet,startVerification,rateLimit}={}){
  const config=getArcadeConfig();const store=new MongoArcadeStore();const service=new ArcadeRewardService({store,config,gate:rewardGate});const limited=rateLimit||((_req,_res,next)=>next());
  app.get('/api/xl1-arcade/config',(_req,res)=>res.json(service.publicConfig()));
  app.get('/api/xl1-arcade/activity',limited,async(_req,res)=>{try{res.json({...service.publicConfig(),...(await store.publicStats(rewardDay(),config.dailyCap,config.mode))})}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.get('/api/xl1-arcade/me',limited,async(req,res)=>{try{const identity=await getIdentity(req);if(!identity)throw new Error('authentication_required');res.json({...await service.summary(identity.id),wallet:await getVerifiedWallet(identity.id),discord:isDiscordIdentity(identity.id)})}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  // "Verify XL1 wallet": a GeoHackers verify link for this signed-in player (verify-start.js).
  app.post('/api/xl1-arcade/verify-wallet',limited,async(req,res)=>{try{const identity=await getIdentity(req);if(!identity)throw new Error('authentication_required');if(!startVerification)throw new Error('xl1_verify_unavailable');res.setHeader('cache-control','no-store');res.json(await startVerification(identity.id))}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.get('/api/xl1-arcade/balance',limited,async(req,res)=>{try{const identity=await getIdentity(req);if(!identity)throw new Error('authentication_required');res.json(await service.balance(identity.id))}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.post('/api/xl1-arcade/cashout',limited,async(req,res)=>{try{const identity=await getIdentity(req);if(!identity)throw new Error('authentication_required');const wallet=await getVerifiedWallet(identity.id);res.json(await service.cashout(identity.id,{wallet}))}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  // Layer 2 review (GeoHackers' moderator buttons). A secret in its own header: winlew.co's relay
  // forwards only an allow-list of headers, so it can't arrive from outside, and without a
  // configured token these routes don't exist.
  // Digests, so any header bytes compare in constant time without throwing (a latin1 header that
  // matches the token's length in characters but not in bytes made timingSafeEqual throw).
  const digest=v=>crypto.createHash('sha256').update(String(v),'utf8').digest();
  const reviewAllowed=req=>{try{const want=config.reviewToken;if(!want)return false;return crypto.timingSafeEqual(digest(req.get('x-arcade-review-token')||''),digest(want))}catch{return false}};
  app.get('/api/xl1-arcade/admin/reviews',limited,async(req,res)=>{if(!reviewAllowed(req))return res.status(404).json({error:'not_found'});try{res.setHeader('cache-control','no-store');res.json({reviews:await service.reviews()})}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.post('/api/xl1-arcade/admin/reviews/:id/:decision',limited,async(req,res)=>{if(!reviewAllowed(req))return res.status(404).json({error:'not_found'});try{res.json(await service.decide(req.params.id,req.params.decision,req.body?.by))}catch(error){res.status(/review_not_found/.test(error.message)?404:/invalid|required/.test(error.message)?400:errorStatus(error.message)).json({error:error.message})}});
  app.get('/api/xl1-arcade/recap',limited,async(req,res)=>{try{res.json(await service.dayRecap(String(req.query.day||'')))}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.get('/api/xl1-arcade/week',limited,async(req,res)=>{try{res.json(await service.weekRecap(String(req.query.end||'')))}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.post('/api/xl1-arcade/sessions',limited,async(req,res)=>{try{const identity=await getIdentity(req);if(!identity)throw new Error('authentication_required');const wallet=await getVerifiedWallet(identity.id);const session=await service.start({identityId:identity.id,wallet,game:String(req.body?.game||'')});res.status(201).json({sessionId:session._id,nonce:session.nonce,mode:config.mode,state:session.state,expiresAt:session.expiresAt})}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  app.post('/api/xl1-arcade/sessions/:id/complete',limited,async(req,res)=>{try{const identity=await getIdentity(req);if(!identity)throw new Error('authentication_required');const reward=await service.complete({identityId:identity.id,sessionId:req.params.id,nonce:req.body?.nonce,rawScore:req.body?.rawScore});res.json({ok:true,reward})}catch(error){res.status(errorStatus(error.message)).json({error:error.message})}});
  return service;
}
