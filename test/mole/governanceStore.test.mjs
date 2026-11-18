// Integration test against the REAL src/mole/storage.js-backed
// governance_votes.json — mirrors the backup/restore discipline already
// established for src/quiz/data/db.json in
// test/quiz/db-platform-stats.test.cjs: back up before, restore after, use
// synthetic proposal ids so nothing here can ever touch a real vote.
//
// src/mole/storage.js pulls its DATA_DIR from src/mole/config.js's
// zod-validated getConfig(), which expects process.env to already be
// populated the way src/index.js's own `import 'dotenv/config'` (its very
// first line) guarantees at real runtime. This test file never goes
// through index.js, so it loads .env itself the same way.
import 'dotenv/config';

// This repository's .env points MONGO_ENABLED/MONGO_URI at a real,
// live MongoDB Atlas cluster — src/mole/storage.js syncs every managed
// write there. A test run must never touch that real database, even with
// synthetic-prefixed data, so Mongo is force-disabled here BEFORE
// governanceStore.js (and therefore storage.js) is ever imported. This
// keeps every read/write in this file strictly local-JSON, matching the
// backup/restore discipline below.
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR (src/mole/config.js, from .env) is "./data" at the repo root, not
// "src/data" — that path never existed, so the backup/restore below was
// silently a no-op and every run of this file was permanently leaking
// synthetic __test_gov_* rows into the REAL governance_votes.json (which
// storage.js also syncs to a live Mongo collection). Fixed to point at the
// actual DATA_DIR location so backup/restore genuinely protects real data.
const VOTES_PATH = path.resolve(__dirname, '..', '..', 'data', 'governance_votes.json');
const BACKUP_PATH = `${VOTES_PATH}.test-backup`;
let existedBefore = false;

let castVote, getWalletVote, computeResults;
const { PROPOSAL_STATUSES, PROPOSAL_CATEGORIES, GOVERNANCE_MODES } = await import('../../src/mole/governanceData.js');

before(async () => {
  existedBefore = fs.existsSync(VOTES_PATH);
  if (existedBefore) fs.copyFileSync(VOTES_PATH, BACKUP_PATH);
  const store = await import('../../src/mole/governanceStore.js');
  ({ castVote, getWalletVote, computeResults } = store);
});

after(() => {
  if (existedBefore) {
    fs.copyFileSync(BACKUP_PATH, VOTES_PATH);
    fs.unlinkSync(BACKUP_PATH);
  } else if (fs.existsSync(VOTES_PATH)) {
    fs.unlinkSync(VOTES_PATH);
  }
});

function synthProposal(overrides = {}) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    id: `__test_gov_${suffix}__`,
    schemaVersion: 1,
    title: 'Synthetic Test Proposal',
    summary: 'Test only',
    category: PROPOSAL_CATEGORIES.COMMUNITY,
    governanceMode: GOVERNANCE_MODES.ADVISORY,
    status: PROPOSAL_STATUSES.ACTIVE,
    votingStartIso: new Date(Date.now() - 60_000).toISOString(),
    votingEndIso: new Date(Date.now() + 60_000).toISOString(),
    choices: ['Yes', 'No', 'Abstain'],
    quorumRule: { type: 'fixed', minVotes: 2 },
    votingMethod: 'one-wallet-one-vote',
    ...overrides,
  };
}

function synthWallet(label) {
  return `__test_wallet_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}

describe('castVote', () => {
  test('rejects an unknown/missing proposal', () => {
    const res = castVote({ proposal: null, walletAddress: synthWallet('a'), discordUserId: '1', choice: 'Yes' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'proposal_not_found');
  });

  test('rejects voting on a non-active-status proposal', () => {
    const proposal = synthProposal({ status: PROPOSAL_STATUSES.SCHEDULED });
    const res = castVote({ proposal, walletAddress: synthWallet('b'), discordUserId: '1', choice: 'Yes' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'voting_not_open');
  });

  test('rejects voting before the voting window has started', () => {
    const proposal = synthProposal({ votingStartIso: new Date(Date.now() + 60_000).toISOString() });
    const res = castVote({ proposal, walletAddress: synthWallet('c'), discordUserId: '1', choice: 'Yes' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'voting_not_started');
  });

  test('rejects voting after the voting window has closed', () => {
    const proposal = synthProposal({ votingStartIso: new Date(Date.now() - 120_000).toISOString(), votingEndIso: new Date(Date.now() - 60_000).toISOString() });
    const res = castVote({ proposal, walletAddress: synthWallet('d'), discordUserId: '1', choice: 'Yes' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'voting_closed');
  });

  test('rejects an invalid/malformed choice not in the proposal\'s defined choices', () => {
    const proposal = synthProposal();
    const res = castVote({ proposal, walletAddress: synthWallet('e'), discordUserId: '1', choice: 'Maybe' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_choice');
  });

  test('rejects a missing wallet address (never trusts an unresolved identity)', () => {
    const proposal = synthProposal();
    const res = castVote({ proposal, walletAddress: null, discordUserId: '1', choice: 'Yes' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'wallet_required');
  });

  test('a valid vote succeeds and returns a receipt', () => {
    const proposal = synthProposal();
    const wallet = synthWallet('f');
    const res = castVote({ proposal, walletAddress: wallet, discordUserId: '111', choice: 'Yes' });
    assert.equal(res.ok, true);
    assert.equal(res.vote.choice, 'Yes');
    assert.ok(res.vote.castAtIso);
    assert.ok(res.vote.updatedAtIso);
  });

  test('vote change: a second vote from the same wallet overwrites the first (latest choice wins)', () => {
    const proposal = synthProposal();
    const wallet = synthWallet('g');
    const first = castVote({ proposal, walletAddress: wallet, discordUserId: '222', choice: 'Yes' });
    const second = castVote({ proposal, walletAddress: wallet, discordUserId: '222', choice: 'No' });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const stored = getWalletVote(proposal.id, wallet);
    assert.equal(stored.choice, 'No', 'latest valid choice must replace the prior one');
    assert.equal(stored.castAtIso, first.vote.castAtIso, 'original cast time is preserved across an update');
    assert.notEqual(stored.updatedAtIso, undefined);
  });

  test('one wallet, one vote: casting twice never creates two records for the same proposal+wallet', () => {
    const proposal = synthProposal();
    const wallet = synthWallet('h');
    castVote({ proposal, walletAddress: wallet, discordUserId: '333', choice: 'Yes' });
    castVote({ proposal, walletAddress: wallet, discordUserId: '333', choice: 'No' });
    const results = computeResults(proposal);
    assert.equal(results.totalEligibleVotesCast, 1, 'exactly one vote counted for this wallet, not two');
  });

  test('does not corrupt or affect votes on a different proposal', () => {
    const proposalA = synthProposal();
    const proposalB = synthProposal();
    const wallet = synthWallet('i');
    castVote({ proposal: proposalA, walletAddress: wallet, discordUserId: '444', choice: 'Yes' });
    castVote({ proposal: proposalB, walletAddress: wallet, discordUserId: '444', choice: 'No' });
    assert.equal(getWalletVote(proposalA.id, wallet).choice, 'Yes');
    assert.equal(getWalletVote(proposalB.id, wallet).choice, 'No');
  });

  test('simultaneous votes from two different wallets on the same proposal: both are recorded, none lost (same-process synchronous-write race safety)', async () => {
    const proposal = synthProposal();
    const walletA = synthWallet('race-a');
    const walletB = synthWallet('race-b');
    await Promise.all([
      Promise.resolve().then(() => castVote({ proposal, walletAddress: walletA, discordUserId: '555', choice: 'Yes' })),
      Promise.resolve().then(() => castVote({ proposal, walletAddress: walletB, discordUserId: '666', choice: 'No' })),
    ]);
    const results = computeResults(proposal);
    assert.equal(results.totalEligibleVotesCast, 2, 'both concurrent votes from different wallets must be preserved');
  });
});

describe('getWalletVote', () => {
  test('returns null for a wallet that never voted', () => {
    const proposal = synthProposal();
    assert.equal(getWalletVote(proposal.id, synthWallet('never-voted')), null);
  });
  test('returns null for a missing wallet address', () => {
    const proposal = synthProposal();
    assert.equal(getWalletVote(proposal.id, null), null);
  });
  test('never returns another wallet\'s vote when queried by a different wallet', () => {
    const proposal = synthProposal();
    const walletA = synthWallet('j');
    const walletB = synthWallet('k');
    castVote({ proposal, walletAddress: walletA, discordUserId: '777', choice: 'Yes' });
    assert.equal(getWalletVote(proposal.id, walletB), null);
  });
});

describe('computeResults', () => {
  test('empty proposal (no votes) reports zero, no crash', () => {
    const proposal = synthProposal();
    const results = computeResults(proposal);
    assert.equal(results.totalEligibleVotesCast, 0);
    assert.equal(results.quorumMet, false);
    assert.equal(results.approvalPassed, false);
  });

  test('tallies votes by choice correctly and percentages sum sanely', () => {
    const proposal = synthProposal({ quorumRule: { type: 'fixed', minVotes: 1 } });
    castVote({ proposal, walletAddress: synthWallet('l'), discordUserId: '1', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('m'), discordUserId: '2', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('n'), discordUserId: '3', choice: 'No' });
    const results = computeResults(proposal);
    assert.equal(results.totalEligibleVotesCast, 3);
    assert.equal(results.votesByChoice.Yes, 2);
    assert.equal(results.votesByChoice.No, 1);
    assert.equal(results.percentByChoice.Yes, 66.67);
    assert.equal(results.percentByChoice.No, 33.33);
  });

  test('quorum not met when turnout is below the fixed minimum', () => {
    const proposal = synthProposal({ quorumRule: { type: 'fixed', minVotes: 5 } });
    castVote({ proposal, walletAddress: synthWallet('o'), discordUserId: '1', choice: 'Yes' });
    const results = computeResults(proposal);
    assert.equal(results.quorumMet, false);
    assert.equal(results.approvalPassed, false, 'cannot pass without quorum, regardless of vote share');
  });

  test('quorum met + simple majority (>50%) passes for a standard community proposal', () => {
    const proposal = synthProposal({ category: PROPOSAL_CATEGORIES.COMMUNITY, quorumRule: { type: 'fixed', minVotes: 2 } });
    castVote({ proposal, walletAddress: synthWallet('p'), discordUserId: '1', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('q'), discordUserId: '2', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('r'), discordUserId: '3', choice: 'No' });
    const results = computeResults(proposal);
    assert.equal(results.quorumMet, true);
    assert.equal(results.approvalThreshold, 0.5);
    assert.equal(results.approvalPassed, true);
  });

  test('exactly 50/50 does NOT pass the ">50%" simple threshold', () => {
    const proposal = synthProposal({ quorumRule: { type: 'fixed', minVotes: 2 } });
    castVote({ proposal, walletAddress: synthWallet('s'), discordUserId: '1', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('t'), discordUserId: '2', choice: 'No' });
    const results = computeResults(proposal);
    assert.equal(results.approvalPassed, false);
  });

  test('a governance-rules category proposal requires the two-thirds threshold, not one-half', () => {
    const proposal = synthProposal({ category: PROPOSAL_CATEGORIES.GOVERNANCE_RULES, quorumRule: { type: 'fixed', minVotes: 3 } });
    castVote({ proposal, walletAddress: synthWallet('u'), discordUserId: '1', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('v'), discordUserId: '2', choice: 'Yes' });
    castVote({ proposal, walletAddress: synthWallet('w'), discordUserId: '3', choice: 'No' });
    const results = computeResults(proposal);
    // 2/3 = exactly the threshold, and the rule is "greater than", so exactly
    // two-thirds must NOT pass — a real-world caution against boundary bugs.
    assert.equal(results.approvalThreshold, 2 / 3);
    assert.equal(results.approvalPassed, false, 'exactly two-thirds must not satisfy a strictly-greater-than rule');
  });

  test('PRIVACY: the results object never contains a wallet address or a per-wallet choice mapping', () => {
    const proposal = synthProposal();
    const wallet = synthWallet('privacy-check');
    castVote({ proposal, walletAddress: wallet, discordUserId: '1', choice: 'Yes' });
    const results = computeResults(proposal);
    const serialized = JSON.stringify(results);
    assert.doesNotMatch(serialized, new RegExp(wallet), 'no wallet address may appear anywhere in the public results payload');
    assert.ok(!Object.prototype.hasOwnProperty.call(results, 'votesByWallet'));
  });

  test('returns null for a null proposal rather than throwing', () => {
    assert.equal(computeResults(null), null);
  });
});

// ── One vote per person, not per wallet (2026-08-20) ─────────────────────
//
// Votes are keyed by wallet, which WAS one-per-person while an identity could
// only hold one verified wallet. Multi-wallet verification ended that, and
// without dedup a person could verify three wallets and vote three times —
// every one of them passing all checks, because every wallet is genuinely
// eligible.
describe('castVote: one voter, one vote', () => {
  test('a second wallet from the same Discord account replaces the first vote', () => {
    const proposal = synthProposal();
    const walletA = synthWallet('same_person_a');
    const walletB = synthWallet('same_person_b');

    assert.equal(castVote({ proposal, walletAddress: walletA, discordUserId: '999', choice: 'Yes' }).ok, true);
    assert.equal(castVote({ proposal, walletAddress: walletB, discordUserId: '999', choice: 'No' }).ok, true);

    assert.equal(getWalletVote(proposal.id, walletA), null, 'the first wallet must not keep a live vote');
    assert.equal(getWalletVote(proposal.id, walletB).choice, 'No');

    const results = computeResults(proposal);
    assert.equal(results.totalEligibleVotesCast, 1, 'one person, one vote — not two');
  });

  test('the original cast time survives the move', () => {
    const proposal = synthProposal();
    const walletA = synthWallet('keeps_time_a');
    const walletB = synthWallet('keeps_time_b');

    castVote({ proposal, walletAddress: walletA, discordUserId: '998', choice: 'Yes' });
    const firstCastAt = getWalletVote(proposal.id, walletA).castAtIso;
    castVote({ proposal, walletAddress: walletB, discordUserId: '998', choice: 'Abstain' });

    assert.equal(getWalletVote(proposal.id, walletB).castAtIso, firstCastAt,
      'this is one voter changing their mind, not a new voter arriving');
  });

  test('different people are untouched by each other', () => {
    const proposal = synthProposal();
    const walletA = synthWallet('person_one');
    const walletB = synthWallet('person_two');

    castVote({ proposal, walletAddress: walletA, discordUserId: '1001', choice: 'Yes' });
    castVote({ proposal, walletAddress: walletB, discordUserId: '1002', choice: 'No' });

    assert.equal(getWalletVote(proposal.id, walletA).choice, 'Yes');
    assert.equal(getWalletVote(proposal.id, walletB).choice, 'No');
    assert.equal(computeResults(proposal).totalEligibleVotesCast, 2);
  });

  test('votes with no Discord id are NOT collapsed into one', () => {
    // Matching "" against "" would fold every anonymous vote into a single
    // record — silently deleting real votes. Those stay keyed by wallet.
    const proposal = synthProposal();
    const walletA = synthWallet('anon_a');
    const walletB = synthWallet('anon_b');

    castVote({ proposal, walletAddress: walletA, discordUserId: '', choice: 'Yes' });
    castVote({ proposal, walletAddress: walletB, discordUserId: '', choice: 'No' });

    assert.equal(getWalletVote(proposal.id, walletA)?.choice, 'Yes');
    assert.equal(getWalletVote(proposal.id, walletB)?.choice, 'No');
    assert.equal(computeResults(proposal).totalEligibleVotesCast, 2);
  });
});
