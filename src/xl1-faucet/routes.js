// "Claim XL1" for the WinLEW app (winlew.co/app): the GeoHackers XL1 faucet, without Discord commands.
//
//   GET  /api/xl1-faucet/status   -> { wallet, faucet }  the signed-in member's verified XL1 wallet + the faucet's terms
//   POST /api/xl1-faucet/claim    -> GeoHackers' answer (amount, txHash, explorer) or its refusal
//
// Off unless XL1_FAUCET_WEB_ENABLED=true AND GEOHACKERS_FAUCET_CLAIM_TOKEN is set (>= 32 chars): every route
// answers 404 otherwise, and the app hides the card.
//
// What this module never decides: the wallet (always the member's VERIFIED XL1 wallet, from GeoHackers'
// own verification records), the amount, the cooldown, the daily cap, the pause and the block list. Those
// are all GeoHackers' /claim, the same path the Discord /faucet command uses, so a claim from the app and
// one from Discord share one limit. The session travels only in the x-winlew-session header.

export const MIN_CLAIM_TOKEN = 32

export function getFaucetWebConfig(env = process.env) {
  const token = String(env.GEOHACKERS_FAUCET_CLAIM_TOKEN ?? '').trim()
  const requested = String(env.XL1_FAUCET_WEB_ENABLED ?? '').trim().toLowerCase() === 'true'
  return Object.freeze({
    enabled: requested && token.length >= MIN_CLAIM_TOKEN,
    token,
    apiBase: String(env.GEOHACKERS_API_LOCAL_URL || 'http://127.0.0.1:8791').trim().replace(/\/$/, ''),
  })
}

const isDiscordId = (id) => /^\d{17,20}$/.test(String(id ?? ''))

export function registerXl1FaucetRoutes(app, {
  config = getFaucetWebConfig(),
  getAccountId,                       // (sessionToken) => Discord user id | null
  getVerifiedWallet,                  // async (discordUserId) => XL1 address | null (throws if records unreadable)
  fetchFn = fetch,
  rateLimit = (_req, _res, next) => next(),
  log = (line) => console.log(`[xl1-faucet-web] ${line}`),
} = {}) {
  const notFound = (res) => res.status(404).json({ error: 'not_found' })
  const send = (res, status, body) => { res.setHeader('cache-control', 'no-store'); res.status(status).json(body) }

  function caller(req, res) {
    if (!config.enabled) { notFound(res); return null }
    if (req.query && 'session' in req.query) { send(res, 400, { error: 'session_in_url' }); return null }
    const token = String(req.headers?.['x-winlew-session'] ?? '').trim()
    const id = token ? getAccountId(token) : null
    if (!id) { send(res, 401, { error: 'sign_in_required' }); return null }
    if (!isDiscordId(id)) { send(res, 403, { error: 'discord_required', message: 'The XL1 faucet is for Discord members who verified an XL1 wallet. Sign in with Discord.' }); return null }
    return String(id)
  }

  async function walletFor(res, id) {
    try {
      const wallet = await getVerifiedWallet(id)
      if (!wallet) { send(res, 409, { error: 'verify_required', message: 'Verify an XL1 wallet first, with GeoHackers /verify or on winlew.co/xl1/verify.' }); return null }
      return wallet
    } catch {
      send(res, 503, { error: 'verification_unavailable', message: 'Verification records could not be read. Try again shortly.' }); return null
    }
  }

  const short = (w) => `${String(w).slice(0, 6)}…${String(w).slice(-4)}`

  app.get('/api/xl1-faucet/status', rateLimit, async (req, res) => {
    const id = caller(req, res); if (!id) return
    let wallet = null
    try { wallet = await getVerifiedWallet(id) } catch { /* shown as unknown */ }
    let faucet = null
    try {
      const r = await fetchFn(`${config.apiBase}/faucet/info`, { signal: AbortSignal.timeout(8_000) })
      if (r.ok) {
        const j = await r.json()
        faucet = { target: j.target, cooldownHours: j.cooldownHours, amount: j.amount, tiers: j.tiers ?? null }
      }
    } catch { /* faucet terms unknown; the claim still decides */ }
    send(res, 200, { wallet: wallet ? short(wallet) : null, verified: Boolean(wallet), faucet })
  })

  app.post('/api/xl1-faucet/claim', rateLimit, async (req, res) => {
    const id = caller(req, res); if (!id) return
    if (req.body && typeof req.body === 'object' && ('wallet' in req.body || 'amount' in req.body || 'discordUserId' in req.body)) {
      return send(res, 400, { error: 'not_accepted', message: 'The wallet and amount are not chosen by the page.' })
    }
    const wallet = await walletFor(res, id); if (!wallet) return
    let r
    try {
      r = await fetchFn(`${config.apiBase}/claim`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
        // A signed verification record is exactly what the "Verified Wallets" role stands for.
        body: JSON.stringify({ wallet, discordUserId: id, tier: 'verified_wallet' }),
      })
    } catch {
      // No answer: the claim may or may not have been sent. GeoHackers keeps the cooldown either way.
      log(`claim for ${id.slice(0, 4)}… got no answer`)
      return send(res, 504, { error: 'no_answer', message: 'The faucet did not answer. Check your wallet before trying again.' })
    }
    const body = await r.json().catch(() => ({}))
    log(`claim ${r.status} ${body?.error ?? 'ok'}`)
    if (r.ok) {
      return send(res, 201, { ok: true, amount: body.amount ?? null, txHash: body.txHash ?? null, explorer: body.explorer ?? null, wallet: short(wallet) })
    }
    // GeoHackers' refusal, passed through with its own message (cooldown, cap, pause, block, tier).
    return send(res, [403, 409, 429, 503].includes(r.status) ? r.status : 502, {
      ok: false, error: body?.error ?? 'claim_failed', message: body?.message ?? 'The faucet refused this claim.',
      ...(body?.retryAfterSec ? { retryAfterSec: body.retryAfterSec } : {}),
    })
  })
}
