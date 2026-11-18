// Sync your account — the uniqueness rule that makes a wallet-rooted account
// mean something.
//
// The model: the wallet IS the account, connecting costs nothing, and a synced
// Discord or X identity is what unlocks being PAID. A wallet is free to
// generate, so it can never be evidence of a person; a social account not
// already attached elsewhere can be. Every test here defends one of the two
// properties that argument rests on — one identity belongs to one account, and
// an account with no identity cannot be paid.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-sync-"));
process.env.DATA_DIR = TMP;
process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;
// storage.js resolves DATA_DIR through config.js's zod-validated getConfig(),
// which expects the env src/index.js normally loads. This file never goes
// through index.js, so the required keys are stubbed here.
process.env.DISCORD_TOKEN ||= "test";
process.env.DISCORD_CLIENT_ID ||= "test";
process.env.DISCORD_CLIENT_SECRET ||= "test";
process.env.DISCORD_REDIRECT_URI ||= "http://localhost/cb";
process.env.WINLEW_MINT ||= "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";

import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const {
  IDENTITY_PROVIDERS, syncIdentity, unsyncIdentity, accountForIdentity,
  listSyncedIdentities, canBePaid, identityKey,
} = await import("../../src/mole/syncedIdentities.js");
const { writeJson } = await import("../../src/mole/storage.js");

const WALLET_ACCOUNT = "wallet:94943b30aef10c3ee81387feceda439e";
const OTHER_ACCOUNT = "wallet:3e9d7719d8414eead2b66afa07232d21";
const DISCORD_ACCOUNT = "1220049423548026952";

beforeEach(() => writeJson("synced_identities.json", {}));

describe("one social identity belongs to exactly one account", () => {
  test("a fresh identity syncs", () => {
    const r = syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    assert.equal(r.changed, true);
    assert.equal(accountForIdentity("discord", "999"), WALLET_ACCOUNT);
  });

  test("re-syncing the SAME account is a no-op success, not an error", () => {
    // A double click, or an OAuth callback delivered twice, must not look like
    // a failure to someone who did nothing wrong.
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    const again = syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    assert.equal(again.ok, true);
    assert.equal(again.changed, false);
  });

  test("syncing to a DIFFERENT account is refused, and says where it lives", () => {
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    try {
      syncIdentity({ accountId: OTHER_ACCOUNT, provider: "discord", providerUserId: "999" });
      assert.fail("a second account must not be able to claim the same Discord login");
    } catch (error) {
      assert.equal(error.code, "identity_already_synced");
      assert.equal(error.linkedTo, WALLET_ACCOUNT, "an honest person needs to find the account they forgot");
    }
  });

  test("Discord and X are separate keyspaces — the same numeric id is two identities", () => {
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "555" });
    syncIdentity({ accountId: OTHER_ACCOUNT, provider: "x", providerUserId: "555" });
    assert.equal(accountForIdentity("discord", "555"), WALLET_ACCOUNT);
    assert.equal(accountForIdentity("x", "555"), OTHER_ACCOUNT);
  });

  test("a colon in the provider id is refused — it would forge a key", () => {
    // "discord:1:2" must never be constructible from user input.
    assert.throws(() => identityKey("discord", "1:2"), /provider_user_id_invalid/);
  });

  test("an unknown provider is refused", () => {
    assert.throws(() => identityKey("telegram", "1"), /unknown_identity_provider/);
  });
});

describe("canBePaid: the payout gate", () => {
  test("a wallet-rooted account with nothing synced cannot be paid", () => {
    assert.equal(canBePaid(WALLET_ACCOUNT), false,
      "a wallet is free to generate, so it is not evidence of a person");
  });

  test("either provider unlocks it, on its own", () => {
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "x", providerUserId: "42" });
    assert.equal(canBePaid(WALLET_ACCOUNT), true, "X alone must be enough — not everyone has Discord");

    syncIdentity({ accountId: OTHER_ACCOUNT, provider: "discord", providerUserId: "43" });
    assert.equal(canBePaid(OTHER_ACCOUNT), true);
  });

  test("EXISTING Discord-keyed accounts stay payable with no record at all", () => {
    // Every account that predates this file is keyed by its Discord snowflake.
    // The id is the proof. Requiring them to re-sync would have locked out every
    // current participant on the day this shipped.
    assert.equal(canBePaid(DISCORD_ACCOUNT), true);
    assert.deepEqual(listSyncedIdentities(DISCORD_ACCOUNT), []);
  });

  test("an empty or missing account id is never payable", () => {
    assert.equal(canBePaid(""), false);
    assert.equal(canBePaid(null), false);
    assert.equal(canBePaid(undefined), false);
  });
});

describe("unsync cannot strip an account of its right to be paid", () => {
  test("removing the LAST identity from a wallet account is refused", () => {
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    assert.throws(
      () => unsyncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" }),
      /last_identity_cannot_be_removed/,
      "otherwise a person silently disables their own payouts — or launders an identity onto a second account",
    );
    assert.equal(canBePaid(WALLET_ACCOUNT), true);
  });

  test("removing one of two is fine", () => {
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "x", providerUserId: "888" });
    unsyncIdentity({ accountId: WALLET_ACCOUNT, provider: "x", providerUserId: "888" });
    assert.equal(listSyncedIdentities(WALLET_ACCOUNT).length, 1);
    assert.equal(canBePaid(WALLET_ACCOUNT), true);
  });

  test("a Discord-keyed account may unsync freely — its id is still the proof", () => {
    syncIdentity({ accountId: DISCORD_ACCOUNT, provider: "x", providerUserId: "777" });
    unsyncIdentity({ accountId: DISCORD_ACCOUNT, provider: "x", providerUserId: "777" });
    assert.equal(canBePaid(DISCORD_ACCOUNT), true);
  });

  test("you cannot unsync an identity that is not yours", () => {
    syncIdentity({ accountId: WALLET_ACCOUNT, provider: "discord", providerUserId: "999" });
    assert.throws(
      () => unsyncIdentity({ accountId: OTHER_ACCOUNT, provider: "discord", providerUserId: "999" }),
      /identity_not_synced_to_account/,
    );
  });
});
