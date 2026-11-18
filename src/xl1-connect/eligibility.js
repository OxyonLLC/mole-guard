// Connect XL1 wallet, P3: the Visitor / Connected / Eligible answer for an account.
//
// Owner policy (2026-11-15):
// - Connecting a wallet never grants rewards. Connected is worth nothing payable.
// - No retroactive rewards for Connected-only activity.
// - Eligibility routes that may be designed: 'x' (an X-linked account) and 'moderator' (a moderator's
//   approval). Automatic on-chain eligibility stays DISABLED (config refuses 'onchain').
// - No 50% cap: nothing here touches caps or amounts.
// - The 30-day history / 3-transfer thresholds are REVIEW SIGNALS only, shown to a moderator, never
//   deciding anything here.
//
// With XL1_ELIGIBILITY_ROUTES empty (the default), the answer for every account is exactly today's
// rule: a Discord account with a signature-verified XL1 wallet (read by the arcade as before), and
// nothing for anyone else. The arcade does NOT call this module yet; wiring it in is a later,
// owner-approved change.

export const STATES = Object.freeze({ VISITOR: 'visitor', CONNECTED: 'connected', ELIGIBLE: 'eligible' })

const isDiscordId = (id) => /^\d{17,20}$/.test(String(id ?? ''))

/**
 * @param {object} p
 * @param {string} p.accountId                 the WinLEW account
 * @param {string|null} p.legacyVerifiedWallet today's answer: the Discord-verified XL1 wallet, or null
 * @param {{state:string,xl1Address?:string}} p.connection  connectionState() from connect.js
 * @param {string[]} p.routes                  enabled eligibility routes (config.eligibilityRoutes)
 * @param {boolean} p.hasXIdentity             the account has a synced X identity (WinLEW's canBePaid data)
 * @param {{approved:boolean,wallet:string}|null} p.moderatorApproval  a recorded moderator approval
 * @returns {{state:string, eligible:boolean, route:string|null, wallet:string|null, reason:string}}
 */
export function xl1Eligibility({ accountId, legacyVerifiedWallet = null, connection = { state: 'visitor' }, routes = [], hasXIdentity = false, moderatorApproval = null }) {
  // Today's rule first, and unchanged: Discord + a signature-verified wallet.
  if (isDiscordId(accountId) && legacyVerifiedWallet) {
    return { state: STATES.ELIGIBLE, eligible: true, route: 'discord', wallet: legacyVerifiedWallet, reason: 'discord_verified' }
  }
  if (connection.state === 'conflict') {
    return { state: STATES.VISITOR, eligible: false, route: null, wallet: null, reason: 'wallet_verified_elsewhere' }
  }
  if (connection.state !== 'connected' || !connection.xl1Address) {
    return { state: STATES.VISITOR, eligible: false, route: null, wallet: null, reason: 'not_connected' }
  }
  const wallet = connection.xl1Address
  // Connected. Only an enabled, owner-approved route can make it eligible.
  if (routes.includes('x') && hasXIdentity) {
    return { state: STATES.ELIGIBLE, eligible: true, route: 'x', wallet, reason: 'x_linked' }
  }
  if (routes.includes('moderator') && moderatorApproval?.approved === true && moderatorApproval.wallet === wallet) {
    return { state: STATES.ELIGIBLE, eligible: true, route: 'moderator', wallet, reason: 'moderator_approved' }
  }
  return { state: STATES.CONNECTED, eligible: false, route: null, wallet, reason: routes.length ? 'no_route_met' : 'eligibility_routes_off' }
}

/**
 * Review signals for a moderator (never a decision): how long the wallet has been active on chain,
 * and how many transfers it has. Computed from observed data (oxyon.io v1), so they are hints.
 * Thresholds are the owner's experimental 30 days / 3 transfers.
 */
export function reviewSignals({ firstSeenAt = null, transferCount = null, now = Date.now() } = {}) {
  const ageDays = firstSeenAt ? Math.floor((now - Date.parse(firstSeenAt)) / 86_400_000) : null
  return {
    observedAgeDays: Number.isFinite(ageDays) ? ageDays : null,
    observedTransfers: Number.isFinite(transferCount) ? transferCount : null,
    ageSignal: Number.isFinite(ageDays) ? ageDays >= 30 : null,
    activitySignal: Number.isFinite(transferCount) ? transferCount >= 3 : null,
    note: 'Observed data, for a moderator to weigh. These signals never make an account eligible by themselves.',
  }
}
