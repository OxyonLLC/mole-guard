// WinLEW Governance landing page — fetches /api/governance/proposals and
// renders exactly what the backend returns. Results are always the
// server-computed `results` field; this file never tallies votes itself.
const { hubApiFetch, getAuth, walletLogin, setConnectedUi, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const CATEGORY_LABELS = {
  community: 'Community', features: 'Features', quiz: 'Quiz', faucet: 'Faucet', games: 'Games',
  events: 'Events', rewards: 'Rewards', 'proof-of-value': 'Proof of Value', 'burn-program': 'Burn Program',
  'treasury-allocation': 'Treasury Allocation', partnerships: 'Partnerships', grants: 'Grants',
  'governance-rules': 'Governance Rules', 'platform-policy': 'Platform Policy',
};

const MODE_LABELS = {
  advisory: 'Advisory', 'community-approved': 'Community-approved', 'maintainer-ratified': 'Maintainer-ratified',
  'binding-within-defined-policy': 'Binding within policy',
};

const ACTIVE_STATUSES = new Set(['active']);
const UPCOMING_STATUSES = new Set(['draft', 'review', 'discussion', 'scheduled']);
const CLOSED_STATUSES = new Set([
  'passed', 'rejected', 'quorum-not-met', 'cancelled', 'expired', 'awaiting-ratification',
  'approved-for-execution', 'executing', 'executed', 'execution-failed', 'superseded', 'archived',
]);

function bucketOfStatus(status) {
  if (ACTIVE_STATUSES.has(status)) return 'active';
  if (UPCOMING_STATUSES.has(status)) return 'upcoming';
  return 'closed';
}

function statusPillClass(status) {
  if (ACTIVE_STATUSES.has(status)) return 'active';
  if (UPCOMING_STATUSES.has(status)) return 'upcoming';
  if (status === 'rejected' || status === 'quorum-not-met' || status === 'execution-failed') return 'rejected';
  return 'closed';
}

let allProposals = [];
let currentBucket = 'active';

function renderProposalCard(p) {
  const a = document.createElement('a');
  a.className = 'proposalCard';
  a.href = `/governance/proposal/?id=${encodeURIComponent(p.id)}`;

  const closes = p.votingEndIso ? `Closes ${fmtDate(p.votingEndIso)}` : (p.votingStartIso ? '' : 'Not yet scheduled');
  const results = p.results || {};
  const total = Number(results.totalEligibleVotesCast || 0);
  const topPct = total > 0 ? Math.max(...Object.values(results.percentByChoice || {})) : 0;

  a.innerHTML = `
    <div class="pHead">
      <h3>${esc(p.title)}</h3>
      <span class="statusPill ${statusPillClass(p.status)}">${esc(p.status)}</span>
    </div>
    <div class="pMeta">${esc(CATEGORY_LABELS[p.category] || p.category)} · <span class="modePill">${esc(MODE_LABELS[p.governanceMode] || p.governanceMode)}</span>${closes ? ` · ${esc(closes)}` : ''}</div>
    <p class="pSummary">${esc(p.summary)}</p>
    ${total > 0 ? `<div class="pProgress"><div class="pProgressFill" style="width:${Math.min(100, topPct)}%"></div></div><p class="muted" style="font-size:12px;margin-top:6px;">${total} eligible vote${total === 1 ? '' : 's'} cast</p>` : ''}
  `;
  return a;
}

function renderBucket(bucket) {
  currentBucket = bucket;
  document.querySelectorAll('#proposalTabs .tab').forEach((btn) => btn.classList.toggle('active', btn.getAttribute('data-bucket') === bucket));
  const grid = document.getElementById('proposalGrid');
  if (!grid) return;

  let list;
  if (bucket === 'archive') list = allProposals.filter((p) => CLOSED_STATUSES.has(p.status));
  else list = allProposals.filter((p) => bucketOfStatus(p.status) === bucket);

  grid.innerHTML = '';
  if (!list.length) {
    const messages = {
      active: 'No proposals are open for voting right now.',
      upcoming: 'Nothing scheduled yet — check back soon or follow Discord for announcements.',
      completed: 'No completed proposals yet.',
      archive: 'The archive is empty so far.',
    };
    grid.innerHTML = `<div class="muted">${esc(messages[bucket] || 'Nothing here yet.')}</div>`;
    return;
  }
  list.slice(0, bucket === 'archive' ? 200 : 20).forEach((p) => grid.appendChild(renderProposalCard(p)));
}

function renderCategories(categoriesInUse) {
  const el = document.getElementById('categoryList');
  if (!el) return;
  const cats = categoriesInUse.length ? categoriesInUse : Object.keys(CATEGORY_LABELS);
  el.innerHTML = cats.map((c) => `<span class="catChip">${esc(CATEGORY_LABELS[c] || c)}</span>`).join('');
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

async function loadEligibilitySummary() {
  const auth = getAuth();
  const el = document.getElementById('qaEligible');
  if (!auth.session) { if (el) el.textContent = 'Sign in and verify a wallet to check.'; return; }
  try {
    // Use the launch record as a stand-in eligibility probe if no proposal
    // is active — eligibility itself is proposal-independent in v1 (same
    // global rule), so any real proposal id works for this summary check.
    const probeId = allProposals[0]?.id;
    if (!probeId) return;
    const res = await hubApiFetch(`/api/governance/eligibility/${encodeURIComponent(probeId)}`);
    const data = await res.json();
    if (!res.ok) { if (el) el.textContent = res.status === 401 ? 'Sign in to check eligibility.' : 'Eligibility temporarily unavailable.'; return; }
    if (data.eligible === null) { if (el) el.textContent = 'Eligibility temporarily unavailable — try again shortly.'; return; }
    if (el) el.textContent = data.eligible ? `Yes — verified wallet holds ${Number(data.balance).toLocaleString()} WinLEW.` : (data.reason === 'wallet_not_verified' ? 'Not yet — verify a wallet first.' : `Not yet — holds below the ${Number(data.minWinlewToVote).toLocaleString()} WinLEW minimum.`);
  } catch (e) {
    console.warn('[governance] eligibility summary failed:', e);
    if (el) el.textContent = 'Eligibility temporarily unavailable.';
  }
}

async function loadProposals() {
  try {
    const res = await hubApiFetch('/api/governance/proposals');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'governance_proposals_failed');
    allProposals = data.proposals || [];

    setText('statActive', allProposals.filter((p) => ACTIVE_STATUSES.has(p.status)).length);
    setText('statUpcoming', allProposals.filter((p) => UPCOMING_STATUSES.has(p.status)).length);
    setText('statCompleted', allProposals.filter((p) => CLOSED_STATUSES.has(p.status)).length);
    setText('statMinBalance', data.config?.minWinlewToVote != null ? Number(data.config.minWinlewToVote).toLocaleString() : '—');
    setText('eligMin', data.config?.minWinlewToVote != null ? Number(data.config.minWinlewToVote).toLocaleString() : '1');
    // Second half of the 2026-08-06 split gate — the bar for buying weight
    // on top of the free vote, not the bar for voting at all.
    setText('eligPurchaseMin', data.config?.minWinlewToPurchaseVotes != null ? Number(data.config.minWinlewToPurchaseVotes).toLocaleString() : '1,000,000');

    // Hero strip mirrors the same fetched proposal list — no second data source.
    setText('heroActiveProposals', allProposals.filter((p) => ACTIVE_STATUSES.has(p.status)).length);
    setText('heroCompletedProposals', allProposals.filter((p) => CLOSED_STATUSES.has(p.status)).length);

    const activeTitles = allProposals.filter((p) => ACTIVE_STATUSES.has(p.status)).map((p) => p.title);
    setText('qaWhat', activeTitles.length ? activeTitles.join(', ') : 'Nothing open for a vote right now — see Upcoming and the archive below.');

    renderCategories([...new Set(allProposals.map((p) => p.category))]);
    renderBucket(currentBucket);
    await loadEligibilitySummary();
  } catch (e) {
    console.warn('[governance] proposals load failed:', e);
    const grid = document.getElementById('proposalGrid');
    if (grid) grid.innerHTML = '<p class="muted">⚠️ Could not load governance data right now. Try refreshing.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#proposalTabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => renderBucket(btn.getAttribute('data-bucket')));
  });
  loadProposals();
});

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
