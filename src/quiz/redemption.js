'use strict';

// Single shared redemption service — the ONLY place that turns quiz points
// into a redemption record, called by BOTH the Discord /redeem command
// (src/quiz/index.js) and the web redemption route (src/mole/web.js's
// POST /api/quiz/redeem). Neither caller duplicates eligibility/amount
// validation, and both go through db.redeemPoints(), which is itself
// serialized by db.js's file lock (acquireLock/mutateDb) — so a Discord
// redeem and a web redeem racing for the same user's balance are resolved
// by the exact same mechanism that already serializes every other quiz db
// write, not a new one. See docs/web-quiz-redemption.md.
const db = require('./db');
const { getLinkedWallet } = require('./wallets');
const { resolvePayoutConfig } = require('./payout-config');

const VALID_SOURCES = ['discord', 'web'];

// Structured rejection codes (mirrors src/faucet/eligibility.js's own
// ELIGIBILITY_REASONS enum) — callers (the Discord command, the web route)
// branch on `code`, never on the human-readable `error` string, to decide
// whether to show "here's how to buy WinLEW" purchase links.
const REDEMPTION_REASONS = Object.freeze({
  NO_USER: 'no_user',
  INVALID_SOURCE: 'invalid_source',
  MANUAL_REDEEM_DISABLED: 'manual_redeem_disabled',
  // Mirrors src/faucet/eligibility.js's ELIGIBILITY_REASONS so a client can
  // treat a quiz refusal and a faucet refusal the same way.
  WALLET_BANNED: 'wallet_banned',
  LINKED_TO_BANNED: 'linked_to_banned',
  INVALID_AMOUNT: 'invalid_amount',
  BELOW_MINIMUM: 'below_minimum',
  INSUFFICIENT_POINTS: 'insufficient_points',
  NO_WALLET: 'no_wallet',
  ZERO_BALANCE: 'zero_balance',
  HOLDER_CHECK_UNAVAILABLE: 'holder_check_unavailable',
});

// src/mole/solana.js is ESM; this file is CommonJS, so it's loaded via a
// dynamic import rather than require(). Wrapped in its own function (not
// inlined at the call site) purely so redeemQuizPoints's default parameter
// below stays a plain function reference — same dependency-injection
// pattern src/mole/contributions.js's confirmContribution() uses for its
// getParsedTransaction override, and src/mole/governanceEligibility.js's
// checkLiveWinlewEligibility() uses for its getBalance override: production
// never passes an override and gets the real RPC call; tests always pass
// one and never touch real Solana RPC or real wallet-link files.
async function fetchSplBalance(address) {
  const mint = resolvePayoutConfig().mint;
  if (!mint) throw new Error('winlew_mint_not_configured');
  const { getSplBalance } = await import('../mole/solana.js');
  return getSplBalance(address, mint);
}

// Minimum WinLEW a wallet must hold to redeem. Separate from the faucet's
// FAUCET_MIN_HOLDER_BALANCE because the stakes differ: a faucet drip is small
// and frequent, a redemption pays out a points balance in one go.
//
// Defaults to the faucet's value so behaviour does not change silently on
// deploy. That default is 1 WinLEW, which is a fraction of a cent and is NOT a
// meaningful barrier — set QUIZ_MIN_HOLDER_BALANCE deliberately.
function getMinHolderBalance() {
  const raw = process.env.QUIZ_MIN_HOLDER_BALANCE ?? process.env.FAUCET_MIN_HOLDER_BALANCE ?? 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[quiz-redeem] invalid QUIZ_MIN_HOLDER_BALANCE=${raw}, falling back to 1`);
    return 1;
  }
  return n;
}

// System-only redemption (owner decision, 2026-08-14).
//
// On-demand redeeming is the abuse surface, and the amount held was never the
// real control. A farmer moves the payout from wallet one to wallet two and
// keeps redeeming while the first cools off — so any per-wallet limit is
// defeated by having another wallet. What they cannot fake is TIME. If the
// system decides when payouts happen, "claim ten times a day" stops being a
// thing that exists, and one more wallet buys nothing.
//
// It also fixes the economics: three 1,500-point redemptions cost three
// transactions in gas. Settling the same points once at cycle close costs one.
//
// Points are NOT lost while this is on. They keep accruing and are paid by
// cycle close (kind: 'cycle_payout') and the leaderboard payout — the two
// system-driven paths that already existed. Only the user-initiated
// 'user_redeem' path is closed.
//
// A flag rather than a deletion: the instant-payout option was a deliberate
// product choice once (91-day cycles -> weekly + instant), and reversing a
// decision should not need a code change.
function manualRedeemEnabled() {
  return String(process.env.QUIZ_MANUAL_REDEEM_ENABLED || '').toLowerCase() === 'true';
}

async function redeemQuizPoints({
  userId,
  amount,
  source,
  resolveLinkedWallet = getLinkedWallet,
  getBalance = fetchSplBalance,
} = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, error: 'A signed-in user is required.', code: REDEMPTION_REASONS.NO_USER };
  if (!VALID_SOURCES.includes(source)) {
    return { ok: false, error: 'Invalid redemption source.', code: REDEMPTION_REASONS.INVALID_SOURCE };
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt <= 0) {
    return { ok: false, error: 'Amount must be a positive whole number of points.', code: REDEMPTION_REASONS.INVALID_AMOUNT };
  }

  // Redemption floor (2026-07-30) — matched to the faucet's drip (1500
  // WinLEW), enforced identically on Discord and web. db.redeemPoints()
  // re-checks this as the backstop; this is the caller-facing rejection with
  // a structured code.
  if (!manualRedeemEnabled()) {
    return {
      ok: false,
      error: 'Quiz points are paid out automatically when the cycle closes — there is nothing to claim by hand. Your points keep counting until then.',
      code: REDEMPTION_REASONS.MANUAL_REDEEM_DISABLED,
    };
  }

  const minPoints = db.getMinRedemptionPoints();
  if (amt < minPoints) {
    return {
      ok: false,
      error: `Minimum redemption is ${minPoints} points (${db.estimateWinlewForPoints(minPoints)} WinLEW — the same as one faucet drip). Keep stacking points and redeem once you're past the line.`,
      code: REDEMPTION_REASONS.BELOW_MINIMUM,
      minPoints,
    };
  }

  // Cheap, read-only, non-mutating pre-check — same message db.redeemPoints()
  // itself would give, checked here first purely so an ineligible-on-points
  // request never even reaches the holder-check's RPC call. db.redeemPoints()
  // below still re-checks for real (and is what actually enforces this under
  // concurrent requests, via its own file-lock serialization) — this is an
  // optimization, not a replacement for that.
  if (db.getUser(uid).unpaidPoints < amt) {
    return { ok: false, error: 'Not enough points.', code: REDEMPTION_REASONS.INSUFFICIENT_POINTS };
  }

  // Holder gate (2026-07-26), REBUILT 2026-08-14 after real abuse.
  //
  // This comment used to claim it "mirrors src/faucet/eligibility.js's existing
  // holder check exactly". It did not, and that false claim of parity is
  // probably why nobody re-read it. The faucet refuses below a CONFIGURABLE
  // minimum and also consults the ban list and the funding-cluster walk. This
  // checked `balance > 0` and nothing else.
  //
  // What that allowed, observed on 2026-08-14: buy a fraction of a token, pass
  // the gate, redeem 1,500, move the payout to another wallet, repeat. The
  // anti-abuse system built for the faucet was never wired to this path — the
  // whole src/quiz/ tree imported none of it.
  //
  // Now shares the faucet's gates. Order matters: cheap local checks first, RPC
  // last, so a banned wallet costs no network call. Checked BEFORE db.redeemPoints()
  // ever mutates the points ledger, and BEFORE the payout worker would
  // otherwise pay Solana's rent to create a token account for a wallet that
  // turns out to be ineligible anyway (a fresh zero-balance wallet has no
  // existing associated token account; a real holder already does).
  const linked = resolveLinkedWallet(uid, 'payout');
  if (!linked?.address) {
    return {
      ok: false,
      error: 'Link a wallet before redeeming — WinLEW redemption is holder-only right now.',
      code: REDEMPTION_REASONS.NO_WALLET,
    };
  }

  let balance;
  try {
    balance = await getBalance(linked.address);
  } catch {
    // Fail closed: an RPC error (or a missing mint config) is not the same
    // as a zero balance — never treat "couldn't verify" as "eligible."
    return {
      ok: false,
      error: 'Could not verify your WinLEW balance right now — try again in a moment.',
      code: REDEMPTION_REASONS.HOLDER_CHECK_UNAVAILABLE,
    };
  }
  const minHold = getMinHolderBalance();
  if (!(balance >= minHold)) {
    return {
      ok: false,
      error: minHold <= 1
        ? `Redemption is holder-only: your linked wallet (${linked.address}) doesn't hold any WinLEW yet.`
        : `Redemption is holder-only: your linked wallet needs at least ${minHold.toLocaleString('en-US')} WinLEW (it holds ${balance.toLocaleString('en-US')}).`,
      code: REDEMPTION_REASONS.ZERO_BALANCE,
      wallet: linked.address,
      minHolderBalance: minHold,
      balance,
    };
  }

  // Account ban, checked first and separately from the wallet checks below.
  // A banned account with a brand new wallet passes every wallet-based test
  // there is, which is the whole reason the account list exists.
  try {
    const userBans = await import('../faucet/userBans.js');
    const accountBan = await userBans.checkUserBan(uid);
    if (accountBan.banned) {
      return {
        ok: false,
        // Same sentence as the wallet refusal below, on purpose: which
        // identity burned is not something a prober should learn from us.
        error: 'This wallet is not eligible for redemption.',
        code: REDEMPTION_REASONS.WALLET_BANNED,
        wallet: linked.address,
      };
    }
  } catch (error) {
    console.warn('[quiz-redeem] account ban check unavailable:', error?.message || error);
  }

  // Ban list + 2-hop funding-cluster walk, the same checks the faucet runs.
  // Dynamic import because src/quiz is CommonJS and src/faucet/walletBans.js is
  // ESM. Fails OPEN on an unreachable chain, exactly as the faucet does: an RPC
  // outage refusing every honest redeemer is worse than briefly missing a
  // linked wallet. A DIRECT ban is local state, so it still refuses.
  try {
    const bans = await import('../faucet/walletBans.js');
    const link = await bans.findBannedLink(linked.address, { maxDepth: 2 });
    if (link.banned) {
      return {
        ok: false,
        // One sentence for both cases, deliberately. Saying "you are linked to
        // a banned wallet" — let alone naming it — teaches a prober exactly
        // which address to stop funding from. Same rule the faucet's refusals
        // already follow. The distinct CODE below is for our logs, not the user.
        error: 'This wallet is not eligible for redemption.',
        code: link.path && link.path.length <= 1
          ? REDEMPTION_REASONS.WALLET_BANNED
          : REDEMPTION_REASONS.LINKED_TO_BANNED,
        wallet: linked.address,
      };
    }
  } catch (error) {
    console.warn('[quiz-redeem] ban check unavailable:', error?.message || error);
  }

  const result = await db.redeemPoints(uid, amt, source);
  if (!result.ok) return result;

  return {
    ok: true,
    redemption: result.redemption,
    amount: amt,
    estimatedWinlew: db.estimateWinlewForPoints(amt),
    payoutRate: db.getPayoutRate(),
    source,
    linkedWallet: { address: linked.address, source: linked.source },
  };
}

module.exports = { redeemQuizPoints, REDEMPTION_REASONS };
