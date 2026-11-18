// ─── helpers.js — Utility & Helper Functions for $WinLEW Bot ───

import fs from 'fs';

// ───────────── JSON Helpers ─────────────

/**
 * Reads and parses a JSON file.
 * @param {string} path - Path to file.
 * @returns {Object|Array} Parsed data or {} if error.
 */

export function loadJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Writes data to JSON file (pretty format).
 * @param {string} path - Path to file.
 * @param {Object|Array} data - Data to save.
 */
export function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ───────────── Solana Keypair Loader ─────────────

/**
 * Loads a Solana Keypair from a JSON array file.
 * @param {string} path - Path to keypair file.
 * @returns {Keypair} Solana Keypair instance.
 */
export function loadKeypair(path) {
  const bytes = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

// ───────────── Solana Address Resolver ─────────────

/**
 * Resolves an SNS domain or public key string to a Solana PublicKey.
 * Uses the SNS SDK on-chain resolver so tokenized domains and SOL records are handled correctly.
 */
export async function resolveSolanaAddress(address, connection) {
  const input = String(address || '').trim();
  if (/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i.test(input)) {
    try {
      return await resolve(connection, input);
    } catch {
      throw new Error('Unable to resolve SNS domain');
    }
  }
  return new PublicKey(input);
}

// ───────────── Persistent Faucet Claims ─────────────

/**
 * Loads faucet claims from JSON file.
 * @param {string} [claimsFile='./faucet_claims.json']
 * @returns {Object} address:timestamp map
 */
export function getFaucetClaims(claimsFile = './faucet_claims.json') {
  return loadJson(claimsFile);
}

/**
 * Sets faucet claim timestamp for an address.
 * @param {string} address
 * @param {number} timestamp (seconds)
 * @param {string} [claimsFile='./faucet_claims.json']
 */
export function setFaucetClaim(address, timestamp, claimsFile = './faucet_claims.json') {
  const claims = getFaucetClaims(claimsFile);
  claims[address] = timestamp;
  writeJson(claimsFile, claims);
}

// ───────────── Misc Helpers ─────────────

/**
 * Simple delay for async operations.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
export const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * Formats large numbers with commas (1,000,000).
 * @param {number|string} n
 * @returns {string}
 */
export function formatNumber(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// ───────────── Command Reference (Exported for !help) ─────────────

/**
 * Returns a formatted array of command info.
 * Each item: { cmd, desc, admin }
 */
export function getCommandList(DRIP_AMOUNT) {
  return [
    { cmd: '!balance <address|.sol>', desc: '🔍 Check your $WinLEW balance' },
    { cmd: '!faucet <address|.sol>', desc: '💧 Get daily free $WinLEW tokens' },
    { cmd: '!register <address|.sol>', desc: '📝 Register for airdrops' },
    { cmd: '!price', desc: '💰 View current $WinLEW price' },
    { cmd: '!supply', desc: '🌐 Show total $WinLEW supply' },
    { cmd: '!buy', desc: '🚀 Buy on Pump.fun' },
    { cmd: '!dexscreener', desc: '📊 View DexScreener chart' },
    { cmd: '!rugcheck', desc: '🔒 RugCheck safety' },
    { cmd: '!swap', desc: '💱 Swap on Raydium' },
    { cmd: '!geckoterminal', desc: '🌐 View GeckoTerminal Pool' },
    { cmd: '!cmc', desc: '📈 CoinMarketCap link' },
    { cmd: '!website', desc: '🖥️ Visit official site' },
    { cmd: '!links', desc: '🔗 All major $WinLEW links' },
    { cmd: '!data', desc: '📊 All price/data from all sources' },
    { cmd: '!gdata / !ddata / !rdata / !pdata', desc: '📊 Stats from each price source' },
    { cmd: '!uptime', desc: '⏱️ Show bot uptime' },
    { cmd: '!quicklinks', desc: '⚡ Handy shortcut links' },
    { cmd: '!help', desc: '📖 Show help menu' },
    // Admin/mod
    { cmd: '!wallet', desc: '🤖 Show bot public address', admin: true },
    { cmd: `!send <address|.sol>`, desc: `✉️ Send ${DRIP_AMOUNT} WinLEW (admin only)`, admin: true },
    { cmd: '!restart', desc: '♻️ Restart the bot (admin/mod only)', admin: true },
    { cmd: '!modhelp', desc: '🛠️ Mod/admin help menu', admin: true },
    { cmd: '!debugprice', desc: '🧩 Show all price source diagnostics', admin: true },
  ];
}
