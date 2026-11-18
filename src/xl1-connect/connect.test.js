// Connect XL1 wallet P2/P3: off by default, no Discord needed to connect, and connecting never
// makes anyone eligible on its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { getConnectConfig, inAudience } from './config.js'
import { accountRef, connectionState, makeReadVerifications, makeStartConnect } from './connect.js'
import { reviewSignals, xl1Eligibility } from './eligibility.js'
import { makeLimiter, registerXl1ConnectRoutes } from './routes.js'

const SECRET = 's'.repeat(40)
const A = 'a'.repeat(40), B = 'b'.repeat(40)
const DISCORD = '248525967377694720'
const signed = (addr, extra = {}) => ({ verificationMethod: 'xl1-jwt', xl1: { ownershipVerified: true, xl1Address: addr }, updatedAt: '2026-11-15T20:00:00.000Z', ...extra })

// ── config ──────────────────────────────────────────────────────────────────
test('everything is off by default, and a missing secret or a disabled route keeps it off', () => {
  assert.equal(getConnectConfig({}).enabled, false)
  assert.equal(getConnectConfig({ XL1_CONNECT_ENABLED: 'true' }).enabled, false, 'no secret')
  assert.equal(getConnectConfig({ XL1_CONNECT_ENABLED: 'true', XL1_CONNECT_REF_SECRET: 'short' }).enabled, false)
  assert.equal(getConnectConfig({ XL1_CONNECT_ENABLED: 'true', XL1_CONNECT_REF_SECRET: SECRET }).enabled, true)
  const onchain = getConnectConfig({ XL1_CONNECT_ENABLED: 'true', XL1_CONNECT_REF_SECRET: SECRET, XL1_ELIGIBILITY_ROUTES: 'x,onchain' })
  assert.equal(onchain.enabled, false, 'automatic on-chain eligibility is disabled by owner policy')
  assert.match(onchain.problems.join(), /onchain/)
  assert.deepEqual(getConnectConfig({ XL1_ELIGIBILITY_ROUTES: 'X, moderator' }).eligibilityRoutes, ['x', 'moderator'])
  assert.deepEqual(getConnectConfig({}).eligibilityRoutes, [])
})

test('the default audience is the trial allowlist, and an empty list means nobody', () => {
  const on = { XL1_CONNECT_ENABLED: 'true', XL1_CONNECT_REF_SECRET: SECRET }
  assert.equal(inAudience(getConnectConfig(on), 'acct-1'), false)
  assert.equal(inAudience(getConnectConfig({ ...on, XL1_CONNECT_TRIAL_ACCOUNTS: 'acct-1, acct-2' }), 'acct-2'), true)
  assert.equal(inAudience(getConnectConfig({ ...on, XL1_CONNECT_AUDIENCE: 'all' }), 'anyone'), true)
  assert.equal(inAudience(getConnectConfig({ XL1_CONNECT_AUDIENCE: 'all' }), 'anyone'), false, 'never while disabled')
})

// ── account references ──────────────────────────────────────────────────────
test('an account reference is a stable 64-hex HMAC that never contains the account id', () => {
  const r = accountRef('wallet:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', SECRET)
  assert.match(r, /^[a-f0-9]{64}$/)
  assert.equal(r, accountRef('wallet:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', SECRET))
  assert.notEqual(r, accountRef('wallet:other', SECRET))
  assert.notEqual(r, accountRef('wallet:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 't'.repeat(40)))
  assert.throws(() => accountRef('x', ''))
})

// ── connection state ────────────────────────────────────────────────────────
test('connected only with a signed record stored for exactly this reference', () => {
  const ref = accountRef('acct-1', SECRET)
  assert.deepEqual(connectionState({ ref, verifications: { users: {}, accounts: {} } }), { state: 'visitor' })
  const ok = connectionState({ ref, verifications: { users: {}, accounts: { [ref]: signed(A, { accountRef: ref }) } } })
  assert.equal(ok.state, 'connected'); assert.equal(ok.xl1Address, A)
  for (const bad of [signed(A), signed(A, { accountRef: 'f'.repeat(64) }), { ...signed(A, { accountRef: ref }), verificationMethod: 'typed' },
    { ...signed(A, { accountRef: ref }), xl1: { ownershipVerified: false, xl1Address: A } }, signed('nothex', { accountRef: ref })]) {
    assert.equal(connectionState({ ref, verifications: { users: {}, accounts: { [ref]: bad } } }).state, 'visitor')
  }
})

test('a wallet already verified to a Discord member or another account is a conflict, never connected', () => {
  const ref = accountRef('acct-1', SECRET), other = accountRef('acct-2', SECRET)
  const mine = { [ref]: signed(A, { accountRef: ref }) }
  assert.equal(connectionState({ ref, verifications: { users: { [DISCORD]: signed(A, { discordUserId: DISCORD }) }, accounts: mine } }).state, 'conflict')
  assert.equal(connectionState({ ref, verifications: { users: {}, accounts: { ...mine, [other]: signed(A, { accountRef: other }) } } }).state, 'conflict')
  assert.equal(connectionState({ ref, verifications: { users: { [DISCORD]: signed(B) }, accounts: mine } }).state, 'connected', 'a different wallet is fine')
})

test('a disconnect after the proof wins; connecting again later wins over the disconnect', () => {
  const ref = accountRef('acct-1', SECRET)
  const v = { users: {}, accounts: { [ref]: signed(A, { accountRef: ref }) } }
  assert.equal(connectionState({ ref, verifications: v, disconnectedAt: '2026-11-15T21:00:00.000Z' }).state, 'visitor')
  assert.equal(connectionState({ ref, verifications: v, disconnectedAt: '2026-11-15T19:00:00.000Z' }).state, 'connected')
})

test('an unreadable verification file fails closed', async () => {
  await assert.rejects(makeReadVerifications({ file: '' })(), /xl1_connect_unavailable/)
  await assert.rejects(makeReadVerifications({ file: 'x', readFn: async () => 'not json' })(), /xl1_connect_unavailable/)
  assert.deepEqual(await makeReadVerifications({ file: 'x', readFn: async () => '{"users":{}}' })(), { users: {}, accounts: {} })
})

// ── starting a connection ───────────────────────────────────────────────────
test('start asks GeoHackers for an account-reference session and hands back only its own verify link', async () => {
  const ref = accountRef('acct-1', SECRET)
  let sent
  const fetchFn = async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ url: 'https://winlew.co/xl1/verify/api-proxy.php/verify/abcdefghijklmnopqrstuvwxyz012345', expiresAt: 'x' }) } }
  const start = makeStartConnect({ base: 'http://127.0.0.1:8793', token: 't0ken', fetchFn })
  const out = await start(ref)
  assert.equal(out.url, 'https://winlew.co/xl1/verify/api-proxy.php/verify/abcdefghijklmnopqrstuvwxyz012345')
  assert.equal(sent.url, 'http://127.0.0.1:8793/api/web-verify-session')
  assert.deepEqual(JSON.parse(sent.init.body), { accountRef: ref, returnTo: 'https://winlew.co/xl1/' })
  assert.equal(sent.init.headers.authorization, 'Bearer t0ken')
  assert.ok(!sent.init.body.includes('acct-1'), 'the account id never leaves WinLEW')
  const evil = makeStartConnect({ token: 't', fetchFn: async () => ({ ok: true, json: async () => ({ url: 'https://evil.example/verify/abcdefghijklmnop' }) }) })
  await assert.rejects(evil(ref), /xl1_connect_unavailable/)
  const off = makeStartConnect({ token: 't', fetchFn: async () => ({ ok: false, json: async () => ({ error: 'account_refs_disabled' }) }) })
  await assert.rejects(off(ref), /xl1_connect_unavailable/)
  await assert.rejects(makeStartConnect({ token: '' , fetchFn })(ref), /xl1_connect_unavailable/)
})

// ── eligibility (P3) ────────────────────────────────────────────────────────
test("today's rule is unchanged: a Discord member with a verified wallet is eligible, nothing else changes", () => {
  assert.equal(xl1Eligibility({ accountId: DISCORD, legacyVerifiedWallet: A }).route, 'discord')
  assert.equal(xl1Eligibility({ accountId: DISCORD }).eligible, false)
})

test('connected is never eligible on its own; only an enabled, owner-approved route can make it so', () => {
  const connection = { state: 'connected', xl1Address: A }
  const base = { accountId: 'wallet:abc', connection }
  assert.deepEqual(xl1Eligibility(base), { state: 'connected', eligible: false, route: null, wallet: A, reason: 'eligibility_routes_off' })
  assert.equal(xl1Eligibility({ ...base, hasXIdentity: true }).eligible, false, 'X alone does nothing while the route is off')
  assert.equal(xl1Eligibility({ ...base, routes: ['x'], hasXIdentity: true }).route, 'x')
  assert.equal(xl1Eligibility({ ...base, routes: ['moderator'], moderatorApproval: { approved: true, wallet: A } }).route, 'moderator')
  assert.equal(xl1Eligibility({ ...base, routes: ['moderator'], moderatorApproval: { approved: true, wallet: B } }).eligible, false, 'approval is for one wallet')
  assert.equal(xl1Eligibility({ ...base, routes: ['onchain'] }).eligible, false, 'no on-chain route exists in code')
  assert.equal(xl1Eligibility({ accountId: 'wallet:abc', connection: { state: 'conflict', xl1Address: A }, routes: ['x'], hasXIdentity: true }).eligible, false)
})

test('review signals are hints for a moderator, never a decision', () => {
  const s = reviewSignals({ firstSeenAt: '2026-10-01T00:00:00Z', transferCount: 5, now: Date.parse('2026-11-15T00:00:00Z') })
  assert.equal(s.ageSignal, true); assert.equal(s.activitySignal, true)
  assert.match(s.note, /never make an account eligible/)
  assert.deepEqual(reviewSignals({}).ageSignal, null)
})

// ── routes ──────────────────────────────────────────────────────────────────
function fakeApp() {
  const routes = {}
  return { routes, get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
}
function call(app, key, { headers = {}, query = {}, body = {}, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }) } }
    Promise.resolve(app.routes[key]({ headers, query, body, ip }, res))
  })
}
const enabled = (extra = {}) => getConnectConfig({ XL1_CONNECT_ENABLED: 'true', XL1_CONNECT_REF_SECRET: SECRET, XL1_CONNECT_TRIAL_ACCOUNTS: 'acct-1', ...extra })
const sessions = { tok1: 'acct-1', tok2: 'acct-2' }

test('with the flag off every route is 404, even for a signed-in trial account', async () => {
  const app = fakeApp()
  registerXl1ConnectRoutes(app, { config: getConnectConfig({}), getAccountId: (t) => sessions[t], log: () => {} })
  for (const key of Object.keys(app.routes)) assert.equal((await call(app, key, { headers: { 'x-winlew-session': 'tok1' } })).status, 404, key)
})

test('only trial accounts see it; a session in the URL or body is refused', async () => {
  const app = fakeApp()
  registerXl1ConnectRoutes(app, { config: enabled(), getAccountId: (t) => sessions[t], startConnect: async () => ({ url: 'u' }), log: () => {} })
  assert.equal((await call(app, 'POST /api/xl1/connect/start', { headers: { 'x-winlew-session': 'tok2' } })).status, 404, 'not on the allowlist')
  assert.equal((await call(app, 'POST /api/xl1/connect/start')).status, 404, 'not signed in')
  assert.deepEqual((await call(app, 'POST /api/xl1/connect/start', { query: { session: 'tok1' } })).body, { error: 'session_in_url' })
  assert.deepEqual((await call(app, 'POST /api/xl1/connect/start', { body: { session: 'tok1' } })).body, { error: 'session_in_body' })
  const ok = await call(app, 'POST /api/xl1/connect/start', { headers: { 'x-winlew-session': 'tok1' } })
  assert.equal(ok.status, 200); assert.equal(ok.headers['cache-control'], 'no-store')
})

test('start is rate limited per account', async () => {
  const app = fakeApp()
  registerXl1ConnectRoutes(app, { config: enabled(), getAccountId: (t) => sessions[t], startConnect: async () => ({ url: 'u' }), log: () => {} })
  const codes = []
  for (let i = 0; i < 6; i++) codes.push((await call(app, 'POST /api/xl1/connect/start', { headers: { 'x-winlew-session': 'tok1' } })).status)
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429])
})

test('status: connected but not eligible, then disconnect returns the account to visitor', async () => {
  const ref = accountRef('acct-1', SECRET)
  const store = {}
  const app = fakeApp()
  registerXl1ConnectRoutes(app, {
    config: enabled(), getAccountId: (t) => sessions[t], log: () => {},
    readVerifications: async () => ({ users: {}, accounts: { [ref]: signed(A, { accountRef: ref }) } }),
    readJson: (n, d) => store[n] ?? d, writeJson: (n, v) => { store[n] = v },
  })
  const h = { headers: { 'x-winlew-session': 'tok1' } }
  const s1 = await call(app, 'GET /api/xl1/connect/status', h)
  assert.deepEqual({ state: s1.body.state, eligible: s1.body.eligible, xl1Address: s1.body.xl1Address }, { state: 'connected', eligible: false, xl1Address: A })
  assert.equal((await call(app, 'POST /api/xl1/connect/disconnect', h)).body.ok, true)
  const s2 = await call(app, 'GET /api/xl1/connect/status', h)
  assert.equal(s2.body.state, 'visitor')
})

test('status fails closed when the verification file cannot be read', async () => {
  const app = fakeApp()
  registerXl1ConnectRoutes(app, { config: enabled(), getAccountId: (t) => sessions[t], log: () => {}, readVerifications: async () => { throw new Error('x') } })
  assert.equal((await call(app, 'GET /api/xl1/connect/status', { headers: { 'x-winlew-session': 'tok1' } })).status, 503)
})

test('the limiter resets after its window', () => {
  let t = 0
  const lim = makeLimiter({ windowMs: 1000, max: 2, now: () => t })
  assert.deepEqual([lim('k'), lim('k'), lim('k')], [true, true, false])
  t = 1000
  assert.equal(lim('k'), true)
})
