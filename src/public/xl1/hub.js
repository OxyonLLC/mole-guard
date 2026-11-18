// WinLEW XL1 hub (2026-10-23). Two small reads, both cached, neither touching a producer:
// the arcade's reward settings (WinLEW's own API) and the last 24 h of XL1 mainnet blocks
// (oxyon.io's public Chain Viewer API, cached 60 s). Anything that can't be read says so.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v).toLocaleString('en-US');
  // Oxyon's mainnet producers, by reward address (the names on Oxyon's dashboards).
  const OURS = {
    ca08120874f071739d932b24da41cc13299123b3: 'LewSales-pi3',
    a9304753eade52dd22b1a6fc519b571a4dc2653e: 'LewSales-3',
    '2152e6aec996742fb6e52ae1aad87bd44f2ccc91': 'LewSales-2',
  };
  const ago = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  function loadAuth() {
    if (window.WinLEWAuth) return Promise.resolve(window.WinLEWAuth);
    return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/assets/wallet-auth.js'; s.onload = () => resolve(window.WinLEWAuth); s.onerror = reject; document.head.appendChild(s); });
  }

  // The arcade card's live terms.
  loadAuth().then(a => a.hubApiFetch('/api/xl1-arcade/config', { headers: { accept: 'application/json' } }))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(c => {
      const chip = $('arcade-chip');
      if (!c.enabled) { chip.className = 'chip chip-experimental'; chip.textContent = 'Paused'; $('arcade-terms').textContent = 'Rewards are paused right now; the games stay playable.'; return; }
      if (c.simulated) { chip.className = 'chip chip-experimental'; chip.textContent = 'Dry run'; $('arcade-terms').textContent = 'Rewards are simulated right now: nothing is sent.'; return; }
      chip.className = 'chip chip-live'; chip.textContent = c.network === 'mainnet' ? 'Live · real XL1' : 'Live · XL1 Sequence';
      $('arcade-terms').textContent = `${c.rewardPerMinute} XL1 for every minute of a finished round, up to ${c.dailyCap} XL1 a day.`;
    })
    .catch(() => { $('arcade-terms').textContent = 'Seven of the eight games pay XL1 for time played. (Reward terms could not be read just now.)'; });

  // The network right now: the last 24 h of XL1 mainnet, from Oxyon.
  fetch('https://oxyon.io/api/xl1/mainnet/producers?window=24h', { headers: { accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => {
      if (!d.total || !Array.isArray(d.rows) || !d.rows.length) throw new Error('empty');
      const ours = d.rows.filter(r => OURS[r.producer]);
      const oursBlocks = ours.reduce((s, r) => s + r.blocks, 0);
      $('net-summary').textContent = `${n(d.total)} blocks from ${n(d.rows.length)} producers in the last 24 hours${ours.length ? `; ${ours.length} of them run by Oxyon, with ${(oursBlocks / d.total * 100).toFixed(1)}% of the blocks.` : '.'}`;
      $('net-top').innerHTML = d.rows.slice(0, 5).map(r => {
        const name = OURS[r.producer] ? `${OURS[r.producer]} · Oxyon` : `${r.producer.slice(0, 4)}…${r.producer.slice(-4)}`;
        return `<li class="${OURS[r.producer] ? 'ours' : ''}"><span>#${esc(r.rank)} <strong>${esc(name)}</strong></span><span>${esc(n(r.blocks))} blocks</span></li>`;
      }).join('');
      const at = d.meta?.generatedAt;
      // The footer's network light (shared/shell.js): fresh data means the chain is moving.
      const age = at ? Date.now() - at : Infinity;
      window.dispatchEvent(new CustomEvent('xl1:network', { detail: { state: age < 600000 ? 'online' : age < 1800000 ? 'stale' : 'offline' } }));
      $('net-src').textContent = `Source: Oxyon's XL1 Chain Viewer, observed${d.exact ? '' : ' and counted by the hour'}${at ? `, updated ${ago(at)}` : ''}. Observations, not an official XYO figure.`;
    })
    .catch(() => {
      window.dispatchEvent(new CustomEvent('xl1:network', { detail: { state: 'unknown' } }));
      $('net-summary').textContent = "The network summary is unavailable right now. Oxyon's Chain Viewer has the live view.";
      $('net-top').innerHTML = '';
      $('net-src').textContent = '';
    });
})();
