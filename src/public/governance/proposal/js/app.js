// WinLEW Governance proposal detail — fetches the proposal, live results,
// the caller's own eligibility/vote state, and (for burn-program proposals)
// the canonical Burn Center totals from /api/burn/status. Never tallies
// results client-side; never trusts a client-supplied wallet.
const { hubApiFetch, getAuth, walletLogin, setConnectedUi, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function show(id, on = true) { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !on); }

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

function statusPillClass(status) {
  if (ACTIVE_STATUSES.has(status)) return 'active';
  if (UPCOMING_STATUSES.has(status)) return 'upcoming';
  if (status === 'rejected' || status === 'quorum-not-met' || status === 'execution-failed') return 'rejected';
  return 'closed';
}

function getProposalId() {
  return new URLSearchParams(window.location.search).get('id') || '';
}

let currentProposal = null;
let pendingChoice = null;

function renderResults(results, choices) {
  const total = Number(results?.totalEligibleVotesCast || 0);
  setText('resTotal', total);
  setText('resQuorum', results?.quorumMet ? `Met (${results.quorumMinVotes} needed)` : `Not yet met (${results.quorumMinVotes} needed)`);
  setText('resThreshold', `${Math.round((results?.approvalThreshold || 0) * 100)}%`);
  setText('resOutcome', total === 0 ? 'No votes yet' : (results?.approvalPassed ? 'Passing' : 'Not passing'));
  setText('resUpdated', `Weighting: ${results?.weightingMethod || '—'} · Data last updated ${fmtDate(results?.dataLastUpdatedIso)}`);

  const bar = document.getElementById('choiceBar');
  if (!bar) return;
  const list = choices && choices.length ? choices : Object.keys(results?.votesByChoice || {});
  bar.innerHTML = list.map((choice) => {
    const count = results?.votesByChoice?.[choice] || 0;
    const pct = results?.percentByChoice?.[choice] || 0;
    return `
      <div class="choiceRow">
        <div class="cLabel"><span>${esc(choice)}</span><span>${count} · ${pct}%</span></div>
        <div class="choiceTrack"><div class="choiceFill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

function renderBallot(proposal, eligibility, myVote) {
  const wrap = document.getElementById('ballotWrap');
  const votingOpen = ACTIVE_STATUSES.has(proposal.status);
  if (!votingOpen) {
    show('ballotWrap', false);
    show('ballotClosedNote', true);
    setText('ballotClosedNote', proposal.status === 'active' ? '' : `Voting is not open — this proposal's status is "${proposal.status}".`);
    return;
  }
  show('ballotClosedNote', false);

  if (!eligibility || eligibility.eligible !== true) {
    show('ballotWrap', false);
    return;
  }
  show('ballotWrap', true);

  const choicesEl = document.getElementById('ballotChoices');
  if (choicesEl) {
    choicesEl.innerHTML = (proposal.choices || []).map((choice) => {
      const selected = myVote?.choice === choice;
      return `<button type="button" class="choiceBtn${selected ? ' selected' : ''}" data-choice="${esc(choice)}">${esc(choice)}${selected ? ' — your current vote' : ''}</button>`;
    }).join('');
    choicesEl.querySelectorAll('.choiceBtn').forEach((btn) => {
      btn.addEventListener('click', () => beginVoteConfirm(btn.getAttribute('data-choice')));
    });
  }
  show('voteConfirm', false);
  show('voteReceipt', false);
}

function beginVoteConfirm(choice) {
  pendingChoice = choice;
  setText('voteConfirmText', `Cast your vote for "${choice}" on this proposal?`);
  show('voteConfirm', true);
  document.getElementById('voteError')?.classList.add('hidden');
}

async function confirmVote() {
  if (!pendingChoice || !currentProposal) return;
  const btn = document.getElementById('voteConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    const auth = getAuth();
    const res = await hubApiFetch('/api/governance/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: auth.session, proposalId: currentProposal.id, choice: pendingChoice }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      const errEl = document.getElementById('voteError');
      if (errEl) { errEl.textContent = data.error || 'Could not record your vote — try again.'; errEl.classList.remove('hidden'); }
      show('voteConfirm', false);
      return;
    }
    show('voteConfirm', false);
    show('voteReceipt', true);
    setText('voteReceiptText', `✅ Recorded — you voted "${data.vote.choice}" at ${fmtDate(data.vote.updatedAtIso)}. You may change this until voting closes.`);
    setText('yourVote', data.vote.choice);
    renderResults(data.results, currentProposal.choices);
    renderBallot(currentProposal, { eligible: true }, data.vote);
  } catch (e) {
    console.warn('[governance] vote submit failed:', e);
    const errEl = document.getElementById('voteError');
    if (errEl) { errEl.textContent = 'Network error — try again.'; errEl.classList.remove('hidden'); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderBurnDetails(proposal, burnStatus) {
  if (proposal.category !== 'burn-program' || !proposal.burnDetails) return;
  show('burnDetailsBox', true);
  const kv = document.getElementById('burnDetailsKv');
  if (!kv) return;
  const bd = proposal.burnDetails;
  const rows = [
    ['Proposed amount', bd.proposedAmountDisplay || '—'],
    ['Proposed source', bd.proposedSource || '—'],
    ['Proposed benchmark/date', bd.proposedBenchmark || '—'],
    ['Reason', bd.reason || '—'],
    ['Effect on 100M goal', bd.effectOnGoal || '—'],
    ['Current verified burn total', burnStatus ? `${Number(burnStatus.summary?.confirmedBurnedDisplay || 0).toLocaleString()} WinLEW` : 'Temporarily unavailable'],
    // The wallet's live balance IS the "awaiting burn" amount — not
    // burnStatus.summary.stagedDisplay, which sums burn EVENTS explicitly
    // marked "transferred-to-burn-wallet"/"queued" (a separate, currently-
    // empty concept) and was always showing a false 0 here. See the same
    // fix/comment in src/public/burn/js/app.js.
    ['Current wallet balance (awaiting burn)', burnStatus?.wallet?.ok !== false && burnStatus?.wallet?.winlewBalance != null ? `${Number(burnStatus.wallet.winlewBalance).toLocaleString()} WinLEW` : 'Temporarily unavailable'],
    ['Remaining to target', burnStatus ? `${Number(burnStatus.progress?.remainingDisplay || 0).toLocaleString()} WinLEW` : 'Temporarily unavailable'],
    ['Execution authority', bd.executionAuthority || 'Maintainer, after safety review'],
    ['Execution deadline', bd.executionDeadline || '—'],
  ];
  kv.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

async function loadEligibilityAndVote(proposal) {
  const auth = getAuth();
  if (!auth.session) {
    setText('yourEligibility', 'Sign in to check');
    setText('yourVote', '—');
    renderBallot(proposal, null, null);
    return;
  }
  try {
    const [eligRes, voteRes] = await Promise.all([
      hubApiFetch(`/api/governance/eligibility/${encodeURIComponent(proposal.id)}`),
      hubApiFetch(`/api/governance/my-vote/${encodeURIComponent(proposal.id)}`),
    ]);
    const elig = await eligRes.json();
    const voteData = voteRes.ok ? await voteRes.json() : { hasVoted: false, vote: null };

    if (!eligRes.ok) {
      setText('yourEligibility', eligRes.status === 401 ? 'Session expired' : 'Temporarily unavailable');
    } else if (elig.eligible === null) {
      setText('yourEligibility', 'Eligibility temporarily unavailable');
    } else if (elig.eligible) {
      setText('yourEligibility', `Eligible (${Number(elig.balance).toLocaleString()} WinLEW)`);
    } else {
      setText('yourEligibility', elig.reason === 'wallet_not_verified' ? 'Not eligible — verify a wallet' : `Not eligible — below ${Number(elig.minWinlewToVote).toLocaleString()} WinLEW`);
    }

    // v1.1 — make the snapshot source/timestamp visible rather than
    // implying every eligibility check is a live balance read. `preview`
    // means the snapshot boundary hasn't passed yet (or no proposal-
    // specific snapshot applies), so this is still a live, non-binding
    // check; `snapshot` means the result was locked in at that timestamp
    // and reused since, regardless of later balance changes.
    const noteEl = document.getElementById('eligibilitySnapshotNote');
    if (noteEl) {
      if (eligRes.ok && elig.snapshot) {
        noteEl.textContent = `Locked in at ${fmtDate(elig.snapshot.recordedAtIso)} (proposal snapshot boundary: ${fmtDate(elig.snapshot.snapshotAtIso)}). Later balance changes don't affect this — see Governance rules for what this snapshot does and doesn't guarantee.`;
      } else if (eligRes.ok && elig.preview) {
        noteEl.textContent = 'Live preview — this proposal hasn\'t reached its eligibility snapshot boundary yet, so this reflects your current balance, not a locked-in result.';
      } else {
        noteEl.textContent = '';
      }
    }

    setText('yourVote', voteData.hasVoted ? voteData.vote.choice : 'Not voted yet');
    renderBallot(proposal, eligRes.ok ? elig : null, voteData.vote);
  } catch (e) {
    console.warn('[governance] eligibility/vote load failed:', e);
    setText('yourEligibility', 'Temporarily unavailable');
  }
}

async function loadProposal() {
  const id = getProposalId();
  if (!id) { show('loading', false); show('notFound', true); return; }
  try {
    const res = await hubApiFetch(`/api/governance/proposals/${encodeURIComponent(id)}`);
    if (res.status === 404) { show('loading', false); show('notFound', true); return; }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'proposal_load_failed');
    const p = data.proposal;
    currentProposal = p;

    document.title = `${p.title} — WinLEW Governance`;
    setText('pTitle', p.title);
    const pill = document.getElementById('pStatusPill');
    if (pill) { pill.textContent = p.status; pill.className = `statusPill ${statusPillClass(p.status)}`; }
    setText('pCategory', CATEGORY_LABELS[p.category] || p.category);
    setText('pMode', MODE_LABELS[p.governanceMode] || p.governanceMode);
    setText('pAuthor', `${p.author} (${p.authorType})`);
    setText('pSummary', p.summary);
    setText('pFullDescription', p.fullDescription || '');

    setText('rCreated', fmtDate(p.createdIso));
    setText('rDiscussion', fmtDate(p.discussionStartIso));
    setText('rVotingWindow', p.votingStartIso ? `${fmtDate(p.votingStartIso)} → ${fmtDate(p.votingEndIso)}` : 'Not yet scheduled');
    setText('rExecDeadline', fmtDate(p.executionDeadlineIso));
    setText('rVotingMethod', p.votingMethod || '—');
    setText('rEligibility', p.eligibilityRule ? `Verified wallet, ≥ ${p.eligibilityRule.minWinlewBalance} WinLEW` : '—');
    setText('rQuorum', p.quorumRule ? `${p.quorumRule.minVotes} votes (${p.quorumRule.type})` : '—');
    setText('rThreshold', `${Math.round((data.proposal.results?.approvalThreshold || 0) * 100)}%`);
    setText('rSnapshot', p.snapshotRule || '—');
    const discussionEl = document.getElementById('rDiscussionLink');
    if (discussionEl) discussionEl.innerHTML = p.discussionUrl ? `<a href="${esc(p.discussionUrl)}" target="_blank" rel="noreferrer">Open discussion ↗</a>` : 'None linked';

    setText('dFinancial', p.financialImpact || 'None stated');
    setText('dToken', p.tokenImpact || 'None stated');
    setText('dSecurity', p.securityConsiderations || 'None stated');
    setText('dRisks', p.risks || 'None stated');
    setText('dAlternatives', p.alternativesConsidered || 'None stated');
    setText('dImplementation', p.implementationPlan || 'None stated');
    setText('dMaintainer', p.maintainerPosition || 'Not yet provided');

    const evEl = document.getElementById('evidenceLinks');
    if (evEl) evEl.innerHTML = (p.supportingEvidence || []).map((e) => `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.label)} ↗</a>`).join('');

    setText('eDecision', p.finalDecision || 'Not yet decided');
    setText('eStatus', p.executionStatus || 'not-applicable');
    setText('eReason', p.cancellationOrRejectionReason || '—');
    const exEl = document.getElementById('executionEvidence');
    if (exEl) exEl.innerHTML = (p.executionEvidence || []).map((e) => `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.label)} ↗</a>`).join('') || '<span class="muted">No execution evidence yet.</span>';

    renderResults(p.results, p.choices);

    if (p.category === 'burn-program') {
      try {
        const burnRes = await hubApiFetch('/api/burn/status');
        const burnData = burnRes.ok ? await burnRes.json() : null;
        renderBurnDetails(p, burnData?.ok ? burnData : null);
      } catch {
        renderBurnDetails(p, null);
      }
    }

    show('loading', false);
    show('content', true);

    await loadEligibilityAndVote(p);
  } catch (e) {
    console.warn('[governance] proposal load failed:', e);
    show('loading', false);
    show('notFound', true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('voteConfirmBtn')?.addEventListener('click', () => void confirmVote());
  document.getElementById('voteCancelBtn')?.addEventListener('click', () => show('voteConfirm', false));
  loadProposal();
});

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
