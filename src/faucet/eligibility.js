// Shared faucet eligibility service — both the Discord adapter and the web
// adapter call this through src/faucet/service.js so eligibility rules can
// never drift between the two interfaces.

import { PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
import { getSplBalance } from '../mole/solana.js';
import { getFaucetConfig } from './config.js';
import { getStatusForUser, getStatusForWallet, countClaimsForGate } from './claimStore.js';
import { findBannedLink } from './walletBans.js';
import { checkUserBan } from './userBans.js';
import { findLinkedProfileByWallet, getWalletVerificationStatus, listVerifiedWallets } from '../mole/walletLink.js';
import { listAccountIdsForUser } from '../mole/userAccounts.js';
import { refreshManagedFile } from '../mole/storage.js';

const require = createRequire(import.meta.url);
// src/quiz/wallets.js is CommonJS and already resolves the same wallet-link
// files (wallet_links.json, linked_wallets.json, legacy registrations/
// airdrops) with the same intent-priority fallback the old faucet used —
// reused as-is rather than re-implementing wallet resolution a third time.
const { getLinkedWallet } = require('../quiz/wallets.js');

export const ELIGIBILITY_REASONS = Object.freeze({
  NOT_ENABLED: 'not_enabled',
  NO_WALLET: 'no_wallet',
  // Distinct from NO_WALLET on purpose. NO_WALLET means "this Discord account
  // has no wallet"; this means "we could not work out which Discord account
  // you are". A wallet- or X-rooted session hits the second, and telling that
  // person to go run !register is a lie — they may well be linked under a
  // Discord id we simply never resolved. Sibling of
  // PAYOUT_BLOCK_REASONS.NEEDS_IDENTITY_SYNC (src/services/payoutGate.js:126),
  // but narrower: an X-only account can be PAID and still land here, because
  // the faucet linkage store is keyed by Discord snowflake specifically.
  NEEDS_DISCORD_LINK: 'needs_discord_link',
  INVALID_WALLET: 'invalid_wallet',
  TREASURY_WALLET: 'treasury_wallet',
  BELOW_HOLDER_MINIMUM: 'below_holder_minimum',
  HOLDER_CHECK_UNAVAILABLE: 'holder_check_unavailable',
  COOLDOWN: 'cooldown',
  TREASURY_UNAVAILABLE: 'treasury_unavailable',
  WALLET_BANNED: 'wallet_banned',
  LINKED_TO_BANNED: 'linked_to_banned',
  VERIFICATION_REQUIRED: 'verification_required',
});

/**
 * Validate and normalize a candidate wallet address. Never lowercases —
 * base58 Solana addresses are case-sensitive. Returns the base58 string or
 * throws.
 */
export function normalizeWalletAddress(candidate) {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) throw new Error('wallet_empty');
  let pk;
  try {
    pk = new PublicKey(trimmed);
  } catch {
    throw new Error('wallet_not_base58');
  }
  return pk.toBase58();
}

/**
 * Resolve the canonical faucet payout wallet for a Discord user. Does NOT
 * accept a wallet from the caller — always the saved `faucet`-intent
 * wallet (falling back through the same priority chain the old standalone
 * faucet used). Returns `{address, source, updatedAt} | null`.
 */
export function resolveCanonicalFaucetWallet(discordUserId) {
  const linked = getLinkedWallet(discordUserId, 'faucet');
  if (!linked?.address) return null;
  try {
    return { address: normalizeWalletAddress(linked.address), source: linked.source, updatedAt: linked.updatedAt };
  } catch {
    return null; // saved record is malformed/unresolved — treated as "no wallet"
  }
}

/** Verification state for a wallet, from the shared wallet-link store. Never
 *  throws — an unreadable store reports "unknown", which the gate treats as
 *  unverified (it fails closed). */
function readVerificationStatus(walletAddress) {
  try {
    const linked = findLinkedProfileByWallet(walletAddress);
    return getWalletVerificationStatus(linked?.record || null);
  } catch {
    return { status: 'unknown', verified: false, wallet: null };
  }
}

/**
 * Full eligibility check for one identity. Self-send rejection uses
 * `FAUCET_TREASURY_PUBKEY` (optional, see config.js) so this module never
 * needs to load the treasury keypair itself — key material stays out of it
 * entirely.
 */
/**
 * Which OTHER cooldown keys belong to the same person as this wallet.
 *
 * Pure so both halves of the rule are directly testable: the sibling wallets to
 * check, and whether the owning Discord account differs from whoever is making
 * the request (a wallet-only web session has no real Discord id, which is
 * exactly the gap this closes).
 */
export function identityCooldownTargets({ wallet, owner, discordUserId, accountIdsFor = listAccountIdsForUser }) {
  const siblingWallets = listVerifiedWallets(owner?.record)
    .map((entry) => entry.wallet)
    .filter((address) => address && address !== wallet);
  const ownerId = owner?.discordUserId ? String(owner.discordUserId) : null;
  const requesterId = String(discordUserId ?? '');
  const ownerUserId = ownerId && ownerId !== requesterId ? ownerId : null;

  // EVERY DOOR THE SAME PERSON HAS, not just the one this claim came through
  // (2026-08-22). Claims are keyed by account id, and until the USER layer
  // existed a person with a Discord login AND an X login WAS two accounts — so
  // the claim recorded yesterday under one of them was invisible to today's
  // check on the other, and the faucet paid the same person twice inside one
  // cooldown. That is the bug this list closes: the cooldown is now asked of
  // every account id behind the user, including ids that were absorbed by a
  // merge and still hold the old claims.
  const seen = new Set([requesterId, ownerUserId].filter(Boolean));
  const siblingUserIds = [];
  for (const seed of [ownerId, requesterId].filter(Boolean)) {
    for (const id of accountIdsFor(seed)) {
      const value = String(id || '');
      if (!value || seen.has(value)) continue;
      seen.add(value);
      siblingUserIds.push(value);
    }
  }

  return { siblingWallets, ownerUserId, siblingUserIds };
}

/**
 * The first cooldown that blocks, and whether it came from a DIFFERENT wallet.
 *
 * `fromSibling` exists for the message, not the decision: telling someone "you
 * already claimed" when this wallet never has reads as a bug. It stays false
 * whenever this wallet or this account is itself on cooldown, so the plain
 * wording is used wherever it is accurate.
 */
export function pickBlockingStatus({ userStatus, walletStatus, ownerStatus, siblingStatuses = [], siblingUserStatuses = [] }) {
  const ordered = [userStatus, walletStatus, ownerStatus, ...siblingUserStatuses, ...siblingStatuses];
  const status = ordered.find((entry) => entry?.blocked) || null;
  if (!status) return { status: null, fromSibling: false };
  return { status, fromSibling: !userStatus?.blocked && !walletStatus?.blocked };
}

export async function checkEligibility({ discordUserId, wallet }) {
  const cfg = getFaucetConfig();

  if (!cfg.enabled) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.NOT_ENABLED, wallet: null, balance: null, config: cfg, cooldown: null };
  }

  let resolved = wallet ? { address: wallet, source: 'provided', updatedAt: null } : resolveCanonicalFaucetWallet(discordUserId);

  // Re-read the linkage store before refusing, for the same reason the
  // verification gate below does it (added by beb400f): getLinkedWallet() reads
  // local JSON through a boot-time cache, so a wallet linked by ANOTHER process
  // — the faucet bot's !register, or a /verify on a different worker — is
  // invisible here until something refreshes it. beb400f applied this to the
  // verification gate only, and this line returns long before that runs.
  //
  // Only on the way to a refusal, so a linked user pays nothing for it.
  if (!resolved?.address && !wallet) {
    try {
      await refreshManagedFile('linked_wallets.json');
      resolved = resolveCanonicalFaucetWallet(discordUserId);
    } catch (err) {
      console.warn('[faucet] linkage refresh failed:', err?.message || err);
    }
  }

  if (!resolved?.address) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.NO_WALLET, wallet: null, balance: null, config: cfg, cooldown: null };
  }

  let normalizedAddress;
  try {
    normalizedAddress = normalizeWalletAddress(resolved.address);
  } catch {
    return { eligible: false, reason: ELIGIBILITY_REASONS.INVALID_WALLET, wallet: resolved, balance: null, config: cfg, cooldown: null };
  }

  if (cfg.treasuryPubkey && normalizedAddress === cfg.treasuryPubkey) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.TREASURY_WALLET, wallet: { ...resolved, address: normalizedAddress }, balance: null, config: cfg, cooldown: null };
  }

  if (!cfg.botKeypairPath) {
    return { eligible: false, reason: ELIGIBILITY_REASONS.TREASURY_UNAVAILABLE, wallet: { ...resolved, address: normalizedAddress }, balance: null, config: cfg, cooldown: null };
  }

  let balance = null;
  if (cfg.holderCheckEnabled) {
    try {
      balance = await getSplBalance(normalizedAddress, cfg.winlewMint);
    } catch (err) {
      // Fail closed: an RPC error is NOT the same as a zero balance.
      return {
        eligible: false,
        reason: ELIGIBILITY_REASONS.HOLDER_CHECK_UNAVAILABLE,
        wallet: { ...resolved, address: normalizedAddress },
        balance: null,
        config: cfg,
        cooldown: null,
        error: err?.message || 'rpc_error',
      };
    }
    if (balance < cfg.minHolderBalance) {
      return { eligible: false, reason: ELIGIBILITY_REASONS.BELOW_HOLDER_MINIMUM, wallet: { ...resolved, address: normalizedAddress }, balance, config: cfg, cooldown: null };
    }
  }

  // Account ban. Checked BEFORE the wallet ban and before any RPC: it is a
  // local exact-match lookup, so refusing here costs nothing, and a banned
  // account making a fresh wallet every day is exactly the case a wallet ban
  // cannot reach.
  //
  // Reported as WALLET_BANNED, not a distinct reason. The wording a claimer
  // sees must not tell them WHICH of their identities burned — otherwise a
  // prober learns whether to make a new wallet or a new account. Same
  // reasoning as the quiz path's identical refusal for a direct and a linked
  // ban. `userBan` is carried in the payload for admin surfaces only.
  const accountBan = await checkUserBan(discordUserId);
  if (accountBan.banned) {
    return {
      eligible: false,
      reason: ELIGIBILITY_REASONS.WALLET_BANNED,
      wallet: { ...resolved, address: normalizedAddress },
      balance,
      config: cfg,
      cooldown: null,
      userBan: accountBan.ban,
    };
  }

  // Ban check, after the holder gate (no point spending RPC on a wallet that
  // wasn't going to be paid anyway) and before the cooldown reservation.
  //
  // A direct ban is decided from local state and always holds. The cluster
  // walk needs the chain, so it fails OPEN — `degraded` says the chain was
  // unreachable and only local knowledge was consulted. That is deliberate:
  // an RPC outage refusing every honest claimer is worse than briefly missing
  // a linked wallet, and the faucet had exactly such an outage the day this
  // was written. See src/faucet/walletBans.js.
  if (cfg.linkageCheckEnabled) {
    const link = await findBannedLink(normalizedAddress, { maxDepth: cfg.linkageMaxDepth });
    if (link.banned) {
      const direct = link.path.length <= 1;
      return {
        eligible: false,
        reason: direct ? ELIGIBILITY_REASONS.WALLET_BANNED : ELIGIBILITY_REASONS.LINKED_TO_BANNED,
        wallet: { ...resolved, address: normalizedAddress },
        balance,
        config: cfg,
        cooldown: null,
        linkage: { ban: link.ban, path: link.path, degraded: link.degraded },
      };
    }
  }

  // Verification gate. Past `verifyAfterClaims` lifetime confirmed claims, the
  // wallet has to be a verified one before it can keep claiming.
  //
  // The count is the higher of per-wallet and per-Discord-account, because the
  // two evasions are different and cheap in different ways: a new keypair
  // costs nothing and resets a per-wallet count, while legacy migrated claims
  // have no Discord id at all and would vanish from a per-account count.
  //
  // Fails CLOSED, unlike the linkage check. If the link store can't be read we
  // cannot tell a verified wallet from an unverified one, and the wallet in
  // question has already had ten payouts — making it wait is the right way to
  // be wrong. A first-time claimer is never affected either way.
  if (cfg.verifyAfterClaims > 0) {
    const counts = await countClaimsForGate({ wallet: normalizedAddress, discordUserId });
    if (counts.highest >= cfg.verifyAfterClaims) {
      let verification = readVerificationStatus(normalizedAddress);

      // linked_wallets.json is written by the Mole Guard process (`/mole link`)
      // and cached HERE at boot, so a verification completed since this bot
      // started is invisible until it restarts. That shipped as a real bug on
      // 2026-08-02: verified users were still refused, with the correct record
      // sitting in Mongo the whole time.
      //
      // Only re-read when we are otherwise about to refuse. An already-verified
      // wallet is answered from cache and pays nothing; the cost lands on the
      // claim that was going to be rejected anyway.
      if (!verification?.verified) {
        try {
          await refreshManagedFile('linked_wallets.json');
          verification = readVerificationStatus(normalizedAddress);
        } catch (err) {
          console.warn('[faucet] verification refresh failed:', err?.message || err);
        }
      }

      if (!verification?.verified) {
        return {
          eligible: false,
          reason: ELIGIBILITY_REASONS.VERIFICATION_REQUIRED,
          wallet: { ...resolved, address: normalizedAddress },
          balance,
          config: cfg,
          cooldown: null,
          claimCounts: counts,
          verification,
        };
      }
    }
  }

  // ONE CLAIM PER PERSON, NOT PER WALLET (2026-08-20, the owner's rule).
  //
  // The cooldown was already keyed two ways — by Discord account and by wallet
  // — and either one blocking was enough. That covered someone claiming twice
  // under the same Discord account, but not the shape it was actually meant to
  // stop: claim with wallet A, then verify wallet B and claim again. The
  // per-wallet key sees a wallet that has never claimed, and the per-user key
  // only helps when a Discord account is attached to the second claim.
  //
  // So the identity is resolved FROM THE WALLET as well. Every other wallet the
  // same person has verified is checked, and the owning account's own cooldown
  // applies even when the claim arrives with no Discord session at all.
  //
  // findLinkedProfileByWallet() matches wallet_history too, which is right
  // here: an address someone verified a year ago still identifies the person,
  // even though listVerifiedWallets() correctly refuses to call it verified.
  const owner = findLinkedProfileByWallet(normalizedAddress);
  const { siblingWallets, ownerUserId, siblingUserIds } = identityCooldownTargets({
    wallet: normalizedAddress,
    owner,
    discordUserId,
  });

  const results = await Promise.all([
    getStatusForUser(discordUserId),
    getStatusForWallet(normalizedAddress),
    ownerUserId ? getStatusForUser(ownerUserId) : Promise.resolve({ blocked: false }),
    ...siblingUserIds.map((id) => getStatusForUser(id)),
    ...siblingWallets.map((address) => getStatusForWallet(address)),
  ]);
  const [userStatus, walletStatus, ownerStatus] = results;
  const siblingUserStatuses = results.slice(3, 3 + siblingUserIds.length);
  const siblingStatuses = results.slice(3 + siblingUserIds.length);

  const { status: blockedStatus, fromSibling } = pickBlockingStatus({
    userStatus,
    walletStatus,
    ownerStatus,
    siblingStatuses,
    siblingUserStatuses,
  });
  if (blockedStatus) {
    return {
      eligible: false,
      reason: ELIGIBILITY_REASONS.COOLDOWN,
      wallet: { ...resolved, address: normalizedAddress },
      balance,
      config: cfg,
      cooldown: {
        blocked: true,
        nextEligibleAt: blockedStatus.nextEligibleAt,
        lastClaimSource: blockedStatus.lastClaim?.source || null,
        otherWallet: fromSibling,
      },
    };
  }

  return {
    eligible: true,
    reason: null,
    wallet: { ...resolved, address: normalizedAddress },
    balance,
    config: cfg,
    cooldown: { blocked: false, nextEligibleAt: null, lastClaimSource: null },
  };
}
