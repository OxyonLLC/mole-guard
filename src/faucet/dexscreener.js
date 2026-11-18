
// dexscreener.js
import fetch from 'node-fetch';

// Verified Friday, July 24, 2026 as the active post-graduation PumpSwap pair
// for the permanent WinLEW mint.
export const POOL_ID = 'Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL';
export const MINT = 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';

// Fixed 2026-07-27: the old /latest/dex/pairs/solana/<pool> endpoint this
// used to call now returns {pairs:null,pair:null} for this pool (confirmed
// live) — DexScreener retired/changed that shape at some point after this
// was first written. /latest/dex/tokens/<mint> is the endpoint that's
// actually live today; it returns every pair for the mint, so we pick the
// one matching our known pool address rather than assuming pairs[0].
export async function fetchDexScreenerPrice(id = POOL_ID) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${MINT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const json = await res.json();
  const pairs = Array.isArray(json.pairs) ? json.pairs : [];
  const pair = pairs.find((p) => p.pairAddress === id) || pairs[0];
  const price = Number(pair?.priceUsd);
  if (!price || isNaN(price)) throw new Error('No valid price from DexScreener');
  return {
    price,
    baseSymbol: pair?.baseToken?.symbol,
    quoteSymbol: pair?.quoteToken?.symbol,
    volume24h: pair?.volume?.h24,
    fdv: pair?.fdv,
    url: `<https://dexscreener.com/solana/${id}>`,
  };
}
