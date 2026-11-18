// WinLEW Sponsors & Partners — fetches /api/partners/status and renders
// exactly what the backend returns. Status labels are never upgraded on the
// frontend (e.g. never shown as "Active" unless the record itself says so)
// — this file only displays what src/mole/partnersData.js records.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

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

const STATUS_LABELS = {
  active: { text: 'Active', cls: 'active' },
  historical: { text: 'Historical', cls: 'historical' },
  completed: { text: 'Completed', cls: 'completed' },
  inactive: { text: 'Inactive', cls: 'historical' },
  'status-unconfirmed': { text: 'Status Unconfirmed', cls: 'unconfirmed' },
};

function statusPill(status, statusLabel) {
  const info = STATUS_LABELS[status] || { text: status || 'Unknown', cls: 'unconfirmed' };
  return `<span class="statusPill ${info.cls}">${esc(statusLabel || info.text)}</span>`;
}

function renderPartnerCard(partner) {
  const el = document.createElement('div');
  el.className = 'partnerCard';
  el.id = `partner-${partner.id}`;

  const dateRange = [fmtDate(partner.dateAnnouncedIso), fmtDate(partner.endDateIso)].filter(Boolean).join(' → ');
  const evidenceLinks = (partner.publicEvidence || [])
    .map((e) => `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.label)} ↗</a>`)
    .join('');
  const officialLinks = (partner.officialLinks || [])
    .map((e) => `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.label)} ↗</a>`)
    .join('');

  const monogram = esc(String(partner.name || '?').trim().charAt(0).toUpperCase() || '?');
  const monogramTitle = partner.easterEggTooltip ? ` title="${esc(partner.easterEggTooltip)}"` : '';

  el.innerHTML = `
    <div class="partnerHead">
      <div class="partnerTitle">
        <div class="partnerMonogram" aria-hidden="true"${monogramTitle}>${monogram}</div>
        <h3>${esc(partner.name)}</h3>
      </div>
      ${statusPill(partner.status, partner.statusLabel)}
    </div>
    <div class="partnerMeta">${esc(partner.type || '')}${dateRange ? ` · ${esc(dateRange)}` : ''}</div>
    <p class="partnerSummary">${esc(partner.summary)}</p>
    ${partner.announcementQuote ? `<p class="muted" style="font-style:italic;border-left:2px solid #4e3624;padding-left:10px;">"${esc(partner.announcementQuote)}"</p>` : ''}
    ${partner.whatItInvolved ? `<p class="muted"><strong>What this involved:</strong> ${esc(partner.whatItInvolved)}</p>` : ''}
    ${partner.whatIsNotClaimed ? `<p class="muted"><strong>Not claimed:</strong> ${esc(partner.whatIsNotClaimed)}</p>` : ''}
    <div class="partnerLinks">${evidenceLinks}${officialLinks}</div>
    ${(partner.relatedEvents || []).length ? `<p class="muted" style="margin-top:10px;">Related events: ${partner.relatedEvents.map((e) => `<a href="/events/#event-${esc(e.id)}">${esc(e.title)}</a>`).join(', ')}</p>` : ''}
    ${partner.lastVerifiedIso ? `<p class="muted" style="font-size:12px;margin-top:10px;">Last verified: ${esc(fmtDate(partner.lastVerifiedIso) || partner.lastVerifiedIso)}</p>` : ''}
  `;
  return el;
}

function renderEcosystemRow(entry) {
  const evidence = (entry.evidence || [])
    .map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.label)} ↗</a>`)
    .join('<br/>') || '<span class="muted">—</span>';
  return `
    <tr>
      <td><strong>${esc(entry.label)}</strong>${entry.notes ? `<div class="muted" style="font-size:12px;margin-top:4px;max-width:260px;white-space:normal;">${esc(entry.notes)}</div>` : ''}</td>
      <td>${esc(entry.category || '—')}</td>
      <td style="white-space:normal;max-width:260px;">${esc(entry.summary || '')}</td>
      <td>${esc(entry.verification || 'unverified')}</td>
      <td>${evidence}</td>
    </tr>
  `;
}

async function loadPartnersStatus() {
  try {
    const res = await hubApiFetch('/api/partners/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'partners_status_failed');

    const grid = document.getElementById('partnerGrid');
    if (grid) {
      grid.innerHTML = '';
      if (!data.partners || !data.partners.length) {
        grid.innerHTML = '<div class="muted">No partner records yet.</div>';
      } else {
        data.partners.forEach((partner) => grid.appendChild(renderPartnerCard(partner)));
      }
    }
    const heroCount = document.getElementById('heroPartnerCount');
    if (heroCount) heroCount.textContent = (data.partners || []).length || '—';
    const heroActive = document.getElementById('heroActivePartnerCount');
    if (heroActive) heroActive.textContent = (data.partners || []).filter((p) => p.status === 'active').length;
    const heroHistorical = document.getElementById('heroHistoricalPartnerCount');
    if (heroHistorical) heroHistorical.textContent = (data.partners || []).filter((p) => p.status === 'historical').length;
    const heroEcosystem = document.getElementById('heroEcosystemSupportCount');
    if (heroEcosystem) heroEcosystem.textContent = (data.ecosystemSupport || []).length || '—';

    const body = document.getElementById('ecosystemBody');
    if (body) {
      body.innerHTML = (data.ecosystemSupport || []).map(renderEcosystemRow).join('') || '<tr><td colspan="5" class="muted">No records yet.</td></tr>';
    }

    const notice = document.getElementById('ecosystemNotice');
    if (notice) {
      notice.textContent = 'Some historical dates and service details are incomplete or conflict between owner-supplied statements. Where that happens, the conflict is documented rather than a single date being silently chosen — see the notes column above.';
    }
  } catch (e) {
    console.warn('[partners] status load failed:', e);
    const grid = document.getElementById('partnerGrid');
    if (grid) grid.innerHTML = '<p class="muted">⚠️ Could not load partner records right now. Try refreshing.</p>';
    const body = document.getElementById('ecosystemBody');
    if (body) body.innerHTML = '<tr><td colspan="5" class="muted">⚠️ Could not load right now.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', loadPartnersStatus);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
