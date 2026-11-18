// WinLEW Health — fetches /api/health/status and renders exactly what the
// backend returns. The backend actually probes each first-party route over
// loopback (see src/mole/web.js) — this file never hardcodes "reachable."
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function renderRouteRow(route) {
  const problem = route.error || route.detail;
  const statusText = route.ok ? '● reachable' : `● down${route.status ? ` (${route.status})` : ''}`;
  const title = [route.latencyMs != null ? `${route.latencyMs}ms` : null, problem ? `— ${problem}` : null].filter(Boolean).join(' ');
  return `
    <div class="routeRow">
      <code>${esc(route.path)}</code>
      <span class="routeStatus${route.ok ? '' : ' down'}" title="${esc(title)}">${statusText}</span>
    </div>
  `;
}

async function loadHealthStatus() {
  try {
    const res = await hubApiFetch('/api/health/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'health_status_failed');

    const routes = data.routes || [];
    const pages = routes.filter((r) => r.kind !== 'api');
    const apis = routes.filter((r) => r.kind === 'api');
    const pagesList = document.getElementById('routeListPages');
    if (pagesList) pagesList.innerHTML = pages.map(renderRouteRow).join('') || '<div class="muted">No page checks configured.</div>';
    const apisList = document.getElementById('routeListApis');
    if (apisList) apisList.innerHTML = apis.map(renderRouteRow).join('') || '<div class="muted">No API checks configured.</div>';

    const routeCount = document.getElementById('healthRouteCount');
    if (routeCount) routeCount.textContent = data.totalCount ?? routes.length;

    const pct = document.getElementById('healthReachablePct');
    if (pct) {
      const total = data.totalCount || routes.length || 1;
      pct.textContent = `${Math.round(((data.reachableCount ?? 0) / total) * 100)}%`;
    }

    const checkedAt = document.getElementById('healthCheckedAt');
    if (checkedAt) {
      const time = fmtTime(data.checkedAt);
      checkedAt.textContent = `Live-checked over loopback${time ? ` at ${time}` : ''} — not a monitored external uptime feed, just this server checking its own first-party pages and data APIs.`;
    }

    const topStatus = document.getElementById('topStatus');
    if (topStatus) {
      const allUp = (data.reachableCount ?? 0) === (data.totalCount ?? routes.length);
      topStatus.classList.toggle('down', !allUp);
      topStatus.innerHTML = `<span class="dot"></span> ${allUp ? 'All checks healthy' : `${data.reachableCount}/${data.totalCount} checks healthy`}`;
    }
  } catch (e) {
    console.warn('[health] status load failed:', e);
    const failMsg = '<p class="muted">⚠️ Could not load live route status right now. Try refreshing.</p>';
    const pagesList = document.getElementById('routeListPages');
    if (pagesList) pagesList.innerHTML = failMsg;
    const apisList = document.getElementById('routeListApis');
    if (apisList) apisList.innerHTML = failMsg;
    const topStatus = document.getElementById('topStatus');
    if (topStatus) {
      topStatus.classList.add('down');
      topStatus.innerHTML = '<span class="dot"></span> Status unavailable';
    }
  }
}

document.addEventListener('DOMContentLoaded', loadHealthStatus);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);

/**
 * Bot liveness lights.
 *
 * Three states, and grey is deliberately not a dimmer red:
 *   green  a heartbeat arrived recently
 *   red    one arrived before, but not lately — it WAS up and stopped
 *   grey   nothing has ever been heard, i.e. the heartbeat is not wired up
 *
 * If the fetch itself fails, every light goes GREY, never green and never red.
 * A failed request tells us nothing about the bots, and claiming either
 * direction from it would be a lie in the one place people come to check.
 */
async function loadBotLights() {
  const rows = document.getElementById('botLightRows');
  if (!rows) return;

  const render = (services, note) => {
    rows.innerHTML = services.map((s) => {
      const cls = s.state === 'up' ? 'up' : s.state === 'down' ? 'down' : '';
      const when = s.state === 'up'
        ? `Online — checked in ${s.ageSec}s ago`
        : s.state === 'down'
          ? `Not responding — last seen ${Math.round(s.ageSec / 60)} min ago`
          : 'No check-in received yet';
      return `<div class="botRow">
          <span class="botLight ${cls}" role="img" aria-label="${s.state}"></span>
          <span><span class="botName">${s.label}</span><br /><span class="botWhen">${when}</span></span>
        </div>`;
    }).join('') + (note ? `<p class="muted" style="font-size:12px;margin-top:10px;">${note}</p>` : '');
  };

  try {
    const res = await hubApiFetch('/api/bot/health');
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.services)) throw new Error(data?.error || 'bad_payload');
    render(data.services);
  } catch (err) {
    console.warn('[health] bot lights unavailable', err);
    rows.innerHTML = '<div class="muted">Bot status unavailable — this says nothing about whether the bots are running.</div>';
  }
}
document.addEventListener('DOMContentLoaded', loadBotLights);
