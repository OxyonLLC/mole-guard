(function () {
  'use strict';
  const data = window.WinLEW3AData;
  if (!data) return;

  const compact = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value)) : null;
  const usd = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number(value) < 1 ? 8 : 2 }).format(Number(value)) : null;
  const when = (result) => result.state === 'stale'
    ? `Stale snapshot · source updated ${result.sourceTimestamp ? new Date(result.sourceTimestamp).toLocaleString() : 'time unavailable'}`
    : result.sourceTimestamp ? `Source updated ${new Date(result.sourceTimestamp).toLocaleString()}`
      : result.ok ? `Fetched ${new Date(result.fetchedAt).toLocaleTimeString()}; source timestamp not provided`
        : 'Current source unavailable';

  function cardState(name, result, view) {
    const card = document.querySelector(`[data-source-card="${name}"]`);
    if (!card) return;
    const badge = card.querySelector('[data-state]');
    const title = card.querySelector('[data-title]');
    const summary = card.querySelector('[data-summary]');
    const freshness = card.querySelector('[data-freshness]');
    card.classList.toggle('source-live', result.ok && result.state !== 'stale');
    card.classList.toggle('source-stale', result.ok && result.state === 'stale');
    card.classList.toggle('source-error', !result.ok);
    if (badge) { badge.textContent = !result.ok ? 'Unavailable' : result.state === 'stale' ? 'Stale' : view.state; badge.className = `status ${!result.ok ? 'unavailable' : result.state === 'stale' ? 'unknown' : view.className}`; }
    if (title) title.textContent = result.ok ? view.title : view.fallbackTitle;
    if (summary) summary.textContent = result.ok ? view.summary : view.fallbackSummary;
    if (freshness) freshness.textContent = `${result.source.label} · ${when(result)}`;
  }

  function metric(name, value, meta) {
    const el = document.querySelector(`[data-metric="${name}"]`);
    if (!el) return;
    if (value) el.querySelector('[data-value]').textContent = value;
    el.querySelector('[data-meta]').textContent = meta;
  }

  function record(name, value, summary) {
    const el = document.querySelector(`[data-record="${name}"]`);
    if (!el) return;
    el.querySelector('[data-value]').textContent = value;
    el.querySelector('[data-summary]').textContent = summary;
  }

  async function loadQuiz() {
    const result = await data.read('quiz');
    const cycle = result.data?.cycle || {};
    const active = Number(cycle.endMs || 0) > Date.now();
    cardState('quiz', result, { state: active ? 'Live' : 'No active cycle', className: active ? 'live' : 'unknown', title: active ? 'Quiz cycle is open' : 'No active cycle', summary: active ? 'Answer questions, build a streak, and redeem through the existing quiz system.' : 'The source returned no currently active cycle.', fallbackTitle: 'Quiz status unavailable', fallbackSummary: 'Open the Quiz page to retry the canonical source.' });
  }

  async function loadFaucet() {
    const result = await data.read('faucet');
    const count = compact(result.data?.totalConfirmedCount);
    cardState('faucet', result, { state: 'Live record', className: 'live', title: 'Faucet distribution', summary: count ? `${count} confirmed claims recorded across supported sources.` : 'The distribution source responded; no confirmed count was provided.', fallbackTitle: 'Faucet record unavailable', fallbackSummary: 'No claim count or eligibility is inferred. Open Faucet to retry.' });
  }

  async function loadGovernance() {
    const result = await data.read('governance');
    const proposals = Array.isArray(result.data?.proposals) ? result.data.proposals : [];
    const active = proposals.filter((item) => item.status === 'active').length;
    cardState('governance', result, { state: active ? 'Active' : 'Open', className: active ? 'live' : 'unknown', title: active ? `${active} active proposal${active === 1 ? '' : 's'}` : 'Governance record', summary: active ? 'Review the proposal, eligibility, evidence, and server-computed results.' : 'No proposals are open for voting right now.', fallbackTitle: 'Governance unavailable', fallbackSummary: 'No proposal state is inferred. Open Governance to retry.' });
    record('governance', result.ok ? (active ? `${active} active` : 'Nothing open') : 'Unavailable', result.ok ? `${proposals.length} proposal record${proposals.length === 1 ? '' : 's'} returned by the canonical source.` : 'No proposal count is inferred.');
  }

  async function loadEvents() {
    const result = await data.read('events');
    const groups = result.data?.groups || {};
    const live = Array.isArray(groups.live) ? groups.live.length : 0;
    const upcoming = Array.isArray(groups.upcoming) ? groups.upcoming.length : 0;
    cardState('events', result, { state: live ? 'Live' : upcoming ? 'Upcoming' : 'Records', className: live ? 'live' : 'unknown', title: live ? `${live} live event${live === 1 ? '' : 's'}` : upcoming ? `${upcoming} upcoming event${upcoming === 1 ? '' : 's'}` : 'Community records', summary: live || upcoming ? 'See dates, eligibility, rules, and results from the existing event source.' : 'No live or upcoming event is currently classified by the server.', fallbackTitle: 'Events unavailable', fallbackSummary: 'No activity is invented. Open Events to retry.' });
    record('events', result.ok ? (live ? `${live} live` : upcoming ? `${upcoming} upcoming` : 'No current events') : 'Unavailable', result.ok ? 'Server-classified event state; completed records remain available.' : 'No event count is inferred.');
  }

  async function loadEconomy() {
    const [price, burn, transparency, modules] = await Promise.all(['price', 'burn', 'transparency', 'modules'].map((name) => data.read(name)));
    metric('price', price.ok ? usd(price.data?.priceUsd) : null, price.ok ? when(price) : 'Current price unavailable');
    metric('liquidity', price.ok ? (compact(price.data?.liquidityUsd) ? `$${compact(price.data.liquidityUsd)}` : null) : null, price.ok ? `Source: ${price.source.label}` : 'Current liquidity unavailable');
    const pct = burn.ok ? Number(burn.data?.progress?.percentOfTarget) : NaN;
    metric('burn', Number.isFinite(pct) ? `${pct.toFixed(1)}%` : null, burn.ok ? when(burn) : 'Current burn progress unavailable');
    const cs = transparency.data?.circulatingSupply;
    metric('supply', transparency.ok && cs?.ok === true ? compact(cs.circulatingDisplay) : null, transparency.ok && cs?.ok === true ? (cs.computedAtIso ? `Calculated ${new Date(cs.computedAtIso).toLocaleString()}` : 'Source timestamp not provided') : 'Circulating supply unavailable; total supply not substituted');
    const visible = modules.ok && Array.isArray(modules.data?.modules) ? modules.data.modules.filter((item) => item.publicVisibility !== false && item.status !== 'internal') : null;
    const live = visible ? visible.filter((item) => item.status === 'live').length : null;
    metric('modules', live != null && visible.length ? `${live} of ${visible.length}` : null, visible ? `Canonical registry · ${when(modules)}` : 'Module registry unavailable');
    const burnState = document.querySelector('[data-evidence-state="burn"]');
    const burnTime = document.querySelector('[data-evidence-time="burn"]');
    if (burnState) burnState.textContent = burn.ok ? 'Burn source responded; inspect the ledger for transaction-level evidence.' : 'Current burn source unavailable; no total displayed.';
    if (burnTime) burnTime.textContent = when(burn);
  }

  async function loadHealth() {
    const result = await data.read('health');
    const badge = document.querySelector('[data-health-state]');
    const summary = document.querySelector('[data-health-summary]');
    const time = document.querySelector('[data-health-time]');
    if (badge) { badge.textContent = !result.ok ? 'Unavailable' : result.state === 'stale' ? 'Stale snapshot' : 'Source live'; badge.className = `status ${!result.ok ? 'unavailable' : result.state === 'stale' ? 'unknown' : 'live'}`; }
    if (summary) summary.textContent = result.ok ? `${result.data?.reachableCount ?? '—'} of ${result.data?.totalCount ?? '—'} configured first-party checks responded. This is a loopback check, not an uptime guarantee.` : 'The health request failed; this says nothing about whether individual services are running.';
    if (time) time.textContent = when(result);
  }

  Promise.allSettled([loadQuiz(), loadFaucet(), loadGovernance(), loadEvents(), loadEconomy(), loadHealth()]);
})();
