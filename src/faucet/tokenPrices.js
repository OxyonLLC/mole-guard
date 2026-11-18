// tokenPrices.js
// Simple USD price + 24h change from CoinGecko, for the faucet bot's SOL/XYO/XL1
// price voice-channels. ($WinLEW keeps using the on-chain fetchBestPrice() —
// it's not on a public price index. These sibling tokens are.)
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';

/**
 * @param {string[]} ids CoinGecko coin ids (e.g. ["solana","xyo-network","xl1"])
 * @returns {Promise<Record<string,{usd:number,change24h:number}>>}
 */
export async function fetchCoinGeckoPrices(ids = []) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const url = `${COINGECKO_URL}?ids=${encodeURIComponent(list.join(','))}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'WinLEW-Faucet-Bot' },
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const id of list) {
    const row = data?.[id];
    if (row && Number.isFinite(Number(row.usd))) {
      out[id] = { usd: Number(row.usd), change24h: Number(row.usd_24h_change ?? 0) };
    }
  }
  return out;
}

// Adapt decimal precision to magnitude so SOL ($76) and XL1 ($0.0001) both read well.
export function formatUsdPrice(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}

export function changeArrow(change) {
  const n = Number(change) || 0;
  if (n > 0.005) return '↗';
  if (n < -0.005) return '↘';
  return '→';
}
