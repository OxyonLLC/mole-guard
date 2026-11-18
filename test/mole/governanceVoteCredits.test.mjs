// Governance purchased-vote-weight ledger (2026-07-28) — direct precedent:
// src/quiz/db.js's drawDownOpenCyclePoints() and its own double-payout test
// coverage. See src/mole/governanceVoteCredits.js's file header for the
// full design reasoning. Same backup/restore discipline as
// test/mole/governanceStore.test.mjs.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDITS_PATH = path.resolve(__dirname, '..', '..', 'data', 'governance_vote_credits.json');
const BACKUP_PATH = `${CREDITS_PATH}.test-backup`;
let existedBefore = false;

let allocateVoteWeight, previewPurchasedWeight;

before(async () => {
  existedBefore = fs.existsSync(CREDITS_PATH);
  if (existedBefore) fs.copyFileSync(CREDITS_PATH, BACKUP_PATH);
  const mod = await import('../../src/mole/governanceVoteCredits.js');
  ({ allocateVoteWeight, previewPurchasedWeight } = mod);
});

after(() => {
  if (existedBefore) {
    fs.copyFileSync(BACKUP_PATH, CREDITS_PATH);
    fs.unlinkSync(BACKUP_PATH);
  } else if (fs.existsSync(CREDITS_PATH)) {
    fs.unlinkSync(CREDITS_PATH);
  }
});

function synthUser() {
  return `__test_gov_credits_user_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}
function synthProposal() {
  return `__test_gov_credits_proposal_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}

const PRICE = 100_000; // WinLEW per vote, for readable test numbers

describe('allocateVoteWeight — the core double-spend prevention property', () => {
  test('a single payment cannot fund purchased weight on two different proposals at once', () => {
    const user = synthUser();
    const [propA, propB] = [synthProposal(), synthProposal()];
    const total = 1_000_000; // exactly 10 votes worth

    const a = allocateVoteWeight(user, propA, { totalContributedWinlew: total, winlewPerVote: PRICE });
    assert.equal(a.purchasedWeight, 10, 'all of it should be allocatable to the first proposal');

    const b = allocateVoteWeight(user, propB, { totalContributedWinlew: total, winlewPerVote: PRICE });
    assert.equal(b.purchasedWeight, 0, 'nothing should be left to allocate to a second proposal from the same payment');

    // Proposal A must remain unaffected by the attempt on B.
    const aAgain = allocateVoteWeight(user, propA, { totalContributedWinlew: total, winlewPerVote: PRICE });
    assert.equal(aAgain.purchasedWeight, 10);
  });

  test('a top-up contribution correctly extends purchased weight on a second proposal without double-counting the first', () => {
    const user = synthUser();
    const [propA, propB] = [synthProposal(), synthProposal()];

    allocateVoteWeight(user, propA, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE }); // 10 votes on A

    const b = allocateVoteWeight(user, propB, { totalContributedWinlew: 1_500_000, winlewPerVote: PRICE }); // +500k new
    assert.equal(b.purchasedWeight, 5, 'only the NEW 500k (not the 1M already spent on A) should fund B');

    const aStillIntact = allocateVoteWeight(user, propA, { totalContributedWinlew: 1_500_000, winlewPerVote: PRICE });
    assert.equal(aStillIntact.purchasedWeight, 10, "A's allocation must not shrink just because B was computed");
  });

  test('weight is hard-capped at MAX_PURCHASED_VOTES_PER_PROPOSAL regardless of how much more is paid', () => {
    const user = synthUser();
    const prop = synthProposal();
    const r = allocateVoteWeight(user, prop, { totalContributedWinlew: 50_000_000, winlewPerVote: PRICE }); // 500 votes worth
    assert.equal(r.purchasedWeight, 10, 'never more than the cap, no matter how much is contributed');
    assert.equal(r.allocatedWinlew, 10 * PRICE, 'the excess beyond the cap should not even be recorded as allocated');
  });

  test('re-allocating the same proposal with the same total is idempotent (no drift from repeated calls)', () => {
    const user = synthUser();
    const prop = synthProposal();
    const first = allocateVoteWeight(user, prop, { totalContributedWinlew: 300_000, winlewPerVote: PRICE });
    const second = allocateVoteWeight(user, prop, { totalContributedWinlew: 300_000, winlewPerVote: PRICE });
    assert.deepEqual(first, second);
  });

  test('two different users are fully isolated from each other', () => {
    const userA = synthUser();
    const userB = synthUser();
    const prop = synthProposal();
    allocateVoteWeight(userA, prop, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });
    const b = allocateVoteWeight(userB, prop, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });
    assert.equal(b.purchasedWeight, 10, "user B's own contribution must not be blocked by user A's allocation");
  });

  test('zero contribution yields zero purchased weight, never negative or NaN', () => {
    const user = synthUser();
    const prop = synthProposal();
    const r = allocateVoteWeight(user, prop, { totalContributedWinlew: 0, winlewPerVote: PRICE });
    assert.equal(r.purchasedWeight, 0);
    assert.equal(r.allocatedWinlew, 0);
  });

  test('an invalid/zero price never divides by zero or throws', () => {
    const user = synthUser();
    const prop = synthProposal();
    assert.doesNotThrow(() => {
      const r = allocateVoteWeight(user, prop, { totalContributedWinlew: 1_000_000, winlewPerVote: 0 });
      assert.equal(r.purchasedWeight, 0);
    });
  });
});

describe('previewPurchasedWeight — read-only, never mutates the ledger', () => {
  test('preview matches what allocate would produce, without locking anything in', () => {
    const user = synthUser();
    const prop = synthProposal();
    const preview = previewPurchasedWeight(user, prop, { totalContributedWinlew: 500_000, winlewPerVote: PRICE });
    assert.equal(preview.purchasedWeight, 5);

    // Since preview never wrote anything, allocating fresh afterward should
    // produce the identical result, not a smaller one from double-deduction.
    const real = allocateVoteWeight(user, prop, { totalContributedWinlew: 500_000, winlewPerVote: PRICE });
    assert.equal(real.purchasedWeight, 5);
  });

  test('calling preview repeatedly never changes the underlying ledger', () => {
    const user = synthUser();
    const [propA, propB] = [synthProposal(), synthProposal()];
    allocateVoteWeight(user, propA, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });

    previewPurchasedWeight(user, propB, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });
    previewPurchasedWeight(user, propB, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });
    previewPurchasedWeight(user, propB, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });

    const aStillFull = allocateVoteWeight(user, propA, { totalContributedWinlew: 1_000_000, winlewPerVote: PRICE });
    assert.equal(aStillFull.purchasedWeight, 10, 'repeated previews on B must never have leaked an allocation away from A');
  });
});
