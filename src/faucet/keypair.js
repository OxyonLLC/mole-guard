// Loads the treasury keypair — LAZILY, only when loadTreasuryKeypair() is
// actually called, never as an import-time side effect. This is what keeps
// key material out of the web process: src/mole/web.js never imports this
// file, and nothing it transitively imports (service.js, eligibility.js,
// claimStore.js) calls the function below. Only src/faucet/bot.js and
// src/faucet/payout-worker.js do — both are Discord-only/worker processes
// that never expose an HTTP surface to the public.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveRuntimePath(targetPath) {
  if (!targetPath) return targetPath;
  if (path.isAbsolute(targetPath)) return targetPath;
  const candidates = [
    path.resolve(process.cwd(), targetPath),
    path.resolve(__dirname, targetPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

let cachedKeypair = null;

// Errors from here must never carry file contents: V8's JSON.parse message
// quotes its input, so a truncated key file would put key bytes in the logs.
function keyFileError(reason) {
  return new Error(`treasury keypair file ${reason} (contents not shown)`);
}

/** Same resolution behavior as bot.js's original loadKeypair(); errors never echo the file. */
export function loadTreasuryKeypair(keypairPath) {
  if (cachedKeypair) return cachedKeypair;
  const resolvedPath = resolveRuntimePath(keypairPath);
  let text;
  try {
    text = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw keyFileError(`could not be read (${err.code || 'error'})`);
  }
  try {
    if (process.platform !== 'win32' && (fs.statSync(resolvedPath).mode & 0o077) !== 0) {
      console.warn('[faucet] treasury keypair file is readable by group/others; chmod 600 it');
    }
  } catch { /* the read above succeeded; a stat failure is not fatal */ }
  let bytes;
  try {
    bytes = JSON.parse(text);
  } catch {
    throw keyFileError('is not valid JSON');
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw keyFileError('is not a 64-byte secret key array');
  }
  try {
    cachedKeypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw keyFileError('does not hold a valid secret key');
  }
  return cachedKeypair;
}
