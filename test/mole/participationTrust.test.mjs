// The participation risk engine — Stage 3.
//
// These are the threat-model cases from the plan. The household case is first
// on purpose: it is the one where being wrong hurts an innocent person, and
// "same IP therefore fraud" is the failure mode this engine exists to avoid.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { evaluateParticipation, BANDS, RULES_VERSION, THRESHOLDS } from "../../src/mole/participationTrust.js";

const HOUR = 60 * 60 * 1000;
const now = Date.now();

const row = (userId, deviceHash, netHash, extra = {}) => ({
  userId, deviceHash, netHash, ts: now - HOUR, answerBucket: "3_10s", ...extra,
});

describe("legitimate people must not be flagged", () => {
  test("a normal user scores clean", () => {
    const participation = Array.from({ length: 12 }, () => row("alice", "devA", "net1"));
    const r = evaluateParticipation({ userId: "alice", participation });
    assert.equal(r.band, BANDS.NORMAL);
    assert.equal(r.rulesVersion, RULES_VERSION);
  });

  test("a HOUSEHOLD — same network, different devices — is not flagged", () => {
    // Three people, one router, three machines. This must stay normal, and it
    // is the single most important assertion in this file.
    const participation = [
      ...Array.from({ length: 10 }, () => row("alice", "devA", "net1")),
      ...Array.from({ length: 10 }, () => row("bob", "devB", "net1")),
      ...Array.from({ length: 10 }, () => row("carol", "devC", "net1")),
    ];
    const r = evaluateParticipation({ userId: "alice", participation });
    assert.equal(r.band, BANDS.NORMAL, `household flagged as ${r.band}: ${r.signals.join(", ")}`);
    assert.ok(r.signals.includes("shared_network_only"), "the shared network should be noted, just not punished");
  });

  test("a shared family device with two people is still normal", () => {
    const participation = [
      ...Array.from({ length: 10 }, () => row("alice", "shared", "net1")),
      ...Array.from({ length: 10 }, () => row("bob", "shared", "net1")),
    ];
    assert.equal(evaluateParticipation({ userId: "alice", participation }).band, BANDS.NORMAL);
  });

  test("a VPN or mobile user — network changes, device stable — is normal", () => {
    const participation = [
      row("alice", "devA", "net1"), row("alice", "devA", "net2"),
      row("alice", "devA", "net3"), row("alice", "devA", "net4"),
    ];
    assert.equal(evaluateParticipation({ userId: "alice", participation }).band, BANDS.NORMAL);
  });

  test("no signal at all is clean, never suspicious", () => {
    // Discord-only players, and anyone who blocks everything. This must never
    // become "you didn't let us fingerprint you, so you're a suspect".
    const r = evaluateParticipation({ userId: "ghost", participation: [] });
    assert.equal(r.band, BANDS.NORMAL);
    assert.deepEqual(r.signals, ["no_signal"]);
  });
});

describe("the actual abuse is caught", () => {
  test("many identities on one device scores suspicious", () => {
    const participation = ["a", "b", "c", "d", "e"].flatMap((u) =>
      Array.from({ length: 5 }, () => row(u, "farmDev", "net9")));
    const r = evaluateParticipation({ userId: "a", participation });
    assert.ok(r.score >= THRESHOLDS.SUSPICIOUS_AT, `scored ${r.score}: ${r.signals.join(", ")}`);
    assert.ok(r.signals.includes("many_identities_one_device"));
  });

  test("the observed pattern — one device, many wallets, swap right after payout — is HELD", () => {
    // 2026-08-14: buy dust, redeem, move the payout to another wallet, repeat.
    const participation = ["a", "b", "c", "d"].flatMap((u) =>
      Array.from({ length: 5 }, () => row(u, "farmDev", "net9")));
    const r = evaluateParticipation({
      userId: "a",
      participation,
      recentPayouts: [{ userId: "a", paidTs: now - 3 * HOUR }, { userId: "a", paidTs: now - 2 * HOUR }],
      walletChanges: [{ ts: now - 3 * HOUR + 5 * 60_000 }, { ts: now - 2 * HOUR + 5 * 60_000 }],
    });
    assert.equal(r.band, BANDS.HELD, `scored ${r.score}: ${r.signals.join(", ")}`);
    assert.ok(r.signals.includes("repeated_wallet_swap_after_payout"));
  });

  test("machine-like answer cadence is scored", () => {
    const participation = Array.from({ length: 20 }, () => row("bot", "devB", "net1", { answerBucket: "under_1s" }));
    const r = evaluateParticipation({ userId: "bot", participation });
    assert.ok(r.signals.includes("machine_like_answer_cadence"));
  });

  test("a funding-cluster hit weighs heavily on its own", () => {
    const participation = Array.from({ length: 5 }, () => row("a", "devA", "net1"));
    const r = evaluateParticipation({ userId: "a", participation, clusterHit: true });
    assert.ok(r.score >= THRESHOLDS.SUSPICIOUS_AT, `cluster hit only scored ${r.score}`);
  });
});

describe("scoring discipline", () => {
  test("a shared network alone can never move a band", () => {
    // Even at absurd scale — a whole university or a CGNAT carrier.
    const participation = Array.from({ length: 60 }, (_, i) => row(`u${i}`, `dev${i}`, "netBig"));
    participation.push(row("alice", "devAlice", "netBig"));
    const r = evaluateParticipation({ userId: "alice", participation });
    assert.equal(r.band, BANDS.NORMAL, `${r.score} from network sharing alone: ${r.signals.join(", ")}`);
  });

  test("the score is bounded and every signal is named", () => {
    const participation = ["a", "b", "c", "d", "e"].flatMap((u) =>
      Array.from({ length: 15 }, () => row(u, "d", "n", { answerBucket: "under_1s" })));
    const r = evaluateParticipation({
      userId: "a", participation, clusterHit: true,
      recentPayouts: [{ userId: "a", paidTs: now - HOUR }],
      walletChanges: [{ ts: now - HOUR + 60_000 }, { ts: now - HOUR + 120_000 }],
    });
    assert.ok(r.score <= 100 && r.score >= 0);
    assert.ok(r.signals.length > 0 && r.signals.every((s) => typeof s === "string"));
  });

  test("it is pure — same input, same verdict", () => {
    const participation = [row("a", "devA", "net1"), row("b", "devA", "net1")];
    const one = evaluateParticipation({ userId: "a", participation, now });
    const two = evaluateParticipation({ userId: "a", participation, now });
    assert.deepEqual(one, two);
  });
});
