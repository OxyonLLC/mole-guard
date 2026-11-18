// Each HODL payout row links its own transaction, never the whole batch's.
import test from "node:test";
import assert from "node:assert/strict";
import { signatureForAllocation, transferId } from "../../src/mole/hodlBatch.js";

const snap = {
  epochId: "E1", weekIndex: 1,
  allocations: [
    { discordUserId: "a", payoutWallet: "WalletA", amount: 2500 },
    { discordUserId: "b", payoutWallet: "WalletB", amount: 2500 },
    { discordUserId: "c", payoutWallet: "WalletC", amount: 1387 },
  ],
  batch: { chunks: [
    { index: 0, signature: "SIG_A", transfers: [{ transferId: transferId("E1", 1, "a"), payoutWallet: "WalletA", amount: 2500 }] },
    { index: 1, signature: "SIG_B", transfers: [{ transferId: transferId("E1", 1, "b"), payoutWallet: "WalletB", amount: 2500 }] },
    { index: 2, signature: "SIG_C", transfers: [{ transferId: transferId("E1", 1, "c"), payoutWallet: "WalletC", amount: 1387 }] },
  ] },
};

test("every allocation gets its own chunk's signature", () => {
  assert.deepEqual(snap.allocations.map((a) => signatureForAllocation(snap, a)), ["SIG_A", "SIG_B", "SIG_C"]);
});

test("an older batch without transferIds still matches by wallet and amount", () => {
  const old = structuredClone(snap);
  for (const c of old.batch.chunks) for (const t of c.transfers) delete t.transferId;
  assert.equal(signatureForAllocation(old, old.allocations[2]), "SIG_C");
});

test("no chunk for the allocation, or no signature yet: null, never a guess", () => {
  assert.equal(signatureForAllocation(snap, { discordUserId: "z", payoutWallet: "WalletZ", amount: 1 }), null);
  const unsent = structuredClone(snap);
  delete unsent.batch.chunks[1].signature;
  assert.equal(signatureForAllocation(unsent, unsent.allocations[1]), null);
});
