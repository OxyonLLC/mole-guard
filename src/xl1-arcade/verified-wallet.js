import { readFile } from 'node:fs/promises';
import { normalizeWallet } from './reward-engine.js';

// GeoHackers' bot store is written only after the wallet challenge succeeds.
// Discovery/anchoring of a typed address alone is not an ownership proof.
// Since the Oxyon Wallet sign-in (2026-10) a record says how it was proven
// (verificationMethod xl1-jwt or xl1-boundwitness, with xl1.ownershipVerified);
// older records carry xl1.mode 'wallet-signature' instead. Both are signatures.
const SIGNED_METHODS = new Set(['xl1-jwt', 'xl1-boundwitness']);
const signedRecord = record => (SIGNED_METHODS.has(record.verificationMethod) && record.xl1?.ownershipVerified === true)
  || (record.xl1?.mode === 'wallet-signature' && record.xl1?.source === 'xl1-wallet-signature');

export function verifiedXl1Wallet(database, identityId) {
  const record = database?.users?.[String(identityId)];
  if (!record || record.discordUserId !== String(identityId)) return null;
  if (!signedRecord(record)) return null;
  if (!record.updatedAt || !Number.isFinite(Date.parse(record.updatedAt))) return null;
  return normalizeWallet(record.xl1.xl1Address);
}

export async function getVerifiedXl1Wallet(identityId, file = process.env.XL1_VERIFICATION_FILE) {
  if (!file) return null;
  try {
    return verifiedXl1Wallet(JSON.parse(await readFile(file, 'utf8')), identityId);
  } catch {
    throw new Error('xl1_verification_unavailable');
  }
}

/** The Discord account a signed GeoHackers record links to this XL1 wallet, or null (used by "Sign in with XL1 wallet":
 *  a wallet already verified to Discord signs into that Discord account). The newest record wins if there are several. */
export function discordIdForXl1Wallet(database, address) {
  const a = normalizeWallet(address);
  if (!a) return null;
  let best = null;
  for (const [id, record] of Object.entries(database?.users ?? {})) {
    if (!record || record.discordUserId !== id || !signedRecord(record)) continue;
    if (normalizeWallet(record.xl1?.xl1Address) !== a) continue;
    const at = Date.parse(record.updatedAt);
    if (Number.isFinite(at) && (!best || at > best.at)) best = { id, at };
  }
  return best ? best.id : null;
}

export async function getDiscordIdForXl1Wallet(address, file = process.env.XL1_VERIFICATION_FILE) {
  if (!file) return null;
  try { return discordIdForXl1Wallet(JSON.parse(await readFile(file, 'utf8')), address); }
  catch { return null; }
}
