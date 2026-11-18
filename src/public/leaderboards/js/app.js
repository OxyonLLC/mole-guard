// WinLEW Leaderboards — thin client over 3 existing/new APIs:
//   /api/quiz/leaderboard/platform?platform=web|discord   (pre-existing)
//   /api/faucet/leaderboard?source=web|discord             (new)
//   /api/games/leaderboard?game=<key>                      (new, web-only —
//     the Gaming Hub isn't on Discord yet, so that tab stays disabled)
// This page never computes rankings itself — it only renders whatever the
// server returns, same "evidence over assumptions" contract every other
// leaderboard on the site already follows.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rankClass(rank) {
  if (rank === 1) return 'rankCell top1';
  if (rank === 2) return 'rankCell top2';
  if (rank === 3) return 'rankCell top3';
  return 'rankCell';
}

function nameCell(entry) {
  // "masked" here means "no display name saved" (src/mole/web.js's
  // quizDisplayName()) — unrelated to wallet-verification status. Was
  // labeled "(unverified)" until 2026-07-28, which falsely implied it, so a
  // fully verified, actively-playing user with no display name set would
  // misleadingly read as unverified.
  return `${esc(entry.name)}${entry.masked ? ' <span class="muted" style="font-size:11px;">(no name set)</span>' : ''}`;
}

function renderTable(wrapId, columns, entries, emptyMessage) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML = `<div class="emptyRow" style="padding:22px 0;">${esc(emptyMessage)}</div>`;
    return;
  }
  const head = columns.map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const rows = entries.map((entry) => {
    const cells = columns.map((c) => `<td${c.num ? ' class="num"' : ''}>${c.render(entry)}</td>`).join('');
    return `<tr class="${entry.masked ? 'masked' : ''}">${cells}</tr>`;
  }).join('');
  wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// `key` is the data-attribute the tabs carry: platform for the Web/Discord
// rows, cause for Clout's per-reserve rows.
function wireTabs(containerSelector, onChange, { key = 'platform', fallback = 'web' } = {}) {
  const container = document.querySelector(containerSelector);
  if (!container) return { getActive: () => fallback };
  let active = container.querySelector('.pill.active')?.dataset[key] ?? fallback;
  container.querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      container.querySelectorAll('.pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      active = btn.dataset[key] ?? fallback;
      onChange(active);
    });
  });
  return { getActive: () => active };
}

// ── Quiz ─────────────────────────────────────────────────────────────────
async function loadQuizBoard(platform) {
  const wrap = document.getElementById('quizTableWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await hubApiFetch(`/api/quiz/leaderboard/platform?platform=${encodeURIComponent(platform)}&limit=25`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'quiz_leaderboard_failed');
    renderTable('quizTableWrap', [
      { label: '#', render: (e) => `<span class="${rankClass(e.rank)}">${e.rank}</span>` },
      { label: 'Player', render: nameCell },
      { label: 'Points', num: true, render: (e) => e.points.toLocaleString() },
      { label: 'Accuracy', num: true, render: (e) => `${Math.round((e.accuracy || 0) * 100)}%` },
      { label: 'Best Streak', num: true, render: (e) => e.bestStreak },
    ], data.entries || [], `No ${platform === 'web' ? 'Web' : 'Discord'} quiz activity yet.`);
  } catch (e) {
    console.warn('[leaderboards] quiz load failed:', e);
    if (wrap) wrap.innerHTML = '<p class="muted">⚠️ Could not load the Quiz leaderboard right now.</p>';
  }
}

// ── Faucet ───────────────────────────────────────────────────────────────
async function loadFaucetBoard(source) {
  const wrap = document.getElementById('faucetTableWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await hubApiFetch(`/api/faucet/leaderboard?source=${encodeURIComponent(source)}&limit=25`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'faucet_leaderboard_failed');
    renderTable('faucetTableWrap', [
      { label: '#', render: (e) => `<span class="${rankClass(e.rank)}">${e.rank}</span>` },
      { label: 'Player', render: nameCell },
      { label: 'Total Claimed', num: true, render: (e) => `${Number(e.totalAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} WinLEW` },
      { label: 'Claims', num: true, render: (e) => e.claims },
    ], data.entries || [], `No confirmed ${source === 'web' ? 'Web' : 'Discord'} faucet claims yet.`);
  } catch (e) {
    console.warn('[leaderboards] faucet load failed:', e);
    if (wrap) wrap.innerHTML = '<p class="muted">⚠️ Could not load the Faucet leaderboard right now.</p>';
  }
  loadFaucetLifetimeNote();
}

// Lifetime on-chain payout total, for context under the ranking. The board
// above ranks by claims THIS PLATFORM RECORDED; this is what the reserve
// wallet has actually sent, ever — a strictly larger figure that also covers
// pre-platform Discord payouts and the quiz/game rewards it signs. Stays
// hidden unless `npm run faucet:scan` has produced a reconciled checkpoint.
let _faucetLifetimeLoaded = false;
async function loadFaucetLifetimeNote() {
  if (_faucetLifetimeLoaded) return;
  const note = document.getElementById('faucetLifetimeNote');
  if (!note) return;
  try {
    const res = await hubApiFetch('/api/faucet/global-stats');
    const data = await res.json();
    const chain = data?.onChain;
    if (!res.ok || !data.ok || !chain) return;
    _faucetLifetimeLoaded = true;
    const total = Number(String(chain.totalDistributedDisplay).replace(/,/g, ''));
    note.textContent =
      `Lifetime, on-chain: the faucet reserve wallet has sent ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} WinLEW ` +
      `across ${Number(chain.payoutCount).toLocaleString()} payouts to ${chain.distinctRecipients} wallets. ` +
      `That total is larger than the rankings above because it also covers Discord payouts made before this leaderboard existed, ` +
      `plus quiz and game rewards signed by the same wallet` +
      (chain.reconciled ? ' — verified complete against the wallet\'s live balance.' : '.');
    note.style.display = '';
  } catch (e) {
    console.warn('[leaderboards] faucet lifetime note failed:', e);
  }
}

// ── Games ────────────────────────────────────────────────────────────────
const GAME_LABELS = {
  rootglide: 'Root Glide', burrowblaster: 'Burrow Blaster', pacmole: 'Pac-Mole',
  diglew: 'DigLEW', grubdrop: 'Grub Drop',
};
async function loadGamesBoard(game, platform) {
  const wrap = document.getElementById('gamesTableWrap');
  if (platform === 'discord') {
    if (wrap) wrap.innerHTML = `<div class="comingSoon">🚧 ${esc(GAME_LABELS[game] || game)} isn't on Discord yet — this tab will light up once the Gaming Hub ships there.</div>`;
    return;
  }
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await hubApiFetch(`/api/games/leaderboard?game=${encodeURIComponent(game)}&limit=25`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'games_leaderboard_failed');
    const hasLevels = (data.entries || []).some((e) => e.topLevel != null);
    renderTable('gamesTableWrap', [
      { label: '#', render: (e) => `<span class="${rankClass(e.rank)}">${e.rank}</span>` },
      { label: 'Player', render: nameCell },
      { label: 'Total Earned', num: true, render: (e) => `${Number(e.totalEarned).toLocaleString(undefined, { maximumFractionDigits: 2 })} WinLEW` },
      hasLevels
        ? { label: 'Top Level', num: true, render: (e) => (e.topLevel != null ? e.topLevel : '—') }
        : { label: 'Top Score', num: true, render: (e) => (e.topScore != null ? e.topScore.toLocaleString() : '—') },
      { label: 'Rounds', num: true, render: (e) => e.claims },
    ], data.entries || [], `No ${GAME_LABELS[game] || game} rewards claimed yet — be the first.`);
  } catch (e) {
    console.warn('[leaderboards] games load failed:', e);
    if (wrap) wrap.innerHTML = '<p class="muted">⚠️ Could not load this game’s leaderboard right now.</p>';
  }
}

// ── Clout ────────────────────────────────────────────────────────────────
// Same /api/contribute/leaderboard the /contribute/ page renders, so the two
// can never disagree. The API returns rows already sorted but without a rank
// field (the contribute page derives it from the index), so do the same here.
async function loadCloutBoard(cause) {
  const wrap = document.getElementById('cloutTableWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await hubApiFetch(`/api/contribute/leaderboard?cause=${encodeURIComponent(cause || '')}&limit=25`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'clout_leaderboard_failed');
    const entries = (data.entries || []).map((entry, i) => ({ ...entry, rank: i + 1 }));
    renderTable('cloutTableWrap', [
      { label: '#', render: (e) => `<span class="${rankClass(e.rank)}">${e.rank}</span>` },
      {
        label: 'Contributor',
        render: (e) => `${nameCell(e)}${e.externalVerified ? ' <span class="muted" style="font-size:11px;">(off-platform, verified)</span>' : ''}`,
      },
      { label: 'Total', num: true, render: (e) => `${Number(e.total).toLocaleString(undefined, { maximumFractionDigits: 2 })} WinLEW` },
      { label: 'Contributions', num: true, render: (e) => e.contributions },
      {
        label: 'Evidence',
        render: (e) => {
          const urls = Array.isArray(e.evidenceUrls) ? e.evidenceUrls : [];
          if (!urls.length) return '<span class="muted">—</span>';
          return urls
            .map((url, i) => `<a href="${esc(url)}" target="_blank" rel="noreferrer noopener" title="View this transaction on Solscan">Solscan${urls.length > 1 ? ` #${i + 1}` : ''} ↗</a>`)
            .join(' · ');
        },
      },
    ], entries, cause
      ? 'No contributions to this reserve yet — be the first.'
      : 'No contributions yet — be the first.');
  } catch (e) {
    console.warn('[leaderboards] clout load failed:', e);
    if (wrap) wrap.innerHTML = '<p class="muted">⚠️ Could not load the Clout leaderboard right now.</p>';
  }
}

// ── Governance ───────────────────────────────────────────────────────────
// Participation only. The API never returns a vote choice (see
// governanceData.js's voteChoicePrivacy), so there is nothing to render here
// that could reveal how anyone voted.
async function loadGovernanceBoard() {
  const wrap = document.getElementById('governanceTableWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await hubApiFetch('/api/governance/leaderboard');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'governance_leaderboard_failed');

    // Sealed until enough distinct voters exist that no row can be
    // triangulated back to a private choice — the server enforces this and
    // sends no identities at all while gated (see /api/governance/leaderboard).
    if (data.gated) {
      if (wrap) {
        wrap.innerHTML = `<div class="comingSoon">🔒 Sealed until <strong>${Number(data.minVoters)}</strong> people have voted `
          + `— <strong>${Number(data.voterCount)}</strong> so far.<br>`
          + `<span class="muted" style="font-size:13px;">With only a few voters, naming who took part could give away how they voted. `
          + `This board opens once there are enough participants for that to be impossible.</span></div>`;
      }
      return;
    }

    renderTable('governanceTableWrap', [
      { label: '#', render: (e) => `<span class="${rankClass(e.rank)}">${e.rank}</span>` },
      { label: 'Voter', render: nameCell },
      { label: 'Proposals Voted', num: true, render: (e) => e.proposalsVoted },
      { label: 'Vote Weight', num: true, render: (e) => Number(e.totalWeight || 0).toLocaleString() },
      {
        label: 'Last Voted',
        render: (e) => (e.lastVotedIso ? new Date(e.lastVotedIso).toLocaleDateString() : '<span class="muted">—</span>'),
      },
    ], data.entries || [], 'No votes cast yet — verified holders get one free vote per proposal.');
  } catch (e) {
    console.warn('[leaderboards] governance load failed:', e);
    if (wrap) wrap.innerHTML = '<p class="muted">⚠️ Could not load the Governance leaderboard right now.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const quizTabs = wireTabs('[data-tabs="quiz"]', (platform) => loadQuizBoard(platform));
  const faucetTabs = wireTabs('[data-tabs="faucet"]', (platform) => loadFaucetBoard(platform));
  const gameSelect = document.getElementById('gameSelect');
  const gamesTabs = wireTabs('[data-tabs="games"]', (platform) => loadGamesBoard(gameSelect.value, platform));

  const cloutTabs = wireTabs('[data-tabs="clout"]', (cause) => loadCloutBoard(cause), { key: 'cause', fallback: '' });

  gameSelect?.addEventListener('change', () => loadGamesBoard(gameSelect.value, gamesTabs.getActive()));

  loadQuizBoard(quizTabs.getActive());
  loadFaucetBoard(faucetTabs.getActive());
  loadGamesBoard(gameSelect ? gameSelect.value : 'rootglide', gamesTabs.getActive());
  loadCloutBoard(cloutTabs.getActive());
  loadGovernanceBoard();
});

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
