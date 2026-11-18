
// pumpfun.js
import fetch from 'node-fetch';
export const POOL_ID = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';

// Fixed 2026-07-27: api.pump.fun/api/markets/<id> is dead (confirmed live —
// Cloudflare error 530, the whole domain no longer resolves to a working
// origin). frontend-api-v3.pump.fun/coins/<mint> is pump.fun's current API.
// Note: pump.fun's own usd_market_cap/price fields stop updating live once
// a coin graduates off the bonding curve to its PumpSwap pool (confirmed —
// updated_at lagged ~40h behind "now" in testing) — treat this as a
// last-resort fallback, not a primary source, once a coin has graduated.
export async function fetchPumpFunPrice(id = POOL_ID) {
  const url = `https://frontend-api-v3.pump.fun/coins/${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pump.Fun HTTP ${res.status}`);
  const json = await res.json();
  const decimals = 6;
  const circulating = Number(json.total_supply) / 10 ** decimals;
  const marketCap = Number(json.usd_market_cap);
  const price = circulating > 0 ? marketCap / circulating : NaN;
  if (!price || isNaN(price)) throw new Error('No valid price from Pump.fun');
  const updatedAgeMs = json.updated_at ? Date.now() - Number(json.updated_at) * 1000 : null;
  return {
    price,
    fdv: marketCap,
    stale: updatedAgeMs != null && updatedAgeMs > 10 * 60 * 1000,
    updatedAt: json.updated_at ? new Date(Number(json.updated_at) * 1000).toISOString() : null,
    url: `<https://pump.fun/coin/${id}>`,
  };
}
