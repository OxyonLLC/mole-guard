// Public visibility is opt-in, and defaults to OFF.
//
// People synced Discord or X to unlock payouts. That is not consent to appear
// on a public page, and reusing it as if it were would quietly change the deal
// they agreed to. These tests exist because the failure is silent and one-way:
// nobody notices a handle that should not have been published until after it
// has been.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-optin-"));
process.env.DATA_DIR = TMP;
process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;
process.env.DISCORD_TOKEN ||= "test";
process.env.DISCORD_CLIENT_ID ||= "test";
process.env.DISCORD_CLIENT_SECRET ||= "test";
process.env.DISCORD_REDIRECT_URI ||= "http://localhost/cb";
process.env.WINLEW_MINT ||= "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";

import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { saveProfilePrefs, getProfilePrefsByUser } = await import("../../src/mole/profilePrefs.js");
const { syncIdentity, listSyncedIdentities } = await import("../../src/mole/syncedIdentities.js");
const { writeJson } = await import("../../src/mole/storage.js");

const USER = "1220049423548026952";

beforeEach(() => writeJson("synced_identities.json", {}));

describe("the opt-in defaults to off", () => {
  test("a brand-new profile is not public", () => {
    const prefs = saveProfilePrefs({ discordUserId: `${USER}-a`, displayName: "Someone" });
    assert.notEqual(prefs.publicIdentity, true, "the default must be off, not merely falsy by accident");
  });

  test("syncing an identity does NOT make it public", () => {
    // The whole point. Syncing unlocks payouts; it is not a publication consent.
    const id = `${USER}-b`;
    saveProfilePrefs({ discordUserId: id, displayName: "Someone" });
    syncIdentity({ accountId: id, provider: "discord", providerUserId: "555", handle: "someone" });
    assert.notEqual(getProfilePrefsByUser(id)?.publicIdentity, true);
  });

  test("an ordinary profile save cannot switch it on by omission", () => {
    // saveProfilePrefs is called from several places that know nothing about
    // visibility. Passing no value must leave the choice exactly as it was.
    const id = `${USER}-c`;
    saveProfilePrefs({ discordUserId: id, publicIdentity: true });
    assert.equal(getProfilePrefsByUser(id).publicIdentity, true);
    saveProfilePrefs({ discordUserId: id, displayName: "Renamed" });
    assert.equal(getProfilePrefsByUser(id).publicIdentity, true, "an unrelated save must not flip it off either");
  });

  test("it is reversible — off again means off", () => {
    const id = `${USER}-d`;
    saveProfilePrefs({ discordUserId: id, publicIdentity: true });
    saveProfilePrefs({ discordUserId: id, publicIdentity: false });
    assert.equal(getProfilePrefsByUser(id).publicIdentity, false);
  });

  test("only a literal true turns it on", () => {
    // A truthy string from a JSON body must not be enough to publish someone.
    const id = `${USER}-e`;
    saveProfilePrefs({ discordUserId: id, publicIdentity: "yes" });
    assert.equal(getProfilePrefsByUser(id).publicIdentity, false);
  });
});

describe("handles are stored, which is not the same as shown", () => {
  test("a synced handle is kept for display but sits behind the opt-in", () => {
    const id = `${USER}-f`;
    syncIdentity({ accountId: id, provider: "x", providerUserId: "42", handle: "@someone" });
    const [entry] = listSyncedIdentities(id);
    assert.equal(entry.handle, "someone", "the leading @ is stripped so it is stored once, canonically");
    assert.notEqual(getProfilePrefsByUser(id)?.publicIdentity, true, "storing it must not publish it");
  });

  test("records written before handles existed still resolve", () => {
    // Older entries are a bare string rather than { account, handle }. A
    // migration that stranded them would lock people out of their own account.
    writeJson("synced_identities.json", { "discord:999": `${USER}-g` });
    const found = listSyncedIdentities(`${USER}-g`);
    assert.equal(found.length, 1);
    assert.equal(found[0].provider, "discord");
    assert.equal(found[0].handle, null, "no handle recorded is null, never a crash");
  });
});

// ── What a public payout row may contain ──────────────────────────────────
//
// publicIdentityFor() lives inside startWeb() and is not exported, so these
// read the source. That is deliberate rather than lazy: the property being
// guarded is "this field is gated on the opt-in", and a rename that moved the
// gate would be exactly the change worth failing on.
describe("the public payout row is gated on consent", () => {
  const src = fs.readFileSync(new URL("../../src/mole/web.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function publicIdentityFor"), src.indexOf("function quizDisplayName"));

  test("synced handles are only included when opted in", () => {
    assert.match(fn, /const opted = prefs\.publicIdentity === true;/);
    assert.match(fn, /const identities = opted/, "handles must hang off the opt-in, not off having synced");
  });

  test("the profile link is gated too — it carries a FULL wallet address", () => {
    // Found by a leak check: the row truncates the wallet to D8oJ…5ZEz and then
    // handed the whole address back inside this URL, defeating the truncation.
    assert.match(fn, /profileUrl: opted && prefs\.wallet/,
      "an un-consented row must not publish a full address via its profile link");
  });

  test("an unnamed person is masked, never identified by raw id", () => {
    assert.match(fn, /Player ••\$\{id\.slice\(-4\)\}/, "the fallback shows four characters, not the id");
    assert.ok(!/name: id\b/.test(fn), "the raw Discord id must never be the display name");
  });

  test("the payouts route returns no Discord ids, balances or PoV scores", () => {
    const route = src.slice(src.indexOf('app.get("/api/hodl/payouts"'), src.indexOf('app.get("/api/hodl/status"'));
    assert.ok(!/discordUserId:/.test(route), "a Discord id identifies a real account and has no place in a public list");
    assert.ok(!/povScore/.test(route), "a participation score is not a receipt");
    assert.match(route, /walletShort/, "wallets must be truncated server-side, not by the page");
    assert.match(route, /status === "paid" \|\| s\.status === "partial"/, "only weeks that actually paid may appear");
  });
});
