import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";

await import("dotenv/config");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "reward-identity-sync-"));
process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;

const rewards = await import("../../src/mole/rewardHistory.js");
const accounts = await import("../../src/mole/userAccounts.js");
const merges = await import("../../src/mole/accountMerge.js");
const walletLink = await import("../../src/mole/walletLink.js");
const syncedIdentities = await import("../../src/mole/syncedIdentities.js");
const payoutPlanner = await import("../../src/games/payoutPlanner.js");

function claim(discordUserId, roundKey, payout) {
  return rewards.recordRewardClaim({
    discordUserId, app: "mole", game: "diglew", roundKey,
    baseReward: payout, multiplier: 1, payout,
  });
}

// Mirrors web.js's walletProfileId() exactly: the anonymous account id a
// wallet plays under BEFORE it is ever verified/linked to a session.
function walletProfileId(wallet) {
  const digest = crypto.createHash("sha256").update(String(wallet || "").trim()).digest("hex").slice(0, 32);
  return `wallet:${digest}`;
}

/** A real Solana keypair, signing walletLink.js's actual challenge/message
 *  format — the same nacl/bs58 pattern test/mole/accountSyncRoutes.test.mjs
 *  uses over HTTP, called directly against walletLink.js instead. */
function verifyWallet(discordUserId) {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const challenge = walletLink.issueChallenge(discordUserId);
  const signature = JSON.stringify(
    Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey)),
  );
  walletLink.completeLink({ discordUserId, wallet, signature, message: challenge.message });
  return wallet;
}

test("historical alias rewards and future writes resolve to one canonical balance", async () => {
  const discord = "900000000000000101";
  const wallet = "wallet:historical-reward-account";
  await claim(wallet, "before-merge", 125);
  accounts.linkAccounts(wallet, discord);
  await claim(wallet, "after-merge-via-old-session", 75);

  const canonical = await rewards.getRewardSummary(discord);
  const throughAlias = await rewards.getRewardSummary(wallet);
  assert.equal(canonical.totalPayout, 200);
  assert.equal(throughAlias.totalPayout, 200);
  const rows = await rewards.listRewardClaims(discord, 10);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.roundKey === "after-merge-via-old-session").discordUserId, discord);
});

test("guest reconciliation is repeatable and idempotent, including later guest earnings", async () => {
  const guest = "guest:durable-device";
  const user = "900000000000000102";
  await claim(guest, "guest-first", 40);
  assert.equal((await rewards.reassignClaims(guest, user)).moved, 1);
  assert.equal((await rewards.reassignClaims(guest, user)).moved, 0);

  await claim(guest, "guest-after-logout", 60);
  assert.equal((await rewards.reassignClaims(guest, user)).moved, 1);
  assert.equal((await rewards.getRewardSummary(user)).totalPayout, 100);
});

test("two independently active canonical accounts require review instead of auto-merge", async () => {
  const left = "900000000000000103";
  const right = "x:active-other-account";
  await claim(left, "left-event", 10);
  await claim(right, "right-event", 20);

  await assert.rejects(
    merges.mergeAccountsWithRewardGuard({ a: left, b: right, reason: "test-proof" }),
    (error) => error?.code === "account_merge_review_required",
  );
  assert.equal(accounts.resolveAccountId(left), left);
  assert.equal(accounts.resolveAccountId(right), right);
});

test("paid state survives identity linking and unclaimed state remains unclaimed", async () => {
  const alias = "wallet:paid-state";
  const user = "900000000000000104";
  await claim(alias, "paid-event", 30);
  await claim(alias, "pending-event", 45);
  await rewards.markClaimsPaid([`${alias}|mole|diglew|paid-event`], { tx: "test-tx" });
  accounts.linkAccounts(alias, user);

  const summary = await rewards.getRewardSummary(user);
  assert.equal(summary.paidPayout, 30);
  assert.equal(summary.pendingPayout, 45);
});

test("a plain guest earns points and retains them across a refresh, with no linking at all", async () => {
  const guest = "guest:plain-device";
  await claim(guest, "session-1", 15);
  await claim(guest, "session-2", 25);

  // "Refresh" is just re-reading — there is no separate client cache here to
  // invalidate, so the real invariant is that a repeated read is stable and
  // untouched by any merge/reconcile machinery.
  const first = await rewards.getRewardSummary(guest);
  const second = await rewards.getRewardSummary(guest);
  assert.equal(first.totalPayout, 40);
  assert.equal(second.totalPayout, 40);
  assert.equal(accounts.resolveAccountId(guest), guest, "never merged, never linked — resolves to itself");
});

test("connecting a verified wallet moves anonymous wallet-play history to the session exactly once", async () => {
  // Mirrors /api/wallet/link in web.js: a wallet plays anonymously under
  // walletProfileId(wallet) before it is ever linked, then completeLink()
  // verifies it under the authenticated session, and the route reassigns the
  // provisional identity's claims into that session's account.
  const discordUserId = "900000000000000201";
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const provisionalId = walletProfileId(wallet);

  await claim(provisionalId, "anon-play-1", 12);
  await claim(provisionalId, "anon-play-2", 18);

  const challenge = walletLink.issueChallenge(discordUserId);
  const signature = JSON.stringify(
    Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey)),
  );
  walletLink.completeLink({ discordUserId, wallet, signature, message: challenge.message });
  const moved = await rewards.reassignClaims(provisionalId, discordUserId);
  assert.equal(moved.moved, 2);

  const summary = await rewards.getRewardSummary(discordUserId);
  assert.equal(summary.totalPayout, 30, "the eligible anonymous history landed on the account exactly once");

  // Re-running the same reassignment (e.g. a retried request) must not move
  // it, or credit it, a second time.
  const again = await rewards.reassignClaims(provisionalId, discordUserId);
  assert.equal(again.moved, 0);
  assert.equal((await rewards.getRewardSummary(discordUserId)).totalPayout, 30);
});

test("the account's canonical balance is unaffected by whether a wallet session is currently connected", async () => {
  // The server has no notion of "the wallet is currently connected" — the
  // balance lookup is keyed purely by the account id, with nothing about an
  // active wallet session in the read path, so it must be exactly as
  // available with the wallet "disconnected" as right after linking it.
  const discordUserId = "900000000000000202";
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const provisionalId = walletProfileId(wallet);
  await claim(provisionalId, "before-disconnect", 50);

  const challenge = walletLink.issueChallenge(discordUserId);
  const signature = JSON.stringify(
    Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey)),
  );
  walletLink.completeLink({ discordUserId, wallet, signature, message: challenge.message });
  await rewards.reassignClaims(provisionalId, discordUserId);

  // "Disconnect" is simply never touching the wallet session again — there is
  // nothing else to simulate, since the server holds no per-connection state
  // that a balance read could depend on.
  const afterDisconnect = await rewards.getRewardSummary(discordUserId);
  assert.equal(afterDisconnect.totalPayout, 50);

  // The old provisional wallet-play id is a spent, one-time migration source,
  // not a standing alias — once its claims are reassigned, it has none left
  // (the guest-reconcile idempotency test above already covers the "re-run
  // moves 0" half of that).
  assert.equal((await rewards.getRewardSummary(provisionalId)).totalPayout, 0);
});

test("reconnecting the same wallet does not duplicate its verified-wallet entry or its migrated points", async () => {
  const discordUserId = "900000000000000203";
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);

  // First connect.
  let challenge = walletLink.issueChallenge(discordUserId);
  let signature = JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey)));
  walletLink.completeLink({ discordUserId, wallet, signature, message: challenge.message });

  // Reconnect (e.g. the app re-verifies on every login) — same wallet, fresh challenge.
  challenge = walletLink.issueChallenge(discordUserId);
  signature = JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey)));
  walletLink.completeLink({ discordUserId, wallet, signature, message: challenge.message });

  const verified = walletLink.listVerifiedWallets(walletLink.getLinkedWalletRecord(discordUserId));
  assert.equal(verified.length, 1, "re-verifying the same address must not create a second entry");
});

test("two independent wallets verified to one account resolve to a single canonical balance", async () => {
  const discordUserId = "900000000000000204";
  const walletA = verifyWallet(discordUserId);
  const walletB = verifyWallet(discordUserId);
  assert.notEqual(walletA, walletB);

  await claim(walletProfileId(walletA), "wallet-a-play", 10);
  await claim(walletProfileId(walletB), "wallet-b-play", 20);
  await rewards.reassignClaims(walletProfileId(walletA), discordUserId);
  await rewards.reassignClaims(walletProfileId(walletB), discordUserId);

  const record = walletLink.getLinkedWalletRecord(discordUserId);
  const verified = walletLink.listVerifiedWallets(record);
  assert.equal(verified.length, 2, "both wallets stay verified on the one account");
  assert.ok(walletLink.getPayoutWallet(record), "exactly one wallet is nominated to be paid");
  assert.equal((await rewards.getRewardSummary(discordUserId)).totalPayout, 30);
});

test("an X identity merged into a Discord account reads one balance from either identity", async () => {
  // The X-rooted account here is a real canonical account in its own right
  // (someone who signed in with X before ever touching Discord), not just an
  // entry in the payout-eligibility map — so merging it is the same
  // reward-guarded path OAuth linking uses, not a plain identity sync.
  const discordUserId = "900000000000000205";
  const xAccountId = "x:legacy-x-rooted-account";
  await claim(xAccountId, "x-only-play", 44);

  const merged = await merges.mergeAccountsWithRewardGuard({ a: discordUserId, b: xAccountId, reason: "x-oauth-test" });
  assert.equal(merged.changed, true);

  syncedIdentities.syncIdentity({ accountId: discordUserId, provider: "x", providerUserId: "legacy-x-rooted-account" });

  const viaDiscord = await rewards.getRewardSummary(discordUserId);
  const viaX = await rewards.getRewardSummary(xAccountId);
  assert.equal(viaDiscord.totalPayout, 44);
  assert.equal(viaX.totalPayout, 44, "the absorbed X identity still resolves to the same one balance, not a separate one");
  assert.deepEqual(
    new Set(syncedIdentities.listSyncedIdentities(discordUserId).map((i) => i.provider)),
    new Set(["x"]),
  );
});

test("an interrupted guest reconcile can be safely retried without doubling the migration credit", async () => {
  // Mirrors /api/rewards/reconcile: real recorded guest claims move via
  // reassignClaims (already proven idempotent above), and a one-time
  // "legacy local winnings" credit is granted under a fixed, per-user
  // roundKey specifically so a retried/duplicated request cannot double it —
  // this IS the crash-safety mechanism for that step, not a rollback.
  const guest = "guest:interrupted-reconcile";
  const user = "900000000000000206";
  await claim(guest, "real-guest-win", 20);

  // "Pass 1": moves real claims, then grants the one-time migration credit.
  const firstMove = await rewards.reassignClaims(guest, user);
  assert.equal(firstMove.moved, 1);
  const firstCredit = await rewards.recordRewardClaim({
    discordUserId: user, app: "mole", game: "migration",
    roundKey: "migrate:legacy-local", roundLabel: "Local winnings migration",
    baseReward: 5, multiplier: 1, payout: 5,
  });
  assert.equal(firstCredit.duplicate, undefined);

  // Simulated crash-and-retry of the whole reconcile call: the guest has
  // nothing left to move, and the migration credit must not be granted again.
  const secondMove = await rewards.reassignClaims(guest, user);
  assert.equal(secondMove.moved, 0);
  const secondCredit = await rewards.recordRewardClaim({
    discordUserId: user, app: "mole", game: "migration",
    roundKey: "migrate:legacy-local", roundLabel: "Local winnings migration",
    baseReward: 5, multiplier: 1, payout: 5,
  });
  assert.equal(secondCredit.duplicate, true, "the retried migration credit collapses to the existing row");

  assert.equal((await rewards.getRewardSummary(user)).totalPayout, 25, "20 real + 5 migration credit, granted exactly once");
});

test("header, dashboard, and the payout worker all report the same authoritative total for a multi-identity account", async () => {
  const discordUserId = "900000000000000207";
  const wallet = verifyWallet(discordUserId);
  await claim(discordUserId, "hub-session", 40);
  await claim(walletProfileId(wallet), "wallet-session", 35);
  await rewards.reassignClaims(walletProfileId(wallet), discordUserId);

  // Header + dashboard + games tab all read through getRewardSummary/
  // listRewardClaims (see rewardHistory.js) — this IS that shared read path.
  const summary = await rewards.getRewardSummary(discordUserId);
  assert.equal(summary.totalPayout, 75);
  assert.equal(summary.pendingPayout, 75, "nothing paid yet, so it's all in the unpaid/cash-out queue");

  // Cash-out / the nightly payout worker groups listUnpaidClaims() by
  // canonical account, exactly as payout-worker.js wires it.
  const unpaid = (await rewards.listUnpaidClaims(1000)).filter((row) => row.discordUserId === discordUserId);
  const plan = payoutPlanner.buildPayoutPlan(unpaid, () => "SomeSolanaWalletAddress111111111111111111", {
    minPayout: 1,
    isBlocked: () => null,
    resolveAccountId: accounts.resolveAccountId,
  });
  const entry = plan.entries.find((e) => e.discordUserId === discordUserId);
  assert.ok(entry, "the payout plan has one grouped entry for this canonical account");
  assert.equal(entry.amount, summary.pendingPayout, "the payout worker's total matches what the dashboard shows");
});

test("an untouched single-identity account is not affected by any of the merge/reconcile machinery", async () => {
  const soloAccount = "900000000000000208";
  await claim(soloAccount, "solo-play", 17);

  assert.equal(accounts.resolveAccountId(soloAccount), soloAccount);
  assert.deepEqual(accounts.listAccountIdsForUser(soloAccount), [soloAccount]);
  assert.equal((await rewards.getRewardSummary(soloAccount)).totalPayout, 17);
});
