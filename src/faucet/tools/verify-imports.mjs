import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const rootDir = process.cwd();
const includeExtensions = new Set(['.js', '.mjs', '.cjs']);
const skipDirs = new Set(['.git', '_legacy', 'assets', 'node_modules', 'test']);

const staticImportPattern =
  // The character classes exclude NEWLINES on purpose. Without that, [^"'`]*?
  // spans lines, so `export function unbanWallet(wallet) {` at walletBans.js:86
  // paired with a quoted string 28 lines below and reported a module called
  // "wallet". A module specifier can never contain a newline.
  /\b(?:import|export)\s+(?:[^"'`\n]*?\s+from\s+)?["'`]([^"'`\n]+)["'`]/g;
const dynamicImportPattern = /\bimport\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }
    if (includeExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }

  return files;
}

function extractSpecifiers(source) {
  const matches = [];
  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) matches.push(match[1]);
  }
  return matches;
}

async function verifyFile(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const parentUrl = pathToFileURL(filePath).href;
  const failures = [];

  for (const specifier of extractSpecifiers(source)) {
    try {
      await import.meta.resolve(specifier, parentUrl);
    } catch (error) {
      failures.push(`${path.relative(rootDir, filePath)} -> ${specifier}: ${error.message}`);
    }
  }

  return failures;
}

const files = await walk(rootDir);
const failures = [];

for (const filePath of files) failures.push(...await verifyFile(filePath));

if (failures.length) {
  console.error('Import verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Verified imports for ${files.length} files.`);
}
