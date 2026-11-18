// Discord account bans.
//
// Built after seven wallets belonging to one operator were banned in an
// evening. Banning wallets is necessary and insufficient — a wallet costs
// nothing to make, so the eighth was always coming. The account is the
// expensive identity.
//
// What is tested here is mostly the boring correctness that makes a ban
// actually hold: that a mention and a raw id are the same key, that re-banning
// does not erase when it started, and that review-only refuses nobody.
import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// The isolated runner owns user_bans.json's disposable FAUCET_DATA_DIR.
const { banUser, unbanUser, getUserBan, listUserBans, isUserBanned, normalizeUserId, checkUserBan } =
  await import("../../src/faucet/userBans.js");

// Reset through the module's own API so storage.js's in-memory cache and the
// disposable file remain consistent.
function reset() {
  for (const b of listUserBans()) unbanUser(b.userId);
}
beforeEach(reset);

describe("a ban has to match the id it was entered as", () => {
  test("a mention and a raw id are the same key", () => {
    // Someone bans <@123> and the claim path checks "123". If those are
    // different keys the ban silently matches nothing, which looks exactly
    // like no ban at all — the worst possible failure for this feature.
    for (const form of ["123456789012345678", "<@123456789012345678>", "<@!123456789012345678>", "  123456789012345678 "]) {
      assert.equal(normalizeUserId(form), "123456789012345678", `${form} normalised wrong`);
    }
  });

  test("banning by mention is found by raw id", () => {
    banUser("<@987654321098765432>", { reason: "farming" });
    assert.equal(isUserBanned("987654321098765432"), true);
  });

  test("a wallet address is rejected, not stored as an id", () => {
    // Pasting the wrong thing into the wrong command must fail loudly rather
    // than record a ban that can never match anyone.
    assert.throws(() => normalizeUserId("Cz8webq82e7BaoAYiEnvyEXSKvRqfvbAb9iDcJGyXmGr"), /not_a_discord_user_id/);
    assert.throws(() => normalizeUserId(""), /not_a_discord_user_id/);
    assert.throws(() => normalizeUserId("not-an-id"), /not_a_discord_user_id/);
  });

  test("a malformed id is not banned rather than throwing at the claim path", () => {
    assert.equal(getUserBan("garbage"), null);
    assert.equal(isUserBanned("garbage"), false);
  });
});

describe("review-only refuses nobody", () => {
  test("a review-only record is not enforced", () => {
    // The wallet list had a review-only ban sitting unenforced for two weeks
    // while everyone assumed it was blocking. Same trap, same rule.
    banUser("111111111111111111", { reason: "watching", reviewOnly: true });
    assert.equal(isUserBanned("111111111111111111"), false);
    assert.ok(getUserBan("111111111111111111"), "the record should still exist for a human to see");
  });

  test("re-banning without --review starts enforcing", () => {
    banUser("111111111111111111", { reason: "watching", reviewOnly: true });
    banUser("111111111111111111", { reason: "confirmed", reviewOnly: false });
    assert.equal(isUserBanned("111111111111111111"), true);
  });

  test("re-banning keeps when it started", () => {
    // How long someone has been at it is evidence. Overwriting bannedAt on a
    // re-ban would quietly erase it.
    const first = banUser("222222222222222222", { reason: "a", reviewOnly: true });
    const again = banUser("222222222222222222", { reason: "b" });
    assert.equal(again.bannedAt, first.bannedAt);
    assert.ok(again.updatedAt >= first.updatedAt);
    assert.equal(again.reason, "b");
  });
});

describe("the list and the lifting", () => {
  test("unbanning removes it", () => {
    banUser("333333333333333333", { reason: "x" });
    assert.ok(unbanUser("333333333333333333"));
    assert.equal(getUserBan("333333333333333333"), null);
    assert.equal(isUserBanned("333333333333333333"), false);
  });

  test("unbanning someone who was never banned is null, not an error", () => {
    assert.equal(unbanUser("444444444444444444"), null);
  });

  test("the list is newest first, so a fresh ban is not buried", async () => {
    banUser("555555555555555555", { reason: "old" });
    // Distinct timestamps on purpose. bannedAt is millisecond resolution, so
    // two bans issued in the same tick tie and the order is then insertion
    // order — real bans are minutes apart, and asserting otherwise would be
    // testing a guarantee the code does not make.
    await new Promise((r) => setTimeout(r, 3));
    banUser("666666666666666666", { reason: "new" });
    const ids = listUserBans().map((b) => b.userId);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], "666666666666666666");
  });

  test("checkUserBan reports the record without throwing on junk", async () => {
    banUser("777777777777777777", { reason: "farming" });
    assert.deepEqual((await checkUserBan("777777777777777777")).banned, true);
    assert.equal((await checkUserBan("not-an-id")).banned, false);
    assert.equal((await checkUserBan(null)).banned, false);
  });
});

describe("it stays out of the guessing business", () => {
  test("there is no cluster walk here, and there must not be", () => {
    // Discord gives no funding graph. Linking two accounts from a shared IP or
    // a shared device would be a guess dressed as evidence — those signals live
    // in the participation trust layer where they are scored and reviewable.
    const src = fs.readFileSync(path.resolve(DIR, "../../src/faucet/userBans.js"), "utf8");
    for (const forbidden of ["findBannedLink", "getFundersCached", "deviceHash", "netHash"]) {
      assert.ok(!src.includes(forbidden), `userBans.js references ${forbidden} — it must stay an exact-match list`);
    }
  });
});
