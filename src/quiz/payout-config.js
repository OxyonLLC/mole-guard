const path = require('path');

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolvePayoutConfig() {
  const autoCyclePayouts = parseBool(process.env.QUIZ_AUTO_PAYOUT_CYCLES, true);
  const autoRedeems = parseBool(process.env.QUIZ_AUTO_PAYOUT_REDEEMS, false);
  const enabled = parseBool(process.env.QUIZ_PAYOUTS_ENABLED, autoCyclePayouts || autoRedeems);
  const dryRun = parseBool(process.env.QUIZ_PAYOUTS_DRY_RUN, false);
  const scanMs = parseNumber(process.env.QUIZ_PAYOUT_SCAN_MS, 45_000);
  const maxBatch = parseNumber(process.env.QUIZ_PAYOUT_MAX_BATCH, 10);
  const maxAttempts = parseNumber(process.env.QUIZ_PAYOUT_MAX_ATTEMPTS, 7);
  const baseRetryMs = parseNumber(process.env.QUIZ_PAYOUT_RETRY_MS, 5 * 60_000);
  const missingWalletRetryMs = parseNumber(process.env.QUIZ_PAYOUT_MISSING_WALLET_RETRY_MS, 30 * 60_000);
  const rpcUrl = process.env.QUIZ_PAYOUT_RPC_URL || process.env.SOLANA_RPC || process.env.RPC_URL || '';
  const mint = process.env.WINLEW_MINT || '';
  const keypairPath = process.env.QUIZ_PAYOUT_KEYPAIR_PATH || path.resolve(__dirname, '..', 'faucet', 'bot-keypair.json');
  const announceChannelId = process.env.QUIZ_PAYOUT_ANNOUNCE_CHANNEL_ID
    || (process.env.QUIZ_CHANNELS || '').split(',').map((v) => v.trim()).filter(Boolean)[0]
    || '';
  const botToken = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '';

  return {
    enabled,
    dryRun,
    autoCyclePayouts,
    autoRedeems,
    scanMs,
    maxBatch,
    maxAttempts,
    baseRetryMs,
    missingWalletRetryMs,
    rpcUrl,
    mint,
    keypairPath,
    announceChannelId,
    botToken,
  };
}

function payoutModeLabel(cfg = resolvePayoutConfig()) {
  if (!cfg.enabled) return 'disabled';
  if (cfg.dryRun) return 'dry-run';
  const modes = [];
  if (cfg.autoCyclePayouts) modes.push('cycle auto-settle');
  if (cfg.autoRedeems) modes.push('redeem auto-settle');
  return modes.length ? modes.join(' + ') : 'manual queue';
}

module.exports = {
  parseBool,
  parseNumber,
  resolvePayoutConfig,
  payoutModeLabel,
};
