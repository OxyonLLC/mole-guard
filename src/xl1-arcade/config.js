import { getPayoutConfig } from './payout-config.js';
import { parseHoldTiers } from './hold.js';
const UNITS_PER_XL1 = 1_000_000n;
const MAX_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function decimalToUnits(value, name) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) throw new Error(`${name}_invalid`);
  const [whole, fraction = ''] = raw.split('.');
  const units = BigInt(whole) * UNITS_PER_XL1 + BigInt((fraction + '000000').slice(0, 6));
  if (units > MAX_UNITS) throw new Error(`${name}_out_of_range`);
  return units;
}

export function unitsToDecimal(units) {
  const value = BigInt(units || 0);
  const whole = value / UNITS_PER_XL1;
  const fraction = String(value % UNITS_PER_XL1).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function getArcadeConfig(env = process.env) {
  // One point is one second of play (reward-engine.js): 0.0004 XL1 a second is 0.024 a minute,
  // about 0.10 XL1 for a typical 4-minute round. At most XL1_ROUND_CAP_SECONDS count per round.
  const rewardPerPoint = decimalToUnits(env.XL1_REWARD_PER_POINT || '0.0004', 'XL1_REWARD_PER_POINT');
  const roundCapSeconds = Number(env.XL1_ROUND_CAP_SECONDS || 300);
  // How old a Discord account must be to earn (days; 0 turns the check off). Play is open to all.
  // A blank line in .env means the default, never "off": only an explicit 0 turns it off.
  // Layer 2: flagged live cash-outs wait for a moderator (XL1_REVIEW=off disables it), and any
  // cash-out of at least XL1_REVIEW_CASHOUT_XL1 (default 200) is reviewed. The moderators' tool
  // (GeoHackers) authenticates with the XL1_ARCADE_REVIEW_TOKEN secret.
  const review = String(env.XL1_REVIEW ?? '').trim().toLowerCase() !== 'off';
  const reviewCashoutUnits = decimalToUnits(String(env.XL1_REVIEW_CASHOUT_XL1 ?? '').trim() || '200', 'XL1_REVIEW_CASHOUT_XL1');
  // A short token is as good as none: the review routes stay closed unless it is at least 32 characters.
  const reviewTokenRaw = String(env.XL1_ARCADE_REVIEW_TOKEN ?? '').trim();
  const reviewToken = reviewTokenRaw.length >= 32 ? reviewTokenRaw : '';
  const ageSetting = String(env.XL1_MIN_DISCORD_AGE_DAYS ?? '').trim();
  const minDiscordAgeDays = ageSetting === '' ? 30 : Number(ageSetting);
  if (!Number.isInteger(minDiscordAgeDays) || minDiscordAgeDays < 0 || minDiscordAgeDays > 3650) throw new Error('XL1_MIN_DISCORD_AGE_DAYS_invalid');
  if (!Number.isInteger(roundCapSeconds) || roundCapSeconds < 30 || roundCapSeconds > 3600) throw new Error('XL1_ROUND_CAP_SECONDS_invalid');
  const dailyCap = decimalToUnits(env.XL1_DAILY_REWARD_CAP || '10', 'XL1_DAILY_REWARD_CAP');
  const mode = String(env.XL1_REWARD_MODE || 'dry-run').trim().toLowerCase();
  if (!['dry-run', 'live'].includes(mode)) throw new Error('XL1_REWARD_MODE_invalid');
  const signerAdapter = String(env.XL1_REWARD_SIGNER_ADAPTER || '').trim();
  if (mode === 'live' && !signerAdapter) throw new Error('live_mode_requires_XL1_REWARD_SIGNER_ADAPTER');
  if (mode === 'live' && signerAdapter !== 'xl1-sdk') throw new Error('live_mode_requires_supported_signer_adapter');
  const payout = mode === 'live' ? getPayoutConfig(env) : null;
  if (mode === 'live' && !env.XL1_VERIFICATION_FILE) throw new Error('XL1_VERIFICATION_FILE_required');
  const distributor = String(env.XL1_DISTRIBUTOR_ADDRESS || 'e5f3f3349cc84d730e7f3332939f98da24639002').trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(distributor)) throw new Error('XL1_DISTRIBUTOR_ADDRESS_invalid');
  const lowBalanceWarning = String(env.DISTRIBUTOR_LOW_BALANCE_WARNING || '').trim();
  const payoutPausedThreshold = String(env.DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD || '').trim();
  if (lowBalanceWarning) decimalToUnits(lowBalanceWarning, 'DISTRIBUTOR_LOW_BALANCE_WARNING');
  if (payoutPausedThreshold) decimalToUnits(payoutPausedThreshold, 'DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD');
  return Object.freeze({ enabled: bool(env.XL1_GAME_REWARDS_ENABLED, true), mode,
    rewardPerPoint, roundCapSeconds, minDiscordAgeDays, review, reviewCashoutUnits, reviewToken, dailyCap, distributor, holdTiers: parseHoldTiers(env.XL1_HOLD_TIERS), network: payout?.network || null, chainId: payout?.chainId || null, rewardDayTimezone: 'UTC', signerAdapter,
    lowBalanceWarning, payoutPausedThreshold });
}

export { UNITS_PER_XL1 };
