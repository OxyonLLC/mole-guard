// "Claim XL1" on winlew.co/app: off by default; the wallet and amount are never the page's to choose.
import test from 'node:test'
import assert from 'node:assert/strict'
import { getFaucetWebConfig, registerXl1FaucetRoutes } from './routes.js'

const ID = '248525967377694720'
const WALLET = 'a93047aabbccddeeff00112233445566778653ea'
const TOKEN = 't'.repeat(40)

function harness({ enabled = true, wallet = WALLET, walletThrows = false, reply = { status: 201, body: { ok: true, amount: '10', txHash: 'abc', explorer: 'https://x' } }, fetchThrows = false } = {}) {
  const routes = {}
  const app = { get: (p, ...h) => { routes['GET ' + p] = h.at(-1) }, post: (p, ...h) => { routes['POST ' + p] = h.at(-1) } }
  const calls = []
  registerXl1FaucetRoutes(app, {
    config: getFaucetWebConfig({ XL1_FAUCET_WEB_ENABLED: enabled ? 'true' : 'false', GEOHACKERS_FAUCET_CLAIM_TOKEN: TOKEN, GEOHACKERS_API_LOCAL_URL: 'http://gh' }),
    getAccountId: (t) => ({ good: ID, walletonly: 'wallet:abc' }[t] ?? null),
    getVerifiedWallet: async () => { if (walletThrows) throw new Error('x'); return wallet },
    fetchFn: async (url, init) => {
      calls.push({ url, init })
      if (fetchThrows) throw new Error('timeout')
      if (url.endsWith('/faucet/info')) return { ok: true, json: async () => ({ target: 'mainnet', cooldownHours: 24, amount: '10' }) }
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body }
    },
    log: () => {},
  })
  const run = async (method, path, { session, query = {}, body } = {}) => {
    const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await routes[`${method} ${path}`]({ headers: session ? { 'x-winlew-session': session } : {}, query, body }, res)
    return res
  }
  return { run, calls }
}

test('off unless enabled AND a 32+ char claims token: every route 404s', async () => {
  const h = harness({ enabled: false })
  assert.equal((await h.run('POST', '/api/xl1-faucet/claim', { session: 'good' })).code, 404)
  assert.equal((await h.run('GET', '/api/xl1-faucet/status', { session: 'good' })).code, 404)
  assert.equal(getFaucetWebConfig({ XL1_FAUCET_WEB_ENABLED: 'true', GEOHACKERS_FAUCET_CLAIM_TOKEN: 'short' }).enabled, false)
  assert.equal(h.calls.length, 0)
})

test('session only in the header; sign-in and a Discord account are required', async () => {
  const h = harness()
  assert.equal((await h.run('POST', '/api/xl1-faucet/claim', { query: { session: 'good' } })).code, 400)
  assert.equal((await h.run('POST', '/api/xl1-faucet/claim', {})).code, 401)
  assert.equal((await h.run('POST', '/api/xl1-faucet/claim', { session: 'walletonly' })).code, 403)
  assert.equal(h.calls.length, 0)
})

test('an unverified member is sent to verify; nothing is claimed', async () => {
  const h = harness({ wallet: null })
  const r = await h.run('POST', '/api/xl1-faucet/claim', { session: 'good' })
  assert.equal(r.code, 409); assert.equal(r.body.error, 'verify_required'); assert.equal(h.calls.length, 0)
  assert.equal((await harness({ walletThrows: true }).run('POST', '/api/xl1-faucet/claim', { session: 'good' })).code, 503)
})

test('the page cannot choose the wallet, the amount or the member', async () => {
  const h = harness()
  for (const body of [{ wallet: 'f'.repeat(40) }, { amount: '1000' }, { discordUserId: '1' }]) {
    assert.equal((await h.run('POST', '/api/xl1-faucet/claim', { session: 'good', body })).code, 400)
  }
  assert.equal(h.calls.length, 0)
})

test('a claim pays the VERIFIED wallet via GeoHackers /claim with the claims token', async () => {
  const h = harness()
  const r = await h.run('POST', '/api/xl1-faucet/claim', { session: 'good' })
  assert.equal(r.code, 201); assert.equal(r.body.txHash, 'abc')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].url, 'http://gh/claim')
  assert.equal(h.calls[0].init.headers.authorization, `Bearer ${TOKEN}`)
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { wallet: WALLET, discordUserId: ID, tier: 'verified_wallet' })
  assert.equal(r.headers['cache-control'], 'no-store')
})

test('GeoHackers refusals pass through with their message (shared cooldown, cap, pause, block)', async () => {
  const h = harness({ reply: { status: 429, body: { ok: false, error: 'cooldown_active', message: 'This member already claimed recently. Try again in 3h.' } } })
  const r = await h.run('POST', '/api/xl1-faucet/claim', { session: 'good' })
  assert.equal(r.code, 429); assert.equal(r.body.error, 'cooldown_active'); assert.match(r.body.message, /already claimed/)
})

test('no answer from the faucet is reported as unknown, not as a failure to retry', async () => {
  const r = await harness({ fetchThrows: true }).run('POST', '/api/xl1-faucet/claim', { session: 'good' })
  assert.equal(r.code, 504); assert.equal(r.body.error, 'no_answer')
})

test('status shows the verified wallet (shortened) and the faucet terms', async () => {
  const r = await harness().run('GET', '/api/xl1-faucet/status', { session: 'good' })
  assert.equal(r.code, 200); assert.equal(r.body.verified, true); assert.equal(r.body.wallet, 'a93047…53ea')
  assert.equal(r.body.faucet.cooldownHours, 24)
})
