// WinLEW Governance Module v1 — proposal model, categories, lifecycle rules,
// and canonical v1 configuration. Single source of truth for /governance/.
// See docs/governance-v1.md for the full rules document this file
// implements. Static data only (proposals are maintainer-published records,
// same pattern as burnEvents.js/partnersData.js/eventsData.js) — mutable
// vote state lives separately in governanceStore.js, which is backed by
// src/mole/storage.js (the same Mongo-synced JSON pattern sessions/wallet
// links already use), not this file.
//
// Governance v1 does not execute anything. No signing, no treasury access,
// no burn execution exists anywhere in this module — see the "Execution
// boundaries" section of docs/governance-v1.md.

export const PROPOSAL_CATEGORIES = Object.freeze({
  COMMUNITY: "community",
  FEATURES: "features",
  QUIZ: "quiz",
  FAUCET: "faucet",
  GAMES: "games",
  EVENTS: "events",
  REWARDS: "rewards",
  PROOF_OF_VALUE: "proof-of-value",
  BURN_PROGRAM: "burn-program",
  TREASURY_ALLOCATION: "treasury-allocation",
  PARTNERSHIPS: "partnerships",
  GRANTS: "grants",
  GOVERNANCE_RULES: "governance-rules",
  PLATFORM_POLICY: "platform-policy",
});

export const GOVERNANCE_MODES = Object.freeze({
  ADVISORY: "advisory",
  COMMUNITY_APPROVED: "community-approved",
  MAINTAINER_RATIFIED: "maintainer-ratified",
  BINDING_WITHIN_POLICY: "binding-within-defined-policy",
});

export const PROPOSAL_STATUSES = Object.freeze({
  DRAFT: "draft",
  REVIEW: "review",
  DISCUSSION: "discussion",
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  PASSED: "passed",
  REJECTED: "rejected",
  QUORUM_NOT_MET: "quorum-not-met",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  AWAITING_RATIFICATION: "awaiting-ratification",
  APPROVED_FOR_EXECUTION: "approved-for-execution",
  EXECUTING: "executing",
  EXECUTED: "executed",
  EXECUTION_FAILED: "execution-failed",
  SUPERSEDED: "superseded",
  ARCHIVED: "archived",
});

// Explicit allowed transitions — a proposal may never jump silently between
// states. Every write path in governanceStore.js/web.js must check this
// before changing a proposal's status field (v1 proposals are maintainer-
// edited records, so this mostly guards accidental/scripted misuse, but the
// rule is enforced in code, not just documented).
const S = PROPOSAL_STATUSES;
export const VALID_STATUS_TRANSITIONS = Object.freeze({
  [S.DRAFT]: [S.REVIEW, S.CANCELLED],
  [S.REVIEW]: [S.DISCUSSION, S.CANCELLED, S.DRAFT],
  [S.DISCUSSION]: [S.SCHEDULED, S.CANCELLED],
  [S.SCHEDULED]: [S.ACTIVE, S.CANCELLED],
  [S.ACTIVE]: [S.PASSED, S.REJECTED, S.QUORUM_NOT_MET, S.CANCELLED, S.EXPIRED],
  [S.PASSED]: [S.AWAITING_RATIFICATION, S.APPROVED_FOR_EXECUTION, S.ARCHIVED, S.SUPERSEDED],
  [S.REJECTED]: [S.ARCHIVED],
  [S.QUORUM_NOT_MET]: [S.ARCHIVED, S.SCHEDULED],
  [S.CANCELLED]: [S.ARCHIVED],
  [S.EXPIRED]: [S.ARCHIVED],
  [S.AWAITING_RATIFICATION]: [S.APPROVED_FOR_EXECUTION, S.REJECTED, S.ARCHIVED],
  [S.APPROVED_FOR_EXECUTION]: [S.EXECUTING, S.ARCHIVED],
  [S.EXECUTING]: [S.EXECUTED, S.EXECUTION_FAILED],
  [S.EXECUTED]: [S.ARCHIVED],
  [S.EXECUTION_FAILED]: [S.APPROVED_FOR_EXECUTION, S.ARCHIVED],
  [S.SUPERSEDED]: [S.ARCHIVED],
  [S.ARCHIVED]: [],
});

// Statuses where voting is actually open. Used by governanceStore.js to
// reject a vote outside the active window, and by the frontend to decide
// whether to show a ballot or a closed/read-only state.
export const VOTABLE_STATUSES = Object.freeze([S.ACTIVE]);

// Terminal/closed statuses whose results are final and archived, never
// deleted — governance credibility requires preserving unsuccessful
// decisions too (rejected, quorum-not-met, cancelled, expired all included).
export const CLOSED_STATUSES = Object.freeze([
  S.PASSED, S.REJECTED, S.QUORUM_NOT_MET, S.CANCELLED, S.EXPIRED,
  S.AWAITING_RATIFICATION, S.APPROVED_FOR_EXECUTION, S.EXECUTING,
  S.EXECUTED, S.EXECUTION_FAILED, S.SUPERSEDED, S.ARCHIVED,
]);

export const AUTHOR_TYPES = Object.freeze({
  MAINTAINER: "maintainer",
  COMMUNITY_MEMBER: "community-member",
  SYSTEM: "system",
});

export const EXECUTION_STATUSES = Object.freeze({
  NOT_APPLICABLE: "not-applicable",
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  COMPLETED: "completed",
  FAILED: "failed",
  DECLINED: "declined",
});

// ── Canonical v1 configuration — the ONE place these numbers live. Never
// hardcode a threshold/quorum default anywhere else (frontend, routes). ──
export const GOVERNANCE_CONFIG = Object.freeze({
  version: "v1",
  // Eligibility: authenticated WinLEW user + verified linked wallet +
  // currently holds at least this many WinLEW (display units, not base
  // units — compared directly against getOwnerTokenSnapshot().winlewBalance,
  // which is already a ui-amount float from web3.js's parsed token account).
  // 2026-08-06 — THE GATE IS SPLIT IN TWO. History, because the two numbers
  // below only make sense together:
  //   • Until 2026-07-17 this was 1. "Verify your wallet and you get a free
  //     vote" was therefore effectively true, and it was deliberate — the
  //     free vote was the INCENTIVE to verify.
  //   • On 2026-07-17 it was raised to 1,000,000 at the owner's request, to
  //     make the bar meaningful rather than a formality. Correct on its own
  //     terms, but it silently removed that incentive for every holder under
  //     a million tokens, and left published copy promising something the
  //     code no longer did.
  //   • Splitting it keeps both intents instead of trading one for the other:
  //     verifying earns your voice back, and 1,000,000 still means something
  //     — it is now what gates AMPLIFYING that voice.
  //
  // The free vote. Any verified wallet holding a real (non-zero) balance gets
  // exactly one vote, which is the whole of "one-wallet-one-vote" below.
  minWinlewToVote: 1,
  // Buying additional weight on top of that free vote (see
  // resolveVoteWeightInfo in src/mole/web.js and governanceVoteCredits.js)
  // requires holding this much. Purchased weight is paid for with governance
  // contributions and is separately capped at MAX_PURCHASED_VOTES_PER_PROPOSAL,
  // so this is a third, independent limit: a small holder always has a voice,
  // and only a committed holder can raise theirs — never past the cap.
  minWinlewToPurchaseVotes: 1_000_000,
  // Voting method: one verified wallet = one vote. No token-weighting in
  // v1 — see docs/governance-v1.md's "Token snapshot decision" section for
  // why (no historical-balance snapshot infrastructure exists in this
  // repository, and unlimited token-weighted voting risks one large holder
  // trivially controlling every decision, which this project does not want
  // as an unexamined default).
  votingMethod: "one-wallet-one-vote",
  // v1.1: each proposal locks in a wallet's eligibility at its first
  // successful check at/after the proposal's snapshot boundary (see
  // resolveSnapshotBoundaryIso() below and src/mole/governanceSnapshot.js)
  // — narrower than a full chain-wide historical snapshot, but no longer
  // "current balance only" either. See docs/governance-v1.1-hardening.md.
  snapshotMethod: "per-proposal-boundary-first-check-lock-in",
  // Vote privacy default: individual choice private, aggregate public.
  voteChoicePrivacy: "private-until-never", // individual choices are never made public, even after close
  // Vote-change rule: a voter may update their choice until voting closes;
  // the latest valid choice replaces the prior one. Not "final on first
  // submit," not "withdrawable to no-vote" — always exactly one current
  // choice per wallet while voting is open.
  voteChangeRule: "may-update-until-close",
  // Approval thresholds (fraction of valid votes cast, not fraction of all
  // eligible holders — quorum is the turnout gate; threshold is the
  // outcome gate).
  defaultApprovalThreshold: 0.5, // "greater than 50%"
  governanceRuleChangeApprovalThreshold: 2 / 3,
  // Quorum is proposal-specific and stored on the proposal itself
  // (quorumRule.minVotes) — this file does not invent a default quorum
  // number, since "invent a percentage of all holders" is explicitly
  // disallowed when total-holder-count data isn't reliably available here.
});

function computeApprovalThreshold(proposal) {
  if (proposal?.approvalThresholdOverride != null) return Number(proposal.approvalThresholdOverride);
  if (proposal?.category === PROPOSAL_CATEGORIES.GOVERNANCE_RULES) return GOVERNANCE_CONFIG.governanceRuleChangeApprovalThreshold;
  return GOVERNANCE_CONFIG.defaultApprovalThreshold;
}

// v1.1 — the point-in-time eligibility boundary. A proposal may set its own
// `snapshotAtIso`; if absent, the natural default is the moment voting
// itself opens (votingStartIso). Before this boundary, any eligibility
// check is a live, non-binding preview — see governanceSnapshot.js for the
// actual lock-in logic. Pure — never touches storage.
function resolveSnapshotBoundaryIso(proposal) {
  return proposal?.snapshotAtIso || proposal?.votingStartIso || null;
}

function isValidStatusTransition(from, to) {
  if (from === to) return true; // idempotent no-op write is allowed
  const allowed = VALID_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Pure — required fields, valid enum values, sane date ordering, valid
 * voting choices, and the anti-unsupported-claim pattern used everywhere
 * else in this codebase: a CLOSED status must carry final results data,
 * an EXECUTED status must carry execution evidence.
 */
function validateProposalRecord(proposal) {
  const errors = [];
  if (!proposal?.id) errors.push("missing_id");
  if (!proposal?.schemaVersion) errors.push("missing_schema_version");
  if (!proposal?.title) errors.push("missing_title");
  if (!proposal?.summary) errors.push("missing_summary");
  if (!Object.values(PROPOSAL_CATEGORIES).includes(proposal?.category)) errors.push("invalid_category");
  if (!Object.values(GOVERNANCE_MODES).includes(proposal?.governanceMode)) errors.push("invalid_governance_mode");
  if (!Object.values(PROPOSAL_STATUSES).includes(proposal?.status)) errors.push("invalid_status");
  if (!Object.values(AUTHOR_TYPES).includes(proposal?.authorType)) errors.push("invalid_author_type");

  // Choices are only required for a record that was actually opened for a
  // vote (votingStartIso set). A purely informational/milestone record
  // (votingStartIso: null) isn't forced to pretend it had a ballot — this
  // is the "do not require irrelevant fields for simple records" rule
  // applied to the one field that would otherwise force every record to
  // fake a 2-choice vote it never held.
  const choices = proposal?.choices;
  if (proposal?.votingStartIso) {
    if (!Array.isArray(choices) || choices.length < 2) errors.push("invalid_choices");
    if (Array.isArray(choices) && new Set(choices).size !== choices.length) errors.push("duplicate_choices");
  } else if (choices !== undefined && choices !== null && !Array.isArray(choices)) {
    errors.push("invalid_choices");
  }

  if (proposal?.votingStartIso && proposal?.votingEndIso) {
    const start = Date.parse(proposal.votingStartIso);
    const end = Date.parse(proposal.votingEndIso);
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) errors.push("voting_end_before_start");
  }

  if (CLOSED_STATUSES.includes(proposal?.status)) {
    if (!proposal?.finalResults) errors.push("closed_status_requires_final_results");
  }
  if (proposal?.status === S.EXECUTED) {
    const evidenceCount = (proposal?.executionEvidence || []).length;
    if (evidenceCount === 0) errors.push("executed_status_requires_evidence");
  }
  if (proposal?.category === PROPOSAL_CATEGORIES.BURN_PROGRAM) {
    if (!proposal?.burnDetails) errors.push("burn_category_requires_burn_details");
  }

  // Content-safety floor: reject obviously-unsafe raw HTML in free-text
  // fields at the data-model level too (defense in depth — the render
  // layer must escape everything regardless, see governance/js/app.js).
  const textFields = [proposal?.title, proposal?.summary, proposal?.fullDescription];
  for (const field of textFields) {
    if (typeof field === "string" && /<script/i.test(field)) errors.push("unsafe_content_detected");
  }

  return { ok: errors.length === 0, errors };
}

function findDuplicateProposalIds(proposals = PROPOSALS) {
  const seen = new Set();
  const duplicates = new Set();
  for (const p of proposals) {
    if (seen.has(p.id)) duplicates.add(p.id);
    seen.add(p.id);
  }
  return Array.from(duplicates);
}

function getProposalById(id, proposals = PROPOSALS) {
  return proposals.find((p) => p.id === id) || null;
}

function proposalNeedsFinalResults(status) {
  return CLOSED_STATUSES.includes(status);
}

// ── Seeded proposals — real records only, per the explicit "do not
// fabricate a governance history" instruction. Exactly one record:
// the Governance Launch itself, an informational/completed platform
// milestone, not a vote that never happened. ──
export const PROPOSALS = [
  {
    id: "gov-launch-2026",
    schemaVersion: 1,
    title: "Governance Module v1 Launch",
    summary: "The permanent, public record of WinLEW community decisions begins here — Governance Module v1 shipped as an original-roadmap Phase 5 milestone.",
    fullDescription:
      "This record documents the launch of /governance/ itself, not a vote. Governance Module v1 gives verified $WinLEW holders a structured, server-verified way to view proposals, discuss them through the existing Discord, and cast a vote on future community/feature/reward/burn-program proposals. No treasury or burn transaction is executed by any vote in v1 — approved proposals move to a maintainer safety-review and manual-execution step, with the outcome and any execution evidence recorded permanently here. See docs/governance-v1.md for the full rules.",
    author: "WinLEW maintainers",
    authorType: AUTHOR_TYPES.MAINTAINER,
    category: PROPOSAL_CATEGORIES.GOVERNANCE_RULES,
    governanceMode: GOVERNANCE_MODES.MAINTAINER_RATIFIED,
    status: PROPOSAL_STATUSES.EXECUTED,
    createdIso: "2026-07-20T00:00:00Z",
    discussionStartIso: "2026-07-20T00:00:00Z",
    votingStartIso: null,
    votingEndIso: null,
    executionDeadlineIso: null,
    eligibilityRule: {
      authenticatedUser: true,
      verifiedWallet: true,
      minWinlewBalance: GOVERNANCE_CONFIG.minWinlewToVote,
      proposalSpecificOverride: null,
    },
    votingMethod: GOVERNANCE_CONFIG.votingMethod,
    choices: null,
    quorumRule: { type: "not-applicable", minVotes: 0 },
    approvalThresholdOverride: null,
    snapshotRule: GOVERNANCE_CONFIG.snapshotMethod,
    supportingEvidence: [
      { label: "Governance rules (docs/governance-v1.md)", url: "/governance/#rules" },
    ],
    relatedPlatformPages: ["/governance/", "/burn/", "/verify/profile.html"],
    financialImpact: "None — no treasury funds move as a result of this record.",
    tokenImpact: "None.",
    securityConsiderations: "No signing, treasury access, or burn-execution capability exists anywhere in Governance v1. See docs/governance-v1.md's Execution Boundaries section.",
    risks: "None specific to this launch record.",
    alternativesConsidered: "Considered launching with a binding, token-weighted voting system from day one — rejected in favor of an advisory-first, one-wallet-one-vote v1 to avoid unexamined plutocracy and to build a real trust record before anything becomes binding.",
    implementationPlan: "Shipped in this milestone — see the Git section of the accompanying sprint report for exact commits.",
    maintainerPosition: "This is a platform milestone record, not a proposal open for community vote.",
    finalResults: {
      totalEligibleVotesCast: 0,
      votesByChoice: {},
      quorumMet: true,
      approvalPassed: true,
      closedAtIso: "2026-07-20T00:00:00Z",
    },
    finalDecision: "Completed platform milestone.",
    executionStatus: EXECUTION_STATUSES.COMPLETED,
    executionEvidence: [
      { label: "Governance v1 rules document", url: "/governance/#rules" },
    ],
    cancellationOrRejectionReason: null,
    lastUpdatedIso: "2026-07-20T00:00:00Z",
    publicNotes: "This is a platform-milestone record (status: informational/completed), not an open community vote — see docs/governance-v1.md.",
    burnDetails: null,
    discussionUrl: "/community/",
    metadata: {},
  },
];

export {
  computeApprovalThreshold,
  isValidStatusTransition,
  validateProposalRecord,
  findDuplicateProposalIds,
  getProposalById,
  proposalNeedsFinalResults,
  resolveSnapshotBoundaryIso,
};
