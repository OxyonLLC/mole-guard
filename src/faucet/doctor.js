import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const required = [
  '.env',
  'bot.js',
  'faucet.js',
  'priceTracker.js',
  'gecko.js',
  'dexscreener.js',
  'pumpfun.js',
  'raydium.js',
  'solscan.js',
  'faucet_claims.json',
  'registrations.json',
  'airdrops.json',
];

console.log(`Node ${process.version}`);
for (const file of required) {
  const full = path.join(__dirname, file);
  console.log(`${fs.existsSync(full) ? '✅' : '❌'} ${file}`);
}

console.log(
  '\nIf running inside Mole-Guard, copy these files into src/faucet and keep the root package.json authoritative.',
);
