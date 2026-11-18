import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let didLoad = false;

export function loadLocalEnv() {
  if (didLoad) return;
  const candidates = [
    path.join(__dirname, '.env'),
    path.resolve(__dirname, '../../.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }

  didLoad = true;
}

export function faucetDir(...parts) {
  return path.join(__dirname, ...parts);
}
