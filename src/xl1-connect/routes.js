// Connect XL1 wallet, P2 routes. Every route answers 404 unless XL1_CONNECT_ENABLED is on AND the
// signed-in account is in the audience (the private trial allowlist by default).
//
//   POST /api/xl1/connect/start        → { url, expiresAt }: GeoHackers' verify page for this account
//   GET  /api/xl1/connect/status       → { state, eligible, xl1Address?, reason }
//   POST /api/xl1/connect/disconnect   → { ok: true }: stops using the wallet for this account
//
// Sessions: ONLY the x-winlew-session header. A session in the query string or the body is refused
// (400 session_in_url / session_in_body), because URLs end up in logs, history and Referer headers.

import { getConnectConfig, inAudience } from './config.js'
import { accountRef, connectionState, makeReadVerifications, makeStartConnect } from './connect.js'
import { xl1Eligibility } from './eligibility.js'

const DISCONNECT_FILE = 'xl1_connect_disconnects.json'

/** A small fixed-window limiter keyed by any string (per account, per client). */
export function makeLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map()
  return (key) => {
    const t = now()
    const row = hits.get(key)
    if (!row || t - row.start >= windowMs) { hits.set(key, { start: t, n: 1 }); return true }
    row.n += 1
    return row.n <= max
  }
}

export function registerXl1ConnectRoutes(app, {
  config = getConnectConfig(),
  getAccountId,                 // (sessionToken) => account id | null   (WinLEW's getSession)
  getLegacyVerifiedWallet = async () => null,
  hasXIdentity = () => false,
  getModeratorApproval = () => null,
  startConnect = makeStartConnect(),
  readVerifications = makeReadVerifications(),
  readJson,                     // WinLEW storage (disconnect marks)
  writeJson,
  clientKey = (req) => String(req.ip ?? ''),
  log = (line) => console.log(`[xl1-connect] ${line}`),
} = {}) {
  if (config.problems.length) log(`off: ${config.problems.join('; ')}`)
  const perAccountStart = makeLimiter({ windowMs: 60 * 60_000, max: 5 })
  const perClientStart = makeLimiter({ windowMs: 10 * 60_000, max: 10 })
  const perAccountStatus = makeLimiter({ windowMs: 60_000, max: 30 })

  const notFound = (res) => res.status(404).json({ error: 'not_found' })
  const fail = (res, status, error) => { res.setHeader('cache-control', 'no-store'); res.status(status).json({ error }) }

  // Resolve the caller, or answer 404 (feature invisible) / 400 (unsafe session transport).
  function caller(req, res) {
    if (!config.enabled) { notFound(res); return null }
    if (req.query && 'session' in req.query) { fail(res, 400, 'session_in_url'); return null }
    if (req.body && typeof req.body === 'object' && 'session' in req.body) { fail(res, 400, 'session_in_body'); return null }
    const token = String(req.headers?.['x-winlew-session'] ?? '').trim()
    const accountId = token ? getAccountId(token) : null
    if (!accountId || !inAudience(config, accountId)) { notFound(res); return null }
    return { accountId: String(accountId), ref: accountRef(accountId, config.secret) }
  }

  const disconnects = () => (readJson ? readJson(DISCONNECT_FILE, {}) : {})

  app.post('/api/xl1/connect/start', async (req, res) => {
    const who = caller(req, res); if (!who) return
    if (!perAccountStart(who.accountId) || !perClientStart(clientKey(req))) return fail(res, 429, 'rate_limited')
    try {
      const out = await startConnect(who.ref)
      log(`start account=${who.ref.slice(0, 12)}…`)
      res.setHeader('cache-control', 'no-store')
      res.json(out)
    } catch { fail(res, 503, 'xl1_connect_unavailable') }
  })

  app.get('/api/xl1/connect/status', async (req, res) => {
    const who = caller(req, res); if (!who) return
    if (!perAccountStatus(who.accountId)) return fail(res, 429, 'rate_limited')
    try {
      const verifications = await readVerifications()
      const connection = connectionState({ ref: who.ref, verifications, disconnectedAt: disconnects()[who.ref] ?? null })
      const answer = xl1Eligibility({
        accountId: who.accountId,
        legacyVerifiedWallet: await getLegacyVerifiedWallet(who.accountId),
        connection,
        routes: config.eligibilityRoutes,
        hasXIdentity: Boolean(hasXIdentity(who.accountId)),
        moderatorApproval: getModeratorApproval(who.accountId),
      })
      res.setHeader('cache-control', 'no-store')
      res.json({
        state: answer.state,
        eligible: answer.eligible,
        reason: answer.reason,
        ...(connection.xl1Address ? { xl1Address: connection.xl1Address } : {}),
        ...(connection.state === 'connected' ? { verifiedAt: connection.verifiedAt } : {}),
      })
    } catch { fail(res, 503, 'xl1_connect_unavailable') }
  })

  app.post('/api/xl1/connect/disconnect', async (req, res) => {
    const who = caller(req, res); if (!who) return
    if (!readJson || !writeJson) return fail(res, 503, 'xl1_connect_unavailable')
    const marks = disconnects()
    marks[who.ref] = new Date().toISOString()
    writeJson(DISCONNECT_FILE, marks)
    log(`disconnect account=${who.ref.slice(0, 12)}…`)
    res.setHeader('cache-control', 'no-store')
    res.json({ ok: true })
  })
}
