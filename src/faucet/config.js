// Single source of truth for faucet configuration. Both the Discord bot
// (src/faucet/bot.js) and the website (src/mole/web.js's /api/faucet/*
// routes, via src/faucet/service.js) read faucet policy through this module
// so the two platforms can never silently disagree on the drip amount,
// cooldown length, or holder-check threshold — which matters because they
// share one atomic reservation (src/faucet/claimStore.js).
//
// Same env var names and same defaults as the original src/faucet/bot.js /
// faucet.js, deliberately not renamed, so existing .env files keep working.

import { assertSafeDecimalAmount } from './amount.js';

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

/**
 * Reads current faucet config from process.env. Computed fresh on every
 * call (not cached at module load) so tests can mutate env vars and Discord
 * `.env` reloads take effect without a process restart mattering here.
 */
export function getFaucetConfig() {
  // PAIRED WITH QUIZ_MIN_REDEMPTION_WINLEW (src/quiz/db.js, defaults 1500).
  // /quiz/ publicly states its redemption minimum is "matched to one faucet
  // drip"; production sets both to 1500 via env, but these code defaults
  // disagree, so leaving DRIP_AMOUNT unset would quietly falsify that page.
  // Change them together. (Audited 2026-08-05.)
  const dripAmountRaw = String(process.env.DRIP_AMOUNT ?? '1000').trim() || '1000';
  assertSafeDecimalAmount(dripAmountRaw); // throws on a catastrophic misconfiguration

  const cooldownHours = Number(process.env.FAUCET_COOLDOWN_HOURS || 24);
  if (!Number.isFinite(cooldownHours) || cooldownHours <= 0) {
    throw new Error(`invalid_FAUCET_COOLDOWN_HOURS:${process.env.FAUCET_COOLDOWN_HOURS}`);
  }

  const minHolderBalance = Number(process.env.FAUCET_MIN_HOLDER_BALANCE || 1);
  if (!Number.isFinite(minHolderBalance) || minHolderBalance < 0) {
    throw new Error(`invalid_FAUCET_MIN_HOLDER_BALANCE:${process.env.FAUCET_MIN_HOLDER_BALANCE}`);
  }

  const winlewMint = String(process.env.WINLEW_MINT || '').trim();
  if (!winlewMint) throw new Error('missing_WINLEW_MINT');

  return {
    dripAmountDecimal: dripAmountRaw,
    tokenSymbol: String(process.env.TOKEN_SYMBOL || 'WinLEW').trim(),
    cooldownHours,
    cooldownMs: Math.round(cooldownHours * 60 * 60 * 1000),
    minHolderBalance,
    holderCheckEnabled: !parseBoolean(process.env.DISABLE_FAUCET_HOLDER_CHECK, false),
    winlewMint,
    rpcUrl: String(process.env.RPC_URL || 'https://solana-rpc.publicnode.com').trim(),
    botKeypairPath: String(process.env.BOT_KEYPAIR_PATH || '').trim(),
    // Faucet-wide kill switch, off by default (unset = enabled). Distinct from
    // the holder-check toggle — this disables claiming entirely.
    enabled: !parseBoolean(process.env.FAUCET_DISABLED, false),
    // Optional. Lets eligibility checks reject "claim to the treasury's own
    // address" WITHOUT the web process ever reading the keypair file (only
    // src/faucet/keypair.js does that, and only bot.js/payout-worker.js call
    // it). Recommended but not required — if unset, that specific check is
    // skipped; every other eligibility/cooldown rule still applies.
    treasuryPubkey: String(process.env.FAUCET_TREASURY_PUBKEY || '').trim() || null,
    // On-chain linkage ban check (src/faucet/walletBans.js). On by default:
    // with an empty ban list it costs one cached lookup and refuses nobody,
    // and leaving an anti-abuse control off by default means it is off on the
    // day it is needed. Set FAUCET_LINKAGE_DISABLED=true to turn it off.
    linkageCheckEnabled: !parseBoolean(process.env.FAUCET_LINKAGE_DISABLED, false),
    // Funding hops to follow out from a claiming wallet. 2 catches
    // "banned -> fresh -> fresh"; higher widens false matches faster than it
    // catches anyone, since sharing a funder is not proof of sharing a person.
    linkageMaxDepth: Math.max(0, Math.min(4, Number(process.env.FAUCET_LINKAGE_MAX_DEPTH ?? 2) || 0)),
    // After this many lifetime confirmed claims, a wallet must be verified to
    // keep claiming. Deliberately NOT grandfathered: an account already past
    // the threshold is asked to verify on its next claim, which is the whole
    // point — the accounts worth verifying are the ones that have claimed most.
    // 0 disables the gate.
    verifyAfterClaims: Math.max(0, Number(process.env.FAUCET_VERIFY_AFTER_CLAIMS ?? 10) || 0),
  };
}
