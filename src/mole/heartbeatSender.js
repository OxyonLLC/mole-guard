import { getConfig } from './config.js';

async function postHeartbeat(kind) {
  const cfg = getConfig();
  if (!cfg.WATCHDOG_HEARTBEAT_TOKEN || !cfg.WATCHDOG_URL) return;

  const url = `${cfg.WATCHDOG_URL.replace(/\/$/, '')}/heartbeat`;
  const payload = {
    service: 'the-mole-guard',
    ts: Math.floor(Date.now() / 1000),
    kind,
    maintenance: cfg.MAINTENANCE_MODE,
    maintenance_reason: cfg.MAINTENANCE_MODE ? cfg.MAINTENANCE_REASON : null,
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.WATCHDOG_HEARTBEAT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[heartbeat] watchdog responded ${r.status} ${t}`);
    }
  } catch (e) {
    console.warn('[heartbeat] failed:', e?.message || e);
  }
}

export async function startHeartbeatSender() {
  const cfg = getConfig();
  if (!cfg.WATCHDOG_HEARTBEAT_TOKEN || !cfg.WATCHDOG_URL) {
    console.log('💓 Heartbeat sender disabled (no WATCHDOG settings).');
    return;
  }
  await postHeartbeat('startup');
  const intervalMs = Math.max(10, Number(cfg.HEARTBEAT_INTERVAL_SEC || 60)) * 1000;
  setInterval(() => postHeartbeat('heartbeat'), intervalMs).unref?.();
  console.log(`💓 Heartbeat sender: every ${cfg.HEARTBEAT_INTERVAL_SEC}s -> ${cfg.WATCHDOG_URL}`);
}
