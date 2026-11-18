// Proof of Tuesday (§35) — derived participation history.
//
// The metrics look simple and are not. Streaks have three edge cases that are
// easy to get wrong and embarrassing in public: an epoch still OPEN must not
// break a streak, someone who joined late must not be shown Tuesdays they could
// never have claimed, and a rotated wallet must keep its history.
//
// Everything is derived from claim records, so these tests are also a check
// that the derivation cannot be made to disagree with the chain.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createState, createEpoch, registerParticipant, claim,
} from "../../src/cunt/epoch.js";
import { proofOfTuesday, eligibleEpochs, leaderboard } from "../../src/cunt/proofOfTuesday.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const T0 = 1_800_000_000;
const WEEK = 7 * 86_400;
const DAY = 86_400;

/** n weekly epochs starting at T0; epoch k runs [T0+(k-1)*WEEK, +1 day). */
function world(n, { perClaim = 100n, vault = 1_000_000n } = {}) {
  const state = createState({ vaultBalance: vault });
  for (let k = 1; k <= n; k++) {
    createEpoch(state, {
      epochNumber: k,
      startTs: T0 + (k - 1) * WEEK,
      endTs: T0 + (k - 1) * WEEK + DAY,
      rewardBudget: 1_000_000n,
      rewardPerClaim: perClaim,
    });
  }
  return state;
}
const during = (k) => T0 + (k - 1) * WEEK + 100;
const after = (k) => T0 + (k - 1) * WEEK + DAY + 1;

function join(state, who, { at = T0 - 1 } = {}) {
  registerParticipant(state, { wallet: `w-${who}`, identityHash: who, registeredAtTs: at });
}
const doClaim = (state, who, k) => claim(state, { epochNumber: k, claimant: `w-${who}`, nowTs: during(k) });

test("a perfect record", () => {
  const state = world(5);
  join(state, "steady");
  for (let k = 1; k <= 5; k++) doClaim(state, "steady", k);

  const r = proofOfTuesday(state, { identityHash: "steady", asOfTs: after(5) });
  assert.equal(r.firstEpoch, 1);
  assert.equal(r.totalEligibleEpochs, 5);
  assert.equal(r.totalClaimedEpochs, 5);
  assert.equal(r.missedEpochs, 0);
  assert.equal(r.currentStreak, 5);
  assert.equal(r.longestStreak, 5);
  assert.equal(r.totalClaimed, 500n);
});

test("a broken streak — longest is remembered, current is not", () => {
  const state = world(6);
  join(state, "patchy");
  for (const k of [1, 2, 3, 5]) doClaim(state, "patchy", k);   // missed 4 and 6

  const r = proofOfTuesday(state, { identityHash: "patchy", asOfTs: after(6) });
  assert.equal(r.totalClaimedEpochs, 4);
  assert.equal(r.missedEpochs, 2);
  assert.equal(r.longestStreak, 3, "epochs 1-2-3");
  assert.equal(r.currentStreak, 0, "epoch 6 was missed, so the current streak is broken");
});

test("current streak counts back from the most recent resolved epoch", () => {
  const state = world(5);
  join(state, "recent");
  for (const k of [1, 4, 5]) doClaim(state, "recent", k);

  const r = proofOfTuesday(state, { identityHash: "recent", asOfTs: after(5) });
  assert.equal(r.currentStreak, 2, "epochs 4 and 5");
  assert.equal(r.longestStreak, 2);
  assert.equal(r.missedEpochs, 2, "epochs 2 and 3");
});

// ── The three edge cases ────────────────────────────────────────────────────
test("an OPEN epoch does not break a streak before it closes", () => {
  // Mid-Tuesday, having claimed the previous four weeks and not yet this one.
  // The streak must still read 4. Anything else makes the number flap for
  // anyone watching live, and punishes someone whose window is still running.
  const state = world(5);
  join(state, "midweek");
  for (let k = 1; k <= 4; k++) doClaim(state, "midweek", k);

  const midEpoch5 = during(5);
  const r = proofOfTuesday(state, { identityHash: "midweek", asOfTs: midEpoch5 });
  assert.equal(r.currentStreak, 4, "the open epoch must neither extend nor break the streak");
  assert.equal(r.missedEpochs, 0, "an open unclaimed epoch is pending, not missed");
  assert.equal(r.pendingEpoch, 5);

  // Claim it and the streak extends.
  doClaim(state, "midweek", 5);
  const after5 = proofOfTuesday(state, { identityHash: "midweek", asOfTs: midEpoch5 });
  assert.equal(after5.currentStreak, 5);
  assert.equal(after5.pendingEpoch, null);

  // Let it close unclaimed instead → now it is a miss.
  const state2 = world(5);
  join(state2, "midweek");
  for (let k = 1; k <= 4; k++) doClaim(state2, "midweek", k);
  const closed = proofOfTuesday(state2, { identityHash: "midweek", asOfTs: after(5) });
  assert.equal(closed.missedEpochs, 1);
  assert.equal(closed.currentStreak, 0);
});

test("joining late does not create missed Tuesdays you could never have claimed", () => {
  // Registered during epoch 4 of 6. Epochs 1-3 must not count at all.
  const state = world(6);
  join(state, "latecomer", { at: during(4) });
  for (const k of [4, 5, 6]) doClaim(state, "latecomer", k);

  const r = proofOfTuesday(state, { identityHash: "latecomer", asOfTs: after(6) });
  assert.equal(r.totalEligibleEpochs, 3, "only epochs 4-6 were ever claimable for them");
  assert.equal(r.missedEpochs, 0, "epochs 1-3 must not be held against a later joiner");
  assert.equal(r.currentStreak, 3);
  assert.equal(r.firstEpoch, 4);
});

test("registering mid-epoch still makes that epoch eligible", () => {
  // Registered after epoch 2 opened but before it closed — there was still time
  // to claim, so it counts.
  const state = world(3);
  join(state, "justintime", { at: during(2) });
  const elig = eligibleEpochs(state, { identityHash: "justintime", asOfTs: after(3) });
  assert.deepEqual(elig.map((e) => e.epochNumber), [2, 3]);
});

test("history follows the identity, not the wallet", () => {
  // A rotated wallet keeps its record. This is why everything is keyed by
  // identity — wallet-keyed history would reset on rotation, and would also let
  // someone fork a second clean record.
  const state = world(3);
  join(state, "rotator");
  doClaim(state, "rotator", 1);
  doClaim(state, "rotator", 2);

  state.registrations.set("w-rotator-new", "rotator"); // simulate rotation
  claim(state, { epochNumber: 3, claimant: "w-rotator-new", nowTs: during(3) });

  const r = proofOfTuesday(state, { identityHash: "rotator", asOfTs: after(3) });
  assert.equal(r.totalClaimedEpochs, 3, "the new wallet continues the same record");
  assert.equal(r.currentStreak, 3);
});

// ── Nothing is stored ───────────────────────────────────────────────────────
test("§37 — the record is derived, so there is nothing to forge or edit", () => {
  // If Proof of Tuesday were stored, an authority could adjust it and §37's ban
  // on editing claim history would be trivially bypassable. It must remain a
  // pure function of claim records.
  const state = world(3);
  join(state, "x");
  doClaim(state, "x", 1);

  const asOf = after(3);
  const a = proofOfTuesday(state, { identityHash: "x", asOfTs: asOf });
  const b = proofOfTuesday(state, { identityHash: "x", asOfTs: asOf });
  assert.deepEqual(a, b, "the same inputs must always give the same record");

  // No writable Proof of Tuesday state exists anywhere on the protocol state.
  assert.ok(!("proofOfTuesday" in state) && !("streaks" in state) && !("records" in state));
});

test("an unknown identity gets an empty record, not an error", () => {
  const state = world(3);
  const r = proofOfTuesday(state, { identityHash: "never-existed", asOfTs: after(3) });
  assert.equal(r.totalClaimedEpochs, 0);
  assert.equal(r.currentStreak, 0);
  assert.equal(r.firstEpoch, null);
  assert.equal(r.totalClaimed, 0n);
});

// ── The cultural claim ──────────────────────────────────────────────────────
test("PROOF OF TUESDAY > PROOF OF WEALTH — a whale cannot out-rank a regular", () => {
  // The whole §35 claim, as a test. A holder with an enormous balance who shows
  // up twice must rank below someone with nothing who shows up every week.
  const state = world(10);
  join(state, "whale");
  join(state, "regular");

  for (const k of [1, 2]) doClaim(state, "whale", k);
  for (let k = 1; k <= 10; k++) doClaim(state, "regular", k);

  const board = leaderboard(state, { asOfTs: after(10) });
  assert.equal(board[0].identityHash, "regular");
  assert.equal(board[1].identityHash, "whale");
  assert.equal(board[0].totalClaimedEpochs, 10);

  // And the board must not leak holdings — a participation board that prints
  // balances quietly becomes a rich list.
  for (const row of board) {
    assert.ok(!("balance" in row) && !("holdings" in row) && !("wallet" in row));
  }
});

test("ties break toward the longer streak, then the earlier joiner", () => {
  const state = world(6);
  join(state, "consistent");
  join(state, "sporadic");
  for (const k of [1, 2, 3]) doClaim(state, "consistent", k);   // streak 3
  for (const k of [1, 3, 5]) doClaim(state, "sporadic", k);     // streak 1

  const board = leaderboard(state, { asOfTs: after(6) });
  assert.equal(board[0].identityHash, "consistent", "equal counts, longer streak wins");
});

test("someone who never claimed is absent from the board, not ranked last", () => {
  const state = world(3);
  join(state, "lurker");
  const board = leaderboard(state, { asOfTs: after(3) });
  assert.equal(board.length, 0, "a board of non-participants is just a user list");
});

test("the doc admits the project can grant rank, not only that rank cannot be bought", () => {
  // §5's reassuring half — "you cannot buy a past Tuesday" — is true and
  // incomplete. Every record starts with a registration the project controls,
  // so the board's issuer can seed it, and the record being derived and
  // unforgeable protects its INTEGRITY, not its PROVENANCE. That is a sharper
  // limitation than the sybil one already listed, and the easiest to leave out.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const prose = (t) => t.replace(/^[ \t]*>[ \t]?/gm, "").replace(/[*`_]/g, "").replace(/\s+/g, " ");
  const doc = prose(readFileSync(resolve(repoRoot, "docs/cunt/CUNT-PROOF-OF-TUESDAY.md"), "utf8"));
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8"));

  assert.match(doc, /You cannot buy rank\. The project can grant it\./i);
  assert.match(doc, /measuring the issuer/i);
  // The multisig must not be presented as a fix for it.
  assert.equal(manifest.multisig.independent_signers, 0);
  assert.match(doc, /hard to steal; it does not make admissions reviewed/i);
  // And the doc must state what it may NOT be used to claim.
  assert.match(doc, /must not be cited as evidence that participation was organic/i);

  // The registry is the actual check, and it is unbuilt — so the gate item it
  // depends on may not be done while that is true.
  const gate = manifest.mainnet_gate.items.find((i) => i.id === "transparency_site");
  assert.notEqual(gate.status, "done", "the public registry is what makes admissions checkable");
});
