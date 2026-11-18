// gecko.js
import fetch from 'node-fetch';

// Verified Friday, July 24, 2026 as the active post-graduation PumpSwap pool
// for the permanent WinLEW mint.
export const POOL_ID = 'Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL';

export async function fetchGeckoTerminalPrice(id = POOL_ID) {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
  const json = await res.json();
  const attributes = json.data?.attributes || {};
  const [baseSymbol = 'WinLEW', quoteSymbol = 'SOL'] = String(attributes.name || attributes.pool_name || 'WinLEW / SOL')
    .split('/')
    .map((value) => value.trim())
    .filter(Boolean);
  const baseAddress = String(json.data?.relationships?.base_token?.data?.id || '').replace(/^solana_/, '') || null;
  const quoteAddress = String(json.data?.relationships?.quote_token?.data?.id || '').replace(/^solana_/, '') || null;
  const price = Number(attributes.base_token_price_usd);
  if (!price || isNaN(price)) throw new Error('No valid price from GeckoTerminal');
  return {
    price,
    poolName: attributes.name || attributes.pool_name || 'WinLEW / SOL',
    baseSymbol,
    baseAddress,
    quoteSymbol,
    quoteAddress,
    volume24h: attributes.volume_usd?.h24 ?? attributes.volume_usd_24h,
    fdv: attributes.fdv_usd,
    url: `<https://www.geckoterminal.com/solana/pools/${id}>`,
  };
}
