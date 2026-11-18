// yarn dev:backup
//
// Snapshots this machine's runtime data (quiz progress, faucet claims,
// sessions, linked wallets, watchdog state, etc.) into a git commit and
// pushes it — so a `git pull` on another machine actually brings that data
// along, instead of leaving that machine's own local data/ directories
// (likely empty or stale) in place. Root cause this works around: every
// path below is gitignored for normal development (see .gitignore's
// "Runtime data" section) precisely because it's regenerable/sensitive —
// which also means it never travels between machines via a plain
// `git pull`. This script force-adds ONLY the explicit whitelist below,
// never a blanket `git add -A`, so it can never accidentally stage code
// changes or secrets.
//
// Real limitation, on purpose not hidden: if two machines both run
// services and both push a backup with divergent data, these JSON files
// can merge-conflict like any other tracked file. This is a manual
// "snapshot before I switch machines" aid, not a database replication
// system — don't run both machines against real users at the same time
// and expect this to reconcile them.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const DATA_PATHS = [
  'data',
  'src/data',
  'src/quiz/data',
  'src/faucet/data',
  'data-watchdog',
  'src/watchdog/data-watchdog',
];

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }).trim();
}
function runInherit(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function walk(abs) {
  const out = [];
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return [abs];
  for (const entry of fs.readdirSync(abs)) {
    out.push(...walk(path.join(abs, entry)));
  }
  return out;
}

const existingPaths = DATA_PATHS.filter((p) => fs.existsSync(path.join(ROOT, p)));
if (existingPaths.length === 0) {
  console.log('[dev-backup] No known data directories found on this machine — nothing to back up.');
  process.exit(0);
}

// Excludes long-lived credentials from the backup — everything else in
// DATA_PATHS gets staged normally. Deliberately does NOT reuse .gitignore's
// broad `**/wallet*.json` glob here — that pattern is a coarse guard
// against a literal raw-keypair export (e.g. src/faucet/bot-keypair.json)
// and would false-positive on legitimate, content-verified, non-secret
// state files that just happen to have "wallet" in the name
// (wallet_challenges.json, linked_wallets.json — public addresses +
// nonces/expiry, no key material). "token" IS matched on purpose:
// data/oauth_tokens.json holds real Discord access/refresh tokens
// (confirmed 2026-07-25) and must never be pushed, private repo or not — a
// leaked refresh token keeps working until revoked.
const SECRET_NAME_RE = /keypair|secret|token|\.pem$|\.key$|^id_rsa/i;

const included = [];
const excluded = [];
for (const rel of existingPaths) {
  for (const abs of walk(path.join(ROOT, rel))) {
    (SECRET_NAME_RE.test(path.basename(abs)) ? excluded : included).push(abs);
  }
}

if (excluded.length) {
  console.log('[dev-backup] Excluding credential-looking files (never backed up):');
  for (const abs of excluded) console.log(`  - ${path.relative(ROOT, abs)}`);
}
if (included.length === 0) {
  console.log('[dev-backup] Nothing left to back up after exclusions.');
  process.exit(0);
}

console.log(`[dev-backup] Backing up ${included.length} file(s) under: ${existingPaths.join(', ')}`);

// Pull first so this push starts from the latest known state on the
// remote — reduces (does not eliminate) the odds of a conflicting
// concurrent edit from the other machine.
try {
  runInherit('git pull --rebase --autostash');
} catch {
  console.error('[dev-backup] git pull failed — resolve that first, then re-run. Nothing was committed.');
  process.exit(1);
}

const includedRel = included.map((abs) => path.relative(ROOT, abs));
runInherit(`git add -f -- ${includedRel.map((p) => `"${p}"`).join(' ')}`);

const status = run(`git status --porcelain -- ${includedRel.map((p) => `"${p}"`).join(' ')}`);
if (!status) {
  console.log('[dev-backup] No data changes since the last backup — nothing to commit.');
  process.exit(0);
}

const stamp = new Date().toISOString();
runInherit(`git commit -m "chore(data-backup): snapshot runtime data ${stamp}"`);
runInherit('git push');

console.log('[dev-backup] Pushed. Run `git pull` on the other machine to bring this data across.');
