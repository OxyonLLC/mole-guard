// The anniversary airdrop registry rule (owner decisions 2026-11-14). Synthetic wallets and ids only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRegistryExport, accountsFrom, canonicalListSha256 } from '../../src/scripts/airdrop-registry-export.mjs'

const W = (c) => 'Wak' + c.padEnd(41, 'z') // base58 only: no 0, O, I or l
const ID = (n) => String(100000000000000000n + BigInt(n))
const run = ({ frozen = [], registry = [], links = {}, mole = {}, owned = new Map(), bans = new Set() } = {}) =>
  buildRegistryExport({ frozen, registry: [...frozen, ...registry], accounts: accountsFrom({ version: 1, links }, mole), owned, bans, salt: 'aa' })
const reg = (w) => ({ address: w, wallets: { airdrop: { address: w } } })

test('frozen wallets with no account are paid once each', () => {
  const out = run({ frozen: [W('a'), W('b'), W('a')] })
  assert.deepEqual(out.registry, [W('a'), W('b')])
  assert.equal(out.audit.counts.frozenUnlinked, 2)
})

test('an account tied to a frozen wallet that saves a new wallet is paid ONCE, to the saved wallet', () => {
  const out = run({ frozen: [W('f'), W('x')], registry: [W('n')],
    links: { [ID(1)]: { address: W('n'), wallets: { airdrop: { address: W('n') }, faucet: { address: W('f') } } } } })
  assert.deepEqual(out.registry, [W('n'), W('x')])
  assert.equal(out.audit.superseded.length, 1)
  assert.equal(out.audit.superseded[0].wallet, W('f'))
})

test('an account tied only through Mole Guard to a frozen wallet keeps that one payout', () => {
  const out = run({ frozen: [W('f')], mole: { [ID(2)]: { wallet: W('f') } } })
  assert.deepEqual(out.registry, [W('f')])
  assert.equal(out.audit.included[0].basis, 'account')
})

test('a wallet saved by two accounts is paid once and listed as shared', () => {
  const out = run({ registry: [W('s')], links: { [ID(1)]: reg(W('s')), [ID(2)]: reg(W('s')) } })
  assert.deepEqual(out.registry, [W('s')])
  assert.equal(out.audit.shared.length, 1)
  assert.equal(out.audit.shared[0].accounts, 2)
})

test('later registrations: one per account; unregistered saved wallets and account-less entries are not paid', () => {
  const out = run({ registry: [W('a'), W('b'), W('orphan')],
    links: { [ID(1)]: reg(W('a')), [ID(2)]: reg(W('b')), [ID(3)]: reg(W('unregd')) } })
  assert.deepEqual(out.registry, [W('a'), W('b')])
  assert.deepEqual(out.audit.flagged.map((f) => f.wallet), [W('orphan')])
})

test('project-owned and enforced-ban wallets are excluded with their reason', () => {
  const out = run({ frozen: [W('p'), W('b'), W('ok')], owned: new Map([[W('p'), 'treasury']]), bans: new Set([W('b')]) })
  assert.deepEqual(out.registry, [W('ok')])
  assert.deepEqual(out.audit.excluded.map((e) => e.reason).sort(), ['enforced faucet ban', 'project-owned (treasury)'])
})

test('the public audit never contains a Discord id; the private file maps them', () => {
  const out = run({ frozen: [W('f')], registry: [W('n')], links: { [ID(7)]: { address: W('n'), wallets: { airdrop: { address: W('n') }, payout: { address: W('f') } } } } })
  assert.doesNotMatch(JSON.stringify(out.audit), /\d{15,21}/)
  assert.equal(out.private.accounts[ID(7)].paidTo, W('n'))
  assert.equal(out.audit.included.find((i) => i.wallet === W('n')).accountRefs[0], out.private.accounts[ID(7)].ref)
})

test('canonical hash matches the published method (unique, sorted, newline-joined, trailing newline)', () => {
  assert.equal(canonicalListSha256([W('b'), W('a'), W('a')]), canonicalListSha256([W('a'), W('b')]))
  assert.match(canonicalListSha256([W('a')]), /^[0-9a-f]{64}$/)
})
