// The "New to XL1? Start here" guide (2026-10-24 onboarding sprint): its choices, and what the
// pages promise. Copy that names a reward rule is filled from the live config by arcade.js, so the
// static text is only a fallback; these tests pin the links and the safety wording.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// The page script registers itself on globalThis (it is a plain browser script, like shell.js).
await import('../src/public/xl1/shared/onboarding.js')
const O = globalThis.XL1Onboarding
const page = (p) => fs.readFileSync(new URL(`../src/public/${p}`, import.meta.url), 'utf8')
const INVITE = 'https://discord.gg/PSCrBzqdbE'

test('the wallet options shown first follow the device', () => {
  assert.equal(O.platformOf('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/129 Mobile'), 'android')
  assert.equal(O.platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), 'iphone')
  assert.equal(O.platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129'), 'desktop')
  assert.equal(O.platformOf(''), 'desktop')
})

test('open for newcomers, closed once verified, and a visitor\'s own choice wins', () => {
  assert.equal(O.initialOpen({ stored: null, account: null }), false, 'waits for the account: no jump for returning players')
  assert.equal(O.initialOpen({ stored: null, account: 'signed-out' }), true)
  assert.equal(O.initialOpen({ stored: null, account: 'needs-wallet' }), true)
  assert.equal(O.initialOpen({ stored: null, account: 'unknown' }), true, 'opens when no answer comes')
  assert.equal(O.initialOpen({ stored: null, account: 'ready' }), false)
  assert.equal(O.initialOpen({ stored: null, account: 'unavailable', knownVerified: true }), false, 'a verified player stays shut when the check fails')
  assert.equal(O.initialOpen({ stored: 'closed', account: 'signed-out' }), false)
  assert.equal(O.initialOpen({ stored: 'open', account: 'ready' }), true)
})

test('arcade.js fills the guide from the live config and tells it the account state', () => {
  const js = page('xl1/arcade/arcade.js')
  for (const c of ['.hold-tiers-copy', '.rate-copy', '.age-copy', '.age-rule', '.cap-copy', '.round-cap-minutes']) assert.ok(js.includes(c), `arcade.js fills ${c}`)
  assert.match(js, /CustomEvent\('wl:account'/)
})

test('the step follows the account', () => {
  assert.equal(O.currentStep('signed-out'), 1)
  assert.equal(O.currentStep('needs-wallet'), 2)
  assert.equal(O.currentStep('wallet-login'), 2)
  assert.equal(O.currentStep('ready'), 3)
})

test('the arcade guide: three steps, every platform, only known wallet links', () => {
  const html = page('xl1/arcade/index.html')
  const guide = html.slice(html.indexOf('<details class="start-guide" id="start">'), html.indexOf('</details>', html.indexOf('id="start"')))
  assert.ok(guide.length > 1000, 'the guide is on the page')
  for (const n of [1, 2, 3]) assert.match(guide, new RegExp(`data-step="${n}"`))
  for (const p of ['android', 'desktop', 'iphone']) { assert.match(guide, new RegExp(`data-platform-tab="${p}"`)); assert.match(guide, new RegExp(`data-platform-panel="${p}"`)) }
  const allowed = new Set([
    'https://oxyon.io/wallet/android/', 'https://wallet.oxyon.io/', INVITE,
    'https://chromewebstore.google.com/detail/xl1-wallet/fblbagcjeigmhakkfgjpdlcapcgmcfbm',
    'https://chromewebstore.google.com/detail/dmppahjigfpdddppjhnekgealjbkbljn',
    'https://chromewebstore.google.com/detail/lbkakkiebconkjonncikmaaefldkaggh',
  ])
  for (const [, href] of guide.matchAll(/href="(https?:[^"]+)"/g)) assert.ok(allowed.has(href), `unexpected link in the guide: ${href}`)
  // Honest wording: Oxyon is not XYO's wallet, connected is not verified, nothing asks for secrets.
  assert.match(guide, /By XYO Network: the official XL1 wallet/)
  assert.match(guide, /not XYO Network/)
  assert.match(guide, /isn't verified/)
  assert.match(guide, /never ask for your recovery phrase or private key/)
  assert.match(guide, /Under consideration, not available today/)
  // Rule values are filled from the live config (arcade.js).
  for (const c of ['rate-copy', 'cap-copy', 'hold-tiers-copy', 'age-copy', 'round-cap-minutes']) assert.match(guide, new RegExp(`class="${c}"`))
})

test('one Discord invite everywhere on the XL1 pages, and not the old one', () => {
  for (const p of ['xl1/index.html', 'xl1/arcade/index.html', 'xl1/geohackers/index.html', 'xl1/verify/index.html', 'xl1/shared/shell.js', 'xl1/arcade/arcade.js']) {
    const s = page(p)
    assert.ok(!s.includes('dJ7rPhy333'), `${p} still has the old invite`)
    for (const [, code] of s.matchAll(/discord\.gg\/([A-Za-z0-9]+)/g)) assert.equal(code, 'PSCrBzqdbE', `${p} links another invite`)
  }
  assert.ok(page('xl1/arcade/index.html').includes('<div class="community-band">'))
  assert.ok(page('xl1/index.html').includes(`href="${INVITE}"`))
})

test('the hub links into the guide', () => {
  const hub = page('xl1/index.html')
  assert.match(hub, /href="\/xl1\/arcade\/#start"/)
  assert.match(hub, /New to XL1\? Start here\./)
})
