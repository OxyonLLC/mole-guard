// WinLEW Bug Bounties — fetches /api/bounties/status and renders exactly
// what the backend returns. Bounty data comes from src/mole/bounties.js
// (a hand-maintained static ledger, not chain state) — this file only ever
// renders it, it never invents a total or marks anything paid on its own.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function fmtNumber(n, opts) {
  return Number(n || 0).toLocaleString('en-US', opts || { maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function short(addr) {
  const s = String(addr || '');
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusPill(status) {
  if (status === 'paid') return '<span class="statusPill paid">✅ Paid</span>';
  return '<span class="statusPill pending">⏳ Pending</span>';
}

function renderBountyRow(bounty) {
  const scheduledOrPaid = bounty.status === 'paid'
    ? fmtDate(bounty.paidAtIso)
    : `${fmtDate(bounty.scheduledPayoutDateIso)}${bounty.scheduledPayoutNote ? ` — ${esc(bounty.scheduledPayoutNote)}` : ''}`;
  const proof = bounty.status === 'paid' && bounty.payoutSignature
    ? `<a href="https://solscan.io/tx/${esc(bounty.payoutSignature)}" target="_blank" rel="noreferrer noopener">Solscan ↗</a>`
    : '<span class="muted">—</span>';

  return `
    <tr>
      <td>${esc(bounty.recipientHandle)}<br/><code title="${esc(bounty.recipientWallet)}" style="font-size:11px;">${short(bounty.recipientWallet)}</code></td>
      <td>${esc(bounty.title)}<br/><span class="muted" style="font-size:12px;">${esc(bounty.description || '')}</span></td>
      <td>${fmtNumber(bounty.amountDisplay)} WinLEW</td>
      <td>${statusPill(bounty.status)}</td>
      <td style="white-space:normal;max-width:260px;">${scheduledOrPaid}</td>
      <td>${proof}</td>
    </tr>`;
}

function renderBounties(bounties) {
  const body = document.getElementById('bountiesBody');
  if (!body) return;
  if (!bounties || !bounties.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No bounties on record yet.</td></tr>';
    return;
  }
  body.innerHTML = bounties
    .slice()
    .sort((a, b) => Date.parse(b.announcedAtIso) - Date.parse(a.announcedAtIso))
    .map(renderBountyRow)
    .join('');
}

async function loadBountyStatus() {
  try {
    const res = await hubApiFetch('/api/bounties/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'bounties_status_failed');

    document.getElementById('bountyStatusLoading')?.classList.add('hidden');
    document.getElementById('bountyStatusData')?.classList.remove('hidden');

    document.getElementById('statPendingTotal').textContent = `${fmtNumber(data.summary.pendingDisplay)} WinLEW`;
    document.getElementById('statPaidTotal').textContent = `${fmtNumber(data.summary.paidDisplay)} WinLEW`;
    document.getElementById('statSourceWallet').textContent = 'Developer Reserve';
    document.getElementById('bountyLastGenerated').textContent = `Ledger last generated: ${new Date(data.generatedAt).toLocaleString()}.`;

    const heroCount = document.getElementById('heroBountyCount');
    if (heroCount) heroCount.textContent = data.summary.bountyCount ?? '—';
    const heroPending = document.getElementById('heroPendingCount');
    if (heroPending) heroPending.textContent = data.summary.pendingCount ?? '—';
    const heroPaidTotal = document.getElementById('heroPaidTotal');
    if (heroPaidTotal) heroPaidTotal.textContent = `${fmtNumber(data.summary.paidDisplay)} WinLEW`;
    const heroPendingTotal = document.getElementById('heroPendingTotal');
    if (heroPendingTotal) heroPendingTotal.textContent = `${fmtNumber(data.summary.pendingDisplay)} WinLEW`;

    renderBounties(data.bounties || []);
  } catch (e) {
    console.warn('[bounties] status load failed:', e);
    document.getElementById('bountyStatusLoading')?.classList.add('hidden');
    const err = document.getElementById('bountyStatusError');
    if (err) {
      err.textContent = "⚠️ Couldn't reach bounty data right now. Try refreshing in a moment.";
      err.classList.remove('hidden');
    }
    const body = document.getElementById('bountiesBody');
    if (body) body.innerHTML = '<tr><td colspan="6" class="compError">⚠️ Could not load bounties right now.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', loadBountyStatus);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
