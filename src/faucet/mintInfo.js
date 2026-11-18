// Side-effect-free mint metadata lookup — deliberately does NOT import
// src/faucet/faucet.js (which loads src/faucet/.env, a file containing
// faucet-bot-specific secrets, as an import-time side effect). Safe to
// import from the web process: this file touches no env files and no key
// material, only a public RPC read.

import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

const decimalsCache = new Map();

export async function getMintDecimals(connection, mintAddress) {
  const mintStr = String(mintAddress);
  if (decimalsCache.has(mintStr)) return decimalsCache.get(mintStr);
  const info = await getMint(connection, new PublicKey(mintStr));
  decimalsCache.set(mintStr, info.decimals);
  return info.decimals;
}
