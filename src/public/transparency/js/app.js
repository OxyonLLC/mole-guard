
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

// WinLEW Transparency Center — fetches /api/transparency/status and renders
// exactly what the backend returns, per-component. If one component's RPC
// lookup failed, that one card shows "temporarily unavailable" — it never
// falls back to a hardcoded or zeroed number. See src/mole/solana.js and
// the /api/transparency/status route in src/mole/web.js for where every
// figure actually comes from.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function fmtNumber(n, opts) {
  return Number(n || 0).toLocaleString('en-US', opts || { maximumFractionDigits: 2 });
}

function short(addr) {
  const s = String(addr || '');
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

// Everything this page renders comes from our own API, so this is not guarding
// against a hostile string today. It exists because the supply section builds
// table rows from server-supplied text — lock names, schedules, reasons — and a
// future field that quotes an address or a "<" would otherwise break the markup
// silently on the one page whose whole job is being checkable.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Thousands separators without touching the decimals. The summary tiles round
// to 2dp for readability; the formula block must show every one of the 6
// decimals, because a listing reviewer reproducing the arithmetic needs the
// exact base-unit value — but 950000000 is hard to read and easy to misread by
// an order of magnitude. toLocaleString cannot be used here: it would round the
// fraction away, which is the one thing this must not do.
function fmtExact(decimalString) {
  const [whole, fraction] = String(decimalString ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function renderComponent(component) {
  const el = document.createElement('div');
  el.className = 'component';
  el.id = `component-${component.id}`;

  const explorerLinks = [`<a class="btn" href="https://solscan.io/account/${encodeURIComponent(component.address)}" target="_blank" rel="noreferrer noopener">Solscan ↗</a>`];
  if (component.links) {
    if (component.links.raydium) explorerLinks.push(`<a class="btn" href="${component.links.raydium}" target="_blank" rel="noreferrer noopener">Raydium ↗</a>`);
    if (component.links.dexscreener) explorerLinks.push(`<a class="btn" href="${component.links.dexscreener}" target="_blank" rel="noreferrer noopener">DexScreener ↗</a>`);
    if (component.links.burnCenter) explorerLinks.push(`<a class="btn" href="${component.links.burnCenter}">🔥 Burn Center →</a>`);
    if (component.links.contribute) explorerLinks.push(`<a class="btn" href="${component.links.contribute}">🤝 Contribute →</a>`);
  }

  // .sol name chips + "Held by" identity row — server-supplied (see
  // TRANSPARENCY_COMPONENTS in src/mole/web.js), same disclosure pattern as
  // /contribute/'s cause cards. Internal links stay same-tab; external open new.
  const solChips = (component.sol || [])
    .map((name) => `<code class="solChip" title="Resolves on-chain to this component's address">${name}</code>`)
    .join('');
  const heldByLinks = (component.heldBy || [])
    .map((who) => who.url.startsWith('http')
      ? `<a href="${who.url}" target="_blank" rel="noreferrer noopener">${who.label}</a>`
      : `<a href="${who.url}">${who.label}</a>`)
    .join(' · ');
  const whoHtml = heldByLinks ? `<div class="compWho">Held by ${heldByLinks}</div>` : '';

  let statsHtml = '';
  if (component.ok === false) {
    statsHtml = `<p class="compError">⚠️ Couldn't load live data for this component right now (a Solana RPC call didn't respond in time). This is a transient lookup issue, not a claim the component doesn't exist — try refreshing.</p>`;
  } else if (component.kind === 'program') {
    statsHtml = `
      <div class="compStats">
        <div class="statBox"><div class="statVal">${component.exists ? '✅ Confirmed' : '❌ Not found'}</div><div class="statLbl">On-chain account</div></div>
        <div class="statBox"><div class="statVal">${fmtNumber(component.solBalance, { maximumFractionDigits: 4 })}</div><div class="statLbl">SOL balance</div></div>
      </div>
      <p class="muted" style="margin-top:10px;font-size:13px;">Full liquidity composition (WinLEW + SOL reserves) is parsed correctly by DexScreener already — linked below — rather than re-implemented here.</p>`;
  } else {
    statsHtml = `
      <div class="compStats">
        <div class="statBox"><div class="statVal">${fmtNumber(component.winlewBalance)}</div><div class="statLbl">$WinLEW</div></div>
        <div class="statBox"><div class="statVal">${fmtNumber(component.solBalance, { maximumFractionDigits: 4 })}</div><div class="statLbl">SOL</div></div>
      </div>`;
  }

  const trustBadge = component.ok === false
    ? '<span class="trustBadge warn">⚠️ Unavailable</span>'
    : '<span class="trustBadge">✅ Verified</span>';

  el.innerHTML = `
    <div class="compHead">
      <h3><span class="compIcon">${component.icon || ''}</span> ${component.label}</h3>
      ${trustBadge}
    </div>
    <p class="compPurpose muted">${component.purpose}</p>
    ${whoHtml}
    ${statsHtml}
    <div class="addrRow">
      ${solChips}
      <code title="${component.address}">${short(component.address)}</code>
      <button class="btn" type="button" data-copy="${component.address}">📋 Copy</button>
    </div>
    <div class="compLinks">${explorerLinks.join('')}</div>
  `;
  return el;
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
        console.warn('[transparency] copy failed:', e);
      }
    });
  });
}

function renderCommunityLiquidityRow(event) {
  const date = event.dateIso ? new Date(event.dateIso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const isWithdraw = event.type === 'withdraw';
  const name = event.role === 'founder' ? 'Founder/dev wallet' : (event.discordHandle || '—');
  return `
    <tr>
      <td>${date}</td>
      <td>${name}</td>
      <td><code title="${event.wallet}">${short(event.wallet)}</code></td>
      <td><span class="statusPill ${isWithdraw ? 'withdrawn' : 'active'}">${isWithdraw ? '↙ Withdraw' : '↗ Deposit'}</span></td>
      <td>${fmtNumber(event.winlewAmountDisplay)}</td>
      <td><a href="${event.explorerUrl}" target="_blank" rel="noreferrer noopener">Solscan ↗</a></td>
    </tr>`;
}

const FARM_ROUND_LABELS = { farm1: 'Round 1', farm2: 'Round 2' };

function renderProviderCard(row) {
  const name = row.role === 'founder' ? 'Founder/dev wallet' : (row.discordHandle || short(row.wallet));
  // Gross lifetime deposited, not a live net balance: an AMM LP position
  // earns a share of trading fees while it's in the pool, so a fully
  // withdrawn wallet's total-withdrawn can slightly EXCEED total-deposited
  // (that's a real, correct fee credit, not a bug) — netting the two would
  // print a confusing negative number for exactly the providers who earned
  // the most in fees. The status pill already conveys active vs withdrawn.
  const grossWinlew = fmtNumber(Number(row.totalWinlewDepositedDisplay || 0));
  const statusHtml = row.role === 'founder'
    ? `<span class="statusPill founder">🛠️ Founder</span>`
    : `<span class="statusPill ${row.status === 'active' ? 'active' : 'withdrawn'}">${row.status === 'active' ? '● Active' : '○ Withdrawn'}</span>`;
  const roundChips = (row.farmPrograms || [])
    .map((key) => `<span class="roundChip">${FARM_ROUND_LABELS[key] || key}</span>`)
    .join('');
  return `
    <div class="providerCard">
      <div class="pName">${name}</div>
      <div class="pWallet"><code title="${row.wallet}">${short(row.wallet)}</code></div>
      <div class="pAmt">${grossWinlew} WinLEW contributed</div>
      <div class="pBadges">${statusHtml}${roundChips}</div>
    </div>`;
}

function renderFarmCard(farm) {
  const statusBadge = {
    closed: '<span class="trustBadge warn">Closed / drained</span>',
    dormant: '<span class="trustBadge warn">Dormant</span>',
    reopening: '<span class="trustBadge">Reopening soon</span>',
  }[farm.status] || '';
  const reopenNote = farm.plannedReopenWindowLabel
    ? `<div class="compWho">Planned reopen: <strong>${farm.plannedReopenWindowLabel}</strong></div>`
    : '';
  const depositBtn = farm.depositUrl
    ? `<a class="btn primary" href="${farm.depositUrl}" target="_blank" rel="noreferrer noopener">💧 Add Liquidity to Pool ↗</a>`
    : '';
  const stakeBtn = farm.stakeUrl
    ? `<a class="btn" href="${farm.stakeUrl}" target="_blank" rel="noreferrer noopener">🌾 Stake in this Farm ↗</a>`
    : `<span class="muted" style="font-size:12px;">No live Raydium staking link found for this farm yet — check Discord for the current process.</span>`;
  return `
    <div class="component">
      <div class="compHead">
        <h3><span class="compIcon">🌾</span> ${farm.label}</h3>
        ${statusBadge}
      </div>
      <p class="compPurpose">${farm.description}</p>
      <div class="compWho">Window: ${farm.windowLabel}</div>
      ${reopenNote}
      <div class="addrRow"><code title="${farm.address}">${short(farm.address)}</code>
        <a class="btn" href="https://solscan.io/account/${encodeURIComponent(farm.address)}" target="_blank" rel="noreferrer noopener">Solscan ↗</a>
      </div>
      <div class="compLinks">${depositBtn}${stakeBtn}</div>
    </div>`;
}

function renderFarmPrograms(farmPrograms) {
  const grid = document.getElementById('farmProgramsGrid');
  if (!grid) return;
  const farms = Object.values(farmPrograms || {});
  grid.innerHTML = farms.length ? farms.map(renderFarmCard).join('') : '<p class="muted">No farm data available.</p>';
}

// Lifetime faucet payout total, from the faucet:scan checkpoint. The whole
// section stays hidden when no scan has run on this machine — better absent
// than showing em-dashes that read like a broken feed.
function renderFaucetDistribution(fd) {
  const head = document.getElementById('faucetDistribution');
  const box = document.getElementById('faucetDistributionBox');
  if (!head || !box || !fd) return;

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const num = (v) => Number(String(v).replace(/,/g, ''));
  const asDate = (iso) => {
    const ms = Date.parse(iso || '');
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  };

  setTxt('fdTotal', num(fd.totalDistributedDisplay).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  setTxt('fdCount', Number(fd.payoutCount).toLocaleString());
  setTxt('fdRecipients', Number(fd.distinctRecipients).toLocaleString());
  setTxt('fdSince', asDate(fd.firstPayoutAtIso));

  const note = document.getElementById('fdNote');
  if (note) {
      const ageH = scanAgeHours(fd.lastScanAtIso);
      // An unparseable/absent date must not render "as of 1970-01-01 — about
      // Infinity day(s) ago", which is what the first version of this did.
      const knownScan = Number.isFinite(Date.parse(fd.lastScanAtIso || ''));
      const asOf = knownScan ? `Snapshot as of ${asDate(fd.lastScanAtIso)}` : 'Snapshot of unknown age';
      note.textContent = ageH > SCAN_STALE_AFTER_HOURS
        ? `${asOf}${knownScan ? ` — about ${Math.round(ageH / 24)} day(s) ago` : ''}. Claims made since then are NOT included; these figures move only when the next on-chain scan runs. Wallet ${fd.wallet}.`
        : fd.reconciled
          ? `${asOf}. Verified complete at that moment: every transaction this wallet has ever had was read and decoded, and total received minus total sent equalled its on-chain balance exactly. Wallet ${fd.wallet}.`
          : `${asOf}. Wallet ${fd.wallet}.`;
  }
  head.style.display = '';
  box.style.display = '';
}

function renderCommunityLiquidity(communityLiquidity) {
  const body = document.getElementById('communityLiquidityBody');
  const events = communityLiquidity?.events || [];
  if (body) {
    body.innerHTML = events.length
      ? events.map(renderCommunityLiquidityRow).join('')
      : '<tr><td colspan="6" class="muted">No community liquidity contributions on record yet.</td></tr>';
  }

  const summary = communityLiquidity?.summary || [];
  const providerGrid = document.getElementById('communityLiquidityProviders');
  if (providerGrid) {
    providerGrid.innerHTML = summary.length
      ? summary.map(renderProviderCard).join('')
      : '<p class="muted">No providers tracked yet.</p>';
  }

  const totalWinlew = summary.reduce((sum, row) => sum + Number(row.totalWinlewDepositedDisplay || 0), 0);
  const totalSolLamports = summary.reduce((sum, row) => sum + Number(row.totalSolDepositedLamports || 0), 0);

  // Shown on the collapsed summary so the size of what is hidden is visible
  // without opening it — a <details> that gives no hint of its contents invites
  // the assumption that nothing is in there.
  const recordCount = document.getElementById('lpRecordCount');
  if (recordCount) {
    const n = events.length;
    recordCount.textContent = n ? `${n} transaction${n === 1 ? '' : 's'} on record` : '';
  }
  const statProviders = document.getElementById('lpStatProviders');
  if (statProviders) statProviders.textContent = summary.length || '—';
  const statWinlew = document.getElementById('lpStatWinlew');
  if (statWinlew) statWinlew.textContent = fmtNumber(totalWinlew);
  const statSol = document.getElementById('lpStatSol');
  if (statSol) statSol.textContent = fmtNumber(totalSolLamports / 1e9, { maximumFractionDigits: 4 });

  renderFarmPrograms(communityLiquidity?.farmPrograms);
}

// The four numbers at the top of the page. Same source as the evidence section
// below — this is a second VIEW of one calculation, never a second calculation.
// If the figure could not be computed these say so rather than falling back to
// total supply, which would read as circulating and be wrong by 138M.
function renderOverview(cs, burn) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const notes = [];

  if (cs && cs.ok === true) {
    // Whole tokens in the tiles. "811,724,836.43" wrapped to "811,724,836." /
    // "43" at tile width, which on this page reads as a different number. The
    // exact six-decimal figures are in the evidence section, which is where
    // anyone reproducing the arithmetic will be.
    const whole = { maximumFractionDigits: 0 };
    set('ovTotal', fmtNumber(Number(cs.totalSupplyDisplay), whole));
    set('ovCirculating', fmtNumber(Number(cs.circulatingDisplay), whole));
    set('ovLocked', fmtNumber(Number(cs.nonCirculatingDisplay), whole));
    notes.push(`${cs.circulatingPct}% circulating · ${cs.nonCirculatingPct}% locked or vested.`);
  } else {
    // Total supply is still readable on its own and is not the disputed number,
    // so it is shown; the derived ones are not guessed at.
    set('ovTotal', cs && cs.problems ? '—' : '—');
    set('ovCirculating', 'unavailable');
    set('ovLocked', 'unavailable');
    notes.push('The circulating-supply calculation could not be completed — see the evidence section below for which source failed.');
  }

  if (burn && burn.ok !== false && burn.summary && burn.summary.confirmedBurnedDisplay) {
    set('ovBurned', fmtNumber(Number(burn.summary.confirmedBurnedDisplay), { maximumFractionDigits: 0 }));
    notes.push('Burned counts only burns confirmed by a Solana burn instruction — tokens staged in the burn wallet are still supply, and are still counted as circulating.');
  } else {
    set('ovBurned', 'unavailable');
  }

  set('ovNote', notes.join(' '));
}

// ── Circulating supply ──────────────────────────────────────────────────────
// Renders the server's circulatingSupply block. Deliberately dumb: it does no
// arithmetic of its own, so the browser cannot arrive at a different answer
// than the API. If the server says it could not compute the figure, this shows
// the failure instead of a number — see the note in the markup for why an
// incomplete calculation is worse than no calculation.
function renderCirculatingSupply(cs) {
  const loading = document.getElementById('csLoading');
  const data = document.getElementById('csData');
  const unavailable = document.getElementById('csUnavailable');
  if (!loading || !data || !unavailable) return;

  loading.classList.add('hidden');

  if (!cs || cs.ok !== true) {
    unavailable.classList.remove('hidden');
    const list = document.getElementById('csProblems');
    if (list) {
      const problems = (cs && cs.problems) || ['The supply calculation was not returned by the API.'];
      list.innerHTML = problems.map((p) => `<li>${esc(p)}</li>`).join('');
    }
    return;
  }

  data.classList.remove('hidden');
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  // Full precision in the formula block — the summary tiles round for
  // readability, but a listing reviewer reproducing the arithmetic needs every
  // decimal, and the two must not disagree.
  set('csFormulaTotal', `${fmtExact(cs.totalSupplyDisplay)} $WinLEW`);
  set('csFormulaLocked', `− ${fmtExact(cs.nonCirculatingDisplay)} $WinLEW`);
  set('csFormulaCirc', `= ${fmtExact(cs.circulatingDisplay)} $WinLEW`);
  set('csFormulaPct', `${cs.circulatingPct}% circulating · ${cs.nonCirculatingPct}% non-circulating`);

  const excluded = document.getElementById('csExcludedBody');
  if (excluded) {
    excluded.innerHTML = (cs.excluded || []).map((row) => {
      const schedule = [row.lockType, row.cliffIso ? `cliff ${row.cliffIso}` : null,
        row.fullyUnlockedIso ? `fully unlocked ${row.fullyUnlockedIso}` : null]
        .filter(Boolean).map(esc).join('<br>');
      // Says out loud where the timetable came from. The balance is always
      // on-chain; the schedule is only on-chain for the one lock whose escrow
      // bytes were decoded and reconstructed.
      const source = row.scheduleSource === 'on-chain-decoded'
        ? '<span class="statusPill">on-chain decoded</span>'
        : '<span class="statusPill">project-reported schedule</span>';
      const tx = row.evidenceTx
        ? ` · <a href="https://solscan.io/tx/${esc(row.evidenceTx)}" target="_blank" rel="noreferrer noopener">lock tx ↗</a>`
        : '';
      return `<tr>
        <td><strong>${esc(row.label)}</strong><br><code>${esc(short(row.address))}</code><br><span class="muted">${esc(row.reason)}</span></td>
        <td style="text-align:right;"><code>${esc(fmtExact(row.amountDisplay))}</code></td>
        <td>${esc(row.provider)}<br>${source}</td>
        <td>${schedule}</td>
        <td>${esc(row.vestedNote || 'Unknown')}<br><span class="muted">Early withdrawal: ${esc(row.earlyWithdrawal || 'Unknown')}</span></td>
        <td><a href="${esc(row.solscanUrl)}" target="_blank" rel="noreferrer noopener">Solscan ↗</a>${tx}</td>
      </tr>`;
    }).join('');
  }

  const kept = document.getElementById('csNotExcludedBody');
  if (kept) {
    kept.innerHTML = (cs.notExcluded || []).map((row) => `<tr>
      <td><strong>${esc(row.label)}</strong>${row.address ? `<br><code>${esc(short(row.address))}</code>` : ''}</td>
      <td style="text-align:right;"><code>${row.amountDisplay == null ? 'unavailable' : esc(fmtExact(row.amountDisplay))}</code></td>
      <td>${esc(row.reason)}</td>
      <td>${row.solscanUrl ? `<a href="${esc(row.solscanUrl)}" target="_blank" rel="noreferrer noopener">Solscan ↗</a>` : '—'}</td>
    </tr>`).join('');
  }

  set('csComputedAt', `Calculated ${new Date(cs.computedAtIso).toLocaleString()} from live Solana reads · mint ${cs.mint} · ${cs.decimals} decimals. Figures move as balances move; refresh for the current state.`);
}

async function loadTransparencyStatus() {
  try {
    const res = await hubApiFetch('/api/transparency/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'transparency_status_failed');

    // Token / mint card
    document.getElementById('mintLoading')?.classList.add('hidden');
    if (data.mint && !data.mint.error) {
      document.getElementById('mintData')?.classList.remove('hidden');
      document.getElementById('mintSupply').textContent = fmtNumber(data.mint.supply);
      document.getElementById('mintDecimalsStat').textContent = data.mint.decimals ?? '—';
      document.getElementById('mintAuthorityStat').textContent = data.mint.mintAuthority ? short(data.mint.mintAuthority) : 'Renounced';
      document.getElementById('freezeAuthorityStat').textContent = data.mint.freezeAuthority ? short(data.mint.freezeAuthority) : 'None';
      const heroAuthority = document.getElementById('heroMintAuthority');
      if (heroAuthority) heroAuthority.textContent = data.mint.mintAuthority ? 'Active' : 'Renounced';
      const heroSupply = document.getElementById('heroTotalSupply');
      if (heroSupply) heroSupply.textContent = fmtNumber(data.mint.supply);
    } else {
      const loading = document.getElementById('mintLoading');
      if (loading) { loading.textContent = "⚠️ Couldn't load live supply data right now — try refreshing."; loading.classList.remove('hidden'); }
    }

    // One card per ecosystem component
    const grid = document.getElementById('componentGrid');
    if (grid) {
      grid.innerHTML = '';
      (data.components || []).forEach((component) => grid.appendChild(renderComponent(component)));
      if (!(data.components || []).length) grid.innerHTML = '<p class="muted">No component evidence returned by this source.</p>';
      wireCopyButtons(grid);
    }
    const heroCount = document.getElementById('heroComponentCount');
    if (heroCount) heroCount.textContent = (data.components || []).length || '—';
    const heroVerified = document.getElementById('heroVerifiedNow');
    if (heroVerified) heroVerified.textContent = (data.components || []).filter((c) => c.ok !== false).length;

    renderCirculatingSupply(data.circulatingSupply);
    // Burn total for the fourth overview tile. Separate endpoint, so a burn-API
    // failure must not take the supply tiles down with it.
    let burn = null;
    try {
      const burnRes = await hubApiFetch('/api/burn/status');
      burn = await burnRes.json();
    } catch (e) { console.warn('[transparency] burn status failed:', e); }
    renderOverview(data.circulatingSupply, burn);
    renderCommunityLiquidity(data.communityLiquidity);
    renderFaucetDistribution(data.faucetDistribution);
    wireCopyButtons(document);
  } catch (e) {
    console.warn('[transparency] status load failed:', e);
    const grid = document.getElementById('componentGrid');
    if (grid) grid.innerHTML = '<div class="box"><p class="compError">⚠️ Couldn\'t reach the transparency data right now. Try refreshing in a moment.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', loadTransparencyStatus);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
