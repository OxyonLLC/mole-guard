
// How old the on-chain scan is, in hours. The faucet distribution figures come
// from a checkpoint written by `npm run faucet:scan` on the serving machine —
// they are a SNAPSHOT, not a live read, and they do not move until that scan is
// run again.
//
// Why this matters: the "verified complete … nothing is missing" wording below
// was true at scan time and is stated in the present tense. On 2026-08-11 the
// checkpoint was 9.5 days old and the page was still reporting 1001 payouts
// while the faucet was serving roughly six claims a day — so it was quietly
// asserting completeness about a figure ~57 claims behind. A stale number
// presented as current is worse than no number.
function scanAgeHours(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
}
const SCAN_STALE_AFTER_HOURS = 48;

// WinLEW Faucet — website counterpart to Discord's !faucet/!drip. Shares
// one cooldown with Discord via the server (src/faucet/service.js). The
// browser never sends a wallet, amount, Discord ID, or claim source — the
// server resolves all of that from the authenticated session.
//
// Session, wallet-connect, and API-base bridging are all shared platform
// primitives now, not app-specific code — see /assets/wallet-auth.js
// (loaded before this file in faucet/index.html) and
// docs/unified-authentication.md for the full picture.
const { getAuth, hubApiFetch, setConnectedUi, walletLogin: sharedWalletLogin, AuthKeys, getCachedWallet } = window.WinLEWAuth;

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function show(id, visible) { document.getElementById(id)?.classList.toggle('hidden', !visible); }
function setNavFaucetMetric(totalClaimed, totalCount) {
  const amount = Number(totalClaimed || 0);
  const count = Number(totalCount || 0);
  const formatted = fmtAmount(amount);
  const countLabel = `${count.toLocaleString('en-US')} confirmed claim${count === 1 ? '' : 's'}`;
  const payload = {
    amountText: formatted,
    title: `${formatted} LEW claimed across ${countLabel}`,
    ariaLabel: `Your confirmed faucet claims total ${formatted} LEW across ${countLabel}`,
  };
  window.__winlewPendingPlatformMetric = payload;
  window.WinLEWNav?.setPlatformMetric?.(payload);
}
function clearNavFaucetMetric() {
  window.__winlewPendingPlatformMetric = { amountText: '—' };
  window.WinLEWNav?.clearPlatformMetric?.();
}

function walletLogin(triggerBtn) {
  return sharedWalletLogin({ triggerBtn, onSuccess: () => loadStatus() });
}

// ── Countdown ────────────────────────────────────────────────────────────────
let countdownTarget = 0;
let countdownTimer = null;
function fmtCountdown(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
function startCountdown(targetMs, onTick) {
  stopCountdown();
  countdownTarget = targetMs;
  const tick = () => {
    const left = countdownTarget - Date.now();
    if (left <= 0) { stopCountdown(); loadStatus(); return; }
    onTick(left);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ── Buy WinLEW (holder-only gate, 2026-07-26) ───────────────────────────────
// Same mint + platforms already used site-wide (src/public/index.html,
// src/public/home/index.html) — shown whenever eligibility fails specifically
// because the wallet doesn't hold enough WinLEW, so there's always a real
// next step, not just a rejection.
const WINLEW_MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';
// Same reasoning the project owner posted publicly (2026-07-26): a wallet's
// first-ever WinLEW transfer requires creating its token account on-chain,
// which costs real SOL out of the faucet treasury — holding any amount
// already means that account exists.
const WHY_HOLDER_ONLY = "It's a fair trade: you cover the one-time cost of getting your first $WinLEW (creating your own token account), and we'll gladly keep sending you $WinLEW for faucet claims and quiz rewards after that — usually within about 10 redemptions, we've already broken even on that cost.";
function buyWinlewLinksHtml() {
  const links = [
    ['🏁 pump.fun', `https://pump.fun/coin/${WINLEW_MINT}`],
    ['🔁 Swap on pump.fun', `https://swap.pump.fun/?input=So11111111111111111111111111111111111111112&output=${WINLEW_MINT}`],
    ['🔁 Swap on Raydium', `https://raydium.io/swap/?inputMint=sol&outputMint=${WINLEW_MINT}`],
  ];
  const buttons = links.map(([label, url]) => `<a class="btn" href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`).join(' ');
  return `<div class="fine muted" style="margin-top:10px;">${escapeHtml(WHY_HOLDER_ONLY)}</div>
    <div class="fine muted" style="margin-top:6px;">Buy on whichever platform you prefer — always double-check the mint (<code>${WINLEW_MINT}</code>) before swapping.</div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">${buttons}</div>`;
}

// ── Claim state rendering ────────────────────────────────────────────────────
// Every entry takes the /api/faucet/status payload so tunable numbers come from
// the server's own config rather than being restated here. Covers the full
// ELIGIBILITY_REASONS set (src/faucet/eligibility.js) plus the reasons only a
// claim attempt can produce (src/faucet/service.js) — the claim path returns
// eligibility reasons too, so both paths share this map.
const REASON_COPY = {
  not_enabled: () => '🚧 <span class="warn">The faucet is temporarily disabled.</span> Please check back later.',
  // NOT the same as no_wallet, and the difference is the whole bug this copy
  // was written for: the person may be linked perfectly well under a Discord id
  // we could not resolve from their session. Never tell them to re-register.
  // Fires ONLY when we found no wallet under this account's own key AND no
  // Discord account is attached — so both remedies are offered, because either
  // one genuinely works. Attaching Discord surfaces a wallet you already
  // registered there; verifying surfaces one for this account directly.
  needs_discord_link: () => '🔗 <span class="warn">We could not find a wallet for this account yet.</span> If you have already registered one on Discord, <a href="/verify/?connect=mole">attach Discord ↗</a> and it will appear here. Otherwise <a href="/verify/">verify a wallet ↗</a> to get started.',
  // `/verify` is a WEBSITE PATH, not a slash command — the only registered
  // commands are /mole and /game (src/mole/commands.js). This copy said
  // "Verify a wallet on Discord (/verify)" and sent people hunting for a
  // command that has never existed.
  no_wallet: () => 'ℹ️ No faucet wallet is linked to your Discord account yet. Link one at <a href="/verify/">winlew.co/verify/ ↗</a>, or use <code>!register</code> in Discord, then reconnect here.',
  invalid_wallet: () => '⚠️ <span class="bad">Your saved wallet looks invalid.</span> Re-link it at <a href="/verify/">winlew.co/verify/ ↗</a>, or with <code>!register &lt;wallet-or-domain&gt;</code> in Discord.',
  treasury_wallet: () => '⚠️ That wallet belongs to the faucet treasury and cannot claim from itself.',
  treasury_unavailable: () => '⚠️ The faucet treasury is not configured right now. Please try again later.',
  holder_check_unavailable: () => '⚠️ <span class="warn">Could not verify your holder balance right now</span> (network issue). Try again shortly.',
  // Same gate the Discord adapter enforces (src/faucet/eligibility.js) — kept
  // here so the two interfaces say the same thing rather than the web one
  // falling through to a bare reason code. The threshold is FAUCET_VERIFY_AFTER_CLAIMS
  // and is read from the status payload; never hardcode it here.
  verification_required: (data) => {
    const after = Number(data?.faucet?.verifyAfterClaims) || 0;
    const lead = after > 0
      ? `After ${after} claims the faucet asks you to verify your wallet once`
      : 'The faucet asks you to verify your wallet once';
    return `🔐 <span class="warn">Verification needed to keep claiming.</span> ${lead} — a signature that proves ownership. No tokens move. <a href="/verify/">Verify here ↗</a><br><span class="muted">Your cooldown is unaffected; claim again as soon as you are verified.</span>`;
  },
  // Appeal route kept in sync with src/services/appealContact.js by
  // test/services/appealContact.test.mjs — a browser bundle cannot import it,
  // so the address is duplicated here on purpose and guarded by that test.
  wallet_banned: () => '🚫 This wallet is not eligible for the faucet. If you believe this is a mistake: email support@winlew.co, use https://winlew.co/contact/, or open a ticket on Discord. Include your wallet address.',
  linked_to_banned: () => '🚫 This wallet is not eligible for the faucet. If you believe this is a mistake: email support@winlew.co, use https://winlew.co/contact/, or open a ticket on Discord. Include your wallet address.',
  // Claim-time only. The faucet pays the wallet registered to your account and
  // nothing else, so an account with no registered wallet cannot be paid.
  wallet_not_registered: () => 'ℹ️ The faucet only pays a wallet you have registered. Register one on Discord with <code>!register &lt;wallet-or-domain&gt;</code>, then reconnect here.',
  payout_failed: () => '❌ <span class="bad">The payout could not be sent.</span> No tokens moved and your cooldown was released — please try again shortly.',
};

function renderClaimState({ state, html, buttonEnabled, buttonLabel }) {
  const area = document.getElementById('claimStateArea');
  const btn = document.getElementById('claimBtn');
  if (area) {
    area.className = `claimStateArea ${state ? `state-${state}` : ''}`.trim();
    area.innerHTML = html;
  }
  if (btn) {
    btn.disabled = !buttonEnabled;
    if (buttonLabel) btn.textContent = buttonLabel;
  }
}

async function getJson(path, opts) {
  const res = await hubApiFetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data: data || {} };
}

let lastStatus = null;

async function loadStatus() {
  const auth = getAuth();
  show('loadingCard', true);
  show('signedOutCard', false);
  show('identityCard', false);
  show('claimCard', false);
  stopCountdown();

  if (!auth.session) {
    clearNavFaucetMetric();
    show('loadingCard', false);
    show('signedOutCard', true);
    return;
  }

  const { ok, status, data } = await getJson('/api/faucet/status');
  show('loadingCard', false);

  if (status === 401) {
    localStorage.removeItem(AuthKeys.session);
    clearNavFaucetMetric();
    show('signedOutCard', true);
    return;
  }
  if (!ok) {
    clearNavFaucetMetric();
    show('claimCard', true);
    renderClaimState({ state: 'error', html: '❌ <span class="bad">Could not reach the faucet right now.</span> Check your connection and try again.', buttonEnabled: false });
    return;
  }

  lastStatus = data;
  setText('heroAmount', data.faucet?.amount ?? '—');
  setText('heroCooldown', data.faucet?.cooldownHours ? `${data.faucet.cooldownHours}h` : '—');
  setConnectedUi(getCachedWallet() || 'connected');

  show('identityCard', true);
  setText('idDiscordName', data.discord?.displayName || '—');
  setText('idWallet', data.wallet?.masked || '—');
  setText('idSource', data.wallet?.source || '—');
  setText('idBalance', data.eligibility?.currentBalance != null ? `${data.eligibility.currentBalance} ${data.faucet?.tokenSymbol || ''}` : '—');

  show('claimCard', true);
  setText('claimAmountChip', `${data.faucet?.amount ?? '—'} ${data.faucet?.tokenSymbol || ''}`);
  void loadHistory(auth);

  const reason = data.eligibility?.reason;
  if (data.eligibility?.eligible) {
    renderClaimState({
      state: 'eligible',
      html: `✅ <span class="ok">You're eligible!</span> Claim ${escapeHtml(String(data.faucet?.amount))} ${escapeHtml(data.faucet?.tokenSymbol || '')} now.`,
      buttonEnabled: true,
      buttonLabel: '💧 Claim $WinLEW',
    });
    return;
  }

  if (reason === 'cooldown') {
    const target = data.eligibility?.nextEligibleAt ? new Date(data.eligibility.nextEligibleAt).getTime() : 0;
    const sourceLabel = data.eligibility?.lastClaimSource === 'web' ? 'the website' : data.eligibility?.lastClaimSource === 'discord' ? 'Discord' : 'a previous claim';
    startCountdown(target, (left) => {
      renderClaimState({
        state: 'progress',
        html: `⏳ You already claimed via <strong>${escapeHtml(sourceLabel)}</strong>. Next claim in <strong>${fmtCountdown(left)}</strong>.<br/><span class="fine">The Discord and website faucet share one cooldown.</span>`,
        buttonEnabled: false,
        buttonLabel: '💧 Claim $WinLEW',
      });
    });
    return;
  }

  if (reason === 'below_holder_minimum') {
    renderClaimState({
      state: 'error',
      html: `❌ <span class="bad">Holder-only faucet.</span> Your wallet must hold at least ${escapeHtml(String(data.faucet?.minimumHolderBalance))} ${escapeHtml(data.faucet?.tokenSymbol || '')}. Current balance: ${escapeHtml(String(data.eligibility?.currentBalance ?? 0))}.${buyWinlewLinksHtml()}`,
      buttonEnabled: false,
    });
    return;
  }

  const copy = REASON_COPY[reason];
  renderClaimState({
    state: reason === 'holder_check_unavailable' ? 'progress' : 'error',
    html: copy ? copy(data) : `❌ Not eligible right now (${escapeHtml(reason || 'unknown')}).`,
    buttonEnabled: false,
  });
}

// ── Claim rules (shared by the signed-out and signed-in paths) ──────────────
// Every value here is server config. Nothing about the rules is restated in
// the markup, so changing FAUCET_* in the environment changes the page.
function applyFaucetRules(rules) {
  if (!rules) return;
  if (rules.amount != null) setText('heroAmount', rules.amount);
  if (rules.cooldownHours) setText('heroCooldown', `${rules.cooldownHours}h`);

  const notice = document.getElementById('verifyGateNotice');
  if (!notice) return;
  const after = Number(rules.verifyAfterClaims) || 0;
  // Gate off (0) means there is no rule to state — say nothing rather than
  // describing a requirement the server isn't enforcing.
  if (after <= 0) { notice.classList.add('hidden'); return; }
  notice.classList.remove('hidden');
  notice.innerHTML = `🔐 After ${after} claims you'll be asked to <a href="/verify/">verify your wallet</a> once — a signature that proves you own it. No tokens move, and it doesn't affect your cooldown.`;
}

// ── Distribution stats (public, no sign-in required) ────────────────────────
function fmtAmount(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadDistributionStats() {
  const { ok, data } = await getJson('/api/faucet/global-stats');
  if (!ok || !data?.ok) {
    setText('distTotalAmount', '⚠️ unavailable');
    return;
  }
  const web = data.bySource?.web || { amount: 0 };
  const discord = data.bySource?.discord || { amount: 0 };
  setText('distTotalAmount', fmtAmount(data.totalConfirmedAmount));
  setText('distTotalCount', fmtAmount(data.totalConfirmedCount));
  setText('distWebAmount', fmtAmount(web.amount));
  setText('distDiscordAmount', fmtAmount(discord.amount));
  const since = document.getElementById('distSince');
  if (since) {
    // Deliberately does NOT claim the counter "started late" as the reason it
    // trails the chain — it has recorded since 2025-05-25, only days after the
    // wallet's first payout, so that explanation would be false. The honest
    // statement is that not every on-chain payout has a claim record here.
    since.textContent = data.firstClaimAt
      ? `Tracking since the first confirmed claim on ${fmtDate(data.firstClaimAt)}.`
      : 'No confirmed claims recorded yet.';
  }

  // Claim rules. This endpoint needs no session, so the hero figures and the
  // verification notice can be filled for a visitor who hasn't connected yet —
  // loadStatus() only runs once signed in, and before this the page showed
  // every rule as an em-dash to exactly the people who don't know them.
  applyFaucetRules(data.rules);

  // Lifetime on-chain total, from the faucet:scan checkpoint. Stays hidden
  // entirely when no scan has been run rather than rendering em-dashes that
  // look like a broken counter.
  const chain = data.onChain;
  const wrap = document.getElementById('distOnChainWrap');
  if (wrap && chain) {
    wrap.classList.remove('hidden');
    setText('distChainAmount', fmtAmount(chain.totalDistributedDisplay));
    setText('distChainCount', fmtAmount(chain.payoutCount));
    setText('distChainRecipients', fmtAmount(chain.distinctRecipients));
    setText('distChainSince', fmtDate(chain.firstPayoutAtIso));
    const note = document.getElementById('distChainNote');
    if (note) {
        const ageH = scanAgeHours(chain.lastScanAtIso);
        // An unparseable/absent date must not render "as of 1970-01-01 — about
        // Infinity day(s) ago", which is what the first version of this did.
        const knownScan = Number.isFinite(Date.parse(chain.lastScanAtIso || ''));
        const asOf = knownScan ? `Snapshot as of ${fmtDate(chain.lastScanAtIso)}` : 'Snapshot of unknown age';
        note.textContent = ageH > SCAN_STALE_AFTER_HOURS
          ? `${asOf}${knownScan ? ` — about ${Math.round(ageH / 24)} day(s) ago` : ''}. Claims made since then are NOT included; these figures move only when the next on-chain scan runs. Wallet ${chain.wallet}.`
          : chain.reconciled
            ? `${asOf}. Verified complete at that moment: every transaction this wallet has ever had was read and decoded, and total received minus total sent equalled its on-chain balance exactly. Wallet ${chain.wallet}.`
            : `${asOf}. Wallet ${chain.wallet}.`;
    }
  }
}

// ── Your claim history (signed-in only) ──────────────────────────────────────
function renderHistoryRow(claim) {
  const sourceLabel = claim.source === 'discord' ? 'Discord' : claim.source === 'web' ? 'Web' : (claim.source || '—');
  const sourceClass = claim.source === 'discord' || claim.source === 'web' ? claim.source : '';
  const statusText = claim.status === 'confirmed' ? '✅ Confirmed'
    : claim.status === 'known_failed' ? '❌ Failed'
    : claim.status === 'reconciling' ? '⚠️ Reconciling'
    : `⏳ ${escapeHtml(claim.status || 'pending')}`;
  const amountCell = claim.explorerUrl
    ? `<a href="${escapeHtml(claim.explorerUrl)}" target="_blank" rel="noreferrer">${escapeHtml(String(claim.amount))} ↗</a>`
    : escapeHtml(String(claim.amount));
  return `
    <tr>
      <td>${escapeHtml(fmtDate(claim.createdAt))}</td>
      <td><span class="sourceTag ${sourceClass}">${escapeHtml(sourceLabel)}</span></td>
      <td class="num">${amountCell}</td>
      <td>${statusText}</td>
    </tr>
  `;
}

async function loadHistory(auth) {
  if (!auth.session) { clearNavFaucetMetric(); show('historyCard', false); return; }
  const { ok, data } = await getJson('/api/faucet/history');
  if (!ok || !data?.ok) { clearNavFaucetMetric(); show('historyCard', false); return; }

  show('historyCard', true);
  const totalConfirmedAmount = Number(data.summary?.totalConfirmedAmount || 0);
  const totalConfirmedCount = Number(data.summary?.totalConfirmedCount ?? data.claims?.length ?? 0);
  setText('historySummaryChip', `${fmtAmount(totalConfirmedAmount)} $WinLEW total`);
  setNavFaucetMetric(totalConfirmedAmount, totalConfirmedCount);

  const body = document.getElementById('historyBody');
  if (!body) return;
  if (!data.claims.length) {
    body.innerHTML = '<tr><td colspan="4" class="muted">No claims yet — your first claim will show up here.</td></tr>';
    return;
  }
  body.innerHTML = data.claims.slice().reverse().slice(0, 50).map(renderHistoryRow).join('');
}

// ── Claim + poll ──────────────────────────────────────────────────────────────
async function pollClaim(claimId, auth) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((res) => setTimeout(res, 2000));
    const { ok, data } = await getJson(`/api/faucet/claim/${encodeURIComponent(claimId)}`);
    if (!ok || !data?.claim) continue;
    const { status, signature, explorerUrl } = data.claim;
    if (status === 'confirmed') {
      renderClaimState({
        state: 'eligible',
        html: `✅ <span class="ok">Confirmed!</span> ${signature && signature !== 'DRY_RUN_NO_SIGNATURE' ? `<a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noreferrer">View transaction ↗</a>` : 'Sent.'}`,
        buttonEnabled: false,
      });
      setTimeout(loadStatus, 1500);
      return;
    }
    if (status === 'known_failed') {
      renderClaimState({ state: 'error', html: '❌ <span class="bad">Claim failed before any tokens were sent.</span> Your cooldown was released — you can try again.', buttonEnabled: false });
      setTimeout(loadStatus, 1500);
      return;
    }
    if (status === 'reconciling') {
      // A reconciling claim now usually carries its signature — the transfer
      // reached the network and only the confirmation call timed out. Link it:
      // the explorer is the authority, and the user shouldn't have to take our
      // word for something they can check.
      renderClaimState({
        state: 'progress',
        html: signature && signature !== 'DRY_RUN_NO_SIGNATURE'
          ? `⏳ <span class="warn">Sent — waiting on network confirmation.</span> <a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noreferrer">View transaction ↗</a><br><span class="muted">If the explorer shows it finalized, the tokens arrived.</span>`
          : '⚠️ <span class="warn">Your claim is being verified on-chain.</span> This can take a few minutes — check <code>!faucetstatus</code> on Discord if this page doesn\'t update.',
        buttonEnabled: false,
      });
      return;
    }
    renderClaimState({ state: 'progress', html: `⏳ Processing your claim… (${escapeHtml(status)})`, buttonEnabled: false });
  }
  renderClaimState({ state: 'progress', html: '⏳ Still processing — this is taking longer than usual. Check <code>!faucetstatus</code> on Discord, or refresh this page shortly.', buttonEnabled: false });
}

let claimAttempt = null;
async function submitClaim() {
  const auth = getAuth();
  if (!auth.session) { loadStatus(); return; }
  const btn = document.getElementById('claimBtn');
  if (btn) btn.disabled = true;
  renderClaimState({ state: 'progress', html: '⏳ Reserving your claim…', buttonEnabled: false });

  if (!claimAttempt || claimAttempt.session !== auth.session) {
    claimAttempt = { session: auth.session, requestId: `web-${Date.now()}-${Math.random().toString(16).slice(2)}` };
  }
  let result;
  try {
    result = await getJson('/api/faucet/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(claimAttempt),
    });
  } catch {
    if (getAuth().session !== auth.session) { void loadStatus(); return; }
    // A lost response is not evidence that the reservation failed. Keep the
    // same request id and let the existing server reconcile/cooldown rules act.
    renderClaimState({ state: 'error', html: 'Connection interrupted. Your claim may already be reserved. Retry to check the same request.',
      buttonEnabled: true, buttonLabel: 'Retry / check claim' });
    return;
  }
  if (getAuth().session !== auth.session) { void loadStatus(); return; }
  const { ok, status, data } = result;

  if (status === 429) {
    renderClaimState({ state: 'error', html: '⏳ <span class="warn">Too many attempts.</span> Please wait a moment and try again.', buttonEnabled: true, buttonLabel: '💧 Claim $WinLEW' });
    return;
  }
  if (!ok || !data?.ok) {
    if (data?.reason === 'cooldown') { claimAttempt = null; await loadStatus(); return; }
    // Sent, but the confirmation call timed out — the tokens are on their way
    // and the signature proves it, so link it rather than reporting a failure.
    if (data?.reason === 'reconciling') {
      renderClaimState({
        state: 'progress',
        html: data.signature
          ? `⏳ <span class="warn">Sent — waiting on network confirmation.</span> <a href="${escapeHtml(data.explorerUrl)}" target="_blank" rel="noreferrer noopener">View transaction ↗</a><br><span class="muted">If the explorer shows it finalized, the tokens arrived.</span>`
          : '⏳ <span class="warn">Sent — waiting on network confirmation.</span> Refresh shortly to see the transaction.',
        buttonEnabled: false,
      });
      setTimeout(loadStatus, 2000);
      return;
    }
    // Same friendly copy the eligibility path uses — the claim endpoint returns
    // eligibility reasons too, so without this a gate tripping between page
    // load and clicking Claim would surface as a bare reason code.
    const failCopy = REASON_COPY[data?.reason];
    renderClaimState({
      state: 'error',
      html: failCopy ? failCopy(lastStatus) : `❌ ${escapeHtml(data?.reason || 'Claim failed.')}`,
      buttonEnabled: true,
      buttonLabel: '💧 Claim $WinLEW',
    });
    return;
  }

  claimAttempt = null;
  if (data.claim?.status === 'confirmed') {
    const sig = data.claim.signature;
    renderClaimState({
      state: 'eligible',
      html: sig && sig !== 'DRY_RUN_NO_SIGNATURE'
        ? `✅ <span class="ok">Confirmed!</span> <a href="${escapeHtml(data.claim.explorerUrl)}" target="_blank" rel="noreferrer noopener">View transaction ↗</a>`
        : '✅ <span class="ok">Confirmed!</span> Sent.',
      buttonEnabled: false,
    });
    setTimeout(loadStatus, 1500);
    return;
  }

  renderClaimState({ state: 'progress', html: '⏳ Claim reserved — waiting for processing…', buttonEnabled: false });
  await pollClaim(data.claim.id, auth);
}

// ── boot ─────────────────────────────────────────────────────────────────────
function init() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => void walletLogin(e.currentTarget));
  document.getElementById('signedOutConnectBtn')?.addEventListener('click', (e) => void walletLogin(e.currentTarget));
  document.getElementById('claimBtn')?.addEventListener('click', () => void submitClaim());
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  loadStatus();
  void loadDistributionStats();
  setInterval(() => { if (!countdownTimer) loadStatus(); }, 30000);
}
document.addEventListener('DOMContentLoaded', init);
