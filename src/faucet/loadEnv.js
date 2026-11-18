import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  const localEnv = path.resolve(__dirname, '.env');
  const cwdEnv = path.resolve(process.cwd(), '.env');
  dotenv.config({ path: localEnv, override: false });
  if (cwdEnv !== localEnv) dotenv.config({ path: cwdEnv, override: false });
  loaded = true;
}

export function resolveLocalPath(value, fallback = undefined) {
  const candidate = value || fallback;
  if (!candidate) return undefined;
  return path.isAbsolute(candidate) ? candidate : path.resolve(__dirname, candidate);
}

export function boolFromEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

export function numberFromEnv(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function listFromEnv(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
