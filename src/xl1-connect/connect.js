// Connect XL1 wallet, P2: prove control of an XL1 wallet for a WinLEW account, with no Discord.
//
// Ownership is proven by GeoHackers' existing verify service (GeoHackers PR #67, behind
// XL1_VERIFY_ACCOUNT_REFS): WinLEW asks it for a verify session for an opaque account reference,
// the person signs in their own wallet on GeoHackers' page, and the bot stores the signed result
// under `accounts[ref]` in its verification file. WinLEW never parses an XL1 signature, never sees
// a key, and never sends its account ids to the bot (only the HMAC reference).
//
// Replay protection comes from that session: single use, a fresh nonce, a short expiry, bound to
// the reference and to the page's audience. WinLEW adds: header-only sessions, the trial audience,
// rate limits, and refusing a wallet that is already verified to someone else.

import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const VERIFY_BASE = 'https://winlew.co/xl1/verify/api-proxy.php'
const RETURN_TO = 'https://winlew.co/xl1/'
const XL1_ADDRESS = /^[a-f0-9]{40}$/

/** The opaque reference GeoHackers stores for a WinLEW account: HMAC-SHA256(secret, id), hex. */
export function accountRef(accountId, secret) {
  if (!secret) throw new Error('xl1_connect_unavailable')
  return createHmac('sha256', secret).update(`winlew-account:${String(accountId)}`).digest('hex')
}

const signedRecord = (r) => (['xl1-jwt', 'xl1-boundwitness'].includes(r?.verificationMethod) && r?.xl1?.ownershipVerified === true)
const addressOf = (r) => {
  const a = String(r?.xl1?.xl1Address ?? '').trim().replace(/^0x/i, '').toLowerCase()
  return XL1_ADDRESS.test(a) ? a : null
}

/** Ask GeoHackers for a verify session for this account's reference. Returns { url, expiresAt }. */
export function makeStartConnect({
  base = process.env.GEOHACKERS_VERIFY_LOCAL_URL || 'http://127.0.0.1:8793',
  token = process.env.GEOHACKERS_WEB_VERIFY_TOKEN || '',
  verifyBase = process.env.XL1_VERIFY_PUBLIC_BASE || VERIFY_BASE,
  returnTo = process.env.XL1_CONNECT_RETURN_URL || RETURN_TO,
  fetchFn = fetch,
} = {}) {
  const url = `${String(base).trim().replace(/\/$/, '')}/api/web-verify-session`
  const prefix = `${String(verifyBase).trim().replace(/\/$/, '')}/verify/`
  const verifyLink = (link) => typeof link === 'string' && link.startsWith(prefix) && /^[A-Za-z0-9_-]{16,64}$/.test(link.slice(prefix.length))
  return async function startConnect(ref) {
    if (!/^[a-f0-9]{64}$/.test(String(ref))) throw new Error('xl1_connect_unavailable')
    if (!String(token).trim()) throw new Error('xl1_connect_unavailable')
    let response
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${String(token).trim()}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ accountRef: ref, returnTo }),
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new Error('xl1_connect_unavailable')
    }
    const body = await response.json().catch(() => ({}))
    // account_refs_disabled from the bot means its side of the trial is off: say "unavailable".
    if (!response.ok || !verifyLink(body.url)) throw new Error('xl1_connect_unavailable')
    return { url: body.url, expiresAt: body.expiresAt }
  }
}

/** Read the bot's verification file. A missing or unreadable file fails closed (unavailable). */
export function makeReadVerifications({ file = process.env.XL1_VERIFICATION_FILE, readFn = readFile } = {}) {
  return async function readVerifications() {
    if (!file) throw new Error('xl1_connect_unavailable')
    try {
      const db = JSON.parse(await readFn(file, 'utf8'))
      return { users: db?.users ?? {}, accounts: db?.accounts ?? {} }
    } catch {
      throw new Error('xl1_connect_unavailable')
    }
  }
}

/**
 * The account's connection, from the bot's file and WinLEW's own disconnect marks.
 *   { state: 'visitor' }                                    nothing proven
 *   { state: 'connected', xl1Address, method, verifiedAt }  a signed proof for this account
 *   { state: 'conflict', xl1Address }                        the wallet is verified to a Discord member,
 *                                                            or to another account: never used here
 * A disconnect made after the proof wins; a newer proof (the person connected again) wins over it.
 */
export function connectionState({ ref, verifications, disconnectedAt = null }) {
  const record = verifications.accounts?.[ref]
  if (!record || record.accountRef !== ref || !signedRecord(record)) return { state: 'visitor' }
  const xl1Address = addressOf(record)
  const verifiedAt = Date.parse(record.updatedAt)
  if (!xl1Address || !Number.isFinite(verifiedAt)) return { state: 'visitor' }
  if (disconnectedAt && Date.parse(disconnectedAt) >= verifiedAt) return { state: 'visitor' }
  // One wallet, one owner: a Discord member's verified wallet, or another account's, is a conflict.
  const elsewhere = Object.values(verifications.users ?? {}).some((u) => signedRecord(u) && addressOf(u) === xl1Address)
    || Object.entries(verifications.accounts ?? {}).some(([otherRef, a]) => otherRef !== ref && signedRecord(a) && addressOf(a) === xl1Address)
  if (elsewhere) return { state: 'conflict', xl1Address }
  return { state: 'connected', xl1Address, method: record.verificationMethod, verifiedAt: record.updatedAt }
}
