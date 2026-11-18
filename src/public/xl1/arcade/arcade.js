(function(){
  'use strict'
  const $=id=>document.getElementById(id)
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const short=value=>{const s=String(value||'');return s.length>14?`${s.slice(0,7)}…${s.slice(-5)}`:s}
  const GAMES={diglew:'DigLEW',pacmole:'Pac-Mole',rootglide:'Root Glide',burrowblaster:'Burrow Blaster',tunneltap:'Tunnel Tap',moleice:'Mole Ice',molespades:'Mole Spades',grubdrop:'Grub Drop'}
  // Ledger states in plain words (see "Live, held and paid" on the page).
  const STATES={HELD:'held',QUEUED:'queued for payment',SUBMITTED:'payment sent, confirming',PAID:'paid on-chain',REVIEW:'under review',PAUSED:'paused',SIMULATED:'simulated'}
  // A decimal string times a whole number, without floating-point noise: "0.004" × 300 = "1.2".
  const times=(dec,n)=>{const [w,f='']=String(dec).split('.');const scale=10n**BigInt(f.length);const v=BigInt(w+f)*BigInt(n);const s=(v/scale).toString(),r=(v%scale).toString().padStart(f.length,'0').replace(/0+$/,'');return r?`${s}.${r}`:s}
  // The WinLEW community, for anyone stuck (the same invite as the footer).
  const HELP='https://discord.gg/PSCrBzqdbE'
  const helpLink=text=>` <a href="${HELP}" rel="noopener">${text}</a>`
  // Tells the "New to XL1?" guide (shared/onboarding.js) where this visitor is.
  const announce=state=>{try{dispatchEvent(new CustomEvent('wl:account',{detail:{state}}))}catch{}}
  let authReady
  function loadAuth(){if(window.WinLEWAuth)return Promise.resolve(window.WinLEWAuth);if(authReady)return authReady;authReady=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/assets/wallet-auth.js';script.onload=()=>resolve(window.WinLEWAuth);script.onerror=reject;document.head.appendChild(script)});return authReady}
  async function json(path){const auth=await loadAuth();const response=await auth.hubApiFetch(path,{headers:{accept:'application/json'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}
  let explorerNet='mainnet'
  const tierText=tiers=>tiers.map(t=>`${String(t.after).replace(/^(\d+)d$/,(_,n)=>`${n} days`).replace(/^(\d+)h$/,'$1 h')} ×${t.multiplier}`).join(' · ')
  function renderConfig(d){
    explorerNet=d.network==='mainnet'?'mainnet':'sequence'
    $('rate').textContent=d.rewardPerMinute??d.rewardPerPoint
    $('rule-rate').textContent=`Each minute of a finished round earns ${d.rewardPerMinute??d.rewardPerPoint} XL1`
    if(d.roundCapMinutes)document.querySelectorAll('.round-cap-minutes').forEach(el=>{el.textContent=d.roundCapMinutes})
    // From whole seconds (rewardPerPoint is per second): a 90 s cap is 1.5 minutes.
    const capSeconds=Math.round(Number(d.roundCapMinutes)*60)
    if(d.rewardPerPoint&&Number.isInteger(capSeconds)&&capSeconds>0)$('round-max').textContent=times(d.rewardPerPoint,capSeconds)
    $('cap').textContent=d.dailyCap;document.querySelectorAll('.cap-copy').forEach(el=>{el.textContent=d.dailyCap})
    if(Array.isArray(d.holdTiers)&&d.holdTiers.length)document.querySelectorAll('#hold-tiers,.hold-tiers-copy').forEach(el=>{el.textContent=tierText(d.holdTiers)})
    if(d.rewardPerMinute)document.querySelectorAll('.rate-copy').forEach(el=>{el.textContent=d.rewardPerMinute})
    if(Number.isInteger(d.minDiscordAgeDays)){document.querySelectorAll('.age-copy').forEach(el=>{el.textContent=d.minDiscordAgeDays});document.querySelectorAll('.age-rule').forEach(el=>{el.hidden=d.minDiscordAgeDays<=0})}
    if(Number.isInteger(d.minDiscordAgeDays))$('rule-age').textContent=d.minDiscordAgeDays>0?`, and the Discord account must be at least ${d.minDiscordAgeDays} days old to earn`:''
    $('distributor').textContent=short(d.distributor);$('distributor').title=d.distributor||''
    $('explorer-link').href=`https://explore.xyo.network/xl1/${explorerNet}${d.distributor?`/address/${encodeURIComponent(d.distributor)}`:''}`
    const chip=$('mode-chip')
    if(!d.enabled){chip.className='chip chip-experimental';chip.textContent='Paused';$('mode-tag').textContent='rewards paused';$('mode-callout').textContent='Rewards are paused. Games remain playable; new rewards are not being recorded.'}
    else if(d.simulated){chip.className='chip chip-experimental';chip.textContent='Dry run';$('mode-tag').textContent='simulated';$('mode-callout').textContent='Rewards are simulated right now: nothing is sent, and simulated rewards are not tokens.'}
    else{chip.className='chip chip-live';chip.textContent='Live';$('mode-tag').textContent=`real XL1 · ${explorerNet}`;$('mode-callout').textContent=`Rewards are live: real XL1 on ${explorerNet==='mainnet'?'XL1 Mainnet':'XL1 Sequence'}, paid on-chain when you cash out.`}
  }
  function configUnavailable(){const chip=$('mode-chip');chip.className='chip chip-experimental';chip.textContent='Unavailable';$('mode-tag').textContent='reward status';$('mode-callout').textContent='The reward status could not be read just now. Games remain playable; reload to try again.'}
  function renderActivity(d){renderConfig(d)
    const labels=document.querySelectorAll('#public-stats span'),values=document.querySelectorAll('#public-stats strong')
    // Older backends only report paid totals; never present those as "earned".
    const hasEarned=d.earnedLifetimeXl1!=null
    const rows=d.simulated
      ?[['Simulated today',`${d.simulatedTodayXl1||'0'} XL1`],['Simulated, all time',`${d.simulatedLifetimeXl1||'0'} XL1`],['Rewards',d.rewardCount||0],['Players rewarded',d.uniqueRewardedWallets||0]]
      // Earned is the base reward; paid includes the hold multiplier, so paid can exceed earned.
      :[['Earned today',hasEarned?`${d.earnedTodayXl1} XL1`:'—'],['Earned, all time',hasEarned?`${d.earnedLifetimeXl1} XL1`:'—'],['Paid on-chain, with hold bonuses',`${d.distributedLifetimeXl1||'0'} XL1`],['Players rewarded',hasEarned?d.earnedWallets:(d.uniqueRewardedWallets||0)]]
    rows.forEach(([k,v],i)=>{labels[i].textContent=k;values[i].textContent=v})
    const recent=d.recent||[]
    $('recent-rewards').innerHTML=recent.length?recent.map(r=>`<div class="proof-item"><div class="body"><strong>${esc(GAMES[r.game]||r.game)}</strong> · +${esc(r.actualXl1)} XL1<div class="src">${esc(STATES[r.status]||String(r.status||'').toLowerCase())} · ${esc(new Date(r.createdAt).toLocaleString())}</div></div>${r.transactionHash?`<a class="verify" href="https://explore.xyo.network/xl1/${explorerNet}/transaction/${encodeURIComponent(r.transactionHash)}" target="_blank" rel="noopener">Verify →</a>`:''}</div>`).join(''):'<div class="proof-item"><div class="body">No rewards yet. Be the first: <a href="#games">choose a game</a>.</div></div>'}
  async function post(path){const auth=await loadAuth();const response=await auth.hubApiFetch(path,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:'{}'});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);return body}
  function renderBalance(d){const values=[`${d.heldXl1} XL1`,`${d.cashableNowXl1} XL1`,`${d.notYetCashableXl1} XL1`];document.querySelectorAll('#held-stats strong').forEach((el,i)=>el.textContent=values[i]);if(d.tiers)document.querySelectorAll('#hold-tiers,.hold-tiers-copy').forEach(el=>{el.textContent=tierText(d.tiers)});const can=d.cashableNowXl1!=='0';$('cashout').disabled=!can;$('cashout').textContent=can?`Cash out ${d.cashableNowXl1} XL1${d.simulated?' (simulated)':''}`:'Cash out';const review=d.inReviewXl1&&d.inReviewXl1!=='0'?` ${d.inReviewXl1} XL1 from an earlier cash-out is waiting for a moderator's review.`:'';$('held-status').textContent=(can?`${d.cashableBaseXl1} XL1 earned, multiplied by how long each reward was held.`:(d.heldXl1==='0'?'No held rewards yet. Play a game to earn some.':'Your rewards become cashable 24 h after you earn them.'))+review;$('held-rewards').innerHTML=(d.rewards||[]).slice(0,10).map(r=>`<div class="proof-item"><div class="body"><strong>${esc(GAMES[r.game]||r.game)}</strong> · ${esc(r.baseXl1)} XL1 · now ×${esc(r.multiplierNow)}<div class="src">${esc(new Date(r.earnedAt).toLocaleString())}${r.next?` · ×${esc(r.next.multiplier)} in ${esc(r.next.inHours)} h`:''}</div></div></div>`).join('')}
  function loadBalance(){return json('/api/xl1-arcade/balance').then(renderBalance).catch(()=>{})}
  $('cashout').addEventListener('click',async()=>{const button=$('cashout');button.disabled=true;$('held-status').textContent='Cashing out…';try{const r=await post('/api/xl1-arcade/cashout');$('held-status').textContent=r.simulated?`Simulated cash-out of ${r.cashedOutXl1} XL1. No XL1 was sent.`:r.status==='REVIEW'?`${r.cashedOutXl1} XL1 is waiting for a quick review by a WinLEW moderator before it is sent. Nothing is lost while it waits.`:`${r.cashedOutXl1} XL1 queued for payment from the distributor.`;await loadBalance()}catch(error){const why={nothing_to_cash_out:'Nothing is cashable yet.',xl1_rewards_blocked:'This account is not eligible for XL1 rewards. If you think this is a mistake, contact a moderator.',needs_identity_sync:'Link your Discord or X account to WinLEW before cashing out.',blocklist_unavailable:'Cash-out is briefly unavailable. Your rewards are safe; please try again later.'};$('held-status').textContent=why[error.message]||'Cash-out failed. Please try again later.';button.disabled=false}})
  // Who the rewards go to: signed in with Discord, and a GeoHackers-verified XL1 wallet.
  // "Verify XL1 wallet" sends the player to GeoHackers' verify page for their own wallet.
  // .btn sets display, which beats the hidden attribute, so hide with display itself.
  const show=(el,on)=>{el.hidden=!on;el.style.display=on?'':'none'}
  function walletState(state,me){const status=$('wallet-status'),verify=$('verify-wallet'),signin=$('wallet-signin');show(verify,false);verify.disabled=false;show(signin,false)
    const named=state!=='ok'?state:!me.discord?'wallet-login':me.wallet?'ready':'needs-wallet'
    announce(named);const held=$('held');if(held)held.dataset.account=named
    if(state==='signed-out'){status.textContent='Sign in with Discord to earn and cash out XL1. You can play without signing in, but earn nothing.';show(signin,true);loadAuth().then(a=>{signin.href=a.discordSignInUrl(a.returnPathHere?a.returnPathHere():location.pathname)}).catch(()=>{});return}
    if(state==='unavailable'){status.innerHTML='Your account status is unavailable right now. Games remain playable.'+helpLink('Ask in Discord if it lasts.');return}
    if(!me.discord){status.textContent='This account signed in with a wallet. Sign in with Discord to verify an XL1 wallet for rewards.';show(signin,true);loadAuth().then(a=>{signin.href=a.discordSignInUrl(a.returnPathHere?a.returnPathHere():location.pathname)}).catch(()=>{});return}
    if(me.wallet){status.innerHTML=`Ready to earn: rewards are paid to your verified XL1 wallet <strong title="${esc(me.wallet)}">${esc(short(me.wallet))}</strong>.`;verify.textContent='Verify a different wallet';verify.className='btn ghost';show(verify,true);return}
    status.textContent='Signed in. One step left: verify an XL1 wallet to receive your rewards.';verify.textContent='Verify XL1 wallet';verify.className='btn primary';show(verify,true)}
  function loadMe(){return loadAuth().then(a=>a.hubApiFetch('/api/xl1-arcade/me',{headers:{accept:'application/json'}})).then(async r=>{if(r.status===401)return walletState('signed-out');if(!r.ok)return walletState('unavailable');walletState('ok',await r.json())}).catch(()=>walletState('unavailable'))}
  $('verify-wallet').addEventListener('click',async()=>{const button=$('verify-wallet');button.disabled=true;$('wallet-status').textContent='Opening wallet verification…';try{const r=await post('/api/xl1-arcade/verify-wallet');location.assign(r.url)}catch(error){const why={needs_identity_sync:'Sign in with Discord first, then verify your XL1 wallet.',authentication_required:'Sign in first, then verify your XL1 wallet.'};if(why[error.message])$('wallet-status').textContent=why[error.message];else $('wallet-status').innerHTML='Wallet verification is unavailable right now. Please try again later.'+helpLink('Ask in Discord for help.');button.disabled=false}})
  // Back from the verify page in the same tab: show the new wallet without a reload.
  addEventListener('pageshow',e=>{if(e.persisted)loadMe()})
  // A link to #rewards (or anything inside a folded section) opens that fold.
  // Only the fold the link is in (or a section's own fold): "Skip to content" (#main) opens nothing.
  const openTarget=()=>{let id='';try{id=decodeURIComponent(location.hash.slice(1))}catch{return}const t=id&&document.getElementById(id);if(!t)return;const fold=t.matches('details')?t:t.querySelector(':scope > details.section-fold')||t.closest('details');if(fold&&!fold.open){fold.open=true;t.scrollIntoView({block:'start'})}}
  addEventListener('hashchange',openTarget);openTarget()
  loadMe()
  loadBalance()
  json('/api/xl1-arcade/config').then(renderConfig).catch(configUnavailable)
  json('/api/xl1-arcade/activity').then(renderActivity).catch(()=>{$('recent-rewards').innerHTML='<div class="proof-item"><div class="body">Reward activity is temporarily unavailable. Games remain playable.</div></div>'})
})()
