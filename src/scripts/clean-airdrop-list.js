#!/usr/bin/env node
/**
 * clean-airdrop-list.js — audit and repair the airdrop registration lists.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/faucet/airdrops.json` and `registrations.json` are the list an airdrop
 * would pay. As of 2026-08-07 that list is not safe to distribute from:
 *
 *   • It contains the X Faucet Reserve and the Developer Reserve — an airdrop
 *     would pay the treasury out of the treasury.
 *   • The Developer Reserve appears THREE times, in two forms: twice as its
 *     address and once as its SNS alias "lewsales.sol".
 *   • Three addresses are duplicated, so those wallets would be paid twice.
 *
 * This is a one-time historical fix, NOT an ongoing leak. The current
 * `!register` handler (src/faucet/bot.js:1161) resolves SNS to base58 and
 * dedupes before appending. The dirt came from the legacy handler still visible
 * at src/faucet/_legacy/other pc/bot.js:1124, which pushed raw `args[0]` with
 * no resolution and no dedupe.
 *
 * SAFETY
 * ------
 * Reports by default. Only `--write` mutates, and it refuses to run while the
 * faucet is up — see the storage-cache hazard note by assertNoFaucetRunning().
 *
 * Usage:
 *   node src/scripts/clean-airdrop-list.js            # report only
 *   node src/scripts/clean-airdrop-list.js --write    # apply
 *   node src/scripts/clean-airdrop-list.js --json     # machine-readable report
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const REGISTRATIONS = path.join(repoRoot, 'src/faucet/registrations.json');
const AIRDROPS = path.join(repoRoot, 'src/faucet/airdrops.json');
const WEB_JS = path.join(repoRoot, 'src/mole/web.js');

// Base58 with a LENGTH BOUND. src/mole/solana.js's BASE58_RE has none, so it
// accepts any-length base58 — fine for its callers, wrong for validating that
// something is a Solana address.
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Project-owned addresses, read out of TRANSPARENCY_COMPONENTS in web.js.
 *
 * That array is declared inside a function and is not exported (documented at
 * src/mole/contributions.js:21-33), so it cannot be imported. Parsing the file
 * as text is the same approach test/nav/navRouteCoverage.test.mjs already uses
 * for nav.js, and it is deliberately preferred over re-declaring the addresses
 * here: a second hardcoded copy would drift the moment a component changes,
 * which is exactly the class of bug the 2026-08 audit spent a week removing.
 */
function projectOwnedAddresses() {
  const source = fs.readFileSync(WEB_JS, 'utf8');
  const start = source.indexOf('const TRANSPARENCY_COMPONENTS = [');
  if (start === -1) throw new Error('TRANSPARENCY_COMPONENTS not found — web.js structure changed');
  const end = source.indexOf('\n  ];', start);
  if (end === -1) throw new Error('end of TRANSPARENCY_COMPONENTS not found');
  const block = source.slice(start, end);

  const found = new Map();
  for (const m of block.matchAll(/id:\s*"([^"]+)"[\s\S]{0,600}?address:\s*"([^"]+)"/g)) {
    found.set(m[2], m[1]);
  }
  if (found.size < 8) {
    throw new Error(`only parsed ${found.size} components — parser is broken, refusing to continue`);
  }

  // The mint itself is not a "component" but must never be paid.
  const mintMatch = fs.readFileSync(path.join(repoRoot, 'src/faucet/dexscreener.js'), 'utf8')
    .match(/export const MINT = '([^']+)'/);
  if (mintMatch) found.set(mintMatch[1], 'THE MINT');
  return found;
}

/**
 * Refuse to write while the faucet is running.
 *
 * src/faucet/storage.js serves these files from a boot-time in-memory cache
 * (loadManagedJson, ~line 240). A running bot that handles one `!register`
 * would append to its STALE pre-edit array and write the whole thing back over
 * the cleanup — and push that stale array to Mongo too. refreshManagedJson()
 * exists but is wired only to wallet_bans.json, so nothing would correct it.
 */
function assertNoFaucetRunning() {
  let out = '';
  try {
    out = execSync('ps -eo args', { encoding: 'utf8' });
  } catch {
    console.warn('  ! could not enumerate processes — verify the faucet is stopped yourself');
    return;
  }
  const hits = out.split('\n').filter((l) =>
    /src\/faucet\/(bot|payout-worker-main)\.js|runner\.js (all|faucet)|src\/index\.js/.test(l));
  if (hits.length) {
    console.error('\n  REFUSING TO WRITE — the faucet appears to be running:');
    hits.forEach((h) => console.error('    ' + h.trim().slice(0, 90)));
    console.error('\n  Its in-memory cache would clobber this edit on the next !register,');
    console.error('  and push the stale list to Mongo. Stop it, re-run, then restart.\n');
    process.exit(2);
  }
}

function analyse(list, owned, bans) {
  const seen = new Set();
  const keep = [];
  const dropped = { duplicate: [], projectOwned: [], notAnAddress: [], banned: [] };

  for (const raw of list) {
    const value = String(raw ?? '').trim();
    if (!BASE58_ADDRESS.test(value)) { dropped.notAnAddress.push(value); continue; }
    if (owned.has(value)) { dropped.projectOwned.push(`${value}  (${owned.get(value)})`); continue; }
    if (bans.has(value)) { dropped.banned.push(value); continue; }
    try { new PublicKey(value); } catch { dropped.notAnAddress.push(value); continue; }
    if (seen.has(value)) { dropped.duplicate.push(value); continue; }
    seen.add(value);
    keep.push(value);            // first-seen order preserved
  }
  return { keep, dropped };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const asJson = args.includes('--json');

  const owned = projectOwnedAddresses();

  // Only ENFORCED bans exclude an address.
  //
  // listBans() returns review-only records too, and using it directly was a bug
  // in the first version of this script: it dropped a wallet whose own ban
  // record reads "Watching, not enforcing." isDirectlyBanned() is the faucet's
  // real test (`Boolean(ban && !ban.reviewOnly)`, walletBans.js:107) and returns
  // FALSE for that wallet — so the faucet would happily pay it, and this script
  // must agree. A review flag is a note to a human, not a payment decision.
  let bans = new Set();
  let reviewOnly = new Set();
  try {
    const mod = await import('../faucet/walletBans.js');
    const listed = (typeof mod.listBans === 'function' ? await mod.listBans() : []) || [];
    for (const record of listed) {
      const wallet = String(record?.wallet ?? record ?? '').trim();
      if (!wallet) continue;
      if (record?.reviewOnly) reviewOnly.add(wallet);
      else bans.add(wallet);
    }
  } catch (error) {
    console.warn('  ! could not load wallet bans, continuing without that filter:', error?.message || error);
  }

  const files = [
    ['registrations.json', REGISTRATIONS],
    ['airdrops.json', AIRDROPS],
  ];

  const report = {};
  for (const [label, file] of files) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list)) throw new Error(`${label} is not an array — refusing to touch it`);
    const { keep, dropped } = analyse(list, owned, bans);
    report[label] = { before: list.length, after: keep.length, dropped, keep };
  }

  if (asJson) {
    console.log(JSON.stringify(
      Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { ...v, keep: v.keep.length }])),
      null, 2));
  } else {
    console.log('\n  AIRDROP LIST AUDIT');
    console.log('  ' + '='.repeat(58));
    console.log(`  project-owned addresses excluded: ${owned.size}   enforced bans: ${bans.size}`);
    if (reviewOnly.size) {
      const flagged = [...reviewOnly].filter((w) => report['airdrops.json'].keep.includes(w));
      console.log(`  review-only flags: ${reviewOnly.size} (${flagged.length} still payable — NOT removed, by design)`);
      flagged.forEach((w) => console.log(`     ~ ${w}  flagged for review, still being paid`));
    }
    console.log('');
    for (const [label, r] of Object.entries(report)) {
      console.log(`  ${label}: ${r.before} -> ${r.after} payable`);
      for (const [reason, items] of Object.entries(r.dropped)) {
        if (!items.length) continue;
        console.log(`     ${items.length} ${reason}:`);
        items.forEach((i) => console.log(`        ${i}`));
      }
      console.log('');
    }
    const [a, b] = Object.values(report);
    console.log(a.after === b.after
      ? `  both files agree: ${a.after} payable addresses`
      : `  ! files disagree: ${a.after} vs ${b.after} — investigate before distributing`);
  }

  if (!write) {
    // Nothing but JSON may reach stdout in --json mode, or piping it into a
    // parser fails with "Extra data" — which is exactly what happened the first
    // time this was piped into python.
    if (!asJson) console.log('\n  (report only — pass --write to apply)\n');
    return;
  }

  assertNoFaucetRunning();
  for (const [label, file] of files) {
    const { keep } = report[label];
    if (!keep.length) throw new Error(`${label} would be emptied — refusing (storage.js treats [] as not meaningful and Mongo would overwrite it)`);
    fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
    fs.writeFileSync(file, `${JSON.stringify(keep, null, 2)}\n`);
    console.log(`  wrote ${label} (${keep.length} entries), backup alongside`);
  }
  console.log('\n  Restart the faucet so bootstrapFile() pushes the cleaned list to Mongo.\n');
}

main().catch((error) => { console.error(error); process.exit(1); });
