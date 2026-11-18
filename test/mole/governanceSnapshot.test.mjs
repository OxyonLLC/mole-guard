// Governance v1.1 — point-in-time eligibility snapshots.
//
// Integration test against the REAL src/mole/storage.js-backed
// governance_eligibility_snapshots.json, following the exact backup/restore
// discipline established in governanceStore.test.mjs (now path-corrected —
// see the comment on VOTES_PATH there): back up before, restore after, use
// synthetic proposal/wallet ids so nothing here can ever touch real data.
import 'dotenv/config';

// This repository's .env points MONGO_ENABLED/MONGO_URI at a real, live
// MongoDB Atlas cluster — src/mole/storage.js syncs every managed write
// there. Force-disable Mongo BEFORE governanceSnapshot.js (and therefore
// storage.js) is ever imported, so this test run is strictly local-JSON.
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_PATH = path.resolve(__dirname, '..', '..', 'data', 'governance_eligibility_snapshots.json');
const BACKUP_PATH = `${SNAPSHOTS_PATH}.test-backup`;
let existedBefore = false;

let resolveSnapshotEligibility, getRecordedSnapshot, readAllSnapshots;

before(async () => {
  existedBefore = fs.existsSync(SNAPSHOTS_PATH);
  if (existedBefore) fs.copyFileSync(SNAPSHOTS_PATH, BACKUP_PATH);
  const mod = await import('../../src/mole/governanceSnapshot.js');
  ({ resolveSnapshotEligibility, getRecordedSnapshot, readAllSnapshots } = mod);
});

after(() => {
  if (existedBefore) {
    fs.copyFileSync(BACKUP_PATH, SNAPSHOTS_PATH);
    fs.unlinkSync(BACKUP_PATH);
  } else if (fs.existsSync(SNAPSHOTS_PATH)) {
    fs.unlinkSync(SNAPSHOTS_PATH);
  }
});

function synthId(label) {
  return `__test_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
}

function pastProposal(overrides = {}) {
  return {
    id: synthId('proposal'),
    votingStartIso: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function futureProposal(overrides = {}) {
  return {
    id: synthId('proposal'),
    votingStartIso: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function liveResult({ eligible, balance, balanceCheckOk = true, wallet }) {
  return { eligible, reason: eligible ? 'eligible' : 'below_minimum_balance', wallet, balance, balanceCheckOk };
}

function stubEligibility(sequence) {
  let i = 0;
  const calls = [];
  const fn = async (walletAddress) => {
    calls.push(walletAddress);
    const next = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    if (typeof next === 'function') return next(walletAddress);
    return next;
  };
  fn.calls = calls;
  return fn;
}

describe('resolveSnapshotEligibility — pre-boundary preview', () => {
  test('before the snapshot boundary, returns a live preview and records nothing', async () => {
    const proposal = futureProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([liveResult({ eligible: true, balance: 5000, wallet })]);
    const result = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(result.preview, true);
    assert.equal(result.snapshot, null);
    assert.equal(getRecordedSnapshot(proposal.id, wallet), null, 'preview must never record a snapshot');
  });
});

describe('resolveSnapshotEligibility — snapshot lock-in', () => {
  test('balance above threshold at snapshot time records eligible=true', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([liveResult({ eligible: true, balance: 5000, wallet })]);
    const result = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(result.preview, false);
    assert.equal(result.eligible, true);
    assert.equal(result.balance, 5000);
    assert.ok(result.snapshot);
    assert.equal(result.snapshot.source, 'live-balance-snapshot');
    assert.ok(result.snapshot.recordedAtIso);
  });

  test('later balance falling below threshold does not change the recorded eligibility', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([
      liveResult({ eligible: true, balance: 5000, wallet }),
      liveResult({ eligible: false, balance: 10, wallet }), // must never be consulted again
    ]);
    await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    const second = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(second.eligible, true, 'recorded eligibility must survive a later balance drop');
    assert.equal(second.balance, 5000);
    assert.equal(checkLiveEligibility.calls.length, 1, 'live balance must be consulted only once, at first-check time');
  });

  test('balance below threshold at snapshot time records eligible=false', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([liveResult({ eligible: false, balance: 10, reason: 'below_minimum_balance', wallet })]);
    const result = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(result.eligible, false);
    assert.equal(result.balance, 10);
    assert.ok(result.snapshot);
  });

  test('later balance rising above threshold does not change the recorded ineligibility', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([
      liveResult({ eligible: false, balance: 10, wallet }),
      liveResult({ eligible: true, balance: 99999, wallet }), // must never be consulted again
    ]);
    await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    const second = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(second.eligible, false, 'recorded ineligibility must survive a later balance rise');
    assert.equal(second.balance, 10);
    assert.equal(checkLiveEligibility.calls.length, 1);
  });

  test('repeated checks return the exact same recorded result object contents', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([liveResult({ eligible: true, balance: 7500, wallet })]);
    const first = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    const second = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    const third = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.deepEqual(second.snapshot, first.snapshot);
    assert.deepEqual(third.snapshot, first.snapshot);
    assert.equal(checkLiveEligibility.calls.length, 1);
  });

  test('wallet switch: a different wallet on the same proposal gets its own independent check and snapshot', async () => {
    const proposal = pastProposal();
    const walletA = synthId('wallet-a');
    const walletB = synthId('wallet-b');
    const checkLiveEligibility = stubEligibility([
      (w) => liveResult({ eligible: true, balance: 5000, wallet: w }),
      (w) => liveResult({ eligible: false, balance: 1, wallet: w }),
    ]);
    const resultA = await resolveSnapshotEligibility({ proposal, walletAddress: walletA, checkLiveEligibility });
    const resultB = await resolveSnapshotEligibility({ proposal, walletAddress: walletB, checkLiveEligibility });
    assert.equal(resultA.eligible, true);
    assert.equal(resultB.eligible, false);
    assert.notEqual(getRecordedSnapshot(proposal.id, walletA), getRecordedSnapshot(proposal.id, walletB));
  });

  test('concurrent first checks on the same proposal+wallet: first-write-wins, no lost/duplicate record', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    let resolveDelay;
    const delay = new Promise((r) => { resolveDelay = r; });
    let calls = 0;
    const checkLiveEligibility = async (w) => {
      calls += 1;
      await delay;
      return liveResult({ eligible: true, balance: 4000 + calls, wallet: w });
    };
    const p1 = resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    const p2 = resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    resolveDelay();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual(r1.snapshot, r2.snapshot, 'both concurrent callers must observe the same winning snapshot');
    const recorded = getRecordedSnapshot(proposal.id, wallet);
    assert.deepEqual(r1.snapshot, recorded);
  });

  test('RPC failure before snapshot record: no snapshot is written, eligible is null (not false)', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([{ eligible: null, reason: 'balance_check_unavailable', wallet, balance: null, balanceCheckOk: false }]);
    const result = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(result.eligible, null, 'an RPC failure must never be reported as ineligible');
    assert.equal(result.balanceCheckOk, false);
    assert.equal(result.snapshot, null);
    assert.equal(getRecordedSnapshot(proposal.id, wallet), null, 'a failed check must never be recorded as a snapshot');
  });

  test('a wallet can retry after an RPC failure and get a real snapshot once the fault clears', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([
      { eligible: null, reason: 'balance_check_unavailable', wallet, balance: null, balanceCheckOk: false },
      liveResult({ eligible: true, balance: 8000, wallet }),
    ]);
    const failed = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(failed.snapshot, null);
    const recovered = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    assert.equal(recovered.eligible, true);
    assert.ok(recovered.snapshot);
  });

  test('snapshot record cannot be silently overwritten by a later call with a different live result', async () => {
    const proposal = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([liveResult({ eligible: true, balance: 6000, wallet })]);
    const first = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
    const recordedAfterFirst = getRecordedSnapshot(proposal.id, wallet);

    // Attempt to force a different outcome via a fresh stub — the function
    // must not consult it at all once a snapshot exists.
    const attackerStub = stubEligibility([liveResult({ eligible: false, balance: 0, wallet })]);
    const second = await resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility: attackerStub });
    assert.deepEqual(getRecordedSnapshot(proposal.id, wallet), recordedAfterFirst, 'the stored record must be byte-for-byte unchanged');
    assert.equal(second.eligible, true, 'the reused result must be the original, not the attacker\'s');
    assert.equal(attackerStub.calls.length, 0, 'live eligibility must never even be consulted once a snapshot exists');
  });

  test('proposal-specific isolation: the same wallet has independent snapshots on two different proposals', async () => {
    const proposalA = pastProposal();
    const proposalB = pastProposal();
    const wallet = synthId('wallet');
    const checkLiveEligibility = stubEligibility([
      liveResult({ eligible: true, balance: 5000, wallet }),
      liveResult({ eligible: false, balance: 1, wallet }),
    ]);
    const resultA = await resolveSnapshotEligibility({ proposal: proposalA, walletAddress: wallet, checkLiveEligibility });
    const resultB = await resolveSnapshotEligibility({ proposal: proposalB, walletAddress: wallet, checkLiveEligibility });
    assert.equal(resultA.eligible, true);
    assert.equal(resultB.eligible, false);
    assert.equal(getRecordedSnapshot(proposalA.id, wallet).eligible, true);
    assert.equal(getRecordedSnapshot(proposalB.id, wallet).eligible, false);

    const all = readAllSnapshots();
    assert.ok(all[proposalA.id]);
    assert.ok(all[proposalB.id]);
    assert.notEqual(all[proposalA.id], all[proposalB.id]);
  });
});

describe('resolveSnapshotEligibility — wallet not verified', () => {
  test('a null wallet address returns wallet_not_verified without touching storage', async () => {
    const proposal = pastProposal();
    const checkLiveEligibility = stubEligibility([liveResult({ eligible: true, balance: 5000, wallet: null })]);
    const result = await resolveSnapshotEligibility({ proposal, walletAddress: null, checkLiveEligibility });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'wallet_not_verified');
    assert.equal(checkLiveEligibility.calls.length, 0);
  });
});
