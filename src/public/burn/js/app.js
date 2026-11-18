// WinLEW Burn Center — fetches /api/burn/status and renders exactly what the
// backend returns. If the live burn-wallet lookup failed, that specific
// figure shows "Temporarily unavailable" — it never falls back to 0. Verified
// burn events come from src/mole/burnEvents.js (see docs/burn-program.md);
// this file only renders them, it never computes or invents a burn total.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function fmtNumber(n, opts) {
  return Number(n || 0).toLocaleString('en-US', opts || { maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_LABELS = {
  'confirmed-burn': { text: 'Confirmed burn', cls: 'confirmed' },
  'transferred-to-burn-wallet': { text: 'Awaiting burn', cls: 'staged' },
  'queued': { text: 'Queued', cls: 'staged' },
  'pending-verification': { text: 'Pending verification', cls: 'other' },
  'disputed': { text: 'Disputed', cls: 'other' },
  'unknown': { text: 'Unknown', cls: 'other' },
};

// A staged transfer only means "awaiting burn" while those tokens are still
// sitting there. The ledger now records the full history back to 2025, and
// most of those staged entries were consumed long ago — destroyed by a later
// burn, or moved out when the wallet had to be emptied. Rendering them as
// "Awaiting burn" would claim tokens are waiting that no longer exist.
// burnEvents.js marks each consumed entry with supersededBy.
function statusPill(status, event) {
  if (status === 'transferred-to-burn-wallet' && event?.supersededBy) {
    return `<span class="statusPill other" title="${esc(event.supersededNote || '')}">Staged — since consumed</span>`;
  }
  const info = STATUS_LABELS[status] || { text: status || 'Unknown', cls: 'other' };
  return `<span class="statusPill ${info.cls}">${esc(info.text)}</span>`;
}

function wireCopyButtons(root) {
  root.querySelectorAll('button[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const original = btn.textContent;
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (e) {
        console.warn('[burn] copy failed:', e);
      }
    });
  });
}

function renderEventsTable(events) {
  const body = document.getElementById('burnEventsBody');
  if (!body) return;
  if (!events || !events.length) {
    body.innerHTML = '<tr><td colspan="6" class="muted">No verified burn events yet.</td></tr>';
    return;
  }
  body.innerHTML = events
    .slice()
    .sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso))
    .map((event) => `
      <tr>
        <td>${fmtDate(event.dateIso)}</td>
        <td>${fmtNumber(event.amountDisplay)} WinLEW</td>
        <td>${statusPill(event.status, event)}</td>
        <td>${esc(event.eventType || '—')}</td>
        <td>${event.explorerUrl ? `<a href="${esc(event.explorerUrl)}" target="_blank" rel="noreferrer">Solscan ↗</a>` : '<span class="muted">No signature located</span>'}</td>
        <td class="muted" style="white-space:normal;max-width:280px;">${esc(event.supersededNote ? `${event.supersededNote} ${event.notes || ''}` : (event.notes || ''))}</td>
      </tr>
    `)
    .join('');
}

function renderTimeline(events, benchmark) {
  const host = document.getElementById('burnTimeline');
  if (!host) return;
  const burns = events
    .filter((e) => e.status === 'confirmed-burn')
    .sort((a, b) => Date.parse(a.dateIso) - Date.parse(b.dateIso));

  // The 29 pump.fun BOOST burns all landed inside one ~5m15s window on
  // 2026-07-22 (see docs/burn-program.md §7). Listing them as 29 separate
  // timeline rows buries the three burns the project actually executed, so
  // they collapse into a single entry that still links every signature via
  // the events table below. Grouping is presentational only — each one is
  // still its own verified event in burnEvents.js and still counts
  // individually toward Verified Progress.
  const BOOST = 'pumpfun-boost-buyback-burn';
  const boostBurns = burns.filter((e) => e.eventType === BOOST);
  const ownBurns = burns.filter((e) => e.eventType !== BOOST);

  const boostTotal = boostBurns.reduce((sum, e) => sum + Number(String(e.amountDisplay).replace(/,/g, '')), 0);
  const boostItem = boostBurns.length
    ? [{
        sortAt: Date.parse(boostBurns[0].dateIso),
        html: `
      <div class="timelineItem">
        <div class="timelineDot completed"></div>
        <div>
          <div class="timelineLabel">Completed — ${fmtDate(boostBurns[0].dateIso)}</div>
          <div>Burned <strong>${fmtNumber(boostTotal.toFixed(6))} WinLEW</strong> across <strong>${boostBurns.length}</strong> pump.fun BOOST buyback-and-burn transactions, all within a ~5-minute window after graduation.</div>
          <div class="muted" style="font-size:13px;margin-top:4px;">Executed by the PumpSwap pool, not by the project — every signature is listed individually in the table below.</div>
        </div>
      </div>
    `,
      }]
    : [];

  const ownItems = ownBurns.map((e) => ({
    sortAt: Date.parse(e.dateIso),
    html: `
      <div class="timelineItem">
        <div class="timelineDot completed"></div>
        <div>
          <div class="timelineLabel">Completed — ${fmtDate(e.dateIso)}</div>
          <div>Burned <strong>${fmtNumber(e.amountDisplay)} WinLEW</strong> — <a href="${esc(e.explorerUrl)}" target="_blank" rel="noreferrer">view transaction ↗</a></div>
        </div>
      </div>
    `,
  }));

  const completedItems = [...ownItems, ...boostItem]
    .sort((a, b) => a.sortAt - b.sortAt)
    .map((x) => x.html);

  const benchmarkItem = `
    <div class="timelineItem">
      <div class="timelineDot benchmark"></div>
      <div>
        <div class="timelineLabel">Planned / Benchmark</div>
        <div><strong>${esc(benchmark?.label || 'Annual project benchmark')}</strong><br/><span class="muted">${esc(benchmark?.description || '')}</span></div>
      </div>
    </div>
  `;

  host.innerHTML = completedItems.join('') + benchmarkItem;
}

async function loadBurnStatus() {
  try {
    const res = await hubApiFetch('/api/burn/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'burn_status_failed');

    document.getElementById('burnStatusLoading')?.classList.add('hidden');
    document.getElementById('burnStatusData')?.classList.remove('hidden');

    // "Awaiting burn (in wallet, not yet destroyed)" means exactly that —
    // WinLEW currently sitting in the burn wallet. That's the wallet's live
    // balance, not data.summary.stagedDisplay (a sum over burn EVENTS
    // explicitly marked "transferred-to-burn-wallet"/"queued" — a separate,
    // currently-empty concept, since every seeded event here is already a
    // confirmed burn). Using the event-derived figure here always showed a
    // false 0 regardless of what the wallet actually holds.
    const walletOk = data.wallet && data.wallet.ok !== false;
    const awaitingBurnText = walletOk ? `${fmtNumber(data.wallet.winlewBalance)} WinLEW` : 'Temporarily unavailable';

    document.getElementById('statConfirmedBurned').textContent = `${fmtNumber(data.summary.confirmedBurnedDisplay)} WinLEW`;
    document.getElementById('statStaged').textContent = awaitingBurnText;
    document.getElementById('statTarget').textContent = `${fmtNumber(data.progress.targetDisplay)} WinLEW`;

    // Hero strip mirrors the same fetched summary — no second data source.
    const heroBurned = document.getElementById('heroBurnConfirmed');
    if (heroBurned) heroBurned.textContent = fmtNumber(data.summary.confirmedBurnedDisplay);
    const heroPctVal = Number(data.progress.percentOfTarget || 0);
    const heroPct = document.getElementById('heroBurnPct');
    if (heroPct) heroPct.textContent = `${heroPctVal}%`;
    const heroStaged = document.getElementById('heroBurnStaged');
    if (heroStaged) heroStaged.textContent = walletOk ? fmtNumber(data.wallet.winlewBalance) : '—';
    const heroTarget = document.getElementById('heroBurnTarget');
    if (heroTarget) heroTarget.textContent = fmtNumber(data.progress.targetDisplay);
    const heroFill = document.getElementById('heroBurnProgressFill');
    if (heroFill) heroFill.style.width = `${Math.max(0, Math.min(100, heroPctVal))}%`;
    const heroProgressLabel = document.getElementById('heroBurnProgressLabel');
    if (heroProgressLabel) heroProgressLabel.textContent = `${fmtNumber(data.summary.confirmedBurnedDisplay)} / ${fmtNumber(data.progress.targetDisplay)} WinLEW verified burned`;

    document.getElementById('burnLastVerified').textContent =
      `Live data last generated: ${new Date(data.generatedAt).toLocaleString()}. Burn events verified independently on-chain, most recently 2026-08-01 — when the burn wallet's full history back to 2025-02-16 was reconstructed and reconciled against its live balance (see docs/burn-program.md §7b).`;

    // Progress bar + accessible text equivalent — never relies on the bar alone.
    const pct = Number(data.progress.percentOfTarget || 0);
    const fill = document.getElementById('progressFill');
    const bar = document.getElementById('progressBar');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
    const progressText = document.getElementById('progressText');
    if (progressText) {
      progressText.textContent =
        `Verified progress: ${fmtNumber(data.summary.confirmedBurnedDisplay)} / ${fmtNumber(data.progress.targetDisplay)} WinLEW (${pct}%) — ${fmtNumber(data.progress.remainingDisplay)} WinLEW remaining to the long-term target.`;
    }

    renderTimeline(data.events || [], data.benchmark);
    renderEventsTable(data.events || []);

    const notice = document.getElementById('burnHistoryNotice');
    if (notice) notice.textContent = data.historyNotice || '';

    wireCopyButtons(document);
  } catch (e) {
    console.warn('[burn] status load failed:', e);
    document.getElementById('burnStatusLoading')?.classList.add('hidden');
    const err = document.getElementById('burnStatusError');
    if (err) {
      err.textContent = "⚠️ Couldn't reach live burn data right now. Try refreshing in a moment.";
      err.classList.remove('hidden');
    }
    const progressText = document.getElementById('progressText');
    if (progressText) progressText.textContent = 'Verified progress temporarily unavailable.';
    const heroProgressLabel = document.getElementById('heroBurnProgressLabel');
    if (heroProgressLabel) heroProgressLabel.textContent = 'Verified progress temporarily unavailable.';
    const timeline = document.getElementById('burnTimeline');
    if (timeline) timeline.innerHTML = '<div class="compError">⚠️ Timeline temporarily unavailable.</div>';
    const body = document.getElementById('burnEventsBody');
    if (body) body.innerHTML = '<tr><td colspan="6" class="compError">⚠️ Could not load burn events right now.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', loadBurnStatus);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
