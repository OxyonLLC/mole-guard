'use strict'
// status-data.js (winlew.co) must behave exactly like oxyon.io's status-data.mjs: same repos, same identity rules,
// same newest-valid-copy choice. These are the same cases as oxyon.io's tests/status-data.test.mjs.
import assert from 'node:assert/strict'
globalThis.window = globalThis
await import('./status-data.js')
const S = globalThis.XL1StatusData
const ADDR = '2152e6aec996742fb6e52ae1aad87bd44f2ccc91'
const NOW = Date.parse('2026-11-27T21:00:00Z')

assert.deepEqual([...S.STATUS_REPOS], ['xl1-status-data-2026-11', 'xl1-status-data'])
assert.equal(S.statusUrl('xl1-status-data', 'rbpi3.json'), 'https://raw.githubusercontent.com/LewSales/xl1-status-data/main/rbpi3.json')
assert.equal(S.stampOf({ generatedAt: '2026-11-27T17:34:17.900Z' }), Date.parse('2026-11-27T17:34:17.900Z'))
assert.equal(S.validCopy('windows.json', { label: 'windows', producer: { address: ADDR }, generatedAt: NOW }, NOW), true)
assert.equal(S.validCopy('windows.json', { label: 'rbpi3', producer: { address: ADDR }, generatedAt: NOW }, NOW), false)
assert.equal(S.validCopy('race-mainnet.json', { network: 'sequence', heights: [], generatedAt: NOW }, NOW), false)
assert.equal(S.validCopy('geohackers-summary.json', { schema: 'oxyon.geohackers.summary.v1', generatedAt: NOW }, NOW), true)
assert.equal(S.validCopy('windows.json', { label: 'windows', producer: { address: ADDR }, generatedAt: NOW + 11 * 60_000 }, NOW), false)
const good = { label: 'windows', producer: { address: ADDR }, generatedAt: NOW - 60_000, from: 'old' }
assert.equal(S.newestCopy([{ generatedAt: NOW, from: 'new' }, good], 'windows.json', NOW).from, 'old') // malformed never wins
assert.equal(S.newestCopy([{ ...good, generatedAt: NOW - 1000, from: 'active' }, good], 'windows.json', NOW).from, 'active')
assert.equal(S.newestCopy([{ ...good, from: 'active' }, good], 'windows.json', NOW).from, 'active') // tie: active repo
const asked = []
const got = await S.fetchStatus('race.json', async (url) => { asked.push(url); if (url.includes('2026-11')) throw new Error('404'); return { generatedAt: NOW, network: 'sequence', heights: [] } })
assert.equal(asked.length, 2); assert.equal(got.network, 'sequence')
assert.equal(await S.fetchStatus('x.json', async () => null), null)
console.log('status-data.js: parity with oxyon.io status-data.mjs ok')
