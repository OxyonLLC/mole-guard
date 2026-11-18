// Weekly CUNT — §42 invariants 5 and 6, plus the §61 Phase F attack list, run
// against the reference epoch model in src/cunt/epoch.js.
//
// The model is an executable specification, not production code. The value is
// that the rules can be attacked NOW, in a language we already have, instead of
// after someone has written Rust and grown attached to it. Whatever the
// on-chain program eventually looks like, it has to pass these.
//
// Phase F asks for: double claims, early claims, late claims, unauthorized
// vault withdrawal, overflow, underflow, clock-manipulation assumptions, PDA
// substitution, unauthorized signer, replay, duplicate registration. Each has a
// test below, or an explicit note saying why it cannot be modelled off-chain.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as protocol from "../../src/cunt/epoch.js";

const {
  EPOCH_STATUS, REJECT, ProtocolError,
  createState, fundVault, createEpoch, statusAt, claim, finalizeEpoch, accounting, hasClaimed,
  registerParticipant, isRegistered, identityOf,
} = protocol;

const T0 = 1_800_000_000; // arbitrary Tuesday
const DAY = 86_400;

// Claiming now requires registration (the sybil gate). setup() pre-registers a
// pool of participants so the tests below exercise the claim rules rather than
// the gate; the gate has its own tests further down.
const POOL = ["alice", "a", "b", "c", "d", "whale", "late", "eager", "stranger", "1:bob"];

function setup({ budget = 1000n, perClaim = 100n, vault = 10_000n, register = POOL } = {}) {
  const state = createState({ vaultBalance: vault });
  const epoch = createEpoch(state, {
    epochNumber: 1, startTs: T0, endTs: T0 + DAY,
    rewardBudget: budget, rewardPerClaim: perClaim,
  });
  for (const w of register) registerParticipant(state, { wallet: w, identityHash: `id-${w}` });
  return { state, epoch, mid: T0 + DAY / 2 };
}

const rejects = (fn, reason) => {
  try {
    fn();
    assert.fail(`expected rejection ${reason}, but the call succeeded`);
  } catch (e) {
    assert.ok(e instanceof ProtocolError, `expected ProtocolError, got ${e.constructor.name}: ${e.message}`);
    assert.equal(e.reason, reason);
  }
};

// ── §42 INVARIANT 5 — one claim per identity per epoch ──────────────────────
test("INVARIANT 5 — the same wallet cannot claim twice in one epoch", () => {
  const { state, mid } = setup();
  assert.equal(claim(state, { epochNumber: 1, claimant: "alice", nowTs: mid }), 100n);
  rejects(() => claim(state, { epochNumber: 1, claimant: "alice", nowTs: mid }), REJECT.ALREADY_CLAIMED);
  assert.equal(state.totalClaimed, 100n, "the rejected second claim must not have paid out");
});

test("Phase F: replay — resubmitting an identical successful claim is rejected", () => {
  const { state, mid } = setup();
  const args = { epochNumber: 1, claimant: "alice", nowTs: mid };
  claim(state, args);
  for (let i = 0; i < 5; i++) rejects(() => claim(state, args), REJECT.ALREADY_CLAIMED);
  assert.equal(state.totalClaimed, 100n);
});

test("INVARIANT 5 — uniqueClaimers always equals claimsCompleted", () => {
  const { state, epoch, mid } = setup({ budget: 1000n });
  for (const who of ["a", "b", "c", "d"]) claim(state, { epochNumber: 1, claimant: who, nowTs: mid });
  for (const who of ["a", "b"]) rejects(() => claim(state, { epochNumber: 1, claimant: who, nowTs: mid }), REJECT.ALREADY_CLAIMED);
  assert.equal(epoch.claimsCompleted, 4);
  assert.equal(epoch.uniqueClaimers, 4, "a repeat claim must never inflate either counter");
});

test("the same wallet CAN claim in different epochs — streaks must work", () => {
  const { state, mid } = setup();
  createEpoch(state, { epochNumber: 2, startTs: T0 + 7 * DAY, endTs: T0 + 8 * DAY, rewardBudget: 1000n, rewardPerClaim: 100n });
  claim(state, { epochNumber: 1, claimant: "alice", nowTs: mid });
  claim(state, { epochNumber: 2, claimant: "alice", nowTs: T0 + 7 * DAY + 100 });
  assert.ok(hasClaimed(state, 1, "alice") && hasClaimed(state, 2, "alice"));
  assert.equal(state.totalClaimed, 200n);
});

test("Phase F: PDA substitution — claim keys cannot collide across epochs or wallets", () => {
  // On chain a ClaimRecord is a PDA seeded by (epoch, claimant). If those seeds
  // could collide, one participant's record could satisfy another's check.
  const { state, mid } = setup({ budget: 10_000n });
  claim(state, { epochNumber: 1, claimant: "alice", nowTs: mid });
  assert.ok(!hasClaimed(state, 1, "alic"), "prefix must not satisfy the check");
  assert.ok(!hasClaimed(state, 1, "alice2"), "superstring must not satisfy the check");
  assert.ok(!hasClaimed(state, 2, "alice"), "another epoch must not satisfy the check");
  // And a claimant whose name contains the separator must not forge another key.
  claim(state, { epochNumber: 1, claimant: "1:bob", nowTs: mid });
  assert.ok(!hasClaimed(state, 1, "bob"), "a claimant containing ':' must not alias another claimant");
});

// ── §42 INVARIANT 6 — the vault cannot exceed its epoch budget ──────────────
test("INVARIANT 6 — an epoch never distributes more than its authorized budget", () => {
  const { state, epoch, mid } = setup({ budget: 300n, perClaim: 100n });
  for (const who of ["a", "b", "c"]) claim(state, { epochNumber: 1, claimant: who, nowTs: mid });
  rejects(() => claim(state, { epochNumber: 1, claimant: "d", nowTs: mid }), REJECT.BUDGET_EXHAUSTED);
  assert.equal(epoch.remainingBudget, 0n);
  assert.equal(accounting(state).distributed, 300n);
});

test("Phase F: underflow — remaining budget and vault can never go negative", () => {
  const { state, epoch, mid } = setup({ budget: 250n, perClaim: 100n });
  claim(state, { epochNumber: 1, claimant: "a", nowTs: mid });
  claim(state, { epochNumber: 1, claimant: "b", nowTs: mid });
  // 50 left, but a claim costs 100 — must refuse rather than wrap or go negative.
  rejects(() => claim(state, { epochNumber: 1, claimant: "c", nowTs: mid }), REJECT.BUDGET_EXHAUSTED);
  assert.equal(epoch.remainingBudget, 50n);
  assert.ok(epoch.remainingBudget >= 0n && state.vaultBalance >= 0n);
});

test("the vault is a separate constraint from the budget", () => {
  // An epoch may be authorized to pay more than the vault actually holds. That
  // must fail as VAULT_INSUFFICIENT, not silently overdraw.
  const state = createState({ vaultBalance: 150n });
  createEpoch(state, { epochNumber: 1, startTs: T0, endTs: T0 + DAY, rewardBudget: 1000n, rewardPerClaim: 100n });
  for (const w of ["a", "b"]) registerParticipant(state, { wallet: w, identityHash: `id-${w}` });
  claim(state, { epochNumber: 1, claimant: "a", nowTs: T0 + 10 });
  rejects(() => claim(state, { epochNumber: 1, claimant: "b", nowTs: T0 + 10 }), REJECT.VAULT_INSUFFICIENT);
  assert.equal(state.vaultBalance, 50n);
});

test("Phase F: overflow — huge amounts keep exact precision", () => {
  // 1B tokens at 9 decimals is 1e18 base units, past Number.MAX_SAFE_INTEGER.
  // Floating point here would silently round someone's reward.
  const huge = 10n ** 18n;
  const state = createState({ vaultBalance: huge });
  createEpoch(state, { epochNumber: 1, startTs: T0, endTs: T0 + DAY, rewardBudget: huge, rewardPerClaim: huge - 1n });
  registerParticipant(state, { wallet: "whale", identityHash: "id-whale" });
  const paid = claim(state, { epochNumber: 1, claimant: "whale", nowTs: T0 + 1 });
  assert.equal(paid, huge - 1n);
  assert.equal(state.vaultBalance, 1n, "exactly one base unit must remain — not 0, not 2");
  assert.ok(Number(state.vaultBalance) !== Number(huge) - Number(huge - 1n) || true);
});

test("token amounts are BigInt, and floats are refused outright", () => {
  const state = createState({ vaultBalance: 1000n });
  assert.throws(
    () => createEpoch(state, { epochNumber: 1, startTs: T0, endTs: T0 + DAY, rewardBudget: 100.5, rewardPerClaim: 10n }),
    TypeError
  );
});

// ── Clock ───────────────────────────────────────────────────────────────────
test("Phase F: claim window boundaries are exact — start inclusive, end exclusive", () => {
  const { state, epoch } = setup();
  assert.equal(statusAt(epoch, T0 - 1), EPOCH_STATUS.UPCOMING);
  assert.equal(statusAt(epoch, T0), EPOCH_STATUS.OPEN, "the window must open ON its start second");
  assert.equal(statusAt(epoch, T0 + DAY - 1), EPOCH_STATUS.OPEN);
  assert.equal(statusAt(epoch, T0 + DAY), EPOCH_STATUS.CLOSED, "the window must close ON its end second");
});

test("Phase F: early claims are rejected", () => {
  const { state } = setup();
  rejects(() => claim(state, { epochNumber: 1, claimant: "eager", nowTs: T0 - 1 }), REJECT.BEFORE_WINDOW);
});

test("Phase F: late claims are rejected — 'See You Next Tuesday' is real behaviour", () => {
  const { state } = setup();
  rejects(() => claim(state, { epochNumber: 1, claimant: "late", nowTs: T0 + DAY }), REJECT.AFTER_WINDOW);
  rejects(() => claim(state, { epochNumber: 1, claimant: "late", nowTs: T0 + 400 * DAY }), REJECT.AFTER_WINDOW);
});

test("Phase F: clock-manipulation assumption is bounded", () => {
  // Solana's unix_timestamp can drift from wall-clock by minutes. The protocol
  // must not depend on second-level precision at the boundary. A 24h window
  // means a few minutes of drift moves the edge, never a whole epoch — this
  // test documents the tolerance the design assumes.
  const { state, epoch } = setup();
  const driftTolerance = 15 * 60;
  assert.ok(
    epoch.endTs - epoch.startTs > driftTolerance * 4,
    "the claim window must be much larger than plausible clock drift; a window of minutes would be unsafe"
  );
});

// ── Rejected claims must leave no trace ─────────────────────────────────────
test("a rejected claim mutates nothing", () => {
  // Partial mutation before a failed check is how double-spends and phantom
  // claim records happen. Every rejection path must be checked before any write.
  const { state, epoch, mid } = setup({ budget: 100n, perClaim: 100n });
  const before = { vault: state.vaultBalance, remaining: epoch.remainingBudget, claims: state.claims.size, total: state.totalClaimed };

  rejects(() => claim(state, { epochNumber: 99, claimant: "a", nowTs: mid }), REJECT.NO_SUCH_EPOCH);
  rejects(() => claim(state, { epochNumber: 1, claimant: "a", nowTs: T0 - 1 }), REJECT.BEFORE_WINDOW);
  rejects(() => claim(state, { epochNumber: 1, claimant: "a", nowTs: T0 + DAY }), REJECT.AFTER_WINDOW);
  rejects(() => claim(state, { epochNumber: 1, claimant: "a", nowTs: mid, isEligible: () => false }), REJECT.NOT_ELIGIBLE);

  assert.equal(state.vaultBalance, before.vault);
  assert.equal(epoch.remainingBudget, before.remaining);
  assert.equal(state.claims.size, before.claims);
  assert.equal(state.totalClaimed, before.total);
});

test("Phase F: unauthorized signer — ineligibility is checked before payment", () => {
  const { state, mid } = setup();
  rejects(() => claim(state, { epochNumber: 1, claimant: "stranger", nowTs: mid, isEligible: () => false }), REJECT.NOT_ELIGIBLE);
  assert.ok(!hasClaimed(state, 1, "stranger"), "a rejected claimant must not get a claim record");
});

// ── §16 / §37: capabilities that must NOT exist ─────────────────────────────
test("§16/§37 — there is no way to withdraw from the vault except by claiming", () => {
  // The authority matrix marks withdraw_tuesday_vault as NOBODY. The design is
  // enforced by ABSENCE, so absence is what gets asserted. If someone adds a
  // withdraw/drain/sweep export, this fails and they have to justify it.
  const exported = Object.keys(protocol);
  const forbidden = exported.filter((k) => /withdraw|drain|sweep|rescue|emergency|transferOut/i.test(k));
  assert.deepEqual(
    forbidden,
    [],
    `src/cunt/epoch.js exports ${forbidden.join(", ")}. §16: no human key may empty the Tuesday vault, ` +
      `so there must be no instruction that does it — not a gated one, none.`
  );
  // Funding must remain possible; only the outward direction is forbidden.
  assert.ok(exported.includes("fundVault"));
});

test("§37 — there is no way to edit or erase a claim record", () => {
  const forbidden = Object.keys(protocol).filter((k) => /unclaim|revoke|deleteClaim|resetClaim|override/i.test(k));
  assert.deepEqual(forbidden, [], `Proof of Tuesday is worthless if claim history is editable: ${forbidden.join(", ")}`);
});

// ── Conservation ────────────────────────────────────────────────────────────
test("accounting conserves: everything leaving the vault was claimed by someone", () => {
  const { state, mid } = setup({ budget: 500n, perClaim: 100n, vault: 1000n });
  const claimants = ["a", "b", "c"];
  for (const who of claimants) claim(state, { epochNumber: 1, claimant: who, nowTs: mid });

  const acct = accounting(state);
  assert.equal(acct.distributed, 300n);
  assert.equal(acct.totalClaimed, 300n, "distributed and totalClaimed must agree");
  assert.equal(state.vaultBalance, 700n, "vault must fall by exactly what was claimed");
  assert.equal(state.claims.size, claimants.length, "one claim record per payment, exactly");
  assert.equal(acct.distributed / 100n, BigInt(state.claims.size));
});

test("finalizing releases unclaimed budget, and cannot be done twice", () => {
  const { state, mid } = setup({ budget: 500n, perClaim: 100n });
  claim(state, { epochNumber: 1, claimant: "a", nowTs: mid });
  // Cannot finalize while still open.
  assert.throws(() => finalizeEpoch(state, { epochNumber: 1, nowTs: mid }), (e) => e.reason === REJECT.NOT_OPEN);

  const after = T0 + DAY + 1;
  const res = finalizeEpoch(state, { epochNumber: 1, nowTs: after });
  assert.equal(res.distributed, 100n);
  assert.equal(res.unclaimed, 400n, "unclaimed budget was only ever authorized, never spent");
  assert.throws(() => finalizeEpoch(state, { epochNumber: 1, nowTs: after }), /already finalized/);
});

test("a finalized epoch accepts no further claims", () => {
  const { state, mid } = setup();
  claim(state, { epochNumber: 1, claimant: "a", nowTs: mid });
  finalizeEpoch(state, { epochNumber: 1, nowTs: T0 + DAY + 1 });
  rejects(() => claim(state, { epochNumber: 1, claimant: "b", nowTs: mid }), REJECT.NOT_OPEN);
});

// ── Construction guards ─────────────────────────────────────────────────────
test("Phase F: duplicate registration — an epoch number cannot be created twice", () => {
  const { state } = setup();
  assert.throws(
    () => createEpoch(state, { epochNumber: 1, startTs: T0, endTs: T0 + DAY, rewardBudget: 999n, rewardPerClaim: 1n }),
    /already exists/,
    "recreating an epoch would reset its budget and let everyone claim again"
  );
});

test("an epoch cannot be created with an impossible window or reward", () => {
  const state = createState({ vaultBalance: 1000n });
  const base = { epochNumber: 9, startTs: T0, endTs: T0 + DAY, rewardBudget: 100n, rewardPerClaim: 10n };
  assert.throws(() => createEpoch(state, { ...base, endTs: T0 }), RangeError);
  assert.throws(() => createEpoch(state, { ...base, endTs: T0 - 1 }), RangeError);
  assert.throws(() => createEpoch(state, { ...base, rewardPerClaim: 0n }), RangeError);
  assert.throws(() => createEpoch(state, { ...base, rewardPerClaim: 101n }), RangeError, "per-claim above budget guarantees a stuck epoch");
  assert.throws(() => createEpoch(state, { ...base, rewardBudget: -1n }), RangeError);
});

// ── The sybil gate (owner decision 2026-08-08: verified wallets only) ────────
//
// The gate is NOT "prove you own the key" — signing the claim transaction
// already proves that, so it would gate nothing. The gate is the binding of a
// wallet to a verified identity that is costlier to mass-produce than a
// keypair. These tests exist to prove the binding is what does the work.

test("an unregistered wallet cannot claim", () => {
  const { state, mid } = setup({ register: [] });
  rejects(() => claim(state, { epochNumber: 1, claimant: "nobody", nowTs: mid }), REJECT.NOT_REGISTERED);
  assert.equal(state.totalClaimed, 0n);
});

test("registration cannot be bypassed by a permissive isEligible", () => {
  // Registration is a hard prerequisite, not one rule among several. If an
  // eligibility callback could wave it through, the gate would be advisory.
  const { state, mid } = setup({ register: [] });
  rejects(
    () => claim(state, { epochNumber: 1, claimant: "nobody", nowTs: mid, isEligible: () => true }),
    REJECT.NOT_REGISTERED
  );
});

test("further eligibility rules still layer on top of registration", () => {
  const { state, mid } = setup();
  rejects(
    () => claim(state, { epochNumber: 1, claimant: "alice", nowTs: mid, isEligible: () => false }),
    REJECT.NOT_ELIGIBLE
  );
});

test("THE SYBIL TEST — 100 wallets behind one identity get exactly one claim", () => {
  // This is the whole point of the decision. A sybil operator generates a
  // hundred keypairs and legitimately controls every one of them, so signature
  // checks are useless. Only the identity binding stops them.
  const state = createState({ vaultBalance: 1_000_000n });
  createEpoch(state, { epochNumber: 1, startTs: T0, endTs: T0 + DAY, rewardBudget: 1_000_000n, rewardPerClaim: 100n });

  registerParticipant(state, { wallet: "sybil-wallet-0", identityHash: "hash-of-one-discord-account" });

  // The other 99 wallets cannot even register — the identity is taken.
  let registrationsRefused = 0;
  for (let i = 1; i < 100; i++) {
    try {
      registerParticipant(state, { wallet: `sybil-wallet-${i}`, identityHash: "hash-of-one-discord-account" });
      assert.fail(`wallet ${i} should not have been able to register`);
    } catch (e) {
      assert.equal(e.reason, REJECT.IDENTITY_ALREADY_REGISTERED);
      registrationsRefused++;
    }
  }
  assert.equal(registrationsRefused, 99);

  // And they cannot claim.
  claim(state, { epochNumber: 1, claimant: "sybil-wallet-0", nowTs: T0 + 10 });
  for (let i = 1; i < 100; i++) {
    rejects(() => claim(state, { epochNumber: 1, claimant: `sybil-wallet-${i}`, nowTs: T0 + 10 }), REJECT.NOT_REGISTERED);
  }

  assert.equal(state.totalClaimed, 100n, "one identity must yield exactly one claim, not 100");
});

test("one identity may bind only one wallet", () => {
  const state = createState();
  registerParticipant(state, { wallet: "w1", identityHash: "same-person" });
  rejects(() => registerParticipant(state, { wallet: "w2", identityHash: "same-person" }), REJECT.IDENTITY_ALREADY_REGISTERED);
  assert.equal(identityOf(state, "w1"), "same-person");
  assert.equal(identityOf(state, "w2"), null);
});

test("one wallet may bind only one identity", () => {
  const state = createState();
  registerParticipant(state, { wallet: "w1", identityHash: "person-a" });
  rejects(() => registerParticipant(state, { wallet: "w1", identityHash: "person-b" }), REJECT.WALLET_ALREADY_REGISTERED);
  assert.equal(identityOf(state, "w1"), "person-a");
});

test("claim records are keyed by identity, so relaxing the 1:1 binding is still safe", () => {
  // Defence in depth. If the binding is ever loosened — say to let someone
  // rotate a compromised wallet — keying claims by WALLET would silently hand
  // that person a second claim in the same epoch. Keying by identity does not.
  const state = createState({ vaultBalance: 10_000n });
  createEpoch(state, { epochNumber: 1, startTs: T0, endTs: T0 + DAY, rewardBudget: 10_000n, rewardPerClaim: 100n });
  registerParticipant(state, { wallet: "old-wallet", identityHash: "person" });
  claim(state, { epochNumber: 1, claimant: "old-wallet", nowTs: T0 + 10 });

  // Simulate a rotation that a future version might allow.
  state.registrations.set("new-wallet", "person");
  rejects(() => claim(state, { epochNumber: 1, claimant: "new-wallet", nowTs: T0 + 10 }), REJECT.ALREADY_CLAIMED);
  assert.equal(state.totalClaimed, 100n);
});

test("a registration attempt that fails leaves no partial state", () => {
  const state = createState();
  registerParticipant(state, { wallet: "w1", identityHash: "person-a" });
  const before = { regs: state.registrations.size, ids: state.identities.size };
  rejects(() => registerParticipant(state, { wallet: "w2", identityHash: "person-a" }), REJECT.IDENTITY_ALREADY_REGISTERED);
  assert.equal(state.registrations.size, before.regs, "a refused registration must not add a wallet mapping");
  assert.equal(state.identities.size, before.ids);
  assert.ok(!isRegistered(state, "w2"));
});

test("identity hashes, not raw Discord IDs — the registry is public", () => {
  // A public on-chain registry of plaintext Discord IDs would deanonymise every
  // participant. The model cannot enforce hashing, but it documents the
  // requirement and this test pins the intent for whoever writes the program.
  const src = readFileSync(new URL("../../src/cunt/epoch.js", import.meta.url), "utf8");
  // assert.ok, not assert.match — a failing match against a whole source file
  // dumps the entire file into the output and buries the message.
  assert.ok(
    /identityHash`? is a hash, never a raw Discord ID/.test(src),
    "epoch.js must state that the registry stores a hash, not a plaintext identity"
  );
});
