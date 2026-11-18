import { Connection, PublicKey } from '@solana/web3.js';
import { resolveSolanaName } from '../shared/solanaNames.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function assertBase58(label, v) {
  const s = String(v || '').trim();
  if (!s) throw new Error(`${label}_missing`);
  if (!BASE58_RE.test(s)) throw new Error(`${label}_not_base58`);
  return s;
}
import { getConfig } from './config.js';

// The configured RPC has been observed to hang indefinitely on some methods
// (getParsedTokenAccountsByOwner with a mint filter, specifically, against
// the default solana-rpc.publicnode.com endpoint — confirmed by hand:
// several consecutive real calls each timed out with zero bytes received).
// Without a bound, a single degraded RPC call would hang the whole
// /api/transparency/status response for every visitor. Fail fast instead —
// the caller treats a timeout exactly like any other lookup failure (marks
// that one component "temporarily unavailable" instead of showing a wrong
// balance for it).
const RPC_TIMEOUT_MS = 8000;
function withTimeout(promise, label, timeoutMs = RPC_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`rpc_timeout:${label}`)), timeoutMs)),
  ]);
}

// Endpoint failover (2026-07-31). A single timeout on the primary RPC used
// to be a hard, user-facing failure — the reported symptom was
// "Verify failed: rpc_timeout:getParsedTokenAccountsByOwner" on /verify/,
// because api.mainnet-beta.solana.com throttles exactly that method.
//
// Ordering is deliberate: the configured SOLANA_RPC is always tried FIRST,
// and a paid endpoint is only reached if that attempt fails, so normal
// traffic doesn't silently move onto a metered plan — the fallback is
// insurance, not the default path.
const RPC_ATTEMPT_TIMEOUT_MS = 6000;
function rpcEndpoints() {
  const { SOLANA_RPC } = getConfig();
  const seen = new Set();
  return [SOLANA_RPC, process.env.SOLANA_RPC_FALLBACK, process.env.QUICKNODE_URL]
    .map((u) => String(u || '').trim())
    .filter((u) => u && u.startsWith('http') && !seen.has(u) && seen.add(u));
}

/**
 * Runs `run(connection)` against each configured endpoint in turn, moving on
 * when one times out or errors. Rethrows the LAST error if every endpoint
 * fails, so callers still see a real reason (and still fail closed — a
 * caller must never read a total failure as a zero balance).
 */
async function withRpcFailover(label, run, { timeoutMs = RPC_ATTEMPT_TIMEOUT_MS } = {}) {
  const endpoints = rpcEndpoints();
  if (!endpoints.length) throw new Error('rpc_not_configured');

  let lastError = null;
  for (let i = 0; i < endpoints.length; i += 1) {
    try {
      return await withTimeout(run(new Connection(endpoints[i], 'confirmed')), label, timeoutMs);
    } catch (error) {
      lastError = error;
      // Endpoint identity is intentionally not logged — these URLs carry
      // provider tokens in the host/path.
      console.warn(`[solana] ${label} failed on endpoint ${i + 1}/${endpoints.length}:`, error?.message || error);
    }
  }
  throw lastError || new Error(`rpc_failed:${label}`);
}

// The website's own SNS (.sol domain) lookup — src/faucet/bot.js has always
// been able to do this for a Discord reply; the website never has. Best-
// effort, short timeout (cosmetic display enhancement, not real data — a
// slow/dead RPC here must never hold up a wallet display that would
// otherwise render instantly with the raw address). Returns null on any
// failure, timeout, or wallet with no registered .sol domain.
const SNS_LOOKUP_TIMEOUT_MS = 3000;
export async function resolveWalletSnsName(ownerAddress) {
  try {
    const { SOLANA_RPC } = getConfig();
    const conn = new Connection(String(SOLANA_RPC || '').trim(), 'confirmed');
    const ownerStr = assertBase58('owner', ownerAddress);
    return await withTimeout(resolveSolanaName(ownerStr, conn), 'sns_lookup', SNS_LOOKUP_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export async function getSplBalance(ownerAddress, mintAddress) {
  // Validate/normalize early so errors are clean (and not "Non-base58 character" deep inside web3.js)
  const ownerStr = assertBase58('owner', ownerAddress);
  const mintStr = assertBase58('mint', mintAddress);

  const owner = new PublicKey(ownerStr);
  const mint = new PublicKey(mintStr);

  const resp = await withRpcFailover('getParsedTokenAccountsByOwner', (conn) =>
    conn.getParsedTokenAccountsByOwner(owner, { mint }));
  let total = 0;
  for (const item of resp.value) {
    const info = item.account.data.parsed.info;
    total += Number(info.tokenAmount.uiAmount ?? 0);
  }
  return total;
}

/**
 * The same holding as getSplBalance(), as EXACT base units: `{ units, decimals }`
 * where `units` is a decimal string of the on-chain integer amount (summed as
 * BigInt across token accounts). getSplBalance() sums floating-point uiAmounts,
 * which is fine for display and thresholds but not for computing a payout.
 */
export async function getSplBalanceUnits(ownerAddress, mintAddress) {
  const owner = new PublicKey(assertBase58('owner', ownerAddress));
  const mint = new PublicKey(assertBase58('mint', mintAddress));
  const resp = await withRpcFailover('getParsedTokenAccountsByOwner', (conn) =>
    conn.getParsedTokenAccountsByOwner(owner, { mint }));
  let units = 0n;
  let decimals = null;
  for (const item of resp.value) {
    const amount = item.account.data.parsed.info.tokenAmount;
    const d = Number(amount.decimals);
    if (decimals === null) decimals = d;
    else if (decimals !== d) throw new Error('token accounts disagree on decimals');
    units += BigInt(amount.amount);
  }
  if (decimals === null) {
    // No token account: zero, in the mint's own decimals.
    const info = await withRpcFailover('getParsedAccountInfo', (conn) => conn.getParsedAccountInfo(mint));
    decimals = Number(info?.value?.data?.parsed?.info?.decimals);
    if (!Number.isInteger(decimals)) throw new Error('mint decimals unreadable');
  }
  return { units: units.toString(), decimals };
}

function formatSignatures(signatures) {
  return signatures.map((s) => ({
    signature: s.signature,
    slot: s.slot,
    blockTime: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
    err: s.err ? true : false,
  }));
}

// Read-only, on-chain snapshot for an address that HOLDS its WINLEW balance
// via an associated token account it owns — this covers plain wallets (Burn
// Wallet, Faucet Reserve, Developer Reserve) and program-owned accounts that
// still own a regular ATA the normal way (both Jupiter Lock vesting accounts
// verified this way: getTokenAccountsByOwner(lockAddress, {mint}) returns
// their locked-token ATA directly). No secrets involved (public reads only);
// safe to call from the public web process, unlike anything touching the
// payout signer.
export async function getOwnerTokenSnapshot(address, { signatureLimit = 10 } = {}) {
  const { WINLEW_MINT } = getConfig();
  const addressStr = assertBase58('address', address);
  const owner = new PublicKey(addressStr);

  // winlewBalance is NOT swallowed to 0 on failure — an RPC hiccup here must
  // surface as "couldn't load this component" (the caller's job), never as a
  // false "0 locked/held". Losing recent-transaction history to a slow RPC
  // is an acceptable degradation on its own; a wrong balance is not.
  const [lamports, winlewBalance, signatures] = await Promise.all([
    withRpcFailover('getBalance', (conn) => conn.getBalance(owner)),
    getSplBalance(addressStr, WINLEW_MINT),
    withRpcFailover('getSignaturesForAddress', (conn) =>
      conn.getSignaturesForAddress(owner, { limit: signatureLimit })).catch(() => []),
  ]);

  return {
    address: addressStr,
    solBalance: lamports / 1_000_000_000,
    winlewBalance,
    recentTransactions: formatSignatures(signatures),
  };
}

// Read-only snapshot for an address that IS ITSELF a token account (its
// balance lives directly on the account, not via a separate ATA it owns) —
// this is how the Streamflow lock resolves on-chain: the given address
// parses as an spl-token "account" with its own tokenAmount, not as a wallet
// that owns a further token account.
export async function getTokenAccountSnapshot(address, { signatureLimit = 10 } = {}) {
  const { WINLEW_MINT } = getConfig();
  const addressStr = assertBase58('address', address);
  const pubkey = new PublicKey(addressStr);

  const [accountInfo, signatures] = await Promise.all([
    withRpcFailover('getParsedAccountInfo', (conn) => conn.getParsedAccountInfo(pubkey)),
    withRpcFailover('getSignaturesForAddress', (conn) =>
      conn.getSignaturesForAddress(pubkey, { limit: signatureLimit })).catch(() => []),
  ]);

  const parsed = accountInfo?.value?.data?.parsed;
  const info = parsed?.type === 'account' ? parsed.info : null;
  const mint = info?.mint || null;
  const winlewBalance = info && mint === WINLEW_MINT ? Number(info.tokenAmount?.uiAmount ?? 0) : 0;

  return {
    address: addressStr,
    solBalance: (accountInfo?.value?.lamports ?? 0) / 1_000_000_000,
    winlewBalance,
    mintMatches: mint === WINLEW_MINT,
    recentTransactions: formatSignatures(signatures),
  };
}

// Read-only snapshot for an account we only need to prove exists and is
// owned by a specific on-chain program (e.g. a Raydium liquidity pool state
// account) — no attempt to parse that program's custom account layout to
// extract reserves. Callers show this alongside a link to a service that
// already parses it correctly (DexScreener) rather than reimplementing that
// parsing here.
export async function getProgramAccountSnapshot(address) {
  const addressStr = assertBase58('address', address);
  const pubkey = new PublicKey(addressStr);

  const accountInfo = await withRpcFailover('getAccountInfo', (conn) => conn.getAccountInfo(pubkey));
  return {
    address: addressStr,
    exists: !!accountInfo,
    owner: accountInfo?.owner ? accountInfo.owner.toBase58() : null,
    solBalance: (accountInfo?.lamports ?? 0) / 1_000_000_000,
  };
}

// Read-only snapshot of the WINLEW mint itself — supply, decimals, and
// whether mint/freeze authority have been renounced.
export async function getMintSnapshot() {
  const { WINLEW_MINT } = getConfig();
  const mint = new PublicKey(WINLEW_MINT);
  const accountInfo = await withRpcFailover('getParsedAccountInfo', (conn) => conn.getParsedAccountInfo(mint));
  const info = accountInfo?.value?.data?.parsed?.info;
  return {
    address: WINLEW_MINT,
    decimals: info?.decimals ?? null,
    supply: info ? Number(info.supply) / 10 ** (info.decimals ?? 0) : null,
    mintAuthority: info?.mintAuthority || null,
    freezeAuthority: info?.freezeAuthority || null,
  };
}

export function computeLewcrewFlags(balance) {
  const cfg = getConfig();
  return {
    token_holder: balance > 0,
    lewcrew_1m: balance >= cfg.THRESHOLD_1M,
    lewcrew_10m: balance >= cfg.THRESHOLD_10M,
    lewcrew_100m: balance >= cfg.THRESHOLD_100M,
  };
}
