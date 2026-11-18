// Governance purchased-vote-weight ledger (2026-07-28) — direct precedent:
// src/quiz/db.js's drawDownOpenCyclePoints(), which exists specifically
// because a shared pool being drawn down across multiple "spends" is a real
// bug class this codebase has already hit once (the 2026-07-18 double-
// payout fix). The shape here is identical: a user's lifetime
// `governance`-cause contribution total (src/mole/contributions.js,
// getUserContributionSummary().byCause.governance) is a single shared pool
// that must never be countable as purchased vote weight on two different
// proposals at once.
//
// Design: rather than an append-only "spend log," each wallet's record
// tracks how much of their lifetime contribution is currently ALLOCATED to
// each proposal. Re-allocating a proposal always recomputes from the
// wallet's CURRENT total contribution minus whatever's allocated to OTHER
// proposals — so a top-up is picked up automatically (more unspent pool to
// allocate from), and funds already committed elsewhere are correctly
// excluded. Every function here is fully synchronous, start to finish, no
// `await` between read and write — the same property governanceStore.js's
// castVote() relies on for its own race-safety (Node's single-threaded
// event loop can't interleave another request's code inside a function
// that never yields), confirmed via that file's own concurrent-write tests.
import { readJson, writeJson } from "./storage.js";
import { MAX_PURCHASED_VOTES_PER_PROPOSAL } from "./governancePricing.js";

const CREDITS_FILE = "governance_vote_credits.json";

function readAllCredits() {
  return readJson(CREDITS_FILE, {});
}

function writeAllCredits(credits) {
  writeJson(CREDITS_FILE, credits);
}

/**
 * Recomputes and locks in this wallet's purchased vote weight for one
 * proposal, given their current lifetime governance-cause contribution
 * total (in WinLEW display units) and the current WinLEW-per-vote price.
 * Synchronous, single read-modify-write — safe under concurrent calls for
 * the same reason castVote() is.
 */
export function allocateVoteWeight(discordUserId, proposalId, { totalContributedWinlew, winlewPerVote }) {
  const userId = String(discordUserId || "");
  const propId = String(proposalId || "");
  const total = Math.max(0, Number(totalContributedWinlew) || 0);
  const pricePerVote = Number(winlewPerVote);
  if (!userId || !propId || !(pricePerVote > 0)) {
    return { purchasedWeight: 0, allocatedWinlew: 0 };
  }

  const credits = readAllCredits();
  const record = credits[userId] || { totalAllocatedWinlew: 0, allocations: {} };
  const previouslyAllocatedHere = Number(record.allocations[propId] || 0);

  // Funds committed to OTHER proposals are off-limits; funds already
  // allocated to THIS proposal are added back before recomputing, so a
  // wallet's total contribution (including anything new since last check)
  // is always what's actually available to (re)allocate here.
  const allocatedElsewhere = Math.max(0, Number(record.totalAllocatedWinlew || 0) - previouslyAllocatedHere);
  const availableForThisProposal = Math.max(0, total - allocatedElsewhere);

  const maxAllocationForCap = MAX_PURCHASED_VOTES_PER_PROPOSAL * pricePerVote;
  const newAllocation = Math.min(availableForThisProposal, maxAllocationForCap);

  record.allocations[propId] = newAllocation;
  record.totalAllocatedWinlew = allocatedElsewhere + newAllocation;
  credits[userId] = record;
  writeAllCredits(credits);

  return {
    purchasedWeight: Math.min(MAX_PURCHASED_VOTES_PER_PROPOSAL, Math.floor(newAllocation / pricePerVote)),
    allocatedWinlew: newAllocation,
  };
}

/** Read-only preview — same computation as allocateVoteWeight() but never writes, for display-only call sites (e.g. showing "N purchased" before a vote is cast). */
export function previewPurchasedWeight(discordUserId, proposalId, { totalContributedWinlew, winlewPerVote }) {
  const userId = String(discordUserId || "");
  const propId = String(proposalId || "");
  const total = Math.max(0, Number(totalContributedWinlew) || 0);
  const pricePerVote = Number(winlewPerVote);
  if (!userId || !propId || !(pricePerVote > 0)) {
    return { purchasedWeight: 0, allocatedWinlew: 0 };
  }

  const credits = readAllCredits();
  const record = credits[userId] || { totalAllocatedWinlew: 0, allocations: {} };
  const previouslyAllocatedHere = Number(record.allocations[propId] || 0);
  const allocatedElsewhere = Math.max(0, Number(record.totalAllocatedWinlew || 0) - previouslyAllocatedHere);
  const availableForThisProposal = Math.max(0, total - allocatedElsewhere);
  const maxAllocationForCap = MAX_PURCHASED_VOTES_PER_PROPOSAL * pricePerVote;
  const allocation = Math.min(availableForThisProposal, maxAllocationForCap);

  return {
    purchasedWeight: Math.min(MAX_PURCHASED_VOTES_PER_PROPOSAL, Math.floor(allocation / pricePerVote)),
    allocatedWinlew: allocation,
  };
}
