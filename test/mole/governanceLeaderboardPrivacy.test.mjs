// Governance participation leaderboard — privacy contract.
//
// The board publishes WHO takes part in governance, while
// governanceData.js's voteChoicePrivacy ("private-until-never") promises it
// will never publish HOW they voted. Those two things are only compatible
// while enough people have voted that a row can't be triangulated back to a
// choice: with a single voter and a public 1-0 tally, naming the voter names
// their vote.
//
// So there are two guarantees to hold, and both are enforced server-side —
// hiding the board in the page would still serve identities to anyone who
// opened /api/governance/leaderboard directly:
//   1. below the voter threshold, the response carries NO identities;
//   2. at no point, gated or open, does it carry a vote `choice`.
//
// Starts the REAL server against an isolated scratch DATA_DIR with Mongo
// disabled, matching governanceSubmissionsRoutes.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-leaderboard-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8799;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);
process.env.GOVERNANCE_LEADERBOARD_MIN_VOTERS = '5';

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeJson } from '../../src/mole/storage.js';
import { PROPOSALS } from '../../src/mole/governanceData.js';

const BASE = `http://127.0.0.1:${PORT}`;
const MIN_VOTERS = 5;
const PROPOSAL_ID = PROPOSALS[0]?.id;

let web;

// Written through storage.js's own writeJson so its in-memory managed-JSON
// cache — which the route handler reads from — is updated too. A raw fs
// write would be silently ignored by an already-warm cache.
function seedVoters(count, { proposalId = PROPOSAL_ID } = {}) {
  const votes = {};
  for (let i = 0; i < count; i += 1) {
    votes[`TestWallet${i}`] = {
      // Deliberately mixed so a leak would be detectable rather than uniform.
      choice: i % 2 === 0 ? 'for' : 'against',
      weight: 1 + (i % 3),
      discordUserId: `test_voter_${i}`,
      castAtIso: '2026-07-31T10:00:00Z',
      updatedAtIso: '2026-07-31T10:00:00Z',
    };
  }
  writeJson('governance_votes.json', proposalId ? { [proposalId]: votes } : {});
}

async function fetchBoard() {
  const res = await fetch(`${BASE}/api/governance/leaderboard`);
  const json = await res.json();
  return { res, json, raw: JSON.stringify(json) };
}

before(async () => {
  web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});

after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  // startWeb()'s listening server keeps the event loop alive forever and
  // exposes no handle to close — same forced exit governanceSubmissionsRoutes
  // uses, or both `node --test` and the full-suite runner hang here.
  setImmediate(() => process.exit(0));
});

describe('governance leaderboard — small-turnout privacy gate', () => {
  test('stays sealed below the voter threshold and leaks no identities', async () => {
    for (const count of [1, 2, MIN_VOTERS - 1]) {
      seedVoters(count);
      const { res, json, raw } = await fetchBoard();
      assert.equal(res.status, 200);
      assert.equal(json.gated, true, `expected gated at ${count} voter(s)`);
      assert.deepEqual(json.entries, [], `expected no entries at ${count} voter(s)`);
      assert.ok(!/test_voter_/.test(raw), `a discordUserId leaked while gated at ${count} voter(s)`);
      assert.ok(!/TestWallet/.test(raw), `a wallet leaked while gated at ${count} voter(s)`);
    }
  });

  test('opens once the threshold is reached', async () => {
    seedVoters(MIN_VOTERS);
    const { json } = await fetchBoard();
    assert.equal(json.gated, false);
    assert.equal(json.entries.length, MIN_VOTERS);
    assert.equal(json.voterCount, MIN_VOTERS);
  });

  test('never exposes a vote choice, gated or open', async () => {
    for (const count of [1, MIN_VOTERS, MIN_VOTERS + 3]) {
      seedVoters(count);
      const { raw } = await fetchBoard();
      assert.ok(!/"choice"/.test(raw), `the field "choice" appeared at ${count} voter(s)`);
      // The stored values themselves must not surface under any key.
      assert.ok(!/"(for|against)"/.test(raw), `a raw choice value appeared at ${count} voter(s)`);
    }
  });

  test('an empty board is not treated as gated', async () => {
    // Zero voters is not a privacy risk — it is just an empty board, and
    // showing "sealed until 5" before anyone has voted would misdescribe it.
    seedVoters(0, { proposalId: null });
    const { json } = await fetchBoard();
    assert.equal(json.gated, false);
    assert.deepEqual(json.entries, []);
    assert.equal(json.voterCount, 0);
  });

  test('votes on proposals that no longer exist are ignored', async () => {
    // A removed or renamed proposal must not keep inflating a participation
    // count — and must not resurrect its voters' identities past the gate.
    writeJson('governance_votes.json', {
      'proposal-that-was-deleted': {
        GhostWallet: { choice: 'for', weight: 9, discordUserId: 'ghost_voter' },
      },
    });
    const { json, raw } = await fetchBoard();
    assert.equal(json.voterCount, 0);
    assert.deepEqual(json.entries, []);
    assert.ok(!/ghost_voter/.test(raw));
  });
});
