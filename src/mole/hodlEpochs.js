// HODL Rewards — epochs, eligibility and the weekly split.
//
// Pure. No I/O, no RPC, no database, no clock beyond what is passed in — the
// same shape as participationTrust.js, and for the same reason: everything that
// decides who gets paid, and how much, belongs somewhere it can be tested
// exhaustively before a single token moves.
//
// WHAT THIS IS NOT. Not staking. Nobody deposits anything, nothing is locked,
// there is no yield, no APY, no interest and no return on an investment. A fixed
// community allocation is split among people who qualified that week. Say it
// that way everywhere, including in code.
//
// THE CONSTRAINT THAT SHAPES THE NUMBERS. The owner's brief: "a SLOW GRIND —
// makes drips look like cash drops." A daily faucet claimer earns 10,500/week.
// At the approved 10,000/week pool and today's 9 verified participants, HODL
// pays ~1,111/week — about a tenth of that. If it ever out-earns the faucet,
// the design has failed, whatever the arithmetic says.
//
// AND THE ONE THAT SHAPES THE RULES. Proof of Value, not Proof of Wealth. A
// bigger balance must never mean a bigger share. Balance is a threshold to
// cross, never a multiplier — see qualifies() below, where the balance is
// compared and then deliberately discarded.
//
// EXCEPTION, by owner policy (2026-11-13): an epoch with `balanceRates` pays each
// qualifier a weekly percentage of their own balance, chosen by how many distinct
// days they participated that week (index 0-7; base 0.10% up to 0.15%). Balance
// counts only up to MAX_QUALIFYING_BALANCE per identity; each payout is still
// capped per person and by the weekly pool. No rate may exceed
// MAX_COMBINED_RATE_PER_WEEK, whatever a vote says. Epochs without `balanceRates`
// keep the equal-share rule above.

import { balanceRateAllocation, rateToNanos } from "./hodlMath.js";

export const RULES_VERSION = "hodl-epochs/1.0.0";

/**
 * Hard bounds. Governance may choose values for the next epoch (spec §8) but it
 * can only choose WITHIN these, and they are not themselves votable.
 *
 * The point is blunt: a governance vote must never be able to authorise an
 * unbounded payout, whether by mistake, by a decimal in the wrong place, or by
 * someone getting exactly what they asked for. Every epoch is validated against
 * these before it can be activated.
 */
export const LIMITS = Object.freeze({
  // 25,000/wk is already 2.5x the approved pool and ~2.5% of the funding
  // reserve per 13-week epoch. Beyond that this stops being a slow grind.
  MAX_WEEKLY_POOL: 25_000,
  MIN_WEEKLY_POOL: 0,
  // No single participant may take more than this in one week, regardless of
  // how few qualify. Without it, one qualifying wallet in a quiet week takes
  // the entire pool.
  MAX_PER_PARTICIPANT_WEEK: 2_500,
  // A bonus redistributes within the pool. It never enlarges it.
  MAX_POV_BONUS_MULTIPLIER: 1.15,
  MAX_EPOCH_WEEKS: 15,
  MIN_EPOCH_WEEKS: 1,
  // Owner policy 2026-11-13. Fractions, not percents: 0.0015 = 0.15%/week,
  // the hard ceiling for base + participation together; no vote can exceed it.
  MAX_COMBINED_RATE_PER_WEEK: 0.0015,
  // Balance above this (per verified identity, linked wallets aggregated) earns
  // nothing extra.
  MAX_QUALIFYING_BALANCE: 5_000_000,
});

/** Owner policy 2026-11-13, PROPOSED progression: index = distinct participation
 *  days in the week (0-7). Cumulative weekly rate, not a daily payout. */
export const DEFAULT_BALANCE_RATES = Object.freeze([0.001, 0.00105, 0.0011, 0.00115, 0.0012, 0.0013, 0.0014, 0.0015]);

/** The approved starting parameters. Epoch 2 onward comes from governance. */
export const DEFAULT_EPOCH_PARAMS = Object.freeze({
  weeklyPool: 10_000,
  // Deliberately low. This program rewards consistency; the holding requirement
  // exists to mean "a holder", not to sort people by wealth.
  minHold: 1_000,
  payoutDay: 2, // Tuesday (JS getDay: 0=Sun). A parameter, never a constant.
  povBonusTiers: Object.freeze([
    { minScore: 0, multiplier: 1.0 },
    { minScore: 40, multiplier: 1.05 },
    { minScore: 70, multiplier: 1.1 },
    { minScore: 90, multiplier: 1.15 },
  ]),
});

export const EPOCH_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  CLOSED: "closed",
});

export const INELIGIBLE = Object.freeze({
  WALLET_ONLY_PROFILE: "wallet_only_profile",
  NOT_VERIFIED: "not_verified",
  VERIFICATION_EXPIRED: "verification_expired",
  NO_PAYOUT_WALLET: "no_payout_wallet",
  BELOW_MIN_HOLD: "below_min_hold",
  BALANCE_UNKNOWN: "balance_unknown",
  BANNED: "banned",
});

/**
 * Is this epoch definition safe to activate?
 *
 * Returns every problem rather than the first, so an admin fixing a proposed
 * epoch sees the whole list instead of playing whack-a-mole.
 */
export function validateEpoch(epoch = {}) {
  const errors = [];
  const pool = Number(epoch.weeklyPool);
  if (!Number.isFinite(pool) || pool < LIMITS.MIN_WEEKLY_POOL) {
    errors.push("weeklyPool must be a number >= 0");
  } else if (pool > LIMITS.MAX_WEEKLY_POOL) {
    errors.push(`weeklyPool ${pool} exceeds MAX_WEEKLY_POOL ${LIMITS.MAX_WEEKLY_POOL}`);
  }

  const start = Number(epoch.startMs);
  const end = Number(epoch.endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.push("startMs/endMs must be finite with end after start");
  } else {
    const weeks = (end - start) / (7 * 24 * 60 * 60 * 1000);
    if (weeks < LIMITS.MIN_EPOCH_WEEKS || weeks > LIMITS.MAX_EPOCH_WEEKS) {
      errors.push(`epoch spans ${weeks.toFixed(1)} weeks, outside ${LIMITS.MIN_EPOCH_WEEKS}-${LIMITS.MAX_EPOCH_WEEKS}`);
    }
  }

  if (!Number.isFinite(Number(epoch.minHold)) || Number(epoch.minHold) < 0) {
    errors.push("minHold must be a number >= 0");
  }

  const day = Number(epoch.payoutDay);
  if (!Number.isInteger(day) || day < 0 || day > 6) errors.push("payoutDay must be 0-6");

  if (epoch.balanceRates !== undefined && epoch.balanceRates !== null) {
    const rates = epoch.balanceRates;
    if (!Array.isArray(rates) || rates.length !== 8) {
      errors.push("balanceRates must list 8 weekly rates (0-7 participation days)");
    } else {
      rates.forEach((r, i) => {
        const v = Number(r);
        if (!Number.isFinite(v) || v <= 0) errors.push(`balanceRates[${i}] must be a number > 0`);
        else if (v > LIMITS.MAX_COMBINED_RATE_PER_WEEK) {
          errors.push(`balanceRates[${i}] ${v} exceeds MAX_COMBINED_RATE_PER_WEEK ${LIMITS.MAX_COMBINED_RATE_PER_WEEK}`);
        } else {
          // Rewards are computed exactly in nano-units (hodlMath.js); a rate that
          // needs more precision than that cannot be applied as written.
          try { rateToNanos(v); } catch { errors.push(`balanceRates[${i}] ${v} has more than 9 decimal places`); }
        }
        if (i > 0 && v < Number(rates[i - 1])) errors.push(`balanceRates must not decrease (day ${i})`);
      });
    }
  }

  for (const tier of epoch.povBonusTiers || []) {
    if (Number(tier.multiplier) > LIMITS.MAX_POV_BONUS_MULTIPLIER) {
      errors.push(`PoV tier multiplier ${tier.multiplier} exceeds ${LIMITS.MAX_POV_BONUS_MULTIPLIER}`);
    }
    if (Number(tier.multiplier) < 1) errors.push("a PoV tier may not reduce a payout below the base");
  }

  return { ok: errors.length === 0, errors };
}

/** Which payout week a moment falls in, 1-indexed. */
export function weekIndexFor(epoch, atMs) {
  const start = Number(epoch?.startMs || 0);
  if (!start || !Number.isFinite(Number(atMs)) || atMs < start) return null;
  return Math.floor((atMs - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

/** Is this the epoch's payout day? Local day-of-week, because "Tuesday" is a
 *  thing people experience where they live, not a UTC boundary. */
export function isPayoutDay(epoch, date) {
  const day = Number(epoch?.payoutDay ?? DEFAULT_EPOCH_PARAMS.payoutDay);
  return date instanceof Date && date.getDay() === day;
}

/**
 * The next SCHEDULED payout day, by exactly the rules hodl-pay enforces:
 * isPayoutDay() on the server's local calendar, at or after startMs (week 1 pays
 * on the start day), strictly before endMs. Today counts while it is still the
 * payout day, unless `isWeekPaid(weekIndex)` says that week is already paid.
 * A schedule, not a promise: a payout still needs an operator run with --apply.
 *
 * Returns `{ atMs, date, weekIndex }` (`date` = local YYYY-MM-DD) or null.
 */
export function nextPayoutDay(epoch, nowMs = Date.now(), { isWeekPaid = () => false } = {}) {
  const start = Number(epoch?.startMs);
  const end = Number(epoch?.endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  const from = new Date(Math.max(Number(nowMs), start));
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const atMs = Math.max(day.getTime(), start);
    const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    if (atMs >= end) return null;
    if (!isPayoutDay(epoch, day) || atMs >= nextDay) continue;
    const weekIndex = weekIndexFor(epoch, atMs);
    if (!weekIndex || isWeekPaid(weekIndex)) continue;
    const pad = (n) => String(n).padStart(2, "0");
    return { atMs, date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, weekIndex };
  }
  return null;
}

/**
 * Does one identity qualify for this epoch's week?
 *
 * Takes an IDENTITY, not a wallet. Spec §12 asked for a recommendation and this
 * is it: with an equal split, wallet-level qualification means one person with
 * three wallets takes three shares. That is not hypothetical — a seven-wallet
 * cluster run by one operator was banned here on 2026-08-14.
 *
 * @param {object} identity  `{discordUserId, payoutWallet, verified, verificationExpiresAtSec, balance, banned}`
 */
export function qualifies(identity = {}, epoch = {}, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const reasons = [];

  if (identity.banned) reasons.push(INELIGIBLE.BANNED);

  // A wallet-only profile (`wallet:<hash>` id) has NO Discord account behind
  // it — anyone can mint one by signing a message with any wallet they own.
  // Letting those qualify would hand back exactly the Sybil vector that
  // identity-level qualification exists to close: one person, unlimited
  // participants, unlimited shares of a fixed pool.
  //
  // Excluded EXPLICITLY. Today the local mirror happens not to contain them, so
  // they are already absent from the count — but "correct by accident" stops
  // being correct the moment that mirror syncs, and this decides who gets paid.
  if (isWalletOnlyIdentity(identity.discordUserId)) reasons.push(INELIGIBLE.WALLET_ONLY_PROFILE);

  // "Never verified" and "verification lapsed" are different situations with
  // different remedies — one person needs to verify, the other needs to
  // re-verify — so they are reported separately. getWalletVerificationStatus()
  // returns verified:false for BOTH, which is why the expiry is inspected
  // rather than trusted to the boolean: an expiry in the past is proof there
  // WAS a verification, and that is the honest thing to tell an admin reading
  // a snapshot months later.
  const expiresAt = Number(identity.verificationExpiresAtSec || 0);
  if (!identity.verified) {
    reasons.push(expiresAt > 0 ? INELIGIBLE.VERIFICATION_EXPIRED : INELIGIBLE.NOT_VERIFIED);
  } else if (expiresAt <= nowSec) {
    reasons.push(INELIGIBLE.VERIFICATION_EXPIRED);
  }
  if (!identity.payoutWallet) reasons.push(INELIGIBLE.NO_PAYOUT_WALLET);

  // null and undefined are checked BEFORE Number(), because Number(null) is 0 —
  // so a balance we failed to read would otherwise look like a real balance of
  // zero and be reported as "below the minimum" rather than "unknown". Both
  // disqualify, but only one of them is honest about why, and an admin reading
  // a snapshot needs to know the difference between a poor holder and a failed
  // RPC call.
  const balance = identity.balance === null || identity.balance === undefined
    ? NaN
    : Number(identity.balance);
  const minHold = Number(epoch.minHold ?? DEFAULT_EPOCH_PARAMS.minHold);
  if (!Number.isFinite(balance)) {
    // "We could not read it" must never mean "eligible" — the same rule the
    // faucet applies to an unreadable balance. Failing closed here costs one
    // week; failing open pays out on a number nobody has.
    reasons.push(INELIGIBLE.BALANCE_UNKNOWN);
  } else if (balance < minHold) {
    reasons.push(INELIGIBLE.BELOW_MIN_HOLD);
  }

  // NOTE: `balance` is compared and then deliberately dropped. It decides
  // whether you are in, never how much you get. Proof of Value, not Proof of
  // Wealth — if a future change makes the share depend on this number, that is
  // the moment the program becomes the thing it was built not to be.
  return { qualified: reasons.length === 0, reasons };
}

/** Synthetic ids minted by the wallet-only sign-in path, e.g.
 *  `wallet:9fb82d15…`. A real participant is a Discord snowflake. */
export function isWalletOnlyIdentity(discordUserId) {
  return /^(wallet|guest):/i.test(String(discordUserId || ""));
}

/** The PoV multiplier for a score, from the epoch's own tiers. Bounded twice:
 *  by the tier table, and by LIMITS in case a tier table slipped through. */
export function povMultiplierFor(score, epoch = {}) {
  const tiers = epoch.povBonusTiers || DEFAULT_EPOCH_PARAMS.povBonusTiers;
  const s = Number(score);
  let multiplier = 1;
  for (const tier of tiers) {
    if (Number.isFinite(s) && s >= Number(tier.minScore)) multiplier = Number(tier.multiplier) || 1;
  }
  return Math.min(Math.max(multiplier, 1), LIMITS.MAX_POV_BONUS_MULTIPLIER);
}

/**
 * Split one week's pool across the qualified participants.
 *
 * THE POOL IS A CEILING, NOT A TARGET. PoV bonuses redistribute within it and
 * can never enlarge it: everyone's weighted share is computed, then scaled so
 * the total lands on the pool. A bonus therefore means "a larger slice", never
 * "more cake" — which is the only way a bonus system cannot be farmed into an
 * unbounded liability.
 *
 * @param {Array} participants `[{discordUserId, payoutWallet, povScore}]`
 * @returns {{weeklyPool, qualifiedCount, baseShare, allocations, totalAllocated, undistributed}}
 */
export function computeWeeklyAllocation(participants = [], epoch = {}) {
  const weeklyPool = Math.max(0, Number(epoch.weeklyPool ?? DEFAULT_EPOCH_PARAMS.weeklyPool));
  const qualifiedCount = participants.length;

  if (!qualifiedCount || weeklyPool <= 0) {
    return {
      weeklyPool, qualifiedCount, baseShare: 0,
      allocations: [], totalAllocated: 0, undistributed: weeklyPool,
      rulesVersion: RULES_VERSION,
    };
  }

  // Balance-rate rule (owner policy 2026-11-13): each qualifier earns
  // min(balance, MAX_QUALIFYING_BALANCE) x balanceRates[activeDays], where
  // activeDays = distinct participation days that week (0-7, clamped). Each
  // rate is <= MAX_COMBINED_RATE_PER_WEEK (re-checked here, not only at
  // validation). Then the per-person cap; then, if the sum exceeds the weekly
  // pool, everyone is scaled down by the same factor. Whole tokens, rounded down,
  // so the result is deterministic and never exceeds the pool. The old PoV
  // multiplier tiers are NOT applied on top.
  if (Array.isArray(epoch.balanceRates) && epoch.balanceRates.length === 8) {
    // Exact arithmetic (hodlMath.js): no floating-point product is ever rounded
    // down, so a reward meant to be a whole number is paid in full.
    const rates = epoch.balanceRates.map((r) => Math.min(Math.max(0, Number(r) || 0), LIMITS.MAX_COMBINED_RATE_PER_WEEK));
    const { rows, poolScale: scale } = balanceRateAllocation(participants, {
      rates: epoch.balanceRates,
      weeklyPool,
      maxPerPerson: LIMITS.MAX_PER_PARTICIPANT_WEEK,
      maxQualifyingBalance: LIMITS.MAX_QUALIFYING_BALANCE,
      maxRate: LIMITS.MAX_COMBINED_RATE_PER_WEEK,
    });
    const allocations = participants.map((p, i) => ({
      discordUserId: p.discordUserId,
      payoutWallet: p.payoutWallet,
      povScore: Number.isFinite(Number(p.povScore)) ? Number(p.povScore) : null,
      multiplier: 1,
      balance: Number(p.balance),
      ...(p.balanceUnits != null && p.balanceDecimals != null ? { balanceUnits: String(p.balanceUnits), balanceDecimals: Number(p.balanceDecimals) } : {}),
      activeDays: rows[i].days,
      rate: rows[i].rate,
      rateAmount: rows[i].rateAmount,
      amount: rows[i].amount,
    }));
    const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
    return {
      weeklyPool, qualifiedCount, baseShare: null, mode: "balance-rate", balanceRates: rates,
      poolScale: scale, allocations, totalAllocated, undistributed: weeklyPool - totalAllocated,
      rulesVersion: RULES_VERSION,
    };
  }

  const weighted = participants.map((p) => {
    const multiplier = povMultiplierFor(p.povScore, epoch);
    return { ...p, multiplier, weight: multiplier };
  });
  const totalWeight = weighted.reduce((sum, p) => sum + p.weight, 0);

  let allocations = weighted.map((p) => {
    const raw = (weeklyPool * p.weight) / totalWeight;
    // Whole tokens only. Dust is not worth a transaction fee, and rounding down
    // guarantees the sum can never exceed the pool.
    const capped = Math.min(raw, LIMITS.MAX_PER_PARTICIPANT_WEEK);
    return {
      discordUserId: p.discordUserId,
      payoutWallet: p.payoutWallet,
      povScore: Number.isFinite(Number(p.povScore)) ? Number(p.povScore) : null,
      multiplier: p.multiplier,
      amount: Math.floor(capped),
    };
  });

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  return {
    weeklyPool,
    qualifiedCount,
    baseShare: Math.floor(weeklyPool / qualifiedCount),
    allocations,
    totalAllocated,
    // Whatever the per-participant cap and rounding left behind. It stays in the
    // reserve rather than being forced onto someone.
    undistributed: weeklyPool - totalAllocated,
    rulesVersion: RULES_VERSION,
  };
}

/**
 * The full record of one Tuesday, ready to be stored.
 *
 * Epoch parameters are copied BY VALUE. Editing an epoch later must never
 * rewrite what a past week actually paid — the same reasoning as the frozen
 * rulesVersion on a payout receipt. A snapshot has to stay reproducible years
 * later, when the parameters that produced it are long gone.
 */
export function buildWeeklySnapshot({ epoch, participants, takenAtMs = Date.now() } = {}) {
  const allocation = computeWeeklyAllocation(participants, epoch);
  return {
    epochId: epoch?.id || null,
    weekIndex: weekIndexFor(epoch, takenAtMs),
    takenAtIso: new Date(takenAtMs).toISOString(),
    params: {
      weeklyPool: Number(epoch?.weeklyPool ?? DEFAULT_EPOCH_PARAMS.weeklyPool),
      minHold: Number(epoch?.minHold ?? DEFAULT_EPOCH_PARAMS.minHold),
      payoutDay: Number(epoch?.payoutDay ?? DEFAULT_EPOCH_PARAMS.payoutDay),
      povBonusTiers: (epoch?.povBonusTiers || DEFAULT_EPOCH_PARAMS.povBonusTiers).map((t) => ({ ...t })),
      ...(Array.isArray(epoch?.balanceRates) ? {
        balanceRates: epoch.balanceRates.map(Number),
        maxQualifyingBalance: LIMITS.MAX_QUALIFYING_BALANCE,
        // The 7 complete UTC days counted for activeDays (hodlActiveDays.activeDaysWindow).
        activeDaysWindow: (() => {
          const d = new Date(takenAtMs); const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
          return { startIso: new Date(end - 7 * 86_400_000).toISOString(), endIso: new Date(end).toISOString() };
        })(),
      } : {}),
    },
    ...allocation,
    status: "pending",
  };
}
