// The one property no file-fallback test can exercise: recordRewardClaim's
// real MongoDB unique compound index + atomic upsert, which is the actual
// fix for "never pay the same event twice" (see rewardHistory.js).
//
// SKIPPED BY DEFAULT. This repo's .env points MONGO_URI at what is very
// likely the production cluster (the identity audit that motivated this file
// independently confirmed real production data through it). This suite must
// never run against that database by accident, so:
//
//   1. It only runs at all with RUN_MONGO_INTEGRATION_TESTS=1 set explicitly.
//   2. Even then, it overrides MONGO_DATABASE to a fresh, timestamped,
//      throwaway database name on the SAME cluster — never the configured
//      default — and drops that whole database when it's done.
//
// Run it with:
//   RUN_MONGO_INTEGRATION_TESTS=1 node --test test/mole/rewardHistoryMongoIntegration.test.mjs
import "dotenv/config";

const RUN = process.env.RUN_MONGO_INTEGRATION_TESTS === "1";

const { test, describe, after } = await import("node:test");
const assert = (await import("node:assert/strict")).default;

if (!RUN) {
  test("mongo integration tests skipped (set RUN_MONGO_INTEGRATION_TESTS=1 to run)", { skip: true }, () => {});
} else {
  if (!String(process.env.MONGO_URI || "").trim()) {
    throw new Error("RUN_MONGO_INTEGRATION_TESTS=1 but no MONGO_URI is configured");
  }

  process.env.MONGO_ENABLED = "true";
  // Never the configured/default database (see header comment above) — a
  // fresh throwaway name per run, dropped in `after`.
  const THROWAWAY_DB = `mole_guard_test_${Date.now()}_${process.pid}`;
  process.env.MONGO_DATABASE = THROWAWAY_DB;
  process.env.MOLE_GAME_REWARD_HISTORY_COLLECTION = "mole_game_reward_history_test";

  const rewards = await import("../../src/mole/rewardHistory.js");
  const { getMongoDb, closeMongo } = await import("../../src/lib/mongo.js");

  describe(`recordRewardClaim against a real, isolated Mongo database (${THROWAWAY_DB})`, () => {
    after(async () => {
      const db = await getMongoDb();
      if (db?.databaseName === THROWAWAY_DB) await db.dropDatabase();
      else console.warn(`[mongo-integration-test] refused to drop unexpected database "${db?.databaseName}" — not "${THROWAWAY_DB}"`);
      await closeMongo();
    });

    test("concurrent duplicate claims for the same round collapse to exactly one row", async () => {
      const args = {
        discordUserId: "mongo-itest-concurrent",
        app: "mole", game: "diglew", roundKey: "itest-concurrent-1",
        baseReward: 10, multiplier: 1, payout: 10,
      };
      // Real network race: both requests hit the unique-index upsert at once.
      const [a, b] = await Promise.all([rewards.recordRewardClaim(args), rewards.recordRewardClaim(args)]);
      const duplicateCount = [a, b].filter((r) => r.duplicate).length;
      assert.equal(duplicateCount, 1, "exactly one of the two concurrent inserts must lose to the unique index");

      const summary = await rewards.getRewardSummary("mongo-itest-concurrent");
      assert.equal(summary.totalPayout, 10, "the event was credited once, not twice");
    });

    test("a reconcile re-run against the real Mongo path stays idempotent", async () => {
      const guest = "guest:mongo-itest-device";
      const user = "mongo-itest-user";
      await rewards.recordRewardClaim({
        discordUserId: guest, app: "mole", game: "diglew", roundKey: "itest-guest-win",
        baseReward: 30, multiplier: 1, payout: 30,
      });

      const first = await rewards.reassignClaims(guest, user);
      assert.equal(first.moved, 1);
      const second = await rewards.reassignClaims(guest, user);
      assert.equal(second.moved, 0, "re-running the same reassignment against Mongo must not move it again");

      assert.equal((await rewards.getRewardSummary(user)).totalPayout, 30);
    });
  });
}
