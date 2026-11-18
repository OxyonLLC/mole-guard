// WinLEW Governance Module v1 — mutable vote storage and server-side result
// computation. Backed by src/mole/storage.js's Mongo-synced managed-JSON
// pattern (the same one sessions/wallet-links already use), storing under
// 'governance_votes.json'. See docs/governance-v1.md.
//
// Vote records are keyed by wallet address within a proposal, which makes
// "one wallet, one vote, latest choice wins" true by construction — a
// second vote from the same wallet simply overwrites the object at that
// key, there is no separate duplicate-detection step to get wrong.
//
// Every read/write here happens synchronously within a single Express
// request handler with no `await` between the read and the write, so a
// same-process race between two near-simultaneous requests for the same
// wallet cannot interleave (Node's single-threaded run-to-completion
// semantics) — the same reasoning src/quiz/db.js's mutateDb() already
// relies on for its own file-backed mutations.
import { readJson, writeJson } from "./storage.js";
import { resolveAccountId } from "./userAccounts.js";
import {
  VOTABLE_STATUSES,
  computeApprovalThreshold,
  getProposalById,
} from "./governanceData.js";
import { MAX_PURCHASED_VOTES_PER_PROPOSAL } from "./governancePricing.js";

// 1 free vote (eligibility-based) + up to MAX_PURCHASED_VOTES_PER_PROPOSAL
// paid vote weight (src/mole/governanceVoteCredits.js) — see the 2026-07-28
// plan's "capped pay-per-vote weight" decision. Enforced here too, not just
// at the point weight is computed, so a bad caller can never smuggle a
// larger weight into a stored vote record.
const MAX_TOTAL_WEIGHT = 1 + MAX_PURCHASED_VOTES_PER_PROPOSAL;

const VOTES_FILE = "governance_votes.json";

function readAllVotes() {
  return readJson(VOTES_FILE, {});
}

function writeAllVotes(votes) {
  writeJson(VOTES_FILE, votes);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Casts (or updates) a vote. Caller must have already resolved walletAddress
 * server-side (never from the client) and already checked eligibility for
 * THIS proposal — this function re-checks the voting window and the choice
 * validity itself as a second, independent guard, but does not re-check
 * token balance (that's an RPC call; the caller owns that check and its
 * caching).
 */
function castVote({ proposal, walletAddress, discordUserId, choice, weight = 1 }) {
  if (!proposal) return { ok: false, error: "proposal_not_found" };
  if (!VOTABLE_STATUSES.includes(proposal.status)) {
    return { ok: false, error: "voting_not_open" };
  }
  const now = Date.now();
  if (proposal.votingStartIso && now < Date.parse(proposal.votingStartIso)) {
    return { ok: false, error: "voting_not_started" };
  }
  if (proposal.votingEndIso && now > Date.parse(proposal.votingEndIso)) {
    return { ok: false, error: "voting_closed" };
  }
  if (!Array.isArray(proposal.choices) || !proposal.choices.includes(choice)) {
    return { ok: false, error: "invalid_choice" };
  }
  if (!walletAddress) return { ok: false, error: "wallet_required" };

  // Clamped here (not just trusted from the caller) — never below the 1 free
  // vote every eligible wallet gets, never above the hard cap.
  const safeWeight = Math.min(MAX_TOTAL_WEIGHT, Math.max(1, Math.round(Number(weight) || 1)));

  const votes = readAllVotes();
  if (!votes[proposal.id]) votes[proposal.id] = {};

  // ONE VOTE PER PERSON (2026-08-20).
  //
  // Votes are keyed by wallet, which was one-per-person for as long as an
  // identity could only have one verified wallet at a time. That stopped being
  // true when multi-wallet verification shipped: without this, someone could
  // verify three wallets and cast three votes on the same proposal, each one
  // passing every check because each wallet is genuinely eligible.
  //
  // So an existing vote from the SAME Discord account under a different wallet
  // is treated as the same voter changing their mind: the old record is
  // removed and replaced under the new wallet, keeping the original castAtIso.
  // The alternative — refusing the second wallet outright — would strand
  // someone who verified a new wallet and retired the old one.
  //
  // An empty discordUserId cannot be deduped and must not be: matching "" to ""
  // would collapse every anonymous vote into one. Those stay per-wallet, which
  // is the behaviour that existed before.
  // COMPARED AT THE USER LEVEL (2026-08-22). One person can hold several
  // accounts — a Discord login and an X login are two doors, one voter — and a
  // vote cast through one door before those accounts were joined is still
  // stored under that door's id. Comparing the raw ids would have let the same
  // person's two accounts vote twice on one proposal, which is exactly the
  // faucet's double-claim bug wearing a governance hat.
  const voterId = String(discordUserId || "");
  const voterUser = voterId ? resolveAccountId(voterId) : "";
  let priorFromSameVoter = null;
  if (voterId) {
    for (const [address, vote] of Object.entries(votes[proposal.id])) {
      const other = String(vote?.discordUserId || "");
      if (address !== walletAddress && other && resolveAccountId(other) === voterUser) {
        priorFromSameVoter = { address, vote };
        break;
      }
    }
  }
  if (priorFromSameVoter) delete votes[proposal.id][priorFromSameVoter.address];

  const existing = votes[proposal.id][walletAddress] || priorFromSameVoter?.vote || null;
  const record = {
    choice,
    weight: safeWeight,
    discordUserId: String(discordUserId || ""),
    castAtIso: existing?.castAtIso || nowIso(),
    updatedAtIso: nowIso(),
  };
  votes[proposal.id][walletAddress] = record;
  writeAllVotes(votes);

  return { ok: true, vote: { choice: record.choice, weight: record.weight, castAtIso: record.castAtIso, updatedAtIso: record.updatedAtIso } };
}

/** Read-only — a single wallet's own vote on one proposal (never another wallet's). */
function getWalletVote(proposalId, walletAddress) {
  if (!walletAddress) return null;
  const votes = readAllVotes();
  return votes[proposalId]?.[walletAddress] || null;
}

/**
 * Server-calculated, aggregate-only results. Never returns a per-wallet
 * choice mapping — that would violate the private-individual-choice /
 * public-aggregate privacy rule. Callers that need "did wallet X vote"
 * must call getWalletVote() for that ONE wallet specifically (used only
 * for the "my vote" endpoint, scoped to the authenticated caller).
 */
function computeResults(proposal) {
  if (!proposal) return null;
  const votes = readAllVotes()[proposal.id] || {};
  const entries = Object.values(votes);
  const votesByChoice = {};
  const weightByChoice = {};
  for (const choice of proposal.choices || []) {
    votesByChoice[choice] = 0;
    weightByChoice[choice] = 0;
  }
  for (const entry of entries) {
    const weight = Math.max(1, Number(entry.weight) || 1);
    votesByChoice[entry.choice] = (votesByChoice[entry.choice] || 0) + 1;
    weightByChoice[entry.choice] = (weightByChoice[entry.choice] || 0) + weight;
  }
  // Deliberate split (2026-07-28 capped pay-per-vote weight): quorum still
  // measures PARTICIPATION (distinct wallets that voted) regardless of how
  // much weight any of them bought — a low-turnout vote can't pass just
  // because one whale bought max weight. The outcome itself (percentages,
  // approval) reflects total WEIGHT instead, which is the whole point of
  // letting a vote be weighted at all. See src/mole/governanceVoteCredits.js.
  const totalEligibleVotesCast = entries.length;
  const totalWeightCast = entries.reduce((sum, e) => sum + Math.max(1, Number(e.weight) || 1), 0);

  const percentByChoice = {};
  for (const [choice, weight] of Object.entries(weightByChoice)) {
    percentByChoice[choice] = totalWeightCast > 0 ? Number(((weight / totalWeightCast) * 100).toFixed(2)) : 0;
  }

  const minVotesForQuorum = Number(proposal.quorumRule?.minVotes || 0);
  const quorumMet = totalEligibleVotesCast >= minVotesForQuorum;

  const threshold = computeApprovalThreshold(proposal);
  const topChoice = Object.entries(weightByChoice).sort((a, b) => b[1] - a[1])[0];
  const topChoiceShare = totalWeightCast > 0 && topChoice ? topChoice[1] / totalWeightCast : 0;
  const approvalPassed = quorumMet && topChoiceShare > threshold;

  return {
    totalEligibleVotesCast,
    totalWeightCast,
    votesByChoice,
    weightByChoice,
    percentByChoice,
    quorumMet,
    quorumMinVotes: minVotesForQuorum,
    approvalThreshold: threshold,
    approvalPassed,
    weightingMethod: proposal.votingMethod,
    dataLastUpdatedIso: nowIso(),
  };
}

/** Re-fetches the live proposal + live results together, by id. */
function getLiveProposalResults(id, proposals) {
  const proposal = getProposalById(id, proposals);
  if (!proposal) return null;
  return computeResults(proposal);
}

export {
  castVote,
  getWalletVote,
  computeResults,
  getLiveProposalResults,
  readAllVotes,
};
