// Weekly CUNT — reference epoch state machine.
//
// THIS IS NOT PRODUCTION CODE AND IT NEVER RUNS ON CHAIN. It is an executable
// specification: a pure, dependency-free model of the Tuesday claim protocol so
// the rules can be attacked in tests before anyone writes Rust. The eventual
// on-chain program must satisfy the same tests in test/cunt/weeklyProtocol.test.mjs.
//
// Design notes that matter, and why:
//
//  * Amounts are BigInt. Token accounting in floating point is how you get
//    0.30000000000000004 of someone's reward. The repo already learned this —
//    src/faucet/amount.js exists for the same reason.
//
//  * A claim is identified by (epoch, claimant) and recorded in a Set. On chain
//    this is NOT a list the program scans — it is a PDA seeded by those two
//    values, and its EXISTENCE is the proof. Creating it twice fails in the
//    runtime before any of our logic runs, which is why INVARIANT 5 is cheap
//    and total rather than something we have to remember to check.
//
//  * There is deliberately NO function that removes tokens from the vault other
//    than by a claim, and none that edits a claim record. §16/§37, and the
//    authority matrix marks both NOBODY. Their absence here is the spec.
//
//  * Time is passed in, never read from a clock. On chain this is
//    Clock::get()?.unix_timestamp; in tests it is an argument. Nothing in the
//    model may depend on "now" implicitly.

export const EPOCH_STATUS = Object.freeze({
  UPCOMING: "UPCOMING",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  FINALIZED: "FINALIZED",
});

export const REJECT = Object.freeze({
  NO_SUCH_EPOCH: "no_such_epoch",
  NOT_OPEN: "not_open",
  BEFORE_WINDOW: "before_window",
  AFTER_WINDOW: "after_window",
  ALREADY_CLAIMED: "already_claimed",
  BUDGET_EXHAUSTED: "budget_exhausted",
  VAULT_INSUFFICIENT: "vault_insufficient",
  NOT_ELIGIBLE: "not_eligible",
  NOT_REGISTERED: "not_registered",
  WALLET_ALREADY_REGISTERED: "wallet_already_registered",
  IDENTITY_ALREADY_REGISTERED: "identity_already_registered",
});

class ProtocolError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const big = (v, field) => {
  let n;
  try {
    n = typeof v === "bigint" ? v : BigInt(v);
  } catch {
    throw new TypeError(`${field} must be an integer amount, got ${String(v)}`);
  }
  if (n < 0n) throw new RangeError(`${field} may not be negative`);
  return n;
};

/**
 * A fresh protocol state. `vaultBalance` is what the reward vault PDA holds.
 * Nothing here has an owner or a key — that is the point of a PDA.
 */
export function createState({ vaultBalance = 0n } = {}) {
  return {
    epochs: new Map(),
    claims: new Set(), // "<epoch>:<identityHash>" — models the ClaimRecord PDA
    registrations: new Map(), // wallet -> identityHash  (models Registration PDA)
    identities: new Map(), // identityHash -> wallet     (models IdentityRecord PDA)
    registeredAt: new Map(), // identityHash -> unix ts  (eligibility start)
    vaultBalance: big(vaultBalance, "vaultBalance"),
    totalClaimed: 0n,
  };
}

/**
 * Bind a wallet to a verified identity. THIS IS THE SYBIL GATE, and it is worth
 * being exact about why, because the obvious reading is wrong:
 *
 *   Signing a Solana transaction ALREADY proves control of the signing key.
 *   So "only verified wallets may claim", read as key-ownership, gates nothing
 *   — a sybil operator legitimately controls all 100 of their wallets.
 *
 * The resistance comes entirely from binding a wallet to something costlier to
 * mass-produce than a keypair. For WinLEW that is a Discord identity:
 * wallet_links.json is keyed by Discord user ID, so verification proves
 * "this human's Discord account controls this wallet", not merely "someone
 * controls this wallet".
 *
 * A chain cannot see Discord, so the binding has to be attested on-chain by a
 * registration authority. That is a real, new trust assumption — whoever can
 * register decides who can claim — and it is recorded as its own row in the
 * authority matrix rather than hidden inside "eligibility".
 *
 * `identityHash` is a hash, never a raw Discord ID: the registry is public and
 * a plaintext ID list would deanonymise every participant.
 */
export function registerParticipant(state, { wallet, identityHash, registeredAtTs = null }) {
  if (!wallet || typeof wallet !== "string") throw new TypeError("wallet must be an address string");
  if (!identityHash || typeof identityHash !== "string") throw new TypeError("identityHash must be a string");

  const existingIdentity = state.registrations.get(wallet);
  if (existingIdentity !== undefined) {
    throw new ProtocolError(REJECT.WALLET_ALREADY_REGISTERED);
  }
  // One identity may bind exactly one wallet. Without this, a single verified
  // person registers 100 wallets and the gate does nothing at all.
  if (state.identities.has(identityHash)) {
    throw new ProtocolError(REJECT.IDENTITY_ALREADY_REGISTERED);
  }

  state.registrations.set(wallet, identityHash);
  state.identities.set(identityHash, wallet);
  // When someone registered decides which epochs they could POSSIBLY have
  // claimed. Without it, joining at epoch 50 would show 49 "missed" Tuesdays
  // and a ruined record for someone who did nothing wrong. null means "treat as
  // eligible from the beginning", which is only correct in tests.
  state.registeredAt.set(identityHash, registeredAtTs);
  return { wallet, identityHash, registeredAtTs };
}

export function isRegistered(state, wallet) {
  return state.registrations.has(wallet);
}

export function identityOf(state, wallet) {
  return state.registrations.get(wallet) ?? null;
}

/**
 * Fund the vault. Human-authorised on purpose: funding can only ever increase
 * what participants can claim (§16, authority matrix `fund_tuesday_vault`).
 * There is no matching withdraw — that absence is deliberate.
 */
export function fundVault(state, amount) {
  const a = big(amount, "amount");
  state.vaultBalance += a;
  return state.vaultBalance;
}

export function createEpoch(state, { epochNumber, startTs, endTs, rewardBudget, rewardPerClaim }) {
  if (!Number.isInteger(epochNumber) || epochNumber < 1) {
    throw new TypeError("epochNumber must be a positive integer");
  }
  if (state.epochs.has(epochNumber)) throw new Error(`epoch ${epochNumber} already exists`);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) throw new TypeError("timestamps must be numbers");
  if (endTs <= startTs) throw new RangeError("epoch window must end after it starts");

  const budget = big(rewardBudget, "rewardBudget");
  const perClaim = big(rewardPerClaim, "rewardPerClaim");
  if (perClaim === 0n) throw new RangeError("rewardPerClaim must be greater than zero");
  if (perClaim > budget) throw new RangeError("rewardPerClaim may not exceed the epoch budget");

  const epoch = {
    epochNumber,
    startTs,
    endTs,
    rewardBudget: budget,
    rewardPerClaim: perClaim,
    remainingBudget: budget,
    claimsCompleted: 0,
    uniqueClaimers: 0,
    status: EPOCH_STATUS.UPCOMING,
  };
  state.epochs.set(epochNumber, epoch);
  return epoch;
}

/**
 * Status derived from the clock, not from an operator pressing a button.
 * The authority matrix marks open_epoch/close_epoch as PROGRAM_PDA precisely so
 * a missed press cannot cancel everyone's week, and an early press cannot
 * become a denial-of-claim power.
 */
export function statusAt(epoch, nowTs) {
  if (epoch.status === EPOCH_STATUS.FINALIZED) return EPOCH_STATUS.FINALIZED;
  if (nowTs < epoch.startTs) return EPOCH_STATUS.UPCOMING;
  if (nowTs >= epoch.endTs) return EPOCH_STATUS.CLOSED;
  return EPOCH_STATUS.OPEN;
}

// Claim records are keyed by IDENTITY, not by wallet. With one-wallet-per-
// identity enforced at registration the two are equivalent today — this is
// defence in depth. If the 1:1 binding is ever relaxed (say, to let someone
// rotate a compromised wallet), keying by wallet would silently hand that
// person a second claim; keying by identity does not.
//
// On chain: ClaimRecord PDA seeded ["claim", epoch as u64 LE, identity_hash].
const claimKey = (epochNumber, identityHash) => `${epochNumber}:${identityHash}`;

/** Accepts a wallet and resolves it to its identity. Unregistered → false. */
export function hasClaimed(state, epochNumber, wallet) {
  const identityHash = state.registrations.get(wallet);
  if (identityHash === undefined) return false;
  return state.claims.has(claimKey(epochNumber, identityHash));
}

export function identityHasClaimed(state, epochNumber, identityHash) {
  return state.claims.has(claimKey(epochNumber, identityHash));
}

/**
 * The Tuesday claim. Returns the amount paid, or throws a ProtocolError whose
 * `.reason` is one of REJECT.
 *
 * `isEligible` is injected rather than assumed: eligibility rules are NOT
 * decided yet (§24/§25), and baking one in here would quietly make it look
 * settled.
 */
export function claim(state, { epochNumber, claimant, nowTs, isEligible = () => true }) {
  const epoch = state.epochs.get(epochNumber);
  if (!epoch) throw new ProtocolError(REJECT.NO_SUCH_EPOCH);
  if (!claimant || typeof claimant !== "string") throw new TypeError("claimant must be an address string");

  const status = statusAt(epoch, nowTs);
  if (status === EPOCH_STATUS.UPCOMING) throw new ProtocolError(REJECT.BEFORE_WINDOW);
  if (status === EPOCH_STATUS.CLOSED) throw new ProtocolError(REJECT.AFTER_WINDOW);
  if (status === EPOCH_STATUS.FINALIZED) throw new ProtocolError(REJECT.NOT_OPEN);

  // THE SYBIL GATE (owner decision 2026-08-08): only registered wallets claim.
  // See registerParticipant() for why this, and not the signature, is the gate.
  const identityHash = state.registrations.get(claimant);
  if (identityHash === undefined) throw new ProtocolError(REJECT.NOT_REGISTERED);

  // INVARIANT 5 — one claim per identity per epoch. On chain the ClaimRecord
  // PDA's existence enforces this in the runtime; here the Set models it.
  if (identityHasClaimed(state, epochNumber, identityHash)) throw new ProtocolError(REJECT.ALREADY_CLAIMED);

  // Any FURTHER eligibility rules layer on top. Registration is not optional
  // and cannot be switched off by passing an isEligible that returns true.
  if (!isEligible(claimant, epoch)) throw new ProtocolError(REJECT.NOT_ELIGIBLE);

  // INVARIANT 6 — the epoch cannot distribute more than its authorized budget.
  // Checked BEFORE any mutation so a rejected claim leaves no trace.
  if (epoch.remainingBudget < epoch.rewardPerClaim) throw new ProtocolError(REJECT.BUDGET_EXHAUSTED);

  // The vault is a separate constraint from the budget: an epoch may be
  // authorized to pay more than the vault actually holds.
  if (state.vaultBalance < epoch.rewardPerClaim) throw new ProtocolError(REJECT.VAULT_INSUFFICIENT);

  epoch.remainingBudget -= epoch.rewardPerClaim;
  state.vaultBalance -= epoch.rewardPerClaim;
  state.totalClaimed += epoch.rewardPerClaim;
  epoch.claimsCompleted += 1;
  epoch.uniqueClaimers += 1; // equal by construction — INVARIANT 5 guarantees it
  state.claims.add(claimKey(epochNumber, identityHash));

  return epoch.rewardPerClaim;
}

/**
 * Finalize a closed epoch. Unclaimed budget is released back — it was only ever
 * *authorized*, not spent (§7's "released does not mean dumped into wallets").
 * Finalizing is idempotent-safe: it throws rather than double-releasing.
 */
export function finalizeEpoch(state, { epochNumber, nowTs }) {
  const epoch = state.epochs.get(epochNumber);
  if (!epoch) throw new ProtocolError(REJECT.NO_SUCH_EPOCH);
  if (epoch.status === EPOCH_STATUS.FINALIZED) throw new Error(`epoch ${epochNumber} already finalized`);
  if (statusAt(epoch, nowTs) !== EPOCH_STATUS.CLOSED) throw new ProtocolError(REJECT.NOT_OPEN);

  const unclaimed = epoch.remainingBudget;
  epoch.status = EPOCH_STATUS.FINALIZED;
  return { unclaimed, distributed: epoch.rewardBudget - unclaimed };
}

/** Total ever distributed. Used by tests to assert conservation. */
export function accounting(state) {
  let authorized = 0n;
  let remaining = 0n;
  for (const e of state.epochs.values()) {
    authorized += e.rewardBudget;
    remaining += e.remainingBudget;
  }
  return { authorized, remaining, distributed: authorized - remaining, totalClaimed: state.totalClaimed };
}

export { ProtocolError };
