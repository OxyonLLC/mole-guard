// The airdrop sender's pure parts: never pay twice, batching, SOL estimate, snapshot checks, hashing parity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { journalState, planBatches, lamportsNeeded, snapshotProblems, xyoHash, base58, SNAPSHOT_SCHEMA } from '../../src/scripts/airdrop-send.mjs'

const W = ['a', 'b', 'c', 'd', 'e'].map((c) => 'Rcpt' + c.padEnd(40, 'z'))
const T = 'Treasury'.padEnd(44, 'z')
const snap = (over = {}) => ({ schema: SNAPSHOT_SCHEMA, token: { mint: 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump', decimals: 6 }, treasury: T,
  recipients: W.map((wallet) => ({ wallet, amountRaw: '10000000000' })), totals: { recipients: 5, amountRaw: '50000000000' }, ...over })

test('journal: finalized pays, failed/expired allow retry, anything else is unknown', () => {
  const s = journalState([
    { signature: 's1', status: 'submitted', wallets: [W[0], W[1]] }, { signature: 's1', status: 'finalized' },
    { signature: 's2', status: 'submitted', wallets: [W[2]] }, { signature: 's2', status: 'failed' },
    { signature: 's3', status: 'submitted', wallets: [W[3]] }, { signature: 's3', status: 'expired' },
    { signature: 's4', status: 'submitted', wallets: [W[4]] },
  ])
  assert.deepEqual([...s.paid.keys()], [W[0], W[1]])
  assert.equal(s.paid.get(W[0]), 's1')
  assert.deepEqual([...s.dead].sort(), ['s2', 's3'])
  assert.deepEqual(s.unknown.map((e) => e.signature), ['s4'])
  assert.deepEqual(s.unknown[0].wallets, [W[4]], 'the wallets of an unknown payout are kept')
})

test('batches: paid wallets are never planned again', () => {
  const recips = snap().recipients
  assert.deepEqual(planBatches(recips, new Map(), 2).map((b) => b.length), [2, 2, 1])
  const paid = new Map([[W[0], 's'], [W[3], 's']])
  const planned = planBatches(recips, paid, 2).flat().map((r) => r.wallet)
  assert.deepEqual(planned, [W[1], W[2], W[4]])
  assert.deepEqual(planBatches(recips, new Map(W.map((w) => [w, 's'])), 2), [])
})

test('SOL estimate: a token account per new holder plus one fee per transaction', () => {
  assert.equal(lamportsNeeded(0, 1), 5000n)
  assert.equal(lamportsNeeded(142, 31), 142n * 2039280n + 31n * 5000n)
})

test('snapshot checks refuse anything ambiguous', () => {
  assert.deepEqual(snapshotProblems(snap()), [])
  const bad = {
    'no treasury': snap({ treasury: null }),
    'listed twice': snap({ recipients: [W[0], W[0]].map((wallet) => ({ wallet, amountRaw: '1' })), totals: { recipients: 2, amountRaw: '2' } }),
    'positive integer': snap({ recipients: [{ wallet: W[0], amountRaw: '1.5' }], totals: { recipients: 1, amountRaw: '1' } }),
    'do not add up': snap({ totals: { recipients: 5, amountRaw: '1' } }),
    'also a recipient': snap({ treasury: W[0] }),
    'not a winlew': { schema: 'other' },
  }
  for (const [why, s] of Object.entries(bad)) assert.ok(snapshotProblems(s).some((p) => p.includes(why)), why)
})

test('hashing matches Oxyon\'s verifiers; base58 matches the standard encoding', () => {
  // xyo hash: keys sorted at every level, top-level _fields dropped (Python verify_evidence.xyo_hash)
  assert.equal(xyoHash({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 'x' }, _meta: 'ignored' }), xyoHash({ a: { c: 'x', d: [{ y: 2, z: 1 }] }, b: 1 }))
  assert.equal(xyoHash({ a: 1 }), '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862')
  assert.equal(base58(Uint8Array.from([0, 0, 1])), '112')
  assert.equal(base58(new TextEncoder().encode('hello world')), 'StV1DL6CwTryKyV')
})
