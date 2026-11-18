'use strict'

import assert from 'node:assert/strict'
await import('./telemetry-core.js')
const T = globalThis.XL1Telemetry
const now = Date.parse('2026-09-19T18:00:00Z')

assert.deepEqual(T.sourceState(null, now), { state: 'unknown', label: 'unknown', age: null })
assert.equal(T.sourceState({ generatedAt: 'not-a-date' }, now).state, 'unknown')
assert.equal(T.sourceState({ generatedAt: '2026-09-19T17:59:30Z', status: 'ok' }, now).state, 'online')
assert.equal(T.sourceState({ generatedAt: '2026-09-19T17:45:00Z', status: 'ok' }, now).state, 'stale')
assert.equal(T.sourceState({ generatedAt: '2026-09-19T17:00:00Z', status: 'ok' }, now).state, 'offline')
assert.equal(T.sourceState({ generatedAt: '2026-09-19T17:59:59Z', status: 'down' }, now).state, 'offline')
assert.equal(T.ageText(18_000), '18s ago')
assert.equal(T.value(0, String), '0')

console.log('telemetry-core tests passed')
