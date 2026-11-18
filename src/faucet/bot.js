import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

import fs from 'fs';
import cron from 'node-cron';
import { Client, GatewayIntentBits, Partials, WebhookClient, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildBuyWinlewButtonsRow, BUY_WINLEW_NOTE, WHY_HOLDER_ONLY } from './buyWinlewLinks.js';
import { TwitterApi } from 'twitter-api-v2';
import { announceable, nextTweetMarker, oldestFirst } from './tweetMarker.js';
import { isTwitterAvailable, noteTwitterFailure, noteTwitterSuccess } from '../services/twitterHealth.js';
import { appealLineMarkdown } from '../services/appealContact.js';
import { addIpBan, listIpBans, normalizeIpBanTarget, parseIpBanTtl, refreshIpDenylist, removeIpBan } from '../shared/ipDenylist.js';
import * as splTokenPkg from '@solana/spl-token';
import { resolve } from '@bonfida/spl-name-service';
import { resolveSolanaName as sharedResolveSolanaName } from '../shared/solanaNames.js';
import { fetchGeckoTerminalPrice, POOL_ID as GECKO_POOL_ID } from './gecko.js';
import { fetchCoinGeckoPrices, formatUsdPrice, changeArrow } from './tokenPrices.js';
import { fetchDexScreenerPrice, POOL_ID as DEXSCREENER_POOL_ID } from './dexscreener.js';
import { fetchPumpFunPrice, POOL_ID as PUMPFUN_POOL_ID } from './pumpfun.js';
import { fetchRaydiumPrice, POOL_ID as RAYDIUM_POOL_ID } from './raydium.js';
import { fetchSolScanPrice, POOL_ID as SOLSCAN_POOL_ID } from './solscan.js';
import { fetchBestPrice } from './priceTracker.js';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { buildHelpOverview, buildCommandsCatalog, buildModHelp, buildNavigationMessage, buildWebsiteLinks } from '../shared/command-inventory.js';
import { initFaucetStorage, loadManagedJson, writeManagedJson, flushManagedWrites } from './storage.js';
import { claimFaucet } from './service.js';
import { getStatusForUser, getStatusForWallet, migrateLegacyV2IfNeeded, listClaimsSince } from './claimStore.js';
import { formatAmountWithCommas as fmtAmt } from './amount.js';
import { banWallet, unbanWallet, listBans, describeCluster } from './walletBans.js';
import { banUser, unbanUser, listUserBans, getUserBan, normalizeUserId } from './userBans.js';
import { findCoTimingPairs, formatGap } from './coTiming.js';
import { assertSingleInstance } from '../shared/singleInstance.js';
import { getFaucetConfig } from './config.js';
import solanaConfirmPkg from '../shared/solanaConfirm.cjs';

const { confirmSignatureByPolling } = solanaConfirmPkg;

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const {
  RPC_URL,
  MOD_IDS,
  COMMAND_PREFIX,
  DISCORD_BOT_TOKEN,
  TWITTER_BEARER_TOKEN,
  VOICE_CHANNEL_ID,
  PRICE_CHANNEL_ID,
  SOL_PRICE_CHANNEL_ID,
  XYO_PRICE_CHANNEL_ID,
  XL1_PRICE_CHANNEL_ID,
  BOT_KEYPAIR_PATH,
  VOICE_WEBHOOK_URL,
  PRICE_WEBHOOK_URL,
  GENERAL_WEBHOOK_URL,
  SOCIAL_POSTS_CHANNEL_ID,
  SOCIAL_POSTS_WEBHOOK_URL,
  ANNOUNCEMENT_WEBHOOK_URL,
  WINLEW_MINT,
  TOKEN_SYMBOL,
  POOL_NAME,
  DRIP_AMOUNT,
  FAUCET_MIN_HOLDER_BALANCE,
  FAUCET_COOLDOWN_HOURS,
  DISABLE_FAUCET_HOLDER_CHECK,
} = process.env;

const EFFECTIVE_TOKEN_SYMBOL = TOKEN_SYMBOL || 'WinLEW';
const DISABLE_HOLDER_CHECK = ['1', 'true', 'yes', 'on'].includes(
  String(DISABLE_FAUCET_HOLDER_CHECK || '').toLowerCase(),
);
const WINLEW_MINT_ADDRESS = WINLEW_MINT || 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';
const WINLEW_MARKET_LINKS = {
  primaryPair: 'Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL',
  historicalPair: 'H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg',
  raydiumPair: '5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx',
  pumpCoin: `https://pump.fun/coin/${WINLEW_MINT_ADDRESS}`,
  // Renamed from dexscreenerPrimary on 2026-08-12, because it no longer points
  // at the primary market and a key called "primary" would invite someone to
  // "fix" it back. DexScreener hides a pair once its volume is zero, and every
  // WinLEW pool is at $0/24h — verified that day against its token-pairs,
  // tokens and search endpoints, all three returning zero pairs for the mint —
  // so the PumpSwap page renders "no pair found" while the Raydium one still
  // draws. The primary market is still Hmif58 and geckoPrimary below is how a
  // user reaches it; this key is only ever "a DexScreener chart that loads".
  dexscreenerChart: 'https://dexscreener.com/solana/5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx',
  geckoPrimary: 'https://www.geckoterminal.com/solana/pools/Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL',
  geckoHistorical: 'https://www.geckoterminal.com/solana/pools/H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg',
  raydiumSwap: `https://raydium.io/swap/?inputMint=sol&outputMint=${WINLEW_MINT_ADDRESS}`,
  raydiumLiquidity: 'https://raydium.io/liquidity/increase/?mode=add&pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx',
  rugcheck: `https://rugcheck.xyz/tokens/${WINLEW_MINT_ADDRESS}`,
  solscanToken: `https://solscan.io/token/${WINLEW_MINT_ADDRESS}`,
  solscanPrimary: 'https://solscan.io/account/Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL',
  solscanHistorical: 'https://solscan.io/account/H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg',
  coinMarketCap: `https://dex.coinmarketcap.com/token/solana/${WINLEW_MINT_ADDRESS}/`,
  mexcDex: `https://www.mexc.com/dex/onchain/sol/${WINLEW_MINT_ADDRESS}`,
};

const addressCache = new Map();

const requiredChecks = [
  ['DISCORD_BOT_TOKEN', DISCORD_BOT_TOKEN],
  ['RPC_URL', RPC_URL],
  ['WINLEW_MINT', WINLEW_MINT],
  ['BOT_KEYPAIR_PATH', BOT_KEYPAIR_PATH],
];

const optionalChecks = [
  ['TWITTER_BEARER_TOKEN', TWITTER_BEARER_TOKEN],
  ['VOICE_WEBHOOK_URL', VOICE_WEBHOOK_URL],
  ['PRICE_WEBHOOK_URL', PRICE_WEBHOOK_URL],
  ['GENERAL_WEBHOOK_URL', GENERAL_WEBHOOK_URL],
  ['SOCIAL_POSTS_CHANNEL_ID', SOCIAL_POSTS_CHANNEL_ID],
  ['SOCIAL_POSTS_WEBHOOK_URL', SOCIAL_POSTS_WEBHOOK_URL],
  ['ANNOUNCEMENT_WEBHOOK_URL', ANNOUNCEMENT_WEBHOOK_URL],
  ['VOICE_CHANNEL_ID', VOICE_CHANNEL_ID],
  ['PRICE_CHANNEL_ID', PRICE_CHANNEL_ID],
  ['SOL_PRICE_CHANNEL_ID', SOL_PRICE_CHANNEL_ID],
  ['XYO_PRICE_CHANNEL_ID', XYO_PRICE_CHANNEL_ID],
  ['XL1_PRICE_CHANNEL_ID', XL1_PRICE_CHANNEL_ID],
  ['COMMAND_PREFIX', COMMAND_PREFIX || '!'],
  ['DRIP_AMOUNT', DRIP_AMOUNT],
  ['MOD_IDS', MOD_IDS],
  ['FAUCET_MIN_HOLDER_BALANCE', FAUCET_MIN_HOLDER_BALANCE || '1 (default)'],
  ['FAUCET_COOLDOWN_HOURS', FAUCET_COOLDOWN_HOURS || '24 (default)'],
];
console.log('→ faucet .env loaded:');
for (const [name, val] of requiredChecks) {
  console.log(` • ${name.padEnd(24)} : ${val ? '✅ Ready' : '❌ Missing'}`);
}
for (const [name, val] of optionalChecks) {
  console.log(` • ${name.padEnd(24)} : ${val ? '✅ Ready' : '↪ Optional'}`);
}
const missing = requiredChecks.filter(([, val]) => !val).map(([name]) => name);
if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

const connection = new Connection(RPC_URL || 'https://solana-rpc.publicnode.com');
// Log only the RPC host: provider URLs carry the API key in the path or query (e.g. Alchemy's /v2/<key>),
// and pm2 keeps these logs on disk indefinitely.
console.log('RPC_URL loaded:', (() => { try { return new URL(RPC_URL).host; } catch { return RPC_URL ? '(set, unparseable)' : '(default)'; } })());

if (!WINLEW_MINT || WINLEW_MINT.length < 32) {
  throw new Error('WINLEW_MINT is not set or is invalid in your .env file!');
}
const TOKEN_MINT = new PublicKey(WINLEW_MINT);

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

function loadKeypair(keypairPath) {
  const resolvedPath = resolveRuntimePath(keypairPath);
  const bytes = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
const BOT_KEYPAIR = loadKeypair(BOT_KEYPAIR_PATH);

const MOD_ID_LIST = MOD_IDS ? MOD_IDS.split(',').map((id) => id.trim()) : [];

// Roles that may decide a held payout or clear a watchlist entry. Defaults to
// the server's Admin role so this works with no configuration — a review queue
// whose commands only one person can run is the same hole as one nobody reads,
// and the announcements pin that role by name.
const REVIEWER_ROLE_IDS = (process.env.QUIZ_REVIEWER_ROLE_IDS || '1350888808283115630')
  .split(',').map((v) => v.trim()).filter(Boolean);

/** Named individuals keep working; anyone holding a reviewer role now works too.
 *  Read-only inspection is intentionally open to reviewers as well as mods —
 *  the failure this guards against is nobody looking, not too many people
 *  looking. Approving, rejecting and clearing use the same gate: no separate,
 *  weaker tier, because those are the actions that move money. */
function canReviewPayouts(message) {
  if (MOD_ID_LIST.includes(message.author.id)) return true;
  try {
    const roles = message.member?.roles?.cache;
    return Boolean(roles && REVIEWER_ROLE_IDS.some((id) => roles.has(id)));
  } catch {
    // A DM, or a member object Discord did not attach. Fall back to the
    // explicit list rather than guessing.
    return false;
  }
}

function reviewerDeniedMessage() {
  return `❌ You are not authorized. This needs ${REVIEWER_ROLE_IDS.map((id) => `<@&${id}>`).join(' or ')} (or a listed mod).`;
}

const PREFIX = COMMAND_PREFIX || '!';
const DRIP = Number(DRIP_AMOUNT) || 1000;
if (isNaN(DRIP) || DRIP <= 0) {
  throw new Error('Invalid DRIP_AMOUNT in .env! It must be a positive number.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.once('clientReady', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// pm2 (autorestart, `pm2 restart`, `pm2 stop`) signals shutdown with
// SIGTERM/SIGINT. Without this, Node's default handling drops the process
// without telling Discord to end the gateway session, so a fast pm2 respawn
// can briefly run alongside the still-live old session and double-reply to
// the same message.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — closing Discord session before exit.`);
  await client.destroy().catch(() => {});
  // A managed write reaches local disk synchronously but pushes to Mongo on a
  // background chain, and refreshManagedJson() writes Mongo's payload back OVER
  // the local file within 30s of the next boot. So a claim recorded moments
  // before a `pm2 restart` can be erased by its own restart, and the cooldown
  // goes with it. client.destroy() usually gives the chain enough time; usually
  // is not a guarantee, and a slow Mongo widens the window.
  await flushManagedWrites().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function replyInChunks(message, content, maxLength = 1900) {
  const text = String(content || '');
  if (text.length <= maxLength) {
    await message.reply(text);
    return;
  }

  const sections = text.split('\n\n');
  const chunks = [];
  let current = '';

  const pushChunk = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
  };

  const appendBlock = (block) => {
    if (!block) return;
    if (!current) {
      current = block;
      return;
    }
    if (current.length + 2 + block.length <= maxLength) {
      current += `\n\n${block}`;
      return;
    }
    pushChunk();
    current = block;
  };

  const appendLines = (block) => {
    const lines = String(block || '').split('\n');
    let section = '';

    const flushSection = () => {
      if (!section) return;
      appendBlock(section);
      section = '';
    };

    for (const line of lines) {
      let remaining = line;
      while (remaining.length > maxLength) {
        flushSection();
        appendBlock(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      const next = section ? `${section}\n${remaining}` : remaining;
      if (next.length > maxLength) {
        flushSection();
        section = remaining;
      } else {
        section = next;
      }
    }

    flushSection();
  };

  for (const section of sections) {
    if (section.length > maxLength) {
      appendLines(section);
      continue;
    }
    appendBlock(section);
  }

  pushChunk();

  for (let i = 0; i < chunks.length; i += 1) {
    if (i === 0) {
      await message.reply(chunks[i]);
    } else {
      await message.channel.send(chunks[i]);
    }
  }
}

const voiceWebhook = VOICE_WEBHOOK_URL ? new WebhookClient({ url: VOICE_WEBHOOK_URL }) : null;
const priceWebhook = PRICE_WEBHOOK_URL ? new WebhookClient({ url: PRICE_WEBHOOK_URL }) : null;
const generalWebhook = GENERAL_WEBHOOK_URL ? new WebhookClient({ url: GENERAL_WEBHOOK_URL }) : null;

/**
 * Where social posts (currently X/Twitter) are announced.
 *
 * Set SOCIAL_POSTS_CHANNEL_ID to a channel id and they go there instead of
 * general chat — that is the whole reason this exists, so announcements stop
 * being buried in conversation. Falls back to the general webhook when unset,
 * so an existing deployment keeps working unchanged.
 *
 * Returns TRUE only when the message actually went somewhere. The caller must
 * check it: see the note at the call site about tweets being marked as seen
 * whether or not they were ever delivered.
 */
async function postSocialUpdate(content) {
  const channelId = String(SOCIAL_POSTS_CHANNEL_ID || '').trim();
  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased?.()) {
        await channel.send({ content, allowedMentions: { parse: [] } });
        return true;
      }
      console.error(`[SOCIAL] ${channelId} is not a text channel — falling back to the general webhook.`);
    } catch (e) {
      // A wrong id, a missing permission, or a deleted channel. Say so loudly
      // and fall back rather than dropping the post.
      console.error(`[SOCIAL] could not post to channel ${channelId}: ${e?.message || e} — falling back.`);
    }
  }
  // A webhook that already points at the social channel. This exists because
  // repointing GENERAL_WEBHOOK_URL at 🗣️-social-posts would also drag the
  // tweet-watcher's OUTAGE alerts in there — and "the watcher stopped" is an
  // operational message for maintainers, not a social post. Two destinations,
  // two variables.
  const socialHook = String(SOCIAL_POSTS_WEBHOOK_URL || '').trim();
  if (socialHook) {
    try {
      await new WebhookClient({ url: socialHook }).send({ content, allowedMentions: { parse: [] } });
      return true;
    } catch (e) {
      console.error(`[SOCIAL] social webhook failed: ${e?.message || e} — falling back.`);
    }
  }
  if (generalWebhook) {
    await generalWebhook.send({ content, allowedMentions: { parse: [] } });
    return true;
  }
  console.error('[SOCIAL] nowhere to post: set SOCIAL_POSTS_CHANNEL_ID, SOCIAL_POSTS_WEBHOOK_URL or GENERAL_WEBHOOK_URL.');
  return false;
}
const announcementWebhook = ANNOUNCEMENT_WEBHOOK_URL
  ? new WebhookClient({ url: ANNOUNCEMENT_WEBHOOK_URL })
  : null;

function resolveDataPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath);
}

const loadJson = (filePath, fallback = {}) => {
  return loadManagedJson(path.basename(filePath), fallback);
};

const writeJson = (filePath, data) => {
  writeManagedJson(path.basename(filePath), data);
};

const CLAIMS_FILE = 'faucet_claims.json';
const WALLET_LINKS_FILE = 'wallet_links.json';
const REGISTRATIONS_FILE = 'registrations.json';
const AIRDROPS_FILE = 'airdrops.json';
const MOLE_LINKED_WALLETS_FILE = path.resolve(__dirname, '..', 'data', 'linked_wallets.json');
const MIN_HOLDER_BALANCE = Number(FAUCET_MIN_HOLDER_BALANCE || 1);
const FAUCET_COOLDOWN_MS = Number(FAUCET_COOLDOWN_HOURS || 24) * 60 * 60 * 1000;

function toMsTimestamp(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1e12 ? num * 1000 : num;
}

function normalizeClaimState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: 2, wallets: {}, users: {} };
  }
  if ('wallets' in raw || 'users' in raw) {
    const wallets = {};
    const users = {};
    if (raw.wallets && typeof raw.wallets === 'object') {
      for (const [key, value] of Object.entries(raw.wallets)) {
        const ts = toMsTimestamp(value);
        if (ts > 0) wallets[key] = ts;
      }
    }
    if (raw.users && typeof raw.users === 'object') {
      for (const [key, value] of Object.entries(raw.users)) {
        const ts = toMsTimestamp(value);
        if (ts > 0) users[key] = ts;
      }
    }
    return { version: 2, wallets, users };
  }
  const wallets = {};
  for (const [key, value] of Object.entries(raw)) {
    const ts = toMsTimestamp(value);
    if (ts > 0) wallets[key] = ts;
  }
  return { version: 2, wallets, users: {} };
}

function getClaimState() {
  return normalizeClaimState(loadJson(CLAIMS_FILE, {}));
}

function saveClaimState(state) {
  writeJson(CLAIMS_FILE, normalizeClaimState(state));
}

function loadExternalJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeExternalJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getWalletLinks() {
  const raw = loadJson(WALLET_LINKS_FILE, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  if (raw.links && typeof raw.links === 'object') return raw.links;
  return raw;
}

function saveWalletLinks(links) {
  writeJson(WALLET_LINKS_FILE, { version: 1, links });
}

function getMoleLinkedWallets() {
  const raw = loadExternalJson(MOLE_LINKED_WALLETS_FILE, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function saveMoleLinkedWallets(links) {
  writeExternalJson(MOLE_LINKED_WALLETS_FILE, links);
}

function normalizeLinkedWallet(record, source = 'unknown', intent = 'faucet') {
  if (!record) return null;
  if (typeof record === 'string') {
    return { input: record, address: record, updatedAt: 0, source, intent };
  }
  if (typeof record === 'object' && !Array.isArray(record)) {
    const walletIntents = record.wallets && typeof record.wallets === 'object' && !Array.isArray(record.wallets)
      ? record.wallets
      : {};
    const preferred = walletIntents[intent]
      || (intent === 'payout' ? walletIntents.faucet : null)
      || (intent === 'faucet' ? walletIntents.payout : null)
      || walletIntents.verified
      || walletIntents.airdrop
      || (record.address ? record : null)
      || (record.wallet ? record : null);

    if (!preferred) return null;

    const address = preferred.address || preferred.wallet || record.address || record.wallet;
    if (!address) return null;

    return {
      input: preferred.input || record.input || address,
      address,
      updatedAt: toMsTimestamp(preferred.updatedAt || preferred.linked_at || record.updatedAt || record.linked_at),
      source: preferred.source || source,
      intent,
    };
  }
  return null;
}

function buildWalletIntentEntry(address, input, source) {
  return {
    input: input || address,
    address,
    updatedAt: new Date().toISOString(),
    source,
  };
}

function pickPreferredWallet(candidates) {
  return (
    candidates
      .filter((candidate) => candidate?.address)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null
  );
}

/** The first-payout provenance report, for `!quizreview <id>` — the "who what
 *  when where and why" a mod needs before deciding. This is the ONE place the
 *  funding wallets are shown: a mod deciding someone's payout needs the
 *  addresses, whereas the channel announcement deliberately does not name them.
 *
 *  Everything here is context, not proof. Being funded by a friend who plays
 *  here is ordinary; the report says so in its own weights, and those are shown
 *  rather than collapsed into a verdict so a human can disagree with them. */
function formatProvenanceLines(provenance) {
  if (!provenance) return [];
  const lines = [
    '',
    `**First-payout check** — verdict \`${provenance.verdict}\` (score ${provenance.score ?? 0}), run ${provenance.checkedAt || '?'}`,
  ];

  if (provenance.degraded) {
    // Stated first and plainly. A degraded check is not weak evidence, it is
    // absent evidence, and it must not be read as a soft accusation.
    lines.push(`⚠️ _Incomplete — ${provenance.reason || 'the chain could not be fully read'}. Treat as "not checked", not as a finding._`);
  }

  const funders = provenance.funders || [];
  if (!funders.length) {
    lines.push('• No identifiable funding wallet. Common on older wallets — not a finding.');
  }
  for (const f of funders) {
    const bits = [];
    if (f.infrastructure) bits.push('exchange/router — funds many wallets, means nothing');
    if (f.banned) bits.push('**BANNED**');
    if (f.paidByUs) bits.push('we have paid this wallet');
    if (f.participant) bits.push('plays here');
    if (f.stillHolds === true) bits.push(`still holds ${f.balance}`);
    if (f.stillHolds === false) bits.push('holds nothing now');
    if (f.faucetClaims) bits.push(`${f.faucetClaims} faucet claims`);
    lines.push(`• Funder \`${f.wallet}\`${bits.length ? ` — ${bits.join(' · ')}` : ' — nothing known'}`);
  }

  for (const finding of provenance.findings || []) {
    lines.push(`  ${finding.weight > 0 ? '⚑' : '·'} ${finding.signal} (${finding.weight}) — ${finding.note}`);
  }
  return lines;
}

function getLinkedWallet(discordUserId, intent = 'faucet') {
  const userId = String(discordUserId);
  const links = getWalletLinks();
  const moleLinks = getMoleLinkedWallets();
  const candidates = [
    normalizeLinkedWallet(links[userId], 'faucet', intent),
    normalizeLinkedWallet(moleLinks[userId], 'mole', intent),
  ];

  const legacyRegistrations = loadJson(REGISTRATIONS_FILE, {});
  if (legacyRegistrations && !Array.isArray(legacyRegistrations) && typeof legacyRegistrations === 'object') {
    candidates.push(normalizeLinkedWallet(legacyRegistrations[userId], 'legacy-registrations', intent));
  }

  const legacyAirdrops = loadJson(AIRDROPS_FILE, {});
  if (legacyAirdrops && !Array.isArray(legacyAirdrops) && typeof legacyAirdrops === 'object') {
    candidates.push(normalizeLinkedWallet(legacyAirdrops[userId], 'legacy-airdrops', intent));
  }

  return pickPreferredWallet(candidates);
}

function setLinkedWallet(discordUserId, input, address) {
  const userId = String(discordUserId);
  const nowIso = new Date().toISOString();
  const links = getWalletLinks();
  const existingLink = links[userId] && typeof links[userId] === 'object' && !Array.isArray(links[userId]) ? links[userId] : {};
  const walletIntents = existingLink.wallets && typeof existingLink.wallets === 'object' && !Array.isArray(existingLink.wallets)
    ? { ...existingLink.wallets }
    : {};

  walletIntents.faucet = buildWalletIntentEntry(address, input, 'manual-register');
  walletIntents.payout = buildWalletIntentEntry(address, input, 'manual-register');
  walletIntents.airdrop = buildWalletIntentEntry(address, input, 'manual-register');

  links[userId] = {
    ...existingLink,
    input,
    address,
    updatedAt: nowIso,
    source: 'manual-register',
    wallets: walletIntents,
  };
  saveWalletLinks(links);

  const moleLinks = getMoleLinkedWallets();
  const existingMole = moleLinks[userId] && typeof moleLinks[userId] === 'object' && !Array.isArray(moleLinks[userId]) ? moleLinks[userId] : {};
  const moleWalletIntents = existingMole.wallets && typeof existingMole.wallets === 'object' && !Array.isArray(existingMole.wallets)
    ? { ...existingMole.wallets }
    : {};
  moleWalletIntents.faucet = buildWalletIntentEntry(address, input, 'manual-register');
  moleWalletIntents.payout = buildWalletIntentEntry(address, input, 'manual-register');
  moleWalletIntents.airdrop = buildWalletIntentEntry(address, input, 'manual-register');

  moleLinks[userId] = {
    ...existingMole,
    wallet: address,
    input: existingMole.input || input,
    linked_at: Math.floor(Date.now() / 1000),
    updatedAt: nowIso,
    wallets: moleWalletIntents,
  };
  saveMoleLinkedWallets(moleLinks);
}

function removeLinkedWallet(discordUserId) {
  const userId = String(discordUserId);
  const links = getWalletLinks();
  delete links[userId];
  saveWalletLinks(links);

  const moleLinks = getMoleLinkedWallets();
  if (moleLinks[userId]) {
    delete moleLinks[userId];
    saveMoleLinkedWallets(moleLinks);
  }
}

function describeLinkedWalletSource(source) {
  switch (source) {
    case 'mole':
    case 'mole-verification':
      return 'Mole Guard verification';
    case 'verified-default':
      return 'verified wallet default';
    case 'faucet':
      return 'faucet saved wallet';
    case 'manual-register':
      return 'manual save / register';
    case 'legacy-registrations':
      return 'legacy registrations';
    case 'legacy-airdrops':
      return 'legacy airdrops';
    default:
      return 'saved data';
  }
}

function appendUniqueRegistration(filePath, walletAddress) {
  const data = loadJson(filePath, []);
  if (Array.isArray(data)) {
    if (!data.includes(walletAddress)) {
      data.push(walletAddress);
      writeJson(filePath, data);
    }
    return;
  }
  if (data && typeof data === 'object') {
    if (!Object.values(data).includes(walletAddress)) {
      data[`wallet_${Date.now()}`] = walletAddress;
      writeJson(filePath, data);
    }
  }
}

/**
 * The inverse of appendUniqueRegistration.
 *
 * Written 2026-08-15: there was no way to take a wallet OFF the airdrop
 * registry, so a wallet banned from the faucet stayed queued for an airdrop
 * indefinitely. Handles both shapes the registration files have historically
 * had — a plain array, and the older keyed object.
 */
function removeFromRegistration(filePath, walletAddress) {
  const data = loadJson(filePath, []);
  if (Array.isArray(data)) {
    const next = data.filter((w) => String(w).trim() !== walletAddress);
    if (next.length === data.length) return { removed: false, remaining: data.length };
    writeJson(filePath, next);
    return { removed: true, remaining: next.length };
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data).filter((k) => String(data[k]).trim() === walletAddress);
    if (!keys.length) return { removed: false, remaining: Object.keys(data).length };
    for (const k of keys) delete data[k];
    writeJson(filePath, data);
    return { removed: true, remaining: Object.keys(data).length };
  }
  return { removed: false, remaining: 0 };
}

/** Both lists, since !register writes both. Reports which it actually changed
 *  rather than claiming success — they can drift, and saying "removed" about a
 *  file that never had it would hide that. */
function removeRegistration(walletAddress) {
  const removedFrom = [];
  let remaining = 0;
  for (const [label, file] of [['registrations', REGISTRATIONS_FILE], ['airdrops', AIRDROPS_FILE]]) {
    const r = removeFromRegistration(file, walletAddress);
    if (r.removed) removedFrom.push(label);
    remaining = Math.max(remaining, r.remaining);
  }
  return { removedFrom, remaining };
}

function formatRemaining(ms) {
  if (ms <= 0) return 'now';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.ceil((ms % 3600000) / 60000);
  if (hours > 0) return `~${hours}h ${minutes}m`;
  return `~${minutes}m`;
}

// Shared with the website (src/faucet/claimStore.js) — reads the SAME
// atomic claim/cooldown store the !faucet command reserves against, so
// !whoami / !faucetstatus always agree with what a live claim attempt
// would see, including claims made through the website.
async function getSharedCooldownStatus(discordUserId, walletAddress) {
  const [userStatus, walletStatus] = await Promise.all([
    getStatusForUser(discordUserId),
    walletAddress ? getStatusForWallet(walletAddress) : Promise.resolve({ blocked: false, nextEligibleAt: null, lastClaim: null }),
  ]);
  const blocking = userStatus.blocked ? userStatus : (walletStatus.blocked ? walletStatus : null);
  return {
    blocked: !!blocking,
    nextEligibleAt: blocking ? blocking.nextEligibleAt : null,
    lastClaimSource: blocking?.lastClaim?.source || null,
  };
}

function redactRpcUrl(value) {
  const raw = String(value || 'https://solana-rpc.publicnode.com');
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname && parsed.pathname !== '/' ? '/…' : '';
    return `${parsed.origin}${path}`;
  } catch {
    return raw;
  }
}

async function getWinlewBalance(ownerPubkey) {
  const resp = await connection.getParsedTokenAccountsByOwner(ownerPubkey, { mint: TOKEN_MINT });
  if (!resp?.value?.length) return 0;
  return resp.value
    .map((a) => a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0)
    .reduce((sum, x) => sum + x, 0);
}

async function getResolvedWalletFromArgs(message, args) {
  const input = String(args?.[0] || '').trim();
  if (input) {
    const pubkey = await resolveSolanaAddress(input);
    return { input, pubkey, usedLinkedWallet: false, source: 'direct' };
  }

  const linked = getLinkedWallet(message.author.id, 'faucet');
  if (!linked?.address) return null;

  let pubkey;
  try {
    pubkey = new PublicKey(linked.address);
  } catch {
    throw new Error(`Saved wallet is invalid: ${linked.address}`);
  }

  return {
    input: linked.input || linked.address,
    pubkey,
    usedLinkedWallet: true,
    source: linked.source || 'unknown',
  };
}

function looksLikeSnsDomain(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input || input.includes(' ')) return false;
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(input);
}

async function resolveSolanaName(pubkeyString, conn = connection) {
  return sharedResolveSolanaName(pubkeyString, conn);
}

async function resolveSolanaAddress(address, conn = null) {
  address = String(address || '').trim();
  const now = Date.now();
  const cacheKey = address.toLowerCase();
  const cached = addressCache.get(cacheKey);
  if (cached && cached.expires > now) {
    console.log(`[DEBUG] Cache hit for: ${address} → ${cached.pubkey.toBase58()}`);
    return cached.pubkey;
  }

  const useConn = conn || connection;
  if (looksLikeSnsDomain(address)) {
    try {
      const resolved = await resolve(useConn, address);
      if (!resolved) throw new Error('Domain resolved to an empty address');
      addressCache.set(cacheKey, { pubkey: resolved, expires: now + 10 * 60 * 1000 });
      addressCache.set(resolved.toBase58(), { pubkey: resolved, expires: now + 10 * 60 * 1000 });
      console.log(`[DEBUG] SNS domain ${address} → ${resolved.toBase58()}`);
      return resolved;
    } catch (err) {
      throw new Error(`SNS: Could not resolve \`${address}\`: ${err.message || err}`);
    }
  }

  try {
    const pubkey = new PublicKey(address);
    addressCache.set(address, { pubkey, expires: now + 10 * 60 * 1000 });
    console.log(`[DEBUG] Direct pubkey: ${address} → ${pubkey.toBase58()}`);
    return pubkey;
  } catch {
    throw new Error(`Invalid Solana public key or SNS domain: ${address}`);
  }
}

const COOLDOWN_MS = FAUCET_COOLDOWN_MS;
const lastUsed = new Map();

// Guards against replying twice to the same message — e.g. a brief overlap
// where an old process is still connected to Discord while pm2 has already
// started its replacement (both sessions receive the same MESSAGE_CREATE).
const handledMessageIds = new Map();
const MESSAGE_DEDUPE_TTL_MS = 60_000;
function alreadyHandledMessage(messageId) {
  const now = Date.now();
  for (const [id, expiresAt] of handledMessageIds) {
    if (expiresAt <= now) handledMessageIds.delete(id);
  }
  if (handledMessageIds.has(messageId)) return true;
  handledMessageIds.set(messageId, now + MESSAGE_DEDUPE_TTL_MS);
  return false;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  if (alreadyHandledMessage(message.id)) return;
  const [rawCmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (rawCmd || '').toLowerCase();
  const commandAliases = {
    drip: 'faucet',
    save: 'register',
    menu: 'help',
    nav: 'navigation',
    socials: 'links',
    rpcstatus: 'rpc',
    endpoint: 'rpc',
  };
  const normalizedCmd = commandAliases[cmd] || cmd;
  const now = Date.now();
  const cooldownKey = `${normalizedCmd}:${message.author.id}`;

  try {
    switch (normalizedCmd) {
      case 'uptime': {
        const ms = process.uptime() * 1000;
        const s = Math.floor(ms / 1000) % 60;
        const m = Math.floor(ms / (1000 * 60)) % 60;
        const h = Math.floor(ms / (1000 * 60 * 60));
        await message.reply(`⏳ Uptime: ${h}h ${m}m ${s}s`);
        break;
      }
      case 'restart': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to restart the bot.');
          break;
        }
        await message.reply('♻️ Restarting bot...');
        await client.destroy().catch(() => {});
        process.exit(0);
        break;
      }
      case 'modhelp': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ This command is restricted.');
          break;
        }
        // Chunked, like !commands. The mod command list only grows — four
        // additions on 2026-08-15 pushed this past Discord's 2000-char limit,
        // where message.reply() throws and the mod gets nothing at all.
        await replyInChunks(message, buildModHelp({ prefix: PREFIX }));
        break;
      }
      case 'reverse': {
        const address = args[0];
        if (!address) {
          await message.reply('Usage: !reverse <Solana pubkey>');
          break;
        }
        try {
          const name = await resolveSolanaName(address);
          if (name) {
            await message.reply(`🔁 Reverse lookup: ${address} = \`${name}\``);
          } else {
            await message.reply(`No SNS primary domain found for ${address}.`);
          }
        } catch (err) {
          await message.reply(`❌ Error during reverse lookup: ${err.message || err}`);
        }
        break;
      }
      case 'balance': {
        const resolved = await getResolvedWalletFromArgs(message, args);
        if (!resolved) {
          await message.reply(
            'Usage: !balance <wallet-or-domain>\nTip: verify through Mole Guard or use `!register <wallet-or-domain>` once, then `!balance` works with your saved wallet.',
          );
          break;
        }

        const total = await getWinlewBalance(resolved.pubkey);
        const primaryName = await resolveSolanaName(resolved.pubkey.toBase58());
        const label = primaryName ? ` (${primaryName})` : '';

        if (!total) {
          await message.reply(`ℹ️ ${resolved.pubkey.toBase58()}${label} has no ${EFFECTIVE_TOKEN_SYMBOL} token account yet.`);
          break;
        }

        await message.reply(`🔍 Balance: ${fmtAmt(total)} ${EFFECTIVE_TOKEN_SYMBOL}\nWallet: \`${resolved.pubkey.toBase58()}\`${label}`);
        break;
      }
      case 'faucet': {
        // Resolve a direct argument (address or .sol domain) the same way
        // the original command always did — preserved for compatibility.
        // Everything past this point (wallet fallback, holder check,
        // cooldown, atomic reservation, payout) goes through the shared
        // claim service so Discord and the website can never disagree —
        // see src/faucet/service.js.
        const rawArg = String(args?.[0] || '').trim();
        let requestedWallet = null;
        if (rawArg) {
          let pubkey;
          try {
            pubkey = await resolveSolanaAddress(rawArg);
          } catch {
            await message.reply(`❌ Could not resolve wallet/domain: ${rawArg}`);
            break;
          }
          requestedWallet = pubkey.toBase58();
        }

        const result = await claimFaucet({
          discordUserId: message.author.id,
          source: 'discord',
          requestId: message.id,
          requestedWallet,
        });

        if (!result.ok) {
          switch (result.reason) {
            case 'not_enabled':
              await message.reply('🚧 The faucet is currently disabled.');
              break;
            case 'wallet_not_registered':
              await message.reply(
                `🔗 **Save that wallet first.**\n` +
                  `\`!drip\` pays the wallet saved to your account, so a one-off address isn't accepted any more — it left claims with nothing tying them to a Discord account.\n\n` +
                  `\`!register ${result.requestedWallet}\`\nthen just \`!drip\`.\n` +
                  (result.registeredWallet
                    ? `\n_You currently have \`${result.registeredWallet}\` saved. Registering replaces it._`
                    : ''),
              );
              break;
            case 'no_wallet':
              await message.reply(
                'Save your wallet once with `!register <wallet-or-domain>` (or verify through Mole Guard), then `!drip` on its own pays it.',
              );
              break;
            case 'invalid_wallet':
              await message.reply('❌ That saved wallet is invalid. Re-link it with `!register <wallet-or-domain>`.');
              break;
            case 'treasury_wallet':
              await message.reply('❌ That address belongs to the faucet treasury — it cannot claim from itself.');
              break;
            case 'below_holder_minimum': {
              const e = result.eligibility;
              await message.reply({
                content:
                  `❌ Holder-only faucet: your saved wallet must already hold at least ${fmtAmt(e.config.minHolderBalance)} $${e.config.tokenSymbol}.\n` +
                  `Wallet: \`${e.wallet.address}\`\nCurrent balance: ${fmtAmt(e.balance)}\n\n${WHY_HOLDER_ONLY}\n\n${BUY_WINLEW_NOTE}`,
                components: [buildBuyWinlewButtonsRow({ ActionRowBuilder, ButtonBuilder, ButtonStyle })],
              });
              break;
            }
            case 'holder_check_unavailable':
              await message.reply('⚠️ Could not verify your holder balance right now (RPC issue). Try again shortly.');
              break;
            case 'treasury_unavailable':
              await message.reply('⚠️ The faucet treasury is not configured. Please contact an admin.');
              break;
            // Deliberately does not say which wallet it matched or how. Naming
            // the linked address would tell someone probing the faucet exactly
            // which of their wallets is burned and what to avoid next time.
            // Mods get the full path from !faucetcluster.
            // Unlike the ban message, this one is completely explicit: the
            // user has done nothing wrong, they have simply reached the point
            // where the faucet asks who they are. Telling them exactly how to
            // clear it is the whole purpose.
            case 'verification_required': {
              const e = result.eligibility;
              const claimed = e?.claimCounts?.highest ?? e?.config?.verifyAfterClaims;
              const expired = e?.verification?.status === 'expired';
              await message.reply(
                `🔐 **Verification needed to keep claiming.**\n` +
                  `You've claimed ${claimed} times — after ${e?.config?.verifyAfterClaims}, the faucet asks you to verify your wallet once.\n\n` +
                  (expired
                    ? `Your verification has **expired** — re-verify to continue.\n`
                    : `It's a one-time signature that proves you own \`${e?.wallet?.address}\`. No tokens move and nothing is spent.\n`) +
                  `\n➡️ Verify here: <https://winlew.co/verify/>\n` +
                  `_Your cooldown isn't affected — claim again as soon as you're verified._`,
              );
              break;
            }
            case 'wallet_banned':
            case 'linked_to_banned':
              await message.reply(
                `🚫 This wallet is not eligible for the faucet. ${appealLineMarkdown()}`,
              );
              break;
            case 'cooldown': {
              const sourceLabel = result.lastClaimSource === 'web' ? 'the website' : result.lastClaimSource === 'discord' ? 'Discord' : 'a previous claim';
              // The sibling-wallet case is named plainly. Saying "you already
              // claimed" to someone whose wallet has never claimed reads as a
              // bug and generates support load; saying which WALLET would hand
              // a prober the map, so it says the rule instead.
              const line = result.otherWallet
                ? `⏳ Another wallet on your account already claimed via ${sourceLabel}. Try again in ${formatRemaining(result.nextEligibleAt - Date.now())}.\n` +
                  '_The faucet is one claim per person, not per wallet._'
                : `⏳ You already claimed via ${sourceLabel}. Try again in ${formatRemaining(result.nextEligibleAt - Date.now())}.\n` +
                  '_The Discord faucet and website faucet share one cooldown._';
              await message.reply(line);
              break;
            }
            case 'reconciling':
              // Show the proof whenever one exists. The transfer reached the
              // network — usually it has already landed and only the
              // confirmation call timed out — so withholding the signature told
              // the user less than we knew and left them nothing to check.
              await message.reply(
                result.signature
                  ? `⏳ Sent — waiting on network confirmation.\n` +
                    `Tx: <https://solscan.io/tx/${result.signature}>\n` +
                    '_Open the link to see it land. If it shows as finalized there, the tokens arrived — ' +
                    '`!faucetstatus` will catch up shortly._'
                  : '⚠️ Your last claim is still being verified on-chain — check `!faucetstatus` shortly before trying again.',
              );
              break;
            case 'payout_failed':
              await message.reply(`❌ ${result.error || 'Faucet claim failed.'}`);
              break;
            default:
              await message.reply(`❌ Faucet claim failed (${result.reason || 'unknown'}).`);
          }
          break;
        }

        const claim = result.claim;
        if (result.replay && claim.status !== 'confirmed') {
          await message.reply('⏳ Your claim is already being processed — one moment.');
          break;
        }

        try {
          const primaryName = await resolveSolanaName(claim.wallet);
          // New total balance post-claim, shown so LewCREW tier (1M/10M/100M)
          // can be checked and assigned by hand -- those tiers are
          // deliberately NOT auto-synced as Discord roles (role-slot limits),
          // see guildRoles.js's roleCatalog().
          const newTotal = await getWinlewBalance(new PublicKey(claim.wallet)).catch(() => null);
          await message.reply(
            `💧 Dripped ${fmtAmt(claim.amountDisplay)} ${EFFECTIVE_TOKEN_SYMBOL} to \`${claim.wallet}\`${primaryName ? ` (${primaryName})` : ''}.\n` +
              `Tx: <https://solscan.io/tx/${claim.signature}>\n` +
              (newTotal != null ? `New total: ${fmtAmt(newTotal)} ${EFFECTIVE_TOKEN_SYMBOL}\n` : '') +
              '_Holder faucet confirmed._',
          );
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Faucet reply ERROR for ${claim.wallet}:`, err);
        }
        break;
      }
      // Public on purpose. Enforcement people cannot inspect is not a rule,
      // and someone who suspects they have been treated unfairly should not
      // have to ask a mod what the rules even are.
      case 'abuse': {
        // Every link is wrapped in <> — this file's convention for keeping
        // Discord from unfurling a preview on each one (see f2fff3d).
        await message.reply(
            '🛡️ **Abuse & Enforcement — how we decide**\n' +
            'The faucet gives away real tokens, so a few people running several accounts each take what was meant for everybody. The whole method is public:\n' +
            '<https://winlew.co/policies/abuse/>\n\n' +
            '**Who** — a human moderator decides. Every detection tool is advisory; none can ban anyone.\n' +
            '**What** — running more than one identity to take more than one share. Claiming often is *not* abuse.\n' +
            '**When** — verification is asked for after 10 lifetime claims. Anything stronger needs independent signals agreeing, reviewed by hand.\n' +
            '**Where** — think we got it wrong? Open a ticket. You will be shown what was found, and every action is reversible.\n\n' +
            '_We collect no location, no device fingerprints, and no tracking — only public on-chain data and claims you made on purpose._',
        );
        break;
      }
      // ── Faucet ban tooling (mods only) ──────────────────────────────────
      // Inspect first, then decide. !faucetcluster is read-only on purpose:
      // a funding edge is strong evidence but not proof of identity — two
      // people can share a funder — so a human looks before anything is
      // refused. See src/faucet/walletLinkage.js for what the signal does and
      // does not mean.
      case 'faucetcluster': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) { await message.reply('Usage: !faucetcluster <wallet>'); break; }
        await message.reply('🔎 Walking the funding graph — this reads the chain, give it a moment…');
        try {
          const cluster = await describeCluster(args[0]);
          const lines = cluster.members.map((m) => {
            const flag = m.banned ? (m.reviewOnly ? ' ⚠️ review-only' : ' 🚫 BANNED') : '';
            const partial = m.scanTruncated ? ' _(scan hit its page limit — may be incomplete)_' : '';
            // Weak members are early counterparties, not parentage. A ban never
            // reaches them and they must not read like it might.
            const weak = m.weak ? ' _(weak: transacted early, did NOT create it)_' : '';
            return `${m.weak ? '◦' : '•'} \`${m.wallet}\` — depth ${m.depth}, ${m.via}${flag}${weak}${partial}`;
          });
          await message.reply(
            `**Cluster for \`${cluster.wallet}\`** — ${cluster.members.length} address(es)\n` +
              lines.join('\n').slice(0, 1700) +
              (cluster.degraded ? '\n\n⚠️ _The chain was not fully reachable; this is local knowledge only and may be incomplete._' : '') +
              '\n_Only • entries (account creation) are edges a ban follows. ◦ entries are early counterparties — context only. A shared creator is evidence, not proof of identity._',
          );
        } catch (err) {
          await message.reply(`❌ Cluster lookup failed: ${err?.message || err}`);
        }
        break;
      }
      // Accounts that keep claiming together, across days. Repetition is the
      // signal — one shared burst is just a faucet announcement bringing a
      // crowd. Review only; it never bans anything.
      case 'faucetcotiming': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        const windowMinutes = Math.max(1, Math.min(120, Number(args[0]) || 10));
        const minDays = Math.max(1, Math.min(30, Number(args[1]) || 2));
        const lookbackDays = Math.max(1, Math.min(365, Number(args[2]) || 90));
        try {
          const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
          const claims = await listClaimsSince(since);
          const pairs = findCoTimingPairs(claims, { windowMs: windowMinutes * 60_000, minDays });
          if (!pairs.length) {
            await message.reply(
              `No account pairs claimed together on ${minDays}+ separate days ` +
                `(within ${windowMinutes}m, last ${lookbackDays} days, ${claims.length} claims examined).`,
            );
            break;
          }
          const lines = [];
          for (const pair of pairs.slice(0, 10)) {
            const [a, b] = pair.accounts;
            // Two independent signals agreeing is what's worth acting on: a
            // pair that also shares a funding edge is a much stronger case
            // than either signal alone.
            let linked = false;
            try {
              const walletA = pair.wallets[a][0];
              const walletB = pair.wallets[b][0];
              if (walletA && walletB) {
                const cluster = await describeCluster(walletA, { maxDepth: 2 });
                linked = cluster.members.some((m) => m.wallet === walletB);
              }
            } catch { /* linkage is a bonus here, never the point */ }
            lines.push(
              `• <@${a}> + <@${b}> — **${pair.dayCount} separate days**, closest ${formatGap(pair.tightestGapMs)}` +
                `${linked ? '  🔗 **also funding-linked on-chain**' : ''}\n` +
                `   days: ${pair.days.slice(-6).join(', ')}`,
            );
          }
          await message.reply(
            `**Accounts claiming together** — within ${windowMinutes}m, on ${minDays}+ days, last ${lookbackDays} days\n` +
              lines.join('\n').slice(0, 1700) +
              '\n\n_Review only. Claiming together does not prove one person — friends who ping each other when the faucet refills look identical here. Check `!faucetcluster`, and whether the tokens later end up in one wallet, before acting._',
          );
        } catch (err) {
          await message.reply(`❌ Co-timing review failed: ${err?.message || err}`);
        }
        break;
      }
      // What one account has actually received, across every reward path.
      // The faucet's own counter answers "how many drips", which understated a
      // heavy account by roughly ten times — most of its payouts came from quiz
      // and games on the same shared reserve wallet.
      // HODL Rewards had a page, a payout worker and a news article before it
      // had a single Discord command, and nothing in !help mentioned it
      // (2026-08-16, owner spotted it).
      //
      //   !hodl           explain the system            PUBLIC
      //   !hodl me        what YOU have earned          PUBLIC, self only
      //   !hodl preview   the planned next payout       MOD ONLY, READ-ONLY
      //
      // THERE IS DELIBERATELY NO `!hodl pay`. Paying is the one thing that
      // stays on the CLI, behind `npm run hodl:pay -- --apply`, and the reasons
      // are written into that script rather than invented here: dry run is the
      // default because it moves real tokens, it requires a reconcile pass
      // first, and its own header records that this repo "has twice paid people
      // twice". A chat command is one typo, one stale scrollback, or one
      // compromised moderator account away from doing it a third time — and
      // unlike every other command here, that mistake cannot be undone.
      case 'hodl': {
        const sub = String(args[0] || '').trim().toLowerCase();
        try {
          const { LIMITS, DEFAULT_EPOCH_PARAMS } = await import('../mole/hodlEpochs.js');
          const hodl = await import('../mole/hodlStore.js');
          await hodl.refreshHodlStore().catch(() => {});
          const n = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
          const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const epoch = hodl.getActiveEpoch();

          // ── !hodl me ───────────────────────────────────────────────────────
          // Self only. Reading someone else's payout history is not a thing a
          // public command should offer, and `!rewards <@user>` already exists
          // for moderators who need it.
          if (sub === 'me' || sub === 'mine') {
            const mine = [];
            for (const e of hodl.listEpochs()) {
              for (const snap of hodl.listSnapshots(e.id)) {
                if (snap.status !== 'paid' && snap.status !== 'partial') continue;
                for (const a of snap.allocations || []) {
                  if (String(a.discordUserId) === String(message.author.id) && Number(a.amount) > 0) {
                    mine.push({ week: snap.weekIndex, amount: Number(a.amount), epochId: e.id });
                  }
                }
              }
            }
            if (!mine.length) {
              await message.reply(
                '💎 **HODL Rewards — you**\n' +
                'No HODL payouts recorded for your account yet.\n' +
                `To qualify: hold at least **${n(epoch?.minHold ?? DEFAULT_EPOCH_PARAMS.minHold)} WinLEW**, be verified, and have a payout wallet linked.\n` +
                'Details: <https://winlew.co/hodl/>'
              );
              break;
            }
            const total = mine.reduce((sum, x) => sum + x.amount, 0);
            const recent = mine.slice(-5).reverse().map((x) => `• week ${x.week}: **${n(x.amount)}** WinLEW`);
            await message.reply(
              '💎 **HODL Rewards — you**\n' +
              `**${n(total)} WinLEW** across **${mine.length}** payout(s)\n\n` +
              recent.join('\n') +
              (mine.length > 5 ? `\n_…and ${mine.length - 5} earlier._` : '') +
              '\n\nFull history: <https://winlew.co/hodl/>'
            );
            break;
          }

          // ── !hodl preview ──────────────────────────────────────────────────
          if (sub === 'preview' || sub === 'next') {
            if (!MOD_ID_LIST.includes(message.author.id)) {
              await message.reply('❌ `!hodl preview` is moderator-only. Try `!hodl` or `!hodl me`.');
              break;
            }
            if (!epoch) { await message.reply('⏸️ No active epoch — nothing is planned.'); break; }
            const snaps = hodl.listSnapshots(epoch.id).sort((a, b) => b.weekIndex - a.weekIndex);
            const latest = snaps[0];
            if (!latest) { await message.reply(`📋 Epoch \`${epoch.id}\` is active but no week has been snapshotted yet.`); break; }
            const alloc = (latest.allocations || []).filter((a) => Number(a.amount) > 0);
            await message.reply(
              '📋 **HODL — latest planned week** _(read-only)_\n' +
              `Epoch \`${epoch.id}\`, week **${latest.weekIndex}** — status **${latest.status}**\n` +
              `**${alloc.length}** qualifying participant(s), **${n(latest.totalAllocated || 0)}** WinLEW allocated\n\n` +
              '_This command cannot pay anything. Run `npm run hodl:pay` on the host for a dry run, ' +
              'and `-- --apply` only after reconciling._'
            );
            break;
          }

          // ── !hodl ──────────────────────────────────────────────────────────
          const lines = ['💎 **HODL Rewards** — <https://winlew.co/hodl/>', ''];
          if (!epoch) {
            lines.push('⏸️ **No active epoch right now.** Nothing is being paid until governance activates the next one.');
          } else {
            const day = Number(epoch.payoutDay ?? DEFAULT_EPOCH_PARAMS.payoutDay);
            const paid = hodl.listSnapshots(epoch.id).filter((sn) => sn.status === 'paid' || sn.status === 'partial');
            const distributed = paid.reduce((sum, sn) => sum + Number(sn.totalAllocated || 0), 0);
            lines.push(
              `**Pool:** ${n(epoch.weeklyPool)} WinLEW per week, paid on **${DAYS[day] || 'schedule'}s**`,
              `**To qualify:** hold at least **${n(epoch.minHold)} WinLEW**, verified, with a payout wallet linked`,
              `**Paid so far this epoch:** ${n(distributed)} WinLEW across ${paid.length} week(s)`,
            );
          }
          lines.push(
            '',
            '**Limits governance cannot raise:**',
            `• max **${n(LIMITS.MAX_WEEKLY_POOL)}** per week`,
            `• max **${n(LIMITS.MAX_PER_PARTICIPANT_WEEK)}** to any one person per week`,
            `• max **${LIMITS.MAX_POV_BONUS_MULTIPLIER}x** Proof of Value bonus (it redistributes the pool, never enlarges it)`,
            '',
            '`!hodl me` — what you have earned',
            '',
            '_Not an investment product. The pool is a fixed number of tokens, not a fixed value._',
          );
          await message.reply(lines.join('\n'));
        } catch (e) {
          await message.reply('⚠️ Could not read HODL status right now. <https://winlew.co/hodl/> has the details.');
          console.warn('[hodl] command failed:', e?.message || e);
        }
        break;
      }
      case 'rewards': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        const target = (message.mentions?.users?.first()?.id) || String(args[0] || '').replace(/[^0-9]/g, '');
        if (!target) { await message.reply('Usage: !rewards <@user or discord-id>'); break; }
        try {
          const { getLifetimeRewards } = await import('../mole/rewardTotals.js');
          const r = await getLifetimeRewards(target);
          const n = (v) => Number(v || 0).toLocaleString();
          await message.reply(
            `📊 **Lifetime rewards — <@${target}>**\n` +
              `**${n(r.totalWinlew)} ${EFFECTIVE_TOKEN_SYMBOL}** received in total\n\n` +
              `💧 Faucet — ${r.faucet ? `${r.faucet.claims} claims, ${n(r.faucet.winlew)}` : 'unavailable'}\n` +
              `🧠 Quiz — ${r.quiz ? `${r.quiz.redemptions} redemptions, ${n(r.quiz.winlew)}${r.quiz.pending ? ` (+${r.quiz.pending} unpaid)` : ''}` : 'unavailable'}\n` +
              `🎮 Games — ${r.games ? `${r.games.claims} claims, ${n(r.games.winlew)}${r.games.pendingWinlew ? ` (+${n(r.games.pendingWinlew)} pending)` : ''}` : 'unavailable'}\n` +
              (r.complete
                ? ''
                : `\n⚠️ _Incomplete — could not read: ${r.unavailable.join('; ')}. The total covers only the sources that answered._`),
          );
        } catch (err) {
          await message.reply(`❌ Reward lookup failed: ${err?.message || err}`);
        }
        break;
      }
      case 'ipban': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) {
          await message.reply(
            `Usage: \`${PREFIX}ipban <ip> [--ttl 24h] [reason]\`\n` +
            '_Exact IPs only. This blocks Mole Guard web requests before wallet login, faucet claim, quiz, or profile routes._',
          );
          break;
        }
        try {
          await refreshIpDenylist({ maxAgeMs: 0 }).catch(() => {});
          const parsed = parseIpBanArgs(args);
          const ip = normalizeIpBanTarget(parsed.ip);
          const ban = addIpBan(ip, {
            reason: parsed.reason,
            ttlMs: parsed.ttlMs,
            bannedBy: message.author.tag || message.author.id,
          });
          await message.reply(
            `🚫 IP blocked: \`${ban.ip}\`\n` +
            `Expires: ${formatIpBanExpiry(ban.expiresAt)}\n` +
            `${ban.reason ? `Reason: ${ban.reason}\n` : ''}` +
            '_This uses the same client-IP identity as the web rate limiter. If `WEB_PROXY_SHARED_SECRET` is unset, proxied visitors can collapse into one shared bucket._',
          );
        } catch (err) {
          const msg = String(err?.message || err);
          await message.reply(
            msg.startsWith('not_an_ip_address')
              ? '❌ That is not a valid IP literal. Use an exact IPv4/IPv6 address.'
              : msg.startsWith('invalid_ttl')
                ? '❌ TTL must look like `15m`, `2h`, `3d`, or `1w`.'
                : `❌ IP ban failed: ${msg}`,
          );
        }
        break;
      }
      case 'ipunban': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) {
          await message.reply(`Usage: \`${PREFIX}ipunban <ip>\``);
          break;
        }
        try {
          await refreshIpDenylist({ maxAgeMs: 0 }).catch(() => {});
          const ip = normalizeIpBanTarget(args[0]);
          await message.reply(removeIpBan(ip) ? `✅ IP unbanned: \`${ip}\`` : `ℹ️ \`${ip}\` was not on the IP denylist.`);
        } catch (err) {
          const msg = String(err?.message || err);
          await message.reply(msg.startsWith('not_an_ip_address')
            ? '❌ That is not a valid IP literal.'
            : `❌ IP unban failed: ${msg}`);
        }
        break;
      }
      case 'ipbans': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        await refreshIpDenylist({ maxAgeMs: 0 }).catch(() => {});
        const bans = listIpBans();
        if (!bans.length) {
          await message.reply('✅ No IP bans recorded.');
          break;
        }
        await replyInChunks(
          message,
          `🚫 **${bans.length} IP ban${bans.length === 1 ? '' : 's'}**\n\n` +
            bans.slice(0, 25).map((b) =>
              `• \`${b.ip}\` — expires ${formatIpBanExpiry(b.expiresAt)} — by ${b.bannedBy || 'unknown'}` +
              `${b.reason ? `\n  ${b.reason}` : ''}`,
            ).join('\n'),
        );
        break;
      }
      case 'faucetban': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) {
          await message.reply('Usage: !faucetban <wallet> [reason]\nTip: `!faucetban <wallet> --review <reason>` records it without refusing claims yet.');
          break;
        }
        try {
          const reviewOnly = args.includes('--review');
          const reason = args.slice(1).filter((a) => a !== '--review').join(' ');
          const ban = banWallet(args[0], { reason, bannedBy: message.author.tag || message.author.id, reviewOnly });
          await message.reply(
            `${reviewOnly ? '⚠️ Recorded (review-only, claims still allowed)' : '🚫 Banned'}: \`${ban.wallet}\`` +
              `${ban.reason ? `\nReason: ${ban.reason}` : ''}\n` +
              `_Wallets funded by this one, up to ${getFaucetConfig().linkageMaxDepth} hops, are refused too. Check with \`!faucetcluster ${ban.wallet}\`._`,
          );
        } catch (err) {
          await message.reply(`❌ Ban failed: ${err?.message || err}`);
        }
        break;
      }
      case 'faucetbanuser': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) {
          await message.reply(
            `Usage: \`${PREFIX}faucetbanuser <discord-id-or-@mention> [reason]\`\n` +
            `Tip: \`--review\` records a suspicion without refusing anyone yet.\n` +
            '_Bans the ACCOUNT, so a fresh wallet does not reset it. Wallet bans are `!faucetban`._');
          break;
        }
        try {
          const reviewOnly = args.includes('--review');
          const reason = args.slice(1).filter((a) => a !== '--review').join(' ');
          const ban = banUser(args[0], { reason, bannedBy: message.author.tag || message.author.id, reviewOnly });
          await message.reply(
            `${reviewOnly ? '⚠️ Recorded (review-only, claims still allowed)' : '🚫 Account banned'}: <@${ban.userId}> (\`${ban.userId}\`)` +
            `${ban.reason ? `\nReason: ${ban.reason}` : ''}\n` +
            `_Blocks faucet claims and quiz redemption for this account on any wallet. It does NOT remove them from the server — use Discord's own ban for that._`);
        } catch (err) {
          await message.reply(`❌ ${String(err?.message || err).startsWith('not_a_discord_user_id') ? 'That is not a Discord user ID. Right-click the user → Copy User ID (Developer Mode), or @mention them.' : `Ban failed: ${err?.message || err}`}`);
        }
        break;
      }
      case 'faucetunbanuser': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) { await message.reply(`Usage: \`${PREFIX}faucetunbanuser <discord-id-or-@mention>\``); break; }
        try {
          const removed = unbanUser(args[0]);
          await message.reply(removed
            ? `✅ Account unbanned: <@${removed.userId}>`
            : 'That account was not on the ban list.');
        } catch (err) {
          await message.reply(`❌ ${err?.message || err}`);
        }
        break;
      }
      case 'faucetbanusers': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        const bans = listUserBans();
        if (!bans.length) { await message.reply('✅ No accounts are banned.'); break; }
        await replyInChunks(message, [
          `🚫 **${bans.length} account ban${bans.length === 1 ? '' : 's'}**`,
          '',
          ...bans.slice(0, 25).map((b) => {
            const when = b.bannedAt ? new Date(b.bannedAt).toISOString().slice(0, 10) : '?';
            return `• <@${b.userId}> \`${b.userId}\` — ${when}${b.reviewOnly ? ' · **review-only, not enforced**' : ''}` +
                   `${b.reason ? `\n  ${b.reason}` : ''}`;
          }),
          '',
          `_Review-only entries refuse nobody. Re-run \`${PREFIX}faucetbanuser <id> <reason>\` without \`--review\` to enforce._`,
        ].join('\n'));
        break;
      }
      case 'unregister': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) {
          await message.reply(
            `Usage: \`${PREFIX}unregister <wallet>\`\n` +
            '_Removes a wallet from the airdrop registry. A faucet ban does NOT do this on its own — a banned wallet stays queued for an airdrop until it is removed here._');
          break;
        }
        try {
          const address = new PublicKey(String(args[0]).trim()).toBase58();
          const removed = removeRegistration(address);
          await message.reply(removed.removedFrom.length
            ? `✅ Removed \`${address}\` from ${removed.removedFrom.join(' and ')}.\n_${removed.remaining} wallet${removed.remaining === 1 ? '' : 's'} still registered._`
            : `That wallet was not on the airdrop registry.`);
        } catch (err) {
          await message.reply(`❌ ${err?.message?.includes('base58') || err?.message?.includes('Invalid') ? 'That is not a valid Solana address.' : `Unregister failed: ${err?.message || err}`}`);
        }
        break;
      }
      case 'faucetunban': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        if (!args[0]) { await message.reply('Usage: !faucetunban <wallet>'); break; }
        try {
          await message.reply(unbanWallet(args[0]) ? `✅ Unbanned \`${args[0]}\`.` : `ℹ️ \`${args[0]}\` was not banned.`);
        } catch (err) {
          await message.reply(`❌ Unban failed: ${err?.message || err}`);
        }
        break;
      }
      // ── Held quiz payouts (Stage 4) ──────────────────────────────────
      // A held payout is a PAUSE, not a rejection. The points stay earned and
      // the record stays queued; approving puts it straight back in the
      // settlement queue. Rejecting is the only path that removes a payout and
      // it needs a human and a reason — never the automatic result of a score.
      case 'quizreview': {
        if (!canReviewPayouts(message)) {
          await message.reply(reviewerDeniedMessage());
          break;
        }
        const quizDb = await import('../quiz/db.js');
        const held = quizDb.default.listHeldRedemptions();
        if (!held.length) { await message.reply('✅ No quiz payouts are held for review.'); break; }

        const id = args[0];
        if (!id) {
          // Deadlines, not just signals. A queue that shows what is waiting but
          // not for how long is how something sits unreviewed for a fortnight.
          const { classifyHold, resolveReviewConfig } = await import('../quiz/reviewQueue.js');
          const reviewConfig = resolveReviewConfig();
          const nowMs = Date.now();
          const lines = held.slice(0, 15).map((r) => {
            const band = r.risk?.band || '?';
            const score = r.risk?.score ?? '?';
            const verdict = classifyHold(r, { now: nowMs, config: reviewConfig });
            const hours = Math.floor(verdict.ageMs / 3_600_000);
            const when = verdict.hard
              ? '**needs a decision — will not auto-release**'
              : verdict.dueAt
                ? `releases in ${Math.max(0, Math.floor((verdict.dueAt - nowMs) / 3_600_000))}h`
                : 'no hold timestamp — please look';
            return `• \`${r.id}\` — <@${r.userId}> · ${r.amount} pts · **${band}** (${score}) · held ${hours}h · ${when}\n  ${(r.risk?.signals || []).join(', ') || 'no signals recorded'}`;
          });
          await replyInChunks(message, [
            `🔍 **${held.length} quiz payout${held.length === 1 ? '' : 's'} held for review**`,
            '',
            ...lines,
            '',
            reviewConfig.autoReleaseEnabled
              ? `_Soft holds auto-release after ${reviewConfig.slaHours}h — nothing sits here forever unpaid._`
              : '_⚠️ Auto-release is DISABLED — nothing here will ever pay itself out._',
            `Inspect one: \`${PREFIX}quizreview <id>\` · Approve: \`${PREFIX}quizapprove <id>\` · Reject: \`${PREFIX}quizreject <id> <reason>\``,
          ].join('\n'));
          break;
        }

        const rec = held.find((r) => r.id === id);
        if (!rec) { await message.reply('No held payout with that ID.'); break; }
        await message.reply([
          `🔍 **Held payout \`${rec.id}\`**`,
          `• User: <@${rec.userId}>`,
          `• Points: **${rec.amount}** · Kind: ${rec.kind}`,
          `• Wallet: \`${rec.payoutWallet || 'not linked'}\``,
          `• Band: **${rec.risk?.band || '?'}** (score ${rec.risk?.score ?? '?'})`,
          `• Signals: ${(rec.risk?.signals || []).join(', ') || 'none recorded'}`,
          `• Rules: \`${rec.risk?.rulesVersion || '?'}\``,
          `• Held: ${rec.heldTs ? new Date(rec.heldTs).toISOString() : '?'}`,
          ...(await (async () => {
            const { classifyHold, resolveReviewConfig } = await import('../quiz/reviewQueue.js');
            const v = classifyHold(rec, { config: resolveReviewConfig() });
            return [v.hard
              ? '• Auto-release: **no** — linked to a banned wallet, so a timer must not overrule the human who banned it.'
              : v.dueAt
                ? `• Auto-releases: ${new Date(v.dueAt).toISOString()} if nobody decides`
                : '• Auto-release: cannot age this one — no hold timestamp.'];
          })()),
          ...formatProvenanceLines(rec.firstPayoutCheck),
          '',
          '_Signals are hashed correlations, not proof. A shared household device can produce them._',
        ].join('\n'));
        break;
      }
      case 'quizwatch': {
        if (!canReviewPayouts(message)) { await message.reply(reviewerDeniedMessage()); break; }
        const quizDb = await import('../quiz/db.js');
        const target = args[0];

        if (!target) {
          const list = quizDb.default.listWatchlist();
          if (!list.length) { await message.reply('✅ Nobody is on the payout watchlist.'); break; }
          const lines = list
            .sort((a, b) => a.addedTs - b.addedTs)
            .slice(0, 20)
            .map((e) => {
              const hours = Math.floor((Date.now() - Number(e.addedTs || 0)) / 3_600_000);
              return `• <@${e.userId}> — flagged ${hours}h ago · ${(e.signals || []).join(', ') || 'review'}\n  \`${PREFIX}quizwatch ${e.userId}\` · \`${PREFIX}quizclear ${e.userId} <note>\``;
            });
          await replyInChunks(message, [
            `👀 **${list.length} on the payout watchlist**`,
            '',
            ...lines,
            '',
            '_Each was **paid in full** on their first payout. Their next one is held until someone clears them._',
            '_Clearing is the normal outcome — being funded by a friend who plays here is ordinary._',
          ].join('\n'));
          break;
        }

        const userId = target.replace(/[<@!>]/g, '');
        const entry = quizDb.default.getWatchlistEntry(userId);
        if (!entry) { await message.reply('That user is not on the watchlist.'); break; }
        const hours = Math.floor((Date.now() - Number(entry.addedTs || 0)) / 3_600_000);
        await replyInChunks(message, [
          `👀 **Watchlist — <@${entry.userId}>**`,
          `• Flagged: ${hours}h ago · reason \`${entry.reason}\``,
          `• Signals: ${(entry.signals || []).join(', ') || 'none recorded'}`,
          `• Wallet: \`${entry.wallet || 'unknown'}\``,
          `• First payout: \`${entry.redemptionId || '?'}\` — **paid in full**`,
          entry.clearedTs
            ? `• ✅ Cleared ${new Date(entry.clearedTs).toISOString()} by <@${entry.clearedBy}>${entry.note ? ` — ${entry.note}` : ''}`
            : `• ⏳ Not yet cleared — their next payout is held. \`${PREFIX}quizclear ${entry.userId} <note>\``,
          ...formatProvenanceLines(entry.report),
        ].join('\n'));
        break;
      }
      case 'quizclear': {
        if (!canReviewPayouts(message)) { await message.reply(reviewerDeniedMessage()); break; }
        const note = args.slice(1).join(' ').trim();
        if (!args[0] || !note) {
          // A note is required for the same reason !quizreject needs a reason:
          // this is a decision about somebody's money, and it should never be
          // possible to make one without leaving a record of why.
          await message.reply(`Usage: \`${PREFIX}quizclear <userId> <note>\` — a note is required.`);
          break;
        }
        const quizDb = await import('../quiz/db.js');
        const userId = args[0].replace(/[<@!>]/g, '');
        const res = quizDb.default.clearWatchlist({ userId, byDiscordUserId: message.author.id, note });
        const freed = (res.released || []).length;
        await message.reply(res.ok
          ? `✅ Cleared <@${userId}> — ${note}\n_Their payouts settle normally from now on.${freed ? ` ${freed} held payout${freed === 1 ? '' : 's'} released — paying on the next scan.` : ''}_`
          : `❌ ${res.error}`);
        break;
      }
      case 'quizapprove': {
        if (!canReviewPayouts(message)) {
          await message.reply(reviewerDeniedMessage());
          break;
        }
        if (!args[0]) { await message.reply(`Usage: \`${PREFIX}quizapprove <id>\``); break; }
        const quizDb = await import('../quiz/db.js');
        const res = quizDb.default.approveHeldRedemption({ id: args[0], byDiscordUserId: message.author.id });
        await message.reply(res.ok
          ? `✅ Approved \`${args[0]}\` — back in the settlement queue, it will pay on the next run.`
          : `❌ ${res.error}`);
        break;
      }
      case 'quizreject': {
        if (!canReviewPayouts(message)) {
          await message.reply(reviewerDeniedMessage());
          break;
        }
        const reason = args.slice(1).join(' ').trim();
        if (!args[0] || !reason) {
          // A reason is required, not optional: this is the one action that
          // removes someone's earned payout, and it should never be possible
          // to do it without saying why.
          await message.reply(`Usage: \`${PREFIX}quizreject <id> <reason>\` — a reason is required.`);
          break;
        }
        const quizDb = await import('../quiz/db.js');
        const res = quizDb.default.rejectHeldRedemption({ id: args[0], byDiscordUserId: message.author.id, reason });
        await message.reply(res.ok ? `🚫 Rejected \`${args[0]}\` — ${reason}` : `❌ ${res.error}`);
        break;
      }
      case 'faucetbans': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        const bans = listBans();
        if (!bans.length) { await message.reply('No faucet bans recorded.'); break; }
        await message.reply(
          `**${bans.length} faucet ban(s)**\n` +
            bans.slice(0, 25).map((b) =>
              `• \`${b.wallet}\`${b.reviewOnly ? ' _(review-only)_' : ''} — ${b.reason || 'no reason given'} — by ${b.bannedBy || 'unknown'}`,
            ).join('\n').slice(0, 1800),
        );
        break;
      }
      case 'send': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ You are not authorized to use this command.');
          break;
        }
        const address = args[0];
        if (!address) {
          await message.reply('Usage: !send <Your Solana ADDRESS or .sol>');
          break;
        }
        let recipient;
        try {
          recipient = await resolveSolanaAddress(address);
        } catch {
          await message.reply('❌ Invalid address or SNS domain');
          break;
        }
        if (recipient.equals(BOT_KEYPAIR.publicKey)) {
          await message.reply("❌ Cannot send tokens to the bot's own address!");
          break;
        }
        if (now < (lastUsed.get(cooldownKey) || 0)) {
          const hours = Math.ceil(((lastUsed.get(cooldownKey) || 0) - now) / 3600000);
          await message.reply(`⏳ Please wait ~${hours}h to use that command again.`);
          break;
        }
        lastUsed.set(cooldownKey, now + COOLDOWN_MS);
        try {
          const fromAta = await splTokenPkg.getAssociatedTokenAddress(TOKEN_MINT, BOT_KEYPAIR.publicKey);
          if (!(await connection.getAccountInfo(fromAta, 'confirmed'))) {
            throw new Error(`source_ata_missing:${fromAta.toBase58()}`);
          }
          const toAta = await splTokenPkg.getAssociatedTokenAddress(TOKEN_MINT, recipient);
          const tx = new Transaction();
          if (!(await connection.getAccountInfo(toAta, 'confirmed'))) {
            tx.add(splTokenPkg.createAssociatedTokenAccountInstruction(BOT_KEYPAIR.publicKey, toAta, recipient, TOKEN_MINT));
          }
          tx.add(splTokenPkg.createTransferInstruction(
            fromAta,
            toAta,
            BOT_KEYPAIR.publicKey,
            DRIP_AMOUNT * 1e6,
          ));
          const latest = await connection.getLatestBlockhash('confirmed');
          tx.recentBlockhash = latest.blockhash;
          tx.feePayer = BOT_KEYPAIR.publicKey;
          tx.sign(BOT_KEYPAIR);
          const sig = await connection.sendRawTransaction(tx.serialize());
          const result = await confirmSignatureByPolling(connection, {
            signature: sig,
            lastValidBlockHeight: latest.lastValidBlockHeight,
            commitment: 'confirmed',
          });
          if (result?.value?.err) {
            throw new Error(`transaction confirmed with on-chain error: ${JSON.stringify(result.value.err)}`);
          }
          await message.reply(
            `✅ Sent ${DRIP_AMOUNT} ${EFFECTIVE_TOKEN_SYMBOL}! Tx: <https://solscan.io/tx/${sig}>\n_If you don't see the transaction on Solscan right away, please wait a minute and check again!_`,
          );
        } catch (err) {
          if (
            err.name === 'TransactionExpiredBlockheightExceededError' ||
            (err.message && err.message.includes('block height exceeded'))
          ) {
            await message.reply(
              '⏰ Transaction expired (block height exceeded). The Solana network was too slow or the transaction was sent too late. Please try again!',
            );
            break;
          }
          console.error(`[${new Date().toISOString()}] Send ERROR for ${address}:`, err);
          await message.reply(`❌ Failed to send: ${err.message || err}`);
        }
        break;
      }
      case 'register':
      case 'setwallet':
      case 'linkwallet': {
        const input = args[0];
        if (!input) {
          await message.reply('Usage: !register <wallet-or-domain> (alias: !save <wallet-or-domain>)');
          break;
        }

        let recipient;
        try {
          recipient = await resolveSolanaAddress(input);
        } catch (err) {
          await message.reply(`❌ Could not save that wallet: ${err.message || err}`);
          break;
        }

        const address = recipient.toBase58();
        setLinkedWallet(message.author.id, input, address);
        appendUniqueRegistration(REGISTRATIONS_FILE, address);
        appendUniqueRegistration(AIRDROPS_FILE, address);

        const balance = await getWinlewBalance(recipient).catch(() => 0);
        const primaryName = await resolveSolanaName(address);
        await message.reply(
          `✅ Saved wallet for <@${message.author.id}>\n` +
            `Wallet: \`${address}\`${primaryName ? ` (${primaryName})` : ''}\n` +
            `Current $${EFFECTIVE_TOKEN_SYMBOL} balance: ${fmtAmt(balance)}\n` +
            'You can now use `!drip` with no arguments. This also marks the wallet for payouts and airdrops.',
        );
        break;
      }
      case 'mywallet':
      case 'savedwallet': {
        const linked = getLinkedWallet(message.author.id, 'faucet');
        if (!linked?.address) {
          await message.reply('ℹ️ No faucet wallet is saved yet. Link through Mole Guard or use `!register <wallet-or-domain>` / `!save <wallet-or-domain>`.');
          break;
        }
        const balance = await getWinlewBalance(new PublicKey(linked.address)).catch(() => 0);
        const primaryName = await resolveSolanaName(linked.address);
        await message.reply(
          `👛 Saved wallet: \`${linked.address}\`${primaryName ? ` (${primaryName})` : ''}
` +
            `Original input: ${linked.input || linked.address}
` +
            `Source: ${describeLinkedWalletSource(linked.source)}
` +
            `Current $${EFFECTIVE_TOKEN_SYMBOL} balance: ${fmtAmt(balance)}`,
        );
        break;
      }
      case 'whoami':
      case 'me': {
        const linked = getLinkedWallet(message.author.id, 'faucet');
        if (!linked?.address) {
          await message.reply(
            `👤 ${message.author.username}
` +
              `Discord ID: \`${message.author.id}\`
` +
              'No faucet wallet is saved yet. Use `!register <wallet-or-domain>` or link through Mole Guard.',
          );
          break;
        }

        const balance = await getWinlewBalance(new PublicKey(linked.address)).catch(() => 0);
        const primaryName = await resolveSolanaName(linked.address);
        const status = await getSharedCooldownStatus(message.author.id, linked.address);

        await message.reply(
          `👤 ${message.author.username}
` +
            `Discord ID: \`${message.author.id}\`
` +
            `Wallet: \`${linked.address}\`${primaryName ? ` (${primaryName})` : ''}
` +
            `Source: ${describeLinkedWalletSource(linked.source)}
` +
            `Current $${EFFECTIVE_TOKEN_SYMBOL} balance: ${fmtAmt(balance)}
` +
            `${status.blocked ? `Faucet cooldown: ${formatRemaining(status.nextEligibleAt - Date.now())} (last claimed via ${status.lastClaimSource || 'unknown'})` : 'Faucet cooldown: ready now'}`,
        );
        break;
      }
      case 'unlinkwallet':
      case 'forgetwallet': {
        const linked = getLinkedWallet(message.author.id, 'faucet');
        if (!linked?.address) {
          await message.reply('ℹ️ No saved wallet was found for your Discord account.');
          break;
        }
        removeLinkedWallet(message.author.id);
        await message.reply(`🧹 Removed saved wallet \`${linked.address}\`.`);
        break;
      }
      case 'faucetstatus': {
        const linked = getLinkedWallet(message.author.id, 'faucet');
        if (!linked?.address) {
          await message.reply('ℹ️ No faucet wallet found. Use `!register <wallet-or-domain>` / `!save <wallet-or-domain>` or verify through Mole Guard first.');
          break;
        }
        const status = await getSharedCooldownStatus(message.author.id, linked.address);
        const balance = await getWinlewBalance(new PublicKey(linked.address)).catch(() => 0);
        await message.reply(
          `📋 Faucet status for \`${linked.address}\`\n` +
            `Holder balance: ${fmtAmt(balance)} $${EFFECTIVE_TOKEN_SYMBOL}\n` +
            `Eligibility floor: ${MIN_HOLDER_BALANCE} $${EFFECTIVE_TOKEN_SYMBOL}\n` +
            `${status.blocked ? `Next claim in ${formatRemaining(status.nextEligibleAt - Date.now())} (last claimed via ${status.lastClaimSource || 'unknown'})` : 'You can claim now.'}\n` +
            '_Discord and website share one faucet cooldown._',
        );
        break;
      }
      case 'price': {
        try {
          const result = await fetchBestPrice();
          const price = result?.price || Number(result);
          if (!price || isNaN(Number(price))) {
            await message.reply(`❌ Could not fetch a valid $${EFFECTIVE_TOKEN_SYMBOL} price. Please try again later!`);
            break;
          }
          await message.reply(`💰 ${EFFECTIVE_TOKEN_SYMBOL} Price: $${Number(price).toFixed(6)}`);
        } catch (err) {
          await message.reply(`❌ No price source available for $${EFFECTIVE_TOKEN_SYMBOL} right now.`);
          console.error('!price error:', err);
        }
        break;
      }
      case 'data': {
        await message.reply(`⏳ Fetching all price source data for $${EFFECTIVE_TOKEN_SYMBOL}, please wait...`);

        const [gecko, dexscreener, raydium, pumpfun] = await Promise.allSettled([
          (async () => {
            const { fetchGeckoTerminalPrice } = await import('./gecko.js');
            return fetchGeckoTerminalPrice(GECKO_POOL_ID);
          })(),
          (async () => {
            const { fetchDexScreenerPrice } = await import('./dexscreener.js');
            return fetchDexScreenerPrice(DEXSCREENER_POOL_ID);
          })(),
          (async () => {
            const { fetchRaydiumPrice } = await import('./raydium.js');
            return fetchRaydiumPrice(RAYDIUM_POOL_ID);
          })(),
          (async () => {
            const { fetchPumpFunPrice } = await import('./pumpfun.js');
            return fetchPumpFunPrice(PUMPFUN_POOL_ID);
          })(),
        ]);

        let out = `📊 **$${EFFECTIVE_TOKEN_SYMBOL} Data From All Major Sources:**\n\n`;

        if (gecko.status === 'fulfilled' && gecko.value?.price) {
          const info = gecko.value;
          out +=
            `🦎 **GeckoTerminal**\n` +
            `• Price: $${info.price.toFixed(6)}\n` +
            `• Pool: ${info.poolName}\n` +
            (info.baseSymbol ? `• Base: ${info.baseSymbol} (${info.baseAddress})\n` : '') +
            (info.quoteSymbol ? `• Quote: ${info.quoteSymbol}\n` : '') +
            (info.fdv ? `• FDV: $${Number(info.fdv).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` : '') +
            (info.volume24h
              ? `• 24h Volume: $${Number(info.volume24h).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`
              : '') +
            `• [View Pool](${info.url})\n\n`;
        } else {
          out += `🦎 **GeckoTerminal:** ❌ Error: ${gecko.reason?.message || gecko.reason || 'Unavailable'}\n\n`;
        }

        if (dexscreener.status === 'fulfilled' && dexscreener.value?.price) {
          const info = dexscreener.value;
          out +=
            `📊 **DexScreener**\n` +
            `• Price: $${info.price.toFixed(6)}\n` +
            (info.baseSymbol ? `• Base: ${info.baseSymbol}\n` : '') +
            (info.quoteSymbol ? `• Quote: ${info.quoteSymbol}\n` : '') +
            `• [View Pair](${info.url})\n\n`;
        } else {
          out += `📊 **DexScreener:** ❌ Error: ${dexscreener.reason?.message || dexscreener.reason || 'Unavailable'}\n\n`;
        }

        if (raydium.status === 'fulfilled' && raydium.value?.price) {
          const info = raydium.value;
          out +=
            `💱 **Raydium**\n` +
            `• Price: $${info.price.toFixed(6)}\n` +
            (info.poolName ? `• Pool: ${info.poolName}\n` : '') +
            (info.baseSymbol ? `• Base: ${info.baseSymbol} (${info.baseAddress})\n` : '') +
            (info.quoteSymbol ? `• Quote: ${info.quoteSymbol}\n` : '') +
            (info.tvl ? `• TVL: $${Number(info.tvl).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` : '') +
            (info.volume24h
              ? `• 24h Volume: $${Number(info.volume24h).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`
              : '') +
            `• [View Pool](${info.url})\n\n`;
        } else {
          out += `💱 **Raydium:** ❌ Error: ${raydium.reason?.message || raydium.reason || 'Unavailable'}\n\n`;
        }

        if (pumpfun.status === 'fulfilled' && pumpfun.value?.price) {
          const info = pumpfun.value;
          out +=
            `🏁 **Pump.fun / PumpSwap**\n` +
            `• Price: $${info.price.toFixed(6)}\n` +
            (info.symbol ? `• Symbol: ${info.symbol}\n` : '') +
            (info.name ? `• Name: ${info.name}\n` : '') +
            `• [View Coin](${info.url})\n`;
        } else {
          out += `🏁 **Pump.fun / PumpSwap:** ❌ Error: ${pumpfun.reason?.message || pumpfun.reason || 'Unavailable'}\n`;
        }

        if (out.length > 1900) out = `${out.slice(0, 1900)}…`;

        await message.reply(out);
        break;
      }
      case 'debugprice': {
        if (!MOD_ID_LIST.includes(message.author.id)) {
          await message.reply('❌ This command is restricted.');
          break;
        }
        let out = '🛠️ Debugging price sources...\n';
        try {
          await import(`./priceTracker.js?${Date.now()}`);
          try {
            const solscan = await fetchSolScanPrice(SOLSCAN_POOL_ID);
            out += `Solscan ✅: $${solscan}\n`;
          } catch (e) {
            out += `Solscan ❌: ${e.message}\n`;
          }
          try {
            const raydium = await fetchRaydiumPrice(RAYDIUM_POOL_ID);
            out += `💱Raydium ✅: $${raydium}\n`;
          } catch (e) {
            out += `💱Raydium ❌: ${e.message}\n`;
          }
          try {
            const pumpfun = await fetchPumpFunPrice(PUMPFUN_POOL_ID);
            out += `🧑‍🚀Pump.Fun ✅: $${pumpfun}\n`;
          } catch (e) {
            out += `🧑‍🚀Pump.Fun ❌: ${e.message}\n`;
          }
          try {
            const dexscreener = await fetchDexScreenerPrice(DEXSCREENER_POOL_ID);
            out += `📊Dexscreener ✅: $${dexscreener}\n`;
          } catch (e) {
            out += `📊Dexscreener ❌: ${e.message}\n`;
          }
          try {
            const gecko = await fetchGeckoTerminalPrice(GECKO_POOL_ID);
            out += `🦎GeckoTerminal ✅: $${gecko}\n`;
          } catch (e) {
            out += `🦎GeckoTerminal ❌: ${e.message}\n`;
          }
          await message.reply(out.length > 1900 ? `${out.slice(0, 1900)}…` : out);
        } catch (err) {
          await message.reply(`❌ Error loading price tracker module: ${err.message || err}`);
        }
        break;
      }
      case 'ddata': {
        try {
          const { fetchDexScreenerPrice } = await import('./dexscreener.js');
          const info = await fetchDexScreenerPrice(DEXSCREENER_POOL_ID);
          if (!info.price || isNaN(info.price)) {
            await message.reply('❌ Could not fetch a valid Dexscreener price. Try again later!');
            break;
          }
          await message.reply(
            `📊 **DexScreener $${EFFECTIVE_TOKEN_SYMBOL} Stats**\n` +
              `• **Price**: $${info.price.toFixed(6)}\n` +
              (info.baseSymbol ? `• **Base**: ${info.baseSymbol}\n` : '') +
              (info.quoteSymbol ? `• **Quote**: ${info.quoteSymbol}\n` : '') +
              `• [View on DexScreener](${info.url})`,
          );
        } catch (err) {
          await message.reply(`❌ Error fetching DexScreener data: ${err.message || err}`);
        }
        break;
      }
      case 'gdata': {
        try {
          const info = await fetchGeckoTerminalPrice(GECKO_POOL_ID);
          if (!info.price || isNaN(info.price)) {
            await message.reply('❌ Could not fetch a valid GeckoTerminal price. Try again later!');
            break;
          }
          await message.reply(
            `🦎 **GeckoTerminal $${EFFECTIVE_TOKEN_SYMBOL} Stats**\n` +
              `• **Price**: $${info.price.toFixed(6)}\n` +
              `• **Pool**: ${info.poolName}\n` +
              (info.baseSymbol ? `• **Base**: ${info.baseSymbol}${info.baseAddress ? ` (${info.baseAddress})` : ''}\n` : '') +
              (info.quoteSymbol ? `• **Quote**: ${info.quoteSymbol}${info.quoteAddress ? ` (${info.quoteAddress})` : ''}\n` : '') +
              `• **FDV**: $${Number(info.fdv).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
              `• **24h Volume**: $${Number(info.volume24h).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
              `• [View on GeckoTerminal](${info.url})`,
          );
        } catch (err) {
          await message.reply(`❌ Error fetching GeckoTerminal data: ${err.message || err}`);
        }
        break;
      }
      case 'rdata': {
        try {
          const { fetchRaydiumPrice } = await import('./raydium.js');
          const info = await fetchRaydiumPrice(RAYDIUM_POOL_ID);
          if (!info.price || isNaN(info.price)) {
            await message.reply('❌ Could not fetch a valid Raydium price. Try again later!');
            break;
          }
          await message.reply(
            `💱 **Raydium $${EFFECTIVE_TOKEN_SYMBOL} Stats**\n` +
              `• **Price**: $${info.price.toFixed(6)}\n` +
              (info.poolName ? `• **Pool**: ${info.poolName}\n` : '') +
              (info.baseSymbol ? `• **Base**: ${info.baseSymbol} (${info.baseAddress})\n` : '') +
              (info.quoteSymbol ? `• **Quote**: ${info.quoteSymbol}\n` : '') +
              (info.tvl ? `• **TVL**: $${Number(info.tvl).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` : '') +
              (info.volume24h
                ? `• **24h Volume**: $${Number(info.volume24h).toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`
                : '') +
              `• [View on Raydium](${info.url})`,
          );
        } catch (err) {
          await message.reply(`❌ Error fetching Raydium data: ${err.message || err}`);
        }
        break;
      }
      case 'pdata': {
        try {
          const { fetchPumpFunPrice } = await import('./pumpfun.js');
          const info = await fetchPumpFunPrice(PUMPFUN_POOL_ID);
          if (!info.price || isNaN(info.price)) {
            await message.reply('❌ Could not fetch a valid Pump.Fun price. Try again later!');
            break;
          }
          await message.reply(
            `🏁 **Pump.fun / PumpSwap $${EFFECTIVE_TOKEN_SYMBOL} Stats**\n` +
              `• **Price**: $${info.price.toFixed(6)}\n` +
              (info.symbol ? `• **Symbol**: ${info.symbol}\n` : '') +
              (info.name ? `• **Name**: ${info.name}\n` : '') +
              `• [View on Pump.fun](${info.url})`,
          );
        } catch (err) {
          await message.reply(`❌ Error fetching Pump.Fun data: ${err.message || err}`);
        }
        break;
      }
      case 'sdata': {
        try {
          const info = await fetchSolScanPrice(SOLSCAN_POOL_ID);
          if (!info.price || isNaN(info.price)) {
            await message.reply('❌ Could not fetch a valid SolScan price. Try again later!');
            break;
          }
          await message.reply(
            `🔗 **SolScan $${EFFECTIVE_TOKEN_SYMBOL} Stats**\n` +
              `• **Price**: $${info.price.toFixed(6)}\n` +
              (info.symbol ? `• **Symbol**: ${info.symbol}\n` : '') +
              (info.name ? `• **Name**: ${info.name}\n` : '') +
              `• [View on SolScan](${info.url})`,
          );
        } catch (err) {
          await message.reply(`❌ Error fetching SolScan data: ${err.message || err}`);
        }
        break;
      }
      case 'contracts':
      case 'pools': {
        // One place showing EVERY configured on-chain identifier — the .env
        // aliases (~12 vars) boil down to these three contracts, and until
        // this command only whichever one a given !data source used was
        // ever visible.
        await message.reply(
          `📜 **$${EFFECTIVE_TOKEN_SYMBOL} On-Chain Contracts**\n` +
            `🪙 **Token mint** (also the pump.fun bonding pool)\n` +
            // Masked links ([text](url)) only render inside embeds. This is a
            // plain message.reply(), so Discord showed the literal
            // "[Solscan](https://…)" markup AND still unfurled a preview for
            // every URL. Angle brackets give a clean link with no preview.
            `\`${TOKEN_MINT.toBase58()}\`\n` +
            `Solscan <https://solscan.io/token/${TOKEN_MINT.toBase58()}>\n` +
            `pump.fun <https://pump.fun/coin/${TOKEN_MINT.toBase58()}>\n` +
            `💧 **Raydium ${POOL_NAME || 'WinLEW/SOL'} pool**\n` +
            `\`${RAYDIUM_POOL_ID}\`\n` +
            `Solscan <https://solscan.io/account/${RAYDIUM_POOL_ID}>\n` +
            `Raydium <https://raydium.io/liquidity/increase/?mode=add&pool_id=${RAYDIUM_POOL_ID}>\n` +
            `📊 **Market pair** (primary PumpSwap market)\n` +
            `\`${DEXSCREENER_POOL_ID}\`\n` +
            // GeckoTerminal rather than DexScreener here, unlike !dexscreener
            // and !buylinks which switched to the Raydium pool on 2026-08-12.
            // This line NAMES a specific pair, so its link has to open that
            // pair — sending it to a different pool's chart would contradict
            // the address printed directly above it. DexScreener renders "no
            // pair found" for this pool while volume is zero; GeckoTerminal
            // serves it (reserve $6,162 verified 2026-08-12).
            `GeckoTerminal <${WINLEW_MARKET_LINKS.geckoPrimary}>\n` +
            `🏦 Reserve wallets → ${PREFIX}wallet • ${PREFIX}xwallet • ${PREFIX}devwallet — all independently verified at <https://winlew.co/transparency/>`,
        );
        break;
      }
      case 'wallet': {
        await message.reply(
          `🤖 **The Bot Wallet** — diglew.sol & burn.winlew.sol\n` +
            `\`${BOT_KEYPAIR.publicKey.toBase58()}\`\n` +
            'X <https://x.com/LetEveryOneWin>',
        );
        break;
      }
      case 'xwallet': {
        await message.reply(
          '🤖 **The WinLewToken Wallet** — Winlew.sol\n'
          + '`GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp`\n'
          + 'X <https://x.com/WinLewToken>',
        );
        break;
      }
      case 'devwallet': {
        await message.reply(
          '🛠️ **LewSales Wallet** — LewSales.sol\n'
          + '`D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ`\n'
          + 'X <https://x.com/LewSales>',
        );
        break;
      }
      case 'supply': {
        const info = await connection.getTokenSupply(TOKEN_MINT);
        await message.reply(`🌐 Total supply: ${fmtAmt(info.value.uiAmount)} ${EFFECTIVE_TOKEN_SYMBOL}`);
        break;
      }
      case 'buy': {
        await message.reply(`🏁 Open the verified $WinLEW pump.fun coin page / PumpSwap market:\n<${WINLEW_MARKET_LINKS.pumpCoin}>`);
        break;
      }
      case 'dexscreener': {
        await message.reply(
          `📊 $WinLEW on DexScreener (Raydium pool — the one that renders at zero volume):\n<${WINLEW_MARKET_LINKS.dexscreenerChart}>\n` +
            `🦎 The primary post-graduation PumpSwap market is on GeckoTerminal:\n<${WINLEW_MARKET_LINKS.geckoPrimary}>`,
        );
        break;
      }
      case 'rugcheck': {
        await message.reply('🔒 Be safe! Verify $WinLEW on RugCheck:\n<https://rugcheck.xyz/tokens/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump>');
        break;
      }
      case 'swap': {
        await message.reply(`💱 Swap your tokens for $WinLEW using Raydium:\n<${WINLEW_MARKET_LINKS.raydiumSwap}>`);
        break;
      }
      case 'geckoterminal': {
        await message.reply(`🦎 View the primary post-graduation $WinLEW market on GeckoTerminal:\n<${WINLEW_MARKET_LINKS.geckoPrimary}>`);
        break;
      }
      case 'cmc': {
        await message.reply(`📈 Track $WinLEW on CoinMarketCap Dexscan:\n<${WINLEW_MARKET_LINKS.coinMarketCap}>`);
        break;
      }
      case 'website': {
        await message.reply(`🖥️ Visit our official site: <https://winlew.co>\nFor every page, run \`${PREFIX}pages\`.`);
        break;
      }
      case 'pages':
      case 'sitemap':
      case 'site':
      case 'webpages':
      case 'allpages':
      case 'winlewpages': {
        await replyInChunks(message, buildWebsiteLinks());
        break;
      }
      case 'rpc': {
        const rpcDisplay = redactRpcUrl(RPC_URL || connection.rpcEndpoint || 'https://solana-rpc.publicnode.com');
        await message.reply(
          `🛰️ **Active Solana RPC**
` +
            `• Endpoint: \`${rpcDisplay}\`
` +
            `• Network: mainnet-beta
` +
            `• Note: private path details are hidden for safety.`,
        );
        break;
      }
      case 'help': {
        await message.reply(buildHelpOverview({ prefix: PREFIX, tokenSymbol: EFFECTIVE_TOKEN_SYMBOL, dripAmount: DRIP }));
        break;
      }
      case 'commands':
      case 'fhelp': {
        await replyInChunks(
          message,
          buildCommandsCatalog({ prefix: PREFIX, tokenSymbol: EFFECTIVE_TOKEN_SYMBOL, dripAmount: DRIP }),
        );
        break;
      }
      case 'navigation': {
        await message.reply(buildNavigationMessage({ prefix: PREFIX }));
        break;
      }
      case 'links': {
        await message.reply(
          `🔗 **All $WinLEW Links:**
` +
            // The two "Direct:" handles used to be swapped relative to the
            // vanity domains printed beside them: burn.WinLEW.xyz actually
            // redirects to x.com/leteveryonewin and faucet.WinLEW.xyz to
            // x.com/winlewtoken (checked 2026-08-04), so this command told
            // users the opposite of where its own links go. The !xwallet reply
            // above and web.js's xFaucetReserve component both already had it
            // right; only this list was wrong.
            `• Burn/Token X Account: 💥<http://burn.WinLEW.xyZ> • Direct: <https://x.com/LetEveryOneWin>
` +
            `• Dev's X Account: 🛠️<http://dev.WinLEW.xyZ> • Direct: <https://x.com/LewSales>
` +
            `• Faucet X Account: 🤖<http://faucet.WinLEW.xyZ> • Direct: <https://x.com/WinLewToken>
` +
            // Register #17: this printed http://WinLEW.xyZ. It redirects, so it
            // worked — but the site moved off .xyz entirely (the /health/ audit
            // confirmed zero subdomain URLs remain anywhere in src/public/), and
            // this command was the last place handing out a .xyz address for the
            // website itself. It is also the first URL many users ever see. Now
            // the canonical origin, and https rather than http.
            //
            // The three .xyz lines above are deliberately NOT changed: those are
            // vanity redirects to X profiles, not to this site, and each already
            // prints its real x.com destination beside it.
            `• The OFFICIAL Website: 🌐<https://winlew.co>
` +
            `
` +
            `• CoinMarketCap Dexscan: 📈<${WINLEW_MARKET_LINKS.coinMarketCap}>
` +
            `• DexScreener (Raydium pool): 📊<${WINLEW_MARKET_LINKS.dexscreenerChart}>
` +
            `• GeckoTerminal (Primary PumpSwap): 🦎<${WINLEW_MARKET_LINKS.geckoPrimary}>
` +
            `• pump.fun Coin Page: 🏁<${WINLEW_MARKET_LINKS.pumpCoin}>
` +
            `• Raydium Swap: 💱<${WINLEW_MARKET_LINKS.raydiumSwap}>
` +
            `• Historical launch market: 🧩<${WINLEW_MARKET_LINKS.solscanHistorical}>
` +
            `• MEXC DEX: 🔎<${WINLEW_MARKET_LINKS.mexcDex}>
` +
            `• RugCheck: 🔒<${WINLEW_MARKET_LINKS.rugcheck}>
` +
            `• SolScan: 🔗<${WINLEW_MARKET_LINKS.solscanToken}>
` +
            `
` +
            `**winlew.co (in-house):**
` +
            `• Homepage: 🏠<https://winlew.co/> • Ecosystem Hub: 🧭<https://winlew.co/home/>
` +
            `• Contribute: 🤝<https://winlew.co/contribute/> • Transparency: 🛡️<https://winlew.co/transparency/> • Burn: 🔥<https://winlew.co/burn/>
` +
            `• Governance: 🏛️<https://winlew.co/governance/> • Whitepaper: 📜<https://winlew.co/whitepaper/> • Verify/Dashboard: ✅<https://winlew.co/verify/>
` +
            `• Discord Bots: 🤖<https://winlew.co/discord-bots/> • Who We Are: 📖<https://winlew.co/who-we-are/>
` +
            `
` +
            `For every winlew.co page (bounties, governance, GeoAgora, etc.), run \`${PREFIX}pages\`.`,
        );
        break;
      }
      case 'quicklinks':
      case 'buylinks': {
        await message.reply(
          '🔗 **$WinLEW buy Links:**\n' +
            `• [Open pump.fun Coin Page]🏁(<${WINLEW_MARKET_LINKS.pumpCoin}>)\n` +
            `• [DexScreener Chart — Raydium pool]📊(<${WINLEW_MARKET_LINKS.dexscreenerChart}>)\n` +
            `• [Primary GeckoTerminal Market]🦎(<${WINLEW_MARKET_LINKS.geckoPrimary}>)\n` +
            `• [Swap on Raydium]💱(<${WINLEW_MARKET_LINKS.raydiumSwap}>)\n` +
            `• [Add Raydium Liquidity]🤝(<${WINLEW_MARKET_LINKS.raydiumLiquidity}>)\n` +
            `• [Historical Launch Market]🧩(<${WINLEW_MARKET_LINKS.solscanHistorical}>)\n` +
            `• [CoinMarketCap Dexscan]📈(<${WINLEW_MARKET_LINKS.coinMarketCap}>)\n`,
        );
        break;
      }
    }
  } catch (err) {
    console.error('Command error:', err);
    try {
      await message.reply(`❌ An error occurred: ${err.message || err}`);
    } catch {}
  }
});

let twitterUserId;
let lastTweetId;

const twitterClient = TWITTER_BEARER_TOKEN ? new TwitterApi(TWITTER_BEARER_TOKEN) : null;
const TWITTER_USERNAME = process.env.TWITTER_USERNAME || 'WinLewToken';
const roClient = twitterClient ? twitterClient.readOnly : null;

async function loadTwitterUserId() {
  const data = loadJson('twitterUserId.json');
  if (data?.twitterUserId) {
    twitterUserId = data.twitterUserId;
  } else {
    if (!twitterClient) return;
    const user = await twitterClient.v2.userByUsername(TWITTER_USERNAME);
    twitterUserId = user.data.id;
    writeJson('twitterUserId.json', { twitterUserId });
  }
}

function loadLastTweetId() {
  const data = loadJson('lastTweet.json');
  lastTweetId = data && data.lastTweetId ? String(data.lastTweetId) : '1926684491428298868';
}

(async () => {
  // Refuse to boot if another copy of this bot already holds the token.
  // PM2 (ecosystem.config.cjs) and runner.js (`npm run dev:all`, i.e. Docker)
  // both start THIS file, so having both supervisors up logs in twice and
  // every command is handled twice — confirmed 2026-08-01 by a single
  // !restart producing two replies. Before claimStore's atomic reservation
  // that also meant double PAYOUTS (docs/faucet-double-drip-incident.md).
  // Runs before login so a duplicate never reaches the gateway at all.
  await assertSingleInstance({ service: 'winlew-faucet', token: DISCORD_BOT_TOKEN });

  await initFaucetStorage().catch((error) => {
    console.warn('[faucet-storage] bootstrap failed:', error?.message || error);
  });

  // One-time, idempotent import of the legacy version-2 claim timestamps
  // (faucet_claims.json: {wallets:{addr:ms}, users:{id:ms}}) into the new
  // atomic claim store, so historical cooldowns keep being enforced after
  // this deploy. Safe to run on every boot — a no-op after the first
  // successful run. See docs/faucet-web-expansion.md for the rollback
  // procedure if this ever needs to be undone.
  try {
    const legacyClaims = getClaimState();
    const { cooldownMs } = getFaucetConfig();
    const migration = await migrateLegacyV2IfNeeded({ legacyClaims, cooldownMs });
    if (!migration.alreadyMigrated) {
      console.log(`[faucet-migration] imported ${migration.counts.wallets} wallet + ${migration.counts.users} user legacy cooldowns at ${new Date(migration.migratedAt).toISOString()}`);
    }
  } catch (error) {
    console.warn('[faucet-migration] legacy v2 import failed (faucet will still run; new claims are unaffected):', error?.message || error);
  }

  if (twitterClient && GENERAL_WEBHOOK_URL) {
    await loadTwitterUserId();
    loadLastTweetId();
    console.log('[TWITTER INIT] twitterUserId:', twitterUserId, 'lastTweetId:', lastTweetId);

    cron.schedule('0 * * * *', async () => {
      // Parked by a fatal error (billing, credentials, permissions). Skip the
      // request entirely rather than spend a call proving the same thing again
      // — when the failure IS the quota, retrying is actively counterproductive.
      if (!isTwitterAvailable()) return;
      try {
        console.log(`[TWITTER] Checking for new tweets from userId=${twitterUserId}, since lastTweetId=${lastTweetId}`);
        if (!twitterUserId) throw new Error('twitterUserId not set!');
        const timeline = await roClient.v2.userTimeline(twitterUserId, {
          since_id: lastTweetId,
          'tweet.fields': ['created_at', 'text'],
        });
        noteTwitterSuccess();
        const tweets = timeline.data?.data;

        if (Array.isArray(tweets) && tweets.length > 0) {
          const newTweets = lastTweetId ? tweets.filter((t) => BigInt(t.id) > BigInt(lastTweetId)) : tweets;

          if (!lastTweetId || lastTweetId === '1926684491428298868') {
            lastTweetId = tweets[0].id;
            writeJson('lastTweet.json', { lastTweetId });
            console.log(`[TWITTER] First run, not posting. Set lastTweetId to ${lastTweetId}`);
            return;
          }

          // Delivery is tracked, because lastTweetId used to advance whether or
          // not anything was actually posted. With no webhook configured the
          // old loop `continue`d past every tweet and then marked them all as
          // seen — announcements silently lost, permanently, with the watcher
          // reporting nothing wrong. Same failure family as the 402.
          let delivered = 0;
          let failed = false;
          let lastDeliveredId = null;

          // OLDEST FIRST, explicitly sorted rather than relying on the order
          // the API happened to return. The marker can only advance past a
          // tweet once every tweet before it has also been delivered, so the
          // sequence has to be genuinely ascending — otherwise a marker set
          // from the middle of the batch would skip whatever sat behind it.
          // Only recent tweets: a stale marker must never re-announce old ones
          // (tweetMarker.js, MAX_ANNOUNCE_AGE_MS). The marker still moves past them.
          const ordered = oldestFirst(announceable(newTweets));
          if (ordered.length < newTweets.length) {
            console.warn(`[TWITTER] skipped ${newTweets.length - ordered.length} tweet(s) older than a week; not announcing them.`);
          }

          for (const tweet of ordered) {
            const url = `https://x.com/${TWITTER_USERNAME}/status/${tweet.id}`;
            const ok = await postSocialUpdate(
              `🆕 New Tweet from @${TWITTER_USERNAME}:\n${tweet.text}\n${url}`
            ).catch((e) => {
              console.error('[SOCIAL] post failed:', e?.message || e);
              return false;
            });
            if (ok) { delivered += 1; lastDeliveredId = tweet.id; }
            else { failed = true; break; }
          }

          if (failed) {
            // ADVANCE TO WHAT ACTUALLY LANDED — this is the duplicate fix.
            //
            // The previous version left the marker completely untouched on any
            // failure, to stop tweets being LOST. That was right about the risk
            // and wrong about the remedy: with five new tweets, if the fourth
            // failed, the three that had already posted were re-posted on the
            // next tick, and again on the one after, for as long as the fourth
            // kept failing. Reported from Discord as "the bot sends the same
            // tweets".
            //
            // Moving the marker to the last SUCCESSFUL delivery keeps both
            // guarantees at once: nothing already posted is posted twice, and
            // nothing undelivered is skipped — the failed tweet is still the
            // next one up on the retry.
            const next = nextTweetMarker({ lastDeliveredId, failed: true, currentMarker: lastTweetId });
            if (next.changed) {
              lastTweetId = next.marker;
              writeJson('lastTweet.json', { lastTweetId });
            }
            console.error(`[TWITTER] delivered ${delivered}/${ordered.length} — marker at ${lastTweetId}; the rest retry next tick.`);
          } else {
            const next = nextTweetMarker({ lastDeliveredId, failed: false, newestId: tweets[0].id, currentMarker: lastTweetId });
            lastTweetId = next.marker;
            writeJson('lastTweet.json', { lastTweetId });
          }
        }
      } catch (e) {
        // Was `console.error` alone. That is how a 402 ran for weeks with the
        // watcher silently announcing nothing: the only record was a log line
        // nobody reads. Fatal states now reach Discord once per outage.
        const failure = noteTwitterFailure(e);
        if (failure.fatal && failure.firstOccurrence && generalWebhook) {
          await generalWebhook
            .send({ content: `⚠️ **Tweet watcher stopped** — ${failure.summary}\n_Polling is parked and will retry automatically; no restart needed._` })
            .catch((err) => console.error('[TWITTER] could not announce the outage:', err?.message || err));
        }
        if (!failure.fatal) console.error('Twitter poll error:', e);
      }
    });
  } else {
    console.log('[TWITTER] Skipping tweet watcher (missing TWITTER_BEARER_TOKEN or GENERAL_WEBHOOK_URL).');
  }

  if (VOICE_CHANNEL_ID)
    cron.schedule('2 * * * *', async () => {
      try {
        const result = await fetchBestPrice();
        const price = result?.price || Number(result);
        const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
        if (channel && typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()) {
          await channel.setName(`💰 WinLEW: $${Number(price).toFixed(6)}`);
          console.log(`[CRON] Voice channel renamed to: 💰 WinLEW: $${Number(price).toFixed(6)}`);
        } else {
          console.error('[CRON] VOICE_CHANNEL_ID is not a voice channel or not found!');
        }
      } catch (e) {
        console.error('[CRON] Failed to rename channel:', e);
      }
    });

  if (PRICE_CHANNEL_ID)
    cron.schedule('4 * * * *', async () => {
      try {
        const result = await fetchBestPrice();
        const price = result?.price || Number(result);
        const channel = await client.channels.fetch(PRICE_CHANNEL_ID);
        if (!channel) {
          console.error('PRICE_CHANNEL_ID not found!');
          return;
        }
        await channel.setName(`💰WinLEW:$${Number(price).toFixed(6)}`);
      } catch (e) {
        console.error('Price rename error:', e);
      }
    });

  // Sibling-token price voice-channels (SOL / XYO / XL1). Each is optional —
  // set its *_PRICE_CHANNEL_ID env to enable. Prices come from CoinGecko in a
  // single call (the $WinLEW channels above use the on-chain fetchBestPrice()
  // instead, since it isn't on a public price index). Renames are per-channel,
  // so they don't share Discord's per-channel rename rate limit with each other.
  const EXTRA_PRICE_CHANNELS = [
    { label: 'SOL', emoji: '💲', geckoId: 'solana', channelId: SOL_PRICE_CHANNEL_ID },
    { label: 'XYO', emoji: '💲', geckoId: 'xyo-network', channelId: XYO_PRICE_CHANNEL_ID },
    { label: 'XL1', emoji: '💲', geckoId: 'xl1', channelId: XL1_PRICE_CHANNEL_ID },
  ].filter((t) => t.channelId);

  if (EXTRA_PRICE_CHANNELS.length) {
    cron.schedule('6 * * * *', async () => {
      let prices;
      try {
        prices = await fetchCoinGeckoPrices(EXTRA_PRICE_CHANNELS.map((t) => t.geckoId));
      } catch (e) {
        console.error('[CRON] CoinGecko price fetch failed:', e?.message || e);
        return;
      }
      for (const token of EXTRA_PRICE_CHANNELS) {
        const p = prices[token.geckoId];
        if (!p) {
          console.error(`[CRON] No CoinGecko price for ${token.label} (${token.geckoId})`);
          continue;
        }
        try {
          const channel = await client.channels.fetch(token.channelId);
          if (!channel || typeof channel.isVoiceBased !== 'function' || !channel.isVoiceBased()) {
            console.error(`[CRON] ${token.label}_PRICE_CHANNEL_ID is not a voice channel or not found!`);
            continue;
          }
          const name = `${token.emoji} ${token.label}: $${formatUsdPrice(p.usd)} ${changeArrow(p.change24h)} ${Math.abs(Number(p.change24h) || 0).toFixed(2)}%`;
          await channel.setName(name);
          console.log(`[CRON] Voice channel renamed to: ${name}`);
        } catch (e) {
          console.error(`[CRON] Failed to rename ${token.label} channel:`, e?.message || e);
        }
      }
    });
  }

  client.login(DISCORD_BOT_TOKEN);
})();
