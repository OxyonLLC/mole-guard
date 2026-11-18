// WinLEW Quiz dashboard — read-only. Pulls the Discord quiz's data via the mole
// web API and renders leaderboards, the cycle countdown, and (when logged in)
// your standings.
//
// Session, wallet-connect, and API-base bridging are all shared platform
// primitives now, not app-specific code — see /assets/wallet-auth.js
// (loaded before this file in quiz/index.html) and
// docs/unified-authentication.md for the full picture. A login on any app
// (Mole Hub, Faucet, Quiz) carries over to the others via the same
// localStorage session key.
const { getAuth, hubApiFetch, setConnectedUi, walletLogin: sharedWalletLogin, getCachedWallet } = window.WinLEWAuth;


// Participation fingerprint (Stage 2, 2026-08-14).
//
// Sent with each answer and hashed SERVER-SIDE immediately — the raw values
// below are never stored, and no location permission is requested. It exists so
// "one device, many wallets" can be counted; a new wallet used to reset every
// limit we had.
//
// Deliberately only fields the browser already exposes to any page. No canvas
// or audio fingerprinting: those are more identifying than we need and would be
// harder to justify to the person being measured.
function participationFingerprint() {
  try {
    return {
      userAgent: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
      memory: navigator.deviceMemory || '',
      cores: navigator.hardwareConcurrency || '',
    };
  } catch {
    // Any failure just means no signal for this answer. It must never stop
    // someone answering.
    return null;
  }
}

const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const fmtLew = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const myRanks = { cycle: null, alltime: null };
let currentScope = 'cycle';
let lastEntries = [];

async function getJson(path) {
  const res = await hubApiFetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// ── Cycle countdown ────────────────────────────────────────────────────────
let cycleEndMs = 0;
function renderCountdown() {
  const el = document.getElementById('cycleCountdown');
  if (!el) return;
  if (!cycleEndMs) { el.textContent = 'No active cycle'; return; }
  const ms = Math.max(0, cycleEndMs - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  el.textContent = ms <= 0 ? 'Cycle closing…' : `${d}d ${h}h ${m}m ${s}s`;
}

async function loadCycle() {
  try {
    const data = await getJson('/api/quiz/cycle');
    const c = data.cycle || {};
    cycleEndMs = Number(c.endMs || 0);
    const range = document.getElementById('cycleRange');
    const rate = document.getElementById('cycleRate');
    if (range && c.startAt && c.endAt) {
      const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      range.textContent = `Cycle ${fmt(c.startAt)} → ${fmt(c.endAt)}`;
    }
    if (rate && data.payoutRate) rate.textContent = `Rate: ${fmtLew(data.payoutRate)} WinLEW / point`;
    renderCountdown();
  } catch (e) {
    const el = document.getElementById('cycleCountdown');
    if (el) el.textContent = '—';
    console.warn('[quiz] cycle load failed:', e);
  }
}

// ── Leaderboard ──────────────────────────────────────────────────────────────
function renderLeaderboard(scope, entries) {
  const head = document.getElementById('lbHead');
  const body = document.getElementById('lbBody');
  if (!head || !body) return;
  const cols = scope === 'alltime'
    ? ['#', 'Player', 'Lifetime', "Q's", 'Cycles']
    : ['#', 'Player', 'Cycle pts', 'Est. WinLEW', "Q's"];
  head.innerHTML = `<tr>${cols.map((c, i) => `<th class="${i >= 2 ? 'num' : ''}">${c}</th>`).join('')}</tr>`;

  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="${cols.length}" class="muted">No players yet — be the first in Discord.</td></tr>`;
    return;
  }
  const myRank = myRanks[scope];
  body.innerHTML = entries.map((e) => {
    const you = myRank && e.rank === myRank ? ' class="you"' : '';
    const name = `<span class="lbName">${escapeHtml(e.name)}${e.masked ? '<span class="badge">·masked</span>' : ''}</span>`;
    const cells = scope === 'alltime'
      ? [e.rank, name, fmtInt(e.lifetimePoints), fmtInt(e.questions), fmtInt(e.cyclesPlayed)]
      : [e.rank, name, fmtInt(e.points), fmtLew(e.estimatedPayout), fmtInt(e.questions)];
    return `<tr${you}>${cells.map((c, i) => `<td class="${i === 0 ? 'lbRank' : ''}${i >= 2 ? ' num' : ''}">${c}</td>`).join('')}</tr>`;
  }).join('');
}

async function loadLeaderboard(scope) {
  currentScope = scope;
  try {
    const data = await getJson(`/api/quiz/leaderboard?scope=${encodeURIComponent(scope)}&limit=25`);
    lastEntries = data.entries || [];
    renderLeaderboard(scope, lastEntries);
  } catch (e) {
    console.warn('[quiz] leaderboard load failed:', e);
  }
}

// ── Web vs Discord (informational — separate from the payout leaderboard) ────
let currentPlatform = 'web';
const fmtPct = (n) => `${Math.round(Number(n || 0) * 100)}%`;
function fmtAgo(ms) {
  if (!ms) return 'never';
  const diff = Math.max(0, Date.now() - Number(ms));
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderPlatformLeaderboard(entries) {
  const head = document.getElementById('platformLbHead');
  const body = document.getElementById('platformLbBody');
  if (!head || !body) return;
  const cols = ['#', 'Player', 'Points', 'Correct', 'Accuracy', 'Streak', 'Best', 'Last active'];
  head.innerHTML = `<tr>${cols.map((c, i) => `<th class="${i >= 2 ? 'num' : ''}">${c}</th>`).join('')}</tr>`;

  if (!entries.length) {
    body.innerHTML = `<tr><td colspan="${cols.length}" class="muted">No players yet on this platform.</td></tr>`;
    return;
  }
  body.innerHTML = entries.map((e) => {
    const name = `<span class="lbName">${escapeHtml(e.name)}${e.masked ? '<span class="badge">·masked</span>' : ''}</span>`;
    const cells = [
      e.rank, name, fmtInt(e.points), `${fmtInt(e.correct)}/${fmtInt(e.total)}`,
      fmtPct(e.accuracy), fmtInt(e.currentStreak), fmtInt(e.bestStreak), fmtAgo(e.lastActiveTs),
    ];
    return `<tr>${cells.map((c, i) => `<td class="${i === 0 ? 'lbRank' : ''}${i >= 2 ? ' num' : ''}">${c}</td>`).join('')}</tr>`;
  }).join('');
}

async function loadPlatformLeaderboard(platform) {
  try {
    const data = await getJson(`/api/quiz/leaderboard/platform?platform=${encodeURIComponent(platform)}&limit=25`);
    renderPlatformLeaderboard(data.entries || []);
  } catch (e) {
    console.warn('[quiz] platform leaderboard load failed:', e);
  }
}

async function loadCompare() {
  try {
    const data = await getJson('/api/quiz/compare');
    const c = data.comparison || {};
    setText('cmpWebParticipants', fmtInt(c.web?.participants));
    setText('cmpDiscordParticipants', fmtInt(c.discord?.participants));
    setText('cmpWebAnswers', fmtInt(c.web?.totalAnswers));
    setText('cmpDiscordAnswers', fmtInt(c.discord?.totalAnswers));
    setText('cmpWebAccuracy', fmtPct(c.web?.correctRate));
    setText('cmpDiscordAccuracy', fmtPct(c.discord?.correctRate));
    setText('cmpWebPoints', fmtInt(c.web?.totalPoints));
    setText('cmpDiscordPoints', fmtInt(c.discord?.totalPoints));
    const note = document.getElementById('platformLeaderNote');
    if (note) {
      note.classList.remove('hidden');
      note.textContent = c.leader === 'tied'
        ? "It's currently tied between Web and Discord."
        : `${c.leader === 'web' ? 'Web' : 'Discord'} is currently ahead on total points.`;
    }
  } catch (e) {
    console.warn('[quiz] compare load failed:', e);
  }
}

function setPlatformView(platform) {
  currentPlatform = platform;
  const isCompare = platform === 'compare';
  document.getElementById('platformTableWrap')?.classList.toggle('hidden', isCompare);
  document.getElementById('platformCompareWrap')?.classList.toggle('hidden', !isCompare);
  document.getElementById('platformLeaderNote')?.classList.toggle('hidden', !isCompare);
  if (isCompare) loadCompare();
  else loadPlatformLeaderboard(platform);
}

function setNavPointsMetric(points) {
  const formatted = fmtInt(points);
  const payload = {
    amountText: formatted,
    title: `${formatted} PTS`,
    ariaLabel: `Your redeemable quiz points: ${formatted} PTS`,
  };
  window.__winlewPendingPlatformMetric = payload;
  if (window.WinLEWNav?.setPlatformMetric) {
    window.WinLEWNav.setPlatformMetric(payload);
    return;
  }
  setText('navPlatformAmount', formatted);
}

// ── Your standings ───────────────────────────────────────────────────────────
async function loadMe() {
  const auth = getAuth();
  if (!auth.session) return;
  try {
    const res = await hubApiFetch(`/api/quiz/me?app=${encodeURIComponent(auth.app)}`);
    if (!res.ok) return; // not logged in / expired — leave the card hidden
    const data = await res.json();
    const q = data.quiz || {};
    myRanks.cycle = data.ranks?.cycle || null;
    myRanks.alltime = data.ranks?.alltime || null;

    const cyclePoints = Number(q.currentCycle?.points || 0);
    const redeemablePoints = Number(q.unpaidPoints ?? q.currentCycle?.unpaidPoints ?? 0);
    setText('mePoints', fmtInt(cyclePoints));
    setText('meRank', myRanks.cycle ? `#${myRanks.cycle}` : '—');
    setText('mePayout', fmtLew(q.currentCycle?.estimatedPayout || 0));
    setText('meLifetime', fmtInt(q.lifetimePoints || 0));
    setNavPointsMetric(redeemablePoints);
    document.getElementById('meCard')?.classList.remove('hidden');
    renderRedeemCard(q, data.redemption || {});
    setConnectedUi(getCachedWallet() || 'connected');
    if (data.quizWeb) {
      setPlayRemaining(data.quizWeb.remainingToday, data.quizWeb.capPerDay);
      const playCard = document.getElementById('playCard');
      const isFirstReveal = playCard?.classList.contains('hidden');
      playCard?.classList.remove('hidden');
      // submitAnswer() calls loadMe() (unawaited) right after showPlay('result')
      // so the result screen updates its points/rank — but loadMe() used to
      // force showPlay('idle') every time, which raced with that and yanked
      // the result screen away before the player could see it (worse now that
      // tier-tile accuracy also updates here — that's the whole point of
      // seeing this screen). Only reset to idle on the card's first reveal.
      if (isFirstReveal) showPlay('idle');
    }
    renderTierGrid(data.tierStats);
    renderLeaderboard(currentScope, lastEntries); // re-highlight "you"
  } catch (e) {
    console.warn('[quiz] me load failed:', e);
  }
}

// ── Wallet connect ────────────────────────────────────────────────────────
// Provider detection, the mobile picker, and the challenge/sign/session
// flow all live in /assets/wallet-auth.js now — this is just quiz's
// post-login hook (reload standings).
function walletLogin(triggerBtn) {
  return sharedWalletLogin({ triggerBtn, onSuccess: () => loadMe() });
}

// ── Web-play (per-user on-demand quiz) ───────────────────────────────────────
const play = { instanceId: null, expiresAt: 0, timer: null, capPerDay: 20, currentLevel: null, currentSponsor: null, askedAt: 0 };
// sponsor-xyo/sponsor-winlew added 2026-07-18 alongside the sponsor tile
// split — their own data-tier-stat elements exist in index.html now, so
// renderTierGrid() (below) picks them up automatically via this map's keys.
const TIER_LABELS = { sponsor: 'Sponsor', 'sponsor-xyo': 'XYO', 'sponsor-winlew': 'WinLEW', hard: 'Hard', medium: 'Medium', easy: 'Easy' };

// A sponsor question's own display label needs the specific sponsor, not
// the generic "Sponsor" — TIER_LABELS['sponsor'] alone can't distinguish
// XYO from WinLEW, since the backend's `level` field is always "sponsor"
// for both (sponsorKey is the separate field that actually varies).
function questionDisplayLabel(level, sponsorKey) {
  if (level === 'sponsor' && sponsorKey) return TIER_LABELS[`sponsor-${sponsorKey}`] || 'Sponsor';
  return TIER_LABELS[level] || String(level || '').toUpperCase();
}

function showPlay(state) {
  document.getElementById('playIdle')?.classList.toggle('hidden', state !== 'idle');
  document.getElementById('playQuestion')?.classList.toggle('hidden', state === 'idle');
  document.getElementById('playResult')?.classList.toggle('hidden', state !== 'result');
}

// Renders each tile's own accuracy so a player can see where they're strong
// before picking a tier — informational only (tierStats never affects payout
// points; see src/quiz/platform-stats.js and db.js's recordTierAnswer).
function renderTierGrid(tierStats) {
  for (const tier of Object.keys(TIER_LABELS)) {
    const el = document.querySelector(`[data-tier-stat="${tier}"]`);
    if (!el) continue;
    const b = tierStats?.[tier];
    if (!b || !b.total) { el.textContent = 'Not played yet'; continue; }
    const pct = Math.round((b.correct / b.total) * 100);
    el.textContent = `${pct}% correct (${b.correct}/${b.total})`;
  }
}
function setPlayRemaining(n, cap) {
  if (cap) play.capPerDay = cap;
  setText('playRemaining', `${fmtInt(n)}/${fmtInt(play.capPerDay)} left today`);
  setText('playRemainingInline', fmtInt(n));
}
function clearPlayTimer() { if (play.timer) { clearInterval(play.timer); play.timer = null; } }

function startTimer(seconds) {
  clearPlayTimer();
  const fill = document.getElementById('qTimerFill');
  if (fill) {
    fill.classList.remove('warn');
    fill.style.transition = 'none'; fill.style.width = '100%';
    requestAnimationFrame(() => { fill.style.transition = `width ${seconds}s linear`; fill.style.width = '0%'; });
  }
  play.timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((play.expiresAt - Date.now()) / 1000));
    if (left <= 5 && fill) fill.classList.add('warn');
    if (Date.now() > play.expiresAt) { clearPlayTimer(); submitAnswer(-1); }
  }, 250);
}

async function startQuestion(level, sponsor) {
  const auth = getAuth();
  if (!auth.session) return;
  // A tile click passes its own level (and, for a sponsor tile, its own
  // sponsor) explicitly; "Next question →" calls this with no arguments, so
  // it keeps playing the exact tier+sponsor already in progress.
  const requestedLevel = level || play.currentLevel;
  const requestedSponsor = level ? (sponsor || null) : play.currentSponsor;
  if (!requestedLevel) return; // idle screen with no tier chosen yet — nothing to do
  try {
    const res = await hubApiFetch('/api/quiz/play/next', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: auth.session, level: requestedLevel, sponsor: requestedSponsor || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { if (res.status === 401) alert('Session expired — reconnect your wallet.'); return; }
    if (data.done) {
      const tierLabel = questionDisplayLabel(data.level || requestedLevel, data.sponsor || requestedSponsor) || 'that tier';
      const msg = document.getElementById('playIdleMessage');
      if (msg) {
        msg.textContent = data.reason === 'exhausted'
          ? `You've answered every ${tierLabel} question this cycle — pick a different tier, or check back next cycle.`
          : "Daily limit reached — come back tomorrow for more.";
        msg.classList.remove('hidden');
      }
      setPlayRemaining(data.remainingToday || 0, data.capPerDay);
      showPlay('idle');
      return;
    }
    play.instanceId = data.instanceId;
    // When the question reached the player — the other half of answerMs, which
    // the server buckets rather than storing precisely.
    play.askedAt = Date.now();
    play.expiresAt = data.expiresAt;
    play.currentLevel = data.level || requestedLevel;
    play.currentSponsor = data.sponsorKey || requestedSponsor || null;
    document.getElementById('playIdleMessage')?.classList.add('hidden');
    setPlayRemaining(data.remainingToday, data.capPerDay);
    setText('qMeta', `${questionDisplayLabel(data.level, data.sponsorKey)} • ${fmtInt(data.points)} pts • ${data.timeLimitSec || 30}s`);
    setText('qText', data.q);
    const wrap = document.getElementById('qChoices');
    if (wrap) {
      wrap.innerHTML = '';
      (data.choices || []).forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'qChoice'; b.type = 'button';
        b.innerHTML = `<span class="key">${'ABCD'[i]}</span>${escapeHtml(c)}`;
        b.addEventListener('click', () => submitAnswer(i));
        wrap.appendChild(b);
      });
    }
    showPlay('question');
    startTimer(data.timeLimitSec || 30);
  } catch (e) { console.warn('[quiz] start failed:', e); }
}

async function submitAnswer(choice) {
  if (!play.instanceId) return;
  const instanceId = play.instanceId;
  play.instanceId = null;
  clearPlayTimer();
  document.querySelectorAll('.qChoice').forEach((b) => { b.disabled = true; });
  let data = null;
  try {
    const res = await hubApiFetch('/api/quiz/play/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: getAuth().session, instanceId, choice,
        fingerprint: participationFingerprint(),
        answerMs: play.askedAt ? Date.now() - play.askedAt : null,
      }),
    });
    data = await res.json();
  } catch (e) { console.warn('[quiz] answer failed:', e); }

  const btns = document.querySelectorAll('.qChoice');
  if (data && Number.isInteger(data.correctIndex)) {
    btns[data.correctIndex]?.classList.add('correct');
    if (!data.correct && choice >= 0) btns[choice]?.classList.add('wrong');
  }
  const resultEl = document.getElementById('qResultText');
  if (resultEl) {
    if (data?.expired) resultEl.innerHTML = `<span class="bad">⏱ Time's up</span> — no points this one.`;
    else if (data?.correct) resultEl.innerHTML = data.awarded > 0
      ? `<span class="ok">✓ Correct!</span> +${fmtInt(data.awarded)} points`
      : `<span class="ok">✓ Correct!</span> <span class="muted">(already counted this cycle)</span>`;
    else resultEl.innerHTML = `<span class="bad">✗ Not quite.</span>`;
  }
  if (data && typeof data.remainingToday === 'number') setPlayRemaining(data.remainingToday, play.capPerDay);
  showPlay('result');
  loadMe();
  loadLeaderboard(currentScope);
  setPlatformView(currentPlatform);
}

// ── Web quiz-point redemption (parity with Discord's /redeem) ───────────────
// Calls the exact same POST /api/quiz/redeem service Discord's /redeem uses
// (src/quiz/redemption.js -> db.redeemPoints) — same redeemable-points
// balance, same queue,
// same settlement worker. This never sends any transaction itself; it only
// creates a pending redemption record, identical to what Discord creates.
const redeemState = { available: 0, rate: 1, minPoints: 1500, submitting: false };

function shortAddr(addr) {
  const s = String(addr || '');
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function renderRedeemHistory(rows) {
  const body = document.getElementById('redeemHistoryBody');
  if (!body) return;
  const list = Array.isArray(rows) ? rows.filter((r) => r.kind === 'user_redeem') : [];
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No redemptions yet.</td></tr>';
    return;
  }
  body.innerHTML = list.map((r) => {
    const when = r.ts ? new Date(r.ts).toLocaleString() : '—';
    const status = String(r.status || 'pending').toUpperCase();
    const source = r.requestSource ? (r.requestSource === 'web' ? 'Web' : 'Discord') : '—';
    const tx = r.tx ? `<a href="https://solscan.io/tx/${encodeURIComponent(r.tx)}" target="_blank" rel="noreferrer">View ↗</a>` : '—';
    return `<tr><td>${when}</td><td>${fmtInt(r.amount)}</td><td class="num">${fmtLew(r.winlewDue ?? r.winlewSent ?? 0)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(source)}</td><td>${tx}</td></tr>`;
  }).join('');
}

function updateRedeemEstimate() {
  const input = document.getElementById('redeemAmount');
  const amt = Math.max(0, Math.floor(Number(input?.value || 0)));
  setText('redeemEstimate', fmtLew(amt * redeemState.rate));
}

function renderRedeemCard(quiz, redemption) {
  const card = document.getElementById('redeemCard');
  if (!card) return;
  redeemState.available = Number(quiz?.unpaidPoints || 0);
  redeemState.rate = Number(redemption?.payoutRate || 1);
  redeemState.minPoints = Math.max(1, Number(redemption?.minRedeemPoints || redeemState.minPoints));
  setText('redeemAvailable', fmtInt(redeemState.available));
  setText('redeemRate', fmtLew(redeemState.rate));
  setText('redeemMin', fmtInt(redeemState.minPoints));
  const amountInput = document.getElementById('redeemAmount');
  if (amountInput) {
    amountInput.min = String(redeemState.minPoints);
    amountInput.placeholder = `min ${fmtInt(redeemState.minPoints)}`;
  }
  setNavPointsMetric(redeemState.available);
  const walletEl = document.getElementById('redeemWallet');
  if (walletEl) {
    const w = redemption?.linkedWallet;
    walletEl.textContent = w?.address
      ? `${shortAddr(w.address)} (${w.source || 'linked'})`
      : 'No linked wallet yet — verify or link one to receive payouts.';
  }
  renderRedeemHistory(quiz?.payouts?.recent);
  card.classList.remove('hidden');
  updateRedeemEstimate();
}

function showRedeemStage(stage) {
  document.getElementById('redeemForm')?.classList.toggle('hidden', stage !== 'form');
  document.getElementById('redeemConfirm')?.classList.toggle('hidden', stage !== 'confirm');
  document.getElementById('redeemPending')?.classList.toggle('hidden', stage !== 'pending');
}

// Same mint + platforms already used site-wide (src/public/index.html,
// src/public/home/index.html) — shown whenever redemption fails because the
// linked wallet doesn't hold WinLEW (holder-only gate, 2026-07-26), so
// there's always a real next step, not just a rejection.
const WINLEW_MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';
// Same reasoning the project owner posted publicly (2026-07-26): a wallet's
// first-ever WinLEW transfer requires creating its token account on-chain,
// which costs real SOL out of the faucet/quiz treasury — holding any
// amount already means that account exists.
const WHY_HOLDER_ONLY = "It's a fair trade: you cover the one-time cost of getting your first $WinLEW (creating your own token account), and we'll gladly keep sending you $WinLEW for faucet claims and quiz rewards after that — usually within about 10 redemptions, we've already broken even on that cost.";
function buyWinlewLinksHtml() {
  const links = [
    ['🏁 pump.fun', `https://pump.fun/coin/${WINLEW_MINT}`],
    ['🔁 Swap on pump.fun', `https://swap.pump.fun/?input=So11111111111111111111111111111111111111112&output=${WINLEW_MINT}`],
    ['🔁 Swap on Raydium', `https://raydium.io/swap/?inputMint=sol&outputMint=${WINLEW_MINT}`],
  ];
  const buttons = links.map(([label, url]) => `<a class="btn" href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`).join(' ');
  return `<div class="fine muted" style="margin-top:8px;">${escapeHtml(WHY_HOLDER_ONLY)}</div>
    <div class="fine muted" style="margin-top:6px;">Buy on whichever platform you prefer — always double-check the mint (<code>${WINLEW_MINT}</code>) before swapping.</div>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">${buttons}</div>`;
}
const HOLDER_ONLY_CODES = new Set(['no_wallet', 'zero_balance']);

function setRedeemFormError(msg, code) {
  const el = document.getElementById('redeemFormError');
  if (!el) return;
  if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.innerHTML = escapeHtml(msg) + (HOLDER_ONLY_CODES.has(code) ? buyWinlewLinksHtml() : '');
  el.classList.remove('hidden');
}

function beginRedeemConfirm() {
  setRedeemFormError('');
  const input = document.getElementById('redeemAmount');
  const amount = Math.floor(Number(input?.value || 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    setRedeemFormError('Enter a positive whole number of points.');
    return;
  }
  if (amount < redeemState.minPoints) {
    setRedeemFormError(`Minimum redemption is ${fmtInt(redeemState.minPoints)} points (${fmtLew(redeemState.minPoints * redeemState.rate)} WinLEW — the same as one faucet drip). Keep stacking points until you're past the line.`);
    return;
  }
  if (amount > redeemState.available) {
    setRedeemFormError(`You only have ${fmtInt(redeemState.available)} redeemable points.`);
    return;
  }
  const estimate = fmtLew(amount * redeemState.rate);
  setText('redeemConfirmText', `Redeem ${fmtInt(amount)} points for an estimated ${estimate} WinLEW? This creates a pending redemption request — it does not send WinLEW instantly.`);
  redeemState.pendingAmount = amount;
  showRedeemStage('confirm');
}

async function confirmRedeem() {
  if (redeemState.submitting) return;
  const amount = redeemState.pendingAmount;
  if (!amount) { showRedeemStage('form'); return; }
  redeemState.submitting = true;
  showRedeemStage('pending');
  try {
    const auth = getAuth();
    const res = await hubApiFetch('/api/quiz/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: auth.session, amount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setRedeemFormError(data.error || 'Redemption failed — try again.', data.code);
      showRedeemStage('form');
      return;
    }
    const input = document.getElementById('redeemAmount');
    if (input) input.value = '';
    redeemState.available = Math.max(0, redeemState.available - amount);
    setText('redeemAvailable', fmtInt(redeemState.available));
    setNavPointsMetric(redeemState.available);
    updateRedeemEstimate();
    showRedeemStage('form');
    await loadMe();
  } catch (e) {
    console.warn('[quiz] redeem failed:', e);
    setRedeemFormError('Redemption failed — try again.');
    showRedeemStage('form');
  } finally {
    redeemState.submitting = false;
  }
}

// ── helpers + boot ───────────────────────────────────────────────────────────
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function init() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadLeaderboard(btn.getAttribute('data-scope'));
    });
  });
  document.querySelectorAll('.platformTab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platformTab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setPlatformView(btn.getAttribute('data-platform'));
    });
  });
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => void walletLogin(e.currentTarget));
  document.querySelectorAll('.tierTile').forEach((btn) => {
    btn.addEventListener('click', () => void startQuestion(btn.getAttribute('data-level'), btn.getAttribute('data-sponsor')));
  });
  document.getElementById('playNext')?.addEventListener('click', () => void startQuestion());
  document.getElementById('playChangeTier')?.addEventListener('click', () => {
    play.currentLevel = null;
    play.currentSponsor = null;
    showPlay('idle');
  });
  document.getElementById('redeemAmount')?.addEventListener('input', updateRedeemEstimate);
  document.getElementById('redeemMaxBtn')?.addEventListener('click', () => {
    const input = document.getElementById('redeemAmount');
    if (input) { input.value = String(redeemState.available); updateRedeemEstimate(); }
  });
  document.getElementById('redeemSubmitBtn')?.addEventListener('click', beginRedeemConfirm);
  document.getElementById('redeemConfirmBtn')?.addEventListener('click', () => void confirmRedeem());
  document.getElementById('redeemCancelBtn')?.addEventListener('click', () => showRedeemStage('form'));
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');

  loadCycle();
  loadLeaderboard('cycle');
  loadPlatformLeaderboard('web');
  loadMe();
  setInterval(renderCountdown, 1000);
  setInterval(loadCycle, 60000);
  setInterval(() => loadLeaderboard(currentScope), 30000);
  setInterval(() => setPlatformView(currentPlatform), 30000);
}
document.addEventListener('DOMContentLoaded', init);
