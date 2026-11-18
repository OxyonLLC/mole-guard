// WinLEW Modules & Roadmap Status — fetches /api/modules/status and
// renders exactly what the canonical registry (src/mole/modulesData.js)
// returns. Never hardcodes a status/progress value here — every fact
// shown on this page comes from that single fetch.
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

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
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_LABELS = {
  live: 'LIVE', beta: 'BETA', partial: 'PARTIAL', ongoing: 'ONGOING', planned: 'PLANNED',
  deferred: 'DEFERRED', blocked: 'BLOCKED', retired: 'RETIRED', historical: 'HISTORICAL', internal: 'INTERNAL',
};

const CATEGORY_LABELS = {
  'foundation-transparency': 'Foundation & Transparency',
  'community-participation': 'Community Participation',
  'platform-infrastructure': 'Platform Infrastructure',
  governance: 'Governance',
  'deferred-future': 'Deferred / Future Work',
  historical: 'Historical Roadmap',
};

// Recommended section order — a module's section is derived from its
// category, with "historical" and "deferred-future" always last so the
// page reads live-first, honest-about-gaps-last.
const SECTION_ORDER = [
  { key: 'foundation-transparency', title: 'Transparency & History' },
  { key: 'community-participation', title: 'Community & Rewards' },
  { key: 'governance', title: 'Governance' },
  { key: 'platform-infrastructure', title: 'Mobile & Infrastructure' },
  { key: 'deferred-future', title: 'Deferred / Future Work' },
  { key: 'historical', title: 'Historical Roadmap' },
];

let allModules = [];
let activeCategory = 'all';
let activeStatus = 'all';

// Presentation-only summary of data the page already fetches — computes
// nothing the registry doesn't already provide, adds no new data source.
function renderHeroStats(modules, phases) {
  const setStat = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const visible = modules.filter((m) => m.publicVisibility !== false && m.status !== 'internal');
  setStat('heroModuleCount', visible.length || '—');
  setStat('heroLiveCount', visible.filter((m) => m.status === 'live').length);
  setStat('heroPhaseCount', phases.length || '—');
  const completeCount = phases.filter((p) => p.state === 'complete').length;
  setStat('heroPhaseComplete', completeCount);

  const rail = document.getElementById('heroPhaseRail');
  if (rail) {
    rail.innerHTML = phases.map((p) => `<span class="railDot ${esc(p.state)}" title="Phase ${esc(p.phase)}: ${esc(p.title)}"></span>`).join('');
  }
  const label = document.getElementById('heroPhaseProgressLabel');
  if (label) label.textContent = `${completeCount} / ${phases.length} phases complete`;
}

function renderPhases(phases) {
  const grid = document.getElementById('phaseGrid');
  const summary = document.getElementById('roadmapSummary');
  const progress = document.getElementById('roadmapProgress');
  if (!grid) return;

  const completeCount = phases.filter((p) => p.state === 'complete').length;
  if (summary) summary.textContent = `${completeCount} of ${phases.length} original phases fully complete. Phase-by-phase breakdown below — no phase is flattened into "100%" unless every item in it truly is.`;

  if (progress) {
    progress.innerHTML = `
      <div class="roadmapProgressTrack">
        ${phases.map((p) => `<div class="roadmapProgressSeg ${esc(p.state)}" title="Phase ${esc(p.phase)}: ${esc(p.title)}"></div>`).join('')}
      </div>
      <div class="roadmapProgressLabel">${completeCount} / ${phases.length} phases complete</div>
    `;
  }

  grid.innerHTML = phases.map((phase) => `
    <div class="phaseBox">
      <div class="num">Phase ${phase.phase}</div>
      <div class="title">${esc(phase.title)}</div>
      <span class="phaseState ${esc(phase.state)}">${esc(phase.state.toUpperCase())}</span>
      <div class="phaseItems">
        ${phase.items.map((item) => `
          <div class="phaseItem">
            <span>${esc(item.label)}</span>
            <span class="phaseItemState ${esc(item.state)}">${esc(item.state.replace(/-/g, ' '))}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderOngoing(modules) {
  const strip = document.getElementById('ongoingStrip');
  if (!strip) return;
  const ongoing = modules.filter((m) => m.ongoingOperation);
  if (!ongoing.length) {
    strip.innerHTML = '<span class="muted">None currently flagged.</span>';
    return;
  }
  strip.innerHTML = ongoing.map((m) => `<span class="ongoingChip">${esc(m.icon || '')} ${esc(m.title)} — ongoing</span>`).join('');
}

function renderFilters(modules) {
  const categories = [...new Set(modules.map((m) => m.category))];
  const statuses = [...new Set(modules.map((m) => m.status))];

  const catEl = document.getElementById('categoryFilters');
  const statusEl = document.getElementById('statusFilters');
  if (catEl) {
    catEl.innerHTML = '<label id="categoryFilterLabel">Category</label>' +
      `<button type="button" class="filterChip active" data-cat="all">All</button>` +
      categories.map((c) => `<button type="button" class="filterChip" data-cat="${esc(c)}">${esc(CATEGORY_LABELS[c] || c)}</button>`).join('');
  }
  if (statusEl) {
    statusEl.innerHTML = '<label id="statusFilterLabel">Status</label>' +
      `<button type="button" class="filterChip active" data-status="all">All</button>` +
      statuses.map((s) => `<button type="button" class="filterChip" data-status="${esc(s)}">${esc(STATUS_LABELS[s] || s)}</button>`).join('');
  }

  catEl?.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.getAttribute('data-cat');
      catEl.querySelectorAll('.filterChip').forEach((b) => b.classList.toggle('active', b === btn));
      renderSections(allModules);
    });
  });
  statusEl?.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeStatus = btn.getAttribute('data-status');
      statusEl.querySelectorAll('.filterChip').forEach((b) => b.classList.toggle('active', b === btn));
      renderSections(allModules);
    });
  });
}

function moduleCard(m, num) {
  const progressHtml = (m.progress != null)
    ? `<div class="mProgress"><div class="mProgressFill" style="width:${Math.min(100, Math.max(0, m.progress))}%"></div></div><div class="mProgressLabel">${m.progress}% — see limitations for what's not done</div>`
    : '';
  const links = [];
  if (m.route) links.push(`<a href="${esc(m.route)}">Open →</a>`);
  for (const doc of m.docs || []) links.push(`<a href="${esc(doc.url)}" ${doc.url.startsWith('http') ? 'target="_blank" rel="noreferrer"' : ''}>${esc(doc.label)}</a>`);

  return `
    <div class="moduleCard">
      <div class="moduleTop">
        <span class="modIcon" aria-hidden="true">${esc(m.icon || '🧩')}</span>
        <span class="statusPill ${esc(m.status)}"><span class="dot"></span>${esc(STATUS_LABELS[m.status] || m.status)}</span>
      </div>
      <div class="mHead">
        <div>
          <div class="modNum">Module ${String(num).padStart(2, '0')}</div>
          <h3>${esc(m.title)}</h3>
        </div>
      </div>
      <p class="mDesc">${esc(m.shortDescription)}</p>
      ${progressHtml}
      ${m.ongoingOperation ? '<div class="ongoingBadge">↻ ongoing operation</div>' : ''}
      ${m.implementationState ? `<div class="ongoingBadge" style="color:#ffc466;">Implementation: ${esc(m.implementationState.replace(/-/g, ' ').toUpperCase())}</div>` : ''}
      <div class="mMeta">
        <span>Phase ${esc(m.roadmapPhase)}${m.roadmapItem ? ` — ${esc(m.roadmapItem)}` : ''}</span>
        <span>Verified ${esc(fmtDate(m.lastVerifiedIso))}</span>
        ${m.retainedOnRoadmap ? '<span>Retained on roadmap</span>' : ''}
      </div>
      ${m.limitations ? `<p class="mDesc muted" style="font-size:12px;">${esc(m.limitations)}</p>` : ''}
      <div class="mLinks">${links.join('')}</div>
    </div>
  `;
}

function renderSections(modules) {
  const container = document.getElementById('sections');
  if (!container) return;

  // internal modules are architecture facts, not user-facing destinations
  const visible = modules.filter((m) => m.publicVisibility !== false && m.status !== 'internal');
  const filtered = visible.filter((m) => (activeCategory === 'all' || m.category === activeCategory) && (activeStatus === 'all' || m.status === activeStatus));

  if (!filtered.length) {
    container.innerHTML = '<div class="box muted">No modules match this filter.</div>';
    return;
  }

  const bySection = new Map();
  for (const section of SECTION_ORDER) bySection.set(section.key, []);
  for (const m of filtered) {
    if (!bySection.has(m.category)) bySection.set(m.category, []);
    bySection.get(m.category).push(m);
  }

  let moduleNum = 0;
  const sectionsHtml = SECTION_ORDER
    .map((section) => {
      const items = (bySection.get(section.key) || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      if (!items.length) return '';
      return `
        <section class="sectionBlock">
          <h2>${esc(section.title)}</h2>
          <div class="moduleGrid">${items.map((m) => moduleCard(m, ++moduleNum)).join('')}</div>
        </section>
      `;
    })
    .join('');

  container.innerHTML = sectionsHtml || '<div class="box muted">No modules match this filter.</div>';
}

async function loadModules() {
  try {
    const res = await hubApiFetch('/api/modules/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'modules_status_failed');
    allModules = data.modules || [];
    renderHeroStats(allModules, data.roadmapPhases || []);
    renderPhases(data.roadmapPhases || []);
    renderOngoing(allModules);
    renderFilters(allModules.filter((m) => m.publicVisibility !== false && m.status !== 'internal'));
    renderSections(allModules);
  } catch (e) {
    console.warn('[modules] status load failed:', e);
    const container = document.getElementById('sections');
    if (container) container.innerHTML = '<div class="box muted">⚠️ Could not load module status right now. Try refreshing.</div>';
  }
}

document.addEventListener('DOMContentLoaded', loadModules);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
