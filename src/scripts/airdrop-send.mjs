#!/usr/bin/env node
// Send a WinLEW airdrop exactly as an Oxyon-anchored snapshot says — `node src/scripts/airdrop-send.mjs`.
//
//   node src/scripts/airdrop-send.mjs --snapshot snapshot.json --snapshot-record <hash> --journal airdrop.jsonl
//        [--batch 5] [--send] [--payouts payouts.json]
//
// WITHOUT --send (the default) nothing is signed or broadcast: every safety check runs, every batch is SIMULATED on
// Solana (no signature needed), and the plan, the SOL it needs and anything that would refuse are printed.
//
// WITH --send it refuses to start unless ALL of these hold:
//   1. the snapshot file is the one Oxyon published: its SHA-256 is the anchored record's content hash, and that record
//      re-hashes to --snapshot-record (read from the public oxyon-evidence repository);
//   2. the snapshot's XL1 anchor is FINAL (its block is at or below XYO's finalized head), so the list was public on
//      XL1 before any token moves — the order the Oxyon verifier checks;
//   3. the signing key (loaded by the faucet's own src/faucet/keypair.js, never printed) is the snapshot's treasury;
//   4. the mint and decimals on Solana match the snapshot, and the treasury holds enough WinLEW and SOL;
// and then asks you to type the total to confirm.
//
// NEVER PAYS TWICE. Every transaction is written to the --journal file BEFORE it is broadcast. On a re-run, a wallet
// with a finalized payout is skipped; a payout whose outcome is not known yet is resolved from Solana first (landed →
// done; failed, or its blockhash expired without landing → safe to retry); while any stays unknown, nothing is sent.
//
// Output: --payouts (default payouts.json) — [{ wallet, signature }] for every recipient, written only when all are
// finalized. Feed it to oxyon-evidence `tools/airdrop.mjs distribution`.
//
// Run on the WinLEW PC from the runtime, with the faucet's environment (BOT_KEYPAIR_PATH, RPC_URL), e.g.
//   node <withenv.mjs> $(pm2 pid winlew-mole) src/scripts/airdrop-send.mjs --snapshot … --snapshot-record … --journal …
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Connection, Keypair, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'

export const SNAPSHOT_SCHEMA = 'winlew.airdrop.snapshot.v1'
export const EVIDENCE_BASE = 'https://raw.githubusercontent.com/LewSales/oxyon-evidence/main/'
export const XL1 = {
  mainnet: { rpc: 'https://api.chain.xyo.network/rpc', blocks: 'https://blocks.mainnet.xyo.space' },
  sequence: { rpc: 'https://beta.api.chain.xyo.network/rpc', blocks: 'https://blocks.sequence.xyo.space' },
}
export const MAX_TX_BYTES = 1232
const ATA_RENT_LAMPORTS = 2_039_280 // rent-exempt minimum for a 165-byte token account
const FEE_LAMPORTS = 5_000          // one signature
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const RAW = /^(0|[1-9]\d*)$/

class Refused extends Error {}
const refuse = (m) => { throw new Refused(m) }

// ── pure helpers (tested in test/airdrop-send.test.mjs) ──────────────────────
/** XYO payload hash, as Oxyon's verifiers compute it: SHA-256 of compact JSON, keys sorted at every level, top-level `_` fields dropped. */
export function xyoHash(obj) {
  const deep = (v) => Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, deep(v[k])])) : v
  const top = Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')))
  return crypto.createHash('sha256').update(JSON.stringify(deep(top))).digest('hex')
}

export function snapshotProblems(c) {
  const p = []
  if (!c || c.schema !== SNAPSHOT_SCHEMA) return ['not a winlew.airdrop.snapshot.v1 artifact']
  if (!SOL_ADDRESS.test(c.token?.mint ?? '') || !Number.isInteger(c.token?.decimals)) p.push('token mint or decimals missing')
  if (!SOL_ADDRESS.test(c.treasury ?? '')) p.push('the snapshot names no treasury (the sending wallet)')
  const rs = Array.isArray(c.recipients) ? c.recipients : []
  if (!rs.length) p.push('no recipients')
  const wallets = rs.map((r) => r?.wallet)
  if (!wallets.every((w) => SOL_ADDRESS.test(w ?? ''))) p.push('a recipient is not a Solana address')
  if (new Set(wallets).size !== wallets.length) p.push('a wallet is listed twice')
  if (!rs.every((r) => RAW.test(r?.amountRaw ?? '') && r.amountRaw !== '0')) p.push('an amount is not a positive integer')
  else if (c.totals?.amountRaw !== rs.reduce((s, r) => s + BigInt(r.amountRaw), 0n).toString() || c.totals?.recipients !== rs.length) p.push('totals do not add up')
  if (c.treasury && wallets.includes(c.treasury)) p.push('the treasury is also a recipient')
  return p
}

/** Journal lines → { paid: Map wallet→signature, unknown: [entry], failedOrExpired: Set signature }. Last word per signature wins. */
export function journalState(lines) {
  const bySig = new Map()
  for (const e of lines) {
    if (!e?.signature) continue
    const prev = bySig.get(e.signature) ?? {}
    bySig.set(e.signature, { ...prev, ...e, wallets: e.wallets ?? prev.wallets })
  }
  const paid = new Map(), unknown = [], dead = new Set()
  for (const e of bySig.values()) {
    if (e.status === 'finalized') for (const w of e.wallets ?? []) paid.set(w, e.signature)
    else if (e.status === 'failed' || e.status === 'expired') dead.add(e.signature)
    else unknown.push(e)
  }
  return { paid, unknown, dead }
}

/** Split the not-yet-paid recipients into batches of at most `size`. */
export function planBatches(recipients, paid, size) {
  const todo = recipients.filter((r) => !paid.has(r.wallet))
  const out = []
  for (let i = 0; i < todo.length; i += size) out.push(todo.slice(i, i + size))
  return out
}

/** SOL needed (lamports): a token account for each recipient that lacks one, plus one fee per transaction. */
export const lamportsNeeded = (missingAccounts, txCount) => BigInt(missingAccounts) * BigInt(ATA_RENT_LAMPORTS) + BigInt(txCount) * BigInt(FEE_LAMPORTS)

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b)
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s }
  return s
}

// ── evidence and chain checks ────────────────────────────────────────────────
async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`)
  return res.json()
}
async function xl1Rpc(net, method, params) {
  const body = await getJson(XL1[net].rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 120)}`)
  return body.result
}

/** Is this the published, anchored snapshot, and is its anchor final on XL1? Returns findings; never throws Refused. */
export async function evidenceFindings(snapshotBytes, snapshotRecord, { base = EVIDENCE_BASE } = {}) {
  const f = { published: false, final: false, notes: [] }
  const sha = crypto.createHash('sha256').update(snapshotBytes).digest('hex')
  try {
    const index = await getJson(`${base}index.json`)
    const entry = (index.records ?? []).find((r) => r.record === snapshotRecord)
    if (!entry) { f.notes.push(`snapshot record ${snapshotRecord.slice(0, 16)}… is not in the published oxyon-evidence index yet`); return f }
    const bundle = await getJson(`${base}${entry.path}`)
    const r = bundle.record
    if (xyoHash(r) !== snapshotRecord) { f.notes.push('the published record does not re-hash to --snapshot-record'); return f }
    if (r.claim?.type !== 'winlew.airdrop.snapshot') { f.notes.push(`the record is a ${r.claim?.type}, not a winlew.airdrop.snapshot`); return f }
    if (r.content?.sha256 !== sha) { f.notes.push('this snapshot file is NOT the one the record commits to (SHA-256 differs)'); return f }
    f.published = true
    const net = r.subject?.network, rc = bundle.receipt
    if (!XL1[net] || !rc?.tx || !Number.isInteger(rc.block)) { f.notes.push('the record has no anchor receipt yet'); return f }
    const head = (await xl1Rpc(net, 'finalizationViewer_head', []))?.[0]
    const [bw] = await getJson(`${XL1[net].blocks}/block/number/${rc.block}.json`)
    if (!bw?.payload_hashes?.includes(rc.tx)) { f.notes.push(`XL1 block #${rc.block} does not contain the anchor transaction`); return f }
    f.final = rc.block <= head.block
    f.notes.push(f.final ? `anchored in XL1 ${net} block #${rc.block}, final (finalized head #${head.block})`
      : `anchored in XL1 ${net} block #${rc.block}, NOT final yet (finalized head #${head.block}); wait and re-run`)
  } catch (e) { f.notes.push(`could not read the evidence or XL1 (${e.message})`) }
  return f
}

// ── Solana ───────────────────────────────────────────────────────────────────
function buildInstructions(payer, mint, decimals, fromAta, batch) {
  const ixs = []
  for (const r of batch) {
    const owner = new PublicKey(r.wallet)
    const ata = getAssociatedTokenAddressSync(mint, owner, true)
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint))
    ixs.push(createTransferCheckedInstruction(fromAta, mint, ata, payer, BigInt(r.amountRaw), decimals))
  }
  return ixs
}

function txSize(payer, ixs) {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: '11111111111111111111111111111111' }).add(...ixs)
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length
}

async function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
  const send = argv.includes('--send')
  const snapPath = opt('snapshot') ?? refuse('--snapshot <snapshot.json> is required')
  const record = (opt('snapshot-record') ?? refuse('--snapshot-record <hash> is required')).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(record)) refuse('--snapshot-record must be 64 hex characters')
  const journalPath = opt('journal') ?? refuse('--journal <file.jsonl> is required (the never-pay-twice record)')
  const payoutsPath = opt('payouts', 'payouts.json')
  let batchSize = Math.max(1, Math.min(10, Number(opt('batch', 5)) || 5))

  const bytes = fs.readFileSync(snapPath)
  const snap = JSON.parse(bytes.toString('utf8'))
  const probs = snapshotProblems(snap)
  if (probs.length) refuse(`snapshot: ${probs.join('; ')}`)
  const total = BigInt(snap.totals.amountRaw)
  const human = (raw) => { const s = String(raw).padStart(snap.token.decimals + 1, '0'); const w = s.slice(0, -snap.token.decimals || undefined); const fr = snap.token.decimals ? s.slice(-snap.token.decimals).replace(/0+$/, '') : ''; return `${BigInt(w).toLocaleString('en-US')}${fr ? '.' + fr : ''}` }
  console.log(`snapshot      ${snap.event}: ${snap.recipients.length} recipients, ${human(total)} WinLEW total (${snap.totals.amountRaw} base units)`)

  const problems = []
  const ev = await evidenceFindings(bytes, record)
  for (const n of ev.notes) console.log(`evidence      ${n}`)
  if (!ev.published) problems.push('the snapshot is not the published, anchored one')
  else if (!ev.final) problems.push('the snapshot anchor is not final on XL1 yet')

  // The signing key, through the faucet's own loader (never printed). Copied into this process's web3 Keypair class.
  // --as-treasury (dry run only): simulate as the snapshot's treasury WITHOUT loading any key — runs anywhere.
  const asTreasury = argv.includes('--as-treasury')
  if (asTreasury && send) refuse('--as-treasury is for dry runs only')
  let loaded = null, payerKp = null, payer
  if (asTreasury) {
    payer = new PublicKey(snap.treasury)
    console.log(`signer        none loaded (--as-treasury): simulating as ${snap.treasury}; the real key is checked when you run without it`)
  } else {
    const keyPath = String(process.env.BOT_KEYPAIR_PATH || '').trim()
    if (!keyPath) refuse('BOT_KEYPAIR_PATH is not set (run with the faucet environment, or dry-run with --as-treasury)')
    const here = path.dirname(fileURLToPath(import.meta.url))
    const { loadTreasuryKeypair } = await import(pathToFileURL(path.join(here, '..', 'faucet', 'keypair.js')).href)
    loaded = loadTreasuryKeypair(keyPath)
    payerKp = Keypair.fromSecretKey(Uint8Array.from(loaded.secretKey))
    payer = payerKp.publicKey
    console.log(`signer        ${payer.toBase58()} ${payer.toBase58() === snap.treasury ? '= snapshot treasury' : `≠ snapshot treasury ${snap.treasury}`}`)
    if (payer.toBase58() !== snap.treasury) problems.push('the signing key is not the snapshot treasury')
  }

  const conn = new Connection(String(process.env.RPC_URL || 'https://solana-rpc.publicnode.com').trim(), 'confirmed')
  const mint = new PublicKey(snap.token.mint)
  const mintInfo = (await conn.getParsedAccountInfo(mint)).value?.data?.parsed?.info
  if (mintInfo?.decimals !== snap.token.decimals) problems.push(`mint decimals on Solana (${mintInfo?.decimals}) differ from the snapshot (${snap.token.decimals})`)
  const fromAta = getAssociatedTokenAddressSync(mint, payer, true)

  // Journal: resolve anything whose outcome is unknown before planning.
  const lines = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const journal = (e) => fs.appendFileSync(journalPath, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n')
  let state = journalState(lines)
  if (state.unknown.length) {
    const height = await conn.getBlockHeight('finalized')
    const st = await conn.getSignatureStatuses(state.unknown.map((e) => e.signature), { searchTransactionHistory: true })
    state.unknown.forEach((e, i) => {
      const s = st.value[i]
      if (s?.confirmationStatus === 'finalized') journal({ signature: e.signature, status: s.err ? 'failed' : 'finalized' })
      else if (!s && height > e.lastValidBlockHeight) journal({ signature: e.signature, status: 'expired' })
    })
    state = journalState(fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    if (state.unknown.length) problems.push(`${state.unknown.length} earlier transaction(s) are not settled on Solana yet; re-run in a minute (nothing is resent while any is unknown)`)
  }
  const extra = [...state.paid.keys()].filter((w) => !snap.recipients.some((r) => r.wallet === w))
  if (extra.length) refuse(`the journal shows payouts to ${extra.length} wallet(s) not in this snapshot — wrong journal file?`)
  const remaining = snap.recipients.filter((r) => !state.paid.has(r.wallet))
  const remainingRaw = remaining.reduce((s, r) => s + BigInt(r.amountRaw), 0n)
  console.log(`progress      ${state.paid.size} paid, ${remaining.length} to pay (${human(remainingRaw)} WinLEW)`)

  // Fit batches under Solana's transaction size limit.
  const sample = remaining.length ? remaining : snap.recipients
  while (batchSize > 1 && txSize(payer, buildInstructions(payer, mint, snap.token.decimals, fromAta, sample.slice(0, batchSize))) > MAX_TX_BYTES) batchSize--
  const batches = planBatches(snap.recipients, state.paid, batchSize)

  // Balances: WinLEW, and SOL for new token accounts + fees.
  // A plain account read (PublicNode refuses "indexed" calls such as getTokenAccountBalance). An error throws; only
  // an account that does not exist reads as zero.
  const fromInfo = (await conn.getParsedAccountInfo(fromAta)).value
  const tokenBal = fromInfo ? BigInt(fromInfo.data?.parsed?.info?.tokenAmount?.amount ?? refuse('the treasury token account could not be parsed')) : 0n
  const atas = remaining.map((r) => getAssociatedTokenAddressSync(mint, new PublicKey(r.wallet), true))
  let missing = 0
  for (let i = 0; i < atas.length; i += 10) missing += (await conn.getMultipleAccountsInfo(atas.slice(i, i + 10))).filter((a) => !a).length // PublicNode: max 10 per call
  const solNeed = lamportsNeeded(missing, batches.length), solHave = BigInt(await conn.getBalance(payer))
  console.log(`plan          ${batches.length} transaction(s) of up to ${batchSize}; ${missing} recipient(s) need a new token account`)
  console.log(`treasury      ${human(tokenBal)} WinLEW (needs ${human(remainingRaw)}) · ${Number(solHave) / 1e9} SOL (needs ~${Number(solNeed) / 1e9} SOL)`)
  if (tokenBal < remainingRaw) problems.push('the treasury does not hold enough WinLEW')
  if (solHave < solNeed) problems.push(`the treasury needs ~${Number(solNeed - solHave) / 1e9} more SOL for new token accounts and fees`)

  if (!send) {
    let simOk = 0
    for (const [i, b] of batches.entries()) {
      const { blockhash } = await conn.getLatestBlockhash('confirmed')
      const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: buildInstructions(payer, mint, snap.token.decimals, fromAta, b) }).compileToV0Message()
      const sim = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true })
      if (sim.value.err) { console.log(`simulate      batch ${i + 1}: WOULD FAIL ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-2).join(' | ')}`); problems.push(`batch ${i + 1} fails in simulation`) } else simOk++
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 1000))
    }
    console.log(`simulate      ${simOk}/${batches.length} batch(es) would succeed`)
    console.log(problems.length ? `\nDRY RUN — would REFUSE to send:\n  - ${problems.join('\n  - ')}` : '\nDRY RUN — every check passes. Nothing was signed or sent. Add --send to pay.')
    return problems.length ? 1 : 0
  }

  if (problems.length) refuse(problems.join('; '))
  if (!batches.length) console.log('nothing left to pay')
  else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const typed = (await rl.question(`\nThis sends ${human(remainingRaw)} WinLEW to ${remaining.length} wallets in ${batches.length} transaction(s). Type ${human(remainingRaw)} to confirm: `)).trim()
    rl.close()
    if (typed !== human(remainingRaw)) refuse('confirmation did not match; nothing sent')
    for (const [i, b] of batches.entries()) {
      const latest = await conn.getLatestBlockhash('finalized')
      const tx = new Transaction({ feePayer: payer, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight })
        .add(...buildInstructions(payer, mint, snap.token.decimals, fromAta, b))
      tx.sign(payerKp)
      const signature = base58(tx.signature)
      journal({ signature, status: 'submitted', wallets: b.map((r) => r.wallet), amounts: b.map((r) => r.amountRaw), lastValidBlockHeight: latest.lastValidBlockHeight })
      await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 })
      let done = null
      while (!done) {
        await new Promise((r) => setTimeout(r, 2000))
        const s = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
        if (s?.confirmationStatus === 'finalized') done = s.err ? 'failed' : 'finalized'
        else if (!s && (await conn.getBlockHeight('finalized')) > latest.lastValidBlockHeight) done = 'expired'
      }
      journal({ signature, status: done })
      console.log(`batch ${i + 1}/${batches.length}  ${done}  https://solscan.io/tx/${signature}`)
      if (done !== 'finalized') refuse(`batch ${i + 1} ${done}; re-run to retry the unpaid wallets (paid ones are skipped)`)
    }
  }
  const final = journalState(fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  if (snap.recipients.every((r) => final.paid.has(r.wallet))) {
    if (fs.existsSync(payoutsPath)) refuse(`${payoutsPath} exists; not overwritten`)
    fs.writeFileSync(payoutsPath, JSON.stringify(snap.recipients.map((r) => ({ wallet: r.wallet, signature: final.paid.get(r.wallet) })), null, 2) + '\n')
    console.log(`\nAll ${snap.recipients.length} recipients paid and finalized. Payouts → ${payoutsPath} (for tools/airdrop.mjs distribution).`)
  }
  try { payerKp?.secretKey.fill(0); loaded?.secretKey.fill(0) } catch { /* best effort */ }
  return 0
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error(e instanceof Refused ? `REFUSED: ${e.message}` : `ERROR: ${e?.message ?? e}`)
    process.exit(2)
  })
}
