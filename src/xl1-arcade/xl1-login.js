// "Sign in with XL1 wallet" (owner goal 2026-11-21: anyone with a website and an XL1 wallet can play and cash out XL1).
// The wallet (Oxyon Wallet: browser extension, or the app's built-in browser) signs a fee-free sign-in token
// (xyoSigner_signJwt, schema network.xyo.auth.signin) for a one-time challenge bound to its own address. The server
// checks it the same way GeoHackers' /verify does (canonical signature, Account.verifyJwt, every claim), so the one
// signature is both the login and the proof that the payout wallet is theirs.
//
// Accounts: a wallet already verified to a Discord account through GeoHackers signs into THAT account (same history,
// full tier). Any other wallet gets a wallet-only account "xl1:<address>" (reward-engine: wallet-only tier).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const XL1_LOGIN_PURPOSE = 'Sign in to WinLEW with this XL1 wallet';
const ATTO_PER_UNIT = 1_000_000_000_000n; // arcade units are millionths of XL1

export const normalizeXl1Address = raw => {
  const a = String(raw ?? '').trim().toLowerCase().replace(/^0x/, '');
  return /^[a-f0-9]{40}$/.test(a) ? a : null;
};
export const xl1AccountId = address => `xl1:${address}`;
/** The wallet of a wallet-only account ("xl1:<40 hex>"), else null. */
export const xl1WalletOf = id => (/^xl1:([a-f0-9]{40})$/.exec(String(id ?? '')) || [])[1] || null;
export const isWalletOnlyIdentity = id => xl1WalletOf(id) !== null;

/** A compact JWS whose signature segment is canonical 64-byte base64url (same rule as GeoHackers). */
export function isCanonicalJwtSignature(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !/^[A-Za-z0-9_-]{85}[AQgw]$/.test(parts[2])) return false;
  const bytes = Buffer.from(parts[2], 'base64url');
  return bytes.length === 64 && bytes.toString('base64url') === parts[2];
}

/** Account.verifyJwt from the XYO SDK GeoHackers already installs (no new dependency for Mole Guard). */
export const loadSdkAccount = (modulePath = process.env.XL1_ACCOUNT_SDK_MODULE) => async () => {
  if (!modulePath) throw new Error('xl1_login_unavailable');
  const sdk = await import(pathToFileURL(modulePath).href);
  if (typeof sdk.Account?.verifyJwt !== 'function') throw new Error('xl1_login_unavailable');
  return sdk.Account;
};

export function createXl1Login({ audience, loadAccount, now = Date.now, ttlMs = 300_000, maxPending = 5000 }) {
  const base = new URL(audience);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('xl1_login_audience_invalid');
  const pending = new Map();
  const claimsOf = c => ({ challengeId: c.id, nonce: c.nonce, address: c.address,
    expiresAt: new Date(c.expiresAtMs).toISOString(), purpose: XL1_LOGIN_PURPOSE, scope: 'payload:read' });
  const signingOptions = c => ({ audience, schema: 'network.xyo.auth.signin', ttl: 300, claims: claimsOf(c) });
  const sweep = t => { for (const [k, v] of pending) if (v.expiresAtMs <= t) pending.delete(k); };
  return {
    start(rawAddress) {
      const address = normalizeXl1Address(rawAddress);
      if (!address) throw new Error('xl1_address_invalid');
      const t = now(); sweep(t);
      if (pending.size >= maxPending) throw new Error('xl1_login_busy');
      const c = { id: randomUUID(), nonce: randomBytes(24).toString('hex'), address, expiresAtMs: t + ttlMs };
      pending.set(c.id, c);
      return { challengeId: c.id, address, expiresAt: new Date(c.expiresAtMs).toISOString(), signingOptions: signingOptions(c) };
    },
    async complete({ challengeId, token } = {}) {
      const t = now(), c = pending.get(String(challengeId ?? ''));
      // One attempt per challenge: a failed or replayed signature means starting again.
      if (c) pending.delete(c.id);
      if (!c || c.expiresAtMs <= t) throw new Error('xl1_login_expired');
      if (typeof token !== 'string' || token.length > 16384 || !isCanonicalJwtSignature(token)) throw new Error('xl1_signature_invalid');
      const Account = await loadAccount();
      const seconds = Math.floor(t / 1000);
      let v;
      try { v = await Account.verifyJwt(token, { audience, now: seconds }); } catch { throw new Error('xl1_signature_invalid'); }
      if (!v?.ok) throw new Error('xl1_signature_invalid');
      const { header: h, payload: p } = v, o = signingOptions(c);
      if (h.alg !== 'ES256K' || h.typ !== 'JWT' || h.kid !== c.address || p.iss !== c.address || p.schema !== o.schema ||
          p.origin !== base.origin || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) ||
          p.iat > seconds + 60 || p.exp <= seconds || p.exp <= p.iat || p.exp - p.iat > 300 ||
          Object.entries(o.claims).some(([k, val]) => p[k] !== val)) throw new Error('xl1_signature_mismatch');
      return { address: c.address, proofHash: createHash('sha256').update(token).digest('hex') };
    },
    pendingCount: () => pending.size,
  };
}

/** XL1 balance of an address in attoXL1, read from the chain RPC (mainnet for the arcade). */
export function makeXl1Balance({ rpcUrl = process.env.XL1_RPC_URL, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  return async address => {
    const a = normalizeXl1Address(address);
    if (!a || !rpcUrl) throw new Error('xl1_balance_unavailable');
    const r = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'accountBalanceViewer_qualifiedAccountBalances', params: [[a], {}] }) });
    if (!r.ok) throw new Error('xl1_balance_unavailable');
    const hex = (await r.json())?.result?.[0]?.[a];
    if (typeof hex !== 'string' || !/^(0x)?[0-9a-f]+$/i.test(hex)) throw new Error('xl1_balance_unavailable');
    return BigInt(hex.startsWith('0x') ? hex : `0x${hex}`);
  };
}
export const unitsToAtto = units => BigInt(units) * ATTO_PER_UNIT;
