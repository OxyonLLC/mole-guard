import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveDataPath(name) {
  const override = String(process.env.FAUCET_DATA_DIR || '').trim();
  return path.resolve(override || __dirname, name);
}

export function readJson(name, fallback) {
  const file = resolveDataPath(name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

export function writeJson(name, value) {
  const file = resolveDataPath(name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function ensureClaimsShape(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { wallets: {}, users: {} };
  }
  if (raw.wallets || raw.users) {
    return {
      wallets: raw.wallets && typeof raw.wallets === 'object' ? raw.wallets : {},
      users: raw.users && typeof raw.users === 'object' ? raw.users : {},
    };
  }
  return { wallets: { ...raw }, users: {} };
}
