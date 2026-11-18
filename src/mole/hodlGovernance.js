// HODL Rewards — turning a passed vote into the next epoch.
//
// Pure. Takes a governance proposal and produces a DRAFT epoch, or a list of
// reasons why it cannot.
//
// THE RULE FROM SPEC §8: a governance vote must never be capable of authorising
// an unlimited payout. Three separate things enforce that here, because one is
// not enough for a mechanism whose entire job is to let other people change how
// much money leaves the treasury:
//
//   1. An ALLOWLIST. A vote can only set parameters named in EPOCH_PARAM_KEYS.
//      Anything else in the proposal is ignored, so a field nobody anticipated
//      cannot become a setting nobody reviewed.
//   2. HARD LIMITS. Values are checked against hodlEpochs.LIMITS, which are not
//      themselves votable. Out of range is REFUSED, never clamped — see below.
//   3. DRAFT, NEVER ACTIVE. A passed vote produces an epoch a human still has
//      to activate. The vote decides the terms; a person still presses the
//      button, and validateEpoch() runs again at that point.
//
// WHY REFUSE RATHER THAN CLAMP. If the community votes for 50,000/week and the
// ceiling is 25,000, quietly writing 25,000 pays out something nobody voted
// for while looking like the vote was honoured. Refusing forces someone to say
// out loud that the vote exceeded policy, which is the honest outcome and the
// one that leaves a record.

import { LIMITS, DEFAULT_EPOCH_PARAMS, validateEpoch, EPOCH_STATUS } from "./hodlEpochs.js";

/** The only parameters a vote may set. Everything else about an epoch — its
 *  dates, its id, its status — is operational, not something to vote on. */
export const EPOCH_PARAM_KEYS = Object.freeze(["weeklyPool", "minHold", "povBonusTiers"]);

/** Statuses that mean "the community actually decided this". A draft or an
 *  in-flight vote must never become an epoch. */
const DECIDED = new Set(["passed", "executed"]);

/**
 * Pull the proposed parameters out of a proposal, keeping only the allowlist.
 *
 * Returns what was ignored as well as what was taken, so a reviewer can see
 * that a proposal tried to set something it had no business setting rather than
 * having it silently disappear.
 */
export function parseEpochProposal(proposal = {}) {
  const source = proposal.epochParams || {};
  const params = {};
  const ignored = [];

  for (const key of Object.keys(source)) {
    if (EPOCH_PARAM_KEYS.includes(key)) params[key] = source[key];
    else ignored.push(key);
  }
  return { params, ignored };
}

/**
 * A DRAFT epoch from a passed proposal, or the reasons it cannot be one.
 *
 * @param {object} proposal
 * @param {object} opts `{ id, startMs, endMs }` — operational, not votable
 */
export function epochFromProposal(proposal = {}, { id, startMs, endMs } = {}) {
  const errors = [];

  if (!proposal?.id) errors.push("no proposal");
  if (!DECIDED.has(String(proposal?.status || ""))) {
    errors.push(`proposal status is "${proposal?.status}" — only a passed vote can set an epoch`);
  }
  if (!proposal?.epochParams) errors.push("the proposal carries no epochParams");
  if (!id) errors.push("the new epoch needs an id");

  const { params, ignored } = parseEpochProposal(proposal);

  // Checked BEFORE building, so the refusal names the offending value rather
  // than a generic validation failure further down.
  if (params.weeklyPool != null) {
    const pool = Number(params.weeklyPool);
    if (!Number.isFinite(pool)) errors.push("weeklyPool is not a number");
    else if (pool > LIMITS.MAX_WEEKLY_POOL) {
      errors.push(
        `the vote chose a weekly pool of ${pool}, above the hard ceiling of ` +
        `${LIMITS.MAX_WEEKLY_POOL}. This is NOT clamped — raising the ceiling is a ` +
        `code change and a deliberate decision, not something a vote can do on its own.`,
      );
    }
  }
  for (const tier of params.povBonusTiers || []) {
    if (Number(tier?.multiplier) > LIMITS.MAX_POV_BONUS_MULTIPLIER) {
      errors.push(`a PoV tier multiplier of ${tier.multiplier} exceeds ${LIMITS.MAX_POV_BONUS_MULTIPLIER}`);
    }
  }

  if (errors.length) return { ok: false, errors, ignored };

  const epoch = {
    id: String(id),
    startMs: Number(startMs),
    endMs: Number(endMs),
    ...DEFAULT_EPOCH_PARAMS,
    ...params,
    // Draft, always. The vote sets the terms; a human still activates it, and
    // validateEpoch() runs again at that point.
    status: EPOCH_STATUS.DRAFT,
    decidedBy: {
      proposalId: proposal.id,
      title: proposal.title || null,
      governanceMode: proposal.governanceMode || null,
      // Recorded so the epoch page can say WHY these numbers are these numbers,
      // and so a future reader can find the vote rather than take it on trust.
      recordedAtIso: new Date().toISOString(),
    },
  };

  const valid = validateEpoch(epoch);
  if (!valid.ok) return { ok: false, errors: valid.errors, ignored };

  return { ok: true, epoch, ignored };
}

/**
 * A plain-language summary of what a proposal would change, for the review step.
 * Comparing against the CURRENT epoch, because "10,000" means nothing without
 * knowing whether that is a rise, a fall, or no change at all.
 */
export function describeEpochChange(proposal, currentEpoch = null) {
  const { params, ignored } = parseEpochProposal(proposal);
  const lines = [];
  const current = currentEpoch || DEFAULT_EPOCH_PARAMS;

  const compare = (label, key, fmt = (v) => String(v)) => {
    if (params[key] == null) return;
    const before = current[key];
    const after = params[key];
    lines.push(before === after
      ? `${label}: ${fmt(after)} (unchanged)`
      : `${label}: ${fmt(before)} → ${fmt(after)}`);
  };

  compare("Weekly pool", "weeklyPool", (v) => `${Number(v).toLocaleString("en-US")} WinLEW`);
  compare("Minimum hold", "minHold", (v) => `${Number(v).toLocaleString("en-US")} WinLEW`);
  if (params.povBonusTiers) lines.push(`PoV bonus tiers: ${params.povBonusTiers.length} tiers`);
  if (ignored.length) lines.push(`Ignored (not votable): ${ignored.join(", ")}`);
  if (!lines.length) lines.push("No epoch parameters proposed.");
  return lines;
}
