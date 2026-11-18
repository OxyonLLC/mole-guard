import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { ActionRowBuilder, ApplicationCommandType, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { z } from 'zod';
import { envBool } from '../shared/envBool.js';
import { askClaude, isClaudeConfigured, isClaudeAvailable, getClaudePause, getClaudeModel } from '../services/claude.js';
import { resolveSolanaAddress, resolveSolanaName } from '../faucet/sns.js';
import { resolveWatchdogListenHost } from './listenHost.js';

const schema = z.object({
  WATCHDOG_DISCORD_TOKEN: z.string().min(1),
  WATCHDOG_ALERT_CHANNEL_ID: z.string().min(1),
  WATCHDOG_PORT: z.coerce.number().default(8790),
  WATCHDOG_DATA_DIR: z.string().default('./data-watchdog'),
  WATCHDOG_HEARTBEAT_TOKEN: z.string().min(10),
  HEARTBEAT_TIMEOUT_SEC: z.coerce.number().default(90),
  WATCHDOG_SECURITY_ENABLED: envBool(true),
  WATCHDOG_SECURITY_LOG_CHANNEL_ID: z.string().optional(),
  WATCHDOG_SECURITY_ALLOWED_DOMAINS: z.string().default('winlew.co,www.winlew.co,discord.com,discord.gg'),
  WATCHDOG_SECURITY_TRUSTED_ROLE_IDS: z.string().default(''),
  WATCHDOG_SECURITY_NEW_MEMBER_WINDOW_MINUTES: z.coerce.number().default(120),
  WATCHDOG_SECURITY_MIN_ACCOUNT_AGE_DAYS: z.coerce.number().default(21),
  WATCHDOG_SECURITY_TIMEOUT_MINUTES: z.coerce.number().default(0),
  WATCHDOG_IMPERSONATION_ENABLED: envBool(true),
  WATCHDOG_IMPERSONATION_BAN_NAMES: z.string().default('announcements,announcement,airdrop,partnership'),
  WATCHDOG_IMPERSONATION_FLAG_NAMES: z.string().default('support'),
  WATCHDOG_CHAT_ALLOWED_USER_IDS: z.string().default(''),
  WATCHDOG_CHAT_ALLOWED_ROLE_IDS: z.string().default(''),
  WATCHDOG_PRESENCE_GUILD_ID: z.string().optional(),
  WATCHDOG_PRESENCE_USER_ID: z.string().optional(),
  WATCHDOG_PRESENCE_USER_TAG: z.string().optional(),
  WATCHDOG_PRESENCE_USER_IDS: z.string().default(''),
  WATCHDOG_PRESENCE_USER_TAGS: z.string().default(''),
  WATCHDOG_PRESENCE_LOG_CHANNEL_ID: z.string().optional(),
  WATCHDOG_AUDIT_ENABLED: envBool(true),
  WATCHDOG_AUDIT_CHANNEL_ID: z.string().optional(),
  WATCHDOG_AUDIT_INTERVAL_SEC: z.coerce.number().default(600),
  WATCHDOG_AUDIT_BOT_TAGS: z.string().default('WinLEW-UtilityBot#5306,The Mole Gaurd#6400'),
  WATCHDOG_AUDIT_BOT_USER_IDS: z.string().default(''),
  WATCHDOG_UTILITY_BOT_WALLET: z.string().default('diglew.sol'),
});

const cfg = schema.parse(process.env);

const stateFile = () => path.join(cfg.WATCHDOG_DATA_DIR, 'state.json');
const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'cutt.ly',
  'goo.gl',
  'is.gd',
  'lnk.bio',
  'ow.ly',
  'rb.gy',
  'shorturl.at',
  'tiny.cc',
  'tinyurl.com',
  't.co',
]);
const SUSPICIOUS_KEYWORDS = [
  'airdrop',
  'claim',
  'collab',
  'connect wallet',
  'free mint',
  'giveaway',
  'limited time',
  'mint',
  'official partnership',
  'opensea',
  'partnership',
  'support',
  'sync wallet',
  'ticket',
  'verify wallet',
];
const WATCHDOG_LAST_PREFIXES = ['!wd-last', '!watchdog-last'];
const RECENT_AUDIT_EVENT_LIMIT = 40;
const BOT_FAILURE_MARK_LIMIT = 250;

function defaultState() {
  return {
    services: {},
    users: {},
    watchedPresence: {
      userId: null,
      status: 'unknown',
    },
    watchedPresences: {},
    audit: {
      duplicate_wallet_fingerprint: '',
      duplicate_wallet_count: 0,
      bot_failure_message_ids: {},
    },
  };
}

function normalizeState(raw) {
  const base = defaultState();
  return {
    ...base,
    ...(raw && typeof raw === 'object' ? raw : {}),
    services: raw?.services && typeof raw.services === 'object' ? raw.services : {},
    users: raw?.users && typeof raw.users === 'object' ? raw.users : {},
    watchedPresence: raw?.watchedPresence && typeof raw.watchedPresence === 'object'
      ? {
          userId: null,
          status: 'unknown',
          ...raw.watchedPresence,
        }
      : { userId: null, status: 'unknown' },
    watchedPresences: raw?.watchedPresences && typeof raw.watchedPresences === 'object'
      ? raw.watchedPresences
      : raw?.watchedPresence?.userId
        ? {
            [raw.watchedPresence.userId]: {
              status: raw.watchedPresence.status || 'unknown',
              label: raw.watchedPresence.userId,
            },
          }
        : {},
    audit: raw?.audit && typeof raw.audit === 'object'
      ? {
          duplicate_wallet_fingerprint: '',
          duplicate_wallet_count: 0,
          bot_failure_message_ids: {},
          ...raw.audit,
        }
      : {
          duplicate_wallet_fingerprint: '',
          duplicate_wallet_count: 0,
          bot_failure_message_ids: {},
        },
  };
}

function ensureDir() {
  if (!fs.existsSync(cfg.WATCHDOG_DATA_DIR)) fs.mkdirSync(cfg.WATCHDOG_DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    if (!fs.existsSync(stateFile())) return defaultState();
    return normalizeState(JSON.parse(fs.readFileSync(stateFile(), 'utf-8')));
  } catch {
    return defaultState();
  }
}

function saveState(s) {
  const tmp = stateFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, stateFile());
}

const auditSummaryFile = () => path.join(cfg.WATCHDOG_DATA_DIR, 'security-airdrop-audit.json');
const auditPapertrailFile = () => path.join(cfg.WATCHDOG_DATA_DIR, 'security-airdrop-papertrail.jsonl');

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function parseCsvSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function toEpochSeconds(ms) {
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function bucketPresenceStatus(status) {
  return status === 'online' || status === 'idle' || status === 'dnd' ? 'online' : 'offline';
}

function cleanPreview(text = '', max = 280) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripPunctuationEdges(value = '') {
  return String(value)
    .replace(/^[<([{\s]+/, '')
    .replace(/[>)}\].,!?;:\s]+$/, '');
}

function parseUrlCandidate(raw) {
  const candidate = stripPunctuationEdges(raw);
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      return new URL(candidate);
    } catch {
      return null;
    }
  }

  if (!candidate.includes('.') || candidate.includes('@') || candidate.startsWith('/')) return null;

  try {
    return new URL(`https://${candidate}`);
  } catch {
    return null;
  }
}

function extractUrls(content = '') {
  const matches = String(content).match(/https?:\/\/[^\s<>()]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()]+)?/gi) || [];
  const seen = new Set();
  const urls = [];

  for (const match of matches) {
    const parsed = parseUrlCandidate(match);
    if (!parsed) continue;

    const href = parsed.href.replace(/\/$/, '');
    if (seen.has(href)) continue;
    seen.add(href);
    urls.push(parsed);
  }

  return urls;
}

function getHostname(url) {
  return String(url?.hostname || '').toLowerCase();
}

function isImageAttachment(attachment) {
  const type = String(attachment?.contentType || '').toLowerCase();
  const name = String(attachment?.name || attachment?.filename || '').toLowerCase();
  return type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function isClaudeVisionAttachment(attachment) {
  const type = String(attachment?.contentType || '').toLowerCase();
  const name = String(attachment?.name || attachment?.filename || '').toLowerCase();
  return /image\/(png|jpe?g|gif|webp)/i.test(type) || /\.(png|jpe?g|gif|webp)$/i.test(name);
}

function hasTextSubstance(content = '') {
  const stripped = String(content)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<@!?\d+>/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 20;
}

function memberHasRole(member, roleIds) {
  if (!member?.roles?.cache || !roleIds?.size) return false;
  return member.roles.cache.some((role) => roleIds.has(role.id));
}

function canBypassModeration(member, trustedRoleIds) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  return memberHasRole(member, trustedRoleIds);
}

function canUseWatchdogChat(member, userId, allowedUserIds, allowedRoleIds) {
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  if (allowedUserIds.has(userId)) return true;
  return memberHasRole(member, allowedRoleIds);
}

function getMentionPrompt(content, botUserId) {
  if (!content || !botUserId) return '';
  return String(content).replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim();
}

function getWatchdogLastPrompt(content = '') {
  const trimmed = String(content || '').trim();
  const matchedPrefix = WATCHDOG_LAST_PREFIXES.find((prefix) => trimmed.startsWith(prefix));
  if (!matchedPrefix) return null;

  const remainder = trimmed.slice(matchedPrefix.length).trim();
  if (!remainder || remainder.toLowerCase() === 'message') return '';
  if (remainder.toLowerCase().startsWith('message ')) return remainder.slice('message '.length).trim();
  return remainder;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function loadAuditSummary() {
  return readJsonSafe(auditSummaryFile(), {
    updated_at: null,
    duplicate_wallet_audit: null,
    recent_security_flags: [],
    recent_bot_failures: [],
  });
}

function pushLimited(list, value, limit = RECENT_AUDIT_EVENT_LIMIT) {
  return [value, ...list].slice(0, limit);
}

function recordSummaryEvent(kind, details) {
  const summary = loadAuditSummary();
  summary.updated_at = new Date().toISOString();

  if (kind === 'duplicate_wallet_audit') {
    summary.duplicate_wallet_audit = details;
  } else if (kind === 'security_flag') {
    summary.recent_security_flags = pushLimited(summary.recent_security_flags || [], details);
  } else if (kind === 'bot_failure_audit') {
    summary.recent_bot_failures = pushLimited(summary.recent_bot_failures || [], details);
  }

  writeJsonAtomic(auditSummaryFile(), summary);
}

function pruneMarkedMessageIds(marked) {
  const entries = Object.entries(marked || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, BOT_FAILURE_MARK_LIMIT);
  return Object.fromEntries(entries);
}

function getWatchedBotLabel(user) {
  return String(user?.tag || user?.username || user?.id || 'unknown-bot');
}

function extractMessageText(message) {
  const parts = [];
  if (message?.content) parts.push(String(message.content));
  for (const embed of message?.embeds || []) {
    if (embed?.title) parts.push(String(embed.title));
    if (embed?.description) parts.push(String(embed.description));
    for (const field of embed?.fields || []) {
      if (field?.name) parts.push(String(field.name));
      if (field?.value) parts.push(String(field.value));
    }
  }
  return parts.join('\n').trim();
}

function isFailureLikeText(text = '') {
  const lower = String(text || '').toLowerCase();
  return [
    '❌',
    'error',
    'failed',
    'failure',
    'expired',
    'missing',
    'invalid',
    'unavailable',
    'could not',
    'cannot',
    'timed out',
    'timeout',
    'holder-only faucet',
    'rate limited',
    'unauthorized',
    'restricted',
  ].some((token) => lower.includes(token));
}

function looksLikeDripCommand(content = '') {
  const lower = String(content || '').trim().toLowerCase();
  return lower.startsWith('!drip') || lower.startsWith('!faucet');
}

function extractCommandArgs(content = '') {
  return String(content || '').trim().split(/\s+/).slice(1);
}

function normalizeWalletAddress(value = '') {
  return String(value || '').trim();
}

function collectWalletClaims(record, source, discordUserId) {
  const claims = [];
  const raw = record && typeof record === 'object' ? record : null;
  if (!raw) return claims;

  const wallets = raw.wallets && typeof raw.wallets === 'object' && !Array.isArray(raw.wallets)
    ? raw.wallets
    : {};
  const add = (address, intent, input = '', claimSource = source) => {
    const normalized = normalizeWalletAddress(address);
    if (!normalized) return;
    claims.push({
      wallet: normalized,
      discordUserId: String(discordUserId),
      source: claimSource,
      intent,
      input: String(input || normalized),
    });
  };

  add(raw.address || raw.wallet, 'primary');
  for (const [intent, value] of Object.entries(wallets)) {
    if (value && typeof value === 'object') add(value.address || value.wallet, intent, value.input, source);
  }

  return claims;
}

function buildDuplicateWalletAudit() {
  const projectRoot = path.resolve(process.cwd());
  const molePrimary = path.join(projectRoot, 'data', 'linked_wallets.json');
  const moleMirror = path.join(projectRoot, 'src', 'data', 'linked_wallets.json');
  const faucetLinksFile = path.join(projectRoot, 'src', 'faucet', 'wallet_links.json');
  const moleData = readJsonSafe(fs.existsSync(molePrimary) ? molePrimary : moleMirror, {});
  const faucetRaw = readJsonSafe(faucetLinksFile, { version: 1, links: {} });
  const faucetLinks = faucetRaw?.links && typeof faucetRaw.links === 'object' ? faucetRaw.links : faucetRaw;
  const walletMap = new Map();

  for (const [discordUserId, record] of Object.entries(moleData || {})) {
    for (const claim of collectWalletClaims(record, 'mole', discordUserId)) {
      const bucket = walletMap.get(claim.wallet) || [];
      bucket.push(claim);
      walletMap.set(claim.wallet, bucket);
    }
  }

  for (const [discordUserId, record] of Object.entries(faucetLinks || {})) {
    for (const claim of collectWalletClaims(record, 'faucet', discordUserId)) {
      const bucket = walletMap.get(claim.wallet) || [];
      bucket.push(claim);
      walletMap.set(claim.wallet, bucket);
    }
  }

  const duplicates = [];
  for (const [wallet, claims] of walletMap.entries()) {
    const userIds = [...new Set(claims.map((claim) => claim.discordUserId))].sort();
    if (userIds.length <= 1) continue;

    const groupedClaims = userIds.map((discordUserId) => {
      const rows = claims.filter((claim) => claim.discordUserId === discordUserId);
      return {
        discordUserId,
        claims: rows.map((row) => ({
          source: row.source,
          intent: row.intent,
          input: row.input,
        })),
      };
    });

    duplicates.push({
      wallet,
      userIds,
      users: groupedClaims,
    });
  }

  duplicates.sort((a, b) => b.userIds.length - a.userIds.length || a.wallet.localeCompare(b.wallet));
  const fingerprint = JSON.stringify(
    duplicates.map((item) => [item.wallet, [...item.userIds].sort()]),
  );

  return {
    scanned_at: new Date().toISOString(),
    total_duplicates: duplicates.length,
    duplicates,
    fingerprint,
  };
}

function explainFailureHeuristically(text = '') {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('holder-only faucet')) return 'The holder-only faucet rejected the claim because the target wallet is below the minimum required WinLEW balance.';
  if (lower.includes('already claimed') || lower.includes('cooldown')) return 'The faucet cooldown is active for that wallet or Discord account, so the bot refused a new drip.';
  if (lower.includes('transaction expired') || lower.includes('block height exceeded')) return 'The transfer was prepared, but Solana did not confirm it in time, so the bot treated the drip as expired.';
  if (lower.includes('invalid address') || lower.includes('sns')) return 'The bot could not resolve the provided wallet or `.sol` name into a valid Solana address.';
  if (lower.includes('sync failed')) return 'The Mole Guard sync request failed while trying to push linked-role or wallet state back through the app API.';
  if (lower.includes('mole guard error')) return 'The Mole Guard command handler threw an exception before it could complete the slash command flow.';
  if (lower.includes('failed to send')) return 'The token transfer step failed while the utility bot was attempting to move WinLEW to the recipient wallet.';
  if (lower.includes('unauthorized') || lower.includes('restricted')) return 'The command was blocked because the requesting user did not have the required permissions.';
  return 'The bot reported a failure, but the message alone does not reveal the exact root cause.';
}

function getAuditRpcUrl() {
  return String(process.env.RPC_URL || process.env.SOLANA_RPC || 'https://solana-rpc.publicnode.com').trim();
}

function getAuditConnection() {
  const rpcUrl = getAuditRpcUrl();
  return new Connection(rpcUrl, 'confirmed');
}

async function getWinlewBalanceForWallet(connection, walletAddress) {
  const mint = String(process.env.WINLEW_MINT || '').trim();
  if (!mint) return null;

  const owner = new PublicKey(walletAddress);
  const mintPk = new PublicKey(mint);
  const response = await connection.getParsedTokenAccountsByOwner(owner, { mint: mintPk });
  if (!response?.value?.length) return 0;

  return response.value
    .map((row) => Number(row.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0))
    .reduce((sum, value) => sum + value, 0);
}

function collectParsedInstructions(parsedTx) {
  const instructions = [...(parsedTx?.transaction?.message?.instructions || [])];
  for (const group of parsedTx?.meta?.innerInstructions || []) {
    for (const instruction of group?.instructions || []) {
      instructions.push(instruction);
    }
  }
  return instructions;
}

async function findRecentTransferFromBotWallet({ connection, recipientWallet, botWallet, lookbackSec = 1800 }) {
  const mint = String(process.env.WINLEW_MINT || '').trim();
  if (!mint) return null;

  const recipientPk = new PublicKey(recipientWallet);
  const botPk = new PublicKey(botWallet);
  const mintPk = new PublicKey(mint);
  const recipientAta = getAssociatedTokenAddressSync(mintPk, recipientPk);
  const signatures = await connection.getSignaturesForAddress(botPk, { limit: 12 });
  const cutoff = Math.floor(Date.now() / 1000) - lookbackSec;

  for (const row of signatures) {
    if (Number(row.blockTime || 0) < cutoff) continue;
    const parsedTx = await connection.getParsedTransaction(row.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    }).catch(() => null);
    if (!parsedTx) continue;

    const matched = collectParsedInstructions(parsedTx).some((instruction) => {
      const info = instruction?.parsed?.info;
      const type = String(instruction?.parsed?.type || '').toLowerCase();
      if (!info || !type.includes('transfer')) return false;
      const destination = String(info.destination || info.destinationAccount || '');
      const destinationOwner = String(info.destinationOwner || info.owner || '');
      return destination === recipientAta.toBase58() || destinationOwner === recipientPk.toBase58();
    });

    if (matched) {
      return {
        signature: row.signature,
        blockTime: Number(row.blockTime || 0),
      };
    }
  }

  return null;
}

function getSavedWalletForUser(discordUserId) {
  const projectRoot = path.resolve(process.cwd());
  const faucetLinksFile = path.join(projectRoot, 'src', 'faucet', 'wallet_links.json');
  const molePrimary = path.join(projectRoot, 'data', 'linked_wallets.json');
  const moleMirror = path.join(projectRoot, 'src', 'data', 'linked_wallets.json');
  const faucetRaw = readJsonSafe(faucetLinksFile, { version: 1, links: {} });
  const faucetLinks = faucetRaw?.links && typeof faucetRaw.links === 'object' ? faucetRaw.links : faucetRaw;
  const faucetRecord = faucetLinks?.[String(discordUserId)];
  const faucetClaims = collectWalletClaims(faucetRecord, 'faucet', discordUserId);
  if (faucetClaims.length > 0) return faucetClaims[0].wallet;

  const moleData = readJsonSafe(fs.existsSync(molePrimary) ? molePrimary : moleMirror, {});
  const moleClaims = collectWalletClaims(moleData?.[String(discordUserId)], 'mole', discordUserId);
  return moleClaims[0]?.wallet || null;
}

function touchUserState(state, message, member) {
  const now = Math.floor(Date.now() / 1000);
  const existing = state.users[message.author.id] || null;
  const messageCount = Number(existing?.message_count || 0) + 1;

  state.users[message.author.id] = {
    username: message.author.tag || message.author.username,
    first_message_ts: existing?.first_message_ts || now,
    first_channel_id: existing?.first_channel_id || message.channelId,
    joined_ts: existing?.joined_ts || toEpochSeconds(member?.joinedTimestamp),
    message_count: messageCount,
    last_message_ts: now,
    last_channel_id: message.channelId,
  };

  if (!existing || messageCount <= 3) saveState(state);

  return {
    messageCount,
    isFirstObservedMessage: messageCount === 1,
  };
}

// Detects the "I buy aged/used SOL wallets" scam (and seed-phrase solicitation),
// which is pure text and slips past the URL/image heuristics. High precision:
// normal wallet chat must NOT trip it, so buy-intent + a wallet target + a scam
// tell are all required together.
function detectWalletBuyScam(content = '') {
  const t = String(content).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // Rule 1: soliciting a seed phrase / private key — never legitimate.
  // Negation guard so good advice ("never share your seed phrase") isn't flagged.
  const credMention = /\b(seed\s?phrase|secret\s?phrase|recovery\s?phrase|private\s?key|mnemonic|12[-\s]?word|24[-\s]?word)\b/.test(t);
  const credSolicit = /\b(send|share|give|dm|provide|enter|paste|verify|confirm|need|drop|hand\s?over)\b/.test(t);
  const negatedAdvice = /\b(never|do\s?n['’]?t|don['’]?t|dont|nobody|no\s?one|won['’]?t|wont|should\s?n['’]?t|avoid|scam|phish)\b/.test(t);
  if (credMention && credSolicit && !negatedAdvice) return { category: 'seed-solicitation' };

  // Rule 2: buying aged/used wallets.
  const buyIntent = /\b(buy(ing)?|purchas\w+|wtb|want\s+to\s+buy|looking\s+(for|to\s+buy)|paying|i\s*['’]?ll?\s+pay|i\s+pay)\b/.test(t);
  const walletTarget = /\b(wallets?|accounts?|phantom|solflare|metamask|trust\s?wallet|sol|solana)\b/.test(t);
  const tells = [
    /\b(aged|used|old|pre[-\s]?owned|second[-\s]?hand)\b/,
    /\bairdrop\s+(history|eligib\w+)\b/,
    /\btransactions?\b[^.]*\b20\d\d\b/,
    /\bdm\b/,
    /\bpay\w*\s*\$?\d/,
    /\b\$\d/,
    /\busdc\b/,
    /\bvolume\s+trading\b/,
    /\brent\s?bak\w+\b/,
    /\bverification\s+check\b/,
    /\bupfront\b/,
  ];
  const tellHits = tells.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
  const wtbExplicit = /\bwtb\b/.test(t) && walletTarget;
  if (wtbExplicit || (buyIntent && walletTarget && tellHits >= 1)) {
    return { category: 'wallet-buy-scam' };
  }
  return null;
}

function buildScamWarning() {
  return [
    '⚠️ **Heads up — that looked like a wallet-buying / seed-phrase scam.**',
    'WinLEW (and any legit platform) will **never** ask you to sell a wallet or share your **seed phrase / private key**.',
    'Handing over a recovery phrase can drain **every** wallet linked to it. Never sell "aged" wallets — reclaim unused SOL rent yourself with **Sol Incinerator** or Solflare.',
    'Type `!scaminfo` for the full breakdown.',
  ].join('\n');
}

function buildScamPsa() {
  return [
    '🛡️ **WinLEW Security — "I buy aged/used SOL wallets" scams**',
    '',
    'Offers to **buy your old/used Solana wallet** ("aged wallets", "airdrop history", "WTB old accounts, paid upfront in USDC after a verification check") are phishing. The goal is to drain your crypto or harvest your data.',
    '',
    '**Why they want your wallet**',
    '• **Seed-phrase harvesting** — they ask for your private key / recovery phrase to "verify" or "transfer ownership".',
    '• **Linked wallets** — many accounts share one seed phrase, so one key can expose all of them.',
    '• **No payment** — they take control first; the promised payment never arrives.',
    '',
    '**How Solana drains work**',
    '• A single Solana **approve** signature can execute instantly — one wrong click clears your assets.',
    '• `setAuthority` phishing transfers **ownership** of your token accounts; you then cannot move funds or revoke.',
    '• Malicious airdropped tokens/NFTs link to drainer sites.',
    '',
    '**Protect yourself**',
    '• **Never** share your seed phrase or private key — no real buyer or platform asks for it.',
    '• Use a **burner wallet** for unfamiliar dApps; keep savings separate.',
    '• Don\'t sell "old" wallets — **reclaim the SOL rent yourself** with **Sol Incinerator** or Solflare\'s close-account tool.',
    '• Verify browser extensions (look for the `chrome-extension` prefix) to avoid fake update overlays.',
  ].join('\n');
}

// ── Impersonation-name detection ───────────────────────────────────────────
// Catches accounts named to impersonate server fixtures ("📣announcements",
// "AIRDROP", "partnership", "support"). Normalize away emoji / leetspeak / spacing
// so variants collapse to the same core, but match precisely (full name or
// decorator-stripped core) so "Airdrop Hunter" does NOT trip while "Official
// Airdrop" / "📣 Announcements" do.
const IMPERSONATION_DECORATORS = new Set([
  'official', 'the', 'winlew', 'bot', 'team', 'server', 'mod', 'channel',
  'real', 'your', 'daily', 'new', 'hub', 'community',
]);

function normalizeName(value = '') {
  let s = String(value).toLowerCase();
  s = s
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
    .replace(/5/g, 's').replace(/7/g, 't').replace(/\$/g, 's').replace(/@/g, 'a');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // strip diacritics
  return s.replace(/[^a-z]/g, ''); // emoji, spaces, punctuation gone
}

// Returns 'ban' | 'flag' | null for a single raw name against normalized sets.
function classifyNameImpersonation(rawName, banSet, flagSet) {
  if (!rawName) return null;
  const full = normalizeName(rawName);
  if (!full) return null;
  if (banSet.has(full)) return 'ban';
  if (flagSet.has(full)) return 'flag';
  // decorator-stripped core (e.g. "Official Airdrop" -> "airdrop")
  const tokens = String(rawName)
    .split(/[^A-Za-z0-9]+/)
    .map(normalizeName)
    .filter((t) => t && !IMPERSONATION_DECORATORS.has(t));
  const core = tokens.join('');
  if (core && core !== full) {
    if (banSet.has(core)) return 'ban';
    if (flagSet.has(core)) return 'flag';
  }
  return null;
}

function buildImpersonationNote(name, isFlag = false) {
  return [
    `🚫 **Heads up:** an account using the name **"${name}"** ${isFlag ? 'was flagged' : 'was removed'} for impersonation.`,
    'WinLEW staff will **never** DM you to claim, verify, or "sync" a wallet, and we don\'t run announcement/airdrop/support DMs.',
    'Never share your seed phrase or private key. Type `!scaminfo` for the full breakdown.',
  ].join('\n');
}

function analyzeSecurityRisk(message, member, userHistory, allowedDomains) {
  const urls = extractUrls(message.content);
  const attachments = [...message.attachments.values()];
  const imageAttachments = attachments.filter(isImageAttachment);
  const lower = String(message.content || '').toLowerCase();
  const joinedMs = Number(member?.joinedTimestamp || 0);
  const createdMs = Number(message.author?.createdTimestamp || 0);
  const newMemberWindowMs = cfg.WATCHDOG_SECURITY_NEW_MEMBER_WINDOW_MINUTES * 60 * 1000;
  const accountAgeMs = cfg.WATCHDOG_SECURITY_MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;
  const joinedRecently = joinedMs > 0 && (Date.now() - joinedMs) <= newMemberWindowMs;
  const youngAccount = createdMs > 0 && (Date.now() - createdMs) <= accountAgeMs;
  const unknownDomains = urls
    .map(getHostname)
    .filter(Boolean)
    .filter((host) => !allowedDomains.has(host) && !allowedDomains.has(host.replace(/^www\./, '')));
  const usesShortener = unknownDomains.some((host) => SHORTENER_HOSTS.has(host));
  const usesPunycode = unknownDomains.some((host) => host.includes('xn--'));
  const maskedMarkdownLink = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/i.test(message.content || '');
  const hasTicketBait = /\b(open|create|start)\s+(a\s+)?ticket\b/i.test(message.content || '');
  const hasOpenseaPartnership = /\b(opensea)\b/i.test(message.content || '')
    && /\b(official|exclusive|new)?\s*(partnership|collaboration|collab)\b/i.test(message.content || '');
  const keywordHits = SUSPICIOUS_KEYWORDS.filter((phrase) => lower.includes(phrase));
  const firstMessageWithImageOnly = userHistory.isFirstObservedMessage && imageAttachments.length > 0 && !hasTextSubstance(message.content);
  const firstMessageWithUnknownLink = userHistory.isFirstObservedMessage && unknownDomains.length > 0;
  const reasons = [];
  let score = 0;

  if (hasTicketBait && (urls.length > 0 || attachments.length > 0)) {
    score += 7;
    reasons.push('ticket bait with a link or attachment');
  }

  if (hasOpenseaPartnership && urls.length > 0) {
    score += 7;
    reasons.push('fake partnership/OpenSea style pitch');
  }

  if (firstMessageWithImageOnly) {
    score += 6;
    reasons.push('first observed message was image-only');
  }

  if (firstMessageWithUnknownLink) {
    score += 5;
    reasons.push('first observed message used an unknown domain');
  }

  if (maskedMarkdownLink) {
    score += 3;
    reasons.push('masked markdown link');
  }

  if (unknownDomains.length > 0 && keywordHits.length > 0) {
    score += 4;
    reasons.push(`unknown link with scam keywords: ${keywordHits.slice(0, 4).join(', ')}`);
  } else if (unknownDomains.length > 0) {
    score += 2;
    reasons.push(`unknown domain: ${unknownDomains.slice(0, 3).join(', ')}`);
  }

  if (usesShortener) {
    score += 4;
    reasons.push('link shortener');
  }

  if (usesPunycode) {
    score += 4;
    reasons.push('punycode domain');
  }

  if (joinedRecently && (urls.length > 0 || attachments.length > 0)) {
    score += 2;
    reasons.push('new member posted risky content soon after joining');
  }

  if (youngAccount && (urls.length > 0 || attachments.length > 0)) {
    score += 2;
    reasons.push('young account posted risky content');
  }

  // Pure-text "buying aged wallets" / seed-phrase scams (no link/image needed).
  const walletScamHit = detectWalletBuyScam(message.content);
  if (walletScamHit) {
    score += 7; // crosses the flag threshold on its own
    reasons.push(walletScamHit.category === 'seed-solicitation'
      ? 'seed phrase / private key solicitation'
      : 'buying aged/used wallets scam pattern');
  }

  return {
    flagged: score >= 6,
    score,
    reasons,
    urls,
    attachments,
    unknownDomains,
    keywordHits,
    walletScam: !!walletScamHit,
    scamCategory: walletScamHit ? walletScamHit.category : null,
  };
}

async function main() {
  ensureDir();
  const state = loadState();
  const allowedDomains = parseCsvSet(cfg.WATCHDOG_SECURITY_ALLOWED_DOMAINS);
  const chatAllowedUserIds = parseCsvSet(cfg.WATCHDOG_CHAT_ALLOWED_USER_IDS);
  const chatAllowedRoleIds = parseCsvSet(cfg.WATCHDOG_CHAT_ALLOWED_ROLE_IDS);
  const trustedRoleIds = parseCsvSet(cfg.WATCHDOG_SECURITY_TRUSTED_ROLE_IDS);
  const watchedAuditBotTags = parseCsvSet(cfg.WATCHDOG_AUDIT_BOT_TAGS);
  const watchedAuditBotUserIds = parseCsvSet(cfg.WATCHDOG_AUDIT_BOT_USER_IDS);
  const watchedPresenceUserIds = parseCsvSet(cfg.WATCHDOG_PRESENCE_USER_IDS);
  const watchedPresenceTags = parseCsvSet(cfg.WATCHDOG_PRESENCE_USER_TAGS);
  const legacyPresenceUserId = String(cfg.WATCHDOG_PRESENCE_USER_ID || '').trim();
  const legacyPresenceUserTag = String(cfg.WATCHDOG_PRESENCE_USER_TAG || '').trim();
  if (legacyPresenceUserId) watchedPresenceUserIds.add(legacyPresenceUserId);
  if (legacyPresenceUserTag) watchedPresenceTags.add(legacyPresenceUserTag);
  let duplicateAuditRunning = false;
  let auditConnection = null;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildInvites,
    ],
  });
  await client.login(cfg.WATCHDOG_DISCORD_TOKEN);
  await new Promise((r) => client.once('clientReady', r));
  console.log(`🧿 Watchdog online as ${client.user.tag}`);

  const alertChannel = await client.channels.fetch(cfg.WATCHDOG_ALERT_CHANNEL_ID);
  const securityLogChannel = cfg.WATCHDOG_SECURITY_LOG_CHANNEL_ID
    ? await client.channels.fetch(cfg.WATCHDOG_SECURITY_LOG_CHANNEL_ID).catch(() => null)
    : alertChannel;
  const presenceLogChannel = cfg.WATCHDOG_PRESENCE_LOG_CHANNEL_ID
    ? await client.channels.fetch(cfg.WATCHDOG_PRESENCE_LOG_CHANNEL_ID).catch(() => null)
    : alertChannel;
  const auditLogChannel = cfg.WATCHDOG_AUDIT_CHANNEL_ID
    ? await client.channels.fetch(cfg.WATCHDOG_AUDIT_CHANNEL_ID).catch(() => null)
    : securityLogChannel || alertChannel;


  const CLAUDE_SYSTEM_PROMPT = `
You are WinLEW Watchdog AI for the WinLEW ecosystem.
Help debug bot code, explain errors, and suggest safe fixes.
Keep answers short, practical, and production-focused.
Do not expose secrets, API keys, tokens, private config, or full .env values.
When debugging logs, focus on likely cause, safest fix, and next command to run.
  `.trim();

  function redactSecrets(text = '') {
    return String(text)
      .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED_ANTHROPIC_KEY]')
      .replace(/(DISCORD[_A-Z]*TOKEN\s*=\s*)[^\s\n]+/gi, '$1[REDACTED_DISCORD_TOKEN]')
      .replace(/(ANTHROPIC_API_KEY\s*=\s*)[^\s\n]+/gi, '$1[REDACTED_ANTHROPIC_KEY]')
      .replace(/([A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,})/g, '[REDACTED_DISCORD_TOKEN]');
  }

  async function replyLong(message, content) {
    const safe = redactSecrets(content || '').slice(0, 5600);
    const chunks = safe.match(/[\s\S]{1,1900}/g) || ['No response generated.'];
    await message.reply(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      await message.channel.send(chunk);
    }
  }

  async function runClaudeCommand(message, prompt, overrides = {}) {
    if (!isClaudeConfigured()) {
      return message.reply('Claude is not configured yet. Add `ANTHROPIC_API_KEY` to the root `.env`, then restart watchdog.');
    }

    try {
      await message.channel.sendTyping();
      const content = overrides.content || redactSecrets(prompt);
      const reply = await askClaude(content, {
        system: overrides.system || CLAUDE_SYSTEM_PROMPT,
        max_tokens: overrides.max_tokens || 700,
        temperature: overrides.temperature ?? 0.3,
        messages: overrides.messages,
        // A human asked for this one, so bypass the pause — the attempt is
        // also how we find out the underlying problem is fixed.
        force: true,
      });
      return replyLong(message, reply);
    } catch (err) {
      console.error(`[WATCHDOG][CLAUDE] ${err?.claudeSummary || err?.message || err}`);
      // claudeSummary already says what to do (top up, fix the key, fix the
      // model), so surface it instead of sending moderators to the console.
      if (err?.claudeSummary) return message.reply(`Claude failed: ${err.claudeSummary}`);
      const status = err?.status ? ` status=${err.status}` : '';
      const type = err?.claudeCode || err?.error?.type || err?.type || err?.name || 'unknown_error';
      return message.reply(`Claude failed (${type}${status}). Check watchdog console logs for \`[WATCHDOG][CLAUDE]\`.`);
    }
  }

  function getOrCreateAuditConnection() {
    if (!auditConnection) auditConnection = getAuditConnection();
    return auditConnection;
  }

  async function logAuditEvent(kind, lines, details = {}) {
    const entry = {
      kind,
      ts: new Date().toISOString(),
      details,
    };

    appendJsonLine(auditPapertrailFile(), entry);
    recordSummaryEvent(kind, details);
    if (Array.isArray(lines) && lines.length > 0) {
      await auditLogChannel?.send(lines.join('\n')).catch(console.error);
    }
  }

  async function runDuplicateWalletAudit(reason = 'interval') {
    if (!cfg.WATCHDOG_AUDIT_ENABLED || duplicateAuditRunning) return;
    duplicateAuditRunning = true;

    try {
      const result = buildDuplicateWalletAudit();
      const previousFingerprint = String(state.audit?.duplicate_wallet_fingerprint || '');
      const previousCount = Number(state.audit?.duplicate_wallet_count || 0);
      state.audit.duplicate_wallet_fingerprint = result.fingerprint;
      state.audit.duplicate_wallet_count = result.total_duplicates;
      saveState(state);

      recordSummaryEvent('duplicate_wallet_audit', {
        reason,
        scanned_at: result.scanned_at,
        total_duplicates: result.total_duplicates,
        duplicates: result.duplicates,
      });

      if (result.fingerprint === previousFingerprint && result.total_duplicates === previousCount) return;

      if (result.total_duplicates === 0 && previousCount > 0) {
        await logAuditEvent('duplicate_wallet_audit', [
          '🟢 **SECURITY AIRDROP AUDIT** — duplicate wallet claims cleared.',
          `Reason: ${reason}`,
          'Current result: no wallets are claimed by multiple Discord users.',
        ], {
          reason,
          scanned_at: result.scanned_at,
          total_duplicates: 0,
          duplicates: [],
        });
        return;
      }

      if (result.total_duplicates > 0) {
        const top = result.duplicates.slice(0, 8);
        const lines = [
          `🟠 **SECURITY AIRDROP AUDIT** — found **${result.total_duplicates}** wallet(s) claimed by multiple Discord users.`,
          `Reason: ${reason}`,
        ];
        for (const item of top) {
          lines.push(`Wallet: \`${item.wallet}\` → users ${item.userIds.map((id) => `<@${id}>`).join(', ')}`);
        }
        if (result.total_duplicates > top.length) {
          lines.push(`Additional duplicates not shown: ${result.total_duplicates - top.length}`);
        }

        await logAuditEvent('duplicate_wallet_audit', lines, {
          reason,
          scanned_at: result.scanned_at,
          total_duplicates: result.total_duplicates,
          duplicates: result.duplicates,
        });
      }
    } catch (error) {
      console.error('[WATCHDOG][AUDIT][DUPLICATES]', error);
      await logAuditEvent('duplicate_wallet_audit', [
        '🔴 **SECURITY AIRDROP AUDIT** — duplicate wallet scan failed.',
        `Reason: ${reason}`,
        `Error: ${error?.message || error}`,
      ], {
        reason,
        failed: true,
        error: error?.message || String(error),
      });
    } finally {
      duplicateAuditRunning = false;
    }
  }

  async function warnChannel(message, text) {
    const sent = await message.channel.send(text).catch(() => null);
    if (!sent) return;
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, 30_000);
  }

  async function handleFlaggedMessage(message, verdict) {
    let deleted = false;
    let timedOut = false;

    if (message.deletable) {
      await message.delete().then(() => {
        deleted = true;
      }).catch(() => {});
    }

    if (
      cfg.WATCHDOG_SECURITY_TIMEOUT_MINUTES > 0
      && !verdict.walletScam // wallet-buy / seed scams: delete + alert only, no auto-timeout
      && message.member?.moderatable
      && !message.member.permissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await message.member.timeout(
        cfg.WATCHDOG_SECURITY_TIMEOUT_MINUTES * 60 * 1000,
        'Watchdog phishing heuristic match',
      ).then(() => {
        timedOut = true;
      }).catch(() => {});
    }

    // Public education warning for wallet-buying / seed-phrase scams.
    if (verdict.walletScam) {
      await message.channel.send(buildScamWarning()).catch(() => {});
    }

    const preview = cleanPreview(redactSecrets(message.content || ''), 260) || '[no text]';
    const linkSummary = verdict.urls.map((url) => url.href).slice(0, 3).join(', ') || 'none';
    const attachmentSummary = verdict.attachments.map((attachment) => attachment.url).slice(0, 3).join(', ') || 'none';
    const lines = [
      `🚨 **SECURITY FLAG** — ${deleted ? 'removed' : 'flagged'} message from <@${message.author.id}> in <#${message.channelId}>.`,
      `Score: **${verdict.score}**`,
      `Reasons: ${verdict.reasons.join('; ') || 'heuristic trigger'}`,
      `Preview: ${preview}`,
      `Links: ${linkSummary}`,
      `Attachments: ${attachmentSummary}`,
    ];

    if (timedOut) lines.push(`Action: timed out for ${cfg.WATCHDOG_SECURITY_TIMEOUT_MINUTES} minute(s).`);
    if (!deleted) lines.push('Action: message could not be deleted. Check Watchdog permissions.');

    await logAuditEvent('security_flag', lines, {
      userId: message.author.id,
      channelId: message.channelId,
      score: verdict.score,
      reasons: verdict.reasons,
      preview,
      links: verdict.urls.map((url) => url.href),
      attachments: verdict.attachments.map((attachment) => attachment.url),
      deleted,
      timedOut,
    });

    if (deleted) {
      await warnChannel(
        message,
        `<@${message.author.id}> your message was removed by Watchdog because it matched a phishing or scam pattern. Contact a moderator if this was a false positive.`,
      ).catch(() => {});
    }
  }

  async function resolveWatchedPresenceMembers() {
    const guildId = String(cfg.WATCHDOG_PRESENCE_GUILD_ID || process.env.DISCORD_GUILD_ID || '').trim();
    if (!guildId) return [];

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return [];

    const membersById = new Map();

    for (const userId of watchedPresenceUserIds) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) membersById.set(member.id, member);
    }

    for (const targetTag of watchedPresenceTags) {
      const query = targetTag.split('#')[0];
      const matches = await guild.members.search({ query, limit: 10 }).catch(() => null);
      const member = matches?.find((item) => item.user?.tag === targetTag || item.user?.username === targetTag);
      if (member) {
        watchedPresenceUserIds.add(member.id);
        membersById.set(member.id, member);
      }
    }

    return [...membersById.values()];
  }

  async function primeWatchedPresences() {
    const members = await resolveWatchedPresenceMembers();
    if (!members.length) {
      if (watchedPresenceUserIds.size || watchedPresenceTags.size) {
        console.warn('[WATCHDOG][PRESENCE] Could not resolve any watched members.');
      }
      return;
    }

    for (const member of members) {
      state.watchedPresences[member.id] = {
        label: member.user.tag,
        status: bucketPresenceStatus(member.presence?.status),
      };
      console.log(`[WATCHDOG][PRESENCE] Watching ${member.user.tag} (${member.id})`);
    }
    saveState(state);
  }

  async function resolveTargetMessage(commandMessage) {
    if (commandMessage.reference?.messageId) {
      const referenced = await commandMessage.channel.messages.fetch(commandMessage.reference.messageId).catch(() => null);
      if (referenced && !referenced.author?.bot) return referenced;
    }

    const recent = await commandMessage.channel.messages.fetch({ limit: 8 }).catch(() => null);
    if (!recent) return null;

    return recent.find((candidate) => candidate.id !== commandMessage.id && !candidate.author?.bot) || null;
  }

  async function runLastMessageReview(commandMessage, userPrompt = '') {
    const targetMessage = await resolveTargetMessage(commandMessage);
    if (!targetMessage) {
      return commandMessage.reply('I could not find a prior user message in this channel to review.');
    }

    const targetText = cleanPreview(redactSecrets(targetMessage.content || ''), 1200) || '[no text]';
    const targetUrls = extractUrls(targetMessage.content || '').map((url) => url.href);
    const attachments = [...targetMessage.attachments.values()];
    const imageAttachments = attachments.filter(isClaudeVisionAttachment).slice(0, 3);
    const otherAttachments = attachments
      .filter((attachment) => !imageAttachments.some((image) => image.id === attachment.id))
      .map((attachment) => attachment.url)
      .slice(0, 5);
    const reviewInstruction = userPrompt
      ? `Extra instruction from requester: ${userPrompt}`
      : 'Explain what the post appears to say or show, what its likely intent is, and any obvious safety or phishing concerns. Keep it concise and conversational.';
    const contentBlocks = [
      {
        type: 'text',
        text: [
          'Review this Discord post for a trusted WinLEW user.',
          reviewInstruction,
          'State uncertainty when the image or text is unclear. Do not invent unreadable text.',
          `Author: ${targetMessage.author?.tag || targetMessage.author?.username || targetMessage.authorId}`,
          `Channel: #${targetMessage.channel?.name || targetMessage.channelId}`,
          `Message text: ${targetText}`,
          `Detected links: ${targetUrls.length ? targetUrls.join(', ') : 'none'}`,
          `Other attachments: ${otherAttachments.length ? otherAttachments.join(', ') : 'none'}`,
        ].join('\n'),
      },
    ];

    for (const attachment of imageAttachments) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'url',
          url: attachment.url,
        },
      });
    }

    if (!targetMessage.content && imageAttachments.length === 0 && otherAttachments.length === 0) {
      return commandMessage.reply('That message does not have any text or attachments for me to review.');
    }

    return runClaudeCommand(commandMessage, 'Review the last Discord message.', {
      content: contentBlocks,
      system: [
        'You are WinLEW Watchdog reviewing a Discord post for an approved community member.',
        'Describe what the post appears to communicate, its likely intent, and any trust or safety concerns.',
        'Be calm, direct, and concise.',
        'If an attached image is hard to read, say that plainly instead of guessing.',
      ].join(' '),
      max_tokens: 700,
      temperature: 0.2,
    });
  }

  function isWatchedAuditBot(message) {
    if (!message?.author?.bot) return false;
    if (watchedAuditBotUserIds.has(String(message.author.id))) return true;
    const label = getWatchedBotLabel(message.author);
    return watchedAuditBotTags.has(label) || watchedAuditBotTags.has(String(message.author.username || '').trim());
  }

  async function resolveDripRecipientFromReference(referenceMessage) {
    if (!referenceMessage) return null;

    const args = extractCommandArgs(referenceMessage.content || '');
    const explicitTarget = String(args[0] || '').trim();
    if (explicitTarget) {
      const pubkey = await resolveSolanaAddress(explicitTarget).catch(() => null);
      if (pubkey) return { wallet: pubkey.toBase58(), source: 'command-arg', input: explicitTarget };
    }

    const saved = getSavedWalletForUser(referenceMessage.author?.id);
    if (saved) return { wallet: saved, source: 'saved-wallet', input: saved };
    return null;
  }

  async function buildDripAuditNotes(failureText, referenceMessage) {
    const recipient = await resolveDripRecipientFromReference(referenceMessage);
    const botWallet = await resolveSolanaAddress(cfg.WATCHDOG_UTILITY_BOT_WALLET).catch(() => null);
    const lines = [];
    const details = {
      utilityBotWallet: cfg.WATCHDOG_UTILITY_BOT_WALLET,
      recipientWallet: recipient?.wallet || null,
      recipientSource: recipient?.source || null,
    };

    if (!recipient?.wallet) {
      lines.push('Chain check: could not resolve the intended drip recipient from the original command or saved wallet data.');
      return { lines, details };
    }

    const connection = getOrCreateAuditConnection();
    const recipientName = await resolveSolanaName(recipient.wallet).catch(() => null);
    const balance = await getWinlewBalanceForWallet(connection, recipient.wallet).catch(() => null);
    const recentMatch = botWallet
      ? await findRecentTransferFromBotWallet({
          connection,
          recipientWallet: recipient.wallet,
          botWallet: botWallet.toBase58(),
        }).catch(() => null)
      : null;

    details.recipientName = recipientName;
    details.recipientBalance = balance;
    details.recentTransfer = recentMatch;

    lines.push(`Recipient: \`${recipient.wallet}\`${recipientName ? ` (${recipientName})` : ''}`);
    if (balance !== null) lines.push(`Current WinLEW balance at recipient: ${balance}`);

    if (recentMatch?.signature) {
      lines.push(`Chain check: recent transfer from \`${cfg.WATCHDOG_UTILITY_BOT_WALLET}\` found on-chain: <https://solscan.io/tx/${recentMatch.signature}>`);
      lines.push('Interpretation: the drip may have completed even though the bot reported a failure.');
    } else if (failureText.toLowerCase().includes('transaction expired') || failureText.toLowerCase().includes('block height exceeded')) {
      lines.push(`Chain check: no recent matching transfer found from \`${cfg.WATCHDOG_UTILITY_BOT_WALLET}\` in the recent audit window.`);
      lines.push('Interpretation: this looks like an expired or dropped transaction rather than a completed drip.');
    } else {
      lines.push(`Chain check: no recent matching transfer found from \`${cfg.WATCHDOG_UTILITY_BOT_WALLET}\` in the recent audit window.`);
    }

    return { lines, details };
  }

  async function explainFailedBotMessage(message, failureText, referenceMessage) {
    const heuristic = explainFailureHeuristically(failureText);
    const lines = [heuristic];

    // isClaudeAvailable(), not isClaudeConfigured(): a configured-but-broken
    // key (no credit, revoked, bad model) would otherwise be retried on every
    // failure-looking bot message. The heuristic below is the fallback either
    // way, so skipping costs nothing.
    if (isClaudeAvailable()) {
      try {
        const reply = await askClaude([
          {
            type: 'text',
            text: [
              'Explain this failed Discord bot message for an internal WinLEW audit log.',
              'Keep it to two short sentences: what it likely means and the next thing moderators should check.',
              `Bot: ${getWatchedBotLabel(message.author)}`,
              `Failure message: ${cleanPreview(redactSecrets(failureText), 700)}`,
              `Referenced command: ${cleanPreview(referenceMessage?.content || 'none', 300)}`,
              `Heuristic note: ${heuristic}`,
            ].join('\n'),
          },
        ], {
          system: 'You are WinLEW Watchdog explaining failed bot messages for moderators. Be concise, practical, and avoid fluff.',
          max_tokens: 180,
          temperature: 0.2,
        });
        if (reply) lines[0] = reply;
      } catch (error) {
        // One line, not a stack trace: this fires per bot failure, and
        // askClaude() has already logged the actionable detail once and parked
        // itself if the cause is fatal.
        console.error(`[WATCHDOG][AUDIT][BOT-FAILURE][CLAUDE] ${error?.claudeSummary || error?.message || error}`);
      }
    }

    return lines[0];
  }

  async function maybeAuditBotFailureMessage(message) {
    if (!cfg.WATCHDOG_AUDIT_ENABLED || !isWatchedAuditBot(message)) return;

    const failureText = extractMessageText(message);
    if (!isFailureLikeText(failureText)) return;
    if (state.audit.bot_failure_message_ids?.[message.id]) return;

    const referenceMessage = message.reference?.messageId
      ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
      : null;
    const isDripFailure = getWatchedBotLabel(message.author).includes('UtilityBot')
      && (looksLikeDripCommand(referenceMessage?.content || '') || failureText.toLowerCase().includes('faucet'));
    const explanation = await explainFailedBotMessage(message, failureText, referenceMessage);
    const dripNotes = isDripFailure ? await buildDripAuditNotes(failureText, referenceMessage) : { lines: [], details: {} };
    const lines = [
      `🧾 **BOT FAILURE AUDIT** — ${getWatchedBotLabel(message.author)} posted a failure in <#${message.channelId}>.`,
      `Failure: ${cleanPreview(redactSecrets(failureText), 500)}`,
      `Explanation: ${explanation}`,
    ];

    if (referenceMessage?.content) {
      lines.push(`Referenced command: ${cleanPreview(referenceMessage.content, 250)}`);
    }
    lines.push(...dripNotes.lines);

    state.audit.bot_failure_message_ids = pruneMarkedMessageIds({
      ...(state.audit.bot_failure_message_ids || {}),
      [message.id]: Date.now(),
    });
    saveState(state);

    await logAuditEvent('bot_failure_audit', lines, {
      botUserId: message.author.id,
      botLabel: getWatchedBotLabel(message.author),
      channelId: message.channelId,
      messageId: message.id,
      failureText: cleanPreview(redactSecrets(failureText), 700),
      explanation,
      referencedMessageId: referenceMessage?.id || null,
      referencedCommand: cleanPreview(referenceMessage?.content || '', 300),
      dripAudit: dripNotes.details,
    });
  }

  // ── Impersonation auto-ban / flag + invite tracking ──────────────────────
  const impersonationBanSet = new Set([...parseCsvSet(cfg.WATCHDOG_IMPERSONATION_BAN_NAMES)].map(normalizeName).filter(Boolean));
  const impersonationFlagSet = new Set([...parseCsvSet(cfg.WATCHDOG_IMPERSONATION_FLAG_NAMES)].map(normalizeName).filter(Boolean));
  const inviteUseCache = new Map();        // guildId -> Map(code -> uses)
  const memberJoinInvite = new Map();      // userId -> { code, inviter }
  const impersonationThrottle = new Map(); // userId -> ts (flag warnings only)
  const IMPERSONATION_THROTTLE_MS = 10 * 60 * 1000;

  async function cacheGuildInvites(guild) {
    try {
      const invites = await guild.invites.fetch();
      const m = new Map();
      invites.forEach((inv) => m.set(inv.code, inv.uses || 0));
      inviteUseCache.set(guild.id, m);
    } catch (e) {
      console.warn(`[watchdog] invite cache failed for ${guild?.name || guild?.id} (needs "Manage Server"):`, e?.message || e);
    }
  }

  async function resolveJoinInvite(guild) {
    const before = inviteUseCache.get(guild.id) || new Map();
    try {
      const invites = await guild.invites.fetch();
      let used = null;
      invites.forEach((inv) => { if (!used && (inv.uses || 0) > (before.get(inv.code) || 0)) used = inv; });
      const after = new Map();
      invites.forEach((inv) => after.set(inv.code, inv.uses || 0));
      inviteUseCache.set(guild.id, after);
      if (used) return { code: used.code, inviter: used.inviter?.tag || used.inviterId || 'unknown' };
    } catch { /* missing perms / vanity URL */ }
    return null;
  }

  function classifyMember(member) {
    const candidates = [member?.nickname, member?.user?.globalName, member?.user?.username, member?.displayName];
    let flagHit = null;
    for (const name of candidates) {
      const v = classifyNameImpersonation(name, impersonationBanSet, impersonationFlagSet);
      if (v === 'ban') return { action: 'ban', name };
      if (v === 'flag' && !flagHit) flagHit = { action: 'flag', name };
    }
    return flagHit;
  }

  // Returns 'ban' | 'flag' | false. Trusted roles, admins, and bots are excluded.
  async function handleImpersonation(member, trigger, message = null) {
    if (!cfg.WATCHDOG_IMPERSONATION_ENABLED || !member || member.user?.bot) return false;
    if (canBypassModeration(member, trustedRoleIds)) return false;
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return false;
    const verdict = classifyMember(member);
    if (!verdict) return false;

    const inv = memberJoinInvite.get(member.id) || null;
    const inviteLine = inv
      ? `Joined via invite \`${inv.code}\`${inv.inviter ? ` (created by ${inv.inviter})` : ''} — a mod can delete this invite if it's a known bad-acting link.`
      : 'Joined via invite: n/a (vanity URL, joined before watchdog start, or missing "Manage Server").';
    const ageDays = member.user?.createdTimestamp
      ? Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000) : '?';

    if (verdict.action === 'ban') {
      let banned = false;
      try {
        if (member.bannable) { await member.ban({ reason: `Watchdog impersonation: name "${verdict.name}"` }); banned = true; }
      } catch (e) { console.warn('[watchdog] impersonation ban failed:', e?.message || e); }
      await logAuditEvent('impersonation_ban', [
        `🚫 **IMPERSONATION ${banned ? 'BAN' : 'DETECTED'}** — <@${member.id}> (${member.user?.tag || member.id}) [${trigger}]`,
        `Name **"${verdict.name}"** matched the ban list.`,
        `Account age: ${ageDays} day(s).`,
        inviteLine,
        banned ? 'Action: **banned**.' : '⚠️ Could NOT ban — check the watchdog has **Ban Members** and sits above this user in the role list. Manual action needed.',
      ], { userId: member.id, name: verdict.name, trigger, invite: inv, banned });
      if (message?.channel) {
        if (message.deletable) await message.delete().catch(() => {});
        await message.channel.send(buildImpersonationNote(verdict.name, false)).catch(() => {});
      }
      return 'ban';
    }

    // flag (e.g. "support"): never auto-ban; throttle repeat alerts/warnings.
    const last = impersonationThrottle.get(member.id) || 0;
    if (Date.now() - last >= IMPERSONATION_THROTTLE_MS) {
      impersonationThrottle.set(member.id, Date.now());
      await logAuditEvent('impersonation_flag', [
        `⚠️ **IMPERSONATION FLAG** — <@${member.id}> (${member.user?.tag || member.id}) using **"${verdict.name}"** [${trigger}]`,
        'Not auto-banned — could be legitimate cross-server support that did not rename. Please review.',
        `Account age: ${ageDays} day(s).`,
        inviteLine,
      ], { userId: member.id, name: verdict.name, trigger, invite: inv });
      if (message?.channel) await message.channel.send(buildImpersonationNote(verdict.name, true)).catch(() => {});
    }
    return 'flag';
  }

  // Prime the invite cache + wire impersonation events.
  for (const guild of client.guilds.cache.values()) await cacheGuildInvites(guild);
  client.on('inviteCreate', (inv) => {
    if (!inv.guild?.id) return;
    const m = inviteUseCache.get(inv.guild.id) || new Map();
    m.set(inv.code, inv.uses || 0);
    inviteUseCache.set(inv.guild.id, m);
  });
  client.on('inviteDelete', (inv) => { inviteUseCache.get(inv.guild?.id)?.delete(inv.code); });
  client.on('guildMemberAdd', async (member) => {
    try {
      const inv = await resolveJoinInvite(member.guild);
      if (inv) memberJoinInvite.set(member.id, inv);
      await handleImpersonation(member, 'join');
    } catch (e) { console.warn('[watchdog] guildMemberAdd error:', e?.message || e); }
  });
  client.on('guildMemberUpdate', async (oldM, newM) => {
    if (oldM.nickname === newM.nickname && oldM.displayName === newM.displayName) return;
    await handleImpersonation(newM, 'rename').catch(() => {});
  });
  client.on('userUpdate', async (oldU, newU) => {
    if (oldU.username === newU.username && oldU.globalName === newU.globalName) return;
    for (const guild of client.guilds.cache.values()) {
      const m = guild.members.cache.get(newU.id);
      if (m) await handleImpersonation(m, 'rename').catch(() => {});
    }
  });

  // ── Right-click a message → Apps → "Report Scam / Phishing" (moderators) ──
  // Scores the message with the same heuristics as the automatic filter, asks
  // Claude for a one-line verdict when it is available, and posts the report to
  // the audit log with Delete / Timeout buttons. Nothing is removed until a
  // moderator presses one of them.
  const REPORT_SCAM_CMD = 'Report Scam / Phishing';
  const REPORT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
  const REPORT_PROMPT = [
    'You review Discord messages reported by moderators of the WinLEW crypto community.',
    'Answer in ONE line: "SCAM", "LIKELY SCAM", "UNCLEAR" or "NOT A SCAM", then a short reason.',
    'Common scams: fake support/ticket links, wallet drainers, seed-phrase requests, fake airdrops, buying "aged" wallets, impersonation.',
  ].join('\n');

  for (const guild of client.guilds.cache.values()) {
    // Creating a command with an existing name updates it, so this is safe on every start.
    await guild.commands.create({
      name: REPORT_SCAM_CMD,
      type: ApplicationCommandType.Message,
      defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    }).catch((err) => console.error(`[WATCHDOG][REPORT] could not register in ${guild.name}: ${err?.message || err}`));
  }

  async function aiScamVerdict(text) {
    if (!text || !isClaudeAvailable()) return null;
    try {
      const reply = await askClaude(`Reported message:\n---\n${redactSecrets(text).slice(0, 1500)}\n---`, {
        system: REPORT_PROMPT, max_tokens: 120, temperature: 0,
      });
      return cleanPreview(String(reply || ''), 220) || null;
    } catch (err) {
      console.error(`[WATCHDOG][REPORT][CLAUDE] ${err?.claudeSummary || err?.message || err}`);
      return null;
    }
  }

  async function handleScamReport(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ ephemeral: true, content: '❌ Reporting is for moderators (Manage Messages).' });
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.targetMessage;
    const member = target.member || await target.guild?.members.fetch(target.author.id).catch(() => null);
    const verdict = analyzeSecurityRisk(target, member, { isFirstObservedMessage: false }, allowedDomains);
    const ai = await aiScamVerdict(target.content || '');
    const link = `https://discord.com/channels/${target.guildId}/${target.channelId}/${target.id}`;
    const preview = cleanPreview(redactSecrets(target.content || ''), 260) || '[no text]';
    const ageDays = target.author?.createdTimestamp ? Math.floor((Date.now() - target.author.createdTimestamp) / 86_400_000) : null;
    const joinedDays = member?.joinedTimestamp ? Math.floor((Date.now() - member.joinedTimestamp) / 86_400_000) : null;
    const lines = [
      `🚩 **SCAM REPORT** by <@${interaction.user.id}> — message from <@${target.author.id}> in <#${target.channelId}> · ${link}`,
      `Author: account ${ageDays ?? '?'} day(s) old · joined ${joinedDays ?? '?'} day(s) ago${target.author?.bot ? ' · BOT' : ''}`,
      `Heuristic score: **${verdict.score}**${verdict.flagged ? ' (would be auto-removed)' : ''} — ${verdict.reasons.join('; ') || 'no pattern matched'}`,
      ...(ai ? [`AI: ${ai}`] : []),
      `Preview: ${preview}`,
      `Links: ${verdict.urls.map((url) => `<${url.href}>`).slice(0, 3).join(', ') || 'none'}`,
    ];
    const canTimeout = Boolean(member?.moderatable) && !member.permissions?.has(PermissionFlagsBits.Administrator);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wdreport:delete:${target.channelId}:${target.id}`).setLabel('Delete message').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`wdreport:timeout:${target.author.id}`).setLabel('Time out 24 h').setStyle(ButtonStyle.Secondary).setDisabled(!canTimeout),
    );
    await logAuditEvent('scam_report', [], {
      reporterId: interaction.user.id, userId: target.author.id, channelId: target.channelId, messageId: target.id,
      score: verdict.score, reasons: verdict.reasons, ai, preview, links: verdict.urls.map((url) => url.href),
    });
    const posted = await auditLogChannel?.send({ content: lines.join('\n').slice(0, 1990), components: [row], allowedMentions: { parse: [] } }).catch((err) => {
      console.error(`[WATCHDOG][REPORT] audit post failed: ${err?.message || err}`);
      return null;
    });
    return interaction.editReply([
      posted ? `✅ Reported to <#${posted.channelId}>. Use its buttons to delete or time out.` : '⚠️ Recorded, but the audit channel could not be reached.',
      `Score ${verdict.score}${ai ? ` · AI: ${ai}` : ''}`,
    ].join('\n'));
  }

  async function handleScamReportButton(interaction) {
    const [, action, a, b] = interaction.customId.split(':');
    const need = action === 'delete' ? PermissionFlagsBits.ManageMessages : PermissionFlagsBits.ModerateMembers;
    if (!interaction.memberPermissions?.has(need)) {
      return interaction.reply({ ephemeral: true, content: `❌ You need ${action === 'delete' ? 'Manage Messages' : 'Timeout Members'} for that.` });
    }
    let result;
    try {
      if (action === 'delete') {
        const channel = await client.channels.fetch(a);
        const msg = await channel.messages.fetch(b).catch(() => null);
        if (!msg) result = 'ℹ️ Message was already gone.';
        else { await msg.delete(); result = `🗑️ Message deleted by <@${interaction.user.id}>.`; }
      } else {
        const member = await interaction.guild.members.fetch(a);
        await member.timeout(REPORT_TIMEOUT_MS, `Scam report actioned by ${interaction.user.tag}`);
        result = `⏳ <@${a}> timed out for 24 h by <@${interaction.user.id}>.`;
      }
    } catch (err) {
      return interaction.reply({ ephemeral: true, content: `❌ Discord refused: ${err?.message || err}` });
    }
    // Keep the record; disable the button that was used.
    const rows = interaction.message.components.map((r) => new ActionRowBuilder().addComponents(
      r.components.map((c) => ButtonBuilder.from(c).setDisabled(c.disabled || c.customId === interaction.customId)),
    ));
    await interaction.update({ content: `${interaction.message.content}\n${result}`.slice(0, 1990), components: rows, allowedMentions: { parse: [] } });
    await logAuditEvent(`scam_report_${action}`, [], { by: interaction.user.id, target: a, messageId: b || null });
  }

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isMessageContextMenuCommand?.() && interaction.commandName === REPORT_SCAM_CMD) return await handleScamReport(interaction);
      if (interaction.isButton?.() && interaction.customId.startsWith('wdreport:')) return await handleScamReportButton(interaction);
    } catch (err) {
      console.error(`[WATCHDOG][REPORT] ${err?.message || err}`);
      const reply = { ephemeral: true, content: '❌ Report failed. Check the watchdog logs for [WATCHDOG][REPORT].' };
      if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author?.bot) {
      await maybeAuditBotFailureMessage(message);
      return;
    }
    if (!message.guildId) return;
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    const userHistory = touchUserState(state, message, member);
    const content = message.content?.trim() || '';
    const canChat = canUseWatchdogChat(member, message.author.id, chatAllowedUserIds, chatAllowedRoleIds);
    const mentionPrompt = message.mentions?.has(client.user)
      ? getMentionPrompt(content, client.user.id)
      : '';
    const wdLastPrompt = getWatchdogLastPrompt(content);
    const isWatchdogChatMessage = content.startsWith('!wd ')
      || content.startsWith('!watchdog ')
      || wdLastPrompt !== null
      || content.startsWith('!debug ')
      || content === '!wd-ping'
      || content === '!watchdog-ping'
      || content === '!wd-test'
      || content === '!watchdog-test'
      || Boolean(mentionPrompt);

    if (/^!(register|save|linkwallet)\b/i.test(content)) {
      setTimeout(() => {
        runDuplicateWalletAudit('wallet-command').catch(console.error);
      }, 8_000);
    }

    // Name-impersonation: auto-ban announcements/airdrop/partnership names (+ public
    // note), flag "support" names (warn + alert, no ban). A ban also deletes the
    // message and stops further processing; a flag lets the message continue.
    if (cfg.WATCHDOG_IMPERSONATION_ENABLED && member && !(canChat && isWatchdogChatMessage)) {
      const action = await handleImpersonation(member, 'message', message).catch(() => false);
      if (action === 'ban') return;
    }

    if (
      cfg.WATCHDOG_SECURITY_ENABLED
      && !canBypassModeration(member, trustedRoleIds)
      && !(canChat && isWatchdogChatMessage)
    ) {
      const verdict = analyzeSecurityRisk(message, member, userHistory, allowedDomains);
      if (verdict.flagged) {
        await handleFlaggedMessage(message, verdict);
        return;
      }
    }

    if (!message?.content) return;

    if (content === '!wd-help' || content === '!watchdog-help') {
      return message.reply([
        '**WinLEW Watchdog commands**',
        '`!wd <question>` — ask the WinLEW Watchdog AI from the watchdog bot (approved users only)',
        '`!watchdog <question>` — full alias for `!wd`',
        '`!wd-last [optional instruction]` — review the replied-to post or previous user message, including images when possible',
        '`@Watchdog <question>` — mention the bot to chat directly (approved users only)',
        '`!debug <error/log>` — explains likely cause + safest fix',
        '`!scaminfo` — explains the "buying aged wallets" / seed-phrase scam and how to stay safe',
        'Right-click a message → Apps → **Report Scam / Phishing** — moderators: scores it, asks the AI, posts to the audit log with Delete / Timeout buttons',
        '`!wd-ping` / `!watchdog-ping` — confirms watchdog can see the Claude config without spending tokens',
        '`!wd-test` / `!watchdog-test` — makes a tiny live Claude API call',
      ].join('\n'));
    }

    if (content === '!scaminfo' || content === '!scam' || content === '!scam-info') {
      return message.channel.send(buildScamPsa());
    }

    if (content === '!wd-ping' || content === '!watchdog-ping') {
      if (!canChat) return message.reply('Watchdog chat is limited to approved users, roles, or moderators.');
      const model = getClaudeModel();
      const pause = getClaudePause();
      const lines = [`Claude config: ${isClaudeConfigured() ? '✅ API key loaded' : '❌ missing API key'} | model: \`${model}\``];
      if (pause) {
        // A loaded key that can't actually be used reads as "✅" above, which
        // is exactly how the empty-credit-balance outage looked healthy.
        const mins = Math.max(1, Math.ceil((pause.until - Date.now()) / 60_000));
        lines.push(`⏸️ Automatic Claude calls paused (${pause.code}) for ~${mins} min: ${pause.summary}`);
        lines.push('`!wd-test` retries immediately and resumes automatic calls if it succeeds.');
      }
      return message.reply(lines.join('\n'));
    }

    if (content === '!wd-test' || content === '!watchdog-test') {
      if (!canChat) return message.reply('Watchdog chat is limited to approved users, roles, or moderators.');
      return runClaudeCommand(message, 'Reply in one short sentence: WinLEW Watchdog AI test is online.', {
        max_tokens: 80,
        temperature: 0,
      });
    }

    if (content.startsWith('!wd ') || content.startsWith('!watchdog ')) {
      if (!canChat) return message.reply('Watchdog chat is limited to approved users, roles, or moderators.');
      const prompt = content.startsWith('!watchdog ')
        ? content.slice('!watchdog '.length).trim()
        : content.slice('!wd '.length).trim();

      if (!prompt) return message.reply('Ask the WinLEW Watchdog something after `!wd`.');
      return runClaudeCommand(message, prompt);
    }

    if (content.startsWith('!debug ')) {
      if (!canChat) return message.reply('Watchdog chat is limited to approved users, roles, or moderators.');
      const prompt = content.slice('!debug '.length).trim();
      if (!prompt) return message.reply('Paste the error or log after `!debug`.');

      return runClaudeCommand(message, `Debug this WinLEW Watchdog/Mole-Guard issue. Give: 1) likely cause, 2) safest fix, 3) exact next command or file to check.\n\n${prompt}`, {
        max_tokens: 900,
        temperature: 0.2,
      });
    }

    if (wdLastPrompt !== null) {
      if (!canChat) return message.reply('Watchdog chat is limited to approved users, roles, or moderators.');
      return runLastMessageReview(message, wdLastPrompt);
    }

    if (mentionPrompt) {
      if (!canChat) return message.reply('Watchdog chat is limited to approved users, roles, or moderators.');
      return runClaudeCommand(message, mentionPrompt);
    }
  });

  client.on('presenceUpdate', async (oldPresence, newPresence) => {
    const candidateUserId = newPresence?.userId || oldPresence?.userId;
    if (!candidateUserId || !watchedPresenceUserIds.has(candidateUserId)) return;

    const current = state.watchedPresences[candidateUserId] || {};
    const before = bucketPresenceStatus(oldPresence?.status || current.status);
    const after = bucketPresenceStatus(newPresence?.status);
    if (before === after) return;

    const label = String(
      newPresence?.user?.tag
      || oldPresence?.user?.tag
      || current.label
      || candidateUserId,
    );
    state.watchedPresences[candidateUserId] = { label, status: after };
    saveState(state);

    const detail = newPresence?.status && after === 'online' ? ` (${newPresence.status})` : '';
    const text = after === 'online'
      ? `🟢 **PRESENCE** — \`${label}\` came online${detail}.`
      : `🔴 **PRESENCE** — \`${label}\` went offline.`;
    await presenceLogChannel?.send(text).catch(console.error);
  });

  await primeWatchedPresences();
  await runDuplicateWalletAudit('startup');

  async function sendAlert(type, service, rec, extra) {
  if (!alertChannel?.send) return;

  if (type === 'offline') {
    const msg = rec.maintenance
      ? `🟡 **MAINTENANCE** — \`${service}\` is offline (planned). ${rec.maintenance_reason ? `Reason: ${rec.maintenance_reason}` : ''}`
      : `🔴 **OFFLINE** — \`${service}\` missed heartbeat (last seen ${fmtDur(extra)} ago).`;
    await alertChannel.send(msg);
    return;
  }

  if (type === 'crash') {
    const detail = typeof extra === 'object' && extra ? extra : {};
    const code = detail.code ?? '?';
    const signal = detail.signal ?? '';
    const msg = `⚠️ **STOPPED** — \`${service}\` exited ${signal ? `(signal ${signal}) ` : ''}with code **${code}**.`;
    await alertChannel.send(msg);
    return;
  }

  // online/default
  const msg = `🟢 **ONLINE** — \`${service}\` heartbeat restored.`;
  await alertChannel.send(msg);
}

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(morgan('dev'));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/heartbeat', (req, res) => {
    const auth = String(req.headers.authorization || '');
    if (auth !== `Bearer ${cfg.WATCHDOG_HEARTBEAT_TOKEN}`) return res.status(401).json({ error: 'unauthorized' });

    const { service, ts, kind, maintenance, maintenance_reason } = req.body || {};
    if (!service || !ts) return res.status(400).json({ error: 'missing_fields' });

    const now = Math.floor(Date.now()/1000);
    const rec = state.services[service] || { status: 'unknown' };
    rec.last_ts = Number(ts);
    rec.last_kind = kind || 'heartbeat';
    rec.maintenance = Boolean(maintenance);
    rec.maintenance_reason = maintenance_reason || null;
    rec.last_seen_at = now;

    state.services[service] = rec;
    saveState(state);
    res.json({ ok: true });
  });

  app.post('/event', async (req, res) => {
  const auth = String(req.headers.authorization || '');
  if (auth !== `Bearer ${cfg.WATCHDOG_HEARTBEAT_TOKEN}`) return res.status(401).json({ error: 'unauthorized' });

  const { service, event, code, signal, message } = req.body || {};
  if (!service || !event) return res.status(400).json({ error: 'missing_fields' });

  const now = Math.floor(Date.now()/1000);
  const rec = state.services[service] || { status: 'unknown' };

  rec.last_event = String(event);
  rec.last_event_ts = now;
  if (message) rec.last_event_msg = String(message).slice(0, 500);

  if (event === 'exit' || event === 'crash') {
    rec.status = 'offline';
    rec.offline_since = rec.offline_since || now;
    await sendAlert('crash', service, rec, { code, signal }).catch(console.error);
  } else if (event === 'online') {
    rec.status = 'online';
    rec.offline_since = null;
    await sendAlert('online', service, rec, null).catch(console.error);
  }

  state.services[service] = rec;
  saveState(state);
  return res.json({ ok: true });
});

let watchdogHost;
try {
  watchdogHost = resolveWatchdogListenHost(process.env);
} catch (error) {
  console.error(`[watchdog] ${error.message}`);
  process.exit(1);
}

if (String(process.env.WATCHDOG_HOST || '').trim().toLowerCase() === 'tailscale') {
  console.log(`[watchdog] WATCHDOG_HOST=tailscale resolved to ${watchdogHost}`);
}

app.listen(cfg.WATCHDOG_PORT, watchdogHost, () => {
    const shownHost = watchdogHost || '0.0.0.0';
    console.log(`🌐 Watchdog web on http://${shownHost}:${cfg.WATCHDOG_PORT}`);
  });

  setInterval(async () => {
    const now = Math.floor(Date.now()/1000);
    for (const [service, rec] of Object.entries(state.services)) {
      const age = now - Number(rec.last_ts || 0);
      const isOffline = age > cfg.HEARTBEAT_TIMEOUT_SEC;

      if (isOffline && rec.status !== 'offline') {
        rec.status = 'offline';
        rec.offline_since = now;
        await sendAlert('offline', service, rec, age).catch(console.error);
        saveState(state);
      }

      if (!isOffline && rec.status === 'offline') {
        rec.status = 'online';
        const downFor = now - Number(rec.offline_since || now);
        await sendAlert('online', service, rec, downFor).catch(console.error);
        saveState(state);
      }

      if (!isOffline && rec.status === 'unknown') {
        rec.status = 'online';
        saveState(state);
      }
    }
  }, 15_000);

  if (cfg.WATCHDOG_AUDIT_ENABLED && cfg.WATCHDOG_AUDIT_INTERVAL_SEC > 0) {
    setInterval(() => {
      runDuplicateWalletAudit('interval').catch(console.error);
    }, cfg.WATCHDOG_AUDIT_INTERVAL_SEC * 1000);
  }
}

main().catch((e) => {
  console.error('Watchdog fatal:', e);
  process.exit(1);
});
