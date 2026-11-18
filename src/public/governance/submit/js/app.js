// WinLEW Governance v1.1 — proposal submission review queue (community-
// facing form). Every write goes through /api/governance/submissions*,
// which resolves identity server-side from the session — this file never
// sends a wallet address or claims eligibility itself. Submitting creates
// a reviewable draft only; nothing here can publish or activate a vote.
const { hubApiFetch, getAuth, walletLogin, setConnectedUi, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

const STATUS_LABELS = {
  submitted: 'Submitted — awaiting review',
  'under-review': 'Under review',
  'revision-requested': 'Revision requested',
  'approved-for-drafting': 'Approved for drafting',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  archived: 'Archived',
};

const FIELD_LIMITS = {
  title: 200, summary: 1000, problem: 3000, proposedOutcome: 3000,
  communityBenefit: 1500, affectedSystems: 1000, risks: 1500, alternatives: 1500, supportingEvidence: 2000,
};

const FIELD_ERROR_MESSAGES = {
  missing_required_field: 'Please fill in the required fields.',
  invalid_category: 'Choose a valid category.',
  invalid_governance_mode: 'Choose a valid governance mode.',
  field_too_long: 'One of your answers is too long — please shorten it.',
  raw_html_not_allowed: 'Raw HTML/tags aren’t allowed — please use plain text.',
  executable_link_not_allowed: 'That looks like an executable link, which isn’t allowed.',
  private_key_not_allowed: 'Never include a private key — remove it and resubmit.',
  seed_phrase_not_allowed: 'Never include a seed phrase — remove it and resubmit.',
  api_secret_not_allowed: 'Remove any API/secret key text and resubmit.',
  possible_private_key_bytes_not_allowed: 'That looks like raw key material — remove it and resubmit.',
  possible_private_key_blob_not_allowed: 'That looks like raw key material — remove it and resubmit.',
  treasury_instruction_not_allowed: 'This form can’t contain treasury-execution instructions.',
  automatic_burn_instruction_not_allowed: 'This form can’t contain burn-execution instructions.',
  duplicate_submission: 'You already submitted a proposal with this exact title recently.',
  too_many_open_submissions: 'You have too many open submissions already — wait for one to be reviewed first.',
  invalid_payload: 'Something went wrong with the form — please try again.',
};

function populateSelect(id, labels) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = Object.entries(labels).map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
}

function wireCharCounts() {
  Object.entries(FIELD_LIMITS).forEach(([field, limit]) => {
    const inputId = `f${field.charAt(0).toUpperCase()}${field.slice(1)}`;
    const input = document.getElementById(inputId);
    const counter = document.getElementById(`limit${field.charAt(0).toUpperCase()}${field.slice(1)}`);
    if (!input || !counter) return;
    const update = () => { counter.textContent = `${input.value.length}/${limit}`; };
    input.addEventListener('input', update);
    update();
  });
}

function statusPill(status) {
  return `<span class="statusPill ${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function renderDraft(sub) {
  const lastEntry = (sub.statusHistory || []).at(-1);
  const showReason = (sub.status === 'revision-requested' || sub.status === 'rejected') && lastEntry?.reason;
  return `
    <div class="draftRow">
      <div class="draftHead">
        <span class="draftTitle">${esc(sub.title)}</span>
        ${statusPill(sub.status)}
      </div>
      <div class="draftMeta">${esc(CATEGORY_LABELS[sub.category] || sub.category)} · Submitted ${esc(fmtDateTime(sub.submittedAtIso))}${sub.updatedAtIso && sub.updatedAtIso !== sub.submittedAtIso ? ` · Updated ${esc(fmtDateTime(sub.updatedAtIso))}` : ''}</div>
      ${showReason ? `<div class="draftReason"><strong>Maintainer note:</strong> ${esc(lastEntry.reason)}</div>` : ''}
      ${sub.status === 'submitted' || sub.status === 'revision-requested' ? `<p style="margin-top:8px;"><button type="button" class="btn" data-withdraw="${esc(sub.id)}" style="font-size:12px;padding:6px 10px;">Withdraw</button></p>` : ''}
    </div>
  `;
}

async function loadMyDrafts() {
  const auth = getAuth();
  const listEl = document.getElementById('draftList');
  if (!auth.session) {
    listEl.innerHTML = '<p class="muted">Sign in to see your submitted drafts.</p>';
    return;
  }
  try {
    const res = await hubApiFetch('/api/governance/submissions/mine');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'load_failed');
    if (!data.submissions.length) {
      listEl.innerHTML = '<p class="muted">You haven’t submitted any proposals yet.</p>';
      return;
    }
    listEl.innerHTML = data.submissions.map(renderDraft).join('');
    listEl.querySelectorAll('[data-withdraw]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Withdraw this submission?')) return;
        btn.disabled = true;
        try {
          const wres = await hubApiFetch(`/api/governance/submissions/${encodeURIComponent(btn.getAttribute('data-withdraw'))}/withdraw`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: auth.session }),
          });
          if (!wres.ok) throw new Error('withdraw_failed');
          await loadMyDrafts();
        } catch (e) {
          console.warn('[governance-submit] withdraw failed:', e);
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    console.warn('[governance-submit] load drafts failed:', e);
    listEl.innerHTML = '<p class="muted">Couldn’t load your submissions right now.</p>';
  }
}

function readFields() {
  return {
    title: document.getElementById('fTitle').value,
    category: document.getElementById('fCategory').value,
    requestedGovernanceMode: document.getElementById('fMode').value,
    summary: document.getElementById('fSummary').value,
    problem: document.getElementById('fProblem').value,
    proposedOutcome: document.getElementById('fProposedOutcome').value,
    communityBenefit: document.getElementById('fCommunityBenefit').value,
    affectedSystems: document.getElementById('fAffectedSystems').value,
    risks: document.getElementById('fRisks').value,
    alternatives: document.getElementById('fAlternatives').value,
    supportingEvidence: document.getElementById('fSupportingEvidence').value,
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  const auth = getAuth();
  const statusEl = document.getElementById('formStatus');
  const btn = document.getElementById('submitBtn');
  statusEl.textContent = '';
  statusEl.className = 'formStatus';
  btn.disabled = true;
  try {
    const res = await hubApiFetch('/api/governance/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: auth.session, fields: readFields() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      statusEl.textContent = FIELD_ERROR_MESSAGES[data.error] || 'Could not submit — please check the form and try again.';
      statusEl.className = 'formStatus error';
      return;
    }
    statusEl.textContent = `Submitted — receipt id ${data.submission.id}. A maintainer will review it; you'll see status updates below. This is a draft only, not a published proposal.`;
    statusEl.className = 'formStatus ok';
    document.getElementById('submitForm').reset();
    wireCharCounts();
    await loadMyDrafts();
  } catch (e) {
    console.warn('[governance-submit] submit failed:', e);
    statusEl.textContent = 'Network error — please try again.';
    statusEl.className = 'formStatus error';
  } finally {
    btn.disabled = false;
  }
}

async function checkVerifiedWallet(session) {
  try {
    const res = await hubApiFetch('/api/governance/eligibility/gov-launch-2026');
    const data = await res.json();
    // Only used here to learn whether a verified wallet exists at all —
    // never to gate on holding a balance. Any reason other than
    // "wallet_not_verified" (including "temporarily unavailable") means a
    // verified wallet IS on file, so the form should still be shown.
    return data.reason !== 'wallet_not_verified';
  } catch (e) {
    console.warn('[governance-submit] wallet check failed, defaulting to showing the form:', e);
    return true;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  populateSelect('fCategory', CATEGORY_LABELS);
  populateSelect('fMode', MODE_LABELS);
  wireCharCounts();
  document.getElementById('submitForm').addEventListener('submit', handleSubmit);

  const auth = getAuth();
  if (!auth.session) {
    document.getElementById('signedOutBlock').classList.remove('hidden');
    return;
  }

  const hasVerifiedWallet = await checkVerifiedWallet(auth.session);
  if (!hasVerifiedWallet) {
    document.getElementById('unverifiedBlock').classList.remove('hidden');
  } else {
    document.getElementById('formBlock').classList.remove('hidden');
  }
  await loadMyDrafts();
});

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
