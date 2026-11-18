process.env.MONGO_ENABLED = 'false';
process.env.MONGO_URI = '';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { claimFaucet } from '../../src/faucet/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// No claimStore cleanup here on purpose: every claimFaucet() case tested
// below throws during its own top-of-function input validation (see
// service.js's claimFaucet — discordUserId/source/requestedWallet checks all
// happen before the first call to reserveClaim), and the two "structural
// key-isolation" tests only import modules in a fresh child process, which
// doesn't touch the filesystem store either (claimStore.js never touches disk
// at module-load time, only inside function calls). So this file never
// creates src/faucet/data/claims_v3.json. It used to carry a defensive
// after() that unlinked FILE_STORE_PATH/FILE_LOCK_PATH "just in case"; that
// raced the real writer (test/faucet/claimStore.test.mjs) over the same
// shared, non-configurable path — see eligibility.test.mjs's comment for the
// full story. Only files that actually call reserveClaim() should touch
// those paths.

// Cold-start budget for the two child-process import probes below.
//
// These spawn a fresh node that imports service.js, which pulls in
// @solana/web3.js and its dependency tree. On a normal filesystem that is
// ~1s. On a repo checked out under a Windows mount and run from WSL2
// (/mnt/c/..., i.e. 9p), module resolution is I/O-bound and measured here at
// ~112s cold / ~20s warm — 2s of actual CPU either way. A 30s ceiling meant
// these two tests failed on every cold `npm test` on such a machine, which
// silently turned the single most important security assertion in this file
// into permanent red noise instead of a signal.
//
// This is a CEILING, not a wait: execFileSync returns as soon as the child
// exits, so a fast machine still finishes in about a second and pays nothing
// for the larger number. Only a genuinely hung import burns the full budget.
const IMPORT_PROBE_TIMEOUT_MS = 180_000;

describe('service.js: structural key-isolation guarantee', () => {
  // This is the single most important security property in this feature:
  // importing anything web.js imports (eligibility.js, service.js,
  // claimStore.js) must NEVER pull in the treasury keypair or the faucet
  // Discord bot's .env secrets, even transitively. Proven here by running a
  // fresh child process with WINLEW_MINT deliberately unset — faucet.js
  // throws immediately at import time if it's missing, so a clean exit
  // proves faucet.js's chain was never loaded by this import.
  test('importing service.js in a fresh process never loads src/faucet/faucet.js', () => {
    const serviceUrl = pathToFileURL(path.join(REPO_ROOT, 'src/faucet/service.js')).href;
    const script = `
      import('${serviceUrl}')
        .then(() => { console.log('SAFE'); })
        .catch((e) => { console.log('UNSAFE:' + e.message); });
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, WINLEW_MINT: '', WINLEW_TEST_CHILD: 'module-import-probe' },
      encoding: 'utf8',
      timeout: IMPORT_PROBE_TIMEOUT_MS,
    });
    assert.match(out, /SAFE/, `service.js import should not require WINLEW_MINT (proves faucet.js wasn't loaded); got: ${out}`);
  });

  test('importing eligibility.js in a fresh process never loads src/faucet/faucet.js', () => {
    const eligibilityUrl = pathToFileURL(path.join(REPO_ROOT, 'src/faucet/eligibility.js')).href;
    const script = `
      import('${eligibilityUrl}')
        .then(() => { console.log('SAFE'); })
        .catch((e) => { console.log('UNSAFE:' + e.message); });
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, WINLEW_MINT: '', WINLEW_TEST_CHILD: 'module-import-probe' },
      encoding: 'utf8',
      timeout: IMPORT_PROBE_TIMEOUT_MS,
    });
    assert.match(out, /SAFE/, `eligibility.js import should not require WINLEW_MINT; got: ${out}`);
  });

  test('payout-worker-main acquires the singleton guard before starting', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/faucet/payout-worker-main.js'), 'utf8');
    assert.match(src, /assertSingleInstance/);
    assert.match(src, /winlew-faucet-payouts/);
  });
});

describe('claimFaucet: input validation', () => {
  test('rejects an unknown source', async () => {
    await assert.rejects(() => claimFaucet({ discordUserId: 'x', source: 'mobile-app' }), /invalid_source/);
  });
  test('rejects a web claim that tries to specify a wallet', async () => {
    await assert.rejects(
      () => claimFaucet({ discordUserId: 'x', source: 'web', requestedWallet: 'SomeWallet111111111111111111111111111111' }),
      /web_source_cannot_specify_wallet/
    );
  });
  test('rejects a missing discordUserId', async () => {
    await assert.rejects(() => claimFaucet({ source: 'web' }), /discordUserId_required/);
  });
});
