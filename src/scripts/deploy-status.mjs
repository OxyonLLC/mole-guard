// One command that answers "what is this machine actually running?"
//
//   npm run status
//
// Written 2026-08-03 for a specific problem: the person at the keyboard and the
// person who knows what should be running are often not the same, and may be
// hundreds of miles apart. Diagnosing that over the phone means asking someone
// to run git commands and describe process lists. This prints one block they
// can copy back instead.
//
// Read-only. It starts nothing, stops nothing, and changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = [];
const say = (s = '') => out.push(s);

function sh(cmd, fallback = '(unavailable)') {
  try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
}

/** Is something listening on this local port? */
function portOpen(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, '127.0.0.1');
  });
}

say('===== WinLEW deploy status =====');
say(`when      : ${new Date().toISOString()}`);
say(`host      : ${sh('hostname', '?')}`);
say(`directory : ${ROOT}`);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
say(`version   : ${pkg.name}@${pkg.version}`);

say('');
say('--- code ---');
say(`branch    : ${sh('git rev-parse --abbrev-ref HEAD', '?')}`);
say(`commit    : ${sh('git log -1 --format="%h %ad %s" --date=short', '?')}`);
const dirty = sh('git status --porcelain', '');
say(`local edits: ${dirty ? dirty.split('\n').length + ' file(s) modified — a pull may conflict' : 'none'}`);

// Behind/ahead needs a fetch; do it read-only and tolerate no network.
sh('git fetch origin --quiet', '');
const counts = sh('git rev-list --left-right --count origin/main...HEAD', '');
if (/^\d+\s+\d+$/.test(counts)) {
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  say(`vs origin : ${behind} behind, ${ahead} ahead` +
    (behind ? '   <-- NEEDS `git pull origin main`' : '   (up to date)'));
} else {
  say('vs origin : could not compare (no network?)');
}

say('');
say('--- required config that git cannot carry ---');
const faucetEnv = path.join(ROOT, 'src/faucet/.env');
if (fs.existsSync(faucetEnv)) {
  const rpc = (fs.readFileSync(faucetEnv, 'utf8').match(/^RPC_URL=(.*)$/m) || [])[1] || '';
  let host = '(unset)';
  try { host = new URL(rpc.trim()).host; } catch {}
  const publicRpc = /api\.mainnet-beta\.solana\.com|solana-rpc\.publicnode\.com/.test(rpc);
  say(`faucet RPC: ${host}${publicRpc ? '   <-- PUBLIC endpoint; confirmations will time out' : ''}`);
} else {
  say('faucet RPC: src/faucet/.env MISSING — the faucet cannot run');
}

say('');
say('--- processes ---');
const nodeProcs = sh("pgrep -a node | grep -v pgrep || true", '');
const trees = (nodeProcs.match(/runner\.js all/g) || []).length;
const bots = (nodeProcs.match(/bot\.js/g) || []).length;
say(`node processes : ${nodeProcs ? nodeProcs.split('\n').length : 0}`);
say(`service stacks : ${trees}` + (trees > 1 ? '   <-- MORE THAN ONE; stop all, start one' : ''));
say(`faucet bots    : ${bots}` + (bots > 1 ? '   <-- duplicates share one Discord token' : ''));
say(`ngrok agents   : ${(sh('pgrep -a ngrok || true', '').match(/\n/g) || []).length + (sh('pgrep ngrok || true', '') ? 1 : 0)}`);

say('');
say('--- listening ports ---');
for (const [port, what] of [[8787, 'mole api'], [8788, 'public site'], [8790, 'watchdog']]) {
  say(`${port} ${what.padEnd(12)} ${(await portOpen(port)) ? 'up' : 'DOWN'}`);
}

say('');
say('If anything above is marked <-- it is the thing to fix.');
say('================================');

console.log(out.join('\n'));
