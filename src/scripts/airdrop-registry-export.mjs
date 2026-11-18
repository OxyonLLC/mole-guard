#!/usr/bin/env node
// Two-year anniversary airdrop: turn the registry into the final payout list — `node src/scripts/airdrop-registry-export.mjs`.
//
//   node src/scripts/airdrop-registry-export.mjs --preview                 counts only; writes nothing (any time)
//   node src/scripts/airdrop-registry-export.mjs --out-dir <dir>           after the cutoff: writes the three files
//   [--root <Mole-Guard checkout>] [--frozen <frozen list>]                defaults: this checkout; /home/winlew/airdrop-2026/…
//
// THE PUBLISHED RULES (winlew.co/news/two-year-anniversary-airdrop/, owner decisions 2026-11-14):
//   - The 156 wallets registered as of 2026-11-14 are frozen (canonical SHA-256 published) and count once each.
//   - Later registrations count once per Discord account: the wallet the account has saved at the cutoff.
//   - One payout per Discord account ACROSS BOTH: an account linked to a frozen wallet and also saving another wallet
//     is paid once, to its saved wallet. Its frozen wallet is SUPERSEDED, not paid separately.
//   - A wallet saved by two or more accounts is paid ONCE (owner: anything else is abuse).
//   - Project-owned addresses and wallets under an ENFORCED faucet ban are left out.
//   - Registration closes 2026-12-06 00:00 UTC.
//
// OUTPUTS (--out-dir, never overwritten):
//   registry.json        the wallets to pay — the --registry input of oxyon-evidence tools/airdrop.mjs snapshot
//   audit-public.json    every included / superseded / shared / excluded / flagged entry, with accounts shown only as
//                        salted SHA-256 references. Publish it with the snapshot. Contains NO Discord ids.
//   audit-private.json   the salt and the Discord id → reference map, so the owner can answer "why was I left out?".
//                        PRIVATE: keep it on this machine; never publish it.
//
// READ-ONLY on the faucet's data: reads src/faucet/{airdrops,wallet_links}.json, src/data/linked_wallets.json, the
// enforced wallet bans (src/faucet/walletBans.js) and project addresses (web.js). Refuses to run if the bans cannot
// be read: a payout list must never silently skip a ban.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CUTOFF_ISO = '2026-12-06T00:00:00.000Z'
export const FROZEN_SHA256 = 'dfb9a484e71ba1dca699f3ebb3e4197b9d059e69c42d8e297a9bcbfea0a13733'
export const FROZEN_DEFAULT = '/home/winlew/airdrop-2026/registry-frozen-2026-11-14.json'
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const DISCORD_ID = /^\d{15,21}$/

class Refused extends Error {}
const refuse = (m) => { throw new Refused(m) }
const isWallet = (w) => typeof w === 'string' && SOL.test(w.trim())

/** Canonical form of a wallet list: unique, sorted, one per line, trailing newline. Its SHA-256 is what was published. */
export function canonicalListSha256(wallets) {
  const u = [...new Set(wallets.filter(isWallet).map((w) => w.trim()))].sort()
  return crypto.createHash('sha256').update(u.join('\n') + '\n').digest('hex')
}

/**
 * Every Discord account's wallets, from the faucet's links and the Mole Guard links.
 * saved = the airdrop intent (`!register`), else the account's faucet address, else its Mole Guard wallet.
 * linked = every wallet the account is tied to.
 */
export function accountsFrom(walletLinks, moleLinks) {
  const acc = new Map()
  const get = (uid) => { if (!acc.has(uid)) acc.set(uid, { saved: null, linked: new Set() }); return acc.get(uid) }
  for (const [uid, v] of Object.entries(walletLinks?.links ?? {})) {
    if (!DISCORD_ID.test(uid) || !v || typeof v !== 'object') continue
    const a = get(uid)
    const airdrop = v.wallets?.airdrop?.address
    for (const w of [v.address, ...Object.values(v.wallets ?? {}).map((x) => x?.address)]) if (isWallet(w)) a.linked.add(w.trim())
    a.saved = isWallet(airdrop) ? airdrop.trim() : isWallet(v.address) ? v.address.trim() : null
  }
  for (const [uid, v] of Object.entries(moleLinks ?? {})) {
    if (!DISCORD_ID.test(uid) || !v || typeof v !== 'object' || !isWallet(v.wallet)) continue
    const a = get(uid)
    a.linked.add(v.wallet.trim())
    if (!a.saved) a.saved = v.wallet.trim()
  }
  return acc
}

/**
 * The rule, as a pure function. Returns { registry, audit, private } — see the header.
 * frozen: wallet[]; registry: the airdrops list at the cutoff (wallet[]); accounts: accountsFrom(); owned: Map(wallet → label);
 * bans: Set(wallet); salt: hex.
 */
export function buildRegistryExport({ frozen, registry, accounts, owned, bans, salt }) {
  const ref = (uid) => crypto.createHash('sha256').update(`${salt}:${uid}`).digest('hex').slice(0, 16)
  const frozenSet = new Set(frozen.filter(isWallet).map((w) => w.trim()))
  const registered = new Set(registry.filter(isWallet).map((w) => w.trim()))

  // 1. Accounts: eligible if their saved wallet was registered, or they are tied to a frozen wallet. One target each.
  const targets = new Map() // wallet → [uid]
  const superseded = [], flagged = []
  const claimedFrozen = new Set()
  for (const [uid, a] of [...accounts].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const frozenLinked = [...a.linked].filter((w) => frozenSet.has(w)).sort()
    const eligible = (a.saved && registered.has(a.saved)) || frozenLinked.length > 0
    if (!eligible) continue
    const target = a.saved ?? frozenLinked[0]
    if (!targets.has(target)) targets.set(target, [])
    targets.get(target).push(uid)
    for (const f of frozenLinked) {
      claimedFrozen.add(f)
      if (f !== target) superseded.push({ wallet: f, by: ref(uid), reason: 'the account is paid once, to its saved wallet' })
    }
  }

  // 2. Frozen wallets no account claims: once each.
  const included = new Map() // wallet → basis
  for (const w of [...frozenSet].sort()) if (!claimedFrozen.has(w)) included.set(w, { basis: 'frozen-unlinked' })
  // 3. Account targets: one payout per wallet, however many accounts chose it.
  const shared = []
  for (const [w, uids] of [...targets].sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (uids.length > 1) shared.push({ wallet: w, accounts: uids.length, accountRefs: uids.map(ref).sort(), paid: 'once (owner rule: shared wallets are paid once)' })
    const prev = included.get(w)
    included.set(w, { basis: prev ? 'frozen-unlinked+account' : 'account', accountRefs: uids.map(ref).sort() })
  }
  // 4. Registered after the freeze with no account at all: cannot satisfy "once per Discord account" — flagged, not paid.
  const accountWallets = new Set([...accounts.values()].flatMap((a) => [...a.linked, ...(a.saved ? [a.saved] : [])]))
  for (const w of [...registered].sort()) {
    if (!frozenSet.has(w) && !accountWallets.has(w)) flagged.push({ wallet: w, reason: 'registered after the freeze with no Discord account on record; not paid unless the owner decides otherwise' })
  }
  // 5. Exclusions last: project-owned and enforced bans.
  const excluded = []
  for (const w of [...included.keys()]) {
    const why = owned.has(w) ? `project-owned (${owned.get(w)})` : bans.has(w) ? 'enforced faucet ban' : null
    if (why) { excluded.push({ wallet: w, reason: why, basis: included.get(w).basis }); included.delete(w) }
  }
  const wallets = [...included.keys()].sort()
  return {
    registry: wallets,
    audit: {
      schema: 'winlew.airdrop.registry-audit.v1',
      cutoff: CUTOFF_ISO,
      rule: 'Frozen wallets (registered by 2026-11-14) once each; one payout per Discord account across frozen and later registrations, to the wallet saved at the cutoff; a wallet saved by several accounts is paid once; project-owned and enforced-ban wallets left out.',
      accountReference: 'Accounts appear only as the first 16 hex of SHA-256(salt:discordId). The salt is private; the owner can confirm any account on request.',
      frozen: { wallets: frozenSet.size, canonicalSha256: canonicalListSha256([...frozenSet]) },
      counts: { recipients: wallets.length, frozenUnlinked: wallets.filter((w) => included.get(w).basis.startsWith('frozen')).length,
        accountPayouts: wallets.filter((w) => included.get(w).basis !== 'frozen-unlinked').length,
        superseded: superseded.length, shared: shared.length, excluded: excluded.length, flagged: flagged.length },
      included: wallets.map((w) => ({ wallet: w, ...included.get(w) })),
      superseded: superseded.sort((a, b) => (a.wallet < b.wallet ? -1 : 1)),
      shared, excluded: excluded.sort((a, b) => (a.wallet < b.wallet ? -1 : 1)), flagged,
    },
    private: { salt, accounts: Object.fromEntries([...targets].flatMap(([w, uids]) => uids.map((u) => [u, { ref: ref(u), paidTo: included.has(w) ? w : null }]))) },
  }
}

// ── command line (runs on the WinLEW PC, from the faucet's checkout) ──────────
async function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
  const preview = argv.includes('--preview')
  const outDir = opt('out-dir')
  if (!preview && !outDir) refuse('give --preview (counts only) or --out-dir <dir> (after the cutoff)')
  if (!preview && Date.now() < Date.parse(CUTOFF_ISO) && !argv.includes('--before-cutoff-test')) refuse(`registration closes ${CUTOFF_ISO}; run --preview until then`)

  // --root: the Mole-Guard checkout whose data to read (default: the checkout this script lives in).
  const root = path.resolve(opt('root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'))
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
  const frozen = readJson(opt('frozen', FROZEN_DEFAULT))
  const sha = canonicalListSha256(frozen)
  if (sha !== FROZEN_SHA256) refuse(`the frozen list's canonical SHA-256 is ${sha}, not the published ${FROZEN_SHA256}`)
  const registry = readJson(path.join(root, 'src/faucet/airdrops.json'))
  const links = readJson(path.join(root, 'src/faucet/wallet_links.json'))
  const moleFile = path.join(root, 'src/data/linked_wallets.json')
  const mole = fs.existsSync(moleFile) ? readJson(moleFile) : {}

  // Project-owned addresses: the same parser the cleaner uses (TRANSPARENCY_COMPONENTS in web.js, plus the mint).
  const web = fs.readFileSync(path.join(root, 'src/mole/web.js'), 'utf8')
  const start = web.indexOf('const TRANSPARENCY_COMPONENTS = ['), end = web.indexOf('\n  ];', start)
  if (start < 0 || end < 0) refuse('TRANSPARENCY_COMPONENTS not found in web.js')
  const owned = new Map()
  for (const m of web.slice(start, end).matchAll(/id:\s*"([^"]+)"[\s\S]{0,600}?address:\s*"([^"]+)"/g)) owned.set(m[2], m[1])
  if (owned.size < 8) refuse(`only ${owned.size} project addresses parsed; refusing`)
  const mint = fs.readFileSync(path.join(root, 'src/faucet/dexscreener.js'), 'utf8').match(/export const MINT = '([^']+)'/)
  if (mint) owned.set(mint[1], 'THE MINT')

  // Enforced bans only (review-only records are notes, not payment decisions), exactly like the faucet and the cleaner.
  let bans
  try {
    const mod = await import(pathToFileURL(path.join(root, 'src/faucet/walletBans.js')).href)
    const listed = (await mod.listBans()) ?? []
    bans = new Set(listed.filter((r) => r && !r.reviewOnly).map((r) => String(r.wallet ?? r).trim()).filter(Boolean))
  } catch (e) { refuse(`wallet bans could not be read (${e?.message ?? e}); refusing rather than paying a banned wallet`) }

  const salt = crypto.randomBytes(16).toString('hex')
  const out = buildRegistryExport({ frozen, registry, accounts: accountsFrom(links, mole), owned, bans, salt })
  const c = out.audit.counts
  console.log(`frozen        ${out.audit.frozen.wallets} wallets, SHA-256 matches the published value`)
  console.log(`registry      ${registry.length} entries now; ${accountsFrom(links, mole).size} Discord accounts with wallets on record`)
  console.log(`recipients    ${c.recipients}  (frozen-unlinked ${c.frozenUnlinked}, account payouts ${c.accountPayouts})`)
  console.log(`superseded    ${c.superseded}   shared wallets ${c.shared}   excluded ${c.excluded}   flagged ${c.flagged}`)
  if (preview) { console.log('\nPREVIEW: nothing written. After the cutoff, run with --out-dir <dir>.'); return 0 }
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of ['registry.json', 'audit-public.json', 'audit-private.json']) if (fs.existsSync(path.join(outDir, f))) refuse(`${f} already exists in ${outDir}; nothing overwritten`)
  fs.writeFileSync(path.join(outDir, 'registry.json'), JSON.stringify(out.registry, null, 2) + '\n')
  fs.writeFileSync(path.join(outDir, 'audit-public.json'), JSON.stringify(out.audit, null, 2) + '\n')
  fs.writeFileSync(path.join(outDir, 'audit-private.json'), JSON.stringify(out.private, null, 2) + '\n', { mode: 0o600 })
  console.log(`\nwritten to ${outDir}: registry.json, audit-public.json (publish), audit-private.json (PRIVATE, mode 600)`)
  return 0
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => {
    console.error(e instanceof Refused ? `REFUSED: ${e.message}` : `ERROR: ${e?.message ?? e}`)
    process.exit(2)
  })
}
