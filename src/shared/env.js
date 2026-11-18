import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Load env files in order. Later files override earlier ones.
 * Paths are relative to project root unless absolute.
 */
export function loadEnv(files = []) {
  for (const p of files) {
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (fs.existsSync(abs)) {
      dotenv.config({ path: abs, override: true });
    }
  }
}
