'use strict'

import assert from 'node:assert/strict'
await import('./telemetry-core.js')

const elements = new Map()
globalThis.window = globalThis
const events = []
globalThis.dispatchEvent = (e) => events.push(e)
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
globalThis.document = {
  hidden: false,
  addEventListener() {},
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { className: '', textContent: '', innerHTML: '', dataset: {} })
    return elements.get(id)
  },
}
globalThis.fetch = async () => { throw new Error('simulated endpoint failure') }
globalThis.setInterval = () => 0

await import('./status-data.js')
await import('./observatory.js')
const O = globalThis.XL1Observatory
const feeds = [{ label: 'Windows' }, { label: 'Raspberry Pi 3 B+' }]
const failed = feeds.map((feed) => ({ ok: false, feed }))

O.renderObservatory(failed)
O.renderProofs(failed)
assert.equal(elements.get('obs-win-status').textContent, 'unknown')
assert.equal(elements.get('obs-pi-status').textContent, 'unknown')
assert.equal(elements.get('obs-block').textContent, '—')
assert.match(elements.get('proof-list').innerHTML, /No recent verifiable activity/)
// Unreachable feeds are never shown as online.
assert.equal(elements.get('stat-network').dataset.state, 'unknown')
assert.equal(elements.get('stat-network-v').textContent, 'No telemetry')
assert.equal(elements.get('stat-win-v').textContent, 'No telemetry')
assert.equal(events.at(-1).detail.state, 'unknown')

const stale = {
  schema: 1,
  generatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  status: 'ok',
  chain: { currentBlock: 0 },
  network: { observed: { blocks: 0, toBlock: 0 }, blockTime: { meanSeconds: 0 } },
  producer: { blocks: { total: 0 }, sharePercent: 0 },
  race: { built: 0 },
  latency: { cycleP50Ms: 0, cycleP95Ms: 0 },
}
O.renderObservatory([{ ok: true, feed: feeds[0], data: stale }, failed[1]])
assert.equal(elements.get('obs-win-status').textContent, 'stale')
assert.equal(elements.get('obs-pi-status').textContent, 'unknown')
assert.equal(elements.get('obs-block').textContent, '0')
assert.equal(elements.get('stat-win-v').textContent, 'Stale')
assert.equal(events.at(-1).detail.state, 'stale')

// GeoHackers / faucet: an old feed reads as stale, a missing one as no telemetry.
O.renderGeoHackers({ ok: true, data: { schema: 'oxyon.geohackers.summary.v1', generatedAt: Date.now() - 20 * 3600e3, processed: { day: '2026-11-05', confirmed: '<5', failed: '0' }, processedByKind: { week: '2026-W44', faucet: '5-9' } } })
assert.equal(elements.get('stat-faucet-v').textContent, 'No recent telemetry')
O.renderGeoHackers({ ok: false })
assert.equal(elements.get('stat-faucet-v').textContent, 'No telemetry')

// Race card.
O.renderRace({ ok: true, data: { generatedAt: Date.now(), heightsAnalysed: 10, rankDist: { 1: 4, 2: 6 },
  board: { last1000: { FreeCryptoA: 5, 'LewSales-2': 9, 'LewSales-pi3': 2 } } } })
assert.equal(elements.get('race-leader').textContent, 'LewSales-2 · 9 wins')
assert.equal(elements.get('race-ours').textContent, 'LewSales-2 #1 · LewSales-pi3 #3')
assert.match(elements.get('race-rule').textContent, /60% of 10/)
O.renderRace({ ok: false })
assert.equal(elements.get('race-age').textContent, 'race feed unreachable')

console.log('observatory failure-state, faucet and race tests passed')
