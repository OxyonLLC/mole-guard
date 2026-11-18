// WinLEW Governance v1.1 — community proposal submission review queue.
//
// This is a REVIEW QUEUE ONLY. Nothing in this file can ever cause a
// submission to become a canonical, votable proposal — that set
// (governanceData.js's PROPOSALS array) is still maintainer-edited static
// data, exactly as in v1. A submission reaching "approved-for-drafting" is
// a maintainer's signal that they intend to hand-author a real proposal
// from it; publishing that proposal is a separate, explicit, out-of-band
// maintainer action (editing governanceData.js) that this module has no
// path to trigger. See docs/governance-v1.1-hardening.md.
//
// Backed by src/mole/storage.js's Mongo-synced managed-JSON pattern, same
// as governanceStore.js's votes — see 'governance_submissions.json' in
// storage.js's MANAGED_JSON.
import { readJson, writeJson } from "./storage.js";
import { PROPOSAL_CATEGORIES, GOVERNANCE_MODES } from "./governanceData.js";

const SUBMISSIONS_FILE = "governance_submissions.json";

export const SUBMISSION_STATUSES = Object.freeze({
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under-review",
  REVISION_REQUESTED: "revision-requested",
  APPROVED_FOR_DRAFTING: "approved-for-drafting",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
  ARCHIVED: "archived",
});

const T = SUBMISSION_STATUSES;
// A submission's lifecycle is a one-way ratchet toward a terminal state —
// no path here ever sets `published` or touches PROPOSALS (see module
// header). approved-for-drafting is itself terminal FROM THIS QUEUE'S
// point of view: the next step (writing and publishing a real proposal)
// happens entirely outside this file.
export const VALID_SUBMISSION_TRANSITIONS = Object.freeze({
  [T.SUBMITTED]: [T.UNDER_REVIEW, T.WITHDRAWN],
  [T.UNDER_REVIEW]: [T.REVISION_REQUESTED, T.APPROVED_FOR_DRAFTING, T.REJECTED, T.ARCHIVED],
  [T.REVISION_REQUESTED]: [T.UNDER_REVIEW, T.WITHDRAWN],
  [T.APPROVED_FOR_DRAFTING]: [T.ARCHIVED],
  [T.REJECTED]: [T.ARCHIVED],
  [T.WITHDRAWN]: [T.ARCHIVED],
  [T.ARCHIVED]: [],
});

export function isValidSubmissionTransition(from, to) {
  return Array.isArray(VALID_SUBMISSION_TRANSITIONS[from]) && VALID_SUBMISSION_TRANSITIONS[from].includes(to);
}

// Reasons are mandatory for any action a submitter would need to act on.
const REASON_REQUIRED_FOR = new Set([T.REVISION_REQUESTED, T.REJECTED]);

const FIELD_LIMITS = Object.freeze({
  title: 200,
  summary: 1000,
  problem: 3000,
  proposedOutcome: 3000,
  communityBenefit: 1500,
  affectedSystems: 1000,
  risks: 1500,
  alternatives: 1500,
  supportingEvidence: 2000,
});

const REQUIRED_FIELDS = Object.freeze(["title", "category", "summary", "problem", "proposedOutcome", "requestedGovernanceMode"]);
const OPTIONAL_FIELDS = Object.freeze(["communityBenefit", "affectedSystems", "risks", "alternatives", "supportingEvidence"]);
const ALL_TEXT_FIELDS = Object.freeze([...REQUIRED_FIELDS.filter((f) => f !== "category" && f !== "requestedGovernanceMode"), ...OPTIONAL_FIELDS]);

// Pattern-based, not a guarantee — see docs/governance-v1.1-hardening.md's
// "what this does not guarantee" section. Rejects outright rather than
// silently stripping: a submission that trips one of these is bounced back
// to the author with a specific reason, never partially accepted.
const UNSAFE_CONTENT_PATTERNS = Object.freeze([
  { re: /<\s*[a-zA-Z][^>]*>/, reason: "raw_html_not_allowed" },
  { re: /javascript\s*:/i, reason: "executable_link_not_allowed" },
  { re: /data\s*:\s*text\/html/i, reason: "executable_link_not_allowed" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i, reason: "private_key_not_allowed" },
  { re: /\bseed\s*phrase\b|\brecovery\s*phrase\b|\bmnemonic\s*phrase\b/i, reason: "seed_phrase_not_allowed" },
  { re: /\b(?:api|secret)[\s_-]?key\b\s*[:=]/i, reason: "api_secret_not_allowed" },
  { re: /\[\s*(?:\d{1,3}\s*,\s*){50,}\d{1,3}\s*\]/, reason: "possible_private_key_bytes_not_allowed" },
  { re: /\b[1-9A-HJ-NP-Za-km-z]{80,}\b/, reason: "possible_private_key_blob_not_allowed" },
  { re: /\btreasury\s+(?:wallet|address|transfer|withdrawal)\s+(?:instruction|command)/i, reason: "treasury_instruction_not_allowed" },
  { re: /\bexecute\s+(?:the\s+)?burn\b|\btrigger\s+(?:the\s+)?burn\b/i, reason: "automatic_burn_instruction_not_allowed" },
]);

function nowIso() {
  return new Date().toISOString();
}

function readAllSubmissions() {
  return readJson(SUBMISSIONS_FILE, {});
}

function writeAllSubmissions(submissions) {
  writeJson(SUBMISSIONS_FILE, submissions);
}

function synthId() {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function findUnsafeContent(fields) {
  for (const key of ALL_TEXT_FIELDS) {
    const value = String(fields[key] || "");
    for (const { re, reason } of UNSAFE_CONTENT_PATTERNS) {
      if (re.test(value)) return { field: key, reason };
    }
  }
  return null;
}

/**
 * Validates field presence, type, and length limits. Returns
 * { ok: true, cleaned } or { ok: false, error, field }. Does not touch
 * storage — pure, so it's independently testable.
 */
export function validateSubmissionFields(fields) {
  if (!fields || typeof fields !== "object") return { ok: false, error: "invalid_payload" };

  for (const key of REQUIRED_FIELDS) {
    if (!String(fields[key] || "").trim()) return { ok: false, error: "missing_required_field", field: key };
  }

  if (!Object.values(PROPOSAL_CATEGORIES).includes(fields.category)) {
    return { ok: false, error: "invalid_category", field: "category" };
  }
  if (!Object.values(GOVERNANCE_MODES).includes(fields.requestedGovernanceMode)) {
    return { ok: false, error: "invalid_governance_mode", field: "requestedGovernanceMode" };
  }

  const cleaned = { category: fields.category, requestedGovernanceMode: fields.requestedGovernanceMode };
  for (const key of ALL_TEXT_FIELDS) {
    const raw = fields[key] == null ? "" : String(fields[key]);
    const trimmed = raw.trim();
    const limit = FIELD_LIMITS[key];
    if (limit && trimmed.length > limit) {
      return { ok: false, error: "field_too_long", field: key, limit };
    }
    cleaned[key] = trimmed;
  }

  const unsafe = findUnsafeContent(cleaned);
  if (unsafe) return { ok: false, error: unsafe.reason, field: unsafe.field };

  return { ok: true, cleaned };
}

const MAX_OPEN_SUBMISSIONS_PER_USER = 5;
const DUPLICATE_TITLE_WINDOW_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set([T.SUBMITTED, T.UNDER_REVIEW, T.REVISION_REQUESTED]);

function normalizeTitleForDedup(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Creates a new submission draft. Identity (discordUserId, wallet) must
 * already be server-resolved by the caller (session + verified linked
 * wallet) — this function never trusts a client-supplied identity, same
 * discipline as castVote()/resolveGovernanceEligibility().
 *
 * Synchronous read-check-write with no `await` in between — same
 * same-process race-safety reasoning as castVote() in governanceStore.js.
 */
export function createSubmission({ discordUserId, wallet, fields }) {
  if (!discordUserId) return { ok: false, error: "identity_required" };
  if (!wallet) return { ok: false, error: "verified_wallet_required" };

  const validation = validateSubmissionFields(fields);
  if (!validation.ok) return validation;

  const submissions = readAllSubmissions();
  const mine = Object.values(submissions).filter((s) => String(s.discordUserId) === String(discordUserId));

  const openCount = mine.filter((s) => OPEN_STATUSES.has(s.status)).length;
  if (openCount >= MAX_OPEN_SUBMISSIONS_PER_USER) {
    return { ok: false, error: "too_many_open_submissions" };
  }

  const normalizedTitle = normalizeTitleForDedup(validation.cleaned.title);
  const nowMs = Date.now();
  const isDuplicate = mine.some((s) => {
    if (normalizeTitleForDedup(s.title) !== normalizedTitle) return false;
    return nowMs - Date.parse(s.submittedAtIso) < DUPLICATE_TITLE_WINDOW_MS;
  });
  if (isDuplicate) return { ok: false, error: "duplicate_submission" };

  const id = synthId();
  const submittedAtIso = nowIso();
  const record = {
    id,
    discordUserId: String(discordUserId),
    wallet: String(wallet),
    ...validation.cleaned,
    status: T.SUBMITTED,
    published: false,
    submittedAtIso,
    updatedAtIso: submittedAtIso,
    statusHistory: [{ status: T.SUBMITTED, atIso: submittedAtIso, byDiscordUserId: String(discordUserId), reason: null }],
  };

  submissions[id] = record;
  writeAllSubmissions(submissions);
  return { ok: true, submission: record };
}

/** Owner-only detail lookup — caller must separately verify ownership before exposing this. */
export function getSubmissionById(id) {
  if (!id) return null;
  const submissions = readAllSubmissions();
  return submissions[id] || null;
}

/** The authenticated caller's own submissions — every field, since it's their own draft. */
export function listSubmissionsByOwner(discordUserId) {
  if (!discordUserId) return [];
  const submissions = readAllSubmissions();
  return Object.values(submissions)
    .filter((s) => String(s.discordUserId) === String(discordUserId))
    .sort((a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso));
}

/** Maintainer-only — every submission, every field. Route layer must gate this behind isGovernanceMaintainer(). */
export function listAllSubmissions() {
  const submissions = readAllSubmissions();
  return Object.values(submissions).sort((a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso));
}

/**
 * A maintainer moderation action. Requires a `reason` for
 * revision-requested/rejected (the two outcomes a submitter needs to act
 * on or understand). Every call appends an immutable statusHistory entry —
 * this is the audit trail, not just the latest status.
 */
export function reviewSubmission({ id, toStatus, byDiscordUserId, reason = null }) {
  if (!byDiscordUserId) return { ok: false, error: "identity_required" };
  const submissions = readAllSubmissions();
  const record = submissions[id];
  if (!record) return { ok: false, error: "submission_not_found" };

  if (!isValidSubmissionTransition(record.status, toStatus)) {
    return { ok: false, error: "invalid_transition" };
  }
  if (REASON_REQUIRED_FOR.has(toStatus) && !String(reason || "").trim()) {
    return { ok: false, error: "reason_required" };
  }

  const atIso = nowIso();
  record.status = toStatus;
  record.updatedAtIso = atIso;
  record.statusHistory.push({ status: toStatus, atIso, byDiscordUserId: String(byDiscordUserId), reason: reason ? String(reason).trim() : null });

  submissions[id] = record;
  writeAllSubmissions(submissions);
  return { ok: true, submission: record };
}

/** Owner withdraws their own still-open submission. Never usable on someone else's. */
export function withdrawSubmission({ id, discordUserId }) {
  const submissions = readAllSubmissions();
  const record = submissions[id];
  if (!record) return { ok: false, error: "submission_not_found" };
  if (String(record.discordUserId) !== String(discordUserId)) return { ok: false, error: "not_owner" };
  if (!isValidSubmissionTransition(record.status, T.WITHDRAWN)) {
    return { ok: false, error: "invalid_transition" };
  }

  const atIso = nowIso();
  record.status = T.WITHDRAWN;
  record.updatedAtIso = atIso;
  record.statusHistory.push({ status: T.WITHDRAWN, atIso, byDiscordUserId: String(discordUserId), reason: null });

  submissions[id] = record;
  writeAllSubmissions(submissions);
  return { ok: true, submission: record };
}

export { readAllSubmissions, FIELD_LIMITS, REQUIRED_FIELDS, OPTIONAL_FIELDS };
