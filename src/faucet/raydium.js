
// raydium.js

import fetch from 'node-fetch';
import { MINT as WINLEW_MINT } from './dexscreener.js';

export const POOL_ID = '5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx';

// Fixed 2026-08-08. This module had two independent bugs and reported
// "No valid price from Raydium" on every single call — !data's Raydium row
// had simply never worked since the v3 API shape changed. It went unnoticed
// because fetchBestPrice() tries GeckoTerminal first and returns early, so
// the price voice-channels never reach this code.
//
// Bug 1 — the response shape. api-v3 returns
//   { id: "<request uuid>", success: true, data: [ {...pool} ] }
// and the old code did `json[id]` with id = the POOL address. That key never
// exists, so `data` was always undefined and the throw below always fired.
// The pool must be looked up inside the `data` ARRAY.
//
// Bug 2 — `price` is not a price. It is the pool ratio, mintB per mintA:
// 7,427,815 here, which is exactly mintAmountB / mintAmountA. Returning it as
// a USD price would have reported $7.4 million per WinLEW alongside sources
// quoting $0.00001. So even "fixing" bug 1 alone would have been worse than
// the error it replaced.
//
// Raydium exposes no USD price for the token, so it is derived from TVL. In a
// constant-product pool the two sides hold equal value at the marginal price,
// so each side is tvl/2 and the token's USD price is (tvl/2) / tokenAmount.
// Cross-checked against GeckoTerminal for this pool: $0.00001005 derived vs
// $0.00000979 reported, ~2.6% apart, which is TVL snapshot lag rather than a
// different answer. Do not "simplify" this back to `data.price`.
export async function fetchRaydiumPrice(id = POOL_ID) {
  const url = `https://api-v3.raydium.io/pools/info/ids?ids=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Raydium HTTP ${res.status}`);
  const json = await res.json();

  const rows = Array.isArray(json?.data) ? json.data : [];
  // The API echoes back one entry per requested id, in order, and nulls out
  // ids it doesn't know. Match on id where present rather than trusting [0].
  const data = rows.find((row) => row?.id === id) || (rows.length === 1 ? rows[0] : null);
  if (!data) throw new Error(`Raydium returned no pool for ${id}`);

  // Which side is WinLEW? Never assume mintB — orientation is a property of
  // how the pool was created, and reading it wrong silently inverts the price.
  const aIsWinlew = data.mintA?.address === WINLEW_MINT;
  const bIsWinlew = data.mintB?.address === WINLEW_MINT;
  if (!aIsWinlew && !bIsWinlew) {
    throw new Error(`Raydium pool ${id} does not contain the WinLEW mint`);
  }

  const winlewSide = aIsWinlew ? data.mintA : data.mintB;
  const otherSide = aIsWinlew ? data.mintB : data.mintA;
  const winlewAmount = Number(aIsWinlew ? data.mintAmountA : data.mintAmountB);
  const tvl = Number(data.tvl);

  if (!Number.isFinite(tvl) || tvl <= 0 || !Number.isFinite(winlewAmount) || winlewAmount <= 0) {
    throw new Error('No valid price from Raydium (pool has no TVL or no WinLEW balance)');
  }

  const price = (tvl / 2) / winlewAmount;
  if (!Number.isFinite(price) || price <= 0) throw new Error('No valid price from Raydium');

  return {
    price,
    poolName: `${data.mintA?.symbol || '?'}/${data.mintB?.symbol || '?'}`,
    baseSymbol: winlewSide?.symbol,
    baseAddress: winlewSide?.address,
    quoteSymbol: otherSide?.symbol,
    // v3 reports rolling windows under day/week/month, not a flat volume24h.
    volume24h: Number(data.day?.volume) || 0,
    tvl,
    // Extra context the old shape couldn't provide: how many WinLEW one unit
    // of the paired token buys, straight from the pool rather than derived.
    ratio: Number(data.price) || null,
    winlewAmount,
    url: `<https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${WINLEW_MINT}>`,
  };
}
