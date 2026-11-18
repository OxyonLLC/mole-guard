import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { resolve } from '@bonfida/spl-name-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const connection = new Connection(process.env.RPC_URL || clusterApiUrl('mainnet-beta'));
const domain = process.argv[2] || 'bonfida.sol';

try {
  const owner = await resolve(connection, domain);
  console.log(`✅ ${domain} -> ${owner.toBase58()}`);
} catch (err) {
  console.error(`❌ failed to resolve ${domain}:`, err?.message || err);
  process.exit(1);
}
