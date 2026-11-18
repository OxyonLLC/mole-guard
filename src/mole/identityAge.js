/**
 * Identity-age gate for wallet verification.
 *
 * WHY THIS EXISTS
 *
 * Before this file, verification proved exactly one thing: "this person has a
 * Discord account." A Discord account is free and takes about fifteen seconds
 * to make — which is the same cost as generating a Solana keypair, the very
 * thing verification is supposed to be a defence against. On 2026-08-16 an
 * operator signed in with 19 freshly generated wallets in under 40 minutes;
 * nothing about requiring a Discord account would have slowed that down, since
 * they could have made 19 Discord accounts just as fast.
 *
 * A sybil gate is worth exactly what a second identity COSTS. So this gate does
 * not ask "do you have an account" — it asks "how long have you had it", which
 * is the one property an attacker cannot manufacture on demand. Aged accounts
 * can be bought, so this raises the price rather than closing the door; that is
 * the honest description of what it buys you.
 *
 * TWO SIGNALS, DELIBERATELY DIFFERENT IN STRENGTH
 *
 *  1. ACCOUNT AGE — derived from the Discord snowflake itself. The creation
 *     timestamp is encoded in the top 42 bits of the id, so this needs no API
 *     call, cannot rate-limit, cannot time out, and cannot be spoofed: the id
 *     IS the account. This check therefore never fails open.
 *
 *  2. GUILD MEMBERSHIP AGE + MEMBERSHIP SCREENING — needs a Discord API call,
 *     so it can fail for reasons that have nothing to do with the user (bot
 *     token missing, Discord down, 429). Those FAIL OPEN, matching the
 *     deliberate precedent in walletBans.js: refusing every honest person
 *     during an outage is a worse outcome than briefly missing a signal. The
 *     result says which checks actually ran so the caller can log it honestly
 *     rather than implying a clean pass.
 *
 * This gate applies at LINK time only. It never retroactively un-verifies
 * anyone: an existing verified wallet is unaffected, and a re-verification
 * after TTL expiry re-runs the gate, which an aged account passes trivially.
 */

import { getConfig } from "./config.js";
import { withAppeal } from "../services/appealContact.js";
import { discordCreatedAtMs } from "../shared/snowflake.js";

// Snowflake decoding moved to src/shared/snowflake.js (2026-08-16) when a date
// audit needed the X/Twitter half too. Re-exported here so this module's own
// API is unchanged and existing callers/tests keep working; the trap comment
// (JavaScript's `>>` coerces to int32) lives with the implementation.
export { DISCORD_EPOCH_MS } from "../shared/snowflake.js";

/** Creation time encoded in a Discord snowflake, or null if it is not one. */
export function accountCreatedAtMs(discordUserId) {
  return discordCreatedAtMs(discordUserId);
}

export const IDENTITY_REASONS = Object.freeze({
  ACCOUNT_TOO_NEW: "account_too_new",
  GUILD_TOO_NEW: "guild_membership_too_new",
  SCREENING_PENDING: "membership_screening_pending",
  NOT_IN_GUILD: "not_in_guild",
});

const DAY_MS = 86400000;

/** Whole days between two ms timestamps, floored, never negative. */
export function ageInDays(fromMs, nowMs = Date.now()) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - fromMs) / DAY_MS));
}

export function identityGateConfig(cfg = getConfig()) {
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const bool = (value, fallback) => {
    if (value == null || value === "") return fallback;
    const v = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
    return fallback;
  };
  return {
    enabled: bool(cfg.IDENTITY_GATE_ENABLED ?? process.env.IDENTITY_GATE_ENABLED, true),
    minAccountAgeDays: num(cfg.IDENTITY_MIN_ACCOUNT_AGE_DAYS ?? process.env.IDENTITY_MIN_ACCOUNT_AGE_DAYS, 30),
    minGuildDays: num(cfg.IDENTITY_MIN_GUILD_DAYS ?? process.env.IDENTITY_MIN_GUILD_DAYS, 3),
    requireScreening: bool(cfg.IDENTITY_REQUIRE_SCREENING ?? process.env.IDENTITY_REQUIRE_SCREENING, true),
    // A holder's FIRST wallet skips the waiting periods (2026-08-20, owner's
    // rule). 0 disables the bypass entirely. See applyHolderBypass() below for
    // what it does and does not buy.
    firstWalletMinBalance: num(
      cfg.IDENTITY_FIRST_WALLET_MIN_BALANCE ?? process.env.IDENTITY_FIRST_WALLET_MIN_BALANCE,
      100000,
    ),
  };
}

/**
 * The holder bypass: waiting is a proxy for cost, and holding is cost itself.
 *
 * A person joining Discord today to link their first wallet is refused by the
 * age checks even when they have just bought in — which is what happened on
 * 2026-08-19 (`guild_membership_too_new`, required 7, actual 0). Someone
 * holding 100,000 WinLEW has paid more for that identity than any waiting
 * period costs an attacker, so the wait buys nothing further from them.
 *
 * WHAT IT DELIBERATELY DOES NOT WAIVE: being in the server at all, and having
 * accepted the rules screen. Both are free, so waiving them would buy nothing
 * either — and `NOT_IN_GUILD` is the one refusal that is simply true.
 *
 * WHAT IT COSTS, STATED PLAINLY: tokens move. The same 100,000 can be sent to
 * a fresh wallet and used to pass this check again under a second Discord
 * account, so this raises the price of an identity to "buy in and wait for a
 * transfer", not to "buy in once per identity". Closing that needs a
 * holding-DURATION check, which needs historical balances this project has no
 * indexer for — the same limitation `/governance/` already states in public
 * about its own snapshot rule. Every grant is logged so the pattern is at
 * least visible after the fact.
 *
 * Only ever RELAXES a refusal; it can never turn a pass into a refusal.
 */
function applyHolderBypass(refusal, { gate, holder, checksRun, details }) {
  const min = Number(gate.firstWalletMinBalance || 0);
  if (min <= 0 || !holder) return refusal;
  if (!holder.isFirstWallet) return refusal;

  // A balance we could not read is not a balance we may assume. The account-age
  // signal is the strong one and it still applies; refusing here leaves the
  // normal rule in place rather than letting an unreadable wallet through.
  if (!Number.isFinite(holder.balance)) {
    return { ...refusal, details: { ...details, holderBypass: "balance_unavailable" } };
  }
  if (holder.balance < min) {
    return { ...refusal, details: { ...details, holderBypass: "below_minimum", holderBalance: holder.balance } };
  }
  return {
    ok: true,
    bypassed: "holder_first_wallet",
    waived: refusal.reason,
    checksRun,
    details: { ...details, holderBalance: holder.balance, holderMinimum: min },
  };
}

/**
 * Pure decision function — no I/O, so every branch is directly testable.
 *
 * `guildFacts` is null when the membership lookup could not run. That is NOT
 * treated as a refusal (see the fail-open note at the top); it is recorded in
 * `checksRun` so the caller can tell "passed everything" apart from "passed the
 * only check we could make".
 *
 * @param {object} input
 * @param {string} input.discordUserId
 * @param {{joinedAtMs:number|null, pending:boolean, inGuild:boolean}|null} [input.guildFacts]
 * @param {number} [input.now]
 * @param {object} [input.gate]  identityGateConfig() result
 */
export function evaluateIdentityAge({
  discordUserId,
  guildFacts = null,
  now = Date.now(),
  gate = identityGateConfig(),
  holder = null,
}) {
  const checksRun = [];
  const details = {};

  if (!gate.enabled) return { ok: true, skipped: "gate_disabled", checksRun, details };

  const createdAt = accountCreatedAtMs(discordUserId);
  // Not a Discord snowflake — this gate has nothing to say about it. Callers
  // must not read "ok" here as "identity verified"; it means "not applicable".
  if (createdAt == null) return { ok: true, skipped: "not_a_discord_id", checksRun, details };

  const accountDays = ageInDays(createdAt, now);
  details.accountCreatedAt = new Date(createdAt).toISOString();
  details.accountAgeDays = accountDays;
  checksRun.push("account_age");

  if (gate.minAccountAgeDays > 0 && accountDays < gate.minAccountAgeDays) {
    const refusal = {
      ok: false,
      reason: IDENTITY_REASONS.ACCOUNT_TOO_NEW,
      required: gate.minAccountAgeDays,
      actual: accountDays,
      checksRun,
      details,
    };
    const decided = applyHolderBypass(refusal, { gate, holder, checksRun, details });
    if (decided.ok) return decided;
    // Fall through only when the bypass did not apply — an account too new AND
    // not a qualifying holder still has the guild checks ahead of it, but there
    // is nothing further to learn, so refuse here as before.
    return decided;
  }

  // Everything below needs the Discord API. Absent facts = check did not run.
  if (!guildFacts) {
    return { ok: true, degraded: "guild_lookup_unavailable", checksRun, details };
  }

  if (!guildFacts.inGuild) {
    return { ok: false, reason: IDENTITY_REASONS.NOT_IN_GUILD, checksRun, details };
  }

  if (gate.requireScreening && guildFacts.pending === true) {
    checksRun.push("membership_screening");
    return { ok: false, reason: IDENTITY_REASONS.SCREENING_PENDING, checksRun, details };
  }
  if (gate.requireScreening) checksRun.push("membership_screening");

  if (gate.minGuildDays > 0) {
    // joinedAtMs missing while inGuild is true means Discord returned a member
    // object without joined_at. Treat as unavailable, not as age zero — reading
    // a missing field as "joined just now" would refuse long-standing members.
    if (!Number.isFinite(guildFacts.joinedAtMs)) {
      return { ok: true, degraded: "joined_at_missing", checksRun, details };
    }
    const guildDays = ageInDays(guildFacts.joinedAtMs, now);
    details.joinedAt = new Date(guildFacts.joinedAtMs).toISOString();
    details.guildMembershipDays = guildDays;
    checksRun.push("guild_membership_age");
    if (guildDays < gate.minGuildDays) {
      return applyHolderBypass(
        {
          ok: false,
          reason: IDENTITY_REASONS.GUILD_TOO_NEW,
          required: gate.minGuildDays,
          actual: guildDays,
          checksRun,
          details,
        },
        { gate, holder, checksRun, details },
      );
    }
  }

  return { ok: true, checksRun, details };
}

/** User-facing explanation. Deliberately says what is required and when they
 *  will qualify — a bare "denied" reads as a bug and generates support load —
 *  and always carries the appeal route, because this gate refuses real people
 *  too (someone who genuinely joined Discord last week is indistinguishable
 *  here from someone who made an account to farm the faucet). */
export function explainIdentityRefusal(result, gate = null) {
  if (!result || result.ok) return null;
  return withAppeal(identityRefusalReason(result, gate));
}

/** The second route out of a waiting period, when one is available to them.
 *  Told to the user because a refusal that hides the way past it reads as a
 *  wall — and this one is a door they may already be holding the key to. */
function holderRouteSentence(result, gate) {
  // Deliberately does NOT call identityGateConfig() as a default: this builds a
  // user-facing string, and a message path that can throw on config validation
  // turns a refusal into a 500. Callers that already hold the gate pass it; the
  // fallback reads the one env var it needs and nothing else.
  const min = Number(
    gate?.firstWalletMinBalance ?? process.env.IDENTITY_FIRST_WALLET_MIN_BALANCE ?? 100000,
  );
  if (!Number.isFinite(min)) return "";
  if (min <= 0) return "";
  if (result?.details?.holderBypass === "below_minimum") {
    return ` Or verify your first wallet holding at least ${min.toLocaleString("en-US")} WinLEW — this one holds ${Number(result.details.holderBalance).toLocaleString("en-US")}.`;
  }
  if (result?.details?.holderBypass === "balance_unavailable") {
    return ` A wallet holding at least ${min.toLocaleString("en-US")} WinLEW can skip the wait, but that balance could not be read just now — try again shortly.`;
  }
  return ` Or skip the wait by verifying your first wallet holding at least ${min.toLocaleString("en-US")} WinLEW.`;
}

function identityRefusalReason(result, gate) {
  switch (result.reason) {
    case IDENTITY_REASONS.ACCOUNT_TOO_NEW:
      return `Your Discord account is ${result.actual} day(s) old. Verification needs an account at least ${result.required} days old — this keeps automated wallet farms out. You'll qualify in ${Math.max(1, result.required - result.actual)} day(s).${holderRouteSentence(result, gate)}`;
    case IDENTITY_REASONS.GUILD_TOO_NEW:
      return `You joined the server ${result.actual} day(s) ago. Verification needs ${result.required} days of membership. You'll qualify in ${Math.max(1, result.required - result.actual)} day(s).${holderRouteSentence(result, gate)}`;
    case IDENTITY_REASONS.SCREENING_PENDING:
      return "Please finish Discord's membership screening (accept the server rules) in the server, then verify again.";
    case IDENTITY_REASONS.NOT_IN_GUILD:
      return "Join the WinLEW Discord server before verifying your wallet.";
    default:
      return "Verification is not available for this account yet.";
  }
}
