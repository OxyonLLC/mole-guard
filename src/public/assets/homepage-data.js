(function () {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 12000;
  const isProductionOrigin = /^(?:www\.)?winlew\.co$/i.test(window.location.hostname || '');
  const isLoopback = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname || '');
  let requestPromise = null;

  const SOURCES = Object.freeze({
    price: { label: 'Primary market status', evidence: '/links/' },
    burn: { label: 'Burn status', evidence: '/burn/' },
    transparency: { label: 'Transparency status', evidence: '/transparency/' },
    modules: { label: 'Canonical module registry', evidence: '/modules/' },
    quiz: { label: 'Quiz cycle', evidence: '/quiz/' },
    faucet: { label: 'Faucet distribution record', evidence: '/faucet/' },
    governance: { label: 'Governance proposals', evidence: '/governance/' },
    events: { label: 'Community event records', evidence: '/events/' },
    health: { label: 'Cached first-party route checks', evidence: '/health/' },
  });

  function summaryUrl() {
    if (isLoopback) return '/api/homepage/summary';
    if (!isProductionOrigin) return '';
    const url = new URL('/verify/api-proxy.php', window.location.origin);
    url.searchParams.set('path', '/api/homepage/summary');
    return url.toString();
  }

  function fetchSummary(timeoutMs) {
    if (requestPromise) return requestPromise;
    const url = summaryUrl();
    if (!url) return Promise.resolve(null);
    requestPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.ok !== true || body?.schemaVersion !== 1 || !body.items) {
          throw new Error(body?.error || `http_${response.status}`);
        }
        return body;
      } finally {
        clearTimeout(timer);
      }
    })();
    return requestPromise;
  }

  function legacyShape(name, item) {
    switch (name) {
      case 'price': return { priceUsd: item.priceUsd, liquidityUsd: item.liquidityUsd };
      case 'burn': return { progress: { percentOfTarget: item.percentOfTarget } };
      case 'transparency': return { circulatingSupply: { ok: item.circulatingSupplyOk, circulatingDisplay: item.circulatingDisplay, computedAtIso: item.sourceAt } };
      case 'modules': return { modules: Array.from({ length: item.visibleCount || 0 }, (_, i) => ({ status: i < (item.liveCount || 0) ? 'live' : 'planned' })) };
      case 'quiz': return { cycle: { endMs: item.cycleEndMs } };
      case 'faucet': return { totalConfirmedCount: item.totalConfirmedCount };
      case 'governance': return { proposals: Array.from({ length: item.proposalCount || 0 }, (_, i) => ({ status: i < (item.activeCount || 0) ? 'active' : 'closed' })) };
      case 'events': return { groups: { live: Array(item.liveCount || 0).fill({}), upcoming: Array(item.upcomingCount || 0).fill({}) } };
      case 'health': return { reachableCount: item.reachableCount, totalCount: item.totalCount };
      default: return {};
    }
  }

  function validItem(name, item) {
    const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
    const count = value => number(value) && Number.isInteger(Number(value)) && Number(value) <= 1000;
    switch (name) {
      case 'price': return number(item.priceUsd) && number(item.liquidityUsd);
      case 'burn': return number(item.percentOfTarget);
      case 'transparency': return item.circulatingSupplyOk === true && number(item.circulatingDisplay);
      case 'modules': return count(item.visibleCount) && count(item.liveCount) && item.liveCount <= item.visibleCount;
      case 'quiz': return number(item.cycleEndMs);
      case 'faucet': return number(item.totalConfirmedCount);
      case 'governance': return count(item.proposalCount) && count(item.activeCount) && item.activeCount <= item.proposalCount;
      case 'events': return count(item.liveCount) && count(item.upcomingCount);
      case 'health': return count(item.reachableCount) && count(item.totalCount) && item.reachableCount <= item.totalCount;
      default: return false;
    }
  }

  async function read(name, options = {}) {
    const source = SOURCES[name];
    if (!source) throw new Error('unknown_source');
    const fetchedAt = new Date().toISOString();
    if (!summaryUrl()) return { ok: false, name, source, state: 'isolated', error: 'source_not_connected', fetchedAt };
    try {
      const summary = await fetchSummary(options.timeoutMs);
      const item = summary?.items?.[name];
      if (!item || !['live', 'stale'].includes(item.state) || !validItem(name, item)) {
        return { ok: false, name, source, state: 'unavailable', error: item?.error || 'source_unavailable', fetchedAt };
      }
      return {
        ok: true,
        name,
        source,
        state: item.state,
        data: legacyShape(name, item),
        sourceTimestamp: item.sourceAt && Number.isFinite(Date.parse(item.sourceAt)) ? item.sourceAt : null,
        cachedAt: item.cachedAt || null,
        expiresAt: item.expiresAt || null,
        fetchedAt,
      };
    } catch (error) {
      return { ok: false, name, source, state: error?.name === 'AbortError' ? 'timeout' : 'unavailable', error: error?.message || 'request_failed', fetchedAt };
    }
  }

  window.WinLEW3AData = Object.freeze({ sources: SOURCES, read, summaryUrl });
})();
