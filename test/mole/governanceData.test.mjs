import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROPOSALS, PROPOSAL_CATEGORIES, GOVERNANCE_MODES, PROPOSAL_STATUSES,
  VALID_STATUS_TRANSITIONS, VOTABLE_STATUSES, CLOSED_STATUSES, GOVERNANCE_CONFIG,
  validateProposalRecord, isValidStatusTransition, computeApprovalThreshold,
  findDuplicateProposalIds, getProposalById, proposalNeedsFinalResults,
} from '../../src/mole/governanceData.js';

function baseProposal(overrides = {}) {
  return {
    id: 'x', schemaVersion: 1, title: 'X', summary: 'A summary',
    category: PROPOSAL_CATEGORIES.COMMUNITY, governanceMode: GOVERNANCE_MODES.ADVISORY,
    status: PROPOSAL_STATUSES.DRAFT, authorType: 'maintainer',
    ...overrides,
  };
}

describe('seeded PROPOSALS data integrity', () => {
  test('every seeded proposal passes validateProposalRecord', () => {
    for (const p of PROPOSALS) {
      const result = validateProposalRecord(p);
      assert.equal(result.ok, true, `${p.id} failed: ${result.errors.join(',')}`);
    }
  });

  test('no duplicate proposal ids in the seeded data', () => {
    assert.deepEqual(findDuplicateProposalIds(PROPOSALS), []);
  });

  test('the launch record is informational, not a fabricated real vote', () => {
    const launch = getProposalById('gov-launch-2026');
    assert.ok(launch);
    assert.equal(launch.votingStartIso, null, 'must never have been opened for a real vote');
    assert.equal(launch.finalResults.totalEligibleVotesCast, 0, 'zero real votes — not fabricated turnout');
  });
});

describe('validateProposalRecord', () => {
  test('rejects missing id/title/summary', () => {
    const result = validateProposalRecord({});
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('missing_id'));
    assert.ok(result.errors.includes('missing_title'));
    assert.ok(result.errors.includes('missing_summary'));
  });

  test('rejects an invalid category, governance mode, status, or author type', () => {
    assert.equal(validateProposalRecord(baseProposal({ category: 'not-a-category' })).ok, false);
    assert.equal(validateProposalRecord(baseProposal({ governanceMode: 'not-a-mode' })).ok, false);
    assert.equal(validateProposalRecord(baseProposal({ status: 'not-a-status' })).ok, false);
    assert.equal(validateProposalRecord(baseProposal({ authorType: 'not-a-type' })).ok, false);
  });

  test('a record never opened for voting (votingStartIso null) does not require choices', () => {
    const result = validateProposalRecord(baseProposal({ votingStartIso: null, choices: null }));
    assert.equal(result.ok, true);
  });

  test('a record with votingStartIso set requires at least 2 non-duplicate choices', () => {
    const withNoChoices = validateProposalRecord(baseProposal({ votingStartIso: '2026-01-01T00:00:00Z', choices: [] }));
    assert.equal(withNoChoices.ok, false);
    assert.ok(withNoChoices.errors.includes('invalid_choices'));

    const withOneChoice = validateProposalRecord(baseProposal({ votingStartIso: '2026-01-01T00:00:00Z', choices: ['Yes'] }));
    assert.equal(withOneChoice.ok, false);

    const withDupes = validateProposalRecord(baseProposal({ votingStartIso: '2026-01-01T00:00:00Z', choices: ['Yes', 'Yes'] }));
    assert.equal(withDupes.ok, false);
    assert.ok(withDupes.errors.includes('duplicate_choices'));

    const valid = validateProposalRecord(baseProposal({ votingStartIso: '2026-01-01T00:00:00Z', choices: ['Yes', 'No'] }));
    assert.equal(valid.ok, true);
  });

  test('rejects malformed dates: voting end before start', () => {
    const result = validateProposalRecord(baseProposal({
      votingStartIso: '2026-02-01T00:00:00Z', votingEndIso: '2026-01-01T00:00:00Z', choices: ['Yes', 'No'],
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('voting_end_before_start'));
  });

  test('a CLOSED status without finalResults is rejected (no unsupported "this happened" claim)', () => {
    const result = validateProposalRecord(baseProposal({ status: PROPOSAL_STATUSES.PASSED, finalResults: null }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('closed_status_requires_final_results'));
  });

  test('an EXECUTED status without execution evidence is rejected', () => {
    const result = validateProposalRecord(baseProposal({
      status: PROPOSAL_STATUSES.EXECUTED, finalResults: { totalEligibleVotesCast: 1 }, executionEvidence: [],
    }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('executed_status_requires_evidence'));
  });

  test('a BURN_PROGRAM category proposal requires burnDetails', () => {
    const result = validateProposalRecord(baseProposal({ category: PROPOSAL_CATEGORIES.BURN_PROGRAM, burnDetails: null }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('burn_category_requires_burn_details'));
  });

  test('rejects unsafe raw script content in text fields (defense in depth)', () => {
    const result = validateProposalRecord(baseProposal({ title: '<script>alert(1)</script>' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('unsafe_content_detected'));
  });

  test('a fully valid active-voting proposal passes', () => {
    const result = validateProposalRecord(baseProposal({
      status: PROPOSAL_STATUSES.ACTIVE,
      votingStartIso: '2026-01-01T00:00:00Z',
      votingEndIso: '2026-01-08T00:00:00Z',
      choices: ['Yes', 'No'],
    }));
    assert.equal(result.ok, true);
  });
});

describe('isValidStatusTransition', () => {
  test('an idempotent no-op transition is always allowed', () => {
    assert.equal(isValidStatusTransition(PROPOSAL_STATUSES.ACTIVE, PROPOSAL_STATUSES.ACTIVE), true);
  });
  test('draft -> review is allowed', () => {
    assert.equal(isValidStatusTransition(PROPOSAL_STATUSES.DRAFT, PROPOSAL_STATUSES.REVIEW), true);
  });
  test('draft -> executed is not allowed (cannot skip the whole lifecycle silently)', () => {
    assert.equal(isValidStatusTransition(PROPOSAL_STATUSES.DRAFT, PROPOSAL_STATUSES.EXECUTED), false);
  });
  test('archived is a true terminal state — nothing transitions out of it', () => {
    assert.deepEqual(VALID_STATUS_TRANSITIONS[PROPOSAL_STATUSES.ARCHIVED], []);
    assert.equal(isValidStatusTransition(PROPOSAL_STATUSES.ARCHIVED, PROPOSAL_STATUSES.ACTIVE), false);
  });
  test('active can only move to a defined closing state, never back to draft', () => {
    assert.equal(isValidStatusTransition(PROPOSAL_STATUSES.ACTIVE, PROPOSAL_STATUSES.DRAFT), false);
    assert.equal(isValidStatusTransition(PROPOSAL_STATUSES.ACTIVE, PROPOSAL_STATUSES.PASSED), true);
  });
});

describe('computeApprovalThreshold', () => {
  test('defaults to the standard >50% threshold', () => {
    assert.equal(computeApprovalThreshold(baseProposal()), GOVERNANCE_CONFIG.defaultApprovalThreshold);
  });
  test('governance-rules category requires the two-thirds threshold', () => {
    assert.equal(computeApprovalThreshold(baseProposal({ category: PROPOSAL_CATEGORIES.GOVERNANCE_RULES })), GOVERNANCE_CONFIG.governanceRuleChangeApprovalThreshold);
  });
  test('an explicit override wins over both defaults', () => {
    assert.equal(computeApprovalThreshold(baseProposal({ approvalThresholdOverride: 0.9 })), 0.9);
  });
});

describe('findDuplicateProposalIds / getProposalById', () => {
  test('detects a duplicate id in an arbitrary list', () => {
    assert.deepEqual(findDuplicateProposalIds([{ id: 'a' }, { id: 'a' }, { id: 'b' }]), ['a']);
  });
  test('empty list has no duplicates', () => {
    assert.deepEqual(findDuplicateProposalIds([]), []);
  });
  test('getProposalById finds a real seeded proposal', () => {
    assert.ok(getProposalById('gov-launch-2026'));
  });
  test('getProposalById returns null for an unknown id', () => {
    assert.equal(getProposalById('does-not-exist'), null);
  });
});

describe('proposalNeedsFinalResults', () => {
  test('true for every CLOSED status', () => {
    for (const status of CLOSED_STATUSES) assert.equal(proposalNeedsFinalResults(status), true);
  });
  test('false for every votable/pre-vote status', () => {
    for (const status of [...VOTABLE_STATUSES, PROPOSAL_STATUSES.DRAFT, PROPOSAL_STATUSES.SCHEDULED]) {
      assert.equal(proposalNeedsFinalResults(status), false);
    }
  });
});
