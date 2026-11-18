// Governance v1.1 — community proposal submission review queue (gap 2),
// module-level tests. Integration test against the REAL src/mole/storage.js
// -backed governance_submissions.json — same backup/restore discipline as
// governanceStore.test.mjs / governanceSnapshot.test.mjs.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBMISSIONS_PATH = path.resolve(__dirname, '..', '..', 'data', 'governance_submissions.json');
const BACKUP_PATH = `${SUBMISSIONS_PATH}.test-backup`;
let existedBefore = false;

let createSubmission, getSubmissionById, listSubmissionsByOwner, listAllSubmissions,
  reviewSubmission, withdrawSubmission, validateSubmissionFields, SUBMISSION_STATUSES;
const { PROPOSAL_CATEGORIES, GOVERNANCE_MODES } = await import('../../src/mole/governanceData.js');

before(async () => {
  existedBefore = fs.existsSync(SUBMISSIONS_PATH);
  if (existedBefore) fs.copyFileSync(SUBMISSIONS_PATH, BACKUP_PATH);
  const mod = await import('../../src/mole/governanceSubmissions.js');
  ({ createSubmission, getSubmissionById, listSubmissionsByOwner, listAllSubmissions, reviewSubmission, withdrawSubmission, validateSubmissionFields, SUBMISSION_STATUSES } = mod);
});

after(() => {
  if (existedBefore) {
    fs.copyFileSync(BACKUP_PATH, SUBMISSIONS_PATH);
    fs.unlinkSync(BACKUP_PATH);
  } else if (fs.existsSync(SUBMISSIONS_PATH)) {
    fs.unlinkSync(SUBMISSIONS_PATH);
  }
});

function synthUser(label) {
  return `__test_user_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}
function synthWallet(label) {
  return `__test_wallet_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}

function validFields(overrides = {}) {
  return {
    title: `Test proposal ${Date.now()}_${Math.random().toString(16).slice(2)}`,
    category: PROPOSAL_CATEGORIES.COMMUNITY,
    summary: 'A short honest summary.',
    problem: 'The problem this addresses.',
    proposedOutcome: 'The outcome we want.',
    communityBenefit: 'Benefits the whole community.',
    affectedSystems: 'Quiz, Faucet',
    risks: 'Some risk exists.',
    alternatives: 'We considered doing nothing.',
    supportingEvidence: 'See attached community poll.',
    requestedGovernanceMode: GOVERNANCE_MODES.ADVISORY,
    ...overrides,
  };
}

describe('createSubmission — identity requirements', () => {
  test('rejects a missing discordUserId (unauthenticated)', () => {
    const res = createSubmission({ discordUserId: null, wallet: synthWallet('a'), fields: validFields() });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'identity_required');
  });

  test('rejects a missing wallet (unverified wallet)', () => {
    const res = createSubmission({ discordUserId: synthUser('a'), wallet: null, fields: validFields() });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'verified_wallet_required');
  });
});

describe('createSubmission — field validation', () => {
  test('a valid submission succeeds and is a reviewable draft only', () => {
    const discordUserId = synthUser('valid');
    const wallet = synthWallet('valid');
    const res = createSubmission({ discordUserId, wallet, fields: validFields() });
    assert.equal(res.ok, true);
    assert.equal(res.submission.status, SUBMISSION_STATUSES.SUBMITTED);
    assert.equal(res.submission.published, false, 'a fresh submission must never be marked published');
    assert.ok(res.submission.id);
    assert.ok(res.submission.submittedAtIso);
    assert.equal(res.submission.statusHistory.length, 1);
  });

  test('rejects missing required fields', () => {
    const fields = validFields();
    delete fields.problem;
    const res = createSubmission({ discordUserId: synthUser('b'), wallet: synthWallet('b'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'missing_required_field');
    assert.equal(res.field, 'problem');
  });

  test('rejects an oversized field', () => {
    const fields = validFields({ summary: 'x'.repeat(5000) });
    const res = createSubmission({ discordUserId: synthUser('c'), wallet: synthWallet('c'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'field_too_long');
    assert.equal(res.field, 'summary');
  });

  test('rejects raw HTML / script tags', () => {
    const fields = validFields({ problem: 'Look at this <script>alert(1)</script> issue' });
    const res = createSubmission({ discordUserId: synthUser('d'), wallet: synthWallet('d'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'raw_html_not_allowed');
  });

  test('rejects a javascript: executable link', () => {
    const fields = validFields({ supportingEvidence: 'See javascript:alert(document.cookie)' });
    const res = createSubmission({ discordUserId: synthUser('e'), wallet: synthWallet('e'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'executable_link_not_allowed');
  });

  test('rejects a seed phrase request/mention', () => {
    const fields = validFields({ risks: 'Please provide your seed phrase to verify.' });
    const res = createSubmission({ discordUserId: synthUser('f'), wallet: synthWallet('f'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'seed_phrase_not_allowed');
  });

  // secret-scan-ok: pem-private-key — this is a truncated placeholder in a test
  // asserting the app REJECTS pasted private keys. Not a real key.
  test('rejects a private-key PEM block', () => {
    const fields = validFields({ alternatives: '-----BEGIN PRIVATE KEY-----\nMIIBVQ...\n-----END PRIVATE KEY-----' });
    const res = createSubmission({ discordUserId: synthUser('g'), wallet: synthWallet('g'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'private_key_not_allowed');
  });

  test('rejects a treasury execution instruction', () => {
    const fields = validFields({ proposedOutcome: 'Issue a treasury transfer instruction to wallet X.' });
    const res = createSubmission({ discordUserId: synthUser('h'), wallet: synthWallet('h'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'treasury_instruction_not_allowed');
  });

  test('rejects an invalid category', () => {
    const fields = validFields({ category: 'not-a-real-category' });
    const res = createSubmission({ discordUserId: synthUser('i'), wallet: synthWallet('i'), fields });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_category');
  });
});

describe('createSubmission — duplicate/spam protection', () => {
  test('rejects a duplicate title from the same user within the dedup window', () => {
    const discordUserId = synthUser('dup');
    const wallet = synthWallet('dup');
    const fields = validFields();
    const first = createSubmission({ discordUserId, wallet, fields });
    assert.equal(first.ok, true);
    const second = createSubmission({ discordUserId, wallet, fields: { ...fields } });
    assert.equal(second.ok, false);
    assert.equal(second.error, 'duplicate_submission');
  });

  test('a different user submitting the identical title is NOT treated as a duplicate', () => {
    const fields = validFields();
    const userA = synthUser('dup2a');
    const userB = synthUser('dup2b');
    const a = createSubmission({ discordUserId: userA, wallet: synthWallet('dup2a'), fields });
    const b = createSubmission({ discordUserId: userB, wallet: synthWallet('dup2b'), fields: { ...fields } });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });

  test('rejects a new submission once a user has too many open submissions (rate/volume limit)', () => {
    const discordUserId = synthUser('spam');
    const wallet = synthWallet('spam');
    let lastResult;
    for (let i = 0; i < 6; i += 1) {
      lastResult = createSubmission({ discordUserId, wallet, fields: validFields({ title: `Spam title ${i}` }) });
    }
    assert.equal(lastResult.ok, false);
    assert.equal(lastResult.error, 'too_many_open_submissions');
  });
});

describe('ownership and visibility', () => {
  test('listSubmissionsByOwner only returns that user\'s own drafts, never another user\'s', () => {
    const userA = synthUser('vis-a');
    const userB = synthUser('vis-b');
    createSubmission({ discordUserId: userA, wallet: synthWallet('vis-a'), fields: validFields() });
    createSubmission({ discordUserId: userB, wallet: synthWallet('vis-b'), fields: validFields() });
    const ownedByA = listSubmissionsByOwner(userA);
    assert.ok(ownedByA.length >= 1);
    assert.ok(ownedByA.every((s) => s.discordUserId === userA));
  });

  test('getSubmissionById returns the record regardless of caller — route layer must enforce ownership before exposing it', () => {
    const userA = synthUser('vis-c');
    const created = createSubmission({ discordUserId: userA, wallet: synthWallet('vis-c'), fields: validFields() });
    const fetched = getSubmissionById(created.submission.id);
    assert.ok(fetched);
    assert.equal(fetched.discordUserId, userA);
  });
});

describe('reviewSubmission — maintainer actions', () => {
  test('a rejection without a reason is refused', () => {
    const discordUserId = synthUser('rej-noreason');
    const created = createSubmission({ discordUserId, wallet: synthWallet('rej-noreason'), fields: validFields() });
    const underReview = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.UNDER_REVIEW, byDiscordUserId: 'maintainer1' });
    assert.equal(underReview.ok, true);
    const res = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.REJECTED, byDiscordUserId: 'maintainer1' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'reason_required');
  });

  test('a rejection with a reason succeeds and is recorded in the audit history', () => {
    const discordUserId = synthUser('rej-withreason');
    const created = createSubmission({ discordUserId, wallet: synthWallet('rej-withreason'), fields: validFields() });
    reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.UNDER_REVIEW, byDiscordUserId: 'maintainer1' });
    const res = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.REJECTED, byDiscordUserId: 'maintainer1', reason: 'Out of scope for v1.' });
    assert.equal(res.ok, true);
    assert.equal(res.submission.status, SUBMISSION_STATUSES.REJECTED);
    const lastEntry = res.submission.statusHistory.at(-1);
    assert.equal(lastEntry.reason, 'Out of scope for v1.');
    assert.equal(lastEntry.byDiscordUserId, 'maintainer1');
    assert.ok(lastEntry.atIso);
  });

  test('a revision-requested action requires a reason and records it', () => {
    const discordUserId = synthUser('rev');
    const created = createSubmission({ discordUserId, wallet: synthWallet('rev'), fields: validFields() });
    reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.UNDER_REVIEW, byDiscordUserId: 'maintainer1' });
    const noReason = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.REVISION_REQUESTED, byDiscordUserId: 'maintainer1' });
    assert.equal(noReason.ok, false);
    assert.equal(noReason.error, 'reason_required');
    const withReason = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.REVISION_REQUESTED, byDiscordUserId: 'maintainer1', reason: 'Please add more detail on risks.' });
    assert.equal(withReason.ok, true);
    assert.equal(withReason.submission.status, SUBMISSION_STATUSES.REVISION_REQUESTED);
  });

  test('rejects an invalid/skipped transition (e.g. submitted straight to approved-for-drafting)', () => {
    const discordUserId = synthUser('skip');
    const created = createSubmission({ discordUserId, wallet: synthWallet('skip'), fields: validFields() });
    const res = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.APPROVED_FOR_DRAFTING, byDiscordUserId: 'maintainer1' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_transition');
  });

  test('approved-for-drafting never sets `published` — publication is a separate, out-of-band maintainer action', () => {
    const discordUserId = synthUser('approve');
    const created = createSubmission({ discordUserId, wallet: synthWallet('approve'), fields: validFields() });
    reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.UNDER_REVIEW, byDiscordUserId: 'maintainer1' });
    const approved = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.APPROVED_FOR_DRAFTING, byDiscordUserId: 'maintainer1' });
    assert.equal(approved.ok, true);
    assert.equal(approved.submission.published, false, 'no code path in this module may ever set published=true');
  });

  test('every moderation action is appended to statusHistory, never overwriting prior entries', () => {
    const discordUserId = synthUser('history');
    const created = createSubmission({ discordUserId, wallet: synthWallet('history'), fields: validFields() });
    reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.UNDER_REVIEW, byDiscordUserId: 'maintainer1' });
    reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.REVISION_REQUESTED, byDiscordUserId: 'maintainer1', reason: 'needs work' });
    const final = reviewSubmission({ id: created.submission.id, toStatus: SUBMISSION_STATUSES.UNDER_REVIEW, byDiscordUserId: 'maintainer1' });
    assert.equal(final.submission.statusHistory.length, 4, 'submitted + under-review + revision-requested + under-review again');
  });
});

describe('withdrawSubmission — owner-only', () => {
  test('the owner can withdraw their own open submission', () => {
    const discordUserId = synthUser('withdraw-owner');
    const created = createSubmission({ discordUserId, wallet: synthWallet('withdraw-owner'), fields: validFields() });
    const res = withdrawSubmission({ id: created.submission.id, discordUserId });
    assert.equal(res.ok, true);
    assert.equal(res.submission.status, SUBMISSION_STATUSES.WITHDRAWN);
  });

  test('a different user cannot withdraw someone else\'s submission', () => {
    const owner = synthUser('withdraw-real-owner');
    const attacker = synthUser('withdraw-attacker');
    const created = createSubmission({ discordUserId: owner, wallet: synthWallet('withdraw-owner2'), fields: validFields() });
    const res = withdrawSubmission({ id: created.submission.id, discordUserId: attacker });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'not_owner');
    assert.equal(getSubmissionById(created.submission.id).status, SUBMISSION_STATUSES.SUBMITTED, 'the real record must be untouched');
  });
});

describe('no automatic publication or voting activation', () => {
  test('nothing produced by this module ever appears with a votable-proposal shape (no choices/votingStartIso/votingEndIso fields)', () => {
    const discordUserId = synthUser('no-auto-publish');
    const created = createSubmission({ discordUserId, wallet: synthWallet('no-auto-publish'), fields: validFields() });
    assert.equal(created.submission.choices, undefined);
    assert.equal(created.submission.votingStartIso, undefined);
    assert.equal(created.submission.votingEndIso, undefined);
  });

  test('listAllSubmissions never includes a `published: true` record produced by any code path in this module', () => {
    const all = listAllSubmissions();
    assert.ok(all.every((s) => s.published === false), 'this module has no function that can ever set published=true');
  });
});
