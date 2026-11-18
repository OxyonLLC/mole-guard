// WinLEW Discord Bots — fetches /api/discord-bots/status and renders exactly
// what the backend returns. This only ever labels a service "reachable" or
// "unreachable" — never "bot online," which isn't something this site can
// observe for any of the 5 bots (see the note the backend itself returns,
// rendered verbatim below rather than paraphrased).
const { hubApiFetch, walletLogin, setConnectedUi, getAuth, getCachedWallet, refreshWalletBalance } = window.WinLEWAuth;

function renderServicePill(svc) {
  const el = document.getElementById(`svc-${svc.id}`);
  if (!el) return;
  el.classList.remove('reachable', 'unreachable');
  if (svc.reachable) {
    el.classList.add('reachable');
    el.textContent = `🟢 Service reachable`;
  } else {
    el.classList.add('unreachable');
    el.textContent = `🔴 Service unreachable`;
  }
  el.title = `${svc.reachable ? 'Responded' : (svc.error === 'timeout' ? 'Timed out' : 'Connection failed')}${svc.latencyMs != null ? ` (${svc.latencyMs}ms)` : ''} — this checks the underlying service's port, not the Discord connection itself.`;
}

async function loadBotServiceStatus() {
  try {
    const res = await hubApiFetch('/api/discord-bots/status');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'discord_bots_status_failed');
    (data.services || []).forEach(renderServicePill);
  } catch (e) {
    console.warn('[discord-bots] service status load failed:', e);
    document.querySelectorAll('.servicePill').forEach((el) => {
      el.textContent = '⚠️ Unavailable';
      el.title = "Couldn't reach the status check right now — try refreshing.";
    });
  }
}

document.addEventListener('DOMContentLoaded', loadBotServiceStatus);

function wireNavWalletConnect() {
  document.getElementById('navWalletConnect')?.addEventListener('click', (e) => {
    walletLogin({ triggerBtn: e.currentTarget, onSuccess: () => window.location.reload() });
  });
  if (getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  refreshWalletBalance();
}
document.addEventListener('DOMContentLoaded', wireNavWalletConnect);
